# Framer Marketplace Design Database

> Researched 2026-04-05. 4,023 components analyzed across 15+ categories.
> Purpose: steal patterns for Spectre Pulse page, insight cards, tweet cards, and feed layouts.

---

## 1. Glass & Depth Surfaces

### 1A. Glassmorphism Cards (238 components in marketplace)

**Core technique** - frosted glass with layered depth:
```css
/* The universal glass recipe across all top Framer components */
background: rgba(255, 255, 255, 0.05);
backdrop-filter: blur(12px) saturate(180%);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 16px;
box-shadow:
  0 8px 32px rgba(0, 0, 0, 0.3),
  inset 0 1px 0 rgba(255, 255, 255, 0.06);
```

**Patterns observed:**
- **Soft glow borders** instead of hard borders - luminous edge treatments using box-shadow with spread
- **3D tilt on hover** - perspective transform responds to cursor position, creates parallax depth
- **Adjustable blur intensity** - 8px for subtle, 20px for heavy frosted, 12px sweet spot
- **Gradient overlays** on glass - linear-gradient from white 5% to white 2% adds surface direction
- **Reflection line** - `inset 0 1px 0 rgba(255,255,255,0.06)` simulates top-edge light catch

**Steal for Spectre:** Pulse insight cards should use the soft glow border instead of hard 1px borders. The `inset` highlight line at top of cards is subtle but premium.

### 1B. Glass Tilt Card

**Interaction model:**
- Card tracks cursor position within its bounds
- Applies `rotateX` and `rotateY` transforms based on cursor offset from center
- Shadow shifts opposite to tilt direction (light source simulation)
- Smooth return to flat on mouse leave (spring easing)

**CSS technique:**
```css
.card {
  transform-style: preserve-3d;
  perspective: 1000px;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.card:hover {
  transform: rotateX(var(--tiltX)) rotateY(var(--tiltY));
  box-shadow: calc(var(--tiltY) * -1px) calc(var(--tiltX) * 1px) 20px rgba(0,0,0,0.3);
}
```

**Steal for Spectre:** Light tilt (max 3-5 degrees) on Pulse insight cards would feel premium without being distracting. Reserve for featured/hero cards only.

---

## 2. Animated Numbers & Counters

### 2A. Counter Components (6+ variants analyzed)

**Dominant patterns:**
1. **GPU-accelerated digit morph** - each digit slot clips overflow, numbers slide vertically
2. **Count-up on scroll into view** - IntersectionObserver triggers, counts from 0 to target
3. **Spring physics** - overshoot target slightly then settle (bounce)
4. **Prefix/suffix labels** - "$", "%", "M", "B" positioned outside the animated region

**Animation techniques:**
```css
/* Digit slot approach - each digit is a vertical strip */
.digit-slot {
  overflow: hidden;
  height: 1em;
}
.digit-strip {
  transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  /* Strip contains 0-9 stacked vertically, translateY to show correct digit */
}
```

**Number formatting observed:**
- Comma separators animated in (fade, not slide)
- Decimal points stay fixed while digits around them change
- Currency symbols stay static, number morphs
- Tabular-nums font-variant for stable widths

**Steal for Spectre:** The digit-slot morph is already in Spectre's `digit-morph.jsx`. Key addition: animate the comma separators with a subtle fade rather than hard appearance. Use count-up-on-scroll for Pulse stats section.

### 2B. Smooth Counter (GPU-accelerated)

**Trigger modes:**
- On load (immediate)
- When in view (scroll-triggered, preferred)
- Loop (continuous cycling, good for live data)

**Formatting:** Native font styling + prefix/suffix, fade option during transitions.

**Steal for Spectre:** Loop mode is perfect for live price tickers. Combine with Pulse's real-time data to create continuously updating stat counters.

---

## 3. Bento Grid Layouts

### 3A. Grid Patterns (170+ bento components)

**Layout structures observed:**
```
Standard 2x2:        Asymmetric 3x2:       Feature Bento:
+----+----+          +--------+----+        +--------------+----+
|    |    |          |        |    |        |              |    |
+----+----+          |  2col  +----+        |   Hero 2x2   +----+
|    |    |          |        |    |        |              |    |
+----+----+          +----+---+----+        +----+----+----+----+
                     |    |        |        |    |    |         |
                     +----+--------+        +----+----+---------+
```

**Key patterns:**
- **Spanning** - individual cells span 2 columns or 2 rows for emphasis
- **Auto-fill** - `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` for responsive
- **Intentional size hierarchy** - hero card is 2x size, supporting cards are 1x
- **Consistent gaps** - 8-16px gaps, never larger (tight = premium)
- **No empty cells** - every cell filled, grid-auto-flow: dense to prevent holes

**Content within cells:**
- **Stat cells**: large number (32-48px) + small label (11-12px) + optional sparkline
- **Feature cells**: icon (24px) + heading + 1-line description
- **Image cells**: full bleed image with gradient overlay at bottom for text
- **Chart cells**: mini area chart or bar chart, no axes, just the shape

**Hover interactions:**
- Overlay text that slides up from bottom
- Border brightens one step
- Subtle scale(1.02) or translateY(-2px)
- Shadow depth increases

**Steal for Spectre:** Pulse page should use asymmetric bento grid. Hero insight card spans 2 columns. Quick stats in 2x2 grid. The "no empty cells" rule is critical - dense information display.

### 3B. Bento Gallery (3.7K installs)

**Specific techniques:**
- Lightbox on click for expanded view
- Full keyboard navigation within gallery
- Dynamic spanning - individual items can stretch across grid tracks
- Overlay on hover with gradient fade-up from bottom

**Steal for Spectre:** The overlay-on-hover with gradient fade is perfect for Pulse tweet cards - show engagement metrics and action buttons on hover.

---

## 4. Typography-Forward Components

### 4A. Text Spotlight Effect

**Mechanism:**
- Base text rendered in muted color (rgba 0.3-0.4 opacity)
- Cursor creates circular mask/spotlight (CSS `radial-gradient` as mask)
- Within spotlight radius, text renders at full color/opacity
- Spotlight follows cursor with smooth interpolation
- Adjustable reveal radius and blur/feather on edges

**CSS approach:**
```css
.text-spotlight {
  color: rgba(245, 245, 247, 0.2); /* base muted */
  background: radial-gradient(
    circle 120px at var(--mx) var(--my),
    rgba(245, 245, 247, 1) 0%,
    rgba(245, 245, 247, 0.2) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

**Steal for Spectre:** Use for Pulse page section headers or AI insight text. Muted text that illuminates as cursor passes creates "intelligence emerging from darkness" feel.

### 4B. Scroll Text Reveal

**Animation modes:**
- Character by character (most dramatic, slow)
- Word by word (balanced, recommended)
- Line by line (fastest, best for paragraphs)

**Technique:**
- Each word/char starts at opacity 0.15 and color muted
- As scroll position crosses trigger threshold, transitions to opacity 1.0 and bright color
- Trigger position configurable: top/middle/bottom of viewport
- Easing is crucial - use `cubic-bezier(0.16, 1, 0.3, 1)` for natural feel

**Steal for Spectre:** Perfect for AI Brief/insight text in Pulse. As user scrolls through the feed, insight paragraphs reveal word-by-word. Creates reading rhythm.

### 4C. Typewriter Effect

**Mechanics:**
- Characters appear one by one with configurable speed
- Blinking cursor (width/height adjustable) at insertion point
- After completing a string, pauses, then deletes character by character
- Cycles through array of strings infinitely
- Separate speed controls for typing vs deleting

**Steal for Spectre:** Could use for Pulse page hero area cycling through market themes: "Markets are fearful" / "BTC dominance rising" / "Smart money accumulating". But use sparingly - can feel gimmicky.

### 4D. Text Glow Hover

**Technique:**
- Up to 200 blurred shadow copies of text, independently positioned
- Multi-layered text-shadow that shifts based on cursor position
- Creates volumetric, 3D parallax-style glow behind text
- Chromatic color blending between two hues
- Resets gracefully to center on mouse leave

**Steal for Spectre:** Too heavy for production cards, but the concept of multi-layered text-shadow for a subtle glow on hover could work for Pulse card headlines at 5-10 layers instead of 200.

---

## 5. Social Proof & Testimonial Cards

### 5A. Twitter/X Testimonial Cards

**Layout structure:**
```
+----------------------------------+
| [Avatar 40px] @handle  [X logo]  |
|              Name  [verified]     |
|                                   |
| "Tweet text content here that     |
|  spans multiple lines with        |
|  natural wrapping..."             |
|                                   |
| [heart] 234  [retweet] 56  3h    |
+----------------------------------+
```

**Display modes:**
1. **Stack** - cards in a 3D deck, skewed perspective, spring physics on hover to fan out
2. **Grid** - masonry-style multi-column layout
3. **List** - vertical single-column for "wall of love"

**Visual details:**
- Full typography control per element (quote, name, handle)
- Star ratings (1-5) with customizable colors
- Smart dimming - inactive cards get subtle overlay, vanishes on hover
- Pure CSS + Framer Motion, zero external dependencies
- 60fps spring animation on stack spread

**Steal for Spectre:** This IS the tweet card pattern for Pulse. Key: the Stack mode with 3D deck physics is perfect for featured tweets. Smart dimming (overlay on inactive, clear on hover) creates focus without hiding content.

### 5B. Social Proof Card (Avatar Stack)

**Visual structure:**
- Up to 4 overlapping circular avatars (-8px margin between each)
- "+X more" badge after the stack
- Star rating row with optional gradient on the number
- Trust message ("Trusted by 1000+ customers")
- Horizontal or vertical layout option

**Steal for Spectre:** The overlapping avatar stack is great for showing "X traders watching this token" or "5 whales moved this asset". The compact format packs social proof into minimal space.

### 5C. Flowing Testimonials (Infinite Marquee)

**Technique:**
- Content duplicated to fill 2x viewport width
- CSS animation: `translateX(0)` to `translateX(-50%)` linear infinite
- Cards flow continuously in horizontal or vertical direction
- Adjustable speed and easing
- Seamless loop with no visible gap

```css
.flow-track {
  display: flex;
  gap: 16px;
  animation: scroll 30s linear infinite;
  width: max-content;
}
.flow-track:hover { animation-play-state: paused; }
@keyframes scroll {
  to { transform: translateX(-50%); }
}
```

**Steal for Spectre:** This is the pattern for a horizontal tweet/insight marquee at the top of Pulse. Live tweets flowing continuously. Pause on hover to read. Content duplicated for seamless loop.

---

## 6. Interactive Border & Glow Effects

### 6A. Border Tracking (Cursor-Following Glow)

**Mechanism:**
- Element border is transparent by default
- On hover, a gradient glow appears at cursor position along the border
- Uses `background: radial-gradient(circle at var(--x) var(--y), ...)` on a pseudo-element
- Proximity-based: glow can activate before cursor reaches the element
- Fade transition on enter/leave

**CSS technique:**
```css
.card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: radial-gradient(
    300px circle at var(--mouse-x) var(--mouse-y),
    rgba(255, 255, 255, 0.1),
    transparent 40%
  );
  z-index: -1;
  opacity: 0;
  transition: opacity 0.3s;
}
.card:hover::before { opacity: 1; }
```

**Steal for Spectre:** This is the single most impactful micro-interaction for Pulse cards. A subtle border glow that follows the cursor makes every card feel alive. Lightweight, GPU-friendly, works on all card types. MUST implement.

### 6B. Conic Gradient Animated Border

**Mechanism:**
- `conic-gradient` rotates continuously around the card border
- Created via pseudo-element larger than card, masked to show only at edges
- Blur layer underneath creates glow effect
- Uses `@property` for animatable CSS custom properties

```css
@property --angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.card::after {
  background: conic-gradient(from var(--angle), #f5f5f7, transparent 50%, #f5f5f7);
  animation: rotate 4s linear infinite;
}
@keyframes rotate { to { --angle: 360deg; } }
```

**Steal for Spectre:** Reserve for the single "featured" or "breaking" insight card on Pulse. A slowly rotating border glow signals importance without being flashy. Only ONE card at a time should have this.

---

## 7. Card Stack & Carousel Patterns

### 7A. Card Stack (6.2K installs)

**Stacking behavior:**
- Top card at full scale and opacity
- Cards behind: progressively smaller (scale 0.95, 0.9), offset down (8px, 16px), dimmer (opacity 0.7, 0.4)
- Swipe/drag top card to send to back
- Spring physics for return animation (stiffness + damping configurable)

**Depth formula:**
```
Card[n] {
  scale: 1 - (n * 0.05)
  translateY: n * 8px
  opacity: 1 - (n * 0.2)
  z-index: total - n
}
```

**Steal for Spectre:** Use card stack pattern for "3 key insights" on Pulse - user swipes through AI-generated market takes. Each card is a self-contained insight with headline + 2-line summary + relevance tag.

### 7B. 3D Card Scroll (Three.js)

**Technical approach:**
- Three.js scene with camera perspective controls
- Cards rendered as textured planes in 3D space
- GSAP scroll-linked animation drives card movement
- Click opens modal with scale transform

**Steal for Spectre:** Too heavy for production (Three.js dependency). But the concept of depth-layered cards in perspective is achievable with CSS transforms alone for a lighter "cards receding into distance" effect.

---

## 8. Dashboard & Data Components

### 8A. Analytics Dashboard

**Component pack includes:**
- **Stat cards** - large number + label + optional change indicator
- **Chart bars** - minimal bar charts for comparison
- **Status cards** - KPI tracking with color-coded states
- Clean, minimal design that adapts to any aesthetic

**Stat card pattern:**
```
+--------------------+
| TOTAL REVENUE      |  <- 11px uppercase label, muted
| $45,231            |  <- 28-32px bold number, primary
| ^ +20.1%           |  <- 13px change badge, green/red
| [mini sparkline]   |  <- 48px tall area chart
+--------------------+
```

**Steal for Spectre:** This IS the Pulse stat card pattern. Label on top (tiny uppercase), huge number, change badge, optional sparkline. Four of these in a 2x2 grid for market overview.

### 8B. Stock Price Chart Components

**Common patterns across chart components:**
- **Green for gains, red for losses** - automatic color switching
- **Timeframe selector** - pill-shaped buttons: 1D, 5D, 1M, 3M, 6M, 1Y
- **Smooth line chart** - area fill with gradient fade to transparent
- **Instant loading state** when switching periods (skeleton, not spinner)
- **Company name + symbol** pulled from data
- **Dark/light mode** automatic styling
- **Customizable accent colors** for the chart line

**Steal for Spectre:** The timeframe pill selector pattern and instant skeleton loading between timeframes. Chart area fill should use gradient from line color to transparent (not flat fill).

---

## 9. Notification & Toast Patterns

### 9A. Social Proof Popup

**Design:**
- Small card appearing at screen corner (configurable: BL, BR, TL, TR)
- Spring-based slide-in animation + entrance glow
- Shimmer border effect on appear
- Countdown progress bar at bottom
- Cycles through: review notifications, purchase messages, viewer activity
- Randomized delays between toasts (creates organic feel)

**5 theme presets:** Purple, Green, Dark, Light, Custom - each with per-theme opacity tuning.

### 9B. FOMO Toast

**Structure per toast:**
```
+--------------------------------------+
| [Avatar/Initials] Name just bought   |
|                   Product Name       |
| [location icon] City  .  2m ago      |
| [=========================----] prog |
+--------------------------------------+
```

- Avatar with fallback to colored circle with initials
- Time-ago randomly sampled: "Just now", "1m ago", "2m ago", "3m ago", "5m ago"
- Overlap guard prevents toast collision
- Mobile-specific sizing adjustments

**Steal for Spectre:** Adapt FOMO toast pattern for live Pulse activity feed: "Whale moved 500 BTC" / "Smart money buying SOL" / "Liquidation cascade detected". The progress bar adds urgency. The randomized timing feels organic.

---

## 10. Marquee & Ticker Components

### 10A. Interactive Marquee

**Velocity-aware movement:**
- Default: smooth continuous scroll at set speed
- On user scroll: marquee speed increases proportional to scroll velocity
- Direction reverses based on scroll direction
- Pause on hover (optional)

**Steal for Spectre:** A velocity-aware marquee for Pulse's top ticker strip. When user scrolls the page, the ticker speeds up sympathetically. Creates connected, alive feel.

### 10B. 3D Image Marquee

**Visual effect:**
- Images in a tilted perspective grid
- Columns scroll vertically in opposite directions (alternating)
- Creates wave-like motion
- Subtle grid lines with gradient fades
- Hover lifts individual images toward viewer

**Steal for Spectre:** The alternating-direction column scroll is great for a "token activity" strip showing token logos scrolling in opposite lanes. Creates visual energy without being distracting.

### 10C. Neon Ticker

**Visual:**
- Text with glow effect (text-shadow layers)
- Configurable glow color
- Realistic flicker animation (subtle opacity oscillation)
- Scroll duration 5-60s per loop

**Steal for Spectre:** Reserve neon/glow ticker for alert-level market events only. "EXTREME FEAR" or "FLASH CRASH" could get the flicker treatment temporarily.

---

## 11. Animated Backgrounds

### 11A. Gradient Components (Mesh, Aurora, Fluid)

**Types observed:**
1. **Mesh gradient** - WebGL shader with simplex noise, organic blob movement
2. **Aurora** - horizontal bands of color that wave vertically
3. **Fluid** - liquid-like movement with adjustable viscosity
4. **Conic** - rotating color wheel effect
5. **Grainy** - grain texture overlay on gradients

**Common controls:**
- Up to 8 color blobs with individual colors
- 6+ motion modes (wave, pulse, drift, spiral, random, static)
- Grain amount, size, and optional animation
- Speed from static to fast-flowing

**Steal for Spectre:** A very subtle mesh gradient behind the Pulse hero section (opacity 0.03-0.05) with 2-3 colors would add depth without competing with content. Use warm colors that shift based on market state: green tones for bullish, red for bearish, purple for high volatility.

### 11B. Gravity Particles

**Behavior:**
- Particles float with physics-based motion
- Attract or repel from cursor
- Glowing particle effect on interaction
- Adjustable: count, size, speed, color, gravity strength, interaction radius

**Steal for Spectre:** Too heavy for a production app page. But the concept of 15-20 very subtle floating particles behind the Pulse feed could work as a "market is alive" ambient indicator. Keep particle count very low and opacity at 0.05.

---

## 12. Scroll & Timeline Components

### 12A. Animated Timeline

**Structure:**
```
[Node]-------------- Card: Title, Date, Description
    |
    | (progress line fills on scroll)
    |
[Node]-------------- Card: Title, Date, Description
    |
[Node]-------------- Card: Title, Date, Description
```

**Details:**
- Vertical progress line fills top-to-bottom as user scrolls
- Node size: 12-32px circles
- Cards have gradient accent on top bar
- Glow animation on node activation
- Status badges per milestone
- Card spacing: 16-60px configurable

**Steal for Spectre:** The timeline pattern is perfect for Pulse's chronological feed. A thin progress line on the left with nodes at each event. Active (scrolled past) nodes glow, upcoming ones are muted. Cards branch off to the right.

### 12B. Infinite Scroll Grid

**Technique:**
- Grid tiles wrap both horizontally and vertically
- Physics-based momentum scrolling
- Content auto-fills to create seamless infinite surface
- No visible seams between repeated content

**Steal for Spectre:** The momentum physics for scroll feel. When user flicks the Pulse feed, it should have natural deceleration, not abrupt stop. CSS `scroll-behavior: smooth` is not enough - use momentum calculation.

---

## 13. Micro-Interaction Catalog

### Compiled from all components analyzed:

| Interaction | Technique | Performance | Use in Spectre |
|-------------|-----------|-------------|----------------|
| Hover lift | `translateY(-2px)` + shadow upgrade | CSS only, 60fps | All Pulse cards |
| Border glow follow | `radial-gradient` at `var(--mouse-x/y)` | CSS + tiny JS listener | Featured cards |
| Digit morph | Overflow-hidden slot + translateY | GPU-accelerated | Price displays |
| Tilt on hover | `rotateX/Y` from cursor position | CSS transform, 60fps | Hero card only |
| Scale press | `scale(0.97)` on `:active` | CSS only | All tappable elements |
| Fade-up enter | `opacity 0->1 + translateY(12->0)` | CSS animation | Cards entering viewport |
| Shimmer border | `conic-gradient` rotation | CSS `@property`, GPU | Breaking news card |
| Spotlight text | `radial-gradient` + `background-clip: text` | CSS + JS listener | Section headers |
| Skeleton pulse | `background-position` animation | CSS only | Loading states |
| Spring bounce | `cubic-bezier(0.34, 1.56, 0.64, 1)` | CSS only | Button presses, tab switches |

---

## 14. Spectre Pulse Page - Stolen Patterns Summary

### Priority 1: Must Implement

1. **Cursor-following border glow** on insight cards (Section 6A)
   - Lightweight, maximum visual impact, works on all cards
   - `radial-gradient` at mouse position on `::before` pseudo-element

2. **Bento grid layout** for insight cards (Section 3A)
   - Hero insight spans 2 columns, rest are 1x1
   - `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
   - `grid-auto-flow: dense` to prevent holes
   - Tight 8-12px gaps

3. **Stat card pattern** from analytics dashboards (Section 8A)
   - Tiny uppercase label + huge number + change badge + sparkline
   - 2x2 grid for market overview stats

4. **Tweet card layout** from Twitter testimonials (Section 5A)
   - Avatar + handle + text + engagement metrics
   - Smart dimming on inactive cards
   - Grid or List display modes

5. **Flowing marquee** for top ticker strip (Section 5C, 10A)
   - Continuous horizontal scroll, pause on hover
   - Content duplicated for seamless loop
   - Velocity-aware speed on page scroll

### Priority 2: Should Implement

6. **Scroll text reveal** for AI insights (Section 4B)
   - Word-by-word opacity/color transition as user scrolls
   - Creates reading rhythm in the feed

7. **Card stack** for featured insights (Section 7A)
   - 3 stacked cards with depth formula (scale, offset, opacity)
   - Swipe to cycle through AI market takes

8. **Animated timeline** for chronological feed (Section 12A)
   - Thin progress line + nodes + branching content cards
   - Scroll-driven activation with glow on nodes

9. **FOMO toast** for live activity (Section 9B)
   - "Whale moved 500 BTC" notifications
   - Spring slide-in + progress bar + randomized timing

10. **Gradient fade overlay** on hover for tweet cards (Section 3B)
    - Bottom-up gradient reveals action buttons
    - Keeps card clean in default state

### Priority 3: Nice to Have

11. **Rotating conic gradient border** for breaking news card (Section 6B)
12. **Mesh gradient background** that shifts with market sentiment (Section 11A)
13. **Text spotlight** on section headers (Section 4A)
14. **Spring bounce easing** on all tab/pill switches
15. **Overlapping avatar stack** for "traders watching" social proof (Section 5B)

---

## 15. CSS Techniques Reference

### Gradient Border with Glow (pure CSS)
```css
.card {
  position: relative;
  background: var(--bg-surface);
  border-radius: 16px;
  overflow: hidden;
}
.card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
```

### Cursor-Following Glow (JS + CSS)
```js
// Minimal JS - one listener per card container, delegated
container.addEventListener('mousemove', (e) => {
  const cards = container.querySelectorAll('.card');
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  });
});
```
```css
.card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: radial-gradient(
    250px circle at var(--mouse-x) var(--mouse-y),
    rgba(255, 255, 255, 0.06),
    transparent 40%
  );
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.card:hover::before { opacity: 1; }
```

### Infinite Marquee (pure CSS)
```css
.marquee { overflow: hidden; }
.marquee-track {
  display: flex;
  gap: 24px;
  width: max-content;
  animation: marquee 40s linear infinite;
}
.marquee-track:hover { animation-play-state: paused; }
@keyframes marquee { to { transform: translateX(-50%); } }
/* Duplicate content inside .marquee-track so it loops seamlessly */
```

### Scroll-Triggered Fade-In
```css
.card {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.card.visible {
  opacity: 1;
  transform: translateY(0);
}
/* JS: IntersectionObserver adds .visible when card enters viewport */
```

### Digit Morph Animation
```css
.digit-slot {
  display: inline-block;
  overflow: hidden;
  height: 1.2em;
  line-height: 1.2em;
  vertical-align: top;
}
.digit-strip {
  display: flex;
  flex-direction: column;
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
/* To show digit N: transform: translateY(calc(N * -1.2em)) */
```

### Conic Border Rotation
```css
@property --border-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.featured-card {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--bg-surface), var(--bg-surface)) padding-box,
    conic-gradient(from var(--border-angle), rgba(245,245,247,0.15), transparent 30%, rgba(245,245,247,0.15)) border-box;
  animation: border-spin 8s linear infinite;
}
@keyframes border-spin { to { --border-angle: 360deg; } }
```

---

## 16. Design Principles Extracted

1. **Tight gaps signal premium** - 8-12px gaps between cards, never 24px+. Dense = information-rich.
2. **Depth through layers, not borders** - Use shadow layers and z-depth instead of visible borders.
3. **One hero, many supporting** - One card gets the 2x treatment, rest are uniform. Never all equal.
4. **Motion earns trust** - Smooth 60fps transitions make data feel reliable. Janky animation = unreliable data.
5. **Cursor = spotlight** - The cursor should illuminate what it touches (glow follow, spotlight, tilt response).
6. **Numbers dominate** - In stat cards, the number is 2-3x the size of its label. The data IS the visual.
7. **Smart dimming** - Inactive/unfocused items get subtle overlay. Focused item gets full clarity. Creates depth without hiding.
8. **Continuous motion = live data** - Marquees, flowing feeds, and looping counters signal "this is real-time".
9. **Progressive disclosure** - Show the essential on default state, reveal details on hover/interaction.
10. **Glass is contextual** - Heavy glass for overlays/modals, light glass for cards, no glass for inline content.
