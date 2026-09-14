import { useState, useCallback, useEffect } from 'react'
import DEFAULT_LAYOUT, { getDefaultWidgetIds } from './you-default-layout'

/**
 * Multi-dashboard storage shape (LAYOUT_VERSION 7+):
 *
 *   spectre:you-dashboards = {
 *     current: '<uuid>',
 *     order: ['<uuid>', '<uuid>', ...],
 *     dashboards: {
 *       '<uuid>': { id, name, layout: [...], widgets: [...], createdAt, updatedAt },
 *       ...
 *     }
 *   }
 *
 * Backward compat: if the legacy keys (spectre:you-layout +
 * spectre:you-widgets) exist on first load, they're imported into a single
 * "Default" dashboard, then deleted.
 */

const STORAGE_DASHBOARDS    = 'spectre:you-dashboards'
const VERSION_KEY           = 'spectre:you-version'
const LEGACY_STORAGE_LAYOUT = 'spectre:you-layout'
const LEGACY_STORAGE_WIDGETS = 'spectre:you-widgets'
const LAYOUT_VERSION = 7

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function freshDefault() {
  const id = uuid()
  const now = Date.now()
  return {
    current: id,
    order: [id],
    dashboards: {
      [id]: {
        id,
        name: 'Default',
        layout: DEFAULT_LAYOUT,
        widgets: getDefaultWidgetIds(),
        createdAt: now,
        updatedAt: now,
      },
    },
  }
}

function migrateLegacyIfPresent() {
  try {
    const layoutRaw = localStorage.getItem(LEGACY_STORAGE_LAYOUT)
    const widgetsRaw = localStorage.getItem(LEGACY_STORAGE_WIDGETS)
    if (!layoutRaw && !widgetsRaw) return null

    const id = uuid()
    const now = Date.now()
    const out = {
      current: id,
      order: [id],
      dashboards: {
        [id]: {
          id,
          name: 'Default',
          layout: layoutRaw ? JSON.parse(layoutRaw) : DEFAULT_LAYOUT,
          widgets: widgetsRaw ? JSON.parse(widgetsRaw) : getDefaultWidgetIds(),
          createdAt: now,
          updatedAt: now,
        },
      },
    }
    // Clean up legacy keys so we don't re-migrate
    localStorage.removeItem(LEGACY_STORAGE_LAYOUT)
    localStorage.removeItem(LEGACY_STORAGE_WIDGETS)
    return out
  } catch {
    return null
  }
}

function loadStore() {
  try {
    const versioned = localStorage.getItem(VERSION_KEY)
    if (versioned !== String(LAYOUT_VERSION)) {
      // Bumping the version migrates legacy keys forward where possible,
      // otherwise starts fresh. Either way write the new version marker.
      const migrated = migrateLegacyIfPresent() || freshDefault()
      localStorage.setItem(STORAGE_DASHBOARDS, JSON.stringify(migrated))
      localStorage.setItem(VERSION_KEY, String(LAYOUT_VERSION))
      return migrated
    }

    const raw = localStorage.getItem(STORAGE_DASHBOARDS)
    if (!raw) {
      const fresh = freshDefault()
      localStorage.setItem(STORAGE_DASHBOARDS, JSON.stringify(fresh))
      return fresh
    }
    const parsed = JSON.parse(raw)
    // Defensive: ensure shape is intact
    if (!parsed || !parsed.dashboards || !parsed.current || !parsed.dashboards[parsed.current]) {
      const fresh = freshDefault()
      localStorage.setItem(STORAGE_DASHBOARDS, JSON.stringify(fresh))
      return fresh
    }
    return parsed
  } catch {
    return freshDefault()
  }
}

function persistNow(store) {
  try { localStorage.setItem(STORAGE_DASHBOARDS, JSON.stringify(store)) } catch { /* ignore */ }
}

// Debounce localStorage writes so rapid layout changes (drag/resize) don't
// JSON.stringify the whole multi-dashboard blob on every state tick. Last
// write wins; pending writes are flushed on unload as a safety net.
let persistTimer = null
let pendingStore = null
function persist(store) {
  pendingStore = store
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    if (pendingStore) {
      persistNow(pendingStore)
      pendingStore = null
    }
  }, 300)
}

function flushPending() {
  if (pendingStore) {
    persistNow(pendingStore)
    pendingStore = null
  }
}

// Flush on tab-hide (mobile/iOS-safe) and unload. Module-level guard prevents
// duplicate listeners across HMR re-evaluations.
if (typeof window !== 'undefined' && !window.__spectreYouLayoutFlushBound) {
  window.__spectreYouLayoutFlushBound = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending()
  })
  window.addEventListener('pagehide', flushPending)
}

/**
 * Manages multi-dashboard widget grid state for Spectre YOU.
 * Persists to localStorage. Each dashboard has its own UUID, name, layout
 * and active widgets — switchable via the toolbar.
 */
export default function useYouLayout() {
  const [store, setStore] = useState(() => loadStore())

  const current = store.dashboards[store.current]
  const layout = current?.layout || DEFAULT_LAYOUT
  const activeWidgets = current?.widgets || getDefaultWidgetIds()

  const updateCurrent = useCallback((mutator) => {
    setStore(prev => {
      const c = prev.dashboards[prev.current]
      if (!c) return prev
      const updated = mutator(c)
      if (updated === c) return prev
      const next = {
        ...prev,
        dashboards: { ...prev.dashboards, [prev.current]: { ...updated, updatedAt: Date.now() } },
      }
      persist(next)
      return next
    })
  }, [])

  const onLayoutChange = useCallback((newLayout) => {
    updateCurrent(c => ({ ...c, layout: newLayout }))
  }, [updateCurrent])

  const addWidget = useCallback((widgetId, gridItem) => {
    updateCurrent(c => {
      if (c.widgets.includes(widgetId)) return c
      return {
        ...c,
        widgets: [...c.widgets, widgetId],
        layout: gridItem ? [...c.layout, gridItem] : c.layout,
      }
    })
  }, [updateCurrent])

  const removeWidget = useCallback((widgetId) => {
    updateCurrent(c => ({
      ...c,
      widgets: c.widgets.filter(id => id !== widgetId),
      layout: c.layout.filter(item => item.i !== widgetId),
    }))
  }, [updateCurrent])

  const replaceLayout = useCallback((newLayout, newWidgetIds) => {
    const ids = Array.isArray(newWidgetIds) && newWidgetIds.length > 0
      ? newWidgetIds
      : Array.isArray(newLayout) ? newLayout.map(it => it.i) : []
    updateCurrent(c => ({
      ...c,
      layout: Array.isArray(newLayout) ? newLayout : [],
      widgets: ids,
    }))
  }, [updateCurrent])

  const resetLayout = useCallback(() => {
    updateCurrent(c => ({ ...c, layout: DEFAULT_LAYOUT, widgets: getDefaultWidgetIds() }))
  }, [updateCurrent])

  // ── Multi-dashboard ops ──────────────────────────────────────

  const dashboards = store.order
    .map(id => store.dashboards[id])
    .filter(Boolean)

  const createDashboard = useCallback((name = 'Untitled') => {
    const id = uuid()
    const now = Date.now()
    setStore(prev => {
      const next = {
        ...prev,
        current: id,
        order: [...prev.order, id],
        dashboards: {
          ...prev.dashboards,
          [id]: { id, name, layout: [], widgets: [], createdAt: now, updatedAt: now },
        },
      }
      persist(next)
      return next
    })
    return id
  }, [])

  const switchDashboard = useCallback((id) => {
    setStore(prev => {
      if (!prev.dashboards[id] || prev.current === id) return prev
      const next = { ...prev, current: id }
      persist(next)
      return next
    })
  }, [])

  const renameDashboard = useCallback((id, name) => {
    setStore(prev => {
      const c = prev.dashboards[id]
      if (!c) return prev
      const next = {
        ...prev,
        dashboards: { ...prev.dashboards, [id]: { ...c, name, updatedAt: Date.now() } },
      }
      persist(next)
      return next
    })
  }, [])

  const deleteDashboard = useCallback((id) => {
    setStore(prev => {
      if (!prev.dashboards[id]) return prev
      // Refuse to delete the last dashboard — always keep at least one.
      if (prev.order.length <= 1) return prev
      const newOrder = prev.order.filter(x => x !== id)
      const newDashboards = { ...prev.dashboards }
      delete newDashboards[id]
      const newCurrent = prev.current === id ? newOrder[0] : prev.current
      const next = { ...prev, current: newCurrent, order: newOrder, dashboards: newDashboards }
      persist(next)
      return next
    })
  }, [])

  return {
    // Per-current-dashboard state (unchanged API for existing callers)
    layout,
    activeWidgets,
    onLayoutChange,
    addWidget,
    removeWidget,
    replaceLayout,
    resetLayout,
    // Multi-dashboard API
    currentDashboardId: store.current,
    dashboards,
    createDashboard,
    switchDashboard,
    renameDashboard,
    deleteDashboard,
  }
}
