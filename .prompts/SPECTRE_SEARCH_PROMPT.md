# SPECTRE SEARCH — Implementation Prompt

> **Paste into Claude Code. Build a research-grade search engine inside the Spectre AI app powered by Perplexity Sonar Pro API. This is not a chatbot. This is a financial intelligence search engine that returns structured, actionable research for any crypto token, stock, wallet, or market question.**

---

## WHAT THIS IS

Spectre Search is a unified search interface inside the Spectre AI app. One search bar. You type anything — a ticker, a question, a wallet address, a thesis — and Spectre returns institutional-grade research grounded in real-time web data via Perplexity's Sonar Pro API, enriched with Spectre's own backend data (prices, charts, fundamentals, on-chain).

This is the Google of crypto and stock research. But instead of 10 blue links, you get a synthesized intelligence brief with live data cards embedded.

---

## STEP 0: READ BEFORE BUILDING

```bash
# Read the design system
cat DESIGN_SYSTEM.md | head -100
cat src/index.css | head -80

# Read existing search/whisper implementation
grep -n "whisper\|search" server/index.js | head -30
cat src/components/Header.jsx | head -50

# Check if Perplexity key exists
grep -n "PERPLEXITY\|PPLX\|SONAR" server/index.js .env .env.example 2>/dev/null

# Understand the existing page structure
cat src/constants/pageRoutes.js
ls src/pages/
```

Read `SPECTRE_DESIGN_LAW.md` in `.cursor/rules/` before writing any UI code.

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────┐
│                    SPECTRE SEARCH PAGE                       │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Search Bar (unified input)                           │  │
│  │  "Search tokens, ask questions, or paste an address"  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Focus Tabs: [All] [Tokens] [Wallets] [DeFi] [NFTs] [News] │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │  TRENDING NOW cards  │  │  (6 quick-access cards)     │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│                                                             │
│  ════════════════════════════════════════════════════════    │
│  AFTER SEARCH:                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  QUERY CLASSIFICATION BADGE  (e.g. "TOKEN RESEARCH")  │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  LIVE DATA CARD (price, chart, fundamentals)          │  │
│  │  ← pulled from Spectre's own backend, not Perplexity  │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  AI RESEARCH BRIEF                                    │  │
│  │  ← Perplexity Sonar Pro response, structured          │  │
│  │  ← with citations, sources, timestamps                │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  RELATED SEARCHES  (auto-generated follow-ups)        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Bottom: [Start a Thread] [Create Collection] [Explore]     │
└─────────────────────────────────────────────────────────────┘
```

---

## PHASE 1: QUERY ROUTER (SERVER-SIDE)

The most critical piece. Every search query gets classified BEFORE hitting Perplexity. This determines which Spectre backend data to fetch in parallel and which system prompt Perplexity gets.

### Add to `server/index.js`:

```javascript
// ═══════════════════════════════════════════════════════════════
// SPECTRE SEARCH — Perplexity-Powered Research Engine
// ═══════════════════════════════════════════════════════════════

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';

// ── QUERY CLASSIFIER ──
// Determines query type, extracts tickers/addresses, picks the right
// system prompt and parallel data fetches

function classifySearchQuery(query) {
  const q = query.trim();
  const upper = q.toUpperCase();

  // 1. Wallet address detection
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
    return { type: 'WALLET_EVM', address: q, tickers: [] };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) && !q.includes(' ')) {
    return { type: 'WALLET_SOLANA', address: q, tickers: [] };
  }

  // 2. Contract address (token lookup)
  if (/^0x[a-fA-F0-9]{40}$/i.test(q.split(' ')[0])) {
    return { type: 'TOKEN_ADDRESS', address: q.split(' ')[0], tickers: [] };
  }

  // 3. Extract all $TICKERS from query
  const tickerMatches = q.match(/\$([A-Za-z]{1,10})/g) || [];
  const tickers = tickerMatches.map(t => t.replace('$', '').toUpperCase());

  // 4. Single ticker query (just "$BTC" or "BTC" or "bitcoin")
  const TICKER_ALIASES = {
    'BITCOIN': 'BTC', 'ETHEREUM': 'ETH', 'SOLANA': 'SOL',
    'CARDANO': 'ADA', 'POLKADOT': 'DOT', 'CHAINLINK': 'LINK',
    'APPLE': 'AAPL', 'MICROSOFT': 'MSFT', 'NVIDIA': 'NVDA',
    'TESLA': 'TSLA', 'AMAZON': 'AMZN', 'GOOGLE': 'GOOGL',
    'PALANTIR': 'PLTR', 'COINBASE': 'COIN',
  };

  const singleWord = q.replace(/^\$/, '').toUpperCase();
  if (!q.includes(' ') && (
    STOCK_TICKERS[singleWord] ||
    KNOWN_CRYPTO_SYMBOLS[singleWord] || // your existing crypto symbol map
    TICKER_ALIASES[singleWord]
  )) {
    const resolved = TICKER_ALIASES[singleWord] || singleWord;
    return {
      type: STOCK_TICKERS[resolved] ? 'STOCK_RESEARCH' : 'TOKEN_RESEARCH',
      tickers: [resolved],
      address: null,
    };
  }

  // 5. Comparative query ("BTC vs ETH", "AAPL vs MSFT")
  if (/\bvs\.?\b|\bversus\b|\bcompare\b|\bor\b/i.test(q) && tickers.length >= 2) {
    return { type: 'COMPARISON', tickers, address: null };
  }

  // 6. Market/macro questions
  const MARKET_KEYWORDS = [
    'market', 'bull', 'bear', 'crash', 'rally', 'fed ', 'interest rate',
    'inflation', 'recession', 'gdp', 'cpi', 'macro', 'sector',
    'dominance', 'alt season', 'fear', 'greed', 'vix', 'treasury',
    'etf flow', 'institutional', 'whale', 'liquidat',
  ];
  if (MARKET_KEYWORDS.some(kw => q.toLowerCase().includes(kw))) {
    return { type: 'MARKET_MACRO', tickers, address: null };
  }

  // 7. DeFi specific
  const DEFI_KEYWORDS = [
    'defi', 'yield', 'tvl', 'liquidity', 'pool', 'farm', 'stake',
    'apy', 'apr', 'lend', 'borrow', 'bridge', 'dex', 'amm', 'vault',
    'impermanent', 'protocol',
  ];
  if (DEFI_KEYWORDS.some(kw => q.toLowerCase().includes(kw))) {
    return { type: 'DEFI_RESEARCH', tickers, address: null };
  }

  // 8. Meme / microcap detection
  const MEME_KEYWORDS = [
    'meme', 'microcap', 'lowcap', 'gem', 'degen', '100x', '1000x',
    'moonshot', 'presale', 'fair launch', 'pump', 'rug', 'honeypot',
    'new token', 'just launched', 'stealth launch',
  ];
  if (MEME_KEYWORDS.some(kw => q.toLowerCase().includes(kw))) {
    return { type: 'MEME_ALPHA', tickers, address: null };
  }

  // 9. News / event queries
  const NEWS_KEYWORDS = [
    'news', 'announce', 'hack', 'exploit', 'sec ', 'lawsuit',
    'regulation', 'ban', 'approval', 'listing', 'partnership',
    'acquisition', 'earnings', 'report',
  ];
  if (NEWS_KEYWORDS.some(kw => q.toLowerCase().includes(kw))) {
    return { type: 'NEWS_EVENT', tickers, address: null };
  }

  // 10. On-chain / technical
  if (/chain|gas|block|transaction|nft|mint|airdrop|snapshot/i.test(q)) {
    return { type: 'ONCHAIN', tickers, address: null };
  }

  // 11. If tickers were found but no other classification
  if (tickers.length > 0) {
    const firstTicker = tickers[0];
    return {
      type: STOCK_TICKERS[firstTicker] ? 'STOCK_RESEARCH' : 'TOKEN_RESEARCH',
      tickers,
      address: null,
    };
  }

  // 12. General / fallback
  return { type: 'GENERAL', tickers: [], address: null };
}
```

---

## PHASE 2: SYSTEM PROMPTS PER QUERY TYPE

Each query type gets a specialized system prompt that tells Perplexity exactly what kind of research to produce. This is what makes Spectre Search institutional-grade instead of generic.

```javascript
// ── SYSTEM PROMPTS ──
// Each prompt shapes Perplexity's response into structured, actionable intelligence

const SEARCH_SYSTEM_PROMPTS = {

  TOKEN_RESEARCH: `You are a senior crypto research analyst at a digital asset fund. The user is asking about a specific cryptocurrency token. Provide a comprehensive research brief:

STRUCTURE YOUR RESPONSE EXACTLY LIKE THIS:

**THESIS** (2-3 sentences — what is this project and why does it matter or not matter)

**FUNDAMENTALS**
- What the project does (actual utility, not marketing speak)
- Team background and credibility (anon vs doxxed, track record)
- Funding/backing (VCs, grants, treasury size if known)
- Token economics (supply, emissions, unlock schedule, burn mechanics)
- Revenue or protocol fees if applicable

**MARKET POSITION**
- Competitive landscape (who are the direct competitors)
- Market share or TVL ranking within its category
- Unique advantages or moats
- Key risks and red flags

**RECENT DEVELOPMENTS** (last 30 days)
- Protocol upgrades, partnerships, listings
- Community sentiment shifts
- Any controversies or security incidents

**VERDICT**
One paragraph. Would a fund allocate here? What's the risk/reward profile? What catalysts to watch?

Be specific. Use numbers. Cite sources. Do NOT be generic. If this is a microcap or meme token with limited information, say so explicitly and flag the risk level. If it appears to be a scam or honeypot, warn clearly.`,

  STOCK_RESEARCH: `You are a senior equity research analyst at a top-tier investment bank. The user is asking about a specific stock. Provide a comprehensive research brief:

STRUCTURE YOUR RESPONSE EXACTLY LIKE THIS:

**THESIS** (2-3 sentences — bull case summary)

**BUSINESS OVERVIEW**
- What the company does (revenue streams, business segments)
- Competitive position and market share
- Management quality and recent leadership changes

**FINANCIALS**
- Latest quarterly results vs expectations
- Revenue growth trajectory
- Margins (gross, operating, net)
- Free cash flow and balance sheet health
- Guidance and forward estimates

**VALUATION**
- Current P/E, forward P/E, PEG ratio
- How valuation compares to sector peers
- Historical valuation range

**CATALYSTS & RISKS**
- Upcoming events (earnings, product launches, regulatory)
- Key risks to the thesis
- Analyst consensus and notable upgrades/downgrades

**VERDICT**
One paragraph. Risk/reward assessment at current levels.

Use specific numbers. Cite sources. Reference the most recent earnings call or filing when available.`,

  COMPARISON: `You are a portfolio strategist comparing investment options. The user wants to compare multiple assets. Structure your analysis:

**OVERVIEW TABLE** (present as structured comparison)
Compare: price action (7d, 30d, YTD), market cap, key metric per asset type (P/E for stocks, TVL for DeFi, etc.)

**HEAD TO HEAD**
For each asset, give 2-3 sentence thesis.

**KEY DIFFERENCES**
What fundamentally separates these? Risk profile, growth trajectory, correlation.

**PORTFOLIO VIEW**
If you had to pick one, which and why? If both belong in a portfolio, what allocation makes sense?

Be opinionated. Funds pay for conviction, not hedge statements.`,

  MARKET_MACRO: `You are a macro strategist covering both traditional and crypto markets. Provide analysis on the market question:

**CURRENT STATE** — What is happening right now? Key numbers.
**DRIVERS** — What's causing this? Be specific about catalysts.
**HISTORICAL CONTEXT** — Has this happened before? What followed?
**IMPLICATIONS** — What does this mean for portfolios? Which sectors/assets benefit or suffer?
**WATCH LIST** — 3-5 specific things to monitor in the next 1-4 weeks.

Always include specific data points. Reference recent Fed statements, economic data releases, or on-chain metrics where relevant.`,

  MEME_ALPHA: `You are a crypto-native researcher who specializes in early-stage and meme token discovery. The user is looking for alpha in microcaps, meme coins, or new launches.

BE VERY CAREFUL AND BALANCED. For every opportunity you mention, include:
- Contract address if findable
- Liquidity depth and lock status
- Holder distribution (whale concentration)
- Whether the team is doxxed
- Age of the token
- Red flags (mint function, honeypot indicators, copied code)

STRUCTURE:
**WHAT'S MOVING** — Current hot narratives in meme/microcap space
**NOTABLE TOKENS** — Specific tokens gaining traction, with data
**RISK ASSESSMENT** — Honest risk level for each (extreme/high/medium)
**SURVIVAL GUIDE** — Practical tips for this specific query

Never shill. Always include risk warnings. If something looks like a scam, say it directly. Your job is to inform, not promote.`,

  DEFI_RESEARCH: `You are a DeFi protocol analyst. Provide technical and financial analysis:

**PROTOCOL OVERVIEW** — What it does, which chains, TVL
**YIELD ANALYSIS** — Current rates, sustainability, source of yield
**SMART CONTRACT RISK** — Audit status, past incidents, admin keys
**COMPETITIVE POSITION** — vs similar protocols
**OPPORTUNITY** — Is this worth deploying capital into? At what risk level?

Include specific APY/APR numbers, TVL figures, and audit firm names. Reference DeFiLlama, L2Beat, or protocol dashboards.`,

  NEWS_EVENT: `You are a financial news analyst. Provide rapid, factual briefing:

**WHAT HAPPENED** — Facts only, no speculation. When, where, who.
**MARKET IMPACT** — How has price reacted? Quantify the move.
**CONTEXT** — Why does this matter? Historical precedent.
**WHAT'S NEXT** — Expected follow-up events, deadlines, decisions.
**TRADING IMPLICATIONS** — How should this inform positioning?

Prioritize the most recent and authoritative sources. Include timestamps where possible.`,

  WALLET_EVM: `You are an on-chain analyst investigating an Ethereum/EVM wallet address. Provide:

**WALLET PROFILE** — Is this a known entity? (exchange, protocol, whale, MEV bot)
**HOLDINGS SUMMARY** — Major token positions if discoverable
**RECENT ACTIVITY** — Notable transactions in last 7 days
**PATTERNS** — Accumulation/distribution behavior, DeFi activity
**CONNECTIONS** — Related wallets or known associations

Reference Etherscan, Arkham, Nansen, or DeBank data when available.`,

  WALLET_SOLANA: `You are an on-chain analyst investigating a Solana wallet address. Provide:

**WALLET PROFILE** — Is this a known entity?
**HOLDINGS SUMMARY** — SOL balance, major SPL token positions
**RECENT ACTIVITY** — Notable transactions, DEX trades, NFT activity
**PATTERNS** — Trading behavior, frequency, profit/loss if estimable

Reference Solscan, Birdeye, or GMGN data when available.`,

  ONCHAIN: `You are a blockchain data analyst. Provide technical on-chain analysis:

**NETWORK STATE** — Current metrics (gas, TPS, active addresses)
**RELEVANT DATA** — Answer the specific on-chain question with data
**TRENDS** — What direction are the key metrics moving?
**IMPLICATIONS** — What does this mean for users, builders, investors?`,

  GENERAL: `You are a senior financial research analyst at Spectre AI, a premium market intelligence platform covering both crypto and traditional markets. Answer the user's question with:

- Specific data and numbers, not generalities
- Source citations for claims
- Balanced perspective acknowledging risks
- Actionable conclusions

If the question involves a tradeable asset, include current price context. If it's a broad question, structure your response with clear sections. Be concise but thorough.`,
};
```

---

## PHASE 3: THE SEARCH ENDPOINT

```javascript
// ── POST /api/search ──
// Main search endpoint. Classifies query, fetches Spectre data + Perplexity in parallel.

app.post('/api/search', async (req, res) => {
  const query = (req.body?.query || '').trim();
  const focus = (req.body?.focus || 'all').toLowerCase(); // all, tokens, wallets, defi, nfts, news
  const conversationId = req.body?.conversationId || null; // for follow-up threads

  if (!query) return res.status(400).json({ error: 'Query required' });
  if (!PERPLEXITY_API_KEY) return res.status(503).json({ error: 'Search not configured' });

  // 1. Classify the query
  const classification = classifySearchQuery(query);
  console.log(`[search] Query: "${query}" → Type: ${classification.type}, Tickers: [${classification.tickers}]`);

  // 2. Apply focus filter override
  if (focus === 'tokens' && classification.type === 'GENERAL') {
    classification.type = 'TOKEN_RESEARCH';
  } else if (focus === 'news') {
    classification.type = 'NEWS_EVENT';
  } else if (focus === 'defi') {
    classification.type = 'DEFI_RESEARCH';
  } else if (focus === 'wallets' && !classification.address) {
    classification.type = 'GENERAL'; // can't do wallet analysis without address
  }

  // 3. Parallel fetch: Spectre backend data + Perplexity research
  const [spectreData, perplexityResponse] = await Promise.allSettled([
    fetchSpectreEnrichment(classification),
    fetchPerplexityResearch(query, classification),
  ]);

  const enrichment = spectreData.status === 'fulfilled' ? spectreData.value : null;
  const research = perplexityResponse.status === 'fulfilled' ? perplexityResponse.value : null;

  if (!research) {
    return res.status(502).json({ error: 'Search temporarily unavailable' });
  }

  // 4. Return structured response
  res.json({
    query,
    classification: classification.type,
    tickers: classification.tickers,
    // Spectre's own data (prices, charts, fundamentals)
    enrichment,
    // Perplexity research brief
    research: {
      content: research.content,
      citations: research.citations || [],
      model: research.model,
      searchContextSize: research.searchContextSize,
    },
    // Auto-generated follow-up questions
    relatedSearches: generateRelatedSearches(query, classification),
    timestamp: new Date().toISOString(),
  });
});
```

---

## PHASE 4: PERPLEXITY API INTEGRATION

```javascript
// ── PERPLEXITY SONAR PRO CALLER ──

async function fetchPerplexityResearch(query, classification) {
  const systemPrompt = SEARCH_SYSTEM_PROMPTS[classification.type] || SEARCH_SYSTEM_PROMPTS.GENERAL;

  // Build the user message with context enrichment
  let userMessage = query;

  // If we have tickers, add context so Perplexity knows what to focus on
  if (classification.tickers.length > 0) {
    const tickerList = classification.tickers.join(', ');
    userMessage = `${query}\n\nFocus assets: ${tickerList}`;
  }

  // If it's a wallet query, add the address
  if (classification.address) {
    userMessage = `Analyze this wallet address: ${classification.address}\n\nOriginal query: ${query}`;
  }

  // Search domain filtering based on query type
  const domainFilters = getDomainFilters(classification.type);

  try {
    const response = await fetch(`${PERPLEXITY_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',  // Use sonar-pro for deep research
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.1, // Low temp for factual research
        search_context_size: classification.type === 'MEME_ALPHA' ? 'high' : 'medium',
        // Domain filtering for quality sources
        ...(domainFilters.length > 0 && { search_domain_filter: domainFilters }),
        return_citations: true,
      }),
      signal: AbortSignal.timeout(25000), // 25s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[perplexity] API error ${response.status}:`, errorText);
      return null;
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    return {
      content: message?.content || '',
      citations: data.citations || [],
      model: data.model,
      searchContextSize: classification.type === 'MEME_ALPHA' ? 'high' : 'medium',
      usage: data.usage,
    };
  } catch (e) {
    console.error('[perplexity] Request failed:', e.message);
    return null;
  }
}

// ── DOMAIN FILTERS ──
// Route Perplexity to authoritative sources per query type

function getDomainFilters(queryType) {
  // Perplexity's domain filter limits results to these domains
  // Use sparingly — only when you want to constrain source quality
  const FILTERS = {
    STOCK_RESEARCH: [
      // Don't filter stocks — let Perplexity find the best sources
      // SEC filings, earnings calls, analyst reports are all valuable
    ],
    TOKEN_RESEARCH: [
      // Don't over-filter — microcaps may only have info on niche sites
    ],
    MEME_ALPHA: [
      // Explicitly NO filtering — meme alpha is found in weird places
      // Twitter, Telegram screenshots, DEX analytics, etc.
    ],
    DEFI_RESEARCH: [
      // Light filtering to quality DeFi sources
    ],
    NEWS_EVENT: [
      // No filter — need speed and breadth for breaking news
    ],
  };
  return FILTERS[queryType] || [];
}
```

---

## PHASE 5: SPECTRE DATA ENRICHMENT

When someone searches for a ticker, we fetch Spectre's own data in parallel with Perplexity. This gives us live prices, charts, and fundamentals that Perplexity doesn't have.

```javascript
// ── SPECTRE ENRICHMENT ──
// Fetches live data from Spectre's own backend to embed in results

async function fetchSpectreEnrichment(classification) {
  const enrichment = {
    tokens: [],     // Live price data for mentioned tickers
    charts: [],     // Sparkline data
    marketState: null, // Global market context
  };

  try {
    // Always fetch market state for context
    enrichment.marketState = await getMarketStateSnapshot();

    // Fetch data for each mentioned ticker
    for (const ticker of classification.tickers.slice(0, 5)) { // Max 5 tickers
      const isStock = !!STOCK_TICKERS[ticker];

      if (isStock) {
        // Fetch stock data from existing endpoints
        const [quoteData, fundData] = await Promise.allSettled([
          fetchYahooQuotes([ticker]),
          fetchStockFundamentals(ticker),
        ]);

        const quote = quoteData.status === 'fulfilled' ? quoteData.value?.[ticker] : null;
        const fund = fundData.status === 'fulfilled' ? fundData.value : null;

        if (quote) {
          enrichment.tokens.push({
            symbol: ticker,
            assetType: 'stock',
            name: quote.name || STOCK_TICKERS[ticker]?.name,
            price: quote.price,
            change24h: quote.change,
            marketCap: fund?.marketCap || quote.marketCap,
            pe: fund?.pe || quote.pe,
            volume: quote.volume,
            week52High: quote.week52High,
            week52Low: quote.week52Low,
            sector: STOCK_TICKERS[ticker]?.sector || quote.sector,
            logo: `https://logo.clearbit.com/${STOCK_TICKERS[ticker]?.domain}`,
          });
        }
      } else {
        // Fetch crypto data
        // Try Binance first (fast), then CoinGecko, then Codex
        let tokenData = null;

        try {
          const binanceSymbol = `${ticker}USDT`;
          const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            const data = await resp.json();
            tokenData = {
              symbol: ticker,
              assetType: 'crypto',
              name: ticker,
              price: parseFloat(data.lastPrice),
              change24h: parseFloat(data.priceChangePercent),
              volume: parseFloat(data.quoteVolume),
              high24h: parseFloat(data.highPrice),
              low24h: parseFloat(data.lowPrice),
            };
          }
        } catch (e) { /* fallback below */ }

        // CoinGecko fallback for name + market cap
        if (!tokenData) {
          const cgId = SYMBOL_TO_CG_ID[ticker];
          if (cgId) {
            try {
              const url = `https://api.coingecko.com/api/v3/coins/${cgId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`;
              const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
              if (resp.ok) {
                const data = await resp.json();
                tokenData = {
                  symbol: ticker,
                  assetType: 'crypto',
                  name: data.name,
                  price: data.market_data?.current_price?.usd,
                  change24h: data.market_data?.price_change_percentage_24h,
                  marketCap: data.market_data?.market_cap?.usd,
                  volume: data.market_data?.total_volume?.usd,
                  logo: data.image?.small,
                };
              }
            } catch (e) { /* no data available */ }
          }
        }

        if (tokenData) enrichment.tokens.push(tokenData);
      }
    }
  } catch (e) {
    console.error('[enrichment] Error:', e.message);
  }

  return enrichment;
}

// Quick market snapshot for context
async function getMarketStateSnapshot() {
  try {
    // Reuse existing market data from your caches
    const btcQuote = await fetchYahooChartPrice('BTC-USD').catch(() => null);
    // Add fear & greed, BTC dominance from your existing endpoints
    return {
      btcPrice: btcQuote?.price || null,
      btcChange: btcQuote?.change || null,
      // Add more from your existing cache
    };
  } catch (e) {
    return null;
  }
}
```

---

## PHASE 6: RELATED SEARCHES GENERATOR

Auto-generate intelligent follow-up questions based on the query type and tickers:

```javascript
function generateRelatedSearches(query, classification) {
  const tickers = classification.tickers;
  const t = tickers[0]; // Primary ticker

  const templates = {
    TOKEN_RESEARCH: [
      t && `${t} tokenomics and unlock schedule`,
      t && `${t} vs top competitors`,
      t && `Is ${t} a good investment right now?`,
      t && `${t} whale wallets and accumulation`,
      'Top performing crypto tokens this week',
    ],
    STOCK_RESEARCH: [
      t && `${t} latest earnings results`,
      t && `${t} analyst price targets`,
      t && `${t} vs sector peers`,
      t && `${t} insider buying and selling`,
      t && `Is ${t} overvalued?`,
    ],
    COMPARISON: [
      tickers.length >= 2 && `${tickers[0]} vs ${tickers[1]} risk-adjusted returns`,
      tickers.length >= 2 && `Which is better for long term: ${tickers[0]} or ${tickers[1]}?`,
      'Best risk-adjusted crypto assets right now',
    ],
    MARKET_MACRO: [
      'How are institutions positioning right now?',
      'Crypto market correlation with S&P 500',
      'Next major macro catalyst for markets',
      'BTC ETF flow trends this month',
    ],
    MEME_ALPHA: [
      'New Solana meme coins launched today',
      'Highest volume microcaps in the last 24h',
      'How to spot a rug pull before it happens',
      'Trending crypto narratives this week',
    ],
    DEFI_RESEARCH: [
      'Highest yield DeFi opportunities right now',
      'DeFi protocols by TVL growth this month',
      'Safest stablecoin yield strategies',
      'New DeFi protocols launched this week',
    ],
    NEWS_EVENT: [
      'Latest crypto regulatory news',
      'Most impactful crypto news this week',
      'Upcoming crypto events and catalysts',
    ],
    GENERAL: [
      'Top gainers last 24h',
      'Whale wallet movements today',
      'Undervalued DeFi gems',
      'Trending crypto narratives this week',
    ],
  };

  const related = templates[classification.type] || templates.GENERAL;
  return related.filter(Boolean).slice(0, 5);
}
```

---

## PHASE 7: TRENDING NOW CARDS (DEFAULT STATE)

The landing state before any search. These are pre-built queries that users can click:

```javascript
// ── GET /api/search/trending ──
// Returns the 6 trending quick-access cards shown on the search landing page

app.get('/api/search/trending', async (req, res) => {
  // These rotate based on market conditions
  // In production, make these dynamic based on actual trending data
  const trending = [
    {
      title: 'Top gainers last 24h',
      category: 'MARKETS',
      icon: 'trending-up', // Lucide icon name
      query: 'Top gaining crypto tokens in the last 24 hours with volume over $1M',
    },
    {
      title: 'Whale wallet movements',
      category: 'ON-CHAIN',
      icon: 'activity',
      query: 'Largest crypto whale wallet movements and transfers today',
    },
    {
      title: 'New Solana token launches',
      category: 'DISCOVERY',
      icon: 'rocket',
      query: 'New Solana tokens launched in the last 48 hours with growing volume',
    },
    {
      title: 'ETH gas tracker',
      category: 'TOOLS',
      icon: 'fuel',
      query: 'Current Ethereum gas prices and network congestion status',
    },
    {
      title: 'Undervalued DeFi gems',
      category: 'ALPHA',
      icon: 'gem',
      query: 'Undervalued DeFi protocols with growing TVL and low market cap',
    },
    {
      title: 'Institutional flows today',
      category: 'SMART MONEY',
      icon: 'building-2',
      query: 'Institutional crypto fund flows and BTC ETF inflows/outflows today',
    },
  ];

  res.json({ trending });
});
```

---

## PHASE 8: FRONTEND — SEARCH PAGE COMPONENT

Create the search page at `src/pages/Search/index.jsx`:

**CRITICAL DESIGN RULES (from SPECTRE_DESIGN_LAW.md):**
- Background: `#07070d` or `#0a0a0f`
- Cards: Use the glass card pattern from the design law
- Text: Inter for body, Space Grotesk for headings, JetBrains Mono for numbers
- White opacity scale: 1.0 / 0.72 / 0.48 / 0.32
- Green (#10B981) for gains, Red (#EF4444) for losses
- No bright gradients. No neon. No generic AI aesthetics.
- Loading state = skeleton shimmer, never spinners
- The search bar should feel premium — large, centered, slight glass effect

**Component structure:**

```
src/pages/Search/
├── index.jsx              — Page wrapper, state management
├── components/
│   ├── SearchBar.jsx      — The main search input
│   ├── FocusTabs.jsx      — All | Tokens | Wallets | DeFi | NFTs | News
│   ├── TrendingCards.jsx   — 6 quick-access cards (default state)
│   ├── SearchResults.jsx   — Results container after search
│   ├── TokenDataCard.jsx   — Live price/chart card (from Spectre data)
│   ├── ResearchBrief.jsx   — Perplexity research content with citations
│   ├── CitationPill.jsx    — Individual source citation
│   ├── RelatedSearches.jsx — Follow-up query suggestions
│   └── SearchSkeleton.jsx  — Loading state
└── Search.css              — Styles (follow design law)
```

**Key UI behaviors:**

1. **Search bar** — Always visible at top. On focus, subtle glow. Supports: text input, paste address, attach file (future). Send button on right.

2. **Focus tabs** — Filter the search domain. "All" is default. Selecting a tab influences the query classification.

3. **Default state** — Spectre logo, "Spectre Search" heading, subtitle, search bar, focus tabs, 6 trending cards in 2x3 grid, bottom action buttons.

4. **Loading state** — After submitting, show skeleton shimmer in the results area. The search bar stays visible with the query. Trending cards fade out.

5. **Results state** — Classification badge at top (e.g. "TOKEN RESEARCH"). If tickers were detected, show the TokenDataCard with live price, mini chart, and key metrics. Below that, the ResearchBrief with the Perplexity response rendered as formatted markdown. Citations as small pills at the bottom. Related searches as clickable chips.

6. **Token Data Card** — This is NOT from Perplexity. This is from Spectre's own backend. Live price, 24h change, sparkline chart, market cap, volume, PE (if stock). Clicking it navigates to the full Research Zone for that token.

7. **Citations** — Each claim in the research brief links to its source. Show domain + favicon. Clicking opens the source in a new tab.

8. **Threading** — "Start a Thread" button lets users continue the conversation. Follow-up queries include the previous context for better answers.

---

## PHASE 9: SEARCH BAR INTELLIGENCE

The search bar should have smart features:

```javascript
// In the SearchBar component:

// 1. Auto-detect what the user is typing
function getInputHint(value) {
  if (/^0x[a-fA-F0-9]*$/.test(value)) return 'Detecting wallet or contract address...';
  if (/^\$[A-Z]+$/.test(value)) return `Looking up ${value}...`;
  if (/vs|compare/i.test(value)) return 'Comparison mode';
  return null;
}

// 2. Quick suggestions as user types
// Show matching tickers, recent searches, trending queries
// Use existing /api/tokens/search and /api/stocks/search endpoints

// 3. Keyboard shortcuts
// Enter = search
// Cmd+K / Ctrl+K = focus search bar from anywhere in the app
// Escape = clear/close
```

---

## PHASE 10: COST MANAGEMENT

Perplexity API costs money. Implement these controls:

```javascript
// 1. Response caching — same query within 5 min returns cached result
const searchCache = new Map();
const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// 2. Rate limiting — max 30 searches per user per hour
// (implement when auth is ready, for now use IP-based)

// 3. Model tiering:
//    - Simple ticker lookups → sonar (cheap, fast)
//    - Deep research queries → sonar-pro (expensive, thorough)
//    - Use sonar for auto-suggestions, sonar-pro for actual searches

function getModelForQuery(classification) {
  // Cheap/fast model for simple lookups
  if (classification.type === 'TOKEN_RESEARCH' && classification.tickers.length === 1) {
    return 'sonar'; // $1/M tokens
  }
  // Pro model for complex research
  return 'sonar-pro'; // $3/M input, $15/M output
}

// 4. Search context size optimization:
//    - 'low' for quick factual lookups ($6/1K requests)
//    - 'medium' for standard research ($10/1K requests)
//    - 'high' for deep dives and meme alpha ($14/1K requests)
```

---

## PHASE 11: ADD ROUTE

Register the search page in your routing:

```javascript
// In src/constants/pageRoutes.js, add:
'search': '/search',

// In your router (App.jsx or wherever routes are defined):
import SearchPage from './pages/Search';
// Add: <Route path="/search" element={<SearchPage />} />

// In NavigationSidebar.jsx, add a search icon/link
```

---

## ENVIRONMENT SETUP

Add to `.env`:
```
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxx
```

No new npm dependencies needed. The Perplexity API uses standard fetch with the OpenAI-compatible chat completions format.

---

## VERIFICATION

After building, test these queries:

```bash
# Single crypto token
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "$BTC"}' | jq '{classification, "tickerCount": (.enrichment.tokens | length), "hasResearch": (.research.content | length > 0)}'

# Stock
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "NVDA earnings analysis"}' | jq '.classification'
# Expected: "STOCK_RESEARCH"

# Comparison
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "$BTC vs $ETH"}' | jq '.classification'
# Expected: "COMPARISON"

# Meme/microcap
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "best new Solana meme coins this week"}' | jq '.classification'
# Expected: "MEME_ALPHA"

# Wallet
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}' | jq '.classification'
# Expected: "WALLET_EVM"

# DeFi
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "highest yield stablecoin farming"}' | jq '.classification'
# Expected: "DEFI_RESEARCH"

# Macro
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "how will Fed rate decision affect crypto"}' | jq '.classification'
# Expected: "MARKET_MACRO"

# General
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "what is restaking"}' | jq '.classification'
# Expected: "GENERAL"
```

---

## WHAT MAKES THIS DIFFERENT

1. **Query classification** — Every search is routed to a specialized analyst persona. A meme coin query gets a completely different research methodology than a stock earnings query.

2. **Hybrid data** — Perplexity provides the web research. Spectre provides the live market data. The user sees both, unified. No other search engine does this.

3. **Institutional prompts** — The system prompts produce McKinsey/Goldman-level research structure. Not generic AI summaries. Structured theses, risk assessments, and actionable verdicts.

4. **Microcap to mega cap** — The meme alpha classifier catches degen queries and routes them to high-context search with appropriate risk warnings. No other research tool takes meme coins seriously while also covering AAPL earnings.

5. **Wallet search** — Paste any wallet address and get an instant on-chain brief. No one else has this in a unified search.

6. **Spectre ecosystem** — Everything links back into the Spectre app. Click a ticker in results, land in Research Zone. Click a wallet, see full on-chain view. The search is a front door to the entire platform.
