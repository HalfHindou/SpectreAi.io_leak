// Express dev mirror of apps/trading/api/social.js — same routes, CJS.
// Holder-gated per-token social feed (Spectre Social). Likes + comments.

const express = require('express')
const path = require('path')
const fs = require('fs')
const { ethers } = require('ethers')
const { Connection, PublicKey } = require('@solana/web3.js')
const { verifyPrivyToken, getPrivyClient } = require('../lib/auth')

const router = express.Router()
// Banners arrive as base64 data URLs up to ~600KB; the default 100KB body
// cap rejects those, so bump it on this router.
router.use(express.json({ limit: '2mb' }))

// ─── KV with file fallback ───────────────────────────────────────
let kvStore = null
let kvChecked = false
async function getKv() {
  if (kvChecked) return kvStore
  kvChecked = true
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null
  try {
    const { kv } = await import('@vercel/kv')
    kvStore = kv
    return kvStore
  } catch (err) {
    console.warn('[social] @vercel/kv load failed, using file fallback:', err.message)
    return null
  }
}

const DATA_DIR = path.resolve(__dirname, '..', 'data', 'social')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

function fileFor(key) {
  const safe = key.replace(/[^a-z0-9_]+/gi, '_').toLowerCase()
  return path.join(DATA_DIR, `${safe}.json`)
}

async function listGet(key) {
  const kv = await getKv()
  if (kv) return await kv.lrange(key, 0, -1)
  const f = fileFor(key)
  if (!fs.existsSync(f)) return []
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return [] }
}

async function listLpush(key, value) {
  const kv = await getKv()
  if (kv) return await kv.lpush(key, value)
  const f = fileFor(key)
  let arr = []
  try { arr = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [] } catch { arr = [] }
  arr.unshift(value)
  fs.writeFileSync(f, JSON.stringify(arr))
}

async function listLtrim(key, start, stop) {
  const kv = await getKv()
  if (kv) return await kv.ltrim(key, start, stop)
  const f = fileFor(key)
  if (!fs.existsSync(f)) return
  let arr = []
  try { arr = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { arr = [] }
  if (start > stop) arr = []
  else arr = arr.slice(start, stop + 1)
  fs.writeFileSync(f, JSON.stringify(arr))
}

// ─── Constants ───────────────────────────────────────────────────
const VALID_CHAINS = new Set(['eth', 'bsc', 'poly', 'arb', 'base', 'sol'])
const TEXT_MAX = 280
const POSTS_CAP = 200
const COMMENTS_CAP = 200
const LIKES_CAP = 1000
const RATE_WINDOW_MS = 5 * 60_000
const RATE_LIMIT = 3

const ADMIN_EMAILS = new Set(
  (process.env.CONVICTION_ADMIN_EMAILS || process.env.SOCIAL_ADMIN_EMAILS || 'workashard02@gmail.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
)

const EVM_RPC = {
  eth:  process.env.ETH_RPC_URL  || 'https://ethereum-rpc.publicnode.com',
  bsc:  process.env.BSC_RPC_URL  || 'https://bsc-dataseed.binance.org',
  poly: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
  arb:  process.env.ARB_RPC_URL  || 'https://arb1.arbitrum.io/rpc',
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
}
const SOL_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

const _evmProviders = new Map()
function getEvmProvider(chain) {
  if (!_evmProviders.has(chain)) _evmProviders.set(chain, new ethers.JsonRpcProvider(EVM_RPC[chain]))
  return _evmProviders.get(chain)
}
let _solConn = null
function getSolConn() {
  if (!_solConn) _solConn = new Connection(SOL_RPC, 'confirmed')
  return _solConn
}

async function holdsAtLeastOne(walletAddress, chain, ca) {
  if (!walletAddress || !chain || !ca) return false
  if (chain === 'sol') {
    try {
      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token')
      const conn = getSolConn()
      const wallet = new PublicKey(walletAddress)
      const mint = new PublicKey(ca)
      const ata = getAssociatedTokenAddressSync(mint, wallet)
      const info = await conn.getTokenAccountBalance(ata)
      return parseFloat(info?.value?.uiAmountString || '0') > 0
    } catch (err) {
      if (!err?.message?.includes('could not find')) console.warn('[social/balance sol]', err?.message)
      return false
    }
  }
  if (!EVM_RPC[chain]) return false
  try {
    const provider = getEvmProvider(chain)
    const c = new ethers.Contract(ca, ERC20_ABI, provider)
    const raw = await c.balanceOf(walletAddress)
    return raw > 0n
  } catch (err) {
    console.warn(`[social/balance ${chain}]`, err?.message)
    return false
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
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
  if (!addr) return { kind: 'gradient', value: 0, initials: '??' }
  let hash = 0
  for (let i = 0; i < addr.length; i += 1) hash = (hash * 31 + addr.charCodeAt(i)) | 0
  const bucket = Math.abs(hash) % 12
  const initials = (addr.replace(/^0x/i, '').slice(0, 2)).toUpperCase()
  return { kind: 'gradient', value: bucket, initials }
}

function deriveDisplayName(addr) { return shortWallet(addr) }

async function readJsonList(key, cap) {
  const raw = await listGet(key)
  return raw
    .map(r => (typeof r === 'string' ? (() => { try { return JSON.parse(r) } catch { return null } })() : r))
    .filter(Boolean)
    .slice(0, cap)
}

async function readWalletList(key, cap) {
  const raw = await listGet(key)
  return raw
    .map(r => (typeof r === 'string' ? r : r?.toString?.() || ''))
    .filter(Boolean)
    .map(w => w.toLowerCase())
    .slice(0, cap)
}

async function rateLimitOk(wallet) {
  const now = Date.now()
  const recent = await listGet(rateKey(wallet))
  const inWindow = recent
    .map(t => Number(t))
    .filter(t => Number.isFinite(t) && now - t < RATE_WINDOW_MS)
  return inWindow.length < RATE_LIMIT
}

async function recordPostTime(wallet) {
  await listLpush(rateKey(wallet), String(Date.now()))
  await listLtrim(rateKey(wallet), 0, RATE_LIMIT * 4 - 1)
}

async function resolvePrivyContext(req, walletAddress) {
  const userId = await verifyPrivyToken(req)
  if (!userId) return { userId: null, isAdmin: false, ownsWallet: false }
  let user = null
  try {
    const client = await getPrivyClient()
    user = await client.getUser(userId)
  } catch (err) {
    console.warn('[social] privy lookup failed:', err?.message)
  }
  const email = (user?.email?.address
    || (user?.linkedAccounts || []).find(a => a.type === 'email')?.address
    || '').toLowerCase()
  const isAdmin = !!email && ADMIN_EMAILS.has(email)
  const linked = (user?.linkedAccounts || [])
    .filter(a => a.type === 'wallet' && typeof a.address === 'string')
    .map(a => a.address.toLowerCase())
  const ownsWallet = !!walletAddress && linked.includes(walletAddress.toLowerCase())
  return { userId, isAdmin, ownsWallet }
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
const DATA_URL_MAX_BYTES = 600_000 // ~600KB, generous for a JPEG banner / logo
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/

function isSafeImageUrl(url) {
  if (typeof url !== 'string' || url.length > 1_000_000) return false
  // Allow base64 data URLs (clients upload the image inline; we store the
  // raw blob in KV and serve it back via the same endpoint).
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
function bannerKey(chain, ca) { return `social:banner:${chain}:${ca.toLowerCase()}` }

router.get('/banner', async (req, res) => {
  const chain = String(req.query.chain || '').toLowerCase()
  const ca = String(req.query.ca || '')
  if (!VALID_CHAINS.has(chain) || !ca) return res.status(400).json({ error: 'invalid chain or ca' })
  const kv = await getKv()
  let raw = null
  if (kv) raw = await kv.get(bannerKey(chain, ca))
  else {
    const f = fileFor(bannerKey(chain, ca))
    if (fs.existsSync(f)) {
      try { raw = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
    }
  }
  res.json({ banner: raw || null })
})

function sanitiseShortText(raw, max) {
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim()
  if (cleaned.length === 0) return null
  return cleaned.slice(0, max)
}

router.put('/banner', async (req, res) => {
  const body = req.body || {}
  const chain = String(body.chain || '').toLowerCase()
  const ca = String(body.ca || '')
  const walletAddress = String(body.walletAddress || '')
  const bannerUrl = body.bannerUrl ? String(body.bannerUrl) : null
  const logoUrl = body.logoUrl ? String(body.logoUrl) : null
  // Pass an empty string ('') to clear an existing name/description; leave the
  // field undefined to keep it. null is treated the same as ''.
  const nameRaw = body.name === undefined ? undefined : (body.name || '')
  const descRaw = body.description === undefined ? undefined : (body.description || '')

  if (!VALID_CHAINS.has(chain)) return res.status(400).json({ error: 'invalid chain' })
  if (!ca) return res.status(400).json({ error: 'missing ca' })
  if (bannerUrl && !isSafeImageUrl(bannerUrl)) return res.status(400).json({ error: 'invalid bannerUrl host' })
  if (logoUrl && !isSafeImageUrl(logoUrl)) return res.status(400).json({ error: 'invalid logoUrl host' })

  const ctx = await resolvePrivyContext(req, walletAddress)
  if (!ctx.userId) return res.status(401).json({ error: 'Unauthorized' })
  // Phase 1: admin-only edit. Deployer detection lands later.
  if (!ctx.isAdmin) return res.status(403).json({ error: 'editor permission required' })

  // Read-then-merge so each PUT can update a subset of fields.
  let prev = null
  const kv = await getKv()
  if (kv) prev = await kv.get(bannerKey(chain, ca))
  else {
    const f = fileFor(bannerKey(chain, ca))
    if (fs.existsSync(f)) {
      try { prev = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
    }
  }
  prev = prev || {}

  const value = {
    bannerUrl: bannerUrl != null ? bannerUrl : (prev.bannerUrl || null),
    logoUrl: logoUrl != null ? logoUrl : (prev.logoUrl || null),
    name: nameRaw === undefined ? (prev.name || null) : sanitiseShortText(nameRaw, 60),
    description: descRaw === undefined ? (prev.description || null) : sanitiseShortText(descRaw, 280),
    updatedBy: walletAddress || ctx.userId,
    updatedAt: Date.now(),
  }
  if (kv) await kv.set(bannerKey(chain, ca), value)
  else fs.writeFileSync(fileFor(bannerKey(chain, ca)), JSON.stringify(value))
  res.json({ banner: value })
})

// ─── Posts ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const chain = String(req.query.chain || '').toLowerCase()
  const ca = String(req.query.ca || '')
  if (!VALID_CHAINS.has(chain) || !ca) return res.status(400).json({ error: 'invalid chain or ca' })
  const callerWallet = String(req.headers['x-caller-wallet'] || '').toLowerCase()
  try {
    const posts = await readJsonList(postsKey(chain, ca), POSTS_CAP)
    const view = await Promise.all(posts.map(async (p) => {
      const [likesArr, commentsLen] = await Promise.all([
        readWalletList(likesKey(p.id), LIKES_CAP),
        readJsonList(commentsKey(p.id), COMMENTS_CAP).then(arr => arr.length).catch(() => 0),
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
    res.json({ posts: view })
  } catch (err) {
    console.error('[social] GET posts failed:', err?.message)
    res.status(500).json({ error: 'read failed' })
  }
})

router.post('/', async (req, res) => {
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
    await listLpush(postsKey(chain, ca), JSON.stringify(post))
    await listLtrim(postsKey(chain, ca), 0, POSTS_CAP - 1)
    await recordPostTime(walletAddress)
  } catch (err) {
    console.error('[social] persist failed:', err?.message)
    return res.status(500).json({ error: 'persist failed' })
  }

  res.json({
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
})

// ─── Likes ───────────────────────────────────────────────────────
router.post('/:postId/like', async (req, res) => {
  const postId = req.params.postId
  if (!postId || !/^[\w]+$/.test(postId)) return res.status(400).json({ error: 'invalid post id' })
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
  if (liked) next = existing.filter(x => x !== w)
  else next = [w, ...existing].slice(0, LIKES_CAP)

  try {
    await listLtrim(likesKey(postId), 1, 0) // wipe (start>stop = empty)
    for (let i = next.length - 1; i >= 0; i -= 1) {
      await listLpush(likesKey(postId), next[i])
    }
  } catch (err) {
    console.error('[social] like persist failed:', err?.message)
    return res.status(500).json({ error: 'persist failed' })
  }
  res.json({ liked: !liked, likes: next.length })
})

// ─── Comments ────────────────────────────────────────────────────
router.get('/:postId/comments', async (req, res) => {
  const postId = req.params.postId
  if (!postId || !/^[\w]+$/.test(postId)) return res.status(400).json({ error: 'invalid post id' })
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
    res.json({ comments: view })
  } catch (err) {
    console.error('[social] comments GET failed:', err?.message)
    res.status(500).json({ error: 'read failed' })
  }
})

router.post('/:postId/comments', async (req, res) => {
  const postId = req.params.postId
  if (!postId || !/^[\w]+$/.test(postId)) return res.status(400).json({ error: 'invalid post id' })
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
    await listLpush(commentsKey(postId), JSON.stringify(comment))
    await listLtrim(commentsKey(postId), 0, COMMENTS_CAP - 1)
  } catch (err) {
    console.error('[social] comment persist failed:', err?.message)
    return res.status(500).json({ error: 'persist failed' })
  }

  res.json({
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
})

module.exports = router
