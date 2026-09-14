/**
 * MarketCapCompare — "what if [your token] had the market cap of [project]".
 *
 * Leads with a cinematic "Result" hero:
 *
 *     ◇ NEURAL  with the market cap of  ◇ NEAR
 *               $266.76  (558.57×)
 *
 * framed logos, implied price + multiplier, and a NOW / ATH toggle that swaps
 * the reference's *current* cap for its *all-time-high* cap. The user can
 * SEARCH any project to drop it in as the target (resolved live via
 * getCoinROIData), or pick from the grid of presets below — the top crypto
 * projects (real logos + live caps) plus a handful of TradFi anchors (Gold,
 * Apple, …) so even the megacaps have something to reach for and the section
 * ALWAYS renders. Targets smaller than the selected coin still show (a sub-1×
 * "you're already bigger" read), coloured neutrally rather than green.
 *
 * Math: implied supply = yourMarketCap / yourPrice. At a target cap C the token
 * prices at C / supply = yourPrice × (C / yourMcap), a multiplier of C / yourMcap.
 * A reference's ATH cap ≈ mcap × (ath / currentPrice) — today's supply at peak.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTopCoinsMarketsPage, searchCoinsForROI, getCoinROIData } from '@/services/coinGeckoApi'

// Stable / wrapped / liquid-staking derivatives track another asset 1:1 — they
// make for misleading "market cap of" targets, so they're dropped.
const EXCLUDE_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDS',
  'FRAX', 'LUSD', 'GUSD', 'USDD', 'WBTC', 'WETH', 'WBETH', 'STETH', 'WSTETH',
  'WEETH', 'RETH', 'CBETH', 'METH', 'SOLVBTC', 'LBTC', 'BSC-USD', 'WBT',
])

// TradFi / commodity anchors (approximate caps, refreshed occasionally) so that
// even BTC/ETH have aspirational rungs and the section never comes up empty.
const ASSET_ANCHORS = [
  { id: 'anchor-silver', symbol: 'SILVER', name: 'Silver',        ticker: 'Ag',   cap: 1.7e12,  tint: 'silver', kind: 'asset' },
  { id: 'anchor-aramco', symbol: 'ARAMCO', name: 'Saudi Aramco',  ticker: 'ARM',  cap: 1.8e12,  kind: 'asset' },
  { id: 'anchor-amazon', symbol: 'AMZN',   name: 'Amazon',        ticker: 'AMZN', cap: 2.4e12,  kind: 'asset' },
  { id: 'anchor-msft',   symbol: 'MSFT',   name: 'Microsoft',     ticker: 'MSFT', cap: 3.1e12,  kind: 'asset' },
  { id: 'anchor-nvda',   symbol: 'NVDA',   name: 'Nvidia',        ticker: 'NVDA', cap: 3.3e12,  kind: 'asset' },
  { id: 'anchor-aapl',   symbol: 'AAPL',   name: 'Apple',         ticker: 'AAPL', cap: 3.4e12,  kind: 'asset' },
  { id: 'anchor-gold',   symbol: 'GOLD',   name: 'Gold',          ticker: 'Au',   cap: 18.5e12, tint: 'gold', kind: 'asset' },
]

const MAX_CARDS = 14

// Recognisable majors — used to pick a relatable default comparison target
// (so a micro-cap defaults to "…the market cap of SOL", not an obscure rung).
const RECOGNISABLE = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'TON', 'NEAR', 'SUI'])

function multiplierLabel(m) {
  if (!Number.isFinite(m) || m <= 0) return '—'
  if (m >= 100) return `${Math.round(m).toLocaleString('en-US')}×`
  if (m >= 10) return `${m.toFixed(1)}×`
  if (m >= 1) return `${m.toFixed(2)}×`
  return `${m.toFixed(3)}×`
}

function fmtProjectedPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 0.01) return '$' + p.toFixed(4)
  if (p >= 0.0001) return '$' + p.toFixed(6)
  return '$' + p.toExponential(2)
}

function CoinLogo({ src, symbol, text, tint, size = 24, framed = false }) {
  const [failed, setFailed] = useState(false)
  const label = text || (symbol || '?').slice(0, 1).toUpperCase()
  const cls = `mcc-logo${framed ? ' mcc-logo--framed' : ''}`
  if (!src || failed) {
    return (
      <span
        className={`${cls} mcc-logo--fallback${tint ? ` mcc-logo--${tint}` : ''}`}
        style={{ width: size, height: size, fontSize: label.length > 2 ? size * 0.3 : size * 0.42 }}
        aria-hidden
      >
        {label}
      </span>
    )
  }
  return (
    <img className={cls} src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
  )
}

export default function MarketCapCompare({
  selected,
  yourPrice,
  yourMarketCap,
  tokenAmount = 0,
  fmtLarge,
  dayMode = false,
}) {
  const [benchmarks, setBenchmarks] = useState([])
  const [mode, setMode] = useState('now') // 'now' | 'ath'
  const [activeId, setActiveId] = useState(null)
  const [custom, setCustom] = useState([]) // searched-in targets
  const [query, setQuery] = useState('')
  const [sugs, setSugs] = useState([])
  const [openSugs, setOpenSugs] = useState(false)
  const [resolving, setResolving] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    ;(async () => {
      // Sparklines are never read here (the grid shows caps/multipliers, not
      // charts) — skip the ~412KB sparkline payload.
      const rows = await getTopCoinsMarketsPage(1, 100, { sparkline: false }).catch(() => [])
      if (cancelled || !mountedRef.current) return
      setBenchmarks(Array.isArray(rows) ? rows : [])
    })()
    return () => { cancelled = true; mountedRef.current = false }
  }, [])

  // Reset picker + searched targets when the user changes their token.
  useEffect(() => { setActiveId(null); setCustom([]); setQuery(''); setSugs([]) }, [selected?.id])

  // Debounced search for the "compare against any project" box.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) { setSugs([]); return }
    const t = setTimeout(async () => {
      const list = await searchCoinsForROI(q).catch(() => [])
      if (!mountedRef.current) return
      setSugs(Array.isArray(list) ? list.slice(0, 8) : [])
      setOpenSugs(true)
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  const yourSymbol = selected?.symbol?.toUpperCase() || ''
  const yourName = selected?.name || yourSymbol
  const yourLogo = selected?.large || selected?.thumb || selected?.image || null

  const supply = yourPrice > 0 && yourMarketCap > 0 ? yourMarketCap / yourPrice : 0

  // Resolve a searched coin into a comparison target (needs its live mcap/ath).
  const pickTarget = useCallback(async (item) => {
    if (!item?.id) return
    const sym = (item.symbol || '').toUpperCase()
    if (sym && sym === yourSymbol) { setQuery(''); setSugs([]); setOpenSugs(false); return }
    setQuery(`${item.name || ''}`)
    setSugs([])
    setOpenSugs(false)
    setResolving(true)
    try {
      const d = await getCoinROIData(item.id)
      if (!mountedRef.current) return
      const cap = Number(d?.marketCap)
      if (!(cap > 0)) { setResolving(false); return }
      const price = Number(d?.currentPrice)
      const ath = Number(d?.athPrice)
      const hasAth = ath > 0 && price > 0 && ath >= price
      const target = {
        id: item.id,
        symbol: sym || (item.name || '?').slice(0, 4).toUpperCase(),
        name: item.name || sym,
        logo: item.large || item.thumb || null,
        nowCap: cap,
        athCap: hasAth ? cap * (ath / price) : cap,
        hasAth,
        kind: 'custom',
      }
      setCustom((prev) => [target, ...prev.filter((c) => c.id !== target.id)].slice(0, 6))
      setActiveId(target.id)
    } finally {
      if (mountedRef.current) setResolving(false)
    }
  }, [yourSymbol])

  const cards = useMemo(() => {
    if (!(supply > 0)) return []

    const crypto = benchmarks
      .filter((b) => {
        const sym = (b.symbol || '').toUpperCase()
        const mcap = Number(b.market_cap)
        if (!sym || !(mcap > 0)) return false
        if (sym === yourSymbol) return false
        return !EXCLUDE_SYMBOLS.has(sym)
      })
      .map((b) => {
        const nowCap = Number(b.market_cap)
        const ath = Number(b.ath)
        const price = Number(b.current_price)
        const hasAth = ath > 0 && price > 0 && ath >= price
        return {
          id: b.id,
          symbol: (b.symbol || '').toUpperCase(),
          name: b.name || b.symbol,
          logo: b.image || null,
          nowCap, athCap: hasAth ? nowCap * (ath / price) : nowCap, hasAth, kind: 'crypto',
        }
      })

    const anchors = ASSET_ANCHORS
      .filter((a) => a.symbol !== yourSymbol)
      .map((a) => ({
        id: a.id, symbol: a.symbol, name: a.name, ticker: a.ticker, tint: a.tint,
        logo: null, nowCap: a.cap, athCap: a.cap, hasAth: false, kind: 'asset',
      }))

    // Searched-in targets always lead and are never filtered out.
    const presets = [...crypto, ...anchors]
    const bigger = presets.filter((c) => c.nowCap > yourMarketCap).sort((a, b) => b.nowCap - a.nowCap)
    const smaller = presets.filter((c) => c.nowCap <= yourMarketCap).sort((a, b) => b.nowCap - a.nowCap)
    const ordered = [...custom, ...bigger, ...smaller]

    // Dedupe by id then symbol (custom wins).
    const seen = new Set()
    const out = []
    for (const c of ordered) {
      const k1 = c.id || c.symbol
      if (seen.has(k1) || seen.has(c.symbol)) continue
      seen.add(k1); seen.add(c.symbol)
      out.push(c)
    }
    return out.slice(0, MAX_CARDS)
  }, [benchmarks, supply, yourSymbol, yourMarketCap, custom])

  const anyAth = useMemo(() => cards.some((c) => c.hasAth), [cards])
  const effectiveMode = anyAth ? mode : 'now'

  // Default hero = smallest RECOGNISABLE major still bigger than the user's
  // token (a relatable moonshot, not an obscure nearest rung), then the largest
  // crypto above, then anything above.
  const defaultId = useMemo(() => {
    if (cards.length === 0) return null
    if (custom.length) return custom[0].id
    const named = cards
      .filter((c) => c.kind === 'crypto' && c.nowCap > yourMarketCap && RECOGNISABLE.has(c.symbol))
      .sort((a, b) => a.nowCap - b.nowCap)
    if (named.length) return named[0].id
    const biggerCrypto = cards.filter((c) => c.kind === 'crypto' && c.nowCap > yourMarketCap)
    if (biggerCrypto.length) return biggerCrypto[0].id
    const biggerAny = cards.filter((c) => c.nowCap > yourMarketCap)
    if (biggerAny.length) return biggerAny[biggerAny.length - 1].id
    return cards[0].id
  }, [cards, yourMarketCap, custom])

  const hero = useMemo(
    () => cards.find((c) => c.id === activeId) || cards.find((c) => c.id === defaultId) || cards[0] || null,
    [cards, activeId, defaultId],
  )

  if (cards.length === 0 || !hero) return null

  const heroAth = effectiveMode === 'ath' && hero.hasAth
  const heroCap = heroAth ? hero.athCap : hero.nowCap
  const heroPrice = heroCap / supply
  const heroMult = heroCap / yourMarketCap
  const heroDown = heroMult < 1
  const heroBag = tokenAmount > 0 ? tokenAmount * heroPrice : null
  const modeLabel = heroAth ? `${hero.name} peak cap` : `${hero.name} cap`

  return (
    <div className={`mcc${dayMode ? ' mcc--day' : ''}`}>
      <div className="mcc-head">
        <span className="mcc-head__eyebrow">MARKET CAP OF</span>
        <h3 className="mcc-head__title">
          If <span className="mcc-head__token">{yourSymbol || yourName}</span> had the market cap of another project…
        </h3>
      </div>

      {/* Search any project to compare against */}
      <div className="mcc-search">
        <span className="mcc-search__icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        <input
          type="text"
          className="mcc-search__input"
          placeholder="Compare against any project (e.g. NEAR, Solana, Render)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => sugs.length > 0 && setOpenSugs(true)}
          aria-label="Search a project to compare against"
        />
        {resolving && <span className="mcc-search__spin" aria-hidden />}
        {openSugs && sugs.length > 0 && (
          <ul className="mcc-search__list" role="listbox">
            {sugs.map((item, i) => (
              <li
                key={item.id || i}
                role="option"
                className="mcc-search__item"
                onMouseDown={(e) => { e.preventDefault(); pickTarget(item) }}
              >
                <CoinLogo src={item.large || item.thumb} symbol={item.symbol} size={20} />
                <span className="mcc-search__item-name">{item.name}</span>
                <span className="mcc-search__item-sym">{item.symbol}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Hero result ── */}
      <div className="mcc-hero">
        <div className="mcc-hero__bar">
          <span className="mcc-hero__label">Result</span>
          {anyAth && (
            <div className="mcc-hero__toggle" role="tablist" aria-label="Reference market cap basis">
              <button
                type="button" role="tab" aria-selected={effectiveMode === 'now'}
                className={`mcc-hero__toggle-btn${effectiveMode === 'now' ? ' is-active' : ''}`}
                onClick={() => setMode('now')}
              >NOW</button>
              <button
                type="button" role="tab" aria-selected={effectiveMode === 'ath'}
                className={`mcc-hero__toggle-btn${effectiveMode === 'ath' ? ' is-active' : ''}`}
                onClick={() => setMode('ath')}
                disabled={!hero.hasAth}
                title={!hero.hasAth ? 'No ATH data for this target' : undefined}
              >ATH</button>
            </div>
          )}
        </div>

        <div className="mcc-hero__statement">
          <span className="mcc-hero__side">
            <CoinLogo src={yourLogo} symbol={yourSymbol} size={44} framed />
            <span className="mcc-hero__name">{yourSymbol || yourName}</span>
          </span>
          <span className="mcc-hero__conn">with the market cap of</span>
          <span className="mcc-hero__side">
            <CoinLogo src={hero.logo} symbol={hero.symbol} text={hero.ticker} tint={hero.tint} size={44} framed />
            <span className="mcc-hero__name">{hero.symbol}</span>
          </span>
        </div>

        <div className="mcc-hero__result">
          <span className="mcc-hero__price">{fmtProjectedPrice(heroPrice)}</span>
          <span className={`mcc-hero__mult${heroDown ? ' is-down' : ''}`}>({multiplierLabel(heroMult)})</span>
        </div>

        <div className="mcc-hero__foot">
          <span className="mcc-hero__foot-meta">{modeLabel} · {fmtLarge ? fmtLarge(heroCap) : heroCap}</span>
          {heroBag != null && (
            <span className="mcc-hero__bag">Your bag <strong>{fmtProjectedPrice(heroBag)}</strong></span>
          )}
        </div>
      </div>

      {/* ── Picker grid ── */}
      <div className="mcc-grid-label">
        <span>Stack {yourSymbol || 'it'} against the field</span>
        {anyAth && <span className="mcc-grid-label__hint">{effectiveMode === 'ath' ? 'at all-time-high caps' : 'at current caps'}</span>}
      </div>

      <div className="mcc-grid">
        {cards.map((c, i) => {
          const cap = effectiveMode === 'ath' && c.hasAth ? c.athCap : c.nowCap
          const projectedPrice = cap / supply
          const multiplier = cap / yourMarketCap
          const down = multiplier < 1
          const bagValue = tokenAmount > 0 ? tokenAmount * projectedPrice : null
          const isActive = c.id === hero.id
          return (
            <button
              type="button"
              key={c.id || c.symbol}
              className={`mcc-card${isActive ? ' is-active' : ''}${c.kind === 'custom' ? ' mcc-card--custom' : ''}`}
              style={{ animationDelay: `${Math.min(i, 13) * 36}ms` }}
              onClick={() => setActiveId(c.id)}
              aria-pressed={isActive}
            >
              <span className="mcc-card__sheen" aria-hidden />
              <span className="mcc-card__row">
                <span className="mcc-card__pair">
                  <CoinLogo src={yourLogo} symbol={yourSymbol} size={20} />
                  <span className="mcc-card__at" aria-hidden>@</span>
                  <CoinLogo src={c.logo} symbol={c.symbol} text={c.ticker} tint={c.tint} size={20} />
                </span>
                <span className="mcc-card__bench">{c.symbol}</span>
              </span>

              <span className="mcc-card__price">{fmtProjectedPrice(projectedPrice)}</span>
              <span className={`mcc-card__mult${down ? ' is-down' : ''}`}>{multiplierLabel(multiplier)}</span>

              <span className="mcc-card__foot">
                <span className="mcc-card__foot-label">{c.name} cap</span>
                <span className="mcc-card__foot-val">{fmtLarge ? fmtLarge(cap) : cap}</span>
              </span>

              {bagValue != null && (
                <span className="mcc-card__bag">Your bag <strong>{fmtProjectedPrice(bagValue)}</strong></span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
