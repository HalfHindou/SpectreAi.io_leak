/**
 * use-privy-safe — deferred Privy access (entry-path safe).
 *
 * WHY: the Privy + WalletConnect + viem + Coinbase + Solana wallet stack is
 * ~67% of the entry chunk (~1.7MB raw). It is NOT needed for first paint:
 * - an already-authenticated user (spectre-beta / spectre-gate cookie) blows
 *   past the AuthGate without ever touching a Privy hook; profile/wallet
 *   features light up moments later once Privy hydrates.
 * - an unauthenticated user needs Privy only when the login UI shows.
 *
 * ARCHITECTURE (2026-06-11, remount fix): the app subtree is wrapped from the
 * very start by this stable SafePrivyContext provider, and NEVER by the real
 * PrivyProvider. The real PrivyProvider mounts in a SIBLING branch (see
 * privy-boundary.jsx) that has NO app children — it contains only
 * RealPrivyBridge, which pushes the live usePrivy()/useWallets()/wallet-action
 * hook results up into THIS context. Consumers read this context (via the
 * usePrivySafe / useWalletsSafe / usePrivyActions hooks below), so the app tree
 * never needs the real provider as an ancestor. Because the app subtree's
 * position in the React tree is invariant across the lazy mount, mounting the
 * real provider does NOT unmount/remount the app — boot mount effects run
 * exactly once. (The previous design wrapped `children` in <Suspense><Privy>,
 * which flipped the subtree's parent twice → two remounts → 3x boot fetches.)
 *
 * The ONE place that genuinely needs the real provider as an ancestor is the
 * email/OTP login flow (useLoginWithEmail). It is rendered INSIDE the sibling
 * provider branch and portaled into its visual slot in the gate via the
 * gate-slot ref registered here.
 *
 * CRITICAL: this file must NOT statically import `@privy-io/react-auth` — it
 * sits on the entry path (imported by the boundary + header + App + several
 * pages). The actual usePrivy()/useWallets()/wallet-action hook calls live in
 * `privy-provider-lazy.jsx`'s RealPrivyBridge, which runs only inside the lazy
 * chunk and pushes its results up into the context defined here.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react'

// Module-level mount trigger + pending-login flag. Lives outside React so the
// stub `login()` (and auth-gate) can request a mount before the boundary's
// state setter is wired, and so a login click that races the mount can be
// replayed once the real provider is ready.
let _requestMount = null
let _pendingLogin = false

/**
 * Ask the PrivyBoundary to mount the real provider now. Idempotent.
 * @param {string} [reason] - 'login' records intent to auto-open the Privy
 *   login modal the moment the real provider hydrates (login-click race).
 */
export function requestPrivyMount(reason) {
  if (reason === 'login') _pendingLogin = true
  // Explicit request = the user is waiting on Privy. Release the chunk gate so
  // the download starts immediately instead of after the boot-settle window.
  releasePrivyChunk()
  if (typeof _requestMount === 'function') _requestMount()
}

// Internal — privy-boundary registers its mount setter here.
export function _registerMountTrigger(fn) {
  _requestMount = fn
}

// ── Wallet-chunk release gate ────────────────────────────────────────────────
// The Privy provider chunk is ~1.8MB raw, the heaviest asset in the app, and
// nothing above the fold needs it. Gating on the `mounted` FLAG proved too
// leaky (several paths flip it, and a lazy element can render for reasons that
// are hard to enumerate), so the gate lives on the CHUNK itself: the lazy
// factory in privy-boundary awaits this promise before it will `import()`.
// Whatever flips `mounted`, the download cannot land inside the boot window.
// privy-boundary releases it once the app has painted and settled (or on the
// first user interaction); any explicit requestPrivyMount() - the auth gate
// needing the login UI, a Sign-in click - releases it immediately, because
// then the user is actually waiting on it.
let _releasePrivyChunk = null
export const privyChunkGate = new Promise((resolve) => { _releasePrivyChunk = resolve })
export function releasePrivyChunk() {
  if (_releasePrivyChunk) { _releasePrivyChunk(); _releasePrivyChunk = null }
}

// Internal — the real-provider bridge consumes (and clears) the pending-login
// intent once Privy is ready, so a pre-mount login click auto-opens the modal.
export function _consumePendingLogin() {
  const v = _pendingLogin
  _pendingLogin = false
  return v
}

const noop = () => {}
const noopAsync = async () => null

// Stable empty wallet-actions object. Returned before the real provider mounts;
// matches the shape RealPrivyBridge pushes once ready (the wallet-action hooks:
// connectWallet, fundWallet, sendTransaction, link/unlink, solana wallets).
const EMPTY_ACTIONS = Object.freeze({
  connectWallet: noop,
  fundWallet: noopAsync,
  sendTransaction: noopAsync,
  linkGoogle: noop,
  linkTwitter: noop,
  linkApple: noop,
  linkTelegram: noop,
  linkEmail: noop,
})

// Context value: { mounted, real, wallets, actions, gateSlotRef, registerGateSlot }.
// `real` is the live usePrivy() result, `wallets` the live useWallets() array,
// `actions` the bridged wallet-action callbacks — all populated only by the
// in-provider bridge (RealPrivyBridge in privy-provider-lazy.jsx).
const PrivyMountContext = createContext({
  mounted: false,
  real: null,
  wallets: null,
  actions: EMPTY_ACTIONS,
})

// Gate-flow lives in its OWN context, NOT in PrivyMountContext. The gate's
// slot registration (registerGateSlot → setGateFlow) fires on every keystroke
// in the team-password form and on the initial slot mount. If gateFlow were
// part of PrivyMountContext, each setGateFlow would re-render every
// PrivyMountContext consumer — including BetaAccessShell (usePrivyMounted +
// usePrivyGateSlotRegister) — which rebuilds its inline flowProps, re-runs the
// slot-registration effect, calls registerGateSlot again → setGateFlow again →
// an infinite "Maximum update depth exceeded" loop that prevents the real
// PrivyProvider from ever committing (black gate, no login UI). Isolating
// gateFlow here means setGateFlow re-renders ONLY GateFlowPortal (provider
// side), never the gate shell. See auth-gate.jsx BetaAccessFlowSlot.
const PrivyGateFlowContext = createContext(null)

// Stub returned before the real provider mounts. Matches every field/fn the
// eager call sites touch: authenticated, user, login, logout, getAccessToken,
// ready, plus the unlink* methods read off usePrivy() by the profile section.
// login() pulls the provider in (and queues auto-open).
const STUB = Object.freeze({
  ready: false,
  authenticated: false,
  user: null,
  login: () => requestPrivyMount('login'),
  logout: noop,
  getAccessToken: noopAsync,
  unlinkGoogle: noopAsync,
  unlinkTwitter: noopAsync,
  unlinkApple: noopAsync,
  unlinkTelegram: noopAsync,
  unlinkEmail: noopAsync,
})

/**
 * Provider mounted at the app root (around the whole tree). Owns the `mounted`
 * flag + the live real/wallets/actions refs, registers the module-level mount
 * trigger, and exposes a gate-slot DOM node so the (portaled) login flow can
 * render into its visual location in the gate.
 *
 * This component is STABLE — it renders for the entire app lifetime and its
 * identity never changes, so flipping its context value from stub→real
 * re-renders consumers WITHOUT remounting anything.
 */
export function PrivyMountProvider({ children }) {
  const [mounted, setMounted] = useState(false)
  const [real, setReal] = useState(null)
  const [wallets, setWallets] = useState(null)
  const [actions, setActions] = useState(EMPTY_ACTIONS)

  // The gate's login-flow portal target + the props the flow needs. The gate
  // registers its slot DOM node + flow props here; the sibling provider renders
  // BetaAccessFlow into the slot via createPortal with those props. State (not
  // ref) so a re-render fires when the gate mounts/unmounts its slot or updates
  // props. `gateFlow` = { node, props } | null.
  const [gateFlow, setGateFlow] = useState(null)
  const registerGateSlot = useCallback((node, props) => {
    setGateFlow(node ? { node, props } : null)
  }, [])

  // Register the mount trigger once. requestPrivyMount() flips `mounted` true,
  // which causes privy-boundary to lazy-load + render the real PrivyProvider.
  const trigger = useCallback(() => setMounted(true), [])
  if (_requestMount !== trigger) _registerMountTrigger(trigger)

  const setRealStable = useCallback((v) => setReal(v), [])
  const setWalletsStable = useCallback((v) => setWallets(v), [])
  const setActionsStable = useCallback((v) => setActions(v || EMPTY_ACTIONS), [])

  // NOTE: gateFlow is deliberately NOT in this value (see PrivyGateFlowContext
  // above). Keeping it out means a setGateFlow update does not change this
  // value object, so PrivyMountContext consumers (the gate shell, the wallet
  // call sites) do not re-render on slot/prop registration.
  const value = useMemo(
    () => ({
      mounted, real, wallets, actions,
      setMounted, setReal: setRealStable, setWallets: setWalletsStable,
      setActions: setActionsStable, registerGateSlot,
    }),
    [mounted, real, wallets, actions, setRealStable, setWalletsStable, setActionsStable, registerGateSlot]
  )

  return (
    <PrivyMountContext.Provider value={value}>
      <PrivyGateFlowContext.Provider value={gateFlow}>
        {children}
      </PrivyGateFlowContext.Provider>
    </PrivyMountContext.Provider>
  )
}

/**
 * The drop-in replacement for usePrivy() at the display/token call sites.
 * Returns the real usePrivy() result once the provider is mounted, else a
 * stub. NEVER calls usePrivy() itself (that would throw outside the provider).
 */
export function usePrivySafe() {
  const { mounted, real } = useContext(PrivyMountContext)
  if (mounted && real) return real
  return STUB
}

/**
 * Deferred-safe equivalent of useWallets() for the header USD balance + the
 * dashboard wallet section. Returns the live wallet array once the provider
 * mounts, else an empty array. Never calls useWallets() itself.
 */
export function useWalletsSafe() {
  const { mounted, wallets } = useContext(PrivyMountContext)
  return mounted && Array.isArray(wallets) ? wallets : EMPTY_WALLETS
}
const EMPTY_WALLETS = Object.freeze([])

/**
 * Deferred-safe equivalent of the wallet-ACTION hooks (useConnectWallet,
 * useFundWallet, useSendTransaction, useLinkAccount). Returns the bridged
 * callbacks once the provider mounts, else no-ops. The dashboard wallet/profile
 * sections read these instead of calling the SDK hooks directly — so the app
 * tree never needs the real provider as an ancestor.
 */
export function usePrivyActions() {
  return useContext(PrivyMountContext).actions || EMPTY_ACTIONS
}

/** True once the real provider has mounted (for gate readiness checks). */
export function usePrivyMounted() {
  return useContext(PrivyMountContext).mounted
}

/**
 * Gate-flow portal coordination. The gate calls registerGateSlot(node, props):
 * the slot DOM node + the props BetaAccessFlow needs (onAuthenticated,
 * onBetaClosed, showTeamPwd, setShowTeamPwd, teamPwdForm). The sibling provider
 * reads gateFlow and portals BetaAccessFlow into node with props.
 *   - usePrivyGateSlotRegister() → the registrar (gate side)
 *   - usePrivyGateFlow()         → { node, props } | null (provider side)
 */
export function usePrivyGateSlotRegister() {
  return useContext(PrivyMountContext).registerGateSlot
}
export function usePrivyGateFlow() {
  return useContext(PrivyGateFlowContext)
}

/**
 * Internal — the privy-boundary + the in-provider bridge read the full
 * mount-control context ({ mounted, setMounted, setReal, setWallets,
 * setActions, gateFlow }) to drive the lazy provider. Not for general
 * consumers; they should use usePrivySafe() / useWalletsSafe() / usePrivyActions().
 */
export function usePrivyMountControls() {
  return useContext(PrivyMountContext)
}
