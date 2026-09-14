# Spectre Social Intelligence — Master Spec

> A unified suite of 6 pages powered by one X-Dash data engine. Each page has a distinct role; together they form the most actionable social-intelligence layer in crypto.

## A. Page Roles

```
PAGE              ROLE                               THE QUESTION IT ANSWERS
/x-bubbles        Mindshare visualization            "Who owns the conversation?"
/x-dash           Discovery + leaderboard            "What's being talked about NOW?"
/x-intel          Alpha feed (early signals)         "What should I trade NEXT?"
/x-intelligence   Author network graph               "WHO is moving narrative?"
/x-beta           Power-user signal cockpit          "Show me everything I'll decide"
/pulse            Live activity stream               "What's happening RIGHT NOW?"
```

No page duplicates another. Every page links into every other via:
- **Token chip** → opens unified `TokenDossier` slide-in (left side of every page)
- **Author chip** → opens unified `AuthorDossier` slide-in (left side of every page)
- **Signal chip** → opens unified `SignalDetail` slide-in (left side of every page)

These three dossiers are shared components in `apps/research/src/components/social-dossiers/`. Built once, reused everywhere.

## B. Unified Visual Language

Anchor pages: `tokenized-assets/components/rwa-global-hero.jsx`, `traders-corner/widgets/tc-spark.jsx`, `home/components/brief-tab-content.jsx`.

```
LAYOUT      Hero strip (full width) → 3-col widget grid → tape/feed at bottom
TYPE        Heading 0.75rem uppercase + 0.08em letter-spacing
NUMBERS     var(--font-mono) JetBrains Mono — every metric, no exceptions
CARDS       glass-card pattern: linear-gradient white 0.05→0.02, blur 20px, border 0.04
ACCENTS     warm-white #f5f5f7 primary; brass #d0ac63 only for active states
            bull #10B981 / bear #EF4444 only for prices
RADIUS      16px on cards, 8px on inline pills
SPACING     16px between cards, 24px between sections, 72px between page sections
HOVER       translateY(-1px), border brightens to 0.06, shadow-md→shadow-lg
DEAD ZONES  no purple gradients, no neon glow, no bokeh, no animated borders
```

Every page MUST have a hero strip with:
- 1 primary metric (large mono number, e.g. "1,247 mentions / 24h")
- 4-6 mini stat cells (tiny label + mono value + colored delta)
- 1 sparkline or bar chart contextualizing the metric

This mirrors `rwa-global-hero` exactly. No exceptions.

## C. The Six Pages — Detailed UI

### C1. /x-bubbles (already redesigned this session)
**Hero:** total mentions, tokens tracked, sentiment, avg velocity, active signals, last update.
**Body:** 4 view modes (Bubbles, Heatmap, Bars, Mentions). Filter pills at top.
**Sidebar:** TokenDossier (sticky right pane) — metrics + tweets + carriers.
**Status:** done. Dimming sentinel-1 rows already shipped.

### C2. /x-dash — Discovery + Leaderboard
**Hero strip (NEW):** "Conversation snapshot" — total mentions / 24h, KOL count, novelty %, crowding %, top narrative, regime verdict (BREAKOUT / DURABLE / FLASH / FADING).
**Row 1 (3 cols):**
- Trending Now — top 10 by velocity_ratio with sparkline of mention rate
- New Authors — first-time mentioners by token, ranked by follower count
- Whale Alignment — tokens where ≥3 authors with >100K followers mentioned in last 4h
**Row 2 (full):** Leaderboard table — currently exists, keep but trim columns; add 3 new: velocity_ratio chip, durability score, attention quality grade.
**Row 3 (2 cols):** Creator board (existing) + Co-mention network ribbon (NEW — horizontal bar showing top co-mentioned tokens for whatever's selected).
**Token detail modal:** existing `x-dash-full-explore-overlay.jsx` — already built, keep as-is. Just FIX the missing `x-dash-token-detail.jsx` lazy import (delete the import; the overlay covers detail).
**Critical fix:** delete the broken lazy import for `x-dash-token-detail.jsx`. Don't replace it — `x-dash-full-explore-overlay` already handles detail.

### C3. /x-intel — Alpha Feed
**Theme:** "what's emerging that nobody's talking about yet" — early-signal hunting.
**Hero (NEW):** signals fired today, alpha hit-rate (rolling 7d), avg lead time, top alpha grade.
**Row 1 (full):** Live alpha feed — vertical scrolling list of signal events:
  ```
  [12:34] WHALE-ALIGN  $TRIA   3 KOLs (combined 1.2M followers)  +234% mentions/hr
  [12:31] FIRST-MENTION $RIVER  @beincrypto first mention. 128K followers
  [12:28] HANDOFF      $WLFI   sentiment flip -0.42 → -0.18, KOL exit
  ```
  Each row clickable → opens SignalDetail slide-in.
**Row 2 (2 cols):** Top 7-col table (existing) + Velocity scatter (NEW — x=mentions delta, y=price delta — find tokens where mentions spike but price flat = pre-pump).
**Row 3 (full):** Narrative cohorts — clusters of co-mentioned tokens with grouped sparklines.

### C4. /x-intelligence — Author Network Graph
**Keep current full-viewport canvas** but fix:
- Landing state: show default "Crypto Twitter top 50" graph (built from /api/xdash/bootstrap top_authors aggregation), not blank.
- Add hero strip BEFORE the graph: # of authors tracked, KOL tier breakdown (S/A/B/C), avg engagement, network density.
- EntitySidebar: add "tokens this author moves" section with 7d hit-rate.
- New mode toggle: "tokens" vs "authors" vs "categories" — same graph, different node primary type.

### C5. /x-beta — Power-User Signal Cockpit
**Theme:** "everything you need in one screen — pro mode".
Currently 8 tabs is too many. Collapse to **3 tabs + always-visible hero**:
- **Hero strip:** market regime gauge, signal density (signals/hr), top alpha grade, dominant narrative tag.
- **Tab 1 — Radar:** keep existing 4-panel grid (velocity bar, organic scatter, segment donut, alpha picks). Add Pulse meter underneath.
- **Tab 2 — Signals:** keep SignalFeed but rewrite the signal generators to use the NEW backend signal pipeline (real, not deterministic post-hoc threshold checks).
- **Tab 3 — Compare:** existing CompareView — fix Z-score axis normalization.
**Drop:** Table, Bubbles, KOLs, Map, Terminal — these duplicate functionality on other pages. Add cross-links instead.
**Token detail panel:** integrate with shared TokenDossier component.

### C6. /pulse — Live Activity Stream
**STRIP BOKEH.** Delete `pp-pillar-drift`, `pp-border-beam`, conic gradients. Replace with plain glass cards.
**Theme:** "the Bloomberg ticker for crypto twitter" — fast, dense, factual.
**Hero (NEW):** events/min, unique authors active, top narrative, sentiment delta.
**Body:** 3-col split:
- Left col 25%: "Stories" rail simplified — top 12 KOL avatars by 24h activity, no Instagram-style ring rotation.
- Center col 50%: Tape feed — vertical list, latest tweets, each row: avatar + handle + cashtag chip + 2-line text + age + engagement. Auto-scroll, pause on hover. NO masonry.
- Right col 25%: Signal sidebar — last 5 alpha signals (links to /x-intel).

## D. Signal Backend (the monetizable layer)

All under `/api/social-signals/*`. Compute every 60s, cache, serve fast.

### D1. /api/social-signals/feed
Chronological list of fired signals across all tokens. Each signal:
```json
{
  "id": "ws_a8f2",
  "ts": "2026-05-08T12:34:00Z",
  "type": "whale-alignment | first-mention | handoff | velocity-breakout | crowding-shift | text-signature",
  "asset": "TRIA",
  "asset_image": "...",
  "severity": "S | A | B | C",
  "summary": "3 KOLs aligned (1.2M combined followers)",
  "evidence": { "authors": [...], "tweet_ids": [...], "metric_delta": ... },
  "lead_time_hint": "0-2h"
}
```

### D2. /api/social-signals/frontrun-score/:asset
Returns 0-100 score predicting price move in next 4h based on:
- velocity_ratio z-score
- top_authors clean_signal_score
- co-mention network growth
- crowding shift direction
- price-flat-but-mentions-spike divergence
With contributing factors broken out so users see "why".

### D3. /api/social-signals/whale-alignment
Last 4h sliding window. Returns tokens where ≥3 distinct authors with follower_count > 100k mentioned the asset.
Per-token: list of aligned authors, combined reach, time spread.

### D4. /api/social-signals/handoff
Detects "smart money exit" — when sentiment flips negative AND mention count from prior top-5 authors drops >40% week-over-week.

### D5. /api/social-signals/narrative-cohorts
Co-mention graph clustered with simple Louvain / community detection. Returns clusters labeled by their dominant text signatures.

### D6. /api/social-signals/first-mention-radar
For each token, count: new authors (first 24h) vs recent authors (last 7d). Tokens with high new/recent ratio = signal. Surfaces emerging tokens before they're trending.

### Required new tables (server-side persistence):
- `social_signals` — fired signal events (id, type, asset, severity, payload jsonb, ts)
- `author_token_history` — author_id, asset, first_seen_at, last_seen_at, mention_count
- `co_mention_edges` — asset_a, asset_b, weight, last_seen_at

These can be in-memory Maps for now; promote to Postgres later.

## E. Cross-Page Components (build once, reuse 6x)

```
apps/research/src/components/social-dossiers/
  TokenDossier.jsx       — slide-in: chart + metrics + carriers + tweets + signals
  AuthorDossier.jsx      — slide-in: profile + tokens-moved + 7d hit-rate + recent posts
  SignalDetail.jsx       — slide-in: signal evidence + replay-the-trade timeline
  social-dossier-shared.css
```

Three slide-in patterns identical to traders-corner widget detail. State managed via:
```js
useSocialDossier()  // returns { open, type, payload, openTokenDossier(asset), openAuthorDossier(id), openSignalDetail(id), close }
```
Provider mounted in `App.jsx`; slide-in rendered in `AppShell`.

## F. Build order (per page)

1. **Backend signal pipelines** — D1-D6 endpoints. Without these, the new UI has nothing to render.
2. **Shared dossier components** — TokenDossier, AuthorDossier, SignalDetail.
3. **/x-dash** — easiest — strip the broken lazy import, add hero, add 3 new row-1 widgets.
4. **/x-intel** — highest user value — add live alpha feed, velocity scatter.
5. **/x-beta** — collapse 8 tabs → 3, wire to new signal pipeline.
6. **/x-intelligence** — fix landing state, add hero, add author hit-rate.
7. **/pulse** — strip bokeh, rebuild as Bloomberg tape.

## G. Acceptance criteria

For every page after redesign:
- Hard refresh shows real data within 5s (no "Loading…" stalls).
- Hero strip mirrors `rwa-global-hero` pattern (1 primary + 4-6 mini cells).
- All metrics in `var(--font-mono)`. No sans-serif numbers.
- All cards use `glass-card` pattern. No bokeh, no decorative gradients.
- Click any token → opens shared TokenDossier (not a page-specific modal).
- Click any author → opens shared AuthorDossier.
- No sentinel "1" mentions visible (already handled — render as "—").
- Day mode counterpart present in CSS.
- No mock data. Every panel hits a real endpoint.
