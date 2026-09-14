import { useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { useTokenXSocial } from '@/hooks/useTokenXSocial'
import './token-social-drawer.css'

/* Linkify $cashtags / @handles / #tags as muted highlights (the card already
   links to the source post, so no nested anchors). */
function renderText(text) {
  if (!text) return null
  const parts = String(text).split(/(\$[A-Za-z]{1,10}\b|@\w{1,20}|#\w+)/g)
  return parts.map((p, i) =>
    /^[$@#]/.test(p) ? <span key={i} className="tsoc-entity">{p}</span> : <span key={i}>{p}</span>
  )
}

const fmtCount = (n) => {
  if (!n) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

function VerifiedMark() {
  return (
    <svg className="tsoc-verified" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
    </svg>
  )
}

function TweetItem({ tweet }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const initial = (tweet.name || tweet.username || '?').trim().charAt(0).toUpperCase()
  const likes = fmtCount(tweet.likes)
  const retweets = fmtCount(tweet.retweets)
  const views = fmtCount(tweet.views)
  return (
    <a href={tweet.url || '#'} target="_blank" rel="noopener noreferrer" className="tsoc-tweet">
      <div className="tsoc-tweet-head">
        <span className="tsoc-avatar">
          {tweet.avatar && !avatarFailed ? (
            <img src={tweet.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
          ) : (
            <span className="tsoc-avatar-fallback">{initial}</span>
          )}
        </span>
        <span className="tsoc-id">
          <span className="tsoc-name">
            {tweet.name || tweet.username}
            {tweet.verified && <VerifiedMark />}
          </span>
          {tweet.username && <span className="tsoc-handle">@{tweet.username}</span>}
        </span>
      </div>
      <p className="tsoc-text">{renderText(tweet.text)}</p>
      <div className="tsoc-stats">
        {retweets && <span title="Reposts">{retweets} RP</span>}
        {likes && <span title="Likes">{likes} likes</span>}
        {views && <span title="Views">{views} views</span>}
      </div>
    </a>
  )
}

function GroupSkeleton() {
  return (
    <div className="tsoc-skeletons" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`tsoc-skel animate-shimmer stagger-${i + 1}`} />
      ))}
    </div>
  )
}

export default function TokenSocialDrawer({ token }) {
  const open = useSettingsStore((s) => s.tokenSocialOpen)
  const toggle = useSettingsStore((s) => s.toggleTokenSocial)

  const { handle, website, mentions, ticker, loading, error, symbol } = useTokenXSocial(token, { enabled: open })

  // Nothing identifiable to search → don't show the surface at all.
  if (!token || (!token.symbol && !token.address)) return null

  const total = mentions.length + ticker.length
  const tickerLabel = symbol ? `$${symbol}` : 'ticker'

  return (
    <>
      {/* Edge tab — always visible; gentle gleam invites opening when closed. */}
      <button
        type="button"
        className={`tsoc-tab${open ? ' tsoc-tab--open' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        title={open ? 'Hide social' : 'Find social for this token'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <span className="tsoc-tab-label">Social</span>
      </button>

      <aside className={`tsoc-panel${open ? ' tsoc-panel--open' : ''}`} aria-hidden={!open}>
        <header className="tsoc-panel-head">
          <div className="tsoc-panel-title">
            <span className="tsoc-panel-kicker">Social Scan</span>
            <span className="tsoc-panel-sym">{tickerLabel}</span>
          </div>
          <button type="button" className="tsoc-close" onClick={toggle} aria-label="Close social scan">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <p className="tsoc-blurb">
          Live tweets for this token — searched directly from X, not limited to the X&nbsp;Dash tracked set.
          {handle && (
            <>
              {' '}Account:{' '}
              <a className="tsoc-handle-link" href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">@{handle}</a>
              {website && (
                <>
                  {' · '}
                  <a className="tsoc-handle-link" href={website} target="_blank" rel="noopener noreferrer">site</a>
                </>
              )}
            </>
          )}
        </p>

        <div className="tsoc-scroll">
          {error && <div className="tsoc-msg tsoc-msg--err">{error}</div>}

          {/* Group 1 — the real conversation, by the project's X handle */}
          <section className="tsoc-group">
            <div className="tsoc-group-head">
              <span className="tsoc-group-name">{handle ? `Conversation · @${handle}` : 'Conversation'}</span>
              {!loading && <span className="tsoc-group-count">{mentions.length}</span>}
            </div>
            {loading ? (
              <GroupSkeleton />
            ) : mentions.length ? (
              mentions.map((tw) => <TweetItem key={tw.id} tweet={tw} />)
            ) : (
              <div className="tsoc-msg">No project account found to pull the conversation from.</div>
            )}
          </section>

          {/* Group 2 — possibly related, by ticker (a same-ticker major may dominate) */}
          <section className="tsoc-group">
            <div className="tsoc-group-head">
              <span className="tsoc-group-name">Possibly related — by {tickerLabel}</span>
              {!loading && <span className="tsoc-group-count">{ticker.length}</span>}
            </div>
            <div className="tsoc-caveat">
              Ticker matches — may include a different token sharing {tickerLabel}. Judge relevance yourself.
            </div>
            {loading ? (
              <GroupSkeleton />
            ) : ticker.length ? (
              ticker.map((tw) => <TweetItem key={tw.id} tweet={tw} />)
            ) : (
              <div className="tsoc-msg">No recent {tickerLabel} chatter found.</div>
            )}
          </section>

          {!loading && !error && total === 0 && (
            <div className="tsoc-empty">
              Nothing on X right now for this token. Low-cap on-chain tokens often have little or no social footprint.
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
