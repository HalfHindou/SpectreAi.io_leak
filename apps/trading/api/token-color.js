/**
 * Vercel Serverless Function — Token logo dominant-color cache.
 *
 * GET  /api/token-color?url=<logoUrl>
 *   Returns { color: hex|null } - cached dominant color or null if never seen.
 *
 * POST /api/token-color  body: { url, color }
 *   Stores a client-extracted dominant color (6-char hex) for the logo.
 *   Write-through cache: first user to visit a token extracts client-side and
 *   POSTs the result; every subsequent user reads it instantly via GET (and
 *   eventually via the server attaching dominantColor to token responses).
 *
 * Storage: Vercel KV with in-memory fallback for local dev.
 */
import { getTokenColor, setTokenColor } from './_lib/kv.js'

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export default async function handler(req, res) {
  const origin = req.headers?.origin
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const url = req.query?.url
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' })
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    // L4-PR7: token color is a function of logo URL only - permanent edge cache.
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=86400')
    const color = await getTokenColor(url)
    return res.json({ color })
  }

  if (req.method === 'POST') {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const { url, color } = body
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' })
    if (!color || !HEX_RE.test(color)) return res.status(400).json({ error: 'color must be #RRGGBB hex' })
    await setTokenColor(url, color)
    return res.json({ ok: true, color })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
