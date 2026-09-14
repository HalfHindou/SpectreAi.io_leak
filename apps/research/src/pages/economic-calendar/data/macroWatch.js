/**
 * Macro Watch — Inflation & Jobs tracking config.
 *
 * The Fed under Chair Warsh (first meeting Jun 2026) is explicitly
 * data-dependent and gives markets far less forward guidance ("talk less",
 * dot plot de-emphasized). That makes the actual inflation and labor prints
 * the dominant rate-cut signal — so we elevate them into a dedicated watch.
 *
 * This file is the single source of truth for:
 *   - TRACKED_SERIES: the US releases we follow closely (matchers + meaning)
 *   - FED_REGIME: point-in-time Fed facts (update after each FOMC, see asOf)
 *   - FOMC_SCHEDULE_2026 + getNextFomc(): dynamic "next FOMC" countdown
 *
 * The watch UI derives everything else (latest print, surprise, trend, next
 * release countdown) live from the calendar event feed — see useMacroWatch.
 */

// ── Tracked series ──────────────────────────────────────────────────────────
// Each series matches US events by name. `hawkishIfHigher` encodes what a
// higher-than-forecast print means for Fed policy: hawkish (later/fewer cuts,
// a headwind for risk) or dovish (sooner cuts, a tailwind). `prefer` picks one
// variant when both MoM and YoY land at the same time so a series shows one
// canonical print instead of duplicates.
const isUS = (e) => {
  const c = String(e?.country || '').toUpperCase()
  const cur = String(e?.currency || '').toUpperCase()
  return c === 'US' || c === 'USD' || cur === 'USD'
}

export const TRACKED_SERIES = [
  {
    id: 'cpi',
    family: 'inflation',
    label: 'CPI',
    fullName: 'Consumer Price Index',
    blurb: 'Headline inflation',
    hawkishIfHigher: true,
    prefer: /yoy|year/i,
    test: (n) => /(\binflation rate\b|\bcpi\b|consumer price)/i.test(n) && !/core/i.test(n) && !/ppi|producer/i.test(n),
  },
  {
    id: 'core-cpi',
    family: 'inflation',
    label: 'Core CPI',
    fullName: 'Core Consumer Price Index',
    blurb: 'Ex food & energy',
    hawkishIfHigher: true,
    prefer: /yoy|year/i,
    test: (n) => /core/i.test(n) && /(inflation rate|\bcpi\b|consumer price)/i.test(n),
  },
  {
    id: 'core-pce',
    family: 'inflation',
    label: 'Core PCE',
    fullName: 'Core PCE Price Index',
    blurb: "Fed's preferred gauge",
    hawkishIfHigher: true,
    prefer: /yoy|year/i,
    test: (n) => /core/i.test(n) && /pce/i.test(n),
  },
  {
    id: 'ppi',
    family: 'inflation',
    label: 'PPI',
    fullName: 'Producer Price Index',
    blurb: 'Pipeline inflation',
    hawkishIfHigher: true,
    prefer: /yoy|year/i,
    test: (n) => /(\bppi\b|producer price)/i.test(n) && !/core/i.test(n),
  },
  {
    id: 'nfp',
    family: 'employment',
    label: 'Nonfarm Payrolls',
    fullName: 'Nonfarm Payrolls',
    blurb: 'Jobs added',
    hawkishIfHigher: true,
    // Headline series ONLY. TV releases "Nonfarm Payrolls Private" /
    // "Manufacturing Payrolls" / "Government Payrolls" at the same 8:30
    // timestamp - the private print (49K on 2026-07-02) was winning the
    // "latest released" tie and masquerading as headline NFP (57K).
    test: (n) => /(non.?farm|nonfarm|\bnfp\b)/i.test(n) && !/adp|private|manufacturing|government/i.test(n),
  },
  {
    id: 'unemployment',
    family: 'employment',
    label: 'Unemployment Rate',
    fullName: 'Unemployment Rate',
    blurb: 'Labor slack',
    // Higher unemployment = weaker labor = dovish (cuts more likely).
    hawkishIfHigher: false,
    // Exclude the broader U-6 series (released same moment, ~2x the level).
    test: (n) => /unemployment rate/i.test(n) && !/u-?6/i.test(n),
  },
  {
    id: 'claims',
    family: 'employment',
    label: 'Jobless Claims',
    fullName: 'Initial Jobless Claims',
    blurb: 'Weekly layoffs',
    // Higher claims = softening labor = dovish.
    hawkishIfHigher: false,
    test: (n) => /(initial jobless|jobless claims)/i.test(n) && !/continu/i.test(n),
  },
  {
    id: 'ahe',
    family: 'employment',
    label: 'Avg Hourly Earnings',
    fullName: 'Average Hourly Earnings',
    blurb: 'Wage pressure',
    hawkishIfHigher: true,
    prefer: /mom|month/i,
    test: (n) => /average hourly earnings/i.test(n),
  },
]

export const SERIES_FAMILIES = [
  { id: 'inflation', label: 'Inflation' },
  { id: 'employment', label: 'Jobs & Labor' },
]

/**
 * Match a single event to a tracked series id, or null. US-only by design —
 * the Fed reacts to US data, and non-US versions (EU CPI Flash etc.) would
 * pollute the trend.
 */
export function matchSeries(event) {
  if (!event || !isUS(event)) return null
  const name = String(event.name || event.title || '')
  if (!name) return null
  for (const s of TRACKED_SERIES) {
    if (s.test(name)) return s.id
  }
  return null
}

// ── Fed regime (point-in-time — update after each FOMC) ──────────────────────
// As of the June 2026 FOMC, Kevin Warsh's first meeting as Chair. Verified
// against Fed/press coverage 2026-06-18. The next-FOMC countdown is derived
// dynamically from FOMC_SCHEDULE_2026, so only these qualitative facts need a
// manual refresh after each decision.
export const FED_REGIME = {
  asOf: '2026-06-18',
  chair: 'Kevin Warsh',
  rateBand: '3.50–3.75%',
  stance: 'Data-dependent',
  comms: 'Talk less, guided by data',
  lastDecision: { date: '2026-06-17', summary: 'Held · hawkish lean, one hike penciled for 2026' },
  dotPlot: 'De-emphasized — chair withheld his own projection',
  inflationOutlook: '2026 outlook raised to 3.6% headline / 3.3% core',
  why: 'With less Fed forward guidance, inflation and jobs prints now drive rate-cut odds directly.',
}

// ── 2026 FOMC schedule (decision = 2:00pm ET on the second day) ──────────────
// `sep: true` meetings publish the Summary of Economic Projections. Only
// meetings from June onward are listed (earlier ones are past); add 2027 dates
// before year-end. getNextFomc() returns the soonest meeting still ahead.
export const FOMC_SCHEDULE_2026 = [
  { label: 'Jun 16–17', decision: '2026-06-17T14:00:00-04:00', sep: true },
  { label: 'Jul 28–29', decision: '2026-07-29T14:00:00-04:00', sep: false },
  { label: 'Sep 15–16', decision: '2026-09-16T14:00:00-04:00', sep: true },
  { label: 'Oct 27–28', decision: '2026-10-28T14:00:00-04:00', sep: false },
  { label: 'Dec 8–9', decision: '2026-12-09T14:00:00-05:00', sep: true },
]

/** Soonest FOMC whose decision time is still in the future, or null. */
export function getNextFomc(now = Date.now()) {
  const ts = now instanceof Date ? now.getTime() : now
  for (const m of FOMC_SCHEDULE_2026) {
    if (new Date(m.decision).getTime() > ts) return m
  }
  return null
}
