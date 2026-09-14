/**
 * Spectre Intelligence — Trader Research Pipeline
 * Multi-step pipeline that replaces the single Perplexity call for deep research.
 * Step 0: Quick CG/price pass
 * Step 1: Determine source priorities
 * Step 2: Parallel data gathering (DeFiLlama, Reddit, GitHub, blog, X proxy)
 * Step 3: Compile dossier
 * Step 4: Generate thesis via Perplexity with full context
 * Step 5: Return structured data
 */
const fetch = require('node-fetch');

// Same as researchArticleAgent.js: this file guards on PERPLEXITY_API_KEY but
// never declared it, so the guard threw ReferenceError instead of reporting a
// missing key. The identifier only exists as a module-local const in index.js.
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

const {
  determineSourcePriority,
  fetchDeFiLlama,
  fetchCoinGeckoDeep,
  fetchCoinGeckoBasic,
  fetchRedditData,
  fetchGitHubData,
  fetchProjectBlog,
  compileDossier,
  withTimeout,
  FOUNDER_MAP,
} = require('./dataLayer');

const { gatedPerplexitySearch } = require('./perplexityGate');
const { resolveKnownEntity } = require('./entityResolver');


// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT LAW — SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const THESIS_SYSTEM_PROMPT = `You are a senior crypto analyst at Spectre AI.
You think like a trader deciding whether to allocate capital, not like a journalist writing a summary.

WRITING RULES (non-negotiable):
- NO em-dashes anywhere. Not in sentences, not in lists, not in headers. Use a period or rewrite the sentence.
- NO AI filler phrases. Banned: "delve into", "it's worth noting", "it is important to note", "at the intersection of", "robust", "leverage" (as a verb), "seamlessly", "groundbreaking", "revolutionize", "transformative", "navigate", "landscape", "cutting-edge", "deep dive", "unpack", "foster", "pivotal", "realm", "in today's", "ever-evolving", "multifaceted", "it is crucial", "as we move forward", "in conclusion", "to summarize", "the world of", "in the rapidly evolving", "a testament to".
- NO padding sentences. Every sentence must add a fact, number, or judgment.
- Paragraphs MAX 3 sentences. If it runs longer, split it.
- Section headers: short and direct. Max 5 words. "What It Is Today" is good. "The Evolving Landscape of RWA Tokenization" is bad.
- Pull quotes: any section with 3+ paragraphs gets one pull quote. Format: > "Data point or finding here." Pull quotes are facts with numbers, not opinions.

CITATION DISPLAY RULES:
- Inline [1][2][3] markers are BANNED from body text. They break reading flow.
- Write claims as standalone facts. The sources array handles attribution.
- Maximum 5 sources in the sources array. Return the 5 most distinct, most authoritative sources.

JOURNALISM RULES:
- NEVER predict price targets or market share percentages.
- NEVER guarantee outcomes.
- ALWAYS use conditional framing: "IF X delivers on Y, THEN Z could follow."
- ALWAYS present bull AND bear cases with equal rigor.

TRADER MINDSET:
- Lead with what matters RIGHT NOW. Not history, not vision.
- If there is breaking news (last 72h), lead with that.
- Price action context is mandatory.
- Social signals are primary data. What is the founder saying? Community sentiment?
- DeFiLlama numbers beat narrative. If TVL is declining, say it first.
- Risk flags go in the thesis body, not hidden at the bottom.

OUTPUT FORMAT (JSON):
Return valid JSON with this exact structure:
{
  "headline": "Short punchy headline (max 10 words)",
  "thesisAtGlance": "2-3 sentence punch line. A reader who reads NOTHING else gets the full picture.",
  "sections": [
    {
      "header": "What It Is Today",
      "content": "Full section text. No [1][2] markers. Clean prose."
    },
    {
      "header": "The Sector Opportunity",
      "content": "..."
    },
    {
      "header": "Competitive Landscape",
      "content": "Include a markdown comparison table here."
    },
    {
      "header": "The Bull Case",
      "content": "..."
    },
    {
      "header": "The Bear Case",
      "content": "..."
    },
    {
      "header": "Key Voices",
      "content": "Real quotes with attribution. Skip if none found."
    },
    {
      "header": "What They Need to Execute",
      "content": "..."
    },
    {
      "header": "Spectre Verdict",
      "content": "Balanced assessment. 3 things to watch."
    }
  ],
  "riskLevel": "high|medium|low",
  "sentiment": "bullish|bearish|neutral",
  "confidence": 7,
  "tickers": ["BTC", "ETH"],
  "category": "rwa",
  "sources": [
    { "url": "https://...", "title": "Source title", "type": "data|news|official|social" }
  ]
}`;


// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * runTraderResearchPipeline — Full multi-step research pipeline.
 * @param {string} query - User's search query
 * @param {string} symbol - Token symbol (e.g., 'ZIG', 'NEURAL')
 * @param {object} opts - { maxTimeMs, skipSources }
 * @returns {object} Full research result with thesis, dossier, sources
 */
async function runTraderResearchPipeline(query, symbol, opts = {}) {
  const startTime = Date.now();
  const maxTime = opts.maxTimeMs || 45000; // 45s total budget

  console.log(`[pipeline] Starting research for ${symbol}: "${query}"`);

  // ── STEP 0: QUICK INITIAL PASS (2-3s) ──
  const [quickCG, quickPrice] = await Promise.allSettled([
    withTimeout(fetchCoinGeckoBasic(symbol), 8000),
    // Use CoinGecko data for price as well (single call)
    Promise.resolve(null),
  ]);

  const cgData = quickCG.value || {};

  const context = {
    symbol,
    projectName: cgData.name || symbol,
    marketCap: cgData.marketCap || 0,
    change24h: cgData.change24h || 0,
    change7d: cgData.change7d || 0,
    volume24h: cgData.volume24h || 0,
    ageInDays: cgData.launchDate
      ? Math.floor((Date.now() - new Date(cgData.launchDate)) / 86400000)
      : 999,
    isDefi: cgData.categories?.some(c =>
      /defi|dex|lending|yield|staking|amm/i.test(c)
    ) || false,
    categories: cgData.categories || [],
    hasBreakingNews: false,
    founderHandle: FOUNDER_MAP[symbol.toUpperCase()] || null,
    githubUrl: cgData.repos_url?.github?.[0] || null,
    blogUrl: cgData.blog_url?.[0] || null,
  };

  console.log(`[pipeline] Context: ${context.projectName}, $${(context.marketCap / 1e6).toFixed(1)}M mcap, ${context.change24h?.toFixed(1)}% 24h`);

  // ── STEP 1: DETERMINE SOURCE PRIORITIES ──
  const sourcePriorities = determineSourcePriority(context);
  console.log(`[pipeline] Priorities: ${sourcePriorities.map(p => `${p.source}:${p.weight}`).join(', ')}`);

  // Helper to check if a source should be fetched
  const shouldFetch = (source) => {
    const p = sourcePriorities.find(x => x.source === source);
    return p && ['CRITICAL', 'HIGH', 'ALWAYS'].includes(p.weight);
  };
  const mayFetch = (source) => {
    const p = sourcePriorities.find(x => x.source === source);
    return p && p.weight === 'MEDIUM';
  };

  // ── STEP 2: PARALLEL DATA GATHERING ──
  const [defiData, onChainData, redditData, githubData, blogData] = await Promise.allSettled([
    // DeFiLlama
    shouldFetch('DEFILLAMA')
      ? withTimeout(fetchDeFiLlama(symbol), 10000)
      : Promise.resolve({ available: false, skipped: true }),

    // CoinGecko deep
    withTimeout(fetchCoinGeckoDeep(symbol), 10000),

    // Reddit
    shouldFetch('REDDIT') || mayFetch('REDDIT')
      ? withTimeout(fetchRedditData(symbol, context.projectName), 10000)
      : Promise.resolve({ available: false, skipped: true }),

    // GitHub
    shouldFetch('GITHUB') || mayFetch('GITHUB')
      ? withTimeout(fetchGitHubData(symbol, context.projectName), 10000)
      : Promise.resolve({ available: false, skipped: true }),

    // Blog
    shouldFetch('MEDIUM') || mayFetch('MEDIUM')
      ? withTimeout(fetchProjectBlog(symbol, context.projectName), 10000)
      : Promise.resolve({ available: false, skipped: true }),
  ]);

  const elapsed1 = Date.now() - startTime;
  console.log(`[pipeline] Data gathering complete in ${(elapsed1 / 1000).toFixed(1)}s`);

  // ── STEP 3: COMPILE DOSSIER ──
  const dossier = compileDossier({
    context,
    sourcePriorities,
    xData: { status: 'fulfilled', value: {} }, // X data comes from Perplexity below
    webNews: { status: 'fulfilled', value: [] }, // News comes from Perplexity below
    defiData,
    onChainData,
    priceData: { status: 'fulfilled', value: cgData },
    redditData,
    githubData,
    blogData,
  });

  // ── STEP 4: GENERATE THESIS (Perplexity with full context) ──
  const thesis = await generateThesisWithDossier(dossier, query, symbol);

  const totalElapsed = Date.now() - startTime;
  console.log(`[pipeline] Complete in ${(totalElapsed / 1000).toFixed(1)}s`);

  // ── STEP 5: RETURN STRUCTURED DATA ──
  return {
    thesis,
    dossier,
    sourcePriorities: sourcePriorities
      .filter(p => p.weight !== 'SKIP')
      .map(p => ({ source: p.source, weight: p.weight, reason: p.reason })),
    riskFlags: dossier.riskFlags,
    pipelineMetrics: {
      totalTimeMs: totalElapsed,
      dataGatheringMs: elapsed1,
      sourcesUsed: sourcePriorities.filter(p => ['CRITICAL', 'HIGH', 'ALWAYS'].includes(p.weight)).length,
      sourcesSkipped: sourcePriorities.filter(p => p.weight === 'SKIP').length,
    },
  };
}


/**
 * Generate thesis using Perplexity with the full dossier as context.
 */
async function generateThesisWithDossier(dossier, query, symbol) {
  if (!PERPLEXITY_API_KEY) {
    return { error: 'PERPLEXITY_API_KEY not set', content: 'API key not configured.' };
  }

  // Build context string from dossier
  const contextParts = [];

  // Price
  if (dossier.price?.current) {
    contextParts.push(`PRICE: $${dossier.price.current} | 24h: ${dossier.price.change24h?.toFixed(1)}% | 7d: ${dossier.price.change7d?.toFixed(1)}% | MCap: $${((dossier.price.marketCap || 0) / 1e6).toFixed(1)}M | Vol: $${((dossier.price.volume24h || 0) / 1e6).toFixed(1)}M`);
  }

  // Supply
  if (dossier.supply?.ratio) {
    contextParts.push(`SUPPLY: ${(dossier.supply.ratio * 100).toFixed(0)}% circulating (${dossier.supply.circulating?.toLocaleString()} / ${dossier.supply.total?.toLocaleString()})`);
  }

  // ATH
  if (dossier.price?.ath) {
    contextParts.push(`ATH: $${dossier.price.ath} (${dossier.price.athDrawdown?.toFixed(0)}% from ATH)`);
  }

  // DeFi data
  if (dossier.defi?.tvl) {
    contextParts.push(`DEFILLAMA: TVL $${(dossier.defi.tvl / 1e6).toFixed(1)}M | 7d: ${dossier.defi.tvlTrend || 'N/A'}% | Chains: ${dossier.defi.chains?.join(', ') || 'N/A'}`);
  }

  // GitHub
  if (dossier.github?.available) {
    contextParts.push(`GITHUB: ${dossier.github.activityStatus} (last commit ${dossier.github.daysSinceLastCommit}d ago) | ${dossier.github.stars} stars | ${dossier.github.contributorCount} contributors | ${dossier.github.repoUrl}`);
  }

  // Reddit
  if (dossier.reddit?.available !== false && dossier.reddit?.topPosts?.length > 0) {
    const posts = dossier.reddit.topPosts.slice(0, 3).map(p => `"${p.title}" (${p.score} pts, r/${p.subreddit})`).join('; ');
    contextParts.push(`REDDIT: Sentiment ${dossier.reddit.sentiment} | Red flags: ${dossier.reddit.redFlagCount} | Top posts: ${posts}`);
  }

  // Blog
  if (dossier.blog?.available && dossier.blog?.recentPosts?.length > 0) {
    const recent = dossier.blog.recentPosts[0];
    contextParts.push(`BLOG: ${recent.title} (${recent.date}) ${recent.url || ''}`);
  }

  // Social
  if (dossier.social?.twitterFollowers) {
    contextParts.push(`SOCIAL: ${(dossier.social.twitterFollowers / 1000).toFixed(0)}k Twitter followers | Founder: ${dossier.social.founderHandle || 'Unknown'}`);
  }

  // Risk flags
  if (dossier.riskFlags?.length > 0) {
    contextParts.push(`RISK FLAGS:\n${dossier.riskFlags.map(f => `- ${f}`).join('\n')}`);
  }

  // Exchanges
  if (dossier.exchanges?.length > 0) {
    contextParts.push(`EXCHANGES: ${dossier.exchanges.slice(0, 5).map(e => e.name).join(', ')}`);
  }

  // Description
  if (dossier.description) {
    contextParts.push(`DESCRIPTION: ${dossier.description.slice(0, 300)}`);
  }

  const dossierText = contextParts.join('\n\n');

  const userPrompt = `Research query: "${query}"
Token: $${symbol}

I have already gathered the following data from multiple sources. Use this as your primary data context. Search for additional recent news, founder activity, and competitive analysis to supplement.

=== RESEARCH DOSSIER ===
${dossierText}
========================

Write a comprehensive thesis using the JSON output format specified in your instructions. Include comparison tables where relevant. Search for real quotes from founders and analysts.

CRITICAL: Use the data I provided (DeFiLlama TVL, GitHub activity, Reddit sentiment, exchange data) as concrete evidence in your thesis. Do not ignore this data.`;

  try {
    // Pre-resolve the known entity for disambiguation
    const preResolved = resolveKnownEntity(symbol);
    const gateResult = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: THESIS_SYSTEM_PROMPT,
      maxTokens: 4000,
      model: 'sonar-pro',
      agentId: 'trader-pipeline',
      timeout: 60000,
      searchContextSize: 'high',
      resolvedEntities: preResolved.confidence === 'confirmed' ? [preResolved] : undefined,
    });

    if (!gateResult || gateResult.type === 'ERROR') {
      throw new Error(gateResult?.error || 'All AI providers failed');
    }

    const rawContent = gateResult.content || '';
    const citations = gateResult.citations || [];

    // Try to parse as JSON
    let parsed = null;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent.trim();
      parsed = JSON.parse(jsonStr);
    } catch (_) {
      // Fallback: return raw content as a single section
      parsed = {
        headline: query,
        thesisAtGlance: rawContent.slice(0, 200),
        content: rawContent,
        sections: [{ header: 'Analysis', content: rawContent }],
        sources: citations.map(url => ({ url, title: new URL(url).hostname, type: 'web' })),
      };
    }

    // Merge Perplexity citations with dossier sources
    if (parsed.sources) {
      const existingUrls = new Set(parsed.sources.map(s => s.url));
      for (const url of citations) {
        if (!existingUrls.has(url)) {
          parsed.sources.push({ url, title: new URL(url).hostname, type: 'web' });
        }
      }
      // Limit to 5 most important
      parsed.sources = parsed.sources.slice(0, 5);
    }

    return parsed;
  } catch (e) {
    console.error(`[pipeline] Thesis generation failed:`, e.message);
    return {
      error: e.message,
      headline: `${symbol} Research`,
      thesisAtGlance: 'Research generation failed. Please try again.',
      sections: [],
      sources: [],
    };
  }
}


module.exports = {
  runTraderResearchPipeline,
  generateThesisWithDossier,
  THESIS_SYSTEM_PROMPT,
};
