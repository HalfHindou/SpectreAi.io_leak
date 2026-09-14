/**
 * Yahoo's cookie + crumb, in one place.
 *
 * v10 `quoteSummary` refuses an unauthenticated request, so every caller needs
 * a cookie from fc.yahoo.com and a crumb minted against it. This lived inside
 * the stocks handler; the options board needs the same session for earnings
 * dates, and two independent sessions would mean two cookie mints, two crumb
 * caches and two chances to be the one holding a stale crumb when Yahoo starts
 * answering 401 — which it has done before, hard enough to take quoteSummary
 * down on the Hetzner host entirely.
 *
 * One module means one refresh path, and any handler that gets a 401 can
 * invalidate the session for all of them.
 */

export const YAHOO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const SESSION_TTL_MS = 30 * 60 * 1000;
let session = { cookie: null, crumb: null, expires: 0 };

export async function getYahooSession() {
  if (session.cookie && session.crumb && Date.now() < session.expires) return session;
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': YAHOO_UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const setCookieHeader = cookieRes.headers.get('set-cookie') || '';
    const cookies = setCookieHeader.split(',').map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
    if (!cookies) throw new Error('No cookies');

    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YAHOO_UA, 'Cookie': cookies },
      signal: AbortSignal.timeout(5000),
    });
    if (!crumbRes.ok) throw new Error(`Crumb ${crumbRes.status}`);
    const crumb = await crumbRes.text();
    if (!crumb || crumb.length < 5) throw new Error('Invalid crumb');

    session = { cookie: cookies, crumb, expires: Date.now() + SESSION_TTL_MS };
    return session;
  } catch (err) {
    console.warn('[Yahoo] Session refresh failed:', err.message);
    return { cookie: null, crumb: null, expires: 0 };
  }
}

/** A 401 means the crumb died early — drop it so the next call re-mints. */
export function invalidateYahooSession() {
  session.expires = 0;
}
