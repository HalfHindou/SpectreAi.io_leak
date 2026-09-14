/**
 * Vercel Serverless – Project crawl: roadmap or whitepaper (2 sentences max).
 * GET /api/project/crawl?url=...&intent=roadmap|whitepaper
 * Safety: https only, 8s timeout, ~500KB max body.
 *
 * SEC-20260513-RT-07 hardening:
 *   - SSRF: use assertPublicHttpsUrl() to block private IPs and DNS rebinds.
 *   - No silent http→https upgrade (was letting attackers funnel internal
 *     IPs past the protocol check).
 *   - redirect: 'manual' to stop a public-host first hop from re-routing
 *     to a private follower URL.
 *   - Tiered rate-gate (Privy 10/min, auth-gate IP 5/min) so this can't be
 *     used as an unauth crawl-bot amplifier.
 */

import { assertPublicHttpsUrl } from '../safe-url.js'
import { verifyPrivyToken } from '../auth.js'
import { rateLimit, userRateLimit } from '../ratelimit.js'
import { isAuthGateValid } from '../../auth-gate.js'

const TIMEOUT_MS = 8000

function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstTwoSentences(text) {
  if (!text || typeof text !== 'string') return ''
  const trimmed = text.trim()
  const match = trimmed.match(/^(.+?\.\s*.+?\.)(?:\s|$)/)
  return match ? match[1].trim() : trimmed.slice(0, 300).trim()
}

function extractRoadmapSnippet(text) {
  const lower = text.toLowerCase()
  const idx = lower.indexOf('roadmap')
  if (idx < 0) return text.slice(0, 400).trim()
  const start = Math.max(0, idx - 80)
  return text.slice(start, start + 450).trim()
}

function extractMetaDescription(html) {
  if (!html || typeof html !== 'string') return ''
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
    html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i)
  return match ? match[1].trim().slice(0, 500) : ''
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // SEC-20260513-RT-07: tiered auth-gate. Project crawl was previously
  // open to anyone — every browser visit to /ventures was an unauth
  // crawl-bot amplifier. Restrict to authenticated users (Privy or
  // auth-gate cookie) and rate-limit aggressively.
  const userId = await verifyPrivyToken(req)
  if (userId) {
    if (await userRateLimit(res, { bucket: 'project-crawl', userId, max: 10, windowMs: 60_000 })) return
  } else if (isAuthGateValid(req)) {
    if (await rateLimit(req, res, { bucket: 'project-crawl-anon', max: 5, windowMs: 60_000 })) return
  } else {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const rawUrl = typeof req.query?.url === 'string' ? req.query.url.trim() : ''
  const intent = (req.query?.intent || 'roadmap').toLowerCase()

  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing url' })
  }
  // SEC-20260513-RT-07: do NOT force-upgrade http→https. The old code
  // accepted http://10.0.0.1 (private IP), upgraded it to https://10.0.0.1,
  // then fetched — bypassing the protocol check entirely. Validate the
  // raw URL through assertPublicHttpsUrl which rejects non-https, private
  // IPs, metadata hosts (169.254.169.254, .internal, .local, etc.), and
  // does a DNS resolve to defeat rebinding attacks.
  let parsedUrl
  try {
    parsedUrl = await assertPublicHttpsUrl(rawUrl)
  } catch (err) {
    return res.status(400).json({ error: err?.message || 'Invalid URL' })
  }
  const url = parsedUrl.toString()

  const validIntents = ['roadmap', 'whitepaper', 'about']
  if (!validIntents.includes(intent)) {
    return res.status(400).json({ error: 'intent must be roadmap, whitepaper, or about' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // SEC-20260513-RT-07: redirect: 'manual' prevents a public-host
      // first hop (e.g. tinyurl.com) from re-routing to a private
      // follower URL after our DNS guard already cleared the entry host.
      redirect: 'manual',
    })
    clearTimeout(timeout)
    if (!response.ok) {
      return res.status(502).json({ error: `Site returned ${response.status}` })
    }
    const html = await response.text()
    const text = stripHtml(html)

    if (intent === 'about') {
      const meta = extractMetaDescription(html)
      const snippet = (meta || text).trim().slice(0, 400)
      return res.status(200).json({ intent: 'about', text: snippet || 'No summary found on this page.' })
    }

    if (intent === 'roadmap') {
      const snippet = extractRoadmapSnippet(text) || text.slice(0, 400).trim()
      return res.status(200).json({ intent: 'roadmap', text: snippet || 'No roadmap text found.' })
    }

    if (intent === 'whitepaper') {
      const two = firstTwoSentences(text)
      return res.status(200).json({
        intent: 'whitepaper',
        text: two || text.slice(0, 300).trim() || 'No whitepaper text found on this page. Try their /whitepaper or /docs.',
      })
    }

    return res.status(400).json({ error: 'Invalid intent' })
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out' })
    }
    return res.status(502).json({ error: err.message || 'Crawl failed' })
  }
}
