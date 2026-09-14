import { useLayoutEffect, useState } from 'react'
import { getAnchoredMenuStyle, getMenuSheetStyle } from '@/lib/anchored-menu'

/** Reposition only an open menu; preserve selection and open state across resizing. */
export function useAnchoredMenu({ open, isSheet, triggerRef, maxHeight = 260, gap = 4, sheetFraction = 0.75 }) {
  const [style, setStyle] = useState(null)

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null)
      return
    }
    let frame = 0
    const viewport = window.visualViewport
    const update = () => {
      frame = 0
      const trigger = triggerRef.current
      if (!trigger) return
      const bounds = {
        width: viewport?.width || document.documentElement.clientWidth,
        height: viewport?.height || window.innerHeight,
        left: viewport?.offsetLeft || 0,
        top: viewport?.offsetTop || 0,
        layoutHeight: window.innerHeight,
      }
      const next = isSheet
        ? getMenuSheetStyle(bounds, sheetFraction)
        : getAnchoredMenuStyle(trigger.getBoundingClientRect(), bounds, { maxHeight, gap })
      setStyle(previous => previous && Object.keys(next).every(key => next[key] === previous[key]) ? previous : next)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', schedule)
    // Capture nested page scrolling as menus are portaled to body.
    window.addEventListener('scroll', schedule, true)
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (triggerRef.current) observer?.observe(triggerRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
    }
  }, [open, isSheet, triggerRef, maxHeight, gap, sheetFraction])

  return style
}
