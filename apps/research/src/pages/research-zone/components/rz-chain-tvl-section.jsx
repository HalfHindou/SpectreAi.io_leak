/**
 * Research Zone — Chain TVL section
 *
 * Project-specific. Only renders for tokens that map to a DefiLlama chain.
 * For ZIG → ZIGChain we surface the daily chain TVL history (via
 * /data-api/v1/defi/chains/ZIGChain/history) inside the cinema layout.
 *
 * The data path is the same as `apps/research/src/pages/zigchain` —
 * the worker `zigchain-tvl-tracker` keeps `chain_tvl_history` warm.
 */
import React, { useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useZIGTvlHistory from '@/pages/zigchain/hooks/useZIGTvlHistory'
import './rz-chain-tvl-section.css'

const RANGES = ['30D', '90D', '1Y', 'ALL']

// Token symbol → DefiLlama chain entry. Extend as new project chains land.
// `accent` is reserved for future per-chain atmospheric tints; the chart itself
// stays warm-white per the design system.
const SYMBOL_TO_CHAIN = {
  ZIG: { name: 'ZIGChain', slug: 'zigchain', accent: '245, 245, 247' },
}

const fmtTvl = (v) => {
  if (!Number.isFinite(v)) return '...'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}
const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '--')
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtAxisDate = (ts) => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function buildPath(points, w, h, padX, padY) {
  if (points.length < 2) return null
  const xs = points.map((_, i) => padX + (i / (points.length - 1)) * (w - padX * 2))
  const tvls = points.map((p) => p.tvl)
  const minV = Math.min(...tvls)
  const maxV = Math.max(...tvls)
  const span = maxV - minV || 1
  const ys = tvls.map((v) => h - padY - ((v - minV) / span) * (h - padY * 2))
  const segs = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${ys[i].toFixed(2)}`)
  const line = segs.join(' ')
  const area = `${line} L${xs[xs.length - 1].toFixed(2)},${(h - padY).toFixed(2)} L${xs[0].toFixed(2)},${(h - padY).toFixed(2)} Z`
  return { line, area, xs, ys, minV, maxV }
}

function RzChainTvlSection({ sym }) {
  const symbol = String(sym || '').toUpperCase()
  const chain = SYMBOL_TO_CHAIN[symbol]
  if (!chain) return null

  return <RzChainTvlInner chain={chain} />
}

// React.memo so parent price ticks don't re-render the TVL section (its only
// input is the stable `sym`). The hover handler is plain setState fired on
// mousemove - no rAF loop runs, so no document.hidden guard is needed here.
export default React.memo(RzChainTvlSection)

function RzChainTvlInner({ chain }) {
  const { t } = useTranslation()
  const [range, setRange] = useState('90D')
  const { points, loading, error, stats } = useZIGTvlHistory(range)

  const W = 1100
  const H = 240
  const PAD_X = 12
  const PAD_Y = 22

  const geom = useMemo(() => buildPath(points, W, H, PAD_X, PAD_Y), [points])
  const ref = useRef(null)
  const [hover, setHover] = useState(null)

  const onMove = useCallback((e) => {
    if (!geom?.xs || geom.xs.length < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    let nearest = 0, best = Infinity
    for (let i = 0; i < geom.xs.length; i++) {
      const d = Math.abs(geom.xs[i] - px)
      if (d < best) { best = d; nearest = i }
    }
    setHover({ i: nearest, x: geom.xs[nearest], y: geom.ys[nearest], point: points[nearest] })
  }, [geom, points])
  const onLeave = useCallback(() => setHover(null), [])

  const headerVal = stats ? fmtTvl(stats.current) : null
  const headerDelta = stats?.change ?? null
  const bull = (headerDelta ?? 0) >= 0

  return (
    <section className="cine-section cine-in rz-cht" ref={ref} style={{ '--rz-cht-rgb': chain.accent }}>
      <header className="cine-section-head">
        <div className="cine-section-head-l">
          <span className="cine-eyebrow">CHAIN · TVL</span>
          <h2 className="cine-section-title">{chain.name} Total Value Locked</h2>
          <p className="cine-section-sub">{t('researchPro.chainTvlSection.rzchaintvlinner.defiCapitalDeployedOnTheC', "DeFi capital deployed on the chain. Daily history.")}</p>
        </div>
        <div className="rz-cht-ranges" role="tablist" aria-label={t('researchPro.chainTvlSection.rzchaintvlinner.ariaChainTvlTimeframe', "Chain TVL timeframe")}>
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              className={`rz-cht-range${range === r ? ' is-on' : ''}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      <div className="rz-cht-card">
        <div className="rz-cht-stat">
          <div className="rz-cht-stat-block">
            <span className="rz-cht-stat-label">{t('researchPro.chainTvlSection.rzchaintvlinner.tvl', "TVL")}</span>
            <span className="rz-cht-stat-value">{loading ? '...' : headerVal}</span>
          </div>
          {headerDelta != null && (
            <div className={`rz-cht-stat-block rz-cht-stat-delta ${bull ? 'up' : 'dn'}`}>
              <span className="rz-cht-stat-label">{range === 'ALL' ? 'Since launch' : `Last ${range.toLowerCase()}`}</span>
              <span className="rz-cht-stat-value">{fmtPct(headerDelta)}</span>
            </div>
          )}
          {stats && (
            <div className="rz-cht-stat-block">
              <span className="rz-cht-stat-label">High ({range})</span>
              <span className="rz-cht-stat-value">{fmtTvl(stats.max.tvl)}</span>
            </div>
          )}
          {stats && (
            <div className="rz-cht-stat-block">
              <span className="rz-cht-stat-label">Low ({range})</span>
              <span className="rz-cht-stat-value">{fmtTvl(stats.min.tvl)}</span>
            </div>
          )}
        </div>

        <div className="rz-cht-canvas">
          {loading && !points.length && <div className="rz-cht-skel"><div className="rz-cht-skel-bar" /></div>}
          {!loading && error && <div className="rz-cht-empty">{t('researchPro.chainTvlSection.rzchaintvlinner.tvlHistoryUnavailable', "TVL history unavailable")}</div>}
          {points.length >= 2 && geom && (
            <svg className="rz-cht-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={onLeave}>
              <defs>
                <linearGradient id="rzChtFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={`rgba(${chain.accent}, 0.22)`} />
                  <stop offset="100%" stopColor={`rgba(${chain.accent}, 0)`} />
                </linearGradient>
              </defs>
              <path d={geom.area} fill="url(#rzChtFill)" />
              <path d={geom.line} fill="none" stroke={`rgba(${chain.accent}, 0.95)`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {hover && (
                <>
                  <line x1={hover.x} x2={hover.x} y1={PAD_Y / 2} y2={H - PAD_Y} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 4" strokeWidth="1" />
                  <circle cx={hover.x} cy={hover.y} r="4" fill={`rgba(${chain.accent}, 1)`} stroke="#0d0d10" strokeWidth="2" />
                </>
              )}
            </svg>
          )}
          {hover && hover.point && (
            <div className="rz-cht-tip" style={{ left: `${(hover.x / W) * 100}%` }}>
              <span className="rz-cht-tip-d">{fmtDate(hover.point.ts)}</span>
              <span className="rz-cht-tip-v">{fmtTvl(hover.point.tvl)}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
