import { lazy, createElement, useLayoutEffect } from 'react'
import { isChunkLoadError, triggerChunkRecovery } from './chunk-recovery'

/**
 * React.lazy wrapper with three-tier stale-deploy recovery PLUS boot-skeleton
 * handoff.
 *
 * Recovery sequence:
 *   1. First attempt — normal dynamic import.
 *   2. On chunk-load failure, retry the same URL after 250ms. Recovers the
 *      Vite-dev "deps re-optimize" case where the second attempt lands fine,
 *      and any tiny CDN propagation blip in prod.
 *   3. If retry ALSO fails (real stale-deploy: the hashed URL is gone from
 *      the CDN because a new build replaced it), hand off to the shared
 *      `chunk-recovery` layer — it unregisters the service worker, deletes
 *      Cache Storage, and reloads the page once with cache-busting query
 *      params so the user gets a fresh `index.html` referencing the current
 *      chunk hashes. Returns a never-resolving promise so React stays in
 *      Suspense through the reload (no flash of error UI).
 *
 * Without step 3, a section-level Error Boundary catches the failed lazy
 * BEFORE it can bubble to `unhandledrejection`, so the recovery handler in
 * `main.jsx` never fires and the user sees a "Something went wrong" card
 * on the live page after every deploy.
 *
 * Boot-skeleton handoff:
 * When the FIRST lazy chunk resolves successfully, the loaded module is
 * wrapped so its `useLayoutEffect` dismisses the static HTML boot skeleton
 * in `index.html` (#boot-skeleton, sibling of #root). This collapses the
 * cold-load loader cascade — previously the user saw HTML skeleton -> React
 * mounts -> Suspense orb -> real page (TWO visible loading states). Now:
 * skeleton stays on top until the first route chunk is ready, then hands
 * off directly to the real UI in a single fade.
 *
 * Dismissing on COMMIT (useLayoutEffect) rather than chunk-resolve is
 * critical: the 280ms fade must overlap a painted page, not the RouteFallback
 * orb — otherwise the fade reveals the orb instead of content.
 */

// Entry-CSS readiness. In prod the entry stylesheet loads NON-render-blocking
// (media="print" swap, see nonBlockingEntryCss in vite.config.js) so it can
// still be in flight when React mounts and the first route chunk commits. The
// skeleton hand-off must wait for it: dismissing on chunk-commit alone exposed
// one-to-many UNSTYLED frames on slow cold starts (iOS PWA especially) - the
// nav/header SVG icons render at full-width default size with no CSS, the
// "giant icons flash then the app lands" glitch. Memoized promise; capMs is a
// deadlock guard, never the expected path.
let entryCssPromise = null
export function whenEntryCssLoaded(capMs = 10000) {
  if (!entryCssPromise) {
    entryCssPromise = new Promise((resolve) => {
      try {
        const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href^="/assets/"]'))
        if (links.length === 0) return resolve() // dev: Vite injects CSS via JS
        let pending = 0
        const done = () => { if (--pending <= 0) resolve() }
        for (const link of links) {
          let loaded = false
          try { loaded = !!link.sheet } catch { loaded = false }
          if (!loaded) {
            pending++
            link.addEventListener('load', done, { once: true })
            link.addEventListener('error', done, { once: true })
          }
        }
        if (pending === 0) return resolve()
      } catch {
        resolve()
      }
    })
  }
  return Promise.race([
    entryCssPromise,
    new Promise((resolve) => setTimeout(resolve, capMs)),
  ])
}

// Boot completion signal. Resolves once the app is genuinely on screen (the
// skeleton has handed off), so heavy OPTIONAL work - the 1.8MB Privy wallet
// stack above all - can be held until it can no longer compete with the boot
// render for network and main thread. Never rejects; safe to await anywhere.
let resolveBootComplete
const bootCompletePromise = new Promise((r) => { resolveBootComplete = r })
export function whenBootComplete() { return bootCompletePromise }

let bootSkeletonDismissed = false
export function dismissBootSkeleton() {
  if (bootSkeletonDismissed) return
  bootSkeletonDismissed = true
  if (typeof document === 'undefined') { resolveBootComplete(); return }
  // Hold the skeleton over the (possibly unstyled) app until the entry
  // stylesheet is genuinely on. React keeps working underneath either way.
  whenEntryCssLoaded().then(() => {
    const el = document.getElementById('boot-skeleton')
    if (el) {
      el.classList.add('bk-leaving')
      setTimeout(() => { el.remove() }, 320)
    }
    resolveBootComplete()
  })
}

function wrapForBootDismiss(mod) {
  const Original = mod && mod.default
  if (typeof Original !== 'function' && (typeof Original !== 'object' || Original === null)) {
    return mod
  }
  function BootDismissWrapper(props) {
    // 🪤 Hand off after the route has PAINTED, not when it commits. A
    // useLayoutEffect fires while the route's DOM is laid out but before the
    // browser has drawn a single frame of it, so the cover lifted onto a page
    // that was structurally there and visually blank — on a phone that reads as
    // the chrome icons flashing a beat before the page lands (founder, 08-17;
    // the 08-06 split below fixed the chrome-chunk race, this is the remaining
    // commit-vs-paint gap). Two frames: one to let this commit paint, one to be
    // sure it reached the screen. The timeout is the backstop for a tab that is
    // hidden when the route mounts, where rAF never fires at all.
    useLayoutEffect(() => {
      let done = false
      const hand = () => { if (!done) { done = true; dismissBootSkeleton() } }
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(hand) })
      const cap = setTimeout(hand, 1200)
      return () => {
        done = true
        cancelAnimationFrame(raf1)
        if (raf2) cancelAnimationFrame(raf2)
        clearTimeout(cap)
      }
    }, [])
    return createElement(Original, props)
  }
  BootDismissWrapper.displayName = `BootDismissWrapper(${Original.displayName || Original.name || 'Lazy'})`
  return { ...mod, default: BootDismissWrapper }
}

/**
 * 🪤 THE BUG THIS SPLIT EXISTS TO KILL (founder, 08-06: "at immediate load all
 * icons show then landing page").
 *
 * The hand-off above is written for THE ROUTE — `main.jsx`'s own safety-net
 * comment says "dismisses it when the first lazy ROUTE chunk resolves". But
 * dismissal used to live in `lazyWithRetry` itself, and the app-shell chrome
 * (`mobile-header`, `mobile-bottom-nav`, `navigation-sidebar`, `header`,
 * MonarchMiniChat, the theme studio — 15 call sites) goes through the SAME
 * wrapper. Those chunks are 2.6-3.6KB gz against a route chunk many times
 * their size, so on a phone they usually win the race and the skeleton lifted
 * on CHROME: the user got a header and a bottom bar of icons over an empty
 * page, then the landing page a beat later.
 *
 * It is a RACE, which is why it is intermittent ("sometimes"). Measured on the
 * prod build, warm SW, slow-3G/6x-CPU at 390px: one run handed off at 2668ms
 * to `.mobile-header` with the bottom nav not arriving until 6411ms — 3.7s of
 * half-built app after the skeleton was already gone; the next run had all
 * three land on the same frame and looked perfect.
 *
 * So dismissal is now OPT-IN and only `App.jsx`'s route table opts in. Chrome
 * keeps the retry/stale-deploy recovery and loses the hand-off. `main.jsx`'s
 * 8s timeout is still the backstop for paths that render no lazy route at all
 * (the AuthGate password screen, a fatal early error).
 */
function build(factory, { dismissesBoot }) {
  const prepare = dismissesBoot ? wrapForBootDismiss : (mod) => mod
  return lazy(() =>
    factory()
      .then(prepare)
      .catch((err) => {
        if (!isChunkLoadError(err)) throw err
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            factory().then(
              (mod) => resolve(prepare(mod)),
              (err2) => {
                if (!isChunkLoadError(err2)) return reject(err2)
                triggerChunkRecovery(err2).then(resolve, reject)
              },
            )
          }, 250)
        })
      }),
  )
}

/** Chrome / in-page lazies: retry + stale-deploy recovery, NO boot hand-off. */
export default function lazyWithRetry(factory) {
  return build(factory, { dismissesBoot: false })
}

/** Route-level lazies (App.jsx only): additionally hand off the boot skeleton. */
export function lazyRoute(factory) {
  return build(factory, { dismissesBoot: true })
}
