# Research Zone – Apply White Style to Full Subpage (Day Mode)

## Goal
Apply a consistent **white / soft UI** style across the entire Research Zone subpage in day mode: same design language as the left-panel symbol switcher (neumorphic cards, soft shadows, white/off-white backgrounds, accent #b45309).

---

## Design tokens (day mode)
- **Background (page):** `#f8fafc` → `#f1f5f9` → `#e2e8f0`
- **Cards / panels:** `#fff`, border `rgba(15, 23, 42, 0.1)`
- **Soft shadow (raised):** `6px 6px 12px rgba(0,0,0,0.08)`, `-2px -2px 6px rgba(255,255,255,0.9)`, `inset 1px 1px 0 rgba(255,255,255,0.8)`
- **Text primary:** `#0f172a`
- **Text muted:** `#64748b`, `#475569`
- **Accent:** `#b45309`, `rgba(251, 191, 36, 0.12)` bg
- **Border radius:** 16px–20px for cards/panels

---

## Areas to cover (task list)

| # | Area | What to do |
|---|------|-------------|
| T1 | **Root + center column** | Ensure `.research-zone-lite.day-mode` and `.research-zone-lite-center` use consistent off-white gradient; no dark bleed. |
| T2 | **Chart banner** | Day-mode: white bg, soft neumorphic shadow, rounded 20px, enough padding so it never looks cut. |
| T3 | **Chart wrap** | Day-mode: white bg, soft shadow, border rgba(15,23,42,0.1), border-radius 20px. |
| T4 | **Markets section** | Title bar, filters row, table wrap: white cards with soft shadow; tabs and filter buttons aligned to white style. |
| T5 | **Predictions** | Desc text, table wrap, links: same white style as markets. |
| T6 | **Right column** | Right panel bg gradient; ensure it’s white/off-white. |
| T7 | **Right cards (News, Tweets, About)** | Each card white, soft shadow; news items and tweets use same card style. |
| T8 | **Left column** | Already done (symbol switcher neumorphic); ensure rest of left (cards, categories, etc.) uses same white tokens. |

---

## Task checklist

- [x] T1 Root + center
- [x] T2 Chart banner
- [x] T3 Chart wrap
- [x] T4 Markets section
- [x] T5 Predictions
- [x] T6 Right column
- [x] T7 Right cards (News, Tweets, About)
- [x] T8 Left column (verify / touch up)
