/**
 * Vercel Serverless -- Brief generation routes.
 * Supports:
 *  - "voices"             → static voice config (no external deps)
 *  - "generate" (POST)    → calls Anthropic API if ANTHROPIC_API_KEY is set
 *  - "breaking-synthesis"  → returns empty (requires content store + RSS + LLM)
 *  - "audio" (POST)       → returns fallback (requires ElevenLabs streaming)
 *
 * Routing: vercel.json rewrites /api/brief/* to
 *   /api/brief-api?route=<sub-route>
 */

// ── Voice roster (mirrors packages/server/index.js ELEVENLABS_VOICES) ───────
const VOICES = [
  { key: 'sam',    name: 'Sam',    description: 'Deep, raspy American — raw & authentic', isDefault: true },
  { key: 'josh',   name: 'Josh',   description: 'Deep, smooth American — confident narrator', isDefault: false },
  { key: 'adam',   name: 'Adam',   description: 'Deep American — warm & authoritative', isDefault: false },
  { key: 'clyde',  name: 'Clyde',  description: 'Deep, gravelly American — rugged character', isDefault: false },
  { key: 'daniel', name: 'Daniel', description: 'Deep British — polished intelligence analyst', isDefault: false },
];
const DEFAULT_VOICE = 'sam';

// ── Brief generation system prompt ──────────────────────────────────────────
const BRIEF_SYSTEM_PROMPT = `You are Spectre AI, a concise yet authoritative market intelligence narrator.
Write a 60-80 word spoken narrative synthesizing the provided market conditions.

CRITICAL RULES:
- NEVER use ticker symbols. Use full names: Bitcoin (not BTC), Ethereum (not ETH), Solana (not SOL), Apple (not AAPL), the S and P 500 (not SPY), the Nasdaq 100 (not QQQ), Nvidia (not NVDA), Tesla (not TSLA), the VIX (not VIX).
- NEVER use bullet points, headers, markdown, or formatting.
- Be punchy and direct — a premium 15-second market flash, not a monologue.
- All numbers should sound natural when spoken aloud. Say "ninety-five thousand" not "$95,000".
- One key insight or actionable takeaway. No filler.
- End with a brief sign-off: "This is Spectre AI."
- The text will be read aloud by a TTS engine — write for the ear, not the eye.
- STRICT: Never exceed 80 words. Brevity is power.`;

const LANG_NAMES = {
  en: 'English', fr: 'French', es: 'Spanish', zh: 'Chinese (Simplified)',
  hi: 'Hindi', ar: 'Arabic', ru: 'Russian', pt: 'Portuguese (Brazilian)',
};

import { rateLimit, userRateLimit } from '../ratelimit.js';
import { verifyPrivyToken } from '../auth.js';
import { getShowcaseValue } from '../kv.js';

// Alerts slide (2026-08-17): breaking articles + the shared alert-quality rules
// + the provider chain. See src/lib/alertQuality.js for why the rule is code.
import { getBreaking } from '../intelligence-store.js';
import { chat as gatewayChat } from '../llm-gateway.js';
import { checkAlert, ALERT_ASSET_RE, ALERT_EVENT_RE } from '../../../src/lib/alertQuality.js';

const BREAKING_SYNTH_SYSTEM = `You are Spectre AI, an elite market intelligence narrator.
Given a breaking news headline plus live market data, synthesise a single punchy 1-2 sentence alert (max 40 words).

RULES:
- Lead with the EVENT, then the MARKET IMPACT. Example: "Israel-Iran tensions escalating. BTC -4.2%, risk assets selling off. Capital rotating to stables."
- Use ticker symbols (BTC, ETH, SPY) and actual numbers from the data, never vague.
- If sentiment is bearish: end with a risk warning. If bullish: end with opportunity note. If neutral: end with "developing, watch closely."
- Sound like a Bloomberg terminal flash, not a news article.
- NO markdown, NO bullet points, NO greetings, NO sign-offs. NO dashes or em-dashes.
- NEVER a joke, pun, meme, slogan, rhetorical question, parenthetical aside or opinion. This is an ALERT slot on a trading desk.
- EVERY alert must contain at least one real figure from the market data.
- STRICT: 40 words max.`;


// ── Market Summary tab: macro outlook + news board (serverless parity) ───────
// Mirrors the Express routes GET /api/brief/market-outlook and /market-news
// (packages/server/index.js). Prod has no Express, so without these the Market
// Summary tab ships an empty news board + missing macro thesis on app.spectreai.io.

const MACRO_OUTLOOK_SYSTEM = `You are the chief macro strategist at Spectre AI writing the daily market outlook for sophisticated crypto and markets investors.

Using ONLY the provided headlines and market data, write a tight, analytical read on what is actually moving markets right now. Cover the dominant forces:
- Monetary policy and rates: the Fed and other central banks, cut/hike odds, bond yields, liquidity
- Politics and policy: the Trump administration, tariffs, regulation, fiscal and legislative moves
- Geopolitics: conflicts, trade wars, elections, energy shocks
- Cross-asset flow: equity indices, bonds, the US dollar, oil, gold and their read-through to risk assets and crypto

WRITE LIKE AN ANALYST, NOT A HEADLINE WRITER. Every sentence must connect a real event to its transmission channel to the market implication, and name specific assets, institutions, numbers or levels. Be concrete and non-obvious. No vague filler, no hype, no dashes, no token-picking, no memecoins, no individual altcoins, no buy or sell calls.

NEVER name a news outlet, publication, wire service or media company. You are not reporting what someone else reported - you are reading the market. Write the event, not the byline.

Return STRICT JSON only:
{"headline":"<=8 words, punchy, no period","outlook":["s1","s2","s3"],"regime":"risk-on|risk-off|mixed|defensive"}
Exactly 3 sentences. Each sentence is 26 to 44 words, a complete analytical thought (event, then mechanism, then market read-through).

Example of the REQUIRED depth and style (DO NOT reuse its content, follow its shape):
{"headline":"Rate-Cut Bets Collide With Tariff Risk","outlook":["Softer payrolls have pushed December cut odds above 80%, steepening the curve and pressuring the dollar, a liquidity tailwind that has historically supported bitcoin and other long-duration risk.","Trump's fresh tariff threats on EU autos reintroduce stagflation fears, capping the equity rally as investors weigh higher input costs against the Fed's easing impulse.","With the VIX subdued near 14 and positioning stretched into next week's CPI, risk assets look complacent and vulnerable to a hotter-than-expected inflation print."],"regime":"mixed"}`;

const MACRO_OUTLOOK_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  'https://www.theguardian.com/world/rss',
  'https://www.investing.com/rss/news.rss',
];

const MARKET_NEWS_FEEDS = {
  crypto: [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://www.theblock.co/rss.xml',
    'https://decrypt.co/feed',
  ],
  stocks: [
    'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    'https://www.marketwatch.com/rss/topstories',
  ],
  commodities: ['https://oilprice.com/rss/main'],
  macro: [
    'https://feeds.bbci.co.uk/news/business/rss.xml',
    'https://www.investing.com/rss/news.rss',
  ],
};

const _MARKET_NEWS_JUNK = /\b(?:8-K|10-K|10-Q|13F|S-1|424B|form d|prospectus)\b|^filing:|^\s*$/i;

// Regex RSS <item> parse (no external deps — same approach as news-rss.js).
function _parseRssItems(xml, sourceHost) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    if (title.trim()) {
      items.push({
        title: title.trim(),
        url: link.trim(),
        publishedAt: pubDate.trim() ? new Date(pubDate.trim()).toISOString() : null,
        source: sourceHost,
      });
    }
  }
  return items;
}

async function _fetchFeed(feedUrl) {
  try {
    const host = (() => { try { return new URL(feedUrl).hostname.replace(/^www\./, ''); } catch { return feedUrl; } })();
    const r = await fetch(feedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Spectre-RSS/1.0' },
    });
    if (!r.ok) return [];
    return _parseRssItems(await r.text(), host);
  } catch { return []; }
}

async function _fetchMultipleFeeds(urls) {
  const settled = await Promise.allSettled(urls.map((u) => _fetchFeed(u)));
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}

function _decodeTitle(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&hellip;/g, '...')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function _prettySource(raw) {
  const s = String(raw || '').trim();
  const map = {
    'feeds.content.dowjones.io': 'MarketWatch', dowjones: 'MarketWatch', marketwatch: 'MarketWatch',
    'investing.com': 'Investing.com', bbci: 'BBC', 'bbc.co.uk': 'BBC', 'oilprice.com': 'OilPrice',
    'cnbc.com': 'CNBC', 'theblock.co': 'The Block', 'coindesk.com': 'CoinDesk',
    'cointelegraph.com': 'CoinTelegraph', 'decrypt.co': 'Decrypt',
  };
  const key = s.toLowerCase();
  if (map[key]) return map[key];
  for (const [frag, name] of Object.entries(map)) if (key.includes(frag)) return name;
  return s || 'RSS';
}

function _parseMacroOutlookJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    const j = JSON.parse(t);
    const outlook = Array.isArray(j.outlook) ? j.outlook.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3) : [];
    if (!outlook.length) return null;
    const headline = String(j.headline || '').trim().replace(/[.]+$/, '');
    return { title: headline || 'Macro Market Outlook', sentences: outlook, regime: String(j.regime || '').trim() || null };
  } catch { return null; }
}

async function _generateMacroOutlookLLM(headlines, snapshot) {
  const userContent = JSON.stringify({
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    headlines,
    market: snapshot || null,
  });
  const groqKey = process.env.GROQ_API_KEY || '';
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
          temperature: 0.55, max_tokens: 1000, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: MACRO_OUTLOOK_SYSTEM }, { role: 'user', content: userContent }],
        }),
        signal: AbortSignal.timeout(22000),
      });
      if (res.ok) { const data = await res.json(); const out = _parseMacroOutlookJson(data.choices?.[0]?.message?.content); if (out) return { ...out, provider: 'groq' }; }
    } catch (e) { console.warn('[brief-api] macro-outlook groq:', e.message); }
  }
  const rawOpenAI = process.env.OPENAI_API_KEY || '';
  const openaiKey = rawOpenAI && rawOpenAI.startsWith('sk-') && !rawOpenAI.startsWith('sk-ant-') ? rawOpenAI : '';
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 600, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: MACRO_OUTLOOK_SYSTEM }, { role: 'user', content: userContent }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) { const data = await res.json(); const out = _parseMacroOutlookJson(data.choices?.[0]?.message?.content); if (out) return { ...out, provider: 'openai' }; }
    } catch (e) { console.warn('[brief-api] macro-outlook openai:', e.message); }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const route = (req.query.route || '').toLowerCase();

  // Rate-limit expensive generate/synthesis routes (Anthropic + TTS billing).
  // voices/audio streaming are cheaper but 'audio' triggers ElevenLabs so keep it low.
  if (route === 'generate' || route === 'breaking-synthesis') {
    // 2026-05-28 Sunny-audit fix: per-IP only let VPN/IP rotators burn ~10×
    // the Anthropic budget at peak. Add a per-user bucket (Privy userId)
    // first; falls through to per-IP for users behind only the team gate.
    const userId = await verifyPrivyToken(req);
    if (userId) {
      if (await userRateLimit(res, { bucket: 'brief-ai', userId, max: 10, windowMs: 60_000 })) return;
    }
    if (await rateLimit(req, res, { bucket: 'brief-ai', max: 10, windowMs: 60_000 })) return;
  } else if (route === 'audio') {
    const userId = await verifyPrivyToken(req);
    if (userId) {
      if (await userRateLimit(res, { bucket: 'brief-audio', userId, max: 5, windowMs: 60_000 })) return;
    }
    if (await rateLimit(req, res, { bucket: 'brief-audio', max: 5, windowMs: 60_000 })) return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/brief/voices — static voice config
  // ═══════════════════════════════════════════════════════════════════════════
  if (route === 'voices') {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({ voices: VOICES, default: DEFAULT_VOICE });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/brief/showcase — read-only cached brief for the marketing iframe.
  // Reads cron-warmed KV ONLY. Never triggers a fresh Anthropic call. If the
  // cache is cold (cron hasn't run yet or KV is empty) we return source:'empty'
  // so the iframe can render the static fallback state. The
  // /api/brief/generate route stays gate-only and is the only path that
  // burns Anthropic per call. 2026-05-13 SEC-20260513-017.
  // ═══════════════════════════════════════════════════════════════════════════
  if (route === 'showcase') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    try {
      const cached = await getShowcaseValue('showcase:brief');
      if (cached?.brief) {
        return res.status(200).json({
          brief: cached.brief,
          source: 'showcase-cache',
          generatedAt: cached.generatedAt || null,
          cached: true,
        });
      }
    } catch (err) {
      console.warn('[brief-api] showcase cache read error:', err.message);
    }
    return res.status(200).json({ brief: '', source: 'empty', cached: false });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/brief/market-outlook — macro thesis for the Market Summary tab
  // (Fed/rates, politics, geopolitics, cross-asset). RSS → LLM synthesis.
  // ═══════════════════════════════════════════════════════════════════════════
  if (route === 'market-outlook') {
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const snapshot = { btc: num(req.query.btc), eth: num(req.query.eth), sol: num(req.query.sol), fearGreed: num(req.query.fg) };
    try {
      let headlines = [];
      const items = await _fetchMultipleFeeds(MACRO_OUTLOOK_FEEDS);
      const cutoff = Date.now() - 18 * 60 * 60 * 1000;
      const seen = new Set();
      headlines = items
        .filter((it) => { const ts = it.publishedAt ? new Date(it.publishedAt).getTime() : Date.now(); return ts > cutoff; })
        .map((it) => ({ t: _decodeTitle(it.title), s: it.source || '' }))
        .filter((it) => it.t && !seen.has(it.t) && seen.add(it.t))
        .slice(0, 24);

      if (!headlines.length) return res.status(200).json({ hasOutlook: false });

      // The model is given the HEADLINES ONLY, never the outlet that filed
      // them. The outlook is Spectre's own analysis and has no business
      // crediting another publication in it; the prompt says so, and not
      // feeding the names means it cannot name one it was never told.
      const gen = await _generateMacroOutlookLLM(headlines.map((x) => x.t), snapshot).catch(() => null);
      if (!gen) return res.status(200).json({ hasOutlook: false });

      // 15-min CDN cache = serverless equivalent of the Express in-memory Map.
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
      return res.status(200).json({
        hasOutlook: true, title: gen.title, sentences: gen.sentences, regime: gen.regime,
        provider: gen.provider, sourceCount: headlines.length, generatedAt: new Date().toISOString(), cached: false,
      });
    } catch (e) {
      console.error('[brief-api] market-outlook error:', e.message);
      return res.status(200).json({ hasOutlook: false, error: e.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/brief/market-news — categorized market-news board (no LLM).
  // ═══════════════════════════════════════════════════════════════════════════
  if (route === 'market-news') {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 6), 30);
    try {
      const groups = Object.entries(MARKET_NEWS_FEEDS);
      const settled = await Promise.allSettled(groups.map(([, feeds]) => _fetchMultipleFeeds(feeds)));

      const cutoff = Date.now() - 36 * 60 * 60 * 1000;
      const seen = new Set();
      const collected = [];
      settled.forEach((r, i) => {
        if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
        const category = groups[i][0];
        for (const it of r.value) {
          const title = _decodeTitle(it.title);
          if (!title || title.length < 12) continue;
          if (_MARKET_NEWS_JUNK.test(title)) continue;
          const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          if (seen.has(key)) continue;
          seen.add(key);
          const ts = it.publishedAt ? new Date(it.publishedAt).getTime() : 0;
          if (ts && ts < cutoff) continue;
          collected.push({ title, source: _prettySource(it.source), category, url: it.url || '#', publishedAt: it.publishedAt || null, _ts: ts || 0 });
        }
      });

      if (!collected.length) return res.status(200).json({ hasNews: false, items: [] });

      // Interleave categories so the board reads as a MIX, recency-first per category.
      const byCat = { crypto: [], stocks: [], commodities: [], macro: [] };
      for (const it of collected) (byCat[it.category] || (byCat[it.category] = [])).push(it);
      for (const cat of Object.keys(byCat)) byCat[cat].sort((a, b) => b._ts - a._ts);
      const order = ['crypto', 'stocks', 'commodities', 'macro'];
      const mixed = [];
      let added = true;
      while (added && mixed.length < limit) {
        added = false;
        for (const cat of order) {
          const next = byCat[cat].shift();
          if (next) { mixed.push(next); added = true; if (mixed.length >= limit) break; }
        }
      }

      const out = mixed.map(({ _ts, ...rest }, i) => ({ id: `mn-${i}-${_ts || 0}`, ...rest }));
      res.setHeader('Cache-Control', 'public, s-maxage=240, stale-while-revalidate=480');
      return res.status(200).json({ hasNews: true, items: out, sourceCount: seen.size, generatedAt: new Date().toISOString(), cached: false });
    } catch (e) {
      console.error('[brief-api] market-news error:', e.message);
      return res.status(200).json({ hasNews: false, items: [], error: e.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/brief/generate — LLM-powered market brief
  // ═══════════════════════════════════════════════════════════════════════════
  if (route === 'generate') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST required' });
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { marketMode, marketData, language } = body;

      if (!marketMode || !marketData) {
        return res.status(400).json({ error: 'Missing marketMode or marketData' });
      }

      const lang = language || 'en';
      const langName = LANG_NAMES[lang] || 'English';

      const systemPrompt = lang === 'en'
        ? BRIEF_SYSTEM_PROMPT
        : BRIEF_SYSTEM_PROMPT + `\n\nCRITICAL: Write the ENTIRE brief in ${langName}. Every word must be in ${langName}. Do NOT use English. Asset names like Bitcoin, Ethereum, S&P 500 can remain in their original form.`;

      const userContent = JSON.stringify({
        mode: marketMode,
        timeContext: `${new Date().toLocaleDateString('en-US', { weekday: 'long' })} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
        ...marketData,
      });

      // Through the gateway, not straight at Anthropic. This is an 80-word
      // market brief — the cheapest capable model in the chain writes it just
      // as well as Sonnet 4 did, and the chain reaches Sonnet only if every
      // free provider is down (and only when someone opts Anthropic back in via
      // LLM_CHAIN). The old code REQUIRED an Anthropic key and returned an
      // empty brief without one, so a free-tier deployment shipped no brief at
      // all while a keyed one billed premium tokens per refresh.
      const r = await gatewayChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a concise market brief (60-80 words max) in ${langName} based on this data:\n${userContent}` },
        ],
        tier: 'smart',
        maxTokens: 512,
        temperature: 0.4,
        timeoutMs: 20000,
      });

      if (!r?.ok) {
        console.error(`[brief-api] brief generation failed: ${r?.error || 'no provider'}`);
        return res.status(200).json({ brief: '', source: 'skipped', reason: 'llm-error' });
      }

      const text = (r.text || '').trim();

      if (!text || text.length < 50) {
        return res.status(200).json({ brief: '', source: 'skipped', reason: 'llm-empty' });
      }

      return res.status(200).json({
        brief: text,
        source: 'llm',
        generatedAt: Date.now(),
        cached: false,
      });
    } catch (err) {
      console.error('[brief-api] generate error:', err.message);
      return res.status(500).json({ error: 'Failed to generate brief' });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/brief/breaking-synthesis
  //
  // This was a stub returning {synthesis: null} with the note "too complex for
  // serverless — needs content store + RSS + CryptoPanic + LLM". That was true
  // when written and stopped being true once intelligence-store (breaking
  // articles, 24h cutoff) and llm-gateway (provider chain + circuit breaker)
  // landed in _lib. Until now the consequence was invisible: the Alerts slide
  // on the Command Center has NEVER shown an alert in production — every load
  // fell back to "No active alerts. Markets operating normally." The dev
  // Express server had the real implementation, so it only ever looked right
  // locally, which is exactly the dev/prod parity trap the house rules warn
  // about.
  // ═══════════════════════════════════════════════════════════════════════════
  if (route === 'breaking-synthesis') {
    const { marketData, language } = req.body || {};
    const lang = (language || 'en').slice(0, 5);

    let articles = [];
    try { articles = getBreaking() || []; } catch (e) {
      console.warn('[breaking-synthesis] getBreaking failed:', e.message);
    }
    // An article whose text names no market asset, event or figure is an essay,
    // not an alert — the same gate the client applies to the source article.
    const article = articles.find((a) => {
      const text = `${a.headline || a.title || ''} ${a.summary || a.description || ''}`;
      return ALERT_ASSET_RE.test(text) || ALERT_EVENT_RE.test(text) || /\$\s?\d/.test(text);
    });
    if (!article) {
      // Honest empty: nothing is breaking that qualifies. The client shows the
      // "no active alerts" line, which is true rather than filler.
      return res.status(200).json({ synthesis: null, hasBreaking: false });
    }

    const headline = article.headline || article.title || '';
    const sentiment = article.sentiment || 'neutral';
    const tickers = Array.isArray(article.tickers) ? article.tickers : [];

    // Live moves, used both as LLM context and as the deterministic floor.
    const tickerList = tickers.length
      ? tickers
      : Object.keys(marketData || {}).filter((k) => k !== 'fearGreed' && k !== 'vix');
    const changeParts = tickerList.slice(0, 3).map((tk) => {
      const sym = String(tk).toUpperCase();
      const d = marketData?.[tk] || marketData?.[sym] || marketData?.[sym.toLowerCase()];
      if (d?.change != null) return `${sym} ${parseFloat(d.change) >= 0 ? '+' : ''}${parseFloat(d.change).toFixed(1)}%`;
      if (d?.price != null) return `${sym} $${Number(d.price).toLocaleString('en', { maximumFractionDigits: 0 })}`;
      return null;
    }).filter(Boolean);

    let synthesis = null;
    try {
      const r = await gatewayChat({
        messages: [
          { role: 'system', content: lang === 'en' ? BREAKING_SYNTH_SYSTEM : `${BREAKING_SYNTH_SYSTEM}\n\nCRITICAL: Write entirely in ${lang}.` },
          { role: 'user', content: `Synthesise this breaking news into a 1-2 sentence market alert (max 40 words):\nHEADLINE: ${headline}\nSENTIMENT: ${sentiment}\nLIVE: ${changeParts.join(', ') || 'n/a'}` },
        ],
        tier: 'fast',
        maxTokens: 128,
        temperature: 0.3,
        timeoutMs: 12000,
      });
      const cand = r?.ok && typeof r.text === 'string' ? r.text.trim() : '';
      // The rule the prompt only asks for. A failing synthesis is discarded,
      // not softened — the deterministic line below is a better alert than a
      // fluent non-alert.
      const verdict = checkAlert(cand);
      if (verdict.ok) synthesis = cand;
      else if (cand) console.warn(`[breaking-synthesis] rejected (${verdict.reason}): ${verdict.detail} | "${cand.slice(0, 80)}"`);
    } catch (e) {
      console.warn('[breaking-synthesis] LLM failed:', e.message);
    }

    if (!synthesis) {
      synthesis = `BREAKING: ${headline}. ${changeParts.length ? `${changeParts.join(', ')}. ` : ''}${sentiment === 'bearish' ? 'Risk-off, protect capital.' : sentiment === 'bullish' ? 'Risk-on, opportunity forming.' : 'Majors hold, developing. Watch closely.'}`;
    }

    return res.status(200).json({
      synthesis,
      article: {
        slug: article.slug, headline, sentiment, tickers,
        publishedAt: article.publishedAt,
        source: article.source || null,
        type: article.type || 'news',
      },
      hasBreaking: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/brief/audio — requires ElevenLabs streaming, not practical here
  // ═══════════════════════════════════════════════════════════════════════════
  if (route === 'audio') {
    return res.status(200).json({
      error: 'Audio generation requires the Spectre server',
      fallback: 'webspeech',
    });
  }

  // Unknown sub-route
  return res.status(404).json({ error: 'Unknown brief route' });
}
