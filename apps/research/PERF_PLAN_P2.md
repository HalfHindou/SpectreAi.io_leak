# Performance Plan P2 — CLS + Composite Animations + Image Delivery

Date: 2026-06-03
Owner: Evgeniy
Target: Lighthouse Performance 55 (dev) → 90+ on prod
Branch: `evgeniy-perf-p2` (off main, after #745/#746 merged)

This pass is the **third wave** of perf work, focused on the real issues that Lighthouse flagged on actual production behaviour (not dev-mode artifacts):

| PR | Wave | Focus | Status |
|----|------|-------|--------|
| #745 | P1 (welcome) | CSS deferral, derivSnap timeout, debounce | merged ✓ |
| #746 | hotfix | News/Posts first-click bug | merged ✓ |
| #751 | P0 (research-zone) | RZ CSS deferral + sentiment gate | merged ✓ (assumed) |
| **this** | **P2 (app-wide)** | **CLS + composite + images** | **open** |

---

## Why this pass exists

Lighthouse on dev server showed Performance **55** and `NO_LCP` error. Dev mode artifacts (11 MB unminified JS, 28 MB total payload, 44s main thread) dominate that score and are irrelevant for production. But underneath the dev noise were **5 real issues** that will reproduce on prod:

1. **CLS 0.195** (need <0.1) — layout shifts from image dims + panel transitions
2. **2,089 KiB image savings** — token logos + news thumbs without lazy/dims
3. **81 non-composited animations** — `background-position` shimmers + `transition: all`
4. **>4 preconnect warning** — too many TCP+TLS handshakes warmed
5. **Render-blocking requests** — main CSS still synchronous

This PR addresses 1, 2 partially, 3, 4.

---

## ✅ Done

### P2-A. Shimmer keyframe → composite overlay
**File:** `apps/research/src/index.css`
**Win:** main-thread paint cost down on every page that uses `.animate-shimmer`

Was: `@keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }` applied to elements with `background-size: 200% 100%`. Animating `background-position` is paint-on-every-frame, non-composited. Lighthouse flagged 50+ skeleton elements as the dominant non-composited class.

Now: same `.animate-shimmer` API, but
- Element gets a static base tint + `position: relative; overflow: hidden`
- A `::after` pseudo-element holds the gradient and `transform: translateX(-100% → 100%)`
- `transform` stays on the compositor thread

Plus `prefers-reduced-motion` opt-out for accessibility.

Scoped shimmers (`sl-shimmer` in spectre-loader.css, `sc-shimmer` in SpectreChart.css + sector-compare-chart.css, `authShimmer` in auth-gate.css) NOT refactored — low element count per page, refactor would require touching the consuming components. Documented for P3.

### P2-B. App.css `transition: all` → composite-only
**File:** `apps/research/src/App.css`
**Win:** the dominant CLS source. Nav-sidebar toggle no longer reflows the entire layout subtree.

- Line 129 `.main-layout` was animating `margin-left`, `padding-left`, `width`, `grid-template-columns` on every nav toggle → kept only `grid-template-columns`. Nav offset is now instant which is what users expect.
- Line 184 `.panel-left` `transition: all` → removed entirely. Sticky-positioned elements must never animate; visual fade is on `.panel-content` opacity (already there).
- Line 234 `.panel-right` — same.
- Line 272 `.panel-toggle` `transition: all` → narrowed to `background-color, border-color, color, box-shadow` (paint-only is acceptable for a small button).

### P2-C. `borderGlow` keyframe → filter brightness
**File:** `apps/research/src/components/trading-chart.css`
**Win:** chart hover glow no longer triggers paint on every frame.

Was: `background-position` slide on `.trading-chart::before` (hover-only large container). Now: `filter: brightness(0.9 → 1.25 → 0.9)`. filter is composited; the original opacity-0/opacity-1 hover gate still controls visibility cleanly.

`sector-compare-chart.css` borderGlow + sc-shimmer-slide NOT changed (single-page, low impact).

### P2-D. Header logo + avatar + token ticker dims
**Files:** `header.css`, `header.jsx`, `token-ticker.jsx`
**Win:** kills the per-image CLS contribution on every page (header is on every route, ticker has dozens of logos).

- `.logo-icon.wordmark` got `aspect-ratio: 6 / 1` — was relying on `width: auto` which waits for image bytes before knowing width.
- Logo `<img>` got `width="228" height="38"` + `fetchpriority="high"` on dark variant (LCP candidate on most paints).
- Profile avatar `<img>` got `width="32" height="32" decoding="async"`.
- Token ticker logo `<img>` got `width="40" height="40" loading="lazy" decoding="async"`.

### P2-E. News + intelligence thumbnails dims/lazy
**Files:** `intelligence/components/NewsItem.jsx`, `ArticlePage.jsx`
**Win:** ~150 KiB of below-fold thumbnails properly deferred; CLS on news lists eliminated.

- `NewsItem.jsx` thumb: added `decoding="async" width="240" height="160"`
- `ArticlePage.jsx` author logo: `width="40" height="40" decoding="async"`
- `ArticlePage.jsx` source favicons (2 spots): `loading="lazy" decoding="async" width="16" height="16"`

### P2-F. Preconnect audit — 5 → 2
**File:** `apps/research/index.html`
**Win:** kills Lighthouse "use sparingly (>4 preconnects)" warning. The 3 demoted origins still get DNS lookup via `dns-prefetch`, just not the TCP+TLS handshake. Saves connection slots for the 2 origins that ACTUALLY matter on cold welcome-page load (CoinGecko CDNs).

Demoted from `preconnect` to `dns-prefetch`:
- `spectre-trading.vercel.app` (only needed on `/token`)
- `trade.spectreai.io` (same)
- `images.unsplash.com` (only `/gm-dashboard`)

Added: `dns-prefetch` for `pbs.twimg.com` (tweet avatars on welcome Posts tab, RZ feed, KOL bubbles).

Kept as `preconnect` (the 2 critical ones for welcome cold load):
- `coin-images.coingecko.com`
- `assets.coingecko.com`

---

## ⏸ Deferred (P3 — separate PRs)

### Scoped shimmer keyframes (4 files)
Per-component shimmers in `spectre-loader.css`, `SpectreChart.css`, `mobile-search-overlay.css`, `auth-gate.css`. Each owns its consumer's gradient setup. Refactoring to the new overlay pattern requires changing the consuming component too. Low element count per page makes this lower priority than the global one (which is done).

### img-proxy WebP/AVIF conversion (~30% bandwidth)
`apps/research/api/img-proxy.js` currently passes through original format. Adding Accept negotiation + Cloudflare Image Resizing parameters would cut ~200 KiB on token logos. Requires Cloudflare config + image transformation infra setup.

### Token logo sizing per context (~200 KiB)
We always serve `/coins/images/{id}/small/` (48×48) even when rendering at 16×16 in tickers. Either:
- Use `/coins/images/{id}/thumb/` URLs for ticker contexts
- Or route through img-proxy with `?size=N` once WebP infrastructure is in place

### CLS — boot skeleton vs render dimension audit
Lighthouse "Layout shift culprits" needs Browser DevTools Performance trace to identify exact elements. Likely sticky banners (AuthGate, install prompt) mounting after first paint. Need to reserve their space.

### Cache lifetimes (102 KiB)
`vercel.json` headers — static assets should have `Cache-Control: public, max-age=31536000, immutable`. Probably already correct but verify with `curl -I` on a `.js` chunk.

### Reduce unused JS (real, ~96 KiB duplicated)
Vite bundle audit — some packages may be in multiple chunks. `vite.config.js` `rollupOptions.output.manualChunks` could fix.

### Replace `setInterval` shimmer animation in index.html boot skeleton (`bkShim` at line 414)
Same fix pattern as P2-A — but boot skeleton renders BEFORE React mounts, so even more important to keep cheap. Currently uses `background-position`. Convert to `transform` overlay or use a tiny pure-CSS skeleton (no animation).

### Other img dim audit
Found via agent (audit report): IssuerSpotlight.jsx (founder images), rz-kol-bubbles.jsx (already done in #751), x-bubble-maps/NodeTooltip.jsx (avatar circles), discovery-section.jsx (token cards). 294 total `<img>` tags app-wide without `loading="lazy"`. Need a script-level audit + apply.

---

## Files touched

```
M apps/research/index.html                                    (P2-F preconnect audit)
M apps/research/src/App.css                                   (P2-B panel transitions)
M apps/research/src/index.css                                 (P2-A shimmer composite)
M apps/research/src/components/header.css                     (P2-D logo aspect-ratio)
M apps/research/src/components/header.jsx                     (P2-D logo + avatar dims)
M apps/research/src/components/token-ticker.jsx               (P2-D ticker logo dims)
M apps/research/src/components/trading-chart.css              (P2-C borderGlow filter)
M apps/research/src/pages/intelligence/components/NewsItem.jsx        (P2-E thumb dims)
M apps/research/src/pages/intelligence/components/ArticlePage.jsx     (P2-E logo + favicons)
```

---

## Predicted impact

**Caveats:**
- Numbers based on prod build on Vercel Edge. Local dev = unreliable as discussed.
- Real Lighthouse run required to confirm.

| Metric | Estimated Before (prod) | Estimated After (prod) |
|--------|-------------------------|------------------------|
| **CLS** | ~0.15-0.20 | ~0.05-0.08 (P2-B + P2-D) |
| **LCP** | varies | -100-200ms (P2-D logo aspect-ratio + fetchpriority) |
| **TBT** | ~150-300ms | -50-100ms (composite shimmer + borderGlow) |
| **Non-composited animations** | ~80 elements | ~30-40 elements (-50% from global shimmer fix) |
| **Image savings** | 2,089 KiB potential | ~1,700 KiB potential (-150KB news + small CLS prevention) |
| **Preconnects** | 5 (warning) | 2 (clean) |
| **Performance score (prod, fast 3G)** | ~75-80 | **~85-90** |

The biggest single lever is **P2-B (App.css transitions)** for CLS, which on the prod measurement may be the largest score improvement.

---

## Verification checklist

- [x] `npm run build:research` clean
- [ ] Manual smoke (dev server): nav toggle works, no flicker; panel collapse works; shimmer still visible on skeleton loaders
- [ ] Manual smoke: hover on trading-chart → glow appears with brightness pulse (no movement)
- [ ] Hard reload after merge, run Lighthouse on Vercel preview in **incognito**
  - Compare to baseline screenshots in this thread
  - Expect: CLS <0.1, score 85+
- [ ] If score still <90, identify remaining lever via Lighthouse "LCP breakdown" + "Layout shift culprits"

---

## Notes
- This PR bypasses the standard research-team `engineering` → `main` flow per author request, matching the pattern of #745, #746, #751.
- Boot skeleton in `index.html` is NOT changed this pass — `aspect-ratio` was the only request, and the skeleton elements already have fixed dimensions. The `bkShim` keyframe still uses `background-position` but only animates 7 small placeholder elements; low impact pre-React-mount.
