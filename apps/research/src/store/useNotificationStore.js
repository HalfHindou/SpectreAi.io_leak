/**
 * Notification Store (Zustand)
 * Unified intelligence feed - aggregates signals from market data,
 * news, watchlist, and economic events.
 *
 * Signal shape:
 *   { id, category, title, body, timestamp, read, priority, meta }
 *
 * Categories: 'breaking', 'market', 'watchlist', 'news', 'whale', 'calendar',
 *             'kol-follow'
 * Priority: 1 (critical) → 3 (low)
 */
import { create } from 'zustand'
import { persist, devtools } from 'zustand/middleware'

const MAX_SIGNALS = 50
const STALE_MS = 24 * 60 * 60 * 1000 // 24 hours

const useNotificationStore = create(
  devtools(
    persist(
      (set) => ({
        signals: [],
        lastCleaned: 0,


        /** Add a signal. Deduplicates by id. Trims to MAX_SIGNALS. */
        addSignal: (signal) => set((state) => {
          // Skip if already exists
          if (state.signals.some((s) => s.id === signal.id)) return state

          const newSignal = {
            ...signal,
            timestamp: signal.timestamp || Date.now(),
            read: false,
            priority: signal.priority || 2,
          }

          // Prepend, cap length
          const signals = [newSignal, ...state.signals].slice(0, MAX_SIGNALS)
          return { signals }
        }),

        /** Add multiple signals at once (batched from signal engine). */
        addSignals: (newSignals) => set((state) => {
          const existingIds = new Set(state.signals.map((s) => s.id))
          const unique = newSignals
            .filter((s) => !existingIds.has(s.id))
            .map((s) => ({
              ...s,
              timestamp: s.timestamp || Date.now(),
              read: false,
              priority: s.priority || 2,
            }))

          if (unique.length === 0) return state

          let signals = [...unique, ...state.signals]
            .sort((a, b) => b.timestamp - a.timestamp)

          // Collapse noisy repeated signal alerts for the SAME token: keep only
          // the newest per (category + token). Otherwise one asset's breakout
          // floods the feed with near-identical rows (HOODIE ×6). News/brain/
          // convergence are left alone — each is distinct.
          const COLLAPSE = new Set(['breakout', 'fragility', 'signal'])
          const seen = new Set()
          signals = signals.filter((s) => {
            if (!COLLAPSE.has(s.category)) return true
            const token = s.meta?.asset || (s.title || '').trim().split(/\s+/)[0]
            if (!token) return true
            const key = `${s.category}|${String(token).toUpperCase()}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })

          signals = signals.slice(0, MAX_SIGNALS)
          return { signals }
        }),

        /** Mark a single signal as read. */
        markRead: (id) => set((state) => ({
          signals: state.signals.map((s) =>
            s.id === id ? { ...s, read: true } : s
          ),
        })),

        /** Mark all signals as read. */
        markAllRead: () => set((state) => ({
          signals: state.signals.map((s) => ({ ...s, read: true })),
        })),

        /** Remove signals older than 24 hours. Called on mount. */
        clearOld: () => set((state) => {
          const cutoff = Date.now() - STALE_MS
          const now = Date.now()
          // Don't clean more than once per minute
          if (now - state.lastCleaned < 60000) return state
          return {
            signals: state.signals.filter((s) => s.timestamp > cutoff),
            lastCleaned: now,
          }
        }),

        /** Remove a specific signal. */
        dismiss: (id) => set((state) => ({
          signals: state.signals.filter((s) => s.id !== id),
        })),

        /** Clear all signals. */
        clearAll: () => set({ signals: [] }),
      }),
      {
        name: 'spectre-notifications',
        // v2 (2026-08-17): signals gained a `detail` field — the
        // `Headline — supporting detail` split the poller used to flatten into
        // one run-on sentence. addSignals dedupes by id, so a stored v1 row
        // would keep its old flattened title until it aged out 24h later.
        // Drop the cache once; the next poll (≤60s) refills it in the new shape.
        version: 2,
        migrate: (state) => ({ ...state, signals: [], lastCleaned: 0 }),
      }
    ),
    { name: 'NotificationStore' }
  )
)

/** Selector for unread count (avoids full-store subscription). */
export const useUnreadCount = () =>
  useNotificationStore((s) => s.signals.filter((sig) => !sig.read).length)

export default useNotificationStore
