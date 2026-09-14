/**
 * vt-seg.jsx — the segmented control the whole surface navigates with.
 *
 * One component so every compartment on the page (page tabs, board tabs, chart
 * interval, chart type) shares one affordance. The page used to be a single
 * scroll; this is what replaced it.
 */

export default function VtSeg({ items, value, onChange, label, size = 'md' }) {
  return (
    <div className={`vt-seg${size === 'sm' ? ' vt-seg--sm' : ''}`} role="tablist" aria-label={label}>
      {items.map((it) => {
        const on = value === it.id
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            disabled={it.disabled}
            title={it.title || undefined}
            className={`vt-seg__btn${on ? ' is-active' : ''}`}
            onClick={() => onChange(it.id)}
          >
            {it.label}
            {it.dot ? <i className="vt-seg__dot" aria-hidden="true" /> : null}
            {it.count != null ? <span className="vt-seg__count">{it.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
