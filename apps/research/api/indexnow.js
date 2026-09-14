// ════════════════════════════════════════════════════════════════════
// /api/indexnow — Serverless IndexNow ping endpoint
//
// POST { url: string } or { urls: string[] }
//
// Optionally protected with INDEXNOW_API_SECRET env var:
//   header: x-indexnow-secret = process.env.INDEXNOW_API_SECRET
//
// Use from CMS webhooks, the Intelligence Hub publish pipeline, or a
// scheduled job that re-pings after sitemap regeneration.
// ════════════════════════════════════════════════════════════════════

const INDEXNOW_KEY = 'a7e9c4f1d8b2469ea05c3f78d2b6e041'
const INDEXNOW_HOST = 'spectreai.io'
const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'method not allowed' })
  }

  const secret = process.env.INDEXNOW_API_SECRET
  if (secret) {
    const provided = req.headers['x-indexnow-secret']
    if (provided !== secret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' })
    }
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  body = body || {}

  let urls = []
  if (Array.isArray(body.urls)) urls = body.urls
  else if (typeof body.url === 'string') urls = [body.url]

  urls = urls
    .filter((u) => typeof u === 'string' && u.length > 0)
    .map((u) => u.startsWith('http') ? u : `https://${INDEXNOW_HOST}${u.startsWith('/') ? '' : '/'}${u}`)
    .filter((u) => {
      try {
        const parsed = new URL(u)
        return parsed.hostname === INDEXNOW_HOST
      } catch {
        return false
      }
    })

  if (urls.length === 0) {
    return res.status(400).json({ ok: false, error: 'no valid urls' })
  }

  try {
    const r = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: INDEXNOW_KEY_LOCATION,
        urlList: urls,
      }),
    })

    return res.status(200).json({
      ok: r.ok,
      status: r.status,
      submitted: urls.length,
    })
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'indexnow ping failed',
    })
  }
}
