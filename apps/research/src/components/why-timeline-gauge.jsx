// 48-hour timeline gauge — the shape of the window at a glance.
//
// The Why timeline answers "what happened" but you have to read it top to
// bottom to learn WHEN things clustered. This strip puts the whole 48h on one
// line: every gated event as a tick at its real position in time, so a quiet
// stretch looks quiet and a cascade looks like a cascade. Positioned by
// TIMESTAMP, never by index — the events are irregularly spaced and that
// irregularity is the information.
//
// Shared by Pro /why and the Lite Why view.
import React, { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './why-timeline-gauge.css'

const WINDOW_H = 48
const HOUR = 3600e3

// direction is the only thing that earns colour here, same rule as the
// timeline rows: bear/bull tint, everything else neutral, key events amber.
function toneOf(ev) {
  const t = String(ev?.text || '')
  const k = String(ev?.kind || '')
  if (k === 'impulse_down') return 'bear'
  if (k === 'impulse_up') return 'bull'
  if (k === 'liquidation_flush') return /of shorts/.test(t) ? 'bull' : 'bear'
  if (k === 'tape_move') {
    if (/vix/i.test(t)) return /bid/i.test(t) ? 'bear' : 'bull'
    return /sold off|fell/i.test(t) ? 'bear' : /rallied|rose/i.test(t) ? 'bull' : 'neu'
  }
  return 'neu'
}

const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export default function WhyTimelineGauge({ events = [], isKey, className = '' }) {
  const { t } = useTranslation()
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)

  // 🪤 First cut drew one tick per event. At 260+ events over 48h that is ~1.5px
  // each — a solid red/green barcode that shows nothing. Bin by HOUR instead:
  // bar height = how much happened, tint = net direction of that hour, amber if
  // the hour contains a key event. Density is the question this answers.
  const { bins, ticks, max } = useMemo(() => {
    const now = Date.now()
    const start = now - WINDOW_H * HOUR
    const bins = Array.from({ length: WINDOW_H }, (_, i) => ({
      t0: start + i * HOUR,
      n: 0, bull: 0, bear: 0, key: false, top: null, topImp: -1,
    }))
    for (const e of events || []) {
      if (!Number.isFinite(e?.at) || e.at < start || e.at > now) continue
      const i = Math.min(WINDOW_H - 1, Math.floor((e.at - start) / HOUR))
      const b = bins[i]
      b.n += 1
      const tone = toneOf(e)
      if (tone === 'bull') b.bull += 1
      else if (tone === 'bear') b.bear += 1
      const isK = typeof isKey === 'function' ? !!isKey(e) : false
      if (isK) b.key = true
      const imp = isK ? 99 : (Number(e.importance) || 0)
      if (imp > b.topImp) { b.topImp = imp; b.top = e }
    }
    const max = bins.reduce((m, b) => Math.max(m, b.n), 0)

    // one label every 12h + the day boundary, so a phone still gets anchors
    const ticks = []
    for (let i = 0; i < WINDOW_H; i++) {
      const d = new Date(bins[i].t0)
      const h = d.getHours()
      if (h % 12 !== 0) continue
      const pct = (i / WINDOW_H) * 100
      // the right edge belongs to the "now" marker — a label there collides
      if (pct > 90) continue
      ticks.push({
        pct,
        label: h === 0 ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '12:00',
        major: h === 0,
      })
    }
    return { bins, ticks, max }
  }, [events, isKey])

  if (!max) return null

  return (
    <div className={`wtg ${className}`.trim()} ref={wrapRef}>
      <div className="wtg-head">
        <span className="wtg-title">{t('whyGauge.whytimelinegauge.last48Hours', "Last 48 hours")}</span>
        <span className="wtg-count">{bins.reduce((a, b) => a + b.n, 0)} events</span>
      </div>

      <div className="wtg-track" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <span key={`g-${t.pct}`} className={`wtg-grid${t.major ? ' major' : ''}`} style={{ left: `${t.pct}%` }} />
        ))}
        {bins.map((b, i) => {
          const tone = b.key ? 'key' : b.bull > b.bear ? 'bull' : b.bear > b.bull ? 'bear' : 'neu'
          // sqrt so a single busy hour cannot flatten the rest of the window
          const h = b.n ? Math.max(12, Math.round(Math.sqrt(b.n / max) * 100)) : 0
          return (
            <span
              key={b.t0}
              className={`wtg-bin wtg-bin--${tone}${b.n ? '' : ' is-empty'}`}
              style={{ left: `${(i / WINDOW_H) * 100}%`, width: `${100 / WINDOW_H}%`, height: `${h}%` }}
              onMouseEnter={() => b.n && setHover(b)}
              title={b.n ? `${hhmm(b.t0)} · ${b.n} event${b.n > 1 ? 's' : ''}` : ''}
            />
          )
        })}
        <span className="wtg-now" />
      </div>

      <div className="wtg-axis">
        {ticks.map((t) => (
          <span key={`l-${t.pct}`} className={`wtg-axis-l${t.major ? ' major' : ''}`} style={{ left: `${t.pct}%` }}>{t.label}</span>
        ))}
        <span className="wtg-axis-now">{t('whyGauge.whytimelinegauge.now', "now")}</span>
      </div>

      {hover ? (
        <div className="wtg-read"><b>{hhmm(hover.t0)}</b> {hover.n} event{hover.n > 1 ? 's' : ''}{hover.top ? ` · ${String(hover.top.text).slice(0, 72)}` : ''}</div>
      ) : (
        <div className="wtg-read wtg-read--idle">Each bar is one hour of gated events — taller means more happened.</div>
      )}
    </div>
  )
}
