import React, { useEffect, useMemo, useState, useRef } from 'react'
import { getDetailedTokenInfo, getTokenMarketProfile } from '@/services/codexApi'
import { getStockQuotes, getStockLogoUrl, getCompanyProfile, getStockCandles, getMarketStatus } from '@/services/stockApi'
import { useLatestTrades } from '@/hooks/codex/useLatestTrades'
import { useXDashToken } from '@/hooks/useXDashToken'
import { useTokenXSocial } from '@/hooks/useTokenXSocial'
import SLTvChart from './sl-tv-chart'
import { resolveCinemaRef } from './sl-identity'
import useDockMagnify from './use-dock-magnify'
import { loadDailyWindow } from '@/pages/lite/components/lite-research'
import { NET_BADGE, num, fmtCompact, fmtInt, fmtPriceSmart, fmtChange, changeCls, fmtAge } from './sl-helpers'
import { computeStockPerf, exchangeLabel, sessionChip, todayBar, rangePos, daysUntil, recommendationLabel, fmtCount } from './sl-stock-facts'

const DEX_CHAIN_SLUG = { 1: 'ethereum', 56: 'bsc', 137: 'polygon', 42161: 'arbitrum', 8453: 'base', 10: 'optimism', 1399811149: 'solana' }

function shortAddr(a) { return !a ? '' : (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a) }
function timeAgo(d) {
  const t = d instanceof Date ? d.getTime() : num(d)
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Diverging buys/sells bar (DexScreener signature).
function FlowBar({ buys, sells }) {
  const b = num(buys), s = num(sells), tot = b + s
  const bp = tot > 0 ? (b / tot) * 100 : 50
  return <span className="sl-flowbar" aria-hidden><span className="sl-flowbar-buy" style={{ width: `${bp}%` }} /><span className="sl-flowbar-sell" style={{ width: `${100 - bp}%` }} /></span>
}

function extractSocials(d, token) {
  const out = {}
  const s = d?.socials || d?.socialLinks || d?.links || d?.info?.socials || {}
  out.website = d?.website || d?.websiteUrl || s.website || s.homepage || d?.info?.website || null
  out.twitter = d?.twitter || d?.twitterUrl || s.twitter || s.x || d?.info?.twitter || null
  out.telegram = d?.telegram || d?.telegramUrl || s.telegram || d?.info?.telegram || null
  if (!out.twitter && token?.symbol) out.twitter = `https://x.com/search?q=%24${encodeURIComponent(token.symbol)}`
  return out
}

// Normalize the on-chain details payload (/api/token/details via
// getDetailedTokenInfo) OR the CG market profile into the row's field shape.
// 🪤 the details endpoint returns % changes as RATIOS (-0.0108 = -1.08%), while
// the trending feed returns true percentages — so ×100 only the details path.
function normEnrich(d, resolvedAddr, resolvedNet, detailsSource) {
  if (!d) return null
  const t = d.token || d
  // details markers: apiMarketCap / volume24 / txnCount24 are details-only fields
  const isDetails = ('apiMarketCap' in t) || ('volume24' in t) || ('txnCount24' in t)
  // Prefer the caller's explicit source flag — the CG market profile (majors) can
  // carry a `volume24` field that falsely trips the sniff and ×100's real percents
  // (BTC -0.38% → -37.81%). Only the details endpoint returns RATIOS.
  const cf = (detailsSource ?? isDetails) ? 100 : 1
  return {
    price: num(t.price ?? t.priceUSD ?? d.price),
    marketCap: num(t.marketCap ?? t.apiMarketCap ?? t.market_cap ?? d.marketCap),
    liquidity: num(t.liquidity ?? d.liquidity),
    volume24h: num(t.volume24 ?? t.volume24h ?? d.volume24 ?? d.volume),
    change24h: num(t.change24 ?? t.change24h ?? d.change24) * cf,
    change1h: num(t.change1h ?? t.change1 ?? d.change1h) * cf,
    change4h: num(t.change4h ?? t.change4 ?? d.change4h) * cf,
    change12h: num(t.change12h ?? t.change12 ?? d.change12h) * cf,
    holders: num(t.holders ?? d.holders),
    txns24: num(t.txnCount24 ?? d.txnCount24),
    createdAt: num(t.createdAt ?? d.createdAt),
    totalSupply: num(t.totalSupply ?? t.circulatingSupply ?? t.max_supply ?? t.total_supply),
    address: resolvedAddr || t.address || d.address || '',
    networkId: resolvedNet || t.networkId || d.networkId || 1,
    cgId: t.cgId || d.cgId || d.coingecko_id || null,
    logo: t.logo || t.image || t.info?.imageThumbUrl || d.image || null,
    socials: t.socials || d.socials || null,
    raw: d,
  }
}

function TweetCard({ tw }) {
  const [avErr, setAvErr] = useState(false)
  const initial = (tw.name || tw.username || '?').trim().charAt(0).toUpperCase()
  return (
    <a href={tw.url || '#'} target="_blank" rel="noopener noreferrer" className="sl-tweet">
      {/* Some feeds (our own social-mentions fallback) carry the post but no
          author. Rendering the head anyway produced a row of "?" chips with no
          name beside them — worse than no head at all. */}
      {(tw.name || tw.username) ? (
        <div className="sl-tweet-head">
          {tw.avatar && !avErr ? <img className="sl-tweet-av" src={tw.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setAvErr(true)} /> : <span className="sl-tweet-av sl-tweet-av--fb">{initial}</span>}
          <span className="sl-tweet-id"><b>{tw.name || tw.username}</b>{tw.username && <em>@{tw.username}</em>}</span>
        </div>
      ) : null}
      <p className="sl-tweet-text">{tw.text}</p>
      <div className="sl-tweet-meta">
        {tw.likes > 0 && <span>♥ {fmtInt(tw.likes)}</span>}
        {tw.retweets > 0 && <span>↻ {fmtInt(tw.retweets)}</span>}
        {tw.views > 0 && <span>{fmtInt(tw.views)} views</span>}
      </div>
    </a>
  )
}

const SECTION_KEY = 'spectre-screenerlite-detail-sections'
const DEFAULT_SECTIONS = { chart: true, trades: true, stats: true, social: true, tweets: true }

export default function TokenDetail({ token, onBack, onOpenPro, wl, isLight, onPrev, onNext, hasPrev, hasNext, position, total, carousel, onPick, cinema, onToggleCinema, hideFilmstrip, backLabel = 'Screener', topActions = null }) {
  const touchRef = useRef(null)
  const onTouchStart = (e) => { touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e) => {
    const s = touchRef.current; if (!s) return
    const dx = e.changedTouches[0].clientX - s.x
    const dy = e.changedTouches[0].clientY - s.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) onNext?.(); else onPrev?.() }
    touchRef.current = null
  }
  const [enrich, setEnrich] = useState(null)
  const [tab, setTab] = useState('txns')
  const [customize, setCustomize] = useState(false)
  const customizeRef = useRef(null)
  const filmRef = useRef(null)
  useDockMagnify(filmRef)
  // Click outside the gear + its popover, or Escape, closes the picker.
  // 🪤 Escape goes on WINDOW capture: the cinema overlay owns Escape on
  // document capture (it closes cinema), and window capture runs first, so
  // the popover can claim the key before cinema ever sees it.
  useEffect(() => {
    if (!customize) return undefined
    const away = (e) => { if (customizeRef.current && !customizeRef.current.contains(e.target)) setCustomize(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setCustomize(false) } }
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [customize])
  const [sections, setSections] = useState(() => {
    try { return { ...DEFAULT_SECTIONS, ...JSON.parse(localStorage.getItem(SECTION_KEY) || '{}') } } catch { return DEFAULT_SECTIONS }
  })
  const toggleSection = (k) => setSections((p) => { const n = { ...p, [k]: !p[k] }; try { localStorage.setItem(SECTION_KEY, JSON.stringify(n)) } catch { /* */ } return n })

  const [chartPrice, setChartPrice] = useState(0)

  // ONE identity pipeline for every cinema entry point (Trending / Watchlist /
  // Movers / Markets / Research hand raw rows in): the shared resolver returns
  // a validated ref - contract+chain for on-chain caps (GT-verified quote),
  // hint-checked cgId for listed coins - and NEVER guesses a contract from a
  // bare symbol search. This is what killed the "$0 and No chart data" class;
  // every lane it uses is Research's own (see sl-identity.js).
  const [assetRef, setAssetRef] = useState(null)
  useEffect(() => {
    let cancelled = false
    setAssetRef(null)
    resolveCinemaRef(token).then((r) => { if (!cancelled) setAssetRef(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [token])
  // Responsive chart height: wide desktop → tall cinema chart; phone → shorter so
  // the whole detail flows without a giant empty chart. (The `.sl-chartx` height is
  // inline, so it can't be capped by CSS media queries — size it in JS.)
  const [viewport, setViewport] = useState(() => (typeof window === 'undefined' ? 'mid'
    : window.innerWidth >= 1024 ? 'wide' : window.innerWidth <= 768 ? 'narrow' : 'mid'))
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const on = () => setViewport(window.innerWidth >= 1024 ? 'wide' : window.innerWidth <= 768 ? 'narrow' : 'mid')
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const wideScreen = viewport === 'wide'
  const narrowScreen = viewport === 'narrow'
  const baseCg = token?.cgId || token?.cg_id || null
  const isStock = !!token?.isStock

  // Enrich. STOCKS → live Yahoo quote (price/mcap/vol/day-change). CRYPTO →
  // the resolver's VALIDATED identity picks the lane: a contract goes to the
  // full /api/token/details (contract-keyed, unambiguous); a verified cgId goes
  // to the CG market profile. The old symbol-search contract hunt is gone - it
  // took the first hit off a DEX index, i.e. whichever clone was deepest, and
  // is why cinema used to draw another token's numbers or nothing at all.
  useEffect(() => {
    let cancelled = false
    setEnrich(null)
    const run = async () => {
      if (isStock && token?.symbol) {
        const sym = token.symbol.toUpperCase()
        // Quote (fast, batch-cached) and fundamentals (Yahoo summary + profile)
        // in parallel - the panel needs both, and neither waits on the other.
        const [q, prof] = await Promise.all([
          getStockQuotes([sym]).then((m) => m?.[sym] || null).catch(() => null),
          getCompanyProfile(sym).catch(() => null),
        ])
        if (cancelled) return
        if (!q && !prof) { setEnrich(null); return }
        const px = num(q?.price) || num(prof?.price)
        // 🪤 Yahoo `volume` is a SHARE count - the tile is labelled in dollars,
        // so multiply by price (1.68M sh × $506 = $850M, not "$1.68M").
        const shares = num(q?.volume ?? q?.volume24h) || num(prof?.volume)
        setEnrich({
          price: px,
          marketCap: num(q?.marketCap) || num(prof?.marketCap),
          volume24h: shares * px,
          change24h: num(q?.change ?? q?.changePercent) || num(prof?.change),
          change1h: 0, change4h: 0, change12h: 0, holders: 0, txns24: 0, liquidity: 0, createdAt: 0,
          address: '', networkId: 1, cgId: null,
          logo: getStockLogoUrl(sym),
          name: prof?.name || q?.name || null,
          socials: prof?.website ? { website: prof.website } : null,
          // Stock facts the crypto lanes have no analogue for - read by the
          // stats + company panels below.
          stock: {
            shares,
            avgVolume: num(prof?.avgVolume) || num(q?.avgVolume),
            open: num(prof?.open) || num(q?.open),
            high: num(prof?.high) || num(q?.high),
            low: num(prof?.low) || num(q?.low),
            prevClose: num(prof?.previousClose) || num(q?.previousClose),
            week52High: num(prof?.week52High) || num(q?.week52High),
            week52Low: num(prof?.week52Low) || num(q?.week52Low),
            pe: num(prof?.pe) || num(q?.pe),
            forwardPe: num(prof?.forwardPe),
            eps: num(prof?.eps) || num(q?.eps),
            dividendYield: num(prof?.dividendYield),
            beta: num(prof?.beta),
            sharesOutstanding: num(prof?.sharesOutstanding),
            exchange: exchangeLabel(prof?.exchange || q?.exchange),
            sector: prof?.sector || q?.sector || '',
            industry: prof?.industry || '',
            description: prof?.description || '',
            website: prof?.website || '',
            ceo: prof?.ceo || null,
            employees: num(prof?.employees),
            ipo: prof?.ipo || null,
            country: prof?.country || '',
            earningsDate: prof?.earningsDate || null,
            earningsAvg: prof?.earningsAvg ?? null,
            targetMeanPrice: num(prof?.targetMeanPrice),
            targetHighPrice: num(prof?.targetHighPrice),
            targetLowPrice: num(prof?.targetLowPrice),
            recommendationKey: prof?.recommendationKey || null,
            analystCount: num(prof?.analystCount),
          },
          raw: { ...(q || {}), website: prof?.website || '' },
        })
        return
      }
      if (!assetRef) return // crypto waits for the resolver (fast, module-cached)
      const addr = token?.address || assetRef.contract || ''
      const netId = Number(token?.networkId) || Number(assetRef.networkId) || 1
      // The row's cgId field is only sometimes a real CG slug (callers stuff
      // the bare ticker in) - the resolver's verified id wins.
      const cg = assetRef.cgId
        || (baseCg && String(baseCg).toLowerCase() !== String(token?.symbol || '').toLowerCase() ? baseCg : null)
      let d = null
      let fromDetails = false
      if (addr) { d = await getDetailedTokenInfo(addr, netId).catch(() => null); if (d) fromDetails = true }
      if (!d && cg) d = await getTokenMarketProfile(cg).catch(() => null) // CG profile → percents, not ratios
      if (!cancelled) setEnrich(normEnrich(d, addr, netId, fromDetails))
    }
    run()
    return () => { cancelled = true }
  }, [token?.address, token?.networkId, token?.symbol, baseCg, isStock, assetRef])

  // A ~1Y daily walk through the SAME cached lanes Research uses (Spectre →
  // CG → GT → Codex, scale-gated) - gives the TV pane its history span and
  // dead-tape anchor, and costs nothing when this token was already opened in
  // Research (shared module cache).
  const [dailyRows, setDailyRows] = useState(null)
  useEffect(() => {
    if (isStock || !assetRef) { setDailyRows(null); return undefined }
    let cancelled = false
    setDailyRows(null)
    const ref = assetRef.contract
      ? { contract: assetRef.contract, chain: assetRef.chain, networkId: assetRef.networkId }
      : null
    loadDailyWindow(String(token?.symbol || '').toUpperCase(), 365, {
      ref,
      hint: { name: assetRef.name || null, image: assetRef.image || null },
      price: Number(assetRef.quote?.price) || 0,
    }).then((rows) => { if (!cancelled) setDailyRows(Array.isArray(rows) ? rows : null) }).catch(() => {})
    return () => { cancelled = true }
  }, [isStock, assetRef, token?.symbol])
  // STOCKS: ~1Y of daily closes (one cached Yahoo call) powers the 1W/1M/3M/
  // YTD/1Y strip and backfills Open/High/Low when the quote leaves them empty.
  const [stockBars, setStockBars] = useState(null)
  useEffect(() => {
    if (!isStock || !token?.symbol) { setStockBars(null); return undefined }
    let cancelled = false
    setStockBars(null)
    getStockCandles(String(token.symbol).toUpperCase(), '1D')
      .then((r) => { if (!cancelled) setStockBars(Array.isArray(r?.getBars) ? r.getBars : []) })
      .catch(() => { if (!cancelled) setStockBars([]) })
    return () => { cancelled = true }
  }, [isStock, token?.symbol])
  const stockPerf = useMemo(() => (isStock && stockBars?.length ? computeStockPerf(stockBars) : null), [isStock, stockBars])
  const stockToday = useMemo(() => (isStock ? todayBar(stockBars) : null), [isStock, stockBars])
  // Session chip (open / pre / after / closed) - a clock read, re-checked each
  // minute while the tab is visible so it flips at the bell without a reload.
  const [session, setSession] = useState(() => (isStock ? getMarketStatus() : null))
  useEffect(() => {
    if (!isStock) { setSession(null); return undefined }
    setSession(getMarketStatus())
    const id = setInterval(() => { if (!document.hidden) setSession(getMarketStatus()) }, 60000)
    return () => clearInterval(id)
  }, [isStock])

  const seriesEdges = useMemo(() => {
    const arr = Array.isArray(dailyRows) ? dailyRows : []
    if (!arr.length) return { historySec: null, endSec: null }
    const first = Number(arr[0]?.time) || 0
    const last = Number(arr[arr.length - 1]?.time) || 0
    const now = Math.floor(Date.now() / 1000)
    return {
      // Span of the data we HAVE, not "how long ago it started".
      historySec: first > 0 && last > first ? last - first : null,
      // Anchor the TV window to the newest bar only once the tape is
      // meaningfully stale; a live token stays anchored to now.
      endSec: last > 0 && now - last > 6 * 3600 ? last : null,
    }
  }, [dailyRows])

  // Merged view — prefer the live row value, fall back to enrichment, then to
  // the resolver's trusted quote (GT-by-contract / CG) so a row the box served
  // with price 0 still shows real numbers instead of "$0".
  const view = useMemo(() => {
    const e = enrich || {}
    const q = assetRef?.quote || null
    if (!enrich && !q && !assetRef) return token || {}
    const fill = (a, b) => (num(a) ? num(a) : num(b))
    // The box's symbol-keyed row can price an on-chain cap 15x wrong while
    // looking perfectly healthy (see mergeGtStats in lite-research).
    // When the contract-keyed GT quote disagrees past the trust ratio, the
    // whole row price is distrusted, same rule as Research.
    const rowPx = num(token?.price)
    const qPx = num(q?.price)
    const distrustRow = assetRef?.kind === 'onchain' && rowPx > 0 && qPx > 0
      && (rowPx / qPx > 1.5 || qPx / rowPx > 1.5)
    return {
      ...token,
      price: distrustRow ? qPx : fill(token?.price, fill(e.price, q?.price)),
      marketCap: fill(token?.marketCap ?? token?.mcap, fill(e.marketCap, q?.marketCap)),
      liquidity: fill(token?.liquidity, fill(e.liquidity, q?.liquidity)),
      volume24h: fill(token?.volume24h ?? token?.volume, fill(e.volume24h, q?.volume24h)),
      change24h: distrustRow ? num(q?.change24) : (num(token?.change24h) || num(e.change24h) || num(q?.change24)),
      change1h: num(token?.change1h) || num(e.change1h),
      change4h: num(token?.change4h) || num(e.change4h),
      change12h: num(token?.change12h) || num(e.change12h),
      change6h: num(token?.change6h),
      holders: num(token?.holders) || num(e.holders),
      txns24: num(token?.txns24) || num(e.txns24),
      createdAt: num(token?.createdAt) || num(e.createdAt),
      address: token?.address || e.address || assetRef?.contract || '',
      networkId: token?.networkId || e.networkId || assetRef?.networkId || 1,
      cgId: assetRef?.cgId || baseCg || e.cgId || null,
      logo: token?.logo || e.logo || assetRef?.image || null,
      name: (token?.name && token.name !== token.symbol ? token.name : null)
        || (assetRef?.name && assetRef.name !== token?.symbol ? assetRef.name : null) || e.name || token?.name,
    }
  }, [token, enrich, assetRef, baseCg])

  const address = view.address || ''
  const networkId = view.networkId || 1
  const cgId = view.cgId || null
  const badge = NET_BADGE[networkId]
  const wid = address || view.symbol
  const watched = wl?.has?.(wid)

  const { trades, loading: tradesLoading } = useLatestTrades(address, networkId, 50, { enabled: !!address })

  // Buy/sell split: prefer 24h totals from the row; else derive from the live tape.
  const tapeSplit = useMemo(() => {
    if (!Array.isArray(trades) || !trades.length) return null
    let b = 0, s = 0
    for (const t of trades) { if (/sell/i.test(t.type)) s++; else if (/buy/i.test(t.type)) b++ }
    return (b + s) > 0 ? { buys: b, sells: s } : null
  }, [trades])
  const flowBuys = num(view.buys24) || (tapeSplit?.buys || 0)
  const flowSells = num(view.sells24) || (tapeSplit?.sells || 0)
  const { data: xd } = useXDashToken(cgId, { enabled: !!cgId })
  const { mentions: tweets, loading: tweetsLoading } = useTokenXSocial(view, { enabled: !!view.symbol && sections.tweets })

  const socials = useMemo(() => extractSocials(enrich?.raw, view), [enrich, view])
  const ch24 = num(view.change24h)
  const displayPrice = num(view.price) || chartPrice
  // On-chain contract with a live trade tape? (majors/stocks have none — when
  // there's no txns panel, the tweet feed drops UNDER the chart to fill the gap.)
  const hasTxns = !isStock && !!address
  // Stocks quote a session change, not a rolling 24h window - label it so.
  const chWindow = isStock ? 'Day' : '24h'
  const sf = isStock ? (enrich?.stock || null) : null
  const sess = isStock ? sessionChip(session) : null
  const dayLow = sf ? (sf.low || stockToday?.low || 0) : 0
  const dayHigh = sf ? (sf.high || stockToday?.high || 0) : 0
  const dayOpen = sf ? (sf.open || stockToday?.open || 0) : 0
  const dayPos = rangePos(displayPrice, dayLow, dayHigh)
  const wkPos = sf ? rangePos(displayPrice, sf.week52Low, sf.week52High) : null
  const fromHigh52 = sf?.week52High > 0 && displayPrice > 0 ? ((displayPrice - sf.week52High) / sf.week52High) * 100 : null
  const targetUpside = sf?.targetMeanPrice > 0 && displayPrice > 0 ? ((sf.targetMeanPrice - displayPrice) / displayPrice) * 100 : null
  const earningsIn = sf?.earningsDate ? daysUntil(sf.earningsDate) : null
  const earningsLabel = sf?.earningsDate ? new Date(sf.earningsDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const stockPerfTiles = stockPerf ? [
    { label: '1W', v: stockPerf.w1 }, { label: '1M', v: stockPerf.m1 }, { label: '3M', v: stockPerf.m3 },
    { label: 'YTD', v: stockPerf.ytd }, { label: '1Y', v: stockPerf.y1 },
  ] : null
  const [aboutOpen, setAboutOpen] = useState(false)

  const changeTiles = [
    { label: '1H', v: view.change1h }, { label: '4H', v: view.change4h },
    { label: '12H', v: view.change12h }, { label: '24H', v: view.change24h },
  ]

  const dexUrl = address ? `https://dexscreener.com/${DEX_CHAIN_SLUG[networkId] || 'ethereum'}/${address}` : null
  const buzz = xd?.mentions24h ?? xd?.intel?.mentions24h ?? xd?.mentions ?? null
  const authors = xd?.authors24h ?? xd?.intel?.authors24h ?? null

  // Conditional FDV + ATH (from the enrich payload; gated so DGEN tokens omit them)
  const raw = enrich?.raw || {}
  const fdvSupply = num(raw.maxSupply ?? raw.max_supply ?? raw.totalSupply ?? raw.total_supply ?? raw.market?.max_supply ?? raw.market?.total_supply)
  const fdv = fdvSupply > 0 && num(view.price) > 0 ? fdvSupply * num(view.price) : 0
  const ath = num(raw.ath ?? raw.market?.ath ?? raw.allTimeHigh)
  const athChg = num(raw.ath_change_percentage ?? raw.athChangePercentage ?? raw.market?.ath_change_percentage)
  // On-chain tokens have a real pool figure; CEX majors do not. Drives whether
  // the third stat slot shows Liquidity or is given over to FDV.
  const hasLiquidity = num(view.liquidity) > 0

  const tweetsPanel = sections.tweets ? (
    <div className="lite-panel sl-d2-tweets">
      <h3 className="sl-panel-title">Live Tweets <span className="sl-tweets-live">● live</span></h3>
      {tweetsLoading && (!tweets || !tweets.length) ? (
        <div className="sl-trades-skel">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="sl-skel-row sl-skel-row--sm" style={{ height: 48 }} />)}</div>
      ) : (!tweets || !tweets.length) ? (
        <p className="sl-muted">No recent posts found for ${view.symbol}. <a className="sl-link-btn" href={`https://x.com/search?q=%24${encodeURIComponent(view.symbol || '')}&f=live`} target="_blank" rel="noopener noreferrer">Search X ↗</a></p>
      ) : (
        <div className={`sl-tweets${hasTxns ? '' : ' sl-tweets--wide'}`}>
          {tweets.slice(0, hasTxns ? 16 : 24).map((tw, i) => <TweetCard key={tw.id || i} tw={tw} />)}
        </div>
      )}
    </div>
  ) : null

  return (
    <div className="sl-detail2" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* carousel arrows — flip through the source list (Instagram-style) */}
      {total > 1 && (
        <>
          <button type="button" className="sl-nav-arrow sl-nav-prev" onClick={onPrev} disabled={!hasPrev} aria-label="Previous token">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button type="button" className="sl-nav-arrow sl-nav-next" onClick={onNext} disabled={!hasNext} aria-label="Next token">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </>
      )}
      {/* mobile identity header — the desktop flex topbar reflows into scattered
          pieces on a phone, so narrow screens get this dedicated, deterministic
          header (logo + name left, price + 24h right). Desktop topbar hidden by
          CSS at ≤768px. */}
      {narrowScreen && (
        <div className="sl-mhead">
          {view.logo
            ? <img className="sl-mhead-logo" src={view.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : <span className="sl-mhead-logo sl-logo--fallback">{String(view.symbol || '?').slice(0, 1)}</span>}
          <div className="sl-mhead-id">
            <span className="sl-mhead-sym">{view.symbol}{total > 1 ? <em className="sl-mhead-pos">{position}/{total}</em> : null}</span>
            <span className="sl-mhead-name">{view.name}</span>
          </div>
          <div className="sl-mhead-px">
            <span className="sl-mhead-price mono">{fmtPriceSmart(displayPrice)}</span>
            <span className={`sl-info-chpill ${changeCls(ch24)}`}>{fmtChange(ch24)} <em>{chWindow}</em></span>
          </div>
        </div>
      )}

      {/* top bar — price-first identity hero (PRO TokenBanner parity) */}
      <div className="sl-d2-topbar">
        <button type="button" className="sl-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          <span className="sl-back-lbl">{backLabel}</span>
        </button>
        {total > 1 && <span className="sl-nav-count mono">{position} / {total}</span>}
        <div className="sl-d2-id">
          {view.logo
            ? <img className="sl-d2-logo" src={view.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : <span className="sl-d2-logo sl-logo--fallback">{String(view.symbol || '?').slice(0, 1)}</span>}
          <div className="sl-d2-idcol">
            <span className="sl-d2-sym">{view.symbol} {address && badge && <span className={`sl-chip-chain sl-chain-${badge.toLowerCase()}`}>{badge}</span>}</span>
            <span className="sl-d2-name">{view.name}</span>
          </div>
        </div>
        <div className="sl-d2-hero">
          <span className="sl-d2-px mono">{fmtPriceSmart(displayPrice)}</span>
          <span className={`sl-info-chpill ${changeCls(ch24)}`}>{fmtChange(ch24)} <em>{chWindow}</em></span>
          {sess && <span className={`sl-session sl-session--${sess.tone}`} title={sess.detail}><i aria-hidden />{sess.label}</span>}
        </div>
        <div className="sl-d2-topactions">
          <div className="sl-d2-socials">
            {socials.twitter && <a className="sl-social-ico" href={socials.twitter} target="_blank" rel="noopener noreferrer" title="X / Twitter" aria-label="X"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.2-9.4L1 2h7l4.8 6.3L18.9 2zm-2.4 18h1.9L7.6 3.9H5.6L16.5 20z" /></svg></a>}
            {socials.website && <a className="sl-social-ico" href={socials.website} target="_blank" rel="noopener noreferrer" title="Website" aria-label="Website"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg></a>}
            {socials.telegram && <a className="sl-social-ico" href={socials.telegram} target="_blank" rel="noopener noreferrer" title="Telegram" aria-label="Telegram"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M21.9 4.3l-3.3 15.6c-.2 1.1-.9 1.4-1.9.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.3-.1-.5-.6-.2L6.5 13.6 1.6 12c-1-.3-1.1-1 .2-1.5l19-7.3c.9-.3 1.6.2 1.1 1.1z" /></svg></a>}
            {dexUrl && <a className="sl-social-ico" href={dexUrl} target="_blank" rel="noopener noreferrer" title="DexScreener" aria-label="DexScreener"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15l5-6 4 4 7-8" /><path d="M4 20h16" /></svg></a>}
          </div>
          {total > 1 && (
            <button type="button" className={`sl-customize${cinema ? ' on' : ''}`} onClick={onToggleCinema} title="Cinema mode">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M7 5v14M17 5v14M2.5 9.5h4.5M17 9.5h4.5M2.5 14.5h4.5M17 14.5h4.5" /></svg>
            </button>
          )}
          {/* Host-supplied buttons (LITE cinema's appearance gear) sit IN this
              row instead of floating fixed over it and landing on the customize
              button. */}
          {topActions}
          <div ref={customizeRef} className="sl-customize-wrap">
            <button type="button" className={`sl-customize${customize ? ' on' : ''}`} onClick={() => setCustomize((c) => !c)} title="Customize panels" aria-expanded={customize} aria-haspopup="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
            {/* The panel picker hangs off the gear as a popover. It used to be a
                full-width bar pushed in above the grid, which shoved the whole
                page down for five checkboxes. */}
            {customize && (
              <div className="sl-customize-pop" role="group" aria-label="Show panels">
                <span className="sl-cust-lbl">Show panels</span>
                {['chart', 'trades', 'stats', 'social', 'tweets'].map((k) => (
                  <label key={k} className="sl-cust-opt">
                    <input type="checkbox" role="switch" className="sl-cust-input" checked={!!sections[k]} onChange={() => toggleSection(k)} />
                    <span>{k[0].toUpperCase() + k.slice(1)}</span>
                    <span className="sl-cust-switch" aria-hidden><span className="sl-cust-knob" /></span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* inline momentum chips: crypto = intraday windows off the row; stocks =
          session windows off the daily tape (1W / 1M / 3M / YTD / 1Y) */}
      {!isStock && (
        <div className="sl-d2-hero-tfs">
          {changeTiles.map((c) => (
            <span key={c.label} className={`sl-hero-tf ${c.v ? changeCls(c.v) : 'nodata'}`}><em>{c.label}</em>{c.v ? fmtChange(c.v) : '—'}</span>
          ))}
        </div>
      )}
      {isStock && stockPerfTiles && (
        <div className="sl-d2-hero-tfs">
          {stockPerfTiles.map((c) => (
            <span key={c.label} className={`sl-hero-tf ${c.v != null ? changeCls(c.v) : 'nodata'}`}><em>{c.label}</em>{c.v != null ? fmtChange(c.v) : '—'}</span>
          ))}
        </div>
      )}

      <div className="sl-d2-grid">
        {/* main column */}
        <div className="sl-d2-main">
          {sections.chart && (
            <div className="lite-panel sl-d2-chart">
              <SLTvChart token={view} quote={Number(assetRef?.quote?.price) || 0} edges={seriesEdges} resolving={!isStock && !assetRef} isLight={isLight} height={narrowScreen ? 320 : (cinema && wideScreen ? 560 : 440)} onMeta={(m) => { if (m?.lastPrice) setChartPrice(m.lastPrice) }} />
            </div>
          )}

          {sections.trades && !isStock && !!address && (
            <div className="lite-panel sl-d2-trades">
              <div className="sl-d2-tabs" role="tablist">
                {[{ id: 'txns', label: 'Transactions' }, { id: 'top', label: 'Top Traders' }, { id: 'holders', label: 'Holders' }].map((tb) => (
                  <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} className={`sl-d2-tab${tab === tb.id ? ' active' : ''}`} onClick={() => setTab(tb.id)}>{tb.label}</button>
                ))}
              </div>
              {tab === 'txns' ? (
                !address ? <p className="sl-muted">Trade tape needs an on-chain contract. <button type="button" className="sl-link-btn" onClick={() => onOpenPro?.(view)}>Open in PRO</button>.</p>
                  : tradesLoading && (!trades || trades.length === 0) ? <div className="sl-trades-skel">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="sl-skel-row sl-skel-row--sm" />)}</div>
                    : (!trades || trades.length === 0) ? <p className="sl-muted">No recent trades in this window.</p>
                      : (
                        <div className="sl-txtable">
                          <div className="sl-txrow sl-txrow--head">
                            <span>Date</span><span>Type</span><span className="sl-num">USD</span><span className="sl-num sl-hide-sm">{view.symbol}</span><span className="sl-num">Price</span><span className="sl-hide-sm">Trader</span>
                          </div>
                          {trades.slice(0, 40).map((t, i) => {
                            const kind = /sell/i.test(t.type) ? 'sell' : /buy/i.test(t.type) ? 'buy' : 'neutral'
                            return (
                              <div key={i} className={`sl-txrow sl-tx-${kind}`}>
                                <span className="sl-tx-date mono">{timeAgo(t.timestamp)}</span>
                                <span className={`sl-tx-type ${kind}`}>{kind === 'sell' ? 'Sell' : kind === 'buy' ? 'Buy' : 'Swap'}</span>
                                <span className="sl-num mono">{fmtCompact(t.value)}</span>
                                <span className="sl-num mono sl-hide-sm">{fmtInt(t.amount)}</span>
                                <span className="sl-num mono">{fmtPriceSmart(t.price)}</span>
                                <span className="sl-tx-maker mono sl-hide-sm">{t.makerLabel || shortAddr(t.maker)}</span>
                              </div>
                            )
                          })}
                        </div>
                      )
              ) : (
                <div className="sl-tab-soon">
                  <p>{tab === 'top' ? 'Top Traders' : 'Holders'} — full breakdown lives in the PRO screener.</p>
                  <button type="button" className="sl-out sl-out--pro" onClick={() => onOpenPro?.(view)}>Open in PRO ↗</button>
                </div>
              )}
            </div>
          )}

          {/* no on-chain txns → tweets fill the space under the chart */}
          {!hasTxns && tweetsPanel}
        </div>

        {/* right rail */}
        <aside className="sl-d2-rail">
          {sections.stats && (
            <div className="lite-panel sl-d2-info">
              <div className="sl-info-price">
                <div><span className="sl-info-k">Price USD</span><span className="sl-info-v mono">{fmtPriceSmart(displayPrice)}</span></div>
                <div className={`sl-info-chpill ${changeCls(ch24)}`}>{fmtChange(ch24)} <em>{chWindow}</em></div>
              </div>
              {isStock ? (
                <div className="sl-info-3up">
                  <div><span className="sl-info-k">Mkt Cap</span><span className="sl-info-v mono">{fmtCompact(view.marketCap ?? view.mcap)}</span></div>
                  <div>
                    <span className="sl-info-k">Volume</span>
                    <span className="sl-info-v mono">{fmtCompact(view.volume24h)}</span>
                    {sf?.shares > 0 && <span className="sl-info-sub mono">{fmtCount(sf.shares)} shares</span>}
                  </div>
                  {sf?.pe > 0 ? (
                    <div>
                      <span className="sl-info-k">P/E</span>
                      <span className="sl-info-v mono">{sf.pe.toFixed(1)}</span>
                      {sf.forwardPe > 0 && <span className="sl-info-sub mono">fwd {sf.forwardPe.toFixed(1)}</span>}
                    </div>
                  ) : (
                    <div><span className="sl-info-k">Prev close</span><span className="sl-info-v mono">{sf?.prevClose > 0 ? fmtPriceSmart(sf.prevClose) : '—'}</span></div>
                  )}
                </div>
              ) : (
              <div className="sl-info-3up">
                {/* CEX majors have no DEX pool, so `liquidity` is legitimately
                    absent — printing "$0" reads as a broken number rather than
                    an inapplicable one, and left the stats row looking empty on
                    a phone. Give the slot to FDV, which IS real for a major and
                    was otherwise buried in 10px text below. */}
                <div>
                  <span className="sl-info-k">{hasLiquidity ? 'Liquidity' : 'FDV'}</span>
                  <span className="sl-info-v mono">{hasLiquidity ? fmtCompact(view.liquidity) : fmtCompact(fdv)}</span>
                </div>
                <div><span className="sl-info-k">Volume</span><span className="sl-info-v mono">{fmtCompact(view.volume24h)}</span></div>
                <div><span className="sl-info-k">Mkt Cap</span><span className="sl-info-v mono">{fmtCompact(view.marketCap ?? view.mcap)}</span></div>
              </div>
              )}
              {/* STOCKS: where today sits in its session range and the 52-week
                  range - the two numbers a stock reader checks first. */}
              {isStock && dayPos != null && (
                <div className="sl-range">
                  <div className="sl-range-labels"><span className="mono">{fmtPriceSmart(dayLow)}</span><span className="sl-range-title">Day range</span><span className="mono">{fmtPriceSmart(dayHigh)}</span></div>
                  <div className="sl-range-track" aria-hidden><span className="sl-range-dot" style={{ left: `${dayPos}%` }} /></div>
                  <div className="sl-range-foot">
                    {dayOpen > 0 && <span>Open <b className="mono">{fmtPriceSmart(dayOpen)}</b></span>}
                    {sf?.prevClose > 0 && <span>Prev close <b className="mono">{fmtPriceSmart(sf.prevClose)}</b></span>}
                  </div>
                </div>
              )}
              {isStock && wkPos != null && (
                <div className="sl-range">
                  <div className="sl-range-labels"><span className="mono">{fmtPriceSmart(sf.week52Low)}</span><span className="sl-range-title">52-week range</span><span className="mono">{fmtPriceSmart(sf.week52High)}</span></div>
                  <div className="sl-range-track" aria-hidden><span className="sl-range-dot" style={{ left: `${wkPos}%` }} /></div>
                  {fromHigh52 != null && (
                    <div className="sl-range-foot">
                      <span>{fromHigh52 >= -0.5 ? <>At its <b>52-week high</b></> : <>From the high <b className={`mono ${changeCls(fromHigh52)}`}>{fmtChange(fromHigh52)}</b></>}</span>
                    </div>
                  )}
                </div>
              )}
              {/* stocks only carry a 24h change (already shown in the header + Day
                  row), so the multi-window strip would just be 3 dashes — skip it */}
              {!isStock && (
                <div className="sl-info-changes">
                  {changeTiles.map((c) => (
                    <div key={c.label} className={`sl-info-ch ${c.v ? changeCls(c.v) : 'nodata'}`}><span className="sl-info-ch-lbl">{c.label}</span><span className="sl-info-ch-v mono">{c.v ? fmtChange(c.v) : '—'}</span></div>
                  ))}
                </div>
              )}
              {(flowBuys + flowSells > 0 || num(view.txns24) > 0) && (
                <div className="sl-info-flow">
                  <div className="sl-flow-head"><span>Txns <b className="mono">{fmtInt(view.txns24)}</b></span><span className="sl-up-t">Buys <b className="mono">{fmtInt(flowBuys)}</b></span><span className="sl-down-t">Sells <b className="mono">{fmtInt(flowSells)}</b></span></div>
                  <FlowBar buys={flowBuys} sells={flowSells} />
                </div>
              )}
              <div className="sl-info-meta">
                {address && view.createdAt > 0 && <span>Age <b className="mono">{fmtAge(view.createdAt)}</b></span>}
                {isStock ? (
                  <>
                    <span>Exchange <b>{sf?.exchange || 'US'}</b></span>
                    {sf?.sector && <span>Sector <b>{sf.sector}</b></span>}
                    {sf?.industry && sf.industry !== sf.sector && <span>Industry <b>{sf.industry}</b></span>}
                  </>
                ) : (
                  <span>{!address ? 'Type' : 'Chain'} <b>{address ? (badge || `#${networkId}`) : 'Crypto'}</b></span>
                )}
                {view.holders > 0 && <span>Holders <b className="mono">{fmtInt(view.holders)}</b></span>}
              </div>
              {isStock && sf && (sf.eps > 0 || sf.dividendYield > 0 || sf.beta > 0 || sf.sharesOutstanding > 0 || sf.avgVolume > 0) && (
                <div className="sl-info-meta sl-info-extra">
                  {sf.eps > 0 && <span>EPS <b className="mono">{fmtPriceSmart(sf.eps)}</b></span>}
                  {sf.dividendYield > 0 && <span>Dividend <b className="mono">{sf.dividendYield.toFixed(2)}%</b></span>}
                  {sf.beta > 0 && <span>Beta <b className="mono">{sf.beta.toFixed(2)}</b></span>}
                  {sf.avgVolume > 0 && <span>Avg volume <b className="mono">{fmtCount(sf.avgVolume)}</b></span>}
                  {sf.sharesOutstanding > 0 && <span>Shares out <b className="mono">{fmtCount(sf.sharesOutstanding)}</b></span>}
                </div>
              )}
              {isStock && sf && (sf.targetMeanPrice > 0 || (earningsIn != null && earningsIn >= 0 && earningsIn <= 180)) && (
                <div className="sl-info-meta sl-info-extra sl-info-street">
                  {sf.targetMeanPrice > 0 && (
                    <span>Analysts{sf.recommendationKey ? <> <b>{recommendationLabel(sf.recommendationKey)}</b></> : null} · target <b className="mono">{fmtPriceSmart(sf.targetMeanPrice)}</b>{targetUpside != null && <em className={`mono ${changeCls(targetUpside)}`}>{fmtChange(targetUpside)}</em>}{sf.analystCount > 0 && <i> · {sf.analystCount} analyst{sf.analystCount === 1 ? '' : 's'}</i>}</span>
                  )}
                  {earningsIn != null && earningsIn >= 0 && earningsIn <= 180 && (
                    <span>Next earnings <b>{earningsLabel}</b><i> · {earningsIn === 0 ? 'today' : `in ${earningsIn}d`}</i>{sf.earningsAvg != null && <i> · est EPS {fmtPriceSmart(sf.earningsAvg)}</i>}</span>
                  )}
                </div>
              )}
              {/* FDV moves up into the stats row when there is no liquidity to
                  show, so don't print it twice */}
              {((fdv > 0 && (hasLiquidity || isStock)) || ath > 0) && (
                <div className="sl-info-meta sl-info-extra">
                  {fdv > 0 && (hasLiquidity || isStock) && <span>FDV <b className="mono">{fmtCompact(fdv)}</b></span>}
                  {ath > 0 && <span>ATH <b className="mono">{fmtPriceSmart(ath)}</b>{athChg ? <em className={`mono ${changeCls(athChg)}`}>{fmtChange(athChg)}</em> : null}</span>}
                </div>
              )}
              <div className="sl-info-actions">
                {wl && (
                  <button type="button" className={`sl-info-btn${watched ? ' on' : ''}`} onClick={() => (watched ? wl.remove(wid) : wl.add({ symbol: view.symbol, name: view.name, address, networkId, logo: view.logo }))}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 17.2 6.7 20l1.1-6L3.4 9.8l6-.8z" /></svg>
                    {watched ? 'Watching' : 'Watchlist'}
                  </button>
                )}
                <button type="button" className="sl-info-btn" onClick={() => onOpenPro?.(view)}>Alerts</button>
              </div>
              <div className="sl-info-trade">
                <button type="button" className="sl-buy" onClick={() => onOpenPro?.(view)}>Buy</button>
                <button type="button" className="sl-sell" onClick={() => onOpenPro?.(view)}>Sell</button>
              </div>
            </div>
          )}

          {sections.social && (
            <div className="lite-panel sl-d2-social">
              <h3 className="sl-panel-title">{isStock ? 'Company' : <>Social &amp; Links</>}</h3>
              <div className="sl-social-links">
                {socials.website && <a className="sl-social-a" href={socials.website} target="_blank" rel="noopener noreferrer">Website</a>}
                {socials.twitter && <a className="sl-social-a" href={socials.twitter} target="_blank" rel="noopener noreferrer">Twitter / X</a>}
                {socials.telegram && <a className="sl-social-a" href={socials.telegram} target="_blank" rel="noopener noreferrer">Telegram</a>}
                {dexUrl && <a className="sl-social-a" href={dexUrl} target="_blank" rel="noopener noreferrer">DexScreener</a>}
              </div>
              {isStock ? (
                sf ? (
                  <div className="sl-about">
                    {sf.description && (
                      <>
                        <p className={`sl-about-text${aboutOpen ? ' open' : ''}`}>{sf.description}</p>
                        {sf.description.length > 260 && <button type="button" className="sl-link-btn sl-about-more" onClick={() => setAboutOpen((o) => !o)}>{aboutOpen ? 'Less' : 'More'}</button>}
                      </>
                    )}
                    <div className="sl-info-meta">
                      {sf.ceo && <span>CEO <b>{sf.ceo.replace(/^(Mr\.|Ms\.|Mrs\.|Dr\.)\s+/, '')}</b></span>}
                      {sf.employees > 0 && <span>Employees <b className="mono">{fmtCount(sf.employees)}</b></span>}
                      {sf.ipo && <span>IPO <b className="mono">{String(sf.ipo).slice(0, 4)}</b></span>}
                      {sf.country && <span>HQ <b>{sf.country}</b></span>}
                    </div>
                  </div>
                ) : <div className="sl-trades-skel">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="sl-skel-row sl-skel-row--sm" />)}</div>
              ) : buzz != null ? (
                <div className="sl-buzz">
                  <div className="sl-buzz-row"><span>X mentions 24h</span><b className="mono">{fmtInt(buzz)}</b></div>
                  {authors != null && <div className="sl-buzz-row"><span>Unique authors</span><b className="mono">{fmtInt(authors)}</b></div>}
                  <p className="sl-buzz-note">Live social read from X Dash.</p>
                </div>
              ) : (
                <p className="sl-muted sl-buzz-empty">Social buzz read available for tracked tickers. This contract isn’t in the X Dash set yet.</p>
              )}
              {address && <p className="sl-info-contract mono">CA {shortAddr(address)}</p>}
            </div>
          )}

          {/* tweets stay in the rail only when the chart column has the txns panel */}
          {hasTxns && tweetsPanel}
        </aside>
      </div>

      {/* cinema filmstrip — flip through the source list by tapping a token.
          In LITE cinema the overlay renders its OWN pinned filmstrip outside the
          scroll container (hideFilmstrip), so this only shows on the standalone page. */}
      {!hideFilmstrip && cinema && Array.isArray(carousel) && carousel.length > 1 && (
        <div className="sl-filmstrip" ref={filmRef}>
          {carousel.map((c, i) => {
            const on = (c.address || c.symbol) === (view.address || view.symbol) || (c.symbol === view.symbol && i === (position - 1))
            return (
              <button key={`${c.address || c.symbol}-${i}`} type="button" className={`sl-film-item${on ? ' active' : ''}`} onClick={() => onPick?.(c)} title={c.symbol}>
                {c.logo ? <img src={c.logo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="sl-film-fallback">{String(c.symbol || '?').slice(0, 1)}</span>}
                <span className="sl-film-sym">{c.symbol}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
