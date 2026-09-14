/**
 * InlineHorizontalBar - Desktop horizontal welcome bar (top of horizontal layout)
 * Profile, market cap, price cards, sentiment, dominance, US market status, economic events.
 * This is the INLINE version used in the horizontal layout - NOT the extracted HorizontalWelcomeBar
 * used in the original/mobile layout (those have diverged significantly).
 */
import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getStockLogo } from '@/constants/stockData'
import { getCgTop100Sum } from '@/services/coinGeckoApi'
import { TOKEN_LOGOS } from './welcome-page-constants'
import { formatChange } from './welcome-page-helpers'
import { icons } from './welcome-page-icons'
import Sparkline from './sparkline'
import InfoTip from '@/components/InfoTip'

const WELCOME_COINS = ['BTC', 'SOL', 'ETH']

// Showcase-embed detection (matches the other demo-mode locks). Gates the
// clickable BTC/SOL/ETH price cards + their stock equivalents so the
// trending bar doesn't pop a token card inside the marketing iframe.
const isShowcaseEmbed = (() => {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (params.get('demo') === 'true') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
})()

const InlineHorizontalBar = ({
  welcomeOpen, setWelcomeOpen,
  // Profile
  profile, onEditProfile,
  // Market data
  topCoinPrices, stockPrices, marketIndices,
  fearGreed, liveVix, altSeason, marketDominance,
  stocksRiskOnOff, indexAllocation, usMarketStatus, eventState,
  // Handlers
  openTokenCardPopup, handleStockClick, onDominanceClick,
  // Formatting
  fmtPrice, fmtLarge,
  isStocks, t,
}) => {
  const { t: tr } = useTranslation()
  // OTHERS2 dominance (alt long tail, ex-top 100) for the dominance ring legend.
  // Authoritative CG top-100 sum (cached/deduped) vs the BTC-derived total. Shown
  // as an ANNOTATION line, NOT a ring segment (it's a subset of Alts — a segment
  // would double-count). Graceful: stays hidden if unavailable.
  const [othersDom, setOthersDom] = useState(null)
  const btcMcapForTotal = topCoinPrices?.BTC?.marketCap
  const btcDomForTotal = marketDominance?.btc
  useEffect(() => {
    if (isStocks || !btcMcapForTotal || !(btcDomForTotal > 0)) { setOthersDom(null); return }
    let cancelled = false
    getCgTop100Sum().then((sum) => {
      if (cancelled || !(sum > 0)) return
      const total = btcMcapForTotal / (btcDomForTotal / 100)
      const d = total > 0 ? ((total - sum) / total) * 100 : 0
      if (d > 0 && d < 15) setOthersDom(d) // sane band (OTHERS2 ~2-6% of total)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isStocks, btcMcapForTotal, btcDomForTotal])
  return (
    <div className={`welcome-horizontal-bar${!welcomeOpen ? ' is-collapsed' : ''}`} data-tour="market-cockpit">
      {/* Toggle button - top-left overlay */}
      <button className="welcome-bar-toggle" onClick={() => setWelcomeOpen(o => !o)} aria-label={welcomeOpen ? t('welcome.collapseBar', 'Collapse bar') : t('welcome.expandBar', 'Expand bar')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          {welcomeOpen
            ? <polyline points="18 15 12 9 6 15" />
            : <polyline points="6 9 12 15 18 9" />
          }
        </svg>
      </button>

      {welcomeOpen ? (
      <>
      {/* Profile - personal welcome (clicking avatar OR name opens the
          ProfileEditModal in welcome-page.jsx — inline editing broke layout) */}
      <div className="welcome-horizontal-profile">
        <div className="welcome-horizontal-avatar-wrap">
          <button
            type="button"
            className="welcome-horizontal-avatar"
            onClick={onEditProfile}
            aria-label={t('ui.editProfile', 'Edit profile')}
          >
            {(profile?.imageUrl || '').trim() ? (
              <img src={profile?.imageUrl || ''} alt={tr('homePage.inlineHorizontalBar.inlinehorizontalbar.altProfile', "Profile")} decoding="async" width="30" height="30" />
            ) : (
              <span className="welcome-horizontal-avatar-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 10-16 0" /></svg>
              </span>
            )}
          </button>
        </div>
        <div className="welcome-horizontal-name">
          <span className="welcome-horizontal-label">{t('ui.welcome')}</span>
          <button
            type="button"
            className={`welcome-horizontal-user ${!(profile?.name || '').trim() ? 'is-placeholder' : ''}`}
            onClick={onEditProfile}
          >
            {(profile?.name || '').trim() || t('ui.enterYourName')}
            <svg className="welcome-horizontal-edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>

      {/* Global Market Cap */}
      <div className="welcome-horizontal-global-mcap">
        <span className="welcome-horizontal-global-mcap-label">
          {isStocks ? t('ui.usStockMarket') : t('ui.cryptoMarketCap')}
          <InfoTip
            position="bottom"
            text={isStocks
              ? t('edu.usStockMarket', 'The combined value of every US-listed company. It sets the tone for risk everywhere - when it rises, money is confident; when it falls, caution spreads (crypto usually follows).')
              : t('edu.cryptoMarketCap', 'The total value of all crypto - every coin\'s price times how many exist. It is the size of the whole market: bigger = more money already parked in, and it moves slower than any single coin.')}
          />
        </span>
        <span className="welcome-horizontal-global-mcap-value">
          {(() => {
            if (isStocks) {
              const spy = stockPrices?.SPY || marketIndices?.SPY
              if (spy?.price) return fmtPrice(Number(spy.price))
              return 'S&P 500'
            }
            const btcMcap = topCoinPrices?.BTC?.marketCap
            const btcDom = marketDominance.btc
            if (btcMcap && btcDom > 0) {
              const total = btcMcap / (btcDom / 100)
              return fmtLarge(total)
            }
            return '-'
          })()}
        </span>
        <div className="welcome-horizontal-global-mcap-sub">
          <span className="welcome-horizontal-global-mcap-vol">
            {isStocks ? (() => {
              const qqq = stockPrices?.QQQ || marketIndices?.QQQ
              return qqq?.price ? `QQQ ${fmtPrice(Number(qqq.price))}` : 'Nasdaq'
            })() : (() => {
              const btcVol = topCoinPrices?.BTC?.volume || 0
              const ethVol = topCoinPrices?.ETH?.volume || 0
              const solVol = topCoinPrices?.SOL?.volume || 0
              const knownDom = (marketDominance.btc + marketDominance.eth + marketDominance.sol) / 100
              const estTotal = knownDom > 0 ? (btcVol + ethVol + solVol) / knownDom : 0
              return `Vol ${estTotal >= 1e6 ? fmtLarge(estTotal) : '-'}`
            })()}
          </span>
          {(() => {
            if (isStocks) {
              const spy = stockPrices?.SPY || marketIndices?.SPY
              const ch = spy?.change
              if (ch == null) return null
              return (
                <span className={`welcome-horizontal-global-mcap-change ${ch >= 0 ? 'positive' : 'negative'}`}>
                  {ch >= 0 ? '+' : ''}{Number(ch).toFixed(1)}%
                </span>
              )
            }
            const ch = topCoinPrices?.BTC?.change
            if (ch == null) return null
            return (
              <span className={`welcome-horizontal-global-mcap-change ${ch >= 0 ? 'positive' : 'negative'}`}>
                {ch >= 0 ? '+' : ''}{Number(ch).toFixed(1)}%
              </span>
            )
          })()}
        </div>
      </div>

      {/* Price Cards - Apple native vertical stack */}
      <div className="welcome-horizontal-prices">
        {(isStocks ? ['SPY', 'QQQ', 'AAPL'] : WELCOME_COINS.slice(0, 3)).map((symbol) => {
          const data = isStocks
            ? (stockPrices?.[symbol] || marketIndices?.[symbol])
            : (topCoinPrices?.[symbol] || topCoinPrices?.[symbol.toUpperCase()])
          const price = data?.price != null && data.price > 0 ? Number(data.price) : null
          const change = data?.change != null ? Number(data.change) : (data?.change24 != null ? Number(data.change24) : null)
          const logo = isStocks ? getStockLogo(symbol) : TOKEN_LOGOS[symbol]
          const sparkData = data?.sparkline_7d || null
          return (
            <div
              key={symbol}
              className={`welcome-horizontal-price-card${isShowcaseEmbed ? ' is-locked' : ''}`}
              onClick={() => {
                if (isShowcaseEmbed) return
                isStocks ? handleStockClick({ symbol, name: symbol }) : openTokenCardPopup(symbol)
              }}
              aria-disabled={isShowcaseEmbed || undefined}
              title={isShowcaseEmbed ? 'Available in Beta' : undefined}
            >
              <div className="welcome-horizontal-price-left">
                {logo && (
                  <img
                    src={logo}
                    alt=""
                    className="welcome-horizontal-price-logo"
                    onError={(e) => {
                      // PWA CacheFirst on assets.coingecko.com (vite.config.js)
                      // can serve a stale broken response for up to 7d if the
                      // first cache write hit during an upstream blip. Hide
                      // the img so the surrounding circle stays clean rather
                      // than a broken-image glyph (the "lost icons" report).
                      e.target.style.display = 'none'
                    }}
                  />
                )}
                <span className="welcome-horizontal-price-symbol">{symbol}</span>
              </div>
              {sparkData && (
                <span className="welcome-horizontal-price-spark">
                  <Sparkline data={sparkData} positive={change >= 0} width={64} height={18} />
                </span>
              )}
              <span className="welcome-horizontal-price-value">{price != null ? fmtPrice(price) : <span className="welcome-bar-skeleton animate-shimmer" aria-hidden="true" />}</span>
              {change != null && (
                <span className={`welcome-horizontal-price-change ${change >= 0 ? 'positive' : 'negative'}`}>
                  {change >= 0 ? '+' : ''}{formatChange(change)}%
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Sentiment - SVG Arc Gauge */}
      <div className="welcome-horizontal-sentiment">
        {(() => {
          const rawVal = isStocks
            ? (liveVix?.price != null ? Math.min(100, Math.max(0, ((liveVix.price - 10) / 30) * 100)) : 50)
            : (fearGreed.value ?? 50)
          const gaugeVal = Math.min(100, Math.max(0, rawVal))
          const sentiment = isStocks
            ? (liveVix?.price != null ? (liveVix.price >= 25 ? 'fear' : liveVix.price <= 15 ? 'greed' : 'neutral') : 'neutral')
            : (fearGreed.value != null ? (fearGreed.value >= 56 ? 'greed' : fearGreed.value <= 45 ? 'fear' : 'neutral') : 'neutral')
          const displayVal = isStocks ? (liveVix?.price != null ? liveVix.price.toFixed(0) : '-') : (fearGreed.value ?? '-')
          const classification = isStocks ? (liveVix?.label || '') : (fearGreed.classification || '')
          const cx = 50, cy = 44, r = 36
          const needleAngle = Math.PI - (gaugeVal / 100) * Math.PI
          const arcStartX = cx - r, arcEndX = cx + r
          const needleX = cx + (r - 5) * Math.cos(needleAngle)
          const needleY = cy - (r - 5) * Math.sin(needleAngle)
          return (
            <div className="welcome-horizontal-fng" data-sentiment={sentiment}>
              <span className="welcome-horizontal-fng-label">
                {isStocks ? t('ui.vixIndex') : t('ui.fearAndGreed')}
                <InfoTip
                  position="bottom"
                  text={isStocks
                    ? t('edu.vixIndex', 'The VIX is the stock market\'s "fear gauge" - how much investors expect prices to swing. High VIX (25+) = anxiety and big moves; low VIX (under 15) = calm and complacency.')
                    : t('edu.fearAndGreed', 'A 0-100 mood gauge for crypto. Low = fear (people selling, often near bottoms); high = greed (euphoria, often near tops). Seasoned traders use it as a contrarian compass - not a buy/sell signal on its own.')}
                />
              </span>
              <div className="welcome-horizontal-fng-gauge">
                <svg width="86" height="46" viewBox="0 0 100 54" fill="none">
                  <defs>
                    <linearGradient id="fng-bar-arc" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#EF4444" />
                      <stop offset="30%" stopColor="#F59E0B" />
                      <stop offset="60%" stopColor="#84CC16" />
                      <stop offset="100%" stopColor="#10B981" />
                    </linearGradient>
                  </defs>
                  {/* Arc black border */}
                  <path
                    className="fng-arc-border"
                    d={`M ${arcStartX},${cy} A ${r},${r} 0 0,1 ${arcEndX},${cy}`}
                    stroke="rgba(0,0,0,0.5)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    fill="none"
                  />
                  {/* Background track */}
                  <path
                    className="fng-arc-track"
                    d={`M ${arcStartX},${cy} A ${r},${r} 0 0,1 ${arcEndX},${cy}`}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="7"
                    strokeLinecap="round"
                    fill="none"
                  />
                  {/* Colored arc */}
                  <path
                    d={`M ${arcStartX},${cy} A ${r},${r} 0 0,1 ${arcEndX},${cy}`}
                    stroke="url(#fng-bar-arc)"
                    strokeWidth="7"
                    strokeLinecap="round"
                    fill="none"
                  />
                  {/* Needle border (black outline) */}
                  <line
                    className="fng-needle-border"
                    x1={cx} y1={cy}
                    x2={needleX} y2={needleY}
                    stroke="rgba(0,0,0,0.6)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  {/* Needle */}
                  <line
                    className="fng-needle-inner"
                    x1={cx} y1={cy}
                    x2={needleX} y2={needleY}
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <circle className="fng-pivot-outer" cx={cx} cy={cy} r="3.5" fill="rgba(0,0,0,0.6)" stroke="none" />
                  <circle className="fng-pivot-inner" cx={cx} cy={cy} r="2.5" fill="var(--bg-overlay, #1a1a1d)" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
                </svg>
              </div>
              <span className="welcome-horizontal-fng-value">
                {displayVal}
              </span>
              <span className="welcome-horizontal-fng-classification">{classification}</span>
            </div>
          )
        })()}
      </div>

      {/* Market Dominance - Premium Donut Ring */}
      <div
        className={`welcome-horizontal-dominance${onDominanceClick && !isStocks ? ' welcome-horizontal-dominance--clickable' : ''}`}
        onClick={onDominanceClick && !isStocks ? onDominanceClick : undefined}
        role={onDominanceClick && !isStocks ? 'button' : undefined}
        tabIndex={onDominanceClick && !isStocks ? 0 : undefined}
        onKeyDown={onDominanceClick && !isStocks ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDominanceClick() } } : undefined}
        aria-label={onDominanceClick && !isStocks ? 'Open Bitcoin Dominance chart' : undefined}
      >
        {(() => {
          const segments = isStocks
            ? [
                { cls: 'btc', name: 'S&P', pct: indexAllocation.sp500, color: '#f7931a', colorFade: 'rgba(247,147,26,0.15)' },
                { cls: 'eth', name: 'NDQ', pct: indexAllocation.nasdaq, color: '#627eea', colorFade: 'rgba(98,126,234,0.15)' },
                { cls: 'sol', name: 'SmCp', pct: indexAllocation.smallCap, color: '#9945ff', colorFade: 'rgba(153,69,255,0.15)' },
                { cls: 'alts', name: 'Cmd', pct: indexAllocation.commodities, color: 'rgba(245,245,247,0.35)', colorFade: 'rgba(245,245,247,0.06)' },
              ]
            : [
                { cls: 'btc', name: 'BTC', pct: marketDominance.btc, color: '#f7931a', colorFade: 'rgba(247,147,26,0.15)' },
                { cls: 'eth', name: 'ETH', pct: marketDominance.eth, color: '#627eea', colorFade: 'rgba(98,126,234,0.15)' },
                { cls: 'sol', name: 'SOL', pct: marketDominance.sol, color: '#9945ff', colorFade: 'rgba(153,69,255,0.15)' },
                { cls: 'alts', name: 'Alts', pct: marketDominance.alts, color: 'rgba(245,245,247,0.35)', colorFade: 'rgba(245,245,247,0.06)' },
              ]
          const total = segments.reduce((s, x) => s + x.pct, 0) || 100
          const sz = 76, cx = sz / 2, cy = sz / 2
          const r = 29, strokeW = 3.5
          const rInner = r - strokeW / 2 - 0.5
          const rOuter = r + strokeW / 2 + 0.5
          const circ = 2 * Math.PI * r
          const gap = 2
          let offset = -90
          let glowOffset = -90
          const mainPct = isStocks ? indexAllocation.sp500 : marketDominance.btc
          const mainLabel = isStocks ? 'S&P' : 'BTC'
          return (
            <>
              <div className="dominance-ring-legend">
                <span className="dominance-ring-title">
                  {isStocks ? t('ui.indexAllocation') : t('ui.marketDominance')}
                  <InfoTip
                    position="bottom"
                    text={isStocks
                      ? t('edu.indexAllocation', 'How the market splits across the big indices (S&P 500, Nasdaq, small caps, commodities). It shows where money is concentrated and which part of the market is leading.')
                      : t('edu.marketDominance', 'Each coin\'s share of the total crypto market cap. Rising Bitcoin dominance means money is favoring BTC over smaller coins (risk-off); falling dominance often signals "alt season" - capital rotating into altcoins.')}
                  />
                </span>
                <div className="dominance-ring-items">
                  {segments.map(seg => (
                    <span key={seg.cls} className="dominance-ring-item">
                      <span className="dominance-ring-dot" style={{ background: seg.color }} />
                      <span className="dominance-ring-name">{seg.name}</span>
                      <span className="dominance-ring-pct">{seg.pct.toFixed(isStocks ? 0 : 1)}%</span>
                    </span>
                  ))}
                  {!isStocks && othersDom != null && (
                    <span className="dominance-ring-item dominance-ring-item--others" title={tr('homePage.inlineHorizontalBar.inlinehorizontalbar.title', "OTHERS2 - alt long tail (ex-top 100)")}>
                      <span className="dominance-ring-dot" style={{ background: '#9af114' }} />
                      <span className="dominance-ring-name">{tr('homePage.inlineHorizontalBar.inlinehorizontalbar.oth', "Oth")}</span>
                      <span className="dominance-ring-pct">{othersDom.toFixed(1)}%</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="dominance-ring-wrap">
                <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`} className="dominance-ring-svg">
                  <defs>
                    {/* Recessed center depth */}
                    <radialGradient id="dom-center-depth" cx="50%" cy="45%" r="50%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.03)" />
                      <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
                    </radialGradient>
                    {/* Per-segment arc gradients */}
                    {segments.map(seg => (
                      <linearGradient key={`grad-${seg.cls}`} id={`dom-grad-${seg.cls}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={seg.color} stopOpacity="1" />
                        <stop offset="100%" stopColor={seg.color} stopOpacity="0.72" />
                      </linearGradient>
                    ))}
                    {/* Soft glow filter for ambient light */}
                    <filter id="dom-arc-glow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>
                  {/* Recessed center fill */}
                  <circle cx={cx} cy={cy} r={rInner - 1} fill="url(#dom-center-depth)" />
                  {/* Inner black border */}
                  <circle className="dominance-ring-inner-border" cx={cx} cy={cy} r={rInner} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={0.75} shapeRendering="geometricPrecision" />
                  {/* Track */}
                  <circle className="dominance-ring-track" cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth={strokeW} shapeRendering="geometricPrecision" />
                  {/* Outer black border */}
                  <circle className="dominance-ring-outer-border" cx={cx} cy={cy} r={rOuter} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={0.75} shapeRendering="geometricPrecision" />
                  {/* Ambient glow arcs - behind main arcs */}
                  {segments.map((seg) => {
                    const pctNorm = seg.pct / total
                    const arcLen = pctNorm * circ - gap
                    const gapLen = circ - arcLen
                    const rotation = glowOffset
                    glowOffset += (pctNorm * 360)
                    if (arcLen <= 0) return null
                    return (
                      <circle
                        key={`glow-${seg.cls}`}
                        cx={cx} cy={cy} r={r}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={strokeW + 4}
                        strokeDasharray={`${arcLen} ${gapLen}`}
                        strokeDashoffset={0}
                        strokeLinecap="round"
                        opacity={0.08}
                        filter="url(#dom-arc-glow)"
                        transform={`rotate(${rotation} ${cx} ${cy})`}
                      />
                    )
                  })}
                  {/* Main gradient arcs */}
                  {segments.map((seg) => {
                    const pctNorm = seg.pct / total
                    const arcLen = pctNorm * circ - gap
                    const gapLen = circ - arcLen
                    const rotation = offset
                    offset += (pctNorm * 360)
                    if (arcLen <= 0) return null
                    return (
                      <circle
                        key={seg.cls}
                        cx={cx} cy={cy} r={r}
                        fill="none"
                        stroke={`url(#dom-grad-${seg.cls})`}
                        strokeWidth={strokeW}
                        strokeDasharray={`${arcLen} ${gapLen}`}
                        strokeDashoffset={0}
                        strokeLinecap="round"
                        shapeRendering="geometricPrecision"
                        transform={`rotate(${rotation} ${cx} ${cy})`}
                        className="dominance-ring-arc"
                      />
                    )
                  })}
                </svg>
                <div className="dominance-ring-center">
                  <span className="dominance-ring-center-value">{mainPct.toFixed(1)}</span>
                  <span className="dominance-ring-center-label">{mainLabel}</span>
                </div>
              </div>
            </>
          )
        })()}
      </div>

      {/* US Market - Apple native */}
      <div className="welcome-horizontal-market-cme">
        <div className={`welcome-horizontal-market ${usMarketStatus.isOpen ? 'is-open' : 'is-closed'}`}>
          <span className="welcome-horizontal-market-label">
            <span className={`welcome-horizontal-market-indicator ${usMarketStatus.isOpen ? 'is-open' : 'is-closed'}`} />
            {tr('homePage.inlineHorizontalBar.inlinehorizontalbar.usMarket', "US Market")}
            <InfoTip
              position="bottom"
              text={t('edu.usMarketStatus', 'Whether the US stock market (NYSE/Nasdaq) is open right now. Crypto trades 24/7, but it often moves in step with stocks during US trading hours - so this tells you when the "big money" is active.')}
            />
          </span>
          <span className={`welcome-horizontal-market-status ${usMarketStatus.isOpen ? 'is-open' : 'is-closed'}`}>
            {usMarketStatus.isOpen ? 'Open' : 'Closed'}
          </span>
          {usMarketStatus.countdown && (
            <span className={`welcome-horizontal-market-countdown ${usMarketStatus.isOpen ? 'open' : 'closed'}`}>
              {usMarketStatus.countdown.replace(/^(Closes|Opens)\s+/i, '')}
            </span>
          )}
          <span className="welcome-horizontal-market-time-value">
            {usMarketStatus.isOpen ? t('welcome.closes', 'Closes') : t('welcome.opens', 'Opens')} {usMarketStatus.timeMain}
          </span>
        </div>
        {isStocks && (
          <div className="welcome-horizontal-cme">
            <span className="welcome-horizontal-cme-title">{t('welcome.indices', 'Indices')}</span>
            <div className="welcome-horizontal-cme-items">
              {[
                { sym: 'DIA', indexSym: '^DJI', label: 'Dow' },
                { sym: 'IWM', indexSym: '^RUT', label: 'Russell' },
              ].map(idx => {
                const indicesArr = Array.isArray(marketIndices) ? marketIndices : []
                const d =
                  stockPrices?.[idx.sym] ||
                  indicesArr.find(x => x?.symbol === idx.indexSym) ||
                  marketIndices?.[idx.sym]
                const ch = d?.change
                return (
                  <div key={idx.sym} className="welcome-horizontal-cme-item">
                    <span className="welcome-horizontal-cme-label">{idx.label}</span>
                    <span className="welcome-horizontal-cme-value">{d?.price ? fmtPrice(Number(d.price)) : <span className="welcome-bar-skeleton animate-shimmer" aria-hidden="true" />}</span>
                    <span className={`welcome-horizontal-cme-status ${ch != null && ch >= 0 ? 'filled' : 'unfilled'}`}>{ch != null ? `${ch >= 0 ? '+' : ''}${Number(ch).toFixed(1)}%` : '-'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Economic Event - right side of bar */}
      {eventState && (
        <div className={`welcome-horizontal-econ${eventState.state === 'imminent' ? ' is-live' : ''}`}>
          <div className="welcome-horizontal-econ-head">
            <span className={`welcome-horizontal-econ-badge ${eventState.state}`}>
              {eventState.state === 'imminent' && <span className="welcome-horizontal-econ-pulse" />}
              {eventState.label}
            </span>
            {eventState.countdown && (
              <span className="welcome-horizontal-econ-countdown">{eventState.countdown}</span>
            )}
          </div>
          <span className="welcome-horizontal-econ-name">{eventState.event.name}</span>
          <span className="welcome-horizontal-econ-desc">{eventState.descLine}</span>
          {eventState.thenStr && (
            <span className="welcome-horizontal-econ-then">{eventState.thenStr}</span>
          )}
        </div>
      )}
      </>
      ) : (
      /* COLLAPSED mini strip */
      <div className="welcome-bar-mini">
        {(isStocks ? ['SPY', 'QQQ', 'AAPL'] : WELCOME_COINS.slice(0, 3)).map((symbol) => {
          const data = isStocks
            ? (stockPrices?.[symbol] || marketIndices?.[symbol])
            : (topCoinPrices?.[symbol] || topCoinPrices?.[symbol.toUpperCase()])
          const price = data?.price != null && data.price > 0 ? Number(data.price) : null
          const change = data?.change != null ? Number(data.change) : (data?.change24 != null ? Number(data.change24) : null)
          const logo = isStocks ? getStockLogo(symbol) : TOKEN_LOGOS[symbol]
          return (
            <span
              key={symbol}
              className={`welcome-bar-mini-price${isShowcaseEmbed ? ' is-locked' : ''}`}
              onClick={() => { if (isShowcaseEmbed) return; isStocks ? handleStockClick({ symbol, name: symbol }) : openTokenCardPopup(symbol) }}
              aria-disabled={isShowcaseEmbed || undefined}
              title={isShowcaseEmbed ? 'Available in Beta' : undefined}
            >
              {logo && <img src={logo} alt="" loading="lazy" decoding="async" width="20" height="20" onError={isStocks ? (e) => { e.target.style.display = 'none' } : undefined} />}
              <span className="welcome-bar-mini-symbol">{symbol}</span>
              <span className="welcome-bar-mini-value">{price != null ? fmtPrice(price) : <span className="welcome-bar-skeleton animate-shimmer" aria-hidden="true" />}</span>
              {change != null && (
                <span className={`welcome-bar-mini-change ${change >= 0 ? 'positive' : 'negative'}`}>
                  {change >= 0 ? '+' : ''}{formatChange(change)}%
                </span>
              )}
            </span>
          )
        })}
        <span className="welcome-bar-mini-divider" />
        <span className="welcome-bar-mini-fng">
          {isStocks ? 'VIX' : 'FNG'}: <strong>{isStocks ? (liveVix?.price != null ? liveVix.price.toFixed(2) : '-') : (fearGreed.value ?? '-')}</strong> <span className="welcome-bar-mini-fng-label">{isStocks ? (liveVix?.label || '') : (fearGreed.classification || '')}</span>
        </span>
        <span className="welcome-bar-mini-divider" />
        {isStocks ? (
          <span className="welcome-bar-mini-alt">
            {t('ui.risk')}: <strong>{stocksRiskOnOff.value ?? '-'}</strong> <span className="welcome-bar-mini-alt-label">{stocksRiskOnOff.label || ''}</span>
          </span>
        ) : (
          <span className="welcome-bar-mini-alt">
            {t('ui.altSeason')}: <strong>{altSeason.value ?? '-'}</strong> <span className="welcome-bar-mini-alt-label">{altSeason.label || ''}</span>
          </span>
        )}
        <span className="welcome-bar-mini-divider" />
        {isStocks ? (
          <span className="welcome-bar-mini-dom">
            S&P: <strong>{indexAllocation.sp500.toFixed(0)}%</strong>
            <span className="welcome-bar-mini-dom-sub">NDQ {indexAllocation.nasdaq.toFixed(0)}%</span>
          </span>
        ) : (
          <span className="welcome-bar-mini-dom">
            BTC.D: <strong>{marketDominance.btc.toFixed(1)}%</strong>
            <span className="welcome-bar-mini-dom-sub">ETH {marketDominance.eth.toFixed(1)}%</span>
          </span>
        )}
        <span className="welcome-bar-mini-divider" />
        <span className="welcome-bar-mini-mcap">
          {isStocks ? 'SPY' : 'MCap'}: <strong>{(() => {
            if (isStocks) {
              const spy = stockPrices?.SPY || marketIndices?.SPY
              return spy?.price ? fmtPrice(Number(spy.price)) : '-'
            }
            const btcMcap = topCoinPrices?.BTC?.marketCap
            const btcDom = marketDominance.btc
            if (btcMcap && btcDom > 0) {
              const total = btcMcap / (btcDom / 100)
              return fmtLarge(total)
            }
            return '-'
          })()}</strong>
        </span>
        <span className="welcome-bar-mini-divider" />
        <span className={`welcome-bar-mini-market ${usMarketStatus.isOpen ? 'is-open' : 'is-closed'}`}>
          <span className="welcome-bar-mini-market-dot" />
          US: {usMarketStatus.statusLabel}
        </span>
      </div>
      )}
    </div>
  )
}

export default InlineHorizontalBar
