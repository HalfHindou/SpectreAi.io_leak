/**
 * MoneyFlowTreemap — "how many dollars entered or left this market".
 *
 * The headline is the STORY: the sum of every asset's implied market-cap
 * delta, i.e. the dollars added to (or pulled from) the market over the
 * selected window. The map underneath is the receipt.
 *
 *   per-asset dollars = mcap − mcap / (1 + chg/100)
 *
 * Tile area ∝ market cap, tile colour ∝ % move on a money-green / money-red
 * ramp (bright saturated for the big movers, deep forest / near-black for the
 * quiet ones). Squarified layout, no d3 — the algorithm is ~50 lines and this
 * component is shared by a lazy Pro page and a lazy Lite tab, so it must not
 * drag a vendor chunk along with it.
 *
 * Shared surface: /heatmaps (Pro, viewMode 'flows') + Spectre Lite (Money Flow).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { dollarFlow, summariseFlow } from '@/lib/liquidity-flow'
import './money-flow-treemap.css'
import './money-flow-treemap.day-mode.css'
import './money-flow-treemap.mobile.css'

/* Market cap drives tile area, mildly dampened. Pure proportional buries the
   tail under BTC / NVDA; the exponent keeps the hierarchy honest (the biggest
   asset still owns the biggest tile) while leaving the tail legible. */
const SIZE_EXP = 0.72

/* ── dollars implied by the move ────────────────────────────────────────
   🪤 This used to be a second implementation of `dollarFlow` living here, and
   a second implementation is how the same question ends up with different
   answers on two surfaces. One primitive, in lib/liquidity-flow.js, for the
   heatmap header, this treemap and the bubbles hero alike. Re-exported because
   the name is part of this module's public surface. */
export const flowDollars = dollarFlow

/* ── colour ramp ──────────────────────────────────────────────────────────
   `cap` is the % move that saturates the ramp. Derived from the batch (see
   `deriveCap`) so a calm tape and a violent one both use the full palette
   instead of rendering one flat wall of near-black. */
export function flowColor(change, cap, light = false) {
  const chg = Number(change) || 0
  // Exponent < 1 lifts the mid-range without flattening the bottom: on the
  // reference tape (cap ~19%) a +2.5% mover lands at t≈0.27 = deep forest,
  // +16% lands at t≈0.91 = bright. sqrt() washed the whole map bright.
  const t = Math.min(1, Math.pow(Math.abs(chg) / (cap || 1), 0.65))
  const up = chg >= 0
  const hue = up ? 150 - 9 * t : 356 + 6 * t
  const sat = up ? 54 + 27 * t : 50 + 30 * t
  const lo = light ? (up ? 31 : 35) : (up ? 8.5 : 10)
  const hi = light ? (up ? 55 : 57) : (up ? 51 : 51)
  const l = lo + (hi - lo) * t
  // A whisper of top-light so tiles read as surfaces, not flat swatches.
  return `linear-gradient(180deg, hsl(${hue} ${sat}% ${(l + 2.4).toFixed(1)}%) 0%, hsl(${hue} ${sat}% ${l.toFixed(1)}%) 100%)`
}

/* The ramp saturates near the batch's LOUDEST move, not its median — that is
   what gives the reference its depth (a wall of deep forest, a handful of
   bright tiles). The 4% floor keeps a calm tape from bleaching itself white. */
function deriveCap(rows) {
  const mags = rows.map((r) => Math.abs(Number(r.change) || 0)).sort((a, b) => a - b)
  if (mags.length === 0) return 6
  const p95 = mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.95))]
  return Math.min(25, Math.max(4, p95))
}

/* ── squarified treemap (Bruls/Huizing/van Wijk) ───────────────────────── */
function worstRatio(row, rowArea, short) {
  let min = Infinity
  let max = 0
  for (const n of row) {
    if (n.area < min) min = n.area
    if (n.area > max) max = n.area
  }
  if (min <= 0) return Infinity
  const s2 = short * short
  const a2 = rowArea * rowArea
  return Math.max((s2 * max) / a2, a2 / (s2 * min))
}

function squarify(nodes, width, height) {
  const out = []
  if (!nodes.length || width <= 0 || height <= 0) return out
  const total = nodes.reduce((s, n) => s + n.value, 0)
  if (total <= 0) return out
  const scale = (width * height) / total
  const items = nodes.map((n) => ({ ...n, area: n.value * scale }))

  let x = 0
  let y = 0
  let w = width
  let h = height
  let i = 0

  while (i < items.length && w > 0.5 && h > 0.5) {
    const short = Math.min(w, h)
    let row = [items[i]]
    let rowArea = items[i].area
    let best = worstRatio(row, rowArea, short)
    let j = i + 1
    while (j < items.length) {
      const nextArea = rowArea + items[j].area
      const nextRow = row.concat(items[j])
      const ratio = worstRatio(nextRow, nextArea, short)
      if (ratio > best) break
      row = nextRow
      rowArea = nextArea
      best = ratio
      j += 1
    }

    const thickness = rowArea / short
    let off = 0
    if (w >= h) {
      for (const n of row) {
        const nh = (h * n.area) / rowArea
        out.push({ node: n, x, y: y + off, w: thickness, h: nh })
        off += nh
      }
      x += thickness
      w -= thickness
    } else {
      for (const n of row) {
        const nw = (w * n.area) / rowArea
        out.push({ node: n, x: x + off, y, w: nw, h: thickness })
        off += nw
      }
      y += thickness
      h -= thickness
    }
    i = j
  }
  return out
}

/* ── logo chip: brand logo → per-market fallback → monogram ────────────── */
function LogoChip({ row, size }) {
  const [step, setStep] = useState(0)
  const sources = useMemo(() => [row.logo, row.logoFallback].filter(Boolean), [row.logo, row.logoFallback])
  const src = sources[step]
  const style = { width: size, height: size }
  if (!src) {
    return (
      <span className="mfx-chip mfx-chip--mono" style={style} aria-hidden>
        {String(row.symbol || '?').slice(0, 1)}
      </span>
    )
  }
  return (
    <span className="mfx-chip" style={style} aria-hidden>
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setStep((s) => s + 1)} />
    </span>
  )
}

/* Tile content tiers — the reference: big tiles carry logo + ticker + %,
   medium drop the ticker, the tail is a logo chip and nothing else. */
function tierOf(w, h) {
  if (w >= 132 && h >= 108) return 1
  if (w >= 92 && h >= 78) return 2
  if (w >= 64 && h >= 60) return 3
  if (w >= 44 && h >= 42) return 4
  if (w >= 26 && h >= 22) return 5
  return 6
}

const CHIP_PX = { 1: 46, 2: 34, 3: 24, 4: 18, 5: 13 }

function pctText(chg) {
  const n = Number(chg) || 0
  const abs = Math.abs(n)
  return `${n >= 0 ? '+' : '-'}${abs >= 100 ? abs.toFixed(0) : abs.toFixed(2)}%`
}

function MoneyFlowTile({ tile, cap, light, money, onEnter, onLeave, onActivate, isActive }) {
  const { node, x, y, w, h } = tile
  const row = node.row
  if (w < 3 || h < 3) return null
  const tier = tierOf(w, h)
  const chip = CHIP_PX[tier]
  const showTicker = tier <= 2
  const showPct = tier <= 4
  // the added/removed layer IS the view — big tiles carry their own dollars
  // statically (hover keeps the full rail; small tiles stay uncluttered)
  const showFlow = tier === 1 && h >= 128 && money && Math.abs(row.flow) > 0
  return (
    <div
      className={`mfx-tile mfx-tile--t${tier}${isActive ? ' mfx-tile--active' : ''}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, background: flowColor(row.change, cap, light) }}
      role="button"
      tabIndex={tier <= 4 ? 0 : -1}
      aria-label={`${row.symbol} ${pctText(row.change)}`}
      onMouseEnter={() => onEnter(row)}
      onFocus={() => onEnter(row)}
      onMouseLeave={onLeave}
      onClick={() => onActivate(row)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(row) } }}
    >
      {chip && <LogoChip row={row} size={chip} />}
      {showTicker && <span className="mfx-tile-sym">{row.symbol}</span>}
      {showPct && <span className="mfx-tile-pct">{pctText(row.change)}</span>}
      {showFlow && <span className="mfx-tile-flow">{`${row.flow >= 0 ? '+' : '−'}${money(row.flow)}`}</span>}
    </div>
  )
}

const ArrowIcon = ({ up }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {up ? <><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></> : <><path d="M12 5v14" /><path d="M19 12l-7 7-7-7" /></>}
  </svg>
)

/**
 * @param rows        [{ id, symbol, name, logo, logoFallback, marketCap, change, price }]
 * @param marketLabel "crypto" | "US stocks" — the noun in the headline
 * @param periodLabel "today" | "this hour" | "this week" | "this month"
 * @param light       lift the palette floor for a light page (day mode / Lite paper)
 * @param onSelect    (row) => void — tile click on a pointer device
 * @param fill        stretch the stage to the parent's height (fullscreen)
 */
export default function MoneyFlowTreemap({
  rows,
  marketLabel = 'crypto',
  periodLabel = 'today',
  // Free-text addendum to the scope line — for a caller that knows WHY rows
  // are missing (e.g. index funds carry no market cap of their own).
  scopeNote = '',
  light = false,
  onSelect,
  fill = false,
  compact = false,
  className = '',
}) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const stageRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [active, setActive] = useState(null)
  const [touch, setTouch] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(hover: none)')
    const apply = (e) => setTouch(e.matches)
    apply(mql)
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
    })
    // Seed synchronously — an observer's first delivery is tied to the
    // rendering steps and never arrives in a hidden tab.
    const r = el.getBoundingClientRect()
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Trim currency formatter zeros so the hero number reads "$214B", not
  // "$214.00B", while staying locale/currency aware.
  const money = useCallback((v) => {
    const s = fmtLargeShort(Math.abs(Number(v) || 0))
    return s.replace(/(\d)\.0+([TBMK])$/, '$1$2').replace(/(\d\.\d)0([TBMK])$/, '$1$2')
  }, [fmtLargeShort])

  const clean = useMemo(() => (rows || [])
    .filter((r) => r && r.symbol && Number(r.marketCap) > 0 && Number.isFinite(Number(r.change)))
    .map((r) => ({ ...r, flow: flowDollars(r.marketCap, r.change) })), [rows])

  // One shared summariser, and it reports the rows it could NOT count so the
  // scope line can say so instead of quietly shrinking the basis.
  const totals = useMemo(() => summariseFlow(rows), [rows])

  const cap = useMemo(() => deriveCap(clean), [clean])

  const tiles = useMemo(() => {
    if (!clean.length || size.w < 40 || size.h < 40) return []
    const nodes = clean
      .map((row) => ({ row, value: Math.pow(Math.max(Number(row.marketCap) || 1, 1), SIZE_EXP) }))
      .sort((a, b) => b.value - a.value)
    return squarify(nodes, size.w, size.h)
  }, [clean, size.w, size.h])

  const handleEnter = useCallback((row) => { if (!touch) setActive(row) }, [touch])
  const handleLeave = useCallback(() => { if (!touch) setActive(null) }, [touch])
  const handleActivate = useCallback((row) => {
    if (touch) { setActive((cur) => (cur && cur.symbol === row.symbol ? cur : row)); return }
    onSelect?.(row)
  }, [touch, onSelect])

  const up = totals.net >= 0
  const dir = up ? 'up' : 'down'
  const verb = up
    ? t('moneyFlow.added', 'added to {{market}} {{period}}', { market: marketLabel, period: periodLabel })
    : t('moneyFlow.pulled', 'pulled from {{market}} {{period}}', { market: marketLabel, period: periodLabel })

  return (
    <div className={`mfx${light ? ' mfx--light' : ''}${fill ? ' mfx--fill' : ''}${compact ? ' mfx--compact' : ''} ${className}`.trim()} data-dir={dir}>
      {/* head + sub share ONE wrapper so a host can put the whole hero on a
          plate. LITE renders this over a photo wallpaper, where a bare
          warm-white number and a green/red split are unreadable across the
          bright half of the image; PRO leaves .mfx-hero unstyled. */}
      <div className="mfx-hero">
      <header className="mfx-head">
        <div className="mfx-headline">
          <span className={`mfx-arrow mfx-arrow--${dir}`}><ArrowIcon up={up} /></span>
          <span className="mfx-amount">{money(totals.net)}</span>
          <span className="mfx-verb">{verb}</span>
        </div>
        <div className="mfx-rail" aria-live="polite">
          {active ? (
            <>
              <LogoChip row={active} size={26} />
              <span className="mfx-rail-sym">{active.symbol}</span>
              <span className="mfx-rail-name">{active.name || ''}</span>
              <span className={`mfx-rail-flow mfx-rail-flow--${active.flow >= 0 ? 'up' : 'down'}`}>
                {active.flow >= 0 ? '+' : '−'}{money(active.flow)}
              </span>
              <span className={`mfx-rail-pct mfx-rail-pct--${Number(active.change) >= 0 ? 'up' : 'down'}`}>{pctText(active.change)}</span>
              <span className="mfx-rail-mcap">{money(active.marketCap)} {t('moneyFlow.mcapShort', 'mcap')}</span>
              {onSelect && (
                <button type="button" className="mfx-rail-open" onClick={() => onSelect(active)}>
                  {t('moneyFlow.open', 'Open')}
                </button>
              )}
            </>
          ) : (
            <span className="mfx-rail-hint">
              {touch
                ? t('moneyFlow.hintTouch', 'Tap a tile for its dollar flow')
                : t('moneyFlow.hintHover', 'Hover a tile for its dollar flow')}
            </span>
          )}
        </div>
      </header>

      <div className="mfx-sub">
        <span className="mfx-split mfx-split--in">{money(totals.inflow)} {t('moneyFlow.in', 'in')}</span>
        <span className="mfx-sep" />
        <span className="mfx-split mfx-split--out">{money(totals.outflow)} {t('moneyFlow.out', 'out')}</span>
        <span className="mfx-sep" />
        {/* 🪤 This used to read "Across the top {{n}} by market cap" where n was
            the count that SURVIVED the market-cap filter — so a caller handing
            over 100 rows got a confident "top 50" and nobody could tell that
            half the basis had been dropped. The basis and the drop are both
            stated now; `scopeNote` lets a caller name the reason. */}
        <span className="mfx-scope">
          {t('moneyFlow.scopeCounted', 'Across {{n}} by market cap', { n: totals.counted })}
          {totals.skipped > 0 && ` · ${t('moneyFlow.scopeSkipped', '{{n}} without a market cap not counted', { n: totals.skipped })}`}
          {scopeNote ? ` · ${scopeNote}` : ''}
        </span>
      </div>
      </div>

      <div className="mfx-stage" ref={stageRef}>
        <span className="mfx-bloom" aria-hidden />
        {tiles.length === 0 ? (
          <div className="mfx-skeleton" aria-hidden>
            {Array.from({ length: 14 }).map((_, i) => <span key={i} className={`mfx-skeleton-tile mfx-sk-${i % 7}`} />)}
          </div>
        ) : tiles.map((tile) => (
          <MoneyFlowTile
            key={tile.node.row.id || tile.node.row.symbol}
            tile={tile}
            cap={cap}
            light={light}
            money={money}
            onEnter={handleEnter}
            onLeave={handleLeave}
            onActivate={handleActivate}
            isActive={!!active && active.symbol === tile.node.row.symbol}
          />
        ))}
      </div>

      <div className="mfx-legend">
        <span className="mfx-legend-label">−{cap.toFixed(1)}%</span>
        <span className="mfx-legend-bar" />
        <span className="mfx-legend-label">+{cap.toFixed(1)}%</span>
        <span className="mfx-legend-note">{t('moneyFlow.legend', 'Size = market cap · colour = move · sum = dollars in or out')}</span>
      </div>
    </div>
  )
}
