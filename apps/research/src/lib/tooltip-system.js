/**
 * Global tooltip system for [data-tooltip] elements.
 * Creates a single fixed-position DOM element on <body> -
 * always renders above everything, zero stacking context issues.
 *
 * Uses mouseover/mouseout (which bubble) instead of mouseenter/mouseleave
 * (which don't bubble and break event delegation).
 */
const GAP = 8
let tooltipEl = null
let currentTarget = null
let showTimeout = null
let hideTimeout = null

function getTooltipEl() {
  if (tooltipEl) return tooltipEl
  tooltipEl = document.createElement('div')
  tooltipEl.className = 'spectre-tooltip'
  tooltipEl.setAttribute('role', 'tooltip')
  document.body.appendChild(tooltipEl)
  return tooltipEl
}

function position(target) {
  const el = getTooltipEl()
  const rect = target.getBoundingClientRect()
  const pos = target.getAttribute('data-tooltip-pos') || 'top'
  const text = target.getAttribute('data-tooltip')
  el.textContent = text
  // Long, explanatory tooltips (e.g. the board's "Bid or bags?" read) must wrap
  // instead of stretching into one nowrap line. Auto-detect by length, or opt in
  // with data-tooltip-multiline.
  const multiline = target.hasAttribute('data-tooltip-multiline') || (text && text.length > 48)
  el.classList.toggle('is-multiline', !!multiline)

  // Measure tooltip offscreen (use class, not inline styles for opacity)
  el.style.left = '-9999px'
  el.style.top = '-9999px'
  el.classList.remove('is-visible')
  el.style.display = 'block'
  const tw = el.offsetWidth
  const th = el.offsetHeight

  let top, left

  if (pos === 'bottom') {
    top = rect.bottom + GAP
    left = rect.left + rect.width / 2 - tw / 2
  } else if (pos === 'left') {
    top = rect.top + rect.height / 2 - th / 2
    left = rect.left - tw - GAP
  } else if (pos === 'right') {
    top = rect.top + rect.height / 2 - th / 2
    left = rect.right + GAP
  } else {
    // top (default)
    top = rect.top - th - GAP
    left = rect.left + rect.width / 2 - tw / 2
  }

  // Clamp to viewport
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (left < 6) left = 6
  if (left + tw > vw - 6) left = vw - 6 - tw
  if (top < 4) {
    // Flip to bottom if no room on top
    top = rect.bottom + GAP
  }
  if (top + th > vh - 4) {
    // Flip to top if no room on bottom
    top = rect.top - th - GAP
  }

  el.style.left = Math.round(left) + 'px'
  el.style.top = Math.round(top) + 'px'
}

function show(target) {
  clearTimeout(hideTimeout)
  clearTimeout(showTimeout)
  currentTarget = target
  const el = getTooltipEl()
  const text = target.getAttribute('data-tooltip')
  if (!text) return

  showTimeout = setTimeout(() => {
    position(target)
    el.classList.add('is-visible')
  }, 80)
}

function hide() {
  clearTimeout(showTimeout)
  hideTimeout = setTimeout(() => {
    const el = getTooltipEl()
    el.classList.remove('is-visible')
    currentTarget = null
  }, 60)
}

function handleMouseOver(e) {
  const target = e.target.closest('[data-tooltip]')
  if (!target || !target.getAttribute('data-tooltip')) return
  // Already showing this target - skip (avoids re-triggering on child elements)
  if (target === currentTarget) return
  show(target)
}

function handleMouseOut(e) {
  if (!currentTarget) return
  const related = e.relatedTarget
  // If moving to another child of the same tooltip target, ignore
  if (related && currentTarget.contains(related)) return
  hide()
}

export function initTooltipSystem() {
  // mouseover/mouseout bubble - event delegation works reliably
  document.addEventListener('mouseover', handleMouseOver, false)
  document.addEventListener('mouseout', handleMouseOut, false)
  // Hide on scroll / click
  document.addEventListener('scroll', hide, true)
  document.addEventListener('mousedown', hide, true)
}

export function destroyTooltipSystem() {
  document.removeEventListener('mouseover', handleMouseOver, false)
  document.removeEventListener('mouseout', handleMouseOut, false)
  document.removeEventListener('scroll', hide, true)
  document.removeEventListener('mousedown', hide, true)
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null }
}
