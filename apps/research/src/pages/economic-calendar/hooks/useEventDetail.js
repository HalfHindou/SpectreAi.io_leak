import { useEffect, useState } from 'react'

const detailCache = new Map()
const inflight = new Map()

export default function useEventDetail(eventId) {
  const [detail, setDetail] = useState(() => (eventId ? detailCache.get(eventId) || null : null))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!eventId) return
    const rawId = String(eventId).replace(/^ext-/, '')
    if (!rawId) return
    const cached = detailCache.get(rawId)
    if (cached) {
      setDetail(cached)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const existing = inflight.get(rawId)
    const promise = existing || fetch(`/api/calendar/event/${encodeURIComponent(rawId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Detail ${res.status}`)
        return res.json()
      })
      .then((data) => {
        detailCache.set(rawId, data)
        inflight.delete(rawId)
        return data
      })
      .catch((err) => {
        inflight.delete(rawId)
        throw err
      })

    if (!existing) inflight.set(rawId, promise)

    promise
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [eventId])

  return { detail, loading, error }
}
