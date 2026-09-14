/**
 * RzMentionsPanel — cross-platform mention aggregator for the Sentiment tab.
 *
 * Layout:
 *   [Header: total mentions · platforms · authors · velocity sparkline]
 *   [Per-platform breakdown row — pills with counts + last age]
 *   [Sentiment + role split bars]
 *   [Team voice strip — pinned messages + admin posts, separated]
 *   [Top engaged]
 *   [Recent stream]
 *
 * Data: /api/social/mentions/:asset, refreshed every 60s.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import useTokenMentions from '@/hooks/useTokenMentions'
import './rz-mentions-panel.css'

const PLAT_LABEL = { x: 'X', telegram: 'TG', reddit: 'RDT', youtube: 'YT', instagram: 'IG', tiktok: 'TT', website: 'WEB' }
const SENT_COLOR = {
  bullish: 'sent--bull', bearish: 'sent--bear', fud: 'sent--fud', panic: 'sent--panic',
  neutral: 'sent--neutral', shill: 'sent--shill', unlabeled: 'sent--unlabeled',
}
const ROLE_LABEL = {
  team: 'TEAM', kol: 'KOL', community: 'COMMUNITY', bot: 'BOT', spam: 'SPAM',
  channel: 'CHANNEL', website: 'SITE', unlabeled: '—',
}

function fmtAge(ts) {
  if (!ts) return ''
  const ms = Date.parse(ts)
  if (!Number.isFinite(ms)) return ''
  const d = Date.now() - ms
  if (d < 60_000) return `${Math.floor(d / 1000)}s`
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}

function VelocitySpark({ rows }) {
  if (!rows?.length) return null
  const max = Math.max(...rows.map((r) => r.count), 1)
  const w = 96, h = 22
  const step = w / Math.max(rows.length - 1, 1)
  const points = rows.map((r, i) => {
    const x = i * step
    const y = h - (r.count / max) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg className="rz-mp-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.4" points={points} />
    </svg>
  )
}

const PlatformPill = React.memo(({ row }) => (
  <div className="rz-mp-plat">
    <span className="rz-mp-plat-label">{PLAT_LABEL[row.platform] || (row.platform || '').toUpperCase() || '—'}</span>
    <span className="rz-mp-plat-count mono">{row.count}</span>
    {row.last_at && <span className="rz-mp-plat-age mono">{fmtAge(row.last_at)}</span>}
  </div>
))

const Bar = React.memo(({ items, total, kindMap, classMap }) => {
  if (!items?.length || !total) return null
  return (
    <div className="rz-mp-bar">
      {items.map((row, i) => {
        const w = (Number(row.count || 0) / total) * 100
        if (w <= 0) return null
        const cls = classMap?.[row[kindMap]] || 'rz-mp-bar-seg--neutral'
        return (
          <span
            key={`${row[kindMap]}-${i}`}
            className={`rz-mp-bar-seg ${cls}`}
            style={{ width: `${w}%` }}
            title={`${row[kindMap]}: ${row.count}`}
          />
        )
      })}
    </div>
  )
})

const MentionRow = React.memo(({ m, highlight = false }) => {
  const { t } = useTranslation()
  const sentClass = SENT_COLOR[m.sentiment] || SENT_COLOR.unlabeled
  const role = ROLE_LABEL[m.author_label] || (m.is_pinned ? 'PINNED' : '—')
  return (
    <li className={`rz-mp-row${highlight ? ' rz-mp-row--team' : ''}`}>
      <div className="rz-mp-row-head">
        <span className="rz-mp-row-plat mono">{PLAT_LABEL[m.platform] || (m.platform || '').toUpperCase() || '—'}</span>
        <span className="rz-mp-row-author mono">@{m.author_handle}</span>
        {role && role !== '—' && <span className={`rz-mp-row-role rz-mp-row-role--${(m.author_label || (m.is_pinned ? 'pinned' : 'unknown')).toLowerCase()}`}>{role}</span>}
        {m.sentiment && m.sentiment !== 'unlabeled' && (
          <span className={`rz-mp-row-sent ${sentClass}`}>{m.sentiment.toUpperCase()}</span>
        )}
        {m.is_pinned && <span className="rz-mp-row-pin">{t('researchPro.mentionsPanel.mentionrow.pin', "PIN")}</span>}
        <span className="rz-mp-row-age mono">{fmtAge(m.posted_at)}</span>
      </div>
      <p className="rz-mp-row-text">{(m.text || '').slice(0, 320)}</p>
      <div className="rz-mp-row-foot mono">
        {Number(m.likes || 0) > 0 && <span>♡ {m.likes}</span>}
        {Number(m.replies || 0) > 0 && <span>↩ {m.replies}</span>}
        {Number(m.reposts || 0) > 0 && <span>⤴ {m.reposts}</span>}
        {Number(m.views || 0) > 0 && <span>👁 {m.views}</span>}
        {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="rz-mp-row-link">{t('researchPro.mentionsPanel.mentionrow.view', "view")}</a>}
      </div>
    </li>
  )
})

const RzMentionsPanel = React.memo(({ asset, sym }) => {
  const { t } = useTranslation()
  const { data, loading, error } = useTokenMentions({ asset, sinceMinutes: 1440, limit: 50 })

  const totalSentiment = useMemo(() => {
    if (!data?.by_sentiment?.length) return 0
    return data.by_sentiment.reduce((a, r) => a + Number(r.count || 0), 0)
  }, [data])
  const totalRoles = useMemo(() => {
    if (!data?.by_role?.length) return 0
    return data.by_role.reduce((a, r) => a + Number(r.count || 0), 0)
  }, [data])

  const rightSlot = useMemo(() => {
    const v = data?.velocity || []
    return (
      <span className="rz-mp-head-right">
        {data?.totals && (
          <span className="rz-mp-head-stat mono">
            {data.totals.mentions} mentions · {data.totals.platforms}p · {data.totals.distinct_authors} authors
          </span>
        )}
        {v.length > 1 && <VelocitySpark rows={v} />}
      </span>
    )
  }, [data])

  if (!asset) return null
  // 0 mentions is REAL data now that /v1/social/mentions aggregates live
  // tables (2026-07-13) — render the honest zero-state instead of hiding
  // the section (hidden read as "broken", not "quiet").
  if (!data && !loading && !error) return null

  return (
    <SectionShell
      id="proj-mentions"
      label={`SENTIMENT · LIVE MENTIONS · ${sym || asset}`}
      title={t('researchPro.mentionsPanel.rzmentionspanel.title', "Cross-platform mentions")}
      subtitle={loading && !data ? 'syncing…' : 'Last 24h across X · Telegram · Reddit · YouTube'}
      collapsible
      rightSlot={rightSlot}
    >
      {error && !data && (
        <div className="rz-mp-empty">no mentions on file yet — scrapers may not have reached this asset</div>
      )}
      {data && data.totals?.mentions === 0 && (
        <div className="rz-mp-empty">
          No mentions of {sym || asset} captured across X and Telegram in the last 24h — the tape is quiet, which is itself a read.
        </div>
      )}
      {data && data.totals?.mentions > 0 && (
        <div className="rz-mp">
          {/* Per-platform breakdown */}
          {!!data.by_platform?.length && (
            <div className="rz-mp-plats">
              {data.by_platform.map((p) => <PlatformPill key={p.platform} row={p} />)}
            </div>
          )}

          {/* Sentiment + role split bars */}
          <div className="rz-mp-splits">
            <div className="rz-mp-split">
              <span className="rz-mp-split-label">{t('researchPro.mentionsPanel.rzmentionspanel.sentiment', "SENTIMENT")}</span>
              <Bar
                items={data.by_sentiment}
                total={totalSentiment}
                kindMap="sentiment"
                classMap={{
                  bullish: 'rz-mp-bar-seg--bull',
                  bearish: 'rz-mp-bar-seg--bear',
                  fud: 'rz-mp-bar-seg--fud',
                  panic: 'rz-mp-bar-seg--panic',
                  neutral: 'rz-mp-bar-seg--neutral',
                  shill: 'rz-mp-bar-seg--shill',
                }}
              />
              <div className="rz-mp-split-legend">
                {data.by_sentiment.map((r) => (
                  <span key={r.sentiment} className={`rz-mp-leg-pill ${SENT_COLOR[r.sentiment]}`}>
                    {r.sentiment} <span className="mono">{r.count}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="rz-mp-split">
              <span className="rz-mp-split-label">{t('researchPro.mentionsPanel.rzmentionspanel.role', "ROLE")}</span>
              <Bar
                items={data.by_role}
                total={totalRoles}
                kindMap="role"
                classMap={{
                  team: 'rz-mp-bar-seg--team',
                  kol: 'rz-mp-bar-seg--kol',
                  community: 'rz-mp-bar-seg--community',
                  bot: 'rz-mp-bar-seg--neutral',
                  spam: 'rz-mp-bar-seg--bear',
                }}
              />
              <div className="rz-mp-split-legend">
                {data.by_role.map((r) => (
                  <span key={r.role} className={`rz-mp-leg-pill rz-mp-leg-pill--${r.role}`}>
                    {ROLE_LABEL[r.role] || r.role} <span className="mono">{r.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Team voice */}
          {!!data.team_voice?.length && (
            <div className="rz-mp-section">
              <div className="rz-mp-section-head">
                <span className="rz-mp-section-eyebrow">TEAM VOICE · last {Math.min(12, data.team_voice.length)}</span>
              </div>
              <ul className="rz-mp-list">
                {data.team_voice.map((m) => <MentionRow key={`tv-${m.id}`} m={m} highlight />)}
              </ul>
            </div>
          )}

          {/* Top engaged */}
          {!!data.top_engaged?.length && (
            <div className="rz-mp-section">
              <div className="rz-mp-section-head">
                <span className="rz-mp-section-eyebrow">TOP ENGAGED · last 24h</span>
              </div>
              <ul className="rz-mp-list">
                {data.top_engaged.slice(0, 5).map((m) => <MentionRow key={`te-${m.id}`} m={m} />)}
              </ul>
            </div>
          )}

          {/* Recent */}
          {!!data.recent?.length && (
            <details className="rz-mp-section">
              <summary className="rz-mp-section-head">
                <span className="rz-mp-section-eyebrow">RECENT · {data.recent.length}</span>
              </summary>
              <ul className="rz-mp-list">
                {data.recent.slice(0, 20).map((m) => <MentionRow key={`r-${m.id}`} m={m} />)}
              </ul>
            </details>
          )}
        </div>
      )}
    </SectionShell>
  )
})

RzMentionsPanel.displayName = 'RzMentionsPanel'
export default RzMentionsPanel
