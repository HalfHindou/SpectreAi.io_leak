/**
 * Vercel Serverless - Brain API proxy.
 * Mirrors packages/server/index.js GET /api/brain and /api/brain/:path.
 *
 * The "Brain" is an external Spectre intelligence service. We proxy with the
 * server-side API key so the key never reaches the browser.
 *
 * Routing: market-api.js dispatches /api/brain* here via ?fn=brain&path=...
 */

const BRAIN_API_BASE = process.env.BRAIN_API_BASE || 'http://204.168.244.18:3850/v1/brain';
const BRAIN_API_KEY = process.env.BRAIN_API_KEY || process.env.SPECTRE_API_KEY || '';

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const subPath = String(req.query.path || '').replace(/^\/+/, '');
    // Strip our routing params from the upstream query string.
    const passthrough = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (k === 'fn' || k === 'path') continue;
      if (Array.isArray(v)) v.forEach((vv) => passthrough.append(k, vv));
      else passthrough.append(k, String(v));
    }
    const qs = passthrough.toString();
    const url = subPath
      ? `${BRAIN_API_BASE}/${encodeURIComponent(subPath)}${qs ? `?${qs}` : ''}`
      : `${BRAIN_API_BASE}${qs ? `?${qs}` : ''}`;

    const upstream = await fetch(url, {
      headers: BRAIN_API_KEY ? { 'X-API-Key': BRAIN_API_KEY } : {},
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Brain unavailable' });
    }

    const data = await upstream.json();
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (err) {
    console.warn('[brain] error:', err.message);
    return res.status(502).json({ error: 'Brain unavailable' });
  }
}
