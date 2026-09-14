/**
 * Data layer for the LITE landing designs. One hook feeds both looks (Glass /
 * Paper) so switching modes never refetches. Everything rides existing cached
 * services - no new endpoints, no LLM calls: the "brief" is composed
 * deterministically from live numbers (zero cost, always fresh, never slop).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { wireImage } from '@/pages/news/components/wire-art'
import { getTopCoinPrices, getBinancePrices } from '@/services/binanceApi'
import { getMajorTokenPrices, getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { getStockQuotes } from '@/services/stockApi'
import { getSpectrePricesBySymbols, getSpectreAltSeason, getSpectreCategories } from '@/services/spectreMarketApi'
import { getFearGreedCurrent, getGlobalMetrics, getTopMovers } from '@/services/fearGreedApi'
import { getCryptoNews } from '@/services/cryptoNewsApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { readXDashHealth, timeframeForHours } from '@/lib/xdash-health'

export const LITE_TOP_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']

const isStockToken = (tk) => tk?.isStock === true || tk?.assetClass === 'stock'

// Stable/wrapped assets are dead weight on movers and heatmap surfaces
// (a stablecoin "moving" ±0.01% is noise, wrapped majors duplicate the real
// coin). Symbol heuristic - the LITE universe is top-40 + movers only.
const STABLE_WRAPPED = new Set([
  'USDT', 'USDC', 'USDS', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'PYUSD', 'USD1',
  'USDD', 'USDY', 'USYC', 'USDG', 'RLUSD', 'GUSD', 'BUSD', 'USDP', 'FRAX',
  'WBTC', 'WETH', 'WSTETH', 'STETH', 'WBETH', 'WEETH', 'CBBTC', 'RETH',
  'SOLVBTC', 'CBETH', 'LSETH', 'METH', 'EZETH', 'JITOSOL', 'MSOL', 'BNSOL',
])

export function isStableOrWrapped(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (STABLE_WRAPPED.has(s)) return true
  return /^US[DS]|USD$|^W(BTC|ETH|SOL|BNB)$/.test(s)
}

// The X Dash bootstrap lands one board. `_health`/`window_hours` say which
// WINDOW the answer is for; when it is not ours and carries no rows, the run
// that builds our window never landed and asking again for the live one is the
// only way to get a board. One retry, never a loop - if the live window is also
// empty the feed genuinely has nothing and the caller says so.
const XDASH_BOOTSTRAP_DEFAULT_TF = '24h'

function cleanPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n <= 1 ? n * 100 : n
}

function mapSocialRows(payload) {
  const rows = Array.isArray(payload?.tokens) ? payload.tokens : (Array.isArray(payload?.data) ? payload.data : [])
  return rows.slice(0, 10).map((r, i) => ({
    id: r?.token?.token_id || r?.token?.symbol || `buzz-${i}`,
    rank: r?.rank_position ?? i + 1,
    symbol: String(r?.token?.symbol || '').toUpperCase(),
    name: r?.token?.name || r?.token?.symbol || '',
    image: r?.token?.image_small || r?.token?.image_url || null,
    category: r?.token?.primary_category || '',
    mentions: r?.metrics?.mentions_24h ?? r?.metrics?.external_mentions_24h ?? 0,
    authors: r?.metrics?.unique_external_authors_24h ?? 0,
    // clean_signal_score is a 0-1 FRACTION upstream (xd-signal.js: "already
    // 0-1"). LITE printed it raw as a percent, so a 0.69 board read "1%
    // organic" on every row - and tripped the <40 warn styling with it.
    clean: cleanPct(r?.quality?.clean_signal_score_24h ?? r?.metrics?.clean_signal_score_24h),
    rankChange: r?.rank_change_positions ?? 0,
    rankDir: r?.rank_direction || 'flat',
    marketCap: r?.token?.market_cap ?? null,
  })).filter((r) => r.symbol)
}

/*
 * The window the board last answered in. X Dash serves ONE window at a time and
 * zeroes the 24h metrics outside it, so asking blind lands on an empty board
 * whenever the live window has moved off the default - measured on a warm dev
 * profile: the untimed ask returned 0 rows and the retry returned 10, i.e. a
 * guaranteed-empty round trip in front of the social board on every load, and
 * the box's xdash routes have been measured in SECONDS on prod.
 *
 * Remembering the window that worked turns the common case into one request.
 * Kept short-lived because the live window really does move; past that we fall
 * back to exactly the old blind-then-retry path, so the worst case is unchanged.
 */
const TF_MEMO_KEY = 'spectre-lite-xdash-tf'
const TF_MEMO_TTL = 6 * 60 * 60 * 1000

function rememberedTimeframe() {
  try {
    const raw = localStorage.getItem(TF_MEMO_KEY)
    if (!raw) return null
    const { tf, ts } = JSON.parse(raw)
    return tf && Date.now() - ts < TF_MEMO_TTL ? tf : null
  } catch { return null }
}

function rememberTimeframe(tf) {
  if (!tf) return
  try { localStorage.setItem(TF_MEMO_KEY, JSON.stringify({ tf, ts: Date.now() })) } catch { /* private mode */ }
}

async function fetchSocialBoard() {
  const ask = (tf) => fetch(
    `/api/xdash/bootstrap?page=1&per_page=10${tf ? `&timeframe=${encodeURIComponent(tf)}` : ''}`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) },
  ).then((res) => (res.ok ? res.json() : null))

  const windowOf = (p) => timeframeForHours(p?.window_hours) || XDASH_BOOTSTRAP_DEFAULT_TF

  const asked = rememberedTimeframe()
  const payload = await ask(asked)
  const rows = mapSocialRows(payload)
  if (rows.length) {
    const w = windowOf(payload)
    rememberTimeframe(w)
    return { rows, ok: true, window: w }
  }

  // `asked`, not the default - readXDashHealth compares the window ASKED FOR
  // against the one SERVED, and lying about the question makes its verdict wrong.
  const live = readXDashHealth(payload, asked || XDASH_BOOTSTRAP_DEFAULT_TF).liveTimeframe
  if (!live) return { rows: [], ok: false, window: XDASH_BOOTSTRAP_DEFAULT_TF }
  const retry = await ask(live)
  const retryRows = mapSocialRows(retry)
  if (retryRows.length) rememberTimeframe(windowOf(retry))
  return { rows: retryRows, ok: retryRows.length > 0, window: windowOf(retry) }
}

export default function useLiteData(watchlistTokens) {
  const [coinPrices, setCoinPrices] = useState({})
  const [global, setGlobal] = useState(null)
  const [fearGreed, setFearGreed] = useState(null)
  const [altSeason, setAltSeason] = useState(null)
  const [movers, setMovers] = useState(null)
  const [news, setNews] = useState([])
  const [marketRows, setMarketRows] = useState([])
  // Same fetch, wider slice — the Money Flow map wants a real tail (top 100)
  // while every other surface keeps reading the top 40 it always did.
  const [marketRowsWide, setMarketRowsWide] = useState([])
  const [sectors, setSectors] = useState([])
  const [social, setSocial] = useState([])
  // 'loading' until the first answer lands, then 'ok' (rows) or 'updating'
  // (the feed answered but has nothing for any window it holds). Without
  // this the boards cannot tell an empty board from one still in flight and
  // shimmer forever - which is exactly what /lite Social did.
  const [socialState, setSocialState] = useState('loading')
  // Which window the board on screen is actually FOR. Normally 24h; when the
  // upstream has not built that document it serves another one, and a board
  // labelled 24h that holds a week is the bug this whole retry exists around.
  const [socialWindow, setSocialWindow] = useState('24h')
  const [watchlistPrices, setWatchlistPrices] = useState({})
  // Manual refresh: bump the tick to re-run every fetch effect (service-level
  // TTL caches still apply, but the price lanes are 10-45s so this lands
  // fresh numbers for the surfaces people watch).
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  const fetchCoins = useCallback(async () => {
    try {
      const map = await getTopCoinPrices(LITE_TOP_COINS)
      if (map && Object.keys(map).length > 0) { setCoinPrices(map); return }
    } catch (_) { /* fall through */ }
    try {
      const map = await getMajorTokenPrices(LITE_TOP_COINS)
      if (map) setCoinPrices(map)
    } catch (_) { /* keep last */ }
  }, [])

  useEffect(() => { fetchCoins() }, [fetchCoins, tick])
  useAdaptivePolling(fetchCoins, { interval: 30_000, respectIdle: true })

  useEffect(() => {
    let cancelled = false
    getGlobalMetrics().then((d) => { if (!cancelled && d) setGlobal(d) }).catch(() => {})
    getFearGreedCurrent().then((d) => { if (!cancelled && d) setFearGreed(d) }).catch(() => {})
    getSpectreAltSeason().then((d) => { if (!cancelled && d) setAltSeason(d) }).catch(() => {})
    getTopMovers()
      .then((d) => {
        if (cancelled || !d) return
        setMovers({
          gainers: (d.gainers || []).filter((m) => !isStableOrWrapped(m.symbol)),
          losers: (d.losers || []).filter((m) => !isStableOrWrapped(m.symbol)),
        })
      })
      .catch(() => {})
    // Crypto headlines + the Spectre Macro Wire, merged newest-first — the
    // macro feed reads in Lite too (founder 07-30: "wire this in lite and pro
    // so they can choose where to see"). Wire items carry wirePath (internal
    // article at /news/mw-<event_key>) instead of an external url.
    Promise.allSettled([
      getCryptoNews(null, 14),
      fetch('/data-api/v1/news/tradfi?hours=48&limit=16&order=recent', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([cn, mw]) => {
        if (cancelled) return
        const cryptoRows = cn.status === 'fulfilled' && Array.isArray(cn.value)
          ? cn.value.slice(0, 14).map((item) => ({
              id: String(item.id ?? item.guid ?? Math.random()),
              title: item.title || '',
              url: item.url || item.guid || '#',
              source: (item.source_info && item.source_info.name) || item.source || 'Crypto',
              // avatar / favicon stand-ins are identity, not a photo - the News
              // view shows a thumb only for real article art
              image: item.imageKind && item.imageKind !== 'article' ? null : (item.imageUrl || item.imageurl || null),
              publishedOn: item.published_on ?? item.publishedOn ?? 0,
              kind: 'crypto',
              summary: typeof item.summary === 'string' ? item.summary : '',
              sentiment: item.sentiment || null,
              assets: Array.isArray(item.relatedAssets) ? item.relatedAssets : [],
            }))
          : []
        const wireRows = mw.status === 'fulfilled' && Array.isArray(mw.value?.data)
          ? mw.value.data.filter((r) => r && r.headline && r.event_key).slice(0, 16).map((r) => ({
              id: `mw-${r.event_key}`,
              title: r.headline,
              url: null,
              wirePath: `/news/mw-${encodeURIComponent(r.event_key)}`,
              source: 'Macro Wire',
              // the same headline->photo picker the PRO newsroom uses (topic, then
              // place, then a verified category pool) - one Earth photo for every
              // political story read as a broken feed
              image: wireImage(r.headline, r.category, r.event_key),
              publishedOn: Math.floor(Date.parse(r.source_ts || r.ts || 0) / 1000) || 0,
              kind: 'wire',
              category: String(r.category || 'macro').toLowerCase(),
              summary: typeof r.context === 'string' ? r.context : '',
              sentiment: r.sentiment || null,
              importance: Number.isFinite(r.importance) ? r.importance : null,
              assets: Array.isArray(r.assets) ? r.assets : [],
            }))
          : []
        const merged = [...cryptoRows, ...wireRows]
          .sort((a, b) => (b.publishedOn || 0) - (a.publishedOn || 0))
          .slice(0, 26)
        if (merged.length) setNews(merged)
      })
      .catch(() => {})
    // Top-100 board: Markets view shows 20, the Heatmap tiles 40, Money Flow
    // maps up to 100. Default sparkline path rides the SHARED page-1 cache
    // (any <=250 caller collapses onto one fetch), so widening the slice costs
    // zero extra network — arriving from home it's already warm.
    getTopCoinsMarketsPage(1, 100)
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        const mapped = rows.slice(0, 100).map((r) => ({
          id: r.id || r.symbol,
          symbol: String(r.symbol || '').toUpperCase(),
          name: r.name || String(r.symbol || '').toUpperCase(),
          image: r.image || null,
          price: r.current_price,
          change: r.price_change_percentage_24h ?? 0,
          change7d: r.price_change_percentage_7d_in_currency ?? null,
          marketCap: r.market_cap ?? null,
          volume: r.total_volume ?? null,
        }))
        setMarketRowsWide(mapped)
        setMarketRows(mapped.slice(0, 40))
      })
      .catch(() => {})
    // Social buzz board (X Dash bootstrap). 🪤 the endpoint silently caps
    // per_page at 50 - 10 is well inside. One call, server-cached.
    //
    // The upstream materialises ONE document per window. When the run that would
    // build the window we ask for never lands, it still answers 200 - serving
    // whichever window it DOES hold, with zero rows for ours (measured
    // 2026-08-29: window_hours 168 on every request, rows only for
    // timeframe=7d). LITE has no window picker, so asking again for the window
    // that is current is the whole fix; /x-dash and /x-bubbles already do this.
    // And when even that is empty we say so, because `social.length === 0` as
    // the loading test shimmers forever on a feed that already answered.
    fetchSocialBoard()
      .then(({ rows, ok, window }) => {
        if (cancelled) return
        setSocial(rows)
        setSocialState(ok ? 'ok' : 'updating')
        setSocialWindow(window)
      })
      .catch(() => { if (!cancelled) setSocialState('updating') })
    getSpectreCategories({ limit: 80 })
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        setSectors(rows
          .filter((r) => r._hasMarketMetrics && r.market_cap > 0)
          .sort((a, b) => b.market_cap - a.market_cap)
          .slice(0, 12)
          .map((r) => ({
            id: r.id,
            cgId: r.cg_id || r.slug || r.id,
            name: r.name,
            marketCap: r.market_cap,
            change: r.market_cap_change_24h ?? 0,
            volume: r.volume_24h ?? 0,
            coins: (r.top_3_coins || []).slice(0, 3),
            count: r.asset_count ?? 0,
          })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tick])

  // ── Live price overlay ────────────────────────────────────────────────────
  // The top-100 board above is fetched ONCE per mount (and per manual refresh)
  // and rides a 5-minute shared page-1 cache, so every surface built on it —
  // the coin strip, the Top Coins table, the heatmap, the bubbles, the movers —
  // froze at whatever the market looked like when the tab was opened. That is
  // the "price is delayed on the landing page" report (founder 2026-08-12).
  //
  // Rather than re-pull the whole board (heavy, and the shared cache would
  // swallow it anyway), overlay just price + 24h change from the price lane,
  // which is one cheap call for the whole set. getBinancePrices is Spectre-
  // first with the ingester-stall guard, so a frozen box row self-heals here
  // instead of being painted as live.
  const [livePrices, setLivePrices] = useState({})
  const liveSymsKey = useMemo(() => {
    const syms = new Set(LITE_TOP_COINS)
    for (const r of marketRows) {
      if (syms.size >= 45) break
      if (r.symbol && !isStableOrWrapped(r.symbol)) syms.add(r.symbol)
    }
    return [...syms].join(',')
  }, [marketRows])

  const fetchLivePrices = useCallback(async () => {
    if (!liveSymsKey) return
    try {
      const map = await getBinancePrices(liveSymsKey.split(','))
      if (map && Object.keys(map).length > 0) setLivePrices(map)
    } catch (_) { /* keep last — a stale overlay is still the board's own value */ }
  }, [liveSymsKey])

  useEffect(() => { fetchLivePrices() }, [fetchLivePrices, tick])
  useAdaptivePolling(fetchLivePrices, { interval: 30_000, respectIdle: true })

  const overlay = useCallback((rows) => {
    if (!rows.length || !Object.keys(livePrices).length) return rows
    let touched = false
    const next = rows.map((r) => {
      const lp = livePrices[r.symbol]
      if (!lp || !(lp.price > 0) || lp.stale) return r
      const change = Number.isFinite(Number(lp.change)) ? Number(lp.change) : r.change
      if (r.price === lp.price && r.change === change) return r
      touched = true
      return { ...r, price: lp.price, change }
    })
    return touched ? next : rows
  }, [livePrices])

  const liveMarketRows = useMemo(() => overlay(marketRows), [overlay, marketRows])
  const liveMarketRowsWide = useMemo(() => overlay(marketRowsWide), [overlay, marketRowsWide])
  const liveCoinPrices = useMemo(() => {
    if (!Object.keys(livePrices).length) return coinPrices
    const next = { ...coinPrices }
    for (const s of LITE_TOP_COINS) {
      const lp = livePrices[s]
      if (lp?.price > 0 && !lp.stale) next[s] = { ...next[s], ...lp }
    }
    return next
  }, [coinPrices, livePrices])

  const entries = Array.isArray(watchlistTokens) ? watchlistTokens.slice(0, 15) : []
  const cryptoKey = entries.filter((tk) => !isStockToken(tk)).map((tk) => (tk.symbol || '').toUpperCase()).filter(Boolean).join(',')
  const stockKey = entries.filter(isStockToken).map((tk) => (tk.symbol || '').toUpperCase()).filter(Boolean).join(',')

  const fetchWatchlist = useCallback(async () => {
    const cryptoSyms = cryptoKey ? cryptoKey.split(',') : []
    const stockSyms = stockKey ? stockKey.split(',') : []
    if (cryptoSyms.length === 0 && stockSyms.length === 0) return
    const [cryptoRes, stockRes] = await Promise.allSettled([
      cryptoSyms.length ? getSpectrePricesBySymbols(cryptoSyms) : Promise.resolve({}),
      stockSyms.length ? getStockQuotes(stockSyms) : Promise.resolve({}),
    ])
    const next = {}
    if (cryptoRes.status === 'fulfilled' && cryptoRes.value) {
      for (const [sym, row] of Object.entries(cryptoRes.value)) {
        if (row?.price != null) next[sym] = { price: row.price, change: row.change24 ?? row.change ?? 0, change7d: row.change7d ?? null, marketCap: row.marketCap ?? null, image: row.image || null, name: row.name || null }
      }
    }
    if (stockRes.status === 'fulfilled' && stockRes.value) {
      for (const [sym, row] of Object.entries(stockRes.value)) {
        if (row?.price != null) next[String(sym).toUpperCase()] = { price: row.price, change: row.change ?? 0, marketCap: row.marketCap ?? null, image: null, name: row.name || null }
      }
    }
    if (Object.keys(next).length > 0) setWatchlistPrices((prev) => ({ ...prev, ...next }))
  }, [cryptoKey, stockKey])

  useEffect(() => { fetchWatchlist() }, [fetchWatchlist, tick])
  // 60s was long enough that a watchlist row and the same token's own page
  // could disagree by a whole candle. 30s matches the board overlay above.
  useAdaptivePolling(fetchWatchlist, { interval: 30_000, respectIdle: true })

  return {
    coinPrices: liveCoinPrices,
    global,
    fearGreed,
    altSeason,
    movers,
    news,
    marketRows: liveMarketRows,
    marketRowsWide: liveMarketRowsWide,
    sectors,
    social,
    socialState,
    socialWindow,
    watchlistEntries: entries,
    watchlistPrices,
    refresh,
  }
}

// ── Deterministic market read (no LLM - composed from the live numbers) ──

export function composeBrief({ global, fearGreed, movers, fmtLargeShort, t }) {
  if (!global || !(global.totalMarketCap > 0)) return null
  // i18n: every sentence is a template - a language ships whole or not at all.
  const tr = (key, dflt, vars) => (typeof t === 'function' ? t(`lite.brief.${key}`, dflt, vars) : dflt)
  const chg = Number(global.marketCapChange24h) || 0
  const fgValue = Number(fearGreed?.value ?? fearGreed?.score)
  const fgLabelRaw = (fearGreed?.classification || fearGreed?.value_classification || fearGreed?.label || '').toLowerCase()
  const fgLabel = fgLabelRaw ? tr(`fg_${fgLabelRaw.replace(/[^a-z]+/g, '_')}`, fgLabelRaw) : ''

  let headline
  if (chg >= 3) headline = tr('running', 'Markets are running.')
  else if (chg >= 1) headline = tr('climbing', 'Markets are climbing.')
  else if (chg > -1) headline = tr('calm', 'Markets are calm.')
  else if (chg > -3) headline = tr('drifting', 'Markets are drifting lower.')
  else headline = tr('risk_off', 'Risk is off.')

  const parts = []
  parts.push(chg >= 0
    ? tr('total_up', 'Crypto is up {{pct}}% over the last day, worth {{total}} in total.', { pct: Math.abs(chg).toFixed(1), total: fmtLargeShort(global.totalMarketCap) })
    : tr('total_down', 'Crypto is down {{pct}}% over the last day, worth {{total}} in total.', { pct: Math.abs(chg).toFixed(1), total: fmtLargeShort(global.totalMarketCap) }))
  if (global.btcDominance > 0) {
    if (Number.isFinite(fgValue) && fgLabel) {
      parts.push(tr('dominance_fg', 'Bitcoin holds {{dom}}% of the market while sentiment reads {{label}} at {{value}}.', { dom: global.btcDominance.toFixed(1), label: fgLabel, value: Math.round(fgValue) }))
    } else {
      parts.push(tr('dominance', 'Bitcoin holds {{dom}}% of the market.', { dom: global.btcDominance.toFixed(1) }))
    }
  }
  const topGainer = movers?.gainers?.[0]
  if (topGainer?.symbol && Number(topGainer.change) > 0) {
    parts.push(tr('leader', '{{sym}} leads the movers, up {{pct}}% today.', { sym: topGainer.symbol, pct: Number(topGainer.change).toFixed(1) }))
  }
  return { headline, body: parts.join(' ') }
}

export function liteTimeAgo(publishedOn, t) {
  if (!publishedOn) return ''
  const tr = (key, dflt, vars) => (typeof t === 'function' ? t(`lite.time.${key}`, dflt, vars) : dflt)
  const sec = Math.floor(Date.now() / 1000) - (typeof publishedOn === 'number' ? publishedOn : parseInt(publishedOn, 10))
  if (sec < 60) return tr('now', 'just now')
  if (sec < 3600) return tr('m', '{{n}}m ago', { n: Math.floor(sec / 60) })
  if (sec < 86400) return tr('h', '{{n}}h ago', { n: Math.floor(sec / 3600) })
  return tr('d', '{{n}}d ago', { n: Math.floor(sec / 86400) })
}
