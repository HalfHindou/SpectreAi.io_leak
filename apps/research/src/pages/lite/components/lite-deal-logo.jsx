/**
 * lite-deal-logo.jsx - the company mark on LITE's Private Markets / Deals rows.
 *
 * The feed's `logoUrl` is a dead Clearbit link (the host no longer resolves),
 * so rendering it straight put a monogram on EVERY row (founder screenshot
 * 2026-09-05). PRO already solved this in pm-logo.jsx: mine the domain out of
 * that dead URL, add name-derived candidates, and only accept a favicon whose
 * domain actually matches the company - a wrong logo is worse than a letter.
 * This reuses that walk verbatim and draws the result in LITE's own circle
 * (.lite-trow-logo), so the row looks like every other LITE list.
 *
 * A real, non-Clearbit `logoUrl` (a future feed that ships one) is tried first
 * and is not size-gated; the favicon candidates are, because Google answers
 * "nothing here" with a decodable 16px placeholder that fires `load`, not
 * `error`.
 */
import { useMemo, useState } from 'react'
import { faviconCandidates } from '@/pages/private-markets/components/pm-logo'

const MIN_CRISP_PX = 32
const isClearbit = (u) => /(^|\.)clearbit\.com/.test(String(u || ''))

export default function DealLogo({ name, logoUrl = null, domain = null }) {
  const { list, direct } = useMemo(() => {
    const direct = logoUrl && !isClearbit(logoUrl) ? 1 : 0
    const head = direct ? [logoUrl] : []
    return { list: [...head, ...faviconCandidates({ company: name, domain, logoUrl })], direct }
  }, [name, logoUrl, domain])
  // Keyed on the first candidate so a recycled row restarts the walk instead of
  // staying wherever the previous company gave up.
  const [walk, setWalk] = useState({ key: list[0], idx: 0 })
  const idx = walk.key === list[0] ? walk.idx : 0
  const src = list[idx] || null
  const reject = () => setWalk({ key: list[0], idx: idx + 1 })
  const initial = String(name || '?').trim().replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?'

  return (
    <span className="lite-trow-logo" aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={reject}
          onLoad={(e) => { if (idx >= direct && e.currentTarget.naturalWidth < MIN_CRISP_PX) reject() }}
        />
      ) : (
        <span className="lite-trow-fallback">{initial}</span>
      )}
    </span>
  )
}
