/**
 * Spectre Newsroom — Original Analysis Agent
 * Generates unique Spectre AI market analysis/commentary articles.
 * These are NOT rewrites of RSS feeds — they are original AI-generated analysis.
 * Runs alongside the curator for a mix of sourced news + original content.
 */
const fetch = require('node-fetch');
const { saveArticle, listArticles } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const { getAgentState, incrementDailyCount, recordRun, getTopicIndex, setTopicIndex } = require('./agentState');
const { generateArticleImage } = require('./imageGenerator');
const { gatedPerplexitySearch } = require('./perplexityGate');
const { resolveKnownEntity } = require('./entityResolver');

const AGENT_NAME = 'spectre-analyst';
const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';

// ── ANALYSIS TOPICS (rotated each cycle) ──
const ANALYSIS_TOPICS = [
  {
    topic: 'Bitcoin Technical Analysis',
    prompt: 'Analyze Bitcoin\'s current price action, key support/resistance levels, and short-term outlook. Include specific price levels, volume trends, and any notable chart patterns forming. What should traders watch for in the next 24-48 hours?',
    category: 'bitcoin',
    tickers: ['BTC'],
  },
  {
    topic: 'Ethereum Ecosystem Update',
    prompt: 'Analyze Ethereum\'s current state including price action, network activity (gas fees, staking metrics), and any significant developments in the Ethereum ecosystem (L2 activity, DeFi TVL changes, upcoming upgrades). What\'s the short-term outlook?',
    category: 'ethereum',
    tickers: ['ETH'],
  },
  {
    topic: 'DeFi Market Pulse',
    prompt: 'Analyze the current state of DeFi: total TVL trends, top protocol performances, any notable yield changes, new protocol launches, or significant governance proposals. Which DeFi sectors are outperforming and why?',
    category: 'defi',
    tickers: ['UNI', 'AAVE', 'MKR'],
  },
  {
    topic: 'Crypto Market Sentiment Report',
    prompt: 'Analyze the overall crypto market sentiment right now. Cover the Fear & Greed Index, funding rates, open interest, whale movements, and social media trends. What does the data tell us about where the market is heading?',
    category: 'macro',
    tickers: ['BTC', 'ETH'],
  },
  {
    topic: 'Altcoin Movers & Shakers',
    prompt: 'Identify the top 3-5 altcoins making significant moves today. For each, explain what\'s driving the price action (partnerships, upgrades, listings, whale activity). Which altcoins have the most momentum right now?',
    category: 'layer1',
    tickers: ['SOL', 'AVAX', 'SUI'],
  },
  {
    topic: 'Regulation & Policy Watch',
    prompt: 'Summarize the most significant crypto regulatory developments from the past 48 hours. Cover SEC actions, congressional bills, international regulations, and any enforcement actions. How might these impact the market?',
    category: 'regulation',
    tickers: ['BTC'],
  },
  {
    topic: 'Exchange & Institutional Flows',
    prompt: 'Analyze recent institutional crypto activity: ETF inflows/outflows, exchange reserves, large wallet movements, and any notable institutional announcements. What does the smart money flow data reveal?',
    category: 'exchange',
    tickers: ['BTC', 'ETH'],
  },
  {
    topic: 'Layer 2 & Scaling Report',
    prompt: 'Analyze the current state of Layer 2 ecosystems. Compare TVL growth across major L2s (Arbitrum, Optimism, Base, zkSync, Starknet). Which L2s are gaining the most traction and why? Any notable dApp launches or ecosystem developments?',
    category: 'layer2',
    tickers: ['ARB', 'OP'],
  },
  {
    topic: 'AI & Crypto Convergence',
    prompt: 'Analyze the intersection of AI and crypto right now. Cover AI token performance, new AI-crypto projects, compute marketplace trends, and any significant partnerships between AI companies and blockchain projects.',
    category: 'ai',
    tickers: ['RENDER', 'FET'],
  },
  {
    topic: 'Stablecoin & Macro Liquidity',
    prompt: 'Analyze stablecoin supply trends (USDT, USDC market caps), stablecoin dominance, and what this signals about crypto market liquidity. Cover any macro economic factors (Fed policy, treasury yields) affecting crypto flows.',
    category: 'macro',
    tickers: ['BTC', 'ETH'],
  },
];

const SYSTEM_PROMPT = `You are Spectre AI's lead market analyst writing for The Spectre Edition — our flagship intelligence publication. Voice: a senior strategist at Goldman or Bridgewater explaining today's crypto market to a peer in their corner office. Authoritative, dry-eyed, data-first. You are NOT rewriting news. You are producing original Spectre analysis.

LENGTH: 1000-1400 words. Anything shorter feels like a tweet thread. Anything longer is bloat.

HEADLINE: do NOT use generic editorial templates ("X & Y", "X Crosswinds", "X Pulse: Trends and Insights"). The headline must name a specific subject and angle — a thesis, a number, a moving piece. Examples of acceptable shapes:
- "Why BTC's $76K Defence Matters More Than the F&G Print at 37"
- "Ethereum's Staking Yield Just Crossed 3.4%. Here's What Breaks at 4%."
- "ETF Outflows Hit $312M This Week. The Real Story Is Where the Money Went."
The headline should make a smart reader want to know what comes next.

STRUCTURE (use ## for the headline, no other subheadings):
1. Lede (60-100 words): the single most important thing in this piece. State the thesis. Anchor it with a specific number.
2. Context (3-4 paragraphs): build the argument with live data points. Prices, funding rates, TVL flows, OI, dominance shifts, volume signatures. Quote exact figures.
3. Counter (1-2 paragraphs): the strongest argument against your thesis. What would have to break for you to be wrong.
4. Spectre Take (2-3 sentences): the call. What we do with this — actionable, not hedging.

VOICE CONSTRAINTS:
- Write as "Spectre" or "our analysis." No first-person singular.
- Paragraphs max 4 sentences. Sentence-level rhythm: vary short and long.
- Bold tickers and key numbers: **BTC**, **$76,000**, **$2.62T**.
- No em-dashes anywhere. Use commas, colons, or new sentences.
- Do NOT place [1][2][3] citation markers in the body.
- Banned phrases: "delve into", "it's worth noting", "navigate", "landscape", "cutting-edge", "robust", "leverage" (as a verb), "seamlessly", "groundbreaking", "revolutionize", "transformative", "deep dive", "ever-evolving", "a testament to", "double-edged sword", "remains to be seen", "in today's", "pivotal", "realm", "moreover", "furthermore", "in conclusion", "as we navigate", "the crypto space".
- No disclaimers in the body. No "not financial advice". No hedging by formula ("could go either way").

ABSOLUTELY DO:
- Cite specific live numbers. Funding rates with two decimal places. Prices to the dollar. Volumes in USD billions.
- Name names. Specific tokens, specific exchanges, specific protocols.
- Be willing to be wrong. A strong wrong call is more useful than a vague right one.

CRITICAL: End with this EXACT structured footer (after the body, on its own lines):
SENTIMENT: bullish|bearish|neutral
CONFIDENCE: 1-10
CATEGORY: bitcoin|ethereum|defi|nft|regulation|exchange|stablecoin|layer1|layer2|gaming|ai|macro|general
TICKERS: BTC,ETH,SOL (comma-separated, uppercase, only relevant ones)`;

const VALID_SENTIMENTS = ['bullish', 'bearish', 'neutral'];
const VALID_CATEGORIES = [
  'bitcoin', 'ethereum', 'defi', 'nft', 'regulation', 'exchange',
  'stablecoin', 'layer1', 'layer2', 'gaming', 'ai', 'macro', 'general',
];

// ── RATE LIMITS (reduced from 8/2 → 4/1 to prevent content flood) ──
const MAX_PER_CYCLE = 1;  // 1 original article per cycle
const MAX_PER_DAY = 4;    // 4 original articles per day

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
  return `spectre-${base}-${ts}`;
}

/**
 * Generate an original Spectre AI analysis article.
 */
async function generateAnalysis(topicConfig) {
  const startTime = Date.now();

  logAgentActivity({
    agent: 'spectre-analyst',
    action: 'started',
    target: topicConfig.topic,
    targetType: 'news',
    title: `Generating: ${topicConfig.topic}`,
  });

  try {
    const userPrompt = `Write an original Spectre AI analysis article on this topic:

Topic: ${topicConfig.topic}
Focus: ${topicConfig.prompt}

Research the latest real-time data and provide original analysis. This is NOT a news rewrite — this is our own analyst report. Use current prices and data points. Remember the structured footer.`;

    // Pre-resolve known tickers from topic config
    const preResolved = (topicConfig.tickers || [])
      .map(t => resolveKnownEntity(t))
      .filter(e => e.confidence === 'confirmed');

    const gateResult = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      // 1000-1400 word target = ~1800 tokens of body + footer + slack.
      // Bumped from 2500 to 3200 so the model can actually finish without
      // being clipped mid-paragraph and dropping the structured footer.
      maxTokens: 3200,
      model: 'sonar-pro',
      agentId: 'spectre-analyst',
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

    if (!rawContent || rawContent.length < 100) {
      throw new Error('Empty or too-short response');
    }

    const parsed = parseFooter(rawContent);
    const content = parsed.content;
    const wordCount = content.split(/\s+/).length;

    // Extract headline
    const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
    const headline = firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '').slice(0, 140) || topicConfig.topic;

    const slug = generateSlug(headline);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const article = saveArticle({
      slug,
      type: 'news',
      title: `${headline} | Spectre AI Analysis`,
      headline,
      summary: content.replace(/[#*]/g, '').slice(0, 155).trim(),
      content,
      sentiment: parsed.sentiment,
      sentimentScore: parsed.sentimentScore,
      category: parsed.category || topicConfig.category,
      categories: [parsed.category || topicConfig.category],
      tickers: parsed.tickers.length > 0 ? parsed.tickers : topicConfig.tickers,
      tags: ['news', 'spectre-analysis', parsed.category || topicConfig.category],
      isBreaking: false,
      isFeatured: true, // Original analysis is always featured
      sourceArticle: {
        title: topicConfig.topic,
        url: null,
        source: 'Spectre AI',
        publishedAt: new Date().toISOString(),
      },
      expiresAt,
      sourcesCited: citations,
      model: data.model || 'sonar-pro',
      generationTimeMs: Date.now() - startTime,
      isOriginal: true, // Flag to distinguish from sourced articles
    });

    // Generate hero image in background (non-blocking)
    generateArticleImage(article).catch(() => {});

    logAgentActivity({
      agent: 'spectre-analyst',
      action: 'completed',
      target: parsed.tickers[0] || topicConfig.category,
      targetType: 'news',
      title: headline,
      wordCount,
      sourceCount: citations.length,
      generationTimeMs: Date.now() - startTime,
      slug,
    });

    console.log(`[spectre-analyst] Generated "${headline}" (${wordCount} words, ${parsed.sentiment}, ${Date.now() - startTime}ms)`);
    return article;
  } catch (e) {
    logAgentActivity({
      agent: 'spectre-analyst',
      action: 'failed',
      target: topicConfig.topic,
      targetType: 'news',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[spectre-analyst] Failed for "${topicConfig.topic}":`, e.message);
    return null;
  }
}

/**
 * Run an analysis cycle — generates 1 original article per cycle.
 */
async function runAnalysisCycle() {
  const state = getAgentState(AGENT_NAME);

  if (state.dailyCount >= MAX_PER_DAY) {
    console.log(`[spectre-analyst] Daily limit reached (${state.dailyCount}/${MAX_PER_DAY})`);
    return { skipped: true, reason: 'daily_limit' };
  }

  recordRun(AGENT_NAME);

  const startTime = Date.now();
  const remaining = MAX_PER_DAY - state.dailyCount;
  const thisRun = Math.min(MAX_PER_CYCLE, remaining);
  let topicIdx = getTopicIndex(AGENT_NAME);

  console.log(`[spectre-analyst] Starting analysis cycle (${thisRun} articles, daily: ${state.dailyCount}/${MAX_PER_DAY})`);

  const written = [];
  for (let i = 0; i < thisRun; i++) {
    const topic = ANALYSIS_TOPICS[topicIdx % ANALYSIS_TOPICS.length];
    topicIdx++;
    setTopicIndex(AGENT_NAME, topicIdx);

    const article = await generateAnalysis(topic);
    if (article) {
      written.push(article);
      incrementDailyCount(AGENT_NAME);
    }

    // 3s delay between articles
    if (i < thisRun - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const elapsed = Date.now() - startTime;
  const finalState = getAgentState(AGENT_NAME);
  console.log(`[spectre-analyst] Cycle complete: ${written.length}/${thisRun} articles in ${(elapsed / 1000).toFixed(0)}s (daily: ${finalState.dailyCount}/${MAX_PER_DAY})`);

  return {
    articlesWritten: written.length,
    dailyCount: finalState.dailyCount,
    elapsedMs: elapsed,
  };
}

function getAnalysisStats() {
  const state = getAgentState(AGENT_NAME);
  return {
    dailyCount: state.dailyCount,
    maxPerDay: MAX_PER_DAY,
    maxPerCycle: MAX_PER_CYCLE,
    topicIndex: state.topicIndex || 0,
    totalTopics: ANALYSIS_TOPICS.length,
    lastResetDate: state.lastResetDate,
    lastRunAt: state.lastRunAt,
  };
}

module.exports = { runAnalysisCycle, generateAnalysis, getAnalysisStats, ANALYSIS_TOPICS };
