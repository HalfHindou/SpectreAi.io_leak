# Agent — Terminal Insights

## Mission
Three-card row below the transactions table: Sentiment gauge, Key Insights list, AI Outlook. These are where Spectre's intelligence becomes visible to the user. The copy and visual treatment must feel authoritative, not "AI-generated".

## Gate
Gate B. Prerequisites:
- `terminal-shell` complete
- `terminal-data-layer` complete (`useTokenInsights`)

## Files you own
```
src/features/trading-terminal/components/insights/SentimentCard.jsx
src/features/trading-terminal/components/insights/KeyInsightsCard.jsx
src/features/trading-terminal/components/insights/OutlookCard.jsx
src/features/trading-terminal/components/insights/insights.module.css
src/features/trading-terminal/components/insights/index.js
```

## Files you MUST NOT touch
Any hook. Any other component.

## First step
```bash
ls src/features/trading-terminal/components/insights 2>/dev/null
```

## Read before writing
1. `SPECTRE_TERMINAL_BUILD.md` §5.8
2. `SPECTRE_DESIGN_LAW.md` §Creative Agent (gauge/visual suggestions)
3. Existing Brain-related components in the repo — reuse visual language if there's precedent
4. The `useTokenInsights` return shape in `hooks/useTokenInsights.js`

## Shared card shell

All three cards share the glass card treatment: `--bg-surface`, `--radius-xl` (24px), 20px padding, 1px border `--border-default`, inset highlight on the top edge.

`insights.module.css` should expose `.card` as the shared base, then each component can extend with its own module or local class.

## Deliverable 1 — `SentimentCard`

### Layout

```
┌──────────────────────────────────────┐
│ Spectre AI Insights    [beta]        │
│                                       │
│   ╭─╮  GMGN market sentiment is       │
│   │54│  neutral.                      │
│   ╰─╯  Volume is up 18.7% in the     │
│        last 24h with balanced         │
│        buy/sell pressure.             │
│                                       │
│  ┌──────┬───────────┬──────┐        │
│  │Volume│ Liquidity │Holders│        │
│  │+18.7%│ Stable    │+2.1%  │        │
│  └──────┴───────────┴──────┘        │
└──────────────────────────────────────┘
```

### Gauge spec

80px × 80px circular SVG gauge.
- Track: `stroke="rgba(255,255,255,0.08)"`, 4px width
- Fill: arc from 0 to `(sentiment / 100) * circumference`, stroke gradient from `--bear` (0) → `--text-muted` (50) → `--bull` (100)
- Center number: `var(--font-mono)`, 18px, sentiment value
- Below number (outside gauge): small label, `/100`, `--text-muted`

Define the gradient once with 3 stops and let the fill interpolate by dash length. Do not use 3 different gradients based on score.

```jsx
<svg viewBox="0 0 80 80" className={s.gauge}>
  <circle cx="40" cy="40" r="34" stroke="rgba(255,255,255,0.08)" strokeWidth="4" fill="none" />
  <circle
    cx="40" cy="40" r="34"
    stroke="url(#sentimentGradient)"
    strokeWidth="4" fill="none"
    strokeDasharray={`${(sentiment/100) * (2*Math.PI*34)} ${2*Math.PI*34}`}
    strokeLinecap="round"
    transform="rotate(-90 40 40)"
  />
  <defs>
    <linearGradient id="sentimentGradient" x1="0" x2="1">
      <stop offset="0%" stopColor="var(--bear)" />
      <stop offset="50%" stopColor="var(--text-muted)" />
      <stop offset="100%" stopColor="var(--bull)" />
    </linearGradient>
  </defs>
</svg>
```

### Headline

One short line, sentence case: `{SYMBOL} market sentiment is {bullish|bearish|neutral}.` Followed by one supporting line with a concrete data point. Both come from `data.sentimentSummary` and `data.sentimentDetail`. If detail missing, show only the headline.

### Stat tiles

3 equal-width tiles: Volume / Liquidity / Holders. Each shows the value returned from the API. Sign-aware coloring: positive green, negative red, stable neutral. Format percentages with `formatNumber`.

## Deliverable 2 — `KeyInsightsCard`

### Layout

Title `Key Insights` (no badge). Below: 3-5 rows of insights from `data.signals`.

Each row:
- 10px colored dot on the left (semantic)
- Title line in `--text-primary`, weight 500
- Detail line below in `--text-secondary`, smaller, max 2 lines

Dot colors:
- `--bull` for positive signals (whale accumulation, healthy liquidity, low slippage, social momentum up)
- `--bear` for risk signals (concentrated holders, low liquidity, large sell pressure)
- `--accent` for neutral/informational signals (new listing, new pool, contract age milestone)

Signal type comes from `data.signals[i].type ∈ 'positive' | 'risk' | 'info'`.

If fewer than 3 signals, render what exists. If zero, show the empty state:
```
<EmptyState label="Scanning for signals…" />
```

(Use the EmptyState component from elsewhere in the app if it exists; otherwise inline glass card with `--text-muted` label + soft pulsing dot.)

## Deliverable 3 — `OutlookCard`

### Layout

```
┌───────────────────────────────────┐
│ AI Outlook        Short-term      │
│                                    │
│ Bullish                            │
│                                    │
│  ▁▂▃▄▅▆▅▃  (8 mini bars)          │
│                                    │
│ Confidence            72%          │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━       │
│                                    │
│ AI analysis is not financial       │
│ advice.                            │
└───────────────────────────────────┘
```

### Verdict

`Bullish | Bearish | Neutral`, large (24px), `var(--font-display)`, colored by `--bull` / `--bear` / `--text-secondary`.

### Mini bars

8 vertical bars, height derived from `data.recentDeltas` (array of 8 percent values). Render as `<div>` with `height: {computed}px` inside a flex container aligned to bottom. Positive deltas use `--bull` at 0.6 opacity, negative use `--bear` at 0.6. Animate height from 0 to target over 400ms on mount.

### Confidence

Label + percent on one line. Bar below, full width. Gradient fill `--bear → --accent → --bull`, width = `{confidence}%`. Background track = `rgba(255,255,255,0.08)`.

### Disclaimer

Small, `--text-muted`, 11px, literal text: `AI analysis is not financial advice.`

## Loading states

All three cards show skeleton shimmer. Shape-match the final layout so the transition is imperceptible. Minimum display time 200ms.

## Error states

Single line, `--text-muted`: `"Insights temporarily unavailable"`. No stack traces. No error icons.

## Empty states (insufficient data)

If the API returns `{ insufficient: true }` for a new token with no history yet:
- SentimentCard shows `"Too early for sentiment analysis"`
- KeyInsightsCard shows `"Watching this token closely"`
- OutlookCard shows `"Outlook forming..."` with an animated soft pulse

## Hard rules

- Gauge colors, bar colors, confidence gradient all reference CSS tokens, not hex.
- Never say "Spectre AI predicts..." or "The AI thinks..." — insights are presented as market facts, not model opinions. The only exception is the card title `AI Outlook` and the `AI analysis is not financial advice.` disclaimer.
- No emojis. No sparkle icons. No "magic" imagery.
- Day mode: each card honors `.app.app-day-mode` with a white background, `rgba(0,0,0,0.04)` border, muted shadow.

## Stop condition

Stop when:
1. All three cards render for MAGA with real data from `useTokenInsights`
2. Gauge animates fill on mount
3. Mini bars animate height on mount
4. Confidence bar fills smoothly
5. Loading, error, and empty states all work
6. Day mode correct
7. Lint passes

Report: screenshots of the three cards in normal, loading, and empty states, dark + day modes.
