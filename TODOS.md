# Spectre AI - Work Backlog

> Structured TODO format. Updated by `/plan`, `/ship`, and `/notes`.
> Items sorted by priority within each section. Use P0-P3 scale.

---

## Research App

### Express/Vercel Route Parity
- **What:** 60+ Express routes exist only in dev; only 4 serverless functions deployed to prod
- **Why:** Features silently break in production (stocks, news, AI chat, whisper search, etc.)
- **Owner:** Sunny
- **Effort:** L
- **Priority:** P1

### Dead Code Cleanup
- **What:** Remove known dead modules: ChainVolumeBar, AIAssistant (legacy), CURATED_TOKENS constant
- **Why:** Increases bundle size and confuses codebase navigation
- **Owner:** Either
- **Effort:** S
- **Priority:** P3

---

## Trading App

### UserDashboard Update Loop ✓
- **What:** Fix "Maximum update depth exceeded" warning in UserDashboard component
- **Why:** `getAccessToken` from `usePrivy()` returns unstable function reference → useEffect re-triggers infinitely
- **Fix:** Stored `getAccessToken` in a ref, removed from dependency array. Also removed ~150 lines of dead noop handler code from both apps' parent components (child components call Privy hooks directly with error boundaries).
- **Owner:** Gleb
- **Effort:** S
- **Priority:** P2
- **Status:** DONE (2026-03-19)

---

## Server / Infra

### Binance IP Block Resilience
- **What:** Improve triple-fallback reliability for Binance ticker on Vercel
- **Why:** allorigins.win proxy has no SLA; per-symbol fallback is slow for 100+ tokens
- **Owner:** Gleb
- **Effort:** M
- **Priority:** P2

---

## Shared / Design System

### Mobile Design System — Welcome Page Reference
- **What:** Complete mobile responsive Welcome page as the reference implementation, fix 5 known bugs, document all patterns
- **Why:** Need a proven mobile pattern library before expanding to all 28 pages. Known bugs (dead code, missing icons, day mode inconsistencies) must be fixed first.
- **Owner:** Gleb
- **Effort:** M
- **Priority:** P1
- **Tracking:** `.claude/rules/mobile-design-system.md` (patterns), `.claude/learning/mobile-log.md` (build log)
- **Known bugs:** spectreIcons.ai missing, usePullToRefresh dead code, MobileBriefCard unused props, day mode naming inconsistency (2 components), skeleton day mode selector broken

### Mobile Rollout — Remaining Pages (27)
- **What:** Apply mobile design system patterns to all remaining pages after Welcome page is complete
- **Why:** Consistent mobile experience across entire app
- **Owner:** Gleb
- **Effort:** XL
- **Priority:** P2 (blocked by Welcome page completion)
- **Tracking:** Rollout tracker in `.claude/rules/mobile-design-system.md` Section L

---

## Completed

### gstack Pattern Adoption (2026-03-15)
- **What:** Adopted 5 patterns from Garry Tan's gstack: 2-pass review checklist, `/plan`, `/ship`, structured `TODOS.md`, `/notes` routing
- **Why:** Structured workflow for 2-person team - blocking vs informational review findings, automated PR creation, planning modes
- **Owner:** Gleb
- **Effort:** M

### User Dashboard Ambient Background (2026-03-15)
- **What:** Added full-viewport ambient white blur orbs to user dashboards in both research and trading apps
- **Why:** Cinematic Apple-style background matching the platform's design language
- **Owner:** Gleb
- **Effort:** S

### Trading User Dashboard Header Fix (2026-03-15)
- **What:** Fixed account title hidden behind fixed header by increasing padding-top to 120px
- **Why:** Content was obscured by the 74px fixed header
- **Owner:** Gleb
- **Effort:** S
