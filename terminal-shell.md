# Agent — Terminal Shell

## Mission
Build the structural frame of the trading terminal: route component, three-column grid, header, top movers rail, left sidebar. Everything else plugs into this.

## Gate
Gate A. No prerequisites. Runs in parallel with `terminal-data-layer`.

## Files you own (create / edit)
```
src/features/trading-terminal/TradingTerminal.jsx
src/features/trading-terminal/TradingTerminal.module.css
src/features/trading-terminal/index.js
src/features/trading-terminal/components/TerminalHeader.jsx
src/features/trading-terminal/components/TerminalHeader.module.css
src/features/trading-terminal/components/TopMoversRail.jsx
src/features/trading-terminal/components/TopMoversRail.module.css
src/features/trading-terminal/components/TerminalSidebar.jsx
src/features/trading-terminal/components/TerminalSidebar.module.css
```

Plus add a route to whatever router config the repo uses. Match the existing pattern exactly.

## Files you MUST NOT touch
Anything in `hooks/`, `api/`, `components/Chart/`, `components/TransactionsTable.jsx`, `components/TradePanel.jsx`, `components/insights/`, `components/TokenHeaderCard.jsx`. Those are other agents.

## First step (non-negotiable)
```bash
ls src/features/trading-terminal/ 2>/dev/null
```
If the directory exists and any of your files are there, STOP and report. Do not overwrite.

## Read before writing
1. `SPECTRE_TERMINAL_BUILD.md` §4 §5.1 §5.2 §5.3
2. `SPECTRE_DESIGN_LAW.md` (full)
3. `src/index.css` (tokens)
4. `src/icons/spectreIcons.jsx`
5. `src/components/WelcomePage.css` (glass card pattern)

## Deliverable

A working route at `/terminal/:chain/:address` that renders:
- Header with logo, nav pills, search, notifications, settings, wallet chip
- Top movers rail with 8 mock chips
- Left sidebar with all sections from §5.3
- Three placeholder slots (`<div>` with data-slot attributes) for: `main-top`, `main-center`, `main-bottom`, `right-panel`, `tokens-header`

Other agents will fill the placeholders. Do not stub their components — leave empty named slots.

## Mock data
Hardcode a small mock for movers and watchlist counts inline. Other agents will replace with real hooks. Do not import from `hooks/` yet.

```js
const MOCK_MOVERS = [
  { symbol: 'PEPE', change: 18.32, logo: null },
  { symbol: 'WIF', change: 12.09, logo: null },
  { symbol: 'SOL', change: 6.21, logo: null },
  { symbol: 'BONK', change: -4.12, logo: null },
  { symbol: 'FLOKI', change: -6.08, logo: null },
  { symbol: 'JUP', change: 7.43, logo: null },
  { symbol: 'MEW', change: 9.71, logo: null },
  { symbol: 'RAY', change: 5.18, logo: null },
];
```

## Hard rules

- CSS Modules only. Every selector goes through `.module.css`. No inline style for anything that has a token equivalent.
- Use `var(--...)` tokens for every color, radius, spacing, font. Not raw hex except in the gradient definitions from `SPECTRE_DESIGN_LAW.md`.
- `spectreIcons` for every icon. Never an emoji. If `spectreIcons` is missing an icon you need, add a minimal SVG inline in the same file with a TODO comment to migrate.
- Glass card treatment on Header, Rail, Sidebar per the Welcome Widget pattern in the design law.
- Day mode support on every selector. Pattern:
  ```css
  .card { background: var(--bg-surface); }
  :global(.app.app-day-mode) .card { background: #ffffff; }
  ```
- Responsive: grid collapses at 1100px (trade panel becomes bottom drawer slot) and 700px (sidebar becomes off-canvas). Those are placeholder slots — don't implement the drawer behavior, just set up the grid so it collapses.

## Banned patterns (auto-reject)

- Tailwind class strings (`bg-[...]`, `text-white`, etc.)
- Any emoji in JSX
- `import { ... } from 'lucide-react'` or similar
- Purple used anywhere except the active-state pill backgrounds and `Upgrade Now` CTA
- Solid green or solid red for any decorative element
- Spinners (`<Spinner />`, `<CircularProgress />`, etc.)
- Hardcoded dark colors outside design tokens

## Stop condition

Stop when:
1. `/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump` renders the shell with empty slots and mock movers
2. Day mode toggle flips the entire shell
3. At 1100px the right panel slot collapses to a bottom strip (slot can be empty)
4. No emojis in any file you wrote (verify with `rg '[\x{1F300}-\x{1FAFF}]' src/features/trading-terminal/components/`)
5. No Tailwind strings in any file you wrote (verify with `rg 'className=".*\bbg-\[' src/features/trading-terminal/components/`)
6. Lint passes on all files you wrote

Report: a screenshot of the route at `/terminal/sol/<MAGA>` in dark and day mode. Nothing else. Do not start on other agents' work.
