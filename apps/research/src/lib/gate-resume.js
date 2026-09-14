/**
 * gate-resume.js — silent mid-session gate recovery for data-layer 401s.
 *
 * The AuthGate stores a signed resume token in localStorage on login
 * (spectre-gate-resume, see auth-gate.jsx). When a DATA request hits
 * 401 GATE_REQUIRED mid-session (cookie evicted/expired while the app is
 * open), callers used to hard-reload the page — which is exactly the
 * "app kicked me out" experience. This helper replays the resume token to
 * re-mint the cookie IN PLACE; the caller's next poll then succeeds and
 * the user never notices.
 *
 * Returns true iff the cookie was re-minted. Debounced: concurrent 401
 * bursts (every panel fails at once) share one attempt, and repeated
 * failures back off for 30s so a dead token can't stampede the endpoint.
 */
const RESUME_KEY = 'spectre-gate-resume'
const RETRY_BACKOFF_MS = 30_000

let _inflight = null
let _lastFailAt = 0

export async function tryGateResume() {
  if (_inflight) return _inflight
  if (Date.now() - _lastFailAt < RETRY_BACKOFF_MS) return false

  let token = null
  try { token = localStorage.getItem(RESUME_KEY) } catch (_) { return false }
  if (!token) return false

  _inflight = (async () => {
    try {
      const res = await fetch('/api/auth-gate?action=resume', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: token }),
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(8000)
          : undefined,
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        try {
          if (data && typeof data.resume === 'string' && data.resume) {
            localStorage.setItem(RESUME_KEY, data.resume)
          }
        } catch (_) { /* quota — non-fatal */ }
        return true
      }
      // Definitive rejection: token expired/forged — drop it so the gate
      // re-prompts instead of retrying a dead token forever.
      if (res.status === 401) {
        try { localStorage.removeItem(RESUME_KEY) } catch (_) { /* noop */ }
      }
      _lastFailAt = Date.now()
      return false
    } catch (_) {
      _lastFailAt = Date.now()
      return false
    } finally {
      _inflight = null
    }
  })()
  return _inflight
}
