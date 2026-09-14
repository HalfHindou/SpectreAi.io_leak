# SPECTRE TERMINAL — Plan of Record (consolidated)

> Merges `SPECTRE_TRADE_TERMINAL_BUILD.md` (Claude Code, path-aligned to repo conventions)
> with `SPECTRE_TERMINAL_BUILD.md` (Claude web, gated-agent execution model).
> This is the file the build follows.

## Framing
Side utility at `/terminal/:chain?/:address?` in `apps/research`. Self-contained. Zero edits to existing pages other than (1) registering the route in `App.jsx`, (2) adding one nav entry under `Trading` in `navigation-sidebar.jsx`, (3) adding one key to `pageRoutes.js` + i18n locales.

Default route `/terminal` redirects to MAGA on Solana for the smoke test:
`/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump`

## Adopted from Claude web
- Gate A/B/C execution model (agents run in parallel, check existence first).
- `/terminal/:chain/:address` URL shape with short chain slugs (`sol | eth | base | arb | bnb`).
- Mock-data first, real API second. Log gaps to `docs/TERMINAL_API_GAPS.md`.
- Codex 402 fallback pathway (real endpoint optional; mocks ship by default).
- WebSocket manager with ref-counted multiplex + rAF coalescing for live ticks. (Deferred to v1.1 — polling in v1.)
- rAF-coalesced updates on burst trade ticks (no setState storms).
- 10-item acceptance-test checklist ending with the MAGA route.
- Purple `--accent` reserved for the single primary CTA.

## Rejected from Claude web (violates Spectre conventions)
- **CSS Modules.** Plain CSS with `trm-` prefixed classes, paired `.css` / `.day-mode.css` / `.mobile.css` files per `.claude/rules/coding-standards.md §F`.
- **`src/features/trading-terminal/` directory.** Use `src/pages/terminal/` per folder-per-page convention.
- **SWR.** Not in repo deps. Use native `fetch` + `useEffect` cleanup with `cancelled` flag (Spectre's established pattern).
- **`react-window` dependency.** v1 caps trade rows at 200 and uses plain scroll. Upgrade to virtualized only if Lighthouse says so.
- **`spectre-data-api` external base URL.** Route through existing `/api/codex` proxy (already wrapped by `services/codexApi.js`).
- **Lightweight-charts v4.** Research app already has v5. Use v5.

## Tech stack
| Concern | Choice |
|---|---|
| Framework | React 18 + Vite 5 (existing) |
| Styling | Plain CSS with `trm-` prefix, paired `.css` / `.day-mode.css` / `.mobile.css` |
| Chart (candles) | `lightweight-charts` v5 (already installed) |
| Icons | `spectreIcons` from `src/icons/`; local inline SVG only when absent |
| Fonts | `var(--font-display)` headings, `var(--font-mono)` numbers |
| State | `useState` + `useReducer` local. No new store for v1. |
| Routing | existing react-router-dom v7 |
| Data fetch | native `fetch` + `AbortController` via existing `services/codexApi.js` |
| Live data | 3s polling (v1). WebSocket deferred. |

## File layout

```
apps/research/src/pages/terminal/
├── index.jsx                       # thin wrapper: reads URL, resolves chain/address, passes to <Terminal />
├── components/
│   ├── terminal.jsx                # top-level layout
│   ├── terminal.css                # dark
│   ├── terminal.day-mode.css
│   ├── terminal.mobile.css
│   ├── movers-rail.jsx + .css      # top horizontal ticker
│   ├── token-header.jsx + .css     # token identity + 5 stat tiles
│   ├── chart-panel.jsx + .css      # candles + volume + toolbar + drawing rail
│   ├── transactions-panel.jsx + .css   # tabs + table
│   ├── ticket-panel.jsx + .css     # Buy/Sell + CTA
│   ├── right-rail.jsx + .css       # watchlist + trending cards
│   ├── insights-card.jsx + .css    # "Spectre AI Insights" compact card
│   ├── footer-strip.jsx + .css     # sentiment + fear/greed + dominance
│   ├── use-terminal-data.js        # all data hooks (token, bars, trades, movers, insights)
│   ├── terminal-constants.js       # NETWORK_SLUG_MAP, TIMEFRAMES, DEFAULT_TOKEN
│   ├── terminal-mocks.js           # fallback fixtures
│   └── terminal-icons.jsx          # local SVG glyphs absent from spectreIcons
```

## Routing
- Add route in `apps/research/src/App.jsx` under `AppShell` (NOT `PageShell` — terminal owns its own layout, like `/token`).
- `/terminal` → Navigate replace to default MAGA route.
- `/terminal/:chain/:address` → `<TerminalPage />` wrapped in `<PageErrorBoundary>`.
- Add `PAGE_PATHS.terminal = '/terminal'` to `src/constants/pageRoutes.js`.

## Nav integration
- In `src/components/navigation-sidebar.jsx`, under the `trading` category (line ~413–419), insert at position 0:
  ```js
  { id: 'terminal', label: 'Terminal', badge: 'NEW' },
  ```
- Add icon case for `'terminal'` in the icon switch (new `spectreIcons.Terminal` or a chart/candle glyph inline).
- Add translation key `nav.terminal = 'Terminal'` to all 8 locale files.

## Data strategy (mock-first)
Every hook has two paths:
1. **Primary:** call `services/codexApi.js` → `/api/codex` proxy.
2. **Fallback:** on HTTP 402 / 5xx / timeout, return a realistic mock from `terminal-mocks.js` with a `__mock: true` flag.

Components don't need to know which path fired. If `data.__mock === true`, a tiny "demo data" pill appears at the top of the page (design allows it; it's not failure-mode UI, it's transparency).

## Acceptance tests (smoke)
1. `/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump` renders shell in <200ms skeleton.
2. Token header populates (symbol, image, 5 stats) within 2s OR falls back to mock.
3. Chart renders candles (lightweight-charts v5), timeframe switch works.
4. Transactions panel streams rows (polled) with buy/sell flash.
5. Ticket accepts input, computes receive-estimate, CTA enabled on valid input.
6. Right rail watchlist + trending cards render.
7. Insights card renders 4 signal rows (mocked).
8. Footer strip renders sentiment + fear/greed + mcap/vol + dominance (mocked).
9. Day mode toggle flips every surface.
10. Mobile (390px): single column, ticket becomes bottom-sheet CTA.
11. `npm run build:research` clean.
12. No console errors on mount.

## Anti-slop guardrails (reject on review)
- Tailwind class strings
- Emojis in DOM
- `lucide-react` in `apps/research`
- TypeScript in `.jsx` files
- CSS Modules files
- Purple outside the primary CTA
- Spinners / "Loading..." text
- Hardcoded hex colors (use tokens)
- Raw `localStorage` access (use Zustand)
- Forking `TradingViewAdvanced` (not used here — we use lightweight-charts directly, which is simpler)

---
**This plan is the build's source of truth.** If a detail isn't here, fall back to `.claude/rules/design-system.md` and `.claude/rules/coding-standards.md`.
