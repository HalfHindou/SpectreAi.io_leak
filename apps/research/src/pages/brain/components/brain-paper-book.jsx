/**
 * Brain — Paper Trading Book.
 *
 * The desk trades its own calls with paper money (paper_traders workers on the
 * engine box) — this is the strategy leaderboard + the latest closed trades.
 * Restored 2026-07-09 (founder: "we had many fields in brain and paper trade
 * i dont see it") — the engine ran these for weeks with no surface.
 *
 * Design discipline (matches the deck): warm-white on glass, mono numerals,
 * no colored chrome — color appears ONLY as P&L sign and the active dot.
 * 404/absence path: endpoint dark → renders null, the section vanishes.
 */
import React, { useEffect, useState } from 'react'
import BrainSectionHead from './brain-section-head'
import { brainGet } from './brain-fetch'
import './brain-paper-book.css'

const POLL_MS = 120000

function fmtUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(a >= 100 ? 0 : 2)}`
}

function agoH(ts) {
  const ms = Date.now() - Date.parse(ts)
  if (!Number.isFinite(ms)) return ''
  const h = ms / 36e5
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

export default function BrainPaperBook() {
  const [book, setBook] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const d = await brainGet('/data-api/v1/brain/paper')
      if (!cancelled && d && Array.isArray(d.traders)) setBook(d)
    }
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const traders = (book?.traders || []).filter((t) => t && t.name)
  if (!traders.length) return null
  const trades = (book?.recent_trades || []).slice(0, 6)

  return (
    <section className="ppb" aria-label="paper trading book">
      <BrainSectionHead
        title="Paper trading book"
        sub="the desk trades its own calls — paper money, real grades"
      />
      <div className="ppb-traders">
        {traders.map((t) => {
          const winPct = t.total_trades > 0 ? Math.round((t.wins / Math.max(1, t.wins + t.losses)) * 100) : null
          const pnl = Number(t.pnl_realized || 0) + Number(t.pnl_unrealized || 0)
          return (
            <div className="ppb-row" key={t.name}>
              <span className={`ppb-dot${t.active ? ' ppb-dot--on' : ''}`} aria-hidden="true" />
              <span className="ppb-name">{String(t.name).replace(/_/g, ' ')}</span>
              <span className="ppb-cell mono">
                <span className="ppb-k">equity</span> {fmtUsd(t.current_balance)}
              </span>
              <span className="ppb-cell mono">
                <span className="ppb-k">trades</span> {t.total_trades}
                {winPct != null ? ` · ${winPct}% win` : ''}
              </span>
              <span className={`ppb-cell mono ppb-pnl${pnl > 0 ? ' up' : pnl < 0 ? ' down' : ''}`}>
                <span className="ppb-k">p&l</span> {pnl > 0 ? '+' : ''}{fmtUsd(pnl)}
              </span>
              <span className="ppb-cell mono ppb-dim">
                <span className="ppb-k">open</span> {t.open_positions}
              </span>
            </div>
          )
        })}
      </div>
      {trades.length > 0 && (
        <div className="ppb-trades">
          <div className="ppb-trades-label">last closed</div>
          {trades.map((tr, i) => {
            const pct = Number(tr.pnl_pct)
            const hasPct = Number.isFinite(pct)
            return (
            <div className="ppb-trade" key={`${tr.trader}-${tr.closed_at}-${i}`}>
              <span className="ppb-trade-asset mono">{String(tr.asset || '').toUpperCase()}</span>
              <span className="ppb-trade-side">{String(tr.side || '').toUpperCase()}</span>
              <span className={`mono ppb-pnl${hasPct && pct > 0 ? ' up' : hasPct && pct < 0 ? ' down' : ''}`}>
                {hasPct ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
              </span>
              <span className="ppb-trade-why">{tr.close_reason || ''}</span>
              <span className="ppb-trade-ago mono">{agoH(tr.closed_at)}</span>
            </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
