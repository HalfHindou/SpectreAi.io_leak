/**
 * MonarchBubbleMap — a lightweight SVG bubble map inside a chat answer.
 * Mini sibling of /bubbles: radius = mcap, color = 24h direction with
 * intensity scaled to the move. Pure SVG (no three.js, no d3) so it costs
 * nothing on the chat path. Rows hydrate live from the shared top-coins
 * snapshot or the X-Dash board — never from the model.
 */
import { useEffect, useMemo, useState, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBubbleRows, fmtPct } from './monarch-live-data'
import './monarch-bubble-map.css'

const W = 560
const H = 320

/* Greedy spiral circle packing — deterministic, collision-checked.
 * Biggest bubbles claim the center; the rest spiral outward. */
function packBubbles(rows) {
  if (!rows.length) return []
  const caps = rows.map(r => Math.sqrt(Math.max(Number(r.market_cap) || 0, 1)))
  const maxCap = Math.max(...caps)
  const placed = []
  rows.forEach((row, i) => {
    const radius = 14 + (caps[i] / maxCap) * 34
    let x = W / 2
    let y = H / 2
    let angle = i * 2.399963 // golden angle keeps the spiral even
    let dist = 0
    let guard = 0
    while (guard < 600) {
      x = W / 2 + Math.cos(angle) * dist
      y = H / 2 + Math.sin(angle) * dist * 0.62 // flatten to the panel's aspect
      const collides = placed.some(p => {
        const dx = p.x - x
        const dy = p.y - y
        return Math.sqrt(dx * dx + dy * dy) < p.r + radius + 3
      })
      const inBounds = x - radius > 4 && x + radius < W - 4 && y - radius > 4 && y + radius < H - 4
      if (!collides && inBounds) break
      angle += 0.45
      dist += 1.6
      guard += 1
    }
    placed.push({ ...row, x, y, r: radius })
  })
  return placed
}

function MonarchBubbleMap({ spec }) {
  const source = ['top', 'gainers', 'losers', 'xdash'].includes(spec?.source) ? spec.source : 'top'
  const limit = Math.max(6, Math.min(40, Number(spec?.limit) || 25))
  const title = spec?.title || (
    source === 'xdash' ? 'X-Dash runners' :
    source === 'gainers' ? 'Top gainers · 24h' :
    source === 'losers' ? 'Top losers · 24h' : 'Market map · 24h'
  )
  const [rows, setRows] = useState(null)
  const [hover, setHover] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    getBubbleRows(source, limit).then(r => { if (!cancelled) setRows(r) })
    return () => { cancelled = true }
  }, [source, limit])

  const bubbles = useMemo(() => packBubbles(rows || []), [rows])

  return (
    <div className="mbm-wrap">
      <div className="mbm-head">
        <span className="mbm-title">{title}</span>
        <button type="button" className="mbm-open" onClick={() => navigate(source === 'xdash' ? '/x-dash' : '/bubbles')}>
          {source === 'xdash' ? 'Open X-Dash' : 'Open Bubbles'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <path d="M7 17L17 7" /><path d="M8 7h9v9" />
          </svg>
        </button>
      </div>

      {rows === null && <div className="mbm-loading" />}
      {Array.isArray(rows) && rows.length === 0 && (
        <div className="mbm-empty">No live rows for this view right now.</div>
      )}

      {bubbles.length > 0 && (
        <div className="mbm-stage">
          <svg viewBox={`0 0 ${W} ${H}`} className="mbm-svg" role="img" aria-label={title}>
            {bubbles.map((b) => {
              const sym = String(b.symbol || '').toUpperCase()
              const change = Number(b.price_change_percentage_24h) || 0
              const up = change >= 0
              const intensity = Math.min(Math.abs(change) / 12, 1)
              const fill = up
                ? `rgba(16, 185, 129, ${0.1 + intensity * 0.3})`
                : `rgba(239, 68, 68, ${0.1 + intensity * 0.3})`
              const stroke = up
                ? `rgba(16, 185, 129, ${0.35 + intensity * 0.45})`
                : `rgba(239, 68, 68, ${0.35 + intensity * 0.45})`
              const showLabel = b.r >= 20
              return (
                <g
                  key={b.id || sym}
                  className="mbm-bubble"
                  onClick={() => navigate(`/token?symbol=${sym}`)}
                  onMouseEnter={() => setHover(b)}
                  onMouseLeave={() => setHover(null)}
                >
                  <circle cx={b.x} cy={b.y} r={b.r} fill={fill} stroke={stroke} strokeWidth="1" />
                  {showLabel && (
                    <>
                      <text x={b.x} y={b.y - 2} className="mbm-label" textAnchor="middle">{sym}</text>
                      <text x={b.x} y={b.y + 11} className={`mbm-pct ${up ? 'mbm-pct-up' : 'mbm-pct-down'}`} textAnchor="middle">
                        {fmtPct(change)}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </svg>
          {hover && (
            <div
              className="mbm-tooltip"
              style={{
                left: `${(hover.x / W) * 100}%`,
                top: `${Math.max(((hover.y - hover.r) / H) * 100 - 4, 2)}%`,
              }}
            >
              <span className="mbm-tooltip-sym">${String(hover.symbol || '').toUpperCase()}</span>
              <span className={`mono ${Number(hover.price_change_percentage_24h) >= 0 ? 'mbm-pct-up' : 'mbm-pct-down'}`}>
                {fmtPct(hover.price_change_percentage_24h)}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mbm-footer">
        <span className="mbm-live-dot" aria-hidden="true" />
        Live · size = mcap · color = 24h move
      </div>
    </div>
  )
}

export default memo(MonarchBubbleMap)
