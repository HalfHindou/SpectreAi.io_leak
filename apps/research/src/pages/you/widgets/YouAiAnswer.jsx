/**
 * YouAiAnswer — quick "ask Spectre" widget. Streams the answer from
 * `/api/monarch/chat`, the same endpoint the RZ agent and Monarch use. No
 * conversation memory — stateless single-shot for fast lookups in the dashboard.
 *
 * It used to POST `/api/ai/answer`, which was dead three ways over: the route
 * exists only in the dev Express server (no serverless function, no rewrite, so
 * prod fell through to the SPA catch-all), the body key was `question` where
 * the route reads `query` (400 in dev too), and the route sits behind
 * requirePrivyAuth while this fetch sent no token.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { streamMonarchChat } from '@/lib/monarch-stream'
import './YouAiAnswer.css'

const SUGGESTIONS = [
  'BTC outlook this week',
  'What is rotating right now',
  'Sentiment regime today',
]

export default function YouAiAnswer() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Abort in-flight request on unmount so the widget can be removed mid-stream
  // without leaking a setState onto a dead component. The flag is re-armed in
  // the effect body, not just initialised: StrictMode mounts, unmounts and
  // remounts, so a cleanup-only version leaves mountedRef false forever and
  // every setState below silently no-ops.
  const abortRef = useRef(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; abortRef.current?.abort() }
  }, [])

  const submit = useCallback(async (q) => {
    const text = (q ?? question).trim()
    if (!text || loading) return
    setQuestion(text)
    setLoading(true)
    setError(null)
    setAnswer('')
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Tracked outside state so the catch below can tell "the stream died before
    // saying anything" from "it died mid-answer" without reading back through a
    // setState updater.
    let streamed = ''
    try {
      streamed = await streamMonarchChat({
        messages: [{ role: 'user', content: text }],
        context: { page: 'you' },
        signal: controller.signal,
        // Paint tokens as they land; the shimmer clears on the first one.
        onText: (partial) => {
          streamed = partial
          if (controller.signal.aborted || !mountedRef.current) return
          setAnswer(partial)
        },
      })
      if (controller.signal.aborted || !mountedRef.current) return
      if (!streamed) setError('No answer came back.')
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError' || !mountedRef.current) return
      // Keep any partial answer on screen; only surface the error if nothing landed.
      if (!streamed) setError(err?.message || 'unable to answer')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (mountedRef.current) setLoading(false)
    }
  }, [question, loading])

  return (
    <div className="you-aa">
      <form className="you-aa-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input
          type="text"
          className="you-aa-input"
          placeholder="Ask Spectre…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="you-aa-send" disabled={loading || !question.trim()}>
          {loading ? '…' : '↵'}
        </button>
      </form>
      {!answer && !loading && !error && (
        <div className="you-aa-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="you-aa-chip" onClick={() => { setQuestion(s); submit(s) }}>{s}</button>
          ))}
        </div>
      )}
      {loading && !answer && (
        <div className="you-aa-loading">
          <div className="you-shimmer" style={{ width: '100%', height: 10, marginBottom: 6, borderRadius: 4 }} />
          <div className="you-shimmer" style={{ width: '90%', height: 10, marginBottom: 6, borderRadius: 4 }} />
          <div className="you-shimmer" style={{ width: '70%', height: 10, borderRadius: 4 }} />
        </div>
      )}
      {error && <div className="you-aa-error">{error}</div>}
      {answer && <div className={`you-aa-answer${loading ? ' is-streaming' : ''}`}>{answer}</div>}
    </div>
  )
}
