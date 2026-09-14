/**
 * Band C — the tide. Placed FIRST because it is the h1's evidence: the
 * headline says the Fed drained $119B, and this band is where the reader
 * checks that claim.
 *
 * Shape: a signed magnitude bar off a centre zero rule, on a FIXED ±$300B
 * scale. Fixed matters — a bar auto-scaled to its own value always looks
 * dramatic, and a four-week liquidity change of $30B would draw the same
 * picture as one of $300B. The scale ends are printed so the reader can see
 * what the bar is a fraction of.
 */
import React, { useEffect, useRef } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { isAppActive } from '@/lib/idleManager'
import { WstBand, WstHead, WstNone, WstFoot } from './wst-band'
import useInView from './use-in-view'
import { fmtSignedUsdB, fmtUsdB, fmtLongDay, toNum } from './wst-format'

const SCALE_B = 300

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The tank — the same signed bar, running as liquid.
 *
 * ENCODING IS UNCHANGED: the body still reaches `mag` (|chg| ÷ $300B) of the
 * half-width, on the same side of the same zero rule. The wave is a two-layer
 * sine on the LEADING EDGE only — it never lengthens or shortens the body, so
 * the quantity the bar states is exactly the quantity the CSS bar stated. The
 * figure is not drawn here: it stays in the DOM column beside the tank where a
 * reader can select it.
 *
 * Costs: 30fps, capped at DPR 2, and it stops on all three of tab-hidden,
 * scrolled-out (its own observer — the band's useInView fires once and
 * disconnects) and the app-wide 5-minute idle. Under prefers-reduced-motion
 * the tank is never mounted; the settled CSS bar renders instead.
 */
function TideTank({ mag, neg }) {
  const cvRef = useRef(null)
  const dayMode = useSettingsStore((s) => s.dayMode)

  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return undefined
    const ctx = cv.getContext('2d')
    if (!ctx) return undefined

    let raf = null
    let last = 0
    let level = 0
    let t = 0
    let onScreen = false
    let w = 0
    let h = 0
    let dpr = 1
    let color = '#ef4444'
    const dir = neg ? -1 : 1

    const readColor = () => {
      const v = getComputedStyle(cv).getPropertyValue(neg ? '--wst-bear' : '--wst-bull').trim()
      if (v) color = v
    }

    const size = () => {
      const r = cv.getBoundingClientRect()
      if (!r.width || !r.height) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      const nw = Math.max(1, Math.round(r.width * dpr))
      const nh = Math.max(1, Math.round(r.height * dpr))
      // Only ever assign when it actually changed: writing canvas.width
      // reallocates the backing store even for an identical value, which
      // flickers on mobile.
      if (nw !== cv.width) cv.width = nw
      if (nh !== cv.height) cv.height = nh
      w = r.width
      h = r.height
    }

    const surface = (y, phase, a1, a2) => (
      Math.sin(y * 0.17 + t * 1.7 + phase) * a1
      + Math.sin(y * 0.33 - t * 2.6 + phase * 1.7) * a2
    )

    const body = (x1, phase, a1, a2) => {
      const top = 3
      const bot = h - 3
      ctx.beginPath()
      ctx.moveTo(w / 2, top)
      ctx.lineTo(w / 2, bot)
      const step = 4
      for (let y = bot; y >= top; y -= step) ctx.lineTo(x1 + surface(y, phase, a1, a2), y)
      ctx.lineTo(x1 + surface(top, phase, a1, a2), top)
      ctx.closePath()
    }

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (level <= 0.001) return
      const x1 = w / 2 + dir * level * (w / 2)

      ctx.save()
      ctx.beginPath()
      // clipped to the tank wall so the wave can never spill past the track
      const r = 7
      ctx.moveTo(r, 0)
      ctx.arcTo(w, 0, w, h, r)
      ctx.arcTo(w, h, 0, h, r)
      ctx.arcTo(0, h, 0, 0, r)
      ctx.arcTo(0, 0, w, 0, r)
      ctx.closePath()
      ctx.clip()

      ctx.fillStyle = color
      // back layer: the slower, deeper swell
      ctx.globalAlpha = 0.34
      body(x1 - dir * 2.5, 1.9, 2.6, 1.1)
      ctx.fill()
      // front layer: the body proper, holding the true magnitude
      ctx.globalAlpha = 0.66
      body(x1, 0, 2.1, 0.9)
      ctx.fill()
      // the meniscus
      ctx.globalAlpha = 0.9
      ctx.lineWidth = 1.5
      ctx.strokeStyle = color
      ctx.beginPath()
      const top = 3
      const bot = h - 3
      ctx.moveTo(x1 + surface(bot, 0, 2.1, 0.9), bot)
      for (let y = bot; y >= top; y -= 4) ctx.lineTo(x1 + surface(y, 0, 2.1, 0.9), y)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.restore()
    }

    const loop = (now) => {
      raf = null
      if (!onScreen || document.hidden || !isAppActive()) return
      if (now - last < 33) { raf = requestAnimationFrame(loop); return }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt
      level += (mag - level) * Math.min(1, dt * 3.4)
      draw()
      raf = requestAnimationFrame(loop)
    }

    const kick = () => { if (raf == null && onScreen) { last = performance.now() - 34; raf = requestAnimationFrame(loop) } }

    readColor()
    size()

    const ro = new ResizeObserver(() => { size(); draw() })
    ro.observe(cv)
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[0]?.isIntersecting !== false
      if (onScreen) kick()
    }, { threshold: 0.05 })
    io.observe(cv)
    const onVis = () => { if (!document.hidden) kick() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      if (raf != null) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [mag, neg, dayMode])

  return <canvas className="wst-tank" ref={cvRef} aria-hidden="true" />
}

export default function WstTide({ liq, changed }) {
  const { ref, inView } = useInView()
  const chg = toNum(liq?.chg_4w_usd_b)
  const level = toNum(liq?.usd_b)
  const asOf = fmtLongDay(liq?.as_of)
  const trend = typeof liq?.trend === 'string' ? liq.trend : null
  const has = chg != null || level != null

  const mag = chg == null ? 0 : Math.min(Math.abs(chg) / SCALE_B, 1)
  const neg = (chg ?? 0) < 0

  return (
    <WstBand id="wst-tide" label="Net liquidity" changed={changed}>
      <WstHead
        eyebrow="Net liquidity"
        sub={trend ? `${trend} · four weeks` : 'four weeks'}
        meta={asOf ? `as of ${asOf}` : null}
        changed={changed}
      />

      {!has ? (
        <WstNone>No liquidity read on file.</WstNone>
      ) : (
        <div className="wst-tide" ref={ref}>
          <div className="wst-tide-l">
            {trend && <span className="wst-trend">{trend}</span>}
            {/* The figure stays in ink: colour lives in the bar beside it.
                A display-size number in red is an alarm, not a record. */}
            <span className="wst-fig wst-num">
              {fmtSignedUsdB(chg) ?? '—'}
            </span>
            <span className="wst-tide-sub wst-num">
              four weeks{level != null ? ` · level ${fmtUsdB(level)}` : ''}
            </span>
          </div>

          <div className={`wst-tide-r${inView ? ' is-in' : ''}`}>
            <div className="wst-bar" role="img"
              aria-label={`${fmtSignedUsdB(chg)} on a plus or minus $${SCALE_B}B scale`}>
              {chg != null && !REDUCED && <TideTank mag={mag} neg={neg} />}
              <span className="wst-bar-zero" aria-hidden="true" />
              {chg != null && REDUCED && (
                <span
                  className={`wst-bar-fill${neg ? ' is-bear' : ' is-bull'}`}
                  style={{ '--mag': mag }}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="wst-bar-scale wst-num" aria-hidden="true">
              <span>{`−$${SCALE_B}B`}</span>
              <span>0</span>
              <span>{`+$${SCALE_B}B`}</span>
            </div>
          </div>
        </div>
      )}

      {liq?.note && <p className="wst-note">{liq.note}</p>}
      <WstFoot>
        WALCL minus the Treasury General Account minus reverse repo. Weekly H.4.1
        {asOf ? `, as of ${asOf}` : ''}.
      </WstFoot>
    </WstBand>
  )
}
