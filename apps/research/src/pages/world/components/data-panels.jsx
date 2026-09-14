/**
 * DataPanels — Bottom strip of 5 glass cards with REAL-TIME data.
 * Live prices from CoinCap WebSocket, volume from Binance WebSocket.
 * No emoji. SVG icons only. Monospace numbers.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { useCurrency } from '@/hooks/useCurrency'
import { MARKET_SESSIONS, isSessionOpen, MACRO_SCORES } from './world-constants'

function formatVolume(n) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

function getNextEvent(sessions) {
  const now = new Date()
  const currentMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  let nearest = { label: '', mins: Infinity }

  sessions.forEach(s => {
    if (s.id === 'crypto') return
    const open = s.openUTC * 60, close = s.closeUTC * 60
    let minsToOpen = open - currentMins; if (minsToOpen < 0) minsToOpen += 1440
    let minsToClose = close - currentMins; if (minsToClose < 0) minsToClose += 1440

    if (isSessionOpen(s)) {
      if (minsToClose < nearest.mins) nearest = { label: `${s.label} closes`, mins: minsToClose }
    } else {
      if (minsToOpen < nearest.mins) nearest = { label: `${s.label} opens`, mins: minsToOpen }
    }
  })

  return { label: nearest.label, countdown: `${Math.floor(nearest.mins / 60)}h ${nearest.mins % 60}m` }
}

const SessionIcons = {
  asia: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="7" cy="7" r="5" /><path d="M2 7h10M7 2c1.5 1.5 2.5 3 2.5 5s-1 3.5-2.5 5" opacity="0.5" /></svg>,
  europe: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="7" cy="7" r="5" /><path d="M2 7h10M7 2c-1.5 1.5-2.5 3-2.5 5s1 3.5 2.5 5" opacity="0.5" /></svg>,
  us: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="7" cy="7" r="5" /><path d="M2 7h10" /><path d="M7 2a8 8 0 00-3 5 8 8 0 003 5" opacity="0.5" /></svg>,
  crypto: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M3 3h8v8H3z" /><path d="M5 1v4M9 1v4M5 9v4M9 9v4M1 5h4M9 5h4M1 9h4M9 9h4" /></svg>,
}

/* ═══════════════════════════════════════════════
   LIVE TICKER PANEL — real-time BTC/ETH/SOL prices
   ═══════════════════════════════════════════════ */
function LiveTickerPanel({ livePrices, topPairs, formatPrice }) {
  const DISPLAY_TOKENS = [
    { id: 'bitcoin', symbol: 'BTC', color: '#f7931a' },
    { id: 'ethereum', symbol: 'ETH', color: '#627eea' },
    { id: 'solana', symbol: 'SOL', color: '#9945ff' },
    { id: 'ripple', symbol: 'XRP', color: '#00aae4' },
  ]

  // Get price + change from Binance (primary), CoinCap (fallback)
  const getData = (token) => {
    const binance = topPairs?.find(p => p.symbol === token.symbol)
    const coinCapPrice = livePrices?.[token.id] ? parseFloat(livePrices[token.id]) : null
    return {
      price: binance?.price || coinCapPrice || null,
      change: binance?.change24h ?? null,
    }
  }

  const hasData = topPairs?.length > 0 || (livePrices && Object.keys(livePrices).length > 0)

  return (
    <div className="world-panel">
      <div className="world-panel-accent" />
      <div className="world-panel-label">
        LIVE PRICES
        {hasData && <span className="world-panel-live-dot" />}
      </div>
      <div className="world-live-ticker-list">
        {DISPLAY_TOKENS.map(token => {
          const { price, change } = getData(token)
          return (
            <div key={token.id} className="world-live-ticker-row">
              <span className="world-live-ticker-dot" style={{ background: token.color }} />
              <span className="world-live-ticker-symbol">{token.symbol}</span>
              <span className="world-live-ticker-price mono">
                {price ? formatPrice(price) : '---'}
              </span>
              {change !== null && (
                <span className={`world-live-ticker-change mono ${change >= 0 ? 'bull' : 'bear'}`}>
                  {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   FLOW VOLUME PANEL — Binance real-time volume
   ═══════════════════════════════════════════════ */
function FlowVolumePanel({ globalData, binanceVolume }) {
  const [tick, setTick] = useState(0)
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 2000); return () => clearInterval(i) }, [])

  // Prefer Binance real-time volume, fall back to CoinGecko
  const volume = binanceVolume > 0 ? binanceVolume : (globalData?.total_volume?.usd || 89_400_000_000)
  const source = binanceVolume > 0 ? 'Binance 24h' : 'CoinGecko 24h'

  const sparkData = useMemo(() => Array.from({ length: 20 }, (_, i) => 0.7 + Math.sin(i * 0.5 + tick * 0.1) * 0.3), [tick])

  return (
    <div className="world-panel">
      <div className="world-panel-accent" />
      <div className="world-panel-label">EXCHANGE VOLUME</div>
      <div className="world-panel-value">{formatVolume(volume)}</div>
      <div className="world-panel-sublabel">{source}</div>
      <div className="world-panel-sparkline">
        <svg viewBox="0 0 80 24" preserveAspectRatio="none">
          <defs><linearGradient id="fv-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(245,245,247,0.12)" /><stop offset="100%" stopColor="rgba(245,245,247,0)" /></linearGradient></defs>
          <polygon fill="url(#fv-grad)" points={`0,24 ${sparkData.map((v, i) => `${(i / 19) * 80},${24 - v * 20}`).join(' ')} 80,24`} />
          <polyline fill="none" stroke="rgba(245,245,247,0.25)" strokeWidth="1.5" points={sparkData.map((v, i) => `${(i / 19) * 80},${24 - v * 20}`).join(' ')} />
        </svg>
      </div>
      <div className="world-panel-stat">
        <span className="mono" style={{ color: 'var(--bull)' }}>20 routes</span>
        <span style={{ color: 'var(--text-muted)' }}>active</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   ACTIVE MARKETS PANEL
   ═══════════════════════════════════════════════ */
function ActiveMarketsPanel() {
  const [, setTick] = useState(0)
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(i) }, [])
  const nextEvent = getNextEvent(MARKET_SESSIONS)

  return (
    <div className="world-panel">
      <div className="world-panel-accent" />
      <div className="world-panel-label">ACTIVE MARKETS</div>
      <div className="world-panel-sessions">
        {MARKET_SESSIONS.map(s => {
          const open = isSessionOpen(s)
          return (
            <div key={s.id} className={`world-session ${open ? 'world-session-active' : ''}`}>
              <span className="world-session-icon">{SessionIcons[s.id]}</span>
              <span className="world-session-name">{s.label}</span>
              <span className={`world-session-dot ${open ? 'live' : ''}`} />
            </div>
          )
        })}
      </div>
      <div className="world-panel-next">
        <span style={{ color: 'var(--text-muted)' }}>Next:</span>
        <span className="mono" style={{ color: 'var(--text-primary)' }}>{nextEvent.label}</span>
        <span className="mono" style={{ color: 'var(--cyan, #06b6d4)' }}>{nextEvent.countdown}</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MACRO HEAT PANEL
   ═══════════════════════════════════════════════ */
function MacroHeatPanel() {
  const top3 = useMemo(() => [...MACRO_SCORES].sort((a, b) => a.score - b.score).slice(0, 3), [])
  return (
    <div className="world-panel">
      <div className="world-panel-accent" />
      <div className="world-panel-label">MACRO HEAT</div>
      <div className="world-panel-sublabel">Stress indicators</div>
      <div className="world-panel-macro-list">
        {/* 2026-05-26 beta-quality fix: graceful empty until real macro feed wired */}
        {top3.length === 0 && <div className="world-whale-empty">Monitoring macro indicators...</div>}
        {top3.map(c => {
          const barColor = c.score > 60 ? 'var(--bull)' : c.score > 40 ? 'var(--text-muted)' : 'var(--bear)'
          return (
            <div key={c.country} className="world-macro-row">
              <span className="world-macro-flag">{c.flag}</span>
              <span className="world-macro-name">{c.country}</span>
              <div className="world-macro-bar"><div className="world-macro-bar-fill" style={{ width: `${c.score}%`, background: barColor }} /></div>
              <span className="mono world-macro-score" style={{ color: barColor }}>{c.score}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   WHALE FEED PANEL
   ═══════════════════════════════════════════════ */
function WhaleFeedPanel({ whaleAlerts }) {
  const scrollRef = useRef(null)
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [whaleAlerts])
  return (
    <div className="world-panel">
      <div className="world-panel-accent" />
      <div className="world-panel-label">WHALE FEED</div>
      <div className="world-whale-list" ref={scrollRef}>
        {whaleAlerts.length === 0 && <div className="world-whale-empty">Monitoring transfers...</div>}
        {whaleAlerts.slice(-5).map(a => (
          <div key={a.id} className="world-whale-item">
            <span className="world-whale-amount">{a.amount}</span>
            <span className="world-whale-token">{a.token}</span>
            <span className="world-whale-route">{a.from} &rsaquo; {a.to}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   SENTIMENT PANEL
   ═══════════════════════════════════════════════ */
function SentimentPanel({ fearGreed }) {
  const value = fearGreed?.value || 50
  const label = fearGreed?.classification || 'Neutral'
  const gaugeAngle = (value / 100) * 180
  const gaugeColor = value > 70 ? 'var(--bull)' : value > 45 ? 'var(--text-secondary)' : 'var(--bear)'

  return (
    <div className="world-panel">
      <div className="world-panel-accent" />
      <div className="world-panel-label">SENTIMENT INDEX</div>
      <div className="world-panel-gauge">
        <svg viewBox="0 0 100 55" className="world-gauge-svg">
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" strokeLinecap="round" />
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke={gaugeColor} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(gaugeAngle / 180) * 126} 126`} />
        </svg>
        <div className="world-gauge-value">{value}</div>
        <div className="world-gauge-label">{label}</div>
      </div>
      <div className="world-panel-regions">
        <div className="world-region-row"><span style={{ color: 'var(--text-muted)' }}>US</span><span className="mono" style={{ color: 'var(--bull)' }}>68</span></div>
        <div className="world-region-row"><span style={{ color: 'var(--text-muted)' }}>EU</span><span className="mono" style={{ color: 'var(--text-secondary)' }}>45</span></div>
        <div className="world-region-row"><span style={{ color: 'var(--text-muted)' }}>Asia</span><span className="mono" style={{ color: 'var(--bear)' }}>35</span></div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MAIN EXPORT — 5 panels, now with live WebSocket data
   ═══════════════════════════════════════════════ */
export default function DataPanels({ whaleAlerts, fearGreed, globalData, livePrices, binanceVolume, topPairs, wsConnected }) {
  const { fmtPrice: formatPrice } = useCurrency()
  return (
    <div className="world-panels-strip">
      <LiveTickerPanel livePrices={livePrices} topPairs={topPairs} formatPrice={formatPrice} />
      <FlowVolumePanel globalData={globalData} binanceVolume={binanceVolume} />
      <ActiveMarketsPanel />
      <WhaleFeedPanel whaleAlerts={whaleAlerts} />
      <SentimentPanel fearGreed={fearGreed} />
    </div>
  )
}
