/**
 * Author dossier drawer. Slides in from the right, URL-driven by the shell.
 * Binds to useXDashAuthor(authorId) which merges /api/xdash/author/:id and
 * /api/xdash/intel/author/:id. Normalized via normalizeXDashAuthorDetail.
 */
import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import { useXDashAuthor } from '@/hooks/useXDashAuthor'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import {
  Avatar, StatTile, Shimmer, ErrorState, ArrowFlowIcon, MentionStrengthChip,
} from './xd-bits'
import { XDMomentumArea } from './xd-charts'
import XDMentionsFeed from './xd-mentions-feed'
import XDTokensHeatmap from './xd-tokens-heatmap'
import useProThemeSkin from '@/components/pro-theme/use-pro-theme-skin'
import {
  normalizeXDashAuthorDetail, formatNum, formatPercent, humanizeLabel, getFollowerTier,
  buildStrengthLookup, getAuthorRoleLabel,
} from './x-dash-utils'

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)
const CollapseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)
const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)
const VerifiedTick = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
  </svg>
)
const XLogoIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
const ShareIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
)

/* Twitter avatar URLs come in size variants: _normal (48px), _bigger (73px),
   _200x200, _400x400, or no-suffix (original). The author endpoint only
   returns the _normal variant. Swap to _400x400 for the hero banner so the
   blurred backdrop has real detail, and so the pfp is crisp at 96px. */
function avatarAtSize(url, size = '400x400') {
  if (!url) return null
  return url.replace(/_(normal|bigger|mini)\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i, `_${size}.$2$3`)
}

function pickWindow(value, win = '24h') {
  if (value == null) return null
  if (typeof value === 'object') return value[win] ?? value['7d'] ?? null
  return value
}

/* Avg-lead arrives in minutes and can span days - rendering "4025m" is
   unreadable. Keep minutes under 90m, hours under 2 days, days beyond. */
function formatLeadMinutes(mins, t) {
  const m = Math.round(Number(mins) || 0)
  if (m < 90) return t('xDash.authorDrawer.minutes', '{{count}}m', { count: m })
  if (m < 2880) return t('xDash.authorDrawer.hours', '{{count}}h', { count: +(m / 60).toFixed(1) })
  return t('xDash.authorDrawer.days', '{{count}}d', { count: +(m / 1440).toFixed(1) })
}

export default function XDAuthorDrawer({ authorId, onClose, onOpenToken, onOpenAuthor, fullscreen = false, onToggleFullscreen }) {
  const { t } = useTranslation()
  /* Day mode + nav-sidebar state live on .app root, but the drawer is
     portaled to document.body so the descendant selectors miss. Mirror
     both flags on the portal wrapper so day-mode + nav-offset CSS still
     fire on the fullscreen brief. */
  const dayMode = useSettingsStore((s) => s.dayMode)
  const navSidebarCollapsed = useSettingsStore((s) => s.navSidebarCollapsed)
  const { className: proThemeClass } = useProThemeSkin()
  const opts = useMemo(() => ({ includeIntel: true, identityHistoryLimit: 10 }), [])
  const { data, loading, error, refetch } = useXDashAuthor(authorId, opts)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const detail = useMemo(() => normalizeXDashAuthorDetail(data), [data])
  const {
    author, tokens, mergedMentions, primaryMentions, mentions, latestSignal,
    domainSkills, recentTransitions, intelligence,
  } = detail
  const feedMentions = mergedMentions?.length ? mergedMentions : (primaryMentions?.length ? primaryMentions : mentions)
  /* per-token mention.match.strength summary - rendered next to each Top
     tokens row so users can see whether THIS author talks about a token
     primarily or just brushes it in passing. Keyed by cg_id (lowercased)
     with symbol fallback. */
  const tokenStrengthByCgId = useMemo(
    () => buildStrengthLookup(feedMentions, (m) => {
      const t = m?.token || {}
      return String(t.cg_id || t.token_id || t.symbol || '').toLowerCase()
    }),
    [feedMentions],
  )
  /* signal_history: up to 24 AuthorSignalRow snapshots, oldest->newest.
     Same {snapshot_at, mentions['24h'], weighted_engagement['24h']} shape as
     the token momentum chart. Short/empty handled inside XDMomentumArea. */
  const signalHistory = useMemo(() => {
    const h = intelligence?.signal_history
    return Array.isArray(h) ? h : []
  }, [intelligence])
  const hasSignalHistory = signalHistory.length > 0

  const tier = getFollowerTier(author.followers_count)
  const previousNames = Array.isArray(author.previous_screen_names) ? author.previous_screen_names : []
  const screenNameChanged = author.screen_name_changed && previousNames.length > 0

  /* Verdict metrics — Dossier hero. Hit-rate is the strongest signal when
     present; falls back to 7d mentions, then followers. The role label is
     the same humanized verdict used elsewhere (Fast scout, Reliable
     tracker, etc). */
  const roleLabel = useMemo(() => (author?.followers_count != null ? getAuthorRoleLabel(author, detail, t) : null), [author, detail, t])
  const leadLag = latestSignal.lead_lag || {}
  const hitRate7d = Number(leadLag.early_signal_hit_rate_7d ?? author.early_signal_hit_rate_7d ?? 0)
  const leadMins = leadLag.avg_lead_minutes_7d ?? author.avg_lead_minutes_7d ?? null
  const mentions7d = pickWindow(latestSignal.mentions, '7d')
  const engagement7d = pickWindow(latestSignal.weighted_engagement, '7d')
  const verdictPrimary = hitRate7d > 0
    ? { value: String(Math.round(hitRate7d * 100)), unit: '%', caption: t('xDash.authorDrawer.verdict.hitRate', 'Early-signal hit rate · 7d') }
    : mentions7d != null
      ? { value: formatNum(mentions7d), unit: '', caption: t('xDash.authorDrawer.verdict.mentions7d', 'Mentions · 7d') }
      : { value: formatNum(author.followers_count), unit: '', caption: t('xDash.authorDrawer.verdict.followers', 'Followers') }
  const verdictMetrics = [
    leadMins != null && Number(leadMins) > 0 && {
      value: formatLeadMinutes(leadMins, t),
      label: t('xDash.authorDrawer.verdict.avgLead', 'Avg lead'),
    },
    engagement7d != null && { value: formatNum(engagement7d, { maxFraction: 0 }), label: t('xDash.authorDrawer.verdict.engagement7d', 'Engagement 7d') },
    mentions7d != null && hitRate7d > 0 && { value: formatNum(mentions7d), label: t('xDash.authorDrawer.verdict.mentionsShort7d', 'Mentions 7d') },
  ].filter(Boolean).slice(0, 3)

  const handleCopyLink = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    const url = typeof window !== 'undefined' ? `${window.location.origin}/x-dash/author/${handle}?view=full` : ''
    if (url) navigator.clipboard.writeText(url).catch(() => {})
  }
  /* Hi-res variant of the avatar feeds the blurred banner backdrop AND the
     96px circular pfp. The API only returns the _normal (48px) variant, so
     we swap to _400x400 - same image, real resolution. */
  const heroAvatar = avatarAtSize(author.avatar_image_url, '400x400')
  const handle = author.screen_name || authorId
  // jump to the full-screen KOL Radar profile (Call Ledger, legitimacy, bubbles)
  const navigate = useNavigate()
  const openKolProfile = () => {
    if (handle) navigate(`/x-dash/kol/${encodeURIComponent(String(handle).replace(/^@/, ''))}`)
  }
  const xUrl = author.screen_name ? `https://x.com/${author.screen_name}` : null
  const verified = author.is_blue_verified || author.legacy_verified

  /* Portaled to document.body to escape `.page-layout`'s
     `transform: translateZ(0)` containing block — see xd-token-drawer
     for the full rationale. */
  if (typeof document === 'undefined') return null
  const portalClass = [
    // Box-less class carrier — see `.xd-portal-root` in x-dash-page.css.
    'xd-portal-root',
    'app',
    'nav-sidebar-open',
    navSidebarCollapsed ? 'nav-sidebar-collapsed' : '',
    dayMode ? 'app-day-mode' : '',
    // …and the PRO skin — see xd-token-drawer for why.
    proThemeClass.trim(),
  ].filter(Boolean).join(' ')
  return createPortal(
    <div className={portalClass}>
      {!fullscreen && <div className="xd-drawer-scrim" onClick={onClose} />}
      <aside
        className={`xd-drawer xd-drawer--author${fullscreen ? ' xd-drawer--fullscreen' : ''}`}
        role="dialog"
        aria-label={t('xDash.authorDrawer.dossierAria', '@{{handle}} dossier', { handle })}
      >
        {loading && !data ? (
          /* loading state: animated shimmer skeleton for hero + identity
             so the drawer never flashes empty placeholders while
             /api/xdash/author/:id resolves. */
          <>
            <header className="xd-author-hero xd-author-hero--loading">
              <div className="xd-author-hero__bg animate-shimmer" aria-hidden="true" />
              {onToggleFullscreen && (
                <button
                  type="button"
                  className="xd-author-hero__close xd-author-hero__expand"
                  onClick={onToggleFullscreen}
                  aria-label={fullscreen ? t('xDash.drawer.exitFullscreen', 'Exit fullscreen') : t('xDash.drawer.expandFullscreen', 'Expand to fullscreen')}
                  title={fullscreen ? t('xDash.drawer.exitFullscreen', 'Exit fullscreen') : t('xDash.drawer.expandFullscreen', 'Expand to fullscreen')}
                >
                  {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
                </button>
              )}
              <button
                type="button"
                className="xd-author-hero__close"
                onClick={onClose}
                aria-label={t('xDash.drawer.close', 'Close')}
              >
                <CloseIcon />
              </button>
              <div className="xd-author-hero__avatar">
                <div className="xd-shimmer-avatar xd-shimmer-avatar--lg animate-shimmer" />
              </div>
            </header>
            <div className="xd-author-identity">
              <div className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" style={{ maxWidth: 180 }} />
              <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 8, maxWidth: 120 }} />
              <div className="xd-shimmer-bar animate-shimmer" style={{ marginTop: 12 }} />
              <div className="xd-shimmer-bar animate-shimmer" style={{ marginTop: 6, maxWidth: '72%' }} />
              <div className="xd-shimmer-bar animate-shimmer" style={{ marginTop: 6, maxWidth: '54%' }} />
            </div>
          </>
        ) : (
          /* Dossier hero: 3-column grid (identity | verdict | actions).
              Blurred hi-res avatar is the banner backdrop; a dark veil
              raises text contrast over it. Side-drawer collapses to a
              single-column identity block (verdict + actions render below
              the bio via the .xd-author-hero--narrow modifier). */
          <header className={`xd-author-hero xd-author-hero--dossier${fullscreen ? '' : ' xd-author-hero--narrow'}`}>
            <div className="xd-author-hero__bg" aria-hidden="true">
              <div
                className="xd-author-hero__banner"
                style={heroAvatar ? { backgroundImage: `url(${heroAvatar})` } : undefined}
              />
              <div className="xd-author-hero__veil" />
            </div>

            {fullscreen && (
              <button
                type="button"
                className="xd-author-hero__back"
                onClick={onClose}
                aria-label={t('xDash.drawer.backToLeaderboard', 'Back to leaderboard')}
              >
                <BackIcon />
                <span>{t('xDash.drawer.back', 'Back')}</span>
              </button>
            )}

            {onToggleFullscreen && (
              <button
                type="button"
                className="xd-author-hero__close xd-author-hero__expand"
                onClick={onToggleFullscreen}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
                title={fullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
              >
                {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
              </button>
            )}
            <button
              type="button"
              className="xd-author-hero__close"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>

            <div className="xd-author-hero__grid">
              {/* IDENTITY: avatar + name + handle + tier + role + bio + stats */}
              <div className="xd-author-hero__identity">
                <div className="xd-author-hero__avatar">
                  <Avatar src={heroAvatar || author.avatar_image_url} alt={handle} size={fullscreen ? 88 : 64} />
                </div>
                <div className="xd-author-hero__identity-body">
                  <div className="xd-author-hero__name-row">
                    <h2 className="xd-author-hero__name">{author.name || `@${handle}`}</h2>
                    {verified && <span className="xd-verified"><VerifiedTick /></span>}
                  </div>
                  <div className="xd-author-hero__handle-row">
                    {xUrl ? (
                      <a
                        href={xUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="xd-author-hero__handle"
                      >
                        @{handle}
                        <XLogoIcon />
                      </a>
                    ) : (
                      <span className="xd-author-hero__handle">@{handle}</span>
                    )}
                    <span className={`xd-followtier ${tier.cls}`}>{t(tier.key, tier.fallback)}</span>
                    {author.author_class && (
                      <span className="xd-author-hero__class">{humanizeLabel(author.author_class)}</span>
                    )}
                  </div>
                  {roleLabel && (
                    <div className="xd-author-hero__role">{roleLabel}</div>
                  )}
                  {author.description && (
                    <p className="xd-author-hero__bio">{author.description}</p>
                  )}
                  <div className="xd-author-hero__stats">
                    <span><b className="xd-num">{formatNum(author.followers_count)}</b> {t('xDash.authorDrawer.stat.followers', 'followers')}</span>
                    {Number(author.friends_count) > 0 && (
                      <span><b className="xd-num">{formatNum(author.friends_count)}</b> {t('xDash.authorDrawer.stat.following', 'following')}</span>
                    )}
                    {Number(author.tokens_mentioned_count) > 0 && (
                      <span><b className="xd-num">{formatNum(author.tokens_mentioned_count)}</b> {t('xDash.authorDrawer.stat.tokens', 'tokens')}</span>
                    )}
                    {Number(author.mention_count) > 0 && (
                      <span><b className="xd-num">{formatNum(author.mention_count)}</b> {t('xDash.authorDrawer.stat.mentions', 'mentions')}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* VERDICT: primary metric + caption + sparkline + 1-2 secondary
                  metrics. Hit-rate wins when available; otherwise mentions;
                  otherwise followers. */}
              <div className="xd-author-hero__verdict">
                <span className="xd-author-hero__block-label">{t('xDash.authorDrawer.label.verdict', 'Verdict')}</span>
                <div className="xd-author-hero__verdict-primary">
                  <span className="xd-author-hero__verdict-num xd-num">{verdictPrimary.value}</span>
                  {verdictPrimary.unit && (
                    <span className="xd-author-hero__verdict-unit xd-num">{verdictPrimary.unit}</span>
                  )}
                </div>
                <div className="xd-author-hero__verdict-caption">{verdictPrimary.caption}</div>
                {hasSignalHistory && (
                  <div className="xd-author-hero__verdict-spark">
                    <XDMomentumArea history={signalHistory} loading={false} height={42} />
                  </div>
                )}
                {verdictMetrics.length > 0 && (
                  <div className="xd-author-hero__verdict-metrics">
                    {verdictMetrics.map((m, i) => (
                      <div className="xd-author-hero__verdict-metric" key={i}>
                        <span className="xd-author-hero__verdict-metric-value xd-num">{m.value}</span>
                        <span className="xd-author-hero__verdict-metric-label">{m.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ACTIONS: follow on X + copy link. Primary glass style on the
                  X button so it stands out as the main CTA. */}
              <div className="xd-author-hero__actions">
                <span className="xd-author-hero__block-label">{t('xDash.authorDrawer.label.actions', 'Actions')}</span>
                <button
                  type="button"
                  className="xd-author-hero__action xd-author-hero__action--primary"
                  onClick={openKolProfile}
                >
                  <ExpandIcon />
                  <span>{t('xDash.authorDrawer.fullProfile', 'KOL profile')}</span>
                </button>
                {xUrl && (
                  <a
                    href={xUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="xd-author-hero__action xd-author-hero__action--primary"
                  >
                    <XLogoIcon />
                    <span>{t('xDash.authorDrawer.followOnX', 'Follow on X')}</span>
                  </a>
                )}
                <button
                  type="button"
                  className="xd-author-hero__action"
                  onClick={handleCopyLink}
                >
                  <ShareIcon />
                  <span>{t('xDash.authorDrawer.copyLink', 'Copy link')}</span>
                </button>
              </div>
            </div>
          </header>
        )}

        <div className={`xd-drawer__body${fullscreen ? ' xd-drawer__body--grid' : ''}`}>
          {loading && !data && <Shimmer variant="drawer" count={6} />}
          {error && <ErrorState message={error} onRetry={refetch} />}

          {data && (
            <div className="xd-drawer__main">
              {screenNameChanged && /* identity-change note rendered below */ (
                <div className="xd-history-note">
                  <b>{t('xDash.authorDrawer.identityChanged', 'Identity changed')}</b> &mdash; {t('xDash.authorDrawer.previouslyKnownAs', 'previously known as')}{' '}
                  {previousNames.map((n) => `@${n}`).join(', ')}
                </div>
              )}

              {/* signal trajectory chart — promoted to top of body as the
                  visual anchor right under the Dossier hero. */}
              {(loading || hasSignalHistory) && (
                <div className="xd-drawer-chart">
                  <div className="xd-drawer-chart__label">{t('xDash.authorDrawer.signalTrajectory', 'Signal trajectory')}{getMetricInfo('signalTrajectory') && <InfoTip text={getMetricInfo('signalTrajectory')} position="left" />}</div>
                  <XDMomentumArea history={signalHistory} loading={loading && !data} height={fullscreen ? 160 : 150} />
                </div>
              )}

              {/* signal stat tiles */}
              <div>
                <div className="xd-drawer-section__label">{t('xDash.authorDrawer.section.signal', 'Signal')}</div>
                <div className="xd-drawer-grid">
                  <StatTile info="mentions24h" label={t('xDash.authorDrawer.tile.mentions24h', 'Mentions 24h')} value={formatNum(pickWindow(latestSignal.mentions, '24h') ?? author.recent_mentions_24h)} />
                  <StatTile info="mentions24h" label={t('xDash.authorDrawer.tile.mentions7d', 'Mentions 7d')} value={formatNum(pickWindow(latestSignal.mentions, '7d'))} />
                  <StatTile label={t('xDash.authorDrawer.tile.tokens24h', 'Tokens 24h')} value={formatNum(pickWindow(latestSignal.tokens, '24h') ?? author.tokens_mentioned_count)} />
                  <StatTile info="engagement" label={t('xDash.authorDrawer.tile.engagement24h', 'Engagement 24h')} value={formatNum(pickWindow(latestSignal.weighted_engagement, '24h') ?? author.recent_weighted_engagement_24h, { maxFraction: 0 })} />
                  <StatTile info="engagement" label={t('xDash.authorDrawer.tile.engagement7d', 'Engagement 7d')} value={formatNum(pickWindow(latestSignal.weighted_engagement, '7d'), { maxFraction: 0 })} />
                  <StatTile info="topTokenShare" label={t('xDash.authorDrawer.tile.topTokenShare', 'Top token share')} value={formatPercent(latestSignal.top_token_share ?? author.top_token_share)} />
                  {latestSignal.lead_lag?.early_signal_hit_rate_7d != null && (
                    <StatTile info="earlyHitRate" label={t('xDash.authorDrawer.tile.earlyHitRate7d', 'Early hit-rate 7d')} value={formatPercent(latestSignal.lead_lag.early_signal_hit_rate_7d)} />
                  )}
                  {latestSignal.lead_lag?.avg_lead_minutes_7d != null && (
                    <StatTile info="avgLead" label={t('xDash.authorDrawer.tile.avgLead7d', 'Avg lead 7d')} value={formatLeadMinutes(latestSignal.lead_lag.avg_lead_minutes_7d, t)} />
                  )}
                  {author.reply_context_mentions_7d != null && (
                    <StatTile info="replyContext" label={t('xDash.authorDrawer.tile.replyContext7d', 'Reply context 7d')} value={formatNum(author.reply_context_mentions_7d)} />
                  )}
                </div>
                {Array.isArray(latestSignal.signal_badges) && latestSignal.signal_badges.length > 0 && (
                  <div className="xd-badge-row" style={{ marginTop: 8 }}>
                    {latestSignal.signal_badges.map((b) => (
                      <span key={b} className="xd-badge">{String(b).replace(/[-_]/g, ' ')}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* domain skills — shown in main column in both modes since the
                  fullscreen rail now only carries the tokens heatmap. */}
              {domainSkills.length > 0 && (
                <div>
                  <div className="xd-drawer-section__label">{t('xDash.authorDrawer.section.domainSkills', 'Domain skills')}{getMetricInfo('domainSkills') && <InfoTip text={getMetricInfo('domainSkills')} position="left" />}</div>
                  <div>
                    {domainSkills.slice(0, 8).map((skill, i) => (
                      <div className="xd-skill-row" key={skill.domain_key || i}>
                        <span className="xd-skill-row__label">{skill.domain_label || skill.domain_key}</span>
                        <span className="xd-skill-row__value xd-num">
                          {t('xDash.authorDrawer.mentionsAndEng', '{{mentions}} mentions · {{eng}} eng.', { mentions: formatNum(skill.mention_count), eng: formatNum(skill.weighted_engagement, { maxFraction: 0 }) })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* recent transitions */}
              {recentTransitions.length > 0 && (
                <div>
                  <div className="xd-drawer-section__label">{t('xDash.authorDrawer.section.recentTransitions', 'Recent transitions')}</div>
                  <div>
                    {recentTransitions.slice(0, 6).map((tx, i) => (
                      <div className="xd-transition-row" key={i}>
                        <span>{tx.previous_domain?.label || tx.from_domain?.label || t('xDash.authorDrawer.unknown', 'unknown')}</span>
                        <span className="xd-flow-arrow"><ArrowFlowIcon size={14} /></span>
                        <span className="xd-skill-row__value">
                          {tx.current_domain?.label || tx.to_domain?.label || t('xDash.authorDrawer.unknown', 'unknown')}
                        </span>
                        {tx.weighted_engagement != null && (
                          <span className="xd-flow-author__eng xd-num">{formatNum(tx.weighted_engagement, { maxFraction: 0 })}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* top tokens — shown in main column in both modes. */}
              {tokens.length > 0 && (
                <div>
                  <div className="xd-drawer-section__label">
                    {t('xDash.authorDrawer.section.topTokens', 'Top tokens')}
                    {getMetricInfo('coverage') && <InfoTip text={getMetricInfo('coverage')} position="left" />}
                    <span className="xd-drawer-section__sub"> · {t('xDash.authorDrawer.coveredCount', '{{count}} covered', { count: tokens.length })}</span>
                  </div>
                  <div className="xd-author-list">
                    {tokens.slice(0, fullscreen ? 12 : 10).map((tk, i) => {
                      const key = String(tk.cgId || tk.symbol || '').toLowerCase()
                      const strengthSummary = key ? tokenStrengthByCgId.get(key) : null
                      return (
                        <button
                          type="button"
                          className="xd-author-row"
                          key={tk.cgId || tk.symbol || i}
                          onClick={() => tk.cgId && onOpenToken(tk.cgId)}
                        >
                          <Avatar src={tk.image} alt={tk.symbol} size={28} />
                          <div className="xd-author-row__text">
                            <span className="xd-author-row__name xd-num">
                              {tk.symbol ? `$${tk.symbol}` : tk.name}
                              <MentionStrengthChip summary={strengthSummary} size="sm" />
                            </span>
                            <span className="xd-author-row__sub">{tk.name}</span>
                          </div>
                          <div className="xd-author-row__stat">
                            <div className="xd-author-row__stat-value xd-num">{formatNum(tk.mentionCount)}</div>
                            <div className="xd-author-row__stat-label">{t('xDash.authorDrawer.mentions', 'mentions')}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* mentions feed - demoted to bottom of body; was the top
                  section before. Activity is the supporting evidence,
                  signal + tokens carry the narrative. */}
              <XDMentionsFeed
                mentions={feedMentions}
                onOpenAuthor={onOpenAuthor}
                label={t('xDash.authorDrawer.mentionsFeed', 'Mentions feed')}
              />

              {/* End-of-dossier footer (fullscreen only) — closes the page
                  visually + provides a return CTA paired with the top Back
                  button. */}
              {fullscreen && (
                <footer className="xd-drawer__footer" aria-label={t('xDash.authorDrawer.endOfDossier', 'End of dossier')}>
                  <div className="xd-drawer__footer-rule" />
                  <div className="xd-drawer__footer-body">
                    <div className="xd-drawer__footer-text">
                      <span className="xd-drawer__footer-eyebrow">{t('xDash.authorDrawer.endOfDossier', 'End of dossier')}</span>
                      <span className="xd-drawer__footer-title">
                        {author.name || `@${handle}`}
                      </span>
                      <span className="xd-drawer__footer-sub">
                        {author.followers_count != null && t('xDash.authorDrawer.footerFollowers', '{{count}} followers', { count: formatNum(author.followers_count) })}
                        {Number(author.mention_count) > 0 && ` · ${t('xDash.authorDrawer.footerMentions', '{{count}} mentions', { count: formatNum(author.mention_count) })}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="xd-drawer__footer-cta"
                      onClick={onClose}
                    >
                      <BackIcon />
                      <span>{t('xDash.drawer.backToLeaderboard', 'Back to leaderboard')}</span>
                    </button>
                  </div>
                </footer>
              )}
            </div>
          )}

          {/* RIGHT RAIL — fullscreen only. Single occupant: tokens heatmap.
              Domain skills + top tokens now live in the main column so the
              rail stays a single visual anchor instead of a duplicate of
              the main narrative. */}
          {data && fullscreen && tokens.length > 0 && (
            <aside className="xd-drawer__rail xd-drawer__rail--author">
              <div className="xd-drawer__rail-block xd-drawer__rail-block--heatmap">
                <div className="xd-drawer-section__label">
                  {t('xDash.authorDrawer.tokensHeatmap', 'Tokens heatmap')}
                  <span className="xd-drawer-section__sub"> · {t('xDash.authorDrawer.sizedByMentions', 'sized by mentions')}</span>
                </div>
                <XDTokensHeatmap
                  tokens={tokens.slice(0, 32)}
                  onOpenToken={onOpenToken}
                />
              </div>
            </aside>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
