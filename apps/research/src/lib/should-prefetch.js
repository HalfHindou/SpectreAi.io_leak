/**
 * One answer to: "may we spend the user's bandwidth on something they have not
 * asked for yet?"
 *
 * A landing visit measured 4.9MB across 235 requests, of which ~4MB arrives
 * AFTER load as speculation - route warmers (App.jsx), overlay warmers
 * (app-shell.jsx) and the Privy provider. On a desktop 4g connection that is a
 * good trade: it buys instant subpage navigation, which is exactly what the
 * warmers were added for (measured 0.9-2.4s compile at 4x CPU throttle).
 *
 * On a phone on 3g it is not a trade at all. The warmers only ever checked
 * `saveData`, a flag almost nobody turns on, so a 2g/3g visitor downloaded the
 * full speculative payload for pages they may never open.
 *
 * This gate is deliberately conservative:
 *   - No NetworkInformation API (Safari, Firefox) -> assume a normal connection
 *     and prefetch, i.e. today's behaviour is preserved everywhere it cannot be
 *     measured. This must never become "no API -> no prefetch": that would
 *     silently disable warming for every Safari user.
 *   - `saveData` is an explicit user request. Always honour it.
 *   - 2g/3g means a multi-megabyte speculative download costs the user real
 *     time and, on a metered plan, real money.
 *
 * Nothing here blocks anything a user actually asks for. Every warmer's target
 * is lazy() on its own route, so skipping the warm-up only means the chunk is
 * fetched on demand instead of ahead of time.
 */

const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g'])

export function shouldPrefetch() {
  if (typeof navigator === 'undefined') return false

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  // Browser will not tell us - keep the existing eager behaviour.
  if (!conn) return true

  if (conn.saveData) return false
  if (SLOW_EFFECTIVE_TYPES.has(conn.effectiveType)) return false

  return true
}
