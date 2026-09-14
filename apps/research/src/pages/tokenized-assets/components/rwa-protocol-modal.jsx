import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { hexToRgba, CATEGORY_COLORS, CHAIN_PALETTE, classifyProtocol } from './rwa-shared'
import { isDev } from '@/utils/env'
import AppPortal from '@/components/app-portal'

/* ── Fetch protocol detail ── */
async function fetchDetail(slug) {
  const res = await fetch(`/api/rwa/protocol/${slug}/detail`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/* ── Mini sparkline (SVG) ── */
function MiniSparkline({ data, width = 200, height = 60, color = '#3B82F6' }) {
  if (!data?.length) return null
  const vals = data.map(p => p.tvl || 0)
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const range = max - min || 1
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 8) - 4
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="rwa-modal-spark">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill="url(#spark-grad)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

/* ── Horizontal bar ── */
function ChainBar({ chain, tvl, maxTvl, total, fmtUsd }) {
  const pct = total > 0 ? (tvl / total) * 100 : 0
  const w = maxTvl > 0 ? (tvl / maxTvl) * 100 : 0
  const color = CHAIN_PALETTE[chain] || '#64748B'
  return (
    <div className="rwa-modal-chain-row">
      <span className="rwa-modal-chain-name">{chain}</span>
      <div className="rwa-modal-chain-track">
        <div className="rwa-modal-chain-fill" style={{ width: `${w}%`, background: color }} />
      </div>
      <span className="rwa-modal-chain-val mono">{fmtUsd(tvl)}</span>
      <span className="rwa-modal-chain-pct mono">{pct.toFixed(1)}%</span>
    </div>
  )
}

/* ── Detail row ── */
function DetailRow({ label, value }) {
  if (value == null) return null
  return (
    <div className="rwa-modal-detail-row">
      <span className="rwa-modal-detail-label">{label}</span>
      <span className="rwa-modal-detail-value">{value}</span>
    </div>
  )
}

/* ── Stat pill ── */
function StatPill({ label, value }) {
  return (
    <div className="rwa-modal-stat">
      <span className="rwa-modal-stat-label">{label}</span>
      <span className="rwa-modal-stat-value mono">{value || '\u2014'}</span>
    </div>
  )
}

/* ══════════════════════════════════════════════════════
   RwaProtocolModal
   ══════════════════════════════════════════════════════ */

export default function RwaProtocolModal({ slug, onClose }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtUsd = (v) => (v == null || !isFinite(v) ? '—' : fmtLargeShort(v))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tf, setTf] = useState('1Y')
  const backdropRef = useRef(null)

  // Fetch on open
  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(null)
    fetchDetail(slug)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [slug])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Close on backdrop click
  const handleBackdrop = useCallback((e) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  // Filter TVL history by timeframe
  const filteredHistory = useMemo(() => {
    if (!data?.tvlHistory?.length) return []
    if (tf === 'All') return data.tvlHistory
    const days = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }[tf] || 365
    const cutoff = Date.now() - days * 86400 * 1000
    return data.tvlHistory.filter(p => p.date >= cutoff)
  }, [data, tf])

  if (!slug) return null

  const category = data ? classifyProtocol(data) : ''
  const catColor = CATEGORY_COLORS[category] || '#94A3B8'
  const chainTotal = data?.chainBreakdown?.reduce((s, c) => s + c.tvl, 0) || 0
  const maxChainTvl = data?.chainBreakdown?.[0]?.tvl || 1
  const logoSlug = (data?.slug || slug || '').toLowerCase().replace(/\s+/g, '-')

  return (
    <AppPortal>
    <div className="rwa-modal-backdrop" ref={backdropRef} onClick={handleBackdrop}>
      <div className="rwa-modal-panel">
        {/* Close button */}
        <button type="button" className="rwa-modal-close" onClick={onClose} aria-label={t('tokenizedAssets.protocolModal.close', 'Close')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>

        {loading ? (
          <div className="rwa-modal-loading">
            <div className="rwa-modal-skel-header animate-shimmer" />
            <div className="rwa-modal-skel-stats animate-shimmer stagger-2" />
            <div className="rwa-modal-skel-chart animate-shimmer stagger-3" />
          </div>
        ) : error ? (
          <div className="rwa-modal-error">
            <span>{t('tokenizedAssets.protocolModal.failedToLoad', 'Failed to load protocol data')}</span>
            <span className="rwa-modal-error-detail">{error}</span>
          </div>
        ) : data ? (
          <>
            {/* Header */}
            <div className="rwa-modal-header">
              {!isDev && (
                <img
                  className="rwa-modal-logo"
                  src={data.logo || `https://icons.llama.fi/protocols/${logoSlug}`}
                  alt=""
                  onError={e => { e.target.style.display = 'none' }}
                />
              )}
              <div className="rwa-modal-header-info">
                <h2 className="rwa-modal-name">{data.fullName || data.name}</h2>
                <div className="rwa-modal-meta">
                  {data.issuer && <span className="rwa-modal-issuer">{data.issuer}</span>}
                  <span className="rwa-modal-cat-badge" style={{ color: catColor, borderColor: hexToRgba(catColor, 0.2), background: hexToRgba(catColor, 0.08) }}>
                    {category}
                  </span>
                  {data.inception && <span className="rwa-modal-inception">{t('tokenizedAssets.protocolModal.since', 'Since {{date}}', { date: new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' }).format(new Date(data.inception)) })}</span>}
                </div>
              </div>
            </div>

            {/* Stat pills */}
            <div className="rwa-modal-stats">
              <StatPill label={t('tokenizedAssets.kpi.aum', 'AUM')} value={fmtUsd(data.currentTvl)} />
              <StatPill label={t('tokenizedAssets.protocolModal.apy30d', '30D APY')} value={data.apy_30d} />
              <StatPill
                label={t('tokenizedAssets.protocolModal.investors', 'Investors')}
                value={data.investors != null ? new Intl.NumberFormat(i18n.language).format(data.investors) : null}
              />
              <StatPill label={t('tokenizedAssets.protocolModal.redemption', 'Redemption')} value={data.redemption} />
              <StatPill label={t('tokenizedAssets.protocolModal.minInvestment', 'Min Investment')} value={data.min_investment} />
              <StatPill label={t('tokenizedAssets.protocolModal.mgmtFee', 'Mgmt Fee')} value={data.mgmt_fee} />
            </div>

            {/* TVL chart */}
            {filteredHistory.length > 0 && (
              <div className="rwa-modal-chart-section">
                <div className="rwa-modal-chart-head">
                  <span className="rwa-modal-chart-title">{t('tokenizedAssets.protocolModal.tvlOverTime', 'TVL Over Time')}</span>
                  <div className="rwa-modal-chart-tfs">
                    {['1M', '3M', '6M', '1Y', 'All'].map(t => (
                      <button key={t} type="button" className={`ric-tf${tf === t ? ' on' : ''}`} onClick={() => setTf(t)}>{t}</button>
                    ))}
                  </div>
                </div>
                <MiniSparkline data={filteredHistory} width={780} height={180} color={catColor} />
              </div>
            )}

            {/* Description */}
            {data.description && (
              <p className="rwa-modal-desc">{data.description}</p>
            )}

            {/* Details + Chain breakdown side by side */}
            <div className="rwa-modal-split">
              <div className="rwa-modal-details">
                <h4 className="rwa-modal-section-title">{t('tokenizedAssets.protocolModal.details', 'Details')}</h4>
                <DetailRow label={t('tokenizedAssets.protocolModal.issuer', 'Issuer')} value={data.issuer} />
                <DetailRow
                  label={t('tokenizedAssets.protocolModal.inception', 'Inception')}
                  value={data.inception ? new Intl.DateTimeFormat(i18n.language, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(data.inception)) : null}
                />
                <DetailRow label={t('tokenizedAssets.protocolModal.eligibility', 'Eligibility')} value={data.eligibility} />
                <DetailRow label={t('tokenizedAssets.protocolModal.jurisdiction', 'Jurisdiction')} value={data.jurisdiction} />
                <DetailRow label={t('tokenizedAssets.protocolModal.auditor', 'Auditor')} value={data.auditor} />
                <DetailRow label={t('tokenizedAssets.protocolModal.networks', 'Networks')} value={data.chains?.length ? data.chains.join(', ') : null} />
              </div>

              {data.chainBreakdown?.length > 0 && (
                <div className="rwa-modal-chains">
                  <h4 className="rwa-modal-section-title">{t('tokenizedAssets.protocolModal.chainBreakdown', 'Chain Breakdown')}</h4>
                  {data.chainBreakdown.slice(0, 8).map(c => (
                    <ChainBar key={c.chain} chain={c.chain} tvl={c.tvl} maxTvl={maxChainTvl} total={chainTotal} fmtUsd={fmtUsd} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="rwa-modal-footer">
              {data.url && (
                <a href={data.url} target="_blank" rel="noopener noreferrer" className="rwa-modal-link">
                  {t('tokenizedAssets.protocolModal.visitProduct', 'Visit Product')} <span className="rwa-modal-link-arrow">&nearr;</span>
                </a>
              )}
              {data.twitter && (
                <a href={`https://x.com/${data.twitter}`} target="_blank" rel="noopener noreferrer" className="rwa-modal-link">
                  @{data.twitter}
                </a>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
    </AppPortal>
  )
}
