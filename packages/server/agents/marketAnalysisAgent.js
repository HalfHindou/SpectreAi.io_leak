/**
 * Spectre Intelligence Hub — Market Analysis Agent
 *
 * Generates the AI Market Analysis article rendered by the Command Center
 * "AI Market" tab. Pulls LIVE price / funding / OI / liquidations / F&G data
 * from the Express server itself (NOT from any external GCP service), then
 * asks Perplexity sonar-pro to write a 3-part article that respects the
 * user-selected timeframe (1h / 24h / 7d).
 *
 * Output cache: content/market-analysis/{timeframe}.json  (15m TTL)
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { logAgentActivity } = require('./activityLog');
// Resilient multi-provider LLM gateway (Groq → Cerebras/Gemini free → OpenRouter
// → OpenAI/Anthropic → Ollama) with circuit breaker. Replaces the direct
// Groq-only fetch so this cron survives the Groq billing outage and can run on
// a free provider. `chat()` returns { ok, text, provider, model, error }.
const { chat: gatewayChat, providerStatus: gatewayProviderStatus } = require('../lib/llm-gateway');

const STALE_MS = 15 * 60 * 1000; // 15 minutes
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 35000;
// True if ANY gateway provider has a key (Groq/Cerebras/Gemini/OpenRouter/
// OpenAI/Anthropic/Ollama) — not just GROQ. Lets the cron run on a free
// provider when Groq is down. Falls back to the raw GROQ check if the gateway
// can't be queried.
const HAS_LLM_KEY = (() => {
  try { return gatewayProviderStatus().some((p) => p.hasKey); } catch { return Boolean(GROQ_API_KEY); }
})();

// Delegates to the shared gateway. Keeps the { ok, content, error } shape every
// call site already expects. `tier:'smart'` maps to each provider's 70B-class
// model (Groq's llama-3.3-70b, Cerebras' llama-3.3-70b, Gemini 2.0 Flash, …).
async function callGroq(systemPrompt, userMessage, { maxTokens = 900, temperature = 0.2 } = {}) {
  const r = await gatewayChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    tier: 'smart',
    maxTokens,
    temperature,
    timeoutMs: GROQ_TIMEOUT_MS,
  });
  if (r.ok) return { ok: true, content: r.text || '', provider: r.provider };
  return { ok: false, content: '', error: r.error || `all LLM providers failed (${(r.tried || []).join(', ')})` };
}

const CACHE_DIR = path.join(__dirname, '..', 'content', 'market-analysis');
const VALID_TIMEFRAMES = ['1h', '24h', '7d'];

const TIMEFRAME_META = {
  '1h':  { window: 'intraday (last hour)',  biasField: '1h %',   horizon: 'next few hours' },
  '24h': { window: 'last 24 hours',         biasField: '24h %',  horizon: 'next trading session' },
  '7d':  { window: 'last 7 days',           biasField: '7d %',   horizon: 'coming week' },
};

// ── CACHE HELPERS ───────────────────────────────────────────────────────────

function cachePath(timeframe) {
  return path.join(CACHE_DIR, `${timeframe}.json`);
}

function loadCache(timeframe) {
  try {
    const p = cachePath(timeframe);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function saveCache(timeframe, data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(timeframe), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[MarketAnalysis] Failed to save cache:', e.message);
  }
}

// ── IN-PROCESS DATA FETCH (localhost HTTP to our own Express) ───────────────
// We intentionally go through HTTP rather than importing helpers because the
// data endpoints are defined inline inside packages/server/index.js and are
// not exported. The warmer and several other agents use the same pattern.

const PORT = process.env.PORT || 3001;
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;

async function fetchJson(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { timeout: timeoutMs });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

function fmtPct(n, digits = 2) {
  if (n == null || !isFinite(n)) return 'n/a';
  const v = Number(n);
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtUsd(n) {
  if (n == null || !isFinite(n)) return 'n/a';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Gather all live inputs in parallel: local Express routes for what the server
 * already aggregates, plus DIRECT upstreams for the layers it never had —
 * F&G trend (alternative.me), top-trader positioning + OI delta + taker flow
 * (Binance futures), and the economic calendar (FairEconomy, keyless).
 * Returns a structured snapshot the prompt builder can consume.
 */
async function gatherLiveSnapshot() {
  const [
    tickers, global, funding, oi, liq, lsRatio, indices, breaking,
    fgTrend, topLs, oiHist, richMajors, calendar, takerKlines,
  ] = await Promise.all([
    fetchJson(`${LOCAL_BASE}/api/market/tickers`),
    fetchJson(`${LOCAL_BASE}/api/market/global`),
    fetchJson(`${LOCAL_BASE}/api/market/funding`),
    fetchJson(`${LOCAL_BASE}/api/market/oi`),
    fetchJson(`${LOCAL_BASE}/api/market/liquidations`),
    fetchJson(`${LOCAL_BASE}/api/market/ls-ratio`),
    // Cross-asset: the equity tape. Crypto and stocks both selling off (or both
    // ripping) is a shared risk-on/off regime, not a crypto-specific story — give
    // the model the equity context so it can say so instead of guessing.
    fetchJson(`${LOCAL_BASE}/api/stocks/indices`),
    // Catalysts: the SAME breaking feed that powers the panel's CONTEXT bullets,
    // so the brief can lead with WHY the market moved instead of generic macro.
    fetchJson(`${LOCAL_BASE}/api/intelligence/breaking`),
    // F&G with history so the model can cite the TREND, not a naked level.
    fetchJson('https://api.alternative.me/fng/?limit=8&format=json'),
    // Top-trader POSITION skew — the closest public read on whether big
    // players are bidding or distributing (vs the retail account ratio above).
    fetchJson('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1'),
    // OI history: 7 x 4h points = 24h OI delta in USD.
    fetchJson('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=4h&limit=7'),
    // Multi-window tape (7d/30d + ATH distance) for the dip-or-rally read.
    fetchJson(
      `${process.env.COINGECKO_API_KEY ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'}/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana&price_change_percentage=1h,24h,7d,30d&sparkline=false${process.env.COINGECKO_API_KEY ? `&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}` : ''}`,
      8000
    ),
    // Economic calendar (keyless FairEconomy this-week feed).
    fetchJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json', 8000),
    // Taker flow: 24h net aggressive buys on BTC perps.
    fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=24'),
  ]);

  const majors = tickers?.majorCoins || {};
  const btc = majors.btc || null;
  const eth = majors.eth || null;
  const sol = majors.sol || null;

  const liq24 = liq?.windows?.['24h'] || null;

  // Headlines from the breaking feed (same source as the panel's CONTEXT).
  const breakingArts = breaking?.articles || breaking?.items || (Array.isArray(breaking) ? breaking : []);
  const headlines = (Array.isArray(breakingArts) ? breakingArts : [])
    .map((a) => ({ title: (a?.headline || a?.title || '').trim(), source: a?.source?.name || a?.source || '' }))
    .filter((h) => h.title)
    .slice(0, 8);

  // /api/stocks/indices -> OBJECT keyed by symbol (accept arrays defensively).
  let equities = null;
  const idxRows = Array.isArray(indices) ? indices : (indices && typeof indices === 'object' ? Object.values(indices) : []);
  if (idxRows.length) {
    const byName = {};
    for (const r of idxRows) {
      if (!r || typeof r !== 'object') continue;
      if (r.name) byName[String(r.name).trim().toLowerCase()] = r;
      if (r.symbol) byName[String(r.symbol).trim().toLowerCase()] = r;
    }
    const pickIdx = (...names) => { for (const n of names) { const h = byName[n.toLowerCase()]; if (h) return h; } return null; };
    const sp = pickIdx('s&p 500', '^gspc');
    const ndq = pickIdx('nasdaq composite', 'nasdaq', '^ixic');
    const vix = pickIdx('cboe volatility index', 'vix', '^vix');
    if (sp || ndq || vix) {
      equities = {
        sp500: sp ? { change: sp.change } : null,
        nasdaq: ndq ? { change: ndq.change } : null,
        vix: vix ? { price: vix.price, change: vix.change } : null,
      };
    }
  }

  // F&G trend off alternative.me history (today / yesterday / a week ago).
  let fearGreed = null;
  const fgRows = Array.isArray(fgTrend?.data) ? fgTrend.data : [];
  if (fgRows.length) {
    fearGreed = {
      value: Number(fgRows[0].value),
      classification: fgRows[0].value_classification || null,
      yesterday: fgRows[1] ? Number(fgRows[1].value) : null,
      weekAgo: fgRows[7] ? Number(fgRows[7].value) : null,
    };
  }

  // Top-trader position skew.
  let topTrader = null;
  const tls = Array.isArray(topLs) ? topLs[0] : null;
  if (tls && tls.longShortRatio != null) {
    topTrader = {
      ratio: Number(tls.longShortRatio),
      longsPct: tls.longAccount != null ? Number(tls.longAccount) * 100 : null,
    };
  }

  // BTC OI in USD + 24h delta from the 4h history.
  let oiUsd = null;
  if (Array.isArray(oiHist) && oiHist.length >= 2) {
    const latest = Number(oiHist[oiHist.length - 1]?.sumOpenInterestValue);
    const dayAgo = Number(oiHist[0]?.sumOpenInterestValue);
    if (isFinite(latest)) {
      oiUsd = { btcUsd: latest, change24hPct: isFinite(dayAgo) && dayAgo ? ((latest - dayAgo) / dayAgo) * 100 : null };
    }
  }

  // Multi-window tape context from CoinGecko.
  const windows = {};
  if (Array.isArray(richMajors)) {
    for (const r of richMajors) {
      const key = r.id === 'bitcoin' ? 'btc' : r.id === 'ethereum' ? 'eth' : r.id === 'solana' ? 'sol' : null;
      if (!key) continue;
      windows[key] = {
        change1h: r.price_change_percentage_1h_in_currency ?? null,
        change7d: r.price_change_percentage_7d_in_currency ?? null,
        change30d: r.price_change_percentage_30d_in_currency ?? null,
        athChangePct: r.ath_change_percentage ?? null,
      };
    }
  }

  // Calendar: upcoming medium/high-impact prints (next 7 days + last 6h).
  const FF_IMPACT = { High: 'high', Medium: 'medium', Low: 'low' };
  const nowMs = Date.now();
  const calendarEvents = (Array.isArray(calendar) ? calendar : [])
    .map((e) => ({
      name: e.title || '',
      currency: e.country || '',
      impact: FF_IMPACT[e.impact] || 'low',
      dateTime: e.date || null,
      forecast: e.forecast || null,
      previous: e.previous || null,
      isFedEvent: /fed|fomc/i.test(e.title || ''),
    }))
    .filter((e) => e.dateTime && (e.impact !== 'low' || e.isFedEvent))
    .filter((e) => {
      const t = new Date(e.dateTime).getTime();
      return t > nowMs - 6 * 3600e3 && t < nowMs + 7 * 24 * 3600e3;
    })
    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
    .slice(0, 8);

  // Taker flow: 2*takerBuyQuote - quoteVolume per bar, summed over 24h.
  let takerFlowUsd = null;
  if (Array.isArray(takerKlines) && takerKlines.length) {
    takerFlowUsd = 0;
    for (const row of takerKlines) takerFlowUsd += 2 * (Number(row[10]) || 0) - (Number(row[7]) || 0);
  }

  return {
    prices: {
      btc: btc ? { price: btc.price, change24h: btc.change, high: btc.high, low: btc.low, volume: btc.volume, ...(windows.btc || {}) } : null,
      eth: eth ? { price: eth.price, change24h: eth.change, high: eth.high, low: eth.low, volume: eth.volume, ...(windows.eth || {}) } : null,
      sol: sol ? { price: sol.price, change24h: sol.change, high: sol.high, low: sol.low, volume: sol.volume, ...(windows.sol || {}) } : null,
    },
    global: global ? {
      totalMcap: global.totalMarketCap,
      totalVolume: global.totalVolume,
      btcDominance: global.btcDominance,
      ethDominance: global.ethDominance,
      mcapChange24h: global.marketCapChange24h,
    } : null,
    funding: funding ? { btc: funding.btc, eth: funding.eth } : null,
    oi: oi ? { btc: oi.btc, eth: oi.eth } : null,
    oiUsd,
    liq24h: liq24 ? { long: liq24.long, short: liq24.short, total: liq24.total, count: liq24.count } : null,
    fearGreed,
    lsRatio: lsRatio ? { ratio: lsRatio.ratio, longs: lsRatio.longs, shorts: lsRatio.shorts } : null,
    topTrader,
    takerFlowUsd,
    calendar: calendarEvents,
    equities,
    headlines,
  };
}

// ── PROMPT BUILDERS ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Spectre AI's lead market strategist. The voice is a senior macro/crypto trader briefing a peer at a multi-strategy fund. Sharp, opinionated, data-first. No retail-friendly hand-holding. No marketing. Write as "we" (Spectre AI).

You will be given LIVE market numbers. You MUST NOT contradict them. Anchor every claim to a number actually in the data. If a value is "n/a", say so or skip it — never fabricate.

WHAT MAKES AN ANSWER GOOD (read this carefully):
- Each section must say something a smart reader does not already see in the dashboard. We can see BTC is down 1.1%. Tell us why this move matters, what it confirms or breaks, what the next decision point is.
- Connect numbers to mechanics. "Funding is +0.006% with L/S at 1.47" means longs are paying to hold while crowding into a falling tape — that is a setup for a long squeeze if support breaks. Spell out that kind of read.
- Use real reference points: prior 24h range, the level where liquidations cluster, where dominance has been sitting. Be specific.
- Have an opinion. "Disciplined traders watch the $75,300 retest" is fine. "It remains to be seen" is not.

FORMAT: exactly three sections, literal headers, prose only (no bullets, no tables, no subheads).

ANALYSIS
<3-5 sentences. SENTENCE 1 IS THE THESIS - the UI extracts it as a standalone pill, keep it under 220 characters, and make it a POSITION a trader can act on: is this a dip being bought inside a larger downtrend, the start of a real rally, distribution to sell into, or chop to sit out - plus the strongest piece of evidence, in the same sentence (e.g. "BTC's +2.6% bounce off $58.3K reads as a real dip-buy, not a dead-cat: extreme fear is lifting off its lows, open interest is rebuilding and takers are net buyers."). NOT "the market is exhibiting a bearish bias." Use the multi-window tape (1h/24h/7d/30d) to say WHERE we are in the trend: a green day inside a red week is a bounce until the week flips - say which it is. Then cite BTC/ETH/SOL percent moves AND total market cap direction AND where price sits inside its 24h range. End with the regime read: accumulation bounce, digestion, distribution, reflexive squeeze, risk-off rotation.>

MACRO CONDITIONS
<3-5 sentences. Derivatives + sentiment + cross-asset + the macro layer. Fear & Greed LEVEL plus TREND (19 rising off an 11 low is capitulation lifting - contrarian-bullish if structure holds; 19 falling from 40 is fear still building; never quote the level without the direction). Open Interest AND its 24h change read with price direction (OI up + price up = new longs; price up on falling OI = short covering). Funding bias. RETAIL vs TOP-TRADER long/short stated with the numbers - top traders longer than retail = smart money bidding; retail crowded while top traders stay flat = big players NOT chasing. 24h liquidation skew when available. Name the imbalance: e.g. "longs crowded into the dump, funding still positive — a squeeze setup if support cracks." CROSS-ASSET: if the equity line is present and stocks are moving the SAME direction as crypto, say so explicitly — one shared risk-on/off regime, crypto is the highest-beta member; a decoupling is itself the signal. Then the macro layer: name the relevant MACRO/CALENDAR prints (actual vs forecast when given) and any geopolitical headline actually in the data - if a war or Fed headline is present, weigh it through the risk-regime channel; if not, do not invent one.>

POSITIONING
<3-5 sentences. What a disciplined trader does over the stated horizon. Specific levels where possible: support to defend (the 24h low), the breakout trigger (the 24h high), invalidation. Name the catalyst window from the CALENDAR (event and day) when one is listed. At least one concrete "if X then Y" structure with a level. State the big-player read in one clause: bidding, distributing, or absent. No "this is not financial advice" cope.>

NON-NEGOTIABLES:
- NEVER invent numbers. If liquidations are $0, say "no meaningful flush." Don't make up a figure.
- No em-dashes. Use commas, colons, or split sentences.
- No citation markers like [1][2] in prose.
- Banned phrases: "delve into", "landscape", "robust", "leverage" (as verb), "seamlessly", "deep dive", "navigate", "remains to be seen", "in conclusion", "it is worth noting", "as we move forward", "a testament to", "double-edged sword", "only time will tell", "the crypto space", "the world of", "in the rapidly evolving", "cautiously optimistic".
- Length: 280-450 words total. Density beats brevity. Earn every line.`;

function buildUserPrompt(timeframe, snapshot) {
  const meta = TIMEFRAME_META[timeframe];
  const p = snapshot.prices || {};
  const g = snapshot.global || {};
  const f = snapshot.funding || {};
  const o = snapshot.oi || {};
  const l = snapshot.liq24h || {};
  const fg = snapshot.fearGreed || {};
  const ls = snapshot.lsRatio || {};

  const tt = snapshot.topTrader || {};
  const oiU = snapshot.oiUsd || {};

  const lines = [];
  lines.push(`Write a 3-part Spectre AI market brief targeting the ${meta.window} window. Bias should be drawn from the ${meta.biasField} column and derivatives positioning. Horizon for the Positioning section: ${meta.horizon}. Sentence 1 = the thesis.`);
  lines.push('');
  lines.push('LIVE MARKET DATA (these are the ONLY numbers you may cite — do not contradict them; n/a means unavailable, never guess it):');
  lines.push('');
  lines.push('Prices:');
  const win = (c) => `${c.change1h != null ? `, 1h ${fmtPct(c.change1h)}` : ''}${c.change7d != null ? `, 7d ${fmtPct(c.change7d)}` : ''}${c.change30d != null ? `, 30d ${fmtPct(c.change30d)}` : ''}${c.athChangePct != null ? `, ${Number(c.athChangePct).toFixed(0)}% from ATH` : ''}`;
  if (p.btc) lines.push(`  BTC: $${p.btc.price?.toLocaleString?.() ?? p.btc.price}, 24h ${fmtPct(p.btc.change24h)}${win(p.btc)}, 24h high $${p.btc.high}, 24h low $${p.btc.low}`);
  else lines.push('  BTC: n/a');
  if (p.eth) lines.push(`  ETH: $${p.eth.price?.toLocaleString?.() ?? p.eth.price}, 24h ${fmtPct(p.eth.change24h)}${win(p.eth)}`);
  else lines.push('  ETH: n/a');
  if (p.sol) lines.push(`  SOL: $${p.sol.price?.toLocaleString?.() ?? p.sol.price}, 24h ${fmtPct(p.sol.change24h)}${win(p.sol)}`);
  else lines.push('  SOL: n/a');
  lines.push('');
  lines.push('Global:');
  lines.push(`  Total crypto market cap: ${fmtUsd(g.totalMcap)} (24h ${fmtPct(g.mcapChange24h)})`);
  lines.push(`  BTC dominance: ${g.btcDominance != null ? g.btcDominance.toFixed(2) + '%' : 'n/a'}, ETH dominance: ${g.ethDominance != null ? g.ethDominance.toFixed(2) + '%' : 'n/a'}`);
  lines.push('');
  lines.push('Derivatives / positioning:');
  lines.push(`  Open Interest (Binance perps): BTC ${fmtUsd(oiU.btcUsd ?? o.btc)}${oiU.change24hPct != null ? ` (24h change ${fmtPct(oiU.change24hPct)})` : ''}, ETH ${fmtUsd(o.eth)}`);
  lines.push(`  Funding (last): BTC ${fmtPct(f.btc, 4)}, ETH ${fmtPct(f.eth, 4)}`);
  lines.push(`  Long/Short (BTC): retail accounts ${ls.ratio != null ? ls.ratio.toFixed(2) : 'n/a'} (longs ${ls.longs?.toFixed?.(1) ?? 'n/a'}%), TOP-TRADER positions ${tt.ratio != null ? tt.ratio.toFixed(2) : 'n/a'}${tt.longsPct != null ? ` (${tt.longsPct.toFixed(0)}% long)` : ''}`);
  lines.push(`  24h liquidations: total ${fmtUsd(l.total)}, longs ${fmtUsd(l.long)}, shorts ${fmtUsd(l.short)}, ${l.count ?? 0} events`);
  lines.push(`  Taker flow (24h net aggressive buys, BTC perps): ${snapshot.takerFlowUsd != null ? fmtUsd(snapshot.takerFlowUsd) : 'n/a'}`);
  lines.push('');
  lines.push(`Fear & Greed: ${fg.value != null ? fg.value : 'n/a'} (${fg.classification || 'n/a'})${fg.yesterday != null ? `, yesterday ${fg.yesterday}` : ''}${fg.weekAgo != null ? `, a week ago ${fg.weekAgo}` : ''}`);
  lines.push('');
  const cal = Array.isArray(snapshot.calendar) ? snapshot.calendar : [];
  lines.push('ECONOMIC CALENDAR (upcoming/fresh prints — name the relevant ones with their day in POSITIONING):');
  if (cal.length) {
    for (const e of cal) {
      const when = e.dateTime ? new Date(e.dateTime).toUTCString().slice(0, 22) + ' UTC' : 'n/a';
      const nums = [e.forecast ? `forecast ${e.forecast}` : null, e.previous ? `prev ${e.previous}` : null].filter(Boolean).join(', ');
      lines.push(`  - ${when}: ${e.currency} ${e.name} [${e.impact}]${nums ? ` (${nums})` : ''}${e.isFedEvent ? ' [FED]' : ''}`);
    }
  } else {
    lines.push('  (none available)');
  }
  lines.push('');

  // ── CROSS-ASSET: the equity tape ──
  const eq = snapshot.equities;
  if (eq) {
    lines.push('CROSS-ASSET (equities, latest session — use to frame risk-on/off, not as crypto price data):');
    lines.push(`  S&P 500: ${eq.sp500 ? fmtPct(eq.sp500.change) : 'n/a'}, Nasdaq: ${eq.nasdaq ? fmtPct(eq.nasdaq.change) : 'n/a'}, VIX: ${eq.vix ? `${eq.vix.price} (${fmtPct(eq.vix.change)})` : 'n/a'}`);
    lines.push('');
  }

  // ── CATALYSTS: today's headlines (the WHY) ──
  const heads = snapshot.headlines || [];
  lines.push('TODAY\'S HEADLINES (your catalyst source — sentence 1 must lead with the WHY from these or the cross-asset risk regime; if none explain the move, say so, do not invent one):');
  if (heads.length) for (const h of heads) lines.push(`  - ${h.title}${h.source ? ` (${h.source})` : ''}`);
  else lines.push('  (none available - say there is no single obvious catalyst and read the tape + cross-asset regime)');
  lines.push('');

  lines.push('ETF/ETP flows: n/a');
  lines.push('Stablecoin 24h mint/burn: n/a');
  lines.push('');

  // ── INTERPRETIVE PRIMERS ──
  // The model is good at synthesis when it has analytical scaffolding to work
  // from. Pre-compute regime cues and positioning reads so the writer can
  // weave them into prose rather than producing a dashboard summary.
  const btcChange = p.btc?.change24h;
  const inferredBias = btcChange == null ? null : btcChange < -0.5 ? 'down' : btcChange > 0.5 ? 'up' : 'flat';
  const ch7 = p.btc?.change7d; const ch30 = p.btc?.change30d;
  let trendCue = '';
  if (btcChange != null && ch7 != null && ch30 != null) {
    if (btcChange > 0 && ch7 < 0 && ch30 < 0) trendCue = 'a green day inside a red week and red month: a bounce inside a downtrend until the week flips';
    else if (btcChange > 0 && ch7 > 0 && ch30 < 0) trendCue = 'week has flipped green inside a red month: early trend-repair';
    else if (btcChange > 0 && ch7 > 0 && ch30 > 0) trendCue = 'up across all windows: established uptrend';
    else if (btcChange < 0 && ch7 < 0 && ch30 < 0) trendCue = 'down across all windows: established downtrend';
  }
  let rangePos = null;
  if (p.btc?.price != null && p.btc?.low != null && p.btc?.high != null && Number(p.btc.high) > Number(p.btc.low)) {
    rangePos = Math.round(((Number(p.btc.price) - Number(p.btc.low)) / (Number(p.btc.high) - Number(p.btc.low))) * 100);
  }
  const lsImbalance = ls.ratio == null ? null : ls.ratio > 1.3 ? 'longs-heavy' : ls.ratio < 0.77 ? 'shorts-heavy' : 'balanced';
  const fundingBias = (f.btc || 0) > 0.0001 ? 'positive' : (f.btc || 0) < -0.0001 ? 'negative' : 'flat';
  const fgVal = fg.value;
  const fgRegime = fgVal == null ? null
    : fgVal <= 24 ? 'extreme fear'
    : fgVal <= 44 ? 'fear'
    : fgVal <= 55 ? 'neutral'
    : fgVal <= 74 ? 'greed' : 'extreme greed';
  const fgRef = fg.weekAgo ?? fg.yesterday;
  const fgDir = fgVal != null && fgRef != null ? (fgVal > fgRef + 2 ? 'rising' : fgVal < fgRef - 2 ? 'falling' : 'flat') : null;
  const liqSkew = (l.long || 0) > (l.short || 0) * 1.5 ? 'longs flushed'
    : (l.short || 0) > (l.long || 0) * 1.5 ? 'shorts flushed' : 'balanced flush';

  lines.push('REGIME CUES (use these as analytical scaffolding, weave into prose, do not list them):');
  if (inferredBias) lines.push(`  - Tape bias: ${inferredBias}${trendCue ? ` (${trendCue})` : ''}`);
  if (rangePos != null) lines.push(`  - BTC sits at ${rangePos}% of its 24h range (0% = at the low, 100% = at the high)`);
  if (lsImbalance) lines.push(`  - Retail L/S imbalance: ${lsImbalance}`);
  if (tt.ratio != null && ls.ratio != null) {
    const posRead = ls.ratio > tt.ratio + 0.3
      ? 'retail crowded long vs cooler top-trader book: big players are NOT chasing - squeeze fuel sits on the retail side'
      : tt.ratio > ls.ratio + 0.3
        ? 'top traders longer than retail: smart money is bidding while the crowd hesitates'
        : 'retail and top traders aligned';
    lines.push(`  - Positioning read: ${posRead}`);
  }
  if (oiU.change24hPct != null && btcChange != null) {
    const oiRead = oiU.change24hPct > 0.5 && btcChange > 0 ? 'OI up with price up: new longs entering'
      : oiU.change24hPct < -0.5 && btcChange > 0 ? 'price up on falling OI: short covering, weaker fuel'
      : oiU.change24hPct > 0.5 && btcChange < 0 ? 'OI up with price down: shorts pressing'
      : oiU.change24hPct < -0.5 && btcChange < 0 ? 'OI down with price down: longs de-risking'
      : 'OI roughly flat: no aggressive re-positioning';
    lines.push(`  - OI read: ${oiRead}`);
  }
  if (snapshot.takerFlowUsd != null) lines.push(`  - Taker flow: ${snapshot.takerFlowUsd > 0 ? 'net aggressive BUYING' : 'net aggressive SELLING'} over 24h`);
  if (fundingBias !== 'flat') lines.push(`  - Funding bias: ${fundingBias}`);
  if (fgRegime) lines.push(`  - Sentiment regime: ${fgRegime}${fgDir ? `, ${fgDir} vs the week` : ''}`);
  if (l.total != null && l.total > 0) lines.push(`  - 24h liq skew: ${liqSkew}`);
  lines.push('');
  lines.push('ANALYTICAL FRAMES YOU MAY USE:');
  lines.push('  - "Extreme fear lifting off its low + shorts flushed + taker buying" -> capitulation reversal, dips are being bought.');
  lines.push('  - "Retail crowded long into a bounce while top traders stay flat" -> rally built on weak hands, fade the extension.');
  lines.push('  - "Top traders net long + OI rebuilding + funding still modest" -> smart money accumulating, front-run the crowd.');
  lines.push('  - "Price up on falling OI" -> short covering, needs fresh longs above the 24h high to trend.');
  lines.push('  - "Longs crowded into a falling tape, funding still positive" -> long squeeze setup if support cracks.');
  lines.push('  - "Shorts crowded with fear at extreme low" -> contrarian-bullish, watch for short squeeze.');
  lines.push('  - "L/S balanced + low liq volume" -> grinding consolidation, range trade.');
  lines.push('  - "BTC dominance rising into a sell-off" -> alts under-performing, risk-off rotation.');
  lines.push('  - "BTC dominance falling into a rally" -> alt season ignition.');
  lines.push('  - "F&G at extreme fear + dominance high" -> classic accumulation regime if structure holds.');
  lines.push('  - "Funding flips negative with longs flushed" -> capitulation lows often print here.');
  lines.push('  - "Price grinding lower with no liquidations" -> distribution by patient sellers, more painful than a flush.');
  lines.push('');
  lines.push('Pick the frame that matches the live cues above. Apply it. Name the setup. Then give the trigger that confirms or invalidates it.');
  lines.push('');
  lines.push(`Remember: timeframe window is "${meta.window}". Do not describe price action as green when the ${meta.biasField} numbers above are negative, and vice versa.`);

  return lines.join('\n');
}

// ── RESPONSE PARSER ─────────────────────────────────────────────────────────

function parseSections(content) {
  if (!content) return { analysis: '', macroConditions: '', positioning: '' };
  const text = String(content).trim();

  // Split on the three literal headers. Accept "ANALYSIS", "**ANALYSIS**",
  // "## MACRO CONDITIONS" etc — models emit markdown decorations despite the
  // prose-only instruction, and a missed split dumps everything into analysis.
  const parts = text.split(/\n\s*(?=(?:#{1,4}\s*|\*{1,3}\s*)?(?:ANALYSIS|MACRO CONDITIONS|POSITIONING)\b)/i);

  const out = { analysis: '', macroConditions: '', positioning: '' };
  for (const chunk of parts) {
    const clean = chunk.replace(/^[#*\s]+/, '').trim();
    if (/^ANALYSIS\b/i.test(clean)) {
      out.analysis = clean.replace(/^ANALYSIS\b\s*\**\s*[:\-]?\s*/i, '').trim();
    } else if (/^MACRO CONDITIONS\b/i.test(clean)) {
      out.macroConditions = clean.replace(/^MACRO CONDITIONS\b\s*\**\s*[:\-]?\s*/i, '').trim();
    } else if (/^POSITIONING\b/i.test(clean)) {
      out.positioning = clean.replace(/^POSITIONING\b\s*\**\s*[:\-]?\s*/i, '').trim();
    } else if (!out.analysis) {
      // Fallback: first unlabeled chunk becomes analysis.
      out.analysis = clean;
    }
  }
  return out;
}

// ── MAIN ENTRY ──────────────────────────────────────────────────────────────

/**
 * Generate market analysis for a timeframe.
 * @param {object} opts
 * @param {'1h'|'24h'|'7d'} [opts.timeframe]
 * @param {boolean} [opts.force] - bypass cache
 * @returns {Promise<{analysis, macroConditions, positioning, sources, timeframe, lastUpdated} | null>}
 */
async function generateMarketAnalysis({ timeframe = '24h', force = false } = {}) {
  if (!VALID_TIMEFRAMES.includes(timeframe)) timeframe = '24h';

  if (!HAS_LLM_KEY) {
    console.warn('[MarketAnalysis] No PERPLEXITY_API_KEY / GROQ_API_KEY — skipping generation (no-op)');
    return null;
  }

  // Freshness guard
  if (!force) {
    const cached = loadCache(timeframe);
    if (cached && cached.generatedAt) {
      const ageMs = Date.now() - new Date(cached.generatedAt).getTime();
      if (ageMs < STALE_MS && cached.data) {
        return cached.data;
      }
    }
  }

  const startTime = Date.now();

  try {
    const snapshot = await gatherLiveSnapshot();
    const userPrompt = buildUserPrompt(timeframe, snapshot);

    // 280-450 word target = ~750 tokens of prose. Bump max + warm temperature
    // slightly so the strategist voice can actually breathe instead of being
    // clipped into a 3-sentence stub.
    const gateResult = await callGroq(SYSTEM_PROMPT, userPrompt, { maxTokens: 1600, temperature: 0.35 });

    if (!gateResult.ok || !gateResult.content) {
      throw new Error(gateResult.error || 'Groq returned no content');
    }

    const sections = parseSections(gateResult.content);
    if (!sections.analysis && !sections.macroConditions && !sections.positioning) {
      throw new Error('Parser returned no sections');
    }

    const data = {
      analysis: sections.analysis,
      macroConditions: sections.macroConditions,
      positioning: sections.positioning,
      sources: [],
      timeframe,
      lastUpdated: new Date().toISOString(),
    };

    saveCache(timeframe, { data, generatedAt: data.lastUpdated });

    const btcCh = snapshot?.prices?.btc?.change24h;
    const fgVal = snapshot?.fearGreed?.value;
    const elapsedS = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[MarketAnalysis] ${timeframe} regenerated (${elapsedS}s) — BTC ${fmtPct(btcCh)}, F&G ${fgVal ?? 'n/a'}`);

    try {
      logAgentActivity({
        agent: 'market-analysis',
        action: 'completed',
        target: timeframe,
        targetType: 'market-analysis',
        title: `Market analysis ${timeframe} regenerated`,
        generationTimeMs: Date.now() - startTime,
        sourceCount: data.sources.length,
      });
    } catch (_) { /* non-fatal */ }

    return data;
  } catch (err) {
    console.error(`[MarketAnalysis] ${timeframe} generation failed:`, err.message);
    // On error, return previous cached value (even if stale) so the UI never goes blank.
    const cached = loadCache(timeframe);
    if (cached?.data) return cached.data;
    return null;
  }
}

/**
 * Scheduler entry — regenerates all three timeframes back-to-back.
 */
async function runMarketAnalysisCycle() {
  if (!HAS_LLM_KEY) {
    console.log('[MarketAnalysis] Skipping cycle — no LLM API key configured');
    return null;
  }
  const results = {};
  for (const tf of VALID_TIMEFRAMES) {
    try {
      results[tf] = await generateMarketAnalysis({ timeframe: tf, force: true });
    } catch (e) {
      console.error(`[MarketAnalysis] cycle error for ${tf}:`, e.message);
      results[tf] = null;
    }
  }
  return results;
}

module.exports = {
  generateMarketAnalysis,
  runMarketAnalysisCycle,
  VALID_TIMEFRAMES,
};
