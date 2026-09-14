/**
 * vt-logo.jsx — one platform mark, with a fallback chain that actually resolves.
 *
 * The bundle ships `https://icons.llama.fi/<slug>.jpg` for every row, and that
 * host 404s for roughly a third of them (pump, uniswap, hyperliquid, aave,
 * solana, morpho, ethena, aerodrome, opensea…). The sibling host
 * `icons.llamao.fi/icons/protocols/<slug>` serves those, but 404s on a handful
 * the first one has (fomo-social-trading). Neither is a superset, so we walk
 * both before giving up — that takes the ladder from ~71% of rows with a real
 * mark to ~84%, and the rest fall through to a coloured initial rather than a
 * broken-image glyph.
 *
 * Every vitals surface used to carry its own copy of this with a single
 * candidate; this is the one implementation.
 */

import { useMemo, useState } from 'react'
import { hueFor } from './vt-format'

/** Ordered, de-duplicated list of URLs worth trying for one platform. */
export function logoCandidates({ logo, slug, llamaSlug }) {
  const out = []
  // The feed's `logo` is usually just `icons.llama.fi/<slug>.jpg` composed
  // upstream - the host that 404s for ~29% of rows. Trying it first meant those
  // rows paid a full failed round-trip before the mark that exists could even be
  // requested, which is the logo pop-in. A CURATED logo (any other host) is
  // still trusted first; the generated one drops to the back of its own pair.
  const generated = !!logo && /(^|\/\/)icons\.llama\.fi\//.test(logo)
  if (logo && !generated) out.push(logo)
  for (const s of [llamaSlug, slug]) {
    if (!s) continue
    out.push(`https://icons.llamao.fi/icons/protocols/${encodeURIComponent(s)}`)
    out.push(`https://icons.llama.fi/${encodeURIComponent(s)}.jpg`)
  }
  if (generated) out.push(logo)
  return [...new Set(out)]
}

export default function VtLogo({
  logo, slug, llamaSlug, name,
  className = 'vt-av',
  // The initial tile is a SEPARATE class rather than a suffix on `className`,
  // because callers pass two classes ("vt-av vt-av--lg") and a suffix would
  // land on the modifier.
  fallbackClass = 'vt-av--fallback',
  tint,
  size,
}) {
  const list = useMemo(() => logoCandidates({ logo, slug, llamaSlug }), [logo, slug, llamaSlug])
  // Keyed by the candidate list so a re-used row (a board switch reuses the same
  // component instance) restarts the chain instead of staying on "broken".
  const [state, setState] = useState({ key: list[0], idx: 0 })
  const idx = state.key === list[0] ? state.idx : 0
  const src = list[idx] || null
  const style = size ? { width: size, height: size } : undefined

  if (!src) {
    const bg = tint === false ? undefined : (tint || hueFor(slug || name))
    return (
      <span
        className={`${className} ${fallbackClass}`.trim()}
        style={bg ? { ...style, background: bg } : style}
        aria-hidden="true"
      >
        {String(name || '?').trim().charAt(0).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      className={className}
      style={style}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setState({ key: list[0], idx: idx + 1 })}
    />
  )
}
