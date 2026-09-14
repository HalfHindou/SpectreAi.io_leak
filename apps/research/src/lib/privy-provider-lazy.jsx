/**
 * privy-provider-lazy — the ONLY module that statically imports the Privy SDK
 * and its wallet config. It is loaded exclusively via React.lazy from
 * privy-boundary.jsx, so @privy-io/react-auth + WalletConnect + viem +
 * Coinbase + the Solana connectors (pulled in by privy-config's
 * toSolanaWalletConnectors) all live in THIS lazy chunk, never the entry.
 *
 * It renders the real PrivyProvider in a SIBLING branch with NO app children —
 * only RealPrivyBridge (which pushes the live hook values into SafePrivyContext)
 * and the portaled login flow. The app subtree lives next to this branch, never
 * inside it, so mounting this provider never remounts the app. See
 * use-privy-safe.jsx + privy-boundary.jsx.
 *
 * Buffer ordering (landmine #2 in vite.config.js): main.jsx sets
 * window.Buffer = Buffer at the top of the entry, which evaluates fully before
 * any React.lazy import() can resolve. So by construction this chunk (and the
 * Buffer-touching wallet modules it pulls) always evaluates AFTER the polyfill
 * is in place — no "Buffer is not defined" blank page.
 *
 * privy-modal-hacks moved here too: the MutationObservers only matter once the
 * Privy modal can appear, i.e. after this provider mounts. Keeping the import
 * here keeps the hack module off the entry path; the observers attach the
 * moment the provider mounts — before any login click can surface a modal.
 *
 * RealPrivyBridge also lives here (not in use-privy-safe) because it's the only
 * place the real Privy hooks may be called — those imports must stay off the
 * entry path. It bridges:
 *   - usePrivy()              → SafePrivyContext.real      (usePrivySafe)
 *   - useWallets()            → SafePrivyContext.wallets   (useWalletsSafe)
 *   - useConnectWallet()      ┐
 *   - useFundWallet()         ├ SafePrivyContext.actions   (usePrivyActions)
 *   - useSendTransaction()    │   read by the user-dashboard wallet section
 *   - useLinkAccount()        ┘   + profile section, so neither needs the real
 *                                 provider as an ancestor.
 *
 * The email/OTP login flow (useLoginWithEmail) DOES need the real provider as
 * an ancestor, so BetaAccessFlow is rendered HERE and portaled into the gate's
 * visual slot (registered via SafePrivyContext.gateSlot).
 */
import React, { useRef, Suspense } from 'react'
import { createPortal } from 'react-dom'
import {
  PrivyProvider, usePrivy, useWallets,
  useConnectWallet, useFundWallet, useSendTransaction, useLinkAccount,
} from '@privy-io/react-auth'
import { PRIVY_APP_ID, privyConfig } from '@/lib/privy-config'
import { applyPrivyModalHacks } from '@/lib/privy-modal-hacks'
import { _consumePendingLogin, usePrivyGateFlow } from '@/lib/use-privy-safe'
import lazyWithRetry from '@/lib/lazy-with-retry'
import { triggerChunkRecovery, purgePwaCaches, getMirrorUrl, isOnMirror, CBUST_PARAM } from '@/lib/chunk-recovery'

// BetaAccessFlow holds useLoginWithEmail. Lazy so it splits into its own chunk
// off the provider chunk; rendered inside the provider here and portaled to the
// gate slot.
const BetaAccessFlow = lazyWithRetry(() => import('@/components/auth-gate-flow'))

// Attach the modal DOM observers as soon as this chunk evaluates (which is the
// moment we're about to mount the provider). Idempotent via the module's
// `applied` flag, so re-import is harmless.
applyPrivyModalHacks()

/**
 * Rendered INSIDE the real PrivyProvider. Pushes the live usePrivy() +
 * useWallets() + wallet-action hook results up into SafePrivyContext, and
 * replays a pre-mount login click once ready.
 */
function RealPrivyBridge({ setReal, setWallets, setActions }) {
  const real = usePrivy()
  const { wallets } = useWallets()
  const { connectWallet } = useConnectWallet()
  const { fundWallet } = useFundWallet()
  const { sendTransaction } = useSendTransaction()
  const link = useLinkAccount()

  const lastRealRef = useRef(null)
  const lastWalletsRef = useRef(null)
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

  // Wallet-action callbacks. Privy keeps these stable across renders; push a new
  // actions object (and re-render consumers) only when one reference actually
  // changes. Comparing references avoids both stale pushes and a re-render loop.
  const prev = lastActionsRef.current
  if (
    !prev ||
    prev.connectWallet !== connectWallet ||
    prev.fundWallet !== fundWallet ||
    prev.sendTransaction !== sendTransaction ||
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
      linkGoogle: link.linkGoogle,
      linkTwitter: link.linkTwitter,
      linkApple: link.linkApple,
      linkTelegram: link.linkTelegram,
      linkEmail: link.linkEmail,
    }
    lastActionsRef.current = actions
    queueMicrotask(() => setActions(actions))
  }

  // Login-click race: if the user clicked "Sign in" before the provider
  // mounted, auto-open the Privy modal the moment it's ready.
  if (real?.ready && !loginFiredRef.current && _consumePendingLogin()) {
    loginFiredRef.current = true
    queueMicrotask(() => {
      try { real.login?.() } catch (_) { /* user navigated away */ }
    })
  }

  return null
}

// Self-contained gate shimmer for the brief window between the provider
// mounting and the auth-gate-flow chunk resolving. Mirrors GateLoading's markup
// (auth-gate.css) so there's no blank flash; no i18n here (the chunk is already
// downloading), so the label is plain.
const ESCAPE_BTN_STYLE = {
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.08)',
  color: 'var(--text-primary, #f5f5f7)',
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
}

function hardReloadFresh() {
  purgePwaCaches().finally(() => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set(CBUST_PARAM, String(Date.now()))
      window.location.replace(u.toString())
    } catch (_) { window.location.reload() }
  })
}

function GateFlowEscape() {
  return (
    <div className="auth-gate">
      <div className="auth-loading">
        <p className="auth-loading-text" style={{ maxWidth: 300, textAlign: 'center' }}>
          Sign-in didn't load — this device may be holding an old version of the app.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={ESCAPE_BTN_STYLE} onClick={hardReloadFresh}>Reload fresh</button>
          {!isOnMirror() && (
            <button type="button" style={ESCAPE_BTN_STYLE} onClick={() => { window.location.href = getMirrorUrl() }}>
              Use backup link
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// When the flow chunk REJECTS (stale hash 404, CF asset 403), lazyWithRetry
// exhausts and throws. Without this boundary the error rose to the outer
// PrivyErrorBoundary, which "fails safe" by rendering NOTHING — a permanent
// black screen on the sign-in path. Catch it here and render the escape card.
class GateFlowErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err) {
    // eslint-disable-next-line no-console
    console.warn('[privy] sign-in flow failed to load:', err?.message || err)
  }

  render() {
    if (this.state.failed) return <GateFlowEscape />
    return this.props.children
  }
}

function GateFlowFallback() {
  // Watchdog: this fallback lives for one chunk fetch — sub-second on any
  // healthy client. Still mounted after 10s = wedged (stale SW shell whose
  // chunk hashes are gone, Cloudflare 403ing /assets, a hung fetch that will
  // never reject). Auto purge+reload while the shared recovery budget lasts;
  // once it's spent, surface a visible escape instead of an eternal shimmer —
  // this exact state shipped as a permanent "Loading sign-in…" black screen.
  const [stuck, setStuck] = React.useState(false)
  React.useEffect(() => {
    const tm = setTimeout(() => {
      triggerChunkRecovery('signin-flow-stuck').catch(() => setStuck(true))
    }, 10000)
    return () => clearTimeout(tm)
  }, [])
  if (stuck) return <GateFlowEscape />
  return (
    <div className="auth-gate">
      <div className="auth-loading">
        <div
          className="animate-shimmer"
          aria-hidden
          style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%)', backgroundSize: '200% 100%' }}
        />
        <p className="auth-loading-text">Loading sign-in…</p>
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
    <GateFlowErrorBoundary>
      <Suspense fallback={<GateFlowFallback />}>
        <BetaAccessFlow {...(gateFlow.props || {})} />
      </Suspense>
    </GateFlowErrorBoundary>,
    gateFlow.node
  )
}

export default function LazyPrivyProvider({ setReal, setWallets, setActions }) {
  // If the app id is unset (dev without keys) render nothing — the app runs
  // entirely on the safe stub. Matches the old behaviour where PrivyProvider
  // was skipped entirely.
  if (!PRIVY_APP_ID) return null
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <RealPrivyBridge setReal={setReal} setWallets={setWallets} setActions={setActions} />
      <GateFlowPortal />
    </PrivyProvider>
  )
}
