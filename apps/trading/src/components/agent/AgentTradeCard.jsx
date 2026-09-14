/**
 * AgentTradeCard - the propose+confirm card rendered when the agent emits a
 * trade_proposal. NOTHING executes on the LLM's say-so:
 *
 *   - the card RE-QUOTES through useSwapExecution.fetchQuote (the existing
 *     client path -> POST /api/swap/quote, platform fees injected
 *     server-side by construction)
 *   - the honeypot/token-tax guard is re-applied at confirm time (shared
 *     lib/tokenTax.js - third enforcement layer after server validator)
 *   - signing is the existing client-side Privy path (doSwap), history via
 *     the hook's built-in logSwap
 *
 * Mounts on demand inside a chat message (post-interaction, privy.md D1 -
 * useSwapExecution only uses the deferred-safe hooks).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, ShieldAlert, Check } from 'lucide-react'
import { useSwapExecution } from '../../hooks/useSwapExecution'
import { fetchTokenTaxCached } from '../../lib/tokenTax'
import { track, Events } from '../../services/analytics'

const fmtNum = (v, max = 6) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1 ? Math.min(4, max) : max })
}

export default function AgentTradeCard({ proposal, surface = 'desktop' }) {
  const cardToken = useMemo(() => ({
    address: proposal.tokenAddress,
    networkId: proposal.networkId,
    symbol: proposal.symbol,
    decimals: proposal.tokenDecimals || (proposal.networkId === 1399811149 ? 9 : 18),
  }), [proposal])

  const {
    walletConnected, walletReady, payTokenBalance,
    quote, quoteLoading, quoteError, outputAmount, fetchQuote,
    isSwapping, swapSuccess, swapSummary, swapError, txHash, doSwap,
    platformFee, priceImpact,
  } = useSwapExecution({
    token: cardToken,
    mode: proposal.side,
    payToken: proposal.payToken,
    slippageBps: proposal.slippageBps || 100,
  })

  // Restored proposals past their expiry start EXPIRED - an explicit
  // re-quote is required before anything is confirmable.
  const [expired, setExpired] = useState(() => Date.now() > (proposal.expiresAt || Infinity))
  const [taxBlock, setTaxBlock] = useState(null)
  const quotedAtRef = useRef(0)

  // Quote on mount (immediate - deliberate programmatic fill) + 60s expiry.
  // A proposal already past expiresAt (restored session) stays expired
  // until the user explicitly re-quotes.
  useEffect(() => {
    if (Date.now() > (proposal.expiresAt || Infinity)) return undefined
    fetchQuote(String(proposal.amountIn), { immediate: true })
    quotedAtRef.current = Date.now()
    setExpired(false)
    const t = setInterval(() => {
      if (Date.now() - quotedAtRef.current > 60_000) setExpired(true)
    }, 5_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal.proposalId])

  const requote = () => {
    fetchQuote(String(proposal.amountIn), { immediate: true })
    quotedAtRef.current = Date.now()
    setExpired(false)
  }

  const confirm = async () => {
    if (isSwapping || !quote || expired) return
    // Honeypot re-check at the moment of truth (EVM buys; nulls = no
    // coverage, the server validator already gated on that).
    if (proposal.side === 'buy' && proposal.networkId !== 1399811149) {
      try {
        const tax = await fetchTokenTaxCached(proposal.tokenAddress, proposal.networkId)
        if (tax?.isHoneypot) {
          setTaxBlock('Security scan flags this contract as a honeypot - buy blocked.')
          return
        }
      } catch { /* no data - server gate already passed */ }
    }
    track(Events.AGENT_TRADE_CONFIRMED, { surface, chain: proposal.networkId, symbol: proposal.symbol, side: proposal.side })
    const res = await doSwap(String(proposal.amountIn))
    if (!res?.success && res?.error && res.error !== 'Transaction cancelled') {
      track(Events.ERROR, { where: 'agent-trade-card', message: String(res.error).slice(0, 120) })
    }
  }

  const impactWarn = priceImpact != null && priceImpact > 3

  if (swapSuccess && swapSummary) {
    return (
      <div className="sagent-card sagent-card--success">
        <div className="sagent-card__row sagent-card__row--head">
          <Check size={13} />
          <span>Swap confirmed</span>
        </div>
        <div className="sagent-card__row">
          <span>{fmtNum(swapSummary.fromValue)} {swapSummary.fromSymbol}</span>
          <span className="sagent-card__arrow">-&gt;</span>
          <span>{fmtNum(swapSummary.toValue)} {swapSummary.toSymbol}</span>
        </div>
        {txHash && (
          <a
            className="sagent-card__tx"
            href={proposal.networkId === 1399811149 ? `https://solscan.io/tx/${txHash}` : `https://blockscan.com/tx/${txHash}`}
            target="_blank" rel="noreferrer"
          >
            view transaction
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="sagent-card">
      <div className="sagent-card__row sagent-card__row--head">
        <span className="sagent-card__side">{proposal.side === 'buy' ? 'BUY' : 'SELL'} {proposal.symbol}</span>
        {expired && <span className="sagent-card__expired">quote expired</span>}
      </div>

      {proposal.rationale && <div className="sagent-card__rationale">{proposal.rationale}</div>}

      <div className="sagent-card__grid">
        <span className="sagent-card__label">Pay</span>
        <span className="sagent-card__val">
          {fmtNum(proposal.amountIn)} {proposal.side === 'buy' ? proposal.payToken.symbol : proposal.symbol}
        </span>
        <span className="sagent-card__label">Receive (est)</span>
        <span className="sagent-card__val">
          {quoteLoading ? '...' : `${fmtNum(outputAmount)} ${proposal.side === 'buy' ? proposal.symbol : proposal.payToken.symbol}`}
        </span>
        <span className="sagent-card__label">Price impact</span>
        <span className={`sagent-card__val${impactWarn ? ' is-warn' : ''}`}>
          {priceImpact != null ? `${priceImpact.toFixed(2)}%` : '-'}
        </span>
        <span className="sagent-card__label">Platform fee</span>
        <span className="sagent-card__val">
          {platformFee?.feeBps != null ? `${(platformFee.feeBps / 100).toFixed(2)}%` : proposal.platformFeeBps != null ? `${(proposal.platformFeeBps / 100).toFixed(2)}%` : '-'}
        </span>
      </div>

      {(taxBlock || quoteError || swapError) && (
        <div className="sagent-card__error">
          <ShieldAlert size={12} />
          <span>{taxBlock || quoteError || swapError}</span>
        </div>
      )}

      <div className="sagent-card__actions">
        {expired ? (
          <button type="button" className="sagent-card__btn" onClick={requote}>
            <RefreshCw size={13} /> Re-quote
          </button>
        ) : (
          <button
            type="button"
            className="sagent-card__btn sagent-card__btn--confirm"
            disabled={isSwapping || quoteLoading || !quote || !!taxBlock || !walletConnected}
            onClick={confirm}
          >
            {isSwapping ? (<><Loader2 size={13} className="sagent-tool__spin" /> Signing...</>)
              : !walletConnected ? 'Sign in to trade'
              : !walletReady ? 'Wallet loading...'
              : `Confirm ${proposal.side}`}
          </button>
        )}
      </div>

      <div className="sagent-card__foot">
        Balance: {fmtNum(payTokenBalance)} {proposal.side === 'buy' ? proposal.payToken.symbol : proposal.symbol} - you sign in your wallet, the agent never holds funds
      </div>
    </div>
  )
}
