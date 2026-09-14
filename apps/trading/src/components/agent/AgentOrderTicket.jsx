/**
 * AgentOrderTicket - the conditional-order approval card rendered when the
 * agent emits an order_ticket. Shows the trigger spec (mcap targets with
 * the computed trigger price + supply caveat), spend, expiry; gates order
 * placement behind the session-signer consent (AgentConsentSheet) when the
 * wallet has no delegated signer yet; POSTs /api/agent/orders with
 * clientOrderId idempotency.
 */
import { useMemo, useRef, useState } from 'react'
import { Loader2, Check, Clock, AlertTriangle } from 'lucide-react'
import { usePrivySafe, useSolanaWalletsSafe } from '../../lib/use-privy-safe'
import { track, Events } from '../../services/analytics'
import AgentConsentSheet from './AgentConsentSheet'

// Coin amounts: 4 significant digits - never render a raw float to a user.
const fmtAmt = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? String(Number(n.toPrecision(4))) : '-'
}

const fmtUsd = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toFixed(n >= 1 ? 2 : 6)}`
}

const EXPIRY_PRESETS = [
  { label: '1d', ms: 86400_000 },
  { label: '3d', ms: 3 * 86400_000 },
  { label: '7d', ms: 7 * 86400_000 },
]

// A placed ticket persists across panel close/reopen so a re-opened ticket
// shows "armed" instead of re-offering Place (which is how a duplicate order
// was created). Belt-and-suspenders: the clientOrderId is derived from the
// stable ticketId, so even a re-click is idempotent server-side.
const PLACED_KEY = 'spectre-agent-placed-v1'
function loadPlacedMap() { try { return JSON.parse(sessionStorage.getItem(PLACED_KEY) || '{}') } catch { return {} } }
function rememberPlaced(ticketId, order) {
  if (!ticketId) return
  try { const m = loadPlacedMap(); m[ticketId] = { expiresAt: order?.expiresAt || Date.now() }; sessionStorage.setItem(PLACED_KEY, JSON.stringify(m)) } catch { /* ignore */ }
}

export default function AgentOrderTicket({ ticket, surface = 'desktop' }) {
  const privy = usePrivySafe()
  const { wallets: solWallets } = useSolanaWalletsSafe()
  const [expiryMs, setExpiryMs] = useState(3 * 86400_000)
  const [consentOpen, setConsentOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Seed from sessionStorage so a reopened panel shows the placed state, not
  // a fresh Place button (the source of the duplicate-order bug).
  const [placed, setPlaced] = useState(() => (ticket?.ticketId ? loadPlacedMap()[ticket.ticketId] : null) || null)
  const [error, setError] = useState(null)
  // Stable per-ticket id => re-placing the same ticket is idempotent server-side.
  const clientOrderIdRef = useRef(ticket?.ticketId || crypto.randomUUID())
  const getTokenRef = useRef(privy?.getAccessToken)
  getTokenRef.current = privy?.getAccessToken

  const embeddedSol = solWallets?.find((w) => w.standardWallet?.isPrivyWallet)
  const delegated = useMemo(() => {
    const accounts = privy?.user?.linkedAccounts || []
    return accounts.some((a) => a.type === 'wallet' && a.delegated === true &&
      embeddedSol?.address && a.address?.toLowerCase() === embeddedSol.address.toLowerCase())
  }, [privy?.user, embeddedSol?.address])

  const triggerLine = useMemo(() => {
    const t = ticket.trigger || {}
    const dir = t.op === 'gte' ? 'reaches' : 'drops to'
    if (ticket.kind === 'dca' && ticket.range) {
      return `DCA ${fmtAmt(ticket.spend?.amount)} ${ticket.payTokenSymbol || 'SOL'} across ${fmtUsd(ticket.range.min)} - ${fmtUsd(ticket.range.max)} ${t.metric} in ${ticket.tranches || ticket.dca?.tranches || 4} tranches`
    }
    return `${ticket.side === 'buy' ? 'Buy' : 'Sell'} when ${t.metric} ${dir} ${fmtUsd(t.value)}`
  }, [ticket])

  const placeOrder = async (opts = {}) => {
    if (busy || placed) return
    // opts.granted skips the local delegated check right after a fresh grant -
    // the bridged user object may lag a render; the server re-verifies anyway.
    if (!delegated && opts?.granted !== true) { setConsentOpen(true); return }
    setBusy(true)
    setError(null)
    try {
      const accessToken = await getTokenRef.current?.()
      if (!accessToken) throw new Error('Sign in first')
      const payload = JSON.stringify({
        clientOrderId: clientOrderIdRef.current,
        kind: ticket.kind === 'dca' ? 'dca' : 'trigger',
        side: ticket.side,
        token: { address: ticket.tokenAddress, networkId: ticket.networkId, symbol: ticket.symbol, decimals: ticket.tokenDecimals },
        trigger: {
          metric: ticket.trigger?.metric, op: ticket.trigger?.op, value: ticket.trigger?.value,
          supplyAtCreate: ticket.trigger?.supplyUsed, priceAtCreate: ticket.trigger?.priceUsd,
        },
        ...(ticket.range ? { range: ticket.range, tranches: ticket.tranches || ticket.dca?.tranches || 4 } : {}),
        spend: { token: 'native', amount: ticket.spend?.amount, capUsd: ticket.spend?.capUsd },
        slippageBps: ticket.slippageBps || 100,
        expiresAt: Date.now() + expiryMs,
        walletAddress: embeddedSol?.address,
      })
      // clientOrderId makes this POST replay-safe (atomic claim + replay
      // repair server-side), so transient 5xx/network failures retry here
      // instead of burning the user's click on an Upstash latency spike
      // (hit live during the 2026-07-11 gate test). 4xx answers are
      // definitive and never retried.
      let res = null
      let body = null
      let lastErr = null
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt))
        try {
          res = await fetch('/api/agent/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: payload,
          })
          body = await res.json().catch(() => ({}))
          if (res.status < 500) { lastErr = null; break }
          lastErr = new Error(body?.error || `order failed (${res.status})`)
        } catch (e) { lastErr = e; res = null }
      }
      if (lastErr) throw lastErr
      if (res.status === 409 && body.code === 'signer_not_granted') { setConsentOpen(true); return }
      if (!res.ok) throw new Error(body?.error || `order failed (${res.status})`)
      setPlaced(body.order)
      rememberPlaced(ticket.ticketId, body.order)
      track(Events.AGENT_ORDER_PLACED, { surface, chain: ticket.networkId, symbol: ticket.symbol, kind: ticket.kind })
    } catch (e) {
      setError(e?.message || 'Order placement failed')
    } finally {
      setBusy(false)
    }
  }

  if (placed) {
    return (
      <div className="sagent-card sagent-card--success">
        <div className="sagent-card__row sagent-card__row--head">
          <Check size={13} />
          <span>Order armed</span>
        </div>
        <div className="sagent-card__rationale">
          {triggerLine}. Expires {new Date(placed.expiresAt).toLocaleDateString()}. Manage it from the agent panel anytime.
        </div>
      </div>
    )
  }

  return (
    <div className="sagent-card">
      <div className="sagent-card__row sagent-card__row--head">
        <span className="sagent-card__side">{ticket.kind === 'dca' ? 'DCA ORDER' : 'TRIGGER ORDER'} {ticket.symbol}</span>
        <Clock size={12} />
      </div>

      <div className="sagent-card__rationale">{triggerLine}</div>
      {ticket.rationale && <div className="sagent-card__rationale">{ticket.rationale}</div>}

      <div className="sagent-card__grid">
        {ticket.trigger?.metric === 'mcap' && ticket.trigger?.priceUsd != null && (
          <>
            <span className="sagent-card__label">Trigger price</span>
            <span className="sagent-card__val">{fmtUsd(ticket.trigger.priceUsd)} <span className="sagent-card__hint">(moves if supply changes)</span></span>
          </>
        )}
        <span className="sagent-card__label">{ticket.side === 'sell' ? 'Sell' : 'Spend'}</span>
        <span className="sagent-card__val">
          {fmtAmt(ticket.spend?.amount)} {ticket.side === 'sell' ? (ticket.symbol || 'tokens') : (ticket.payTokenSymbol || 'SOL')}
          {Number.isFinite(Number(ticket.spend?.usdEstimate)) && <span className="sagent-card__hint"> (~{fmtUsd(ticket.spend.usdEstimate)})</span>}
        </span>
        <span className="sagent-card__label">Spend cap</span>
        <span className="sagent-card__val">{fmtUsd(ticket.spend?.capUsd)}</span>
        <span className="sagent-card__label">Expires in</span>
        <span className="sagent-card__val">
          <span className="sagent-card__presets">
            {EXPIRY_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`sagent-card__preset${expiryMs === p.ms ? ' is-active' : ''}`}
                onClick={() => setExpiryMs(p.ms)}
              >{p.label}</button>
            ))}
          </span>
        </span>
      </div>

      {error && <div className="sagent-card__error">{error}</div>}

      {ticket.instantTrigger && (
        <div className="sagent-card__warnbar">
          <AlertTriangle size={12} />
          <span>
            Executes immediately - the {ticket.trigger?.metric === 'mcap' ? 'market cap' : 'price'} is already
            {ticket.trigger?.op === 'gte' ? ' at or above' : ' at or below'} this level. Placing this order trades
            right away instead of waiting for a move.
          </span>
        </div>
      )}
      <div className="sagent-card__actions">
        <button
          type="button"
          className="sagent-card__btn sagent-card__btn--confirm"
          disabled={busy}
          onClick={placeOrder}
        >
          {busy ? (<><Loader2 size={13} className="sagent-tool__spin" /> Placing...</>)
            : delegated ? 'Place order' : 'Enable automated orders'}
        </button>
      </div>

      <div className="sagent-card__foot">
        Executes server-side within your granted scope when the trigger fires - revoke anytime from the panel.
      </div>

      {consentOpen && (
        <AgentConsentSheet
          surface={surface}
          onClose={() => setConsentOpen(false)}
          onGranted={() => { setConsentOpen(false); placeOrder({ granted: true }) }}
        />
      )}
    </div>
  )
}
