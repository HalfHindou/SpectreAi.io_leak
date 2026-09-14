/**
 * vt-categories.jsx — where the money is made, by sector.
 *
 * Level and momentum side by side: the bar is 30-day fees, the delta is the
 * change against the previous 30 days. They are deliberately two readings of
 * the same row rather than one blended "score", which is how sector rankings
 * turn into noise.
 */

import { useMemo } from 'react'
import { usd, pct, toneOf } from './vt-format'

export default function VtCategories({ categories, onPick, active }) {
  const rows = useMemo(() => (categories || []).slice(0, 12), [categories])
  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.fees30d || 0), 1)

  return (
    <section className="vt-section vt-cats" id="sectors">
      <header className="vt-section__head">
        <div>
          <span className="vt-eyebrow">Sectors</span>
          <h2>Which businesses are earning</h2>
          <p className="vt-section__sub">30-day fees by category, with the change against the previous 30 days.</p>
        </div>
      </header>

      {/* Same grid as the rows below, so every label sits over its own column.
          The bar's own track is left unlabelled — it IS the 30-day fees figure
          printed in the column beside it, drawn instead of written. */}
      <div className="vt-thead vt-thead--cats" aria-hidden="true">
        <span>Sector</span>
        <span />
        <span className="vt-gap" />
        <span>Fees, 30d</span>
        <span>Chg</span>
        <span className="vt-thead__cat-count">Platforms</span>
      </div>

      <ul className="vt-cats__list">
        {rows.map((c) => {
          const on = active === c.key
          return (
            <li key={c.key}>
              <button
                type="button"
                className={`vt-cat${on ? ' is-active' : ''}`}
                onClick={() => onPick?.(on ? null : c.key)}
                aria-pressed={on}
              >
                <span className="vt-cat__name">{c.key}</span>
                <span className="vt-cat__track" aria-hidden="true">
                  <span className="vt-cat__fill" style={{ width: `${Math.max(1.5, ((c.fees30d || 0) / max) * 100)}%` }} />
                </span>
                <span className="vt-gap" aria-hidden="true" />
                <span className="vt-cat__value">{usd(c.fees30d)}</span>
                <span className={`vt-cat__delta vt-tone--${toneOf(c.chg30d)}`}>{pct(c.chg30d)}</span>
                <span className="vt-cat__count">{c.count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
