/**
 * agentSyncTrace - the voice/visual sync flight recorder. Every reply turn
 * records TWO timelines against one wall clock:
 *
 *   VOICE:  speak() called -> tts fetched -> sound ACTUALLY started ->
 *           word boundaries / segment starts -> speech end
 *   STAGE:  cue table computed -> each slide/beat change (with the live
 *           progress at that moment) -> periodic progress samples
 *
 * So "the Sunny post appeared 5s late" becomes a diffable record: WHEN the
 * voice reached Sunny (boundary charIndex) vs WHEN the slide switched
 * (progress + wall time) vs where the cue THOUGHT it should fire.
 *
 * Inspect in DevTools:
 *   __agentSyncTrace.dump()      - readable table of the last turn
 *   __agentSyncTrace.dump(2)     - two turns back
 *   __agentSyncTrace.turns       - raw ring buffer (last 6, also persisted
 *                                  to localStorage across reloads)
 *   __agentSyncTrace.live(true)  - console.debug every event as it happens
 *
 * A compact per-turn summary also goes to PostHog (Agent Voice Sync) so
 * drift shows up in analytics, not just anecdotes.
 */
import { track, Events } from '../services/analytics'

const LS_KEY = 'spectre-agent-synctrace-v1'
const LIVE_KEY = 'spectre-agent-sync-live'
const MAX_TURNS = 6
const MAX_EVENTS = 400
// Bump on every sync-behavior change: a dump whose rev is behind the code
// means the tab ran STALE code (hard-refresh) - ends the guessing.
const SYNC_REV = 'r11-speak-fallback-reasons'

let turns = []
try { turns = JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { turns = [] }
let current = null

const now = () => Math.round(performance.now())
const liveOn = () => { try { return localStorage.getItem(LIVE_KEY) === '1' } catch { return false } }

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(turns.slice(-MAX_TURNS))) } catch { /* quota */ }
}

/** Begin a reply turn's trace. Called by useVoiceSession when reply speech
    starts assembling. Ends any dangling turn first. */
export function traceStart({ text, path, symbol } = {}) {
  if (current) traceEnd({ interrupted: true })
  current = {
    startedAt: new Date().toISOString(),
    rev: SYNC_REV,
    t0: now(),
    symbol: symbol || null,
    path: path || 'unknown', // chirp-single | chirp-pipelined | webspeech
    textLen: String(text || '').length,
    textHead: String(text || '').slice(0, 80),
    events: [],
    cues: null,
  }
  traceMark('turn_start')
}

/** Record one event on the active turn: { t (ms since turn start), type, ...data } */
export function traceMark(type, data) {
  if (!current) return
  if (current.events.length >= MAX_EVENTS) return
  const evt = { t: now() - current.t0, type, ...(data || {}) }
  current.events.push(evt)
  if (liveOn()) {
    // eslint-disable-next-line no-console
    console.debug(`[agent-sync +${evt.t}ms] ${type}`, data || '')
  }
}

/** Which voice engine actually carried the turn (known only once playback
    resolves): chirp-single | chirp-pipelined | webspeech. */
export function tracePath(path) {
  if (current) current.path = path
}

/** The cue table the presentation computed for this turn (planned timings). */
export function traceCues(cues) {
  if (!current) return
  current.cues = (cues || []).map((c) => ({ key: c.key, at: Number(c.at?.toFixed?.(3) ?? c.at), label: c.label || undefined }))
  traceMark('cues_computed', { count: current.cues.length })
}

/** Close the turn: derive the summary, persist, ship the analytics event. */
export function traceEnd(extra) {
  if (!current) return
  traceMark('turn_end', extra)
  const ev = current.events
  const find = (type) => ev.find((e) => e.type === type)
  const soundStart = find('sound_start')
  const speechEnd = find('speech_end')
  const slides = ev.filter((e) => e.type === 'slide_change')
  current.summary = {
    path: current.path,
    startDelayMs: soundStart ? soundStart.t : null, // speak() -> first audible sound
    speechMs: soundStart && speechEnd ? speechEnd.t - soundStart.t : null,
    boundaries: ev.filter((e) => e.type === 'boundary_first').length,
    slidesShown: slides.length,
    // Per slide: planned cue fraction vs the live progress when it switched.
    // driftFrac > 0 = the slide came LATER than its cue (progress had passed
    // it - usually the 1.4s hold); the wall gap vs voice is in the raw events.
    slideDrift: slides.map((s) => ({
      key: s.key,
      plannedAt: s.cueAt ?? null,
      progressAtShow: s.progress ?? null,
      driftFrac: Number.isFinite(s.cueAt) && Number.isFinite(s.progress) ? Number((s.progress - s.cueAt).toFixed(3)) : null,
    })),
    ...(extra || {}),
  }
  turns.push(current)
  turns = turns.slice(-MAX_TURNS)
  persist()
  const s = current.summary
  track(Events.AGENT_VOICE_SYNC, {
    path: s.path,
    startDelayMs: s.startDelayMs,
    speechMs: s.speechMs,
    slidesShown: s.slidesShown,
    maxSlideDrift: s.slideDrift.reduce((m, d) => Math.max(m, Math.abs(d.driftFrac ?? 0)), 0),
    textLen: current.textLen,
    interrupted: !!extra?.interrupted,
  })
  current = null
}

export const traceActive = () => !!current

/* DevTools handle */
if (typeof window !== 'undefined') {
  window.__agentSyncTrace = {
    get turns() { return turns },
    live(v) { try { localStorage.setItem(LIVE_KEY, v ? '1' : '0') } catch { /* no ls */ } return v ? 'live logging on' : 'off' },
    dump(back = 0) {
      const t = turns[turns.length - 1 - back]
      if (!t) return 'no trace recorded'
      // eslint-disable-next-line no-console
      console.groupCollapsed(`[agent-sync ${t.rev || 'pre-rev'}] ${t.startedAt} ${t.path} "${t.textHead}"`)
      // eslint-disable-next-line no-console
      if (t.cues) console.table(t.cues)
      // eslint-disable-next-line no-console
      console.table(t.events)
      // eslint-disable-next-line no-console
      if (t.summary) console.log('summary:', t.summary)
      // eslint-disable-next-line no-console
      console.groupEnd()
      return t.summary || t
    },
  }
}
