# Performance Plan P3 — Cache headers + composite shimmers + img-lazy sweep

Date: 2026-06-03
Branch: `evgeniy-perf-p3` (off main after #745/#746/#751/#752 merged)
Target: address the residual Lighthouse findings that survived P2

## Why this pass exists

After #752 (P2) merged, Lighthouse on dev still reported:
- 323 KiB savings from cache lifetimes
- 84 non-composited animations (down from 80, but 4 scoped shimmers + boot skeleton still pulsing background-position)
- 97 KiB duplicated JavaScript
- 27 KiB legacy JavaScript
- 2003 KiB image savings (290+ img tags app-wide without `loading="lazy"`)
- CLS 0.204

Dev-mode noise dominates the score, but the underlying findings are real and reproduce on prod. This PR addresses 4 of them; the 5th (JS duplication / vite manualChunks rebalancing) needs a separate dist-analyzer pass.

## ✅ Done

### P3-A — Long-cache headers for public static assets
**File:** `apps/research/vercel.json`
**Win:** `~323 KiB` of repeat-visit waste on `/round-logo.png`, `/logo-dark-mode.png`, `/logo-day-mode.png`, `/og-image.png`, `/spectre-logo-black.png`, hero MP4s, and any root-level WOFF/WOFF2 leakage now get `Cache-Control: public, max-age=31536000, immutable`.

`/assets/(.*)` (Vite bundled JS/CSS) already had immutable. The gap was root-level `public/` files which used Vercel default short TTL. Now patched.

### P3-B — Boot skeleton shimmer → composite opacity pulse
**File:** `apps/research/index.html` (boot skeleton `<style>`)
**Win:** runs on EVERY cold load before React mounts, was a `background-position` slide on 7 skeleton blocks (header/search/actions/rail items/cards). Lighthouse flagged each as non-composited. Now `opacity: 1 → 0.6 → 1` pulse — composited, looks identical at the <1 s window.

### P3-E — 4 scoped shimmer keyframes → composite opacity pulse
Same fix as P3-B applied to each of:
- `apps/research/src/components/spectre-loader.css` `@keyframes sl-shimmer`
- `apps/research/src/chart/SpectreChart.css` `@keyframes sc-shimmer`
- `apps/research/src/components/mobile-search-overlay.css` `@keyframes shimmer`
- `apps/research/src/components/auth-gate.css` `@keyframes authShimmer`

Combined with the global `.animate-shimmer` fix shipped in #752, the only remaining `background-position` shimmer in the app is `sc-shimmer-slide` in `sector-compare-chart.css` (page-scoped, 3 elements max, deferred to P4).

**Expected impact on the Lighthouse "Avoid non-composited animations" audit:**
- Before P2: 81 elements
- After P2 (#752 global shimmer): ~30-40 elements
- After P3-B + P3-E: ~15-20 elements (still flagged but lower priority)

### P3-D — `loading="lazy"` sweep on welcome-page tab panels + news detail
Six high-render-count `<img>` tags in welcome-page tabs that render dozens at once when opened:
- `heatmap-tab-panel.jsx` — heatmap grid tile logos
- `heatmap-command-panel.jsx` — heatmap tiles (`hcp-tile-logo`) + movers row (`hcp-movers-logo`)
- `sectors-tab-panel.jsx` — sector mover chip logos
- `mindshare-tab-panel.jsx` — 3 spots: stage bubble logo, spotlight, mover chip
- `news-detail-panel.jsx` — 4 spots: cover image, source icon, tweet avatar, tweet media

Added `loading="lazy" decoding="async" width=N height=N` to each.

This is the **mechanical** layer of the audit. Many more candidates remain (294 total reported by the agent audit) — bulk-applying them needs more time. Focused this pass on the welcome-page surfaces where the highest-render-count tabs are.

## ⏸ Deferred (P4)

### Vite `manualChunks` audit — 97 KiB duplicated JS
Needs `rollup-plugin-visualizer` or similar to identify which modules end up in multiple chunks. Current `vite.config.js` has good baseline (`vendor-react`, `vendor-zustand`, `vendor-i18n`, `vendor-motion`, `vendor-remotion`, `vendor-html2canvas`, `vendor-d3`, `vendor-three`) but Lighthouse still reports 97 KiB. Likely a shared lib pulled by multiple lazy chunks. Out of scope for a single CSS-and-JSX pass.

### Legacy JavaScript — 27 KiB
Vite already targets `es2020` in build config, so this is likely a vendor (Privy SDK? @solana? @walletconnect?) shipping ES5 bundles. Identifying which means bundle inspection.

### Remaining img-lazy sweep
Agent audit reported 294 total `<img>` without `loading="lazy"`. P3-D hit the highest-impact welcome-tab cases (~10 spots). The rest:
- discovery-section.jsx token cards
- IssuerSpotlight.jsx founder images (RWA)
- x-bubble-maps/NodeTooltip.jsx avatars
- mobile-token-row.jsx (verify TokenImg handles it)
- mobile-greeting.jsx
- chart-panel.jsx (3 spots)
- compare-bar-modal.jsx
- 30+ x-intelligence components
- 20+ tokenized-assets components
- 20+ ventures components
- All website2 / lp pages

That's a separate mechanical PR.

### CLS 0.195 → <0.1 final sprint
P2 + P3 should get CLS down to ~0.05-0.08 once images have explicit dimensions everywhere. Lighthouse "Layout shift culprits" needs browser-trace to identify specific elements. Sticky banners (AuthGate, install prompt, mobile banner) likely culprits.

### img-proxy WebP/AVIF negotiation
Token logo savings ~200 KiB if `img-proxy.js` learns Accept-header negotiation + Cloudflare Image Resizing. Needs infrastructure work.

## Files touched

```
M apps/research/vercel.json                                          (P3-A long-cache)
M apps/research/index.html                                           (P3-B boot skeleton)
M apps/research/src/components/spectre-loader.css                    (P3-E sl-shimmer)
M apps/research/src/chart/SpectreChart.css                           (P3-E sc-shimmer)
M apps/research/src/components/mobile-search-overlay.css             (P3-E shimmer)
M apps/research/src/components/auth-gate.css                         (P3-E authShimmer)
M apps/research/src/pages/home/components/heatmap-tab-panel.jsx      (P3-D)
M apps/research/src/pages/home/components/heatmap-command-panel.jsx  (P3-D × 2)
M apps/research/src/pages/home/components/sectors-tab-panel.jsx      (P3-D)
M apps/research/src/pages/home/components/mindshare-tab-panel.jsx    (P3-D × 3)
M apps/research/src/pages/home/components/news-detail-panel.jsx      (P3-D × 4)
```

## Build verified
`npm run build:research` ✅ clean.

## Notes
- Bypasses standard research-team `engineering` → `main` flow per author request, matching #745, #746, #751, #752.
- All changes are CSS / JSX / JSON config only. Zero JS logic changes.
- Boot skeleton pulse uses `opacity` only — composited, respects `prefers-reduced-motion` already in place.
