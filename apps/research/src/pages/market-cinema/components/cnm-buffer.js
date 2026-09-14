/**
 * cnm-buffer — the replay scheduler.
 *
 * PURE: no DOM, no React, no canvas, no timers. Every method takes `now` so the
 * whole thing runs deterministically under `node`. This is the module that
 * makes the integrity claim true — it only ever schedules rows that came off
 * the feed, at their own relative spacing, and it counts (never invents) the
 * ones it drops.
 *
 * Packet §"Replay buffer" and §"Density choreography".
 */

/**
 * DEVIATION (documented, deliberate): the packet writes intensity as
 * `clamp(Σusd_window / rolling20WindowMedian, 0, 1)`. Normalised against its own
 * median, a TYPICAL window scores exactly 1.0 — i.e. the scene would sit pinned
 * at maximum density 50% of the time, which is the opposite of "quiet state is
 * the design". The denominator is therefore scaled: full intensity means a
 * window carrying 4× the median window's notional. A median window now reads
 * 0.25 (calm), and the packet's own `intensity < 0.5` exhale gate becomes
 * "below 2× median", which is the sentence it was clearly written to mean.
 */
const CASCADE_MULTIPLE = 4

const MEDIAN_WINDOWS = 20
const RECENT_KEEP_MS = 180000    // rolling log behind the cascade narration
const SEEN_KEEP = 1200           // dedupe ring — bounded, ~2 polls of a 500-row page

/** Round a raw dollar figure UP to a readable 2-significant-figure step. */
export function niceFloor(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1)
  return Math.ceil(n / mag) * mag
}

function median(list) {
  if (!list.length) return 0
  const s = list.slice().sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function createReplayBuffer({ intervalMs = 8000, cap = 220 } = {}) {
  /** @type {{due:number, ev:object}[]} sorted ascending by `due` */
  let queue = []
  let head = 0

  let lastSeenTs = 0
  let windowStart = 0
  let windowEnd = 0

  let belowFloor = 0      // cumulative, real events under the effective floor
  let dropped = 0         // cumulative, real events dropped on a tab-return discard
  let scheduledTotal = 0

  let autoFloor = 0       // 0 = not engaged
  let autoFloorReason = ''
  let quietWindows = 0

  const windowSums = []
  let intensity = 0

  const seen = new Set()
  const seenOrder = []

  /** @type {{t:number, usd:number, side:string, asset:string, exchange:string, kind:string}[]} */
  let recent = []

  function remember(id) {
    if (seen.has(id)) return false
    seen.add(id)
    seenOrder.push(id)
    if (seenOrder.length > SEEN_KEEP) {
      const gone = seenOrder.splice(0, seenOrder.length - SEEN_KEEP)
      for (const g of gone) seen.delete(g)
    }
    return true
  }

  function effectiveFloor(userFloor) {
    return Math.max(Number(userFloor) || 0, autoFloor)
  }

  function compact() {
    if (head > 64) { queue = queue.slice(head); head = 0 }
  }

  /**
   * Raise the buffer's own floor until the queue fits under `cap`, and say so.
   * The scene never silently thins itself: the number it raised to and the word
   * `cascade` go straight onto the meta rail.
   */
  function enforceCap() {
    const live = queue.length - head
    if (live <= cap) return null
    const sorted = queue.slice(head).map(q => q.ev.usd).sort((a, b) => b - a)
    const cut = niceFloor(sorted[cap] ?? sorted[sorted.length - 1])
    if (!(cut > autoFloor)) return null
    autoFloor = cut
    autoFloorReason = 'cascade'
    const kept = []
    for (let i = head; i < queue.length; i++) {
      if (queue[i].ev.usd >= autoFloor) kept.push(queue[i])
      else belowFloor++
    }
    queue = kept
    head = 0
    quietWindows = 0
    return autoFloor
  }

  /**
   * Exhale. One notch per two quiet windows — the floor walks back down over
   * roughly a minute rather than snapping the moment the cascade ends.
   */
  function relaxFloor(userFloor) {
    if (!autoFloor) return null
    if (intensity >= 0.5) { quietWindows = 0; return null }
    quietWindows++
    if (quietWindows < 2) return null
    quietWindows = 0
    const next = niceFloor(autoFloor * 0.75)
    if (next <= Math.max(userFloor, 0) || next >= autoFloor) {
      autoFloor = 0
      autoFloorReason = ''
      return 0
    }
    autoFloor = next
    return autoFloor
  }

  return {
    /**
     * Schedule a fresh page of normalised events.
     *
     * @param {object[]} events  normalised (cnm-map) rows, any order
     * @param {object}   o
     * @param {number}   o.now       wall clock
     * @param {number}   o.floor     the user's floor
     * @param {number}  [o.seedMs]   on the FIRST ingest only, replay just this
     *                               much of the tail (entry choreography seeds
     *                               from the last ~20s of real events; the rest
     *                               of the page is history, not a burst)
     * @returns {{scheduled:number, below:number, autoRaised:number|null,
     *            relaxed:number|null, seeded:boolean}}
     */
    ingest(events, { now, floor, seedMs = 20000 } = {}) {
      const seeding = lastSeenTs === 0
      const rows = []
      for (const ev of (events || [])) {
        if (!ev || !Number.isFinite(ev.t)) continue
        if (ev.t <= lastSeenTs) continue
        rows.push(ev)
      }
      rows.sort((a, b) => a.t - b.t)

      if (!rows.length) {
        // Nothing new is not an error state. The window keeps its last value,
        // the age clock keeps ticking, and nothing is drawn.
        return { scheduled: 0, below: 0, autoRaised: null, relaxed: null, seeded: false }
      }

      const maxT = rows[rows.length - 1].t
      let batch = rows
      if (seeding) {
        // Everything older than the seed tail is real history we simply did not
        // watch happen. It is not replayed and it is not counted as hidden.
        batch = rows.filter(r => r.t >= maxT - seedMs)
      }

      const fl = effectiveFloor(floor)
      const accepted = []
      let below = 0
      for (const ev of batch) {
        if (!remember(ev.id)) continue
        if (ev.kind === 'liq' && ev.usd < fl) { below++; belowFloor++; continue }
        accepted.push(ev)
      }
      lastSeenTs = maxT

      // Density is measured on everything the feed carried in this window,
      // dust included — the market's real notional, not our filtered view.
      const sum = batch.reduce((a, e) => a + (e.kind === 'liq' ? e.usd : 0), 0)
      windowSums.push(sum)
      if (windowSums.length > MEDIAN_WINDOWS) windowSums.shift()
      const med = median(windowSums)
      intensity = med > 0 ? Math.max(0, Math.min(1, sum / (med * CASCADE_MULTIPLE))) : 0

      if (accepted.length) {
        windowStart = accepted[0].t
        windowEnd = accepted[accepted.length - 1].t
        const span = Math.max(1, windowEnd - windowStart)
        for (const ev of accepted) {
          queue.push({ due: now + ((ev.t - windowStart) / span) * intervalMs, ev })
        }
        queue.sort((a, b) => a.due - b.due)
        head = 0
        scheduledTotal += accepted.length
      }

      for (const ev of batch) {
        if (ev.kind !== 'liq') continue
        recent.push({ t: ev.t, usd: ev.usd, side: ev.side, asset: ev.asset, exchange: ev.exchange, kind: ev.kind })
      }
      const cutoff = maxT - RECENT_KEEP_MS
      if (recent.length && recent[0].t < cutoff) recent = recent.filter(r => r.t >= cutoff)

      const autoRaised = enforceCap()
      const relaxed = autoRaised === null ? relaxFloor(floor) : null

      return { scheduled: accepted.length, below, autoRaised, relaxed, seeded: seeding }
    },

    /** Everything due at or before `now`, removed from the queue. */
    drain(now) {
      const out = []
      while (head < queue.length && queue[head].due <= now) {
        out.push(queue[head].ev)
        head++
      }
      compact()
      return out
    },

    /**
     * Tab return / resume. The backlog is thrown away rather than drained —
     * draining four minutes of queued events into one second would be a burst
     * that never happened.
     */
    discard() {
      const n = queue.length - head
      dropped += Math.max(0, n)
      queue = []
      head = 0
      return n
    },

    /**
     * Shift every queued due-time by `ms`. Used when the scene is paused: the
     * queue must not fire while nothing is drawing, or the pause would eat
     * real events.
     */
    shift(ms) {
      for (let i = head; i < queue.length; i++) queue[i].due += ms
    },

    /** Rolling window of real liquidation rows behind the cascade sentence. */
    recentLiqs(sinceMs, now) {
      const from = (Number.isFinite(now) ? now : Date.now()) - sinceMs
      // `recent` is stamped in SOURCE time; compare against the newest source
      // stamp we hold so a feed lag never empties the window.
      const anchor = recent.length ? recent[recent.length - 1].t : from
      const edge = anchor - sinceMs
      return recent.filter(r => r.t >= edge)
    },

    stats() {
      return {
        queued: queue.length - head,
        scheduled: scheduledTotal,
        belowFloor,
        dropped,
        windowStart,
        windowEnd,
        lastSeenTs,
        intensity,
        autoFloor,
        autoFloorReason,
      }
    },

    /** Clean slate — used when the asset filter changes. */
    reset() {
      queue = []
      head = 0
      lastSeenTs = 0
      windowStart = 0
      windowEnd = 0
      belowFloor = 0
      dropped = 0
      scheduledTotal = 0
      autoFloor = 0
      autoFloorReason = ''
      quietWindows = 0
      windowSums.length = 0
      intensity = 0
      seen.clear()
      seenOrder.length = 0
      recent = []
    },
  }
}
