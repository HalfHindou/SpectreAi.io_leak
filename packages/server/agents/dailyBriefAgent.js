/**
 * Spectre Intelligence Hub — Daily Brief Agent
 * Generates a comprehensive daily market brief covering crypto + stocks.
 * Uses Perplexity sonar-pro with data context from existing endpoints.
 */
const fetch = require('node-fetch');
const { saveArticle } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const { gatedPerplexitySearch } = require('./perplexityGate');
const SERVER_BASE = `http://localhost:${process.env.PORT || 3001}`;

const SYSTEM_PROMPT = `You are Spectre AI's senior market analyst writing the daily intelligence brief. Write as "we" (Spectre AI). Hedge fund tone — professional, data-driven, opinionated. NOT a blog post.

Structure (use markdown headings):
## Market Overview
Brief 2-3 paragraph summary of today's key market themes.

## Crypto Markets
BTC, ETH, SOL analysis with exact prices. Top movers. ETF flows if relevant. DeFi/on-chain notable events.

## Stock Markets
Major indices performance. Sector rotation. Notable earnings/events. Key movers with percentages.

## Cross-Market Signals
Correlations between crypto and equities. Macro factors (Fed, inflation, yields). Risk sentiment.

## What We're Watching
3-5 bullet points of key events/levels to monitor in the next 24-48 hours.

Rules:
- Include specific numbers, prices, and percentages everywhere
- Bold key tickers like **BTC**, **ETH**, **NVDA**
- Be honest. If markets are weak, say it
- End with a clear directional view, not wishy-washy
- 1200-2000 words
- Reference today's date in context
- Do NOT use bullet points excessively. Use flowing prose with data inline

CONTENT LAW (non-negotiable):
- NO em-dashes anywhere. Split sentences or use commas/colons instead
- Paragraphs: maximum 3 sentences
- Do NOT place [1][2][3] citation markers in body text. Write clean prose
- Banned phrases: "delve into", "it's worth noting", "navigate", "landscape", "cutting-edge", "robust", "leverage" (as a verb), "seamlessly", "groundbreaking", "revolutionize", "transformative", "deep dive", "ever-evolving", "a testament to", "double-edged sword", "remains to be seen", "in today's", "pivotal", "realm"
- Every sentence earns its place. No filler, no throat-clearing`;

async function fetchDataContext() {
  const context = {};

  // Fetch in parallel
  const [tickersRes, moversRes, indicesRes, fearRes, btcRes, ethRes, solRes] = await Promise.allSettled([
    fetch(`${SERVER_BASE}/api/market/tickers`).then(r => r.json()).catch(() => null),
    fetch(`${SERVER_BASE}/api/stocks/movers`).then(r => r.json()).catch(() => null),
    fetch(`${SERVER_BASE}/api/stocks/indices`).then(r => r.json()).catch(() => null),
    fetch('https://api.alternative.me/fng/').then(r => r.json()).catch(() => null),
    fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT').then(r => r.json()).catch(() => null),
    fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT').then(r => r.json()).catch(() => null),
    fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT').then(r => r.json()).catch(() => null),
  ]);

  if (tickersRes.status === 'fulfilled' && tickersRes.value) {
    const t = tickersRes.value;
    context.cryptoTopGainers = (t.topGainers || []).slice(0, 5).map(c => `${c.symbol}: $${c.price?.toLocaleString()} (${c.change > 0 ? '+' : ''}${c.change?.toFixed(1)}%)`).join(', ');
    context.cryptoTopLosers = (t.topLosers || []).slice(0, 5).map(c => `${c.symbol}: $${c.price?.toLocaleString()} (${c.change?.toFixed(1)}%)`).join(', ');
    if (t.majorCoins) {
      context.btcPrice = t.majorCoins.btc?.price;
      context.ethPrice = t.majorCoins.eth?.price;
      context.solPrice = t.majorCoins.sol?.price;
    }
  }
  if (moversRes.status === 'fulfilled' && moversRes.value) {
    const m = moversRes.value;
    context.stockGainers = (m.gainers || []).slice(0, 5).map(s => `${s.symbol}: $${s.price?.toFixed(2)} (${s.change > 0 ? '+' : ''}${s.change?.toFixed(1)}%)`).join(', ');
    context.stockLosers = (m.losers || []).slice(0, 5).map(s => `${s.symbol}: $${s.price?.toFixed(2)} (${s.change?.toFixed(1)}%)`).join(', ');
  }
  if (indicesRes.status === 'fulfilled' && Array.isArray(indicesRes.value)) {
    context.indices = indicesRes.value.map(i => `${i.name}: ${i.price?.toLocaleString()} (${i.change > 0 ? '+' : ''}${i.change?.toFixed(2)}%)`).join(', ');
  }
  if (fearRes.status === 'fulfilled' && fearRes.value?.data?.[0]) {
    const fg = fearRes.value.data[0];
    context.fearGreed = `${fg.value} (${fg.value_classification})`;
  }
  if (btcRes.status === 'fulfilled' && btcRes.value) {
    context.btcPrice = context.btcPrice || parseFloat(btcRes.value.lastPrice);
    context.btcChange = parseFloat(btcRes.value.priceChangePercent);
    context.btcVolume = parseFloat(btcRes.value.quoteVolume);
  }
  if (ethRes.status === 'fulfilled' && ethRes.value) {
    context.ethPrice = context.ethPrice || parseFloat(ethRes.value.lastPrice);
    context.ethChange = parseFloat(ethRes.value.priceChangePercent);
  }
  if (solRes.status === 'fulfilled' && solRes.value) {
    context.solPrice = context.solPrice || parseFloat(solRes.value.lastPrice);
    context.solChange = parseFloat(solRes.value.priceChangePercent);
  }

  return context;
}

function buildUserPrompt(date, context) {
  let prompt = `Write the Spectre AI Daily Intelligence Brief for ${date}.\n\nCurrent market data:\n`;

  if (context.btcPrice) prompt += `- BTC: $${Number(context.btcPrice).toLocaleString()} (${context.btcChange > 0 ? '+' : ''}${context.btcChange?.toFixed(1)}% 24h)\n`;
  if (context.ethPrice) prompt += `- ETH: $${Number(context.ethPrice).toLocaleString()}\n`;
  if (context.solPrice) prompt += `- SOL: $${Number(context.solPrice).toLocaleString()}\n`;
  if (context.fearGreed) prompt += `- Fear & Greed Index: ${context.fearGreed}\n`;
  if (context.indices) prompt += `- Indices: ${context.indices}\n`;
  if (context.cryptoTopGainers) prompt += `- Crypto top gainers: ${context.cryptoTopGainers}\n`;
  if (context.cryptoTopLosers) prompt += `- Crypto top losers: ${context.cryptoTopLosers}\n`;
  if (context.stockGainers) prompt += `- Stock gainers: ${context.stockGainers}\n`;
  if (context.stockLosers) prompt += `- Stock losers: ${context.stockLosers}\n`;

  prompt += `\nUse the above data as a starting point, but research the latest news and events for today. Include ETF flows, earnings, Fed/macro events, and any major crypto developments.`;
  return prompt;
}

async function generateDailyBrief(dateStr) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  const slug = today; // e.g. "2026-02-19"
  const startTime = Date.now();

  logAgentActivity({
    agent: 'market-brief',
    action: 'started',
    target: today,
    targetType: 'daily',
    title: `Generating daily brief for ${today}`,
  });

  try {
    const context = await fetchDataContext();
    const userPrompt = buildUserPrompt(today, context);

    const gateResult = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 4000,
      model: 'sonar-pro',
      agentId: 'daily-brief',
      timeout: 60000,
      searchContextSize: 'high',
      skipResolution: true, // broad market query, no specific entities
    });

    if (!gateResult || gateResult.type === 'ERROR') {
      throw new Error(gateResult?.error || 'All AI providers failed');
    }

    const content = gateResult.content || '';
    const citations = gateResult.citations || [];
    const data = { model: gateResult.model };
    const wordCount = content.split(/\s+/).length;

    // Extract headline from first line or generate one
    const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
    const headline = firstLine.replace(/^#+\s*/, '').slice(0, 120) || `Crypto & Stock Market Brief — ${today}`;

    // Parse YYYY-MM-DD manually to avoid timezone shifting issues
    const [yyyy, mm, dd] = today.split('-');
    const displayDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const article = saveArticle({
      slug,
      type: 'daily',
      title: `Daily Market Brief — ${displayDate} | Spectre Intelligence`,
      headline,
      summary: content.replace(/[#*]/g, '').slice(0, 155).trim(),
      content,
      tickers: ['BTC', 'ETH', 'SOL'],
      categories: ['daily-brief'],
      tags: ['daily', 'market-brief', 'crypto', 'stocks'],
      dataSnapshot: {
        btcPrice: context.btcPrice || null,
        btcChange: context.btcChange || null,
        ethPrice: context.ethPrice || null,
        ethChange: context.ethChange || null,
        solPrice: context.solPrice || null,
        solChange: context.solChange || null,
        fearGreed: context.fearGreed || null,
      },
      sourcesCited: citations,
      model: data.model || 'sonar-pro',
      generationTimeMs: Date.now() - startTime,
    });

    logAgentActivity({
      agent: 'market-brief',
      action: 'completed',
      target: today,
      targetType: 'daily',
      title: headline,
      wordCount,
      sourceCount: citations.length,
      generationTimeMs: Date.now() - startTime,
      slug,
    });

    console.log(`[daily-brief] Generated "${headline}" (${wordCount} words, ${citations.length} sources, ${Date.now() - startTime}ms)`);
    return article;
  } catch (e) {
    logAgentActivity({
      agent: 'market-brief',
      action: 'failed',
      target: today,
      targetType: 'daily',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[daily-brief] Failed for ${today}:`, e.message);
    return null;
  }
}

module.exports = { generateDailyBrief };
