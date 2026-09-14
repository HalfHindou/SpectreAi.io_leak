/**
 * MediaChatter — "On X right now" rail.
 * Sourced from the modern X Dash social-intelligence backend (the same engine
 * behind /x-dash): take the loudest tokens, pull their loudest real mentions,
 * merge + rank by weighted engagement. Falls back to a sample in dev (xdash is
 * gated + prod-only).
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { isDev } from '@/utils/env'
import { normalizeXDashDetail, getMentionText, getMentionUrl } from '@/pages/x-dash/components/x-dash-utils'
import ContentRail from './content-rail'
import { relTime } from './media-format'

const TIMEOUT = 15000
const TOP_TOKENS = 6
const MAX_POSTS = 16

function toPost(m, symbol) {
  const text = (getMentionText(m) || '').trim()
  if (!text) return null
  const handle = String(m?.author?.screen_name || '').replace(/^@/, '')
  return {
    id: String(m?.tweet?.tweet_id || `${handle}-${text.slice(0, 24)}`),
    handle: handle ? `@${handle}` : '',
    name: m?.author?.name || handle || 'Unknown',
    avatar: m?.author?.avatar_image_url || m?.author?.profile_image_url || '',
    verified: !!(m?.author?.is_verified || m?.author?.verified),
    text,
    url: getMentionUrl(m),
    time: m?.tweet?.created_at_utc || '',
    weight: Number(m?.derived?.weighted_engagement || 0),
    symbol: symbol ? String(symbol).toUpperCase() : '',
  }
}

async function fetchChatter() {
  // 1) loudest tokens from the X Dash board
  const bRes = await fetch('/api/xdash/bootstrap?per_page=14&page=1', { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT) })
  if (!bRes.ok) return []
  const board = await bRes.json()
  const rows = Array.isArray(board?.tokens) ? board.tokens : []
  const tokens = rows
    .map(r => ({
      cgId: r?.token?.cg_id || r?.token?.token_id || r?.cg_id || r?.token_id,
      symbol: r?.token?.symbol || r?.symbol,
      mentions: Number(r?.metrics?.external_mentions || r?.mentions || 0),
    }))
    .filter(t => t.cgId)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, TOP_TOKENS)

  // 2) pull each token's loudest mentions, tag with the token
  const batches = await Promise.allSettled(tokens.map(async (tk) => {
    const r = await fetch(`/api/xdash/token/${encodeURIComponent(tk.cgId)}`, { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT) })
    if (!r.ok) return []
    const raw = await r.json()
    const { mergedMentions } = normalizeXDashDetail(raw)
    return (mergedMentions || []).map(m => toPost(m, tk.symbol)).filter(Boolean)
  }))

  const seen = new Set()
  const posts = []
  for (const b of batches) {
    if (b.status !== 'fulfilled') continue
    for (const p of b.value) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      posts.push(p)
    }
  }
  posts.sort((a, b) => b.weight - a.weight)
  return posts.slice(0, MAX_POSTS)
}

const NOW = Date.now()
const SAMPLE_POSTS = [
  { id: 's1', handle: '@CryptoHayes', name: 'Arthur Hayes', avatar: '', verified: true, text: 'The liquidity is coming. Every macro signal points the same way - debase, debase, debase. Position accordingly.', url: 'https://x.com', time: new Date(NOW - 36e5).toISOString(), symbol: 'BTC' },
  { id: 's2', handle: '@RyanSAdams', name: 'Ryan Sean Adams', avatar: '', verified: true, text: 'ETH is the most undervalued asset in crypto right now and it is not close. The market will figure this out.', url: 'https://x.com', time: new Date(NOW - 72e5).toISOString(), symbol: 'ETH' },
  { id: 's3', handle: '@imkyledoops', name: 'Crypto Banter', avatar: '', verified: true, text: 'FOMC in 4 hours. Here are the 5 levels I am watching on BTC and the exact trades I am taking. Do not get rinsed.', url: 'https://x.com', time: new Date(NOW - 50e5).toISOString(), symbol: 'BTC' },
  { id: 's4', handle: '@WClementeIII', name: 'Will Clemente', avatar: '', verified: true, text: 'On-chain data is screaming accumulation. Long-term holders have not moved a single coin in 6 months.', url: 'https://x.com', time: new Date(NOW - 90e5).toISOString(), symbol: 'BTC' },
  { id: 's5', handle: '@TheCryptoLark', name: 'Lark Davis', avatar: '', verified: true, text: 'Solana is more oversold than it was during the FTX collapse. History does not repeat but it sure does rhyme.', url: 'https://x.com', time: new Date(NOW - 120e5).toISOString(), symbol: 'SOL' },
  { id: 's6', handle: '@MoonOverlord', name: 'Light', avatar: '', verified: false, text: 'Stablecoins did $73B in volume yesterday. This is the real onchain economy and almost nobody is talking about it.', url: 'https://x.com', time: new Date(NOW - 160e5).toISOString(), symbol: 'USDC' },
  { id: 's7', handle: '@scottmelker', name: 'The Wolf Of All Streets', avatar: '', verified: true, text: 'Boring price action is the best price action. Accumulate, touch grass, come back when the candles get interesting.', url: 'https://x.com', time: new Date(NOW - 200e5).toISOString(), symbol: 'BTC' },
  { id: 's8', handle: '@AltcoinGordon', name: 'Gordon', avatar: '', verified: true, text: 'The altcoin window is opening. Rotation out of majors into quality L1s is exactly how every cycle has played out.', url: 'https://x.com', time: new Date(NOW - 260e5).toISOString(), symbol: 'SOL' },
]

const VerifiedIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="mcx-tw-verified">
    <path fill="currentColor" d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
  </svg>
)

const XLogo = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
)

const PostCard = ({ p }) => {
  const { t } = useTranslation()
  const open = () => { if (p.url) window.open(p.url, '_blank', 'noopener') }
  return (
    <article className="mcx-tw" role="button" tabIndex={0} onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') open() }}>
      <div className="mcx-tw-head">
        <span className="mcx-tw-av">
          {p.avatar ? <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{(p.name || '?').charAt(0)}</span>}
        </span>
        <span className="mcx-tw-id">
          <span className="mcx-tw-name">{p.name}{p.verified && <VerifiedIcon />}</span>
          <span className="mcx-tw-handle">{p.handle}</span>
        </span>
        <span className="mcx-tw-logo"><XLogo /></span>
      </div>
      <p className="mcx-tw-text">{p.text}</p>
      <div className="mcx-tw-foot">
        {p.symbol && <span className="mcx-tw-sym">${p.symbol}</span>}
        {p.time && <span className="mcx-tw-time">{relTime(p.time, t)}</span>}
      </div>
    </article>
  )
}

const MediaChatter = () => {
  const { t } = useTranslation()
  const [posts, setPosts] = useState([])
  // IO-gate: the fetch is ~7 requests / ~1.7MB (bootstrap + 6x uncached /token),
  // and this rail is mid/below-fold on the default Discover tab. Defer it until
  // the rail scrolls near, instead of paying it on every media-center visit.
  const [inView, setInView] = useState(false)
  const sentinelRef = useRef(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver !== 'function') { setInView(true); return }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!inView) return
    // X Dash is gated + prod-only; in local dev it never resolves, so serve the
    // sample directly (keeps the rail alive + verifiable).
    if (isDev) { setPosts(SAMPLE_POSTS); return }
    let cancelled = false
    fetchChatter()
      .then(p => { if (!cancelled) setPosts(p) })
      .catch(() => { /* leave empty in prod if X Dash is unavailable */ })
    return () => { cancelled = true }
  }, [inView])

  // Sentinel keeps an element in the DOM to observe before posts load (and when
  // the rail stays empty). Once posts arrive the rail replaces it.
  if (!posts.length) return <div ref={sentinelRef} aria-hidden="true" />

  return (
    <ContentRail title={t('mediaCenter.chatter.title')}>
      {posts.map(p => <PostCard key={p.id} p={p} />)}
    </ContentRail>
  )
}

export default MediaChatter
