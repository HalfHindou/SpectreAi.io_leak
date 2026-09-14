/**
 * useAlerts - Price alert management hook
 *
 * Create, list, and delete Codex price alerts.
 * Listens for triggered alerts via SSE from /api/webhook/stream.
 *
 * SEC-20260513-004: every request now sends the Privy bearer token so the
 * server can scope alerts per-user (BOLA fix). If the user is not logged
 * in via Privy, the request will 401 — no fallback to unscoped listing.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { isAppActive } from '../lib/idleManager'

const ALERTS_API = '/api/alerts'

/**
 * @returns {{
 *   alerts: Array,
 *   rules: Array,
 *   triggered: Array,
 *   triggeredAlerts: Array,
 *   loading: boolean,
 *   createAlert: (params) => Promise,
 *   updateAlert: (ruleId, updates) => Promise,
 *   deleteAlert: (id) => Promise,
 *   deleteTriggered: (id) => Promise,
 *   refresh: () => void,
 *   dismissTriggered: (id) => void,
 * }}
 */
export default function useAlerts() {
  const { authenticated, getAccessToken } = usePrivy()
  const [alerts, setAlerts] = useState([])
  const [rules, setRules] = useState([])
  const [triggered, setTriggered] = useState([])
  const [triggeredAlerts, setTriggeredAlerts] = useState([])
  const [loading, setLoading] = useState(false)

  // Track which triggered alerts we've already shown - persisted across refreshes
  const shownTriggeredRef = useRef(new Set(
    (() => { try { return JSON.parse(localStorage.getItem('spectre-alerts-shown') || '[]') } catch { return [] } })()
  ))

  // SEC-20260513-004: build auth headers fresh on every call - Privy tokens
  // are short-lived and may have rotated.
  const buildAuthHeaders = useCallback(async (extra = {}) => {
    if (!authenticated) return null
    try {
      const token = await getAccessToken()
      if (!token) return null
      return { ...extra, Authorization: `Bearer ${token}` }
    } catch (err) {
      console.warn('[useAlerts] getAccessToken failed:', err?.message)
      return null
    }
  }, [authenticated, getAccessToken])

  // Fetch alerts and detect triggered ones
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const headers = await buildAuthHeaders()
      // Signed out - clear ALL per-user state, not just alerts, so a
      // previous session's rules/history never render for the next viewer.
      if (!headers) { setAlerts([]); setRules([]); setTriggered([]); setLoading(false); return }
      const res = await fetch(ALERTS_API, { headers, signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const data = await res.json()
        const all = data.alerts || []
        const serverRules = Array.isArray(data.rules) ? data.rules : []
        setRules(serverRules)
        const serverTriggered = Array.isArray(data.triggered) ? data.triggered : []

        // Merge display meta stored at creation time (device-local best effort)
        const storedMeta = (() => { try { return JSON.parse(localStorage.getItem('spectre-alert-meta') || '{}') } catch { return {} } })()
        const merged = serverTriggered.map(t => {
          const meta = storedMeta[t.webhookId] || {}
          return {
            ...t,
            symbol: t.symbol || meta.symbol || '',
            logo: t.logo || meta.logo || '',
            mode: meta.mode || 'price',
            // Cross-device fallback: no local meta -> show the server-side target
            displayValue: meta.displayValue || (t.priceTarget ? String(t.priceTarget) : ''),
          }
        })
        setTriggered(merged)

        // Prune display meta for alerts that are neither active nor in the
        // triggered history - otherwise spectre-alert-meta grows unbounded.
        try {
          const liveIds = new Set([
            ...all.map(a => a.id),
            ...serverTriggered.map(t => t.webhookId),
          ])
          let changed = false
          for (const k of Object.keys(storedMeta)) {
            if (!liveIds.has(k)) { delete storedMeta[k]; changed = true }
          }
          if (changed) localStorage.setItem('spectre-alert-meta', JSON.stringify(storedMeta))
        } catch { /* best effort */ }

        // Toast any trigger this client hasn't shown yet
        const fresh = merged.filter(t => !shownTriggeredRef.current.has(t.id))
        if (fresh.length > 0) {
          for (const t of fresh) shownTriggeredRef.current.add(t.id)
          try { localStorage.setItem('spectre-alerts-shown', JSON.stringify([...shownTriggeredRef.current])) } catch {}
          setTriggeredAlerts(prev => [...fresh.map(t => ({
            type: 'price_alert',
            webhookId: t.webhookId,
            name: t.name,
            symbol: t.symbol,
            logo: t.logo,
            mode: t.mode,
            displayValue: t.displayValue,
            direction: t.direction,
            currentPrice: t.priceUsd,
            currentMcap: 0,
            tokenAddress: t.tokenAddress,
            networkId: t.networkId,
            triggeredAt: t.triggeredAt,
          })), ...prev].slice(0, 20))
        }

        setAlerts(all.filter(a => a.status === 'ACTIVE'))
      }
    } catch (err) {
      console.error('[useAlerts] Fetch failed:', err.message)
    } finally {
      setLoading(false)
    }
  }, [buildAuthHeaders])

  // Create a price alert (or, when type === 'pct', a % Move cron rule -
  // windowMin/pct/pctDirection only apply to that path, see W2 alerts-v2 PR2).
  const createAlert = useCallback(async ({ tokenAddress, networkId, priceTarget, direction, name, repeat, meta, type, windowMin, pct, pctDirection }) => {
    const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' })
    if (!headers) throw new Error('Sign in required to create alerts')
    const res = await fetch(ALERTS_API, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tokenAddress, networkId, priceTarget, direction, name,
        repeat: repeat || 'once',
        mode: meta?.mode || 'price',
        displayValue: meta?.displayValue || '',
        symbol: meta?.symbol || '',
        logo: meta?.logo || '',
        // Price-type calls omit `type` entirely (server defaults to 'price') -
        // identical wire shape to before this change.
        ...(type === 'pct' ? { type, windowMin, pct, pctDirection } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed: ${res.status}`)
    }
    const alert = await res.json()
    // Store metadata in localStorage for notification display
    if (alert.id && meta) {
      try {
        const stored = JSON.parse(localStorage.getItem('spectre-alert-meta') || '{}')
        stored[alert.id] = { ...meta, direction, name, priceTarget, tokenAddress, networkId }
        localStorage.setItem('spectre-alert-meta', JSON.stringify(stored))
      } catch {}
    }
    setAlerts(prev => [...prev, alert])
    setRules(prev => [...prev, alert])

    // Instant trigger: if current price already meets the condition, show notification immediately
    // (Codex webhooks are event-driven and may take minutes on low-volume tokens)
    // pct-type creates never pass priceTarget, so `priceTarget > 0` is false and
    // this block no-ops for them - the cron worker is the only thing that
    // evaluates a % Move rule, there is no "already true" instant check for it.
    if (meta && priceTarget > 0) {
      const currentPrice = meta.currentPrice || 0
      const alreadyTriggered = (direction === 'above' && currentPrice >= priceTarget) ||
                                (direction === 'below' && currentPrice <= priceTarget)
      if (alreadyTriggered) {
        shownTriggeredRef.current.add(alert.id)
        try { localStorage.setItem('spectre-alerts-shown', JSON.stringify([...shownTriggeredRef.current])) } catch {}
        setTriggeredAlerts(prev => [{
          type: 'price_alert',
          webhookId: alert.id,
          name,
          symbol: meta.symbol || '',
          logo: meta.logo || '',
          mode: meta.mode || 'price',
          displayValue: meta.displayValue || '',
          direction,
          currentPrice: meta.currentPrice || 0,
          currentMcap: meta.currentMcap || 0,
          tokenAddress,
          networkId,
          triggeredAt: Date.now(),
        }, ...prev].slice(0, 20))
        // Remove from active list after short delay
        setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== alert.id)), 1000)
      }
    }

    // Also poll to catch Codex-side triggers
    setTimeout(() => refresh(), 5000)
    setTimeout(() => refresh(), 15000)
    return alert
  }, [refresh, buildAuthHeaders])

  // Update a rule (e.g. pause/resume, edit condition)
  const updateAlert = useCallback(async (ruleId, updates) => {
    const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' })
    if (!headers) throw new Error('Sign in required')
    const res = await fetch(ALERTS_API, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ruleId, updates }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed: ${res.status}`)
    }
    const { rule } = await res.json()
    setRules(prev => prev.map(r => (r.id === ruleId ? rule : r)))
    // Keep the legacy list coherent without waiting for the next poll.
    refresh()
    return rule
  }, [buildAuthHeaders, refresh])

  // Delete an alert
  const deleteAlert = useCallback(async (id) => {
    const headers = await buildAuthHeaders()
    if (!headers) throw new Error('Sign in required to delete alerts')
    const res = await fetch(`${ALERTS_API}?ruleId=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      setAlerts(prev => prev.filter(a => a.id !== id))
      setRules(prev => prev.filter(r => r.id !== id))
    }
  }, [buildAuthHeaders])

  // Delete a triggered alert record
  const deleteTriggered = useCallback(async (id) => {
    const headers = await buildAuthHeaders()
    if (!headers) return
    try {
      await fetch(`${ALERTS_API}?triggeredId=${encodeURIComponent(id)}`, {
        method: 'DELETE', headers, signal: AbortSignal.timeout(10000),
      })
    } catch { /* best effort */ }
    setTriggered(prev => prev.filter(t => t.id !== id))
  }, [buildAuthHeaders])

  // Dismiss a triggered alert notification
  const dismissTriggered = useCallback((id) => {
    setTriggeredAlerts(prev => prev.filter(a => a.webhookId !== id))
  }, [])

  /* Fetch alerts AFTER first paint, not during it.
     `useAlerts()` is mounted app-wide in App.jsx, so this fired on every boot
     inside the busiest window of the load - measured on prod at a 440px
     viewport it took 1549ms, the single slowest boot request, racing the
     profile/watchlist/referral calls and the data the user is actually
     looking at. Nothing on screen needs it immediately: it feeds the
     triggered-alert toast and the bell badge, both of which are fine landing
     a beat later. requestIdleCallback with a 2s ceiling so it still runs
     promptly on a busy main thread (and on Safari, which lacks rIC). */
  useEffect(() => {
    let cancelled = false
    const run = () => { if (!cancelled) refresh() }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 2000 })
      return () => { cancelled = true; cancelIdleCallback?.(id) }
    }
    const t = setTimeout(run, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [refresh])

  // Poll every 30s - picks up new server-persisted trigger records and
  // keeps history fresh even when there are no active alerts
  useEffect(() => {
    if (alerts.length === 0 && rules.length === 0 && triggered.length === 0) return
    const interval = setInterval(() => {
      // Idle/visibility guard. Skip on forgotten tabs.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      refresh()
    }, 30000)
    return () => clearInterval(interval)
  }, [alerts.length, rules.length, triggered.length, refresh])

  return {
    alerts,
    rules,
    triggered,
    triggeredAlerts,
    loading,
    createAlert,
    updateAlert,
    deleteAlert,
    deleteTriggered,
    refresh,
    dismissTriggered,
  }
}

/**
 * Check if a specific token has any active alerts.
 */
export function useTokenAlerts(alerts, tokenAddress, networkId) {
  if (!alerts?.length || !tokenAddress) return []
  const addr = tokenAddress.toLowerCase()
  return alerts.filter(a =>
    a.tokenAddress?.toLowerCase() === addr &&
    (!networkId || a.networkId === networkId)
  )
}
