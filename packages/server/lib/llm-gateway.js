/**
 * Spectre LLM Gateway — one resilient, cost-tiered entry point for ALL LLM calls.
 *
 * WHY: a single Groq billing flag took the whole product dark (Monarch blanked).
 * This gateway makes that impossible:
 *   - MULTI-PROVIDER FALLBACK with the best FREE+superior options first.
 *   - CIRCUIT BREAKER: a 401/402/403/429/billing error trips that provider for
 *     a cooldown so we fail over in milliseconds, not on every request.
 *   - MODEL TIERING: tier:'fast' → tiny/cheap model for classification/short
 *     tasks (~10x cheaper); tier:'smart' → flagship for marquee briefs.
 *   - TEMPLATE FLOOR: callers always get a result or a clean {ok:false} to
 *     degrade to a deterministic template — a surface NEVER errors blank again.
 *
 * Providers (enabled only if their key env is present; Ollama if reachable):
 *   groq      GROQ_API_KEY        llama-3.3-70b / 3.1-8b-instant   (paid+free tier)
 *   cerebras  CEREBRAS_API_KEY    llama-3.3-70b / 3.1-8b   FREE, ~2000 tok/s, drop-in
 *   gemini    GEMINI_API_KEY      gemini-2.0-flash         FREE, smart+fast
 *   openrouter OPENROUTER_API_KEY  llama-3.3-70b:free       FREE aggregator
 *   openai    OPENAI_API_KEY      gpt-4o-mini              paid backstop
 *   anthropic ANTHROPIC_API_KEY   claude-haiku / sonnet    paid backstop
 *   ollama    (local :11434)      qwen3:14b                free/local, last resort
 *
 * 🪤 ROTATING ANY OF THESE KEYS: Vercel binds env vars at DEPLOY time, so the
 * running functions keep the old value until a NEW deployment is built. A
 * redeploy of the same commit does not do it — the ignored-build-step script
 * (scripts/vercel-ignore-build.sh) correctly reports "no file changes" and the
 * build is skipped, which surfaces as CANCELED. The key must also be rotated in
 * three places, not one: the local .env, the box (/opt/<app>/.env, then restart the
 * consuming pm2 procs — they read it at boot), and BOTH Vercel projects.
 *
 * Order via env LLM_CHAIN="groq,cerebras,gemini,openai,anthropic,ollama".
 * Get the FREE keys (2 min each): Cerebras cloud.cerebras.ai · Gemini
 * aistudio.google.com · OpenRouter openrouter.ai.
 */

const PROVIDERS = {
  groq: {
    base: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', kind: 'openai',
    // 🪤🪤 THIRD ROTTING OF A MODEL CONSTANT IN THIS FILE, and the first one to
    // take a user-facing surface down with it. Both llama entries here 404
    // ("does not exist or you do not have access to it") — measured live
    // 2026-08-17 against our key, whose /models list carries no llama at all
    // any more. Groq is FIRST in the chain, so every caller paid a guaranteed
    // 404 and a tripped breaker before falling through, and the Research Zone
    // agent chat answered "my language models are all unreachable right now".
    // Verified 200 + clean content + real SSE on this key the same day:
    // openai/gpt-oss-120b, openai/gpt-oss-20b, groq/compound, groq/compound-mini.
    // gpt-oss puts its chain-of-thought in a SEPARATE `reasoning` delta, which
    // the stream reader below ignores, so nothing leaks into the answer —
    // unlike qwen/qwen3.6-27b, which inlines <think> into content. Do not use it.
    models: { fast: 'openai/gpt-oss-20b', smart: 'openai/gpt-oss-120b' },
  },
  cerebras: {
    base: 'https://api.cerebras.ai/v1', keyEnv: 'CEREBRAS_API_KEY', kind: 'openai',
    models: { fast: 'llama3.1-8b', smart: 'llama-3.3-70b' },
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta', keyEnv: 'GEMINI_API_KEY', altKeyEnv: 'LENS_GEMINI_API_KEY', kind: 'gemini',
    // Free-tier split: 2.5-flash-lite (high free RPD) for cheap fast-tier
    // calls; 2.5-flash (~250 req/day free) is the markedly smarter writer
    // for the smart tier - hash-gated trending reads fit inside that budget.
    // (2.0-flash was RETIRED by Google - 404s as of 2026-07-04.)
    // FLOATING ALIASES, deliberately not pinned versions. This config has now
    // rotted TWICE: gemini-2.0-flash was retired outright, and 2.5-flash /
    // 2.5-flash-lite answer "no longer available to new users" for any key
    // issued recently - so Gemini was a DEAD failover slot, silently tripping
    // its breaker and handing every call to the next provider. Verified live
    // 2026-08-02: 2.0-flash / 2.5-flash / 2.5-flash-lite all 404, while
    // gemini-flash-latest and gemini-flash-lite-latest both return 200.
    // BOTH TIERS ON FLASH-LITE, and the reason is measured, not a preference.
    // flash THINKS and bills the thoughts at the output rate, and its
    // thinkingBudget is ADVISORY — asked for 128 it returned 326, 452, 826,
    // even 1,684 thought tokens on a 109-token market brief. There is no knob
    // that makes flash stop. flash-lite reports thoughtsTokenCount 0 on every
    // prompt tried, including a full desk read, and its output is as good:
    //
    //   per 1,000 calls    flash     lite
    //   agent chat turn    $2.048    $0.038
    //   alerts synthesis   $0.893    $0.016
    //   market brief       $4.496    $0.044
    //   ------------------------------------
    //   the three          $7.44     $0.10     → 76x
    //
    // Promote a single lane back with GEMINI_SMART_MODEL if one ever needs it;
    // nothing measured here did.
    models: {
      fast: process.env.GEMINI_FAST_MODEL || 'gemini-flash-lite-latest',
      smart: process.env.GEMINI_SMART_MODEL || 'gemini-flash-lite-latest',
    },
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', kind: 'openai',
    models: { fast: 'meta-llama/llama-3.3-70b-instruct:free', smart: 'meta-llama/llama-3.3-70b-instruct:free' },
  },
  openai: {
    base: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', kind: 'openai',
    models: { fast: 'gpt-4o-mini', smart: 'gpt-4o-mini' },
  },
  anthropic: {
    base: 'https://api.anthropic.com/v1', keyEnv: 'ANTHROPIC_API_KEY', kind: 'anthropic',
    // Haiku on BOTH tiers: an emergency fallback wants to be cheap, not clever.
    models: { fast: 'claude-haiku-4-5', smart: 'claude-haiku-4-5' },
  },
  // Spectre's own Hetzner brain API (/v1/brain/quick-answer) - a live Groq
  // behind Sunny's data box. Faithful instruction-following (verified strict-
  // JSON passthrough 2026-07-03) but output caps ~1KB, so callers should keep
  // single responses compact. Uses the SPECTRE_DATA_API_KEY already in .env.
  spectre: {
    base: (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850'), keyEnv: 'SPECTRE_DATA_API_KEY', kind: 'spectre',
    models: { fast: 'brain-quick-answer', smart: 'brain-quick-answer' },
  },
  ollama: {
    base: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434') + '/v1', keyEnv: null, kind: 'openai',
    models: { fast: process.env.OLLAMA_MODEL || 'qwen3:14b', smart: process.env.OLLAMA_MODEL || 'qwen3:14b' },
  },
}

// 'spectre' (Hetzner brain quick-answer) is NOT in the default chain: its
// intent/entity system overrides instructions on token-mentioning prompts and
// answers with its own market data (verified 2026-07-03). Opt in via LLM_CHAIN
// only for prompts that never name tradable assets.
// ANTHROPIC IS NOT IN THE DEFAULT CHAIN (founder, 2026-08-17: "anthropic is too
// expensive"). Still configured, so `LLM_CHAIN=...,anthropic` opts it back in
// for one deploy or one incident — nothing reaches it by accident. And "by
// accident" is not hypothetical: it sits at the END, so the only way to reach
// it is every free provider being down at once, which is exactly what happened
// today. Kept in sync with apps/research/api/_lib/llm-gateway.js.
const DEFAULT_CHAIN = ['groq', 'cerebras', 'gemini', 'openrouter', 'openai', 'ollama']
function chain() {
  const raw = (process.env.LLM_CHAIN || '').split(',').map((s) => s.trim()).filter(Boolean)
  return (raw.length ? raw : DEFAULT_CHAIN).filter((p) => PROVIDERS[p])
}

// ── Circuit breaker ─────────────────────────────────────────────────────────
const COOLDOWN_MS = Number(process.env.LLM_BREAKER_COOLDOWN_MS) || 5 * 60 * 1000
const breaker = new Map() // provider -> openUntil(ms)
function isOpen(p) { const t = breaker.get(p); return t != null && Date.now() < t }
function trip(p, reason) { breaker.set(p, Date.now() + COOLDOWN_MS); console.warn(`[llm] breaker OPEN ${p} (${COOLDOWN_MS / 1000}s) — ${reason}`) }
// Hard failures that should disable a provider, not just retry: auth, billing, quota.
function isHardFail(status, body) {
  if ([401, 402, 403, 429].includes(status)) return true
  if (status === 400 && /restrict|overdue|payment|billing|quota|suspend|insufficient|exceeded/i.test(body || '')) return true
  return false
}

// altKeyEnv: the same Gemini key gets pasted under LENS_GEMINI_API_KEY (the
// Spectre Lens lane asked for it first), and GEMINI_API_KEY is left empty - so
// the gateway saw "no key" and skipped the only FREE provider we actually have.
// Accept either name rather than making someone paste the key twice.
function providerKey(p) {
  const cfg = PROVIDERS[p]
  if (!cfg.keyEnv) return 'local'
  return process.env[cfg.keyEnv] || (cfg.altKeyEnv ? process.env[cfg.altKeyEnv] : '') || ''
}
function available(p) { return PROVIDERS[p] && !isOpen(p) && !!providerKey(p) }
function modelFor(p, tier) { const m = PROVIDERS[p].models; return (tier === 'fast' ? m.fast : m.smart) || m.smart }
// Per-provider name for an EXPLICITLY-requested model (tool mode uses
// openai/gpt-oss-120b, which Cerebras serves without the openai/ prefix).
function toolModelFor(p, model, tier) {
  if (!model) return modelFor(p, tier)
  if (p === 'cerebras') return model.replace(/^openai\//, '')
  return model
}

// ── Message adapters ────────────────────────────────────────────────────────
function toGemini(messages) {
  // Gemini: system goes to systemInstruction; user/assistant -> contents.
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }))
  return { sys, contents }
}

// 🪤🪤 REASONING TOKENS EAT THE CALLER'S BUDGET. gpt-oss thinks before it
// answers and bills that thinking against max_tokens, so a caller asking for
// 128 tokens (the alerts synthesis) or 512 (the market brief) can spend the
// entire allowance on reasoning and return HTTP 200 with an EMPTY string —
// caught here on the first run after the model swap: 1,227 chars of reasoning,
// 420 completion tokens, nothing for the answer. Exactly the trap the gemini
// branch already documents, in a second vendor's clothes.
//
// reasoning_effort:'low' is the lever, and it is better than buying headroom:
// measured on the same prompt it takes reasoning from 1,227 chars to 30 and
// completion from 420 tokens to ~120, so even a 128-token budget returns a
// full answer. Only sent to models that understand it — an unknown field is a
// 400 on some OpenAI-compatible servers.
const reasoningOpts = (model) => (/gpt-oss/i.test(String(model || '')) ? { reasoning_effort: 'low' } : {})

// 🪤🪤 THINKING IS THE BILL. Gemini charges thought tokens at the OUTPUT rate,
// and flash thinks hard about easy questions: measured 2026-08-17, "is BTC
// bullish at 64k?" cost 440 thought tokens for a 64-token answer — 87% of the
// billed output was reasoning nobody reads. That is what put $10.41 on the
// meter in 28 days, most of it in four days.
//
// 🪤🪤 AND THERE IS NO KNOB THAT STOPS IT ON flash. `thinkingBudget: 0` is
// ACCEPTED and ignored (388 thought tokens on a prompt it was told not to think
// about) — worse than a 400, because it is a silent no-op you only catch by
// reading usageMetadata. A positive budget is advisory too: asked for 128,
// flash returned 326, then 452, then 826, then 1,684 thought tokens. Chasing
// the budget was a dead end, which is why the models above moved to flash-lite,
// the one that reports 0 every time.
//
// The cap below therefore is NOT the fix — it is the guard rail for anyone who
// overrides GEMINI_SMART_MODEL back to a thinking model. Never send 0: lite
// rejects it outright (400 invalid argument) while flash ignores it. 128 is
// accepted by both.
const GEMINI_THINK_CAP = Number(process.env.GEMINI_THINKING_BUDGET ?? 128)

// Headroom for the cap, not for unbounded reasoning. It used to be +1536
// because thinking was uncapped and would eat the caller's whole allowance,
// truncating answers mid-word; with the ceiling above, the answer needs only
// enough room for the capped thoughts plus itself.
const geminiBudget = (maxTokens) => Math.max(maxTokens + GEMINI_THINK_CAP + 128, 512)

// ── Gemini SSE ──────────────────────────────────────────────────────────────
// :streamGenerateContent?alt=sse emits the same JSON envelope as the one-shot
// call, once per partial candidate. maxOutputTokens keeps the thinking-headroom
// budget from callProvider — on flash models the ceiling covers thinking AND
// answer, and shipping the caller's number raw truncates the answer mid-word.
async function* geminiStream(p, { messages, tier, maxTokens, temperature, timeoutMs, onMeta }) {
  const cfg = PROVIDERS[p]
  const key = providerKey(p)
  const model = modelFor(p, tier)
  const { sys, contents } = toGemini(messages)
  const url = `${cfg.base}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
      generationConfig: { maxOutputTokens: geminiBudget(maxTokens), temperature, thinkingConfig: { thinkingBudget: GEMINI_THINK_CAP } },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    if (isHardFail(res.status, t)) trip(p, `${res.status} ${(t || '').slice(0, 80)}`)
    return
  }
  onMeta?.({ provider: p, model, streamed: true })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        const text = j?.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || ''
        if (text) yield text
      } catch { /* a split frame — the next read completes it */ }
    }
  }
}

// ── One provider call (non-stream) ──────────────────────────────────────────
async function callProvider(p, { messages, tier, maxTokens, temperature, json, timeoutMs, think, geminiModel }) {
  const cfg = PROVIDERS[p]
  const key = providerKey(p)
  // Per-lane model override, scoped to ONE provider so it never leaks a
  // gemini model name onto the openai/anthropic lanes in the fallback chain.
  // AI Read passes geminiModel:'gemini-3-flash-preview' to run the SAME model
  // as the token-page agent, while every other gateway consumer stays on the
  // gemini-2.5-flash smart default.
  const model = (cfg.kind === 'gemini' && geminiModel) ? geminiModel : modelFor(p, tier)
  const ctrl = AbortSignal.timeout(timeoutMs)

  if (cfg.kind === 'spectre') {
    // Single-prompt endpoint: flatten the message list; system turns into an
    // INSTRUCTIONS block the brain passes through verbatim.
    const prompt = messages
      .map((m) => (m.role === 'system' ? `INSTRUCTIONS: ${m.content}` : String(m.content || '')))
      .join('\n\n')
    const res = await fetch(`${cfg.base}/v1/brain/quick-answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ prompt }),
      signal: ctrl,
    })
    const bodyText = await res.text()
    if (!res.ok) return { ok: false, status: res.status, body: bodyText }
    try {
      const j = JSON.parse(bodyText)
      const text = j && j.data && typeof j.data.answer === 'string' ? j.data.answer : ''
      if (!text) return { ok: false, status: 502, body: 'empty answer' }
      return { ok: true, text }
    } catch (e) {
      return { ok: false, status: 502, body: 'bad json from brain' }
    }
  }

  if (cfg.kind === 'gemini') {
    const { sys, contents } = toGemini(messages)
    // Try the requested model, then the tier default as an IN-LANE fallback.
    // When a caller overrides to a preview model (gemini-3-flash-preview) that
    // the dev API might not serve, this guarantees we degrade to the proven
    // gemini-2.5-flash BEFORE the chain leaves gemini for a non-gemini lane -
    // so a preview outage can never regress a working gemini read to rules.
    const base = modelFor(p, tier)
    const candidates = model !== base ? [model, base] : [model]
    let last = { ok: false, status: 502, body: 'no gemini attempt' }
    for (const gm of candidates) {
      const url = `${cfg.base}/models/${gm}:generateContent?key=${encodeURIComponent(key)}`
      const body = {
        contents,
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
        generationConfig: {
          // 🪤 THINKING HEADROOM. maxOutputTokens is a ceiling on thinking +
          // answer COMBINED. The thinkingConfig below only fires for model
          // names carrying a version ("2.5" / "gemini-3"), so a FLOATING alias
          // like gemini-flash-latest matches neither and thinks unbounded:
          // measured 2026-08-02, asking for 420 gave thoughts 399 / output 17 /
          // finishReason MAX_TOKENS, i.e. JSON truncated mid-string and every
          // caller silently fell through to its fallback. Budgeting for it
          // fixes the alias case without disturbing the pinned-version paths.
          maxOutputTokens: geminiBudget(maxTokens),
          temperature,
          ...(json ? { responseMimeType: 'application/json' } : {}),
          // THE CAP NOW APPLIES TO EVERY GEMINI MODEL. It used to be gated on
          // `gemini-3` or a literal '2.5' in the name — and the models this
          // gateway actually calls are the floating aliases gemini-flash-latest
          // and gemini-flash-lite-latest, which match NEITHER. So the guard
          // that existed to bound thinking had been inert on the only models
          // using it, and flash thought without a ceiling.
          //
          // The old `think ? 512 : 0` is also wrong on its face: 0 is a
          // silent no-op, measured 388 thought tokens. A small positive budget
          // is what disables it. See GEMINI_THINK_CAP above.
          ...(/gemini-3/i.test(gm)
            ? { thinkingConfig: { thinkingLevel: 'low' } }
            : { thinkingConfig: { thinkingBudget: think ? Math.max(GEMINI_THINK_CAP, 512) : GEMINI_THINK_CAP } }),
        },
      }
      let res
      try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl })
      } catch (e) { last = { ok: false, status: 502, body: e.message }; continue }
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        last = { ok: false, status: res.status, body: t }
        // Only fall through to the base model on a model-availability error
        // (404 not-found / 400 bad-model). A 429/5xx is the WHOLE lane's
        // problem, not this model's - let the chain handle it.
        if (candidates.length > 1 && gm !== base && (res.status === 404 || res.status === 400)) {
          console.warn(`[llm] gemini ${gm} unavailable (${res.status}) - falling back to ${base}`)
          continue
        }
        return last
      }
      const data = await res.json()
      const text = data?.candidates?.[0]?.content?.parts?.map((x) => x.text).join('') || ''
      if (text) return { ok: true, text, status: 200 }
      last = { ok: false, status: 200, body: 'empty gemini answer' }
    }
    return last
  }

  if (cfg.kind === 'anthropic') {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
    const res = await fetch(`${cfg.base}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, ...(sys ? { system: sys } : {}), messages: msgs }),
      signal: ctrl,
    })
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, status: res.status, body: t } }
    const data = await res.json()
    const text = (data?.content || []).map((c) => c.text || '').join('') || ''
    return { ok: !!text, text, status: 200 }
  }

  // openai-compatible (groq, cerebras, openrouter, openai, ollama)
  const headers = { 'Content-Type': 'application/json' }
  if (key && key !== 'local') headers.Authorization = `Bearer ${key}`
  if (p === 'openrouter') { headers['HTTP-Referer'] = 'https://spectreai.io'; headers['X-Title'] = 'Spectre AI' }
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, ...reasoningOpts(model), ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    signal: ctrl,
  })
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, status: res.status, body: t } }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  return { ok: !!text, text, status: 200 }
}

/**
 * chat — non-streaming. Walks the fallback chain. Always resolves (never throws).
 * @returns {{ok:boolean, text:string, provider?:string, model?:string, tried:string[], error?:string}}
 */
async function chat(opts = {}) {
  const { messages, tier = 'smart', maxTokens = 1024, temperature = 0.3, json = false, timeoutMs = 30000, think = false, chain: only, geminiModel } = opts
  const order = (only && only.length ? only : chain()).filter(available)
  const tried = []
  if (!order.length) return { ok: false, text: '', tried, error: 'no LLM provider available (no keys / all breakers open)' }
  for (const p of order) {
    tried.push(p)
    try {
      const r = await callProvider(p, { messages, tier, maxTokens, temperature, json, timeoutMs, think, geminiModel })
      if (r.ok) return { ok: true, text: r.text, provider: p, model: (p === 'gemini' && geminiModel) ? geminiModel : modelFor(p, tier), tried }
      if (isHardFail(r.status, r.body)) trip(p, `${r.status} ${(r.body || '').slice(0, 80)}`)
      else console.warn(`[llm] ${p} soft-fail ${r.status}: ${(r.body || '').slice(0, 80)}`)
    } catch (e) {
      console.warn(`[llm] ${p} threw: ${e.message}`)
    }
  }
  return { ok: false, text: '', tried, error: `all providers failed (${tried.join(', ')})` }
}

/**
 * chatStream — async generator of text chunks. Streams from the first available
 * openai-compatible provider; for gemini/anthropic it falls back to a single
 * buffered chunk. Yields nothing if every provider fails (caller applies floor).
 * @returns {AsyncGenerator<string>} and sets the .meta promise via opts.onMeta.
 */
async function* chatStream(opts = {}) {
  const { messages, tier = 'smart', maxTokens = 1024, temperature = 0.3, timeoutMs = 45000, chain: only, onMeta } = opts
  const order = (only && only.length ? only : chain()).filter(available)
  const tried = []
  for (const p of order) {
    tried.push(p)
    const cfg = PROVIDERS[p]
    try {
      // Gemini streams for real — :streamGenerateContent with alt=sse. It used
      // to be lumped in with "non-OpenAI, buffer it", which was fine while it
      // was a failover slot and wrong the moment it led the chain for CHAT:
      // a 900-word read landing as ONE chunk after 20 silent seconds reads as
      // a hang, and the typing indicator has nothing to animate.
      if (cfg.kind === 'gemini') {
        let any = false
        try {
          for await (const piece of geminiStream(p, { messages, tier, maxTokens, temperature, timeoutMs, onMeta })) {
            any = true
            yield piece
          }
        } catch (e) {
          if (!any) console.warn(`[llm] gemini stream failed: ${e?.message}`)
        }
        if (any) return
        // Stream refused before a single token: fall back to the buffered call
        // rather than skipping the provider outright.
        const r = await callProvider(p, { messages, tier, maxTokens, temperature, json: false, timeoutMs })
        if (r.ok) { onMeta?.({ provider: p, model: modelFor(p, tier), streamed: false }); yield r.text; return }
        if (isHardFail(r.status, r.body)) trip(p, `${r.status}`)
        continue
      }

      if (cfg.kind !== 'openai') {
        // Remaining non-OpenAI providers: buffer then emit as one chunk.
        const r = await callProvider(p, { messages, tier, maxTokens, temperature, json: false, timeoutMs })
        if (r.ok) { onMeta?.({ provider: p, model: modelFor(p, tier), streamed: false }); yield r.text; return }
        if (isHardFail(r.status, r.body)) trip(p, `${r.status}`)
        continue
      }
      const key = providerKey(p)
      const headers = { 'Content-Type': 'application/json' }
      if (key && key !== 'local') headers.Authorization = `Bearer ${key}`
      if (p === 'openrouter') { headers['HTTP-Referer'] = 'https://spectreai.io'; headers['X-Title'] = 'Spectre AI' }
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify({ model: modelFor(p, tier), messages, max_tokens: maxTokens, temperature, ...reasoningOpts(modelFor(p, tier)), stream: true }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok || !res.body) { const t = await res.text().catch(() => ''); if (isHardFail(res.status, t)) trip(p, `${res.status} ${(t || '').slice(0, 80)}`); continue }
      onMeta?.({ provider: p, model: modelFor(p, tier), streamed: true })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let emitted = false
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const payload = t.slice(5).trim()
          if (payload === '[DONE]') return
          try {
            const j = JSON.parse(payload)
            const delta = j.choices?.[0]?.delta?.content
            if (delta) { emitted = true; yield delta }
          } catch { /* keep accumulating */ }
        }
      }
      if (emitted) return
      // streamed nothing → fall through to next provider
    } catch (e) {
      console.warn(`[llm] stream ${p} threw: ${e.message}`)
    }
  }
  // all failed → generator ends empty; caller applies the template floor.
}

// Non-streaming completion that returns the FULL assistant message (content +
// tool_calls) so a caller can run a tool-calling loop. Walks OpenAI-compatible
// providers only (the tools/tool_choice shape is OpenAI-style); same breaker.
// Returns { ok, message, provider, model, tried, error }.
async function chatRaw(opts = {}) {
  const {
    messages, tools, toolChoice = 'auto', model, tier = 'smart',
    maxTokens = 2048, temperature, extra = {}, timeoutMs = 45000, chain: only, signal,
  } = opts
  const order = (only && only.length ? only : chain())
    .filter((p) => PROVIDERS[p] && PROVIDERS[p].kind === 'openai')
    .filter(available)
  const tried = []
  if (!order.length) return { ok: false, message: null, tried, error: 'no OpenAI-compatible LLM provider available (no keys / all breakers open)' }
  for (const p of order) {
    tried.push(p)
    try {
      const cfg = PROVIDERS[p]
      const key = providerKey(p)
      const headers = { 'Content-Type': 'application/json' }
      if (key && key !== 'local') headers.Authorization = `Bearer ${key}`
      if (p === 'openrouter') { headers['HTTP-Referer'] = 'https://spectreai.io'; headers['X-Title'] = 'Spectre AI' }
      const body = {
        model: toolModelFor(p, model, tier),
        messages,
        max_tokens: maxTokens,
        ...(temperature != null ? { temperature } : {}),
        ...(tools ? { tools, tool_choice: toolChoice } : {}),
        ...extra,
      }
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: signal || AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        if (isHardFail(res.status, t)) trip(p, `${res.status} ${(t || '').slice(0, 80)}`)
        else console.warn(`[llm] ${p} tool soft-fail ${res.status}: ${(t || '').slice(0, 80)}`)
        continue
      }
      const data = await res.json()
      const message = data.choices && data.choices[0] && data.choices[0].message
      if (!message) continue
      return { ok: true, message, provider: p, model: body.model, tried }
    } catch (e) {
      console.warn(`[llm] ${p} tool threw: ${e.message}`)
    }
  }
  return { ok: false, message: null, tried, error: `all providers failed (${tried.join(', ')})` }
}

function providerStatus() {
  return chain().map((p) => ({ provider: p, hasKey: !!providerKey(p), breakerOpen: isOpen(p) }))
}

module.exports = { chat, chatStream, chatRaw, providerStatus, PROVIDERS }
