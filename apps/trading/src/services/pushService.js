/**
 * pushService - Web Push subscription management (trading app).
 * SW registration happens HERE, lazily, only when the user enables push -
 * the app never auto-registers a service worker at boot.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && !!VAPID_PUBLIC_KEY
}

// iOS Safari supports Web Push only for home-screen-installed apps (16.4+).
export function isStandaloneIOSRequired() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  return isIOS && !standalone
}

export async function getPushStatus() {
  if (!isPushSupported()) return isStandaloneIOSRequired() ? 'ios-needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'default') return 'default'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    return sub ? 'granted-subscribed' : 'granted-unsubscribed'
  } catch {
    return 'granted-unsubscribed'
  }
}

export async function enablePush(getAccessToken) {
  if (!isPushSupported()) return false
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    const token = await getAccessToken()
    if (!token) return false
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(sub.toJSON()),
      signal: AbortSignal.timeout(10000),
    })
    return res.ok
  } catch (err) {
    console.warn('[pushService] enablePush failed:', err?.message)
    return false
  }
}

export async function disablePush(getAccessToken) {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (!sub) return true
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    const token = await getAccessToken()
    if (token) {
      await fetch('/api/push', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint }),
        signal: AbortSignal.timeout(10000),
      })
    }
    return true
  } catch {
    return false
  }
}
