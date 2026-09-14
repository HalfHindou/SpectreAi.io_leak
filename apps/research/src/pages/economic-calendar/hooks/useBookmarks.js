/**
 * useBookmarks — Persist bookmarked event IDs in localStorage.
 * Key: spectre:calendar-bookmarks
 */

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'spectre:calendar-bookmarks'

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const { ids } = JSON.parse(raw)
      return new Set(ids || [])
    }
  } catch { /* ignore */ }
  return new Set()
}

function saveBookmarks(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [...ids] }))
  } catch { /* ignore */ }
}

export default function useBookmarks() {
  const [bookmarkedIds, setBookmarkedIds] = useState(loadBookmarks)

  const toggleBookmark = useCallback((eventId) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      saveBookmarks(next)
      return next
    })
  }, [])

  const isBookmarked = useCallback(
    (eventId) => bookmarkedIds.has(eventId),
    [bookmarkedIds]
  )

  const reorderBookmarks = useCallback((fromIndex, toIndex) => {
    setBookmarkedIds((prev) => {
      const arr = [...prev]
      if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex >= arr.length) return prev
      const [moved] = arr.splice(fromIndex, 1)
      arr.splice(toIndex, 0, moved)
      const next = new Set(arr)
      saveBookmarks(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setBookmarkedIds(new Set())
    saveBookmarks(new Set())
  }, [])

  return { bookmarkedIds, toggleBookmark, isBookmarked, reorderBookmarks, clearAll }
}
