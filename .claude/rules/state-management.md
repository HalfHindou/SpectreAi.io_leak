---
paths:
  - "apps/*/src/store/**"
  - "apps/*/src/contexts/**"
  - "apps/*/src/hooks/use*.js"
---

# State Management Rules

Three tiers of state, each with a specific tool. Using the wrong tier causes bugs.

---

## A. Zustand - Persisted User Preferences

Zustand stores persist to localStorage. They are the ONLY path for user settings.

### Stores Inventory

| Store | App | localStorage key | version | devtools | partialize |
|-------|-----|------------------|---------|----------|------------|
| `useSettingsStore` | research | `spectre-settings` | 1 | yes | yes (excludes `_sync*`) |
| `useNotificationStore` | research | `spectre-notifications` | 1 | yes | no |
| `useMediaStore` | research | `spectre-media` | 1 | yes | yes (excludes transient UI) |
| `useSettingsStore` | trading | `spectre-settings` | none | no | yes (4 keys only) |

Both apps share the `spectre-settings` localStorage key. The trading store is narrower - only `profile`, `dayMode`, `showMoodWall`, `tokenColoring` are persisted.

### Creating / Modifying Stores

```js
// Always wrap: devtools(persist(...))
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

const useMyStore = create(
  devtools(
    persist(
      (set, get) => ({ /* state + actions */ }),
      {
        name: 'spectre-my-store',  // localStorage key
        version: 1,                // ALWAYS set version for migration path
        partialize: (state) => {   // exclude transient fields
          const { _internalFlag, ...rest } = state
          return rest
        },
      }
    ),
    { name: 'MyStore' }  // devtools label
  )
)
```

### Selector Rules

Always use selectors for granular re-renders. Never destructure the whole store.

```js
// CORRECT - component re-renders only when dayMode changes
const dayMode = useSettingsStore((s) => s.dayMode)

// WRONG - component re-renders on ANY store change
const { dayMode } = useSettingsStore()

// For multiple fields, use individual selectors (not one object selector)
const dayMode = useSettingsStore((s) => s.dayMode)
const language = useSettingsStore((s) => s.language)
```

### Named Selector Exports

For complex derived state, export a named selector from the store file:

```js
// In useNotificationStore.js
export const useUnreadCount = () => useNotificationStore((s) =>
  s.signals.filter(sig => !sig.read).length
)
```

### Server Sync Pattern

Research store has a module-level `subscribe` watcher that debounces (1500ms) and pushes `SYNC_KEYS` to `/api/user/settings`. Trading store does the same but with a narrower key set (`['dayMode', 'profile']` only). The `_syncEnabled` and `_syncPaused` fields control this - never persist them.

### Migration

`apps/research/src/store/migrateOldSettings.js` runs BEFORE `ReactDOM.createRoot()` to migrate 13 old flat `spectre-*` localStorage keys into the Zustand persist format. Called once in `main.jsx`. If adding a new setting that previously existed as a raw localStorage key, add it to this migration map.

---

## B. React Context - Transient & Domain State

Context is for state that needs to flow through the tree but is NOT a user preference.

### Context Inventory

| Context | File | State | Persistence |
|---------|------|-------|-------------|
| `AppStateContext` | `contexts/AppStateContext.jsx` | Selected token, panel collapse, mobile tab | `spectre-selected-token` in localStorage (domain state, not preference) |
| `WatchlistsContext` | `contexts/WatchlistsContext.jsx` | Crypto + stock watchlists, active IDs | `spectre-watchlists`, `spectre-stock-watchlists`, `spectre-active-watchlist-id` in localStorage |
| `I18nCurrencyContext` | `contexts/I18nCurrencyContext.jsx` | Exchange rates, format functions | None (rates fetched on mount, refreshed 15min) |
| `MonarchContext` | `contexts/MonarchContext.jsx` | Chat messages, streaming state | `monarch-chat-history` in localStorage |
| `CopyToastContext` | `contexts/CopyToastContext.jsx` | Toast visibility + message | None (purely transient, 2s auto-clear) |
| `MobilePreviewContext` | `contexts/MobilePreviewContext.js` | Boolean flag only | None |

### When Context Uses localStorage Directly

Watchlists and selected token use `localStorage` directly - NOT through Zustand. This is intentional: they are domain data (which token is selected, which watchlists exist), not user preferences (theme, language). The distinction:

- **Preference** (Zustand): "I prefer dark mode" - same across sessions, synced to server
- **Domain state** (Context + localStorage): "I was looking at ETH" - local to device, no sync

### Context + Zustand Separation Pattern

`I18nCurrencyContext` demonstrates the correct separation: Zustand owns the SETTING (`currency`, `language`), Context owns the COMPUTED STATE (exchange rate, format functions). Context reads from Zustand via selectors and derives everything else.

```js
// I18nCurrencyContext.jsx
const currency = useSettingsStore((s) => s.currency)
const language = useSettingsStore((s) => s.language)
// ... fetches rates, computes fmtPrice/fmtLarge based on currency + rate
```

### Provider Stack Order (Research App)

```
I18nCurrencyProvider
  CopyToastProvider
    AppStateProvider
      MonarchProvider
        WatchlistsProvider
          AuthGate
            Routes -> AppShell -> Pages
```

New contexts go INSIDE `WatchlistsProvider` but OUTSIDE `AuthGate` if they need to function before auth, or inside `AuthGate` if they depend on authenticated state.

### Context `value` Memoization

Always `useMemo` the context value to prevent cascading re-renders:

```js
const value = useMemo(() => ({
  token, selectToken, isLeftPanelCollapsed, toggleLeftPanel,
}), [token, isLeftPanelCollapsed])

return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
```

---

## C. Module-Level Caches - Data That Survives Unmount

Module-scope variables outside React. Used in service files and heavy data hooks.

### Cache Patterns

**Pattern 1 - Object with TTL helper** (preferred for new code):
```js
// fearGreedApi.js - cleanest implementation
const _cache = {}        // { [key]: { data, ts } }
const _inflight = {}     // { [key]: Promise }

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) { delete _cache[key]; return null }
  return entry.data
}
```

**Pattern 2 - Module variables with named timestamps** (legacy, don't introduce new):
```js
// coinGeckoApi.js
let priceCache = {}
let lastFetchTime = 0
const CACHE_TTL = 30_000
```

**Pattern 3 - Singleton instances** (providers, connections):
```js
// walletService.js - never expires, long-lived singletons
const providerCache = new Map()  // chainId -> ethers.JsonRpcProvider or Solana Connection
```

### Cache TTLs by Data Type

| Data | TTL | File | Key format |
|------|-----|------|------------|
| Token prices (CoinGecko) | 30s | `coinGeckoApi.js` | Module variable |
| Top coins list | 5min | `coinGeckoApi.js` | Module variable |
| News feed | 3min | `cryptoNewsApi.js` | Module variable |
| Polymarket events | 3min | `polymarketApi.js` | Module variable |
| Fear & Greed current | 30s | `fearGreedApi.js` | `_cache['current']` |
| Fear & Greed history | 30min | `fearGreedApi.js` | `_cache['history']` |
| Spectre API generic | 5min | `spectreApi.js` | Full URL string |
| Token details (Codex) | 10s | `useCodexData.js` | `Map` keyed by address |
| Trending tokens | 60s | `useCodexData.js` | `Map` keyed by network |
| Wallet balances | 30s | `useWalletBalances.js` | `Map`, max 20 entries |
| RPC providers | Never | `walletService.js` | `Map` keyed by chainId |

### In-Flight Deduplication

Prevents duplicate concurrent requests when multiple components mount simultaneously.

**Standard pattern** (use for new services):
```js
const _inflight = {}

function _deduped(cacheKey, ttlMs, fetchFn) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]  // reuse in-flight promise
  const promise = fetchFn()
    .then(data => { _setCached(cacheKey, data); return data })
    .finally(() => { delete _inflight[cacheKey] })
  _inflight[cacheKey] = promise
  return promise
}
```

Services with dedup: `codexApi.js` (Map), `fearGreedApi.js` (object), `coinGeckoApi.js` (boolean flag + stored Promise).

Services without dedup (rely on server cache): `cryptoNewsApi.js`, `polymarketApi.js`, `stockApi.js`.

---

## D. What NOT to Do

### Known Violations (Trading App)

These exist in the codebase and should not be replicated:

| What | Where | Problem |
|------|-------|---------|
| `chartViewMode` via raw localStorage | `apps/trading/src/App.jsx` | Same key as Zustand in research - two sources of truth |
| `colorMode`/`infoMode` via raw localStorage | `apps/trading/src/components/Header.jsx` | Should be in trading's `useSettingsStore` |
| `chartTimeframe`/`chartType` via raw localStorage | `apps/trading/src/components/TradingChart.jsx` | Duplicates research store keys without coordination |
| `searchHistoryTokens` via raw localStorage | Both apps' `header.jsx` | Both apps duplicate this - candidate for store |
| Mutating `spectre-settings` JSON directly | `apps/trading/src/components/OnboardingPopup.jsx` | Injects `referralCode` by parsing/rewriting Zustand's storage format |

### Rules

- **Never** `localStorage.getItem`/`setItem` for user preferences - use Zustand
- **Never** mutate the `spectre-settings` JSON directly - always go through the store
- **Never** `useState` + `localStorage` for settings that exist in the Zustand store
- **Never** subscribe to the entire store object in a component - use selectors
- **Never** create a new Zustand store without `version` in the persist config
- **Never** put transient UI state (isOpen, isHovered, animation progress) in Zustand

### Cross-Component Communication

The codebase uses NO event emitters, NO `window.*` globals (one exception: `window.__pwaInstallPrompt` for the PWA install event), NO `globalThis` mutations. State flows through: props, context, or Zustand selectors. If you need cross-component communication, use one of those three - never a global event bus.
