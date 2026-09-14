/**
 * MonarchTokenCard — live token card rendered inside a chat answer.
 *
 * The LLM only supplies { symbol, insight }. Price / 24h / mcap / volume /
 * 7d sparkline hydrate client-side from the shared top-coins snapshot, so
 * every number on the card is live — never model-generated.
 */
import { useEffect, useRef, useState, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLiveTokenRow, fmtUsd, fmtPriceUsd, fmtPct } from './monarch-live-data'
import './monarch-token-card.css'

function Sparkline({ points, up }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !Array.isArray(points) || points.length < 2) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = 148
    const h = 36
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const min = Math.min(...points)
    const max = Math.max(...points)
    const span = max - min || 1
    const step = w / (points.length - 1)
    const color = up ? '#10B981' : '#EF4444'
    ctx.beginPath()
    points.forEach((p, i) => {
      const x = i * step
      const y = h - 3 - ((p - min) / span) * (h - 6)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()
    // soft fill under the line
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, up ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fill()
  }, [points, up])
  return <canvas ref={ref} className="mtc-spark" style={{ width: 148, height: 36 }} aria-hidden="true" />
}

function MonarchTokenCard({ spec }) {
  const symbol = String(spec?.symbol || '').replace(/^\$/, '').toUpperCase()
  const insight = spec?.insight || ''
  const [row, setRow] = useState(null)
  const [state, setState] = useState('loading') // loading | live | miss
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getLiveTokenRow(symbol).then(r => {
      if (cancelled) return
      if (r) { setRow(r); setState('live') } else { setState('miss') }
    })
    return () => { cancelled = true }
  }, [symbol])

  const change = Number(row?.price_change_percentage_24h)
  const up = Number.isFinite(change) ? change >= 0 : true
  const sparkPoints = row?.sparkline_in_7d?.price

  if (!symbol) return null

  return (
    <div
      className="mtc-card"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/token?symbol=${symbol}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/token?symbol=${symbol}`) }}
      title={`Open ${symbol}`}
    >
      <div className="mtc-head">
        <div className="mtc-identity">
          {row?.image ? (
            <img className="mtc-logo" src={row.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          ) : (
            <span className="mtc-logo mtc-logo-fallback">{symbol.slice(0, 1)}</span>
          )}
          <div className="mtc-names">
            <span className="mtc-name">{row?.name || symbol}</span>
            <span className="mtc-symbol">${symbol}</span>
          </div>
        </div>
        {state === 'live' && (
          <div className="mtc-price-block">
            <span className="mtc-price mono">{fmtPriceUsd(row.current_price)}</span>
            <span className={`mtc-change mono ${up ? 'mtc-up' : 'mtc-down'}`}>{fmtPct(change)}</span>
          </div>
        )}
      </div>

      {state === 'loading' && (
        <div className="mtc-loading">
          <span className="mtc-shimmer" />
          <span className="mtc-shimmer mtc-shimmer-short" />
        </div>
      )}

      {state === 'live' && (
        <div className="mtc-body">
          <div className="mtc-metrics">
            <div className="mtc-metric">
              <span className="mtc-metric-label">Market cap</span>
              <span className="mtc-metric-value mono">{fmtUsd(row.market_cap)}</span>
            </div>
            <div className="mtc-metric">
              <span className="mtc-metric-label">24h volume</span>
              <span className="mtc-metric-value mono">{fmtUsd(row.total_volume)}</span>
            </div>
            {Number.isFinite(Number(row.market_cap_rank)) && (
              <div className="mtc-metric">
                <span className="mtc-metric-label">Rank</span>
                <span className="mtc-metric-value mono">#{row.market_cap_rank}</span>
              </div>
            )}
          </div>
          {Array.isArray(sparkPoints) && sparkPoints.length > 2 && (
            <Sparkline points={sparkPoints} up={up} />
          )}
        </div>
      )}

      {state === 'miss' && (
        <div className="mtc-miss">No live feed for ${symbol} in the top-250 snapshot — numbers withheld rather than guessed.</div>
      )}

      {insight && <div className="mtc-insight">{insight}</div>}
      <div className="mtc-footer">
        <span className="mtc-live-dot" aria-hidden="true" />
        <span className="mtc-footer-label">{state === 'live' ? 'Live · Spectre market feed' : state === 'loading' ? 'Fetching live data' : 'Awaiting feed'}</span>
      </div>
    </div>
  )
}

export default memo(MonarchTokenCard)
