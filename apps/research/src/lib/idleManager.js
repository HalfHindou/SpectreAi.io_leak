/**
 * idleManager - app-wide user-activity tracker.
 *
 * WHY: Codex support named "stale browser tabs" as a top cost driver. Our
 * polling hooks already skip when `document.hidden` is true, but that ONLY
 * catches backgrounded tabs. A tab left open on a second monitor (or one the
 * user walked away from) stays `visible` and keeps polling trending, the
 * watchlist, and charts every 60s forever - each tick a fresh Codex call.
 *
 * This module flips a global `active` flag to false after IDLE_TIMEOUT with no
 * user interaction, even while the tab is visible. Polling hooks add
 * `&& isAppActive()` to their existing `!document.hidden` guard, and subscribe
 * so they fire ONE refresh the moment the user comes back (no stale-data UX).
 *
 * Singleton: state lives at module scope, shared across every importer. Self-
 * initializes on first import (safe to import anywhere).
 */

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 min of no interaction -> idle
const CHECK_INTERVAL = 30 * 1000;   // how often we re-evaluate the idle clock

let lastActivity = Date.now();
let idle = false;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(!idle); } catch { /* a bad listener must not break the others */ }
  }
}

function markActive() {
  lastActivity = Date.now();
  if (idle) {
    idle = false;
    notify();
  }
}

function checkIdle() {
  if (!idle && Date.now() - lastActivity >= IDLE_TIMEOUT) {
    idle = true;
    notify();
  }
}

// Self-init (browser only; guarded for any SSR/prerender pass).
if (typeof window !== 'undefined') {
  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];
  for (const evt of ACTIVITY_EVENTS) {
    // passive + capture: never block scroll/touch, catch events before they're stopped.
    window.addEventListener(evt, markActive, { passive: true, capture: true });
  }
  // Returning to the tab counts as activity (also resets the clock).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) markActive();
  });
  setInterval(checkIdle, CHECK_INTERVAL);
}

/** True when the user has interacted within IDLE_TIMEOUT. Use in poll guards. */
export function isAppActive() {
  return !idle;
}

/**
 * Subscribe to active/idle transitions. Callback receives the new active state
 * (boolean). Returns an unsubscribe function. Use to refetch on resume.
 */
export function subscribeActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
