import { describe, expect, it } from 'vitest'
import { xdashHealth, timeframeForHours } from '../api/_lib/xdash-health.js'
import { readXDashHealth } from '../src/lib/xdash-health.js'

/**
 * The distinction this whole feature turns on: an empty board because the user
 * filtered everything out (a real answer) versus an empty board because the
 * window they asked for was never built upstream (not an answer at all).
 * Getting it backwards either blames users for our outage or hides a genuine
 * "nothing matched" behind an outage notice.
 */

const bundle = (over = {}) => ({
  generated_at_utc: '2026-08-28T04:14:05Z',
  window_hours: 168,
  board: { status: 'ok', tokens: [{ symbol: 'BTC' }] },
  hero: { status: 'ok', tokens: [] },
  treemap: { status: 'ok', tokens: [] },
  ...over,
})

describe('timeframeForHours', () => {
  it('maps the window the API reports back to the token it accepts', () => {
    expect(timeframeForHours(168)).toBe('7d')
    expect(timeframeForHours(24)).toBe('24h')
    expect(timeframeForHours(720)).toBe('30d')
  })
  it('returns null for a window with no token (never guesses)', () => {
    expect(timeframeForHours(99)).toBeNull()
    expect(timeframeForHours(null)).toBeNull()
    expect(timeframeForHours('nope')).toBeNull()
  })
})

describe('xdashHealth', () => {
  it('is ok when the window served is the window asked for', () => {
    const h = xdashHealth(bundle(), '7d')
    expect(h.state).toBe('ok')
    expect(h.liveTimeframe).toBeNull()
  })

  it('flags the live production fault: 24h asked, 168h served, nothing back', () => {
    // Measured against the upstream 2026-08-28 — every timeframe answered 200
    // with window_hours 168 and only 7d carried rows.
    const h = xdashHealth(
      bundle({
        board: { status: 'empty', tokens: [], error: 'empty_result' },
        hero: { status: 'empty', tokens: [] },
        treemap: { status: 'empty', tokens: [] },
      }),
      '24h',
    )
    expect(h.state).toBe('updating')
    expect(h.reason).toBe('window_not_built')
    expect(h.liveTimeframe).toBe('7d')
  })

  it('does NOT cry outage when the right window is simply empty', () => {
    const h = xdashHealth(
      { window_hours: 24, board: { status: 'empty', tokens: [] } },
      '24h',
    )
    expect(h.state).toBe('ok')
  })

  it('does NOT cry outage when a mismatched window still returned rows', () => {
    // Useful data from a neighbouring window beats an apology.
    expect(xdashHealth(bundle(), '24h').state).toBe('ok')
  })

  it('believes a section that declares itself degraded, rows or not', () => {
    const h = xdashHealth(bundle({ board: { status: 'degraded', tokens: [], error: 'upstream_5xx' } }), '7d')
    expect(h.state).toBe('updating')
    expect(h.reason).toBe('upstream_degraded')
  })

  it('reports an unreachable upstream without a payload to inspect', () => {
    const h = xdashHealth(null, '24h', { upstreamDown: true })
    expect(h.state).toBe('updating')
    expect(h.reason).toBe('upstream_unreachable')
  })

  it('treats a flat bootstrap payload (tokens at the root) the same way', () => {
    const empty = xdashHealth({ window_hours: 168, tokens: [] }, '24h')
    expect(empty.state).toBe('updating')
    const full = xdashHealth({ window_hours: 168, tokens: [{ symbol: 'SOL' }] }, '24h')
    expect(full.state).toBe('ok')
  })
})

describe('readXDashHealth (client)', () => {
  it('trusts the server stamp when present', () => {
    const h = readXDashHealth(
      { _health: { state: 'updating', reason: 'window_not_built', liveTimeframe: '7d' } },
      '24h',
    )
    expect(h.state).toBe('updating')
    expect(h.liveTimeframe).toBe('7d')
  })

  it('derives the same verdict when the stamp is missing (stale edge cache)', () => {
    const h = readXDashHealth({ window_hours: 168, tokens: [] }, '24h')
    expect(h.state).toBe('updating')
    expect(h.reason).toBe('window_not_built')
    expect(h.liveTimeframe).toBe('7d')
  })

  it('calls a failed fetch updating', () => {
    expect(readXDashHealth(null, '24h', { errored: true }).state).toBe('updating')
  })

  it('stays ok while a first load is still in flight (no payload, no error)', () => {
    // Otherwise every cold mount would flash the outage panel before data lands.
    expect(readXDashHealth(null, '24h').state).toBe('ok')
  })
})
