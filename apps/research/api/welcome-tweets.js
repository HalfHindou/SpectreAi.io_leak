/**
 * Vercel Serverless — Welcome page hot tweets feed.
 *
 * Proxies the new latest-tweets endpoint and returns the legacy
 * `{ results: [...] }` shape expected by the frontend.
 *
 * Consumers: apps/research/src/pages/home/components/use-x-posts-data.js,
 *            apps/research/src/pages/you/widgets/YouCryptoTwitter.jsx
 */

import { isAuthGateValid } from './auth-gate.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const TWEETS_API_URL = (
  process.env.LATEST_TWEETS_API_URL ||
  'https://aut-tweets-api-test-277369611639.us-central1.run.app/latest-tweets'
).replace(/\/+$/, '')

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181']
const TIMEOUT_MS = 8000

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 2026-05-11 lockdown: welcome-tweets is the highest-frequency widget on
  // the home page; anonymous polls burn the latest-tweets quota.
  if (!isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }
  // A response only this gate allowed must not land in a SHARED cache — the
  // edge keys on the URL alone, so a warm entry would answer the next
  // anonymous caller without the gate running. See _lib/gate-cache.js.
  sealGatedResponse(res)

  try {
    const upstream = await fetch(TWEETS_API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
    const data = await upstream.json()
    const tweets = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : [])

    const ranked = tweets
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a?.created_at_iso || '') || 0
        const tb = Date.parse(b?.created_at_iso || '') || 0
        return tb - ta
      })

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240')
    return res.status(200).json({ results: ranked })
  } catch (err) {
    return res.status(200).json({ results: [], error: err?.message || 'unavailable' })
  }
}
