/**
 * Match Engine question data.
 * Each step has: id, question, subtitle, and options with id/label/icon (inline SVG path).
 */

const rocket = 'M12 2C12 2 7 7 7 12.5C7 15.5 9.24 18 12 18C14.76 18 17 15.5 17 12.5C17 7 12 2 12 2ZM12 16C10.34 16 9 14.43 9 12.5C9 9.5 11 5.5 12 4C13 5.5 15 9.5 15 12.5C15 14.43 13.66 16 12 16Z'
const shield = 'M12 2L4 5V11.09C4 16.14 7.41 20.85 12 22C16.59 20.85 20 16.14 20 11.09V5L12 2ZM18 11.09C18 15.09 15.45 18.72 12 19.93C8.55 18.72 6 15.09 6 11.09V6.39L12 4.14L18 6.39V11.09Z'
const image = 'M21 3H3C1.9 3 1 3.9 1 5V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V5C23 3.9 22.1 3 21 3ZM21 19H3V5H21V19ZM5 17L9 12L12 16L14 13L19 19'
const building = 'M12 7V3H2V21H22V7H12ZM6 19H4V17H6V19ZM6 15H4V13H6V15ZM6 11H4V9H6V11ZM6 7H4V5H6V7ZM10 19H8V17H10V19ZM10 15H8V13H10V15ZM10 11H8V9H10V11ZM10 7H8V5H10V7ZM20 19H12V17H14V15H12V13H14V11H12V9H20V19ZM18 11H16V13H18V11ZM18 15H16V17H18V15Z'
const cpu = 'M9 3V1H7V3H5C3.9 3 3 3.9 3 5V7H1V9H3V11H1V13H3V15H1V17H3V19C3 20.1 3.9 21 5 21H7V23H9V21H11V23H13V21H15V23H17V21H19C20.1 21 21 20.1 21 19V17H23V15H21V13H23V11H21V9H23V7H21V5C21 3.9 20.1 3 19 3H17V1H15V3H13V1H11V3H9ZM19 19H5V5H19V19ZM7 7H17V17H7V7ZM9 9V15H15V9H9Z'

const megaphone = 'M18 6.5L12 10H7C5.9 10 5 10.9 5 12V12C5 13.1 5.9 14 7 14H8L5.5 20H7.5L10 14H12L18 17.5V6.5ZM16 9.5V14.5L12 12.5V11.5L16 9.5ZM20 12C20 13.1 19.5 14.1 18.7 14.8L20 16.1C21.2 14.9 22 13.5 22 12C22 10.5 21.2 9.1 20 7.9L18.7 9.2C19.5 9.9 20 10.9 20 12Z'
const users = 'M16 11C17.66 11 18.99 9.66 18.99 8C18.99 6.34 17.66 5 16 5C14.34 5 13 6.34 13 8C13 9.66 14.34 11 16 11ZM8 11C9.66 11 10.99 9.66 10.99 8C10.99 6.34 9.66 5 8 5C6.34 5 5 6.34 5 8C5 9.66 6.34 11 8 11ZM8 13C5.67 13 1 14.17 1 16.5V19H15V16.5C15 14.17 10.33 13 8 13ZM16 13C15.71 13 15.38 13.02 15.03 13.05C16.19 13.89 17 15.02 17 16.5V19H23V16.5C23 14.17 18.33 13 16 13Z'
const chart = 'M3 13H5V21H3V13ZM7 7H9V21H7V7ZM11 3H13V21H11V3ZM15 9H17V21H15V9ZM19 5H21V21H19V5Z'
const trending = 'M16 6L18.29 8.29L13.41 13.17L9.41 9.17L2 16.59L3.41 18L9.41 12L13.41 16L19.71 9.71L22 12V6H16Z'
const code = 'M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6ZM14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6Z'

const flash = 'M11 21H7V13H2L12 3L22 13H17V21H13V17H11V21Z'
const target = 'M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20ZM12 6C8.69 6 6 8.69 6 12C6 15.31 8.69 18 12 18C15.31 18 18 15.31 18 12C18 8.69 15.31 6 12 6ZM12 16C9.79 16 8 14.21 8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16ZM12 10C10.9 10 10 10.9 10 12C10 13.1 10.9 14 12 14C13.1 14 14 13.1 14 12C14 10.9 13.1 10 12 10Z'
const wallet = 'M21 7H19V5C19 3.9 18.1 3 17 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H21C22.1 21 23 20.1 23 19V9C23 7.9 22.1 7 21 7ZM5 5H17V7H5V5ZM21 19H5V9H21V19ZM16 13.5C16 12.67 16.67 12 17.5 12C18.33 12 19 12.67 19 13.5C19 14.33 18.33 15 17.5 15C16.67 15 16 14.33 16 13.5Z'

export const MATCH_QUESTIONS = [
  {
    id: 'promote',
    question: 'What are you promoting?',
    subtitle: 'Select the type of project to tailor your campaign strategy.',
    options: [
      { id: 'token-launch', label: 'Token Launch', icon: rocket },
      { id: 'defi-protocol', label: 'DeFi Protocol', icon: shield },
      { id: 'nft-collection', label: 'NFT Collection', icon: image },
      { id: 'exchange-cex', label: 'Exchange / CEX', icon: building },
      { id: 'infrastructure', label: 'Infrastructure / L1 / L2', icon: cpu },
    ],
  },
  {
    id: 'goal',
    question: 'Primary goal?',
    subtitle: 'What outcome matters most for this campaign.',
    options: [
      { id: 'brand-awareness', label: 'Brand Awareness', icon: megaphone },
      { id: 'community-growth', label: 'Community Growth', icon: users },
      { id: 'tvl-volume', label: 'TVL / Volume', icon: chart },
      { id: 'token-price', label: 'Token Price Support', icon: trending },
      { id: 'dev-adoption', label: 'Developer Adoption', icon: code },
    ],
  },
  {
    id: 'audience',
    question: 'Target audience?',
    subtitle: 'Who should this campaign reach.',
    options: [
      { id: 'retail-traders', label: 'Retail Traders', icon: trending },
      { id: 'defi-degens', label: 'DeFi Degens', icon: flash },
      { id: 'institutional', label: 'Institutional', icon: building },
      { id: 'developers', label: 'Developers', icon: code },
      { id: 'nft-collectors', label: 'NFT Collectors', icon: image },
    ],
  },
  {
    id: 'budget',
    question: 'Budget range?',
    subtitle: 'This determines scale and channel mix.',
    options: [
      { id: 'budget-5k', label: '$5K - $10K', icon: wallet },
      { id: 'budget-25k', label: '$10K - $25K', icon: wallet },
      { id: 'budget-50k', label: '$25K - $50K', icon: wallet },
      { id: 'budget-100k', label: '$50K - $100K', icon: target },
      { id: 'budget-100k-plus', label: '$100K+', icon: target },
    ],
  },
]

export const CAMPAIGN_RESULTS = {
  'token-launch': {
    wallets: 142847,
    surfaces: 2340,
    cpa: 0.34,
    distribution: [
      { label: 'KOL Amplification', pct: 40 },
      { label: 'Feed Intelligence', pct: 25 },
      { label: 'Protocol Placement', pct: 20 },
      { label: 'Direct Targeting', pct: 15 },
    ],
    recommendation:
      'Based on your token launch targeting retail traders, we recommend a KOL-first strategy. Start with 3-5 S-tier KOLs in the DeFi space for initial momentum, then activate feed intelligence cards to sustain attention. Historical data shows token launches with this profile see 2.4x higher first-week volume when combining KOL amplification with protocol-level placement.',
  },
  'defi-protocol': {
    wallets: 89421,
    surfaces: 1870,
    cpa: 0.52,
    distribution: [
      { label: 'Protocol Placement', pct: 35 },
      { label: 'Feed Intelligence', pct: 30 },
      { label: 'KOL Amplification', pct: 20 },
      { label: 'Direct Targeting', pct: 15 },
    ],
    recommendation:
      'DeFi protocols perform best with protocol-level integration. Place intelligence cards alongside yield aggregators and lending dashboards. Pair with mid-tier DeFi-native KOLs who can demonstrate live usage. Protocols in this budget range typically achieve 1.8x better TVL retention when using feed intelligence as the sustained attention layer.',
  },
  'nft-collection': {
    wallets: 67234,
    surfaces: 1120,
    cpa: 0.71,
    distribution: [
      { label: 'KOL Amplification', pct: 45 },
      { label: 'Direct Targeting', pct: 25 },
      { label: 'Feed Intelligence', pct: 20 },
      { label: 'Protocol Placement', pct: 10 },
    ],
    recommendation:
      'NFT collections require maximum social proof velocity. Deploy 8-12 micro-KOLs simultaneously during the 48-hour pre-mint window, then shift budget to direct targeting of verified collectors. Our data shows collections with coordinated KOL drops achieve 3.1x higher mint-day volume versus staggered campaigns.',
  },
  'exchange-cex': {
    wallets: 215600,
    surfaces: 3890,
    cpa: 0.28,
    distribution: [
      { label: 'Feed Intelligence', pct: 35 },
      { label: 'Direct Targeting', pct: 30 },
      { label: 'KOL Amplification', pct: 20 },
      { label: 'Protocol Placement', pct: 15 },
    ],
    recommendation:
      'Exchange campaigns benefit from broad feed placement combined with precision targeting. Deploy intelligence cards across research dashboards and portfolio trackers to capture active traders at the point of decision. Supplement with trading-focused KOLs who can demonstrate the platform live.',
  },
  'infrastructure': {
    wallets: 53100,
    surfaces: 980,
    cpa: 0.89,
    distribution: [
      { label: 'Feed Intelligence', pct: 30 },
      { label: 'Protocol Placement', pct: 30 },
      { label: 'Direct Targeting', pct: 25 },
      { label: 'KOL Amplification', pct: 15 },
    ],
    recommendation:
      'Infrastructure and L1/L2 campaigns require technical credibility. Focus on developer-facing surfaces and research feeds. Pair with technical KOLs who can speak to architecture. Our data shows infrastructure projects that lead with technical content before marketing achieve 2.7x higher developer adoption rates.',
  },
}
