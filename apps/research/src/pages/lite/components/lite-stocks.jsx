/**
 * LITE Stocks - Wall Street, zoomed out. Zero-LLM deterministic read.
 *   - Index band (S&P/Nasdaq/Dow/VIX) + honest market-hours status
 *   - Big-names board (megacaps + SPCX) with logos, mcap-sorted
 *   - Winners/losers + sector rollup DERIVED from the same quote batch
 *     (the /api/stocks/sectors route is Express-only - never call it here,
 *     it has no serverless twin and dies on prod)
 * Weekend/closed sessions render last-close numbers, labeled as such.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { track, Events } from '@/services/analytics'
import { daysUntil } from '@/lib/earnings-countdown'
import {
  getStockQuotes, getMarketIndices, getMarketMovers, getMarketStatus,
  getStockLogoUrl, getStockLogoFallback, FALLBACK_STOCK_DATA, getUpcomingEarnings,
  POPULAR_STOCKS,
} from '@/services/stockApi'
import { liteTimeAgo } from './use-lite-data'
import { CinemaButton } from './lite-cinema'
import LiteNext48 from './lite-next48'
import LiteEditPop from './lite-edit-sheet'
import useDragReorder from './use-drag-reorder'

// Same slug-key helper as lite-page (local copy - this file is imported BY
// lite-page, dependency stays one-directional).

// The universe: ~76 household US names + SPCX, with LITE-owned metadata so
// names/sectors never depend on what the quote payload happens to carry.
// Sector vocabulary stays within the 9 translated keys (see language packs).
export const STOCK_UNIVERSE = [
  ['AAPL', 'Apple', 'Technology'], ['MSFT', 'Microsoft', 'Technology'], ['GOOGL', 'Alphabet', 'Technology'],
  ['META', 'Meta Platforms', 'Technology'], ['ORCL', 'Oracle', 'Technology'], ['CRM', 'Salesforce', 'Technology'],
  ['ADBE', 'Adobe', 'Technology'], ['IBM', 'IBM', 'Technology'], ['NOW', 'ServiceNow', 'Technology'],
  ['INTU', 'Intuit', 'Technology'], ['PLTR', 'Palantir', 'Technology'], ['UBER', 'Uber', 'Technology'],
  ['SHOP', 'Shopify', 'Technology'], ['SNOW', 'Snowflake', 'Technology'],
  ['NVDA', 'NVIDIA', 'Semiconductor'], ['AVGO', 'Broadcom', 'Semiconductor'], ['AMD', 'AMD', 'Semiconductor'],
  ['INTC', 'Intel', 'Semiconductor'], ['TSM', 'TSMC', 'Semiconductor'], ['QCOM', 'Qualcomm', 'Semiconductor'],
  ['MU', 'Micron', 'Semiconductor'], ['ARM', 'Arm Holdings', 'Semiconductor'], ['ASML', 'ASML', 'Semiconductor'],
  ['AMZN', 'Amazon', 'Consumer'], ['WMT', 'Walmart', 'Consumer'], ['COST', 'Costco', 'Consumer'],
  ['HD', 'Home Depot', 'Consumer'], ['NKE', 'Nike', 'Consumer'], ['MCD', "McDonald's", 'Consumer'],
  ['SBUX', 'Starbucks', 'Consumer'], ['KO', 'Coca-Cola', 'Consumer'], ['PEP', 'PepsiCo', 'Consumer'],
  ['PG', 'Procter & Gamble', 'Consumer'], ['TGT', 'Target', 'Consumer'],
  ['BRK-B', 'Berkshire Hathaway', 'Financial'], ['JPM', 'JPMorgan Chase', 'Financial'], ['V', 'Visa', 'Financial'],
  ['MA', 'Mastercard', 'Financial'], ['BAC', 'Bank of America', 'Financial'], ['WFC', 'Wells Fargo', 'Financial'],
  ['GS', 'Goldman Sachs', 'Financial'], ['MS', 'Morgan Stanley', 'Financial'], ['AXP', 'American Express', 'Financial'],
  ['BLK', 'BlackRock', 'Financial'], ['COIN', 'Coinbase', 'Financial'], ['HOOD', 'Robinhood', 'Financial'],
  ['MSTR', 'Strategy', 'Financial'], ['PYPL', 'PayPal', 'Financial'],
  ['LLY', 'Eli Lilly', 'Healthcare'], ['UNH', 'UnitedHealth', 'Healthcare'], ['JNJ', 'Johnson & Johnson', 'Healthcare'],
  ['PFE', 'Pfizer', 'Healthcare'], ['MRK', 'Merck', 'Healthcare'], ['ABBV', 'AbbVie', 'Healthcare'],
  ['TMO', 'Thermo Fisher', 'Healthcare'], ['NVO', 'Novo Nordisk', 'Healthcare'],
  ['XOM', 'Exxon Mobil', 'Energy'], ['CVX', 'Chevron', 'Energy'], ['COP', 'ConocoPhillips', 'Energy'],
  ['BA', 'Boeing', 'Industrial'], ['CAT', 'Caterpillar', 'Industrial'], ['GE', 'GE Aerospace', 'Industrial'],
  ['HON', 'Honeywell', 'Industrial'], ['LMT', 'Lockheed Martin', 'Industrial'], ['RTX', 'RTX', 'Industrial'],
  ['DE', 'Deere', 'Industrial'], ['SPCX', 'SpaceX', 'Industrial'],
  ['TSLA', 'Tesla', 'Automotive'], ['F', 'Ford', 'Automotive'], ['GM', 'General Motors', 'Automotive'],
  ['RIVN', 'Rivian', 'Automotive'],
  ['NFLX', 'Netflix', 'Communication'], ['DIS', 'Disney', 'Communication'], ['T', 'AT&T', 'Communication'],
  ['VZ', 'Verizon', 'Communication'], ['CMCSA', 'Comcast', 'Communication'], ['SPOT', 'Spotify', 'Communication'],
]
const UNIVERSE_META = Object.fromEntries(STOCK_UNIVERSE.map(([sym, name, sector]) => [sym, { name, sector }]))
const BOARD_SYMBOLS = STOCK_UNIVERSE.map(([sym]) => sym)

const INDEX_NAMES = {
  '^GSPC': 'S&P 500',
  '^DJI': 'Dow Jones',
  '^IXIC': 'Nasdaq',
  '^RUT': 'Russell 2000',
  '^VIX': 'VIX',
}

export const STOCK_SYMBOL_SET = new Set(BOARD_SYMBOLS)

// Manual refresh support - the topbar button busts this module cache so the
// remounted views fetch fresh quotes instead of the 120s snapshot.
export function bustStockCache() {
  _cache.quotes = null; _cache.indices = null; _cache.movers = null; _cache.ts = 0
  _wlQuoteCache.clear()
  _tradfiNews = null
}

// Module cache: one batch per session window - stock quotes barely move
// intra-visit, and never outside market hours.
const _cache = { quotes: null, indices: null, movers: null, ts: 0 }
const CACHE_TTL = 120000

function quotesToRows(quotes) {
  if (!quotes) return []
  return BOARD_SYMBOLS
    .map((sym) => {
      const q = quotes[sym]
      if (!q || !(q.price > 0)) return null
      const meta = UNIVERSE_META[sym] || FALLBACK_STOCK_DATA[sym]
      return {
        id: `stk-${sym}`,
        symbol: sym,
        name: meta?.name || q.name || sym,
        sector: meta?.sector || '',
        price: q.price,
        change: Number(q.change) || 0,
        marketCap: q.marketCap || 0,
        image: getStockLogoUrl(sym),
        isStock: true,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.marketCap - a.marketCap)
}

/**
 * Rows for the MONEY-FLOW total specifically — the PRO stock universe, not
 * LITE's curated board.
 *
 * 🪤 LITE's 77 household names are the right list for a "big names" board and
 * the WRONG list for "how much money was added to US stocks today". Measured
 * 2026-08-07: LITE answered $538.92B while PRO answered $402.10B, and the gap
 * was almost entirely SPCX (+$239.66B on the day) — carried by LITE's board and
 * missing from PRO's list. A market total has to come from ONE universe or the
 * two surfaces will always contradict each other, so the flow view reads the
 * same `POPULAR_STOCKS` the PRO heatmap does. `getStockQuotes` caches and
 * dedupes by symbol set, so this is one request, not a second copy of the board.
 */
export function useStockFlowRows(enabled) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const symbols = POPULAR_STOCKS.map((s) => s.symbol)
    getStockQuotes(symbols).then((q) => {
      if (cancelled || !q) return
      setRows(POPULAR_STOCKS.map((s) => {
        const quote = q[s.symbol]
        if (!quote || !(quote.price > 0)) return null
        return {
          id: `stk-${s.symbol}`,
          symbol: s.symbol,
          name: quote.name || s.name,
          sector: s.sector || '',
          price: quote.price,
          change: Number(quote.change) || 0,
          marketCap: quote.marketCap || 0,
          image: getStockLogoUrl(s.symbol),
          isStock: true,
        }
      }).filter(Boolean).sort((a, b) => b.marketCap - a.marketCap))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [enabled])
  return rows
}

// Stock rows in marketRow shape for the Heatmap/Bubbles stock source.
// Gated: fetches only once enabled, shares the module cache with StocksView.
export function useStockRows(enabled) {
  const [rows, setRows] = useState(() => quotesToRows(_cache.quotes))
  useEffect(() => {
    if (!enabled) return undefined
    if (_cache.quotes && Date.now() - _cache.ts < CACHE_TTL) { setRows(quotesToRows(_cache.quotes)); return undefined }
    let cancelled = false
    getStockQuotes(BOARD_SYMBOLS).then((q) => {
      if (cancelled || !q) return
      _cache.quotes = q; _cache.ts = Date.now()
      setRows(quotesToRows(q))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [enabled])
  return rows
}

const fmtChg = (v) => `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`

// ── Session countdown — "opens in 3h 12m", not a flat "Closed". ──
// Same NY-clock arithmetic as home's use-us-market-status; local so the label
// can be i18n-composed here. Returns minutes to the next 9:30 ET open (null
// while the session is live) and minutes to the 16:00 close (null when shut).
function marketClock() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const cur = et.getHours() * 60 + et.getMinutes()
  const OPEN = 9 * 60 + 30, CLOSE = 16 * 60
  const weekday = day >= 1 && day <= 5
  if (weekday && cur >= OPEN && cur < CLOSE) return { toOpen: null, toClose: CLOSE - cur }
  let toOpen
  if (weekday && cur < OPEN) toOpen = OPEN - cur
  else {
    // after close (or weekend): walk to the next weekday's open
    const daysAhead = day === 5 ? 3 : day === 6 ? 2 : 1
    toOpen = (24 * 60 - cur) + (daysAhead - 1) * 24 * 60 + OPEN
  }
  return { toOpen, toClose: null }
}
const fmtDur = (mins) => {
  const d = Math.floor(mins / (24 * 60)), h = Math.floor((mins % (24 * 60)) / 60), m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}
// 30s tick keeps the countdown honest on an open tab (hidden tabs skip).
function useMarketClock() {
  const [clock, setClock] = useState(marketClock)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setClock(marketClock()) }, 30000)
    const onVis = () => { if (!document.hidden) setClock(marketClock()) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return clock
}

const stkHeatStyle = (chg) => {
  const a = Math.min(0.9, 0.18 + Math.abs(Number(chg) || 0) / 9)
  return {
    '--hrgb': (Number(chg) || 0) >= 0 ? '16 185 129' : '239 68 68',
    '--ha': a,
    '--hap': Math.min(0.94, a + 0.4),
  }
}
const fmtIdx = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })

function StockLogo({ sym }) {
  const [step, setStep] = useState(0)
  if (step >= 2) {
    return <span className="lite-trow-logo"><span className="lite-trow-fallback">{sym[0]}</span></span>
  }
  return (
    <span className="lite-trow-logo">
      <img
        src={step === 0 ? getStockLogoUrl(sym) : getStockLogoFallback(sym)}
        alt=""
        loading="lazy"
        onError={() => setStep((s) => s + 1)}
      />
    </span>
  )
}

// Deterministic Wall Street brief: index band + breadth + sector rotation
// (growth vs value vs defensives) + VIX regime + the day's outlier.
function composeStocksBrief({ t, status, clock, spx, ndx, dji, vix, rows, sectors, movers }) {
  if (!spx || rows.length < 10) return null
  const tr = (key, dflt, vars) => t(`lite.brief.${key}`, dflt, vars)
  const chg = Number(spx.change) || 0
  const up = rows.filter((r) => r.change > 0).length
  const breadthStrong = up * 2 >= rows.length
  let headline
  if (chg > 1.5) headline = tr('stk_running', 'Wall Street is running.')
  else if (chg > 0.4) headline = tr('stk_climbing', 'Wall Street is climbing.')
  else if (chg > -0.4) headline = breadthStrong && up / rows.length > 0.62
    ? tr('stk_quiet_busy', 'Quiet index, busy tape.')
    : tr('stk_quiet', 'A quiet session on Wall Street.')
  else if (chg > -1.5) headline = tr('stk_slipping', 'Wall Street is slipping.')
  else headline = tr('stk_riskoff', 'Risk-off on Wall Street.')

  const parts = []
  if (status.isOpen) {
    parts.push(tr('stk_live_ctx', 'The session is live - numbers are moving.'))
  } else if (clock?.toOpen != null && clock.toOpen <= 12 * 60) {
    // "3 hours to the bell" must not read like a museum plaque
    parts.push(tr('stk_preopen_ctx', 'The opening bell is {{t}} away - these are last-close numbers.', { t: fmtDur(clock.toOpen) }))
  } else if (clock?.toOpen != null) {
    parts.push(tr('stk_reopen_ctx', 'Markets reopen in {{t}} - this is how the last session ended.', { t: fmtDur(clock.toOpen) }))
  } else {
    parts.push(tr('stk_closed_ctx', 'Markets are closed - this is how the last session ended.'))
  }
  parts.push(tr('stk_indices', 'The S&P 500 sits at {{px}} ({{spx}}), the Nasdaq is {{ndx}} and the Dow {{dji}}.', {
    px: fmtIdx(spx.price),
    spx: fmtChg(chg),
    ndx: ndx ? fmtChg(ndx.change) : '—',
    dji: dji ? fmtChg(dji.change) : '—',
  }))
  parts.push(t('lite.msg.stocks_breadth', '{{up}} of {{total}} of the biggest names are in the green.', { up, total: rows.length }))
  const secAvg = (names) => {
    const hit = sectors.filter((x) => names.includes(x.sector))
    return hit.length ? hit.reduce((a, b) => a + b.avg, 0) / hit.length : null
  }
  const growth = secAvg(['Technology', 'Semiconductor', 'Communication'])
  const value = secAvg(['Financial', 'Energy', 'Industrial'])
  const defensive = secAvg(['Healthcare', 'Consumer'])
  if (growth != null && value != null) {
    if (growth - value > 0.6) parts.push(tr('stk_growth_leads', 'Growth is leading - money is chasing tech and chips.'))
    else if (value - growth > 0.6) parts.push(tr('stk_value_leads', 'Value is leading - money is rotating into banks, energy and industrials.'))
    else if (defensive != null && chg < -0.3 && defensive > Math.max(growth, value)) parts.push(tr('stk_defensive', 'Defensives are catching the bid - a cautious tape.'))
    else if (sectors[0] && Math.abs(sectors[0].avg) >= 0.3) parts.push(t('lite.msg.stocks_sector_led', '{{sector}} leads at {{chg}}.', { sector: tl(t, sectors[0].sector), chg: fmtChg(sectors[0].avg) }))
  }
  const v = Number(vix?.price)
  if (v > 0) {
    if (v >= 25) parts.push(tr('stk_vix_fear', 'The VIX at {{v}} says traders are paying up for protection.', { v: v.toFixed(1) }))
    else if (v >= 18) parts.push(tr('stk_vix_nervous', 'The VIX at {{v}} shows some nerves under the surface.', { v: v.toFixed(1) }))
    else parts.push(tr('stk_vix_calm', 'Volatility is low (VIX {{v}}) - traders see smooth waters.', { v: v.toFixed(1) }))
  }
  const pool = [...(movers?.gainers || []), ...(movers?.losers || [])].filter((m) => m.price > 0)
  const outlier = pool.reduce((a, b) => (Math.abs(Number(b.change) || 0) > Math.abs(Number(a?.change) || 0) ? b : a), pool[0])
  if (outlier && Math.abs(Number(outlier.change)) >= 3) {
    parts.push(tr('stk_outlier', "{{sym}} is the day's outlier at {{chg}}.", { sym: outlier.symbol, chg: fmtChg(outlier.change) }))
  }
  return { headline, body: parts.join(' '), up, total: rows.length }
}

// Stocks-Today panel prefs - LITE-owned localStorage (no settings-store churn).
const STK_PANEL_KEY = 'spectre-lite-stocks-panels'
const STK_ORDER_KEY = 'spectre-lite-stocks-order'
const STK_DEFAULT_ORDER = ['brief', 'next48', 'board', 'earnings', 'movers', 'heat', 'news', 'watchlist', 'sectors']

function loadStkOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(STK_ORDER_KEY) || 'null')
    if (Array.isArray(saved)) {
      const known = saved.filter((k) => STK_DEFAULT_ORDER.includes(k))
      return [...known, ...STK_DEFAULT_ORDER.filter((k) => !known.includes(k))]
    }
  } catch (_) { /* fresh */ }
  return STK_DEFAULT_ORDER
}
const STK_PANEL_DEFS = [
  { key: 'brief', label: 'Market brief' },
  { key: 'next48', label: 'Next 48 hours' },
  { key: 'earnings', label: 'Upcoming earnings' },
  { key: 'heat', label: 'Heatmap' },
  { key: 'board', label: 'The big names' },
  { key: 'movers', label: 'Movers' },
  { key: 'sectors', label: 'Sectors' },
  { key: 'news', label: 'News' },
  { key: 'watchlist', label: 'Watchlist' },
]

function loadStkPanels() {
  try { return JSON.parse(localStorage.getItem(STK_PANEL_KEY) || '{}') || {} } catch (_) { return {} }
}

export default function StocksView({ data, fmtPrice, fmtLargeShort, onOpenPath, onPickResearch, wl }) {
  const { t, i18n } = useTranslation()
  const [quotes, setQuotes] = useState(_cache.quotes)
  const [indices, setIndices] = useState(_cache.indices)
  const [movers, setMovers] = useState(_cache.movers)
  const [earnings, setEarnings] = useState(_cache.earnings || [])
  const status = getMarketStatus()
  const clock = useMarketClock()

  // Upcoming earnings for the curated high-profile set (soonest-first). Cheap:
  // the service batch-caches ~30min + seeds from localStorage, so this is one
  // shared call regardless of how many Lite surfaces mount.
  useEffect(() => {
    if (_cache.earnings && _cache.earnTs && Date.now() - _cache.earnTs < CACHE_TTL) return undefined
    let cancelled = false
    getUpcomingEarnings().then((rows) => {
      if (cancelled || !Array.isArray(rows)) return
      _cache.earnings = rows; _cache.earnTs = Date.now(); setEarnings(rows)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (_cache.ts && Date.now() - _cache.ts < CACHE_TTL) return undefined
    let cancelled = false
    getStockQuotes(BOARD_SYMBOLS).then((q) => {
      if (cancelled || !q) return
      _cache.quotes = q; _cache.ts = Date.now(); setQuotes(q)
    }).catch(() => {})
    getMarketIndices().then((ix) => {
      if (cancelled || !ix) return
      // Serverless returns an object keyed by symbol; the client fallback
      // returns an array - normalize to an ordered array either way.
      const arr = Array.isArray(ix) ? ix : Object.values(ix)
      const order = Object.keys(INDEX_NAMES)
      arr.sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol))
      _cache.indices = arr; setIndices(arr)
    }).catch(() => {})
    getMarketMovers().then((m) => {
      if (cancelled || !m) return
      _cache.movers = m; setMovers(m)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const allRows = useMemo(() => quotesToRows(quotes), [quotes])
  const board = useMemo(() => allRows.slice(0, 25), [allRows])

  // Sector rollup derived from the whole universe - avg day move per sector.
  const sectors = useMemo(() => {
    const m = new Map()
    for (const r of allRows) {
      if (!r.sector || r.sector === 'Index') continue
      const e = m.get(r.sector) || { sector: r.sector, sum: 0, n: 0 }
      e.sum += r.change; e.n += 1
      m.set(r.sector, e)
    }
    return [...m.values()]
      .filter((e) => e.n >= 2)
      .map((e) => ({ ...e, avg: e.sum / e.n }))
      .sort((a, b) => b.avg - a.avg)
  }, [board])

  const upCount = board.filter((r) => r.change > 0).length
  const spx = indices?.find((i) => i.symbol === '^GSPC')
  const vix = indices?.find((i) => i.symbol === '^VIX')
  const bandIndices = (indices || []).filter((i) => i.symbol !== '^VIX' && i.symbol !== '^RUT')

  const statusLabel = status.status === 'REGULAR' ? tl(t, 'Market open', 'lbl')
    : status.status === 'PRE' ? tl(t, 'Pre-market', 'lbl')
      : status.status === 'POST' ? tl(t, 'After hours', 'lbl')
        : tl(t, 'Closed', 'lbl')

  const ndxIdx = indices?.find((i) => i.symbol === '^IXIC')
  const djiIdx = indices?.find((i) => i.symbol === '^DJI')
  const brief = useMemo(() => composeStocksBrief({
    t, status, clock, spx, ndx: ndxIdx, dji: djiIdx, vix, rows: allRows, sectors, movers,
  }), [t, status.isOpen, clock, spx, ndxIdx, djiIdx, vix, allRows, sectors, movers])

  // Customizable panels (Edit popover, same pattern as the crypto Today).
  const [stkPanels, setStkPanels] = useState(loadStkPanels)
  const [stkOrder, setStkOrder] = useState(loadStkOrder)
  const [editOpen, setEditOpen] = useState(false)
  const commitOrder = (next) => {
    setStkOrder(next)
    try { localStorage.setItem(STK_ORDER_KEY, JSON.stringify(next)) } catch (_) { /* private mode */ }
  }
  const drag = useDragReorder(stkOrder, commitOrder)
  const show = (k) => stkPanels[k] !== false
  const setPanel = (k, on) => {
    const next = { ...stkPanels, [k]: on }
    setStkPanels(next)
    try { localStorage.setItem(STK_PANEL_KEY, JSON.stringify(next)) } catch (_) { /* private mode */ }
  }
  const wlEntries = (data?.watchlistEntries || []).slice(0, 5)
  const wlSyms = wlEntries.map((e) => (e.symbol || '').toUpperCase()).filter(Boolean)
  const wlQuotes = useStockQuotesFor(wlSyms)

  const gainers = (movers?.gainers || []).filter((m) => m.price > 0).slice(0, 6)
  const losers = (movers?.losers || []).filter((m) => m.price > 0).slice(0, 6)

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Stocks', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Wall Street, zoomed out.', 'sub')}</p>
      </header>

      <div className="lite-toolrow lite-toolrow--edit lite-rise">
        <div className="lite-editwrap">
          <button type="button" className="lite-pill lite-edit-btn" aria-expanded={editOpen} onClick={() => setEditOpen((o) => !o)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
            {t('lite.edit', 'Edit')}
          </button>
          <LiteEditPop open={editOpen} onClose={() => setEditOpen(false)} label={t("lite.sections", "Sections")}>
              <p className="lite-editpop-title">{t('lite.sections', 'Sections')}</p>
              <div ref={drag.listRef} className="lite-editlist">
              {stkOrder.map((key) => {
                const def = STK_PANEL_DEFS.find((d) => d.key === key)
                if (!def) return null
                const on = show(key)
                return (
                  <div key={key} className={`lite-editrow${drag.dragKey === key ? ' lite-editrow--dragging' : ''}`} {...drag.rowProps(key)}>
                    <button type="button" className="lite-editrow-main" role="switch" aria-checked={on} onClick={() => setPanel(key, !on)}>
                      <span>{tl(t, def.label, 'lbl')}</span>
                      <span className={`lite-switch${on ? ' on' : ''}`} aria-hidden><span className="lite-switch-knob" /></span>
                    </button>
                    <button type="button" className="lite-grip" aria-label={`Drag to reorder ${def.label}`} {...drag.gripProps(key)}>
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                    </button>
                  </div>
                )
              })}
              </div>
          </LiteEditPop>
        </div>
      </div>

      <div className="lite-statband lite-statband--five lite-rise">
        <div className="lite-stat">
          <em>{tl(t, 'Session', 'lbl')}</em>
          <strong className={status.isOpen ? 'up' : ''}>{statusLabel}</strong>
          <span className={!status.isOpen && clock.toOpen != null && clock.toOpen <= 120 ? 'up' : undefined}>
            {status.isOpen && clock.toClose != null
              ? t('lite.msg.closes_in', 'closes in {{t}}', { t: fmtDur(clock.toClose) })
              : clock.toOpen != null
                ? t('lite.msg.opens_in', 'opens in {{t}}', { t: fmtDur(clock.toOpen) })
                : tl(t, 'showing last close', 'msg')}
          </span>
        </div>
        {!indices && <div className="lite-stat"><em>…</em><strong>—</strong><span /></div>}
        {bandIndices.map((ix) => (
          <div className="lite-stat lite-stat--link" key={ix.symbol} role="button" tabIndex={0}
            onClick={() => onPickResearch?.(ix.symbol, { stock: true })}
            onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(ix.symbol, { stock: true }) }}>
            <em>{INDEX_NAMES[ix.symbol] || ix.name}</em>
            <strong>{fmtIdx(ix.price)}</strong>
            <span className={`lite-change ${ix.change >= 0 ? 'up' : 'down'}`}>{fmtChg(ix.change)}</span>
          </div>
        ))}
        {vix && (
          <div className="lite-stat lite-stat--link" role="button" tabIndex={0}
            onClick={() => onPickResearch?.('^VIX', { stock: true })}
            onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.('^VIX', { stock: true }) }}>
            <em>VIX</em>
            <strong className={vix.price >= 25 ? 'down' : ''}>{fmtIdx(vix.price)}</strong>
            <span>{vix.price >= 25 ? tl(t, 'nervous tape', 'msg') : vix.price >= 18 ? tl(t, 'some caution', 'msg') : tl(t, 'calm tape', 'msg')}</span>
          </div>
        )}
      </div>

      <div className="lite-grid lite-rise-1">
        {stkOrder.map((pk) => {
          if (!show(pk)) return null
          if (pk === 'brief') {
            // Brief + Next-48h pair up as one row when both are on
            return brief ? (
              <section key="brief" className={`lite-panel lite-panel--brief ${show('next48') ? 'lite-span-7' : 'lite-span-12'}`}>
                <p className="lite-eyebrow">{tl(t, 'Market brief', 'lbl')}</p>
                <h2 className="lite-brief-headline">{brief.headline}</h2>
                <p className="lite-brief-body">{brief.body}</p>
                <div className="lite-tone-bar" aria-hidden style={{ marginTop: 14 }}>
                  <span className="lite-tone-bull" style={{ width: `${(brief.up / brief.total) * 100}%` }} />
                  <span className="lite-tone-bear" style={{ width: `${100 - (brief.up / brief.total) * 100}%` }} />
                </div>
                <div className="lite-tone-legend">
                  <span className="up">{brief.up} {tl(t, 'rising', 'lbl')}</span>
                  <span className="down">{brief.total - brief.up} {tl(t, 'falling', 'lbl')}</span>
                </div>
              </section>
            ) : null
          }
          if (pk === 'next48') {
            return <LiteNext48 key="next48" mode="stocks" span={show('brief') && brief ? 5 : 12} onPickResearch={onPickResearch} />
          }
          if (pk === 'board') {
            return (
              <section key="board" className="lite-panel lite-span-8">
                <p className="lite-eyebrow">{tl(t, 'The big names', 'ttl')}</p>
                {board.length === 0 ? <SkelRows n={8} /> : (
                  <ul className="lite-tlist">
                    {board.map((r) => (
                      <li key={r.symbol} className="lite-trow lite-trow--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(r.symbol, { stock: true })} onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol, { stock: true }) }}>
                        <StockLogo sym={r.symbol} />
                        <span className="lite-trow-id">
                          <strong>{r.name}</strong>
                          <em>{r.symbol}{r.sector ? ` · ${tl(t, r.sector)}` : ''}</em>
                        </span>
                        {r.marketCap > 0 && <span className="lite-trow-mcap">{fmtLargeShort(r.marketCap)}</span>}
                        <span className="lite-trow-price">{fmtPrice(r.price)}</span>
                        <span className={`lite-change ${r.change >= 0 ? 'up' : 'down'}`}>{fmtChg(r.change)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          }
          if (pk === 'earnings') {
            const rows = (earnings || []).filter((e) => e?.earningsDate).slice(0, 8)
            return (
              <section key="earnings" className="lite-panel lite-span-8">
                <p className="lite-eyebrow">{tl(t, 'Upcoming earnings', 'ttl')}</p>
                {rows.length === 0 ? <SkelRows n={4} /> : (
                  <ul className="lite-tlist">
                    {rows.map((e) => {
                      const days = daysUntil(e.earningsDate)
                      const soon = days >= 0 && days <= 7
                      const when = days < 0 ? tl(t, 'reported', 'lbl')
                        : days === 0 ? tl(t, 'today', 'lbl')
                        : days === 1 ? tl(t, 'tomorrow', 'lbl')
                        : `${days}d`
                      const dateStr = new Date(e.earningsDate).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })
                      const epsSub = e.epsEstimate != null ? ` · ${t('lite.msg.est_eps', 'est EPS ${{v}}', { v: Number(e.epsEstimate).toFixed(2) })}` : ''
                      return (
                        <li key={e.symbol} className="lite-trow lite-trow--link" role="button" tabIndex={0}
                          onClick={() => onPickResearch?.(e.symbol, { stock: true })}
                          onKeyDown={(ev) => { if (ev.key === 'Enter') onPickResearch?.(e.symbol, { stock: true }) }}>
                          <StockLogo sym={e.symbol} />
                          <span className="lite-trow-id">
                            <strong>{e.name || e.symbol}</strong>
                            <em>{e.symbol}{epsSub}</em>
                          </span>
                          <span className="lite-trow-mcap">{dateStr}</span>
                          <span className={`lite-change${soon ? ' down' : ''}`}>{when}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          }
          if (pk === 'movers') {
            return (
              <div key="movers" className="lite-span-4 lite-col">
                <section className="lite-panel">
                  <p className="lite-eyebrow">{tl(t, 'Winning', 'lbl')}</p>
                  <ul className="lite-mini-list">
                    {gainers.length === 0 && <SkelRows n={4} />}
                    {gainers.map((m) => (
                      <li key={m.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(m.symbol, { stock: true })}>
                        <StockLogo sym={m.symbol} />
                        <span className="lite-mini-sym">{m.symbol}</span>
                        <span className="lite-mini-price">{fmtPrice(m.price)}</span>
                        <span className="lite-change up">{fmtChg(m.change)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="lite-panel">
                  <p className="lite-eyebrow">{tl(t, 'Losing', 'lbl')}</p>
                  <ul className="lite-mini-list">
                    {losers.length === 0 && <SkelRows n={4} />}
                    {losers.map((m) => (
                      <li key={m.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(m.symbol, { stock: true })}>
                        <StockLogo sym={m.symbol} />
                        <span className="lite-mini-sym">{m.symbol}</span>
                        <span className="lite-mini-price">{fmtPrice(m.price)}</span>
                        <span className="lite-change down">{fmtChg(m.change)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            )
          }
          if (pk === 'heat') {
            return allRows.length > 0 ? (
              <div key="heat" className="lite-span-12">
                <div className="lite-heat" aria-label={t('lite.stocksview.ariaStockHeatmap', "Stock heatmap")}>
                  {allRows.slice(0, 12).map((r, i) => (
                    <div key={r.id} className={`lite-heat-tile lite-heat-tile--link${i < 4 ? ' lite-heat-tile--big' : ''}`} style={stkHeatStyle(r.change)} role="button" tabIndex={0}
                      onClick={() => onPickResearch?.(r.symbol, { stock: true })}
                      onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol, { stock: true }) }}>
                      <span className="lite-heat-sym">{r.symbol}</span>
                      <span className="lite-heat-price">{fmtPrice(r.price)}</span>
                      <span className="lite-heat-chg">{fmtChg(r.change)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null
          }
          if (pk === 'news') {
            return <StkNewsPanel key="news" t={t} />
          }
          if (pk === 'watchlist') {
            return wlSyms.length > 0 ? (
              <section key="watchlist" className={`lite-panel ${show('news') ? 'lite-span-5' : 'lite-span-12'}`}>
                <p className="lite-eyebrow">{t('lite.tab.watchlist', 'Watchlist')}</p>
                <ul className="lite-mini-list">
                  {wlEntries.map((e) => {
                    const sym = (e.symbol || '').toUpperCase()
                    const q = wlQuotes?.[sym]
                    return (
                      <li key={sym} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(sym, { stock: true })}>
                        <span className="lite-mini-sym">{sym}</span>
                        {q?.price > 0 && <span className="lite-mini-price">{fmtPrice(q.price)}</span>}
                        {q && <span className={`lite-change ${(Number(q.change) || 0) >= 0 ? 'up' : 'down'}`}>{fmtChg(Number(q.change) || 0)}</span>}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null
          }
          if (pk === 'sectors') {
            return sectors.length > 0 ? (
              <section key="sectors" className="lite-panel lite-span-12">
                <p className="lite-eyebrow">{tl(t, 'Sectors today', 'ttl')}</p>
                <ul className="lite-stat-list lite-stat-list--sectors">
                  {sectors.map((sc) => (
                    <li key={sc.sector}>
                      <span>{tl(t, sc.sector)} <em>({t('lite.msg.n_names', '{{n}} names', { n: sc.n })})</em></span>
                      <strong className={`lite-change ${sc.avg >= 0 ? 'up' : 'down'}`}>{fmtChg(sc.avg)}</strong>
                    </li>
                  ))}
                </ul>
                <p className="lite-social-note">{tl(t, 'Averages across the big-name board above - a rough day read, not the full sector index.', 'msg')}</p>
              </section>
            ) : null
          }
          return null
        })}
      </div>

      {onOpenPath && (
        <button type="button" className="lite-prolink lite-rise-1" onClick={() => { track(Events.LITE_PRO_DOOR, { path: '/heatmaps' }); onOpenPath('/heatmaps') }}>
          {tl(t, 'Stock heatmaps and the full desk in PRO', 'msg')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  )
}

// Local skeleton + PRO door (lite-page's versions aren't importable here -
// dependency stays one-directional).
function SkelRows({ n = 4 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </ul>
  )
}

// ─── Stocks-mode suite (rendered by lite-page when market === 'stocks') ───

// Quotes for arbitrary symbols (stock watchlist entries) - own small cache.
// TTL'd: a long-lived tab must not pin the morning quote ("no stale please").
const QUOTE_TTL = 3 * 60 * 1000
const NEWS_TTL = 10 * 60 * 1000
const _wlQuoteCache = new Map()

export function useStockQuotesFor(syms) {
  const key = [...syms].sort().join(',')
  const [quotes, setQuotes] = useState(() => {
    const e = _wlQuoteCache.get(key)
    return e && Date.now() - e.ts < QUOTE_TTL ? e.data : null
  })
  useEffect(() => {
    if (!key) { setQuotes({}); return undefined }
    const hit = _wlQuoteCache.get(key)
    if (hit && Date.now() - hit.ts < QUOTE_TTL) { setQuotes(hit.data); return undefined }
    let cancelled = false
    getStockQuotes(key.split(',')).then((q) => {
      if (cancelled || !q) return
      _wlQuoteCache.set(key, { ts: Date.now(), data: q })
      setQuotes(q)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [key])
  return quotes
}

function useStockMovers(enabled) {
  const [movers, setMovers] = useState(_cache.movers)
  useEffect(() => {
    if (!enabled || _cache.movers) return undefined
    let cancelled = false
    getMarketMovers().then((m) => {
      if (cancelled || !m) return
      _cache.movers = m; setMovers(m)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [enabled])
  return movers
}

// Star that adds STOCK entries (isStock rides into the PRO dual watchlist).
function StockStar({ wl, sym, name }) {
  if (!wl?.has) return null
  const starred = wl.has(sym)
  return (
    <button
      type="button"
      className={`lite-star${starred ? ' on' : ''}`}
      aria-label={starred ? `Remove ${sym} from watchlist` : `Add ${sym} to watchlist`}
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
      onClick={(e) => { e.stopPropagation(); starred ? wl.remove(sym) : wl.add({ symbol: sym, name: name || sym, isStock: true, assetClass: 'stock' }) }}
    >
      <svg viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3z" />
      </svg>
    </button>
  )
}

function StockRow({ r, rank, fmtPrice, fmtLargeShort, wl, onPickResearch, t }) {
  return (
    <li className="lite-trow lite-trow--link" role="button" tabIndex={0}
      onClick={() => onPickResearch?.(r.symbol, { stock: true })}
      onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol, { stock: true }) }}>
      {rank != null && <span className="lite-trow-rank">{rank}</span>}
      <StockLogo sym={r.symbol} />
      <span className="lite-trow-id">
        <strong>{r.name}</strong>
        <em>{r.symbol}{r.sector ? ` · ${tl(t, r.sector)}` : ''}</em>
      </span>
      {r.marketCap > 0 && <span className="lite-trow-mcap">{fmtLargeShort(r.marketCap)}</span>}
      <span className="lite-trow-price">{fmtPrice(r.price)}</span>
      <span className={`lite-change ${r.change >= 0 ? 'up' : 'down'}`}>{fmtChg(r.change)}</span>
      <StockStar wl={wl} sym={r.symbol} name={r.name} />
    </li>
  )
}

export function StockMarketsView({ fmtPrice, fmtLargeShort, onOpenPath, onPickResearch, wl, onCinema }) {
  const { t } = useTranslation()
  const rows = useStockRows(true)
  const [sort, setSort] = useState('size')
  const status = getMarketStatus()
  const clock = useMarketClock()
  const sorted = useMemo(() => (
    sort === 'change' ? [...rows].sort((a, b) => b.change - a.change) : rows
  ), [rows, sort])
  const up = rows.filter((r) => r.change > 0).length
  const totalCap = rows.reduce((s, r) => s + (r.marketCap || 0), 0)
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Markets', 'ttl')}</h1>
        <p className="lite-view-sub">{t('lite.sub.stock_markets', 'The {{n}} names that move Wall Street, in one board.', { n: rows.length || STOCK_UNIVERSE.length })}</p>
        {onCinema && rows.length > 0 && <CinemaButton label={tl(t, 'Cinema', 'lbl')} onClick={() => onCinema(tl(t, 'Trending', 'ttl'), sorted)} />}
      </header>
      {rows.length > 0 && (
        <div className="lite-statband lite-rise">
          <div className="lite-stat">
            <em>{tl(t, 'Session', 'lbl')}</em>
            <strong className={status.isOpen ? 'up' : ''}>{status.isOpen ? tl(t, 'Market open', 'lbl') : tl(t, 'Closed', 'lbl')}</strong>
            <span className={!status.isOpen && clock.toOpen != null && clock.toOpen <= 120 ? 'up' : undefined}>
              {status.isOpen && clock.toClose != null
                ? t('lite.msg.closes_in', 'closes in {{t}}', { t: fmtDur(clock.toClose) })
                : clock.toOpen != null
                  ? t('lite.msg.opens_in', 'opens in {{t}}', { t: fmtDur(clock.toOpen) })
                  : tl(t, 'showing last close', 'msg')}
            </span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, 'Board value', 'lbl')}</em>
            <strong>{fmtLargeShort(totalCap)}</strong>
            <span>{t('lite.msg.combined_n_names', 'combined, {{n}} names', { n: rows.length })}</span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, 'Market breadth', 'lbl')}</em>
            <strong className={up * 2 >= rows.length ? 'up' : 'down'}>{up} / {rows.length}</strong>
            <span>{tl(t, 'names in the green', 'msg')}</span>
          </div>
        </div>
      )}
      <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.stockmarketsview.ariaSort', "Sort")}>
        {[{ id: 'size', label: 'Size' }, { id: 'change', label: 'Day move' }].map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={sort === o.id} className={`lite-tf-btn${sort === o.id ? ' active' : ''}`} onClick={() => setSort(o.id)}>{tl(t, o.label)}</button>
        ))}
      </div>
      <section className="lite-panel lite-rise-1">
        {sorted.length === 0 ? <SkelRows n={10} /> : (
          <ul className="lite-tlist">
            {sorted.map((r, i) => (
              <StockRow key={r.id} r={r} rank={i + 1} fmtPrice={fmtPrice} fmtLargeShort={fmtLargeShort} wl={wl} onPickResearch={onPickResearch} t={t} />
            ))}
          </ul>
        )}
      </section>
      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={() => { track(Events.LITE_PRO_DOOR, { path: '/heatmaps' }); onOpenPath('/heatmaps') }}>
          {tl(t, 'Stock heatmaps and the full desk in PRO', 'msg')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  )
}

export function StockMoversView({ fmtPrice, fmtLargeShort, onOpenPath, onPickResearch, wl, onCinema }) {
  const { t } = useTranslation()
  const movers = useStockMovers(true)
  const rows = useStockRows(true)
  const lists = [
    { key: 'gainers', label: 'Winning', cls: 'up', items: (movers?.gainers || []).filter((m) => m.price > 0).slice(0, 10) },
    { key: 'losers', label: 'Losing', cls: 'down', items: (movers?.losers || []).filter((m) => m.price > 0).slice(0, 10) },
    { key: 'mostActive', label: 'Most traded', cls: '', items: (movers?.mostActive || []).filter((m) => m.price > 0).slice(0, 10) },
  ]
  const up = rows.filter((r) => r.change > 0).length
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Movers', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, "The stocks making today's headlines - up, down and heavily traded.", 'sub')}</p>
        {onCinema && (lists[0].items.length > 0 || lists[1].items.length > 0) && <CinemaButton label={tl(t, 'Cinema', 'lbl')} onClick={() => onCinema(tl(t, 'Movers', 'ttl'), [...lists[0].items, ...lists[1].items])} />}
      </header>
      {rows.length > 0 && (
        <div className="lite-statband lite-rise">
          <div className="lite-stat">
            <em>{tl(t, 'Market breadth', 'lbl')}</em>
            <strong className={up * 2 >= rows.length ? 'up' : 'down'}>{up} / {rows.length}</strong>
            <span>{tl(t, 'names in the green', 'msg')}</span>
          </div>
          {lists[0].items[0] && (
            <div className="lite-stat">
              <em>{tl(t, 'Top winner', 'lbl')}</em>
              <strong>{lists[0].items[0].symbol}</strong>
              <span className="lite-change up">{fmtChg(lists[0].items[0].change)}</span>
            </div>
          )}
          {lists[1].items[0] && (
            <div className="lite-stat">
              <em>{tl(t, 'Top loser', 'lbl')}</em>
              <strong>{lists[1].items[0].symbol}</strong>
              <span className="lite-change down">{fmtChg(lists[1].items[0].change)}</span>
            </div>
          )}
        </div>
      )}
      <div className="lite-grid lite-rise-1">
        {lists.map((L) => (
          <section key={L.key} className="lite-panel lite-span-4">
            <p className="lite-eyebrow">{tl(t, L.label, 'lbl')}</p>
            <ul className="lite-mini-list">
              {L.items.length === 0 && <SkelRows n={6} />}
              {L.items.map((m) => (
                <li key={m.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(m.symbol, { stock: true })}>
                  <StockLogo sym={m.symbol} />
                  <span className="lite-mini-sym">{m.symbol}</span>
                  <span className="lite-mini-price">{fmtPrice(m.price)}</span>
                  <span className={`lite-change ${L.key === 'mostActive' ? (m.change >= 0 ? 'up' : 'down') : L.cls}`}>{fmtChg(m.change)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={() => { track(Events.LITE_PRO_DOOR, { path: '/heatmaps' }); onOpenPath('/heatmaps') }}>
          {tl(t, 'Stock heatmaps and the full desk in PRO', 'msg')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  )
}

export function StockSectorsView({ fmtPrice, fmtLargeShort, onOpenPath, onPickResearch, wl }) {
  const { t } = useTranslation()
  const rows = useStockRows(true)
  const [openSector, setOpenSector] = useState(null)
  const sectors = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (!r.sector) continue
      const e = m.get(r.sector) || { sector: r.sector, sum: 0, n: 0, cap: 0, members: [] }
      e.sum += r.change; e.n += 1; e.cap += r.marketCap || 0; e.members.push(r)
      m.set(r.sector, e)
    }
    return [...m.values()]
      .map((e) => ({ ...e, avg: e.sum / e.n, members: e.members.sort((a, b) => b.marketCap - a.marketCap) }))
      .sort((a, b) => b.avg - a.avg)
  }, [rows])
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Sectors', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Which corners of the stock market are working today - tap one to see its names.', 'sub')}</p>
      </header>
      <div className="lite-grid lite-rise-1">
        {sectors.length === 0 ? (
          <section className="lite-panel lite-span-12"><SkelRows n={8} /></section>
        ) : sectors.map((sec) => (
          <section key={sec.sector} className={`lite-panel lite-span-4 lite-sector-card${openSector === sec.sector ? ' lite-sector-card--open' : ''}`} role="button" tabIndex={0}
            onClick={() => setOpenSector(openSector === sec.sector ? null : sec.sector)}
            onKeyDown={(e) => { if (e.key === 'Enter') setOpenSector(openSector === sec.sector ? null : sec.sector) }}>
            <p className="lite-eyebrow">{tl(t, sec.sector)}</p>
            <p className={`lite-research-change ${sec.avg >= 0 ? 'up' : 'down'}`} style={{ fontSize: '1.4rem', margin: '2px 0 4px' }}>{fmtChg(sec.avg)}</p>
            <p className="lite-social-note" style={{ margin: 0 }}>{t('lite.msg.n_names_worth', '{{n}} names worth {{cap}}', { n: sec.n, cap: fmtLargeShort(sec.cap) })}</p>
            {openSector === sec.sector && (
              <ul className="lite-mini-list" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                {sec.members.map((r) => (
                  <li key={r.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(r.symbol, { stock: true })}>
                    <span className="lite-mini-sym">{r.symbol}</span>
                    <span className="lite-mini-price">{fmtPrice(r.price)}</span>
                    <span className={`lite-change ${r.change >= 0 ? 'up' : 'down'}`}>{fmtChg(r.change)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <p className="lite-social-note lite-rise-1">{tl(t, 'Sector moves are averages across the board above - a day read, not the official index.', 'msg')}</p>
    </div>
  )
}

// TradFi headlines from the desk feed (no article links upstream - honest cards).
let _tradfiNews = null // { ts, data }
const _freshTradfi = () => (_tradfiNews && Date.now() - _tradfiNews.ts < NEWS_TTL ? _tradfiNews.data : null)

function useTradfiNews(enabled) {
  const [items, setItems] = useState(_freshTradfi)
  useEffect(() => {
    if (!enabled || _freshTradfi()) return undefined
    let cancelled = false
    fetch('/data-api/v1/news/tradfi?hours=168&limit=40', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return
        const rows = (payload?.data || [])
          .map((r, i) => ({
            id: r.event_key || String(i),
            title: r.headline || '',
            context: r.context || '',
            category: r.category || '',
            sentiment: r.sentiment || '',
            ts: r.ts ? Math.floor(new Date(r.ts).getTime() / 1000) : 0,
          }))
          .filter((r) => r.title)
        _tradfiNews = { ts: Date.now(), data: rows }
        setItems(rows)
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [enabled])
  return items
}

export function StockNewsView({ onOpenPath }) {
  const { t } = useTranslation()
  const [items, setItems] = useState(_freshTradfi)
  useEffect(() => {
    if (_freshTradfi()) return undefined
    let cancelled = false
    fetch('/data-api/v1/news/tradfi?hours=168&limit=40', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return
        const rows = (payload?.data || [])
          .map((r, i) => ({
            id: r.event_key || String(i),
            title: r.headline || '',
            context: r.context || '',
            category: r.category || '',
            sentiment: r.sentiment || '',
            ts: r.ts ? Math.floor(new Date(r.ts).getTime() / 1000) : 0,
          }))
          .filter((r) => r.title)
        _tradfiNews = { ts: Date.now(), data: rows }
        setItems(rows)
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [])
  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'News', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'The market-moving headlines from the traditional side, machine-filtered for importance.', 'sub')}</p>
      </header>
      <section className="lite-panel lite-rise-1">
        {items === null ? <SkelRows n={8} /> : items.length === 0 ? (
          <p className="lite-empty">{tl(t, 'No fresh TradFi headlines in the last week - check back in a bit.', 'msg')}</p>
        ) : (
          <ul className="lite-news-list">
            {items.map((n) => (
              <li key={n.id}>
                {/* Stacked inside .lite-news-body like the crypto list. As DIRECT
                    children of the flex link, the metas are nowrap + no-shrink,
                    so a long `context` sentence took the whole row and the
                    title collapsed to one letter per line. */}
                <div className="lite-news-link">
                  <span className="lite-news-body">
                    <span className="lite-news-title">{n.title}</span>
                    {n.context && <span className="lite-news-meta lite-news-context">{n.context}</span>}
                    <span className="lite-news-meta">
                      {[n.category ? tl(t, n.category) : null, n.sentiment ? tl(t, n.sentiment) : null, n.ts ? liteTimeAgo(n.ts, t) : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export function StockWatchlistView({ data, fmtPrice, fmtLargeShort, onOpenPath, wl, onPickResearch, search, onCinema }) {
  const { t } = useTranslation()
  const entries = (data.watchlistEntries || [])
  const syms = entries.map((e) => (e.symbol || '').toUpperCase()).filter(Boolean)
  const quotes = useStockQuotesFor(syms)
  const priced = syms.map((sym) => ({ sym, q: quotes?.[sym] })).filter((x) => x.q?.price > 0)
  const avg = priced.length ? priced.reduce((s, x) => s + (Number(x.q.change) || 0), 0) / priced.length : null
  const cinemaRows = entries.map((e) => { const s = (e.symbol || '').toUpperCase(); const q = quotes?.[s] || {}; return { symbol: s, name: e.name || s, price: q.price, change: q.change, marketCap: q.marketCap, volume: q.volume } })
  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Watchlist', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Your stocks, nothing else.', 'sub')}</p>
        {onCinema && entries.length > 0 && <CinemaButton label={tl(t, 'Cinema', 'lbl')} onClick={() => onCinema(tl(t, 'Watchlist', 'ttl'), cinemaRows)} />}
      </header>
      {search && <div className="lite-rise lite-search-wrap">{search}</div>}
      {priced.length >= 2 && (
        <div className="lite-statband lite-rise">
          <div className="lite-stat">
            <em>{tl(t, 'Stocks', 'ttl')}</em>
            <strong>{priced.length}</strong>
            <span>{tl(t, 'on your list', 'msg')}</span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, 'Average day', 'lbl')}</em>
            <strong className={avg >= 0 ? 'up' : 'down'}>{fmtChg(avg)}</strong>
            <span>{tl(t, 'across the list', 'msg')}</span>
          </div>
        </div>
      )}
      <section className="lite-panel lite-rise-1">
        {entries.length === 0 ? (
          <p className="lite-empty">{tl(t, 'Your stock watchlist is empty. Star any stock on the board or in research and it lands here.', 'msg')}</p>
        ) : (
          <ul className="lite-tlist">
            {entries.map((tk) => {
              const sym = (tk.symbol || '').toUpperCase()
              const q = quotes?.[sym]
              const meta = UNIVERSE_META[sym]
              return (
                <li key={sym} className="lite-trow lite-trow--link" role="button" tabIndex={0}
                  onClick={() => onPickResearch?.(sym, { stock: true })}
                  onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(sym, { stock: true }) }}>
                  <StockLogo sym={sym} />
                  <span className="lite-trow-id">
                    <strong>{tk.name || meta?.name || sym}</strong>
                    <em>{sym}</em>
                  </span>
                  {q?.marketCap > 0 && <span className="lite-trow-mcap">{fmtLargeShort(q.marketCap)}</span>}
                  {q?.price > 0 && <span className="lite-trow-price">{fmtPrice(q.price)}</span>}
                  {q && <span className={`lite-change ${(Number(q.change) || 0) >= 0 ? 'up' : 'down'}`}>{fmtChg(Number(q.change) || 0)}</span>}
                  <StockStar wl={wl} sym={sym} name={tk.name || meta?.name} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <p className="lite-social-note lite-rise-1">{tl(t, 'Your stock list is separate from your crypto list - the toggle up top switches between them, in LITE and PRO alike.', 'msg')}</p>
    </div>
  )
}

function StkNewsPanel({ t }) {
  const items = useTradfiNews(true)
  return (
    <section className="lite-panel lite-span-7">
      <p className="lite-eyebrow">{t('lite.tab.news', 'News')}</p>
      {items === null ? <SkelRows n={4} /> : items.length === 0 ? (
        <p className="lite-empty">{tl(t, 'No fresh TradFi headlines in the last week - check back in a bit.', 'msg')}</p>
      ) : (
        <ul className="lite-news-list">
          {items.slice(0, 4).map((n) => (
            <li key={n.id}>
              <div className="lite-news-link">
                <span className="lite-news-title">{n.title}</span>
                <span className="lite-news-meta">{[n.category ? tl(t, n.category) : null, n.ts ? liteTimeAgo(n.ts, t) : null].filter(Boolean).join(' · ')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

