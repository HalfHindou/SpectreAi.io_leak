/**
 * MobileBottomSheet - iOS-style bottom sheet for mobile actions
 * Used for options menus, confirmations, token details
 */
import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import AppPortal from '@/components/app-portal'
import { activateWatchlistSheet } from './sheet-lifecycle'
import { useTranslation } from 'react-i18next'
import './mobile-bottom-sheet.css'

const OpenSheet = ({
  onClose,
  title,
  children,
  showHandle = true,
}) => {
  const { t } = useTranslation()
  const sheetRef = useRef(null)
  const overlayRef = useRef(null)
  const closeRef = useRef(onClose)
  const titleId = useId()
  const dragDistance = useRef(0)
  const [isDragging, setIsDragging] = useState(false)
  const [startY, setStartY] = useState(0)
  const [currentY, setCurrentY] = useState(0)

  useLayoutEffect(() => { closeRef.current = onClose }, [onClose])
  useLayoutEffect(() => activateWatchlistSheet(sheetRef.current, overlayRef.current, () => closeRef.current?.()), [])

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return
    dragDistance.current = 0
    setIsDragging(true)
    setStartY(e.touches[0].clientY)
    setCurrentY(0)
  }

  const handleTouchMove = (e) => {
    if (!isDragging) return
    const deltaY = e.touches[0].clientY - startY
    dragDistance.current = Math.max(0, deltaY)
    setCurrentY(dragDistance.current)
  }

  const handleTouchEnd = (event) => {
    setIsDragging(false)
    if (dragDistance.current > 100) { // Threshold to close
      event.preventDefault()
      onClose?.()
    }
    setCurrentY(0)
  }

  return (
    <AppPortal>
    <div ref={overlayRef} className="mobile-bottom-sheet-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className={`mobile-bottom-sheet ${isDragging ? 'dragging' : ''}`}
        style={{ transform: currentY > 0 ? `translateY(${currentY}px)` : undefined }}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Drag handle */}
        {showHandle && (
          <div
            className="mobile-bottom-sheet-handle-area"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => { dragDistance.current = 0; setCurrentY(0); setIsDragging(false) }}
          >
            <div className="mobile-bottom-sheet-handle" />
          </div>
        )}

        {/* Header */}
        <div className="mobile-bottom-sheet-header">
            <h2 id={titleId} className="mobile-bottom-sheet-title">{title || t('watchlistPage.options', 'Options')}</h2>
            <button
              type="button"
              className="mobile-bottom-sheet-close"
              onClick={onClose}
              aria-label={t('common.close', 'Close')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

        {/* Content */}
        <div className="mobile-bottom-sheet-content">
          {children}
        </div>
      </div>
    </div>
    </AppPortal>
  )
}

// Unmount the open lifecycle so closed sheets cannot unlock another overlay.
const MobileBottomSheet = ({ isOpen, ...props }) => isOpen ? <OpenSheet {...props} /> : null

// Action list item for bottom sheet
export const BottomSheetAction = ({
  icon,
  label,
  description,
  onClick,
  destructive = false,
  disabled = false,
}) => (
  <button
    type="button"
    className={`mobile-bottom-sheet-action ${destructive ? 'destructive' : ''}`}
    onClick={onClick}
    disabled={disabled}
  >
    {icon && <span className="mobile-bottom-sheet-action-icon">{icon}</span>}
    <div className="mobile-bottom-sheet-action-text">
      <span className="mobile-bottom-sheet-action-label">{label}</span>
      {description && (
        <span className="mobile-bottom-sheet-action-desc">{description}</span>
      )}
    </div>
  </button>
)

export default MobileBottomSheet
