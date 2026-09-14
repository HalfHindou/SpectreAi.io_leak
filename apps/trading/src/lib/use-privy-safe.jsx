/**
 * use-privy-safe — deferred Privy access (entry-path safe). Trading app port of
 * apps/research/src/lib/use-privy-safe.jsx, EXTENDED for trading's wider wallet
 * surface (Solana wallets + sign/send, connect/fund, MFA, account linking).
 *
 * WHY: the Privy + WalletConnect + viem + Coinbase + Solana wallet stack
 * (privy-vendor ~2.8MB raw / ~842KB gz) was statically imported by main.jsx and
 * modulepreloaded, gating React mount. It is NOT needed for first paint:
 * - an already-authenticated user (session hint) blows past first paint without
 *   touching a Privy hook; wallet/profile features light up moments later once
 *   Privy hydrates (fast-mounted on the hint — see privy-boundary.jsx).
 * - an unauthenticated user needs Privy only when the login UI shows.
 *
 * ARCHITECTURE (sibling-provider, remount-safe): the app subtree is wrapped from
 * the very start by this stable SafePrivyContext provider, and NEVER by the real
 * PrivyProvider. The real PrivyProvider mounts in a SIBLING branch (see
 * privy-boundary.jsx) that has NO app children — it contains only RealPrivyBridge,
 * which pushes the live usePrivy()/useWallets()/solana-useWallets()/wallet-action
 * hook results up into THIS context. Consumers read this context (via the
 * usePrivySafe / useWalletsSafe / usePrivyActions hooks below), so the app tree
 * never needs the real provider as an ancestor. Because the app subtree's position
 * in the React tree is invariant across the lazy mount, mounting the real provider
 * does NOT unmount/remount the app — boot mount effects run exactly once.
 *
 * The ONE place that genuinely needs the real provider as an ancestor is the
 * email/OTP login flow (useLoginWithEmail). It is rendered INSIDE the sibling
 * provider branch and portaled into its visual slot in the gate via the gate-slot
 * ref registered here.
 *
 * CRITICAL: this file must NOT statically import `@privy-io/react-auth` — it sits
 * on the entry path (imported by the boundary + Header + App + several components).
 * The actual usePrivy()/useWallets()/wallet-action hook calls live in
 * `privy-provider-lazy.jsx`'s RealPrivyBridge, which runs only inside the lazy
 * chunk and pushes its results up into the context defined here.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'

// Module-level mount trigger + pending-login flag. Lives outside React so the
// stub `login()` (and auth-gate) can request a mount before the boundary's state
// setter is wired, and so a login click that races the mount can be replayed
// once the real provider is ready.
let _requestMount = null
let _pendingLogin = false

/**
 * Ask the PrivyBoundary to mount the real provider now. Idempotent.
 * @param {string} [reason] - 'login' records intent to auto-open the Privy login
 *   modal the moment the real provider hydrates (login-click race).
 */
export function requestPrivyMount(reason) {
  if (reason === 'login') _pendingLogin = true
  if (typeof _requestMount === 'function') _requestMount()
}

// Internal — privy-boundary registers its mount setter here.
export function _registerMountTrigger(fn) {
  _requestMount = fn
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
// Money-path stub: a swap/withdraw/deposit/MFA action invoked before the real
// provider mounted. Pull Privy in and throw a recognizable error so the caller's
// existing catch surfaces "connecting wallet, try again" instead of silently
// no-oping (which looked like a broken button). In practice the wallet UI mounts
// late enough (idle + session-hint fast-mount) that these are rarely hit.
const notReady = async () => { requestPrivyMount('login'); throw new Error('wallet_not_ready') }

// Stable empty wallet-actions object. Returned before the real provider mounts;
// matches the shape RealPrivyBridge pushes once ready.
const EMPTY_ACTIONS = Object.freeze({
  connectWallet: () => requestPrivyMount('login'),
  fundWallet: notReady,
  sendTransaction: notReady,
  solanaSignAndSend: notReady,
  solanaSignOnly: notReady,
  showMfaEnrollmentModal: notReady,
  addSigners: notReady,
  removeSigners: notReady,
  linkGoogle: () => requestPrivyMount('login'),
  linkTwitter: () => requestPrivyMount('login'),
  linkApple: () => requestPrivyMount('login'),
  linkTelegram: () => requestPrivyMount('login'),
  linkEmail: () => requestPrivyMount('login'),
})

// Context value: { mounted, real, wallets, solanaWallets, actions, ... }.
// `real` is the live usePrivy() result, `wallets` the live EVM useWallets() array,
// `solanaWallets` the /solana useWallets() array, `actions` the bridged
// wallet-action callbacks — all populated only by the in-provider bridge
// (RealPrivyBridge in privy-provider-lazy.jsx).
const PrivyMountContext = createContext({
  mounted: false,
  real: null,
  wallets: null,
  solanaWallets: null,
  actions: EMPTY_ACTIONS,
})

// Gate-flow lives in its OWN context, NOT in PrivyMountContext. The gate's slot
// registration fires on every keystroke in the team-password form and on the
// initial slot mount. If gateFlow were part of PrivyMountContext, each
// setGateFlow would re-render every PrivyMountContext consumer — including the
// gate shell — which rebuilds its inline flowProps, re-runs the slot-registration
// effect, calls registerGateSlot again → setGateFlow again → an infinite
// "Maximum update depth exceeded" loop that prevents the real PrivyProvider from
// ever committing (black gate, no login UI). Isolating gateFlow here means
// setGateFlow re-renders ONLY GateFlowPortal (provider side), never the gate
// shell. See auth-gate.jsx BetaAccessFlowSlot.
const PrivyGateFlowContext = createContext(null)

// Stub returned before the real provider mounts. Matches every field/fn the eager
// call sites touch: ready, authenticated, user, login, logout, getAccessToken,
// plus the unlink* methods read off usePrivy() by the profile section. login()
// pulls the provider in (and queues auto-open).
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

const EMPTY_WALLETS = Object.freeze([])

/**
 * Provider mounted at the app root (around the whole tree). Owns the `mounted`
 * flag + the live real/wallets/solanaWallets/actions refs, registers the
 * module-level mount trigger, and exposes a gate-slot DOM node so the (portaled)
 * login flow can render into its visual location in the gate.
 *
 * This component is STABLE — it renders for the entire app lifetime and its
 * identity never changes, so flipping its context value from stub→real re-renders
 * consumers WITHOUT remounting anything.
 */
export function PrivyMountProvider({ children }) {
  const [mounted, setMounted] = useState(false)
  const [real, setReal] = useState(null)
  const [wallets, setWallets] = useState(null)
  const [solanaWallets, setSolanaWallets] = useState(null)
  const [actions, setActions] = useState(EMPTY_ACTIONS)

  // The gate's login-flow portal target + the props the flow needs. State (not
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
  const setSolanaWalletsStable = useCallback((v) => setSolanaWallets(v), [])
  const setActionsStable = useCallback((v) => setActions(v || EMPTY_ACTIONS), [])

  // NOTE: gateFlow is deliberately NOT in this value (see PrivyGateFlowContext).
  const value = useMemo(
    () => ({
      mounted, real, wallets, solanaWallets, actions,
      setMounted, setReal: setRealStable, setWallets: setWalletsStable,
      setSolanaWallets: setSolanaWalletsStable, setActions: setActionsStable,
      registerGateSlot,
    }),
    [mounted, real, wallets, solanaWallets, actions, setRealStable, setWalletsStable, setSolanaWalletsStable, setActionsStable, registerGateSlot]
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
 * The drop-in replacement for usePrivy() at the display/token call sites. Returns
 * the real usePrivy() result once the provider is mounted, else a stub. NEVER
 * calls usePrivy() itself (that would throw outside the provider).
 */
export function usePrivySafe() {
  const { mounted, real } = useContext(PrivyMountContext)
  if (mounted && real) return real
  return STUB
}

/**
 * Deferred-safe equivalent of the MAIN (EVM) useWallets(). Returns `{ wallets }`
 * to match the real hook's shape, so call sites migrate by import-alias only.
 */
export function useWalletsSafe() {
  const { mounted, wallets } = useContext(PrivyMountContext)
  return { wallets: mounted && Array.isArray(wallets) ? wallets : EMPTY_WALLETS }
}

/**
 * Deferred-safe equivalent of the /solana useWallets() (ConnectedStandardSolanaWallet[]).
 * Returns `{ wallets }` to match the real hook's shape.
 */
export function useSolanaWalletsSafe() {
  const { mounted, solanaWallets } = useContext(PrivyMountContext)
  return { wallets: mounted && Array.isArray(solanaWallets) ? solanaWallets : EMPTY_WALLETS }
}

/**
 * Deferred-safe equivalent of the wallet-ACTION hooks. Returns the bridged
 * callbacks once the provider mounts, else the safe stub — so the app tree never
 * needs the real provider as an ancestor. The drop-in hooks below wrap this to
 * mirror each real Privy hook's return shape for import-alias migration.
 */
export function usePrivyActions() {
  return useContext(PrivyMountContext).actions || EMPTY_ACTIONS
}

export function useConnectWalletSafe() {
  return { connectWallet: usePrivyActions().connectWallet }
}
export function useFundWalletSafe() {
  return { fundWallet: usePrivyActions().fundWallet }
}
export function useSendTransactionSafe() {
  return { sendTransaction: usePrivyActions().sendTransaction }
}
// Solana signing (from @privy-io/react-auth/solana).
export function useSignAndSendTransactionSafe() {
  return { signAndSendTransaction: usePrivyActions().solanaSignAndSend }
}
export function useSignTransactionSafe() {
  return { signTransaction: usePrivyActions().solanaSignOnly }
}
// Session signers (from @privy-io/react-auth useSigners) - Spectre Agent
// automated-orders consent grant/revoke.
export function useSignersSafe() {
  const a = usePrivyActions()
  return { addSigners: a.addSigners, removeSigners: a.removeSigners }
}
export function useMfaEnrollmentSafe() {
  return { showMfaEnrollmentModal: usePrivyActions().showMfaEnrollmentModal }
}
export function useLinkAccountSafe() {
  const a = usePrivyActions()
  return {
    linkGoogle: a.linkGoogle,
    linkTwitter: a.linkTwitter,
    linkApple: a.linkApple,
    linkTelegram: a.linkTelegram,
    linkEmail: a.linkEmail,
  }
}

/** True once the real provider has mounted (for gate readiness checks). */
export function usePrivyMounted() {
  return useContext(PrivyMountContext).mounted
}

/**
 * Gate-flow portal coordination. The gate calls registerGateSlot(node, props):
 * the slot DOM node + the props the flow needs (onAuthenticated, onBetaClosed,
 * showTeamPwd, setShowTeamPwd, teamPwdForm). The sibling provider reads gateFlow
 * and portals the flow into node with props.
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
 * mount-control context to drive the lazy provider. Not for general consumers.
 */
export function usePrivyMountControls() {
  return useContext(PrivyMountContext)
}
