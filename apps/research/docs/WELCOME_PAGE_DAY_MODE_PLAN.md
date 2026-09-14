# Welcome Page (Landing) – Day Mode Plan

## Scope
Apply day mode to main landing (WelcomePage) when user toggles Day in header. Same pattern as Research Zone: root gets `.day-mode`, CSS overrides per element.

## Toggle
- Day button in Header visible when `currentView === 'welcome'` (landing). Use `welcomeDayMode` state in App; pass to Header and WelcomePage.

## Elements (order)

| # | Element | Selectors | Day styling |
|---|---------|-----------|-------------|
| 1 | Root + bg | .welcome-page, .welcome-bg, .bg-gradient, .bg-grid | Light page bg, subtle grid |
| 2 | Trending + nav | .welcome-section-trending, .welcome-section-title, .welcome-ticker-wrap, .structure-guide-quick-btn | Light section, dark text |
| 3 | Sidebar + widgets | .welcome-sidebar-row, .welcome-widget, .welcome-widget-glass, .welcome-widget-price-card | White/light cards, borders, text |
| 4 | Main content + tabs | .welcome-main, tab area, content panels | Light panels, tabs |
| 5 | Chart overlay, lists, modals | .welcome-chart-overlay-*, lists, popovers | Light overlay, list rows |

## Tasks
1. Add welcomeDayMode state + Day button in header when on welcome; pass dayMode to WelcomePage.
2. Element 1: Root + welcome-bg.
3. Element 2: Trending + structure guide btn.
4. Element 3: Sidebar + widgets (profile, price cards).
5. Element 4: Main content + tabs.
6. Element 5: Chart overlay, lists, polish.
