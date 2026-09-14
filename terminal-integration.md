# Agent — Terminal Integration (Gate C)

## Mission
Serial pass. You run alone, in one terminal. Wire every component built in Gate B into `TradingTerminal.jsx`. Verify the MAGA acceptance test. Fix any mismatches between how agents assumed data shapes and what actually flows. Run lint, build, Lighthouse.

## Gate
Gate C. Runs ONLY after all Gate B agents report their stop conditions.

## Files you own (allowed to edit)
```
src/features/trading-terminal/TradingTerminal.jsx
src/features/trading-terminal/TradingTerminal.module.css
docs/TERMINAL_BUILD_QUESTIONS.md
docs/TERMINAL_API_GAPS.md
```

Plus: minimal surgical edits to other agents' files ONLY if there's a concrete integration bug. Every such edit must be a single hunk with a comment `// integration fix:` explaining why.

## First step
```bash
git log --oneline -30
```
Confirm all six Gate A+B agents have committed their work. If any is missing, STOP and request.

Then:
```bash
npm run lint
npm run build
```
Record the baseline. Fix issues as they arise.

## Read before writing
1. `SPECTRE_TERMINAL_BUILD.md` (entire file, especially §9 Acceptance Tests)
2. Every `hooks/use*.js` file (know the exact return shapes)
3. Every component's prop contract

## Wiring `TradingTerminal.jsx`

```jsx
import { useParams } from 'react-router-dom';
import { TerminalHeader } from './components/TerminalHeader';
import { TopMoversRail } from './components/TopMoversRail';
import { TerminalSidebar } from './components/TerminalSidebar';
import { TokenHeaderCard } from './components/TokenHeaderCard';
import { Chart } from './components/Chart';
import { TransactionsTable } from './components/TransactionsTable';
import { TradePanel } from './components/TradePanel';
import { SentimentCard, KeyInsightsCard, OutlookCard } from './components/insights';

import styles from './TradingTerminal.module.css';

export function TradingTerminal() {
  const { chain, address } = useParams();

  if (!chain || !address) {
    return <NotFound />;
  }

  return (
    <div className={styles.root}>
      <TerminalHeader />
      <TopMoversRail chain={chain} />
      <div className={styles.grid}>
        <TerminalSidebar chain={chain} />
        <main className={styles.main}>
          <TokenHeaderCard chain={chain} address={address} />
          <Chart chain={chain} address={address} />
          <TransactionsTable chain={chain} address={address} />
          <div className={styles.insightsRow}>
            <SentimentCard chain={chain} address={address} />
            <KeyInsightsCard chain={chain} address={address} />
            <OutlookCard chain={chain} address={address} />
          </div>
        </main>
        <TradePanel chain={chain} address={address} />
      </div>
    </div>
  );
}
```

Adjust to match actual exports from each agent.

## Acceptance tests — run in order

### 1. Happy path
Open `/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump`.
- All components render.
- Chart loads within 1s of data arrival.
- Transactions stream in.
- No console errors. No console warnings beyond React DevTools / HMR noise.

### 2. Timeframe switch
Click 1m, then 1H, then 1D. Each switch:
- Triggers a fetch
- Updates chart within 400ms
- Does not flicker or jump scroll

### 3. Day mode
Toggle theme. Every surface, border, text color, chart color transitions. No hard-coded dark artifacts.

### 4. Responsive
Resize to 1100px: trade panel becomes drawer slot (or collapses per shell agent's decision).
Resize to 375px: single column. Trade panel accessible via floating CTA.

### 5. Reconnect
Kill the WebSocket in DevTools Network tab. Within 16s:
- Table shows reconnecting indicator
- Reconnect happens
- Subscriptions resume

### 6. Wallet
Click Connect Wallet. Existing modal opens. Post-connect:
- Header shows address + tier badge
- Trade panel CTA label updates
- Quick amounts correctly reflect balance

### 7. Grep checks
```bash
rg -n '[\x{1F300}-\x{1FAFF}]' src/features/trading-terminal/        # must return nothing
rg -n 'className=".*\bbg-\[' src/features/trading-terminal/          # must return nothing
rg -n 'lucide|heroicons|@fortawesome' src/features/trading-terminal/ # must return nothing
rg -n 'axios' src/features/trading-terminal/                         # must return nothing
rg -n 'setInterval.*1000' src/features/trading-terminal/             # audit — only the tx time tick should match
```

### 8. Lint + build
```bash
npm run lint
npm run build
```
Both clean.

### 9. Lighthouse
Run against the terminal route (logged in, MAGA loaded). Targets:
- Performance ≥90
- Accessibility ≥90
- Best Practices ≥90

If performance is below 90, profile with React DevTools. Common culprits per the build spec:
- Transactions table not virtualized correctly
- WebSocket ticks causing `setState` storms
- Chart re-instantiating per render

### 10. A few other meme tokens
Also test with:
- `sol/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` (RAY on Raydium)
- `eth/0x6982508145454Ce325dDbE47a25d4ec3d2311933` (PEPE)
- A fresh pump.fun token (try any recent one from DexScreener)

Known fresh tokens will have no Spectre Brain insight yet — the empty state must kick in cleanly.

## Bug triage rules

When you find a bug:
1. First, reproduce reliably.
2. If it's a data contract mismatch, fix in the component (not the hook). Hooks are the source of truth.
3. If the hook shape is actually wrong per `SPECTRE_TERMINAL_BUILD.md` §6, fix the hook. Log this as a data-layer agent bug in a commit message.
4. If it's a visual bug, fix in CSS. Do not change JSX structure unless necessary.
5. Any fix touching another agent's file MUST have an `// integration fix:` comment.

## Documentation

Update `docs/TERMINAL_BUILD_QUESTIONS.md` with anything that came up during integration. Update `docs/TERMINAL_API_GAPS.md` with any endpoint the data-layer agent flagged plus any new ones you discovered.

Add a brief `README.md` inside `src/features/trading-terminal/`:
- One-paragraph overview
- File structure tree
- How to test locally
- Known limitations (Phase 2 items)

## Stop condition

Stop when all 10 acceptance tests pass and:
- `git status` is clean
- Bundle size for terminal route < 180kb gzipped
- No `TODO` comments remain in committed code except ones explicitly marked `// Phase 2`

Final report:
- Lighthouse scores for terminal route
- Bundle size breakdown (`npm run build -- --analyze` if configured)
- Screenshot: MAGA full page, dark mode
- Screenshot: MAGA full page, day mode
- Screenshot: mobile view (375px)
- List of every file changed in the integration pass
