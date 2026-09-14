/**
 * MonarchMessageBubble — renders a single chat message.
 * User messages right-aligned, Monarch messages left-aligned.
 * Features: markdown, inline charts, thinking/scanning animation,
 * source indicators, delete on hover, timestamps, clickable tickers, URL links.
 */
import { useMemo, useState, memo, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { spectreIcons } from '@/icons/spectreIcons'
import MonarchChart from './monarch-chart'
// PR-2 (perf): the dashboard renderer pulls recharts - lazy so the chunk
// only downloads when a message actually carries a dashboard_spec.
import lazyWithRetry from '@/lib/lazy-with-retry'
import './monarch-mini-chat.css'

const MonarchDashboard = lazyWithRetry(() => import('./monarch-dashboard'))
// Rich data blocks — LLM emits directives, the client hydrates live numbers.
// Lazy so the block components (+ their data services) only load when a
// message actually carries one.
const MonarchTokenCard = lazyWithRetry(() => import('./monarch-token-card'))
const MonarchXDashTable = lazyWithRetry(() => import('./monarch-xdash-table'))
const MonarchBubbleMap = lazyWithRetry(() => import('./monarch-bubble-map'))

const DATA_BLOCK_RENDERERS = {
  token_card: MonarchTokenCard,
  xdash_table: MonarchXDashTable,
  bubble_map: MonarchBubbleMap,
}

// Known major crypto tickers — clicking these navigates to token page
const MAJOR_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'MATIC',
  'LINK', 'UNI', 'ATOM', 'LTC', 'NEAR', 'APT', 'ARB', 'OP', 'FIL', 'AAVE',
  'MKR', 'SNX', 'CRV', 'LDO', 'RUNE', 'INJ', 'SUI', 'SEI', 'TIA', 'JUP',
  'PEPE', 'SHIB', 'WIF', 'BONK', 'FET', 'RENDER', 'TAO', 'ONDO', 'WLD',
  'PENDLE', 'ENA', 'TON', 'TRX', 'HBAR', 'ICP', 'VET', 'FTM', 'ALGO',
  'MANA', 'SAND', 'AXS', 'IMX', 'GMT', 'FLOW', 'GALA', 'ENJ', 'RPL',
])

const THINKING_PHRASES = [
  'Analyzing markets',
  'Scanning data',
  'Processing',
  'Gathering intelligence',
  'Crunching numbers',
]

function renderMarkdown(text, onTickerClick) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let listItems = []
  let tableRows = []
  let tableAligns = null

  const flushList = () => {
    if (listItems.length) {
      elements.push(<ul key={`ul-${elements.length}`} className="monarch-msg-list">{listItems}</ul>)
      listItems = []
    }
  }

  const flushTable = () => {
    if (tableRows.length < 1) { tableRows = []; tableAligns = null; return }
    const headerRow = tableRows[0]
    const bodyRows = tableRows.slice(1)
    elements.push(
      <div key={`tbl-${elements.length}`} className="monarch-msg-table-wrap">
        <table className="monarch-msg-table">
          <thead>
            <tr>{headerRow.map((cell, ci) => <th key={`th-${ci}-${cell.trim().slice(0, 12)}`}>{processInline(cell.trim(), onTickerClick)}</th>)}</tr>
          </thead>
          {bodyRows.length > 0 && (
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={`row-${ri}`}>{row.map((cell, ci) => <td key={`td-${ri}-${ci}`}>{processInline(cell.trim(), onTickerClick)}</td>)}</tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    )
    tableRows = []
    tableAligns = null
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()

    // Table row detection (| col1 | col2 |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList()
      const cells = trimmed.slice(1, -1).split('|')
      // Skip separator rows (|---|---|)
      if (cells.every(c => /^[\s:-]+$/.test(c))) {
        tableAligns = cells // store alignment info but don't render
        return
      }
      tableRows.push(cells)
      return
    }

    // If we were building a table and hit a non-table line, flush it
    if (tableRows.length > 0) {
      flushTable()
    }

    // Headers
    if (/^###\s/.test(trimmed)) {
      flushList()
      elements.push(<h4 key={`h3-${i}`} className="monarch-msg-h3">{processInline(trimmed.slice(4), onTickerClick)}</h4>)
      return
    }
    if (/^##\s/.test(trimmed)) {
      flushList()
      elements.push(<h3 key={`h2-${i}`} className="monarch-msg-h2">{processInline(trimmed.slice(3), onTickerClick)}</h3>)
      return
    }

    if (/^[-*]\s/.test(trimmed)) {
      listItems.push(<li key={`li-${i}`}>{processInline(trimmed.slice(2), onTickerClick)}</li>)
      return
    }
    if (/^\d+\.\s/.test(trimmed)) {
      listItems.push(<li key={`ol-${i}`}>{processInline(trimmed.replace(/^\d+\.\s/, ''), onTickerClick)}</li>)
      return
    }
    flushList()
    if (!trimmed) {
      elements.push(<br key={`br-${i}`} />)
    } else {
      elements.push(<p key={`p-${i}`} className="monarch-msg-p">{processInline(trimmed, onTickerClick)}</p>)
    }
  })
  flushList()
  flushTable()
  return elements
}

/* ── Inline token patterns ──
 * Order matters: more specific patterns must come before generic ones.
 *   bold        **text**
 *   code        `text`
 *   italic      *text*  (must come after bold)
 *   url         https://...
 *   ticker      $BTC
 *   percent     +12.34% / -5.5% / 0.01% (signed → bull/bear color, unsigned → mono only)
 *   money       $71,792 / $2.19 / $1.4B / $72K (dollar amounts — mono, no semantic color)
 *
 * Ticker must come before percent/money since both start with $. We use a
 * lookahead on $[A-Z] to disambiguate: $BTC matches ticker, $71 matches money.
 */
const INLINE_SPLIT_REGEX = new RegExp(
  [
    '(\\*\\*[^*]+\\*\\*)',                          // **bold**
    '(`[^`]+`)',                                     // `code`
    '(\\*[^*]+\\*)',                                 // *italic*
    '(https?:\\/\\/[^\\s)]+)',                       // URL
    '(\\$[A-Z]{2,10}\\b)',                           // $TICKER
    '([+-]?\\d+(?:\\.\\d+)?%)',                      // percentage (signed or unsigned)
    '(\\$\\d[\\d,]*(?:\\.\\d+)?[KMBTkmbt]?\\b)',    // $amount: $71,792, $2.19, $1.4B, $72K
  ].join('|'),
  'g'
)

function processInline(text, onTickerClick) {
  const parts = text.split(INLINE_SPLIT_REGEX).filter(p => p != null)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`b-${i}`}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`c-${i}`} className="monarch-msg-code">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2 && !/^\*\s/.test(part)) {
      return <em key={`em-${i}`}>{part.slice(1, -1)}</em>
    }
    // URLs → clickable links with icon
    if (/^https?:\/\//.test(part)) {
      const displayUrl = part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 45)
      return (
        <a key={`link-${i}`} href={part} target="_blank" rel="noopener noreferrer" className="monarch-msg-link">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="11" height="11" className="monarch-msg-link-icon">
            <path d="M6 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" />
            <path d="M10 7.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" />
          </svg>
          {displayUrl}
        </a>
      )
    }
    // $TICKER (before $money because both start with $)
    if (/^\$[A-Z]{2,10}$/.test(part)) {
      const symbol = part.slice(1)
      if (MAJOR_TICKERS.has(symbol) && onTickerClick) {
        return (
          <span key={`ticker-${symbol}-${i}`} className="monarch-msg-ticker" onClick={() => onTickerClick(symbol)} title={`View ${symbol}`}>
            {part}
          </span>
        )
      }
      // Unknown ticker → still mono styled, non-clickable
      return <span key={`tickr-${i}`} className="monarch-msg-num">{part}</span>
    }
    // Percentage — signed drives semantic color; unsigned is neutral mono
    if (/^[+-]?\d+(\.\d+)?%$/.test(part)) {
      const cls = part.startsWith('+') ? 'monarch-msg-num monarch-msg-pos'
                : part.startsWith('-') ? 'monarch-msg-num monarch-msg-neg'
                : 'monarch-msg-num'
      return <span key={`pct-${i}`} className={cls}>{part}</span>
    }
    // Dollar amount — mono, neutral (prices aren't inherently bull or bear)
    if (/^\$\d/.test(part)) {
      return <span key={`usd-${i}`} className="monarch-msg-num">{part}</span>
    }
    return part
  })
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/* ── Pretty-print an endpoint key for the source footer ──
 * 'fear_greed' → 'fear-greed'
 * 'price_BTC' → 'prices/BTC'
 * 'technicals_ETH' → 'technicals/ETH'
 * 'whale_transactions' → 'smart-money/whales'
 * 'movers_gainers' → 'movers/gainers'
 */
function prettyEndpoint(key) {
  if (!key) return ''
  if (key === 'fear_greed') return 'fear-greed'
  if (key === 'whale_transactions') return 'smart-money/whales'
  if (key === 'defi_protocols') return 'defi/protocols'
  if (key.startsWith('price_')) return `prices/${key.slice(6)}`
  if (key.startsWith('technicals_')) return `technicals/${key.slice(11)}`
  if (key.startsWith('derivatives_')) return `derivatives/${key.slice(12)}`
  if (key.startsWith('holders_')) return `onchain/${key.slice(8)}/holders`
  if (key.startsWith('movers_')) return `movers/${key.slice(7)}`
  return key.replace(/_/g, '-')
}

function MonarchMessageBubble({ message, onDelete, onFullscreenChart }) {
  const { role, content, streaming, error, toolActive, chart, charts, chartLoading, dashboard, dashboardLoading, blocks, blocksLoading, timestamp, id, endpoints } = message
  const allCharts = charts && charts.length > 0 ? charts : chart ? [chart] : []
  const isUser = role === 'user'
  const [hovered, setHovered] = useState(false)
  const navigate = useNavigate()

  // Navigate to token page when a ticker like $BTC is clicked
  const handleTickerClick = useMemo(() => (symbol) => {
    navigate(`/token?symbol=${symbol}`)
  }, [navigate])

  const rendered = useMemo(() => {
    if (!content) return null
    return renderMarkdown(content, handleTickerClick)
  }, [content, handleTickerClick])

  // Pick a random-ish thinking phrase based on message id
  const thinkingPhrase = useMemo(() => {
    if (!id) return THINKING_PHRASES[0]
    const idx = id.charCodeAt(id.length - 1) % THINKING_PHRASES.length
    return THINKING_PHRASES[idx]
  }, [id])

  // Determine if this is the "thinking" state (streaming, no content yet, no tool active)
  const isThinking = streaming && !content && !toolActive

  // Source scanning state (tool active)
  const isScanning = !!toolActive

  return (
    <div
      className={`monarch-bubble ${isUser ? 'monarch-bubble-user' : 'monarch-bubble-ai'} ${error ? 'monarch-bubble-error' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* AI avatar */}
      {!isUser && (
        <div className="monarch-bubble-avatar">
          <div className={`monarch-avatar-ring ${streaming ? 'monarch-avatar-ring-active' : ''}`}>
            {spectreIcons.monarch}
          </div>
        </div>
      )}

      <div className="monarch-bubble-body">
        <div className="monarch-bubble-content">
          {/* Thinking animation — Perplexity/Claude style */}
          {isThinking && (
            <div className="monarch-thinking">
              <div className="monarch-thinking-dots">
                <span className="monarch-thinking-dot" />
                <span className="monarch-thinking-dot" />
                <span className="monarch-thinking-dot" />
              </div>
              <span className="monarch-thinking-label">{thinkingPhrase}</span>
            </div>
          )}

          {/* Source scanning indicator */}
          {isScanning && (
            <div className="monarch-scanning">
              <div className="monarch-scanning-bar">
                <div className="monarch-scanning-fill" />
              </div>
              <div className="monarch-scanning-info">
                <span className="monarch-scanning-icon">
                  <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="monarch-scanning-text">
                  {toolActive === 'web_search' ? 'Searching sources' : 'Analyzing data'}
                </span>
                <span className="monarch-scanning-shimmer" />
              </div>
            </div>
          )}

          {/* Message content */}
          {rendered}

          {/* Rich data blocks — token cards / X-Dash tables / bubble maps.
           * Directives come from the model; every number hydrates live. */}
          {Array.isArray(blocks) && blocks.map((block, bi) => {
            const Renderer = DATA_BLOCK_RENDERERS[block.kind]
            if (!Renderer) return null
            return (
              <Suspense key={`blk-${block.kind}-${block.spec?.symbol || bi}`} fallback={null}>
                <Renderer spec={block.spec} />
              </Suspense>
            )
          })}

          {/* Data-block loading skeleton — a fence is still streaming in */}
          {blocksLoading && (
            <div className="monarch-chart-loading">
              <div className="monarch-chart-loading-inner">
                <div className="monarch-chart-loading-header">
                  <div className="monarch-chart-loading-bar monarch-chart-loading-bar-short" />
                  <div className="monarch-chart-loading-dots">
                    <span /><span /><span />
                  </div>
                </div>
                <div className="monarch-chart-loading-stats">
                  <div className="monarch-chart-loading-stat" />
                  <div className="monarch-chart-loading-stat" />
                  <div className="monarch-chart-loading-stat" />
                </div>
                <div className="monarch-chart-loading-label">Pulling live data...</div>
              </div>
            </div>
          )}

          {/* Dashboard — rendered below text, above charts, full width of bubble */}
          {dashboard && (
            <Suspense fallback={null}>
              <MonarchDashboard spec={dashboard} />
            </Suspense>
          )}

          {/* Dashboard loading skeleton — shown while dashboard_spec is still streaming in */}
          {dashboardLoading && !dashboard && (
            <div className="monarch-chart-loading">
              <div className="monarch-chart-loading-inner">
                <div className="monarch-chart-loading-header">
                  <div className="monarch-chart-loading-bar monarch-chart-loading-bar-short" />
                  <div className="monarch-chart-loading-dots">
                    <span /><span /><span />
                  </div>
                </div>
                <div className="monarch-chart-loading-stats">
                  <div className="monarch-chart-loading-stat" />
                  <div className="monarch-chart-loading-stat" />
                  <div className="monarch-chart-loading-stat" />
                  <div className="monarch-chart-loading-stat" />
                </div>
                <div className="monarch-chart-loading-label">Building dashboard...</div>
              </div>
            </div>
          )}

          {/* Charts with fullscreen button */}
          {allCharts.map((chartSpec, ci) => (
            <div key={`chart-${chartSpec?.title || chartSpec?.symbol || ci}`} className="monarch-chart-wrap">
              <MonarchChart spec={chartSpec} onExpand={onFullscreenChart} />
            </div>
          ))}

          {/* Chart loading skeleton — shown while chart_spec is still streaming in */}
          {chartLoading && (
            <div className="monarch-chart-loading">
              <div className="monarch-chart-loading-inner">
                <div className="monarch-chart-loading-header">
                  <div className="monarch-chart-loading-bar monarch-chart-loading-bar-short" />
                  <div className="monarch-chart-loading-dots">
                    <span /><span /><span />
                  </div>
                </div>
                <div className="monarch-chart-loading-stats">
                  <div className="monarch-chart-loading-stat" />
                  <div className="monarch-chart-loading-stat" />
                  <div className="monarch-chart-loading-stat" />
                </div>
                <div className="monarch-chart-loading-canvas">
                  <svg viewBox="0 0 400 120" fill="none" className="monarch-chart-loading-wave">
                    <path d="M0 80 Q50 20, 100 60 T200 50 T300 70 T400 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="monarch-chart-loading-label">Generating chart...</div>
              </div>
            </div>
          )}

          {/* Streaming cursor */}
          {streaming && content && (
            <span className="monarch-bubble-cursor" />
          )}

          {/* Sources footer — Perplexity-style trust signal showing which Spectre
           * endpoints this answer was grounded in. Hidden on user messages, on
           * empty-endpoint answers, and while still streaming. */}
          {!isUser && !streaming && Array.isArray(endpoints) && endpoints.length > 0 && (
            <div className="monarch-sources-footer">
              <span className="monarch-sources-label">Sources</span>
              <span className="monarch-sources-sep">·</span>
              {endpoints.map((ep, i) => (
                <span key={ep} className="monarch-sources-item">
                  {i > 0 && <span className="monarch-sources-dot">·</span>}
                  <span className="monarch-sources-endpoint">{prettyEndpoint(ep)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Timestamp + actions row */}
        <div className={`monarch-bubble-meta ${hovered ? 'monarch-bubble-meta-visible' : ''}`}>
          {timestamp && (
            <span className="monarch-bubble-time">{formatTime(timestamp)}</span>
          )}
          {onDelete && hovered && !streaming && (
            <button
              className="monarch-bubble-delete"
              onClick={() => onDelete(id)}
              title="Delete message"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="12" height="12">
                <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// memo: setMessages returns referentially-stable objects for unchanged messages,
// so during streaming only the growing message re-renders instead of all N bubbles.
export default memo(MonarchMessageBubble)
