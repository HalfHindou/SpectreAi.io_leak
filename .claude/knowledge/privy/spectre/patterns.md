---
description: Validated Privy patterns from working Spectre code. Use these as templates when building new Privy-touching features.
---

# Spectre Privy - Validated Patterns

> These patterns are extracted from working Spectre code. They have been tried, debugged, and survived. When adding new Privy features, start from these templates - do not reinvent.

---

## Pattern 1: Conditional PrivyProvider mounting

**Why**: dev machines without `VITE_PRIVY_APP_ID` would crash the SDK if `PrivyProvider` mounted unconditionally. The research app has an additional twist - it must also skip the provider when iframed in showcase mode, because Privy's internal auth iframe enforces its own `frame-ancestors` policy.

**Status**: in code today. Both apps.

**Research app** (`apps/research/src/main.jsx`):
```jsx
// Privy SDK throws if appId is empty - skip provider when unconfigured (dev without keys).
// Also skip when iframed in showcase mode: Privy's internal auth iframe enforces
// its own frame-ancestors policy and refuses to load when grand-nested inside the
// spectreai.io demo iframe, throwing "Frame ancestor is not allowed" in the console.
const isShowcaseEmbed = (() => {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
})()

const appTree = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <HelmetProvider>
        {PRIVY_APP_ID && !isShowcaseEmbed ? (
          <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
            {appTree}
          </PrivyProvider>
        ) : appTree}
      </HelmetProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)
```

**Trading app** (`apps/trading/src/main.jsx`) - simpler, no router, no showcase check:
```jsx
ReactDOM.createRoot(document.getElementById('root')).render(
  <Wrapper>
    {PRIVY_APP_ID ? (
      <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
        {appTree}
      </PrivyProvider>
    ) : appTree}
  </Wrapper>
)
```

**When to use**: any new app or surface that mounts `PrivyProvider`.

**Gotcha**: code that calls Privy hooks must handle the no-provider case. The pattern in `useWalletBalance.js` is the template:
```js
const HAS_PRIVY_APP = Boolean(import.meta.env.VITE_PRIVY_APP_ID)
const PRIVY_AVAILABLE = HAS_PRIVY_APP && !IS_SHOWCASE_EMBED

export function useWalletBalance() {
  if (!PRIVY_AVAILABLE) return { totalUsd: null, loading: false }
  const { wallets } = useWallets()  // safe - we already proved Privy is mounted
  // ...
}
```

The early return runs at module load time (stable for the page lifetime), so the conditional hook call satisfies React's rules-of-hooks.

---

## Pattern 2: Deferring Privy hooks to child components (anti pre-hydration crash)

**Why**: `useWallets`, `useFundWallet`, `useConnectWallet`, `useSendTransaction`, `useLinkAccount` all crash if called before Privy hydrates. The provider becomes "ready" asynchronously after mount.

**Status**: in code today. Both apps' UserDashboard implementations.

**Solution**: defer these hooks to a CHILD component that only mounts when the user navigates to the wallet tab. By that time, Privy is ready.

**Quote from `apps/trading/src/components/UserDashboard/index.jsx`** (lines 135-138):
```js
// Wallet state - embedded wallets from Privy linked accounts.
// Privy hooks (useWallets, useFundWallet, useSendTransaction, useLinkAccount)
// are called in child components (UdWalletSection, UdGeneralSection) which have
// error boundaries. Parent only provides wallet addresses for balance queries.
const [activeChain, setActiveChain] = useState('ethereum')
const linkedAccounts = user?.linkedAccounts || []

const embeddedWallets = linkedAccounts
  .filter((a) => a.type === 'wallet' && a.walletClientType === 'privy')
  .map((w) => ({
    address: w.address,
    chainType: w.chainType || 'ethereum',
    walletClientType: 'privy',
  }))
```

The parent reads `user.linkedAccounts` directly (always-safe object access), and only the child tab that owns the wallet UI calls `useWallets()` / `useSendTransaction()`. Identical pattern in research's `apps/research/src/pages/user-dashboard/index.jsx`.

**Render-tree shape**: `UserDashboard` (parent, reads `user.linkedAccounts` via `usePrivy()`) -> conditionally renders `UdWalletSection` (mounts only when tab active, calls `useWallets` / `useSendTransaction` / `useFundWallet`, wrapped in `PrivyWalletErrorBoundary` class component).

**When to use**: any component reading wallet state must mount AFTER `ready === true`. Treat `useWallets` / `useSendTransaction` / `useFundWallet` as "tab-scoped".

**Anti-pattern**: calling `useWallets()` at the top of `App.jsx`.

---

## Pattern 3: getAccessToken stored in useRef

**Why**: `getAccessToken` from `usePrivy()` returns a NEW function reference each render. Storing it in state or putting it in a `useEffect` deps array causes infinite re-renders.

**Status**: in code today. Both `UserDashboard/index.jsx` files.

**Quote from `apps/trading/src/components/UserDashboard/index.jsx`** (lines 93-123):
```js
const {
  authenticated, login, user, logout: privyLogout, getAccessToken,
} = usePrivy()

// Stable ref for getAccessToken - Privy returns a new function reference
// each render, which would cause useEffect to re-fire infinitely.
const getAccessTokenRef = useRef(getAccessToken)
getAccessTokenRef.current = getAccessToken

// Ensure auth token is set and fetch latest profile from server on mount
useEffect(() => {
  if (!authenticated) return
  let cancelled = false
  async function refreshProfile() {
    try {
      const token = await getAccessTokenRef.current()
      if (cancelled || !token) return
      setAuthToken(token)
      const serverData = await fetchProfile()
      if (cancelled || !serverData?.updatedAt) return
      const mergeServerSettings = useSettingsStore.getState().mergeServerSettings
      mergeServerSettings(serverData)
    } catch {
      // Non-critical
    }
  }
  refreshProfile()
  return () => { cancelled = true }
}, [authenticated])
```

Note three things in the effect:
1. `[authenticated]` deps only - NOT `[authenticated, getAccessToken]`.
2. `let cancelled = false` cleanup pattern (NOT AbortController) for background work.
3. The token is read via `getAccessTokenRef.current()`, not via the closure-captured `getAccessToken`.

**Template** (use verbatim for any new hook that needs the token):
```js
const { getAccessToken } = usePrivy()
const getAccessTokenRef = useRef(getAccessToken)
getAccessTokenRef.current = getAccessToken  // refresh every render, no useEffect needed

// later, inside an effect or callback:
const token = await getAccessTokenRef.current()
```

**Exception**: `useProfileSync.js` puts `getAccessToken` in deps but guards with `if (didSync.current) return` so re-fires are harmless. For any new effect that is NOT idempotent, use the ref pattern.

**When to use**: any time `getAccessToken` is called inside a hook with deps. Same applies to any other Privy function that returns a fresh reference per render.

---

## Pattern 4: Chain detection in swap routing

**Why**: a swap needs to know whether to use Jupiter (Solana) or 0x (EVM). Codex's internal Solana network ID is `1399811149` (not a real BPF loader ID, not a chainId).

**Status**: in code today. `apps/trading/src/hooks/useSwapExecution.js`.

**Quote from `useSwapExecution.js`** (lines 61-66, 100-108):
```js
const embeddedWallets = wallets.filter(w => w.walletClientType === 'privy')
const isSolana = (payToken?.chainId === 'solana') ||
  (mode === 'sell' && token?.networkId === 1399811149)
const wallet = embeddedWallets.find(w =>
  isSolana ? w.chainType === 'solana' : w.chainType === 'ethereum'
)
```

The full networkId-to-chainId mapping is inlined in `getSwapParams`: `1399811149 -> 'solana'`, `56 -> 'bsc'`, `137 -> 'polygon'`, `42161 -> 'arbitrum'`, `8453 -> 'base'`, default `'ethereum'`. Same mapping exported as `networkIdToChainSlug` from `useWalletBalances.js` in both apps.

**When to use**: any function that branches Solana vs EVM logic, or that needs to convert a Codex `networkId` to an internal chain slug.

**Gotcha**: don't use string comparison; the value is numeric. `token.networkId === 1399811149` is correct, `'1399811149'` is not. The full canonical map lives in `.claude/rules/solana-web3.md` section H as `NETWORK_MAP`.

---

## Pattern 5: Wallet filtering by chain type

**Why**: `useWallets()` returns all wallets (embedded ETH + embedded SOL + any externally connected wallet). To find the right wallet for a Solana tx, filter by `walletClientType` and `chainType`.

**Status**: in code today. `useSwapExecution.js`, both UserDashboard files.

**Quote from `useSwapExecution.js`**:
```js
const { wallets } = useWallets()
const embeddedWallets = wallets.filter(w => w.walletClientType === 'privy')
const isSolana = (payToken?.chainId === 'solana') ||
  (mode === 'sell' && token?.networkId === 1399811149)
const wallet = embeddedWallets.find(w =>
  isSolana ? w.chainType === 'solana' : w.chainType === 'ethereum'
)
```

**Quote from UserDashboard (parent reads `user.linkedAccounts`, not `useWallets()`)**:
```js
const linkedAccounts = user?.linkedAccounts || []
const embeddedWallets = linkedAccounts
  .filter((a) => a.type === 'wallet' && a.walletClientType === 'privy')
  .map((w) => ({ address: w.address, chainType: w.chainType || 'ethereum', walletClientType: 'privy' }))

const activeWallet = embeddedWallets.find((w) =>
  activeChain === 'solana' ? w.chainType === 'solana' : w.chainType === 'ethereum'
) || null
```

**Two filtering paths exist**:
- `useWallets()` returns live wallet objects with `.sendTransaction()`, `.getEthereumProvider()`, etc. Use in child components that actually sign or send.
- `user.linkedAccounts` returns metadata only (address, chainType, type). Use in parents that need addresses but should not mount sign-capable hooks yet (see Pattern 2).

**When to use**: any sign / send operation, or any UI that has to pick "the user's Solana wallet" vs "the user's EVM wallet".

---

## Pattern 6: Visibility-aware balance polling

**Why**: polling RPC every 15-30s while tab is hidden wastes RPC credits and battery. The repo's polling helper backs off when the tab is hidden and stops entirely after a 5-minute idle window.

**Status**: in code today. `apps/research/src/hooks/useWalletBalance.js` + `useAdaptivePolling.js`.

**Quote from `useWalletBalance.js`**:
```js
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const POLL_INTERVAL = 30000

// ... inside the hook ...
useEffect(() => {
  mountedRef.current = true
  if (embeddedWallets.length === 0) {
    setTotalUsd(null)
    return
  }
  fetchBalance()
  return () => { mountedRef.current = false }
}, [fetchBalance])

// Adaptive polling: 30s active, 2min hidden, stops after 5min idle
useAdaptivePolling(
  () => fetchBalance(true),
  { interval: POLL_INTERVAL, enabled: embeddedWallets.length > 0 }
)
```

**Quote from `useAdaptivePolling.js`** (the strategy):
```js
function getEffectiveInterval() {
  if (document.hidden) {
    if (hiddenSince) {
      const elapsed = Date.now() - hiddenSince
      if (elapsed > idleTimeout) return null // idle - stop
    }
    return hiddenInterval ?? interval * 4
  }
  if (!isInViewport) return interval * 2
  return interval
}
```

**When to use**: any recurring fetch that's not user-critical when hidden - wallet balance polling, market data refresh, anything driven by `setInterval`. Default `idleTimeout` is 5 minutes; tune via config if the data must continue updating regardless.

**Cross-reference**: see `api-patterns.md` section L ("Visibility-Gated Fetching") for the wider rule about lazy mount vs `enabled` flag patterns.

---

## Pattern 7: Provider caching (walletService.js)

**Why**: creating a new `JsonRpcProvider` or Solana `Connection` per call is expensive. Keep one per chain for the lifetime of the page.

**Status**: in code today. `apps/trading/src/services/walletService.js`.

**Quote from `walletService.js`** (lines 67-84):
```js
// Provider cache to avoid re-creating per call
const providerCache = new Map()

function getEvmProvider(chainId) {
  if (!providerCache.has(chainId)) {
    const chain = CHAINS[chainId]
    if (!chain || chain.type !== 'evm') return null
    providerCache.set(chainId, new ethers.JsonRpcProvider(chain.rpcUrl))
  }
  return providerCache.get(chainId)
}

export function getSolanaConnection() {
  if (!providerCache.has('solana')) {
    providerCache.set('solana', new Connection(CHAINS.solana.rpcUrl, 'confirmed'))
  }
  return providerCache.get('solana')
}
```

**When to use**: any service that needs an ethers/viem provider or Solana `Connection` per chain. Same `Map<chainId, Provider>` pattern, never expires (singletons live for the page lifetime).

**Gotcha**: do NOT instantiate `new Connection(...)` inside a component or per-call. Always go through `getSolanaConnection()` / `getEvmProvider(chainId)`.

---

## Pattern 8: getPrivyDisplayInfo utility

**Why**: user object shape differs per login method (Google has `google.name`, Twitter has `twitter.profilePictureUrl`, wallet has `wallet.address`, email has `email.address`). Hand-rolling this everywhere = inconsistent display.

**Status**: in code today. `apps/research/src/lib/privy-user.js` (research) and `apps/trading/src/lib/privy-user.js` (trading copy).

**Quote from `apps/research/src/lib/privy-user.js`** (full file):
```js
/**
 * Extract display-friendly user info from a Privy user object.
 * Works with all login methods: email, Google, X, Apple, wallet.
 */
export function getPrivyDisplayInfo(user) {
  if (!user) return { name: null, avatar: null, email: null }

  const name =
    user.google?.name ||
    user.twitter?.name ||
    user.apple?.email?.split('@')[0] ||
    user.email?.address?.split('@')[0] ||
    (user.wallet?.address
      ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}`
      : null)

  const email =
    user.email?.address ||
    user.google?.email ||
    user.apple?.email ||
    null

  const avatar =
    user.google?.picture ||
    user.twitter?.profilePictureUrl ||
    null

  return { name, avatar, email }
}
```

Used in both UserDashboards as:
```js
const privyInfo = getPrivyDisplayInfo(user)
const displayProfile = {
  name: profile.name || privyInfo.name || 'User',
  imageUrl: profile.imageUrl || privyInfo.avatar || '',
  email: privyInfo.email || ''
}
```

**When to use**: anywhere user name / avatar / email is displayed. Always layer it under the Zustand-persisted `profile` so users who set a custom display name keep it.

**Gotcha**: priority order matters. Google name beats Twitter name beats email-prefix beats truncated wallet address - this is the documented Spectre default.

---

## Pattern 9: AppErrorBoundary class wrap

**Why**: Privy hooks can throw on unexpected state (network issues, malformed user objects, SDK upgrades). A class component error boundary catches and renders a fallback so the whole app doesn't blank.

**Status**: in code today. `apps/research/src/main.jsx`.

**Quote from `main.jsx`** (lines 188-250, abridged):
```jsx
class AppErrorBoundary extends React.Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) {
    console.error('App failed to render:', error, info)
    try {
      track(Events.ERROR, {
        error_type: 'react_crash',
        error_message: error?.message || String(error),
        page_url: window.location.href,
      })
    } catch (_) { /* analytics should never break the app */ }
  }
  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || String(this.state.error)
      return (
        <div style={{ /* amber fallback panel */ }}>
          <h1>Something went wrong</h1>
          <p>The app failed to load. Try refreshing the page.</p>
          {message && <pre>{message}</pre>}
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
```

Mounted around the entire Privy tree:
```jsx
<AppErrorBoundary>
  <HelmetProvider>
    {PRIVY_APP_ID && !isShowcaseEmbed ? (
      <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
        {appTree}
      </PrivyProvider>
    ) : appTree}
  </HelmetProvider>
</AppErrorBoundary>
```

**When to use**: at the top of any tree that mounts `PrivyProvider`. Required because React error boundaries cannot be implemented with hooks - `getDerivedStateFromError` only exists on class components.

**Related**: see `solana-web3.md` section A for the inner `PrivyWalletErrorBoundary` used around child components that call `useWallets` / `useSendTransaction`. That one renders `this.props.fallback || null` instead of an explicit "Reload" panel.

---

## Pattern 10: Conditional Solana wallet connectors (research only)

**Why**: without `toSolanaWalletConnectors`, the Phantom button doesn't appear in Privy's connect modal. With it (and `shouldAutoConnect: false`), it appears but won't auto-connect (which would surprise users mid-session).

**Status**: research has this. Trading does NOT (see audit-gaps #5).

**Quote from `apps/research/src/lib/privy-config.js`**:
```js
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'

// Required for Phantom, Solflare to appear in connect modal
const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false })

export const privyConfig = {
  loginMethodsAndOrder: {
    primary: ['email', 'google', 'twitter'],
    overflow: ['discord', 'apple', 'wallet'],
  },
  appearance: {
    theme: '#0c0c0e',
    accentColor: '#18181b',
    logo: '/spectre-logo-dark.png',
    landingHeader: 'Sign in to Spectre AI',
    loginMessage: 'Your gateway to institutional-grade crypto intelligence.',
    walletChainType: 'ethereum-and-solana',
    walletList: [
      'detected_ethereum_wallets', 'detected_solana_wallets',
      'metamask', 'phantom', 'coinbase_wallet', 'backpack', 'solflare',
      'okx_wallet', 'safe', 'zerion', 'rainbow', 'wallet_connect',
    ],
    showWalletLoginFirst: false,
  },
  externalWallets: { solana: { connectors: solanaConnectors } },
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
    solana: { createOnLogin: 'users-without-wallets' },
  },
  fundingMethodsAndOrder: { primary: ['card'], overflow: ['exchange'] },
}
```

**Trading's privy-config does NOT include `externalWallets.solana`** - it ships only embedded Solana wallets. The trading config also uses the legacy `loginMethods` array (v1) instead of `loginMethodsAndOrder` (v2). This is documented as intentional in `apps/trading/CLAUDE.md` ("do not upgrade to v2 without testing Solana wallet flow").

**When to use**: any app that wants Phantom / Solflare / Backpack login alongside email. Required imports:
```js
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
```

**Gotcha** (documented in both `privy-config.js` files): only IDs in Privy's `WalletListEntry` union are valid `walletList` entries. Wallets like Trust mobile, Exodus, Rabby, Xverse, Ledger Live, Trezor, Tangem are NOT in the union - they reach users via `detected_ethereum_wallets` / `detected_solana_wallets` (extension auto-discovery) and `wallet_connect` (QR pairing). Adding unsupported IDs causes Privy to silently drop them. Notably `binance` is in the TS union but its asset is missing from the runtime bundle, so it gets dropped too - Binance Web3 users connect via `wallet_connect` instead.

---

## Pattern 11: Debounced quote with AbortController

**Why**: typing in the swap input fires a quote request per keystroke. Without debounce, we slam the aggregator and race-condition the UI (older request resolves last and overwrites newer one).

**Status**: in code today. `apps/trading/src/hooks/useSwapExecution.js`.

**Quote from `useSwapExecution.js`** (lines 22, 131-174, abridged):
```js
const QUOTE_DEBOUNCE_MS = 400

const fetchQuote = useCallback((amount) => {
  // Clear previous debounce and abort in-flight request
  if (debounceRef.current) clearTimeout(debounceRef.current)
  if (abortRef.current) abortRef.current.abort()

  if (!amount || parseFloat(amount) <= 0) {
    setQuote(null); setQuoteError(null); setQuoteLoading(false); return
  }

  setQuoteLoading(true); setQuoteError(null)

  debounceRef.current = setTimeout(async () => {
    const params = getSwapParams(amount)
    if (!params) { setQuoteLoading(false); return }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await getSwapQuote(params)
      if (!controller.signal.aborted) { setQuote(result); setQuoteError(null) }
    } catch (err) {
      if (controller.signal.aborted) return // Silently ignore aborted requests
      console.error('[useSwapExecution] Quote error:', err)
      setQuote(null)
      setQuoteError(err.message || 'Failed to get quote')
    } finally {
      if (!controller.signal.aborted) setQuoteLoading(false)
    }
  }, QUOTE_DEBOUNCE_MS)
}, [getSwapParams])

// Cleanup debounce and abort in-flight requests on unmount
useEffect(() => () => {
  if (debounceRef.current) clearTimeout(debounceRef.current)
  if (abortRef.current) abortRef.current.abort()
}, [])
```

**When to use**: any user-driven async fetch where input changes rapidly - quote requests, search, slippage simulation, fee estimation.

**Three pieces that must all be present**:
1. `clearTimeout(debounceRef.current)` - cancel the pending debounce.
2. `abortRef.current.abort()` - cancel the in-flight HTTP request from the previous keystroke.
3. The `if (!controller.signal.aborted)` guard inside the `try/catch/finally` - prevents the stale response from clobbering state.

The unmount cleanup is also required, otherwise the last in-flight quote can resolve after the component is gone and write to a freed state.

---

## Pattern 12: Slippage clamping

**Why**: a user pasting 9999 in slippage would mean 99.99% slippage tolerance = guaranteed sandwich. Hard-clamp `1` to `500` bps on the client even though the server enforces the same cap.

**Status**: in code today. `apps/trading/src/hooks/useSwapExecution.js`.

**Quote from `useSwapExecution.js`** (lines 24-43):
```js
// Slippage bounds: 0.01% min, 5% max. Server enforces the same cap, but we
// clamp client-side too so the UI never displays a request that will be rejected.
const MAX_SLIPPAGE_BPS = 500
const MIN_SLIPPAGE_BPS = 1

function clampSlippage(input) {
  const raw = Number(input)
  if (!Number.isFinite(raw)) return 50
  return Math.min(Math.max(Math.floor(raw), MIN_SLIPPAGE_BPS), MAX_SLIPPAGE_BPS)
}

export function useSwapExecution({ token, mode, payToken, slippageBps: rawSlippageBps = 50 }) {
  const slippageBps = clampSlippage(rawSlippageBps)
  // ...
}
```

Combine with the stale-quote guard in `doSwap`:
```js
// Guard against stale quote: verify the quote's tokens still match current state
const expectedInput = mode === 'buy' ? (payToken?.address || 'native') : (token?.address || 'native')
const expectedOutput = mode === 'buy' ? (token?.address || 'native') : (payToken?.address || 'native')
if (quote.inputToken !== expectedInput || quote.outputToken !== expectedOutput) {
  setSwapError('Quote expired - enter your amount again')
  setQuote(null)
  return null
}
```

**When to use**: any user-tunable on-chain parameter (slippage, gas multiplier, deadline). Always defend in depth - clamp on the client AND validate on the server.

**Gotcha**: `Number.isFinite(NaN)` is false, so the `Number.isFinite` check catches both `NaN` and `Infinity` from bad inputs and falls back to the 50 bps default.

---

## Pattern 13: AuthGate sessionStorage bypass on localhost

**Why**: the team password gate (NOT Privy) should not block dev work. The bypass check runs at module-level so the gate never even renders for a flash on localhost.

**Status**: in code today. `apps/trading/src/components/AuthGate.jsx`.

**Quote from `AuthGate.jsx`** (lines 10-27, abridged):
```js
const isDevBypass = typeof window !== 'undefined' &&
  (import.meta.env?.DEV === true ||
   isDev ||
   window.location.hostname === '0.0.0.0' ||
   window.location.hostname === '' ||
   window.location.hostname?.includes('localhost') ||
   /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(window.location.hostname || ''))

const AuthGate = ({ children }) => {
  // 2026-05-11 lockdown: sessionStorage no longer the source of truth - real
  // check is an HTTP-only signed cookie verified by /api/auth-gate?action=check.
  const [isAuthenticated, setIsAuthenticated] = useState(() => isDevBypass)
  // ...
}
```

**Why module-level**: if you compute `isDevBypass` inside the component, the gate renders for one frame before the effect runs - users see a flash of the password screen. Module-level evaluation runs before React mounts.

**When to use**: when adding another env-aware gate (admin-only routes, beta flags, kill switches). Pattern is "check at module level to avoid flash of gate screen".

**Cross-reference**: `.claude/rules/coding-standards.md` section N ("Auth Gate") documents this as the canonical sessionStorage-bypass pattern. AuthGate is separate from Privy - a user can be past the AuthGate but not logged into Privy.

---

## Pattern 14: Modal DOM hacks (cautionary - move to config when possible)

**Why**: Privy doesn't expose config for some UX needs. The repo currently auto-clicks "Continue with Email" so the input field shows immediately, and patches Privy's wallet picker so users can scroll past the first 14 wallets.

**Status**: in code today. Both `main.jsx` files have copies. Treat these as cautionary tales - not a template to grow.

**Quote from `apps/research/src/main.jsx`** (lines 107-161, abridged - full code in source file):
```js
// Privy modal UX hooks - auto-expand email input + make wallet list scrollable.
// These mutate Privy's DOM directly because Privy doesn't expose config for
// these tweaks and the nested CSS :has() selectors needed to target Privy's
// wrapping structure are not valid in any browser.
;(() => {
  let clickedFor = null
  const obs = new MutationObserver(() => {
    const modal = document.querySelector('#privy-modal-content')
    if (!modal) { clickedFor = null; return }
    // Hook 1: auto-click email tile once per modal mount so input shows
    if (clickedFor !== modal) {
      const emailTile = [...modal.querySelectorAll('button.login-method-button')]
        .find(b => /Continue with Email/i.test(b.textContent || ''))
      const inputVisible = !!modal.querySelector('input[type="email"]:not([hidden])')
      if (emailTile && !inputVisible) {
        clickedFor = modal
        setTimeout(() => { try { emailTile.click() } catch (_) {} }, 50)
      } else if (inputVisible) { clickedFor = modal }
    }
    // Hook 2: walk up 2 levels from a wallet row to find Privy's react-window
    // L2 wrapper, then apply overflow:auto + max-height. Also cap l1's
    // virtual placeholder (it sets height: 37327px for 612 wallets but only
    // renders ~14, so anything below is a dead zone).
    const row = [...modal.querySelectorAll('button')].find(b =>
      b.offsetWidth > 200 && /MetaMask|Phantom|Coinbase|Wallet/i.test(b.textContent || ''))
    if (!row) return
    const l1 = row.parentElement
    const l2 = l1?.parentElement
    if (!l2 || l2.dataset.spectreScrollFixed === '1') return
    l2.dataset.spectreScrollFixed = '1'
    l2.style.setProperty('max-height', '380px', 'important')
    l2.style.setProperty('overflow-y', 'auto', 'important')
    const fitL1 = () => {
      const realH = [...l1.children].reduce((sum, c) => sum + c.offsetHeight, 0)
      if (realH > 0) l1.style.setProperty('height', realH + 'px', 'important')
    }
    fitL1()
    new MutationObserver(fitL1).observe(l1, { childList: true, subtree: false })
  })
  obs.observe(document.body, { childList: true, subtree: true })
})()
```

Runs at module load (before React mounts), watches `document.body` for `#privy-modal-content`. Nested observers: outer detects the modal, inner re-fits the list height when react-window adds rows after search filtering.

**When to use**: as a LAST resort. Prefer `appearance.walletList` order + Privy dashboard tweaks. Only reach for a MutationObserver hack when:
- The fix can't be expressed in Privy's config surface.
- The fix can't be expressed in CSS (nested `:has()` doesn't reach high enough in Privy's wrapper structure).
- The behavior is necessary for usability (not just polish).

**Migration path**: see `audit-gaps.md` #11. As Privy's config surface grows, these hooks should be retired. Specifically: the email auto-click could become a `loginMethodsAndOrder` arrangement that defaults to the input view, and the wallet scroll fix should disappear once Privy ships virtualized scrolling that respects parent overflow.

**Risk**: if Privy renames `#privy-modal-content` or `button.login-method-button`, both hooks silently stop working. There is no failure mode to alert us. Periodically validate after Privy SDK upgrades.

---

## Cross-references

- For canonical Privy patterns (not Spectre-specific), see numbered KB files in `..`
- For where each pattern is used in the codebase today, see `current-implementation.md`
- For gaps where we deviate from canonical patterns, see `audit-gaps.md`
- For full Solana / EVM wallet rules including swap execution flow, gas reserves, and transaction confirmation, see `.claude/rules/solana-web3.md`
- For visibility-gated fetching wider rule (lazy mount vs `enabled` flag), see `.claude/rules/api-patterns.md` section L
- For state management tiers (Zustand vs Context vs module-level caches), see `.claude/rules/state-management.md`
