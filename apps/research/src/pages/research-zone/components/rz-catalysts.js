/**
 * rz-catalysts.js — the shared "catalyst layer" for the Research Zone right rail.
 *
 * One source of truth that turns the live news + price metrics already on the
 * page into:
 *   1. extractCatalysts()  → ranked headlines for the AI agent's context block,
 *                            so "why is $X moving?" is answered with named drivers
 *                            (deals, people, products, momentum) — not "price up".
 *   2. deriveSignals()     → Agent-RSS signal cards for assets the backend doesn't
 *                            cover (every stock, plus longtail crypto when the
 *                            composer route returns nothing). Same render shape as
 *                            the backend feed: { id, category, score, headline,
 *                            detail, createdAt, metadata:{ direction } }.
 *
 * Pure functions, no React, no fetch — the data is passed in by the parent.
 */

// Words that flip a headline bullish / bearish regardless of the price tape.
// Kept deliberately tight so we don't mislabel neutral coverage.
const BULLISH_RE = /\b(surge|surges|soar|soars|jump|jumps|rally|rallies|rallied|rockets?|spike|spikes|beat|beats|tops?|record|all-?time high|upgrade|upgrades|acquir\w*|partnership|approval|approved|wins?|secures?|raises?|raise|funding|invest\w*|expands?|launch\w*|breakthrough|bullish|gains?)\b/i
const BEARISH_RE = /\b(plunge|plunges|plummet|crash|crashes|slump|slumps|tumble|tumbles|sinks?|drops?|falls?|slid\w*|cut|cuts|miss|misses|downgrade|downgrades|lawsuit|probe|investigat\w*|halt|halts|recall|delay|delays|warn\w*|loss|losses|bearish|sell-?off|fraud|hack\w*)\b/i

// Structural, price-moving events (index inclusion, IPO, M&A, earnings, big
// regulatory calls). A recent match is promoted ABOVE fresher listicle fluff
// so the real catalyst (e.g. yesterday's Nasdaq-100 inclusion) always shows.
const HIGH_IMPACT_RE = /\b(nasdaq[- ]?100|s&p ?500|dow jones|russell ?[12]000|index (?:inclusion|add\w*|entry|rebalanc\w*)|joins? the (?:nasdaq|s&p|dow)|ipo|initial public offering|earnings|acquisition|acquires?|merger|buyout|takeover|bankruptcy|delist\w*|stock split|dividend|guidance|lock-?up|buyback|sec (?:approval|charges|lawsuit)|fda (?:approval|clearance)|forced buying)\b/i
const HIGH_IMPACT_WINDOW_MS = 48 * 3600 * 1000

function headlineDirection(text, fallback) {
  const t = String(text || '')
  const bull = BULLISH_RE.test(t)
  const bear = BEARISH_RE.test(t)
  if (bull && !bear) return 'up'
  if (bear && !bull) return 'down'
  return fallback || 'neutral'
}

function asMillis(d) {
  if (d == null) return 0
  if (typeof d === 'number') return d > 1e12 ? d : d * 1000 // sec vs ms
  const parsed = Date.parse(d)
  return Number.isFinite(parsed) ? parsed : 0
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalize a mixed news list to { title, source, url, date, summary } and rank
 * by recency, keeping only items that read like real, datable coverage.
 * @returns {Array<{title,source,url,date,summary,direction}>}
 */
export function extractCatalysts(newsItems, { limit = 6, change24h } = {}) {
  if (!Array.isArray(newsItems) || !newsItems.length) return []
  const dir = num(change24h)
  const tapeDir = dir == null ? null : dir > 0.4 ? 'up' : dir < -0.4 ? 'down' : 'neutral'
  const seen = new Set()
  const out = []
  const now = Date.now()
  for (const item of newsItems) {
    const title = String(item?.title || item?.headline || '').trim()
    if (!title) continue
    const key = title.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    const date = asMillis(item?.publishedOn ?? item?.date ?? item?.publishedAt)
    out.push({
      title,
      source: item?.source || 'News',
      url: item?.url || '',
      date,
      summary: String(item?.summary || '').trim(),
      direction: headlineDirection(title, tapeDir),
      // Only a RECENT structural event outranks recency — a 3-week-old IPO
      // recap must not float above today's tape.
      major: HIGH_IMPACT_RE.test(title) && !!date && now - date < HIGH_IMPACT_WINDOW_MS,
    })
  }
  // Recent structural catalysts first, then most recent; undated items sink.
  out.sort((a, b) => (b.major - a.major) || (b.date || 0) - (a.date || 0))
  return out.slice(0, limit)
}

/**
 * Render the catalyst headlines as a compact text block for the LLM prompt.
 * Returns '' when there's nothing real to show (caller omits the section).
 */
export function buildCatalystBlock(catalysts) {
  if (!Array.isArray(catalysts) || !catalysts.length) return ''
  const lines = catalysts.map((c) => {
    const age = c.date ? ` (${relAge(c.date)})` : ''
    return `- ${c.title} — ${c.source}${age}`
  })
  return lines.join('\n')
}

/**
 * Market-structure read from supply data — the "inevitable, powerful" layer:
 * float vs locked supply, dilution/unlock overhang, FDV-vs-mcap gap. These
 * structural facts often drive price harder than any headline (low float =
 * scarcity = violent moves; big unlock overhang = persistent sell pressure).
 * Computed from whatever supply fields the asset carries; '' when unknown.
 */
export function buildStructureBlock(metrics) {
  const m = metrics || {}
  const lines = []
  const circ = num(m.circulatingSupply ?? m.circulating)
  const max = num(m.maxSupply ?? m.totalSupply)
  const fdv = num(m.fdv)
  const mcap = num(m.marketCap ?? m.mcap)
  if (circ && max && max > 0 && circ <= max) {
    const floatPct = (circ / max) * 100
    if (floatPct < 65) {
      const locked = 100 - floatPct
      lines.push(`only ~${floatPct.toFixed(0)}% of max supply circulates — low float = scarcity now, but ~${locked.toFixed(0)}% is still locked and unlocks/vests over time (future dilution / supply overhang)`)
    } else if (floatPct >= 92) {
      lines.push(`~${floatPct.toFixed(0)}% of supply already circulates — unlocks largely done, little dilution overhang left`)
    }
  }
  if (fdv && mcap && mcap > 0) {
    const ratio = fdv / mcap
    if (ratio >= 1.5) lines.push(`FDV is ~${ratio.toFixed(1)}x market cap — large future-supply pressure sitting above the current cap`)
  }
  if (!lines.length) return ''
  return `MARKET STRUCTURE: ${lines.join('; ')}.`
}

/**
 * The crowd layer — "what the timeline is saying" — so the brain reads the room
 * like a human (scrolls X), not just the headlines. Fuses a sentiment tilt with
 * the loudest real voices (KOLs/mentions), letting the model weigh authentic
 * conviction vs hype/bots. '' when there's nothing real to show.
 *
 * @param {object} a
 * @param {{overall:number, confidence:number}} [a.sentScore]
 * @param {Array<{name?,handle?,followers?,text?,verified?}>} [a.voices]
 */
export function buildCrowdBlock(social) {
  // null-safe: callers pass `null` when the social layer hasn't loaded — a bare
  // destructuring default ({}=) only guards `undefined`, so `null` would throw
  // and (built before the fetch) hang the agent on "Analyzing…".
  const { sentScore, voices } = social || {}
  const out = []
  const ov = num(sentScore?.overall)
  if (ov != null) {
    // overall is roughly -1..+1 or a 0..10ish score depending on source; describe
    // the tilt qualitatively so the model isn't anchored to a fragile number.
    const tilt = ov > 0.15 ? 'net bullish' : ov < -0.15 ? 'net bearish' : 'mixed/neutral'
    const conf = num(sentScore?.confidence)
    out.push(`sentiment ${tilt} (score ${ov}${conf != null ? `, confidence ${conf}` : ''})`)
  }
  const list = Array.isArray(voices) ? voices.filter((v) => (v?.text || '').trim()) : []
  if (list.length) {
    const seen = new Set()
    const lines = []
    for (const v of list) {
      const text = String(v.text).replace(/\s+/g, ' ').trim()
      const key = text.slice(0, 60).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const handle = v.handle ? `@${String(v.handle).replace(/^@/, '')}` : (v.name || 'voice')
      const fol = num(v.followers)
      const folTag = fol ? ` (${fol >= 1000 ? `${(fol / 1000).toFixed(fol >= 1e4 ? 0 : 1)}k` : fol} followers${v.verified ? ', ✓' : ''})` : (v.verified ? ' (✓)' : '')
      lines.push(`- ${handle}${folTag}: ${text.length > 180 ? `${text.slice(0, 180)}…` : text}`)
      if (lines.length >= 5) break
    }
    if (lines.length) out.push(`loudest voices:\n${lines.join('\n')}`)
  }
  if (!out.length) return ''
  return `CROWD (what X is saying right now — read the room, weigh real conviction vs hype/bots):\n${out.join('\n')}`
}

function relAge(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/**
 * Synthesize Agent-RSS signal cards from the live tape + catalyst headlines.
 * Used for stocks (no backend coverage) and as a fallback for crypto when the
 * composer route returns nothing — so the panel is never dead when there's a
 * real story to tell.
 *
 * @param {object} a
 * @param {string} a.symbol
 * @param {string} [a.tokenName]
 * @param {object} [a.metrics]    { price, change24h, change7d, change30d, volume24h, marketCap, high24h, low24h }
 * @param {Array}  [a.newsItems]
 * @returns {Array<{id,category,score,headline,detail,createdAt,metadata}>}
 */
export function deriveSignals({ symbol, tokenName, metrics, newsItems } = {}) {
  const m = metrics || {}
  const name = tokenName || symbol || 'This asset'
  const now = Date.now()
  const signals = []
  const ch24 = num(m.change24h)
  const ch7 = num(m.change7d)
  const ch30 = num(m.change30d)

  // 1. 24h momentum — the headline read.
  if (ch24 != null && Math.abs(ch24) >= 1) {
    const up = ch24 > 0
    const mag = Math.abs(ch24)
    const strength = mag >= 12 ? 'Strong' : mag >= 5 ? 'Notable' : 'Mild'
    signals.push({
      id: `derived-mom24-${symbol}`,
      category: 'momentum',
      score: Math.min(99, Math.round(40 + mag * 3)),
      headline: `${strength} ${up ? 'upside' : 'downside'} momentum — ${up ? '+' : ''}${ch24.toFixed(1)}% (24h)`,
      detail: rangeDetail(m) || `${name} is ${up ? 'pushing higher' : 'under pressure'} over the last 24 hours.`,
      createdAt: new Date(now).toISOString(),
      metadata: { direction: up ? 'up' : 'down' },
    })
  }

  // 2. Trend confirmation / divergence over 7d & 30d.
  if (ch7 != null && Math.abs(ch7) >= 3) {
    const up = ch7 > 0
    const diverges = ch24 != null && (ch24 > 0) !== up
    signals.push({
      id: `derived-trend7-${symbol}`,
      category: 'trend',
      score: Math.min(95, Math.round(35 + Math.abs(ch7) * 1.5)),
      headline: diverges
        ? `7d trend ${up ? 'up' : 'down'} ${fmtPct(ch7)} — diverging from today`
        : `7d trend ${up ? 'higher' : 'lower'} ${fmtPct(ch7)}`,
      detail: ch30 != null
        ? `30d: ${fmtPct(ch30)}. ${diverges ? 'Short-term move is fighting the weekly trend.' : 'Weekly and daily are aligned.'}`
        : (diverges ? 'Short-term move is fighting the weekly trend.' : 'Weekly trend in control.'),
      createdAt: new Date(now).toISOString(),
      metadata: { direction: up ? 'up' : 'down' },
    })
  }

  // 3. Catalyst cards from the freshest headlines — the "why". Wide enough to
  // reach back through yesterday's tape, not just the last few hours.
  const catalysts = extractCatalysts(newsItems, { limit: 8, change24h: ch24 })
  for (let i = 0; i < catalysts.length; i++) {
    const c = catalysts[i]
    signals.push({
      id: `derived-cat-${symbol}-${i}`,
      category: 'catalyst',
      // Freshest headline scores highest, decays down the list; structural
      // events (index inclusion, IPO, M&A) get a bump so they lead the feed.
      score: Math.min(95, Math.max(50, 88 - i * 5) + (c.major ? 6 : 0)),
      headline: c.title,
      detail: c.summary || `${c.source}${c.date ? ` · ${relAge(c.date)}` : ''}`,
      createdAt: new Date(c.date || now).toISOString(),
      metadata: { direction: c.direction, url: c.url, source: c.source, major: !!c.major },
    })
  }

  // 4. Volatility flag when the 24h range is wide vs price.
  const price = num(m.price), hi = num(m.high24h), lo = num(m.low24h)
  if (price && hi && lo && hi > lo) {
    const rangePct = ((hi - lo) / price) * 100
    if (rangePct >= 6) {
      signals.push({
        id: `derived-vol-${symbol}`,
        category: 'volatility',
        score: Math.min(90, Math.round(45 + rangePct)),
        headline: `Elevated volatility — ${rangePct.toFixed(1)}% 24h range`,
        detail: `Trading between ${fmtPrice(lo)} and ${fmtPrice(hi)}. Wider swings mean larger position risk.`,
        createdAt: new Date(now).toISOString(),
        metadata: { direction: 'neutral' },
      })
    }
  }

  // Rank: catalysts and the strongest momentum first.
  signals.sort((a, b) => (b.score || 0) - (a.score || 0))
  return signals
}

function rangeDetail(m) {
  const price = num(m.price), hi = num(m.high24h), lo = num(m.low24h)
  if (!price || !hi || !lo) return ''
  const fromLow = ((price - lo) / Math.max(lo, 1e-9)) * 100
  if (fromLow >= 1) return `Up ${fromLow.toFixed(1)}% off the 24h low of ${fmtPrice(lo)}.`
  return `Holding near the 24h low of ${fmtPrice(lo)}.`
}

function fmtPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function fmtPrice(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toPrecision(2)}`
}

export default { extractCatalysts, buildCatalystBlock, deriveSignals }
