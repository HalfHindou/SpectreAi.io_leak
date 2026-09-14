import { useEffect, useState } from 'react'
import { isAppActive } from '../lib/idleManager'
import './DossierStory.css'

// 2026-06-03 COST WAR HARD-DISABLE: every trading-app mount hit
// srv.spectreai.io for dossier story. OVH server fires Codex filterTokens
// with the heavy field selection (lockstep) on each call. Killed at the
// source. Hetzner has its own /v1/dossier/* endpoint we can rewire to
// later. 2026-06-08 REVIVED: relocated to monsol -> srv.spectreai.io, workers off,
// on-demand enrich-once, 7-day TTL. Requires VITE_DOSSIER_API=https://srv.spectreai.io.
const KILL_OVH_DOSSIER = false
const API = (KILL_OVH_DOSSIER ? '' : (import.meta.env.VITE_DOSSIER_API || '')) + '/api/dossier'

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

export default function DossierStory({ token }) {
  const chain = chainOf(token)
  const ca = token?.address
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!chain || !ca) { setData(null); return }
    // No dossier base configured (local dev / deploy without the OVH service):
    // every `/api/dossier/...?stream=true` 404s on each token load. Skip it.
    // Kill switch active OR env var unset = no OVH call.
    if (!API || API === '/api/dossier') { setData(null); return }
    let cancelled = false
    let triggered = false
    const load = async () => {
      setLoading(true)
      try {
        const r = await fetch(`${API}/${chain}/${ca}?stream=true`)
        if (!r.ok) return
        const j = await r.json()
        if (cancelled) return
        setData(j)
        // First fetch: if no lore yet but the token has any social signal,
        // POST /lore/generate so the user gets a narrative without waiting for
        // the worker's eligibility gate. Fire-and-forget; the next interval
        // tick will pull the freshly-stored row.
        if (!triggered && !j?.lore?.communityNarrative && (j?.socials?.twitter || j?.socials?.website || j?.identity?.symbol)) {
          triggered = true
          fetch(`${API}/${chain}/${ca}/lore/generate?force=true`, { method: 'POST' }).catch(() => {})
        }
      } catch (_) { console.error(_) } finally { setLoading(false) }
    }
    load()
    const iv = setInterval(() => { if (document.hidden || !isAppActive()) return; load() }, 30000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [chain, ca])

  if (!chain || !ca) return null

  const lore = data?.lore
  const socials = data?.socials
  const identity = data?.identity
  const market = data?.market

  // Project is only worth showing when an LLM has actually summarised the source
  // text. If projectDescription is just the raw X bio (fallback path), skip it
  // — the AI Narrative carries the insight in that case.
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const projectIsRawBio = lore?.projectDescription && socials?.twitterBio
    && norm(lore.projectDescription).startsWith(norm(socials.twitterBio).slice(0, 60))
  const projectFromAI = lore?.projectDescription && !projectIsRawBio

  const hasLore = !!(projectFromAI || lore?.communityNarrative)
  const fallbackBio = socials?.twitterBio?.trim()
  // Aggregator-feed fallback only kicks in when there's NO AI lore at all
  // (no narrative, no AI-summarised project). That keeps us from re-displaying
  // the raw bio twice.
  const hasBio = !hasLore && !lore?.communityNarrative && fallbackBio

  // Build a deterministic snapshot from on-chain state so the section is never
  // empty. Real narrative replaces this once the LLM worker generates it.
  const synthesizedSnapshot = (() => {
    if (hasLore || hasBio) return null
    if (!identity && !market) return null
    const sym = identity?.symbol || identity?.name || 'This token'
    const chainName = ({ eth: 'Ethereum', sol: 'Solana', base: 'Base', arb: 'Arbitrum', poly: 'Polygon', bsc: 'BSC' })[chain] || chain.toUpperCase()
    const ageMs = identity?.deployedAt ? Date.now() - identity.deployedAt : null
    const ageDays = ageMs != null ? Math.max(0, Math.round(ageMs / 86400000)) : null
    const priceStr = market?.priceUsd != null ? formatPrice(market.priceUsd) : null
    const mcapStr = market?.mcap != null ? formatCompact(market.mcap, '$') : null
    const volStr = market?.vol24h != null ? formatCompact(market.vol24h, '$') : null
    const liqStr = market?.liquidity != null ? formatCompact(market.liquidity, '$') : null
    const change = market?.change24h != null ? `${market.change24h >= 0 ? '+' : ''}${Number(market.change24h).toFixed(1)}%` : null

    const parts = [`${sym} on ${chainName}.`]
    if (ageDays != null) parts.push(`Deployed ${ageDays === 0 ? '<1 day' : `${ageDays}d`} ago.`)
    const trade = []
    if (priceStr) trade.push(`Trading at ${priceStr}`)
    if (change) trade.push(`${change} 24h`)
    if (trade.length) parts.push(trade.join(' · ') + '.')
    const cap = []
    if (mcapStr) cap.push(`Mcap ${mcapStr}`)
    if (volStr) cap.push(`Vol24h ${volStr}`)
    if (liqStr) cap.push(`Liq ${liqStr}`)
    if (cap.length) parts.push(cap.join(' · ') + '.')
    return parts.join(' ')
  })()

  const rightLabel = lore?.communityNarrative
    ? (lore.projectType === 'utility' ? 'Overview' : lore.projectType === 'unknown' ? 'Snapshot' : 'Narrative / Lore')
    : hasBio ? 'Project'
    : synthesizedSnapshot ? 'Snapshot'
    : null

  return (
    <section className="dossier-story" aria-label="AI Dossier">
      <header className="ds-header">
        <span className="ds-eyebrow">AI Dossier</span>
        {rightLabel && <span className="ds-source">{rightLabel}</span>}
      </header>

      {lore?.communityNarrative && (
        <p className="ds-body">{lore.communityNarrative.replace(/\nVerdict:.*/i, '').trim()}</p>
      )}
      {hasBio && (
        <p className="ds-body">{fallbackBio}</p>
      )}
      {!hasLore && !hasBio && synthesizedSnapshot && (
        <p className="ds-body">{synthesizedSnapshot}</p>
      )}
      {!hasLore && !hasBio && !synthesizedSnapshot && loading && <div className="ds-loading">Generating narrative…</div>}
    </section>
  )
}

function formatPrice(n) {
  const v = Number(n)
  if (!isFinite(v) || v === 0) return '$0'
  if (v >= 1000) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (v >= 1) return `$${v.toFixed(4)}`
  if (v >= 0.0001) return `$${v.toFixed(6)}`
  return `$${v.toPrecision(3)}`
}

function formatCompact(n, prefix = '') {
  const v = Number(n)
  if (!isFinite(v) || v === 0) return null
  if (v >= 1e9) return `${prefix}${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${prefix}${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${prefix}${(v / 1e3).toFixed(1)}K`
  return `${prefix}${v.toFixed(0)}`
}
