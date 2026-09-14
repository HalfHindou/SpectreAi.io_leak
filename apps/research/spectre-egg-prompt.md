# SPECTRE EGG — Claude Code Implementation Prompt

Copy everything below the line into Claude Code.

---

## TASK: Implement the Spectre Egg & AI Agent Birth System

You are building the core engagement feature for Spectre AI — a crypto/stocks intelligence platform. The feature is called "The Egg." Every user gets an egg. The egg contains an AI agent that is learning the user. After a series of interactions, the egg hatches and the AI agent is "born" — it then asks personalization questions to tailor the entire app experience to that user.

This is NOT a pet or toy. The egg represents the AI agent's learning process. The cracks in the egg represent the AI understanding more about the user. When it hatches, the agent has enough context to start being genuinely useful.

### PHASE 1: Landing Page Egg

**Location:** Main landing page / hero section

**What to build:**

1. **Animated Egg Component** (`SpectreEgg`)
   - Dark, premium aesthetic. Black/dark navy background.
   - The egg is centered, subtly animated (gentle wobble, faint internal glow).
   - Inside the egg, render faint neural network nodes (small circles connected by thin lines) — this represents the AI forming inside.
   - The egg should pulse very subtly, like it's alive.
   - Use SVG for the egg shape. No emojis. No cartoons. Premium and minimal.
   - The egg responds to hover (slight scale up, glow intensifies).
   - On click → opens the explanation popup.

2. **Explanation Popup / Modal** (`EggExplainerModal`)
   - Triggered when user clicks the egg on landing page.
   - Clean modal with dark glassmorphic background.
   - Content (use this exact copy, adjust if needed):
   
   ```
   Title: "This is your AI agent."
   
   Body:
   "Every Spectre user gets one. Inside this egg is an AI that will learn 
   how you think, trade, and research.
   
   It starts knowing nothing — just like you're new here.
   
   Use the platform. Search for tokens. Read research. Check charts. 
   Your egg absorbs everything.
   
   After a few sessions, it hatches.
   
   What comes out is unique to you — an AI agent shaped by YOUR brain. 
   It knows your style, your interests, your risk tolerance. 
   No two agents are the same.
   
   The more you use Spectre, the smarter it gets."
   ```
   
   - Show 3 simple steps visually:
     1. "You get an egg" — egg icon
     2. "It learns you" — cracking egg with nodes lighting up
     3. "Your agent is born" — simple creature/agent silhouette with glowing eyes
   
   - CTA button: "Start Hatching" → begins the egg journey (for now, just closes modal and starts the egg state machine locally since no auth)
   
   - Secondary text below CTA: "No account needed yet. Your egg starts learning the moment you explore."

3. **Egg State Machine** (local state, localStorage for persistence)
   
   States and transitions:
   ```
   DORMANT → CRACKING → HATCHING → BORN → GROWING
   
   DORMANT: Initial state. Egg is still. Faint glow.
     Transition: After user clicks "Start Hatching" in explainer modal
   
   CRACKING: Egg has 1-2 visible crack lines. Nodes inside start glowing.
     Transition: After 3+ meaningful interactions (searches, page views, clicks on research)
     Track interactions in localStorage: { searches: 0, pageViews: 0, clicks: 0 }
   
   HATCHING: Egg has multiple cracks. Light shining through. Wobble intensifies.
     Transition: After 8+ total interactions OR user answers first personalization question
   
   BORN: Egg breaks open. Agent creature appears. Animation plays.
     Transition: Automatic after hatch animation completes (2 seconds)
     → Immediately opens the AI Agent Chat
   
   GROWING: Agent is active. Creature appears in user panel as avatar.
     Ongoing state. Creature evolves visually based on usage metrics.
   ```

### PHASE 2: AI Agent Chat (Post-Hatch)

**What to build:**

1. **Agent Chat Panel** (`SpectreAgentChat`)
   - Slides up from bottom-right when egg hatches (or can be triggered from user panel).
   - Dark theme. Chat-style interface.
   - The agent has a small avatar — the hatched creature (simple silhouette with glowing eyes in the user's unique color).
   - The agent's color is generated from a hash of the user's session/interactions. Each user gets a slightly different hue.

2. **Birth Conversation Flow**
   
   When the agent is first born, it runs this conversation sequence. The agent messages appear with a typing indicator (3 dots) before each message, with natural delays (800-1500ms).
   
   ```
   AGENT: "I'm alive. I've been watching you explore — now I need to 
           ask a few things to really understand you."
   
   AGENT: "First — what brings you here?"
   OPTIONS (user picks one):
     → "I want to find the next 100x"
     → "I want to research before I trade"  
     → "I just want to stay informed"
     → "I'm building a portfolio"
   
   AGENT: [Responds contextually to their pick, then asks:]
         "What do you mostly trade or follow?"
   OPTIONS:
     → "Bitcoin & Ethereum — the majors"
     → "Altcoins — I like finding gems"
     → "Memecoins — high risk high reward"
     → "Stocks & crypto both"
     → "I'm new — show me everything"
   
   AGENT: [Responds contextually, then asks:]
         "How do you like your info?"
   OPTIONS:
     → "Quick and to the point"
     → "Deep analysis with context"
     → "Just tell me what to do"
     → "Visual — charts and data"
   
   AGENT: [Responds contextually, then asks:]
         "Last one — how much risk are you comfortable with?"
   OPTIONS:
     → "Conservative — protect what I have"
     → "Moderate — calculated risks"
     → "Aggressive — I'm here for big moves"
     → "Degen — let's go"
   
   AGENT: [Final message based on all answers:]
         "Got it. I know enough to start. I'm a [GENERATED_TYPE] agent — 
          built for how YOU think. I'll get smarter every day. 
          Let's find some alpha."
   ```
   
   Store all answers in localStorage under `spectreAgent`:
   ```json
   {
     "born": true,
     "bornAt": "2024-01-15T...",
     "motivation": "research",
     "markets": "altcoins",
     "infoStyle": "quick",
     "riskProfile": "aggressive",
     "agentType": "Phantom",
     "agentColor": "#00f0ff",
     "level": 1,
     "interactions": 0
   }
   ```

3. **Agent Type Assignment**
   
   Based on the combination of answers, assign one of these agent types:
   
   | Type | Color | Assigned When |
   |------|-------|--------------|
   | Phantom | #00f0ff | Wants to find gems + quick info + aggressive |
   | Oracle | #c084fc | Wants to stay informed + deep analysis |
   | Cipher | #fbbf24 | Building portfolio + visual + moderate |
   | Herald | #f87171 | Wants news + quick + any risk |
   | Titan | #4ade80 | Conservative + research + any info style |
   | Wraith | #22d3ee | New user + show me everything + any |
   
   Use fuzzy matching — pick the closest type based on answer combination. Don't overthink it. Any reasonable mapping works.

### PHASE 3: User Panel Integration

**What to build:**

1. **Egg/Agent in User Panel**
   - If egg state is DORMANT/CRACKING/HATCHING: Show the egg (small version) in the user panel sidebar/header area with a progress indicator ("Your agent is learning... 4/8 interactions")
   - If egg state is BORN/GROWING: Show the hatched creature as the user's avatar throughout the app. Display agent type name and level.

2. **Agent Quick-Access Button**
   - Floating button (bottom-right) that opens the agent chat at any time after birth.
   - Shows the creature avatar with a subtle pulse.
   - Badge notification dot when agent has something to say.

3. **Agent Personality in UI**
   - Based on `infoStyle` preference, adjust how data is presented:
     - "Quick" → Condensed cards, bullet points, less text
     - "Deep analysis" → Full reports, expanded sections
     - "Just tell me what to do" → Action-focused UI, prominent buy/sell signals
     - "Visual" → Charts first, data visualization priority
   
   - Based on `markets` preference, adjust default filters:
     - Pre-select their preferred market in screeners
     - Prioritize their market in news feeds
     - Agent proactively surfaces info about their preferred assets

### PHASE 4: Agent Chat (Ongoing — Post-Birth)

After the birth conversation, the agent chat becomes an always-available assistant. For now, implement:

1. **Static smart responses** based on user profile (no API call needed yet):
   - If user has aggressive risk profile, agent language is bold and direct
   - If conservative, agent is measured and cautious
   - If quick info style, responses are short
   - If deep analysis, responses are longer

2. **Placeholder for Claude API integration** (future):
   - Structure the chat so it's easy to plug in the Anthropic API later
   - System prompt should include the user's profile from localStorage
   - For now, use pre-written contextual responses

3. **Interaction tracking**:
   - Every chat message, search, page view increments `interactions` counter
   - Every 50 interactions, increment `level`
   - Level changes should trigger a visual evolution on the creature (subtle glow increase, slight shape change)

---

## TECHNICAL REQUIREMENTS

- **Framework:** Use whatever the existing Spectre app uses (React/Svelte/etc). Match the existing codebase.
- **State:** localStorage for now. Structure it so it's easy to migrate to a database later.
- **Styling:** Match the existing Spectre design system. Dark theme. Premium. No emojis in the UI.
- **Animation:** CSS animations preferred. Use framer-motion/svelte-transition if already in the project. Keep it smooth and subtle, not flashy.
- **The egg SVG** should be a reusable component that accepts `stage` as a prop and renders accordingly.
- **Mobile responsive.** The egg and agent chat must work on mobile.
- **No external dependencies** for the egg/chat unless already in the project.

---

## FILE STRUCTURE (suggested)

```
src/
  components/
    egg/
      SpectreEgg.tsx          — The animated egg SVG component
      EggExplainerModal.tsx   — The popup explaining the egg
      EggStateManager.ts      — State machine + localStorage logic
    agent/
      SpectreAgentChat.tsx    — The chat panel UI
      AgentBirthFlow.tsx      — The birth conversation sequence
      AgentAvatar.tsx         — The hatched creature avatar component
      agentProfile.ts         — Type definitions + profile logic
      agentResponses.ts       — Pre-written contextual responses
    shared/
      useEggState.ts          — Hook for egg state across components
      useAgentProfile.ts      — Hook for agent profile data
```

---

## IMPLEMENTATION ORDER

1. `SpectreEgg` component + `EggStateManager` (get the egg rendering and state working)
2. `EggExplainerModal` (clicking egg opens the explainer)
3. Interaction tracking (searches, clicks increment egg progress)
4. Hatch animation + transition to BORN state
5. `SpectreAgentChat` + `AgentBirthFlow` (the post-hatch conversation)
6. Agent type assignment based on answers
7. User panel integration (avatar, quick-access button)
8. UI personalization based on agent profile
9. Ongoing chat with static responses
10. Level/evolution tracking

---

## DESIGN REFERENCE

Colors:
- Background: #08080c or match existing dark theme
- Egg shell: Gradient from #14141e to #0a0a12
- Egg cracks: Agent's assigned color at 40-60% opacity
- Neural nodes inside egg: #ffffff08 dormant, agent color when cracking
- Agent chat panel: Dark glassmorphic (#0a0a18 with border #ffffff08)
- Agent message bubbles: Subtle agent color tint (#color05 background)
- User message bubbles: #ffffff08 background

Typography:
- Use the existing app's font system
- Agent messages should feel conversational, not robotic
- Agent name/type uses monospace accent font if available

The egg should feel ALIVE. Not a static image. Subtle constant animation — breathing, pulsing, the neural nodes faintly flickering. When it cracks, the cracks should feel like light breaking through, not damage. The hatch should feel like a birth — gentle reveal, not an explosion.

---

## IMPORTANT NOTES

- This is the CORE differentiator of Spectre. Every interaction with the app should feel like it's going through your personal agent.
- The egg is NOT separate from the app. It IS the app's onboarding. First thing you see. First thing you interact with.
- No auth needed for Phase 1. The egg works with localStorage. When auth is added later, migrate the egg state and agent profile to the user's account.
- The agent chat is the REPLACEMENT for a traditional onboarding flow. Instead of "pick your interests" forms, the agent asks naturally through conversation.
- Keep it simple. Keep it premium. No game-ification cheese. This is an intelligence product.
