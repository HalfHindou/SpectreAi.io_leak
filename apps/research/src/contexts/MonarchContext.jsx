/**
 * MonarchContext — global state for Monarch AI chat.
 * Replaces the old SpectreAgentContext (egg + agent system).
 * Provides: chat open/close, message history, streaming state, page context.
 */
import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppState } from './AppStateContext'
import { getPageIdFromPath } from '@/constants/pageRoutes'
import useSettingsStore from '@/store/useSettingsStore'

const MONARCH_FALLBACK = Object.freeze({
  chatOpen: false,
  openChat: () => {},
  closeChat: () => {},
  toggleChat: () => {},
  messages: [],
  sendMessage: async () => {},
  clearHistory: () => {},
  deleteMessage: () => {},
  stopStreaming: () => {},
  isStreaming: false,
  lastUsedEndpoints: { endpoints: [], assets: [], topics: [], at: 0 },
  modelInfo: { model: '—', endpoint: '', provider: '' },
  lastSummary: { fearGreed: null, btcDominance: null, btcPrice: null, newsCount: 0, hasStaleness: false },
  sessionEndpoints: new Set(),
  threads: [],
  activeThreadId: null,
  newThread: () => {},
  switchThread: () => {},
  deleteThread: () => {},
  renameThread: () => {},
})

const MonarchContext = createContext(MONARCH_FALLBACK)

export const useMonarch = () => useContext(MonarchContext) || MONARCH_FALLBACK

// Shell context holds ONLY low-frequency shell state (chat open/close +
// modelInfo). It is split out of the main Monarch value because that value
// carries `messages`, which is rewritten on EVERY streamed token. AppShell -
// the most expensive consumer (Header + Sidebar + ParticleBackground + whole
// shell) - only needs the chat toggle, so it reads this stable context via
// useMonarchShell() and stops re-rendering on every streamed token.
const MONARCH_SHELL_FALLBACK = Object.freeze({
  chatOpen: false,
  openChat: () => {},
  closeChat: () => {},
  toggleChat: () => {},
  modelInfo: { model: '—', endpoint: '', provider: '' },
})

const MonarchShellContext = createContext(MONARCH_SHELL_FALLBACK)

export const useMonarchShell = () => useContext(MonarchShellContext) || MONARCH_SHELL_FALLBACK

// Page context is split into its OWN context because it depends on
// location.pathname and therefore changes on EVERY navigation. Keeping it in
// the main Monarch value would hand a new value object to all useMonarch()
// consumers (incl. AppShell) on every route change. Only the chat surfaces need
// it, so they read it via useMonarchPage() and the rest stay stable.
const MonarchPageContext = createContext({})

export const useMonarchPage = () => useContext(MonarchPageContext)

// Legacy single-conversation storage (migrated on first load).
const LEGACY_MESSAGES_KEY = 'monarch-chat-history-v2'
// Multi-thread storage: array of { id, title, messages, createdAt, updatedAt }
const THREADS_KEY = 'monarch-threads-v1'
const ACTIVE_THREAD_KEY = 'monarch-active-thread-v1'
const MAX_MESSAGES = 200
const MAX_THREADS = 50

// One-time cleanup: drop the v1 history (stale error bubbles from the Groq/Anthropic era)
try { localStorage.removeItem('monarch-chat-history') } catch { /* ignore */ }

function makeThreadId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeEmptyThread() {
  const now = Date.now()
  return {
    id: makeThreadId(),
    title: 'New Chat',
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

function deriveThreadTitle(messages) {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser || !firstUser.content) return 'New Chat'
  const trimmed = firstUser.content.trim().slice(0, 40)
  return trimmed + (firstUser.content.length > 40 ? '...' : '')
}

/**
 * Parse chart_spec code blocks from streamed text.
 * Claude outputs: ```chart_spec\n{"chart_type":"line",...}\n```
 * Returns { cleanText, charts[], hasPartialChart }
 * hasPartialChart = true when a chart_spec block has started but not closed yet (still streaming)
 */
function extractChartSpecs(text) {
  if (!text || !text.includes('chart_spec')) return { cleanText: text, charts: [], hasPartialChart: false }

  const charts = []
  // Recursively strip markdown (** bold, $TICKER pills, leading $) from
  // every string value inside a parsed chart_spec object. Llama 3.3 70b
  // sometimes ignores the "JSON strings are plain" prompt directive and
  // outputs `"value": "**$80,645**"` - rendering those raw looks broken.
  const stripMd = (s) => {
    if (typeof s !== 'string') return s
    let out = s.replace(/\*\*/g, '')          // bold markers
    out = out.replace(/`([^`]+)`/g, '$1')      // inline code
    return out
  }
  const cleanSpec = (val) => {
    if (val == null) return val
    if (typeof val === 'string') return stripMd(val)
    if (Array.isArray(val)) return val.map(cleanSpec)
    if (typeof val === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(val)) out[k] = cleanSpec(v)
      return out
    }
    return val
  }
  // Match complete chart_spec blocks
  let cleaned = text.replace(/```chart_spec\s*\n?([\s\S]*?)```/g, (_, json) => {
    try {
      const spec = cleanSpec(JSON.parse(json.trim()))
      // Resolve the chart type. The model may use either `type` or the legacy
      // `chart_type`. For asset charts we standardize on `spectre_asset`.
      const rawType = spec.type || spec.chart_type || 'line'
      const chart = {
        type: rawType,
        title: spec.title || 'Chart',
        source: spec.source || 'Monarch AI',
        labels: [],
        datasets: [],
        stats: Array.isArray(spec.stats) ? spec.stats : undefined,
        sources: Array.isArray(spec.sources) ? spec.sources : undefined,
        annotations: Array.isArray(spec.annotations) ? spec.annotations : undefined,
        switchable: spec.switchable !== false,
        // Preserve fields needed by the spectre_asset variant (which mounts
        // the real TradingView chart instead of drawing on canvas).
        symbol: typeof spec.symbol === 'string' ? spec.symbol.toUpperCase() : undefined,
        timeframe: typeof spec.timeframe === 'string' ? spec.timeframe : undefined,
      }
      // For spectre_asset we skip the labels/datasets pipeline — TradingView
      // fetches its own candles via /api/tradingview/udf/history.
      if (rawType !== 'spectre_asset') {
        if (Array.isArray(spec.data)) {
          chart.labels = spec.data.map(d => d.label || d.name || d.x || '')
          chart.datasets.push({
            label: spec.title || 'Value',
            data: spec.data.map(d => d.value || d.y || 0),
            color: spec.datasets?.[0]?.color || undefined,
          })
        }
        if (Array.isArray(spec.datasets)) {
          chart.labels = spec.labels || spec.datasets[0]?.data?.map((_, i) => `${i + 1}`) || []
          chart.datasets = spec.datasets
        }
      }
      charts.push(chart)
    } catch { /* malformed JSON, skip */ }
    return '' // strip from text
  })

  // Detect partial (unclosed) chart_spec blocks — still streaming in
  // Strip them from display and flag so the UI can show a loading skeleton
  let hasPartialChart = false
  cleaned = cleaned.replace(/```chart_spec[\s\S]*$/, () => {
    hasPartialChart = true
    return '' // strip partial block from display
  })

  return { cleanText: cleaned.trim(), charts, hasPartialChart }
}

/**
 * Parse dashboard_spec code blocks from streamed text.
 * Monarch outputs: ```dashboard_spec\n{"type":"dashboard","layout":"2x3","widgets":[...]}\n```
 * Returns { cleanText, dashboard, hasPartialDashboard }
 * hasPartialDashboard = true while a block is mid-stream (unclosed fence).
 */
function extractDashboardSpec(text) {
  if (!text || !text.includes('dashboard_spec')) {
    return { cleanText: text, dashboard: null, hasPartialDashboard: false }
  }

  let dashboard = null
  let cleaned = text.replace(/```dashboard_spec\s*\n?([\s\S]*?)```/g, (_, json) => {
    try {
      const spec = JSON.parse(json.trim())
      if (spec && spec.type === 'dashboard' && Array.isArray(spec.widgets)) {
        dashboard = spec // last valid dashboard wins (typically only one per response)
      }
    } catch { /* malformed JSON, skip */ }
    return '' // strip from display text
  })

  // Partial (unclosed) dashboard block — still streaming
  let hasPartialDashboard = false
  cleaned = cleaned.replace(/```dashboard_spec[\s\S]*$/, () => {
    hasPartialDashboard = true
    return ''
  })

  return { cleanText: cleaned.trim(), dashboard, hasPartialDashboard }
}

/**
 * Parse Monarch's rich DATA BLOCK fences from streamed text.
 * These are directives only — the client hydrates every number live:
 *   ```token_card\n{"symbol":"BTC","insight":"..."}\n```
 *   ```xdash_table\n{"limit":8}\n```
 *   ```bubble_map\n{"source":"gainers","limit":25}\n```
 * Returns { cleanText, blocks: [{kind, spec}], hasPartialBlock }
 */
const DATA_BLOCK_KINDS = ['token_card', 'xdash_table', 'bubble_map']
const DATA_BLOCK_STRIP_RE = new RegExp('```(' + DATA_BLOCK_KINDS.join('|') + ')\\s*\\n?([\\s\\S]*?)```', 'g')
const DATA_BLOCK_PARTIAL_RE = new RegExp('```(?:' + DATA_BLOCK_KINDS.join('|') + ')[\\s\\S]*$')

function extractDataBlocks(text) {
  if (!text || !DATA_BLOCK_KINDS.some(k => text.includes(k))) {
    return { cleanText: text, blocks: [], hasPartialBlock: false }
  }
  const blocks = []
  let cleaned = text.replace(DATA_BLOCK_STRIP_RE, (_, kind, json) => {
    try {
      const spec = JSON.parse(json.trim())
      // token_card may carry {tokens:[{symbol,insight}...]} — fan out to one
      // block per token so each card hydrates + renders independently.
      if (kind === 'token_card' && Array.isArray(spec?.tokens)) {
        for (const t of spec.tokens.slice(0, 4)) blocks.push({ kind, spec: t })
      } else {
        blocks.push({ kind, spec })
      }
    } catch { /* malformed JSON, skip */ }
    return ''
  })

  let hasPartialBlock = false
  cleaned = cleaned.replace(DATA_BLOCK_PARTIAL_RE, () => {
    hasPartialBlock = true
    return ''
  })

  return { cleanText: cleaned.trim(), blocks, hasPartialBlock }
}

function loadThreads() {
  // First try multi-thread storage
  try {
    const raw = localStorage.getItem(THREADS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(-MAX_THREADS).map(t => ({
          ...t,
          messages: Array.isArray(t.messages) ? t.messages.slice(-MAX_MESSAGES) : [],
        }))
      }
    }
  } catch { /* ignore */ }

  // Migrate from legacy single-conversation storage
  try {
    const raw = localStorage.getItem(LEGACY_MESSAGES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const messages = parsed.slice(-MAX_MESSAGES)
        const now = Date.now()
        const migrated = [{
          id: makeThreadId(),
          title: deriveThreadTitle(messages),
          messages,
          createdAt: messages[0]?.timestamp || now,
          updatedAt: messages[messages.length - 1]?.timestamp || now,
        }]
        // Keep legacy key for one session as safety net, then remove it.
        try { localStorage.removeItem(LEGACY_MESSAGES_KEY) } catch { /* ignore */ }
        return migrated
      }
    }
  } catch { /* ignore */ }

  return [makeEmptyThread()]
}

function loadActiveThreadId(threads) {
  try {
    const raw = localStorage.getItem(ACTIVE_THREAD_KEY)
    if (raw && threads.some(t => t.id === raw)) return raw
  } catch { /* ignore */ }
  return threads[threads.length - 1]?.id || null
}

function persistThreads(threads) {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(-MAX_THREADS)))
  } catch { /* ignore */ }
}

function persistActiveThreadId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_THREAD_KEY, id)
  } catch { /* ignore */ }
}

export function MonarchProvider({ children }) {
  const location = useLocation()
  const { token } = useAppState()
  const marketMode = useSettingsStore((s) => s.marketMode)

  const [chatOpen, setChatOpen] = useState(false)
  // Multi-thread state. Each thread has its own message array; `activeThreadId`
  // selects which one is currently visible. A default empty thread always exists
  // so the UI never renders against an empty thread list.
  const [threads, setThreads] = useState(loadThreads)
  // MUST derive from the SAME threads array as above. Calling loadThreads()
  // again here fabricates a fresh random thread id when localStorage is empty,
  // so activeThreadId never matched any thread and setMessages silently
  // no-oped — a dead chat page for every first-time visitor.
  const [activeThreadId, setActiveThreadId] = useState(() => loadActiveThreadId(threads))
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef(null)
  const sendingRef = useRef(false) // prevent double-send race condition

  // Derived: the active thread's messages. This is what the UI binds to.
  const messages = useMemo(() => {
    const active = threads.find(t => t.id === activeThreadId)
    return active?.messages || []
  }, [threads, activeThreadId])

  // Wrapper that mimics the old `setMessages(fn | nextArray)` signature but
  // updates the currently active thread's messages. All existing setMessages
  // call sites in `sendMessage` / `deleteMessage` keep working unchanged.
  const setMessages = useCallback((updater) => {
    setThreads(prev => {
      const idx = prev.findIndex(t => t.id === activeThreadId)
      if (idx === -1) return prev
      const currentMessages = prev[idx].messages
      const nextMessages = typeof updater === 'function' ? updater(currentMessages) : updater
      // Avoid cloning if nothing actually changed (prevents persist churn).
      if (nextMessages === currentMessages) return prev
      const nextThread = {
        ...prev[idx],
        messages: nextMessages,
        updatedAt: Date.now(),
        title: prev[idx].title === 'New Chat' ? deriveThreadTitle(nextMessages) : prev[idx].title,
      }
      const next = [...prev]
      next[idx] = nextThread
      return next
    })
  }, [activeThreadId])

  // Live-data reflection — which Spectre endpoints the last Monarch call actually hit.
  // Used by the chat page's right sidebar to update the Intelligence Feed dots.
  // Shape: { endpoints: string[], assets: string[], topics: string[], at: epoch ms }
  const [lastUsedEndpoints, setLastUsedEndpoints] = useState({
    endpoints: [], assets: [], topics: [], at: 0,
  })

  // Compact data summary from the latest meta event — drives the "F&G: 16 · Extreme Fear"
  // style inline values next to Intelligence Feed dots. Populated from server-side
  // FIELD_EXTRACTORS output so the frontend doesn't duplicate parsing logic.
  // Shape: { fearGreed:{score,label}|null, btcDominance, btcPrice, newsCount, hasStaleness }
  const [lastSummary, setLastSummary] = useState({
    fearGreed: null, btcDominance: null, btcPrice: null, newsCount: 0, hasStaleness: false,
  })

  // Cumulative unique endpoints hit across this browser session — displayed in Session panel
  const [sessionEndpoints, setSessionEndpoints] = useState(() => new Set())

  // Model metadata from /api/monarch/health — replaces the hardcoded 'Claude Sonnet' label.
  // Shape: { model: string, endpoint: string, provider: 'ollama'|'groq'|'openai'|'custom' }
  const [modelInfo, setModelInfo] = useState({ model: '—', endpoint: '', provider: '' })

  // Persist threads + active thread id on change. DEBOUNCED: `threads` changes on
  // every streamed token (setMessages -> setThreads), and persistThreads runs a
  // synchronous JSON.stringify over all threads x messages + localStorage.setItem
  // on the main thread. A 500ms debounce coalesces the streaming burst into one
  // write after the stream settles (partial-message loss on a mid-stream reload
  // is acceptable).
  const persistTimerRef = useRef(null)
  useEffect(() => {
    clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => persistThreads(threads), 500)
    return () => clearTimeout(persistTimerRef.current)
  }, [threads])

  useEffect(() => {
    persistActiveThreadId(activeThreadId)
  }, [activeThreadId])

  // Fetch model metadata so the sidebar shows the real model name, and re-poll
  // every 5 minutes in case the env/LLM provider swaps mid-session.
  // Gated to chat-open: the model label only renders inside the chat surface, so
  // there's no reason to poll /api/monarch/health app-wide while the chat is closed.
  // Still visibility-guarded so a backgrounded-but-open chat tab doesn't poll.
  useEffect(() => {
    if (!chatOpen) return undefined
    const shouldPollHealth = !import.meta.env.DEV || import.meta.env.VITE_ENABLE_MONARCH_HEALTH === 'true'
    if (!shouldPollHealth) return undefined

    let cancelled = false
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/monarch/health', { signal: AbortSignal.timeout(3000) })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.model) {
          setModelInfo({
            model: data.model,
            endpoint: data.endpoint || '',
            provider: data.provider || 'custom',
          })
        }
      } catch { /* silent — sidebar will just show '—' */ }
    }
    fetchHealth()
    const interval = setInterval(() => {
      if (document.hidden) return
      fetchHealth()
    }, 5 * 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [chatOpen])

  // Current page context — updates reactively as user navigates
  const currentContext = useMemo(() => ({
    page: getPageIdFromPath(location.pathname) || 'research-platform',
    token: token ? { symbol: token.symbol, name: token.name } : null,
    marketMode,
  }), [location.pathname, token, marketMode])

  const openChat = useCallback(() => setChatOpen(true), [])
  const closeChat = useCallback(() => setChatOpen(false), [])
  const toggleChat = useCallback(() => setChatOpen(prev => !prev), [])

  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || isStreaming || sendingRef.current) return
    sendingRef.current = true

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    }

    const monarchMsgId = `m-${Date.now()}`
    const monarchMsg = {
      id: monarchMsgId,
      role: 'monarch',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    }

    setMessages(prev => [...prev, userMsg, monarchMsg])
    setIsStreaming(true)

    // Build message history for API (last 20 messages for context window)
    const historyForApi = [...messages, userMsg]
      .slice(-20)
      .map(m => ({ role: m.role === 'monarch' ? 'assistant' : 'user', content: m.content }))

    const requestBody = JSON.stringify({
      messages: historyForApi,
      context: currentContext,
    })

    // Stream a single attempt. Returns true on success, false on retryable failure.
    const streamAttempt = async (signal) => {
      const res = await fetch('/api/monarch/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal,
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let gotContent = false

      // --- rAF-throttled spec parsing ---------------------------------------
      // Streamed TEXT updates per-token (see the `text` branch). But the spec
      // extraction (extractChartSpecs + extractDashboardSpec) runs a regex over
      // the FULL accumulated string each call -> O(n^2) over response length if
      // run on every token. We therefore throttle ONLY the spec extraction to at
      // most once per animation frame. The visible streamed words still update
      // every token; only chart/dashboard spec re-parse is coalesced to a frame.
      let specRafId = null
      const runSpecParse = () => {
        specRafId = null
        // Three-pass: strip chart_spec blocks, then dashboard_spec, then the
        // rich data-block fences (token_card / xdash_table / bubble_map).
        const chartPass = extractChartSpecs(accumulated)
        const dashPass = extractDashboardSpec(chartPass.cleanText)
        const blockPass = extractDataBlocks(dashPass.cleanText)
        const cleanText = blockPass.cleanText
        const { charts, hasPartialChart } = chartPass
        const { dashboard, hasPartialDashboard } = dashPass
        const { blocks, hasPartialBlock } = blockPass
        setMessages(prev => prev.map(m => {
          if (m.id !== monarchMsgId) return m
          const next = { ...m, content: cleanText }
          if (charts.length > 0) {
            next.charts = charts
            next.chart = charts[charts.length - 1]
          }
          next.chartLoading = hasPartialChart
          if (dashboard) next.dashboard = dashboard
          next.dashboardLoading = hasPartialDashboard
          if (blocks.length > 0) next.blocks = blocks
          next.blocksLoading = hasPartialBlock
          return next
        }))
      }
      const scheduleSpecParse = () => {
        if (specRafId != null) return
        specRafId = (typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(runSpecParse)
          : setTimeout(runSpecParse, 16))
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue

          try {
            const evt = JSON.parse(payload)
            if (evt.type === 'meta') {
              // Meta event from server — which Spectre endpoints were consulted for this answer.
              // Drives the intelligence feed dots in the chat page's right sidebar.
              const endpoints = Array.isArray(evt.endpoints) ? evt.endpoints : []
              const assets = Array.isArray(evt.assets) ? evt.assets : []
              const topics = Array.isArray(evt.topics) ? evt.topics : []
              setLastUsedEndpoints({ endpoints, assets, topics, at: Date.now() })
              // Compact data summary for right-sidebar inline values (F&G score, etc.)
              if (evt.summary) setLastSummary(evt.summary)
              // Cumulative unique endpoint count across the session
              setSessionEndpoints(prev => {
                const next = new Set(prev)
                for (const ep of endpoints) next.add(ep)
                return next
              })
              // Also attach endpoints + summary to THIS specific message for the per-message
              // "Sources: ..." footer (Perplexity-style trust signal).
              setMessages(prev => prev.map(m =>
                m.id === monarchMsgId
                  ? { ...m, endpoints, assetsUsed: assets, topicsUsed: topics, summary: evt.summary || null }
                  : m
              ))
              // Server also surfaces provider/model per-request — keep sidebar label fresh.
              if (evt.model || evt.provider) {
                setModelInfo(prev => ({
                  ...prev,
                  model: evt.model || prev.model,
                  provider: evt.provider || prev.provider,
                }))
              }
            } else if (evt.type === 'text') {
              gotContent = true
              accumulated += evt.content
              // Has the response EVER contained a spec fence? Cheap substring test.
              // Until a chart_spec/dashboard_spec marker appears, cleanText === the
              // raw accumulated string, so we can append text per-token with zero
              // regex work (the common case for plain-text answers).
              const hasSpecMarker = accumulated.includes('chart_spec') || accumulated.includes('dashboard_spec')
                || accumulated.includes('token_card') || accumulated.includes('xdash_table') || accumulated.includes('bubble_map')
              if (!hasSpecMarker) {
                // Fast path: per-token text update, no spec extraction at all.
                setMessages(prev => prev.map(m =>
                  m.id === monarchMsgId ? { ...m, content: accumulated } : m
                ))
              } else {
                // Spec markers present: the streamed text still needs to update
                // per-token, but the EXPENSIVE extraction is coalesced to one run
                // per animation frame. Schedule the parse; it owns the setMessages
                // (it strips the fenced blocks from the visible content).
                scheduleSpecParse()
              }
            } else if (evt.type === 'tool_start') {
              // Show searching indicator
              setMessages(prev => prev.map(m =>
                m.id === monarchMsgId
                  ? { ...m, toolActive: evt.name }
                  : m
              ))
            } else if (evt.type === 'tool_done') {
              setMessages(prev => prev.map(m =>
                m.id === monarchMsgId
                  ? { ...m, toolActive: null }
                  : m
              ))
            } else if (evt.type === 'chart') {
              // Inline chart spec from Monarch
              setMessages(prev => prev.map(m =>
                m.id === monarchMsgId
                  ? { ...m, chart: evt.spec }
                  : m
              ))
            } else if (evt.type === 'error') {
              accumulated += `\n\n_${evt.content}_`
              setMessages(prev => prev.map(m =>
                m.id === monarchMsgId
                  ? { ...m, content: accumulated }
                  : m
              ))
            }
          } catch { /* skip malformed JSON */ }
        }
      }

      // Finalize — cancel any pending throttled parse and run one last parse so
      // the closing fences (which may have arrived in the final chunk) are captured.
      if (specRafId != null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(specRafId)
        else clearTimeout(specRafId)
        specRafId = null
      }
      const finalChart = extractChartSpecs(accumulated)
      const finalDash = extractDashboardSpec(finalChart.cleanText)
      const finalBlocks = extractDataBlocks(finalDash.cleanText)
      setMessages(prev => prev.map(m => {
        if (m.id !== monarchMsgId) return m
        const next = {
          ...m,
          content: finalBlocks.cleanText || m.content,
          streaming: false,
          toolActive: null,
          chartLoading: false,
          dashboardLoading: false,
          blocksLoading: false,
        }
        if (finalChart.charts.length > 0) {
          next.charts = finalChart.charts
          next.chart = finalChart.charts[finalChart.charts.length - 1]
        }
        if (finalDash.dashboard) {
          next.dashboard = finalDash.dashboard
        }
        if (finalBlocks.blocks.length > 0) {
          next.blocks = finalBlocks.blocks
        }
        return next
      }))

      return gotContent
    }

    try {
      abortRef.current = new AbortController()

      let success = false
      try {
        success = await streamAttempt(abortRef.current.signal)
      } catch (err) {
        if (err.name === 'AbortError') return
        // Auto-retry once on connection/network errors (not HTTP errors like 4xx)
        // Reset the monarch message to blank before retrying
        console.warn('[Monarch] First attempt failed, retrying...', err.message)
        setMessages(prev => prev.map(m =>
          m.id === monarchMsgId
            ? { ...m, content: '', streaming: true, error: false }
            : m
        ))
        abortRef.current = new AbortController()
        try {
          success = await streamAttempt(abortRef.current.signal)
        } catch (retryErr) {
          if (retryErr.name === 'AbortError') return
          throw retryErr
        }
      }

      if (!success) {
        // Stream completed but no text content received
        setMessages(prev => prev.map(m =>
          m.id === monarchMsgId && !m.content
            ? { ...m, content: '_No response received. Try again._', streaming: false }
            : { ...m, streaming: false }
        ))
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      const isTimeout = err.message?.includes('timeout') || err.message?.includes('Timeout')
      const errorMsg = isTimeout
        ? 'Request timed out. The model may be busy — try again.'
        : 'Connection lost. Check your network and try again.'
      setMessages(prev => prev.map(m =>
        m.id === monarchMsgId
          ? { ...m, content: errorMsg, streaming: false, error: true }
          : m
      ))
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      sendingRef.current = false
    }
  }, [messages, isStreaming, currentContext])

  // Clear ONLY the active thread's messages. Other threads are untouched.
  // The thread itself stays (empty) so the UI has something to render.
  const clearHistory = useCallback(() => {
    setThreads(prev => prev.map(t =>
      t.id === activeThreadId
        ? { ...t, messages: [], title: 'New Chat', updatedAt: Date.now() }
        : t
    ))
  }, [activeThreadId])

  const deleteMessage = useCallback((msgId) => {
    setMessages(prev => prev.filter(m => m.id !== msgId))
  }, [setMessages])

  // Create a fresh thread and switch to it. Existing threads are preserved.
  // If the current thread is already empty, just reuse it (don't pile up empties).
  const newThread = useCallback(() => {
    setThreads(prev => {
      const active = prev.find(t => t.id === activeThreadId)
      if (active && active.messages.length === 0) {
        // Current thread is empty — no point creating another empty one.
        return prev
      }
      const fresh = makeEmptyThread()
      setActiveThreadId(fresh.id)
      return [...prev, fresh].slice(-MAX_THREADS)
    })
  }, [activeThreadId])

  const switchThread = useCallback((threadId) => {
    setThreads(prev => {
      if (!prev.some(t => t.id === threadId)) return prev
      setActiveThreadId(threadId)
      return prev
    })
  }, [])

  // Remove a thread. If the deleted thread was active, switch to the most
  // recently updated remaining thread. If that leaves zero threads, create
  // a fresh empty one so the UI always has something to render.
  const deleteThread = useCallback((threadId) => {
    setThreads(prev => {
      const filtered = prev.filter(t => t.id !== threadId)
      if (filtered.length === 0) {
        const fresh = makeEmptyThread()
        setActiveThreadId(fresh.id)
        return [fresh]
      }
      if (threadId === activeThreadId) {
        // Pick the most recently updated remaining thread as the new active.
        const sorted = [...filtered].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        setActiveThreadId(sorted[0].id)
      }
      return filtered
    })
  }, [activeThreadId])

  // Rename a thread (user-triggered via the chat title input).
  const renameThread = useCallback((threadId, title) => {
    const trimmed = String(title || '').trim()
    if (!trimmed) return
    setThreads(prev => prev.map(t =>
      t.id === threadId ? { ...t, title: trimmed, updatedAt: Date.now() } : t
    ))
  }, [])

  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      setIsStreaming(false)
    }
  }, [])

  // Shell-only value: chat open/close + modelInfo. These are low-frequency
  // (chatOpen flips on user action; modelInfo updates on /api/monarch/health
  // poll). They do NOT include `messages`, so AppShell - which consumes this
  // via useMonarchShell() - no longer re-renders on every streamed token.
  const shellValue = useMemo(() => ({
    chatOpen, openChat, closeChat, toggleChat, modelInfo,
  }), [chatOpen, openChat, closeChat, toggleChat, modelInfo])

  // NOTE: currentContext is intentionally NOT in this value — it lives in
  // MonarchPageContext (below) because it changes on every navigation. Including
  // it here would re-render every useMonarch() consumer (AppShell etc.) on each
  // route change. See useMonarchPage().
  // NOTE: shell fields (chatOpen / openChat / closeChat / toggleChat / modelInfo)
  // are ALSO kept here for back-compat so existing useMonarch() consumers
  // (mini-chat, chat-page) keep working unchanged. The shell win comes from
  // AppShell switching to useMonarchShell() so it stops subscribing to messages.
  const value = useMemo(() => ({
    chatOpen, openChat, closeChat, toggleChat,
    messages, sendMessage, clearHistory, deleteMessage, stopStreaming,
    isStreaming,
    // Phase 2 additions: live data reflection + model info
    lastUsedEndpoints, modelInfo,
    // Phase 3 polish additions: compact data summary + session endpoint count
    lastSummary, sessionEndpoints,
    // Multi-thread support: list of threads, active id, and actions to manage them.
    threads, activeThreadId, newThread, switchThread, deleteThread, renameThread,
  }), [
    chatOpen, openChat, closeChat, toggleChat,
    messages, sendMessage, clearHistory, deleteMessage, stopStreaming,
    isStreaming,
    lastUsedEndpoints, modelInfo,
    lastSummary, sessionEndpoints,
    threads, activeThreadId, newThread, switchThread, deleteThread, renameThread,
  ])

  return (
    <MonarchShellContext.Provider value={shellValue}>
      <MonarchContext.Provider value={value}>
        <MonarchPageContext.Provider value={currentContext}>
          {children}
        </MonarchPageContext.Provider>
      </MonarchContext.Provider>
    </MonarchShellContext.Provider>
  )
}

export default MonarchContext
