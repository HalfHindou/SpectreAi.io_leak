# SPECTRE STUDIO — Claude Code Build Prompt (v2 — COMPLETE REDO)

---

## ⛔ STOP — READ THIS BEFORE TOUCHING ANY CODE

**The previous build was completely wrong.** It produced:
- A blank white canvas with nothing on it
- Generic emoji stickers (fire, rocket, heart, brain, moon) — **THIS IS NOT A STICKER APP**
- A floating bottom bar with "Sticker / Note / Function / Color / Theme / Sound" tabs — **WRONG UI entirely**
- No live data anywhere. No charts. No prices. No gauges. Nothing.

**DELETE the entire previous Studio implementation.** Every file. Start from zero.

This document is the ONLY source of truth. Follow it literally.

---

## WHAT SPECTRE STUDIO ACTUALLY IS

Spectre Studio is a **freeform market intelligence canvas**. Users drag-and-drop **live data widgets** — not emoji stickers — onto themed backgrounds. Every single element on this canvas shows REAL market data: prices that tick, charts that render, gauges that animate, tickers that scroll.

**The word "sticker" in this document means "draggable data widget."** NOT an emoji. NOT a decoration. A functional, live, data-driven UI element that happens to be freely positionable on a canvas.

Think: **Bloomberg Terminal meets Pinterest** — if every pinned item was a live data feed.

---

## READ ORDER (mandatory before writing code)

1. `SPECTRE_DESIGN_LAW.md` — the visual bible
2. `src/index.css` — CSS variable source of truth
3. The existing YOU subpage component — find the tab structure
4. This file — ALL of it, every section

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────┐
│  YOU Page Header (existing — don't touch)                          │
│  [ Dashboard ]  [ Studio ]  ← tabs                                │
├──────────────────────────────────────┬──────────────────────────────┤
│                                      │                              │
│   ┌─ TOP TOOLBAR ──────────────┐     │   RIGHT PANEL (slides out)   │
│   │ Theme▾ │ Presets▾ │ ✦Auto  │     │   ┌─────────────────────┐   │
│   │ ↓Export │ ↗Share │ ↺Undo  │     │   │ [+Add] [◆Layers] [⚙]│   │
│   └────────────────────────────┘     │   ├─────────────────────┤   │
│                                      │   │  T  CORE            │   │
│   THE CANVAS                         │   │  [+ Big Price     ] │   │
│   (themed background)                │   │  [+ Line Chart    ] │   │
│                                      │   │  [+ Candle Ghost  ] │   │
│   ┌──────┐  ┌─────────────┐         │   │  [+ Ticker Tape   ] │   │
│   │$97,241│  │ ▁▂▃▅▆▇▆▅▃▂ │         │   │  [+ Fear & Greed ] │   │
│   │BTC    │  │ BTC 24h     │         │   │                     │   │
│   │+2.14% │  └─────────────┘         │   │  ⚡ DERIVATIVES     │   │
│   └──────┘                           │   │  [+ Liquidation B.] │   │
│        ┌──────────┐                  │   │  [+ OI Pulse      ] │   │
│        │ F&G: 72  │                  │   │  [+ Funding Strip ] │   │
│        │ ◠ Greed  │                  │   │  ...               │   │
│        └──────────┘                  │   └─────────────────────┘   │
│                                      │                              │
│   ┌──────────────────────────────┐   │                              │
│   │ BTC 97241 ▲ ETH 3280 ▲ SOL │   │                              │
│   │ 182 ▼ DOGE 0.32 ▲ AVAX ... │   │  (scrolling ticker tape)     │
│   └──────────────────────────────┘   │                              │
│                                      │                              │
└──────────────────────────────────────┴──────────────────────────────┘
```

---

## 1. THE TOP TOOLBAR

Fixed horizontal bar at the top of the Studio canvas area. Dark background (`var(--bg-surface)`), glass border bottom, compact height (~44px).

### Layout (left to right):

```
[ ◉ Zen Minimal ▾ ]  [ ⊞ Presets ▾ ]  [ ✦ Auto-Compose ]  |  [ ↓ Export ]  [ ↗ Share ]  [ ↺ Undo ]
```

All labels in `var(--font-mono)`, 11px, uppercase, letter-spacing 0.08em.

### Theme Dropdown
Clicking the theme button opens a dropdown with nested categories (like the competitor screenshot — expandable sections with `>` chevrons):

```
┌──────────────────────────┐
│  Dark Themes           > │  ← expands to show:
│  Light Themes          > │     Void, Terminal, Deep Space
│  Color Themes          > │     Zen Minimal, Paper, Whiteboard
│  Mood Themes           > │     Street Art, Infrared, Ocean
│                          │     Bull Run, Blood Streets, Neutral
└──────────────────────────┘
```

**12 themes total.** Each fully specified below in the THEMES section.

### Presets Dropdown
```
┌──────────────────────────┐
│  Trading Desk            │
│  Morning Brief           │
│  Derivatives Focus       │
│  Macro View              │
│  Zen                     │
│  Gallery  ★              │  ← only when Street Art theme
└──────────────────────────┘
```

Clicking a preset clears the canvas and loads a pre-arranged set of stickers at defined positions. Stickers appear with staggered animation (60ms delay between each).

### Auto-Compose Button
Opens a centered modal. This is EXACTLY like the competitor screenshot. Implementation:

```
┌─────────────────────────────────────────────────┐
│  Auto-Compose Wall                         ✕    │
│  Let AI create a beautiful composition          │
│  based on your preferences.                     │
│                                                 │
│  Market Mood                                    │
│  [ Breakout ] [■ Risk Off] [ Altseason ]        │
│  [ Earnings ] [ Mean Rev ] [ Chop     ]         │
│                                                 │
│  Focus                                          │
│  [ BTC     ] [ BTC + ETH ]                      │
│  [ Top Coins ] [■ Stocks + Crypto ]             │
│                                                 │
│  Density                                        │
│  [ Minimal ] [ Balanced ] [■ Maximal ]          │
│                                                 │
│  [ Cancel          ] [ ✦ Compose           ]    │
└─────────────────────────────────────────────────┘
```

- Pill-shaped toggle buttons. Selected = filled dark/accent. Unselected = outlined.
- "Compose" = accent button. Clears canvas and generates a layout based on selections.
- Market Mood determines which sticker categories are prioritized.
- Focus determines which tokens appear in price/chart stickers.
- Density: Minimal = 4-5 stickers, Balanced = 8-10, Maximal = 14-18.

---

## 2. THE RIGHT-SIDE PANEL

Slides in from the right when user clicks `+ Add` or the panel toggle. Width: ~340px. Dark glass background. Has 3 tabs across the top:

```
[ + Add ]  [ ◆ Layers ]  [ ⚙ Edit ]
```

Tab bar style: rounded pill tabs, active tab = filled, inactive = text only. Like the competitor screenshot.

### + Add Tab

**This is the sticker library.** Organized into categories with section headers. Each sticker is a white rounded-rectangle button in a 2-column grid showing `[ + ]  Name`. EXACTLY like the competitor screenshot shows (see the CORE / MARKET / DERIVATIVES / MACRO sections).

Section header style: icon + category name in uppercase monospace, muted color, with spacing above.

The categories and every sticker inside them:

---

#### T CORE (7 stickers)

**Big Price**
A large price display for any token.
- Token label: `BTC` in muted text, 12px monospace
- Price: `$97,241` in JetBrains Mono, 48px bold, white (dark theme) or black (light theme)
- Change: `▲ 2.14%` in bull green or bear red, 14px monospace
- Mini sparkline: 60px wide inline SVG to the right of price, showing 24h shape
- Updates every 3 seconds with simulated price movement (±0.05% random walk)
- On canvas size: ~240×100px default, resizable

**Line Chart**
SVG area chart showing 24h price.
- 50 data points, smooth bezier interpolation
- Line color: token-specific (BTC=#F7931A, ETH=#627EEA, SOL=#00D18C)
- Gradient fill below line: line color at 0.15 opacity → transparent
- No axes, no labels, no grid — just the pure shape. Clean.
- Token label + timeframe in corner: `BTC · 24h` in 10px monospace muted
- Size: 320×140px default

**Candle Ghost**
SVG candlestick chart floating on canvas with no background card.
- 14 candles with real OHLC structure
- Green bodies for up candles, red for down
- Thin wicks above and below
- "Ghost" = transparent background, the candles float directly on the canvas
- Size: 300×160px

**Ticker Tape**
Horizontal scrolling strip showing 8+ tokens.
- Each token: `BTC $97,241 ▲1.2%  ·  ETH $3,280 ▲0.8%  ·  SOL $182 ▼0.3%  · ...`
- CSS animation scrolling left continuously at moderate speed
- Monospace font, 12px
- Green/red on each change%
- Subtle left/right edge fade (gradient mask)
- Size: full-width (stretches to whatever the sticker is resized to), 36px tall

**Narrative Tag**
Pill badge showing a current market narrative.
- Examples: `AI Tokens ↑ 12%`, `L2 Rotation`, `Memecoin Season`, `DeFi Revival`, `Risk Off`
- Rounded pill shape, subtle background tint matching sentiment
- Font: 13px Inter medium
- Can place multiple on canvas as vibe markers
- Size: auto-width × 32px

**Dominance Strip**
Horizontal stacked bar chart showing market dominance.
- BTC segment: orange | ETH segment: blue | Others: gray
- Percentage labels inside each segment if wide enough, below if not
- Clean rounded ends
- Size: 280×40px

**Fear & Greed Gauge**
Semi-circular arc gauge.
- Arc gradient: red (0) → orange (25) → yellow (50) → green (75) → bright green (100)
- Animated needle pointing to current value
- Large number in center: `72` in 36px mono bold
- Label below: `Greed` in 12px muted
- The needle ANIMATES when the value changes
- Size: 180×120px

---

#### ⊞ MARKET (4 stickers)

**Top Coins Ladder**
Vertical leaderboard of top performers.
- 5-8 rows, each: rank number, token symbol, 24h change %, mini horizontal bar
- Sorted by performance (best at top)
- Green bars for positive, red for negative
- Monospace numbers
- Size: 240×280px

**Sector Heatmap**
Treemap-style grid of colored rectangles.
- Each rectangle = a sector: DeFi, L1s, L2s, AI, Meme, Gaming, RWA, Privacy
- Color intensity = performance (dark green = +10%, dark red = -10%)
- Rectangle size = relative market cap weight
- Sector label + % inside each rectangle
- Size: 320×200px

**Rotation Compass**
Radar/spider chart showing capital flow direction.
- 6-8 axes: DeFi, L1, L2, Meme, AI, Gaming, Infra, Stables
- Filled polygon showing where capital is flowing TO (larger = more inflow)
- Previous period as a dotted line behind for comparison
- Size: 200×200px

**Breadth Meter**
Simple visual gauge showing market health.
- `Market Breadth: 67% Green` in label
- Horizontal bar: left portion green (67%), right red (33%)
- Number of green coins / total below
- Size: 260×60px

---

#### ⚡ DERIVATIVES (4 stickers)

**Liquidation Bars**
Bi-directional horizontal bar chart.
- Long liquidations: green bars extending LEFT
- Short liquidations: red bars extending RIGHT
- 5-8 price levels stacked vertically
- Price labels on center axis
- Shows where the liquidation clusters are
- Size: 300×180px

**OI Pulse**
Open Interest display with animation.
- Label: `Open Interest` in muted 11px
- Value: `$42.8B` in 28px mono bold
- Change: `▲ 4.2%` in bull/bear color
- When OI is changing rapidly: a subtle pulse ring animation radiates outward from the number (like a sonar ping)
- Size: 200×80px

**Funding Strip**
Horizontal bar showing funding rate.
- Positive funding = green bar extending right from center
- Negative = red bar extending left
- Value displayed: `+0.021%`
- Label: `Funding Rate · 8h`
- Size: 260×50px

**Ghost Heatmap**
Mini liquidation density heatmap.
- Grid of small cells, each colored by liquidation density at that price level
- Brighter/hotter = more liquidations to sweep
- Price axis on left edge
- Current price marked with a horizontal line
- Size: 200×240px

---

#### ◉ MACRO (4 stickers)

**Macro Strip**
Horizontal row of macro indicators displayed side by side.
- 4 blocks: `DXY 105 ▼0.06%` | `US10Y 4.32% ▲` | `SPX 5,842 ▲0.4%` | `GOLD $2,680 ▲0.2%`
- Each with tiny sparkline (40px) beneath the number
- Monospace numbers, muted labels
- Size: full-width (like ticker tape, stretches), 70px tall

**Correlation Breakdown**
Shows BTC correlation to traditional assets.
- 3-4 horizontal bars: `SPX: 0.72` | `Gold: 0.34` | `DXY: -0.58`
- Bar length = correlation magnitude, color = positive (blue) or negative (red)
- Values in mono, labels in Inter
- Size: 240×120px

**Regime Badge**
Large status badge for current market regime.
- Full-width rounded rectangle
- Regime label: `RISK OFF` or `ACCUMULATION` or `DISTRIBUTION` or `BREAKOUT` or `CHOP`
- Color-coded background tint (green for bullish regimes, red for bearish, amber for neutral)
- Subtitle: brief explanation in 11px muted
- Size: 240×70px

**Signal Stack**
Vertical stack of AI signal badges.
- 3-5 rows, each: `↑ BTC · High Conviction` or `↓ ETH · Medium` or `→ SOL · Neutral`
- Arrow direction indicates signal direction
- Conviction level as a small dot bar (●●●○○ for 3/5)
- Each row colored by direction (green/red/gray)
- Size: 220×160px

---

#### ♡ SENTIMENT (3 stickers)

**CT Mood**
Crypto Twitter sentiment indicator.
- Label: `CT Sentiment`
- Visual: horizontal bar divided into bearish (red) / neutral (gray) / bullish (green) segments
- Current reading marked with a triangle pointer
- Text: `Bearish` or `Neutral` or `Bullish` in corresponding color
- Size: 220×70px

**Whale Activity**
Recent large wallet movements.
- 3-4 rows of whale activity: `🐋 3 whales accumulated $2.1M BTC · 48h ago`
- Wait — NO EMOJIS. Use a small circle indicator dot instead of whale emoji.
- Monospace for dollar amounts, Inter for text
- Size: 280×120px

**Smart Money Flow**
Capital flow direction indicator.
- Large arrow (SVG) pointing up, down, or sideways
- Label: `Smart Money: Accumulating` or `Distributing` or `Neutral`
- Intensity bar below (how strong the signal is)
- Size: 200×100px

---

#### ❝ EDITORIAL (4 stickers)

**Quote Block**
Pull quote with editorial typography.
- Font: Playfair Display, italic, 20-24px
- Random quote from curated pool:
  - "Price doesn't lie. Everything else does."
  - "The best trade you ever made was staying patient."
  - "Smart money doesn't announce itself."
  - "Bull markets are born in despair."
  - "Every ATH was once called a bubble."
  - "The chart knows before you do."
  - "Accumulation looks like nothing until it looks like everything."
- Large decorative `"` watermark at 120px, 0.06 opacity, top-left of sticker
- No card/border — just floating text
- Size: 320×120px

**Big Label**
Huge faded text used as a background design element.
- Text: `BITCOIN`, `ACCUMULATE`, `PATIENCE`, `CONVICTION`, `SIGNAL`
- Font: Space Grotesk 600, 120-200px
- Color: extremely faded — `rgba(255,255,255,0.04)` on dark, `rgba(0,0,0,0.04)` on light
- In Street Art theme: Permanent Marker font, slightly more visible `0.08` opacity
- Rotated slightly (–3° to –5°)
- Acts as a canvas texture element
- Size: auto (depends on text length), typically 600×180px

**Headline**
Newspaper-style headline.
- Font: Playfair Display, bold, 22px
- Text: `BITCOIN SURGES PAST $97,000 AS INSTITUTIONS ACCUMULATE`
- Below: date stamp in 9px Courier/mono, muted: `Feb 22, 2026 · Spectre Intelligence`
- Optional thin rule line below headline
- Cream/paper-colored background in light themes
- Size: 360×80px

**Stat Block**
Generic stat display for any custom data point.
- Label: `Open Interest` in 11px muted uppercase
- Value: `$42.8B` in 28px mono bold
- Subtitle: `▲ 4.2% · Longs dominant` in 12px muted
- Clean, no-border sticker. Just text hierarchy.
- Size: 200×80px

---

#### ▶ MEDIA (3 stickers)

**Market Clock**
4-timezone clock display.
- 4 columns: NYC, London, Tokyo, Sydney
- Each: city name (10px muted), time (16px mono bold), market status arrow (▲ open = green, ▼ closed = red)
- Times tick live (update every second)
- Size: 320×70px

**Countdown**
Event countdown timer.
- Label: `FOMC RATE DECISION` in 12px mono uppercase
- Countdown: `02d 14h 32m 18s` ticking every second
- Impact level: colored dot (red = high impact, amber = medium, green = low)
- Size: 260×70px

**Audio Visualizer**
Ambient animated bars — purely decorative but adds life.
- 48 vertical bars
- Height oscillates with random sine-wave patterns
- Bars use accent color at 0.4 opacity
- Creates a "living" feel on the canvas
- No audio actually playing — it's a visual element
- Size: 300×80px

---

#### 🎨 ART (8 stickers) — ONLY visible when Street Art theme is active

**Painted ₿**
Large Bitcoin symbol rendered as SVG art.
- Fill: `linear-gradient(135deg, #F7C31A 0%, #FF9500 100%)`
- Stroke: `rgba(0,0,0,0.9)` at `stroke-width: 8`
- Paint texture inside via `feTurbulence` + clip-path at 0.3 opacity
- Rotation: –4°
- Size: 120-200px square

**Warhol Grid**
Pop art 2×2 grid of ₿ symbols.
- Cell 1: yellow ₿ on pink bg | Cell 2: pink ₿ on yellow bg
- Cell 3: teal ₿ on orange bg | Cell 4: orange ₿ on teal bg
- Thick black borders between cells (4px)
- Thick black outlines on each ₿
- Size: 200×200px

**Drip Price**
Price number with paint dripping off the bottom.
- Numbers: Permanent Marker font, 72px, painted yellow `#F7C31A`
- 3px black text-stroke outline
- Below each digit: 3-6 SVG paint drip paths in yellow/orange, 20-80px long
- Drips use bezier curves with bulbous ends
- Size: 320×140px

**Stencil Word**
Spray-stenciled word with imperfect edges.
- Words: `WAGMI`, `HODL`, `BULL`, `BEAR`, `REKT`, `MOON`, `DYOR`, `ATH`
- Font: Antonio or Bebas Neue, all-caps, 48-72px
- SVG filter: `feTurbulence baseFrequency="0.04"` + `feDisplacementMap scale="3"` for spray edges
- Flat bright color from palette on optional contrasting rectangle
- Rotation: ±5-8°
- Size: 200×70px

**Graffiti Crown**
Basquiat-style 3-point crown SVG.
- Simple hand-drawn crown outline above a token name
- Crown fill: `#F7C31A` (yellow)
- Token name below in Permanent Marker 28px
- Size: 100×80px

**Throw-Up**
Bubble graffiti letters (throw-up style).
- Words: `BULL`, `BEAR`, `MOON`, `REKT`, `HODL`
- Fat SVG text: `stroke-width: 8`, dark stroke, white or colored fill
- `letter-spacing: -2px`
- Size: 80-120px font, total sticker ~300×100px

**Ransom Note**
Each letter cut from a different "source" — random font, size, color, rotation per letter.
- Fonts cycle through: Bebas Neue, Permanent Marker, Playfair Display, Courier, Orbitron, Space Grotesk
- Size per letter: 28-72px (random)
- Slight background rectangle behind each letter (different colors)
- Rotation per letter: ±8° (random)
- Words: `BITCOIN`, `ETHEREUM`, `HODL`, `GREED`, `TO THE MOON`
- Size: depends on word, typically 400×80px

**Echo Text**
Same word stacked 3 times with offset.
- Top layer: full opacity, colored
- Layer 2: 40% opacity, offset +4px/+4px, different color
- Layer 3: 20% opacity, offset +8px/+8px, black
- Creates dimensional screen-print effect
- Font: Bebas Neue, 80-140px
- Size: depends on word

---

## 3. THEMES — ALL 12 DETAILED

Each theme object defines: canvas background, ambient layers, sticker text color, sticker container style, toolbar appearance.

### DARK THEMES

**Void**
```
canvas: #000000 (pure black)
ambient: faint purple radial orb top-right (rgba(139,92,246,0.06), 500px blur)
         faint green orb bottom-left (rgba(16,185,129,0.04), 400px blur)
stickerText: white (rgba(255,255,255,1) primary, 0.72 secondary, 0.48 tertiary)
stickerBg: glass — linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))
           border: 1px solid rgba(255,255,255,0.06)
           backdrop-filter: blur(12px)
           inset shadow: inset 0 1px 0 rgba(255,255,255,0.06)
toolbar: rgba(0,0,0,0.8) with glass blur
vibe: Bloomberg Terminal at 2am. Professional. Serious money.
```

**Terminal**
```
canvas: #0a0e1a (dark navy)
ambient: very subtle green scanline effect (horizontal lines at 0.02 opacity, repeating)
         faint green gradient bottom edge
stickerText: terminal green (#00FF88) for values, gray for labels
stickerBg: solid dark — rgba(10,14,26,0.9) with green border rgba(0,255,136,0.08)
toolbar: same navy, green accent text
vibe: Retro CRT terminal. Hacker aesthetic. Green on dark.
```

**Deep Space**
```
canvas: #06060a (near-black)
ambient: tiny scattered star dots (50-80 1px dots at 0.03-0.08 opacity, random positions)
         very subtle nebula cloud (purple/blue at 0.03 opacity, large blur)
stickerText: white, standard opacity scale
stickerBg: glass with very subtle blue tint — rgba(100,150,255,0.02)
toolbar: dark glass
vibe: Floating in space, watching the markets from orbit.
```

### LIGHT THEMES

**Zen Minimal** (DEFAULT on first load)
```
canvas: #f5f0e8 (warm off-white, aged paper feel)
ambient: barely-visible grid dots (rgba(0,0,0,0.04), 40px spacing, 1.5px dots)
         soft warm shadow at edges (vignette)
stickerText: near-black (#1a1a1f primary, rgba(0,0,0,0.55) secondary, rgba(0,0,0,0.35) tertiary)
stickerBg: white with very subtle shadow — #fff, border rgba(0,0,0,0.06),
           box-shadow: 0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)
toolbar: rgba(245,240,232,0.95) with subtle bottom border
vibe: Apple Store meets Wall Street Journal. Clean, warm, editorial.
```

**Paper**
```
canvas: #faf8f3 (cream)
ambient: paper grain texture via SVG feTurbulence (very subtle noise at 0.02 opacity)
         faint coffee-stain watermark in corner (barely visible circle, brown at 0.015 opacity)
stickerText: dark ink (#2a2a2a)
stickerBg: no border, very subtle shadow only — 0 1px 4px rgba(0,0,0,0.06)
toolbar: cream background
vibe: Research notes on expensive stationery.
```

**Whiteboard**
```
canvas: #ffffff (pure white)
ambient: blue grid lines (rgba(100,140,255,0.06), 32px spacing, 1px lines)
stickerText: dark (#1a1a1f)
stickerBg: white with blue-tinted border — rgba(100,140,255,0.1)
           feels like whiteboard magnets
toolbar: white, subtle bottom border
vibe: Strategy planning session. Whiteboard in a glass conference room.
```

### COLOR THEMES

**Street Art** — SEE FULL SECTION ABOVE for 6-layer procedural canvas
```
canvas: #f5f0e8 base + 6 generative SVG layers (paint washes, drips, splatters, strokes, tags, grain)
ambient: the canvas IS the atmosphere
stickerText: dark on light, Permanent Marker font, 3px text-stroke on prices
stickerBg: minimal — just the content floating on the painted canvas. Art stickers have NO container.
           Data stickers get a cream semi-transparent bg: rgba(245,240,232,0.85) with 2px black border
toolbar: cream bg, Permanent Marker font labels, yellow accent (#F7C31A), hard drop shadows
vibe: Basquiat gallery with live BTC prices. Controlled chaos. Museum-worthy.
SPECIAL: Shows "↺ Repaint" button in toolbar. Shows "ART" sticker category in panel.
```

**Infrared**
```
canvas: #0a0505 (very dark red-black)
ambient: heat-map gradient washes — deep reds, oranges, blacks blending at low opacity (0.08-0.12)
         subtle red radial glow in center
stickerText: warm whites and oranges
stickerBg: glass with red tint — rgba(255,50,50,0.04), border rgba(255,50,50,0.08)
toolbar: dark with red accent
vibe: Thermal vision. Everything is measured in heat. High urgency.
```

**Ocean**
```
canvas: linear-gradient(180deg, #0a1628 0%, #0d2137 50%, #0f2942 100%) — deep ocean gradient
ambient: subtle wave animation at bottom 15% of canvas (SVG path oscillating slowly)
         scattered small light caustic patterns (like light through water)
stickerText: white/cyan tints
stickerBg: glass with blue tint — rgba(0,180,255,0.04), border rgba(0,180,255,0.06)
toolbar: dark blue glass
vibe: Trading from a submarine. Calm, deep, focused.
```

### MOOD THEMES (sentiment-driven atmosphere)

**Bull Run**
```
canvas: #050a05 (very dark green-black)
ambient: green aurora glow that pulses VERY slowly (8s breathe cycle)
         aurora shape: wide ellipse at top, rgba(16,185,129,0.06-0.12) oscillating
         subtle green particle drift upward (tiny dots floating up at 0.03 opacity)
stickerText: white/green tints for positive, white for neutral
stickerBg: standard dark glass with faint green border tint
toolbar: dark with green accent
vibe: The market is pumping and the walls know it. Euphoria atmosphere.
```

**Blood Streets**
```
canvas: #0a0404 (very dark crimson-black)
ambient: deep red bleed effect — paint-like red washes at very low opacity (0.04-0.08)
         subtle downward particle drift (tiny dots falling at 0.02 opacity)
         red vignette at edges
stickerText: white/red tints
stickerBg: glass with red border tint at 0.06
toolbar: dark with red accent
vibe: "When there's blood in the streets..." Ominous. But we're still watching.
```

**Neutral Zone**
```
canvas: #08080c (dark gray-blue)
ambient: slow-rotating amber/indigo gradient fog at very low opacity
         no particles, no animation — perfectly still
stickerText: standard white/gray
stickerBg: standard dark glass
toolbar: dark, muted
vibe: Waiting. Patient. The market hasn't decided yet and neither have we.
```

---

## 4. LAYERS TAB

When clicked, shows all stickers currently on the canvas in a vertical list:

```
┌─────────────────────────────┐
│  ◆ Layers                   │
├─────────────────────────────┤
│  ☐ 👁 🔒  Big Price (BTC)   │
│  ☐ 👁 🔒  Line Chart (ETH)  │
│  ☐ 👁 🔒  Fear & Greed      │
│  ☐ 👁 🔒  Ticker Tape       │
│  ☐ 👁 🔒  Quote Block       │
└─────────────────────────────┘
```

Wait — no emojis for the UI controls. Use SVG icons or simple shapes:
- Eye icon (visibility toggle) — small circle or custom SVG
- Lock icon (position lock) — small padlock shape
- Drag handle on left for reordering
- Click to select (highlights sticker on canvas)

Reorder by drag-and-drop within the list (changes z-index on canvas).

---

## 5. EDIT TAB

When a sticker is selected (clicked on canvas), the Edit tab shows its properties:

```
┌─────────────────────────────┐
│  ⚙ Edit — Big Price         │
├─────────────────────────────┤
│  Token: [ BTC ▾ ]           │
│  Size:  [──●───────] 100%   │
│  Opacity: [────●────] 80%   │
│  Rotation: [●────────] 0°   │
│                              │
│  [ Delete Sticker ]          │
└─────────────────────────────┘
```

Token selector dropdown: BTC, ETH, SOL, AVAX, DOGE, ADA, DOT, LINK, etc.
Size slider: 50% to 200%
Opacity: 20% to 100%
Rotation: -45° to +45°

---

## 6. STICKER MECHANICS

### Adding
Click `[+]` button next to any sticker name in the Add panel → sticker appears at a random open position on canvas (not overlapping existing stickers if possible).

### Dragging
Mousedown on sticker → cursor changes to grabbing → sticker follows mouse → mouseup places it. During drag: sticker gets `z-index: 200` and slight shadow increase. After: returns to its layer z-index.

### Resizing
On hover: small resize handle appears at bottom-right corner (two small lines at 45° — NOT an emoji). Drag to resize. Some stickers maintain aspect ratio (charts, gauges). Others resize freely.

### Deleting
On hover: small `✕` circle appears at top-right. Click to delete with animation: `scale(0.85) + opacity:0` over 220ms.

### Selection
Click a sticker to select it. Selected sticker gets: dashed accent border `2px dashed var(--accent)`. Edit tab opens with its properties.

### Entrance Animation
When added: `scale(0.85) + opacity:0 → scale(1) + opacity:1` over 350ms, `cubic-bezier(0.16, 1, 0.3, 1)`.

In Street Art theme: `clip-path: inset(100% 0 0 0) → inset(0)` "paint-in" reveal over 350ms.

### Live Data
ALL price-related stickers update every 3 seconds. Use simulated data for now:
```javascript
// Random walk simulation
currentPrice *= 1 + (Math.random() - 0.5) * 0.001;
```

---

## 7. COMPONENT STRUCTURE

```
src/components/SpectreStudio/
  SpectreStudio.jsx              ← Main component, renders canvas + toolbar + panel
  SpectreStudio.css
  StudioToolbar.jsx              ← Top toolbar
  StickerPanel.jsx               ← Right panel with 3 tabs
  AutoComposeModal.jsx           ← Modal dialog
  CanvasRenderer.jsx             ← Handles the themed canvas background
  themes/
    index.js                     ← Theme registry, exports all themes
    void.js
    terminal.js
    deepSpace.js
    zenMinimal.js
    paper.js
    whiteboard.js
    streetArt.js                 ← 6-layer procedural SVG generator
    infrared.js
    ocean.js
    bullRun.js
    bloodStreets.js
    neutralZone.js
  stickers/
    StickerWrapper.jsx           ← HOC: handles drag, resize, delete, select for any sticker
    core/
      BigPrice.jsx
      LineChart.jsx
      CandleGhost.jsx
      TickerTape.jsx
      NarrativeTag.jsx
      DominanceStrip.jsx
      FearGreedGauge.jsx
    market/
      TopCoinsLadder.jsx
      SectorHeatmap.jsx
      RotationCompass.jsx
      BreadthMeter.jsx
    derivatives/
      LiquidationBars.jsx
      OIPulse.jsx
      FundingStrip.jsx
      GhostHeatmap.jsx
    macro/
      MacroStrip.jsx
      CorrelationBreakdown.jsx
      RegimeBadge.jsx
      SignalStack.jsx
    sentiment/
      CTMood.jsx
      WhaleActivity.jsx
      SmartMoneyFlow.jsx
    editorial/
      QuoteBlock.jsx
      BigLabel.jsx
      Headline.jsx
      StatBlock.jsx
    media/
      MarketClock.jsx
      Countdown.jsx
      AudioVisualizer.jsx
    art/
      PaintedBTC.jsx
      WarholGrid.jsx
      DripPrice.jsx
      StencilWord.jsx
      GraffitiCrown.jsx
      ThrowUp.jsx
      RansomNote.jsx
      EchoText.jsx
  hooks/
    useDraggable.js
    useResizable.js
    useLivePrices.js
    useTheme.js
    useStudioState.js
  presets/
    tradingDesk.js
    morningBrief.js
    derivativesFocus.js
    macroView.js
    zen.js
    gallery.js
```

---

## 8. PRESETS — EXACT LAYOUTS

Each preset defines which stickers and where (as % of canvas width/height):

### Trading Desk
```javascript
[
  { type: 'BigPrice', token: 'BTC', x: 0.03, y: 0.05 },
  { type: 'BigPrice', token: 'ETH', x: 0.03, y: 0.22 },
  { type: 'BigPrice', token: 'SOL', x: 0.03, y: 0.39 },
  { type: 'LineChart', token: 'BTC', x: 0.28, y: 0.03 },
  { type: 'CandleGhost', token: 'BTC', x: 0.28, y: 0.42 },
  { type: 'FearGreedGauge', x: 0.65, y: 0.03 },
  { type: 'LiquidationBars', x: 0.60, y: 0.35 },
  { type: 'OIPulse', x: 0.85, y: 0.05 },
  { type: 'FundingStrip', x: 0.85, y: 0.25 },
  { type: 'TickerTape', x: 0.03, y: 0.88 },
  { type: 'NarrativeTag', x: 0.55, y: 0.75, text: 'Risk Off' },
]
```

### Morning Brief
```javascript
[
  { type: 'BigPrice', token: 'BTC', x: 0.05, y: 0.08, scale: 1.5 },
  { type: 'FearGreedGauge', x: 0.55, y: 0.05 },
  { type: 'RegimeBadge', x: 0.05, y: 0.40 },
  { type: 'NarrativeTag', x: 0.05, y: 0.55, text: 'Accumulation Zone' },
  { type: 'DominanceStrip', x: 0.05, y: 0.68 },
  { type: 'MacroStrip', x: 0.03, y: 0.82 },
  { type: 'QuoteBlock', x: 0.55, y: 0.55 },
]
```

### Zen
```javascript
[
  { type: 'BigPrice', token: 'BTC', x: 0.30, y: 0.25, scale: 2.0 },
  { type: 'FearGreedGauge', x: 0.35, y: 0.60 },
  { type: 'QuoteBlock', x: 0.25, y: 0.82 },
]
```

---

## 9. PHASE BUILD ORDER

### Phase 1 — Canvas + Toolbar + Panel + Drag (get the shell right)
1. Mount Studio tab in YOU subpage (alongside Dashboard)
2. Canvas renders with Zen Minimal theme (warm cream, faint dots)
3. Top toolbar renders with all buttons (theme dropdown, presets, auto-compose, export, share, undo)
4. Theme dropdown works — clicking each theme changes the canvas background
5. Right panel slides in/out with Add tab showing ALL sticker categories and names
6. Clicking any `[+]` button adds a placeholder gray box to the canvas
7. Drag works. Resize works. Delete works. Selection works.
8. **Load Morning Brief preset on first visit so the canvas is NOT empty**

**CHECKPOINT:** At this point you should see a warm cream canvas with 7 gray placeholder boxes arranged in the Morning Brief layout, a working toolbar, and a right panel with all categories listed.

### Phase 2 — Make Core stickers real
9. BigPrice — live updating, sparkline, change%
10. LineChart — SVG with gradient fill
11. CandleGhost — SVG candlestick
12. TickerTape — scrolling
13. FearGreedGauge — animated needle
14. DominanceStrip — stacked bar
15. NarrativeTag — styled pill

**CHECKPOINT:** Morning Brief preset now shows real data. BTC price ticks every 3s.

### Phase 3 — All remaining stickers
16. All Market stickers (4)
17. All Derivatives stickers (4)
18. All Macro stickers (4)
19. All Sentiment stickers (3)
20. All Editorial stickers (4)
21. All Media stickers (3)

### Phase 4 — Presets + Auto-Compose + Layers + Edit
22. All 6 presets load correctly
23. Auto-Compose modal works with all 3 selector rows
24. Layers tab shows sticker list with reorder
25. Edit tab shows properties for selected sticker

### Phase 5 — Street Art theme + Art stickers
26. Street Art 6-layer procedural canvas
27. Repaint button
28. All 8 art-only stickers
29. All standard stickers adapt to art styling
30. Gallery preset

### Phase 6 — All remaining themes + Polish
31. All 12 themes fully implemented
32. Export 4K PNG
33. Share URL
34. Undo
35. Performance with 15+ stickers
36. Smooth theme transitions

---

## 10. ABSOLUTE RULES

1. **ZERO EMOJIS as sticker content.** Every sticker renders data, charts, numbers, or text. No fire emoji, no rocket emoji, no heart emoji, no brain emoji. NONE.
2. **The canvas must NEVER be blank on load.** Always load the Morning Brief preset as default.
3. **Every price/number uses `var(--font-mono)` (JetBrains Mono).**
4. **Every sticker that shows a price must live-update every 3 seconds.**
5. **Charts must be real SVG — not images, not canvas (except Audio Visualizer).**
6. **The panel must look like the competitor screenshot** — categorized sections, `[+]` buttons, clean 2-column grid.
7. **Icons from spectreIcons.jsx ONLY** — no Lucide, no FontAwesome, no Heroicons.
8. **Follow SPECTRE_DESIGN_LAW.md** for all visual decisions.

---

## START COMMAND

```
Read SPECTRE_DESIGN_LAW.md first.
Read the existing YOU subpage component to understand the tab structure.
Read this file (SPECTRE_STUDIO.md) — ALL of it.
DELETE the entire previous Studio implementation. Every file related to the old emoji stickers.
Build Phase 1: canvas + toolbar with theme switching + right panel with all sticker categories + drag/resize/delete + Morning Brief preset auto-loads.
Use Zen Minimal (light) as default theme.
Report what you built before starting Phase 2.
```
