# TASK: Build Spectre Brain Page with Mood Board

## MANDATORY: Read before writing ANY code
1. `SPECTRE_DESIGN_LAW.md` (root)
2. `src/index.css` (the `:root` variables)
3. `src/icons/spectreIcons.jsx` (icon system)
4. `src/components/WelcomePage.jsx` + `WelcomePage.css` (the design reference)

Match what exists. If you can't tell where WelcomePage ends and your code begins, you did it right.

---

## WHAT IS THIS

A new page: **Spectre Brain** (route: `/brain`, nav id: `brain`)

This is NOT a dashboard. It's a living mood board. Like watching a brilliant analyst think out loud in real-time. The brain observes the market, forms opinions, tracks narratives, and proves its track record. Users come here to feel the market's pulse through the brain's eyes.

Think of it as three layers stacked vertically:
1. **The Mind** (top) - current conviction, mood, thesis
2. **The Feed** (middle) - what the brain is seeing and thinking right now
3. **The Receipts** (bottom) - track record, proof cards, accuracy stats

---

## API ENDPOINTS (all at api.spectreai.io)

```
GET /v1/brain                              -> state + latest conviction
GET /v1/brain/signals?severity=X&hours=24  -> signal feed
GET /v1/brain/narratives                   -> active narratives with lifecycle
GET /v1/brain/conviction?limit=20          -> conviction history
GET /v1/brain/track-record                 -> graded stats + proof cards
GET /v1/brain/state-file                   -> compact state (for reference)
```

---

## DATA HOOK: src/hooks/useBrainData.js

```js
const BRAIN_API = 'https://api.spectreai.io/v1/brain';

// Fetch each resource independently for progressive loading
// State: 30s refresh (the heartbeat)
// Signals: 30s refresh (real-time feel)
// Narratives: 120s refresh (changes slowly)
// Conviction history: 300s refresh (historical)
// Track record: 300s refresh (updates every 6h)

export function useBrainData() {
  // Returns:
  // {
  //   state, conviction, signals, narratives,
  //   convictionHistory, trackRecord,
  //   loading, error
  // }
  //
  // Each field loads independently. Page renders progressively.
  // If an endpoint fails, that section shows graceful empty state.
  // NEVER block the whole page on one failed fetch.
}
```

---

## PAGE LAYOUT

### Section 0: Page Header (minimal, not a hero)

Left: "Spectre Brain" in `--font-display`, letter-spacing: -0.03em, 24px
Subtitle: nothing. The page speaks for itself.

Right: Live pulse (green breathing dot) + "Updated 2m ago" in `--font-mono` `--text-muted`

Below: slim stat strip, single line, `--text-tertiary`, small:
`218 signals (24h) · 12 critical · BTC $74,631 · F&G 54 Neutral`
All numbers in `--font-mono`. This strip is the vital signs monitor.

---

### Section 1: THE MIND (hero conviction card)

Full-width glass card. The premium welcome-widget gradient treatment:
```css
background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
```

This card has three zones inside it:

**Zone A (left ~40%): The Stance**

The market stance as a single dominant word:
- "BULLISH" / "BEARISH" / "NEUTRAL" / "CAUTIOUS"
- Map from API values: strong_bull -> "BULLISH", lean_bull -> "CAUTIOUS BULL", lean_bear -> "CAUTIOUS BEAR", strong_bear -> "BEARISH", neutral -> "NEUTRAL"
- Font: `--font-display`, 36px, bold, letter-spacing: -0.04em
- Color: `--bull` for bull variants, `--bear` for bear variants, `--text-tertiary` for neutral
- Below it: confidence as text "80% conviction" in `--font-mono`, 14px, `--text-secondary`
- Below that: risk level as a minimal 5-segment bar (each segment 4px tall, 20px wide, with 2px gaps)
  - Filled segments: use gradient from green (low) to red (extreme)
  - Label below: "MODERATE RISK" in `--text-muted`, uppercase, 10px

**Zone B (right ~60%): The Thesis**

This is the mood board moment. The brain's current market thesis written in its own voice.

- Pull from `conviction.verdict` (2-3 paragraphs)
- Font: `--font-body` (Inter), 14px, line-height 1.8, `--text-secondary`
- Max-width: 600px (comfortable reading measure even if card is wider)
- The first sentence should be slightly larger (15px) and `--text-primary` for emphasis
- No heading above it. The text just speaks.
- This should feel like reading a handwritten note from a senior trader. Not a report.

**Zone C (bottom, full width inside card): Key Levels + Timeframe**

A single horizontal row with subtle dividers:

```
BTC  $74,631  Support 72K / 70K  Resistance 78K / 80K  |  ETH  $2,381  Support 2.1K / 1.9K  Resistance 2.5K / 2.7K
```

All numbers `--font-mono`. Current price in `--text-primary`. Support in `--bull` at 0.7 opacity. Resistance in `--bear` at 0.7 opacity. Labels in `--text-muted`.

Below the levels, two compact outlook pills:
- "Short-term (24-48h): Bearish" with bear-colored left dot
- "Medium-term (1-2w): Neutral" with neutral-colored left dot
- Font: `--font-body`, 12px, `--text-tertiary`

---

### Section 2: ACTIVE NARRATIVES

Section label: "Narratives" in `--font-display`, 16px, `--text-tertiary`, uppercase, letter-spacing 0.1em. Minimal.

Horizontal scrollable row of narrative cards (not a grid, scrollable like Apple TV show cards).
On mobile: horizontal scroll with snap. On desktop: show 3-4 cards, scroll for more.

Each narrative card:
- Width: 280px, fixed
- Glass card style (subtle, not the hero card treatment)
- Top: status badge as a thin colored line across the top edge of the card
  - emerging: purple (`--accent`)
  - building: blue (#3B82F6)
  - peak: green (`--bull`)
  - fading: amber (#F59E0B)
  - dead: `--text-muted`
- Narrative name: `--font-display`, 15px, `--text-primary`
- One-sentence summary: `--font-body`, 13px, `--text-secondary`, 2 lines max with ellipsis
- Bottom row: asset tags (small pills, glass-style) + signal count in `--text-muted`
- If counter_narrative exists: small italic line "Counter: Pectra catalyst" in `--text-muted`
- Hover: lift 2px, border brightens

---

### Section 3: THE FEED (mood board / thought stream)

This is the living center of the page. Not a table. Not a list. A stream.

Section label: "Feed" with filter pills to the right: Critical · High · All
Default: Critical + High visible. Toggle to include lower.

Visual style: think of it like a curated Substack feed meets Bloomberg terminal.
Each signal is a card in a single-column stream, not a row in a table.

Each signal card:
- Full width (within content area, max ~720px centered or left-aligned)
- Left edge: 3px colored bar for severity
  - critical: `--bear` (red)
  - high: #F59E0B (amber)
  - medium: `--text-muted`
  - low: `--border-subtle`
- Content:
  - Top line: signal type as small uppercase label in `--text-muted` ("WHALE MOVE" "DEFI FLOW" "LIQUIDATION" "GOVERNANCE") + timestamp in `--font-mono` `--text-muted` ("3m ago" "1h ago")
  - Title: `--font-body`, 14px, `--text-primary`. This IS the signal. "PancakeSwap Infinity TVL +104% in 24h" or "$144.6M ETH shorts liquidated"
  - Summary (if exists): `--font-body`, 13px, `--text-tertiary`, 1-2 lines
  - Bottom: asset tags as tiny pills + sentiment dot (green/red/gray)
- Subtle background tint on bullish signals: rgba(16,185,129,0.03). Bearish: rgba(239,68,68,0.03). Just barely visible.
- New signals (< 5 min old) get a subtle left-slide entrance animation
- Space between cards: 8px (tight but breathing)

Show 15 signals by default. "Load more" at bottom as a minimal text button, not a big CTA.

**Empty state:** Glass card with "Brain is listening..." and a soft breathing pulse. Not an error.

---

### Section 4: CATALYSTS (compact)

Section label: "Catalysts" in same style as Narratives.

Compact list (not cards), max 5 items visible:
- Each line: date in `--font-mono` `--text-muted` ("Apr 17") + event name in `--text-primary` + expected impact snippet in `--text-tertiary`
- Critical catalysts get a red dot before the date
- This section is informational, not interactive. It's "what's coming."

---

### Section 5: THE RECEIPTS (track record)

This only appears once the grader has produced data (after 24h+).
If `trackRecord.stats.total_calls === 0`, hide this entire section.

Section label: "Track Record" in same style.

**Stats row (when data exists):**
Four stat blocks in a horizontal row:
```
ACCURACY     STREAK      CALLS      BEST GRADE
  73%        12 correct   84 total    A+
```
Each in a small glass card. Number in `--font-mono`, 24px, `--text-primary`. Label in `--text-tertiary`, 11px.

**Proof cards:**
Below the stats, show the best calls as "proof cards."

Each proof card is a compact glass card:
- Grade badge: large letter grade in top-left ("A+" in `--bull`, "B" in `--text-tertiary`, "F" in `--bear`)
- Headline: "Called lean_bull at $73,204. BTC moved +4.2% in 48h."
  - `--font-body`, 14px, `--text-primary`
- Details row: "Apr 14, 2026 · F&G 12 at call · 48h window"
  - `--font-mono`, 11px, `--text-muted`
- Verdict snippet: first 150 chars of what the brain said at the time
  - `--font-body`, 12px, `--text-tertiary`, italic

Show max 5 proof cards. Best grades first.

**Empty state (first 24h):** Don't show this section at all. No "coming soon" message. It just appears when there's data.

---

### Section 6: CONVICTION HISTORY (timeline)

At the very bottom. A compact visual timeline.

Horizontal scrollable strip of conviction dots:
- Each dot represents one conviction entry
- Dot color: `--bull` for bull stances, `--bear` for bear, gray for neutral
- Dot size: 8px, with a subtle glow matching color
- Connected by a thin line (`--border-subtle`)
- Hover on a dot: tooltip shows timestamp, stance, confidence, and first sentence of verdict
- Most recent on the right

Below the timeline: a simple toggle "Show full history" that expands to show the last 10 convictions as compact text entries:
```
Apr 14, 00:03 UTC · STRONG BULL · 80% · "DeFi resurgence gaining momentum..."
Apr 13, 18:02 UTC · LEAN BEAR · 65% · "Watching 73K support closely..."
```
All in `--font-mono` for timestamps, `--font-body` for text.

---

## FILES TO CREATE

```
src/components/BrainPage.jsx       -- main page component
src/components/BrainPage.css       -- styles (dark + day mode)
src/hooks/useBrainData.js          -- data hook
```

## FILES TO MODIFY

```
src/constants/pageRoutes.js        -- add '/brain': 'brain'
src/App.jsx                        -- add {page === 'brain' && <BrainPage />}
NavigationSidebar                  -- add Brain entry, use spectreIcons.aiAnalysis or spectreIcons.sparkles
```

---

## DESIGN CONSTRAINTS

- All CSS variables from `index.css`. Zero hardcoded colors.
- Glass card pattern from SPECTRE_DESIGN_LAW.md
- `--font-mono` for ALL numbers, prices, percentages, timestamps
- `--font-display` for section labels and stance
- `--font-body` for body text and signal content
- Skeleton shimmer loading (3 fake signal cards + 1 fake conviction card during load)
- Staggered fade-in: cards appear with 50ms stagger
- Day mode on every element (`.app.app-day-mode`)
- Mobile: single column, narratives horizontal scroll, feed full-width, stats stack 2x2
- spectreIcons only. No external icon libraries.
- Page max-width: 960px centered. This is a reading experience, not a sprawling dashboard.

## WHAT MAKES THIS PAGE SPECIAL

The mood board feel. It's not rows and columns. It's a curated stream.
The brain has a voice. The verdict reads like a person wrote it.
The narrative cards feel alive with their lifecycle colors.
The signal feed feels like a pulse, not a log.
The proof cards are shareable moments.
The whole page should make someone think "this thing is watching everything I can't."

## EMPTY STATE (brain just started)

If conviction is null: The Mind card shows "Brain is forming its first conviction..." with a subtle breathing animation. No stance, no levels.
If signals is empty: Feed shows "Listening for signals..." with skeleton shimmer.
If narratives is empty: Section hidden entirely.
If track record is empty: Section hidden entirely.

Everything degrades gracefully. The page works with 1 conviction and 0 signals.
It also works with 10,000 signals and 200 convictions.

---

## DO NOT:
- Use brain/AI/robot icons or imagery
- Label anything as "AI-powered" or "AI-generated"
- Make it look like a chatbot
- Use neon glows or bright gradients
- Build a Twitter-like infinite scroll feed
- Hard-code mock data
- Use tables or spreadsheet-like layouts
- Make it look like every other crypto dashboard

## REPORT AFTER BUILD:
- All 6 sections implemented
- Responsive verified (desktop + mobile)
- Day mode implemented
- Data hook connected to live API
- Nav entry added with icon
- Progressive loading working (sections appear as data arrives)
- Empty states graceful
