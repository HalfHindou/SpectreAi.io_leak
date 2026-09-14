/**
 * BriefTabContent - Shared component for the AI Brief tab content.
 * Used in:
 *   1. WelcomePage horizontal Command Center
 *   2. CommandCenter sidebar
 *   3. WelcomePage full-view overlay
 *
 * Renders: rotating AI brief statements, price chips, bias chip, F&G/VIX chip,
 * audio player, dot navigation.
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import BriefAudioPlayer from '@/components/cinema/brief-audio-player'

const BriefTabContent = ({
  // Brief rotation state
  briefPausedRef,
  handleBriefTouchStart,
  handleBriefTouchEnd,
  briefDisplay,
  briefFading,
  terminalIsFullBrief,
  allBriefStatements,
  briefIndex,
  goToBrief,
  getTerminalBriefInterval,
  // Data
  topCoinPrices,
  stockPrices,
  macroAnalysisData,
  fearGreed,
  liveVix,
  // Market structure (for regime chip)
  marketStructureTrio,
  // Pre-computed colors
  sentimentRgb,
  biasRgb,
  // UI
  isStocks,
  // Share (mobile only — desktop has its own header share button)
  onShare,
  isSharing,
}) => {
  const { t } = useTranslation()
  const audioText = allBriefStatements.length >= 7
    ? allBriefStatements[allBriefStatements.length - 1]
    : briefDisplay

  return (
    <div className="cab-tab-content" style={{ '--sentiment-rgb': sentimentRgb }}>
      <div className="cab-tab-glow" />
      <div className="cab-tab-eyebrow">
        <div className="cab-tab-eyebrow-left">
          <span className="cab-tab-pulse" />
          <span className="cab-tab-label">{t('cinemaBrief.title')} <span className="cab-tab-label-section">- {[t('cinemaBrief.sentiment'), t('cinemaBrief.alerts'), t('cinemaBrief.session'), t('cinemaBrief.narrative'), t('cinemaBrief.psychology'), t('cinemaBrief.macro'), t('cinemaBrief.aiOutlook')][briefIndex] || ''}</span></span>
        </div>
        <div className="cab-tab-eyebrow-right">
          <BriefAudioPlayer
            showLabel
            briefText={audioText}
            sentimentRgb={sentimentRgb}
            isFullBrief={terminalIsFullBrief}
          />
          {onShare && (
            <button
              type="button"
              className="cab-tab-share"
              onClick={onShare}
              disabled={isSharing}
              aria-label={t('commandCenter.shareToX', 'Share to X')}
            >
              {isSharing ? (
                <span className="cab-tab-share-loading" aria-hidden="true" />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      <div
        className="cab-tab-statement-wrap"
        onTouchStart={(e) => { handleBriefTouchStart(e); e.stopPropagation() }}
        onTouchMove={(e) => { e.stopPropagation() }}
        onTouchEnd={(e) => { handleBriefTouchEnd(e); e.stopPropagation() }}
      >
        <blockquote className={`cab-tab-statement ${briefFading ? 'cab-tab-fading' : 'cab-tab-visible'}${terminalIsFullBrief ? ' cab-tab-statement-full' : ''}`}>
          {briefDisplay || t('common.loading')}
        </blockquote>
      </div>
      {allBriefStatements.length > 1 && (
        <div className="cab-tab-rotation-nav">
          {allBriefStatements.map((_, idx) => {
            const isOutlookDot = idx === allBriefStatements.length - 1 && allBriefStatements.length >= 7
            return (
            <button
              key={idx}
              className={`cab-tab-dot ${idx === briefIndex ? 'active' : ''}${isOutlookDot ? ' cab-tab-dot-full' : ''}`}
              onClick={() => goToBrief(idx)}
              title={[t('cinemaBrief.sentiment'), t('cinemaBrief.alerts'), t('cinemaBrief.session'), t('cinemaBrief.narrative'), t('cinemaBrief.psychology'), t('cinemaBrief.macro'), t('cinemaBrief.aiOutlook')][idx] || `Brief ${idx + 1}`}
              aria-label={[t('cinemaBrief.sentiment'), t('cinemaBrief.alerts'), t('cinemaBrief.session'), t('cinemaBrief.narrative'), t('cinemaBrief.psychology'), t('cinemaBrief.macro'), t('cinemaBrief.aiOutlook')][idx] || `Brief ${idx + 1}`}
              aria-current={idx === briefIndex ? 'true' : undefined}
              type="button"
            >
              <span className="cab-tab-dot-fill" />
              {idx === briefIndex && (
                // Key by briefIndex only — Date.now() in the key was forcing the SVG
                // (and its CSS countdown) to remount on every parent re-render
                // (price ticks, F&G updates, etc.), so the ring restarted from 0%
                // while the rotation setTimeout kept counting toward its original
                // deadline. Stable key keeps the animation in sync with the timer.
                <svg key={`ring-${briefIndex}`} className="cab-tab-dot-progress" viewBox="0 0 20 20">
                  <circle
                    cx="10" cy="10" r="8"
                    fill="none"
                    strokeWidth="1.5"
                    strokeDasharray="50.27"
                    strokeDashoffset="0"
                    className="cab-tab-dot-circle"
                    style={{ animation: `cabTabDotCountdown ${getTerminalBriefInterval(idx)}ms linear forwards` }}
                  />
                </svg>
              )}
            </button>
            )
          })}
        </div>
      )}
      <div className="cab-tab-divider" />
      <div className="cab-tab-chips">
        {/* F&G or VIX */}
        <div className="cab-tab-chip" style={{ '--chip-rgb': sentimentRgb }}>
          <span className="cab-tab-chip-label">{isStocks ? 'VIX' : t('welcome.fearGreed', 'FEAR & GREED')}</span>
          <span className="cab-tab-chip-value">{isStocks ? (liveVix?.price != null ? liveVix.price.toFixed(2) : '-') : (fearGreed?.value ?? '-')}</span>
          <span className="cab-tab-chip-sub">{isStocks ? (liveVix?.label || 'N/A') : (fearGreed?.classification || 'Neutral')}</span>
        </div>
        {/* Bias */}
        <div className="cab-tab-chip" style={{ '--chip-rgb': biasRgb }}>
          <span className="cab-tab-chip-label">{t('welcome.bias', 'BIAS')}</span>
          <span className="cab-tab-chip-value" style={{ color: `rgb(${biasRgb})` }}>
            {(macroAnalysisData?.bias || 'neutral').toUpperCase()}
          </span>
          <span className="cab-tab-chip-sub">{macroAnalysisData?.tfLabel || '24h'}</span>
        </div>
        {/* Regime — from ai_analyse endpoint */}
        {!isStocks && marketStructureTrio?.regime && marketStructureTrio.regime !== 'NEUTRAL' && (
          <div className="cab-tab-chip" style={{ '--chip-rgb': marketStructureTrio.regime === 'BULLISH' ? '48, 209, 88' : marketStructureTrio.regime === 'BEARISH' ? '255, 69, 58' : '142, 142, 147' }}>
            <span className="cab-tab-chip-label">{t('welcome.regime', 'REGIME')}</span>
            <span className="cab-tab-chip-value" style={{ color: `rgb(${marketStructureTrio.regime === 'BULLISH' ? '48, 209, 88' : marketStructureTrio.regime === 'BEARISH' ? '255, 69, 58' : '142, 142, 147'})` }}>
              {marketStructureTrio.regime}
            </span>
            <span className="cab-tab-chip-sub">{marketStructureTrio.state || ''}</span>
          </div>
        )}
        {/* BTC / ETH / SOL (crypto) or SPY / QQQ / AAPL (stocks) */}
        {(isStocks ? ['SPY', 'QQQ', 'AAPL'] : ['BTC', 'ETH', 'SOL']).map((sym) => {
          const d = isStocks ? stockPrices?.[sym] : topCoinPrices?.[sym]
          if (!d?.price) return null
          const ch = parseFloat(d.change) || 0
          return (
            <div key={sym} className="cab-tab-chip" style={{ '--chip-rgb': ch >= 0 ? '48, 209, 88' : '255, 69, 58' }}>
              <span className="cab-tab-chip-label">{sym}</span>
              <span className="cab-tab-chip-value">
                ${typeof d.price === 'number'
                  ? d.price.toLocaleString(undefined, { maximumFractionDigits: d.price < 10 ? 2 : 0 })
                  : parseFloat(d.price).toLocaleString(undefined, { maximumFractionDigits: parseFloat(d.price) < 10 ? 2 : 0 })
                }
              </span>
              <span className={`cab-tab-chip-change ${ch >= 0 ? 'pos' : 'neg'}`}>
                {ch >= 0 ? '+' : ''}{ch.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
      <div className="cab-tab-attribution">
        <span className="cab-tab-attr-name">{t('homePage.briefTabContent.brieftabcontent.spectreAi', "Spectre AI")}</span> <span className="cab-tab-attr-sep">&middot;</span> {terminalIsFullBrief ? t('cinemaBrief.aiOutlook') : t('cinemaBrief.justNow')}
      </div>
    </div>
  )
}

export default memo(BriefTabContent)
