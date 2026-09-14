const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

/** Fixed-position menu bounds in layout coordinates, constrained to what is visible. */
export function getAnchoredMenuStyle(rect, viewport, { minWidth = 180, maxHeight = 260, gap = 4 } = {}) {
  const { width, height, left = 0, top = 0, layoutHeight = height } = viewport
  const margin = 8
  const menuWidth = Math.min(Math.max(rect.width, minWidth), Math.max(0, width - margin * 2))
  const topEdge = top + margin
  const bottomEdge = Math.max(topEdge, top + height - margin)
  const belowTop = clamp(rect.bottom + gap, topEdge, bottomEdge)
  const aboveBottom = clamp(rect.top - gap, topEdge, bottomEdge)
  const belowSpace = bottomEdge - belowTop
  const aboveSpace = aboveBottom - topEdge
  const above = belowSpace < maxHeight && aboveSpace > belowSpace
  return {
    position: 'fixed',
    boxSizing: 'border-box',
    left: `${clamp(rect.left, left + margin, left + width - margin - menuWidth)}px`,
    right: 'auto',
    width: `${menuWidth}px`,
    minWidth: 0,
    minHeight: 0,
    maxHeight: `${Math.max(0, Math.min(maxHeight, above ? aboveSpace : belowSpace))}px`,
    top: above ? 'auto' : `${belowTop}px`,
    bottom: above ? `${layoutHeight - aboveBottom}px` : 'auto',
  }
}

/** Keep a sheet above the software keyboard without resizing the page underneath. */
export function getMenuSheetStyle({ width, height, left = 0, top = 0, layoutHeight = height }, fraction = 0.75) {
  return {
    boxSizing: 'border-box',
    left: `${left}px`,
    right: 'auto',
    width: `${width}px`,
    top: 'auto',
    bottom: `${Math.max(0, layoutHeight - top - height)}px`,
    maxHeight: `${Math.floor(height * fraction)}px`,
  }
}
