/**
 * Vercel Serverless — YOU V2 composer handler.
 *
 * Mirrors packages/server/routes/youCompose.js. POST /api/you/compose.
 * Same contract: { intent, current_layout?, conversation_history?,
 * agent_profile?, user_profile?, portfolio?, watchlist? }.
 *
 * Calls Groq, validates the JSON output, retries once on validation
 * failure, returns friendly fallback on second failure.
 */

import { chat } from '../llm-gateway.js'

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_TIMEOUT_MS = 12000
const FALLBACK_ERROR = 'Your agent had trouble with that. Try rephrasing or pick a template.'
const MAX_WIDGETS = 8

const AGENT_FLAVOR = {
  Phantom: 'You specialize in finding things nobody else has found yet. You lead with alpha, hidden signals, stealth accumulation patterns.',
  Oracle:  'You specialize in sentiment and crowd psychology. You lead with what the market FEELS like, social signals, fear/greed shifts.',
  Cipher:  'You specialize in quantitative patterns. You lead with data, backtests, statistical edges, correlations.',
  Herald:  'You specialize in speed. You lead with breaking news, first-mover information, real-time developments.',
  Titan:   'You specialize in risk and protection. You lead with portfolio health, exposure analysis, hedging opportunities.',
  Wraith:  'You are a generalist still learning. You cover everything broadly and develop a specialty as you learn more about your owner.',
}

let cachedWidgets = null
async function getRegistryForTier(tier) {
  if (!cachedWidgets) {
    const reg = await import('../../../src/registry/widgets.js')
    cachedWidgets = reg.WIDGETS
  }
  return cachedWidgets.filter((w) => w.tier <= tier && (w.status || 'active') === 'active')
}

// Direct Hetzner origin default — api.spectreai.io is CF-WAF blocked for
// Vercel server-to-server traffic. Env var still wins when set.
const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').replace(/\/$/, '')
const SPECTRE_API_KEY = process.env.SPECTRE_API_KEY || ''
const marketCache = new Map()
const MARKET_CACHE_TTL_MS = 60_000

async function fetchSpectre(path) {
  const cached = marketCache.get(path)
  if (cached && Date.now() - cached.ts < MARKET_CACHE_TTL_MS) return cached.value
  if (!SPECTRE_API_KEY) return null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch(`${SPECTRE_API_BASE}${path}`, {
      headers: { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!r.ok) return null
    const j = await r.json()
    marketCache.set(path, { ts: Date.now(), value: j })
    return j
  } catch { return null }
}

async function getMarketContext() {
  const [globalRes, trendingRes] = await Promise.allSettled([
    fetchSpectre('/v1/market/global'),
    fetchSpectre('/v1/trending?limit=10'),
  ])
  const g = (globalRes.status === 'fulfilled' ? globalRes.value : null)?.data || (globalRes.status === 'fulfilled' ? globalRes.value : null) || null
  const tr = trendingRes.status === 'fulfilled' ? trendingRes.value : null
  if (!g && (!tr?.data || tr.data.length === 0)) return null
  return {
    global: g ? {
      total_mcap_usd: g.total_market_cap_usd ?? g.total_mcap ?? null,
      btc_dominance_pct: g.btc_dominance ?? g.btc_dominance_pct ?? null,
      change_24h_pct: g.market_cap_change_24h ?? g.change_24h ?? null,
      fear_greed: g.fear_greed ?? null,
    } : null,
    trending: (Array.isArray(tr?.data) ? tr.data.slice(0, 5) : []).map((t) => ({
      asset: t.asset || t.symbol || null,
      change_24h_pct: t.change_24h ?? null,
      volume_spike: t.volume_spike ?? null,
    })).filter((t) => t.asset),
  }
}

function summarizeMarketContext(mc) {
  if (!mc || (!mc.global && (!mc.trending || mc.trending.length === 0))) return 'No live market context available.'
  const lines = []
  if (mc.global) {
    const g = mc.global
    const parts = []
    if (g.total_mcap_usd != null) parts.push(`total mcap $${Number(g.total_mcap_usd).toLocaleString()}`)
    if (g.btc_dominance_pct != null) parts.push(`BTC dominance ${Number(g.btc_dominance_pct).toFixed(1)}%`)
    if (g.change_24h_pct != null) parts.push(`24h ${g.change_24h_pct >= 0 ? '+' : ''}${Number(g.change_24h_pct).toFixed(2)}%`)
    if (g.fear_greed != null) parts.push(`F&G ${g.fear_greed}`)
    if (parts.length) lines.push(`MARKET STATE: ${parts.join(' · ')}`)
  }
  if (mc.trending?.length) {
    const items = mc.trending.map((t) => {
      const ch = t.change_24h_pct != null ? `${t.change_24h_pct >= 0 ? '+' : ''}${Number(t.change_24h_pct).toFixed(1)}%` : ''
      return `${t.asset}${ch ? ' ' + ch : ''}`
    })
    lines.push(`TRENDING: ${items.join(', ')}`)
  }
  return lines.join('\n')
}

function summarizePortfolio(p) {
  if (!p || typeof p !== 'object') return 'No portfolio connected yet.'
  const positions = Array.isArray(p.positions) ? p.positions : []
  if (positions.length === 0) return 'No active positions.'
  const top = positions.slice().sort((a, b) => (b.value_usd || 0) - (a.value_usd || 0))
    .slice(0, 5).map((p) => p.symbol).filter(Boolean).join(', ')
  return `${positions.length} positions, top holdings: ${top || 'unknown'}.`
}

function summarizeWatchlist(w) {
  if (!Array.isArray(w) || w.length === 0) return 'No watchlist saved.'
  return `${w.length} tokens watched: ${w.slice(0, 8).join(', ')}${w.length > 8 ? '…' : ''}.`
}

function compactRegistry(registry) {
  return registry.map((w) => ({
    id: w.id, name: w.name, description: w.description,
    category: w.category, tier: w.tier,
    default_size: w.default_size, min_size: w.min_size, max_size: w.max_size || null,
    use_cases: w.use_cases.slice(0, 2),
  }))
}

function buildSystemPrompt({ agent_profile, user_profile, portfolio, watchlist, registry, market_context }) {
  const agentType = agent_profile?.agent_type || 'Wraith'
  const userName = user_profile?.name || 'the trader'
  const motivation = user_profile?.motivation || 'general market intelligence'
  const infoStyle = user_profile?.info_style || 'quick'
  const riskProfile = user_profile?.risk_profile || 'moderate'
  const markets = Array.isArray(user_profile?.markets) ? user_profile.markets.join(', ') : (user_profile?.markets || 'crypto')
  const flavor = AGENT_FLAVOR[agentType] || AGENT_FLAVOR.Wraith
  return `You are ${agentType}, ${userName}'s personal Spectre agent.

You know them. You have been learning them since the egg hatched. ${flavor}

Their profile:
- Motivation: ${motivation}
- Risk tolerance: ${riskProfile}
- Markets: ${markets}
- Info style: ${infoStyle}
- Portfolio: ${summarizePortfolio(portfolio)}
- Watchlist: ${summarizeWatchlist(watchlist)}

Live market context (from the Spectre API at this moment):
${summarizeMarketContext(market_context)}

Use the live market context to bias your widget choices. If F&G is in extreme fear / greed, surface sentiment widgets. If a token is breaking out in TRENDING, prefer chart and orderflow widgets over passive metrics. If volatility is high (large 24h moves), include risk widgets like liquidation maps and funding heatmaps. Match the moment.

The user is using the dashboard composer. They will tell you what they want to see. You build it for them.

You have access to these widgets only. Do not invent any widget ids:

${JSON.stringify(compactRegistry(registry))}

When you respond, return strict JSON in this exact shape:

{"widgets":[{"widget_id":"must exist in registry above","x":0,"y":0,"w":6,"h":4,"props":{}}],"rationale":"One sentence in your voice explaining the build."}

Rules:
- Maximum 8 widgets. Minimum 1.
- Widget ids must come from the registry above.
- Layout fits a 12-column grid. No overlaps. x + w <= 12.
- CRITICAL: w >= min_size.w and h >= min_size.h. When unsure, use default_size.
- w <= max_size.w and h <= max_size.h when max_size is defined.
- Personalize from portfolio + watchlist.
- Rationale: ONE sentence, your voice, info style ${infoStyle}.
- No preamble, no markdown. Strict JSON only.

For follow-ups ("add X", "remove Y", "make it more Z"), return the updated layout. Each widget_id at most once. Preserve widgets the user did not ask to remove.`
}

function parseJsonSafe(text) {
  if (typeof text !== 'string') return null
  let trimmed = text.trim()
  if (trimmed.startsWith('```')) trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  try { return JSON.parse(trimmed) } catch { return null }
}

function validateOutput(text, registry) {
  const errors = []
  const data = parseJsonSafe(text)
  if (!data) return { valid: false, errors: ['response is not valid JSON'], data: null }
  if (!Array.isArray(data.widgets)) errors.push('widgets must be an array')
  if (typeof data.rationale !== 'string' || !data.rationale.trim()) errors.push('rationale must be non-empty')
  if (errors.length) return { valid: false, errors, data }
  if (data.widgets.length < 1 || data.widgets.length > MAX_WIDGETS) errors.push(`widgets length outside 1..${MAX_WIDGETS}`)

  const byId = new Map(registry.map((w) => [w.id, w]))
  const seen = new Set()
  for (const [i, item] of data.widgets.entries()) {
    const where = `widgets[${i}]`
    if (!item || typeof item !== 'object') { errors.push(`${where}: not object`); continue }
    if (typeof item.widget_id !== 'string') { errors.push(`${where}: widget_id required`); continue }
    const reg = byId.get(item.widget_id)
    if (!reg) { errors.push(`${where}: ${item.widget_id} not in registry`); continue }
    if (seen.has(item.widget_id)) errors.push(`${where}: duplicate ${item.widget_id}`)
    seen.add(item.widget_id)
    for (const f of ['x', 'y', 'w', 'h']) if (typeof item[f] !== 'number') errors.push(`${where}: ${f} must be number`)
    if (errors.some((e) => e.startsWith(where))) continue
    if (item.x < 0 || item.y < 0) errors.push(`${where}: x/y must be >= 0`)
    if (item.x + item.w > 12) errors.push(`${where}: x+w exceeds 12`)
    if (item.w < reg.min_size.w || item.h < reg.min_size.h) errors.push(`${where}: ${item.w}x${item.h} smaller than min ${reg.min_size.w}x${reg.min_size.h}`)
    if (reg.max_size && (item.w > reg.max_size.w || item.h > reg.max_size.h)) errors.push(`${where}: larger than max ${reg.max_size.w}x${reg.max_size.h}`)
  }
  if (!errors.length) {
    for (let i = 0; i < data.widgets.length; i++) {
      for (let j = i + 1; j < data.widgets.length; j++) {
        const a = data.widgets[i], b = data.widgets[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          errors.push(`${a.widget_id} and ${b.widget_id} overlap`)
        }
      }
    }
  }
  return { valid: errors.length === 0, errors, data }
}

async function callGroq(messages) {
  // Resilient gateway: Groq → Cerebras/Gemini → OpenRouter → OpenAI/Anthropic →
  // Ollama, with a circuit breaker. `smart` tier (70B) for the layout compose;
  // `json: true` mirrors the old response_format:{type:'json_object'}. Returns
  // the same { ok, content } / { ok:false, error } shape callers expect.
  const r = await chat({
    messages,
    tier: 'smart',
    maxTokens: 1400,
    temperature: 0.2,
    timeoutMs: GROQ_TIMEOUT_MS,
    json: true,
  })
  if (!r.ok) return { ok: false, error: r.error || 'llm gateway failed' }
  return { ok: true, content: r.text || '' }
}

// Wave 5h (SEC-20260516-003): body size cap. A legitimate compose POST
// carries a 1-2 KB widget layout + ~500B prompt; 16 KB is a generous
// ceiling that still blocks payload-amplification abuse.
const MAX_POST_BYTES = 16 * 1024

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  // SEC-20260518-001: content-length is client-controlled. We keep it as a
  // fast-path filter and additionally measure the parsed body length to
  // defeat content-length spoofing (e.g. `Content-Length: 1` + 200 KB body).
  const len = parseInt(req.headers?.['content-length'] || '0', 10)
  if (Number.isFinite(len) && len > MAX_POST_BYTES) {
    return res.status(413).json({ error: 'Payload too large' })
  }
  if (req.body != null) {
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    if (bodyStr.length > MAX_POST_BYTES) {
      return res.status(413).json({ error: 'Payload too large' })
    }
  }
  try {
    const { intent, current_layout, conversation_history, agent_profile, user_profile, portfolio, watchlist } = req.body || {}
    if (typeof intent !== 'string' || !intent.trim()) {
      return res.status(400).json({ error: 'intent is required' })
    }
    const tier = Number(user_profile?.tier ?? 0)
    const [registry, market_context] = await Promise.all([
      getRegistryForTier(tier),
      getMarketContext(),
    ])
    if (registry.length === 0) return res.status(500).json({ error: 'widget registry empty' })

    const sys = buildSystemPrompt({ agent_profile, user_profile, portfolio, watchlist, registry, market_context })
    const messages = [{ role: 'system', content: sys }]
    if (Array.isArray(conversation_history)) {
      for (const m of conversation_history.slice(-6)) {
        if (m && typeof m.role === 'string' && typeof m.content === 'string') {
          messages.push({ role: m.role, content: m.content })
        }
      }
    }
    if (current_layout && Array.isArray(current_layout.widgets) && current_layout.widgets.length > 0) {
      messages.push({ role: 'user', content: `Current dashboard:\n${JSON.stringify(current_layout)}\n\nIntent:\n${intent}` })
    } else {
      messages.push({ role: 'user', content: intent })
    }

    const t0 = Date.now()
    const first = await callGroq(messages)
    if (!first.ok) return res.status(502).json({ error: FALLBACK_ERROR, detail: first.error })

    let validation = validateOutput(first.content, registry)
    let attempts = 1
    if (!validation.valid) {
      const retry = await callGroq([
        ...messages,
        { role: 'assistant', content: first.content },
        { role: 'user', content: `Your previous response was invalid: ${validation.errors.join('; ')}. Return strict JSON matching the schema.` },
      ])
      attempts = 2
      if (!retry.ok) return res.status(502).json({ error: FALLBACK_ERROR, detail: retry.error })
      validation = validateOutput(retry.content, registry)
      if (!validation.valid) return res.status(502).json({ error: FALLBACK_ERROR, detail: validation.errors })
    }
    return res.status(200).json({
      ok: true,
      dashboard: validation.data,
      meta: { attempts, elapsed_ms: Date.now() - t0, registry_size: registry.length },
    })
  } catch (err) {
    return res.status(500).json({ error: FALLBACK_ERROR, detail: err?.message || 'internal' })
  }
}
