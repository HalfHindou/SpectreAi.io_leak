/**
 * useDragReorder - press-and-drag reordering for the Edit sheet rows.
 *
 * Pointer events, so one code path serves a thumb on the sheet and a mouse
 * on the desktop popover. The grip owns the gesture (`touch-action: none`
 * + pointer capture), the dragged row follows the pointer, the others slide
 * out of its way, and the new order is committed on release. Transforms are
 * written straight to the DOM - a React render per pointermove is wasted
 * work for a 12-row list.
 *
 * Usage:
 *   const drag = useDragReorder(order, setOrder)
 *   <div ref={drag.listRef}>
 *     <div {...drag.rowProps(key)} className={...drag.dragKey === key ? ' dragging' : ''}>
 *       <button {...drag.gripProps(key)} />
 */
import { useCallback, useRef, useState } from 'react'

const EDGE = 48       // px from the scroller edge where auto-scroll kicks in
const EDGE_STEP = 10  // px per pointermove while in that band

export default function useDragReorder(order, onReorder) {
  const listRef = useRef(null)
  const st = useRef(null)
  const [dragKey, setDragKey] = useState(null)

  const measure = useCallback(() => {
    const list = listRef.current
    if (!list) return null
    const scroller = list.closest('.lite-editpop-body') || list
    const sRect = scroller.getBoundingClientRect()
    const rows = []
    list.querySelectorAll('[data-drag-key]').forEach((el) => {
      const r = el.getBoundingClientRect()
      rows.push({ key: el.dataset.dragKey, el, top: r.top - sRect.top + scroller.scrollTop, h: r.height })
    })
    return { scroller, rows }
  }, [])

  const onPointerDown = useCallback((key) => (e) => {
    if (e.button != null && e.button !== 0) return
    const m = measure()
    if (!m) return
    const fromIdx = m.rows.findIndex((r) => r.key === key)
    if (fromIdx < 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) { /* old WebKit */ }
    const sRect = m.scroller.getBoundingClientRect()
    st.current = {
      key, fromIdx, toIdx: fromIdx,
      startY: e.clientY - sRect.top + m.scroller.scrollTop,
      ...m,
    }
    m.rows.forEach((r) => { r.el.style.transition = 'transform 0.16s ease' })
    m.rows[fromIdx].el.style.transition = 'none'
    setDragKey(key)
  }, [measure])

  const onPointerMove = useCallback((e) => {
    const s = st.current
    if (!s) return
    const sRect = s.scroller.getBoundingClientRect()
    // Auto-scroll the sheet body when the pointer sits near its edge.
    if (s.scroller.scrollHeight > s.scroller.clientHeight) {
      if (e.clientY < sRect.top + EDGE) s.scroller.scrollTop -= EDGE_STEP
      else if (e.clientY > sRect.bottom - EDGE) s.scroller.scrollTop += EDGE_STEP
    }
    const y = e.clientY - sRect.top + s.scroller.scrollTop
    const me = s.rows[s.fromIdx]
    // Keep the row inside the list: the Today sheet has fixed rows (Coin
    // rail, Thought) above and below the sortable block.
    const first = s.rows[0]
    const last = s.rows[s.rows.length - 1]
    const dy = Math.max(first.top - me.top, Math.min(last.top + last.h - me.h - me.top, y - s.startY))
    me.el.style.transform = `translateY(${dy}px)`
    const center = me.top + me.h / 2 + dy
    // Rows above count once the dragged centre reaches theirs, rows below
    // likewise - inclusive on both sides so a drop at the clamped edge (where
    // the centres coincide exactly) lands on the first/last slot, not next to it.
    let toIdx = s.fromIdx
    s.rows.forEach((r, i) => {
      const c = r.top + r.h / 2
      if (i < s.fromIdx && c >= center) toIdx -= 1
      else if (i > s.fromIdx && c <= center) toIdx += 1
    })
    s.toIdx = toIdx
    s.rows.forEach((r, i) => {
      if (i === s.fromIdx) return
      let shift = 0
      if (i < s.fromIdx && i >= toIdx) shift = me.h
      else if (i > s.fromIdx && i <= toIdx) shift = -me.h
      r.el.style.transform = shift ? `translateY(${shift}px)` : ''
    })
  }, [])

  const onPointerUp = useCallback(() => {
    const s = st.current
    if (!s) return
    st.current = null
    s.rows.forEach((r) => { r.el.style.transform = ''; r.el.style.transition = '' })
    setDragKey(null)
    if (s.toIdx !== s.fromIdx) {
      const next = order.filter((k) => k !== s.key)
      next.splice(s.toIdx, 0, s.key)
      onReorder?.(next)
    }
  }, [order, onReorder])

  const rowProps = useCallback((key) => ({ 'data-drag-key': key }), [])
  const gripProps = useCallback((key) => ({
    onPointerDown: onPointerDown(key),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }), [onPointerDown, onPointerMove, onPointerUp])

  return { listRef, dragKey, rowProps, gripProps }
}
