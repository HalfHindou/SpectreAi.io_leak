/**
 * KOL Radar — Call Ledger: a KOL's REALIZED, MARKET-FAIR track record.
 * "When they first mentioned $X it was $0.02 -> peaked $0.30 -> now $0.08,
 *  vs BTC over the same window."
 *
 * Two principles so we never misjudge a good caller (e.g. a sharp caller who
 * went quiet / pivoted to stocks in a bear market):
 *   1. Judge every call vs the MARKET (alpha vs BTC) — a flat call while BTC
 *      bled 40% is a GOOD call, not a bad one.
 *   2. Never assign a damning grade on a thin sample — limited data => "Building",
 *      never "Exit Liquidity / F".
 *
 * Sources: X Dash author mentions (earliest tracked mention = call time) +
 * CoinGecko historical (entry@call, peak-since, now) — both verified. Cost-
 * guarded: cap ~12 tokens/profile, hard caches, computed only on profile open.
 */
const X_DASH_BASE = (
  process.env.X_DASH_DIRECT_URL ||
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '')
const X_DASH_API_KEY =
  process.env.XDASH_API_TOKEN ||
  process.env.X_DASH_API_KEY ||
  process.env.DASHBOARD_API_KEY ||
  ''
const CG_BASE = 'https://pro-api.coingecko.com/api/v3'
const CG_KEY = process.env.COINGECKO_API_KEY || ''

const MIN_SCORED_FOR_GRADE = 5 // below this we say "Building", never grade harshly

const _mentions = new Map() // idLower -> { map:Map<cg,ms>, ts }
const _track = new Map()    // handleLower -> { data, ts }
const _arc = new Map()      // `${cg}|${dayBucket}` -> { entry, peak, now, ts }
const _btcEntry = new Map()  // dayBucket -> price
let _btcNow = null
let _btcNowTs = 0
const TRACK_TTL = 60 * 60 * 1000
const MENTIONS_TTL = 30 * 60 * 1000

async function xFetch(path) {
  const res = await fetch(`${X_DASH_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${X_DASH_API_KEY}`,
      'x-api-key': X_DASH_API_KEY,
      'X-Internal-Key': X_DASH_API_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`X Dash ${res.status}`)
  return res.json()
}

async function cgFetch(path) {
  if (!CG_KEY) return null
  try {
    const res = await fetch(`${CG_BASE}${path}`, {
      headers: { 'x-cg-pro-api-key': CG_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// earliest tracked mention time per token for this author (the call time)
async function getCallTimes(kol) {
  const id = String(kol.id || kol.screen_name || '').replace(/^@/, '')
  if (!id) return new Map()
  const ck = id.toLowerCase()
  const c = _mentions.get(ck)
  if (c && Date.now() - c.ts < MENTIONS_TTL) return c.map
  const map = new Map()
  try {
    const d = await xFetch(`/api/author/${encodeURIComponent(id)}?limit=100`)
    for (const t of Array.isArray(d && d.tokens) ? d.tokens : []) {
      const cg = t.cg_id || t.token_id
      const lm = t.first_mention_at || t.latest_mention_at
      if (!cg || !lm) continue
      const ms = new Date(lm).getTime()
      if (Number.isFinite(ms)) map.set(cg, ms)
    }
    for (const m of Array.isArray(d && d.mentions) ? d.mentions : []) {
      const cg = (m.token && (m.token.cg_id || m.token.token_id)) || null
      const ts =
        (m.tweet && (m.tweet.created_at_utc || m.tweet.created_at)) ||
        m.created_at_utc ||
        m.created_at
      if (!cg || !ts) continue
      const ms = new Date(ts).getTime()
      if (Number.isFinite(ms) && (!map.has(cg) || ms < map.get(cg))) map.set(cg, ms)
    }
  } catch {
    /* graceful */
  }
  _mentions.set(ck, { map, ts: Date.now() })
  return map
}

async function getBtcNow() {
  if (_btcNow != null && Date.now() - _btcNowTs < TRACK_TTL) return _btcNow
  const m = await cgFetch('/simple/price?ids=bitcoin&vs_currencies=usd')
  _btcNow = m && m.bitcoin ? m.bitcoin.usd : null
  _btcNowTs = Date.now()
  return _btcNow
}

async function getBtcEntry(callMs) {
  const bucket = Math.floor(callMs / 86400000)
  if (_btcEntry.has(bucket)) return _btcEntry.get(bucket)
  const callSec = Math.floor(callMs / 1000)
  const e = await cgFetch(`/coins/bitcoin/market_chart/range?vs_currency=usd&from=${callSec - 21600}&to=${callSec + 21600}`)
  const price = e && Array.isArray(e.prices) && e.prices.length ? e.prices[Math.floor(e.prices.length / 2)][1] : null
  _btcEntry.set(bucket, price)
  return price
}

async function getPriceArc(cgId, callMs) {
  const bucket = Math.floor(callMs / 86400000)
  const key = `${cgId}|${bucket}`
  const hit = _arc.get(key)
  if (hit && Date.now() - hit.ts < TRACK_TTL) return hit
  const callSec = Math.floor(callMs / 1000)
  const nowSec = Math.floor(Date.now() / 1000)
  let entry = null
  let peak = null
  let now = null
  const e = await cgFetch(`/coins/${cgId}/market_chart/range?vs_currency=usd&from=${callSec - 21600}&to=${callSec + 21600}`)
  if (e && Array.isArray(e.prices) && e.prices.length) entry = e.prices[Math.floor(e.prices.length / 2)][1]
  if (nowSec - callSec > 86400) {
    const p = await cgFetch(`/coins/${cgId}/market_chart/range?vs_currency=usd&from=${callSec}&to=${nowSec}`)
    if (p && Array.isArray(p.prices) && p.prices.length) {
      const ps = p.prices.map((x) => x[1])
      peak = Math.max(...ps)
      now = ps[ps.length - 1]
    }
  }
  const arc = { entry, peak, now, ts: Date.now() }
  _arc.set(key, arc)
  return arc
}

// status is MARKET-AWARE: beating BTC while flat is a win, not a loss.
function statusOf(cx, btcX) {
  if (cx == null) return 'unknown'
  const beat = btcX ? cx >= btcX : null
  if (cx <= 0.2) return 'dead' // a genuine corpse regardless of market
  if (cx >= 2) return 'win'
  if (beat && cx >= 0.75) return 'win' // held up + beat BTC = a good call
  if (cx < 0.6 && beat === false) return 'loss'
  return 'flat'
}

async function getKolTrackRecord(kol, pushes, healthMap) {
  const handle = String(kol.screen_name || '').toLowerCase()
  if (!handle) return emptyTrack()
  const c = _track.get(handle)
  if (c && Date.now() - c.ts < TRACK_TTL) return c.data

  const callTimes = await getCallTimes(kol)
  const btcNow = await getBtcNow()
  const list = (pushes && pushes.length ? pushes : kol.pushes || []).slice(0, 12)
  const calls = []
  for (const p of list) {
    const cg = p.cg_id
    if (!cg) continue
    const callMs = callTimes.get(cg)
    if (!callMs) continue
    const { entry, peak, now } = await getPriceArc(cg, callMs)
    const current_x = entry && now ? now / entry : null
    const peak_x = entry && peak ? peak / entry : null
    let btc_x = null
    let alpha_pct = null
    if (current_x != null && btcNow) {
      const btcEntry = await getBtcEntry(callMs)
      if (btcEntry) {
        btc_x = btcNow / btcEntry
        alpha_pct = Math.round((current_x - btc_x) * 100)
      }
    }
    calls.push({
      cg_id: cg,
      symbol: p.symbol,
      name: p.name,
      image: p.image,
      market_cap: (healthMap && typeof healthMap.get === 'function' && (healthMap.get(cg) || {}).market_cap) || null,
      called_at: new Date(callMs).toISOString(),
      entry_price: entry,
      current_price: now,
      peak_price: peak,
      peak_x,
      current_x,
      btc_x,
      alpha_pct, // call return minus BTC return over the same window (percentage points)
      beat_market: btc_x != null && current_x != null ? current_x >= btc_x : null,
      status: statusOf(current_x, btc_x),
    })
  }

  const scored = calls.filter((c) => c.current_x != null)
  const withAlpha = scored.filter((c) => c.alpha_pct != null)
  const returns = scored.map((c) => (c.current_x - 1) * 100)
  const alphas = withAlpha.map((c) => c.alpha_pct)
  // a "hit" = beat the market OR a clean 2x — market-fair
  const hits = scored.filter((c) => c.beat_market === true || c.current_x >= 2).length
  const beats = withAlpha.filter((c) => c.beat_market === true).length
  const sortedR = [...returns].sort((a, b) => a - b)
  const best = scored.reduce((a, c) => (!a || (c.peak_x || c.current_x) > (a.peak_x || a.current_x) ? c : a), null)
  const worst = scored.reduce((a, c) => (!a || c.current_x < a.current_x ? c : a), null)

  const track_record = {
    calls: calls.sort((a, b) => new Date(b.called_at) - new Date(a.called_at)),
    total_calls: calls.length,
    scored_count: scored.length,
    hit_rate: scored.length ? Math.round((hits / scored.length) * 100) : null,
    market_beat_rate: withAlpha.length ? Math.round((beats / withAlpha.length) * 100) : null,
    avg_return_pct: returns.length ? Math.round(returns.reduce((a, b) => a + b, 0) / returns.length) : null,
    avg_alpha_pct: alphas.length ? Math.round(alphas.reduce((a, b) => a + b, 0) / alphas.length) : null,
    median_return_pct: sortedR.length ? Math.round(sortedR[Math.floor(sortedR.length / 2)]) : null,
    best: best ? { symbol: best.symbol, x: Number((best.peak_x || best.current_x).toFixed(1)) } : null,
    worst: worst && worst.current_x != null ? { symbol: worst.symbol, x: Number(worst.current_x.toFixed(2)) } : null,
    // honest about the data: this is recent tracked calls, market-adjusted.
    sample: scored.length >= MIN_SCORED_FOR_GRADE ? 'sufficient' : 'limited',
    note:
      scored.length < MIN_SCORED_FOR_GRADE
        ? 'Limited recent crypto calls — building track record (not graded harshly on thin data).'
        : 'Recent tracked calls, returns shown vs BTC over the same window.',
  }
  _track.set(handle, { data: track_record, ts: Date.now() })
  return track_record
}

function emptyTrack() {
  return {
    calls: [], total_calls: 0, scored_count: 0, hit_rate: null, market_beat_rate: null,
    avg_return_pct: null, avg_alpha_pct: null, median_return_pct: null, best: null, worst: null,
    sample: 'none', note: 'No tracked calls with price history yet.',
  }
}

// ── Archetypes (market-fair, sample-gated) ──────────────────────────────────
const ARCHETYPE_META = {
  'early-sniper': { label: 'Early Sniper', tone: 'green' },
  'market-beater': { label: 'Market Beater', tone: 'green' },
  consistent: { label: 'Consistent', tone: 'green' },
  diamond: { label: 'Diamond Hands', tone: 'green' },
  'exit-liquidity': { label: 'Exit Liquidity', tone: 'red' },
  'rug-magnet': { label: 'Rug Magnet', tone: 'red' },
  building: { label: 'Building', tone: 'grey' },
  unproven: { label: 'Unproven', tone: 'grey' },
}

// NEVER label a KOL negatively on a thin/old sample. Damning archetypes require
// a real sample AND genuine market-adjusted underperformance.
function classifyArchetype(kol, tr, opts = {}) {
  const sc = (tr && tr.scored_count) || 0
  if (sc === 0) return 'unproven'
  if (sc < MIN_SCORED_FOR_GRADE) return 'building' // limited data -> never "exit liquidity"
  const beatRate = tr.market_beat_rate != null ? tr.market_beat_rate : tr.hit_rate || 0
  const avgAlpha = tr.avg_alpha_pct != null ? tr.avg_alpha_pct : 0
  const dead = tr.calls.filter((c) => c.status === 'dead').length / Math.max(1, tr.calls.length)
  const prePush = opts.prePushShare || 0
  // negative labels: require strong evidence
  if (dead >= 0.45 && sc >= 6) return 'rug-magnet'
  if (beatRate < 25 && avgAlpha < -30 && sc >= 6) return 'exit-liquidity'
  // positive labels
  if (prePush >= 0.5 && beatRate >= 45) return 'early-sniper'
  if (avgAlpha >= 80) return 'diamond'
  if (beatRate >= 55) return 'market-beater'
  if (beatRate >= 40 && dead < 0.25) return 'consistent'
  return 'building'
}

// credibility prefers REALIZED, market-adjusted performance; thin data -> neutral.
function computeCredibility(trackRecord, legitimacy) {
  const tr = trackRecord || {}
  const lg = legitimacy || {}
  if ((tr.scored_count || 0) >= MIN_SCORED_FOR_GRADE && tr.market_beat_rate != null) {
    // base on market-beat-rate + alpha; health legit is a light temper only
    let score = tr.market_beat_rate * 0.75 + Math.max(-15, Math.min(30, (tr.avg_alpha_pct || 0) / 4)) + (lg.score || 0) * 0.1
    score = Math.max(0, Math.min(100, Math.round(score)))
    const grade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 25 ? 'D' : 'F'
    return { score, grade, basis: 'realized' }
  }
  // limited data: do NOT punish — neutral, mark it.
  return { score: null, grade: '—', basis: 'limited' }
}

module.exports = { getKolTrackRecord, classifyArchetype, computeCredibility, ARCHETYPE_META }
