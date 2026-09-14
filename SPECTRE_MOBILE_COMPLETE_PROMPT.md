# SPECTRE AI — COMPLETE MOBILE SYSTEM
# PWA · iPhone Home Screen · App Store (iOS + Android) · Game-changing UI/UX
# React 18 + Vite 5 · One codebase powers everything

This prompt builds Spectre's full mobile presence from scratch. Three layers:
1. PWA — works in browser, installable to iPhone/Android home screen right now
2. Responsive UI — game-changing mobile design that makes people screenshot it
3. Capacitor — wraps the same build for App Store and Play Store submission

These layers are sequential. Do not skip ahead. Complete each layer fully before moving to the next.

---

## MANDATORY BOOT — read before writing a single line

```
1. SPECTRE_DESIGN_LAW.md          ← absolute visual law. Everything is subordinate to it.
2. CLAUDE.md                      ← agent system, architecture rules, routing.
3. .claude/rules.md               ← Platform Agent (section 5). Your responsive rules.
4. src/index.css                  ← token source of truth.
5. index.html                     ← already has PWA skeleton. You are extending it, not rewriting it.
6. src/components/layouts/AppShell.jsx  ← understand the shell. Mobile nav lives here.
7. src/hooks/useMediaQuery.js     ← already exists. Use it. Do not recreate.
8. src/store/useSettingsStore.js  ← Zustand. All persisted prefs live here.
```

The old app (pre-February pivot) had `mobile-2026.css`, `app-store-ready.css`, and 7 mobile components.
Read those as reference for logic and patterns. Do NOT copy CSS directly — rewrite everything against the new design system.

---

## LAYER 1 — PWA PERFECTION

Goal: someone on iPhone opens the app in Safari, taps "Add to Home Screen," and it launches fullscreen with no browser chrome — indistinguishable from a native app.

### 1a. Install vite-plugin-pwa

```bash
npm install -D vite-plugin-pwa
```

Update `vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Spectre AI',
        short_name: 'Spectre',
        description: 'AI-powered crypto market intelligence',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-72.png',   sizes: '72x72',   type: 'image/png' },
          { src: '/icons/icon-96.png',   sizes: '96x96',   type: 'image/png' },
          { src: '/icons/icon-128.png',  sizes: '128x128', type: 'image/png' },
          { src: '/icons/icon-144.png',  sizes: '144x144', type: 'image/png' },
          { src: '/icons/icon-152.png',  sizes: '152x152', type: 'image/png' },
          { src: '/icons/icon-192.png',  sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-384.png',  sizes: '384x384', type: 'image/png' },
          { src: '/icons/icon-512.png',  sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          {
            name: 'Markets',
            url: '/',
            icons: [{ src: '/icons/shortcut-markets.png', sizes: '96x96' }]
          },
          {
            name: 'Watchlist',
            url: '/watchlists',
            icons: [{ src: '/icons/shortcut-watchlist.png', sizes: '96x96' }]
          },
          {
            name: 'AI Brief',
            url: '/ai-brief',
            icons: [{ src: '/icons/shortcut-brief.png', sizes: '96x96' }]
          }
        ]
      },
      workbox: {
        // Cache strategy: network-first for API calls, cache-first for assets
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            // Cache token logos (CoinGecko images, etc.)
            urlPattern: /^https:\/\/assets\.coingecko\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'token-logos-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 }
            }
          },
          {
            // Network-first for our API proxy — always want fresh price data
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 }
            }
          }
        ],
        // Pre-cache app shell
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Skip waiting so updates activate immediately
        skipWaiting: true,
        clientsClaim: true
      }
    })
  ]
})
```

### 1b. Update index.html

The existing `index.html` has a good skeleton. Extend it — do NOT replace what's already there:

```html
<head>
  <!-- Keep all existing tags. ADD the following: -->

  <!-- iOS standalone detection + splash -->
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <!-- Already exists: verify it says black-translucent -->
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Spectre" />

  <!-- iOS splash screens — critical for App Store feel on iPhone -->
  <!-- Generate these at https://progressier.com/pwa-icons-and-splash-screen-generator -->
  <!-- iPhone 15 Pro Max -->
  <link rel="apple-touch-startup-image"
    media="screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
    href="/splash/splash-1290x2796.png" />
  <!-- iPhone 15 / 15 Pro -->
  <link rel="apple-touch-startup-image"
    media="screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"
    href="/splash/splash-1179x2556.png" />
  <!-- iPhone 14 Plus / 13 Pro Max -->
  <link rel="apple-touch-startup-image"
    media="screen and (device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)"
    href="/splash/splash-1284x2778.png" />
  <!-- iPhone SE 3rd gen -->
  <link rel="apple-touch-startup-image"
    media="screen and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)"
    href="/splash/splash-750x1334.png" />

  <!-- Android PWA -->
  <!-- Already exists: <link rel="manifest" href="/manifest.json" /> -->
  <!-- Already exists: <meta name="theme-color" content="#0a0a0f" /> -->

  <!-- viewport — verify this exact string exists, update if different -->
  <meta name="viewport"
    content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
</head>
```

### 1c. Create manifest.json in /public

```json
{
  "name": "Spectre AI",
  "short_name": "Spectre",
  "description": "AI-powered crypto market intelligence",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "display_override": ["window-controls-overlay", "standalone"],
  "orientation": "portrait-primary",
  "theme_color": "#0a0a0f",
  "background_color": "#0a0a0f",
  "lang": "en",
  "categories": ["finance", "productivity"],
  "icons": [
    { "src": "/icons/icon-72.png",  "sizes": "72x72",  "type": "image/png" },
    { "src": "/icons/icon-96.png",  "sizes": "96x96",  "type": "image/png" },
    { "src": "/icons/icon-128.png", "sizes": "128x128","type": "image/png" },
    { "src": "/icons/icon-144.png", "sizes": "144x144","type": "image/png" },
    { "src": "/icons/icon-152.png", "sizes": "152x152","type": "image/png" },
    { "src": "/icons/icon-192.png", "sizes": "192x192","type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-384.png", "sizes": "384x384","type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512","type": "image/png", "purpose": "any maskable" }
  ],
  "screenshots": [
    {
      "src": "/screenshots/mobile-home.png",
      "sizes": "390x844",
      "type": "image/png",
      "form_factor": "narrow",
      "label": "Home — market intelligence at a glance"
    },
    {
      "src": "/screenshots/mobile-token.png",
      "sizes": "390x844",
      "type": "image/png",
      "form_factor": "narrow",
      "label": "Token analysis with AI brief"
    }
  ],
  "shortcuts": [
    { "name": "Markets",   "url": "/",          "description": "Live market overview" },
    { "name": "Watchlist", "url": "/watchlists","description": "Your tracked tokens" },
    { "name": "AI Brief",  "url": "/ai-brief",  "description": "Daily AI market brief" }
  ],
  "related_applications": [],
  "prefer_related_applications": false
}
```

### 1d. Icon generation

You need icons at every size. Generate a complete icon set:

```
Required files in /public/icons/:
icon-72.png, icon-96.png, icon-128.png, icon-144.png
icon-152.png, icon-192.png, icon-384.png, icon-512.png

Required in /public/:
apple-touch-icon.png (180x180 — already exists, verify it's the correct Spectre mark)
favicon-32x32.png
favicon-16x16.png

Required in /public/splash/:
splash-1290x2796.png  (iPhone 15 Pro Max)
splash-1179x2556.png  (iPhone 15/15 Pro)
splash-1284x2778.png  (iPhone 14 Plus/13 Pro Max)
splash-750x1334.png   (iPhone SE)
```

Icon design rules — follow SPECTRE_DESIGN_LAW.md:
- Background: #0a0a0f (var(--bg-base))
- Mark: Spectre logo centered, white at full opacity
- Maskable icons: logo centered with 20% safe zone padding all sides
- Splash screens: centered Spectre wordmark + tagline on #0a0a0f background, no border radius (the OS handles that)

Generate icons using: `npx pwa-asset-generator public/spectre-logo.svg public/icons --manifest public/manifest.json --index index.html --background "#0a0a0f" --padding "20%" --maskable`

### 1e. PWA install prompt component

Create `src/components/PWAInstallPrompt.jsx`:

```jsx
import { useState, useEffect } from 'react'
import './PWAInstallPrompt.css'

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIOS(ios)

    // Detect if already installed as PWA
    const standalone =
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    setIsStandalone(standalone)

    // Android / Chrome install prompt
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      // Don't show immediately — wait 30 seconds after first visit
      // or show after user performs a meaningful action (search, watchlist add)
      const hasSeenPrompt = localStorage.getItem('spectre-pwa-prompted')
      if (!hasSeenPrompt) {
        setTimeout(() => setShowPrompt(true), 30000)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Don't show if already installed
  if (isStandalone) return null

  // iOS: show manual instruction (no programmatic install API on Safari)
  if (isIOS && !isStandalone && showPrompt) {
    return (
      <div className="pwa-prompt pwa-prompt--ios">
        <div className="pwa-prompt__icon">
          <img src="/apple-touch-icon.png" alt="Spectre" width={48} height={48} />
        </div>
        <div className="pwa-prompt__text">
          <p className="pwa-prompt__title">Add to Home Screen</p>
          <p className="pwa-prompt__sub">
            Tap <span className="pwa-prompt__share-icon">⎆</span> then "Add to Home Screen"
          </p>
        </div>
        <button className="pwa-prompt__dismiss" onClick={() => {
          setShowPrompt(false)
          localStorage.setItem('spectre-pwa-prompted', '1')
        }}>✕</button>
      </div>
    )
  }

  // Android / Chrome: native install
  if (deferredPrompt && showPrompt) {
    return (
      <div className="pwa-prompt pwa-prompt--android">
        <div className="pwa-prompt__icon">
          <img src="/icons/icon-96.png" alt="Spectre" width={48} height={48} />
        </div>
        <div className="pwa-prompt__text">
          <p className="pwa-prompt__title">Install Spectre AI</p>
          <p className="pwa-prompt__sub">Add to home screen for the full experience</p>
        </div>
        <button className="pwa-prompt__cta" onClick={async () => {
          deferredPrompt.prompt()
          const { outcome } = await deferredPrompt.userChoice
          setDeferredPrompt(null)
          setShowPrompt(false)
          localStorage.setItem('spectre-pwa-prompted', '1')
        }}>Install</button>
        <button className="pwa-prompt__dismiss" onClick={() => {
          setShowPrompt(false)
          localStorage.setItem('spectre-pwa-prompted', '1')
        }}>✕</button>
      </div>
    )
  }

  return null
}
```

Create `src/components/PWAInstallPrompt.css` using our design tokens — glass card, bottom of screen, safe area aware, accent CTA button. Reference the glass card pattern from SPECTRE_DESIGN_LAW.md. Dismiss button uses text-muted. Never shows over modals (z-index below modal layer).

Add `<PWAInstallPrompt />` to `AppShell.jsx` — after the main content, before closing tags.

### 1f. Offline page

Create `public/offline.html` — a minimal standalone HTML file (no React build dependencies) that shows when the user is offline:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Spectre AI — Offline</title>
  <style>
    /* Inline all styles — no external deps when offline */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100dvh;
      background: #0a0a0f;
      color: rgba(255,255,255,0.72);
      font-family: 'Inter', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: env(safe-area-inset-top, 20px) 24px env(safe-area-inset-bottom, 20px);
      gap: 16px;
      text-align: center;
    }
    .logo { width: 64px; height: 64px; opacity: 0.8; }
    h1 { font-size: 1.25rem; font-weight: 500; color: rgba(255,255,255,1); }
    p  { font-size: 0.875rem; color: rgba(255,255,255,0.48); max-width: 280px; }
    button {
      margin-top: 8px;
      padding: 12px 24px;
      background: #8B5CF6;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <img class="logo" src="/apple-touch-icon.png" alt="Spectre" />
  <h1>You're offline</h1>
  <p>Markets are still moving. Reconnect to see live intelligence.</p>
  <button onclick="window.location.reload()">Try again</button>
</body>
</html>
```

---

## LAYER 2 — GAME-CHANGING MOBILE UI/UX

Goal: someone picks up their phone, opens Spectre, and their first thought is "this is the most beautiful crypto app I've ever seen." Every screen has a moment that makes them screenshot it.

### 2a. Install skills (additive — no design system conflict)

```bash
npm install -g uipro-cli
uipro init --ai claude
```

```bash
mkdir -p .claude/skills/web-interface-guidelines
curl -L "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/web-design-guidelines/SKILL.md" \
  -o .claude/skills/web-interface-guidelines/SKILL.md

mkdir -p .claude/skills/composition-patterns
curl -L "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/composition-patterns/SKILL.md" \
  -o .claude/skills/composition-patterns/SKILL.md
```

**ui-ux-pro-max usage — ONLY for pattern queries. Never run --design-system. Our tokens are law.**
```bash
# Before building any mobile screen, run the relevant query:
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "crypto fintech dark mobile glassmorphism" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "bottom sheet swipe gesture mobile finance" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "mobile list card token price financial" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "touch micro-interaction press state mobile" --domain ux
```
Ignore all color/font/spacing output. Extract UX patterns only.

### 2b. Create MOBILE_BOOT.md

Create `MOBILE_BOOT.md` at project root:

```markdown
# SPECTRE MOBILE BOOT

> Read AFTER main boot sequence. ONLY when working on mobile/responsive components.
> SPECTRE_DESIGN_LAW.md + CLAUDE.md + .claude/rules.md take precedence in all conflicts.

---

## What already exists — do not recreate

- `src/hooks/useMediaQuery.js` → useIsMobile() (≤768px). Use this.
- `src/store/useSettingsStore.js` → Zustand settings. Never bypass for localStorage.
- `src/components/layouts/AppShell.jsx` → shell. Mobile nav belongs here.
- `src/icons/spectreIcons.jsx` → ONLY icon source. Zero external libraries.

## Mobile CSS file

- Single file: `src/styles/mobile.css`
- Import in `src/main.jsx` AFTER `src/index.css`
- All mobile CSS wraps our CSS variables — never hardcode hex or px values
- Mobile-specific properties inside `@media (max-width: 768px) { :root { ... } }`:

  ```css
  @media (max-width: 768px) {
    :root {
      --m-header-h:       52px;
      --m-bottom-nav-h:   76px;
      --m-blur:           blur(8px);          /* desktop = 20px; reduce for perf */
      --m-radius:         var(--radius-md);    /* 12px mobile default */
      --m-card-padding:   var(--sp-4);         /* 16px */
      --m-row-height:     56px;               /* touch-friendly rows */
    }
  }
  ```

- Kill ALL infinite animations on mobile (re-enable only live pulse dots + skeleton shimmer):
  ```css
  @media (max-width: 768px) {
    *:not(.pulse-dot):not(.skeleton-shimmer) { animation-duration: 0ms !important; }
  }
  ```

## Touch rules

- Minimum tap target: 44×44px (WCAG 2.5.5 + Apple HIG) — use padding expansion
- Bottom nav: 56px height per item
- Token rows / list items: 56px minimum height
- No hover states on mobile — use `:active` with `transform: scale(0.97); transition: 80ms`
- Never implement custom gesture recognizers — use native scroll

## Safe area — mandatory on every mobile layout

```css
.mobile-bottom-nav {
  padding-bottom: env(safe-area-inset-bottom, 0px);
  height: calc(var(--m-bottom-nav-h) + env(safe-area-inset-bottom, 0px));
}
.app-content.has-bottom-nav {
  padding-bottom: calc(var(--m-bottom-nav-h) + env(safe-area-inset-bottom, 0px));
}
.mobile-header {
  padding-top: env(safe-area-inset-top, 0px);
}
```

## Glass on mobile

Same pattern as desktop — blur reduced:
```css
.mobile-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: var(--m-blur);
  -webkit-backdrop-filter: var(--m-blur);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(0,0,0,0.4);
}
```

## Numbers on mobile

ALL prices, percentages, addresses = `font-family: var(--font-mono)` — always.
Use `font-variant-numeric: tabular-nums` to prevent layout shift on updates.

## Performance — mandatory

- Virtualize all lists > 20 items: install `react-window` (`npm install react-window`)
- `React.memo()` on every repeated list item component
- No inline style objects inside render — use CSS classes
- `useCallback()` on all handlers passed as props to list items
- `contain: layout style paint` on card/row containers
- `transform: translateZ(0)` on scroll containers
- All images: `loading="lazy" decoding="async"`

## Day mode — mandatory

Every mobile component needs a day mode counterpart:
```css
.app.app-day-mode .mobile-card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
```

## Mobile Creative Mandate

Every screen must have:
1. One element beautiful at arm's length — a hero price, a chart, a bold stat
2. Live numbers that morph digit-by-digit on update — never hard-swap
3. Token-colored ambient at 0.04 opacity behind hero prices (same as desktop law)
4. Contextual bottom sheets for quick data — not new page navigation
5. Skeleton shimmer on load — NEVER spinners (law already mandates this)
6. At least one micro-interaction that makes the interface feel alive
```

### 2c. Add to CLAUDE.md

Find the boot sequence section in CLAUDE.md. Append (do NOT reorder existing entries):
```
→ Read MOBILE_BOOT.md when working on any mobile, responsive, or <768px component.
```

### 2d. Mobile component system to build

Build these components in order. Each one must be complete before starting the next.
All use `src/icons/spectreIcons.jsx` — zero external icon imports.

#### Component 1: MobileHeader.jsx

```
Location: src/components/MobileHeader.jsx
Height: var(--m-header-h) = 52px + safe area top
Content: Spectre wordmark left · Search icon right · Day mode toggle right
Background: var(--bg-base) with blur — NOT transparent (content scrolls under it)
Border-bottom: 1px solid var(--border-subtle)
Position: fixed top-0, z-index: 100
Detects: isStandalone (PWA mode) — if true, add extra padding-top for status bar
```

#### Component 2: MobileBottomNav.jsx

```
Location: src/components/MobileBottomNav.jsx
Items (5 max): Home · Discover · Watchlist · Markets · More
Height: 76px + env(safe-area-inset-bottom)
Position: fixed bottom-0, z-index: 100
Background: var(--bg-elevated) with glass border-top
Active state: --accent (#8B5CF6) icon tint + full opacity label
Inactive state: icon at 0.48 opacity, label at 0.32 opacity or hidden
Icons: spectreIcons ONLY — one icon per tab, no external libraries
Active indicator: 2px accent line above active tab item (not under it)
Haptic-ready: on tap, dispatch a vibration event if supported:
  navigator.vibrate && navigator.vibrate(8)
```

#### Component 3: MobileBottomSheet.jsx

```
Location: src/components/MobileBottomSheet.jsx
Purpose: contextual detail drawers — token data, filter menus, confirmations
Pattern: slides up from bottom. Draggable handle at top center.
Max height: 85dvh. Min height: 40dvh.
Background: var(--bg-elevated) + glass border-top + top-edge highlight
Backdrop: rgba(0,0,0,0.6) — taps backdrop to dismiss
Animation: transform: translateY(100%) → translateY(0) — 300ms expo easing
Safe area: bottom padding = env(safe-area-inset-bottom, 0px)
Drag handle: 36px × 4px pill, var(--border-strong) color, centered, 16px from top
Props: isOpen, onClose, title (optional), children
```

#### Component 4: TokenRowMobile.jsx

```
Location: src/pages/[page]/components/TokenRowMobile.jsx
Height: 56px (touch-friendly, WCAG compliant)
Layout: [logo 36px] [name + symbol] [price morph] [change badge]
Price update: digit-by-digit morph animation on change — NOT hard swap
  Use CSS @keyframes with translateY(-100%) → 0 per digit on change
Change badge: --bull or --bear background at 0.15 opacity, matching text color
  Green badge → rgba(16,185,129,0.15) bg + #10B981 text
  Red badge → rgba(239,68,68,0.15) bg + #EF4444 text
Press state: background: var(--bg-hover), transform: scale(0.99), 80ms
All numbers: font-family: var(--font-mono), font-variant-numeric: tabular-nums
```

#### Component 5: MobileSearchOverlay.jsx

```
Location: src/components/MobileSearchOverlay.jsx
Trigger: search icon in MobileHeader
Behavior: slides down full-screen from top — covers entire viewport
Background: var(--bg-base) — NOT glass (full opacity for legibility)
Input: full-width, var(--font-body), 48px height, auto-focused on open
Results: TokenRowMobile components, virtualized if > 20 items
Close: ✕ button top-right OR swipe down to dismiss
Animation: transform: translateY(-100%) → 0, 250ms ease-out
```

### 2e. Performance audit before shipping Layer 2

Before declaring Layer 2 complete, run this checklist:

```
□ All token rows are memoized with React.memo()
□ Lists > 20 items use react-window virtualization
□ No inline style objects inside any render method
□ backdrop-filter is blur(8px) max on mobile — not 20px
□ All infinite animations killed on mobile (except pulse + shimmer)
□ All images have loading="lazy" decoding="async"
□ safe-area-inset applies to header, bottom nav, and bottom sheets
□ No hardcoded colors — all use CSS variables
□ All touch targets ≥ 44×44px
□ Day mode styles written for every new mobile component
□ spectreIcons used for all icons — no external library imports
□ Numbers use font-family: var(--font-mono) without exception
```

---

## LAYER 3 — APP STORE + PLAY STORE (CAPACITOR)

Goal: wrap the same Vite build in Capacitor's native shell. Submit to Apple App Store and Google Play Store. One codebase — web, PWA, and both stores.

**Prerequisite:** Layers 1 and 2 must be complete and the app must be working well in browser at <768px before starting this layer. Do not wrap a broken mobile experience.

**Platform requirements for this layer:**
- macOS required for iOS build + Xcode (not possible on Windows/Linux)
- Android Studio required for Android build (works on any OS)
- Apple Developer Account ($99/year) required for App Store submission
- Google Play Developer Account ($25 one-time) for Play Store

### 3a. Install Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init
```

When prompted:
- App name: `Spectre AI`
- App ID: `io.spectreai.app` (reverse domain of spectreai.io)

### 3b. Configure capacitor.config.ts

Create `capacitor.config.ts` at project root:

```typescript
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.spectreai.app',
  appName: 'Spectre AI',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // For development: point to Vite dev server for live reload
    // Comment out for production builds
    // url: 'http://YOUR_LOCAL_IP:5180',
    // cleartext: true,
  },
  ios: {
    contentInset: 'always',   // respects safe areas
    scheme: 'spectreai',
    backgroundColor: '#0a0a0f',
    allowsLinkPreview: false,
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    backgroundColor: '#0a0a0f',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // set true during dev, false before store submission
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0a0a0f',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a0a0f',
      overlaysWebView: true,
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
  },
}

export default config
```

### 3c. Install essential Capacitor plugins

```bash
npm install @capacitor/splash-screen @capacitor/status-bar @capacitor/keyboard
npm install @capacitor/haptics @capacitor/app @capacitor/network
npx cap sync
```

### 3d. Platform detection utility

Create `src/lib/platform.js`:

```js
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Network } from '@capacitor/network'

// Is the app running inside Capacitor native shell?
export const isNative = Capacitor.isNativePlatform()
export const isIOS = Capacitor.getPlatform() === 'ios'
export const isAndroid = Capacitor.getPlatform() === 'android'
export const isWeb = !isNative

// Is it running as a PWA (standalone, not Capacitor)?
export const isPWA =
  !isNative &&
  (window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches)

// Haptic feedback — works native only, no-ops on web
export async function hapticLight() {
  if (!isNative) return
  await Haptics.impact({ style: ImpactStyle.Light })
}
export async function hapticMedium() {
  if (!isNative) return
  await Haptics.impact({ style: ImpactStyle.Medium })
}
export async function hapticSuccess() {
  if (!isNative) return
  await Haptics.notification({ type: 'SUCCESS' })
}

// Network status
export async function getNetworkStatus() {
  const status = await Network.getStatus()
  return status.connected
}
```

### 3e. Gate PWA install prompt in Capacitor context

In `PWAInstallPrompt.jsx`, add this at the top of the component:

```js
import { isNative } from '../lib/platform'
// If running inside Capacitor, never show PWA install prompt
if (isNative) return null
```

### 3f. Add platforms and sync

```bash
npx cap add ios
npx cap add android
npm run build        # builds into /dist
npx cap sync         # copies dist into ios/ and android/
```

### 3g. iOS setup in Xcode

```bash
npx cap open ios
```

In Xcode:
1. Set Bundle Identifier to `io.spectreai.app`
2. Set Version (e.g. `1.0.0`) and Build number (`1`)
3. Sign with your Apple Developer account
4. Set minimum deployment target: iOS 16.0
5. Add splash screen image set in `Assets.xcassets`
6. Enable: `Background Modes` → `Background fetch` + `Remote notifications` if using push
7. Set `UIUserInterfaceStyle` in `Info.plist` to `Dark` (we are dark-first)
8. Add `NSAppTransportSecurity` → `NSAllowsArbitraryLoads: NO` (enforce HTTPS)
9. Add `ITSAppUsesNonExemptEncryption: NO` to `Info.plist` if not using crypto encryption

App Store metadata checklist:
```
□ App name: Spectre AI
□ Subtitle: Crypto Market Intelligence
□ Category: Finance
□ Secondary category: Productivity
□ Description: write fresh copy — no AI accent, founder voice
□ Keywords: crypto, bitcoin, market intelligence, AI, trading, watchlist
□ Screenshots: 6.7" iPhone (required), 6.1" iPhone, iPad if supporting tablet
□ App icon: 1024×1024 PNG, no alpha channel, no rounded corners (App Store adds them)
□ Privacy policy URL: required for App Store
□ Age rating: 4+ (no mature content)
□ Content rights: confirm you own all assets
```

### 3h. Android setup in Android Studio

```bash
npx cap open android
```

In Android Studio:
1. Update `applicationId` in `android/app/build.gradle` to `io.spectreai.app`
2. Set `versionCode` (integer) and `versionName` (e.g. `"1.0.0"`)
3. Generate signed APK/AAB for Play Store: Build → Generate Signed Bundle/APK
4. Minimum SDK: API 26 (Android 8.0)
5. Target SDK: API 34 (Android 14 — current requirement)
6. Add app icon in `android/app/src/main/res/` (mipmap folders)
7. Set `android:theme` to use dark background in `AndroidManifest.xml`

### 3i. Build + sync workflow (run every time you update the app)

```bash
# Development cycle:
npm run build
npx cap sync
npx cap open ios      # then run from Xcode
npx cap open android  # then run from Android Studio

# Or run directly on connected device:
npx cap run ios
npx cap run android
```

---

## LAYER 4 — PERFORMANCE TARGETS

These are minimum standards. Lighthouse mobile score must hit all of these before App Store submission:

```
Lighthouse PWA score:          100/100
Lighthouse Performance mobile: ≥ 90
First Contentful Paint:        < 1.5s
Time to Interactive:           < 3.0s
Largest Contentful Paint:      < 2.5s
Cumulative Layout Shift:       < 0.1
First Input Delay:             < 100ms
Initial JS bundle:             < 200kb gzipped
```

Run Lighthouse audit:
```bash
npx lighthouse https://your-vercel-url.vercel.app --preset=perf --form-factor=mobile --output=html --output-path=./lighthouse-report.html
```

Fix every red/amber item before App Store submission.

---

## LAYER 5 — APP STORE SUBMISSION CHECKLIST

Run through this before submitting to either store:

```
PWA:
□ manifest.json complete with all icon sizes
□ Service worker caching strategy tested (offline mode works)
□ apple-touch-icon.png exists at /public/ (180×180)
□ All splash screens present in /public/splash/
□ PWA install prompt shows correctly on iOS Safari and Android Chrome
□ Lighthouse PWA score = 100

Mobile UI:
□ All 5 components built and tested on real iPhone (not just simulator)
□ Touch targets ≥ 44px verified with Accessibility Inspector
□ safe-area-inset applied correctly on iPhone 15 Pro Max (Dynamic Island)
□ safe-area-inset applied correctly on iPhone SE (no notch)
□ Day mode tested on mobile
□ Skeleton shimmer on all loading states — no spinners anywhere
□ All prices use font-family: var(--font-mono)
□ No external icon libraries imported anywhere

Capacitor:
□ capacitor.config.ts has correct appId and appName
□ webContentsDebuggingEnabled: false in Android config
□ NSAllowsArbitraryLoads: NO in iOS Info.plist
□ All API keys are server-side only — none in the web bundle
□ App runs without console errors on both platforms

iOS App Store:
□ Bundle ID set to io.spectreai.app
□ Version and build number set
□ Apple Developer account signing configured
□ 1024×1024 app icon (no alpha, no rounded corners)
□ Screenshots at required sizes (6.7" minimum)
□ Privacy policy URL in App Store Connect
□ App description written (no AI accent, founder voice)
□ ITSAppUsesNonExemptEncryption: NO in Info.plist
□ Minimum iOS 16.0 deployment target

Google Play:
□ applicationId: io.spectreai.app
□ Signed AAB generated (not APK)
□ Minimum SDK API 26, Target SDK API 34
□ Play Store listing complete with screenshots
□ Privacy policy URL in Play Console
□ Content rating questionnaire completed
□ App access credentials provided if app has auth gate
```

---

## WHAT THIS PROMPT DOES NOT DO

- Does NOT change SPECTRE_DESIGN_LAW.md
- Does NOT change CLAUDE.md (except one appended line)
- Does NOT change .claude/rules.md
- Does NOT change src/index.css
- Does NOT install React Native, Expo, or any native-only tooling
- Does NOT install Tailwind, shadcn/ui, or any UI framework
- Does NOT add external icon libraries (Lucide, Heroicons, FontAwesome, etc.)
- Does NOT generate a new design system
- Does NOT skip Layer 1 or Layer 2 to get to Capacitor faster — complete in sequence
