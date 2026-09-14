/**
 * Shared market-brief generator (prod / serverless).
 *
 * Produces the 3-part equities brief (analysis / macroConditions / positioning)
 * for the Stocks "AI Market" panel. Used in two places:
 *   - cron/warm-showcase.js  -> warms KV every 30 min (background freshness)
 *   - handlers/market-intel.js -> generates ON-DEMAND on a KV miss so the panel
 *     shows a real brief on first load instead of waiting for the cron.
 *
 * The whole point of this surface: the panel must tell the user WHY the market
 * moved. So the catalyst input is the SAME Spectre breaking-news feed that powers
 * the panel's CONTEXT bullets (/api/intelligence/breaking) — not the generic
 * Finnhub mock feed. The model is told to lead sentence 1 with the cause in plain
 * language, and the causality discipline (no fabricated cause / magnitude /
 * citation; giga private co's only via a real named channel) is kept in sync with
 * the dev agent (packages/server/agents/stockMarketAnalysisAgent.js).
 */

const STOCK_MEGACAPS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'];
// Resilient multi-provider LLM gateway (Groq → Cerebras/Gemini free → OpenRouter
// → OpenAI/Anthropic → Ollama) with circuit breaker. Prod parity with the dev
// agents — briefs survive the Groq billing outage by failing over to a free tier.
import { chat as gatewayChat } from './llm-gateway.js';
// In-process market data (2026-07-02): direct upstreams instead of HTTP
// self-fetches, which die on deployment protection (302) + the tier gate (401).
import {
  gatherCryptoSnapshot,
  fetchHeadlines as fetchLiveHeadlines,
  fetchFearGreed as fetchFearGreedTrend,
  binanceFetch,
  STABLE_BASE_URL,
} from './market-snapshot.js';

const STOCK_TIMEFRAMES = ['24h', '1h', '7d']; // 24h first - it is the default panel view

const STOCK_BRIEF_SYSTEM_PROMPT = `You are Spectre AI's lead equities strategist briefing a peer at a multi-strategy fund. Sharp, opinionated, data-first. Write as "we" (Spectre AI). You will be given LIVE index levels, the VIX, mega-cap moves, the crypto tape, and the day's REAL market headlines. Anchor every claim to a number or a headline actually in the data. Never fabricate.

LEAD WITH THE WHY. Sentence 1 of ANALYSIS must answer, in plain language a non-expert understands, WHAT moved and WHY — naming the driver from the headlines. Example: "Stocks are down because a chip-sector rout, Micron-led, is dragging the whole tech complex." NOT "the market is exhibiting a neutral bias." A reader should know the cause from the first line.

CAUSALITY DISCIPLINE (most important):
- Explain the move with a catalyst actually in the HEADLINES, or with the index/VIX/mega-cap numbers. If the headlines do not explain the tape, say plainly that there is no single obvious catalyst and the move looks like positioning or rotation, then read the price action. NEVER invent a reason.
- Match the magnitude: a 0.3% index move is normal session noise, not a crash or a plunge.
- A giant private company (SpaceX, OpenAI, Stripe) CAN move the tape, but only through a REAL, NAMED channel: a public proxy (Tesla for Musk/SpaceX, a Starlink IPO, SpaceX-exposed funds like Destiny Tech100/DXYZ or ARK), the relevant sector (space, defense, semis), or named suppliers. Connect it through that channel if a headline names it. Do NOT claim it moved an index directly (it is not an index member) and do NOT invent the size of the effect.
- NEVER say an event "erased"/"wiped"/"added" a share or dollar amount of any market cap unless that figure is in the data. NEVER attribute a claim to a named outlet unless it appears in the HEADLINES.

FORMAT: exactly three sections, literal headers, prose only (no bullets, no tables).

ANALYSIS
<3-4 sentences. Sentence 1 = the WHY (move + cause from the headlines). Then cite the S&P / Nasdaq / Dow percent moves and end with the regime read.>

MACRO CONDITIONS
<3-4 sentences. The drivers: which headlines matter (Fed, CPI/jobs, earnings, rates, a sector story), the VIX read (complacent <15, moderate 15-20, elevated 20-30, fear >30), and breadth (mega-cap-led vs broad). CROSS-ASSET: if the crypto line is present and crypto is moving the SAME way as equities, say so — one broad risk-on/off regime across the whole speculative complex; crypto is the highest-beta member so it moves more. If they decouple, call that out.>

POSITIONING
<3-4 sentences. What a disciplined trader does over the horizon. Specific index levels or triggers, the catalyst window, sector tilt, at least one "if X then Y".>

NON-NEGOTIABLES: never invent numbers/catalysts/sources; no em-dashes; no [1][2] markers; 240-420 words total.`;

function fmtStockPct(n) {
  if (n == null || !isFinite(n)) return 'n/a';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

async function safeJson(url, timeoutMs = 8000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

// Briefs run on Groq (llama-3.3-70b-versatile) — fast and near-free, the same
// provider the dev agents + Monarch already use. Anthropic was too expensive
// for this volume (cron + on-demand). No key / failure -> null -> the panel
// falls back to its live-data template, so there is zero spend on the failure
// path. Override the model via MARKET_BRIEF_MODEL.
const BRIEF_MODEL = process.env.MARKET_BRIEF_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function callLLM(systemPrompt, userContent, maxTokens = 1024) {
  try {
    const r = await gatewayChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      tier: 'smart',
      maxTokens,
      temperature: 0.4,
      timeoutMs: 20000,
    });
    if (!r.ok) {
      console.warn(`[marketBrief] all LLM providers failed (${(r.tried || []).join(', ')})`);
      return null;
    }
    const text = r.text;
    // Same contract as before: null on empty/too-short -> panel keeps its
    // deterministic live-data template (zero-spend failure path).
    if (!text || text.length < 40) return null;
    return text;
  } catch (err) {
    console.warn('[marketBrief] gateway call failed:', err.message);
    return null;
  }
}

async function fetchStockSnapshot(baseUrl) {
  const base = baseUrl || STABLE_BASE_URL;
  const [indicesRaw, quotesRaw, headlines, btcTicker, ethTicker, fgRaw] = await Promise.all([
    safeJson(`${base}/api/stocks/indices`),
    safeJson(`${base}/api/stocks/quotes?symbols=${STOCK_MEGACAPS.join(',')}`),
    // In-process live headlines (data-api breaking + news + Finnhub macro) —
    // the old /api/intelligence/breaking self-fetch 401s behind the tier gate.
    fetchLiveHeadlines(),
    // Crypto cross-asset straight from Binance spot (the old /api/market/tickers
    // self-fetch is tier-gated too).
    binanceFetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
    binanceFetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT'),
    fetchFearGreedTrend(),
  ]);

  // /api/stocks/indices returns an OBJECT keyed by symbol, not an array.
  const idxRows = Array.isArray(indicesRaw)
    ? indicesRaw
    : (indicesRaw && typeof indicesRaw === 'object' ? Object.values(indicesRaw) : []);
  const idxByName = {};
  for (const row of idxRows) {
    if (!row || typeof row !== 'object') continue;
    if (row.name) idxByName[String(row.name).trim().toLowerCase()] = row;
    if (row.symbol) idxByName[String(row.symbol).trim().toLowerCase()] = row;
  }
  const pick = (...names) => { for (const n of names) { const h = idxByName[n.toLowerCase()]; if (h) return h; } return null; };
  const megacaps = {};
  if (quotesRaw && typeof quotesRaw === 'object') {
    for (const s of STOCK_MEGACAPS) { const q = quotesRaw[s]; if (q && q.price != null) megacaps[s] = { price: q.price, change: q.change }; }
  }

  const btcChange = btcTicker?.priceChangePercent != null ? Number(btcTicker.priceChangePercent) : null;
  const ethChange = ethTicker?.priceChangePercent != null ? Number(ethTicker.priceChangePercent) : null;
  const crypto = (btcChange != null || ethChange != null || fgRaw?.value != null) ? {
    btc: btcChange != null ? { change: btcChange } : null,
    eth: ethChange != null ? { change: ethChange } : null,
    fearGreed: fgRaw?.value != null ? { value: fgRaw.value, classification: fgRaw.classification } : null,
  } : null;

  return {
    sp500: pick('s&p 500', '^gspc'),
    nasdaq: pick('nasdaq composite', 'nasdaq', '^ixic'),
    dow: pick('dow jones industrial average', 'dow jones', '^dji'),
    russell: pick('russell 2000 index', 'russell 2000', '^rut'),
    vix: pick('cboe volatility index', 'vix', '^vix'),
    megacaps,
    headlines: headlines || [],
    crypto,
  };
}

function buildStockUserContent(timeframe, snap) {
  const windowLabel = timeframe === '1h' ? 'intraday (last hour)' : timeframe === '7d' ? 'the last week' : 'the latest session';
  const lines = [];
  lines.push(`Write a 3-part Spectre AI equities brief targeting ${windowLabel}. Lead with WHY the market moved.`);
  lines.push('');
  lines.push('LIVE DATA (the ONLY numbers you may cite):');
  lines.push(`  S&P 500: ${snap.sp500 ? `${snap.sp500.price}, ${fmtStockPct(snap.sp500.change)}` : 'n/a'}`);
  lines.push(`  Nasdaq: ${snap.nasdaq ? `${snap.nasdaq.price}, ${fmtStockPct(snap.nasdaq.change)}` : 'n/a'}`);
  lines.push(`  Dow: ${snap.dow ? `${snap.dow.price}, ${fmtStockPct(snap.dow.change)}` : 'n/a'}`);
  lines.push(`  Russell 2000: ${snap.russell ? `${snap.russell.price}, ${fmtStockPct(snap.russell.change)}` : 'n/a'}`);
  lines.push(`  VIX: ${snap.vix ? `${snap.vix.price} (${fmtStockPct(snap.vix.change)})` : 'n/a'}`);
  const mc = Object.entries(snap.megacaps || {}).map(([s, q]) => `${s} ${fmtStockPct(q.change)}`).join(', ');
  lines.push(`  Mega-caps: ${mc || 'n/a'}`);
  const cr = snap.crypto;
  if (cr) {
    lines.push(`  CROSS-ASSET (crypto, frame the risk regime): BTC ${cr.btc ? fmtStockPct(cr.btc.change) : 'n/a'}, ETH ${cr.eth ? fmtStockPct(cr.eth.change) : 'n/a'}, Crypto Fear & Greed ${cr.fearGreed ? `${cr.fearGreed.value} (${cr.fearGreed.classification || 'n/a'})` : 'n/a'}`);
  }
  lines.push('');
  lines.push('TODAY\'S MARKET HEADLINES (your catalyst source — sentence 1 must lead with the WHY from these; if none explain the move, say so, do not invent one):');
  if (snap.headlines.length) for (const h of snap.headlines) lines.push(`  - ${h.title}${h.source ? ` (${h.source})` : ''}`);
  else lines.push('  (none available - say there is no single obvious catalyst and read the tape from the index/VIX/breadth numbers, do not fabricate one)');
  return lines.join('\n');
}

function parseStockSections(content) {
  const text = String(content || '').trim();
  // Split tolerates markdown-decorated headers ("## MACRO CONDITIONS",
  // "**POSITIONING**") — models emit them despite the prose-only instruction,
  // and a missed split used to dump all three sections into `analysis`.
  const parts = text.split(/\n\s*(?=(?:#{1,4}\s*|\*{1,3}\s*)?(?:ANALYSIS|MACRO CONDITIONS|POSITIONING)\b)/i);
  const out = { analysis: '', macroConditions: '', positioning: '' };
  for (const chunk of parts) {
    const clean = chunk.replace(/^[#*\s]+/, '').trim();
    if (/^ANALYSIS\b/i.test(clean)) out.analysis = clean.replace(/^ANALYSIS\b\s*\**\s*[:\-]?\s*/i, '').trim();
    else if (/^MACRO CONDITIONS\b/i.test(clean)) out.macroConditions = clean.replace(/^MACRO CONDITIONS\b\s*\**\s*[:\-]?\s*/i, '').trim();
    else if (/^POSITIONING\b/i.test(clean)) out.positioning = clean.replace(/^POSITIONING\b\s*\**\s*[:\-]?\s*/i, '').trim();
    else if (!out.analysis) out.analysis = clean;
  }
  return out;
}

/**
 * Generate a stock 3-part brief for a timeframe.
 * @returns {Promise<{analysis,macroConditions,positioning,sources}|null>}
 */
async function generateStockBrief({ timeframe = '24h', baseUrl } = {}) {
  const tf = STOCK_TIMEFRAMES.includes(timeframe) ? timeframe : '24h';
  // NEVER default to VERCEL_URL: the deployment URL is protection-gated (302)
  // and app.spectreai.io is CF-bot-blocked for server-to-server traffic. The
  // stable project alias serves the two OPEN stocks routes this still needs.
  const snap = await fetchStockSnapshot(baseUrl || STABLE_BASE_URL);
  const raw = await callLLM(STOCK_BRIEF_SYSTEM_PROMPT, buildStockUserContent(tf, snap), 1024);
  if (!raw) return null;
  const sections = parseStockSections(raw);
  if (!sections.analysis && !sections.macroConditions && !sections.positioning) return null;
  return {
    analysis: sections.analysis,
    macroConditions: sections.macroConditions,
    positioning: sections.positioning,
    sources: (snap.headlines || []).slice(0, 6).map((h) => ({ title: h.title, source: h.source })),
  };
}

// ── CRYPTO BRIEF ─────────────────────────────────────────────────────────────
// The Command Center "AI Market" read. Data comes from gatherCryptoSnapshot()
// IN-PROCESS (2026-07-02 fix: the old HTTP self-fetch died on the deployment-
// protection 302 + the market-api tier gate 401, so the LLM was fed a sheet of
// "n/a" and wrote "Fear & Greed not available" slop). The prompt is thesis-
// first: sentence 1 is extracted by the panel as the standalone THESIS pill.

const CRYPTO_BRIEF_SYSTEM_PROMPT = `You are Spectre AI's lead crypto strategist writing the Command Center market read. Voice: a senior macro/crypto PM briefing a peer at a multi-strategy fund. Sharp, opinionated, data-first. Write as "we" (Spectre AI). You will be given LIVE prices with multi-window context, derivatives positioning (funding, open interest and its 24h change, retail vs top-trader long/short, liquidations, taker flow), sentiment (Fear & Greed with trend), the equity tape, the economic calendar, and the day's real headlines. Anchor every claim to a number or headline actually in the data. Never fabricate.

SENTENCE 1 OF ANALYSIS IS THE THESIS. The UI extracts it as a standalone pill, so keep it under 220 characters and make it a POSITION a trader can act on: is this a dip being bought inside a larger downtrend, the start of a real rally, distribution to sell into, or chop to sit out - and the strongest piece of evidence, in the same sentence. Example: "BTC's +2.6% bounce off $58.3K reads as a real dip-buy, not a dead-cat: extreme fear is lifting off its lows, open interest is rebuilding and takers are net buyers." NOT "the market is exhibiting mixed signals."

ANSWER WHAT A TRADER ACTUALLY ASKS:
- Is BTC in a dip and looking to rally, or is the trend still down? Read the multi-window tape (1h/24h/7d/30d), where price sits inside its 24h range, and the distance from ATH. A green day inside a red week inside a red month is a bounce until the week flips - say which it is.
- Are big players bidding? Derive it from the data: open interest CHANGE with price direction (OI up + price up = new longs; price up + OI down = short covering), top-trader long/short vs retail (top traders net long while retail is crowded = smart money bidding; the reverse = distribution into retail), the taker-flow sign, the liquidation skew, and any accumulation or treasury-buy headlines.
- What is sentiment doing? Fear & Greed LEVEL plus TREND: 19 rising off an 11 low is capitulation lifting (contrarian-bullish if structure holds); 19 falling from 40 is fear still building. Never quote the level without the direction.
- What macro or geopolitical tape matters? Use the MACRO headlines (Fed, prints, politics, conflicts) and the calendar entries you are given. If a war headline or a rate print is in the data, weigh it through the risk-regime channel. If it is not in the data, do not invent it.

CAUSALITY DISCIPLINE:
- Explain moves with catalysts actually in the HEADLINES, the derivatives/sentiment numbers, or the cross-asset regime. If nothing explains the move, say so plainly and read the tape.
- Match the magnitude: a 1-2% move is normal volatility, not a crash, and a daily % change is not a market-cap erasure.
- A non-crypto event matters only through a real, named channel (broad risk-on/off, a crypto-holding company, a macro print). Never claim mechanical causation or invent the size of an effect.
- NEVER attribute a claim to a named outlet unless it appears in the HEADLINES. A value marked n/a is unavailable: say so or skip it, never guess it.

FORMAT: exactly three sections, literal headers, prose only (no bullets, no tables).

ANALYSIS
<3-5 sentences. Sentence 1 = THE THESIS. Then the tape: BTC/ETH/SOL moves across the windows, where BTC sits in its 24h range, total market cap direction, and end with the regime read (accumulation bounce, digestion, distribution, risk-off rotation, reflexive squeeze).>

MACRO CONDITIONS
<3-5 sentences. The conditions read: Fear & Greed level AND trend, funding, open interest and its 24h change, retail vs top-trader positioning stated with the numbers, liquidation skew when available, BTC dominance. Then cross-asset: the equity tape and VIX - same direction as crypto means one risk regime and crypto is the highest-beta member; a decoupling is itself the signal. Then the macro layer: name the relevant MACRO headlines and calendar prints, with actual vs forecast when given.>

POSITIONING
<3-5 sentences. What a disciplined trader does over the stated horizon. Use REAL levels from the data (the 24h low as support, the 24h high as the breakout trigger, the week's direction as the trend filter). Name the catalyst window from the CALENDAR (event and day). At least one concrete "if X then Y" with a level. State the big-player read in one clause: bidding, distributing, or absent. No hedging into uselessness, no "not financial advice" cope.>

NON-NEGOTIABLES: never invent numbers/catalysts/sources; no em-dashes; no [1][2] markers; banned phrases: "delve", "landscape", "robust", "navigate", "remains to be seen", "the crypto space", "only time will tell", "cautiously optimistic", "it is worth noting"; 280-450 words total.`;

function fmtUsdBig(n) {
  if (n == null || !isFinite(n)) return 'n/a';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  return `$${abs.toFixed(0)}`;
}

const fmtMaybePct = fmtStockPct; // fmtStockPct already renders null as 'n/a'

function coinLine(label, c) {
  if (!c || c.price == null) return `  ${label}: n/a`;
  const p = c.price >= 1000 ? c.price.toLocaleString('en-US', { maximumFractionDigits: 0 }) : c.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const parts = [`$${p}`];
  parts.push(`1h ${fmtMaybePct(c.change1h)}`);
  parts.push(`24h ${fmtMaybePct(c.change24h)}`);
  parts.push(`7d ${fmtMaybePct(c.change7d)}`);
  parts.push(`30d ${fmtMaybePct(c.change30d)}`);
  if (c.low24h != null && c.high24h != null) parts.push(`24h range $${Math.round(c.low24h).toLocaleString()}-$${Math.round(c.high24h).toLocaleString()}`);
  if (c.athChangePct != null) parts.push(`${c.athChangePct.toFixed(0)}% from ATH`);
  return `  ${label}: ${parts.join(', ')}`;
}

function buildCryptoUserContent(timeframe, snap) {
  const windowLabel = timeframe === '1h' ? 'intraday (last hour)' : timeframe === '7d' ? 'the last week' : 'the latest session';
  const horizon = timeframe === '1h' ? 'the next few hours' : timeframe === '7d' ? 'the coming week' : 'the next trading session';
  const d = snap.derivs || {};
  const ol = snap.oiLiq || {};
  const fg = snap.fearGreed;
  const g = snap.global || {};
  const btc = snap.btc;

  const lines = [];
  lines.push(`Write the 3-part Spectre AI crypto market read targeting ${windowLabel}. Positioning horizon: ${horizon}. Sentence 1 = the thesis.`);
  lines.push('');
  lines.push('LIVE DATA (the ONLY numbers you may cite - a value of n/a is unavailable, never guess it):');
  lines.push('');
  lines.push('Tape:');
  lines.push(coinLine('BTC', snap.btc));
  lines.push(coinLine('ETH', snap.eth));
  lines.push(coinLine('SOL', snap.sol));
  lines.push(`  Total market cap: ${fmtUsdBig(g.totalMcap)} (24h ${fmtMaybePct(g.mcapChange24h)}), BTC dominance ${g.btcDominance != null ? g.btcDominance.toFixed(1) + '%' : 'n/a'}`);
  lines.push('');
  lines.push('Sentiment:');
  lines.push(`  Fear & Greed: ${fg?.value != null ? `${fg.value} (${fg.classification || 'n/a'})` : 'n/a'}${fg?.yesterday != null ? `, yesterday ${fg.yesterday}` : ''}${fg?.weekAgo != null ? `, a week ago ${fg.weekAgo}` : ''}`);
  lines.push('');
  lines.push('Derivatives / positioning:');
  lines.push(`  Funding (last, BTC/ETH): ${d.fundingBtcPct != null ? fmtStockPct(d.fundingBtcPct) : 'n/a'} / ${d.fundingEthPct != null ? fmtStockPct(d.fundingEthPct) : 'n/a'}`);
  lines.push(`  Open interest: market-wide ${fmtUsdBig(ol.totalOiUsd)}, BTC (Binance) ${fmtUsdBig(d.btcOiUsd)}${d.oiChange24hPct != null ? `, BTC OI 24h change ${fmtStockPct(d.oiChange24hPct)}` : ''}`);
  lines.push(`  Long/Short (BTC): retail accounts ${d.retailLsRatio != null ? d.retailLsRatio.toFixed(2) : 'n/a'}${d.retailLongsPct != null ? ` (${d.retailLongsPct.toFixed(0)}% long)` : ''}, TOP-TRADER positions ${d.topTraderLsRatio != null ? d.topTraderLsRatio.toFixed(2) : 'n/a'}${d.topTraderLongsPct != null ? ` (${d.topTraderLongsPct.toFixed(0)}% long)` : ''}`);
  lines.push(`  24h liquidations: ${ol.liqTotalUsd != null ? `total ${fmtUsdBig(ol.liqTotalUsd)}, longs ${fmtUsdBig(ol.liqLongUsd)}, shorts ${fmtUsdBig(ol.liqShortUsd)}` : 'n/a'}`);
  lines.push(`  Taker flow (24h net aggressive buys, BTC+ETH+SOL perps): ${snap.takerFlowUsd != null ? `${snap.takerFlowUsd >= 0 ? '+' : '-'}${fmtUsdBig(Math.abs(snap.takerFlowUsd)).replace('$', '$')}` : 'n/a'}`);
  lines.push('');
  const eq = snap.equities;
  lines.push('CROSS-ASSET (equities, latest session - frame the risk regime, not crypto price data):');
  lines.push(`  S&P 500: ${eq?.sp500 ? fmtMaybePct(eq.sp500.change) : 'n/a'}, Nasdaq: ${eq?.nasdaq ? fmtMaybePct(eq.nasdaq.change) : 'n/a'}, VIX: ${eq?.vix?.price != null ? eq.vix.price : 'n/a'}`);
  lines.push('');

  // ── Economic calendar: the catalyst window ──
  lines.push('ECONOMIC CALENDAR (upcoming/fresh prints - name the relevant ones with their day in POSITIONING):');
  if (Array.isArray(snap.calendar) && snap.calendar.length) {
    for (const e of snap.calendar) {
      const when = e.dateTime ? new Date(e.dateTime).toUTCString().slice(0, 22) + ' UTC' : 'n/a';
      const nums = [
        e.actual != null ? `actual ${e.actual}` : null,
        e.forecast != null ? `forecast ${e.forecast}` : null,
        e.previous != null ? `prev ${e.previous}` : null,
      ].filter(Boolean).join(', ');
      lines.push(`  - ${when}: ${e.currency} ${e.name} [${e.impact}]${nums ? ` (${nums})` : ''}${e.isFedEvent ? ' [FED]' : ''}`);
    }
  } else {
    lines.push('  (none available)');
  }
  lines.push('');

  // ── Headlines, macro/politics vs crypto ──
  const macroHeads = (snap.headlines || []).filter((h) => h.kind === 'macro');
  const cryptoHeads = (snap.headlines || []).filter((h) => h.kind !== 'macro');
  lines.push('MACRO / GEOPOLITICS HEADLINES (Fed, prints, politics, conflicts - weigh through the risk-regime channel):');
  if (macroHeads.length) for (const h of macroHeads) lines.push(`  - ${h.title}${h.source ? ` (${h.source})` : ''}`);
  else lines.push('  (none available - do not invent geopolitical catalysts)');
  lines.push('');
  lines.push('CRYPTO HEADLINES (your catalyst source):');
  if (cryptoHeads.length) for (const h of cryptoHeads) lines.push(`  - ${h.title}${h.source ? ` (${h.source})` : ''}`);
  else lines.push('  (none available - say there is no single obvious catalyst and read the tape + cross-asset regime)');
  lines.push('');

  // ── Regime cues: pre-computed scaffolding so the writer synthesizes ──
  const cues = [];
  const ch24 = btc?.change24h; const ch7 = btc?.change7d; const ch30 = btc?.change30d;
  if (ch24 != null) {
    const day = ch24 > 0.5 ? 'up' : ch24 < -0.5 ? 'down' : 'flat';
    let trend = '';
    if (ch7 != null && ch30 != null) {
      if (ch24 > 0 && ch7 < 0 && ch30 < 0) trend = ' (a green day inside a red week and red month: a bounce inside a downtrend until the week flips)';
      else if (ch24 > 0 && ch7 > 0 && ch30 < 0) trend = ' (week has flipped green inside a red month: early trend-repair)';
      else if (ch24 > 0 && ch7 > 0 && ch30 > 0) trend = ' (up across all windows: established uptrend)';
      else if (ch24 < 0 && ch7 < 0 && ch30 < 0) trend = ' (down across all windows: established downtrend)';
    }
    cues.push(`Tape bias: ${day}${trend}`);
  }
  if (btc?.price != null && btc?.low24h != null && btc?.high24h != null && btc.high24h > btc.low24h) {
    const pos = Math.round(((btc.price - btc.low24h) / (btc.high24h - btc.low24h)) * 100);
    cues.push(`BTC sits at ${pos}% of its 24h range (0% = at the low, 100% = at the high)`);
  }
  if (fg?.value != null) {
    const lvl = fg.value <= 24 ? 'extreme fear' : fg.value <= 44 ? 'fear' : fg.value <= 55 ? 'neutral' : fg.value <= 74 ? 'greed' : 'extreme greed';
    const ref = fg.weekAgo ?? fg.yesterday;
    const dir = ref != null ? (fg.value > ref + 2 ? 'rising' : fg.value < ref - 2 ? 'falling' : 'flat') : '';
    cues.push(`Sentiment regime: ${lvl}${dir ? `, ${dir} vs the week` : ''}`);
  }
  if (d.fundingBtcPct != null) cues.push(`Funding bias: ${d.fundingBtcPct > 0.001 ? 'positive (longs pay)' : d.fundingBtcPct < -0.001 ? 'negative (shorts pay)' : 'flat'}`);
  if (d.oiChange24hPct != null && ch24 != null) {
    const read = d.oiChange24hPct > 0.5 && ch24 > 0 ? 'OI up with price up: new longs entering'
      : d.oiChange24hPct < -0.5 && ch24 > 0 ? 'price up on falling OI: short covering, weaker fuel'
      : d.oiChange24hPct > 0.5 && ch24 < 0 ? 'OI up with price down: shorts pressing'
      : d.oiChange24hPct < -0.5 && ch24 < 0 ? 'OI down with price down: longs de-risking, less forced-selling risk'
      : 'OI roughly flat: no aggressive re-positioning';
    cues.push(`OI read: ${read}`);
  }
  if (d.retailLsRatio != null && d.topTraderLsRatio != null) {
    const read = d.retailLsRatio > d.topTraderLsRatio + 0.3
      ? 'retail crowded long vs cooler top-trader book: big players are NOT chasing this - squeeze fuel sits on the retail side'
      : d.topTraderLsRatio > d.retailLsRatio + 0.3
        ? 'top traders longer than retail: smart money is bidding while the crowd hesitates'
        : 'retail and top traders aligned';
    cues.push(`Positioning read: ${read}`);
  }
  if (snap.takerFlowUsd != null) cues.push(`Taker flow: ${snap.takerFlowUsd > 0 ? 'net aggressive BUYING' : 'net aggressive SELLING'} over 24h`);
  if (ol.liqLongUsd != null && ol.liqShortUsd != null && (ol.liqLongUsd || ol.liqShortUsd)) {
    cues.push(`Liq skew: ${ol.liqShortUsd > ol.liqLongUsd * 1.5 ? 'shorts flushed' : ol.liqLongUsd > ol.liqShortUsd * 1.5 ? 'longs flushed' : 'balanced flush'}`);
  }
  lines.push('REGIME CUES (analytical scaffolding - weave into prose, do not list them):');
  for (const c of cues) lines.push(`  - ${c}`);
  lines.push('');
  lines.push('ANALYTICAL FRAMES YOU MAY USE (pick what the cues support, name the setup, give the trigger):');
  lines.push('  - "Extreme fear lifting off its low + shorts flushed + taker buying" -> capitulation reversal, dips are being bought.');
  lines.push('  - "Retail crowded long into a bounce while top traders stay flat" -> rally built on weak hands, fade the extension.');
  lines.push('  - "Top traders net long + OI rebuilding + funding still modest" -> smart money accumulating, front-run the crowd.');
  lines.push('  - "Price up on falling OI" -> short covering, needs fresh longs above the 24h high to trend.');
  lines.push('  - "Funding positive + longs crowded into a falling tape" -> long-squeeze setup if the 24h low cracks.');
  lines.push('  - "BTC dominance rising into a sell-off" -> risk-off rotation into BTC, alts bleed harder.');
  lines.push('  - "Equities green + VIX falling + crypto green" -> one broad risk-on wave, crypto is the high-beta member.');
  lines.push('  - "Crypto red while equities are green" -> crypto-specific problem, look at the crypto headlines for the cause.');
  lines.push('');
  lines.push(`Remember: the window is "${windowLabel}". Do not describe the tape as green when the ${timeframe === '7d' ? '7d' : timeframe === '1h' ? '1h' : '24h'} numbers above are negative, and vice versa.`);
  return lines.join('\n');
}

/**
 * Generate a crypto 3-part brief for a timeframe.
 * Data is gathered IN-PROCESS (gatherCryptoSnapshot) - no HTTP self-fetch, so
 * neither Vercel deployment protection nor the market-api tier gate can starve
 * it (the 2026-07-02 "Fear & Greed not available" slop bug).
 * @returns {Promise<{analysis,macroConditions,positioning,sources}|null>}
 */
async function generateCryptoBrief({ timeframe = '24h' } = {}) {
  const tf = STOCK_TIMEFRAMES.includes(timeframe) ? timeframe : '24h';
  const snap = await gatherCryptoSnapshot();
  const raw = await callLLM(CRYPTO_BRIEF_SYSTEM_PROMPT, buildCryptoUserContent(tf, snap), 1600);
  if (!raw) return null;
  const sections = parseStockSections(raw);
  if (!sections.analysis && !sections.macroConditions && !sections.positioning) return null;
  return {
    analysis: sections.analysis,
    macroConditions: sections.macroConditions,
    positioning: sections.positioning,
    sources: (snap.headlines || []).slice(0, 6).map((h) => ({ title: h.title, source: h.source })),
  };
}

export { generateStockBrief, generateCryptoBrief, callLLM, STOCK_TIMEFRAMES };
