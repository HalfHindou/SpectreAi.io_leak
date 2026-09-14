/**
 * YOU V2 — useYouComposer
 *
 * State machine + API client for the agent-driven dashboard composer.
 *
 * Conversation persists per dashboard in sessionStorage so the user can
 * close and reopen the composer without losing context within a session.
 * (Cross-session persistence comes later when dashboards have stable IDs.)
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'spectre:you-composer:'

/**
 * The model streams strict JSON like `{"widgets":[...],"rationale":"text"}`.
 * We don't want the bubble to render raw JSON tokens during the stream — we
 * want it to render the rationale prose as it appears. This extracts the
 * partial rationale value in-flight; before the rationale field arrives we
 * surface a soft progress hint instead.
 */
function extractRationaleProgressive(buffer) {
  if (!buffer) return ''
  // Try to find the rationale field opening quote.
  const m = buffer.match(/"rationale"\s*:\s*"([\s\S]*?)("|$)/)
  if (m) {
    // m[1] is the rationale text accumulated so far; the closing quote may
    // not have arrived yet.
    return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  // Pre-rationale phase — soft progress text with a rough widget-count guess.
  const widgetMatches = buffer.match(/"widget_id"/g)
  const n = widgetMatches ? widgetMatches.length : 0
  if (n > 0) return `Picking widgets… (${n} so far)`
  if (buffer.length > 4) return 'Building your dashboard…'
  return ''
}

function loadConversation(dashboardId) {
  if (typeof sessionStorage === 'undefined' || !dashboardId) return []
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + dashboardId)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveConversation(dashboardId, conversation) {
  if (typeof sessionStorage === 'undefined' || !dashboardId) return
  try {
    sessionStorage.setItem(STORAGE_PREFIX + dashboardId, JSON.stringify(conversation))
  } catch { /* ignore */ }
}

/**
 * @param {Object} args
 * @param {string} args.dashboardId
 * @param {Function} args.getAgentProfile  () => { agent_type, level }
 * @param {Function} args.getUserProfile   () => { motivation, info_style, risk_profile, markets, tier }
 */
export default function useYouComposer({ dashboardId, getAgentProfile, getUserProfile } = {}) {
  const [conversation, setConversation] = useState(() => loadConversation(dashboardId))
  const [pendingDashboard, setPendingDashboard] = useState(null) // last validated dashboard from agent
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    setConversation(loadConversation(dashboardId))
    setPendingDashboard(null)
    setError(null)
  }, [dashboardId])

  useEffect(() => {
    saveConversation(dashboardId, conversation)
  }, [dashboardId, conversation])

  // Streaming buffer for the in-flight assistant message — surfaced to the UI
  // so the bubble can render progressive content while the model talks.
  const [streamingText, setStreamingText] = useState('')

  const submitIntent = useCallback(async (intent, opts = {}) => {
    if (!intent || typeof intent !== 'string' || !intent.trim()) return null
    setError(null)
    setInFlight(true)
    setStreamingText('')

    const agent_profile = typeof getAgentProfile === 'function' ? getAgentProfile() : undefined
    const user_profile  = typeof getUserProfile  === 'function' ? getUserProfile()  : undefined

    const userMessage = { role: 'user', content: intent }
    const nextConversation = [...conversation, userMessage]
    setConversation(nextConversation)

    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    const requestBody = JSON.stringify({
      intent,
      current_layout: opts.current_layout ?? pendingDashboard ?? null,
      conversation_history: nextConversation,
      agent_profile,
      user_profile,
      portfolio: opts.portfolio,
      watchlist: opts.watchlist,
    })

    try {
      const res = await fetch('/api/you/compose/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: requestBody,
        signal: abortRef.current.signal,
      })

      // Fall back to non-streaming endpoint if SSE not supported (e.g. prod
      // serverless function before the streaming variant ships).
      if (!res.ok || !res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
        return await submitIntentNonStreaming({ requestBody })
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''
      let finalDashboard = null
      let finalMeta = null
      let receivedError = null
      let done = false

      while (!done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const ev of events) {
          const lines = ev.split('\n')
          let eventName = 'message'
          let dataLine = ''
          for (const l of lines) {
            if (l.startsWith('event: ')) eventName = l.slice(7).trim()
            else if (l.startsWith('data: ')) dataLine = l.slice(6)
          }
          if (!dataLine) continue
          let payload
          try { payload = JSON.parse(dataLine) } catch { continue }
          if (eventName === 'chunk' && typeof payload.text === 'string') {
            // Strip JSON braces/punctuation as they stream by — the user wants
            // to see prose, not raw '{"widgets": ...'. We progressively keep
            // the rationale-like substrings only.
            accumulated += payload.text
            setStreamingText(extractRationaleProgressive(accumulated))
          } else if (eventName === 'dashboard') {
            finalDashboard = payload.dashboard
            finalMeta = payload.meta
          } else if (eventName === 'error') {
            receivedError = payload
          } else if (eventName === 'done') {
            done = true
          }
        }
      }

      setStreamingText('')

      if (receivedError || !finalDashboard) {
        const friendly = receivedError?.error || 'Your agent had trouble with that. Try rephrasing or pick a template.'
        setError(friendly)
        setConversation(prev => [...prev, { role: 'assistant', content: friendly }])
        setInFlight(false)
        return null
      }

      setPendingDashboard(finalDashboard)
      setConversation(prev => [
        ...prev,
        { role: 'assistant', content: finalDashboard.rationale || 'Built it.' },
      ])
      setInFlight(false)
      return { dashboard: finalDashboard, meta: finalMeta }
    } catch (err) {
      if (err?.name === 'AbortError') {
        setInFlight(false)
        setStreamingText('')
        return null
      }
      // Network or transport error — try the non-streaming fallback once.
      const fallback = await submitIntentNonStreaming({ requestBody }).catch(() => null)
      if (fallback) return fallback
      const friendly = 'Your agent had trouble with that. Try rephrasing or pick a template.'
      setError(friendly)
      setConversation(prev => [...prev, { role: 'assistant', content: friendly }])
      setInFlight(false)
      setStreamingText('')
      return null
    }
  }, [conversation, pendingDashboard, getAgentProfile, getUserProfile])

  // Non-streaming fallback path — same shape as the original submitIntent.
  const submitIntentNonStreaming = useCallback(async ({ requestBody }) => {
    try {
      const res = await fetch('/api/you/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: abortRef.current?.signal,
      })
      const json = await res.json()
      if (!res.ok || !json?.ok || !json?.dashboard) {
        const friendly = json?.error || 'Your agent had trouble with that. Try rephrasing or pick a template.'
        setError(friendly)
        setConversation(prev => [...prev, { role: 'assistant', content: friendly }])
        setInFlight(false)
        return null
      }
      const dashboard = json.dashboard
      setPendingDashboard(dashboard)
      setConversation(prev => [
        ...prev,
        { role: 'assistant', content: dashboard.rationale || 'Built it.' },
      ])
      setInFlight(false)
      return { dashboard, meta: json.meta }
    } catch {
      setInFlight(false)
      return null
    }
  }, [])

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setConversation([])
    setPendingDashboard(null)
    setError(null)
    saveConversation(dashboardId, [])
  }, [dashboardId])

  return {
    conversation,
    pendingDashboard,
    inFlight,
    streamingText,
    error,
    submitIntent,
    reset,
  }
}
