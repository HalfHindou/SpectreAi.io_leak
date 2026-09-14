import { useEffect, useState } from 'react'
import { isAppActive } from '../lib/idleManager'
import './DossierFeed.css'

// 2026-06-03 COST WAR HARD-DISABLE: see LeftPanel/DossierStory/TrendingHub.
// All OVH dossier callers killed at source to stop Codex bleed.
const KILL_OVH_DOSSIER = true
const API = (KILL_OVH_DOSSIER ? '' : (import.meta.env.VITE_DOSSIER_API || '')) + '/api/dossier'

const rel = (ts) => {
  if (!ts) return '—'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function chainOf(token) {
  if (!token) return null
  const nid = Number(token.networkId)
  if (nid === 1) return 'eth'
  if (nid === 8453) return 'base'
  if (nid === 42161) return 'arb'
  if (nid === 137) return 'poly'
  if (nid === 56) return 'bsc'
  if (nid === 1399811149) return 'sol'
  return null
}

export default function DossierFeed({ token }) {
  const chain = chainOf(token)
  const ca = token?.address
  const [signals, setSignals] = useState([])
  const [takes, setTakes] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!chain || !ca) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [s, t] = await Promise.allSettled([
          fetch(`${API}/signals?chain=${chain}&limit=50`).then((r) => r.json()),
          fetch(`${API}/_brain/annotations?chain=${chain}&limit=15`).then((r) => r.json()),
        ])
        if (cancelled) return
        if (s.status === 'fulfilled') {
          const mine = (s.value.signals || []).filter((x) => (x.ca || '').toLowerCase() === ca.toLowerCase())
          setSignals(mine.slice(0, 8))
        }
        if (t.status === 'fulfilled') {
          const mine = (t.value.annotations || []).filter((x) => (x.ca || '').toLowerCase() === ca.toLowerCase())
          setTakes(mine.slice(0, 8))
        }
      } catch (_) { console.error(_) } finally { setLoading(false) }
    }
    load()
    const iv = setInterval(() => { if (document.hidden || !isAppActive()) return; load() }, 30000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [chain, ca])

  if (!chain || !ca) return null
  const merged = [
    ...signals.map((s) => ({ kind: 'signal', body: s.narrative, score: s.score, sub: s.kind, ts: s.detectedAt })),
    ...takes.map((t) => ({ kind: t.kind === 'warning' ? 'warning' : 'take', body: t.body, score: null, sub: 'brain', ts: t.createdAt })),
  ].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 12)

  return (
    <div className="dossier-feed">
      <div className="df-header">
        <span className="df-eyebrow">Spectre Brain</span>
        <span className="df-meta">{loading ? 'live' : `${merged.length} events`}</span>
      </div>
      {merged.length === 0 && <div className="df-empty">No Brain events yet for this token.</div>}
      {merged.map((m, i) => (
        <div key={i} className={`df-item df-${m.kind}`}>
          <div className="df-row1">
            {m.score != null && <span className={`df-score ${m.score >= 80 ? 'hi' : m.score >= 60 ? 'mid' : 'low'}`}>{Math.round(m.score)}</span>}
            <span className="df-sub">{m.sub.replace(/_/g, ' ')}</span>
            <span className="df-time">{rel(m.ts)}</span>
          </div>
          <div className="df-body">{m.body}</div>
        </div>
      ))}
    </div>
  )
}
