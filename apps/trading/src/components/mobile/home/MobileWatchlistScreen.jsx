/**
 * MobileWatchlistScreen — the Watchlist tab (prefix mwl-).
 *
 * Renders App-level watchlist entries through the shared MobileTokenRow with
 * live data merged in (useWatchlistLiveData — polled only while this tab is
 * active). Pinned entries float to the top. Swipe-left removes, long-press
 * peeks, tap opens the token page.
 *
 * "Pulse" — a collapsible stats card above the list: mood read (breadth +
 * average 24H), green/red breadth bar, ΣVOL/ΣLIQ/ΣMCAP, and the day's
 * leader/laggard (tappable). Collapsed state persists in localStorage.
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Star, Pin, ChevronDown, TrendingUp, TrendingDown, ArrowDownWideNarrow } from 'lucide-react'
import { prewarmChartBarsList } from '../../../hooks/useCodexData'
import { whenIdle } from '../../../utils/whenIdle'
import useAdaptivePolling from '../../../hooks/useAdaptivePolling'
import MobileTokenRow, { gradeClass, fmtPct } from './MobileTokenRow'
import MobileTokenPeek from './MobileTokenPeek'
import MobileActionSheet from './MobileActionSheet'
import MobilePullRefresh from '../MobilePullRefresh'
import useWatchlistLiveData from './useWatchlistLiveData'
import { readCodexChangePct } from '../../../lib/marketFormat'
import { formatLargeNumber } from '../../../services/codexApi'
import './MobileWatchlistScreen.css'

const PULSE_KEY = 'spectre-mwl-pulse-collapsed'

/* DexScreener-parity sort menu (Sunny's ask 2026-07-17): txns / volume /
   liquidity / age / market cap chips + price-change up/down per window.
   Windows are the ones our details-batch actually carries (Codex change1/4/
   12/24) - DexScreener's 5M/6H have no equivalent in this pipeline.
   'saved' (the Clear state) keeps the user's order, pinned first. */
const SORT_CHIPS = [
  { id: 'txnsDesc', label: 'Most Txns' },
  { id: 'volDesc', label: 'Most Volume' },
  { id: 'liqDesc', label: 'Most Liquidity' },
  { id: 'ageNewest', label: 'Age - Newest' },
  { id: 'ageOldest', label: 'Age - Oldest' },
  { id: 'mcapDesc', label: 'Market Cap - Highest' },
  { id: 'mcapAsc', label: 'Market Cap - Lowest' },
]
const CHG_WINDOWS = [
  { id: '24h', label: '24 Hours', short: '24H', field: 'change24h' },
  { id: '12h', label: '12 Hours', short: '12H', field: 'change12h' },
  { id: '4h', label: '4 Hours', short: '4H', field: 'change4h' },
  { id: '1h', label: '1 Hour', short: '1H', field: 'change1h' },
]

function sortTriggerLabel(sortKey) {
  if (sortKey === 'saved') return 'Sort'
  const chip = SORT_CHIPS.find(s => s.id === sortKey)
  if (chip) return chip.label
  const [dir, win] = sortKey.split(':')
  const w = CHG_WINDOWS.find(x => x.id === win)
  if (w) return `${w.short} ${dir === 'chgUp' ? '▲' : '▼'}`
  return 'Sort'
}

function sortRows(rows, sortKey) {
  if (sortKey === 'saved') {
    return [...rows.filter(t => t._pinned), ...rows.filter(t => !t._pinned)]
  }
  if (sortKey.startsWith('chgUp:') || sortKey.startsWith('chgDown:')) {
    const [dir, win] = sortKey.split(':')
    const field = CHG_WINDOWS.find(w => w.id === win)?.field || 'change24h'
    const chg = (t) => readCodexChangePct(field === 'change24h' ? (t.change24h ?? t.change) : t[field])
    const up = dir === 'chgUp'
    // rows with no data for the window sink to the bottom either way
    return [...rows].sort((a, b) => {
      const ca = chg(a); const cb = chg(b)
      if (ca == null && cb == null) return 0
      if (ca == null) return 1
      if (cb == null) return -1
      return up ? cb - ca : ca - cb
    })
  }
  const cmp = {
    txnsDesc: (a, b) => (Number(b.txnCount24) || 0) - (Number(a.txnCount24) || 0),
    volDesc: (a, b) => (Number(b.volume24h) || 0) - (Number(a.volume24h) || 0),
    liqDesc: (a, b) => (Number(b.liquidity) || 0) - (Number(a.liquidity) || 0),
    ageNewest: (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0),
    ageOldest: (a, b) => (Number(a.createdAt) || Infinity) - (Number(b.createdAt) || Infinity),
    mcapDesc: (a, b) => (Number(b.marketCap) || 0) - (Number(a.marketCap) || 0),
    mcapAsc: (a, b) => (Number(a.marketCap) || 0) - (Number(b.marketCap) || 0),
  }[sortKey]
  return cmp ? [...rows].sort(cmp) : rows
}

/** Aggregate read over the merged rows. Change fields are normalized through
 *  readCodexChangePct (mixed-unit Codex). Tokens with no landed change are
 *  excluded from mood/avg so a cold cache can't fake a "flat" read. */
function computePulse(rows) {
  let up = 0; let down = 0; let sum = 0; let n = 0
  let vol = 0; let liq = 0; let mcap = 0
  let best = null; let worst = null
  for (const t of rows) {
    vol += t.volume24h || 0
    liq += t.liquidity || 0
    mcap += t.marketCap || 0
    const c = readCodexChangePct(t.change24h ?? t.change)
    if (c == null) continue
    n += 1
    sum += c
    if (c > 0) up += 1
    else if (c < 0) down += 1
    if (!best || c > best.c) best = { t, c }
    if (!worst || c < worst.c) worst = { t, c }
  }
  const avg = n > 0 ? sum / n : null
  let mood = 'Quiet'
  if (avg != null) {
    if (avg >= 2 && up >= down) mood = 'Bullish'
    else if (avg <= -2 && down >= up) mood = 'Bearish'
    else mood = 'Mixed'
  }
  return { up, down, n, avg, vol, liq, mcap, best, worst, mood }
}

/** Saved-entry zeros mean "never had a value", not "worth nothing". */
function nz(v) {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

function WatchlistPulse({ rows, onOpenToken }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(PULSE_KEY) === '1' } catch { return false }
  })
  const pulse = useMemo(() => computePulse(rows), [rows])

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(PULSE_KEY, next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }

  // Nothing meaningful to aggregate yet (no change data landed).
  if (pulse.n === 0) return null

  const moodDir = pulse.avg == null ? 'flat' : pulse.avg >= 0 ? 'up' : 'down'
  const upShare = pulse.up + pulse.down > 0 ? (pulse.up / (pulse.up + pulse.down)) * 100 : 50
  // Distinct leader/laggard only makes sense with 2+ scored tokens.
  const showEdges = pulse.n >= 2 && pulse.best && pulse.worst && pulse.best.t !== pulse.worst.t

  return (
    <section className={`mwl-pulse${collapsed ? ' is-collapsed' : ''}`} aria-label="Watchlist stats">
      {/* one-line read: mood + avg left, breadth counts right */}
      <button type="button" className="mwl-pulse-head" onClick={toggle} aria-expanded={!collapsed}>
        <span className={`mwl-pulse-dot is-${moodDir}`} aria-hidden="true" />
        <span className="mwl-pulse-mood">{pulse.mood}</span>
        {pulse.avg != null && (
          <span className="mwl-pulse-avg">
            <i>AVG 24H</i>
            <b className={gradeClass(pulse.avg)}>{fmtPct(pulse.avg)}</b>
          </span>
        )}
        <span className="mwl-pulse-counts">
          <i className="up">{pulse.up}&#8593;</i>
          <i className="down">{pulse.down}&#8595;</i>
        </span>
        <ChevronDown size={15} strokeWidth={2} className="mwl-pulse-chev" aria-hidden="true" />
      </button>

      {!collapsed && (
        <div className="mwl-pulse-body">
          <div className="mwl-pulse-bar" role="img" aria-label={`${pulse.up} rising, ${pulse.down} falling`}>
            <span className="mwl-pulse-bar-up" style={{ width: `${upShare}%` }} />
          </div>

          {/* hairline data strip — no boxes */}
          <div className="mwl-pulse-strip">
            <span className="mwl-pulse-item"><i>VOL 24H</i><b>{formatLargeNumber(pulse.vol)}</b></span>
            <span className="mwl-pulse-div" aria-hidden="true" />
            <span className="mwl-pulse-item"><i>LIQ</i><b>{formatLargeNumber(pulse.liq)}</b></span>
            <span className="mwl-pulse-div" aria-hidden="true" />
            <span className="mwl-pulse-item"><i>MCAP</i><b>{formatLargeNumber(pulse.mcap)}</b></span>
          </div>

          {showEdges && (
            <div className="mwl-pulse-edges">
              <button type="button" className="mwl-pulse-edge" onClick={() => onOpenToken?.(pulse.best.t)}>
                <TrendingUp size={13} strokeWidth={2.2} className="mwl-pulse-edge-ic up" aria-hidden="true" />
                <span className="mwl-pulse-edge-sym">{pulse.best.t.symbol}</span>
                <b className={gradeClass(pulse.best.c)}>{fmtPct(pulse.best.c)}</b>
              </button>
              <span className="mwl-pulse-div" aria-hidden="true" />
              <button type="button" className="mwl-pulse-edge" onClick={() => onOpenToken?.(pulse.worst.t)}>
                <TrendingDown size={13} strokeWidth={2.2} className="mwl-pulse-edge-ic down" aria-hidden="true" />
                <span className="mwl-pulse-edge-sym">{pulse.worst.t.symbol}</span>
                <b className={gradeClass(pulse.worst.c)}>{fmtPct(pulse.worst.c)}</b>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default function MobileWatchlistScreen({
  active,
  watchlist,
  selectToken,
  removeFromWatchlist,
  onGoScreener,
}) {
  const { dataMap, loading, refresh } = useWatchlistLiveData(watchlist, active)
  const [peekToken, setPeekToken] = useState(null)
  const [sortKey, setSortKey] = useState('saved')
  const [sortOpen, setSortOpen] = useState(false)

  // The peek portals into document.body and the sheet is fixed-position, so
  // both would outlive a bottom-nav tab switch (the shell only hides this
  // screen). Dismiss on leave.
  useEffect(() => {
    if (!active) {
      setPeekToken(null)
      setSortOpen(false)
    }
  }, [active])

  const rows = useMemo(() => {
    const merged = (watchlist || []).map(t => {
      // Identity key matches useWatchlistLiveData's map: address, or symbol
      // for address-less majors synced from the research watchlist.
      const live = dataMap[String(t.address || t.symbol || '').toLowerCase()]
      return {
        ...t,
        networkId: t.networkId || live?.networkId || 1,
        // A saved entry can carry 0 for every metric (majors synced from the
        // research watchlist store identity only). Treat those zeros as
        // missing so the row renders "—" instead of a fake $0.00.
        price: live?.price ?? nz(t.price),
        // Live changes win: the saved entry's values are frozen at add-time
        // (the fake "1H +0.0%" on every row came from that stale fallback).
        change1h: live?.change1h ?? null,
        change4h: live?.change4h ?? null,
        change12h: live?.change12h ?? null,
        change24h: live?.change24h ?? nz(t.change24h) ?? nz(t.change),
        marketCap: live?.marketCap ?? nz(t.marketCap),
        liquidity: live?.liquidity ?? nz(t.liquidity),
        volume24h: live?.volume24h ?? nz(t.volume24h) ?? nz(t.volume),
        txnCount24: live?.txnCount24 ?? null,
        createdAt: live?.createdAt ?? t.createdAt ?? null,
        logo: t.logo || live?.logo,
        _pinned: !!t.pinned,
      }
    })
    return sortRows(merged, sortKey)
  }, [watchlist, dataMap, sortKey])

  // Keep-warm the watchlist rows' chart bars while this tab is open - the
  // mobile twin of LeftPanel's watchlist prewarm (see MobileScreener for the
  // full rationale: no LeftPanel/TokenTicker and no hover on the mobile tree,
  // so a tap paid the cold Codex fetch). Same guards: 15s cold-boot hold-off,
  // whenIdle kick, address-set churn key, TTL-aware passes, 240s repoll.
  const watchRowsRef = useRef(watchlist)
  watchRowsRef.current = watchlist
  const watchAddressesKey = active ? (watchlist || []).map(t => t?.address || '').join(',') : ''
  const prewarmCancelRef = useRef(null)
  const runPrewarm = useCallback(() => {
    prewarmCancelRef.current?.()
    prewarmCancelRef.current = prewarmChartBarsList(watchRowsRef.current || [], { cap: 12 })
  }, [])
  useEffect(() => {
    if (!watchAddressesKey) return undefined
    let cancelled = false
    let cancelIdle = null
    const holdOff = Math.max(0, 15_000 - performance.now())
    const holdTimer = setTimeout(() => {
      if (cancelled) return
      cancelIdle = whenIdle(() => { if (!cancelled) runPrewarm() }, { timeout: 4000 })
    }, holdOff)
    return () => { cancelled = true; clearTimeout(holdTimer); cancelIdle?.() }
  }, [watchAddressesKey, runPrewarm])
  useEffect(() => () => { prewarmCancelRef.current?.() }, [])
  useAdaptivePolling(runPrewarm, { interval: 240000, enabled: watchAddressesKey.length > 0 })

  const openToken = useCallback((token) => {
    selectToken?.(token, 'mobile-watchlist')
  }, [selectToken])

  const remove = useCallback((token) => {
    removeFromWatchlist?.(token.address || token.symbol)
  }, [removeFromWatchlist])

  // First load, nothing live yet: show skeletons rather than rows full of
  // placeholder zeros (the "$0.00 / +0.0% / $0" flash on every cold open).
  const cold = rows.length > 0 && !rows.some(r => r.price != null || r.marketCap != null)
  const skeleton = cold && loading
  const hydrating = cold && !loading

  if (!watchlist || watchlist.length === 0) {
    return (
      <div className="mwl mwl--empty">
        <div className="mwl-empty-icon"><Star size={26} strokeWidth={1.6} /></div>
        <p className="mwl-empty-title">Your watchlist is empty</p>
        <p className="mwl-empty-sub">Swipe any token right on the screener to start tracking it here.</p>
        <button type="button" className="mwl-empty-btn" onClick={onGoScreener}>Open Discover</button>
      </div>
    )
  }

  return (
    <MobilePullRefresh onRefresh={refresh} disabled={!active}>
    <div className="mwl">
      <div className="mwl-head">
        <span className="mwl-title">Watchlist</span>
        <span className="mwl-count">{rows.length}</span>
        <button
          type="button"
          className={`mwl-sort-btn${sortKey !== 'saved' ? ' is-set' : ''}`}
          onClick={() => setSortOpen(true)}
        >
          <ArrowDownWideNarrow size={14} strokeWidth={2} />
          {sortTriggerLabel(sortKey)}
        </button>
      </div>

      <WatchlistPulse rows={rows} onOpenToken={openToken} />

      {skeleton ? (
        <div className="mwl-list mwl-list--skel">
          {rows.map((t, i) => (
            <div key={`${t.address || t.symbol}-skel`} className="mwl-skel" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="mwl-skel-logo animate-shimmer" />
              <div className="mwl-skel-lines">
                <div className="mwl-skel-line animate-shimmer" style={{ width: '46%' }} />
                <div className="mwl-skel-line animate-shimmer" style={{ width: '72%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className={`mwl-list${hydrating ? ' is-hydrating' : ''}`}>
        {rows.map(t => (
          <div key={`${t.address || t.symbol}-${t.networkId || ''}`} className={t._pinned ? 'mwl-row mwl-row--pinned' : 'mwl-row'}>
            {t._pinned && <Pin size={10} strokeWidth={2.5} className="mwl-pin" />}
            <MobileTokenRow
              token={t}
              onSelect={openToken}
              onPeek={setPeekToken}
              onSwipeLeft={remove}
              inWatchlist
              showChips
            />
          </div>
        ))}
      </div>
      )}

      <p className="mwl-hint">Swipe left to remove · long-press to preview</p>

      <MobileActionSheet title="Sort watchlist" open={sortOpen} onClose={() => setSortOpen(false)}>
        <div className="mas-chips">
          {SORT_CHIPS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`mas-chip${sortKey === s.id ? ' is-active' : ''}`}
              onClick={() => { setSortKey(s.id); setSortOpen(false) }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mas-group-label"><i className="mas-tri mas-tri--up" aria-hidden="true" />Price change - Up</div>
        <div className="mas-chips">
          {CHG_WINDOWS.map(w => (
            <button
              key={`up-${w.id}`}
              type="button"
              className={`mas-chip${sortKey === `chgUp:${w.id}` ? ' is-active' : ''}`}
              onClick={() => { setSortKey(`chgUp:${w.id}`); setSortOpen(false) }}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="mas-group-label"><i className="mas-tri mas-tri--down" aria-hidden="true" />Price change - Down</div>
        <div className="mas-chips">
          {CHG_WINDOWS.map(w => (
            <button
              key={`down-${w.id}`}
              type="button"
              className={`mas-chip${sortKey === `chgDown:${w.id}` ? ' is-active' : ''}`}
              onClick={() => { setSortKey(`chgDown:${w.id}`); setSortOpen(false) }}
            >
              {w.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="mas-clear"
          disabled={sortKey === 'saved'}
          onClick={() => { setSortKey('saved'); setSortOpen(false) }}
        >
          Clear
        </button>
      </MobileActionSheet>

      <MobileTokenPeek
        token={peekToken}
        onClose={() => setPeekToken(null)}
        onOpen={openToken}
        onToggleWatchlist={(t) => {
          remove(t)
          setPeekToken(null)
        }}
        inWatchlist
      />
    </div>
    </MobilePullRefresh>
  )
}
