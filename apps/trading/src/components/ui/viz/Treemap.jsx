/**
 * Treemap — squarified market heatmap. The "no other terminal has this"
 * moment in the Living Market List heatmap view.
 *
 * Layout: Bruls/Huijbregts/van Wijk squarify (2000). Pure JS, ~50 LOC.
 * Each cell = a positioned <button>. Area ∝ value (volume). Color ∝
 * change on a diverging lime → obsidian → coral scale.
 */
import React, { useMemo } from 'react'
import './Treemap.css'

function squarify(items, width, height) {
  const total = items.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1
  const area = width * height
  const sized = items
    .filter((it) => (Number(it.value) || 0) > 0)
    .map((it) => ({ ...it, _area: ((Number(it.value) || 0) / total) * area }))
    .sort((a, b) => b._area - a._area)

  const rects = []

  function worst(row, length) {
    if (row.length === 0) return Infinity
    const sum = row.reduce((s, r) => s + r._area, 0)
    if (sum === 0) return Infinity
    let max = -Infinity
    let min = Infinity
    for (const r of row) {
      if (r._area > max) max = r._area
      if (r._area < min) min = r._area
    }
    return Math.max(
      (length * length * max) / (sum * sum),
      (sum * sum) / (length * length * min)
    )
  }

  function layoutRow(row, length, rowSum, x, y, vertical) {
    const thickness = rowSum / length
    let off = 0
    for (const r of row) {
      const portion = (r._area / rowSum) * length
      if (vertical) {
        rects.push({ ...r, x, y: y + off, w: thickness, h: portion })
      } else {
        rects.push({ ...r, x: x + off, y, w: portion, h: thickness })
      }
      off += portion
    }
    return thickness
  }

  let x = 0
  let y = 0
  let cw = width
  let ch = height
  const remaining = [...sized]

  while (remaining.length > 0) {
    const length = Math.min(cw, ch)
    if (length <= 0) break
    // Canonical squarify: items share the SHORTER side of the current
    // rectangle. When cw >= ch, the shorter side is ch (height), so the
    // strip we lay out occupies the LEFT side and items stack
    // vertically inside it (vertical = true).
    const vertical = cw >= ch
    const row = []
    let rowSum = 0
    while (remaining.length > 0) {
      const next = remaining[0]
      const candidateRow = [...row, next]
      const candidateSum = rowSum + next._area
      const worstNow = row.length === 0 ? Infinity : worst(row, length)
      const worstCandidate = worst(candidateRow, length)
      if (row.length === 0 || worstCandidate <= worstNow) {
        row.push(next)
        rowSum = candidateSum
        remaining.shift()
      } else {
        break
      }
    }
    const thickness = layoutRow(row, length, rowSum, x, y, vertical)
    // Defensive: degenerate inputs (NaN volumes, sub-pixel _area) could
    // produce a zero/negative thickness and prevent loop progress.
    if (!isFinite(thickness) || thickness <= 0) break
    if (vertical) {
      x += thickness
      cw -= thickness
    } else {
      y += thickness
      ch -= thickness
    }
  }

  return rects
}

function colorFor(change) {
  if (change == null || isNaN(change)) return 'var(--ob-surface-3)'
  // saturate at ±20%
  const c = Math.max(-1, Math.min(1, Number(change) / 20))
  if (c >= 0) {
    // Positive pole uses the dynamic --accent so the heatmap re-themes
    // with the active token (Iteration 3 §3). Negative pole stays coral
    // because direction semantics never theme (--down is universal).
    const pct = Math.round((0.16 + c * 0.42) * 100)
    return `color-mix(in srgb, var(--accent) ${pct}%, transparent)`
  }
  const pct = Math.round((0.16 + Math.abs(c) * 0.42) * 100)
  return `color-mix(in srgb, var(--down) ${pct}%, transparent)`
}

function Treemap({
  items = [],
  width = 600,
  height = 360,
  onCellClick,
  className = '',
}) {
  const cells = useMemo(
    () => squarify(items, width, height),
    [items, width, height]
  )

  if (cells.length === 0) {
    return (
      <div
        className={['tm', 'tm--empty', className].filter(Boolean).join(' ')}
        style={{ width, height }}
      >
        <span className="tm-empty-label">No tokens to display</span>
      </div>
    )
  }

  return (
    <div
      className={['tm', className].filter(Boolean).join(' ')}
      style={{ width, height }}
    >
      {cells.map((c, i) => {
        // Tiered display so small tiles still show SOMETHING:
        //   - >= 40x22 → symbol visible
        //   - >= 56x32 → symbol + change %
        //   - smaller   → coloured square only (still hover-tooltip)
        // tiny tile → drop font weight so text stays inside the box.
        const showSymbol = c.w > 40 && c.h > 22
        const showChange = c.w > 56 && c.h > 32 && c.change != null
        const tinyTile   = c.w < 60 || c.h < 30
        return (
          <button
            key={c.key || i}
            type="button"
            className={`tm-cell${tinyTile ? ' tm-cell--tiny' : ''}`}
            style={{
              left: `${(c.x / width) * 100}%`,
              top: `${(c.y / height) * 100}%`,
              width: `${(c.w / width) * 100}%`,
              height: `${(c.h / height) * 100}%`,
              background: colorFor(c.change),
              animationDelay: `${i * 18}ms`,
            }}
            onClick={() => onCellClick && onCellClick(c)}
            title={`${c.label || c.key}${c.change != null ? `  ${c.change >= 0 ? '+' : ''}${Number(c.change).toFixed(2)}%` : ''}`}
          >
            {showSymbol && (
              <span className="tm-label">
                <span className="tm-symbol">{c.label || c.key}</span>
                {showChange && (
                  <span
                    className={`tm-change ${c.change >= 0 ? 'tm-change--up' : 'tm-change--down'}`}
                  >
                    {c.change >= 0 ? '+' : ''}{Number(c.change).toFixed(1)}%
                  </span>
                )}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default React.memo(Treemap)
