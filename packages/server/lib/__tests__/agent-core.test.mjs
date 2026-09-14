/**
 * agent-core loop mechanics test - mocked Gemini stream, no network.
 * Run: node packages/server/lib/__tests__/agent-core.test.mjs
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const core = require('../agent-core.js')

let failures = 0
function assert(cond, label) {
  if (cond) { console.log('  ok -', label) } else { failures++; console.error('  FAIL -', label) }
}

// ── summarizeBars ───────────────────────────────────────────────────────────
{
  console.log('summarizeBars:')
  const bars = []
  let price = 100
  for (let i = 0; i < 120; i++) {
    price *= 1 + (Math.sin(i / 7) * 0.01) + 0.001 // gentle uptrend with waves
    bars.push({ t: 1700000000 + i * 3600, o: price * 0.995, h: price * 1.01, l: price * 0.99, c: price, v: 1000 + i })
  }
  const s = core.summarizeBars(bars, { resolution: '60', lookbackBars: 120 })
  assert(s.ok === true, 'summary ok')
  assert(s.barCount === 120, 'bar count')
  assert(['up', 'down', 'sideways'].includes(s.trend.direction), 'trend direction present')
  assert(s.trend.direction === 'up', 'uptrend detected on drifting series')
  assert(Number.isFinite(s.volatility.atrPct) && s.volatility.atrPct > 0, 'ATR% computed')
  assert(Number.isFinite(s.range.vwap), 'vwap computed')
  assert(Array.isArray(s.levels.support) && Array.isArray(s.levels.resistance), 'levels arrays')
  const udf = { t: bars.map(b => b.t), o: bars.map(b => b.o), h: bars.map(b => b.h), l: bars.map(b => b.l), c: bars.map(b => b.c), v: bars.map(b => b.v) }
  const s2 = core.summarizeBars(udf, {})
  assert(s2.ok === true && s2.barCount === 120, 'UDF-shape bars accepted')
  const s3 = core.summarizeBars([{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 0 }], {})
  assert(s3.ok === false, 'too-few bars rejected cleanly')
}

// ── compactToolResult ───────────────────────────────────────────────────────
{
  console.log('compactToolResult:')
  const big = { rows: Array.from({ length: 200 }, (_, i) => ({ i, text: 'x'.repeat(50) })) }
  const out = core.compactToolResult('t', big)
  assert(JSON.stringify(out).length <= 2100, 'oversized result truncated')
  const small = { a: 1 }
  assert(core.compactToolResult('t', small).a === 1, 'small result passes through')
}

// ── runAgentTurn with a mocked streaming model ──────────────────────────────
{
  console.log('runAgentTurn (mocked stream):')
  // Round 1: model emits text + two function calls (one duplicated to test the
  // hash gate across rounds). Round 2: model emits final text, no calls.
  let round = 0
  const mockAi = {
    models: {
      async generateContentStream({ contents }) {
        round++
        async function* gen() {
          if (round === 1) {
            yield { candidates: [{ content: { parts: [{ text: 'Let me check. ' }] } }] }
            yield { candidates: [{ content: { parts: [
              { functionCall: { name: 'get_token_snapshot', args: {} } },
              { functionCall: { name: 'get_security', args: {} } },
            ] } }] }
          } else if (round === 2) {
            // duplicate call - must be served from the per-turn hash cache
            yield { candidates: [{ content: { parts: [{ functionCall: { name: 'get_token_snapshot', args: {} } }] } }] }
          } else {
            const last = JSON.stringify(contents.slice(-1))
            yield { candidates: [{ content: { parts: [{ text: `Final answer (rounds=${round}, sawFnResponse=${last.includes('functionResponse')}).` }] } }] }
          }
        }
        return gen()
      },
    },
  }

  const events = []
  let execCount = 0
  const result = await core.runAgentTurn({
    ai: mockAi,
    model: 'gemini-3-flash-preview',
    history: [{ role: 'user', text: 'earlier q' }, { role: 'model', text: 'earlier a' }],
    userMessage: 'is this token safe?',
    digest: { ts: Date.now(), market: { price: 1 } },
    token: { address: '0xabc', networkId: 8453, symbol: 'TEST' },
    emit: (type, payload) => events.push({ type, ...payload }),
    executeServerTool: async (name) => { execCount++; return { name, ok: true } },
    toolCtx: {},
    deadlineMs: 10_000,
  })

  assert(result.text.includes('Final answer'), 'final text returned')
  assert(round === 3, 'three model rounds ran')
  assert(execCount === 2, `hash gate: 3 calls but only 2 executions (got ${execCount})`)
  assert(result.toolCalls === 3, 'toolCalls counted per call')
  const types = events.map(e => e.type)
  assert(types.filter(t => t === 'tool_start').length === 3, 'tool_start emitted per call')
  assert(types.filter(t => t === 'tool_result').length === 3, 'tool_result emitted per call')
  assert(types.indexOf('text') < types.indexOf('tool_start'), 'text streamed before tools')
  const finalTextEvt = events.filter(e => e.type === 'text').map(e => e.content).join('')
  assert(finalTextEvt.includes('sawFnResponse=true'), 'functionResponse fed back to model')
}

// ── model fallback on primary failure ───────────────────────────────────────
{
  console.log('model fallback:')
  const seen = []
  const mockAi = {
    models: {
      async generateContentStream({ model }) {
        seen.push(model)
        if (model !== core.AGENT_MODEL_FALLBACK) { const e = new Error('404 model not found'); throw e }
        async function* gen() { yield { candidates: [{ content: { parts: [{ text: 'fallback ok' }] } }] } }
        return gen()
      },
    },
  }
  const events = []
  const result = await core.runAgentTurn({
    ai: mockAi, model: core.AGENT_MODEL, history: [], userMessage: 'hi',
    digest: null, token: { address: 'x', networkId: 1399811149, symbol: 'S' },
    emit: (type, payload) => events.push({ type, ...payload }),
    executeServerTool: async () => ({}), toolCtx: {}, deadlineMs: 10_000,
  })
  assert(seen[0] === core.AGENT_MODEL && seen[1] === core.AGENT_MODEL_FALLBACK, 'fell back to secondary model')
  assert(result.model === core.AGENT_MODEL_FALLBACK, 'result reports active model')
  assert(result.text === 'fallback ok', 'fallback answered')
}

// ── prompt shape ────────────────────────────────────────────────────────────
{
  console.log('system prompt:')
  const p = core.buildSystemPrompt({ token: { symbol: 'WIF', name: 'dogwifhat', networkId: 1399811149, address: 'So1abc' } })
  assert(p.includes('solana'), 'chain named')
  assert(p.includes('Never invent'), 'grounding rule present')
  assert(p.includes('UNTRUSTED'), 'untrusted-data rule present')
  const pr = core.buildSystemPrompt({ token: { symbol: 'WIF', networkId: 1399811149 }, capability: 'read' })
  assert(pr.includes('READ-ONLY'), 'read-only capability rule present')
}

// ── trade helpers ───────────────────────────────────────────────────────────
{
  console.log('trade helpers:')
  assert(core.toBaseUnits('0.05', 9) === '50000000', 'toBaseUnits 0.05 SOL')
  assert(core.toBaseUnits('1.5', 18) === '1500000000000000000', 'toBaseUnits 1.5 ETH (BigInt-safe)')
  assert(core.fromBaseUnits('50000000', 9) === '0.05', 'fromBaseUnits round-trip')
  let threw = false
  try { core.toBaseUnits('-1', 9) } catch { threw = true }
  assert(threw, 'negative amount rejected')

  assert(core.parseImpactPct({ provider: 'jupiter', priceImpactPct: '0.0234' }) === 2.34, 'jupiter fraction -> percent')
  assert(core.parseImpactPct({ provider: '0x', estimatedPriceImpact: '0.3' }) === 0.3, '0x percent stays percent')

  const token = { address: 'So1abc', networkId: 1399811149, symbol: 'WIF' }
  const buy = core.buildQuoteRequest({ token, tokenDecimals: 6, tokenPriceUsd: 0.15, nativePriceUsd: 80, side: 'buy', amount: 0.1, denom: 'native', slippageBps: 100 })
  assert(buy.params && buy.params.inputToken === 'native' && buy.params.outputToken === 'So1abc', 'buy routes native->token')
  assert(buy.params.amount === '100000000', 'buy amount in lamports')
  assert(buy.params.chainId === 'solana', 'chain slug from networkId')

  const usdBuy = core.buildQuoteRequest({ token, tokenDecimals: 6, tokenPriceUsd: 0.15, nativePriceUsd: 80, side: 'buy', amount: 40, denom: 'usd' })
  assert(usdBuy.meta && Math.abs(usdBuy.meta.inputHuman - 0.5) < 1e-9, 'usd buy converts via native price ($40/$80=0.5 SOL)')

  const sell = core.buildQuoteRequest({ token, tokenDecimals: 6, tokenPriceUsd: 0.15, side: 'sell', amount: 100, denom: 'token' })
  assert(sell.params && sell.params.inputToken === 'So1abc' && sell.params.amount === '100000000', 'sell routes token->native in token base units')

  const noPrice = core.buildQuoteRequest({ token, tokenDecimals: 6, tokenPriceUsd: null, nativePriceUsd: null, side: 'buy', amount: 40, denom: 'usd' })
  assert(!!noPrice.error, 'usd sizing without native price errors cleanly')

  const clamped = core.buildQuoteRequest({ token, tokenDecimals: 6, side: 'buy', amount: 1, denom: 'native', slippageBps: 9999 })
  assert(clamped.meta.slippageBps === 500, 'slippage clamped to 500bps')

  // validateTradeProposal gates
  const entry = { quote: { provider: 'jupiter', priceImpactPct: '0.01', outputAmount: '1000' }, meta: { side: 'buy' }, createdAt: Date.now() }
  assert(core.validateTradeProposal({ entry, security: { isHoneypot: false, sellTax: 2 }, networkId: 8453 }).ok, 'clean EVM buy passes')
  assert(core.validateTradeProposal({ entry, security: { isHoneypot: true }, networkId: 8453 }).refused, 'honeypot buy refused')
  assert(core.validateTradeProposal({ entry, security: { sellTax: 45 }, networkId: 8453 }).refused, 'extreme sell tax refused')
  assert(core.validateTradeProposal({ entry: null, security: null, networkId: 8453 }).refused, 'unknown quoteId refused')
  const staleEntry = { ...entry, createdAt: Date.now() - 120_000 }
  assert(core.validateTradeProposal({ entry: staleEntry, security: {}, networkId: 8453 }).refused, 'stale quote refused')
  const highImpact = { quote: { provider: 'jupiter', priceImpactPct: '0.08' }, meta: { side: 'buy' }, createdAt: Date.now() }
  assert(core.validateTradeProposal({ entry: highImpact, security: { unavailable: true }, networkId: 1399811149 }).refused, 'impact >5% refused')
  assert(core.validateTradeProposal({ entry, security: { unavailable: true }, networkId: 1399811149 }).ok, 'solana no-coverage buy passes (liquidity rails handle it)')
  assert(core.validateTradeProposal({ entry, security: null, networkId: 8453 }).refused, 'EVM buy without security read refused')

  // rankTweetFeed - ticker-collision relevance ranking
  const feedCtx = { limit: 3, address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', handle: 'Spectre__AI', name: 'SPECTRE AI', symbol: 'SPECTRE' }
  const feed = [
    { username: 'fresh_spam', followers: 12, tweet_text: '$SPECTRE $PEPE $DOGE moon', like_count: 0, views: 5 },
    { username: 'collision_proj', followers: 900, tweet_text: '$SPECTRE indexes open-sourcing new asset classes', like_count: 3 },
    { username: 'real_voice', followers: 27600, tweet_text: 'Watching @Spectre__AI closely, $SPECTRE tight accumulation zone', like_count: 41, views: 3000 },
    { username: 'ca_poster', followers: 200, tweet_text: 'ape $SPECTRE 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', like_count: 1 },
  ]
  const ranked = core.rankTweetFeed(feed, feedCtx)
  assert(ranked.totalFound === 4 && ranked.matchedFound === 2, 'rank counts total + matched')
  assert(ranked.posts.length === 2 && ranked.posts[0].author === 'ca_poster' && ranked.posts[0].relevance === 'ca', 'CA match outranks everything; cashtag-only text excluded when >=2 matched')
  assert(ranked.posts[1].author === 'real_voice' && ranked.posts[1].relevance === 'handle', 'handle match second')
  assert(ranked.otherTickerChatter?.count === 2, 'collision posts collapse to a count')
  assert(!('accounts' in ranked.otherTickerChatter) && !JSON.stringify(ranked.otherTickerChatter).includes('collision_proj'), 'withheld chatter carries NO names and NO text')
  const memeRanked = core.rankTweetFeed(feed.slice(0, 2), feedCtx) // 0 matched posts
  assert(memeRanked.posts.length === 2 && memeRanked.posts[0].relevance === 'cashtag-only', 'thin-match memecoin case keeps tagged text')
  assert(core.rankTweetFeed(null, feedCtx).totalFound === 0, 'null feed -> empty rank')
  const tracked = core.parseTrackerPayload({ top_mentions: [{ author: 'x', text: 'watch @Spectre__AI go' }, { author: 'y', text: '$SPECTRE pump' }] }, 5, feedCtx)
  assert(tracked.topTweets[0].relevance === 'handle' && tracked.topTweets[1].relevance === 'cashtag-only', 'tracker tweets carry relevance tags')

  // buildOrderTicket sizing - server-side USD->native, never model arithmetic
  const solToken = { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149, symbol: 'WIF' }
  const tBase = { token: solToken, tokenDecimals: 6, circulatingSupply: 1e9, tokenPriceUsd: 0.154 }
  const usdSized = core.buildOrderTicket({ ...tBase, nativePriceUsd: 78.11, args: { side: 'buy', triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.156, spendUsd: 1, spendCapUsd: 1 } })
  assert(Math.abs(usdSized.ticket.spend.amount - 1 / 78.11) < 1e-9, 'buy sized from LIVE native price')
  assert(usdSized.ticket.spend.usdEstimate === 1 && usdSized.ticket.spend.nativePriceAtCreate === 78.11, 'ticket carries sizing provenance')
  const noNative = core.buildOrderTicket({ ...tBase, nativePriceUsd: null, args: { side: 'buy', triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.156, spendUsd: 1, spendCapUsd: 1 } })
  assert(noNative.refused, 'USD buy without live native price refused')
  const capClamped = core.buildOrderTicket({ ...tBase, nativePriceUsd: 78.11, args: { side: 'buy', triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.156, spendNative: 0.05, spendCapUsd: 1 } })
  assert(Math.abs(capClamped.ticket.spend.amount - 1 / 78.11) < 1e-9, 'oversize native amount clamped to the USD cap ceiling')
  const smallNative = core.buildOrderTicket({ ...tBase, nativePriceUsd: 78.11, args: { side: 'buy', triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.156, spendNative: 0.005, spendCapUsd: 5 } })
  assert(smallNative.ticket.spend.amount === 0.005, 'deliberately small native amount NOT inflated to the cap')
  const sellTicket = core.buildOrderTicket({ ...tBase, nativePriceUsd: 78.11, args: { side: 'sell', triggerMetric: 'price', triggerOp: 'gte', triggerValue: 0.2, spendNative: 3.3, spendCapUsd: 5 } })
  assert(sellTicket.ticket.spend.amount === 3.3, 'sell token amount passes through untouched')

  // instantTrigger - warn when the condition is ALREADY met at creation
  const tik = (args, extra = {}) => core.buildOrderTicket({ ...tBase, nativePriceUsd: 78.11, ...extra, args: { side: 'buy', spendUsd: 1, spendCapUsd: 1, ...args } }).ticket
  assert(tik({ triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.156 }).instantTrigger === true, 'lte trigger above current price = instant (0.154 <= 0.156)')
  assert(tik({ triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.14 }).instantTrigger === false, 'lte trigger below current price = resting')
  assert(tik({ triggerMetric: 'price', triggerOp: 'gte', triggerValue: 0.15 }).instantTrigger === true, 'gte trigger below current price = instant')
  assert(tik({ triggerMetric: 'price', triggerOp: 'gte', triggerValue: 0.2 }).instantTrigger === false, 'gte trigger above current price = resting')
  assert(tik({ triggerMetric: 'mcap', triggerOp: 'lte', triggerValue: 160_000_000 }).instantTrigger === true, 'mcap compared in mcap space (154M <= 160M = instant)')
  assert(tik({ triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.156, rangeMin: 0.14, rangeMax: 0.155, tranches: 3 }).instantTrigger === true, 'DCA band already entered = instant first tranche')
  assert(tik({ triggerMetric: 'price', triggerOp: 'lte', triggerValue: 0.156, rangeMin: 0.12, rangeMax: 0.13, tranches: 3 }, {}).instantTrigger === false, 'DCA band below current = resting')

  // collectXProfiles - author chips for the client renderer
  const prof = core.collectXProfiles([
    { username: 'Real_One', ProfilePic: 'https://pbs.twimg.com/p.jpg', followers: 500 },
    { username: 'bad handle!', ProfilePic: 'https://x/y.jpg' },
    { username: 'Real_One', profile_image: 'https://other.jpg', followers: 9 },
  ])
  assert(Object.keys(prof).length === 1 && prof.real_one.pfp === 'https://pbs.twimg.com/p.jpg' && prof.real_one.followers === 500, 'profiles keyed lowercase, first-seen wins, invalid handles dropped')

  // parseTweetFeed - the ISO stamp must survive. Upstream `date` is a
  // RELATIVE string ("11 days ago"); preferring it made every time question
  // unanswerable and produced a false "no livestream in 14d" claim.
  const pf = core.parseTweetFeed({ tweets: [{ username: 'a', tweet_text: 'hi', date: '11 days ago', created_at: '2026-07-05T16:21:37+00:00' }] }, 5)
  assert(pf[0].at === '2026-07-05T16:21:37+00:00', 'parseTweetFeed keeps the ISO created_at as `at`')
  assert(pf[0].rel === '11 days ago' && !Number.isNaN(new Date(pf[0].at).getTime()), '`rel` holds the human label; `at` is parseable')
}

// ── analyzeEventImpact - the event study ────────────────────────────────────
{
  // Synthetic hourly bars: flat $1.00 for 20 days, so ANY event move is
  // unambiguous and the baseline is a clean zero.
  const H = 3600
  const t0 = Math.floor(Date.now() / 1000) - 20 * 86400
  const bars = []
  for (let i = 0; i < 20 * 24; i++) bars.push({ t: t0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 100 })
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400_000).toISOString()

  // A +10% step 24h after an event 10 days ago.
  const stepped = bars.map((b) => (b.t >= t0 + (10 * 24 + 24) * H ? { ...b, c: 1.1, o: 1.1, h: 1.1, l: 1.1 } : b))
  const evAt = new Date((t0 + 10 * 24 * H) * 1000).toISOString()
  const r = core.analyzeEventImpact([{ username: 'x', tweet_text: 'Live now talking about the roadmap', created_at: evAt }], stepped, { kind: 'livestream', days: 14 })
  assert(r.ok === true && r.n === 1, 'analyzeEventImpact finds a livestream and reports n=1')
  assert(r.events[0].moves.h24 === 10, 'joins event to price: +10% at the 24h horizon')
  assert(r.events[0].moves.h1 === 0, 'flat before the step = 0% at 1h')
  assert(r.events[0].matchedOn.toLowerCase() === 'live now', 'reports the phrase it matched on (auditable)')

  // THE REGRESSION THAT MATTERS: a shallow feed must NEVER support "there
  // were none". @GoNeuralAI's feed reached back 11.8d and the agent claimed
  // no livestreams in 14d.
  const shallow = core.analyzeEventImpact([{ username: 'x', tweet_text: 'gm', created_at: iso(3) }], bars, { kind: 'livestream', days: 14 })
  assert(shallow.n === 0 && shallow.feed.coversRequestedWindow === false, 'shallow feed: n=0 but coversRequestedWindow=false')
  assert(/CANNOT say there were none/.test(shallow._note), 'shallow feed n=0 note forbids the absence claim')
  const deep = core.analyzeEventImpact([{ username: 'x', tweet_text: 'gm', created_at: iso(30) }, { username: 'x', tweet_text: 'gm', created_at: iso(1) }], bars, { kind: 'livestream', days: 14 })
  assert(deep.n === 0 && deep.feed.coversRequestedWindow === true && /absence is supportable/.test(deep._note), 'deep feed with no matches: absence IS supportable')

  // Clustering: announce -> "live now" -> recap is ONE stream, not three.
  const cl = core.analyzeEventImpact([
    { username: 'x', tweet_text: 'Going live now with the team', created_at: evAt },
    { username: 'x', tweet_text: 'we are live - join us live', created_at: new Date(new Date(evAt).getTime() + 40 * 60_000).toISOString() },
    { username: 'x', tweet_text: 'great livestream today, thanks all', created_at: new Date(new Date(evAt).getTime() + 2 * 3600_000).toISOString() },
  ], bars, { kind: 'livestream', days: 14 })
  assert(cl.n === 1 && cl.events[0].relatedPosts === 2, 'three posts about one stream cluster into n=1')

  // Product-speak "going live" is not a broadcast.
  const fp = core.analyzeEventImpact([{ username: 'x', tweet_text: 'Status page for services is also going live very soon', created_at: iso(2) }], bars, { kind: 'livestream', days: 14 })
  assert(fp.n === 0, 'LIVE_NOT excludes "status page going live very soon" (product, not stream)')

  // n<3 must never license "usually".
  assert(/NEVER answer "usually"/.test(r._note), 'n<3 note forbids generalizing to a pattern')

  // Baseline is computed and flat here, so an event move is measurable against it.
  assert(r.baseline.h24 && r.baseline.h24.medianPct === 0 && r.baseline.h24.n > 100, 'baseline reports median + sample size at each horizon')
}

// ── team-feed discovery + multi-feed event study ────────────────────────────
{
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400_000).toISOString()

  // discoverTeamCandidates: RTs weigh 3x mentions; official + excluded
  // handles dropped; the NEURAL shape (4 RTs + 5 mentions of the founder).
  const officialFeed = [
    { username: 'GoNeuralAI', tweet_text: 'RT @neutanent: shipping update', created_at: iso(1) },
    { username: 'GoNeuralAI', tweet_text: 'RT @neutanent: another one', created_at: iso(2) },
    { username: 'GoNeuralAI', tweet_text: 'RT @neutanent: and again', created_at: iso(3) },
    { username: 'GoNeuralAI', tweet_text: 'RT @neutanent: fourth', created_at: iso(4) },
    { username: 'GoNeuralAI', tweet_text: 'great work @neutanent on the beta @somepartner', created_at: iso(5) },
    { username: 'GoNeuralAI', tweet_text: 'thanks @somepartner', created_at: iso(6) },
    { username: 'GoNeuralAI', tweet_text: 'self ref @GoNeuralAI', created_at: iso(7) },
  ]
  const cands = core.discoverTeamCandidates(officialFeed, { excludeHandles: ['GoNeuralAI'] })
  assert(cands[0]?.handle === 'neutanent' && cands[0].rtCount === 4, 'discovery ranks the RT-heavy founder first')
  assert(!cands.some((c) => c.handle === 'goneuralai'), 'the official handle never discovers itself')
  assert(!cands.some((c) => c.handle === 'somepartner'), 'a twice-mentioned partner stays below the score floor')

  // feedReferencesProject: the anti-@AnthropicAI gate. A team feed talks
  // about the project; an unrelated big account does not.
  const founderFeed = [
    { tweet_text: 'Live now talking $NEURAL status', created_at: iso(2) },
    { tweet_text: 'big week for $neural holders', created_at: iso(4) },
    { tweet_text: 'gm', created_at: iso(5) },
  ]
  assert(core.feedReferencesProject(founderFeed, { symbol: 'NEURAL', officialHandle: 'GoNeuralAI' }) === true, 'founder feed referencing $NEURAL twice validates')
  const unrelated = [{ tweet_text: 'Claude 5 is out today', created_at: iso(1) }, { tweet_text: 'model updates', created_at: iso(2) }]
  assert(core.feedReferencesProject(unrelated, { symbol: 'NEURAL', officialHandle: 'GoNeuralAI' }) === false, 'unrelated feed (mentioned partner/tool) fails validation and is dropped')

  // Feeds-mode analyzeEventImpact: shallow official + deep founder feed.
  // The event lives ONLY on the founder feed - exactly the NEURAL shape.
  const H = 3600
  const t0 = Math.floor(Date.now() / 1000) - 20 * 86400
  const bars = []
  for (let i = 0; i < 20 * 24; i++) bars.push({ t: t0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 100 })
  const evAt = new Date((t0 + 10 * 24 * H) * 1000).toISOString()
  const feeds = [
    { handle: 'GoNeuralAI', role: 'official', tweets: [{ username: 'GoNeuralAI', tweet_text: 'gm', created_at: iso(2) }] },
    { handle: 'neutanent', role: 'team', tweets: [{ username: 'neutanent', tweet_text: 'Live now talking $NEURAL status', created_at: evAt }, { username: 'neutanent', tweet_text: 'gm', created_at: iso(18) }] },
  ]
  const fr = core.analyzeEventImpact(feeds, bars, { kind: 'livestream', days: 14 })
  assert(fr.ok && fr.n === 1 && fr.events[0].author === 'neutanent', 'feeds mode finds the founder-feed livestream and attributes the author')
  assert(fr.feed.byHandle.length === 2, 'per-handle coverage reported for both accounts')
  const officialCov = fr.feed.byHandle.find((h) => h.handle === 'GoNeuralAI')
  const teamCov = fr.feed.byHandle.find((h) => h.handle === 'neutanent')
  assert(officialCov.coversRequestedWindow === false && teamCov.coversRequestedWindow === true, 'shallow official does not cover 14d, deep founder does')
  assert(fr.feed.coversRequestedWindow === true, 'merged coverage true when ANY checked feed spans the window')
  assert(/@GoNeuralAI \(official/.test(fr._note) && /@neutanent \(team/.test(fr._note), 'note names every account checked with its role')

  // Backward compat: a plain tweet array still works as a single feed.
  const plain = core.analyzeEventImpact([{ username: 'x', tweet_text: 'Live now with the team', created_at: evAt }], bars, { kind: 'livestream', days: 14 })
  assert(plain.ok && plain.n === 1, 'plain-array input still analyzes as one feed')
}

// ── review-confirmed fixes (adversarial pass 2026-07-17) ────────────────────
{
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400_000).toISOString()
  const H = 3600
  const mkBars = (startDaysAgo, hours) => {
    const t0 = Math.floor(Date.now() / 1000) - startDaysAgo * 86400
    const out = []
    for (let i = 0; i < hours; i++) out.push({ t: t0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 100 })
    return out
  }

  // Finding 1 (high): a matched event the bars cannot price must be REPORTED
  // unpriced, never silently dropped into a false "absence is supportable".
  const shortBars = mkBars(5, 5 * 24) // bars start 5d ago
  const oldEvent = core.analyzeEventImpact(
    [{ username: 'x', tweet_text: 'We are live now on X, join!', created_at: iso(10) }, { username: 'x', tweet_text: 'gm', created_at: iso(20) }],
    shortBars, { kind: 'livestream', days: 14 })
  assert(oldEvent.n === 1 && oldEvent.events[0].priced === false && oldEvent.events[0].priceAtEvent === null, 'event outside bar coverage is reported with priced:false, not dropped')
  assert(oldEvent.unpriced === 1 && /priced:false/.test(oldEvent._note) && /HAPPENED/.test(oldEvent._note), 'note says the unpriced event HAPPENED and price impact is unavailable')
  assert(!/absence is supportable/.test(oldEvent._note), 'no absence claim when a matched event exists')

  // Finding 2 (high): bare "space(s)" and "join us on <x>" must not fabricate
  // livestreams; real Spaces announcements still match.
  const cover = mkBars(15, 15 * 24)
  const noEv = (text) => core.analyzeEventImpact([{ username: 'x', tweet_text: text, created_at: iso(3) }], cover, { kind: 'livestream', days: 14 }).n
  assert(noEv('Excited to announce our new office spaces in Lisbon!') === 0, '"office spaces" is not a livestream')
  assert(noEv('gm fam! join us on Telegram for daily alpha') === 0, '"join us on Telegram" is not a livestream')
  assert(noEv('Solana block space is the cheapest in crypto') === 0, '"block space" is not a livestream')
  assert(noEv('X Space tomorrow with the team - set a reminder') === 1, 'a real X Space announcement still matches')
  assert(noEv('Spaces today at 5pm UTC, come through') === 1, 'a scheduled Spaces post still matches')

  // Finding 5 (medium): LIVE_NOT is phrase-scoped - a REAL stream that merely
  // mentions an API/dashboard is no longer suppressed; product-goes-live is.
  assert(noEv("We're LIVE NOW on X - come ask the team about the API roadmap") === 1, 'real stream mentioning an API is not suppressed')
  assert(noEv('The dashboard goes live tomorrow, stay tuned') === 0, 'product-goes-live phrasing stays suppressed')

  // Finding 3 (medium): a gap right after the event must yield null at short
  // horizons, never a fabricated 0.00% resolved from the event bar itself.
  const t0g = Math.floor(Date.now() / 1000) - 10 * 86400
  const gapBars = []
  for (let i = 0; i < 24; i++) gapBars.push({ t: t0g + i * H, o: 1, h: 1, l: 1, c: 1, v: 100 })
  for (let i = 30; i < 24 * 9; i++) gapBars.push({ t: t0g + i * H, o: 1.5, h: 1.5, l: 1.5, c: 1.5, v: 100 }) // 6h gap, then +50%
  const gapEvAt = new Date((t0g + 23 * H + 1800) * 1000).toISOString() // 30min after last pre-gap bar (9d ago)
  const gapped = core.analyzeEventImpact([{ username: 'x', tweet_text: 'Live now with the community', created_at: gapEvAt }], gapBars, { kind: 'livestream', days: 14 })
  assert(gapped.n === 1 && gapped.events[0].moves.h1 === null, '+1h across a 6h gap is null, not a fabricated 0%')
  assert(gapped.events[0].moves.h24 === 50, '+24h still resolves cleanly past the gap')

  // Finding 6 (medium): mentions alone never mint a team account - an RT by
  // the official account is required.
  const replyOnly = [
    { username: 'proj', tweet_text: '@bigKOL thanks ser!', created_at: iso(1) },
    { username: 'proj', tweet_text: '@bigKOL appreciate you', created_at: iso(2) },
    { username: 'proj', tweet_text: '@bigKOL gm', created_at: iso(3) },
    { username: 'proj', tweet_text: '@bigKOL wagmi', created_at: iso(4) },
  ]
  assert(core.discoverTeamCandidates(replyOnly, { excludeHandles: ['proj'] }).length === 0, 'mention-only accounts (replies to a KOL) are never candidates')

  // Finding 7 (low): relative-only dates -> explicit "unavailable" note, no
  // "undefinedd" garbage.
  const relOnly = core.analyzeEventImpact([{ handle: 'gono', role: 'official', tweets: [{ username: 'gono', tweet_text: 'hello', date: '11 days ago' }] }], cover, { kind: 'livestream', days: 14 })
  assert(/unavailable/.test(relOnly._note) && !/undefined/.test(relOnly._note), 'zero parseable timestamps -> honest unavailable note, no undefined interpolation')

  // Finding 4 (medium): baseline is wall-clock with the same gap rules - on
  // gapped bars the h1 baseline only counts pairs a real hour apart.
  const base = core.analyzeEventImpact([{ username: 'x', tweet_text: 'gm', created_at: iso(1) }], gapBars, { kind: 'livestream', days: 14 })
  assert(base.baseline.h1 && base.baseline.h1.n < gapBars.length, 'wall-clock baseline skips pairs that span the gap')
}

// ── conversation-expanded feed contamination (2026-07-17) ───────────────────
// The scraper "feed" for a handle carries ~25% posts from OTHER accounts in
// its threads (@GoNeuralAI's had 9 of 31 foreign, incl. @neutanent's). Only
// the handle's own posts may count as its voice.
{
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400_000).toISOString()
  const H = 3600
  const t0 = Math.floor(Date.now() / 1000) - 15 * 86400
  const bars = []
  for (let i = 0; i < 15 * 24; i++) bars.push({ t: t0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 100 })

  // ownPosts drops thread-context posts from other accounts.
  const mixed = [
    { username: 'wilhelmsenchris', tweet_text: 'building engines is hard', created_at: iso(1) },
    { username: 'NewMoonAnon84', tweet_text: '@wilhelmsenchris Soon life on steam $NEURAL', created_at: iso(2) },
    { username: 'wilhelmsenchris', tweet_text: 'gm', created_at: iso(3) },
  ]
  assert(core.ownPosts(mixed, 'wilhelmsenchris').length === 2, 'ownPosts keeps only the handle\'s own posts')
  assert(core.ownPosts(mixed, 'WILHELMSENCHRIS').length === 2, 'ownPosts is case-insensitive on the handle')

  // Validation must not pass on a reply-guy's project posts inside the
  // candidate's conversation feed.
  const foreignRefs = [
    { username: 'candidate', tweet_text: 'gm', created_at: iso(1) },
    { username: 'replyguy', tweet_text: 'love $NEURAL', created_at: iso(2) },
    { username: 'replyguy2', tweet_text: '$NEURAL to the moon', created_at: iso(3) },
  ]
  assert(core.feedReferencesProject(core.ownPosts(foreignRefs, 'candidate'), { symbol: 'NEURAL', officialHandle: 'GoNeuralAI' }) === false, 'foreign project posts in a candidate feed do not validate the candidate')

  // Engine: a random community member's "live now" inside a team member's
  // conversation feed must NOT become a priced project event.
  const contaminated = [
    { handle: 'wilhelmsenchris', role: 'team', tweets: [
      { username: 'wilhelmsenchris', tweet_text: 'shipping all week', created_at: iso(2) },
      { username: 'randomguy', tweet_text: 'I am live now streaming this token!', created_at: iso(3) },
    ] },
  ]
  const cr = core.analyzeEventImpact(contaminated, bars, { kind: 'livestream', days: 14 })
  assert(cr.n === 0, 'a foreign "live now" post inside a team feed is not an event')
  assert(cr.feed.byHandle[0].posts === 1, 'per-handle post counts reflect own posts only')
}

// ── chart presentation payload (visual side-channel, 2026-07-22/23) ─────────
// get_bars_summary carries a _visual payload for the client renderer: real
// candles + supply/demand zones + EMA series. The agent loop emits it as a
// 'visual' SSE event and strips it before the model or the brief prompt.
{
  const H = 3600
  const t0 = Math.floor(Date.now() / 1000) - 200 * H
  const bars = []
  // A wavy series so local extrema exist -> S/R clusters -> zones.
  for (let i = 0; i < 160; i++) {
    const base = 100 + Math.sin(i / 7) * 10
    bars.push({ t: t0 + i * H, o: base, h: base + 2, l: base - 2, c: base + Math.cos(i / 5), v: 1000 + i })
  }
  const s = core.summarizeBars({ bars }, { resolution: '60', lookbackBars: 120 })
  assert(s.ok === true, 'summarizeBars ok on wavy series')
  assert(s._visual && s._visual.kind === 'chart', '_visual presentation payload attached')
  assert(Array.isArray(s._visual.bars) && s._visual.bars.length <= 90, '_visual bars capped at 90')
  assert(s._visual.bars.every((b) => Array.isArray(b) && b.length === 6 && b.every(Number.isFinite)), '_visual bars are finite [t,o,h,l,c,v] tuples')
  assert(s._visual.resolution === '60' && typeof s._visual.trend === 'string', '_visual carries resolution + trend')
  const zones = s._visual.zones
  assert(Array.isArray(zones) && zones.length > 0, 'zones derived from S/R clusters')
  assert(zones.every((z) => z.top > z.bottom && Number.isFinite(z.price)), 'every zone is a valid price band')
  assert(zones.filter((z) => z.type === 'supply').every((z) => z.price > s.lastClose), 'supply zones sit above last close')
  assert(zones.filter((z) => z.type === 'demand').every((z) => z.price < s.lastClose), 'demand zones sit below last close')
  // EMA series for the on-stage indicator draw: index-aligned with bars.
  assert(s._visual.ema && Array.isArray(s._visual.ema.fast) && Array.isArray(s._visual.ema.slow), '_visual carries ema fast+slow series')
  assert(s._visual.ema.fast.length === s._visual.bars.length && s._visual.ema.slow.length === s._visual.bars.length, 'ema series aligned to the bars window')
  assert(s._visual.ema.fast.every(Number.isFinite) && s._visual.ema.slow.every(Number.isFinite), 'ema values finite')

  // The model-facing rails: the tool description sells the display, and the
  // voice prompt tells him to present the on-screen chart, not recite it.
  const decls = core.buildToolDeclarations({ capability: 'full' })
  const barsDecl = decls.find((d) => d.name === 'get_bars_summary')
  assert(/DISPLAYS a candlestick chart/.test(barsDecl.description), 'tool description says the chart is displayed')
  const xDecl = decls.find((d) => d.name === 'get_x_intel')
  assert(/DISPLAYS the accounts/.test(xDecl.description), 'x_intel description says the accounts+posts are displayed')
  assert(/CALL THIS instead of answering from the context digest/.test(xDecl.description), 'x_intel description forces the call for social questions')
  const voicePrompt = core.buildSystemPrompt({ token: { symbol: 'TEST', name: 'Test' }, capability: 'full', mode: 'voice' })
  assert(/VOICE \+ CHART/.test(voicePrompt), 'voice prompt carries the chart-presentation rule')
  assert(/VOICE \+ X ACTIVITY/.test(voicePrompt), 'voice prompt carries the X-presentation rule')
  assert(/call the ONE that matches the question topic/.test(voicePrompt), 'digest-preference rule carves out the presentation tools per-topic')
  assert(/NEVER call get_bars_summary or answer with chart analysis here/.test(voicePrompt), 'social questions are fenced from TA pivots')
  assert(/ANSWER THE QUESTION ASKED/.test(voicePrompt), 'never-pivot rail present')
  assert(/screenPosts/.test(voicePrompt) && /NEVER say a post "is not available" when screenPosts has it/.test(voicePrompt), 'walkthrough is bound to the screen manifest')
}

// ── X-activity presentation payload (buildXActivityVisual, 2026-07-23) ──────
// The stage's account cards: official/team/community voices with pfps and
// follower counts (from the profiles side-map) + a post-timestamp timeline.
{
  const now = Date.now()
  const iso = (hAgo) => new Date(now - hAgo * 3600_000).toISOString()

  // collectTopPosts: best post per author (entity-decoded text, https photo)
  const tp = core.collectTopPosts([
    { username: 'GoProjectAI', tweet_text: 'Beta &amp; more shipping', like_count: 54, views: '1367', created_at: iso(3), media_url_https: 'https://pbs.twimg.com/media/x.jpg' },
    { username: 'GoProjectAI', tweet_text: 'older low-engagement post', like_count: 2, views: '10', created_at: iso(30) },
    { username: 'CrossChainChad', tweet_text: 'clarity act take', likes: 4, created_at: iso(20), media: [{ type: 'photo', media_url_https: 'http://insecure/img.jpg' }] },
  ])
  assert(tp.goprojectai.text === 'Beta & more shipping', 'top post text entity-decoded, highest engagement wins')
  assert(tp.goprojectai.image === 'https://pbs.twimg.com/media/x.jpg', 'photo url carried')
  assert(tp.crosschainchad.image === undefined, 'non-https media dropped')

  // tweet_id rides along (the verification enrichment needs it)
  const tpId = core.collectTopPosts([{ username: 'IdGuy', tweet_text: 'post', tweet_id: '2079886935376511247', like_count: 1, created_at: iso(1) }])
  assert(tpId.idguy.id === '2079886935376511247', 'tweet_id kept as string')

  // collectPostList: displayable own-post rail (stamped, substantive only)
  const pl = core.collectPostList([
    { username: 'GoProjectAI', tweet_text: 'Beta &amp; more shipping', tweet_id: '111', like_count: 54, created_at: iso(3), media_url_https: 'https://pbs.twimg.com/media/x.jpg' },
    { username: 'CrossChainChad', tweet_text: 'clarity act take incoming today', tweet_id: '222', likes: 4, created_at: iso(20) },
    { username: 'GoProjectAI', tweet_text: 'no timestamp - dropped' },
    { username: 'CrossChainChad', tweet_text: 'RT @GoProjectAI: @CrossChainChad shipping soon', tweet_id: '333', created_at: iso(1) },
    { username: 'CrossChainChad', tweet_text: '@alpha @beta @gamma 🤝🏗️', tweet_id: '444', created_at: iso(2) },
  ])
  assert(pl.length === 2 && pl[0].text === 'Beta & more shipping' && pl[0].image, 'post list collects stamped posts, decodes entities')
  assert(!pl.some((p) => /^RT @/.test(p.text)), 'retweets excluded from the rail')
  assert(!pl.some((p) => p.id === '444'), 'bare mention-chains excluded from the rail')

  const v = core.buildXActivityVisual({
    topPosts: tp,
    postList: [...pl, { handle: 'GoProjectAI', id: '111', text: 'Beta & more shipping', at: iso(3) }], // dup by id
    tracker: { mentions24h: 42 },
    official: {
      handle: 'GoProjectAI',
      posts: [{ author: 'GoProjectAI', at: iso(3), likes: 10, views: 2000 }],
      team: [{ handle: 'CrossChainChad', posts: [{ author: 'CrossChainChad', at: iso(20), likes: 4 }] }],
    },
    community: {
      posts: [
        { author: 'whale_one', followers: 50000, at: iso(6), likes: 12 },
        { author: 'whale_one', followers: 50000, at: iso(30), likes: 3 },
        { author: 'smallfry', followers: 90, at: iso(2), likes: 1 },
        { author: 'GoProjectAI', followers: 9999, at: iso(1), likes: 5 }, // dup of official - dropped
      ],
    },
    profiles: {
      goprojectai: { handle: 'GoProjectAI', pfp: 'https://pbs.twimg.com/a.jpg', followers: 12400, verified: true, badge: 'gold' },
      crosschainchad: { handle: 'CrossChainChad', pfp: 'http://insecure.example/x.jpg', followers: 3100, badge: 'blue' },
    },
    symbol: 'TEST',
  })
  assert(v && v.kind === 'x_activity' && v.symbol === 'TEST', 'x_activity visual built')
  assert(v.mentions24h === 42, 'mentions24h carried from tracker')
  assert(v.accounts[0].handle === 'GoProjectAI' && v.accounts[0].role === 'official', 'official account leads')
  assert(v.accounts[0].pfp === 'https://pbs.twimg.com/a.jpg' && v.accounts[0].verified === true && v.accounts[0].followers === 12400, 'profile fields embedded from the side-map')
  assert(v.accounts[1].handle === 'CrossChainChad' && v.accounts[1].role === 'team', 'team account second')
  assert(v.accounts[1].pfp === undefined, 'non-https pfp dropped')
  const community = v.accounts.filter((a) => a.role === 'community')
  assert(community[0].handle === 'whale_one' && community[0].posts === 2, 'community grouped by author, ranked by followers')
  assert(community[0].followers === 50000, 'community followers fall back to post data when not in profiles')
  assert(v.accounts.every((a) => a.handle.toLowerCase() !== 'goprojectai' || a.role === 'official'), 'official never duplicated as community')
  assert(Array.isArray(v.timeline) && v.timeline.length >= 2 && v.timeline.every((b) => Number.isFinite(b.t) && Number.isFinite(b.n)), 'timeline bucketed from post timestamps')
  assert(v.timeline.reduce((a, b) => a + b.n, 0) >= 4, 'timeline counts the sampled posts')
  assert(v.accounts[0].top?.text === 'Beta & more shipping' && v.accounts[0].top.image, 'official account carries its featured post')
  assert(v.accounts[1].top?.text === 'clarity act take' && v.accounts[1].top.image === undefined, 'team featured post attached, insecure image absent')
  assert(!('_score' in (v.accounts[0].top || {})), 'internal ranking score stripped from the payload')
  assert(v.accounts[0].badge === 'gold' && v.accounts[1].badge === 'blue', 'blue/gold badges pass through to the visual')
  assert(Array.isArray(v.posts) && v.posts.length === 2, 'chronological post rail attached, deduped by id')
  assert(v.posts[0].text === 'Beta & more shipping' && v.posts[0].pfp === 'https://pbs.twimg.com/a.jpg' && v.posts[0].badge === 'gold', 'newest post first, author pfp+badge attached')
  assert(v.posts[1].handle === 'CrossChainChad', 'older post second')
}

// ── sanitizeDisplayName humanizes usernames into spoken names ───────────────
{
  for (const [raw, want] of [
    ['Gleb02f', 'Gleb'], ['0xMaxi', 'Maxi'], ['crypto_kev99', 'Kev'],
    ['sunny_enzo', 'Sunny'], ['GLEB', 'Gleb'], ['JohnSmith', 'John'],
    ['__x0_9', ''], ['Gleb Ivanov', 'Gleb'], ['workashard02', 'Workashard'],
    ['', ''],
  ]) {
    const got = core.sanitizeDisplayName(raw)
    assert(got === want, `humanize "${raw}" -> "${want}" (got "${got}")`)
  }
  assert(core.buildXActivityVisual({ tracker: {}, official: null, community: { posts: [] } }) === null, 'no accounts -> null (nothing to show)')
}

// ── parseProfileFeed: any-account X read (posts vs replies) ─────────────────
{
  console.log('parseProfileFeed:')
  const now = Date.now()
  const iso = (minsAgo) => new Date(now - minsAgo * 60_000).toISOString()
  // One timeline carrying: own posts, own replies, an own retweet, and a
  // thread-context post by a DIFFERENT account (upstream ships all four).
  const feed = {
    author: null,
    tweets: [
      { tweet_id: '1', username: 'GoProjectAI', tweet_text: 'Mainnet is live today', created_at: iso(10), followers: 12000, like_count: 50, views: 900, profile_image: 'https://pbs.twimg.com/a.jpg' },
      { tweet_id: '2', username: 'GoProjectAI', tweet_text: '@someone thanks for the support', created_at: iso(30), followers: 12000, like_count: 5 },
      { tweet_id: '3', username: 'GoProjectAI', tweet_text: 'RT @partner: big news', created_at: iso(60), followers: 12000 },
      { tweet_id: '4', username: 'randomThirdParty', tweet_text: 'thread context post', created_at: iso(20), followers: 400 },
      { tweet_id: '5', username: 'GoProjectAI', tweet_text: '@a @b @c multi-mention reply', created_at: iso(120), followers: 11000 },
      { tweet_id: '6', username: 'GoProjectAI', tweet_text: 'Second original post', created_at: iso(240), followers: 11000 },
    ],
  }

  const r = core.parseProfileFeed(feed, '@GoProjectAI', { include: 'both', limit: 8 })
  assert(r.handle === 'GoProjectAI', 'leading @ stripped from the handle')
  assert(r.counts.feedPosts === 6 && r.counts.own === 5, 'foreign thread-context post excluded from own[]')
  assert(r.counts.posts === 3 && r.counts.replies === 2, 'posts vs replies split (retweet counts as a post)')
  assert(r.counts.retweets === 1, 'retweets counted separately')
  assert(r.posts.length === 3 && r.replies.length === 2, 'both lists returned under include:both')
  assert(r.posts.every((p) => p.author === 'GoProjectAI') && r.replies.every((p) => p.author === 'GoProjectAI'), 'no other account leaks into either list')
  assert(r.replies.every((p) => p.text.startsWith('@')), 'every reply carries a leading @mention')
  assert(!r.posts.some((p) => /^@/.test(p.text)), 'no reply leaked into posts')
  assert(r.posts.some((p) => /^RT @partner/.test(p.text)), 'retweet kept in posts with its RT prefix visible to the model')
  assert(r.posts[0].text === 'Mainnet is live today' && r.replies[0].text.startsWith('@someone'), 'both lists ordered newest first')
  assert(r.profile.followers === 12000 && r.profile.pfp === 'https://pbs.twimg.com/a.jpg', 'profile chips derived from the account rows')
  assert(r.coverage.oldestPostAt === iso(240) && Number.isFinite(r.coverage.feedReachesBackDays), 'coverage reports how far back the feed reaches')

  // The absence-honesty contract - this warning is the whole reason the tool
  // is safe to answer "has X said anything about..." questions with.
  const w = r.coverage.warning
  assert(/SELF-REPL/i.test(w) && /INDISTINGUISHABLE/i.test(w), 'coverage warning discloses the undetectable self-reply case')
  assert(/FLOOR/i.test(w), 'coverage warning calls the reply set a floor, not a complete list')
  assert(/31/.test(w), 'coverage warning states the upstream newest-31 timeline limit')
  assert(/NEVER conclude/i.test(w), 'coverage warning forbids concluding absence')

  // include filter narrows the LISTS but never the COUNTS - the model must
  // still see that replies exist even when it only asked for posts.
  const onlyPosts = core.parseProfileFeed(feed, 'GoProjectAI', { include: 'posts' })
  assert(onlyPosts.posts.length === 3 && onlyPosts.replies.length === 0, 'include:posts returns posts only')
  assert(onlyPosts.counts.replies === 2, 'include:posts still reports how many replies exist')
  const onlyReplies = core.parseProfileFeed(feed, 'GoProjectAI', { include: 'replies' })
  assert(onlyReplies.replies.length === 2 && onlyReplies.posts.length === 0, 'include:replies returns replies only')
  assert(core.parseProfileFeed(feed, 'GoProjectAI', { include: 'garbage' }).posts.length === 3, 'unknown include falls back to both')

  // limit clamping (1..20, default 8)
  const many = { tweets: Array.from({ length: 30 }, (_, i) => ({ tweet_id: `p${i}`, username: 'GoProjectAI', tweet_text: `post number ${i}`, created_at: iso(i + 1), followers: 100 })) }
  assert(core.parseProfileFeed(many, 'GoProjectAI', { limit: 50 }).posts.length === 20, 'limit clamped down to 20')
  assert(core.parseProfileFeed(many, 'GoProjectAI', { limit: 2 }).posts.length === 2, 'explicit small limit honored')
  assert(core.parseProfileFeed(many, 'GoProjectAI', {}).posts.length === 8, 'default limit is 8')
  assert(core.parseProfileFeed(many, 'GoProjectAI', { limit: 0 }).posts.length === 8, 'limit 0 falls back to the default')
  assert(core.parseProfileFeed(many, 'GoProjectAI', { limit: -5 }).posts.length === 1, 'negative limit clamped up to 1')
  assert(core.parseProfileFeed(many, 'GoProjectAI', { limit: 'abc' }).posts.length === 8, 'non-numeric limit falls back to the default')
  assert(core.parseProfileFeed(many.tweets, 'GoProjectAI', { limit: 3 }).posts.length === 3, 'bare array feed accepted')

  // Empty / broken feed: zeros and nulls, never fabricated activity.
  for (const [label, empty] of [['empty tweets', { tweets: [] }], ['null feed', null], ['garbage feed', { nope: 1 }]]) {
    const e = core.parseProfileFeed(empty, 'GhostAccount')
    assert(e.posts.length === 0 && e.replies.length === 0, `${label}: no posts invented`)
    assert(e.counts.own === 0 && e.counts.posts === 0 && e.counts.replies === 0, `${label}: counts are honest zeros`)
    assert(e.coverage.oldestPostAt === null && e.coverage.feedReachesBackDays === null, `${label}: coverage null, not zero-dated`)
    assert(e.profile.followers === null && e.profile.verified === null, `${label}: profile fields null, not fabricated`)
    assert(/NEVER conclude/i.test(e.coverage.warning), `${label}: absence warning still present`)
  }
  // A feed that carries ONLY other accounts must not be read as this account's.
  const foreignOnly = core.parseProfileFeed({ tweets: [{ username: 'someoneElse', tweet_text: 'hi', created_at: iso(5) }] }, 'GoProjectAI')
  assert(foreignOnly.counts.feedPosts === 1 && foreignOnly.counts.own === 0, 'foreign-only feed yields zero own posts')
  assert(core.parseProfileFeed(feed, '').counts.own === 0, 'missing handle never returns the whole feed as the account')
}

// ── get_x_profile tool declaration (read tier, any account) ─────────────────
{
  console.log('get_x_profile declaration:')
  const full = core.buildToolDeclarations({ capability: 'full' })
  const read = core.buildToolDeclarations({ capability: 'read' })
  const d = read.find((x) => x.name === 'get_x_profile')
  assert(!!d, 'get_x_profile is available to the READ tier (not gated behind trading)')
  assert(!!full.find((x) => x.name === 'get_x_profile'), 'get_x_profile also present in the full tier')
  assert(!read.find((x) => x.name === 'quote_swap'), 'read tier still excludes the trading tools')
  assert(/ANY X\/Twitter account/.test(d.description), 'description says it reads ANY account')
  assert(/NOT limited to this token/i.test(d.description), 'description says it is not limited to this token')
  assert(/REPLIES/.test(d.description), 'description promises replies, not just posts')
  assert(/DISPLAYS the account/.test(d.description), 'description says the account+posts are displayed')
  assert(/ABSENCE LIMIT/.test(d.description), 'description carries the absence limit')
  assert(/UNTRUSTED third-party data/.test(d.description), 'description marks tweet text untrusted')
  assert(d.parameters.required.length === 1 && d.parameters.required[0] === 'handle', 'handle is the only required param')
  assert(JSON.stringify(d.parameters.properties.include.enum) === JSON.stringify(['posts', 'replies', 'both']), 'include enum is posts/replies/both')
  assert(d.parameters.properties.limit.type === 'number' && /20/.test(d.parameters.properties.limit.description), 'limit documents its 20 ceiling')
  const prompt = core.buildSystemPrompt({ token: { symbol: 'TEST', name: 'Test' }, capability: 'read' })
  assert(/use get_x_profile on that handle/.test(prompt), 'prompt routes named-account questions to get_x_profile')
}

console.log(failures ? `\n${failures} FAILURES` : '\nall tests passed')
process.exit(failures ? 1 : 0)
