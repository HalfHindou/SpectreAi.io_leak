/**
 * MobileInfoBody — DexScreener-style token info panel (data only, no prose).
 *
 * Rendered as the "Info" view of the mobile token page (MobileTokenPage,
 * via the MobileViewNav switcher). Ordered:
 *   links row → price cards (USD / native) → liquidity | FDV | mcap →
 *   timeframe tabs (5M/1H/4H/24H, each with its % change) → TXNS / VOLUME /
 *   MAKERS buy-sell split bars for the selected window → supply + age + ATH →
 *   safety → holders. Docked Trade CTA only when not `embedded` (the page
 *   view's persistent Buy/Sell bar owns trading).
 *
 * Reads already-shared data (TokenDetailsContext, cached fetchers); the only
 * new fetch is the per-window stats (getDetailedTokenStats, 45s cached).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Copy, Check, Globe, ChevronDown } from 'lucide-react'
import TelegramGlyph from '../ui/TelegramGlyph'
import { useSharedTokenDetails } from '../../contexts/TokenDetailsContext'
import {
  getDetailedTokenStats,
  getPairInfo,
  getTokenPricesBySymbols,
  getBars,
  getNetworkName,
} from '../../services/codexApi'
import { highlightEntities } from '../../lib/textUtils'
import { ChainIcon } from '../../utils/chainIcons'
import { CHAINS } from './MobilePriceHero'
import { readCodexChangePct } from '../../lib/marketFormat'
import { useBarChangeWindows } from '../../hooks/useBarChangeWindows'
import { Sparkline } from '../ui/viz'
import { whenIdle } from '../../utils/whenIdle'
import { isAppActive } from '../../lib/idleManager'
import { fetchTokenTaxCached } from '../../lib/tokenTax'
import useHoldersChart from '../../hooks/useHoldersChart'
import useDossier from '../../hooks/useDossier'
import { fetchTokenProfile } from '../../services/tokenProfile'
import { useCopyToast } from '../../App'
import './MobileInfoBody.css'

const fmtPrice = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '—'
  if (v >= 1) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return '$' + v.toPrecision(4)
}

const fmtLargeUsd = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3)  return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}
const fmtLarge = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return Math.round(v).toLocaleString('en-US')
}
const fmtCount = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toLocaleString('en-US')
}
const fmtAge = (createdAt) => {
  if (!createdAt) return '—'
  const created = Number(createdAt) * (Number(createdAt) > 1e12 ? 1 : 1000)
  const diff = Date.now() - created
  if (!(diff > 0)) return '—'
  const days = Math.floor(diff / 86400000)
  if (days >= 365) return `${(days / 365).toFixed(1)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  if (days >= 1) return `${days}d`
  return `${Math.floor(diff / 3600000)}h`
}

/** DexScreener-style price in the chain's native coin: `0.0₅2979 SOL`. */
function NativePrice({ usd, nativeUsd, nativeSym }) {
  const p = Number(usd) / Number(nativeUsd)
  if (!Number.isFinite(p) || p <= 0) return <>—</>
  if (p >= 1) return <>{p.toLocaleString('en-US', { maximumFractionDigits: 2 })} {nativeSym}</>
  if (p >= 0.001) return <>{p.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} {nativeSym}</>
  const dec = p.toFixed(20).split('.')[1] || ''
  let zeros = 0
  while (dec[zeros] === '0') zeros++
  const sig = dec.slice(zeros).replace(/0+$/, '').slice(0, 4) || '0'
  return <>0.0<sub className="mib-sub">{zeros}</sub>{sig} {nativeSym}</>
}

// Codex networkId → native coin symbol (for the second price card).
const NATIVE_BY_NETWORK = {
  1: 'ETH', 10: 'ETH', 8453: 'ETH', 42161: 'ETH', 59144: 'ETH', 81457: 'ETH',
  56: 'BNB', 137: 'POL', 43114: 'AVAX', 1399811149: 'SOL', 130: 'ETH',
}

// ATH from up to 3y of daily closes (same caveat as the old metrics grid:
// genuine for tokens younger than 3y, a 3y-high for older majors).
const _athCache = {} // { [addr]: { ath, ts } }
const ATH_TTL = 10 * 60_000

const TF_ORDER = ['5m', '1h', '4h', '24h']
const TF_LABEL = { '5m': '5M', '1h': '1H', '4h': '4H', '24h': '24H' }

const changeClass = (pct) => {
  const v = Number(pct)
  if (!Number.isFinite(v)) return 'mib-chg--flat'
  const a = Math.abs(v)
  const dir = v >= 0 ? 'up' : 'down'
  if (a < 0.5) return `mib-chg--${dir} mib-chg--muted`
  if (a < 2) return `mib-chg--${dir} mib-chg--soft`
  return `mib-chg--${dir}`
}

/** One TXNS/VOLUME/MAKERS row: total on the left, buy/sell split on the right. */
function StatSplitRow({ label, total, leftLabel, leftValue, rightLabel, rightValue, leftText, rightText }) {
  const l = Number(leftValue) || 0
  const r = Number(rightValue) || 0
  const sum = l + r
  const leftPct = sum > 0 ? (l / sum) * 100 : 50
  return (
    <div className="mib-statrow">
      <div className="mib-statrow-total">
        <span className="mib-statrow-label">{label}</span>
        <span className="mib-statrow-value">{total}</span>
      </div>
      <div className="mib-statrow-split">
        <div className="mib-statrow-heads">
          <span className="mib-statrow-head">{leftLabel}</span>
          <span className="mib-statrow-head">{rightLabel}</span>
        </div>
        <div className="mib-statrow-nums">
          <span className="mib-statrow-num">{leftText}</span>
          <span className="mib-statrow-num">{rightText}</span>
        </div>
        <div className="mib-statrow-bar" aria-hidden="true">
          <span className="mib-statrow-bar-buy" style={{ width: `${leftPct}%` }} />
          <span className="mib-statrow-bar-sell" style={{ width: `${100 - leftPct}%` }} />
        </div>
      </div>
    </div>
  )
}

export default function MobileInfoBody({ token, onTrade, embedded = false, refreshTick = 0 }) {
  const { tokenData: live } = useSharedTokenDetails() || {}

  const symbol = live?.symbol || token?.symbol || 'Token'
  const price = live?.price ?? live?.priceUsd

  const address = token?.address
  const networkId = token?.networkId || 1
  const marketCap = live?.marketCap
  const liquidity = live?.liquidity
  const circulating = live?.circulatingSupply
  const total = live?.totalSupply
  const fdv = Number(live?.fdv) > 0
    ? live.fdv
    : (Number(price) > 0 && Number(total) > 0 ? Number(price) * Number(total) : null)
  const supplyPct = total > 0 && circulating > 0 ? Math.min(1, circulating / total) : null
  const createdAt = live?.createdAt ?? live?.pairCreatedAt

  // ── Per-window % change (same sources as MobilePriceHero: bars first,
  // detail-endpoint fallback normalized through readCodexChangePct) ─────
  const barWindows = useBarChangeWindows(address, networkId)
  const changeByTf = {
    '5m': readCodexChangePct(live?.change5m ?? live?.change5),
    '1h': barWindows?.change1h ?? readCodexChangePct(live?.change1h ?? live?.change1) ?? null,
    '4h': barWindows?.change4h ?? null,
    '24h': barWindows?.change24h ?? readCodexChangePct(live?.change24h ?? live?.change24) ?? null,
  }

  // ── Per-window buy/sell stats (the DexScreener block) ─────────────────
  const [tf, setTf] = useState('24h')
  const [stats, setStats] = useState(null)     // { windows, ts } | null
  const [statsLoading, setStatsLoading] = useState(true)
  useEffect(() => {
    if (!address) { setStats(null); setStatsLoading(false); return }
    let cancelled = false
    // refreshTick > 0 = pull-to-refresh re-run: keep the current numbers on
    // screen (no skeleton flash) and force past the 45s client cache.
    const isManualRefresh = refreshTick > 0
    if (!isManualRefresh) {
      setStats(null)
      setStatsLoading(true)
    }
    const load = (force = false) => {
      getDetailedTokenStats(address, networkId, { force }).then((res) => {
        if (cancelled) return
        if (res) setStats(res)
        else if (!isManualRefresh) setStats(res)
        setStatsLoading(false)
      })
    }
    load(isManualRefresh)
    const interval = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      load()
    }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [address, networkId, refreshTick])
  const win = stats?.windows?.[tf] || null

  // ── Native quote price (second price card) ────────────────────────────
  const nativeSym = NATIVE_BY_NETWORK[networkId] || null
  const [nativeUsd, setNativeUsd] = useState(null)
  useEffect(() => {
    if (!nativeSym) { setNativeUsd(null); return }
    let cancelled = false
    getTokenPricesBySymbols([nativeSym]).then((map) => {
      if (cancelled) return
      const p = map?.[nativeSym]?.price
      setNativeUsd(p > 0 ? p : null)
    })
    return () => { cancelled = true }
  }, [nativeSym])

  // ── Top-pair metadata (pair strip + Pair Info rows) ───────────────────
  const [pairInfo, setPairInfo] = useState(null)
  useEffect(() => {
    if (!address) { setPairInfo(null); return }
    let cancelled = false
    setPairInfo(null)
    getPairInfo(address, networkId).then((res) => {
      if (!cancelled) setPairInfo(res)
    })
    return () => { cancelled = true }
  }, [address, networkId])

  const chain = CHAINS[networkId] || null
  const quoteSym = pairInfo?.quote?.symbol || null
  // Pooled USD values: each side priced directly — token side from the live
  // token price, quote side from the quote coin's own USD price (wrapped
  // natives map to their base coin; stables are $1).
  const pooledTokenUsd = pairInfo?.pooledToken > 0 && price > 0 ? pairInfo.pooledToken * price : null
  const [quoteUsd, setQuoteUsd] = useState(null)
  useEffect(() => {
    if (!quoteSym) { setQuoteUsd(null); return }
    const up = quoteSym.toUpperCase()
    if (['USDC', 'USDT', 'DAI', 'FDUSD', 'BUSD', 'USD1', 'USDE'].includes(up)) { setQuoteUsd(1); return }
    const priceSym = ({ WETH: 'ETH', WSOL: 'SOL', WBNB: 'BNB', WMATIC: 'POL', WPOL: 'POL', WAVAX: 'AVAX' })[up] || up
    let cancelled = false
    setQuoteUsd(null)
    getTokenPricesBySymbols([priceSym]).then((map) => {
      if (cancelled) return
      const p = map?.[priceSym]?.price
      setQuoteUsd(p > 0 ? p : null)
    })
    return () => { cancelled = true }
  }, [quoteSym])
  const pooledQuoteUsd = pairInfo?.pooledQuote > 0 && quoteUsd > 0 ? pairInfo.pooledQuote * quoteUsd : null
  const shortAddr = (a) => (a ? `${a.slice(0, 5)}…${a.slice(-4)}` : null)
  // The CHAINS explorer fn builds token URLs — pair/wallet addresses need the
  // generic address page on the same explorer.
  const addrExplorerUrl = (a) => {
    if (!a || !chain?.explorer) return null
    return chain.explorer.url(a).replace('/token/', isSolana ? '/account/' : '/address/')
  }
  const tokenExplorerUrl = (a) => (a && chain?.explorer ? chain.explorer.url(a) : null)

  // ── ATH (idle-deferred 3y daily closes) ───────────────────────────────
  const [athPrice, setAthPrice] = useState(null)
  useEffect(() => {
    if (!address) { setAthPrice(null); return }
    let cancelled = false
    let cancelIdle = null
    setAthPrice(null)
    const key = address.toLowerCase()
    const cached = _athCache[key]
    if (cached && Date.now() - cached.ts < ATH_TTL) { setAthPrice(cached.ath); return }
    const timer = setTimeout(() => {
      if (cancelled) return
      cancelIdle = whenIdle(async () => {
        if (cancelled) return
        try {
          const now = Math.floor(Date.now() / 1000)
          const from = now - 3 * 365 * 86400
          const res = await getBars(address, '1D', from, now, networkId)
          const closes = (res?.getBars || [])
            .map((b) => parseFloat(b.close ?? b.c ?? 0)).filter((p) => p > 0)
          const ath = closes.length ? Math.max(...closes) : null
          _athCache[key] = { ath, ts: Date.now() }
          if (!cancelled) setAthPrice(ath)
        } catch { if (!cancelled) setAthPrice(null) }
      })
    }, 1200)
    return () => { cancelled = true; clearTimeout(timer); if (cancelIdle) cancelIdle() }
  }, [address, networkId])

  // ── Safety (tokenTax) + 14d holder trend ──────────────────────────────
  const isSolana = Number(networkId) === 1399811149
  const [tax, setTax] = useState(undefined)
  useEffect(() => {
    if (!address || address === 'native') { setTax(null); return }
    let cancelled = false
    setTax(undefined)
    fetchTokenTaxCached(address, networkId)
      .then((t) => { if (!cancelled) setTax(t ?? null) })
      .catch(() => { if (!cancelled) setTax(null) })
    return () => { cancelled = true }
  }, [address, networkId])

  const { data: holderPoints } = useHoldersChart(address, networkId, { bucket: '1d', limit: 14 })
  const holderSeries = holderPoints && holderPoints.length >= 2 ? holderPoints.map((p) => p.v) : null
  const holderCount = live?.holders
    || (holderPoints && holderPoints.length ? holderPoints[holderPoints.length - 1].v : 0)
  const holderDeltaPct = holderSeries
    ? ((holderSeries[holderSeries.length - 1] - holderSeries[0]) / (holderSeries[0] || 1)) * 100
    : null

  // ── Token profile (DexScreener banner / logo / full link set) ─────────
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    if (!address) { setProfile(null); return undefined }
    let cancelled = false
    setProfile(null)
    fetchTokenProfile(address)
      .then((p) => { if (!cancelled) setProfile(p) })
      .catch(() => { if (!cancelled) setProfile(null) })
    return () => { cancelled = true }
  }, [address])
  const [bannerOk, setBannerOk] = useState(true)
  useEffect(() => { setBannerOk(true) }, [profile?.banner])

  // ── Contract & social links ───────────────────────────────────────────
  const { data: dossier } = useDossier(token)
  const socials = useMemo(
    () => ({ ...(live?.socials || {}), ...(dossier?.socials || {}) }),
    [live?.socials, dossier?.socials],
  )
  const { triggerCopyToast } = useCopyToast() || {}
  const [copiedKey, setCopiedKey] = useState(null)
  const shortCa = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null
  const copied = copiedKey === 'ca'
  const copyText = (key, value, label = 'Copied') => {
    if (!value) return
    try { navigator.clipboard?.writeText(value) } catch {}
    triggerCopyToast?.(label)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1200)
  }
  const copyCa = () => copyText('ca', address, 'Contract copied')
  const twUrl = socials.twitter
    ? (socials.twitter.startsWith('http') ? socials.twitter : `https://x.com/${socials.twitter.replace(/^@/, '')}`)
    : null
  const tgUrl = socials.telegram
    ? (socials.telegram.startsWith('http') ? socials.telegram : `https://t.me/${socials.telegram.replace(/^@/, '')}`)
    : null
  const webUrl = socials.website
    ? (socials.website.startsWith('http') ? socials.website : `https://${socials.website}`)
    : null

  // Project card: DexScreener's link set, backfilled with whatever the dossier
  // knows that DexScreener doesn't. Deduped by URL.
  const profileLinks = useMemo(() => {
    const out = []
    const seen = new Set()
    const add = (label, url, kind) => {
      if (!url || seen.has(url)) return
      seen.add(url)
      out.push({ label, url, kind })
    }
    for (const l of profile?.links || []) add(l.label, l.url, l.kind)
    add('Website', webUrl, 'web')
    add('Twitter', twUrl, 'twitter')
    add('Telegram', tgUrl, 'telegram')
    return out
  }, [profile, webUrl, twUrl, tgUrl])
  // Not rendered - kept as a guard so the Dossier below never reprints the raw
  // X bio as if it were a written summary.
  const bio = (dossier?.socials?.twitterBio || '').trim() || null

  // ── Dossier: what this token IS, in prose (sits above Pair Info) ──────
  // Same payload the desktop HeaderDossier reads. The AI project summary wins;
  // the community narrative is the fallback; the token's own metadata
  // description is the last resort. The raw X bio is deliberately NOT a source
  // here - the project card below already shows it, verbatim and labelled.
  const [dossierOpen, setDossierOpen] = useState(false)
  const { dossierText, dossierSrc } = useMemo(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
    // Aggregator copy often opens with its own form heading ("What is the
    // project about?") — drop it, the section already has a title.
    const clean = (s) => String(s || '').trim().replace(/^[^\n?]{0,60}\?\s*\n+/, '').trim()
    const projectDesc = clean(dossier?.lore?.projectDescription)
    // Upstream falls back to the raw X bio when it has nothing to summarise -
    // detect that and skip it so the bio isn't printed twice on one screen.
    const isRawBio = projectDesc && bio && norm(projectDesc).startsWith(norm(bio).slice(0, 60))
    const narrative = clean(String(dossier?.lore?.communityNarrative || '')
      .replace(/\nVerdict:[\s\S]*/i, ''))
    if (projectDesc && !isRawBio) return { dossierText: projectDesc, dossierSrc: 'AI dossier' }
    if (narrative) return { dossierText: narrative, dossierSrc: 'AI dossier' }
    // Codex metadata description is community-submitted, so it can carry
    // one-line junk ("Prod validation…"). Only take it when it reads like an
    // actual description.
    const meta = clean(live?.description || token?.description)
    if (meta.length >= 80 && meta !== bio) return { dossierText: meta, dossierSrc: 'Project description' }
    return { dossierText: '', dossierSrc: '' }
  }, [dossier?.lore?.projectDescription, dossier?.lore?.communityNarrative, live?.description, token?.description, bio])
  useEffect(() => { setDossierOpen(false) }, [address])

  // Typographic split so the card reads as an editorial brief instead of one
  // flat gray block: the opening sentence is the lead (brighter, larger), the
  // remainder is grouped into ~150-char paragraphs and only shown on expand.
  // Entity highlighting is the same helper the desktop HeaderDossier uses.
  const dossierChain = getNetworkName(networkId)
  const { dossierLead, dossierParas, dossierClamped, dossierLong } = useMemo(() => {
    if (!dossierText) return { dossierLead: null, dossierParas: [], dossierClamped: false, dossierLong: false }
    const mark = (s) => highlightEntities(s, { tokenSymbol: symbol, chainName: dossierChain })
    const m = dossierText.match(/^[^.!?]+[.!?]+/)
    const leadRaw = m && m[0].trim().length <= 260 ? m[0].trim() : dossierText
    const restRaw = leadRaw === dossierText ? '' : dossierText.slice(m[0].length).trim()
    const sentences = (restRaw.match(/[^.!?]+[.!?]+["')\]]?\s*/g) || (restRaw ? [restRaw] : []))
      .map((s) => s.trim())
      .filter(Boolean)
    const paras = []
    let buf = ''
    for (const s of sentences) {
      buf = buf ? `${buf} ${s}` : s
      if (buf.length >= 150) { paras.push(buf); buf = '' }
    }
    if (buf) {
      if (paras.length && buf.length < 70) paras[paras.length - 1] += ` ${buf}`
      else paras.push(buf)
    }
    // ~44 chars per line at 14.5px on a 390-430px screen, so a lead over ~190
    // chars is the only one that actually hits the 4-line clamp - gate the
    // fade mask on that, or a 3-line lead renders needlessly dimmed.
    const clamped = leadRaw.length > 190
    return {
      dossierLead: mark(leadRaw),
      dossierParas: paras.map(mark),
      dossierClamped: clamped,
      dossierLong: paras.length > 0 || clamped,
    }
  }, [dossierText, symbol, dossierChain])

  // ── Converter: TOKEN ⇄ USD / quote ────────────────────────────────────
  // `amount` is always the side the user typed into; `flipped` says which side
  // that is, so a rate tick never overwrites what is being typed.
  const [amount, setAmount] = useState('1')
  const [flipped, setFlipped] = useState(false)
  const [convUnit, setConvUnit] = useState('usd') // 'usd' | 'quote'
  const convRate = convUnit === 'usd'
    ? (price > 0 ? price : null)
    : (price > 0 && quoteUsd > 0 ? price / quoteUsd : null)
  const convUnitLabel = convUnit === 'usd' ? 'USD' : (quoteSym || '')
  const convOut = useMemo(() => {
    const n = parseFloat(String(amount).replace(',', '.'))
    if (!Number.isFinite(n) || !convRate) return ''
    const v = flipped ? n / convRate : n * convRate
    if (!Number.isFinite(v)) return ''
    if (v === 0) return '0'
    const abs = Math.abs(v)
    const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 10
    return String(Number(v.toFixed(digits)))
  }, [amount, convRate, flipped])

  return (
    <div className={`mib${embedded ? ' mib--embedded' : ''}`}>
      {/* 0 — pair strip: TOKEN / QUOTE · Chain › DEX (DexScreener header line) */}
      {(quoteSym || chain) && (
        <section className="mib-pairstrip" aria-label="Pair">
          <span className="mib-pair-name">
            {symbol}
            {quoteSym && <span className="mib-pair-quote"> / {quoteSym}</span>}
          </span>
          <span className="mib-pair-venue">
            {chain && (
              <>
                <ChainIcon networkId={networkId} size={13} />
                <span>{chain.name}</span>
              </>
            )}
            {pairInfo?.exchange?.name && (
              <>
                <span className="mib-pair-sep" aria-hidden="true">›</span>
                {pairInfo.exchange.iconUrl && (
                  <img className="mib-dex-icon" src={pairInfo.exchange.iconUrl} alt="" loading="lazy"
                    onError={(e) => { e.target.style.display = 'none' }} />
                )}
                <span>{pairInfo.exchange.name}</span>
              </>
            )}
          </span>
        </section>
      )}

      {/* 0b — project banner (DexScreener header art), only when the token has
          one and it loads. No overlay: these banners already carry the
          project's own logo and wordmark. */}
      {profile?.banner && bannerOk && (
        <section className="mib-banner" aria-label={`${symbol} banner`}>
          <img
            className="mib-banner-img"
            src={profile.banner}
            alt={`${token?.name || symbol} banner`}
            loading="lazy"
            onError={() => setBannerOk(false)}
          />
        </section>
      )}

      {/* 1 — links row (DexScreener-style buttons) */}
      {(webUrl || twUrl || tgUrl || shortCa) && (
        <section className="mib-linkrow" aria-label="Links">
          {webUrl && (
            <a className="mib-linkbtn" href={webUrl} target="_blank" rel="noopener noreferrer">
              <Globe size={13} /> Website
            </a>
          )}
          {twUrl && (
            <a className="mib-linkbtn" href={twUrl} target="_blank" rel="noopener noreferrer">
              <span className="mib-linkbtn-x">𝕏</span> Twitter
            </a>
          )}
          {tgUrl && (
            <a className="mib-linkbtn" href={tgUrl} target="_blank" rel="noopener noreferrer">
              <TelegramGlyph size={13} /> Telegram
            </a>
          )}
          {shortCa && (
            <button type="button" className="mib-linkbtn mib-linkbtn--ca" onClick={copyCa} aria-label="Copy contract address">
              {copied ? <Check size={13} /> : <Copy size={13} />} {shortCa}
            </button>
          )}
        </section>
      )}

      {/* 2 — price cards */}
      <section className="mib-pricecards" aria-label="Price">
        <div className="mib-card">
          <span className="mib-card-l">Price USD</span>
          <span className="mib-card-v">{fmtPrice(price)}</span>
        </div>
        {nativeSym && nativeUsd > 0 && price > 0 && (
          <div className="mib-card">
            <span className="mib-card-l">Price</span>
            <span className="mib-card-v"><NativePrice usd={price} nativeUsd={nativeUsd} nativeSym={nativeSym} /></span>
          </div>
        )}
      </section>

      {/* 3 — liquidity | FDV | mcap */}
      <section className="mib-triple" aria-label="Market metrics">
        <div className="mib-card">
          <span className="mib-card-l">Liquidity</span>
          <span className="mib-card-v">{fmtLargeUsd(liquidity)}</span>
        </div>
        <div className="mib-card">
          <span className="mib-card-l">FDV</span>
          <span className="mib-card-v">{fmtLargeUsd(fdv)}</span>
        </div>
        <div className="mib-card">
          <span className="mib-card-l">Market Cap</span>
          <span className="mib-card-v">{fmtLargeUsd(marketCap)}</span>
        </div>
      </section>

      {/* 4 — timeframe tabs with % change */}
      <section className="mib-tfstats" aria-label="Window stats">
        <div className="mib-tf" role="tablist">
          {TF_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tf === k}
              className={`mib-tf-btn${tf === k ? ' is-active' : ''}`}
              onClick={() => setTf(k)}
            >
              <span className="mib-tf-label">{TF_LABEL[k]}</span>
              <span className={`mib-tf-chg ${changeClass(changeByTf[k])}`}>
                {changeByTf[k] == null ? '—'
                  : `${changeByTf[k] >= 0 ? '+' : ''}${changeByTf[k].toFixed(2)}%`}
              </span>
            </button>
          ))}
        </div>

        {/* 5 — TXNS / VOLUME / MAKERS split bars */}
        {win ? (
          <div className="mib-stats">
            <StatSplitRow
              label="Txns"
              total={fmtCount(win.txns)}
              leftLabel="Buys" leftValue={win.buys} leftText={fmtCount(win.buys)}
              rightLabel="Sells" rightValue={win.sells} rightText={fmtCount(win.sells)}
            />
            <StatSplitRow
              label="Volume"
              total={fmtLargeUsd(win.volume)}
              leftLabel="Buy Vol" leftValue={win.buyVolume} leftText={fmtLargeUsd(win.buyVolume)}
              rightLabel="Sell Vol" rightValue={win.sellVolume} rightText={fmtLargeUsd(win.sellVolume)}
            />
            <StatSplitRow
              label="Makers"
              total={fmtCount(win.traders)}
              leftLabel="Buyers" leftValue={win.buyers} leftText={fmtCount(win.buyers)}
              rightLabel="Sellers" rightValue={win.sellers} rightText={fmtCount(win.sellers)}
            />
          </div>
        ) : statsLoading ? (
          <div className="mib-stats mib-stats--loading" aria-hidden="true">
            <div className="mib-statrow-skel animate-shimmer" />
            <div className="mib-statrow-skel animate-shimmer" />
            <div className="mib-statrow-skel animate-shimmer" />
          </div>
        ) : null}
      </section>

      {/* 6 — supply + age + ATH (compact data strip). The Age row moves into
          Pair Info ("Pair created") once the pair metadata lands. */}
      <section className="mib-meta" aria-label="Supply and age">
        {!pairInfo?.createdAt && (
          <div className="mib-meta-row">
            <span className="mib-cell-l">Age</span>
            <span className="mib-meta-v">{fmtAge(createdAt)}</span>
          </div>
        )}
        {athPrice > 0 && (
          <div className="mib-meta-row">
            <span className="mib-cell-l">All-Time High</span>
            <span className="mib-meta-v">
              {fmtPrice(athPrice)}
              {price > 0 && (
                <span className="mib-ath-chg">
                  {(((price - athPrice) / athPrice) * 100).toFixed(1)}%
                </span>
              )}
            </span>
          </div>
        )}
        {circulating > 0 && (
          <div className="mib-supply">
            <div className="mib-supply-head">
              <span className="mib-cell-l">Circ. Supply</span>
              {supplyPct != null && <span className="mib-supply-pct">{Math.round(supplyPct * 100)}%</span>}
            </div>
            {supplyPct != null && (
              <div className="mib-supply-track"><span className="mib-supply-fill" style={{ width: `${supplyPct * 100}%` }} /></div>
            )}
            <span className="mib-supply-nums">
              {fmtLarge(circulating)}{total > 0 ? ` / ${fmtLarge(total)}` : ''}
            </span>
          </div>
        )}
      </section>

      {/* 6a — Dossier: the plain-language read on what this token is. */}
      {dossierText && (
        <section className="mib-panel mib-dossier" aria-label="Dossier">
          <span className="mib-dossier-bloom" aria-hidden="true" />
          <div className="mib-panel-head">
            <h3 className="mib-panel-title mib-dossier-eyebrow">
              <svg className="mib-dossier-glyph" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 2 L13 5 L13 11 L8 14 L3 11 L3 5 Z" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <circle cx="8" cy="8" r="2" fill="currentColor" />
              </svg>
              Dossier
            </h3>
            <span className="mib-dossier-src">{dossierSrc}</span>
          </div>
          <div className={`mib-dossier-prose${dossierOpen ? ' is-open' : ''}${dossierClamped ? ' is-clamped' : ''}`}>
            <p className="mib-dossier-lead">{dossierLead}</p>
            {dossierOpen && dossierParas.map((para, i) => (
              // Index key is fine here: paragraphs are a render-only split of
              // one immutable string, never reordered or inserted into.
              // (Was an eslint-disable for react/no-array-index-key, a rule
              // from eslint-plugin-react - a plugin this repo does not install,
              // so the directive itself was an error once linting turned on.)
              <p className="mib-dossier-body" key={i}>{para}</p>
            ))}
          </div>
          {dossierLong && (
            <button
              type="button"
              className={`mib-dossier-more${dossierOpen ? ' is-open' : ''}`}
              aria-expanded={dossierOpen}
              onClick={() => setDossierOpen((v) => !v)}
            >
              {dossierOpen ? 'Show less' : 'Read more'}
              <ChevronDown className="mib-dossier-chev" size={13} strokeWidth={2.2} />
            </button>
          )}
        </section>
      )}

      {/* 6b — Pair Info (DexScreener parity: created, pooled sides, addresses) */}
      {pairInfo?.pairAddress && (
        <section className="mib-panel mib-pairinfo" aria-label="Pair info">
          <div className="mib-panel-head">
            <h3 className="mib-panel-title">Pair Info</h3>
          </div>
          {pairInfo.createdAt > 0 && (
            <div className="mib-meta-row">
              <span className="mib-cell-l">Pair created</span>
              <span className="mib-meta-v">{fmtAge(pairInfo.createdAt)} ago</span>
            </div>
          )}
          {pairInfo.pooledToken > 0 && (
            <div className="mib-meta-row">
              <span className="mib-cell-l">Pooled {symbol}</span>
              <span className="mib-meta-v">
                {fmtLarge(pairInfo.pooledToken)}
                {pooledTokenUsd > 0 && <span className="mib-pooled-usd">{fmtLargeUsd(pooledTokenUsd)}</span>}
              </span>
            </div>
          )}
          {pairInfo.pooledQuote > 0 && quoteSym && (
            <div className="mib-meta-row">
              <span className="mib-cell-l">Pooled {quoteSym}</span>
              <span className="mib-meta-v">
                {fmtLarge(pairInfo.pooledQuote)}
                {pooledQuoteUsd > 0 && <span className="mib-pooled-usd">{fmtLargeUsd(pooledQuoteUsd)}</span>}
              </span>
            </div>
          )}
          <div className="mib-meta-row">
            <span className="mib-cell-l">Pair</span>
            <span className="mib-addr-cell">
              <button type="button" className="mib-addr-btn" onClick={() => copyText('pair', pairInfo.pairAddress, 'Pair address copied')}>
                <span className="mib-addr-text">{shortAddr(pairInfo.pairAddress)}</span>
                {copiedKey === 'pair' ? <Check size={12} /> : <Copy size={12} />}
              </button>
              {addrExplorerUrl(pairInfo.pairAddress) && (
                <a className="mib-exp-link" href={addrExplorerUrl(pairInfo.pairAddress)} target="_blank" rel="noopener noreferrer">EXP</a>
              )}
            </span>
          </div>
          {address && (
            <div className="mib-meta-row">
              <span className="mib-cell-l">{symbol}</span>
              <span className="mib-addr-cell">
                <button type="button" className="mib-addr-btn" onClick={() => copyText('tokaddr', address, 'Contract copied')}>
                  <span className="mib-addr-text">{shortAddr(address)}</span>
                  {copiedKey === 'tokaddr' ? <Check size={12} /> : <Copy size={12} />}
                </button>
                {tokenExplorerUrl(address) && (
                  <a className="mib-exp-link" href={tokenExplorerUrl(address)} target="_blank" rel="noopener noreferrer">EXP</a>
                )}
              </span>
            </div>
          )}
        </section>
      )}

      {/* 7 — safety */}
      {address && (
        <section className="mib-panel mib-safety" aria-label="Safety">
          <div className="mib-panel-head">
            <h3 className="mib-panel-title">Safety</h3>
            {(() => {
              const t = tax
              if (!t) return <span className="mib-verdict neutral">{t === undefined ? 'Loading…' : 'No data'}</span>
              const issues = []
              if (t.isHoneypot || t.cannotSellAll) issues.push(1)
              if (t.buyTax != null && t.buyTax > 10) issues.push(1)
              if (t.sellTax != null && t.sellTax > 10) issues.push(1)
              if (t.mintable) issues.push(1)
              if (t.canFreeze) issues.push(1)
              if (t.hiddenOwner) issues.push(1)
              if (issues.length) return <span className="mib-verdict bad">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</span>
              if (t.isHoneypot != null) return <span className="mib-verdict good">All checks passed</span>
              return <span className="mib-verdict neutral">No data</span>
            })()}
          </div>

          {/* Uniform tiles: label above value, so a long label ("LP burned")
              wraps inside its own tile instead of shoving the value onto a
              second line and breaking the row grid. Pass/fail reads off the
              corner dot - only a genuine risk turns the number red, so the
              panel is no longer a wall of green. */}
          <div className="mib-safety-grid">
            {(() => {
              const t = tax
              const honeypot = t == null ? null : !!(t.isHoneypot || t.cannotSellAll)
              const lpBurned = t?.lpBurnedPercent
              const lpLocked = t?.lpLockedPercent
              const lpSecured = lpBurned == null && lpLocked == null ? null : (lpBurned || 0) + (lpLocked || 0)
              const burnWins = (lpBurned || 0) >= (lpLocked || 0)
              const pct = (v) => (v >= 99.95 ? '100%' : `${v.toFixed(1)}%`)
              const top10 = t?.top10Percent
              const taxState = (v) => (v == null ? null : v > 10 ? 'bad' : 'good')
              const tiles = [
                { l: 'Honeypot', v: honeypot == null ? null : honeypot ? 'Yes' : 'No',
                  s: honeypot == null ? null : honeypot ? 'bad' : 'good' },
                { l: isSolana ? 'Transfer fee' : 'Buy tax',
                  v: t?.buyTax != null ? pct(t.buyTax) : null, s: taxState(t?.buyTax) },
                ...(isSolana ? [] : [{ l: 'Sell tax',
                  v: t?.sellTax != null ? pct(t.sellTax) : null, s: taxState(t?.sellTax) }]),
                { l: 'Mint authority', v: t?.mintable == null ? null : t.mintable ? 'Active' : 'Revoked',
                  s: t?.mintable == null ? null : t.mintable ? 'bad' : 'good' },
                { l: 'Freeze authority', v: t?.canFreeze == null ? null : t.canFreeze ? 'Active' : 'Revoked',
                  s: t?.canFreeze == null ? null : t.canFreeze ? 'bad' : 'good' },
                { l: lpSecured == null || lpSecured < 0.5 ? 'LP secured' : burnWins ? 'LP burned' : 'LP locked',
                  v: lpSecured == null ? null : lpSecured < 0.5 ? '0%' : pct(burnWins ? lpBurned : lpLocked),
                  s: lpSecured == null ? null : lpSecured >= 80 ? 'good' : 'bad' },
                { l: 'Top 10 holders', v: top10 != null ? pct(top10) : null,
                  s: top10 == null ? null : top10 > 50 ? 'bad' : top10 <= 30 ? 'good' : null },
                { l: 'Holders', v: holderCount > 0 ? fmtLarge(holderCount) : null, s: null },
              ]
              return tiles.map((tile) => (
                <div className={`mib-stile${tile.s ? ` is-${tile.s}` : ''}`} key={tile.l}>
                  <span className="mib-stile-l">{tile.l}</span>
                  <span className="mib-stile-v">{tile.v ?? '—'}</span>
                </div>
              ))
            })()}
          </div>

          {Array.isArray(tax?.lpLockers) && tax.lpLockers.length > 0 && (
            <div className="mib-lockers">
              <span className="mib-lockers-l">Locked with</span>
              {tax.lpLockers.map((l, i) => {
                const tag = String(l.tag || '')
                const nm = /team\s*finance/i.test(tag) ? 'Team Finance'
                  : /unicrypt|uncx/i.test(tag) ? 'UNCX'
                  : /pink/i.test(tag) ? 'PinkLock'
                  : tag || 'Locker'
                return (
                  <span key={i} className="mib-locker-chip">
                    {nm} <span className="mib-locker-pct">{l.percent >= 99.95 ? '100' : Number(l.percent).toFixed(1)}%</span>
                  </span>
                )
              })}
            </div>
          )}

          {/* The count itself is a tile above; this is only the 14-day shape. */}
          {holderSeries ? (
            <div className="mib-holders">
              <div className="mib-holders-head">
                <span className="mib-cell-l">Holder trend · 14d</span>
                {holderDeltaPct != null && (
                  <span className={`mib-holders-delta ${holderDeltaPct >= 0 ? 'up' : 'down'}`}>
                    {holderDeltaPct >= 0 ? '+' : ''}{holderDeltaPct.toFixed(1)}%</span>
                )}
              </div>
              <div className="mib-holders-spark">
                <Sparkline data={holderSeries} width={280} height={26}
                  stroke={holderSeries[holderSeries.length - 1] >= holderSeries[0] ? 'var(--up)' : 'var(--down)'}
                  fill="gradient" strokeWidth={1.3} />
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* 7b — project card: logo, name, every known link. No prose here - the
          Dossier section above is the one place the token gets described. */}
      {profileLinks.length > 0 && (
        <section className="mib-project" aria-label="Project">
          {(profile?.logo || token?.logo) && (
            <img className="mib-project-logo" src={profile?.logo || token.logo} alt="" loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none' }} />
          )}
          <h3 className="mib-project-name">{token?.name || symbol}</h3>

          {profileLinks.length > 0 && (
            <div className="mib-project-links">
              {profileLinks.map((l) => (
                <a key={l.url} className="mib-project-link" href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.kind === 'twitter'
                    ? <span className="mib-linkbtn-x">𝕏</span>
                    : l.kind === 'telegram'
                      ? <TelegramGlyph size={13} />
                      : <Globe size={13} />}
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 7c — converter: how much is N tokens worth (or the other way round).
          Only mounts once there is a real rate to convert with. */}
      {convRate > 0 && (
        <section className="mib-conv" aria-label="Converter">
          <div className="mib-conv-field">
            <input
              className="mib-conv-input"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              aria-label={flipped ? `Amount in ${convUnitLabel}` : `Amount in ${symbol}`}
            />
            <span className="mib-conv-unit">{flipped ? convUnitLabel : symbol}</span>
          </div>

          <button
            type="button"
            className="mib-conv-flip"
            onClick={() => { setAmount(convOut || '1'); setFlipped((v) => !v) }}
            aria-label="Swap direction"
          >
            ⇅
          </button>

          <div className="mib-conv-field">
            <input className="mib-conv-input" type="text" value={convOut} readOnly
              aria-label={flipped ? `Amount in ${symbol}` : `Amount in ${convUnitLabel}`} />
            {flipped ? (
              <span className="mib-conv-unit">{symbol}</span>
            ) : (
              <span className="mib-conv-units">
                <button type="button"
                  className={`mib-conv-unitbtn${convUnit === 'usd' ? ' is-active' : ''}`}
                  onClick={() => setConvUnit('usd')}>USD</button>
                {quoteSym && quoteUsd > 0 && (
                  <button type="button"
                    className={`mib-conv-unitbtn${convUnit === 'quote' ? ' is-active' : ''}`}
                    onClick={() => setConvUnit('quote')}>{quoteSym}</button>
                )}
              </span>
            )}
          </div>
        </section>
      )}

      {/* 8 — docked Trade CTA. Hidden when embedded as a page view (the
          persistent Buy/Sell bar already owns the trade action there). */}
      {!embedded && (
        <div className="mib-dock">
          <button type="button" className="mib-trade-btn" onClick={onTrade}>
            Trade {symbol}
          </button>
        </div>
      )}
    </div>
  )
}
