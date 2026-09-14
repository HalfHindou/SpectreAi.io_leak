/**
 * Vercel Serverless — Spectre Social.
 *
 * URL routing (no rewrites needed — we dispatch internally on req.url):
 *   GET    /api/social?chain=&ca=                  list posts (public)
 *   POST   /api/social                              create post (Privy + holder)
 *   POST   /api/social/:postId/like                 toggle like
 *   GET    /api/social/:postId/comments             list comments (public)
 *   POST   /api/social/:postId/comments             create comment
 *
 * Storage:
 *   social:posts:{chain}:{ca}        list of JSON posts (cap 200, newest first)
 *   social:likes:{postId}            list of wallet addresses that liked (cap 1k)
 *   social:comments:{postId}         list of JSON comments (cap 200, newest first)
 *   social:rate:{wallet}             rate-limit token bucket (3 / 5min)
 *
 * Holder gating + admin bypass are unchanged from the previous Conviction Wall.
 */

import { verifyPrivyToken } from './_lib/auth.js'
import { kvLpush, kvLrange, kvLtrim } from './_lib/kv.js'
import { holdsAtLeastOne } from './_lib/balance.js'

// Direct KV for non-list values (banner blob).
async function kvGetRaw(key) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null
  try {
    const { kv } = await import('@vercel/kv')
    return await kv.get(key)
  } catch { return null }
}
async function kvSetRaw(key, value) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return
  try {
    const { kv } = await import('@vercel/kv')
    await kv.set(key, value)
  } catch {}
}

const VALID_CHAINS = new Set(['eth', 'bsc', 'poly', 'arb', 'base', 'sol'])
const TEXT_MAX = 280
const POSTS_CAP = 200
const COMMENTS_CAP = 200
const LIKES_CAP = 1000
const RATE_WINDOW_MS = 5 * 60_000
const RATE_LIMIT = 3

// 2026-05-12 lockdown: previously this fell back to a hardcoded Gmail
// address (Gleb's personal email) when neither env var was set. That
// address was in our public source tree — anyone who could register a
// Privy account with that exact email got admin privileges (holder-gate
// bypass + PUT /api/social/banner edit perms on every (chain, ca) row).
// Source-leaked privileged identifiers are an unrotatable backdoor.
//
// Fix: no fallback. If neither env var is set, the admin set is empty
// and `isAdmin` is always false — banner edits + holder-gate bypass
// are unreachable rather than open. Set CONVICTION_ADMIN_EMAILS or
// SOCIAL_ADMIN_EMAILS on Vercel to enable admins.
const ADMIN_EMAILS = new Set(
  (process.env.CONVICTION_ADMIN_EMAILS || process.env.SOCIAL_ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
)

// Migrated 2026-05-19 from @privy-io/server-auth (deprecated) to @privy-io/node.
// The new SDK exposes the user lookup via `client.users()._get(userId)` and
// returns User with snake_case fields (linked_accounts instead of
// linkedAccounts). Constructor shape is `new PrivyClient({ appId, appSecret })`
// (object), not positional args like server-auth.
let _privyClient = null
async function getPrivy() {
  if (_privyClient) return _privyClient
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) return null
  const { PrivyClient } = await import('@privy-io/node')
  _privyClient = new PrivyClient({
    appId: process.env.PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET,
  })
  return _privyClient
}

// ─── Helpers ─────────────────────────────────────────────────────
function corsHeaders(req, res) {
  const allow = ['http://localhost:5180', 'http://localhost:5181']
  res.setHeader('Access-Control-Allow-Origin', allow.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Caller-Wallet')
}

const postsKey = (c, ca) => `social:posts:${c}:${ca.toLowerCase()}`
const likesKey = (id) => `social:likes:${id}`
const commentsKey = (id) => `social:comments:${id}`
const rateKey = (w) => `social:rate:${w.toLowerCase()}`

function sanitiseText(raw, max = TEXT_MAX) {
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim()
  if (cleaned.length < 1 || cleaned.length > max) return null
  return cleaned
}

function shortWallet(addr) {
  if (!addr) return ''
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

function avatarFor(addr) {
  // Deterministic 0–11 hue index off the wallet address — frontend maps it to a
  // gradient palette. We just emit the bucket so the server has no styling.
  if (!addr) return { kind: 'gradient', value: 0, initials: '??' }
  let hash = 0
  for (let i = 0; i < addr.length; i += 1) hash = (hash * 31 + addr.charCodeAt(i)) | 0
  const bucket = Math.abs(hash) % 12
  const initials = (addr.replace(/^0x/i, '').slice(0, 2)).toUpperCase()
  return { kind: 'gradient', value: bucket, initials }
}

function deriveDisplayName(addr) {
  // No off-chain alias yet — use wallet shortname as the display name fallback.
  return shortWallet(addr)
}

async function readJsonList(key, cap) {
  const raw = await kvLrange(key, 0, cap - 1)
  return raw
    .map(r => (typeof r === 'string' ? (() => { try { return JSON.parse(r) } catch { return null } })() : r))
    .filter(Boolean)
}

async function readWalletList(key, cap) {
  const raw = await kvLrange(key, 0, cap - 1)
  return raw
    .map(r => (typeof r === 'string' ? r : r?.toString?.() || ''))
    .filter(Boolean)
    .map(w => w.toLowerCase())
}

async function rateLimitOk(wallet) {
  const now = Date.now()
  const recent = await kvLrange(rateKey(wallet), 0, RATE_LIMIT - 1)
  const inWindow = recent
    .map(t => Number(t))
    .filter(t => Number.isFinite(t) && now - t < RATE_WINDOW_MS)
  return inWindow.length < RATE_LIMIT
}

async function recordPostTime(wallet) {
  await kvLpush(rateKey(wallet), String(Date.now()))
  await kvLtrim(rateKey(wallet), 0, RATE_LIMIT * 4 - 1)
}

async function resolvePrivyContext(req, walletAddress) {
  const userId = await verifyPrivyToken(req)
  if (!userId) return { userId: null, isAdmin: false, ownsWallet: false }
  let user = null
  try {
    const privy = await getPrivy()
    // @privy-io/node exposes the user fetch as `client.users()._get(userId)`.
    // The underscore is a SDK convention (the camelCase `.get()` method is
    // reserved for the id_token-based fetch), not a private API marker. It
    // returns the same User envelope; only the field naming changed from the
    // legacy server-auth SDK (linked_accounts vs linkedAccounts).
    if (privy) user = await privy.users()._get(userId)
  } catch (err) {
    console.warn('[social] privy lookup failed:', err?.message)
  }
  // The new SDK returns snake_case fields. There is no top-level `email`
  // property anymore - the canonical path is via the linked_accounts array.
  const email = ((user?.linked_accounts || []).find(a => a.type === 'email')?.address || '').toLowerCase()
  const isAdmin = !!email && ADMIN_EMAILS.has(email)
  const linked = (user?.linked_accounts || [])
    .filter(a => a.type === 'wallet' && typeof a.address === 'string')
    .map(a => a.address.toLowerCase())
  const ownsWallet = !!walletAddress && linked.includes(walletAddress.toLowerCase())
  return { userId, isAdmin, ownsWallet }
}

function urlPath(req) {
  // Vercel serverless gives us req.url incl. query — strip it.
  const raw = req.url || ''
  const q = raw.indexOf('?')
  return q >= 0 ? raw.slice(0, q) : raw
}

function matchPostId(path, suffix) {
  const m = path.match(new RegExp(`^/api/social/([A-Za-z0-9_]+)${suffix}$`))
  return m ? m[1] : null
}

// ─── Banner / logo (token community header) ──────────────────────
const BANNER_HOST_ALLOW = [
  'imgur.com', 'i.imgur.com',
  'pbs.twimg.com', 'abs.twimg.com',
  'assets.coingecko.com', 'coin-images.coingecko.com',
  's2.coinmarketcap.com',
  'token-media.defined.fi',
  'public.blob.vercel-storage.com',
]
const DATA_URL_MAX_BYTES = 600_000
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/

function isSafeImageUrl(url) {
  if (typeof url !== 'string' || url.length > 1_000_000) return false
  if (url.startsWith('data:')) {
    if (!DATA_URL_RE.test(url)) return false
    if (Buffer.byteLength(url, 'utf8') > DATA_URL_MAX_BYTES) return false
    return true
  }
  if (url.length > 500) return false
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return BANNER_HOST_ALLOW.some(allowed => host === allowed || host.endsWith('.' + allowed))
}
const bannerKey = (chain, ca) => `social:banner:${chain}:${ca.toLowerCase()}`

async function getBanner(req, res) {
  const chain = String(req.query.chain || '').toLowerCase()
  const ca = String(req.query.ca || '')
  if (!VALID_CHAINS.has(chain) || !ca) return res.status(400).json({ error: 'invalid chain or ca' })
  const value = await kvGetRaw(bannerKey(chain, ca))
  return res.json({ banner: value || null })
}

function sanitiseShortText(raw, max) {
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim()
  if (cleaned.length === 0) return null
  return cleaned.slice(0, max)
}

async function putBanner(req, res) {
  const body = req.body || {}
  const chain = String(body.chain || '').toLowerCase()
  const ca = String(body.ca || '')
  const walletAddress = String(body.walletAddress || '')
  const bannerUrl = body.bannerUrl ? String(body.bannerUrl) : null
  const logoUrl = body.logoUrl ? String(body.logoUrl) : null
  const nameRaw = body.name === undefined ? undefined : (body.name || '')
  const descRaw = body.description === undefined ? undefined : (body.description || '')

  if (!VALID_CHAINS.has(chain)) return res.status(400).json({ error: 'invalid chain' })
  if (!ca) return res.status(400).json({ error: 'missing ca' })
  if (bannerUrl && !isSafeImageUrl(bannerUrl)) return res.status(400).json({ error: 'invalid bannerUrl host' })
  if (logoUrl && !isSafeImageUrl(logoUrl)) return res.status(400).json({ error: 'invalid logoUrl host' })

  const ctx = await resolvePrivyContext(req, walletAddress)
  if (!ctx.userId) return res.status(401).json({ error: 'Unauthorized' })
  if (!ctx.isAdmin) return res.status(403).json({ error: 'editor permission required' })

  // Merge with existing record so partial updates work.
  const prev = (await kvGetRaw(bannerKey(chain, ca))) || {}
  const value = {
    bannerUrl: bannerUrl != null ? bannerUrl : (prev.bannerUrl || null),
    logoUrl: logoUrl != null ? logoUrl : (prev.logoUrl || null),
    name: nameRaw === undefined ? (prev.name || null) : sanitiseShortText(nameRaw, 60),
    description: descRaw === undefined ? (prev.description || null) : sanitiseShortText(descRaw, 280),
    updatedBy: walletAddress || ctx.userId,
    updatedAt: Date.now(),
  }
  await kvSetRaw(bannerKey(chain, ca), value)
  return res.json({ banner: value })
}

// ─── Posts ───────────────────────────────────────────────────────
async function listPosts(req, res) {
  const chain = String(req.query.chain || '').toLowerCase()
  const ca = String(req.query.ca || '')
  if (!VALID_CHAINS.has(chain) || !ca) return res.status(400).json({ error: 'invalid chain or ca' })

  const callerWallet = String(req.headers['x-caller-wallet'] || '').toLowerCase()
  try {
    const posts = await readJsonList(postsKey(chain, ca), POSTS_CAP)
    const view = await Promise.all(posts.map(async (p) => {
      const [likesArr, commentsLen] = await Promise.all([
        readWalletList(likesKey(p.id), LIKES_CAP),
        kvLrange(commentsKey(p.id), 0, COMMENTS_CAP - 1).then(arr => arr.length).catch(() => 0),
      ])
      return {
        id: p.id,
        wallet: shortWallet(p.wallet),
        walletFull: p.wallet,
        displayName: deriveDisplayName(p.wallet),
        avatar: avatarFor(p.wallet),
        text: p.text,
        createdAt: p.createdAt,
        likes: likesArr.length,
        likedByMe: !!callerWallet && likesArr.includes(callerWallet),
        commentCount: commentsLen,
      }
    }))
    return res.json({ posts: view })
  } catch (err) {
    console.error('[social] GET posts failed:', err?.message)
    return res.status(500).json({ error: 'read failed' })
  }
}

async function createPost(req, res) {
  const body = req.body || {}
  const chain = String(body.chain || '').toLowerCase()
  const ca = String(body.ca || '')
  const walletAddress = String(body.walletAddress || '')
  const text = sanitiseText(body.text)

  if (!VALID_CHAINS.has(chain)) return res.status(400).json({ error: 'invalid chain' })
  if (!ca) return res.status(400).json({ error: 'missing ca' })
  if (!walletAddress) return res.status(400).json({ error: 'missing walletAddress' })
  if (!text) return res.status(400).json({ error: `text required, 1-${TEXT_MAX} chars` })

  const ctx = await resolvePrivyContext(req, walletAddress)
  if (!ctx.userId) return res.status(401).json({ error: 'Unauthorized' })
  if (!ctx.isAdmin && !ctx.ownsWallet) return res.status(403).json({ error: 'wallet not linked to authed account' })

  try {
    const ok = await rateLimitOk(walletAddress)
    if (!ok) return res.status(429).json({ error: 'rate limit — wait a few minutes between posts' })
  } catch (_) {}

  if (!ctx.isAdmin) {
    let holds = false
    try { holds = await holdsAtLeastOne(walletAddress, chain, ca) } catch (_) {}
    if (!holds) return res.status(403).json({ error: 'holder check failed', reason: 'wallet does not hold this token' })
  }

  const post = {
    id: `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    chain, ca: ca.toLowerCase(),
    wallet: walletAddress,
    text,
    createdAt: Date.now(),
  }
  try {
    await kvLpush(postsKey(chain, ca), JSON.stringify(post))
    await kvLtrim(postsKey(chain, ca), 0, POSTS_CAP - 1)
    await recordPostTime(walletAddress)
  } catch (err) {
    console.error('[social] persist failed:', err?.message)
    return res.status(500).json({ error: 'persist failed' })
  }

  return res.json({
    post: {
      id: post.id,
      wallet: shortWallet(post.wallet),
      walletFull: post.wallet,
      displayName: deriveDisplayName(post.wallet),
      avatar: avatarFor(post.wallet),
      text: post.text,
      createdAt: post.createdAt,
      likes: 0,
      likedByMe: false,
      commentCount: 0,
    },
  })
}

// ─── Likes ───────────────────────────────────────────────────────
async function toggleLike(req, res, postId) {
  const body = req.body || {}
  const chain = String(body.chain || '').toLowerCase()
  const ca = String(body.ca || '')
  const walletAddress = String(body.walletAddress || '')

  if (!VALID_CHAINS.has(chain)) return res.status(400).json({ error: 'invalid chain' })
  if (!ca) return res.status(400).json({ error: 'missing ca' })
  if (!walletAddress) return res.status(400).json({ error: 'missing walletAddress' })

  const ctx = await resolvePrivyContext(req, walletAddress)
  if (!ctx.userId) return res.status(401).json({ error: 'Unauthorized' })
  if (!ctx.isAdmin && !ctx.ownsWallet) return res.status(403).json({ error: 'wallet not linked to authed account' })

  if (!ctx.isAdmin) {
    let holds = false
    try { holds = await holdsAtLeastOne(walletAddress, chain, ca) } catch (_) {}
    if (!holds) return res.status(403).json({ error: 'holder check failed' })
  }

  const w = walletAddress.toLowerCase()
  const existing = await readWalletList(likesKey(postId), LIKES_CAP)
  const liked = existing.includes(w)
  let next
  if (liked) {
    next = existing.filter(x => x !== w)
  } else {
    next = [w, ...existing].slice(0, LIKES_CAP)
  }
  // Replace list — clear and lpush in reverse so it ends up newest-first.
  // No bulk replace in our minimal kv wrapper, so reset by ltrim+lpush.
  try {
    await kvLtrim(likesKey(postId), 1, 0) // wipe (start>stop = empty)
    if (next.length > 0) {
      // lpush takes variadic, but we keep wrapper simple with one at a time.
      for (let i = next.length - 1; i >= 0; i -= 1) {
        await kvLpush(likesKey(postId), next[i])
      }
    }
  } catch (err) {
    console.error('[social] like persist failed:', err?.message)
    return res.status(500).json({ error: 'persist failed' })
  }

  return res.json({ liked: !liked, likes: next.length })
}

// ─── Comments ────────────────────────────────────────────────────
async function listComments(req, res, postId) {
  try {
    const comments = await readJsonList(commentsKey(postId), COMMENTS_CAP)
    const view = comments.map(c => ({
      id: c.id,
      wallet: shortWallet(c.wallet),
      walletFull: c.wallet,
      displayName: deriveDisplayName(c.wallet),
      avatar: avatarFor(c.wallet),
      text: c.text,
      createdAt: c.createdAt,
    }))
    return res.json({ comments: view })
  } catch (err) {
    console.error('[social] comments GET failed:', err?.message)
    return res.status(500).json({ error: 'read failed' })
  }
}

async function createComment(req, res, postId) {
  const body = req.body || {}
  const chain = String(body.chain || '').toLowerCase()
  const ca = String(body.ca || '')
  const walletAddress = String(body.walletAddress || '')
  const text = sanitiseText(body.text)

  if (!VALID_CHAINS.has(chain)) return res.status(400).json({ error: 'invalid chain' })
  if (!ca) return res.status(400).json({ error: 'missing ca' })
  if (!walletAddress) return res.status(400).json({ error: 'missing walletAddress' })
  if (!text) return res.status(400).json({ error: `text required, 1-${TEXT_MAX} chars` })

  const ctx = await resolvePrivyContext(req, walletAddress)
  if (!ctx.userId) return res.status(401).json({ error: 'Unauthorized' })
  if (!ctx.isAdmin && !ctx.ownsWallet) return res.status(403).json({ error: 'wallet not linked to authed account' })

  if (!ctx.isAdmin) {
    let holds = false
    try { holds = await holdsAtLeastOne(walletAddress, chain, ca) } catch (_) {}
    if (!holds) return res.status(403).json({ error: 'holder check failed' })
  }

  const comment = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    postId,
    wallet: walletAddress,
    text,
    createdAt: Date.now(),
  }
  try {
    await kvLpush(commentsKey(postId), JSON.stringify(comment))
    await kvLtrim(commentsKey(postId), 0, COMMENTS_CAP - 1)
  } catch (err) {
    console.error('[social] comment persist failed:', err?.message)
    return res.status(500).json({ error: 'persist failed' })
  }

  return res.json({
    comment: {
      id: comment.id,
      wallet: shortWallet(comment.wallet),
      walletFull: comment.wallet,
      displayName: deriveDisplayName(comment.wallet),
      avatar: avatarFor(comment.wallet),
      text: comment.text,
      createdAt: comment.createdAt,
    },
  })
}

// ─── Dispatcher ──────────────────────────────────────────────────
export default async function handler(req, res) {
  corsHeaders(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const path = urlPath(req)

  // /api/social/banner — community header (banner image + logo override)
  if (path === '/api/social/banner' || path === '/api/conviction/banner') {
    if (req.method === 'GET') return getBanner(req, res)
    if (req.method === 'PUT') return putBanner(req, res)
    return res.status(405).json({ error: 'method not allowed' })
  }

  // /api/social — top-level posts
  if (path === '/api/social' || path === '/api/conviction') {
    if (req.method === 'GET') return listPosts(req, res)
    if (req.method === 'POST') return createPost(req, res)
    return res.status(405).json({ error: 'method not allowed' })
  }

  // /api/social/:postId/like
  const likeId = matchPostId(path, '/like') || matchPostId(path.replace(/^\/api\/conviction\//, '/api/social/'), '/like')
  if (likeId) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
    return toggleLike(req, res, likeId)
  }

  // /api/social/:postId/comments
  const commentsId = matchPostId(path, '/comments') || matchPostId(path.replace(/^\/api\/conviction\//, '/api/social/'), '/comments')
  if (commentsId) {
    if (req.method === 'GET') return listComments(req, res, commentsId)
    if (req.method === 'POST') return createComment(req, res, commentsId)
    return res.status(405).json({ error: 'method not allowed' })
  }

  return res.status(404).json({ error: 'not found' })
}
