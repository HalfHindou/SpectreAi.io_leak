/**
 * LITE Vitals — which businesses in crypto actually make money.
 *
 * The Lite cut of the platform-fundamentals surface. Pro answers "everything
 * about every platform"; this answers one question per screen, in order:
 * who earns, who is growing, who has real users. No tabs, no metric switcher —
 * a Lite reader scrolls once and knows.
 *
 * Structural styles only (.lv-). Colour leans on currentColor and neutral rgba
 * so every look mode (paper / glass / daylight) restyles the shared shells
 * (.lite-view, .lite-view-head, .lite-panel, .lite-stat, .lite-eyebrow) and this
 * view follows automatically — the shared head is what carries the over-photo
 * text treatment in glass and the dark ink in paper.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './lite-vitals.css'

const fmtUsd = (v) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const n = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (n >= 1e9) return `${s}$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${s}$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}m`
  if (n >= 1e3) return `${s}$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`
  return `${s}$${n.toFixed(0)}`
}

const fmtNum = (v) => {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}m`
  if (v >= 10_000) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return Math.round(v).toLocaleString('en-US')
}

const fmtPct = (v) => {
  if (v == null || !Number.isFinite(v)) return null
  if (v > 999) return '+999%+'
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`
}

const tone = (v) => (v == null || !Number.isFinite(v) || Math.abs(v) < 0.05 ? '' : v > 0 ? ' lv-up' : ' lv-down')

/** Inline trend. SVG so it stays crisp at any DPR without a per-row canvas. */
function Spark({ points, up }) {
  if (!Array.isArray(points) || points.length < 3) return <span className="lv-spark" />
  const vals = points.map((p) => (Array.isArray(p) ? p[1] : p)).filter((v) => Number.isFinite(v))
  if (vals.length < 3) return <span className="lv-spark" />
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const step = 64 / (vals.length - 1)
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(20 - ((v - min) / span) * 17 - 1.5).toFixed(1)}`).join(' ')
  return (
    <svg className="lv-spark" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" className={up ? 'lv-spark-up' : 'lv-spark-down'} />
    </svg>
  )
}

function Row({ r, rank, valueLabel, value, sub, onOpen }) {
  const [broken, setBroken] = useState(false)
  return (
    <li className="lv-row">
      <button type="button" className="lv-rowbtn" onClick={() => onOpen(r.slug)}>
        <span className="lv-rank">{rank}</span>
        {r.logo && !broken
          ? <img className="lv-logo" src={r.logo} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
          : <span className="lv-logo lv-logo--fb" aria-hidden="true">{String(r.name || '?').charAt(0).toUpperCase()}</span>}
        <span className="lv-id">
          <span className="lv-name">{r.name}</span>
          <span className="lv-meta">{r.category}</span>
        </span>
        <Spark points={r.spark} up={(r.feeChg30d ?? 0) >= 0} />
        <span className="lv-val">
          {value}
          {sub ? <em>{sub}</em> : null}
        </span>
      </button>
      <span className="lv-vlabel">{valueLabel}</span>
    </li>
  )
}

export default function LiteVitals({ onOpenPath }) {
  const { t: tr } = useTranslation()
  const [bundle, setBundle] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let cancelled = false
    // Lite reads the same contract Pro does — one core, so the two surfaces can
    // never quietly disagree about what a platform earned.
    fetch('/api/vitals?fn=bundle&tier=full', { signal: AbortSignal.timeout(90_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) { setBundle(j); setState('ok') } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  const open = (slug) => (onOpenPath ? onOpenPath(`/vitals/${slug}`) : window.open(`/vitals/${slug}`, '_self'))

  const earners = useMemo(() => (bundle?.ladders?.fees?.rows || []).slice(0, 12), [bundle])
  const growing = useMemo(
    () => (bundle?.ladders?.growth?.rows || []).slice(0, 8),
    [bundle]
  )
  const traders = useMemo(() => (bundle?.ladders?.users?.rows || []).slice(0, 8), [bundle])
  const sectors = useMemo(() => (bundle?.categories || []).slice(0, 6), [bundle])
  const t = bundle?.totals
  const sectorMax = sectors.length ? Math.max(...sectors.map((s) => s.fees30d || 0), 1) : 1

  if (state === 'loading') {
    return (
      <div className="lite-view lite-view--wide lv">
        <div className="lite-panel lv-skel" aria-label={tr('lite.litevitals.ariaLoadingPlatformFundamentals', "Loading platform fundamentals")} />
        <div className="lite-panel lv-skel" />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="lite-view lite-view--wide lv">
        <div className="lite-panel">
          <p className="lv-empty">{tr('lite.litevitals.fundamentalsAreUnavailableR', "Fundamentals are unavailable right now.")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="lite-view lite-view--wide lv">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tr('lite.litevitals.whoActuallyMakesMoney', "Who actually makes money")}</h1>
        <p className="lite-view-sub">
          Fees, revenue and real users across {t?.tracked ? t.tracked.toLocaleString('en-US') : 'every'} platforms.
          Tap any row for the full breakdown.
        </p>
      </header>

      <div className="lv-stats">
        <div className="lite-stat">
          <span>Fees · 24h</span>
          <strong>{fmtUsd(t?.fees24h)}</strong>
        </div>
        <div className="lite-stat">
          <span>Fees · 30d</span>
          <strong>{fmtUsd(t?.fees30d)}</strong>
        </div>
        <div className="lite-stat">
          <span>{tr('lite.litevitals.keptByProtocols', "Kept by protocols")}</span>
          <strong>{fmtUsd(t?.revenue30d)}</strong>
        </div>
        <div className="lite-stat">
          <span>{tr('lite.litevitals.platforms', "Platforms")}</span>
          <strong>{t?.tracked ? t.tracked.toLocaleString('en-US') : '—'}</strong>
        </div>
      </div>

      <section className="lite-panel lv-block">
        <div className="lite-block-head">
          <span className="lite-eyebrow">{tr('lite.litevitals.topEarners', "Top earners")}</span>
          <span className="lv-hint">{tr('lite.litevitals.fees30Days', "fees, 30 days")}</span>
        </div>
        <ol className="lv-list">
          {earners.map((r, i) => (
            <Row key={r.slug} r={r} rank={i + 1} onOpen={open}
              valueLabel="30d fees"
              value={fmtUsd(r.fees30d)}
              sub={fmtPct(r.feeChg30d)} />
          ))}
        </ol>
      </section>

      {growing.length ? (
        <section className="lite-panel lv-block">
          <div className="lite-block-head">
            <span className="lite-eyebrow">{tr('lite.litevitals.growingFastest', "Growing fastest")}</span>
            <span className="lv-hint">{tr('lite.litevitals.vsThePrevious30Days', "vs the previous 30 days")}</span>
          </div>
          <ol className="lv-list">
            {growing.map((r, i) => (
              <Row key={r.slug} r={r} rank={i + 1} onOpen={open}
                valueLabel="fee growth"
                value={<span className={tone(r.value).trim()}>{fmtPct(r.value)}</span>}
                sub={fmtUsd(r.fees30d)} />
            ))}
          </ol>
          <p className="lv-note">
            A platform needs real fees in both months to appear here, so nothing tops this list
            by growing from nothing.
          </p>
        </section>
      ) : null}

      {traders.length ? (
        <section className="lite-panel lv-block">
          <div className="lite-block-head">
            <span className="lite-eyebrow">{tr('lite.litevitals.realUsers', "Real users")}</span>
            <span className="lv-hint">{tr('lite.litevitals.countedByUs', "counted by us")}</span>
          </div>
          <ol className="lv-list">
            {traders.map((r, i) => (
              <Row key={r.slug} r={r} rank={i + 1} onOpen={open}
                valueLabel="traders / day"
                value={fmtNum(r.dau)}
                sub={r.userPnl != null ? `${r.userPnl >= 0 ? 'won ' : 'lost '}${fmtUsd(Math.abs(r.userPnl))}` : null} />
            ))}
          </ol>
          <p className="lv-note">
            Counted from raw fills rather than reported. Perps only for now — an app that also
            trades spot shows a slice here, not its whole audience.
          </p>
        </section>
      ) : null}

      {sectors.length ? (
        <section className="lite-panel lv-block">
          <div className="lite-block-head">
            <span className="lite-eyebrow">{tr('lite.litevitals.bySector', "By sector")}</span>
            <span className="lv-hint">{tr('lite.litevitals.fees30Days', "fees, 30 days")}</span>
          </div>
          <ul className="lv-sectors">
            {sectors.map((s) => (
              <li key={s.key}>
                <span className="lv-sec-name">{s.key}</span>
                <span className="lv-sec-track" aria-hidden="true">
                  <span className="lv-sec-fill" style={{ width: `${Math.max(2, ((s.fees30d || 0) / sectorMax) * 100)}%` }} />
                </span>
                <span className="lv-sec-val">{fmtUsd(s.fees30d)}</span>
                <span className={`lv-sec-chg${tone(s.chg30d)}`}>{fmtPct(s.chg30d) || '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
