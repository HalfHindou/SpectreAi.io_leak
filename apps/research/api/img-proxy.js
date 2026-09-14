/**
 * Vercel Serverless – Image proxy.
 * GET /api/img-proxy?url=https://...
 *
 * Proxies any HTTPS image. Validates content-type begins with "image/" to
 * prevent abuse for non-image payloads. Rejects requests to localhost and
 * private IP ranges to mitigate SSRF.
 */

import { rateLimit } from './_lib/ratelimit.js';
import { assertPublicHttpsUrl } from './_lib/safe-url.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (await rateLimit(req, res, { bucket: 'img-proxy', max: 120, windowMs: 60_000 })) return;

  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // 2026-05-12 SSRF hardening: previously this used a hostname-string
  // regex (PRIVATE_HOSTNAME_RE). That's vulnerable to DNS rebinding —
  // attacker registers evil.example with a public A-record initially,
  // we pass the check, then Node's fetch re-resolves DNS at connect
  // time and the record flips to 169.254.169.254. assertPublicHttpsUrl
  // resolves once via dns.lookup and rejects if any returned IP is in
  // a private range, closing the rebind window.
  try {
    await assertPublicHttpsUrl(imageUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid or disallowed URL' });
  }

  try {
    // 2026-07-02: hotlink-protected news CDNs (CNBC, Condé Nast/Wired,
    // AMBCrypto, OilPrice) 403'd our old `Spectre-Image-Proxy/1.0` UA, so
    // those sources rendered blank in the news feed while open-hotlink
    // sources (NYT, Fortune) worked. Present as a real browser + send a
    // same-origin Referer (most hotlink checks allow same-site referers),
    // which is exactly what makes the server-side proxy able to fetch what
    // the browser's direct <img> couldn't.
    let refererOrigin = '';
    try { refererOrigin = new URL(imageUrl).origin + '/'; } catch { /* validated above */ }
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(refererOrigin ? { Referer: refererOrigin } : {}),
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream returned ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image' });
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=172800');
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).end(buffer);
  } catch (err) {
    console.error('Image proxy error:', err.message);
    return res.status(502).json({ error: 'Failed to fetch image' });
  }
}
