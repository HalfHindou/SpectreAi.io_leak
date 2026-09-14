import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLatestTrades } from '@/services/codexApi'
import { isOnchainSupported, getLatestTrades as onchainGetLatestTrades } from '@/services/onchainApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './rzm-trades-list.css'

/**
 * RzmTradesList — mobile on-chain live Trades feed for the Research Zone Markets tab.
 *
 * Self-fetching via the SAME source chain as the desktop trades sub-tab
 * (rz-markets-section.jsx): Spectre onchain swaps first (free), Codex fallback.
 * Fetch + poll ONLY when `enabled` is true — it is segment-gated by the parent,
 * so polling stops the moment the segment is hidden. useAdaptivePolling also
 * pauses on document.hidden and stops after the tab is idle.
 *
 * Props:
 *   address   {string}  token contract address (on-chain identity)
 *   networkId {number}  chain id (1 ETH, 56 BSC, 1399811149 SOL, …)
 *   symbol    {string}  ticker, used only for the empty state copy
 *   fmtPrice  {func}    currency-bound price formatter from useCurrency()
 *   enabled   {bool}    segment-gate; false = no fetch, no poll
 */

const MAX_ROWS = 40
const POLL_MS = 15_000

/** Compact age: 3s / 2m / 4h / 2d. `ts` is unix seconds. */
function ageShort(ts) {
  if (!ts) return ''
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (diffSec < 60) return `${diffSec}s`
  const m = Math.floor(diffSec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

/** Truncate an address to 0x12…34 form. */
function truncAddr(a) {
  if (typeof a !== 'string' || a.length <= 10) return a || ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Compact token amount — abbreviate large, keep small readable. */
function fmtAmount(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** Compact USD magnitude for the row primary. */
function fmtUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  if (n >= 10) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}

/** Size tier drives the restraint of the buy/sell accent. */
function sizeTier(usd) {
  if (usd >= 50_000) return 'whale'
  if (usd >= 10_000) return 'large'
  if (usd >= 1_000) return 'medium'
  return ''
}

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const ExplorerIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </svg>
)

function RzmTradesList({ address, networkId = 1, symbol, fmtPrice, enabled = false }) {
  const { t } = useTranslation()
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(null) // maker address just copied
  const loadedRef = useRef(null)             // address whose FIRST load has resolved
  const activeAddrRef = useRef(address)      // latest address — guards stale cross-token responses
  const copyTimer = useRef(null)
  const priceFmt = typeof fmtPrice === 'function' ? fmtPrice : (v) => `$${Number(v || 0)}`

  const netId = networkId ?? 1
  const isOnchain = Boolean(address && address.length > 10)

  // Single fetch routine, reused by the initial load and each poll tick.
  const fetchTrades = useCallback(async () => {
    if (!isOnchain) return
    const firstLoad = loadedRef.current !== address
    if (firstLoad) setLoading(true)
    try {
      let rows = null
      // 2026-05-08 cost migration parity: Spectre onchain swaps first (free), Codex fallback.
      if (isOnchainSupported(netId)) {
        const sp = await onchainGetLatestTrades(address, netId, MAX_ROWS)
        if (sp?.success && Array.isArray(sp.data) && sp.data.length > 0) rows = sp.data
      }
      if (!rows) {
        const result = await getLatestTrades(address, netId, MAX_ROWS)
        rows = result?.trades || []
      }
      // Token may have switched while this request was in flight — RZ keeps this
      // component mounted across switches, so a slow response for token A must
      // not paint (or flag loaded) under token B.
      if (activeAddrRef.current !== address) return
      setTrades(Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [])
      loadedRef.current = address
    } catch {
      // Only clear on the first load; a failed poll keeps the last good feed.
      if (firstLoad && activeAddrRef.current === address) setTrades([])
    } finally {
      if (firstLoad && activeAddrRef.current === address) setLoading(false)
    }
  }, [address, netId, isOnchain])

  // Reset when the token changes so the skeleton shows for the new address.
  useEffect(() => {
    activeAddrRef.current = address
    loadedRef.current = null
    setTrades([])
    setCopied(null)
  }, [address])

  // Initial fetch — only when the segment is enabled and we have an address.
  useEffect(() => {
    if (!enabled || !isOnchain) return
    fetchTrades()
  }, [enabled, isOnchain, address, fetchTrades])

  // Live poll — paused entirely when disabled, on hidden tab, or when idle.
  useAdaptivePolling(fetchTrades, {
    interval: POLL_MS,
    enabled: enabled && isOnchain,
  })

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copyMaker = useCallback((maker) => {
    if (!maker) return
    try { navigator.clipboard?.writeText(maker) } catch { /* clipboard blocked */ }
    setCopied(maker)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), 1200)
  }, [])

  const isSolana = trades[0]?.isSolana
  const explorerTx = isSolana ? 'https://solscan.io/tx/' : 'https://etherscan.io/tx/'

  const rows = useMemo(() => trades.slice(0, MAX_ROWS), [trades])

  if (!isOnchain) return null

  return (
    <div className="rztl">
      <div className="rztl-head">
        <span className="rztl-head-title">{t('researchPro.mtradesList.rzmtradeslist.liveTrades', "Live Trades")}</span>
        {rows.length > 0 && <span className="rztl-head-count">{rows.length}</span>}
      </div>

      {loading && rows.length === 0 ? (
        <div className="rztl-skeleton" aria-busy="true" aria-label={t('researchPro.mtradesList.rzmtradeslist.ariaLoadingTrades', "Loading trades")}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="rztl-skeleton-row">
              <span className="rztl-shimmer rztl-shimmer--side" />
              <span className="rztl-shimmer rztl-shimmer--body" />
              <span className="rztl-shimmer rztl-shimmer--age" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rztl-empty">No recent trades{symbol ? ` for ${symbol}` : ''}</p>
      ) : (
        <ul className="rztl-list">
          {rows.map((t, i) => {
            const isBuy = t.type === 'Buy'
            const side = isBuy ? 'buy' : 'sell'
            const usd = Number(t.amountUSD) || 0
            const tier = sizeTier(usd)
            const maker = t.maker || ''
            const justCopied = copied && copied === maker
            return (
              <li
                key={t.txHash || `${maker}-${t.timestamp}-${i}`}
                className={`rztl-row rztl-row--${side}${tier ? ` rztl-row--${tier}` : ''}`}
              >
                <span className="rztl-accent" aria-hidden="true" />

                <div className="rztl-main">
                  <div className="rztl-main-top">
                    <span className={`rztl-side rztl-side--${side}`}>{isBuy ? 'BUY' : 'SELL'}</span>
                    <span className={`rztl-usd rztl-usd--${side}`}>{fmtUsd(usd)}</span>
                  </div>
                  <div className="rztl-main-sub">
                    <span className="rztl-amount">{fmtAmount(t.amountToken)}{symbol ? ` ${symbol}` : ''}</span>
                    <span className="rztl-dot" aria-hidden="true">·</span>
                    <span className="rztl-price">{priceFmt(t.priceUSD)}</span>
                  </div>
                </div>

                <div className="rztl-side-right">
                  <span className="rztl-age">{ageShort(t.timestamp)}</span>
                  <div className="rztl-maker-row">
                    <button
                      type="button"
                      className={`rztl-maker${justCopied ? ' is-copied' : ''}`}
                      onClick={() => copyMaker(maker)}
                      aria-label={justCopied ? 'Address copied' : `Copy maker ${truncAddr(maker)}`}
                    >
                      <span className="rztl-maker-addr">{justCopied ? 'Copied' : truncAddr(maker)}</span>
                      {!justCopied && <span className="rztl-maker-icon"><CopyIcon /></span>}
                    </button>
                    {t.txHash && (
                      <a
                        href={`${explorerTx}${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rztl-tx"
                        aria-label={t('researchPro.mtradesList.rzmtradeslist.ariaViewTransaction', "View transaction")}
                      >
                        <ExplorerIcon />
                      </a>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default RzmTradesList
