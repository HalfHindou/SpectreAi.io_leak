/**
 * macro-read — deterministic headline → crypto read-through for Macro Wire
 * articles. Ported from the TG bot's macro-reads driver map (zero LLM, first
 * match wins, direction-aware via the story's market sentiment). House style:
 * no em/en dashes anywhere in these strings.
 */

const DRIVERS = [
  { keys: ['iran', 'israel', 'gaza', 'hormuz', 'airstrike', 'missile', 'ceasefire', ' war ', 'russia', 'ukraine', 'sanction', 'military', 'geopolit', 'retaliat', 'escalat', 'houthi', 'yemen', 'conflict'],
    up: 'Geopolitical de-escalation is a relief bid. The risk premium bleeding out supports risk assets; watch BTC lead if the dollar softens with it.',
    down: 'Geopolitical risk-off. Crypto correlates to equities on the downside intraday; a crypto that holds through it is the decoupling tell.' },
  // ' inflation' is space-padded on purpose: bare 'inflation' also matches
  // "stagflation", which belongs to the tariff/trade read below
  { keys: [' cpi', ' inflation', ' ppi', ' pce', 'consumer price', 'disinflation'],
    up: 'Cooler inflation puts rate cuts back on the table, a crypto tailwind.',
    down: 'Hotter inflation lifts yields and the dollar, a crypto headwind.' },
  { keys: ['fomc', 'federal reserve', 'the fed', ' fed ', 'powell', 'central bank', ' ecb ', ' boj ', 'rate cut', 'rate hike', 'rate decision', 'cuts rates', 'cut rates', 'raises rates', 'hikes rates', 'lowers rates', 'basis points', ' bps ', 'interest rate', 'hawkish', 'dovish', 'fed minutes', 'jackson hole'],
    up: 'A dovish tilt is a liquidity tailwind and crypto-positive; the rate path is the biggest macro lever for BTC.',
    down: 'A hawkish tilt tightens financial conditions, a crypto headwind; the rate path is the biggest macro lever for BTC.' },
  { keys: ['nonfarm', 'payroll', ' nfp ', 'unemployment', 'jobless', 'jobs report', 'labor market'],
    up: 'Softer labor lifts rate-cut odds, a tailwind, unless it tips into a growth scare.',
    down: 'Strong labor is hawkish for the rate path, a crypto headwind.' },
  { keys: ['tariff', 'trade war', 'trade deal', 'export ban', 'stagflation'],
    up: 'Trade de-escalation is a relief for risk assets.',
    down: 'A trade shock hits growth and inflation at once, a double headwind for risk.' },
  { keys: [' oil', 'crude', 'opec', 'brent', ' wti ', 'barrel', 'energy prices', 'gas production'],
    up: 'Cheaper energy is disinflationary, supportive for risk and the rate path.',
    down: 'An energy shock is inflationary and risk-off, pressuring risk assets and raising higher-for-longer odds.' },
  { keys: ['dollar', ' dxy', 'greenback', 'usdjpy', 'yuan', 'renminbi'],
    up: 'Dollar weakness is a liquidity tailwind for BTC and alts.',
    down: 'Dollar strength drains global risk liquidity, a headwind for BTC and alts.' },
  { keys: [' sec ', 'cftc', ' etf', 'stablecoin', 'market structure', 'genius act', 'clarity act', 'regulat', 'crypto bill', 'custody rule'],
    up: 'A crypto-positive rule change is a direct tailwind; no macro relay needed.',
    down: 'A regulatory headwind hits crypto directly; no macro relay needed.' },
  { keys: ['recession', ' gdp', ' pmi', ' ism ', 'manufacturing', 'retail sales', 'soft landing', 'slowdown', 'growth'],
    up: 'Resilient growth without inflation is risk-on, supportive for crypto.',
    down: 'A growth scare spills into crypto as risk-off.' },
  { keys: ['treasury', 'debt ceiling', 'bond yields', '10-year', 'downgrade', 'deficit', 'shutdown', 'mortgage rate'],
    up: 'Easing funding stress and a softer rate path are a mild crypto tailwind.',
    down: 'Funding or supply stress tightens conditions, a crypto headwind, though debasement fear can feed the BTC bid.' },
  { keys: ['equity', 'stock market', 'nasdaq', 's&p', 'dow jones', 'shares', 'earnings'],
    up: 'Equity risk-on is a supportive backdrop for crypto beta.',
    down: 'Equity risk-off carries spillover risk to crypto short-term; watch for decoupling.' },
]

export function readForMacroArticle(text, sentiment) {
  const t = ' ' + String(text || '').toLowerCase() + ' '
  const s = String(sentiment || '').toLowerCase()
  const side = s.includes('bull') ? 'up' : 'down'
  for (const d of DRIVERS) if (d.keys.some((k) => t.includes(k))) return d[side]
  if (s.includes('bull')) return 'A risk-on macro impulse. Crypto usually trades with the broad risk tape until it decouples.'
  if (s.includes('bear')) return 'A macro event with cross-asset spillover risk. Crypto usually follows equities intraday until it decouples.'
  return null
}
