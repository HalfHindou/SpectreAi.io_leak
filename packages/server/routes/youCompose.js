/**
 * YOU V2 — Composer endpoint (Phase 3).
 *
 * POST /api/you/compose
 *
 * Body: {
 *   user_id, intent, current_layout?, conversation_history?,
 *   agent_profile?, user_profile?, watchlist?, portfolio?
 * }
 *
 * Resolution: client may pass agent_profile/user_profile/watchlist/portfolio
 * directly (faster, no auth roundtrip) or pass user_id and the server falls
 * back to defaults. Privy/auth-driven resolution can replace the defaults
 * later without changing this contract.
 *
 * Flow:
 *   1. Build context (registry scoped to user tier).
 *   2. Build system prompt.
 *   3. Call Groq (llama-3.3-70b-versatile).
 *   4. Validate JSON output via composerValidator.
 *   5. On validation failure, retry once with appended message.
 *   6. On second failure, return friendly fallback error.
 *   7. Return validated dashboard JSON.
 */

const express = require('express');
const { getRegistryForTier } = require('../services/widgetRegistry');
const { buildSystemPrompt } = require('../services/composerPrompt');
const { validateComposerOutput } = require('../services/composerValidator');
const { getMarketContext } = require('../services/marketContext');
const { chat: gatewayChat, chatStream: gatewayChatStream } = require('../lib/llm-gateway');

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 12000;

async function callGroq(messages, { temperature = 0.2, maxTokens = 1400 } = {}) {
  // Routed through the resilient multi-provider gateway (groq → cerebras → …)
  // with JSON mode, so a single-provider outage no longer takes the composer
  // dark. Falls back only when every provider fails (r.ok === false).
  try {
    const r = await gatewayChat({
      messages,
      tier: 'smart',
      maxTokens,
      temperature,
      json: true,
      timeoutMs: GROQ_TIMEOUT_MS,
    });
    if (!r.ok) {
      return { ok: false, content: '', error: r.error || 'llm call failed' };
    }
    return { ok: true, content: r.text || '', raw: r };
  } catch (err) {
    return { ok: false, content: '', error: err?.message || 'llm call failed' };
  }
}

/**
 * Stream a Groq completion via SSE. Emits chunks via onChunk(text); resolves
 * with the full accumulated content + ok flag at the end.
 */
async function streamGroq(messages, { temperature = 0.2, maxTokens = 1400, onChunk } = {}) {
  // Routed through the resilient gateway stream. As before we deliberately do
  // NOT request JSON mode (it buffers the full response, defeating SSE) — the
  // composerValidator strips code fences and parses forgivingly, so streaming
  // raw text is safe; the retry path catches malformed output. If every
  // provider is down the generator yields nothing → ok:false, and the caller
  // applies its existing fallback.
  try {
    let content = '';
    for await (const delta of gatewayChatStream({
      messages,
      tier: 'smart',
      maxTokens,
      temperature,
      timeoutMs: GROQ_TIMEOUT_MS,
    })) {
      if (delta) {
        content += delta;
        if (typeof onChunk === 'function') onChunk(delta);
      }
    }
    if (!content) return { ok: false, content: '', error: 'all LLM providers failed' };
    return { ok: true, content };
  } catch (err) {
    return { ok: false, content: '', error: err?.message || 'llm stream failed' };
  }
}

const router = express.Router();

const FALLBACK_ERROR = 'Your agent had trouble with that. Try rephrasing or pick a template.';

/**
 * Streaming variant. Same body shape as /compose. Server-Sent Events emit:
 *   event: chunk     data: { text: '<delta>' }
 *   event: dashboard data: { dashboard, meta }
 *   event: error     data: { error, detail? }
 *   event: done      data: {}
 *
 * The frontend renders chunks into the typing bubble for live "agent is
 * building" feel, then swaps to the validated dashboard when the dashboard
 * event arrives.
 */
router.post('/compose/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data ?? {})}\n\n`);
  };

  try {
    const {
      intent,
      current_layout,
      conversation_history,
      agent_profile,
      user_profile,
      portfolio,
      watchlist,
    } = req.body || {};

    if (typeof intent !== 'string' || intent.trim() === '') {
      send('error', { error: 'intent is required' });
      send('done', {});
      return res.end();
    }

    const tier = Number(user_profile?.tier ?? 0);
    const [registry, market_context] = await Promise.all([
      getRegistryForTier(tier),
      getMarketContext(),
    ]);
    if (registry.length === 0) {
      send('error', { error: 'widget registry empty' });
      send('done', {});
      return res.end();
    }

    const systemPrompt = buildSystemPrompt({
      agent_profile, user_profile, portfolio, watchlist, registry, market_context,
    });
    const messages = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(conversation_history)) {
      for (const m of conversation_history.slice(-6)) {
        if (m && typeof m.role === 'string' && typeof m.content === 'string') {
          messages.push({ role: m.role, content: m.content });
        }
      }
    }
    if (current_layout && Array.isArray(current_layout.widgets) && current_layout.widgets.length > 0) {
      messages.push({ role: 'user', content: `Current dashboard:\n${JSON.stringify(current_layout)}\n\nIntent:\n${intent}` });
    } else {
      messages.push({ role: 'user', content: intent });
    }

    const t0 = Date.now();
    const result = await streamGroq(messages, {
      onChunk: (delta) => send('chunk', { text: delta }),
    });
    if (!result.ok) {
      send('error', { error: FALLBACK_ERROR, detail: result.error });
      send('done', {});
      return res.end();
    }

    let validation = validateComposerOutput(result.content, registry);
    let attempts = 1;
    if (!validation.valid) {
      // Retry once silently — no stream chunks for the retry, just final result.
      const retry = await callGroq([
        ...messages,
        { role: 'assistant', content: result.content },
        { role: 'user', content: `Your previous response was invalid: ${validation.errors.join('; ')}. Return strict JSON matching the schema.` },
      ]);
      attempts = 2;
      if (!retry.ok) {
        send('error', { error: FALLBACK_ERROR, detail: retry.error });
        send('done', {});
        return res.end();
      }
      validation = validateComposerOutput(retry.content, registry);
      if (!validation.valid) {
        send('error', { error: FALLBACK_ERROR, detail: validation.errors });
        send('done', {});
        return res.end();
      }
    }

    send('dashboard', {
      dashboard: validation.data,
      meta: { attempts, elapsed_ms: Date.now() - t0, registry_size: registry.length },
    });
    send('done', {});
    return res.end();
  } catch (err) {
    send('error', { error: FALLBACK_ERROR, detail: err?.message || 'internal' });
    send('done', {});
    return res.end();
  }
});

router.post('/compose', async (req, res) => {
  try {
    const {
      intent,
      current_layout,
      conversation_history,
      agent_profile,
      user_profile,
      portfolio,
      watchlist,
    } = req.body || {};

    if (typeof intent !== 'string' || intent.trim() === '') {
      return res.status(400).json({ error: 'intent is required (non-empty string)' });
    }

    const tier = Number(user_profile?.tier ?? 0);

    // Fetch registry + live market context in parallel. marketContext failures
    // are swallowed by the service (returns null) so the composer never blocks
    // on the Spectre API.
    const [registry, market_context] = await Promise.all([
      getRegistryForTier(tier),
      getMarketContext(),
    ]);

    if (registry.length === 0) {
      return res.status(500).json({ error: 'widget registry empty' });
    }

    const systemPrompt = buildSystemPrompt({
      agent_profile,
      user_profile,
      portfolio,
      watchlist,
      registry,
      market_context,
    });

    const baseMessages = [
      { role: 'system', content: systemPrompt },
    ];

    if (Array.isArray(conversation_history)) {
      for (const m of conversation_history.slice(-6)) {
        if (m && typeof m.role === 'string' && typeof m.content === 'string') {
          baseMessages.push({ role: m.role, content: m.content });
        }
      }
    }

    if (current_layout && Array.isArray(current_layout.widgets) && current_layout.widgets.length > 0) {
      baseMessages.push({
        role: 'user',
        content: `Current dashboard:\n${JSON.stringify(current_layout)}\n\nIntent:\n${intent}`,
      });
    } else {
      baseMessages.push({ role: 'user', content: intent });
    }

    const t0 = Date.now();
    const first = await callGroq(baseMessages);
    if (!first.ok) {
      return res.status(502).json({ error: FALLBACK_ERROR, detail: first.error });
    }

    let validation = validateComposerOutput(first.content, registry);
    let attempts = 1;

    if (!validation.valid) {
      const retryMessages = [
        ...baseMessages,
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: `Your previous response was invalid: ${validation.errors.join('; ')}. Return strict JSON matching the schema.`,
        },
      ];
      const second = await callGroq(retryMessages);
      attempts = 2;
      if (!second.ok) {
        return res.status(502).json({ error: FALLBACK_ERROR, detail: second.error });
      }
      validation = validateComposerOutput(second.content, registry);
      if (!validation.valid) {
        return res.status(502).json({ error: FALLBACK_ERROR, detail: validation.errors });
      }
    }

    const elapsed_ms = Date.now() - t0;
    return res.json({
      ok: true,
      dashboard: validation.data,
      meta: { attempts, elapsed_ms, registry_size: registry.length },
    });
  } catch (err) {
    return res.status(500).json({ error: FALLBACK_ERROR, detail: err?.message || 'internal error' });
  }
});

module.exports = router;
