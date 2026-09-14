/**
 * CitationsBar — rich evidence cards.
 *
 * Replaces v1's flat pill row at the bottom of the answer. Each citation
 * gets its own card with: number chip, endpoint icon, human-readable label,
 * monospace path, one-line description, latency badge color-graded.
 *
 * Cards listen for `se2-citation-pulse` events fired by AnswerStream when
 * an inline `[n]` chip is clicked — they pulse an inset glow that decays
 * over 1200ms.
 */
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { endpointLabel, slotDescription, latencyTone } from '../lib/format-citation'
import './citations-bar.css'

function CitationCard({ citation, t }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = () => {
      el.classList.remove('is-pulsing')
      // Force reflow so the next class re-add restarts the animation
      void el.offsetWidth
      el.classList.add('is-pulsing')
    }
    el.addEventListener('se2-citation-pulse', handler)
    return () => el.removeEventListener('se2-citation-pulse', handler)
  }, [])

  const label = endpointLabel(citation.endpoint)
  const description = slotDescription(citation.label || citation.endpoint?.split('/').pop() || '')
  const tone = latencyTone(citation.latency_ms)

  return (
    <div
      ref={ref}
      id={`se2-citation-${citation.id}`}
      className="se2-citation-card"
    >
      <div className="se2-citation-head">
        <span className="se2-citation-num">{citation.id}</span>
        <span className="se2-citation-icon" aria-hidden="true">
          {/* Spectre internal endpoints get a lightning glyph; external ones
              would render a favicon (none right now — every citation is
              Spectre-first-party). */}
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M9 1L2 9.5h4.5L7 15l7-8.5H9.5L9 1z" fill="currentColor" />
          </svg>
        </span>
        <span className="se2-citation-label">{label}</span>
      </div>
      <div className="se2-citation-path">{citation.endpoint}</div>
      <div className="se2-citation-description">{description}</div>
      <div className="se2-citation-foot">
        <span className="se2-citation-divider" aria-hidden="true" />
        <span className={`se2-citation-latency tone-${tone}`}>
          {citation.latency_ms != null
            ? t('searchEngineV2.citations.latencyMs', '{{value}}ms', {
                value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(citation.latency_ms),
              })
            : '—'}
        </span>
      </div>
    </div>
  )
}

function CitationsBar({ stream }) {
  const { t } = useTranslation()
  const citations = stream.citations || []
  if (!citations.length) return null

  return (
    <section className="se2-citations-section">
      <header className="se2-citations-header">
        <h3 className="se2-citations-title">{t('searchEngineV2.citations.title', 'SOURCES')}</h3>
        <span className="se2-citations-count">{citations.length}</span>
      </header>
      <div className="se2-citations-grid">
        {citations.map((c) => <CitationCard key={c.id} citation={c} t={t} />)}
      </div>
    </section>
  )
}

export default memo(CitationsBar, (prev, next) => (
  prev.stream.citations === next.stream.citations
))
