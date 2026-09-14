/**
 * Rug signal — deterministic "is this token rugged / does it look rugged?"
 * WARNING label for an X Dash / token row.
 *
 * This is NOT a trade or alpha signal. It is a defensive, backward-looking
 * FACT: the token collapsed and shows rug hallmarks — catastrophic price
 * collapse, liquidity pulled, volume dead (can't exit), and/or X chatter
 * openly calling a rug — especially after it was prominent enough to ride the
 * X Dash board.
 *
 * The lesson it encodes: a token that trended in the top of X Dash and then
 * went to ~0 must be LOUDLY tagged, so a stale leaderboard spot or a lingering
 * mention spike never reads as "still alive / still bullish".
 *
 *   computeRugSignal(input) -> { tag, label, score, tier, reasons, thesis, change }
 *     tag:   'rug' | null
 *     label: 'Rugged' | 'Rug Risk'
 *     tier:  'high' | 'med' | 'low' | 'none'
 *
 * Pure function, no deps — duplicated in apps/research (no cross-app imports).
 */

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export const RUG_LABELS = { rugged: 'Rugged', risk: 'Rug Risk' }

const NONE = { tag: null, label: null, score: 0, tier: 'none', reasons: [], thesis: '' }

// Words that, carried by multiple recent mentions, corroborate a rug.
const RUG_WORDS = /\b(rug(ged|ging|pull|s|pulled)?|scam(med)?|honeypot|exit[\s-]?scam|dev\s?(sold|dumped|gone|ran)|sold\s?(everything|the\s?bag|out|it\s?all)|liquidity\s?(pull|pulled|removed|gone|yanked)|abandon(ed)?|deleted\s?(tg|telegram|x|twitter))\b/i

export function computeRugSignal(input = {}) {
  const change =
    input.change24h == null || input.change24h === '' ? null : num(input.change24h)
  // Longer windows (CG) — a token can be flat in the last 24h yet have died
  // within the last week/month. This is what catches an already-dead rug whose
  // acute drop is no longer in the 24h window.
  const change7d = input.change7d == null || input.change7d === '' ? null : num(input.change7d)
  const change30d = input.change30d == null || input.change30d === '' ? null : num(input.change30d)
  // % below all-time high (CG ath_change_percentage, negative). A corroborator,
  // NOT a standalone trigger — plenty of healthy tokens sit deep off ATH.
  const offHighPct = input.offHighPct == null || input.offHighPct === '' ? null : num(input.offHighPct)
  const marketCap = num(input.marketCap)
  const volume24 = num(input.volume24)
  const liquidity = num(input.liquidity)
  const rugChatterHits = num(input.rugChatterHits)
  const totalMentions = num(input.totalMentions)
  const mentions24h = num(input.mentions24h)
  const cashtagOnly = num(input.cashtagOnlyShare24h)
  const wasIndexed = !!input.wasIndexed

  // Structural hallmarks — guarded so 0/unknown never trips them. (Codex.)
  const liqRatio = marketCap > 0 && liquidity > 0 ? liquidity / marketCap : null
  const volRatio = marketCap > 0 && volume24 >= 0 ? volume24 / marketCap : null
  const liqDead = liqRatio != null && liqRatio < 0.004 // LP < 0.4% of mcap = pulled
  const volDead = volRatio != null && marketCap > 0 && volRatio < 0.0025 // turnover < 0.25% = can't exit
  const structuralDeath = liqDead && volDead // LP pulled AND no trades = a husk

  // Social: 2 distinct rug mentions corroborate; 3+ is a chorus that can stand alone.
  const chatterStrong = rugChatterHits >= 3
  const chatter = rugChatterHits >= 2

  // "Mattered" — a real thing that died (the lesson). On X Dash it's indexed;
  // on a bare token hero, fall back to having had real mention volume.
  const wasProminent = wasIndexed || totalMentions >= 25 || mentions24h >= 8

  // Collapse magnitude across windows.
  const catastrophic = change != null && change <= -82
  const hardDump = change != null && change <= -65
  const bigDump = change != null && change <= -45
  const recent7dDeath = change7d != null && change7d <= -78
  const recent30dDeath = change30d != null && change30d <= -88
  const offHighDead = offHighPct != null && offHighPct <= -92

  // Gate: a genuine collapse (any window) OR an explicit rug chorus OR a dead
  // husk — never a normal red day. The softer bands require corroboration so a
  // -50% wick or a deep-off-ATH-but-alive token can't false-flag.
  const collapsed =
    chatterStrong ||
    catastrophic ||
    (hardDump && (liqDead || volDead || wasProminent || chatter)) ||
    (bigDump && (liqDead || volDead) && (wasProminent || chatter)) ||
    ((recent7dDeath || recent30dDeath) && (wasProminent || liqDead || volDead || chatter)) ||
    (wasProminent && structuralDeath)

  if (!collapsed) return NONE

  let score = 0
  const reasons = []
  // Worst single-day move
  if (catastrophic) { score += 60; reasons.push(`${Math.round(change)}% / 24h`) }
  else if (hardDump) { score += 48; reasons.push(`${Math.round(change)}% / 24h`) }
  else if (bigDump) { score += 30; reasons.push(`${Math.round(change)}% / 24h`) }
  // Longer-window collapse (additive — a 24h-flat token can still be 7d-dead)
  if (recent7dDeath) { score += 40; reasons.push(`${Math.round(change7d)}% / 7d`) }
  else if (recent30dDeath) { score += 32; reasons.push(`${Math.round(change30d)}% / 30d`) }
  if (liqDead) { score += 18; reasons.push('liquidity drained') }
  if (volDead) { score += 14; reasons.push('volume dead - no exit') }
  if (structuralDeath && wasProminent) score += 20 // was on the board, now a husk
  if (offHighDead) { score += 12; reasons.push(`${Math.round(offHighPct)}% off ATH`) }
  if (chatterStrong) score += 50
  else if (chatter) score += 34
  if (chatter) reasons.push('rug chatter on X')
  if (cashtagOnly >= 0.7 && (bigDump || hardDump)) { score += 8; reasons.push('cashtag-only promo') }
  if (wasProminent && (hardDump || catastrophic || recent7dDeath)) score += 8
  score = Math.min(100, score)

  if (score < 45) return NONE

  const tier = score >= 78 ? 'high' : score >= 58 ? 'med' : 'low'
  const confirmed = score >= 70
  const label = confirmed ? RUG_LABELS.rugged : RUG_LABELS.risk
  // Lead with the WORST available window so a 24h-flat husk doesn't read "+0%".
  const worst = [
    change7d != null ? { v: change7d, w: '7d' } : null,
    change != null ? { v: change, w: '24h' } : null,
    change30d != null ? { v: change30d, w: '30d' } : null,
  ].filter(Boolean).sort((a, b) => a.v - b.v)[0]
  const chgTxt = worst
    ? `${worst.v >= 0 ? '+' : ''}${Math.round(worst.v)}% / ${worst.w}`
    : structuralDeath ? 'liquidity & volume gone' : 'price collapsed'
  const extras = reasons.filter((r) => !/%/.test(r)).slice(0, 2)
  const thesis =
    `${confirmed ? 'Looks rugged' : 'Rug risk'}: ${chgTxt}` +
    `${extras.length ? ' · ' + extras.join(', ') : ''}. ` +
    `Exit liquidity may be gone — treat any lingering X attention as a stale/trap signal, not a live call.`

  return { tag: 'rug', label, score, tier, reasons, thesis, change }
}

/** Count recent mentions whose text references a rug / exit-scam. */
function countRugChatter(intel) {
  const mentions = Array.isArray(intel?.mentions)
    ? intel.mentions
    : Array.isArray(intel?.token?.mentions)
    ? intel.token.mentions
    : []
  if (!mentions.length) return 0
  let hits = 0
  for (const mm of mentions.slice(0, 80)) {
    const text =
      mm?.tweet?.text ||
      mm?.tweet?.full_text ||
      mm?.text ||
      mm?.body ||
      ''
    if (typeof text === 'string' && text && RUG_WORDS.test(text)) hits++
  }
  return hits
}

/**
 * Convenience: map a raw X Dash /token payload (+ the on-chain stats from
 * useOnChainPeerData) to a rug signal. Mirrors fadeSignalFromXDash.
 */
export function rugSignalFromXDash(intel, onChainStats, drawdown) {
  const m = intel?.metrics || intel?.token?.metrics || {}
  const q = intel?.quality || intel?.token?.quality || {}
  return computeRugSignal({
    change24h: onChainStats?.priceChange24h,
    // Longer windows + off-high come from Codex daily bars (useCodexDrawdown) —
    // the X Dash / Codex stats payload is intraday-only (1h/4h/12h/24h).
    change7d: drawdown?.change7d,
    change30d: drawdown?.change30d,
    offHighPct: drawdown?.offHighPct,
    marketCap: onChainStats?.marketCap,
    volume24: onChainStats?.volume24,
    liquidity: onChainStats?.liquidity,
    rugChatterHits: countRugChatter(intel),
    totalMentions: m.total_mentions,
    mentions24h: m.external_mentions_24h ?? m.mentions_24h,
    cashtagOnlyShare24h: q.cashtag_only_share_24h ?? q.cashtag_signal_share_24h,
    wasIndexed: !!intel,
  })
}
