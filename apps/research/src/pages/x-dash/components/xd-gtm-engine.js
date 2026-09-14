/**
 * Crypto GTM Proposal Engine, turns a brand + goal into a ranked, justified
 * go-to-market proposal for the X Dash "Institutions" tab.
 *
 * Mirrors the xd-hype-forensics.js style: PURE functions (no fetch, no side
 * effects), a buildGtmContext() LLM-context builder, and a GTM_DIRECTIVE
 * export that tells the LLM how to write the final board-ready proposal.
 *
 * The moat: every project + KOL we recommend carries an `authenticity` score,
 * and goal-weighted ranking deliberately favors REAL, durable mindshare over
 * bought reach. The `avoid` list names the mercenary anti-patterns.
 *
 * computeGtmProposal({ brand, goal }) -> a fixed-shape Proposal (contract below).
 */

import {
  ECOSYSTEMS,
  PROJECTS,
  KOL_ARCHETYPES,
  PRECEDENTS,
  resolveBrandVertical,
  getVertical,
  getEcosystem,
  resolveCreatorArchetype,
  getCreatorArchetype,
} from './xd-gtm-data'

/* ---------- helpers ---------- */
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x))
const round = (x) => Math.round(x)

const GOALS = ['awareness', 'community', 'product', 'loyalty']
function normGoal(goal) {
  const g = String(goal || '').trim().toLowerCase()
  return GOALS.includes(g) ? g : 'awareness'
}

/* Goal → which ecosystem/project/KOL traits get weighted up. Each goal tunes:
   - ecoBias: per-ecosystem-id bonus (memetic reach for awareness, social/native
     for community, enterprise rails for product/loyalty)
   - categoryBias: per-project-category bonus
   - kolTierBias: per-tier bonus ('mega' reach for awareness, 'native' for community)
   - authWeight: how hard authenticity is weighted in project/KOL ranking */
const GOAL_PROFILE = {
  awareness: {
    label: 'Awareness, maximize reach + cultural relevance',
    ecoBias: { solana: 14, base: 8, ethereum: 6, bitcoin: 6, polygon: 0, abstract: 2 },
    categoryBias: { 'creator-drops': 8, 'ip-community': 8, marketplace: 6, 'social-distribution': 4 },
    kolTierBias: { mega: 16, mid: 6, native: 2 },
    authWeight: 0.55,
  },
  community: {
    label: 'Community, build durable, owned, high-signal fans',
    ecoBias: { base: 16, abstract: 8, ethereum: 4, solana: 4, polygon: 2, bitcoin: 0 },
    categoryBias: { 'social-distribution': 14, 'creator-drops': 10, 'ip-community': 10, 'music-creator': 8 },
    kolTierBias: { native: 16, mid: 10, mega: 4 },
    authWeight: 0.85,
  },
  product: {
    label: 'Product, ship real onchain utility / a working integration',
    ecoBias: { base: 14, polygon: 12, abstract: 8, solana: 6, ethereum: 4, bitcoin: 0 },
    categoryBias: { 'chain-platform': 14, gaming: 10, depin: 10, 'phygital-rwa': 10, 'ip-rights': 8 },
    kolTierBias: { native: 12, mid: 8, mega: 4 },
    authWeight: 0.7,
  },
  loyalty: {
    label: 'Loyalty, points / onchain rewards on existing customers',
    ecoBias: { polygon: 16, base: 12, abstract: 6, solana: 2, ethereum: 2, bitcoin: 0 },
    categoryBias: { 'chain-platform': 12, 'phygital-rwa': 12, 'ip-community': 8, 'creator-drops': 4 },
    kolTierBias: { native: 10, mid: 8, mega: 6 },
    authWeight: 0.7,
  },
}

/* ---------- creator mode ---------- */

/* Creator goals differ from brand goals: a personal brand isn't running a
   campaign, it's building a company on its audience. Each goal tunes the same
   ranking dials AND supplies `plays`, the concrete "build a business" moves,
   named after the creator. authWeight is high across the board: a creator's
   own-audience trust is the entire asset, so aligned partners matter more than
   for a brand renting reach. */
const CREATOR_GOALS = ['own-audience', 'monetize', 'product', 'tokenize']
function normCreatorGoal(goal) {
  const g = String(goal || '').trim().toLowerCase()
  return CREATOR_GOALS.includes(g) ? g : 'own-audience'
}

const CREATOR_GOAL_PROFILE = {
  'own-audience': {
    label: 'Own audience, a de-platform-proof, owned community',
    ecoBias: { base: 16, solana: 6, abstract: 8, ethereum: 4, polygon: 2, bitcoin: 0 },
    categoryBias: { 'social-distribution': 14, 'creator-monetize': 12, 'content-coin': 8, 'ip-community': 8, 'creator-drops': 6 },
    kolTierBias: { native: 14, mid: 10, mega: 4 },
    authWeight: 0.9,
    plays: [
      { title: 'Move the follower relationship onchain', thesis: (n) => `${n} owns the graph instead of renting it: bring the community onto an owned social layer (Farcaster/Base) and a token-gated home, so an algorithm change or a ban can never sever the audience relationship again.` },
      { title: 'Membership that compounds, not resets', thesis: (n) => `A members-only inner circle for ${n}'s true fans (token-gated drops, early access, and IRL) where status accrues over time instead of evaporating with each platform's feed.` },
    ],
  },
  monetize: {
    label: 'Monetize, turn attention into direct revenue',
    ecoBias: { base: 14, solana: 12, abstract: 6, ethereum: 4, polygon: 2, bitcoin: 0 },
    categoryBias: { 'content-coin': 14, 'creator-monetize': 14, 'creator-drops': 8, 'music-creator': 6, 'creator-onramp': 6 },
    kolTierBias: { native: 12, mid: 10, mega: 6 },
    authWeight: 0.82,
    plays: [
      { title: 'Monetize the content itself', thesis: (n) => `Turn ${n}'s posts, tracks, or videos into content coins (Zora): each drop rewards ${n} and the earliest fans directly, so virality becomes revenue instead of an ad impression someone else sells.` },
      { title: 'Sell direct, own the customer', thesis: (n) => `Route ${n}'s audience to an owned storefront (Whop-style): memberships, tools, and products sold directly and settled onchain, with the customer relationship kept by ${n} rather than a platform.` },
    ],
  },
  product: {
    label: 'Product, launch an owned product (app, game, card, brand)',
    ecoBias: { base: 16, solana: 8, abstract: 10, ethereum: 4, polygon: 6, bitcoin: 0 },
    categoryBias: { 'creator-monetize': 12, gaming: 10, 'chain-platform': 10, 'ip-community': 8, 'phygital-rwa': 8, 'creator-onramp': 6 },
    kolTierBias: { native: 12, mid: 8, mega: 4 },
    authWeight: 0.8,
    plays: [
      { title: 'Own the product your audience already buys', thesis: (n) => `The Feastables move, capital-light: ${n} ships an owned product (a consumer brand, an app, or an AI product) and sells it to the audience directly. Onchain rails handle payments, accounts, and a no-seed-phrase on-ramp so mainstream fans convert without friction.` },
      { title: 'A branded fintech layer (neobank / card)', thesis: (n) => `With the right banking partner + compliance, ${n} launches a branded card or account: the audience's money moves through ${n}'s brand, turning attention into a durable financial relationship. Real regulation applies; this is a partnered build, not a token gimmick.` },
    ],
  },
  tokenize: {
    label: 'Tokenize, a creator coin your audience holds',
    ecoBias: { solana: 16, base: 10, ethereum: 4, abstract: 4, polygon: 0, bitcoin: 0 },
    categoryBias: { 'creator-launchpad': 16, 'content-coin': 10, 'ip-community': 6, 'creator-onramp': 6 },
    kolTierBias: { native: 12, mid: 10, mega: 6 },
    authWeight: 0.78,
    plays: [
      { title: 'A coin as a funding + alignment layer', thesis: (n) => `${n} launches a coin tied to a real build with fees routed back (Believe/bags-style): the audience owns a stake in ${n}'s rise and helps fund what ships, instead of a spin-up-and-abandon celebrity coin.` },
      { title: 'Launch with a reason to exist, and a no-rug plan', thesis: (n) => `Give the coin real utility (access, IP, product), a transparent treasury, and a scaled sell plan so ${n} never becomes exit liquidity's counterparty. This discipline is the entire difference between a durable brand and a one-week cash-grab.` },
    ],
  },
}

/* ---------- ranking ---------- */

function rankEcosystems(vertical, profile) {
  const preferred = vertical.ecosystems || []
  return ECOSYSTEMS.map((eco) => {
    // base from intrinsic consumer-fit
    let score = eco.consumerFit * 0.6
    // vertical preference: strong bonus, ordered (first preferred = biggest)
    const prefIdx = preferred.indexOf(eco.id)
    if (prefIdx >= 0) score += 26 - prefIdx * 6
    // goal bias
    score += profile.ecoBias[eco.id] || 0
    return { eco, fitScore: clamp(round(score)) }
  }).sort((a, b) => b.fitScore - a.fitScore)
}

function buildEcoWhy(eco, vertical, goal) {
  // pull a real precedent on this eco that matches the vertical if possible
  const onEco = (eco.precedents || [])
    .map((id) => PRECEDENTS[id])
    .filter(Boolean)
  const vMatch = onEco.find((p) => p.vertical === vertical.id)
  const cite = vMatch || onEco[0]
  const base = eco.why
  const tag = cite ? ` Precedent: ${cite.label}.` : ''
  const goalTag =
    goal === 'community' && (eco.id === 'base' || eco.id === 'abstract')
      ? ' Strong fit for a community goal (native social + no-friction onboarding).'
      : goal === 'awareness' && eco.id === 'solana'
        ? ' Strong fit for an awareness goal (highest memetic velocity).'
        : goal === 'loyalty' && eco.id === 'polygon'
          ? ' Strong fit for a loyalty goal (the most proven onchain-loyalty rail).'
          : ''
  return `${base}${tag}${goalTag}`
}

function ecoPrecedentStrings(eco, vertical) {
  const list = (eco.precedents || [])
    .map((id) => PRECEDENTS[id])
    .filter(Boolean)
  // surface vertical-matching precedents first
  list.sort((a, b) => (b.vertical === vertical.id) - (a.vertical === vertical.id))
  const out = list.slice(0, 3).map((p) => p.label)
  return out.length ? out : ['Emerging consumer-brand activations']
}

function rankProjects(vertical, profile, topEcoIds) {
  const cats = new Set(vertical.projectCategories || [])
  const topEcoSet = new Set(topEcoIds)
  return PROJECTS.map((p) => {
    let score = 30
    // authenticity is the moat, weighted by goal
    score += p.authenticity * 0.45 * profile.authWeight
    // category fit for the vertical
    if (cats.has(p.category)) score += 22
    // goal category bias
    score += profile.categoryBias[p.category] || 0
    // lives on a recommended ecosystem?
    const onTopEco = (p.ecosystems || []).some((e) => topEcoSet.has(e))
    if (onTopEco) score += 12
    const onPrimary = (p.ecosystems || []).includes(topEcoIds[0])
    if (onPrimary) score += 6
    return { p, fitScore: clamp(round(score)) }
  }).sort((a, b) => {
    if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore
    return b.p.authenticity - a.p.authenticity
  })
}

function projectWhy(p, vertical, onTopEco) {
  const ecoNote = onTopEco ? 'Lives on your recommended landing zone.' : ''
  const authNote =
    p.authenticity >= 85
      ? 'Top-tier authentic mindshare, an endorsement here is real distribution, not a paid post.'
      : p.authenticity >= 78
        ? 'High, durable authenticity, organic community, low bot/mercenary footprint.'
        : 'Solid authenticity for its category.'
  return `${p.note} ${authNote}${ecoNote ? ' ' + ecoNote : ''}`.trim()
}

function rankKols(vertical, profile) {
  const niches = new Set(vertical.kolNiches || [])
  return KOL_ARCHETYPES.map((k) => {
    let score = 20
    score += k.authenticity * 0.5 * profile.authWeight
    if (niches.has(k.niche)) score += 24
    score += profile.kolTierBias[k.tier] || 0
    return { k, fitScore: clamp(round(score)) }
  }).sort((a, b) => {
    if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore
    return b.k.authenticity - a.k.authenticity
  })
}

/* ---------- creator-mode ranking ---------- */

/* Creator-relevant precedents (a personal brand going onchain), used to cite
   real creator moves on each chain instead of the brand precedents. Includes
   the cautionary rugs on purpose, the honest read is the product. */
const CREATOR_PRECEDENT_IDS = [
  'mrbeast-feastables', 'iggy-mother', 'believe-launchcoin', 'zora-content-coins',
  'veefriends-garyvee', 'friendtech-socialfi', 'cryptozoo-rug', 'pumpfun-creator-coins',
]

function creatorEcoPrecedents(eco, archetype) {
  const wanted = new Set(archetype.precedents || [])
  const all = CREATOR_PRECEDENT_IDS.map((id) => ({ id, p: PRECEDENTS[id] })).filter((x) => x.p)
  const onChain = all.filter((x) => String(x.p.chain || '').toLowerCase().includes(String(eco.name || '').toLowerCase()))
  // surface precedents relevant to THIS creator's archetype first
  onChain.sort((a, b) => (wanted.has(b.id) - wanted.has(a.id)))
  const out = onChain.slice(0, 3).map((x) => x.p.label)
  return out.length ? out : ['Emerging creator-led activations']
}

function buildCreatorEcoWhy(eco, goalKey) {
  const goalTag =
    goalKey === 'own-audience' && eco.id === 'base'
      ? ' The creator-economy home base, owned social (Farcaster) + Coinbase distribution to keep the audience relationship yours.'
      : goalKey === 'tokenize' && eco.id === 'solana'
        ? ' Where creator coins actually launch, Believe / bags / pump rails and the deepest memetic velocity.'
        : goalKey === 'monetize' && eco.id === 'base'
          ? ' Content coins + creator storefronts settle here, so attention converts to revenue directly.'
          : goalKey === 'product' && (eco.id === 'base' || eco.id === 'abstract')
            ? ' Consumer-grade wallets + no-seed-phrase onboarding, the right rails for a product a mainstream fanbase can actually use.'
            : ''
  return `${eco.why}${goalTag}`
}

function rankCreatorProjects(archetype, profile, topEcoIds) {
  const cats = new Set(archetype.projectCategories || [])
  const topEcoSet = new Set(topEcoIds)
  return PROJECTS
    .filter((p) => (Number(p.creatorFit) || 0) > 0) // creator mode ranks only creator-economy rails
    .map((p) => {
      let score = 16
      score += (Number(p.creatorFit) || 0) * 0.5 // creatorFit is the primary signal in creator mode
      score += p.authenticity * 0.22 * profile.authWeight // authenticity = alignment-not-extraction
      if (cats.has(p.category)) score += 20
      score += profile.categoryBias[p.category] || 0
      const onTopEco = (p.ecosystems || []).some((e) => topEcoSet.has(e))
      if (onTopEco) score += 10
      const onPrimary = (p.ecosystems || []).includes(topEcoIds[0])
      if (onPrimary) score += 5
      return { p, fitScore: clamp(round(score)) }
    })
    .sort((a, b) => {
      if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore
      return (Number(b.p.creatorFit) || 0) - (Number(a.p.creatorFit) || 0)
    })
}

function creatorProjectWhy(p, onTopEco) {
  const base = p.creatorNote || p.note || ''
  const authNote =
    p.authenticity >= 82
      ? 'Aligned to creator success, not extraction, real adoption, low mercenary footprint.'
      : p.authenticity >= 68
        ? 'Solid alignment with genuine creator adoption.'
        : 'High reach but extraction-leaning, use it deliberately, with your own guardrails and a sell plan.'
  const ecoNote = onTopEco ? 'Lives on your recommended launch chain.' : ''
  return `${base} ${authNote}${ecoNote ? ' ' + ecoNote : ''}`.trim()
}

/**
 * Creator-mode proposal: a personal brand + a goal → an owned-audience business
 * plan. Same fixed shape as the brand proposal (so the view renders unchanged),
 * with `subjectType:'creator'` + creator-framed content.
 * @param {{ subject?: string, goal?: string }} input
 */
function computeCreatorProposal({ subject, goal } = {}) {
  const name = String(subject || '').trim() || 'Your brand'
  const goalKey = normCreatorGoal(goal)
  const profile = CREATOR_GOAL_PROFILE[goalKey]

  const archetypeId = resolveCreatorArchetype(name)
  const archetype = getCreatorArchetype(archetypeId)

  // ecosystems, rankEcosystems reads `.ecosystems` + `.consumerFit`, so the
  // archetype (which carries `ecosystems`) slots straight in.
  const ecoRanked = rankEcosystems(archetype, profile)
  const ecosystems = ecoRanked.slice(0, 4).map(({ eco, fitScore }) => ({
    id: eco.id,
    name: eco.name,
    chain: eco.chain,
    fitScore,
    why: buildCreatorEcoWhy(eco, goalKey),
    precedents: creatorEcoPrecedents(eco, archetype),
  }))
  const topEcoIds = ecosystems.map((e) => e.id)
  const topEcoSet = new Set(topEcoIds)

  // projects, creator-economy rails only, creatorFit-weighted
  const projRanked = rankCreatorProjects(archetype, profile, topEcoIds)
  const projects = projRanked.slice(0, 6).map(({ p, fitScore }) => {
    const onTopEco = (p.ecosystems || []).some((e) => topEcoSet.has(e))
    return {
      symbol: p.symbol,
      name: p.name,
      category: p.category,
      fitScore,
      authenticity: p.authenticity,
      why: creatorProjectWhy(p, onTopEco),
    }
  })

  // voices, reuse rankKols (archetype carries `kolNiches`); relabeled as
  // "collabs & co-signs" in the view.
  const kolRanked = rankKols(archetype, profile)
  const kols = kolRanked.slice(0, 6).map(({ k, fitScore }) => ({
    handle: k.handle,
    niche: k.niche,
    tier: k.tier,
    authenticity: k.authenticity,
    why: k.why,
    fitScore,
  }))

  // product plays, 2 goal-driven plays + the archetype's signature play, all
  // instantiated with the creator's name. De-dupe by title so a goal play and an
  // archetype signature that overlap never render twice.
  const angles = []
  const seenAngle = new Set()
  const pushAngle = (title, thesis) => {
    const key = String(title || '').trim().toLowerCase()
    if (!title || seenAngle.has(key)) return
    seenAngle.add(key)
    angles.push({ title, thesis })
  }
  for (const play of profile.plays || []) {
    pushAngle(play.title, typeof play.thesis === 'function' ? play.thesis(name) : String(play.thesis))
  }
  if (archetype.signature) {
    pushAngle(archetype.signature.title, String(archetype.signature.thesis || '').replace(/\{name\}/g, name))
  }

  const avoid = [
    'A cash-grab coin with no product behind it. It dumps on the fans who trusted you and torches the brand permanently (the CryptoZoo lesson). Your audience is not exit liquidity.',
    'Financializing every fan interaction: the friend.tech-style "everything is a key" model spikes then bleeds to zero when there is no durable reason to hold.',
    'Renting engagement (bought followers, bot amplification): your audience authenticity is the whole asset, and a manufactured audience makes every downstream product worthless.',
    'A launchpad or partner that optimizes for extraction over your success. Check that its past creators actually won, not just that volume printed.',
    goalKey === 'product'
      ? 'Bolting "neobank"/"card" onto a product with no real banking partner or compliance: regulatory blowback costs far more than the launch is worth. Partner properly or don\'t ship it.'
      : goalKey === 'tokenize'
        ? 'Launching the token before there is anything to hold: no utility, no treasury transparency, and no sell discipline is a countdown to a rug headline.'
        : 'Chasing another platform\'s reach instead of moving fans to something you own: if a ban or algorithm change can erase the relationship, you do not own the audience.',
  ]

  const topEco = ecosystems[0]
  const topProj = projects[0]
  const goalOutcome =
    goalKey === 'own-audience' ? 'a de-platform-proof community it controls end to end'
      : goalKey === 'monetize' ? 'direct revenue from content and products, not ad splits'
        : goalKey === 'product' ? 'an owned product the audience already wants to buy'
          : 'a creator coin the audience holds a real, aligned stake in'
  // avoid the "build on Base with Base" echo when the top rail IS the chain itself
  const withProj = topProj && topProj.name && topProj.name !== topEco.name ? ` with ${topProj.name}` : ''
  const summary = `${name} (${archetype.label}) should build on ${topEco.name}${withProj}, treating the audience as an owned market. The goal: ${goalOutcome}. Every rail is graded on whether it aligns to the creator's success, never bought hype.`

  return {
    subjectType: 'creator',
    brand: name, // keep the `brand` key so the view/summary/LLM transport work unchanged
    subject: name,
    goal: goalKey,
    vertical: archetype.label,
    archetype: archetypeId,
    audienceNote: archetype.audienceNote || '',
    summary,
    ecosystems,
    projects,
    kols,
    angles,
    avoid,
  }
}

/* ---------- main ---------- */

/**
 * @param {{ brand?: string, subject?: string, subjectType?: 'brand'|'creator', goal?: string }} input
 * @returns the fixed-shape Proposal (see file header / task contract)
 */
export function computeGtmProposal({ brand, subject, subjectType, goal } = {}) {
  // Creator mode: a personal brand / IRL creator building a company on its audience.
  if (String(subjectType || '').toLowerCase() === 'creator') {
    return computeCreatorProposal({ subject: subject || brand, goal })
  }

  const brandName = String(brand || subject || '').trim() || 'Your brand'
  const goalKey = normGoal(goal)
  const profile = GOAL_PROFILE[goalKey]

  const verticalId = resolveBrandVertical(brandName)
  const vertical = getVertical(verticalId)

  // --- ecosystems (top ~4) ---
  const ecoRanked = rankEcosystems(vertical, profile)
  const ecosystems = ecoRanked.slice(0, 4).map(({ eco, fitScore }) => ({
    id: eco.id,
    name: eco.name,
    chain: eco.chain,
    fitScore,
    why: buildEcoWhy(eco, vertical, goalKey),
    precedents: ecoPrecedentStrings(eco, vertical),
  }))
  const topEcoIds = ecosystems.map((e) => e.id)

  // --- projects (top ~6) ---
  const topEcoSet = new Set(topEcoIds)
  const projRanked = rankProjects(vertical, profile, topEcoIds)
  const projects = projRanked.slice(0, 6).map(({ p, fitScore }) => {
    const onTopEco = (p.ecosystems || []).some((e) => topEcoSet.has(e))
    return {
      symbol: p.symbol,
      name: p.name,
      category: p.category,
      fitScore,
      authenticity: p.authenticity,
      why: projectWhy(p, vertical, onTopEco),
    }
  })

  // --- KOLs (top ~6) ---
  const kolRanked = rankKols(vertical, profile)
  const kols = kolRanked.slice(0, 6).map(({ k, fitScore }) => ({
    handle: k.handle,
    niche: k.niche,
    tier: k.tier,
    authenticity: k.authenticity,
    why: k.why,
    fitScore,
  }))

  // --- angles (~3), instantiate the vertical's templates with the brand ---
  const angles = (vertical.angleTemplates || []).slice(0, 3).map((a) => ({
    title: a.title,
    thesis: a.thesis,
  }))
  // safety net: never empty
  if (!angles.length) {
    angles.push(
      { title: 'Community-led drop on consumer rails', thesis: `Launch ${brandName} on a low-friction consumer chain with a co-marketed moment rather than going cold.` },
      { title: 'Invisible-crypto loyalty', thesis: `Add ownable digital goods inside ${brandName}'s existing app with fiat checkout and no wallet jargon.` },
    )
  }

  // --- avoid (anti-patterns) ---
  const avoid = [
    'Bought-impression KOL farms (low authenticity, high churn): they spike vanity reach then evaporate, and the audience never converts.',
    'Paste-the-brief shill campaigns: identical copy across sub-1k-follower accounts reads as inauthentic and damages brand trust.',
    'Launching a separate "destination" app instead of integrating onchain rewards into your existing product (the wound-down Starbucks Odyssey lesson).',
    'Leading with wallet/seed-phrase friction: mainstream fans bounce. Use smart wallets / email login and hide the crypto.',
    goalKey === 'awareness'
      ? 'Chasing a token launch before community exists: awareness without a place to land creates mercenary, not durable, attention.'
      : 'Speculative token mechanics that turn fans into flippers. Optimize for ownership and access, not price action.',
  ]

  // --- summary (1-line strategic thesis) ---
  const topEco = ecosystems[0]
  const topProj = projects[0]
  const goalName = goalKey.charAt(0).toUpperCase() + goalKey.slice(1)
  const withProjBrand = topProj && topProj.name && topProj.name !== topEco.name ? ` and partner ${topProj.name}` : ''
  const summary = `${brandName} (${vertical.label}, goal: ${goalName}) should land on ${topEco.name}${withProjBrand}, leaning on authentic onchain voices (not bought reach) to ${goalKey === 'loyalty' ? 'turn existing customers into onchain members' : goalKey === 'community' ? 'build a durable, owned community' : goalKey === 'product' ? 'ship real onchain utility' : 'earn genuine cultural reach'}.`

  return {
    subjectType: 'brand',
    brand: brandName,
    subject: brandName,
    goal: goalKey,
    vertical: verticalId,
    summary,
    ecosystems,
    projects,
    kols,
    angles,
    avoid,
  }
}

/* ---------- LLM context + directive ---------- */

/** Compact text block for the LLM, the ranked proposal with scores + why.
    Section labels flip for creator mode so the LLM writes the right document. */
export function buildGtmContext(proposal) {
  if (!proposal) return ''
  const isCreator = proposal.subjectType === 'creator'
  const L = []
  L.push(`[SPECTRE_GTM_PROPOSAL subjectType="${proposal.subjectType || 'brand'}" ${isCreator ? 'creator' : 'brand'}="${proposal.brand}" ${isCreator ? 'archetype' : 'vertical'}="${proposal.vertical}" goal="${proposal.goal}"]`)
  L.push(`STRATEGIC THESIS: ${proposal.summary}`)
  if (isCreator && proposal.audienceNote) L.push(`AUDIENCE: ${proposal.audienceNote}`)

  L.push(`${isCreator ? 'WHERE TO LAUNCH' : 'WHERE TO LAND'}, ranked ecosystems (fit 0-100):`)
  for (const e of proposal.ecosystems) {
    L.push(`- ${e.name} [${e.fitScore}] on ${e.chain}: ${e.why}`)
    if (e.precedents && e.precedents.length) L.push(`    precedents: ${e.precedents.join(' | ')}`)
  }

  L.push(`${isCreator ? 'WHO TO BUILD WITH' : 'WHO TO PARTNER'}, ranked rails/projects (fit / authenticity 0-100${isCreator ? '; authenticity = aligned-to-creator vs extraction' : ''}):`)
  for (const p of proposal.projects) {
    L.push(`- ${p.name} ($${p.symbol}, ${p.category}) [fit ${p.fitScore} · authenticity ${p.authenticity}]: ${p.why}`)
  }

  L.push(`${isCreator ? 'COLLABS & CO-SIGNS' : 'WHICH VOICES'}, ranked voices (tier · authenticity 0-100):`)
  for (const k of proposal.kols) {
    L.push(`- @${k.handle} (${k.niche}, ${k.tier} · authenticity ${k.authenticity}): ${k.why}`)
  }

  L.push(`${isCreator ? 'PRODUCT PLAYS' : 'ACTIVATION ANGLES'}:`)
  for (const a of proposal.angles) {
    L.push(`- ${a.title}: ${a.thesis}`)
  }

  L.push('AVOID (anti-patterns):')
  for (const x of proposal.avoid) {
    L.push(`- ${x}`)
  }

  return L.join('\n')
}

export const GTM_DIRECTIVE = (brand, subjectType) => {
  if (String(subjectType || '').toLowerCase() === 'creator') {
    return `You are Spectre's creator go-to-market strategist. A personal brand / IRL creator is a company: the audience is the market and the creator owns the sales cycle end to end. Using ONLY the proposal block above, write a sharp, plain-English GTM plan for ${brand || 'the creator'} to build a business on their audience. Structure: (1) open with the ONE-LINE STRATEGIC THESIS; (2) WHERE TO LAUNCH, name the top chain and justify it with the cited creator precedent (including the cautionary ones where relevant); (3) WHO TO BUILD WITH, the creator-economy rails, and explicitly say WHY each is aligned to creator SUCCESS vs optimized for extraction (cite the authenticity scores, a low score means high reach but extraction risk, to be used deliberately); (4) COLLABS & CO-SIGNS, the voices to engage and why they carry organic credibility (note that "archetype:" handles are profiles to source a live vetted account, not named people); (5) THREE concrete PRODUCT PLAYS, the owned coin / content coins / community / product (app, game, card, consumer brand); (6) WHAT TO AVOID, the anti-patterns, framed as risk to the creator's AUDIENCE TRUST, which is the entire asset. Be specific, cite the scores and precedents, ground every claim in the block, and never encourage treating fans as exit liquidity. Do NOT invent rails, people, chains, or precedents not listed. No filler, no hype words, write like you're briefing a creator's CEO.`
  }
  return `You are Spectre's institutional crypto go-to-market strategist. Using ONLY the GTM proposal block above, write a sharp, board-ready crypto go-to-market proposal for ${brand || 'the brand'}. Structure: (1) open with the ONE-LINE STRATEGIC THESIS; (2) WHERE TO LAND, name the top chain/ecosystem and justify it with the cited precedent (a real consumer brand that did this); (3) WHO TO PARTNER, the projects, and explicitly say WHY each is authentic real mindshare, not bought reach (cite the authenticity scores); (4) WHICH VOICES, the KOLs to engage and why they carry organic credibility (note that "archetype:" handles are profiles to source a live vetted account, not named people); (5) THREE concrete activation angles; (6) WHAT TO AVOID, the anti-patterns, framed as risk to brand trust. Be specific, cite the scores and precedents given, and ground every claim in the block. Do NOT invent projects, people, chains, or precedents not listed. No filler, no hype words, no hedging, write like you're briefing a CMO.`
}
