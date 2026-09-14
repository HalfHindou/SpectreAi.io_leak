# Pre-Landing Review Checklist

> Loaded by `/review` and `/ship`. Two-pass structure: Pass 1 blocks shipping, Pass 2 informs.
> Cite findings as `[file:line]` with one-line problem + suggested fix.
> Skip categories with zero findings - only report what is actually wrong.

---

## Pass 1 - CRITICAL (blocks shipping)

These findings must be resolved before merge. Each gets an interactive Fix / Acknowledge / Skip prompt.

### 1.1 API Key & Secret Safety
- [ ] No API keys, tokens, or secrets in the diff (grep for `sk-`, `key=`, `token=`, `secret`)
- [ ] No server-side env vars exposed to client (only `VITE_*` vars reach the browser)
- [ ] No `.env` file changes committed
- [ ] No hardcoded API endpoints with credentials in query params

### 1.2 Race Conditions & Stale State
- [ ] `useEffect` cleanup returns AbortController or cancellation flag for async operations
- [ ] No stale closure bugs (state referenced inside callbacks without proper deps)
- [ ] Zustand selectors return stable references (no inline object creation in selectors)
- [ ] Concurrent API mutations guarded (no double-submit on buttons, no parallel conflicting writes)
- [ ] WebSocket/interval cleanup on unmount

### 1.3 Data Safety
- [ ] No `dangerouslySetInnerHTML` with user-controlled content
- [ ] No user input interpolated into URLs, query params, or `eval()`
- [ ] External/API URLs (e.g. CoinGecko `trade_url`) validated as `http(s)` before use in `href`/`src`/`window.open` — treat API data as untrusted for URL sinks
- [ ] Error boundaries wrap new async UI sections (Suspense fallbacks for lazy components)
- [ ] No prototype pollution vectors in object spread from external data

### 1.4 Production Routing Gap
- [ ] Every new Express route in `packages/server/` has a corresponding Vercel serverless function in the app's `api/` folder (or is documented as dev-only)
- [ ] New serverless functions handle CORS, error responses, and edge cases independently (no Express middleware available in prod)
- [ ] Vercel `vercel.json` rewrites updated if new API paths added
- [ ] Dev and prod resolve the SAME primary data source for any surface whose rendering was visually tuned against a specific model — a prod handler must not prefer a different upstream (Spectre DB, external API) over the model dev serves; alternates are fallbacks only, tagged via `_source` (liq-heatmap 2026-07-28, bars-tier §A3 class)

### 1.5 Codex API Cost Discipline
> Beta launch drove Codex to 423% of plan. Root cause: handlers relying on HTTP
> `s-maxage` headers, which Vercel SILENTLY IGNORES for cookie-bearing (logged-in)
> requests. Any new Codex path MUST follow these or it bleeds quota at scale.
- [ ] Every new serverless handler that calls Codex wraps it in the durable KV cache-aside (`withKvCache` in trading `api/codex.js`, `cacheAside`/`getJsonWithTTL` in research `api/codex.js`) - NOT just `setCacheHeaders()` (HTTP edge cache is bypassed by auth cookies)
- [ ] Every new client-side Codex poller guards its interval with BOTH `document.hidden` AND `isAppActive()` (from `lib/idleManager.js`) - hidden catches background tabs, idle catches visible-but-abandoned ones
- [ ] No Codex GraphQL **subscription** added to reduce cost - subscriptions bill PER MESSAGE (Codex confirmed). The OVH SSE relay already holds ONE upstream sub per token fanned out to all clients; do not add per-client subs
- [ ] `volume24`/`liquidity` NOT removed from `filterTokens` selections to "save the listPairs lockstep" - they are load-bearing (`isSpamToken`, `calculateTrendingScore`). Reduce the lockstep by firing FEWER `filterTokens` (cache/batch/gate), never by dropping fields
- [ ] Multi-token fetches use ONE `filterTokens(tokens: ["addr:netId", ...])` cross-network call (up to 200), not a loop or a call-per-network

---

## Pass 2 - INFORMATIONAL (note but don't block)

Listed in the review output. No interactive prompts - just report.

### 2.1 Convention Compliance
- [ ] No `.ts`/`.tsx` files in app code (exception: `packages/spectre-ui/`)
- [ ] New components have paired CSS file (`Component.jsx` + `Component.css`)
- [ ] Colors, spacing, typography use CSS custom properties (no hardcoded hex/px)
- [ ] Every dark mode style has a day-mode counterpart — RESEARCH uses `.app.app-day-mode`; TRADING uses `body.theme-light` (`.app.app-day-mode` is NEVER applied in trading = dead rules; obsidian tokens `--text-1`/`--ob-surface-*` don't flip under `theme-light`, so set explicit light colors)
- [ ] Numbers, prices, percentages use `var(--font-mono)`
- [ ] Research app imports use `@/` alias; trading app uses relative paths
- [ ] No emojis, spinners, neon glows, or "AI-looking" elements

### 2.2 Dead Code & Consistency
- [ ] No unused imports, exports, or variables introduced
- [ ] No orphan CSS classes (styled but never referenced in JSX)
- [ ] No imports from known dead modules (ChainVolumeBar, AIAssistant legacy, ResearchPage)

### 2.3 Performance
- [ ] No inline object/array/function literals in JSX props (causes re-renders)
- [ ] Expensive computations wrapped in `useMemo` where appropriate
- [ ] API calls debounced or cached (not firing on every keystroke/render)
- [ ] No N+1 patterns in data fetching (batch where possible)
- [ ] Polled endpoints have failure handling: a failed fetch must not be re-fired at full poll cadence (needs a cooldown/backoff and ideally stale-on-error, see `fetchBaseJson` in `spectreMarketApi.js`) — otherwise a degraded upstream turns every poll tick into visible 502/pending spam

### 2.4 Cross-App Architecture
- [ ] No imports between `apps/research/` and `apps/trading/` (shared code goes in `packages/`)
- [ ] Token registry (`packages/server/lib/token-registry.js`) updated if new tokens/chains added
- [ ] Duplicated logic that exists in both apps flagged for extraction to `packages/`

### 2.5 Console & Debug Artifacts
- [ ] No `console.log` in production code paths (console.error for real errors is fine)
- [ ] No hardcoded `localhost` URLs (use relative `/api` paths)
- [ ] No TODO/FIXME/HACK comments without a corresponding TODOS.md entry

### 2.6 Crypto-Specific
- [ ] Binance API calls include fallback chain (direct -> proxy -> per-symbol)
- [ ] CoinGecko calls respect rate limits (Pro: 500/min, cache appropriately)
- [ ] Token resolution handles both major (CoinGecko) and non-major (Codex) paths
- [ ] Price display uses `formatCurrency()` utility, not manual formatting

---

## Suppressions (do not flag)

- Pre-existing `console.log` in files not touched by this diff
- Chunk size warnings from Vite build (known, tracked separately)
- The "Maximum update depth exceeded" warning in UserDashboard (known Privy hook issue)
- CSS files over 1000 lines (design system pages are large by nature)

---

## Output Format

```
## Pre-Landing Review

### Pass 1 - Critical
[findings or "No critical issues found"]

### Pass 2 - Informational
[findings or "No informational issues"]

### Summary
- Critical: N issues (N fixed, N acknowledged, N skipped)
- Informational: N issues
- Build: PASS/FAIL
- Verdict: SHIP / DO NOT SHIP
```
