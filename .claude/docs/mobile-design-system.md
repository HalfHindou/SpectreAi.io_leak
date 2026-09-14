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

**Proven in:** `mobile-token-row.jsx`

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
| Token detail | NOT STARTED | High priority - iframe into trading app |
| Discover | NOT STARTED | |
| Watchlists | NOT STARTED | Has `mobile-bottom-sheet` already |
| Research Zone | NOT STARTED | Has `mobile-tab-bar` already |
| All others (23) | NOT STARTED | |

---

> **Audit archive:** Completed implementation status for phases 0A-1C moved to `.claude/rules/mobile-audit-archive.md` to reduce file size.
