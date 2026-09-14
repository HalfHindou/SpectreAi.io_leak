/**
 * Spectre Intelligence — Research Article Agent
 * Generates deep-dive, thesis-driven research articles (1500-2500 words).
 * Uses institutional methodology: Data → Patterns → Thesis → Value Chain → Catalysts → Verdict.
 * NOT short commentary — these are proper research reports.
 */
const fetch = require('node-fetch');
const { saveArticle } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const { getAgentState, incrementDailyCount, recordRun, getTopicIndex, setTopicIndex } = require('./agentState');
const { generateArticleImage } = require('./imageGenerator');
const { gatedPerplexitySearch } = require('./perplexityGate');
const { resolveKnownEntity } = require('./entityResolver');

// This file guards on PERPLEXITY_API_KEY but never declared it - the identifier
// only exists as a module-local const inside index.js, so the guard threw
// ReferenceError instead of reporting a missing key. Same convention as there.
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

const AGENT_NAME = 'spectre-research';

// ── RESEARCH QUEUE (rotated each cycle) ──
const RESEARCH_QUEUE = [
  {
    topic: 'ZigChain ($ZIG): Can It Compete in the RWA Infrastructure Race?',
    prompt: 'Balanced deep-dive on ZigChain (ZIG) and its positioning in the RWA sector. Cover: what ZigChain actually does TODAY (Cosmos SDK L1, rebranded from Zignaly, delegated investment protocols), its RWA ambitions (private credit distribution, tokenized asset infrastructure), and critically — how it stacks up against established competitors (Ondo, Centrifuge, Maple, Mantle, Polymesh). The broader RWA context: Top 20 RWA assets are 80% tokenized funds, first wave is boring/safe assets building institutional trust. Where does ZigChain fit in this value chain vs competitors who already have TVL and institutional partnerships? What does the team need to execute on (mainnet traction, TVL growth, real integrations)? What are the bear case risks (small market cap, unproven L1, competition from bigger chains)? Cover both why it COULD succeed and why it might NOT. Do not make price predictions.',
    category: 'rwa',
    tickers: ['ZIG'],
  },
  {
    topic: 'RWA Tokenization: Who Wins the First Wave?',
    prompt: 'Balanced analysis of Real World Asset tokenization. The first wave = tokenized treasuries, money market funds, private credit — boring, safe, institutional-grade. This builds trust infrastructure before an innovation wave. Map the value chain: asset originators → tokenization infrastructure → distribution → end users. Compare protocols head-to-head: Ondo (tokenized treasuries, $TVL, partnerships), Centrifuge (real-world credit), Maple (institutional lending), BlackRock BUIDL (the 800-lb gorilla). For each: what is working, what is not, what are the risks? Where does RWA sit on the adoption S-curve? What specific barriers remain for early majority adoption? Cover both the bull case (trillions in addressable market) and the bear case (regulatory uncertainty, custody complexity, limited demand).',
    category: 'rwa',
    tickers: ['ONDO', 'CFG', 'MPL'],
  },
  {
    topic: 'AI x Crypto: Real Value or Pure Narrative?',
    prompt: 'Honest analysis of the AI-crypto intersection. Map the compute value chain: GPU owners → compute aggregators → inference routers → application layer. For each project analyze what is LIVE vs PLANNED: Render Network (GPU rendering), Akash (decentralized cloud), Bittensor (AI model marketplace), io.net (GPU aggregation). Critical question: does decentralized compute actually compete with AWS/Azure on price, reliability, latency? Or is the token premium purely narrative? Cover bull case (censorship resistance, cost efficiency at scale) and bear case (centralized alternatives are faster/cheaper, adoption is minimal, tokens don\'t capture value). What would need to change for this sector to matter?',
    category: 'ai',
    tickers: ['RENDER', 'AKT', 'TAO'],
  },
  {
    topic: 'DePIN: Real Revenue or Token-Subsidized Theater?',
    prompt: 'Critical analysis of Decentralized Physical Infrastructure Networks. For each major DePIN, separate real economic activity from token-subsidized usage: Helium (wireless — how much real carrier demand vs speculative mining?), Hivemapper (mapping — who actually buys the data?), DIMO (vehicle data — real enterprise customers?), Geodnet (geospatial — accuracy vs centralized alternatives?). Unit economics: what does a node operator actually earn? Is the yield from real demand or token inflation? Compare to TradFi infrastructure REITs. Cover the bull case (crowdsourced infrastructure scales faster) and the bear case (demand doesn\'t materialize, token incentives are unsustainable). What separates real DePIN from vaporware?',
    category: 'defi',
    tickers: ['HNT', 'HONEY', 'DIMO'],
  },
  {
    topic: 'Layer 2 Economics: Do L2 Tokens Actually Accrue Value?',
    prompt: 'Critical analysis of the L2 value capture problem. Post-EIP-4844 blob economics have crushed sequencer margins. Compare revenue data: Arbitrum (largest by TVL), Optimism (Superchain thesis), Base (Coinbase distribution, no token), Starknet (ZK approach), zkSync. Key questions: If transaction fees approach zero, where does value live? Does the L2 token capture ecosystem growth, or does value leak to ETH L1 and applications? Is Base (no token, Coinbase subsidized) the model that actually wins? Cover bull case (network effects, governance value, ecosystem growth) and bear case (margin compression, token not needed, ETH captures all value). What would change the thesis?',
    category: 'layer2',
    tickers: ['ARB', 'OP'],
  },
  {
    topic: 'Stablecoin Wars: Who Captures the Trillion-Dollar Flow?',
    prompt: 'Analysis of stablecoins as crypto\'s most profitable sector and the competitive dynamics shaping it. Compare head-to-head: Tether (USDT) profitability and regulatory risk, Circle (USDC) institutional positioning but margin pressure, Ethena (USDe) synthetic approach and depegging risks, MakerDAO (DAI) decentralized model, PayPal (PYUSD) TradFi entry threat. For each: revenue model, regulatory exposure, competitive moat, biggest risk. Apply TradFi parallel: stablecoin issuers = money market funds. Bull case: trillions in addressable market. Bear case: regulation could reshape the entire sector overnight. Which models survive regulatory scrutiny and which don\'t?',
    category: 'stablecoin',
    tickers: ['ENA', 'MKR'],
  },
];

// ── SYSTEM PROMPT — INSTITUTIONAL RESEARCH METHODOLOGY ──
const SYSTEM_PROMPT = `You are Spectre AI's head of research. Write deep-dive thesis articles with full journalistic integrity. You are producing institutional-grade research — balanced, rigorous, and honest. Never shill. Never make price predictions. Present all sides.

JOURNALISM RULES (non-negotiable):
- NEVER predict price targets, market caps, or market share percentages
- NEVER guarantee outcomes ("will capture X%", "will reach $Y")
- ALWAYS present bull AND bear cases with equal rigor
- ALWAYS cover direct competitors and what advantages they hold
- ALWAYS identify what the project must EXECUTE ON to succeed — not assume they will
- Use conditional framing: "IF the team delivers X, THEN Y becomes possible, BECAUSE Z"
- Distinguish between what EXISTS today (verified) vs what is PLANNED (speculative)
- If data is missing or unverifiable, say so explicitly — don't fill gaps with optimism

OUTPUT STRUCTURE (follow this EXACTLY):

## [Headline]

> **THESIS AT A GLANCE:** [2-3 sentence punch line summarizing the entire thesis — what the project is betting on, the key risk, and the bottom line. A reader who reads NOTHING else should get the full picture from this.]

**What It Is Today**
What does the project actually do today? Not the roadmap — what is live, working, measurable? Current TVL, users, transaction volume, revenue if any. Be honest about what's real vs what's promised.

**The Sector Opportunity**
Zoom out. What is the macro opportunity? Size the market with real data. Where is this sector on the adoption curve? What does the first wave look like (boring, safe, institutional) vs the innovation wave?

**Competitive Landscape**
Who are the direct competitors? REQUIRED: Include a markdown comparison table:

| Protocol | TVL | Market Cap | Key Differentiator | Risk Level |
|----------|-----|-----------|-------------------|------------|
| **Name** | $X | $Y | Description | High/Med/Low |

Be specific. Name names. Include protocols with stronger positions and explain why.

**The Bull Case**
What needs to go RIGHT for this to succeed? What are the genuine strengths? Unique positioning, technical moats, partnerships, team track record. Use conditional language: "If X executes on Y, this positions them to Z."

**The Bear Case**
What can go WRONG? Execution risks, competition threats, regulatory exposure, tokenomics concerns, team red flags, low liquidity, unproven tech. Be as thorough here as the bull case. Intellectual honesty is the product.

**Key Voices**
Search for and quote relevant figures — founders, VCs, analysts, industry leaders. Use blockquote format:
> "Quote text here" — Person Name, Title ([source](URL))
Include 2-3 real quotes with attribution and source links. If no real quotes are findable, skip this section entirely — do NOT fabricate quotes.

**What They Need to Execute**
Specific milestones the project must hit. TVL targets, mainnet deliverables, partnership pipeline, ecosystem growth metrics. What does the roadmap look like and what's realistic vs ambitious?

**Value Chain Position**
Where does this project sit in the value chain? Infrastructure → middleware → applications → end users. Does the token actually capture the value being created, or does value leak elsewhere?

**Spectre Verdict**
Balanced assessment. Not "buy" or "sell" — instead: what type of investor/risk profile does this suit? What would make us more bullish? What would make us more bearish? 3 specific things to watch over the next 6 months.

CROSS-SECTOR LENS: Connect crypto narratives to TradFi parallels where relevant.
- RWA = tokenized securities market
- DeFi lending = shadow banking
- L2s = payment rails / clearing houses
- Stablecoins = money market funds
- DePIN = crowdsourced infrastructure REITs

SOURCE DIVERSITY: Cite official project docs, Twitter/X accounts, DeFiLlama, CoinGecko, founder interviews, and reputable news outlets. Aim for diverse source types. Maximum 5 sources per article. Return the 5 most distinct, most authoritative sources.

CITATION DISPLAY RULES:
- Do NOT place [1][2][3] footnote markers inside body text. The body must read as clean prose without inline citation markers.
- Claims are written as plain factual sentences. The sources array handles attribution separately.
- The frontend displays sources in a Sources panel, not inline.

CONTENT LAW (non-negotiable):
- NO em-dashes anywhere. Not in sentences, not in lists, not in headers. If a sentence needs one, split it into two sentences or use a comma/colon.
- Paragraphs: maximum 3 sentences. If it runs longer, split it.
- Every sentence earns its place. No throat-clearing, no filler.
- Pull quotes: any section with 3+ paragraphs gets one blockquote with a striking data point. Format: > "Data point here."
- Section headers: max 5 words. No gerunds. No "The X of Y" constructions.
- Banned phrases (rewrite if any appear): "delve into", "it's worth noting", "it is important to note", "at the intersection of", "robust", "leverage" (as a verb), "seamlessly", "groundbreaking", "revolutionize", "transformative", "navigate", "landscape", "cutting-edge", "deep dive", "unpack", "foster", "pivotal", "realm", "in today's", "ever-evolving", "multifaceted", "it is crucial", "as we move forward", "in conclusion", "to summarize", "the world of", "in the rapidly evolving", "a testament to", "double-edged sword", "cautiously optimistic", "bears watching", "only time will tell", "remains to be seen", "a mixed bag", "sending shockwaves".

VOICE & STYLE:
- Write as "Spectre AI Research". Authoritative but intellectually honest
- 1500-2500 words, deeply researched
- Bold key tickers like **BTC**, **ETH** for emphasis
- Use ## for the main headline only
- Use **bold section headers** for all other sections (not ## or ###)
- Every claim needs a data point or a caveat
- The > **THESIS AT A GLANCE:** blockquote must be the FIRST thing after the headline

ABSOLUTELY DO NOT:
- Make price predictions or market cap forecasts
- Claim a project "will" achieve something. Use "could" or "is positioned to, if"
- Write one-sided puff pieces. Every bull point needs a counter-risk
- Fabricate statistics, quotes, or extrapolate numbers you don't have
- Assume roadmap items will be delivered on time
- Use hype language ("revolutionary", "game-changing", "moon")
- Pad with filler. Every sentence should carry information
- Use ### subheadings. Use **bold text** for section headers
- Use em-dashes anywhere in the output
- Place [1][2][3] citation markers in body text

CRITICAL: End with this EXACT structured footer:
SENTIMENT: bullish|bearish|neutral
CONFIDENCE: 1-10
CATEGORY: bitcoin|ethereum|defi|nft|regulation|exchange|stablecoin|layer1|layer2|gaming|ai|macro|rwa|general
TICKERS: BTC,ETH,SOL (comma-separated, uppercase, only relevant ones)`;

const VALID_SENTIMENTS = ['bullish', 'bearish', 'neutral'];
const VALID_CATEGORIES = [
  'bitcoin', 'ethereum', 'defi', 'nft', 'regulation', 'exchange',
  'stablecoin', 'layer1', 'layer2', 'gaming', 'ai', 'macro', 'rwa', 'general',
];

// ── RATE LIMITS ──
const MAX_PER_CYCLE = 1;  // 1 deep research article per cycle
const MAX_PER_DAY = 3;    // 3 research articles per day max

function parseFooter(rawContent) {
  const lines = rawContent.split('\n');
  const result = {
    content: rawContent,
    sentiment: 'neutral',
    sentimentScore: 5,
    category: 'general',
    tickers: [],
  };

  const footerStart = Math.max(0, lines.length - 10);
  let contentEndIdx = lines.length;

  for (let i = footerStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^SENTIMENT:\s*/i.test(line)) {
      const val = line.replace(/^SENTIMENT:\s*/i, '').trim().toLowerCase();
      if (VALID_SENTIMENTS.includes(val)) result.sentiment = val;
      if (contentEndIdx === lines.length) contentEndIdx = i;
    } else if (/^CONFIDENCE:\s*/i.test(line)) {
      const val = parseInt(line.replace(/^CONFIDENCE:\s*/i, '').trim());
      if (val >= 1 && val <= 10) result.sentimentScore = val;
      if (contentEndIdx === lines.length) contentEndIdx = i;
    } else if (/^CATEGORY:\s*/i.test(line)) {
      const val = line.replace(/^CATEGORY:\s*/i, '').trim().toLowerCase();
      if (VALID_CATEGORIES.includes(val)) result.category = val;
      if (contentEndIdx === lines.length) contentEndIdx = i;
    } else if (/^TICKERS:\s*/i.test(line)) {
      const val = line.replace(/^TICKERS:\s*/i, '').trim();
      result.tickers = val.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      if (contentEndIdx === lines.length) contentEndIdx = i;
    }
  }

  if (contentEndIdx < lines.length) {
    while (contentEndIdx > 0 && lines[contentEndIdx - 1].trim() === '') contentEndIdx--;
    result.content = lines.slice(0, contentEndIdx).join('\n').trim();
  }

  return result;
}

function generateSlug(headline) {
  const base = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
  const ts = Date.now().toString(36).slice(-4);
  return `research-${base}-${ts}`;
}

/**
 * Generate a deep-dive research article.
 */
async function generateResearchArticle(topicConfig) {
  const startTime = Date.now();

  logAgentActivity({
    agent: 'spectre-research',
    action: 'started',
    target: topicConfig.topic,
    targetType: 'research',
    title: `Generating research: ${topicConfig.topic}`,
  });

  try {
    if (!PERPLEXITY_API_KEY) {
      throw new Error('PERPLEXITY_API_KEY not set');
    }

    const userPrompt = `Write a balanced Spectre AI Research article:

Topic: ${topicConfig.topic}
Research Brief: ${topicConfig.prompt}

CRITICAL RULES:
- NO price predictions, market cap forecasts, or market share claims
- Cover BOTH bull and bear cases with equal depth
- Name competitors and compare honestly — don't assume this project wins
- Separate what EXISTS today from what is PLANNED
- Use conditional language ("could", "if they execute", "positioned to") not certainties
- Every strength you mention must have a corresponding risk or caveat
- If data is missing, say "data not available" — don't fabricate

REQUIRED ELEMENTS:
1. Start with > **THESIS AT A GLANCE:** blockquote immediately after the ## headline
2. Include at least ONE markdown comparison table in the Competitive Landscape section
3. Include a **Key Voices** section with real quotes from founders, VCs, or analysts (with [source](URL) links). If none found, skip the section — do NOT fabricate quotes.
4. Do NOT place [1][2][3] citation markers in body text. Write claims as clean prose. Sources are handled separately.

Research the latest real-time data thoroughly:
- Search DeFiLlama for TVL data, CoinGecko/CoinMarketCap for market caps and pricing
- Search for the project's FOUNDERS by name — who leads this, what's their background?
- Search for latest news articles, announcements, and founder interviews from the past 30 days
- Search official project documentation, Twitter/X accounts, and blog posts
- If specific data (TVL, revenue, users) is NOT publicly available, explicitly state "data not publicly available" — never guess or leave blank

Use specific numbers and cite sources with [N] notation. Target 1500-2500 words.

Remember the structured footer at the end.`;

    // Pre-resolve known tickers from topic config
    const preResolved = (topicConfig.tickers || [])
      .map(t => resolveKnownEntity(t))
      .filter(e => e.confidence === 'confirmed');

    const gateResult = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 6000,
      model: 'sonar-pro',
      agentId: 'research-article',
      timeout: 90000,
      searchContextSize: 'high',
      resolvedEntities: preResolved.length > 0 ? preResolved : undefined,
      skipResolution: preResolved.length === 0,
    });

    if (!gateResult || gateResult.type === 'ERROR') {
      throw new Error(gateResult?.error || 'All AI providers failed');
    }

    const rawContent = gateResult.content || '';
    const citations = gateResult.citations || [];
    const data = { model: gateResult.model };

    if (!rawContent || rawContent.length < 200) {
      throw new Error('Empty or too-short response');
    }

    const parsed = parseFooter(rawContent);
    const content = parsed.content;
    const wordCount = content.split(/\s+/).length;

    // Extract headline
    const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
    const headline = firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '').slice(0, 140) || topicConfig.topic;

    const slug = generateSlug(headline);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72h expiry

    const article = saveArticle({
      slug,
      type: 'research',
      title: `${headline} | Spectre AI Research`,
      headline,
      summary: content.replace(/[#*]/g, '').slice(0, 155).trim(),
      content,
      sentiment: parsed.sentiment,
      sentimentScore: parsed.sentimentScore,
      category: parsed.category || topicConfig.category,
      categories: [parsed.category || topicConfig.category],
      tickers: parsed.tickers.length > 0 ? parsed.tickers : topicConfig.tickers,
      tags: ['research', 'thesis', parsed.category || topicConfig.category],
      isBreaking: false,
      isFeatured: true,
      sourceArticle: {
        title: topicConfig.topic,
        url: null,
        source: 'Spectre AI Research',
        publishedAt: new Date().toISOString(),
      },
      expiresAt,
      sourcesCited: citations,
      model: data.model || 'sonar-pro',
      generationTimeMs: Date.now() - startTime,
      isOriginal: true,
      isResearch: true, // Flag for research-specific filtering
    });

    // Generate hero image in background (non-blocking)
    generateArticleImage(article).then(heroPath => {
      if (heroPath) {
        console.log(`[research] Hero image: ${heroPath}`);
      }
    }).catch(e => {
      console.warn(`[research] Hero image failed: ${e.message}`);
    });

    logAgentActivity({
      agent: 'spectre-research',
      action: 'completed',
      target: parsed.tickers[0] || topicConfig.category,
      targetType: 'research',
      title: headline,
      wordCount,
      sourceCount: citations.length,
      generationTimeMs: Date.now() - startTime,
      slug,
    });

    console.log(`[spectre-research] Generated "${headline}" (${wordCount} words, ${parsed.sentiment}, ${Date.now() - startTime}ms)`);
    return article;
  } catch (e) {
    logAgentActivity({
      agent: 'spectre-research',
      action: 'failed',
      target: topicConfig.topic,
      targetType: 'research',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[spectre-research] Failed for "${topicConfig.topic}":`, e.message);
    return null;
  }
}

/**
 * Run a research cycle — generates 1 deep research article per cycle.
 */
async function runResearchCycle() {
  const state = getAgentState(AGENT_NAME);

  if (state.dailyCount >= MAX_PER_DAY) {
    console.log(`[spectre-research] Daily limit reached (${state.dailyCount}/${MAX_PER_DAY})`);
    return { skipped: true, reason: 'daily_limit' };
  }

  recordRun(AGENT_NAME);

  const startTime = Date.now();
  const remaining = MAX_PER_DAY - state.dailyCount;
  const thisRun = Math.min(MAX_PER_CYCLE, remaining);
  let topicIdx = getTopicIndex(AGENT_NAME);

  console.log(`[spectre-research] Starting research cycle (${thisRun} article, daily: ${state.dailyCount}/${MAX_PER_DAY})`);

  const written = [];
  for (let i = 0; i < thisRun; i++) {
    const topic = RESEARCH_QUEUE[topicIdx % RESEARCH_QUEUE.length];
    topicIdx++;
    setTopicIndex(AGENT_NAME, topicIdx);

    const article = await generateResearchArticle(topic);
    if (article) {
      written.push(article);
      incrementDailyCount(AGENT_NAME);
    }
  }

  const elapsed = Date.now() - startTime;
  const finalState = getAgentState(AGENT_NAME);
  console.log(`[spectre-research] Cycle complete: ${written.length}/${thisRun} articles in ${(elapsed / 1000).toFixed(0)}s (daily: ${finalState.dailyCount}/${MAX_PER_DAY})`);

  return {
    articlesWritten: written.length,
    dailyCount: finalState.dailyCount,
    elapsedMs: elapsed,
  };
}

function getResearchStats() {
  const state = getAgentState(AGENT_NAME);
  return {
    dailyCount: state.dailyCount,
    maxPerDay: MAX_PER_DAY,
    maxPerCycle: MAX_PER_CYCLE,
    topicIndex: state.topicIndex || 0,
    totalTopics: RESEARCH_QUEUE.length,
    lastResetDate: state.lastResetDate,
    lastRunAt: state.lastRunAt,
  };
}

module.exports = { runResearchCycle, generateResearchArticle, getResearchStats, RESEARCH_QUEUE };
