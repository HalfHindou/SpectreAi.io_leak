# Proven Patterns
Checked before building new UI. Each entry has recipe, source files, and approval date.

## Mobile Rendering Guard Pattern (2026-03-18)
**Rule**: NEVER rely on CSS alone to hide desktop sections on mobile. Always use JSX guards.
```jsx
// CORRECT — JSX guard prevents rendering
{isMobile && (<MobileComponent />)}
{!isMobile && (<DesktopComponent />)}

// WRONG — CSS hide is fragile, inline styles can override
<DesktopComponent style={condition ? {display:'none'} : {}} />
```
**Learned from**: Duplicate Command Center bug — desktop sidebar-row rendered on mobile because inline style logic produced `{}` on mobile, and CSS `display:none !important` in media query was unreliable.
**Source**: `welcome-page.jsx` line 1260

## UI Patterns

### Glass Card with Hover Lift
- **Recipe**: `background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))`, `backdrop-filter: blur(20px)`, `border: 1px solid var(--glass-border)`, hover: `translateY(-1px)` + border brighten + shadow upgrade
- **Source**: `apps/research/src/index.css` (glass-card class), design-system.md Section D
- **Approved**: 2026-03-01

### Ambient Blur Orbs (Full-Viewport Background)
- **Recipe**: Wrapper div with `position: fixed; inset: 0; pointer-events: none; z-index: 0`. 2-3 child divs with `border-radius: 50%; filter: blur(140px); opacity: 0.035; background: rgba(255,255,255,0.6-0.8)`. Animate with 30s ease-in-out `translate + scale`. Content container gets `position: relative; z-index: 1`.
- **Source**: `apps/trading/src/components/UserDashboard/UserDashboard.css` (.ud-ambient, .ud-orb-*), `apps/research/src/pages/user-dashboard/user-dashboard.css`
- **Approved**: 2026-03-15

### Skeleton Shimmer Loading
- **Recipe**: `background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)`, `background-size: 200% 100%`, `animation: shimmer 2s infinite`. Match target shape. Stagger with `.stagger-1` through `.stagger-5`.
- **Source**: design-system.md Section E
- **Approved**: 2026-03-01

### Wall Street Terminal × Apple Panel (Trading App)
- **Container recipe**:
  ```css
  background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 40%), rgba(9,9,11,0.95);
  border: 1px solid rgba(255,255,255,0.05);
  border-top-color: rgba(255,255,255,0.07);
  border-bottom-color: rgba(255,255,255,0.03);
  border-radius: 12px;
  backdrop-filter: blur(20px) saturate(120%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.15);
  ```
- **Grid cells** (no nested borders): `background: transparent; border: none; border-radius: 0`. Grid separators via `nth-child` borders at `rgba(255,255,255,0.04)`. Corner radius on outer cells only (container radius - 1px).
- **Hover**: flat `rgba(255,255,255,0.03)` fill, no translateY, no shadow changes.
- **Labels**: `font-family: var(--font-mono); font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(245,245,247,0.35)`.
- **Values**: `font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: #f5f5f7`.
- **Tab items**: transparent bg, `0.4` opacity, `6px` radius. Active: `rgba(255,255,255,0.06)` + `inset 0 0 0 1px rgba(255,255,255,0.06)`.
- **Toggle handles**: 14×48px, `rgba(255,255,255,0.04)` bg, `0.25` opacity icon, no shadows, no pseudo-elements, no hover movement.
- **Dropdowns**: same container recipe but `rgba(9,9,11,0.97)`, rendered in normal flow (not absolute), never cover trigger button.
- **Token color boost**: `generateTokenBackgroundColors` boosts dark colors (luminance < 100) so they're visible at 8% opacity on dark backgrounds.
- **Applied to**: `.market-stats`, `.trading-compact`, `.token-dropdown`, `.volume-dropdown`, `.liquidity-dropdown`, `.data-tabs` in trading app.
- **Source**: `apps/trading/src/components/RightPanel.css`, `apps/trading/src/components/DataTabs.css`, `apps/trading/src/App.css`
- **Approved**: 2026-04-07

## Data Patterns

### Triple Fallback API Call (Binance)
- **Recipe**: Try direct API -> allorigins.win CORS proxy -> per-symbol individual fetches. Circuit breaker pattern on server.
- **Source**: `apps/research/api/binance-ticker.js`, `packages/server/index.js`
- **Approved**: 2026-03-01

### Zustand with Server Sync (Debounced Push)
- **Recipe**: Zustand store with `persist` middleware (localStorage). `useProfileSync` hook watches store changes, debounce-pushes to `/api/user/profile`. On mount, pulls from server and merges (server wins on conflict).
- **Source**: `apps/research/src/store/useSettingsStore.js`, `apps/research/src/hooks/useProfileSync.js`
- **Approved**: 2026-03-12

### Profile Sync Hook Pattern
- **Recipe**: Custom hook with `useEffect` that watches Zustand store slice. Debounced POST to server. Pull on mount with merge logic. Used identically in both apps.
- **Source**: `apps/research/src/hooks/useProfileSync.js`, `apps/trading/src/hooks/useProfileSync.js`
- **Approved**: 2026-03-12

## Mobile Patterns

> Full reference: `.claude/rules/mobile-design-system.md`

### Mobile Glass Card (reduced blur)
- **Recipe**: `background: rgba(255,255,255,0.02)`, `backdrop-filter: var(--m-blur)` (8px), `border: 1px solid rgba(255,255,255,0.04)`, `border-radius: var(--m-card-radius)` (10px). No hover lift on mobile (touch, not mouse).
- **Source**: `mobile-brief-card.css`, `mobile-quick-stats.css`, `mobile-watchlist-strip.css`
- **Approved**: 2026-03-17

### Horizontal Scroll Strip with Snap
- **Recipe**: `display: flex; gap: var(--m-sm); overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; padding: 0 var(--m-content-pad)`. Items get `scroll-snap-align: start; flex-shrink: 0`.
- **Source**: `mobile-watchlist-strip.css` (`.mws-scroll`)
- **Approved**: 2026-03-17

### Token Row with Expand + Inline Sparkline
- **Recipe**: 64px row, 36px logo circle with brand color fallback. Inline SVG sparkline subsampled to ~20 points. `React.memo` with custom comparator. Tap-to-expand reveals stats + actions.
- **Source**: `mobile-token-row.jsx`
- **Approved**: 2026-03-17

### Swipe Navigation Hook
- **Recipe**: `useSwipeNavigation({ items, activeIndex, onIndexChange, containerRef })`. Returns `{ swipeOffset, isSwiping, handlers }`. Apply `transform: translateX(swipeOffset)` + conditional transition. 15px dead zone, 50px threshold, rubber-band at edges.
- **Source**: `src/hooks/useSwipeNavigation.js`
- **Approved**: 2026-03-17

### 2x2 Stat Grid
- **Recipe**: `display: grid; grid-template-columns: 1fr 1fr; gap: var(--m-sm)`. Each cell is a mobile glass card with label (`.caption`) + value (mono font) + optional change badge.
- **Source**: `mobile-quick-stats.css`
- **Approved**: 2026-03-17

### Inline SVG Icons (mobile-only components)
- **Recipe**: Define icons as tiny React components with `viewBox="0 0 24 24"`, `width="14"`, `height="14"`, stroke-based. Avoids importing `spectreIcons` (50+ icons).
- **Source**: `mobile-content-tabs.jsx`, `mobile-brief-card.jsx`, `mobile-header.jsx`
- **Approved**: 2026-03-17

### Cinematic Mobile Page Pattern (2026-04-01)
- **Recipe** - 7-layer cinematic system for premium mobile pages:
  1. **Foundation tokens** in `mobile-2026.css`: spring easings (`--spring-snappy/bouncy/gentle` via CSS `linear()`), 5-tier elevation (`--elevation-1..5`), glass surface (`--glass-cinematic`)
  2. **Atmosphere** in page's `.mobile.css`: 2 ambient orbs (fixed pseudo-elements, radial-gradient warm-white, 60-80px blur), film-grain SVG noise (1.8% opacity), cinematic vignette (radial-gradient edge darkening)
  3. **Elevated glass cards**: `--glass-cinematic` gradient + `--elevation-2/3` shadow + `backdrop-filter: blur(16px) saturate(140%)` + 0.5px border
  4. **Top-edge light** (Apple signature): `::before` with `linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)` at 1px height on top edge
  5. **Spring tap feedback**: `:active { transform: scale(0.955..0.965); }` with `transition: transform 0.4s var(--spring-snappy)`
  6. **Editorial section headers**: `font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted)`
  7. **Day mode + reduced-motion**: every cinematic addition needs `.day-mode` counterpart and `@media (prefers-reduced-motion: reduce)` guard
- **Source**: `welcome-page.mobile.css`, `mobile-quick-stats.css`, `mobile-watchlist-strip.css`, `mobile-content-tabs.css`, `mobile-highlights-tabs.css`, `mobile-discovery-section.css`, `mobile-brief-card.css`, `mobile-token-row.css`
- **Approved**: 2026-04-01

## Failure-Signal Discipline (2026-05-26)
**Rule**: A failure sentinel must NEVER be a legal value in the same domain. Failure = `null` / `undefined` / `{ ok: false }`.

```js
// WRONG — '#D4D4D8' is both "extraction failed" AND a real silver brand colour
async function extractColor(url) {
  try {
    const result = await sample(url)
    return result?.hex || '#D4D4D8'  // caller can't tell failure from silver
  } catch { return '#D4D4D8' }
}

// CORRECT — null is unambiguous, callers decide how to fall back
async function extractColor(url) {
  try {
    const result = await sample(url)
    return result?.hex || null
  } catch { return null }
}
```

**Learned from**: Token-color extraction. `'#D4D4D8'` (warm silver) was the failure value AND the curated colour for SPECTRE/USDC. Every uncurated token whose extraction failed converged to silver, looking like "stale cache". Fixed by returning `null` from every failure path and dropping the now-vestigial `=== '#D4D4D8'` sentinel guards from all 4 callers.

**Source**: `packages/server/index.js` `/api/token-color` + `extractDominantColor`, `apps/trading/src/utils/tokenColors.js` `fetchTokenColorFromServer`.
**Approved**: 2026-05-26

## 2D-Grid Sampling for Image Extraction (2026-05-26)
**Rule**: When sampling a raster image, ALWAYS walk a 2D grid. Never use a linear stride over the flat pixel buffer — any stride that's a multiple of `width` collapses to a single column.

```js
// WRONG — for a 256×256 image, totalPixels/256 == width → every sample lands in column 0
const step = Math.max(1, Math.floor(totalPixels / 256))
for (let i = 0; i < totalPixels; i += step) {
  const offset = i * channels
  // ... sample
}

// CORRECT — 2D grid covers the full image
const gridStep = Math.max(1, Math.round(Math.sqrt(totalPixels / 256)))
for (let y = 0; y < height; y += gridStep) {
  for (let x = 0; x < width; x += gridStep) {
    const offset = (y * width + x) * channels
    // ... sample
  }
}
```

**Learned from**: PAAL logo extraction returned null because every 1D-stride sample landed in column 0 (transparent background of a centred logo). 2D grid found the centred purple pixels and extracted `#a600ff`.

**Source**: `packages/server/index.js` `extractDominantColor` lines 1110-1156.
**Approved**: 2026-05-26

## Boost-Dont-Reject for Vibrant Dark Colours (2026-05-26)
**Rule**: When normalising an extracted brand colour, BOOST dark-but-vibrant results into a usable luminance band. Reject only when chroma is too low (true grey, no hue to preserve).

```js
// WRONG — rejects pure purple (lum=22), navy (lum=15), deep red (lum=27), forest green (lum=30)
if (finalLum < 45) return null

// CORRECT — preserve hue, lift lightness only
if (finalLum < 80 && finalSat >= 0.1) {
  const boost = 80 / Math.max(finalLum, 1)
  r = Math.min(255, Math.round(r * boost))
  g = Math.min(255, Math.round(g * boost))
  b = Math.min(255, Math.round(b * boost))
}
// Reject ONLY desaturated greys (no hue to preserve)
if (finalSat < 0.1 && finalLum < 180) return null
```

**Learned from**: PAAL purple `(75, 0, 121)` was extracted correctly but rejected as "too dark" by the `lum<45` check. Boosted to `(166, 0, 255)` = `#a600ff` matches the actual brand. Same fix applies to navy / red / deep green logos.

**Source**: `packages/server/index.js` `extractDominantColor` end-of-function; mirrors client behaviour in `apps/trading/src/utils/tokenColors.js` `extractColorFromImage`.
**Approved**: 2026-05-26

## Inflight Promise Audit (2026-05-26)
**Rule**: Whenever you stash an in-flight Promise outside a try/finally, audit EVERY early-return inside the try for `resolve(data)` calls. Missing one orphans the Promise → all concurrent callers for that key hang forever.

```js
// WRONG — early return inside try forgets to settle the promise
const inflightPromise = new Promise((res, rej) => { _resolve = res; _reject = rej })
_inflight.set(key, inflightPromise)
try {
  if (notFound) {
    return res.json({ results: [] })  // ← _resolve never called → orphan
  }
  // ... happy path ...
  _resolve(data)
  return res.json(data)
} catch (e) {
  _reject(e)
}

// CORRECT — every early return settles the promise (or use try/finally)
try {
  if (notFound) {
    const emptyData = { results: [] }
    _cache.set(key, emptyData)
    _resolve(emptyData)
    return res.json(emptyData)
  }
  // ...
}
```

**Better still**: wrap in try/finally with a single `_resolve` at the end. Avoids the audit burden.

**Learned from**: `/api/tokens/search` had two early-return paths (L5129 "token not found", L5250 "found with market data") that bypassed `_resolveInflight`. Subsequent calls for the same query hung indefinitely on the orphaned Promise, exceeding the cache TTL.

**Source**: `packages/server/index.js` `/api/tokens/search` route.
**Approved**: 2026-05-26

## Address-Strict Deep-Link Resolution (2026-05-26)
**Rule**: NEVER trust `results[0]` from a fuzzy search when an exact lookup is needed. Validate the returned identifier matches the requested one.

```js
// WRONG — Codex search is fuzzy; for a low-cap address it can rank UNI (top liquidity) as result[0]
const searchResult = await searchTokens(address)
const r = searchResult?.results?.[0]
if (r) selectToken(r)

// CORRECT — find the exact-address match, fall through to address-strict lookup otherwise
const wantedAddr = address.toLowerCase()
const exact = (searchResult?.results || []).find(r =>
  (r.token?.address || r.address || '').toLowerCase() === wantedAddr
)
if (exact) {
  selectToken(exact)
  return
}
// Fallback: exact-by-address Codex query
const details = await getDetailedTokenInfo(address, networkId)
if (details && details.address?.toLowerCase() === wantedAddr) {
  selectToken(details)
}
```

**Learned from**: Hard-refresh of `/#token/<PAAL_ADDR>` silently loaded UNI because `searchTokens(PAAL_ADDR)` returned UNI as `results[0]` (Codex's fuzzy ranking favours top-volume tokens for any non-indexed address).

**Source**: `apps/trading/src/App.jsx` `resolveToken()` line 634-695.
**Approved**: 2026-05-26

## Cold-Load Client Timeouts (2026-05-26)
**Rule**: Client-side `fetch` timeouts on `/api/*` calls should account for browser request queueing on cold page loads, not just server response time. Minimum 5s for non-critical extraction calls.

```js
// WRONG — 2s budget gets eaten by browser queueing on cold load
const res = await fetch('/api/token-color?url=...', {
  signal: AbortSignal.timeout(2000)  // competes with ~30 concurrent requests
})

// CORRECT — match server upstream timeout (5s for PNG fetch in our case)
const res = await fetch('/api/token-color?url=...', {
  signal: AbortSignal.timeout(5000)
})
```

**Testing**: simulate cold-load with DevTools → Network throttling "Fast 3G" or "Slow 4G". 2s budgets routinely fail there even when the server responds in 50ms.

**Learned from**: `fetchTokenColorFromServer` had a 2s timeout that silently failed on cold loads (Codex search + details + bars + dossier + img-proxy all racing). useAccentTheme priority 4 fell back to hash hue. Server itself responded in 1.66ms once it got the request — the timeout was purely a browser-queue issue.

**Source**: `apps/trading/src/utils/tokenColors.js` `fetchTokenColorFromServer`.
**Approved**: 2026-05-26

## Deep-Link State Initialiser (Exhaust Local Sources First) (2026-05-26)
**Rule**: When initialising state from a URL deep-link, exhaust ALL available local sources (localStorage cache by address, URL params, sessionStorage) before falling back to a placeholder. Placeholders gate downstream effects that need real data (like logo URLs).

```js
// WRONG — always falls to placeholder when localStorage cache has a different token
const [token] = useState(() => {
  if (deepLinkAddr) {
    return { ...defaultToken, address: deepLinkAddr, symbol: '...', logo: undefined }
  }
  // localStorage fallback only when no deep-link
})

// CORRECT — try localStorage even with a deep-link; only fall to placeholder if no match
const [token] = useState(() => {
  if (deepLinkAddr) {
    try {
      const saved = JSON.parse(localStorage.getItem('spectre-selected-token'))
      if (saved?.address?.toLowerCase() === deepLinkAddr.toLowerCase()) {
        return saved  // full data including logo — hooks can run immediately
      }
    } catch { /* corrupt — fall through */ }
    return { ...defaultToken, address: deepLinkAddr, symbol: '...', logo: undefined }
  }
  // ... existing localStorage path for non-deep-link case
})
```

**Why it matters**: useAccentTheme priority 4 gates on `if (token.logo)`. A placeholder with no logo means async colour upgrade NEVER runs — the page is stuck on the hash hue until the async resolver eventually populates the token (which can take seconds or fail silently).

**Learned from**: Hard-refresh of a previously-visited deep-link should boot with the correct accent on first paint. Without the localStorage cache hit, every page reload paid the cost of waiting on the async resolver.

**Source**: `apps/trading/src/App.jsx` token `useState` initialiser lines 443-504.
**Approved**: 2026-05-26

## Trading appearance + chart-style customization (approved "all good")

**Pattern**: User customization ships as two INDEPENDENT channels: platform appearance (skins = derived tone+accent bundles, right-docked live sheet, transparent overlay) and chart style (own toolbar control: bg/candles/line/axis/grid). Skins never touch the chart. Custom pickers use one visual language (conic wheel + pipette); brightness = stepper buttons + visible slider, never hidden drag gestures; sections appear contextually (Candles vs Line follows the active chart type, TV = candles only).

**Learned from**: Three correction rounds: white-mix brightness read as "cartoon" (tone ladders + multiplicative depth instead); a dimming modal hid the live changes (transparent right sheet instead); chart auto-following skins was rejected (dedicated ChartStyleControl instead).

**Source**: `apps/trading/src/lib/{bgTone,accent,skins,chartStyle}.js`, `components/{ToneControl,AppearanceStudio,ChartStyleControl}/`
**Approved**: 2026-07-03

## Spectre Cosmos (2026-07-09) — approved "I FUCKING LOVE IT"
- Marquee viz surfaces: delete-and-rebuild beat incremental patching (old 2D constellation → three.js universe in `pages/bubbles/components/cosmos/`).
- Winning formula: data-as-physics metaphor (orbit=performance, size=mcap, glow=direction) + inertial camera + morphing layout views + cinematic mode. No purple, glass HUD, logos as worlds.
- Keep three.js off boot: lazy chunk + check-critical-path; reuse the x-dash logo atlas; strip `?query` from CG image URLs for CORS-clean WebGL textures.

## Metered-upstream containment (2026-08-13, PRs #1423/#1424 — Codex incident)

**Pattern**: Three composable guards for any code path that hits a metered upstream:
1. **Cache-aside with transient/miss distinction** — negative-cache ONLY definitive 4xx (400/404); 5xx/429/401/timeout return `undefined` and are never cached (caching them blanks live data platform-wide for the negative TTL). Validate cache-entry shape before trusting it (a JSON string or `{}` from KV must read as a miss, not spread into zeros).
2. **Budget passed INTO the helper** — an absolute deadline that stops ISSUING calls, never a `Promise.race` at the call site (race caps latency; the requests already left and were already billed).
3. **Sustained-interest gate on fire-and-forget warms** whose receiver creates permanent state: first sighting records only; act on >view-window persistence or 24h recurrence; per-key resend TTL; per-instance daily cap; degraded (KV-down) mode does LESS, never more; every ceiling env-tunable.

**Learned from**: one chart view was registering tokens permanently on the box (`/v1/candles` auto-register + Codex-fallback backfill); search fanned 50 uncached scanner calls per query; my own first fix negative-cached 503s.
**Source**: `apps/{trading,research}/api/_lib/spectre-data.js` (`_cachedProbe`, `deadline`), `apps/{trading,research}/api/_lib/bars-router.js` (`warmHetznerStore`/`_gatedWarm`, `HZ_WARM_*`)

## Trading tape identity + money colour (2026-09-11) — approved "I love it!"
- Money values (`$` size, PnL) and BUY/SELL labels: `--up-text #46B87D` / `--down-text #DE5759` (GMGN's text pair, read off their CSS variables, not the screenshot), Geist (`--font-num-chip`) 14px weight **500**, tabular digits. A pale mint at 600 read as a dull tint next to white digits; heavier weight made the green muddy; warm-white `$` was rejected - the value must be green/red.
- Reference the competitor's actual tokens: open their page, read `--color-*` / computed styles, match exactly. The "font" ask turned out to be a weight + hue difference (same Geist family).
- Row anatomy that landed after ~8 iterations: round wallet pfp (deterministic sigil) FIRST in the row; platform tile = real logo, squared 4px, LEFT of the maker address; tile + badge in fixed-width slots so addresses share one x; position bar starts under the address; size pill to the RIGHT of the value, never under it as a thin line ("similar to maker line" was rejected) and never with the value laid on it.
- Iterating on a live tape: measure alignment with `getBoundingClientRect` sets (distinct x values per column must collapse to one), then a zoomed clone-probe screenshot; the pane is `document.hidden` so lazy images need `scrollIntoView` + a wait.

**Source**: `apps/trading/src/components/{TradeSourceIcon,WalletAvatar,DataTabs}.jsx`, `src/lib/walletAvatar.js`, `src/styles/design-tokens.css`, `public/trade-sources/`
