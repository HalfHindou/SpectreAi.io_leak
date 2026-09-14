'use strict';

/**
 * Spectre Search Engine — SSE streaming answer engine
 * ════════════════════════════════════════════════════════════════
 *
 * POST /query           — SSE stream: data-first, then LLM text
 * POST /autocomplete    — JSON, debounced symbol/query suggestions
 * GET  /trending        — JSON, cached 30s, trending research cards
 * GET  /permalink/:id   — JSON, cached 60s, replay a past query
 * POST /related         — JSON, "People Also Ask" generation
 *
 * Architecture:
 *   1. Classify query → one of 18 types
 *   2. Plan endpoints based on classification + mode (quick/thesis)
 *   3. Fan-out parallel fetches to Spectre Data API
 *   4. Stream data events as each resolves (data-first paint)
 *   5. Build system prompt with structured data + citation map
 *   6. Stream LLM answer via Groq with inline [n] citations
 *   7. Emit related questions + done event
 *
 * Does NOT touch Monarch. Does NOT crawl the web. Every number
 * comes from a Spectre endpoint — that's the moat.
 * ════════════════════════════════════════════════════════════════
 */

const express = require('express');
const crypto = require('node:crypto');
const { chatStream: gatewayChatStream } = require('../lib/llm-gateway');
const router = express.Router();

// ── CONFIG ───────────────────────────────────────────────────────────────────

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai';
const LLM_MODEL = process.env.LLM_MODEL || 'openai/gpt-oss-120b';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';

const SPECTRE_API_BASE = process.env.SPECTRE_API_BASE_URL || process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850';
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_BRIDGE_KEY || process.env.SPECTRE_API_KEY;
if (!SPECTRE_API_KEY) console.warn('[search-engine] SPECTRE_DATA_BRIDGE_KEY/SPECTRE_API_KEY not set - search-engine will fail upstream');
const SPECTRE_TIMEOUT_MS = 8000;

// ── RATE LIMITER ─────────────────────────────────────────────────────────────

const rlHits = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of rlHits) { if (n - v.start > 60_000) rlHits.delete(k); } }, 60_000);
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const entry = rlHits.get(ip) || { count: 0, start: Date.now() };
  entry.count++;
  rlHits.set(ip, entry);
  if (entry.count > 20) return res.status(429).json({ error: 'Rate limit exceeded' });
  next();
}

// ── SPECTRE DATA API FETCH ──────────────────────────────────────────────────

async function spectreFetch(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${SPECTRE_API_BASE}${path}`, {
      headers: { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SPECTRE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, data: null, latency_ms: Date.now() - t0 };
    const data = await res.json();
    return { ok: true, data: data?.data ?? data, latency_ms: Date.now() - t0 };
  } catch (_e) {
    return { ok: false, data: null, latency_ms: Date.now() - t0 };
  }
}

// ── SSE HELPERS ─────────────────────────────────────────────────────────────

function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function send(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendText(res, content) {
  if (res.writableEnded) return;
  res.write(`event: text\ndata: ${JSON.stringify(content)}\n\n`);
}

// ── QUERY ID ────────────────────────────────────────────────────────────────

function genQueryId(query, mode, focus) {
  const hash = crypto.createHash('sha256').update(`${query}:${mode}:${focus}`).digest('hex').slice(0, 12);
  return `q_${hash}`;
}

// ── ASSET DETECTION ─────────────────────────────────────────────────────────

const KNOWN_TICKERS = new Set([
  'BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT',
  'MATIC','ARB','OP','SUI','APT','TON','NEAR','ATOM','FTM','INJ',
  'TIA','SEI','PEPE','SHIB','WIF','BONK','JUP','RNDR','FET','TAO',
  'UNI','AAVE','LDO','MKR','CRV','SNX','COMP','PENDLE','HBAR','XLM',
  'LTC','BCH','ETC','FIL','ICP','VET','ALGO','EGLD','SAND','MANA',
  'AXS','GALA','DYDX','GMX','ENS','ONDO','ENA','TRX','HYPE','MON',
  'BERA','ZRO','EIGEN','W','STRK','ZK','SCR','BLAST','IP','IO',
  'PUFFER','REZ','ME','IMX','HNT','PYTH','GRT',
]);

// Also add lowercase ticker abbreviations — users type "btc" not "$BTC" in natural language
const SYMBOL_ALIASES = {
  bitcoin: 'BTC', btc: 'BTC',
  ethereum: 'ETH', eth: 'ETH',
  solana: 'SOL', sol: 'SOL',
  binance: 'BNB', bnb: 'BNB',
  ripple: 'XRP', xrp: 'XRP',
  cardano: 'ADA', ada: 'ADA',
  polkadot: 'DOT', dot: 'DOT',
  avalanche: 'AVAX', avax: 'AVAX',
  chainlink: 'LINK', link: 'LINK',
  polygon: 'MATIC', matic: 'MATIC',
  dogecoin: 'DOGE', doge: 'DOGE',
  litecoin: 'LTC', ltc: 'LTC',
  uniswap: 'UNI', uni: 'UNI', aave: 'AAVE', tron: 'TRX', trx: 'TRX',
  toncoin: 'TON', ton: 'TON', near: 'NEAR', atom: 'ATOM', cosmos: 'ATOM',
  celestia: 'TIA', tia: 'TIA', injective: 'INJ', inj: 'INJ',
  aptos: 'APT', apt: 'APT', sui: 'SUI',
  optimism: 'OP', arbitrum: 'ARB', arb: 'ARB',
  render: 'RNDR', rndr: 'RNDR', helium: 'HNT', hnt: 'HNT',
  bittensor: 'TAO', tao: 'TAO', filecoin: 'FIL', fil: 'FIL',
  pepe: 'PEPE', shib: 'SHIB', bonk: 'BONK', wif: 'WIF',
  ondo: 'ONDO', eigen: 'EIGEN', sei: 'SEI', hype: 'HYPE',
};

const CHAIN_NAMES = new Set([
  'ethereum', 'base', 'arbitrum', 'bsc', 'polygon', 'avalanche',
  'optimism', 'solana', 'fantom', 'blast',
]);

function detectAssets(text) {
  const lc = text.toLowerCase();
  const assets = new Set();

  // $SYMBOL tickers
  const tickerHits = lc.match(/\$([a-z][a-z0-9]{1,9})\b/g);
  if (tickerHits) for (const h of tickerHits) {
    const sym = h.slice(1).toUpperCase();
    if (KNOWN_TICKERS.has(sym)) assets.add(sym);
  }

  // Alias matches
  for (const [alias, sym] of Object.entries(SYMBOL_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(text)) assets.add(sym);
  }

  // Bare CAPS tickers in mixed-case text
  const hasLower = /[a-z]/.test(text);
  if (hasLower) {
    const capsHits = text.match(/\b[A-Z][A-Z0-9]{1,5}\b/g);
    if (capsHits) for (const h of capsHits) {
      if (KNOWN_TICKERS.has(h)) assets.add(h);
    }
  }

  return [...assets].slice(0, 4);
}

function detectChain(text) {
  const lc = text.toLowerCase();
  for (const chain of CHAIN_NAMES) {
    if (new RegExp(`\\b${chain}\\b`).test(lc)) return chain;
  }
  return null;
}

// ── 18-WAY CLASSIFICATION ───────────────────────────────────────────────────

function classifyQuery(query, focus, assets) {
  const text = query.toLowerCase();
  const has = (...kws) => kws.some((k) => text.includes(k));

  // Wallet address
  if (/^0x[a-fA-F0-9]{40}$/.test(query.trim()) || /\.eth$/.test(query.trim())) return 'WALLET_LOOKUP';

  // Focus override
  if (focus !== 'all') {
    const focusMap = {
      tokens: 'ASSET_ANALYSIS', defi: 'DEFI', onchain: 'ONCHAIN',
      derivatives: 'DERIVATIVES', news: 'NEWS', discovery: 'DISCOVERY',
      macro: 'MACRO', whales: 'WHALE_TRACKING',
    };
    if (focusMap[focus] && assets.length > 0 && focus === 'tokens') return 'ASSET_ANALYSIS';
    if (focusMap[focus]) return focusMap[focus];
  }

  // Due diligence
  if (has('should i buy', 'worth buying', 'good investment', 'due diligence', 'grade', 'institutional score', 'conviction', 'fundamentals')) return 'DUE_DILIGENCE';

  // Comparison
  if (assets.length >= 2 || has(' vs ', ' versus ', 'compare', 'comparison', 'which is better')) return 'COMPARISON';

  // Market overview
  if (has('market', 'overview', 'happening', 'brief', 'today in crypto', 'market pulse', 'big picture')) return 'MARKET_OVERVIEW';

  // Derivatives
  if (has('funding', 'liquidat', 'open interest', ' oi ', 'futures', 'perp', 'basis')) return 'DERIVATIVES';

  // Whale
  if (has('whale', 'smart money', 'large holder', 'accumulation')) return 'WHALE_TRACKING';

  // News
  if (has('news', 'breaking', 'headline', 'latest')) return 'NEWS';

  // Discovery
  if (has('new token', 'gem', 'alpha', 'just launched', 'what\'s hot', 'degen', 'microcap', 'discover')) return 'DISCOVERY';

  // Movers
  if (has('top gainers', 'biggest losers', 'pumping', 'dumping', 'movers')) return 'MOVERS';

  // DeFi
  if (has('tvl', 'defi', 'protocol', 'yield', 'lending')) return 'DEFI';

  // Stablecoins
  if (has('stablecoin', 'usdt', 'usdc', 'depeg', 'peg')) return 'STABLECOINS';

  // On-chain
  if (has('holder', 'gas', 'exchange flow', 'active address', 'on-chain', 'onchain')) return 'ONCHAIN';

  // Macro
  if (has('fed ', 'cpi', 'interest rate', ' dxy', 'gold', ' spy', 'macro', 'treasury')) return 'MACRO';

  // Mindshare
  if (has('narrative', 'mindshare', 'attention', 'trending')) return 'MINDSHARE';

  // Meme
  if (has('meme', 'dog coin', 'pepe', ' wif')) return 'MEME_ALPHA';

  // NFT
  if (has('nft', 'floor', 'collection', 'mint')) return 'NFT';

  // Single asset analysis (most common default)
  if (assets.length === 1) return 'ASSET_ANALYSIS';

  return 'GENERAL';
}

// ── ENDPOINT PLANNER ────────────────────────────────────────────────────────

function planEndpoints(classification, assets, mode, chain) {
  const asset = assets[0] || 'BTC';
  const isThesis = mode === 'thesis';

  const plans = {
    ASSET_ANALYSIS: [
      { slot: 'price', url: `/v1/prices/${asset}`, priority: 1, label: `prices/${asset}` },
      { slot: 'technicals', url: `/v1/technicals/${asset}`, priority: 1, label: `technicals/${asset}` },
      { slot: 'chart', url: `/v1/candles/${asset}?exchange=binance&interval=1h&limit=168`, priority: 1, label: `candles/${asset}` },
      { slot: 'institutional', url: `/v1/institutional/scores/${asset}`, priority: 2, label: `institutional/${asset}` },
      ...(isThesis ? [
        { slot: 'derivatives', url: `/v1/derivatives/composite/dashboard/${asset}`, priority: 2, label: `derivatives/${asset}` },
        { slot: 'news', url: '/v1/news?limit=5', priority: 3, label: 'news' },
        { slot: 'signals', url: '/v1/intelligence/signals?limit=8', priority: 3, label: 'signals' },
        { slot: 'whales', url: `/v1/smart-money/whale-transactions?limit=5`, priority: 3, label: 'whales' },
      ] : []),
    ],

    DUE_DILIGENCE: [
      { slot: 'price', url: `/v1/prices/${asset}`, priority: 1, label: `prices/${asset}` },
      { slot: 'institutional', url: `/v1/institutional/scores/${asset}`, priority: 1, label: `institutional/${asset}` },
      { slot: 'technicals', url: `/v1/technicals/${asset}`, priority: 1, label: `technicals/${asset}` },
      { slot: 'chart', url: `/v1/candles/${asset}?exchange=binance&interval=1d&limit=90`, priority: 2, label: `candles/${asset}` },
      { slot: 'news', url: '/v1/news?limit=5', priority: 2, label: 'news' },
      ...(isThesis ? [
        { slot: 'signals', url: '/v1/intelligence/signals?limit=8', priority: 3, label: 'signals' },
        { slot: 'whales', url: `/v1/smart-money/whale-transactions?limit=5`, priority: 3, label: 'whales' },
        { slot: 'derivatives', url: `/v1/derivatives/composite/dashboard/${asset}`, priority: 3, label: `derivatives/${asset}` },
      ] : []),
    ],

    COMPARISON: (() => {
      const items = [];
      for (const a of assets.slice(0, 4)) {
        items.push(
          { slot: `price_${a}`, url: `/v1/prices/${a}`, priority: 1, label: `prices/${a}` },
          { slot: `technicals_${a}`, url: `/v1/technicals/${a}`, priority: 1, label: `technicals/${a}` },
          { slot: `institutional_${a}`, url: `/v1/institutional/scores/${a}`, priority: 2, label: `institutional/${a}` },
        );
      }
      return items;
    })(),

    MARKET_OVERVIEW: [
      { slot: 'global', url: '/v1/global', priority: 1, label: 'global' },
      { slot: 'feargreed', url: '/v1/sentiment/fear-greed', priority: 1, label: 'fear-greed' },
      { slot: 'gainers', url: '/v1/movers/gainers?limit=5', priority: 1, label: 'gainers' },
      { slot: 'losers', url: '/v1/movers/losers?limit=5', priority: 1, label: 'losers' },
      { slot: 'signals', url: '/v1/intelligence/signals?limit=8', priority: 2, label: 'signals' },
      ...(isThesis ? [
        { slot: 'news', url: '/v1/news?limit=5', priority: 3, label: 'news' },
      ] : []),
    ],

    DERIVATIVES: [
      { slot: 'funding', url: '/v1/derivatives/composite/funding', priority: 1, label: 'funding' },
      { slot: 'liquidations', url: '/v1/derivatives/composite/liquidations', priority: 1, label: 'liquidations' },
      ...(asset !== 'BTC' ? [] : [
        { slot: 'dashboard', url: `/v1/derivatives/composite/dashboard/${asset}`, priority: 1, label: `derivatives/${asset}` },
      ]),
    ],

    WHALE_TRACKING: [
      { slot: 'whales', url: `/v1/smart-money/whale-transactions?limit=20`, priority: 1, label: 'whales' },
    ],

    NEWS: [
      { slot: 'news', url: '/v1/news?limit=10', priority: 1, label: 'news' },
      { slot: 'breaking', url: '/v1/news/breaking', priority: 1, label: 'breaking' },
    ],

    DISCOVERY: [
      { slot: 'hot', url: `/v1/discovery/hot${chain ? `?chain=${chain}` : ''}`, priority: 1, label: 'discovery/hot' },
      { slot: 'new', url: `/v1/discovery/new${chain ? `?chain=${chain}` : ''}`, priority: 1, label: 'discovery/new' },
    ],

    MOVERS: [
      { slot: 'gainers', url: '/v1/movers/gainers?limit=10', priority: 1, label: 'gainers' },
      { slot: 'losers', url: '/v1/movers/losers?limit=10', priority: 1, label: 'losers' },
    ],

    DEFI: [
      { slot: 'protocols', url: '/v1/defi/protocols?limit=15', priority: 1, label: 'defi/protocols' },
      { slot: 'stablecoins', url: '/v1/stablecoins', priority: 2, label: 'stablecoins' },
    ],

    STABLECOINS: [
      { slot: 'stablecoins', url: '/v1/stablecoins', priority: 1, label: 'stablecoins' },
    ],

    ONCHAIN: [
      { slot: 'gas', url: '/v1/gas', priority: 1, label: 'gas' },
    ],

    MACRO: [
      { slot: 'global', url: '/v1/global', priority: 1, label: 'global' },
      { slot: 'feargreed', url: '/v1/sentiment/fear-greed', priority: 1, label: 'fear-greed' },
    ],

    MINDSHARE: [
      { slot: 'signals', url: '/v1/intelligence/signals?limit=8', priority: 1, label: 'signals' },
    ],
  };

  // Fallbacks for classifications without dedicated plans
  const plan = plans[classification]
    || plans.MARKET_OVERVIEW; // safe default

  // Budget limits
  const maxEndpoints = isThesis ? 14 : 4;
  return plan
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxEndpoints);
}

// ── SYSTEM PROMPT BUILDER ───────────────────────────────────────────────────

function buildSearchPrompt(intent, mode, results, citations) {
  const citationMap = citations.map((c) => `[${c.id}] → ${c.label}`).join('\n');
  const dataDump = results.map((d) => {
    const payload = typeof d.payload === 'object' ? JSON.stringify(d.payload, null, 2) : String(d.payload);
    // Cap each data block at 2000 chars to stay within prompt budget
    const capped = payload.length > 2000 ? payload.slice(0, 2000) + '\n...(truncated)' : payload;
    return `### ${d.slot} (cite as [${d.id}])\n${capped}`;
  }).join('\n\n');

  const baseRules = `RULES
- Number formatting: NEVER wrap numbers in backticks/code. NEVER write \`78385.1\` — write **$78,385** or **$78,385.10**. Use **bold** for headline numbers (price, RSI, key levels), plain text for supporting numbers. Format $ amounts with thousands separators, percentages with one decimal + sign (+1.2%, -2.94%), RSI with one decimal (RSI 63.6).
- Citations: ONE inline [n] chip per claim, placed at the END of the sentence or independent clause. NOT after every number. NEVER chain like "[1][2][3]"; pick the most authoritative source.
- No "I", no "As an AI", no filler. You are a market analyst briefing a trading desk, not a chatbot.
- Never invent numbers. If the data does not contain a number, do not write it.
- Never mention web sources. Every citation is a Spectre endpoint.
- Be specific: "$73,437" not "around $73K". "RSI 48.4" not "RSI is neutral".
- Round messy floats: change 1.62% not 1.62839%, RSI 63.6 not 63.5847.`;

  if (mode === 'quick') {
    return `You are Spectre, a senior desk strategist briefing a trader. Write a tight 2-paragraph desk note + one-line trade angle. The output reads in Bloomberg / FT morning-note voice — never wiki / chatbot / textbook.

═══════════════════════════════════════════════════════════
ABSOLUTE BANS — violating these means the brief is rejected.
═══════════════════════════════════════════════════════════
1. Your FIRST sentence MAY NOT start with or contain: "The current price", "The price of", "is currently", "is trading at", "X is Y, and Y is Z", "BTC price is", "The 24-hour change", "The RSI", "The MACD".
2. You MAY NOT write "indicates a neutral/bearish/bullish signal". State the action instead: "buyers losing the bid", "sellers in control", "momentum cooling".
3. You MAY NOT use this sentence shape: "The X is Y. The A is B. The Q is R." That is a field dump, not analysis. Combine 2-3 facts per sentence using AS / WHILE / WITH / DESPITE / EVEN AS connectives.
4. NEVER use backticks. Bold numbers with **markdown** only.
5. No "I", no "As an AI", no "Based on the data", no "indicates", no "suggests that".

═══════════════════════════════════════════════════════════
WORKED EXAMPLES — copy this voice.
═══════════════════════════════════════════════════════════
BAD (rejected — programmatic field dump):
  "The current price of BTC is **78,347.72**. The RSI 14 is **54.79**, indicating a neutral signal. The MACD trend is bearish. The 24h change is **-2.78%**. The institutional grade is D, with a score of **35.7**."

GOOD example 1 (opens with the move, not the price):
  "$BTC just lost the $80K shelf, down **-2.78%** to **$78,348** as funds skipped the defense and let dip-buyers carry the bag [1]. The setup is fragile — RSI at **54.8** is still uncommitted, but MACD has rolled bearish on the 4-hour, telegraphing that the next leg is sellers' to lose [2]. Institutional readiness sits at grade **D** (35.7), so a bounce from here is retail trade, not a real accumulation print [4]."

GOOD example 2 (opens with the cause):
  "Sellers regained control of $BTC overnight — the tape is down **-2.78%** with price slipping under **$78,400** as ETF flows turn flat and Asian books unloaded into the open [1]. Momentum is mixed: stochastic RSI at **11.9** screams oversold while the daily MACD still tilts bearish, meaning any bounce stays a counter-trend trade [2]. Grade-D institutional readiness keeps real money on the sidelines [4]."

GOOD example 3 (opens with the takeaway):
  "The bid is gone. $BTC is **-2.78%** to **$78,348**, sliding through the $80K psychological line as 24h volume thins to **$34.2B** [1]. With MACD bearish and price under the 50-day, the path of least resistance is the **$73K** liquidity pocket — only a reclaim of **$80K** on volume invalidates [2]. Until institutional grade (**D · 35.7**) lifts, no one is going to catch this knife for real [4]."

═══════════════════════════════════════════════════════════
STRUCTURE (mandatory).
═══════════════════════════════════════════════════════════
Paragraph 1 — THE MOVE (price + change + why), 2-3 sentences. Open with action/cause/takeaway, NOT the price line.
Paragraph 2 — THE SETUP (technicals + institutional + risks woven together), 2-3 sentences. Connect with AS / WHILE / WITH / DESPITE.
End line — TRADE ANGLE: a single tradeable setup. Format exactly as: \`TRADE ANGLE: [Action] [Asset] [trigger] with a stop [level], target [level]. Invalidation: [level].\` ONE line. Nothing more.

═══════════════════════════════════════════════════════════
FORMATTING RULES.
═══════════════════════════════════════════════════════════
- **Bold** for headline numbers. Format $ with commas (**$78,348**), % with sign + 2dp (**-2.78%**), big numbers compacted (**$1.57T**, **$34.2B**).
- Round messy floats: 63.6 not 63.5847, +1.2% not +1.21953%.
- $TICKER style for asset symbols ($BTC, $ETH).
- ONE citation [n] per CLAIM, placed at END of sentence — NOT after every number, NOT after every value. Max 3 citations total in the brief.
- Never invent numbers. If a field is absent from DATA, omit the claim entirely.

CITATION MAP
${citationMap}

DATA
${dataDump}

CLASSIFICATION: ${intent.classification}`;
  }

  // thesis
  return `You are Spectre. Write a comprehensive research brief. Markdown sections, inline [n] citations.

STRUCTURE (use these exact headers)
## Overview
## Technical Setup
## Institutional Readiness
## Risk Factors
## Trade Angle
## Confidence

${baseRules}
- The "Confidence" section is a single line: "Confidence: HIGH/MEDIUM/LOW because [1-sentence reason]".
- No filler intros. Start immediately with the Overview.

CITATION MAP
${citationMap}

DATA
${dataDump}

CLASSIFICATION: ${intent.classification}`;
}

// ── RELATED QUESTIONS (People Also Ask) ─────────────────────────────────────

function generateRelated(classification, assets) {
  const asset = assets[0] || 'BTC';

  const templates = {
    ASSET_ANALYSIS: [
      `Is ${asset} overbought right now?`,
      `${asset} vs ETH — which is stronger this week?`,
      `${asset} funding rates across exchanges`,
      `What are whales doing with ${asset}?`,
      `${asset} institutional grade breakdown`,
    ],
    MARKET_OVERVIEW: [
      'Why is the market in extreme fear?',
      'Best performing sectors today',
      'Largest liquidations in the last 24h',
      'Smart money flows this week',
    ],
    DUE_DILIGENCE: [
      `${asset} tokenomics breakdown`,
      `Who are the top backers of ${asset}?`,
      `${asset} on-chain health — holders and flows`,
      `${asset} derivatives — funding and OI`,
    ],
    COMPARISON: [
      `${assets[0] || 'BTC'} vs ${assets[1] || 'ETH'} derivatives position`,
      `Which has better institutional backing?`,
      `On-chain health comparison`,
    ],
    DERIVATIVES: [
      'Top funding rate divergences',
      'Largest liquidation events today',
      'BTC vs ETH open interest ratio',
    ],
    WHALE_TRACKING: [
      'Largest whale transactions today',
      'Exchange inflows vs outflows',
      'Smart money accumulation trends',
    ],
    DISCOVERY: [
      'Hottest tokens on Base right now',
      'New Solana tokens with volume',
      'Tokens before CoinGecko lists them',
    ],
    NEWS: [
      'How is the market reacting to this news?',
      'Biggest crypto news this week',
      'Regulatory headlines today',
    ],
  };

  return templates[classification] || templates.MARKET_OVERVIEW;
}

// ── PERMALINK CACHE ─────────────────────────────────────────────────────────

const permalinkCache = new Map();
const PERMALINK_TTL = 60_000; // 60s
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of permalinkCache) {
    if (now - v.ts > PERMALINK_TTL) permalinkCache.delete(k);
  }
}, 30_000);

// ── MAIN HANDLER: POST /query ───────────────────────────────────────────────

router.post('/query', rateLimit, async (req, res) => {
  const startedAt = Date.now();
  const { query, mode = 'quick', focus = 'all' } = req.body || {};

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query string required' });
  }
  // No per-key gate: the LLM gateway walks a multi-provider fallback chain and
  // degrades to an SSE error event below only if EVERY provider is unavailable.

  setupSSE(res);
  let aborted = false;
  res.on('close', () => { if (!res.writableFinished) aborted = true; });

  try {
    const qid = genQueryId(query, mode, focus);
    const assets = detectAssets(query);
    const chain = detectChain(query);
    const classification = classifyQuery(query, focus, assets);

    // Step 1 — Meta event
    const plan = planEndpoints(classification, assets, mode, chain);
    send(res, 'meta', {
      id: qid,
      classification,
      assets,
      endpoints_planned: plan.length,
      mode,
    });

    // Step 2 — Fan-out parallel fetches, stream data events as each resolves
    const dataPromises = plan.map(async (call, idx) => {
      const result = await spectreFetch(call.url);
      if (result.ok && result.data != null) {
        send(res, 'data', {
          slot: call.slot,
          payload: result.data,
          endpoint: call.url,
        });
      }
      return {
        id: idx + 1,
        slot: call.slot,
        payload: result.ok ? result.data : null,
        endpoint: call.url,
        label: call.label,
        latency_ms: result.latency_ms,
      };
    });

    const settled = await Promise.allSettled(dataPromises);
    const results = settled
      .filter((r) => r.status === 'fulfilled' && r.value.payload != null)
      .map((r) => r.value);

    if (aborted) return;

    // Step 3 — Citations ready
    const citations = results.map((r) => ({
      id: r.id,
      endpoint: r.endpoint,
      label: r.label,
      latency_ms: r.latency_ms,
    }));
    send(res, 'citations_ready', { citations });

    // Step 4 — Build system prompt and stream LLM answer
    const systemPrompt = buildSearchPrompt(
      { classification, assets, originalQuery: query },
      mode,
      results,
      citations,
    );

    // Stream the LLM answer via the resilient multi-provider gateway
    // (groq→cerebras→gemini→openrouter→openai→anthropic→ollama, circuit-broken).
    // The gateway yields decoded text deltas directly — no SSE parsing here.
    let fullText = '';
    for await (const delta of gatewayChatStream({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      tier: 'smart',
      maxTokens: mode === 'thesis' ? 4000 : 1000,
      temperature: mode === 'thesis' ? 0.6 : 0.4,
    })) {
      if (aborted) break;
      if (delta) {
        fullText += delta;
        sendText(res, delta);
      }
    }

    if (aborted) return;

    // If the gateway yielded nothing, every provider is down — degrade to the
    // existing SSE error path instead of silently ending an empty stream.
    if (!fullText) {
      console.error('[search-engine] LLM error: all providers unavailable');
      send(res, 'error', { message: 'LLM service error' });
      return res.end();
    }

    // Step 5 — Related questions
    const related = generateRelated(classification, assets);
    send(res, 'related', { questions: related });

    // Step 6 — Cache permalink
    permalinkCache.set(qid, {
      ts: Date.now(),
      query, mode, focus, classification, assets,
      results: results.map((r) => ({ slot: r.slot, payload: r.payload, label: r.label })),
      text: fullText,
      related,
    });

    // Step 7 — Done
    send(res, 'done', {
      id: qid,
      response_time_ms: Date.now() - startedAt,
      endpoints_hit: results.length,
      tokens_used: Math.ceil(fullText.length / 4),
    });

    res.end();
  } catch (err) {
    console.error('[search-engine] handler error:', err.message, err.stack?.split('\n')[1]);
    if (!res.writableEnded) {
      send(res, 'error', { message: err.message });
      res.end();
    }
  }
});

// ── GET /trending ───────────────────────────────────────────────────────────

let trendingCache = { data: null, ts: 0 };

router.get('/trending', async (_req, res) => {
  if (trendingCache.data && Date.now() - trendingCache.ts < 30_000) {
    return res.json(trendingCache.data);
  }

  try {
    const [fg, gainers, signals] = await Promise.all([
      spectreFetch('/v1/sentiment/fear-greed'),
      spectreFetch('/v1/movers/gainers?limit=5'),
      spectreFetch('/v1/intelligence/signals?limit=5'),
    ]);

    const cards = [
      { query: 'BTC thesis', label: 'BTC Deep Dive', category: 'Asset', icon: 'btc' },
      { query: 'top gainers today', label: 'Top Gainers', category: 'Markets', icon: 'trending' },
      { query: 'whale activity', label: 'Whale Moves', category: 'On-Chain', icon: 'whale' },
      { query: 'new tokens on base', label: 'Base Gems', category: 'Discovery', icon: 'discovery' },
      { query: 'ETH gas prices', label: 'Gas Tracker', category: 'Tools', icon: 'gas' },
      { query: 'fear and greed index', label: 'Fear & Greed', category: 'Sentiment', icon: 'sentiment' },
    ];

    const result = {
      cards,
      fearGreed: fg.ok ? fg.data : null,
      topGainers: gainers.ok ? gainers.data : null,
      topSignals: signals.ok ? signals.data : null,
    };

    trendingCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[search-engine] /trending error:', err.message);
    res.status(500).json({ error: 'Failed to fetch trending data' });
  }
});

// ── GET /permalink/:id ──────────────────────────────────────────────────────

router.get('/permalink/:id', (req, res) => {
  const cached = permalinkCache.get(req.params.id);
  if (!cached) return res.status(404).json({ error: 'Permalink expired or not found' });
  res.json({
    id: req.params.id,
    query: cached.query,
    mode: cached.mode,
    focus: cached.focus,
    classification: cached.classification,
    assets: cached.assets,
    results: cached.results,
    text: cached.text,
    related: cached.related,
  });
});

// ── POST /autocomplete ──────────────────────────────────────────────────────

router.post('/autocomplete', (req, res) => {
  const { query } = req.body || {};
  if (!query || query.length < 2) return res.json({ suggestions: [] });

  const lc = query.toLowerCase();
  const suggestions = [];

  // Match known tickers
  for (const sym of KNOWN_TICKERS) {
    if (sym.toLowerCase().startsWith(lc) || (SYMBOL_ALIASES[lc] === sym)) {
      suggestions.push({ type: 'asset', symbol: sym, label: sym });
    }
    if (suggestions.length >= 5) break;
  }

  // Match alias names
  for (const [alias, sym] of Object.entries(SYMBOL_ALIASES)) {
    if (alias.startsWith(lc) && !suggestions.some((s) => s.symbol === sym)) {
      suggestions.push({ type: 'asset', symbol: sym, label: `${alias} (${sym})` });
    }
    if (suggestions.length >= 8) break;
  }

  // Quick query suggestions
  const templates = [
    { match: 'btc', suggestions: ['BTC thesis', 'BTC vs ETH', 'BTC derivatives'] },
    { match: 'eth', suggestions: ['ETH thesis', 'ETH gas prices', 'ETH staking yields'] },
    { match: 'whal', suggestions: ['whale activity', 'whale transactions today'] },
    { match: 'fund', suggestions: ['funding rates', 'funding rate divergences'] },
    { match: 'top', suggestions: ['top gainers today', 'top losers today', 'top DeFi protocols'] },
    { match: 'new', suggestions: ['new tokens', 'latest news', 'new tokens on base'] },
  ];

  for (const t of templates) {
    if (lc.startsWith(t.match)) {
      for (const s of t.suggestions) {
        suggestions.push({ type: 'query', label: s });
      }
      break;
    }
  }

  res.json({ suggestions: suggestions.slice(0, 10) });
});

// ── POST /related ───────────────────────────────────────────────────────────

router.post('/related', (req, res) => {
  const { classification, assets } = req.body || {};
  const related = generateRelated(classification || 'GENERAL', assets || []);
  res.json({ questions: related });
});

module.exports = router;
