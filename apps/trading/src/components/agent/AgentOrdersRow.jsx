/**
 * AgentOrdersRow - the order-management strip inside the agent panel: open
 * orders for the current token (with one-tap Cancel) + the automation
 * status pill with Revoke. This is the surface the order-ticket success
 * copy points at ("manage it from the agent panel").
 *
 * Privy hooks stay in this on-demand child (privy.md D1); getAccessToken
 * rides a ref (D2). Cancel is only offered for cancellable statuses - the
 * server refuses 'executing' (the engine may be signing).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck, ShieldOff, XCircle, Loader2, ChevronDown } from 'lucide-react'
import { usePrivySafe, useSolanaWalletsSafe, useSignersSafe } from '../../lib/use-privy-safe'
import { track, Events } from '../../services/analytics'

const fmtUsd = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  if (n >= 1) return `$${n.toFixed(2)}`
  // Sub-$1 trigger prices need significant digits, not 2 decimals (a $0.156
  // trigger shown as "$0.16" reads as the wrong order). 4 sig-figs so a
  // memecoin trigger like $0.001216 isn't rounded to $0.00122.
  return `$${Number(n.toPrecision(4))}`
}

// Coin amounts: 4 significant digits (server-sized amounts carry full
// float precision - never render 0.012820901764445563 to a user).
const fmtAmt = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? String(Number(n.toPrecision(4))) : '-'
}

function orderLine(o) {
  const t = o.trigger || {}
  const dir = t.op === 'gte' ? 'reaches' : 'drops to'
  const metric = t.metric === 'mcap' ? 'mcap' : 'price'
  // A buy spends SOL; a sell sells the token itself - never label a sell "SOL".
  const unit = o.side === 'buy' ? (o.payTokenSymbol || 'SOL') : (o.token?.symbol || 'tokens')
  return `${o.side === 'buy' ? 'Buy' : 'Sell'} ${fmtAmt(o.spend?.amount)} ${unit} when ${metric} ${dir} ${fmtUsd(t.value)}`
}

export default function AgentOrdersRow({ token, surface = 'desktop' }) {
  const privy = usePrivySafe()
  const { wallets: solWallets } = useSolanaWalletsSafe()
  const { removeSigners } = useSignersSafe()

  const [open, setOpen] = useState(false)
  const [orders, setOrders] = useState(null) // null = not loaded
  const [busyId, setBusyId] = useState(null)
  const [revoking, setRevoking] = useState(false)
  const getTokenRef = useRef(privy?.getAccessToken)
  getTokenRef.current = privy?.getAccessToken

  const embeddedSol = solWallets?.find((w) => w.standardWallet?.isPrivyWallet)
  const delegated = useMemo(() => {
    const accounts = privy?.user?.linkedAccounts || []
    return accounts.some((a) => a.type === 'wallet' && a.delegated === true &&
      embeddedSol?.address && a.address?.toLowerCase() === embeddedSol.address.toLowerCase())
  }, [privy?.user, embeddedSol?.address])

  const load = useCallback(async () => {
    try {
      const jwt = await getTokenRef.current?.()
      if (!jwt) { setOrders([]); return }
      const res = await fetch(`/api/agent/orders?scope=open`, { headers: { Authorization: `Bearer ${jwt}` } })
      const j = await res.json().catch(() => null)
      setOrders(res.ok ? (j?.orders || []) : [])
    } catch { setOrders([]) }
  }, [])

  // Load when expanded, then keep it live while open + visible so an
  // instant-trigger fill (or an engine execution) drops out of the list
  // within a few seconds instead of showing a stale 'armed' row. Poll only
  // while the section is EXPANDED (a deliberate, transient user action) and
  // the tab is visible; stop the moment it collapses or the list empties -
  // a scope=open fetch returns nothing once everything is terminal.
  useEffect(() => {
    if (!open) return
    load() // fresh load every time the section opens
    const timer = setInterval(() => { if (!document.hidden) load() }, 8000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [open, load])

  const cancel = useCallback(async (orderId) => {
    setBusyId(orderId)
    try {
      const jwt = await getTokenRef.current?.()
      const res = await fetch('/api/agent/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ orderId }),
      })
      const j = await res.json().catch(() => null)
      if (res.ok) {
        setOrders((prev) => (prev || []).filter((o) => o.id !== orderId))
        track(Events.AGENT_ORDER_CANCELLED ?? 'Agent Order Cancelled', { surface })
      } else if (j?.code === 'executing') {
        // Server refused - execution in flight; refresh the list.
        load()
      }
    } finally { setBusyId(null) }
  }, [load, surface])

  const revoke = useCallback(async () => {
    if (!embeddedSol?.address || revoking) return
    setRevoking(true)
    try {
      await removeSigners({ address: embeddedSol.address })
      track(Events.AGENT_SIGNER_REVOKED, { surface })
    } catch { /* stub or API error - pill state stays */ }
    finally { setRevoking(false) }
  }, [embeddedSol?.address, removeSigners, revoking, surface])

  const count = orders?.length ?? null

  return (
    <div className="sagent-orders">
      <button type="button" className="sagent-orders__head" onClick={() => setOpen((v) => !v)}>
        {delegated ? <ShieldCheck size={12} className="sagent-orders__on" /> : <ShieldOff size={12} />}
        <span>Automation {delegated ? 'on' : 'off'}</span>
        <span className="sagent-orders__count">{count != null ? `${count} open order${count === 1 ? '' : 's'}` : 'orders'}</span>
        <ChevronDown size={12} className={`sagent-orders__chev${open ? ' is-open' : ''}`} />
      </button>

      {open && (
        <div className="sagent-orders__body">
          {orders === null && <div className="sagent-orders__empty">loading...</div>}
          {orders?.length === 0 && <div className="sagent-orders__empty">No open orders.</div>}
          {(orders || []).map((o) => (
            <div key={o.id} className="sagent-orders__row">
              <div className="sagent-orders__info">
                <span className="sagent-orders__line">{o.token?.symbol} - {orderLine(o)}</span>
                <span className="sagent-orders__meta">cap {fmtUsd(o.spend?.capUsd)} - expires {new Date(o.expiresAt).toLocaleDateString()} - {o.status}</span>
              </div>
              <button
                type="button"
                className="sagent-panel__iconbtn"
                title={o.status === 'executing' || o.status === 'triggered' ? 'Executing - cannot cancel' : 'Cancel order'}
                disabled={busyId === o.id || o.status === 'executing' || o.status === 'triggered'}
                onClick={() => cancel(o.id)}
              >
                {busyId === o.id ? <Loader2 size={13} className="sagent-tool__spin" /> : <XCircle size={13} />}
              </button>
            </div>
          ))}
          {delegated && (
            <button type="button" className="sagent-orders__revoke" disabled={revoking} onClick={revoke}>
              {revoking ? 'Revoking...' : 'Revoke automation permission'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
