# Monarch Day Mode Plan

## Goal
Add **day mode** to the Monarch AI Chat page (embedded AIAssistant): light surfaces and **dark fonts** for every element when the user toggles Day in the header.

## Scope
- **Route**: `currentPage === 'monarch-ai-chat'` (embedded AIAssistant full-page).
- **Toggle**: Reuse the header Day button; when on Monarch, treat as “welcome” and use `welcomeDayMode`.
- **State**: `welcomeDayMode` in App; Monarch fullpage and AIAssistant receive `dayMode={welcomeDayMode}`.

## Elements (day mode = light bg + dark text)

| # | Element | Selectors | Day styling |
|---|---------|-----------|-------------|
| 1 | Fullpage wrapper | `.monarch-ai-chat-fullpage` | Light gradient bg |
| 2 | Embedded panel | `.ai-panel--embedded` | Light gradient, dark border |
| 3 | Header | `.ai-monarch-header`, Back, logo, title, Logs, Clear | Light bar, dark text/buttons |
| 4 | Hero | `.ai-monarch-brand`, `.ai-monarch-prompt` | Dark text |
| 5 | Messages | `.msg.ai .msg-bubble`, `.msg.user .msg-bubble`, user text | White/light gray bubbles, dark text |
| 6 | Input box | `.ai-monarch-box`, input, placeholder, bar buttons | Light box, dark text & placeholder |
| 7 | Focus pills | `.ai-monarch-focus-label`, `.ai-monarch-pill` | Dark text, light pills |
| 8 | Trending | `.ai-monarch-trending-header`, `.ai-monarch-trend-card` | Dark text, light cards |
| 9 | Bottom | `.ai-monarch-bottom-btn` | Dark text |
| 10 | @ dropdown | `.ai-at-dropdown`, hint, item, symbol/name | Light dropdown, dark text |

## Implementation
1. **App.jsx**: `welcomeActive` includes `currentPage === 'monarch-ai-chat'`; fullpage gets class `day-mode` when `welcomeDayMode`; pass `dayMode={welcomeDayMode}` to AIAssistant on Monarch.
2. **AIAssistant.jsx**: Accept `dayMode`; when embedded, add class `day-mode` to `.ai-assistant--embedded` and `.ai-panel--embedded`.
3. **App.css**: `.monarch-ai-chat-fullpage.day-mode` – light background.
4. **AIAssistant.css**: `.ai-assistant--embedded.day-mode` overrides for all Monarch elements (light bg, dark fonts).
