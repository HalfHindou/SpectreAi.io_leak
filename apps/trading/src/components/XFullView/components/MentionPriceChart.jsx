import { memo, useEffect, useMemo, useRef, useState } from 'react'

/**
 * MentionPriceChart — "PRICE · KOL MENTIONS" view of X Charts.
 *
 * An SVG price area chart with each KOL's tweet plotted as an avatar marker at
 * the (time, price) it landed. Mirrors the research X Bubbles "Chart" toggle:
 * price line + KOL mention bubbles, click a bubble to open the tweet.
 *
 * Props:
 *   cgId      X Dash / CoinGecko id (e.g. the-black-bull)
 *   mentions  raw X Dash top_mentions[]  ({ tweet, author })
 *   token     current token (symbol fallback)
 */

const RANGES = [
  { key: '24h', label: '24H', days: 1 },
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
]

// Voice-type legend colors (reference only — shown in the legend, not on the
// bubbles, which stay warm-white to keep the surface on-brand).
const VOICES = [
  { key: 'official', label: 'Official', color: '#5AA6FF' },
  { key: 'commentator', label: 'Commentator', color: '#4FD18B' },
  { key: 'promoter', label: 'Promoter', color: '#FF9046' },
  { key: 'media', label: 'Media', color: '#9B7CE6' },
]

const HEIGHT = 380
const PAD = { l: 10, r: 58, t: 18, b: 26 }

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function fmtPrice(p) {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1) return `$${p.toFixed(2)}`
  if (p >= 0.01) return `$${p.toFixed(4)}`
  if (p >= 0.0001) return `$${p.toFixed(6)}`
  return `$${p.toExponential(2)}`
}

function fmtCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function priceAt(prices, ts) {
  if (!prices.length) return null
  if (ts <= prices[0][0]) return prices[0][1]
  if (ts >= prices[prices.length - 1][0]) return prices[prices.length - 1][1]
  let lo = 0, hi = prices.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (prices[mid][0] < ts) lo = mid
    else hi = mid
  }
  const [t0, p0] = prices[lo]
  const [t1, p1] = prices[hi]
  const f = (ts - t0) / Math.max(1, t1 - t0)
  return p0 + (p1 - p0) * f
}

function MentionPriceChart({ cgId, mentions, token }) {
  const wrapRef = useRef(null)
  const [range, setRange] = useState('7d')
  const [data, setData] = useState({ prices: null, loading: true })
  const [w, setW] = useState(720)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => setW(Math.max(320, Math.floor(el.getBoundingClientRect().width)))
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!cgId) { setData({ prices: null, loading: false }); return }
    let cancelled = false
    setData((d) => ({ prices: d.prices, loading: true }))
    const days = RANGES.find((r) => r.key === range)?.days || 7
    fetch(`/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return
        const prices = Array.isArray(json?.prices) ? json.prices : null
        setData({ prices, loading: false })
      })
      .catch(() => { if (!cancelled) setData({ prices: null, loading: false }) })
    return () => { cancelled = true }
  }, [cgId, range])

  // Normalize mentions once.
  const norm = useMemo(() => {
    const arr = Array.isArray(mentions) ? mentions : []
    return arr
      .map((m) => {
        const tw = m.tweet || {}
        const au = m.author || {}
        const ts = tw.created_at_utc ? Date.parse(tw.created_at_utc) : NaN
        return {
          id: tw.tweet_id,
          ts,
          url: tw.x_url,
          name: au.name || au.screen_name,
          handle: au.screen_name,
          followers: num(au.followers_count),
          avatar: (au.avatar_image_url || '').replace('_normal', '_200x200'),
          cls: au.author_class || null,
        }
      })
      .filter((m) => m.id && Number.isFinite(m.ts))
  }, [mentions])

  const geom = useMemo(() => {
    const prices = data.prices
    if (!prices || prices.length < 2) return null
    const innerW = w - PAD.l - PAD.r
    const innerH = HEIGHT - PAD.t - PAD.b
    const tMin = prices[0][0]
    const tMax = prices[prices.length - 1][0]
    let pMin = Infinity, pMax = -Infinity
    for (const [, p] of prices) { if (p < pMin) pMin = p; if (p > pMax) pMax = p }
    const pad = (pMax - pMin) * 0.08 || pMax * 0.08 || 1
    pMin = Math.max(0, pMin - pad)
    pMax = pMax + pad
    const tToX = (t) => PAD.l + ((t - tMin) / Math.max(1, tMax - tMin)) * innerW
    const pToY = (p) => PAD.t + innerH - ((p - pMin) / Math.max(1e-12, pMax - pMin)) * innerH
    const baseY = PAD.t + innerH

    let line = '', area = ''
    prices.forEach(([t, p], i) => {
      const x = tToX(t).toFixed(1)
      const y = pToY(p).toFixed(1)
      line += `${i === 0 ? 'M' : 'L'}${x} ${y} `
    })
    const x0 = tToX(prices[0][0]).toFixed(1)
    const xN = tToX(prices[prices.length - 1][0]).toFixed(1)
    area = `${line}L${xN} ${baseY} L${x0} ${baseY} Z`

    // markers in range, stacked to avoid overlap
    const markers = norm
      .filter((m) => m.ts >= tMin && m.ts <= tMax)
      .sort((a, b) => a.ts - b.ts)
    const maxF = Math.max(1, ...markers.map((m) => m.followers))
    const placed = []
    for (const m of markers) {
      const price = priceAt(prices, m.ts)
      const px = tToX(m.ts)
      const ppy = pToY(price)
      const r = 9 + 9 * Math.sqrt(m.followers / maxF)
      let y = ppy - r - 4
      // nudge up if colliding with a recent placed marker
      for (let k = placed.length - 1; k >= 0 && k >= placed.length - 8; k--) {
        const o = placed[k]
        if (Math.abs(o.px - px) < o.r + r + 2 && Math.abs(o.y - y) < o.r + r + 2) {
          y = o.y - (o.r + r + 3)
        }
      }
      placed.push({ ...m, px, ppy, y: Math.max(PAD.t + r, y), r, price })
    }

    const up = prices[prices.length - 1][1] >= prices[0][1]
    const ticks = [pMax, pMin + (pMax - pMin) * 0.5, pMin]
    return { tToX, pToY, baseY, line, area, markers: placed, up, pMin, pMax, tMin, tMax, ticks, innerH }
  }, [data.prices, norm, w])

  const lastPrice = data.prices?.[data.prices.length - 1]?.[1]
  const firstPrice = data.prices?.[0]?.[1]
  const changePct = firstPrice && lastPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : null
  const up = geom?.up
  const stroke = up ? '#10B981' : '#EF4444'

  return (
    <div className="xmc" ref={wrapRef}>
      <div className="xmc-head">
        <div className="xmc-title">
          <span className="xmc-title-lbl">PRICE · KOL MENTIONS</span>
          {Number.isFinite(lastPrice) && <span className="xmc-price">{fmtPrice(lastPrice)}</span>}
          {Number.isFinite(changePct) && (
            <span className={`xmc-chg ${changePct >= 0 ? 'up' : 'down'}`}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="xmc-ranges">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`xmc-range-btn${range === r.key ? ' is-active' : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="xmc-stage" style={{ height: HEIGHT }}>
        {data.loading && !geom && <div className="xmc-loading">Loading price…</div>}
        {!data.loading && !geom && <div className="xmc-loading">Price history unavailable.</div>}
        {geom && (
          <svg className="xmc-svg" viewBox={`0 0 ${w} ${HEIGHT}`} width={w} height={HEIGHT}>
            <defs>
              <linearGradient id="xmc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* price grid labels (right) */}
            {geom.ticks.map((p, i) => {
              const y = geom.pToY(p)
              return (
                <g key={i}>
                  <line x1={PAD.l} y1={y} x2={w - PAD.r} y2={y} stroke="rgba(255,255,255,0.04)" />
                  <text x={w - PAD.r + 6} y={y + 3} className="xmc-axis">{fmtPrice(p)}</text>
                </g>
              )
            })}

            <path d={geom.area} fill="url(#xmc-fill)" />
            <path d={geom.line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />

            {/* time labels */}
            {[0, 0.5, 1].map((f, i) => {
              const t = geom.tMin + (geom.tMax - geom.tMin) * f
              const x = geom.tToX(t)
              const d = new Date(t)
              const lbl = range === '24h'
                ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                : `${d.getMonth() + 1}/${d.getDate()}`
              return <text key={i} x={x} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="xmc-axis">{lbl}</text>
            })}

            {/* mention markers */}
            {geom.markers.map((m, i) => {
              const hovered = hover?.id === m.id
              return (
                <g
                  key={m.id || i}
                  className="xmc-marker"
                  onMouseEnter={(e) => setHover({ ...m, mx: e.nativeEvent.offsetX, my: e.nativeEvent.offsetY })}
                  onMouseMove={(e) => setHover((h) => (h && h.id === m.id ? { ...h, mx: e.nativeEvent.offsetX, my: e.nativeEvent.offsetY } : h))}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => m.url && window.open(m.url, '_blank', 'noopener,noreferrer')}
                  style={{ cursor: 'pointer' }}
                >
                  <line x1={m.px} y1={m.ppy} x2={m.px} y2={m.y} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
                  <circle cx={m.px} cy={m.ppy} r="2.5" fill={stroke} />
                  <clipPath id={`xmc-clip-${i}`}>
                    <circle cx={m.px} cy={m.y} r={m.r} />
                  </clipPath>
                  <circle cx={m.px} cy={m.y} r={m.r + 1.5} fill="rgba(10,10,12,0.9)" />
                  <image
                    href={m.avatar ? `/api/img-proxy?url=${encodeURIComponent(m.avatar)}` : undefined}
                    x={m.px - m.r}
                    y={m.y - m.r}
                    width={m.r * 2}
                    height={m.r * 2}
                    clipPath={`url(#xmc-clip-${i})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <circle
                    cx={m.px}
                    cy={m.y}
                    r={m.r}
                    fill="none"
                    stroke={hovered ? 'rgba(245,245,247,0.95)' : 'rgba(245,245,247,0.5)'}
                    strokeWidth={hovered ? 2 : 1.2}
                  />
                </g>
              )
            })}
          </svg>
        )}

        {/* legend */}
        {geom && (
          <div className="xmc-legend">
            <div className="xmc-legend-block">
              <div className="xmc-legend-title">Voices</div>
              <div className="xmc-legend-voices">
                {VOICES.map((v) => (
                  <span key={v.key} className="xmc-legend-voice">
                    <span className="xmc-legend-dot" style={{ background: v.color }} />
                    {v.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="xmc-legend-foot">Size = influence · click any to view tweet</div>
          </div>
        )}

        {/* hover tooltip */}
        {hover && (
          <div className="xmc-tip" style={{ left: Math.min(hover.mx + 14, w - 180), top: hover.my + 12 }}>
            <div className="xmc-tip-name">{hover.name}</div>
            <div className="xmc-tip-handle">@{hover.handle} · {fmtCompact(hover.followers)} followers</div>
            <div className="xmc-tip-price">{fmtPrice(hover.price)} at mention</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(MentionPriceChart)
