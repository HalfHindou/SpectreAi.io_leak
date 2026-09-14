import { memo, useMemo } from 'react'

/**
 * CategoryChatterMini — compact horizontal-bar list of the top categories
 * this token is associated with on X Dash. Each row shows the category name,
 * a normalized chatter bar, and a numeric value.
 *
 * Pulls from intel.token.categories or intel.categories. Hidden if empty.
 */
function CategoryChatterMini({ intel }) {
  const categories = useMemo(() => normalizeCategories(intel), [intel])

  if (!categories || categories.length === 0) {
    return (
      <div className="xfv-panel">
        <div className="xfv-panel-header">
          <div className="xfv-panel-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>Categories</span>
          </div>
        </div>
        <div className="xfv-panel-body">
          <div className="xfv-empty">No category data</div>
        </div>
      </div>
    )
  }

  const max = Math.max(...categories.map((c) => c.value), 1)
  const top = categories.slice(0, 6)

  return (
    <div className="xfv-panel">
      <div className="xfv-panel-header">
        <div className="xfv-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          <span>Categories</span>
        </div>
        <span className="xfv-panel-meta">{top.length}</span>
      </div>
      <div className="xfv-panel-body">
        <div className="xfv-cat-list">
          {top.map((c) => {
            const pct = Math.max(2, Math.min(100, (c.value / max) * 100))
            return (
              <div key={c.name} className="xfv-cat-row">
                <div className="xfv-cat-name" title={c.name}>{c.name}</div>
                <div className="xfv-cat-bar">
                  <div className="xfv-cat-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="xfv-cat-value">{formatCompact(c.value)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function normalizeCategories(intel) {
  if (!intel) return []
  const raw =
    intel.token?.categories ||
    intel.categories ||
    intel.token?.tags ||
    intel.tags ||
    []
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => {
      if (typeof c === 'string') return { name: c, value: 1 }
      const name = c.name || c.label || c.category || ''
      if (!name) return null
      const value = num(c.mention_count ?? c.count ?? c.value ?? c.score ?? 1)
      return { name, value }
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function formatCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.round(n))
}

export default memo(CategoryChatterMini)
