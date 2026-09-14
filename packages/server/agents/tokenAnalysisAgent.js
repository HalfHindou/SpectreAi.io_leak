/**
 * Spectre Intelligence Hub — Token Analysis Agent
 * Generates in-depth analysis for individual crypto tokens.
 * Uses Perplexity sonar-pro with Binance + CoinGecko data.
 */
const fetch = require('node-fetch');
const { saveArticle } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const { gatedPerplexitySearch } = require('./perplexityGate');
const { resolveKnownEntity } = require('./entityResolver');

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

const SYSTEM_PROMPT = `You are Spectre AI's crypto research analyst. Write as "we" (Spectre AI). Professional hedge fund tone — data-driven, opinionated, rigorous.

Structure (use markdown headings):
## Overview
What this token is, its core value proposition, and current market position.

## Price Analysis
Current price, key levels, recent trend, volume analysis. Include specific support/resistance levels.

## Fundamentals
Network metrics, TVL (if DeFi), developer activity, token economics, supply schedule.

## Ecosystem
Partners, integrations, upcoming catalysts, competitive positioning.

## Risk Assessment
Key risks: regulatory, technical, competition, concentration. For meme tokens/microcaps: explicitly flag HIGH RISK and rug indicators.

## Spectre Verdict
Our opinionated conclusion — bullish, bearish, or neutral with specific reasoning. Include a 1-2 sentence summary at the end.

Rules:
- Include specific numbers, prices, percentages everywhere
- Bold key tickers like **BTC**, **ETH**
- Be brutally honest about risks
- For meme tokens: flag liquidity risks, holder concentration, rug pull indicators
- 800-1500 words
- Reference the latest available data
- End with a clear directional view

CONTENT LAW (non-negotiable):
- NO em-dashes anywhere. Split sentences or use commas/colons instead
- Paragraphs: maximum 3 sentences
- Do NOT place [1][2][3] citation markers in body text. Write clean prose
- Banned phrases: "delve into", "it's worth noting", "navigate", "landscape", "cutting-edge", "robust", "leverage" (as a verb), "seamlessly", "groundbreaking", "revolutionize", "transformative", "deep dive", "ever-evolving", "a testament to", "double-edged sword", "remains to be seen", "in today's", "pivotal", "realm"
- Every sentence earns its place. No filler, no throat-clearing`;

// Symbol -> CoinGecko ID mapping
const SYMBOL_TO_CG = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
  DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2', LINK: 'chainlink',
  DOT: 'polkadot', UNI: 'uniswap', LTC: 'litecoin', SHIB: 'shiba-inu',
  ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', FLOKI: 'floki', WIF: 'dogwifhat',
  AAVE: 'aave', MKR: 'maker', LDO: 'lido-dao', GRT: 'the-graph',
  RENDER: 'render-token', INJ: 'injective-protocol', FIL: 'filecoin',
  FET: 'fetch-ai', JUP: 'jupiter-exchange-solana', BONK: 'bonk',
  TIA: 'celestia', SEI: 'sei-network', SUI: 'sui', APT: 'aptos',
  MATIC: 'matic-network', TRX: 'tron', NEAR: 'near', ATOM: 'cosmos',
};

const MEME_TOKENS = new Set(['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'WIF', 'BONK']);

async function fetchTokenData(symbol, coinGeckoId) {
  const data = { symbol, price: null, change: null, marketCap: null, volume: null, rank: null };
  const cgId = coinGeckoId || SYMBOL_TO_CG[symbol.toUpperCase()];

  // Fetch from Binance
  try {
    const pair = `${symbol.toUpperCase()}USDT`;
    const bRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (bRes.ok) {
      const b = await bRes.json();
      data.price = parseFloat(b.lastPrice);
      data.change = parseFloat(b.priceChangePercent);
      data.volume = parseFloat(b.quoteVolume);
    }
  } catch (_) {}

  // Fetch from CoinGecko for market cap, rank, ATH
  if (cgId) {
    try {
      const url = `${COINGECKO_BASE}/coins/${cgId}?localization=false&tickers=false&community_data=false&developer_data=false`;
      const opts = { headers: {}, signal: AbortSignal.timeout(8000) };
      if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
      const cRes = await fetch(url, opts);
      if (cRes.ok) {
        const c = await cRes.json();
        data.name = c.name || symbol;
        data.marketCap = c.market_data?.market_cap?.usd || null;
        data.rank = c.market_cap_rank || null;
        data.ath = c.market_data?.ath?.usd || null;
        data.athChange = c.market_data?.ath_change_percentage?.usd || null;
        data.totalSupply = c.market_data?.total_supply || null;
        data.circulatingSupply = c.market_data?.circulating_supply || null;
        data.high24h = c.market_data?.high_24h?.usd || null;
        data.low24h = c.market_data?.low_24h?.usd || null;
        if (!data.price) data.price = c.market_data?.current_price?.usd || null;
        if (data.change == null) data.change = c.market_data?.price_change_percentage_24h || null;
        if (!data.volume) data.volume = c.market_data?.total_volume?.usd || null;
        data.categories = c.categories || [];
        data.description = (c.description?.en || '').slice(0, 200);
      }
    } catch (_) {}
  }

  return data;
}

function buildUserPrompt(symbol, data) {
  const isMeme = MEME_TOKENS.has(symbol.toUpperCase());
  let prompt = `Write a comprehensive analysis of ${data.name || symbol} (${symbol.toUpperCase()}).\n\nCurrent data:\n`;

  if (data.price) prompt += `- Price: $${data.price.toLocaleString()}\n`;
  if (data.change != null) prompt += `- 24h Change: ${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%\n`;
  if (data.marketCap) prompt += `- Market Cap: $${(data.marketCap / 1e9).toFixed(2)}B\n`;
  if (data.volume) prompt += `- 24h Volume: $${(data.volume / 1e6).toFixed(1)}M\n`;
  if (data.rank) prompt += `- CMC Rank: #${data.rank}\n`;
  if (data.ath) prompt += `- ATH: $${data.ath.toLocaleString()} (${data.athChange?.toFixed(1)}% from ATH)\n`;
  if (data.circulatingSupply) prompt += `- Circulating Supply: ${(data.circulatingSupply / 1e6).toFixed(1)}M\n`;

  if (isMeme) {
    prompt += `\nThis is a MEME TOKEN. Apply extra scrutiny for:\n- Holder concentration and whale risks\n- Liquidity depth\n- Rug pull indicators\n- Community sentiment vs fundamental value\n- Flag this as HIGH RISK in the Risk Assessment section.\n`;
  }

  prompt += `\nResearch the latest news, developments, and on-chain data for ${symbol.toUpperCase()}. Include specific numbers.`;
  return prompt;
}

async function generateTokenAnalysis(symbol, coinGeckoId) {
  const upper = symbol.toUpperCase();
  const slug = (SYMBOL_TO_CG[upper] || upper.toLowerCase()).replace(/[^a-z0-9-]/g, '');
  const startTime = Date.now();

  logAgentActivity({
    agent: 'token-analysis',
    action: 'started',
    target: upper,
    targetType: 'crypto',
    title: `Generating analysis for ${upper}`,
  });

  try {
    const tokenData = await fetchTokenData(upper, coinGeckoId);
    const userPrompt = buildUserPrompt(upper, tokenData);

    // Pre-resolve the known token entity
    const preResolved = resolveKnownEntity(upper);
    const gateResult = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 3000,
      model: 'sonar-pro',
      agentId: 'token-analysis',
      timeout: 45000,
      searchContextSize: 'medium',
      resolvedEntities: preResolved.confidence === 'confirmed' ? [preResolved] : undefined,
    });

    if (!gateResult || gateResult.type === 'ERROR') {
      throw new Error(gateResult?.error || 'All AI providers failed');
    }

    const content = gateResult.content || '';
    const citations = gateResult.citations || [];
    const data = { model: gateResult.model };
    const wordCount = content.split(/\s+/).length;

    const title = `${tokenData.name || upper} (${upper}) Analysis — Price, Fundamentals & Outlook | Spectre Intelligence`;
    const headline = `${tokenData.name || upper} (${upper}) Analysis`;

    const article = saveArticle({
      slug,
      type: 'crypto',
      title,
      headline,
      summary: content.replace(/[#*]/g, '').slice(0, 155).trim(),
      content,
      tickers: [upper],
      categories: tokenData.categories || [],
      tags: ['crypto', upper.toLowerCase(), 'analysis'],
      dataSnapshot: {
        price: tokenData.price,
        change: tokenData.change,
        marketCap: tokenData.marketCap,
        volume: tokenData.volume,
        rank: tokenData.rank,
      },
      sourcesCited: citations,
      model: data.model || 'sonar-pro',
      generationTimeMs: Date.now() - startTime,
    });

    logAgentActivity({
      agent: 'token-analysis',
      action: 'completed',
      target: upper,
      targetType: 'crypto',
      title: headline,
      wordCount,
      sourceCount: citations.length,
      generationTimeMs: Date.now() - startTime,
      price: tokenData.price,
      change: tokenData.change,
      slug,
    });

    console.log(`[token-analysis] Generated ${upper} (${wordCount} words, ${citations.length} sources, ${Date.now() - startTime}ms)`);
    return article;
  } catch (e) {
    logAgentActivity({
      agent: 'token-analysis',
      action: 'failed',
      target: upper,
      targetType: 'crypto',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[token-analysis] Failed for ${upper}:`, e.message);
    return null;
  }
}

module.exports = { generateTokenAnalysis, SYMBOL_TO_CG };
