/**
 * Band A½ — THE WORLD ENGINE.
 *
 * The host for the armillary scene: a fallback switch, the WebGL lifecycle,
 * and the instrument plate that sits on top of it. Every frame belongs to
 * wst-engine-scene.js; React renders this band once per edition and never
 * again, which is why the version stamp is DOM and the ring labels are not.
 *
 * ── THE FALLBACK IS THE WHOLE PAGE, UNCHANGED ─────────────────────────────
 * prefers-reduced-motion, or no WebGL context: this component returns null and
 * the document reads exactly as it did before — masthead, diff strip, seven
 * bands. The hero is an ADDITION to a page that was already complete, never a
 * dependency of it. Nothing below is gated on it and nothing here duplicates a
 * number the bands do not already print.
 *
 * ── WHY THE SCENE IS A DYNAMIC IMPORT ─────────────────────────────────────
 * three is ~900KB raw. The page is already lazy-routed, but a static import
 * would still put three in the world-state chunk and make every reader pay for
 * it — including the reduced-motion reader who will never see a frame. The
 * import fires inside the mount effect, after the two guards, so it is
 * downloaded only by a reader who is actually going to get a hero. This is the
 * cosmos rule (`check-critical-path.mjs` fences the boot path; the guards here
 * fence the page).
 *
 * ── THE INSTRUMENT PLATE ──────────────────────────────────────────────────
 * The version stamp lives ON the scene, in the corner, like the plate on a
 * measuring instrument. When the edition increments during a session the whole
 * engine takes one slow bright revolution — the heartbeat the masthead states
 * in words, shown as machinery.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'
import { WstBand, WstHead, WstFoot } from './wst-band'
import { fmtUtc, fmtLongDay, fmtVol, fmtYes, toNum } from './wst-format'

/** Both fallback conditions, evaluated once. */
function canRender() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/* The rings are told apart by RADIUS, not by colour — colour on this page is
   reserved for direction — so the key numbers them outermost-first instead of
   handing out four decorative swatches. */
const RINGS = [
  { n: 1, label: 'Net liquidity' },
  { n: 2, label: 'FOMC' },
  { n: 3, label: 'CME positioning' },
  { n: 4, label: 'Stablecoin float' },
]

/** The richest rate market — rule 3 of the ladder: money, never probability. */
function topRateMarket(doc) {
  const rows = Array.isArray(doc?.rates?.odds) ? doc.rates.odds : []
  let best = null
  for (const r of rows) {
    if (!r?.q) continue
    const v = toNum(r.vol_usd_m)
    if (v == null || v < 1) continue // a thin or unpriced book states nothing
    if (!best || v > toNum(best.vol_usd_m)) best = r
  }
  return best
}

export default function WstEngine({ doc, version, ts }) {
  const supported = useMemo(canRender, [])
  const hostRef = useRef(null)
  const engineRef = useRef(null)
  const appliedRef = useRef(undefined)
  const [live, setLive] = useState(false)
  const dayMode = useSettingsStore((s) => s.dayMode)

  /* ── engine lifecycle ── */
  useEffect(() => {
    if (!supported) return undefined
    const host = hostRef.current
    if (!host) return undefined

    let cancelled = false
    let teardown = null

    import('./wst-engine-scene')
      .then(({ WorldEngine }) => {
        if (cancelled || !hostRef.current) return
        const isMobile = window.matchMedia?.('(max-width: 768px)')?.matches
        const engine = new WorldEngine(host, {
          isMobile,
          dayMode: useSettingsStore.getState().dayMode,
        })
        engineRef.current = engine
        host.__worldEngine = engine // dev handle, harmless in prod
        setLive(true)

        const ro = new ResizeObserver(() => engine.resize())
        ro.observe(host)
        // Off-screen is stopped, not throttled: this band is the top of a long
        // document and spends most of a reading session out of view.
        const io = new IntersectionObserver(
          (entries) => engine.setRunning(entries[0]?.isIntersecting !== false),
          { threshold: 0.02 },
        )
        io.observe(host)
        // A visible but abandoned tab still costs GPU. Same 5-minute idle stop
        // the cosmos uses, waking on the first real interaction.
        const idle = setInterval(() => { if (!isAppActive()) engine.setRunning(false) }, 30_000)
        const unsub = subscribeActivity(() => { if (!engine.running) engine.setRunning(true) })

        teardown = () => {
          clearInterval(idle)
          unsub?.()
          ro.disconnect()
          io.disconnect()
          delete host.__worldEngine
          engine.dispose()
          engineRef.current = null
        }
      })
      .catch(() => { /* no hero; the document below is untouched */ })

    return () => {
      cancelled = true
      teardown?.()
      setLive(false)
    }
  }, [supported])

  /* Data in — once per EDITION, never per render. A new version also fires the
     revolution sweep, but only when this tab actually held the previous one. */
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const prev = appliedRef.current
    if (prev !== undefined && prev === version) return
    engine.setDoc(doc)
    if (prev !== undefined && prev !== null && version !== prev) engine.pulse()
    appliedRef.current = version ?? null
  }, [doc, version, live])

  useEffect(() => { engineRef.current?.setDayMode(dayMode) }, [dayMode, live])

  if (!supported) return null

  const top = topRateMarket(doc)
  const nl = toNum(doc?.net_liquidity?.chg_4w_usd_b)
  const alt = [
    'A rotating armillary of four macro forces.',
    nl != null ? `Net liquidity ${nl < 0 ? 'draining' : 'adding'} on the outer ring.` : null,
    doc?.rates?.next_fomc ? `FOMC ${fmtLongDay(doc.rates.next_fomc)} on the second.` : null,
    'CME positioning on the third, the stablecoin float at the centre.',
    'Every figure is printed in the bands below.',
  ].filter(Boolean).join(' ')

  return (
    <WstBand id="wst-engine" label="World engine" className="wst-band--engine">
      <WstHead
        eyebrow="The engine"
        sub="four forces, one instrument"
        meta={version != null ? `v${version}` : null}
      />

      <div className="wste">
        <div className="wste-stage" ref={hostRef} role="img" aria-label={alt} />

        {/* instrument plate — the version stamp lives ON the scene */}
        <div className="wste-plate" aria-hidden="true">
          <span className="wste-plate-v wst-num">{version != null ? `v${version}` : 'v—'}</span>
          {ts && <span className="wste-plate-t wst-num">{fmtUtc(ts)}</span>}
          {ts && <span className="wste-plate-d">{fmtLongDay(ts)}</span>}
        </div>

        {/* the key that decodes the art — four rings, outermost first */}
        <ul className="wste-key" aria-hidden="true">
          {RINGS.map((r) => (
            <li key={r.n} className="wste-key-li">
              <span className="wste-key-n wst-num">{r.n}</span>
              {r.label}
            </li>
          ))}
        </ul>

        {/* the money's opinion on the ring-2 meeting, by volume — the full
            question stays in the DOM because it does not fit a sprite, and a
            price without its question is not a fact */}
        {top && (
          <div className="wste-mkt">
            <span className="wste-mkt-v wst-num">{fmtYes(top.yes_pct, top.vol_usd_m)}</span>
            <span className="wste-mkt-q" title={top.q}>{top.q}</span>
            <span className="wste-mkt-n wst-num">{fmtVol(top.vol_usd_m)}</span>
          </div>
        )}
      </div>

      <WstFoot>
        Ring one is the four-week net-liquidity change on the same fixed ±$300B
        scale the tide band prints, drawn to the left of its zero mark when
        draining. Ring two is the time left to the next FOMC over a six-week
        inter-meeting cycle — the cycle is assumed, the days and the date are
        reported. Ring three is CME leveraged funds against asset managers,
        thickness as a share of open interest and spin direction as the sign of
        each net. The inner band is the stablecoin float, breathing outward on a
        positive week. Radii, particle count and spin SPEED are fixed and mean
        nothing. A force with no report renders as a still, dim ring.
      </WstFoot>
    </WstBand>
  )
}
