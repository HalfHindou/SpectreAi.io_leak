# TASK: Build the Spectre Brain Page

## MANDATORY: Read before writing ANY code
1. `SPECTRE_DESIGN_LAW.md` (root)
2. `src/index.css` (the `:root` variables)
3. `src/icons/spectreIcons.jsx` (icon system)
4. `src/components/WelcomePage.jsx` + `WelcomePage.css` (the design reference)

Do NOT skip this. Match what exists. If you can't tell where WelcomePage ends and your code begins, you did it right.

---

## WHAT WE'RE BUILDING

A new page: **Spectre Brain** (`/brain`)

This is the nerve center. The living market read. Everything the Spectre Brain system collects, classifies, and synthesizes displayed on one surface.

The page consumes these API endpoints from `api.spectreai.io`:
- `GET /v1/brain` - full state + latest conviction
- `GET /v1/brain/signals?severity=critical,high&hours=24` - signal feed
- `GET /v1/brain/narratives` - active narratives with lifecycle
- `GET /v1/brain/conviction?limit=20` - conviction history

---

## PAGE LAYOUT (top to bottom)

### Section 0: Page Header
- Title: "Spectre Brain" in `--font-display` (Space Grotesk), tight letter-spacing
- Subtitle: "Market Intelligence Engine" in `--text-tertiary`
- Right side: live pulse dot (green breathing animation) + "Updated 2m ago" timestamp
- Below title: a single-line status strip showing signal count: "142 signals (24h) | 8 critical | 23 high"
- NO brain icons, NO AI badges, NO sparkle emojis. The intelligence is invisible.

### Section 1: The Verdict (hero section)
This is the "screenshot moment." The brain's current market take.

Layout: Full-width glass card, the premium welcome-widget style.

Left side:
- Market stance as large text: "LEAN BEAR" in `--font-display`, bold, with color coding (bull = `--bull`, bear = `--bear`, neutral = `--text-tertiary`)
- Confidence: circular progress ring (small, 48px) with percentage inside in `--font-mono`
- Risk level: horizontal segmented bar (5 segments: low/moderate/elevated/high/extreme), filled segments glow with appropriate color

Right side:
- Key levels in a compact grid:
  ```
  BTC  Support: $70,000 / $68,000   Resistance: $75,000 / $78,000
  ETH  Support: $2,100 / $1,950     Resistance: $2,400 / $2,600
  ```
  All numbers in `--font-mono`. Support in `--bull`, resistance in `--bear`.

Below (full width within the card):
- The verdict text. 2-3 paragraphs from `conviction.verdict`. 
- Font: `--font-body` (Inter), `--text-secondary` opacity, 15px size, 1.7 line-height
- This should feel editorial. Generous line-height. Comfortable reading width (max 720px even if card is wider).

Short-term and medium-term outlook as two compact pills below the verdict:
- "24-48h: Bearish - watching 73K support" 
- "1-2 weeks: Neutral - CPI outcome determines direction"

### Section 2: Active Narratives
Title: "Active Narratives" in section header style

Grid of narrative cards (2 columns on desktop, 1 on mobile). Each card:
- Narrative name as card title ("ETH Underperformance", "Fed Decision Anxiety", "Memecoin Rotation")
- Status badge: colored pill showing lifecycle stage
  - emerging = purple/accent border
  - building = blue tint
  - peak = green glow
  - fading = orange/amber
  - dead = muted, low opacity
- Sentiment indicator: small bull/bear colored dot
- Assets: small tags/chips for related assets (BTC, ETH, etc.)
- Summary: 1 sentence take in `--text-secondary`
- Signal count: "12 signals" in `--text-muted`
- Counter-narrative (if exists): small italic text "Counter: Pectra upgrade catalyst"

Cards should stagger-fade-in on load. Hover lifts card 2px with border brightening.

### Section 3: Signal Feed
Title: "Signal Feed" with filter pills: "Critical" "High" "Medium" (toggle on/off, critical+high on by default)

A vertical timeline/feed of signals. Each signal entry:
- Left: severity dot (critical = red pulse, high = orange, medium = yellow, low = gray)
- Timestamp in `--font-mono`, `--text-muted` ("2m ago", "1h ago", "6h ago")
- Signal type as small uppercase label in `--text-tertiary` ("PRICE MOVE", "WHALE MOVE", "DEFI FLOW", "GOVERNANCE", "LIQUIDATION", etc.)
- Title: the main signal text in `--text-primary`
- Assets: small inline tags
- Sentiment: subtle background tint on the row (green for bullish, red for bearish, none for neutral)

Feed shows 20 signals by default. "Show more" button at bottom loads next 20.

The feed should feel alive. New signals (< 5 min old) should have a subtle entrance animation (slide in from left with fade).

### Section 4: Catalysts
Title: "Upcoming Catalysts"

Horizontal scroll strip of catalyst cards (or a compact list on mobile):
- Event name
- Date/time in `--font-mono`
- Expected impact: 1 sentence
- Related assets as tags
- Color-coded border: critical events get `--bear` left border, high get orange, medium get `--text-muted`

### Section 5: Conviction History
Title: "Conviction History"

A timeline showing how the brain's stance has evolved. This is the "we saw it first" proof.

Visual: horizontal timeline with dots at each conviction entry. Dots colored by stance (green = bull variants, red = bear variants, gray = neutral). Hovering a dot shows a tooltip with the timestamp, stance, confidence, and first 100 chars of verdict.

Below the timeline: the last 5 conviction entries as compact cards:
- Timestamp
- Stance + confidence badge
- First 2 sentences of verdict
- Signal count that informed it

---

## DATA FETCHING

Create a hook: `src/hooks/useBrainData.js`

```js
// Fetches all brain data with appropriate cache TTLs
// State + conviction: 60s cache (updates every 5 min server-side)
// Signals: 30s cache (real-time feel)
// Narratives: 120s cache (changes slowly)
// Conviction history: 300s cache (historical, rarely changes)

const BRAIN_API = 'https://api.spectreai.io/v1/brain';

export function useBrainData() {
  // Returns: { state, conviction, signals, narratives, convictionHistory, loading, error }
  // Each sub-resource fetched independently so the page loads progressively
  // Signals auto-refresh every 30s
  // State auto-refreshes every 60s
}
```

Fetch with API key header if available, but brain endpoints should work without auth for now (the route already has rate limiting and caching server-side).

---

## FILES TO CREATE

```
src/components/BrainPage.jsx       -- main page component
src/components/BrainPage.css       -- styles (dark + day mode)
src/hooks/useBrainData.js          -- data fetching hook
```

## FILES TO MODIFY

```
src/constants/pageRoutes.js        -- add 'brain' route
src/App.jsx                        -- register BrainPage
src/components/NavigationSidebar   -- add Brain nav item (use spectreIcons.aiAnalysis or similar)
```

---

## DESIGN CONSTRAINTS

- All CSS variables from `index.css`. No hardcoded colors.
- Glass card pattern from SPECTRE_DESIGN_LAW.md
- `--font-mono` for ALL numbers, prices, percentages, timestamps
- `--font-display` for section titles
- `--font-body` for body text
- Skeleton shimmer loading states, NEVER spinners
- Staggered fade-in on cards
- Day mode support on every element (`.app.app-day-mode` overrides)
- Mobile responsive: single column, cards stack, horizontal scroll for catalysts
- spectreIcons only. No Lucide, no Heroicons, no external icon libs.

## CREATIVE DIRECTION

This page should feel like a Bloomberg terminal meets Apple's design sensibility. Dense with information but never cluttered. The verdict section is the hero. It should feel authoritative. Like a senior analyst just briefed you.

The signal feed should feel alive. Like a pulse. Things appearing, updating. Not a static list.

The narratives should feel like a living organism. Each one has a lifecycle. The status badges should visually communicate where each narrative sits in its cycle.

The conviction history should tell a story. "We were bearish at 73K. Then bullish after CPI. Then cautious into FOMC." That journey, visualized as a timeline, is proof of the brain's memory and conviction.

Empty state (brain just started, no data yet): Show a glass card with "Brain is collecting its first signals..." and a subtle breathing pulse animation. NOT an error. NOT a blank page.

---

## DO NOT:
- Add brain/AI/robot icons or imagery
- Use "AI-powered" or "AI-generated" labels anywhere
- Make it look like a chatbot interface
- Use bright gradients or neon effects
- Build a scrolling Twitter-like feed. This is curated intelligence, not social media.
- Hard-code any mock data. If the API returns empty, show the empty state gracefully.

## REPORT AFTER BUILD:
- Sections implemented
- Responsive behavior verified (desktop + mobile)
- Day mode implemented
- Data hook working with live API
- Navigation entry added
- Any spectreIcons gaps (icons needed but not available)
