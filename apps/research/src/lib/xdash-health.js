/**
 * xdash-health (client) — read the server's verdict, or work it out locally.
 *
 * The proxy stamps `_health` on bootstrap and leaderboard-bundle responses (see
 * api/_lib/xdash-health.js). Not every X Dash surface goes through those two
 * routes, and a warm edge cache can still be serving a body from before that
 * field existed, so this falls back to deriving the same verdict from the
 * payload's own `window_hours` — the field the upstream has always sent.
 *
 * One rule decides everything: compare the window ASKED FOR against the window
 * SERVED. Equal, or rows present, means the answer is a real answer. Different
 * AND empty means the board on screen is not an answer to the question the user
 * asked, and saying "no tokens match these filters" would be a lie.
 */

const TIMEFRAME_HOURS = { '1h': 1, '4h': 4, '12h': 12, '24h': 24, '7d': 168, '30d': 720 }

export function timeframeForHours(hours) {
  const n = Number(hours)
  if (!Number.isFinite(n)) return null
  const hit = Object.entries(TIMEFRAME_HOURS).find(([, h]) => h === n)
  return hit ? hit[0] : null
}

/** Human label for a timeframe token, for use in prose and on buttons. */
export function timeframeLabel(tf) {
  if (!tf) return ''
  return String(tf).toUpperCase()
}

function countRows(payload) {
  if (!payload || typeof payload !== 'object') return 0
  if (Array.isArray(payload.tokens)) return payload.tokens.length
  return ['board', 'hero', 'treemap'].reduce(
    (n, k) => n + (Array.isArray(payload[k]?.tokens) ? payload[k].tokens.length : 0),
    0,
  )
}

/**
 * @returns {{state:'ok'|'updating', reason:string|null, liveTimeframe:string|null,
 *            asOf:string|null, requested:string|null}}
 */
export function readXDashHealth(payload, requested = null, opts = {}) {
  // The server already decided — trust it, but keep the requested window from
  // the caller when the stamp predates it.
  const stamped = payload?._health
  if (stamped?.state) {
    return {
      state: stamped.state,
      reason: stamped.reason || null,
      liveTimeframe: stamped.liveTimeframe || null,
      asOf: stamped.asOf || null,
      requested: stamped.requested || requested || null,
    }
  }

  const base = { reason: null, liveTimeframe: null, asOf: null, requested }

  // A fetch that never landed is the plainest form of "updating".
  if (opts.errored) return { ...base, state: 'updating', reason: 'upstream_unreachable' }
  if (!payload) return { ...base, state: 'ok' }

  const asOf = payload.generated_at_utc || payload.generated_at || null
  const servingHours = payload.window_hours ?? null
  const live = timeframeForHours(servingHours)
  const liveTimeframe = live && live !== requested ? live : null

  if (['board', 'hero', 'treemap'].some((k) => payload[k]?.status === 'degraded')) {
    return { state: 'updating', reason: 'upstream_degraded', liveTimeframe, asOf, requested }
  }

  const requestedHours = TIMEFRAME_HOURS[requested]
  const mismatch = requestedHours != null
    && servingHours != null
    && Number(servingHours) !== requestedHours
  if (mismatch && countRows(payload) === 0) {
    return { state: 'updating', reason: 'window_not_built', liveTimeframe, asOf, requested }
  }

  // Right window, empty board. See the same branch in api/_lib/xdash-health.js:
  // a payload that declares token_count > 0 and then ships zero rows is a
  // rebuild in progress, not an empty market — and without this the page
  // rendered false zeros over blank panels instead of saying so.
  const declaredTokens = Number(payload.token_count)
  if (Number.isFinite(declaredTokens) && declaredTokens > 0 && countRows(payload) === 0) {
    return { state: 'updating', reason: 'board_empty', liveTimeframe, asOf, requested }
  }

  return { state: 'ok', reason: null, liveTimeframe, asOf, requested }
}

/** Convenience for surfaces that only need the boolean. */
export function isXDashUpdating(payload, requested, opts) {
  return readXDashHealth(payload, requested, opts).state === 'updating'
}

/**
 * The sentence under the title. Says what is actually true of each case rather
 * than one vague apology — a reader who is told which window holds data can act
 * on it, and one who is told the feed is rebuilding knows not to keep refreshing.
 */
export function xdashUpdatingCopy(health, t) {
  const tr = typeof t === 'function' ? t : (_k, d) => d
  const live = health?.liveTimeframe ? timeframeLabel(health.liveTimeframe) : null
  switch (health?.reason) {
    case 'window_not_built':
      return live
        ? tr('xDash.updating.windowWithLive', `This window is still being rebuilt upstream. The ${live} window is current — open that for the live board.`)
        : tr('xDash.updating.window', 'This window is still being rebuilt upstream. Another timeframe may already be current.')
    case 'board_empty':
      return tr('xDash.updating.boardEmpty', 'The board for this window came back empty while the feed rebuilds its index. This comes back on its own.')
    case 'upstream_degraded':
      return tr('xDash.updating.degraded', 'The social feed is refreshing its index. Boards come back on their own once the rebuild lands.')
    case 'upstream_unreachable':
      return tr('xDash.updating.unreachable', 'We could not reach the social feed just now. This retries by itself.')
    default:
      return tr('xDash.updating.generic', 'The social feed is refreshing. This comes back on its own.')
  }
}
