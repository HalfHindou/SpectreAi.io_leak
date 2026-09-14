/**
 * MobilePriceHero — GMGN-literal dense token header.
 *
 *   [avatar] SPECTRE/ETH ♥        $3.88M   <- mcap big (white, flash)
 *            3h · 0x9cf0…dad6 ⧉ 𝕏 ⌖   Price $0.3885  <- price colored
 *   [ 5m -18.49% ][ 1h +60% ][ 4h +12% ][ 24h +4.5% ]  <- tinted tiles
 *
 * Loading state renders shimmer blocks — never fake zeros.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Bell, ChevronLeft, Copy, ExternalLink, Globe, Heart } from 'lucide-react'
import TelegramGlyph from '../ui/TelegramGlyph'
import { useSharedTokenDetails } from '../../contexts/TokenDetailsContext'
import { readCodexChangePct } from '../../lib/marketFormat'
import { useBarChangeWindows } from '../../hooks/useBarChangeWindows'
import { useCopyToast } from '../../App'
import './MobilePriceHero.css'

// Exported for MobileInfoBody (explorer links in the Pair Info rows).
export const CHAINS = {
  1: { code: 'ETH', name: 'Ethereum', explorer: { name: 'Etherscan', url: (a) => `https://etherscan.io/token/${a}` } },
  56: { code: 'BSC', name: 'BNB Chain', explorer: { name: 'BscScan', url: (a) => `https://bscscan.com/token/${a}` } },
  137: { code: 'POLY', name: 'Polygon', explorer: { name: 'PolygonScan', url: (a) => `https://polygonscan.com/token/${a}` } },
  42161: { code: 'ARB', name: 'Arbitrum', explorer: { name: 'Arbiscan', url: (a) => `https://arbiscan.io/token/${a}` } },
  8453: { code: 'BASE', name: 'Base', explorer: { name: 'BaseScan', url: (a) => `https://basescan.org/token/${a}` } },
  10: { code: 'OP', name: 'Optimism', explorer: { name: 'OP Scan', url: (a) => `https://optimistic.etherscan.io/token/${a}` } },
  43114: { code: 'AVAX', name: 'Avalanche', explorer: { name: 'SnowTrace', url: (a) => `https://snowtrace.io/token/${a}` } },
  250: { code: 'FTM', name: 'Fantom', explorer: { name: 'FTMScan', url: (a) => `https://ftmscan.com/token/${a}` } },
  1399811149: { code: 'SOL', name: 'Solana', explorer: { name: 'Solscan', url: (a) => `https://solscan.io/token/${a}` } },
  4663: { code: 'HOOD', name: 'Robinhood', explorer: { name: 'Blockscout', url: (a) => `https://robinhoodchain.blockscout.com/token/${a}` } },
}

const fmtPrice = (p) => {
  const n = Number(p)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (n >= 1) return `$${n.toFixed(4)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  if (n >= 0.0001) return `$${n.toFixed(6)}`
  return `$${n.toFixed(8)}`
}

const fmtCompact = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

const truncAddr = (a) => {
  if (!a) return ''
  if (a.length <= 12) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/* GMGN-style token age: 42m / 3h / 5d. createdAt is unix seconds. */
const fmtAge = (createdAt) => {
  const ts = Number(createdAt)
  if (!Number.isFinite(ts) || ts <= 0) return null
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 60) return `${Math.max(sec, 1)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

/* Single-line tinted perf tile: `5m  -18.49%` (GMGN). Exact zero stays
   neutral — a green "+0.00%" reads as fake data. */
function PerfTile({ label, change }) {
  const has = change !== null && change !== undefined && !Number.isNaN(change)
  const dir = !has || Math.abs(change) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down'
  return (
    <div className={`mph-tile is-${dir}`}>
      <span className="mph-tile-label">{label}</span>
      <span className="mph-tile-value">
        {has ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
      </span>
    </div>
  )
}

export default function MobilePriceHero({
  token,
  watchlist,
  addToWatchlist,
  removeFromWatchlist,
  onBack,
  alertCount = 0,
  onOpenAlerts,
}) {
  const { tokenData: liveData } = useSharedTokenDetails() || {}
  const { triggerCopyToast } = useCopyToast() || {}

  const symbol = token?.symbol || liveData?.symbol || '—'
  const name = token?.name || liveData?.name || ''
  const logo = token?.logo || liveData?.logo || null
  const networkId = token?.networkId || 1
  const chain = CHAINS[networkId] || { code: `#${networkId}`, name: 'Chain', explorer: null }
  const address = token?.address

  // Real per-window change from Codex hourly bars - fills 4h, which the detail
  // endpoint doesn't serve for thin tokens (see useBarChangeWindows).
  const barWindows = useBarChangeWindows(address, networkId)

  const price = Number(liveData?.priceUSD) || Number(liveData?.price) || Number(token?.price) || null
  const priceText = price != null ? fmtPrice(price) : '—'
  // Every window comes from Codex's own hourly bars (real on-chain change). The
  // detail endpoint is MIXED-UNIT/unreliable, so it's only a fallback (normalized
  // through pct's heuristic) before bars land. 5m stays detail-only (bars are
  // hourly). null -> the tile renders "-".
  const pct = (v) => readCodexChangePct(v)
  const change5m = pct(liveData?.change5m ?? liveData?.change5)
  const change1h = barWindows?.change1h ?? pct(liveData?.change1h ?? liveData?.change1) ?? null
  const change4h = barWindows?.change4h ?? null
  const change24h = barWindows?.change24h ?? pct(liveData?.change24h ?? liveData?.change24) ?? null
  const bullBear = (change24h ?? 0) >= 0 ? 'bull' : 'bear'

  const marketCap = Number(liveData?.marketCap ?? token?.marketCap) || null
  const age = fmtAge(liveData?.createdAt ?? token?.createdAt)

  // Data not landed yet -> shimmer, never fake zeros.
  const dataReady = !!(price || marketCap)

  /* ── Watchlist toggle ──────────────────────────────────────────── */
  const inWatchlist = !!watchlist?.find?.((w) => w?.address?.toLowerCase?.() === address?.toLowerCase?.())
  const toggleStar = () => {
    if (inWatchlist) removeFromWatchlist?.(address)
    else if (address) addToWatchlist?.(token)
  }

  /* ── Flash on live price updates (applies to the big number) ───── */
  const [priceFlash, setPriceFlash] = useState(null)
  const prevPriceRef = useRef(null)
  useEffect(() => {
    if (price == null || price <= 0) return
    const prev = prevPriceRef.current
    prevPriceRef.current = price
    if (prev && prev !== price) {
      setPriceFlash(price > prev ? 'up' : 'down')
      const t = setTimeout(() => setPriceFlash(null), 520)
      return () => clearTimeout(t)
    }
  }, [price])

  const handleCopy = () => {
    if (!address) return
    navigator.clipboard?.writeText(address).catch(() => {})
    triggerCopyToast?.('Address copied')
  }

  /* ── Socials ───────────────────────────────────────────────────── */
  const socials = liveData?.socials || {}
  const explorerUrl = chain.explorer && address ? chain.explorer.url(address) : null

  return (
    <section className="mph" aria-label="Token header">
      <div className="mph-row1">
        <div className="mph-identity">
          {onBack && (
            <button
              type="button"
              className="mph-back"
              onClick={onBack}
              aria-label="Back to Discover"
            >
              <ChevronLeft size={17} strokeWidth={2.4} />
            </button>
          )}
          <span className="mph-logo-clip" aria-hidden="true">
            {logo ? (
              <img
                src={logo}
                alt=""
                className="mph-logo"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <span className="mph-logo mph-logo--fallback">
                {(symbol[0] || '?').toUpperCase()}
              </span>
            )}
          </span>

          <div className="mph-identity-text">
            {/* Line 1: SYMBOL /CHAIN + heart (GMGN puts the star inline) */}
            <span className="mph-nameline">
              <span className="mph-symbol" title={name}>{symbol}</span>
              <span className="mph-chain" title={chain.name}>/{chain.code}</span>
              <button
                type="button"
                className={`mph-heart ${inWatchlist ? 'is-on' : ''}`}
                aria-label={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                aria-pressed={inWatchlist}
                onClick={toggleStar}
              >
                <Heart size={16} strokeWidth={2.2} fill={inWatchlist ? 'currentColor' : 'none'} />
              </button>
              {onOpenAlerts && (
                <button
                  type="button"
                  className={`mph-bell${alertCount > 0 ? ' has-alerts' : ''}`}
                  onClick={onOpenAlerts}
                  aria-label="Price alerts"
                >
                  <Bell size={15} strokeWidth={2} />
                  {alertCount > 0 && <span className="mph-bell-badge">{alertCount}</span>}
                </button>
              )}
            </span>

            {/* Line 2: age · CA copy · tiny link icons (GMGN meta line) */}
            <span className="mph-metaline">
              {age && <span className="mph-age">{age}</span>}
              {address && (
                <button
                  type="button"
                  className="mph-ca"
                  onClick={handleCopy}
                  aria-label="Copy contract address"
                  title={address}
                >
                  <span className="mph-ca-addr">{truncAddr(address)}</span>
                  <Copy size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
              {socials.twitter && (
                <a className="mph-mlink" href={socials.twitter} target="_blank" rel="noopener noreferrer" aria-label="X / Twitter">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
              )}
              {socials.telegram && (
                <a className="mph-mlink" href={socials.telegram} target="_blank" rel="noopener noreferrer" aria-label="Telegram">
                  <TelegramGlyph size={14} />
                </a>
              )}
              {socials.website && (
                <a className="mph-mlink" href={socials.website} target="_blank" rel="noopener noreferrer" aria-label="Website">
                  <Globe size={14} strokeWidth={2.2} />
                </a>
              )}
              {explorerUrl && (
                <a className="mph-mlink" href={explorerUrl} target="_blank" rel="noopener noreferrer" aria-label={chain.explorer.name}>
                  <ExternalLink size={14} strokeWidth={2.2} />
                </a>
              )}
            </span>
          </div>
        </div>

        {/* Right: live price big (colored, flash), MCap small under it. */}
        <div className="mph-price-main">
          {!dataReady ? (
            <>
              <span className="mph-shimmer mph-shimmer--big animate-shimmer" aria-hidden="true" />
              <span className="mph-shimmer mph-shimmer--sub animate-shimmer" aria-hidden="true" />
            </>
          ) : (
            <>
              <span
                className={[
                  'mph-big',
                  `mph-big--${bullBear}`,
                  // Long strings ($0.00006998, $123,456.78) step the size down
                  // instead of eating the token name's width.
                  priceText.length >= 11 ? 'mph-big--long' : '',
                  priceFlash ? `mph-big--flash-${priceFlash}` : '',
                ].filter(Boolean).join(' ')}
              >
                {priceText}
              </span>
              {marketCap ? (
                <span className="mph-price-sub">
                  <span className="mph-price-sub-label">MC</span>
                  <span className="mph-price-sub-value">{fmtCompact(marketCap)}</span>
                </span>
              ) : change24h != null && (
                <span className={`mph-price-sub-value mph-price-sub-value--${bullBear}`}>
                  {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Perf tiles — GMGN single-line tinted blocks. Shimmer while cold. */}
      <div className="mph-perf" role="group" aria-label="Performance">
        {!dataReady ? (
          <>
            <span className="mph-shimmer mph-shimmer--tile animate-shimmer" aria-hidden="true" />
            <span className="mph-shimmer mph-shimmer--tile animate-shimmer" aria-hidden="true" />
            <span className="mph-shimmer mph-shimmer--tile animate-shimmer" aria-hidden="true" />
            <span className="mph-shimmer mph-shimmer--tile animate-shimmer" aria-hidden="true" />
          </>
        ) : (
          <>
            <PerfTile label="5m" change={change5m} />
            <PerfTile label="1h" change={change1h} />
            <PerfTile label="4h" change={change4h} />
            <PerfTile label="24h" change={change24h} />
          </>
        )}
      </div>
    </section>
  )
}
