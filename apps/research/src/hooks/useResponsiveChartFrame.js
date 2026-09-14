import { useLayoutEffect, useState } from 'react'

/** Measure the chart's own available space, including wrapped controls. */
export function useResponsiveChartFrame(enabled, frameRef, controlsRef, redraw) {
  const [layout, setLayout] = useState({ compact: true, toolbarHeight: 0 })
  useLayoutEffect(() => {
    if (!enabled || !frameRef.current || !controlsRef.current) return
    const frame = frameRef.current
    const controls = controlsRef.current
    const body = frame.querySelector('.chart-content-area')
    let pending = 0
    let previous = ''
    const measure = () => {
      pending = 0
      const width = frame.clientWidth
      const toolbarHeight = Math.ceil(controls.getBoundingClientRect().height)
      const dimensions = `${width}:${toolbarHeight}:${body?.clientWidth}:${body?.clientHeight}:${window.devicePixelRatio || 1}`
      if (!width || dimensions === previous) return
      previous = dimensions
      setLayout(current => current.compact === (width < 1040) && current.toolbarHeight === toolbarHeight
        ? current : { compact: width < 1040, toolbarHeight })
      // Native canvas size and TA hit testing share the existing redraw path.
      redraw(value => value + 1)
    }
    const schedule = () => { if (!pending) pending = requestAnimationFrame(measure) }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(frame)
    observer?.observe(controls)
    if (body) observer?.observe(body)
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      cancelAnimationFrame(pending)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [enabled, frameRef, controlsRef, redraw])
  return layout
}
