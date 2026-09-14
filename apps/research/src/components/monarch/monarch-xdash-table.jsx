/**
 * MonarchXDashTable — mini X-Dash momentum board rendered inside a chat
 * answer. Rows come from the same xdashRunners board /x-dash ranks by
 * (60s module cache + live CG price overlay) — zero model-generated numbers.
 */
import { useEffect, useState, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getXDashRows, fmtUsd, fmtPriceUsd, fmtPct } from './monarch-live-data'
import './monarch-xdash-table.css'

function MonarchXDashTable({ spec }) {
  const limit = Math.max(3, Math.min(15, Number(spec?.limit) || 8))
  const title = spec?.title || 'X-Dash · Social momentum'
  const [rows, setRows] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    getXDashRows(limit).then(r => { if (!cancelled) setRows(r) })
    return () => { cancelled = true }
  }, [limit])

  const openRow = (r) => {
    if (r.address) {
      navigate(`/token?address=${r.address}${r.networkId ? `&networkId=${r.networkId}` : ''}`)
    } else {
      navigate(`/token?symbol=${r.symbol}`)
    }
  }

  return (
    <div className="mxt-wrap">
      <div className="mxt-head">
        <span className="mxt-title">{title}</span>
        <button type="button" className="mxt-open" onClick={() => navigate('/x-dash')}>
          Open X-Dash
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <path d="M7 17L17 7" /><path d="M8 7h9v9" />
          </svg>
        </button>
      </div>

      {rows === null && (
        <div className="mxt-loading">
          {Array.from({ length: Math.min(limit, 5) }).map((_, i) => (
            <div key={i} className="mxt-loading-row" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      )}

      {Array.isArray(rows) && rows.length === 0 && (
        <div className="mxt-empty">X-Dash board unreachable right now — no rows to show.</div>
      )}

      {Array.isArray(rows) && rows.length > 0 && (
        <table className="mxt-table">
          <thead>
            <tr>
              <th className="mxt-th-rank">#</th>
              <th>Token</th>
              <th className="mxt-num">Mentions 24h</th>
              <th className="mxt-num">Price</th>
              <th className="mxt-num">24h</th>
              <th className="mxt-num">Mcap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const change = Number(r.price_change_percentage_24h) || 0
              return (
                <tr key={r.id || r.symbol} onClick={() => openRow(r)} title={`Open ${r.symbol}`}>
                  <td className="mxt-rank mono">{i + 1}</td>
                  <td>
                    <span className="mxt-token">
                      {r.image ? (
                        <img className="mxt-logo" src={r.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                      ) : (
                        <span className="mxt-logo mxt-logo-fallback">{String(r.symbol || '?').slice(0, 1)}</span>
                      )}
                      <span className="mxt-token-names">
                        <span className="mxt-token-symbol">${r.symbol}</span>
                        <span className="mxt-token-name">{r.name}</span>
                      </span>
                    </span>
                  </td>
                  <td className="mxt-num mono">{r._xdash?.mentions_24h ? r._xdash.mentions_24h.toLocaleString('en-US') : '—'}</td>
                  <td className="mxt-num mono">{fmtPriceUsd(r.current_price)}</td>
                  <td className={`mxt-num mono ${change >= 0 ? 'mxt-up' : 'mxt-down'}`}>{fmtPct(change)}</td>
                  <td className="mxt-num mono">{fmtUsd(r.market_cap)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="mxt-footer">
        <span className="mxt-live-dot" aria-hidden="true" />
        Live · X-Dash momentum board
      </div>
    </div>
  )
}

export default memo(MonarchXDashTable)
