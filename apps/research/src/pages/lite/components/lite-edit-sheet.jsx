/**
 * LiteEditPop - the "Edit" popover shared by Today and Stocks.
 *
 * Desktop: the same anchored dropdown it always was.
 * Mobile (<=768px): a bottom sheet with a scrim, grab handle, title and Done -
 * the fixed dropdown pinned under the topbar read as a floating card that
 * fought the page scroll, and half its toggles sat under the thumb's reach.
 * Drag the handle down (or tap the scrim / press back) to close.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/useMediaQuery'
import useBackDismiss from '@/hooks/use-back-dismiss'

const DISMISS_PX = 90

/**
 * useSheetDrag - the bottom-sheet gesture, shared by every LITE sheet.
 * Drag the head down past DISMISS_PX (or call `close`) and the sheet plays
 * its slide-down before `onClose` fires. `open` resets the closing flag for
 * hosts that stay mounted between openings.
 */
export function useSheetDrag(onClose, open = true) {
  const sheetRef = useRef(null)
  const dragRef = useRef({ y0: 0, dy: 0, active: false })
  const [closing, setClosing] = useState(false)

  useEffect(() => { if (!open) setClosing(false) }, [open])

  const close = () => {
    if (closing) return
    setClosing(true)
    // Let the slide-down play before the node unmounts.
    setTimeout(() => onClose?.(), 220)
  }

  const onTouchStart = (e) => {
    dragRef.current = { y0: e.touches[0].clientY, dy: 0, active: true }
    if (sheetRef.current) sheetRef.current.style.transition = 'none'
  }
  const onTouchMove = (e) => {
    const d = dragRef.current
    if (!d.active) return
    d.dy = Math.max(0, e.touches[0].clientY - d.y0)
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${d.dy}px)`
  }
  const onTouchEnd = () => {
    const d = dragRef.current
    if (!d.active) return
    d.active = false
    const el = sheetRef.current
    if (el) el.style.transition = ''
    if (d.dy > DISMISS_PX) {
      close()
    } else if (el) {
      el.style.transform = ''
    }
  }

  return {
    sheetRef,
    closing,
    close,
    headProps: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  }
}

export default function LiteEditPop({ open, onClose, label, title, children }) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { sheetRef, closing, close, headProps } = useSheetDrag(onClose, open)
  const popRef = useRef(null)

  useBackDismiss(open && isMobile, onClose)

  // Desktop: a click anywhere outside the popover (and outside the button
  // that opened it - its wrap is the popover's parent) closes it, as does
  // Escape. Without this the only way out was the Edit button itself.
  useEffect(() => {
    if (!open || isMobile || typeof document === 'undefined') return undefined
    const away = (e) => {
      const wrap = popRef.current?.parentElement
      if (wrap && !wrap.contains(e.target)) onClose?.()
    }
    // 🪤 Capture phase: LITE's root exits the whole mode on a bubbled Escape.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose?.()
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, isMobile, onClose])

  // Lock the page behind the sheet - the scrim is fixed, but a touch-drag on
  // it would still scroll the document underneath.
  useEffect(() => {
    if (!open || !isMobile || typeof document === 'undefined') return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open, isMobile])

  if (!open) return null

  if (!isMobile) {
    return (
      <div ref={popRef} className="lite-editpop" role="group" aria-label={label}>
        {children}
      </div>
    )
  }

  // Portal out of .lite-main: it is its own stacking context (z-index 2), so
  // anything inside it - however high its z-index - paints UNDER the sibling
  // tab bar (z 40). .lite-root keeps the glass/paper look classes in scope.
  const host = document.querySelector('.lite-root') || document.body

  return createPortal(
    <>
      <div
        className={`lite-editpop-scrim${closing ? ' closing' : ''}`}
        onClick={close}
        aria-hidden
      />
      <div
        ref={sheetRef}
        className={`lite-editpop lite-editpop--sheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className="lite-editpop-head" {...headProps}>
          <span className="lite-editpop-grab" aria-hidden />
          <div className="lite-editpop-headrow">
            <strong className="lite-editpop-heading">{title || t('lite.sections', 'Sections')}</strong>
          </div>
        </div>
        <div className="lite-editpop-body">
          {children}
        </div>
        <div className="lite-editpop-foot">
          <button type="button" className="lite-editpop-done" onClick={close}>
            {t('lite.done', 'Done')}
          </button>
        </div>
      </div>
    </>,
    host,
  )
}
