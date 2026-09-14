import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import useZIGTvlHistory, { DEFAULT_EXTRAS } from '../hooks/useZIGTvlHistory'

const RANGES = ['7D', '30D', '90D', '1Y', 'ALL']

// Pulled inside component so labels/hints can be translated via the live i18n lang.
function buildExtraDefs(t) {
  return [
    { key: 'liquidstaking', label: t('zigchainChrome.tvl.extras.liquidStaking', 'Liquid Staking'), hint: t('zigchainChrome.tvl.extras.liquidStakingHint', 'TVL locked in liquid-staking protocols on ZIGChain') },
    { key: 'doublecounted', label: t('zigchainChrome.tvl.extras.doubleCount', 'Double Count'), hint: t('zigchainChrome.tvl.extras.doubleCountHint', 'Protocols whose TVL is counted by another protocol on the chain') },
    { key: 'borrowed', label: t('zigchainChrome.tvl.extras.activeLoans', 'Active Loans'), hint: t('zigchainChrome.tvl.extras.activeLoansHint', 'Outstanding borrows across lending markets on the chain') },
  ]
}

// Color presets for the chart line+fill. User can pick.
// `nameKey` resolves through i18n at render time so swatch labels follow the active locale.
const COLOR_PRESETS = {
  blue:  { nameKey: 'zigchainChrome.color.zigBlue', nameDefault: 'ZIG blue',  rgb: '59,130,246',  swatch: 'linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%)' },
  white: { nameKey: 'zigchainChrome.color.white',   nameDefault: 'White',     rgb: '245,245,247', swatch: 'linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)' },
  green: { nameKey: 'zigchainChrome.color.bull',    nameDefault: 'Bull',      rgb: '52,211,153',  swatch: 'linear-gradient(135deg, #34D399 0%, #059669 100%)' },
  amber: { nameKey: 'zigchainChrome.color.amber',   nameDefault: 'Amber',     rgb: '251,191,36',  swatch: 'linear-gradient(135deg, #FBBF24 0%, #D97706 100%)' },
  violet:{ nameKey: 'zigchainChrome.color.violet',  nameDefault: 'Violet',    rgb: '167,139,250', swatch: 'linear-gradient(135deg, #A78BFA 0%, #6366F1 100%)' },
}
const COLOR_KEYS = Object.keys(COLOR_PRESETS)
const STORAGE_KEY = 'zigchain-tvl-color'

const fmtTvl = (v) => {
  if (!Number.isFinite(v)) return '...'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '--')

const fmtDate = (ts) => new Intl.DateTimeFormat(i18n.language || 'en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ts * 1000))
const fmtAxisDate = (ts) => new Intl.DateTimeFormat(i18n.language || 'en', { month: 'short', day: 'numeric' }).format(new Date(ts * 1000))

/* Monotone cubic (Fritsch-Carlson) — smooth curve that never overshoots the
   data, so the line can't dip below the real low or spike above the real high. */
function smoothLine(xs, ys) {
  const n = xs.length
  if (n < 2) return ''
  if (n === 2) return `M${xs[0].toFixed(2)},${ys[0].toFixed(2)} L${xs[1].toFixed(2)},${ys[1].toFixed(2)}`
  const dx = [], dy = [], m = []
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i]; dy[i] = ys[i + 1] - ys[i]; m[i] = dy[i] / dx[i] }
  const t = new Array(n)
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], hyp = Math.hypot(a, b)
    if (hyp > 3) { const k = 3 / hyp; t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const x1 = xs[i] + dx[i] / 3, y1 = ys[i] + t[i] * dx[i] / 3
    const x2 = xs[i + 1] - dx[i] / 3, y2 = ys[i + 1] - t[i + 1] * dx[i] / 3
    d += ` C${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`
  }
  return d
}

function buildPath(points, w, h, padL, padR, padT, padB) {
  if (points.length < 2) return { line: '', area: '' }
  const xs = points.map((_, i) => padL + (i / (points.length - 1)) * (w - padL - padR))
  const tvls = points.map((p) => p.tvl)
  const minV = Math.min(...tvls)
  const maxV = Math.max(...tvls)
  const span = maxV - minV || 1
  const ys = tvls.map((v) => h - padB - ((v - minV) / span) * (h - padT - padB))
  const line = smoothLine(xs, ys)
  const area = `${line} L${xs[xs.length - 1].toFixed(2)},${(h - padB).toFixed(2)} L${xs[0].toFixed(2)},${(h - padB).toFixed(2)} Z`
  return { line, area, xs, ys, minV, maxV }
}

export default function ZigTvlChart({ extras: extrasProp, onExtrasChange }) {
  const { t } = useTranslation()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const [range, setRange] = useState('90D')
  const extras = extrasProp || DEFAULT_EXTRAS
  const setExtras = useCallback((next) => {
    if (onExtrasChange) onExtrasChange(next)
  }, [onExtrasChange])
  const [extrasOpen, setExtrasOpen] = useState(false)
  const extrasRef = useRef(null)
  useEffect(() => {
    if (!extrasOpen) return undefined
    const onDoc = (e) => {
      if (!extrasRef.current) return
      if (!extrasRef.current.contains(e.target)) setExtrasOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [extrasOpen])
  const EXTRA_DEFS_LOCAL = useMemo(() => buildExtraDefs(t), [t])
  const activeExtras = EXTRA_DEFS_LOCAL.filter((d) => extras[d.key])
  const otherCount = Math.max(activeExtras.length - 1, 0)
  const extrasSummary = activeExtras.length === EXTRA_DEFS_LOCAL.length
    ? t('zigchainChrome.tvl.summary.allExtras', 'all extras')
    : activeExtras.length === 0
      ? t('zigchainChrome.tvl.summary.bareTvl', 'bare TVL')
      : activeExtras.length === 1
        ? activeExtras[0].label.toLowerCase()
        : otherCount === 1
          ? t('zigchainChrome.tvl.summary.plusOther', '{{first}} + {{count}} other', { first: activeExtras[0].label.toLowerCase(), count: otherCount })
          : t('zigchainChrome.tvl.summary.plusOthers', '{{first}} + {{count}} others', { first: activeExtras[0].label.toLowerCase(), count: otherCount })
  const toggleExtra = (key) => setExtras({ ...extras, [key]: !extras[key] })
  const setAllExtras = (val) => setExtras(EXTRA_DEFS_LOCAL.reduce((acc, d) => ({ ...acc, [d.key]: val }), {}))
  const [colorKey, setColorKey] = useState(() => {
    if (typeof window === 'undefined') return 'blue'
    const stored = window.localStorage?.getItem(STORAGE_KEY)
    return stored && COLOR_PRESETS[stored] ? stored : 'blue'
  })
  const color = COLOR_PRESETS[colorKey] || COLOR_PRESETS.blue
  const accentRgb = color.rgb

  const setColor = (key) => {
    setColorKey(key)
    try { window.localStorage?.setItem(STORAGE_KEY, key) } catch (_) {}
  }

  const { points, loading, error, stats } = useZIGTvlHistory(range, { extras })

  const W = 1200
  const H = 320
  // The Y-axis label gutter and X-axis label band are reserved in CSS pixels
  // (see .ztvl-svg). The data fills the SVG; only small in-viewBox padding here.
  const PAD_L = 0
  const PAD_R = 0
  const PAD_T = 14   // top headroom so the peak/marker isn't clipped
  const PAD_B = 18   // breathing room above the reserved X-axis band

  const geom = useMemo(() => buildPath(points, W, H, PAD_L, PAD_R, PAD_T, PAD_B), [points])
  const wrapRef = useRef(null)
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
    // Pixel position of the point within the SVG (== within the canvas, since the
    // SVG sits at the canvas top-left). Used to anchor the HTML tooltip to the point.
    const pxX = (geom.xs[nearest] / W) * rect.width
    const pxY = (geom.ys[nearest] / H) * rect.height
    setHover({ i: nearest, x: geom.xs[nearest], y: geom.ys[nearest], px: pxX, py: pxY, point: points[nearest] })
  }, [geom, points])
  const onLeave = useCallback(() => setHover(null), [])

  const ticks = useMemo(() => {
    if (!points.length) return []
    const n = Math.min(4, points.length)
    const out = []
    for (let i = 0; i < n; i++) {
      const idx = Math.round((i / (n - 1)) * (points.length - 1))
      out.push(points[idx])
    }
    return out
  }, [points])

  const yLabels = useMemo(() => {
    if (!geom || !Number.isFinite(geom.minV)) return []
    const n = 4
    const out = []
    for (let i = 0; i < n; i++) {
      const v = geom.minV + ((geom.maxV - geom.minV) * i) / (n - 1)
      const y = H - PAD_B - ((v - geom.minV) / (geom.maxV - geom.minV || 1)) * (H - PAD_T - PAD_B)
      out.push({ v, y })
    }
    return out
  }, [geom])

  const headerVal = stats ? fmtTvl(stats.current) : null
  const headerDelta = stats ? stats.change : null
  const headerBull = (headerDelta ?? 0) >= 0

  // Average TVL over the visible range (for the footer cell).
  const avgTvl = useMemo(() => {
    if (!points.length) return null
    const sum = points.reduce((a, p) => a + p.tvl, 0)
    return sum / points.length
  }, [points])

  return (
    <div className="ztvl" ref={wrapRef}>
      <div className="ztvl-head">
        <div className="ztvl-id">
          <span className="ztvl-label">{t('zigchainChrome.stat.tvl', 'Total Value Locked')}</span>
          <span className="ztvl-stat-value">{loading ? '...' : headerVal}</span>
          {headerDelta != null && (
            <span className={`ztvl-stat-delta ${headerBull ? 'up' : 'dn'}`}>
              {fmtPct(headerDelta)}
              <span className="ztvl-stat-range">{range === 'ALL' ? t('zigchainChrome.range.allTime', 'all-time') : t('zigchainChrome.range.lastRange', 'last {{range}}', { range: range.toLowerCase() })}</span>
            </span>
          )}
        </div>
        <div className="ztvl-controls">
          <div className="ztvl-extras" ref={extrasRef}>
            <button
              type="button"
              className={`ztvl-extras-trigger${extrasOpen ? ' is-on' : ''}`}
              onClick={() => setExtrasOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={extrasOpen}
            >
              <span className="ztvl-extras-trigger-l">{t('zigchainChrome.tvl.includeInTvl', 'Include in TVL')}</span>
              <span className="ztvl-extras-trigger-v">{extrasSummary}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {extrasOpen && (
              <div className="ztvl-extras-menu" role="menu">
                <div className="ztvl-extras-menu-head">
                  <button type="button" className="ztvl-extras-bulk" onClick={() => setAllExtras(false)}>{t('zigchainChrome.action.deselectAll', 'Deselect All')}</button>
                  <button type="button" className="ztvl-extras-bulk" onClick={() => setAllExtras(true)}>{t('zigchainChrome.action.selectAll', 'Select All')}</button>
                </div>
                {EXTRA_DEFS_LOCAL.map((d) => (
                  <label key={d.key} className={`ztvl-extras-row${extras[d.key] ? ' is-on' : ''}`} title={d.hint}>
                    <span className="ztvl-extras-row-l">{d.label}</span>
                    <input type="checkbox" checked={!!extras[d.key]} onChange={() => toggleExtra(d.key)} />
                    <span className="ztvl-extras-check" aria-hidden>
                      {extras[d.key] && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="ztvl-colors" role="tablist" aria-label={t('zigchainChrome.aria.chartColor', 'Chart color')}>
            {COLOR_KEYS.map((k) => {
              const c = COLOR_PRESETS[k]
              const cName = t(c.nameKey, c.nameDefault)
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected={colorKey === k}
                  aria-label={cName}
                  title={cName}
                  className={`ztvl-color${colorKey === k ? ' is-on' : ''}`}
                  onClick={() => setColor(k)}
                  style={{ background: c.swatch }}
                />
              )
            })}
          </div>
          <div className="ztvl-ranges" role="tablist" aria-label={t('zigchainChrome.aria.tvlTimeframe', 'TVL timeframe')}>
            {RANGES.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={range === r}
                className={`ztvl-range${range === r ? ' is-on' : ''}`}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ztvl-canvas">
        {loading && !points.length && (
          <div className="ztvl-skeleton" aria-hidden>
            <div className="ztvl-skel-shimmer" />
          </div>
        )}

        {!loading && error && (
          <div className="ztvl-empty">{t('zigchainChrome.empty.tvlHistoryUnavailable', 'TVL history unavailable')}</div>
        )}

        {points.length >= 2 && geom?.line && (
          <>
            <svg
              className="ztvl-svg"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              onMouseMove={onMove}
              onMouseLeave={onLeave}
            >
              <defs>
                <linearGradient id="ztvlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={`rgba(${accentRgb}, 0.28)`} />
                  <stop offset="55%" stopColor={`rgba(${accentRgb}, 0.08)`} />
                  <stop offset="100%" stopColor={`rgba(${accentRgb}, 0)`} />
                </linearGradient>
                <linearGradient id="ztvlStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={`rgba(${accentRgb}, 0.55)`} />
                  <stop offset="60%" stopColor={`rgba(${accentRgb}, 0.9)`} />
                  <stop offset="100%" stopColor={`rgba(${accentRgb}, 1)`} />
                </linearGradient>
                <filter id="ztvlGlow" x="-20%" y="-40%" width="140%" height="180%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Subtle horizontal gridlines + a brighter baseline at the lowest tick */}
              {yLabels.map((g, i) => (
                <line
                  key={i}
                  x1={PAD_L} x2={W - PAD_R}
                  y1={g.y} y2={g.y}
                  stroke={dayMode
                    ? (i === 0 ? 'rgba(15,23,42,0.18)' : 'rgba(15,23,42,0.08)')
                    : (i === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)')}
                  strokeWidth="1"
                  strokeDasharray={i === 0 ? '' : '2 4'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              <path d={geom.area} fill="url(#ztvlFill)" />
              <path
                d={geom.line}
                fill="none"
                stroke="url(#ztvlStroke)"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                filter="url(#ztvlGlow)"
              />

              {/* Latest-value marker — pulsing dot anchored at the most recent point */}
              {geom.xs?.length > 1 && !hover && (
                <g>
                  <circle
                    cx={geom.xs[geom.xs.length - 1]}
                    cy={geom.ys[geom.ys.length - 1]}
                    r="5"
                    fill={`rgb(${accentRgb})`}
                    opacity="0.25"
                    vectorEffect="non-scaling-stroke"
                  >
                    <animate attributeName="r" values="4;9;4" dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite" />
                  </circle>
                  <circle
                    cx={geom.xs[geom.xs.length - 1]}
                    cy={geom.ys[geom.ys.length - 1]}
                    r="3.5"
                    fill={`rgb(${accentRgb})`}
                    stroke={dayMode ? '#ffffff' : '#0d0d10'}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              {hover && (
                <>
                  <line
                    x1={hover.x} x2={hover.x}
                    y1={PAD_T / 2} y2={H - PAD_B}
                    stroke={dayMode ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.18)'}
                    strokeDasharray="2 4"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={hover.x} cy={hover.y} r="4" fill={`rgb(${accentRgb})`} stroke={dayMode ? '#ffffff' : '#0d0d10'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </>
              )}
            </svg>

            {/* Y-axis labels — HTML overlay anchored to the right inside the card */}
            <div className="ztvl-yaxis" aria-hidden>
              {yLabels.map((g, i) => (
                <span
                  key={`yh-${i}`}
                  className="ztvl-yaxis-label"
                  style={{ top: `${(g.y / H) * 100}%` }}
                >
                  {fmtTvl(g.v)}
                </span>
              ))}
            </div>

            {/* X-axis labels — HTML overlay along the bottom */}
            <div className="ztvl-xaxis" aria-hidden>
              {ticks.map((t, i) => (
                <span
                  key={`xh-${i}`}
                  className="ztvl-xaxis-label"
                  style={{
                    left: `${(i / (ticks.length - 1)) * 100}%`,
                    transform: i === 0 ? 'translateX(0)' : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                  }}
                >
                  {fmtAxisDate(t.ts)}
                </span>
              ))}
            </div>
          </>
        )}

        {hover && hover.point && (
          <div
            className={`ztvl-tooltip${hover.py < 72 ? ' is-below' : ''}`}
            style={{ left: `${Math.max(58, hover.px)}px`, top: `${hover.py}px` }}
          >
            <span className="ztvl-tip-date">{fmtDate(hover.point.ts)}</span>
            <span className="ztvl-tip-val">{fmtTvl(hover.point.tvl)}</span>
          </div>
        )}
      </div>

      {stats && (
        <div className="ztvl-foot">
          <div className="ztvl-foot-cell">
            <span className="ztvl-foot-l">{t('zigchainChrome.tvl.footHigh', 'High ({{date}})', { date: fmtAxisDate(stats.max.ts) })}</span>
            <span className="ztvl-foot-v">{fmtTvl(stats.max.tvl)}</span>
          </div>
          <div className="ztvl-foot-cell">
            <span className="ztvl-foot-l">{t('zigchainChrome.tvl.footLow', 'Low ({{date}})', { date: fmtAxisDate(stats.min.ts) })}</span>
            <span className="ztvl-foot-v">{fmtTvl(stats.min.tvl)}</span>
          </div>
          <div className="ztvl-foot-cell">
            <span className="ztvl-foot-l">{t('zigchainChrome.tvl.footAvg', 'Avg TVL ({{range}})', { range })}</span>
            <span className="ztvl-foot-v">{fmtTvl(avgTvl)}</span>
          </div>
          <div className="ztvl-foot-cell">
            <span className="ztvl-foot-l">{t('zigchainChrome.tvl.footDataPoints', 'Data points')}</span>
            <span className="ztvl-foot-v">{stats.count}<span className="ztvl-foot-sub">{t('zigchainChrome.tvl.footDaily', 'daily')}</span></span>
          </div>
        </div>
      )}
    </div>
  )
}
