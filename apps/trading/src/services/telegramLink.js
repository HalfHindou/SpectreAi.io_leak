/**
 * telegramLink - Telegram alert-delivery linking (trading app).
 * Bearer-authed fetches against /api/telegram (Privy JWT required server-side).
 * Never throws - callers get a degraded value instead.
 */

export async function getTelegramStatus(getAccessToken) {
  try {
    const token = await getAccessToken?.()
    if (!token) return 'unavailable'
    const res = await fetch('/api/telegram', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })
    if (res.status === 503) return 'unavailable'
    if (!res.ok) return 'unavailable'
    const data = await res.json().catch(() => null)
    return data?.linked ? 'linked' : 'unlinked'
  } catch (err) {
    console.warn('[telegramLink] getTelegramStatus failed:', err?.message)
    return 'unavailable'
  }
}

export async function startTelegramLink(getAccessToken) {
  try {
    const token = await getAccessToken?.()
    if (!token) return null
    const res = await fetch('/api/telegram', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (!data?.url) return null
    return { url: data.url }
  } catch (err) {
    console.warn('[telegramLink] startTelegramLink failed:', err?.message)
    return null
  }
}

export async function unlinkTelegram(getAccessToken) {
  try {
    const token = await getAccessToken?.()
    if (!token) return false
    const res = await fetch('/api/telegram', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })
    return res.ok
  } catch (err) {
    console.warn('[telegramLink] unlinkTelegram failed:', err?.message)
    return false
  }
}
