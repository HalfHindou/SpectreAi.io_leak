import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppActive } from '@/lib/idleManager'
import './rwa-review-tab.css'

/**
 * RwaReviewTab — the comprehensive AI desk review of the whole tokenized-assets
 * market. One structured read from /api/rwa/review (verdict, regime, per-sector
 * reads, risks, opportunities, catalysts), grounded in the live RWA data sheet.
 * Self-contained fetch; lazy-mounted so it only runs when the tab is opened.
 */

const STANCE_LABEL = { constructive: 'Constructive', cautious: 'Cautious', neutral: 'Neutral', mixed: 'Mixed' }
const SIGNAL_LABEL = { expanding: 'Expanding', steady: 'Steady', cooling: 'Cooling' }

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function RwaReviewTab({ dayMode }) {
  const { t } = useTranslation()
  const [review, setReview] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | pending | error

  const load = useCallback((isPoll) => {
    fetch('/api/rwa/review', { signal: AbortSignal.timeout(45000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.review?.headline) { setReview(j.review); setState('ready') }
        else if (j?.pending) { setState((s) => (s === 'ready' ? 'ready' : 'pending')) }
        else if (!isPoll) setState((s) => (s === 'ready' ? 'ready' : 'error'))
      })
      .catch(() => { if (!isPoll) setState((s) => (s === 'ready' ? 'ready' : 'error')) })
  }, [])

  useEffect(() => {
    load(false)
    // If the read is still generating (cold cache), poll a couple of times.
    const id = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      load(true)
    }, 20000)
    return () => clearInterval(id)
  }, [load])

  if (state === 'loading' || (state === 'pending' && !review)) {
    return (
      <div className="rrv">
        <div className="rrv-hero rrv-skel animate-shimmer" />
        <div className="rrv-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="rrv-card rrv-skel animate-shimmer" />)}
        </div>
        {state === 'pending' && <p className="rrv-note">{t('tokenizedAssets.review.generating', 'Generating the desk review — one moment.')}</p>}
      </div>
    )
  }

  if (state === 'error' || !review) {
    return <div className="rrv-empty">{t('tokenizedAssets.review.unavailable', 'The desk review is unavailable right now. Try again shortly.')}</div>
  }

  const inp = review.inputs || {}
  const stanceLabel = STANCE_LABEL[review.stance] || 'Neutral'

  return (
    <div className="rrv">
      {/* Verdict hero */}
      <div className={`rrv-hero rrv-hero--${review.stance || 'neutral'}`}>
        <div className="rrv-hero-top">
          <span className="rrv-kicker">{t('tokenizedAssets.review.deskReview', 'RWA Desk Review')}</span>
          <span className={`rrv-stance rrv-stance--${review.stance || 'neutral'}`}>{stanceLabel}</span>
        </div>
        <h2 className="rrv-headline">{review.headline}</h2>
        {review.summary && <p className="rrv-summary">{review.summary}</p>}
        {review.regime && (
          <div className="rrv-regime"><span className="rrv-regime-lbl">{t('tokenizedAssets.review.regime', 'Regime')}</span>{review.regime}</div>
        )}
        {/* Grounding numbers */}
        <div className="rrv-inputs">
          {inp.totalTvl && <span className="rrv-input"><i>{t('tokenizedAssets.review.aum', 'On-chain AUM')}</i><b>{inp.totalTvl}</b></span>}
          {inp.treasuries && <span className="rrv-input"><i>{t('tokenizedAssets.treasuries', 'Treasuries')}</i><b>{inp.treasuries}</b></span>}
          {inp.stablecoins && <span className="rrv-input"><i>{t('tokenizedAssets.stablecoins', 'Stablecoins')}</i><b>{inp.stablecoins}</b></span>}
          {inp.credit && <span className="rrv-input"><i>{t('tokenizedAssets.credit', 'Credit')}</i><b>{inp.credit}</b></span>}
          {inp.commodities && <span className="rrv-input"><i>{t('tokenizedAssets.commodities', 'Commodities')}</i><b>{inp.commodities}</b></span>}
        </div>
      </div>

      {/* Per-sector reads */}
      {review.sectors?.length > 0 && (
        <div className="rrv-grid">
          {review.sectors.map((sec, i) => (
            <div key={i} className={`rrv-card rrv-card--${sec.signal || 'steady'}`}>
              <div className="rrv-card-head">
                <span className="rrv-card-name">{sec.name}</span>
                <span className={`rrv-signal rrv-signal--${sec.signal || 'steady'}`}>{SIGNAL_LABEL[sec.signal] || 'Steady'}</span>
              </div>
              <p className="rrv-card-read">{sec.read}</p>
            </div>
          ))}
        </div>
      )}

      {/* Risks / Opportunities / Catalysts */}
      <div className="rrv-cols">
        {review.opportunities?.length > 0 && (
          <div className="rrv-col rrv-col--opp">
            <h3 className="rrv-col-title">{t('tokenizedAssets.review.opportunities', 'Opportunities')}</h3>
            <ul>{review.opportunities.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {review.risks?.length > 0 && (
          <div className="rrv-col rrv-col--risk">
            <h3 className="rrv-col-title">{t('tokenizedAssets.review.risks', 'Risks')}</h3>
            <ul>{review.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {review.catalysts?.length > 0 && (
          <div className="rrv-col rrv-col--cat">
            <h3 className="rrv-col-title">{t('tokenizedAssets.review.catalysts', 'Catalysts to watch')}</h3>
            <ul>{review.catalysts.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
      </div>

      {/* Top protocols + provenance */}
      <div className="rrv-foot">
        {inp.topProtocols?.length > 0 && (
          <div className="rrv-protos">
            <span className="rrv-protos-lbl">{t('tokenizedAssets.review.leaders', 'Leaders')}</span>
            {inp.topProtocols.map((p, i) => (
              <span key={i} className="rrv-proto">{p.name}{p.tvl ? ` · ${p.tvl}` : ''}</span>
            ))}
          </div>
        )}
        <span className="rrv-stamp">
          {t('tokenizedAssets.review.aiRead', 'AI desk read')} · {timeAgo(review.generatedAt)}
        </span>
      </div>
    </div>
  )
}
