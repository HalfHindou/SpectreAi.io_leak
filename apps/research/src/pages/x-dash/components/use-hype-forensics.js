import { useCallback, useRef, useState } from 'react'
import { computeHypeForensics, buildForensicContext, FORENSIC_DIRECTIVE } from './xd-hype-forensics'
import { parseSseFrames } from '@/lib/monarch-stream'

/**
 * use-hype-forensics — powers the X Dash "Research" tab. Imperatively analyze a
 * token: pull its X corpus (cashtag + name + handle), compute the forensic
 * signals, and (on demand) stream an LLM teardown via /api/monarch/chat.
 */

const FETCH_TIMEOUT = 15000
const num = (v) => {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

function normalizeTweet(t, i) {
  if (!t) return null
  const id = t.tweet_id || t.id || `s-${i}`
  const username = (t.username || t.screen_name || t.author_handle || '').replace(/^@/, '')
  const text = t.tweet_text || t.full_text || t.text || ''
  if (/^RT\s+@/i.test(text)) return null
  if (!text && !username) return null
  return {
    id: String(id),
    text,
    username,
    avatar: t.ProfilePic || t.profile_image || t.avatar_image_url || t.author_avatar || null,
    url: t.tweet_url || t.x_url || (id && username ? `https://x.com/${username}/status/${id}` : null),
    date: t.date || t.created_at || '',
    followers: num(t.followers ?? t.followers_count ?? t.author_followers),
    likes: num(t.like_count ?? t.likes),
    retweets: num(t.retweet_count ?? t.retweets),
    replies: num(t.reply_count ?? t.comments),
    views: num(t.views),
  }
}

async function searchTweets(query, signal) {
  const q = String(query || '').trim()
  if (!q) return []
  const enc = encodeURIComponent(q)
  const urls = import.meta.env.DEV
    ? [`/api/tweets/search?query=${enc}`, `/tweets-api/api/tweets/search?query=${enc}`]
    : [`/api/tweets/search?query=${enc}`]
  for (const url of urls) {
    const res = await fetch(url, { signal }).catch(() => null)
    if (!res?.ok) continue
    const data = await res.json().catch(() => null)
    const rows = Array.isArray(data) ? data : data?.tweets || data?.data || data?.results || []
    if (Array.isArray(rows) && rows.length) {
      const out = rows.map(normalizeTweet).filter(Boolean)
      if (out.length) return out
    }
  }
  return []
}


const EMPTY = { forensics: null, tweets: [], token: null, loading: false, error: null }

/* Module-level result cache: the view auto-analyzes a showcase token on mount,
   so WITHOUT this every tab re-open re-fired the whole corpus fan-out (2-3
   tweet searches). Keyed by the query set; a tab re-open inside the TTL paints
   the last analysis instantly. */
const RESULT_CACHE = new Map() // key -> { forensics, tweets, token, ts }
const RESULT_TTL = 10 * 60_000

export function useHypeForensics() {
  const [state, setState] = useState(EMPTY)
  const [teardown, setTeardown] = useState('')
  const [teardownState, setTeardownState] = useState('idle') // idle | streaming | done | error
  const abortRef = useRef(null)
  const llmAbortRef = useRef(null)
  const lastTokenRef = useRef(null)

  const analyze = useCallback(async (token, { bypassCache = false } = {}) => {
    const symbol = String(token?.symbol || '').replace(/^\$/, '').trim()
    const name = String(token?.name || '').trim()
    const query = String(token?.query || symbol || name || '').trim()
    if (!symbol && !name && !query) return
    lastTokenRef.current = token

    abortRef.current?.abort()
    llmAbortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = AbortSignal.any
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(FETCH_TIMEOUT)])
      : controller.signal

    setTeardown('')
    setTeardownState('idle')

    const queries = [...new Set([symbol ? `$${symbol}` : '', name, query].filter(Boolean))]
    const cacheKey = queries.join('|').toLowerCase()
    if (!bypassCache) {
      const hit = RESULT_CACHE.get(cacheKey)
      if (hit && Date.now() - hit.ts < RESULT_TTL) {
        setState({ forensics: hit.forensics, tweets: hit.tweets, token: hit.token, loading: false, error: null })
        return
      }
    }

    setState({ ...EMPTY, token, loading: true })
    try {
      const results = await Promise.all(queries.map((q) => searchTweets(q, signal).catch(() => [])))
      if (controller.signal.aborted) return
      const seen = new Set()
      const tweets = []
      for (const tw of results.flat()) {
        const k = tw.url || tw.id
        if (seen.has(k)) continue
        seen.add(k)
        tweets.push(tw)
      }
      const forensics = computeHypeForensics({ tweets, token: { symbol, name, marketCap: token?.marketCap } })
      if (tweets.length) RESULT_CACHE.set(cacheKey, { forensics, tweets, token, ts: Date.now() })
      setState({ forensics, tweets, token, loading: false, error: tweets.length ? null : 'No X activity found for this token.' })
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return
      setState({ ...EMPTY, token, loading: false, error: 'Could not load X activity.' })
    }
  }, [])

  /* Re-run the last analysis, bypassing the cache — the error state's retry. */
  const retry = useCallback(() => {
    if (lastTokenRef.current) analyze(lastTokenRef.current, { bypassCache: true })
  }, [analyze])

  const runTeardown = useCallback(async () => {
    const { forensics, tweets, token } = state
    if (!forensics || forensics.score == null) return
    const sym = (token?.symbol || token?.query || '').replace(/^\$/, '').toUpperCase()
    const context = buildForensicContext(forensics, token || {}, tweets)
    if (!context) return

    llmAbortRef.current?.abort()
    const controller = new AbortController()
    llmAbortRef.current = controller
    setTeardown('')
    setTeardownState('streaming')

    try {
      const res = await fetch('/api/monarch/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Run a social-engineering forensic teardown on $${sym}. ${FORENSIC_DIRECTIVE(sym)}` }],
          context,
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Analysis unavailable (${res.status})`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''
      let done = false
      while (!done) {
        const { done: d, value } = await reader.read()
        if (d) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, tail } = parseSseFrames(buffer)
        buffer = tail
        for (const raw of frames) {
          if (raw === '[DONE]') { done = true; break }
          let parsed
          try { parsed = JSON.parse(raw) } catch (_) { continue }
          if (parsed.type === 'text' && typeof parsed.content === 'string') {
            acc += parsed.content
            setTeardown(acc)
          } else if (parsed.type === 'error') {
            throw new Error(parsed.content || 'Analysis error')
          }
        }
      }
      setTeardownState('done')
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return
      setTeardownState('error')
      setTeardown((prev) => prev || (err.message || 'Analysis failed.'))
    }
  }, [state])

  return { ...state, analyze, retry, teardown, teardownState, runTeardown }
}
