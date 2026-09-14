/**
 * TimeMachine — "if you had invested back then…".
 *
 * Pulls the selected coin's full daily price history (via getCoinPriceHistory)
 * and renders a vertical timeline of yearly entry points. For each year it
 * shows the entry price, the multiplier to today, and what the user's amount
 * (or a $1,000 baseline) would be worth now. The earliest year — the biggest
 * "should've aped" moment — is lifted into a hero line above the timeline.
 *
 * Pure presentation over already-cached data; returns null when the coin has
 * no usable history (brand-new tokens) so the ROI page degrades cleanly.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getCoinPriceHistory } from '@/services/coinGeckoApi'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function multLabel(m) {
  if (!Number.isFinite(m) || m <= 0) return '—'
  if (m >= 1000) return `${Math.round(m).toLocaleString('en-US')}×`
  if (m >= 100) return `${m.toFixed(0)}×`
  if (m >= 10) return `${m.toFixed(1)}×`
  if (m >= 1) return `${m.toFixed(2)}×`
  return `${m.toFixed(2)}×`
}

function fmtMoney(p) {
  if (!Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1e9) return '$' + (p / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B'
  if (p >= 1e6) return '$' + (p / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M'
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// Entry price can be tiny (sub-cent tokens) or large (BTC) — adapt precision.
function fmtEntryPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 0.01) return '$' + p.toFixed(4)
  if (p >= 0.0001) return '$' + p.toFixed(6)
  return '$' + p.toExponential(2)
}

function fmtFirstDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export default function TimeMachine({
  selected,
  currentPrice,
  usdAmount = 0,
  dayMode = false,
}) {
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  const id = selected?.id || null
  const symbol = selected?.symbol?.toUpperCase() || ''

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    if (!id) { setHistory(null); return }
    setLoading(true)
    setHistory(null)
    ;(async () => {
      const data = await getCoinPriceHistory(id).catch(() => null)
      if (cancelled || !mountedRef.current) return
      setHistory(data)
      setLoading(false)
    })()
    return () => { cancelled = true; mountedRef.current = false }
  }, [id])

  // $1,000 illustrative baseline when the user hasn't entered an amount.
  const base = usdAmount > 0 ? usdAmount : 1000
  const isIllustrative = !(usdAmount > 0)

  const rows = useMemo(() => {
    if (!history?.anchors?.length || !(currentPrice > 0)) return []
    return history.anchors
      .map((a) => {
        const multiplier = currentPrice / a.price
        return {
          year: a.year,
          price: a.price,
          multiplier,
          valueNow: base * multiplier,
          tokensThen: base / a.price,
        }
      })
      .sort((a, b) => a.year - b.year)
  }, [history, currentPrice, base])

  if (loading) {
    return (
      <div className={`tm${dayMode ? ' tm--day' : ''}`}>
        <div className="tm-head">
          <span className="tm-head__eyebrow">TIME MACHINE</span>
          <h3 className="tm-head__title">Rewinding {symbol || 'the tape'}…</h3>
        </div>
        <div className="tm-skeleton">
          {[0, 1, 2, 3].map((i) => <div key={i} className="tm-skeleton__row" style={{ animationDelay: `${i * 80}ms` }} />)}
        </div>
      </div>
    )
  }

  if (rows.length === 0) return null

  // Biggest "should've bought" moment = earliest year (top of the list).
  const hero = rows.reduce((best, r) => (r.multiplier > best.multiplier ? r : best), rows[0])

  return (
    <div className={`tm${dayMode ? ' tm--day' : ''}`}>
      <div className="tm-head">
        <span className="tm-head__eyebrow">TIME MACHINE</span>
        <h3 className="tm-head__title">
          If you&apos;d invested in <span className="tm-head__token">{symbol || selected?.name}</span> back then…
        </h3>
        <p className="tm-head__sub">
          {isIllustrative ? 'A $1,000 buy' : `Your ${fmtMoney(base)}`} at each year&apos;s opening price, valued at today&apos;s {fmtEntryPrice(currentPrice)}.
          {history?.firstDate ? ` Data from ${fmtFirstDate(history.firstDate)}.` : ''}
        </p>
      </div>

      {/* Hero — the earliest, juiciest entry */}
      <div className="tm-hero">
        <div className="tm-hero__left">
          <span className="tm-hero__kicker">{isIllustrative ? '$1,000 in' : `${fmtMoney(base)} in`}</span>
          <span className="tm-hero__year">{hero.year}</span>
        </div>
        <div className="tm-hero__arrow" aria-hidden>→</div>
        <div className="tm-hero__right">
          <span className="tm-hero__value">{fmtMoney(hero.valueNow)}</span>
          <span className="tm-hero__mult">{multLabel(hero.multiplier)}</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="tm-line">
        {rows.map((r, i) => {
          const down = r.multiplier < 1
          return (
            <div
              key={r.year}
              className={`tm-row${r.year === hero.year ? ' is-hero' : ''}`}
              style={{ animationDelay: `${Math.min(i, 14) * 40}ms` }}
            >
              <span className="tm-row__node" aria-hidden />
              <span className="tm-row__year">{r.year}</span>
              <span className="tm-row__entry">
                <span className="tm-row__entry-label">entry</span>
                <span className="tm-row__entry-price">{fmtEntryPrice(r.price)}</span>
              </span>
              <span className="tm-row__spacer" />
              <span className={`tm-row__mult${down ? ' is-down' : ''}`}>{multLabel(r.multiplier)}</span>
              <span className={`tm-row__value${down ? ' is-down' : ''}`}>{fmtMoney(r.valueNow)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
