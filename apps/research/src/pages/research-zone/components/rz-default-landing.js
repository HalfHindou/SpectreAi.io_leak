/**
 * Did the READER name the token in the URL, or did the desk fill it in?
 *
 * Landing on bare /research-zone resolves a default token and rewrites the URL
 * to it, so a moment later that URL is indistinguishable from one the reader
 * typed. That is what let the session capture overwrite "ZIGCHAIN" with "BTC"
 * and destroy the very thing the resume card exists to offer.
 *
 * The signal is the URL TRANSITION, which is unambiguous and cannot race:
 *
 *     /research-zone        ->  /research-zone/bitcoin     the desk's rewrite
 *     (anything else)       ->  /research-zone/zigchain    the reader's choice
 *
 * A rewrite can only ever be preceded by the slug-less path, because that is the
 * only case where the desk has to choose. Every other arrival at a token URL is
 * one the reader asked for.
 *
 * 🪤 Four signals were tried before this one and ALL of them lied. Each was
 * reproduced by leaving Research Zone via the bottom nav, coming back, and
 * reading `spectre-rz-session`:
 *   - a per-mount ref — the desk remounts this subtree mid-landing, so the ref
 *     is re-initialised from the already-rewritten URL;
 *   - `useNavigationType() === 'PUSH'` — on a client-side return the reader's own
 *     PUSH to /research-zone is still the current navigation type when the
 *     rewrite lands, so the default read as deliberate;
 *   - the symbol resolved at the slug-less render — the token context can still
 *     hold the PREVIOUS token at that instant, so the wrong symbol was recorded;
 *   - a callback from the rewrite site itself — correct in principle, but the
 *     capture effect can commit BEFORE the rewrite effect (which waits on token
 *     data), so it lost the race and saved the default anyway.
 *
 * Module scope because it has to survive those remounts.
 */

const RZ_BARE = '/research-zone'
const hasToken = (p) => p.startsWith(RZ_BARE + '/') && p.length > RZ_BARE.length + 1

let prevPath = null
let readerNamed = false

/** Called on every Research Zone render with the current pathname. Idempotent. */
export function notePath(pathname) {
  if (!pathname || pathname === prevPath) return
  if (!hasToken(pathname)) readerNamed = false            // nothing named yet
  else if (prevPath === RZ_BARE) readerNamed = false      // the desk filled it in
  else readerNamed = true                                 // the reader asked for it
  prevPath = pathname
}

/** Is the token on screen one the reader actually asked for? */
export function isReaderNamed() {
  return readerNamed
}
