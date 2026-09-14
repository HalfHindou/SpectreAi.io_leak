/**
 * SearchHero — the top-of-page input + query echo + classification meta.
 *
 * Replaces the editorial "bitcoin." Playfair headline + separate meta strip
 * + separate full-width quick/deep toggle row. All three are folded here
 * because they're the same thing visually: "what was asked, how Spectre is
 * answering it, change the question to try again".
 *
 * Render scope: re-renders on stream.status + stream.meta changes (rare),
 * plus on every keystroke (controlled input). Cheap component.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import './search-hero.css'

// Classification keys — labels are looked up via t() at render time so
// language changes propagate without remount. EN defaults preserve the
// pre-i18n labels.
const CLASSIFICATION_KEYS = [
  'ASSET_ANALYSIS', 'DUE_DILIGENCE', 'COMPARISON', 'MARKET_OVERVIEW',
  'DERIVATIVES', 'WHALE_TRACKING', 'ONCHAIN', 'NEWS',
  'DISCOVERY', 'MOVERS', 'DEFI', 'STABLECOINS',
  'MACRO', 'MINDSHARE', 'MEME_ALPHA', 'NFT',
  'WALLET_LOOKUP', 'GENERAL',
]
const CLASSIFICATION_EN = {
  ASSET_ANALYSIS: 'Asset Analysis',
  DUE_DILIGENCE: 'Due Diligence',
  COMPARISON: 'Comparison',
  MARKET_OVERVIEW: 'Market Overview',
  DERIVATIVES: 'Derivatives',
  WHALE_TRACKING: 'Whale Tracking',
  ONCHAIN: 'On-Chain',
  NEWS: 'News',
  DISCOVERY: 'Discovery',
  MOVERS: 'Movers',
  DEFI: 'DeFi',
  STABLECOINS: 'Stablecoins',
  MACRO: 'Macro',
  MINDSHARE: 'Mindshare',
  MEME_ALPHA: 'Memes',
  NFT: 'NFT',
  WALLET_LOOKUP: 'Wallet',
  GENERAL: 'General',
}

function formatMs(ms, t) {
  if (ms == null) return null
  // Use locale-aware numeric formatting so RU/AR render correct decimal sep.
  if (ms < 1000) {
    const n = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(ms)
    return t('searchEngineV2.hero.timing.ms', '{{value}}ms', { value: n })
  }
  const n = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(ms / 1000)
  return t('searchEngineV2.hero.timing.s', '{{value}}s', { value: n })
}

export default function SearchHero({
  query,
  meta,
  status,
  done,
  mode,
  inputValue,
  onInputChange,
  onSubmit,
  onModeChange,
  inputRef,
}) {
  const { t } = useTranslation()
  const [showEndpoints, setShowEndpoints] = useState(false)

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit(e.metaKey || e.ctrlKey ? 'deep' : null)
    }
  }, [onSubmit])

  const classification = meta?.classification
  const assets = meta?.assets || []
  const endpointCount = meta?.endpoints_planned
  const responseMs = done?.response_time_ms
  const isStreaming = status === 'loading' || status === 'streaming'
  const isIdle = status === 'idle' || !query

  // Resolve classification label through translations; fall back to the raw
  // value if a brand-new classification ships before its key is added.
  const classificationLabel = useMemo(() => {
    if (!classification) return null
    const enDefault = CLASSIFICATION_EN[classification] || classification
    return CLASSIFICATION_KEYS.includes(classification)
      ? t(`searchEngineV2.hero.classification.${classification}`, enDefault)
      : classification
  }, [classification, t])

  const deepTitle = t(
    'searchEngineV2.hero.mode.deepTitle',
    'Deep Search — fans out 14 endpoints + thesis brief (~5–15s)'
  )
  const quickTitle = t(
    'searchEngineV2.hero.mode.quickTitle',
    'Quick Intel — 4 endpoints, tight answer (~2–3s)'
  )
  const deepLabel = t('searchEngineV2.hero.mode.deep', 'Deep')
  const quickLabel = t('searchEngineV2.hero.mode.quick', 'Quick')

  return (
    <div className="se2-hero">
      {/* ── Input row ───────────────────────────────────────────────── */}
      <div className="se2-hero-input-row">
        <div className="se2-hero-input-glass">
          <svg viewBox="0 0 20 20" className="se2-hero-input-icon" aria-hidden="true">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="m14 14 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="se2-hero-input"
            value={inputValue}
            placeholder={t('searchEngineV2.hero.placeholder', 'Ask anything about crypto markets…')}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck="false"
            aria-label={t('searchEngineV2.hero.inputAria', 'Search Spectre')}
          />
          <div className="se2-hero-input-chips">
            <button
              type="button"
              className={`se2-hero-mode-chip ${mode === 'deep' ? 'is-deep' : 'is-quick'}`}
              onClick={() => onModeChange(mode === 'deep' ? 'quick' : 'deep')}
              title={mode === 'deep' ? deepTitle : quickTitle}
            >
              {mode === 'deep' ? deepLabel : quickLabel}
            </button>
            <button
              type="button"
              className="se2-hero-submit"
              onClick={() => onSubmit(null)}
              disabled={!inputValue.trim()}
              aria-label={t('searchEngineV2.hero.submitAria', 'Search')}
            >
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                <path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <kbd className="se2-hero-shortcut">/</kbd>
      </div>

      {/* ── Query echo + intent rail (only when there's a query) ────── */}
      {!isIdle && (
        <div className="se2-hero-meta">
          <div className="se2-hero-query-echo">{query}</div>

          <div className="se2-hero-intent-rail" data-status={status}>
            {/* Asset pills */}
            {assets.length > 0 && (
              <div className="se2-hero-assets">
                {assets.map((sym) => (
                  <span key={sym} className="se2-hero-asset-pill">
                    <span className="se2-hero-asset-dot" />
                    {sym}
                  </span>
                ))}
              </div>
            )}

            {classification && (
              <span className="se2-hero-divider" aria-hidden="true">·</span>
            )}

            {/* Classification */}
            {classification && (
              <span className="se2-hero-classification">
                {classificationLabel}
              </span>
            )}

            {/* Endpoint count + hover popover */}
            {endpointCount != null && (
              <>
                <span className="se2-hero-divider" aria-hidden="true">·</span>
                <button
                  type="button"
                  className="se2-hero-endpoint-counter"
                  onMouseEnter={() => setShowEndpoints(true)}
                  onMouseLeave={() => setShowEndpoints(false)}
                  onFocus={() => setShowEndpoints(true)}
                  onBlur={() => setShowEndpoints(false)}
                  aria-expanded={showEndpoints}
                >
                  {/* Pluralization is handled by i18next — passing `count` lets
                      locales like RU use one/few/many. */}
                  {t('searchEngineV2.hero.endpointCount', {
                    defaultValue: '{{count}} endpoint',
                    defaultValue_other: '{{count}} endpoints',
                    count: endpointCount,
                  })}
                  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1" />
                    <path d="M8 5v.01M8 7v4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {showEndpoints && (
                    <span className="se2-hero-endpoint-popover" role="tooltip">
                      <span className="se2-hero-endpoint-popover-title">
                        {t('searchEngineV2.hero.endpointPopover.title', 'Planned endpoints')}
                      </span>
                      {/* The full endpoint list streams via meta + citations.
                          For now we show endpoint count summary; full list
                          renders inside CitationsBar once the data lands. */}
                      <span className="se2-hero-endpoint-popover-body">
                        {t(
                          'searchEngineV2.hero.endpointPopover.body',
                          'Live sources: hover the citation bar below for path, latency, and status per endpoint.'
                        )}
                      </span>
                    </span>
                  )}
                </button>
              </>
            )}

            {/* Mode */}
            <span className="se2-hero-divider" aria-hidden="true">·</span>
            <span className="se2-hero-mode-label">
              {mode === 'deep' ? deepLabel : quickLabel}
            </span>

            {/* Response time */}
            {responseMs != null && (
              <>
                <span className="se2-hero-divider" aria-hidden="true">·</span>
                <span className={`se2-hero-timing ${responseMs > 5000 ? 'is-slow' : ''}`}>
                  {formatMs(responseMs, t)}
                </span>
              </>
            )}

            {/* Streaming pulse */}
            {isStreaming && (
              <span
                className="se2-hero-streaming-dot"
                title={t('searchEngineV2.hero.streamingTitle', 'Streaming')}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
