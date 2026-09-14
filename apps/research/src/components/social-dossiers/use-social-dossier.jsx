import { createContext, useCallback, useContext, useEffect, useMemo, useState, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
/* Must be imported HERE, not only in the three lazy dossier components below.
   <SocialDossierSlideIn /> is mounted in AppShell on EVERY page, so without this
   the .sd-overlay div renders completely unstyled - position:static, ~26px tall,
   sitting just below the fold. That overflow is what turns <body> into a second
   full-height scroll container next to .page-layout. */
import './social-dossier-shared.css'

/**
 * Shared slide-in dossier system for the social pages
 * (x-bubbles, x-dash, x-intel, x-intelligence, pulse).
 *
 * Provider mounts in App.jsx; <SocialDossierSlideIn /> renders once
 * inside AppShell so any page can call useSocialDossier().openTokenDossier(asset).
 */

const SocialDossierContext = createContext(null)

const TokenDossier = lazy(() => import('./TokenDossier'))
const AuthorDossier = lazy(() => import('./AuthorDossier'))
const SignalDetail = lazy(() => import('./SignalDetail'))

const INITIAL_STATE = { open: false, type: null, payload: null }

export function SocialDossierProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE)

  const close = useCallback(() => {
    setState((prev) => (prev.open ? { ...prev, open: false } : prev))
  }, [])

  const openTokenDossier = useCallback((asset) => {
    if (!asset) return
    setState({ open: true, type: 'token', payload: { asset } })
  }, [])

  const openAuthorDossier = useCallback((handleOrId) => {
    if (!handleOrId) return
    setState({ open: true, type: 'author', payload: { handle: handleOrId } })
  }, [])

  const openSignalDetail = useCallback((signalId) => {
    if (!signalId) return
    setState({ open: true, type: 'signal', payload: { signalId } })
  }, [])

  // Esc closes
  useEffect(() => {
    if (!state.open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.open, close])

  const value = useMemo(() => ({
    open: state.open,
    type: state.type,
    payload: state.payload,
    openTokenDossier,
    openAuthorDossier,
    openSignalDetail,
    close,
  }), [state, openTokenDossier, openAuthorDossier, openSignalDetail, close])

  return (
    <SocialDossierContext.Provider value={value}>
      {children}
    </SocialDossierContext.Provider>
  )
}

export function useSocialDossier() {
  const ctx = useContext(SocialDossierContext)
  if (!ctx) {
    // Soft-degrade: return no-op so consumers don't crash if provider missing
    return {
      open: false,
      type: null,
      payload: null,
      openTokenDossier: () => {},
      openAuthorDossier: () => {},
      openSignalDetail: () => {},
      close: () => {},
    }
  }
  return ctx
}

/**
 * Single instance — mount once near the top of AppShell. Renders an
 * absolutely-positioned right-side slide-in that animates in/out and
 * picks the correct dossier component based on state.type.
 */
export function SocialDossierSlideIn() {
  const ctx = useContext(SocialDossierContext)
  if (!ctx) return null
  const { open, type, payload, close } = ctx

  // We always render the panel container so the exit animation can play.
  // The mounted dossier component is keyed by type+payload to reset state.
  const overlayClass = `sd-overlay${open ? ' is-open' : ''}`
  const panelClass = `sd-panel${open ? ' is-open' : ''}`

  return (
    <div className={overlayClass} aria-hidden={!open}>
      <button
        type="button"
        className="sd-scrim"
        aria-label="Close dossier"
        tabIndex={open ? 0 : -1}
        onClick={close}
      />
      <aside
        className={panelClass}
        role="dialog"
        aria-modal="false"
        aria-label="Social dossier"
      >
        <Suspense fallback={<DossierSkeleton />}>
          {open && type === 'token' && (
            <TokenDossier key={`token-${payload?.asset}`} asset={payload?.asset} onClose={close} />
          )}
          {open && type === 'author' && (
            <AuthorDossier key={`author-${payload?.handle}`} handle={payload?.handle} onClose={close} />
          )}
          {open && type === 'signal' && (
            <SignalDetail key={`signal-${payload?.signalId}`} signalId={payload?.signalId} onClose={close} />
          )}
        </Suspense>
      </aside>
    </div>
  )
}

function DossierSkeleton() {
  return (
    <div className="sd-skel">
      <div className="sd-skel-line animate-shimmer" />
      <div className="sd-skel-line animate-shimmer" style={{ width: '70%' }} />
      <div className="sd-skel-block animate-shimmer" />
      <div className="sd-skel-block animate-shimmer" style={{ width: '85%' }} />
    </div>
  )
}
