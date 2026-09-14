/**
 * Vercel Serverless — detective-proxy handler.
 *
 * Real Spectre detective backend isn't wired yet. The useDetectiveFeed hook
 * treats any non-2xx as an "HTTP <status>" error badge in the UI, so
 * returning 501 painted a red error in the Intelligence sidebar. Returning
 * 200 with an empty data array renders the clean "no autonomous verdicts in
 * the last 24h" empty state instead.
 *
 * When the actual detective feed lands on Hetzner, swap this for a proxy
 * to the upstream (likely /v1/intelligence/detective).
 */

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181']

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Short s-maxage so the widget doesn't repeatedly hit this while empty;
  // long swr so repeat visitors get instant paint without a round-trip.
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600')
  return res.status(200).json({ data: [], updatedAt: Date.now() })
}
