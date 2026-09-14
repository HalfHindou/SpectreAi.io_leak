/**
 * Ask the Brain — a question box wired to the engine's conversational ear.
 *
 * GET /data-api/v1/brain/ask?q=<urlencoded> (through the same /data-api proxy
 * useBrainDesk reads). Success: { data: { answer, asked_at, context_used:
 * { assets, sources }, cached } }. Errors: 400 {error} / 429 {error, retry_after?}.
 * The endpoint deploys in parallel, so 404 is handled as a first-class state.
 *
 * Self-contained: `useBrainAsk` holds all state (no context, no store). The
 * header input (`BrainAskInput`) and the answer panel (`BrainAskPanel`) are two
 * faces of that one hook, mounted in two DOM spots by brain-eagle.jsx.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import spectreIcons from '@/icons/spectreIcons'
import './brain-ask.css'

const MAX_HISTORY = 3
const ASK_URL = '/data-api/v1/brain/ask'
const TIMEOUT_MS = 30000

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')
const KBD_LABEL = IS_MAC ? '⌘K' : 'Ctrl K'

function errorText(kind) {
  switch (kind) {
    case 'ratelimit': return 'the brain is rate-limited — try again in a minute'
    case 'notdeployed': return "the brain's ear isn't deployed yet"
    case 'badquery': return "the brain couldn't parse that — try rephrasing"
    default: return "couldn't reach the brain — try again in a moment"
  }
}

function toParagraphs(text) {
  return String(text || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
}

function groundedLine(sources, assets) {
  const s = (Array.isArray(sources) ? sources : []).filter(Boolean)
  const a = (Array.isArray(assets) ? assets : []).filter(Boolean)
  if (!s.length && !a.length) return null
  const parts = []
  if (s.length) parts.push(s.join(', '))
  if (a.length) parts.push(a.join(', '))
  return `grounded in: ${parts.join(' · ')}`
}

/* ── state ───────────────────────────────────────────────────────────────── */
export function useBrainAsk() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [current, setCurrent] = useState(null) // { question, answer, sources, assets, error }
  const [history, setHistory] = useState([])   // completed answers, newest first, max 3
  const [expanded, setExpanded] = useState(null)

  const inputRef = useRef(null)
  const inflightRef = useRef(false) // synchronous double-submit guard (beats the setState lag)
  const currentRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => { currentRef.current = current }, [current])
  useEffect(() => () => { mountedRef.current = false }, [])

  const focusInput = useCallback(() => { inputRef.current?.focus() }, [])

  const submit = useCallback(async () => {
    const q = query.trim()
    if (!q || inflightRef.current) return
    inflightRef.current = true
    setLoading(true)
    setOpen(true)
    setExpanded(null)

    // a completed answer scrolls up into history; new question replaces the panel
    const prev = currentRef.current
    if (prev && prev.answer) setHistory((h) => [prev, ...h].slice(0, MAX_HISTORY))
    setCurrent({ question: q, answer: null, sources: [], assets: [], error: null })

    const finish = (patch) => {
      if (!mountedRef.current) return
      setCurrent((c) => (c ? { ...c, ...patch } : c))
    }

    try {
      const r = await fetch(`${ASK_URL}?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (r.status === 429) { finish({ error: 'ratelimit' }); return }
      if (r.status === 404) { finish({ error: 'notdeployed' }); return }
      if (r.status === 400) { finish({ error: 'badquery' }); return }
      if (!r.ok) { finish({ error: 'generic' }); return }
      const j = await r.json().catch(() => null)
      const data = j?.data || j
      const answer = data?.answer
      if (!answer) { finish({ error: 'generic' }); return }
      const ctx = data?.context_used || {}
      finish({
        answer,
        sources: Array.isArray(ctx.sources) ? ctx.sources : [],
        assets: Array.isArray(ctx.assets) ? ctx.assets : [],
        error: null,
      })
    } catch {
      finish({ error: 'generic' }) // timeout / network / abort
    } finally {
      inflightRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [query])

  const close = useCallback(() => {
    setOpen(false)
    setCurrent(null)
    setHistory([])
    setExpanded(null)
  }, [])

  const onEsc = useCallback(() => {
    if (open) close()
    else inputRef.current?.blur()
  }, [open, close])

  const toggleHistory = useCallback((i) => {
    setExpanded((e) => (e === i ? null : i))
  }, [])

  // Global ⌘K / Ctrl+K — focus the box, unless the user is typing in some OTHER field.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key || '').toLowerCase() !== 'k') return
      const el = document.activeElement
      const typingElsewhere =
        el && el !== inputRef.current &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typingElsewhere) return
      e.preventDefault()
      focusInput()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusInput])

  return { query, setQuery, open, loading, current, history, expanded, inputRef, submit, close, onEsc, toggleHistory }
}

/* ── header input ────────────────────────────────────────────────────────── */
export function BrainAskInput({ ask }) {
  const { query, setQuery, submit, loading, inputRef, onEsc } = ask
  return (
    <form
      className="bask-input-wrap"
      role="search"
      aria-busy={loading || undefined}
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <span className="bask-glyph" aria-hidden>{spectreIcons.search}</span>
      <input
        ref={inputRef}
        className="bask-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onEsc() }}
        placeholder={'Ask the Brain — "why is SOL bid?"'}
        aria-label="Ask the Brain"
        spellCheck={false}
        autoComplete="off"
      />
      <kbd className="bask-kbd">{KBD_LABEL}</kbd>
    </form>
  )
}

/* ── answer panel ────────────────────────────────────────────────────────── */
function AnswerBody({ item }) {
  const line = groundedLine(item.sources, item.assets)
  return (
    <>
      <div className="bask-answer">
        {toParagraphs(item.answer).map((p, i) => <p key={i} className="bask-p">{p}</p>)}
      </div>
      {line && <p className="bask-grounded">{line}</p>}
    </>
  )
}

export function BrainAskPanel({ ask }) {
  const { open, loading, current, history, expanded, close, toggleHistory } = ask
  if (!open || !current) return null
  return (
    <section className="bask-panel" aria-live="polite">
      {history.length > 0 && (
        <div className="bask-history">
          {history.map((h, i) => (
            <div key={i} className={`bask-hist${expanded === i ? ' bask-hist--open' : ''}`}>
              <button type="button" className="bask-hist-q" onClick={() => toggleHistory(i)}>
                <span className="bask-hist-caret" aria-hidden>{expanded === i ? '–' : '+'}</span>
                <span className="bask-hist-qtext">{h.question}</span>
              </button>
              {expanded === i && <div className="bask-hist-a"><AnswerBody item={h} /></div>}
            </div>
          ))}
        </div>
      )}

      <div className="bask-current">
        <div className="bask-cur-head">
          <span className="bask-q">{current.question}</span>
          <button type="button" className="bask-close" onClick={close}>{'✕'} close</button>
        </div>
        {loading ? (
          <div className="bask-skeleton" aria-hidden>
            <span className="bask-sk" style={{ width: '94%' }} />
            <span className="bask-sk" style={{ width: '88%' }} />
            <span className="bask-sk" style={{ width: '72%' }} />
          </div>
        ) : current.error ? (
          <p className="bask-error">{errorText(current.error)}</p>
        ) : (
          <AnswerBody item={current} />
        )}
      </div>
    </section>
  )
}
