/**
 * MediaSynthesis — a fast AI "TL;DR" for a video or podcast, synthesized from the
 * content's own description / show-notes (no transcript scraping). On-demand:
 * one tap loads a TL;DR + key points + why-it-matters. Reusable in the theater
 * (videos) and the podcast dock (podcasts).
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getSynthesis } from '@/services/mediaApi'
import './media-synthesis.css'

const Spark = () => (
  // Minimal "synthesis" mark — three converging strokes, not a robot/brain.
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const MediaSynthesis = ({ kind = 'video', id, title = '', source = '', variant = 'panel', autoLoad = false, dayMode = false }) => {
  const { t } = useTranslation()
  const [state, setState] = useState('idle') // idle | loading | done | empty | error
  const [summary, setSummary] = useState(null)

  const run = useCallback(async () => {
    if (!id) return
    setState('loading')
    const res = await getSynthesis({ kind, id, title, source })
    if (res?.summary?.tldr) { setSummary(res.summary); setState('done') }
    else setState(res?.reason === 'insufficient-source' ? 'empty' : 'error')
  }, [id, kind, title, source])

  // Reset when the underlying content changes
  useEffect(() => { setState('idle'); setSummary(null) }, [id, kind])
  useEffect(() => { if (autoLoad && id && state === 'idle') run() }, [autoLoad, id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cls = `mcx-syn mcx-syn--${variant}${dayMode ? ' day-mode' : ''}`

  if (state === 'idle') {
    return (
      <div className={cls}>
        <button type="button" className="mcx-syn-trigger" onClick={run}>
          <Spark />
          <span>{t('mediaCenter.synthesis.cta')}</span>
        </button>
      </div>
    )
  }

  return (
    <div className={cls}>
      <div className="mcx-syn-head">
        <span className="mcx-syn-eyebrow"><Spark />{t('mediaCenter.synthesis.label')}</span>
        {state === 'done' && (
          <button type="button" className="mcx-syn-redo" onClick={run} aria-label={t('mediaCenter.synthesis.regen')}>
            {t('mediaCenter.synthesis.regen')}
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div className="mcx-syn-load" aria-live="polite">
          <span className="mcx-syn-skel mcx-syn-skel--lg animate-shimmer" />
          <span className="mcx-syn-skel animate-shimmer" />
          <span className="mcx-syn-skel animate-shimmer" style={{ width: '82%' }} />
          <span className="mcx-syn-skel animate-shimmer" style={{ width: '68%' }} />
          <span className="mcx-syn-note">{t('mediaCenter.synthesis.working')}</span>
        </div>
      )}

      {state === 'done' && summary && (
        <div className="mcx-syn-body">
          <p className="mcx-syn-tldr">{summary.tldr}</p>
          {summary.points?.length > 0 && (
            <ul className="mcx-syn-points">
              {summary.points.map((p, i) => <li key={i}><span className="mcx-syn-dot" />{p}</li>)}
            </ul>
          )}
          {summary.takeaway && (
            <p className="mcx-syn-take"><span className="mcx-syn-take-k">{t('mediaCenter.synthesis.takeaway')}</span>{summary.takeaway}</p>
          )}
          <p className="mcx-syn-src">{t('mediaCenter.synthesis.source')}</p>
        </div>
      )}

      {state === 'empty' && (
        <p className="mcx-syn-msg">{t('mediaCenter.synthesis.thin')}</p>
      )}
      {state === 'error' && (
        <div className="mcx-syn-msg">
          {t('mediaCenter.synthesis.failed')}{' '}
          <button type="button" className="mcx-syn-retry" onClick={run}>{t('mediaCenter.synthesis.retry')}</button>
        </div>
      )}
    </div>
  )
}

export default MediaSynthesis
