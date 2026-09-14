import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

/**
 * RwaNetFlows — one view, top to bottom:
 *   net total (the card's headline) → diverging bars (outflow left of the
 *   axis, inflow right) → daily heartbeat strip.
 *
 * 2026-08-03: a donut was the wrong form for a signed quantity, and the
 * Flows/Daily toggle only existed because the card had empty space to fill —
 * both readings now sit in one column.
 *
 * Timeframe pills: 7D · 30D · 90D
 */

const TFS = [
  { id: 7,  label: '7D'  },
  { id: 30, label: '30D' },
  { id: 90, label: '90D' },
]

function fmtDay(ts) {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function RwaNetFlows({ tvlHistory, loading, onSeeAll }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtSignedUsd = (v) => {
    if (v == null || !isFinite(v)) return '--'
    // Sign FIRST, then the currency. fmtLargeShort leaves the minus inside its
    // own output ("$-510.24M"), which sat next to this helper's own "+$1.69B"
    // and read as two different formats for the same measurement.
    return `${v < 0 ? '-' : '+'}${fmtLargeShort(Math.abs(v))}`
  }
  const [tf, setTf] = useState(7)

  /* Daily totals, then per-day deltas inside the chosen timeframe. */
  const data = useMemo(() => {
    const series = tvlHistory?.series || []
    const cats = tvlHistory?.categories || []
    if (series.length < tf + 1 || !cats.length) return null
    const totals = series.map(pt => cats.reduce((s, c) => s + (pt[c] || 0), 0))
    const N = totals.length
    const start = Math.max(1, N - tf)
    const days = []
    let inflow = 0, outflow = 0
    for (let i = start; i < N; i++) {
      const delta = totals[i] - totals[i - 1]
      days.push({ date: series[i].date, delta })
      if (delta >= 0) inflow += delta
      else outflow += delta
    }
    const net = inflow + outflow
    const ratio = (inflow + Math.abs(outflow)) > 0
      ? inflow / (inflow + Math.abs(outflow))
      : 0.5
    return { days, inflow, outflow, net, ratio }
  }, [tvlHistory, tf])

  /* ── Bars geometry ── */
  const BAR_W = 280, BAR_H = 156, BAR_PAD = { t: 8, b: 18, l: 0, r: 0 }
  const bars = useMemo(() => {
    if (!data?.days?.length) return null
    const days = data.days
    const N = days.length
    let absMax = 0
    for (const d of days) absMax = Math.max(absMax, Math.abs(d.delta))
    if (absMax === 0) absMax = 1
    const ph = BAR_H - BAR_PAD.t - BAR_PAD.b
    const zeroY = BAR_PAD.t + ph / 2
    const slot = (BAR_W - BAR_PAD.l - BAR_PAD.r) / N
    const w = Math.max(2, slot * 0.55)
    return days.map((d, i) => {
      const h = (Math.abs(d.delta) / absMax) * (ph / 2)
      const x = BAR_PAD.l + i * slot + (slot - w) / 2
      const y = d.delta >= 0 ? zeroY - h : zeroY
      return { x, y, w, h, delta: d.delta, date: d.date, up: d.delta >= 0 }
    }).concat([{ zeroY }])
  }, [data])

  /* ── Loading ── */
  if (loading && !data) {
    return (
      <section className="rnf">
        <header className="rnf__head">
          <span className="rnf__title">{t('tokenizedAssets.netFlows.title', 'Net Flows')}</span>
        </header>
        <div className="rnf__flows-skel animate-shimmer" />
      </section>
    )
  }

  if (!data) {
    return (
      <section className="rnf rnf--empty">
        <header className="rnf__head">
          <span className="rnf__title">{t('tokenizedAssets.netFlows.title', 'Net Flows')}</span>
        </header>
        <div className="rnf__empty">{t('tokenizedAssets.netFlows.empty', 'Flow data unavailable.')}</div>
      </section>
    )
  }

  const isPositive = data.net >= 0

  return (
    <section className="rnf" aria-label={t('tokenizedAssets.netFlows.ariaLabel', 'Net Flows')}>
      <header className="rnf__head">
        <div className="rnf__head-left">
          <span className="rnf__title">{t('tokenizedAssets.netFlows.title', 'Net Flows')}</span>
          <span className="rnf__sub">{t('tokenizedAssets.netFlows.subtitle', 'Inflows vs outflows')}</span>
        </div>
        <div className="rnf__tfs" role="tablist">
          {TFS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`rnf__tf${tf === p.id ? ' on' : ''}`}
              onClick={() => setTf(p.id)}
              aria-selected={tf === p.id}
            >{p.label}</button>
          ))}
        </div>
      </header>

      {/* ── Lead readout: net is THE number of this card (label above the
           value, mirroring the allocation card so the row reads as one). ── */}
      <div className="rnf__lead">
        <span className="rnf__lead-label">
          {isPositive
            ? t('tokenizedAssets.netFlows.netInflows', 'NET INFLOW')
            : t('tokenizedAssets.netFlows.netOutflows', 'NET OUTFLOW')}
        </span>
        <span className={`rnf__lead-val mono ${isPositive ? 'up' : 'dn'}`}>{fmtSignedUsd(data.net)}</span>
      </div>

      {/* ── Diverging bars: outflow left of the axis, inflow right ── */}
      {(() => {
        const inAbs = data.inflow
        const outAbs = Math.abs(data.outflow)
        const maxSide = Math.max(inAbs, outAbs, 1)
        return (
          <>
            <div
              className="rnf__flows-track"
              role="img"
              aria-label={`${t('tokenizedAssets.netFlows.inflows', 'Inflows')} ${fmtSignedUsd(data.inflow)}, ${t('tokenizedAssets.netFlows.outflows', 'Outflows')} ${fmtSignedUsd(data.outflow)}`}
            >
              <div className="rnf__flows-half rnf__flows-half--out">
                <div className="rnf__flows-bar rnf__flows-bar--out" style={{ width: `${(outAbs / maxSide) * 100}%` }} />
              </div>
              <div className="rnf__flows-axis" />
              <div className="rnf__flows-half rnf__flows-half--in">
                <div className="rnf__flows-bar rnf__flows-bar--in" style={{ width: `${(inAbs / maxSide) * 100}%` }} />
              </div>
            </div>
            <div className="rnf__ends">
              <span className="rnf__end rnf__end--dn">
                <span className="rnf__end-name">{t('tokenizedAssets.netFlows.outflows', 'Outflows')}</span>
                <span className="rnf__end-val mono">{fmtSignedUsd(data.outflow)}</span>
              </span>
              <span className="rnf__end rnf__end--up">
                <span className="rnf__end-name">{t('tokenizedAssets.netFlows.inflows', 'Inflows')}</span>
                <span className="rnf__end-val mono">{fmtSignedUsd(data.inflow)}</span>
              </span>
            </div>
          </>
        )
      })()}

      {/* ── Daily heartbeat, always on (it used to hide behind a view toggle
           that only existed because the card had space to fill). ── */}
      {bars && (
        <div className="rnf__spark-wrap">
          <span className="rnf__spark-label">{t('tokenizedAssets.netFlows.dailyFlow', 'Daily flow')}</span>
          <svg viewBox={`0 0 ${BAR_W} ${BAR_H}`} preserveAspectRatio="none" className="rnf__spark">
            {/* Zero line: stroke via CSS, not an inline warm-white rgba —
                that hardcoded value vanished on the day-mode white card. */}
            <line
              className="rnf__spark-zero"
              x1={0} x2={BAR_W}
              y1={bars[bars.length - 1].zeroY} y2={bars[bars.length - 1].zeroY}
              strokeDasharray="2 4"
            />
            {bars.slice(0, -1).map((b, i) => (
              <rect
                key={i}
                x={b.x} y={b.y}
                width={b.w} height={Math.max(1, b.h)}
                rx={1.5}
                fill={b.up ? '#10B981' : '#EF4444'}
                opacity={b.h < 1 ? 0.3 : 0.92}
              >
                <title>{`${fmtDay(b.date)} · ${fmtSignedUsd(b.delta)}`}</title>
              </rect>
            ))}
          </svg>
          <div className="rnf__spark-foot mono">
            <span>{fmtDay(data.days[0]?.date)}</span>
            <span>{fmtDay(data.days[data.days.length - 1]?.date)}</span>
          </div>
        </div>
      )}

      {onSeeAll && (
        <button type="button" className="rnf__cta" onClick={onSeeAll}>
          {t('tokenizedAssets.netFlows.viewFlowBoard', 'View Flow Board')} <span aria-hidden>&rarr;</span>
        </button>
      )}
    </section>
  )
}
