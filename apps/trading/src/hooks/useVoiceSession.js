/**
 * useVoiceSession - the Jarvis open-dialog loop (ChatGPT-voice-mode style):
 * listen (Web Speech STT) -> send the transcript through the EXISTING agent
 * chat lane (mode:'voice') -> synthesize the reply (/api/agent/speak,
 * Chirp3-HD Charon - the same voice as the brief) -> play -> listen again,
 * until the user ends the session.
 *
 * Ported from the research rz-agent-chat voice mode with its known bugs
 * fixed at the source:
 *   - sendRef updated EVERY render: the loop always calls the live
 *     chat.send (the rz loop closed over first-render state - voice turns
 *     carried no history and stale token data).
 *   - stoppingRef (useChartVoiceControl pattern): intentional stops never
 *     auto-restart recognition.
 *   - TTS safety timeouts on both the MP3 and webspeech paths (a browser
 *     that never fires onended must not freeze the loop).
 *   - SR failures are STATES, not silence: not-allowed -> blocked;
 *     network/audio-capture -> one retry then a spoken, visible end.
 *   - idle auto-end: a forgotten session must not loop Chrome's
 *     server-backed recognition forever.
 *
 * Half-duplex by design (the mic is never live while the agent speaks -
 * that is also the echo control); tap the orb mid-speech to interrupt.
 * Serialization: chat.send()'s settle-always Promise is the turn lock -
 * re-listen only arms after BOTH the send settled and playback ended.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePrivySafe } from '../lib/use-privy-safe'
import { bluetoothAudioActive, refreshBluetoothAudio } from '../lib/audioRoute'
import { getGreeting, deriveAccountName, humanizeName } from '../lib/greeting'
import { spokenFrac } from '../components/agent/presentationCues'
import { traceStart, traceMark, traceEnd, tracePath } from '../lib/agentSyncTrace'
import useSettingsStore from '../store/useSettingsStore'
import { track, Events } from '../services/analytics'

const SRCls = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
export const voiceSessionSupported = () => !!SRCls

// Module-level session flag: the v1 brief auto-speak (useAgentVoice) must
// never talk over a live conversation - two Jarvises is one too many.
let _sessionLive = false
export const isVoiceSessionLive = () => _sessionLive

// Wake-word entry: the launcher marks the wake so the session opens with a
// short cached personal ack instead of the full greeting. Consumed once by
// startSession. Module-level like _sessionLive - the launcher and the
// session hook live in different trees.
let _wakeQuickAck = false
export const markWakeTriggered = () => { _wakeQuickAck = true }

/** The wake acknowledgment line - ONE definition so the launcher's pre-warm
    and the session opener always agree on the exact string (cache hit =
    instant playback; a mismatch means a live synthesis the wake can't wait
    for). Personal, short: "Hey Gleb. Listening." */
export const wakeAckLine = (name) => (name ? `Hey ${name}. Listening.` : 'Hey. Listening.')

/* ── Speech blob cache - MODULE level so the wake-word launcher can pre-warm
      lines BEFORE any session exists ("Yes?" + the greeting are local by
      the time anyone says "Hey Spectre"). Bounded; object URLs revoked on
      eviction and on session unmount (re-warmed on the next wake arm). ── */
const _speechBlobCache = new Map() // clean text -> object URL
function _cacheSpeechBlob(clean, url) {
  if (_speechBlobCache.size >= 24) {
    const oldest = _speechBlobCache.keys().next().value
    try { URL.revokeObjectURL(_speechBlobCache.get(oldest)) } catch { /* gone */ }
    _speechBlobCache.delete(oldest)
  }
  _speechBlobCache.set(clean, url)
}

/** Standalone speech warm/fetch (no hook state): -> { url } | { fallback:
    true } | { error: true }. Used by fetchSpeechUrl inside the session AND
    by the launcher's wake-arm pre-warm. */
export async function warmSpeechLine(clean, getAccessToken, signal) {
  const hit = _speechBlobCache.get(clean)
  if (hit) return { url: hit }
  let accessToken = null
  try { accessToken = await getAccessToken?.() } catch { /* fall through */ }
  // Every fallback carries WHY - the flight recorder marks it, so a
  // webspeech turn is diagnosable from the dump (no-token vs 401 vs 429
  // are three different bugs that all used to look identical).
  if (!accessToken) {
    traceMark('speak_fallback', { why: 'no-token', text: clean.slice(0, 40) })
    return { fallback: true, why: 'no-token' }
  }
  try {
    const res = await fetch('/api/agent/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ text: clean }),
      signal: signal && AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(9_000)]) : AbortSignal.timeout(9_000),
    })
    if (res.status === 503) {
      const j = await res.json().catch(() => null)
      if (j?.fallback === 'webspeech') {
        traceMark('speak_fallback', { why: 'server-503-webspeech' })
        return { fallback: true, why: 'server-503' }
      }
      return { error: true }
    }
    if (!res.ok) {
      traceMark('speak_fallback', { why: `http-${res.status}`, text: clean.slice(0, 40) })
      return { fallback: true, why: `http-${res.status}` }
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    _cacheSpeechBlob(clean, url)
    return { url }
  } catch (e) {
    if (e?.name === 'AbortError') return { error: true }
    traceMark('speak_fallback', { why: `fetch-${e?.name || 'error'}` })
    return { fallback: true, why: 'fetch-error' }
  }
}

const MAX_NO_SPEECH = 3     // "still there?" after this many silent listens
const MAX_IDLE_LISTENS = 6  // spoken sign-off + auto-end after this many
const RELISTEN_MS = 600     // gap between agent speech ending and mic re-arm

/* ── Barge-in semantics: interrupt on CONTENT, not noise. A cough or a
      whisper must never cut the agent off (live-test feedback) - only an
      explicit interrupt command, or a couple of substantial words that are
      NOT part of the agent's own script (self-echo filter). ── */
const INTERRUPT_RE = /\b(stop|wait|hold on|hang on|pause|enough|shut up|never mind|one sec|be quiet)\b/i

const _words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)

/** Substantial (3+ char) words in the transcript that do not appear in the
    text the agent is currently speaking - the speaker-echo discriminator. */
export function novelWordCount(transcript, script) {
  const scriptSet = new Set(_words(script))
  return _words(transcript).filter((w) => w.length >= 3 && !scriptSet.has(w)).length
}

export const isReliableInterrupt = (transcript, script) =>
  INTERRUPT_RE.test(String(transcript || '')) || novelWordCount(transcript, script) >= 2

/* ── The flowing-conversation layer: instant spoken acknowledgments while
      the real answer computes, and bridge lines when tool rounds run long.
      Dry-wit persona, SHORT (the answer must not wait on the filler). ── */
const fillerPool = (name) => [
  'Hm. Good question.',
  name ? `Good question, ${name}.` : 'Fair question.',
  'Interesting. One second.',
  'Let me look.',
  'Hm, let me check that.',
  'On it.',
  'Give me a beat.',
  'Let me pull that up.',
  name ? `Sure, ${name}. Checking.` : 'Sure. Checking.',
]

const BRIDGE_BY_TOOL = {
  get_x_intel: 'Scanning the X chatter now.',
  get_x_profile: 'Pulling up that account now.',
  get_event_price_impact: 'Cross-checking their posts against price.',
  get_bars_summary: 'Reading the chart.',
  get_security: 'Running the contract scan.',
  get_token_snapshot: 'Pulling the latest numbers.',
  get_wallet_balances: 'Checking your wallet.',
}
const BRIDGES = ['Still on it - one more second.', 'Almost there.', 'Bear with me - crunching it.']
const BRIDGE_AFTER_MS = 8_000

/** Rank the browser voices - QUALITY first (live feedback: the local
    Microsoft voices sound robotic; "we had better voice before"). The
    remote Google voices fire no word-boundary events, but the calibrated
    wall-rate (below) carries sync well enough on the fallback path -
    Chirp is the primary voice, this only covers its bad days. */
function preferredWebVoice() {
  try {
    const voices = window.speechSynthesis?.getVoices() || []
    const ranked = ['Google UK English Male', 'Daniel', 'Google US English', 'Microsoft Mark', 'Microsoft Guy', 'Aaron', 'Alex', 'Microsoft David']
    for (const name of ranked) {
      const v = voices.find((x) => x.name?.includes(name))
      if (v) return v
    }
    return voices.find((v) => /en[-_]US/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null
  } catch { return null }
}

// Measured webspeech rate (ms per char), EMA-calibrated from completed
// utterances - the wall-clock sync fallback stops guessing after the first
// spoken line. 85 is the cold-start default; real en voices run 50-75.
let _webMsPerChar = 85
function _calibrateWebRate(chars, ms) {
  if (!chars || !Number.isFinite(ms) || ms < 400) return
  const rate = Math.min(140, Math.max(40, ms / chars))
  _webMsPerChar = Math.round(_webMsPerChar * 0.4 + rate * 0.6)
}

export function useVoiceSession(chat, { tokenSymbol, surface = 'desktop' } = {}) {
  const privy = usePrivySafe()
  const profileName = useSettingsStore((s) => s.profile?.name)

  const [active, setActive] = useState(false)
  // listening | thinking | speaking | blocked | error | idle
  const [state, _setState] = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [lastReply, setLastReply] = useState('')
  const [speechDurationMs, setSpeechDurationMs] = useState(0) // current reply's audio length - drives the speech HUD sync
  const [endReason, setEndReason] = useState(null)
  // Visual stand-in for the wake greeting when Chrome's autoplay policy
  // mutes us (fresh page, zero clicks = no user activation, NO sound is
  // legally possible). Shown on the listening line; cleared on first turn.
  const [ackText, setAckText] = useState('')
  const speakBlockedRef = useRef(false)

  const stateRef = useRef('idle')
  const setState = useCallback((s) => { stateRef.current = s; _setState(s) }, [])

  const activeRef = useRef(false)
  const stoppingRef = useRef(false)
  const recRef = useRef(null)
  const transcriptRef = useRef('')
  const timersRef = useRef(new Set())
  const audioRef = useRef(null)
  const speakAbortRef = useRef(null)
  const noSpeechRef = useRef(0)
  const idleListensRef = useRef(0)
  const srRetryRef = useRef(0)
  const turnBusyRef = useRef(false)

  // The loop must always call the LIVE send (rz's loop closed over the
  // first render - the diagnosed stale-ref bug class).
  const sendRef = useRef(chat.send)
  useEffect(() => { sendRef.current = chat.send })

  // Sentence-1 TTS pre-warm: the reply's first sentence is complete in the
  // STREAM long before the turn settles (tool rounds + the rest of the
  // text). Synthesize it NOW so pipelined playback opens near-instantly -
  // the flight recorder caught 6.1s of dead air on a cold first segment.
  const warmedFirstRef = useRef('')
  useEffect(() => {
    if (!activeRef.current || !turnBusyRef.current) return
    const last = chat.messages[chat.messages.length - 1]
    if (!last?.streaming || !last.text) return
    const m = /^[\s\S]*?[.!?](?=\s)/.exec(last.text)
    const first = m ? m[0].trim() : null
    if (!first || first.length < 12 || warmedFirstRef.current === first) return
    warmedFirstRef.current = first
    fetchSpeechUrl(first).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages])
  const getTokenRef = useRef(privy?.getAccessToken)
  useEffect(() => { getTokenRef.current = privy?.getAccessToken }, [privy?.getAccessToken])
  const toolActivityRef = useRef(null)
  useEffect(() => { toolActivityRef.current = chat.toolActivity }, [chat.toolActivity])

  // Synthesized speech lives in the MODULE-level _speechBlobCache (fillers
  // repeat every turn; the wake pre-warm fills it before sessions exist).
  const sessionNameRef = useRef('')
  const lastFillerRef = useRef(-1)

  const schedule = useCallback((fn, ms) => {
    const id = setTimeout(() => { timersRef.current.delete(id); fn() }, ms)
    timersRef.current.add(id)
    return id
  }, [])

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current.clear()
  }, [])

  // The current speak()'s resolver - stopping audio externally (barge-in,
  // tap-interrupt) must SETTLE the in-flight speak promise immediately, or
  // the awaiting turn hangs until the safety timeout and then re-arms
  // listening over the top of the interruption's fresh recognition.
  const speakFinishRef = useRef(null)

  // LIVE speech position for the presentation sync (0..1 through the
  // current utterance, or null when nothing is playing). Audio path reads
  // audio.currentTime/duration - exact, immune to synthesis latency and
  // pauses; the webspeech fallback reads word-boundary events. The
  // presentation clock trusts THIS over any wall-clock estimate.
  const speechProgressRef = useRef(null)
  const getSpeechProgress = useCallback(() => {
    const fn = speechProgressRef.current
    if (!fn) return null
    try { return fn() } catch { return null }
  }, [])

  // Barge-watch: a recognition instance that runs WHILE the agent speaks,
  // deciding interruption from the TRANSCRIPT (isReliableInterrupt), not
  // raw mic energy. On a qualifying interrupt it is PROMOTED to the live
  // mic, so the interrupting words are already captured - nothing clips.
  const watchRecRef = useRef(null)
  const watchPromotedRef = useRef(false)
  const startBargeWatchRef = useRef(null) // late-bound (defined after runTurn)

  const stopBargeWatch = useCallback(() => {
    if (watchPromotedRef.current) return // it IS the live mic now
    const w = watchRecRef.current
    watchRecRef.current = null
    if (w) { try { w.onend = null; w.onresult = null; w.onerror = null; w.abort() } catch { /* dead */ } }
  }, [])

  const stopAudio = useCallback(() => {
    speakAbortRef.current?.abort()
    speakAbortRef.current = null
    const a = audioRef.current
    if (a) { try { a.onended = null; a.pause(); a.src = '' } catch { /* detached */ } }
    audioRef.current = null
    // Blob URLs live in the bounded session cache (revoked on unmount) -
    // never revoked here, they are reused across turns.
    try { window.speechSynthesis?.cancel() } catch { /* no api */ }
    speakFinishRef.current?.()
  }, [])

  /* Cache-first speech fetch: -> { url } | { fallback: true } | { error: true }.
     Fillers and repeated lines play instantly from the module blob cache. */
  const fetchSpeechUrl = useCallback(
    (clean, signal) => warmSpeechLine(clean, () => getTokenRef.current?.(), signal),
    [],
  )

  const stopRecognition = useCallback(() => {
    stoppingRef.current = true
    try { recRef.current?.abort() } catch { /* dead instance */ }
    recRef.current = null
  }, [])

  /* ── Speaking (resolves when done - the loop's second half-lock).
        opts.bargeWatch=false for short fillers/bridges (too brief to need
        transcript-gated interruption; the tap always works).
        opts.visual=true (reply speech) publishes the audio duration so the
        overlay's speech HUD can pace its reveal to the voice. ── */
  const speak = useCallback((text, { bargeWatch: bargeWatchOpt = true, visual = false } = {}) => new Promise((resolve) => {
    const clean = String(text || '').trim().slice(0, 900)
    if (!clean || !activeRef.current) return resolve()

    // BLUETOOTH GUARD: any open capture during playback flips a BT
    // speaker/headset into the hands-free profile - the agent's voice
    // degrades to call quality ("activates the speaker mode", live
    // report). On BT the barge-watch stays off (tap-to-interrupt still
    // works); refresh the verdict for the NEXT turn in the background.
    const bargeWatch = bargeWatchOpt && !bluetoothAudioActive()
    refreshBluetoothAudio()

    // A bridge line may still be playing when the reply lands - one voice
    // at a time: settle + stop whatever is current before starting.
    stopAudio()

    let settled = false
    let progressFn = null
    // Sync flight recorder: reply speech only (fillers/acks are not turns).
    if (visual) {
      traceStart({ text: clean, path: 'pending', symbol: tokenSymbol })
      if (bargeWatchOpt && !bargeWatch) traceMark('barge_watch_off_bt')
    }
    const finish = () => {
      if (!settled) {
        settled = true
        if (speakFinishRef.current === finish) speakFinishRef.current = null
        if (progressFn && speechProgressRef.current === progressFn) speechProgressRef.current = null
        stopBargeWatch() // no-op when promoted (the watch became the mic)
        if (visual) { traceMark('speech_end'); traceEnd() }
        resolve()
      }
    }
    speakFinishRef.current = finish

    // Webspeech fallback for the text from `base` (0..1 fraction of clean)
    // onward - the whole reply on a full fallback, the remainder when a
    // pipeline segment fails mid-reply.
    const webFallback = (fromChar = 0) => {
      const part = clean.slice(fromChar).trim()
      const base = spokenFrac(clean, fromChar)
      if (!part) return finish()
      try {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(part)
        const v = preferredWebVoice()
        if (v) u.voice = v
        u.rate = 1.0
        u.pitch = 0.95
        u.onend = finish
        u.onerror = (e) => {
          if (e?.error === 'not-allowed') speakBlockedRef.current = true // gesture-gated, silent
          finish()
        }
        // Live position: Chrome fires word boundaries with charIndex - the
        // exact sync source; once ONE fires, trust boundaries exclusively
        // (a wall-clock guess can outrun the real voice). The wall estimate
        // only carries engines that never fire boundary events, and it must
        // NOT tick before the utterance actually STARTS - speechSynthesis
        // can queue for seconds (voices loading), and a clock racing ahead
        // of silence dealt the whole slide deck before the first word.
        let lastChar = 0
        let sawBoundary = false
        let started = false
        let wallStart = 0
        const estMs = Math.max(1500, part.length * _webMsPerChar)
        if (visual) tracePath('webspeech')
        u.onstart = () => {
          if (!started && visual) traceMark('sound_start', { fromChar })
          started = true
          wallStart = performance.now()
        }
        // Calibrate the rate from what ACTUALLY got spoken.
        const uEnd = u.onend
        u.onend = (e) => { if (started) _calibrateWebRate(part.length, performance.now() - wallStart); uEnd?.(e) }
        u.onboundary = (e) => {
          if (Number.isFinite(e?.charIndex)) {
            if (!sawBoundary && visual) traceMark('boundary_first', { charIndex: e.charIndex })
            if (!started && visual) traceMark('sound_start', { fromChar, via: 'boundary' })
            started = true
            sawBoundary = true
            lastChar = e.charIndex
          }
        }
        progressFn = () => {
          if (!started) return base // queued, nothing spoken yet - hold
          return Math.min(1, base + (1 - base) * (sawBoundary
            ? spokenFrac(part, lastChar + 6) // +half word lookahead
            : Math.min(1, (performance.now() - wallStart) / estMs)))
        }
        speechProgressRef.current = progressFn
        window.speechSynthesis.speak(u)
        if (visual && fromChar === 0) setSpeechDurationMs(Math.round(clean.length * _webMsPerChar))
        if (bargeWatch) startBargeWatchRef.current?.(clean)
        // Safety: some browsers never fire onend. Slack covers a delayed
        // utterance start (speechSynthesis can queue for seconds).
        schedule(finish, Math.min(40_000, part.length * 85 + 8_000))
      } catch { finish() }
    }

    // ── Sentence-pipelined path (reply speech): synthesize ALL sentences in
    // parallel, play sentence 1 the moment it lands - time-to-first-word is
    // one short synthesis, not the whole reply's. Segment audio chains
    // seamlessly; progress spans the full reply so the presentation sync
    // needs no knowledge of the segmentation.
    // Short sentences COALESCE into their neighbor (from index 1 - segment
    // 0 stays the raw first sentence so the stream-time pre-warm cache
    // hits): fewer seams = smoother delivery, no choppy one-word segments.
    const rawSentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean)
    const sentences = []
    for (let i = 0; i < rawSentences.length; i++) {
      const prev = sentences[sentences.length - 1]
      if (i >= 2 && prev && prev.length < 70) sentences[sentences.length - 1] = `${prev} ${rawSentences[i]}`
      else sentences.push(rawSentences[i])
    }
    const pipelined = visual && sentences.length > 1

    ;(async () => {
      try {
        const ctrl = new AbortController()
        speakAbortRef.current = ctrl

        if (pipelined) {
          const segs = []
          let cursor = 0
          for (const s of sentences) {
            const at = clean.indexOf(s, cursor)
            segs.push({ text: s, start: at < 0 ? cursor : at })
            cursor = (at < 0 ? cursor : at) + s.length
          }
          traceMark('tts_fetch_start', { segments: segs.length })
          const fetches = segs.map((seg) => fetchSpeechUrl(seg.text, ctrl.signal))
          // Pre-buffer each segment's element the moment its synthesis
          // lands - the chain starts the next segment on an already-decoded
          // player instead of paying element-creation + decode at the seam.
          const preloaded = new Array(segs.length).fill(null)
          fetches.forEach((f, i) => {
            f.then((r) => {
              if (r?.url && !ctrl.signal.aborted) {
                const a = new Audio(r.url)
                a.preload = 'auto'
                preloaded[i] = a
              }
            }).catch(() => {})
          })
          setSpeechDurationMs(Math.round(clean.length * 62)) // provisional; sync rides live progress
          if (bargeWatch) startBargeWatchRef.current?.(clean)
          schedule(finish, Math.min(60_000, clean.length * 90 + 8_000))

          const playSeg = async (i) => {
            try {
              if (settled || ctrl.signal.aborted || !activeRef.current) return finish()
              let r = await fetches[i]
              // A flaky synthesis must not SWITCH THE VOICE mid-reply (live
              // report: "a different man" finished the sentence) - retry the
              // segment once (cheap, md5-cached server-side) before falling
              // to the browser voice.
              if (!r?.url && !r?.error && !ctrl.signal.aborted) r = await fetchSpeechUrl(segs[i].text, ctrl.signal)
              if (settled || ctrl.signal.aborted || !activeRef.current) return finish()
              if (r.error) return finish()
              // Still failing -> speak the REMAINDER via webspeech from this
              // segment's char position (progress stays continuous).
              if (r.fallback || !r.url) return webFallback(segs[i].start)
              const audio = preloaded[i] || new Audio(r.url)
              audioRef.current = audio
              const next = () => { if (i + 1 < segs.length) playSeg(i + 1); else finish() }
              audio.onended = next
              audio.onerror = next
              await audio.play()
              tracePath('chirp-pipelined')
              traceMark(i === 0 ? 'sound_start' : 'seg_start', { seg: i })
              // Spoken-weighted bases: sentence boundaries are EXACT sync
              // anchors in the same weighted space the cue engine uses.
              const base = spokenFrac(clean, segs[i].start)
              const span = spokenFrac(clean, segs[i].start + segs[i].text.length) - base
              progressFn = () => (Number.isFinite(audio.duration) && audio.duration > 0
                ? Math.min(1, base + span * (audio.currentTime / audio.duration))
                : base)
              speechProgressRef.current = progressFn
            } catch (e) {
              if (e?.name === 'NotAllowedError') { speakBlockedRef.current = true; return finish() } // autoplay-blocked
              if (activeRef.current && !settled) webFallback(segs[i].start)
              else finish()
            }
          }
          return playSeg(0)
        }

        if (visual) traceMark('tts_fetch_start', { segments: 1 })
        const r = await fetchSpeechUrl(clean, ctrl.signal)
        if (ctrl.signal.aborted || !activeRef.current) return finish()
        if (r.error) return finish()
        if (r.fallback || !r.url) return webFallback()
        const audio = new Audio(r.url)
        audioRef.current = audio
        audio.onended = finish
        audio.onerror = finish
        try {
          await audio.play()
        } catch (e) {
          // No user activation (wake-word entry on a fresh page): autoplay
          // is blocked and webspeech is equally gesture-gated - settle NOW
          // instead of hanging the session on the safety timer.
          if (e?.name === 'NotAllowedError') { speakBlockedRef.current = true; return finish() }
          throw e
        }
        if (visual) { tracePath('chirp-single'); traceMark('sound_start') }
        // Live position straight off the element - exact regardless of
        // synthesis latency, buffering, or how long the fetch took.
        progressFn = () => (Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.min(1, audio.currentTime / audio.duration)
          : null)
        speechProgressRef.current = progressFn
        if (visual) {
          setSpeechDurationMs(Number.isFinite(audio.duration) && audio.duration > 0
            ? Math.round(audio.duration * 1000)
            : Math.round(clean.length * 62))
        }
        if (bargeWatch) startBargeWatchRef.current?.(clean)
        // Safety: never trust onended alone - duration + slack, else length-derived.
        const safeMs = Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration * 1000 + 2_500
          : Math.min(45_000, clean.length * 90 + 6_000)
        schedule(finish, safeMs)
      } catch {
        if (activeRef.current) webFallback()
        else finish()
      }
    })()
  }), [fetchSpeechUrl, schedule, stopAudio, stopBargeWatch])

  /* Instant acknowledgment while the answer computes - plays only when its
     blob is already cached (a filler must never DELAY the flow); a cache
     miss warms it for the next turn instead. */
  const playFiller = useCallback(async () => {
    const pool = fillerPool(sessionNameRef.current)
    let idx = Math.floor(Math.random() * pool.length)
    if (idx === lastFillerRef.current) idx = (idx + 1) % pool.length
    lastFillerRef.current = idx
    const line = pool[idx]
    if (!_speechBlobCache.has(line)) {
      fetchSpeechUrl(line).catch(() => {}) // warm for next time
      return
    }
    await speak(line, { bargeWatch: false })
  }, [fetchSpeechUrl, speak])

  /* ── Listening ── */
  const startListening = useCallback(() => {
    if (!activeRef.current || !SRCls) return
    if (turnBusyRef.current) return // a turn is still settling - it re-arms
    stopRecognition() // never two instances
    stoppingRef.current = false
    transcriptRef.current = ''
    setTranscript('')
    setState('listening')

    const rec = new SRCls()
    recRef.current = rec
    rec.continuous = false // Chrome's endpointing IS the silence detector
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript || ''
      transcriptRef.current = text
      setTranscript(text)
    }

    rec.onerror = (e) => {
      if (!activeRef.current || stoppingRef.current) return
      if (e.error === 'no-speech') return // onend runs the empty-listen path
      if (e.error === 'aborted') return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setState('blocked')
        endSession('mic-blocked', { silent: true })
        return
      }
      // network / audio-capture: one retry, then a spoken visible end -
      // the rz port swallowed these and stalled on "listening" forever.
      if (srRetryRef.current < 1) {
        srRetryRef.current += 1
        schedule(() => { if (activeRef.current) startListening() }, 800)
      } else {
        endSession('mic-lost', { spoken: 'I lost the microphone - ending voice for now.' })
      }
    }

    rec.onend = () => {
      if (!activeRef.current || stoppingRef.current) return
      srRetryRef.current = 0
      const text = transcriptRef.current.trim()
      if (text) {
        idleListensRef.current = 0
        noSpeechRef.current = 0
        runTurn(text)
        return
      }
      // Empty listen: nudge once, sign off when clearly forgotten.
      idleListensRef.current += 1
      noSpeechRef.current += 1
      if (idleListensRef.current >= MAX_IDLE_LISTENS) {
        endSession('idle', { spoken: "I'll be here when you need me." })
        return
      }
      if (noSpeechRef.current === MAX_NO_SPEECH) {
        ;(async () => {
          setState('speaking')
          await speak('Still there?')
          if (activeRef.current) {
            schedule(() => {
              if (activeRef.current && stateRef.current !== 'listening') startListening()
            }, RELISTEN_MS)
          }
        })()
        return
      }
      schedule(startListening, 300)
    }

    try { rec.start() } catch { schedule(startListening, 500) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, setState, speak, stopRecognition])

  /* Post-speech re-arm: NO-OP when a barge-in already put the mic on -
     re-starting recognition here would clip the interrupting utterance. */
  const armListen = useCallback(() => {
    turnBusyRef.current = false
    schedule(() => {
      if (activeRef.current && stateRef.current !== 'listening') startListening()
    }, RELISTEN_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, startListening])

  /* ── One conversation turn: acknowledge INSTANTLY (cached filler), think,
        bridge aloud if tools run long, then answer. ── */
  const runTurn = useCallback(async (text) => {
    turnBusyRef.current = true
    setAckText('') // the visual wake greeting has served its purpose
    setState('thinking')
    try {
      // Filler + send run CONCURRENTLY - the acknowledgment masks latency,
      // never adds to it.
      const fillerDone = playFiller().catch(() => {})
      let turnSettled = false
      let bridgePromise = null
      schedule(() => {
        if (turnSettled || !activeRef.current) return
        const tool = toolActivityRef.current?.name
        const line = BRIDGE_BY_TOOL[tool] || BRIDGES[Math.floor(Math.random() * BRIDGES.length)]
        bridgePromise = speak(line, { bargeWatch: false }).catch(() => {})
      }, BRIDGE_AFTER_MS)

      const r = await sendRef.current(text, { mode: 'voice' })
      turnSettled = true
      await fillerDone
      if (bridgePromise) await bridgePromise
      if (!activeRef.current) return
      if (r?.status === 'skipped' && r.reason === 'busy') {
        // Prior stream still open (rare - serialization covers the loop's
        // own turns): retry this transcript once instead of eating it.
        schedule(() => {
          ;(async () => {
            const r2 = await sendRef.current(text, { mode: 'voice' })
            if (!activeRef.current) return
            if (r2?.status === 'done' && r2.text) {
              setLastReply(r2.text)
              setState('speaking')
              await speak(r2.text, { visual: true })
            }
            if (activeRef.current) armListen()
          })()
        }, 1200)
        return
      }
      if (r?.status === 'aborted') {
        // Token switch mid-turn: the session survives, next utterance rides
        // the new token's digest.
        if (activeRef.current) armListen()
        return
      }
      if (r?.status === 'error' || (r?.status === 'done' && !r.text)) {
        setState('speaking')
        await speak('Something broke on my end - give me that one again.')
        if (activeRef.current) armListen()
        return
      }
      if (r?.status === 'done') {
        setLastReply(r.text)
        setState('speaking')
        await speak(r.text, { visual: true })
      }
      if (activeRef.current) armListen()
    } catch {
      if (activeRef.current) armListen()
    } finally {
      turnBusyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armListen, playFiller, schedule, setState, speak])

  /* ── Session lifecycle ── */
  const endSession = useCallback((reason = 'user', { spoken, silent } = {}) => {
    if (!activeRef.current) return
    activeRef.current = false
    _sessionLive = false
    watchPromotedRef.current = false
    stopBargeWatch()
    stopRecognition()
    clearTimers()
    setEndReason(reason)
    track(Events.AGENT_VOICE_SESSION, { surface, action: 'end', reason })
    const finish = () => {
      stopAudio()
      setActive(false)
      setState(reason === 'mic-blocked' ? 'blocked' : 'idle')
    }
    if (spoken && !silent) {
      // Speak the sign-off outside the active flag (speak() checks it) -
      // one-shot utterance, then teardown.
      try {
        window.speechSynthesis?.cancel()
        const u = new SpeechSynthesisUtterance(spoken)
        const v = preferredWebVoice()
        if (v) u.voice = v
        u.onend = finish
        u.onerror = finish
        window.speechSynthesis.speak(u)
        setTimeout(finish, 6_000)
      } catch { finish() }
    } else {
      finish()
    }
  }, [clearTimers, setState, stopAudio, stopBargeWatch, stopRecognition, surface])

  const startSession = useCallback(async () => {
    if (activeRef.current || !SRCls) return
    activeRef.current = true
    _sessionLive = true
    stoppingRef.current = false
    noSpeechRef.current = 0
    idleListensRef.current = 0
    srRetryRef.current = 0
    setEndReason(null)
    setLastReply('')
    setActive(true)
    track(Events.AGENT_VOICE_SESSION, { surface, action: 'start', symbol: tokenSymbol })
    // Personal opener (the start tap is the autoplay gesture), then listen.
    // Name: manual profile name wins, else the Privy-account derivation
    // (the store name is empty for most users - the hero's exact logic).
    const name = humanizeName(profileName) || (privy?.authenticated ? deriveAccountName(privy?.user) : '')
    sessionNameRef.current = name
    // Wake-word entry (Siri cadence): a short cached "Yes?" and straight to
    // listening - the wake pre-warm made it local. FAB taps keep the full
    // greeting. The flag is consumed once.
    const quickAck = _wakeQuickAck
    _wakeQuickAck = false
    const opener = quickAck ? wakeAckLine(name) : `${getGreeting(name)} I'm listening.`
    setState('speaking')
    if (quickAck) {
      // Wake entry has NO fresh user gesture - playback may be autoplay-
      // blocked or the pre-warm may have missed. Listening must arm fast
      // regardless: cap the ack wait, and STOP any late audio at the cap so
      // a slow synthesis can never talk over the user's question. With a
      // warm cache the line plays instantly and the cap never trips.
      speakBlockedRef.current = false
      const speakP = speak(opener, { bargeWatch: false })
      const capped = await Promise.race([
        speakP.then(() => false),
        new Promise((r) => schedule(() => r(true), 2_500)),
      ])
      if (capped) {
        // Already talking? Let the short ack FINISH - cutting it mid-word
        // ("Hey Gl-") sounds like a crash (live report). The cap only
        // abandons audio that never started (slow synthesis, blocked).
        const a = audioRef.current
        const playing = (a && !a.paused && a.currentTime > 0) || window.speechSynthesis?.speaking
        if (playing) await speakP
        else stopAudio()
      }
      // Chrome muted us (fresh page, zero clicks) - greet VISUALLY and say
      // how to unlock; the first click anywhere restores sound for good.
      if (speakBlockedRef.current) setAckText(`${opener} Tap once to enable my voice.`)
    } else {
      await speak(opener, { bargeWatch: false })
    }
    // Warm the acknowledgment fillers in the background - by the first
    // question they play instantly from the blob cache.
    for (const line of fillerPool(name).slice(0, 4)) fetchSpeechUrl(line).catch(() => {})
    if (activeRef.current) startListening()
  }, [fetchSpeechUrl, profileName, privy?.authenticated, privy?.user, setState, speak, startListening, surface, tokenSymbol])

  /* The barge-watch: recognition running WHILE the agent speaks. It fires
     only on isReliableInterrupt (an explicit stop-command, or 2+ substantial
     words outside the agent's own script) - a cough, a whisper, or speaker
     bleed transcribes as neither, so the agent keeps talking (live-test
     feedback: energy-VAD interrupted on a cough). On a qualifying interrupt
     the watch is PROMOTED to the live mic: the interrupting words are
     already in its transcript, nothing is clipped. */
  const startBargeWatch = useCallback((script) => {
    if (!activeRef.current || !SRCls) return
    stopBargeWatch()
    watchPromotedRef.current = false
    const rec = new SRCls()
    watchRecRef.current = rec
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript || ''
      if (watchPromotedRef.current) {
        transcriptRef.current = text
        setTranscript(text)
        return
      }
      if (!activeRef.current || stateRef.current !== 'speaking') return
      if (!isReliableInterrupt(text, script)) return
      // Promote: this instance becomes the live mic, mid-utterance.
      watchPromotedRef.current = true
      recRef.current = rec
      stoppingRef.current = false
      transcriptRef.current = text
      setTranscript(text)
      idleListensRef.current = 0
      noSpeechRef.current = 0
      setState('listening')
      stopAudio() // settles the in-flight speak() promise
      turnBusyRef.current = false
    }

    rec.onend = () => {
      if (!activeRef.current) return
      if (watchPromotedRef.current) {
        // It was the live capture: the user finished the interrupting
        // utterance - run the turn on it.
        watchPromotedRef.current = false
        if (watchRecRef.current === rec) watchRecRef.current = null
        if (recRef.current === rec) recRef.current = null
        const text = transcriptRef.current.trim()
        if (text) runTurn(text)
        else schedule(startListening, 300)
        return
      }
      // The watch self-ended while the agent still speaks (Chrome recycles
      // recognitions) - re-arm it for the rest of the speech.
      if (stateRef.current === 'speaking' && watchRecRef.current === rec) {
        watchRecRef.current = null
        schedule(() => {
          if (activeRef.current && stateRef.current === 'speaking') startBargeWatch(script)
        }, 250)
      }
    }

    rec.onerror = () => { /* benign here - hard mic failures surface via the main loop */ }

    try { rec.start() } catch {
      // A prior instance still winding down - retry while speech continues.
      schedule(() => {
        if (activeRef.current && stateRef.current === 'speaking') startBargeWatch(script)
      }, 400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTurn, schedule, setState, startListening, stopAudio, stopBargeWatch])
  startBargeWatchRef.current = startBargeWatch

  /* Barge-in (manual - the orb tap): kill the speech NOW and listen.
     stopAudio settles the in-flight speak promise; clearing turnBusy lets
     startListening through (the turn is over the moment the user cuts in). */
  const bargeIn = useCallback(() => {
    if (!activeRef.current || stateRef.current !== 'speaking') return
    stopBargeWatch() // one SpeechRecognition at a time - clear the watch first
    stopAudio()
    turnBusyRef.current = false
    startListening()
  }, [startListening, stopAudio, stopBargeWatch])

  /* Tap the orb: interrupt mid-speech, or force end-of-utterance while
     listening (send what we have). */
  const tapOrb = useCallback(() => {
    if (!activeRef.current) return
    if (stateRef.current === 'speaking') {
      bargeIn()
    } else if (stateRef.current === 'listening') {
      try { recRef.current?.stop() } catch { /* onend handles it */ }
    }
  }, [bargeIn])

  // Unmount: full teardown (panel closed mid-session).
  useEffect(() => () => {
    activeRef.current = false
    _sessionLive = false
    stoppingRef.current = true
    watchPromotedRef.current = false
    try { watchRecRef.current?.abort() } catch { /* gone */ }
    watchRecRef.current = null
    try { recRef.current?.abort() } catch { /* gone */ }
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current.clear()
    speakAbortRef.current?.abort()
    const a = audioRef.current
    if (a) { try { a.pause(); a.src = '' } catch { /* detached */ } }
    for (const url of _speechBlobCache.values()) URL.revokeObjectURL(url)
    _speechBlobCache.clear()
    try { window.speechSynthesis?.cancel() } catch { /* no api */ }
  }, [])

  return {
    supported: !!SRCls,
    active,
    state,
    stateRef,
    transcript,
    lastReply,
    speechDurationMs,
    getSpeechProgress,
    ackText,
    endReason,
    startSession,
    endSession,
    tapOrb,
    bargeIn,
  }
}
