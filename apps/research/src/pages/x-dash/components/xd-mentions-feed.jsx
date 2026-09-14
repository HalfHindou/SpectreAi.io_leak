/**
 * Shared real-tweet mentions feed used by both drawers.
 * Renders the full tweet text, author, engagement counts, x.com link,
 * media and context pills. Recent / Impact sort toggle.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Avatar,
} from './xd-bits'
import {
  relativeTime, getMentionText, getMentionUrl, getMentionMediaUrl,
  getMentionContextPills, getMentionMatch, filterMentionsByMode, splitTextLinks, formatNum,
} from './x-dash-utils'

const HeartIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
)
const ReplyIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
)
const RepostIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)
const ViewsIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="M18 9l-5 5-3-3-4 4" />
  </svg>
)
const ExternalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

function MentionCard({ mention, tokenInfo, onOpenAuthor, ca }) {
  const { t } = useTranslation()
  const author = mention.author || {}
  const tweet = mention.tweet || {}
  const text = getMentionText(mention)
  /* Interim CA-match: does this post actually contain the token's contract
     address? The most reliable signal it's about THIS project (not a same-
     ticker collision), and it's the post a user should open to copy the
     correct CA. Full board-wide CA-match % is a data-api follow-up. */
  const hasCa = !!(ca && text && text.toLowerCase().includes(ca))
  const url = getMentionUrl(mention)
  const media = getMentionMediaUrl(mention)
  const pills = getMentionContextPills(mention, tokenInfo)
  const matchInfo = getMentionMatch(mention)
  const authorId = author.rest_id || author.id
  const segments = splitTextLinks(text)
  const currentSymbol = String(tokenInfo?.symbol || tokenInfo?.cashtag || '').replace(/^\$/, '').toUpperCase()
  /* For non-primary mentions, point at the cashtag the tweet was really about
     - but only if it's different from the current token being viewed (no
     point telling a $BTC reader that the main subject is $BTC). */
  const realSubject = matchInfo.primaryCashtags.find((tag) => {
    const sym = String(tag).replace(/^\$/, '').toUpperCase()
    return sym && sym !== currentSymbol
  })

  return (
    <div className={`xd-mention xd-mention--${matchInfo.tone}`}>
      <div className="xd-mention__head">
        <Avatar src={author.avatar_image_url || author.profile_image_url} alt={author.screen_name} size={28} />
        <button
          type="button"
          className="xd-mention__author"
          onClick={() => authorId && onOpenAuthor && onOpenAuthor(authorId)}
        >
          <span className="xd-mention__author-name">
            {author.name || author.screen_name}
            {author.screen_name && <span className="xd-cell-muted"> @{author.screen_name}</span>}
          </span>
          <span className="xd-mention__time">{relativeTime(tweet.created_at_utc, t)}</span>
        </button>
        {matchInfo.label && (
          <span
            className={`xd-mention__strength xd-mention__strength--${matchInfo.tone}`}
            title={matchInfo.reason ? matchInfo.reason.replace(/_/g, ' ') : matchInfo.label}
          >
            {matchInfo.label}
            {realSubject && matchInfo.kind !== 'primary' && (
              <span className="xd-mention__strength-subject">
                {t('xDash.mentions.mainSubject', 'main subject {{subject}}', { subject: realSubject })}
              </span>
            )}
          </span>
        )}
        {hasCa && (
          <span className="xd-mention__ca" title={t('xDash.mentions.caMatchTip', 'This post includes the contract address - open it to copy the correct CA')}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
            {t('xDash.mentions.caMatch', 'CA')}
          </span>
        )}
        {url && (
          <a className="xd-mention__link" href={url} target="_blank" rel="noopener noreferrer" title={t('xDash.mentions.openOnX', 'Open on X')}>
            <ExternalIcon />
          </a>
        )}
      </div>

      {text && (
        <div className="xd-mention__text">
          {segments.map((seg, i) =>
            seg.type === 'link' ? (
              <a key={i} href={seg.value} target="_blank" rel="noopener noreferrer">{seg.value}</a>
            ) : (
              <span key={i}>{seg.value}</span>
            ),
          )}
        </div>
      )}

      {media && <img className="xd-mention__media" src={media} alt={`Attached media for tweet by @${tweet?.user?.screen_name || 'unknown'}`} loading="lazy" />}

      <div className="xd-mention__stats">
        <span className="xd-mention__stat"><HeartIcon /><b className="xd-num">{formatNum(tweet.favorite_count)}</b></span>
        <span className="xd-mention__stat"><ReplyIcon /><b className="xd-num">{formatNum(tweet.reply_count)}</b></span>
        <span className="xd-mention__stat"><RepostIcon /><b className="xd-num">{formatNum(tweet.retweet_count)}</b></span>
        <span className="xd-mention__stat"><ViewsIcon /><b className="xd-num">{formatNum(tweet.views_count)}</b></span>
        {mention.derived?.weighted_engagement != null && (
          <span className="xd-mention__stat">
            <b className="xd-num">{formatNum(mention.derived.weighted_engagement, { maxFraction: 0 })}</b> {t('xDash.mentions.weighted', 'weighted')}
          </span>
        )}
      </div>

      {pills.length > 0 && (
        <div className="xd-mention__pills">
          {pills.map((p) => (
            <span key={p} className="xd-mention__pill">{p}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function XDMentionsFeed({ mentions = [], tokenInfo = {}, onOpenAuthor, label }) {
  const { t } = useTranslation()
  const resolvedLabel = label || t('xDash.mentions.label', 'Mentions')
  const [mode, setMode] = useState('recent')
  const [showWeak, setShowWeak] = useState(false)

  /* Drop weak matches by default so the feed reads as the tokens the author
     was actually talking about, not every low-confidence ecosystem brush. */
  const { visibleMentions, weakCount } = useMemo(() => {
    let weakSeen = 0
    const visible = []
    for (const m of mentions) {
      const info = getMentionMatch(m)
      if (info.hideByDefault) {
        weakSeen += 1
        if (!showWeak) continue
      }
      visible.push(m)
    }
    return { visibleMentions: visible, weakCount: weakSeen }
  }, [mentions, showWeak])

  const filtered = useMemo(
    () => filterMentionsByMode(visibleMentions, mode, tokenInfo),
    [visibleMentions, mode, tokenInfo],
  )

  /* Interim CA-match read over the SHOWN posts (sample-based, not the full
     board). Only meaningful for on-chain tokens that carry a contract. */
  const ca = String(tokenInfo?.contract_address || '').trim().toLowerCase()
  const caStat = useMemo(() => {
    if (!ca) return null
    const shown = filtered.slice(0, 40)
    let hits = 0
    for (const m of shown) {
      const txt = getMentionText(m)
      if (txt && txt.toLowerCase().includes(ca)) hits += 1
    }
    return shown.length ? { hits, total: shown.length } : null
  }, [ca, filtered])

  if (!mentions.length) {
    return (
      <div>
        <div className="xd-drawer-section__label">{resolvedLabel}</div>
        <div className="xd-inline-detail">{t('xDash.mentions.empty', 'No tweets captured in this window.')}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="xd-feed-toolbar">
        <div className="xd-drawer-section__label" style={{ margin: 0 }}>{resolvedLabel}</div>
        <div className="xd-toggle">
          {[
            { key: 'recent', label: t('xDash.mentions.mode.recent', 'recent') },
            { key: 'impact', label: t('xDash.mentions.mode.impact', 'impact') },
          ].map((m) => (
            <button
              key={m.key}
              type="button"
              className={`xd-toggle__btn${mode === m.key ? ' xd-toggle__btn--active' : ''}`}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {weakCount > 0 && (
          <button
            type="button"
            className={`xd-feed-toolbar__weak${showWeak ? ' is-on' : ''}`}
            onClick={() => setShowWeak((v) => !v)}
            title={showWeak
              ? t('xDash.mentions.weak.hideTitle', 'Hide low-confidence matches')
              : t('xDash.mentions.weak.showTitle', 'Show low-confidence matches')}
          >
            {showWeak
              ? t('xDash.mentions.weak.hide', 'hide weak')
              : t('xDash.mentions.weak.show', 'show weak ({{count}})', { count: weakCount })}
          </button>
        )}
      </div>
      {caStat && (
        <div className="xd-mentions-castat" title={t('xDash.mentions.caStatTip', 'Share of the shown posts that include this token contract address - the surest sign they mean THIS project, not a same-ticker one. Sample-based; full board-wide CA-match is coming.')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
          <b className="xd-num">{caStat.hits}/{caStat.total}</b>
          <span>{t('xDash.mentions.caStat', 'shown posts include the contract')}</span>
        </div>
      )}
      <div className="xd-mentions">
        {filtered.slice(0, 40).map((mention, i) => (
          <MentionCard
            key={mention.tweet?.tweet_id || i}
            mention={mention}
            tokenInfo={tokenInfo}
            onOpenAuthor={onOpenAuthor}
            ca={ca}
          />
        ))}
      </div>
    </div>
  )
}
