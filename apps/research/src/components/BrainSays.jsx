/**
 * BrainSays — per-asset Spectre Brain panel.
 *
 * Used in the /you token widget (YouTokenDossier). Reads from the Brain
 * proxy (/api/brain/:path → Spectre Data API /v1/brain/*, dev Express has a
 * matching wildcard):
 *
 *   /api/brain/observations?asset=X  → recent anomalies for the asset
 *   /api/brain/lessons?asset=X       → past wrong calls Brain learned from
 *
 * 2026-06-11: the old /api/dossier/:asset/brain-{thesis,observations,
 * lessons,stance} routes only existed on the dead OVH research surface — in
 * prod they were swallowed by the dossier contract-lookup rewrite and
 * returned junk. Observations + lessons have modern equivalents (above);
 * the thesis (voice_280 / fact_check) and per-asset stance ladder do NOT.
 * TODO: restore thesis + stance sections if/when the data API grows
 * per-asset equivalents (closest today: /v1/brain/dossier/{asset}/full
 * brain_brief, /v1/brain/state-of-mind tiers — both market-wide or
 * different shapes).
 *
 * The component is asset-agnostic — pass an upper-cased ticker (BTC, SOL,
 * ETH). Renders nothing when no asset is given or no Brain data exists.
 */
import { useEffect, useState } from 'react'
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

export default function BrainSays({ asset, refreshMs = 60000, className = '' }) {
  const [observations, setObservations] = useState([])
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const A = (asset || '').toUpperCase().trim()
    if (!A) { setObservations([]); setLessons([]); return }
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const [o, l] = await Promise.allSettled([
          fetch(`/api/brain/observations?asset=${encodeURIComponent(A)}&limit=5&hours=24`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok ? r.json() : null),
          fetch(`/api/brain/lessons?asset=${encodeURIComponent(A)}&limit=6`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok ? r.json() : null),
        ])
        if (cancelled) return
        if (o.status === 'fulfilled' && Array.isArray(o.value?.data)) {
          setObservations(o.value.data.filter((x) => !x.asset || x.asset === A))
        }
        if (l.status === 'fulfilled' && Array.isArray(l.value?.data)) {
          // Upstream does not reliably filter by asset — enforce client-side,
          // and drop rows with nothing renderable.
          setLessons(l.value.data.filter((x) => (!x.asset || x.asset === A) && (x.what_to_watch || x.miss_reason)))
        }
      } catch { /* fail silent — component hides when empty */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    const iv = setInterval(() => { if (!document.hidden) load() }, refreshMs)
    return () => { cancelled = true; clearInterval(iv) }
  }, [asset, refreshMs])

  const A = (asset || '').toUpperCase().trim()
  if (!A) return null
  // Clean hidden state — never render an empty shell.
  if (observations.length === 0 && lessons.length === 0) return null

  return (
    <div className={`brain-says ${className}`}>
      <header className="bs-head">
        <span className="bs-eyebrow">Brain says</span>
        <span className="bs-ticker mono">{A}</span>
        {loading && <span className="bs-live">live</span>}
      </header>

      {/* Recent observations (max 3-5 for this asset) */}
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

      {/* Lessons learned for this asset */}
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
    </div>
  )
}
