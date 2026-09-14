/**
 * MonarchChatPage — full-page Monarch AI chat experience.
 * Three-column layout: history sidebar, main chat, intelligence panel.
 * Perplexity-inspired: sticky bottom input, gradient bar, spacious layout.
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMonarch, useMonarchPage } from '@/contexts/MonarchContext'
import MonarchMessageBubble from '@/components/monarch/monarch-message-bubble'
import MonarchInput from '@/components/monarch/monarch-input'
import MonarchChart from '@/components/monarch/monarch-chart'
import { spectreIcons } from '@/icons/spectreIcons'
import useSettingsStore from '@/store/useSettingsStore'
import './monarch-chat-page.css'

/* ── Empty-state hero cards — each demos one of Monarch's live surfaces ──
 * The chip names what the answer renders (live card / X-Dash board / bubble
 * map / dashboard) so the empty state doubles as a feature tour. */
const SUGGESTIONS = [
  {
    icon: 'chart',
    label: 'Read an asset',
    description: 'Give me your read on BTC right now',
    prompt: 'Give me your read on BTC right now',
    chip: 'Live card + chart',
  },
  {
    icon: 'trend',
    label: 'Trending on X',
    description: 'What tokens are trending on X right now?',
    prompt: 'What tokens are trending on X right now? Show me the board.',
    chip: 'X-Dash board',
  },
  {
    icon: 'compare',
    label: 'Map the market',
    description: 'Show me the market as a bubble map',
    prompt: 'Show me the biggest movers today as a bubble map',
    chip: 'Bubble map',
  },
  {
    icon: 'analysis',
    label: 'Deep dive',
    description: 'Should I buy ETH? Full investor brief',
    prompt: 'Should I buy ETH? Give me the full investor brief.',
    chip: 'Dashboard',
  },
]

/* ── Sidebar suggested prompts, grouped by desk — the Ranger-style rail
 * done Spectre-native. Every item is a real prompt wired to live blocks. */
const SUGGESTION_GROUPS = [
  {
    label: 'Markets',
    items: [
      { icon: 'chart', label: 'BTC read right now', prompt: 'Give me your read on BTC right now' },
      { icon: 'compare', label: 'BTC vs ETH setup', prompt: 'Compare BTC and ETH — which setup looks stronger?' },
      { icon: 'trend', label: 'Biggest movers map', prompt: 'Show me the biggest movers today as a bubble map' },
    ],
  },
  {
    label: 'X Intelligence',
    items: [
      { icon: 'trend', label: 'Trending on X', prompt: 'What tokens are trending on X right now? Show me the board.' },
      { icon: 'analysis', label: 'Sentiment for a ticker', prompt: 'What is the X sentiment for $BTC right now?' },
      { icon: 'compare', label: 'Social runners map', prompt: 'Show me the social runners as a bubble map' },
    ],
  },
  {
    label: 'Deep Dive',
    items: [
      { icon: 'analysis', label: 'Investor brief', prompt: 'Should I buy ETH? Give me the full investor brief.' },
      { icon: 'chart', label: 'Build a dashboard', prompt: 'Build me a market overview dashboard' },
      { icon: 'trend', label: 'Narratives building', prompt: 'What narratives are trending right now?' },
    ],
  },
]

/* ── Bucket threads by recency for the grouped sidebar ── */
function groupThreadsByDate(threads) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  const startOfWeek = startOfToday - 6 * 86_400_000
  const buckets = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const t of threads) {
    const ts = t.updatedAt || t.createdAt || 0
    if (ts >= startOfToday) buckets[0].items.push(t)
    else if (ts >= startOfYesterday) buckets[1].items.push(t)
    else if (ts >= startOfWeek) buckets[2].items.push(t)
    else buckets[3].items.push(t)
  }
  return buckets.filter(b => b.items.length > 0)
}

/* ── Inline SVG icons for suggestion cards ── */
const SUGGESTION_ICONS = {
  sparkle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-8 4 4 6-10" />
    </svg>
  ),
  bitcoin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042l-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893l-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042l.348-1.97M7.48 16.848l-1.695-7.635m2.37 8.267l-.347 1.968m-.328-11.83l-.347 1.969" />
    </svg>
  ),
  wave: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M2 12c2-3 4-5 6-5s4 4 6 4 4-4 6-4" />
      <path d="M2 17c2-3 4-5 6-5s4 4 6 4 4-4 6-4" />
    </svg>
  ),
  fire: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M12 12c-2-2.67-4-4.33-4-6a4 4 0 018 0c0 1.67-2 3.33-4 6z" />
      <path d="M12 21a8 8 0 01-8-8c0-3.37 2.46-5.82 4-8l2 2a6 6 0 004 0l2-2c1.54 2.18 4 4.63 4 8a8 8 0 01-8 8z" />
    </svg>
  ),
  gauge: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
}

/* ── Panel icons ── */
const PanelIcon = ({ type }) => {
  const icons = {
    chart: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 6-10" />
      </svg>
    ),
    analysis: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    trend: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M22 7l-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" />
      </svg>
    ),
    compare: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  }
  return icons[type] || null
}

/* ── Capability chip prompts — clicking a chip sends these to Monarch ── */
const CAPABILITY_PROMPTS = {
  charts: 'Show me BTC price action this week',
  technical: 'Give me a full technical breakdown of BTC',
  trends: 'What narratives are trending right now?',
  compare: 'Compare BTC and ETH — which setup looks stronger?',
  dashboard: 'Build me a market overview dashboard',
  whale: 'Show me whale activity and smart money flows',
}

/* ── Relative time formatter for sidebar thread timestamps ──
 * "just now", "5m ago", "2h ago", "Yesterday", "Mar 14"
 */
function formatRelativeTime(ts) {
  if (!ts) return ''
  const now = Date.now()
  const diffMs = now - ts
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  // Older than a week — show month/day
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ── Endpoint → feed-dot category mapping. Any endpoint in the list counts as that category ── */
function mapEndpointsToFeedDots(endpoints) {
  const set = new Set(endpoints || [])
  const has = (pred) => [...set].some(pred)
  return {
    market: has(k => k === 'global' || k.startsWith('price_') || k.startsWith('technicals_') || k === 'fear_greed'),
    news: has(k => k === 'news' || k === 'breaking' || k === 'trending' || k === 'signals'),
    onchain: has(k => k.startsWith('holders_') || k === 'whale_transactions' || k.startsWith('derivatives_') || k === 'defi_protocols' || k === 'unlocks'),
  }
}

export default function MonarchChatPage() {
  const {
    messages, sendMessage, clearHistory, deleteMessage, stopStreaming,
    isStreaming, lastUsedEndpoints,
    lastSummary, sessionEndpoints, openChat,
    // Multi-thread actions
    threads, activeThreadId, newThread, switchThread, deleteThread, renameThread,
  } = useMonarch()
  const currentContext = useMonarchPage()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const navigate = useNavigate()

  /* Minimize to floating panel: open the mini chat, then navigate back to whatever
   * page the user came from (or fall back to research home if history is empty).
   * Shared MonarchContext means the thread carries over seamlessly. */
  const handleMinimize = useCallback(() => {
    openChat()
    // navigate(-1) returns to previous page if history exists; otherwise go home.
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }, [openChat, navigate])

  // Derive the three intelligence-feed dot states from the last request's endpoints.
  // Fresh = green if hit within the last 60 seconds, dim otherwise.
  const feedDots = useMemo(() => {
    const fresh = lastUsedEndpoints?.at && (Date.now() - lastUsedEndpoints.at < 60_000)
    const base = { market: false, news: false, onchain: false }
    if (!fresh) return base
    return mapEndpointsToFeedDots(lastUsedEndpoints.endpoints)
  }, [lastUsedEndpoints])

  const chatAreaRef = useRef(null)
  const bottomSentinelRef = useRef(null)
  const prevMsgCountRef = useRef(0)
  const titleInputRef = useRef(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [threadMenuId, setThreadMenuId] = useState(null)
  const [fullscreenChart, setFullscreenChart] = useState(null)
  const [chatTitle, setChatTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [panelTab, setPanelTab] = useState('links')
  const [isAtBottom, setIsAtBottom] = useState(true)

  /* IntersectionObserver tracks whether the bottom sentinel is visible.
   * Fires once per scroll change (not once per frame), so this replaces the
   * old onScroll handler that was polling scrollTop. Much smoother during
   * high-frequency token streaming. */
  useEffect(() => {
    const sentinel = bottomSentinelRef.current
    const root = chatAreaRef.current
    if (!sentinel || !root) return
    const observer = new IntersectionObserver(
      ([entry]) => setIsAtBottom(entry.isIntersecting),
      { root, threshold: 0.01, rootMargin: '0px 0px 80px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  /* Smart auto-scroll with two distinct behaviors:
   *   1. New user message just added → smooth scroll to bottom (they want
   *      to see their message appear + the incoming streaming bubble)
   *   2. Streaming token update to an existing message → instant tail-follow
   *      ONLY if user is still at the bottom. If they scrolled up, leave
   *      them alone and let the "↓ New messages" pill catch their attention.
   *
   * Never force-scroll on message completion — preserves user's scroll intent. */
  useEffect(() => {
    const el = chatAreaRef.current
    if (!el || !bottomSentinelRef.current) return

    const prevCount = prevMsgCountRef.current
    const isNewPair = messages.length > prevCount
    prevMsgCountRef.current = messages.length

    // New user send: always scroll with smooth animation (messages arrive in pairs:
    // [userMsg, monarchMsg], so the 2nd-to-last will be the user message just added)
    if (isNewPair) {
      const secondLast = messages[messages.length - 2]
      if (secondLast?.role === 'user') {
        requestAnimationFrame(() => {
          bottomSentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        })
        return
      }
    }

    // Streaming token update: instant tail-follow only if user is still at bottom
    if (isAtBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, isAtBottom])

  const scrollToBottom = useCallback(() => {
    bottomSentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  const handleSend = useCallback((text) => {
    // Sending resets intent: user wants to see their new message
    setIsAtBottom(true)
    sendMessage(text)
  }, [sendMessage])

  const handleSuggestion = useCallback((prompt) => {
    setIsAtBottom(true)
    sendMessage(prompt)
  }, [sendMessage])

  const handleClear = useCallback(() => {
    clearHistory()
    setShowClearConfirm(false)
  }, [clearHistory])

  /* New Thread: create a fresh thread without touching existing ones. If the
   * current thread is already empty, newThread() is a no-op in the context. */
  const handleNewThread = useCallback(() => {
    newThread()
    setIsAtBottom(true)
  }, [newThread])

  /* Switch to a different thread — just flip the active id in context. */
  const handleSwitchThread = useCallback((threadId) => {
    if (threadId === activeThreadId) return
    switchThread(threadId)
    setIsAtBottom(true)
  }, [activeThreadId, switchThread])

  /* Delete a whole thread from the sidebar (not just its messages). */
  const handleDeleteThread = useCallback((threadId) => {
    deleteThread(threadId)
    setThreadMenuId(null)
  }, [deleteThread])

  /* Context label from current page + token */
  const contextLabel = useMemo(() => {
    const parts = []
    if (currentContext?.page) {
      parts.push(currentContext.page.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    }
    if (currentContext?.token?.symbol) {
      parts.push(currentContext.token.symbol)
    }
    return parts.join(' · ') || 'Research Platform'
  }, [currentContext])

  /* Sorted thread list for the sidebar: most recently updated first. */
  const sortedThreads = useMemo(() => {
    return [...(threads || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }, [threads])

  /* Threads bucketed Today / Yesterday / This week / Older for the grouped rail.
   * Empty "New Chat" threads are hidden from history — they're a UI artifact. */
  const threadGroups = useMemo(() => {
    return groupThreadsByDate(sortedThreads.filter(t => (t.messages?.length || 0) > 0 || t.id === activeThreadId))
  }, [sortedThreads, activeThreadId])

  /* Keep the chat title input in sync with the active thread. Switching threads
   * should reflect the new thread's title; empty threads clear it. */
  useEffect(() => {
    const active = threads?.find(t => t.id === activeThreadId)
    if (!active) { setChatTitle(''); return }
    if (active.messages.length === 0) {
      setChatTitle('')
      return
    }
    // Prefer the thread's stored title if user has already renamed it, else
    // derive from the first user message.
    if (active.title && active.title !== 'New Chat') {
      setChatTitle(active.title)
    } else {
      const firstUser = active.messages.find(m => m.role === 'user')
      if (firstUser) {
        setChatTitle(firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '...' : ''))
      }
    }
  }, [activeThreadId, threads])

  /* Extract links and images from all messages (text + chart sources) */
  const { links, images } = useMemo(() => {
    const linkSet = new Set()
    const imageSet = new Set()
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g
    const imgExts = /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?[^\s]*)?$/i

    for (const msg of messages) {
      // Scan message text content
      if (msg.content) {
        const urls = msg.content.match(urlRegex) || []
        for (const url of urls) {
          if (imgExts.test(url)) {
            imageSet.add(url)
          } else {
            linkSet.add(url)
          }
        }
      }
      // Scan chart source pills for URLs
      const allCharts = msg.charts || (msg.chart ? [msg.chart] : [])
      for (const chart of allCharts) {
        if (chart.sources) {
          for (const src of chart.sources) {
            if (src.url) linkSet.add(src.url)
          }
        }
      }
    }
    return {
      links: [...linkSet],
      images: [...imageSet],
    }
  }, [messages])

  const handleTitleEdit = useCallback(() => {
    setIsEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 0)
  }, [])

  const handleTitleSave = useCallback((e) => {
    if (e) e.preventDefault()
    setIsEditingTitle(false)
    const trimmed = chatTitle.trim()
    if (!trimmed) {
      const firstUser = messages.find(m => m.role === 'user')
      setChatTitle(firstUser ? firstUser.content.slice(0, 60) : 'New Chat')
      return
    }
    // Persist the new title onto the active thread so it survives thread switches.
    if (activeThreadId) renameThread(activeThreadId, trimmed)
  }, [chatTitle, messages, activeThreadId, renameThread])

  const handleTitleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleTitleSave()
    if (e.key === 'Escape') {
      setIsEditingTitle(false)
      const firstUser = messages.find(m => m.role === 'user')
      setChatTitle(firstUser ? firstUser.content.slice(0, 60) : 'New Chat')
    }
  }, [handleTitleSave, messages])

  return (
    <div className={`monarch-page ${dayMode ? 'monarch-page-day' : ''}`}>

      {/* ── Left Sidebar ── */}
      <aside className="monarch-page-sidebar">
        <div className="monarch-page-sidebar-header">
          <span className="monarch-page-sidebar-icon">{spectreIcons.monarch}</span>
          <span className="monarch-page-sidebar-title">Monarch</span>
        </div>

        <button
          className="monarch-page-new-chat"
          onClick={handleNewThread}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Thread
        </button>

        {/* Thread history — grouped Today / Yesterday / This week / Older */}
        <div className="monarch-page-history">
          {threadGroups.length === 0 && (
            <div className="monarch-page-history-empty">No conversations yet</div>
          )}
          {threadGroups.map((group) => (
            <div key={group.label} className="monarch-page-history-group">
              <div className="monarch-page-history-group-label">{group.label}</div>
              {group.items.map((thread) => {
                const isActive = thread.id === activeThreadId
                return (
                  <div
                    key={thread.id}
                    role="button"
                    tabIndex={0}
                    className={`monarch-page-history-item ${isActive ? 'monarch-page-history-item-active' : ''}`}
                    onClick={() => handleSwitchThread(thread.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSwitchThread(thread.id) }}
                  >
                    <div className="monarch-page-history-item-body">
                      <span className="monarch-page-history-item-text">{thread.title || 'New Chat'}</span>
                      {thread.updatedAt && (
                        <span className="monarch-page-history-item-time">{formatRelativeTime(thread.updatedAt)}</span>
                      )}
                    </div>
                    <button
                      className="monarch-page-history-item-delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteThread(thread.id) }}
                      title="Delete thread"
                      aria-label="Delete thread"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Suggested prompts — grouped by desk, every item is a live prompt */}
        <div className="monarch-page-sidebar-caps monarch-page-suggested">
          <div className="monarch-page-sidebar-caps-title">Suggested</div>
          {SUGGESTION_GROUPS.map((group) => (
            <div key={group.label} className="monarch-page-sugg-group">
              <div className="monarch-page-sugg-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="monarch-page-sugg-item"
                  onClick={() => handleSuggestion(item.prompt)}
                  disabled={isStreaming}
                >
                  <span className="monarch-page-sugg-icon"><PanelIcon type={item.icon} /></span>
                  <span className="monarch-page-sugg-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Live status indicator */}
        <div className="monarch-page-sidebar-model">
          <span className="monarch-page-pulse-dot monarch-page-pulse-dot-live" />
          <span className="monarch-page-sidebar-model-label">Live</span>
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <main className="monarch-page-main">
        {/* Top bar */}
        <div className="monarch-page-main-header">
          <div className="monarch-page-header-left">
            <div className="monarch-page-context">
              <span className="monarch-page-context-dot" />
              <span className="monarch-page-context-label">{contextLabel}</span>
            </div>
            {messages.length > 0 && (
              isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  className="monarch-page-chat-title-input"
                  value={chatTitle}
                  onChange={(e) => setChatTitle(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                />
              ) : (
                <span
                  className="monarch-page-chat-title"
                  onClick={handleTitleEdit}
                  title="Click to rename"
                >
                  {chatTitle || 'New Chat'}
                </span>
              )
            )}
          </div>
          <div className="monarch-page-header-right">
            {isStreaming && (
              <button className="monarch-page-stop" onClick={stopStreaming}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                Stop
              </button>
            )}
            <button
              className="monarch-page-minimize"
              onClick={handleMinimize}
              title="Minimize to floating panel"
              aria-label="Minimize Monarch"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages scroll area — IntersectionObserver on bottomSentinelRef tracks at-bottom */}
        <div className="monarch-page-messages" ref={chatAreaRef}>
          {messages.length === 0 && (
            <div className="monarch-page-empty">
              <div className="monarch-page-empty-crown">
                {spectreIcons.monarch}
              </div>
              <h2 className="monarch-page-empty-title">What&rsquo;s moving?</h2>
              <p className="monarch-page-empty-desc">
                Monarch reads the tape, the room and the chain — with live cards, boards and maps in the answer.
              </p>
              <div className="monarch-page-empty-grid">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    className="monarch-page-suggestion-card"
                    onClick={() => handleSuggestion(s.prompt)}
                  >
                    <span className="monarch-page-suggestion-icon">
                      <PanelIcon type={s.icon} />
                    </span>
                    <span className="monarch-page-suggestion-label">{s.label}</span>
                    <span className="monarch-page-suggestion-desc">{s.description}</span>
                    {s.chip && <span className="monarch-page-suggestion-chip">{s.chip}</span>}
                  </button>
                ))}
              </div>
              <p className="monarch-page-empty-tail">
                Or ask anything about crypto markets
              </p>
            </div>
          )}

          {messages.map(msg => (
            <MonarchMessageBubble
              key={msg.id}
              message={msg}
              onDelete={deleteMessage}
              onFullscreenChart={setFullscreenChart}
            />
          ))}

          {/* Bottom sentinel for IntersectionObserver — must be the last child of the scroll area */}
          <div ref={bottomSentinelRef} style={{ height: 1 }} aria-hidden="true" />
        </div>

        {/* ↓ New messages pill — appears when streaming AND user has scrolled up */}
        {isStreaming && !isAtBottom && (
          <button
            type="button"
            className="monarch-page-new-msg-pill"
            onClick={scrollToBottom}
            aria-label="Jump to latest message"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
            New messages
          </button>
        )}

        {/* Sticky bottom input */}
        <div className="monarch-page-input-area">
          <div className="monarch-page-input-fade" />
          <div className="monarch-page-input-wrap">
            <div className="monarch-page-input-inner">
              <MonarchInput
                onSend={handleSend}
                disabled={isStreaming}
                placeholder="Ask Monarch anything..."
              />
            </div>
          </div>
          <div className="monarch-page-input-footer">
            Monarch can make mistakes. Verify important information.
          </div>
        </div>
      </main>

      {/* ── Right Panel ── */}
      <aside className="monarch-page-panel">
        {/* Intelligence Feeds — reactive: dots light up when the last Monarch request hit them,
            inline values come from the server's summary block on the meta event */}
        <div className="monarch-page-panel-section">
          <div className="monarch-page-panel-label">Intelligence Feeds</div>
          <div className="monarch-page-feed-list">
            <div className="monarch-page-feed-item">
              <span className={`monarch-page-pulse-dot ${feedDots.market ? 'monarch-page-pulse-dot-live' : 'monarch-page-pulse-dot-limited'}`} />
              <span className="monarch-page-feed-name">Market Data</span>
              <span className={`monarch-page-feed-status ${feedDots.market ? 'monarch-page-feed-live' : 'monarch-page-feed-limited'}`}>
                {lastSummary?.fearGreed ? (
                  <>F&amp;G: <span className="mono">{lastSummary.fearGreed.score}</span> · {lastSummary.fearGreed.label}</>
                ) : feedDots.market ? 'Live' : 'Idle'}
              </span>
            </div>
            <div className="monarch-page-feed-item">
              <span className={`monarch-page-pulse-dot ${feedDots.news ? 'monarch-page-pulse-dot-live' : 'monarch-page-pulse-dot-limited'}`} />
              <span className="monarch-page-feed-name">News Feed</span>
              <span className={`monarch-page-feed-status ${feedDots.news ? 'monarch-page-feed-live' : 'monarch-page-feed-limited'}`}>
                {feedDots.news && lastSummary?.newsCount > 0
                  ? `${lastSummary.newsCount} articles`
                  : feedDots.news ? 'Connected' : 'Idle'}
              </span>
            </div>
            <div className="monarch-page-feed-item">
              <span className={`monarch-page-pulse-dot ${feedDots.onchain ? 'monarch-page-pulse-dot-live' : 'monarch-page-pulse-dot-limited'}`} />
              <span className="monarch-page-feed-name">On-Chain</span>
              <span className={`monarch-page-feed-status ${feedDots.onchain ? 'monarch-page-feed-live' : 'monarch-page-feed-limited'}`}>
                {feedDots.onchain ? 'Active' : 'Idle'}
              </span>
            </div>
          </div>
        </div>

        {/* Links & Images Tabs */}
        <div className="monarch-page-panel-section">
          <div className="monarch-page-panel-label">Resources</div>
          <div className="monarch-page-tabs">
            <button
              className={`monarch-page-tab ${panelTab === 'links' ? 'monarch-page-tab-active' : ''}`}
              onClick={() => setPanelTab('links')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
              Links
              {links.length > 0 && <span className="monarch-page-tab-badge">{links.length}</span>}
            </button>
            <button
              className={`monarch-page-tab ${panelTab === 'images' ? 'monarch-page-tab-active' : ''}`}
              onClick={() => setPanelTab('images')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              Images
              {images.length > 0 && <span className="monarch-page-tab-badge">{images.length}</span>}
            </button>
          </div>

          {panelTab === 'links' && (
            <div className="monarch-page-tab-content">
              {links.length === 0 ? (
                <div className="monarch-page-tab-empty">No links found yet</div>
              ) : (
                links.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="monarch-page-link-item">
                    <span className="monarch-page-link-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <path d="M15 3h6v6" /><path d="M10 14L21 3" />
                      </svg>
                    </span>
                    <span className="monarch-page-link-text">{url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</span>
                  </a>
                ))
              )}
            </div>
          )}

          {panelTab === 'images' && (
            <div className="monarch-page-tab-content">
              {images.length === 0 ? (
                <div className="monarch-page-tab-empty">No images found yet</div>
              ) : (
                <div className="monarch-page-image-grid">
                  {images.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="monarch-page-image-thumb">
                      <img src={url} alt="" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Capabilities — clickable suggestion chips that send pre-written prompts */}
        <div className="monarch-page-panel-section">
          <div className="monarch-page-panel-label">Capabilities</div>
          <div className="monarch-page-capability-grid">
            <button
              type="button"
              className="monarch-page-capability-card"
              onClick={() => handleSuggestion(CAPABILITY_PROMPTS.charts)}
              disabled={isStreaming}
            >
              <PanelIcon type="chart" />
              <span>Charts & Visualization</span>
            </button>
            <button
              type="button"
              className="monarch-page-capability-card"
              onClick={() => handleSuggestion(CAPABILITY_PROMPTS.technical)}
              disabled={isStreaming}
            >
              <PanelIcon type="analysis" />
              <span>Technical Analysis</span>
            </button>
            <button
              type="button"
              className="monarch-page-capability-card"
              onClick={() => handleSuggestion(CAPABILITY_PROMPTS.trends)}
              disabled={isStreaming}
            >
              <PanelIcon type="trend" />
              <span>Market Trends</span>
            </button>
            <button
              type="button"
              className="monarch-page-capability-card"
              onClick={() => handleSuggestion(CAPABILITY_PROMPTS.compare)}
              disabled={isStreaming}
            >
              <PanelIcon type="compare" />
              <span>Token Comparison</span>
            </button>
            <button
              type="button"
              className="monarch-page-capability-card"
              onClick={() => handleSuggestion(CAPABILITY_PROMPTS.dashboard)}
              disabled={isStreaming}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
              <span>Dashboard Builder</span>
            </button>
            <button
              type="button"
              className="monarch-page-capability-card"
              onClick={() => handleSuggestion(CAPABILITY_PROMPTS.whale)}
              disabled={isStreaming}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M2 12c2-3 4-5 6-5s4 4 6 4 4-4 6-4" />
                <path d="M2 17c2-3 4-5 6-5s4 4 6 4 4-4 6-4" />
              </svg>
              <span>Whale Watch</span>
            </button>
          </div>
        </div>

        {/* Session */}
        <div className="monarch-page-panel-section">
          <div className="monarch-page-panel-label">Session</div>
          <div className="monarch-page-session-info">
            <div className="monarch-page-session-row">
              <span className="monarch-page-session-key">Messages</span>
              <span className="monarch-page-session-val mono">{messages.length}</span>
            </div>
            <div className="monarch-page-session-row">
              <span className="monarch-page-session-key">Context</span>
              <span className="monarch-page-session-val">{contextLabel}</span>
            </div>
            <div className="monarch-page-session-row">
              <span className="monarch-page-session-key">Endpoints hit</span>
              <span className="monarch-page-session-val mono">{sessionEndpoints?.size ?? 0}</span>
            </div>
            <div className="monarch-page-session-row">
              <span className="monarch-page-session-key">Data freshness</span>
              <span className={`monarch-page-session-val ${lastSummary?.hasStaleness ? 'monarch-page-session-val-warn' : 'monarch-page-session-val-live'}`}>
                {lastSummary?.hasStaleness ? 'Some stale' : 'Live'}
              </span>
            </div>
          </div>
          <button
            className="monarch-page-new-thread-btn"
            onClick={handleNewThread}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Thread
          </button>
        </div>
      </aside>

      {/* ── Clear Confirm Dialog ── */}
      {showClearConfirm && (
        <div className="monarch-page-clear-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="monarch-page-clear-dialog" onClick={e => e.stopPropagation()}>
            <div className="monarch-page-clear-dialog-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </div>
            <p className="monarch-page-clear-dialog-title">Clear conversation?</p>
            <p className="monarch-page-clear-dialog-desc">This will remove all messages in this thread. This action cannot be undone.</p>
            <div className="monarch-page-clear-actions">
              <button className="monarch-page-clear-cancel" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="monarch-page-clear-confirm" onClick={handleClear}>Clear All</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fullscreen Chart Overlay ── */}
      {fullscreenChart && (
        <div className="monarch-page-fullscreen-overlay" onClick={() => setFullscreenChart(null)}>
          <div className="monarch-page-fullscreen-chart" onClick={e => e.stopPropagation()}>
            <div className="monarch-page-fullscreen-header">
              <span className="monarch-page-fullscreen-title">{fullscreenChart.title || 'Chart'}</span>
              <button className="monarch-page-fullscreen-close" onClick={() => setFullscreenChart(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="monarch-page-fullscreen-body">
              <MonarchChart spec={fullscreenChart} />
            </div>
          </div>
        </div>
      )}

      {/* Close thread menu on click outside */}
      {threadMenuId && (
        <div className="monarch-page-menu-backdrop" onClick={() => setThreadMenuId(null)} />
      )}
    </div>
  )
}
