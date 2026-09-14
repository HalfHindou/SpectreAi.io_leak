import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import SpectreSparkline from '@/chart/SpectreSparkline'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { useZIGChainData } from './hooks/useZIGChainData'
import useZIGTvlHistory, { DEFAULT_EXTRAS } from './hooks/useZIGTvlHistory'
import ZigTvlChart from './components/ZigTvlChart'
import ZigPriceChart from './components/ZigPriceChart'
import ZigEpisodes from './components/ZigEpisodes'
import ZigFounderTweets from './components/ZigFounderTweets'
import { useZigComparison } from './hooks/useZigComparison'
import { useZigAnnouncements, fmtRelTime, fmtCompact } from './hooks/useZigAnnouncements'
import ZigAnnouncements from './components/ZigAnnouncements'
import ZigSocialIntel from './components/ZigSocialIntel'
import {
  ZIGCHAIN_STATIC, ZIG_LOGO_LG, ZIG_LOGO, ZIG_WORDMARK,
  ZIG_SOCIALS, ZIG_YOUTUBE, PARTNER_LOGOS, PROTOCOL_LOGOS,
} from './zigchain.constants'
import { getProjectOverrides } from '@/constants/projectOverrides'
import { FounderSpotlightSection } from '../research-zone/components/rz-project-cinema'
import '../research-zone/components/rz-project-cinema.css'
import './ZIGChainHub.css'
import './ZIGChainHub.mobile.css'

const fmtPct = v => v == null ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

function useInView(t=0.08){const r=useRef(null);const[v,s]=useState(false);useEffect(()=>{const e=r.current;if(!e)return;const o=new IntersectionObserver(([x])=>{if(x.isIntersecting)s(true)},{threshold:t});o.observe(e);return()=>o.disconnect()},[t]);return[r,v]}
function useCountUp(target,dur=1200,active=true){const[v,s]=useState(0);const r=useRef(null);useEffect(()=>{if(!active||target==null)return;const st=performance.now();const tick=now=>{const t=Math.min((now-st)/dur,1);s(target*(1-Math.pow(1-t,3)));if(t<1)r.current=requestAnimationFrame(tick)};r.current=requestAnimationFrame(tick);return()=>cancelAnimationFrame(r.current)},[target,dur,active]);return v}

function Reveal({ children, className = '', as: Tag = 'section' }) {
  const [ref, vis] = useInView()
  return <Tag ref={ref} className={`zr ${vis ? 'zr-v' : ''} ${className}`}>{children}</Tag>
}

function BreakingNewsBanner({ compact = false, live = null }) {
  const { t } = useTranslation()
  // Prefer the latest live @ZIGChain announcement; fall back to the curated
  // breaking card so the hero is always populated (and strong) even when the
  // live feed is unavailable.
  const useLive = !!(live && live.headline)
  const news = useLive
    ? {
        eyebrow: fmtRelTime(live.createdAt) || t('zigchainChrome.breaking.latest', 'Latest'),
        headline: live.headline,
        summary: live.text && live.text.length > 220 ? `${live.text.slice(0, 218)}…` : (live.text || ''),
        metrics: [
          { label: t('zigchainChrome.breaking.reposts', 'Reposts'), value: fmtCompact(live.retweets) },
          { label: t('zigchainChrome.breaking.likes', 'Likes'), value: fmtCompact(live.likes) },
          { label: t('zigchainChrome.breaking.views', 'Views'), value: fmtCompact(live.views) },
        ].filter((m) => m.value),
        sourceUrl: live.url,
      }
    : ZIGCHAIN_STATIC.breakingNews
  if (!news) return null
  // Only label a live post "BREAKING" when it's a genuine announcement AND
  // recent (<5 days). Older/plain posts render tagged "LATEST", and the curated
  // fallback renders "FEATURED" — so a month-old card can never masquerade as
  // breaking news (the reported "breaking Ondo news is old news" bug).
  const liveTs = live?._ts || (live?.createdAt ? Date.parse(live.createdAt) : 0)
  const liveFresh = liveTs ? (Date.now() - liveTs) < 5 * 86_400_000 : false
  const isBreaking = useLive && !!live.isAnnouncement && liveFresh
  const tagLabel = isBreaking
    ? t('zigchainChrome.breaking.label', 'BREAKING')
    : useLive
      ? t('zigchainChrome.breaking.latest', 'LATEST')
      : t('zigchainChrome.breaking.featured', 'FEATURED')
  // Partner chip only when the LIVE post actually names a partner — never a
  // hardcoded default (was pinned to 'Ondo Finance').
  const partnerName = useLive ? live.partner : null
  const partnerLogo = partnerName ? PARTNER_LOGOS[partnerName] : null
  return (
    <a
      className={`z-breaking${compact ? ' z-breaking--compact' : ''}`}
      href={news.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="z-breaking-aurora" aria-hidden />
      <div className="z-breaking-marks" aria-hidden>
        <span className="z-breaking-chip z-breaking-chip--zig">
          <img src={ZIG_LOGO} alt="ZIGChain" className="z-breaking-chip-img" loading="lazy" />
        </span>
        {partnerLogo && (
          <>
            <svg className="z-breaking-cross" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            <span className="z-breaking-chip z-breaking-chip--ondo">
              <img src={partnerLogo} alt={partnerName} className="z-breaking-chip-img" loading="lazy" />
            </span>
          </>
        )}
      </div>
      <div className="z-breaking-main">
        <div className="z-breaking-top">
          <span className={`z-breaking-tag${isBreaking ? '' : ' z-breaking-tag--latest'}`}>
            <span className="z-breaking-dot" />
            {tagLabel}
          </span>
          <span className="z-breaking-date">{news.eyebrow}</span>
        </div>
        <h2 className="z-breaking-headline">{news.headline}</h2>
        <p className="z-breaking-summary">{news.summary}</p>
        {news.metrics?.length > 0 && (
          <div className="z-breaking-metrics">
            {news.metrics.map(m => (
              <div key={m.label} className="z-breaking-metric">
                <span className="z-breaking-metric-v">{m.value}</span>
                <span className="z-breaking-metric-l">{m.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="z-breaking-cta">
        <span>{t('zigchainChrome.breaking.cta', 'Read on X')}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>
      </div>
    </a>
  )
}

function Ava({ src, name, size = 36 }) {
  const [fail, setFail] = useState(false)
  const c = { A:'#3B82F6',Z:'#FBBF24',S:'#8B5CF6',B:'#10B981',T:'#EC4899',O:'#F97316',P:'#06B6D4',N:'#6366F1',V:'#22D3EE',D:'#F43F5E',E:'#14B8A6' }
  const l = (name||'?')[0]
  if (src && !fail) return (
    <img
      src={src}
      alt=""
      className="z-ava"
      style={{ width: size, height: size, background: '#0d1620', objectFit: 'contain', padding: 4 }}
      onError={() => setFail(true)}
    />
  )
  return <div className="z-ava z-ava-init" style={{width:size,height:size,background:`${c[l]||'#6B7280'}15`,color:c[l]||'#6B7280',fontSize:size*.38}}>{l}</div>
}

function CountUp({ value, prefix='', className='' }) {
  const { i18n } = useTranslation()
  const [ref, inView] = useInView(0.15)
  const n = useCountUp(value, 1200, inView)
  if (value == null) return null
  const s = n>=1e12?`${(n/1e12).toFixed(1)}T`:n>=1e9?`${(n/1e9).toFixed(1)}B`:n>=1e6?`${(n/1e6).toFixed(0)}M`:new Intl.NumberFormat(i18n.language).format(Math.round(n))
  return <span ref={ref} className={`z-count ${className}`}>{prefix}{s}</span>
}

/* Sparkline - uses SpectreSparkline with amber brand color */
function Spark({ data, h = 120 }) {
  if (!data?.length) return null
  return (
    <div className="z-spark-wrap">
      <SpectreSparkline data={data} width={320} height={h} color="#FBBf24" filled strokeWidth={1.5} />
    </div>
  )
}

/* ═══ PROTOCOL DETAIL PANEL ═══ */
function ProtocolPanel({ protocol, onClose }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmt = v => (v == null ? '...' : fmtLargeShort(v))
  const [open, setOpen] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setOpen(true)) }, [])
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc)
  }, [])
  const handleClose = () => { setOpen(false); setTimeout(onClose, 300) }
  if (!protocol) return null
  const logo = PROTOCOL_LOGOS[protocol.name]
  // Portal to body: the page lives inside .page-layout which has transform +
  // will-change (desktop), making it the containing block for position:fixed.
  // Rendering here keeps the drawer fixed to the viewport, not the scroll area.
  return createPortal(
    <>
      <div className={`z-panel-backdrop ${open ? 'open' : ''}`} onClick={handleClose} />
      <div className={`z-panel ${open ? 'open' : ''}`}>
        <div className="z-panel-header">
          <div className="z-panel-id">
            <Ava src={logo} name={protocol.name} size={40} />
            <div><span className="z-panel-name">{protocol.name}</span><span className="z-panel-cat">{protocol.category}</span></div>
          </div>
          <button className="z-panel-close" onClick={handleClose}>✕</button>
        </div>
        <div className="z-panel-body">
          <div className="z-panel-section">
            <h3 className="z-panel-sh">{t('zigchainChrome.panel.about', 'About')}</h3>
            <p className="z-panel-text">{protocol.desc}</p>
          </div>
          {protocol.metrics && (
            <div className="z-panel-section">
              <h3 className="z-panel-sh">{t('zigchainChrome.panel.keyMetrics', 'Key Metrics')}</h3>
              <p className="z-panel-mono">{protocol.metrics}</p>
            </div>
          )}
          {(protocol.tvl || protocol.tvlEstimate) && (
            <div className="z-panel-section">
              <h3 className="z-panel-sh">{t('zigchainChrome.panel.tvl', 'Total Value Locked')}</h3>
              <span className="z-panel-big">{fmt(protocol.tvl || protocol.tvlEstimate)}</span>
            </div>
          )}
          <div className="z-panel-section">
            <h3 className="z-panel-sh">{t('zigchainChrome.panel.chain', 'Chain')}</h3>
            <p className="z-panel-text">{t('zigchainChrome.panel.chainDesc', 'Deployed on ZIGChain (Cosmos SDK · EVM compatible)')}</p>
          </div>
          <a href={protocol.url} target="_blank" rel="noopener noreferrer" className="z-panel-cta">
            {t('zigchainChrome.panel.visit', 'Visit {{name}}', { name: protocol.name })}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
          </a>
        </div>
      </div>
    </>,
    document.body
  )
}

export default function ZIGChainHub({ dayMode = false } = {}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { fmtPrice: fmtPriceCurrency, fmtLargeShort } = useCurrency()
  const fmt = v => (v == null ? '...' : fmtLargeShort(v))
  const fmtPrice = v => (v == null ? '...' : fmtPriceCurrency(v))
  const { price, marketData, sparkline, loading } = useZIGChainData()
  const [tvlExtras, setTvlExtras] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_EXTRAS
    try {
      const stored = window.localStorage?.getItem('zigchain-tvl-extras')
      if (!stored) return DEFAULT_EXTRAS
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_EXTRAS, ...parsed }
    } catch (_) { return DEFAULT_EXTRAS }
  })
  const updateTvlExtras = useCallback((next) => {
    setTvlExtras(next)
    try { window.localStorage?.setItem('zigchain-tvl-extras', JSON.stringify(next)) } catch (_) {}
  }, [])
  const { stats: tvlStats } = useZIGTvlHistory('7D', { extras: tvlExtras })
  const tvlCurrent = tvlStats?.current ?? null
  const tvlChange7d = tvlStats?.change ?? null
  // IntersectionObserver gate for the comparison table fetch. The table
  // lives well below the fold on both mobile (~line 491) and desktop
  // (~line 1014). Without the gate, /zigchain fires 7 parallel network
  // calls (1 batched CoinGecko + 6 DefiLlama passthroughs) for content
  // the user can't see yet. comparisonRef is attached to a wrapper that
  // always sits just above the visible comparison section so the gate
  // flips a screen or so before scroll arrives.
  const [comparisonRef, comparisonVisible] = useInView(0.01)
  const { rows: liveComparison, loading: liveCompLoading } = useZigComparison({
    enabled: comparisonVisible,
  })
  // Live announcements from the official @ZIGChain X account. Powers the
  // above-the-fold breaking banner + the Partners & Announcements section, so
  // new partnerships surface automatically without editing constants.
  const { announcements: zigAnnouncements, breaking: liveBreaking, loading: annLoading } = useZigAnnouncements()
  const [ytPlaying, setYtPlaying] = useState(null)
  const [selectedProto, setSelectedProto] = useState(null)
  const bull = (price?.change24h ?? 0) >= 0
  const D = ZIGCHAIN_STATIC

  const sortedPartners = useMemo(() =>
    [...D.partnerships].sort((a, b) => (b.statRaw || 0) - (a.statRaw || 0))
  , [D.partnerships])

  // Prefer live data when available, fall back to the static comparison.
  const comparisonRows = liveComparison?.length ? liveComparison : D.comparison

  /* ═══════════════════════════════════════════════════════════
     MOBILE — dedicated cinematic layout (identity → price →
     action → data rows). Reuses the same already-fetched data;
     never refetches. Desktop tree below is NOT rendered on mobile.
     ═══════════════════════════════════════════════════════════ */
  if (isMobile) {
    const bullTvl = (tvlChange7d ?? 0) >= 0
    const dayClass = dayMode ? ' zgm--day' : ''
    const periodCells = [
      { l: '24H', v: price?.change24h },
      { l: '7D', v: marketData?.change7d },
      { l: '30D', v: marketData?.change30d },
      { l: t('zigchainChrome.period.ath', 'ATH'), v: marketData?.athChangePercent },
    ]
    const heroPills = [
      { tone: 'blue', label: t('zigchainChrome.pill.layer1', 'Layer 1') },
      { label: t('zigchainChrome.pill.evmCompatible', 'EVM-Compatible') },
      { label: 'Tendermint PoS' },
      { label: t('zigchainChrome.pill.shariahCertified', 'Shariah Certified') },
      { label: 'FSCA · DIFC' },
      { label: t('zigchainChrome.pill.ibcBridge', 'IBC Bridge') },
    ]
    return (
      <div className={`zgm${dayClass}`}>
        {/* ── IDENTITY HERO ── */}
        <header className="zgm-hero">
          <div className="zgm-hero-top">
            <div className="zgm-hero-mark">
              <img src={ZIG_LOGO_LG} alt="ZIGChain" className="zgm-hero-logo" />
            </div>
            <div className="zgm-hero-id">
              <h1 className="zgm-hero-name">
                ZIGChain
                <span className="zgm-hero-live"><span className="zgm-live-dot" /> {t('zigchainChrome.live', 'LIVE')}</span>
              </h1>
              <div className="zgm-hero-eyebrow">
                <span>{t('zigchainChrome.eyebrow.cosmosL1', 'Cosmos L1')}</span>
                <span className="zgm-eyebrow-dot" />
                <span>{t('zigchainChrome.eyebrow.rwa', 'RWA')}</span>
                <span className="zgm-eyebrow-dot" />
                <span>{t('zigchainChrome.eyebrow.mainnetOct2025', 'Mainnet · Oct 2025')}</span>
              </div>
            </div>
          </div>
          <p className="zgm-hero-tagline">
            {t('zigchainChrome.tagline', 'Cosmos Layer 1 purpose-built for real-world asset tokenization. First Shariah-certified blockchain · $3B+ institutional pipeline.')}
          </p>
          <div className="zgm-pill-strip">
            {heroPills.map((p) => (
              <span key={p.label} className={`zgm-pill${p.tone ? ' is-primary' : ''}`}>{p.label}</span>
            ))}
          </div>
        </header>

        {/* ── TVL CHART ── directly under the banner (founder, 08-17): the
            chain identity, then its headline number moving, then everything
            else. Same placement as desktop, where the chart block sits right
            below the branded hero. */}
        <section className="zgm-section-flush">
          <ZigTvlChart extras={tvlExtras} onExtrasChange={updateTvlExtras} />
        </section>

        {/* ── KEY STATS ── */}
        <section className="zgm-section">
          <div className="zgm-stat-grid">
            <div className="zgm-stat">
              <span className="zgm-stat-l">{t('zigchainChrome.stat.tvl', 'Total Value Locked')}</span>
              <span className="zgm-stat-v">{fmt(tvlCurrent)}</span>
              {tvlChange7d != null && (
                <span className={`zgm-chg ${bullTvl ? 'up' : 'dn'}`}>{fmtPct(tvlChange7d)}</span>
              )}
            </div>
            <div className="zgm-stat">
              <span className="zgm-stat-l">{t('zigchainChrome.stat.marketCap', 'Market Cap')}</span>
              <span className="zgm-stat-v">{price?.marketCap != null ? fmt(price.marketCap) : '$39.8M'}</span>
            </div>
            <div className="zgm-stat">
              <span className="zgm-stat-l">{t('zigchainChrome.stat.institutionalPipeline', 'Institutional Pipeline')}</span>
              <span className="zgm-stat-v">$3B+</span>
            </div>
            <div className="zgm-stat">
              <span className="zgm-stat-l">{t('zigchainChrome.stat.rank', 'Rank')}</span>
              <span className="zgm-stat-v">{marketData?.marketCapRank ? `#${marketData.marketCapRank}` : '—'}</span>
            </div>
          </div>
        </section>

        {/* ── BREAKING NEWS ── */}
        <section className="zgm-section">
          <BreakingNewsBanner compact live={liveBreaking} />
        </section>

        {/* ── SOCIAL INTELLIGENCE ── */}
        <section className="zgm-section">
          <ZigSocialIntel />
        </section>

        {/* ── PARTNERS & ANNOUNCEMENTS ── */}
        <section className="zgm-section">
          <ZigAnnouncements
            partners={sortedPartners}
            announcements={zigAnnouncements}
            loading={annLoading}
            fallback={D.intelligenceFeed}
          />
        </section>

        {/* ── PRICE HERO ── */}
        <section className="zgm-section">
          <div className="zgm-pricehero">
            <div className="zgm-pricehero-top">
              <span className="zgm-pricehero-l">ZIG / USD</span>
              <div className="zgm-pricehero-row">
                <span className="zgm-pricehero-v">{loading ? '—' : fmtPrice(price?.usd)}</span>
                {price?.change24h != null && (
                  <span className={`zgm-chg ${bull ? 'up' : 'dn'}`}>{fmtPct(price.change24h)}</span>
                )}
              </div>
            </div>
            {sparkline?.length > 10 && (
              <div className="zgm-pricehero-spark">
                <SpectreSparkline data={sparkline} width={340} height={56} color={bull ? '#10B981' : '#EF4444'} filled strokeWidth={1.5} />
              </div>
            )}
            {marketData && (marketData.low24h != null || marketData.high24h != null) && (
              <div className="zgm-pricehero-foot">
                <span><span className="zgm-foot-l">{t('zigchainChrome.stat.low24h', '24h Low')}</span> {fmtPrice(marketData.low24h)}</span>
                <span><span className="zgm-foot-l">{t('zigchainChrome.stat.high24h', '24h High')}</span> {fmtPrice(marketData.high24h)}</span>
              </div>
            )}
            <div className="zgm-perf">
              {periodCells.map((p) => {
                const has = Number.isFinite(p.v)
                const up = has && p.v >= 0
                return (
                  <div key={p.l} className={`zgm-perf-cell ${has ? (up ? 'up' : 'dn') : 'is-empty'}`}>
                    <span className="zgm-perf-l">{p.l}</span>
                    <span className="zgm-perf-v">{has ? fmtPct(p.v) : '—'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── ACTION ROW ── */}
        <section className="zgm-section">
          <div className="zgm-actions">
            <button type="button" className="zgm-act zgm-act-watch" aria-label={t('zigchainChrome.aria.saveToWatchlist', 'Save to watchlist')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12h14"/></svg>
              <span>{t('zigchainChrome.action.watchlist', 'Watchlist')}</span>
            </button>
            <a href={D.chain.docs} target="_blank" rel="noopener noreferrer" className="zgm-act zgm-act-docs">
              <span>{t('zigchainChrome.action.docs', 'Docs')}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
            </a>
          </div>
        </section>

        {/* TVL chart now leads the page — see the top of this branch. */}

        {/* ── PRICE CHART ── */}
        <section className="zgm-section-flush">
          <ZigPriceChart />
        </section>

        {/* ── THESIS — horizontal scroll cards ── */}
        <section className="zgm-section">
          <h2 className="zgm-h">{t('zigchainChrome.section.whyZigchain', 'Why ZIGChain')}</h2>
          <div className="zgm-thesis-strip">
            {[
              { tag: 'Apex Group', num: '$3.4T', label: t('zigchainChrome.thesis.aua', 'Assets under administration') },
              { tag: t('zigchainChrome.thesis.crossChainUsdc', 'Cross-chain USDC'), num: '$78B+', label: t('zigchainChrome.thesis.stableLiq', 'Stable liquidity reachable') },
              { tag: 'ZIGLabs Fund', num: '$100M', label: t('zigchainChrome.thesis.ecoFundThru2026', 'Ecosystem fund · thru 2026') },
              { tag: t('zigchainChrome.thesis.rwa2033', 'RWA · 2033'), num: '$18T', label: t('zigchainChrome.thesis.rwaProj', 'Tokenized RWA projection') },
              { tag: 'Zignaly Network', num: '600K+', label: t('zigchainChrome.thesis.usersManagers', 'Users · 150+ managers') },
            ].map((c) => (
              <article key={c.tag} className="zgm-thesis-card">
                <span className="zgm-thesis-tag">{c.tag}</span>
                <span className="zgm-thesis-num">{c.num}</span>
                <span className="zgm-thesis-label">{c.label}</span>
              </article>
            ))}
          </div>
        </section>

        {/* ── ECOSYSTEM PROTOCOLS — token-list rows ── */}
        <section className="zgm-section">
          <div className="zgm-section-head">
            <h2 className="zgm-h">{t('zigchainChrome.section.ecosystem', 'Ecosystem')}</h2>
            <span className="zgm-aside">{t('zigchainChrome.aside.usersManagers', '{{users}} users · {{managers}} managers', { users: D.ecosystem.users, managers: D.ecosystem.portfolioManagers })}</span>
          </div>
          <div className="zgm-list">
            {D.protocols.map((p) => {
              const tvl = p.tvl || p.tvlEstimate
              return (
                <button key={p.name} type="button" className="zgm-row" onClick={() => setSelectedProto(p)}>
                  <Ava src={PROTOCOL_LOGOS[p.name]} name={p.name} size={40} />
                  <div className="zgm-row-id">
                    <span className="zgm-row-name">{p.name}</span>
                    <span className="zgm-row-sub">{p.category}</span>
                  </div>
                  {tvl && <span className="zgm-row-stat">{fmt(tvl)}</span>}
                </button>
              )
            })}
          </div>
        </section>

        {/* ── INSTITUTIONAL ARCHITECTURE — partner rows ── */}
        <section className="zgm-section">
          <div className="zgm-section-head">
            <h2 className="zgm-h">{t('zigchainChrome.section.institutionalArchitecture', 'Institutional Architecture')}</h2>
            <span className="zgm-aside">{t('zigchainChrome.aside.capitalStack', 'Capital stack')}</span>
          </div>
          <div className="zgm-list">
            {sortedPartners.map((p) => (
              <div key={p.name} className="zgm-row zgm-row--static">
                <Ava src={PARTNER_LOGOS[p.name]} name={p.name} size={40} />
                <div className="zgm-row-id">
                  <span className="zgm-row-name">{p.name}</span>
                  <span className="zgm-row-sub">{p.role}</span>
                </div>
                <div className="zgm-row-stat-col">
                  <span className="zgm-row-stat">{p.stat}</span>
                  <span className="zgm-row-meta">{p.status} · {p.date}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── TEAM — stacked list ── */}
        <section className="zgm-section">
          <div className="zgm-section-head">
            <h2 className="zgm-h">{t('zigchainChrome.section.team', 'Team')}</h2>
            <span className="zgm-aside">{t('zigchainChrome.aside.members', '{{count}} members', { count: D.team.length })}</span>
          </div>
          <div className="zgm-list">
            {D.team.map((m) => (
              <div key={m.name} className="zgm-row zgm-row--static">
                <Ava src={m.avatar || (m.twitter ? `https://unavatar.io/twitter/${m.twitter}` : null)} name={m.name} size={44} />
                <div className="zgm-row-id">
                  <span className="zgm-row-name">{m.name}</span>
                  <span className="zgm-row-sub">{m.role}</span>
                  {m.twitter && (
                    <a href={`https://x.com/${m.twitter}`} target="_blank" rel="noopener noreferrer" className="zgm-row-link">@{m.twitter}</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FOUNDER SPOTLIGHT ── */}
        <section className="zgm-section-flush">
          <FounderSpotlightSection
            spotlight={getProjectOverrides('ZIG')?.founderSpotlight}
            standalone
            wordmark={ZIG_WORDMARK}
          />
        </section>

        {/* ── RWA + FUNDING ── */}
        <section className="zgm-section">
          <div className="zgm-rwa-hero">
            <span className="zgm-rwa-big">$18T</span>
            <span className="zgm-rwa-sub">{t('zigchainChrome.rwa.projection2033', 'Projected RWA Market · 2033')}</span>
          </div>
          <div className="zgm-list">
            {D.assetClasses.map((ac) => (
              <div key={ac.name} className="zgm-asset-row">
                <div className="zgm-row-id">
                  <span className="zgm-row-name">{ac.name}</span>
                  <span className="zgm-row-sub">{ac.desc}</span>
                </div>
                <span className="zgm-row-meta">{t('zigchainChrome.via', 'via {{name}}', { name: ac.via })}</span>
              </div>
            ))}
          </div>
          <div className="zgm-section-head zgm-section-head--mt">
            <h2 className="zgm-h">{t('zigchainChrome.section.funding', 'Funding')}</h2>
            <span className="zgm-aside">{t('zigchainChrome.aside.raised', '{{amount}} raised', { amount: D.funding.total })}</span>
          </div>
          <div className="zgm-fund-grid">
            <div className="zgm-stat">
              <span className="zgm-stat-l">{t('zigchainChrome.stat.ecosystemFund', 'Ecosystem Fund')}</span>
              <span className="zgm-stat-v">{D.funding.ecosystemFund}</span>
            </div>
            <div className="zgm-stat">
              <span className="zgm-stat-l">{t('zigchainChrome.stat.defaiFund', 'DeFAI Fund')}</span>
              <span className="zgm-stat-v">{D.funding.defiAIFund}</span>
            </div>
          </div>
          <div className="zgm-chip-wrap">
            {D.funding.investors.map((inv) => <span key={inv} className="zgm-chip">{inv}</span>)}
          </div>
        </section>

        {/* ── FOUNDER TWEETS (self-contained) ── */}
        <section className="zgm-section-flush">
          <ZigFounderTweets />
        </section>

        {/* ── EPISODES (self-contained) ── */}
        <section className="zgm-section-flush">
          <ZigEpisodes />
        </section>

        {/* ── YOUTUBE — single-column stack ── */}
        <section className="zgm-section">
          <div className="zgm-section-head">
            <h2 className="zgm-h">{t('zigchainChrome.section.youtubeHighlights', 'YouTube Highlights')}</h2>
            <a href={ZIG_YOUTUBE.channel} target="_blank" rel="noopener noreferrer" className="zgm-aside zgm-aside--link">{t('zigchainChrome.action.viewChannel', 'View Channel ↗')}</a>
          </div>
          <div className="zgm-yt-list">
            {ZIG_YOUTUBE.videos.slice(0, 4).map((v) => (
              <div key={v.id} className="zgm-yt" onClick={() => setYtPlaying(ytPlaying === v.id ? null : v.id)}>
                {ytPlaying === v.id ? (
                  <iframe src={`https://www.youtube.com/embed/${v.id}?autoplay=1&rel=0`} title={v.title} className="zgm-yt-frame" allow="autoplay;encrypted-media" allowFullScreen />
                ) : (
                  <div className="zgm-yt-thumb">
                    <img src={`https://img.youtube.com/vi/${v.id}/mqdefault.jpg`} alt={v.title} className="zgm-yt-img" loading="lazy" />
                    <div className="zgm-yt-play">
                      <svg width="34" height="34" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="rgba(0,0,0,.55)"/><path d="M13 10l9 6-9 6V10z" fill="#fff"/></svg>
                    </div>
                  </div>
                )}
                <div className="zgm-yt-meta">
                  <span className="zgm-yt-title">{v.title}</span>
                  {v.date && <span className="zgm-yt-date">{v.date}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── RWA COMPARISON — horizontal scroll table ── */}
        <section className="zgm-section" ref={comparisonRef}>
          <div className="zgm-section-head">
            <h2 className="zgm-h">{t('zigchainChrome.section.rwaLandscape', 'RWA Landscape')}</h2>
            <span className="zgm-aside">{liveCompLoading ? t('zigchainChrome.state.loading', 'Loading…') : t('zigchainChrome.state.liveData', 'Live data')}</span>
          </div>
          <div className="zgm-table-scroll">
            <table className="zgm-table">
              <thead>
                <tr>
                  <th>{t('zigchainChrome.table.project', 'Project')}</th><th>{t('zigchainChrome.table.mktCap', 'Mkt Cap')}</th><th>{t('zigchainChrome.table.tvl', 'TVL')}</th><th>{t('zigchainChrome.table.differentiator', 'Differentiator')}</th><th>{t('zigchainChrome.table.license', 'License')}</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((c) => (
                  <tr key={c.name} className={c.highlight ? 'is-hl' : ''}>
                    <td><span className="zgm-table-name">{c.name}</span><span className="zgm-table-sym">{c.symbol}</span></td>
                    <td className="zgm-table-num">{c.mcap}</td>
                    <td className="zgm-table-num">{c.tvl}</td>
                    <td className="zgm-table-muted">{c.diff}</td>
                    <td>{c.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── INTELLIGENCE FEED ── */}
        <section className="zgm-section">
          <div className="zgm-section-head">
            <h2 className="zgm-h">{t('zigchainChrome.section.intelligenceUpdates', 'Intelligence & Updates')}</h2>
            <span className="zgm-aside">{t('zigchainChrome.aside.updates', '{{count}} updates', { count: D.intelligenceFeed.length })}</span>
          </div>
          <div className="zgm-intel-list">
            {D.intelligenceFeed.map((item, i) => {
              const Card = item.url ? 'a' : 'div'
              const linkProps = item.url ? { href: item.url, target: '_blank', rel: 'noopener noreferrer' } : {}
              return (
                <Card key={i} className={`zgm-intel${item.recent ? ' is-recent' : ''}`} {...linkProps}>
                  <div className="zgm-intel-top">
                    <span className="zgm-intel-source">{item.source}</span>
                    <span className="zgm-intel-date">{item.date}</span>
                  </div>
                  <h4 className="zgm-intel-headline">{item.headline}</h4>
                  <p className="zgm-intel-summary">{item.summary}</p>
                  <div className="zgm-chip-wrap">{item.tags.map((t) => <span key={t} className="zgm-chip zgm-chip--sm">{t}</span>)}</div>
                </Card>
              )
            })}
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer className="zgm-footer">
          <div className="zgm-footer-facts">
            <div><span className="zgm-foot-l">{t('zigchainChrome.footer.consensus', 'Consensus')}</span><span className="zgm-foot-v">{D.chain.consensus}</span></div>
            <div><span className="zgm-foot-l">{t('zigchainChrome.footer.framework', 'Framework')}</span><span className="zgm-foot-v">Cosmos SDK · EVM</span></div>
          </div>
          <div className="zgm-footer-links">
            {ZIG_SOCIALS.map((s) => <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>)}
          </div>
        </footer>

        {selectedProto && <ProtocolPanel protocol={selectedProto} onClose={() => setSelectedProto(null)} />}
      </div>
    )
  }

  return (
    <div className="z-page">
      {/* Light pillar */}
      <div className="z-pillar"><div className="z-pillar-core"/><div className="z-pillar-wide"/><div className="z-pillar-orb"/></div>

      {/* ═══ BRANDED HERO PANEL — Founders-inspired editorial glass ═══ */}
      <Reveal className="z-brand-panel">
        <div className="z-brand-aurora" aria-hidden />
        <div className="z-brand-noise" aria-hidden />
        <div className="z-brand-edge-tl" aria-hidden />

        {/* Founders backdrop — single trio photo fading into the panel from the right.
            Drop the image at apps/research/public/zigchain-founders.jpg */}
        <div className="z-brand-founders" aria-hidden>
          {/* JPEG (207KB desktop / 72KB mobile) replaces the legacy 1.85MB PNG.
              srcset lets the browser pick the right size per viewport. */}
          <img
            src="/zigchain-founders.jpg"
            srcSet="/zigchain-founders-800.jpg 800w, /zigchain-founders.jpg 1600w"
            sizes="(max-width: 768px) 100vw, 60vw"
            alt=""
            className="z-brand-founder-img"
            width="1600"
            height="900"
            fetchpriority="high"
            decoding="async"
            loading="eager"
          />
          <div className="z-brand-founders-tint" />
        </div>


        {/* Identity block (left + center) */}
        <div className="z-brand-inner">
          <div className="z-brand-mark">
            <div className="z-brand-halo" aria-hidden />
            <img src={ZIG_LOGO_LG} alt="ZIGChain" className="z-brand-logo" />
          </div>
          <div className="z-brand-body">
            <div className="z-brand-eyebrow">
              <span>{t('zigchainChrome.eyebrow.cosmosL1', 'Cosmos L1')}</span>
              <span className="z-brand-eyebrow-dot" />
              <span>{t('zigchainChrome.eyebrow.rwaTokenization', 'RWA Tokenization')}</span>
              <span className="z-brand-eyebrow-dot" />
              <span>{t('zigchainChrome.eyebrow.mainnetOct2025', 'Mainnet · Oct 2025')}</span>
            </div>
            <h1 className="z-brand-title">
              ZIGChain
              <span className="z-brand-live"><span className="z-id-dot" /> {t('zigchainChrome.live', 'LIVE')}</span>
            </h1>
            <p className="z-brand-tagline">{t('zigchainChrome.taglineDesktop', 'Cosmos Layer 1 purpose-built for real-world asset tokenization. The first Shariah-certified blockchain · $3B+ institutional pipeline.')}</p>

            <div className="z-brand-pills">
              <span className="z-brand-pill is-primary" data-tone="blue">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="m3 14 9 4.5L21 14M3 11.25l9 4.5 9-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity=".6"/>
                </svg>
                {t('zigchainChrome.pill.layer1', 'Layer 1')}
              </span>
              <span className="z-brand-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="m9 8-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
                </svg>
                {t('zigchainChrome.pill.evmCompatible', 'EVM-Compatible')}
              </span>
              <span className="z-brand-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 3 4 6.5v5.6c0 4.5 3.4 7.7 8 8.9 4.6-1.2 8-4.4 8-8.9V6.5L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
                Tendermint PoS
              </span>
              <span className="z-brand-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 3 4 6.5v5.6c0 4.5 3.4 7.7 8 8.9 4.6-1.2 8-4.4 8-8.9V6.5L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
                </svg>
                {t('zigchainChrome.pill.shariahCertified', 'Shariah Certified')}
              </span>
              <span className="z-brand-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 3 4 6.5v5.6c0 4.5 3.4 7.7 8 8.9 4.6-1.2 8-4.4 8-8.9V6.5L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
                FSCA · DIFC
              </span>
            </div>
          </div>
        </div>

        {/* Bottom row — stats on the left, actions on the right. No chassis. */}
        <div className="z-brand-strip">
          <div className="z-brand-strip-stats">
            <div className="z-brand-strip-stat">
              <span className="z-brand-strip-l">{t('zigchainChrome.stat.tvl', 'Total Value Locked')}</span>
              <span className="z-brand-strip-v">{fmt(tvlCurrent)}</span>
            </div>
            <div className="z-brand-strip-stat">
              <span className="z-brand-strip-l">{t('zigchainChrome.stat.marketCap', 'Market Cap')}</span>
              <span className="z-brand-strip-v">{fmt(price?.marketCap) || '$39.8M'}</span>
            </div>
            <div className="z-brand-strip-stat">
              <span className="z-brand-strip-l">{t('zigchainChrome.stat.institutionalPipeline', 'Institutional Pipeline')}</span>
              <span className="z-brand-strip-v">$3B+</span>
            </div>
          </div>
          <div className="z-brand-actions">
            <button type="button" className="z-brand-watch" aria-label={t('zigchainChrome.aria.saveToWatchlist', 'Save to watchlist')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12h14"/></svg>
              <span>{t('zigchainChrome.action.watchlist', 'Watchlist')}</span>
            </button>
            <a href={D.chain.docs} target="_blank" rel="noopener noreferrer" className="z-brand-cta">
              <span>{t('zigchainChrome.action.docs', 'Docs')}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
            </a>
          </div>
        </div>
      </Reveal>

      {/* The TVL chart sits directly under the banner (founder, 08-17): the
          chain's headline number, then its shape, before any feed. The whole
          two-column block moves as one so the chart keeps its stat sidebar. */}
      {/* ═══ MAIN GRID — TVL chart (left) + glass stat sidebar (right) ═══ */}
      <Reveal className="z-grid-main">
        <div className="z-grid-left">
          <ZigTvlChart extras={tvlExtras} onExtrasChange={updateTvlExtras} />
          <ZigPriceChart />
        </div>
        <aside className="z-grid-right">
          {/* TVL summary tiles */}
          <div className="z-tile">
            <span className="z-tile-l">{t('zigchainChrome.table.tvl', 'TVL')}</span>
            <div className="z-tile-row">
              <span className="z-tile-v">{fmt(tvlCurrent)}</span>
              {tvlChange7d != null && <span className={`z-tile-d ${tvlChange7d >= 0 ? 'up' : 'dn'}`}>{fmtPct(tvlChange7d)}</span>}
            </div>
          </div>

          {/* Market data 2-col tile grid */}
          <div className="z-tile-grid">
            <div className="z-tile">
              <span className="z-tile-l">{t('zigchainChrome.stat.marketCap', 'Market Cap')}</span>
              <span className="z-tile-v">{fmt(price?.marketCap)}</span>
            </div>
            <div className="z-tile">
              <span className="z-tile-l">{t('zigchainChrome.stat.fdv', 'FDV')}</span>
              <span className="z-tile-v">{fmt(marketData?.fdv)}</span>
            </div>
            <div className="z-tile">
              <span className="z-tile-l">{t('zigchainChrome.stat.volume24h', '24h Volume')}</span>
              <span className="z-tile-v">{fmt(price?.volume24h)}</span>
            </div>
            <div className="z-tile">
              <span className="z-tile-l">{t('zigchainChrome.stat.volMcap', 'Vol / MCap')}</span>
              <span className="z-tile-v">{(price?.volume24h && price?.marketCap) ? `${((price.volume24h/price.marketCap)*100).toFixed(2)}%` : '...'}</span>
            </div>
            <div className="z-tile">
              <span className="z-tile-l">{t('zigchainChrome.stat.circSupply', 'Circ. Supply')}</span>
              <span className="z-tile-v">1.41B / 2B</span>
            </div>
            <div className="z-tile">
              <span className="z-tile-l">{t('zigchainChrome.stat.totalSupply', 'Total Supply')}</span>
              <span className="z-tile-v">1.95B</span>
            </div>
          </div>

          <div className="z-tile">
            <span className="z-tile-l">{t('zigchainChrome.stat.rank', 'Rank')}</span>
            <span className="z-tile-v">#{marketData?.marketCapRank || '...'}</span>
          </div>

          {/* Live ZIG/USD price card with sparkline */}
          <div className="z-pricecard">
            <span className="z-pricecard-l">ZIG / USD</span>
            <div className="z-pricecard-row">
              <span className="z-pricecard-v">{loading ? '...' : fmtPrice(price?.usd)}</span>
              {price?.change24h != null && <span className={`z-pricecard-d ${bull?'up':'dn'}`}>{fmtPct(price.change24h)}</span>}
            </div>
            {sparkline?.length > 10 && (
              <div className="z-pricecard-spark">
                <Spark data={sparkline} h={64} />
              </div>
            )}
            {marketData && (
              <div className="z-pricecard-foot">
                <span><span className="z-pricecard-fl">{t('zigchainChrome.stat.low', 'Low')}</span> {fmtPrice(marketData.low24h)}</span>
                <span><span className="z-pricecard-fl">{t('zigchainChrome.stat.high', 'High')}</span> {fmtPrice(marketData.high24h)}</span>
              </div>
            )}
          </div>

          {/* Period change pills */}
          <div className="z-perfgrid">
            {[
              { l: '7D', v: marketData?.change7d },
              { l: '30D', v: marketData?.change30d },
              { l: '90D', v: null },
              { l: 'ATH', v: marketData?.athChangePercent },
            ].map((p) => {
              const has = Number.isFinite(p.v)
              const up = has && p.v >= 0
              return (
                <div key={p.l} className={`z-perfcell ${has ? (up ? 'up' : 'dn') : 'is-empty'}`}>
                  <span className="z-perfcell-l">{p.l}</span>
                  <span className="z-perfcell-v">{has ? fmtPct(p.v) : '—'}</span>
                </div>
              )
            })}
          </div>

          {/* Key Stats — chain meta */}
          <div className="z-stats">
            <span className="z-stats-l">{t('zigchainChrome.section.keyStats', 'Key Stats')}</span>
            <dl className="z-stats-list">
              <div className="z-stats-row"><dt>{t('zigchainChrome.keyStats.blockchain', 'Blockchain')}</dt><dd>{D.token.symbol}</dd></div>
              <div className="z-stats-row"><dt>{t('zigchainChrome.keyStats.consensus', 'Consensus')}</dt><dd>Tendermint PoS</dd></div>
              <div className="z-stats-row"><dt>{t('zigchainChrome.keyStats.evmCompatible', 'EVM Compatible')}</dt><dd>{t('zigchainChrome.keyStats.yes', 'Yes')}</dd></div>
              <div className="z-stats-row"><dt>{t('zigchainChrome.keyStats.coreTech', 'Core Tech')}</dt><dd>Cosmos SDK</dd></div>
              <div className="z-stats-row"><dt>{t('zigchainChrome.keyStats.bridge', 'Bridge')}</dt><dd>IBC</dd></div>
              <div className="z-stats-row"><dt>{t('zigchainChrome.keyStats.mainnet', 'Mainnet')}</dt><dd>Oct 2025</dd></div>
              <div className="z-stats-row"><dt>{t('zigchainChrome.keyStats.audits', 'Audits')}</dt><dd>{t('zigchainChrome.keyStats.audited', '{{count}} Active', { count: D.security.length })}</dd></div>
            </dl>
          </div>

          {/* CTA */}
          <a href={D.chain.docs} target="_blank" rel="noopener noreferrer" className="z-docs-cta">
            {t('zigchainChrome.action.viewDocs', 'View Docs')}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
          </a>
        </aside>
      </Reveal>

      {/* ═══ BREAKING NEWS BANNER ═══ */}
      <Reveal>
        <BreakingNewsBanner live={liveBreaking} />
      </Reveal>

      {/* ═══ SOCIAL INTELLIGENCE — live X Dash standing (peaked near the top) ═══ */}
      <Reveal>
        <ZigSocialIntel />
      </Reveal>

      {/* ═══ PARTNERS & ANNOUNCEMENTS — logo wall + live @ZIGChain feed ═══ */}
      <Reveal>
        <ZigAnnouncements
          partners={sortedPartners}
          announcements={zigAnnouncements}
          loading={annLoading}
          fallback={D.intelligenceFeed}
        />
      </Reveal>


      {/* ═══ THE THESIS — full-width 5-cell band ═══ */}
      <Reveal>
        <section className="z-thesis">
          <header className="z-thesis-head">
            <span className="z-thesis-eyebrow">{t('zigchainChrome.thesis.eyebrow', 'The Thesis')}</span>
            <h3 className="z-thesis-title">{t('zigchainChrome.section.whyZigchain', 'Why ZIGChain')}</h3>
            <p className="z-thesis-sub">{t('zigchainChrome.thesis.sub', 'Five stats that anchor the institutional pitch. Sourced from announced partnerships and audited treasury allocations.')}</p>
          </header>
          <div className="z-thesis-grid">
            <article className="z-thesis-cell" data-tone="apex">
              <span className="z-thesis-tag">Apex Group</span>
              <span className="z-thesis-num">$3.4T</span>
              <span className="z-thesis-label">{t('zigchainChrome.thesis.aua', 'Assets under administration')}</span>
              <p className="z-thesis-desc">Fund-administration partner bringing regulated on-chain RWA tokenization to ZIGChain (July 2025).</p>
            </article>
            <article className="z-thesis-cell" data-tone="segg">
              <span className="z-thesis-tag">{t('zigchainChrome.thesis.crossChainUsdc', 'Cross-chain USDC')}</span>
              <span className="z-thesis-num">$78B+</span>
              <span className="z-thesis-label">{t('zigchainChrome.thesis.stableLiq', 'Stable liquidity reachable')}</span>
              <p className="z-thesis-desc">Native USDC + CCTP integration from 16+ chains makes ZIGChain immediately addressable to institutional stable capital.</p>
            </article>
            <article className="z-thesis-cell" data-tone="eco">
              <span className="z-thesis-tag">ZIGLabs Fund</span>
              <span className="z-thesis-num">$100M</span>
              <span className="z-thesis-label">{t('zigchainChrome.stat.ecosystemFund', 'Ecosystem Fund')}</span>
              <p className="z-thesis-desc">Growth capital deploying through 2026 — developer onboarding, dApp deployment, RWA tooling.</p>
            </article>
            <article className="z-thesis-cell" data-tone="rwa">
              <span className="z-thesis-tag">Macro · 2033</span>
              <span className="z-thesis-num">$18T</span>
              <span className="z-thesis-label">{t('zigchainChrome.thesis.rwaMarketProj', 'RWA market projection')}</span>
              <p className="z-thesis-desc">BCG projection for tokenized RWAs by 2033. ZIGChain is a Shariah-certified L1 positioned at the on-ramp.</p>
            </article>
            <article className="z-thesis-cell" data-tone="dist">
              <span className="z-thesis-tag">Zignaly Network</span>
              <span className="z-thesis-num">600K+</span>
              <span className="z-thesis-label">{t('zigchainChrome.thesis.usersManagers', 'Users · 150+ managers')}</span>
              <p className="z-thesis-desc">Distribution layer inherited from Zignaly's social trading platform. Day-one liquidity rails for every product launched on ZIGChain.</p>
            </article>
          </div>
        </section>
      </Reveal>

      {/* ═══ QUICK FACTS ═══ */}
      <div className="z-facts">
        {[
          'Cosmos SDK · EVM',
          'Tendermint PoS',
          t('zigchainChrome.pill.shariahCertified', 'Shariah Certified'),
          t('zigchainChrome.fact.fscaDifcLicensed', 'FSCA · DIFC Licensed'),
          t('zigchainChrome.fact.mainnetOct2025', 'Mainnet Oct 2025'),
        ].map(f =>
          <span key={f} className="z-fact">{f}</span>
        )}
        {D.exchanges.slice(0,3).map(ex =>
          <span key={ex.name} className="z-fact"><span className="z-fact-dot"/>{ex.name}{ex.note&&<span className="z-fact-tag">{ex.note}</span>}</span>
        )}
      </div>

      {/* ═══ ECOSYSTEM — Intelligence story-card style ═══ */}
      <Reveal>
        <div className="z-section-head"><h2 className="z-h2">{t('zigchainChrome.section.ecosystem', 'Ecosystem')}</h2><span className="z-section-aside">{t('zigchainChrome.aside.ecosystemFull', '{{users}} users · {{managers}} managers · {{pipeline}} pipeline', { users: D.ecosystem.users, managers: D.ecosystem.portfolioManagers, pipeline: D.ecosystem.tokenizedPipeline })}</span></div>
        <div className="z-eco-grid">
          {D.protocols.map(p => {
            const logo = PROTOCOL_LOGOS[p.name]
            const tvl = p.tvl || p.tvlEstimate
            return (
              <div
                key={p.name}
                className="z-eco-card"
                data-cat={p.category.toLowerCase().replace(/\s+/g, '-')}
                onClick={() => setSelectedProto(p)}
              >
                <div className="z-eco-card-visual">
                  <Ava src={logo} name={p.name} size={48} />
                  <span className="z-eco-card-cat">{p.category}</span>
                </div>
                <div className="z-eco-card-body">
                  <div className="z-eco-card-head"><span className="z-eco-card-name">{p.name}</span>{tvl&&<span className="z-eco-card-tvl">{fmt(tvl)}</span>}</div>
                  <p className="z-eco-card-desc">{p.desc}</p>
                  {p.metrics && <span className="z-eco-card-stat">{p.metrics}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </Reveal>

      {/* ═══ ARCHITECTURE + TEAM — side-by-side, compact partner rows ═══ */}
      <Reveal className="z-arch-team">
        <div className="z-arch-team-col">
          <div className="z-section-head">
            <h2 className="z-h2">{t('zigchainChrome.section.institutionalArchitecture', 'Institutional Architecture')}</h2>
            <span className="z-section-aside">{t('zigchainChrome.aside.capitalStack', 'Capital stack')}</span>
          </div>
          <div className="z-partner-list">
            {sortedPartners.map((p, i) => (
              <div key={p.name} className={`z-partner-row${i === 0 ? ' is-lead' : ''}`}>
                <div className="z-partner-row-id">
                  <Ava src={PARTNER_LOGOS[p.name]} name={p.name} size={32} />
                  <div className="z-partner-row-info">
                    <span className="z-partner-name">{p.name}</span>
                    <span className="z-partner-role">{p.role}</span>
                  </div>
                </div>
                <div className="z-partner-row-stat">
                  {p.statRaw
                    ? <CountUp value={p.statRaw} prefix="$" className={`z-count ${i === 0 ? 'z-count-md' : 'z-count-sm'}`} />
                    : <span className="z-partner-stat-text">{p.stat}</span>}
                  <span className="z-partner-meta">{p.status} · {p.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="z-arch-team-col">
          <div className="z-section-head">
            <h2 className="z-h2">{t('zigchainChrome.section.team', 'Team')}</h2>
            <span className="z-section-aside">{t('zigchainChrome.aside.members', '{{count}} members', { count: D.team.length })}</span>
          </div>
          <div className="z-team">
            {D.team.map(m => (
              <div key={m.name} className="z-team-card">
                <Ava
                  src={m.avatar || (m.twitter ? `https://unavatar.io/twitter/${m.twitter}` : null)}
                  name={m.name}
                  size={72}
                />
                <div>
                  <span className="z-team-name">{m.name}</span>
                  <span className="z-team-role">{m.role}</span>
                  <span className="z-team-bg">{m.bg}</span>
                  {m.twitter && (
                    <a href={`https://x.com/${m.twitter}`} target="_blank" rel="noopener noreferrer" className="z-team-x">@{m.twitter}</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ═══ FOUNDER SPOTLIGHT — Abdul Rafay (birthday-aware) ═══ */}
      <Reveal>
        <FounderSpotlightSection
          spotlight={getProjectOverrides('ZIG')?.founderSpotlight}
          standalone
          wordmark={ZIG_WORDMARK}
        />
      </Reveal>

      {/* ═══ RWA + FUNDING — paired full-width row ═══ */}
      <Reveal className="z-rwa-fund">
        <div className="z-rwa-section">
          <span className="z-rwa-big">$18T</span>
          <span className="z-rwa-sub">{t('zigchainChrome.rwa.projection2033', 'Projected RWA Market · 2033')}</span>
          <div className="z-rwa-grid">
            {D.assetClasses.map(ac => (
              <div key={ac.name} className="z-rwa-card"><span className="z-rwa-name">{ac.name}</span><span className="z-rwa-via">{t('zigchainChrome.via', 'via {{name}}', { name: ac.via })}</span><span className="z-rwa-desc">{ac.desc}</span></div>
            ))}
          </div>
        </div>
        <div className="z-fund-section">
          <div className="z-section-head">
            <h2 className="z-h2">{t('zigchainChrome.section.funding', 'Funding')}</h2>
            <span className="z-section-aside">{t('zigchainChrome.aside.raised', '{{amount}} raised', { amount: D.funding.total })}</span>
          </div>
          <div className="z-funding-row">
            <div className="z-funding-card"><span className="z-funding-amt">{D.funding.ecosystemFund}</span><span className="z-funding-desc">{t('zigchainChrome.stat.ecosystemFund', 'Ecosystem Fund')}</span></div>
            <div className="z-funding-card"><span className="z-funding-amt">{D.funding.defiAIFund}</span><span className="z-funding-desc">{t('zigchainChrome.stat.defaiFund', 'DeFAI Fund')}</span></div>
          </div>
          <div className="z-investors">{D.funding.investors.map(inv => <span key={inv} className="z-investor">{inv}</span>)}</div>
        </div>
      </Reveal>

      {/* ═══ FOUNDER'S LATEST — live from X-Dash crawler ═══ */}
      <Reveal>
        <ZigFounderTweets />
      </Reveal>

      <Reveal>
        <ZigEpisodes />
      </Reveal>

      {/* ═══ MEDIA — YouTube channel highlights ═══ */}
      <Reveal>
        <div className="z-section-head">
          <h2 className="z-h2">{t('zigchainChrome.section.youtubeHighlights', 'YouTube Highlights')}</h2>
          <a href={ZIG_YOUTUBE.channel} target="_blank" rel="noopener noreferrer" className="z-more">{t('zigchainChrome.action.viewChannel', 'View Channel ↗')}</a>
        </div>
        <p className="z-section-sub">{t('zigchainChrome.youtube.sub', 'Pinned interviews and Summit recordings from the ZIGChain channel.')}</p>
        <div className="z-yt-grid">
          {ZIG_YOUTUBE.videos.slice(0, 6).map(v => (
            <div
              key={v.id}
              className="z-yt"
              onClick={() => setYtPlaying(ytPlaying === v.id ? null : v.id)}
            >
              {ytPlaying === v.id ? (
                <iframe src={`https://www.youtube.com/embed/${v.id}?autoplay=1&rel=0`} title={v.title} className="z-yt-frame" allow="autoplay;encrypted-media" allowFullScreen/>
              ) : (
                <div className="z-yt-thumb">
                  <img src={`https://img.youtube.com/vi/${v.id}/maxresdefault.jpg`} alt={v.title} className="z-yt-img" loading="lazy" onError={(e) => { e.target.src = `https://img.youtube.com/vi/${v.id}/mqdefault.jpg` }} />
                  <div className="z-yt-play">
                    <svg width="36" height="36" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="rgba(0,0,0,.55)"/><path d="M13 10l9 6-9 6V10z" fill="#fff"/></svg>
                  </div>
                </div>
              )}
              <div className="z-yt-meta">
                <span className="z-yt-title">{v.title}</span>
                {v.date && <span className="z-yt-date">{v.date}</span>}
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* IntersectionObserver sentinel — flips comparisonVisible when the
          desktop RWA Landscape section approaches the viewport, gating
          the 7-parallel fetch inside useZigComparison. The mobile tree
          attaches comparisonRef directly to its section; this sentinel
          covers the desktop branch. */}
      <div ref={comparisonRef} aria-hidden="true" style={{ height: 1 }} />
      {/* ═══ RWA COMPARISON TABLE ═══ */}
      <Reveal>
        <div className="z-section-head">
          <h2 className="z-h2">{t('zigchainChrome.section.rwaLandscape', 'RWA Landscape')}</h2>
          <span className="z-section-aside">
            {liveCompLoading ? t('zigchainChrome.state.loadingLiveData', 'Loading live data…') : t('zigchainChrome.state.liveDataSource', 'Live · CoinGecko + DefiLlama')}
          </span>
        </div>
        <p className="z-section-sub">{t('zigchainChrome.rwaLandscape.sub', 'ZIGChain vs major tokenization platforms')}</p>
        <div className="z-compare-wrap">
          <table className="z-compare">
            <thead>
              <tr>
                <th>{t('zigchainChrome.table.project', 'Project')}</th>
                <th>{t('zigchainChrome.stat.marketCap', 'Market Cap')}</th>
                <th>{t('zigchainChrome.table.tvl', 'TVL')}</th>
                <th>{t('zigchainChrome.table.differentiator', 'Differentiator')}</th>
                <th>{t('zigchainChrome.table.keyPartners', 'Key Partners')}</th>
                <th>{t('zigchainChrome.table.license', 'License')}</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map(c => (
                <tr key={c.name} className={c.highlight ? 'z-compare-hl' : ''}>
                  <td><span className="z-compare-name">{c.name}</span><span className="z-compare-sym">{c.symbol}</span></td>
                  <td className="z-compare-mono">{c.mcap}</td>
                  <td className="z-compare-mono">{c.tvl}</td>
                  <td>{c.diff}</td>
                  <td className="z-compare-muted">{c.partnerships}</td>
                  <td>{c.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      {/* ═══ INTELLIGENCE — sorted recent first, with RECENT badge ═══ */}
      <Reveal>
        <div className="z-section-head">
          <h2 className="z-h2">{t('zigchainChrome.section.intelligenceUpdates', 'Intelligence & Updates')}</h2>
          <span className="z-section-aside">{t('zigchainChrome.aside.updatesSorted', '{{count}} updates · sorted by recency', { count: D.intelligenceFeed.length })}</span>
        </div>
        <div className="z-intel-grid">
          {D.intelligenceFeed.map((item, i) => {
            const Card = item.url ? 'a' : 'div'
            const linkProps = item.url
              ? { href: item.url, target: '_blank', rel: 'noopener noreferrer' }
              : {}
            return (
              <Card key={i} className={`z-intel-card${item.recent ? ' is-recent' : ''}`} {...linkProps}>
                {item.recent && (
                  <span className="z-intel-recent" aria-label={t('zigchainChrome.aria.recent', 'Recent')}>
                    <span className="z-intel-recent-dot" /> {t('zigchainChrome.intel.recent', 'Recent')}
                  </span>
                )}
                <div className="z-intel-card-top">
                  <span className="z-intel-source">{item.source}</span>
                  <span className="z-intel-date">{item.date}</span>
                </div>
                <h4 className="z-intel-headline">{item.headline}</h4>
                <p className="z-intel-summary">{item.summary}</p>
                <div className="z-intel-tags">{item.tags.map(t => <span key={t} className="z-intel-tag">{t}</span>)}</div>
              </Card>
            )
          })}
        </div>
      </Reveal>

      {/* ═══ NETWORK FOOTER ═══ */}
      <Reveal className="z-footer">
        <div className="z-footer-facts">
          <div><span className="z-fl">{t('zigchainChrome.footer.consensus', 'Consensus')}</span><span className="z-fv">{D.chain.consensus}</span></div>
          <div><span className="z-fl">{t('zigchainChrome.footer.framework', 'Framework')}</span><span className="z-fv">Cosmos SDK · EVM</span></div>
          <div><span className="z-fl">{t('zigchainChrome.footer.security', 'Security')}</span><span className="z-fv">{D.security.map(s=>s.name).join(' · ')}</span></div>
        </div>
        <div className="z-footer-links">
          {ZIG_SOCIALS.map(s=><a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>)}
        </div>
      </Reveal>

      {/* Protocol detail panel */}
      {selectedProto && <ProtocolPanel protocol={selectedProto} onClose={() => setSelectedProto(null)} />}
    </div>
  )
}
