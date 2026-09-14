/**
 * Vercel Serverless -- Notifications proxy.
 * Notifications require persistent in-memory state and SSE connections, neither
 * of which are feasible in Vercel's stateless/30 s-timeout runtime.
 * Every route returns a graceful empty/ok response.
 *
 * Routing: vercel.json rewrites /api/notifications/* to
 *   /api/notifications-api?route=<sub-route>
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const route = (req.query.route || '').toLowerCase();

  // ── GET /api/notifications ────────────────────────────────────────────────
  if (!route) {
    return res.status(200).json({ notifications: [] });
  }

  // ── POST /api/notifications/mark-read ─────────────────────────────────────
  if (route === 'mark-read') {
    return res.status(200).json({ ok: true });
  }

  // ── GET /api/notifications/stream (SSE) ───────────────────────────────────
  // Vercel functions have a 30 s execution limit -- SSE is not feasible.
  // Send an init event and close the connection so the client falls back.
  if (route === 'stream') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write('event: init\n');
    res.write('data: {"serverless":true,"message":"SSE not available in production"}\n\n');
    return res.end();
  }

  // Unknown sub-route
  return res.status(200).json({ notifications: [] });
}
