/**
 * presentationCues - the sync brain of the agent's presentations. Pure
 * functions (no React, node-testable): given the reply TEXT the voice is
 * speaking and a visual payload, find WHEN each visual element should draw -
 * the demand zone as he says "demand", the EMA line as he says "EMA", an
 * account card as he names the account. Chirp gives no word timestamps, so
 * position = proportional character offset across the known audio duration
 * (the model proven by the v2 speech HUD).
 *
 * Cue shape: { key, at (0..1 fraction of the speech), label } sorted by at.
 * Elements never mentioned get FALLBACK slots spread across the middle of
 * the speech - everything always draws, mentioned things draw on cue.
 */

export function fmtPrice(v) {
  if (!Number.isFinite(v)) return ''
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.01) return v.toFixed(4)
  return v.toPrecision(3)
}

export function fmtCount(v) {
  if (!Number.isFinite(v)) return ''
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(v)
}

// Speak-ahead factor: reveal slightly BEFORE the word lands (the v2 HUD used
// 0.92 on chips) so the eye is on the element as the voice reaches it.
const LEAD = 0.94

/** Characters are not speech-time: "22.9K" takes ~4x longer to SAY than its
    chars suggest ("twenty two point nine thousand"), so plain char-fraction
    cues drift late after every number. Weight digits and spoken symbols
    heavier; use the SAME weighting on both sides of the sync (cue positions
    here, segment bases in useVoiceSession) so fractions stay comparable. */
const chWeight = (c) => (c >= '0' && c <= '9' ? 4 : (c === '%' || c === '$') ? 7 : 1)
export function spokenFrac(text, index) {
  const s = String(text || '')
  let acc = 0
  let total = 0
  const cut = Math.min(Math.max(0, index), s.length)
  for (let i = 0; i < s.length; i++) {
    const w = chWeight(s[i])
    total += w
    if (i < cut) acc += w
  }
  return total ? acc / total : 0
}

/** Fraction of `text` at which `re` first matches, or null. `lead` < 1
    reveals slightly before the word; chart elements use ~1 so the zone
    appears ON the word ("not before and not after" - live feedback). */
function matchAt(text, re, lead = LEAD) {
  const m = re.exec(text)
  return m ? spokenFrac(text, m.index + m[0].length / 2) * lead : null
}

/** Raw index of a handle mention at/after fromIndex - survives the voice
    speaking "Cross Chain Chad" for @CrossChainChad (search the reply with
    all non-alphanumerics stripped, map the compact index back). Null when
    the account is never named. */
function handleIdxFrom(text, handle, fromIndex = 0) {
  const lower = String(text || '').toLowerCase()
  const h = String(handle || '').toLowerCase()
  if (!h) return null
  let i = lower.indexOf(`@${h}`, fromIndex)
  if (i < 0) i = lower.indexOf(h, fromIndex)
  if (i >= 0) return i
  const compactHandle = h.replace(/[^a-z0-9]/g, '')
  if (compactHandle.length < 4) return null // too short to match safely spaced-out
  let compact = ''
  const backMap = []
  for (let k = 0; k < lower.length; k++) {
    const ch = lower[k]
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) { compact += ch; backMap.push(k) }
  }
  let cFrom = 0
  while (cFrom < backMap.length && backMap[cFrom] < fromIndex) cFrom++
  const idx = compact.indexOf(compactHandle, cFrom)
  if (idx < 0) return null
  return backMap[Math.min(backMap.length - 1, idx + Math.floor(compactHandle.length / 2))]
}

function matchHandleAt(text, handle) {
  const idx = handleIdxFrom(text, handle, 0)
  return idx == null ? null : spokenFrac(text, idx) * LEAD
}

const CHART_MATCHERS = [
  ['zones-demand', /demand|support|floor|buy(?:er)?s\b|accumulat/i],
  ['zones-supply', /supply|resistance|ceiling|sellers|overhead/i],
  ['ema', /\bema\b|moving average|\b8.{0,4}21\b/i],
  ['vwap', /\bvwap\b|volume.?weighted|average price/i],
]
// Chart elements land ON the word, not ahead of it.
const CHART_LEAD = 0.99

function chartCues(text, visual) {
  const cues = [{ key: 'candles', at: 0, label: null }] // candles always open the scene
  const zones = Array.isArray(visual.zones) ? visual.zones : []
  const strongest = (type) => zones.filter((z) => z.type === type).sort((a, b) => (b.touches || 0) - (a.touches || 0))[0]
  const present = {
    'zones-demand': !!strongest('demand'),
    'zones-supply': !!strongest('supply'),
    ema: !!(visual.ema && visual.ema.fast?.length),
    vwap: Number.isFinite(visual.vwap),
  }
  const labels = {
    'zones-demand': present['zones-demand'] ? `DEMAND ${fmtPrice(strongest('demand').price)}` : null,
    'zones-supply': present['zones-supply'] ? `SUPPLY ${fmtPrice(strongest('supply').price)}` : null,
    ema: 'EMA 8/21',
    vwap: 'VWAP',
  }
  const unmatched = []
  for (const [key, re] of CHART_MATCHERS) {
    if (!present[key]) continue
    const at = matchAt(text, re, CHART_LEAD)
    if (at != null) cues.push({ key, at, label: labels[key] })
    else unmatched.push({ key, label: labels[key] })
  }
  // Current-price spotlight: MATCHED-ONLY (the price pill is always
  // visible; the highlight only fires when he actually talks about it).
  if (Number.isFinite(visual.lastClose)) {
    const at = matchAt(text, /current(?:ly)? (?:price|trading|sitting|at)|price (?:is|sits|of|at|action)|trading at|sitting at|last close|right now|hovering/i, CHART_LEAD)
    if (at != null) cues.push({ key: 'price', at, label: `PRICE ${fmtPrice(visual.lastClose)}` })
  }
  // Volume slide: MATCHED-ONLY - when the voice moves to turnover, the
  // stage swaps to daily volume bars (needs v in the bar tuples).
  if ((visual.bars || []).some((b) => Number.isFinite(b?.[5]) && b[5] > 0)) {
    const at = matchAt(text, /\bvolumes?\b|turnover|traded (?:value|amount)|trading activity/i, CHART_LEAD)
    if (at != null) cues.push({ key: 'volume', at, label: 'VOLUME' })
  }
  return { cues, unmatched }
}

const POST_STOPWORDS = new Set(['about', 'their', 'there', 'these', 'those', 'which', 'while', 'today', 'still', 'https', 'because', 'every', 'first', 'going', 'being'])

/** Where the reply REALLY talks about THIS post. Density-scored: among all
    occurrences of the post's distinctive words (searched from `fromIndex` -
    posts are narrated in order, so each anchors AFTER the previous one),
    pick the spot with the most of the post's words within ~110 chars. A
    preamble that name-drops every post scores 1; the detail sentence about
    the post scores several - the slide waits for the detail. Returns the
    raw char index (caller converts to spoken fraction). */
function postCueIdx(text, postText, fromIndex = 0) {
  const lower = text.toLowerCase()
  const tokens = [...new Set(String(postText || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !POST_STOPWORDS.has(w)))].slice(0, 12)
  let best = null // { idx, score }
  for (const tok of tokens) {
    let idx = lower.indexOf(tok, fromIndex)
    while (idx >= 0) {
      let score = 0
      for (const t2 of tokens) {
        const j = lower.indexOf(t2, idx)
        if (j >= 0 && j - idx < 110) score++
      }
      if (!best || score > best.score || (score === best.score && idx < best.idx)) best = { idx, score }
      idx = lower.indexOf(tok, idx + 1)
    }
  }
  return best ? best.idx : null
}

function xActivityCues(text, visual) {
  const cues = [{ key: 'header', at: 0, label: null }]
  const unmatched = []
  for (const a of visual.accounts || []) {
    const key = `acct-${a.handle.toLowerCase()}`
    const label = `@${a.handle}${a.followers ? ` · ${fmtCount(a.followers)} followers` : ''}`
    const at = matchHandleAt(text, a.handle)
    if (at != null) cues.push({ key, at, label })
    else unmatched.push({ key, label })
  }
  // The chronological post rail: each post anchors on the EARLIEST of (a)
  // its ORDINAL ("the first post...", "the second...") - the prompt makes
  // the model introduce every post this way, so this is the deterministic
  // anchor; (b) its author's name mention; (c) the reply region densest in
  // the post's own words. All searched after the previous post's anchor -
  // narration order drives the deck.
  const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
  const ordinalIdxFrom = (i, fromIndex) => {
    const word = ORDINALS[i]
    if (!word) return null
    const re = new RegExp(`\\b${word}\\b`, 'i')
    const m = re.exec(text.slice(fromIndex))
    return m ? fromIndex + m.index : null
  }
  let postCursor = 0
  ;(visual.posts || []).forEach((p, i) => {
    const key = `post-${i}`
    const label = `POST ${i + 1} · @${p.handle}`
    const cands = [
      ordinalIdxFrom(i, postCursor),
      handleIdxFrom(text, p.handle, postCursor),
      postCueIdx(text, p.text, postCursor),
    ].filter((x) => x != null)
    if (cands.length) {
      const idx = Math.min(...cands)
      postCursor = idx + 1
      cues.push({ key, at: spokenFrac(text, idx) * LEAD, label })
    } else unmatched.push({ key, label })
  })
  if (visual.timeline?.length) {
    const at = matchAt(text, /mentions|activity|chatter|post(?:s|ing)|talk(?:ing)?\b/i)
    if (at != null) cues.push({ key: 'timeline', at, label: 'POST ACTIVITY' })
    else unmatched.push({ key: 'timeline', label: 'POST ACTIVITY' })
  }
  return { cues, unmatched }
}

/**
 * extractCues(text, visual) -> { cues: [{key, at, label}], anchor }
 * anchor = earliest MATCHED content cue (scene ordering for multi-visual
 * turns); falls back to 0 when nothing matched.
 */
export function extractCues(text, visual) {
  const clean = String(text || '')
  const { cues, unmatched } =
    visual?.kind === 'x_activity' ? xActivityCues(clean, visual) : chartCues(clean, visual || {})

  // Fallback slots: spread the never-mentioned elements across the middle of
  // the speech, after the last matched cue, so the scene keeps building.
  // Tagged `staged` - consumers can tell a real narration anchor from a
  // filler slot (the slide deck skips staged posts when any post matched).
  const lastMatched = cues.reduce((m, c) => Math.max(m, c.at), 0)
  const start = Math.min(0.75, Math.max(0.22, lastMatched + 0.08))
  unmatched.forEach((u, i) => {
    cues.push({ ...u, at: start + ((0.85 - start) * i) / Math.max(1, unmatched.length - 1 || 1), staged: true })
  })

  cues.sort((a, b) => a.at - b.at)
  const contentCues = cues.filter((c) => c.key !== 'candles' && c.key !== 'header')
  const matchedAts = contentCues.length ? contentCues.map((c) => c.at) : [0]
  return { cues, anchor: Math.min(...matchedAts) }
}

/** Spoken figures -> terminal chips (moved from the v2 speech HUD):
    "3.67 million dollar" -> $3.67M, "10114 dollars" -> $10,114. */
const LABEL_WORDS = [
  ['market cap', 'MARKET CAP'], ['mcap', 'MARKET CAP'], ['fdv', 'FDV'],
  ['volume', 'VOLUME'], ['liquidity', 'LIQUIDITY'], ['price', 'PRICE'],
  ['holders', 'HOLDERS'], ['supply', 'SUPPLY'], ['tax', 'TAX'],
  ['mentions', 'MENTIONS'], ['followers', 'FOLLOWERS'], ['days', 'AGE'],
  ['concentration', 'TOP HOLDERS'], ['impact', 'IMPACT'],
]

export function extractStats(text) {
  const stats = []
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand)?\s*(dollars?|percent|%)?/gi
  let m
  while ((m = re.exec(text)) && stats.length < 4) {
    const [raw, numStr, scale, unit] = m
    if (!unit && !scale) {
      // Bare numbers only qualify with a strong label nearby, either side
      // ("5100 holders" / "holders sit at 5100").
      const back = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase()
      const ahead = text.slice(m.index + raw.length, m.index + raw.length + 20).toLowerCase()
      const strong = /(holders|mentions|followers|days|supply)/
      if (!strong.test(back) && !strong.test(ahead)) continue
    }
    const num = parseFloat(numStr.replace(/,/g, ''))
    if (!Number.isFinite(num) || num === 0) continue

    let value
    if (unit && /percent|%/.test(unit)) {
      value = `${num}%`
    } else if (unit && /dollar/.test(unit)) {
      if (scale === 'billion') value = `$${num}B`
      else if (scale === 'million') value = `$${num}M`
      else if (scale === 'thousand') value = `$${num}K`
      else value = `$${num.toLocaleString('en-US')}`
    } else if (scale) {
      value = `${num}${scale === 'billion' ? 'B' : scale === 'million' ? 'M' : 'K'}`
    } else {
      value = num.toLocaleString('en-US')
    }

    const before = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase()
    const after = text.slice(m.index + raw.length, m.index + raw.length + 30).toLowerCase()
    let label = null
    let best = -1
    // Closeness to the figure on BOTH sides, same scale (a label right
    // before the number must beat a different label a clause later).
    for (const [needle, out] of LABEL_WORDS) {
      const atBefore = before.lastIndexOf(needle)
      if (atBefore >= 0) {
        const gap = before.length - (atBefore + needle.length) // chars between label end and figure
        const score = 60 - gap
        if (score > best) { best = score; label = out }
      }
      const atAfter = after.indexOf(needle)
      if (atAfter >= 0) {
        const score = 60 - atAfter
        if (score > best) { best = score; label = out }
      }
    }
    if (!label) continue
    if (stats.some((s) => s.label === label)) continue
    stats.push({ label, value, at: m.index + raw.length / 2, frac: spokenFrac(text, m.index + raw.length / 2) })
  }
  return stats
}
