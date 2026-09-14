# SPECTRE AI — SESSION STARTER
# Read this. Nothing else needed to get full context on the project.
# Last updated: Feb 23 2026 | Replaces 3.9MB of raw transcripts

---

## WHAT SPECTRE IS

Spectre AI is a crypto market intelligence platform at spectreai.io.
"AI is the interface" — not a wrapper, an intelligence layer.
Design benchmark: Apple.com × Bloomberg Terminal. Dark, premium, institutional.
Team: Sunny (founder), Alaa (CTO), Evgeniy (frontend). 7 total.
Burn: ~$18K/mo. Revenue: Research Platform, AI Screener, Trading Terminal.
Token holders: 8,000+. Tickers: $SPECT (established), $SPECTRE (trading platforms).

---

## TECH STACK

Frontend: React + TypeScript, Cursor IDE + Claude Opus 4.5
Backend: Express.js proxy server
Desktop: Electron (Spectre Lens overlay)
AI: GPT-4o Vision, Whisper, ElevenLabs, Anthropic Claude
Data: Binance WebSocket (live prices), CoinGecko, Glassnode, CMC, Dexscreener
Payments: GCP, OVH, various API costs
Dev velocity: major features in 24-48h

---

## DESIGN LAW (ABSOLUTE RULES)

Reference file: SPECTRE_DESIGN_LAW.md (read it fully before any UI work)

### Tokens
```
Background:   #000000 (void) → #0c0c0e (base) → #131316 (surface) → #1a1a1f (elevated)
Text:         rgba(255,255,255, 1.0 / 0.72 / 0.48 / 0.32)
Accent:       #8B5CF6 — ONLY for primary CTA + active states
Bull/Bear:    #10B981 / #EF4444 — NEVER decorative
Fonts:        Space Grotesk (headings) / Inter (body) / JetBrains Mono (ALL numbers)
Radius:       8 / 12 / 16 / 24px
```

### Glass Card (copy exactly)
```css
background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
border: 1px solid rgba(255,255,255,0.2);
border-radius: 24px;
box-shadow:
  inset 0 0 0 1px rgba(255,255,255,0.12),
  inset 0 1px 0 rgba(255,255,255,0.18),
  inset 0 -1px 0 rgba(255,255,255,0.06),
  inset 0 0 24px -8px rgba(255,255,255,0.06),
  0 4px 12px rgba(0,0,0,0.4),
  0 8px 24px rgba(0,0,0,0.3);
```

### Hard rules
- Numbers = JetBrains Mono. Always. No exceptions.
- Icons = spectreIcons.jsx ONLY. No Lucide, no Heroicons, no FontAwesome.
- Purple is earned. Only CTAs and active states.
- AI is invisible. Never badge "AI-generated" or "Powered by AI".
- Hover = translateY(-2px) + shadow increase. Always.
- Day mode is mandatory on every new component.
- Loading = skeleton shimmer. Never spinners.
- Easing: cubic-bezier(0.16, 1, 0.3, 1) — never `ease` or `linear`.
- WelcomePage.jsx is the visual north star. Match it.

### Instant failures (never do these)
Bright gradients, neon glows, robot/brain icons, colorful pill badges,
blue as primary color, emojis as UI, flat shadowless cards, AI labels,
Tailwind default colors, sans-serif for numbers.

---

## PRODUCT MAP

### 1. Main Web App (spectreai.io)
Live price ticker strip at top. Browser-like tab navigation with persistent state.
Whisper Search (voice-activated). AI Brief Voice Mode (ElevenLabs TTS).

### 2. Intelligence Hub (spectreai.io/intelligence)
Autonomous publishing infrastructure. Three agents running 24/7:
- News Curator Agent (every 30 min)
- Breaking News Agent (every 10 min)  
- Daily Brief Agent
Output: 53+ pages/day (daily briefs, 25 crypto analyses, 27 stock analyses)
Cost: ~$0.53/day using Perplexity Sonar Pro API
SEO infra: JSON-LD, Open Graph, RSS, sitemap.xml, llms.txt
Storage: JSON files in server/content/articles/
Goal: become origin/primary source for AI models (like CoinGecko/Glassnode status)

### 3. AI Screener
Token discovery with AI-powered analysis.

### 4. Trading Terminal
Live data, charts, order flow.

### 5. Fear & Greed Page
Current: gauge + contributing factors + top movers
Planned upgrades (prompt file: FEAR_GREED_UPGRADE.md):
- Annotated chart events (LUNA, FTX, ETF, Halving etc.)
- Regime zone coloring (Capitulation/Fear/Neutral/Greed/Euphoria)
- Historical forward returns table ("when F&G was 0-20, BTC returned +42% in 90d")
- Distribution histogram (how rare is current reading)
- Spectre Verdict (Claude-generated editorial paragraph, Playfair Display, streams in)

### 6. Spectre Lens (Desktop Overlay)
Electron app. Reads crypto platforms on screen via GPT-4o Vision.
Voice queries via Whisper. Voice responses via ElevenLabs.
Lives above Mac camera notch, Dynamic Island style.

### 7. Creative Studio (Spectre Wall)
Full-screen customisable canvas.
8 themes: Pro, Apple, Graffiti, Minimal, Void, Neon, Art Deco, Street Art
Real-time Binance WebSocket data in stickers.
40+ sticker types. Drag-drop. Media embeds (YouTube/Twitch/podcast).
Publishing: share as image/link.

### 8. Trader's Corner
Modular drag-drop widget dashboard. "Flubber" fluid reflow.
Liquidation charts, watchlist, ETF flows, smart money, ghost mode.

### 9. Spectre YOU
Personalised modular dashboard. Behavioral AI adapts layout to usage patterns.
Drag-drop widgets. Shareable setups.

### 10. Chrome Extension
Token detection on any page. Quick price overlay. Watchlist access.

### 11. Ventures (Planned)
DeFi token discovery reframed as VC-style startup investing.
Due diligence approach, not casino-floor aesthetics.

---

## DATA ARCHITECTURE

### API tier (proxy server pattern)
```
Binance WebSocket → live prices (always active)
CoinGecko API    → market data, token info
Glassnode API    → on-chain data
CMC API          → Fear & Greed, global market
Dexscreener      → DEX data, new pairs
Perplexity Sonar → Intelligence Hub article generation
```

### Caching strategy
Short-lived: prices (real-time via WS)
Medium: F&G, market data (2-5 min)
Long: Intelligence articles (30 min), Verdicts (30 min)

---

## ACTIVE COMMUNITY

Telegram private whale group. Key members: Hans, UpOnlyGreg, Damian.
These users provide market signal and product feedback.

---

## STRATEGIC POSITIONING

Spectre is NOT a trading tool. It is intelligence infrastructure.
"We are becoming the origin of the data" — not consumers of other platforms' data.
Target: professional investors, not traders.
Moat: original content generation + cross-platform behavioral insights + AISEO dominance.

Dual distribution:
- Human users: research, screener, terminal
- AI agents: paid API via x402 (micropayments per signal call) — PLANNED

---

## KEY PENDING TASKS

1. Add spectreai.io to Bing Webmasters + submit sitemap (post Intelligence Hub deploy)
2. Fear & Greed upgrades (see FEAR_GREED_UPGRADE.md)
3. x402 agent API layer — expose signals as paid API endpoints for autonomous agents
4. Ventures subpage
5. Stocks/commodities expansion (screener + tokenized assets)

---

## HOW TO START ANY CLAUDE CODE SESSION

1. Read SPECTRE_DESIGN_LAW.md fully (mandatory before any UI work)
2. Read src/index.css for exact CSS variable values
3. Read src/icons/spectreIcons.jsx — use ONLY these icons
4. Read src/components/WelcomePage.jsx — this is the visual reference
5. Find the existing component you're modifying before writing new code
6. Match first. Elevate second.

DO NOT start a new session by pasting old code. Reference files directly.
DO NOT open more than one major feature per session.
DO NOT let a single conversation exceed ~100 back-and-forth turns.

---

## SESSION HYGIENE (keep Claude Code fast)

- One feature per conversation. Start fresh for each major task.
- Reference SPECTRE_DESIGN_LAW.md via project file — don't paste it into prompts.
- When a rebuild is complete, close the conversation. Don't continue iterating in the same thread.
- Archive any conversation older than 7 days from active context.
- Keep prompts focused: component name + what to build + any constraints. That's it.

---

## WRITING & COPY — NO AI ACCENT

Every word Spectre outputs must sound like a senior analyst, not an LLM.
Based on https://github.com/blader/humanizer (3.9k stars, Wikipedia AI Cleanup guide).

### Banned vocabulary (never use these words)
testament, landscape, showcasing, pivotal, transformative, groundbreaking, revolutionary,
delve, boundaries, realm, foster, leverage (as verb), game-changer, synergy, streamline,
robust, comprehensive, seamlessly, innovative, cutting-edge, unlock, empower, elevate,
nestled, thriving, nuanced, multifaceted, underscoring, highlighting, it's worth noting,
importantly, certainly, absolutely, harnessing, reimagining, ecosystem (when vague)

### Banned structures
- Em dash overuse: "this—like most things—matters" → rewrite the sentence
- No em dashes in UI copy, labels, tooltips, X posts, or any Spectre-authored text
- Rule of three padding: "innovation, inspiration, and insights" → say one thing well
- Negative parallelism: "It's not just X, it's Y" → state the point directly
- Significance inflation: "marking a pivotal moment in the evolution of..." → cut to the fact
- Vague attribution: "experts believe" → name the source or cut it
- Formulaic challenges: "Despite challenges, continues to thrive" → specific facts only
- Chatbot artifacts: "I hope this helps!", "Great question!", "Let me know if..." → never
- Generic conclusions: "The future looks bright" → specific plans or remove entirely
- Sycophantic openers: "Absolutely!", "Certainly!", "Of course!" → respond directly
- Excessive hedging: "could potentially possibly" → "may"
- Filler: "In order to" → "To" / "Due to the fact that" → "Because"
- Synonym cycling: don't rotate "protagonist/main character/central figure" → pick one
- Promotional puffery: "nestled within the breathtaking region" → "is a city in..."
- Superficial -ing clauses: "symbolizing... reflecting... showcasing..." → cut or use specific fact
- Bold decoration: never "**Speed:** faster" → write prose
- Inline-header lists: "**Performance:** improved" → write a sentence

### The test
Read it aloud. If it sounds like a chatbot wrote it — rewrite it.
Spectre copy sounds like a portfolio manager's 3am Telegram message to a whale group:
specific, direct, no filler, no performance of intelligence.

### Install the humanizer skill in Claude Code
git clone https://github.com/blader/humanizer.git ~/.claude/skills/humanizer
Then in Claude Code: /humanizer [paste copy here]
