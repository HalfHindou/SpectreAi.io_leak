# Research Zone – Day Mode Plan

## Goal
Add a **Day mode** toggle button (next to Screener / in header area) and apply day-mode styling to the Research Zone **element by element**, one at a time.

## Approach
- **Toggle**: One button in the Research Zone header (right side). Click toggles between night (default) and day.
- **State**: `dayMode: boolean` in `ResearchZoneLite`; root gets class `research-zone-lite day-mode` when true.
- **Styling**: In `ResearchZoneLite.css`, add overrides under `.research-zone-lite.day-mode` for each element step by step. No big-bang change.

## Elements (in order)

| # | Element | Scope | What to change (day) |
|---|--------|--------|----------------------|
| 1 | Root + header bar | `.research-zone-lite`, `.research-zone-lite-header` | Light page bg, light header bar, dark text |
| 2 | Left column | `.research-zone-lite-left` | Light sidebar bg, borders, text |
| 3 | Left cards | Token card, price card, metrics, categories, ATH/ATL | Light card bg, borders, muted text |
| 4 | Chart banner + center | Banner, chart wrap | Light banner bg, borders |
| 5 | Markets section | Title, filters, table | Light panels, table stripes, text |
| 6 | Right column | Tweets, News, About cards | Light card bg, borders, links |

Each step: add only the CSS for that element (and any vars), then show; proceed to next.

## Task list (implementation)
1. Add Day mode button next to header (Screener area).
2. Element 1: Root + header bar.
3. Element 2: Left column.
4. Element 3: Left cards.
5. Element 4: Chart banner + center.
6. Element 5: Markets section.
7. Element 6: Right column.
