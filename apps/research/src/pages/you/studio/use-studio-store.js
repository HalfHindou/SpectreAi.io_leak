import { useState, useCallback } from 'react'

const STORAGE_KEY = 'spectre:you-studio-v2'
const MAX_HISTORY = 50

/** Generate a unique ID for sticker instances */
function uid() {
  return Date.now() + Math.random().toString(36).slice(2, 6)
}

/** Safe localStorage read */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) { console.error(_) }
  return null
}

/** Safe localStorage write (excludes history from persistence) */
function saveState(state) {
  try {
    const { history, ...rest } = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest))
  } catch (_) { console.error(_) }
}

const DEFAULT_STATE = {
  theme: 'zen-minimal',
  stickers: [],
  panelOpen: true,
  panelTab: 'add',
  selectedSticker: null,
  history: [],
}

/**
 * Studio state hook — manages sticker canvas, theme, panel, undo.
 * Persists to localStorage (excluding undo history).
 * Convention: useState + useCallback, matching use-you-layout.js pattern.
 */
export default function useStudioStore() {
  const [state, setState] = useState(() => {
    const saved = loadState()
    return saved
      ? { ...DEFAULT_STATE, ...saved, history: [] }
      : { ...DEFAULT_STATE }
  })

  /** Push current stickers to history before a mutation */
  const pushHistory = useCallback((currentStickers) => {
    setState(prev => {
      const next = {
        ...prev,
        history: [
          ...prev.history.slice(-(MAX_HISTORY - 1)),
          currentStickers,
        ],
      }
      return next
    })
  }, [])

  /** Internal: update state and persist */
  const update = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }
      saveState(next)
      return next
    })
  }, [])

  // ─── Sticker Operations ─────────────────────────────────

  const addSticker = useCallback((type, overrides = {}) => {
    update(prev => {
      const history = [
        ...prev.history.slice(-(MAX_HISTORY - 1)),
        prev.stickers,
      ]
      const maxZ = prev.stickers.reduce((max, s) => Math.max(max, s.zIndex), 0)
      // Random open position (avoid exact center cluster)
      const x = 0.15 + Math.random() * 0.6
      const y = 0.15 + Math.random() * 0.5
      const sticker = {
        id: uid(),
        type,
        x,
        y,
        scale: 1,
        rotation: 0,
        opacity: 1,
        zIndex: maxZ + 1,
        token: 'BTC',
        visible: true,
        locked: false,
        data: {},
        ...overrides,
      }
      return {
        ...prev,
        stickers: [...prev.stickers, sticker],
        selectedSticker: sticker.id,
        history,
      }
    })
  }, [update])

  const removeSticker = useCallback((id) => {
    update(prev => {
      const history = [
        ...prev.history.slice(-(MAX_HISTORY - 1)),
        prev.stickers,
      ]
      return {
        ...prev,
        stickers: prev.stickers.filter(s => s.id !== id),
        selectedSticker: prev.selectedSticker === id ? null : prev.selectedSticker,
        history,
      }
    })
  }, [update])

  const updateSticker = useCallback((id, updates) => {
    update(prev => {
      const history = [
        ...prev.history.slice(-(MAX_HISTORY - 1)),
        prev.stickers,
      ]
      return {
        ...prev,
        stickers: prev.stickers.map(s =>
          s.id === id ? { ...s, ...updates } : s
        ),
        history,
      }
    })
  }, [update])

  const bringToFront = useCallback((id) => {
    update(prev => {
      const maxZ = prev.stickers.reduce((max, s) => Math.max(max, s.zIndex), 0)
      return {
        ...prev,
        stickers: prev.stickers.map(s =>
          s.id === id ? { ...s, zIndex: maxZ + 1 } : s
        ),
      }
    })
  }, [update])

  const selectSticker = useCallback((id) => {
    update(prev => ({ ...prev, selectedSticker: id }))
  }, [update])

  // ─── Theme / Panel ──────────────────────────────────────

  const setTheme = useCallback((id) => {
    update(prev => ({ ...prev, theme: id }))
  }, [update])

  const setPanelOpen = useCallback((open) => {
    update(prev => ({ ...prev, panelOpen: open }))
  }, [update])

  const setPanelTab = useCallback((tab) => {
    update(prev => ({ ...prev, panelTab: tab }))
  }, [update])

  // ─── Canvas Operations ──────────────────────────────────

  const loadPreset = useCallback((preset) => {
    update(prev => {
      const history = [
        ...prev.history.slice(-(MAX_HISTORY - 1)),
        prev.stickers,
      ]
      // Stagger sticker positions so they don't pile up
      const stickers = (preset || []).map((s, i) => ({
        id: uid(),
        type: s.type || 'big-price',
        x: s.x ?? 0.1 + (i % 4) * 0.2,
        y: s.y ?? 0.1 + Math.floor(i / 4) * 0.25,
        scale: s.scale ?? 1,
        rotation: s.rotation ?? 0,
        opacity: s.opacity ?? 1,
        zIndex: s.zIndex ?? i + 1,
        token: s.token ?? 'BTC',
        visible: s.visible ?? true,
        locked: s.locked ?? false,
        data: s.data ?? {},
      }))
      return {
        ...prev,
        stickers,
        selectedSticker: null,
        history,
      }
    })
  }, [update])

  const clearCanvas = useCallback(() => {
    update(prev => {
      const history = [
        ...prev.history.slice(-(MAX_HISTORY - 1)),
        prev.stickers,
      ]
      return {
        ...prev,
        stickers: [],
        selectedSticker: null,
        history,
      }
    })
  }, [update])

  const undo = useCallback(() => {
    update(prev => {
      if (prev.history.length === 0) return prev
      const previousStickers = prev.history[prev.history.length - 1]
      return {
        ...prev,
        stickers: previousStickers,
        selectedSticker: null,
        history: prev.history.slice(0, -1),
      }
    })
  }, [update])

  const reorderStickers = useCallback((ids) => {
    update(prev => ({
      ...prev,
      stickers: prev.stickers.map(s => {
        const idx = ids.indexOf(s.id)
        return idx !== -1 ? { ...s, zIndex: idx + 1 } : s
      }),
    }))
  }, [update])

  return {
    // State
    theme: state.theme,
    stickers: state.stickers,
    panelOpen: state.panelOpen,
    panelTab: state.panelTab,
    selectedSticker: state.selectedSticker,
    canUndo: state.history.length > 0,

    // Sticker ops
    addSticker,
    removeSticker,
    updateSticker,
    bringToFront,
    selectSticker,

    // Theme / Panel
    setTheme,
    setPanelOpen,
    setPanelTab,

    // Canvas ops
    loadPreset,
    clearCanvas,
    undo,
    reorderStickers,

    // Compatibility alias — index.jsx accesses studio.config.elements
    config: { elements: state.stickers },
  }
}
