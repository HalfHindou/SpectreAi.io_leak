/**
 * Vercel Serverless Function - Image Proxy
 * Fetches external images server-side and serves them with CORS headers.
 * Used by the share card Canvas renderer to draw token logos without
 * tainting the canvas (cross-origin images block toDataURL()).
 */
import { rateLimit } from './_lib/ratelimit.js';
import { assertPublicHttpsUrl } from './_lib/safe-url.js';

// Sniff the real image type from magic bytes. Some CDNs (e.g.
// token-media.defined.fi, Codex's image host) serve genuine PNG/JPEG/WEBP with
// a generic `application/octet-stream` content-type, which the image/* check
// would otherwise reject as "Not an image". Sniffing the bytes (rather than
// trusting the URL extension or the CDN header) keeps this safe: non-image
// bytes never get served with an image content-type.
function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'image/avif';
  return null;
}

export default async function handler(req, res) {
  if (await rateLimit(req, res, { bucket: 'img-proxy', max: 120, windowMs: 60_000 })) return;

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  // 2026-05-12 SSRF lockdown: previously this only checked the URL was
  // https. An attacker could pass https://169.254.169.254/... (cloud
  // metadata) or any internal HTTPS service and we'd happily fetch it.
  // assertPublicHttpsUrl resolves DNS and rejects private/loopback/link-
  // local IPs before the fetch runs (closes DNS-rebinding too).
  try {
    await assertPublicHttpsUrl(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid or disallowed URL' });
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Spectre-AI/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return res.status(response.status).end();

    const buffer = Buffer.from(await response.arrayBuffer());
    // Prefer the declared image/* type; otherwise sniff the bytes (covers CDNs
    // that serve real images as application/octet-stream). Reject only if it's
    // neither a declared image nor a recognised image signature.
    const declaredType = (response.headers.get('content-type') || '').toLowerCase();
    const outType = declaredType.startsWith('image/') ? declaredType : sniffImageMime(buffer);
    if (!outType) {
      return res.status(400).json({ error: 'Not an image' });
    }

    res.setHeader('Content-Type', outType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    // L4-PR7: image bytes are deterministic by URL - 1 day edge cache.
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=86400');
    res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
    res.send(buffer);
  } catch {
    res.status(502).json({ error: 'Failed to fetch image' });
  }
}
