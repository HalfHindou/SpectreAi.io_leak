import { useCallback, useEffect, useState } from 'react'
import {
  getAnnotations,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
} from '@/services/rzLocalStorage'

const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#06B6D4', '#A78BFA']

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Per-token notes/annotations with timestamp + price snapshot.
 * Storage is keyed by symbol via rzLocalStorage.
 */
export default function useRzAnnotations({ symbol, currentPrice }) {
  const [annotations, setAnnotations] = useState([])

  // Load on symbol change
  useEffect(() => {
    if (!symbol) { setAnnotations([]); return }
    setAnnotations(getAnnotations(symbol))
  }, [symbol])

  const add = useCallback((text, opts = {}) => {
    if (!symbol) return null
    const cleanText = (text || '').trim()
    if (!cleanText) return null
    const note = {
      id: uid(),
      text: cleanText.slice(0, 280),
      ts: opts.ts ?? Date.now(),
      price: opts.price ?? (Number.isFinite(currentPrice) ? currentPrice : null),
      color: opts.color || COLORS[0],
      icon: opts.icon || 'pin',
      createdAt: Date.now(),
    }
    const next = addAnnotation(symbol, note)
    setAnnotations(next)
    return note
  }, [symbol, currentPrice])

  const update = useCallback((id, patch) => {
    if (!symbol) return
    const next = updateAnnotation(symbol, id, patch)
    setAnnotations(next)
  }, [symbol])

  const remove = useCallback((id) => {
    if (!symbol) return
    const next = removeAnnotation(symbol, id)
    setAnnotations(next)
  }, [symbol])

  return { annotations, add, update, remove, COLORS }
}

export { COLORS as ANNOTATION_COLORS }
