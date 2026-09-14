import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import AIAnalysisCard from './AIAnalysisCard'
import TaTvlChart from './ta-tvl-chart'
import { hexToRgba, CHAIN_PALETTE } from '../rwa-shared'
import './ta-drawer.css'

/* Treat placeholder dashes / blanks as empty so they don't render as chips. */
function isMeaningful(v) {
  if (v == null) return false
  const s = String(v).trim()
  return s !== '' && s !== '-' && s !== '--' && s !== '—'
}

/* ── Fetch ── */
async function fetchDetail(slug) {
  const res = await fetch(`/api/rwa/protocol/${slug}/detail`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/* Phase 7 — pull issuer-direct data (credit rating, reconciliation status,
 * recent events). Best-effort: most slugs in this panel are RWA.xyz-style
 * protocol slugs (e.g. blackrock-buidl) which match our rwa_issuer registry.
 * 404s + network errors degrade silently — the panel renders without the
 * Phase 7 section. */
async function fetchIssuerOverlay(slug) {
  try {
    const res = await fetch(`/api/rwa/issuer/${encodeURIComponent(slug)}`)
    if (!res.ok) return null
    const json = await res.json()
    if (json?.error) return null
    return json
  } catch {
    return null
  }
}

/* ── Collapsible section ── */
function Section({ title, defaultOpen = true, children }) {
  return (
    <details className="ta-drawer-section" open={defaultOpen}>
      <summary className="ta-drawer-section-head">
        <span className="ta-drawer-section-title">{title}</span>
        <svg className="ta-drawer-section-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
      </summary>
      <div className="ta-drawer-section-body">{children}</div>
    </details>
  )
}

function Row({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div className="ta-drawer-row">
      <span className="ta-drawer-row-label">{label}</span>
      <span className="ta-drawer-row-value">{value}</span>
    </div>
  )
}

function Pill({ label, value, accent }) {
  return (
    <div className="ta-drawer-pill">
      <span className="ta-drawer-pill-label">{label}</span>
      <span className="ta-drawer-pill-value mono" style={accent ? { color: accent } : undefined}>{value ?? '\u2014'}</span>
    </div>
  )
}

function ChainBar({ chain, tvl, total, fmtMoney }) {
  const pct = total > 0 ? (tvl / total) * 100 : 0
  const color = CHAIN_PALETTE[chain] || 'var(--text-tertiary)'
  return (
    <div className="ta-drawer-chain">
      <span className="ta-drawer-chain-name">{chain}</span>
      <div className="ta-drawer-chain-track">
        <div className="ta-drawer-chain-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="ta-drawer-chain-val mono">{fmtMoney(tvl)}</span>
      <span className="ta-drawer-chain-pct mono">{pct.toFixed(1)}%</span>
    </div>
  )
}

/**
 * AssetDetailPanel — right-side drawer (desktop) / full-screen sheet (mobile)
 * with collapsible sections pulled from /api/rwa/protocol/:slug/detail.
 *
 * Props: { open, onClose, slug }
 */
export default function AssetDetailPanel({ open, onClose, slug }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (v) => (v == null || !isFinite(v) ? '—' : fmtLargeShort(v))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Phase 7 overlay (credit rating, reconciliation, events). Best-effort.
  const [overlay, setOverlay] = useState(null)

  useEffect(() => {
    if (!open || !slug) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    setOverlay(null)
    Promise.all([
      fetchDetail(slug),
      fetchIssuerOverlay(slug),
    ])
      .then(([d, o]) => {
        if (cancelled) return
        setData(d)
        setOverlay(o)
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [open, slug])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const chainTotal = useMemo(
    () => data?.chainBreakdown?.reduce((s, c) => s + (c.tvl || 0), 0) || 0,
    [data]
  )

  if (!open) return null

  // Portal up to `.app`: the page scroll container (.page-layout) has a
  // transform + will-change, making it the containing block for position:fixed
  // — so rendered inline the "fixed" overlay anchored to the scrolled container
  // and only covered the top ~half of the viewport. `.app` has no transform, so
  // fixed resolves to the viewport again; staying inside `.app` (not document.body)
  // keeps every `.app.app-day-mode` descendant rule matching.
  return createPortal(
    <div className="ta-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('tokenizedAssets.drawer.ariaLabel', 'Asset detail')}>
      <aside
        className="ta-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ta-drawer-drag-handle" aria-hidden="true" />

        <header className="ta-drawer-header">
          {data?.logo && (
            <img className="ta-drawer-logo" src={data.logo} alt="" onError={e => { e.target.style.display = 'none' }} />
          )}
          <div className="ta-drawer-header-text">
            <h2 className="ta-drawer-name">{data?.fullName || data?.name || (slug ? slug.replace(/-/g, ' ') : t('tokenizedAssets.drawer.loading', 'Loading'))}</h2>
            {(isMeaningful(data?.issuer) || isMeaningful(data?.symbol) || data?.chains?.length > 0) && (
              <div className="ta-drawer-meta">
                {isMeaningful(data?.issuer) && <span className="ta-drawer-meta-item">{data.issuer}</span>}
                {isMeaningful(data?.symbol) && <span className="ta-drawer-meta-item ta-drawer-meta-sym mono">{data.symbol}</span>}
                {data?.chains?.length > 0 && (
                  <span className="ta-drawer-meta-item">
                    {data.chains.length} {data.chains.length === 1
                      ? t('tokenizedAssets.drawer.network', 'network')
                      : t('tokenizedAssets.drawer.networks', 'networks')}
                  </span>
                )}
              </div>
            )}
          </div>
          <button type="button" className="ta-drawer-close" onClick={onClose} aria-label={t('tokenizedAssets.drawer.closePanel', 'Close panel')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div className="ta-drawer-body">
          {loading && !data && (
            <div className="ta-drawer-loading">
              <div className="ta-drawer-skel animate-shimmer" />
              <div className="ta-drawer-skel animate-shimmer stagger-2" style={{ width: '70%' }} />
              <div className="ta-drawer-skel animate-shimmer stagger-3" style={{ height: 160 }} />
            </div>
          )}

          {error && !data && (
            <div className="ta-drawer-error">
              <span>{t('tokenizedAssets.drawer.loadFailed', 'Failed to load protocol')}</span>
              <span className="ta-drawer-error-detail">{error}</span>
            </div>
          )}

          {data && (
            <>
              {data.tvlHistory?.length > 1 && (
                <TaTvlChart history={data.tvlHistory} currentTvl={data.currentTvl} />
              )}

              <AIAnalysisCard slug={slug} collapsedOnMobile={false} />

              {overlay && (overlay.credit_rating || overlay.reconciliation_status || (overlay.recent_events && overlay.recent_events.length > 0)) && (
                <Section title={t('tokenizedAssets.drawer.spectreRiskProfile', 'Spectre Risk Profile')} defaultOpen>
                  <div className="ta-drawer-pills">
                    {overlay.credit_rating?.grade && (
                      <Pill
                        label={t('tokenizedAssets.drawer.creditRating', 'Credit Rating')}
                        value={`${overlay.credit_rating.grade} (${overlay.credit_rating.score}/10)`}
                        accent={
                          /^A/.test(overlay.credit_rating.grade) ? 'var(--bull)' :
                          /^B/.test(overlay.credit_rating.grade) ? 'var(--text-primary)' :
                          'var(--bear)'
                        }
                      />
                    )}
                    {overlay.reconciliation_status && (
                      <Pill
                        label={t('tokenizedAssets.drawer.reconciliation', 'Reconciliation')}
                        value={overlay.reconciliation_status.replace(/_/g, ' ')}
                        accent={overlay.reconciliation_status === 'verified' ? 'var(--bull)' :
                                overlay.reconciliation_status === 'mismatch' ? 'var(--bear)' : null}
                      />
                    )}
                    {overlay.transparency_grade && (
                      <Pill label={t('tokenizedAssets.drawer.transparency', 'Transparency')} value={overlay.transparency_grade} />
                    )}
                    {overlay.latest?.nav_deviation_bps != null && (
                      <Pill
                        label={t('tokenizedAssets.drawer.navDeviation', 'NAV deviation')}
                        value={`${overlay.latest.nav_deviation_bps >= 0 ? '+' : ''}${overlay.latest.nav_deviation_bps.toFixed(1)} bps`}
                        accent={Math.abs(overlay.latest.nav_deviation_bps) >= 50 ? 'var(--bear)' : null}
                      />
                    )}
                  </div>
                  {overlay.credit_rating?.components && (
                    <div className="ta-drawer-rating-breakdown">
                      {Object.entries(overlay.credit_rating.components).map(([k, v]) => (
                        <Row
                          key={k}
                          label={k.replace(/_/g, ' ')}
                          value={`${v.score}/10  ·  ${v.reason}`}
                        />
                      ))}
                    </div>
                  )}
                  {overlay.recent_events?.length > 0 && (
                    <div className="ta-drawer-events">
                      <span className="ta-drawer-row-label" style={{ marginBottom: 6, display: 'block' }}>{t('tokenizedAssets.drawer.recentEvents', 'Recent events')}</span>
                      {overlay.recent_events.slice(0, 5).map((e, i) => (
                        <div key={`${e.tx_hash}-${i}`} className="ta-drawer-event-row">
                          <span className={`ra-event__type ra-event__type--${e.event_type}`}>
                            {e.event_type === 'mint' ? t('tokenizedAssets.drawer.eventMint', 'mint') : e.event_type === 'burn' ? t('tokenizedAssets.drawer.eventBurn', 'burn') : t('tokenizedAssets.drawer.eventLarge', 'large')}
                          </span>
                          <span className="mono">
                            {e.amount_tokens != null ? Math.round(e.amount_tokens).toLocaleString() : '—'}
                            {e.amount_usd != null ? ` · ${fmtMoney(e.amount_usd)}` : ''}
                          </span>
                          <span className="ta-drawer-row-label" style={{ marginLeft: 'auto' }}>
                            {new Date(e.detected_at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              <Section title={t('tokenizedAssets.drawer.marketData', 'Market Data')} defaultOpen>
                <div className="ta-drawer-pills">
                  <Pill label={t('tokenizedAssets.kpi.aum', 'AUM')} value={fmtMoney(data.currentTvl)} />
                  <Pill label={t('tokenizedAssets.drawer.apy30d', '30D APY')} value={data.apy_30d} />
                  <Pill label={t('tokenizedAssets.drawer.change7d', '7D Change')} value={data.change_7d != null ? `${data.change_7d >= 0 ? '+' : ''}${data.change_7d.toFixed(2)}%` : null}
                    accent={data.change_7d >= 0 ? 'var(--bull)' : 'var(--bear)'} />
                  <Pill label={t('tokenizedAssets.drawer.change30d', '30D Change')} value={data.change_30d != null ? `${data.change_30d >= 0 ? '+' : ''}${data.change_30d.toFixed(2)}%` : null}
                    accent={data.change_30d >= 0 ? 'var(--bull)' : 'var(--bear)'} />
                </div>
                {data.chainBreakdown?.length > 0 && (
                  <div className="ta-drawer-chains">
                    {data.chainBreakdown.slice(0, 8).map(c => (
                      <ChainBar key={c.chain} chain={c.chain} tvl={c.tvl} total={chainTotal} fmtMoney={fmtMoney} />
                    ))}
                  </div>
                )}
              </Section>

              <Section title={t('tokenizedAssets.drawer.productMetrics', 'Product Metrics')} defaultOpen={false}>
                <Row label={t('tokenizedAssets.drawer.investors', 'Investors')} value={data.investors != null ? data.investors.toLocaleString() : null} />
                <Row label={t('tokenizedAssets.drawer.redemption', 'Redemption')} value={data.redemption} />
                <Row label={t('tokenizedAssets.drawer.minInvestment', 'Min Investment')} value={data.min_investment} />
                <Row label={t('tokenizedAssets.drawer.mgmtFee', 'Mgmt Fee')} value={data.mgmt_fee} />
                <Row label={t('tokenizedAssets.drawer.duration', 'Duration')} value={data.duration} />
              </Section>

              <Section title={t('tokenizedAssets.drawer.tokens', 'Tokens')} defaultOpen={false}>
                {data.tokens?.length ? (
                  data.tokens.map(tok => (
                    <Row key={tok.symbol || tok.name} label={tok.symbol || tok.name} value={tok.address ? <span className="mono ta-drawer-addr">{tok.address}</span> : tok.chain} />
                  ))
                ) : (
                  <Row label={t('tokenizedAssets.drawer.networks', 'Networks')} value={data.chains?.join(', ')} />
                )}
              </Section>

              <Section title={t('tokenizedAssets.drawer.primaryMarket', 'Primary Market')} defaultOpen={false}>
                <Row label={t('tokenizedAssets.drawer.inception', 'Inception')} value={data.inception ? new Date(data.inception).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null} />
                <Row label={t('tokenizedAssets.drawer.eligibility', 'Eligibility')} value={data.eligibility} />
                <Row label={t('tokenizedAssets.drawer.jurisdiction', 'Jurisdiction')} value={data.jurisdiction} />
              </Section>

              <Section title={t('tokenizedAssets.drawer.serviceProviders', 'Service Providers')} defaultOpen={false}>
                <Row label={t('tokenizedAssets.kpi.issuers', 'Issuer')} value={data.issuer} />
                <Row label={t('tokenizedAssets.drawer.auditor', 'Auditor')} value={data.auditor} />
                <Row label={t('tokenizedAssets.drawer.custodian', 'Custodian')} value={data.custodian} />
              </Section>

              {data.description && (
                <p className="ta-drawer-desc">{data.description}</p>
              )}

              <div className="ta-drawer-footer">
                {data.url && (
                  <a href={data.url} target="_blank" rel="noopener noreferrer" className="ta-drawer-link">
                    {t('tokenizedAssets.drawer.visitProduct', 'Visit Product')}
                  </a>
                )}
                {data.twitter && (
                  <a href={`https://x.com/${data.twitter}`} target="_blank" rel="noopener noreferrer" className="ta-drawer-link">
                    @{data.twitter}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>,
    (typeof document !== 'undefined' && document.querySelector('.app')) || document.body
  )
}
