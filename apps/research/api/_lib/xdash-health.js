/**
 * xdash-health — one verdict on whether an X Dash payload can be believed.
 *
 * The upstream dashboard API materialises ONE document per window and serves it
 * from a docs store. When an aggregation run does not produce a window, the API
 * still answers 200 — it just falls back to whichever window it does hold and
 * returns an empty board. Measured 2026-08-28: every request, whatever the
 * `timeframe` asked for, came back `window_hours: 168`, and only `timeframe=7d`
 * carried rows. 24h (the app's default), 30d and all were empty.
 *
 * That shape is indistinguishable from "your filters matched nothing" unless
 * someone compares the window asked for against the window served — which is
 * what this does, once, on the server, so all ~85 client consumers can read one
 * field instead of each re-deriving it.
 *
 * States:
 *   ok       — serving the window that was asked for.
 *   updating — the answer cannot be trusted as an answer to THIS question:
 *              either a section came back degraded (upstream 5xx), or the
 *              window asked for was not built and an empty board came back
 *              from a different one.
 * `liveTimeframe` names the window that DOES hold rows, so a surface can offer
 * it instead of leaving the reader on a dead one.
 */

// The window vocabulary the boards speak, in hours. `all` is open-ended and
// carries no hour count, so it can never mismatch on hours alone.
const TIMEFRAME_HOURS = { '1h': 1, '4h': 4, '12h': 12, '24h': 24, '7d': 168, '30d': 720 }

/** Hours → the canonical timeframe token the API accepts (168 → '7d'). */
export function timeframeForHours(hours) {
  if (hours == null) return null
  const n = Number(hours)
  if (!Number.isFinite(n)) return null
  const hit = Object.entries(TIMEFRAME_HOURS).find(([, h]) => h === n)
  return hit ? hit[0] : null
}

/** Sections a leaderboard bundle carries, each with its own status/error. */
const BUNDLE_SECTIONS = ['board', 'hero', 'treemap']

function rowCount(payload) {
  if (!payload || typeof payload !== 'object') return 0
  if (Array.isArray(payload.tokens)) return payload.tokens.length
  return BUNDLE_SECTIONS.reduce(
    (n, key) => n + (Array.isArray(payload[key]?.tokens) ? payload[key].tokens.length : 0),
    0,
  )
}

/**
 * Build the `_health` envelope for a payload.
 *
 * @param payload   the upstream JSON (bootstrap or leaderboard-bundle)
 * @param requested the timeframe the caller asked for, e.g. '24h'
 * @param opts.upstreamDown  true when the upstream never answered at all
 */
export function xdashHealth(payload, requested, opts = {}) {
  const asOf = payload?.generated_at_utc || payload?.generated_at || null
  const servingHours = payload?.window_hours ?? null
  const liveTimeframe = timeframeForHours(servingHours)

  const base = {
    requested: requested || null,
    servingWindowHours: servingHours,
    liveTimeframe: liveTimeframe && liveTimeframe !== requested ? liveTimeframe : null,
    asOf,
  }

  if (opts.upstreamDown) {
    return { ...base, state: 'updating', reason: 'upstream_unreachable' }
  }

  // A section that reports itself degraded is the upstream telling us straight
  // out that it failed — believe it before anything inferred.
  const degraded = BUNDLE_SECTIONS.some((key) => payload?.[key]?.status === 'degraded')
  if (degraded) return { ...base, state: 'updating', reason: 'upstream_degraded' }

  // The inferred case: nothing came back AND what we were served is not the
  // window we asked for. Both halves are required — an empty board from the
  // RIGHT window is a real answer ("nothing this window"), not a fault, and a
  // full board from a neighbouring window is still useful data.
  const requestedHours = TIMEFRAME_HOURS[requested]
  const windowMismatch = requestedHours != null
    && servingHours != null
    && Number(servingHours) !== requestedHours
  if (windowMismatch && rowCount(payload) === 0) {
    return { ...base, state: 'updating', reason: 'window_not_built' }
  }

  // The window matched and the board is STILL empty. The rule above assumed
  // that could only mean "nothing this window" — true while 7d always carried
  // rows. Measured 2026-09-02: the 7d bootstrap answers window_hours 168 (the
  // window asked for) with token_count 4040, totals.kept_hits 1766 and
  // `tokens: []`. No mismatch fired, so X Dash called it 'ok' and rendered
  // "0 MENTIONS", an empty Movers rail and a blank Attention Map with no
  // explanation at all — strictly worse than the notice the mismatch case gets.
  // A payload that counts tokens in its own header and then ships none is a
  // rebuild in progress. This can't be confused with "your filters matched
  // nothing": bootstrap is the pre-filter board.
  const declaredTokens = Number(payload?.token_count)
  if (Number.isFinite(declaredTokens) && declaredTokens > 0 && rowCount(payload) === 0) {
    return { ...base, state: 'updating', reason: 'board_empty' }
  }

  return { ...base, state: 'ok', reason: null }
}

/** Attach `_health` without disturbing the payload's own keys. */
export function withHealth(payload, requested, opts) {
  const health = xdashHealth(payload, requested, opts)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { data: payload, _health: health }
  }
  return { ...payload, _health: health }
}
