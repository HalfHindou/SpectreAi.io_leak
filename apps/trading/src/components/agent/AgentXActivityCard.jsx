/**
 * AgentXActivityCard - the agent's X-activity presentation. When get_x_intel
 * runs, the server ships a _visual payload: the voices it found (official /
 * team / community) with pfps, follower counts and a post-timestamp
 * timeline. On the voice stage each account MATERIALIZES as the agent names
 * it ("you can see CrossChainChad here...") - pfp scales in, the follower
 * count counts up. In the chat thread it renders complete.
 *
 * reveal (presenting mode): { 'acct-<handle>': 0..1, timeline: 0..1 } from
 * the cue engine; omitted = static complete.
 */
import { Heart, Eye } from 'lucide-react'
import { fmtCount } from './presentationCues'
import './AgentXActivityCard.css'

const ROLE_LABELS = { official: 'OFFICIAL', team: 'TEAM', community: 'COMMUNITY' }

function fmtAgo(iso) {
  const t = new Date(iso || 0).getTime()
  if (!Number.isFinite(t) || t <= 0) return null
  const h = Math.floor((Date.now() - t) / 3600_000)
  if (h < 1) return 'now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function VerifiedBadge({ gold = false }) {
  return (
    <svg className={`saxact__badge${gold ? ' saxact__badge--gold' : ''}`} viewBox="0 0 22 22" aria-label={gold ? 'Verified organization' : 'Verified'} fill="currentColor">
      <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
    </svg>
  )
}

const easeOut = (r) => 1 - (1 - r) * (1 - r)

/** A post - tweet-style card (pfp, handle, badge, text, photo, stats).
    On the voice stage it is its own SLIDE: the overview yields to the
    actual post while the agent talks about it. In the chat thread the
    recent posts render statically under the account rows.
    Accepts a normalized `post` ({handle, pfp, badge, text, image, ...})
    or a legacy `account` carrying `.top` (persisted old sessions). */
export function AgentXPostCard({ post, account }) {
  const p = post || (account?.top ? { handle: account.handle, pfp: account.pfp, badge: account.badge, verified: account.verified, ...account.top } : null)
  if (!p?.text || !p.handle) return null
  return (
    <div className="saxact__postcard">
      {/* Ambient glow: the post's own photo, blurred behind the card. */}
      {p.image && (
        <img className="saxact__postglow" src={p.image} alt="" aria-hidden="true" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      )}
      <div className="saxact__postbody">
        <div className="saxact__posthead">
          {p.pfp ? (
            <img className="saxact__postpfp" src={p.pfp} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
          ) : (
            <span className="saxact__postpfp saxact__postpfp--fallback">{p.handle[0].toUpperCase()}</span>
          )}
          <span className="saxact__posthandle">@{p.handle}{(p.badge || p.verified) && <VerifiedBadge gold={p.badge === 'gold'} />}</span>
          {fmtAgo(p.at) && <span className="saxact__posttime">{fmtAgo(p.at)}</span>}
        </div>
        <div className="saxact__posttext">{p.text}</div>
        {p.image && (
          <img className="saxact__postimg" src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        )}
        {(p.likes || p.views) && (
          <div className="saxact__postfoot">
            {p.likes ? <span className="saxact__stat"><Heart size={11} aria-hidden="true" />{fmtCount(p.likes)}</span> : null}
            {p.views ? <span className="saxact__stat"><Eye size={11} aria-hidden="true" />{fmtCount(p.views)}</span> : null}
          </div>
        )}
      </div>
    </div>
  )
}

/** Featured accounts = the ones carrying a top post, official voice first. */
export function featuredAccounts(visual, cap = 3) {
  return (visual?.accounts || [])
    .filter((a) => a.top?.text)
    .sort((a, b) => (a.role === 'official' ? 0 : 1) - (b.role === 'official' ? 0 : 1) || (b.top.likes || 0) - (a.top.likes || 0))
    .slice(0, cap)
}

export default function AgentXActivityCard({ visual, symbol, reveal }) {
  if (!visual || visual.kind !== 'x_activity' || !visual.accounts?.length) return null

  const presenting = !!reveal
  const rv = (key) => {
    if (!presenting) return 1
    const v = reveal[key]
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
  }
  const name = visual.symbol || symbol
  const timeline = Array.isArray(visual.timeline) ? visual.timeline : []
  const maxN = timeline.reduce((m, b) => Math.max(m, b.n), 0)
  const tlR = rv('timeline')

  return (
    <div className="saxact" role="img" aria-label={`X activity for ${name || 'token'}: ${visual.accounts.length} accounts`}>
      <div className="saxact__head">
        <span className="saxact__title">X ACTIVITY{name ? ` - $${String(name).replace(/^\$/, '')}` : ''}</span>
        {/* Who's here, at a glance - overlapping avatars, official first. */}
        <span className="saxact__stack" aria-hidden="true">
          {visual.accounts.filter((a) => a.pfp).slice(0, 4).map((a) => (
            <img key={a.handle} className="saxact__stackpfp" src={a.pfp} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          ))}
        </span>
        {Number.isFinite(visual.mentions24h) && (
          <span className="saxact__mentions">{fmtCount(visual.mentions24h)} mentions · 24h</span>
        )}
      </div>

      {timeline.length > 1 && maxN > 0 && tlR > 0 && (
        <div className="saxact__timeline" style={presenting ? { opacity: Math.min(1, tlR * 2) } : undefined} aria-hidden="true">
          {timeline.map((b, i) => (
            <span
              key={b.t}
              className="saxact__bar"
              style={{
                height: `${8 + (b.n / maxN) * 92}%`,
                transform: presenting ? `scaleY(${easeOut(Math.min(1, Math.max(0, tlR * 1.6 - (i / timeline.length) * 0.6)))})` : undefined,
              }}
            />
          ))}
        </div>
      )}

      <div className="saxact__rows">
        {visual.accounts.map((a, idx) => {
          // Per-row stagger floor: simultaneous cues must cascade, not pop
          // as one block.
          const r = presenting ? Math.min(1, Math.max(0, rv(`acct-${a.handle.toLowerCase()}`) * 1.15 - idx * 0.04)) : 1
          if (presenting && r <= 0.02) return null
          const meta = [a.posts ? `${a.posts} post${a.posts === 1 ? '' : 's'}` : null, fmtAgo(a.lastAt)].filter(Boolean).join(' · ')
          const shownFollowers = Number.isFinite(a.followers)
            ? Math.round(a.followers * (presenting ? easeOut(r) : 1))
            : null
          return (
            <div
              key={a.handle}
              className="saxact__row"
              style={presenting ? { opacity: Math.min(1, r * 1.8), transform: `translateY(${(1 - easeOut(r)) * 10}px)` } : undefined}
            >
              {a.pfp ? (
                <img
                  className="saxact__pfp"
                  src={a.pfp}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                />
              ) : (
                <span className="saxact__pfp saxact__pfp--fallback">{a.handle[0].toUpperCase()}</span>
              )}
              <div className="saxact__id">
                <span className="saxact__handle">
                  @{a.handle}
                  {(a.badge || a.verified) && <VerifiedBadge gold={a.badge === 'gold'} />}
                  <span className={`saxact__role saxact__role--${a.role}`}>{ROLE_LABELS[a.role] || ''}</span>
                </span>
                {meta && <span className="saxact__meta">{meta}</span>}
              </div>
              {shownFollowers != null && (
                <div className="saxact__followers">
                  <span className="saxact__fnum">{fmtCount(shownFollowers)}</span>
                  <span className="saxact__flabel">FOLLOWERS</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Chat thread: the recent posts render right under the rows. On
          the voice stage they are separate slides (AgentPresentation).
          Old persisted visuals fall back to the per-account featured set. */}
      {!presenting && (visual.posts?.length
        ? visual.posts.slice(0, 3).map((p, i) => <AgentXPostCard key={`post-${p.handle}-${i}`} post={p} />)
        : featuredAccounts(visual, 2).map((a) => <AgentXPostCard key={`post-${a.handle}`} account={a} />))}
    </div>
  )
}
