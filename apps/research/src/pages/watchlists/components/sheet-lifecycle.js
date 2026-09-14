const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]'

/** Own focus, scroll and viewport only while the Watchlists action sheet is open. */
export function activateWatchlistSheet(sheet, overlay, onClose) {
  const doc = sheet.ownerDocument
  const win = doc.defaultView
  const viewport = win.visualViewport
  const opener = doc.activeElement
  const roots = [doc.body, doc.querySelector('.app-main-content')].filter(Boolean)
  const previousOverflow = roots.map(node => node.style.overflow)
  roots.forEach(node => { node.style.overflow = 'hidden' })
  const targets = () => [...sheet.querySelectorAll(FOCUSABLE)].filter(node => (
    node.tabIndex >= 0 && !node.disabled && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0
  ))
  const focusFirst = () => (targets()[0] || sheet).focus({ preventScroll: true })
  const onKey = event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab') {
      const items = targets()
      const first = items[0] || sheet
      const last = items[items.length - 1] || sheet
      if (!items.length || !items.includes(doc.activeElement) || (event.shiftKey ? doc.activeElement === first : doc.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
      }
    }
  }
  const onFocus = event => { if (!sheet.contains(event.target)) focusFirst() }
  const measure = () => {
    const values = {
      height: viewport?.height || win.innerHeight,
      width: viewport?.width || doc.documentElement.clientWidth,
      top: viewport?.offsetTop || 0,
      left: viewport?.offsetLeft || 0,
    }
    Object.entries(values).forEach(([key, value]) => overlay.style.setProperty(`--sheet-viewport-${key}`, `${value}px`))
  }
  measure()
  doc.addEventListener('keydown', onKey, true)
  doc.addEventListener('focusin', onFocus)
  win.addEventListener('resize', measure)
  viewport?.addEventListener('resize', measure)
  viewport?.addEventListener('scroll', measure)
  focusFirst()
  let released = false
  return () => {
    if (released) return
    released = true
    doc.removeEventListener('keydown', onKey, true)
    doc.removeEventListener('focusin', onFocus)
    win.removeEventListener('resize', measure)
    viewport?.removeEventListener('resize', measure)
    viewport?.removeEventListener('scroll', measure)
    roots.forEach((node, i) => { node.style.overflow = previousOverflow[i] })
    // Do not steal focus from another dialog opened by an action in this one.
    if (opener?.isConnected && (sheet.contains(doc.activeElement) || doc.activeElement === doc.body)) {
      opener.focus({ preventScroll: true })
    }
  }
}
