/**
 * Historical BTC/SPY price reactions to major economic events.
 * Used by ImpactReactionChart to show typical market behavior.
 * Format: { minutes: number, btc: number (% change), spy: number (% change) }
 */

export const IMPACT_REACTIONS = {
  'FOMC Interest Rate Decision': {
    label: 'FOMC Rate Decision',
    beat: [
      { m: -60, btc: 0, spy: 0 }, { m: -30, btc: 0.2, spy: 0.1 },
      { m: -15, btc: 0.5, spy: 0.2 }, { m: 0, btc: 0.8, spy: 0.3 },
      { m: 5, btc: 2.8, spy: 0.9 }, { m: 15, btc: 3.2, spy: 1.1 },
      { m: 30, btc: 2.6, spy: 0.8 }, { m: 60, btc: 2.4, spy: 0.7 },
      { m: 120, btc: 2.1, spy: 0.6 }, { m: 240, btc: 1.8, spy: 0.5 },
      { m: 480, btc: 2.2, spy: 0.6 }, { m: 1440, btc: 3.1, spy: 0.8 },
    ],
    miss: [
      { m: -60, btc: 0, spy: 0 }, { m: -30, btc: -0.1, spy: -0.1 },
      { m: -15, btc: -0.3, spy: -0.2 }, { m: 0, btc: -0.5, spy: -0.3 },
      { m: 5, btc: -3.5, spy: -1.2 }, { m: 15, btc: -4.8, spy: -1.6 },
      { m: 30, btc: -4.2, spy: -1.3 }, { m: 60, btc: -3.8, spy: -1.1 },
      { m: 120, btc: -3.2, spy: -0.9 }, { m: 240, btc: -2.8, spy: -0.7 },
      { m: 480, btc: -2.4, spy: -0.5 }, { m: 1440, btc: -1.8, spy: -0.3 },
    ],
  },
  'CPI': {
    label: 'CPI (Inflation)',
    beat: [
      { m: -60, btc: 0, spy: 0 }, { m: -30, btc: 0.1, spy: 0.05 },
      { m: 0, btc: 0.3, spy: 0.1 }, { m: 5, btc: -2.1, spy: -0.7 },
      { m: 15, btc: -2.8, spy: -0.9 }, { m: 30, btc: -2.4, spy: -0.8 },
      { m: 60, btc: -2.0, spy: -0.6 }, { m: 120, btc: -1.6, spy: -0.5 },
      { m: 240, btc: -1.2, spy: -0.4 }, { m: 1440, btc: -0.8, spy: -0.2 },
    ],
    miss: [
      { m: -60, btc: 0, spy: 0 }, { m: -30, btc: 0.1, spy: 0.05 },
      { m: 0, btc: 0.2, spy: 0.1 }, { m: 5, btc: 2.4, spy: 0.8 },
      { m: 15, btc: 3.1, spy: 1.0 }, { m: 30, btc: 2.8, spy: 0.9 },
      { m: 60, btc: 2.5, spy: 0.7 }, { m: 120, btc: 2.2, spy: 0.6 },
      { m: 240, btc: 1.9, spy: 0.5 }, { m: 1440, btc: 1.5, spy: 0.4 },
    ],
  },
  'Non-Farm Payrolls': {
    label: 'Non-Farm Payrolls',
    beat: [
      { m: -60, btc: 0, spy: 0 }, { m: -30, btc: 0.15, spy: 0.1 },
      { m: 0, btc: 0.4, spy: 0.2 }, { m: 5, btc: -1.8, spy: 0.6 },
      { m: 15, btc: -2.2, spy: 0.8 }, { m: 30, btc: -1.6, spy: 0.7 },
      { m: 60, btc: -1.2, spy: 0.5 }, { m: 120, btc: -0.8, spy: 0.4 },
      { m: 240, btc: -0.5, spy: 0.3 }, { m: 1440, btc: -0.2, spy: 0.2 },
    ],
    miss: [
      { m: -60, btc: 0, spy: 0 }, { m: -30, btc: -0.1, spy: -0.05 },
      { m: 0, btc: -0.3, spy: -0.1 }, { m: 5, btc: 1.5, spy: -0.8 },
      { m: 15, btc: 2.0, spy: -1.0 }, { m: 30, btc: 1.8, spy: -0.8 },
      { m: 60, btc: 1.5, spy: -0.6 }, { m: 120, btc: 1.2, spy: -0.5 },
      { m: 240, btc: 0.9, spy: -0.3 }, { m: 1440, btc: 0.6, spy: -0.2 },
    ],
  },
  'PCE Price Index': {
    label: 'PCE Price Index',
    beat: [
      { m: -60, btc: 0, spy: 0 }, { m: 0, btc: 0.2, spy: 0.1 },
      { m: 5, btc: -1.6, spy: -0.5 }, { m: 15, btc: -2.1, spy: -0.7 },
      { m: 30, btc: -1.8, spy: -0.6 }, { m: 60, btc: -1.4, spy: -0.4 },
      { m: 240, btc: -1.0, spy: -0.3 }, { m: 1440, btc: -0.6, spy: -0.2 },
    ],
    miss: [
      { m: -60, btc: 0, spy: 0 }, { m: 0, btc: 0.1, spy: 0.05 },
      { m: 5, btc: 1.8, spy: 0.6 }, { m: 15, btc: 2.4, spy: 0.8 },
      { m: 30, btc: 2.1, spy: 0.7 }, { m: 60, btc: 1.8, spy: 0.5 },
      { m: 240, btc: 1.4, spy: 0.4 }, { m: 1440, btc: 1.0, spy: 0.3 },
    ],
  },
}

/**
 * Match an event name to a reaction profile
 */
export function getReactionData(eventName) {
  if (!eventName) return null
  const name = eventName.toLowerCase()
  if (/fomc|fed.*rate|interest rate decision/i.test(name)) return IMPACT_REACTIONS['FOMC Interest Rate Decision']
  if (/\bcpi\b|consumer price index/i.test(name)) return IMPACT_REACTIONS['CPI']
  if (/non.?farm|payroll|nfp/i.test(name)) return IMPACT_REACTIONS['Non-Farm Payrolls']
  if (/\bpce\b|personal consumption/i.test(name)) return IMPACT_REACTIONS['PCE Price Index']
  return null
}
