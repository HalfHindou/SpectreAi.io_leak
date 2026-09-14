# SPECTRE AI — WEBSITE REDESIGN PROMPT
# For Claude Code — Build this from scratch as a single-page marketing site

---

## ⚠️ CRITICAL — READ THIS FIRST

**DO NOT change any existing styles, CSS variables, component designs, glass effects, typography, spacing, or visual design.**

This is a **content and structure restructure only.** The design system is already correct and production-quality. Your job is:
1. Reorder sections as specified below
2. Rewrite copy/headlines as specified below
3. Add new sections using the EXACT same component patterns already in the codebase
4. Remove sections specified below

If you're writing new CSS: copy the patterns from existing components. Do not invent new styles. Do not change colors, fonts, border-radius, shadows, or any design tokens. Match what's already there so precisely that no one can tell which sections are new.

---

## CONTEXT & PHILOSOPHY BEFORE YOU WRITE ANYTHING

Read SPECTRE_DESIGN_LAW.md fully before touching any code. This website must feel like Bloomberg Terminal met Stripe's website and Apple's editorial team wrote the copy. The benchmark is Perplexity.ai's homepage — confident, direct, shows the product immediately, no preamble.

**What we are NOT building:**
- Another AI startup landing page with gradient blobs and "10x your productivity" copy
- A DeFi hype page with tokenomics charts front and center
- A feature list disguised as a website

**What we ARE building:**
- The first thing a serious trader sees and thinks "this was built by people who understand markets"
- A page where the PRODUCT itself is the pitch — they use it before they even scroll down
- A token acquisition funnel that feels like a premium membership, not a crypto casino

---

## SITE STRUCTURE — IN ORDER

### 0. NAV
**Sticky. Minimal. Glass blur.**

Left: Spectre wordmark (logo SVG) + `AI` superscript in `--accent`  
Center: `Intelligence · Terminal · Search · Pricing`  
Right: `[Day Mode toggle — sun/moon icon]` · `[Open App]` (accent button) · `[Buy $SPECT]` (ghost button with purple border)

Day mode toggle: switches between dark (default) and light. In light mode — white bg, sharp shadows, navy text. NOT gray. Think Apple.com light mode.

Nav disappears on scroll down, reappears on scroll up (smart hide). Glass blur backdrop on scroll.

---

### 1. HERO — THE CREED

**No background image. No gradient blob. Deep black. One radial purple orb at ~6% opacity behind the text, centered.**

Eyebrow label (small caps, muted):
```
SPECTRE AI — MARKET INTELLIGENCE
```

Main headline (Space Grotesk, massive, tight letter-spacing, two lines):
```
The market is already
telling you what's next.
```

Sub (Inter, 18px, 60% white opacity, max 520px wide):
```
Spectre reads the signal across on-chain flows, social momentum, 
and technical structure — then tells you what it means. 
One platform. No tabs. No noise.
```

Primary CTA: `Open Platform →` (large, purple, slight glow on hover)  
Secondary CTA: `Buy $SPECT` (ghost, white border 20% opacity)

Below CTAs — a thin horizontal row of live data (JetBrains Mono, small, muted):
```
BTC  $[live]  [+/-]%    ETH  $[live]  [+/-]%    SOL  $[live]  [+/-]%    F&G  [value]  [label]
```
These should be real or use placeholder animations. Color-coded green/red.

No stats bar (8369 holders, $4.26M fees). Remove. This feels like hype, not confidence.

---

### 2. LIVE APP EMBED — "TRY IT NOW"

**This is the most important section. People try the product before they scroll further.**

Section label:
```
LIVE PLATFORM
```

Headline:
```
Don't take our word for it.
```

Sub (optional, small):
```
The full platform. Running. Right now.
```

A large browser chrome mockup (like Linear's product previews) embedding `https://app.spectreai.io` in an `<iframe>`. Style the chrome:
- Dark browser chrome with spectreai.io in the URL bar
- Three window control dots (red/yellow/green) top left
- Subtle reflection on top edge of the frame
- 900px max width, 580px height
- Rounded corners (24px)
- Inset glass border (the design law glass card treatment)
- On mobile: show a static screenshot with "Open Platform" CTA overlay

Below the embed:
```
[Open Full Platform]   [View on Mobile]
```

---

### 3. THE PROBLEM — WHY SPECTRE EXISTS

**No section header. This flows from the embed. It's a moment of resonance.**

Full-bleed dark section, centered text, editorial typography:

Serif (Playfair Display, italic, large):
```
"You have 23 tabs open.
You still don't know what to do."
```

Below in Inter, normal weight, 60% opacity:
```
Every serious trader operates the same way. CoinGecko for price. 
Twitter for sentiment. Etherscan for on-chain. A chart tool for technicals. 
A Telegram for alpha. And still — by the time everything syncs in your head, 
the move has already happened.
```

Then a simple 3-column visual (no cards, just spaced icons + text):

```
The old way:                    The Spectre way:
[icon: scattered]               [icon: single dot]
23 tabs, 6 platforms            One view. All signal.
Hours of manual research        Market brief in 30 seconds.
Always one step behind          Know before it's obvious.
```

---

### 4. WHAT IT ACTUALLY DOES — FEATURE SHOWCASE

**Bento grid layout. Not a list. Not numbered bullets.**

Section label: `INTELLIGENCE MODULES`  
Headline (Space Grotesk): `Six ways to see what others miss.`

**Bento grid — mix of 2x1, 1x1, 1x2 cards:**

**Card 1 (2x1 wide) — AI Brief**  
Label: `AI BRIEF`  
Headline: `The market, summarized. Every session.`  
Body: `Every few hours, Spectre's agents scan thousands of data points — on-chain flows, social velocity, technical structure, macro events — and write one brief. Read it in 90 seconds. Know what the market is doing and why.`  
Visual accent: A mock "brief" snippet in the card — a few lines of editorial text with a timestamp, like a Bloomberg top story.  
Voice icon: `🔊 Listen` in small mono text bottom right.

**Card 2 (1x1) — Market Heatmap**  
Label: `HEATMAP`  
Headline: `100+ assets. The mood at a glance.`  
Body: `Treemap colored by real-time momentum. Spot rotation before the crowd does.`  
Visual: Mini heatmap SVG with colored blocks (greens and reds).

**Card 3 (1x1) — Builder Score**  
Label: `BUILDER SCORE`  
Headline: `Who's building. Who's gone quiet.`  
Body: `A signal most platforms ignore: is the team still working? Builder Score tracks development activity in real-time — catching dead projects before the chart tells you.`  
Tag: `NEW`

**Card 4 (1x2 tall) — Research Terminal**  
Label: `RESEARCH TERMINAL`  
Headline: `Full thesis. On any token. On demand.`  
Body: `Price history, holder concentration, on-chain flows, sentiment score, team activity, and AI-generated research — assembled instantly. What used to take hours. Now takes seconds.`  
Visual: A simplified mock of the research terminal with a token name and data rows.

**Card 5 (1x1) — Search Engine**  
Label: `SPECTRE SEARCH`  
Headline: `Ask anything about any asset.`  
Body: `Quick Intel for fast answers. Deep Thesis for full reports. Search wallets, tokens, DeFi protocols, or market questions in natural language.`

**Card 6 (1x1) — Spectre Lens**  
Label: `SPECTRE LENS`  
Headline: `Intelligence that watches with you.`  
Body: `A desktop companion that reads what's on your screen and surfaces relevant context — without you ever switching windows.`  
Tag: `DESKTOP`

**Card 7 (2x1) — Economic Calendar**  
Label: `MACRO EVENTS`  
Headline: `The events that move markets. Before they happen.`  
Body: `CPI. FOMC. Earnings. GDP. All in one place with impact ratings and countdowns. Never get caught off guard by macro again.`

---

### 5. THE INTELLIGENCE LAYER — HOW IT WORKS

**This section explains the data pipeline without being technical. Think Stripe's "how it works" sections.**

Section label: `THE STACK`  
Headline: `Four data layers. One conclusion.`

Horizontal flow visualization (on desktop, vertical on mobile):

```
[ON-CHAIN]          [SOCIAL]           [TECHNICAL]         [MACRO]
Wallet flows        Twitter velocity   Price structure      Central banks
Exchange flows      Telegram pulse     Support/resistance   Economic data
Whale activity      News sentiment     Volume profile       Earnings
Holder changes      KOL tracking       Pattern detection    Regulatory events
      ↓                   ↓                  ↓                    ↓
                    [SPECTRE SYNTHESIS]
              AI reads across all four layers simultaneously.
              Surfaces what matters. Discards what doesn't.
                    ↓
              [YOUR BRIEF]
```

Sub below: 
```
Most platforms pick one layer and go deep. Spectre connects all four.
The insight only exists at the intersection.
```

---

### 6. TOKEN ACCESS — THE MEMBERSHIP MODEL

**This is where they buy. Make it feel like a premium club, not a token sale.**

Section label: `$SPECT TOKEN`  
Headline: `One token. Permanent access. No subscription.`

Sub:
```
Hold SPECT and unlock the platform. No monthly fees. 
No credit card. Your access is your position.
```

Three tier cards (glass, horizontal on desktop):

**Scout — 500 SPECT**
Access: AI Brief · Market Heatmap · Macro Calendar  
Tag: `Entry`

**Analyst — 1,000 SPECT**  
Access: Everything in Scout + Research Terminal · Builder Score · Spectre Search  
Tag: `Most Popular` (accent border)

**Sovereign — 5,000 SPECT**  
Access: Full platform · Spectre Lens · Priority data · Whale group access  
Tag: `Full Intelligence`

Below tiers:
```
Network: Ethereum · Contract: 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6
```

CTA buttons:
`[Buy on Uniswap]` (primary, purple)  `[View on Dexscreener]` (ghost)

**DO NOT show token price, holder count, or fee revenue here. No hype metrics. The product sells the token.**

---

### 7. WHO THIS IS FOR — POSITIONING

**Short. Punchy. Three personas. No corporate speak.**

Section label: `BUILT FOR`  
Headline: `Serious traders. Not casual observers.`

Three side-by-side columns:

```
Independent Traders          Research Analysts          DeFi Participants
---                          ---                        ---
You move fast. You need      You build conviction       You need to know
a platform that keeps up.    through research.          which protocols
Spectre is your pre-trade    Spectre is your            are still alive.
edge — briefed and ready     research layer.            Builder Score and
before every session.        Ask anything.              on-chain flows
                             Get thesis-level answers.  tell the real story.
```

---

### 8. INTELLIGENCE HUB — THE PUBLISHING LAYER

**This is new. Spectre is now a media company that publishes research 24/7.**

Section label: `INTELLIGENCE HUB`  
Headline: `Original market research. Published continuously.`

Sub:
```
Spectre's agents publish breaking analysis, token spotlights, macro reads, 
and market briefings around the clock. Original research — not aggregated news.
```

Three agent cards (horizontal):

**Breaking Analysis** — Updated every 10 min  
**Market Briefings** — Every session open  
**Deep Research** — Continuous, on-chain triggered  

CTA: `Read Latest Intelligence →`

---

### 9. PARTNERS — SIMPLE, CONFIDENT

No "Backed by" label. Just logos. Clean row.  
`Google for Startups · Nvidia Inception · Bitquery · TradingView`

No marketing copy around them. They speak for themselves.

---

### 10. FINAL CTA — THE CLOSE

**Full-bleed dark section. One moment. Clean.**

Headline (large, Space Grotesk):
```
The platform is live.
The question is whether you're on it.
```

Two buttons:
`Open Platform →` (primary, large)  
`Acquire $SPECT` (ghost)

Small disclaimer below in muted text:
```
Spectre AI is a market intelligence tool. Nothing here is financial advice. 
Always do your own research.
```

---

### 11. FOOTER

Minimal. Two rows.

Row 1:
Left: Spectre wordmark  
Center: `Platform · Pricing · Docs · Intelligence Hub`  
Right: `X · Telegram · YouTube`

Row 2:
Left: `© 2026 Spectre AI`  
Right (mono): `CA: 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6`

---

## COPY TONE RULES — APPLY EVERYWHERE

- **No:** "information asymmetry," "leverage," "disruptive," "cutting-edge," "next-gen," "powerful AI"
- **No:** Generic superlatives. "The most comprehensive..." "The only platform..."
- **Yes:** Specific, concrete, direct. "23 tabs → 1 view." "90 seconds to know the market."
- **Yes:** Assumes the reader is intelligent. Doesn't over-explain.
- **Yes:** First person plural when needed: "We built this because we were frustrated too."
- **Never name AI as the feature.** Intelligence is invisible. The output is the product.
- Punctuation is deliberate — short sentences hit harder. Let them.

---

## TECHNICAL IMPLEMENTATION NOTES

### STYLE PRESERVATION — NON-NEGOTIABLE
Do not touch `index.css`, `DESIGN_SYSTEM.md`, or any existing component CSS. All new sections must be built by copying existing component patterns verbatim. If a glass card already exists in the codebase — reuse it. If a section header pattern exists — reuse it. Zero new design decisions.



### Day Mode
- Toggle in nav (sun/moon icon from spectreIcons)
- Dark mode = default (class `data-theme="dark"` on `<html>`)
- Light mode = Apple.com white, not gray. `#ffffff` backgrounds, `#0f172a` text, `rgba(0,0,0,0.06)` borders
- In light mode, accent stays purple `#8B5CF6`
- Persist in localStorage

### Live Ticker in Hero
Use a simple fetch to CoinGecko public API (no key needed):
`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`
Update every 30 seconds. Animate price changes with a subtle flash (green flash up, red flash down).

### App Embed
`<iframe src="https://app.spectreai.io" />` with a browser chrome wrapper. If the app blocks iframing, show a static screenshot with a large "Open Platform →" overlay button instead.

### Scroll Animations
Use IntersectionObserver. Elements fade up (translateY 20px → 0, opacity 0 → 1) as they enter viewport. 60ms stagger between siblings. No libraries — pure CSS + minimal JS.

### Bento Grid
CSS Grid. On desktop: `grid-template-columns: repeat(3, 1fr)`. Cards span columns via `grid-column: span 2` etc. On mobile: single column stack.

### Ticker Strip
Remove the current rotating headlines ticker. Too busy, too much like a crypto news site. Replace with the clean live price row in the hero (as described above).

### What to Remove from Current Version
- Stats bar (8369 holders, $4.26M fees, 12+ sources, 99.9% uptime) — feels like hype, not confidence
- Numbered feature list format (01, 02, 03...) — replace with bento grid
- "Ecosystem" section with live/upcoming labels — replace with Intelligence Hub section
- Team section — outdated, lean teams don't need this on marketing sites unless photos are current
- Roadmap section — replace with one line in footer: "Building in public. Follow @SpectreAI"
- Marquee text rows — too Web3. Remove.
- "BACKED BY" with partner logos replaced with cleaner partner row

### Fonts (CDN via Google Fonts)
```
Space Grotesk: 400, 500, 600, 700
Inter: 400, 500
JetBrains Mono: 400, 500
Playfair Display: 400 italic
Outfit: 400, 500
```

### Color Tokens
Use exactly as defined in SPECTRE_DESIGN_LAW.md. No custom colors.

---

## FILES TO CREATE

```
/index.html          — base HTML with font imports, meta tags
/src/style.css       — all design tokens + global styles
/src/main.js         — day mode toggle, scroll animations, live ticker, iframe fallback
/src/sections/       — one JS file per section if componentizing
```

Or deliver as a single self-contained `index.html` with embedded CSS and JS for simplicity.

---

## FINAL CHECK BEFORE SHIPPING

Ask yourself:
1. Does it look like something Bloomberg would feature as a well-designed product? ✓
2. Does the hero section make someone want to click "Open Platform" immediately? ✓
3. Can a trader understand the product in 30 seconds without reading everything? ✓
4. Is there a clear path to both "try the app" and "buy the token"? ✓
5. Does any section feel like generic AI startup copy? → Delete and rewrite.
6. Does day mode look like a genuinely different design, not just inverted colors? ✓
7. Are all numbers in JetBrains Mono? ✓
8. Is the AI invisible (not labeled, badged, or celebrated as the feature)? ✓
