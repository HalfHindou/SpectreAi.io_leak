/**
 * CinemaAIBrief - Full-width cinematic intelligence statement
 *
 * "The Brief" - Rotating AI conviction statements with smooth transitions.
 * Cycles through multiple market-aware briefs (12s each) + a comprehensive
 * AI Outlook brief as the 6th slide (30s display time).
 * Positioned between Hero and Command Center in cinema mode.
 */

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import BriefAudioPlayer from './brief-audio-player'

const ROTATION_INTERVAL = 12000 // 12 seconds per normal brief
const FULL_BRIEF_INTERVAL = 30000 // 30 seconds for the full AI Outlook brief
const FADE_DURATION = 600 // ms for fade transition

const CinemaAIBrief = React.memo(({
  dayMode,
  marketMode,
  theBriefStatement,
  theBriefStatements,
  macroAnalysisData,
  topCoinPrices,
  fearGreed,
  stockPrices,
  liveVix,
}) => {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  const isStocks = marketMode === 'stocks'
  const statements = theBriefStatements?.length > 0 ? theBriefStatements : (theBriefStatement ? [theBriefStatement] : [])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [displayText, setDisplayText] = useState(statements[0] || '')
  const timerRef = useRef(null)
  const isPaused = useRef(false)
  const scheduleNextRef = useRef(null)

  // Ref to hold the latest statements — used by rotateToNext so it stays stable
  // and doesn't cause the scheduling timer to reset on every parent re-render.
  const statementsRef = useRef(statements)
  statementsRef.current = statements

  // Detect full brief: 7th slide (index 6) when we have 7 statements
  const isFullBrief = activeIndex === statements.length - 1 && statements.length >= 7

  // Get the correct interval for the current slide
  const getIntervalForIndex = useCallback((idx) => {
    if (idx === statements.length - 1 && statements.length >= 7) return FULL_BRIEF_INTERVAL
    return ROTATION_INTERVAL
  }, [statements.length])

  // Reset index when number of statements changes
  useEffect(() => {
    setActiveIndex(0)
    setDisplayText(statements[0] || '')
  }, [statements.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync displayText when current statement content changes (e.g. language switch)
  useEffect(() => {
    if (statements[activeIndex] && statements[activeIndex] !== displayText) {
      setDisplayText(statements[activeIndex])
    }
  }, [statements, activeIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rotation logic — reads statements from ref so this callback is stable
  // and doesn't cause the scheduling timer to reset on every parent re-render.
  const rotateToNext = useCallback(() => {
    const stmts = statementsRef.current
    if (stmts.length <= 1) return
    setIsTransitioning(true)
    setTimeout(() => {
      setActiveIndex(prev => {
        const stmtsNow = statementsRef.current
        const next = (prev + 1) % stmtsNow.length
        setDisplayText(stmtsNow[next])
        return next
      })
      setTimeout(() => setIsTransitioning(false), 50)
    }, FADE_DURATION)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-rotate timer - uses setTimeout chains for dynamic per-slide timing
  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (statements.length <= 1) return

    timerRef.current = setTimeout(() => {
      if (!isPaused.current) {
        rotateToNext()
      }
      // Use ref to always call the LATEST scheduleNext, avoiding stale closures
      setTimeout(() => { if (scheduleNextRef.current) scheduleNextRef.current() }, FADE_DURATION + 100)
    }, getIntervalForIndex(activeIndex))
  }, [activeIndex, statements.length, rotateToNext, getIntervalForIndex])
  // Keep ref in sync so recursive setTimeout always uses the latest version
  scheduleNextRef.current = scheduleNext

  useEffect(() => {
    scheduleNext()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [scheduleNext])

  // Manual navigation
  const goToIndex = useCallback((idx) => {
    if (idx === activeIndex || isTransitioning) return
    // Cancel pending auto-rotate timer so it doesn't override manual nav
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setIsTransitioning(true)
    setTimeout(() => {
      setActiveIndex(idx)
      setDisplayText(statements[idx])
      setTimeout(() => setIsTransitioning(false), 50)
    }, FADE_DURATION)
  }, [activeIndex, isTransitioning, statements])

  // ── Touch swipe support ──
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isPaused.current = true
  }, [])
  const handleTouchEnd = useCallback((e) => {
    if (touchStartX.current == null || statements.length <= 1) {
      isPaused.current = false
      return
    }
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    isPaused.current = false
    // Only trigger on horizontal swipes (not vertical scrolls)
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) {
        // Swipe left → next
        const next = (activeIndex + 1) % statements.length
        goToIndex(next)
      } else {
        // Swipe right → previous
        const prev = (activeIndex - 1 + statements.length) % statements.length
        goToIndex(prev)
      }
    }
  }, [activeIndex, statements.length, goToIndex])

  // Derive sentiment color from VIX (stocks) or Fear & Greed (crypto)
  // Apple system colors: green #30D158 · red #FF453A · grey #8E8E93
  const sentimentRgb = isStocks
    ? (() => {
      const v = liveVix?.price
      if (v != null && v >= 25) return '255, 69, 58'
      if (v != null && v <= 15) return '48, 209, 88'
      return '142, 142, 147'
    })()
    : (() => {
      const fng = fearGreed?.value
      return fng >= 65 ? '48, 209, 88' : fng <= 35 ? '255, 69, 58' : '142, 142, 147'
    })()

  const bias = macroAnalysisData?.bias || 'neutral'
  const biasRgb = bias === 'bullish'
    ? '48, 209, 88'
    : bias === 'bearish'
      ? '255, 69, 58'
      : '142, 142, 147'

  // Format current time
  const timestamp = useMemo(() => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [displayText]) // re-compute when brief updates

  if (!displayText && !theBriefStatement) return null

  // Brief type labels for the dots (6 standard + AI Outlook)
  const briefLabels = [t('cinemaBrief.sentiment'), t('cinemaBrief.alerts'), t('cinemaBrief.session'), t('cinemaBrief.narrative'), t('cinemaBrief.psychology'), t('cinemaBrief.macro'), t('cinemaBrief.aiOutlook')]

  // Current slide's display interval (for progress circle animation)
  const currentInterval = getIntervalForIndex(activeIndex)

  return (
    <section
      className="cab-container"
      style={{ '--sentiment-rgb': sentimentRgb }}
      onMouseEnter={() => { isPaused.current = true }}
      onMouseLeave={() => { isPaused.current = false }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Ambient glow background */}
      <div className="cab-glow" />

      {/* Eyebrow - label + live badge */}
      <div className="cab-eyebrow">
        <div className="cab-eyebrow-left">
          <span className="cab-pulse" />
          <span className="cab-label">{t('cinemaBrief.title')} <span className="cab-label-section">- {briefLabels[activeIndex] || ''}</span></span>
        </div>
        <div className="cab-eyebrow-right">
          <span className="cab-live-badge">Listen</span>
          <BriefAudioPlayer briefText={displayText} sentimentRgb={sentimentRgb} isFullBrief={isFullBrief} />
          <span className="cab-timestamp">{timestamp}</span>
        </div>
      </div>

      {/* The Statement - hero conviction text with fade transition */}
      <blockquote
        className={`cab-statement ${isTransitioning ? 'cab-statement-fading' : 'cab-statement-visible'}${isFullBrief ? ' cab-statement-full' : ''}`}
      >
        <span className="cab-quote-mark">&ldquo;</span>
        {displayText}
        <span className="cab-quote-mark">&rdquo;</span>
      </blockquote>

      {/* Rotation indicator dots */}
      {statements.length > 1 && (
        <div className="cab-rotation-nav">
          {statements.map((_, idx) => {
            const isOutlookDot = idx === statements.length - 1 && statements.length >= 7
            return (
              <button
                key={idx}
                className={`cab-rotation-dot ${idx === activeIndex ? 'active' : ''}${isOutlookDot ? ' cab-rotation-dot-full' : ''}`}
                onClick={() => goToIndex(idx)}
                title={briefLabels[idx] || `Brief ${idx + 1}`}
              >
                <span className="cab-dot-fill" />
                {idx === activeIndex && (
                  <svg className="cab-dot-progress" viewBox="0 0 20 20">
                    <circle
                      cx="10" cy="10" r="8"
                      fill="none"
                      stroke={`rgb(${sentimentRgb})`}
                      strokeWidth="2"
                      strokeDasharray="50.27"
                      strokeDashoffset="0"
                      className="cab-dot-progress-circle"
                      style={{ animationDuration: `${currentInterval}ms` }}
                    />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Attribution */}
      <div className="cab-attribution">
        <span className="cab-attribution-dash">&mdash;</span>
        <span className="cab-attribution-name">Spectre AI</span>
        <span className="cab-attribution-dot">&middot;</span>
        <span className="cab-attribution-time">{isFullBrief ? t('cinemaBrief.aiOutlook') : t('cinemaBrief.justNow')}</span>
      </div>

      {/* Metric chips row */}
      <div className="cab-metrics">
        {/* VIX (stocks) or Fear & Greed (crypto) chip */}
        <div className="cab-metric-chip" style={{ '--chip-rgb': sentimentRgb }}>
          <span className="cab-metric-label">{isStocks ? 'VIX' : t('cinemaBar.fearGreed')}</span>
          <span className="cab-metric-value">{isStocks ? (liveVix?.price != null ? liveVix.price.toFixed(2) : '-') : (fearGreed?.value ?? '-')}</span>
          <span className="cab-metric-sublabel">{isStocks ? (liveVix?.label || 'N/A') : (fearGreed?.classification || 'Neutral')}</span>
        </div>

        {/* Market Bias chip */}
        <div className="cab-metric-chip" style={{ '--chip-rgb': biasRgb }}>
          <span className="cab-metric-label">{t('cinemaBrief.bias')}</span>
          <span className="cab-metric-value" style={{ color: `rgb(${biasRgb})` }}>
            {bias.toUpperCase()}
          </span>
          <span className="cab-metric-sublabel">{macroAnalysisData?.tfLabel || '24h'}</span>
        </div>

        {/* Asset mini-stats: stocks (SPY/QQQ/AAPL) or crypto (BTC/ETH/SOL) */}
        {(isStocks ? ['SPY', 'QQQ', 'AAPL'] : ['BTC', 'ETH', 'SOL']).map((sym) => {
          const data = isStocks ? stockPrices?.[sym] : topCoinPrices?.[sym]
          if (!data?.price) return null
          const ch = parseFloat(data.change) || 0
          const chipRgb = ch >= 0 ? '48, 209, 88' : '255, 69, 58'
          return (
            <div key={sym} className="cab-metric-chip" style={{ '--chip-rgb': chipRgb }}>
              <span className="cab-metric-label">{sym}</span>
              <span className="cab-metric-value">
                {fmtPrice(typeof data.price === 'number' ? data.price : parseFloat(data.price))}
              </span>
              <span className={`cab-metric-change ${ch >= 0 ? 'positive' : 'negative'}`}>
                {ch >= 0 ? '+' : ''}{ch.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
})

CinemaAIBrief.displayName = 'CinemaAIBrief'

export default CinemaAIBrief
