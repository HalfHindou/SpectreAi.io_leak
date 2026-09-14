/**
 * KOL PROJECT BUBBLES — the immersive endorsement field (the profile centerpiece).
 *
 * A large, packed, gently-drifting bubble field of the KOL's endorsed projects.
 * Each bubble:
 *   - SIZE  by market_cap (log scale, clamped min/max so micro-caps stay tappable
 *           and a $40B name doesn't swallow the field).
 *   - FILL / RING by health.tone (green=alive · amber=cooling · red=dead · grey=unknown)
 *           via --bull / --amber / --bear. This is the ONE KOL surface where
 *           bull/bear accents are correct — project health is genuinely up/down.
 *   - LOGO  centered (falls back to $SYM text), $SYM + compact market cap under it.
 *   - HOVER surfaces a rich card: name, market cap, 24h + 7d change (signed/colored),
 *           ATH drawdown, and — when the project is also a tracked CALL — the
 *           entry→now multiple + alpha vs BTC.
 *   - CLICK opens the project drawer (onOpenProject(cg_id)).
 *
 * Motion: a cheap rAF spring-pack settles the bubbles into a non-overlapping
 * cluster, then each drifts on its own slow sine so the field feels ALIVE without
 * a physics lib. The rAF is guarded on `document.hidden` and self-parks once the
 * pack has settled (drift continues on a slow shared phase, near-zero cost).
 *
 * Pure-ish presentational: takes `endorsements` + `calls` (to enrich tracked
 * bubbles) + onOpenProject. Numbers tabular mono (.xd-num). Prefix: kpb-.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fmtUsd } from '../../x-dash-utils'

/* tone → modifier class. Unknown / missing health reads as muted grey. */
const TONE_CLASS = {
  green: 'kpb-bubble--green',
  amber: 'kpb-bubble--amber',
  red: 'kpb-bubble--red',
  grey: 'kpb-bubble--grey',
}

const STATE_LABEL = {
  alive: { key: 'kolRadar.health.alive', fallback: 'Alive' },
  cooling: { key: 'kolRadar.health.cooling', fallback: 'Cooling' },
  dead: { key: 'kolRadar.health.dead', fallback: 'Dead' },
  unknown: { key: 'kolRadar.health.unknown', fallback: 'No data' },
}

/* market_cap → pixel diameter on a log scale, but the MIN/MAX band is derived
   from how much room each bubble actually has in the (now compact) card. The
   field is a content-sized compartment, not a viewport-tall hero — so with few
   projects we grow the bubbles to FILL it (3-8 endorsements read large, not 4
   dots in a void); with many we shrink them so they still pack and stay
   scannable. `band` ({min,max}) is computed once per render from the container
   area ÷ count (see fieldBand).

   weight (how hard they pushed) nudges size when cap is missing so the field
   doesn't flatten into same-size circles for unranked endorsements. */
function bubbleSize(marketCap, weight, band) {
  const MIN = band.min
  const MAX = band.max
  const mc = Number(marketCap)
  if (Number.isFinite(mc) && mc > 0) {
    // log-lerp $1M..$50B into MIN..MAX.
    const lo = Math.log10(1e6)
    const hi = Math.log10(5e10)
    const t = Math.max(0, Math.min(1, (Math.log10(mc) - lo) / (hi - lo)))
    return Math.round(MIN + t * (MAX - MIN))
  }
  // no cap → fall back to weight (0..1.6) into the lower half of the band.
  const w = Number(weight)
  const safe = Number.isFinite(w) && w > 0 ? Math.max(0.2, Math.min(1.6, w)) : 0.5
  return Math.round(MIN + (safe / 1.6) * (MAX - MIN) * 0.55)
}

/* Derive the bubble diameter band {min,max} that FILLS the field for `count`
   bubbles in a `w×h` box. Idea: give each bubble an equal share of the area,
   take the diameter of a circle covering ~62% of that share (packing leaves
   gaps), then clamp into a sane absolute range. Fewer bubbles → bigger share →
   bigger MAX, so a 3-8 project field looks full instead of empty. The MIN is a
   readable floor scaled off MAX so the cap-label still fits. */
function fieldBand(count, w, h) {
  const n = Math.max(1, count)
  const area = Math.max(1, w * h)
  // area each bubble can claim; 0.62 packing efficiency leaves drift room.
  const perBubble = (area / n) * 0.62
  const dia = 2 * Math.sqrt(perBubble / Math.PI)
  // guardrails for a NORMAL column card: never a giant blob (cap ~120px and
  // ~62% of the card height so 2-4 bubbles still fit), never an untappable dot.
  const max = Math.round(Math.max(58, Math.min(120, dia, h * 0.62)))
  const min = Math.round(Math.max(44, max * 0.46))
  return { min, max: Math.max(max, min + 8) }
}

function fmtChange(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toFixed(1)}%`
}
function changeTone(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}
/* entry→now multiple → "5.2x" / "0.30x". */
function fmtX(x) {
  const n = Number(x)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 100) return `${Math.round(n)}x`
  if (n >= 1) return `${n.toFixed(1)}x`
  return `${n.toFixed(2)}x`
}
/* alpha vs BTC (pp) → "+28pp" / "−12pp". */
function fmtAlpha(pp) {
  const n = Number(pp)
  if (!Number.isFinite(n)) return null
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(Math.round(n))}pp`
}

/* Deterministic pseudo-random in [0,1) from a seed — stable drift phases per
   bubble across renders (no Math.random in render). */
function seeded(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export default function KolProjectBubbles({ endorsements, calls, onOpenProject }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  // measured field box → drives the fill-to-card bubble band. Seeded with a
  // sane desktop guess so first paint is close before the observer fires.
  const [box, setBox] = useState({ w: 880, h: 280 })
  const fieldRef = useRef(null)
  const rafRef = useRef(0)
  const simRef = useRef(null)

  /* index calls by cg_id so a bubble that's also a tracked call surfaces its
     entry→now multiple + alpha in the hover card. */
  const callIndex = useMemo(() => {
    const map = new Map()
    ;(Array.isArray(calls) ? calls : []).forEach((c) => {
      if (c && c.cg_id) map.set(c.cg_id, c)
    })
    return map
  }, [calls])

  /* normalize + sort by market cap (biggest first → reads large→small). Size is
     applied separately (below) once we know the count + measured box. */
  const items = useMemo(() => {
    const list = (Array.isArray(endorsements) ? endorsements : [])
      .filter((e) => e && (e.symbol || e.name))
      .map((e, i) => {
        const health = e.health || {}
        return {
          key: e.cg_id || e.symbol || `e${i}`,
          cgId: e.cg_id || null,
          sym: e.symbol ? `$${String(e.symbol).toUpperCase()}` : (e.name || '?'),
          name: e.name || e.symbol || '',
          logo: e.image || e.image_small || e.image_url || null,
          marketCap: Number(health.market_cap),
          weight: e.weight,
          change24h: health.change24h,
          change7d: health.change7d,
          athChange: health.ath_change,
          state: health.state,
          tone: TONE_CLASS[health.tone] || TONE_CLASS.grey,
          call: e.cg_id ? callIndex.get(e.cg_id) || null : null,
        }
      })
    return list.sort((a, b) => (Number(b.marketCap) || 0) - (Number(a.marketCap) || 0))
  }, [endorsements, callIndex])

  const CAP = 28
  const visible = showAll ? items : items.slice(0, CAP)
  const hidden = items.length - visible.length

  /* derive the fill-the-card diameter band from the count actually shown + the
     measured box, then stamp each bubble's size. Recomputes when the visible
     set or the box changes → few projects = big bubbles, no void. */
  const shown = useMemo(() => {
    const band = fieldBand(visible.length, box.w, box.h)
    return visible.map((it) => ({ ...it, size: bubbleSize(it.marketCap, it.weight, band) }))
  }, [visible, box.w, box.h])

  /* measure the field box (ResizeObserver) so the band tracks the real card. */
  useEffect(() => {
    const el = fieldRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      setBox((prev) => {
        const w = Math.round(r.width)
        const h = Math.round(r.height)
        return (prev.w === w && prev.h === h) ? prev : { w, h }
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // re-pack signature — repulsion settle must re-run when the diameters change
  // (box resize → new band), not just when the count changes.
  const sizeSig = shown.map((it) => it.size).join(',')

  /* ---- drift / spring-pack simulation ----
     Place bubbles on a grid-ish seeded scatter, then a few frames of soft
     repulsion settle them into a non-overlapping cluster. After settle, each
     drifts on its own slow sine (shared phase) so the field breathes. The rAF
     parks when document.hidden and re-arms on visibility. */
  useEffect(() => {
    const el = fieldRef.current
    if (!el || shown.length === 0) return undefined

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const W = el.clientWidth || 900
    const Hbase = el.clientHeight || 360
    // seed positions: spiral-ish scatter weighted to center.
    const bodies = shown.map((it, i) => {
      const a = seeded(i + 1) * Math.PI * 2
      const r = (0.18 + 0.62 * seeded(i + 7)) * Math.min(W, Hbase) * 0.5
      return {
        r: it.size / 2,
        x: W / 2 + Math.cos(a) * r,
        y: Hbase / 2 + Math.sin(a) * r,
        vx: 0,
        vy: 0,
        phase: seeded(i + 13) * Math.PI * 2,
        amp: 3 + seeded(i + 19) * 5,
        speed: 0.4 + seeded(i + 23) * 0.5,
      }
    })

    let settleFrames = 0
    const MAX_SETTLE = 220
    let start = performance.now()

    const step = () => {
      if (document.hidden) {
        rafRef.current = 0
        return
      }
      const w = el.clientWidth || W
      const h = el.clientHeight || Hbase
      const now = performance.now()
      const tSec = (now - start) / 1000

      const settling = settleFrames < MAX_SETTLE
      if (settling) {
        // pairwise soft repulsion
        for (let i = 0; i < bodies.length; i++) {
          const a = bodies[i]
          for (let j = i + 1; j < bodies.length; j++) {
            const b = bodies[j]
            let dx = b.x - a.x
            let dy = b.y - a.y
            let d = Math.hypot(dx, dy) || 0.01
            const min = a.r + b.r + 6
            if (d < min) {
              const push = (min - d) / d * 0.5
              dx *= push; dy *= push
              a.vx -= dx; a.vy -= dy
              b.vx += dx; b.vy += dy
            }
          }
          // gentle pull to center so the cluster stays packed, not exploded
          a.vx += (w / 2 - a.x) * 0.0016
          a.vy += (h / 2 - a.y) * 0.0016
        }
        for (const bd of bodies) {
          bd.vx *= 0.86; bd.vy *= 0.86
          bd.x += bd.vx; bd.y += bd.vy
          // clamp inside field
          bd.x = Math.max(bd.r + 2, Math.min(w - bd.r - 2, bd.x))
          bd.y = Math.max(bd.r + 2, Math.min(h - bd.r - 2, bd.y))
        }
        settleFrames++
      }

      // write transforms: settled base position + slow drift sine (drift off
      // under reduced-motion — bubbles still pack, just don't breathe).
      const nodes = el.querySelectorAll('.kpb-bubble')
      for (let i = 0; i < bodies.length && i < nodes.length; i++) {
        const bd = bodies[i]
        const driftX = reduceMotion ? 0 : Math.sin(tSec * bd.speed + bd.phase) * bd.amp
        const driftY = reduceMotion ? 0 : Math.cos(tSec * bd.speed * 0.8 + bd.phase) * bd.amp
        const px = bd.x - bd.r + driftX
        const py = bd.y - bd.r + driftY
        nodes[i].style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`
      }
      // under reduced-motion, park the rAF once packed — no perpetual drift loop.
      if (reduceMotion && !settling) {
        rafRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }

    simRef.current = { restart: () => { start = performance.now() } }
    rafRef.current = requestAnimationFrame(step)

    const onVis = () => {
      if (!document.hidden && !rafRef.current) {
        simRef.current?.restart()
        rafRef.current = requestAnimationFrame(step)
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      document.removeEventListener('visibilitychange', onVis)
    }
    // re-pack when the visible set changes (showAll toggle / new data) OR when
    // the diameters change (box resize re-derives the fill-the-card band).
  }, [shown.length, showAll, sizeSig])

  if (items.length === 0) {
    return (
      <p className="kpb-empty">
        {t('kolRadar.bubbles.empty', 'No tracked endorsements for this KOL yet.')}
      </p>
    )
  }

  return (
    <div className="kpb">
      <div className="kpb-field" ref={fieldRef}>
        {shown.map((it, i) => {
          const mc = fmtUsd(it.marketCap)
          const c24 = fmtChange(it.change24h)
          const c7 = fmtChange(it.change7d)
          const ath = fmtChange(it.athChange)
          const stateMeta = STATE_LABEL[it.state] || STATE_LABEL.unknown
          const call = it.call
          const callX = call ? fmtX(call.current_x) : null
          const callAlpha = call ? fmtAlpha(call.alpha_pct) : null
          const labelSize = Math.max(9, Math.round(it.size * 0.155))

          return (
            <button
              type="button"
              key={it.key}
              className={`kpb-bubble ${it.tone}`}
              style={{
                width: it.size,
                height: it.size,
                // sim writes the real translate() on the first rAF frame (~16ms);
                // the opacity fade-in covers that frame so there's no corner-stack.
                animationDelay: `${Math.min(i * 24, 380)}ms`,
              }}
              onClick={() => it.cgId && onOpenProject && onOpenProject(it.cgId)}
              disabled={!it.cgId}
              aria-label={`${it.sym}${mc ? ` · ${mc}` : ''} · ${t(stateMeta.key, stateMeta.fallback)}`}
            >
              <span className="kpb-bubble__disc">
                {it.logo ? (
                  <img
                    className="kpb-bubble__logo"
                    src={it.logo}
                    alt=""
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                ) : (
                  <span className="kpb-bubble__sym xd-num" style={{ fontSize: labelSize }}>{it.sym}</span>
                )}
                <span className="kpb-bubble__cap">
                  <span className="kpb-bubble__cap-sym xd-num" style={{ fontSize: Math.max(8, labelSize - 1) }}>{it.sym}</span>
                  {mc && <span className="kpb-bubble__cap-mc xd-num">{mc}</span>}
                </span>
              </span>

              {/* rich hover card */}
              <span className="kpb-card" role="presentation">
                <span className="kpb-card__head">
                  {it.logo && <img className="kpb-card__logo" src={it.logo} alt="" loading="lazy" />}
                  <span className="kpb-card__id">
                    <span className="kpb-card__sym xd-num">{it.sym}</span>
                    {it.name && it.name !== it.sym && <span className="kpb-card__name">{it.name}</span>}
                  </span>
                  <span className={`kpb-card__state kpb-card__state--${it.state || 'unknown'}`}>
                    {t(stateMeta.key, stateMeta.fallback)}
                  </span>
                </span>

                <span className="kpb-card__rows">
                  <span className="kpb-card__row">
                    <span className="kpb-card__k">{t('kolRadar.bubbles.mcap', 'Market cap')}</span>
                    <span className="kpb-card__v xd-num">{mc || '—'}</span>
                  </span>
                  <span className="kpb-card__row">
                    <span className="kpb-card__k">{t('kolRadar.bubbles.c24', '24h')}</span>
                    <span className={`kpb-card__v xd-num kpb-card__v--${changeTone(it.change24h)}`}>{c24 || '—'}</span>
                  </span>
                  <span className="kpb-card__row">
                    <span className="kpb-card__k">{t('kolRadar.bubbles.c7', '7d')}</span>
                    <span className={`kpb-card__v xd-num kpb-card__v--${changeTone(it.change7d)}`}>{c7 || '—'}</span>
                  </span>
                  {ath && (
                    <span className="kpb-card__row">
                      <span className="kpb-card__k">{t('kolRadar.bubbles.ath', 'From ATH')}</span>
                      <span className="kpb-card__v xd-num kpb-card__v--down">{ath}</span>
                    </span>
                  )}
                </span>

                {call && (callX || callAlpha) && (
                  <span className="kpb-card__call">
                    <span className="kpb-card__call-cap">{t('kolRadar.bubbles.theirCall', 'Their call')}</span>
                    {callX && (
                      <span className={`kpb-card__call-x xd-num kpb-card__call-x--${Number(call.current_x) >= 1 ? 'up' : 'down'}`}>{callX}</span>
                    )}
                    {callAlpha && (
                      <span className={`kpb-card__call-alpha xd-num kpb-card__call-alpha--${Number(call.alpha_pct) >= 0 ? 'up' : 'down'}`}>
                        {callAlpha} {t('kolRadar.bubbles.vsBtc', 'vs BTC')}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="kpb-foot">
        <div className="kpb-legend" aria-hidden="true">
          <span className="kpb-legend__item"><span className="kpb-legend__dot kpb-legend__dot--green" />{t('kolRadar.health.alive', 'alive')}</span>
          <span className="kpb-legend__item"><span className="kpb-legend__dot kpb-legend__dot--amber" />{t('kolRadar.health.cooling', 'cooling')}</span>
          <span className="kpb-legend__item"><span className="kpb-legend__dot kpb-legend__dot--red" />{t('kolRadar.health.dead', 'dead')}</span>
          <span className="kpb-legend__hint">{t('kolRadar.bubbles.sizeHint', 'size = market cap')}</span>
        </div>
        {hidden > 0 && !showAll && (
          <button type="button" className="kpb-more" onClick={() => setShowAll(true)}>
            {t('kolRadar.bubbles.more', '+{{count}} more', { count: hidden })}
          </button>
        )}
        {showAll && items.length > CAP && (
          <button type="button" className="kpb-more" onClick={() => setShowAll(false)}>
            {t('kolRadar.bubbles.less', 'Show less')}
          </button>
        )}
      </div>
    </div>
  )
}
