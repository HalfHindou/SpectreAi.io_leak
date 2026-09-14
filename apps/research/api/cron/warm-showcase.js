/**
 * Vercel Cron Job - Showcase Cache Warmer (2026-05-13 SEC-20260513-017)
 *
 * Generates the LLM-derived content the marketing iframe at spectreai.io
 * needs to render real data, and writes it to KV under `showcase:*` keys.
 * Demo-session handlers (brief-api?route=showcase, market-intel?route=
 * ai-market-text) read from these keys exclusively - they NEVER trigger
 * a fresh paid call per visitor.
 *
 * Without this cron, the showcase iframe would either render empty (cache
 * miss) or, if we naively passed demo-session traffic through to the LLM,
 * burn Anthropic budget on every spectreai.io visitor.
 *
 * Schedule: every 30 min (configured in vercel.json `crons`).
 *
 * L4-PR6 (2026-06-03): cadence slowed from 15min -> 30min. The showcase
 * iframe is marketing copy - the brief + market-text only need to feel
 * "fresh-ish" (under an hour), not real-time. 30min cuts Anthropic spend
 * 2x (2 calls per fire -> 96 calls/day instead of 192). KV showcase keys
 * have no TTL (set via setShowcaseValue, expected to persist between fires)
 * so the iframe stays populated indefinitely if a fire is skipped.
 *
 * Auth: accepts either Vercel's x-vercel-cron=1 header OR explicit
 * Authorization: Bearer ${CRON_SECRET}. Without one of these, anyone could
 * hit this endpoint and force Anthropic invocations - same DoS-amplifier
 * pattern as warm-cache.js.
 */

import { setShowcaseValue } from '../_lib/kv.js';
import { generateStockBrief, generateCryptoBrief, callLLM, STOCK_TIMEFRAMES } from '../_lib/marketBrief.js';
import { fetchFearGreed } from '../_lib/market-snapshot.js';

const BRIEF_SYSTEM_PROMPT = `You are Spectre AI, a concise yet authoritative market intelligence narrator.
Write a 60-80 word spoken narrative synthesizing the provided market conditions.

CRITICAL RULES:
- NEVER use ticker symbols. Use full names: Bitcoin (not BTC), Ethereum (not ETH), Solana (not SOL).
- NEVER use bullet points, headers, markdown, or formatting.
- Be punchy and direct - a premium 15-second market flash, not a monologue.
- All numbers should sound natural when spoken aloud.
- One key insight or actionable takeaway. No filler.
- End with a brief sign-off: "This is Spectre AI."
- STRICT: Never exceed 80 words. Brevity is power.`;

const MARKET_TEXT_SYSTEM_PROMPT = `You are Spectre AI's market commentary engine. Generate a single short paragraph (40-60 words) summarizing the crypto market for the given timeframe. Plain prose, no formatting, no lists, no bullet points. Reference Bitcoin and Ethereum movements specifically. Mention overall sentiment (bullish/bearish/neutral) and one actionable observation. End with a quiet, professional close - no sign-off.`;


async function fetchMarketSnapshot() {
  // In-process alternative.me read (2026-07-02): the old HTTP self-fetch went
  // through the protection-gated VERCEL_URL and silently fell back to a
  // hardcoded 50/Neutral, so the marketing brief never reflected real fear.
  try {
    const fearGreed = await fetchFearGreed();
    if (fearGreed?.value != null) {
      return {
        timestamp: new Date().toISOString(),
        fearGreed: fearGreed.value,
        fearGreedLabel: fearGreed.classification ?? 'Neutral',
      };
    }
  } catch (err) {
    console.warn('[warm-showcase] market snapshot fetch failed:', err.message);
  }
  return {
    timestamp: new Date().toISOString(),
    fearGreed: 50,
    fearGreedLabel: 'Neutral',
  };
}

// LLM calls (marketing brief + market-text paragraph) run through the shared
// Groq-backed callLLM in marketBrief.js — cheap, and off Anthropic entirely.

export default async function handler(req, res) {
  // Auth: Vercel cron header OR explicit bearer (mirrors warm-cache.js).
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
    // 2026-07-02: prod runtime logs showed EVERY Vercel cron invocation
    // 401ing - Vercel does not send x-vercel-cron on this project and no
    // CRON_SECRET env is set, so neither branch ever matched and the cache
    // warmers/snapshots have been dead (cold caches, slow loads app-wide).
    // Vercel's documented cron signature is the user-agent; accept it. This
    // is the same trust level as the x-vercel-cron header (both spoofable -
    // verified externally), so no new exposure: the rate limit above and the
    // idempotent read-only work remain the actual defense. Setting a real
    // CRON_SECRET in the Vercel project env stays the preferred hardening.
    || String(req.headers['user-agent'] || '').startsWith('vercel-cron/');
  const auth = req.headers.authorization || '';
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const hasValidSecret = expectedAuth && auth === expectedAuth;
  if (!isVercelCron && !hasValidSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const start = Date.now();
  const results = { brief: 'skipped', marketText24h: 'skipped', stockBriefs: 'skipped', cryptoBriefs: 'skipped' };
  // Brief generators gather their data in-process now; no baseUrl needed
  // (VERCEL_URL is protection-gated and must never be used for self-fetches).

  try {
    const snapshot = await fetchMarketSnapshot();
    const userContent = JSON.stringify({
      mode: 'showcase',
      timeContext: snapshot.timestamp,
      fearGreed: snapshot.fearGreed,
      fearGreedLabel: snapshot.fearGreedLabel,
    });

    // 1. Brief (synthesizes market conditions into 60-80 word narrative)
    const briefText = await callLLM(
      BRIEF_SYSTEM_PROMPT,
      `Generate a concise market brief based on this data:\n${userContent}`,
      512,
    );
    if (briefText) {
      await setShowcaseValue('showcase:brief', {
        brief: briefText,
        generatedAt: Date.now(),
        source: 'cron-llm',
      });
      results.brief = 'ok';
    }

    // 2. AI market text (24h timeframe, paragraph form)
    const marketText = await callLLM(
      MARKET_TEXT_SYSTEM_PROMPT,
      `Generate a 40-60 word market summary for the 24h timeframe. Data:\n${userContent}`,
      256,
    );
    if (marketText) {
      await setShowcaseValue('showcase:market-text:24h', {
        text: marketText,
        timeframe: '24h',
        generatedAt: Date.now(),
      });
      results.marketText24h = 'ok';
    }

    // 3. Stock 3-part briefs (analysis / macroConditions / positioning) per
    // timeframe. Consumed by market-intel handleAiMarketText for market=stocks
    // so the Stocks "AI Market" panel is catalyst-aware in prod. One shared
    // snapshot, one Anthropic call per timeframe. A failure here never blocks
    // the crypto showcase keys above.
    try {
      let stockOk = 0;
      for (const tf of STOCK_TIMEFRAMES) {
        const brief = await generateStockBrief({ timeframe: tf });
        if (!brief?.analysis) continue;
        await setShowcaseValue(`showcase:market-brief:stocks:${tf}`, {
          ...brief,
          timeframe: tf,
          market: 'stocks',
          generatedAt: Date.now(),
        });
        stockOk += 1;
      }
      results.stockBriefs = stockOk ? `ok (${stockOk}/${STOCK_TIMEFRAMES.length})` : 'empty';
    } catch (stockErr) {
      console.warn('[warm-showcase] stock briefs failed:', stockErr.message);
      results.stockBriefs = 'error';
    }

    // 4. Crypto 3-part briefs — same shape, served by handleAiMarketText for
    // market=crypto. Replaces the template that the dashboard was showing
    // because it only consumes `.analysis` (the 40-60 word paragraph above is
    // kept for the marketing iframe). Never blocks the keys warmed above.
    try {
      let cryptoOk = 0;
      for (const tf of STOCK_TIMEFRAMES) {
        const brief = await generateCryptoBrief({ timeframe: tf });
        if (!brief?.analysis) continue;
        await setShowcaseValue(`showcase:market-brief:crypto:${tf}`, {
          ...brief,
          timeframe: tf,
          market: 'crypto',
          generatedAt: Date.now(),
        });
        cryptoOk += 1;
      }
      results.cryptoBriefs = cryptoOk ? `ok (${cryptoOk}/${STOCK_TIMEFRAMES.length})` : 'empty';
    } catch (cryptoErr) {
      console.warn('[warm-showcase] crypto briefs failed:', cryptoErr.message);
      results.cryptoBriefs = 'error';
    }
  } catch (err) {
    console.error('[warm-showcase] error:', err.message);
    return res.status(500).json({ error: 'Warmer failed', message: err.message });
  }

  return res.status(200).json({
    ok: true,
    durationMs: Date.now() - start,
    results,
  });
}
