/**
 * BrainSays — per-asset Spectre Brain panel (trading-app mirror).
 *
 * Mirror of apps/research/src/components/BrainSays.jsx — same logic, same proxies.
 * Trading uses relative imports (no @/ alias) and lucide-react.
 */
import { useEffect, useState } from 'react'
import { isAppActive } from '../lib/idleManager'
import './BrainSays.css'

const rel = (iso) => {
  if (!iso) return ''
  const t = typeof iso === 'string' ? Date.parse(iso) : Number(iso)
  if (!t) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

const stanceClass = (s) => {
  if (s === 'strong_bull' || s === 'lean_bull') return 'bull'
  if (s === 'strong_bear' || s === 'lean_bear') return 'bear'
  return 'neutral'
}

export default function BrainSays({ asset, refreshMs = 60000, className = '' }) {
  const [thesis, setThesis] = useState(null)
  const [observations, setObservations] = useState([])
  const [lessons, setLessons] = useState([])
  const [stance, setStance] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const A = (asset || '').toUpperCase().trim()
    if (!A) { setThesis(null); setObservations([]); setLessons([]); setStance(null); return }
    let cancelled = false

    const load = async () => {
      setLoading(true); setError(null)
      try {
        const [t, o, l, s] = await Promise.allSettled([
          fetch(`/api/dossier/${A}/brain-thesis`, { signal: AbortSignal.timeout(15000) }).then((r) => r.ok ? r.json() : null),
          fetch(`/api/dossier/${A}/brain-observations?limit=5&hours=24`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok ? r.json() : null),
          fetch(`/api/dossier/${A}/brain-lessons`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok ? r.json() : null),
          fetch(`/api/dossier/${A}/brain-stance`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok ? r.json() : null),
        ])
        if (cancelled) return
        if (t.status === 'fulfilled' && t.value) setThesis(t.value)
        if (o.status === 'fulfilled' && o.value) setObservations(o.value.observations || [])
        if (l.status === 'fulfilled' && l.value) setLessons(l.value.lessons || [])
        if (s.status === 'fulfilled' && s.value) setStance(s.value)
      } catch (e) { if (!cancelled) setError(e.message) }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    const iv = setInterval(() => { if (document.hidden || !isAppActive()) return; load() }, refreshMs)
    return () => { cancelled = true; clearInterval(iv) }
  }, [asset, refreshMs])

  const A = (asset || '').toUpperCase().trim()
  if (!A) return null

  const groundedClaims = thesis?.fact_check?.total_numeric_claims ?? 0
  const ungrounded = thesis?.fact_check?.ungrounded_claims ?? 0
  const liveSrc = thesis?.sources_used || {}
  const livePrices = liveSrc.live_prices || 0
  const liveFunding = liveSrc.live_funding || 0

  const stances = stance?.stances || {}
  const coherent = stance?.coherence?.coherent !== false

  return (
    <div className={`brain-says ${className}`}>
      <header className="bs-head">
        <span className="bs-eyebrow">Brain says</span>
        <span className="bs-ticker mono">{A}</span>
        {loading && <span className="bs-live">live</span>}
      </header>

      {thesis?.voice_280 && <div className="bs-voice">{thesis.voice_280}</div>}

      {stance && (
        <div className="bs-stances">
          {['wave', 'tide', 'ocean'].map((tier) => (
            <div key={tier} className="bs-stance-row">
              <span className="bs-stance-tier mono">{tier}</span>
              <span className={`bs-stance-pill bs-${stanceClass(stances[tier])} mono`}>
                {stances[tier] || 'n/a'}
              </span>
            </div>
          ))}
          {!coherent && stance?.coherence?.disagreement && (
            <div className="bs-disagree">tiers disagree across {stance.coherence.disagreement.spread} buckets</div>
          )}
        </div>
      )}

      {thesis?.thesis && (
        <div className="bs-thesis">
          <div className="bs-label">thesis</div>
          <div className="bs-body">{thesis.thesis}</div>
        </div>
      )}

      {observations.length > 0 && (
        <div className="bs-section">
          <div className="bs-label">recent observations</div>
          <ul className="bs-obs-list">
            {observations.slice(0, 5).map((o) => (
              <li key={o.id} className="bs-obs-item">
                <span className="bs-obs-src mono">{o.source}</span>
                <span className="bs-obs-imp mono">imp {Number(o.importance).toFixed(2)}</span>
                <span className="bs-obs-time mono">{rel(o.ts)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lessons.length > 0 && (
        <div className="bs-section">
          <div className="bs-label">what brain learned</div>
          <ul className="bs-lessons-list">
            {lessons.slice(0, 2).map((l) => (
              <li key={l.id} className="bs-lesson">
                <span className="bs-lesson-watch">{l.what_to_watch || l.miss_reason}</span>
                <span className="bs-lesson-time mono">{rel(l.ts)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="bs-foot">
        <span className="bs-foot-claim mono">
          {groundedClaims - ungrounded}/{groundedClaims} grounded
        </span>
        {livePrices > 0 && (
          <span className="bs-foot-src mono">
            {livePrices}px · {liveFunding}fund
          </span>
        )}
        {thesis?.generated_at && (
          <span className="bs-foot-ts mono">{rel(thesis.generated_at)} ago</span>
        )}
      </footer>

      {error && !thesis && (
        <div className="bs-error mono">brain unavailable: {error}</div>
      )}
    </div>
  )
}
