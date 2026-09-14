/**
 * Vercel Serverless Function - Telegram bot webhook + account-link API
 *
 * POST /api/telegram?hook=1  - Telegram bot webhook (called BY Telegram; no
 *                              gate/Privy/CORS - authenticated via the
 *                              X-Telegram-Bot-Api-Secret-Token header).
 * POST /api/telegram         - issue a link code (Privy JWT required)
 * GET /api/telegram          - { linked: boolean } (Privy JWT required)
 * DELETE /api/telegram       - unlink (Privy JWT required)
 *
 * KV:
 *   tg:code:{code}   -> userId, EX 600  (one-shot: read-then-delete)
 *   tg:chat:{userId} -> chatId
 *   tg:user:{chatId} -> userId          (reverse index so /stop is O(1))
 *   tg:botname       -> cached getMe username, EX 86400
 */

import crypto from 'node:crypto'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { userRateLimit } from './_lib/ratelimit.js'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || ''

let _kvPromise = null
async function getKv() {
  if (_kvPromise) return _kvPromise
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) { _kvPromise = Promise.resolve(null); return _kvPromise }
  _kvPromise = import('@upstash/redis').then(m => new m.Redis({ url, token })).catch(() => null)
  return _kvPromise
}

const ALLOWED_ORIGINS = ['http://localhost:5180', 'http://localhost:5181']

// ── Telegram Bot API helpers ────────────────────────────────────────────

async function sendMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.error('[telegram] sendMessage failed:', err?.message)
  }
}

async function resolveBotUsername(kv) {
  if (TELEGRAM_BOT_USERNAME) return TELEGRAM_BOT_USERNAME
  if (kv) {
    try {
      const cached = await kv.get('tg:botname')
      if (cached) return cached
    } catch (err) {
      console.warn('[telegram] botname cache read failed:', err?.message)
    }
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
      signal: AbortSignal.timeout(3000),
    })
    const data = await res.json().catch(() => null)
    const username = data?.result?.username || null
    if (username && kv) {
      try { await kv.set('tg:botname', username, { ex: 86400 }) } catch (err) {
        console.warn('[telegram] botname cache write failed:', err?.message)
      }
    }
    return username
  } catch (err) {
    console.error('[telegram] getMe failed:', err?.message)
    return null
  }
}

// ── Webhook secret verification ─────────────────────────────────────────
// Shape-validate BEFORE timingSafeEqual: Buffer.from() on unequal-length
// input still works, but timingSafeEqual throws synchronously on a length
// mismatch - check length first so a malformed/missing header never throws.
function verifyWebhookSecret(req) {
  if (!TELEGRAM_WEBHOOK_SECRET) return false
  const header = req.headers?.['x-telegram-bot-api-secret-token']
  if (typeof header !== 'string' || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(TELEGRAM_WEBHOOK_SECRET)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// ── Webhook path (?hook=1) - called by Telegram, always 200 except the
// secret-header mismatch, which is the one case Telegram is allowed to
// see fail (a non-Telegram caller without the secret gets 401).
async function handleWebhook(req, res) {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const update = req.body || {}
    const message = update.message
    const chatId = message?.chat?.id
    const text = typeof message?.text === 'string' ? message.text.trim() : ''

    if (!chatId || !text) {
      return res.status(200).json({ ok: true })
    }

    const kv = await getKv()

    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1]
      if (!code) {
        await sendMessage(chatId, 'Send /start followed by the link code from the Spectre app.')
        return res.status(200).json({ ok: true })
      }
      if (!kv) {
        await sendMessage(chatId, 'Linking is temporarily unavailable. Try again shortly.')
        return res.status(200).json({ ok: true })
      }
      // One-shot: read then delete, so a code can never be replayed.
      const userId = await kv.get(`tg:code:${code}`)
      if (!userId) {
        await sendMessage(chatId, 'That code is invalid or expired. Generate a new one from Spectre alerts settings.')
        return res.status(200).json({ ok: true })
      }
      await kv.del(`tg:code:${code}`)
      // Relink hygiene: drop the previous chat's reverse index, otherwise a
      // later /stop from the OLD chat would resolve to this user and silently
      // unlink the NEW chat.
      try {
        const oldChatId = await kv.get(`tg:chat:${userId}`)
        if (oldChatId && String(oldChatId) !== String(chatId)) await kv.del(`tg:user:${oldChatId}`)
      } catch { /* best effort */ }
      await kv.set(`tg:chat:${userId}`, chatId)
      await kv.set(`tg:user:${chatId}`, userId)
      await sendMessage(chatId, 'Connected. Spectre alerts will arrive here. Send /stop to disconnect.')
      return res.status(200).json({ ok: true })
    }

    if (text.startsWith('/stop')) {
      if (kv) {
        const userId = await kv.get(`tg:user:${chatId}`)
        if (userId) {
          await kv.del(`tg:chat:${userId}`)
          await kv.del(`tg:user:${chatId}`)
        }
      }
      await sendMessage(chatId, 'Disconnected. You will no longer receive Spectre alerts here.')
      return res.status(200).json({ ok: true })
    }

    await sendMessage(chatId, 'Send /start with your link code from the Spectre app, or /stop to disconnect.')
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[telegram] webhook processing error:', err?.message)
    // Telegram retry-spams on a non-200 - never let an internal error surface as one.
    return res.status(200).json({ ok: true })
  }
}

// ── Link API (Privy-authed) ──────────────────────────────────────────────
async function handleLinkApi(req, res) {
  const origin = req.headers?.origin
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (!isAuthGateValid(req)) return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Privy auth required', code: 'PRIVY_REQUIRED' })
  if (await userRateLimit(res, { bucket: 'telegram', userId, max: 10, windowMs: 60_000 })) return

  if (!TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: 'Telegram not configured' })

  const kv = await getKv()
  if (!kv) return res.status(503).json({ error: 'KV not configured' })

  try {
    if (req.method === 'POST') {
      const code = crypto.randomBytes(6).toString('base64url')
      await kv.set(`tg:code:${code}`, userId, { ex: 600 })
      const botname = await resolveBotUsername(kv)
      return res.status(200).json({ code, url: botname ? `https://t.me/${botname}?start=${code}` : null })
    }
    if (req.method === 'GET') {
      const chatId = await kv.get(`tg:chat:${userId}`)
      return res.json({ linked: !!chatId })
    }
    if (req.method === 'DELETE') {
      const chatId = await kv.get(`tg:chat:${userId}`)
      if (chatId) {
        await kv.del(`tg:chat:${userId}`)
        await kv.del(`tg:user:${chatId}`)
      }
      return res.json({ ok: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[telegram] link-api error:', err?.message)
    return res.status(500).json({ error: err.message })
  }
}

export default async function handler(req, res) {
  if (req.query?.hook === '1') return handleWebhook(req, res)
  return handleLinkApi(req, res)
}
