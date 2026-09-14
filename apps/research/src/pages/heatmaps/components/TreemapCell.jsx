/**
 * TreemapCell — Individual treemap rectangle.
 * 5 content tiers based on visual cell size (cell dims × zoom scale).
 * Every visible cell shows useful info — at minimum the change%.
 * Smooth CSS transitions when layout recalculates on zoom.
 */
import React, { memo } from 'react'

/* ── Color mapping: change% → glassy colored gradient fill ──
 * A vertical gradient (richer at the top where light catches, deeper below)
 * so each cell reads as coloured glass, not a flat rectangle. The white
 * specular reflection is layered on top via `.treemap-cell::before` in CSS. */
export function changeToColor(change, dayMode = false) {
  const abs = Math.abs(change)
  const intensity = Math.min(1, abs / 8)
  const isPositive = change >= 0
  // Day mode: SOLID finviz-style scale (opaque HSL, not washed-out translucent
  // pastels over white). Lightness drops + saturation rises with intensity so
  // strong movers are boldly coloured; capped at 50% light so dark text stays
  // readable.
  if (dayMode) {
    // TradingView-style flat fills (user-picked): green anchored on #16C784
    // (hue 158, sat ~78%), red on a matching coral. Intensity moves lightness
    // only a touch — tiles stay in the same tone, never diving dark or
    // washing out pastel. White text rides on top (treemap.css day rules).
    const hue = isPositive ? 158 : 3
    const sat = isPositive ? 78 : (62 + intensity * 16).toFixed(1)
    const lTop = (isPositive ? 50 - intensity * 7 : 70 - intensity * 14).toFixed(1)
    const lBot = (isPositive ? 46 - intensity * 6 : 66 - intensity * 13).toFixed(1)
    return `linear-gradient(168deg, hsl(${hue} ${sat}% ${lTop}%) 0%, hsl(${hue} ${sat}% ${lBot}%) 100%)`
  }
  const rgb = isPositive ? '16, 185, 129' : '239, 68, 68'
  const top = (0.17 + intensity * 0.44).toFixed(3)
  const bot = (0.07 + intensity * 0.22).toFixed(3)
  return `linear-gradient(168deg, rgba(${rgb}, ${top}) 0%, rgba(${rgb}, ${bot}) 100%)`
}

/*
 * Content tiers — every cell shows something useful:
 *
 * XL  (vw≥160, vh≥110): logo(32) + symbol + name + price + change
 * L   (vw≥95,  vh≥65):  logo(24) + symbol + price + change
 * M   (vw≥48,  vh≥32):  symbol + change
 * S   (vw≥24,  vh≥18):  symbol(tiny) + change(tiny)
 * XS  (vw≥12,  vh≥10):  change% only
 */

function TreemapCell({ leaf, change, livePrice, fmtPrice, onHover, onClick, dayMode, zoomScale = 1 }) {
  const token = leaf.data.token
  const w = leaf.x1 - leaf.x0
  const h = leaf.y1 - leaf.y0

  // Skip invisible cells
  if (w < 2 || h < 2) return null

  // Visual dimensions (what the user sees on screen after zoom transform)
  const vw = w * zoomScale
  const vh = h * zoomScale

  // Hide cells too small to be useful
  if (vw < 10 || vh < 8) return null

  // Determine content tier
  const isXL = vw >= 160 && vh >= 110
  const isL = !isXL && vw >= 95 && vh >= 65
  const isM = !isXL && !isL && vw >= 48 && vh >= 32
  const isS = !isXL && !isL && !isM && vw >= 24 && vh >= 18

  const isPositive = change >= 0
  const bgColor = changeToColor(change, dayMode)
  const changeStr = `${isPositive ? '+' : ''}${change.toFixed(2)}%`
  const changeShort = `${isPositive ? '+' : ''}${Math.abs(change) >= 10 ? change.toFixed(1) : change.toFixed(2)}%`
  const changeTiny = `${isPositive ? '+' : ''}${change.toFixed(1)}%`

  const tierClass = isXL ? 'treemap-cell--xl' : isL ? 'treemap-cell--lg' : isM ? 'treemap-cell--md' : isS ? 'treemap-cell--sm' : 'treemap-cell--xs'

  return (
    <div
      className={`treemap-cell ${tierClass}`}
      style={{
        position: 'absolute',
        left: leaf.x0,
        top: leaf.y0,
        width: w,
        height: h,
        background: bgColor,
      }}
      role="gridcell"
      tabIndex={0}
      aria-label={`${token.symbol} ${changeStr}`}
      onMouseEnter={(e) => onHover(token, { x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onHover(token, { x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover(null, null)}
      onClick={() => onClick?.(token)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(token) } }}
    >
      {/* ── XL: Full detail ── */}
      {isXL && (
        <>
          {token.logo && (
            <img className="treemap-cell-logo treemap-cell-logo--xl" src={token.logo} alt="" loading="lazy" />
          )}
          <span className="treemap-cell-symbol treemap-cell-symbol--xl">{token.symbol}</span>
          <span className="treemap-cell-name">{token.name}</span>
          <span className="treemap-cell-price treemap-cell-price--xl">{fmtPrice(livePrice ?? token.price)}</span>
          <span className={`treemap-cell-change treemap-cell-change--xl ${isPositive ? 'positive' : 'negative'}`}>
            {changeStr}
          </span>
        </>
      )}

      {/* ── L: Logo + symbol + price + change ── */}
      {isL && (
        <>
          {token.logo && (
            <img className="treemap-cell-logo" src={token.logo} alt="" loading="lazy" />
          )}
          <span className="treemap-cell-symbol treemap-cell-symbol--lg">{token.symbol}</span>
          <span className="treemap-cell-price">{fmtPrice(livePrice ?? token.price)}</span>
          <span className={`treemap-cell-change ${isPositive ? 'positive' : 'negative'}`}>
            {changeStr}
          </span>
        </>
      )}

      {/* ── M: Symbol + change ── */}
      {isM && (
        <>
          <span className="treemap-cell-symbol">{token.symbol}</span>
          <span className={`treemap-cell-change ${isPositive ? 'positive' : 'negative'}`}>
            {changeShort}
          </span>
        </>
      )}

      {/* ── S: Compact symbol + change ── */}
      {isS && (
        <>
          <span className="treemap-cell-symbol treemap-cell-symbol--sm">{token.symbol}</span>
          <span className={`treemap-cell-change treemap-cell-change--sm ${isPositive ? 'positive' : 'negative'}`}>
            {changeTiny}
          </span>
        </>
      )}

      {/* ── XS: Just change% centered ── */}
      {!isXL && !isL && !isM && !isS && (
        <span className={`treemap-cell-change treemap-cell-change--xs ${isPositive ? 'positive' : 'negative'}`}>
          {changeTiny}
        </span>
      )}
    </div>
  )
}

export default memo(TreemapCell)
