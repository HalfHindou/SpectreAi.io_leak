# SPECTRE AI — Landing Page · Claude Code Build Prompt

> Read this entire file before writing a single line of code.
> This prompt is self-contained. It tells you what to build, how it should look, and what success means.

---

## STEP 0 — READ THESE FILES FIRST (mandatory, in order)

```
SPECTRE_DESIGN_LAW.md        ← the law. non-negotiable.
src/index.css                ← CSS variable source of truth
src/icons/spectreIcons.jsx   ← ONLY icon source allowed
src/components/WelcomePage.jsx + WelcomePage.css  ← visual north star
```

Do not write CSS until you have read all four. Every token, every shadow, every radius — already defined. Use it.

---

## WHAT WE ARE BUILDING

A new public landing page for `spectreai.io` — replacing the existing site entirely.

Two equal jobs:
1. **Sell the app** — visitors feel like they're looking through a window into the most sophisticated crypto intelligence platform they've seen. CTA: "Enter App" → `https://app.spectreai.io`
2. **Sell the token** — $SPECT is real, live, and buyable. CA, buy link, holder stats, and tier system must feel institutional — not meme-coin.

The core concept: **the landing page IS a live preview of the app.** The second you land, you see real data moving. You're not reading a brochure — you're standing in the lobby.

---

## STACK AND FILE STRUCTURE

Match the existing app: **React + Vite**. Use CSS variables from `src/index.css` exclusively. No new design tokens invented.

```
src/
  pages/
    Landing.jsx
    Landing.css
  components/landing/
    Nav.jsx
    TickerStrip.jsx
    Hero.jsx
    AppPreview.jsx
    StatsBar.jsx
    Features.jsx
    Tiers.jsx
    Token.jsx
    Roadmap.jsx
    Ecosystem.jsx
    Team.jsx
    SocialProof.jsx
    Partners.jsx
    Footer.jsx
```

Route: Add `/` to Landing.jsx in the router. The existing app stays at its current route.

---

## SECTION 1 — NAV

Fixed, height 64px, backdrop-filter blur(24px), border-bottom 1px solid var(--border-subtle).

Left: Spectre logo mark (from spectreIcons) + wordmark "Spectre AI" in --font-display

Center nav links (smooth scroll anchors):
- Features
- Ecosystem
- Token
- Roadmap
- Team

Right:
- "Docs" ghost button → gitbook link
- "Buy $SPECT" ghost button with bull-green hover → Uniswap
- "Enter App →" primary accent button → https://app.spectreai.io

On scroll past 80px: nav background transitions from transparent to rgba(0,0,0,0.85) with border appearance. Smooth 300ms transition.

---

## SECTION 2 — TICKER STRIP

Fixed below nav (top: 64px), height 32px, Bloomberg-style horizontal scroll.

Live data — fetch on mount, refresh every 60s:

```js
// Prices + 24h change
GET https://api.coingecko.com/api/v3/simple/price
  ?ids=bitcoin,ethereum,solana,spectre-ai&vs_currencies=usd&include_24hr_change=true

// Fear & Greed
GET https://api.alternative.me/fng/?limit=1
```

Items to show (repeat twice for seamless CSS loop):
BTC · ETH · SOL · $SPECT · FEAR & GREED: [value] [label]

Color: positive 24h = --bull, negative = --bear. Separator dots between items.
Animation: animation: ticker-scroll 40s linear infinite. Pause on hover.
Show skeleton shimmer while loading.

---

## SECTION 3 — HERO

Full viewport height (min-height: 100vh). Everything centered. App preview below the fold.

Ambient background:
- Large radial purple orb behind text: rgba(139,92,246,0.07), centered, 800px diameter
- Smaller green orb bottom-left: rgba(16,185,129,0.04)
- Subtle noise texture overlay (SVG filter, opacity 0.025)

Eyebrow badge (pill, fade-up, delay 0ms):
  LIVE INTELLIGENCE PLATFORM
Green pulse dot + mono uppercase text, purple border pill. Breathing dot animation.

Headline (Space Grotesk, 64-72px, weight 700, letter-spacing -0.04em, fade-up delay 100ms):
  The market has two signals.
  Most traders only see one.

Mix --font-cinema (Playfair Display italic) for the word "one" — serif contrast in a sans headline. Intentional editorial moment.

Subheadline (Inter, 17px, --text-tertiary, max-width 520px, fade-up delay 200ms):
  Spectre synthesizes on-chain flows, CT sentiment, and technical data
  into a single intelligence layer. Real-time. AI-native. Built for
  traders who want the full picture.

CTA row (fade-up delay 300ms):
- "Enter App →" — large primary button, accent purple, font-weight 600, 14px
- "Buy $SPECT" — ghost button, bull-green hover state

Contract Address row (fade-up delay 400ms):
  [CA]  0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6  [copy icon]
Mono font, subtle glass border, copy-to-clipboard with 2s "Copied ✓" state (color transition to --bull).

App Iframe Preview (fade-up delay 500ms, max-width 1200px, centered):

DO NOT rebuild or replicate the app. DO NOT create fake components.
Iframe the REAL live app directly into the landing page.

The app is at: https://app.spectreai.io/lp
This is the Welcome/Landing page of the real app — it shows market overview,
Fear & Greed, prices, dominance, Command Center, Top Coins. It is already built.
Embed it as-is. The user sees and interacts with the real thing.

Implementation:

```jsx
<div className="app-preview-wrapper">
  {/* Fake browser chrome */}
  <div className="preview-chrome">
    <div className="chrome-dots">
      <span className="dot red" />
      <span className="dot amber" />
      <span className="dot green" />
    </div>
    <div className="chrome-url">app.spectreai.io</div>
  </div>

  {/* The real app in an iframe */}
  <div className="iframe-container">
    <iframe
      src="https://app.spectreai.io/lp"
      title="Spectre AI Platform"
      scrolling="no"
      frameBorder="0"
    />
    {/* Bottom gradient fade — bleeds into page */}
    <div className="iframe-fade" />
  </div>
</div>
```

CSS for the iframe container:
- iframe: width 100%, height 640px, border none, pointer-events all
- Scale the iframe content down slightly so it fits: transform scale(0.9), transform-origin top center
- Wrapper clips overflow so scaled content stays contained
- .iframe-fade: position absolute, bottom 0, height 200px,
  background linear-gradient(to top, var(--bg-void) 0%, transparent 100%)
  This gradient sits on TOP of the iframe fade — seamless bleed into next section
- pointer-events: none on the fade div so iframe remains clickable

Wrapper frame styling:
- Border radius var(--radius-xl) on the outer wrapper, overflow hidden
- Border: 1px solid var(--border-default)
- Box shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.6), 0 32px 80px rgba(0,0,0,0.4)
- On hover: transform scale(1.005), shadow deepens — 200ms ease

Below the iframe, centered, full-width:

  [  Enter App →  ]   (large primary button, 16px, font-weight 600, accent purple)
  "The full platform. No tabs. One screen."  (mono, --text-muted, 12px below button)

This CTA sits just below the fade gradient, so it feels like the natural next step
after the user has had a taste of the real product.

IMPORTANT — iframe cross-origin note:
app.spectreai.io is your own domain. Make sure the server sends:
  X-Frame-Options: SAMEORIGIN  (or remove it entirely for the /lp route)
  Content-Security-Policy: frame-ancestors 'self' spectreai.io *.spectreai.io
If the iframe shows blank due to headers, fix it on the server side — do not use a replica instead.

---

## SECTION 4 — STATS BAR

No section padding. Full-width glass container, max-width 900px centered.
Four cells separated by var(--border-subtle) dividers:

  8,369+       $4.26M       12+          99.9%
  Token        Fees         Data         Uptime
  Holders      Generated    Sources

Numbers in --font-mono, 24px, weight 500.
On scroll into viewport: count-up animation — numbers animate from 0 to final over 1.5s easeOut.
Entrance: staggered fade-up, 80ms between cells.

---

## SECTION 5 — FEATURES

Section id: features

Section eyebrow: — INTELLIGENCE INFRASTRUCTURE
Section title: Intelligence infrastructure. Not another dashboard.
Section sub: Spectre replaces 20 tabs. One screen. Every signal.

Bento grid layout — Apple widget style, mix of card sizes:

  [CARD 1 — wide 2x1]       [CARD 2 — 1x1]
  Herd vs Money              AI Brief

  [CARD 3 — 1x1]   [CARD 4]  [CARD 5 — 1x1]
  Research Zone    Heatmap   AI Screener

Card 1 — Herd vs Money (wide):
Mini recreation of the Herd vs Money widget from the app:
- "HERD vs MONEY" header + "ACCUMULATING" badge (accent purple pill)
- Two labeled progress bars:
  - Herd Sentiment 11/100 (red, --bear)
  - Capital Flow 66/100 (green, --bull)
- Sub-stat row: STABLECOIN VOL $100B · DEFI VOL $9B · BTC DOM 57.9%
- Italic copy in --font-cinema: "Social sentiment deep in fear. Capital flows tell a different story."

Card 2 — AI Intelligence Brief:
- Playfair Display italic center text: "Markets finding equilibrium. Smart money diverging from sentiment."
- "SPECTRE AI · INTELLIGENCE BRIEF" watermark in mono at bottom
- "Listen" badge in top-right (voice mode indicator, non-functional UI)

Card 3 — Research Zone:
- Token name + ticker (Bitcoin · BTC)
- Sentiment score pill: BULLISH 74
- Small inline SVG sparkline (hand-craft a simple upward line, 80px wide)
- On-chain activity indicator bar

Card 4 — Heatmaps:
- Grid of colored squares simulating a sector heatmap
- DeFi / AI / Meme / L1 labels
- Colors using --bull/--bear at varying opacities to simulate a real heatmap

Card 5 — AI Screener:
- "3 signals detected" header
- Three mini signal rows: token name, signal type label, strength bar

All cards: full glass treatment from DESIGN_LAW. Hover translateY(-4px) + shadow deepen. Staggered fade-in 100ms delay between cards.

---

## SECTION 6 — ECOSYSTEM

Section id: ecosystem

Section eyebrow: — BEYOND THE PLATFORM
Section title: An intelligence ecosystem. Built to grow.
Section sub: Spectre is infrastructure. The platform is just the beginning.

Six product cards in a 3x2 grid:

  Product                  Status        Description
  Research Platform        LIVE          On-chain, sentiment, technical. One screen.
  AI Screener              LIVE          Signal detection across thousands of tokens.
  Trading Terminal         LIVE          AI-assisted trading with holder + KOL analytics.
  AI & Data Marketplace    COMING SOON   Buy and sell curated intelligence feeds.
  API & Widget Shop        COMING SOON   Embed Spectre intelligence into any platform.
  Staking & Revenue Share  COMING SOON   Hold $SPECT. Earn from platform revenue.

LIVE cards: full glass, normal opacity, subtle green "LIVE" badge.
COMING SOON cards: glass at opacity 0.6, muted mono "COMING SOON" badge.
Each card: icon from spectreIcons, product name in --font-display, one-liner in body text, status badge.
Hover on LIVE: lift + glow. Hover on COMING SOON: slight lift, badge brightens slightly.

---

## SECTION 7 — TIERS

Section id: tiers

Section eyebrow: — ACCESS
Section title: Hold $SPECT. Unlock the platform.
Section sub: Access is token-gated. The more you hold, the deeper you go.

Three tier cards horizontal on desktop, stacked on mobile:

  SCOUT            ANALYST          SOVEREIGN
  500 SPECT        1,000 SPECT      1,000 SPECT*

  [feature]        [feature]        [feature]
  [feature]        [feature]        [feature]
  [feature]        [feature]        [feature]
  [feature]        [feature]        [feature]
  [feature]        [feature]        [feature]

  Buy $SPECT       Buy $SPECT       Buy $SPECT

Placeholders: use [PLACEHOLDER — feature description] for each bullet. Leave 5-6 slots per tier.
Leave a code comment: // TODO: Fill in tier features from app.spectreai.io/pricing

Middle card: subtle accent border var(--border-accent), slightly elevated.
Top card (Sovereign): "FULL ACCESS" badge in accent purple.
Each card: glass treatment, hover lift.

Below cards, a subtle line:
  Prefer a subscription? Monthly and annual plans available. → app.spectreai.io/pricing

---

## SECTION 8 — TOKEN

Full-width section, background var(--bg-surface). Two columns.

Section eyebrow: — $SPECT TOKEN
Section title: The intelligence token.

Left column (55%):

Bullet list using mono "→" prefix (no actual bullet points):
  →  ERC-20 on Ethereum
  →  9,993,171 total supply. Fixed. No inflation.
  →  8,369+ holders and growing
  →  $4.26M in cumulative fees generated
  →  Fair launch. No presale. No VC allocation.
  →  Trade on Uniswap V2

CA box (prominent):
  CONTRACT ADDRESS
  0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6     [COPY]

Two CTAs:
- "Buy on Uniswap →" — bull-green accent border + hover
- "View on Dexscreener →" — ghost

Right column (45%):

Live price card — glass treatment:
- $SPECT price live from CoinGecko
- 24h change color coded
- Market cap
- ATH badge: $11.04 ATH — Aug 2025
- Simple 7-day SVG sparkline (illustrative if CoinGecko chart data unavailable)
- "9,993,171 · FIXED SUPPLY" mono at bottom

---

## SECTION 9 — ROADMAP

Section id: roadmap

Section eyebrow: — ROADMAP
Section title: From prediction bot to intelligence infrastructure.
Section sub: Built in public. Shipped relentlessly.

Horizontal timeline on desktop (vertical on mobile).
Five phases as nodes on a connecting line:

  COMPLETED  COMPLETED  COMPLETED   IN PROGRESS  NEXT     THE SWAN
  Phase 1    Phase 2    Phase 2.3   Phase 3      Phase 4   Phase 5
     ●━━━━━━━━━●━━━━━━━━━●━━━━━━━━━◉━━━━━━━━━━○━━━━━━━━━○

Completed phases: filled circle, --bull tint, full opacity.
Current (Phase 3): pulsing circle with breathing glow animation.
Future: hollow circle, opacity 0.5.
Line: gradient left --bull to right --border-default.

Phase card content (expand on node hover, or always visible condensed below):

Phase 1 COMPLETED — Establishment & Launch
  Token launch, V1 prediction bot, CoinGecko & CMC listings, community foundation

Phase 2 COMPLETED — Foundation & Partnerships
  PAAL AI, PaLM AI, Google for Startups ($200K credits), Nvidia for Startups, TradingView, Bitquery

Phase 2.3 COMPLETED — Search Engine Built
  Full dApp: Research Zone, Heatmaps, AI Screener, Charts, Monarch AI chatbot, Sentiment Analysis, Closed Beta → Public launch

Phase 3 IN PROGRESS — Ecosystem Expansion
  Dexscan, X Bubbles, Signals & Alerts, Staking, Revenue Sharing, CEX listings, Intelligence Hub

Phase 4 NEXT — Integration & Adoption
  Search Engine 2.0, iOS + Android apps, API & Widget marketplace, Global expansion, Gamification

Phase 5 THE SWAN — The Grail Moment
  AI Dexscan + Search Engine 3.0, Quant Fund adoption, The complete intelligence infrastructure

Card badges: green "COMPLETED" for done, purple "IN PROGRESS" for current, muted "UPCOMING" for future.

---

## SECTION 10 — TEAM

Section id: team

Section eyebrow: — TEAM
Section title: Built by traders, for traders.

Grid of team cards, 3 across desktop:

Each card:
- Circular avatar placeholder (ghost circle with initials, subtle shimmer)
- Name in --font-display (PLACEHOLDER)
- Role in mono muted text (PLACEHOLDER)
- X handle in accent-dim color (PLACEHOLDER)

Placeholder cards:
  Card 1: [FOUNDER] · Founder & CEO · @[handle]
  Card 2: [CTO] · CTO · @[handle]
  Card 3: [FRONTEND] · Lead Frontend · @[handle]
  Card 4+: [NAME] · [ROLE] · @[handle]

Leave code comment: // TODO: Replace with real team data — name, role, x handle, optional avatar URL

Card style: glass, hover lift, border brightens on hover.

---

## SECTION 11 — SOCIAL PROOF

Section title: Traders replaced 20 tabs with one.

Three testimonial cards in a row, glass treatment:

Quote 1 (Playfair italic):
  "In this bull run I need only one tab open. It's @Spectre__AI for all my research and data.
  Sentiment analysis tells me objective info about community and development."
  — CT TRADER

Quote 2:
  "I check my own TA and compare it with sentiment analysis from Spectre to make better
  decisions on investment. Must have!"
  — CT TRADER

Quote 3:
  "I am truly excited to have $SPECT as the first mover with next-generational On-Chain
  Search Engine, fully packed for smarter decision-making tools."
  — CT TRADER

Attribution in mono small-caps, --text-muted. No real names, no avatars.

---

## SECTION 12 — PARTNERS

Section eyebrow: — TRUSTED INFRASTRUCTURE

Horizontal row, centered. Grayscale badges, opacity 0.45, hover opacity 0.8.

Partners:
- Google for Startups
- Nvidia for Startups
- Bitquery
- TradingView
- PAAL AI
- Binance (API)

Style: text badges in mono with subtle border, or img placeholders with TODO comments for real logos.
Horizontal scroll on mobile, centered flex wrap on desktop.

---

## SECTION 13 — FOOTER

Three columns.

Column 1 — Brand:
  Spectre AI
  Crypto intelligence infrastructure.
  AI-native. Real-time. Built for traders.

Column 2 — Product:
  Enter App
  Pricing
  Docs
  Whitepaper

Column 3 — Community:
  Twitter/X → https://x.com/Spectre__AI
  Telegram → https://telegram.me/AI_SPECTRE
  YouTube → https://www.youtube.com/@ai-spectre
  Medium → [placeholder]
  LinkedIn → [placeholder]

Bottom bar (mono, --text-muted):
  © 2026 Spectre AI · NFA · DYOR · Terms · CA: 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6

---

## ANIMATIONS (mandatory)

Page load: staggered fade-up on all hero elements. Delays 0 / 100 / 200 / 300 / 400 / 500ms.

Scroll-triggered: every section uses IntersectionObserver.
On enter: opacity 0 to 1 + translateY(24px) to 0, 500ms ease. Cards stagger 80ms apart.

Count-up: stats bar numbers animate on first viewport entry. 1.5s easeOut. Never re-triggers.

Ticker: seamless CSS loop. Pauses on hover.

CA Copy: click → checkmark, --bull color, resets after 2s.

App preview: on scroll into view, sidebar items fade in staggered, then main content, then watchlist panel.

Card hover: translateY(-4px) + shadow deepen + border brightens to --border-strong. 180ms ease.

Button hover: translateY(-2px) + glow on primary buttons. 180ms ease.

Timeline: hover on phase node → card expands with smooth height transition.

Number morphing: if live prices update during session, digit-by-digit roll animation, not hard swap.

Roadmap line: draws itself left to right on scroll into viewport using SVG stroke-dashoffset animation.

---

## DATA INTEGRATIONS

All public APIs — no keys required:

```js
// Prices + 24h change
const PRICES = `https://api.coingecko.com/api/v3/simple/price
  ?ids=bitcoin,ethereum,solana,spectre-ai
  &vs_currencies=usd&include_24hr_change=true`

// Fear & Greed Index
const FNG = `https://api.alternative.me/fng/?limit=1`

// SPECT detail (market cap, supply)
const SPECT_DETAIL = `https://api.coingecko.com/api/v3/coins/spectre-ai`
```

- Fetch on mount, refresh every 60 seconds silently in background
- Skeleton shimmer during initial load — never spinners (DESIGN_LAW)
- If API fails: fall back to last known values, never show error state to user
- Prices in app preview must be real and live

---

## KEY LINKS

```
App:          https://app.spectreai.io
Pricing:      https://app.spectreai.io/pricing
Twitter:      https://x.com/Spectre__AI
Telegram:     https://telegram.me/AI_SPECTRE
YouTube:      https://www.youtube.com/@ai-spectre
Gitbook:      https://spectre-ai-prediction-bot.gitbook.io/spectre-roadmap
Uniswap:      https://app.uniswap.org/swap?outputCurrency=0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6
Dexscreener:  https://dexscreener.com/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6
CA:           0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6
```

---

## DESIGN REMINDERS (burned in from DESIGN_LAW)

1. --font-mono on every number, price, percentage, CA. Always. No exceptions.
2. Purple (--accent) ONLY on primary CTAs and active states. Nothing else.
3. Green = gains. Red = losses. Never decorative.
4. Glass cards = inset top-edge highlight + outer shadow. Never flat.
5. Icons from spectreIcons.jsx only. No external icon libraries.
6. Whitespace is premium. If it feels crowded — add breathing room.
7. No AI sparkle aesthetics. No gradient hero text. No neon glows.
8. Noise texture overlay on body. Subtle. Required.
9. Day mode: every dark style needs a .app.app-day-mode counterpart.
10. Loading = skeleton shimmer. Never spinners.
11. Every page needs one "wow moment" — an element that makes someone pause.

---

## WHAT SUCCESS LOOKS LIKE

Someone lands and within 3 seconds:
- They see live crypto prices moving in the ticker
- The app preview makes them feel the product is real and sophisticated
- They understand there's a token ($SPECT) they can hold or buy
- They want to click "Enter App"

The one-sentence test: does this look like it belongs next to app.spectreai.io?

If yes — ship it.
If no — re-read SPECTRE_DESIGN_LAW.md and fix it.

This page should be something Sunny would screenshot and post on CT the day it drops.
