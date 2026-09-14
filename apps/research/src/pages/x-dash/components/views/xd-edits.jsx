/**
 * Edits - creator identity-change watch driven by useXDashSurface on
 * /api/xdash/creator-edits. Shows a summary stat row, a feed of detected
 * before/after identity changes, and a username watch list. Currently the
 * surface is usually empty, so the empty state explains what it scans.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import {
  Shimmer, EmptyState, ErrorState, Pagination, StatTile, Avatar,
} from '../xd-bits'
import { relativeTime, humanizeLabel } from '../x-dash-utils'

function EditEntry({ entry, onOpenAuthor }) {
  const { t } = useTranslation()
  const author = entry.author || entry
  const authorId = author.rest_id || author.id || author.author_id

  /* Build the specific changes from the real /creator-edits payload shape.
     The surface reports WHAT changed in `visible_changed_fields` and carries
     the prior values in `previous_handles` / `previous_display_names` /
     `previous_avatar_image_url`. (The old code read fields the API never
     sends - previous_screen_name, avatar_changed, field_changes - so every
     row fell through to the generic "identity change detected" label.) */
  const cp = entry.current_profile || {}
  const changedFields = Array.isArray(entry.visible_changed_fields) ? entry.visible_changed_fields : []
  const isChanged = (f) => changedFields.includes(f)
  const prevHandle = Array.isArray(entry.previous_handles) ? entry.previous_handles[0] : null
  const prevDisplay = Array.isArray(entry.previous_display_names) ? entry.previous_display_names[0] : null
  const currentHandle = cp.screen_name || author.screen_name
  const currentDisplay = cp.display_name || author.name
  const handledFields = new Set()
  const changes = []

  if (isChanged('screen_name') || (prevHandle && prevHandle !== currentHandle)) {
    handledFields.add('screen_name')
    changes.push({ kind: 'text', field: t('xDash.edits.field.username', 'username'), before: `@${prevHandle || '?'}`, after: `@${currentHandle}` })
  }
  if (prevDisplay && prevDisplay !== currentDisplay) {
    handledFields.add('display_name'); handledFields.add('name')
    changes.push({ kind: 'text', field: t('xDash.edits.field.displayName', 'display name'), before: prevDisplay, after: currentDisplay })
  }
  if (isChanged('avatar_image_url') || entry.previous_avatar_image_url) {
    handledFields.add('avatar_image_url')
    changes.push({ kind: 'avatar', field: t('xDash.edits.field.avatar', 'avatar'), before: entry.previous_avatar_image_url, after: cp.avatar_image_url || author.avatar_image_url })
  }
  if (isChanged('description')) {
    handledFields.add('description')
    changes.push({ kind: 'flag', field: t('xDash.edits.field.bio', 'bio'), status: t('xDash.edits.status.updated', 'updated') })
  }
  // Any other reported field we don't have a richer renderer for.
  for (const f of changedFields) {
    if (handledFields.has(f)) continue
    changes.push({ kind: 'flag', field: humanizeLabel(f), status: t('xDash.edits.status.changed', 'changed') })
  }

  const detectedAt = entry.latest_edit_at || entry.detected_at

  return (
    <div className="xd-edit-entry">
      <button
        type="button"
        className="xd-edit-entry__identity"
        onClick={() => authorId && onOpenAuthor(authorId)}
        style={{ background: 'none', border: 'none', cursor: authorId ? 'pointer' : 'default' }}
      >
        <Avatar src={author.avatar_image_url} alt={author.screen_name} size={32} />
        <div className="xd-tokencell__text">
          <span className="xd-cell-primary">@{author.screen_name || author.current_screen_name || '-'}</span>
          <span className="xd-tokencell__sub">
            {author.name || author.current_display_name || ''}
            {detectedAt && <span> &middot; {relativeTime(detectedAt, t)}</span>}
          </span>
        </div>
      </button>
      <div className="xd-flow-row__authors" style={{ minWidth: 0, flex: 1 }}>
        {changes.length === 0 && <span className="xd-cell-muted">{t('xDash.edits.changeFallback', 'identity change detected')}</span>}
        {changes.map((c, i) => (
          <div className="xd-edit-change" key={i}>
            <span className="xd-edit-change__field">{c.field}</span>
            {c.kind === 'avatar' ? (
              <span className="xd-edit-change__avatars">
                <Avatar src={c.before} alt="" size={20} />
                <span className="xd-flow-arrow">&#8594;</span>
                <Avatar src={c.after} alt="" size={20} />
              </span>
            ) : c.kind === 'flag' ? (
              <span className="xd-edit-change__after">{c.status}</span>
            ) : (
              <>
                <span className="xd-edit-change__before">{c.before}</span>
                <span className="xd-flow-arrow">&#8594;</span>
                <span className="xd-edit-change__after">{c.after}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function XDEdits({ onOpenAuthor }) {
  const { t } = useTranslation()
  const params = useMemo(() => ({ perPage: 25 }), [])
  const { data, loading, error, refetch } = useXDashSurface('/api/xdash/creator-edits', params)

  if (loading && !data) return <Shimmer variant="row" count={6} />
  if (error) return <ErrorState message={error} onRetry={refetch} />

  const summary = data?.summary || {}
  const entries = data?.entries || []
  const usernameWatch = data?.username_watch || []
  const pagination = data?.pagination || {}
  const windowLabel = data?.timeframe || '24h'
  const hasActivity = entries.length > 0 || usernameWatch.length > 0

  return (
    <div>
      <div className="xd-edits-summary">
        <StatTile label={t('xDash.edits.summary.edited', 'Edited')} value={summary.edited_count ?? 0} />
        <StatTile label={t('xDash.edits.summary.profileEdits', 'Profile edits')} value={summary.profile_edit_count ?? 0} info="profileEdits" />
        <StatTile label={t('xDash.edits.summary.avatarSwaps', 'Avatar swaps')} value={summary.avatar_swap_count ?? 0} tone={summary.avatar_swap_count ? 'amber' : undefined} info="avatarSwaps" />
        <StatTile label={t('xDash.edits.summary.usernameEdits', 'Username edits')} value={summary.username_edit_count ?? 0} tone={summary.username_edit_count ? 'amber' : undefined} info="usernameEdits" />
        <StatTile label={t('xDash.edits.summary.dualShifts', 'Dual shifts')} value={summary.dual_shift_count ?? 0} tone={summary.dual_shift_count ? 'bear' : undefined} info="dualShifts" />
      </div>

      {!hasActivity ? (
        <EmptyState
          title={t('xDash.edits.empty.title', 'No identity changes detected')}
          detail={t(
            'xDash.edits.empty.detail',
            'Scans the top KOL boards for username, avatar and profile changes. None detected in the last {{window}}. {{scanned}} creators scanned across {{boards}} boards.',
            {
              window: windowLabel,
              scanned: data?.candidates_scanned ?? 0,
              boards: data?.board_limit ?? 0,
            },
          )}
          action={(
            <button type="button" className="xd-btn xd-btn--secondary xd-btn--sm" onClick={refetch}>
              {t('xDash.edits.empty.rescan', 'Re-scan')}
            </button>
          )}
        />
      ) : (
        <>
          {entries.length > 0 && (
            <>
              <div className="xd-section-label">{t('xDash.edits.detectedChanges', 'Detected changes')}{getMetricInfo('detectedChanges') && <InfoTip text={getMetricInfo('detectedChanges')} position="top" />}</div>
              <div className="xd-edits-feed">
                {entries.map((entry, i) => (
                  <EditEntry
                    key={entry.author?.rest_id || entry.author?.id || i}
                    entry={entry}
                    onOpenAuthor={onOpenAuthor}
                  />
                ))}
              </div>
            </>
          )}

          {usernameWatch.length > 0 && (
            <div className="xd-watch-list">
              <div className="xd-section-label">{t('xDash.edits.usernameWatch', 'Username watch')}</div>
              {usernameWatch.map((w, i) => {
                const author = w.author || w
                const authorId = author.rest_id || author.id || author.author_id
                return (
                  <div
                    className="xd-watch-item"
                    key={authorId || i}
                    onClick={() => authorId && onOpenAuthor(authorId)}
                    style={{ cursor: authorId ? 'pointer' : 'default' }}
                  >
                    <Avatar src={author.avatar_image_url} alt={author.screen_name} size={24} />
                    <span className="xd-cell-primary">@{author.screen_name || author.current_screen_name}</span>
                    {w.note && <span className="xd-cell-muted">&middot; {w.note}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {pagination.page_count > 1 && (
            <Pagination
              page={pagination.page}
              pageCount={pagination.page_count}
              onPage={() => {}}
            />
          )}
        </>
      )}
    </div>
  )
}
