/**
 * YouMacroSignals — AI-derived macro signal dashboard.
 * Shows market bias, asset signals, Fear & Greed, conviction, and summary.
 *
 * Real data: fetches Fear & Greed index from /api/fear-greed/current.
 * Maps F&G value to bias: >65 = bullish, <35 = bearish, else neutral.
 * Auto-refreshes every 5 minutes.
 *
 * Remix modes: full (default), gauge, signals
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getFearGreedCurrent } from '@/services/fearGreedApi'

// Empty initial state — no canned "Strong Buy BTC" flashing on mount.
// The fetch resolves in <1s; we render dashes / null briefly instead of
// fabricated signals that would be wrong half the time.
const EMPTY_MACRO = {
  bias: 'neutral',
  biasScore: 0,
  conviction: 0,
  volatility: 'low',
  signals: [],
  fng: null,
  fngLabel: '—',
}

// Derive a short narrative from the live F&G value rather than shipping a
// hardcoded "ETF inflows accelerating" paragraph that's wrong on bearish days.
function deriveSummary(fng) {
  if (fng == null) return null
  if (fng >= 75) return 'Extreme greed — historically a contrarian signal. Consider trimming risk.'
  if (fng >= 55) return 'Risk-on tone. Watch flows, momentum, and macro catalysts for confirmation.'
  if (fng >= 45) return 'Mixed positioning. Range-bound bias until a clear catalyst lands.'
  if (fng >= 25) return 'Risk-off tone. Defensive positioning warranted; watch for capitulation lows.'
  return 'Extreme fear — historically a contrarian buy signal. Size risk thoughtfully.'
}

const REFRESH_INTERVAL = 5 * 60 * 1000
const REMIX_MODES = ['full', 'gauge', 'signals']
const STORAGE_KEY = 'spectre:you-remix-you-macro-signals'

function deriveBias(fng) {
  if (fng > 65) return { bias: 'bullish', color: 'var(--bull)', glow: 'rgba(16,185,129,0.4)' }
  if (fng < 35) return { bias: 'bearish', color: 'var(--bear)', glow: 'rgba(239,68,68,0.4)' }
  return { bias: 'neutral', color: 'var(--text-muted)', glow: 'rgba(255,255,255,0.1)' }
}

function deriveFngLabel(fng) {
  if (fng >= 75) return 'Extreme Greed'
  if (fng >= 55) return 'Greed'
  if (fng >= 45) return 'Neutral'
  if (fng >= 25) return 'Fear'
  return 'Extreme Fear'
}

function deriveSignals(fng) {
  if (fng > 65) {
    return [
      { asset: 'BTC', signal: 'Strong Buy', color: 'var(--bull)' },
      { asset: 'ETH', signal: 'Buy', color: 'var(--bull)' },
      { asset: 'SOL', signal: fng > 75 ? 'Buy' : 'Hold', color: fng > 75 ? 'var(--bull)' : 'var(--text-muted)' },
    ]
  }
  if (fng < 35) {
    return [
      { asset: 'BTC', signal: fng < 25 ? 'Strong Sell' : 'Sell', color: 'var(--bear)' },
      { asset: 'ETH', signal: 'Sell', color: 'var(--bear)' },
      { asset: 'SOL', signal: 'Sell', color: 'var(--bear)' },
    ]
  }
  return [
    { asset: 'BTC', signal: 'Hold', color: 'var(--text-muted)' },
    { asset: 'ETH', signal: 'Hold', color: 'var(--text-muted)' },
    { asset: 'SOL', signal: 'Hold', color: 'var(--text-muted)' },
  ]
}

export default function YouMacroSignals() {
  const [macro, setMacro] = useState(EMPTY_MACRO)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'full' } catch { return 'full' }
  })
  const timerRef = useRef(null)

  const cycleRemix = () => {
    const next = REMIX_MODES[(REMIX_MODES.indexOf(remix) + 1) % REMIX_MODES.length]
    setRemix(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }

  const fetchData = useCallback(async () => {
    try {
      const data = await getFearGreedCurrent()
      // data shape: { value: number, value_classification: string, ... }
      // or possibly wrapped: { data: [{ value, value_classification }] }
      let fng = null
      let fngLabel = null

      if (data && typeof data.value === 'number') {
        fng = data.value
        fngLabel = data.value_classification || deriveFngLabel(fng)
      } else if (data?.data?.[0]?.value != null) {
        fng = Number(data.data[0].value)
        fngLabel = data.data[0].value_classification || deriveFngLabel(fng)
      } else if (typeof data === 'number') {
        fng = data
        fngLabel = deriveFngLabel(fng)
      }

      if (fng != null && !isNaN(fng)) {
        const { bias } = deriveBias(fng)
        const signals = deriveSignals(fng)
        const conviction = Math.min(100, Math.abs(fng - 50) * 2)
        const volatility = fng > 75 || fng < 25 ? 'high' : fng > 60 || fng < 40 ? 'moderate' : 'low'

        setMacro(prev => ({
          ...prev,
          bias,
          biasScore: fng,
          conviction,
          volatility,
          signals,
          fng,
          fngLabel: fngLabel || deriveFngLabel(fng),
          summary: deriveSummary(fng),
        }))
      }
    } catch {
      // keep mock data
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useAdaptivePolling(fetchData, { interval: REFRESH_INTERVAL })

  const biasColors = {
    bullish: 'var(--bull)',
    bearish: 'var(--bear)',
    neutral: 'var(--text-muted)',
  }

  const biasGlows = {
    bullish: 'rgba(16,185,129,0.4)',
    bearish: 'rgba(239,68,68,0.4)',
    neutral: 'rgba(255,255,255,0.1)',
  }

  // ── Gauge Mode ──
  if (remix === 'gauge') {
    const angle = (macro.fng / 100) * 180 - 90 // -90 to 90 degrees
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>

        {/* Semicircle gauge */}
        <div style={{ position: 'relative', width: 140, height: 75, overflow: 'hidden' }}>
          {/* Background arc */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: `conic-gradient(from 180deg, var(--bear) 0deg, #facc15 90deg, var(--bull) 180deg, transparent 180deg)`,
            opacity: 0.2,
          }} />
          {/* Needle */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            width: 2,
            height: 60,
            background: biasColors[macro.bias],
            borderRadius: 1,
            transformOrigin: 'bottom center',
            transform: `translateX(-50%) rotate(${angle}deg)`,
            transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: `0 0 8px ${biasGlows[macro.bias]}`,
          }} />
          {/* Center dot */}
          <div style={{
            position: 'absolute',
            bottom: -4,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: biasColors[macro.bias],
          }} />
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: biasColors[macro.bias] }}>
          {macro.fng}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {macro.fngLabel}
        </div>
      </div>
    )
  }

  // ── Signals Mode ──
  if (remix === 'signals') {
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>

        {/* Bias strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: biasColors[macro.bias], boxShadow: `0 0 6px ${biasGlows[macro.bias]}` }} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: biasColors[macro.bias], textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {macro.bias}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            F&G {macro.fng}
          </span>
        </div>

        {/* Signal grid */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6, alignContent: 'start' }}>
          {macro.signals.map(s => (
            <div key={s.asset} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 8,
              padding: '8px 10px',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {s.asset}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                padding: '2px 8px',
                borderRadius: 20,
                background: s.color === 'var(--bull)' ? 'rgba(16,185,129,0.15)' : s.color === 'var(--bear)' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: s.color,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}>
                {s.signal}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Full Mode (default) ──
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      height: '100%',
      padding: '2px 0',
      position: 'relative',
    }}>
      <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>

      {/* Bias indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: biasColors[macro.bias],
          boxShadow: `0 0 8px ${biasGlows[macro.bias]}`,
        }} />
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 700,
          color: biasColors[macro.bias],
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {macro.bias}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
          marginLeft: 'auto',
        }}>
          Score {macro.biasScore}/100
        </span>
      </div>

      {/* Metrics row */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'Fear & Greed', value: macro.fng, sub: macro.fngLabel, color: macro.fng >= 55 ? '#84CC16' : macro.fng <= 45 ? '#EF4444' : '#FACC15' },
          { label: 'Conviction', value: `${macro.conviction}%`, sub: null, color: 'var(--text-primary)' },
          { label: 'Volatility', value: macro.volatility, sub: null, color: macro.volatility === 'high' ? '#EF4444' : macro.volatility === 'moderate' ? '#FACC15' : '#84CC16' },
        ].map((m) => (
          <div key={m.label} style={{
            flex: 1,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 8,
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {m.label}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: m.color, textTransform: 'capitalize' }}>
              {m.value}
            </span>
            {m.sub && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>
                {m.sub}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Asset signal chips */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {macro.signals.map((s) => (
          <div key={s.asset} style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 8,
            padding: '6px 10px',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
              {s.asset}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              padding: '2px 8px',
              borderRadius: 20,
              background: s.color === 'var(--bull)' ? 'rgba(16,185,129,0.15)' : s.color === 'var(--bear)' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
              color: s.color,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}>
              {s.signal}
            </span>
          </div>
        ))}
      </div>

      {/* Summary — derived from live F&G, only renders once fetch lands */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {macro.summary && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {macro.summary}
          </div>
        )}
      </div>

      {/* AI attribution */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        opacity: 0.6,
        flexShrink: 0,
      }}>
        Spectre AI Analysis
      </div>
    </div>
  )
}
