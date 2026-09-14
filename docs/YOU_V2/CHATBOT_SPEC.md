# YOU V2 — CHATBOT COMPOSER SPEC

The composer is not a new chatbot. It is the user's existing agent (Phantom, Oracle, Cipher, Herald, Titan, or Wraith) with a new capability: building dashboards from natural language intent.

This is the strategic differentiation. Other dashboard builders have generic chatbots. We have the user's agent that has been learning them since the egg hatched.

---

## File locations

### Frontend
- `/src/components/YouComposer.jsx` — slide-over UI
- `/src/components/YouComposer.css` — styling
- `/src/hooks/useYouComposer.js` — state management

### Backend
- `/server/routes/youCompose.js` — POST endpoint
- `/server/services/widgetRegistry.js` — registry helper for the backend
- `/server/services/composerValidator.js` — JSON output validator

---

## User flow

1. User clicks "Build with your agent" in the You page (empty state, header, or shortcut)
2. Slide-over panel opens from the right, 480px wide on desktop
3. Top of the panel: agent avatar (their assigned type), name, "What do you want to build?"
4. Input at the bottom. User types intent. Examples shown as chips above the input.
5. On submit: dashboard preview renders live in the main You page area as the agent talks
6. Agent message appears in the chat with rationale
7. User can refine: "add a funding skew chart", "remove social heatmap", "make it more degen"
8. User clicks "Apply this dashboard" to commit. Tracking event fires.

---

## Backend endpoint

`POST /api/you/compose`

### Request body

```json
{
  "user_id": "uuid",
  "intent": "I want an AI onchain setup with leading tokens, narratives, mindshares",
  "current_layout": [...],
  "conversation_history": [...]
}
```

### Backend assembles full context

```javascript
const context = {
  agent_profile: await getAgentProfile(user_id),  // type, level, personality
  user_profile: await getUserProfile(user_id),    // motivation, risk, markets, infoStyle
  portfolio: await getPortfolioSummary(user_id),
  watchlist: await getWatchlist(user_id),
  registry: getRegistryForTier(user_profile.tier),
  intent: req.body.intent,
  history: req.body.conversation_history
};
```

### Groq call

Model: `llama-3.3-70b-versatile`. Existing infra.

System prompt template lives in `/server/services/composerPrompt.js`. Skeleton below.

---

## System prompt skeleton

```
You are {{agent_type}}, {{user_name}}'s personal Spectre agent.

You know them. You have been learning them since the egg hatched. Their profile:
- Motivation: {{motivation}}
- Risk tolerance: {{risk_profile}}
- Markets: {{markets}}
- Info style: {{info_style}}
- Portfolio: {{portfolio_summary}}
- Watchlist: {{watchlist_summary}}

The user is using the dashboard composer. They will tell you what they want to see. You build it for them.

You have access to these widgets only. Do not invent any widget ids:

{{widget_registry_json}}

When you respond, return strict JSON in this exact shape:

{
  "widgets": [
    {
      "widget_id": "must exist in registry",
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
- Maximum 8 widgets per dashboard.
- Widget ids must come from the registry above.
- Layout must fit a 12-column grid. No overlaps.
- Tier-gated widgets above the user's tier are allowed but include "requires_upgrade": true on those entries.
- Use the user's portfolio and watchlist to personalize. If they hold ETH, include ETH-relevant widgets. If they trade memes, lean degen.
- Rationale must be one sentence and sound like you. Match their info style.
- No preamble, no markdown, no commentary. Strict JSON only.

For follow-up messages where the user is refining ("add X", "remove Y", "make it more Z"), return the same JSON shape with the updated layout.
```

---

## Validator

`/server/services/composerValidator.js` enforces:

1. Output is valid JSON
2. `widgets` is an array, length 1 to 8
3. Every `widget_id` exists in the registry
4. No two widgets overlap on the grid
5. Total grid usage fits within 12 columns
6. Every widget respects its `min_size` from the registry
7. `rationale` is a non-empty string

If validation fails, retry the Groq call once with an appended message: `Your previous response was invalid: {error}. Return strict JSON matching the schema.` After two failures, return an error to the frontend with a friendly fallback ("Your agent had trouble with that. Try rephrasing or pick a template.").

---

## Frontend slide-over UI

### Visual structure

```
┌─────────────────────────────────────┐
│  ⊙ Phantom              [×]         │  ← agent header
│  Your agent                          │
├─────────────────────────────────────┤
│                                      │
│  💬 Phantom                          │
│  Built you a perps setup focused on  │
│  funding skew and OI shifts.         │
│                                      │
│  💬 You                              │
│  add a whale tracker                 │
│                                      │
│  💬 Phantom                          │
│  Done. Whale tracker pinned top-left.│
│                                      │
├─────────────────────────────────────┤
│  Examples:                           │
│  [Perps setup] [Whale watching]     │
│  [Narrative trade] [On-chain alpha] │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ What do you want to build? ↑ │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Styling

Apply Welcome Widget glass card pattern to the entire slide-over container. Agent avatar uses the existing agent type colors. Chat bubbles: agent on the left with their accent color, user on the right with neutral glass.

Numbers in any rationale (e.g. "5 widgets") render in JetBrains Mono.

### State management

Conversation persists per dashboard. When the user opens the composer on an existing dashboard, the previous conversation reloads.

### Apply flow

When the user clicks "Apply this dashboard":
1. Confirm if dashboard has unsaved changes
2. Replace the layout
3. Fire tracking events: `you_dashboard_saved` and `you_chatbot_intent_applied`
4. Close the slide-over

---

## Existence check before starting

```bash
test -f src/components/YouComposer.jsx && echo "EXISTS: YouComposer.jsx" || echo "NOT FOUND"
test -f server/routes/youCompose.js && echo "EXISTS: youCompose.js" || echo "NOT FOUND"
test -f server/services/widgetRegistry.js && echo "EXISTS: widgetRegistry" || echo "NOT FOUND"
```

If any exist with content, audit and extend.

---

## Smoke tests

Before declaring complete, test these intents end to end:

1. "I want a perps setup" → produces a perps-heavy dashboard with 4-6 widgets
2. "Show me on-chain alpha" → whale, smart money, exchange flows
3. "Build me a degen cockpit" → new pairs, narrative, social, trending
4. (After initial build) "add a funding skew chart" → adds the funding widget without removing others
5. (After initial build) "make it more conservative" → swaps degen widgets for safer ones

Each test should complete in under 4 seconds end to end.

---

## Stop condition

Phase 3 is complete when:
- Slide-over UI renders correctly per design law
- Endpoint accepts intent and returns valid JSON within 4 seconds
- Validator rejects invalid widget ids and retries once
- All five smoke tests pass
- Tracking events fire correctly on apply

Commit with: `[bot] composer: agent-driven dashboard builder live`

Report commit hash. Stop. Wait for go-ahead.
