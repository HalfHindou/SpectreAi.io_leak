/**
 * Spectre Lens — Token Analysis API
 * POST /api/v1/lens/analyze
 *
 * Accepts a token symbol/address and returns quick sentiment signals,
 * a verdict, and a spoken summary. Uses the Perplexity gate for AI
 * research with CoinGecko/Binance price enrichment.
 */

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';
const COINGECKO_HEADER_KEY = 'x-cg-pro-api-key';

// In-memory cache (lens results are expensive — cache for 2 min)
const CACHE_TTL_MS = 2 * 60 * 1000;
const analysisCache = new Map();
const MAX_CACHE_SIZE = 200;

function getCached(key) {
  const entry = analysisCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    analysisCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  if (analysisCache.size >= MAX_CACHE_SIZE) {
    const oldest = analysisCache.keys().next().value;
    analysisCache.delete(oldest);
  }
  analysisCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL -> COINGECKO ID MAP (shared subset — keep aligned with index.js)
// ═══════════════════════════════════════════════════════════════════════════════
const SYMBOL_TO_CG = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
  USDT: 'tether', USDC: 'usd-coin', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  LINK: 'chainlink', DOT: 'polkadot', MATIC: 'matic-network', UNI: 'uniswap',
  LTC: 'litecoin', SHIB: 'shiba-inu', TRX: 'tron', BCH: 'bitcoin-cash',
  ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', FLOKI: 'floki', WIF: 'dogwifhat',
  AAVE: 'aave', CRV: 'curve-dao-token', MKR: 'maker', LDO: 'lido-dao',
  GRT: 'the-graph', SUSHI: 'sushiswap', RENDER: 'render-token', RNDR: 'render-token',
  INJ: 'injective-protocol', FIL: 'filecoin', FET: 'fetch-ai', JUP: 'jupiter-exchange-solana',
  JTO: 'jito-governance-token', PYTH: 'pyth-network', BONK: 'bonk', TIA: 'celestia',
  SEI: 'sei-network', SUI: 'sui', APT: 'aptos',
  ATOM: 'cosmos', NEAR: 'near', ALGO: 'algorand', HBAR: 'hedera-hashgraph',
  ONDO: 'ondo-finance', ENA: 'ethena', TAO: 'bittensor', AKT: 'akash-network', HNT: 'helium',
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE FETCHING — CoinGecko with Binance fallback
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchPrice(symbol) {
  const upper = (symbol || '').toUpperCase();

  // Try CoinGecko first (richer data)
  const cgId = SYMBOL_TO_CG[upper];
  if (cgId) {
    try {
      const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(cgId)}&sparkline=false&price_change_percentage=24h,7d`;
      const opts = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) };
      if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
      const res = await fetch(url, opts);
      if (res.ok) {
        const data = await res.json();
        const c = data[0];
        if (c) {
          return {
            price: c.current_price || 0,
            change24h: c.price_change_percentage_24h || 0,
            change7d: c.price_change_percentage_7d_in_currency || 0,
            volume: c.total_volume || 0,
            marketCap: c.market_cap || 0,
            high24h: c.high_24h || 0,
            low24h: c.low_24h || 0,
            name: c.name || upper,
            source: 'coingecko',
          };
        }
      }
    } catch (e) {
      console.error(`[lens] CoinGecko price failed for ${upper}:`, e.message);
    }
  }

  // Binance fallback (price + 24h change only)
  try {
    const pair = upper + 'USDT';
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const d = await res.json();
      return {
        price: parseFloat(d.lastPrice) || 0,
        change24h: parseFloat(d.priceChangePercent) || 0,
        change7d: 0,
        volume: parseFloat(d.quoteVolume) || 0,
        marketCap: 0,
        high24h: parseFloat(d.highPrice) || 0,
        low24h: parseFloat(d.lowPrice) || 0,
        name: upper,
        source: 'binance',
      };
    }
  } catch (e) {
    console.error(`[lens] Binance price failed for ${upper}:`, e.message);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI ANALYSIS — Perplexity -> Anthropic -> OpenAI fallback chain
// ═══════════════════════════════════════════════════════════════════════════════

const LENS_SYSTEM_PROMPT = `You are Spectre Lens, a crypto token analysis engine. Given a token, produce a concise analysis with numeric signal scores.

Return ONLY valid JSON (no markdown, no code fences) in this exact shape:
{
  "sentiment": <number -1.0 to 1.0>,
  "onchain": <number -1.0 to 1.0>,
  "momentum": <number -1.0 to 1.0>,
  "verdict": "<STRONG_BUY|BUY|NEUTRAL|SELL|STRONG_SELL>",
  "verdictText": "<1-2 sentence trader-style summary>",
  "keyInsight": "<single most important finding>"
}

Signal scoring guide:
- sentiment: Community/social mood. +1 = extremely bullish, -1 = extremely bearish
- onchain: On-chain health (TVL trend, whale accumulation, contract activity). +1 = strong, -1 = declining
- momentum: Price/volume momentum and technical trend. +1 = strong uptrend, -1 = strong downtrend

Be direct and data-driven. No disclaimers. Think like a quant trader.`;

async function callPerplexity(userMessage) {
  if (!PERPLEXITY_API_KEY) return null;
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: LENS_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 800,
        temperature: 0.1,
        search_context_size: 'medium',
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[lens] Perplexity ${res.status}`);
      return null;
    }
    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content || null,
      citations: data.citations || [],
      model: 'perplexity-sonar',
    };
  } catch (e) {
    console.error('[lens] Perplexity failed:', e.message);
    return null;
  }
}

async function callAnthropic(userMessage) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: LENS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[lens] Anthropic ${res.status}`);
      return null;
    }
    const data = await res.json();
    return {
      content: data.content?.[0]?.text || null,
      citations: [],
      model: 'claude-sonnet',
    };
  } catch (e) {
    console.error('[lens] Anthropic failed:', e.message);
    return null;
  }
}

async function callOpenAI(userMessage) {
  if (!OPENAI_API_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: LENS_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 800,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[lens] OpenAI ${res.status}`);
      return null;
    }
    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content || null,
      citations: [],
      model: 'gpt-4o-mini',
    };
  } catch (e) {
    console.error('[lens] OpenAI failed:', e.message);
    return null;
  }
}

/**
 * Run AI analysis with Perplexity -> Anthropic -> OpenAI fallback.
 * Returns parsed signals object or null.
 */
async function runAIAnalysis(symbol, name, price, query) {
  const tokenLabel = name ? `${name} (${symbol})` : symbol;
  const priceContext = price ? `Current price: $${price.price}, 24h change: ${price.change24h?.toFixed(2)}%` : '';
  const userQuery = query || `Analyze ${tokenLabel} for trading signals.`;

  const userMessage = `Analyze ${tokenLabel}. ${priceContext}

${userQuery}

Return your analysis as the JSON object specified in your instructions.`;

  // Fallback chain: Perplexity -> Anthropic -> OpenAI
  let result = await callPerplexity(userMessage);
  if (!result?.content) {
    console.log('[lens] Perplexity unavailable, trying Anthropic...');
    result = await callAnthropic(userMessage);
  }
  if (!result?.content) {
    console.log('[lens] Anthropic unavailable, trying OpenAI...');
    result = await callOpenAI(userMessage);
  }
  if (!result?.content) {
    console.log('[lens] All AI providers failed');
    return null;
  }

  // Parse JSON from response (handle markdown fences)
  try {
    let raw = result.content.trim();
    // Strip markdown code fences if present
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    const parsed = JSON.parse(raw);
    return {
      sentiment: clamp(parsed.sentiment, -1, 1),
      onchain: clamp(parsed.onchain, -1, 1),
      momentum: clamp(parsed.momentum, -1, 1),
      verdict: validateVerdict(parsed.verdict),
      verdictText: (parsed.verdictText || '').slice(0, 300),
      keyInsight: (parsed.keyInsight || '').slice(0, 300),
      model: result.model,
      citations: result.citations || [],
    };
  } catch (e) {
    console.error('[lens] Failed to parse AI response:', e.message);
    console.error('[lens] Raw content:', result.content.slice(0, 500));
    return null;
  }
}

function clamp(val, min, max) {
  const n = parseFloat(val);
  if (isNaN(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

const VALID_VERDICTS = ['STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL'];
function validateVerdict(v) {
  const upper = (v || '').toUpperCase().replace(/\s+/g, '_');
  return VALID_VERDICTS.includes(upper) ? upper : 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK FALLBACK — Returns deterministic mock data when AI is unavailable
// ═══════════════════════════════════════════════════════════════════════════════

function generateMockAnalysis(symbol, name, price) {
  // Deterministic-ish signals based on symbol hash
  const hash = (symbol || 'X').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const sentiment = ((hash % 200) - 100) / 100;  // -1 to 1
  const onchain = (((hash * 7) % 200) - 100) / 100;
  const momentum = price?.change24h
    ? clamp(price.change24h / 10, -1, 1)
    : (((hash * 13) % 200) - 100) / 100;

  const avg = (sentiment + onchain + momentum) / 3;
  let verdict = 'NEUTRAL';
  if (avg > 0.4) verdict = 'STRONG_BUY';
  else if (avg > 0.15) verdict = 'BUY';
  else if (avg < -0.4) verdict = 'STRONG_SELL';
  else if (avg < -0.15) verdict = 'SELL';

  const tokenLabel = name || symbol;
  const verdictText = verdict === 'NEUTRAL'
    ? `${tokenLabel} is in a consolidation phase with mixed signals across sentiment and on-chain metrics.`
    : verdict.includes('BUY')
      ? `${tokenLabel} shows positive momentum with growing community sentiment and healthy on-chain activity.`
      : `${tokenLabel} faces headwinds with declining sentiment and weakening on-chain metrics.`;

  return {
    sentiment: parseFloat(sentiment.toFixed(2)),
    onchain: parseFloat(onchain.toFixed(2)),
    momentum: parseFloat(momentum.toFixed(2)),
    verdict,
    verdictText,
    keyInsight: `Mock analysis for ${tokenLabel}. AI analysis unavailable — configure PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY for live signals.`,
    model: 'mock',
    citations: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPOKEN VERDICT — Generate natural speech text from verdict
// ═══════════════════════════════════════════════════════════════════════════════

function buildVerdictSpoken(symbol, name, analysis) {
  const tokenLabel = name || symbol;
  const { verdict, verdictText, sentiment, momentum } = analysis;

  const sentimentWord = sentiment > 0.3 ? 'bullish' : sentiment < -0.3 ? 'bearish' : 'mixed';
  const momentumWord = momentum > 0.3 ? 'gaining' : momentum < -0.3 ? 'losing' : 'flat';

  return `${tokenLabel}. Verdict: ${verdict.replace(/_/g, ' ')}. ` +
    `Sentiment is ${sentimentWord}, momentum is ${momentumWord}. ` +
    verdictText;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /analyze — Main lens analysis endpoint
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/analyze', async (req, res) => {
  const startTime = Date.now();
  const {
    symbol: rawSymbol,
    name,
    address,
    chain,
    price: clientPrice,
    platform,
    query,
    mode = 'quick',
  } = req.body || {};

  const symbol = (rawSymbol || '').toUpperCase().trim();
  if (!symbol) {
    return res.status(400).json({ error: 'symbol is required' });
  }

  console.log(`[lens] Analyzing ${symbol} (name=${name || '-'}, address=${address || '-'}, chain=${chain || '-'}, mode=${mode})`);

  // Check cache
  const cacheKey = `${symbol}:${address || ''}:${mode}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[lens] Cache hit for ${symbol}`);
    return res.json(cached);
  }

  // 1. Fetch live price data (server-side, fresh)
  let price = null;
  try {
    price = await fetchPrice(symbol);
  } catch (e) {
    console.error(`[lens] Price fetch failed for ${symbol}:`, e.message);
  }

  // Fall back to client-provided price if server fetch failed
  if (!price && clientPrice != null) {
    price = {
      price: parseFloat(clientPrice) || 0,
      change24h: 0,
      change7d: 0,
      volume: 0,
      marketCap: 0,
      source: 'client',
    };
  }

  // 2. Run AI analysis (or mock fallback)
  const hasAnyAI = PERPLEXITY_API_KEY || ANTHROPIC_API_KEY || OPENAI_API_KEY;
  let analysis;

  if (hasAnyAI) {
    analysis = await runAIAnalysis(symbol, name, price, query);
  }

  // If AI failed or no keys configured, use mock
  if (!analysis) {
    console.log(`[lens] Using mock analysis for ${symbol} (AI ${hasAnyAI ? 'failed' : 'not configured'})`);
    analysis = generateMockAnalysis(symbol, name, price);
  }

  // 3. Build response
  const result = {
    symbol,
    name: name || price?.name || symbol,
    price: price?.price ?? null,
    change24h: price?.change24h ?? null,
    signals: {
      sentiment: analysis.sentiment,
      onchain: analysis.onchain,
      momentum: analysis.momentum,
    },
    verdict: analysis.verdict,
    verdictText: analysis.verdictText,
    verdictSpoken: buildVerdictSpoken(symbol, name || price?.name, analysis),
    keyInsight: analysis.keyInsight,
    meta: {
      model: analysis.model,
      citations: analysis.citations,
      priceSource: price?.source || null,
      chain: chain || null,
      address: address || null,
      mode,
      latencyMs: Date.now() - startTime,
    },
    timestamp: new Date().toISOString(),
  };

  // Cache the result
  setCached(cacheKey, result);

  console.log(`[lens] ${symbol} -> ${analysis.verdict} (${analysis.model}, ${Date.now() - startTime}ms)`);
  res.json(result);
});

// GET /health — quick status check
router.get('/health', (req, res) => {
  const hasPerplexity = !!PERPLEXITY_API_KEY;
  const hasAnthropic = !!ANTHROPIC_API_KEY;
  const hasOpenAI = !!OPENAI_API_KEY;
  res.json({
    status: 'ok',
    ai: {
      perplexity: hasPerplexity,
      anthropic: hasAnthropic,
      openai: hasOpenAI,
      anyConfigured: hasPerplexity || hasAnthropic || hasOpenAI,
    },
    cache: {
      size: analysisCache.size,
      maxSize: MAX_CACHE_SIZE,
    },
  });
});

module.exports = router;
