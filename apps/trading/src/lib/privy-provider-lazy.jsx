/**
 * privy-provider-lazy — the ONLY module that statically imports the Privy SDK and
 * its wallet config. Loaded exclusively via React.lazy from privy-boundary.jsx, so
 * @privy-io/react-auth (+ /solana) + WalletConnect + viem + Coinbase + the Solana
 * connectors (pulled in by privy-config's toSolanaWalletConnectors) all live in
 * THIS lazy chunk, never the entry. Trading port of
 * apps/research/src/lib/privy-provider-lazy.jsx.
 *
 * It renders the real PrivyProvider in a SIBLING branch with NO app children —
 * only RealPrivyBridge (which pushes the live hook values into SafePrivyContext)
 * and the portaled login flow. The app subtree lives next to this branch, never
 * inside it, so mounting this provider never remounts the app.
 *
 * Buffer ordering: main.jsx's FIRST import is './lib/buffer-polyfill' (its own
 * chunk), which sets window.Buffer before the entry finishes evaluating. This
 * chunk is DYNAMICALLY imported (React.lazy), so it always evaluates AFTER the
 * entry ran the polyfill — no "Buffer is not defined" blank page. See
 * vite.config.js manualChunks.
 *
 * privy-modal-hacks moved here too: the MutationObservers only matter once the
 * Privy modal can appear, i.e. after this provider mounts. Keeping the import here
 * keeps the hack module off the entry path; the observers attach the moment this
 * chunk evaluates — before any login click can surface a modal.
 *
 * RealPrivyBridge bridges (all read via usePrivySafe / useWalletsSafe /
 * usePrivyActions etc. so the app tree never needs the real provider as ancestor):
 *   - usePrivy()                          → SafePrivyContext.real          (usePrivySafe)
 *   - useWallets()          [EVM]         → SafePrivyContext.wallets        (useWalletsSafe)
 *   - useWallets()          [/solana]     → SafePrivyContext.solanaWallets  (useSolanaWalletsSafe)
 *   - useConnectWallet/useFundWallet/useSendTransaction (EVM),
 *     useSignAndSendTransaction/useSignTransaction (/solana),
 *     useMfaEnrollment, useLinkAccount    → SafePrivyContext.actions        (usePrivyActions + drop-ins)
 *
 * The email/OTP login flow (useLoginWithEmail) DOES need the real provider as an
 * ancestor, so BetaAccessFlow is rendered HERE and portaled into the gate's slot.
 */
import React, { useRef, Suspense } from 'react'
import { createPortal } from 'react-dom'
import {
  PrivyProvider, usePrivy, useWallets,
  useConnectWallet, useFundWallet, useSendTransaction, useLinkAccount, useMfaEnrollment,
  useSigners,
} from '@privy-io/react-auth'
import {
  useWallets as useSolanaWallets,
  useSignAndSendTransaction, useSignTransaction,
} from '@privy-io/react-auth/solana'
import { privyConfig } from './privy-config'
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from './privy-app-id'
import { applyPrivyModalHacks } from './privy-modal-hacks'
import { _consumePendingLogin, usePrivyGateFlow } from './use-privy-safe'
import lazyWithRetry from './lazy-with-retry'

// BetaAccessFlow holds useLoginWithEmail. Lazy so it splits into its own chunk off
// the provider chunk; rendered inside the provider here and portaled to the gate slot.
const BetaAccessFlow = lazyWithRetry(() => import('../components/auth-gate-flow'))

// Attach the modal DOM observers as soon as this chunk evaluates (which is the
// moment we're about to mount the provider). Idempotent via the module's `applied`
// flag, so re-import is harmless.
applyPrivyModalHacks()

/**
 * Rendered INSIDE the real PrivyProvider. Pushes the live usePrivy() +
 * useWallets() (EVM + Solana) + wallet-action hook results up into
 * SafePrivyContext, and replays a pre-mount login click once ready.
 */
function RealPrivyBridge({ setReal, setWallets, setSolanaWallets, setActions }) {
  const real = usePrivy()
  const { wallets } = useWallets()
  const { wallets: solanaWallets } = useSolanaWallets()
  const { connectWallet } = useConnectWallet()
  const { fundWallet } = useFundWallet()
  const { sendTransaction } = useSendTransaction()
  const { signAndSendTransaction: solanaSignAndSend } = useSignAndSendTransaction()
  const { signTransaction: solanaSignOnly } = useSignTransaction()
  const { showMfaEnrollmentModal } = useMfaEnrollment()
  const link = useLinkAccount()
  // Session signers (Spectre Agent automated orders) - user-owned wallet
  // grants our policy-scoped server signer; revocable anytime.
  const { addSigners, removeSigners } = useSigners()

  const lastRealRef = useRef(null)
  const lastWalletsRef = useRef(null)
  const lastSolWalletsRef = useRef(null)
  const lastActionsRef = useRef(null)
  const loginFiredRef = useRef(false)

  if (lastRealRef.current !== real) {
    lastRealRef.current = real
    queueMicrotask(() => setReal(real))
  }
  if (lastWalletsRef.current !== wallets) {
    lastWalletsRef.current = wallets
    queueMicrotask(() => setWallets(wallets))
  }
  if (lastSolWalletsRef.current !== solanaWallets) {
    lastSolWalletsRef.current = solanaWallets
    queueMicrotask(() => setSolanaWallets(solanaWallets))
  }

  // Wallet-action callbacks. Privy keeps these stable across renders; push a new
  // actions object (and re-render consumers) only when one reference actually
  // changes. Comparing references avoids both stale pushes and a re-render loop.
  const prev = lastActionsRef.current
  if (
    !prev ||
    prev.connectWallet !== connectWallet ||
    prev.fundWallet !== fundWallet ||
    prev.sendTransaction !== sendTransaction ||
    prev.solanaSignAndSend !== solanaSignAndSend ||
    prev.solanaSignOnly !== solanaSignOnly ||
    prev.showMfaEnrollmentModal !== showMfaEnrollmentModal ||
    prev.addSigners !== addSigners ||
    prev.removeSigners !== removeSigners ||
    prev.linkGoogle !== link.linkGoogle ||
    prev.linkTwitter !== link.linkTwitter ||
    prev.linkApple !== link.linkApple ||
    prev.linkTelegram !== link.linkTelegram ||
    prev.linkEmail !== link.linkEmail
  ) {
    const actions = {
      connectWallet,
      fundWallet,
      sendTransaction,
      solanaSignAndSend,
      solanaSignOnly,
      showMfaEnrollmentModal,
      addSigners,
      removeSigners,
      linkGoogle: link.linkGoogle,
      linkTwitter: link.linkTwitter,
      linkApple: link.linkApple,
      linkTelegram: link.linkTelegram,
      linkEmail: link.linkEmail,
    }
    lastActionsRef.current = actions
    queueMicrotask(() => setActions(actions))
  }

  // Login-click race: if the user clicked "Sign in" before the provider mounted,
  // auto-open the Privy modal the moment it's ready.
  if (real?.ready && !loginFiredRef.current && _consumePendingLogin()) {
    loginFiredRef.current = true
    queueMicrotask(() => {
      try { real.login?.() } catch (_) { /* user navigated away */ }
    })
  }

  return null
}

// Self-contained gate loading state for the brief window between the provider
// mounting and the auth-gate-flow chunk resolving. Mirrors AuthGate.jsx's loading
// markup (.auth-gate > .auth-loading > .spinner) so there's no blank flash.
function GateFlowFallback() {
  return (
    <div className="auth-gate">
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    </div>
  )
}

/**
 * Rendered INSIDE the real PrivyProvider. Portals the email/OTP login flow into
 * the gate's visual slot (a DOM node the gate registers). useLoginWithEmail
 * (inside BetaAccessFlow) is safe here because the real provider is its ancestor.
 * If the gate hasn't registered a slot yet (login UI not needed), renders nothing.
 */
function GateFlowPortal() {
  const gateFlow = usePrivyGateFlow()
  if (!gateFlow || !gateFlow.node) return null
  return createPortal(
    <Suspense fallback={<GateFlowFallback />}>
      <BetaAccessFlow {...(gateFlow.props || {})} />
    </Suspense>,
    gateFlow.node
  )
}

export default function LazyPrivyProvider({ setReal, setWallets, setSolanaWallets, setActions }) {
  // If the app id is unset (dev without keys) render nothing — the app runs
  // entirely on the safe stub. Matches the old behaviour where PrivyProvider was
  // skipped entirely.
  if (!PRIVY_APP_ID) return null
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      {...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {})}
      config={privyConfig}
    >
      <RealPrivyBridge
        setReal={setReal}
        setWallets={setWallets}
        setSolanaWallets={setSolanaWallets}
        setActions={setActions}
      />
      <GateFlowPortal />
    </PrivyProvider>
  )
}
