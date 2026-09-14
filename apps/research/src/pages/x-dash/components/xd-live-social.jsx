import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTokenXSocial } from '@/hooks/useTokenXSocial'

/* Live X conversation for a token X Dash doesn't track. Resolves the project's
   real handle (via DexScreener) and shows the genuine conversation, because the
   tracked metrics endpoint returns empty for off-universe tokens. */

function renderText(text) {
  if (!text) return null
  const parts = String(text).split(/(\$[A-Za-z]{1,10}\b|@\w{1,20}|#\w+)/g)
  return parts.map((p, i) =>
    /^[$@#]/.test(p) ? <span key={i} className="xls-entity">{p}</span> : <span key={i}>{p}</span>
  )
}
const fmt = (n) => {
  if (!n) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

function Tweet({ tweet }) {
  const [bad, setBad] = useState(false)
  const initial = (tweet.name || tweet.username || '?').trim().charAt(0).toUpperCase()
  const likes = fmt(tweet.likes)
  const rts = fmt(tweet.retweets)
  const views = fmt(tweet.views)
  return (
    <a href={tweet.url || '#'} target="_blank" rel="noopener noreferrer" className="xls-tweet">
      <div className="xls-tweet-head">
        <span className="xls-avatar">
          {tweet.avatar && !bad
            ? <img src={tweet.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
            : <span className="xls-avatar-fb">{initial}</span>}
        </span>
        <span className="xls-id">
          <span className="xls-name">{tweet.name || tweet.username}</span>
          {tweet.username && <span className="xls-handle">@{tweet.username}</span>}
        </span>
      </div>
      <p className="xls-text">{renderText(tweet.text)}</p>
      <div className="xls-stats">
        {rts && <span>{rts} RP</span>}
        {likes && <span>{likes} likes</span>}
        {views && <span>{views} views</span>}
      </div>
    </a>
  )
}

function Skeletons() {
  return (
    <div className="xls-skels" aria-hidden="true">
      {[0, 1, 2].map((i) => <div key={i} className={`xls-skel animate-shimmer stagger-${i + 1}`} />)}
    </div>
  )
}

const fmtFollowers = (n) => {
  if (!n) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

function KolChip({ kol }) {
  const [bad, setBad] = useState(false)
  const initial = (kol.username || '?').trim().charAt(0).toUpperCase()
  const f = fmtFollowers(kol.followers)
  return (
    <a className="xls-kol" href={`https://x.com/${kol.username}`} target="_blank" rel="noopener noreferrer" title={`@${kol.username}${f ? ` · ${f} followers` : ''}`}>
      <span className="xls-kol-av">
        {kol.avatar && !bad
          ? <img src={kol.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
          : <span className="xls-kol-fb">{initial}</span>}
      </span>
      <span className="xls-kol-id">
        <span className="xls-kol-name">@{kol.username}</span>
        {f && <span className="xls-kol-followers">{f}</span>}
      </span>
    </a>
  )
}

export default function XDLiveSocial({ token, enabled = true }) {
  const { t } = useTranslation()
  const { handle, website, resolved, conversation, ticker, kols, stats, loading, error, symbol } =
    useTokenXSocial(token, { enabled })

  const tickerLabel = symbol ? `$${symbol}` : 'ticker'

  // Distinguish the two empty causes so a screenshot is self-diagnosing:
  // account known but quiet vs. couldn't resolve / no account linked on-chain.
  const emptyConversationMsg = handle
    ? t('xDash.liveSocial.noPosts', 'No recent posts from @{{handle}}.', { handle })
    : resolved
      ? t('xDash.liveSocial.noAccount', "No X account is linked to this token on-chain (DexScreener), so there's no project feed to pull.")
      : t('xDash.liveSocial.noResolve', "Couldn't reach DexScreener to resolve this token's X account — try again in a moment.")

  return (
    <section className="xls" aria-label={t('xDash.liveSocial.title', 'Live on X')}>
      <div className="xls-head">
        <span className="xls-kicker">{t('xDash.liveSocial.kicker', 'Live on X')}</span>
        {handle && (
          <a className="xls-handle-link" href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">
            @{handle}
          </a>
        )}
        {website && (
          <a className="xls-site-link" href={website} target="_blank" rel="noopener noreferrer">
            {t('xDash.liveSocial.site', 'site')}
          </a>
        )}
      </div>
      <p className="xls-blurb">
        {t('xDash.liveSocial.blurb', "Not in X Dash's tracked set — here's who's talking and what they're saying, read live from X.")}
      </p>

      {error && <div className="xls-msg xls-msg--err">{error}</div>}

      {/* Live stats computed from the real conversation (no tracked metrics). */}
      {!loading && !error && stats.posts > 0 && (
        <div className="xls-stat-row">
          <span className="xls-stat"><b>{stats.authors}</b> {t('xDash.liveSocial.voices', 'voices')}</span>
          <span className="xls-stat"><b>{fmtFollowers(kols[0]?.followers) || '—'}</b> {t('xDash.liveSocial.topReach', 'top reach')}</span>
          <span className="xls-stat"><b>{fmtFollowers(stats.engagement) || stats.engagement}</b> {t('xDash.liveSocial.engagement', 'engagement')}</span>
          <span className="xls-stat"><b>{stats.posts}</b> {t('xDash.liveSocial.posts', 'posts')}</span>
        </div>
      )}

      {/* Top voices / KOLs — who is actually carrying the token, by reach. */}
      {!loading && kols.length > 0 && (
        <>
          <div className="xls-group-head">
            <span className="xls-group-name">{t('xDash.liveSocial.topVoices', 'Top voices')}</span>
          </div>
          <div className="xls-kols">
            {kols.map((k) => <KolChip key={k.username} kol={k} />)}
          </div>
        </>
      )}

      {/* The genuine project conversation. */}
      <div className="xls-group-head">
        <span className="xls-group-name">
          {handle
            ? t('xDash.liveSocial.byHandle', 'Conversation · @{{handle}}', { handle })
            : t('xDash.liveSocial.byProject', 'Conversation')}
        </span>
        {!loading && <span className="xls-count">{conversation.length}</span>}
      </div>
      {loading ? <Skeletons /> : conversation.length
        ? conversation.map((tw) => <Tweet key={tw.id} tweet={tw} />)
        : <div className="xls-msg">{emptyConversationMsg}</div>}

      {/* Ticker chatter — caveated (a same-ticker major may dominate). */}
      <div className="xls-group-head xls-group-head--ticker">
        <span className="xls-group-name">{t('xDash.liveSocial.byTicker', 'By {{label}}', { label: tickerLabel })}</span>
        {!loading && <span className="xls-count">{ticker.length}</span>}
      </div>
      <div className="xls-caveat">
        {t('xDash.liveSocial.caveat', 'Ticker matches — may include a different token sharing {{label}}.', { label: tickerLabel })}
      </div>
      {loading ? <Skeletons /> : ticker.length
        ? ticker.map((tw) => <Tweet key={tw.id} tweet={tw} />)
        : <div className="xls-msg">{t('xDash.liveSocial.noTicker', 'No recent {{label}} chatter.', { label: tickerLabel })}</div>}
    </section>
  )
}
