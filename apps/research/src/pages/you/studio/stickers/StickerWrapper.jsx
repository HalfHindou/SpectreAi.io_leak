import { useState, useRef, useCallback, useEffect } from 'react'
import './StickerWrapper.css'

/**
 * StickerWrapper — Provides drag / resize / delete / select chrome
 * around any sticker component rendered as children.
 *
 * Position is stored as 0-1 fractions of canvas size; this wrapper
 * converts them to percentage-based absolute positioning.
 */
export default function StickerWrapper({
  sticker,
  isSelected,
  onSelect,
  onUpdate,
  onRemove,
  onBringToFront,
  canvasRef,
  themeId,
  children,
  maintainAspect = true,
}) {
  const wrapRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [entered, setEntered] = useState(false)

  // Entrance animation — trigger on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // ─── Drag ──────────────────────────────────────────────

  const handlePointerDown = useCallback((e) => {
    // Don't drag from interactive elements inside the sticker
    const tag = e.target.tagName
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (e.target.closest('.studio-fn-interactive')) return
    if (e.target.closest('.studio-sticker-resize')) return
    if (e.target.closest('.studio-sticker-delete')) return

    // Locked stickers can't be dragged
    if (sticker.locked) {
      onSelect()
      return
    }

    e.preventDefault()
    onSelect()
    onBringToFront()

    const canvas = canvasRef?.current
    if (!canvas) return

    const canvasRect = canvas.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const startStickerX = sticker.x
    const startStickerY = sticker.y

    setIsDragging(true)

    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / canvasRect.width
      const dy = (moveEvent.clientY - startY) / canvasRect.height
      onUpdate({
        x: Math.max(0, Math.min(1, startStickerX + dx)),
        y: Math.max(0, Math.min(1, startStickerY + dy)),
      })
    }

    const onUp = () => {
      setIsDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [sticker.x, sticker.y, sticker.locked, canvasRef, onSelect, onUpdate, onBringToFront])

  // ─── Resize ────────────────────────────────────────────

  const handleResizeDown = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()

    const canvas = canvasRef?.current
    if (!canvas) return

    const canvasRect = canvas.getBoundingClientRect()
    const startX = e.clientX
    const startScale = sticker.scale

    // Scale sensitivity: ~1.0 per 200px of horizontal drag
    const sensitivity = 200

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX
      const newScale = Math.max(0.3, Math.min(4, startScale + dx / sensitivity))
      onUpdate({ scale: Math.round(newScale * 100) / 100 })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [sticker.scale, canvasRef, onUpdate])

  // ─── Delete ────────────────────────────────────────────

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    setIsRemoving(true)
    // Wait for exit animation before removing from state
    setTimeout(() => {
      onRemove()
    }, 220)
  }, [onRemove])

  // ─── Styles ────────────────────────────────────────────

  const wrapStyle = {
    position: 'absolute',
    left: `${sticker.x * 100}%`,
    top: `${sticker.y * 100}%`,
    zIndex: sticker.zIndex,
    transform: [
      'translate(-50%, -50%)',
      `scale(${sticker.scale})`,
      sticker.rotation ? `rotate(${sticker.rotation}deg)` : '',
      // Entrance animation
      !entered ? 'scale(0.85)' : '',
      // Exit animation
      isRemoving ? 'scale(0.85)' : '',
    ].filter(Boolean).join(' '),
    opacity: isRemoving ? 0 : (entered ? sticker.opacity : 0),
    transition: isDragging
      ? 'none'
      : isRemoving
        ? 'transform 220ms ease-out, opacity 220ms ease-out'
        : 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 350ms cubic-bezier(0.16, 1, 0.3, 1)',
    cursor: sticker.locked ? 'default' : (isDragging ? 'grabbing' : 'grab'),
    userSelect: 'none',
    touchAction: 'none',
    display: sticker.visible ? undefined : 'none',
  }

  const classNames = [
    'studio-sticker-wrap',
    isSelected && 'selected',
    isDragging && 'dragging',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={wrapRef}
      className={classNames}
      style={wrapStyle}
      onPointerDown={handlePointerDown}
      data-sticker-id={sticker.id}
      data-theme={themeId}
    >
      {/* Sticker content */}
      {children}

      {/* Delete button — visible on hover */}
      <button
        className="studio-sticker-delete"
        onClick={handleDelete}
        aria-label="Remove sticker"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </button>

      {/* Resize handle — bottom-right, visible on hover */}
      {!sticker.locked && (
        <div
          className="studio-sticker-resize"
          onPointerDown={handleResizeDown}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
            <line x1="9" y1="1" x2="1" y2="9" />
            <line x1="9" y1="5" x2="5" y2="9" />
          </svg>
        </div>
      )}
    </div>
  )
}
