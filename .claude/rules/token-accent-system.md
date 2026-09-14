---
paths:
  - apps/trading/src/hooks/useAccentTheme.js
  - apps/trading/src/utils/tokenColors.js
  - apps/trading/src/lib/accentNormalize.js
  - apps/trading/src/App.jsx
  - apps/trading/src/components/TokenBanner.jsx
  - apps/trading/src/components/RightPanel.jsx
  - apps/trading/src/components/HeaderDossier.css
  - apps/trading/src/styles/design-tokens.css
  - apps/trading/api/token-color.js
  - apps/research/api/token-color.js
  - apps/research/src/utils/dynamic-token-color.js
  - apps/research/src/hooks/useTokenBrandColor.js
  - packages/server/index.js  # extractDominantColor, /api/token-color, /api/tokens/search
---

# Token Accent System — Complete Reference

Cross-app pipeline that resolves a token's brand colour and applies it as the page-level `--accent*` CSS channel. Touches frontend (research + trading), backend extraction (Express + Vercel), and several caches. Many failure modes; this file consolidates the whole thing.

---

## A. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Active token (App.jsx token state)                                 │
│     │                                                                │
│     ├── useAccentTheme(token)  ─────► writes --accent* to .app      │
│     │                                                                │
│     ├── RightPanel local bannerColor  ─► bannerColor prop           │
│     ├── App.jsx orb tinter            ─► --token-bg-* vars          │
│     └── TokenBanner local bannerColor ─► page background gradients  │
│                                                                      │
│  All FOUR pipelines call the same extractor functions:              │
│     - hasKnownColor / getTokenColor   (curated table)               │
│     - getCachedColor                  (module-level Maps)           │
│     - fetchTokenColorFromServer       (server-side extraction)      │
│     - extractColorFromImage           (client canvas + img-proxy)   │
└─────────────────────────────────────────────────────────────────────┘
```

## B. useAccentTheme priority chain (the authoritative pipeline)

`apps/trading/src/hooks/useAccentTheme.js`

1. **Curated by symbol** — `hasKnownColor(token.symbol)` checks `KNOWN_TOKEN_COLORS` (~80 hand-picked tokens). If true, use `getTokenColor()` AND SKIP async entirely. Curated wins because image extraction picks bad pixels (logo borders, gradients, transparent edges).
2. **Cached by logo URL** — `getCachedColor(token.logo)` checks canvas-cache then server-cache Maps. If hit, use it (same value any extraction would resolve to).
3. **Hash-derived sync fallback** — `getTokenColor(symbol, address)` always returns SOMETHING. Sets `ramp` synchronously so the page never sits on the lime default while async resolves.
4. **Async upgrade** — `Promise.any([extractColorFromImage(logo), fetchTokenColorFromServer(logo)])` with `requireHex` rejection wrapper. First non-null wins, upgrades the hash seed.

The async upgrade is gated on `if (token.logo)`. Without a logo URL it cannot run.

## C. KNOWN_TOKEN_COLORS curated table

`apps/trading/src/utils/tokenColors.js` lines 10-65 (~63 entries: commodities + L1s + memes + DeFi).

### Adding / editing an entry

1. Find the official brand hex from the project's brand kit (their site footer, brand.{project}.org, or press kit).
2. Append/edit the object literal entry. `hasKnownColor()` strips `$` prefix automatically (so both `$WIF` and `WIF` resolve to the same key).
3. **Run the audit** — `npm run audit:colors`. It catches:
   - **Collisions** — two distinct tokens with identical hex (UX problem)
   - **Monochrome triggers** — chroma < 0.04 → `normalizeAccent` returns silver fallback, ignoring the curated value
   - **Low-chroma warnings** — chroma 0.04-0.10 → displayed hue will drift because `normalizeAccent` lifts to C_MIN=0.16
4. Hard issues exit code 1; soft warnings exit 0.

### Audit script: `scripts/audit-token-colors.mjs`

- Reads `KNOWN_TOKEN_COLORS` directly from the live source file (never goes stale)
- `--research` flag audits research app's table; default is trading
- `--json` for machine-readable output (CI integration)
- Allowlists: `INTENTIONAL_MONO` (SPECTRE, commodity entries) + `INTENTIONAL_COLLISIONS` (e.g. `WEN::SOL` — niche tokens inheriting an L1's brand)

### Known intentional patterns

- `'SPECTRE': '#D4D4D8'` — warm silver IS the SPECTRE brand. Allowlisted in audit's `INTENTIONAL_MONO` so it doesn't fail.
- `'WIF': '#FFAFC9'` + variants — WIF's signature pink (was incorrectly SOL purple pre-2026-05-26).
- Commodity entries (`GLD`, `SLV`, etc.) — intentional monochrome.
- `'WEN': '#9945FF'` — niche Solana meme inheriting SOL's purple. Allowlisted in `INTENTIONAL_COLLISIONS`.

### History of curated-table bugs (use as test cases)

| Before | After | Why |
|---|---|---|
| `'NEAR': '#00C1DE'` | `'#00EC97'` | Was cyan; NEAR's actual brand is mint green |
| `'SHIB': '#F7931A'` | `'#FFA409'` | Collided with BTC; SHIB has its own orange |
| `'WIF': '#9945FF'` | `'#FFAFC9'` | Collided with SOL; WIF has its own pink |
| `'RENDER': '#00D395'` | `'#FF0066'` | Collided with JUP; Render's brand is red |
| `'TAO': '#1C1C1E'` | `'#FFCC33'` | Near-black triggered mono guard → silver |
| `'RAY': '#4FC3F7'` | `'#C200FB'` | Was light blue; Raydium's actual brand is magenta |

Run `npm run audit:colors` before committing any change to the curated table.

## D. Failure-signal contract — `null` is the ONLY failure value

**Hard rule**: every extraction function returns `null` on failure. NEVER a sentinel hex value.

The 2026-05-26 silver-sentinel bug: failure paths returned `'#D4D4D8'` (also a legit warm-silver brand colour). Callers couldn't distinguish "extraction failed" from "this token really IS silver" — so every uncurated failed-extraction converged to the same near-white. Looked like a stale cache.

Functions that MUST return null on failure (not `#D4D4D8`):
- `fetchTokenColorFromServer(url)` — `apps/trading/src/utils/tokenColors.js`
- `extractColorFromImage(url)` — same file
- `extractDominantColor(pixelData)` — `packages/server/index.js`
- `/api/token-color` route — `packages/server/index.js` AND `apps/trading/api/token-color.js`

Server response shape on failure: `{ "color": null }` (NOT `{ "color": "#D4D4D8" }`).

## E. Server-side extraction (`packages/server/index.js`)

### `/api/token-color` route (dev)

GET request. Validates URL against `ALLOWED_IMG_DOMAINS`, fetches PNG (5s timeout), runs `decodePngPixels` + `extractDominantColor`. Caches:
- **Success** → `TOKEN_COLOR_TTL` (1 hour)
- **Failure** → `TOKEN_COLOR_FAIL_TTL` (60 seconds) — short so transient outages don't lock a token to "no colour" for an hour

### Prod equivalent: `apps/trading/api/token-color.js`

Vercel KV-backed. GET returns cached hex or null. POST stores client-extracted hex.

### `decodePngPixels`

Supports 8-bit RGB (color type 2) and 8-bit RGBA (color type 6) PNG only. Rejects:
- paletted PNG-8 (returns null)
- 16-bit PNG (returns null)
- non-PNG (WebP, AVIF, SVG, JPEG) (returns null)
- animated PNG (decodes only first frame)

This is a known limitation. Future work: swap in `sharp` for multi-format support. Until then, the caller's null fallback handles it gracefully.

### `extractDominantColor`

1. **2D grid sampling** — `gridStep = round(sqrt(totalPixels / 256))`. Walks `(x, y)` in nested loops. NEVER use 1D linear stride — for square images the stride collapses to column 0 (see section F).
2. **Pixel filters** — skip transparent (a<128), near-black (lum<25), near-white (lum>240), near-grey (sat threshold).
3. **Two-pass scoring** — vibrant pick (highest `sat × sqrt(count)` with sat>0.3 & count≥2) wins over common pick (highest weight). Vibrant beats common because logo edges generate big grey buckets that drown out the actual brand colour.
4. **Brightness boost** — `if (lum < 80 && sat >= 0.1)` lift `r, g, b` by `boost = 80/lum`. Preserves dark vibrant brand colours (purple, navy, deep red) that the previous `lum<45` hard-reject was destroying.
5. **Grey rejection** — only rejects with sat<0.1 AND lum<180 (truly desaturated). Lets vibrant darks through.

## F. The 1D-stride trap (and why 2D grid matters)

```js
// THE BUG (pre 2026-05-26)
const step = Math.max(1, Math.floor(totalPixels / 256))
for (let i = 0; i < totalPixels; i += step) { /* sample */ }
```

For a 256×256 image, `totalPixels/256 = 256 = width`. Every sample lands in column 0. Token logos are centred marks on transparent backgrounds → column 0 is empty → every sample is alpha=0 → buckets stays empty → returns null.

Same bug class affects ANY stride that's a multiple of (or coprime-with the wrong way) `width`. The 2D-grid replacement covers any image dimensions reliably.

## G. Client-side extraction (`apps/trading/src/utils/tokenColors.js`)

### `extractColorFromImage(url)` — canvas extraction

Loads via `/api/img-proxy?url=` (CORS workaround), draws to 32×32 canvas, samples via 1D linear walk over the small grid (32² = 1024 pixels — not enough for the 1D bug to manifest because of the small total). Same pixel filters as server. Returns hex or null.

### `fetchTokenColorFromServer(url)` — server delegation

- `AbortSignal.timeout(5000)` — was 2s, bumped 2026-05-26 because 2s competed with browser request queueing on cold page loads
- Caches valid hex in `_serverColorCache` (Map, permanent per session)
- Does NOT cache nulls (server already negative-caches with 60s TTL)
- Dedupes concurrent requests via `_serverColorInflight` Map

### `getCachedColor(url)` — sync cache lookup

Checks `_canvasColorCache` then `_serverColorCache`. Returns hex or null. No network calls.

### `getTokenColor(symbol, address)` — hash fallback

`KNOWN_TOKEN_COLORS[symbol]` if present. Otherwise FNV-1a hash of `${symbol}|${address}` → HSL hue. Always returns a valid colour string.

## H. accentNormalize.js — colour ramp synthesis

`apps/trading/src/lib/accentNormalize.js`

Input: hex string or `[r,g,b]` tuple. Output: 6-key ramp object (`accent, bright, deep, glow, wash, contrast` + meta).

Algorithm (OKLCH-based):
1. Parse → sRGB → OKLCH.
2. If chroma < 0.04 (MONOCHROME_CHROMA) → return `MONOCHROME_FALLBACK` (warm off-white ramp).
3. Clamp L into [0.62, 0.82] (perceptual legibility band on `#000`).
4. Lift chroma to ≥ 0.16 (over-desaturated brands get vibrancy).
5. Enforce WCAG ≥ 3.5 vs `#000` by lifting L until satisfied.
6. Derive `bright` at L+0.10, `deep` at L-0.10.
7. `glow` at α=0.45, `wash` at α=0.08.
8. `contrast` = near-black if luma > 0.45, else white.

The normaliser handles dark inputs (purple, navy) by lifting L into the readable band. So even if extraction returns `#a600ff` (lum~36), the resulting ramp is readable purple.

## I. Deep-link routing (the cross-cutting bug source)

`apps/trading/src/App.jsx` `useState` initialiser + `resolveToken()` effect.

### Initialiser flow

1. URL hash `#token/<addr>` → `deepLinkAddressRef.current = addr`
2. Initialiser:
   - If embedded: parse `?token=&networkId=` from search params
   - If `deepLinkAddressRef.current` is set:
     - **Try localStorage match first** (added 2026-05-26): if `localStorage['spectre-selected-token'].address === deepLinkAddr`, return cached token (full data, includes logo). useAccentTheme runs immediately with real data.
     - Otherwise fall to placeholder `{ ...defaultToken, address: deepLinkAddr, symbol: '...', logo: undefined }`. Placeholder has NO logo, so useAccentTheme priority 4 won't run.
   - If no deep-link: use localStorage cache or defaultToken

### Resolver effect (runs once on mount)

1. `searchTokens(address)` — Codex GraphQL search
2. **Address-strict pick** (added 2026-05-26): `.find(r => r.address.toLowerCase() === wantedAddr)`. NEVER `results[0]` — Codex search is fuzzy, returns UNI (top liquidity) for any non-indexed address.
3. If no exact match: fall through to `getDetailedTokenInfo(address, networkId)` — exact-by-address Codex query. Validates returned `address === wantedAddr` again (defense in depth).
4. If match: `selectToken(...)` which calls `setToken(...)` AND `localStorage.setItem(...)`.

### Codex search hangs (the inflight Promise leak)

`packages/server/index.js` `/api/tokens/search` route:
- Uses `_codexSearchInflight` Map for concurrent dedup
- Inflight Promise was orphaned by two early returns inside the try block (L5129 token-not-found, L5250 found-with-market-data) that called `res.json(...)` without `_resolveInflight(...)`. Subsequent calls awaited the orphan forever (well, until `CODEX_SEARCH_CACHE_TTL` = 30s).
- Fixed 2026-05-26: every early return now calls `_resolveInflight(data)` + seeds `_codexSearchCache` before returning.

## J. The four parallel pipelines (and why TokenIdentityCard can be purple while page is teal)

Bot-spotting checklist when accents look wrong:

| Surface | Pipeline | Source |
|---|---|---|
| Page-wide `--accent*` CSS vars | `useAccentTheme(token)` | `apps/trading/src/App.jsx:582` |
| TokenIdentityCard right-rail banner | RightPanel local extraction → `bannerColor` prop | `apps/trading/src/components/RightPanel.jsx:159-214` |
| TokenBanner page background gradients | TokenBanner local extraction → `setBannerColor` | `apps/trading/src/components/TokenBanner.jsx:445-459` |
| Ambient orbs behind chart | App.jsx orb tinter → `--token-bg-*` | `apps/trading/src/App.jsx:540-571` |

All four share the SAME extractor functions, but their state is local to each component. If one shows the right colour and others don't, the extraction works but a consumer pipeline is broken. If ALL show the wrong colour, the extractor is broken.

The user verified end-to-end on 2026-05-26 that all four pipelines produce consistent purple for PAAL after the fixes.

## K. Verification commands

```js
// 1. Hash hue for any token (sync, no network)
const { getTokenColor } = await import('/src/utils/tokenColors.js')
console.log(getTokenColor('$PAAL', '0x14fee680690900ba0cccfc76ad70fd1b95d10e16'))

// 2. Hit the server extraction directly
fetch('/api/token-color?url=https%3A%2F%2Ftoken-media.defined.fi%2F1_0x14fee680...png')
  .then(r => r.json()).then(j => console.log(j))
// Expect: { color: '#a600ff' } or similar purple. NEVER '#D4D4D8' as a failure value.

// 3. Read the current accent
getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent')

// 4. Inspect the active token state
JSON.parse(localStorage.getItem('spectre-selected-token'))

// 5. Curl from terminal to bypass browser caches
curl -s "http://localhost:3001/api/token-color?url=<encoded>"
```

## L. Files to edit when changing this system

| Change | Files |
|---|---|
| Add curated token | `apps/trading/src/utils/tokenColors.js` (KNOWN_TOKEN_COLORS) + `apps/research/src/constants/tokenColors.js` |
| Tune extraction filters | `packages/server/index.js` `extractDominantColor` + `apps/trading/src/utils/tokenColors.js` `extractColorFromImage` (keep in sync — server and canvas should agree) |
| Change priority chain | `apps/trading/src/hooks/useAccentTheme.js` |
| Add new accent consumer | Use `var(--accent)` / `var(--accent-bright)` / `var(--accent-deep)` / `var(--accent-glow)` / `var(--accent-wash)` / `var(--accent-contrast)` directly — NEVER read from `token.dominantColor` or run your own extraction |
| Modify deep-link routing | `apps/trading/src/App.jsx` initialiser (L443-504) + `resolveToken()` (L634-695) |
| Add POST to server cache | `packages/server/index.js` `/api/token-color` route (currently GET only; client canvas extraction POSTs back, gets 404 — harmless write-through but worth fixing) |

## M. Outstanding work (not blockers)

1. **POST handler for `/api/token-color` in Express** — client canvas extraction POSTs hex back to warm the server cache. Currently 404s (fire-and-forget so no functional impact, just noise in network log).
2. **Multi-format support** — replace homegrown `decodePngPixels` with `sharp` for WebP / AVIF / SVG / paletted-PNG support. ~80% of tokens are 8-bit RGBA PNG so the current decoder works for most, but adding sharp would lift the success rate for the remaining ~20%.
3. **Curated table expansion** — top 50 uncurated tokens by market cap could be curated manually for guaranteed accuracy (PAAL, KAS, RNDR, TAO, FET, INJ, SUI, APT, ONDO, etc.).

Layer 1+2 fixes already make the system work for any logo that decodes. Layer 3 (curation) is optional polish.

---

## Quick failure-mode → fix lookup

| Symptom | Likely cause | Where to fix |
|---|---|---|
| All uncurated tokens look silver/white | Server returning `#D4D4D8` sentinel | `extractDominantColor` end-of-function — must return null on failure, not `#D4D4D8` |
| Vibrant token (purple/navy/red) gets hash hue instead of brand | Hard luminance rejection or 1D-stride sampling | `extractDominantColor` — verify 2D grid + brightness boost |
| Deep-link to low-cap loads UNI (or another wrong token) | Fuzzy search `results[0]` blind pick | `App.jsx:634-695` `resolveToken()` — must use `.find()` address match |
| Hard-refresh of any deep-link stuck on hash hue | Placeholder branch dropped logo + async resolver silently failed | `App.jsx:443-504` initialiser — try localStorage cache by address first |
| Page-wide accent wrong but TokenIdentityCard right-rail correct | useAccentTheme priority 4 didn't apply | Check `fetchTokenColorFromServer` timeout (5s), check `_serverColorCache` for stale entries, hard-refresh to clear module Maps |
| Subsequent searches for same query hang 30s | Inflight Promise leak | `/api/tokens/search` — every early return inside try must call `_resolveInflight()` |
| `POST /api/token-color 404` in console | Missing POST handler on Express side | Add POST route to `packages/server/index.js` mirroring `apps/trading/api/token-color.js` |
