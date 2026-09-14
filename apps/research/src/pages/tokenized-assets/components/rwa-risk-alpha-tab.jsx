import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import RwaComposabilityWeb from './rwa-composability-web'
import { RwaEmptyState } from './shared'
import './risk-alpha.css'

/**
 * Phase 7/8 — Risk & Alpha tab.
 *
 * The barest surface of /tokenized-assets: six flagship signals nobody else
 * publishes, most awaiting backend population:
 *   1. Top NAV Deviations   (alpha)
 *   2. Whale Concentration  (risk)
 *   3. Tokenization Velocity (regime)
 *   4. Live Issuer Events   (flow)
 *   5. Sovereign Yield Curve (rates)
 *   6. DeFi Composability    (graph)
 *
 * Every card is built on the shared foundation primitives (ta-chart-frame +
 * RwaEmptyState) so it renders identically to the other six tabs and never
 * looks broken while empty — each degrades to a premium "collecting" state
 * the moment its data slice is null. Tab-specific viz lives under the scoped
 * `ral-` namespace in risk-alpha.css.
 */
export default function RwaRiskAlphaTab({
  navWatch,
  concentrationLeaderboard,
  velocity,
  events,
  composabilityGraph,
  yieldCurve,
  loading = false,
  onAssetOpen,
}) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (v) => (v == null || !isFinite(v) ? '—' : fmtLargeShort(v))

  const navTop = useMemo(() => {
    if (!navWatch || !Array.isArray(navWatch.issuers)) return []
    return navWatch.issuers.slice(0, 5)
  }, [navWatch])

  const concentrationTop = useMemo(() => {
    if (!concentrationLeaderboard || !Array.isArray(concentrationLeaderboard.tokens)) return []
    return concentrationLeaderboard.tokens.slice(0, 5)
  }, [concentrationLeaderboard])

  const velocityToday = velocity?.today || null
  const velocityRegime = velocity?.regime || null

  const eventsTop = useMemo(() => {
    if (!events || !Array.isArray(events.events)) return []
    return events.events.slice(0, 10)
  }, [events])

  // Phase 8: spotlight issuer for the composability card. Pick the graph node
  // with the MOST outgoing edges so "Where it plugs" is always populated and
  // meaningful — defaulting to a NAV-deviation issuer (e.g. ondo-usdy) often
  // landed on a node with zero curated edges, leaving the card empty. Falls
  // back to the top NAV-deviation issuer, then a flagship slug.
  const composabilitySpotlight = useMemo(() => {
    const edges = composabilityGraph?.edges
    if (Array.isArray(edges) && edges.length) {
      const counts = {}
      for (const e of edges) { if (e?.source) counts[e.source] = (counts[e.source] || 0) + 1 }
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      if (best) return best[0]
    }
    return navTop?.[0]?.slug || 'ondo-usdy'
  }, [composabilityGraph, navTop])

  return (
    <div className="ral-tab">
      <header className="ral-head">
        <h2 className="ral-head__title">{t('tokenizedAssets.risk.title', 'Risk & Alpha')}</h2>
        <p className="ral-head__sub">
          {t('tokenizedAssets.risk.subtitle', 'Signals nobody else publishes. NAV deviation, whale concentration, tokenization velocity, a live issuer event feed, the sovereign yield curve, and DeFi composability.')}
        </p>
      </header>

      <RwaComposabilityWeb graph={composabilityGraph} onAssetOpen={onAssetOpen} />

      <div className="ral-grid">
        <NavWatchCard data={navTop} alertCount={navWatch?.alert_count} loading={loading} onAssetOpen={onAssetOpen} />
        <ConcentrationCard data={concentrationTop} loading={loading} onAssetOpen={onAssetOpen} />
        <VelocityCard today={velocityToday} regime={velocityRegime} series={velocity?.series} loading={loading} fmtMoney={fmtMoney} />
        <EventsCard data={eventsTop} loading={loading} t={t} fmtMoney={fmtMoney} />
        <YieldCurveCard data={yieldCurve} loading={loading} />
        <ComposabilityCard graph={composabilityGraph} rootSlug={composabilitySpotlight} loading={loading} onAssetOpen={onAssetOpen} />
      </div>
    </div>
  )
}

/* ── Shared card shell — every card is a ta-chart-frame so the tab matches
   the other six tabs exactly, with the head carrying an eyebrow + pill. ── */
function SignalFrame({ eyebrow, dotCls, title, sub, pill, wide, children }) {
  return (
    <section className={`ta-chart-frame ral-frame${wide ? ' ral-grid__wide' : ''}`}>
      <div className="ta-chart-frame__head">
        <div className="ta-chart-frame__titles">
          <span className="ral-frame__eyebrow">
            <span className={`ral-frame__dot${dotCls ? ` ${dotCls}` : ''}`} />
            {eyebrow}
          </span>
          <span className="ta-chart-frame__title">{title}</span>
          {sub && <span className="ta-chart-frame__sub">{sub}</span>}
        </div>
        {pill}
      </div>
      <div className="ta-chart-frame__plot">{children}</div>
    </section>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  NAV Deviation card                                                       */
/* ════════════════════════════════════════════════════════════════════════ */

function NavWatchCard({ data, alertCount, loading, onAssetOpen }) {
  const maxAbs = useMemo(() => {
    const vals = data.map((i) => (Number.isFinite(i.nav_deviation_bps) ? Math.abs(i.nav_deviation_bps) : 0))
    return Math.max(1, ...vals)
  }, [data])

  const pill = data.length === 0 ? null : alertCount > 0 ? (
    <span className="ral-pill ral-pill--alert">{alertCount} alert{alertCount === 1 ? '' : 's'}</span>
  ) : (
    <span className="ral-pill ral-pill--ok"><span className="ral-pill__dot" />in band</span>
  )

  return (
    <SignalFrame eyebrow="Alpha signal" dotCls="ral-frame__dot--alpha" title="Top NAV Deviations" sub="Token price vs declared NAV" pill={pill}>
      {data.length === 0 ? (
        loading ? <RowSkeleton rows={5} /> : (
          <RwaEmptyState
            framed={false}
            title="Collecting NAV snapshots"
            copy="First deviation readings land ~10 minutes after deploy, then refresh continuously."
          />
        )
      ) : (
        <ul className="ral-list">
          {data.map((i) => {
            const bps = Number.isFinite(i.nav_deviation_bps) ? i.nav_deviation_bps : null
            const positive = bps != null && bps > 0
            const dirCls = positive ? 'ral-bull' : (bps != null && bps < 0 ? 'ral-bear' : '')
            const barW = bps != null ? Math.min(100, (Math.abs(bps) / maxAbs) * 100) : 0
            return (
              <li key={i.slug} className="ral-row" onClick={() => onAssetOpen?.(i.slug)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onAssetOpen?.(i.slug) }}>
                <div className="ral-row__main">
                  <span className="ral-row__name">{i.name}</span>
                  <span className="ral-row__meta">{i.direction || '—'} · {(i.flags || []).join(', ') || 'normal'}</span>
                </div>
                <div className={`ral-devbar ${dirCls}`} aria-hidden>
                  <span
                    className="ral-devbar__fill"
                    style={positive
                      ? { left: '50%', right: 'auto', width: `${barW / 2}%` }
                      : { right: '50%', left: 'auto', width: `${barW / 2}%` }}
                  />
                </div>
                <div className={`ral-row__metric ${dirCls}`}>
                  <span className="ral-row__big">{bps != null ? `${positive ? '+' : ''}${bps.toFixed(1)}` : '—'} <small>bps</small></span>
                  <span className="ral-row__sub">${(i.price_observed || 0).toFixed(4)} / ${(i.nav_declared || 0).toFixed(4)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </SignalFrame>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Whale Concentration card                                                 */
/* ════════════════════════════════════════════════════════════════════════ */

function ConcentrationCard({ data, loading, onAssetOpen }) {
  const pill = data.length === 0 ? null : <span className="ral-pill">top 10% holders</span>

  return (
    <SignalFrame eyebrow="Risk signal" dotCls="ral-frame__dot--risk" title="Whale Concentration" sub="Share held by the largest wallets" pill={pill}>
      {data.length === 0 ? (
        loading ? <ConcentrationSkeleton rows={5} /> : (
          <RwaEmptyState
            framed={false}
            title="Awaiting first holder scan"
            copy="Concentration snapshots are written hourly per indexed token. The first cycle is in progress."
          />
        )
      ) : (
        <div className="ral-conc">
          {data.map((tk) => {
            const top10 = tk.top10_pct != null ? tk.top10_pct * 100 : null
            const delta = tk.top10_delta_24h != null ? tk.top10_delta_24h * 100 : null
            const dCls = delta == null ? '' : delta > 0 ? 'ral-bear' : delta < 0 ? 'ral-bull' : ''
            const hot = top10 != null && top10 >= 70
            return (
              <div key={`${tk.chain}:${tk.contract}`} className="ral-conc__row" onClick={() => tk.slug && onAssetOpen?.(tk.slug)} role="button" tabIndex={0}
                   onKeyDown={(e) => { if (e.key === 'Enter' && tk.slug) onAssetOpen?.(tk.slug) }}>
                <span className="ral-conc__name">{tk.name}</span>
                <span className="ral-conc__val">{top10 != null ? `${top10.toFixed(1)}%` : '—'}</span>
                <div className="ral-conc__track" aria-hidden>
                  <span className={`ral-conc__bar${hot ? ' ral-conc__bar--hot' : ''}`} style={{ width: `${top10 != null ? Math.min(100, top10) : 0}%` }} />
                </div>
                <div className="ral-conc__foot">
                  <span>
                    {tk.whale_count != null ? `${formatInt(tk.whale_count)} whales` : '—'}
                    {' · '}
                    {tk.retail_count != null ? `${formatInt(tk.retail_count)} retail` : '—'}
                  </span>
                  {delta != null && (
                    <span className={`ral-conc__delta ${dCls}`}>{delta > 0 ? '+' : ''}{delta.toFixed(2)}% 24h</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SignalFrame>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Velocity card                                                            */
/* ════════════════════════════════════════════════════════════════════════ */

const REGIME_LABELS = {
  accelerating: 'accelerating',
  steady: 'steady',
  decelerating: 'decelerating',
  contracting: 'contracting',
  insufficient_data: 'collecting',
}
const REGIME_PILL = {
  accelerating: 'ral-pill--bull',
  steady: '',
  decelerating: 'ral-pill--warn',
  contracting: 'ral-pill--bear',
  insufficient_data: '',
}

function VelocityCard({ today, regime, series, loading, fmtMoney }) {
  const spark = useMemo(() => buildSpark(series), [series])
  const net = today?.net_velocity_usd
  const positive = Number.isFinite(net) && net > 0
  const negative = Number.isFinite(net) && net < 0
  const fmt = (x) => (Number.isFinite(x) ? fmtMoney(x) : '—')
  const regimeLabel = REGIME_LABELS[regime] || regime || 'collecting'
  const regimePill = REGIME_PILL[regime] || ''
  const sparkCls = positive ? 'ral-spark--bull' : negative ? 'ral-spark--bear' : 'ral-spark--flat'

  if (loading && !today) {
    return (
      <SignalFrame eyebrow="Regime" title="Tokenization Velocity" sub="Net mint vs burn flow" pill={<span className="ral-skel" style={{ width: 76, height: 20, borderRadius: 999 }} />}>
        <div className="ral-velo">
          <span className="ral-skel ral-skel--hero" />
          <div className="ral-skel-split">
            <span className="ral-skel ral-skel--cell" />
            <span className="ral-skel ral-skel--cell" />
          </div>
          <span className="ral-skel ral-skel--spark" />
        </div>
      </SignalFrame>
    )
  }

  const hasData = today != null
  const pill = <span className={`ral-pill ${regimePill}`}>{regimeLabel}</span>

  return (
    <SignalFrame eyebrow="Regime" dotCls="ral-frame__dot--alpha" title="Tokenization Velocity" sub="Net mint vs burn flow" pill={pill}>
      {!hasData ? (
        <RwaEmptyState
          framed={false}
          title="Building the velocity baseline"
          copy="Net mint/burn velocity needs a full day of issuer flow before the regime stabilises."
        />
      ) : (
        <div className="ral-velo">
          <div className="ral-velo__hero">
            <span className={`ral-velo__big ${positive ? 'ral-bull' : negative ? 'ral-bear' : ''}`}>
              {Number.isFinite(net) ? `${positive ? '+' : ''}${fmt(net)}` : '—'}
            </span>
            <span className="ral-velo__cap">today's net velocity (USD)</span>
          </div>
          <div className="ral-velo__split">
            <div className="ral-velo__cell">
              <span className="ral-velo__label">Inflow</span>
              <span className="ral-velo__num ral-bull">+{fmt(today?.gross_inflow_usd)}</span>
              <span className="ral-velo__hint">{today?.issuers_with_inflow ?? '—'} issuers</span>
            </div>
            <div className="ral-velo__cell">
              <span className="ral-velo__label">Outflow</span>
              <span className="ral-velo__num ral-bear">-{fmt(today?.gross_outflow_usd)}</span>
              <span className="ral-velo__hint">{today?.issuers_with_outflow ?? '—'} issuers</span>
            </div>
          </div>
          {spark ? (
            <svg className={`ral-spark ${sparkCls}`} viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden>
              <path className="ral-spark__area" d={`${spark} L 200 56 L 0 56 Z`} fill="currentColor" opacity="0.08" />
              <path className="ral-spark__line" pathLength="1" d={spark} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </div>
      )}
    </SignalFrame>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Live Events card                                                          */
/* ════════════════════════════════════════════════════════════════════════ */

function EventsCard({ data, loading, t, fmtMoney }) {
  const pill = data.length === 0 ? null : (
    <span className="ral-pill ral-pill--ok"><span className="ral-pill__dot" />live · {data.length}</span>
  )

  return (
    <SignalFrame eyebrow="Live flow" dotCls="ral-frame__dot--live" title="Issuer Events" sub="Mints, burns & large transfers" pill={pill}>
      {data.length === 0 ? (
        loading ? <RowSkeleton rows={6} /> : (
          <RwaEmptyState
            framed={false}
            title="No on-chain events yet"
            copy="The indexer is live and watching every tracked issuer — mints, burns and large transfers stream in here as they confirm."
          />
        )
      ) : (
        <ul className="ral-events">
          {data.map((e) => (
            <li key={e.id} className="ral-event">
              <span className={`ral-event__type ral-event__type--${e.event_type}`}>
                <span className="ral-event__tdot" />
                {e.event_type === 'mint' ? 'mint' : e.event_type === 'burn' ? 'burn' : 'transfer'}
              </span>
              <div className="ral-event__body">
                <span className="ral-event__slug">{e.slug || e.contract}</span>
                <span className="ral-event__amt">
                  {e.amount_tokens != null ? formatCompactNum(e.amount_tokens) : '—'} {t('tokenizedAssets.risk.tokensWord', 'tokens')}
                  {e.amount_usd != null ? ` · ${fmtMoney(e.amount_usd)}` : ''}
                </span>
              </div>
              <span className="ral-event__time">{relativeTime(e.detected_at)}</span>
              {e.tx_url ? (
                <a href={e.tx_url} target="_blank" rel="noopener noreferrer" className="ral-event__tx" aria-label="View transaction">{ExtLinkGlyph}</a>
              ) : <span />}
            </li>
          ))}
        </ul>
      )}
    </SignalFrame>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Yield Curve card (Phase 8)                                                */
/* ════════════════════════════════════════════════════════════════════════ */

const CURVE_BUCKETS = ['1m', '3m', '6m', '1y', '2y', '3y', '5y']

function YieldCurveCard({ data, loading }) {
  const buckets = useMemo(() => {
    if (!data || !Array.isArray(data.buckets)) return []
    return data.buckets
  }, [data])

  if (loading && buckets.length === 0) {
    return (
      <SignalFrame eyebrow="Rates" title="Sovereign Yield Curve" sub="Tokenised T-bill APY vs FRED" wide pill={<span className="ral-skel" style={{ width: 96, height: 20, borderRadius: 999 }} />}>
        <div className="ral-curve">
          <span className="ral-skel ral-skel--plot" />
          <div className="ral-skel-stack">
            {CURVE_BUCKETS.map((m) => <span key={m} className="ral-skel" style={{ height: 14 }} />)}
          </div>
        </div>
      </SignalFrame>
    )
  }

  const fred = data?.fred_treasury_curve || {}
  const spread = data?.spread_vs_fred || {}
  const spread3m = Number.isFinite(spread['3m']) ? spread['3m'] : null
  const headlineCls = spread3m == null ? '' : spread3m > 0 ? 'ral-pill--bull' : spread3m < 0 ? 'ral-pill--bear' : ''

  const apyValues = CURVE_BUCKETS.map((m) => {
    const b = buckets.find((x) => x.maturity === m)
    return b && Number.isFinite(b.median_apy_pct) ? b.median_apy_pct : null
  })
  const fredValues = CURVE_BUCKETS.map((m) => (Number.isFinite(fred[m]) ? fred[m] : null))
  const allFinite = [...apyValues, ...fredValues].filter((v) => Number.isFinite(v))
  const yMin = allFinite.length ? Math.min(...allFinite) : 0
  const yMax = allFinite.length ? Math.max(...allFinite) : 0
  const range = (yMax - yMin) || 1

  const width = 600
  const height = 96
  const padY = 10
  const xStep = width / (CURVE_BUCKETS.length - 1)
  const toY = (v) => (height - padY) - ((v - yMin) / range) * (height - padY * 2)

  const linePath = (vals) => {
    const seg = []
    let started = false
    vals.forEach((v, i) => {
      if (v == null) return
      seg.push(`${!started ? 'M' : 'L'} ${(i * xStep).toFixed(1)},${toY(v).toFixed(1)}`)
      started = true
    })
    return seg.join(' ')
  }
  const apyPath = linePath(apyValues)
  const fredPath = linePath(fredValues)
  const totalIssuers = buckets.reduce((acc, b) => acc + (b.issuer_count || 0), 0)

  const pill = spread3m != null ? (
    <span className={`ral-pill ${headlineCls}`}>{spread3m > 0 ? '+' : ''}{spread3m.toFixed(2)} pp · 3m vs FRED</span>
  ) : (
    <span className="ral-pill">FRED reference</span>
  )

  return (
    <SignalFrame eyebrow="Rates" dotCls="ral-frame__dot--alpha" title="Sovereign Yield Curve" sub="Tokenised T-bill APY vs FRED" wide pill={pill}>
      <div className="ral-curve">
        <div className="ral-curve__plot">
          <svg className="ral-curve__svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Sovereign yield curve">
            <line className="ral-curve__grid" x1="0" y1={height - padY} x2={width} y2={height - padY} />
            <line className="ral-curve__grid" x1="0" y1={padY} x2={width} y2={padY} />
            {fredPath ? <path className="ral-curve__fred" d={fredPath} /> : null}
            {apyPath ? <path className="ral-curve__apy" pathLength="1" d={apyPath} /> : null}
            {apyValues.map((v, i) => v == null ? null : (
              <circle key={i} className="ral-curve__node" cx={(i * xStep).toFixed(1)} cy={toY(v).toFixed(1)} r="2.5" />
            ))}
          </svg>
        </div>
        <div className="ral-curve__axis">
          {CURVE_BUCKETS.map((m) => <span key={m} className="ral-curve__tick">{m}</span>)}
        </div>
        <div className="ral-curve__legend">
          <span className="ral-curve__leg"><span className="ral-curve__swatch ral-curve__swatch--apy" />Tokenised APY</span>
          <span className="ral-curve__leg"><span className="ral-curve__swatch ral-curve__swatch--fred" />FRED Treasury</span>
        </div>

        {totalIssuers === 0 ? (
          <RwaEmptyState
            framed={false}
            title="Issuer overlay accruing"
            copy="The FRED reference curve is plotted above. NAV-growth-derived APYs need 30 days of issuer snapshots — the overlay fills in as history accrues."
          />
        ) : (
          <ul className="ral-curve__table">
            <li className="ral-curve__rowhead">
              <span>Mat</span><span>Issuers</span><span>APY</span><span>FRED</span><span>Spread</span>
            </li>
            {CURVE_BUCKETS.map((m) => {
              const b = buckets.find((x) => x.maturity === m)
              const apy = b && Number.isFinite(b.median_apy_pct) ? b.median_apy_pct : null
              const fr = Number.isFinite(fred[m]) ? fred[m] : null
              const sp = Number.isFinite(spread[m]) ? spread[m] : null
              return (
                <li key={m} className="ral-curve__row">
                  <span className="ral-curve__mat">{m}</span>
                  <span>{b?.issuer_count ? `n=${b.issuer_count}` : '—'}</span>
                  <span>{apy != null ? `${apy.toFixed(2)}%` : '—'}</span>
                  <span>{fr != null ? `${fr.toFixed(2)}%` : '—'}</span>
                  <span className={sp == null ? '' : sp > 0 ? 'ral-bull' : sp < 0 ? 'ral-bear' : ''}>
                    {sp != null ? `${sp > 0 ? '+' : ''}${sp.toFixed(2)} pp` : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SignalFrame>
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Composability card (Phase 8)                                              */
/* ════════════════════════════════════════════════════════════════════════ */

function ComposabilityCard({ graph, rootSlug, loading, onAssetOpen }) {
  const outgoing = useMemo(() => {
    if (!graph || !Array.isArray(graph.edges) || !rootSlug) return []
    return graph.edges
      .filter((e) => e.source === rootSlug)
      .sort((a, b) => {
        const av = Number.isFinite(a.yield_apy_pct) ? a.yield_apy_pct : -Infinity
        const bv = Number.isFinite(b.yield_apy_pct) ? b.yield_apy_pct : -Infinity
        return bv - av
      })
      .slice(0, 3)
  }, [graph, rootSlug])

  const totalEdges = graph?.edge_count || (Array.isArray(graph?.edges) ? graph.edges.length : 0)
  const pill = <span className="ral-pill">{totalEdges} edges</span>

  return (
    <SignalFrame eyebrow="DeFi composability" dotCls="ral-frame__dot--live" title="Where It Plugs" sub="Curated integration graph" wide pill={pill}>
      <div className="ral-compose">
        <p className="ral-compose__subject">
          Spotlight
          <button type="button" className="ral-compose__root" onClick={() => onAssetOpen?.(rootSlug)}>{rootSlug}</button>
        </p>
        {outgoing.length === 0 ? (
          loading ? <RowSkeleton rows={3} /> : (
            <RwaEmptyState
              framed={false}
              title="No curated integrations yet"
              copy={`No outgoing edges mapped for ${rootSlug} so far. Composability is editorial — integrations are added as they are verified.`}
            />
          )
        ) : (
          <ul className="ral-compose__list">
            {outgoing.map((e) => (
              <li key={`${e.source}->${e.target}::${e.relationship}`} className="ral-compose__edge">
                <div className="ral-compose__rel">
                  <span className="ral-compose__verb">{prettifyRel(e.relationship)}</span>
                  <span className="ral-compose__arrow">→</span>
                  <button type="button" className="ral-compose__target" onClick={() => onAssetOpen?.(e.target)}>{e.target}</button>
                  <div className="ral-compose__meta">
                    {Number.isFinite(e.yield_apy_pct) ? (
                      <span className="ral-compose__apy">{e.yield_apy_pct.toFixed(2)}% APY</span>
                    ) : (
                      <span className="ral-compose__noapy">no APY</span>
                    )}
                    {e.evidence_url ? (
                      <a href={e.evidence_url} target="_blank" rel="noopener noreferrer" className="ral-compose__evidence" aria-label="View evidence">{ExtLinkGlyph}</a>
                    ) : null}
                  </div>
                </div>
                {e.notes ? <p className="ral-compose__note">{e.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SignalFrame>
  )
}

function prettifyRel(rel) {
  if (!rel) return ''
  return String(rel).replace(/_/g, ' ')
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Skeletons — shimmer (ta-skel-slide), shown only while direct fetches are  */
/*  in flight so the tab never flashes the collecting state before data lands.*/
/* ════════════════════════════════════════════════════════════════════════ */

function RowSkeleton({ rows = 5 }) {
  return (
    <div className="ral-skel-stack" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="ral-skel ral-skel--row" />
      ))}
    </div>
  )
}

function ConcentrationSkeleton({ rows = 5 }) {
  return (
    <div className="ral-skel-stack" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="ral-skel" style={{ height: 40, borderRadius: 12 }} />
      ))}
    </div>
  )
}

/* ── Inline external-link glyph (spectreIcons has no scoped "out" arrow here;
   a stroked 14px node keeps it on-brand — no emoji, no icon-library import) ── */
const ExtLinkGlyph = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
)

/* ════════════════════════════════════════════════════════════════════════ */
/*  helpers                                                                   */
/* ════════════════════════════════════════════════════════════════════════ */

function formatInt(n) {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function formatCompactNum(n) {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  if (abs >= 1)   return n.toFixed(2)
  return n.toFixed(4)
}

function relativeTime(iso) {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function buildSpark(series) {
  if (!Array.isArray(series) || series.length < 2) return null
  const values = series.map((p) => Number(p.net_velocity_usd) || 0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const width = 200
  const height = 56
  const pad = 4
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = (height - pad) - ((v - min) / range) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return 'M ' + pts.join(' L ')
}
