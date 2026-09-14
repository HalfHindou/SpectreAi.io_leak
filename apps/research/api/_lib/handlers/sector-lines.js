/**
 * Vercel Serverless – Sector price lines proxy.
 * GET /api/sector-lines (vercel.json rewrites /api/sector/lines -> /api/sector-lines)
 * Proxies to the Spectre charts backend for sector price line data.
 */

const SECTOR_LINES_URL = 'https://charts-277369611639.us-central1.run.app/price_line_sect';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Forward any query parameters from the original request
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const url = SECTOR_LINES_URL + qs;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.warn('Sector lines upstream:', response.status);
      return res.status(502).json({ error: `Upstream returned ${response.status}` });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240');
    return res.status(200).json(data);
  } catch (err) {
    console.error('Sector lines proxy error:', err.message);
    return res.status(502).json({ error: 'Sector lines backend unavailable' });
  }
}
