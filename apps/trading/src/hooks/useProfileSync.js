/**
 * useProfileSync - Wires Privy auth token to profile sync service.
 * On login: sets auth token, fetches server profile, merges into Zustand, enables auto-sync.
 * If server has no profile but local does, pushes local profile to server (seeds it).
 * On logout: clears auth token, disables sync.
 *
 * Mount this once in a component inside PrivyProvider (e.g., AuthGate.jsx).
 */
import { useEffect, useRef } from 'react'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { setAuthToken, clearAuthToken, fetchProfile, pushProfile } from '../services/profileSync'
import useSettingsStore, { primeSyncBaseline } from '../store/useSettingsStore'

export function useProfileSync() {
  const { authenticated, getAccessToken } = usePrivy()
  const mergeServerSettings = useSettingsStore((s) => s.mergeServerSettings)
  const enableSync = useSettingsStore((s) => s.enableSync)
  const disableSync = useSettingsStore((s) => s.disableSync)
  const didSync = useRef(false)

  // `getAccessToken` from usePrivy() returns a new function reference every
  // render. Putting it in useEffect deps re-creates the closure on every
  // render. Today it's harmless because didSync.current short-circuits the
  // re-run, but the pattern is fragile and any new effect that isn't
  // idempotent would loop forever. Mirror the canonical useRef pattern
  // used in research's App.jsx so the deps array stays stable.
  const getAccessTokenRef = useRef(getAccessToken)
  useEffect(() => { getAccessTokenRef.current = getAccessToken }, [getAccessToken])

  useEffect(() => {
    if (!authenticated) {
      clearAuthToken()
      disableSync()
      didSync.current = false
      return
    }

    // Already synced this session
    if (didSync.current) return

    let cancelled = false

    async function syncOnLogin() {
      try {
        const token = await getAccessTokenRef.current()
        if (cancelled || !token) return

        setAuthToken(token)

        // Fetch server profile and merge into local state
        const serverData = await fetchProfile()
        if (cancelled) return

        if (serverData && serverData.updatedAt) {
          // Server has profile data - merge it (server wins)
          mergeServerSettings(serverData)
        } else {
          // Server has no profile - push local profile to seed it
          const local = useSettingsStore.getState()
          if (local.profile?.name || local.profile?.imageUrl) {
            const profile = {}
            if (local.profile.name) profile.name = local.profile.name
            if (local.profile.imageUrl) profile.imageUrl = local.profile.imageUrl
            const settings = { dayMode: local.dayMode }
            pushProfile(profile, settings).catch(() => {})
          }
        }

        // Adopt what we just read (or just seeded) as the baseline BEFORE
        // arming the watcher, otherwise enabling sync immediately schedules a
        // push of the data we only just fetched - a wasted PUT on every boot.
        primeSyncBaseline()
        enableSync()
        didSync.current = true
      } catch (err) {
        console.error('[useProfileSync] sync failed:', err.message)
        // Still enable sync so local changes push to server
        enableSync()
        didSync.current = true
      }
    }

    syncOnLogin()
    return () => { cancelled = true }
  }, [authenticated, mergeServerSettings, enableSync, disableSync])

  // Refresh the auth token periodically (Privy tokens expire ~60min)
  useEffect(() => {
    if (!authenticated) return

    const interval = setInterval(async () => {
      try {
        const token = await getAccessTokenRef.current()
        if (token) setAuthToken(token)
      } catch {
        // Token refresh failed - sync calls will get 401 and retry on next interval
      }
    }, 30 * 60 * 1000) // Refresh every 30 minutes

    return () => clearInterval(interval)
  }, [authenticated])
}
