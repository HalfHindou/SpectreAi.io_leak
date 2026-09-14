# Cinematic Mobile Design Patterns - Implementable Reference

Research compiled from top-tier finance/crypto apps (Robinhood, Revolut, Arc Search, Linear, Zerodha) and cutting-edge CSS techniques from Josh Comeau, Chrome DevRel, CSS-Tricks, and Smashing Magazine. Every pattern below is plain CSS + minimal JS - no heavy libraries.

**Constraint:** React 18 + Vite + plain CSS custom properties. No Tailwind, no Framer Motion (except where already used).

---

## 1. Apple-Style Spring Animations (CSS `linear()`)

**What it looks like:** Elements overshoot their target position slightly and settle back - the signature iOS feel. Cards bounce into place, modals spring open, toggles snap with physics.

**Browser support:** 88%+ (all major browsers since Dec 2023). Use `@supports` with cubic-bezier fallback.

**Where it fits:** Everything interactive - card taps, tab switches, modal opens, bottom sheet drags, pull-to-refresh settle.

### New CSS Custom Properties (add to `:root`)

```css
:root {
  /* Spring easing via linear() - with cubic-bezier fallback */
  /* Gentle spring: subtle overshoot, quick settle. For cards, tabs, badges. */
  --ease-spring-gentle: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-spring-gentle: 500ms;

  /* Snappy spring: fast response, minimal wobble. For buttons, toggles. */
  --ease-spring-snappy: cubic-bezier(0.22, 1.2, 0.36, 1);
  --duration-spring-snappy: 350ms;

  /* Bouncy spring: visible overshoot + settle. For attention-getters, modals. */
  --ease-spring-bouncy: cubic-bezier(0.34, 1.8, 0.64, 1);
  --duration-spring-bouncy: 600ms;
}

/* Upgrade to real spring physics where supported */
@supports (animation-timing-function: linear(0, 1)) {
  :root {
    /* Gentle spring (stiffness: 180, damping: 20) */
    --ease-spring-gentle: linear(
      0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%,
      0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%,
      0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%,
      1.001 85.5%, 1
    );
    --duration-spring-gentle: 600ms;

    /* Snappy spring (stiffness: 300, damping: 24) */
    --ease-spring-snappy: linear(
      0, 0.009, 0.037 2.7%, 0.153 6.2%, 0.776 18.4%,
      0.944 24%, 1.032 28.8%, 1.07 32.8%, 1.088 36.1%,
      1.089 39%, 1.076 42%, 1.033 51.4%, 1.014 58.2%,
      1.003 68.8%, 0.999 85.8%, 1
    );
    --duration-spring-snappy: 450ms;

    /* Bouncy spring (stiffness: 200, damping: 12) */
    --ease-spring-bouncy: linear(
      0, 0.004, 0.016 2.5%, 0.063 5%, 0.25 10.1%,
      0.563 15.2%, 1 20.3%, 1.221 23%, 1.355 25.6%,
      1.406 27.6%, 1.413 29.4%, 1.387 31.3%, 1.243 36.5%,
      1.088 42%, 0.994 47%, 0.955 51.3%, 0.942 55.5%,
      0.957 60.3%, 1.011 72%, 1.004 85.5%, 1
    );
    --duration-spring-bouncy: 800ms;
  }
}
```

### Usage Patterns

```css
/* Card press + release */
.token-card {
  transition: transform var(--duration-spring-gentle) var(--ease-spring-gentle);
}
.token-card:active {
  transform: scale(0.97);
  transition-duration: 80ms;
  transition-timing-function: ease-out;
}

/* Tab indicator slide */
.tab-indicator {
  transition: left var(--duration-spring-snappy) var(--ease-spring-snappy),
              width var(--duration-spring-snappy) var(--ease-spring-snappy);
}

/* Modal entrance */
@keyframes modal-spring-in {
  from { transform: scale(0.85) translateY(20px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}
.modal-enter {
  animation: modal-spring-in var(--duration-spring-bouncy) var(--ease-spring-bouncy) both;
}

/* Bottom sheet snap */
.bottom-sheet {
  transition: transform var(--duration-spring-gentle) var(--ease-spring-gentle);
}
```

### Reduced Motion Respect

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 2. Scroll-Driven Animations (Zero JS)

**What it looks like:** Cards fade up and scale in as they enter viewport. Progress bars fill as you scroll. Headers shrink on scroll. All GPU-accelerated, zero JavaScript.

**Browser support:** Chrome 115+, Edge 115+, Opera. Firefox behind flag. Use progressive enhancement.

**Where it fits:** Card grids (watchlist, news, brief tokens), header shrink, progress indicators, parallax hero backgrounds.

### Card Reveal on Scroll

```css
/* Cards fade + slide up as they enter viewport */
@keyframes card-reveal {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Progressive enhancement - only if supported */
@supports (animation-timeline: view()) {
  .scroll-reveal-card {
    animation: card-reveal ease-out both;
    animation-timeline: view();
    animation-range: entry 10% entry 60%;
  }
}
```

### Staggered Card Reveal

```css
/* Stagger children by applying increasing delays */
@supports (animation-timeline: view()) {
  .card-grid > *:nth-child(1) { animation-range: entry 5% entry 50%; }
  .card-grid > *:nth-child(2) { animation-range: entry 10% entry 55%; }
  .card-grid > *:nth-child(3) { animation-range: entry 15% entry 60%; }
  .card-grid > *:nth-child(4) { animation-range: entry 20% entry 65%; }
}
```

### Header Shrink on Scroll

```css
@keyframes header-shrink {
  from {
    padding-block: 16px;
    backdrop-filter: blur(0px);
    background: transparent;
  }
  to {
    padding-block: 8px;
    backdrop-filter: blur(20px);
    background: rgba(9, 9, 11, 0.88);
  }
}

@supports (animation-timeline: scroll()) {
  .mobile-header {
    animation: header-shrink linear both;
    animation-timeline: scroll();
    animation-range: 0px 80px;
  }
}
```

### Parallax Background

```css
@keyframes parallax-shift {
  from { background-position: center 0%; }
  to   { background-position: center 30%; }
}

@supports (animation-timeline: scroll()) {
  .hero-section {
    animation: parallax-shift linear;
    animation-timeline: scroll();
  }
}
```

### JS Fallback (IntersectionObserver)

For browsers without `animation-timeline`, use this lightweight pattern:

```jsx
// useScrollReveal.js - 12 lines, no dependencies
import { useEffect, useRef } from 'react'

export default function useScrollReveal(threshold = 0.15) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || CSS.supports('animation-timeline', 'view()')) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('is-visible'); obs.unobserve(el) } },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return ref
}
```

```css
/* Fallback for non-supporting browsers */
.scroll-reveal-card {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.5s var(--ease-out), transform 0.5s var(--ease-out);
}
.scroll-reveal-card.is-visible {
  opacity: 1;
  transform: translateY(0);
}
```

---

## 3. Depth Layering & Z-Axis System

**What it looks like:** UI elements feel like they float at different heights above the screen. Cards cast real shadows downward. Modals feel like they levitate. Content has a physical quality.

**Where it fits:** Every surface - cards, headers, modals, bottom sheets, floating action buttons.

### 5-Tier Elevation System

```css
:root {
  /* Elevation 0: Flat on surface (backgrounds, dividers) */
  --elevation-0: none;

  /* Elevation 1: Resting cards, list items (just off the surface) */
  --elevation-1:
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 2px 6px rgba(0, 0, 0, 0.15);

  /* Elevation 2: Raised cards, active elements (interactive state) */
  --elevation-2:
    0 2px 4px rgba(0, 0, 0, 0.2),
    0 4px 12px rgba(0, 0, 0, 0.15),
    0 8px 24px rgba(0, 0, 0, 0.1);

  /* Elevation 3: Dropdowns, popovers, sticky headers */
  --elevation-3:
    0 4px 8px rgba(0, 0, 0, 0.2),
    0 8px 24px rgba(0, 0, 0, 0.15),
    0 16px 48px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);

  /* Elevation 4: Modals, bottom sheets, overlays */
  --elevation-4:
    0 8px 16px rgba(0, 0, 0, 0.25),
    0 16px 48px rgba(0, 0, 0, 0.2),
    0 32px 96px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

### Elevation on Interaction (Cards Lift on Tap)

```css
.card {
  box-shadow: var(--elevation-1);
  transition: box-shadow var(--duration-base) var(--ease-out),
              transform var(--duration-base) var(--ease-out);
}

/* Desktop hover */
@media (hover: hover) {
  .card:hover {
    box-shadow: var(--elevation-2);
    transform: translateY(-2px);
  }
}

/* Mobile press */
.card:active {
  box-shadow: var(--elevation-1);
  transform: scale(0.98);
  transition-duration: 80ms;
}
```

### Inset Top-Light (Apple's Signature)

Every elevated surface gets a subtle top-edge highlight that simulates light from above:

```css
.elevated-surface::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.06) 20%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.06) 80%,
    transparent 100%
  );
  pointer-events: none;
}
```

---

## 4. Micro-Interactions (Native Feel)

**What it looks like:** Buttons have a satisfying press/release. Toggles click into place. Swipe actions reveal with resistance. Everything responds to touch immediately.

**Where it fits:** Buttons, toggles, swipe-to-reveal, pull-to-refresh, tab switches, value changes.

### Tactile Button Press

```css
.btn-tactile {
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
  /* GPU layer for instant response */
  will-change: transform;
}
.btn-tactile:active {
  transform: scale(0.96);
  box-shadow: var(--elevation-0);
  transition-duration: 40ms;
}
/* Spring back on release */
.btn-tactile:not(:active) {
  transition: transform var(--duration-spring-snappy) var(--ease-spring-snappy);
}
```

### Rubber-Band Overscroll Indicator

```css
/* Visual indicator at scroll boundaries */
@keyframes rubber-band {
  0%   { transform: scaleY(1); }
  40%  { transform: scaleY(1.03); }
  60%  { transform: scaleY(0.99); }
  80%  { transform: scaleY(1.005); }
  100% { transform: scaleY(1); }
}
.overscroll-indicator {
  animation: rubber-band 400ms var(--ease-spring-gentle);
}
```

### Number Ticker (Price Changes)

```css
/* Price value animates color + brief scale pulse on change */
@keyframes price-flash-up {
  0%   { color: var(--bull-bright); transform: scale(1.04); }
  100% { color: var(--text-primary); transform: scale(1); }
}
@keyframes price-flash-down {
  0%   { color: var(--bear-bright); transform: scale(1.04); }
  100% { color: var(--text-primary); transform: scale(1); }
}

.price-up   { animation: price-flash-up 600ms var(--ease-out); }
.price-down { animation: price-flash-down 600ms var(--ease-out); }
```

### Toggle Switch with Snap

```css
.toggle-track {
  width: 48px; height: 28px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  transition: background 200ms ease;
  position: relative;
}
.toggle-track.on {
  background: var(--bull);
}
.toggle-thumb {
  width: 22px; height: 22px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 3px; left: 3px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  transition: transform var(--duration-spring-snappy) var(--ease-spring-snappy);
}
.toggle-track.on .toggle-thumb {
  transform: translateX(20px);
}
/* Stretch effect during transition */
.toggle-thumb:active,
.toggle-track:active .toggle-thumb {
  width: 26px;
  border-radius: 11px;
  transition: width 100ms ease;
}
```

### Swipe Reveal (Delete/Archive)

```css
.swipe-container {
  overflow: hidden;
  position: relative;
}
.swipe-content {
  transition: transform 200ms var(--ease-out);
  touch-action: pan-y;
}
.swipe-content.swiping {
  transition: none; /* JS controls position during drag */
}
.swipe-action {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bear);
  opacity: 0;
  transform: translateX(10px);
  transition: opacity 200ms, transform 200ms;
}
.swipe-content.revealing ~ .swipe-action {
  opacity: 1;
  transform: translateX(0);
}
```

### Haptic Visual Feedback (Simulates Vibration)

When the Vibration API is unavailable (iOS), use visual "haptic" cues:

```css
/* Brief scale pulse simulating a haptic tap */
@keyframes haptic-pulse {
  0%   { transform: scale(1); }
  50%  { transform: scale(0.97); }
  100% { transform: scale(1); }
}
.haptic-feedback {
  animation: haptic-pulse 120ms ease-in-out;
}
```

```js
// Vibration API with graceful fallback
function hapticTap() {
  if (navigator.vibrate) {
    navigator.vibrate(10) // 10ms micro-tap
  }
}
function hapticSuccess() {
  if (navigator.vibrate) {
    navigator.vibrate([10, 50, 20]) // success pattern
  }
}
```

---

## 5. Premium Card Designs with Depth

**What it looks like:** Cards feel like physical objects - frosted glass with visible depth, subtle noise texture, edge highlights that catch "light." Not flat rectangles.

**Where it fits:** Token cards, stats cards, portfolio summary, news cards, watchlist items.

### Cinematic Glass Card (Enhanced)

```css
.card-cinematic {
  position: relative;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.06) 0%,
    rgba(255, 255, 255, 0.02) 100%
  );
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-lg);
  box-shadow:
    var(--elevation-1),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
  transition: all var(--duration-spring-gentle) var(--ease-spring-gentle);
}

/* Top-edge light catch */
.card-cinematic::before {
  content: '';
  position: absolute;
  top: 0; left: 8%; right: 8%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.1),
    transparent
  );
  pointer-events: none;
}

/* Noise texture overlay */
.card-cinematic::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'%3E%3Cfilter id='a'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23a)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 182px;
  opacity: 0.03;
  pointer-events: none;
  border-radius: inherit;
}

/* Hover state */
@media (hover: hover) {
  .card-cinematic:hover {
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow:
      var(--elevation-2),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    transform: translateY(-2px);
  }
}

/* Active/tap state */
.card-cinematic:active {
  transform: scale(0.98);
  transition-duration: 80ms;
  transition-timing-function: ease-out;
}
```

### Stat Card with Inner Glow

```css
.stat-card {
  padding: var(--sp-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  position: relative;
  overflow: hidden;
}

/* Subtle radial glow behind the value */
.stat-card::before {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  width: 120px; height: 120px;
  transform: translate(-50%, -50%);
  background: radial-gradient(
    circle,
    rgba(255, 255, 255, 0.03) 0%,
    transparent 70%
  );
  pointer-events: none;
}

.stat-card .stat-value {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.stat-card .stat-label {
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
```

### Portfolio Value Card (Hero)

```css
.portfolio-hero {
  padding: var(--sp-8) var(--sp-6);
  background: linear-gradient(
    160deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.01) 50%,
    rgba(255, 255, 255, 0.03) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--radius-xl);
  text-align: center;
  position: relative;
  overflow: hidden;
}

.portfolio-hero .total-value {
  font-family: var(--font-mono);
  font-size: clamp(2rem, 8vw, 3.5rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  line-height: 1.1;
}

.portfolio-hero .change-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  font-weight: 600;
  margin-top: var(--sp-2);
}

.portfolio-hero .change-badge.positive {
  background: var(--bull-muted);
  color: var(--bull-bright);
}

.portfolio-hero .change-badge.negative {
  background: var(--bear-muted);
  color: var(--bear-bright);
}
```

---

## 6. Ambient/Atmospheric Background Effects

**What it looks like:** Subtle color washes, gradient orbs, and noise textures behind content that create depth without competing with data. The background feels alive but quiet.

**Where it fits:** Behind hero sections, portfolio value, header backgrounds, page-level atmosphere.

### Ambient Gradient Orbs

```css
.ambient-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.ambient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.15;
  animation: ambient-drift 20s ease-in-out infinite alternate;
}

.ambient-orb-1 {
  width: 300px; height: 300px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.3), transparent 70%);
  top: -10%; left: -5%;
}

.ambient-orb-2 {
  width: 250px; height: 250px;
  background: radial-gradient(circle, rgba(6, 182, 212, 0.2), transparent 70%);
  bottom: 20%; right: -10%;
  animation-delay: -7s;
  animation-duration: 25s;
}

@keyframes ambient-drift {
  0%   { transform: translate(0, 0) scale(1); }
  33%  { transform: translate(30px, -20px) scale(1.05); }
  66%  { transform: translate(-20px, 15px) scale(0.95); }
  100% { transform: translate(10px, -10px) scale(1.02); }
}
```

### Noise Texture Layer (Subtle Film Grain)

```css
/* Apply to body or page wrapper */
.page-wrapper::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'%3E%3Cfilter id='a'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23a)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 182px;
  opacity: 0.015; /* Very subtle - just enough to break color banding */
  mix-blend-mode: overlay;
}
```

### Vignette Effect (Cinematic Edge Darkening)

```css
.page-wrapper::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    transparent 50%,
    rgba(0, 0, 0, 0.4) 100%
  );
}
```

### Token-Colored Ambient Glow

```css
/* Behind the currently viewed token's card/detail */
.token-ambient-glow {
  position: absolute;
  top: 50%; left: 50%;
  width: 200%; height: 200%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  /* Color set via inline style from tokenColors.js */
  background: radial-gradient(
    circle,
    var(--token-color-glow, rgba(255,255,255,0.05)) 0%,
    transparent 60%
  );
  filter: blur(60px);
  opacity: 0.12;
  pointer-events: none;
  transition: opacity 1s ease;
}
```

---

## 7. Editorial/Magazine Typography

**What it looks like:** Headlines have gravitas - tight tracking, large size differences between heading levels. Body text has generous line height. Numbers are tabular. Labels feel like magazine captions.

**Where it fits:** Page titles, section headers, stat values, news headlines, article pages.

### Fluid Type Scale (Mobile-Optimized)

```css
:root {
  /* Mobile-first fluid scale with clamp() */
  --type-hero:    clamp(2rem, 6vw + 0.5rem, 4.5rem);      /* 32px -> 72px */
  --type-display: clamp(1.5rem, 3vw + 0.75rem, 3rem);      /* 24px -> 48px */
  --type-title:   clamp(1.25rem, 2vw + 0.5rem, 2.25rem);   /* 20px -> 36px */
  --type-heading: clamp(1rem, 1vw + 0.5rem, 1.375rem);      /* 16px -> 22px */
  --type-body:    clamp(0.875rem, 0.5vw + 0.75rem, 1rem);   /* 14px -> 16px */
  --type-caption: clamp(0.6875rem, 0.25vw + 0.6rem, 0.75rem); /* 11px -> 12px */
}
```

### Editorial Heading Treatment

```css
.editorial-headline {
  font-family: var(--font-display);
  font-size: var(--type-display);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.05;
  color: var(--text-primary);
  /* Optical margin alignment - hang punctuation */
  text-indent: -0.02em;
}

/* Subheadline - lighter weight, more spacing */
.editorial-subhead {
  font-family: var(--font-body);
  font-size: var(--type-heading);
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.4;
  color: var(--text-secondary);
  margin-top: var(--sp-2);
}
```

### Monospace Number Treatment (Finance-Specific)

```css
/* Tabular figures for aligned columns */
.tabular-nums {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

/* Large hero number (portfolio value, market cap) */
.hero-value {
  font-family: var(--font-mono);
  font-size: var(--type-hero);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* Inline price in text */
.inline-price {
  font-family: var(--font-mono);
  font-size: 0.95em; /* Slightly smaller than surrounding text */
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
```

### Magazine-Style Section Label

```css
.section-label {
  font-family: var(--font-body);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* Optional rule line after label */
.section-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}
```

### Text Gradient (Sparingly - Hero Titles Only)

```css
.gradient-text {
  background: linear-gradient(
    135deg,
    var(--text-primary) 0%,
    rgba(245, 245, 247, 0.5) 100%
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

---

## 8. Scroll-Linked Header & Navigation

**What it looks like:** Header compresses from spacious to compact as you scroll. Background blurs in. Navigation fades. All driven by scroll position.

**Where it fits:** Mobile header, sticky section headers, floating action button visibility.

### Scroll-Aware Header (JS - 15 lines)

```jsx
// useScrollDirection.js
import { useState, useEffect, useRef } from 'react'

export default function useScrollDirection(threshold = 10) {
  const [scrollDir, setScrollDir] = useState('up')
  const [scrollY, setScrollY] = useState(0)
  const lastY = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrollY(y)
      if (Math.abs(y - lastY.current) > threshold) {
        setScrollDir(y > lastY.current ? 'down' : 'up')
        lastY.current = y
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  return { scrollDir, scrollY, isScrolled: scrollY > 20 }
}
```

```css
.mobile-header {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 16px var(--sp-4);
  background: transparent;
  backdrop-filter: blur(0px);
  transition:
    padding 300ms var(--ease-out),
    background 300ms var(--ease-out),
    backdrop-filter 300ms var(--ease-out),
    transform 300ms var(--ease-out);
}

.mobile-header.scrolled {
  padding: 8px var(--sp-4);
  background: rgba(9, 9, 11, 0.85);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--border-subtle);
}

.mobile-header.hidden {
  transform: translateY(-100%);
}
```

---

## 9. GPU Performance Rules

**Critical for mobile:** Not everything should be accelerated. Follow these rules.

### Promote Only What Moves

```css
/* DO promote: elements that animate transform/opacity */
.animated-card {
  will-change: transform;
  /* OR */
  transform: translateZ(0);
}

/* DO NOT promote: static content, large backgrounds */
/* Over-promoting wastes GPU memory and drains battery */
```

### Compositor-Only Properties (60fps guaranteed)

These properties run entirely on the GPU compositor thread:
- `transform` (translate, scale, rotate)
- `opacity`
- `filter` (blur, brightness, contrast)
- `backdrop-filter`
- `clip-path`

These trigger layout/paint (avoid animating on mobile):
- `width`, `height`, `padding`, `margin`
- `top`, `left`, `right`, `bottom`
- `border-radius` (changes)
- `box-shadow` (changes)
- `background-color`

### Animation Performance Pattern

```css
/* WRONG - animates box-shadow (triggers paint) */
.card:hover {
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

/* RIGHT - use pseudo-element with opacity */
.card {
  position: relative;
}
.card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out);
  pointer-events: none;
}
.card:hover::after {
  opacity: 1;
}
```

### Contain for Scroll Performance

```css
/* Isolate repaint boundaries */
.card {
  contain: layout style paint;
}

/* For long scrolling lists */
.virtual-list-item {
  contain: strict;
  content-visibility: auto;
  contain-intrinsic-size: 0 80px; /* estimated height */
}
```

---

## 10. Advanced Glass Patterns (2026 Evolution)

### Liquid Glass (iOS 26 / Apple WWDC 2025 Style)

```css
.liquid-glass {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(40px) saturate(200%) brightness(1.05);
  -webkit-backdrop-filter: blur(40px) saturate(200%) brightness(1.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-xl);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.12),
    0 1px 0 rgba(255, 255, 255, 0.06) inset,
    0 -1px 0 rgba(0, 0, 0, 0.1) inset;
}
```

### Refraction Edge Effect

```css
/* Simulates light bending at glass edges */
.glass-refraction {
  position: relative;
}
.glass-refraction::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.15) 0%,
    rgba(255, 255, 255, 0.03) 30%,
    transparent 50%,
    rgba(255, 255, 255, 0.02) 70%,
    rgba(255, 255, 255, 0.1) 100%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

### Frosted Bottom Sheet

```css
.bottom-sheet-glass {
  background: rgba(9, 9, 11, 0.75);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow:
    0 -8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* Drag handle */
.bottom-sheet-glass .drag-handle {
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
  margin: var(--sp-3) auto var(--sp-4);
}
```

---

## Section-by-Section Application Map

| Section | Patterns to Apply |
|---------|------------------|
| **Header** | Scroll-linked blur/shrink (#8), spring tab indicator (#1), liquid glass (#10) |
| **Stats Bar** | Stat card inner glow (#5), number ticker flash (#4), tabular nums (#7) |
| **Watchlist** | Scroll-reveal cards (#2), swipe-to-delete (#4), elevation lift (#3), cinematic cards (#5) |
| **Charts** | Token-colored ambient glow (#6), editorial labels (#7) |
| **News Feed** | Staggered card reveal (#2), tactile press (#4), magazine labels (#7) |
| **Portfolio Hero** | Fluid hero type (#7), ambient orbs (#6), gradient text (#7) |
| **Bottom Sheet** | Frosted glass (#10), spring open/close (#1), rubber-band (#4) |
| **Modals** | Spring entrance (#1), elevation-4 (#3), vignette (#6) |
| **Entire Page** | Noise texture (#6), reduced motion respect (#1) |

---

## Implementation Priority

1. **Spring easings** (#1) - Biggest perceived quality jump. Add the CSS vars, update existing transitions.
2. **Elevation system** (#3) - Replace flat shadows with layered ones. Immediate depth improvement.
3. **Scroll reveal** (#2) - Cards animating in feels premium. Progressive enhancement.
4. **Tactile interactions** (#4) - Button press/release and number flashes.
5. **Noise texture** (#6) - Single `::before` on page wrapper. Breaks color banding.
6. **Editorial typography** (#7) - Fluid type scale + tighter tracking on headings.
7. **Ambient background** (#6) - Gradient orbs behind hero sections.
8. **Glass evolution** (#10) - Refraction borders, liquid glass on key surfaces.
9. **Header scroll** (#8) - Compress/blur on scroll.
10. **GPU optimization** (#9) - Audit animations for compositor-only properties.
