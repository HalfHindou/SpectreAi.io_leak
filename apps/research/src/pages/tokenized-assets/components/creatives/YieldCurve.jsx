import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './creative-base.css'
import './YieldCurve.css'

/**
 * YieldCurve — estimated APY curve across maturity buckets.
 * - 4 maturity buckets: 0-3M, 3-6M, 6-12M, 12M+
 * - APY is derived heuristically from the tab's maturity weights + a typical
 *   T-bill curve shape.
 * - The SVG (area + line + grid + benchmark) STRETCHES to the full plot width
 *   via preserveAspectRatio="none" + non-scaling strokes. Dots, value labels
 *   and axis labels are HTML overlays positioned by the SAME % coordinates, so
 *   they stay round / crisp and align perfectly with the curve. (The old square
 *   "meet" viewBox centred the curve while the full-width axis row drifted off.)
 */
const BUCKETS = [
  { id: '0-3M', label: '0-3M', apyBase: 5.25 },
  { id: '3-6M', label: '3-6M', apyBase: 5.10 },
  { id: '6-12M', label: '6-12M', apyBase: 4.85 },
  { id: '12M+',  label: '12M+', apyBase: 4.60 },
]

// Coordinate domain (0..100 user units = 0..100% of the plot box).
const PAD_X = 12          // left/right inset so dots aren't on the edge
const TOP = 14, BOT = 88  // vertical plot band (leaves room for value labels)
const APY_MIN = 3.0, APY_MAX = 6.0

const xFor = (i, n) => PAD_X + (i / Math.max(n - 1, 1)) * (100 - PAD_X * 2)
const yFor = (apy) => BOT - ((apy - APY_MIN) / (APY_MAX - APY_MIN)) * (BOT - TOP)

export default function YieldCurve({ buckets = [], loading }) {
  const { t } = useTranslation()
  const points = useMemo(() => {
    const totalTvl = buckets.reduce((s, b) => s + (b.value || 0), 0)
    return BUCKETS.map((bk) => {
      const match = buckets.find(b => b.id === bk.id)
      const share = totalTvl > 0 ? (match?.value || 0) / totalTvl : 0.25
      const apy = Math.max(0, bk.apyBase + (share - 0.25) * 1.2)
      return { ...bk, apy, tvl: match?.value || 0, share }
    })
  }, [buckets])

  const n = points.length

  // Smooth bezier path through the points.
  const pathD = useMemo(() => {
    if (!n) return ''
    const pts = points.map((p, i) => [xFor(i, n), yFor(p.apy)])
    let d = `M ${pts[0][0]} ${pts[0][1]}`
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      const mx = x0 + (x1 - x0) * 0.5
      d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`
    }
    return d
  }, [points, n])

  const areaD = useMemo(() => {
    if (!pathD) return ''
    return `${pathD} L ${xFor(n - 1, n)} ${BOT} L ${xFor(0, n)} ${BOT} Z`
  }, [pathD, n])

  const benchmarkY = yFor(4.5)

  return (
    <div className="ta-creative ta-yc">
      <div className="ta-creative__head">
        <span className="ta-creative__title">{t('tokenizedAssets.creatives.yieldCurve.title', 'Yield Curve')}</span>
        <span className="ta-creative__sub">{t('tokenizedAssets.creatives.yieldCurve.subtitle', 'Estimated APY · by maturity')}</span>
      </div>

      {loading ? (
        <div className="ta-yc__skel animate-shimmer" />
      ) : (
        <div className="ta-yc__wrap">
          <div className="ta-yc__plot">
            <svg
              className="ta-yc__svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={t('tokenizedAssets.creatives.yieldCurve.ariaLabel', 'Estimated APY by maturity bucket')}
            >
              <defs>
                <linearGradient id="ta-yc-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor="rgba(16, 185, 129, 0.30)" />
                  <stop offset="55%" stopColor="rgba(6, 182, 212, 0.12)" />
                  <stop offset="100%" stopColor="rgba(6, 182, 212, 0.0)" />
                </linearGradient>
                <linearGradient id="ta-yc-stroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#06B6D4" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>

              {/* Horizontal gridlines at key APY levels */}
              {[3, 4, 5, 6].map((apy) => (
                <line key={apy} x1="0" x2="100" y1={yFor(apy)} y2={yFor(apy)}
                  className="ta-yc__grid" vectorEffect="non-scaling-stroke" />
              ))}

              {/* Benchmark dashed line at 4.5% */}
              <line x1="0" x2="100" y1={benchmarkY} y2={benchmarkY}
                className="ta-yc__bench" vectorEffect="non-scaling-stroke" />

              {/* Area + curve */}
              <path d={areaD} fill="url(#ta-yc-fill)" className="ta-yc__area" />
              <path d={pathD} className="ta-yc__line" fill="none"
                stroke="url(#ta-yc-stroke)" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            {/* Benchmark label (HTML — crisp, no SVG stretch) */}
            <span className="ta-yc__bench-label" style={{ top: `${benchmarkY}%` }}>
              {t('tokenizedAssets.creatives.yieldCurve.tBillBenchmark', 'T-Bill 4.5%')}
            </span>

            {/* Dots + value labels (HTML overlays at matching % coords) */}
            {points.map((p, i) => (
              <div
                key={p.id}
                className={`ta-yc__node ta-yc__node--${i}`}
                style={{ left: `${xFor(i, n)}%`, top: `${yFor(p.apy)}%` }}
              >
                <span className="ta-yc__val mono">{p.apy.toFixed(2)}%</span>
                <span className="ta-yc__halo" />
                <span className="ta-yc__dot" />
              </div>
            ))}
          </div>

          {/* Axis row — same % coords as the dots */}
          <div className="ta-yc__axis-row" aria-hidden="true">
            {points.map((p, i) => (
              <span key={`ax-${p.id}`} className="ta-yc__axis-label" style={{ left: `${xFor(i, n)}%` }}>
                {p.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="ta-yc__note">{t('tokenizedAssets.creatives.yieldCurve.note', 'Estimated APY — derived from maturity mix')}</div>
    </div>
  )
}
