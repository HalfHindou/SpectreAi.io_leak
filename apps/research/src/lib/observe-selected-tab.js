// Reveal only the horizontal tab strip. scrollIntoView would also move the
// surrounding page, which is disruptive while reading a Research Zone panel.
export function revealSelectedTab(strip) {
  const selected = strip?.querySelector('[aria-selected="true"]')
  if (!selected) return
  const bounds = strip.getBoundingClientRect()
  const item = selected.getBoundingClientRect()
  const width = bounds.right - bounds.left
  if (width <= 0) return
  const left = bounds.left + 8
  const right = bounds.right - 8
  let delta = 0
  if (item.right - item.left > width - 16) {
    // A translated or enlarged label can exceed the strip. Align its leading
    // edge consistently instead of alternating between its two clipped ends.
    const rtl = strip.ownerDocument.defaultView.getComputedStyle(strip).direction === 'rtl'
    delta = rtl ? item.right - right : item.left - left
  } else if (item.left < left) delta = item.left - left
  else if (item.right > right) delta = item.right - right
  if (Math.abs(delta) > 0.5) strip.scrollLeft += delta
}

export function observeSelectedTab(strip) {
  if (!strip) return undefined
  const view = strip.ownerDocument.defaultView
  let frame = null
  const schedule = () => {
    if (frame !== null) return
    frame = view.requestAnimationFrame(() => {
      frame = null
      revealSelectedTab(strip)
    })
  }
  revealSelectedTab(strip)
  const observer = view.ResizeObserver ? new view.ResizeObserver(schedule) : null
  observer?.observe(strip)
  const selected = strip.querySelector('[aria-selected="true"]')
  if (selected) observer?.observe(selected)
  // Covers older browsers without ResizeObserver, as well as rotation.
  view.addEventListener('resize', schedule)
  return () => {
    observer?.disconnect()
    view.removeEventListener('resize', schedule)
    if (frame !== null) view.cancelAnimationFrame(frame)
  }
}
