/**
 * CommandPalette — Mod+K spotlight for the trading terminal.
 *
 * Iteration 8 redesign: pure token search.
 *   - Centered glass modal on a blurred-scrim overlay
 *   - Adaptive `--accent*` channel everywhere (no static lime)
 *   - Sections:
 *       • query empty + recents present  → RECENT then TRENDING
 *       • query empty + no recents       → TRENDING only
 *       • query present                  → RESULTS (with optional
 *                                          synthetic "Go to address" row)
 *   - Rich `<TokenSearchRow>` rows: <TokenLogo> + identity +
 *     <Sparkline> (when data present) + price + <DeltaChip>
 *   - Keyboard: ↑/↓ navigate, ↵ select, Esc close
 *   - Reduced-motion toggle moved to UserDashboard settings
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { Search, X } from 'lucide-react'
import { useTokenSearch, useTrendingTokens, prefetchTokenDetails, prefetchChartBars } from '../../../hooks/useCodexData'
import { TRENDING_TICKER_CHAIN_IDS, useTickerTokens } from '../../../utils/trendingFilter'
import { searchLocalMajors } from '../../../lib/majorTokens'
import { inferNetworkId, fetchTokenDetailsBatch } from '../../../services/codexApi'
import useSettingsStore from '../../../store/useSettingsStore'
import KeycapChip from '../KeycapChip'
import TokenSearchRow from './TokenSearchRow'
import './palette.css'

// Address-shape detectors used to surface the synthetic "Go to address" row.
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// Module-level enrichment cache. Some rows arrive from Codex search /
// from the persisted recents list missing marketCap or volume24h
// (recents don't carry them historically; the search endpoint omits
// volume for some tokens like SPECTRE). When visible rows lack these
// fields, ONE fetchTokenDetailsBatch call covers all of them (the old
// per-row getDetailedTokenInfo waterfall fired N requests per palette
// open), cached 60s, then the palette re-renders with the enriched data.
const _paletteEnrich = new Map() // addr_lower -> { marketCap, volume24h, price, change, logo, ts }
const _paletteEnrichInflight = new Set() // addr_lower currently inside a batch
const ENRICH_TTL = 60_000

async function fetchEnrichmentBatch(tokens) {
  const wanted = []
  for (const t of tokens) {
    const key = (t.address || '').toLowerCase()
    if (!key || _paletteEnrichInflight.has(key)) continue
    _paletteEnrichInflight.add(key)
    wanted.push({ address: t.address, networkId: t.networkId || 1, key })
  }
  if (!wanted.length) return false
  try {
    const map = await fetchTokenDetailsBatch(wanted)
    let any = false
    for (const w of wanted) {
      const details = map?.[w.key]
      if (!details) continue
      _paletteEnrich.set(w.key, {
        marketCap: parseFloat(details.marketCap) || 0,
        volume24h: parseFloat(details.volume24h || details.volume24 || details.volume) || 0,
        price: parseFloat(details.priceUSD || details.price) || 0,
        change: parseFloat(details.change24 || details.change) || 0,
        logo: details.logo || details.imageThumbUrl || details.info?.imageThumbUrl || '',
        ts: Date.now(),
      })
      any = true
    }
    return any
  } catch {
    return false
  } finally {
    for (const w of wanted) _paletteEnrichInflight.delete(w.key)
  }
}

function detectAddress(raw) {
  const v = (raw || '').trim()
  if (EVM_ADDRESS_RE.test(v)) return { address: v, chainId: 1 }
  if (SOL_ADDRESS_RE.test(v)) return { address: v, chainId: 1399811149 }
  return null
}

function mergeResults(localList, apiList) {
  // Map API results by lowercased address for O(1) lookup.
  const apiByAddress = new Map()
  for (const r of apiList || []) {
    const a = (r.address || '').toLowerCase()
    if (!a) continue
    apiByAddress.set(a, {
      symbol: r.symbol,
      name: r.name,
      address: r.address,
      networkId: r.networkId,
      logo: r.logo || '',
      price: r.price || 0,
      change: r.change || 0,
      marketCap: r.marketCap || 0,
      // Pull volume from any of the field names Codex uses.
      volume24h: r.volume24h || r.volume24 || r.volume || 0,
      _source: 'codex',
    })
  }

  // Enrich local entries with API data when addresses match. Local
  // majors carry only { symbol, name, address, networkId } — no logo,
  // no price, no MC, no volume. When the API has a hit for the same
  // address, merge its live data IN so the row renders fully populated
  // instead of showing a letter-fallback + empty columns.
  // We keep the local entry's curated `name` (e.g. "Spectre AI" is
  // hand-set), but take everything else from the API where present.
  const enrichedLocals = localList.map((t) => {
    const a = (t.address || '').toLowerCase()
    const api = a && apiByAddress.get(a)
    if (!api) return t
    return {
      ...api,
      // Prefer curated symbol + name when they exist (the local list is
      // the source of truth for major-token branding).
      symbol: t.symbol || api.symbol,
      name: t.name || api.name,
      networkId: t.networkId || api.networkId,
      // Mark consumed so we don't list the same address twice below.
      _consumedFromApi: true,
    }
  })

  // Mark consumed addresses so they don't appear again in the extras.
  const consumed = new Set(
    enrichedLocals
      .filter((t) => t._consumedFromApi)
      .map((t) => (t.address || '').toLowerCase())
  )

  const extras = []
  for (const [addr, entry] of apiByAddress) {
    if (!consumed.has(addr)) extras.push(entry)
  }

  return [...enrichedLocals, ...extras]
}

function CommandPalette({ isOpen, onClose, onSelectToken }) {
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const lastFocusRef = useRef(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const { results: apiResults, loading } = useTokenSearch(isOpen ? query : '', 200)
  // Trending — mirror the header TokenTicker EXACTLY. The ticker publishes
  // its computed set (already filtered, deduped, chain-scoped) and we read
  // it here so the two surfaces always show the identical tokens in the
  // same order. The own useTrendingTokens fetch below is the fallback (used
  // when the palette opens before the ticker has mounted) and also serves
  // as the re-render trigger so the memo re-reads the latest ticker set on
  // each poll.
  // '24h' matches the ticker + Discover so all three share one cache key, and
  // the cold fallback trusts the server exactly as they do - running the old
  // client filter here meant that opening the palette BEFORE the ticker mounted
  // showed a different, volume-re-sorted list than opening it a second later.
  const { tokens: rawTrending } = useTrendingTokens(120000, TRENDING_TICKER_CHAIN_IDS, '24h')
  const tickerTokens = useTickerTokens()
  const trendingTokens = useMemo(
    () => {
      if (tickerTokens && tickerTokens.length > 0) return tickerTokens.slice(0, 20)
      return (Array.isArray(rawTrending) ? rawTrending : [])
        .filter((t) => t && t.symbol && (parseFloat(t.price) || 0) > 0)
        .slice(0, 20)
    },
    [tickerTokens, rawTrending]
  )
  const recentTokens = useSettingsStore((s) => s.recentTokens)
  const pushRecentToken = useSettingsStore((s) => s.pushRecentToken)
  const clearRecentTokens = useSettingsStore((s) => s.clearRecentTokens)

  // ---- Section composition ----------------------------------------------
  const sections = useMemo(() => {
    const trimmed = query.trim()
    const out = []

    if (!trimmed) {
      // Empty query → RECENT (if any) then TRENDING
      if (recentTokens && recentTokens.length > 0) {
        out.push({
          id: 'recent',
          label: 'Recent',
          headerAction: { label: 'Clear', onClick: () => clearRecentTokens() },
          items: recentTokens.map((t) => ({ kind: 'token', token: t })),
        })
      }
      if (trendingTokens && trendingTokens.length > 0) {
        out.push({
          id: 'trending',
          label: 'Trending',
          items: trendingTokens.slice(0, 8).map((t) => ({ kind: 'token', token: t })),
        })
      }
      return out
    }

    const items = []

    // Paste-an-address detection — prepend a synthetic row at the top.
    const detected = detectAddress(trimmed)
    if (detected) {
      items.push({ kind: 'address', ...detected })
    }

    const local = searchLocalMajors(trimmed)
    const merged = mergeResults(local, apiResults)
    for (const t of merged) {
      // Don't double-list the address as both synthetic + matched token.
      if (detected && (t.address || '').toLowerCase() === detected.address.toLowerCase()) continue
      items.push({ kind: 'token', token: t })
    }

    if (items.length) {
      out.push({
        id: 'results',
        label: loading ? 'Searching tokens…' : `Results (${items.length})`,
        items,
      })
    }
    return out
  }, [query, apiResults, loading, recentTokens, trendingTokens, clearRecentTokens])

  // Flat list for arrow-key nav
  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections])

  // Enrichment — for all visible token rows missing marketCap OR volume24h,
  // ONE batched details request (was N getDetailedTokenInfo waterfalls).
  // Triggers a re-render via the local `enrichTick` state when it lands.
  const [enrichTick, setEnrichTick] = useState(0)
  useEffect(() => {
    if (!isOpen) return
    const tokensNeeding = flatItems
      .filter((it) => it.kind === 'token')
      .map((it) => it.token)
      .filter((t) => {
        if (!t?.address) return false
        const key = t.address.toLowerCase()
        const cached = _paletteEnrich.get(key)
        if (cached && Date.now() - cached.ts < ENRICH_TTL) return false
        // Refresh EVERY visible row that isn't fresh-cached (still one batched
        // request). The old `missing MC/VOL only` gate skipped recents that
        // carried full click-time data - so a recent's price could sit days
        // stale on screen and never refresh (the "wrong prices" report).
        return true
      })
      .slice(0, 20)
    if (!tokensNeeding.length) return

    let cancelled = false
    fetchEnrichmentBatch(tokensNeeding).then((any) => {
      if (!cancelled && any) setEnrichTick((n) => n + 1)
    })
    return () => { cancelled = true }
  }, [flatItems, isOpen])

  // Build an enrichment lookup map for the current render — addresses
  // → cached enrichment record. The `enrichTick` dep makes this rebuild
  // when new entries land in the cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enrichmentMap = useMemo(() => {
    const m = new Map()
    for (const it of flatItems) {
      if (it.kind !== 'token' || !it.token?.address) continue
      const cached = _paletteEnrich.get(it.token.address.toLowerCase())
      if (cached) m.set(it.token.address.toLowerCase(), cached)
    }
    return m
  }, [flatItems, enrichTick])

  // Reset active row whenever results shift
  useEffect(() => {
    setActiveIndex(0)
  }, [query, sections.length])

  // Clear query when palette closes (next open is a fresh slate)
  useEffect(() => {
    if (!isOpen) setQuery('')
  }, [isOpen])

  // Capture the element that opened us so we can return focus on close.
  // Then autofocus the palette input.
  useEffect(() => {
    if (!isOpen) return
    lastFocusRef.current = document.activeElement
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select?.()
    })
    return () => {
      cancelAnimationFrame(raf)
      const el = lastFocusRef.current
      if (el && typeof el.focus === 'function') {
        requestAnimationFrame(() => el.focus())
      }
    }
  }, [isOpen])

  // Scroll active row into view
  useEffect(() => {
    if (!isOpen) return
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('.cmdk-row.is-active')
    if (active) active.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, isOpen])

  // Prefetch-on-highlight: after a 150ms dwell on a token row (arrow keys or
  // hover), warm the details + chart-bars caches so Enter lands on warm data
  // and the token page paints instantly. Both prefetch fns are cache- and
  // inflight-guarded internally; the dwell timer means rapid arrow-key travel
  // fires nothing, and the per-session set stops repeat fires on re-highlight.
  const prefetchedRef = useRef(new Set())
  useEffect(() => {
    if (!isOpen) return
    const item = flatItems[activeIndex]
    if (!item || item.kind !== 'token' || !item.token?.address) return
    const t = item.token
    const nid = inferNetworkId(t.address, t.networkId)
    const key = `${String(t.address).toLowerCase()}:${nid}`
    if (prefetchedRef.current.has(key)) return
    const timer = setTimeout(() => {
      prefetchedRef.current.add(key)
      try {
        prefetchTokenDetails(t.address, nid)
        prefetchChartBars(t.address, nid)
      } catch { /* prefetch is best-effort */ }
    }, 150)
    return () => clearTimeout(timer)
  }, [activeIndex, flatItems, isOpen])

  const handleSelect = useCallback(
    (item) => {
      if (!item) return
      if (item.kind === 'token') {
        const t = item.token
        const nid = inferNetworkId(t.address, t.networkId)
        // Pull enriched data when the visible row was missing MC / VOL —
        // this is the data we'll persist into recents so the next palette
        // open shows fully populated rows for tokens we just clicked.
        const enrich = _paletteEnrich.get((t.address || '').toLowerCase())
        // Persist the FRESHEST snapshot into recents (enrichment is <=60s old;
        // t.price may itself be a previous click-time value on a recents row).
        const enrichFresh = enrich && enrich.price > 0
        pushRecentToken({
          symbol: t.symbol,
          name: t.name,
          address: t.address,
          networkId: nid,
          logo: t.logo || enrich?.logo || '',
          price: enrichFresh ? enrich.price : (t.price || 0),
          change: enrichFresh ? enrich.change : (t.change || 0),
          marketCap: enrich?.marketCap || t.marketCap || 0,
          volume24h: enrich?.volume24h || t.volume24h || 0,
          sparkline7d: Array.isArray(t.sparkline7d) ? t.sparkline7d : undefined,
        })
        onSelectToken?.(
          {
            symbol: t.symbol,
            name: t.name,
            address: t.address,
            networkId: nid,
            price: t.price || 0,
            change: t.change || 0,
            logo: t.logo || '',
          },
          'palette'
        )
        onClose?.()
        return
      }
      if (item.kind === 'address') {
        // Synthetic paste row — open the token by address.
        onSelectToken?.(
          {
            symbol: 'UNKNOWN',
            name: '',
            address: item.address,
            networkId: item.chainId,
            price: 0,
            change: 0,
            logo: '',
          },
          'palette-address'
        )
        onClose?.()
      }
    },
    [onSelectToken, pushRecentToken, onClose]
  )

  // Local keyboard nav (only while open)
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (flatItems.length ? Math.min(flatItems.length - 1, i + 1) : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSelect(flatItems[activeIndex])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, flatItems, activeIndex, handleSelect, onClose])

  // `aria-hidden` the app shell while open so the portalled palette is the
  // only thing screen readers see. Palette renders OUTSIDE .app via portal,
  // so this is safe (the palette itself stays accessible).
  useEffect(() => {
    if (!isOpen) return
    const root = document.querySelector('.app')
    if (!root) return
    root.setAttribute('aria-hidden', 'true')
    document.body.classList.add('cmdk-open')
    return () => {
      root.removeAttribute('aria-hidden')
      document.body.classList.remove('cmdk-open')
    }
  }, [isOpen])

  if (!isOpen) return null

  // Render flat items in one virtual stream so activeIndex maps cleanly.
  let runningIndex = -1

  return ReactDOM.createPortal(
    <div className="cmdk-scrim" onMouseDown={onClose} role="presentation">
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdk-search">
          <Search size={22} strokeWidth={1.75} className="cmdk-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="cmdk-input"
            placeholder="Search tokens by name, symbol or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {query && (
            <button
              type="button"
              className="cmdk-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            className="cmdk-search-esc-btn"
            onClick={onClose}
            aria-label="Close search"
          >
            <KeycapChip className="cmdk-search-esc" size="sm">esc</KeycapChip>
          </button>
        </div>

        <div className="cmdk-results" ref={listRef}>
          {sections.length === 0 && query.trim() && !loading && (
            <div className="cmdk-empty">
              <span className="cmdk-empty-title">No matches for "{query}"</span>
              <span className="cmdk-empty-hint">Try a symbol or paste a contract address.</span>
            </div>
          )}
          {sections.length === 0 && query.trim() && loading && (
            <div className="cmdk-empty">
              <span className="cmdk-empty-title">Searching…</span>
            </div>
          )}
          {sections.length === 0 && !query.trim() && (
            <div className="cmdk-empty">
              <span className="cmdk-empty-title">Loading trending tokens…</span>
            </div>
          )}

          {sections.map((section) => (
            <div key={section.id} className="cmdk-section">
              <div className="cmdk-section-header">
                <span className="cmdk-section-label">{section.label}</span>
                {section.headerAction && (
                  <button
                    type="button"
                    className="cmdk-section-action"
                    onClick={section.headerAction.onClick}
                  >
                    {section.headerAction.label}
                  </button>
                )}
              </div>
              <ul className="cmdk-list" role="listbox">
                {section.items.map((item, idx) => {
                  runningIndex += 1
                  const active = runningIndex === activeIndex
                  const rowIdx = runningIndex
                  const key = item.kind === 'address'
                    ? `addr-${item.address}`
                    : `tok-${item.token.address || `${item.token.symbol}-${idx}`}`

                  // Fold any cached enrichment into the token so MC / VOL
                  // / price / change / logo fill in as soon as the fetch
                  // returns (recents from localStorage often arrive empty,
                  // and Codex search omits VOL for some tokens).
                  let renderToken = item.token
                  if (item.kind === 'token' && item.token?.address) {
                    const enrich = enrichmentMap.get(item.token.address.toLowerCase())
                    if (enrich) {
                      // Enrichment is <=60s old; the token's own values can be
                      // click-time recents persisted days ago. FRESH wins - the
                      // old `token || enrich` order kept stale nonzero prices
                      // on screen forever. change only rides a fresh price
                      // (price 0 = the batch had no market data for this row).
                      const fresh = enrich.price > 0
                      renderToken = {
                        ...item.token,
                        logo: item.token.logo || enrich.logo,
                        price: fresh ? enrich.price : item.token.price,
                        change: fresh ? enrich.change : item.token.change,
                        marketCap: enrich.marketCap || item.token.marketCap,
                        volume24h: enrich.volume24h || item.token.volume24h,
                      }
                    }
                  }

                  return (
                    <TokenSearchRow
                      key={key}
                      kind={item.kind}
                      token={renderToken}
                      address={item.address}
                      chainId={item.chainId}
                      active={active}
                      onMouseEnter={() => setActiveIndex(rowIdx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelect(item)}
                    />
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="cmdk-footer">
          <span className="cmdk-foot-cue">
            <KeycapChip size="sm">↑</KeycapChip>
            <KeycapChip size="sm">↓</KeycapChip>
            <span className="cmdk-foot-label">navigate</span>
          </span>
          <span className="cmdk-foot-cue">
            <KeycapChip size="sm">↵</KeycapChip>
            <span className="cmdk-foot-label">select</span>
          </span>
          <span className="cmdk-foot-cue">
            <KeycapChip size="sm">esc</KeycapChip>
            <span className="cmdk-foot-label">close</span>
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CommandPalette
