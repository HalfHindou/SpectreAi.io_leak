/**
 * Vercel Serverless – Fear & Greed API proxy
 * Receives requests rewritten from /api/fear-greed/* via vercel.json
 * Routes to CoinMarketCap (primary) or Alternative.me/CoinGecko (fallback)
 */

import { rateLimit } from '../ratelimit.js';
import { chat } from '../llm-gateway.js';

const CMC_DATA_API = 'https://api.coinmarketcap.com/data-api/v3/fear-greed/chart';
const CMC_API_KEY = process.env.CMC_API_KEY || '';
const CMC_BASE = 'https://pro-api.coinmarketcap.com';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

// Direct Spectre Data API origin (Hetzner) — used by the Groq-backed
// /thesis endpoint to pull the awareness snapshot + market regime. Mirrors
// market-intel.js so we never accidentally hit the CF-blocked api.spectreai.io.
const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.BRAIN_GROQ_MODEL || 'openai/gpt-oss-120b';

// Simple in-memory cache for serverless (shared across warm invocations)
const _cache = {};
function getCached(key, ttlMs) {
  const e = _cache[key];
  if (!e || Date.now() - e.ts > ttlMs) return null;
  return e.data;
}
function setCached(key, data) {
  _cache[key] = { data, ts: Date.now() };
}

async function cmcFetch(url) {
  return fetch(url, {
    headers: { Accept: 'application/json', 'X-CMC_PRO_API_KEY': CMC_API_KEY },
  });
}

// ── Handlers ──────────────────────────────────────────────────────

async function handleCurrent() {
  const cached = getCached('current', 10 * 60 * 1000);
  if (cached) return cached;

  // Primary: CMC public data API (no key needed)
  try {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 2 * 86400; // 2 days back to ensure we get data
    const r = await fetch(`${CMC_DATA_API}?start=${start}&end=${now}`);
    if (r.ok) {
      const j = await r.json();
      const list = j?.data?.dataList;
      if (list?.length) {
        const d = list[list.length - 1]; // latest entry
        const result = { value: d.score, classification: d.name || '', timestamp: d.timestamp, source: 'coinmarketcap' };
        setCached('current', result);
        return result;
      }
    }
  } catch (_) { /* fall through */ }

  // Fallback: Alternative.me
  const r = await fetch('https://api.alternative.me/fng/?limit=1');
  const j = await r.json();
  const d = j?.data?.[0];
  if (d) {
    const result = { value: parseInt(d.value, 10), classification: d.value_classification || '', timestamp: d.timestamp, source: 'alternative.me' };
    setCached('current', result);
    return result;
  }
  throw new Error('All sources failed');
}

async function handleHistorical(limit) {
  const key = `hist_${limit}`;
  const cached = getCached(key, 60 * 60 * 1000);
  if (cached) return cached;

  // Primary: CMC public data API (no key needed)
  try {
    const now = Math.floor(Date.now() / 1000);
    const start = now - limit * 86400;
    const r = await fetch(`${CMC_DATA_API}?start=${start}&end=${now}`);
    if (r.ok) {
      const j = await r.json();
      const list = j?.data?.dataList;
      if (list?.length) {
        const data = list.map(x => ({ value: x.score, classification: x.name || '', timestamp: x.timestamp }));
        const btcPrices = list.filter(x => x.btcPrice).map(x => [parseInt(x.timestamp, 10) * 1000, parseFloat(x.btcPrice)]);
        const btcVolumes = list.filter(x => x.btcVolume).map(x => [parseInt(x.timestamp, 10) * 1000, parseFloat(x.btcVolume)]);
        const result = { data, btcPrices, btcVolumes, source: 'coinmarketcap' };
        setCached(key, result);
        return result;
      }
    }
  } catch (_) { /* fall through */ }

  // Fallback: Alternative.me
  const r = await fetch(`https://api.alternative.me/fng/?limit=${limit}`);
  const j = await r.json();
  const data = (j?.data || []).map(x => ({ value: parseInt(x.value, 10), classification: x.value_classification || '', timestamp: x.timestamp })).reverse();
  const result = { data, source: 'alternative.me' };
  setCached(key, result);
  return result;
}

async function handleGlobalMetrics() {
  const cached = getCached('global', 5 * 60 * 1000);
  if (cached) return cached;

  if (CMC_API_KEY) {
    try {
      const r = await cmcFetch(`${CMC_BASE}/v1/global-metrics/quotes/latest`);
      if (r.ok) {
        const j = await r.json();
        const d = j?.data;
        const result = {
          totalMarketCap: d?.quote?.USD?.total_market_cap || 0,
          totalVolume: d?.quote?.USD?.total_volume_24h || 0,
          btcDominance: d?.btc_dominance || 0,
          ethDominance: d?.eth_dominance || 0,
          marketCapChange24h: d?.quote?.USD?.total_market_cap_yesterday_percentage_change || 0,
          activeCryptos: d?.active_cryptocurrencies || 0,
          defiVolume24h: d?.defi_volume_24h || 0,
          defiMarketCap: d?.defi_market_cap || 0,
          stablecoinVolume24h: d?.stablecoin_volume_24h || 0,
          source: 'coinmarketcap',
        };
        setCached('global', result);
        return result;
      }
    } catch (_) { /* fall through */ }
  }

  const headers = {};
  if (COINGECKO_API_KEY) headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
  const r = await fetch(`${COINGECKO_BASE}/global`, { headers });
  const j = await r.json();
  const d = j?.data;
  const result = {
    totalMarketCap: d?.total_market_cap?.usd || 0,
    totalVolume: d?.total_volume?.usd || 0,
    btcDominance: d?.market_cap_percentage?.btc || 0,
    ethDominance: d?.market_cap_percentage?.eth || 0,
    marketCapChange24h: d?.market_cap_change_percentage_24h_usd || 0,
    activeCryptos: d?.active_cryptocurrencies || 0,
    source: 'coingecko',
  };
  setCached('global', result);
  return result;
}

async function handleMovers() {
  const cached = getCached('movers', 5 * 60 * 1000);
  if (cached) return cached;

  if (CMC_API_KEY) {
    try {
      const r = await cmcFetch(`${CMC_BASE}/v1/cryptocurrency/trending/gainers-losers?limit=5&time_period=24h`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json();
        const mapC = c => ({ id: c.id, name: c.name, symbol: c.symbol, price: c.quote?.USD?.price || 0, change: c.quote?.USD?.percent_change_24h || 0, volume: c.quote?.USD?.volume_24h || 0, marketCap: c.quote?.USD?.market_cap || 0 });
        const gainers = (j?.data?.gainers || []).slice(0, 5).map(mapC);
        const losers = (j?.data?.losers || []).slice(0, 5).map(mapC);
        if (gainers.length > 0 || losers.length > 0) {
          const result = { gainers, losers, source: 'coinmarketcap' };
          setCached('movers', result);
          return result;
        }
      }
    } catch (_) { /* fall through */ }
  }

  // Binance fallback with allorigins.win proxy (Binance blocks Vercel IPs)
  const binanceUrl = 'https://api.binance.com/api/v3/ticker/24hr';
  let data = null;

  // Try direct Binance first
  try {
    const r = await fetch(binanceUrl, { signal: AbortSignal.timeout(8000) });
    if (r.ok) data = await r.json();
  } catch (_) { /* fall through to proxy */ }

  // Fallback: allorigins.win proxy
  if (!data) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(binanceUrl)}`;
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) data = await r.json();
    } catch (_) { /* fall through */ }
  }

  if (!data || !Array.isArray(data)) {
    return { gainers: [], losers: [], source: 'unavailable' };
  }

  const asciiOnly = /^[A-Z0-9]+$/;
  const pairs = data
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 5000000 && asciiOnly.test(t.symbol.replace('USDT', '')))
    .map(t => ({ symbol: t.symbol.replace('USDT', ''), name: t.symbol.replace('USDT', ''), price: parseFloat(t.lastPrice), change: parseFloat(t.priceChangePercent), volume: parseFloat(t.quoteVolume), high24h: parseFloat(t.highPrice), low24h: parseFloat(t.lowPrice), trades: parseInt(t.count, 10) || 0, marketCap: 0 }))
    .sort((a, b) => b.change - a.change);
  const result = { gainers: pairs.filter(t => t.change > 0).slice(0, 5), losers: pairs.filter(t => t.change < 0).sort((a, b) => a.change - b.change).slice(0, 5), source: 'binance' };
  setCached('movers', result);
  return result;
}

// ── Thesis (Groq-backed narrative card) ──────────────────────────

const FG_THESIS_SYSTEM_PROMPT = `You are Spectre Brain analyzing the crypto Fear & Greed Index. You write like a senior strategist thinking out loud to a friend: confident, specific, no hedging, no AI tells, no "as of now". One person's POV connecting the dots — frame it that way, not as a definitive call.

You are given a live snapshot covering: current F&G value + classification, 1-week / 1-month / 1-year context, regime label, BTC/ETH/SOL prices and recent change, a cross-domain snapshot (macro, funding, ETF flows, narratives, whales, news, calendar), AND a TradFi pipeline + policy timeline static context. The TradFi pipeline is critical context for cross-asset rotation — large pre-IPO offerings (SpaceX, OpenAI, Anthropic, Stripe, Databricks) compete with crypto for risk capital. Always reason about whether retail and institutional money is rotating INTO crypto or OUT of crypto.

Return JSON with this exact shape — no markdown, no headers, no emoji:

{
  "read": "1 sentence — what this F&G number means RIGHT NOW. Plain English. Reference the specific value.",
  "thesis": "4-6 sentences connecting the dots: why we are here. Cite specific numbers from the snapshot (BTC price, ETF flow, funding, regime). The 'why is the market down/up' answer. Explicitly weave in cross-asset context: TradFi flows, IPO pipeline draining capital, regulatory timing (Clarity Act, FOMC), DXY/yield pressure. Use concrete cause-and-effect.",
  "crossAsset": "2-3 sentences — where the money is going. Pre-IPO insider dumping, TradFi rotation, gold/DXY/SPY relationship to crypto risk-on/off. This is the 'big picture flow' answer the screenshot-style POV demands. Name specific names if relevant (SpaceX, OpenAI, Anthropic, Clarity Act).",
  "bullCase": [
    "Scenario 1 — concrete trigger + level (e.g. 'BTC reclaims $68K + funding flips positive: shorts trap, F&G snaps to 40+')",
    "Scenario 2 — macro/policy trigger (e.g. 'Clarity Act passes Senate + soft CPI: institutional bid returns')",
    "Scenario 3 — flow trigger (e.g. 'ETF flows snap back positive after 5-day outflow streak ends')"
  ],
  "bearCase": [
    "Scenario 1 — level break (e.g. 'lose $62K, long liqs cascade through $58K')",
    "Scenario 2 — macro/policy miss (e.g. 'hot CPI + Clarity stalls past Q4: capital stays in TradFi pre-IPOs')",
    "Scenario 3 — flow trigger (e.g. 'ETF outflows continue + whale exchange inflows accelerate')"
  ],
  "meanReversion": "2-3 sentences. Historical pattern: when F&G has been in THIS zone before, what typically happens next over 7-30-60 days. Reference contrarian wisdom (extreme fear = local bottoms, extreme greed = local tops) but ground it in the specific zone the value sits in.",
  "watchlist": ["3-5 short bullet items — specific catalysts/levels/dates to watch this week (mix crypto levels, macro prints, regulatory dates, TradFi IPO timeline if relevant)"],
  "conviction": "low" | "medium" | "high"
}

Rules:
- Cite specific numbers from the snapshot. NEVER invent data not in the snapshot.
- bullCase and bearCase MUST be arrays of 2-3 scenarios EACH. Each scenario is a complete short sentence naming a concrete trigger and the resulting move. Multiple scenarios because real markets have multiple paths.
- The crossAsset section is the screenshot-style "connect-the-dots" voice — money flow narrative, not just price action. Pre-IPO dynamics, policy timing, asset-class rotation.
- If the snapshot does not cover a domain (e.g. ETF flows closed for the day), say so plainly in the thesis. Do not fabricate.
- Voice: terse, specific, opinionated. Avoid: "could", "may", "potentially", "it appears", "based on the data".
- The mean-reversion section is the most quoted — make it memorable. Use phrases like "at this zone, history says..." but ground the actual prediction in the snapshot.
- Total payload under 1800 tokens.`;

function _fgPct(n, d = 1) {
  if (!Number.isFinite(n)) return '?';
  return (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
}
function _fgUsd(n) {
  if (!Number.isFinite(n) || n === 0) return '?';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(2);
}
function _fgZone(v) {
  if (!Number.isFinite(v)) return 'unknown';
  if (v <= 25) return 'Extreme Fear (0-25)';
  if (v <= 45) return 'Fear (25-45)';
  if (v <= 55) return 'Neutral (45-55)';
  if (v <= 75) return 'Greed (55-75)';
  return 'Extreme Greed (75-100)';
}

// Inline compactor mirroring packages/server/index.js compactAwareness. One
// line per domain, top items, key fields only. Returns a string the LLM can
// digest in ~3-4KB. Vercel handler stays self-contained — no shared imports.
function _compactAwareness(root) {
  if (!root) return '';
  const lines = [];
  const num = v => (Number.isFinite(+v) ? +v : null);
  const usd = v => { const n = num(v); if (n == null) return '?'; const a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'; return '$' + n.toFixed(2); };
  const pct = (v, d = 2) => { const n = num(v); return n == null ? '?' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%'; };
  const items = k => root[k]?.items;
  const m = items('macro_confluence')?.[0]?.snapshot;
  if (m) {
    const btc = m.crypto?.BTC, eth = m.crypto?.ETH, y10 = m.yields?.US10Y, dxy = m.fx?.DXY;
    lines.push(`MACRO: BTC ${usd(btc?.price_usd)} ${pct(btc?.change_24h_pct)} · ETH ${usd(eth?.price_usd)} ${pct(eth?.change_24h_pct)} · US10Y ${num(y10?.value)?.toFixed(2) ?? '?'}% · DXY ${num(dxy?.value)?.toFixed(2) ?? '?'}`);
  }
  const cr = items('crypto') || [];
  if (cr.length) lines.push('CRYPTO MOVERS: ' + cr.slice(0, 5).map(r => `${(r.asset || '').split('_')[0]} ${pct(r.pct_change_24h, 1)}`).join(' · '));
  const tr = items('trenches') || [];
  if (tr.length) lines.push('TRENCHES: ' + tr.slice(0, 4).map(r => `${r.name || (r.asset || '').split('_')[0]} ${Math.round(num(r.mentions_24h) || 0)}ment ${pct(r.pct_change_24h, 1)}`).join(' · '));
  const fund = items('derivatives')?.[0]?.funding_extremes || [];
  if (fund.length) lines.push('FUNDING: ' + fund.slice(0, 4).map(f => `${f.asset} ${(num(f.weighted_funding_rate) * 100).toFixed(3)}% ${f.sentiment || ''}`.trim()).join(' · '));
  const nar = items('narratives') || [];
  if (nar.length) lines.push('NARRATIVES: ' + nar.slice(0, 4).map(n => `${n.display_name || n.narrative} (${num(n.mention_share_pct)?.toFixed(2)}%, ${n.momentum})`).join(' · '));
  const cat = items('categories') || [];
  if (cat.length) lines.push('SECTORS: ' + cat.slice(0, 4).map(c => `${c.name} ${pct(c.change_24h_pct ?? c.market_cap_change_24h_pct, 1)}`).join(' · '));
  const wh = items('whales') || [];
  if (wh.length) lines.push('WHALES: ' + wh.slice(0, 3).map(w => `${w.asset} ${usd(w.amount_usd)} (${w.tx_type || 'tx'})`).join(' · '));
  const etf = items('etf_flows') || [];
  if (etf.length) lines.push('ETF FLOWS: ' + etf.slice(0, 3).map(e => `${e.asset} ${e.date || ''} ${usd(e.net_flow_usd)}`).join(' · '));
  else lines.push('ETF FLOWS: closed (daily data)');
  const sc = items('stablecoins') || [];
  if (sc.length) lines.push('STABLES: ' + sc.slice(0, 4).map(s => `${s.symbol} peg ${((1 - (num(s.price) ?? 1)) * 10000).toFixed(1)}bps ${pct(s.circulating_change_24h_pct, 2)}`).join(' · '));
  const un = items('unlocks') || [];
  if (un.length) lines.push('UPCOMING UNLOCKS: ' + un.slice(0, 3).map(u => `${u.asset} ${u.unlock_date?.slice(0, 10)} ${usd(u.amount_usd) || Math.round(num(u.amount) || 0) + ' tokens'}`).join(' · '));
  const nw = items('news') || [];
  if (nw.length) lines.push('NEWS: ' + nw.slice(0, 3).map(n => (n.title || '').slice(0, 80)).join(' | '));
  const cal = items('calendar') || [];
  if (cal.length) lines.push('CALENDAR: ' + cal.slice(0, 3).map(c => `${(c.event_name || c.title || '').slice(0, 40)} ${c.date || c.event_time || ''}`.trim()).join(' · '));
  return lines.join('\n');
}

function _historyStats(list, currentValue) {
  if (!Array.isArray(list) || !list.length) return null;
  const vals = list.map(p => Number(p?.value ?? p?.score)).filter(Number.isFinite);
  if (!vals.length) return null;
  const len = vals.length;
  const last = vals[len - 1];
  const yesterday = vals[len - 2];
  const week = vals.slice(Math.max(0, len - 8), len - 1);
  const month = vals.slice(Math.max(0, len - 31), len - 1);
  const avg = a => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null;
  let percentile = null;
  if (Number.isFinite(currentValue)) {
    const below = vals.filter(v => v <= currentValue).length;
    percentile = Math.round((below / vals.length) * 100);
  }
  return {
    weekAvg: avg(week),
    monthAvg: avg(month),
    yearMin: Math.min(...vals),
    yearMax: Math.max(...vals),
    percentile,
    yesterday,
    last,
  };
}

// Hard ceiling for regeneration — once per day even if nothing material moves.
const FG_THESIS_HARD_TTL_MS = 24 * 60 * 60 * 1000;

// Fingerprint mirrors packages/server/index.js: zone label, F&G bucketed by 5,
// regime label, BTC bucketed by $2K. Returns null if F&G is unavailable.
function _fingerprint(current, regime, coins) {
  if (!current || current.value == null) return null;
  const v = current.value;
  const fgBucket = Math.round(v / 5) * 5;
  const zone = _fgZone(v);
  const regimeLabel = regime?.label || 'none';
  const btc = (coins || []).find(c => c.symbol === 'BTC');
  const btcBucket = btc?.price ? Math.round(btc.price / 2000) * 2000 : 0;
  return `${zone}|${fgBucket}|${regimeLabel}|${btcBucket}`;
}

async function handleThesis() {
  // No hard key gate — the resilient gateway (Groq → Cerebras/Gemini →
  // OpenRouter → OpenAI/Anthropic → Ollama) serves this whenever ANY provider
  // is live. We only bail (below) when the gateway itself returns !ok.

  // ALWAYS fetch fingerprint inputs — they're cheap (CMC + Spectre 5-min
  // upstream caches). The expensive thing is Groq; the fingerprint is what
  // guards it.

  // 1. Pull current F&G from existing CMC handler (cheap, already cached)
  let current = null;
  try { current = await handleCurrent(); } catch (_) { current = null; }

  // 2. Pull history (also already cached) for week/month/percentile context
  let histPayload = null;
  try { histPayload = await handleHistorical(365); } catch (_) { histPayload = null; }
  const hist = current?.value != null ? _historyStats(histPayload?.data || [], current.value) : null;

  // 3. Pull regime + awareness + majors from Spectre Data API
  const spectreHeaders = SPECTRE_API_KEY ? { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' } : { Accept: 'application/json' };
  const [regimeR, awarenessR, coinsR] = await Promise.allSettled([
    fetch(`${SPECTRE_API_BASE}/v1/market/regime`, { headers: spectreHeaders, signal: AbortSignal.timeout(6000) }),
    fetch(`${SPECTRE_API_BASE}/v1/brain/awareness/full`, { headers: spectreHeaders, signal: AbortSignal.timeout(12000) }),
    fetch(`${SPECTRE_API_BASE}/v1/coins/markets?ids=bitcoin,ethereum,solana&order=market_cap_desc&per_page=3&price_change_percentage=24h,7d,30d`, { headers: spectreHeaders, signal: AbortSignal.timeout(6000) }),
  ]);

  const regimeJson = regimeR.status === 'fulfilled' && regimeR.value.ok ? await regimeR.value.json().catch(() => null) : null;
  const awarenessJson = awarenessR.status === 'fulfilled' && awarenessR.value.ok ? await awarenessR.value.json().catch(() => null) : null;
  const coinsJson = coinsR.status === 'fulfilled' && coinsR.value.ok ? await coinsR.value.json().catch(() => null) : null;

  const regime = regimeJson?.data || null;
  const awarenessText = awarenessJson ? _compactAwareness(awarenessJson?.data || awarenessJson).slice(0, 4000) : '';

  const coinsRaw = Array.isArray(coinsJson) ? coinsJson : (coinsJson?.data || coinsJson?.coins || []);
  const coins = (Array.isArray(coinsRaw) ? coinsRaw : []).map(c => ({
    symbol: String(c.symbol || c.id || '').toUpperCase(),
    price: Number(c.current_price ?? c.price ?? 0),
    ch24: Number(c.price_change_percentage_24h ?? c.price_change_percentage_24h_in_currency ?? 0),
    ch7d: Number(c.price_change_percentage_7d_in_currency ?? c.price_change_percentage_7d ?? 0),
    ch30d: Number(c.price_change_percentage_30d_in_currency ?? c.price_change_percentage_30d ?? 0),
  })).filter(c => c.symbol);

  // Fingerprint check — short-circuit before Groq if nothing material changed.
  // Same pattern as the Express handler. Cache entry shape:
  //   { data: <full payload>, ts: <epoch ms>, fingerprint: <string> }
  const fingerprint = _fingerprint(current, regime, coins);
  const cachedEntry = _cache['thesis'];
  if (cachedEntry?.data) {
    const age = Date.now() - cachedEntry.ts;
    const fpMatch = fingerprint && cachedEntry.fingerprint === fingerprint;
    const withinHardTTL = age < FG_THESIS_HARD_TTL_MS;
    if ((fpMatch && withinHardTTL) || !fingerprint) {
      // Cache HIT (fingerprint stable) OR stale-while-error (no fingerprint
      // and we have something to show). Either way, no Groq spend.
      return cachedEntry.data;
    }
  }

  // No cache + no F&G → can't generate. Hide the card.
  if (!current || current.value == null) {
    console.warn('[fg/thesis] no current F&G — refusing to generate');
    return {};
  }

  // 4. Build snapshot string
  const lines = [];
  lines.push(`F&G NOW: ${current.value} (${current.classification || _fgZone(current.value)}) — zone: ${_fgZone(current.value)}`);
  if (hist) {
    const parts = [];
    if (hist.yesterday != null) parts.push(`yesterday ${hist.yesterday}`);
    if (hist.weekAvg != null) parts.push(`week avg ${hist.weekAvg}`);
    if (hist.monthAvg != null) parts.push(`month avg ${hist.monthAvg}`);
    if (hist.percentile != null) parts.push(`bottom ${hist.percentile}% of 365d readings`);
    if (hist.yearMin != null && hist.yearMax != null) parts.push(`365d range ${hist.yearMin}-${hist.yearMax}`);
    if (parts.length) lines.push('F&G CONTEXT: ' + parts.join(' · '));
  }
  if (regime?.label) {
    lines.push(`REGIME: ${regime.label}${regime.description ? ' — ' + regime.description : ''}${regime.confidence != null ? ' (conf ' + regime.confidence + ')' : ''}`);
  }
  if (coins.length) {
    lines.push('MAJORS: ' + coins.map(c => `${c.symbol} ${_fgUsd(c.price)} 24h ${_fgPct(c.ch24)} 7d ${_fgPct(c.ch7d)} 30d ${_fgPct(c.ch30d)}`).join(' · '));
  }
  if (awarenessText) {
    lines.push('');
    lines.push('CROSS-DOMAIN SNAPSHOT (one line per domain):');
    lines.push(awarenessText);
  }
  // Static cross-asset context — TradFi pipeline + policy timeline. The
  // "where is risk capital actually going" inputs that pure on-chain data
  // doesn't capture. Mirrors packages/server/index.js. Phrased loosely so
  // valuation drift doesn't make it stale fast — refresh quarterly.
  lines.push('');
  lines.push('TRADFI PIPELINE (capital that competes with crypto for risk-on flows — pre-IPO/secondary markets are draining retail risk appetite):');
  lines.push('- SpaceX: private ~$350B+ valuation, IPO speculation 2026-27, secondaries actively traded');
  lines.push('- OpenAI: private ~$300B+ valuation, IPO timing unclear (likely 2027+)');
  lines.push('- Anthropic: private ~$60B+ valuation, fundraising/secondaries active');
  lines.push('- Stripe: private ~$91B+ last round, IPO long-rumored');
  lines.push('- Databricks / xAI / others: late-stage SPVs absorbing risk capital');
  lines.push('Implication: institutional + retail flows that historically rotated into crypto may be parked in pre-IPO secondaries until those liquidity events trigger rotation back.');
  lines.push('');
  lines.push('POLICY / REGULATORY TIMELINE:');
  lines.push('- CLARITY Market Structure Act: U.S. House passed; Senate vote pending; consensus = late Q3/Q4 2026 if at all. Passage = institutional unlock catalyst.');
  lines.push('- GENIUS Act (stablecoins): in motion through Congress');
  lines.push('- FOMC: rate path uncertain — check CALENDAR snapshot for next meeting');
  lines.push('- SEC: enforcement vs framework debate ongoing under current administration');
  const snapshot = lines.join('\n');

  // 5. Call the LLM gateway with JSON mode. `smart` tier (70B) for the thesis;
  // `json: true` mirrors the old response_format:{type:'json_object'}.
  const gw = await chat({
    messages: [
      { role: 'system', content: FG_THESIS_SYSTEM_PROMPT },
      { role: 'user', content: `Live snapshot:\n${snapshot}\n\nReturn your analysis as JSON.` },
    ],
    tier: 'smart',
    maxTokens: 1800,
    temperature: 0.4,
    timeoutMs: 35_000,
    json: true,
  });
  if (!gw.ok) {
    console.warn('[fg/thesis] gateway failed', gw.error);
    // Stale-while-error: prefer showing an old payload over a blank card.
    if (cachedEntry?.data) return cachedEntry.data;
    return {};
  }
  const content = gw.text;
  let parsed = null;
  try { parsed = JSON.parse(content || ''); } catch { parsed = null; }
  if (!parsed || !parsed.thesis) {
    console.warn('[fg/thesis] gateway returned no usable thesis');
    if (cachedEntry?.data) return cachedEntry.data;
    return {};
  }

  // bullCase/bearCase may come back as either an array (preferred) or a
  // single string (legacy). Normalize to arrays so the frontend renders
  // consistently. crossAsset is a single narrative paragraph.
  const asArr = v => {
    if (Array.isArray(v)) return v.slice(0, 4).map(s => String(s).slice(0, 280));
    if (typeof v === 'string' && v.trim()) return [v.slice(0, 280)];
    return [];
  };
  const result = {
    data: {
      read: String(parsed.read || ''),
      thesis: String(parsed.thesis || ''),
      crossAsset: String(parsed.crossAsset || ''),
      bullCase: asArr(parsed.bullCase),
      bearCase: asArr(parsed.bearCase),
      meanReversion: String(parsed.meanReversion || ''),
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist.slice(0, 6).map(w => String(w).slice(0, 160)) : [],
      conviction: ['low', 'medium', 'high'].includes(parsed.conviction) ? parsed.conviction : 'medium',
      fgValue: current.value,
      fgClassification: current.classification,
      fgZone: _fgZone(current.value),
      regimeLabel: regime?.label || null,
      generatedAt: new Date().toISOString(),
    },
  };
  // Store payload alongside fingerprint so the next request can skip Groq when
  // the market hasn't moved. The plain setCached helper only stores TTL'd data,
  // so we write directly to the underlying _cache map.
  _cache['thesis'] = { data: result, ts: Date.now(), fingerprint };
  return result;
}

// ── Main handler ──────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (await rateLimit(req, res, { bucket: 'fear-greed', max: 60, windowMs: 60_000 })) return;

  const path = req.query.path || '';

  // Audit 2026-06-03: every fear-greed response now also sets
  // CDN-Cache-Control so Vercel's edge can serve cookie-bearing requests
  // from cache. Without this, cookies disable edge caching even though
  // Cache-Control says s-maxage=N. Single biggest perf lever per audit.
  const setCdnCache = (sMax, swr) => {
    const h = `public, s-maxage=${sMax}, stale-while-revalidate=${swr}`;
    res.setHeader('Cache-Control', h);
    res.setHeader('CDN-Cache-Control', h);
    res.setHeader('Vary', 'Accept-Encoding');
  };

  try {
    let result;
    if (path === 'current') {
      result = await handleCurrent();
      setCdnCache(300, 600);
    } else if (path === 'historical') {
      const limit = Math.min(parseInt(req.query.limit, 10) || 365, 2600);
      result = await handleHistorical(limit);
      setCdnCache(1800, 3600);
    } else if (path === 'global-metrics') {
      result = await handleGlobalMetrics();
      setCdnCache(120, 300);
    } else if (path === 'movers') {
      result = await handleMovers();
      setCdnCache(120, 300);
    } else if (path === 'thesis') {
      result = await handleThesis();
      setCdnCache(1800, 3600);
    } else {
      return res.status(400).json({ error: `Unknown path: ${path}` });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('Fear & Greed proxy error:', err.message);
    return res.status(502).json({ error: 'Fear & Greed API unavailable' });
  }
}
