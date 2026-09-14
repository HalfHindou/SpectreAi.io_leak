/**
 * SSRF guard for Vercel serverless routes that fetch user-supplied URLs.
 *
 * Mirrors the Express `packages/server/lib/safe-fetch.js` (Evgeniy's
 * P0 fix for /api/project/crawl + Monarch fetch_url) but in ESM form
 * for the Vercel serverless context.
 *
 * Use anywhere that takes a URL from `req.query` or `req.body` and
 * performs a server-side `fetch()`: img-proxy, derivatives-proxy
 * upstreams, anything in extended-proxy that synthesises a URL from
 * user input.
 *
 * Why a regex-only hostname check is insufficient: an attacker who
 * controls `evil.example` can serve a public A-record that passes the
 * regex, then when Node's fetch re-resolves DNS at connect-time the
 * record flips to a private IP (DNS rebinding). This helper resolves
 * once via `dns.lookup` and rejects if ANY resolved address is in a
 * private range, before the fetch ever runs.
 */
import dns from 'node:dns'
import net from 'node:net'

const dnsLookup = dns.promises.lookup

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
  /^255\.255\.255\.255$/,
]

function isPrivateIPv4(ip) {
  return PRIVATE_V4.some((re) => re.test(ip))
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::' || lower === '::ffff:0:0') return true
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7)
    if (net.isIPv4(v4)) return isPrivateIPv4(v4)
  }
  return false
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip)
  if (net.isIPv6(ip)) return isPrivateIPv6(ip)
  return true // unknown format - fail closed
}

/**
 * Validate a URL is publicly fetchable (https, public IP, no metadata
 * endpoints). Returns the parsed URL or throws on any guard failure.
 */
export async function assertPublicHttpsUrl(rawUrl) {
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  if (u.protocol !== 'https:') throw new Error('Only https URLs allowed')
  const host = u.hostname.toLowerCase()
  if (!host) throw new Error('Empty hostname')
  // Block well-known internal / metadata names that resolve to public IPs
  // on some clouds (e.g. metadata.google.internal A-record → 169.254.169.254)
  if (
    host === 'localhost' ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Disallowed hostname')
  }
  // Literal IP in the URL bypasses DNS entirely — check directly.
  // Decimal/hex/octal IP encodings (e.g. http://2130706433/) are normalized
  // by `new URL()` into standard dotted-quad form before this check.
  if (net.isIP(host)) {
    if (isPrivateIP(host)) throw new Error('URL points to private network')
    return u
  }
  // DNS resolve and check every returned address. `verbatim: true` returns
  // results in the order the resolver provided them (no v4-over-v6 reorder),
  // which matters because attackers can prefer v6 to bypass a v4-only check.
  let addrs
  try {
    addrs = await dnsLookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error('DNS resolution failed')
  }
  if (!addrs || addrs.length === 0) throw new Error('DNS resolution failed')
  for (const a of addrs) {
    if (isPrivateIP(a.address)) throw new Error('URL resolves to private network')
  }
  return u
}

export { isPrivateIP }
