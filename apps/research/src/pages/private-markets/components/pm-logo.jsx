/**
 * pm-logo.jsx — the company mark on every Private Markets surface.
 *
 * Three things were wrong with the old chain and all three showed on screen:
 *
 *   1. It led with `logo.clearbit.com`. That host no longer resolves at all —
 *      Clearbit's free logo API is gone — so the first candidate was a
 *      guaranteed DNS failure on every card.
 *   2. The next candidate derived a "company domain" from the deal's SOURCE
 *      link, which is the publisher. Half the feed therefore wore the
 *      TechCrunch logo as if it were the company's.
 *   3. The backend guesses a domain by slugging the company NAME, and the feed
 *      carries headline fragments as names. "How AI" became how.com, "Fiat
 *      Ventures" became fiat.com — real sites, wrong companies, confidently
 *      rendered.
 *
 * So: a favicon is only fetched for a domain that actually matches the company
 * name, and everything else gets a designed monogram rather than a smudged
 * 16px upscale of somebody else's icon.
 */

import { useMemo, useState } from 'react'

const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Pull the host out of a URL, or return a bare host unchanged. */
function hostOf(value) {
  if (!value) return null
  const raw = String(value)
  if (!raw.includes('/')) return raw.replace(/^www\./, '').toLowerCase()
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * Is this domain plausibly THIS company's?
 *
 * Exact only. "Fiat Ventures" → fiat.com and "How AI" → how.com are the failure
 * mode a fuzzy rule produces, and a confidently wrong logo is worse than none.
 * Both spellings of a dotted brand count, so xAI → x.ai and Mistral AI →
 * mistral.ai survive.
 */
export function domainMatchesCompany(domain, company) {
  const host = hostOf(domain)
  const name = compact(company)
  if (!host || name.length < 2) return false
  const root = host.split('.')[0]
  return name === compact(root) || name === compact(host)
}

/**
 * The favicon URL for a company, or null when we have no domain we trust — the
 * caller then renders the monogram, which is the honest answer.
 *
 * One source, not a chain: every favicon service answers "no icon" with a 200-ish
 * PLACEHOLDER image rather than a network error (DuckDuckGo serves a grey arrow
 * on a 404, and a 404 carrying a decodable body still fires `load`, not
 * `error`), so a fallback chain silently stops on the first placeholder. Google
 * returns the largest icon it holds, capped at `sz` — which makes the decoded
 * WIDTH the usable signal, and that is what <PmLogo> gates on.
 */
/**
 * The TLDs this feed's companies actually live on.
 *
 * The backend guesses `<slug>.com` and nothing else, which is why a wall of
 * monograms appeared: runable, ringg, keenable, vangrid, jpyc, yellowcard and
 * River AI all pass the name check and then fail to resolve, because none of
 * them is a .com. `.com` stays first — when it IS right it is right.
 */
const TLDS = ['com', 'ai', 'io', 'co', 'xyz']
const MAX_CANDIDATES = 6

/**
 * Every domain worth trying for a company — each one still filtered through
 * `domainMatchesCompany`, so the guarantee that made this file strict is
 * untouched. We are widening the CANDIDATES, not loosening the test.
 *
 * The second root drops a trailing word, which is what lets "River AI" reach
 * river.ai — and note that river.COM is generated and then REJECTED by the same
 * predicate, because "riverai" is not "river". The rule does the work.
 */
function candidateDomains(company) {
  const name = compact(company)
  if (name.length < 3) return []
  const words = String(company).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const roots = new Set([name])
  if (words.length > 1) roots.add(words.slice(0, -1).join(''))
  const out = []
  for (const root of roots) for (const tld of TLDS) out.push(`${root}.${tld}`)
  return out.filter((d) => domainMatchesCompany(d, company))
}

/** Ordered favicon URLs to walk for one company. */
export function faviconCandidates({ company, domain, logoUrl }) {
  // The backend still ships dead Clearbit URLs; the useful part is the domain
  // it embedded, not the request.
  const fromLogoUrl = logoUrl && /(^|\.)clearbit\.com$/.test(hostOf(logoUrl) || '')
    ? hostOf(String(logoUrl).split('/').pop())
    : null
  const known = [domain, fromLogoUrl].map(hostOf).filter((d) => domainMatchesCompany(d, company))
  // Capped: a company with no web presence must not fire a dozen requests before
  // settling on the monogram, and this runs once per card on a long feed.
  const all = [...new Set([...known, ...candidateDomains(company)])].slice(0, MAX_CANDIDATES)
  return all.map((d) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`)
}

/** Back-compat single-URL helper. */
export function faviconFor(args) {
  return faviconCandidates(args)[0] || null
}

/**
 * Below this the mark is either Google's 16px "nothing here" placeholder or a
 * genuine 16px favicon — and a 16px favicon blown up into a 48px tile is
 * exactly the smudge we are trying to get rid of. Either way: monogram.
 */
const MIN_CRISP_PX = 32

/** Deterministic tile hue, so a company keeps the same mark between visits. */
const TILE = [
  ['#0ea5e9', '#1e3a8a'], ['#10b981', '#065f46'], ['#f59e0b', '#7c2d12'],
  ['#a78bfa', '#4c1d95'], ['#ec4899', '#831843'], ['#38bdf8', '#0c4a6e'],
  ['#34d399', '#064e3b'], ['#fb7185', '#881337'],
]
export function tileFor(key) {
  let h = 0
  const s = String(key || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return TILE[h % TILE.length]
}

export default function PmLogo({ company, domain, logoUrl, className = '' }) {
  const list = useMemo(() => faviconCandidates({ company, domain, logoUrl }), [company, domain, logoUrl])
  // Keyed on the list so a recycled row restarts the walk rather than staying on
  // whichever candidate the PREVIOUS company gave up at.
  const [walk, setWalk] = useState({ key: list[0], idx: 0 })
  const idx = walk.key === list[0] ? walk.idx : 0
  const src = list[idx] || null
  const reject = () => setWalk({ key: list[0], idx: idx + 1 })
  const [from, to] = tileFor(company)
  const initial = String(company || '?').trim().replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?'
  const showImg = !!src

  return (
    <div className={`pm-logo ${className}`.trim()} aria-hidden="true">
      {showImg ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={reject}
          onLoad={(e) => { if (e.currentTarget.naturalWidth < MIN_CRISP_PX) reject() }}
        />
      ) : (
        <span className="pm-logo__mono" style={{ backgroundImage: `linear-gradient(145deg, ${from}, ${to})` }}>
          {initial}
        </span>
      )}
    </div>
  )
}
