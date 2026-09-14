/**
 * drawSpectreWatermark — the canvas twin of <ChartWatermark>.
 *
 * Same elegant, size-adaptive Spectre mark, drawn straight onto a 2D context for
 * canvas-rendered charts (the OTHERS2 line, sector-compare, heatmaps, big
 * sparklines, etc). Call it LAST in your draw pass so it sits over the data.
 *
 * Corner mark = the real header brand lockup (logo glyph + "Spectre" wordmark),
 * from /logo-dark-mode.png (dark charts) or /logo-day-mode.png (light). Those
 * assets are already loaded/cached by the header, so the draw is effectively
 * synchronous; a text fallback covers the (rare) not-yet-decoded first paint.
 *
 * The context is assumed to already be in CSS-pixel space (i.e. you did
 * `ctx.setTransform(dpr,0,0,dpr,0,0)`); pass `w`/`h` in CSS pixels.
 *
 *   drawSpectreWatermark(ctx, { w, h, dark: !dayMode })
 */
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", sans-serif'

// Preload the clean, box-free lockups once.
const _lockups = {}
function lockup(dark) {
  if (typeof Image === 'undefined') return null
  const key = dark ? 'dark' : 'day'
  if (!_lockups[key]) {
    const img = new Image()
    img.src = dark ? '/spectre-wm-light.png' : '/spectre-wm-dark.png'
    _lockups[key] = img
  }
  return _lockups[key]
}

function drawSpaced(ctx, text, cx, cy, spacing) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (text.length - 1)
  let x = cx - total / 2
  ctx.textAlign = 'left'
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, cy)
    x += widths[i] + spacing
  }
}

export function drawSpectreWatermark(ctx, { w, h, dark = true, ghost = true, corner = 'br', plot = null } = {}) {
  if (!ctx || !(w > 0) || !(h > 0)) return
  if (w < 108 || h < 44) return // too tiny to carry a mark cleanly
  const ink = dark ? '245,245,247' : '15,23,42'
  // the box to anchor into: the plotted area if the caller passed it (keeps the
  // mark INSIDE the axis lines), else the full canvas.
  const box = plot && plot.w > 0 && plot.h > 0
    ? { x: plot.x || 0, y: plot.y || 0, w: plot.w, h: plot.h }
    : { x: 0, y: 0, w, h }
  ctx.save()

  // ── faint centered logotype (hero charts only)
  if (ghost && h >= 118 && w >= 280) {
    let fs = Math.max(15, Math.min(w * 0.09, 60))
    // Never let the logotype run past the box it is centred in. A chart with a
    // wide axis gutter (a second scale, end-of-line % labels) has a plot far
    // narrower than its canvas, and a canvas-sized mark clipped at the edge.
    const spacedWidth = (size) => {
      ctx.font = `700 ${size}px ${FONT}`
      return [...'SPECTRE'].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + size * 0.42 * 6
    }
    const limit = box.w * 0.92
    const total = spacedWidth(fs)
    if (total > limit) fs = Math.max(12, fs * (limit / total))
    ctx.font = `700 ${fs}px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = `rgba(${ink},${dark ? 0.08 : 0.07})`
    drawSpaced(ctx, 'SPECTRE', box.x + box.w / 2, box.y + box.h / 2, fs * 0.42)
  }

  // ── corner brand lockup (clean, box-free logo + wordmark)
  const small = w < 200 || h < 96
  const lh = small ? 13 : 16            // lockup height (px)
  const pad = small ? 8 : 12
  const rN = box.x + box.w, bN = box.y + box.h
  const img = lockup(dark)
  ctx.globalAlpha = small ? 0.68 : 0.72
  if (img && img.complete && img.naturalWidth) {
    const lw = lh * (img.naturalWidth / img.naturalHeight)
    const lx = corner.includes('l') ? box.x + pad : rN - pad - lw
    const ly = corner.includes('t') ? box.y + pad : bN - pad - lh
    ctx.drawImage(img, lx, ly, lw, lh)
  } else {
    // fallback: the wordmark as text until the lockup image decodes
    ctx.font = `600 ${Math.round(lh * 0.82)}px ${FONT}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = `rgba(${ink},0.85)`
    const label = 'Spectre AI'
    ctx.textAlign = corner.includes('l') ? 'left' : 'right'
    const lx = corner.includes('l') ? box.x + pad : rN - pad
    const ly = corner.includes('t') ? box.y + pad + lh - 2 : bN - pad
    ctx.fillText(label, lx, ly)
  }

  ctx.restore()
}

export default drawSpectreWatermark
