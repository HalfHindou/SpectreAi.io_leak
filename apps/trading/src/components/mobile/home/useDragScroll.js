/**
 * useDragScroll — makes a horizontal overflow row scrollable everywhere:
 *   - touch: native pan (untouched)
 *   - mouse: press-and-drag scrolls; a real drag suppresses the click
 *   - wheel/trackpad: vertical delta translates to horizontal scroll
 *
 * Also stamps `data-fade="1"` on the element while more content hides past
 * the right edge — CSS uses it for an edge-fade affordance.
 *
 * Usage: const ref = useDragScroll(); <div ref={ref} className="row"> …
 */
import { useRef, useEffect } from 'react'

export default function useDragScroll() {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    let down = false
    let moved = false
    let startX = 0
    let startLeft = 0

    const updateFade = () => {
      const more = el.scrollWidth - el.clientWidth - el.scrollLeft > 2
      if (more) el.setAttribute('data-fade', '1')
      else el.removeAttribute('data-fade')
    }

    const onDown = (e) => {
      down = true
      moved = false
      startX = e.clientX
      startLeft = el.scrollLeft
    }
    const onMove = (e) => {
      if (!down) return
      const dx = e.clientX - startX
      if (Math.abs(dx) > 4) moved = true
      el.scrollLeft = startLeft - dx
    }
    const onUp = () => { down = false }
    // A drag must not fire the tab underneath on release.
    const onClickCapture = (e) => {
      if (moved) {
        e.stopPropagation()
        e.preventDefault()
        moved = false
      }
    }
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }

    updateFade()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateFade) : null
    ro?.observe(el)

    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    el.addEventListener('click', onClickCapture, true)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', updateFade, { passive: true })

    return () => {
      ro?.disconnect()
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      el.removeEventListener('click', onClickCapture, true)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', updateFade)
    }
  }, [])

  return ref
}
