/**
 * useBrainBoard — "The Board" data for the Eagle-Eye terminal.
 *
 * Carries BOTH dimensions the market needs (and aixbt splits across table+rail):
 *   - INTEL  : real events per project — news, on-chain flows, unlocks,
 *              governance, liquidations, whale moves — each categorized + toned.
 *              Source: /v1/brain/signals (the classified intel log).
 *   - SOCIAL : the attention leaderboard — signal, trend, staying power, tier.
 *              Source: /v1/social/leaderboard-rollup, with the READ + tier
 *              anchored to /v1/brain/attention's RECONCILED trajectory
 *              (one attention truth per asset — same verdict the desk quotes).
 * Both enriched per-asset with live DIFFUSION ("new colors") + (when deployed)
 * the Project-Consciousness tier. Plus the news headlines for the Brief.
 *
 * Everything defensive; visibility-gated 60s poll.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const BASE = '/data-api/v1'
const POLL_MS = 60_000

async function getJson(path, timeoutMs = 15000) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const j = await r.json()
    return j?.data ?? j
  } catch {
    return null
  }
}
function num(v) { return v == null || Number.isNaN(Number(v)) ? null : Number(v) }
function ageMins(ts) {
  if (!ts) return null
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  return m >= 0 ? m : null
}
function cleanAsset(a) {
  if (!a) return null
  const s = String(a).replace(/_/g, ' ').trim()
  return s.length > 16 ? s.slice(0, 16) : s
}

// ── INTEL categorization ──────────────────────────────────────────────────────
const CATEGORY = {
  news: ['News', 'events'],
  macro_event: ['Macro', 'events'],
  governance: ['Governance', 'events'],
  unlock: ['Supply Event', 'onchain'],
  launch: ['Launch', 'onchain'],
  listing: ['Listing', 'onchain'],
  defi_flow: ['Onchain Metrics', 'onchain'],
  whale_move: ['Onchain Flow', 'onchain'],
  exchange_flow: ['Exchange Flow', 'onchain'],
  narrative_shift: ['Narrative', 'social'],
  social_buzz: ['Visibility Event', 'social'],
  price_move: ['Market Activity', 'market'],
  funding_shift: ['Derivatives', 'market'],
  liquidation: ['Liquidation', 'market'],
  hack: ['Risk Alert', 'risk'],
}
function categorize(s) {
  const t = s.signal_type
  if (CATEGORY[t]) return { label: CATEGORY[t][0], group: CATEGORY[t][1] }
  const cats = (s.categories || []).map((c) => String(c).toLowerCase())
  if (cats.includes('news')) return { label: 'News', group: 'events' }
  if (cats.some((c) => ['derivatives', 'liquidation', 'leverage'].includes(c))) return { label: 'Derivatives', group: 'market' }
  if (cats.some((c) => ['onchain', 'whale', 'defi'].includes(c))) return { label: 'Onchain', group: 'onchain' }
  if (cats.some((c) => ['social', 'narrative', 'momentum'].includes(c))) return { label: 'Social', group: 'social' }
  return { label: (t || 'signal').replace(/_/g, ' '), group: 'events' }
}
function toneOf(v) {
  const s = String(v || '').toLowerCase()
  if (s === 'bullish' || s === 'bull') return 'bull'
  if (s === 'bearish' || s === 'bear') return 'bear'
  return 'neutral'
}

// The investor lens each event is read through — the archetype whose desk cares.
const LENS_BY_TYPE = {
  funding_shift: 'Leverage', liquidation: 'Leverage', price_move: 'Market',
  whale_move: 'Onchain', defi_flow: 'Onchain', exchange_flow: 'Onchain',
  unlock: 'Onchain', launch: 'Onchain', listing: 'Onchain',
  news: 'News', macro_event: 'Macro', governance: 'Governance',
  narrative_shift: 'Narrative', social_buzz: 'Degen', hack: 'Risk',
}
function lensOf(s) {
  const blob = `${s.title || ''} ${s.summary || ''}`
  if (/\b(etf|blackrock|ibit|fidelity|grayscale|microstrategy|institution)/i.test(blob)) return 'Institutional'
  return LENS_BY_TYPE[s.signal_type] || 'Signal'
}
// The read: prefer the interpreted summary ("so what") over the raw title, and
// reframe the weakly-worded narrative summaries into a legible line.
function readOf(s) {
  const sum = (s.summary || '').trim()
  const title = (s.title || '').trim()
  if (s.signal_type === 'narrative_shift') {
    const m = title.match(/"([^"]+)"/)
    const name = m ? m[1] : 'New'
    const cnt = (sum.match(/(\d+)\s+related/) || [])[1]
    return `${name} narrative forming${cnt ? ` — spreading across ${cnt} assets` : ''}`
  }
  return sum && sum.length >= 18 ? sum : title
}

function diffusionFrom(mom) {
  if (!mom) return null
  const c = mom.components || mom
  const clusters = num(c.cluster_count) ?? num(c.clusters)
  const fresh = num(c.new_cluster_count) ?? num(c.new_clusters) ?? 0
  if (clusters == null) return null
  let state = 'steady'
  if (clusters <= 1) state = 'single'
  else if (fresh >= 2) state = 'broadening'
  return { clusters, fresh, state, arrow: state === 'broadening' ? '▲' : state === 'single' ? '·' : '→' }
}

const TIER_LABEL = { top_tier: 'Top', solid_setup: 'Solid', uphill_climb: 'Uphill', avoid: 'Avoid' }
const TIER_CLASS = { top_tier: 'top', solid_setup: 'solid', uphill_climb: 'uphill', avoid: 'avoid' }

/* ONE attention truth per asset (coherence fix): the text + tier follow the
 * engine's RECONCILED trajectory (brain_attention_clocks — 24h mention flow,
 * same math as the rollup trend), so the Social view can never say "cooling"
 * while the desk intel says "climbing". Falls back to the rollup trend only
 * when the asset has no clocks row. */
const TRAJ_TEXT = { rising: 'attention rising', cooling: 'attention cooling', stable: 'attention steady', new: 'new — unproven' }
function deriveTier(row, att) {
  const traj = att?.trajectory
    || ((row.trend || '').includes('rising') || (row.trendDelta ?? 0) > 0.15 ? 'rising'
      : (row.trend || '').includes('fading') || (row.trendDelta ?? 0) < -0.15 ? 'cooling' : 'stable')
  const staying = row.stayingPower ?? 0
  let tier = 'uphill_climb'
  if (traj === 'rising' && staying >= 50) tier = 'top_tier'
  else if (traj === 'rising') tier = 'solid_setup'
  else if (traj === 'stable' && staying >= 60) tier = 'solid_setup'
  else if (traj === 'cooling' && staying < 45) tier = 'avoid'
  const bits = []
  if (row.mentions) bits.push(`${row.mentions} mentions`)
  if (staying) bits.push(`${Math.round(staying)} staying`)
  const verdict = att?.verdict_note || att?.note || TRAJ_TEXT[traj] || 'attention steady'
  const source = att ? "Brain attention clocks (reconciled 24h mention-flow trajectory)" : 'rollup trend (no clocks row for this asset)'
  return {
    tier,
    read: `${verdict}${bits.length ? ` · ${bits.join(', ')}` : ''}`,
    title: `Derived tier — no per-project take yet. Trajectory '${traj}' from ${source} + staying ${Math.round(staying)}/100 (durability). Avoid = cooling flow + staying < 45; Top = rising flow + staying ≥ 50.`,
  }
}

export default function useBrainBoard() {
  const [state, setState] = useState({ loading: true, error: false, intelRows: [], socialRows: [], news: [], updatedAt: null, takesLive: false })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    const [sig, board, momentum, takes, newsD, attention] = await Promise.all([
      getJson('/brain/signals?severity=critical,high,medium&hours=48&limit=60'),
      getJson('/social/leaderboard-rollup?window=24h&ranking=momentum&limit=40'),
      getJson('/brain/trenches/momentum?limit=80'),
      getJson('/brain/projects/board?limit=60'),
      getJson('/brain/awareness/news?limit=8'),
      getJson('/brain/attention?top=150'),
    ])
    if (cancelled.current) return

    // reconciled attention verdicts (brain_attention_clocks) by project key
    const attList = Array.isArray(attention) ? attention : Array.isArray(attention?.data) ? attention.data : []
    const attByKey = new Map()
    for (const a of attList) { if (a?.project_key) attByKey.set(String(a.project_key).toLowerCase(), a) }

    // diffusion index
    const momList = Array.isArray(momentum?.rows) ? momentum.rows : Array.isArray(momentum) ? momentum : []
    const momByKey = new Map()
    for (const m of momList) { const k = String(m.asset || m.symbol || '').toUpperCase(); if (k) momByKey.set(k, m) }

    // takes index
    const tb = takes?.board || {}
    const takeList = [].concat(tb.top_tier || [], tb.solid_setup || [], tb.uphill_climb || [], tb.avoid || [], Array.isArray(takes?.takes) ? takes.takes : [])
    const takeByKey = new Map()
    for (const t of takeList) { if (t?.symbol) takeByKey.set(String(t.symbol).toUpperCase(), t) }
    const takesLive = takeList.length > 0

    // INTEL rows (from signals)
    const signals = Array.isArray(sig?.data) ? sig.data : Array.isArray(sig) ? sig : (sig?.signals || [])
    const intelRows = signals.map((s, i) => {
      const asset = (s.assets || [])[0] || null
      const key = String(asset || '').toUpperCase()
      const cat = categorize(s)
      return {
        id: s.id || `sig-${i}`,
        asset: cleanAsset(asset) || 'Market',
        assetKey: key,
        intel: readOf(s),
        raw: s.title || null,
        lens: lensOf(s),
        category: cat.label,
        group: cat.group,
        severity: s.severity || 'medium',
        tone: toneOf(s.sentiment),
        ageMins: ageMins(s.ts),
        diffusion: diffusionFrom(momByKey.get(key)),
      }
    })

    // SOCIAL rows (from leaderboard rollup)
    const spine = Array.isArray(board?.rows) ? board.rows : Array.isArray(board) ? board : []
    const socialRows = spine.slice(0, 40).map((r, i) => {
      const sym = String(r.symbol || r.asset || '').toUpperCase()
      const base = {
        rank: num(r.rank) ?? i + 1,
        symbol: sym,
        name: r.name || sym,
        image: r.image || null,
        category: r.primary_category || r.category || null,
        ageMins: ageMins(r.first_seen_at),
        signal: num(r.signal) ?? num(r.latest_signal) ?? num(r.signal_avg),
        trend: r.trend || null,
        trendDelta: num(r.trend_delta),
        stayingPower: num(r.staying_power),
        mentions: num(r.mentions),
        mcap: num(r.market_cap),
        diffusion: diffusionFrom(momByKey.get(sym)),
      }
      const att = attByKey.get(String(r.asset || '').toLowerCase()) || attByKey.get(sym.toLowerCase()) || null
      const take = takeByKey.get(sym)
      if (take) {
        base.tier = take.tier; base.read = take.catalyst || take.take || null; base.derived = false
        base.tierTitle = `Spectre take (project-consciousness worker): ${take.tier}`
      } else {
        const d = deriveTier(base, att)
        base.tier = d.tier; base.read = d.read; base.derived = true; base.tierTitle = d.title
      }
      base.tierLabel = TIER_LABEL[base.tier] || base.tier
      base.tierClass = TIER_CLASS[base.tier] || 'solid'
      return base
    })

    // NEWS headlines (for the Brief)
    const newsItems = (newsD?.items || (Array.isArray(newsD) ? newsD : []) || []).slice(0, 6).map((n) => ({
      title: n.title || n.headline || '',
      assets: (n.related_assets || n.assets || []).slice(0, 2),
      url: n.url || n.link || null,
      sentiment: toneOf(n.sentiment),
    })).filter((n) => n.title)

    setState({ loading: false, error: !sig && !board, intelRows, socialRows, news: newsItems, updatedAt: sig?.generated_at || board?.generated_at || new Date().toISOString(), takesLive })
  }, [])

  useEffect(() => {
    cancelled.current = false
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled.current = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  return { ...state, refetch: load }
}
