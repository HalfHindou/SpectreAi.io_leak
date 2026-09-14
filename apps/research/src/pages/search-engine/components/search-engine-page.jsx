/**
 * Spectre Search - Perplexity Sonar Pro powered research engine.
 * Institutional-grade query classification + AI research + live data enrichment.
 *
 * Not a chatbot. A financial intelligence search engine.
 * Design: 4K Apple editorial - Playfair Display + accent dot.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import spectreIcons from '@/icons/spectreIcons'
import SpectreSparkline from '@/chart/SpectreSparkline'
import { useCuratedTokenPrices } from '@/hooks/useCodexData'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { getSpectreMarketTrending } from '@/services/spectreMarketApi'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { useTimeAgo } from '@/lib/timeAgo'
import { useSearchStream } from './use-search-stream'
import ChartInline from './chart-inline'
import MonarchChart from '@/components/monarch/monarch-chart'
import CitationsBar from '@/pages/search-engine-v2/components/citations-bar'
import ImageHeroStrip from './image-hero-strip'
import './search-engine-page.css'
import './search-engine-page.mobile.css'

/* ── Focus tabs ── */
const FOCUS_TABS = [
  { id: 'all', label: 'All', icon: 'discover' },
  { id: 'tokens', label: 'Tokens', icon: 'tokenTab' },
  { id: 'wallets', label: 'Wallets', icon: 'portfolio' },
  { id: 'defi', label: 'DeFi', icon: 'whale' },
  { id: 'nfts', label: 'NFTs', icon: 'image' },
  { id: 'news', label: 'News', icon: 'news' },
]

/* ── Ticker tape symbols ── */
const TICKER_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT']

function isLocalViteDev() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

const FALLBACK_TRENDING_CARDS = [
  { title: 'Top gainers last 24h', category: 'MARKETS', icon: 'fire', query: 'Top gaining crypto tokens in the last 24 hours' },
  { title: 'Whale wallet movements', category: 'ON-CHAIN', icon: 'whale', query: 'Largest crypto whale wallet movements today' },
  { title: 'New Solana token launches', category: 'DISCOVERY', icon: 'listing', query: 'New Solana tokens launched in the last 48 hours' },
  { title: 'ETH gas tracker', category: 'TOOLS', icon: 'volume', query: 'Current Ethereum gas prices and network congestion' },
  { title: 'Undervalued DeFi gems', category: 'ALPHA', icon: 'sparkles', query: 'Undervalued DeFi protocols with growing TVL' },
  { title: 'Institutional flows today', category: 'SMART MONEY', icon: 'bank', query: 'Institutional crypto fund flows and BTC ETF inflows today' },
]

function normalizeTrendingCard(entry, index) {
  const item = entry?.item || entry || {}
  const name = item.name || item.title || item.symbol || ''
  const symbol = String(item.symbol || '').toUpperCase()
  if (!name && !symbol) return null
  const change = Number(item.data?.price_change_percentage_24h?.usd ?? item.change_24h ?? item.change)
  const changeLabel = Number.isFinite(change) ? ` (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)` : ''
  return {
    title: `${symbol ? `$${symbol}` : name} trending${changeLabel}`,
    category: 'LIVE MARKET',
    icon: index === 0 ? 'fire' : 'sparkles',
    query: `Research ${name || symbol} token momentum, price action, social proof, and key risks today`,
  }
}

/* ── Layout config per classification ── */
const getLayoutConfig = (classification) => {
  switch (classification) {
    case 'TOKEN_RESEARCH':
    case 'STOCK_RESEARCH':
      return { showSidebar: true, showChart: true, fullWidth: false }
    case 'COMPARISON':
      return { showSidebar: true, showChart: false, fullWidth: false }
    case 'THESIS_RESEARCH':
    case 'MARKET_MACRO':
    case 'MEME_ALPHA':
    case 'DEFI_RESEARCH':
    case 'NEWS_EVENT':
    case 'ONCHAIN':
      return { showSidebar: true, showChart: false, fullWidth: false }
    case 'GENERAL':
    default:
      return { showSidebar: false, showChart: false, fullWidth: true }
  }
}

/* ── Parse research content into sections for two-column layout ── */
const parseResearchSections = (content) => {
  if (!content) return { thesis: '', verdict: '', analysisContent: '', thesisAtGlance: '', raw: content || '' }
  const lines = content.split('\n')
  let thesis = ''
  let verdict = ''
  let thesisAtGlance = ''
  const analysisLines = []
  let currentSection = null
  let sectionBuffer = []

  const flushSection = () => {
    if (currentSection === 'THESIS') thesis = sectionBuffer.join('\n').trim()
    else if (currentSection === 'VERDICT') verdict = sectionBuffer.join('\n').trim()
    else if (sectionBuffer.length > 0) analysisLines.push(...(currentSection ? [`**${currentSection}**`, ...sectionBuffer] : sectionBuffer))
    sectionBuffer = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Extract > **THESIS AT A GLANCE:** blockquote
    if (line.trim().startsWith('> **THESIS AT A GLANCE:**') || line.trim().startsWith('>**THESIS AT A GLANCE:**')) {
      let calloutText = line.replace(/^>\s*/, '').replace(/^\*\*THESIS AT A GLANCE:\*\*\s*/, '')
      // Collect continuation lines
      while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].startsWith('#') && !lines[i + 1].startsWith('**') && !lines[i + 1].startsWith('> ') && !lines[i + 1].startsWith('|') && !lines[i + 1].startsWith('- ')) {
        i++
        calloutText += ' ' + lines[i].replace(/^>\s*/, '').trim()
      }
      thesisAtGlance = calloutText.trim()
      // Don't add to analysisLines - render separately
      continue
    }

    const headerMatch = line.match(/^\*\*([A-Z][A-Z\s&:,()\/\-]+)\*\*$/)
    if (headerMatch) {
      flushSection()
      currentSection = headerMatch[1].trim()
    } else {
      sectionBuffer.push(line)
    }
  }
  flushSection()

  return {
    thesis,
    verdict,
    thesisAtGlance,
    analysisContent: analysisLines.join('\n'),
    raw: content,
  }
}

/* ── Classification badge colors ── */
/* Warm-white pill chrome - per design-system.md (zero colored accents in UI chrome).
   Only the label distinguishes classifications; the visual treatment stays neutral. */
const CLASS_PILL = { bg: 'rgba(245,245,247,0.08)', color: '#f5f5f7' }
const CLASS_COLORS = {
  TOKEN_RESEARCH: { ...CLASS_PILL, label: 'TOKEN RESEARCH' },
  STOCK_RESEARCH: { ...CLASS_PILL, label: 'STOCK RESEARCH' },
  COMPARISON: { ...CLASS_PILL, label: 'COMPARISON' },
  MARKET_MACRO: { ...CLASS_PILL, label: 'MARKET MACRO' },
  MEME_ALPHA: { ...CLASS_PILL, label: 'MEME ALPHA' },
  DEFI_RESEARCH: { ...CLASS_PILL, label: 'DEFI RESEARCH' },
  NEWS_EVENT: { ...CLASS_PILL, label: 'NEWS EVENT' },
  WALLET_EVM: { ...CLASS_PILL, label: 'WALLET ANALYSIS' },
  WALLET_SOLANA: { ...CLASS_PILL, label: 'WALLET ANALYSIS' },
  THESIS_RESEARCH: { ...CLASS_PILL, label: 'THESIS RESEARCH' },
  ONCHAIN: { ...CLASS_PILL, label: 'ON-CHAIN DATA' },
  GENERAL: { ...CLASS_PILL, label: 'RESEARCH' },
}

/* ── Time-based greeting ── */
const getGreeting = (t) => {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return t('searchEngine.greeting.morning', 'Good Morning')
  if (h >= 12 && h < 17) return t('searchEngine.greeting.afternoon', 'Good Afternoon')
  if (h >= 17 && h < 22) return t('searchEngine.greeting.evening', 'Good Evening')
  return t('searchEngine.greeting.night', 'Good Night')
}

/* ── Recent searches (localStorage) ── */
const getRecent = () => {
  try { return JSON.parse(localStorage.getItem('spectre-search-history') || '[]').slice(0, 6) }
  catch { return [] }
}
const saveRecent = (q) => {
  try {
    const list = getRecent().filter(s => s !== q)
    localStorage.setItem('spectre-search-history', JSON.stringify([q, ...list].slice(0, 12)))
  } catch { /* noop */ }
}

export default function SearchEnginePage() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { fmtPrice, fmtLarge, fmtLargeShort } = useCurrency()
  const fmtAgo = useTimeAgo()

  /* ── State ── */
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState('all')
  const [searchMode, setSearchMode] = useState('quick') // 'quick' | 'deep'
  const [view, setView] = useState('home') // home | loading | results
  const [result, setResult] = useState(null) // full API response
  const [error, setError] = useState(null)
  const [disambiguation, setDisambiguation] = useState(null) // null or { options }
  const [recentSearches, setRecentSearches] = useState(getRecent)
  const [trending, setTrending] = useState([])
  const [inputHint, setInputHint] = useState(null)
  const [resultTab, setResultTab] = useState('analysis')
  const inputRef = useRef(null)
  const resultsTopRef = useRef(null)
  const abortRef = useRef(null)

  /* ── SSE search stream (new Spectre Search v2 pipeline) ── */
  const stream = useSearchStream()

  /* ── Live ticker prices ── */
  const { prices: tickerPrices } = useCuratedTokenPrices(TICKER_SYMBOLS, 30000)

  /* ── Detect day mode for chart theme ── */
  const [isDayMode, setIsDayMode] = useState(false)
  useEffect(() => {
    const check = () => setIsDayMode(!!document.querySelector('.app-day-mode'))
    check()
    const observer = new MutationObserver(check)
    const target = document.querySelector('.app')
    if (target) observer.observe(target, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  /* ── Fetch trending on mount ── */
  useEffect(() => {
    let cancelled = false

    const loadTrending = async () => {
      try {
        const live = await getSpectreMarketTrending(6)
        const cards = live.map(normalizeTrendingCard).filter(Boolean)
        if (cards.length > 0) {
          if (!cancelled) setTrending(cards)
          return
        }
      } catch {
        // Fall through to the legacy search-card endpoint.
      }

      if (isLocalViteDev()) {
        if (!cancelled) setTrending(FALLBACK_TRENDING_CARDS)
        return
      }

      try {
        const res = await fetch('/api/search/trending')
        if (!res.ok) throw new Error(`Search trending ${res.status}`)
        const data = await res.json()
        const cards = data.cards || data.trending || (Array.isArray(data) ? data : [])
        if (!cancelled) setTrending(cards.length ? cards : FALLBACK_TRENDING_CARDS)
      } catch {
        if (!cancelled) setTrending(FALLBACK_TRENDING_CARDS)
      }
    }

    loadTrending()
    return () => { cancelled = true }
  }, [])

  /* ── Permalink: auto-run search from URL ?q= on mount ── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlQuery = params.get('q')
    const urlMode = params.get('mode') || 'quick'
    if (urlQuery) {
      setQuery(urlQuery)
      setSearchMode(urlMode === 'thesis' ? 'deep' : 'quick')
      handleSearch(urlQuery, null, urlMode === 'thesis' ? 'deep' : 'quick')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Focus input on mount ── */
  useEffect(() => {
    if (view === 'home') setTimeout(() => inputRef.current?.focus(), 200)
  }, [view])

  /* ── Input hint detection ── */
  useEffect(() => {
    if (/^0x[a-fA-F0-9]*$/.test(query)) setInputHint(t('searchEngine.hint.address', 'Detecting wallet or contract address...'))
    else if (/^\$[A-Z]{1,6}$/i.test(query)) setInputHint(t('searchEngine.hint.lookup', 'Looking up {{symbol}}...', { symbol: query.toUpperCase() }))
    else if (/vs|compare/i.test(query) && query.length > 6) setInputHint(t('searchEngine.hint.compare', 'Comparison mode'))
    else setInputHint(null)
  }, [query, t])

  /* ── Perform search (SSE stream — data-first, then LLM text) ── */
  const handleSearch = useCallback(async (searchQuery, focusOverride, modeOverride) => {
    const q = (searchQuery || query).trim()
    if (!q) return
    const f = focusOverride || focus
    const m = modeOverride || searchMode

    setView('results')
    setError(null)
    setResult(null)
    setDisambiguation(null)
    saveRecent(q)
    setRecentSearches(getRecent())

    // Update URL for permalink support (replaceState so back button works)
    const urlParams = new URLSearchParams({ q, mode: m === 'deep' ? 'thesis' : 'quick' })
    if (f !== 'all') urlParams.set('focus', f)
    window.history.replaceState(null, '', `${window.location.pathname}?${urlParams}`)

    // Fire the SSE stream — data slots arrive first (knowledge panel paints),
    // then LLM text streams in (answer writes itself). The hook manages all
    // state internally; the UI renders from stream.slots / stream.text / etc.
    stream.run(q, { mode: m, focus: f })

    setTimeout(() => resultsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }, [query, focus, searchMode, stream.run])

  /* ── Keyboard ── */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch() }
  }

  /* ── Reset ── */
  const handleNewSearch = () => {
    setView('home')
    setQuery('')
    setResult(null)
    setError(null)
    setDisambiguation(null)
    setSearchMode('quick')
  }

  /* ── Go deeper: switch to deep thesis mode and re-search ── */
  const handleGoDeeper = () => {
    const q = result?.query || query
    if (!q) return
    setSearchMode('deep')
    handleSearch(q, null, 'deep')
  }

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e) => {
      // / — focus search bar (when not already typing)
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      // Cmd+Enter / Ctrl+Enter — run Deep Thesis
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && query.trim()) {
        e.preventDefault()
        setSearchMode('deep')
        handleSearch(query, null, 'deep')
      }
      // Escape — back to landing
      if (e.key === 'Escape' && view === 'results') {
        handleNewSearch()
        window.history.replaceState(null, '', window.location.pathname)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [query, view, handleSearch])

  /* ── Enriched tokens (needed by table renderer) ── */
  const enrichedTokens = result?.enrichment?.tokens || []
  const isComparison = result?.classification === 'COMPARISON'

  /* ── Sparkline from 7d price data ── */
  const renderSparkline = (priceData, isUp) => {
    if (!priceData || priceData.length < 2) return null
    return <SpectreSparkline data={priceData} width={200} height={48} color={isUp ? '#10B981' : '#EF4444'} filled className="se-sparkline-svg" />
  }

  /* ── Render markdown (enhanced with table support) ── */
  const renderMarkdown = (text) => {
    if (!text) return null
    const lines = text.split('\n')
    const elements = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      /* ── Detect markdown tables: | col | col | ── */
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines = []
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i])
          i++
        }
        if (tableLines.length >= 2) {
          elements.push(renderTable(tableLines, elements.length))
          continue
        }
        // Not a valid table, render lines normally
        tableLines.forEach((tl, ti) => {
          elements.push(<p key={`${elements.length}-${ti}`} className="se-md-p">{renderInline(tl)}</p>)
        })
        continue
      }

      if (line.startsWith('### ')) { elements.push(<h3 key={`h3-${i}`} className="se-md-h3">{line.slice(4)}</h3>); i++; continue }
      if (line.startsWith('## ')) { elements.push(<h2 key={`h2-${i}`} className="se-md-h2">{line.slice(3)}</h2>); i++; continue }
      if (line.startsWith('# ')) { elements.push(<h1 key={`h1-${i}`} className="se-md-h1">{line.slice(2)}</h1>); i++; continue }
      const boldHeaderMatch = line.match(/^\*\*([A-Z][A-Z\s&:,()\/\-]+)\*\*$/)
      if (boldHeaderMatch) { elements.push(<h2 key={`bh-${i}`} className="se-md-h2">{boldHeaderMatch[1]}</h2>); i++; continue }
      const boldSubMatch = line.match(/^\*\*([^*]+[:])\*\*\s*$/)
      if (boldSubMatch) { elements.push(<h3 key={`bs-${i}`} className="se-md-h3">{boldSubMatch[1]}</h3>); i++; continue }
      if (line.startsWith('- ')) { elements.push(<li key={`li-${i}`} className="se-md-li">{renderInline(line.slice(2))}</li>); i++; continue }
      if (line.startsWith('> ')) { elements.push(<blockquote key={`bq-${i}`} className="se-md-quote">{renderInline(line.slice(2))}</blockquote>); i++; continue }
      if (line.trim() === '') { elements.push(<br key={`br-${i}`} />); i++; continue }
      elements.push(<p key={`p-${i}`} className="se-md-p">{renderInline(line)}</p>)
      i++
    }
    return elements
  }

  /* ── Render markdown table ── */
  const renderTable = (tableLines, keyBase) => {
    const parseRow = (line) => line.split('|').slice(1, -1).map(cell => cell.trim())
    const headers = parseRow(tableLines[0])
    // Skip separator line (|---|---|)
    const startRow = tableLines[1]?.match(/^\|[\s\-:|]+\|$/) ? 2 : 1
    const rows = tableLines.slice(startRow).map(parseRow)

    return (
      <div key={`table-${keyBase}`} className="se-table-wrap">
        <table className="se-table">
          <thead>
            <tr>{headers.map((h, hi) => <th key={`th-${keyBase}-${hi}-${h.slice(0, 12)}`}>{renderInline(h)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={`tr-${keyBase}-${ri}`}>
                {row.map((cell, ci) => {
                  /* Check if cell is a known ticker - make it linkable */
                  const tickerMatch = cell.match(/^([A-Z]{2,6})$/)
                  const enrichedToken = tickerMatch && enrichedTokens.find(t => t.symbol === tickerMatch[1])
                  return (
                    <td key={`td-${keyBase}-${ri}-${ci}`}>
                      {enrichedToken ? (
                        <span className="se-table-token" onClick={() => navigate(`/research-zone/${getTokenSlug(enrichedToken.symbol)}`)}>
                          {enrichedToken.logo && <img src={enrichedToken.logo} alt="" className="se-table-token-logo" />}
                          <span className="se-table-token-sym">{enrichedToken.symbol}</span>
                        </span>
                      ) : renderInline(cell)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // NUMBER FORMATTER — Llama 3.3 ignores prompt rules and still wraps every
  // number in backticks like `78352.41`, plus emits long floats like
  // `2.3049482477786514%`. We fix it at the render layer:
  //   1. Detect backticks wrapping a numeric value → render as **bold**.
  //   2. Format the number cleanly (commas for thousands, 2dp for %).
  //   3. Keep `code` style for genuine code identifiers (anything non-numeric).
  const NUMERIC_BACKTICK_RE = /^-?\$?\d[\d,]*(\.\d+)?%?$/
  const formatNumericString = (raw) => {
    // raw is the inside of backticks, e.g. "78352.41" or "2.30%" or "$1.5T"
    // Detect explicit % suffix → format pct
    if (/^-?\d+(\.\d+)?%$/.test(raw)) {
      const n = parseFloat(raw)
      const sign = n > 0 ? '+' : ''
      return `${sign}${n.toFixed(2)}%`
    }
    // Long float (>= 1e9): use thousands separators
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      const n = parseFloat(raw)
      if (Math.abs(n) >= 1e9) {
        // Render as $X.XT / $X.XXB
        const abs = Math.abs(n); const s = n < 0 ? '-' : ''
        if (abs >= 1e12) return `${s}$${(abs / 1e12).toFixed(2)}T`
        if (abs >= 1e9) return `${s}$${(abs / 1e9).toFixed(2)}B`
      }
      if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      return n.toFixed(4)
    }
    return raw
  }

  const renderInline = (text) => {
    if (!text) return text
    // Llama 3.3 over-cites: it puts [N] after every numeric value, creating
    // visual noise like "RSI is 54.79 [2], MACD is bearish [2]". Strip them
    // from mid-sentence positions (after numbers, before commas/periods) and
    // collapse consecutive runs. The citation cards section remains the
    // authoritative source list.
    let deduped = text
      // Collapse runs like "[1][2][3]" or "[1] [2]" → "[1]"
      .replace(/(?:\[\d+\][\s]*){2,}/g, (m) => m.match(/\[\d+\]/)[0] + ' ')
      // Drop citation chips that sit mid-sentence right after numeric values
      .replace(/(\d|%|\$|`)\s*\[\d+\]\s*([,.;:])/g, '$1$2')
      // Drop citation chips immediately after closing backticks of numeric values
      .replace(/(`[\d.,%$-]+`)\s*\[\d+\]/g, '$1')
    // Keep only the FIRST citation in the line/paragraph — one is enough as
    // an evidence pointer; readers can scroll to citation cards for the rest.
    let seenCitation = false
    deduped = deduped.replace(/\[\d+\]/g, (m) => {
      if (seenCitation) return ''
      seenCitation = true
      return m
    })
    // Split on: **bold**, `code`, [text](url) links, AND [N] citation markers
    const parts = deduped.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\[\d+\])/g)
    return parts.map((part, i) => {
      if (!part) return null
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={`b-${i}`}>{part.slice(2, -2)}</strong>
      if (part.startsWith('`') && part.endsWith('`')) {
        const inner = part.slice(1, -1)
        // Numeric content → render as bold (not gray code box)
        if (NUMERIC_BACKTICK_RE.test(inner)) {
          return <strong key={`n-${i}`} className="se-md-num">{formatNumericString(inner)}</strong>
        }
        // Actual code identifier → keep the (now subtle) code style
        return <code key={`c-${i}`} className="se-md-code">{inner}</code>
      }
      // Citation chip [N] — render as clickable chip that scrolls to the source
      const citMatch = part.match(/^\[(\d+)\]$/)
      if (citMatch) {
        return <span key={`cit-${i}`} className="se-citation-chip" title={stream.citations[parseInt(citMatch[1], 10) - 1]?.label || ''}>{part}</span>
      }
      // Inline link [text](url)
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        return <a key={`link-${i}`} href={linkMatch[2]} className="se-inline-link" target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>
      }
      return part
    })
  }

  /* ── Compute market stats from ticker data ── */
  const btcPrice = tickerPrices?.BTC?.price || 0
  const ethPrice = tickerPrices?.ETH?.price || 0
  const solPrice = tickerPrices?.SOL?.price || 0

  const marketStats = [
    {
      label: 'BTC',
      value: btcPrice ? fmtPrice(btcPrice) : '-',
      change: tickerPrices?.BTC?.change24 || tickerPrices?.BTC?.change || 0,
    },
    {
      label: 'ETH',
      value: ethPrice ? fmtPrice(ethPrice) : '-',
      change: tickerPrices?.ETH?.change24 || tickerPrices?.ETH?.change || 0,
    },
    {
      label: 'SOL',
      value: solPrice ? fmtPrice(solPrice) : '-',
      change: tickerPrices?.SOL?.change24 || tickerPrices?.SOL?.change || 0,
    },
    {
      label: 'BNB',
      value: tickerPrices?.BNB?.price ? fmtPrice(tickerPrices.BNB.price) : '-',
      change: tickerPrices?.BNB?.change24 || tickerPrices?.BNB?.change || 0,
    },
  ]

  /* ═══════════════════════════════════════════════════════════════════
     SEARCH BAR - rendered inline (NOT as a component function) to
     prevent React from unmounting/remounting the <input> on every
     keystroke (which would kill focus).
     ═══════════════════════════════════════════════════════════════════ */
  const renderSearchBar = (compact) => (
    <div className={`se-search-box ${compact ? 'compact' : ''}`}>
      <div className="se-search-icon">{spectreIcons.search}</div>
      <input
        ref={!compact ? inputRef : undefined}
        type="text"
        className="se-search-input"
        placeholder={compact
          ? t('searchEngine.input.followupPlaceholder', 'Ask a follow-up...')
          : t('searchEngine.input.mainPlaceholder', 'Ask anything about crypto, stocks, wallets, DeFi...')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {inputHint && !compact && <span className="se-search-hint">{inputHint}</span>}
      <div className="se-search-actions">
        {!compact && <span className="se-search-kbd">&#9166;</span>}
        <button className="se-search-submit" onClick={() => handleSearch()} disabled={!query.trim()}>
          {spectreIcons.send}
        </button>
      </div>
    </div>
  )

  /* ═══════════════════════════════════════════════════════════════════
     FOCUS TABS - also rendered inline (same reason)
     ═══════════════════════════════════════════════════════════════════ */
  const renderFocusTabs = (compact) => (
    <div className={`se-focus-row ${compact ? 'compact' : ''}`}>
      {FOCUS_TABS.map(tab => (
        <button
          key={tab.id}
          className={`se-focus-chip ${focus === tab.id ? 'active' : ''}`}
          onClick={() => { setFocus(tab.id); if (view === 'results' && result) handleSearch(result.query, tab.id) }}
        >
          <span className="se-focus-chip-icon">{spectreIcons[tab.icon]}</span>
          {t(`searchEngine.focus.${tab.id}`, tab.label)}
        </button>
      ))}
    </div>
  )

  /* ═══════════════════════════════════════════════════════════════════
     MODE TABS - Quick Intel / Deep Thesis toggle
     ═══════════════════════════════════════════════════════════════════ */
  const renderModeTabs = (compact) => (
    <div className={`se-mode-tabs ${compact ? 'compact' : ''}`}>
      <button
        className={`se-mode-tab ${searchMode === 'quick' ? 'active' : ''}`}
        onClick={() => setSearchMode('quick')}
      >
        <span className="se-mode-tab-icon">{spectreIcons.send}</span>
        <span className="se-mode-tab-text">{t('searchEngine.mode.quick', 'Quick Intel')}</span>
        {!compact && <span className="se-mode-tab-desc">{t('searchEngine.mode.quickDesc', 'Fast answers')}</span>}
      </button>
      <button
        className={`se-mode-tab ${searchMode === 'deep' ? 'active' : ''}`}
        onClick={() => setSearchMode('deep')}
      >
        <span className="se-mode-tab-icon">{spectreIcons.aiAnalysis}</span>
        <span className="se-mode-tab-text">{t('searchEngine.mode.deep', 'Deep Thesis')}</span>
        {!compact && <span className="se-mode-tab-desc">{t('searchEngine.mode.deepDesc', 'Full research')}</span>}
      </button>
    </div>
  )

  /* ═══════════════════════════════════════════════════════════════════
     HOME VIEW - 4K Apple Editorial Design
     ═══════════════════════════════════════════════════════════════════ */
  if (view === 'home') {
    return (
      <div className="se-page">
        {/* Ambient background */}
        <div className="se-ambient">
          <div className="se-ambient-grid" />
          <div className="se-ambient-orb se-orb-1" />
          <div className="se-ambient-orb se-orb-2" />
        </div>

        <div className="se-home">
          {/* ── Editorial Hero ── */}
          <div className="se-hero">
            <div className="se-hero-label">{t('searchEngine.hero.eyebrow', 'SPECTRE INTELLIGENCE')}</div>
            <h1 className="se-hero-title">
              {getGreeting(t)}<span className="se-hero-dot">.</span>
            </h1>
            <p className="se-hero-subtitle">{t('searchEngine.hero.subtitle', 'Institutional-grade research across crypto, stocks & on-chain data')}</p>
          </div>

          {/* ── Search bar (large) ── */}
          {renderSearchBar()}
          {renderModeTabs()}
          {renderFocusTabs()}

          {/* ── Market pulse - live price grid ── */}
          {tickerPrices && Object.keys(tickerPrices).length > 0 && (
            <div className="se-market-pulse">
              <div className="se-market-pulse-label">
                <span className="se-pulse-dot" />
                <span>{t('searchEngine.liveMarket', 'LIVE MARKET')}</span>
              </div>
              <div className="se-market-pulse-grid">
                {marketStats.map(stat => {
                  const isUp = stat.change >= 0
                  return (
                    <button key={stat.label} className="se-market-stat" data-token={stat.label.toLowerCase()} onClick={() => { setQuery(stat.label); handleSearch(stat.label) }}>
                      <div className="se-market-stat-top">
                        <span className="se-market-stat-sym">{stat.label}</span>
                        <span className={`se-market-stat-badge ${isUp ? 'up' : 'down'}`}>
                          {isUp ? '+' : ''}{stat.change.toFixed(2)}%
                        </span>
                      </div>
                      <span className="se-market-stat-price">{stat.value}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Trending research ── */}
          <div className="se-section">
            <div className="se-section-header">
              <span className="se-section-tag">{t('searchEngine.section.trending', 'TRENDING RESEARCH')}</span>
              <span className="se-section-line" />
            </div>
            <div className="se-trending-grid">
              {trending.map((item, i) => (
                <button key={`trend-${i}-${item.title}`} className="se-trending-card" style={{ '--card-index': i }}
                  onClick={() => { setQuery(item.query); handleSearch(item.query) }}>
                  <div className="se-trending-card-icon">{spectreIcons[item.icon] || spectreIcons.sparkles}</div>
                  <div className="se-trending-card-body">
                    <span className="se-trending-card-title">{item.title}</span>
                    <span className="se-trending-card-cat">{item.category}</span>
                  </div>
                  <span className="se-trending-card-arrow">{spectreIcons.chevronRight}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Recent searches ── */}
          {recentSearches.length > 0 && (
            <div className="se-section">
              <div className="se-section-header">
                <span className="se-section-tag">{t('searchEngine.section.recent', 'RECENT')}</span>
                <span className="se-section-line" />
              </div>
              <div className="se-recent-list">
                {recentSearches.map((q, i) => (
                  <button key={`recent-${q}`} className="se-recent-item" onClick={() => { setQuery(q); handleSearch(q) }}>
                    <span className="se-recent-icon">{spectreIcons.timeframe}</span>
                    <span>{q}</span>
                    <span className="se-recent-arrow">{spectreIcons.chevronRight}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Quick actions ── */}
          <div className="se-quick-actions">
            <button className="se-quick-btn" onClick={() => { setQuery('BTC price analysis'); handleSearch('BTC price analysis') }}>
              {spectreIcons.fire}<span>{t('searchEngine.quickAction.btc', 'BTC Analysis')}</span>
            </button>
            <button className="se-quick-btn" onClick={() => { setQuery('Top DeFi yields'); handleSearch('Top DeFi yields') }}>
              {spectreIcons.whale}<span>{t('searchEngine.quickAction.defi', 'DeFi Yields')}</span>
            </button>
            <button className="se-quick-btn" onClick={() => { setQuery('Meme coin alpha'); handleSearch('Meme coin alpha') }}>
              {spectreIcons.sparkles}<span>{t('searchEngine.quickAction.meme', 'Meme Alpha')}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════════════
     RESULTS VIEW (SSE stream — data-first, then LLM text)

     The SSE hook manages a lifecycle: loading → data slots arrive
     (knowledge panel paints) → text streams (answer writes itself)
     → related questions → done. This single view handles all states.
     ═══════════════════════════════════════════════════════════════════ */
  if (view === 'results') {
    const hasSlots = Object.keys(stream.slots).length > 0
    const isStreaming = stream.status === 'streaming' || stream.status === 'loading'
    const priceData = stream.slots.price || null
    const instData = stream.slots.institutional || null
    const techData = stream.slots.technicals || null
    const newsData = stream.slots.news
    const signalsData = stream.slots.signals
    const derivData = stream.slots.derivatives || stream.slots.dashboard || stream.slots.funding
    const gainersData = stream.slots.gainers
    const losersData = stream.slots.losers
    const fgData = stream.slots.feargreed || stream.slots.global

    // Format helpers — use currency-aware formatter from useCurrency()
    const fmtNum = (n) => {
      if (n == null) return '-'
      return fmtLarge(n)
    }

    return (
      <div className="se-page se-page-results">
        {/* ── Top bar (logo removed — AppShell already brands the page;
            the duplicate logo was colliding with the left sidebar +
            global header) ── */}
        <div className="se-results-topbar" ref={resultsTopRef}>
          <div className="se-topbar-center">
            <div className="se-topbar-search">{renderSearchBar(true)}</div>
            {renderFocusTabs(true)}
          </div>
        </div>

        {/* ── Query echo + classification badge ── */}
        <div className="se-results-header">
          <div className="se-query-echo">
            <h1 className="se-query-text">{query}<span className="se-query-dot">.</span></h1>
            <div className="se-query-meta">
              {stream.meta?.classification && (
                <span className="se-query-badge">{stream.meta.classification.replace(/_/g, ' ')}</span>
              )}
              <span className="se-mode-badge-quick">{searchMode === 'deep' ? t('searchEngine.mode.deepBadge', 'DEEP THESIS') : t('searchEngine.mode.quickBadge', 'QUICK INTEL')}</span>
              {stream.done && (
                <span className="se-query-time">
                  {t('searchEngine.results.endpoints', '{{count}} endpoints · {{seconds}}s', {
                    count: stream.done.endpoints_hit,
                    seconds: (stream.done.response_time_ms / 1000).toFixed(1),
                  })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── 60/40 two-column grid ── */}
        <div className="se-results-grid">

          {/* ── LEFT COLUMN (60%) — Answer stream ── */}
          <div className="se-results-left">
            {/* Google/Perplexity-style image hero strip at the top.
                Renders only when at least one image source is available
                (asset logo or news article imageUrl). Provides the
                "text + images" visual hierarchy Sunny benchmarked. */}
            <ImageHeroStrip stream={stream} />

            {/* Shimmer skeleton while waiting for text */}
            {!stream.text && isStreaming && (
              <div className="se-answer-card">
                <div className="se-answer-header">
                  <div className="se-answer-ai-badge"><span className="se-ai-dot" /><span>Spectre AI</span></div>
                </div>
                <div className="se-skeleton">
                  <div className="se-skeleton-line w100" />
                  <div className="se-skeleton-line w90" />
                  <div className="se-skeleton-line w95" />
                  <div className="se-skeleton-line w70" />
                  <div className="se-skeleton-line w80" />
                </div>
              </div>
            )}

            {/* Streamed LLM answer text */}
            {stream.text && (
              <div className="se-answer-card">
                <div className="se-answer-header">
                  <div className="se-answer-ai-badge"><span className="se-ai-dot" /><span>Spectre AI</span></div>
                  {isStreaming && <span className="se-typing-indicator"><span /><span /><span /></span>}
                </div>
                <div className="se-answer-body">
                  {renderMarkdown(stream.text)}
                </div>
              </div>
            )}

            {/* Error state */}
            {stream.status === 'error' && (
              <div className="se-answer-card">
                <div className="se-answer-header">
                  <div className="se-answer-ai-badge"><span className="se-ai-dot" /><span>Spectre AI</span></div>
                </div>
                <p style={{ color: 'var(--bear)', padding: '12px 0' }}>
                  {t('searchEngine.error.failed', 'Search failed: {{error}}. Try again.', { error: stream.error || t('searchEngine.error.unknown', 'Unknown error') })}
                </p>
              </div>
            )}

            {/* Sources — rich CitationsBar cards (favicon + label + path +
                description + color-graded latency). Replaces the flat
                chip row that didn't communicate what each source actually
                provided. Component lives in the v2 folder but is fully
                portable: it just consumes stream.citations. */}
            <CitationsBar stream={stream} />


            {/* People also ask */}
            {stream.related.length > 0 && (
              <div className="se-results-footer">
                <div className="se-section-header">
                  <span className="se-section-tag">{t('searchEngine.section.peopleAlsoAsk', 'PEOPLE ALSO ASK')}</span>
                  <span className="se-section-line" />
                </div>
                <div className="se-related-chips">
                  {stream.related.map((rq) => (
                    <button key={`rel-${rq}`} className="se-related-chip" onClick={() => { setQuery(rq); handleSearch(rq) }}>
                      {spectreIcons.search}
                      <span>{rq}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN (40%) — Knowledge Panel (data-first) ── */}
          <div className="se-results-right">
            {/* Compact price strip — header only (logo + symbol + price + 24h).
                Full stats moved below the chart so the chart is immediately
                visible without scrolling. */}
            {priceData && (
              <div className="se-price-strip glass-card">
                <div className="se-price-strip-left">
                  {priceData.image && <img src={priceData.image} alt="" className="se-price-strip-logo" />}
                  <div className="se-price-strip-title">
                    <span className="se-price-strip-symbol">{priceData.symbol}</span>
                    <span className="se-price-strip-name">{priceData.name}</span>
                  </div>
                </div>
                <div className="se-price-strip-right">
                  <div className="se-price-strip-price mono">{fmtPrice(priceData.price)}</div>
                  <div className={`se-price-strip-change mono ${(priceData.change?.['24h'] || 0) >= 0 ? 'up' : 'down'}`}>
                    {(priceData.change?.['24h'] || 0) >= 0 ? '+' : ''}{(priceData.change?.['24h'] || 0).toFixed(2)}%
                  </div>
                </div>
                {instData && (
                  <span className={`se-grade-badge se-grade-${(instData.grade || 'C').toLowerCase()}`}>
                    {instData.grade}·{instData.score}
                  </span>
                )}
              </div>
            )}

            {/* Inline chart — for single-major-asset queries we mount the
                same MonarchAssetChart used in Monarch chat (Spectre / Line /
                TradingView toggle + 1M..ALL timeframes + real OHLCV). For
                everything else (multi-asset compare, no candles), fall back
                to the simpler ChartInline sparkline. */}
            {(() => {
              const assets = stream.meta?.assets || []
              const symbol = assets[0]
              const hasOneAsset = assets.length === 1 && !!symbol
              if (hasOneAsset) {
                // Build stats from already-streamed slots when present.
                const stats = []
                if (priceData?.price != null) {
                  stats.push({ label: t('searchEngine.metric.price', 'Price'), value: fmtPrice(Number(priceData.price)) })
                }
                const ch24 = priceData?.change?.['24h']
                if (ch24 != null) {
                  const v = Number(ch24)
                  stats.push({
                    label: t('searchEngine.metric.24h', '24h'),
                    value: `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`,
                    color: v >= 0 ? '#10B981' : '#EF4444',
                  })
                }
                if (techData?.support != null) {
                  stats.push({ label: t('searchEngine.metric.support', 'Support'), value: fmtPrice(Number(techData.support)) })
                }
                if (techData?.resistance != null) {
                  stats.push({ label: t('searchEngine.metric.resistance', 'Resistance'), value: fmtPrice(Number(techData.resistance)) })
                }
                const rsi = techData?.oscillators?.rsi_14?.value
                if (rsi != null) {
                  stats.push({ label: t('searchEngine.metric.rsi14', 'RSI 14'), value: Number(rsi).toFixed(1) })
                }
                return (
                  <MonarchChart spec={{
                    type: 'spectre_asset',
                    symbol,
                    timeframe: '1H',
                    title: t('searchEngine.chart.livePrice', '{{symbol}} — live price', { symbol }),
                    source: 'Spectre + TradingView',
                    stats,
                    sources: [{ name: 'Spectre Brain + Dossier' }],
                  }} />
                )
              }
              if (stream.slots.chart) {
                return (
                  <ChartInline
                    bars={Array.isArray(stream.slots.chart) ? stream.slots.chart : stream.slots.chart?.bars || []}
                    symbol={stream.meta?.assets?.[0] || ''}
                  />
                )
              }
              return null
            })()}

            {/* Technicals grid */}
            {techData && (
              <div className="se-metric-grid glass-card">
                <div className="se-metric-grid-title">{t('searchEngine.metric.technicals', 'Technicals')}</div>
                <div className="se-metrics">
                  {techData.summary?.signal && (
                    <div className="se-metric">
                      <span className="se-metric-label">{t('searchEngine.metric.signal', 'Signal')}</span>
                      <span className="se-metric-value">{techData.summary.signal}</span>
                    </div>
                  )}
                  {techData.oscillators?.rsi_14?.value != null && (
                    <div className="se-metric">
                      <span className="se-metric-label">{t('searchEngine.metric.rsi14', 'RSI 14')}</span>
                      <span className="se-metric-value mono">{techData.oscillators.rsi_14.value.toFixed(1)}</span>
                    </div>
                  )}
                  {techData.oscillators?.macd?.trend && (
                    <div className="se-metric">
                      <span className="se-metric-label">{t('searchEngine.metric.macd', 'MACD')}</span>
                      <span className="se-metric-value">{techData.oscillators.macd.trend}</span>
                    </div>
                  )}
                  {priceData?.market_cap != null && (
                    <div className="se-metric">
                      <span className="se-metric-label">{t('searchEngine.metric.mcap', 'MCap')}</span>
                      <span className="se-metric-value mono">{fmtNum(priceData.market_cap)}</span>
                    </div>
                  )}
                  {priceData?.volume_24h != null && (
                    <div className="se-metric">
                      <span className="se-metric-label">{t('searchEngine.metric.vol24h', 'Vol 24h')}</span>
                      <span className="se-metric-value mono">{fmtNum(priceData.volume_24h)}</span>
                    </div>
                  )}
                  {priceData?.change?.['7d'] != null && (
                    <div className="se-metric">
                      <span className="se-metric-label">{t('searchEngine.metric.7d', '7d')}</span>
                      <span className={`se-metric-value mono ${priceData.change['7d'] >= 0 ? 'up' : 'down'}`}>
                        {priceData.change['7d'] >= 0 ? '+' : ''}{priceData.change['7d'].toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Institutional card */}
            {instData?.category_scores && (
              <div className="se-institutional-card glass-card">
                <div className="se-metric-grid-title">{t('searchEngine.metric.institutional', 'Institutional Readiness')}</div>
                <div className="se-inst-dims">
                  {Object.entries(instData.category_scores).map(([dim, score]) => {
                    const pct = Math.min(100, Math.max(0, score))
                    const color = pct >= 70 ? 'var(--bull)' : pct >= 40 ? 'var(--amber, #F59E0B)' : 'var(--bear)'
                    return (
                      <div key={dim} className="se-inst-dim">
                        <span className="se-inst-dim-label">{dim.replace(/_/g, ' ')}</span>
                        <div className="se-inst-dim-bar">
                          <div className="se-inst-dim-fill" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <span className="se-inst-dim-score mono">{score}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* News — Google-style image tile row on top (when 2+ have
                images) + richer cards below with favicon, headline, source,
                relative timestamp. Falls back to title-only links if the
                payload doesn't have imageUrl (older feeds, SEC filings). */}
            {newsData && Array.isArray(newsData) && newsData.length > 0 && (() => {
              const articles = newsData.slice(0, 8)
              const withImg = articles.filter((a) => a?.imageUrl)
              const showImageRow = withImg.length >= 2
              const domain = (a) => {
                if (a?.sourceDomain) return a.sourceDomain
                try { return new URL(a?.url || '').hostname.replace(/^www\./, '') } catch { return '' }
              }
              const favicon = (a) => {
                const d = domain(a)
                return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=32` : null
              }
              const relTime = (iso) => {
                if (!iso) return ''
                const ms = Date.parse(iso)
                if (isNaN(ms)) return ''
                const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
                if (sec < 86400 * 7) return fmtAgo(ms)
                return new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(new Date(ms))
              }

              return (
                <>
                  {/* Image tile row */}
                  {showImageRow && (
                    <div className="se-news-tiles">
                      {withImg.slice(0, 4).map((a, i) => (
                        <a key={`tile-${i}`} className="se-news-tile" href={a.url} target="_blank" rel="noopener noreferrer">
                          <div className="se-news-tile-img" style={{ backgroundImage: `url(${a.imageUrl})` }} aria-hidden="true" />
                          <div className="se-news-tile-overlay">
                            <div className="se-news-tile-source">
                              {favicon(a) && <img src={favicon(a)} alt="" className="se-news-tile-favicon" loading="lazy" />}
                              <span>{a.source || domain(a)}</span>
                            </div>
                            <div className="se-news-tile-title">{a.title}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Card list */}
                  <div className="se-news-strip glass-card">
                    <div className="se-metric-grid-title">{t('searchEngine.section.news', 'News')}</div>
                    <div className="se-news-cards">
                      {articles.map((a, i) => (
                        <a key={`news-${i}`} className="se-news-card" href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.imageUrl ? (
                            <div className="se-news-card-thumb" style={{ backgroundImage: `url(${a.imageUrl})` }} aria-hidden="true" />
                          ) : (
                            <div className="se-news-card-thumb se-news-card-thumb-empty" aria-hidden="true">
                              {favicon(a) && <img src={favicon(a)} alt="" loading="lazy" />}
                            </div>
                          )}
                          <div className="se-news-card-body">
                            <div className="se-news-card-meta">
                              {favicon(a) && <img src={favicon(a)} alt="" className="se-news-card-favicon" loading="lazy" />}
                              <span className="se-news-card-source">{a.source || domain(a)}</span>
                              {a.publishedAt && <span className="se-news-card-dot">·</span>}
                              {a.publishedAt && <span className="se-news-card-time">{relTime(a.publishedAt)}</span>}
                            </div>
                            <div className="se-news-card-title">{a.title}</div>
                            {a.summary && <div className="se-news-card-snippet">{a.summary.length > 140 ? a.summary.slice(0, 140) + '…' : a.summary}</div>}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                </>
              )
            })()}

            {/* Signals strip */}
            {signalsData && Array.isArray(signalsData) && signalsData.length > 0 && (
              <div className="se-signals-strip glass-card">
                <div className="se-metric-grid-title">{t('searchEngine.section.activeSignals', 'Active Signals')}</div>
                {signalsData.slice(0, 5).map((sig, i) => (
                  <div key={`sig-${i}`} className="se-signal-item">
                    <span className="se-signal-dot" />
                    <span className="se-signal-text">{sig.headline || sig.title || sig.detail}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Gainers / Losers (for market overview) */}
            {gainersData && Array.isArray(gainersData) && (
              <div className="se-movers-card glass-card">
                <div className="se-metric-grid-title">{t('searchEngine.section.topGainers', 'Top Gainers')}</div>
                <div className="se-mover-list">
                  {gainersData.slice(0, 5).map((m, i) => (
                    <div key={`g-${i}`} className="se-mover-row">
                      <span className="se-mover-rank">{i + 1}</span>
                      <span className="se-mover-sym">{m.asset}</span>
                      <span className="se-mover-change mono up">+{(m.change || 0).toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {losersData && Array.isArray(losersData) && (
              <div className="se-movers-card glass-card">
                <div className="se-metric-grid-title">{t('searchEngine.section.topLosers', 'Top Losers')}</div>
                <div className="se-mover-list">
                  {losersData.slice(0, 5).map((m, i) => (
                    <div key={`l-${i}`} className="se-mover-row">
                      <span className="se-mover-rank">{i + 1}</span>
                      <span className="se-mover-sym">{m.asset}</span>
                      <span className="se-mover-change mono down">{(m.change || 0).toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Shimmer placeholders while data loads */}
            {!hasSlots && isStreaming && (
              <>
                <div className="glass-card" style={{ padding: 20 }}>
                  <div className="se-skeleton"><div className="se-skeleton-line w80" /><div className="se-skeleton-line w60" /><div className="se-skeleton-line w90" /></div>
                </div>
                <div className="glass-card" style={{ padding: 20 }}>
                  <div className="se-skeleton"><div className="se-skeleton-line w70" /><div className="se-skeleton-line w50" /></div>
                </div>
              </>
            )}

            {/* Action row */}
            {stream.meta?.assets?.[0] && stream.status === 'done' && (
              <div className="se-actions-card glass-card">
                <button className="se-action-btn" onClick={() => navigate(`/research-zone/${getTokenSlug(stream.meta.assets[0])}`)}>
                  {spectreIcons.externalLink}<span>{t('searchEngine.action.openInVentures', 'Open in Ventures')}</span>
                </button>
                <button className="se-action-btn" onClick={() => navigate('/monarch-chat')}>
                  {spectreIcons.sparkles}<span>{t('searchEngine.action.askMonarch', 'Ask Monarch')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════════════
     LEGACY LOADING VIEW — kept as fallback for old /api/search path.
     Will be removed once SSE pipeline is fully validated.
     ═══════════════════════════════════════════════════════════════════ */
  if (view === 'loading') {
    return (
      <div className="se-page se-page-results">
        <div className="se-results-topbar">
          <div className="se-topbar-center">
            <div className="se-topbar-search">{renderSearchBar(true)}</div>
            {renderFocusTabs(true)}
          </div>
        </div>

        <div className="se-results-wide">
          <div className="se-query-echo">
            <h1 className="se-query-text">{query}<span className="se-query-dot">.</span></h1>
          </div>

          {/* Scouring sources animation */}
          <div className="se-scouring">
            <div className="se-scouring-header">
              <span className="se-scouring-pulse" />
              <span className="se-scouring-label">{searchMode === 'deep' ? t('searchEngine.loading.deepPipeline', 'Running deep research pipeline') : t('searchEngine.loading.scouring', 'Scouring sources')}</span>
            </div>
            <div className="se-scouring-sources">
              {(searchMode === 'deep' ? [
                { name: 'Spectre AI', icon: '/round-logo.png', isSpectre: true },
                { name: 'CoinGecko', favicon: 'coingecko.com' },
                { name: 'DeFiLlama', favicon: 'defillama.com' },
                { name: 'Reddit', favicon: 'reddit.com' },
                { name: 'GitHub', favicon: 'github.com' },
                { name: 'X / Twitter', favicon: 'x.com' },
                { name: 'Medium', favicon: 'medium.com' },
                { name: 'Perplexity', favicon: 'perplexity.ai' },
              ] : [
                { name: 'Spectre AI', icon: '/round-logo.png', isSpectre: true },
                { name: 'CoinGecko', favicon: 'coingecko.com' },
                { name: 'Binance', favicon: 'binance.com' },
                { name: 'TradingView', favicon: 'tradingview.com' },
                { name: 'CoinMarketCap', favicon: 'coinmarketcap.com' },
                { name: 'Bloomberg', favicon: 'bloomberg.com' },
                { name: 'CryptoQuant', favicon: 'cryptoquant.com' },
                { name: 'Glassnode', favicon: 'glassnode.com' },
              ]).map((source, i) => (
                <div key={`src-${source.name}`} className="se-scouring-source" style={{ animationDelay: `${i * 0.15}s` }}>
                  {source.isSpectre
                    ? <img src={source.icon} alt="" className="se-scouring-icon se-scouring-spectre" />
                    : <img src={`https://www.google.com/s2/favicons?domain=${source.favicon}&sz=32`} alt="" className="se-scouring-icon" />
                  }
                  <span>{source.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="se-answer-card">
            <div className="se-answer-header">
              <div className="se-answer-ai-badge"><span className="se-ai-dot" /><span>Spectre AI</span></div>
              <div className="se-answer-status">
                <span className="se-typing-indicator"><span /><span /><span /></span>
                <span>{searchMode === 'deep' ? t('searchEngine.loading.deepAnalysis', 'Running deep analysis...') : t('searchEngine.loading.analyzing', 'Analyzing...')}</span>
              </div>
            </div>
            {searchMode === 'deep' && (
              <div className="se-deep-loading-steps">
                <div className="se-deep-step active"><span className="se-deep-step-dot" /><span>{t('searchEngine.loading.step1', 'Fetching market data')}</span></div>
                <div className="se-deep-step"><span className="se-deep-step-dot" /><span>{t('searchEngine.loading.step2', 'Checking DeFiLlama, Reddit, GitHub')}</span></div>
                <div className="se-deep-step"><span className="se-deep-step-dot" /><span>{t('searchEngine.loading.step3', 'Compiling research dossier')}</span></div>
                <div className="se-deep-step"><span className="se-deep-step-dot" /><span>{t('searchEngine.loading.step4', 'Generating thesis')}</span></div>
              </div>
            )}
            <div className="se-skeleton">
              <div className="se-skeleton-line w100" />
              <div className="se-skeleton-line w90" />
              <div className="se-skeleton-line w95" />
              <div className="se-skeleton-line w70" />
              <div className="se-skeleton-line w80" />
              <div className="se-skeleton-line w60" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════════════
     RESULTS VIEW - two-column grid layout
     Left: AI Analysis + Charts + Sources
     Right: Thesis sidebar + Metrics + Quick Links
     ═══════════════════════════════════════════════════════════════════ */
  const cls = result ? (CLASS_COLORS[result.classification] || CLASS_COLORS.GENERAL) : CLASS_COLORS.GENERAL
  const citations = result?.research?.citations || []
  const relatedSearches = result?.relatedSearches || []
  const layout = getLayoutConfig(result?.classification)
  // If we have enriched token data, always show the data strip (even for GENERAL queries)
  if (enrichedTokens.length > 0 && layout.fullWidth) {
    layout.showSidebar = true
    layout.fullWidth = false
  }
  const parsed = parseResearchSections(result?.research?.content)
  const primaryTicker = result?.tickers?.[0] || null

  return (
    <div className="se-page se-page-results">
      {/* Top bar — page logo removed (AppShell brands the page) */}
      <div className="se-results-topbar" ref={resultsTopRef}>
        <div className="se-topbar-center">
          <div className="se-topbar-search">{renderSearchBar(true)}</div>
          {renderFocusTabs(true)}
        </div>
      </div>

      {/* ── DISAMBIGUATION PICKER ── */}
      {disambiguation && !result && (
        <div className="se-disambiguation-container">
          <div className="se-disambiguation-card">
            <div className="se-disambiguation-icon">{spectreIcons.aiAnalysis}</div>
            <h2 className="se-disambiguation-title">{t('searchEngine.disambig.title', 'Which did you mean?')}</h2>
            <p className="se-disambiguation-subtitle">{t('searchEngine.disambig.subtitle', 'Multiple entities match your search. Select one to continue.')}</p>
            {disambiguation.map((group, gi) => (
              <div key={gi} className="se-disambiguation-group">
                {group.candidate?.raw && (
                  <span className="se-disambiguation-query-label">&ldquo;{group.candidate.raw}&rdquo;</span>
                )}
                <div className="se-disambiguation-options">
                  {(group.options || []).map((opt, oi) => (
                    <button
                      key={oi}
                      className="se-disambiguation-option"
                      onClick={() => {
                        const resolved = opt.ticker ? `$${opt.ticker}` : opt.name
                        setQuery(resolved)
                        setDisambiguation(null)
                        handleSearch(resolved)
                      }}
                    >
                      <span className="se-disambiguation-option-name">{opt.name}</span>
                      {opt.ticker && <span className="se-disambiguation-option-ticker">${opt.ticker}</span>}
                      {opt.hint && <span className="se-disambiguation-option-hint">{opt.hint}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`se-results-grid ${layout.fullWidth ? 'se-results-full' : ''} ${result?.mode === 'deep' ? 'se-deep-mode' : ''}`} style={disambiguation && !result ? { display: 'none' } : undefined}>
        {/* ── Full-width header ── */}
        <div className="se-results-header">
          <div className="se-query-echo">
            <h1 className="se-query-text">{result?.query || query}<span className="se-query-dot">.</span></h1>
            <div className="se-query-meta">
              <span className="se-query-badge" style={{ background: cls.bg, color: cls.color }}>{t(`searchEngine.classification.${result?.classification || 'GENERAL'}`, cls.label)}</span>
              {result?.isSelfQuery && <span className="se-mode-badge-self">{t('searchEngine.badge.aboutPlatform', 'ABOUT THIS PLATFORM')}</span>}
              {!result?.isSelfQuery && result?.mode === 'deep' && <span className="se-mode-badge-deep">{t('searchEngine.mode.deepBadge', 'DEEP THESIS')}</span>}
              {!result?.isSelfQuery && result?.mode === 'quick' && <span className="se-mode-badge-quick">{t('searchEngine.mode.quickBadge', 'QUICK INTEL')}</span>}
              <span className="se-query-time">{result?.timestamp ? new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: 'numeric', second: 'numeric' }).format(new Date(result.timestamp)) : ''}</span>
            </div>

            {/* Mode toggle - switch between Quick Intel and Deep Thesis */}
            {!result?.isSelfQuery && (
              <div className="se-results-mode-toggle">
                <button
                  className={`se-results-mode-btn ${!result?.mode || result?.mode === 'quick' ? 'active' : ''}`}
                  onClick={() => { setSearchMode('quick'); handleSearch(result?.query || query, null, 'quick') }}
                >
                  <span className="se-results-mode-btn-icon">{spectreIcons.send}</span>
                  {t('searchEngine.mode.quick', 'Quick Intel')}
                </button>
                <button
                  className={`se-results-mode-btn ${result?.mode === 'deep' ? 'active' : ''}`}
                  onClick={() => { setSearchMode('deep'); handleSearch(result?.query || query, null, 'deep') }}
                >
                  <span className="se-results-mode-btn-icon">{spectreIcons.aiAnalysis}</span>
                  {t('searchEngine.mode.deep', 'Deep Thesis')}
                </button>
              </div>
            )}
          </div>

          {/* Enriched token data strip */}
          {enrichedTokens.length > 0 && (
            <div className={`se-data-strip ${isComparison ? 'se-data-strip-compare' : ''}`}>

              {/* Comparison mode: compact side-by-side token cards + single overlay chart */}
              {isComparison ? (
                <>
                  <div className="se-compare-tokens-row">
                    {enrichedTokens.slice(0, 2).map((token, i) => {
                      const isUp = (token.change24h || 0) >= 0
                      return (
                        <div key={token.symbol + i} className="se-compare-token-card" data-token={token.symbol?.toLowerCase()}>
                          <div className="se-compare-token-top">
                            <div className="se-compare-token-identity" onClick={() => navigate(`/research-zone/${getTokenSlug(token.symbol)}`)}>
                              {token.logo && <img src={token.logo} alt="" className="se-compare-token-logo" onError={e => { e.target.style.display = 'none' }} />}
                              <div className="se-compare-token-id">
                                <span className="se-compare-token-sym">{token.symbol}</span>
                                <span className="se-compare-token-name">{token.name}</span>
                              </div>
                            </div>
                            <div className={`se-compare-token-chg ${isUp ? 'up' : 'down'}`}>
                              {isUp ? '+' : ''}{(token.change24h || 0).toFixed(2)}%
                            </div>
                          </div>
                          <div className="se-compare-token-price">{fmtPrice(token.price)}</div>
                          <div className="se-compare-token-metrics">
                            {token.volume > 0 && <span>{t('searchEngine.metric.vol', 'Vol')} <b>{fmtLarge(token.volume)}</b></span>}
                            {token.marketCap > 0 && <span>{t('searchEngine.metric.mcap', 'MCap')} <b>{fmtLarge(token.marketCap)}</b></span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {enrichedTokens.length >= 2 && (() => {
                    const tvTheme = isDayMode ? 'light' : 'dark'
                    const sym1 = enrichedTokens[0].symbol + 'USD'
                    const sym2 = enrichedTokens[1].symbol + 'USD'
                    return (
                      <div className="se-compare-chart">
                        <div className="se-compare-chart-header">
                          <span className="se-compare-chart-label">{t('searchEngine.compare.performanceLabel', 'Performance Comparison')}</span>
                          <span className="se-compare-chart-pair">{enrichedTokens[0].symbol} {t('searchEngine.compare.vs', 'vs')} {enrichedTokens[1].symbol}</span>
                        </div>
                        <div className="se-compare-chart-frame">
                          <iframe
                            src={`https://s.tradingview.com/widgetembed/?hideideas=1&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en#%7B%22symbol%22%3A%22${encodeURIComponent(sym1)}%22%2C%22frameElementId%22%3A%22se-tv-compare%22%2C%22interval%22%3A%22D%22%2C%22hide_top_toolbar%22%3A%221%22%2C%22hide_legend%22%3A%220%22%2C%22save_image%22%3A%220%22%2C%22studies%22%3A%5B%5D%2C%22theme%22%3A%22${tvTheme}%22%2C%22style%22%3A%223%22%2C%22timezone%22%3A%22Etc%2FUTC%22%2C%22studies_overrides%22%3A%7B%7D%2C%22compareSymbols%22%3A%5B%7B%22symbol%22%3A%22${encodeURIComponent(sym2)}%22%2C%22position%22%3A%22SameScale%22%7D%5D%2C%22width%22%3A%22100%25%22%2C%22height%22%3A%22100%25%22%7D`}
                            title={`${enrichedTokens[0].symbol} vs ${enrichedTokens[1].symbol}`}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            sandbox="allow-scripts allow-same-origin allow-popups"
                          />
                        </div>
                      </div>
                    )
                  })()}
                </>
              ) : (
                /* Single-token mode: full strip with mini chart */
                enrichedTokens.slice(0, 3).map((token, i) => {
                  const isUp = (token.change24h || 0) >= 0
                  const tvTheme = isDayMode ? 'light' : 'dark'
                  return (
                    <div key={token.symbol + i} className="se-data-strip-inner" data-token={token.symbol?.toLowerCase()}>
                      <div className="se-data-strip-left">
                        <div className="se-data-strip-identity" onClick={() => navigate(`/research-zone/${getTokenSlug(token.symbol)}`)}>
                          {token.logo && <img src={token.logo} alt="" className="se-data-strip-logo" onError={e => { e.target.style.display = 'none' }} />}
                          <div className="se-data-strip-id">
                            <span className="se-data-strip-sym">{token.symbol}</span>
                            <span className="se-data-strip-name">{token.name}</span>
                          </div>
                        </div>
                        <div className="se-data-strip-pricing">
                          <div className="se-data-strip-price">{fmtPrice(token.price)}</div>
                          <div className={`se-data-strip-chg ${isUp ? 'up' : 'down'}`}>
                            {isUp ? '+' : ''}{(token.change24h || 0).toFixed(2)}%
                          </div>
                        </div>
                        <div className="se-data-strip-metrics">
                          {token.volume > 0 && (
                            <div className="se-data-strip-stat">
                              <span>{t('searchEngine.metric.vol24h', 'Vol 24h')}</span>
                              <span>{fmtLarge(token.volume)}</span>
                            </div>
                          )}
                          {token.marketCap > 0 && (
                            <div className="se-data-strip-stat">
                              <span>{t('searchEngine.metric.marketCap', 'Market Cap')}</span>
                              <span>{fmtLarge(token.marketCap)}</span>
                            </div>
                          )}
                          {token.liquidity > 0 && (
                            <div className="se-data-strip-stat">
                              <span>{t('searchEngine.metric.liquidity', 'Liquidity')}</span>
                              <span>{fmtLarge(token.liquidity)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Chart: TradingView for deep mode, SVG sparkline for quick mode */}
                      {layout.showChart && result?.mode === 'deep' ? (
                        <div className="se-data-strip-chart">
                          <iframe
                            key={token.symbol}
                            src={`https://s.tradingview.com/widgetembed/?hideideas=1&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en#%7B%22symbol%22%3A%22${encodeURIComponent(token.symbol + 'USD')}%22%2C%22frameElementId%22%3A%22se-tv-strip-${i}%22%2C%22interval%22%3A%22D%22%2C%22hide_top_toolbar%22%3A%221%22%2C%22hide_legend%22%3A%221%22%2C%22save_image%22%3A%220%22%2C%22studies%22%3A%5B%5D%2C%22theme%22%3A%22${tvTheme}%22%2C%22style%22%3A%223%22%2C%22timezone%22%3A%22Etc%2FUTC%22%2C%22studies_overrides%22%3A%7B%7D%2C%22width%22%3A%22100%25%22%2C%22height%22%3A%22100%25%22%7D`}
                            title={`${token.symbol} Chart`}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            sandbox="allow-scripts allow-same-origin allow-popups"
                          />
                        </div>
                      ) : token.sparkline && token.sparkline.length > 2 ? (
                        <div className="se-data-strip-sparkline">
                          {renderSparkline(token.sparkline, (token.change24h || 0) >= 0)}
                        </div>
                      ) : layout.showChart ? (
                        <div className="se-data-strip-chart">
                          <iframe
                            key={token.symbol}
                            src={`https://s.tradingview.com/widgetembed/?hideideas=1&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en#%7B%22symbol%22%3A%22${encodeURIComponent(token.symbol + 'USD')}%22%2C%22frameElementId%22%3A%22se-tv-strip-${i}%22%2C%22interval%22%3A%22D%22%2C%22hide_top_toolbar%22%3A%221%22%2C%22hide_legend%22%3A%221%22%2C%22save_image%22%3A%220%22%2C%22studies%22%3A%5B%5D%2C%22theme%22%3A%22${tvTheme}%22%2C%22style%22%3A%223%22%2C%22timezone%22%3A%22Etc%2FUTC%22%2C%22studies_overrides%22%3A%7B%7D%2C%22width%22%3A%22100%25%22%2C%22height%22%3A%22100%25%22%7D`}
                            title={`${token.symbol} Chart`}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            sandbox="allow-scripts allow-same-origin allow-popups"
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* ── Thesis At A Glance callout (full-width) ── */}
        {parsed.thesisAtGlance && (
          <div className="se-thesis-glance" style={{ gridColumn: '1 / -1' }}>
            <div className="se-thesis-glance__label">{t('searchEngine.section.thesisAtGlance', 'THESIS AT A GLANCE')}</div>
            <div className="se-thesis-glance__text">{renderInline(parsed.thesisAtGlance)}</div>
          </div>
        )}

        {/* ── Mobile tab switcher (hidden on desktop) ── */}
        {layout.showSidebar && (
          <div className="se-result-tabs">
            <button className={`se-result-tab ${resultTab === 'analysis' ? 'active' : ''}`} onClick={() => setResultTab('analysis')}>
              {spectreIcons.aiAnalysis}<span>{t('searchEngine.tab.analysis', 'Analysis')}</span>
            </button>
            <button className={`se-result-tab ${resultTab === 'thesis' ? 'active' : ''}`} onClick={() => setResultTab('thesis')}>
              {spectreIcons.library}<span>{t('searchEngine.tab.more', 'More')}</span>
            </button>
          </div>
        )}

        {/* Error state */}
        {error && !result && (
          <div className="se-error-card" style={{ gridColumn: '1 / -1' }}>
            <div className="se-error-icon">{spectreIcons.info}</div>
            <div>
              <p className="se-error-title">{t('searchEngine.error.title', 'Search Error')}</p>
              <p className="se-error-msg">{error}</p>
              <p className="se-error-hint">{t('searchEngine.error.serverHint', 'Make sure the server is running:')} <code>npm run dev:server</code></p>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
           LEFT COLUMN - AI Analysis
           ══════════════════════════════════════════════════════════════ */}
        {result?.research?.content && (
          <div className={`se-analysis-col ${resultTab !== 'analysis' ? 'se-tab-hidden' : ''}`}>
            <div className="se-answer-card">
              <div className="se-answer-header">
                <div className="se-answer-ai-badge"><span className="se-ai-dot" /><span>Spectre AI</span></div>
              </div>
              <div className="se-answer-body">
                <div className="se-answer-content">
                  {renderMarkdown(parsed.analysisContent || parsed.raw)}
                </div>
              </div>
            </div>

            {/* ── Follow-up input ── */}
            <div className="se-followup">
              <div className="se-followup-icon">{spectreIcons.chat}</div>
              <input
                type="text" className="se-followup-input" placeholder={t('searchEngine.input.followupQuestionPlaceholder', 'Ask a follow-up question...')}
                value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown}
              />
              <button className="se-followup-send" onClick={() => handleSearch()} disabled={!query.trim()}>
                {spectreIcons.send}
              </button>
            </div>

            {/* ── Go deeper button (quick mode only, not for self-queries) ── */}
            {!result?.isSelfQuery && (!result?.mode || result?.mode === 'quick') && result?.tickers?.length > 0 && (
              <button className="se-go-deeper" onClick={handleGoDeeper}>
                <div className="se-go-deeper-left">
                  <span className="se-go-deeper-icon">{spectreIcons.aiAnalysis}</span>
                  <div className="se-go-deeper-text">
                    <span className="se-go-deeper-title">{t('searchEngine.goDeeper.title', 'Go deeper')}</span>
                    <span className="se-go-deeper-desc">{t('searchEngine.goDeeper.desc', 'Full trader research with DeFiLlama, Reddit, GitHub, X data')}</span>
                  </div>
                </div>
                <span className="se-go-deeper-arrow">{spectreIcons.chevronRight}</span>
              </button>
            )}

            {/* ── Self-query disambiguation ── */}
            {result?.isSelfQuery && (
              <div className="se-self-disambiguation">
                {t('searchEngine.selfDisambig', 'Not to be confused with Spectre.Ai (binary options platform, Cayman Islands). Completely unrelated entity.')}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
           RIGHT COLUMN - Sources + Quick Links + Thesis
           ══════════════════════════════════════════════════════════════ */}
        {layout.showSidebar && result?.research?.content && (
          <div className={`se-thesis-sidebar ${resultTab !== 'thesis' ? 'se-tab-hidden' : ''}`}>

            {/* Source cards - search-engine native */}
            {citations.length > 0 && (
              <div className="se-sources">
                <div className="se-sources-header">
                  <div className="se-sources-label">{spectreIcons.globe}<span>{t('searchEngine.sidebar.sources', 'Sources')}</span></div>
                  <span className="se-sources-count">{citations.length}</span>
                </div>
                <div className="se-sources-list">
                  {citations.map((url, i) => {
                    let domain = url
                    try { domain = new URL(url).hostname.replace('www.', '') } catch {}
                    return (
                      <a key={`cite-${url}`} href={url} target="_blank" rel="noopener noreferrer" className="se-source-row">
                        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" className="se-source-favicon" />
                        <span className="se-source-domain">{domain}</span>
                        <span className="se-source-num">{i + 1}</span>
                      </a>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Pipeline data panel (deep mode only) ── */}
            {result?.pipeline && (
              <div className="se-pipeline-panel">
                <div className="se-pipeline-header">
                  <span className="se-pipeline-label">{t('searchEngine.pipeline.title', 'RESEARCH PIPELINE')}</span>
                </div>

                {/* Risk level + sentiment */}
                <div className="se-pipeline-stats">
                  {result.pipeline.riskLevel && (
                    <div className="se-pipeline-stat">
                      <span className="se-pipeline-stat-label">{t('searchEngine.pipeline.risk', 'Risk')}</span>
                      <span className={`se-pipeline-stat-value se-risk-${result.pipeline.riskLevel?.toLowerCase()}`}>{t(`searchEngine.pipeline.riskLevel.${String(result.pipeline.riskLevel).toLowerCase()}`, result.pipeline.riskLevel)}</span>
                    </div>
                  )}
                  {result.pipeline.sentiment && (
                    <div className="se-pipeline-stat">
                      <span className="se-pipeline-stat-label">{t('searchEngine.pipeline.sentiment', 'Sentiment')}</span>
                      <span className={`se-pipeline-stat-value se-sentiment-${result.pipeline.sentiment?.toLowerCase()}`}>{t(`searchEngine.pipeline.sentimentValue.${String(result.pipeline.sentiment).toLowerCase()}`, result.pipeline.sentiment)}</span>
                    </div>
                  )}
                  {result.pipeline.confidence && (
                    <div className="se-pipeline-stat">
                      <span className="se-pipeline-stat-label">{t('searchEngine.pipeline.confidence', 'Confidence')}</span>
                      <span className="se-pipeline-stat-value">{result.pipeline.confidence}</span>
                    </div>
                  )}
                </div>

                {/* Risk flags */}
                {result.pipeline.riskFlags?.length > 0 && (
                  <div className="se-pipeline-flags">
                    <span className="se-pipeline-flags-label">{t('searchEngine.pipeline.riskFlags', 'Risk Flags')}</span>
                    <div className="se-pipeline-flags-list">
                      {result.pipeline.riskFlags.map((flag, i) => (
                        <span key={`flag-${flag}-${i}`} className="se-pipeline-flag">{flag}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources used with priority weights */}
                {result.pipeline.sourcePriorities?.length > 0 && (
                  <div className="se-pipeline-sources">
                    <span className="se-pipeline-sources-label">{t('searchEngine.pipeline.sourcesUsed', 'Sources Used')}</span>
                    <div className="se-pipeline-sources-list">
                      {result.pipeline.sourcePriorities.map((sp) => (
                        <div key={`sp-${sp.source}-${sp.weight}`} className="se-pipeline-source-row">
                          <span className={`se-pipeline-weight se-weight-${sp.weight?.toLowerCase()}`}>{sp.weight}</span>
                          <span className="se-pipeline-source-name">{sp.source?.replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Risk gauge (deep mode) ── */}
            {result?.pipeline?.riskLevel && (
              <div className="se-risk-gauge">
                <div className="se-risk-gauge-header">
                  <span className="se-risk-gauge-label">{t('searchEngine.pipeline.riskLevel.label', 'Risk Level')}</span>
                  <span className={`se-risk-gauge-value ${result.pipeline.riskLevel?.toLowerCase()}`}>
                    {t(`searchEngine.pipeline.riskLevel.${String(result.pipeline.riskLevel).toLowerCase()}`, result.pipeline.riskLevel)}
                  </span>
                </div>
                <div className="se-risk-gauge-bar">
                  <div className={`se-risk-gauge-fill ${result.pipeline.riskLevel?.toLowerCase()}`} />
                </div>
              </div>
            )}

            {/* ── Deep mode metric cards ── */}
            {result?.pipeline?.dossier?.price && (
              <div className="se-deep-metrics-row">
                {result.pipeline.dossier.price.ath != null && (
                  <div className="se-deep-metric-card">
                    <span className="se-deep-metric-card-label">{t('searchEngine.deepMetric.ath', 'ATH')}</span>
                    <span className="se-deep-metric-card-value">{fmtPrice(result.pipeline.dossier.price.ath)}</span>
                  </div>
                )}
                {result.pipeline.dossier.price.athDrawdown != null && (
                  <div className="se-deep-metric-card">
                    <span className="se-deep-metric-card-label">{t('searchEngine.deepMetric.fromAth', 'From ATH')}</span>
                    <span className="se-deep-metric-card-value" style={{ color: 'var(--bear, #EF4444)' }}>
                      {result.pipeline.dossier.price.athDrawdown.toFixed(1)}%
                    </span>
                  </div>
                )}
                {result.pipeline.dossier.supply?.ratio != null && (
                  <div className="se-deep-metric-card">
                    <span className="se-deep-metric-card-label">{t('searchEngine.deepMetric.circSupply', 'Circ. Supply')}</span>
                    <span className="se-deep-metric-card-value">
                      {(result.pipeline.dossier.supply.ratio * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Quick Links */}
            <div className="se-quick-links">
              {primaryTicker && (
                <button className="se-quick-link" onClick={() => navigate(`/research-zone/${getTokenSlug(primaryTicker)}`)}>
                  {spectreIcons.aiAnalysis}
                  <span>{t('searchEngine.quickLink.researchZone', 'Open in Research Zone')}</span>
                  {spectreIcons.chevronRight}
                </button>
              )}
              <button className="se-quick-link" onClick={() => { setQuery(`${result?.query || query} latest news`); handleSearch(`${result?.query || query} latest news`) }}>
                {spectreIcons.news}
                <span>{t('searchEngine.quickLink.latestNews', 'Latest News')}</span>
                {spectreIcons.chevronRight}
              </button>
              <button className="se-quick-link" onClick={() => { setQuery(`${primaryTicker || result?.query || query} on-chain analysis`); handleSearch(`${primaryTicker || result?.query || query} on-chain analysis`) }}>
                {spectreIcons.discover}
                <span>{t('searchEngine.quickLink.onChain', 'On-Chain Data')}</span>
                {spectreIcons.chevronRight}
              </button>
            </div>

            {/* Thesis Card */}
            {parsed.thesis && (
              <div className="se-thesis-card" style={{ '--cls-color': cls.color }}>
                <div className="se-thesis-card-header">
                  <span className="se-thesis-card-label">{t('searchEngine.section.thesis', 'Thesis')}</span>
                </div>
                <div className="se-thesis-card-body">
                  {renderMarkdown(parsed.thesis)}
                </div>
              </div>
            )}

            {/* Verdict Card */}
            {parsed.verdict && (
              <div className="se-verdict-card" style={{ '--cls-color': cls.color }}>
                <div className="se-verdict-card-header">
                  <span className="se-verdict-card-label">{t('searchEngine.section.verdict', 'Verdict')}</span>
                </div>
                <div className="se-verdict-card-body">
                  {renderMarkdown(parsed.verdict)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Full-width footer: Related Searches ── */}
        {relatedSearches.length > 0 && (
          <div className="se-results-footer">
            <div className="se-section-header">
              <span className="se-section-tag">{t('searchEngine.section.relatedSearches', 'RELATED SEARCHES')}</span>
              <span className="se-section-line" />
            </div>
            <div className="se-related-chips">
              {relatedSearches.map((rq) => (
                <button key={`rel-${rq}`} className="se-related-chip" onClick={() => { setQuery(rq); handleSearch(rq) }}>
                  {spectreIcons.search}
                  <span>{rq}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
