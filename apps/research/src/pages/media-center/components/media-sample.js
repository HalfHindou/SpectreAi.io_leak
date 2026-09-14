/**
 * media-sample.js — DEV SAMPLE dataset for the Media Center redesign.
 *
 * The real media API returns nothing in local dev (no API keys), so this file
 * provides a rich, premium-feeling fixture so the editorial UI is fully alive
 * while developing offline. Modeled on therollup.co — curated crypto media,
 * NOT spam.
 *
 * EVERYTHING is offline-safe:
 *  - thumbnails are inline SVG data: URIs (gradientThumb) — zero network
 *  - channel avatars are inline SVG data: URIs (avatarThumb)
 *  - podcast audio uses a public 15s sample mp3 so playback works in dev
 *
 * Canonical item schema (every media item follows this exactly):
 *   { id, type, source, title, thumbnail, channel:{ name, avatar, url },
 *     duration, publishedAt, viewCount, url, audioUrl, tags, description, category }
 *
 * Named exports only.
 */

/* ── Deterministic clock ──────────────────────────────────────────────
   Do NOT call Date.now() at module load — keep the fixture deterministic so
   "published X days ago" never drifts between renders/builds. */
const NOW = 1750000000000 // 2025-06-15T13:46:40.000Z

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** ISO string for `h` hours before the fixed NOW. */
const hoursAgo = (h) => new Date(NOW - h * HOUR).toISOString()
/** ISO string for `d` days before the fixed NOW. */
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString()

/* ── gradientThumb ─────────────────────────────────────────────────────
   16:9 (1280x720) SVG data URI: diagonal c1→c2 gradient, dark vignette,
   bold warm-white label lower-left, small SPECTRE wordmark watermark.

   Colors are passed WITHOUT a leading '#' (e.g. 'F7931A') and prepended here,
   so '#' never has to survive URL-encoding. The whole SVG is encoded with
   encodeURIComponent so it is valid inside a JS string and as a data URI. */
function gradientThumb(label, c1, c2) {
  const col1 = `#${c1}`
  const col2 = `#${c2}`
  // Escape XML-special chars in the label so it can't break the SVG.
  const safe = String(label)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">` +
    `<defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${col1}"/>` +
    `<stop offset="1" stop-color="${col2}"/>` +
    `</linearGradient>` +
    `<radialGradient id="v" cx="0.5" cy="0.42" r="0.85">` +
    `<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0.62"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="1280" height="720" fill="url(#g)"/>` +
    `<rect width="1280" height="720" fill="url(#v)"/>` +
    `<rect x="0" y="430" width="1280" height="290" fill="#000000" opacity="0.30"/>` +
    `<text x="72" y="628" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" ` +
    `font-size="64" font-weight="700" letter-spacing="-1.5" fill="#f5f5f7">${safe}</text>` +
    `<text x="1208" y="64" text-anchor="end" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" ` +
    `font-size="22" font-weight="700" letter-spacing="3" fill="#f5f5f7" opacity="0.55">SPECTRE</text>` +
    `</svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/* ── avatarThumb ───────────────────────────────────────────────────────
   96x96 SVG data URI: solid brand-color circle, first letter centered white. */
function avatarThumb(letter, color) {
  const col = `#${color}`
  const ch = String(letter || '?').charAt(0).toUpperCase()
  const safe = ch
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<circle cx="48" cy="48" r="48" fill="${col}"/>` +
    `<text x="48" y="48" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" ` +
    `font-size="44" font-weight="700" fill="#ffffff">${safe}</text>` +
    `</svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/* Re-exported so the redesign UI can reuse them for placeholders/skeletons. */
export { gradientThumb, avatarThumb }

/* ── Brand palette (dark, premium crypto-brand tones; no leading '#') ── */
const C = {
  bitcoin: ['F7931A', '3a2a10'],
  ethereum: ['627EEA', '1a1f3a'],
  solana: ['14F195', '0a2a1f'],
  slate: ['18181b', '09090b'],
  defi: ['7C5CFF', '17112e'],
  stable: ['2775CA', '0f2233'],
  rwa: ['C9A227', '2a230d'],
  macro: ['D4674A', '2a140d'],
  trading: ['10B981', '0a241b'],
  altcoin: ['EC4899', '2a0f1e'],
  regulation: ['64748B', '14181f'],
  ai: ['06B6D4', '08222a'],
  markets: ['F59E0B', '2a1e08'],
  crimson: ['E2493B', '2a0d0b'],
  teal: ['0EA5A4', '08242a'],
  indigo: ['4F6BED', '101733'],
}

/* ── Channels (the curated premium brands) ────────────────────────────── */
const CH = {
  rollup: {
    name: 'The Rollup',
    avatar: avatarThumb('R', '7C5CFF'),
    url: 'https://therollup.co',
  },
  bankless: {
    name: 'Bankless',
    avatar: avatarThumb('B', 'F2A900'),
    url: 'https://www.bankless.com',
  },
  defiant: {
    name: 'The Defiant',
    avatar: avatarThumb('D', '14F195'),
    url: 'https://thedefiant.io',
  },
  empire: {
    name: 'Empire',
    avatar: avatarThumb('E', '4F6BED'),
    url: 'https://blockworks.co/podcast/empire',
  },
  realvision: {
    name: 'Real Vision',
    avatar: avatarThumb('R', 'D4674A'),
    url: 'https://www.realvision.com',
  },
  coinbureau: {
    name: 'Coin Bureau',
    avatar: avatarThumb('C', '2775CA'),
    url: 'https://www.coinbureau.com',
  },
  uponly: {
    name: 'UpOnly',
    avatar: avatarThumb('U', 'EC4899'),
    url: 'https://www.youtube.com/@UpOnlyTV',
  },
  unchained: {
    name: 'Unchained',
    avatar: avatarThumb('U', '06B6D4'),
    url: 'https://unchainedcrypto.com',
  },
  cowen: {
    name: 'Into The Cryptoverse',
    avatar: avatarThumb('I', 'C9A227'),
    url: 'https://intothecryptoverse.com',
  },
  wbd: {
    name: 'What Bitcoin Did',
    avatar: avatarThumb('W', 'F7931A'),
    url: 'https://www.whatbitcoindid.com',
  },
  lightspeed: {
    name: 'Lightspeed',
    avatar: avatarThumb('L', '14F195'),
    url: 'https://blockworks.co/podcast/lightspeed',
  },
  bellcurve: {
    name: 'Bell Curve',
    avatar: avatarThumb('B', '7C5CFF'),
    url: 'https://blockworks.co/podcast/bellcurve',
  },
}

/* Helper: build a media item with sane defaults + the canonical schema. */
let _seq = 0
function item(opts) {
  _seq += 1
  const id = opts.id || `sample_${String(_seq).padStart(3, '0')}`
  return {
    id,
    type: opts.type || 'video',
    source: opts.source || 'youtube',
    title: opts.title,
    thumbnail: opts.thumbnail,
    channel: opts.channel,
    duration: opts.duration,
    publishedAt: opts.publishedAt,
    viewCount: opts.viewCount,
    url: opts.url || opts.channel?.url || 'https://therollup.co',
    audioUrl: opts.audioUrl ?? null,
    tags: opts.tags || [],
    description: opts.description || '',
    category: opts.category || 'Markets',
    // Podcast-only fields — the prod normalizer sets these from Podcast Index.
    // They were being dropped here, so the caption rail had nothing to load in
    // dev even though the sample transcript existed.
    ...(opts.feedId ? { feedId: opts.feedId } : {}),
    ...(opts.hasTranscript ? { hasTranscript: true, transcripts: opts.transcripts || [] } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  }
}

// Direct (no 301): a redirect breaks a crossOrigin load even when the final
// response sends CORS headers, which would hide the live-visualizer path in dev.
const SAMPLE_MP3 = 'https://samplelib.com/mp3/sample-15s.mp3'

/* ─────────────────────────────────────────────────────────────────────
   FEATURED — one premium long-form video with a thesis description.
   ───────────────────────────────────────────────────────────────────── */
const FEATURED = item({
  id: 'sample_feat_001',
  type: 'video',
  source: 'youtube',
  title: 'The Future Of Finance: How Stablecoins Quietly Won The Internet',
  thumbnail: gradientThumb('The Future Of Finance', ...C.stable),
  channel: CH.rollup,
  duration: 47 * 60 + 12, // 47:12
  publishedAt: hoursAgo(20),
  viewCount: 412_000,
  url: 'https://therollup.co',
  tags: ['USDC', 'USDT', 'ETH'],
  description:
    'Sam Kazemian on why dollar-settlement is migrating on-chain, the payments endgame, and who captures the float.',
  category: 'Stablecoins',
})

/* ─────────────────────────────────────────────────────────────────────
   VIDEOS — ~16 premium curated long-form videos.
   ───────────────────────────────────────────────────────────────────── */
const SAMPLE_VIDEOS = [
  item({
    title: 'The Next Golden Bull: Reading The 2026 Liquidity Cycle',
    thumbnail: gradientThumb('The Next Golden Bull', ...C.markets),
    channel: CH.realvision,
    duration: 38 * 60 + 4,
    publishedAt: hoursAgo(6),
    viewCount: 286_000,
    tags: ['BTC', 'MACRO'],
    description: 'Raoul Pal maps global liquidity against the four-year cycle and where the exit really is.',
    category: 'Macro',
  }),
  item({
    title: "Ethereum's Lowest RSI In History — Capitulation Or Coil?",
    thumbnail: gradientThumb("Ethereum's Lowest RSI", ...C.ethereum),
    channel: CH.cowen,
    duration: 26 * 60 + 41,
    publishedAt: hoursAgo(14),
    viewCount: 198_500,
    tags: ['ETH'],
    description: 'Benjamin Cowen on the ETH/BTC ratio, risk curves, and why momentum traders are trapped.',
    category: 'Ethereum',
  }),
  item({
    title: 'The Meteoric Rise Of Perps: Inside The On-Chain Derivatives War',
    thumbnail: gradientThumb('The Rise Of Perps', ...C.trading),
    channel: CH.rollup,
    duration: 44 * 60 + 9,
    publishedAt: daysAgo(1),
    viewCount: 134_200,
    tags: ['HYPE', 'DYDX'],
    description: 'Why perpetual DEX volume is eating CEX share and which order-book model wins.',
    category: 'Trading',
  }),
  item({
    title: 'RWAs Are Eating TradFi: Tokenized Treasuries Cross $10B',
    thumbnail: gradientThumb('RWAs Eat TradFi', ...C.rwa),
    channel: CH.bankless,
    duration: 41 * 60 + 33,
    publishedAt: daysAgo(2),
    viewCount: 221_700,
    tags: ['ONDO', 'RWA'],
    description: 'Haseeb Qureshi on why money funds chose chains and the regulatory unlock behind it.',
    category: 'RWAs',
  }),
  item({
    title: 'Why Stablecoins Win 2026 — The Payments Endgame',
    thumbnail: gradientThumb('Why Stablecoins Win', ...C.stable),
    channel: CH.empire,
    duration: 52 * 60 + 18,
    publishedAt: daysAgo(2),
    viewCount: 175_900,
    tags: ['USDC', 'USDT'],
    description: 'Sam Kazemian and the panel debate float economics, FX rails, and the Visa of stablecoins.',
    category: 'Stablecoins',
  }),
  item({
    title: 'Solana At The Center Of Gravity: The App-Chain Counterargument',
    thumbnail: gradientThumb('Solana Center Of Gravity', ...C.solana),
    channel: CH.lightspeed,
    duration: 35 * 60 + 50,
    publishedAt: daysAgo(3),
    viewCount: 142_300,
    tags: ['SOL', 'JTO'],
    description: 'Mert Mumtaz on Firedancer, monolithic throughput, and why fragmentation is the real risk.',
    category: 'Solana',
  }),
  item({
    title: 'The Bitcoin Treasury Playbook Everyone Is Copying',
    thumbnail: gradientThumb('Bitcoin Treasury Playbook', ...C.bitcoin),
    channel: CH.wbd,
    duration: 58 * 60 + 12,
    publishedAt: daysAgo(3),
    viewCount: 308_400,
    tags: ['BTC', 'MSTR'],
    description: 'How corporate balance-sheet demand changed Bitcoin price discovery for good.',
    category: 'Bitcoin',
  }),
  item({
    title: 'DeFi Renaissance: Real Yield Is Finally Real',
    thumbnail: gradientThumb('DeFi Renaissance', ...C.defi),
    channel: CH.defiant,
    duration: 33 * 60 + 27,
    publishedAt: daysAgo(4),
    viewCount: 96_800,
    tags: ['AAVE', 'UNI'],
    description: 'DeFi Dad walks through protocols printing fees, not emissions, and where the cash flows.',
    category: 'DeFi',
  }),
  item({
    title: 'The Great Rotation: Why Altcoin Beta Is Back On The Table',
    thumbnail: gradientThumb('The Great Rotation', ...C.altcoin),
    channel: CH.uponly,
    duration: 1 * 3600 + 12 * 60 + 5,
    publishedAt: daysAgo(5),
    viewCount: 158_200,
    tags: ['ALTS', 'SOL', 'LINK'],
    description: 'Cobie and Ledger debate dominance, the everything-rally setup, and where the liquidity goes.',
    category: 'Altcoins',
  }),
  item({
    title: 'Regulation Endgame: The Market Structure Bill Explained',
    thumbnail: gradientThumb('Regulation Endgame', ...C.regulation),
    channel: CH.unchained,
    duration: 49 * 60 + 44,
    publishedAt: daysAgo(6),
    viewCount: 87_300,
    tags: ['REG', 'BTC'],
    description: 'Laura Shin and counsel break down what finally gives crypto legal clarity in the US.',
    category: 'Regulation',
  }),
  item({
    title: 'AI x Crypto: The Agent Economy Nobody Priced In',
    thumbnail: gradientThumb('AI x Crypto', ...C.ai),
    channel: CH.bellcurve,
    duration: 56 * 60 + 3,
    publishedAt: daysAgo(7),
    viewCount: 121_600,
    tags: ['AI', 'TAO'],
    description: 'Autonomous agents paying for compute on-chain — the thesis, the grift, and the real demand.',
    category: 'AI',
  }),
  item({
    title: 'Coin Bureau Deep Dive: The Macro Setup For Q3',
    thumbnail: gradientThumb('Macro Setup For Q3', ...C.macro),
    channel: CH.coinbureau,
    duration: 28 * 60 + 19,
    publishedAt: daysAgo(8),
    viewCount: 412_800,
    tags: ['MACRO', 'BTC'],
    description: 'Guy reads the dollar, rates, and liquidity to frame the risk-asset path into year-end.',
    category: 'Macro',
  }),
  item({
    title: 'Modular vs Monolithic: The Scaling Debate That Decides The Decade',
    thumbnail: gradientThumb('Modular vs Monolithic', ...C.indigo),
    channel: CH.bellcurve,
    duration: 1 * 3600 + 4 * 60 + 38,
    publishedAt: daysAgo(10),
    viewCount: 103_500,
    tags: ['ETH', 'TIA'],
    description: 'Data availability, execution layers, and where value actually accrues in the stack.',
    category: 'Ethereum',
  }),
  item({
    title: 'The Liquidity Map: Following Smart Money Across Chains',
    thumbnail: gradientThumb('The Liquidity Map', ...C.teal),
    channel: CH.rollup,
    duration: 39 * 60 + 12,
    publishedAt: daysAgo(12),
    viewCount: 78_900,
    tags: ['DEFI', 'SOL'],
    description: 'On-chain flows, bridge volume, and reading where the marginal buyer actually is.',
    category: 'DeFi',
  }),
  item({
    title: 'Bitcoin Halving Aftermath: Miners, Hashprice & The Reflexive Top',
    thumbnail: gradientThumb('Halving Aftermath', ...C.bitcoin),
    channel: CH.wbd,
    duration: 47 * 60 + 1,
    publishedAt: daysAgo(16),
    viewCount: 264_100,
    tags: ['BTC'],
    description: 'Miner economics, hashprice compression, and the reflexive cycle that follows every halving.',
    category: 'Bitcoin',
  }),
  item({
    title: 'The Everything Token Thesis: Why Solana DeFi Is Underpriced',
    thumbnail: gradientThumb('Everything Token Thesis', ...C.solana),
    channel: CH.lightspeed,
    duration: 37 * 60 + 26,
    publishedAt: daysAgo(22),
    viewCount: 91_400,
    tags: ['SOL', 'JUP'],
    description: 'Mert on Solana app revenue, real users, and the mispricing between activity and FDV.',
    category: 'Solana',
  }),
]

/* ─────────────────────────────────────────────────────────────────────
   PODCASTS — ~12 podcast items (source 'podcast-index', valid audioUrl).
   ───────────────────────────────────────────────────────────────────── */
let _podSeq = 0

function podcast(opts) {
  _podSeq += 1
  // Most real shows publish NO transcript, so dev has to be able to show both
  // states: every third sample episode ships without one, which is the branch
  // where the player says so instead of inventing captions.
  const withTranscript = opts.hasTranscript ?? (_podSeq % 3 !== 0)
  return item({
    ...opts,
    type: 'podcast',
    source: 'podcast-index',
    audioUrl: SAMPLE_MP3,
    feedId: `sample_${(opts.channel?.name || 'show').toLowerCase().replace(/\W+/g, '')}`,
    hasTranscript: withTranscript,
    transcripts: withTranscript
      ? [{ url: 'https://sample.spectreai.io/transcript.json', type: 'application/json' }]
      : [],
  })
}

/* Timed cues over the 15s sample clip, so the live-caption rail visibly tracks
   playback in dev. Prod cues come from the show's own published transcript. */
const SAMPLE_TRANSCRIPT = {
  kind: 'timed',
  source: 'dev-sample',
  paragraphs: [],
  cues: [
    { s: 0.0,  e: 2.4,  t: 'Welcome back. The setup into this week is the cleanest it has looked all quarter.', sp: 'Host' },
    { s: 2.4,  e: 4.8,  t: 'Spot is absorbing supply while funding stays flat, which is not what a blow-off looks like.', sp: 'Host' },
    { s: 4.8,  e: 7.2,  t: 'Push back on that. Flat funding with rising open interest is late-cycle behaviour.', sp: 'Guest' },
    { s: 7.2,  e: 9.6,  t: 'Fair. The difference is where the bid is coming from this time.', sp: 'Host' },
    { s: 9.6,  e: 12.0, t: 'Stablecoin float is up double digits month over month, and it is not sitting on exchanges.', sp: 'Guest' },
    { s: 12.0, e: 15.0, t: 'Which is the whole argument. Settlement demand, not leverage demand.', sp: 'Host' },
  ],
}

const SAMPLE_PODCASTS = [
  podcast({
    title: 'Empire: The Stablecoin Supercycle With Sam Kazemian',
    thumbnail: gradientThumb('The Stablecoin Supercycle', ...C.stable),
    channel: CH.empire,
    duration: 1 * 3600 + 8 * 60 + 24,
    publishedAt: hoursAgo(9),
    viewCount: 62_400,
    tags: ['USDC', 'FRAX'],
    description: 'Float economics, FX rails, and why the dollar is migrating on-chain faster than anyone modeled.',
    category: 'Stablecoins',
  }),
  podcast({
    title: 'Bankless: The Ethereum Endgame Roadmap With Vitalik',
    thumbnail: gradientThumb('The Ethereum Endgame', ...C.ethereum),
    channel: CH.bankless,
    duration: 1 * 3600 + 22 * 60 + 51,
    publishedAt: hoursAgo(28),
    viewCount: 144_900,
    tags: ['ETH'],
    description: 'Vitalik on the Surge, the Verge, and the unglamorous engineering that actually scales L1.',
    category: 'Ethereum',
  }),
  podcast({
    title: 'Lightspeed: Solana Throughput And The Firedancer Era',
    thumbnail: gradientThumb('The Firedancer Era', ...C.solana),
    channel: CH.lightspeed,
    duration: 58 * 60 + 17,
    publishedAt: daysAgo(1),
    viewCount: 41_200,
    tags: ['SOL'],
    description: 'Mert Mumtaz on a second validator client, MEV, and what real decentralization costs.',
    category: 'Solana',
  }),
  podcast({
    title: 'Bell Curve: Where Value Accrues In A Modular World',
    thumbnail: gradientThumb('Where Value Accrues', ...C.indigo),
    channel: CH.bellcurve,
    duration: 1 * 3600 + 3 * 60 + 9,
    publishedAt: daysAgo(2),
    viewCount: 38_700,
    tags: ['ETH', 'TIA'],
    description: 'The fat-app vs fat-protocol debate, redux — and who captures the fees in the end.',
    category: 'DeFi',
  }),
  podcast({
    title: 'Unchained: Inside The Market Structure Bill',
    thumbnail: gradientThumb('The Market Structure Bill', ...C.regulation),
    channel: CH.unchained,
    duration: 54 * 60 + 38,
    publishedAt: daysAgo(3),
    viewCount: 33_500,
    tags: ['REG'],
    description: 'Laura Shin and counsel on the clearest path yet to US regulatory clarity for tokens.',
    category: 'Regulation',
  }),
  podcast({
    title: 'Real Vision: The 2026 Liquidity Thesis With Raoul Pal',
    thumbnail: gradientThumb('The 2026 Liquidity Thesis', ...C.macro),
    channel: CH.realvision,
    duration: 1 * 3600 + 14 * 60 + 2,
    publishedAt: daysAgo(4),
    viewCount: 88_100,
    tags: ['MACRO', 'BTC'],
    description: 'Global M2, the business cycle, and the everything-code framework for the next 18 months.',
    category: 'Macro',
  }),
  podcast({
    title: 'The Defiant: Real Yield, Real Users, Real Revenue',
    thumbnail: gradientThumb('Real Yield, Real Users', ...C.defi),
    channel: CH.defiant,
    duration: 49 * 60 + 55,
    publishedAt: daysAgo(5),
    viewCount: 26_800,
    tags: ['AAVE', 'UNI'],
    description: 'DeFi Dad on protocols that print fees instead of emissions, and how to find them on-chain.',
    category: 'DeFi',
  }),
  podcast({
    title: 'What Bitcoin Did: The Treasury Company Arms Race',
    thumbnail: gradientThumb('The Treasury Arms Race', ...C.bitcoin),
    channel: CH.wbd,
    duration: 1 * 3600 + 31 * 60 + 16,
    publishedAt: daysAgo(6),
    viewCount: 119_300,
    tags: ['BTC', 'MSTR'],
    description: 'Corporate Bitcoin demand, premium-to-NAV games, and the reflexivity nobody is hedging.',
    category: 'Bitcoin',
  }),
  podcast({
    title: 'Coin Bureau Podcast: Reading The Dollar Wrecking Ball',
    thumbnail: gradientThumb('The Dollar Wrecking Ball', ...C.crimson),
    channel: CH.coinbureau,
    duration: 42 * 60 + 7,
    publishedAt: daysAgo(8),
    viewCount: 71_600,
    tags: ['MACRO', 'DXY'],
    description: 'Guy on DXY, real rates, and the macro tape that front-runs every risk-asset move.',
    category: 'Macro',
  }),
  podcast({
    title: 'Empire: The On-Chain Derivatives War Heats Up',
    thumbnail: gradientThumb('The Derivatives War', ...C.trading),
    channel: CH.empire,
    duration: 1 * 3600 + 5 * 60 + 44,
    publishedAt: daysAgo(11),
    viewCount: 47_900,
    tags: ['HYPE', 'DYDX'],
    description: 'Order books vs AMMs, fee tiers, and why perp DEXs are taking CEX market share.',
    category: 'Trading',
  }),
  podcast({
    title: 'Into The Cryptoverse: Risk Curves And The Cycle Top',
    thumbnail: gradientThumb('Risk Curves & The Top', ...C.rwa),
    channel: CH.cowen,
    duration: 38 * 60 + 29,
    publishedAt: daysAgo(15),
    viewCount: 102_400,
    tags: ['BTC', 'ETH'],
    description: 'Benjamin Cowen on risk metrics, the logarithmic regression, and disciplined de-risking.',
    category: 'Markets',
  }),
  podcast({
    title: 'Bell Curve: The Agent Economy And On-Chain Compute',
    thumbnail: gradientThumb('The Agent Economy', ...C.ai),
    channel: CH.bellcurve,
    duration: 1 * 3600 + 9 * 60 + 12,
    publishedAt: daysAgo(20),
    viewCount: 35_100,
    tags: ['AI', 'TAO'],
    description: 'Autonomous agents transacting for compute and data — the real demand under the narrative.',
    category: 'AI',
  }),
]

/* ─────────────────────────────────────────────────────────────────────
   SHORTS — ~10 short clips (type 'short', duration < 60).
   ───────────────────────────────────────────────────────────────────── */
function short(opts) {
  return item({ ...opts, type: 'short' })
}

const SAMPLE_SHORTS = [
  short({
    title: 'The one chart that explains the whole cycle',
    thumbnail: gradientThumb('The One Chart', ...C.markets),
    channel: CH.rollup,
    duration: 48,
    publishedAt: hoursAgo(3),
    viewCount: 540_000,
    tags: ['BTC'],
    description: 'Liquidity leads price by ~10 weeks — here is the overlay.',
    category: 'Markets',
  }),
  short({
    title: 'Why ETH gas is suddenly near zero',
    thumbnail: gradientThumb('ETH Gas Near Zero', ...C.ethereum),
    channel: CH.bankless,
    duration: 39,
    publishedAt: hoursAgo(7),
    viewCount: 312_000,
    tags: ['ETH'],
    description: 'Blob fees and L2 settlement, explained in 40 seconds.',
    category: 'Ethereum',
  }),
  short({
    title: 'Solana just did 65M transactions in a day',
    thumbnail: gradientThumb('65M Transactions', ...C.solana),
    channel: CH.lightspeed,
    duration: 31,
    publishedAt: hoursAgo(11),
    viewCount: 488_000,
    tags: ['SOL'],
    description: 'Throughput is the moat — until it is the liability.',
    category: 'Solana',
  }),
  short({
    title: 'Stablecoin supply just hit an all-time high',
    thumbnail: gradientThumb('Stablecoin ATH', ...C.stable),
    channel: CH.defiant,
    duration: 27,
    publishedAt: daysAgo(1),
    viewCount: 221_000,
    tags: ['USDC', 'USDT'],
    description: 'Dry powder or dollar flight? The data is bullish.',
    category: 'Stablecoins',
  }),
  short({
    title: 'The RWA number that broke $10B',
    thumbnail: gradientThumb('RWAs Break $10B', ...C.rwa),
    channel: CH.empire,
    duration: 44,
    publishedAt: daysAgo(2),
    viewCount: 176_500,
    tags: ['ONDO', 'RWA'],
    description: 'Tokenized treasuries went vertical. Here is who is buying.',
    category: 'RWAs',
  }),
  short({
    title: 'Raoul Pal in 30 seconds: the macro setup',
    thumbnail: gradientThumb('Macro In 30 Seconds', ...C.macro),
    channel: CH.realvision,
    duration: 33,
    publishedAt: daysAgo(3),
    viewCount: 402_900,
    tags: ['MACRO'],
    description: 'The business cycle is turning — front-run the rotation.',
    category: 'Macro',
  }),
  short({
    title: 'Perp DEX volume just flipped a top-5 CEX',
    thumbnail: gradientThumb('Perps Flip A CEX', ...C.trading),
    channel: CH.rollup,
    duration: 52,
    publishedAt: daysAgo(4),
    viewCount: 189_300,
    tags: ['HYPE'],
    description: 'On-chain derivatives are taking share faster than anyone modeled.',
    category: 'Trading',
  }),
  short({
    title: 'The altcoin rotation tell to watch',
    thumbnail: gradientThumb('The Rotation Tell', ...C.altcoin),
    channel: CH.uponly,
    duration: 41,
    publishedAt: daysAgo(6),
    viewCount: 256_700,
    tags: ['ALTS'],
    description: 'When dominance rolls over, this is where liquidity goes first.',
    category: 'Altcoins',
  }),
  short({
    title: 'What the new crypto bill actually changes',
    thumbnail: gradientThumb('What The Bill Changes', ...C.regulation),
    channel: CH.unchained,
    duration: 56,
    publishedAt: daysAgo(9),
    viewCount: 98_200,
    tags: ['REG'],
    description: 'Custody, market structure, and the clarity nobody expected.',
    category: 'Regulation',
  }),
  short({
    title: 'AI agents are paying for compute on-chain',
    thumbnail: gradientThumb('Agents Pay On-Chain', ...C.ai),
    channel: CH.bellcurve,
    duration: 37,
    publishedAt: daysAgo(13),
    viewCount: 143_800,
    tags: ['AI', 'TAO'],
    description: 'The agent economy is small, real, and growing — the receipts are on-chain.',
    category: 'AI',
  }),
]

/* ─────────────────────────────────────────────────────────────────────
   LIVE — ~4 live items (type 'live').
   ───────────────────────────────────────────────────────────────────── */
function live(opts) {
  return item({ ...opts, type: 'live', duration: 0, source: opts.source || 'youtube' })
}

const SAMPLE_LIVE = [
  live({
    title: 'LIVE: The Daily Tape — Markets Open Macro Show',
    thumbnail: gradientThumb('The Daily Tape — LIVE', ...C.markets),
    channel: CH.rollup,
    publishedAt: hoursAgo(1),
    viewCount: 8_400,
    tags: ['BTC', 'MACRO'],
    description: 'Live read of the open: liquidity, funding, and the catalysts that matter today.',
    category: 'Markets',
  }),
  live({
    title: 'LIVE: Bankless Town Hall — Ask Us Anything',
    thumbnail: gradientThumb('Bankless Town Hall — LIVE', ...C.ethereum),
    channel: CH.bankless,
    publishedAt: hoursAgo(1),
    viewCount: 12_700,
    tags: ['ETH'],
    description: 'Open Q&A on the Ethereum roadmap, L2 fees, and the staking debate.',
    category: 'Ethereum',
  }),
  live({
    title: 'LIVE: Solana Builders Stream — Firedancer Watch',
    thumbnail: gradientThumb('Solana Builders — LIVE', ...C.solana),
    channel: CH.lightspeed,
    source: 'twitch',
    url: 'https://player.twitch.tv/?channel=lightspeed&parent=localhost',
    publishedAt: hoursAgo(2),
    viewCount: 5_900,
    tags: ['SOL'],
    description: 'Validator client testing, MEV experiments, and live throughput numbers.',
    category: 'Solana',
  }),
  live({
    title: 'LIVE: Real Vision — Global Macro Roundtable',
    thumbnail: gradientThumb('Macro Roundtable — LIVE', ...C.macro),
    channel: CH.realvision,
    publishedAt: hoursAgo(3),
    viewCount: 15_300,
    tags: ['MACRO'],
    description: 'Cross-asset desk talks the dollar, rates, and the liquidity tide into quarter-end.',
    category: 'Macro',
  }),
]

/* ─────────────────────────────────────────────────────────────────────
   DISCOVER — featured + ordered sections for the redesign landing.
   Section items are drawn from the curated pools above (fresh instances
   so ids stay globally unique).
   ───────────────────────────────────────────────────────────────────── */

/* New Releases rail — ~8 of the freshest long-form videos. */
const NEW_RELEASES = [
  item({
    title: "Bitcoin's Quiet Accumulation: Reading The On-Chain Cohorts",
    thumbnail: gradientThumb('Quiet Accumulation', ...C.bitcoin),
    channel: CH.wbd,
    duration: 34 * 60 + 18,
    publishedAt: hoursAgo(4),
    viewCount: 142_800,
    tags: ['BTC'],
    description: 'Long-term holder supply is climbing while price chops — what the cohorts are telling us.',
    category: 'Bitcoin',
  }),
  item({
    title: 'The ETH/BTC Trade Nobody Wants To Take',
    thumbnail: gradientThumb('The ETH/BTC Trade', ...C.ethereum),
    channel: CH.cowen,
    duration: 22 * 60 + 9,
    publishedAt: hoursAgo(8),
    viewCount: 96_200,
    tags: ['ETH', 'BTC'],
    description: 'Maximum pessimism on the ratio is usually where the asymmetric setups live.',
    category: 'Ethereum',
  }),
  item({
    title: 'Solana DeFi Just Quietly Flipped A Milestone',
    thumbnail: gradientThumb('Solana DeFi Flip', ...C.solana),
    channel: CH.lightspeed,
    duration: 29 * 60 + 41,
    publishedAt: hoursAgo(12),
    viewCount: 73_400,
    tags: ['SOL', 'JUP'],
    description: 'App revenue, real users, and the mispricing between on-chain activity and FDV.',
    category: 'Solana',
  }),
  item({
    title: 'Stablecoin Float Economics, Explained Simply',
    thumbnail: gradientThumb('Float Economics', ...C.stable),
    channel: CH.empire,
    duration: 31 * 60 + 55,
    publishedAt: hoursAgo(18),
    viewCount: 64_900,
    tags: ['USDC', 'USDT'],
    description: 'Who earns the yield on the dollars, and why it is the best business in crypto.',
    category: 'Stablecoins',
  }),
  item({
    title: 'The DeFi Yields That Are Actually Sustainable',
    thumbnail: gradientThumb('Sustainable Yields', ...C.defi),
    channel: CH.defiant,
    duration: 36 * 60 + 12,
    publishedAt: daysAgo(1),
    viewCount: 51_300,
    tags: ['AAVE', 'UNI'],
    description: 'DeFi Dad separates fee-backed yield from emissions theater, protocol by protocol.',
    category: 'DeFi',
  }),
  item({
    title: 'RWA Rails: How Treasuries Got Tokenized',
    thumbnail: gradientThumb('RWA Rails', ...C.rwa),
    channel: CH.bankless,
    duration: 43 * 60 + 30,
    publishedAt: daysAgo(2),
    viewCount: 88_700,
    tags: ['ONDO', 'RWA'],
    description: 'The plumbing behind tokenized money funds and why institutions finally said yes.',
    category: 'RWAs',
  }),
  item({
    title: 'The Macro Tape: Liquidity Is Turning',
    thumbnail: gradientThumb('Liquidity Is Turning', ...C.macro),
    channel: CH.realvision,
    duration: 40 * 60 + 2,
    publishedAt: daysAgo(2),
    viewCount: 134_500,
    tags: ['MACRO', 'BTC'],
    description: 'Raoul Pal on the inflection in global liquidity and what front-runs the move.',
    category: 'Macro',
  }),
  item({
    title: 'Altcoin Season Mechanics: The Liquidity Waterfall',
    thumbnail: gradientThumb('The Liquidity Waterfall', ...C.altcoin),
    channel: CH.uponly,
    duration: 47 * 60 + 38,
    publishedAt: daysAgo(3),
    viewCount: 162_900,
    tags: ['ALTS', 'SOL'],
    description: 'How capital cascades from BTC to ETH to majors to long-tail — and the tells at each step.',
    category: 'Altcoins',
  }),
]

/* Trending Podcasts rail — ~6 podcast items (fresh instances). */
const TRENDING_PODCASTS = [
  podcast({
    title: 'Empire: The Float Wars — Who Owns The Dollar On-Chain',
    thumbnail: gradientThumb('The Float Wars', ...C.stable),
    channel: CH.empire,
    duration: 1 * 3600 + 2 * 60 + 11,
    publishedAt: hoursAgo(10),
    viewCount: 44_300,
    tags: ['USDC', 'FRAX'],
    description: 'Sam Kazemian on stablecoin float, FX rails, and the payments endgame.',
    category: 'Stablecoins',
  }),
  podcast({
    title: 'Bankless: Vitalik On Ethereum After The Merge',
    thumbnail: gradientThumb('Ethereum After The Merge', ...C.ethereum),
    channel: CH.bankless,
    duration: 1 * 3600 + 18 * 60 + 7,
    publishedAt: hoursAgo(30),
    viewCount: 121_700,
    tags: ['ETH'],
    description: 'The Surge, the Verge, and the unglamorous work that actually scales the L1.',
    category: 'Ethereum',
  }),
  podcast({
    title: 'Lightspeed: The Firedancer Question',
    thumbnail: gradientThumb('The Firedancer Question', ...C.solana),
    channel: CH.lightspeed,
    duration: 55 * 60 + 49,
    publishedAt: daysAgo(1),
    viewCount: 39_800,
    tags: ['SOL'],
    description: 'Mert Mumtaz on a second validator client and what real decentralization costs.',
    category: 'Solana',
  }),
  podcast({
    title: 'Real Vision: The Everything Code, Updated',
    thumbnail: gradientThumb('The Everything Code', ...C.macro),
    channel: CH.realvision,
    duration: 1 * 3600 + 11 * 60 + 25,
    publishedAt: daysAgo(2),
    viewCount: 84_600,
    tags: ['MACRO', 'BTC'],
    description: 'Raoul Pal refreshes the liquidity framework for the next 18 months.',
    category: 'Macro',
  }),
  podcast({
    title: 'Unchained: The Custody Clarity Episode',
    thumbnail: gradientThumb('The Custody Clarity', ...C.regulation),
    channel: CH.unchained,
    duration: 51 * 60 + 3,
    publishedAt: daysAgo(4),
    viewCount: 31_200,
    tags: ['REG'],
    description: 'Laura Shin on what the market structure bill changes for custody and tokens.',
    category: 'Regulation',
  }),
  podcast({
    title: 'Bell Curve: Fat Apps And The Fee Endgame',
    thumbnail: gradientThumb('Fat Apps, Fee Endgame', ...C.defi),
    channel: CH.bellcurve,
    duration: 58 * 60 + 41,
    publishedAt: daysAgo(6),
    viewCount: 36_500,
    tags: ['ETH', 'UNI'],
    description: 'Where value accrues when execution is cheap and apps capture the relationship.',
    category: 'DeFi',
  }),
]

/* Live Now rail — ~3 live items (fresh instances). */
const LIVE_NOW = [
  live({
    title: 'LIVE: The Open — Spectre Markets Desk',
    thumbnail: gradientThumb('The Open — LIVE', ...C.markets),
    channel: CH.rollup,
    publishedAt: hoursAgo(1),
    viewCount: 9_200,
    tags: ['BTC', 'MACRO'],
    description: 'Live coverage of the session open: funding, flows, and the catalysts on deck.',
    category: 'Markets',
  }),
  live({
    title: 'LIVE: Ethereum Core Devs Public Call',
    thumbnail: gradientThumb('Core Devs Call — LIVE', ...C.ethereum),
    channel: CH.bankless,
    publishedAt: hoursAgo(1),
    viewCount: 6_700,
    tags: ['ETH'],
    description: 'Walkthrough of the next hard fork agenda and the testnet timeline.',
    category: 'Ethereum',
  }),
  live({
    title: 'LIVE: Solana Real-Time Throughput Stream',
    thumbnail: gradientThumb('Throughput — LIVE', ...C.solana),
    channel: CH.lightspeed,
    source: 'twitch',
    url: 'https://player.twitch.tv/?channel=solana&parent=localhost',
    publishedAt: hoursAgo(2),
    viewCount: 4_100,
    tags: ['SOL'],
    description: 'Live TPS, fee markets, and validator health from the Firedancer testnet.',
    category: 'Solana',
  }),
]

/* All Content grid — ~12 mixed video items (fresh instances). */
const ALL_CONTENT = [
  item({
    title: 'The Four-Year Cycle Is Not Dead (Yet)',
    thumbnail: gradientThumb('The Four-Year Cycle', ...C.bitcoin),
    channel: CH.cowen,
    duration: 24 * 60 + 12,
    publishedAt: hoursAgo(5),
    viewCount: 187_400,
    tags: ['BTC'],
    description: 'Why the halving rhythm still rhymes even as the buyers change.',
    category: 'Bitcoin',
  }),
  item({
    title: 'L2 Fees Went To Zero — Now What?',
    thumbnail: gradientThumb('L2 Fees To Zero', ...C.ethereum),
    channel: CH.bankless,
    duration: 31 * 60 + 47,
    publishedAt: hoursAgo(15),
    viewCount: 92_100,
    tags: ['ETH', 'ARB'],
    description: 'Blobs cratered settlement costs — the second-order effects matter more than the headline.',
    category: 'Ethereum',
  }),
  item({
    title: 'The Solana App Revenue Leaderboard',
    thumbnail: gradientThumb('App Revenue Leaderboard', ...C.solana),
    channel: CH.lightspeed,
    duration: 27 * 60 + 33,
    publishedAt: daysAgo(1),
    viewCount: 68_900,
    tags: ['SOL', 'JUP'],
    description: 'Which Solana apps actually print fees, ranked — and which are vanity TVL.',
    category: 'Solana',
  }),
  item({
    title: 'Inside The Perp DEX Order Book War',
    thumbnail: gradientThumb('Order Book War', ...C.trading),
    channel: CH.rollup,
    duration: 42 * 60 + 5,
    publishedAt: daysAgo(2),
    viewCount: 111_200,
    tags: ['HYPE', 'DYDX'],
    description: 'On-chain order books vs AMMs — the design tradeoffs that decide the winner.',
    category: 'Trading',
  }),
  item({
    title: 'Tokenized Treasuries: The Institutional Onramp',
    thumbnail: gradientThumb('Institutional Onramp', ...C.rwa),
    channel: CH.empire,
    duration: 38 * 60 + 19,
    publishedAt: daysAgo(2),
    viewCount: 79_500,
    tags: ['ONDO', 'RWA'],
    description: 'How money funds chose chains and what the next $50B of RWA demand looks like.',
    category: 'RWAs',
  }),
  item({
    title: 'Real Yield, Decoded: A Protocol-By-Protocol Tour',
    thumbnail: gradientThumb('Real Yield Decoded', ...C.defi),
    channel: CH.defiant,
    duration: 45 * 60 + 51,
    publishedAt: daysAgo(3),
    viewCount: 57_800,
    tags: ['AAVE', 'UNI'],
    description: 'DeFi Dad maps fee-backed yield across lending, DEXs, and LSTs.',
    category: 'DeFi',
  }),
  item({
    title: 'The Dollar Wrecking Ball And Risk Assets',
    thumbnail: gradientThumb('Dollar Wrecking Ball', ...C.macro),
    channel: CH.coinbureau,
    duration: 29 * 60 + 8,
    publishedAt: daysAgo(4),
    viewCount: 203_600,
    tags: ['MACRO', 'DXY'],
    description: 'Guy on DXY, real rates, and the macro tape that front-runs every risk move.',
    category: 'Macro',
  }),
  item({
    title: 'Altcoin Rotation: Reading The Dominance Roll',
    thumbnail: gradientThumb('Dominance Roll', ...C.altcoin),
    channel: CH.uponly,
    duration: 53 * 60 + 27,
    publishedAt: daysAgo(5),
    viewCount: 148_300,
    tags: ['ALTS', 'SOL', 'LINK'],
    description: 'When BTC dominance rolls over, here is the playbook for where liquidity flows.',
    category: 'Altcoins',
  }),
  item({
    title: 'The Market Structure Bill, Section By Section',
    thumbnail: gradientThumb('Section By Section', ...C.regulation),
    channel: CH.unchained,
    duration: 48 * 60 + 14,
    publishedAt: daysAgo(7),
    viewCount: 64_700,
    tags: ['REG'],
    description: 'Laura Shin and counsel parse the bill that finally gives tokens legal clarity.',
    category: 'Regulation',
  }),
  item({
    title: 'The Agent Economy Is Smaller And Realer Than You Think',
    thumbnail: gradientThumb('The Agent Economy', ...C.ai),
    channel: CH.bellcurve,
    duration: 51 * 60 + 39,
    publishedAt: daysAgo(9),
    viewCount: 96_400,
    tags: ['AI', 'TAO'],
    description: 'Autonomous agents paying for compute on-chain — the demand under the narrative.',
    category: 'AI',
  }),
  item({
    title: 'Bitcoin Mining Economics In A Low-Hashprice World',
    thumbnail: gradientThumb('Low Hashprice World', ...C.bitcoin),
    channel: CH.wbd,
    duration: 56 * 60 + 2,
    publishedAt: daysAgo(12),
    viewCount: 172_800,
    tags: ['BTC'],
    description: 'Hashprice compression, miner balance sheets, and the reflexive cycle that follows.',
    category: 'Bitcoin',
  }),
  item({
    title: 'Where The Smart Money Is Bridging Now',
    thumbnail: gradientThumb('Smart Money Bridging', ...C.teal),
    channel: CH.rollup,
    duration: 33 * 60 + 44,
    publishedAt: daysAgo(18),
    viewCount: 71_100,
    tags: ['DEFI', 'SOL'],
    description: 'Reading bridge volume and on-chain flows to find the marginal buyer.',
    category: 'DeFi',
  }),
]

const SAMPLE_DISCOVER = {
  featured: FEATURED,
  sections: [
    { id: 'new-releases', title: 'New Releases', layout: 'rail', items: NEW_RELEASES },
    { id: 'trending-podcasts', title: 'Trending Podcasts', layout: 'podcast', items: TRENDING_PODCASTS },
    { id: 'live', title: 'Live Now', layout: 'rail', items: LIVE_NOW },
    { id: 'all', title: 'All Content', layout: 'grid', items: ALL_CONTENT },
  ],
}

/* ─────────────────────────────────────────────────────────────────────
   CHANNELS — ~10 channel objects (matches the existing channel schema).
   ───────────────────────────────────────────────────────────────────── */
function channel(opts) {
  return {
    id: opts.id,
    source: 'youtube',
    name: opts.name,
    description: opts.description,
    avatar: opts.avatar,
    banner: null,
    subscriberCount: opts.subscriberCount,
    videoCount: opts.videoCount,
    lastUpload: null,
    isLive: opts.isLive || false,
    url: opts.url,
    category: opts.category,
  }
}

const SAMPLE_CHANNELS = [
  channel({
    id: 'yt_ch_therollup',
    name: 'The Rollup',
    description: 'The future of finance, on-chain. Deep dives with the builders moving markets.',
    avatar: CH.rollup.avatar,
    subscriberCount: 184_000,
    videoCount: 612,
    isLive: true,
    url: CH.rollup.url,
    category: 'crypto',
  }),
  channel({
    id: 'yt_ch_bankless',
    name: 'Bankless',
    description: 'Going bankless. The frontier of money, Ethereum, and the open financial system.',
    avatar: CH.bankless.avatar,
    subscriberCount: 642_000,
    videoCount: 1840,
    url: CH.bankless.url,
    category: 'crypto',
  }),
  channel({
    id: 'yt_ch_thedefiant',
    name: 'The Defiant',
    description: 'DeFi news, real yield, and the protocols reshaping finance from the ground up.',
    avatar: CH.defiant.avatar,
    subscriberCount: 158_000,
    videoCount: 1120,
    url: CH.defiant.url,
    category: 'crypto',
  }),
  channel({
    id: 'yt_ch_empire',
    name: 'Empire',
    description: 'Blockworks flagship. The macro, the markets, and the money flowing into crypto.',
    avatar: CH.empire.avatar,
    subscriberCount: 96_500,
    videoCount: 430,
    url: CH.empire.url,
    category: 'finance',
  }),
  channel({
    id: 'yt_ch_realvision',
    name: 'Real Vision',
    description: 'Raoul Pal and the global macro desk. Liquidity, cycles, and the everything code.',
    avatar: CH.realvision.avatar,
    subscriberCount: 512_000,
    videoCount: 3210,
    url: CH.realvision.url,
    category: 'finance',
  }),
  channel({
    id: 'yt_ch_coinbureau',
    name: 'Coin Bureau',
    description: 'Education-first crypto research. Macro, tokens, and the clearest explainers in the space.',
    avatar: CH.coinbureau.avatar,
    subscriberCount: 2_410_000,
    videoCount: 980,
    url: CH.coinbureau.url,
    category: 'education',
  }),
  channel({
    id: 'yt_ch_uponly',
    name: 'UpOnly',
    description: 'Cobie and Ledger. Unfiltered conversations with the most interesting people in crypto.',
    avatar: CH.uponly.avatar,
    subscriberCount: 124_000,
    videoCount: 210,
    url: CH.uponly.url,
    category: 'crypto',
  }),
  channel({
    id: 'yt_ch_unchained',
    name: 'Unchained',
    description: 'Laura Shin on regulation, market structure, and the people building the future.',
    avatar: CH.unchained.avatar,
    subscriberCount: 142_000,
    videoCount: 760,
    url: CH.unchained.url,
    category: 'news',
  }),
  channel({
    id: 'yt_ch_intothecryptoverse',
    name: 'Into The Cryptoverse',
    description: 'Benjamin Cowen. Data-driven risk management, cycles, and disciplined investing.',
    avatar: CH.cowen.avatar,
    subscriberCount: 788_000,
    videoCount: 1450,
    url: CH.cowen.url,
    category: 'education',
  }),
  channel({
    id: 'yt_ch_lightspeed',
    name: 'Lightspeed',
    description: 'Everything Solana. Throughput, apps, and the monolithic scaling thesis.',
    avatar: CH.lightspeed.avatar,
    subscriberCount: 58_700,
    videoCount: 320,
    url: CH.lightspeed.url,
    category: 'crypto',
  }),
]

/* ── Exports ──────────────────────────────────────────────────────────── */
export {
  SAMPLE_DISCOVER,
  SAMPLE_PODCASTS,
  SAMPLE_TRANSCRIPT,
  SAMPLE_VIDEOS,
  SAMPLE_SHORTS,
  SAMPLE_LIVE,
  SAMPLE_CHANNELS,
}
