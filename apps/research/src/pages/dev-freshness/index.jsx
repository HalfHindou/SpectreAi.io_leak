/**
 * /dev/freshness — internal diagnostic page.
 *
 * One-glance view of every critical data endpoint's freshness across the app.
 * Use pre-beta to confirm nothing is stale before users see it. Use during
 * beta to spot a degraded endpoint within seconds.
 *
 * Not visible in nav. Reach it directly via /dev/freshness.
 */
import { useEffect, useState, useCallback } from 'react'
import FreshnessTag from '@/components/freshness-tag'
import './dev-freshness.css'

// Endpoint catalog covers the BOTH dev (Express on :3001) and prod
// (Vercel serverless functions). Paths use the dev-side route names —
// in prod the Vite rewrites route them to the corresponding serverless fns.
const ENDPOINTS = [
  // ── Market data (hot) ──────────────────────────────────────────────────
  { group: 'Market · Hot',  tier: 'hot',  path: '/api/binance-ticker' },
  { group: 'Market · Hot',  tier: 'hot',  path: '/api/fear-greed/current' },
  { group: 'Market · Hot',  tier: 'hot',  path: '/api/coingecko/coins/markets?vs_currency=usd&per_page=20&page=1' },
  { group: 'Market · Hot',  tier: 'hot',  path: '/api/coingecko/global' },

  // ── X-Dash (hot) ───────────────────────────────────────────────────────
  { group: 'X-Dash',        tier: 'hot',  path: '/api/xdash/bootstrap?timeframe=24h&per_page=15' },
  { group: 'X-Dash',        tier: 'hot',  path: '/api/xdash/leaderboard-bundle?ranking=momentum&timeframe=24h&per_page=15' },

  // ── RWA / Tokenized Assets (warm) ──────────────────────────────────────
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/breakdown' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/issuers' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/overview' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/stablecoins-summary' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/nav-watch' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/concentration-leaderboard' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/velocity?range=30d' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/signals' },
  { group: 'RWA',           tier: 'warm', path: '/api/rwa/themes' },

  // ── Private Markets (warm) ─────────────────────────────────────────────
  { group: 'Private',       tier: 'warm', path: '/api/private/deals' },
  { group: 'Private',       tier: 'warm', path: '/api/private/sec-filings' },
  { group: 'Private',       tier: 'warm', path: '/api/private/unicorns' },
  { group: 'Private',       tier: 'warm', path: '/api/accelerators/all?crypto=true' },

  // ── Ventures / Institutional (warm) ────────────────────────────────────
  { group: 'Ventures',      tier: 'warm', path: '/data-api/v1/institutional/scores?limit=10' },
  { group: 'Ventures',      tier: 'warm', path: '/data-api/v1/discovery/hot' },
  { group: 'Ventures',      tier: 'warm', path: '/data-api/v1/institutional/upgrades?days=7' },

  // ── News (warm) ────────────────────────────────────────────────────────
  { group: 'News',          tier: 'warm', path: '/api/news' },
  { group: 'News',          tier: 'warm', path: '/api/news/rss' },

  // ── AI analysis (cold) ─────────────────────────────────────────────────
  { group: 'AI Analysis',   tier: 'cold', path: '/api/rwa/analysis/overview' },
  { group: 'AI Analysis',   tier: 'cold', path: '/api/rwa/analysis/stablecoins' },
  { group: 'AI Analysis',   tier: 'cold', path: '/api/rwa/analysis/treasuries' },

  // ── Brain / Dossier (warm) ─────────────────────────────────────────────
  { group: 'Brain',         tier: 'warm', path: '/api/dossier/BTC/brain-thesis' },
  { group: 'Brain',         tier: 'warm', path: '/api/dossier/BTC/brain-stance' },
]

const TIMESTAMP_FIELDS = [
  'generated_at', 'served_at', 'snapshot_at', 'publishedAt', 'lastUpdated',
  'last_updated', 'updated_at', 'timestamp', 'cached_at',
  'data.generated_at', 'data.served_at', 'data.snapshot_at',
  'meta.generated_at',
]

function pickTimestamp(payload) {
  if (!payload) return null
  for (const path of TIMESTAMP_FIELDS) {
    const parts = path.split('.')
    let v = payload
    for (const p of parts) v = v?.[p]
    if (v) return v
  }
  return null
}

async function probe(endpoint) {
  const t0 = performance.now()
  try {
    const res = await fetch(endpoint.path, { signal: AbortSignal.timeout(12_000) })
    const ms = Math.round(performance.now() - t0)
    if (!res.ok) {
      return { ...endpoint, status: res.status, ms, ts: null, ok: false }
    }
    const json = await res.json().catch(() => null)
    return { ...endpoint, status: res.status, ms, ts: pickTimestamp(json), ok: true }
  } catch (err) {
    return { ...endpoint, status: 'err', ms: Math.round(performance.now() - t0), ts: null, ok: false, error: String(err?.message || err) }
  }
}

export default function DevFreshnessPage() {
  const [rows, setRows] = useState(() => ENDPOINTS.map((e) => ({ ...e, ts: null, status: null, ms: null, ok: null })))
  const [refreshing, setRefreshing] = useState(false)
  const [lastSweep, setLastSweep] = useState(null)

  const runSweep = useCallback(async () => {
    setRefreshing(true)
    const results = await Promise.all(ENDPOINTS.map(probe))
    setRows(results)
    setLastSweep(Date.now())
    setRefreshing(false)
  }, [])

  useEffect(() => {
    runSweep()
    const id = setInterval(runSweep, 30_000)
    return () => clearInterval(id)
  }, [runSweep])

  const byGroup = rows.reduce((acc, r) => {
    if (!acc[r.group]) acc[r.group] = []
    acc[r.group].push(r)
    return acc
  }, {})

  const stats = {
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => r.ok === false).length,
    pending: rows.filter((r) => r.ok == null).length,
  }

  return (
    <div className="dev-freshness">
      <header className="devf-header">
        <div>
          <h1 className="devf-title">Freshness Diagnostic</h1>
          <p className="devf-sub">
            {stats.total} endpoints · {stats.ok} healthy · {stats.failed > 0 && <span className="devf-bad">{stats.failed} failing</span>}
            {stats.pending > 0 && <span className="devf-pending"> · {stats.pending} pending</span>}
          </p>
        </div>
        <div className="devf-actions">
          {lastSweep && (
            <FreshnessTag timestamp={lastSweep} tier="hot" label="Last sweep" />
          )}
          <button
            type="button"
            className="devf-refresh"
            onClick={runSweep}
            disabled={refreshing}
          >
            {refreshing ? 'Sweeping…' : 'Sweep now'}
          </button>
        </div>
      </header>

      <div className="devf-groups">
        {Object.entries(byGroup).map(([group, items]) => (
          <section key={group} className="devf-group">
            <h2 className="devf-group-title">{group}</h2>
            <div className="devf-table">
              <div className="devf-row devf-row--head">
                <span>Endpoint</span>
                <span>HTTP</span>
                <span>Latency</span>
                <span>Freshness</span>
              </div>
              {items.map((r) => (
                <div key={r.path} className={`devf-row ${r.ok === false ? 'devf-row--bad' : ''}`}>
                  <span className="devf-path mono">{r.path}</span>
                  <span className={`devf-http ${r.ok ? 'devf-http--ok' : r.ok === false ? 'devf-http--bad' : ''}`}>
                    {r.status ?? '—'}
                  </span>
                  <span className="devf-ms mono">{r.ms != null ? `${r.ms}ms` : '—'}</span>
                  <span className="devf-fresh">
                    {r.ts
                      ? <FreshnessTag timestamp={r.ts} tier={r.tier} />
                      : r.ok === false
                        ? <FreshnessTag timestamp={null} tier={r.tier} label="Failed" />
                        : <FreshnessTag timestamp={null} tier={r.tier} label="No timestamp" />}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
