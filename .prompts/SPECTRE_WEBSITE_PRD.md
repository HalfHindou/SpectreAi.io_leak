# SPECTRE AI — WEBSITE REDESIGN PRD
## From outdated marketing site → the Beta launch site for multi-asset intelligence

---

## 1. THE THESIS

### Why this site exists

There's a gap in the market. On the left side you have social chaos: Discord, X/CT, Telegram, Reddit. Raw takes, noise, alpha mixed with garbage. On the right side you have data fortresses: Nansen, DeFiLlama, Dune, Messari, Bloomberg Terminal. Clean numbers, no narrative, no context for what they mean.

Nobody sits in the middle. Nobody takes the social signal AND the on-chain data AND the macro picture AND the market structure and synthesizes it into intelligence that an investor can act on in 90 seconds. Across crypto, stocks, AND commodities.

That's Spectre. And the website's job is to make that gap visible and obvious, then prove that Spectre fills it. This is the Beta launch site. The product is being opened to early users for the first time.

### What the old site got wrong

- Generic stock-photo hero (woman at laptop). No product anywhere above the fold.
- "AI Market Intelligence for Stocks & Crypto" — accurate but forgettable. Could be 50 other projects.
- Feature cards were descriptive, not demonstrative. Told you WHAT, never showed you WHY.
- Token section felt bolted on. No narrative connecting product value to token utility.
- Roadmap was a vertical timeline with quarter labels. Standard, forgettable.
- "What our users say" with first-name-and-initial testimonials. No proof of real usage.
- Architecture diagram was interesting but positioned too early — nobody cares about plumbing before they understand the output.

### What the new site must do

1. **Create urgency around the Beta.** This isn't "check out our live app." This is "the Beta is opening. Get in early." Waitlist energy with product proof.
2. **Show the product's range immediately.** Crypto, Stocks, Commodities, Macro. Not a crypto-only tool. Multi-asset intelligence.
3. **Make the market gap visceral.** The "People live here / Data lives here / Nobody is here" concept needs to be the central narrative, not a standalone graphic.
4. **Sell the WHY before the HOW.** Why does this matter to an investor's actual workflow? What decisions does Spectre change?
5. **Speak to BOTH new and seasoned investors.** New investors need "this replaces 5 tabs." Seasoned investors need "this shows me what I can't find anywhere else." The site must land for both without dumbing down or overcomplicating.
6. **Make the token feel like a membership, not a casino.** $SPECT unlocks intelligence tiers, not yield farming.
7. **Show credibility without claiming it.** Partners, product screenshots, real platform capabilities, real metrics.
8. **Convert three audiences simultaneously.** Investors who want to join the Beta + holders who want to understand $SPECT value accrual + builders who want coverage.

---

## 2. TARGET AUDIENCES

| Audience | What they need to see | Conversion goal |
|----------|----------------------|-----------------|
| **New investor** (just getting started) | Simple value prop, "replaces 5 apps," approachable UI, education angle | Join Beta waitlist → explore free tier |
| **Seasoned crypto trader** (daily/swing) | AI Brief depth, on-chain data, social pulse, liquidation heatmaps, speed | Join Beta → power user → $SPECT holder |
| **Stock/macro investor** (cross-asset) | Stocks + Crypto + Commodities coverage, macro context, economic calendar | Join Beta → multi-asset workflow |
| **$SPECT holder / potential buyer** | Token utility, tier access, roadmap, team credibility | Buy $SPECT → hold for access tier |
| **Crypto fund / institutional** | Data sources, coverage breadth, AI agents, API potential, team | Contact / partnership inquiry |
| **Builder / developer** | Builder Score, GitHub tracking, open data philosophy | Integrate / partner / list their project |

**The dual investor angle:** The site must never feel like it's only for degens or only for beginners. New investors should feel invited. Seasoned investors should feel respected. The product handles both because the intelligence adapts to context.

---

## 3. SITE STRUCTURE — SECTION BY SECTION

### Section 0: STICKY NAV
**Always visible. Glass blur. Minimal.**

```
[Spectre AI logo]    Home · Why · Platform · Token · Roadmap · Team · Partners    [Day/Night] [Join Beta →] [Buy $SPECT]
```

- Logo: Spectre wordmark + ghost icon. Left-aligned.
- Navigation: Center. Text links, no dropdowns. Active state = dot indicator (like current site, keep that).
- Right: Day/night toggle (sun/moon), "Open App" (primary accent button), "Buy $SPECT" (ghost button with accent border).
- Mobile: Hamburger. Two sticky CTAs remain visible at all times.
- On scroll: Nav compresses slightly, blur intensifies. Never disappears.

---

### Section 1: HERO — "The Beta is open. The product IS the pitch"

**Concept:** Split hero. Left = copy + CTAs + live ticker. Right = high-fidelity product screenshots (animated carousel or video loop showing Command Center, Research Zone, Heatmaps cycling). Beta energy: exclusive, early access, limited.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  Live ticker: BTC $66,458 ▼3.1%  ETH $2,004 ▼3.0%  AAPL $178 ▲0.4%  GOLD $2,340 ▲0.2%  →  │
├────────────────────────────┬────────────────────────────────┤
│                            │                                │
│  Eyebrow:                  │    ┌──────────────────────┐    │
│  BETA NOW OPEN             │    │                      │    │
│                            │    │   Product screenshot  │    │
│  Headline:                 │    │   carousel showing    │    │
│  Market intelligence       │    │   Command Center →    │    │
│  that doesn't exist        │    │   Research Zone →     │    │
│  anywhere else.            │    │   Heatmaps →          │    │
│                            │    │   X Dashboard         │    │
│  Sub: Crypto. Stocks.      │    │                      │    │
│  Commodities. Macro.       │    └──────────────────────┘    │
│  50,000+ assets. 500+      │                                │
│  data sources. AI that     │    CA: 0x9cf0...dad6           │
│  reads the whole market.   │    [Copy] one click            │
│                            │                                │
│  [Join the Beta →]         │                                │
│  [Buy $SPECT]              │                                │
│                            │                                │
│  "2,400+ early users on    │                                │
│   the waitlist"            │                                │
│                            │                                │
└────────────────────────────┴────────────────────────────────┘
```

**Copy:**
- Eyebrow: `BETA NOW OPEN` (accent pill badge, mono font)
- Headline: `Market intelligence that doesn't exist anywhere else.` (Space Grotesk, 4rem+, tight tracking)
- Subline: `Crypto. Stocks. Commodities. Macro. 50,000+ assets tracked. 500+ data sources. AI agents that read the whole market so you don't have to.` (Inter, secondary opacity)
- CTAs: `Join the Beta →` (primary, large) + `Buy $SPECT` (ghost, purple border)
- Below CTAs: Social proof line: `2,400+ early users on the waitlist` or similar
- Contract address: Visible but secondary. Mono font. One-click copy with toast confirmation.

**The product showcase:**
- Animated screenshot sequence showing Command Center → AI Brief → Research Zone → Heatmaps → X Dashboard → Stock Mode (auto-cycling every 4s with crossfade)
- Must show REAL product screenshots, not mockups. The product sells itself.
- Include BOTH crypto and stock views to immediately signal multi-asset coverage.

**Live ticker must include:** BTC, ETH, SOL (crypto) + AAPL, NVDA, SPY (stocks) + Gold (commodities). This immediately signals breadth.

**Mobile:** Stack vertically. Copy on top, product screenshot below (static, optimized image). CTAs stay sticky at bottom of viewport.

---

### Section 2: THE GAP — "Where Spectre lives"

**This is the storytelling section. Based on your market positioning diagram.**

**Concept:** Interactive or animated visualization of the market landscape. Two worlds that don't talk to each other — and Spectre in the convergence zone. This isn't just crypto anymore. It's the entire market.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              The market is split in two.                     │
│                                                             │
│  ┌──────────────┐         SPECTRE         ┌──────────────┐  │
│  │              │          sits            │              │  │
│  │   SOCIAL     │         here.            │    DATA      │  │
│  │   CHAOS      │                          │  FORTRESSES  │  │
│  │              │    ┌──────────────┐      │              │  │
│  │  Discord     │    │ Social signal│      │  Nansen      │  │
│  │  X / CT      │    │ + On-chain   │      │  DeFiLlama   │  │
│  │  Telegram    │    │ + Macro      │      │  Dune        │  │
│  │  Reddit      │    │ + Market     │      │  Messari     │  │
│  │  FinTwit     │    │ + AI synth   │      │  Bloomberg   │  │
│  │              │    │ = Action     │      │              │  │
│  └──────────────┘    └──────────────┘      └──────────────┘  │
│                                                             │
│   ↑ People live here         ↑ Nobody was here              │
│   Strong signal, no depth    Deep data, no narrative         │
│                                                             │
│     "Spectre is the convergence. Social signal meets         │
│      on-chain truth meets macro context meets AI synthesis.  │
│      Across crypto, stocks, and commodities."                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Animation:** On scroll enter, the two sides slide in from left and right. Spectre fades up in the center. Connecting lines draw from both sides into the center node. The platform names (Discord, Nansen, etc.) appear with stagger.

**Copy:**
- Header: `The market is split in two.` (Playfair Display, editorial weight — this is a thesis statement)
- Left label: `Where the conversation happens` — Discord, X/CT, Telegram, Reddit, FinTwit
- Right label: `Where the data lives` — Nansen, DeFiLlama, Dune, Messari, Bloomberg
- Center: `Spectre converges both.`
- Supporting: `Social signal meets on-chain truth meets macro context meets AI synthesis. Across crypto, stocks, and commodities. One layer. The intelligence you'd build if you had 30 analysts and every data feed wired together.`

---

### Section 3: WHY SPECTRE — Three pillars

**Concept:** Three cards, each answering a trader's real question. Not "what features" but "what changes in my day."

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│         Why traders check Spectre before anything else.      │
│                                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐│
│  │                 │ │                 │ │                 ││
│  │  01             │ │  02             │ │  03             ││
│  │  Wake up        │ │  See what       │ │  Move before    ││
│  │  smarter        │ │  others miss    │ │  the crowd      ││
│  │                 │ │                 │ │                 ││
│  │  Every morning, │ │  50,000+ tokens │ │  Real-time      ││
│  │  an AI brief    │ │  tracked across │ │  liquidation    ││
│  │  tells you what │ │  500+ sources.  │ │  tracking,      ││
│  │  moved, what's  │ │  Research that  │ │  whale alerts,  ││
│  │  building, and  │ │  takes analysts │ │  social pulse   ││
│  │  what matters   │ │  hours.         │ │  monitoring.    ││
│  │  today.         │ │  Delivered in   │ │  Know when      ││
│  │                 │ │  seconds.       │ │  sentiment      ││
│  │  Just signal.   │ │                 │ │  shifts before  ││
│  │  No noise.      │ │                 │ │  price follows. ││
│  │                 │ │                 │ │                 ││
│  │  · AI Brief     │ │  · Research     │ │  · Liquidation  ││
│  │  · Fear & Greed │ │  · Token Detail │ │  · Social Pulse ││
│  │  · Macro events │ │  · On-chain     │ │  · Whale alerts ││
│  │                 │ │  · AI patterns  │ │  · Smart alerts ││
│  └─────────────────┘ └─────────────────┘ └─────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Design:** Glass cards with colored top border (subtle gradient: green, blue, purple). Number "01" in accent color. Feature pills at bottom of each card.

---

### Section 4: PRODUCT SHOWCASE — "See what you get"

**Concept:** Full-width interactive showcase. Not a feature list — a guided walkthrough organized by WHAT YOU DO, not by tool name. Tab-based or scroll-driven. This is the biggest section on the page because the product scope is massive.

**Header:** `One platform. Every market. Every signal.`

**Sub-header:** `Crypto. Stocks. Commodities. Macro. Discovery. Social. AI. All connected.`

**Layout: Two levels — Market Coverage strip + Category deep dives**

**Level 1: Markets covered (horizontal strip)**
```
┌─────────────────────────────────────────────────────────────┐
│  [● Crypto]  [● Stocks]  [● Commodities]  [● Macro]        │
│                                                             │
│  50,000+ tokens · 35+ major stocks · Gold, Oil, FX ·        │
│  Fed, CPI, earnings calendar                                 │
└─────────────────────────────────────────────────────────────┘
```

**Level 2: Product categories (tab-driven showcase)**

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [Command Center] [Research & Discovery] [Trading]          │
│  [Intelligence & News] [Social & X] [Visualization]         │
│  [AI Agents & Models] [Macro & Calendar]                    │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │   COMMAND CENTER                                       │  │
│  │   Your daily briefing                                  │  │
│  │                                                        │  │
│  │   [Real screenshot — desktop + mobile side by side]    │  │
│  │                                                        │  │
│  │   AI-generated market briefs, sentiment gauges,        │  │
│  │   watchlist snapshots, macro context. Audio briefs.    │  │
│  │                                                        │  │
│  │   Tools: AI Brief · Fear & Greed · Watchlist Overview  │  │
│  │          Market Stats · Macro Context · GM Dashboard   │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**ALL 8 categories with their tools:**

**1. Command Center** — Your daily briefing
- AI Morning Brief (listenable)
- Fear & Greed Index with historical context
- Watchlist Overview (crypto + stock watchlists)
- Market Stats + Dominance
- Macro Context
- GM Dashboard (zen morning view)
- Screenshot: Show the brief + F&G gauge + watchlist sidebar

**2. Research & Discovery** — Deep dive on any asset
- Research Zone (full token research: chart, metrics, on-chain, news, tweets, about)
- Token Deep Dive / Storybook (cinematic token biography)
- Discover page (editorial token discovery with breathing charts)
- Search Engine (unified search across all assets)
- Categories browser (DeFi, AI, Meme, RWA, L2, Gaming, etc.)
- Glossary (crypto/DeFi terminology)
- Screenshot: Show Research Zone with chart + metrics + news panel

**3. Trading Tools** — Professional-grade
- AI Charts (canvas-rendered, multi-timeframe)
- AI Charts Lab (experimental pattern detection)
- Trader's Corner (modular widget dashboard)
- Liquidation Heatmap (where leverage is stacked)
- Trading Lite (simplified DeFi swap interface)
- ROI Calculator
- Screenshot: Show AI Charts + liquidation heatmap

**4. Intelligence & News** — Real-time information engine
- Intelligence Hub / Spectre Edition (AI-generated original articles)
- Breaking News feed (updated every 10 min)
- Daily Brief (AI-written market summary)
- Deep Analysis (on-chain triggered research)
- News aggregation (CryptoPanic, NewsAPI)
- Screenshot: Show Intelligence Hub with article cards

**5. Social & X (Twitter)** — See the conversation, quantified
- X Dashboard (social volume, trending cashtags)
- X Bubbles (visual social volume by token)
- Social Zone (community feed, sentiment)
- Social Pulse / Mindshare tracking
- Narrative detection (what stories are building)
- Chrome Extension (Spectre Lens — overlays intelligence on X)
- Screenshot: Show X Dashboard + Bubbles visualization

**6. Visualization** — See the market
- Heatmaps (sector/category market view)
- Bubble Charts (market cap visualization)
- 3D Globe (capital flows between exchanges)
- Economic Calendar
- Ventures / Tokenized Assets tracker
- Screenshot: Show heatmap + 3D globe

**7. AI Agents & Models** — Autonomous intelligence
- Monarch AI Chat (conversational market assistant with @mention)
- AI Market Analysis (automated sector thesis)
- GM Dashboard AI (personalized morning brief)
- OpenClaw agent system (14 agents across 7 departments)
- Spectre Agent (gamified AI companion — Hatchling → Apex)
- Screenshot: Show Monarch Chat with @mention + agent response

**8. Macro & Calendar** — The big picture
- Economic Calendar (Fed, CPI, earnings, FOMC)
- Market indices (S&P 500, Dow, Nasdaq, VIX)
- Stock mode (full equity coverage with movers, sectors)
- Commodities tracking (Gold, Oil, FX pairs)
- US Market status (open/closed indicator with countdown)
- Screenshot: Show economic calendar + stock movers

**Total count: 38+ individual tools across 8 categories.**

**Each tab must use REAL screenshots from the product. Not mockups. Show desktop AND mobile where applicable.**

**Design:** Glass card container for each category. Category icon + name + brief tagline. Tool names as subtle pills at the bottom of each card. The screenshot is the hero of each card — large, centered, with a subtle browser chrome or device frame.

---

### Section 5: INTELLIGENCE FEED PREVIEW — "Content as proof"

**Concept:** Live or near-live preview of Intelligence Hub content. Shows that Spectre generates original intelligence, not aggregated noise.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     Original research. Not aggregated news.                  │
│                                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐│
│  │ BREAKING        │ │ DAILY BRIEF     │ │ DEEP ANALYSIS   ││
│  │                 │ │                 │ │                 ││
│  │ Updated every   │ │ Every session   │ │ Continuous,     ││
│  │ 10 minutes      │ │ open            │ │ on-chain        ││
│  │                 │ │                 │ │ triggered       ││
│  │ [Latest card]   │ │ [Latest card]   │ │ [Latest card]   ││
│  │                 │ │                 │ │                 ││
│  └─────────────────┘ └─────────────────┘ └─────────────────┘│
│                                                             │
│              Read the Intelligence Hub →                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Data source:** Fetch latest 3 articles from Intelligence Hub API/RSS. Show real headlines, real timestamps, real category badges. If API unavailable, show curated best-of with links.

---

### Section 6: HOW IT WORKS — Architecture (simplified)

**Concept:** The "Data in. Intelligence out." diagram from the current site — but better. Animated, interactive, and positioned AFTER people understand WHY they care. Now reflects multi-asset scope.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              Data in. Intelligence out.                       │
│                                                             │
│  INPUTS                 ENGINE              OUTPUTS          │
│                                                             │
│  Market Data ─────┐                  ┌──── Command Center   │
│  (Crypto, Stocks,  │                  │                      │
│   Commodities)    │                  ├──── Research Zone     │
│                   ├──── Spectre AI ──┤                      │
│  News & Social ───┤   Processing     ├──── Intelligence Hub  │
│  (X, CryptoPanic, │   Engine         │                      │
│   FinTwit, Reddit)│                  ├──── Social Pulse      │
│                   │                  │                      │
│  On-Chain ────────┤                  ├──── Heatmaps & Viz   │
│  (Codex GraphQL)  │                  │                      │
│                   │                  └──── AI Agents         │
│  Macro & Econ ────┤                                         │
│  (Fed, CPI, FX)   │                                         │
│                   │                                         │
│  Whale Tracking ──┘                                         │
│                                                             │
│  2,400+ beta users · 50,000+ assets · 500+ sources          │
│  24/7 AI monitoring · 38+ tools · 8 languages                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Animation:** Lines draw from left inputs to center engine, then from engine to right outputs. Each node pulses on draw. Stats counter at bottom animates up from 0.

---

### Section 7: DESKTOP + MOBILE SHOWCASE

**Concept:** Show the product on both form factors. Not just "we're responsive" — show that mobile is a different instrument for the same intelligence.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     Intelligence. Everywhere.                                │
│                                                             │
│  ┌───────────────────────────┐    ┌───────┐  ┌───────┐     │
│  │                           │    │       │  │       │     │
│  │   Desktop view            │    │ Mobile│  │ Mobile│     │
│  │   (full Command Center)   │    │ view  │  │ view  │     │
│  │                           │    │  (AI  │  │(token │     │
│  │                           │    │ Brief)│  │ page) │     │
│  │                           │    │       │  │       │     │
│  └───────────────────────────┘    └───────┘  └───────┘     │
│                                                             │
│  Desktop: Full command center with multi-panel workspace.    │
│  Mobile: Same intelligence, designed for one-hand use.       │
│                                                             │
│  Available on web. Mac app. iOS + Android coming Q3 2026.    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Day/Night toggle here too.** Show both themes. Dark = default hero shot. Toggle animates to day mode version of the same screen. This proves design polish and builds trust.

**Multi-asset proof:** Show crypto mode AND stock mode screenshots side by side. This is where visitors realize this isn't another crypto-only tool.

---

### Section 8: $SPECT TOKEN — "Membership, not speculation"

**Concept:** Token section reframed as access tiers, not tokenomics charts. The token IS your subscription. Hold more = unlock more.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                     $SPECT Token                             │
│                                                             │
│  The native token powering the Spectre AI ecosystem.         │
│  Hold $SPECT to unlock premium intelligence tiers.           │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ TOTAL    │  │ TYPE     │  │ NETWORK  │                  │
│  │ SUPPLY   │  │          │  │          │                  │
│  │ 1B       │  │ ERC-20   │  │ Ethereum │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│                                                             │
│  ACCESS TIERS                                               │
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │   STARTER    │ │     PRO      │ │    ELITE     │        │
│  │   500+       │ │   1,000+     │ │   7,000+     │        │
│  │   $SPECT     │ │   $SPECT     │ │   $SPECT     │        │
│  │              │ │              │ │              │        │
│  │ Core dash    │ │ + Whale      │ │ + Full API   │        │
│  │ Basic AI     │ │   alerts     │ │ + Institu-   │        │
│  │ Multi-chain  │ │ + Premium    │ │   tional     │        │
│  │              │ │   agents     │ │ + Custom     │        │
│  │              │ │              │ │   reports    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                             │
│  Pay with $SPECT and save 10% on all tiers.                 │
│                                                             │
│  [Buy on Uniswap ↗]                                        │
│                                                             │
│  CA: 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6  [Copy]     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Design:** Tier cards with gradient borders (left to right: subtle → brighter). Elite card gets a faint accent glow. CA always visible, always one-click copyable.

---

### Section 9: ROADMAP — "What's next"

**Concept:** Keep the current zigzag timeline aesthetic (it works) but update milestones. Q1 should be highlighted as CURRENT/DONE.

```
Q1 2026 — Platform Launch ✓ (highlighted, accent card)
  Core dashboard, AI agents, multi-chain data, real-time intelligence

Q2 2026 — Trading Terminal
  Advanced charts, whale tracking, liquidation heatmaps, order flow

Q3 2026 — Mobile App
  iOS + Android native, push alerts, biometric security

Q4 2026 — Institutional Suite
  Custom reports, API access, portfolio analytics, white-label
```

**Design:** Keep the flowing S-curve path between cards. Q1 card is glass with accent border (completed). Others are ghost/outline. Each card has quarter label, bold title, 1-line description.

---

### Section 10: TEAM

**Concept:** Not headshots and LinkedIn links. Show the team as builders. Brief, credible, human.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    Built by traders.                          │
│                    For traders.                               │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │          │ │          │ │          │ │          │       │
│  │  Sunny   │ │  Alaa    │ │ Haitham  │ │ Evgeniy  │       │
│  │  CEO     │ │  CTO     │ │ Backend  │ │ Frontend │       │
│  │  Founder │ │          │ │          │ │          │       │
│  │          │ │          │ │          │ │          │       │
│  │  [X] [TG]│ │  [X]     │ │          │ │          │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                             │
│  Google for Startups · NVIDIA Inception cohort               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Design:** Clean glass cards. Avatar or stylized initial. Name, role, optional 1-line bio. Social links where applicable. Partner badges below as a credibility strip.

---

### Section 11: PARTNERS & CREDIBILITY

**Concept:** Logo strip. No "backed by" or "trusted by" labels. The logos speak.

```
Google for Startups · NVIDIA Inception · Bitquery · TradingView · Chainstack
```

**Design:** Monochrome logos on glass strip. Subtle hover brightens each logo. Minimal — these exist to build trust, not to be the story.

---

### Section 12: SOCIAL PROOF — Real usage, not quotes

**Concept:** Instead of fake testimonials, show real metrics + real community.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  2,400+  │ │ 50,000+  │ │   500+   │ │   24/7   │       │
│  │  Active  │ │  Tokens  │ │   Data   │ │    AI    │       │
│  │  Traders │ │  Tracked │ │  Sources │ │ Running  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                             │
│  Join the community                                         │
│  [X / Twitter] [Telegram] [Discord] [YouTube]               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Optional testimonials:** If you want to keep them, make them verifiable — link to actual X posts or use embedded tweets. Or rotate them out entirely in favor of the metrics.

---

### Section 13: WAITLIST / EMAIL CAPTURE

**Concept:** Dual purpose: Beta waitlist for those who want access + content hook for those who want intelligence first.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     Get early access + the daily AI brief in your inbox.     │
│     Free. No spam. Just signal.                              │
│                                                             │
│     [your@email.com          ] [Join Beta →]                 │
│                                                             │
│     Or just get the brief: [Subscribe to Intelligence →]     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Two paths:** One for Beta access (app access), one for intelligence subscription (content only). Both capture email. Both build the funnel.

---

### Section 14: FINAL CTA — The close

**Concept:** Full-bleed dark section. Maximum gravitas. Beta urgency.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│        The Beta is open.                                     │
│        Early users shape what gets built next.               │
│                                                             │
│        [Join the Beta →]        [Buy $SPECT]                 │
│                                                             │
│  Spectre AI is a market intelligence tool.                   │
│  Nothing here is financial advice.                           │
│  Always do your own research.                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Section 15: FOOTER

```
┌─────────────────────────────────────────────────────────────┐
│  Spectre AI                Platform · Token · Docs · Intel   │
│                                                             │
│  © 2026 Spectre AI         X · Telegram · Discord · YouTube │
│                                                             │
│  CA: 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6    [Copy]   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. CREATIVE DIRECTION

### Visual Identity

The website must look like it was designed by the same team that built the app. Same design system. Same glass morphism. Same typography. Same color tokens. The SPECTRE_DESIGN_LAW.md governs everything.

**Dark mode = default.** Day mode available via toggle. Dark is the personality. Day is the option.

### Typography Hierarchy for the Website

| Element | Font | Size | Weight | Notes |
|---------|------|------|--------|-------|
| Hero headline | Space Grotesk | 4rem+ (desktop), 2.5rem (mobile) | 700 | Letter-spacing: -0.04em |
| Section headlines | Space Grotesk | 2.5-3rem | 700 | Tight tracking |
| Editorial moments | Playfair Display | 2rem | 400 italic | For thesis statements, quotes |
| Body copy | Inter | 1rem-1.125rem | 400 | Opacity 0.72 |
| Labels / eyebrows | Inter | 0.6875rem | 600 | Uppercase, letter-spacing 0.1em |
| Numbers / stats | JetBrains Mono | varies | 700 | ALL numbers. Always. |
| CA / addresses | JetBrains Mono | 0.75rem | 400 | Truncated with copy button |

### Color System

Exactly as defined in SPECTRE_DESIGN_LAW.md. No new colors. No deviations.
- Backgrounds: void → base → surface → elevated
- Text: primary (1.0) → secondary (0.72) → tertiary (0.48) → muted (0.32)
- Accent: #8B5CF6 purple. Sparingly. CTAs and active states only.
- Semantic: #10B981 green (gains), #EF4444 red (losses). Never decorative.

### Animation & Motion

**Three tiers of intensity (as previously discussed):**

| Zone | Intensity | Techniques |
|------|-----------|------------|
| Above the fold | Controlled cinema | Timed entrance sequence, not scroll-triggered. App embed product-reveal with deceleration. Token cards enter with intent. |
| Middle sections | Medium-aggressive | Cards deal in with slight rotation offset. Architecture lines draw themselves. Numbers count up. |
| Lower sections | Maximum | Playfair quote typewriter effect. Final CTA ambient particles. Word-by-word headline. |

**Cursor system:**
- Default: Small dot that follows instantly + larger purple ring that lags behind (spring physics)
- Over app embed: Spawns monospace glyphs (`0 1 $ % ▲ ▼`) instead of dots — data stream feel
- Over CTAs: Ring expands, magnetic pull toward button center

**Scroll animations:**
- IntersectionObserver. Elements fade up (translateY 20px → 0, opacity 0 → 1).
- 60ms stagger between siblings.
- No external animation libraries. Pure CSS + vanilla JS.

**Reduced motion:** Respect `prefers-reduced-motion`. Kill all animations, keep layout.

### Day Mode

Not just inverted colors. Different emotional register:
- Dark = "institutional trading floor at night" — deep, focused, premium
- Day = "bright Apple Store" — clean white (#ffffff), sharp shadows, crisp text (#0f172a)
- Day mode accent stays purple
- Sentiment-driven subtle tints in day mode (bullish market → faint green tint on cards)

---

## 5. INSPIRATIONS & BENCHMARKS

### Design Benchmarks

| Reference | What to study | What NOT to take |
|-----------|---------------|------------------|
| **apple.com** | Whitespace, scroll-driven reveals, product hero presentation, typography scale | Their color palette, their minimalism extreme |
| **stripe.com** | Glass effects, interactive docs, gradient usage, card animation | Their technical documentation focus |
| **linear.app** | Dark UI done right, keyboard shortcuts, clean density | Their dev-tool aesthetic |
| **perplexity.ai** | Product-first hero, confident copy, immediate utility | Their search-focused layout |
| **bloomberg.com** | Information density that works, ticker strips, real-time feel | Their cluttered legacy sections |
| **revolut.com** | Financial product storytelling, mobile showcase, trust building | Their bright colors |
| **AERIUM site** (your image 3) | Dark glass aesthetic, phone mockups, "Intelligence Beneath The Surface" editorial energy, stats bar, iterative showcasing of features | Their IoT-specific content |

### Content Benchmarks

| Reference | What to study |
|-----------|---------------|
| **Messari** | Research depth presentation, data-driven credibility |
| **Nansen** | How they show product value through data stories |
| **DeFiLlama** | Transparency and open-data positioning |
| **The Block** | Editorial intelligence as product differentiator |

### What Makes Spectre Different From All of Them

1. **They separate social and data. We converge.** Nobody else takes X sentiment + on-chain flows + market structure and synthesizes in one view.
2. **They sell dashboards. We sell intelligence.** The AI Brief is an opinion, not a chart. Research Zone is a thesis, not a spreadsheet.
3. **They charge subscriptions. We use token-gated access.** $SPECT aligns holder incentives with platform growth.
4. **They're read-only. We're actionable.** Command Center → conviction → trade. Not: read report → open another app → trade.

---

## 6. MOBILE STRATEGY

The website itself must be impeccable on mobile. Not "responsive" — redesigned for thumb-first interaction.

**Mobile-specific decisions:**
- Hero: Stack layout. Copy → screenshot → CTAs (sticky at bottom)
- Gap diagram: Simplified. Two columns collapse to vertical with Spectre connecting them
- Product showcase: Swipeable carousel instead of tabs
- Screenshots: Show ONLY mobile screenshots on mobile viewport (don't show desktop shots on phone)
- Token section: Tier cards swipeable horizontally
- Nav: Hamburger + two permanent CTAs (Open App + Buy)
- Footer: Stacked, social icons larger for touch targets

---

## 7. SEO & AISEO CONSIDERATIONS

The website isn't just for human visitors. Spectre wants to be a citable source across the web.

**Technical SEO:**
- Clean semantic HTML (h1 → h6 hierarchy, proper section/article/nav elements)
- Meta descriptions per section (for SPA, use dynamic head management)
- OG images for each major section (for social sharing)
- Schema markup: Organization, Product, FAQPage
- Sitemap submitted to Google + Bing (reminder: Bing Webmasters still pending)

**AISEO (AI Search Engine Optimization):**
- Clear, factual descriptions of what Spectre does (AI models cite these)
- Structured data that answers "what is Spectre AI" definitively
- Intelligence Hub content linked from website = crawlable original research
- FAQ section with real questions traders ask (not marketing fluff)

---

## 8. TECHNICAL IMPLEMENTATION NOTES

### Stack
- **Framework:** Same as app — React 18 + Vite 5. Or: standalone Vite project with shared design tokens.
- **Styling:** CSS variables from `src/index.css`. Glass patterns from SPECTRE_DESIGN_LAW.md. No Tailwind on the marketing site (keep it lean).
- **Animations:** IntersectionObserver + CSS. Cursor system in vanilla JS. No GSAP, no Framer Motion for the marketing site.
- **Data:** CoinGecko free API for live ticker. Intelligence Hub RSS/API for article previews.
- **Fonts:** Space Grotesk, Inter, JetBrains Mono, Playfair Display, Outfit. Self-hosted via @font-face, not Google Fonts CDN (performance).
- **Icons:** spectreIcons system, adapted for standalone use on marketing site.

### Performance Targets
- Lighthouse: 95+ Performance, 100 Accessibility, 100 Best Practices
- First Contentful Paint: < 1.2s
- Largest Contentful Paint: < 2.5s (app screenshot is the LCP element — optimize aggressively)
- No layout shift above 0.1 CLS
- Total page weight: < 2MB including images

### Deployment
- Domain: spectreai.io
- Hosting: Same infrastructure as current (or migrate to Vercel/Cloudflare Pages for edge delivery)
- SSL: Obviously
- CDN: Assets on edge

---

## 9. SECTION FLOW SUMMARY

```
NAV (sticky, glass, always visible)
│
├── 1. HERO — Beta is open. Product screenshots + multi-asset ticker + CTAs
│
├── 2. THE GAP — Market positioning. Social chaos ↔ Data fortresses ↔ Spectre
│
├── 3. WHY SPECTRE — Three pillars. Wake up smarter / See what others miss / Move first
│
├── 4. PRODUCT SHOWCASE — 8 categories, 38+ tools, real screenshots, multi-asset
│       Markets strip: Crypto · Stocks · Commodities · Macro
│       Categories: Command Center · Research & Discovery · Trading ·
│                   Intelligence & News · Social & X · Visualization ·
│                   AI Agents & Models · Macro & Calendar
│
├── 5. INTELLIGENCE FEED — Live articles from Intelligence Hub
│
├── 6. HOW IT WORKS — Data in, intelligence out. Animated architecture (5 inputs → 6 outputs)
│
├── 7. DEVICE SHOWCASE — Desktop + Mobile + Day/Night toggle
│
├── 8. $SPECT TOKEN — Tiers, utility, CA, buy CTA
│
├── 9. ROADMAP — Q1-Q4 2026, zigzag timeline
│
├── 10. TEAM — Builders, not headshots
│
├── 11. PARTNERS — Logo strip, trust signals
│
├── 12. SOCIAL PROOF — Metrics + community links
│
├── 13. EMAIL CAPTURE — Daily AI Brief subscription
│
├── 14. FINAL CTA — "The Beta is open."
│
└── 15. FOOTER — Links, socials, CA
```

---

## 10. SUCCESS METRICS

| Metric | Target | How to measure |
|--------|--------|---------------|
| Beta signups from website | 15%+ of visitors | UTM tracking on "Join Beta" CTA |
| $SPECT buy clicks | 5%+ of visitors | UTM tracking on Uniswap link |
| Scroll depth | 60%+ reach Section 8 (Token) | Analytics scroll tracking |
| Time on page | > 2 minutes average | GA4 / Plausible |
| Mobile experience | No horizontal scroll, no broken layout | Manual QA + Lighthouse |
| Email signups | 3%+ conversion | Form submission tracking |
| SEO: "spectre ai" #1 ranking | Top 3 for brand terms | Search Console |
| Page speed | LCP < 2.5s on 3G | Lighthouse CI |

---

## 11. WHAT'S NOT IN V1

Explicitly deferred to keep the launch scope tight:

- Blog / content hub on main domain (Intelligence Hub is separate at app.spectreai.io)
- Developer docs / API documentation (future subdomain: docs.spectreai.io)
- Multi-language support (English only for now)
- User dashboard / login on marketing site (all auth is in the app)
- Animated 3D globe on website (save it for the app's War Room)
- Video testimonials (need to produce these first)
- Comparison table vs competitors (too aggressive, let the product speak)

---

## APPENDIX A: COPY TONE RULES

These apply to every word on the website:

**Do:**
- Be specific and concrete. "23 tabs → 1 view." "90 seconds to know the market."
- Assume the reader is intelligent. Don't over-explain.
- Use first person plural when it adds warmth: "We built this because we were frustrated too."
- Let short sentences hit. Punctuation is deliberate.
- Use Playfair Display (serif) for editorial moments that need weight.

**Don't:**
- Use "information asymmetry," "leverage," "disruptive," "cutting-edge," "next-gen," "powerful AI"
- Use generic superlatives: "The most comprehensive..." "The only platform..."
- Label anything as "AI-powered" or "AI-generated." The intelligence is invisible.
- Use em dashes. Ever.
- Use stock photos. Real product screenshots or nothing.
- Write more than 2 sentences in a row without a visual break.

---

## APPENDIX B: CREATIVE IDEAS & EXPERIMENTS

### 1. "Live AI Brief" in the hero
Instead of a static screenshot, show the actual current AI Brief text cycling through slides (the real content from the app). Visitors read real market intelligence before they even sign up. This is the most powerful demo possible.

### 2. Interactive market gap diagram
Let users drag tokens between the Social and Data columns. When they drop one in the middle, it shows how Spectre covers that token with both social and on-chain data. Playful, memorable, shareable.

### 3. "One day with Spectre" scroll story
A vertical scroll-driven narrative: "7:00 AM — Your AI Brief arrives. Here's what it says today..." → real content. "9:30 AM — US market opens. Here's what Spectre shows you..." → Command Center screenshot. Walk through a trader's day with the product.

### 4. Fear & Greed live widget
Embed the actual Fear & Greed gauge on the website. Updating live. Shows the product is real and running, not vaporware.

### 5. "Try before you buy" section
Embed a stripped-down version of the search engine or token lookup. Type any token → see a preview of what Spectre's research looks like. Converts curiosity into app opens.

### 6. Ambient audio toggle
Subtle trading floor ambiance (keyboard clicks, quiet data feed sounds) that plays when toggled. Unusual for a marketing site. Memorable. Premium feel.

### 7. Scroll-driven number counters
Every stat (2,400+ traders, 50,000+ tokens, etc.) counts up from 0 as it enters the viewport. Classic but effective. Use JetBrains Mono for the digits rolling.

### 8. "The brief that replaced 3 apps" hero variant
A/B test a hero where instead of the app embed, you show 3 app icons (TradingView, CoinGecko, CryptoQuant) crossed out → Spectre replaces them all. Aggressive but memorable.

---

*This PRD should be the single source of truth for the website rebuild. Every design decision, every copy choice, every technical implementation should trace back to this document.*
