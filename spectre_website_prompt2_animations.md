# SPECTRE AI — PROMPT 2: VISUAL THEATRE & ANIMATION LAYER
# Run this AFTER Prompt 1 is complete and the structure/copy is confirmed.
# This prompt is animation-only. Touch zero copy. Touch zero layout. Touch zero design tokens.

---

## PHILOSOPHY

This is a financial intelligence platform, not a crypto casino. The animations must feel like:
- **Above the fold (Hero → App Embed → Token):** Cinematic. Controlled. Like an Apple product reveal or a Stripe launch page. Every animation is deliberate and premium.
- **Below the fold (Features → Problem → Stack → Lower sections):** Immersive and expressive. More dramatic reveals. Typography that moves with confidence. Go harder here.

The rule: **animations serve the hierarchy.** The app and the buy button must always feel like the most alive things on the page. Everything else is atmosphere.

---

## 1. CURSOR SYSTEM — CUSTOM CURSOR + PARTICLE TRAIL

Replace the default cursor entirely. Two-layer system:

### Layer 1 — Custom cursor dot
```css
/* Small 8px circle, white, no border */
.cursor-dot {
  width: 8px;
  height: 8px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  position: fixed;
  pointer-events: none;
  z-index: 99999;
  transition: transform 0.1s ease, opacity 0.2s ease;
}

/* Larger ring that follows with lag */
.cursor-ring {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(139, 92, 246, 0.6);
  border-radius: 50%;
  position: fixed;
  pointer-events: none;
  z-index: 99998;
  transition: transform 0.15s ease, width 0.2s ease, height 0.2s ease, border-color 0.2s ease;
}
```

Behavior:
- Dot follows cursor instantly (raw mousemove)
- Ring follows with ~80ms lerp lag (requestAnimationFrame lerp)
- On hover over any CTA button: ring expands to 56px, border becomes `rgba(139,92,246,0.9)`, dot fades to 0
- On hover over text: ring compresses to 16px, cursor-dot becomes an I-beam style thin rectangle
- On hover over the app iframe chrome: ring becomes a subtle purple glow `box-shadow: 0 0 16px rgba(139,92,246,0.4)`
- In day mode: ring border becomes `rgba(139,92,246,0.8)` (purple stays — it's our color)

### Layer 2 — Particle trail
Use canvas overlay (full page, pointer-events: none, z-index 99990).

On mousemove, spawn particles:
```js
// Each particle:
{
  x: mouseX,
  y: mouseY,
  vx: (Math.random() - 0.5) * 1.2,
  vy: (Math.random() - 0.5) * 1.2 - 0.8,  // slight upward drift
  life: 1.0,
  size: Math.random() * 3 + 1,
  color: Math.random() > 0.7 ? '#8B5CF6' : 'rgba(255,255,255,0.6)'
  // 30% purple, 70% white — feels like signal/data, not sparkles
}
```

Particle behavior:
- Spawn rate: 2-3 particles per mousemove event (not every frame — throttle to 16ms)
- Fade out over ~600ms (life decrement per frame)
- Tiny `size` — never larger than 4px. Wispy, not glittery.
- On fast mouse movement: increase spawn rate to 6-8 (velocity-sensitive)
- Over the hero section: particles are slightly brighter, slightly more purple
- Over the app embed chrome: particles become small monospace glyphs (pick from: `0`, `1`, `%`, `$`, `▲`, `▼`) instead of dots. Matrix/data feel.
- Respect `prefers-reduced-motion` — if set, kill all particles entirely

---

## 2. HERO SECTION — CINEMATIC ENTRANCE

The hero loads like a film opening. Sequence is timed, not scroll-triggered.

### Sequence (starts on page load, after 200ms delay):

```
t=0ms    — Page is black. Cursor appears.
t=200ms  — Ambient purple radial orb fades in behind hero text area.
           (rgba(139,92,246,0.06), 600px diameter, centered)
           Duration: 800ms ease-out
t=600ms  — Eyebrow label ("SPECTRE AI — MARKET INTELLIGENCE") fades in.
           Characters appear letter by letter, 18ms stagger.
           Not a typewriter — each letter fades in (opacity 0→1), slight upward drift (y: 6px→0)
t=900ms  — Headline line 1 slides up from y:40px, opacity 0→1. Duration: 700ms expo-out.
t=1100ms — Headline line 2 slides up. Same treatment. 200ms after line 1.
t=1300ms — Sub text fades in. Simple opacity. 500ms.
t=1500ms — CTA buttons appear. Scale up from 0.94→1, opacity 0→1. 
           "Open Platform" button: 400ms. "Buy $SPECT": 100ms later.
t=1700ms — Live ticker row fades in. Each ticker item staggers 80ms apart.
           Numbers count up from 0 to their value over 800ms (JetBrains Mono, counting animation)
```

### Ongoing hero animations:
- The radial orb breathes: scale 1.0→1.08→1.0, opacity subtle variation, 8s loop ease-in-out
- "Open Platform" button has a soft purple glow that pulses: `box-shadow` alternates 0→`0 0 20px rgba(139,92,246,0.4)`→0, 3s loop. Stops on hover (hover state takes over).
- Live ticker numbers: when they update (every 30s), digits roll — each digit animates independently like an odometer. Green flash for up, red flash for down.

---

## 3. APP EMBED SECTION — THE STAR

This section must feel like unveiling a product on stage. It IS the product.

### Scroll entrance:
- Section heading fades in from y:30px as it enters viewport
- The browser chrome frame: starts scaled at 0.92, y:60px, opacity:0. As it enters viewport: scale→1, y→0, opacity→1. Duration: 900ms cubic-bezier(0.16, 1, 0.3, 1) (expo-out — smooth deceleration)
- Subtle reflection highlight on the top edge of the chrome animates left-to-right once (shimmer sweep) as the frame finishes entering. Like light catching the edge of glass.

### Persistent:
- The browser chrome has a very faint pulsing glow: `box-shadow: 0 0 60px rgba(139,92,246,0.08)` breathing with a 5s loop
- The "LIVE" indicator dot next to the app URL pulses (scale 1→1.4→1, opacity 1→0.5→1, 2s loop)
- On hover over the iframe chrome: glow intensifies to `0 0 80px rgba(139,92,246,0.15)`, ring expands (cursor system)

---

## 4. TOKEN SECTION — BUY SIGNAL

The tier cards animate with intention. This is the conversion moment.

### Entrance:
- Section headline: character-by-character fade-in (same as hero eyebrow but faster — 12ms per char)
- Three tier cards enter with a staggered reveal: Scout (0ms delay), Analyst (120ms), Sovereign (240ms). Each: y:40px→0, opacity:0→1, 600ms expo-out.
- The "Analyst" (most popular) card: enters with a subtle scale overshoot — hits 1.02 scale briefly before settling to 1. Makes it feel alive.

### Persistent:
- The "Most Popular" Analyst card: a slow gradient border animation. The accent border rotates its color subtly — not dramatically, just the opacity varies around the border from 0.3→0.6→0.3, cycling clockwise. Suggests energy.
- "Buy on Uniswap" button: matches hero CTA glow treatment — soft purple pulse
- On hover over any tier card: card lifts y:−4px (translateY), shadow deepens. Duration: 200ms. This already exists in the design system — use it.
- Contract address: on hover, monospace text gets a subtle green tint (`--bull`) — like it's a live signal

---

## 5. FEATURE BENTO GRID — GO HARDER

This is below the fold. Cinema mode.

### Entrance (each card individually):
IntersectionObserver with threshold 0.15. When card enters:
- Random small rotation offset at start: `rotate(${Math.random() * 2 - 1}deg)` — settles to rotate(0). Like cards being dealt.
- Scale: 0.96→1, opacity: 0→1, y: 30px→0. Duration: 700ms expo-out.
- Stagger: 80ms between each card in the grid (left-to-right, top-to-bottom order)
- The 2x1 wide cards (AI Brief, Macro Calendar): extra drama — start from y:50px, duration 900ms

### Persistent card interactions:
- On hover: top-edge light line (1px white at 0.18 opacity) animates width from 0 to 100% in 300ms. Retracts on mouse leave.
- Card internal content: label text gets `letter-spacing` expansion on hover — 0.06em→0.1em, 200ms. Subtle but tactile.
- "NEW" / "DESKTOP" tags: soft glow pulse matching their color

### AI Brief card specifically:
- The mock brief text inside the card: has a blinking cursor at the end (like it's being written). CSS `::after` pseudo with opacity 0→1→0, 800ms loop.
- "Listen" voice button: on hover, a small sound-wave SVG animation plays (three bars that animate height in sequence — visualizer effect)

### Builder Score card:
- Has a row of mini bar indicators. These bars animate height on scroll-enter (from 0 to their value, 600ms, staggered 40ms each). Looks like a chart loading.
- A small status dot next to "BUILDER SCORE" pulses green (like the LIVE dot)

---

## 6. TYPOGRAPHY EFFECTS — APPLIED GLOBALLY

### Headline hover behavior:
Any `h1`, `h2`, section headline: on hover, apply a subtle shimmer that sweeps left-to-right across the text. Implementation:
```css
.section-headline {
  background: linear-gradient(
    90deg,
    var(--text-primary) 0%,
    rgba(255,255,255,1) 45%,
    rgba(255,255,255,0.7) 50%,
    rgba(255,255,255,1) 55%,
    var(--text-primary) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-position: 100% 0;
  transition: background-position 0s; /* no transition by default */
}
.section-headline:hover {
  animation: headline-shimmer 800ms ease forwards;
}
@keyframes headline-shimmer {
  to { background-position: -100% 0; }
}
```
This gives a light sweep across text on hover — reads as glass/chrome, not cheesy.

### Nav link hover:
Nav links: on hover, characters dim and brighten individually. Apply staggered opacity reduction to non-hovered characters (siblings get opacity:0.4, hovered gets 1.0). 150ms transition. Feels premium — like Vercel's nav.

### Eyebrow labels (the small caps section labels):
On scroll-enter: characters appear left-to-right with 10ms stagger, opacity 0→1. No movement. Pure fade-in sequence.

### Serif moments (Playfair Display quote in Problem section):
The quote text renders character by character on scroll-enter with 8ms stagger. This is slow enough to read as "being written" — creates a pause moment.

### In day mode:
- Headline shimmer sweep uses a dark-on-light version: sweep is `rgba(0,0,0,0.8)` to `rgba(0,0,0,0.4)` and back
- Nav link dim: siblings go to opacity:0.3

---

## 7. DATA STACK SECTION (THE FOUR LAYERS)

### Entrance:
Four columns (On-Chain, Social, Technical, Macro) each enter from their respective direction:
- On-Chain: from left (x:−40px→0)
- Social: from below (y:40px→0)
- Technical: from below (y:40px→0, 100ms stagger after Social)
- Macro: from right (x:40px→0)
All: opacity 0→1, 600ms expo-out, triggered by IntersectionObserver.

### The "SPECTRE SYNTHESIS" node below the four columns:
After the four columns finish entering, the synthesis node appears with a subtle scale-in (0.8→1, 800ms, 400ms delay after last column). A thin connecting line from each column to the synthesis node animates: stroke-dashoffset from 100% to 0% (draws the lines down). Duration: 500ms per line, staggered.

### Persistent:
The synthesis box has the same breathing glow as the hero orb. Very subtle.

---

## 8. INTELLIGENCE HUB SECTION

The three agent cards (Breaking Analysis, Market Briefings, Deep Research) each have:
- A pulsing colored dot indicating they're "running": green, 2s pulse loop
- A mock "last updated" timestamp that ticks in real-time (updates the seconds)
- On hover: card expands slightly (scale:1.02), the timestamp ticks faster (playful)
- A live-feel counter in each card: "247 briefs published today" — this number increments randomly every 8-12 seconds by 1. Feels alive.

---

## 9. FINAL CTA — MAXIMUM IMPACT

The closing section. After all the buildup, this must land hard.

### Entrance:
Wait until user has scrolled 80% of the page before triggering.

- Background: a very slow-moving particle field (NOT the cursor particles — these are ambient, 30-40 tiny particles floating upward at 0.2px/frame, looping. Very faint, `rgba(139,92,246,0.15)` and `rgba(255,255,255,0.05)`)
- Headline: each WORD enters separately. "The" fades in → "platform" → "is" → "live." — 150ms between words. Not letters, words. More gravitas.
- Second line "The question is whether you're on it." — slides up from y:20px as a whole, 200ms after headline finishes.
- Two buttons: appear simultaneously with scale 0.9→1, opacity 0→1, 400ms. A brief delay of 300ms after headline.
- "Open Platform" button: on this section, the glow is stronger — `0 0 30px rgba(139,92,246,0.5)`. Statement piece.

---

## 10. SCROLL PROGRESS INDICATOR

A 2px progress bar at the very top of the page (position:fixed, z-index:99997). 
- Color: `linear-gradient(90deg, #8B5CF6, #6D28D9)` 
- Width: 0%→100% as user scrolls from top to bottom
- Fades to opacity:0 when user reaches bottom (they're done)
- In day mode: same purple — it's always purple

---

## 11. SECTION TRANSITIONS

Between major sections, add a very thin horizontal line (1px, `rgba(255,255,255,0.04)`) that animates its width from 0→100% as it enters the viewport. Duration: 600ms. This gives the page a sense of rhythm and intentional spacing.

---

## PERFORMANCE RULES — NON-NEGOTIABLE

1. **All canvas operations in requestAnimationFrame** — never setInterval for visual updates
2. **Particle count cap:** Max 80 active particles at once. If over cap, kill oldest.
3. **IntersectionObserver for all scroll triggers** — never scroll event listeners for animation
4. **`will-change: transform, opacity`** on animated elements — but remove after animation completes (`animation.onfinish`)
5. **`prefers-reduced-motion`:** If set, disable ALL animations except the progress bar. Page must still be usable.
6. **Mobile:** Kill cursor system entirely on touch devices (`'ontouchstart' in window`). Keep scroll animations but reduce intensity (y offsets halved, durations shortened by 30%).
7. **iframe:** Never animate the iframe content itself. Only animate the chrome wrapper.
8. **No GSAP, no Framer Motion, no anime.js** — pure CSS animations + vanilla JS requestAnimationFrame. Keep dependencies at zero.

---

## DAY MODE ANIMATION NOTES

All animations run identically in day mode. Color adjustments:
- Purple particles: remain purple (it's our brand color, works on white)
- White particles: become `rgba(0,0,0,0.15)` — dark on white
- Cursor ring: `rgba(139,92,246,0.7)` — same
- Headline shimmer: inverted (described above)
- Ambient orbs: become `rgba(139,92,246,0.04)` — very subtle on white
- Progress bar: same purple gradient

---

## FINAL CHECK

Before shipping Prompt 2:
1. Open DevTools performance panel. Scroll the full page. Confirm 60fps throughout.
2. Test with `prefers-reduced-motion: reduce` in DevTools. All animations should stop.
3. Test on a mid-tier mobile. Confirm particle system is disabled, scroll animations are smooth.
4. Check: does the app embed section feel like the most visually alive thing on the page? It should.
5. Check: does the cursor feel premium or annoying? If it slows down the cursor perceived speed at all — reduce particle count or kill the ring lag.
6. The "Buy $SPECT" / "Open Platform" buttons should be the most visually magnetizing elements on the page at all times. If anything else competes for that attention — tone it down.
