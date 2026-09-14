---
paths:
  - "apps/*/src/**/*.css"
  - "apps/*/src/**/*.jsx"
  - "packages/spectre-ui/**"
---

# Spectre Design System - Apple Cinematic

**Identity:** Warm-white on pure black. Glass surfaces, controlled opacity, cinematic depth.
**Standard:** If it looks like "an AI built this" - delete it and start over.

---

## A. Color System

Source of truth: each app's `src/index.css` `:root` block.

### Background Hierarchy (darkest to lightest)
```css
--bg-void: #09090b;        /* pure black, page background */
--bg-base: #09090b;        /* main background (same as void) */
--bg-surface: #111113;     /* card surfaces */
--bg-elevated: #18181b;    /* elevated cards, dropdowns */
--bg-overlay: #1a1a1d;     /* overlays, modals */
--bg-hover: #1a1a1d;       /* hover state backgrounds */
```

### Text Hierarchy - #f5f5f7 warm-white, opacity ramp
```css
--text-primary: #f5f5f7;                    /* headings, primary content */
--text-secondary: rgba(245, 245, 247, 0.6); /* body text, descriptions */
--text-tertiary: rgba(245, 245, 247, 0.5);  /* subheadings, labels */
--text-muted: rgba(245, 245, 247, 0.35);    /* placeholders, hints */
--text-disabled: rgba(245, 245, 247, 0.2);  /* disabled states */
```

### Trading Colors
```css
--bull: #10B981;          --bull-bright: #34D399;    --bull-muted: rgba(16, 185, 129, 0.08);
--bear: #EF4444;          --bear-bright: #F87171;    --bear-muted: rgba(239, 68, 68, 0.08);
```
Use `--bull` / `--bear` for price changes ONLY. Never as general UI accents.

### Brand Accent - Warm-white, zero purple in UI chrome
```css
--accent: #f5f5f7;
--accent-secondary: rgba(245, 245, 247, 0.6);
--accent-hover: rgba(245, 245, 247, 0.8);
--accent-muted: rgba(245, 245, 247, 0.08);
--accent-glow: rgba(255, 255, 255, 0.25);
--accent-gradient: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
```

> **TRADING APP (2026-07-03): Spectre is BLACK & WHITE.** The trading platform's
> default accent channel (`src/styles/design-tokens.css`) is **warm white
> `#F5F5F7`** - the electric-lime experiment is RETIRED. The `--lime*` variable
> names still exist for legacy consumers but resolve to the warm-white ramp;
> never reintroduce a hue there. Hue in the trading UI exists only as market
> semantics (`--up` mint / `--down` coral), per-token accents (useAccentTheme
> re-tints the accent channel from the token's own brand on token pages), and
> user-picked accents in the Appearance Studio. LIVE dots, active-view markers,
> focus rings, X-confirmed marks = warm white.

> **TRADING APP (2026-09-11): money values are GREEN/RED in the TEXT pair,
> Geist 500.** Approved by Gleb on the transactions tape ("I love it"). The
> `$` size of a trade, PnL, and the BUY/SELL label use `--up-text #46B87D` /
> `--down-text #DE5759` (`src/styles/design-tokens.css`) - GMGN's own text
> green/red, read off their CSS, not the screenshot. At 13-14px these read as
> a clear green/red; the soft mint `--up-soft #5CE6A1` at 600 read as a pale
> tint that lost to the white digits beside it, and a warm-white `$` value was
> REJECTED outright ("no, I need the $equivalent be in red or green"). Rules:
> - Font = `--font-num-chip` (Geist - the same family GMGN uses; the family
>   was never the difference, the cut was). 14px, weight **500**, tabular
>   digits. 600/700 turns the green muddy; do not "fix" legibility with weight.
> - `--up`/`--down` stay for fills, bars, glows; `--up-soft`/`--down-soft` for
>   chart palettes; `--up-text`/`--down-text` for TEXT. One green and one red
>   per row - never a mint label beside a deeper green number.
> - Light mode: the text pair vanishes on white; use `#047857` / `#b91c1c`.
>
> **Tape row anatomy (same date, approved):** row opens with the wallet's
> round pfp (`WalletAvatar`, deterministic sigil from the address, 22px);
> AGE / TYPE / PRICE / AMOUNT; SIZE = coloured `$` value + muted native sub in
> a fixed 118px text column, then the 22px gradient size pill to its RIGHT
> (never the value ON the pill); MAKER = [platform tile 18px squared][address]
> [maker-type badge] with the tile and badge in FIXED slots so every address
> starts on one x, and the position bar on line 2 starts exactly under the
> address. Platform tiles are the platform's REAL logo
> (`public/trade-sources/`, 18/36/54 srcset), rounded-square 4px, left of the
> address. See `TradeSourceIcon.jsx`, `WalletAvatar.jsx`, `DataTabs.jsx`.

### Secondary Accents (use sparingly, contextual only)
```css
--cyan: #06B6D4;     /* links, info */
--amber: #F59E0B;    /* warnings */
--violet: #A78BFA;   /* EUPHORIA market state ONLY - never regular UI */
--pink: #EC4899;     /* special highlights */
--blue: #3B82F6;     /* informational */
```

### Borders - Near-invisible, Apple-style
```css
--border-subtle: rgba(255, 255, 255, 0.03);
--border-default: rgba(255, 255, 255, 0.04);
--border-strong: rgba(255, 255, 255, 0.06);
--border-accent: rgba(245, 245, 247, 0.1);
```

### Shadows - Layered depth
```css
--shadow-sm: 0 2px 8px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.2);
--shadow-md: 0 4px 16px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2);
--shadow-lg: 0 4px 24px rgba(0,0,0,0.12), 0 20px 60px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04);
--shadow-xl: 0 16px 48px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
--shadow-glow: 0 0 40px rgba(255, 255, 255, 0.08);
--shadow-inner: inset 0 1px 0 rgba(255, 255, 255, 0.04);
```

---

## B. Typography

### Font Stacks
```css
--font-display: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
--font-body:    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Inter', system-ui, sans-serif;

/* Trading app — ACTUAL tokens (src/styles/design-tokens.css, post-Geist migration) */
--font-display / --font-body / --font-num-chip: 'Geist', Inter, system-ui, sans-serif;        /* sans, ROUND zeros */
--font-mono:    'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;     /* REAL monospace, SLASHED/"crossing" zero */

/* Research app (Inter first for body harmony) */
--font-mono:    'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
```
- **Headings**: `var(--font-display)`, weight 600-700, tight letter-spacing
- **Body**: `var(--font-body)`, weight 400-500
- **Numbers/prices/percentages/addresses (TRADING)**: use `var(--font-num-chip)` (Geist **sans**, ROUND zeros). Do NOT reach for `var(--font-mono)` on numbers/CAs — in the trading app it is **Geist Mono**, a REAL monospace with a SLASHED/"crossing" zero that reads as Bloomberg / AI-slop and that the team rejects on sight. `--font-mono` is reserved for the rare deliberately-terminal surface (and `font-feature-settings: 'zero' 0` does NOT undo Geist Mono's default slashed zero). The RESEARCH-app `--font-mono` above is still the system-sans stack — the "NOT a real monospace" wording only ever applied to research.

### Type Scale
| Class | Size | Weight | Spacing | Use |
|-------|------|--------|---------|-----|
| `.display-hero` | clamp(2.5-4.5rem) | 700 | -0.04em | Hero headlines |
| `.display-xl` | 3rem | 700 | -0.035em | Page titles |
| `.display-lg` | 2.25rem | 700 | -0.03em | Section titles |
| `.display-md` | 1.75rem | 600 | -0.025em | Card titles |
| `.display-sm` | 1.375rem | 600 | -0.02em | Panel headings |
| `.heading` | 1.125rem | 600 | -0.01em | Component headings |
| `.subheading` | 0.75rem | 600 | 0.08em | Uppercase labels |
| `.body-lg` | 1.0625rem | - | - | Descriptions |
| `.body` | 0.9375rem | - | - | Default body |
| `.body-sm` | 0.8125rem | - | - | Secondary info |
| `.caption` | 0.75rem | - | - | Timestamps, meta |

### OpenType Features
```css
body { font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11'; }
```

### Editorial Type (research app ONLY)

The research app is the "investor newsroom" surface. AI briefs, intelligence quotes, cinema-mode headlines, landing-page hero copy use serif italic for editorial voice. The trading app is the "execution desk" - pure system sans, no serif accents. This contrast is intentional. Do NOT bring editorial serif into the trading app, and do NOT strip it from the research app.

| Font | Where it lives | Used for |
|------|---------------|----------|
| **Playfair Display** | `brief-tab.css`, `welcome-page.cinema-mode.css`, `brain-page.css`, `discover-page.css`, `token-storybook.css`, `WarRoomTab.css`, `ai-charts-lab-page.css`, `ventures-page.css` | AI Brief sentences, intelligence quotes, cinema-mode editorial layer, verdict hooks, narrative pull-quotes |
| **Instrument Serif** | `lp.css` (landing page) | LP hero headlines, dramatic display copy |
| **Space Grotesk** | `header.css` (4 surfaces), `demo-mode.css` | Header chrome accents, demo / showcase mode labels |

Editorial serif is applied DIRECTLY via `font-family: 'Playfair Display', Georgia, serif;` - not via a `--font-serif` variable, because the usage is intentionally scoped and contextual. Each editorial surface picks the serif explicitly so the system-sans default stays the rule everywhere else.

**Loaded in `apps/research/index.html`:** Inter, Space Grotesk, Instrument Serif, Playfair Display, JetBrains Mono. Outfit and Nunito were previously loaded but are unused - safe to drop. JetBrains Mono is loaded because some niche surfaces (embed-chart, facts, research-zone compare picker) request monospace directly; those exceptions are scoped and do not invalidate the system-sans direction elsewhere.

### Research vs Trading - intentional divergence

| Surface | Research app | Trading app |
|---------|--------------|-------------|
| Default UI (numbers, body, chrome) | System sans (SF Pro / Segoe UI) | System sans (SF Pro / Segoe UI) |
| Editorial copy (briefs, quotes, headlines) | Playfair Display italic | Not used |
| Landing page hero | Instrument Serif | Not applicable |
| Header chrome accents | Space Grotesk | System sans |

If you're making the apps "consistent" by adding serif to trading or removing serif from research, STOP - that consistency is wrong. The split is the brand: research publishes, trading executes.

---

## C. Spacing, Radius & Transitions

### Spacing - 4px base
```css
--sp-1: 4px;  --sp-2: 8px;   --sp-3: 12px;  --sp-4: 16px;
--sp-5: 20px; --sp-6: 24px;  --sp-8: 32px;  --sp-10: 40px;
--sp-12: 48px; --sp-16: 64px;
```
Section gaps: `--section-gap: 72px`, `--section-gap-tight: 32px`

### Radius
```css
--radius-xs: 4px;   --radius-sm: 8px;   --radius-md: 12px;
--radius-lg: 16px;  --radius-xl: 24px;  --radius-2xl: 32px;  --radius-full: 9999px;
```

### Transitions
```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);        /* primary - Apple keynote */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);      /* secondary */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* bouncy elements */
--duration-instant: 100ms; --duration-fast: 150ms;
--duration-base: 250ms; --duration-slow: 400ms; --duration-slower: 600ms;
```

---

## D. Glass & Surface System

### Glass Card (primary pattern - copy exactly)
```css
.glass-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);      /* rgba(255,255,255,0.04) */
  border-radius: var(--radius-lg);            /* 16px */
  box-shadow: var(--shadow-inner), var(--shadow-md);
  transition: all var(--duration-base) var(--ease-out);
}
.glass-card:hover {
  border-color: var(--glass-border-light);    /* rgba(255,255,255,0.035) */
  box-shadow: var(--shadow-inner), var(--shadow-lg);
  transform: translateY(-1px);
}
```

### Glass Variants
| Variant | Background | Blur | Use |
|---------|-----------|------|-----|
| `.glass` (heavy) | `rgba(9,9,11,0.88)` | 24px + saturate(180%) | Panels, sidebars |
| `.glass-card` | gradient 0.05->0.02 white | 20px | Cards, content blocks |
| `.glass-subtle` | `rgba(255,255,255,0.02)` | 12px | Minimal overlay surfaces |

### Glass Custom Properties
```css
--glass-bg: rgba(9, 9, 11, 0.88);
--glass-bg-light: rgba(255, 255, 255, 0.025);
--glass-border: rgba(255, 255, 255, 0.04);
--glass-border-light: rgba(255, 255, 255, 0.035);
--glass-glow: rgba(255, 255, 255, 0.05);
--glass-charcoal: #111113;
--glass-radius-card: 16px;
--glass-radius-pill: 9999px;
```

---

## E. Component Patterns

### Buttons

**Primary** (`.btn-primary`) - filled accent:
```css
padding: var(--sp-3) var(--sp-5); /* 12px 20px */
background: var(--accent-gradient); border: none;
border-radius: var(--radius-md); font-weight: 600; font-size: 0.875rem;
box-shadow: 0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15);
/* Hover: translateY(-2px), stronger shadow */
/* Active: translateY(0) */
```

**Secondary** (`.btn-secondary`) - glass bordered:
```css
padding: var(--sp-3) var(--sp-5);
background: var(--glass-bg); backdrop-filter: blur(12px);
border: 1px solid var(--border-default); border-radius: var(--radius-md);
font-weight: 500;
/* Hover: bg var(--bg-hover), border var(--border-strong), translateY(-1px) */
```

**Ghost** (`.btn-ghost`) - transparent:
```css
padding: var(--sp-2) var(--sp-3); /* 8px 12px */
background: transparent; border: none; border-radius: var(--radius-sm);
color: var(--text-secondary);
/* Hover: bg var(--glass-bg-light), color var(--text-primary) */
```

### Cards

**Token Card** (top coins, brief tokens):
- Glass card base + token logo (32px circle) + name + symbol + price (mono) + 24h change badge
- 7-day sparkline canvas, colored by change direction (green/red)
- Hover: translateY(-2px), border brightens, shadow upgrades

**Stat Card** (horizontal bar stats):
- Vertical: label (`.caption`, `--text-tertiary`) + value (mono, `--text-primary`) + optional change badge
- Compact: 8-12px padding

**News Card** (news tab):
- Optional thumbnail (border-radius: `--radius-sm`)
- Headline (weight 500) + source badge pill + timestamp (`.caption`)

### Tabs

**Horizontal Tab Bar** (Welcome page):
- Row of buttons on glass background strip
- Active: `--text-primary`, subtle bottom indicator line (absolute positioned, transitions left/width)
- Inactive: `--text-tertiary`
- `glass-select` dropdown variant for overflow tabs

### Tooltips

**Global System** (`.spectre-tooltip`, JS-driven via `data-tooltip` attr):
```css
position: fixed; z-index: 2147483647;
padding: 6px 12px; font-size: 12px; font-weight: 500;
background: rgba(18, 18, 20, 0.98);
border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
box-shadow: 0 4px 16px rgba(0,0,0,0.35), inset 0 0.5px 0 rgba(255,255,255,0.06);
/* Entry: opacity 0->1, translateY(4px)->0, 150ms */
```

**Token Card Popup** (hover card on token names):
- Full glass card: logo + name + symbol + price + change + sparkline + market cap
- JS positioned near hover target; used in watchlist, discovery, horizontal bar

### Badges

**Change Badge** (price %): pill shape, `--bull-muted`/`--bear-muted` bg, mono font, always +/- sign
**Source Badge** (news): `--bg-elevated` bg, `--text-tertiary`, 0.6875rem, optional 16px icon

### Inputs

**Search Bar** (Whisper Search in header): glass bg, rounded, icon left, kbd shortcut badge right, focus glow ring
**Standard** (`.input`): `--bg-surface` bg, `--border-default` border, focus: `--accent` border + `0 0 0 3px var(--accent-muted)`

### Skeleton Loaders (NEVER spinners)
```css
.animate-shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 2s infinite;
}
```
Match shape/size of target. Stagger: `.stagger-1` through `.stagger-5` (50ms increments).

---

## F. Interactive Patterns

### Hover States (every interactive element)
- Cards: `translateY(-1px)` to `translateY(-2px)`, border brightens one step, shadow upgrades one tier
- Primary buttons: `translateY(-2px)`, Secondary: `translateY(-1px)`
- All: `transition: all var(--duration-base) var(--ease-out)`

### Active/Click
- Buttons: `translateY(0)` spring-back
- Cards: `scale(0.98)` press feedback

### Focus
```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: var(--radius-sm); }
```

### Scrollbar
```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: var(--radius-full); }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
```

### Status Indicator (live dot)
8px green circle with pulse animation + `box-shadow: 0 0 8px var(--bull-glow)`

---

## G. Layout Patterns

### Welcome Page Structure
```
[Header - sticky, full width, glass bg]
[Horizontal Bar - market stats row, overflow-x: auto]
[Main Area]
  +-- Tab Bar (Brief|News|Liquidation|Heatmap|Sectors|Mindshare|Calendar|Flows)
  +-- Tab Content (CSS grid, responsive columns)
  +-- Discovery Panel (right sidebar, desktop only)
```

### Card Grid
```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
gap: var(--sp-3);
```

### Responsive
- Desktop: 3-column (sidebar + content + sidebar)
- Tablet (~768px): 2-column, collapse right sidebar
- Mobile (~480px): single column, horizontal scrolls become stacks

---

## H. Day Mode

Every dark style needs a day-mode counterpart. No exceptions.

> **CRITICAL — the selector differs per app.** Research uses `.app.app-day-mode`.
> The **TRADING app uses `body.theme-light`** (toggled in `App.jsx` / `Header.jsx`)
> and NEVER applies `.app.app-day-mode`. So `.app.app-day-mode` rules in a trading
> component are DEAD CODE (many trading CSS files contain such dead rules - do not
> copy them). Trading day-mode rules MUST be `body.theme-light .your-class { ... }`.
> Also note: the trading "obsidian" tokens (`--text-1..4`, `--ob-surface-*`,
> `--glass-*`) are NOT redefined under `body.theme-light`, so a token-only
> component stays dark in day mode - you must set explicit light colors in the
> `body.theme-light` rules. Verify which class is on `document.body` before writing
> day-mode CSS; grep the component's neighbors (e.g. `DataTabs.css` has 91
> `body.theme-light` rules) for the established pattern.

```css
/* research */            .app.app-day-mode .your-card { background:#fff; color:#0f172a; ... }
/* trading  */            body.theme-light .your-card  { background:#fff; color:#0f172a; ... }
```
Day mode text: `#0f172a` (primary), `#475569`/`#64748b` (secondary). Day mode bg: `#ffffff` (cards), `#f8f9fa`/`#f5f5f7` (page).

---

## I. Animation Catalog

| Name | Effect | Class |
|------|--------|-------|
| `fadeIn` | opacity 0->1 | `.animate-in` |
| `fadeInUp` | +translateY(20->0) | `.animate-fade-up` |
| `fadeInDown` | +translateY(-20->0) | `.animate-fade-down` |
| `scaleIn` | +scale(0.9->1) | `.animate-scale` |
| `slideInLeft` | +translateX(-30->0) | `.animate-slide-left` |
| `shimmer` | bg-position slide | `.animate-shimmer` |
| `pulse` | scale 1->0.98->1, 2s | `.animate-pulse` |
| `breathe` | glow oscillation, 3s | `.animate-breathe` |
| `float` | translateY(0->-6->0), 4s | `.animate-float` |
| `borderGlow` | border+shadow pulse | direct keyframe |

Stagger: `.stagger-1` (50ms) through `.stagger-5` (250ms)

---

## J. Logo & Branding

- **SPECTRE logo**: `spectre-logo-icon.svg` (nav), `spectreLogoGlow.svg` (with glow)
- **Token logos**: CoinGecko `coin.image.small`. Fallback: circle with initial + brand color from `tokenColors.js` (200+ tokens)
- **News source icons**: per-source in constants, 16px inline
- **Never show**: "Powered by AI", robot/brain/sparkle icons. Intelligence is invisible.

---

## K. Instant Failures

| DO NOT | Why |
|--------|-----|
| Bright gradient hero (blue-to-purple) | AI SaaS from 2024 look |
| Neon glows / bright colored borders | Gaming, not finance |
| Robot / brain / sparkle icons | We are a FINANCE product |
| "Powered by AI" badges | Intelligence is invisible |
| `background: #1a1a1a` or flat cards | No depth - cheap |
| Purple/blue as primary color | Warm-white #f5f5f7 only |
| Numbers in JetBrains Mono or visible monospace | Apple-cinematic uses system sans-serif for numbers too |
| Spinners / loading wheels | Shimmer skeletons only |
| Emojis as UI elements | Never |
| Skeleton without shimmer | Static gray = broken |
| "Loading..." text | Shimmer only |
| Inline styles for tokens | CSS custom properties |
| Visible thin separator borders | Borders near-invisible |

**Icon rules:** Research = `spectreIcons` only. Trading = `lucide-react`.

---

## L. Website2 Landing Page - Font & Style Overrides

**Website2 (`/website2`) uses a completely different font stack from the main app.** These rules are ABSOLUTE and override all other font rules for website2 pages.

### Font Stack (website2 ONLY)
```css
/* Headings */
font-family: 'Fustat', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

/* Body text AND numbers/prices/percentages */
font-family: 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
```

### BANNED on website2 - NEVER use these
| BANNED | Why |
|--------|-----|
| `JetBrains Mono` | AI slop font - user-rejected multiple times |
| `var(--font-mono)` | Main-app variable - resolves to SF Pro / system sans, not Geist. Use Geist directly on website2. |
| Any monospace font | Slashed zeros look like AI-generated content |
| `font-feature-settings: 'zero'` | Creates slashed zeros - banned |
| Gray/muted text on numbers | Numbers must be clearly visible, full opacity |
| Slashed or dotted zeros | The `0` character must be clean and round |

### Rule: Numbers on website2 use Geist (sans-serif)
On the main app (trading + research), numbers use `var(--font-mono)`, which resolves to the system sans-serif stack (SF Pro on Mac, Segoe UI on Windows). On website2, ALL text including numbers, prices, percentages, and contract addresses uses `'Geist'` sans-serif. No exceptions. Both surfaces are sans-serif by design - the only difference is the font family (system on the main app, Geist on website2).

This override applies to `website2.css`, `feature-canvas.css`, and any future website2 component CSS files.
