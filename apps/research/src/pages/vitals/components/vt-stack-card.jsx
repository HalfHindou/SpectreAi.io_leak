/**
 * vt-stack-card.jsx — where a platform's money comes from.
 *
 * Stacked daily bars, pivotable between CHAIN (Solana vs Hyperliquid) and
 * PRODUCT (fomo Wallet vs fomo Perps), with a 100% mode for share-of-total.
 *
 * This chart is also the honest answer to our own coverage gap: it shows at a
 * glance that Solana carries ~99% of fomo, which is precisely why a
 * Hyperliquid-routed trader count is a slice and not a total. The caveat stops
 * being a footnote and becomes something you can see.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import VtSeg from './vt-seg'
import { usd, pct, shortDate, hexToRgba, SERIES, SERIES_MAX, restTone } from './vt-format'

const RANGES = [
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: 99_999 },
]
const GROUPS = [{ id: 'chains', label: 'By chain' }, { id: 'products', label: 'By product' }]
const MODES = [{ id: 'stack', label: 'Stacked' }, { id: 'share', label: '100%' }]

const PAD = { top: 16, right: 12, bottom: 26, left: 66 }

/* Fixed, and matched in the stylesheet: the flip runs on the same frame as the
   move, so a measured width would land late and the panel would jump. Wider
   than the single-series card's because it names the bands. */
const RO_W = 224
const RO_GAP = 14

/**
 * Slots by rank, not a per-key hash — hashing every chain to its own hue gave
 * Uniswap forty-five unrelated colours, of which forty were drawing a band 0px
 * tall. The bands take the page's SERIES palette in order, and it is the same
 * palette the tide uses, so "cyan" means the same rank of thing on both charts.
 *
 * The lead band used to be the theme's ink, which made the dominant chain — the
 * one carrying 96.7% of the platform — a white slab, and the whole card read as
 * a greyscale chart with one thin blue stripe in it.
 */
/** Everything folded into "Other" — a neutral, because it is a remainder. */

/**
 * A band under this share of the window is invisible in the plot and is pure
 * cost in the legend, so it is folded rather than printed. Uniswap's breakdown
 * shipped 45 legend entries, 40 of them "0.0%" — five rows of chips that told
 * the reader nothing and buried the five chains that carry the platform.
 */
const MIN_SHARE = 0.5

export default function VtStackCard({ title, subtitle, data, defaultRange = '90d' }) {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const [range, setRange] = useState(defaultRange)
  const [group, setGroup] = useState('chains')
  const [mode, setMode] = useState('stack')
  const [hover, setHover] = useState(null)
  const [readoutX, setReadoutX] = useState(null)

  const model = useMemo(() => {
    const rows = data?.rows || []
    if (!rows.length) return null
    const days = RANGES.find((r) => r.id === range)?.days ?? 90
    const cutoff = Math.floor(Date.now() / 1000) - days * 86_400
    const win = rows.filter((r) => r.t >= cutoff)
    if (win.length < 2) return null

    const keys = group === 'chains' ? (data.chains || []) : (data.products || [])
    // Rank the bands by their weight in THIS window so the biggest sits at the
    // bottom of the stack and the eye reads the dominant source first.
    const weight = new Map(keys.map((k) => [k, win.reduce((a, r) => a + (r[group]?.[k] || 0), 0)]))
    const ordered = [...keys].sort((a, b) => (weight.get(b) || 0) - (weight.get(a) || 0))
    const totalAll = [...weight.values()].reduce((a, v) => a + v, 0) || 1

    // Totals are summed over the FULL ordered set, before the fold, so folding
    // never changes the height of a bar or the number in the readout.
    const totals = win.map((r) => ordered.reduce((a, k) => a + (r[group]?.[k] || 0), 0))

    const shareOf = (k) => ((weight.get(k) || 0) / totalAll) * 100
    const palette = SERIES
    const named = ordered.filter((k) => shareOf(k) >= MIN_SHARE).slice(0, SERIES_MAX)
    const folded = ordered.filter((k) => !named.includes(k))

    const bands = named.map((k, i) => ({
      key: k,
      color: palette[i],
      share: shareOf(k),
      values: win.map((r) => r[group]?.[k] || 0),
    }))
    if (folded.length) {
      bands.push({
        key: folded.length === 1 ? folded[0] : `Other (${folded.length})`,
        color: restTone(dayMode),
        share: folded.reduce((a, k) => a + shareOf(k), 0),
        values: win.map((r) => folded.reduce((a, k) => a + (r[group]?.[k] || 0), 0)),
        rest: true,
        members: folded,
      })
    }
    return { win, bands, totals, max: Math.max(...totals, 1) }
  }, [data, range, group, dayMode])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const rect = wrap.getBoundingClientRect()
    const w = Math.max(240, Math.round(rect.width))
    const h = Math.max(180, Math.round(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
    }

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // Clear FIRST, then bail: bailing before the clear left the previous range's
    // bars painted under the "no history" message.
    if (!model) return

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom
    const n = model.win.length
    const share = mode === 'share'
    const grid = dayMode ? 'rgba(15,23,42,0.09)' : 'rgba(255,255,255,0.07)'
    const axisText = dayMode ? 'rgba(15,23,42,0.6)' : 'rgba(247,247,250,0.6)'

    ctx.font = '11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    for (let g = 0; g <= 4; g++) {
      const frac = g / 4
      const y = Math.round(PAD.top + plotH - frac * plotH) + 0.5
      ctx.strokeStyle = grid
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(w - PAD.right, y); ctx.stroke()
      if (g > 0) {
        ctx.fillStyle = axisText
        ctx.fillText(share ? `${Math.round(frac * 100)}%` : usd(model.max * frac, { decimals: 0 }), PAD.left - 9, y)
      }
    }

    const bw = Math.max(1, plotW / n - (n > 120 ? 0 : 1.4))

    // Same crosshair as the single-series card, and for the same reason: a band
    // going from 0.86 to 1.0 alpha is not a findable marker on a ninety-bar
    // chart. Under the stack, so it points down to the column rather than
    // cutting across the bands.
    if (hover != null && model.win[hover]) {
      const hx = Math.round(PAD.left + (hover / n) * plotW + bw / 2) + 0.5
      ctx.strokeStyle = dayMode ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.26)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hx, PAD.top)
      ctx.lineTo(hx, PAD.top + plotH)
      ctx.stroke()
    }

    const baseline = new Float64Array(n)
    for (const band of model.bands) {
      for (let i = 0; i < n; i++) {
        const denom = share ? (model.totals[i] || 1) : model.max
        const v = band.values[i]
        if (v <= 0) continue
        const bh = (v / denom) * plotH
        const x = PAD.left + (i / n) * plotW
        const y = PAD.top + plotH - baseline[i] - bh
        ctx.fillStyle = hexToRgba(band.color, hover === i ? 1 : 0.86)
        ctx.fillRect(x, y, bw, bh)
        baseline[i] += bh
      }
    }

    ctx.textAlign = 'center'
    ctx.fillStyle = axisText
    const ticks = Math.min(6, n)
    for (let t = 0; t < ticks; t++) {
      const i = Math.round((t / Math.max(1, ticks - 1)) * (n - 1))
      const d = new Date(model.win[i].t * 1000)
      ctx.fillText(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        PAD.left + (i / n) * plotW + bw / 2, h - PAD.bottom + 13)
    }

    // Drawn LAST so the mark sits over the data, never under it.
    drawSpectreWatermark(ctx, { w, h, dark: !dayMode, plot: { x: PAD.left, y: PAD.top, w: plotW, h: plotH } })
  }, [model, mode, dayMode, hover])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw) })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const onMove = (e) => {
    const wrap = wrapRef.current
    if (!wrap || !model) return
    const rect = wrap.getBoundingClientRect()
    const plotW = rect.width - PAD.left - PAD.right
    const i = Math.floor(((e.clientX - rect.left - PAD.left) / Math.max(1, plotW)) * model.win.length)
    if (i < 0 || i >= model.win.length) { setHover(null); setReadoutX(null); return }
    setHover(i)

    const cx = PAD.left + ((i + 0.5) / model.win.length) * plotW
    let left = cx + RO_GAP
    if (left + RO_W > rect.width - 6) left = cx - RO_GAP - RO_W
    setReadoutX(Math.max(6, Math.min(left, Math.max(6, rect.width - 6 - RO_W))))
  }

  /** Touch is the same gesture with a different event shape. */
  const onTouchPoint = (e) => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX }) }

  const hp = hover != null && model ? model.win[hover] : null

  return (
    <div className="vt-chart">
      <div className="vt-chart__controls">
        <div className="vt-chart__title">
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <div className="vt-chart__ctl">
          <VtSeg size="sm" label="Group" value={group} onChange={setGroup}
            items={GROUPS.map((g) => ({ ...g, disabled: !(g.id === 'chains' ? data.chains : data.products)?.length }))} />
          <VtSeg size="sm" label="Mode" value={mode} onChange={setMode} items={MODES} />
          <div className="vt-chart__ranges" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} type="button"
                className={`vt-pill vt-pill--sm${range === r.id ? ' is-active' : ''}`}
                onClick={() => setRange(r.id)} aria-pressed={range === r.id}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="vt-chart__canvas" ref={wrapRef} onMouseMove={onMove}
        onMouseLeave={() => { setHover(null); setReadoutX(null) }}
        onTouchStart={onTouchPoint} onTouchMove={onTouchPoint}
        onTouchEnd={() => { setHover(null); setReadoutX(null) }}>
        <canvas ref={canvasRef} aria-label={title} />
        {/* Returning null here removed the whole card from the grid, so a
            platform with a short breakdown history looked like a page that had
            simply failed to render one of its charts. */}
        {!model ? (
          <p className="vt-empty">
            {data?.rows?.length
              ? 'Not enough history in this range — try a longer window.'
              : 'No breakdown for this platform yet.'}
          </p>
        ) : null}
        {hp ? (
          <div className="vt-chart__readout vt-chart__readout--bands"
            style={readoutX != null ? { left: `${readoutX}px`, right: 'auto' } : undefined}>
            <span>{shortDate(new Date(hp.t * 1000).toISOString().slice(0, 10))}</span>
            <strong>{usd(model.totals[hover])}</strong>
            {/* A stacked bar IS its composition. The panel used to print the
                total alone, which is the one number the axis already gives you
                — the bands are the reason to hover at all. Zeroes are dropped:
                on any given day most chains contributed nothing, and listing
                them would bury the two that did. */}
            <ul>
              {model.bands.map((b) => {
                const v = b.values[hover]
                if (!v) return null
                return (
                  <li key={b.key} className={b.rest ? 'is-rest' : undefined}>
                    <i style={{ background: b.color }} aria-hidden="true" />
                    <span className="vt-chart__ro-name">{b.key}</span>
                    <span className="vt-chart__ro-val">{usd(v)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <ul className="vt-stack__legend">
        {(model?.bands || []).map((b) => (
          <li key={b.key} className={b.rest ? 'is-rest' : undefined}
              title={b.rest ? b.members.join(', ') : undefined}>
            <i style={{ background: b.color }} aria-hidden="true" />
            <span className="vt-stack__name">{b.key}</span>
            <span className="vt-stack__share">{pct(b.share, { sign: false })}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
