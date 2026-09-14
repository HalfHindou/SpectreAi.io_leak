import { useEffect } from 'react'

/**
 * useXfvTooltip - global event-delegated tooltip portal for XFullView.
 *
 * The CSS-only `::after` approach gets clipped by `.xfv-panel-body`'s
 * `overflow-y: auto`, so panel-internal anchors (column headers, meta chips)
 * never showed their tooltip bubble. This hook works around that by:
 *
 *   1. Mounting a single fixed-position `<div class="xfv-tooltip-portal">`
 *      on document.body (so it escapes every overflow ancestor).
 *   2. Listening for `mouseover` / `mouseout` on document with delegation -
 *      any element matching `[data-xfv-tip]` becomes a hover anchor.
 *   3. Positioning the portal directly above the anchor, flipping below when
 *      the anchor is too close to the viewport top.
 *
 * Mount once at the XFullView root. Cleanup tears down both the portal and
 * the listeners on unmount.
 */
export default function useXfvTooltip() {
  useEffect(() => {
    // Create portal element once
    const portal = document.createElement('div')
    portal.className = 'xfv-tooltip-portal'
    portal.setAttribute('role', 'tooltip')
    portal.setAttribute('aria-hidden', 'true')
    document.body.appendChild(portal)

    let activeAnchor = null

    function findAnchor(target) {
      if (!(target instanceof Element)) return null
      return target.closest('[data-xfv-tip]')
    }

    function position(anchor) {
      const text = anchor.getAttribute('data-xfv-tip')
      if (!text) return
      portal.textContent = text
      portal.classList.add('xfv-tooltip-portal--visible')

      // Measure after content is set
      const anchorRect = anchor.getBoundingClientRect()
      const portalRect = portal.getBoundingClientRect()
      const margin = 8
      const gap = 8

      // Horizontally centered on the anchor, clamped to viewport
      let left = anchorRect.left + anchorRect.width / 2 - portalRect.width / 2
      left = Math.max(margin, Math.min(left, window.innerWidth - portalRect.width - margin))

      // Above anchor by default; flip below if not enough room
      let top = anchorRect.top - portalRect.height - gap
      let placement = 'top'
      if (top < margin) {
        top = anchorRect.bottom + gap
        placement = 'bottom'
      }

      portal.style.left = `${Math.round(left)}px`
      portal.style.top = `${Math.round(top)}px`
      portal.dataset.placement = placement
    }

    function show(anchor) {
      activeAnchor = anchor
      position(anchor)
    }

    function hide() {
      activeAnchor = null
      portal.classList.remove('xfv-tooltip-portal--visible')
    }

    function onMouseOver(e) {
      const anchor = findAnchor(e.target)
      if (!anchor) return
      if (anchor === activeAnchor) return
      show(anchor)
    }

    function onMouseOut(e) {
      const anchor = findAnchor(e.target)
      if (!anchor) return
      // Only hide when leaving to a node that is NOT inside the same anchor
      if (e.relatedTarget && anchor.contains(e.relatedTarget)) return
      hide()
    }

    function onScrollOrResize() {
      if (activeAnchor && document.contains(activeAnchor)) {
        position(activeAnchor)
      } else {
        hide()
      }
    }

    document.addEventListener('mouseover', onMouseOver, true)
    document.addEventListener('mouseout', onMouseOut, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)

    return () => {
      document.removeEventListener('mouseover', onMouseOver, true)
      document.removeEventListener('mouseout', onMouseOut, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      portal.remove()
    }
  }, [])
}
