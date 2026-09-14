/**
 * useVcInvestments — REAL dated investment activity for a fund, from the Spectre
 * Data API fundraising graph (/v1/fundraising/rounds?investor=…). Returns the
 * rounds a fund led/joined with dates, amounts, valuations and co-investors, so
 * the UI can answer "when did a16z back X, with whom, how much" — not fabricated.
 * Also derives a project→first-investment-date map used to date holdings.
 */
import { useState, useEffect } from 'react'

const _cache = new Map()
const _inflight = new Map()

// vc-database id → the investor name the fundraising graph indexes by.
const API_NAME = {
  'a16z-crypto': 'a16z',
  'coinbase-ventures': 'Coinbase Ventures',
  'dragonfly-capital': 'Dragonfly',
  'pantera-capital': 'Pantera',
  'multicoin-capital': 'Multicoin',
  'jump-crypto': 'Jump',
  'usv-union-square-ventures': 'USV',
  'lightspeed-venture-partners': 'Lightspeed',
  'polychain-capital': 'Polychain',
  'framework-ventures': 'Framework',
  'maven-11': 'Maven 11',
  'iosg-ventures': 'IOSG',
  'electric-capital': 'Electric Capital',
  'tiger-global': 'Tiger Global',
  'softbank-vision-fund': 'SoftBank',
  'founders-fund': 'Founders Fund',
  'sequoia-capital': 'Sequoia',
  'blockchain-capital': 'Blockchain Capital',
  'placeholder-vc': 'Placeholder',
  'binance-labs': 'Binance Labs',
  'hack-vc': 'Hack VC',
  'paradigm': 'Paradigm',
}

export function vcApiName(entity) {
  if (!entity) return null
  return API_NAME[entity.id] || (entity.name || '').replace(/\s+(Capital|Ventures|Crypto|Group|Labs|Partners|Fund|Investments|Digital)$/i, '').trim()
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/\s*(labs|protocol|finance|network|foundation|inc\.?)\s*$/i, '').replace(/[^a-z0-9]/g, '').trim()
}

function normRound(r, self) {
  const lead = r.lead_investors || []
  const all = r.all_investors || []
  const co = all.filter((n) => !new RegExp(`^${self}`, 'i').test(n))
  return {
    id: r.id,
    project: r.project_name || r.asset || '—',
    symbol: r.asset || null,
    roundType: r.round_type && !/listing/i.test(r.round_type) ? r.round_type : null,
    amount: Number.isFinite(r.amount_raised_usd) ? r.amount_raised_usd : null,
    valuation: Number.isFinite(r.valuation_usd) ? r.valuation_usd : null,
    date: r.date || r.created_at || null,
    isLead: lead.some((n) => new RegExp(`^${self}`, 'i').test(n)),
    coInvestors: co.slice(0, 4),
    allCo: co,
    coCount: co.length,
    source: r.source_url || null,
  }
}

export default function useVcInvestments(entity) {
  const id = entity?.id || null
  const [state, setState] = useState(() => (id && _cache.has(id)
    ? { ..._cache.get(id), loading: false }
    : { rounds: [], byProject: {}, loading: !!id }))

  useEffect(() => {
    if (!id || !entity) return undefined
    if (_cache.has(id)) { setState({ ..._cache.get(id), loading: false }); return undefined }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, rounds: [] }))
    const name = vcApiName(entity)

    const run = _inflight.get(id) || (async () => {
      try {
        const res = await fetch(`/data-api/v1/fundraising/rounds?investor=${encodeURIComponent(name)}&limit=60`)
        if (!res.ok) return { rounds: [], byProject: {} }
        const json = await res.json()
        const raw = json?.data?.rounds || json?.data || json?.rounds || []
        const rounds = (raw || [])
          .map((r) => normRound(r, name))
          .filter((r) => r.project && r.project !== '—')
          .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        const byProject = {}
        const byName = {} // normalized project name → round (for matching companies)
        const coCounts = new Map() // co-investor → # shared rounds
        for (const r of rounds) {
          const key = (r.symbol || r.project).toUpperCase()
          if (!byProject[key] || new Date(r.date) < new Date(byProject[key])) byProject[key] = r.date
          byName[normName(r.project)] = r
          for (const c of (r.allCo || [])) coCounts.set(c, (coCounts.get(c) || 0) + 1)
        }
        const coInvestors = [...coCounts.entries()]
          .map(([investor, count]) => ({ investor, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
        return { rounds, byProject, byName, coInvestors }
      } finally {
        _inflight.delete(id)
      }
    })()
    _inflight.set(id, run)

    run.then((data) => {
      _cache.set(id, data)
      if (!cancelled) setState({ ...data, loading: false })
    }).catch(() => { if (!cancelled) setState({ rounds: [], byProject: {}, loading: false }) })

    return () => { cancelled = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}
