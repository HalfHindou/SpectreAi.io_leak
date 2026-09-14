/**
 * RZ AI Sentiment Read — the LLM synthesis panel of the sentiment engine.
 *
 * Renders the structured read from /api/sentiment-read: an editorial thesis
 * pull-quote (Playfair, the research app's editorial voice), four analyst
 * blocks (crowd / quality / divergence / macro), risk flags + watch triggers,
 * and a stance + conviction footer. Numbers and $tickers are bolded (the
 * XDThesis pattern). Deterministic engine panels above stand on their own if
 * the read is unavailable — this panel renders an honest empty state, never
 * fake copy.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SpectreLoader from '@/components/spectre-loader'
import useSentimentRead from '@/hooks/useSentimentRead'
import './rz-sentiment-engine.css'

/* Bold $amounts, percentages and $TICKERs inside AI copy (XDThesis pattern) */
function boldenNumbers(text) {
  if (!text) return null
  const parts = String(text).split(/(\$[\d,.]+[BMKT]?|[+-]?\d+(?:\.\d+)?%|\$[A-Z]{2,10}\b|\b\d+(?:\.\d+)?x\b)/g)
  return parts.map((part, i) =>
    /^(\$[\d,.]+[BMKT]?|[+-]?\d+(?:\.\d+)?%|\$[A-Z]{2,10}|\d+(?:\.\d+)?x)$/.test(part)
      ? <strong key={i}>{part}</strong>
      : part
  )
}

const STANCE_META = {
  bullish: { label: 'Bullish', cls: 'bull' },
  bearish: { label: 'Bearish', cls: 'bear' },
  cautious: { label: 'Cautious', cls: 'warn' },
  neutral: { label: 'Neutral', cls: 'neutral' },
}

const BLOCKS = [
  { key: 'crowd_read', label: 'The Crowd' },
  { key: 'quality_read', label: 'Organic or Manufactured' },
  { key: 'divergence_read', label: 'Sentiment vs Price' },
  { key: 'macro_read', label: 'Macro Frame' },
]

const SHAPE_META = {
  'fresh-lows': { label: 'Fresh Lows', tone: 'bear' },
  'at-lows': { label: 'At the Lows', tone: 'warn' },
  basing: { label: 'Basing', tone: 'info' },
  rebounding: { label: 'Rebounding', tone: 'bull' },
}

const fmtPct = (v, digits = 1) => `${v > 0 ? '+' : ''}${Number(v).toFixed(digits)}%`
const pctTone = (v) => (v > 0 ? 'bull' : v < 0 ? 'bear' : 'neutral')

/* Deterministic timeframe strip — overall (vs ATH) next to the recent tape
   (24h / 7d / where price sits in the 30d range). These are the engine's own
   numbers, rendered directly; the prose below interprets them. */
function TimeframeStrip({ inputs }) {
  const { t } = useTranslation()
  if (!inputs) return null
  const st = inputs.structure
  const shape = st ? SHAPE_META[st.shapeKey] : null
  const cells = []
  if (inputs.pctFromAth != null) {
    cells.push(
      <div className="rz-sen-ai-tf-cell" key="ath">
        <span className="rz-sen-ai-tf-label">{t('researchPro.aiSentimentRead.timeframestrip.overall', "Overall")}</span>
        <span className="rz-sen-ai-tf-value mono rz-sen-ai-tf-value--bear">
          {Math.round(inputs.pctFromAth)}% vs ATH{inputs.athDate ? ` · ${String(inputs.athDate).slice(0, 7)}` : ''}
        </span>
      </div>
    )
  }
  if (inputs.change24h != null) {
    cells.push(
      <div className="rz-sen-ai-tf-cell" key="24h">
        <span className="rz-sen-ai-tf-label">24h</span>
        <span className={`rz-sen-ai-tf-value mono rz-sen-ai-tf-value--${pctTone(inputs.change24h)}`}>{fmtPct(inputs.change24h)}</span>
      </div>
    )
  }
  if (inputs.change7d != null) {
    cells.push(
      <div className="rz-sen-ai-tf-cell" key="7d">
        <span className="rz-sen-ai-tf-label">7d</span>
        <span className={`rz-sen-ai-tf-value mono rz-sen-ai-tf-value--${pctTone(inputs.change7d)}`}>{fmtPct(inputs.change7d)}</span>
      </div>
    )
  }
  if (st && shape) {
    cells.push(
      <div className="rz-sen-ai-tf-cell rz-sen-ai-tf-cell--shape" key="shape">
        <span className="rz-sen-ai-tf-label">30d Range</span>
        <span className="rz-sen-ai-tf-shape">
          <span className={`rz-sen-pill rz-sen-pill--${shape.tone}`}><span className="rz-sen-dot" />{shape.label}</span>
          <span className="rz-sen-ai-tf-detail mono">
            +{Math.max(0, st.pctAboveLow30).toFixed(st.pctAboveLow30 >= 10 ? 0 : 1)}% above 30d low · set {st.daysSinceLow30 === 0 ? 'today' : `${st.daysSinceLow30}d ago`}
          </span>
        </span>
      </div>
    )
  }
  if (!cells.length) return null
  return <div className="rz-sen-ai-tf">{cells}</div>
}

const RzAiSentimentRead = React.memo(function RzAiSentimentRead({ sym, cgId, dayMode }) {
  const { t } = useTranslation()
  const { read, loading, error, refetch } = useSentimentRead(sym, cgId)

  const generatedAgo = useMemo(() => {
    if (!read?.generatedAt) return null
    const mins = Math.max(0, Math.round((Date.now() - new Date(read.generatedAt).getTime()) / 60000))
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
  }, [read])

  if (loading && !read) {
    return (
      <div className={`rz-sen-ai rz-sen-ai--loading ${dayMode ? 'rz-sen--day' : ''}`}>
        <SpectreLoader variant="logo" size="md" label={t('researchPro.aiSentimentRead.rzaisentimentread.label', "Writing the desk read")} />
      </div>
    )
  }

  if (!read) {
    return (
      <div className={`rz-sen-ai ${dayMode ? 'rz-sen--day' : ''}`}>
        <div className="rz-sen-ai-empty">
          The desk read for ${sym} isn't available right now{error ? '' : ''} — the deterministic signals above still stand on their own.
        </div>
      </div>
    )
  }

  const stance = STANCE_META[read.stance] || STANCE_META.neutral

  return (
    <div className={`rz-sen-ai ${dayMode ? 'rz-sen--day' : ''}`}>
      <div className="rz-sen-ai-thesis">{boldenNumbers(read.thesis)}</div>

      <TimeframeStrip inputs={read.inputs} />

      {/* The fundamental spine — what the project IS, so the read is grounded in
          the project, not just the tape. */}
      {read.project_read && (
        <div className="rz-sen-ai-block rz-sen-ai-block--project">
          <span className="rz-sen-ai-block-label">{t('researchPro.aiSentimentRead.rzaisentimentread.theProject', "The Project")}</span>
          <p className="rz-sen-ai-block-text">{boldenNumbers(read.project_read)}</p>
        </div>
      )}

      <div className="rz-sen-ai-grid">
        {BLOCKS.map(({ key, label }) => (
          read[key] ? (
            <div className="rz-sen-ai-block" key={key}>
              <span className="rz-sen-ai-block-label">{label}</span>
              <p className="rz-sen-ai-block-text">{boldenNumbers(read[key])}</p>
            </div>
          ) : null
        ))}
      </div>

      {/* The investor verdict — bull vs bear + the asymmetry read. */}
      {read.investor_take && (
        <div className="rz-sen-ai-block rz-sen-ai-block--take">
          <span className="rz-sen-ai-block-label">Investor Take — Bull vs Bear</span>
          <p className="rz-sen-ai-block-text">{boldenNumbers(read.investor_take)}</p>
        </div>
      )}

      {(read.risk_flags?.length > 0 || read.watch_for?.length > 0) && (
        <div className="rz-sen-ai-lists">
          {read.risk_flags?.length > 0 && (
            <div className="rz-sen-ai-block">
              <span className="rz-sen-ai-block-label">{t('researchPro.aiSentimentRead.rzaisentimentread.riskFlags', "Risk Flags")}</span>
              <ul className="rz-sen-ai-list rz-sen-ai-list--risk">
                {read.risk_flags.map((f, i) => <li key={i}>{boldenNumbers(f)}</li>)}
              </ul>
            </div>
          )}
          {read.watch_for?.length > 0 && (
            <div className="rz-sen-ai-block">
              <span className="rz-sen-ai-block-label">{t('researchPro.aiSentimentRead.rzaisentimentread.whatChangesThisRead', "What Changes This Read")}</span>
              <ul className="rz-sen-ai-list rz-sen-ai-list--watch">
                {read.watch_for.map((f, i) => <li key={i}>{boldenNumbers(f)}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rz-sen-ai-foot">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className={`rz-sen-pill rz-sen-pill--${stance.cls === 'neutral' ? 'neutral' : stance.cls}`}>
            <span className="rz-sen-dot" />{stance.label}
          </span>
          {Number.isFinite(read.conviction) && (
            <span className="rz-sen-ai-conviction">
              {t('researchPro.aiSentimentRead.rzaisentimentread.conviction', "Conviction")}
              <span className="bar"><i style={{ width: `${read.conviction}%` }} /></span>
              <span className="mono">{read.conviction}</span>
            </span>
          )}
        </div>
        <div className="rz-sen-ai-meta">
          {generatedAgo && <span>Generated {generatedAgo}</span>}
          <button
            type="button"
            onClick={refetch}
            style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {t('researchPro.aiSentimentRead.rzaisentimentread.refresh', "Refresh")}
          </button>
        </div>
      </div>
    </div>
  )
})

export default RzAiSentimentRead
