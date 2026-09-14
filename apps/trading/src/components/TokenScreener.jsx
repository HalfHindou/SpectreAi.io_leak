/**
 * TokenScreener — the token-page left rail ("Living Market List").
 *
 * Shows the SAME tokens as the Discover page (TokenDiscoveryTable): both pull
 * from useMarketFeed (category + chain + timeframe over the shared Codex hooks),
 * so the rail mirrors Discover for the same selection. Two data modes:
 *   • Category mode (default) — useMarketFeed({ category, chainId, timeframe }).
 *     Categories, chains and timeframes match Discover exactly.
 *   • Filter mode (advanced) — when numeric range Filters are set, results come
 *     from useScreener (Codex filterTokens) instead.
 *
 * UI is the obsidian-terminal / RightPanel bento language: category + chain +
 * timeframe controls, and dense two-line row-cards with per-row alpha —
 * sparkline, change delta, a buy/sell pressure bar, age, and a
 * volume-proportional row tint.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { SlidersHorizontal, RotateCcw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowUpDown, Check, Flame, Trophy, TrendingUp, BarChart3, Sparkles, Eye, Layers } from 'lucide-react'
import useScreener from '../hooks/useScreener'
import useMarketFeed from '../hooks/useMarketFeed'
import { prefetchTrending } from '../hooks/useCodexData'
import { getNetworkShort } from '../services/codexApi'
import { ChainIcon } from '../utils/chainIcons'
import { Sparkline, DataBarRow, DivergingBar, Treemap } from './ui/viz'
import SegmentedControl from './ui/SegmentedControl'
import { fetchSparklineBars, getSparklineFromCache } from '../lib/sparklineFetch'
import { whenIdle } from '../utils/whenIdle'
import { subsample } from '../utils/sparkline'
import useSettingsStore from '../store/useSettingsStore'
import { CATEGORIES, TIMEFRAMES, NETWORKS, CHAIN_NET_IDS, getChangeForTimeframe, formatAge } from '../lib/marketFormat'

// Advanced numeric range filters (filter mode). pct fields are /100 before the API.
const FILTER_DEFS = [
  { key: 'marketCap', label: 'MCap', placeholder: ['Min', 'Max'] },
  { key: 'liquidity', label: 'Liq', placeholder: ['Min', 'Max'] },
  { key: 'volume24h', label: 'Vol 24h', placeholder: ['Min', 'Max'] },
  { key: 'holders', label: 'Holders', placeholder: ['Min', 'Max'] },
  { key: 'change1h', label: '1h %', placeholder: ['Min', 'Max'], pct: true },
  { key: 'change24h', label: '24h %', placeholder: ['Min', 'Max'], pct: true },
]

// Sort dropdown — re-orders the feed client-side in BOTH modes. '' = the
// category's natural order (trendScore / server rank).
const SORT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'volume24h', label: 'Volume' },
  { value: 'marketCap', label: 'MCap' },
  { value: 'liquidity', label: 'Liquidity' },
  { value: 'holders', label: 'Holders' },
  { value: 'change', label: 'Change' },
  { value: 'createdAt', label: 'Newest' },
]

// Chain pills come straight from the shared NETWORKS list (9 chains) so the
// rail offers the exact chain choices Discover does.
const CHAIN_PILLS = NETWORKS.map(n => ({ id: n.id, label: n.id === 'all' ? 'All' : (n.abbrev || n.label) }))

// lucide glyph per category — gives the selector a scannable icon so each
// option reads at a glance instead of as a wall of text labels.
const CATEGORY_ICONS = {
  trending: Flame,
  top: Trophy,
  gainers: TrendingUp,
  volume: BarChart3,
  new: Sparkles,
  visited: Eye,
}

function parseVal(val) {
  if (!val || val === '') return undefined
  const s = val.toString().trim().toUpperCase()
  if (s.endsWith('B')) return parseFloat(s) * 1e9
  if (s.endsWith('M')) return parseFloat(s) * 1e6
  if (s.endsWith('K')) return parseFloat(s) * 1e3
  return parseFloat(s) || undefined
}

// Compact USD with K for thousands (501,813 -> $502K) so the rail never shows a
// long comma-grouped number. Matches the M/B/T abbreviation the rest of the app
// uses (codexApi formatLargeNumber keeps thousands comma-grouped, which is why
// MC read as "$510,419"; here we abbreviate the whole ladder).
function fmtCompactUsd(num) {
  const n = Number(num)
  if (!n || isNaN(n) || !isFinite(n)) return '$0'
  const a = Math.abs(n)
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

// Compact, readable % for an ALREADY-normalized percentage (getChangeForTimeframe
// output). Drops the noisy ".00" and abbreviates large moves (+304757% -> +305K%)
// so the change column reads at a glance instead of as a wall of digits.
function fmtPctCompact(pct) {
  if (pct == null || !isFinite(pct)) return { text: '-', cls: 'neutral' }
  const abs = Math.abs(pct)
  if (abs < 0.005) return { text: '0%', cls: 'neutral' }
  const cls = pct >= 0 ? 'bull' : 'bear'
  const sign = pct >= 0 ? '+' : '-'
  let n
  if (abs >= 1e6) n = '>999K'
  else if (abs >= 1e4) n = `${(abs / 1e3).toFixed(0)}K`
  else if (abs >= 1e3) n = `${(abs / 1e3).toFixed(1)}K`
  else if (abs >= 100) n = `${abs.toFixed(0)}`
  else if (abs >= 10) n = `${abs.toFixed(1)}`
  else n = `${abs.toFixed(2)}`
  return { text: `${sign}${n}%`, cls }
}

// Price with the leading-zero subscript notation ($0.0<sub>4</sub>1671) when a
// token has many leading zeros - keeps the secondary price compact while MC is
// the headline. Normal formatting above ~0.0001.
function PriceSub({ value }) {
  const v = Number(value)
  if (!isFinite(v) || v <= 0) return <span className="screener-row-px">$0</span>
  if (v >= 1) return <span className="screener-row-px">{'$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
  const afterDot = v.toFixed(20).split('.')[1] || ''
  let zeros = 0
  while (afterDot[zeros] === '0') zeros++
  if (zeros < 4) {
    let s = v.toPrecision(4)
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '')
    return <span className="screener-row-px">{'$' + s}</span>
  }
  const sig = afterDot.slice(zeros).replace(/0+$/, '').slice(0, 4) || '0'
  return <span className="screener-row-px">{'$0.0'}<sub className="screener-row-px-z">{zeros}</sub>{sig}</span>
}

export default function TokenScreener({ selectToken }) {
  const [category, setCategory] = useState('trending')
  const [chainId, setChainId] = useState('all')
  const [timeframe, setTimeframe] = useState('24h') // 5m | 1h | 6h | 24h
  const [sortKey, setSortKey] = useState('') // '' = category-natural order

  // Category-mode feed — identical pipeline to Discover.
  const { tokens: feedTokens, loading: feedLoading } = useMarketFeed({ category, chainId, timeframe, limit: 60 })

  // Advanced numeric-filter mode (Codex filterTokens). Dormant until a filter
  // is applied (useScreener skips the query while filters are empty).
  const { results: screenerResults, loading: screenerLoading, filters, setFilter, clearFilters, setNetworks } = useScreener()
  const filterMode = Object.keys(filters).length > 0

  // Keep the screener's chain in sync with the selected chain pill so filter
  // mode respects it. Harmless while dormant (no fetch on empty filters).
  useEffect(() => {
    setNetworks(chainId === 'all' ? null : (CHAIN_NET_IDS[chainId] || null))
  }, [chainId, setNetworks])

  // Unified, client-sorted result list for whichever mode is active.
  const rawResults = useMemo(() => {
    const base = filterMode ? (screenerResults || []) : (feedTokens || [])
    if (!sortKey) return base
    const arr = [...base]
    if (sortKey === 'change') {
      arr.sort((a, b) => getChangeForTimeframe(b, timeframe) - getChangeForTimeframe(a, timeframe))
    } else {
      arr.sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0))
    }
    return arr
  }, [filterMode, screenerResults, feedTokens, sortKey, timeframe])
  const loading = filterMode ? screenerLoading : feedLoading

  // Stale-while-revalidate render: switching chain/timeframe empties the computed
  // list for one render (the feed's client chain-filter drops the previous
  // chain's tokens before the new fetch lands), which would flash the loading
  // skeleton in and jump the layout. Keep rendering the last non-empty list while
  // a fetch is in flight so the rail updates IN PLACE instead of blinking. Only a
  // genuine empty (not loading) shows the empty state. Every consumer below reads
  // `results`, so they all stay stable through the switch.
  const lastGoodRef = useRef([])
  useEffect(() => { if (rawResults.length > 0) lastGoodRef.current = rawResults }, [rawResults])
  const results = rawResults.length > 0 ? rawResults : (loading ? lastGoodRef.current : rawResults)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef(null)
  const [localInputs, setLocalInputs] = useState({})
  const [page, setPage] = useState(0)
  const [sparklineMap, setSparklineMap] = useState(() => new Map())
  const explorerView = useSettingsStore((s) => s.explorerView)
  const setExplorerView = useSettingsStore((s) => s.setExplorerView)

  // Reset to page 0 whenever the feed selection changes.
  useEffect(() => { setPage(0) }, [category, chainId, timeframe, sortKey, filterMode])

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return
    const handler = (e) => { if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sortOpen])

  // Dynamic page size: fill down to the tallest sibling column's content extent
  // (the right stats panel) with no dead gap, without a grow-measure-grow loop.
  const resultsRef = useRef(null)
  const [perPage, setPerPage] = useState(10)
  useEffect(() => {
    const el = resultsRef.current
    if (!el) return
    let raf = 0
    const measure = () => {
      raf = 0
      let anchorBottom = 0
      const right = [...document.querySelectorAll('.panel-right')].find(p => p.offsetParent !== null)
      if (right) {
        for (const c of right.children) anchorBottom = Math.max(anchorBottom, c.getBoundingClientRect().bottom)
      }
      if (!anchorBottom) return
      const resultsRect = el.getBoundingClientRect()
      const firstRow = el.querySelector('.screener-row--card')
      const rowH = firstRow ? firstRow.offsetHeight + 4 : 62
      const PAGINATION_RESERVE = 56
      const available = anchorBottom - resultsRect.top - PAGINATION_RESERVE
      const fit = Math.floor(available / rowH)
      const next = Math.max(10, Math.min(fit, results.length || 10))
      setPerPage((prev) => (prev === next ? prev : next))
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure) }
    schedule()
    const layout = document.querySelector('.main-layout')
    const ro = new ResizeObserver(schedule)
    if (layout) ro.observe(layout)
    window.addEventListener('resize', schedule)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [results.length])

  const activeFilterCount = Object.keys(filters).length
  const totalPages = Math.ceil(results.length / perPage)
  useEffect(() => { if (page > 0 && page >= totalPages) setPage(Math.max(0, totalPages - 1)) }, [totalPages, page])

  const pagedResults = useMemo(
    () => results.slice(page * perPage, (page + 1) * perPage),
    [results, page, perPage]
  )

  const handleBlur = (key) => {
    const minVal = parseVal(localInputs[`${key}_min`])
    const maxVal = parseVal(localInputs[`${key}_max`])
    const def = FILTER_DEFS.find(d => d.key === key)
    const f = {}
    if (minVal !== undefined) f.gte = def?.pct ? minVal / 100 : minVal
    if (maxVal !== undefined) f.lte = def?.pct ? maxVal / 100 : maxVal
    setFilter(key, Object.keys(f).length > 0 ? f : null)
  }

  // Fetch per-row sparklines for the visible page (idle-deferred, 2-min cache).
  useEffect(() => {
    if (!pagedResults.length) return
    let cancelled = false
    setSparklineMap((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const t of pagedResults) {
        const cached = getSparklineFromCache(t.address, t.networkId)
        if (cached && prev.get(t.address) !== cached) { next.set(t.address, cached); changed = true }
      }
      return changed ? next : prev
    })
    const pending = pagedResults.filter((t) => !getSparklineFromCache(t.address, t.networkId))
    if (pending.length === 0) return () => { cancelled = true }
    const cancelIdle = whenIdle(() => {
      if (cancelled) return
      Promise.all(
        pending.map((t) => fetchSparklineBars(t.address, t.networkId).then((prices) => prices ? { addr: t.address, prices } : null))
      ).then((arr) => {
        if (cancelled) return
        const filled = arr.filter(Boolean)
        if (filled.length === 0) return
        setSparklineMap((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const { addr, prices } of filled) {
            if (prev.get(addr) !== prices) { next.set(addr, prices); changed = true }
          }
          return changed ? next : prev
        })
      })
    })
    return () => { cancelled = true; cancelIdle() }
  }, [pagedResults])

  const maxVolume = useMemo(() => {
    let m = 0
    for (const t of pagedResults) if ((t.volume24h || 0) > m) m = t.volume24h || 0
    return m || 1
  }, [pagedResults])

  const subsampledMap = useMemo(() => {
    const next = new Map()
    for (const [addr, prices] of sparklineMap) next.set(addr, subsample(prices, 24))
    return next
  }, [sparklineMap])

  return (
    <div className="screener">
      {/* Category selector (mirrors Discover) */}
      <div className="screener-cats" role="group" aria-label="Category">
        {CATEGORIES.map(c => {
          const Icon = CATEGORY_ICONS[c.id]
          return (
            <button
              key={c.id}
              className={`screener-cat-pill${category === c.id ? ' active' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {Icon && <Icon size={12} className="screener-cat-ico" aria-hidden="true" />}
              <span>{c.label}</span>
            </button>
          )
        })}
      </div>

      {/* Chain selector (9 chains) */}
      <div className="screener-chains" role="group" aria-label="Chain">
        {CHAIN_PILLS.map(c => (
          <button
            key={c.id}
            className={`screener-chain-pill${chainId === c.id ? ' active' : ''}`}
            onClick={() => setChainId(c.id)}
            onMouseEnter={() => {
              // Warm the chain's trending cache on hover so the click swaps in
              // near-instantly (the stale-while-revalidate render keeps the old
              // list up meanwhile, so there's no blink either way).
              if (category !== 'top' && category !== 'visited') {
                prefetchTrending(CHAIN_NET_IDS[c.id], timeframe)
              }
            }}
          >
            {c.id === 'all'
              ? <Layers size={12} className="screener-chain-ico" aria-hidden="true" />
              : <ChainIcon networkId={CHAIN_NET_IDS[c.id]?.[0]} size={13} />}
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      {/* Toolbar: timeframe + view + filters + sort */}
      <div className="screener-toolbar">
        <div className="screener-tf-toggle">
          <SegmentedControl
            value={timeframe}
            onChange={setTimeframe}
            accent="lime"
            options={TIMEFRAMES.map(t => ({ value: t.id, label: t.label }))}
          />
        </div>
        <div className="screener-view-toggle">
          <SegmentedControl
            value={explorerView}
            onChange={(v) => setExplorerView(v)}
            accent="lime"
            options={[{ value: 'list', label: 'List' }, { value: 'heatmap', label: 'Heatmap' }]}
          />
        </div>
        <button
          className={`screener-filter-btn${filtersOpen ? ' active' : ''}`}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={11} />
          <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
          {filtersOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
        {activeFilterCount > 0 && (
          <button className="screener-clear-btn" onClick={() => { clearFilters(); setLocalInputs({}) }}>
            <RotateCcw size={9} /> Clear
          </button>
        )}
        <div className="screener-sort-wrap" ref={sortRef}>
          <button className={`screener-sort-btn${sortOpen ? ' open' : ''}`} onClick={() => setSortOpen(!sortOpen)}>
            <ArrowUpDown size={10} />
            <span>{SORT_OPTIONS.find(o => o.value === sortKey)?.label || 'Sort'}</span>
            <ChevronDown size={10} className={`screener-sort-chevron${sortOpen ? ' rotated' : ''}`} />
          </button>
          {sortOpen && (
            <div className="screener-sort-dropdown">
              {SORT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`screener-sort-option${sortKey === o.value ? ' active' : ''}`}
                  onClick={() => { setSortKey(o.value); setSortOpen(false) }}
                >
                  <span>{o.label}</span>
                  {sortKey === o.value && <Check size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Advanced numeric filters */}
      {filtersOpen && (
        <div className="screener-filters">
          {FILTER_DEFS.map(def => (
            <div key={def.key} className="screener-filter-row">
              <span className="screener-filter-label">{def.label}</span>
              <div className="screener-filter-inputs">
                <input
                  className="screener-filter-input"
                  placeholder={def.placeholder[0]}
                  value={localInputs[`${def.key}_min`] ?? ''}
                  onChange={(e) => setLocalInputs(p => ({ ...p, [`${def.key}_min`]: e.target.value }))}
                  onBlur={() => handleBlur(def.key)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBlur(def.key)}
                />
                <span className="screener-filter-sep">{'–'}</span>
                <input
                  className="screener-filter-input"
                  placeholder={def.placeholder[1]}
                  value={localInputs[`${def.key}_max`] ?? ''}
                  onChange={(e) => setLocalInputs(p => ({ ...p, [`${def.key}_max`]: e.target.value }))}
                  onBlur={() => handleBlur(def.key)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBlur(def.key)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Heatmap view */}
      {explorerView === 'heatmap' && results.length > 0 && (
        <div className="screener-heatmap-wrap">
          <Treemap
            items={results.slice(0, 60).map((t) => ({
              key: t.address,
              value: t.volume24h || 0,
              change: getChangeForTimeframe(t, timeframe),
              label: t.symbol,
              _token: t,
            }))}
            width={400}
            height={320}
            onCellClick={(cell) => selectToken(cell._token, 'heatmap')}
          />
        </div>
      )}

      {/* List view */}
      {explorerView === 'list' && (
        <div className="screener-results screener-results--cards" ref={resultsRef}>
          {loading && results.length === 0 && (
            <div className="screener-loading">
              {[...Array(8)].map((_, i) => <div key={i} className={`screener-skeleton stagger-${(i % 5) + 1}`} />)}
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="screener-empty">
              {category === 'visited' ? 'No visits yet' : filterMode ? 'No tokens match filters' : 'No tokens'}
            </div>
          )}
          {pagedResults.map((token, i) => {
            const chVal = getChangeForTimeframe(token, timeframe)
            const rank = page * perPage + i + 1
            const sparkData = subsampledMap.get(token.address) || null
            const sparkStroke = chVal >= 0 ? 'var(--up)' : 'var(--down)'
            const volRatio = (token.volume24h || 0) / maxVolume
            const buys = Number(token.buys24) || 0
            const sells = Number(token.sells24) || 0
            const hasFlow = buys + sells > 0
            const age = formatAge(token.createdAt)
            return (
              <DataBarRow
                key={`${token.address}-${token.networkId}-${i}`}
                as="button"
                value={volRatio}
                tint="lime"
                className={['screener-row screener-row--card', rank <= 3 ? 'is-top' : ''].filter(Boolean).join(' ')}
                onClick={() => selectToken(token, 'screener')}
                title={`${token.symbol} · #${rank}`}
              >
                <div className="screener-row-top">
                  <span className={['screener-row-rank', rank === 1 ? 'is-first' : ''].filter(Boolean).join(' ')}>{rank}</span>
                  <div className="screener-row-logo-wrap">
                    {/* Lazy + intrinsic size: this is a long scrolling rail and
                        each logo is a 600-900ms TTFB hit to raw S3, so off-screen
                        rows must not fire in the first frame. */}
                    {token.logo ? (
                      <img src={token.logo} alt="" className="screener-row-logo" width={26} height={26} loading="lazy" decoding="async" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }} />
                    ) : null}
                    <div className="screener-row-logo-fb" style={{ display: token.logo ? 'none' : 'flex' }}>{(token.symbol || '?')[0]}</div>
                  </div>
                  <div className="screener-row-id">
                    <span className="screener-row-sym">{token.symbol}</span>
                    {token.name && <span className="screener-row-name">{token.name}</span>}
                    <span className="screener-row-net">{getNetworkShort(token.networkId)}</span>
                  </div>
                  <div className="screener-row-spark">
                    {sparkData
                      ? <Sparkline data={sparkData} width={52} height={18} stroke={sparkStroke} fill="gradient" strokeWidth={1.3} />
                      : <span className="screener-row-spark-placeholder" aria-hidden="true" />}
                  </div>
                  <div className="screener-row-mc-col">
                    <span className="screener-row-mc">{fmtCompactUsd(token.marketCap)}</span>
                    {(() => {
                      const { text, cls } = fmtPctCompact(chVal)
                      return <span className={`screener-row-chg screener-row-chg--${cls}`}>{text}</span>
                    })()}
                  </div>
                </div>
                <div className="screener-row-bot">
                  <span className="screener-row-stat"><i>Px</i><PriceSub value={token.price} /></span>
                  <span className="screener-row-stat"><i>Vol</i>{fmtCompactUsd(token.volume24h).replace('$', '')}</span>
                  <span className="screener-row-flow" title={hasFlow ? `${buys} buys · ${sells} sells` : 'No recent flow'}>
                    {hasFlow
                      ? <DivergingBar left={buys} right={sells} height={4} />
                      : <span className="screener-row-flow-empty" aria-hidden="true" />}
                  </span>
                  {age !== '-' && <span className="screener-row-age" title="Token age">{age}</span>}
                </div>
              </DataBarRow>
            )
          })}
          {totalPages > 1 && (
            <div className="screener-pagination">
              <button className="screener-page-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={14} />
              </button>
              {[...Array(totalPages)].map((_, i) => (
                <button key={i} className={`screener-page-num${page === i ? ' active' : ''}`} onClick={() => setPage(i)}>
                  {i + 1}
                </button>
              ))}
              <button className="screener-page-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
