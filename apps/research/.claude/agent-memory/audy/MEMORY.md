# Code Reviewer Agent Memory

## Day Mode Pattern (confirmed)
- Scoped to page root class: `.{page-class}.day-mode .child-element`
- NEVER use `.app.app-day-mode .aic-*` — `.app.app-day-mode` exists in App.css for shell background only
- The `app-day-mode` class IS on the `.app` element (set in AppShell line 155), but page components must use their OWN root class + `day-mode`
- Class applied in JSX: `className={`{page-class}${dayMode ? ' day-mode' : ''}`}`
- `dayMode` prop flows from `index.jsx` wrapper which reads Zustand: `useSettingsStore((s) => s.dayMode)`
- ai-charts-page is a confirmed bug: uses `.app.app-day-mode` selector but never adds `.day-mode` to `.aic-page` — all 52 day mode rules are dead CSS

## localStorage for Saved/Bookmarks
- Persisted user *preferences* must use Zustand (`useSettingsStore`) — CLAUDE.md rule
- Feature-specific bookmarks (saved media, etc.) currently use raw `localStorage` with a `spectre-media-saved` key
- This is an architecture violation per CLAUDE.md: "never use raw localStorage.getItem/setItem for user preferences"
- However, the CLAUDE.md says "user preferences" specifically — saved bookmark lists are debatable

## Repeated YouTube Video IDs (media-center)
- `YOUTUBE_CATEGORIES` data reuses IDs across categories (PCo4ritKQ3U, bw1piBAOG9s, 6n3pFFPSlW4, 9AAcRuQyL_I)
- Same ID appears with different titles and different channels — data integrity bug
- `FEATURED_VIDEO` id `S6D3SjRU2Hw` also appears in Market Analysis category

## CSS Token Verification
- `--text-disabled` IS defined in index.css (rgba(245,245,247,0.2)) — safe to use
- `--border-subtle`, `--border-default`, `--ease-out`, `--duration-base`, `--duration-fast` all confirmed in index.css
- Hardcoded `#F5A623` (amber/saved star color) acceptable — not in design tokens but used consistently
- `rgba(9,9,11,…)` inline values for overlay gradients are fine — matches `--bg-void: #09090b`

## Twitch iframe parent param
- `parentHost` derived from `window.location.hostname` at render time — correct Twitch embed pattern
- Twitch embeds require `&parent=` query param to match the hosting domain

## isSaved / filterBySearch not memoized
- `isSaved` is a plain inline function (recreated every render) — minor perf concern, acceptable at this scale
- `filterBySearch` is also inline — same note

## Iframe Sandbox Missing
- YouTube and Twitch iframes lack `sandbox` attribute
- YouTube embed: missing `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"`
- This is a security concern worth noting but not critical for trusted embed sources

## Glass Card Recipe (confirmed from index.css)
- Correct glass: `linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.008) 100%)`
- Media center uses `rgba(255,255,255,0.028)` — slightly higher than token `--glass-bg-light: 0.025` but acceptable
- Inset highlight: `inset 0 1px 0 rgba(255,255,255,0.04)` — matches `--shadow-inner` token
