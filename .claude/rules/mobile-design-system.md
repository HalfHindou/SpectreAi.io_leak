---
paths:
  - "apps/research/src/styles/mobile-2026.css"
  - "apps/research/src/components/mobile-*"
  - "apps/research/src/pages/**/mobile-*"
  - "apps/research/src/pages/**/*.mobile.css"
  - "apps/research/src/hooks/useSwipeNavigation.js"
---

# Spectre Mobile Design System

**Reference implementation:** Welcome page (`apps/research/src/pages/home/`)
**Token source:** `apps/research/src/styles/mobile-2026.css`
**Status:** Building — patterns are codified as they're proven on the Welcome page, then applied to all 28 pages.

---

## A. Breakpoint Ladder

| Name | Query | Use |
|------|-------|-----|
| Mobile | `max-width: 768px` | Primary breakpoint — all mobile components activate here |
| Small mobile | `max-width: 380px` | Compact overrides for iPhone SE / narrow Android |
| Tablet | `769px – 1024px` | 2-column layouts, larger touch targets retained |
| Desktop | `min-width: 1025px` | Full desktop layout (default, no query needed) |

**Rule:** Use `768px` as THE mobile breakpoint. Do not introduce new arbitrary breakpoints. Use `380px` only for narrow-screen fixes.

---

## B. Mobile CSS Tokens

All mobile tokens are scoped inside `@media (max-width: 768px)` in `mobile-2026.css`. Use `--m-*` prefix for mobile-specific values.

### Spacing (tighter than desktop)
```css
--m-xs: 4px;    --m-sm: 8px;    --m-md: 12px;   --m-lg: 16px;
--m-xl: 20px;   --m-2xl: 28px;  --m-3xl: 36px;
```

### Typography (fluid scale)
```css
--m-text-xs: 0.6875rem;    /* 11px */
--m-text-sm: 0.75rem;      /* 12px */
--m-text-base: 0.8125rem;  /* 13px */
--m-text-md: 0.875rem;     /* 14px */
--m-text-lg: 1rem;         /* 16px */
--m-text-xl: 1.125rem;     /* 18px */
--m-text-2xl: 1.375rem;    /* 22px */
--m-text-3xl: 1.625rem;    /* 26px */
--m-text-hero: clamp(1.75rem, 6vw, 2.5rem);
```

### Layout
```css
--m-header-h: 52px;
--m-bottom-nav-h: 76px;
--m-content-pad: 8px;
--m-card-radius: 10px;
--m-card-radius-lg: 14px;
```

### Performance (reduced for mobile GPU)
```css
--m-blur: blur(8px);           /* max blur on mobile — NEVER use blur(20px) */
--m-blur-heavy: blur(12px);    /* absolute maximum, use sparingly */
--m-saturate: saturate(150%);
```

---

## C. Mobile Shell

### Header (`mobile-header.jsx` + `mobile-header.css`)
- Height: `--m-header-h` (52px), fixed at top
- Glass background with reduced blur (`--m-blur`)
- Layout: hamburger left | logo center | tools right
- Safe area: `padding-top: env(safe-area-inset-top)` in standalone/PWA mode
- Inline SVG icons (no `spectreIcons` dependency — avoids bundle coupling)

### Bottom Nav (`mobile-bottom-nav.jsx` + `mobile-bottom-nav.css`)
- Height: `--m-bottom-nav-h` (76px), fixed at bottom
- 4+1 Robinhood layout: Home | Markets(dropdown) | Search(elevated center) | Social(dropdown) | Profile(dropdown)
- Glass background, safe area padding at bottom
- Active state: `strokeWidth: 2.5` (bolder), no fill change
- Haptic press states via `scale(0.92)` on `:active`

### Content Area
```css
.app-main-content {
  padding-top: var(--m-header-h);      /* 52px - below fixed header */
  padding-bottom: var(--m-bottom-nav-h); /* 76px - above fixed bottom nav */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

---

## D. Anti-Wobble (mandatory on every mobile page)

Prevents horizontal rubber-banding and floating feel. Applied globally in `mobile-2026.css`:

```css
html, body { overflow-x: hidden !important; overscroll-behavior-x: none !important; }
#root, .app { overflow-x: hidden !important; width: 100% !important; max-width: 100vw !important; }
.app { height: 100dvh !important; overscroll-behavior: contain !important; }
```

**Rule:** Never set `overflow-x: auto` or `overflow-x: scroll` on a full-page container on mobile. Horizontal scroll is only for inner carousels/strips.

---

## E. Component Patterns

### E1. Mobile Glass Card

Lighter than desktop glass — reduced blur, thinner borders:

```css
.mobile-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--m-card-radius);     /* 10px, not 16px */
  backdrop-filter: var(--m-blur);           /* 8px, not 20px */
  -webkit-backdrop-filter: var(--m-blur);
}
```

**Proven in:** `mobile-brief-card.css`, `mobile-quick-stats.css`, `mobile-watchlist-strip.css`

### E2. Horizontal Scroll Strip / Watchlist Strip - CMC-matched

Used for watchlist, category pills, tab overflow. Updated 2026-03-28:

```css
.strip-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  padding: 12px 16px;            /* 12px vertical breathing room */
}
.strip-scroll::-webkit-scrollbar { display: none; }
.strip-item { scroll-snap-align: start; flex-shrink: 0; }
```

Watchlist card specs (CMC-matched):
- Card: 88px wide, 96px min-height, 10px 8px padding
- Token logo: 44px diameter (up from 24px)
- Symbol: 13px semibold, price: 13px mono, change: 12px with arrow
- Section header: 22px bold 700 (matches all section headers)

**Proven in:** `mobile-watchlist-strip.css` (`.mws-scroll`)

### E3. Token Row (list item) - CMC-matched

72px min-height row for any token list (updated 2026-03-28):

```
┌──────────────────────────────────────────────────────┐
│ [Logo 40px] Name 15px 600    [Sparkline] Price 15px  │
│             Symbol 12px       mcap 12px  [+2.3% pill]│
└──────────────────────────────────────────────────────┘
```

- 40px logo circle with brand color fallback from `tokenColors.js`
- Name: 15px semibold (600), price: 15px mono tabular-nums
- Change badge: 13px pill, 12px border-radius, padding 4px 8px, green/red bg 0.12 alpha
- Row separator: indented pseudo-element (starts at 56px from left), not full-width border
- Row padding: 12px vertical, 16px horizontal
- Tap-to-expand reveals market cap, volume, 7d change, action buttons (expanded padding aligned to 68px)
- Inline SVG sparkline (subsampled to ~20 points, no chart library)
- `React.memo` with custom comparator for list performance

**Proven in:** `mobile-token-list.jsx`

### E4. Stat Card (2x2 grid) - CMC-matched

Updated 2026-03-28 to match native app sizing:

```css
.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 0 16px;
}
.stat-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--radius-md, 12px);
  padding: 12px 16px;
  min-height: 80px;
}
```

- Value: 22px bold (700) mono - the number IS the content, make it dominant
- Label: 11px uppercase tracking-wide, muted, ABOVE the value
- Change: 13px pill below value, 3px 8px padding, 8px radius

**Proven in:** `mobile-quick-stats.css`

### E5. Content Tabs (swipeable)

Tab bar + swipe content container:

- Horizontal scroll tab bar with animated indicator (absolute positioned, transitions `left` + `width`)
- Content wrapped in `useSwipeNavigation` for swipe-to-navigate
- ARIA: `role="tablist"`, `role="tab"`, `aria-selected`, `role="tabpanel"`
- Section header pattern: icon left + title + expand button right

**Proven in:** `mobile-content-tabs.jsx` + `mobile-content-tabs.css`

### E6. Skeleton Loader

Same shimmer as desktop but scoped to mobile sizes:

```css
.mobile-skeleton {
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 2s infinite;
  border-radius: var(--m-card-radius);
}
```

**Rule:** Match exact shape/size of target element. Use `stagger-1` through `stagger-5` for lists.

### E7. Section Headers - CMC-matched (added 2026-03-28)

All section headers use the same scale for visual consistency:

```css
.section-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary, #f5f5f7);
  letter-spacing: -0.02em;
}
```

- Space above section: 24px minimum (margin-top)
- Space below header: 12px (margin-bottom)
- Section action buttons: 13px, min-height 44px touch target
- Greeting text: 24px bold 700 (slightly larger than section headers)
- Title icons: 18px (up from 16px)

**Applies to:** `.mh-section-title`, `.mh-trending-title`, `.mws-header-label`

---

## F. Gesture Patterns

### F1. Swipe Navigation (`useSwipeNavigation.js`)

Hook for horizontal swipe between tabs/panels:

- 15px dead zone before committing direction (horizontal vs vertical)
- Rubber-band effect at edges (50% distance reduction)
- Refs for gesture tracking (avoids handler recreation)
- CSS `touch-action` toggled dynamically (not `preventDefault`)
- Threshold: 50px to trigger tab change

**Usage:**
```jsx
const { swipeOffset, isSwiping, handlers } = useSwipeNavigation({
  items: tabs, activeIndex, onIndexChange, containerRef
})
// Apply to container: {...handlers} + transform: translateX(swipeOffset)
```

### F2. Pull to Refresh (`usePullToRefresh.js`)

**Status: CREATED** in Phase 1B. Hook at `src/hooks/usePullToRefresh.js`, wired into Welcome page.

- Detects vertical pull-down gesture when scroll parent is at top
- 15px dead zone for direction locking (same as swipe navigation)
- Rubber-band resistance past threshold (0.4x factor, 120px max)
- Default threshold: 64px to trigger refresh
- Finds scroll ancestor automatically (`.app` on mobile, not the content div)
- CSS touch-action toggling (no preventDefault)
- States: `idle` | `pulling` | `threshold` | `refreshing`
- Arrow icon rotates 180deg when threshold reached; spinner on refresh

**Usage:**
```jsx
const { pullState, pullDistance, containerProps } = usePullToRefresh({
  onRefresh: async () => { await refetchData() },
  enabled: isMobile,
})
// Spread containerProps onto the content div: <div {...containerProps}>
```

**CSS:** Dark mode base in `welcome-page.mobile.css`, day mode overrides in same file.
Class prefix: `mobile-pull-indicator`.

### F3. Touch Targets

**Minimum 44px** on all tappable elements (Apple HIG). Use padding to enlarge hit area, not visual size:

```css
.tap-target {
  min-height: 44px;
  min-width: 44px;
  /* or use padding to achieve 44px interactive area */
}
```

---

## G. Day Mode Rules

### Standard: BEM double-dash convention

Every mobile component must support day mode via TWO selectors:

```css
/* 1. Global context — app root has the class */
.app.app-day-mode .component-class { ... }

/* 2. Prop-based — for isolated rendering (Storybook, tests) */
.component.component--day .child { ... }
```

**Both must be present on every day mode override.**

### Day mode values (mobile)
```css
/* Backgrounds */
background: #ffffff;                          /* cards */
background: #f8f9fa;                          /* page bg */
/* Text */
color: #0f172a;                               /* primary */
color: #475569;                               /* secondary */
/* Borders */
border-color: rgba(0, 0, 0, 0.08);           /* default */
border-color: rgba(0, 0, 0, 0.12);           /* strong */
/* Shadows */
box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
```

### Known inconsistencies to fix
- `MobileQuickStats` uses `.mobile-quick-stats.day-mode` (missing BEM `--`)
- `MobileBriefCard` uses `.mobile-brief-card.day-mode` (missing BEM `--`)
- `MobileTokenRowSkeleton` day mode uses sibling selector that never matches

---

## H. Performance Rules

### Blur budget
- Max `blur(8px)` on card surfaces (`--m-blur`)
- Max `blur(12px)` for heavy glass only (`--m-blur-heavy`)
- **Never** `blur(20px)` or `blur(24px)` on mobile — kills frame rate on mid-range Android

### GPU compositing
- Use `transform` and `opacity` for animations (GPU-accelerated)
- Avoid animating `width`, `height`, `top`, `left`, `padding` — triggers layout
- `will-change: transform` on swipe containers only (remove after animation)

### List performance
- `React.memo` with custom comparator on token rows
- Inline SVG sparklines subsampled to ~20 points (not full 168-point arrays)
- Skeleton loaders match target dimensions (no layout shift)

### Reduced motion
```css
@media (prefers-reduced-motion: reduce) {
  .mobile-card, .mct, .mws-scroll { animation: none !important; transition: none !important; }
}
```

---

## I. Inline SVG Icon Pattern

Mobile components use inline SVG instead of `spectreIcons` import:

```jsx
const MyIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="..." />
  </svg>
)
```

**Why:** Avoids importing the full icon library. Mobile components should be self-contained and tree-shakeable. The `spectreIcons` object is 50+ icons — importing it into every mobile component adds unnecessary bundle weight.

**Exception:** If a mobile component is used on desktop too (shared), use `spectreIcons`.

---

## J. File Naming Convention

Mobile-specific components: `mobile-{name}.jsx` + `mobile-{name}.css`
Mobile-specific hooks: `use{PascalCase}.js` in `src/hooks/`
Mobile-specific page CSS: `{page-name}.mobile.css` alongside the main CSS

**CSS class prefix:** Short, unique 2-4 letter prefix per component:
- `mct-` = MobileContentTabs
- `mtr-` = MobileTokenRow
- `mws-` = MobileWatchlistStrip
- `mqs-` = MobileQuickStats (uses `mobile-quick-stat-` currently — should migrate)
- `mbc-` = MobileBriefCard (uses `mobile-brief-` currently — should migrate)
- `mcat-` = Categories page mobile (inline in categories-page.jsx, CSS in categories-page.mobile.css)
- `wlm-` = Watchlists page mobile (inline in watchlists-page.jsx, CSS in watchlists-page.mobile.css)
- `mmc-` = Media Center page mobile (inline in media-center-page.jsx, CSS in media-center-page.mobile.css)
- `mfg-` = Fear & Greed page mobile (inline in fear-greed-page.jsx, CSS in fear-greed-page.mobile.css)
- `mbb-` = Bubbles page mobile (early return in bubbles-page.jsx, CSS in bubbles-page.mobile.css)
- `mhm-` = Heatmaps page mobile (early return in heatmaps-page.jsx, CSS in heatmaps-page.mobile.css)
- `mec-` = Economic Calendar page mobile (early return in economic-calendar-page.jsx, CSS in economic-calendar-page.mobile.css)
- `mam-` = AI Market Analysis page mobile (early return in ai-market-analysis-page.jsx, CSS in ai-market-analysis-page.mobile.css)
- `mac-` = AI Charts page mobile (early return in ai-charts-page.jsx, CSS in ai-charts-page.mobile.css)
- `mlh-` = Liquidation Heatmap page mobile (early return in liquidation-page.jsx, CSS in liquidation-page.mobile.css)
- `mvn-` = Ventures page mobile (early return in ventures-page.jsx, CSS in ventures-page.mobile.css)
- `mint-` = Intelligence page mobile (early return in index.jsx, CSS in intelligence-page.mobile.css)
- `pm-mobile` root = Private Markets page mobile (no new prefix: the isMobile prop sets `.pm-page.pm-mobile`, and every override in private-markets-page.mobile.css is scoped under it — the sub-tabs are lazy chunks whose sheets load later)

---

## K. Anti-Patterns (Never Do These on Mobile)

| DO NOT | Why |
|--------|-----|
| `blur(20px)` or higher | Kills frame rate on mobile GPUs |
| `overflow-x: auto` on page container | Causes horizontal bounce/wobble |
| Desktop `--radius-lg` (16px) on cards | Too round for compact mobile; use `--m-card-radius` (10px) |
| Import `spectreIcons` in mobile-only components | Bundle bloat; use inline SVG |
| `position: absolute` for full-viewport backgrounds | Confined to parent; use `position: fixed` |
| Animate `width`/`height`/`top`/`left` | Layout thrash; use `transform` + `opacity` |
| Spinners or "Loading..." text | Shimmer skeletons only |
| Touch targets under 44px | Fails Apple HIG, causes mis-taps |
| `e.preventDefault()` on touch events | Passive listener violation in React; toggle `touch-action` via CSS instead |
| Sibling selector for skeleton day mode | `.parent--day ~ .skeleton` never matches; pass class from parent |
| Rely on CSS alone to hide desktop sections on mobile | CSS `display:none` in media queries is fragile; always use JSX `{!isMobile && ...}` guards for desktop-only sections |
| Bulk `replace_all` on CSS day-mode selectors | Comma-grouped selectors break child targeting; rewrite each rule individually |
| Adding a mobile section that duplicates data from another section | Before adding, check: "Does any existing section already show this data?" MobileBriefCard + Command Center AI Brief tab = same `briefDisplay` shown twice |
| Assuming padding-top clears the header without tracing the full cascade | Parent `padding: Xpx !important` (shorthand) can reset padding-top. Always trace: app-main-content → page wrapper → content container. Use `!important` on `.welcome-mobile-content` padding-top AND set `.welcome-page { padding-top: 0 !important }` on mobile |
| Not checking what renders AFTER the `{isMobile && ...}` closing brace | Sections after `)}` are visible on ALL viewports. Every section must be explicitly `{!isMobile && ...}` guarded |

| Disabling CC content swipe without also removing the translateX transform | The swipe handler applies `transform: translateX(offset)` to `.mct-content-inner`, moving ALL children. Disable both the handlers AND the transform |
| Using `animation` shorthand in CSS when inline `animationDuration` is set | CSS `animation` shorthand resets ALL sub-properties including duration. Use `animation-name`, `animation-timing-function`, `animation-fill-mode` as separate longhand properties |
| Forgetting `.welcome-page * { animation-duration: 0.2s !important }` caps ALL animations | This rule in `welcome-page.css` mobile block kills any animation over 0.2s. Exempt specific elements with `:not(.class-name)` |
| Rendering both `<img>` and fallback `<span>` simultaneously for token logos | Hide fallback with `display: none` inline when `token.image` exists; only show fallback via `onError` handler |

---

## L. Cinematic Premium Design Language (Session 3 - proven patterns)

**Philosophy:** Content floats on a deep black void. Cards are invisible - the data IS the interface. System fonts for native feel. Whisper-quiet chrome, confident numbers.

### L1. Typography - System Font for Numbers

On mobile, ALL prices, changes, and numeric values use the system sans-serif with tabular figures instead of JetBrains Mono. This gives a native fintech feel (Robinhood/Coinbase style).

```css
/* Applied via welcome-page.mobile.css overrides */
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif !important;
font-variant-numeric: tabular-nums !important;
```

**Targets:** `.mtr-price`, `.mtr-change`, `.mws-card-price`, `.mws-card-change`, `.mobile-quick-stat-value`, `.mobile-quick-stat-change`, `.mh-token-price`, `.mh-token-change`, `.mmp-chip-price`, `.mmp-chip-change`, `.mht-card-change`, `.mht-card-price`

**Desktop stays JetBrains Mono** - dashboard aesthetic fits there.

### L2. Card Surfaces - Transparent, Not Glass

Cards should be nearly invisible. The content floats on the void - no card edges competing for attention.

| Element | Background | Border | Box-shadow |
|---------|-----------|--------|------------|
| Watchlist cards | `transparent` | `none` | `none` |
| Quick stat cards | `rgba(255,255,255,0.02)` | `none` | `none` |
| Highlight pills | `transparent` | `0.5px solid rgba(255,255,255,0.05)` | `none` |
| Market pulse chips | `transparent` | `0.5px solid rgba(255,255,255,0.04)` | `none` |
| Token rows | no background | separator `rgba(255,255,255,0.025)` | `none` |

### L3. Section Headers - Uppercase Labels

All section headers use the same treatment: tiny uppercase labels that identify without competing.

```css
font-size: 11px;
font-weight: 600;
letter-spacing: 1.5px;
text-transform: uppercase;
color: rgba(245, 245, 247, 0.35);
```

**No icons on section headers.** Hide `.mht-header-icon`, `.mct-header-icon`, `.mds-header-icon`.

**Applies to:** Highlights, My Watchlist, Command Center, Discover headers.

### L4. Toggle Pills - Ghost Capsules with Glow Active

All interactive pill/chip toggles share one treatment. Inactive = text only, active = soft fill + glow.

```css
/* Inactive */
background: transparent;
border: none;
color: rgba(245, 245, 247, 0.3);
font-size: 12px;
height: 28px;
padding: 0 12px;
border-radius: 14px;

/* Active */
background: rgba(255, 255, 255, 0.06);
color: #f5f5f7;
font-weight: 600;
border: 0.5px solid rgba(255, 255, 255, 0.08);
box-shadow: 0 0 12px rgba(245, 245, 247, 0.06), inset 0 0.5px 0 rgba(255, 255, 255, 0.1);
```

**Applies to:** sort pills (`.mtl-pill`), category chips (`.mds-chip`), highlight pills (`.mht-pill`), fullview tabs, fullview sort pills.

### L5. Market Pulse - Ambient, Not Primary

The top market ticker is ambient information, not primary content. Transparent background, no separator bar.

```css
.mmp { background: transparent; border-bottom: none; }
.mmp-chip { background: transparent; border: 0.5px solid rgba(255,255,255,0.04); }
.mmp-chip-price { color: rgba(245,245,247,0.9); font-size: 14px; font-weight: 600; }
.mmp-chip-symbol { color: rgba(245,245,247,0.5); }
```

**Only show BTC, ETH, SOL price chips.** Stat chips (F&G, Dominance, MCap) live in Quick Stats section - no duplication.

### L6. AI Brief - Cinematic Dark Canvas

The AI Brief is a keynote slide - dark canvas, centered italic text, ambient glow.

```css
.cab-tab-content {
  min-height: 300px;
  padding: 24px 20px 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 100%);
  border-radius: 20px;
  border: 0.5px solid rgba(255,255,255,0.04);
}
```

- **Glow:** soft radial gradient behind text at 50% opacity
- **Text:** 18px, line-height 1.7, centered, italic (Playfair Display)
- **Decorative quotes:** 48px, `rgba(0.04)` opacity - felt, not seen. Hidden on AI Outlook (long text) slide
- **Dots:** 4px inactive at 10%, 4px active at 20%. Progress ring 16px, stroke 20%, 1px width
- **Stats row:** horizontal scroll with `touch-action: pan-x`, mask-image fade on right edge
- **Eyebrow:** 10px, 2px letter-spacing, 20% opacity. "Listen" in capsule pill

### L7. Swipe Architecture

**CC tab swipe DISABLED.** The MobileContentTabs component uses tap-only navigation. Swipe on the content area was removed because it conflicted with the AI Brief's slide swipe.

**Brief text swipe** works via touch handlers on `.cab-tab-statement-wrap` with `stopPropagation()` to prevent any parent from catching the gesture.

**Progress ring key:** SVG uses `key={ring-idx-Date.now()}` to force React remount and restart the CSS animation on slide change. The `animation` property is set as a full inline shorthand to prevent CSS shorthand conflicts.

### L8. Overflow Containment Chain

Prevents horizontal blowout on the AI Brief:

```
.mct-content (overflow-x: hidden)
  .mct-content-inner (overflow: hidden, max-width: 100vw)
    .cab-tab-content (overflow: hidden, padding: 16px, box-sizing: border-box)
      .cab-tab-glow (width: 100%, NOT 600px)
      .cab-tab-statement (word-wrap: break-word)
      .cab-tab-chips (overflow-x: auto - only scrollable child)
```

### L9. Full View Overlay

The Discovery full view overlay gets the same cinematic treatment:

- **Backdrop:** `rgba(0,0,0,0.85)`, `blur(24px)`
- **Container:** full screen, `var(--bg-base)` background
- **Header:** two-row layout - title + buttons on row 1, tabs on row 2 (via `flex-wrap` + `order: 10`)
- **Body:** `overflow-y: auto` with all intermediate flex containers set to `flex: none, height: auto, overflow: visible`
- **Token rows:** same system font + premium treatment as main page

### L10. Spacing

```css
.welcome-mobile-content { gap: 4px; }           /* between major sections */
.welcome-mobile-section { padding: 0 8px; }      /* horizontal padding */
.welcome-mobile-section-flush { padding: 0; }    /* full-bleed sections */
```

Sections should feel continuous, not stacked cards. Minimal vertical gaps.

### L11. Cinema Mode - Do Not Touch

Cinema mode (`.cinema-mode`) is a separate editorial layout for the Welcome page. The cinematic premium design language in this section is for the DEFAULT mobile view only. Never modify cinema mode CSS or apply these patterns to cinema mode components.

---

## M. Mobile Page Layout Template

Every mobile page must follow this structure to integrate with the shell (fixed header 52px, fixed bottom nav 76px) and the cinematic design language.

### M1. JSX Structure

```jsx
{isMobile && (
  <div className="mobile-page-content" {...pullContainerProps}>
    {/* Spacer to clear fixed header */}
    <div className="mobile-page-header-spacer" aria-hidden="true" />

    {/* Sections — use semantic wrappers */}
    <div className="mobile-page-section">
      {/* Content with horizontal padding */}
    </div>

    <div className="mobile-page-section-flush">
      {/* Full-bleed content (horizontal scroll strips, charts) */}
    </div>
  </div>
)}
```

### M2. CSS Template (in `{page-name}.mobile.css`)

```css
@media (max-width: 768px) {
  /* Kill parent padding - page owns its own layout */
  .{page-class} {
    padding: 0 !important;
  }

  /* Content container */
  .mobile-page-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: calc(var(--m-header-h, 52px) + env(safe-area-inset-top, 0px) + 8px) 0 8px 0;
  }

  /* Spacer fallback */
  .mobile-page-header-spacer {
    flex-shrink: 0;
    height: 0;
    width: 100%;
  }

  /* Section with horizontal padding */
  .mobile-page-section {
    padding: 0 8px;
  }

  /* Full-bleed section */
  .mobile-page-section-flush {
    padding: 0;
  }

  /* Section headers — uniform uppercase labels */
  .mobile-page-content .section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: rgba(245, 245, 247, 0.35);
  }

  /* System font for all numeric values */
  .mobile-page-content .price,
  .mobile-page-content .change,
  .mobile-page-content .stat-value {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
  }
}
```

### M3. Checklist for New Mobile Pages

1. Create `{page-name}.mobile.css` alongside the main CSS
2. Import it AFTER any responsive CSS: `import './{page-name}.mobile.css'`
3. Add `const isMobile = useIsMobile()` in the page wrapper
4. Wrap mobile layout in `{isMobile && (...)}`
5. Wrap desktop layout in `{!isMobile && (...)}`
6. Use section headers from L3 (11px uppercase, no icons)
7. Use toggle pills from L4 (ghost capsules with glow active)
8. Use system font for numbers from L1
9. Use transparent card surfaces from L2
10. Test at 390px width - no horizontal overflow
11. Test day mode - ensure all custom colors have `.app.app-day-mode` counterparts
12. Verify bottom nav clearance: `padding-bottom: calc(var(--m-bottom-nav-h) + env(safe-area-inset-bottom) + 16px)`

---

## N. Opacity Scale Reference

Single source of truth for all rgba opacity values used across mobile components. All colors are warm-white `245, 245, 247` unless noted.

### N1. Text Hierarchy

| Role | Opacity | rgba | Use |
|------|---------|------|-----|
| Primary | 0.9 | `rgba(245, 245, 247, 0.9)` | Token names, active tab text, hero numbers |
| Secondary | 0.5 | `rgba(245, 245, 247, 0.5)` | Prices in secondary position, symbol labels |
| Muted | 0.3 | `rgba(245, 245, 247, 0.3)` | Inactive pills, secondary info, symbol text |
| Label | 0.25 | `rgba(245, 245, 247, 0.25)` | Section action links ("See All"), stat labels |
| Ghost | 0.2 | `rgba(245, 245, 247, 0.2)` | Rank numbers, eyebrow labels, inactive dots |
| Whisper | 0.15 | `rgba(245, 245, 247, 0.15)` | Inactive dot fills, barely-there text |

### N2. Backgrounds

| Role | Value | Use |
|------|-------|-----|
| Void | `transparent` | Cards, chips, market pulse - most surfaces |
| Tint | `rgba(255, 255, 255, 0.02)` | Quick stat cards - faintest distinction from void |
| Active fill | `rgba(255, 255, 255, 0.06)` | Active toggle pills, active chips |
| Hover/press | `rgba(255, 255, 255, 0.08)` | Press states, some active fills |
| Brief canvas | `linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 100%)` | AI Brief container |

### N3. Borders

| Role | Value | Use |
|------|-------|-----|
| Ghost | `0.5px solid rgba(255, 255, 255, 0.04)` | Market pulse chips, brief container |
| Subtle | `0.5px solid rgba(255, 255, 255, 0.05)` | Highlight pills |
| Active | `0.5px solid rgba(255, 255, 255, 0.08)` | Active sort pills, active fullview tabs |
| Separator | `1px solid rgba(255, 255, 255, 0.025)` | Token row dividers |
| Section | `1px solid rgba(255, 255, 255, 0.03)` | Tab bar bottom border |

### N4. Shadows & Glows

| Role | Value | Use |
|------|-------|-----|
| Active glow | `0 0 12px rgba(245, 245, 247, 0.06), inset 0 0.5px 0 rgba(255, 255, 255, 0.1)` | Active toggle pills |
| None | `none` | Almost everything - shadows feel web-like, not native |

### N5. Change Colors (bull/bear)

| State | Text | Background |
|-------|------|------------|
| Positive | `var(--bull, #10B981)` | `rgba(16, 185, 129, 0.06)` |
| Negative | `var(--bear, #EF4444)` | `rgba(239, 68, 68, 0.06)` |

**Note:** background opacity is 0.06 on mobile (subtler than desktop 0.08-0.12).

---

## O. Page Rollout Tracker

Reference implementation (Welcome page) must be complete before expanding.

| Page | Status | Notes |
|------|--------|-------|
| Welcome (home) | COMPLETE | Phase 1C QA passed: tokens, blur, day mode, touch targets, no-regression |
| Trading hub (apps/trading `#trending`) | COMPLETE | 2026-07-16: `mth-` prefix, `TrendingHub/MobileHub.jsx` early-returned from index.jsx on isMobile — ALL state/fetching stays in the parent, MobileHub only renders. Markets boards reuse `mrow-` MobileTokenRow; Social = compact metric rows (SOCIAL_METRIC); Sectors = 2-col category grid (min-width:0 — long names truncate, not stretch). Screener view excluded on mobile (embeds the desktop table). Day mode complete. |
| Trading mobile home (apps/trading `#discover`) | COMPLETE | 2026-07-16: DexScreener-style shell `components/mobile/home/` — `mhs-` shell (fixed, per-tab scroll containers kept mounted via visibility), `mhn-` bottom nav (Screener/Search/Watchlist/Alerts/Menu + count badges), `msc-` screener (Trending/New/Top pills, board volume + movers tiles, sticky timeframe/chain/sort toolbar, bottom sheets), `mrow-` shared token row (36px logo + chain dot, age chip, 1H/24H magnitude-graded via readCodexChangePct, LIQ/VOL/MCAP chips, live price flash, swipe-right=watch/left=remove, long-press peek `mpk-`), `msrch-` search (recents + trending suggestions), `mwl-` watchlist (fetchTokenDetailsBatch live hook, active-tab-gated 90s poll), `mal-` alerts, `mmn-` menu (theme toggle syncs `spectre-color-mode`). Day mode = `body.theme-light` throughout. Desktop DiscoverPage untouched. |
| Categories | COMPLETE | `mcat-` prefix, inline mobile JSX in categories-page.jsx, categories-page.mobile.css, day mode complete. Includes Categories/Trending page-view toggle (ghost-pill, full-width) + Trending = Momentum Board (`mb-` prefix in momentum-board.css): mobile collapses to Token List Row pattern (transparent rows on void, indented hairline separators at 66px, 40px logo, name 15px/600, meta 12px/0.5, Weighted as key metric, tabular nums). Full scrollable table retained 769-900px. |
| Token detail | NOT STARTED | High priority - iframe into trading app |
| Discover | NOT STARTED | |
| Watchlists | COMPLETE | `wlm-` prefix, isMobile prop from index.jsx, watchlists-page.mobile.css, JSX guards, swipeable rows + bottom sheet, day mode complete |
| Media Center | COMPLETE | `mmc-` prefix, isMobile prop from index.jsx, media-center-page.mobile.css, JSX guards, ghost pill tabs, transparent cards, day mode complete |
| Fear & Greed | COMPLETE | `mfg-` prefix, isMobile prop from index.jsx, fear-greed-page.mobile.css, early return pattern, gauge + chart reused, inline metrics/factors/distribution, day mode complete |
| Bubbles | COMPLETE | `mbb-` prefix, isMobile prop from index.jsx, bubbles-page.mobile.css, early return pattern, canvas viz reused (container-responsive), ghost pills, transparent cards, fullscreen portal, day mode complete |
| Heatmaps | COMPLETE | `mhm-` prefix, isMobile prop from index.jsx, heatmaps-page.mobile.css, early return pattern, grid/treemap/chart views reused, ghost pills, transparent cards, system font, day mode complete |
| Economic Calendar | COMPLETE | `mec-` prefix, isMobile prop from index.jsx, economic-calendar-page.mobile.css, early return pattern, reuses DayView/WeekView/MonthView/NextUpHero/CountdownSidebar/MarketOutlook, ghost pills for view tabs, system font, day mode complete |
| AI Market Analysis | COMPLETE | `mam-` prefix, isMobile prop from index.jsx, ai-market-analysis-page.mobile.css, early return pattern, reuses data hooks, token rows replace table, system font, day mode complete |
| AI Charts | COMPLETE | `mac-` prefix, isMobile prop from index.jsx, ai-charts-page.mobile.css, early return pattern, reuses ChartCard/FullscreenModal, ghost pills, transparent cards, system font, day mode complete |
| Liquidation Heatmap | COMPLETE | `mlh-` prefix, isMobile prop from index.jsx, liquidation-page.mobile.css, early return pattern, reuses canvas views (Heatmap/Levels/3D/Zones), ghost pills, 2x2 metrics, key levels list, system font, day mode complete. 2026-07-29: heatmap panel toolbar collapsed to the §D two-row rule — symbol + timeframe + tune + fullscreen inline, everything else in a `.liqp-hm-sheet` bottom sheet (chrome 280px → 87px); canvas tap no longer pins (ghost-mouse guard), long-press does. |
| Ventures | COMPLETE (all 3 modes, 2026-09-03) | `mvn-` prefix, isMobile prop from index.jsx, ventures-page.mobile.css, early return pattern, reuses SpectreScoreRing + VenturesDetailPanel, featured horizontal scroll, ghost pill filters, deal row list, 2x2 stats, system font, day mode complete. **2026-09-03 — the other two modes got the pass they never had.** Only Deal Flow was ever converted; `viewMode` also renders `<VCIntelHub>` (Smart Money) and `<AcceleratorFeed>` (Accelerators), and both were dropping their raw DESKTOP tree onto the phone — the hub's 3-pane grid, glass panels at blur(10/16/20/24px), 38px tap targets, a 6-col stat grid, filter chips wrapping to three lines, and sub-view breakpoints that stopped at 700/720/760/900px (so 701-768px got no mobile rules at all). Fixed with two new sheets at the mandated 768px: **`vc-intel-hub.mobile.css`** — panes stack (`align-items: stretch` + `min-width: 0`, or `align-items: start` lets each pane size to its widest rail and blow past the viewport), panels dissolve to void, entity + portfolio-company cards become 60px token rows with hairlines indented to 50px, profile stats to a 2-col tinted grid, every tab/filter strip to a ghost-capsule scroll rail, blur zeroed hub-wide; the 78-fund directory keeps an INNER scroller (`max-height: 50vh` + `overscroll-behavior: contain` + mask fade) because inline it is 4400px of list before the profile. Consensus rows get CSS `::before` labels (Pool AUM / Backers / MCap) — the stacked layout drops `.smu-cons-colhead`, which was the only thing saying which of the three bare numbers was which — and `.smu-cons-go` stops being hover-only. **`accelerator-feed.mobile.css`** — hero dissolves, startup cards become rows, batch dropdown + search to 44px, filter chips to a rail; the duplicated eyebrow+title are hidden inside `.mvn-page` (the ventures hero already renders both, costing a screen). Also: `.mvn-mode-btn` 38→44px, shared `.vd-dropdown-trigger` 36→44px and its blur(20px) capped, hub micro-labels 9→10px, and the universe's `Loading universe…` Suspense text replaced with a `vcih-universe-skel` shimmer. Sub-views also got: bubble canvas full-bleed (border/radius dropped at the screen edge) with its 30px zoom/reset buttons at 44px, and the Sector Map's inline `minHeight: 116 + funds*6` neutralised — that height IS the fund-count encoding on a side-by-side desktop treemap, but full-width on a phone it spent ~190px of viewport per sector on empty tint while the meta line already says "20 funds". 🪤 **Every sub-view override must be scoped under `.vcih-root`.** The sub-views (`smu-*`, `vss-*`, `vcb-*`, `vpf-*`, `via-*`, `vai-*`) live in LAZY chunks, so their own stylesheets land AFTER this one and win every same-specificity tie — the 44px zoom buttons and the sector-cell rules silently no-op'd until prefixed. Day mode paired (`.app.app-day-mode` + `.ventures-page.day-mode`) throughout. Verified at 425/395/360px in all three modes: zero horizontal overflow, zero sub-32px targets, zero blur >8px, zero mono font, zero console errors; day mode walked on Smart Money + Accelerators. |
| Intelligence | COMPLETE | `mint-` prefix, isMobile in index.jsx, intelligence-page.mobile.css, early return pattern, reuses data hooks, hero card + category pills + news feed + analysis cards + story scroll strip + daily brief card + market pulse chips, system font, day mode complete |
| Research Zone | COMPLETE+FULL-PARITY | `rzm-` prefix, early-return in `research-zone-lite.jsx` → `research-zone-mobile.jsx`. Full `mobile-crypto-ux` skill applied + complete desktop parity. **Overview**: Token Score card, Live Events strip (horizontal scroll), Price Catalysts list (bull dots + border accent), Sector Performance rows (bars), About + Links + Categories, Performance table, Converter, Stock Key Statistics + Company Profile. **Markets**: sub-tabs (Exchanges / Holders / Predictions) + CEX/DEX + Spot/Perp segmented filters + type chips + Top Holders list with meter bars. **Technicals**: Signal Dashboard (SVG arc verdict gauge + 4 signal meters + derivatives strip funding/OI/LS), Pivot Levels table (R3/R2/R1/P/S1/S2/S3 classical), Moving Averages + Oscillators quick tables with BUY/NEUTRAL/SELL pills, Fundamentals Grade + dimension breakdown, AI Technical Analysis Nansen purple card, Catalysts/Risks tag chips. **Sentiment**: Fear & Greed, Sentiment Score + history sparkline, AI Scenario card (bias + risk chip + bull/bear case blocks), Alt Season Index dial with 3-zone gradient, Narrative Mindshare list with phase chips. **Social**: Social Reach grid, Tweet Analysis sentiment bar (pos/neu/neg stacked), Latest Tweets list. **News**: 64×64 thumbs, SEC filing promotion. Chart toolbar: 2-row collapse (chart-types + Price/MCap + TF dropdown). Sticky header nav, pull-to-refresh, Bell/Share/Star action icons, magnitude-graded change colors throughout. Day mode complete across 40+ new components. Uses `useMarketIntel` for funding/OI/L-S/alt-season/live-events. |
| X Intelligence (force-graph) | COMPLETE | `xig-` prefix for new mobile-only elements (the page reskins existing `xi-*` panels in a dedicated `XIntelligencePage.mobile.css`). **Canvas KEPT** (user choice) — `pages/x-intelligence` is the legacy force-directed social graph, now routed at `/x-bubbles` (gated); `/x-intelligence` URL serves `pages/x-bubbles`. `useIsMobile()` in XIntelligencePage.jsx (no early-return — canvas + all data hooks shared with desktop). Mobile: `.xi-page` pinned `position:fixed` between the 52px header and 76px bottom nav; canvas fills it (d3-zoom touch pan/pinch works as-is). Floating glass panels become bottom sheets above the nav: FilterPanel sheet (collapsed by default + toggle pill bottom-left), EntitySidebar slides up only on an explicit node tap (NOT the default-hub fallback, which would cover the graph) with scrim + close, CrawlSidebar dashboard opens via a `xig-crawl-launch` pill (+ added `onClose` close button) with scrim. FlightControls trimmed to zoom/reset/fullscreen/list (advanced buttons tagged `--adv`, hidden on mobile), 44px touch targets above nav. Legend hidden. Landing: hero/search compact + trending 2-col grid → single-column token-list rows on void. ListView overlay full-screen with horizontal table scroll. Blur capped ≤12px. Tabular system-font numbers. Day mode complete for the new `xig-` elements + sheet grab handles. Stale inline `@media 768/480` blocks removed from XIntelligencePage.css (pointer comment left). |
| X Intel | COMPLETE | `xim-` prefix, isMobile prop from index.jsx, XIntelPage.mobile.css, early-return inline in XIntelPage.jsx (reuses all desktop data/hooks). Cinematic: compact header + live dot, 3-col summary stats, transparent leader card with ghost pills, leaderboard as token-list rows (rank + 36px logo + name/symbol + organic score + reach, indented hairline separators at 64px). Tap-to-expand (drives selectedTokenIdx → existing detail fetch): 2x2 stat grid, signal-carrier avatar strip (horizontal scroll), kept-posts list linking to X. System-font tabular numbers, 11px uppercase labels, day mode complete. |
| Search Engine | COMPLETE | `se-` classes re-skinned via `search-engine-page.mobile.css` (CSS pass, not early-return - layout already responsive). Cinematic language applied to home + loading + results: 11px uppercase section labels, ghost-pill mode/focus/result toggles with glow-active, transparent trending + recent rows on void with hairline separators, ambient market-pulse chips, system-font tabular numbers, mobile blur cap (8px), movers cards keep change-badge pills. Results topbar made `position: static` on mobile (was sticky, overlapped query title); `.se-page-results` pads 52px to clear fixed mobile header. Day mode complete (paired overrides for every custom color). |
| ZIGChain | COMPLETE | `zgm-` prefix, `useIsMobile()` + early-return in ZIGChainHub.jsx (reuses all already-fetched data, no refetch), ZIGChainHub.mobile.css imported after ZIGChainHub.css. Order: identity hero (logo + LIVE dot + eyebrow + horizontal pill strip, founders photo hidden) → 2-col key stats (TVL/MCap/Pipeline/Rank) → price hero (30px price + sparkline + 24h L/H + 4-cell perf grid) → action row (Watchlist + Docs) → ZigTvlChart (color picker collapsed) + ZigPriceChart (container-responsive, reused) → thesis horizontal-scroll cards → ecosystem protocols as token-list rows (40px logo, 56px rows, indented hairline separators at 52px) → architecture partner rows + team stacked list → FounderSpotlight (reused) → RWA hero + funding 2-col + investor chips → ZigFounderTweets + ZigEpisodes (self-contained, reused) → YouTube single-column stack (mqdefault thumbs) → RWA comparison as horizontal-scroll table (5 cols, ZIG row highlighted) → intelligence feed cards → footer. System-font tabular nums, 11px uppercase headers, ghost pills, 10px radius, blur cap respected. Day mode complete (paired `.app.app-day-mode .zgm-*` + `.zgm--day` via dayMode prop). Brand blue/cyan #3B82F6/#06B6D4, no purple. |
| Tokenized Assets | COMPLETE | `mta-` prefix, isMobile prop from index.jsx, tokenized-assets-page.mobile.css, early-return in tokenized-assets-page.jsx. Order: hero (eyebrow + title + LIVE dot + freshness + issuer/network meta) → horizontal-scroll ghost-pill tab strip (Overview/Stablecoins/Treasuries/Credit/Commodities/Networks/Platforms/Screener/Risk&Alpha) → Overview tab: 2x2 KPI grid (Total RWA + 30D, 7D Net Flow + 7D, Issuers/Networks, Holders/Represented) → SRWAI flagship purple card (when present) → Asset Class Allocation (reused) → Active MCap chart (reused) → Top Issuers token-row list (24px rank + 32px logo + name + TVL/change stack, 56px rows, indented hairline separators at 68px, tap → AssetDetailPanel) → 7D Flow Board (inflows/outflows stacked color-coded groups) → Spectre Thesis + RWA Pulse tweets (reused in card-shells). Non-overview tabs render in `.mta-tab-host` wrapper that forces single-column on `.rwa-cmd-row*` + `.ta-two-up`, neutralizes desktop card chrome, scrolls tables horizontally. Magnitude-graded change colors (mta-mag-0/1/2/3), system-font tabular nums, 11px uppercase section labels, transparent void surfaces, day mode complete (paired `.app.app-day-mode .mta-*` + `.mta-page.day-mode` overrides). |
| Wallets | COMPLETE | `wam-` prefix, isMobile prop from index.jsx → early-return `<WalletsMobile>` in wallets-page.jsx (`wallets-mobile.jsx`), wallets-page.mobile.css. Reuses the `useWalletsLane` data lanes (no refetch). Shared read semantics (CHAIN_NETWORK_ID/STANCE_LABEL/READ_BADGE/tapeRead) moved to use-wallets-data.js. Root keeps `.wlp` so `.mono/.pos/.neg/.dim` + day-mode utils apply. Stack: identity eyebrow+headline → AI money-flow read card (green/red stance accent) → sticky ghost-pill tabs (Flows/Flow Map/Screener/Perps/Tape). **Flow Map** = "The Money River" — reuses the desktop `wallets-flow-river.jsx` canvas engine via a new `variant="mobile"` prop (vertical stacked lanes: label+usd overlaid above the animated wave band, dark river bed in both themes; rAF visibility-guarded — won't paint in a hidden/automated tab). **Flows**: 2×2 stat grid, Money Weather needle gauge, Alpha signals horizontal chip strip, Smart Money as token-list rows (logo+sym/chain+read-badge → netflow colored + magnitude-graded price pill, tap→terminal/RZ), CEX/ETF/Stablecoin ledger cards (bar sparklines + now-chips), Live Whale Tape preview → Tape tab. **Screener**: Tokens/Wallets/Exchanges sub-seg + search → flow rows / entity rows. **Perps**: long/short meter hero, per-asset skew rows (share meter + net L/S), Positions/Leaderboard seg with All/Longs/Shorts, positions rows (side pill + lev + uPnL), desk leaderboard rows. **Tape**: chain + size seg filters, tape rows (time+tag+who→who+asset+usd). Magnitude-graded % pills, system-font tabular nums, 11px uppercase labels, ghost pills, blur ≤8px, 44px targets. Day mode complete. Browser-verified all 4 tabs at 390px + day mode (fixed tape usd clip via `minmax(0,1fr)` + explicit plain-value colors). |
| Spectre LITE (`/lite`) | AUDITED 2026-08-31 + 2 fixes | All 33 views walked at 390px (plus 320/360/430): **zero horizontal overflow, zero console errors**. Two real defects fixed. (1) **Token row `.lite-trow` clipped its own tickers.** `.lite-trow-id` is `flex:1; min-width:0; overflow:hidden`, so the NAME ellipsised to 0 and then the ticker `em` (`flex-shrink:0`) overflowed the hidden box and was sliced mid-glyph - 390px 5/10 watchlist rows, 360px 17/20 Markets rows (DOGE->"D", XMR->"XM", ADA->"AD", XLM->"XL"), 320px all of them. Six columns cannot fit a phone at all: at 360px logo+mcap+price+change+star+gaps already eat the row. Fixed at <=480px with a **grid using named AREAS** (DOM untouched, so ETF-issuer rows that render no price/star just leave those cells empty): ticker+name and price on line 1, mcap and change on line 2 - the Binance/Bybit/CMC row, 64px tall. `lite-page.mobile.css`. (2) **The theme globe parked on top of data.** `.pro-theme-globe` stores ONE `topFrac` shared with PRO; a fraction dragged on a 1400px desktop resolves to mid-height on an 844px phone, and on a phone every row is full-bleed, so the right edge at mid-height IS the change%/star column (measured: it covered Tether's $478m in Vitals, the brief copy on Today, a price label on the Research chart). On phones only `side` carries over now; the orb clamps to the bottom corner above the tab bar. `theme-globe.jsx`. (3) **The Research chart toolbar spilled out of its card** (founder screenshot 2026-09-01). Root cause: `.lite-research-head` is `display: grid`, so the `flex-direction: column` the mobile rules carried was INERT - phones kept running the desktop two-column header (price | toggles). The toggles track got ~198px of a 334px card while the chart-type + timeframe rails need ~344px, and both rails are `flex-shrink: 0`, so the row had no way to give and crossed the panel edge. Fixed by making the head ONE column on mobile (`grid-template-columns: minmax(0, 1fr)`) and letting `.lite-research-toggles` wrap; the `<=339px` wrap special-case is now the default. Measured after: 320/360 wrap to two rows, 390/430 stay on one, all 7 timeframe pills visible at every width, no rail scrolls. **Detector note:** the first sweep MISSED this because the overflow scan skipped anything inside an `overflow-x` ancestor. The check that catches it is per-PANEL: flag any descendant whose rect crosses its closest `.lite-panel`, and only excuse it when an ancestor BETWEEN it and the panel can genuinely scroll (`scrollWidth > clientWidth`). Run that over all 33 views - 29 clean, and the two hits are by design: `.lite-calgrid` (month grid pans horizontally on purpose, and the scroller IS the panel) and a `<a>` inside an ellipsising `.lite-n48-main strong` (geometric box only, paint is clipped with an ellipsis). **Still open (reported, not fixed):** `.lite-tf-btn` 25px / `.lite-look-btn` 26px tap targets (guide is 44px, present on nearly every view); Research chart's bottom axis label overlaps the "Spectre AI" watermark; the token-chip and timeframe rails cut at the edge with no scroll affordance; Bubbles' bottom bubbles sit under the tab bar and small bubbles truncate to one letter; Vitals/Tokenized/Social paint empty for ~3s with no skeleton. **2026-09-03 - Edit popover -> bottom sheet.** The Today + Stocks `Edit` (Sections) popover was a fixed card pinned under the topbar on phones; it now renders through the shared `LiteEditPop` (`lite-edit-sheet.jsx`): desktop = the old anchored dropdown, <=768px = a bottom sheet (`.lite-editpop--sheet`) with scrim, grab handle, `Done`, drag-down to dismiss, `useBackDismiss`, body scroll lock; glass/paper paired. `Done` is a full-width 50px button in a pinned sheet footer (`.lite-editpop-foot` / `.lcin-sheet-foot`), not a pill in the head (2026-09-04). The Ambience (Sound) popover in `lite-music.jsx` is the fourth sheet: it reuses the `lite-editpop--sheet` chrome classes wholesale (portaled into `.lite-root`), with Play/Stop kept in the head. 🪤 Sheet buttons need (0,4,0) selectors (`.lite-root .lite-editpop--sheet .lite-editpop-foot .lite-editpop-done`) - app-store-ready's `button:not()` floor is (0,3,1) and silently capped the 50px Done at 38px and 48px rows at 40px. 🪤 **It MUST be portaled into `.lite-root`**: `.lite-main` is its own stacking context (`z-index: 2`), so a fixed sheet inside it - even at z 130 - paints UNDER the sibling `.lite-tabbar` (z 40) and the scrim never dims the tab bar. Portaling to `.lite-root` (not `body`) keeps the `.lite-root--glass/--paper` look classes in scope. Reorder is drag-by-grip (`use-drag-reorder.js`, pointer events + capture, `touch-action: none` on the `.lite-grip`, DOM-direct transforms, clamped to the sortable block, inclusive slot math so a drop at the clamped edge lands first/last) - the up/down arrows are gone on both desktop and mobile. **Cinema appearance popover (gear) + its `All backdrops` catalog** are sheets too on <=768px (`.lcin-sheet`, `lite-cinema.css`), driven by the same exported `useSheetDrag` from `lite-edit-sheet.jsx`; `Back` returns to Appearance, `Done`/scrim/drag leave settings entirely. En route: `.lcin-sw` swatches lacked `color: inherit`, so a global white button color hid the Paper-mode labels and the selected ring on white (desktop too). Theme/Glass pickers in the sheet are full-width equal-segment controls (caption above, one sliding `::before` thumb driven by `--seg-i`/`--seg-n` set from the `Seg` component) - the desktop popover keeps the compact tinted-button segments. **ROI view (2026-09-03):** amount is a 56px hero field (`ui-bare-input` on the input - the sanctioned opt-out from app-store-ready's blanket mobile input box, which had inflated it into a second 60px slab beside the caption) + a 5-up `$100…$10K` preset row; symbols on an edge-faded scroll rail; window picker = full-width equal segments; the answer is split into `.lite-roi-lead` / big `strong` / `.lite-roi-tail` so the number reads as the hero; Return/Bought/Now in one 3-col row. 🪤 **`.lite-news-link` is a flex ROW.** Direct-child `.lite-news-meta` is `nowrap; flex-shrink: 0` (for the research/stocks rails where a short byline sits beside the title). Stocks News dropped a long `context` sentence in as a direct child - it took the whole row and every headline collapsed to one letter per line. Stacked text goes inside `.lite-news-body` (like the crypto list); never put a sentence-length span directly in the link. |
| Private Markets | COMPLETE (2026-09-03) | Scoped under the `.pm-page.pm-mobile` root the page already sets from `isMobile` (company route `/private-markets/:slug` now sets it too), one sheet: `private-markets-page.mobile.css`. All five tabs. **Header**: eyebrow + 1.75rem title + 13px sub, 2×2 tinted stat tiles (22px tabular), 44px ghost Refresh. **Tabs**: ghost-capsule scroll rail (the desktop `width: fit-content` pill clipped at 390px). **Deal Feed**: filter bar dissolves to a 2×2 of 44px selects (the `FILTERS` caption is JSX-guarded off); DealCard → 72px row via CSS grid AREAS with `.pm-deal-top { display: contents }` — logo 36 · name/sector · round badge · amount+valuation right, `led by` + source·date on line two, headline hidden (the sheet has it), hairline at 62px. **Pre-IPO**: hero on void (banner/scrim/glow hidden), 2-col stat tiles, backers chip rail, 44px CTA; X rail + coverage panels as hairline rows; chart toolbar = symbol row + equal-width TF rail; toolbar → 3 stat tiles + chip rail + search/sort at 44px; roster PreIpoCard → 75px row (`$300B 25×` right, status pill under it, round·date·investors left) with the `Full page` link as a 44px trailing chevron (was hover-revealed = invisible on touch). **Spotlight/Compare/How-to-buy**: glass → void with hairline section tops, 2-col stat tiles, link + investor rails, tables scroll inside `-16px` bleeds, rails stack. **Accelerators**: toolbar → 3 tiles + search/source/toggle grid, cards → 3-line rows. System-font tabular numbers everywhere, blur ≤ 8px (was 20–26px on every surface), day mode paired (`.app.app-day-mode .pm-mobile` + `.pm-mobile.pm-day`). 🪤 **Two traps found here.** (1) app-store-ready's `a { min-height: 38px }` REPLACES the min-content floor of flex items: tweet anchors inside the height-capped coverage panels shrank to 38px and their text to 0px (the 'overlapping tweets' on the spotlight) — `flex-shrink: 0` on those lists fixes it. (2) A `flex-direction: column` container that keeps the desktop's `flex-wrap: wrap` sizes each line to its widest item's INTRINSIC width, so a chip rail blew the whole Pre-IPO toolbar 350px past the viewport — set `flex-wrap: nowrap` when stacking. Also the touch rule `button:not(.x *):not(.y *)` is (0,3,1): a 44px trigger needs (0,4,0) to win. Fixed en route: the spotlight's listing odds printed `10000%` (percent × 100). Verified at the 606px minimum this Chrome window allows (fullscreen resize trap) + build clean + zero console errors; not device-verified at 390. |
| All others (9) | NOT STARTED | |

---

> Audit history (Phases 0A-1C) moved to `.claude/mobile-audit-history.md` to reduce context size.
