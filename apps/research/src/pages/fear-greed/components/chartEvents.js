/**
 * Major crypto milestones + clustering utilities for chart markers.
 * These are real historical events (not mocked news) used as reference points.
 */

export const CRYPTO_MILESTONES = [
  { id: 'sec-ripple', ts: 1689292800, type: 'milestone', title: 'Ripple Partial Win vs SEC', summary: 'Court ruled XRP is not a security in secondary sales. XRP surged 70%.' },
  { id: 'btc-etf', ts: 1704844800, type: 'milestone', title: 'Spot Bitcoin ETFs Approved', summary: 'SEC approved 11 spot Bitcoin ETFs, opening BTC to traditional finance.' },
  { id: 'btc-halving-2024', ts: 1713571200, type: 'milestone', title: 'Bitcoin Fourth Halving', summary: 'Block reward reduced from 6.25 to 3.125 BTC at block 840,000.' },
  { id: 'eth-etf', ts: 1716508800, type: 'milestone', title: 'Spot Ethereum ETFs Approved', summary: 'SEC approved spot Ethereum ETFs, following the Bitcoin ETF precedent.' },
  { id: 'btc-100k', ts: 1733356800, type: 'milestone', title: 'Bitcoin Crosses $100K', summary: 'BTC broke $100,000 for the first time, driven by ETF inflows and post-halving momentum.' },
]

/** Filter milestones to a timeframe window */
export function getMilestonesForTimeframe(days) {
  const cutoff = days >= 9999 ? 0 : Math.floor(Date.now() / 1000) - days * 86400
  return CRYPTO_MILESTONES.filter(e => e.ts >= cutoff)
}

/**
 * Cluster nearby positioned events by x-distance.
 * Returns array of { id, events[], x, y, count }
 */
export function clusterEvents(positioned, minGapPx = 28) {
  if (!positioned.length) return []
  const sorted = [...positioned].sort((a, b) => a.x - b.x)
  const clusters = []
  let current = { id: sorted[0].id, events: [sorted[0]], x: sorted[0].x, y: sorted[0].y, count: 1 }

  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i]
    if (Math.abs(ev.x - current.x) < minGapPx) {
      current.events.push(ev)
      current.count++
      current.x = (current.x * (current.count - 1) + ev.x) / current.count
      current.y = Math.min(current.y, ev.y)
    } else {
      clusters.push(current)
      current = { id: ev.id, events: [ev], x: ev.x, y: ev.y, count: 1 }
    }
  }
  clusters.push(current)
  return clusters
}
