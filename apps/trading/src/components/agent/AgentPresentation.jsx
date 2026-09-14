/**
 * AgentPresentation - the voice overlay's stage. While the agent talks, it
 * does NOT mirror his prose (no captions, no karaoke - "we don't need
 * that"); it PRESENTS the data he is talking about, like an analyst at a
 * screen:
 *
 *   - visual scenes (drawn chart / X account cards) that draw THEMSELVES in
 *     sync with the speech: the demand zone fades in as he says "demand",
 *     the EMA strokes itself as he reaches "the EMA", an account card
 *     materializes as he names the account. Cue timing = proportional char
 *     position of the keyword across the known audio duration.
 *   - a BEAT LABEL under the scene naming what just drew ("DEMAND 0.366",
 *     "@handle · 12.4K followers") - the only text on stage.
 *   - multi-tool turns become a slide deck: scenes swap when the speech
 *     moves to the other tool's territory.
 *   - no visuals at all -> the stat chips (extracted figures, timed to the
 *     voice) carry the stage alone.
 *
 * While 'thinking', a just-arrived chart plays its candle intro ("preparing
 * the slide"); zones/EMA wait for the words. Leaving 'speaking' (barge-in,
 * done) snaps everything fully drawn - never a frozen half-chart.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import AgentChartCard from './AgentChartCard'
import AgentXActivityCard, { AgentXPostCard, featuredAccounts } from './AgentXActivityCard'
import { extractCues, extractStats } from './presentationCues'
import { traceMark, traceCues, traceActive } from '../../lib/agentSyncTrace'
import './AgentPresentation.css'

const RAMP_MS = {
  candles: 700, 'zones-supply': 550, 'zones-demand': 550, ema: 900, vwap: 400,
  header: 300, timeline: 700, price: 1400, volume: 900,
}
const rampFor = (key) => RAMP_MS[key] || (key.startsWith('acct-') ? 600 : 500)
const clamp01 = (v) => Math.min(1, Math.max(0, v))
// Minimum stage time per slide: the volume interlude earns a real look
// (live feedback: "appeared but just for a second").
const holdFor = (key) => (key === 'volume' ? 3_500 : 1_400)

/** Keep the PREVIOUS value alive for `ms` after a change - the outgoing
    layer of the dual-layer transitions (scenes cross-fade, the beat label
    ticker-morphs) without an animation library. */
function useOutgoing(current, ms) {
  const prevRef = useRef(current)
  const [out, setOut] = useState(null)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = current
    if (prev != null && current !== prev) {
      setOut(prev)
      const id = setTimeout(() => setOut((o) => (o === prev ? null : o)), ms)
      return () => clearTimeout(id)
    }
    return undefined
  }, [current, ms])
  return out
}

/** The slide deck inside one scene. Chart = a single slide. X activity =
    the overview, then the featured POSTS: shortly after the voice names an
    account, its actual post takes the stage (text + photo) - the screen
    keeps moving with the story instead of sitting on one card. */
function buildSlides(scene) {
  const slides = [{ key: 'main', at: 0 }]
  if (scene.visual.kind === 'chart') {
    // Volume interlude: when the voice reaches "volume", the stage swaps
    // to daily volume bars; it hands BACK to the price chart at the next
    // chart element he talks about (zone/EMA/price), or stays if volume
    // closes the analysis.
    const volCue = scene.cues.find((c) => c.key === 'volume')
    if (volCue) {
      slides.push({ key: 'volume', at: Math.min(0.96, volCue.at + 0.02), volume: true })
      const after = scene.cues
        .filter((c) => ['zones-demand', 'zones-supply', 'ema', 'vwap', 'price'].includes(c.key) && c.at > volCue.at + 0.05)
        .sort((a, b) => a.at - b.at)[0]
      if (after) slides.push({ key: 'main-return', at: after.at, mainReturn: true })
      slides.sort((a, b) => a.at - b.at)
    }
  }
  if (scene.visual.kind === 'x_activity') {
    const cueAt = {}
    for (const c of scene.cues) cueAt[c.key] = c.at
    const posts = scene.visual.posts
    if (posts?.length) {
      // The deck = the posts the voice ACTUALLY talks about (matched cues).
      // The rail may carry 6 posts for a 3-post answer - staged fillers for
      // unspoken posts must not flip through at the end (flight-recorder
      // finding: posts 3-6 strobing across the speech tail, out of order).
      // Nothing matched at all -> stage the first three as a fallback.
      const staged = {}
      for (const c of scene.cues) if (c.key.startsWith('post-')) staged[c.key] = c.staged === true
      const anyMatched = Object.entries(staged).some(([, s]) => !s)
      posts.forEach((p, i) => {
        const key = `post-${i}`
        if (anyMatched && staged[key]) return
        if (!anyMatched && i >= 3) return
        const at = cueAt[key]
        slides.push({ key, at: Math.min(0.96, (Number.isFinite(at) ? at : 0.4) + 0.04), post: p })
      })
    } else {
      // Legacy visuals (persisted sessions): per-account featured posts.
      featuredAccounts(scene.visual, 3).forEach((a, i) => {
        const cue = cueAt[`acct-${a.handle.toLowerCase()}`]
        const at = Number.isFinite(cue) ? Math.min(0.96, cue + 0.12) : 0.55 + i * 0.15
        slides.push({ key: `post-${a.handle.toLowerCase()}`, at, account: a })
      })
    }
    slides.sort((a, b) => a.at - b.at)
  }
  return slides
}

export default function AgentPresentation({ text, durationMs, visuals, state, symbol, getProgress }) {
  const clean = String(text || '').trim()
  const speaking = state === 'speaking' && !!clean
  const thinking = state === 'thinking'
  const total = Math.max(1500, Number(durationMs) || clean.length * 62)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  const list = useMemo(() => (Array.isArray(visuals) ? visuals : []), [visuals])

  // Cues per scene, anchor-ordered (the slide order the speech will follow).
  const scenes = useMemo(
    () => list
      .map((visual, arrival) => ({ visual, arrival, ...extractCues(clean, visual) }))
      .sort((a, b) => a.anchor - b.anchor || a.arrival - b.arrival),
    [clean, list],
  )
  const stats = useMemo(() => (list.length || !clean ? [] : extractStats(clean)), [clean, list.length])

  /* Speech progress clock. When the voice engine provides its LIVE position
     (audio.currentTime / webspeech word boundaries) that is the ONLY truth -
     no wall-clock guessing, so the visuals cannot outrun a slow synthesis
     fetch or lag a fast fallback voice. Wall-clock estimate only when no
     live source exists (should not happen on the voice stage). */
  const getProgressRef = useRef(getProgress)
  getProgressRef.current = getProgress
  const [now, setNow] = useState(0)
  const nowRef = useRef(0)
  nowRef.current = now
  const slideHoldRef = useRef({ key: null, shownAt: 0 })
  const lastSlideRef = useRef(null) // the actual slide OBJECT last rendered while speaking
  const lastBeatRef = useRef(null)

  // TURN BOUNDARY: a new reply must never render one frame against the
  // previous turn's clock. The setNow(0) re-render is NOT enough on its
  // own: THIS render still computes with the stale `now` and its side
  // effects (slideHoldRef, traces) stick - the flight recorder caught the
  // hold latching the previous turn's slide for a full 1.4s. So the reset
  // also OVERRIDES the clock locally for the current render (nowEff).
  const prevCleanRef = useRef(clean)
  let nowEff = now
  if (prevCleanRef.current !== clean) {
    prevCleanRef.current = clean
    // Reset only for a NEW reply - the reply->'' transition at speech end
    // must keep the slide hold (the stage freezes on what was showing,
    // instead of recomputing and flipping cards as the voice stops).
    if (clean) {
      slideHoldRef.current = { key: null, shownAt: 0 }
      lastSlideRef.current = null
      lastBeatRef.current = null
      nowEff = 0
      if (now !== 0) setNow(0)
    }
  }
  useEffect(() => {
    if (reduced) { setNow(1); return undefined }
    if (!speaking) {
      // EPILOGUE GLIDE: a boundary-less voice can finish ahead of the
      // estimated clock, leaving late cues unfired (flight recorder: the
      // supply zone at 0.942 POPPED at speech end). Instead of snapping
      // to 1, glide the clock home - remaining elements draw in order
      // with their normal ramps, a graceful finish.
      const from = nowRef.current
      if (from >= 0.98 || from <= 0) { setNow(1); return undefined }
      const start = performance.now()
      let raf = 0
      const tick = () => {
        const k = Math.min(1, (performance.now() - start) / 700)
        setNow(from + (1 - from) * k)
        if (k < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }
    const start = performance.now()
    setNow(0)
    let raf = 0
    let lastSample = 0
    const tick = () => {
      const live = getProgressRef.current?.()
      const p = getProgressRef.current
        ? (live != null ? live : 0) // audio not started yet -> hold, don't guess
        : (performance.now() - start) / total
      setNow(Math.min(1, Math.max(0, p)))
      // Flight-recorder sample every ~500ms: the progress curve vs wall time.
      if (traceActive() && performance.now() - lastSample > 500) {
        lastSample = performance.now()
        traceMark('progress', { p: Number(Math.min(1, Math.max(0, p)).toFixed(3)) })
      }
      raf = requestAnimationFrame(tick) // run the whole speaking phase (live source can start late)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean, total, speaking])

  /* Image warm-up: pfps and post photos start downloading the moment a
     visual lands (usually while the agent is still thinking) so a slide
     never pops text-first with its picture trailing in seconds later. */
  const warmedRef = useRef(new Set())
  useEffect(() => {
    const urls = []
    for (const v of list) {
      for (const a of v.accounts || []) urls.push(a.pfp, a.top?.image)
      for (const p of v.posts || []) urls.push(p.pfp, p.image)
    }
    for (const url of urls) {
      if (typeof url !== 'string' || warmedRef.current.has(url)) continue
      warmedRef.current.add(url)
      const im = new Image()
      im.referrerPolicy = 'no-referrer'
      im.src = url
    }
  }, [list])

  /* Intro clock - a newly arrived scene sweeps its base in (candles) even
     before the speech starts. Floor for the cue-driven candle reveal. */
  const [intro, setIntro] = useState(0)
  const introKeyRef = useRef(null)
  const newestVisual = list[list.length - 1] || null
  useEffect(() => {
    if (!newestVisual || reduced) { setIntro(1); return undefined }
    if (introKeyRef.current === newestVisual) return undefined
    introKeyRef.current = newestVisual
    const start = performance.now()
    setIntro(0)
    let raf = 0
    const tick = () => {
      const p = (performance.now() - start) / 700
      setIntro(Math.min(1, p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestVisual])

  if (!scenes.length && !stats.length) return null

  /* Active scene: while speaking, the one whose cue territory the voice is
     in; while thinking, the newest arrival ("preparing the slide"); after,
     the last slide stays up fully drawn. */
  let scene = null
  if (scenes.length) {
    if (thinking) scene = scenes.reduce((a, b) => (b.arrival > a.arrival ? b : a))
    else if (speaking) {
      scene = scenes[0]
      for (const s of scenes) if (s.anchor <= nowEff + 0.02) scene = s
    } else scene = scenes[scenes.length - 1]
  }

  /* Reveal map for the active scene. `liveStage` covers speaking AND the
     epilogue glide - cue ramps keep driving until the clock is home. */
  const liveStage = !reduced && !!clean && (speaking || nowEff < 1) && !thinking
  let reveal = null
  let beat = null
  if (scene) {
    reveal = {}
    if (liveStage) {
      const nowMs = nowEff * total
      for (const c of scene.cues) {
        reveal[c.key] = clamp01((nowMs - c.at * total) / rampFor(c.key))
        if (c.label && reveal[c.key] > 0.1) beat = c.label
      }
      reveal.candles = Math.max(reveal.candles ?? 0, intro)
      reveal.header = Math.max(reveal.header ?? 0, intro)
    } else if (thinking && !reduced) {
      reveal = { candles: intro, header: intro }
    } else {
      for (const c of scene.cues) reveal[c.key] = 1
      reveal.candles = 1
      reveal.header = 1
    }
  }

  /* Flight recorder: beat-label changes (what the stage SAID it was
     showing, with the live progress at that moment). */
  if (speaking && beat !== lastBeatRef.current) {
    lastBeatRef.current = beat
    if (beat && traceActive()) traceMark('beat_change', { label: beat, progress: Number(nowEff.toFixed(3)) })
  }

  /* The slide within the scene: overview first, then the posts as the
     speech reaches them; thinking always shows the assembling overview.
     A slide holds the stage for a MINIMUM beat even when cues cluster -
     the deck advances, it never strobes. */
  const tracedCuesRef = useRef('')
  let slide = null
  if (scene) {
    const slides = buildSlides(scene)
    if (speaking && traceActive() && tracedCuesRef.current !== clean) {
      tracedCuesRef.current = clean
      traceCues(scene.cues)
    }
    // NOTE: slide advancement stays gated on `speaking`, NOT liveStage - the
    // epilogue glide finishes DRAWING on the frozen last slide (reveal ramps
    // run via liveStage) but never flips cards after the voice stops.
    if (thinking) slide = slides[0]
    else if (speaking) {
      slide = slides[0]
      for (const s of slides) if (s.at <= nowEff) slide = s
      const hold = slideHoldRef.current
      if (hold.key && hold.key !== slide.key && performance.now() - hold.shownAt < holdFor(hold.key)) {
        const held = slides.find((s) => s.key === hold.key)
        if (held) slide = held
      }
      if (slideHoldRef.current.key !== slide.key) {
        slideHoldRef.current = { key: slide.key, shownAt: performance.now() }
        if (speaking && traceActive()) {
          traceMark('slide_change', { key: slide.key, cueAt: Number.isFinite(slide.at) ? Number(slide.at.toFixed(3)) : null, progress: Number(nowEff.toFixed(3)) })
        }
      }
      lastSlideRef.current = slide
    } else {
      // Post-speech: FREEZE on the actual last slide OBJECT rendered while
      // speaking. Re-deriving from the empty-text cue recompute loses
      // matched-only slides entirely (flight-recorder finding: a volume
      // slide cued in the final second snapped back to the price chart).
      slide = lastSlideRef.current || slides[slides.length - 1]
    }
  }

  /* Dual-layer transitions: the outgoing slide stays mounted for a beat,
     drifting up + blurring out while the new one rises in - a real scene
     change, not a card popping into existence. */
  const sceneKey = scene && slide ? `${scene.visual.kind}-${scene.visual.resolution || ''}-${slide.key}` : null
  const descRef = useRef({})
  if (sceneKey) descRef.current[sceneKey] = { scene, slide }
  const outKey = useOutgoing(sceneKey, 360)
  const outDesc = !reduced && outKey && outKey !== sceneKey ? descRef.current[outKey] : null
  const prevBeat = useOutgoing(beat, 280)

  const renderSlide = (s, sl, rv) => (sl.post || sl.account ? (
    <AgentXPostCard post={sl.post} account={sl.account} />
  ) : (
    <>
      {s.visual.kind === 'chart' && <AgentChartCard visual={s.visual} symbol={symbol} reveal={rv} view={sl.volume ? 'volume' : 'price'} />}
      {s.visual.kind === 'x_activity' && <AgentXActivityCard visual={s.visual} symbol={symbol} reveal={rv} />}
    </>
  ))
  const fullRevealFor = (s) => {
    const r = { candles: 1, header: 1 }
    for (const c of s.cues) r[c.key] = 1
    return r
  }

  /* Directional swap WITHIN the chart scene: price slides out left as
     volume rides in from the right, and the reverse on the way back - the
     interlude reads as a page turn, not a card replacement. */
  const volSwap = slide?.key === 'volume' ? 'fwd' : outKey?.endsWith('-volume') ? 'back' : null
  const outDirCls = volSwap === 'fwd' ? ' sapres__scene--out-left' : volSwap === 'back' ? ' sapres__scene--out-right' : ''
  const inDirCls = volSwap === 'fwd' ? ' sapres__scene--in-right' : volSwap === 'back' ? ' sapres__scene--in-left' : ''

  return (
    <div className="sapres">
      {scene && slide && (
        <div className="sapres__stage">
          {outDesc && (
            <div className={`sapres__scene sapres__scene--out${outDirCls}`} key={`out-${outKey}`} aria-hidden="true">
              {renderSlide(outDesc.scene, outDesc.slide, fullRevealFor(outDesc.scene))}
            </div>
          )}
          <div className={`sapres__scene${inDirCls}`} key={sceneKey}>
            {renderSlide(scene, slide, reveal)}
          </div>
        </div>
      )}
      {/* The beat slot is ALWAYS reserved while a scene is up - unmounting
          it at speech end reflowed the center-justified stage and made the
          chart lurch ("looked like a crash", live report). */}
      {scene && (
        <div className="sapres__beatwrap">
          {liveStage && prevBeat && prevBeat !== beat && !reduced && (
            <div className="sapres__beat sapres__beat--out" key={`o-${prevBeat}`} aria-hidden="true">{prevBeat}</div>
          )}
          {liveStage && beat && <div className="sapres__beat" key={beat}>{beat}</div>}
        </div>
      )}
      {!scene && speaking && stats.length > 0 && (
        <div className="sapres__stats">
          {stats.map((s) => {
            const revealed = reduced || nowEff >= (s.frac ?? s.at / Math.max(1, clean.length)) * 0.92
            return (
              <div key={s.label} className={`sapres__chip${revealed ? ' is-on' : ''}`}>
                <span className="sapres__chip-value">{s.value}</span>
                <span className="sapres__chip-label">{s.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
