---
paths:
  - "**/figma*"
  - "packages/spectre-ui/**"
---

# Figma → Spectre Code Mapping Rules

> Used by the Figma MCP to translate designs into Spectre-compatible code.

---

## 1. Token Definitions

### Colors
- **Defined in:** each app's `src/index.css` `:root` block
- **Format:** CSS custom properties (`--bg-void`, `--text-primary`, `--bull`, etc.)
- **No token transformation system** — raw CSS vars consumed directly

| Figma Token | CSS Variable | Value |
|-------------|-------------|-------|
| Background/Void | `--bg-void` | `#09090b` |
| Background/Surface | `--bg-surface` | `#111113` |
| Background/Elevated | `--bg-elevated` | `#18181b` |
| Text/Primary | `--text-primary` | `#f5f5f7` |
| Text/Secondary | `--text-secondary` | `rgba(245,245,247,0.6)` |
| Text/Tertiary | `--text-tertiary` | `rgba(245,245,247,0.5)` |
| Text/Muted | `--text-muted` | `rgba(245,245,247,0.35)` |
| Bull/Green | `--bull` | `#10B981` |
| Bear/Red | `--bear` | `#EF4444` |
| Accent | `--accent` | `#f5f5f7` (warm-white) |
| Border/Default | `--border-default` | `rgba(255,255,255,0.04)` |
| Glass/Background | `--glass-bg` | `rgba(9,9,11,0.88)` |
| Glass/Border | `--glass-border` | `rgba(255,255,255,0.04)` |

### Typography
- **Font stacks defined in:** `src/index.css`
- `--font-display` / `--font-body`: SF Pro Display / system-ui
- `--font-mono`: JetBrains Mono (ALL numbers, prices, percentages in the main app)
- **Exception - website2**: uses `Geist` sans-serif for ALL text including numbers. NEVER use monospace/JetBrains Mono on website2.

### Spacing
- **4px base grid:** `--sp-1` (4px) through `--sp-16` (64px)
- **Section gaps:** `--section-gap: 72px`, `--section-gap-tight: 32px`

### Border Radius
- `--radius-xs: 4px` → `--radius-2xl: 32px`, `--radius-full: 9999px`

### Shadows
- `--shadow-sm` through `--shadow-xl` (layered, realistic depth)
- `--shadow-glow: 0 0 40px rgba(255,255,255,0.08)`
- `--shadow-inner: inset 0 1px 0 rgba(255,255,255,0.04)`

---

## 2. Component Library

### Shared Package: `packages/spectre-ui/`
- **Language:** TypeScript (`.tsx`, `.ts`) — the ONLY TypeScript in the project
- **Components:** Card, Input, Toast, Button, AuthGate, Modal, Badge
- **Storybook:** `npm run dev:storybook` on port 6006
- **Exports:** `packages/spectre-ui/src/index.ts`
- **Tokens:** `packages/spectre-ui/src/tokens/`

### Research App Components: `apps/research/src/components/`
- 66+ components, plain `.jsx` + paired `.css`
- Key components for Figma mapping:
  - **Layout:** `header.jsx`, `navigation-sidebar.jsx`, `layouts/AppShell.jsx`
  - **Charts:** `trading-chart.jsx`, `sector-compare-chart.jsx`, `token-ticker.jsx`
  - **AI:** `monarch/` (10 files), `agent/`, `whisper-results.jsx`
  - **Mobile:** `mobile/` (14 files), `mobile-header.jsx`, `mobile-bottom-nav.jsx`
  - **Modals:** `side-drawer.jsx`, `settings-panel.jsx`, `share-x-modal.jsx`

### Trading App Components: `apps/trading/src/components/`
- Separate component set, uses `lucide-react` icons (NOT spectreIcons)
- TradingView Lightweight Charts, Three.js/R3F

---

## 3. Frameworks & Libraries

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 (functional components + hooks) |
| Build | Vite 5 |
| Styling | Plain CSS (component-paired `.css` files) |
| State | Zustand v5 (research app) |
| Routing | react-router-dom v7 (research app) |
| Animation | Framer Motion |
| Charts | TradingView Lightweight Charts |
| i18n | i18next (research app) |

**CRITICAL:** No TypeScript in app code. Only `.jsx` / `.js`. The `packages/spectre-ui/` is the sole TS exception.

---

## 4. Asset Management

- **Token logos:** CoinGecko CDN `https://assets.coingecko.com/coins/images/{id}/small/{slug}.png`
- **Logo fallback:** Circle with token initial + brand color from `src/constants/tokenColors.js`
- **App logos:** `src/assets/spectre-logo-icon.svg`, `src/assets/spectreLogoGlow.svg`
- **Image proxy:** `/api/img-proxy?url=` for CORS-restricted images
- **No CDN for static assets** — served from Vite/Vercel

---

## 5. Icon System

### Research App — Custom SVG Icons
- **File:** `apps/research/src/icons/spectreIcons.jsx`
- **65+ icons:** star, search, trending, whale, volume, liquidation, portfolio, grid, list, aiAnalysis, news, heatmap, sector, mindshare, calendar, flows, discover, settings, dashboard, monarch, monarchChat, close, etc.
- **Style:** Heroicons-like (strokeWidth 1.5, rounded linecap/linejoin)
- **Usage:** `import { spectreIcons } from '@/icons/spectreIcons'` then `spectreIcons.iconName`
- **Convention:** camelCase keys matching feature names

### Trading App — Lucide React
- **Package:** `lucide-react` (^0.563.0)
- **Usage:** `import { IconName } from 'lucide-react'`

**RULE:** Never mix icon systems across apps.

---

## 6. Styling Approach

### Methodology
- **Plain CSS** with component-paired stylesheets
- `Component.jsx` + `Component.css` (same directory)
- **NO CSS Modules, NO Styled Components, NO Tailwind**
- CSS custom properties for all design tokens

### Global Styles
- Each app has `src/index.css` with `:root` variables and global resets
- Glass card patterns, animations, scrollbar styles are global

### Responsive Design
- **Desktop:** 3-column (sidebar + content + sidebar)
- **Tablet (~768px):** 2-column, collapse right sidebar
- **Mobile (~480px):** single column
- Media queries in component CSS files
- Mobile-specific components in `src/components/mobile/`

### Key CSS Patterns

**Glass Card (most common surface):**
```css
background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
backdrop-filter: blur(20px);
border: 1px solid var(--glass-border);
border-radius: var(--radius-lg);
box-shadow: var(--shadow-inner), var(--shadow-md);
```

**Hover pattern (every interactive element):**
```css
transition: all var(--duration-base) var(--ease-out);
/* hover: translateY(-1px), border brightens, shadow upgrades */
```

**Skeleton loaders (NEVER spinners):**
```css
.animate-shimmer { /* gradient slide animation, 2s infinite */ }
```

### Day Mode
- Every dark style needs `.app.app-day-mode` counterpart
- Day text: `#0f172a` (primary), `#475569` (secondary)
- Day bg: `#ffffff` (cards), `#f8f9fa` (page)

---

## 7. Project Structure

```
Spectre App Main/
├── apps/
│   ├── research/              ← Main crypto dashboard
│   │   ├── src/
│   │   │   ├── components/    ← 66+ React components
│   │   │   ├── hooks/         ← Custom hooks (useCodexData, etc.)
│   │   │   ├── icons/         ← spectreIcons.jsx (65+ SVGs)
│   │   │   ├── services/      ← API service layers
│   │   │   ├── constants/     ← tokenColors, majorTokens
│   │   │   ├── stores/        ← Zustand stores
│   │   │   ├── pages/         ← Route pages
│   │   │   ├── assets/        ← SVGs, logos
│   │   │   └── index.css      ← Design tokens (source of truth)
│   │   └── vite.config.js
│   ├── trading/               ← Trading platform (separate design)
│   ├── war-room/              ← OpenClaw agent dashboard
│   └── war-room-game/
├── packages/
│   ├── spectre-ui/            ← Shared component lib (TypeScript)
│   │   └── src/
│   │       ├── components/    ← Card, Input, Toast, Button, Modal, Badge
│   │       ├── tokens/        ← Design tokens
│   │       └── styles/
│   ├── server/                ← Express API (port 3001)
│   ├── chrome-extension/
│   └── telegram-bot/
├── .env                       ← API keys (root level)
└── package.json               ← Workspace root
```

### Import Aliases
- **Research app:** `@` → `src/` (e.g., `import Foo from '@/components/Foo'`)
- **Trading app:** relative imports only (no alias)

---

## 8. Figma-to-Code Translation Rules

When converting Figma designs to Spectre code:

1. **Always use CSS custom properties** — never hardcode hex values
2. **Numbers/prices → `var(--font-mono)`** — except website2 which uses `Geist` for everything
3. **Cards → glass-card pattern** — use the exact gradient + blur + border recipe
4. **Loading states → shimmer skeletons** — never spinners or "Loading..." text
5. **Icons → `spectreIcons` (research)** or `lucide-react` (trading)
6. **Colors → only from `:root` tokens** — `--bull`/`--bear` for price only, `--accent` is warm-white
7. **Purple (`--violet`) → EUPHORIA state ONLY** — never as UI accent
8. **Hover → always `translateY` + border brighten + shadow upgrade**
9. **Output `.jsx` + `.css` files** — never TypeScript in apps, never inline styles for tokens
10. **Responsive → mobile breakpoint at 480px, tablet at 768px**
