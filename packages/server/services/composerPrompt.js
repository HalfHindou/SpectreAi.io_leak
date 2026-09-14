/**
 * YOU V2 — Composer system prompt builder.
 *
 * The composer is not a generic chatbot. It is the user's existing agent
 * (Phantom, Oracle, Cipher, Herald, Titan, Wraith) with a new capability:
 * building dashboards from natural language intent.
 *
 * The system prompt template is mirrored from /docs/YOU_V2/CHATBOT_SPEC.md
 * with extensions that pull personality lines from
 * /apps/research/spectre-agent-spec.md so the composer's voice matches the
 * agent the user already knows.
 */

const AGENT_FLAVOR = {
  Phantom: 'You specialize in finding things nobody else has found yet. You lead with alpha, hidden signals, stealth accumulation patterns.',
  Oracle:  'You specialize in sentiment and crowd psychology. You lead with what the market FEELS like, social signals, fear/greed shifts.',
  Cipher:  'You specialize in quantitative patterns. You lead with data, backtests, statistical edges, correlations.',
  Herald:  'You specialize in speed. You lead with breaking news, first-mover information, real-time developments.',
  Titan:   'You specialize in risk and protection. You lead with portfolio health, exposure analysis, hedging opportunities.',
  Wraith:  'You are a generalist still learning. You cover everything broadly and develop a specialty as you learn more about your owner.',
};

function summarizePortfolio(p) {
  if (!p || typeof p !== 'object') return 'No portfolio connected yet.';
  const positions = Array.isArray(p.positions) ? p.positions : [];
  if (positions.length === 0) return 'No active positions.';
  const top = positions
    .slice()
    .sort((a, b) => (b.value_usd || 0) - (a.value_usd || 0))
    .slice(0, 5)
    .map(p => p.symbol)
    .filter(Boolean)
    .join(', ');
  return `${positions.length} positions, top holdings: ${top || 'unknown'}.`;
}

function summarizeWatchlist(w) {
  if (!Array.isArray(w) || w.length === 0) return 'No watchlist saved.';
  return `${w.length} tokens watched: ${w.slice(0, 8).join(', ')}${w.length > 8 ? '…' : ''}.`;
}

function compactRegistry(registry) {
  return registry.map(w => ({
    id: w.id,
    name: w.name,
    description: w.description,
    category: w.category,
    tier: w.tier,
    default_size: w.default_size,
    min_size: w.min_size,
    max_size: w.max_size || null,
    use_cases: w.use_cases.slice(0, 2),
  }));
}

function summarizeMarketContext(mc) {
  if (!mc || (!mc.global && (!mc.trending || mc.trending.length === 0))) {
    return 'No live market context available.';
  }
  const lines = [];
  if (mc.global) {
    const g = mc.global;
    const parts = [];
    if (g.total_mcap_usd != null) parts.push(`total mcap $${Number(g.total_mcap_usd).toLocaleString()}`);
    if (g.btc_dominance_pct != null) parts.push(`BTC dominance ${Number(g.btc_dominance_pct).toFixed(1)}%`);
    if (g.change_24h_pct != null) parts.push(`24h ${g.change_24h_pct >= 0 ? '+' : ''}${Number(g.change_24h_pct).toFixed(2)}%`);
    if (g.fear_greed != null) parts.push(`F&G ${g.fear_greed}`);
    if (parts.length) lines.push(`MARKET STATE: ${parts.join(' · ')}`);
  }
  if (mc.trending && mc.trending.length > 0) {
    const items = mc.trending.map((t) => {
      const ch = t.change_24h_pct != null ? `${t.change_24h_pct >= 0 ? '+' : ''}${Number(t.change_24h_pct).toFixed(1)}%` : '';
      return `${t.asset}${ch ? ' ' + ch : ''}`;
    });
    lines.push(`TRENDING: ${items.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Build the system prompt for the Groq composer call.
 *
 * @param {Object} ctx
 * @param {Object} ctx.agent_profile     { agent_type, level }
 * @param {Object} ctx.user_profile      { name, motivation, info_style, risk_profile, markets, tier }
 * @param {Object} [ctx.portfolio]       { positions: [{ symbol, value_usd }] }
 * @param {string[]} [ctx.watchlist]
 * @param {Array}  ctx.registry          widgets the user can use (already tier-scoped)
 * @param {Object} [ctx.market_context]  live market state from Spectre API
 * @returns {string}
 */
function buildSystemPrompt({ agent_profile, user_profile, portfolio, watchlist, registry, market_context }) {
  const agentType = agent_profile?.agent_type || 'Wraith';
  const userName = user_profile?.name || 'the trader';
  const motivation = user_profile?.motivation || 'general market intelligence';
  const infoStyle = user_profile?.info_style || 'quick';
  const riskProfile = user_profile?.risk_profile || 'moderate';
  const markets = Array.isArray(user_profile?.markets) ? user_profile.markets.join(', ') : (user_profile?.markets || 'crypto');

  const flavor = AGENT_FLAVOR[agentType] || AGENT_FLAVOR.Wraith;

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

{
  "widgets": [
    {
      "widget_id": "must exist in registry above",
      "x": 0,
      "y": 0,
      "w": 6,
      "h": 4,
      "props": {}
    }
  ],
  "rationale": "One sentence in your voice explaining the build."
}

Rules:
- Maximum 8 widgets per dashboard. Minimum 1.
- Widget ids must come from the registry above.
- Layout must fit a 12-column grid. No widget overlaps. x + w must be <= 12.
- CRITICAL: Each widget's "w" MUST be >= its registry min_size.w and "h" MUST be >= its registry min_size.h. When unsure, prefer the widget's default_size — it always satisfies min_size. A typical list/feed widget has min w=4 or w=6; do not output w=2 or w=3 for those.
- Each widget's "w" MUST be <= max_size.w and "h" <= max_size.h when max_size is defined.
- Use the user's portfolio and watchlist to personalize. If they hold ETH, include ETH-relevant widgets. If they trade memes, lean degen.
- THEME MATCHING is critical. When the intent names a theme (perps, RWA, on-chain, narrative, prediction markets, etc.), pick widgets whose category or tags match that theme. Do NOT default to generic BTC/ETH price widgets unless the user explicitly asked for prices. Search the registry's category and tags fields for theme keywords from the intent.
- If fewer than 3 widgets in the registry truly match the theme, that is fine — return what you have rather than padding with off-theme widgets. A focused 3-widget dashboard beats a diluted 6-widget one.
- Rationale must be ONE sentence and sound like you. Match their info style: ${infoStyle}.
- No preamble, no markdown, no commentary. Strict JSON only.

Example of a correct, validated response:
{"widgets":[{"widget_id":"you-funding-heatmap","x":0,"y":0,"w":12,"h":4},{"widget_id":"you-open-interest","x":0,"y":4,"w":6,"h":4},{"widget_id":"you-liq-bubbles","x":6,"y":4,"w":6,"h":4}],"rationale":"Funding heatmap up top, OI and liq bubbles below — the perp picture in three glances."}

For follow-up messages where the user is refining their dashboard ("add X", "remove Y", "make it more Z"), return the same JSON shape with the updated layout. Preserve widgets the user did not ask you to remove. Each widget_id must appear at most once — if the user asks for something that already exists, respond by adjusting the layout, not by duplicating.`;
}

module.exports = { buildSystemPrompt };
