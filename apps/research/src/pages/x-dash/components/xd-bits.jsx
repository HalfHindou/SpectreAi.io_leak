/**
 * X Dash shared atoms - terminal-grade primitives reused across views and drawers.
 * All numbers in var(--font-mono) + tabular-nums via .xd-num. No marketing copy.
 */
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  formatNum, formatPercent, humanizeLabel, getFollowerTier, rankTopAuthors, looksVerified,
  describeStrengthSummary, MENTION_STRENGTH_META,
} from './x-dash-utils'
import {
  computeSignalScore, signalTier, SIGNAL_TIER_LABEL, buildRankTrajectory,
} from './xd-signal'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import { isAppActive } from '@/lib/idleManager'

/* ---------- XDDropdown ----------
   Custom dropdown that replaces the native <select>. Matches the design
   system: same height/radius/typography as .xd-select, a custom menu
   below the trigger, outside-click + Escape close, keyboard-friendly.

   Props:
     options : [{ key, label }]
     value   : currently selected key
     onChange: (key) => void
     align   : 'left' | 'right' (menu alignment)
     drop    : 'down' | 'up'  (menu opens below or above the trigger)
     compact : boolean - smaller trigger (pagination / dense toolbars)
     minWidth: number (px) - minimum menu width
*/
/* triggerLabel overrides the CLOSED-state text only (the menu keeps its own
   option labels). Used by the market-cap filter so an active custom band reads
   back as "$500K - $2M" instead of the generic "Custom range". */
export function XDDropdown({ options = [], value, onChange, align = 'left', drop = 'down', compact = false, minWidth = 180, ariaLabel, triggerLabel }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selected = options.find((o) => o.key === value) || options[0]

  /* outside-click + escape close. The menu is rendered inline so the
     dropdown stays inside its filter group flow - no portal needed. */
  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`xd-dropdown${open ? ' xd-dropdown--open' : ''}${compact ? ' xd-dropdown--compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="xd-dropdown__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="xd-dropdown__label">{triggerLabel || selected?.label || ''}</span>
        <svg className="xd-dropdown__chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className={`xd-dropdown__menu xd-dropdown__menu--${align} xd-dropdown__menu--${drop}`}
          style={{ minWidth }}
          role="listbox"
        >
          {options.map((opt) => {
            const active = opt.key === value
            return (
              <button
                key={opt.key}
                type="button"
                className={`xd-dropdown__opt${active ? ' xd-dropdown__opt--active' : ''}`}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.key)
                  setOpen(false)
                }}
              >
                <span className="xd-dropdown__opt-label">{opt.label}</span>
                {active && (
                  <svg className="xd-dropdown__opt-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.5 6.5 L4.8 8.8 L9.5 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ---------- SegmentDot ---------- */
const SEGMENT_TONE = {
  major: 'xd-seg--major',
  context: 'xd-seg--context',
  opportunity: 'xd-seg--opportunity',
}

export function SegmentDot({ segment, withLabel = false }) {
  const { t } = useTranslation()
  const key = String(segment || '').toLowerCase()
  const cls = SEGMENT_TONE[key] || 'xd-seg--opportunity'
  const label = humanizeLabel(segment) || t('xDash.bits.segment.default', 'Segment')
  return (
    <span className={`xd-seg ${cls}`} title={label}>
      <span className="xd-seg__dot" />
      {withLabel && <span className="xd-seg__label">{humanizeLabel(segment) || '-'}</span>}
    </span>
  )
}

/* ---------- Avatar ----------
   memo'd: props (src/alt/size/className) are primitive, so default shallow
   compare holds. Shields the many table/cluster avatars from re-rendering on
   every board poll when their src/alt didn't change. */
export const Avatar = memo(function Avatar({ src, alt, size = 28, className = '' }) {
  const [failed, setFailed] = useState(false)
  const letter = String(alt || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?'
  const dim = { width: size, height: size, minWidth: size }

  if (!src || failed) {
    return (
      <span className={`xd-avatar xd-avatar--fallback ${className}`} style={dim} aria-hidden="true">
        {letter}
      </span>
    )
  }
  return (
    <img
      className={`xd-avatar ${className}`}
      style={dim}
      src={src}
      alt={alt || ''}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
})

/* ---------- VerifiedTick ---------- shared X-style verified mark */
export const VerifiedTick = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
  </svg>
)

/* ---------- CarrierCluster ----------
   First-class "who is carrying this token" cell. Renders the 3 bootstrap
   top_authors as overlapping tier-ringed avatars + a +N carriers chip.
   Stays cheap: only uses the top_authors already in the row, never fetches.
   The whole cluster is ONE click target -> opens the token drawer focused
   on the Carriers board. Individual avatars get a lightweight CSS tooltip. */
const AVATAR_SIZES = [26, 23, 21]

export function CarrierCluster({
  authors = [],
  totalCount,
  onOpen,
  size = 'md',
}) {
  const { t } = useTranslation()
  const ranked = rankTopAuthors(authors).slice(0, 3)
  const shown = ranked.length
  const total = Number(totalCount || 0)
  const extra = total > shown ? total - shown : 0

  if (shown === 0) {
    return <span className="xd-carriers xd-carriers--empty">-</span>
  }

  const handleOpen = (e) => {
    if (!onOpen) return
    e.stopPropagation()
    onOpen()
  }

  return (
    <button
      type="button"
      className={`xd-carriers xd-carriers--${size}`}
      onClick={handleOpen}
      aria-label={t('xDash.bits.carrierCluster.aria', '{{count}} carriers - open carrier board', { count: total || shown })}
    >
      <span className="xd-carriers__stack">
        {ranked.map((a, i) => {
          const tier = getFollowerTier(a.followers_count)
          const dim = size === 'sm' ? AVATAR_SIZES[i] - 3 : AVATAR_SIZES[i]
          return (
            <span
              key={a.author_rest_id || a.screen_name || i}
              className={`xd-carriers__slot xd-carriers__slot--${tier.cls}`}
              style={{ zIndex: 10 - i }}
              data-tooltip={[
                a.screen_name ? `@${a.screen_name}` : (a.name || ''),
                t('xDash.bits.tooltip.followers', '{{count}} followers', { count: formatNum(a.followers_count) }),
                t('xDash.bits.tooltip.mentions', '{{count}} mentions', { count: formatNum(a.mention_count) }),
              ].filter(Boolean).join(' · ')}
              data-tooltip-pos="top"
            >
              <Avatar src={a.avatar_image_url} alt={a.screen_name || a.name} size={dim} />
              {looksVerified(a) && (
                <span className="xd-carriers__tick"><VerifiedTick size={9} /></span>
              )}
            </span>
          )
        })}
      </span>
      {extra > 0 && (
        <span className="xd-carriers__more xd-num" title={t('xDash.bits.carrierCluster.more', '{{count}} unique creators in the last 24h', { count: total })}>
          +{formatNum(extra)}
        </span>
      )}
    </button>
  )
}

/* ---------- CarrierRow ----------
   Full-width carrier board row for the token drawer. Avatar (tier ring +
   verified) -> handle + name + tier chip -> mentions / engagement ->
   carrier-strength bar (this author's share of the token's total weighted
   engagement). Click -> author dossier drawer. */
/* ---------- MentionStrengthChip ----------
 * Tiny pill that conveys mention.match.strength at a glance. Used in:
 *   - mention feed cards (per tweet)
 *   - Carriers list (per author, dominant across their tweets of the token)
 *   - Author drawer Top tokens list (per token, dominant across the author's
 *     mentions of that token)
 * Accepts either { kind } directly or a `summary` from buildStrengthLookup()
 * (uses summary.dominant). Pass `size="sm"` for the compact 9px variant. */
export function MentionStrengthChip({ kind, summary, size, showSubject, subject }) {
  const { t } = useTranslation()
  const resolved = kind || summary?.dominant
  if (!resolved) return null
  const meta = MENTION_STRENGTH_META[resolved]
  if (!meta) return null
  const label = t(meta.key, meta.fallback)
  const tooltip = summary ? describeStrengthSummary(summary) : label
  const cls = [
    'xd-mention__strength',
    `xd-mention__strength--${meta.tone}`,
    size === 'sm' && 'xd-mention__strength--sm',
  ].filter(Boolean).join(' ')
  return (
    <span className={cls} title={tooltip}>
      {label}
      {showSubject && subject && resolved !== 'primary' && (
        <span className="xd-mention__strength-subject">{t('xDash.bits.mainSubject', 'main subject {{subject}}', { subject })}</span>
      )}
    </span>
  )
}

export function CarrierRow({
  author = {},
  totalEngagement = 0,
  onOpen,
  boardRank,
  strengthSummary,
}) {
  const { t } = useTranslation()
  const tier = getFollowerTier(author.followers_count)
  const weighted = Number(author.total_weighted_engagement || 0)
  const total = Number(totalEngagement || 0)
  const share = total > 0 ? Math.max(0, Math.min(1, weighted / total)) : 0
  const mentions = Number(author.mention_count || author.proof_mentions || 0)
  const handle = String(author.screen_name || '').replace(/^@/, '')

  return (
    <button type="button" className="xd-carrierrow" onClick={onOpen}>
      <span className={`xd-carrierrow__avatar xd-carrierrow__avatar--${tier.cls}`}>
        <Avatar src={author.avatar_image_url} alt={handle || author.name} size={32} />
        {looksVerified(author) && (
          <span className="xd-carrierrow__tick"><VerifiedTick size={10} /></span>
        )}
        {boardRank != null && <span className="xd-carrierrow__board">{boardRank}</span>}
      </span>
      <span className="xd-carrierrow__id">
        <span className="xd-carrierrow__handle">
          {handle ? `@${handle}` : (author.name || t('xDash.bits.unknown', 'Unknown'))}
          <span className={`xd-followtier ${tier.cls}`}>{t(tier.key, tier.fallback)}</span>
          <MentionStrengthChip summary={strengthSummary} size="sm" />
        </span>
        <span className="xd-carrierrow__name">{author.name || ''}</span>
      </span>
      <span className="xd-carrierrow__metrics">
        <span className="xd-carrierrow__metric">
          <span className="xd-carrierrow__metric-value xd-num">{formatNum(mentions)}</span>
          <span className="xd-carrierrow__metric-label">{t('xDash.bits.metrics.mentions', 'mentions')}</span>
        </span>
        <span className="xd-carrierrow__metric">
          <span className="xd-carrierrow__metric-value xd-num">{formatNum(weighted, { maxFraction: 0 })}</span>
          <span className="xd-carrierrow__metric-label">{t('xDash.bits.metrics.engagement', 'engagement')}</span>
        </span>
      </span>
      <span className="xd-carrierrow__strength" title={t('xDash.bits.carrierRow.shareTooltip', '{{pct}}% of token engagement', { pct: (share * 100).toFixed(1) })}>
        <span className="xd-carrierrow__strength-track">
          <span className="xd-carrierrow__strength-fill" style={{ width: `${share * 100}%` }} />
        </span>
        <span className="xd-carrierrow__strength-pct xd-num">{(share * 100).toFixed(0)}%</span>
      </span>
    </button>
  )
}

/* ---------- TokenCell ----------
   memo'd with a field-level comparator: callers (TokenRow) build a fresh
   `token` identity object every render, so default shallow compare would never
   hold. Compare only the identity fields actually rendered + the primitive
   props - so the cell re-renders only when its visible content changes. */
function tokenCellPropsEqual(prev, next) {
  if (prev.onClick !== next.onClick || prev.subtitle !== next.subtitle || prev.compact !== next.compact) {
    return false
  }
  const a = prev.token || {}
  const b = next.token || {}
  return (
    a.cashtag === b.cashtag
    && a.symbol === b.symbol
    && a.name === b.name
    && a.cg_id === b.cg_id
    && a.segment === b.segment
    && a.chain === b.chain
    && (a.image_small || a.image_url || a.image) === (b.image_small || b.image_url || b.image)
  )
}

export const TokenCell = memo(function TokenCell({ token = {}, onClick, subtitle, compact = false }) {
  const cashtag = token.cashtag || (token.symbol ? `$${token.symbol}` : '-')
  const logo = token.image_small || token.image_url || token.image
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`xd-tokencell${compact ? ' xd-tokencell--compact' : ''}${onClick ? ' xd-tokencell--btn' : ''}`}
      onClick={onClick}
    >
      <Avatar src={logo} alt={token.symbol || token.name} size={compact ? 24 : 30} />
      <span className="xd-tokencell__text">
        <span className="xd-tokencell__top">
          <span className="xd-tokencell__cashtag xd-num">{cashtag}</span>
          {token.segment && <SegmentDot segment={token.segment} />}
        </span>
        <span className="xd-tokencell__sub">
          {subtitle || token.name || token.cg_id || ''}
          {token.chain && <span className="xd-tokencell__chain">{humanizeLabel(token.chain)}</span>}
        </span>
      </span>
    </Tag>
  )
}, tokenCellPropsEqual)

/* ---------- RankMove ----------
   memo'd: direction/delta are primitive, default shallow compare holds. */
export const RankMove = memo(function RankMove({ direction, delta }) {
  const { t } = useTranslation()
  const dir = String(direction || 'flat').toLowerCase()
  const amount = Math.abs(Number(delta || 0))
  if (dir === 'new') {
    return <span className="xd-rankmove xd-rankmove--new">{t('xDash.bits.rankMove.new', 'NEW')}</span>
  }
  if (dir === 'up') {
    return (
      <span className="xd-rankmove xd-rankmove--up">
        <span className="xd-rankmove__caret">&#9650;</span>
        {amount > 0 && <span className="xd-num">{amount}</span>}
      </span>
    )
  }
  if (dir === 'down') {
    return (
      <span className="xd-rankmove xd-rankmove--down">
        <span className="xd-rankmove__caret">&#9660;</span>
        {amount > 0 && <span className="xd-num">{amount}</span>}
      </span>
    )
  }
  return <span className="xd-rankmove xd-rankmove--flat">&#8211;</span>
})

/* ---------- MetricChip ---------- */
// tone scale for ratio-style metrics (velocity, novelty): >2 hot, >1 warm, else cool
export function ratioTone(value) {
  const v = Number(value || 0)
  if (v >= 2) return 'hot'
  if (v >= 1) return 'warm'
  return 'cool'
}

export function MetricChip({ value, tone, suffix = 'x', digits = 2, title }) {
  const v = Number(value || 0)
  const resolved = tone || ratioTone(v)
  const display = Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : '-'
  return (
    <span className={`xd-chip xd-chip--${resolved} xd-num`} title={title}>
      {display}
    </span>
  )
}

/* ---------- CleanSignalBar ---------- */
// 0-1 score -> bar + percent. >=0.70 bull, 0.55-0.69 amber, <0.55 bear
export function cleanSignalTone(score) {
  const s = Number(score || 0)
  if (s >= 0.70) return 'bull'
  if (s >= 0.55) return 'amber'
  return 'bear'
}

export function CleanSignalBar({ score, width = 56 }) {
  const { t } = useTranslation()
  const s = Math.max(0, Math.min(1, Number(score || 0)))
  const tone = cleanSignalTone(s)
  return (
    <span className="xd-csbar" title={t('xDash.bits.cleanSignal.tooltip', 'Clean signal {{pct}}%', { pct: (s * 100).toFixed(0) })}>
      <span className="xd-csbar__track" style={{ width }}>
        <span className={`xd-csbar__fill xd-csbar__fill--${tone}`} style={{ width: `${s * 100}%` }} />
      </span>
      <span className={`xd-csbar__pct xd-num xd-csbar__pct--${tone}`}>{(s * 100).toFixed(0)}%</span>
    </span>
  )
}

/* ---------- StatBar ---------- generic 0-1 bar without percent label */
export function StatBar({ value, tone = 'neutral', width }) {
  const v = Math.max(0, Math.min(1, Number(value || 0)))
  return (
    <span className="xd-statbar" style={width ? { width } : undefined}>
      <span className={`xd-statbar__fill xd-statbar__fill--${tone}`} style={{ width: `${v * 100}%` }} />
    </span>
  )
}

/* ---------- Sparkbar ---------- mini horizontal magnitude bar relative to a max */
export function Sparkbar({ value, max, tone = 'neutral', width = 60 }) {
  const v = Number(value || 0)
  const m = Number(max || 0)
  const pct = m > 0 ? Math.max(0, Math.min(1, v / m)) : 0
  return (
    <span className="xd-sparkbar" style={{ width }}>
      <span className={`xd-sparkbar__fill xd-sparkbar__fill--${tone}`} style={{ width: `${pct * 100}%` }} />
    </span>
  )
}

/* ---------- QualityPill ---------- */
const QUALITY_MAP = {
  clean: { key: 'xDash.bits.quality.clean', fallback: 'Clean', cls: 'xd-quality--clean' },
  soft_penalized: { key: 'xDash.bits.quality.soft', fallback: 'Soft', cls: 'xd-quality--soft' },
  quarantined: { key: 'xDash.bits.quality.quarantined', fallback: 'Quarantined', cls: 'xd-quality--quarantined' },
}

export function QualityPill({ status }) {
  const { t } = useTranslation()
  const k = String(status || '').toLowerCase()
  const meta = QUALITY_MAP[k]
  if (meta) return <span className={`xd-quality ${meta.cls}`}>{t(meta.key, meta.fallback)}</span>
  return <span className="xd-quality xd-quality--soft">{humanizeLabel(status) || '-'}</span>
}

/* ---------- TierBadge ---------- */
const TIER_MAP = {
  hot: { key: 'xDash.bits.tier.hot', fallback: 'Hot', cls: 'xd-tier--hot' },
  warm: { key: 'xDash.bits.tier.warm', fallback: 'Warm', cls: 'xd-tier--warm' },
  watch: { key: 'xDash.bits.tier.watch', fallback: 'Watch', cls: 'xd-tier--watch' },
  cold: { key: 'xDash.bits.tier.cold', fallback: 'Cold', cls: 'xd-tier--cold' },
  inactive: { key: 'xDash.bits.tier.inactive', fallback: 'Inactive', cls: 'xd-tier--inactive' },
}

export function TierBadge({ tier }) {
  const { t } = useTranslation()
  const k = String(tier || '').toLowerCase()
  const meta = TIER_MAP[k]
  if (meta) return <span className={`xd-tier ${meta.cls}`}>{t(meta.key, meta.fallback)}</span>
  return <span className="xd-tier xd-tier--watch">{humanizeLabel(tier) || t('xDash.bits.tier.watch', 'Watch')}</span>
}

/* ---------- Num ---------- formatted social metric, tabular.
   maxFraction: 0 - social metrics (mentions, authors, weighted engagement)
   are counts or float indexes; sub-1K floats were rendering raw decimals
   ("74.117"). Never used for prices, so the cap is safe here. */
export function Num({ value, percent = false, digits, className = '' }) {
  const text = percent ? formatPercent(value, digits ?? 0) : formatNum(value, { ...(digits != null ? { digits } : null), maxFraction: 0 })
  return <span className={`xd-num ${className}`}>{text}</span>
}

/* ---------- Pagination ---------- */
export function Pagination({ page, pageCount, onPage, perPage, onPerPage, perPageOptions = [20, 50, 100] }) {
  const { t } = useTranslation()
  const current = Number(page || 1)
  const total = Number(pageCount || 1)
  if (total <= 1 && !onPerPage) return null
  return (
    <div className="xd-pagination">
      {onPerPage && (
        <div className="xd-pagination__perpage">
          <span className="xd-pagination__label">{t('xDash.bits.pagination.rows', 'Rows')}</span>
          {/* Glass dropdown that opens UPWARD — the pagination sits at the very
              bottom of the list, so a downward native <select> popup was clipped
              off-screen ("100" cut off). Custom menu keeps it on-screen + on-brand. */}
          <XDDropdown
            compact
            drop="up"
            align="left"
            minWidth={92}
            ariaLabel={t('xDash.bits.pagination.rows', 'Rows')}
            value={String(perPage)}
            onChange={(k) => onPerPage(Number(k))}
            options={perPageOptions.map((opt) => ({ key: String(opt), label: String(opt) }))}
          />
        </div>
      )}
      <div className="xd-pagination__nav">
        <button
          type="button"
          className="xd-btn xd-btn--ghost xd-btn--sm"
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
        >
          {t('xDash.bits.pagination.prev', 'Prev')}
        </button>
        <span className="xd-pagination__status xd-num">
          {current} / {total}
        </span>
        <button
          type="button"
          className="xd-btn xd-btn--ghost xd-btn--sm"
          disabled={current >= total}
          onClick={() => onPage(current + 1)}
        >
          {t('xDash.bits.pagination.next', 'Next')}
        </button>
      </div>
    </div>
  )
}

/* ---------- EmptyState ---------- */
/* ---------- Feed health ----------
   Every view ships its own EmptyState copy written in the voice of "the market
   is quiet for these filters" — "No categories detected", "No creators ranked
   for this window", "Widen the segment / market-cap floor". True when the board
   is live. A lie while the feed is rebuilding: there is no window to make a
   claim about, and telling a reader to widen filters sends them to change
   settings that cannot possibly help.

   The page publishes its health here rather than threading a flag through the
   ~10 view components, so one provider fixes every tab at once. */
export const XDashFeedHealthContext = createContext({ updating: false, detail: null })
export const useXDashFeedHealth = () => useContext(XDashFeedHealthContext)

export function EmptyState({ title, detail, icon, action }) {
  const health = useXDashFeedHealth()
  // Defer to the honest notice: describe the outage, never the market.
  if (health?.updating) return <ErrorState detail={health.detail} />

  return (
    <div className="xd-empty">
      {icon && <div className="xd-empty__icon">{icon}</div>}
      <div className="xd-empty__title">{title}</div>
      {detail && <div className="xd-empty__detail">{detail}</div>}
      {action && <div className="xd-empty__action">{action}</div>}
    </div>
  )
}

/* ---------- ErrorState ----------
   A feed failure here is almost always transient - the X Dash indexer is
   rebuilding or the API is briefly down - so instead of a dead-end error box
   this renders an "X Dash is updating" loader and quietly polls onRetry until
   the feed comes back. Hidden/idle tabs skip the poll (upstream cost defense). */
export function ErrorState({ message, detail, onRetry, retryMs = 20000 }) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!onRetry) return undefined
    const id = window.setInterval(() => {
      if (document.hidden || !isAppActive()) return
      onRetry()
    }, retryMs)
    return () => window.clearInterval(id)
  }, [onRetry, retryMs])
  /* Every view passes `message={error}` — it was silently dropped for a long
     time, so the real failure never reached the screen. Keep the calm
     "updating" voice as the headline; surface the actual reason as a muted
     technical line underneath. */
  const reason = message == null ? '' : String(message)
  return (
    <div className="xd-updating" role="status" aria-live="polite">
      <div className="xd-updating__beacon" aria-hidden="true">
        <span className="xd-updating__dot" />
      </div>
      <div className="xd-updating__title">{t('xDash.bits.updating.title', 'X Dash is updating')}</div>
      {/* `detail` overrides the generic sentence when the caller knows something
          specific and more useful — e.g. which window IS current. Passing it as
          `message` instead put it in the truncated technical slot below, where
          the actionable half was ellipsised away. */}
      <div className="xd-updating__detail">
        {detail || t('xDash.bits.updating.detail', 'Fresh social intelligence is being indexed. This view reconnects on its own.')}
      </div>
      {reason && (
        <div className="xd-updating__reason" title={reason}>{reason}</div>
      )}
      <div className="xd-updating__bars" aria-hidden="true">
        <div className="xd-shimmer-bar animate-shimmer" />
        <div className="xd-shimmer-bar animate-shimmer" />
        <div className="xd-shimmer-bar animate-shimmer" />
      </div>
      {onRetry && (
        <div className="xd-updating__action">
          <button type="button" className="xd-btn xd-btn--ghost xd-btn--sm" onClick={onRetry}>
            {t('xDash.bits.updating.retry', 'Refresh now')}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------- Shimmer ---------- */
export function Shimmer({ variant = 'row', count = 8 }) {
  const items = Array.from({ length: count })
  if (variant === 'card') {
    return (
      <div className="xd-shimmer-grid">
        {items.map((_, i) => (
          <div key={i} className="xd-shimmer-card">
            <div className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" />
            <div className="xd-shimmer-bar animate-shimmer" />
            <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" />
            <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" />
          </div>
        ))}
      </div>
    )
  }
  if (variant === 'drawer') {
    return (
      <div className="xd-shimmer-drawer">
        {items.map((_, i) => (
          <div key={i} className="xd-shimmer-bar xd-shimmer-bar--block animate-shimmer" />
        ))}
      </div>
    )
  }
  return (
    <div className="xd-shimmer-rows">
      {items.map((_, i) => (
        <div key={i} className="xd-shimmer-row">
          <div className="xd-shimmer-dot animate-shimmer" />
          <div className="xd-shimmer-bar animate-shimmer" />
          {/* carrier-cluster placeholder - 3 overlapping dots + count chip */}
          <div className="xd-shimmer-carriers">
            <span className="xd-shimmer-carrier animate-shimmer" />
            <span className="xd-shimmer-carrier animate-shimmer" />
            <span className="xd-shimmer-carrier animate-shimmer" />
            <span className="xd-shimmer-bar xd-shimmer-bar--xs animate-shimmer" />
          </div>
          <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" />
          <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" />
        </div>
      ))}
    </div>
  )
}

/* ---------- StatTile ---------- compact label/value tile for metric grids.
   `info` is an optional glossary id - when set, an InfoTip dot is rendered
   after the label (visible in the app's Info Mode). */
export function StatTile({ label, value, tone, sub, info }) {
  const tip = getMetricInfo(info)
  return (
    <div className="xd-stattile">
      <div className="xd-stattile__label">{label}{tip && <InfoTip text={tip} position="top" />}</div>
      <div className={`xd-stattile__value xd-num${tone ? ` xd-stattile__value--${tone}` : ''}`}>{value}</div>
      {sub && <div className="xd-stattile__sub">{sub}</div>}
    </div>
  )
}

/* ---------- inline SVG icons (tiny one-offs not in spectreIcons) ---------- */
export const RefreshIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
)

export const ArrowFlowIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" />
  </svg>
)

/* ---------- SignalScore ----------
   THE verdict atom. One synthesized 0-100 number + tier pill + thin radial.
   `compact` (table cell): number + tier dot + bar. `full` (drawer header):
   bigger number + tier label + radial ring. Computation is memoized per row
   so re-renders of a 50-row table don't re-fuse every score.

   Pass either a precomputed { score, tier, parts } via `signal`, or a raw
   token/author row via `row` + a `compute` fn (defaults to token scorer). */
export function SignalScore({ row, signal, compute, variant = 'compact' }) {
  const { t } = useTranslation()
  const resolved = useMemo(() => {
    if (signal) return signal
    const fn = compute || computeSignalScore
    return fn(row || {})
  }, [signal, row, compute])

  const score = Number(resolved?.score || 0)
  const tier = resolved?.tier || signalTier(score)
  const pct = Math.max(0, Math.min(100, score))

  if (variant === 'full') {
    // radial ring: 2*pi*r, r=20 -> circumference ~125.66
    const R = 20
    const C = 2 * Math.PI * R
    const dash = (pct / 100) * C
    return (
      <div className={`xd-sscore xd-sscore--full xd-sscore--${tier}`}>
        <svg className="xd-sscore__ring" width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="xd-sscore__ring-track" cx="26" cy="26" r={R} fill="none" strokeWidth="3.5" />
          <circle
            className="xd-sscore__ring-fill"
            cx="26" cy="26" r={R} fill="none" strokeWidth="3.5"
            strokeDasharray={`${dash} ${C}`}
            strokeLinecap="round"
            transform="rotate(-90 26 26)"
          />
        </svg>
        <div className="xd-sscore__full-text">
          <span className="xd-sscore__num xd-num">{score}</span>
          <span className="xd-sscore__tier">{SIGNAL_TIER_LABEL[tier] || tier}</span>
        </div>
      </div>
    )
  }

  return (
    <span className={`xd-sscore xd-sscore--compact xd-sscore--${tier}`} title={t('xDash.bits.signalScore.tooltip', 'Signal Score {{score}} / 100 - {{tier}}', { score, tier: SIGNAL_TIER_LABEL[tier] || tier })}>
      <span className="xd-sscore__num xd-num">{score}</span>
      <span className="xd-sscore__bar">
        <span className="xd-sscore__bar-fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

/* ---------- RankSparkline ----------
   Tiny inline rank-trajectory line built from a bootstrap row's rank-window
   anchor points (opening / best / worst / previous / now). Higher line =
   better rank. Tone from the net direction across the window: improving =
   bull, slipping = bear, flat = neutral. Pure SVG, no chart library. */
export function RankSparkline({ row, width = 64, height = 22 }) {
  const points = useMemo(() => buildRankTrajectory(row), [row])

  if (points.length < 2) {
    return <span className="xd-rankspark xd-rankspark--empty">&#8211;</span>
  }

  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const step = w / (points.length - 1)
  const coords = points.map((y, i) => [pad + i * step, pad + (1 - y) * h])
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')

  // net move: last point vs first (y is already "higher = better rank")
  const net = points[points.length - 1] - points[0]
  const tone = net > 0.02 ? 'bull' : net < -0.02 ? 'bear' : 'flat'
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg
      className={`xd-rankspark xd-rankspark--${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path d={path} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="1.8" />
    </svg>
  )
}

/* ---------- SignalPartsBars ----------
   The breakdown BEHIND a Signal Score: each 0-1 part as a labeled thin bar.
   Used at the top of the token + author drawers as supporting evidence. */
export function SignalPartsBars({ parts = {}, labels = {}, infoMap = {} }) {
  const entries = Object.keys(parts)
  if (entries.length === 0) return null
  return (
    <div className="xd-sparts">
      {entries.map((key) => {
        const v = Math.max(0, Math.min(1, Number(parts[key] || 0)))
        const tip = getMetricInfo(infoMap[key])
        return (
          <div className="xd-sparts__row" key={key}>
            <span className="xd-sparts__label">{labels[key] || humanizeLabel(key)}{tip && <InfoTip text={tip} position="top" />}</span>
            <span className="xd-sparts__track">
              <span className="xd-sparts__fill" style={{ width: `${v * 100}%` }} />
            </span>
            <span className="xd-sparts__val xd-num">{Math.round(v * 100)}</span>
          </div>
        )
      })}
    </div>
  )
}
