/**
 * Social metrics glossary - plain-English explanations for the stats shown on
 * the X-Dash and X-Intelligence (Social Intelligence) pages.
 *
 * Surfaced via <InfoTip> dots in the app's Info Mode (toggle in the header).
 * Copy rules:
 *   - Explain WHAT a metric means and WHY it matters, in one or two short
 *     sentences (the InfoTip bubble is ~240px wide).
 *   - NO secret sauce: never expose exact weights, thresholds or formulas.
 *     Describe the concept, not the math.
 *   - Honest framing: "tracked", "spotted", "measured" - never "predicted".
 *
 * Keys are stable ids; values are the explanation strings. Use METRIC_INFO[id]
 * (or the safe getMetricInfo helper) to read.
 */

export const METRIC_INFO = {
  /* ---------- Signal Score + its parts (token) ---------- */
  signalScore:
    'One 0-100 score for the quality of a token’s social attention - not just how loud it is. It blends clean signal, author breadth, velocity, novelty and engagement, favouring real, broad attention over raw volume. Tiers: Quiet, Building, Strong, Elite.',
  velocity:
    'How fast attention is accelerating - mentions right now versus the token’s own recent baseline. Higher means the conversation is speeding up.',
  novelty:
    'How fresh the attention is versus recycled - whether people are talking about it for new reasons, not just repeating old chatter.',
  cleanSignal:
    'How much of the attention looks organic versus spam, bots or coordinated shilling. Higher means a more genuine conversation.',
  authorBreadth:
    'Whether many different accounts are talking about it versus a few repeating themselves. Higher means broad, independent interest rather than an echo chamber.',
  engagement:
    'How much the posts actually land - the likes, reposts and replies they earn, not just the raw count of mentions.',

  /* ---------- Command bar / KPIs ---------- */
  tokensTracked: 'How many tokens Spectre is currently tracking across X.',
  totalMentionsKpi: 'Total posts mentioning any tracked token in the selected window.',
  withSignal:
    'How many tracked tokens currently clear the signal bar - enough real, broad attention to be worth a look, versus background noise.',

  /* ---------- Sort modes ---------- */
  sortModes:
    'How the board is ranked. Mentions = raw talk volume. Momentum = how fast attention is rising versus baseline. Conviction = quality of attention (clean, broad, durable) over raw volume.',
  sortMentions: 'Rank by raw mention volume - who’s being talked about most, regardless of quality.',
  sortMomentum: 'Rank by how fast attention is rising versus each token’s baseline - what’s heating up right now.',
  sortConviction:
    'Rank by quality of attention, not volume - tokens carried by many real authors with clean, durable signal rise above ones just being shouted about.',

  /* ---------- Command-bar filters ---------- */
  timeframeFilter:
    'The window every metric on the board is measured over - mentions, momentum and rankings all recompute for the timeframe you pick (24H, 7D, 30D or all-time).',
  segmentFilter:
    'Narrow the board by role. Majors = large, established coins; Context = names moving the broader narrative; Opportunity = smaller, earlier tokens where attention is still forming.',
  marketCapFilterCtl:
    'Only show tokens above a market-cap floor. Raise it to skip micro-caps, lower it to hunt earlier, smaller names before the crowd arrives.',
  chainFilter:
    'Only show tokens on the chain you pick - useful when you trade one ecosystem (Solana, Base, Ethereum...) and want the social board scoped to it.',
  previewTab:
    'An experimental view - live to explore while we finish building it. The data is real but the surface may change, so read it as a preview, not a finished tool.',

  /* ---------- Social Market Read ---------- */
  regime: 'The overall market mood Spectre reads from price and breadth - from Extreme Fear to Extreme Greed.',
  fearGreed: 'The Fear & Greed index (0-100). Low means fear, high means greed - a quick read on crowd emotion.',
  btcDominance:
    'Bitcoin’s share of the total crypto market cap. Rising dominance often means money is rotating out of alts into BTC.',
  marketCapChange: 'The total crypto market cap’s change over the window.',
  convergence:
    'Where social attention, real capital and news line up on the same token or narrative - the strongest kind of signal.',
  smartMoney:
    'Flows Spectre attributes to institutional or historically-sharp wallets, as opposed to the retail crowd.',

  /* ---------- What’s Moving Now cockpit ---------- */
  topMover: 'The token that climbed the most board ranks in the window - the biggest jump in attention rank.',
  rankMove: 'How many places a token moved on the attention leaderboard versus the prior window.',
  cleanestBreakout:
    'The breaking-out token with the highest share of clean, organic mentions - momentum that isn’t just spam.',
  noisiest:
    'High mention volume but a low clean-signal share - lots of talk, much of it spam or coordinated. A caution flag, not a buy signal.',
  topCarrier:
    'The creator driving the most weighted reach in the window - whose posts are carrying the most real attention.',
  weightedReach: 'Reach weighted by real engagement, not just follower count - how far a creator’s posts actually travel.',
  mostActiveNarrative: 'The theme or sector pulling the most attention right now (e.g. AI agents, Solana memes).',
  attention: 'Total weighted social attention - mentions scaled by how much real engagement they pull.',

  /* ---------- Leaderboard / table columns ---------- */
  mentions24h: 'Posts mentioning the token in the last 24 hours.',
  marketCap: 'The token’s current market capitalization.',
  price: 'The token’s current price.',
  authors:
    'How many distinct accounts mentioned the token - many authors means broad interest, not one account repeating itself.',
  tracked: 'Where the token sits on the attention board now; the # is the rank Spectre first tracked it at.',
  attentionMap:
    'A treemap of the board - each tile is a token, sized by how much attention it’s pulling. Green climbed in rank, red fell.',

  /* ---------- Proof / Track Record ---------- */
  callsLogged:
    'How many tokens Spectre has logged, each recorded at the market cap it was first spotted at. An illustrative $1,000 per call shows the model’s record.',
  hitRate:
    'Share of logged calls currently in profit versus their first-spotted market cap, marked to the latest tape - winners and losers both counted.',
  medianOutcome:
    'The typical call’s outcome - the middle result across every logged call, so a few moonshots don’t flatter the average.',
  hits2x: 'Logged calls that have at least doubled (2x) from their first-spotted market cap.',
  hits5x: 'Logged calls that have at least 5x’d from their first-spotted market cap.',
  hits10x: 'Logged calls that have at least 10x’d from their first-spotted market cap.',
  best: 'The single best call’s current multiple from where it was first spotted.',
  bestPeak: 'The highest peak any call reached after being spotted (mark-to-highest, not current).',
  portfolio: 'How the illustrative equal-weight book of every call is doing overall right now.',
  underwater: 'How many logged calls are currently below their first-spotted market cap.',
  dead: 'Logged calls that have effectively gone to zero or stopped trading.',
  winnersPnl: 'Combined paper profit of the calls currently in the green.',
  losersPnl: 'Combined paper loss of the calls currently in the red.',
  netPnl: 'Winners and losers netted together - the book’s overall paper P&L.',
  outcomeDistribution: 'How every call’s outcome is spread - from below entry, through flat, to multi-baggers.',
  entry:
    'The market cap the moment Spectre first spotted the token socially - a fixed record of when it was caught, not a price target.',
  now: 'The token’s market cap right now.',
  roi: 'Return since first spotted - current market cap versus the entry market cap.',
  peak: 'The highest the token reached after being spotted - the best the call ever looked.',
  spotted: 'When Spectre first saw the token in tweets, and how long ago that was.',
  stay: 'Staying power - how durably the token has held attention since spotted, rather than spiking once and fading.',
  callers: 'The accounts that called the token, shown as avatars.',

  /* ---------- Narrative clusters ---------- */
  scoreSum: 'The combined signal score of every token in the narrative - its total attention weight.',
  narrativeMentionShare: 'The narrative’s share of all tracked mentions - how much of the conversation it owns.',
  mentionShareVsTokenShare:
    'A narrative’s size by talk (mention share) versus by number of tokens (token share). Talk far above token count means a few names pull outsized attention.',
  freshTokens: 'Tokens newly appearing in the narrative this window - new entrants, not the usual names.',
  avgCleanSignal: 'The average clean-signal score across the narrative’s tokens - how organic its attention is overall.',
  narrativeAuthors: 'Distinct accounts posting about the narrative.',
  narrativeEngagement: 'Total engagement the narrative’s posts pulled.',
  leaders: 'The tokens leading the narrative right now.',

  /* ---------- Creators / authors ---------- */
  followers: 'The account’s follower count on X.',
  creatorTokens: 'How many distinct tracked tokens the creator has covered.',
  coverage: 'Which tokens the creator has been posting about.',
  carrierScore:
    'Rates a creator by impact, not follower count - a small account that calls tokens early with real engagement out-ranks a big one that just reposts.',
  earlyHitRate:
    'How often the creator mentions a token before it moves rather than after - a measure of being early, not loud.',
  avgLead: 'The creator’s typical head-start - how far ahead of the move their mention usually lands.',
  leadTime: 'How early the creator is on average - a shorter lead with more hits is stronger.',
  fastMover: 'Badge: this account tends to post early, before a token’s move.',
  replySniper: 'Badge: this account’s signal comes mostly through replies rather than original posts.',
  topTokenShare:
    'How concentrated the creator is on one token - a high share means most of their posting is about a single name.',
  replyContext: 'Mentions made inside replies rather than standalone posts - context, not a fresh call.',
  signalTrajectory: 'The creator’s mentions and engagement over time - whether their activity is rising or fading.',
  domainSkills: 'The sectors or narratives the creator posts about most - where their coverage is strongest.',
  tierInfluencer: 'A high-reach account whose posts move attention.',
  tierKol: 'Key Opinion Leader - a recognized, influential voice in crypto.',
  tierCreator: 'An active content creator posting regularly about tokens.',
  tierUser: 'A regular account, not a major influencer or creator.',
  replyAmplifier: 'An account that mainly amplifies others through replies rather than originating calls.',
  commentator: 'An account that mostly comments on tokens rather than breaking them first.',
  impact: 'A creator’s influence on a token’s attention, weighted by real engagement rather than follower count.',
  carryVolume: 'How actively the creator is posting about tokens in the window - keeps one-hit accounts from ranking high.',
  audienceReach: 'The creator’s follower base - deliberately a minor factor, so a real audience helps but never dominates their score.',

  /* ---------- Token drawer ---------- */
  extAuthors: 'Distinct external X accounts (outside Spectre) mentioning the token.',
  mentionsTotal: 'All-time mentions Spectre has recorded for the token.',
  medianEng: 'The typical post’s engagement for this token - the middle value, so one viral post doesn’t skew it.',
  entryMcap:
    'The market cap the first time Spectre surfaced this token socially - a fixed record, held even if it leaves and re-enters the board.',
  enteredRank: 'The board rank the token held when it first entered the Top 25.',
  spectreMomentum:
    'Tracks the token from the first time it entered Spectre’s momentum board - when it was surfaced, not a price prediction.',
  xDashIndexed: 'When the X-Dash crawler first saw this token in tweets (different from when it climbed onto the board).',
  carriers: 'The creators carrying the token right now, ranked by their share of its attention.',
  matchStructure:
    'How people refer to the token: by $cashtag, by @handle, or both. “Both” is the strongest sign a post is really about this token.',
  cashtagOnly: 'Mentions that use only the $ticker (e.g. $SOL), not the project’s handle.',
  handleOnly: 'Mentions that use only the project’s @handle, not the $ticker.',
  bothMatch: 'Mentions that use both the $ticker and the @handle - the clearest sign the post is about this token.',
  uniqueAuthor: 'Share of mentions from distinct accounts versus the same accounts repeating.',
  socialHealth:
    'A five-axis read of attention quality - clean signal, breadth, durability, momentum and anti-crowding - each normalized 0-100.',
  breadth: 'How widely attention is spread across different accounts versus concentrated in a few.',
  durability: 'How well attention is holding over time rather than spiking once and fading.',
  momentum: 'The direction and speed of the token’s attention trend.',
  antiCrowding: 'How spread-out the attention is. High means many independent voices; low means it’s crowded into a few accounts.',
  crowding: 'How concentrated the attention is in a few accounts. “Broadening” means it’s spreading to more voices.',
  attentionQuality:
    'An overall read of how real and healthy the token’s attention is - organic, broad and durable versus thin or manufactured.',

  /* ---------- Rotations ---------- */
  rotationFlow:
    'Where attention is rotating between sectors - accounts and tokens moving from talking about one narrative to another.',
  transitions: 'Counts of attention moving from one domain to another in the latest snapshot.',

  /* ---------- Creator edits ---------- */
  profileEdits:
    'Tracked accounts that changed their profile (handle, name, avatar or bio) in the window - identity changes can flag rebrands or impersonation.',
  avatarSwaps: 'Accounts that changed their profile picture.',
  usernameEdits: 'Accounts that changed their @handle - worth watching, since handle changes can mask history.',
  dualShifts:
    'Accounts that changed both their handle and display name at once - a stronger sign of a deliberate identity change.',
  detectedChanges: 'A live feed of the specific profile changes Spectre detected on tracked accounts.',

  /* ---------- X-Intelligence (Social Intelligence bubble field) ---------- */
  xiGrowth:
    'Change in the token’s mentions over 24h versus its 7-day average. Positive means it’s being talked about more than usual.',
  xi7dAvg: 'The token’s average daily mentions over the past 7 days - the baseline its 24h activity is compared against.',
  xiMindshare: 'The token’s share of all crypto mentions tracked right now - its slice of the total social conversation.',
  xiSentiment:
    'Share of tracked tokens whose mentions are rising versus normal. Above 50% means more tokens are heating up than cooling down.',
  xiAvgVelocity: 'The average size of mention swings across tracked tokens - how much attention is moving overall, either direction.',
  xiActiveSignals: 'How many tracked tokens are making a big move - a mention swing over 10% versus their baseline.',
  xiInfluenceScore:
    'The overall crowd tilt - Bullish when most tracked tokens are gaining attention, Bearish when most are losing it.',
  xiVelocityDelta: 'The average size of mention swings across all tracked tokens right now - the pace of attention change.',
  xiSignalDensity: 'The share of tracked tokens actively moving - the Active Signals out of all tokens tracked.',
  xiTotalMentions: 'Total posts across all tracked tokens, with the net change versus the prior period.',
}

/** Safe lookup - returns the explanation string, or '' if the id is unknown. */
export function getMetricInfo(id) {
  if (!id) return ''
  return METRIC_INFO[id] || ''
}

export default METRIC_INFO
