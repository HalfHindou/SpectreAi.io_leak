/**
 * Band G — policy odds. The ladder returns here on purpose: the rhyme with the
 * rates band says "same instrument, different subject" without a caption.
 *
 * The election pool sits behind a two-state pill in the band head rather than
 * a second ladder, because stacking two ladders would make the page's one
 * repeated shape into the gray wall the layout is built to avoid. The choice
 * persists across visits.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { WstBand, WstHead } from './wst-band'
import WstOdds from './wst-odds'

const KEY = 'wst.policy.pool'
const POOLS = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'election', label: 'Election' },
]

function readPool() {
  try {
    const v = localStorage.getItem(KEY)
    return POOLS.some((p) => p.id === v) ? v : 'crypto'
  } catch {
    return 'crypto'
  }
}

export default function WstPolicy({ politics, changed, now }) {
  const [pool, setPool] = useState('crypto')

  /* Read after mount so the first paint is identical everywhere. */
  useEffect(() => { setPool(readPool()) }, [])

  const choose = useCallback((id) => {
    setPool(id)
    try { localStorage.setItem(KEY, id) } catch { /* private mode — the toggle still works, it just won't persist */ }
  }, [])

  const rows = pool === 'election'
    ? politics?.election_policy_odds
    : politics?.crypto_policy_odds
  const n = Array.isArray(rows) ? rows.length : 0

  return (
    <WstBand id="wst-policy" label="Policy odds" changed={changed}>
      <WstHead
        eyebrow="Policy odds"
        sub="sorted by open interest"
        meta={n ? `n=${n}` : null}
        changed={changed}
        control={
          <span className="wst-toggle-set" role="group" aria-label="odds pool">
            {POOLS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`wst-toggle${pool === p.id ? ' is-on' : ''}`}
                aria-pressed={pool === p.id}
                onClick={() => choose(p.id)}
              >
                {p.label}
              </button>
            ))}
          </span>
        }
      />
      <WstOdds
        rows={rows}
        now={now}
        emptyNote={pool === 'election' ? 'No election markets priced.' : 'No policy markets priced.'}
      />
    </WstBand>
  )
}
