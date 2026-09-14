/**
 * MobileSearchOverlay — Fullscreen mobile search experience.
 * Layout: [← back] [🔍 search input]
 *         Recent Searches (from localStorage 'searchHistoryTokens')
 *         ─── divider ───
 *         Search results (/fetch_tokens via useTokenSearch)
 *
 * CSS VALUES SOURCE MAP:
 * - Input: header.css .search-input-bar (radius 9999px, bg 0.03, border 0.05)
 * - Result rows: header.css .token-card-v2 (gap 12px, bg 0.015, border 0.03, radius 14px)
 * - Logo: header.css .token-logo-v2 (40px→32px mobile, radius 10px, border 0.08)
 * - Group label: nav-sidebar .nav-category-header (10px/600, 0.10em, uppercase)
 * - Divider: side-drawer-divider (gradient fade 90deg)
 * - Back btn: navigation-sidebar-link (radius 10px, border transparent)
 */
import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { spectreIcons } from '@/icons/spectreIcons'
import { useTokenSearch } from '@/hooks/useCodexData'
import { chainToDisplayName, SEARCH_MIN_QUERY_LENGTH } from '@/hooks/codex/_shared'
import { fetchCgMarketsByIds, getCgSearchHits } from '@/services/cgSearchService'
import { mergeTokenSearchResults } from '@/lib/search-merge'
import { useCurrency } from '@/hooks/useCurrency'
import { useCopyToast } from '@/contexts/CopyToastContext'
import { useWhisperSearch } from '@/hooks/useWhisperSearch'
import { usePageSearch } from '@/hooks/usePageSearch'
import WhisperResults from './whisper-results'
import PageResults from './page-results'
import { isDev } from '@/utils/env'
import './mobile-search-overlay.css'
import useBackDismiss from '@/hooks/use-back-dismiss'

const ArrowUpIcon = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)

const ArrowDownIcon = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M5 12l7 7 7-7" />
  </svg>
)

function normalizePct(change) {
  // Every source that feeds this row (CG usd_24h_change via details-batch,
  // Codex, search results) is already in PERCENT form (e.g. 10.36, 0.65). The
  // old "|n|>1 = already-percent, else *100" guess wrongly *100'd sub-1%
  // changes (a real +0.65% rendered as +65%).
  const n = Number(change)
  return Number.isFinite(n) ? n : 0
}

/* ═══════════════════════════════════════════════════════════════
   RECENT SEARCHES — shared localStorage key with desktop header
   ═══════════════════════════════════════════════════════════════ */
const STORAGE_KEY = 'searchHistoryTokens'

function getRecentTokens() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : []
  } catch { return [] }
}

function saveRecentTokens(tokens) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
}

function clearRecentTokens() {
  localStorage.removeItem(STORAGE_KEY)
}

function addToRecent(token, existing) {
  const entry = {
    symbol: token.symbol,
    name: token.name,
    logo: token.logo,
    price: token.price,
    change: token.change,
    ca: token.address || token.ca,
    networkId: token.networkId || 1,
    cgId: token.cgId || null,
    codexId: token.codexId || token.address || token.ca || null,
    tokenId: token.tokenId || null,
    isStock: token.isStock || false,
  }
  // Symbol compare strips the "$" prefix on-chain tickers carry — a "$PAAL"
  // result and a "PAAL" recent are the same asset and must not both persist.
  const symKey = (s) => String(s || '').toUpperCase().replace(/^\$+/, '')
  const updated = [
    entry,
    ...existing.filter(t => t.ca !== entry.ca && symKey(t.symbol) !== symKey(entry.symbol)),
  ].slice(0, 8)
  saveRecentTokens(updated)
  return updated
}

const MobileSearchOverlay = memo(({
  isOpen,
  onClose,
  onSelectToken,
  onSelectTokenAndOpen,
}) => {
  const { t } = useTranslation()
  useBackDismiss(isOpen, onClose)
  const [query, setQuery] = useState('')
  const [recentTokens, setRecentTokens] = useState([])
  const [recentLiveById, setRecentLiveById] = useState({})
  const [whisperMode, setWhisperMode] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  // Page Finder (Cmd-K style) — fuzzy-matches the query against PAGE_CATALOG
  // and renders a Pages section above token / whisper results.
  const { matches: pageMatches, mode: searchMode } = usePageSearch(query, { limit: 5 })
  const inputRef = useRef(null)
  const lastRefreshRef = useRef(0)
  const searchEnrichKeyRef = useRef('')
  const recognitionRef = useRef(null)
  const { fmtPrice, fmtLarge } = useCurrency()
  const { triggerCopyToast } = useCopyToast()

  // Token search — same shared hook desktop uses
  const {
    results: searchResults,
    loading: searchLoading,
    error: searchError,
    tooShort: searchTooShort,
    minQueryLength,
  } = useTokenSearch(
    whisperMode ? '' : query,
    // 2026-06-14: was 150ms — far too short (every keystroke fanned out to
    // multiple endpoints). 2026-07-06: aligned with the desktop header's
    // 450ms; prefix-cached results still render instantly.
    450,
  )

  // Whisper AI search — natural-language → AI-parsed market search
  const {
    data: whisperData,
    loading: whisperLoading,
    error: whisperError,
    search: whisperSearch,
    clear: whisperClear,
  } = useWhisperSearch()

  // 2026-06-02 cost defense: mirror the header header.jsx K8 fix. Switched
  // from N parallel /details to ONE /details-batch call so the Phase K
  // snapshot read path covers majors at zero cost and only DEX-only misses
  // fall to one shared filterTokens(tokens:[...]) call.
  //
  // enrichLive fetches ONE /details-batch for any on-chain rows (ca/address)
  // and folds fresh { price, change24, marketCap, volume } into liveById,
  // keyed by ca||address. Used by BOTH recents and search results so a search
  // row shows a real mcap + a consistent 24h change instead of a bare row.
  const enrichLive = useCallback((tokens) => {
    // CG-canonical rows (cgId) refresh from CG markets — refreshing them by
    // contract painted the WRAPPED deployment's stats onto the canonical
    // asset (recent "ETH" carries the WETH contract → WETH mcap/volume).
    // The live map keys on ca||address||cgId, matching renderTokenRow.
    const cgRows = (tokens || []).filter(t => t.cgId && !t.isStock)
    if (cgRows.length > 0) {
      fetchCgMarketsByIds([...new Set(cgRows.map(t => t.cgId))])
        .then(byId => {
          if (!byId || byId.size === 0) return
          setRecentLiveById(prev => {
            const next = { ...prev }
            for (const t of cgRows) {
              const row = byId.get(t.cgId)
              if (!row) continue
              const key = t.ca || t.address || t.cgId
              next[key] = {
                price: Number(row.current_price) || 0,
                change: Number(row.price_change_percentage_24h) || 0,
                marketCap: Number(row.market_cap) || 0,
                volume: Number(row.total_volume) || 0,
                liquidity: 0,
              }
            }
            return next
          })
        })
        .catch(() => { /* silent */ })
    }
    // Contract-only rows (no cgId) go through ONE /details-batch call.
    const withKey = (tokens || []).filter(t => (t.ca || t.address) && !t.cgId)
    const ids = withKey
      .map(t => `${t.ca || t.address}:${t.networkId || 1}`)
      .join(',')
    if (!ids) return
    const batchUrl = isDev
      ? `/api/token/details-batch?ids=${encodeURIComponent(ids)}`
      : `/api/codex?action=details-batch&ids=${encodeURIComponent(ids)}`
    fetch(batchUrl)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || typeof data !== 'object') return
        const rows = data.tokens || data
        setRecentLiveById(prev => {
          const next = { ...prev }
          for (const t of withKey) {
            const key = t.ca || t.address
            const row = rows[key.toLowerCase()] || rows[key]
            if (!row || row.price === undefined) continue
            next[key] = {
              price: row.price || 0,
              change: row.change24 || 0,
              marketCap: row.marketCap || 0,
              volume: row.volume24 || 0,
              liquidity: row.liquidity || 0,
            }
          }
          return next
        })
      })
      .catch(() => { /* silent */ })
  }, [])

  // Recents refresh - throttled to once / 20s (fires on open + re-open).
  const refreshRecentLive = useCallback((tokens) => {
    const now = Date.now()
    if (now - lastRefreshRef.current < 20_000) return
    if (!tokens || tokens.length === 0) return
    lastRefreshRef.current = now
    enrichLive(tokens)
  }, [enrichLive])

  // Rank on the numbers we are about to SHOW, not on the ones the row arrived
  // with. Identity rows come from the box with no price/mcap at all, so the
  // hook ranks them at zero and enrichLive fills them in a moment later — the
  // list then read as unsorted (six blank rows above the real ETH; USDT's
  // $183B under a $28M token). Folding the live map back in before the shared
  // sort makes the order match the numbers on screen. Same shared rule
  // (_sortSearchResults) the hook and the desktop header use.
  // CoinGecko-canonical hits — the lane the desktop header has always had and
  // this overlay never did. That single gap is why the two surfaces disagreed:
  // desktop folds these over the composer's rows (canonical name, logo and
  // NUMBERS), mobile rendered the composer's rows as they came, so a DEX read
  // could stand where the listing's own figure belonged. Shared 60s module
  // cache, so on a device that already searched from the header it is free.
  const [cgSearchHits, setCgSearchHits] = useState([])
  useEffect(() => {
    const q = (query || '').trim()
    if (whisperMode || q.length < SEARCH_MIN_QUERY_LENGTH) { setCgSearchHits([]); return }
    let cancelled = false
    getCgSearchHits(q)
      .then((hits) => { if (!cancelled) setCgSearchHits(hits || []) })
      .catch(() => { /* best effort — the composer rows still render */ })
    return () => { cancelled = true }
  }, [query, whisperMode])

  // ONE merge pipeline for every search surface (lib/search-merge.js): dust
  // filter, CG-canonical rows above ticker impostors, same-asset folding and
  // the stale-CG demotion. Header, welcome and watchlists have used it since
  // the July audit; the overlay is the last one to adopt it, which is why its
  // list was longer, ordered differently and could show a different market cap
  // for the same token. Kept out of the live-value fold below so the enrich
  // effect has a stable input.
  const mergedResults = useMemo(() => {
    const rows = searchResults || []
    if (rows.length === 0 && cgSearchHits.length === 0) return []
    const liveRows = rows.map((r) => ({
      ...r,
      price: r.price || r.priceUSD || 0,
      change: r.change ?? r.change24 ?? 0,
      volume: r.volume || r.volume24 || 0,
    }))
    const merged = mergeTokenSearchResults({
      query: (query || '').trim(),
      majorRows: [],
      cgHits: cgSearchHits,
      liveRows,
    })
    return merged.length > 0 ? merged : liveRows
  }, [searchResults, cgSearchHits, query])

  // Enrich search-result rows the same way recents are enriched: one
  // /details-batch per settled result set fills mcap + a fresh 24h change for
  // on-chain tokens (Spectre identity rows arrive with no price/mcap). Guarded
  // by an id-set ref so re-renders don't refire the same batch.
  useEffect(() => {
    if (whisperMode || mergedResults.length === 0) return
    const withKey = mergedResults.filter(t => t.ca || t.address || t.cgId)
    if (withKey.length === 0) return
    const key = withKey.map(t => `${t.ca || t.address || t.cgId}:${t.networkId || 1}`).join(',')
    if (!key || key === searchEnrichKeyRef.current) return
    searchEnrichKeyRef.current = key
    enrichLive(withKey)
  }, [mergedResults, whisperMode, enrichLive])

  // Paint the numbers the live refresh has landed, without re-ordering: the
  // merge above already ranked on real CoinGecko figures.
  const rankedResults = useMemo(() => {
    if (mergedResults.length === 0) return mergedResults
    if (!recentLiveById || Object.keys(recentLiveById).length === 0) return mergedResults
    return mergedResults.map((r) => {
      const live = recentLiveById[r.ca || r.address || r.cgId]
      if (!live) return r
      return {
        ...r,
        price: live.price || r.price,
        change: live.change ?? r.change,
        marketCap: live.marketCap || r.marketCap,
        volume: live.volume || r.volume,
      }
    })
  }, [mergedResults, recentLiveById])

  // Load recents when opened
  useEffect(() => {
    if (isOpen) {
      const loaded = getRecentTokens()
      setRecentTokens(loaded)
      refreshRecentLive(loaded)
      // Auto-focus with delay for smooth animation
      const timer = setTimeout(() => inputRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
    // Reset on close
    setQuery('')
  }, [isOpen, refreshRecentLive])

  // Lock body scroll
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Stop any in-flight recognition helper (shared by listener + cleanup)
  const stopVoice = useCallback(() => {
    try { recognitionRef.current?.stop() } catch { /* noop */ }
    recognitionRef.current = null
    setVoiceListening(false)
  }, [])

  // Voice search — listens for `open-voice-search` dispatched by MobileHeader.
  // Must start synchronously in the event handler to preserve the user-gesture
  // chain required by iOS/Android Web Speech API.
  useEffect(() => {
    const handleOpenVoice = () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SpeechRecognition) return
      stopVoice()
      const recognition = new SpeechRecognition()
      recognition.lang = 'en-US'
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.continuous = false
      recognitionRef.current = recognition
      recognition.onstart = () => setVoiceListening(true)
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results).map(r => r[0].transcript).join('')
        setQuery(transcript)
      }
      recognition.onerror = () => setVoiceListening(false)
      recognition.onend = () => setVoiceListening(false)
      try { recognition.start() } catch { /* noop */ }
    }
    window.addEventListener('open-voice-search', handleOpenVoice)
    return () => {
      window.removeEventListener('open-voice-search', handleOpenVoice)
      stopVoice()
    }
  }, [stopVoice])

  // Stop voice when overlay closes
  useEffect(() => {
    if (!isOpen) stopVoice()
  }, [isOpen, stopVoice])

  const handleTokenSelect = useCallback((token) => {
    const updated = addToRecent(token, recentTokens)
    setRecentTokens(updated)

    if (onSelectTokenAndOpen) {
      onSelectTokenAndOpen(token)
    } else if (onSelectToken) {
      onSelectToken(token)
    }
    onClose()
  }, [recentTokens, onSelectToken, onSelectTokenAndOpen, onClose])

  const handleClearRecent = useCallback(() => {
    clearRecentTokens()
    setRecentTokens([])
  }, [])

  const handleCopyAddress = useCallback((e, address) => {
    e.stopPropagation()
    e.preventDefault()
    if (!address) return
    try {
      navigator.clipboard.writeText(address)
      triggerCopyToast()
    } catch { /* noop */ }
  }, [triggerCopyToast])

  const renderTokenRow = useCallback((token, i, context) => {
    const ca = token.ca || token.address
    const liveKey = ca || token.cgId
    const live = liveKey ? recentLiveById[liveKey] : null
    const price = live?.price ?? token.price
    // Recents snapshot a token's change into localStorage when first viewed;
    // that snapshot goes stale fast on movers (a pumped token shows an old
    // -21% next to a live +10%). For recents use ONLY the live-refreshed
    // value — show nothing until it lands rather than a wrong stale number.
    // Search-result rows carry a fresh change from the query, so keep theirs.
    const change = context === 'recent' ? (live?.change ?? null) : (live?.change ?? token.change)
    const marketCap = live?.marketCap ?? token.marketCap ?? null
    const volume = live?.volume ?? token.volume ?? null
    // Gate on > 0, not != null: on-chain search rows arrive with marketCap/
    // volume 0 until the details-batch enrichment lands, and `!= null`
    // rendered a bogus "MC $0 · Vol $0" instead of hiding the meta line.
    // A string here means a PREFORMATTED display value (recents store "$1.2M").
    // But the search composer also hands numbers over as strings — "121255.52"
    // — and passing those straight through printed a raw, unrounded, symbol-less
    // "Vol 121255.52" next to a neighbouring "Vol $55.78B". Only a string that
    // is not a number is preformatted.
    const preformatted = (v) => typeof v === 'string' && !Number.isFinite(Number(v))
    const mcapStr = preformatted(token.mcap)
      ? token.mcap
      : (Number(marketCap) > 0 ? fmtLarge(marketCap) : null)
    const liquidityStr = preformatted(token.liquidity)
      ? token.liquidity
      : (Number(volume) > 0 ? fmtLarge(volume) : (Number(token.liquidity) > 0 ? fmtLarge(token.liquidity) : null))
    const hasPrice = price != null && price > 0
    const pct = change != null ? normalizePct(change) : null
    // networkId fallback: some rows carry the numeric chain id but no display
    // name (older recents, CG rows enriched with a contract).
    const network = token.isStock ? token.exchange : (token.network || chainToDisplayName(token.networkId))
    const isPositive = (pct ?? 0) >= 0

    return (
      <button
        key={`${context}-${token.symbol}-${ca || i}`}
        type="button"
        className="mso-token-row"
        style={{ animationDelay: `${40 + i * 30}ms` }}
        onClick={() => handleTokenSelect({
          ...token,
          ca: ca,
          price,
          change,
          marketCap,
          volume,
        })}
      >
        {token.logo ? (
          <img
            src={token.logo}
            alt=""
            className="mso-token-logo"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex' }}
          />
        ) : null}
        <div
          className="mso-token-logo mso-token-logo-fallback"
          style={token.logo ? { display: 'none' } : undefined}
        >
          {token.symbol?.[0] || '?'}
        </div>

        <div className="mso-token-info">
          <div className="mso-token-info-row">
            <span className="mso-token-symbol">{token.symbol}</span>
            {network && <span className="mso-token-network">{network}</span>}
          </div>
          <span className="mso-token-name">{token.name}</span>
          {token.isStock ? (
            token.sector && (
              <span className="mso-token-address mso-token-address-static">{token.sector}</span>
            )
          ) : (
            ca && (
              <span
                className="mso-token-address"
                title="Tap to copy"
                onClick={(e) => handleCopyAddress(e, ca)}
              >
                {ca.substring(0, 5)}...{ca.slice(-4)}
              </span>
            )
          )}
        </div>

        {hasPrice && (
          <div className="mso-token-stats">
            <div className="mso-price-row">
              <span className="mso-token-price">{fmtPrice(price)}</span>
              {pct != null && (
                <span className={`mso-token-change${isPositive ? ' positive' : ' negative'}`}>
                  {isPositive ? <ArrowUpIcon /> : <ArrowDownIcon />}
                  {Math.abs(pct).toFixed(2)}%
                </span>
              )}
            </div>
            {(mcapStr || liquidityStr) && (
              <div className="mso-meta-row">
                {mcapStr && <span className="mso-token-meta">MC {mcapStr}</span>}
                {mcapStr && liquidityStr && <span className="mso-meta-sep" aria-hidden>·</span>}
                {liquidityStr && <span className="mso-token-meta">Vol {liquidityStr}</span>}
              </div>
            )}
          </div>
        )}
      </button>
    )
  }, [recentLiveById, fmtPrice, fmtLarge, handleTokenSelect, handleCopyAddress])

  const hasQuery = query.trim().length > 0

  return (
    <div className={`mobile-search-overlay${isOpen ? ' is-open' : ''}`}>

      {/* ── Header bar — back + input ── */}
      <div className="mso-header">
        <button
          type="button"
          className="mso-back"
          onClick={onClose}
          aria-label="Close search"
        >
          {spectreIcons.chevronLeft}
        </button>

        <div className={`mso-input-wrap${whisperMode ? ' mso-whisper-glow' : ''}`}>
          <span className={`mso-search-icon${whisperMode ? ' mso-search-icon-whisper' : ''}`}>
            {whisperMode ? (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
                <path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 20 12 16.27 7.82 20l1.09-6.83L3.82 9.27l6.09-1.01L12 2z" />
              </svg>
            ) : (
              spectreIcons.search
            )}
          </span>

          {whisperMode && (
            <div className="mso-whisper-badges">
              <span className="mso-whisper-ai-badge">AI</span>
              {whisperData && (
                <span className={`mso-whisper-asset-pill ${whisperData.assetClass === 'stocks' ? 'stocks' : 'crypto'}`}>
                  {whisperData.assetClass === 'stocks' ? 'Stocks' : 'Crypto'}
                </span>
              )}
            </div>
          )}

          <input
            ref={inputRef}
            type="text"
            className="mso-input"
            placeholder={whisperMode ? t('mobileSearch.askWhisperAi', 'Ask Whisper AI…') : t('mobileSearch.searchTokensPages', 'Search tokens, pages...')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (whisperMode && e.key === 'Enter' && query.trim().length >= 3) {
                e.preventDefault()
                whisperSearch(query)
              }
            }}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            enterKeyHint={whisperMode ? 'search' : 'search'}
          />

          {/* Right-side action row — mirrors desktop: whisper · clear · close */}
          <div className="mso-input-actions">
            <button
              type="button"
              className={`mso-action-btn mso-whisper-toggle${whisperMode ? ' active' : ''}`}
              onClick={() => {
                setWhisperMode(prev => !prev)
                whisperClear()
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label={whisperMode ? 'Switch to standard search' : 'Whisper AI search'}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill={whisperMode ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={whisperMode ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 20 12 16.27 7.82 20l1.09-6.83L3.82 9.27l6.09-1.01L12 2z" />
              </svg>
            </button>

            {query && (
              <button
                type="button"
                className="mso-action-btn mso-clear-input"
                onClick={() => { setQuery(''); whisperClear(); inputRef.current?.focus() }}
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </button>
            )}

            <button
              type="button"
              className="mso-action-btn mso-close-btn"
              onClick={onClose}
              aria-label="Close (ESC)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mso-body">

        {/* Pages section — fuzzy match against PAGE_CATALOG.
            Shown for 'all' or 'pages' mode whenever we have matches. */}
        {(searchMode === 'all' || searchMode === 'pages') && pageMatches.length > 0 && (
          <div className="mso-pages-wrap">
            <PageResults matches={pageMatches} onClose={onClose} />
          </div>
        )}

        {/* Whisper AI mode — overrides standard results */}
        {whisperMode && (whisperLoading || whisperError || whisperData) && (
          <div className="mso-whisper-wrap">
            <WhisperResults
              data={whisperData}
              loading={whisperLoading}
              error={whisperError}
              onSelectToken={(token) => handleTokenSelect({
                symbol: token.symbol,
                name: token.name,
                logo: token.logo,
                price: token.price,
                change: token.change24h ?? token.change,
                ca: token.address || null,
                networkId: token.networkId || 1,
                network: token.network,
                marketCap: token.marketCap || null,
                volume: token.volume || null,
                liquidity: token.liquidity || null,
                cgId: token.cgId || null,
                codexId: token.codexId || token.address || null,
                tokenId: token.tokenId || null,
                isStock: false,
              })}
              onSelectStock={(stock) => handleTokenSelect({
                symbol: stock.symbol,
                name: stock.name,
                price: stock.price,
                change: stock.change24h ?? stock.change,
                exchange: stock.exchange,
                sector: stock.sector,
                marketCap: stock.marketCap,
                volume: stock.volume,
                isStock: true,
                assetClass: 'stock',
              })}
            />
          </div>
        )}

        {/* Whisper mode idle — prompt user */}
        {whisperMode && !whisperLoading && !whisperError && !whisperData && (
          <div className="mso-empty">
            <span className="mso-empty-icon">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                <path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 20 12 16.27 7.82 20l1.09-6.83L3.82 9.27l6.09-1.01L12 2z" />
              </svg>
            </span>
            <p className="mso-empty-text">{t('mobileSearch.askAnythingHint', 'Ask anything — "solana memes under $10M", "stocks with a P/E under 15"…')}</p>
          </div>
        )}

        {/* No query: show recent searches */}
        {!whisperMode && !hasQuery && recentTokens.length > 0 && (
          <>
            <div className="mso-section-header">
              <span className="mso-section-label">{t('mobileSearch.recentLive', 'RECENT (LIVE)')}</span>
              <button
                type="button"
                className="mso-clear-btn"
                onClick={handleClearRecent}
              >
                Clear
              </button>
            </div>

            {/* Divider — from side-drawer-divider */}
            <div className="mso-divider" />

            <div className="mso-token-list">
              {recentTokens.map((token, i) => renderTokenRow(token, i, 'recent'))}
            </div>
          </>
        )}

        {/* No query, no recents: empty state */}
        {!whisperMode && !hasQuery && recentTokens.length === 0 && (
          <div className="mso-empty">
            <span className="mso-empty-icon">{spectreIcons.search}</span>
            <p className="mso-empty-text">{t('mobileSearch.searchHint', 'Search tokens, wallets, or pages')}</p>
          </div>
        )}

        {/* Query active: search results */}
        {!whisperMode && hasQuery && (
          <>
            <div className="mso-section-header">
              <span className="mso-section-label">
                {searchLoading
                  ? 'SEARCHING...'
                  : (searchTooShort ? `TYPE ${minQueryLength}+ CHARS` : `RESULTS (${searchResults.length})`)}
              </span>
            </div>

            <div className="mso-divider" />

            {searchLoading && searchResults.length === 0 && (
              <div className="mso-shimmer-list">
                {[0,1,2,3].map((i) => (
                  <div key={i} className="mso-shimmer-row" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="mso-shimmer-logo animate-shimmer" />
                    <div className="mso-shimmer-info">
                      <div className="mso-shimmer-line-short animate-shimmer" />
                      <div className="mso-shimmer-line-long animate-shimmer" />
                    </div>
                    <div className="mso-shimmer-stats">
                      <div className="mso-shimmer-price animate-shimmer" />
                      <div className="mso-shimmer-change animate-shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!searchLoading && searchResults.length === 0 && (
              <div className="mso-empty">
                <p className="mso-empty-text">
                  {searchTooShort
                    ? `Type at least ${minQueryLength} characters to search tokens`
                    : (searchError ? `Search error: ${searchError}` : `No results for “${query}”`)}
                </p>
              </div>
            )}

            {/* Progressive paint: the hook clears stale rows per query and
                streams the fast Spectre lane in before the composer settles —
                render whatever is available even while loading. */}
            {rankedResults.length > 0 && (
              <div className="mso-token-list">
                {rankedResults.map((token, i) => renderTokenRow(token, i, 'search'))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

MobileSearchOverlay.displayName = 'MobileSearchOverlay'
export default MobileSearchOverlay
