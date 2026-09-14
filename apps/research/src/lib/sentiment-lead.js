/**
 * Sentiment vs price — what moved first, what followed, and what it means now.
 *
 * Deterministic. No model. Everything here is arithmetic over the two series
 * already on screen, so a reader can check any number against the chart.
 *
 * The question this answers is the one people actually ask of the overlay:
 * "did Fear & Greed move before the price, or after?" A correlation coefficient
 * technically answers it and tells a human nothing. So instead this finds the
 * real EPISODES — the biggest moves in the window — and dates them.
 *
 * Three passes:
 *   1. Episodes — the entity's largest H-day moves, deduped so one drawdown
 *      isn't counted as four overlapping ones.
 *   2. Lead    — for each episode, the strongest same-direction F&G shock in
 *      the days before it. The gap is the lead, in days.
 *   3. Now     — every other day in the window where F&G sat about where it
 *      sits today, and what the entity did over the following fortnight.
 *
 * Honest by construction: an episode with no matching sentiment shock is
 * reported as unmatched rather than quietly dropped, and the "now" read only
 * appears with enough precedents to be worth printing.
 */
const DAY = 86400

function toDaily(points, tsKey, valKey) {
  const m = new Map()
  for (const p of points) {
    const v = Number(p[valKey])
    if (Number.isFinite(v)) m.set(Math.floor(p[tsKey] / DAY), v)  // last read of the day wins
  }
  return m
}

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/* The compare API normalises every series to "% since the window opened", so
   the gap between two of those is NOT the return between those two dates.
   Undo the normalisation to get the real one. */
function retBetween(pct, i, j) {
  const a = 1 + pct[i] / 100
  const b = 1 + pct[j] / 100
  if (!(a > 0)) return 0
  return (b / a - 1) * 100
}

export function analyseSentimentLead({ fngPoints, entities, colors }) {
  if (!fngPoints?.length || !entities?.length) return null

  const fMap = toDaily(fngPoints, 't', 'v')
  const days = [...fMap.keys()].sort((a, b) => a - b)
  if (days.length < 30) return null
  const f = days.map((d) => fMap.get(d))
  const span = days.length

  // Horizon for "a move", lookback for "a sentiment shock", and how far ahead
  // of a move sentiment is still allowed to count as having led it. All scale
  // with the window: a 3-day lead means something over 7D and nothing over 1Y.
  const H = span > 200 ? 7 : span > 90 ? 5 : 3
  const W = span > 200 ? 5 : 3
  // Hard 7-day ceiling on what counts as a lead, whatever the window. Fear &
  // Greed swings 8+ points most fortnights, so a wide search window finds a
  // "matching" shock before almost any move and the finding becomes noise —
  // an earlier cut allowed 12 days on 1Y and duly reported a 9-day median.
  const MAX_LEAD = Math.max(2, Math.min(7, Math.round(span / 14)))
  const FNG_SHOCK = 8      // index points
  const MOVE_FLOOR = 3     // percent

  const rows = entities.map((ent, idx) => {
    if (!ent.data || ent.data.length < 20) return null
    const eMap = toDaily(ent.data, 'ts', 'pct')
    const e = []
    let carry = null
    for (const d of days) {
      const v = eMap.has(d) ? eMap.get(d) : carry
      if (v == null) { e.push(null); continue }
      carry = v
      e.push(v)
    }
    const start = e.findIndex((v) => v != null)
    if (start < 0 || e.length - start < 25 || e.slice(start).some((v) => v == null)) return null

    // ── 1. episodes ──
    const candidates = []
    for (let i = start; i + H < e.length; i++) candidates.push({ i, ret: retBetween(e, i, i + H) })
    candidates.sort((a, b) => Math.abs(b.ret) - Math.abs(a.ret))
    const episodes = []
    for (const c of candidates) {
      if (Math.abs(c.ret) < MOVE_FLOOR) break
      if (episodes.some((p) => Math.abs(p.i - c.i) < H + 2)) continue
      episodes.push(c)
      if (episodes.length >= 8) break
    }
    if (episodes.length < 3) return null

    // ── 2. lead ──
    const dated = episodes.map((m) => {
      let bestU = null, bestD = 0
      // Control arm: the same search for a shock pointing the WRONG way. If
      // sentiment were really leading, same-direction hits should clearly beat
      // these; if they don't, we are just finding F&G's normal chop.
      let control = false
      for (let u = Math.max(W, m.i - MAX_LEAD); u <= m.i; u++) {
        const d = f[u] - f[u - W]
        if (Math.abs(d) < FNG_SHOCK) continue
        if (Math.sign(d) !== Math.sign(m.ret)) { control = true; continue }
        if (Math.abs(d) <= Math.abs(bestD)) continue
        bestD = d
        bestU = u
      }

      // Nothing in front of it? Look just AFTER. "Price moved, sentiment caught
      // up two days later" is the answer to the question, not a blank.
      let after = null
      if (bestU == null) {
        for (let u = m.i + 1; u <= Math.min(f.length - 1, m.i + H); u++) {
          const d = f[u] - f[u - W]
          if (Math.sign(d) !== Math.sign(m.ret) || Math.abs(d) < FNG_SHOCK) continue
          after = { lag: u - m.i, delta: d, to: f[u], ts: days[u] * DAY }
          break
        }
      }

      return {
        control,
        after,
        ret: m.ret,
        moveTs: days[m.i] * DAY,
        moveEndTs: days[Math.min(m.i + H, days.length - 1)] * DAY,
        horizon: H,
        lead: bestU == null ? null : m.i - bestU,
        fngDelta: bestU == null ? null : bestD,
        fngTo: bestU == null ? null : f[bestU],
        fngTs: bestU == null ? null : days[bestU] * DAY,
      }
    }).sort((a, b) => Math.abs(b.ret) - Math.abs(a.ret))

    const matched = dated.filter((d) => d.lead != null)
    const led = matched.filter((d) => d.lead >= 1)
    const sameDay = matched.filter((d) => d.lead === 0)
    const controls = dated.filter((d) => d.control).length
    const followed = dated.filter((d) => d.lead == null && d.after).length

    // ── 3. now ──
    const nowF = f[f.length - 1]
    const FWD = Math.min(14, Math.max(5, Math.round(span / 12)))
    const echoes = []
    for (let i = start; i < e.length - FWD - 1; i++) {
      if (Math.abs(f[i] - nowF) <= 6) echoes.push(retBetween(e, i, i + FWD))
    }
    const echo = echoes.length >= 4
      ? { n: echoes.length, med: median(echoes), fwd: FWD, up: echoes.filter((r) => r > 0).length }
      : null
    // No precedent is itself the headline, not a blank space.
    const hist = f.slice(start)
    const extreme = nowF >= Math.max(...hist) - 1 ? 'high' : nowF <= Math.min(...hist) + 1 ? 'low' : null

    return {
      key: `${ent.type}:${ent.id}`,
      name: ent.name,
      color: colors[idx % colors.length],
      episodes: dated,
      matched: matched.length,
      total: dated.length,
      ledCount: led.length,
      sameDayCount: sameDay.length,
      controlCount: controls,
      followedCount: followed,
      // A lead is only claimed when same-direction shocks clearly outnumber
      // the wrong-direction ones over the same search window.
      beatsChance: led.length + sameDay.length > controls + 1,
      medianLead: led.length ? Math.round(median(led.map((d) => d.lead))) : 0,
      echo,
      extreme,
      horizon: H,
      maxLead: MAX_LEAD,
    }
  }).filter(Boolean)

  if (!rows.length) return null

  const avg = f.reduce((a, b) => a + b, 0) / f.length
  const now = f[f.length - 1]
  const lookback = Math.min(10, f.length - 1)
  const drift = now - f[f.length - 1 - lookback]

  return { rows, now, avg, drift, driftDays: lookback, days: span }
}

export default analyseSentimentLead
