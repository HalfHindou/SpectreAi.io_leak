/**
 * MobileScreener — the DexScreener-style mobile home board (prefix msc-).
 *
 * Anatomy (top → bottom inside its own scroll container):
 *   [category pills: Trending · New · Top Coins]     (sticky top)
 *   [stat tiles: 24H VOLUME · MOVERS]
 *   [token rows]
 *   [glass toolbar: timeframe segmented · chain · sort]  (sticky bottom)
 *
 * Data = the exact hooks the desktop TokenDiscoveryTable uses (shared module
 * cache, no new fetch layers): useTrendingTokens per selected chain +
 * useTopCoins for the Top tab. 60s polling keeps rows live; no fake
 * pull-to-refresh (the hooks expose no manual refetch).
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { ArrowDown, ArrowDownWideNarrow, ArrowUp, Check } from 'lucide-react'
import { useTrendingTokens, useTopCoins, useMostVisited, prewarmChartBarsList } from '../../../hooks/useCodexData'
import { whenIdle } from '../../../utils/whenIdle'
import useAdaptivePolling from '../../../hooks/useAdaptivePolling'
import {
  TIMEFRAMES, NETWORKS, CHAIN_NET_IDS, ALL_TREND_CHAINS, TREND_DISPLAY_LIMIT,
  sortTokensByCategory, normalizeForSort, getChangeForTimeframe, fmtCount,
} from '../../../lib/marketFormat'
import { formatLargeNumber } from '../../../services/codexApi'
import MobileTokenRow, { fmtMcap } from './MobileTokenRow'
import MobileTokenPeek from './MobileTokenPeek'
import MobilePullRefresh from '../MobilePullRefresh'
import useDragScroll from './useDragScroll'
import useXdashSocial from './useXdashSocial'
import './MobileScreener.css'

/* Same category set the desktop TokenDiscoveryTable offers (marketFormat
   CATEGORIES): gainers/volume/new derive from the trending feed client-side,
   'top' and 'visited' have their own sources. */
const PILLS = [
  { id: 'trending', label: 'Trending' },
  { id: 'social', label: 'Social' },
  { id: 'top', label: 'Top Coins' },
  { id: 'gainers', label: 'Top Gainers' },
  { id: 'volume', label: 'Volume Leaders' },
  { id: 'new', label: 'New Listings' },
  { id: 'visited', label: 'Most Visited' },
]

const SORTS = [
  { id: 'trend', label: 'Trend score', hint: 'default board order' },
  { id: 'change', label: '% Change', hint: 'selected timeframe' },
  { id: 'volume24h', label: 'Volume', hint: '24h traded' },
  { id: 'liquidity', label: 'Liquidity', hint: 'pool depth' },
  { id: 'marketCap', label: 'Market cap', hint: 'largest first' },
  { id: 'createdAt', label: 'Age', hint: 'newest first' },
]

/** Minimal bottom sheet, shared by chain + sort pickers. */
function MscSheet({ title, open, onClose, children }) {
  // Drag-to-dismiss from the grabber + title strip, matching the other bottom
  // sheets: follow the finger down, close past 120px.
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)
  useEffect(() => { if (open) setDragOffset(0) }, [open])

  if (!open) return null

  const dragHandlers = {
    onTouchStart: (e) => { startYRef.current = e.touches?.[0]?.clientY ?? null },
    onTouchMove: (e) => {
      if (startYRef.current == null) return
      const dy = (e.touches?.[0]?.clientY ?? startYRef.current) - startYRef.current
      if (dy > 0) setDragOffset(dy)
    },
    onTouchEnd: () => {
      if (dragOffset > 120) onClose?.()
      else setDragOffset(0)
      startYRef.current = null
    },
  }

  return (
    <div className="msc-sheet-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="msc-sheet-backdrop" onClick={onClose} />
      <div
        className="msc-sheet"
        // `mscRise` uses fill-mode `both` and an animation's computed value
        // beats an inline style - drop it for the duration of the drag.
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, animation: 'none' } : undefined}
      >
        <div className="msc-sheet-grab" {...dragHandlers}>
          <div className="msc-sheet-grabber" />
          <div className="msc-sheet-title">{title}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function MobileScreener({
  active = true,
  selectToken,
  isInWatchlist,
  addToWatchlist,
  removeFromWatchlist,
}) {
  const [category, setCategory] = useState('trending')
  const [timeframe, setTimeframe] = useState('24h')
  const [chain, setChain] = useState('all')
  const [sortKey, setSortKey] = useState('trend')
  const [sortDir, setSortDir] = useState('desc') // desc = high → low
  const [sheet, setSheet] = useState(null) // null | 'chain' | 'sort'
  const [peekToken, setPeekToken] = useState(null)
  const tabsRef = useDragScroll()

  // The screener stays mounted when the user switches bottom-nav tabs (the
  // shell only hides it), and the peek even portals into document.body - an
  // open sheet/peek would ride along into the next tab. Dismiss on leave.
  useEffect(() => {
    if (!active) {
      setSheet(null)
      setPeekToken(null)
    }
  }, [active])

  const netIds = CHAIN_NET_IDS[chain] || ALL_TREND_CHAINS
  const { tokens: trendTokens, loading: trendLoading, refresh: refreshTrending } = useTrendingTokens(60000, netIds, timeframe)
  const { tokens: topTokens, loading: topLoading } = useTopCoins(50, 60000, '', { enabled: category === 'top' })
  // Real platform visits, server-ranked — fetched/polled only while the tab is
  // open. On 'all' pass NO chains (= every chain), mirroring the desktop table.
  const visitedNetworkIds = chain === 'all' ? [] : netIds
  const { tokens: visitedTokens, loading: visitedLoading, refresh: refreshVisited } = useMostVisited(
    visitedNetworkIds,
    category === 'visited' ? 60000 : 0,
    TREND_DISPLAY_LIMIT,
    timeframe,
  )
  // X-Dash mentions leaderboard — the hub's Social board on the home surface.
  const social = useXdashSocial(category === 'social')

  // Pull-to-refresh: refetch the feed behind the current pill. Trending backs
  // trending/gainers/volume/new (fresh = skip the 60s module cache); 'visited'
  // adds its own refetch. 'top'/'social' have no manual refetch hook — the
  // trending pull still runs so the gesture always lands fresh board data.
  const handlePullRefresh = useCallback(() => {
    const jobs = [refreshTrending(true, { fresh: true })]
    if (category === 'visited') jobs.push(refreshVisited())
    return Promise.allSettled(jobs)
  }, [refreshTrending, refreshVisited, category])

  const loading = category === 'top' ? topLoading
    : category === 'visited' ? visitedLoading
    : category === 'social' ? social.loading
    : trendLoading

  const rows = useMemo(() => {
    let arr
    if (category === 'top') arr = [...(topTokens || [])]
    else if (category === 'visited') arr = [...(visitedTokens || [])]
    else arr = sortTokensByCategory(trendTokens || [], category, timeframe)
    const dir = sortDir === 'asc' ? -1 : 1
    if (sortKey === 'change') {
      arr.sort((a, b) => dir * (getChangeForTimeframe(b, timeframe) - getChangeForTimeframe(a, timeframe)))
    } else if (sortKey !== 'trend') {
      arr.sort((a, b) => dir * (normalizeForSort(b[sortKey], sortKey) - normalizeForSort(a[sortKey], sortKey)))
    }
    return arr.slice(0, TREND_DISPLAY_LIMIT)
  }, [category, topTokens, trendTokens, visitedTokens, timeframe, sortKey, sortDir])

  // Background keep-warm of the visible rows' chart bars (user's saved TF) -
  // the mobile twin of LeftPanel/TokenTicker's prewarm, which never mounts on
  // the mobile tree. Mobile also has no hover-prefetch, so without this every
  // row tap paid the cold ~1-2.5s Codex fetch (the "chart loads much slower
  // on mobile" report). Same guards as the desktop kick sites: 15s cold-boot
  // hold-off, whenIdle kick, address-SET churn key (polls re-set fresh arrays
  // with unchanged content), TTL-aware passes, 240s adaptive repoll. Capped
  // at 12 rows (desktop caps at 20) - phones pay for the bytes.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const rowsAddressesKey = active ? rows.map(t => t?.address || '').join(',') : ''
  const prewarmCancelRef = useRef(null)
  const runPrewarm = useCallback(() => {
    prewarmCancelRef.current?.()
    prewarmCancelRef.current = prewarmChartBarsList(rowsRef.current || [], { cap: 12 })
  }, [])
  useEffect(() => {
    if (!rowsAddressesKey) return undefined
    let cancelled = false
    let cancelIdle = null
    const holdOff = Math.max(0, 15_000 - performance.now())
    const holdTimer = setTimeout(() => {
      if (cancelled) return
      cancelIdle = whenIdle(() => { if (!cancelled) runPrewarm() }, { timeout: 4000 })
    }, holdOff)
    return () => { cancelled = true; clearTimeout(holdTimer); cancelIdle?.() }
  }, [rowsAddressesKey, runPrewarm])
  useEffect(() => () => { prewarmCancelRef.current?.() }, [])
  useAdaptivePolling(runPrewarm, { interval: 240000, enabled: rowsAddressesKey.length > 0 })

  const stats = useMemo(() => {
    let vol = 0; let up = 0; let down = 0
    for (const t of rows) {
      vol += t.volume24h || t.volume || 0
      const c = getChangeForTimeframe(t, '24h')
      if (c > 0) up += 1
      else if (c < 0) down += 1
    }
    return { vol, up, down }
  }, [rows])

  const socialStats = useMemo(() => {
    let mentions = 0
    for (const r of social.rows) mentions += r.mentions || 0
    const top = social.rows[0] || null
    return { mentions, top }
  }, [social.rows])

  const isSocial = category === 'social'

  const toggleWatchlist = useCallback((token) => {
    const id = token.address || token.symbol
    if (isInWatchlist?.(id)) {
      removeFromWatchlist?.(id)
    } else {
      addToWatchlist?.({
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        networkId: token.networkId || 1,
        logo: token.logo,
      })
    }
  }, [isInWatchlist, addToWatchlist, removeFromWatchlist])

  const openToken = useCallback((token) => {
    selectToken?.(token, 'mobile-screener')
  }, [selectToken])

  const activeNetwork = NETWORKS.find(n => n.id === chain) || NETWORKS[0]
  const activeSort = SORTS.find(s => s.id === sortKey) || SORTS[0]

  return (
    <MobilePullRefresh onRefresh={handlePullRefresh} disabled={!active}>
    <div className="msc">
      {/* category tabs — editorial text tabs with a hairline underline,
          not capsule pills */}
      <div className="msc-tabs" role="tablist" aria-label="Board category" ref={tabsRef}>
        {PILLS.map(p => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={category === p.id}
            className={`msc-tab${category === p.id ? ' is-active' : ''}`}
            onClick={() => setCategory(p.id)}
          >
            {p.label}
            {p.id === 'trending' && category === 'trending' && (
              <em className="msc-tab-tf">{timeframe.toUpperCase()}</em>
            )}
          </button>
        ))}
      </div>

      {/* terminal data strip — one hairline band instead of stat cards */}
      {isSocial ? (
        <div className="msc-strip">
          <div className="msc-strip-item">
            <span>24H MENTIONS</span>
            <b>{social.loading && social.rows.length === 0 ? '—' : fmtCount(socialStats.mentions)}</b>
          </div>
          {socialStats.top && (
            <>
              <span className="msc-strip-div" aria-hidden="true" />
              <div className="msc-strip-item">
                <span>MOST TALKED</span>
                <b>{socialStats.top.symbol}</b>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="msc-strip">
          <div className="msc-strip-item">
            <span>24H VOL</span>
            <b>{loading && rows.length === 0 ? '—' : formatLargeNumber(stats.vol)}</b>
          </div>
          <span className="msc-strip-div" aria-hidden="true" />
          <div className="msc-strip-item">
            <span>MOVERS</span>
            <b className="msc-strip-movers">
              {loading && rows.length === 0 ? '—' : (
                <>
                  <i className="up">{stats.up}&#8593;</i>
                  <i className="down">{stats.down}&#8595;</i>
                </>
              )}
            </b>
          </div>
          <div
            className="msc-strip-bar"
            role="img"
            aria-label={`${stats.up} rising, ${stats.down} falling`}
          >
            <span style={{ width: `${stats.up + stats.down > 0 ? (stats.up / (stats.up + stats.down)) * 100 : 50}%` }} />
          </div>
        </div>
      )}

      {/* list */}
      <div className="msc-list">
        {isSocial ? (
          social.loading && social.rows.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="msc-skel" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="msc-skel-logo animate-shimmer" />
                <div className="msc-skel-lines">
                  <div className="msc-skel-line animate-shimmer" style={{ width: '52%' }} />
                  <div className="msc-skel-line animate-shimmer" style={{ width: '78%' }} />
                </div>
              </div>
            ))
          ) : social.rows.length === 0 ? (
            <div className="msc-empty">
              <p>{social.error ? 'Social feed unavailable right now.' : 'No social board right now.'}</p>
            </div>
          ) : (
            social.rows.map((r, i) => {
              const openable = !!(r.address && r.networkId)
              return (
                <button
                  key={`${r.symbol}-${i}`}
                  type="button"
                  className={`msc-srow${openable ? '' : ' is-static'}`}
                  onClick={openable ? () => openToken(r) : undefined}
                >
                  <span className="msc-srow-rank">{i + 1}</span>
                  {r.logo
                    ? <img className="msc-srow-logo" src={r.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.classList.add('is-broken') }} />
                    : <span className="msc-srow-logo msc-srow-logo--fb">{(r.symbol || '?').slice(0, 2)}</span>}
                  <span className="msc-srow-id">
                    <b>{r.symbol || '—'}</b>
                    <i>{r.name || ''}</i>
                  </span>
                  <span className="msc-srow-right">
                    <b className="msc-srow-mc">
                      {r.marketCap > 0 ? <><i>MC</i>{fmtMcap(r.marketCap)}</> : '—'}
                    </b>
                    <span className="msc-srow-social">
                      <b>{fmtCount(r.mentions)}</b> mentions · <b>{fmtCount(r.authors)}</b> KOLs
                    </span>
                  </span>
                </button>
              )
            })
          )
        ) : loading && rows.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="msc-skel" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="msc-skel-logo animate-shimmer" />
              <div className="msc-skel-lines">
                <div className="msc-skel-line animate-shimmer" style={{ width: '52%' }} />
                <div className="msc-skel-line animate-shimmer" style={{ width: '78%' }} />
              </div>
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="msc-empty">
            <p>No tokens on this board right now.</p>
            <button type="button" onClick={() => { setChain('all'); setSortKey('trend') }}>Reset filters</button>
          </div>
        ) : (
          rows.map((t, i) => (
            <MobileTokenRow
              key={`${t.address || t.symbol}-${t.networkId || ''}`}
              token={t}
              onSelect={openToken}
              onPeek={setPeekToken}
              onSwipeRight={toggleWatchlist}
              inWatchlist={!!isInWatchlist?.(t.address || t.symbol)}
            />
          ))
        )}
      </div>

      {/* floating command pill — echoes the header capsule; hairline
          dividers split timeframe · chain · sort. Hidden on the Social board
          (fixed 24h X-Dash ranking — timeframe/chain/sort don't apply). */}
      {!isSocial && (
      <div className="msc-dockbar">
      <div className="msc-dock">
        <div className="msc-dock-tf" role="radiogroup" aria-label="Timeframe">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.id}
              type="button"
              role="radio"
              aria-checked={timeframe === tf.id}
              className={`msc-dock-tfbtn${timeframe === tf.id ? ' is-active' : ''}`}
              onClick={() => setTimeframe(tf.id)}
            >
              {tf.label.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="msc-dock-div" aria-hidden="true" />
        <button type="button" className="msc-dock-btn" onClick={() => setSheet('chain')}>
          {activeNetwork.color ? (
            <span className="msc-dock-dot" style={{ background: activeNetwork.color }} />
          ) : (
            <span className="msc-dock-dots" aria-hidden="true">
              <i style={{ background: '#627EEA' }} />
              <i style={{ background: '#9945FF' }} />
              <i style={{ background: '#F0B90B' }} />
            </span>
          )}
          {activeNetwork.abbrev || 'All'}
        </button>
        <span className="msc-dock-div" aria-hidden="true" />
        <button
          type="button"
          className={`msc-dock-btn${sortKey !== 'trend' ? ' is-set' : ''}`}
          onClick={() => setSheet('sort')}
        >
          <ArrowDownWideNarrow size={14} strokeWidth={2} />
          {sortKey === 'trend' ? 'Sort' : activeSort.label}
        </button>
      </div>
      </div>
      )}

      {/* chain sheet */}
      <MscSheet title="Chain" open={sheet === 'chain'} onClose={() => setSheet(null)}>
        <div className="msc-sheet-list">
          {NETWORKS.map(n => (
            <button
              key={n.id}
              type="button"
              className={`msc-sheet-row${chain === n.id ? ' is-active' : ''}`}
              onClick={() => { setChain(n.id); setSheet(null) }}
            >
              <span className="msc-dock-dot" style={{ background: n.color || 'rgba(245,245,247,0.3)' }} />
              {n.label}
              {chain === n.id && <Check size={16} strokeWidth={2.5} className="msc-sheet-check" />}
            </button>
          ))}
        </div>
      </MscSheet>

      {/* sort sheet */}
      <MscSheet title="Sort by" open={sheet === 'sort'} onClose={() => setSheet(null)}>
        <div className="msc-sheet-list">
          {SORTS.map(s => {
            const active = sortKey === s.id
            const flippable = active && s.id !== 'trend'
            return (
              <button
                key={s.id}
                type="button"
                className={`msc-sheet-row${active ? ' is-active' : ''}`}
                onClick={() => {
                  if (flippable) { setSortDir(d => (d === 'desc' ? 'asc' : 'desc')); return }
                  setSortKey(s.id)
                  setSortDir('desc')
                  setSheet(null)
                }}
              >
                <span className="msc-sheet-row-main">
                  {s.label}
                  <em>{flippable ? (sortDir === 'desc' ? 'high → low · tap to flip' : 'low → high · tap to flip') : s.hint}</em>
                </span>
                {active && (s.id === 'trend'
                  ? <Check size={16} strokeWidth={2.5} className="msc-sheet-check" />
                  : (sortDir === 'desc'
                    ? <ArrowDown size={16} strokeWidth={2.5} className="msc-sheet-check" />
                    : <ArrowUp size={16} strokeWidth={2.5} className="msc-sheet-check" />))}
              </button>
            )
          })}
        </div>
      </MscSheet>

      {/* long-press peek */}
      <MobileTokenPeek
        token={peekToken}
        onClose={() => setPeekToken(null)}
        onOpen={openToken}
        onToggleWatchlist={toggleWatchlist}
        inWatchlist={peekToken ? !!isInWatchlist?.(peekToken.address || peekToken.symbol) : false}
      />
    </div>
    </MobilePullRefresh>
  )
}
