/**
 * useKolFollowAlerts — the background poller that turns KOL convergence /
 * new-follow events into notification-store signals (bell + toast).
 *
 * GET /api/kol/alerts?since=<iso> (Privy-authed)
 *   -> { alerts:[{ id, type:'convergence'|'new-follow', title, body, kols,
 *        target, project, created_at, priority }], server_time }
 *
 * Only the alerts involving the user's followed KOLs since `since` come back.
 * Each new alert is pushed to useNotificationStore.addSignal under the new
 * `kol-follow` category, deduped by id (the store also dedups by id).
 *
 * Guards (per the contract):
 *   - polls ONLY when the user follows >= 1 KOL AND is authed (alerts are
 *     per-user, server-gated by the Privy token)
 *   - visibility-gated via useAdaptivePolling (skips hidden/idle tabs)
 *   - respects the user's `convergence` notification preference
 *   - tracks the last server_time as the next `since` so each poll is a delta
 *
 * Returns {} — it's a side-effect hook (mirrors useNotificationPoller).
 */
import { useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import useNotificationStore from '@/store/useNotificationStore'
import useSettingsStore from '@/store/useSettingsStore'
import { getAuthToken } from '@/services/profileSync'
import { useKolFollows } from '@/hooks/useKolFollows'

const POLL_INTERVAL = 60000
const FETCH_TIMEOUT = 15000
const PRIORITY_RANK = { high: 1, medium: 2, low: 3 }

export function useKolFollowAlerts(options = {}) {
  const { count: followCount, authed } = useKolFollows()
  const addSignal = useNotificationStore((s) => s.addSignal)
  const convergencePref = useSettingsStore((s) => s.notificationPrefs?.convergence)

  const sinceRef = useRef(null)
  const seenRef = useRef(new Set())

  // Only run when authed AND the user actually follows someone AND they haven't
  // muted convergence alerts. Anonymous users get the local follow experience
  // but no server alerts (the contract: "sign in to sync + get alerts").
  const enabled = Boolean(authed) && followCount >= 1 && convergencePref !== false && options.enabled !== false

  const poll = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return
    const q = new URLSearchParams()
    if (sinceRef.current) q.set('since', sinceRef.current)
    try {
      const res = await fetch(`/api/kol/alerts?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return
      const body = await res.json()
      if (body?.server_time) sinceRef.current = body.server_time
      const alerts = Array.isArray(body?.alerts) ? body.alerts : []
      for (const alert of alerts) {
        if (!alert?.id || seenRef.current.has(alert.id)) continue
        seenRef.current.add(alert.id)
        const project = alert.project || alert.target || {}
        const sym = project.symbol ? `$${project.symbol}` : (project.name || alert.target?.screen_name || '')
        addSignal({
          id: `kol-${alert.id}`,
          category: 'kol-follow',
          title: alert.title || (alert.type === 'convergence'
            ? `${alert.kols?.length || 0} KOLs converged on ${sym}`
            : `New follow: ${sym}`),
          body: alert.body || '',
          timestamp: alert.created_at ? new Date(alert.created_at).getTime() : Date.now(),
          priority: PRIORITY_RANK[alert.priority] || 2,
          meta: {
            severity: alert.priority || 'medium',
            asset: sym || undefined,
            type: alert.type,
            handle: project.cg_id || alert.target?.screen_name || undefined,
          },
        })
      }
      // bound the seen-set so a long session doesn't grow it unbounded
      if (seenRef.current.size > 400) {
        seenRef.current = new Set([...seenRef.current].slice(-200))
      }
    } catch {
      /* network / timeout — silent, the next tick retries */
    }
  }, [addSignal])

  // Reset the delta cursor when the user signs out / drops to zero follows so a
  // future re-enable starts clean rather than replaying a stale `since`.
  useEffect(() => {
    if (!enabled) {
      sinceRef.current = null
    }
  }, [enabled])

  useAdaptivePolling(poll, {
    interval: options.interval || POLL_INTERVAL,
    fireImmediately: true,
    enabled,
  })

  return {}
}

export default useKolFollowAlerts
