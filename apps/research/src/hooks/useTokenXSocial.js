import { useEffect, useRef, useState } from 'react'

/**
 * useTokenXSocial — live X (Twitter) conversation for ANY token, keyed off the
 * token's REAL identity, not the X Dash tracked universe. Built for on-chain
 * tokens X Dash doesn't track (e.g. a Base micro-cap), where the per-token
 * endpoint returns empty.
 *
 * The hard-won lesson (Base $DOT): the dependable social key is the project's
 * OFFICIAL X HANDLE, resolved from DexScreener's token socials — NOT:
 *   - the cashtag ($DOT → returns Polkadot, a same-ticker major), and NOT
 *   - the raw contract address (the tweet backend tokenizes it and returns noise).
 * So we resolve the handle from the contract, then search the handle to get the
 * genuine conversation, and keep the $ticker search as a clearly-caveated extra.
 *
 * Returns two groups:
 *   - mentions : tweets about the project (searched by @handle / handle) — the
 *                real signal. Empty if no handle resolves and the name is generic.
 *   - ticker   : $symbol cashtag chatter — may be a different same-ticker token.
 *
 * Fetches only when `enabled` (the consuming surface is visible/open).
 */

const FETCH_TIMEOUT = 15000
const PER_GROUP = 18

const DEX_TOKENS_URL = 'https://api.dexscreener.com/latest/dex/tokens/'

function _num(v) {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

// x.com/usedotai , https://twitter.com/usedotai/ , @usedotai → "usedotai"
function handleFromUrl(url) {
  if (!url) return null
  const m = String(url).match(/(?:twitter\.com|x\.com)\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i)
  if (m) return m[1]
  const at = String(url).match(/^@?([A-Za-z0-9_]{1,15})$/)
  return at ? at[1] : null
}

/** Resolve the token's official X handle + website from DexScreener (keyless).
    Scans ALL pairs, not just the deepest-liquidity one: DexScreener attaches
    info.socials to some pairs and not others, so checking a single pair can
    miss a handle that's plainly there on another pair (the bug that made the
    "conversation" group come up empty for $DOT even though @usedotai exists). */
async function resolveTokenSocials(address, signal) {
  try {
    const r = await fetch(`${DEX_TOKENS_URL}${address}`, { signal })
    if (!r.ok) return null
    const data = await r.json()
    const pairs = Array.isArray(data?.pairs) ? data.pairs : []
    const lower = address.toLowerCase()
    const mine = pairs
      .filter((p) => String(p?.baseToken?.address || '').toLowerCase() === lower)
      .sort((a, b) => ((b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0)))
    const ordered = [...mine, ...pairs]
    let handle = null
    let website = null
    let name = null
    let symbol = null
    for (const p of ordered) {
      if (!p) continue
      if (!name) { name = p?.baseToken?.name || null; symbol = p?.baseToken?.symbol || null }
      const info = p.info || {}
      const socials = Array.isArray(info.socials) ? info.socials : []
      if (!handle) {
        const tw = socials.find((s) => /twitter|^x$/i.test(s?.type || '')) ||
          socials.find((s) => /(twitter\.com|x\.com)/i.test(s?.url || ''))
        if (tw) handle = handleFromUrl(tw.url)
      }
      if (!website && Array.isArray(info.websites) && info.websites[0]) website = info.websites[0].url
      if (handle && website) break
    }
    return { handle, website, name, symbol }
  } catch {
    return null
  }
}

function normalizeTweet(t, i) {
  if (!t) return null
  const id = t.tweet_id || t.id || `s-${i}`
  const username = (t.username || t.screen_name || t.author_handle || '').replace(/^@/, '')
  const text = t.tweet_text || t.full_text || t.text || ''
  if (/^RT\s+@/i.test(text)) return null
  const url =
    t.tweet_url || t.x_url || (id && username ? `https://x.com/${username}/status/${id}` : null)
  if (!text && !url) return null
  return {
    id: String(id),
    text,
    url,
    username,
    name: t.name || t.author || username,
    avatar: t.ProfilePic || t.profile_image || t.avatar_image_url || t.author_avatar || null,
    date: t.date || t.created_at || '',
    followers: _num(t.followers ?? t.followers_count ?? t.user_followers ?? t.author_followers),
    likes: _num(t.like_count ?? t.likes),
    retweets: _num(t.retweet_count ?? t.retweets),
    replies: _num(t.reply_count ?? t.comments),
    views: _num(t.views),
    verified: !!(t.verified || t.is_blue_verified || t.author_verified),
    promoted: !!t.is_promoted,
    engagement: _num(t.like_count ?? t.likes) + _num(t.retweet_count ?? t.retweets) * 2,
  }
}

async function searchTweets(query, signal) {
  const q = String(query || '').trim()
  if (!q) return []
  const enc = encodeURIComponent(q)
  const urls = import.meta.env.DEV
    ? [`/api/tweets/search?query=${enc}`, `/tweets-api/api/tweets/search?query=${enc}`]
    : [`/api/tweets/search?query=${enc}`]
  for (const url of urls) {
    const res = await fetch(url, { signal }).catch(() => null)
    if (!res?.ok) continue
    const data = await res.json().catch(() => null)
    const rows = Array.isArray(data) ? data : data?.tweets || data?.data || data?.results || []
    if (Array.isArray(rows) && rows.length) {
      const out = rows.map(normalizeTweet).filter(Boolean).filter((t) => !t.promoted)
      if (out.length) return out
    }
  }
  return []
}

// ── Fallback: our own social mentions (Spectre data-api) ────────────────────
// 🪤 The tweet search above is the ONLY source this hook had, and it goes to a
// Cloud Run service that on 2026-07-29 returned 500 on every path including
// /health — so every tweet surface in the app (cinema Live Tweets, the token
// social drawer) went blank at once, and it read as "no posts for $ETH" rather
// than "our backend is down".
//
// We already collect this data ourselves: /v1/social/mentions/{ASSET} carries
// 24h mentions with the top-engaged posts attached. It is keyed by ASSET, so it
// only answers for tracked symbols (majors and the tracked universe) — which is
// exactly the case the handle-resolution path above cannot serve anyway, since
// majors have no contract to resolve socials from.
async function fetchSpectreMentions(symbol, signal) {
  const sym = String(symbol || '').replace(/^\$/, '').trim().toUpperCase()
  if (!sym || sym.length > 12) return { posts: [], mentions24h: null }
  const res = await fetch(`/data-api/v1/social/mentions/${encodeURIComponent(sym)}?limit=20`, { signal }).catch(() => null)
  if (!res?.ok) return { posts: [], mentions24h: null }
  const json = await res.json().catch(() => null)
  const d = json?.data
  if (!d || Array.isArray(d)) return { posts: [], mentions24h: null }
  const rows = Array.isArray(d.top_engaged) ? d.top_engaged : []
  const posts = rows.map((t, i) => {
    const text = String(t?.text || '')
    if (!text) return null
    // this feed carries no author handle/avatar — render what is real and let
    // the card fall back to its letter chip rather than inventing an identity
    const likes = _num(t.likes)
    const reposts = _num(t.reposts)
    return {
      id: String(t.id || `sp-${i}`),
      text,
      url: t.url || null,
      username: '',
      name: '',
      avatar: null,
      date: t.posted_at || '',
      followers: 0,
      likes,
      retweets: reposts,
      replies: _num(t.replies),
      views: _num(t.views),
      verified: false,
      promoted: false,
      engagement: likes + reposts * 2,
    }
  }).filter(Boolean)
  return { posts, mentions24h: _num(d?.totals?.mentions) || null }
}

const byEngagement = (a, b) => b.engagement - a.engagement

const EMPTY = {
  handle: null, website: null, resolved: false, conversation: [], mentions: [], ticker: [],
  kols: [], stats: { authors: 0, engagement: 0, posts: 0 },
  mentions24h: null, source: null, loading: false, error: null,
}

export function useTokenXSocial(token, { enabled = false } = {}) {
  const [state, setState] = useState(EMPTY)
  const abortRef = useRef(null)

  const symbol = String(token?.symbol || '').replace(/^\$/, '').trim()
  const address = String(token?.address || token?.contract_address || '').trim()
  const name = String(token?.name || '').trim()
  const key = `${enabled ? '1' : '0'}|${address.toLowerCase()}|${symbol.toLowerCase()}`

  useEffect(() => {
    if (!enabled) return
    if (!symbol && !address) {
      setState(EMPTY)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = AbortSignal.any
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(FETCH_TIMEOUT)])
      : controller.signal

    setState((s) => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const socials = address ? await resolveTokenSocials(address, signal) : null
        if (controller.signal.aborted) return
        // `resolved` distinguishes "DexScreener answered (with/without a handle)"
        // from "we never got an answer" - so the UI can say WHY it's empty.
        const resolved = !!socials
        const handle = socials?.handle || null
        const website = socials?.website || null

        // The real conversation: by handle when we have one, else by a distinctive
        // project name (avoid 1-2 char generic names that match everything).
        const mentionQuery = handle
          ? handle
          : (name && name.length >= 4 && !/^dot$/i.test(name) ? name : null)

        const [mentionsRaw, tickerRaw] = await Promise.all([
          mentionQuery ? searchTweets(mentionQuery, signal) : Promise.resolve([]),
          symbol ? searchTweets(`$${symbol}`, signal) : Promise.resolve([]),
        ])
        if (controller.signal.aborted) return

        // Only reach for our own feed when the upstream search produced nothing
        // at all — it is a different shape (no author identity) so it should
        // never displace a real search result, only replace an empty screen.
        let spectreMentions24h = null
        if (!mentionsRaw.length && !tickerRaw.length && symbol) {
          const fb = await fetchSpectreMentions(symbol, signal)
          if (controller.signal.aborted) return
          spectreMentions24h = fb.mentions24h
          if (fb.posts.length) tickerRaw.push(...fb.posts)
        }

        // Tag handle-search results, then dedupe the whole pool (handle hits win
        // their slot first since they're the most relevant).
        mentionsRaw.forEach((t) => { t._fromHandle = true })
        const seen = new Set()
        const pool = []
        for (const tw of [...mentionsRaw, ...tickerRaw].sort(byEngagement)) {
          const k = tw.url || tw.id
          if (seen.has(k)) continue
          seen.add(k)
          pool.push(tw)
        }

        // The genuine project conversation = tweets from the handle search, OR
        // (from the ticker search) any that @-mention or are authored by the
        // project handle. Everything else is generic $ticker chatter (the major).
        const handleLower = handle ? handle.toLowerCase() : null
        const handleRe = handleLower ? new RegExp(`@${handleLower}\\b`, 'i') : null
        const isProject = (t) => handleLower
          ? (t._fromHandle || t.username.toLowerCase() === handleLower || (handleRe && handleRe.test(t.text)))
          : !!t._fromHandle
        const conversation = pool.filter(isProject).slice(0, PER_GROUP)
        const ticker = pool.filter((t) => !isProject(t)).slice(0, PER_GROUP)

        // KOLs / top voices — authors of the project conversation ranked by
        // follower reach (then post count). This is the "who's talking" layer.
        const authors = new Map()
        for (const t of conversation) {
          const u = t.username
          if (!u) continue
          const e = authors.get(u) || { username: u, avatar: t.avatar, followers: 0, posts: 0, verified: t.verified }
          e.posts += 1
          e.followers = Math.max(e.followers, t.followers || 0)
          if (!e.avatar && t.avatar) e.avatar = t.avatar
          if (t.verified) e.verified = true
          authors.set(u, e)
        }
        const kols = [...authors.values()]
          .sort((a, b) => (b.followers - a.followers) || (b.posts - a.posts))
          .slice(0, 8)
        const stats = {
          authors: authors.size,
          engagement: conversation.reduce((s, t) => s + t.likes + t.retweets, 0),
          posts: conversation.length,
        }

        // `mentions` is what the panels render. Normally that is the genuine
        // project conversation only — generic $ticker chatter must never be
        // presented as the project's own (the $DOT/Polkadot lesson). The one
        // exception is the Spectre-mentions fallback: those posts ARE keyed to
        // the asset by our own collector, so they are project mentions even
        // though they arrive through the ticker slot.
        const usedSpectreFallback = spectreMentions24h != null
        const mentions = conversation.length ? conversation : (usedSpectreFallback ? ticker : conversation)

        setState({
          handle, website, resolved, conversation, mentions, ticker, kols, stats,
          mentions24h: spectreMentions24h,
          source: usedSpectreFallback && !conversation.length ? 'spectre' : 'x-search',
          loading: false, error: null,
        })
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setState({ ...EMPTY, error: 'Could not load X activity' })
      }
    })()

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { ...state, symbol }
}
