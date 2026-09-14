/**
 * worldFact — the h1.
 *
 * The headline of this page is a COMPUTED FACT, never a slogan, and it always
 * ships with a source line naming the fields it was derived from and the
 * as_of of those fields. The chain below is evaluated in order and the first
 * entry that computes wins (packet §"h1 fact chain").
 *
 * One interpretation worth flagging, because it reorders the packet's list:
 * entry 5's condition is "doc null OR stale > 6h", and that is evaluated
 * FIRST rather than last. Facts 1-4 are written in the present tense — "The
 * Fed HAS drained" — and asserting them from a document that stopped
 * reporting three days ago would make the tense itself the lie. A document
 * that has gone quiet says so in its own headline; that is the entire thesis
 * of the page. Within a reporting document the order is exactly 1 → 4.
 */
import {
  fmtSignedUsdB, fmtUsdB, fmtLongDay, fmtUtc, fmtDuration, fmtSignedPct,
  fmtLevel, fmtVol, fmtYes, toNum, isNum,
} from './wst-format'

const STALE_MS = 6 * 3600_000

/* An h1 has to survive at 2.25rem on one to three lines. Prediction-market
   questions run to 120+ characters ("Will a crypto market structure bill be
   not become law AND the farm bill…"); those fall through to the next fact
   rather than being truncated into something the source never said. */
const MAX_Q_FOR_H1 = 90

const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0)

/** Every priced market in the document, richest first. */
export function allOdds(doc) {
  const pools = [
    doc?.rates?.odds,
    doc?.rates?.fed_chair,
    doc?.politics?.crypto_policy_odds,
    doc?.politics?.election_policy_odds,
  ]
  const out = []
  for (const arr of pools) {
    if (Array.isArray(arr)) for (const o of arr) if (o?.q) out.push(o)
  }
  return out.sort((a, b) => (toNum(b?.vol_usd_m) ?? -1) - (toNum(a?.vol_usd_m) ?? -1))
}

function liquidityFact(doc) {
  const nl = doc?.net_liquidity
  const chg = toNum(nl?.chg_4w_usd_b)
  if (chg == null || chg === 0) return null
  const asOf = fmtLongDay(nl?.as_of)
  return {
    key: 'net_liquidity',
    text: `The Fed has ${chg < 0 ? 'drained' : 'added'} ${fmtUsdB(chg)} in four weeks.`,
    source: `WALCL − TGA − RRP${asOf ? ` · as of ${asOf}` : ''}`,
  }
}

function cotFact(doc) {
  const c = doc?.cot_btc
  if (!c) return null
  const asOf = fmtLongDay(c.as_of)
  const legs = [
    { label: 'Leveraged funds', net: toNum(c.leveraged_funds_net), wow: toNum(c.leveraged_funds_net_wow) },
    { label: 'Asset managers', net: toNum(c.asset_managers_net), wow: toNum(c.asset_managers_net_wow) },
  ]
  for (const leg of legs) {
    if (leg.net == null || leg.wow == null || leg.wow === 0) continue
    const prior = leg.net - leg.wow
    if (sign(leg.net) === 0 || sign(prior) === 0) continue
    if (sign(leg.net) === sign(prior)) continue
    return {
      key: 'cot_btc',
      text: `${leg.label} went net ${leg.net < 0 ? 'short' : 'long'} Bitcoin this week.`,
      source: `CFTC COT${asOf ? ` · as of ${asOf}` : ''}`,
    }
  }
  return null
}

/**
 * A market that crossed 50% since the previous edition.
 * Only computable against a document this tab has actually held — there is no
 * server-side history, so nothing here is reconstructed or assumed.
 */
function crossingFact(doc, prevDoc) {
  if (!prevDoc) return null
  const before = new Map()
  for (const o of allOdds(prevDoc)) if (o?.q) before.set(o.q, toNum(o.yes_pct))

  for (const o of allOdds(doc)) {
    const now = toNum(o.yes_pct)
    const then = before.get(o.q)
    if (now == null || then == null) continue
    if (String(o.q).length > MAX_Q_FOR_H1) continue
    const crossed = (then < 50 && now >= 50) || (then >= 50 && now < 50)
    if (!crossed) continue
    const vol = toNum(o.vol_usd_m)
    const ends = fmtLongDay(o.ends)
    return {
      key: 'odds',
      text: `The market now gives ${String(o.q).replace(/\?$/, '')} a ${fmtYes(now, vol)} chance.`,
      source: [vol != null ? `${fmtVol(vol)} of open interest` : null, ends ? `resolves ${ends}` : null]
        .filter(Boolean).join(' · '),
    }
  }
  return null
}

function regimeFact(doc, ts) {
  const m = doc?.markets
  const regime = typeof m?.regime === 'string' && m.regime.trim() ? m.regime.trim() : null
  if (!regime) return null
  const btc = fmtSignedPct(m?.btc?.chg_24h_pct, 2)
  const dxy = fmtLevel(m?.dxy?.px ?? m?.dxy)
  const stamp = fmtUtc(ts)
  return {
    key: 'markets',
    text: `The tape is ${regime}.`,
    source: [btc ? `${btc} BTC` : null, dxy ? `DXY ${dxy}` : null, stamp ? `as of ${stamp}` : null]
      .filter(Boolean).join(' · '),
  }
}

function silenceFact({ doc, version, ts, now, endpoint }) {
  const age = Date.parse(ts)
  const quiet = Number.isFinite(age) ? fmtDuration(now - age) : null
  if (!doc) {
    return {
      key: 'silence',
      text: 'The document has not reported.',
      source: `${endpoint} · no edition on file`,
      cold: true,
    }
  }
  return {
    key: 'silence',
    text: quiet ? `The document has not reported in ${quiet}.` : 'The document has not reported.',
    source: `last edition v${version ?? '—'}${ts ? ` · ${fmtLongDay(ts)} ${fmtUtc(ts)}` : ''}`,
    cold: false,
  }
}

export default function worldFact({ doc, prevDoc, version, ts, now = Date.now(), endpoint = '/data-api/v1/brain/world' }) {
  const age = Date.parse(ts)
  const quiet = !doc || (Number.isFinite(age) && now - age > STALE_MS)
  if (quiet) return silenceFact({ doc, version, ts, now, endpoint })

  return liquidityFact(doc)
    || cotFact(doc)
    || crossingFact(doc, prevDoc)
    || regimeFact(doc, ts)
    || silenceFact({ doc, version, ts, now, endpoint })
}

export { STALE_MS }
