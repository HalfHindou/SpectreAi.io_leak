/**
 * DetectiveFeed — autonomous-verdict live feed for the Intelligence page.
 *
 * Shows the most recent retail-panic / whale-dump / lp-drain verdicts the
 * detective has emitted on its own (no user trigger). Each row is one
 * click from the project's research zone page.
 *
 * Per .claude/agents/frontend-master-engineer.md:
 *   - mono numbers, glass card, no left-bars, no spinners
 *   - Live dot + last-event-age in header
 *   - Day-mode counterpart in matching CSS file
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useDetectiveFeed from '@/hooks/useDetectiveFeed'
import './DetectiveFeed.css'

const VERDICT_PILL = {
  retail_panic: { i18nKey: 'retailPanic', cls: 'df-pill--panic' },
  single_wallet_dump: { i18nKey: 'whaleDump', cls: 'df-pill--dump' },
  lp_drain: { i18nKey: 'lpDrain', cls: 'df-pill--drain' },
  macro_correlated: { i18nKey: 'macro', cls: 'df-pill--macro' },
  mixed: { i18nKey: 'mixed', cls: 'df-pill--mixed' },
  no_dump: { i18nKey: 'noDump', cls: 'df-pill--ok' },
}

function fmtAge(ts) {
  if (!ts) return ''
  const ms = typeof ts === 'number' ? ts : Date.parse(ts)
  if (!Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

const DetectiveRow = React.memo(({ row, t }) => {
  const pillEntry = VERDICT_PILL[row.verdict]
  const pillLabel = pillEntry
    ? t(`intelligencePage.detective.verdict.${pillEntry.i18nKey}`)
    : row.verdict
  const pillCls = pillEntry?.cls || ''
  const conf = Math.round((row.confidence || 0) * 100)
  const pc = row.price_change_24h_pct
  const pcStr = Number.isFinite(Number(pc)) ? `${Number(pc).toFixed(1)}%` : null
  const link = row.asset
    ? `/research-zone/${row.asset.toLowerCase()}`
    : (row.ca ? `/research-zone/${row.ca}` : '#')
  return (
    <li className="df-row">
      <a href={link} className="df-row-link">
        <div className="df-row-head">
          <span className={`df-pill ${pillCls}`}>{pillLabel}</span>
          <span className="df-asset mono">{row.asset || (row.ca ? row.ca.slice(0, 8) : '?')}</span>
          <span className="df-conf mono">{conf}%</span>
          <span className="df-age mono">{fmtAge(row.created_at || row.ts)}</span>
        </div>
        <p className="df-summary">{row.summary || '—'}</p>
        {(pcStr || row.unique_sellers) && (
          <div className="df-meta mono">
            {pcStr && <span>24h {pcStr}</span>}
            {row.unique_sellers != null && <span>· {t('intelligencePage.detective.sellers', { count: row.unique_sellers })}</span>}
            {row.top_seller_share_pct != null && <span>· {t('intelligencePage.detective.topShare', { pct: Number(row.top_seller_share_pct).toFixed(1) })}</span>}
          </div>
        )}
      </a>
    </li>
  )
})

export default function DetectiveFeed() {
  const { t } = useTranslation()
  const { rows, updatedAt, error } = useDetectiveFeed({
    enabled: true,
    onlyAutonomous: true,
    sinceMinutes: 1440,
    limit: 20,
  })

  const live = updatedAt && Date.now() - updatedAt < 90_000
  const head = useMemo(() => (
    <div className="df-head">
      <span className="df-eyebrow">{t('intelligencePage.detective.eyebrow')} · {t('intelligencePage.live')}</span>
      <span className={`df-live${live ? ' df-live--on' : ''}`}>
        <span className="df-live-dot" />
        <span className="df-live-label mono">{live ? t('intelligencePage.live') : t('intelligencePage.idle')}</span>
      </span>
    </div>
  ), [live, t])

  return (
    <section className="df">
      {head}
      {!rows.length ? (
        <div className="df-empty">{t('intelligencePage.detective.empty')}</div>
      ) : (
        <ol className="df-list" aria-live="polite">
          {rows.slice(0, 12).map((r, i) => (
            <DetectiveRow key={r.id || `${r.asset}-${r.created_at || i}`} row={r} t={t} />
          ))}
        </ol>
      )}
      {error && <div className="df-error">{error}</div>}
    </section>
  )
}
