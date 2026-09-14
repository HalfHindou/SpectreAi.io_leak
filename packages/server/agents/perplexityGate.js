/**
 * Spectre Intelligence Gate
 * ═══════════════════════════════════════════════════════════════
 * THE GATE. All newsroom agents call gatedPerplexitySearch() from this file.
 *
 * ARCHITECTURE (2026-04-12 swap):
 *   LAYER 1 — Spectre API    (structured market intel, always on)
 *   LAYER 2 — Web context    (Spectre's own news corpus first, vendor fallback)
 *   LAYER 3 — Gov RSS feeds  (Fed/Treasury/White House, for macro+regulatory)
 *   LAYER 4 — Groq Llama 3.3 70B synthesis
 *
 *   Emergency fallback chain: Perplexity -> Anthropic -> OpenAI
 *   (Only fires if Spectre+Groq fails. Toggle via USE_SPECTRE_NEWSROOM=0.)
 *
 * The function signature, inputs, and return shape are IDENTICAL to the
 * pre-swap version. All 10 content agents work without changes.
 *
 * Consumers depend on this return shape (DO NOT BREAK):
 *   { type: 'SUCCESS' | 'ERROR' | 'NEEDS_DISAMBIGUATION' | 'SELF_QUERY',
 *     content: string | null,
 *     citations: string[],
 *     model: string | null,
 *     usage: object | null,
 *     resolvedEntities: object[],
 *     error?: string, message?: string, options?: object[] }
 * ═══════════════════════════════════════════════════════════════
 */
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env'), override: true });

const { resolveEntities, resolveKnownEntity } = require('./entityResolver');
const db = require('./entityDatabase');
const { chat: gatewayChat } = require('../lib/llm-gateway');
const { webSearch } = require('./webSearch');

// ── PRIMARY CONFIG ───────────────────────────────────────────────────────────
const USE_SPECTRE_NEWSROOM = process.env.USE_SPECTRE_NEWSROOM !== '0';
const SPECTRE_API_BASE = process.env.SPECTRE_API_BASE || 'https://api.spectreai.io';
const SPECTRE_API_KEY = process.env.SPECTRE_API_KEY || '';

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || process.env.LLM_MODEL || 'openai/gpt-oss-120b';
const GROQ_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.groq.com/openai').replace(/\/$/, '');


// ── LEGACY FALLBACK CONFIG (emergency only) ──────────────────────────────────
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const SEARCH_ANTHROPIC_KEY = ANTHROPIC_API_KEY || (OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-ant-') ? OPENAI_API_KEY : '') || '';
const SEARCH_OPENAI_KEY = (OPENAI_API_KEY && !OPENAI_API_KEY.startsWith('sk-ant-')) ? OPENAI_API_KEY : '';

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — SPECTRE API INTENT + FETCH
// ═══════════════════════════════════════════════════════════════════════════════

const ASSET_ALIASES = {
  bitcoin: 'BTC', btc: 'BTC',
  ethereum: 'ETH', ether: 'ETH', eth: 'ETH',
  solana: 'SOL', sol: 'SOL',
  binance: 'BNB', bnb: 'BNB',
  ripple: 'XRP', xrp: 'XRP',
  cardano: 'ADA', ada: 'ADA',
  avalanche: 'AVAX', avax: 'AVAX',
  dogecoin: 'DOGE', doge: 'DOGE',
  chainlink: 'LINK', link: 'LINK',
  polkadot: 'DOT', dot: 'DOT',
  polygon: 'MATIC', matic: 'MATIC',
  arbitrum: 'ARB', arb: 'ARB',
  optimism: 'OP',
  litecoin: 'LTC', ltc: 'LTC',
  near: 'NEAR',
  cosmos: 'ATOM', atom: 'ATOM',
  uniswap: 'UNI', uni: 'UNI',
  aptos: 'APT', apt: 'APT',
  sui: 'SUI',
  injective: 'INJ', inj: 'INJ',
  celestia: 'TIA', tia: 'TIA',
  sei: 'SEI',
  ton: 'TON',
  shiba: 'SHIB', shib: 'SHIB',
  pepe: 'PEPE',
  wif: 'WIF',
  bonk: 'BONK',
  fartcoin: 'FARTCOIN',
  ethena: 'ENA', ena: 'ENA',
  jupiter: 'JUP', jup: 'JUP',
  render: 'RENDER', rndr: 'RENDER',
  fet: 'FET',
  tao: 'TAO',
  hyperliquid: 'HYPE', hype: 'HYPE',
  trump: 'TRUMP',
  monad: 'MON',
  berachain: 'BERA', bera: 'BERA',
  worldcoin: 'WLD', wld: 'WLD',
  aave: 'AAVE',
  maker: 'MKR', mkr: 'MKR',
  pyth: 'PYTH',
  dydx: 'DYDX',
  gmx: 'GMX',
  virtual: 'VIRTUAL', virtuals: 'VIRTUAL',
};

const COMMON_NON_TICKERS = new Set([
  'A','I','AM','PM','OK','NO','YES','WHY','HOW','WHAT','WHEN','WHO',
  'USA','UK','EU','US','AI','ML','CEO','CFO','CTO','COO','FAQ','IPO','NFT','DAO',
  'LOL','WTF','TLDR','FYI','ASAP','BTW','IMO','OMG','USD','EUR','GBP','JPY','CNY',
  'RSI','MACD','ATH','ATL','DEX','CEX','TVL','OHLC','API','CORS','SDK','URL','UI',
  'UX','HTTP','HTTPS','SSL','DNS','CSS','HTML','JSON','YAML','XML',
  'MVP','POC','PR','QA','ROI','KPI','SLA','TBD','TODO','FOMO','HODL','DYOR',
  'NGMI','WAGMI','GM','GN','LFG','IRL','AFAIK','TIL','YOLO','BRB','IDK',
  'SEC','FED','CPI','GDP','IMF','ECB','BOJ','FOMC','NYSE','ETF','LLC','INC',
  'NEWS','BREAKING','LATEST','TODAY','MARKET','PRICE','BUY','SELL','LONG','SHORT',
]);

/**
 * Parse a query into { assets, topics } for agent-specific fan-out routing.
 * Detects crypto tickers, macro/regulatory/AI topics, and on-chain intent.
 */
function detectQueryIntent(query, agentId) {
  const raw = String(query || '');
  const text = raw.toLowerCase();
  const assets = new Set();

  // Explicit $SYMBOL (must start with letter to avoid matching dollar amounts)
  const tickerHits = text.match(/\$([a-z][a-z0-9]{1,9})\b/g);
  if (tickerHits) for (const hit of tickerHits) assets.add(hit.slice(1).toUpperCase());

  // Whole-word alias dictionary
  for (const [alias, sym] of Object.entries(ASSET_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(text)) assets.add(sym);
  }

  // Bare ALL-CAPS ticker fallback — only when mixed case (skip shouted queries)
  const hasLower = /[a-z]/.test(raw);
  if (hasLower) {
    const capsHits = raw.match(/\b[A-Z][A-Z0-9]{1,5}\b/g);
    if (capsHits) {
      for (const hit of capsHits) {
        if (COMMON_NON_TICKERS.has(hit)) continue;
        assets.add(hit);
      }
    }
  }

  const has = (...kws) => kws.some(k => text.includes(k));
  const topics = {
    derivatives: has('funding', 'liquidat', 'derivat', 'open interest', ' oi ', 'futures', 'perp', 'basis', 'leverag', 'options'),
    sentiment: has('fear', 'greed', 'sentiment', 'mood', 'euphoria', 'panic'),
    defi: has('defi', ' tvl', 'protocol', 'yield', 'lending', 'stablecoin'),
    narrative: has('narrative', 'trending', 'hot coin', 'meta', 'hype', 'theme', 'sector'),
    whale: has('whale', 'smart money', 'large holder', 'large transaction'),
    news: has('news', 'breaking', 'latest', 'headline', 'announcement'),
    unlocks: has('unlock', 'vesting', 'cliff', 'token release', 'emission'),
    onchain: has('on-chain', 'onchain', 'holder', 'distribution', 'top wallet', 'address count'),
    technical: has('rsi', 'macd', 'moving average', 'overbought', 'oversold', 'technical', 'indicator', 'resistance', 'support'),
    global: has('total market', 'market cap', 'dominance', 'global market'),
    institutional: has('institutional', 'grade', 'score', 'due diligence', 'fundamentals', 'ventures', 'conviction'),
    discovery: has('pumping', 'microcap', 'micro cap', 'new token', 'degen', 'gem', 'early stage', 'just launched'),
    // Layer 2 web triggers — macro/regulatory/ai keywords pull Tavily + Gov RSS
    macro: has('fed', 'rate cut', 'rate hike', 'cpi', 'gdp', 'inflation', 'treasury', 'economy', 'macro', 'tariff', 'recession', 'fomc', 'powell', 'jobs report', 'nfp'),
    regulatory: has('sec ', 'sec.', 'regulation', 'ruling', 'lawsuit', 'enforcement', 'congress', ' bill ', ' law ', 'policy', 'trump', 'biden', 'executive order', 'crackdown', 'indictment'),
    ai: has('artificial intelligence', 'ai regulation', 'ai policy', 'openai', 'anthropic', 'gemini', 'chatgpt', 'llm', 'gpt-'),
  };

  return { assets: [...assets].slice(0, 4), topics, agentId };
}

async function spectreFetch(endpoint) {
  if (!SPECTRE_API_KEY) return null;
  try {
    const res = await fetch(`${SPECTRE_API_BASE}${endpoint}`, {
      headers: { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.log(`[gate] spectre ${endpoint} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.log(`[gate] spectre ${endpoint} error: ${err.message}`);
    return null;
  }
}

/**
 * Fan out /v1/* fetches based on detected intent + agent type.
 * Returns raw Spectre payloads keyed by endpoint shorthand.
 */
async function gatherSpectreData(intent) {
  const { assets, topics, agentId } = intent;
  const keys = [];
  const tasks = [];
  const add = (key, p) => { keys.push(key); tasks.push(spectreFetch(p)); };

  // Always-on market baseline — every article gets macro context
  add('global', '/v1/global');
  add('fear_greed', '/v1/sentiment/fear-greed');
  add('movers_gainers', '/v1/movers/gainers?limit=5');
  add('movers_losers', '/v1/movers/losers?limit=5');

  // Per-asset fan-out
  for (const asset of assets.slice(0, 3)) {
    add(`price_${asset}`, `/v1/prices/${asset}`);
    add(`technicals_${asset}`, `/v1/technicals/${asset}`);
    if (topics.derivatives || agentId === 'token-analysis' || agentId === 'research-article' || agentId === 'trader-pipeline') {
      add(`derivatives_${asset}`, `/v1/derivatives/composite/dashboard/${asset}`);
    }
    if (topics.onchain || agentId === 'research-article') {
      add(`holders_${asset}`, `/v1/onchain/${asset}/holders`);
    }
    if (topics.institutional || agentId === 'research-article' || agentId === 'spectre-analyst') {
      add(`institutional_${asset}`, `/v1/institutional/scores/${asset}`);
    }
  }

  // Topic-driven (no asset required)
  if (topics.defi || agentId === 'research-article') add('defi_protocols', '/v1/defi/protocols');
  if (topics.whale) add('whale_transactions', '/v1/smart-money/whale-transactions');
  if (
    topics.news || topics.macro || topics.regulatory || topics.ai ||
    agentId === 'news-writer' || agentId === 'breaking-news' || agentId === 'daily-brief'
  ) {
    add('news', '/v1/news?limit=10');
    add('breaking', '/v1/news/breaking');
  }
  if (topics.narrative || topics.discovery || agentId === 'daily-brief' || agentId === 'trader-pipeline') {
    add('trending', '/v1/trending');
    add('signals', '/v1/intelligence/signals');
  }
  if (topics.unlocks) add('unlocks', '/v1/unlocks');
  if (topics.discovery || agentId === 'trader-pipeline') add('discovery_hot', '/v1/discovery/hot?limit=10');

  // Daily brief gets the full market snapshot
  if (agentId === 'daily-brief') {
    if (!keys.includes('trending')) add('trending', '/v1/trending');
    if (!keys.includes('signals')) add('signals', '/v1/intelligence/signals');
    if (!keys.includes('whale_transactions')) add('whale_transactions', '/v1/smart-money/whale-transactions');
  }

  const settled = await Promise.all(tasks);
  const data = {};
  settled.forEach((val, i) => {
    if (val != null) data[keys[i]] = val;
  });
  return { data, assets, topics, agentId };
}

// ─── FIELD EXTRACTORS — keep context dense for the LLM ───────────────────────

function fmtPriceReadable(n) {
  if (n == null || isNaN(n)) return null;
  const v = Number(n);
  if (v === 0) return '$0';
  const abs = Math.abs(v);
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs >= 0.01) return `$${v.toFixed(4)}`;
  if (abs >= 0.0001) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')}`;
}
function fmtPctReadable(n) {
  if (n == null || isNaN(n)) return null;
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  if (Math.abs(v) >= 1000) return `${sign}${v.toFixed(0)}%`;
  return `${sign}${v.toFixed(2)}%`;
}
function fmtUsdCompact(n) {
  if (n == null || isNaN(n)) return null;
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

const FIELD_EXTRACTORS = {
  price: (d) => ({
    symbol: d.symbol, price: d.price,
    change_1h: d.change?.['1h'], change_24h: d.change?.['24h'],
    change_7d: d.change?.['7d'], change_30d: d.change?.['30d'],
    market_cap: d.market_cap, volume_24h: d.volume_24h,
    high_24h: d.high_24h, low_24h: d.low_24h,
    ath: d.ath?.price, ath_date: d.ath?.date,
  }),
  technicals: (d) => ({
    asset: d.asset, current_price: d.current_price,
    signal: d.summary?.signal,
    bullish: d.summary?.bullish_signals,
    bearish: d.summary?.bearish_signals,
    rsi_14: d.oscillators?.rsi_14?.value,
    rsi_signal: d.oscillators?.rsi_14?.signal,
    macd: d.oscillators?.macd?.macd,
    macd_trend: d.oscillators?.macd?.trend,
    mfi_14: d.oscillators?.mfi_14?.value,
    supports: Array.isArray(d.support_levels) ? d.support_levels.slice(0, 3) : undefined,
    resistances: Array.isArray(d.resistance_levels) ? d.resistance_levels.slice(0, 3) : undefined,
  }),
  fearGreed: (d) => {
    const c = d.current || d;
    return { score: c.value ?? c.score, label: c.label ?? c.classification, time: c.time };
  },
  global: (d) => ({
    total_market_cap: d.totalMarketCap,
    total_volume_24h: d.totalVolume24h,
    btc_dominance: d.btcDominance,
    btc_price: d.btcPrice,
    eth_price: d.ethPrice,
    sol_price: d.solPrice,
  }),
  derivatives: (d) => d, // already a compact summary upstream
  movers: (d) => {
    const arr = Array.isArray(d) ? d : d?.items;
    if (!Array.isArray(arr)) return d;
    return arr.slice(0, 5).map(m => ({ asset: m.asset, price: m.price, change_24h: m.change }));
  },
  whale: (d) => (Array.isArray(d) ? d.slice(0, 5) : d),
  news: (d) => {
    const arr = Array.isArray(d) ? d : d?.items || d?.results;
    if (!Array.isArray(arr)) return d;
    return arr.slice(0, 8).map(n => ({
      title: n.title,
      source: n.source?.name || n.source,
      url: n.url || n.source_url || n.link,
      time: n.published_at || n.time || n.time_ago,
    }));
  },
  trending: (d) => {
    const arr = Array.isArray(d) ? d : d?.items || d?.narratives;
    return Array.isArray(arr) ? arr.slice(0, 8) : d;
  },
  signals: (d) => {
    const arr = Array.isArray(d) ? d : d?.signals || d?.items;
    return Array.isArray(arr) ? arr.slice(0, 8) : d;
  },
  defi: (d) => {
    const arr = Array.isArray(d) ? d : d?.protocols;
    if (!Array.isArray(arr)) return d;
    return arr.slice(0, 8).map(p => ({ name: p.name, tvl: p.tvl, change_1d: p.change_1d, chain: p.chain }));
  },
  unlocks: (d) => {
    const arr = Array.isArray(d) ? d : d?.upcoming || d?.items;
    return Array.isArray(arr) ? arr.slice(0, 5) : d;
  },
  holders: (d) => ({
    total: d.total_holders ?? d.total,
    top_holders: Array.isArray(d.top) ? d.top.slice(0, 5) : undefined,
    distribution: d.distribution,
  }),
  discoveryHot: (d) => {
    const arr = Array.isArray(d) ? d : d?.items;
    if (!Array.isArray(arr)) return d;
    return arr.slice(0, 8).map(t => ({
      symbol: t.symbol, chain: t.chain,
      price: fmtPriceReadable(t.price),
      price_change_24h: fmtPctReadable(t.price_change_24h),
      volume_24h: fmtUsdCompact(t.volume_24h),
      liquidity: fmtUsdCompact(t.liquidity),
    }));
  },
  institutional: (d) => {
    const cs = d.category_scores || {};
    const inst = d.institutional || {};
    const mkt = d.market || {};
    const holders = Array.isArray(inst.institutional_holders) ? inst.institutional_holders : [];
    return {
      symbol: d.symbol, score: d.score, grade: d.grade, tier: d.tier,
      market_maturity: cs.market_maturity,
      liquidity: cs.liquidity,
      development: cs.development,
      onchain_health: cs.onchain_health,
      narrative: cs.narrative,
      institutional_interest: cs.institutional_interest,
      regulatory: cs.regulatory,
      tokenomics: cs.tokenomics,
      institutional_holder_count: holders.length,
      top_holders: holders.slice(0, 5).map(h => h.name || h.investor || h),
      market_cap: mkt.market_cap,
      volume_24h: mkt.volume_24h,
    };
  },
};

function extractFields(key, rawData) {
  if (rawData == null) return null;
  const d = rawData.data != null ? rawData.data : rawData;
  if (d == null) return null;
  if (key.startsWith('price_')) return FIELD_EXTRACTORS.price(d);
  if (key.startsWith('technicals_')) return FIELD_EXTRACTORS.technicals(d);
  if (key.startsWith('derivatives_')) return FIELD_EXTRACTORS.derivatives(d);
  if (key.startsWith('holders_')) return FIELD_EXTRACTORS.holders(d);
  if (key.startsWith('institutional_')) return FIELD_EXTRACTORS.institutional(d);
  if (key === 'fear_greed') return FIELD_EXTRACTORS.fearGreed(d);
  if (key === 'global') return FIELD_EXTRACTORS.global(d);
  if (key === 'movers_gainers' || key === 'movers_losers') return FIELD_EXTRACTORS.movers(d);
  if (key === 'whale_transactions') return FIELD_EXTRACTORS.whale(d);
  if (key === 'news' || key === 'breaking') return FIELD_EXTRACTORS.news(d);
  if (key === 'trending') return FIELD_EXTRACTORS.trending(d);
  if (key === 'defi_protocols') return FIELD_EXTRACTORS.defi(d);
  if (key === 'signals') return FIELD_EXTRACTORS.signals(d);
  if (key === 'unlocks') return FIELD_EXTRACTORS.unlocks(d);
  if (key === 'discovery_hot') return FIELD_EXTRACTORS.discoveryHot(d);
  return d;
}

/**
 * Compact Spectre payloads into a dense, citation-harvested text block.
 * Caps each block at 600 chars to keep total context < 8 KB for Llama.
 */
function compactSpectreContext(spectreResult) {
  const blocks = [];
  const citations = [];
  for (const [key, raw] of Object.entries(spectreResult.data || {})) {
    const extracted = extractFields(key, raw);
    if (extracted == null) continue;
    // Harvest citations from news items
    if (key === 'news' || key === 'breaking') {
      if (Array.isArray(extracted)) {
        for (const n of extracted) {
          if (n && typeof n.url === 'string' && n.url.startsWith('http')) citations.push(n.url);
        }
      }
    }
    let json;
    try { json = JSON.stringify(extracted); }
    catch { continue; }
    blocks.push(`[${key}]\n${json.slice(0, 600)}`);
  }
  return { block: blocks.join('\n\n'), citations };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2 — TAVILY WEB SEARCH (optional, fires when key present)
// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2 — WEB CONTEXT (Spectre corpus first, vendor fallback)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🪤 THIS USED TO FIRE ON EVERY SINGLE CALL.
 *
 * The comment on the topic detector has always said macro/regulatory/ai
 * keywords are what "pull Tavily + Gov RSS", and fetchGovernmentContext is
 * indeed gated on exactly that. The Tavily call never was — it ran for every
 * gatedPerplexitySearch(), which is ~10 agents including cron-driven ones
 * (dailyBrief, newsWriter, traderPipeline). It cost nothing only because the
 * key was never set on the box; the day it was, every scheduled run would have
 * burned a paid credit to research a token-analysis question that has no web
 * component. Now it is gated like layer 3, and it asks our own corpus first.
 */
async function fetchWebContext(query, topics) {
  const wantsWeb = !!(topics && (topics.macro || topics.regulatory || topics.ai || topics.news));
  if (!wantsWeb) return null;
  try {
    const { results, provider } = await webSearch(query, { limit: 5, minResults: 3, window: '30d' });
    if (!results.length) return null;
    console.log(`[gate] web context via ${provider} — ${results.length} results`);
    return results.map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: (r.content || '').slice(0, 250),
      source: r.source || null,
      provider,
    }));
  } catch (err) {
    console.log(`[gate] web context error: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3 — GOVERNMENT RSS FEEDS (macro + regulatory + political context)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchRSS(url, limit = 3) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Spectre-Newsroom/1.0 (+https://spectreai.io)' },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const items = text.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g) || [];
    return items.slice(0, limit).map(item => {
      const titleMatch = item.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const title = (titleMatch?.[1] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()
        .slice(0, 180);
      const descMatch = item.match(/<description[^>]*>([\s\S]*?)<\/description>|<summary[^>]*>([\s\S]*?)<\/summary>/);
      const desc = (descMatch?.[1] || descMatch?.[2] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()
        .slice(0, 300);
      const linkMatch = item.match(/<link[^>]*>([\s\S]*?)<\/link>|<link[^>]*href="([^"]+)"/);
      const url = ((linkMatch?.[1] || linkMatch?.[2] || '') + '').trim();
      return { title, summary: desc, url };
    });
  } catch {
    return [];
  }
}

async function fetchGovernmentContext(topics) {
  if (!topics.macro && !topics.regulatory && !topics.ai) return { items: [], citations: [] };
  const feeds = [];
  if (topics.macro) {
    feeds.push(['fed', 'https://www.federalreserve.gov/feeds/press_all.xml']);
    feeds.push(['treasury', 'https://home.treasury.gov/system/files/136/rss.xml']);
  }
  if (topics.regulatory) {
    feeds.push(['whitehouse', 'https://www.whitehouse.gov/feed/']);
  }
  const results = await Promise.allSettled(feeds.map(([, u]) => fetchRSS(u, 2)));
  const items = [];
  const citations = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      const [source] = feeds[i];
      for (const item of r.value) {
        if (!item.title) continue;
        items.push({ source, ...item });
        if (item.url && item.url.startsWith('http')) citations.push(item.url);
      }
    }
  });
  return { items: items.slice(0, 6), citations };
}

function compactWebContext(webResults, govContext) {
  const blocks = [];
  const citations = [];

  if (Array.isArray(webResults) && webResults.length > 0) {
    const provider = webResults[0].provider || 'web';
    const webBlock = webResults
      .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.snippet}${r.url ? `\n    src: ${r.url}` : `\n    src: ${r.source || provider}`}`)
      .join('\n');
    blocks.push(`[web_search_${provider}]\n${webBlock}`);
    for (const r of webResults) {
      if (r.url && r.url.startsWith('http')) citations.push(r.url);
    }
  }

  if (govContext && govContext.items && govContext.items.length > 0) {
    const govBlock = govContext.items
      .map(it => `[${it.source.toUpperCase()}] ${it.title}\n    ${it.summary}\n    src: ${it.url}`)
      .join('\n');
    blocks.push(`[government_feeds]\n${govBlock}`);
    citations.push(...govContext.citations);
  }

  return { block: blocks.join('\n\n'), citations };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 4 — GROQ LLAMA SYNTHESIS
// ═══════════════════════════════════════════════════════════════════════════════

const GROUND_TRUTH_CLAMP = `

# GROUND TRUTH RULES (appended by Spectre Intelligence Gate)
- Every price, percentage, TVL, market cap, volume, and ranking MUST come from
  the LIVE DATA block below. Do NOT fabricate numbers from training data.
- If a required field is missing from the LIVE DATA, write exactly
  "data not available" rather than guessing.
- Tickers, sentiment, and category must match what the data actually shows.
- Do NOT place [1][2][3] citation markers inside body prose. Citations are
  attached automatically.
- Banned hedges: "reportedly", "estimated", "approximately" unless the source
  data itself uses those words.
`;

async function callGroqSynthesis(systemPrompt, userMessage, contextBlock, opts = {}) {
  // Routed through the resilient LLM gateway (multi-provider failover + circuit
  // breaker): the synthesis step fails over through the free providers
  // (Groq -> Cerebras -> Gemini -> OpenRouter -> ...). On total failure it
  // returns null — exactly what the old `!GROQ_API_KEY` branch returned. The
  // paid single-vendor fallbacks past this point are opt-in only
  // (NEWSROOM_PAID_FALLBACK=1). Inputs/return-shape preserved.
  const { maxTokens = 3000, timeout = 60000 } = opts;
  const model = GROQ_MODEL;

  const finalSystem = `${systemPrompt}${GROUND_TRUTH_CLAMP}

# LIVE DATA (Spectre Intelligence API + web context, real-time)
${contextBlock}`;

  try {
    const r = await gatewayChat({
      messages: [
        { role: 'system', content: finalSystem },
        { role: 'user', content: userMessage },
      ],
      tier: 'smart',
      maxTokens,
      temperature: 0.2,
      timeoutMs: timeout,
    });

    if (!r.ok) {
      console.error('[gate] LLM gateway synthesis failed:', r.error || `tried ${(r.tried || []).join(', ')}`);
      return null;
    }

    return {
      content: r.text || '',
      model: `spectre-groq/${r.model || model}`,
      usage: null,
    };
  } catch (err) {
    console.error('[gate] Groq synthesis error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIMARY — SPECTRE + WEB + GROQ ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════════

async function callSpectreNewsroom(systemPrompt, userMessage, opts = {}) {
  const { agentId = 'unknown' } = opts;
  const startTime = Date.now();

  // STEP 1: detect intent (assets, topics, agent routing)
  const intent = detectQueryIntent(userMessage, agentId);
  const topicList = Object.keys(intent.topics).filter(k => intent.topics[k]);
  console.log(`[gate] spectre agent=${agentId} assets=[${intent.assets.join(',')}] topics=[${topicList.join(',')}]`);

  // STEP 2: parallel fan-out across all 3 data layers
  const [spectreResult, webResults, govContext] = await Promise.all([
    gatherSpectreData(intent),
    fetchWebContext(userMessage, intent.topics),
    fetchGovernmentContext(intent.topics),
  ]);

  // STEP 3: compact into dense LLM context + harvest citations
  const spectreCompact = compactSpectreContext(spectreResult);
  const webCompact = compactWebContext(webResults, govContext);

  const fullContext = [spectreCompact.block, webCompact.block].filter(Boolean).join('\n\n');
  const allCitations = [...spectreCompact.citations, ...webCompact.citations];

  if (!fullContext || fullContext.length < 50) {
    console.warn(`[gate] spectre agent=${agentId} empty context after ${Date.now() - startTime}ms - bailing to fallback`);
    return null;
  }

  // STEP 4: synthesize via Groq
  const result = await callGroqSynthesis(systemPrompt, userMessage, fullContext, opts);
  if (!result?.content) return null;

  const elapsed = Date.now() - startTime;
  console.log(`[gate] spectre agent=${agentId} OK in ${elapsed}ms ctx=${fullContext.length}ch cits=${allCitations.length}`);

  return {
    content: result.content,
    citations: [...new Set(allCitations)], // dedup
    model: result.model,
    usage: result.usage,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMERGENCY FALLBACKS — Perplexity → Anthropic → OpenAI (legacy chain)
// ═══════════════════════════════════════════════════════════════════════════════

async function callPerplexity(systemPrompt, userMessage, { model = 'sonar', maxTokens = 2000, timeout = 30000, searchContextSize = 'high' } = {}) {
  if (!PERPLEXITY_API_KEY) return null;

  const response = await fetch(`${PERPLEXITY_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
      return_citations: true,
      search_context_size: searchContextSize,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Perplexity ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content || '',
    citations: data.citations || [],
    model: data.model || model,
    usage: data.usage,
  };
}

async function callAnthropic(systemPrompt, userMessage) {
  const key = SEARCH_ANTHROPIC_KEY;
  if (!key || !key.startsWith('sk-ant-')) return null;

  console.log('[gate] emergency fallback → Anthropic');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  return { content: text, citations: [], model: data.model || 'claude-sonnet', usage: data.usage };
}

async function callOpenAI(systemPrompt, userMessage) {
  const key = SEARCH_OPENAI_KEY;
  if (!key || !key.startsWith('sk-') || key.startsWith('sk-ant-')) return null;

  console.log('[gate] emergency fallback → OpenAI');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { content: text, citations: [], model: data.model || 'gpt-4o-mini', usage: data.usage };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACK CHAIN — Spectre first, legacy providers as safety net
// ═══════════════════════════════════════════════════════════════════════════════

// Paid single-vendor fallbacks (Perplexity / Anthropic / OpenAI called
// DIRECTLY, outside the gateway). We do not use Perplexity - no
// PERPLEXITY_API_KEY exists in any environment, so that branch has been a
// silent no-op returning null. Off by default; set NEWSROOM_PAID_FALLBACK=1
// to re-enable without editing code.
const PAID_FALLBACK = process.env.NEWSROOM_PAID_FALLBACK === '1';

async function callWithFallback(systemPrompt, userMessage, opts = {}) {
  // PRIMARY (and, by default, only): our own data + the free model chain.
  // callSpectreNewsroom grounds on the Spectre API / free RSS and synthesizes
  // through llm-gateway, which already fails over groq -> cerebras -> gemini
  // -> openrouter -> ... , so a single provider being down or rate-limited is
  // handled INSIDE this call. Reaching past it means we had no grounding.
  if (USE_SPECTRE_NEWSROOM) {
    try {
      const result = await callSpectreNewsroom(systemPrompt, userMessage, opts);
      if (result && result.content) return result;
    } catch (e) {
      console.error('[gate] spectre+free-models failed:', e.message);
    }
  }

  if (!PAID_FALLBACK) {
    // Deliberately give up rather than reach for a paid vendor. The only way
    // to get here is an empty context block - and writing an "analysis" with
    // no grounding is the fabrication this whole gate exists to prevent. The
    // caller returns null and the agent skips the symbol, which is honest and
    // self-healing: the next cycle retries.
    console.error(`[gate] no grounded context for agent=${opts.agentId || 'unknown'} - skipping (paid fallback disabled)`);
    return null;
  }

  // EMERGENCY (opt-in): Perplexity
  try {
    const result = await callPerplexity(systemPrompt, userMessage, opts);
    if (result) return result;
  } catch (e) {
    console.error('[gate] perplexity fallback failed:', e.message);
  }

  // EMERGENCY (opt-in): Anthropic
  try {
    const result = await callAnthropic(systemPrompt, userMessage);
    if (result) return result;
  } catch (e) {
    console.error('[gate] anthropic fallback failed:', e.message);
  }

  // EMERGENCY (opt-in): OpenAI
  try {
    const result = await callOpenAI(systemPrompt, userMessage);
    if (result) return result;
  } catch (e) {
    console.error('[gate] openai fallback failed:', e.message);
  }

  console.error('[gate] ALL providers failed');
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY HARDENING — UNCHANGED from original gate
// ═══════════════════════════════════════════════════════════════════════════════

function buildHardenedQuery(rawQuery, resolvedEntities) {
  let hardened = rawQuery;
  for (const entity of resolvedEntities) {
    if (entity.confidence !== 'confirmed') continue;
    if (!entity.aliases || entity.aliases.length === 0) continue;
    for (const alias of entity.aliases) {
      const pattern = new RegExp(`\\$?${alias}\\b`, 'gi');
      if (pattern.test(hardened)) {
        hardened = hardened.replace(pattern, `${entity.name} ($${entity.ticker})`);
      }
    }
  }
  return hardened;
}

function buildEntityContext(resolvedEntities) {
  const parts = [];
  const exclusions = resolvedEntities
    .filter(e => e.notToBe && e.notToBe.length > 0)
    .flatMap(e => e.notToBe);
  if (exclusions.length > 0) {
    parts.push(
      `CRITICAL ENTITY DISAMBIGUATION: This query is about specific entities. ` +
      `Explicitly EXCLUDE these unrelated entities from your response:\n` +
      exclusions.map(ex => `- ${ex}`).join('\n') +
      `\nIf sources mention these excluded entities, IGNORE them entirely.`
    );
  }
  const cryptoContextEntities = resolvedEntities.filter(
    e => e.requiresCryptoContext || e.confidence === 'unknown'
  );
  for (const entity of cryptoContextEntities) {
    const hint = entity.perplexityHint || `${entity.name || entity.raw} ${entity.ticker || ''} cryptocurrency blockchain token`;
    parts.push(
      `CONTEXT: When referencing "${entity.name || entity.raw}", this refers to: ${hint}. ` +
      `Do NOT return information about non-crypto entities with similar names.`
    );
  }
  const internalEntities = resolvedEntities.filter(e => e.isInternal);
  for (const entity of internalEntities) {
    parts.push(
      `SELF-QUERY: "${entity.name}" (${entity.ticker}) is the platform making this query. ` +
      `Website: ${entity.website || 'N/A'}. X: ${entity.xHandle || 'N/A'}. ` +
      `Return only information about THIS specific project.`
    );
  }
  return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — signature UNCHANGED; all 10 agents keep working
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} [opts.systemPrompt]
 * @param {number} [opts.maxTokens=2000]
 * @param {string} [opts.model='sonar']       - legacy param, now unused by primary
 * @param {string} [opts.agentId='unknown']
 * @param {object[]} [opts.resolvedEntities]
 * @param {number} [opts.timeout=30000]
 * @param {string} [opts.searchContextSize='high']  - legacy Perplexity-only param
 * @param {boolean} [opts.skipResolution=false]
 */
async function gatedPerplexitySearch({
  query,
  systemPrompt = '',
  maxTokens = 2000,
  model = 'sonar',
  agentId = 'unknown',
  resolvedEntities = null,
  timeout = 30000,
  searchContextSize = 'high',
  skipResolution = false,
} = {}) {
  const startTime = Date.now();

  // ── STEP 1: RESOLVE ENTITIES ──────────────────────────────────────────────
  let resolution;
  if (resolvedEntities) {
    resolution = {
      resolved: resolvedEntities,
      needsDisambiguation: [],
      canProceed: true,
      isSelfQuery: resolvedEntities.some(e => e.isInternal),
    };
  } else if (skipResolution) {
    resolution = { resolved: [], needsDisambiguation: [], canProceed: true, isSelfQuery: false };
  } else {
    resolution = await resolveEntities(query);
  }

  console.log(`[gate] agent=${agentId} entities=${resolution.resolved.length} disambig=${resolution.needsDisambiguation.length} self=${resolution.isSelfQuery}`);

  // ── STEP 2: BLOCK IF DISAMBIGUATION NEEDED ────────────────────────────────
  if (!resolution.canProceed) {
    return {
      type: 'NEEDS_DISAMBIGUATION',
      options: resolution.needsDisambiguation,
      message: buildDisambiguationMessage(resolution.needsDisambiguation),
    };
  }

  // ── STEP 3: SELF-QUERY SHORT-CIRCUIT ──────────────────────────────────────
  if (resolution.isSelfQuery) {
    const spectreEntity = db.lookupByTicker('SPECTRE');
    return {
      type: 'SELF_QUERY',
      content: null,
      citations: [],
      model: 'internal',
      usage: null,
      resolvedEntities: resolution.resolved,
      selfQueryData: spectreEntity,
    };
  }

  // ── STEP 4: HARDEN QUERY + INJECT ENTITY CONTEXT ──────────────────────────
  const hardenedQuery = buildHardenedQuery(query, resolution.resolved);
  const entityContext = buildEntityContext(resolution.resolved);
  const finalSystemPrompt = entityContext ? `${systemPrompt}\n\n${entityContext}` : systemPrompt;

  // ── STEP 5: EXECUTE VIA FALLBACK CHAIN ────────────────────────────────────
  const result = await callWithFallback(finalSystemPrompt, hardenedQuery, {
    model,
    maxTokens,
    timeout,
    searchContextSize,
    agentId,
  });

  if (!result) {
    return {
      type: 'ERROR',
      content: null,
      citations: [],
      model: null,
      usage: null,
      resolvedEntities: resolution.resolved,
      error: 'All AI providers failed',
    };
  }

  const elapsed = Date.now() - startTime;
  console.log(`[gate] agent=${agentId} SUCCESS in ${elapsed}ms model=${result.model}`);

  return {
    type: 'SUCCESS',
    content: result.content,
    citations: result.citations || [],
    model: result.model,
    usage: result.usage,
    resolvedEntities: resolution.resolved,
  };
}

function buildDisambiguationMessage(ambiguousItems) {
  const messages = ambiguousItems.map(item => {
    const options = item.options
      .map((o, i) => `${i + 1}. ${o.name}${o.ticker ? ` ($${o.ticker})` : ''} — ${o.hint}`)
      .join('\n');
    return `"${item.candidate.raw}" could mean:\n${options}`;
  });
  return messages.join('\n\n') + '\n\nWhich did you mean?';
}

module.exports = {
  gatedPerplexitySearch,
  callWithFallback,
  callPerplexity,
};
