# Spectre Codebase Status — Post-Surgery Assessment
# April 13, 2026

---

## Codebase Health

| Metric | Value |
|--------|-------|
| Frontend lines (src/) | 443,722 |
| Backend lines (server/) | 39,956 |
| Frontend JS/JSX files | 675 |
| Frontend CSS files | 249 |
| Monoliths over 500 lines | 19 files |
| Error boundary references | 76 (all pages wrapped at route level in App.jsx) |
| Console.logs in src/ | 10 (all in data hooks, stripped by Vite prod build) |
| Build | PASSES |
| Husky pre-commit | ACTIVE (lint-staged blocks console.log) |

---

## Software vs Vibe Code Checklist

- [x] Dead code removed (63 files, 15,924 lines confirmed dead by knip + manual grep)
- [x] Error boundaries on all pages (route-level in App.jsx)
- [x] No console.logs in production bundle (Vite strips them; 10 remain in dev only)
- [x] Pre-commit hooks active (husky + lint-staged)
- [x] Code review rules documented (REVIEW.md)
- [x] Monolith files identified and tracked (see table below)
- [x] Design system documented (.claude/rules/design-system.md)
- [x] No hardcoded API keys in frontend (4 localhost refs use isDev guard)
- [ ] Loading states use skeleton shimmer not spinners (2 minor violations: auth-gate, weather)
- [x] Git history is clean atomic commits

**Score: 9/10**

---

## Monoliths Remaining (over 1,000 lines)

| File | Lines | Status |
|------|-------|--------|
| server/index.js | 13,592 | DEFERRED — Wave 7 needs manual approach |
| trading-chart.jsx | 4,390 | DEFERRED — being replaced by chart overhaul |
| bubbles-page.jsx | 2,513 | LEAVE — canvas physics, can't split |
| website2/index.jsx | 2,290 | LEAVE — marketing page, low risk |
| ventures-page.jsx | 2,192 | DEFERRED — extraction attempted, reverted |
| ai-charts-lab-page.jsx | 2,005 | LEAVE — complex chart interactions |
| mockEvents.js | 1,981 | LEAVE — data file |
| discovery-section.jsx | 1,852 | Tier 2 candidate |
| heatmaps-page.jsx | 1,805 | LEAVE — canvas heavy |
| welcome-page.jsx | 1,789 | Tier 2 candidate (already delegates to 46 sub-components) |
| watchlists-page.jsx | 1,731 | PARTIAL — utils extracted, main page remains |
| categories-page.jsx | 1,704 | Tier 2 candidate |
| header.jsx | 1,670 | LEAVE — shared, high risk |
| useCodexData.js | 1,667 | LEAVE — well-structured internally (7 sub-hooks) |
| search-engine-page.jsx | 1,535 | Tier 2 candidate |
| x-dash-page.jsx | 1,346 | Tier 2 candidate |
| x-bubbles-page.jsx | 1,329 | LEAVE — canvas |

---

## Spectre Data API Map

### Feature Flag
`USE_SPECTRE_API = false` in `spectreDataApi.js` line 12. The entire data API integration is **DISABLED**.

### Files That Reference It

| File | What it uses | Current state |
|------|-------------|--------------|
| `services/spectreDataApi.js` | Service layer: getTokenPricesBatch, getFearGreed, getTopTokens, getMarketOverview | **DISABLED** — `USE_SPECTRE_API = false` |
| `hooks/useCodexData.js:36` | Imports `USE_SPECTRE_API` + `spectreGetPricesBatch` | **DISABLED** — flag checked at lines 392, 1599; always takes legacy path |
| `pages/home/use-fear-greed.js:9` | Imports `USE_SPECTRE_API` + `spectreFearGreed` | **DISABLED** — flag checked at line 26; always takes legacy CoinGecko path |
| `pages/research-zone/research-zone-lite.jsx:16` | Imports from `spectreApi` (different service — NOT the data API) | **ACTIVE** — this is the research backend API, not the data bridge |
| `pages/ventures/ventures-api.js:16` | Comment reference only | N/A |
| `pages/website2/api-page.jsx` | Hardcoded `api.spectreai.io` URLs in code samples | **DISPLAY ONLY** — marketing page showing API docs |
| `pages/website2/index.jsx:421,444` | Hardcoded `api.spectreai.io` URLs in feature showcase | **DISPLAY ONLY** — marketing page |

### Vercel Serverless Functions That Proxy to Spectre API

| Handler | What it does | Current state |
|---------|-------------|--------------|
| `extended-proxy.js` | Proxies /api/market/liquidations, /api/market/stats, token/resolve, token-exchanges, token-markets, token/market-profile, accelerators, private-markets to `api.spectreai.io` | **ACTIVE** — falls back to empty response if Spectre API unreachable |
| `derivatives-proxy.js` | Proxies /api/deriv-agg to `api.spectreai.io` | **ACTIVE** — falls back to empty |

### Summary
- **Frontend data flow:** ALL on legacy (CoinGecko + Codex + Binance). The `USE_SPECTRE_API` flag is `false`.
- **Vercel serverless:** Some routes proxy to `api.spectreai.io` with graceful fallbacks.
- **To activate:** Set `USE_SPECTRE_API = true` in `spectreDataApi.js`. The hooks already have the conditional logic — they'll route to the Spectre API instead of CoinGecko/Codex.
- **Risk:** The Spectre API at `api.spectreai.io` needs to be verified returning correct data shapes before flipping the flag. Test with one hook first (fear-greed is simplest).
