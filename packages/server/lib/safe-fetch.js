// SSRF-safe fetch wrapper. Refuses non-https URLs, hostnames that resolve
// to private/loopback/link-local addresses, and manually re-validates every
// redirect hop. Use for any route that fetches a URL derived from user or
// LLM input (e.g. /api/project/crawl, Monarch fetch_url tool).

const dns = require('dns').promises;
const net = require('net');

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
  /^255\.255\.255\.255$/,
];

function isPrivateIPv4(ip) {
  return PRIVATE_V4.some((re) => re.test(ip));
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' || lower === '::ffff:0:0') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

async function assertPublicHttpsUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'https:') throw new Error('Only https URLs allowed');
  const host = u.hostname.toLowerCase();
  if (!host) throw new Error('Empty hostname');
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost')) {
    throw new Error('Disallowed hostname');
  }
  if (net.isIP(host)) {
    if (isPrivateIP(host)) throw new Error('URL points to private network');
    return u;
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('DNS resolution failed');
  }
  if (!addrs || addrs.length === 0) throw new Error('DNS resolution failed');
  for (const a of addrs) {
    if (isPrivateIP(a.address)) throw new Error('URL resolves to private network');
  }
  return u;
}

async function safeFetch(rawUrl, options = {}) {
  const { maxRedirects = 3, ...fetchOptions } = options;
  await assertPublicHttpsUrl(rawUrl);
  let currentUrl = rawUrl;
  let resp;
  for (let i = 0; i <= maxRedirects; i++) {
    resp = await fetch(currentUrl, { ...fetchOptions, redirect: 'manual' });
    const status = resp.status;
    if (status >= 300 && status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp;
      if (i >= maxRedirects) throw new Error('Too many redirects');
      const next = new URL(loc, currentUrl).href;
      await assertPublicHttpsUrl(next);
      currentUrl = next;
      continue;
    }
    return resp;
  }
  return resp;
}

module.exports = { safeFetch, assertPublicHttpsUrl, isPrivateIP };
