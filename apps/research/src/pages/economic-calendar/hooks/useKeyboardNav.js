/**
 * useKeyboardNav — Keyboard shortcuts for the economic calendar.
 *
 * Keys:
 *   ArrowDown / j    → Focus next event
 *   ArrowUp / k      → Focus previous event
 *   Enter / Space    → Toggle expand on focused event
 *   Escape           → Close expanded → clear search → close filter
 *   ArrowLeft / h    → Previous date period
 *   ArrowRight / l   → Next date period
 *   1 / 2 / 3        → Switch to Day / Week / Month
 *   t                → Jump to today
 *   /                → Focus search input
 *   b                → Toggle bookmark on focused event
 */

import { useState, useEffect, useCallback } from 'react'

export default function useKeyboardNav({
  events = [],
  expandedEventId,
  onEventToggle,
  onDateChange,
  onViewChange,
  onToday,
  onSearchOpen,
  onFilterClose,
  onBookmarkToggle,
  searchOpen,
}) {
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const focusedEventId = events[focusedIndex]?.id || null

  // Reset focus when events change
  useEffect(() => {
    setFocusedIndex(-1)
  }, [events.length])

  // Scroll focused event into view
  useEffect(() => {
    if (focusedEventId) {
      const el = document.getElementById(`event-${focusedEventId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focusedEventId])

  const handleKeyDown = useCallback((e) => {
    // Don't capture when typing in an input
    const tag = e.target.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      // Only handle Escape in inputs
      if (e.key === 'Escape') {
        e.target.blur()
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault()
        setFocusedIndex((prev) => Math.min(prev + 1, events.length - 1))
        break

      case 'ArrowUp':
      case 'k':
        e.preventDefault()
        setFocusedIndex((prev) => Math.max(prev - 1, 0))
        break

      case 'Enter':
      case ' ':
        if (focusedEventId) {
          e.preventDefault()
          onEventToggle?.(focusedEventId)
        }
        break

      case 'Escape':
        e.preventDefault()
        if (expandedEventId) {
          onEventToggle?.(expandedEventId)
        } else if (searchOpen) {
          onSearchOpen?.()
        } else {
          onFilterClose?.()
        }
        break

      case 'ArrowLeft':
      case 'h':
        e.preventDefault()
        onDateChange?.(-1)
        break

      case 'ArrowRight':
      case 'l':
        e.preventDefault()
        onDateChange?.(1)
        break

      case '1':
        e.preventDefault()
        onViewChange?.('day')
        break

      case '2':
        e.preventDefault()
        onViewChange?.('week')
        break

      case '3':
        e.preventDefault()
        onViewChange?.('month')
        break

      case 't':
        e.preventDefault()
        onToday?.()
        break

      case '/':
        e.preventDefault()
        onSearchOpen?.()
        break

      case 'b':
        if (focusedEventId) {
          e.preventDefault()
          onBookmarkToggle?.(focusedEventId)
        }
        break

      default:
        break
    }
  }, [events, focusedEventId, expandedEventId, searchOpen, onEventToggle, onDateChange, onViewChange, onToday, onSearchOpen, onFilterClose, onBookmarkToggle])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { focusedEventId, focusedIndex, setFocusedIndex }
}
