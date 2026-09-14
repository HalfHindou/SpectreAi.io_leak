---
paths:
  - "apps/research/src/**/*.mobile.css"
  - "apps/research/src/**/mobile-*.jsx"
---

# Responsive Rollout Plan - Page Inventory

**Generated:** Phase 0C of responsive-plan-v4
**Source:** `apps/research/src/App.jsx` (40 lazy-loaded routes) + `src/pages/` directory (43 folders)

> **STALE for page inventory** (as of 2026-05-21 the app has 56 page folders / 60+ routes). For the current page list use `apps/research/.claude/rules/research-platform.md` section D. This file stays valid only for its mobile/responsive status notes.

---

## A. Route Summary

| Count | Category |
|-------|----------|
| 40 | Total routes in App.jsx (including /intelligence/:type/:slug and /news/:articleId variants) |
| 2 | Standalone (outside AppShell): /newsroom, /website |
| 5 | AppShell only (no PageShell): /token, /gm-dashboard, /monarch-chat, /world, /x-intelligence |
| 33 | AppShell + PageShell (standard pages) |
| 3 | Page folders with NO route: admin, auth, pricing (dead/internal pages) |
| 1 | Page folder with NO route: x-bubble-maps (exists in filesystem, not in App.jsx) |

---

## B. Full Route Inventory

### STANDALONE PAGES (outside AppShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/newsroom` | newsroom | None | No | Yes | 12 jsx, 1 css | Medium |
| `/website` | website | None | No | Yes | 1 jsx, 1 css | Simple |

### APPSHELL-ONLY PAGES (no PageShell - own layout needs)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/token` | token | None | No | Yes | 7 jsx, 5 css | Complex (iframe to trading app) |
| `/gm-dashboard` | gm-dashboard | None | No | Yes | 2 jsx, 1 css | Medium |
| `/monarch-chat` | monarch-chat | None | No | Yes | 2 jsx, 1 css | Medium (3-column chat) |
| `/world` | world | None | No | Yes | 7 jsx, 2 css | Complex (3D globe) |
| `/x-intelligence` | x-intelligence | None | No | Yes | 15 jsx, 1 css | Complex (social graph) |

### DATA PAGES (AppShell + PageShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/` (home) | home | 12 mobile-*.jsx, welcome-page.mobile.css | Yes | Yes (heavy) | 63 jsx, 28 css | Complex (reference impl) |
| `/discover` | discover | None | No | Yes (1) | 2 jsx, 1 css | Simple |
| `/watchlists` | watchlists | mobile-bottom-sheet.jsx | No | Yes | 4 jsx, 3 css | Medium |
| `/categories` | categories | None | No | Yes (4) | 2 jsx, 1 css | Simple |
| `/heatmaps` | heatmaps | None | No | Yes (5) | 10 jsx, 6 css | Medium |
| `/bubbles` | bubbles | None | No | Yes (3) | 2 jsx, 1 css | Medium (canvas) |
| `/fear-greed` | fear-greed | None | No | Yes (7) | 18 jsx, 7 css | Complex |
| `/tokenized-assets` | tokenized-assets | None | No | Yes (15) | 15 jsx, 1 css | Complex |
| `/liquidation-heatmap` | liquidation-heatmap | None | No | Yes | 10 jsx, 2 css | Medium |

### AI/CONTENT PAGES (AppShell + PageShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/intelligence` | intelligence | None | No | Yes (3) | 30 jsx, 1 css | Complex |
| `/intelligence/:type/:slug` | intelligence (ArticlePage) | None | No | - | (shares above) | Medium |
| `/news` | news | None | No | Yes (3) | 5 jsx, 1 css | Medium |
| `/news/:articleId` | news | None | No | - | (shares above) | Medium |
| `/ai-market-analysis` | ai-market-analysis | None | No | Yes | 2 jsx, 1 css | Simple |
| `/ai-charts` | ai-charts | None | No | Yes | 2 jsx, 1 css | Simple |
| `/ai-charts-lab` | ai-charts-lab | None | No | Yes | 3 jsx, 2 css | Medium |
| `/ai-media-center` | media-center | None | No | Yes | 6 jsx, 4 css | Medium |

### SOCIAL PAGES (AppShell + PageShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/social-zone` | social-zone | None | No | Yes | 2 jsx, 1 css | Simple |
| `/x-dash` | x-dash | None | No | Yes | 2 jsx, 1 css | Simple |
| `/x-bubbles` | x-bubbles | None | No | Yes | 2 jsx, 1 css | Medium (canvas) |
| `/x-intel` | x-intel | None | No | Yes | 2 jsx, 1 css | Simple |
| `/x-beta` | x-beta | None | No | Yes (3) | 12 jsx, 1 css | Medium |
| `/lens` | lens | None | No | No | 2 jsx, 1 css | Simple |
| `/gm-dashboard` | gm-dashboard | None | No | Yes | 2 jsx, 1 css | Medium |

### TOOL PAGES (AppShell + PageShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/roi-calculator` | roi-calculator | None | No | Yes | 3 jsx, 2 css | Simple |
| `/economic-calendar` | economic-calendar | None | No | Yes | 70 jsx, 43 css | Complex (largest page) |
| `/search-engine` | search-engine | None | No | Yes | 2 jsx, 1 css | Simple |
| `/glossary` | glossary | None | No | No | 2 jsx, 1 css | Simple |
| `/traders-corner` | traders-corner | None | No | Yes (3) | 32 jsx, 1 css | Complex |

### FULL-SCREEN PAGES (AppShell, no PageShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/monarch-chat` | monarch-chat | None | No | Yes (4) | 2 jsx, 1 css | Medium |
| `/world` | world | None | No | Yes | 7 jsx, 2 css | Complex (WebGL) |
| `/research-zone/:coinSlug?` | research-zone | mobile-tab-bar.jsx | No | Yes | 22 jsx, 11 css | Complex |

### USER PAGES (AppShell + PageShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/user-dashboard` | user-dashboard | None | No | Yes | 9 jsx, 2 css | Medium |
| `/you` | you | None | No | Yes | 64 jsx, 3 css | Complex |

### OTHER PAGES (AppShell + PageShell)

| Route | Page Dir | Mobile Files | Cinema CSS | @media | Files | Complexity |
|-------|----------|-------------|------------|--------|-------|------------|
| `/ventures` | ventures | None | No | Yes | 8 jsx, 1 css | Medium |
| `/zigchain` | zigchain | None | No | Yes (3) | 4 jsx, 1 css | Simple |
| `/structure-guide` | structure-guide | None | No | Yes | 2 jsx, 1 css | Simple |

### UNROUTED PAGE DIRECTORIES (exist in filesystem, no App.jsx route)

| Page Dir | Files | Notes |
|----------|-------|-------|
| admin | 2 jsx, 1 css | Internal admin panel - skip for mobile |
| auth | 1 jsx, 1 css | Auth page - skip for mobile |
| pricing | 1 jsx, 1 css | Pricing page - skip for mobile |
| x-bubble-maps | 18 jsx, 1 css | Not routed - possibly WIP or replaced by x-bubbles |

---

## C. Complexity Distribution

| Complexity | Count | Pages |
|-----------|-------|-------|
| Simple | 14 | discover, categories, ai-market-analysis, ai-charts, social-zone, x-dash, x-intel, lens, roi-calculator, search-engine, glossary, zigchain, structure-guide, website |
| Medium | 15 | watchlists, heatmaps, bubbles, liquidation-heatmap, news, ai-charts-lab, media-center, x-bubbles, x-beta, gm-dashboard, monarch-chat, newsroom, ventures, user-dashboard, intelligence article |
| Complex | 11 | home, fear-greed, tokenized-assets, intelligence, economic-calendar, traders-corner, research-zone, token, world, x-intelligence, you |

---

## D. Recommended Batch Rollout Order

### Already Done
- **Home (Welcome page)** - reference implementation, 12 mobile components

### Phase 2: Core Data Page
- **Discover** - simple data table, proves the mobile data table pattern

### Phase 3: User Page
- **User Dashboard** - portfolio hero pattern

### Phase 4: Extract shared components from Phase 2-3

### Phase 5: Token Detail (cross-app)
- **Token** - requires trading app foundation (useIsMobile, tokens, shell)

### Phase 6: Batch Rollout (3-5 pages per batch, simplest first)

**Batch 6A - Simple pages (1-2 CSS files, minimal layout):**
- categories, glossary, ai-market-analysis, search-engine, roi-calculator

**Batch 6B - Simple social/data pages:**
- social-zone, x-dash, x-intel, lens, zigchain

**Batch 6C - Medium data pages:**
- watchlists (already has mobile-bottom-sheet), heatmaps, bubbles, liquidation-heatmap

**Batch 6D - Medium content pages:**
- news, ai-charts, ai-charts-lab, media-center, ventures

**Batch 6E - Complex data pages:**
- fear-greed (18 jsx, 7 css), tokenized-assets (15 jsx), categories

**Batch 6F - Complex interactive pages:**
- intelligence (30 jsx), traders-corner (32 jsx), economic-calendar (70 jsx, 43 css)

**Batch 6G - Social/graph pages:**
- x-bubbles, x-beta, gm-dashboard

**Batch 6H - User/profile pages:**
- you (64 jsx - largest non-calendar page)

### Phase 7: Full-screen pages
- research-zone (already has mobile-tab-bar)
- monarch-chat
- world (3D - may be desktop-only)
- x-intelligence (social graph - may be desktop-only)

### Phase 8: Standalone pages
- newsroom (own layout, no AppShell)
- website (marketing - may already be responsive)

### Deferred / Desktop-Only Candidates
- world (WebGL 3D globe - poor mobile experience)
- x-intelligence (full-viewport social graph)
- structure-guide (internal dev tool)
- admin (internal)
- pricing (not routed)

---

## E. Mobile Readiness Score

| Status | Count | Percentage |
|--------|-------|------------|
| Has mobile components | 3 (home, watchlists, research-zone) | 7.5% |
| Has @media queries only | 35 | 87.5% |
| No responsive CSS at all | 2 (glossary, lens) | 5% |
| **Total routed pages** | **40** | |

Only the Welcome page (home) has a proper mobile implementation. All other pages rely on basic @media breakpoint adjustments in their desktop CSS files - no dedicated mobile components, no mobile-first layouts, no touch optimization.
