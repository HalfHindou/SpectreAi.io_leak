/**
 * BrainAwarenessGrid v2 — 26 domain cards, no emojis, real glassmorphism,
 * real data extractors verified against /v1/brain/awareness/full payloads.
 *
 * One card per domain. Each card shows the domain label, a real per-row
 * preview using the ACTUAL field names returned by the API, item count,
 * and a freshness indicator. Empty domains show a muted one-line state
 * instead of a blank card.
 *
 * Style: heavy glassmorphism (blur(20px) + 135deg gradient + inner-light
 * highlight + tier-graded delta colors). No emoji icons (design-system
 * anti-pattern). Compact 3-row preview per card.
 */
import React, { memo } from 'react'
import FreshnessTag from '@/components/freshness-tag'
import './brain-awareness-grid.css'

// ── Formatters ───────────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmtUsd(v) {
  const n = num(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (a >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`
  if (a >= 1)    return `$${n.toFixed(2)}`
  if (a >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toPrecision(3)}`
}

function fmtNum(v) {
  const n = num(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function fmtPct(v, digits = 2) {
  const n = num(v)
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function pctClass(v) {
  const n = num(v)
  if (n == null) return ''
  return n >= 0 ? 'baw-pos' : 'baw-neg'
}

function relTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

// ── Row primitive ────────────────────────────────────────────────────────────

function Row({ label, extra, delta, deltaDigits = 2, title }) {
  return (
    <div className="baw-row" title={title}>
      <span className="baw-row-label">{label}</span>
      {extra != null ? <span className="baw-row-extra">{extra}</span> : null}
      {delta != null ? (
        <span className={`baw-row-delta ${pctClass(delta)}`}>{fmtPct(delta, deltaDigits)}</span>
      ) : null}
    </div>
  )
}

function Empty({ children }) {
  return <div className="baw-empty">{children}</div>
}

// ── Per-domain renderers (verified against live awareness/full payloads) ─────

const RENDERERS = {
  macro_confluence: (d) => {
    const snap = d.items?.[0]?.snapshot || {}
    const btc = snap.crypto?.BTC
    const eth = snap.crypto?.ETH
    const us10y = snap.yields?.US10Y
    const dxy = snap.fx?.DXY
    return [
      btc && <Row key="btc" label="BTC" extra={fmtUsd(btc.price_usd)} delta={btc.change_24h_pct} />,
      eth && <Row key="eth" label="ETH" extra={fmtUsd(eth.price_usd)} delta={eth.change_24h_pct} />,
      us10y && <Row key="10y" label="US10Y" extra={`${num(us10y.value)?.toFixed(2) ?? '—'}%`} />,
      dxy && <Row key="dxy" label="DXY" extra={num(dxy.value)?.toFixed(2)} delta={dxy.change_pct} />,
    ].filter(Boolean)
  },

  crypto: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No market movers</Empty>
    return items.map((r) => (
      <Row
        key={r.asset}
        label={(r.asset || '').split('_')[0] || '?'}
        extra={fmtUsd(r.price_usd)}
        delta={r.pct_change_24h}
      />
    ))
  },

  defi: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No DeFi protocols</Empty>
    return items.map((r) => (
      <Row
        key={r.protocol || r.slug || r.name}
        label={r.name || r.protocol || r.slug}
        extra={fmtUsd(r.tvl)}
        delta={r.change_1d ?? r.tvl_change_24h_pct}
      />
    ))
  },

  rwa: (d) => {
    const items = d.items || {}
    return [
      <Row key="aum" label="Total AUM" extra={fmtUsd(items.total_aum_usd)} />,
      <Row key="iss" label="Issuers" extra={fmtNum(items.issuer_count)} />,
      items.top_category && (
        <Row
          key="top"
          label={items.top_category.name}
          extra={fmtUsd(items.top_category.aum_usd)}
        />
      ),
    ].filter(Boolean)
  },

  trenches: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>Trenches quiet</Empty>
    return items.map((r) => (
      <Row
        key={r.asset || r.name}
        label={r.name || (r.asset || '').split('_')[0]}
        extra={`${fmtNum(r.mentions_24h)} ment`}
        delta={r.pct_change_24h}
      />
    ))
  },

  predictions: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No active markets</Empty>
    return items.map((r) => {
      const yes = num(r.outcome_yes) ?? 0
      return (
        <Row
          key={r.market_id}
          label={(r.question || '').slice(0, 38)}
          extra={`${(yes * 100).toFixed(0)}¢ YES`}
          title={r.question}
        />
      )
    })
  },

  whales: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No whale moves</Empty>
    return items.map((r) => (
      <Row
        key={r.tx_hash || r.time}
        label={`${r.asset || '?'} ${r.tx_type || ''}`.trim()}
        extra={fmtUsd(r.amount_usd)}
      />
    ))
  },

  kol: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No KOL spikes</Empty>
    return items.map((r) => (
      <Row
        key={r.asset}
        label={(r.asset || '?').toUpperCase()}
        extra={`${fmtNum(r.kol_count)} KOLs · ${fmtNum(r.mention_count)} ment`}
      />
    ))
  },

  derivatives: (d) => {
    const fund = d.items?.[0]?.funding_extremes || []
    if (!fund.length) return <Empty>No funding outliers</Empty>
    return fund.slice(0, 3).map((f) => {
      const rate = num(f.weighted_funding_rate)
      return (
        <Row
          key={f.asset + f.time}
          label={f.asset}
          extra={`${f.sentiment || ''}`.trim() || '—'}
          delta={rate != null ? rate * 100 : null}
          deltaDigits={3}
        />
      )
    })
  },

  etf_flows: (d) => {
    const items = d.items || []
    if (!items.length) return <Empty>Market closed — daily data</Empty>
    return items.slice(0, 3).map((r) => (
      <Row
        key={(r.asset || '') + (r.date || '')}
        label={`${r.asset || '?'} ${r.date || ''}`.trim()}
        extra={fmtUsd(r.net_flow_usd)}
      />
    ))
  },

  bridges: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No bridge activity</Empty>
    return items.map((r) => (
      <Row
        key={r.bridge}
        label={r.display_name || r.bridge}
        extra={fmtUsd(r.volume_24h)}
        delta={r.volume_change_pct}
      />
    ))
  },

  stablecoins: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No stablecoin movers</Empty>
    return items.map((r) => {
      const price = num(r.price) ?? 1
      const pegBps = (1 - price) * 10000
      return (
        <Row
          key={r.symbol}
          label={r.symbol}
          extra={`peg ${pegBps >= 0 ? '+' : ''}${pegBps.toFixed(1)}bps`}
          delta={r.circulating_change_24h_pct}
        />
      )
    })
  },

  categories: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No sector data</Empty>
    return items.map((r) => (
      <Row
        key={r.id || r.name}
        label={r.name || r.id}
        extra={fmtUsd(r.market_cap_usd)}
        delta={r.change_24h_pct ?? r.market_cap_change_24h_pct}
      />
    ))
  },

  mindshare: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No mindshare data</Empty>
    return items.map((r) => (
      <Row
        key={r.asset || r.symbol}
        label={(r.asset || r.symbol || '?').toUpperCase()}
        extra={`${num(r.mindshare_pct)?.toFixed(2) ?? '—'}%`}
        delta={r.mindshare_change_24h ?? r.mindshare_7d_change}
      />
    ))
  },

  news: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No headlines</Empty>
    return items.map((r, i) => (
      <div key={i} className="baw-row baw-row--news" title={r.title}>
        <span className="baw-row-label baw-news-title">{r.title}</span>
        {r.related_assets?.length ? (
          <span className="baw-row-extra">{r.related_assets.slice(0, 3).join(', ')}</span>
        ) : null}
      </div>
    ))
  },

  calendar: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No events scheduled</Empty>
    return items.map((r, i) => (
      <Row
        key={i}
        label={(r.event_name || r.title || 'Event').slice(0, 36)}
        extra={r.date || r.event_time}
        title={r.event_name || r.title}
      />
    ))
  },

  narratives: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No active narratives</Empty>
    return items.map((r) => (
      <Row
        key={r.narrative}
        label={r.display_name || r.narrative}
        extra={`${num(r.mention_share_pct)?.toFixed(2) ?? '—'}% · ${r.asset_count || 0}`}
        delta={r.mcap_change_24h}
      />
    ))
  },

  hacks: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No recent incidents</Empty>
    return items.map((r, i) => (
      <Row
        key={i}
        label={r.protocol || r.target || 'Incident'}
        extra={fmtUsd(r.loss_usd ?? r.amount_usd)}
      />
    ))
  },

  airdrops: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No active airdrops</Empty>
    return items.map((r) => (
      <Row
        key={r.project}
        label={r.project}
        extra={r.status || (r.claim_end && `ends ${r.claim_end.slice(0, 10)}`) || ''}
      />
    ))
  },

  governance: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No active proposals</Empty>
    return items.map((r) => (
      <Row
        key={r.proposal_id || r.title}
        label={(r.title || r.proposal_id || '').slice(0, 38)}
        extra={r.status || r.protocol}
        title={r.title}
      />
    ))
  },

  x_intelligence: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>X intel quiet</Empty>
    return items.map((r) => (
      <Row
        key={r.asset}
        label={(r.asset || '?').toUpperCase()}
        extra={`${fmtNum(r.mentions_24h)} ment · ${fmtNum(r.engagement_24h)} eng`}
        delta={r.velocity_ratio != null ? (num(r.velocity_ratio) - 1) * 100 : null}
      />
    ))
  },

  top_treasuries: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No treasury data</Empty>
    return items.map((r, i) => (
      <Row
        key={r.entity_name + i}
        label={r.entity_name}
        extra={`${r.asset || '?'} · ${fmtUsd(r.total_current_value_usd)}`}
      />
    ))
  },

  vc_flows: (d) => {
    const items = (d.items || []).filter((r) => r.project_name).slice(0, 3)
    if (!items.length) return <Empty>No fresh raises</Empty>
    return items.map((r, i) => (
      <Row
        key={(r.project_name || '') + i}
        label={r.project_name}
        extra={`${r.round_type || 'raise'} · ${fmtUsd(r.amount_raised_usd)}`}
      />
    ))
  },

  unlocks: (d) => {
    const items = (d.items || []).slice(0, 3)
    if (!items.length) return <Empty>No upcoming unlocks</Empty>
    return items.map((r) => (
      <Row
        key={r.asset + r.unlock_date}
        label={(r.asset || '?').toUpperCase()}
        extra={`${r.unlock_date?.slice(0, 10)} · ${fmtUsd(r.amount_usd) || fmtNum(r.amount)}`}
        delta={r.pct_of_supply != null ? num(r.pct_of_supply) : null}
      />
    ))
  },

  smart_money: (d) => {
    // Filter out rollup rows (label==='whale_rollup' with no real signal)
    const items = (d.items || [])
      .filter((r) => r.label !== 'whale_rollup' && r.amount_usd > 0)
      .slice(0, 3)
    if (!items.length) return <Empty>No smart-money flows</Empty>
    return items.map((r, i) => (
      <Row
        key={i}
        label={r.label || r.entity_name || (r.address || '').slice(0, 10)}
        extra={`${r.action || '?'} ${r.asset || ''} · ${fmtUsd(r.amount_usd)}`}
      />
    ))
  },

  intelligence: (d) => {
    const items = d.items || {}
    const obs = items.observations || []
    const sig = items.signals || []
    return [
      <Row key="obs" label="Observations" extra={fmtNum(obs.length)} />,
      <Row key="sig" label="Signals" extra={fmtNum(sig.length)} />,
      obs[0] && (
        <Row
          key="top"
          label={(obs[0].asset || obs[0].title || 'top obs').slice(0, 18)}
          extra={(obs[0].headline || '').slice(0, 28) || '—'}
        />
      ),
    ].filter(Boolean)
  },
}

function fallback(d) {
  const items = d?.items
  if (!items || (Array.isArray(items) && !items.length)) {
    return <Empty>No data</Empty>
  }
  if (Array.isArray(items)) {
    return (
      <div className="baw-row baw-row--raw">
        <span className="baw-row-label">{Object.keys(items[0]).slice(0, 3).join(' · ')}</span>
        <span className="baw-row-extra">{items.length} rows</span>
      </div>
    )
  }
  return <Empty>—</Empty>
}

// ── Domain meta — clean text labels, NO emojis ───────────────────────────────
const DOMAIN_META = [
  { key: 'macro_confluence',  label: 'Macro' },
  { key: 'crypto',            label: 'Crypto Movers' },
  { key: 'derivatives',       label: 'Derivatives' },
  { key: 'mindshare',         label: 'Mindshare' },
  { key: 'narratives',        label: 'Narratives' },
  { key: 'categories',        label: 'Sectors' },
  { key: 'trenches',          label: 'Trenches' },
  { key: 'kol',               label: 'KOLs' },
  { key: 'x_intelligence',    label: 'X Intel' },
  { key: 'whales',            label: 'Whales' },
  { key: 'smart_money',       label: 'Smart Money' },
  { key: 'defi',              label: 'DeFi' },
  { key: 'rwa',               label: 'RWA' },
  { key: 'stablecoins',       label: 'Stablecoins' },
  { key: 'etf_flows',         label: 'ETF Flows' },
  { key: 'top_treasuries',    label: 'Treasuries' },
  { key: 'vc_flows',          label: 'VC Flows' },
  { key: 'unlocks',           label: 'Unlocks' },
  { key: 'bridges',           label: 'Bridges' },
  { key: 'predictions',       label: 'Predictions' },
  { key: 'news',              label: 'News' },
  { key: 'calendar',          label: 'Calendar' },
  { key: 'hacks',             label: 'Hacks' },
  { key: 'airdrops',          label: 'Airdrops' },
  { key: 'governance',        label: 'Governance' },
  { key: 'intelligence',      label: 'Internal Signals' },
]

// ── Hierarchy: fresh movers first, quiet dimmed, empties collapsed ──────────
function countOf(d) {
  if (!d) return 0
  if (Array.isArray(d.items)) return d.items.length
  if (d.items && typeof d.items === 'object') return Object.keys(d.items).length
  return 0
}
function classify(d) {
  const count = countOf(d)
  if (count === 0) return { count, tier: 'empty', ageMs: null }
  const ts = d?.ts
  const t = ts ? new Date(typeof ts === 'number' ? ts : ts).getTime() : NaN
  const ageMs = Number.isFinite(t) ? Date.now() - t : null
  let tier = 'normal'
  if (ageMs != null && ageMs >= 0 && ageMs < 5 * 60_000) tier = 'hot'
  else if (ageMs != null && ageMs > 60 * 60_000) tier = 'quiet'
  return { count, tier, ageMs }
}
const TIER_RANK = { hot: 0, normal: 1, quiet: 2 }

const DomainCard = memo(function DomainCard({ meta, domain, count, tier }) {
  const renderer = RENDERERS[meta.key] || fallback
  const ts = domain?.ts
  const ageStr = ts ? relTime(typeof ts === 'number' ? new Date(ts).toISOString() : ts) : null

  return (
    <div className={`baw-card baw-card--${tier}`}>
      <div className="baw-card-head">
        <span className="baw-card-label">{meta.label}</span>
        <div className="baw-card-meta">
          {ageStr && <span className="baw-card-age">{ageStr}</span>}
          <span className="baw-card-count">{count}</span>
        </div>
      </div>
      <div className="baw-card-body">
        {domain ? renderer(domain) : <Empty>—</Empty>}
      </div>
    </div>
  )
})

export default function BrainAwarenessGrid({ data, loading, lastUpdated }) {
  const generatedAt = data?.generated_at || data?.generated_at_utc || lastUpdated

  const classified = DOMAIN_META.map((m) => ({ meta: m, domain: data?.[m.key], ...classify(data?.[m.key]) }))
  const active = classified
    .filter((x) => x.tier !== 'empty')
    .sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || ((a.ageMs ?? Infinity) - (b.ageMs ?? Infinity)) || (b.count - a.count))
  const empties = classified.filter((x) => x.tier === 'empty')

  return (
    <section className="baw-section">
      <header className="baw-section-head">
        <div className="baw-section-titles">
          <span className="baw-eyebrow">Omni Awareness</span>
          <h2 className="baw-section-title">What the Brain sees right now</h2>
          <p className="baw-section-sub">
            {DOMAIN_META.length} domains, refreshed every 60 seconds — macro, crypto,
            on-chain, social, derivs, ETF, narratives, KOL, hacks and unlocks: the
            cross-context layer that powers every synthesis.
          </p>
        </div>
        <FreshnessTag timestamp={generatedAt} tier="hot" />
      </header>

      {loading && !data && (
        <div className="baw-grid">
          {DOMAIN_META.slice(0, 12).map((m) => (
            <div key={m.key} className="baw-card baw-card--skeleton">
              <div className="baw-card-head">
                <span className="baw-card-label">{m.label}</span>
              </div>
              <div className="baw-card-body">
                <div className="baw-skel-line" />
                <div className="baw-skel-line" style={{ width: '78%' }} />
                <div className="baw-skel-line" style={{ width: '52%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="baw-grid">
            {active.map((x) => (
              <DomainCard key={x.meta.key} meta={x.meta} domain={x.domain} count={x.count} tier={x.tier} />
            ))}
          </div>
          {empties.length > 0 && (
            <div className="baw-quiet-tail">
              <span className="baw-quiet-n">{empties.length} {empties.length === 1 ? 'domain' : 'domains'} quiet</span>
              <span className="baw-quiet-list">{empties.map((e) => e.meta.label).join(', ')}</span>
            </div>
          )}
        </>
      )}
    </section>
  )
}
