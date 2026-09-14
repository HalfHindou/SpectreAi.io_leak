/**
 * Giga KOL DB card — one dense glass card per KOL.
 *
 * Avatar (tier ring + verified) -> handle / name / tier chip -> follower count
 * + signal score -> what-they-push token chips -> a recent-new-follows badge.
 * An inline Follow star toggles the per-user "My KOLs" set. Clicking the body
 * opens the dossier drawer.
 *
 * memo'd with a field-level comparator: the grid rebuilds row identity objects
 * each poll, and `tracked` flips on follow — so compare only the visible fields
 * + the tracked flag.
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar, VerifiedTick, SignalScore } from '../../xd-bits'
import { formatNum } from '../../x-dash-utils'
import { tierMeta } from './kol-tier'

function FollowStar({ filled }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  )
}

/* legit chip — accountability score (0-100) the registry derives from a KOL's
   endorsement health. Tone dot: >=70 green (sharp), 45-69 amber (mixed),
   <45 red (degen / exit liquidity). Only rendered when legit_score is set. */
function legitTone(score) {
  if (score >= 70) return 'green'
  if (score >= 45) return 'amber'
  return 'red'
}

function LegitChip({ score, label, t }) {
  const tone = legitTone(score)
  const title = label
    ? t('kolRadar.legit.chipTip', '{{label}} — legitimacy {{score}}/100 from endorsement health', { label, score })
    : t('kolRadar.legit.chipTipNoLabel', 'Legitimacy {{score}}/100 from endorsement health', { score })
  return (
    <span className={`xd-kol-legitchip xd-kol-legitchip--${tone}`} title={title}>
      <span className="xd-kol-legitchip__dot" aria-hidden="true" />
      <span className="xd-kol-legitchip__label">{t('kolRadar.legit.chip', 'Legit')}</span>
      <span className="xd-kol-legitchip__score xd-num">{score}</span>
    </span>
  )
}

function PushChips({ pushes, onOpenProject, t }) {
  const list = (Array.isArray(pushes) ? pushes : []).filter((p) => p && (p.symbol || p.name))
  if (list.length === 0) {
    return <span className="xd-kol-card__pushes-empty">{t('kolRadar.card.noPushes', 'No recent pushes')}</span>
  }
  const shown = list.slice(0, 4)
  const extra = list.length - shown.length
  return (
    <div className="xd-kol-card__pushes">
      {shown.map((p, i) => (
        <button
          type="button"
          key={p.cg_id || p.symbol || i}
          className="xd-kol-card__push"
          onClick={(e) => { e.stopPropagation(); if (p.cg_id && onOpenProject) onOpenProject(p.cg_id) }}
          disabled={!p.cg_id}
          title={p.name || p.symbol}
        >
          {(p.image || p.image_small || p.image_url)
            ? <img className="xd-kol-card__push-logo" src={p.image || p.image_small || p.image_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            : <span className="xd-kol-card__push-logo xd-kol-card__push-logo--ph" aria-hidden="true" />}
          <span className="xd-kol-card__push-sym xd-num">{p.symbol ? `$${p.symbol}` : p.name}</span>
        </button>
      ))}
      {extra > 0 && <span className="xd-kol-card__push-more xd-num">+{extra}</span>}
    </div>
  )
}

function kolCardEqual(prev, next) {
  if (prev.tracked !== next.tracked) return false
  if (prev.onOpen !== next.onOpen || prev.onToggleFollow !== next.onToggleFollow || prev.onOpenProject !== next.onOpenProject) return false
  const a = prev.kol || {}
  const b = next.kol || {}
  return (
    a.screen_name === b.screen_name
    && a.signal_score === b.signal_score
    && a.followers_count === b.followers_count
    && a.recent_new_follows_count === b.recent_new_follows_count
    && a.legit_score === b.legit_score
    && a.legit_label === b.legit_label
    && (a.pushes || []).length === (b.pushes || []).length
    && (a.pushes || []).map((p) => p.symbol).join(',') === (b.pushes || []).map((p) => p.symbol).join(',')
  )
}

const KolCard = memo(function KolCard({ kol = {}, tracked, onToggleFollow, onOpen, onOpenProject }) {
  const { t } = useTranslation()
  const handle = String(kol.screen_name || '').replace(/^@/, '')
  const tier = tierMeta(kol.tier)
  const verified = kol.verified
  const newFollows = Number(kol.recent_new_follows_count || 0)
  const narratives = Array.isArray(kol.narratives) ? kol.narratives.slice(0, 2) : []

  return (
    <article
      className={`xd-kol-card${tracked ? ' xd-kol-card--tracked' : ''}`}
      onClick={() => onOpen && onOpen(handle)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen && onOpen(handle) }}
    >
      <div className="xd-kol-card__head">
        <span className={`xd-kol-card__avatar xd-kol-card__avatar--${tier.cls}`}>
          <Avatar src={kol.avatar_url} alt={handle} size={42} />
          {verified && <span className="xd-kol-card__tick"><VerifiedTick size={11} /></span>}
        </span>
        <div className="xd-kol-card__id">
          <span className="xd-kol-card__handle">@{handle}</span>
          <span className="xd-kol-card__name">{kol.name || ''}</span>
        </div>
        <button
          type="button"
          className={`xd-kol-star${tracked ? ' xd-kol-star--on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleFollow && onToggleFollow(handle) }}
          aria-pressed={tracked}
          aria-label={tracked ? t('kolRadar.card.unfollow', 'Unfollow @{{handle}}', { handle }) : t('kolRadar.card.follow', 'Follow @{{handle}}', { handle })}
          title={tracked ? t('kolRadar.card.tracking', 'Tracking — remove from My Radar') : t('kolRadar.card.track', 'Add to My Radar')}
        >
          <FollowStar filled={tracked} />
        </button>
      </div>

      <div className="xd-kol-card__meta">
        <span className={`xd-kol-tierbadge xd-kol-tierbadge--${tier.cls}`}>{t(tier.key, tier.fallback)}</span>
        {kol.legit_score != null && (
          <LegitChip score={Math.round(Number(kol.legit_score))} label={kol.legit_label} t={t} />
        )}
        {narratives.map((n) => (
          <span className="xd-kol-card__narrative" key={n}>{n}</span>
        ))}
      </div>

      <div className="xd-kol-card__stats">
        <span className="xd-kol-card__stat">
          <span className="xd-kol-card__stat-value xd-num">{formatNum(kol.followers_count)}</span>
          <span className="xd-kol-card__stat-label">{t('kolRadar.followers', 'followers')}</span>
        </span>
        <span className="xd-kol-card__stat">
          <SignalScore signal={{ score: kol.signal_score }} variant="compact" />
          <span className="xd-kol-card__stat-label">{t('kolRadar.card.signal', 'signal')}</span>
        </span>
        {newFollows > 0 && (
          <span className="xd-kol-card__newbadge" title={t('kolRadar.card.newFollowsTip', '{{count}} new follows in the last 7d', { count: newFollows })}>
            <span className="xd-kol-card__newbadge-dot" aria-hidden="true" />
            <b className="xd-num">{newFollows}</b> {t('kolRadar.card.newFollows', 'new')}
          </span>
        )}
      </div>

      <div className="xd-kol-card__pushes-row">
        <span className="xd-kol-card__pushes-label">{t('kolRadar.card.pushes', 'Pushes')}</span>
        <PushChips pushes={kol.pushes} onOpenProject={onOpenProject} t={t} />
      </div>
    </article>
  )
}, kolCardEqual)

export default KolCard
