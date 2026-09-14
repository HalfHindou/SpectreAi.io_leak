/**
 * ZIGChain — live announcements from the official @ZIGChain X account.
 *
 * This is the realtime source of truth for partnership / product news, so the
 * page no longer needs a hand-edited "breaking news" + partner list every time
 * ZIGChain ships something. Reuses the shared official-tweets service
 * (`/api/tweets/official?username=ZIGChain`, 5-min server cache).
 *
 * Returns:
 *   announcements — cleaned, newest-first list (retweets/replies dropped)
 *   breaking      — newest announcement-like post (null → caller uses curated)
 */
import { useEffect, useMemo, useState } from 'react'
import { getOfficialTweets, normalizeOfficialTweet } from '@/services/spectreApi'

const ZIG_HANDLE = 'ZIGChain'

// Partner names we can attach a logo + chip to when found in announcement text.
// Order matters only for first-match; keys map to PARTNER_LOGOS in constants.
const PARTNER_MATCH = [
  { re: /\bfasset\b/i, name: 'Fasset' },
  { re: /\bbeehive\b/i, name: 'Beehive' },
  { re: /\bzoniqx\b/i, name: 'Zoniqx' },
  { re: /\btaurus\b/i, name: 'Taurus' },
  { re: /\bondo\b/i, name: 'Ondo Finance' },
  { re: /\bapex\b/i, name: 'Apex Group' },
  { re: /\bzamanat\b/i, name: 'Zamanat' },
  { re: /\bvaldora\b/i, name: 'Valdora' },
  { re: /\bnawa\b/i, name: 'Nawa Finance' },
  { re: /\boroswap\b/i, name: 'Oroswap' },
  { re: /\bpermapod\b/i, name: 'PermaPod' },
  { re: /\btokeny\b/i, name: 'Tokeny (via Apex)' },
  { re: /\bbtcs\b/i, name: 'BTCS Inc.' },
]

// Reads like a real announcement (vs gm / one-word hype). Used to pick the hero
// banner item and to surface the most relevant posts first.
const ANNOUNCE_RE = /(partner|integrat|collaborat|announc|now live|goes live|going live|launch|listing|\blists?\b|tokeni[sz]|custody|mainnet|onboard|brings|joins|milestone|\bMoU\b|alliance|certif|license|live on)/i

export function fmtRelTime(value) {
  if (!value) return ''
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return ''
  const ms = Date.now() - ts
  if (ms < 0) return ''
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(ts)
}

export function fmtCompact(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num <= 0) return ''
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`
  return String(num)
}

function cleanText(text) {
  return String(text || '')
    .replace(/https?:\/\/t\.co\/\S+/gi, '') // strip t.co trackers
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toHeadline(text) {
  const firstLine = text.split('\n').map((s) => s.trim()).filter(Boolean)[0] || text
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] || firstLine
  const base = sentence.length > 6 ? sentence : firstLine
  return base.length > 110 ? `${base.slice(0, 108)}…` : base
}

function deriveTags(text) {
  const tags = []
  if (/partner|collaborat|alliance|\bMoU\b|joins/i.test(text)) tags.push('Partnership')
  if (/tokeni[sz]|\bRWA\b|real.?world/i.test(text)) tags.push('RWA')
  if (/stock|equit|\bETF\b/i.test(text)) tags.push('Stocks')
  if (/custody|custodian/i.test(text)) tags.push('Custody')
  if (/stak/i.test(text)) tags.push('Staking')
  if (/list|exchange|futures/i.test(text)) tags.push('Listing')
  if (/shariah|halal|islamic/i.test(text)) tags.push('Shariah')
  if (/mainnet|\bEVM\b|upgrade|network/i.test(text)) tags.push('Network')
  return tags.length ? tags.slice(0, 3) : ['Update']
}

function detectPartner(text) {
  for (const p of PARTNER_MATCH) if (p.re.test(text)) return p.name
  return null
}

export function useZigAnnouncements({ enabled = true } = {}) {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setLoading(true)
    getOfficialTweets(ZIG_HANDLE)
      .then((data) => {
        if (cancelled) return
        const ok = Array.isArray(data?.tweets) && data.tweets.length > 0
        setRaw(ok ? data : null)
        setError(ok ? null : 'empty')
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled])

  const announcements = useMemo(() => {
    const tweets = raw?.tweets || []
    const list = tweets
      .map((tw, i) => ({ n: normalizeOfficialTweet(tw, i), i }))
      .filter(({ n }) => {
        const t = (n.text || '').trim()
        return t && !/^RT @/i.test(t) && !/^@\w/.test(t) // drop retweets + @-replies
      })
      .map(({ n, i }) => {
        const text = cleanText(n.text)
        return {
          id: n.id,
          url: n.url || `https://x.com/${ZIG_HANDLE}`,
          text,
          headline: toHeadline(text),
          createdAt: n.createdAt || n.time || '',
          _ts: Date.parse(n.createdAt || n.time || '') || 0,
          _i: i,
          likes: n.likes,
          retweets: n.retweets,
          views: n.views,
          tags: deriveTags(text),
          partner: detectPartner(text),
          isAnnouncement: ANNOUNCE_RE.test(text),
        }
      })
    // Newest first; when timestamps are missing/unparseable, preserve API order.
    list.sort((a, b) => (b._ts - a._ts) || (a._i - b._i))
    return list
  }, [raw])

  // Pick the banner post. `announcements` is newest-first. Prefer the freshest
  // announcement-shaped post, but ONLY when it's recent (<7d) — otherwise the
  // most recent post wins. This stops the banner from ever surfacing a week-old
  // partnership as if it just happened, and it means we never fall through to
  // the stale curated card just because the latest posts aren't "announcement"
  // shaped (the old code returned null on that path -> month-old Ondo card).
  const RECENT_MS = 7 * 86_400_000
  const breaking = useMemo(() => {
    if (!announcements.length) return null
    const freshAnnounce = announcements.find((a) => a.isAnnouncement && (Date.now() - a._ts) < RECENT_MS)
    return freshAnnounce || announcements[0]
  }, [announcements])

  return { announcements, breaking, loading, error }
}

export default useZigAnnouncements
