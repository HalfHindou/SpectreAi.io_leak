/**
 * GTM Knowledge Base, the researched, static substrate for the Crypto GTM
 * proposal engine (X Dash "Institutions" tab).
 *
 * This file is PURE DATA + a few resolver helpers. No fetch, no side effects.
 * Everything here is hand-curated from real consumer-brand crypto history
 * (Nike/RTFKT/.swoosh, Adidas Into the Metaverse, Starbucks Odyssey, Reddit
 * Collectible Avatars, Pudgy Penguins × Walmart, etc.) so the engine can
 * justify recommendations with actual precedent rather than vibes.
 *
 * The product's moat is AUTHENTIC influence: every project and KOL carries a
 * curated `authenticity` (0-100). High = real, durable, organic mindshare.
 * Low = mercenary / bought / churny, the anti-pattern we steer brands AWAY
 * from. We deliberately do NOT list shill-farm accounts here.
 *
 * Scores are editorial estimates for ranking, not market data.
 */

/* ============================================================
 * ECOSYSTEMS, where a brand can land. consumerFit (0-100) = how suited the
 * chain/ecosystem is to a mainstream consumer brand activation (rails,
 * onboarding, distribution, brand precedent, narrative fit).
 * ============================================================ */
export const ECOSYSTEMS = [
  {
    id: 'base',
    name: 'Base',
    chain: 'Base (Coinbase L2)',
    consumerFit: 95,
    strengths: [
      'Coinbase consumer rails, 100M+ verified users, fiat on/off-ramp built in',
      'Farcaster + Frames = native social distribution',
      'Onchain Summer playbook for brand activations',
      'Lowest-friction wallet creation (Smart Wallet, passkeys, no seed phrase)',
      'Jesse Pollak + Base team actively court consumer brands',
    ],
    why: 'The default landing zone for a consumer brand in 2025+: Coinbase distribution, gasless smart wallets your customers already half-trust, and a culture (Onchain Summer, Farcaster) built around brand + creator drops rather than DeFi degens.',
    precedents: ['nike-swoosh-base', 'coinbase-onchain-summer', 'zora-creator-drops'],
  },
  {
    id: 'polygon',
    name: 'Polygon',
    chain: 'Polygon PoS',
    consumerFit: 90,
    strengths: [
      'Deepest enterprise + Fortune-500 brand track record',
      'Near-zero gas, custodial-friendly, easy fiat checkout integrations',
      'Proven large-scale loyalty / collectible programs',
      'Mature agency + tooling ecosystem (no degen-first stigma)',
    ],
    why: 'The enterprise-safe choice with the most blue-chip brand precedent on earth, Starbucks Odyssey, Reddit Collectible Avatars (millions of mainstream wallets), Adidas, and Nike .swoosh all launched here. If legal/brand-safety is the gating concern, Polygon has the receipts.',
    precedents: ['starbucks-odyssey', 'reddit-avatars', 'adidas-metaverse', 'nike-swoosh-polygon'],
  },
  {
    id: 'solana',
    name: 'Solana',
    chain: 'Solana L1',
    consumerFit: 84,
    strengths: [
      'Fastest, cheapest UX for high-volume consumer drops',
      'Strongest memetic / culture velocity of any chain',
      'DePIN + mobile (Saga/Seeker) consumer hardware angle',
      'Blinks / Actions = in-feed transactions on X',
      'Compressed NFTs make million-unit drops economical',
    ],
    why: 'Where culture moves fastest. If the goal is memetic reach, viral drops, or a young crypto-native audience, Solana’s speed, near-free mints, and meme velocity are unmatched, but it skews degen, so brand-safety guardrails matter more here.',
    precedents: ['solana-mobile-drops', 'pudgy-cross-chain'],
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    chain: 'Ethereum L1',
    consumerFit: 72,
    strengths: [
      'Maximum credibility, security, and blue-chip NFT prestige',
      'Deepest liquidity and most valuable collector base',
      'Home of the highest-status PFP / art communities',
      'Strongest decentralization / permanence story',
    ],
    why: 'The prestige layer. Gas and UX make it wrong for mass-market drops, but for a flagship, status-driven, scarce collectible (luxury, art, halo product), an Ethereum mainnet anchor signals seriousness and reaches the wealthiest, stickiest collectors.',
    precedents: ['nike-rtfkt', 'gucci-vault', 'louis-vuitton-treasure-trunk', 'adidas-metaverse'],
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    chain: 'Bitcoin (Ordinals / Runes)',
    consumerFit: 58,
    strengths: [
      'Unmatched brand recognition, "Bitcoin" needs no explanation',
      'Ordinals/Runes give permanence + scarcity narrative',
      'Reaches a distinct, conviction-heavy, OG audience',
      'Strong store-of-value / "digital gold" cultural halo',
    ],
    why: 'A narrative play, not a utility play. Inscribing a flagship collectible on Bitcoin via Ordinals buys maximum mainstream name-recognition and a permanence story, best for a one-off cultural statement or a heritage/luxury brand, not an ongoing loyalty program (tooling and UX are immature).',
    precedents: ['ordinals-cultural-drops'],
  },
  {
    id: 'abstract',
    name: 'Abstract',
    chain: 'Abstract (Pudgy-built L2)',
    consumerFit: 88,
    strengths: [
      'Consumer-first L2 built by the Pudgy Penguins team',
      'Abstract Global Wallet, email/social login, no extension',
      'Gamified, IP/character-driven onboarding (XP, streaks)',
      'Native home of one of the few crypto IPs in Walmart/Target',
    ],
    why: 'Purpose-built for exactly this use case: a consumer chain from the team that put Pudgy Penguins toys in Walmart and Target. Best when the brand is IP/character/community-led and wants gamified onboarding for non-crypto-native fans without seed phrases.',
    precedents: ['pudgy-walmart-target', 'abstract-consumer-apps'],
  },
]

/* ============================================================
 * PRECEDENTS, real consumer-brand crypto moves, keyed by id. Referenced from
 * ecosystems, verticals, and engine reasoning so every recommendation can cite
 * something that actually happened.
 * ============================================================ */
export const PRECEDENTS = {
  'nike-rtfkt': {
    brand: 'Nike',
    label: 'Nike acquired RTFKT (2021) to build virtual sneakers/.swoosh',
    chain: 'Ethereum',
    vertical: 'sportswear',
    note: 'Defined the playbook for a sportswear giant going onchain via an acquisition + Cryptokicks / Clone X. Wound down RTFKT in 2024, lesson: build durable community-owned IP, don’t bolt on a side studio.',
  },
  'nike-swoosh-polygon': {
    brand: 'Nike',
    label: 'Nike .swoosh launched on Polygon (2022)',
    chain: 'Polygon',
    vertical: 'sportswear',
    note: 'Brand-safe, low-gas home for mainstream digital collectibles and "Our Force 1" virtual sneakers.',
  },
  'nike-swoosh-base': {
    brand: 'Nike',
    label: 'Nike .swoosh expanded onto Base (2024+)',
    chain: 'Base',
    vertical: 'sportswear',
    note: 'Migration toward Coinbase consumer rails and cheaper, social-native distribution.',
  },
  'adidas-metaverse': {
    brand: 'Adidas',
    label: 'Adidas "Into the Metaverse" (2021) w/ BAYC, Punks Comic, gmoney',
    chain: 'Ethereum',
    vertical: 'sportswear',
    note: 'Co-branded with the most authentic NFT communities of the moment, borrowed credibility instead of launching cold. ~$22M primary in hours.',
  },
  'starbucks-odyssey': {
    brand: 'Starbucks',
    label: 'Starbucks Odyssey loyalty program on Polygon (2022)',
    chain: 'Polygon',
    vertical: 'food-beverage',
    note: 'The canonical onchain-loyalty / points→collectible "journeys" program. Hid the crypto entirely (no wallet jargon). Wound down 2024, lesson: integrate with the existing rewards app, don’t make a separate destination.',
  },
  'reddit-avatars': {
    brand: 'Reddit',
    label: 'Reddit Collectible Avatars on Polygon (2022)',
    chain: 'Polygon',
    vertical: 'tech-consumer',
    note: 'Largest mainstream NFT onboarding ever, millions of "vaults" created by users who never knew it was crypto. Paid creators, fiat checkout, zero jargon. The blueprint for invisible-crypto consumer scale.',
  },
  'gucci-vault': {
    brand: 'Gucci',
    label: 'Gucci Vault / 10KTF / SUPERGUCCI + crypto checkout',
    chain: 'Ethereum',
    vertical: 'fashion-luxury',
    note: 'Luxury experiments: SUPERPLASTIC collab, accepting crypto in flagship stores, Vault concept space. Prestige + scarcity over scale.',
  },
  'louis-vuitton-treasure-trunk': {
    brand: 'Louis Vuitton',
    label: 'Louis Vuitton "VIA" Treasure Trunk soulbound NFTs (~€39k)',
    chain: 'Ethereum',
    vertical: 'fashion-luxury',
    note: 'Ultra-high-ticket, invite-only phygital membership keyed to physical product, luxury as access, not as mass collectible.',
  },
  'coca-cola-nft': {
    brand: 'Coca-Cola',
    label: 'Coca-Cola loot-box NFTs (Polygon/Tafi) + Pride/holiday drops',
    chain: 'Polygon',
    vertical: 'food-beverage',
    note: 'Charity-tied collectible drops to test the waters, beverage giant treating NFTs as marketing surface, not loyalty.',
  },
  'time-tokenproof': {
    brand: 'TIME',
    label: 'TIMEPieces, NFT membership + token-gated content/IRL',
    chain: 'Ethereum',
    vertical: 'media-music',
    note: 'Media brand using NFTs as a community/membership layer over journalism and events.',
  },
  'pudgy-walmart-target': {
    brand: 'Pudgy Penguins',
    label: 'Pudgy Toys in Walmart & Target; built Abstract chain',
    chain: 'Abstract',
    vertical: 'gaming',
    note: 'The model for crypto-IP → mainstream retail → own consumer L2. Physical toys carry redeemable digital "Forever Pengus".',
  },
  'pudgy-cross-chain': {
    brand: 'Pudgy Penguins',
    label: 'Pudgy / $PENGU token + cross-chain culture (Solana incl.)',
    chain: 'Solana',
    vertical: 'gaming',
    note: 'IP-led community that expanded its token reach across chains where the culture lives.',
  },
  'redbull-racing-web3': {
    brand: 'Red Bull',
    label: 'Oracle Red Bull Racing × Bybit fan-engagement / collectibles',
    chain: 'multi',
    vertical: 'energy-drink',
    note: 'Energy-drink + motorsport using crypto-exchange sponsorship and fan tokens/collectibles around the F1 team.',
  },
  'nas-music-royalties': {
    brand: 'Nas',
    label: 'Nas sold streaming royalty shares of songs via Royal',
    chain: 'multi',
    vertical: 'media-music',
    note: 'Artist-as-asset: fans own a slice of song royalties. The template for music-rights and fan-ownership plays.',
  },
  'sound-music-drops': {
    brand: 'Sound.xyz artists',
    label: 'Sound.xyz, artists drop limited songs, fans collect + comment onchain',
    chain: 'Ethereum/Base',
    vertical: 'media-music',
    note: 'Where music actually has authentic onchain community, superfans, not speculators. Best partner surface for a music brand.',
  },
  'coinbase-onchain-summer': {
    brand: 'Coinbase',
    label: 'Onchain Summer, brand + creator activations on Base',
    chain: 'Base',
    vertical: 'tech-consumer',
    note: 'Coinbase’s recurring program that gives brands a ready-made, co-marketed launch moment on Base.',
  },
  'zora-creator-drops': {
    brand: 'Zora',
    label: 'Zora, permissionless creator mints / "every post is a coin"',
    chain: 'Base',
    vertical: 'media-music',
    note: 'The creator-economy mint rail on Base, content as collectible with built-in creator rewards.',
  },
  'solana-mobile-drops': {
    brand: 'Solana Mobile',
    label: 'Saga / Seeker phones, DePIN + airdrop-driven consumer hardware',
    chain: 'Solana',
    vertical: 'tech-consumer',
    note: 'Consumer hardware bootstrapped by token incentives, a DePIN/mobile distribution precedent.',
  },
  'abstract-consumer-apps': {
    brand: 'Abstract',
    label: 'Abstract consumer apps + Global Wallet email login',
    chain: 'Abstract',
    vertical: 'gaming',
    note: 'Gamified, no-seed-phrase onboarding aimed squarely at non-crypto-native fans.',
  },
  'ordinals-cultural-drops': {
    brand: 'Various',
    label: 'Brand/art Ordinals inscriptions on Bitcoin',
    chain: 'Bitcoin',
    vertical: 'fashion-luxury',
    note: 'Permanence + maximum name recognition for a one-off cultural statement; immature for ongoing programs.',
  },

  /* ── Creator / personal-brand precedents (creator mode). Includes the wins
     AND the cautionary rugs, the honest read is the product. ── */
  'mrbeast-feastables': {
    brand: 'MrBeast',
    label: 'MrBeast → Feastables: creator owns the CPG brand + sales cycle',
    chain: 'off-chain',
    vertical: 'entertainment',
    note: 'The proof of the whole thesis (off-chain): the creator built and OWNS the product his audience buys, capturing the full margin instead of renting his reach to a sponsor. Onchain rails let a smaller creator do the same with far less capital.',
  },
  'iggy-mother': {
    brand: 'Iggy Azalea',
    label: 'Iggy Azalea launched $MOTHER (Solana creator coin)',
    chain: 'Solana',
    vertical: 'music-artist',
    note: 'One of the more sustained artist-led coins, the creator stayed active, shipped, and treated holders as a community. The counter-example to spin-up-and-abandon celebrity coins.',
  },
  'believe-launchcoin': {
    brand: 'Believe',
    label: 'Believe (launchcoin), coins tied to real products, fee-share to creators',
    chain: 'Solana',
    vertical: 'crypto-creator',
    note: 'The model for a coin as a funding + alignment layer under a real build, with trading fees routed to the creator, closest thing to "raise from your audience and stay aligned."',
  },
  'zora-content-coins': {
    brand: 'Zora / Base',
    label: 'Zora content coins, "every post is a coin" on Base',
    chain: 'Base',
    vertical: 'crypto-creator',
    note: 'Turns the content itself into the monetization: each post/track/video is a coin that rewards the creator and earliest fans. Virality becomes revenue, not just reach.',
  },
  'veefriends-garyvee': {
    brand: 'Gary Vaynerchuk',
    label: 'VeeFriends, creator NFT community → conferences, IP, brand',
    chain: 'Ethereum',
    vertical: 'education-creator',
    note: 'A durable creator-community play: the collectible was a membership into IRL events and IP, not a speculative flip. Built a business, not a moment.',
  },
  'friendtech-socialfi': {
    brand: 'friend.tech',
    label: 'friend.tech, tokenized creator "keys" ($50M+ fees, then decayed)',
    chain: 'Base',
    vertical: 'crypto-creator',
    note: 'CAUTIONARY: SocialFi keys spiked hard then bled to near-zero. Lesson, financializing access without durable utility turns fans into flippers and the graph empties. Own-audience + real product beats pure speculation on attention.',
  },
  'cryptozoo-rug': {
    brand: 'Logan Paul',
    label: 'CryptoZoo, unfinished creator game, refund settlement',
    chain: 'Ethereum',
    vertical: 'entertainment',
    note: 'CAUTIONARY: a creator cash-grab that shipped nothing, torched audience trust, and ended in a multi-hundred-K refund program + lawsuits. The single most expensive mistake a personal brand can make onchain. This is exactly what the authenticity gate exists to prevent.',
  },
  'pumpfun-creator-coins': {
    brand: 'pump.fun creators',
    label: 'pump.fun creator / livestream coins, huge volume, high churn',
    chain: 'Solana',
    vertical: 'meme-personality',
    note: 'The highest-velocity creator-coin rail on Solana, real distribution and liquidity, but extraction-heavy and mostly short-lived. Use it for reach; the ones that last pair it with actual utility and a creator who keeps showing up.',
  },
}

/* ============================================================
 * PROJECTS, partnerable crypto projects. authenticity (0-100) curated:
 * how real/durable/organic the community + influence is (the moat metric).
 * category buckets are reused by verticals + the engine.
 * ============================================================ */
export const PROJECTS = [
  {
    symbol: 'BASE',
    name: 'Base',
    category: 'chain-platform',
    ecosystems: ['base'],
    audience: 'Mainstream + crypto-curious, creators, Coinbase users',
    authenticity: 92,
    creatorFit: 90,
    note: 'Not just a chain, an active brand-partnerships + co-marketing engine (Onchain Summer). The land-and-distribute partner.',
    creatorNote: 'The creator-economy home base: Coinbase distribution + gasless Smart Wallets your fans already half-trust, and the chain where content coins, Farcaster, and creator drops actually live. Build your app / neobank / community here.',
  },
  {
    symbol: 'ZORA',
    name: 'Zora',
    category: 'creator-drops',
    ecosystems: ['base', 'ethereum'],
    audience: 'Creators, collectors, content-natives',
    authenticity: 86,
    creatorFit: 94,
    note: 'Permissionless creator mints / content coins on Base, the rail for turning posts, drops, and media into collectibles with creator rewards baked in.',
    creatorNote: 'The purest expression of "every post is a coin." Turn each video, track, or post into a tradeable content coin that pays you and your earliest fans automatically, monetize the content itself, not just the ad slot.',
  },
  {
    symbol: 'FARCASTER',
    name: 'Farcaster / Warpcast',
    category: 'social-distribution',
    ecosystems: ['base'],
    audience: 'High-signal crypto + builder community, early adopters',
    authenticity: 90,
    creatorFit: 88,
    note: 'The authentic onchain social graph. Frames = native in-feed campaigns. Small but extremely high-quality, low-bot audience, ideal for community-led launches.',
    creatorNote: 'Own the graph, not rent it. A creator who moves their community here holds the follower relationship directly, de-platform-proof distribution + Frames for in-feed drops, memberships, and token-gated access.',
  },
  {
    symbol: 'PENGU',
    name: 'Pudgy Penguins',
    category: 'ip-community',
    ecosystems: ['abstract', 'solana', 'ethereum'],
    audience: 'Mainstream IP fans, families, kids → crypto-curious',
    authenticity: 88,
    creatorFit: 72,
    note: 'The rare crypto IP with mass-retail distribution (Walmart/Target toys) and its own consumer chain (Abstract). Co-brand for warmth + mainstream reach.',
    creatorNote: 'The blueprint for a personal brand becoming a franchise: character IP → mass-retail product → owned chain. If your brand is a character/persona, this is the "IP flywheel" precedent to co-build with.',
  },
  {
    symbol: 'COURT',
    name: 'Courtyard',
    category: 'phygital-rwa',
    ecosystems: ['polygon'],
    audience: 'Collectors who want physical-backed, redeemable assets',
    authenticity: 83,
    note: 'Tokenizes real, vaulted physical collectibles (Pokémon, cards) on Polygon with redemption, the phygital bridge for a brand wanting verifiable physical-backed drops.',
  },
  {
    symbol: 'POL',
    name: 'Polygon Labs',
    category: 'chain-platform',
    ecosystems: ['polygon'],
    audience: 'Enterprise, mainstream loyalty, Fortune-500 programs',
    authenticity: 84,
    note: 'The enterprise BD partner with the deepest brand rolodex (Starbucks, Reddit, Adidas, Nike). The choice when brand-safety/legal leads the decision.',
  },
  {
    symbol: 'SOUND',
    name: 'Sound.xyz',
    category: 'music-creator',
    ecosystems: ['base', 'ethereum'],
    audience: 'Music superfans, independent artists',
    authenticity: 85,
    creatorFit: 84,
    note: 'Authentic music-collector community where superfans collect + comment on songs onchain. The partner surface for a music/media brand.',
    creatorNote: 'For a musician/artist: drop limited editions of a track where your top 1% of fans collect and comment onchain, direct superfan revenue with no label or ad network in the middle.',
  },
  {
    symbol: 'ROYAL',
    name: 'Royal',
    category: 'music-creator',
    ecosystems: ['ethereum', 'polygon'],
    audience: 'Music fans wanting ownership / royalty shares',
    authenticity: 78,
    creatorFit: 76,
    note: 'Fan-owned music royalties (Nas, The Chainsmokers). For a music brand/artist that wants fans to literally own upside.',
    creatorNote: 'Sell your fans a real slice of a song\'s royalties, fandom becomes investment and your audience becomes your marketing team, aligned to your upside.',
  },
  {
    symbol: 'IMX',
    name: 'Immutable',
    category: 'gaming',
    ecosystems: ['ethereum', 'polygon'],
    audience: 'Web3 gamers, studios',
    authenticity: 80,
    note: 'Gas-free gaming-asset L2 with a real studio pipeline, the platform partner for a brand entering games/items.',
  },
  {
    symbol: 'RONIN',
    name: 'Ronin',
    category: 'gaming',
    ecosystems: ['ethereum'],
    audience: 'Game communities (Axie, Pixels), high-DAU players',
    authenticity: 79,
    note: 'Gaming-dedicated chain with proven large active player communities, distribution into games rather than collectibles.',
  },
  {
    symbol: 'MAGICEDEN',
    name: 'Magic Eden',
    category: 'marketplace',
    ecosystems: ['solana', 'ethereum', 'bitcoin', 'base', 'polygon'],
    audience: 'Cross-chain collectors, drop hunters',
    authenticity: 81,
    creatorFit: 74,
    note: 'Multi-chain marketplace + launchpad with strong Solana culture roots, distribution + a launch venue for a brand drop, esp. on Solana/Bitcoin.',
    creatorNote: 'A launch venue + secondary market for a creator drop with real Solana culture reach, the distribution surface once your collectible or coin is live.',
  },
  {
    symbol: 'TENSOR',
    name: 'Tensor',
    category: 'marketplace',
    ecosystems: ['solana'],
    audience: 'Solana power-collectors, traders',
    authenticity: 77,
    note: 'Pro Solana NFT marketplace, secondary-market depth for a Solana-native drop.',
  },
  {
    symbol: 'STORY',
    name: 'Story Protocol',
    category: 'ip-rights',
    ecosystems: ['ethereum'],
    audience: 'IP owners, creators, brands licensing characters',
    authenticity: 75,
    creatorFit: 78,
    note: 'Programmable IP / licensing layer, for a brand that wants to license its characters onchain with automated royalties and remix rights.',
    creatorNote: 'License your likeness, characters, or format onchain so fans can remix and build on your IP while royalties flow back automatically, turn your brand into a platform other people grow for you.',
  },
  {
    symbol: 'OS',
    name: 'OpenSea',
    category: 'marketplace',
    ecosystems: ['ethereum', 'polygon', 'base', 'solana'],
    audience: 'Broad collector base across chains',
    authenticity: 72,
    note: 'The widest-reach marketplace; useful as a distribution + discoverability surface rather than a culture partner.',
  },
  {
    symbol: 'RARI',
    name: 'Rarible',
    category: 'creator-drops',
    ecosystems: ['ethereum', 'polygon', 'base'],
    audience: 'Creators, white-label storefront brands',
    authenticity: 70,
    note: 'White-label drop/storefront infrastructure, for a brand that wants its own branded mint surface fast.',
  },
  {
    symbol: 'HELIUM',
    name: 'Helium / DePIN',
    category: 'depin',
    ecosystems: ['solana'],
    audience: 'Hardware + connectivity consumers, DePIN builders',
    authenticity: 76,
    note: 'The DePIN reference, for a tech/automotive/energy brand wiring physical devices + token incentives.',
  },

  /* ── Creator-economy rails (creator mode), where a personal brand launches a
     coin, monetizes content, or spins up an owned product. authenticity here
     grades whether the platform aligns to creator SUCCESS or optimizes for
     extraction (the honest read that protects the fan). ── */
  {
    symbol: 'BELIEVE',
    name: 'Believe (launchcoin)',
    category: 'creator-launchpad',
    ecosystems: ['solana'],
    audience: 'Creators + founders tokenizing a real product/brand, their fans',
    authenticity: 74,
    creatorFit: 92,
    note: 'Creator/founder coin launchpad that ties a token to a real product and shares trading fees back to the creator.',
    creatorNote: 'The most product-aligned creator-coin rail: launch a coin tied to something you actually ship, with fee revenue routed to you. Best when a coin is a funding + alignment layer for a real build, not a cash-grab.',
  },
  {
    symbol: 'PUMP',
    name: 'pump.fun',
    category: 'creator-launchpad',
    ecosystems: ['solana'],
    audience: 'Memetic, high-velocity crypto-native audience',
    authenticity: 58,
    creatorFit: 86,
    note: 'The dominant creator/livestream coin launchpad on Solana, enormous real volume, but extraction-heavy and churny.',
    creatorNote: 'Unmatched velocity and distribution for a memetic launch, but it optimizes for speculation over fan alignment. Use for reach and liquidity, pair with real utility + a scaled sell plan, and never treat your audience as exit liquidity.',
  },
  {
    symbol: 'BAGS',
    name: 'bags.fm',
    category: 'creator-launchpad',
    ecosystems: ['solana'],
    audience: 'Creators wanting durable fee-share coins, their communities',
    authenticity: 76,
    creatorFit: 84,
    note: 'Creator coins with fee-sharing wired to the creator, leans toward sustained creator revenue over pure pump mechanics.',
    creatorNote: 'A creator-coin rail built around ongoing fee revenue to you, not just a launch-day spike, the more aligned way to let your audience hold a stake in your rise.',
  },
  {
    symbol: 'MOONSHOT',
    name: 'Moonshot',
    category: 'creator-onramp',
    ecosystems: ['solana'],
    audience: 'Non-crypto-native fans buying with Apple Pay / card',
    authenticity: 78,
    creatorFit: 80,
    note: 'Consumer-grade app to buy creator/memecoins with Apple Pay and a card, the no-seed-phrase on-ramp for a mainstream fanbase.',
    creatorNote: 'The bridge to fans who have never touched crypto: they buy your coin or drop with Apple Pay, no wallet jargon. This is how a mass audience actually shows up onchain.',
  },
  {
    symbol: 'WHOP',
    name: 'Whop',
    category: 'creator-monetize',
    ecosystems: ['base'],
    audience: 'Creators selling communities, courses, tools, apps to their audience',
    authenticity: 82,
    creatorFit: 88,
    note: 'Creator monetization marketplace, paid communities, digital products, and apps, increasingly with onchain payments + wallets built in.',
    creatorNote: 'The storefront for owning your sales cycle end to end: sell memberships, tools, and products directly to your audience, keep the customer relationship, and settle onchain, a creator business in a box.',
  },
]

/* ============================================================
 * KOL_ARCHETYPES, authentic voices by niche. We list real, well-known
 * authentic builders/voices where it's clearly appropriate (e.g. jessepollak
 * for Base) and otherwise CLEARLY-LABELED archetype handles (prefixed so the
 * UI/LLM treats them as a profile-to-source-live, not a fabricated person).
 * We deliberately exclude the mercenary/shill-farm crowd, that's `avoid`.
 * tier: 'mega' (broad reach) | 'mid' (focused community) | 'native' (deep niche credibility)
 * ============================================================ */
export const KOL_ARCHETYPES = [
  {
    handle: 'jessepollak',
    niche: 'base-native',
    tier: 'mega',
    authenticity: 95,
    why: 'Creator of Base. The single most credible voice for any Base activation, an amplification from him is a real, organic distribution event, not a paid post.',
  },
  {
    handle: 'dwr.eth',
    niche: 'creator-economy',
    tier: 'mega',
    authenticity: 92,
    why: 'Dan Romero, Farcaster co-founder. Reaches the highest-signal onchain-social and builder audience; endorsement reads as substance, not hype.',
  },
  {
    handle: 'pudgypenguins',
    niche: 'consumer-crypto',
    tier: 'mega',
    authenticity: 90,
    why: 'Brand voice of the most mainstream-friendly crypto IP, the model for warm, non-degen consumer crypto culture. Ideal co-marketing megaphone.',
  },
  {
    handle: 'cdixon',
    niche: 'onchain-culture',
    tier: 'mega',
    authenticity: 88,
    why: 'Chris Dixon (a16z crypto), credibility with institutions/press; useful for the "this brand is serious about onchain" framing.',
  },
  {
    handle: 'punk6529',
    niche: 'onchain-culture',
    tier: 'mid',
    authenticity: 87,
    why: 'Deeply credible NFT/open-metaverse voice; respected by collectors as principled, not promotional, borrowed credibility for an art/culture drop.',
  },
  {
    handle: 'farokh',
    niche: 'onchain-culture',
    tier: 'mega',
    authenticity: 80,
    why: 'Broad NFT/culture reach (Rug Radio). Mega awareness; pair with a native voice so it doesn’t read as pure reach-buy.',
  },
  {
    handle: 'gmoney',
    niche: 'fashion-luxury',
    tier: 'mid',
    authenticity: 85,
    why: 'The bridge between fashion/streetwear culture and crypto (advised Adidas Into the Metaverse). The right voice for a sportswear/fashion-luxury landing.',
  },
  {
    handle: 'cooopahtroopa',
    niche: 'creator-economy',
    tier: 'mid',
    authenticity: 83,
    why: 'Music + creator-economy native (Sound, Coop Records). Genuine standing with the onchain-music community, for a media/music brand.',
  },
  {
    handle: 'redphonecrypto',
    niche: 'consumer-crypto',
    tier: 'mid',
    authenticity: 79,
    why: 'Consumer-product-minded onchain builder voice; speaks to the "crypto your mom could use" audience that mainstream brands need.',
  },
  {
    handle: 'archetype:base-builder-mid',
    niche: 'base-native',
    tier: 'native',
    authenticity: 84,
    why: 'Archetype, a mid-size Base-native builder/creator (5k-50k) with high engagement and zero bot footprint. Resolve to a live, vetted handle from the X Dash authentic-author board at activation time.',
  },
  {
    handle: 'archetype:solana-culture-native',
    niche: 'solana-native',
    tier: 'native',
    authenticity: 82,
    why: 'Archetype, a Solana culture/meme-literate creator with organic reach. The right vibe-setter for a Solana drop; vet live before booking.',
  },
  {
    handle: 'archetype:creator-economy-native',
    niche: 'creator-economy',
    tier: 'native',
    authenticity: 83,
    why: 'Archetype, a working creator (music/art/video) who actually mints, not just promotes. Source from the authentic-author board for the relevant vertical.',
  },
  {
    handle: 'archetype:consumer-crypto-explainer',
    niche: 'consumer-crypto',
    tier: 'native',
    authenticity: 81,
    why: 'Archetype, an educator who onboards normies (no-seed-phrase, "why this is cool") with durable, low-churn engagement. Pick live from the board.',
  },
  {
    handle: 'archetype:peer-creator-onchain',
    niche: 'creator-economy',
    tier: 'native',
    authenticity: 84,
    why: 'Archetype, a peer creator who already launched a coin / product / owned community and can co-sign yours as a genuine "I did this, it worked" reference, not a paid shout. The highest-trust de-risker for a creator launch. Source live from the authentic-author board.',
  },
  {
    handle: 'archetype:launchpad-champion',
    niche: 'creator-economy',
    tier: 'mid',
    authenticity: 80,
    why: 'Archetype, a credible operator/founder on your chosen creator-coin rail (Believe / bags / Base) who amplifies aligned launches. Real distribution into the creator-coin audience; vet that their prior launches served creators, not just extracted volume.',
  },
]

/* ============================================================
 * BRAND_VERTICALS, maps a vertical to its preferred ecosystems, project
 * categories that fit, KOL niches that resonate, and angle templates the
 * engine instantiates with the brand name.
 * ============================================================ */
export const BRAND_VERTICALS = {
  sportswear: {
    label: 'Sportswear / athletic',
    ecosystems: ['base', 'polygon', 'ethereum'],
    projectCategories: ['ip-community', 'creator-drops', 'phygital-rwa', 'chain-platform'],
    kolNiches: ['base-native', 'fashion-luxury', 'onchain-culture'],
    precedents: ['nike-swoosh-base', 'nike-swoosh-polygon', 'adidas-metaverse', 'nike-rtfkt'],
    angleTemplates: [
      { title: 'Phygital drop tied to a flagship product', thesis: 'Pair a hero physical product (a sneaker, a jersey) with a redeemable digital twin, the .swoosh / RTFKT playbook, but community-owned from day one so it outlives the campaign.' },
      { title: 'Onchain athlete + fan loyalty layer', thesis: 'Reward real fandom (attendance, streaks, challenges) with collectible status that unlocks access, turn the existing membership program into onchain points without saying "crypto".' },
      { title: 'Co-drop with an authentic culture community', thesis: 'Borrow credibility the way Adidas did with BAYC/gmoney, partner an organic community rather than launching cold to silence.' },
    ],
  },
  'fashion-luxury': {
    label: 'Fashion / luxury',
    ecosystems: ['ethereum', 'base', 'bitcoin'],
    projectCategories: ['creator-drops', 'ip-rights', 'phygital-rwa', 'marketplace'],
    kolNiches: ['fashion-luxury', 'onchain-culture'],
    precedents: ['gucci-vault', 'louis-vuitton-treasure-trunk', 'nike-rtfkt'],
    angleTemplates: [
      { title: 'Scarce phygital membership keyed to product', thesis: 'Soulbound, invite-only access (the LV Treasure Trunk model), luxury as proof-of-membership and product authentication, not mass collectible.' },
      { title: 'Prestige collectible on a credibility chain', thesis: 'Anchor a flagship art/collectible on Ethereum (or a Bitcoin Ordinal for a one-off statement) where the wealthiest, stickiest collectors live.' },
      { title: 'Onchain authentication + resale royalties', thesis: 'Tokenize provenance so every resale pays the house a royalty and proves authenticity, turn the gray market into an asset.' },
    ],
  },
  'food-beverage': {
    label: 'Food & beverage',
    ecosystems: ['polygon', 'base', 'solana'],
    projectCategories: ['chain-platform', 'creator-drops', 'ip-community'],
    kolNiches: ['consumer-crypto', 'onchain-culture'],
    precedents: ['starbucks-odyssey', 'coca-cola-nft'],
    angleTemplates: [
      { title: 'Invisible-crypto loyalty journeys', thesis: 'The Starbucks Odyssey model done right: collectible "journeys" inside the EXISTING rewards app, fiat checkout, zero wallet jargon, points your customers already understand, now ownable.' },
      { title: 'Limited collectible drops as marketing surface', thesis: 'Treat drops like Coca-Cola did, charity-tied, seasonal collectibles that earn social reach, low commitment, high optionality.' },
      { title: 'On-pack QR → claim → status', thesis: 'Every product becomes an onchain claim; repeat purchases compound into status tiers and unlocks.' },
    ],
  },
  'media-music': {
    label: 'Media / music',
    ecosystems: ['base', 'ethereum', 'polygon'],
    projectCategories: ['music-creator', 'creator-drops', 'ip-rights'],
    kolNiches: ['creator-economy', 'onchain-culture'],
    precedents: ['sound-music-drops', 'nas-music-royalties', 'time-tokenproof', 'zora-creator-drops'],
    angleTemplates: [
      { title: 'Superfan collectibles for releases', thesis: 'Drop limited editions of songs/episodes on Sound/Zora where superfans collect and comment onchain, monetize the top 1% of fandom without ads.' },
      { title: 'Fan-owned upside', thesis: 'Let fans own a slice of a song/show’s royalties (the Nas/Royal model), fandom becomes investment, fans become marketers.' },
      { title: 'Token-gated content + IRL', thesis: 'A membership NFT that unlocks early releases, backstage, and events (the TIMEPieces model).' },
    ],
  },
  gaming: {
    label: 'Gaming',
    ecosystems: ['solana', 'ethereum', 'abstract'],
    projectCategories: ['gaming', 'ip-community', 'marketplace'],
    kolNiches: ['solana-native', 'consumer-crypto', 'onchain-culture'],
    precedents: ['pudgy-walmart-target', 'abstract-consumer-apps', 'pudgy-cross-chain'],
    angleTemplates: [
      { title: 'Player-owned items + cross-game IP', thesis: 'Issue items players truly own and can carry/trade; license the IP via Story so the community can build on it.' },
      { title: 'IP → retail → onchain flywheel', thesis: 'The Pudgy model: character IP earns mainstream love (toys/retail), then onchain rewards deepen the most engaged fans.' },
      { title: 'Gamified, no-seed-phrase onboarding', thesis: 'Use Abstract Global Wallet / smart wallets so players never see crypto friction, XP, streaks, drops feel like a game, not a wallet.' },
    ],
  },
  automotive: {
    label: 'Automotive / mobility',
    ecosystems: ['polygon', 'base', 'solana'],
    projectCategories: ['phygital-rwa', 'depin', 'ip-community'],
    kolNiches: ['consumer-crypto', 'onchain-culture'],
    precedents: ['nike-swoosh-polygon', 'solana-mobile-drops'],
    angleTemplates: [
      { title: 'Onchain ownership + service history', thesis: 'Tokenize the vehicle’s identity, service records, and warranty, provenance that follows the car and powers resale value.' },
      { title: 'Connected-car DePIN rewards', thesis: 'Reward data/usage (mileage, charging) with onchain points, a loyalty + DePIN hybrid for owners.' },
      { title: 'Collectible drops for superfans + motorsport', thesis: 'Limited digital + phygital collectibles around launches and racing, the Red Bull Racing fan-engagement model.' },
    ],
  },
  'tech-consumer': {
    label: 'Tech / consumer electronics',
    ecosystems: ['base', 'solana', 'polygon'],
    projectCategories: ['chain-platform', 'depin', 'creator-drops'],
    kolNiches: ['consumer-crypto', 'base-native', 'onchain-culture'],
    precedents: ['reddit-avatars', 'solana-mobile-drops', 'coinbase-onchain-summer'],
    angleTemplates: [
      { title: 'Invisible-crypto mass onboarding', thesis: 'The Reddit Collectible Avatars model: millions of users get ownable digital goods with fiat checkout and zero jargon, crypto as a feature, never the headline.' },
      { title: 'Device + token incentive (DePIN)', thesis: 'Bootstrap a hardware/network with token rewards (the Solana Mobile / Helium pattern) to seed adoption.' },
      { title: 'Creator + community drops', thesis: 'Turn your power-users and creators into co-owners via onchain drops tied to product milestones.' },
    ],
  },
  'sports-league': {
    label: 'Sports league / team',
    ecosystems: ['polygon', 'base', 'ethereum'],
    projectCategories: ['ip-community', 'phygital-rwa', 'marketplace'],
    kolNiches: ['onchain-culture', 'consumer-crypto'],
    precedents: ['redbull-racing-web3', 'reddit-avatars'],
    angleTemplates: [
      { title: 'Fan-token loyalty + voting', thesis: 'Membership that rewards real fandom (attendance, predictions) and grants light governance/perks, fan tokens done as access, not speculation.' },
      { title: 'Moment / memorabilia collectibles', thesis: 'Officially licensed digital moments and phygital memorabilia tied to live events, the modern trading-card.' },
      { title: 'Season-long onchain rewards journey', thesis: 'A season pass that compounds status across games and unlocks experiences.' },
    ],
  },
  'energy-drink': {
    label: 'Energy drink / lifestyle',
    ecosystems: ['solana', 'base', 'polygon'],
    projectCategories: ['ip-community', 'creator-drops', 'phygital-rwa'],
    kolNiches: ['solana-native', 'consumer-crypto', 'onchain-culture'],
    precedents: ['redbull-racing-web3', 'starbucks-odyssey'],
    angleTemplates: [
      { title: 'Memetic culture drop (high velocity)', thesis: 'Lean into Solana’s meme velocity, fast, cheap, shareable drops tied to sponsorships, athletes, and events where the lifestyle audience already is.' },
      { title: 'On-pack claim → rewards streak', thesis: 'Every can is an onchain claim; streaks and challenges turn consumption into a status game (Starbucks Odyssey energy for energy drinks).' },
      { title: 'Sponsorship + athlete co-drops', thesis: 'Convert existing motorsport/esports/athlete sponsorships into collectible fan-engagement, the Red Bull Racing model.' },
    ],
  },
  'consumer-brand': {
    label: 'Consumer brand (general)',
    ecosystems: ['base', 'polygon', 'solana'],
    projectCategories: ['chain-platform', 'creator-drops', 'ip-community', 'phygital-rwa'],
    kolNiches: ['consumer-crypto', 'base-native', 'onchain-culture'],
    precedents: ['reddit-avatars', 'starbucks-odyssey', 'coinbase-onchain-summer'],
    angleTemplates: [
      { title: 'Invisible-crypto loyalty / collectibles', thesis: 'Add ownable digital goods or loyalty inside your existing app with fiat checkout and no wallet jargon, the Reddit/Starbucks model that scaled to millions without scaring anyone.' },
      { title: 'Community-led drop on consumer rails', thesis: 'Launch on Base (Coinbase distribution, gasless smart wallets) with a co-marketed Onchain Summer moment rather than going cold.' },
      { title: 'Phygital tie to a hero product', thesis: 'Connect your best-known physical product to a redeemable, ownable digital counterpart that compounds fandom.' },
    ],
  },
  'crypto-native': {
    label: 'Crypto-native company',
    ecosystems: ['base', 'ethereum', 'solana'],
    projectCategories: ['chain-platform', 'social-distribution', 'creator-drops'],
    kolNiches: ['base-native', 'onchain-culture', 'creator-economy'],
    precedents: ['coinbase-onchain-summer', 'zora-creator-drops'],
    angleTemplates: [
      { title: 'Own-ecosystem activation', thesis: 'You already speak the language, focus spend on deepening authentic mindshare (Farcaster, native builders) rather than buying reach.' },
      { title: 'Creator + dev distribution', thesis: 'Turn builders and creators into the distribution layer via grants, drops, and Frames-native campaigns.' },
      { title: 'Cross-ecosystem culture bridge', thesis: 'Bridge your community to where culture moves (Solana memetics, Base social) without diluting credibility.' },
    ],
  },
}

/* ============================================================
 * KNOWN_BRANDS, well-known brand → vertical map (resolveBrandVertical checks
 * this first). Keys are lowercased; matching is substring-aware in the resolver.
 * ============================================================ */
export const KNOWN_BRANDS = {
  nike: 'sportswear',
  adidas: 'sportswear',
  puma: 'sportswear',
  'under armour': 'sportswear',
  'new balance': 'sportswear',
  lululemon: 'sportswear',
  reebok: 'sportswear',
  gucci: 'fashion-luxury',
  'louis vuitton': 'fashion-luxury',
  prada: 'fashion-luxury',
  burberry: 'fashion-luxury',
  dolce: 'fashion-luxury',
  versace: 'fashion-luxury',
  dior: 'fashion-luxury',
  tiffany: 'fashion-luxury',
  'coca-cola': 'food-beverage',
  'coca cola': 'food-beverage',
  coke: 'food-beverage',
  pepsi: 'food-beverage',
  starbucks: 'food-beverage',
  mcdonald: 'food-beverage',
  budweiser: 'food-beverage',
  heineken: 'food-beverage',
  nestle: 'food-beverage',
  spotify: 'media-music',
  netflix: 'media-music',
  disney: 'media-music',
  'universal music': 'media-music',
  warner: 'media-music',
  sony: 'media-music',
  time: 'media-music',
  'rolling stone': 'media-music',
  nas: 'media-music',
  'red bull': 'energy-drink',
  redbull: 'energy-drink',
  monster: 'energy-drink',
  celsius: 'energy-drink',
  prime: 'energy-drink',
  rockstar: 'energy-drink',
  ubisoft: 'gaming',
  'epic games': 'gaming',
  ea: 'gaming',
  'electronic arts': 'gaming',
  nintendo: 'gaming',
  riot: 'gaming',
  roblox: 'gaming',
  'pudgy penguins': 'gaming',
  toyota: 'automotive',
  bmw: 'automotive',
  mercedes: 'automotive',
  porsche: 'automotive',
  ford: 'automotive',
  tesla: 'automotive',
  ferrari: 'automotive',
  lamborghini: 'automotive',
  apple: 'tech-consumer',
  samsung: 'tech-consumer',
  google: 'tech-consumer',
  microsoft: 'tech-consumer',
  reddit: 'tech-consumer',
  meta: 'tech-consumer',
  sonos: 'tech-consumer',
  gopro: 'tech-consumer',
  nba: 'sports-league',
  nfl: 'sports-league',
  fifa: 'sports-league',
  'formula 1': 'sports-league',
  formula1: 'sports-league',
  f1: 'sports-league',
  premier: 'sports-league',
  uefa: 'sports-league',
  coinbase: 'crypto-native',
  binance: 'crypto-native',
  kraken: 'crypto-native',
  metamask: 'crypto-native',
  opensea: 'crypto-native',
  uniswap: 'crypto-native',
  ledger: 'crypto-native',
  phantom: 'crypto-native',
}

/* keyword → vertical inference for unknown brands (checked after KNOWN_BRANDS) */
const VERTICAL_KEYWORDS = [
  ['sportswear', ['sport', 'athletic', 'sneaker', 'shoe', 'footwear', 'apparel', 'jersey', 'fitness', 'gym', 'running', 'soccer', 'basketball']],
  ['fashion-luxury', ['luxury', 'fashion', 'couture', 'jewel', 'jewelry', 'watch', 'leather', 'boutique', 'atelier', 'designer', 'haute']],
  ['food-beverage', ['food', 'beverage', 'drink', 'coffee', 'tea', 'soda', 'cola', 'snack', 'candy', 'chocolate', 'restaurant', 'cafe', 'brew', 'kitchen', 'foods', 'eats', 'grocery', 'beer', 'wine', 'spirits']],
  ['energy-drink', ['energy drink', 'energy-drink', 'energydrink']],
  ['media-music', ['music', 'records', 'media', 'studio', 'film', 'movie', 'streaming', 'podcast', 'label', 'entertainment', 'news', 'magazine', 'tv', 'radio', 'audio', 'sound']],
  ['gaming', ['game', 'gaming', 'gamer', 'esports', 'studio games', 'play', 'arcade', 'console']],
  ['automotive', ['auto', 'motor', 'car', 'vehicle', 'mobility', 'ev', 'electric vehicle', 'racing', 'motorsport', 'drive', 'tire']],
  ['tech-consumer', ['tech', 'electronics', 'device', 'gadget', 'app', 'software', 'hardware', 'smart', 'phone', 'computer', 'ai ', 'cloud', 'digital']],
  ['sports-league', ['league', 'club fc', ' fc', 'team', 'stadium', 'tournament', 'championship', 'athletics club']],
  ['crypto-native', ['crypto', 'web3', 'blockchain', 'defi', 'nft', 'token', 'onchain', 'wallet', 'exchange', 'dao']],
]

/**
 * Resolve a brand name to a vertical.
 *   1. KNOWN_BRANDS exact/substring match
 *   2. keyword inference from the name
 *   3. sane default 'consumer-brand'
 * Always returns a key that exists in BRAND_VERTICALS.
 */
export function resolveBrandVertical(brand) {
  const raw = String(brand || '').trim().toLowerCase()
  if (!raw) return 'consumer-brand'

  // 1. Known brands, try exact, then substring either direction.
  if (KNOWN_BRANDS[raw]) return KNOWN_BRANDS[raw]
  for (const [name, vertical] of Object.entries(KNOWN_BRANDS)) {
    if (raw === name) return vertical
  }
  for (const [name, vertical] of Object.entries(KNOWN_BRANDS)) {
    // word-boundary-ish containment so "nikes" or "nike inc" still hits "nike"
    if (raw.includes(name) || name.includes(raw)) {
      // guard against trivially short cross-matches (e.g. raw "ea")
      if (name.length >= 3 || raw === name) return vertical
    }
  }

  // 2. Keyword inference.
  for (const [vertical, keywords] of VERTICAL_KEYWORDS) {
    for (const kw of keywords) {
      if (raw.includes(kw)) return vertical
    }
  }

  // 3. Default.
  return 'consumer-brand'
}

/** Lookup helpers (pure). */
export function getVertical(verticalId) {
  return BRAND_VERTICALS[verticalId] || BRAND_VERTICALS['consumer-brand']
}
export function getEcosystem(id) {
  return ECOSYSTEMS.find((e) => e.id === id) || null
}
export function getPrecedent(id) {
  return PRECEDENTS[id] || null
}

/* ── Brand search (autocomplete for "any company") ──────────────────────────
   A flat, de-duped directory derived from KNOWN_BRANDS. Display names are
   title-cased; the vertical label comes along for the suggestion subtitle.
   Free-text that isn't here still works, the engine infers a vertical. */
const _VERTICAL_LABEL = Object.fromEntries(
  Object.entries(BRAND_VERTICALS).map(([id, v]) => [id, v.label || id]),
)
const _titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase())
export const BRAND_DIRECTORY = (() => {
  const seen = new Set()
  const out = []
  for (const [name, verticalId] of Object.entries(KNOWN_BRANDS)) {
    const display = _titleCase(name)
    const key = display.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: display, verticalId, verticalLabel: _VERTICAL_LABEL[verticalId] || verticalId })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
})()

export function searchBrands(query, limit = 7) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const starts = []
  const includes = []
  for (const b of BRAND_DIRECTORY) {
    const n = b.name.toLowerCase()
    if (n.startsWith(q)) starts.push(b)
    else if (n.includes(q)) includes.push(b)
  }
  return [...starts, ...includes].slice(0, limit)
}

/* ============================================================
 * CREATOR_ARCHETYPES, the creator-mode counterpart of BRAND_VERTICALS.
 *
 * A personal brand / IRL creator is a company: the audience is the market and
 * the creator owns the sales cycle. Each archetype maps a creator's niche to
 * the ecosystems, creator-economy rails, and voices that fit, plus a SIGNATURE
 * product play, the flagship "build a business on your audience" move for that
 * kind of creator. `{name}` in a thesis is replaced with the creator's name by
 * the engine.
 *
 * Same shape keys as BRAND_VERTICALS (ecosystems / projectCategories /
 * kolNiches / precedents) so the ranking functions are reused; `signature` and
 * `audienceNote` are creator-only.
 * ============================================================ */
export const CREATOR_ARCHETYPES = {
  entertainment: {
    label: 'Entertainment / mass creator',
    audienceNote: 'Huge, broad, mainstream audience, most of it non-crypto. The prize is owning a product they already want to buy from you.',
    ecosystems: ['base', 'solana', 'polygon'],
    projectCategories: ['creator-monetize', 'creator-onramp', 'content-coin', 'ip-community', 'creator-drops'],
    kolNiches: ['creator-economy', 'consumer-crypto', 'base-native'],
    precedents: ['mrbeast-feastables', 'zora-content-coins', 'cryptozoo-rug'],
    signature: {
      title: 'Mainstream-scale drop your fans can actually join',
      thesis: '{name}\'s edge is raw audience size, most of it non-crypto, so lead with a compressed, near-free drop bought with Apple Pay / a card, no seed phrases. Turn a fraction of a mass audience into onchain fans in one moment, then keep them with an owned membership.',
    },
  },
  'gaming-creator': {
    label: 'Gaming / streamer',
    audienceNote: 'Deeply engaged, high-session-time community that already lives in digital economies and understands owning items.',
    ecosystems: ['solana', 'abstract', 'base'],
    projectCategories: ['gaming', 'content-coin', 'creator-launchpad', 'ip-community', 'creator-monetize'],
    kolNiches: ['solana-native', 'creator-economy', 'consumer-crypto'],
    precedents: ['pumpfun-creator-coins', 'zora-content-coins', 'friendtech-socialfi'],
    signature: {
      title: 'Player-owned community + a game/economy around your channel',
      thesis: 'Give {name}\'s community items and status they truly own, then build a game or in-stream economy on top, the audience already grinds for cosmetics; onchain just lets them keep and trade what they earn.',
    },
  },
  'crypto-creator': {
    label: 'Crypto / finance creator',
    audienceNote: 'Already onchain, already has wallets, the lowest-friction audience to activate and the most product-literate.',
    ecosystems: ['solana', 'base', 'ethereum'],
    projectCategories: ['creator-launchpad', 'content-coin', 'creator-monetize', 'social-distribution', 'chain-platform'],
    kolNiches: ['creator-economy', 'onchain-culture', 'base-native', 'solana-native'],
    precedents: ['believe-launchcoin', 'zora-content-coins', 'friendtech-socialfi'],
    signature: {
      title: 'Tokenize a real build your audience funds and holds',
      thesis: 'Your audience needs no onboarding. {name} launches a coin as the funding + alignment layer under a real product (Believe-style, fees routed back), so the community owns a stake in something that actually ships, not a spin-up-and-abandon celebrity coin.',
    },
  },
  'music-artist': {
    label: 'Musician / artist',
    audienceNote: 'A fanbase with real emotional equity, the top 1% of superfans will pay for ownership, access, and a slice of the upside.',
    ecosystems: ['base', 'ethereum', 'solana'],
    projectCategories: ['music-creator', 'content-coin', 'creator-drops', 'ip-rights', 'creator-launchpad'],
    kolNiches: ['creator-economy', 'onchain-culture', 'fashion-luxury'],
    precedents: ['iggy-mother', 'zora-content-coins', 'friendtech-socialfi'],
    signature: {
      title: 'Superfan ownership: songs, royalties, and access',
      thesis: 'Turn {name}\'s top fans into co-owners, limited song editions they collect, a real slice of royalties, and token-gated access to drops and IRL. Monetize the 1% who love you most without a label or ad network in the middle.',
    },
  },
  'lifestyle-creator': {
    label: 'Lifestyle / fashion / vlog',
    audienceNote: 'Aspirational, high-trust audience that buys what you wear and use, ideal for an owned product line and a membership.',
    ecosystems: ['base', 'polygon', 'solana'],
    projectCategories: ['creator-monetize', 'creator-drops', 'phygital-rwa', 'content-coin', 'ip-community'],
    kolNiches: ['creator-economy', 'consumer-crypto', 'fashion-luxury'],
    precedents: ['mrbeast-feastables', 'veefriends-garyvee', 'zora-content-coins'],
    signature: {
      title: 'Owned product line + a members-only inner circle',
      thesis: 'Launch {name}\'s product line and pair it with a token-gated inner circle, early drops, phygital pieces tied to real product, and access that compounds loyalty. Your taste becomes a brand your audience owns a place in.',
    },
  },
  'education-creator': {
    label: 'Education / business creator',
    audienceNote: 'The highest-trust, highest-intent audience, they came to learn and act, which is exactly who buys tools, courses, and financial products.',
    ecosystems: ['base', 'ethereum', 'polygon'],
    projectCategories: ['creator-monetize', 'content-coin', 'chain-platform', 'ip-community', 'ip-rights'],
    kolNiches: ['creator-economy', 'base-native', 'onchain-culture'],
    precedents: ['veefriends-garyvee', 'zora-content-coins', 'mrbeast-feastables'],
    signature: {
      title: 'Own the whole funnel: community → tools → financial product',
      thesis: 'Your audience already trusts {name} for guidance. Build the owned stack, a paid community, then software/AI tools, then (with the right partner + compliance) a branded fintech product like a card or account. The audience becomes recurring customers you never rent from a platform.',
    },
  },
  'meme-personality': {
    label: 'Meme / personality',
    audienceNote: 'Memetic, fast-moving, crypto-adjacent audience, highest velocity, but the shortest trust half-life, so alignment matters most.',
    ecosystems: ['solana', 'base', 'ethereum'],
    projectCategories: ['creator-launchpad', 'content-coin', 'creator-onramp', 'ip-community'],
    kolNiches: ['solana-native', 'creator-economy', 'onchain-culture'],
    precedents: ['pumpfun-creator-coins', 'iggy-mother', 'friendtech-socialfi'],
    signature: {
      title: 'A coin with a reason to exist, and a plan to not rug',
      thesis: 'Velocity is your edge, so a coin is natural for {name}, but pair it with real utility (access, IP, a product), a public treasury, and a scaled sell plan so you never treat your own audience as exit liquidity. The difference between a durable brand and a one-week cash-grab is exactly this.',
    },
  },
}

/* ============================================================
 * KNOWN_CREATORS, well-known creator → archetype (resolveCreatorArchetype
 * checks this first). Includes the thesis's own top-earning creators so they
 * resolve out of the box. Keys lowercased; matching is substring-aware.
 * ============================================================ */
export const KNOWN_CREATORS = {
  mrbeast: 'entertainment',
  'mr beast': 'entertainment',
  'dhar mann': 'entertainment',
  'rhett & link': 'entertainment',
  'rhett and link': 'entertainment',
  'good mythical morning': 'entertainment',
  'logan paul': 'entertainment',
  'jake paul': 'entertainment',
  ksi: 'entertainment',
  'kai cenat': 'entertainment',
  ishowspeed: 'entertainment',
  sidemen: 'entertainment',
  markiplier: 'gaming-creator',
  pewdiepie: 'gaming-creator',
  ninja: 'gaming-creator',
  pokimane: 'gaming-creator',
  jacksepticeye: 'gaming-creator',
  dream: 'gaming-creator',
  valkyrae: 'gaming-creator',
  'steven bartlett': 'education-creator',
  'diary of a ceo': 'education-creator',
  garyvee: 'education-creator',
  'gary vaynerchuk': 'education-creator',
  'gary vee': 'education-creator',
  'alex hormozi': 'education-creator',
  hormozi: 'education-creator',
  mkbhd: 'education-creator',
  'marques brownlee': 'education-creator',
  'ali abdaal': 'education-creator',
  mrwhosetheboss: 'education-creator',
  'iggy azalea': 'music-artist',
  'snoop dogg': 'music-artist',
  snoop: 'music-artist',
  'steve aoki': 'music-artist',
  drake: 'music-artist',
  'jason derulo': 'music-artist',
  grimes: 'music-artist',
  'emma chamberlain': 'lifestyle-creator',
  'james charles': 'lifestyle-creator',
  'huda beauty': 'lifestyle-creator',
  'chiara ferragni': 'lifestyle-creator',
  'kylie jenner': 'lifestyle-creator',
  cobie: 'crypto-creator',
  ansem: 'crypto-creator',
  'altcoin daily': 'crypto-creator',
  mmcrypto: 'crypto-creator',
  gainzy: 'crypto-creator',
  murad: 'crypto-creator',
  'coin bureau': 'crypto-creator',
  'andrew tate': 'meme-personality',
}

/* keyword → creator-archetype inference for unknown creators (checked after
   KNOWN_CREATORS). Handles / bios often carry the niche. */
const CREATOR_KEYWORDS = [
  ['crypto-creator', ['crypto', 'defi', 'trader', 'trading', 'onchain', 'web3', 'altcoin', 'degen', 'memecoin', 'nft', 'token']],
  ['music-artist', ['music', 'artist', 'rapper', 'singer', 'dj', 'producer', 'band', 'musician', 'song', 'records']],
  ['gaming-creator', ['gaming', 'gamer', 'streamer', 'twitch', 'speedrun', 'esports', 'lets play', 'gameplay', 'fortnite', 'minecraft']],
  ['education-creator', ['podcast', 'education', 'educator', 'business', 'entrepreneur', 'finance', 'coach', 'tech review', 'reviewer', 'explainer', 'ceo', 'founder']],
  ['lifestyle-creator', ['beauty', 'makeup', 'fashion', 'style', 'vlog', 'lifestyle', 'fitness', 'wellness', 'travel', 'model', 'influencer']],
  ['meme-personality', ['meme', 'comedy', 'comedian', 'personality', 'shitpost', 'reaction']],
]

/**
 * Resolve a creator name/handle to a creator archetype.
 *   1. KNOWN_CREATORS exact/substring match
 *   2. keyword inference from the name/bio
 *   3. sane default 'entertainment' (broad mass-audience creator)
 * Always returns a key that exists in CREATOR_ARCHETYPES.
 */
export function resolveCreatorArchetype(creator) {
  const raw = String(creator || '').trim().toLowerCase().replace(/^@/, '')
  if (!raw) return 'entertainment'

  if (KNOWN_CREATORS[raw]) return KNOWN_CREATORS[raw]
  for (const [name, archetype] of Object.entries(KNOWN_CREATORS)) {
    if (raw === name) return archetype
  }
  for (const [name, archetype] of Object.entries(KNOWN_CREATORS)) {
    if (raw.includes(name) || name.includes(raw)) {
      if (name.length >= 4 || raw === name) return archetype
    }
  }

  for (const [archetype, keywords] of CREATOR_KEYWORDS) {
    for (const kw of keywords) {
      if (raw.includes(kw)) return archetype
    }
  }

  return 'entertainment'
}

export function getCreatorArchetype(archetypeId) {
  return CREATOR_ARCHETYPES[archetypeId] || CREATOR_ARCHETYPES.entertainment
}

/* ── Creator search (autocomplete for creator mode) ── */
const _CREATOR_ARCH_LABEL = Object.fromEntries(
  Object.entries(CREATOR_ARCHETYPES).map(([id, a]) => [id, a.label || id]),
)
export const CREATOR_DIRECTORY = (() => {
  const seen = new Set()
  const out = []
  for (const [name, archetypeId] of Object.entries(KNOWN_CREATORS)) {
    const display = _titleCase(name)
    const key = display.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: display, archetypeId, archetypeLabel: _CREATOR_ARCH_LABEL[archetypeId] || archetypeId })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
})()

export function searchCreators(query, limit = 7) {
  const q = String(query || '').trim().toLowerCase().replace(/^@/, '')
  if (!q) return []
  const starts = []
  const includes = []
  for (const c of CREATOR_DIRECTORY) {
    const n = c.name.toLowerCase()
    if (n.startsWith(q)) starts.push(c)
    else if (n.includes(q)) includes.push(c)
  }
  return [...starts, ...includes].slice(0, limit)
}
