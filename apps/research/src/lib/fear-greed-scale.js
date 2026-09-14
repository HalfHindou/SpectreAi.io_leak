/**
 * The Fear & Greed scale, in one place.
 *
 * The index is drawn on three surfaces now - the /fear-greed page, the AI
 * Charts / Command Center compare board (canvas) and the LITE compare view
 * (SVG). They should look like one instrument, so the numbers, the five band
 * names and the five stepped line colours all come from here.
 *
 * A continuous red-to-green ramp lived here for one round and was cut: at the
 * low alpha an area fill needs, the fear end came out orange rather than red
 * and the greed end went olive. Colour belongs on the LINE, stepped, exactly
 * as the /fear-greed chart has always drawn it; the fill is one quiet amber
 * gradient carrying no information at all.
 */

export const FNG_BANDS = [
  { max: 24, label: 'Extreme Fear', color: '#ef4444' },
  { max: 44, label: 'Fear', color: '#f97316' },
  { max: 55, label: 'Neutral', color: '#eab308' },
  { max: 74, label: 'Greed', color: '#84cc16' },
  { max: 100, label: 'Extreme Greed', color: '#22c55e' },
]

export function fngBand(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return FNG_BANDS[2]
  return FNG_BANDS.find((b) => n <= b.max) || FNG_BANDS[FNG_BANDS.length - 1]
}

/* The exact stepped line colour the /fear-greed chart draws with. Its line is
   segment-coloured by value, so the two surfaces read as one instrument. */
export function fngLineColor(v) {
  const n = Number(v)
  // Cut on the BAND boundaries, not the /fear-greed page's own 25/45/55/75.
  // Those are a point out from the band table, and the compare panel prints the
  // value, the colour and the band name side by side - so "F&G +11 to 25 Fear"
  // came out in Extreme-Fear red. A point of hue nobody can see, against a
  // contradiction anyone can read.
  if (n <= FNG_BANDS[0].max) return '#ef4444'
  if (n <= FNG_BANDS[1].max) return '#ea580c'
  if (n <= FNG_BANDS[2].max) return '#eab308'
  if (n <= FNG_BANDS[3].max) return '#84cc16'
  return '#22c55e'
}

// The stepped line colour as an "r,g,b" triple, for CSS custom properties.
export function fngLineRgb(v) {
  const hex = fngLineColor(v)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')
}

/* ── Daily history, shared across every mount for the session ──
   It moves once a day, so one fetch serves the AI Charts board, the Command
   Center tab and LITE without any of them knowing about the others. */
let _cache = null
const TTL = 15 * 60 * 1000

export function loadFngHistory() {
  if (_cache && Date.now() - _cache.ts < TTL) return Promise.resolve(_cache.rows)
  return import('@/services/fearGreedApi')
    .then(({ getFearGreedHistory }) => getFearGreedHistory(365))
    .then((payload) => {
      const rows = (payload?.data || [])
        .map((r) => ({
          t: Number(r.timestamp) || Math.floor(new Date(r.time || 0).getTime() / 1000),
          v: Number(r.value ?? r.score),
        }))
        .filter((r) => r.t > 0 && Number.isFinite(r.v))
        .sort((a, b) => a.t - b.t)
      if (rows.length < 5) throw new Error('fear & greed history too short')
      _cache = { ts: Date.now(), rows }
      return rows
    })
}

export function cachedFngRows() {
  return _cache ? _cache.rows : null
}
