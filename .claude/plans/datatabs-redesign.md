# DataTabs Redesign - Wall Street Terminal meets Apple

**Mode:** Founder / EXPANSION
**Scope:** DataTabs section - container, tab bar, transaction table, holders, filters, all sub-components

---

## F1. Architecture

### Current Layout
```
┌─────────────────────────────────────────────────────┐
│ .data-tabs (glass card, blur(20px), heavy shadow)   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ TABS NAV: [Transactions|Holders|Analytics|...]  │ │  ← pill-style tabs, bg fill
│ │           [refresh] [filter] [expand]            │ │  ← bordered icon buttons
│ ├─────────────────────────────────────────────────┤ │
│ │ TABLE HEADER: Age/Date | Type | Price | Amount  │ │  ← sticky, dark bg
│ ├─────────────────────────────────────────────────┤ │
│ │ ROW: 5m ago  BUY  $2173  1.2K  $2.6K  0xab..  │ │  ← emojis, gradient bg
│ │ ROW: 12m ago SELL $2171  3.4K  $7.3K  0xcd..  │ │  ← colored border-left
│ │ ...                                             │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Target Layout (Terminal aesthetic)
```
┌─────────────────────────────────────────────────────┐
│ .data-tabs (borderless ghost, matching chart above)  │
│                                                      │
│  Transactions  Holders  Analytics  Liq  On-Chain     │  ← ghost text tabs, no bg
│  ──────────                                    [⟳↕] │  ← active = underline
│                                                      │
│  AGE    TYPE   PRICE     AMOUNT   USD      MAKER    │  ← whisper labels, 0.25
│  ─────────────────────────────────────────────────   │
│  5m     BUY    2,173.12  1.2K     $2.6K    0xab..  │  ← clean rows, no emoji
│  12m    SELL   2,171.03  3.4K     $7.3K    0xcd..  │  ← subtle left-accent
│  ...                                                │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Key Architectural Changes

1. **Container matches chart** - kill glass/blur, use `rgba(255,255,255,0.015)` + faint border (same as chart + TokenBanner)

2. **Tab bar goes ghost** - no background fills, no box-shadow on active. Active = brighter text + thin underline indicator. Ghost action icons (0.25 opacity default)

3. **Table header becomes invisible** - whisper-level labels (0.25 opacity), no sticky dark bg, just text floating above data

4. **Transaction rows get terminal treatment** - remove emojis (whale/diamond), remove gradient backgrounds on trades, replace with subtle left-border accent only. Clean mono numbers.

5. **Filter badges simplified** - remove colored gradients/borders. Plain text with dot indicator for active state.

6. **Holders analytics cards** - flatten to transparent surfaces matching chart OHLCV legend style

### File Changes
```
Modified:
  apps/trading/src/components/DataTabs.css    (container, tabs, table, filters, holders - complete restyle)
  apps/trading/src/components/DataTabs.jsx    (remove emoji content from whale/large rows, clean up)
```

---

## F2. Error Map

| Failure | User Impact | Recovery | Observability |
|---------|-------------|----------|---------------|
| Sticky header transparent breaks readability | Text overlaps on scroll | Keep minimal bg on header (0.95 opacity) | Visual |
| Filter dropdowns z-index after container change | Menus appear behind content | Keep z-index: 9999 on dropdowns | Visual |
| Whale row emphasis lost without emoji/glow | Users miss large trades | Keep left-border accent (subtle but present) | Visual |

---

## F3. Security

No changes to inputs, auth, or data flow. Pure CSS/visual restyle.

---

## F4. Edge Cases

- **Empty transaction list**: loading/empty state styling needs to match new aesthetic
- **Filter badges on narrow viewport**: simplified badges take less space (improvement)
- **Expanded mode (full height)**: container bg change affects fullscreen readability - verify
- **Day mode**: all new styles need `body.theme-light` counterparts

---

## F5. Performance

- Zero API changes
- Removing `backdrop-filter: blur(20px)` from container = GPU performance improvement
- Removing gradient backgrounds from trade rows = fewer paint operations
- Net positive performance

---

## F6. Deferred Work

### NOT in scope
1. **Restructuring DataTabs.jsx** (2055 lines) - only removing emojis and cleaning up, not refactoring
2. **AnalyticsTab sub-component** - separate file, separate phase
3. **LiquidationTab sub-component** - separate file, separate phase
4. **Holders chart component** - separate file, separate phase
5. **Adding new tabs or features**
6. **Mobile responsive changes**

---

## Implementation Plan (ordered steps)

### Phase 1: Container + Tab Bar Ghost Treatment
- `.data-tabs`: kill glass/blur/heavy-shadow, match chart container
- `.tabs-nav`: transparent bg, ghost separator
- `.tab-item`: ghost text (0.3 inactive, 0.9 active), no bg fill, active underline
- `.action-icon`: ghost (transparent bg, no border, 0.25 color)
- Day mode overrides

### Phase 2: Transaction Table Terminal Style
- `.data-table th`: whisper labels (0.25 opacity), no dark sticky bg
- `.data-table td`: clean spacing, remove heavy borders
- Trade row highlighting: remove gradient backgrounds, keep subtle left-border only
- Remove whale/large emojis from JSX (::before pseudo-elements in CSS)
- `.type-badge`: flatten (transparent bg, colored text only)
- `.usd-impact-container`: simplify impact bar

### Phase 3: Filters Ghost Treatment
- `.active-filter-badge`: remove colored gradients, plain ghost text + dot
- `.filter-dropdown-menu`: match chart dropdown style (dark glass, blur)
- `.amount-input-group input`: terminal input style
- `.unit-pill`: ghost pills matching chart timeframe style
- Button styles: ghost clear/apply

### Phase 4: Holders Section Terminal Style
- `.holders-section.pro`: transparent cards
- `.stat-card`: flatten to ghost surfaces
- `.distribution-bar-pro`: clean up segment styling
- Maker tooltips: match chart tooltip style
- Maker action buttons: ghost style

### Phase 5: Misc + Day Mode + Build
- `.load-more-btn`: ghost style
- `.bubblemap-container`: match container bg
- Complete day mode pass for all changed elements
- `npm run build:trading`

### Verification Checklist
- [ ] Build passes clean
- [ ] Container matches chart section above
- [ ] Tab switching works with new underline indicator
- [ ] Transaction table renders with clean rows
- [ ] Filter badges display correctly
- [ ] Filter dropdowns position correctly (z-index)
- [ ] Whale/large trades have left-border accent (no emoji)
- [ ] Holders section renders with transparent cards
- [ ] Day mode looks correct
- [ ] Expand/collapse works
- [ ] No console errors
