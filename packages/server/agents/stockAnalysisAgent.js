/**
 * Spectre Intelligence Hub — Stock Analysis Agent
 * Generates in-depth analysis for individual stocks.
 * Uses Perplexity sonar-pro with Yahoo Finance data.
 */
const fetch = require('node-fetch');
const path = require('path');
const { saveArticle } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const { gatedPerplexitySearch } = require('./perplexityGate');
const { resolveKnownEntity } = require('./entityResolver');
const SERVER_BASE = `http://localhost:${process.env.PORT || 3001}`;

const SYSTEM_PROMPT = `You are Spectre AI's senior equity research analyst. Write as "we" (Spectre AI). Professional hedge fund tone — data-driven, opinionated, rigorous.

Structure (use markdown headings):
## Company Overview
What the company does, sector positioning, key products/services, market opportunity.

## Financial Analysis
Revenue, earnings, margins, growth rates. Reference latest quarterly results. Compare to consensus estimates.

## Valuation
P/E, forward P/E, EV/EBITDA vs sector peers. Is it expensive or cheap relative to growth? Include specific multiples.

## Growth Catalysts
3-5 specific catalysts that could drive the stock higher. Include timelines where possible.

## Risk Factors
3-5 specific risks. Competitive threats, regulatory, macro sensitivity, valuation risk.

## Spectre Verdict
Our opinionated conclusion — bullish, bearish, or neutral with specific reasoning. Include a price target range if data supports it.

Rules:
- Include specific numbers, prices, percentages everywhere
- Bold key tickers like **NVDA**, **AAPL**
- Reference latest earnings, guidance, and analyst estimates
- Compare to sector peers where relevant
- 800-1500 words
- Be direct and opinionated, not wishy-washy

CONTENT LAW (non-negotiable):
- NO em-dashes anywhere. Split sentences or use commas/colons instead
- Paragraphs: maximum 3 sentences
- Do NOT place [1][2][3] citation markers in body text. Write clean prose
- Banned phrases: "delve into", "it's worth noting", "navigate", "landscape", "cutting-edge", "robust", "leverage" (as a verb), "seamlessly", "groundbreaking", "revolutionize", "transformative", "deep dive", "ever-evolving", "a testament to", "double-edged sword", "remains to be seen", "in today's", "pivotal", "realm"
- Every sentence earns its place. No filler, no throat-clearing`;

// Stock info for slug generation
const STOCK_INFO = {
  AAPL: { name: 'Apple', slug: 'apple', sector: 'Technology' },
  MSFT: { name: 'Microsoft', slug: 'microsoft', sector: 'Technology' },
  GOOGL: { name: 'Alphabet', slug: 'alphabet', sector: 'Technology' },
  AMZN: { name: 'Amazon', slug: 'amazon', sector: 'Consumer Cyclical' },
  NVDA: { name: 'NVIDIA', slug: 'nvidia', sector: 'Technology' },
  META: { name: 'Meta Platforms', slug: 'meta', sector: 'Technology' },
  TSLA: { name: 'Tesla', slug: 'tesla', sector: 'Consumer Cyclical' },
  JPM: { name: 'JPMorgan Chase', slug: 'jpmorgan', sector: 'Financial' },
  V: { name: 'Visa', slug: 'visa', sector: 'Financial' },
  JNJ: { name: 'Johnson & Johnson', slug: 'johnson-johnson', sector: 'Healthcare' },
  UNH: { name: 'UnitedHealth', slug: 'unitedhealth', sector: 'Healthcare' },
  HD: { name: 'Home Depot', slug: 'home-depot', sector: 'Consumer Cyclical' },
  PG: { name: 'Procter & Gamble', slug: 'procter-gamble', sector: 'Consumer Defensive' },
  MA: { name: 'Mastercard', slug: 'mastercard', sector: 'Financial' },
  DIS: { name: 'Disney', slug: 'disney', sector: 'Communication' },
  NFLX: { name: 'Netflix', slug: 'netflix', sector: 'Communication' },
  PYPL: { name: 'PayPal', slug: 'paypal', sector: 'Financial' },
  ADBE: { name: 'Adobe', slug: 'adobe', sector: 'Technology' },
  CRM: { name: 'Salesforce', slug: 'salesforce', sector: 'Technology' },
  INTC: { name: 'Intel', slug: 'intel', sector: 'Technology' },
  AMD: { name: 'AMD', slug: 'amd', sector: 'Technology' },
  PEP: { name: 'PepsiCo', slug: 'pepsico', sector: 'Consumer Defensive' },
  KO: { name: 'Coca-Cola', slug: 'coca-cola', sector: 'Consumer Defensive' },
  LLY: { name: 'Eli Lilly', slug: 'eli-lilly', sector: 'Healthcare' },
  ORCL: { name: 'Oracle', slug: 'oracle', sector: 'Technology' },
  COIN: { name: 'Coinbase', slug: 'coinbase', sector: 'Financial' },
  PLTR: { name: 'Palantir', slug: 'palantir', sector: 'Technology' },
  ARM: { name: 'ARM Holdings', slug: 'arm', sector: 'Technology' },
};

async function fetchStockData(symbol) {
  const data = { symbol, price: null, change: null, marketCap: null, volume: null };
  const info = STOCK_INFO[symbol] || {};
  data.name = info.name || symbol;
  data.sector = info.sector || '';

  // Fetch quote from our server
  try {
    const qRes = await fetch(`${SERVER_BASE}/api/stocks/quote/${symbol}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (qRes.ok) {
      const q = await qRes.json();
      data.price = q.price || null;
      data.change = q.change || null;
      data.volume = q.volume || null;
      data.name = q.name || data.name;
      data.week52High = q.week52High || null;
      data.week52Low = q.week52Low || null;
    }
  } catch (_) {}

  // Fetch fundamentals from our server
  try {
    const fRes = await fetch(`${SERVER_BASE}/api/stocks/fundamentals/${symbol}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (fRes.ok) {
      const f = await fRes.json();
      data.marketCap = f.marketCap || null;
      data.pe = f.pe || null;
      data.forwardPe = f.forwardPe || null;
      data.eps = f.eps || null;
      data.dividendYield = f.dividendYield || null;
      data.beta = f.beta || null;
    }
  } catch (_) {}

  return data;
}

function buildUserPrompt(symbol, data) {
  let prompt = `Write a comprehensive analysis of ${data.name} (${symbol}).\n\nCurrent data:\n`;

  if (data.price) prompt += `- Price: $${data.price.toFixed(2)}\n`;
  if (data.change != null) prompt += `- 24h Change: ${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%\n`;
  if (data.marketCap) prompt += `- Market Cap: $${(data.marketCap / 1e9).toFixed(1)}B\n`;
  if (data.pe) prompt += `- P/E Ratio: ${data.pe.toFixed(1)}\n`;
  if (data.forwardPe) prompt += `- Forward P/E: ${data.forwardPe.toFixed(1)}\n`;
  if (data.eps) prompt += `- EPS: $${data.eps.toFixed(2)}\n`;
  if (data.volume) prompt += `- Volume: ${(data.volume / 1e6).toFixed(1)}M\n`;
  if (data.week52High) prompt += `- 52W High: $${data.week52High.toFixed(2)}\n`;
  if (data.week52Low) prompt += `- 52W Low: $${data.week52Low.toFixed(2)}\n`;
  if (data.sector) prompt += `- Sector: ${data.sector}\n`;
  if (data.dividendYield) prompt += `- Dividend Yield: ${(data.dividendYield * 100).toFixed(2)}%\n`;

  prompt += `\nResearch the latest earnings, analyst ratings, news, and developments for ${symbol}. Include specific financial metrics and peer comparisons.`;
  return prompt;
}

async function generateStockAnalysis(symbol) {
  const upper = symbol.toUpperCase();
  const info = STOCK_INFO[upper] || {};
  const slug = info.slug || upper.toLowerCase();
  const startTime = Date.now();

  logAgentActivity({
    agent: 'stock-analysis',
    action: 'started',
    target: upper,
    targetType: 'stock',
    title: `Generating analysis for ${upper}`,
  });

  try {
    const stockData = await fetchStockData(upper);
    const userPrompt = buildUserPrompt(upper, stockData);

    // Pre-resolve the known stock entity
    const preResolved = resolveKnownEntity(upper);
    const gateResult = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 3000,
      model: 'sonar-pro',
      agentId: 'stock-analysis',
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

    const title = `${stockData.name} (${upper}) Analysis — Financials, Valuation & Outlook | Spectre Intelligence`;
    const headline = `${stockData.name} (${upper}) Analysis`;

    const article = saveArticle({
      slug,
      type: 'stocks',
      title,
      headline,
      summary: content.replace(/[#*]/g, '').slice(0, 155).trim(),
      content,
      tickers: [upper],
      categories: [stockData.sector || 'Equity'],
      tags: ['stocks', upper.toLowerCase(), 'analysis', (stockData.sector || '').toLowerCase()],
      dataSnapshot: {
        price: stockData.price,
        change: stockData.change,
        marketCap: stockData.marketCap,
        pe: stockData.pe,
        volume: stockData.volume,
      },
      sourcesCited: citations,
      model: data.model || 'sonar-pro',
      generationTimeMs: Date.now() - startTime,
    });

    logAgentActivity({
      agent: 'stock-analysis',
      action: 'completed',
      target: upper,
      targetType: 'stock',
      title: headline,
      wordCount,
      sourceCount: citations.length,
      generationTimeMs: Date.now() - startTime,
      price: stockData.price,
      change: stockData.change,
      slug,
    });

    console.log(`[stock-analysis] Generated ${upper} (${wordCount} words, ${citations.length} sources, ${Date.now() - startTime}ms)`);
    return article;
  } catch (e) {
    logAgentActivity({
      agent: 'stock-analysis',
      action: 'failed',
      target: upper,
      targetType: 'stock',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[stock-analysis] Failed for ${upper}:`, e.message);
    return null;
  }
}

module.exports = { generateStockAnalysis, STOCK_INFO };
