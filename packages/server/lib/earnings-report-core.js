'use strict';

/**
 * Reported earnings figures, from the FASTEST true source.
 *
 * Founder, 2026-08-04, an hour after SPCX printed while the page still said
 * "figures pending": "it says records pending yet you have news from stocktwits
 * and others with results yet you wait on yahoo" / "earnings should come from
 * fastest true source not from old media like yahoo if they are slow".
 *
 * He is right, and the gap is measured: the wire carried "$7.8 billion in
 * revenue" at 20:04 UTC and Reuters copy carried "a 92% rise in revenue" within
 * the hour, while Yahoo's earningsHistory still held nothing newer than the
 * PRIOR quarter 60+ minutes after the print. Waiting on the vendor means the
 * one surface a reader opens during the only minutes that matter is the one
 * surface that knows nothing.
 *
 * So: the wire reports, the vendor CONFIRMS. Two tiers, never merged —
 *   reported : extracted from news/wire copy the app already fetches.
 *              Fast, attributed, and always labelled as such.
 *   confirmed: the vendor's own actual-vs-estimate row. Slower, authoritative,
 *              and it OVERWRITES the reported figure the moment it lands.
 *
 * ── The whole risk here is fabrication, so read this before touching a regex ──
 * An earnings article is full of large numbers that are NOT the result. The very
 * payload this was built against contains, about the same company on the same
 * day: a $1.75 TRILLION IPO valuation, a $47.5B backlog, a $540M bitcoin
 * writedown, a $225B "earnings test", a $20M options trade, an 8% stock decline
 * and a 70% short-interest figure. Every one of those would be a lie if it were
 * printed as revenue.
 *
 * Three rules keep that from happening, and all three must hold:
 *   1. A figure is only claimed when it sits in an explicit REPORTING clause —
 *      the metric word and the number bound together by a reporting verb
 *      ("reported revenue of $X", "revenue rose 92%", "posts EPS of $X"). A
 *      number that merely shares a sentence with the word "revenue" is ignored.
 *   2. Anything matching a known decoy (valuation, backlog, market cap, buyback,
 *      short interest, options notional, stock move) is rejected outright, even
 *      inside a reporting clause.
 *   3. FORWARD-LOOKING copy is rejected wholesale. "Analysts expect SpaceX to
 *      report $6.93 billion" is an ESTIMATE sitting in a pre-print preview; it
 *      is the single most dangerous string in the feed because it is correctly
 *      shaped and completely wrong to print as an actual.
 *
 * Everything returned carries its source, its published time and the exact
 * sentence it came from, so any number on screen can be traced to the words that
 * produced it.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

// A clause only counts if a reporting verb ties the metric to the number.
const REPORT_VERB = '(?:report(?:ed|s)?|post(?:ed|s)?|deliver(?:ed|s)?|deliver|announc(?:ed|es)?|deliver|came in at|deliver|logged|booked|generated|had|of|was|were|hit|deliver|rose|rise|grew|grow|climbed|jumped|surged|increased|gained|fell|declined|dropped|slipped|totall?(?:ed|ing)?)';

// Copy that describes the FUTURE, never the printed result.
//
// 🪤 This must key on forward INTENT, not on the word "estimates". The first
// version listed `estimat(e|es|ed)` and `consensus` and therefore threw away
// "SpaceX's Q2 results TOP ESTIMATES" — the single clearest result headline in
// the whole feed — because it contains the word. Result copy is full of
// estimate/guidance/outlook language ("beat estimates", "raises guidance"); it
// is the VERB that separates a preview from a report.
const FORWARD_RX = /\b(?:expect(?:ed|s|ing)?|forecast(?:ed|s|ing)? to|projected to|anticipat(?:e|es|ed)|will report|is slated|slated to|ahead of (?:the |its )?(?:print|report|earnings|results)|preview|predict(?:s|ed|ion)?|analysts? (?:see|say|think|predict)|whisper number|due to report|set to report|is expected|to be reported)\b/i;

// Large numbers that are emphatically not the result.
const DECOY_RX = /\b(?:valuation|valued|market cap(?:italization)?|backlog|bookings? backlog|IPO|initial public offering|buyback|repurchase|dividend|short interest|options?|notional|strike|lockup|unlock|debt|raise[sd]?|funding|acquisition|deal size|fine|settlement|writedown|write-down|impairment|holdings?|treasury|reserves?|cash (?:pile|reserves|position)|capex|capital expenditure|target price|price target)\b/i;

const MULT = { trillion: 1e12, t: 1e12, billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mm: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

function toNumber(raw, unit) {
  const n = parseFloat(String(raw).replace(/,/g, ''));
  if (!isFinite(n)) return null;
  const m = unit ? MULT[String(unit).toLowerCase().replace(/[^a-z]/g, '')] : 1;
  return m ? n * m : n;
}

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+|\s+\|\|\s+|(?:^|\s)[-–—]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Extractors — each returns {value, unit?, sentence} or null ────────────────

// "reported revenue of $7.8 billion" · "revenue came in at $7.81B" · "posts $7.8 billion in revenue"
function extractRevenueAbsolute(s) {
  const patterns = [
    new RegExp(`\\brevenue[a-z ]{0,12}?\\s+${REPORT_VERB}\\s+(?:approximately\\s+|about\\s+|roughly\\s+)?\\$\\s?([\\d.,]+)\\s*(trillion|billion|bn|million|mm|[bmt])\\b`, 'i'),
    new RegExp(`\\$\\s?([\\d.,]+)\\s*(trillion|billion|bn|million|mm|[bmt])\\b\\s+(?:in|of)\\s+(?:quarterly\\s+|total\\s+|Q[1-4]\\s+)?revenue\\b`, 'i'),
    new RegExp(`\\brevenue\\s*(?:of|:|was|hit)\\s*\\$\\s?([\\d.,]+)\\s*(trillion|billion|bn|million|mm|[bmt])\\b`, 'i'),
    new RegExp(`\\bsales\\s*:?\\s*\\$\\s?([\\d.,]+)\\s*(trillion|billion|bn|million|mm|[bmt])\\b\\s*(?:vs\\.?|versus)`, 'i'),
  ];
  for (const rx of patterns) {
    const m = s.match(rx);
    if (m) {
      const v = toNumber(m[1], m[2]);
      // A quarter's revenue in the trillions is a valuation that slipped the net.
      if (v != null && v >= 1e5 && v < 1e12) return { value: v, sentence: s };
    }
  }
  return null;
}

// "a 92% rise in revenue" · "revenue jumped 92%" · "Revenue Up 92%"
const UP_WORDS = '(?:rise|risen|rose|jump(?:ed)?|surge[ds]?|grew|growth|climb(?:ed)?|increase[ds]?|gain(?:ed)?|up)';
const DOWN_WORDS = '(?:fall|fell|drop(?:ped)?|declin(?:e|ed)|slip(?:ped)?|decrease[ds]?|down|sank|sink)';
function extractRevenueGrowth(s) {
  const shapes = [
    { rx: new RegExp(`\\b([\\d.]+)\\s?%\\s+${UP_WORDS}\\s+in\\s+revenue\\b`, 'i'), sign: 1 },
    { rx: new RegExp(`\\b([\\d.]+)\\s?%\\s+${DOWN_WORDS}\\s+in\\s+revenue\\b`, 'i'), sign: -1 },
    { rx: new RegExp(`\\brevenue[a-z ]{0,14}?${UP_WORDS}\\s+(?:by\\s+)?([\\d.]+)\\s?%`, 'i'), sign: 1 },
    { rx: new RegExp(`\\brevenue[a-z ]{0,14}?${DOWN_WORDS}\\s+(?:by\\s+)?([\\d.]+)\\s?%`, 'i'), sign: -1 },
    { rx: /\brevenue\s+up\s+([\d.]+)\s?%/i, sign: 1 },
    { rx: /\brevenue\s+down\s+([\d.]+)\s?%/i, sign: -1 },
  ];
  for (const { rx, sign } of shapes) {
    const m = s.match(rx);
    if (m) {
      const v = parseFloat(m[1]);
      if (isFinite(v) && v <= 1000) return { value: sign * v, sentence: s };
    }
  }
  return null;
}

// "EPS ($0.09)" · "EPS of -$0.09" · "loss per share of $0.09" · "earnings per share of $1.20"
function extractEps(s) {
  const shapes = [
    // "$(0.09)" — accountancy negative, dollar sign OUTSIDE the paren, which is
    // how every wire prints a loss. Missing this read the loss as a profit.
    { rx: /\b(?:adjusted\s+|adj\.?\s+)?EPS\s*(?:of|:|came in at|was)?\s*\$?\s*\(\s*\$?\s*([\d.]+)\s*\)/i, sign: -1 },
    { rx: /\b(?:adjusted\s+|adj\.?\s+)?EPS\s*(?:of|:|came in at|was)?\s*-\s*\$?\s*([\d.]+)/i, sign: -1 },
    { rx: /\b(?:adjusted\s+|adj\.?\s+)?EPS\s*(?:of|:|came in at|was)?\s*\$?\s*([\d.]+)/i, sign: 1 },
    { rx: /\bloss per share\s*(?:of|:|was)?\s*\$?\s*([\d.]+)/i, sign: -1 },
    { rx: /\bearnings per share\s*(?:of|:|was)?\s*\$?\s*([\d.]+)/i, sign: 1 },
  ];
  for (const { rx, sign } of shapes) {
    const m = s.match(rx);
    if (m) {
      const v = parseFloat(m[1]);
      // An "EPS" over $1000 is a typo or a different metric entirely.
      if (isFinite(v) && v < 1000) return { value: sign * v, sentence: s };
    }
  }
  return null;
}

// The plain-English verdict. Kept separate from the figures: a headline can say
// "tops estimates" without carrying a single number, and that is still the fact
// a reader most wants in the first minute.
function extractVerdict(s) {
  // The metric can sit between the verb and the noun — "tops REVENUE estimates".
  const M = '(?:wall street |analysts?[’\']? )?(?:revenue |sales |earnings |profit |EPS |quarterly )?';
  if (new RegExp(`\\b(?:double beat|beat[s]? (?:on )?(?:both|${M}(?:expectations|estimates|forecasts?))|top(?:s|ped)? ${M}(?:estimates|expectations|forecasts?)|better than expected|exceed(?:s|ed) ${M}(?:estimates|expectations))\\b`, 'i').test(s)) return 'beat';
  if (new RegExp(`\\b(?:miss(?:es|ed)? (?:on )?${M}(?:estimates|expectations|forecasts?)|fell short of|worse than expected|below ${M}(?:estimates|expectations))\\b`, 'i').test(s)) return 'miss';
  if (/\bmixed results\b/i.test(s)) return 'mixed';
  return null;
}

// ── One article → whatever it genuinely states ───────────────────────────────

function readArticle(article) {
  const title = String(article?.title || article?.headline || '');
  const body = String(article?.summary || article?.description || article?.context || '');
  const source = String(article?.source || article?.source_info?.name || article?.publisher || 'wire');
  const tsRaw = article?.published_at ?? article?.datetime ?? article?.ts ?? article?.source_ts ?? null;
  let ts = null;
  if (tsRaw != null) {
    const n = Number(tsRaw);
    // Finnhub-style feeds ship seconds; everything else ships ms or an ISO string.
    ts = isFinite(n) && n > 0 ? new Date(n < 1e12 ? n * 1000 : n).toISOString() : new Date(tsRaw).toISOString();
    if (ts === 'Invalid Date') ts = null;
  }

  const out = { source, ts, revenue: null, revenueGrowthPct: null, eps: null, verdict: null };

  for (const s of sentences(`${title} || ${body}`)) {
    // Rule 3 — a forward-looking sentence never yields an actual, and it is
    // checked FIRST because such sentences are otherwise perfectly shaped.
    if (FORWARD_RX.test(s)) continue;
    // Rule 2 — a decoy disqualifies figures, but PER CLAUSE, not per sentence.
    // 🪤 Sentence-level rejection threw away "Revenue Up 92%" because the same
    // headline also said "Backlog Hits $47.5 Billion". Headlines routinely pack
    // a real metric and a decoy into one line separated by a comma, so the
    // decoy must only poison the clause it sits in.
    const clauses = DECOY_RX.test(s)
      ? s.split(/\s*[,;]\s*|\s+[–—]\s+/).filter((c) => !DECOY_RX.test(c))
      : [s];

    for (const c of clauses) {
      if (!out.revenue) { const r = extractRevenueAbsolute(c); if (r) out.revenue = { ...r, sentence: s }; }
      if (out.revenueGrowthPct == null) { const g = extractRevenueGrowth(c); if (g) out.revenueGrowthPct = { ...g, sentence: s }; }
      if (!out.eps) { const e = extractEps(c); if (e) out.eps = { ...e, sentence: s }; }
    }
    if (!out.verdict) { const v = extractVerdict(s); if (v) out.verdict = v; }
  }
  return out;
}

// ── Many articles → one answer, with agreement counted ───────────────────────

const round = (v, p) => Math.round(v * 10 ** p) / 10 ** p;
// Two wires rarely print a figure identically ($7.8B vs $7.814B), so agreement
// is judged on closeness, not equality.
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 0.02;

function consolidate(readings, key) {
  const vals = readings.map((r) => ({ r, f: r[key] })).filter((x) => x.f && x.f.value != null);
  if (!vals.length) return null;
  // Rank by how many independent SOURCES state a nearby value; ties break toward
  // the earliest publication, which is the one that actually broke it.
  let best = null;
  for (const cand of vals) {
    const agreeing = vals.filter((o) => near(o.f.value, cand.f.value));
    const sources = new Set(agreeing.map((o) => o.r.source));
    const earliest = agreeing.reduce((a, o) => (!a || (o.r.ts && o.r.ts < a.r.ts) ? o : a), null) || cand;
    const score = sources.size;
    if (!best || score > best.sources || (score === best.sources && earliest.r.ts && earliest.r.ts < best.ts)) {
      best = {
        value: earliest.f.value,
        sources: sources.size,
        source: earliest.r.source,
        ts: earliest.r.ts,
        sentence: earliest.f.sentence,
        attribution: [...sources].slice(0, 4),
      };
    }
  }
  return best;
}

function consolidateVerdict(readings) {
  const counts = {};
  for (const r of readings) if (r.verdict) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? { value: top[0], sources: top[1] } : null;
}

/**
 * buildReportedFigures(articles, opts)
 *
 * @param articles  anything with {title|headline, summary|description|context,
 *                  source, published_at|datetime|ts}
 * @param opts.printedAt  the scheduled print time — copy published before it is
 *                        a preview by definition and is dropped.
 * @param opts.estimates  {eps, revenue} — the Street numbers we already hold, so
 *                        the surprise is computed here rather than in each face.
 */
function buildReportedFigures(articles, opts = {}) {
  const printedAt = opts.printedAt ? new Date(opts.printedAt).getTime() : null;
  const list = Array.isArray(articles) ? articles : [];

  const readings = list
    .map(readArticle)
    // Copy filed BEFORE the print cannot describe it. Undated copy is kept —
    // dropping it would lose most aggregator rows — but it can never be the
    // sole basis for a figure, because a lone undated reading scores 1 source
    // and the UI shows the attribution.
    .filter((r) => {
      if (!printedAt || !r.ts) return true;
      return new Date(r.ts).getTime() >= printedAt - 30 * 60 * 1000;
    })
    .filter((r) => r.revenue || r.revenueGrowthPct != null || r.eps || r.verdict);

  const revenue = consolidate(readings, 'revenue');
  const growth = consolidate(readings, 'revenueGrowthPct');
  const eps = consolidate(readings, 'eps');
  const verdict = consolidateVerdict(readings);

  const est = opts.estimates || {};
  const surprise = (actual, estimate) =>
    actual != null && estimate != null && Math.abs(estimate) > 1e-9
      ? round(((actual - estimate) / Math.abs(estimate)) * 100, 1)
      : null;

  const has = !!(revenue || growth || eps || verdict);
  return {
    status: has ? 'reported' : 'pending',
    // "reported" NEVER means confirmed. Every face has to render this word.
    provenance: 'wire',
    revenue: revenue && { ...revenue, estimate: est.revenue ?? null, surprisePct: surprise(revenue.value, est.revenue) },
    revenueGrowthPct: growth || null,
    eps: eps && { ...eps, estimate: est.eps ?? null, surprisePct: surprise(eps.value, est.eps) },
    verdict: verdict || null,
    articlesRead: readings.length,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildReportedFigures,
  readArticle,
  // exported for the test file — these are where a mistake becomes a fabrication
  extractRevenueAbsolute,
  extractRevenueGrowth,
  extractEps,
  extractVerdict,
  FORWARD_RX,
  DECOY_RX,
};
