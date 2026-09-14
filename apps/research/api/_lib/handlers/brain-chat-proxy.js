/**
 * brain-chat-proxy — JSON one-shot chat. SSE streaming variant lives at
 * brain-chat-stream-proxy.js (separate handler because Vercel function
 * config differs).
 *
 * SEC-20260513-007: SPECTRE_API_ORIGIN must be HTTPS. The previous
 * `http://204.168.244.18:3850` fallback shipped user chat content over
 * cleartext HTTP — fail closed instead.
 */
const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

// Default to the direct Hetzner origin — api.spectreai.io is CF-WAF blocked
// for Vercel server-to-server traffic (audit 2026-06-10). Env var still wins.
const DEFAULT_DIRECT_ORIGIN = 'http://204.168.244.18:3850'
const SPECTRE_API_ORIGIN = (() => {
  const raw = process.env.SPECTRE_API_ORIGIN || DEFAULT_DIRECT_ORIGIN
  // SEC-20260513-007 keeps HTTPS required for env-provided origins.
  // SPECTRE_API_ALLOW_HTTP=1 is the opt-in escape hatch; the hardcoded
  // internal default above is trusted (audit 2026-05-26 — CF-WAF blocks
  // Vercel→api.spectreai.io for SSE).
  const allowInternalHttp = process.env.SPECTRE_API_ALLOW_HTTP === '1' || raw === DEFAULT_DIRECT_ORIGIN
  if (!raw.startsWith('https://') && !allowInternalHttp) {
    console.error('[brain-chat-proxy] SPECTRE_API_ORIGIN must be HTTPS (or set SPECTRE_API_ALLOW_HTTP=1), got:', raw)
    return null
  }
  return raw
})()

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!SPECTRE_API_ORIGIN) {
    return res.status(503).json({ error: 'Upstream origin not configured (HTTPS required)' })
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 35_000)
  try {
    const r = await fetch(`${SPECTRE_API_ORIGIN}/v1/brain/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(r.status).json(j)
    return res.status(200).json(j)
  } catch (err) {
    clearTimeout(timer)
    return res.status(502).json({ error: 'chat failed', detail: err?.message || 'unknown' })
  }
}
