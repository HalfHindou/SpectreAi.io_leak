/**
 * YOU V2 — useYouTracking
 *
 * Frontend hook that batches You-page events and ships them to /api/you/events.
 *
 * Behavior:
 *   - Generates a session_id once per browser session (sessionStorage).
 *   - Buffers events in a module-level queue (shared across all hook instances).
 *   - Flushes every 5 seconds, when the buffer hits 50 events, or on `beforeunload`
 *     via `navigator.sendBeacon`.
 *   - Retries a failed batch exactly once, then drops silently. Tracking must
 *     never block or surface errors to the UI.
 *   - `track(event_type, fields)` is a stable reference for use in deps.
 *
 * Widget-view duration: components track their own time and pass `duration_ms`
 * in the payload. This hook also exports `useWidgetViewedTracking(id, dashboardId)`
 * which handles IntersectionObserver pause/resume and fires the event on unmount.
 */

import { useCallback, useEffect, useRef } from 'react';
import { YOU_EVENT_TYPES, isValidEventType } from '@/utils/youEventTypes';

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 50;
const ENDPOINT = '/api/you/events';
const SESSION_KEY = 'spectre_you_session_id';

const queue = [];
let flushTimer = null;
let flushing = false;

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getSessionId() {
  if (typeof sessionStorage === 'undefined') return uuid();
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uuid();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

// User id resolution: keep simple — read from spectre user storage, fall back
// to a stable per-browser anonymous id stored in localStorage so events are
// not orphaned. The Privy/auth integration can replace this once a user_id
// is reliably available; for analytics purposes a stable anon id is fine.
const ANON_USER_KEY = 'spectre_anon_user_id';
function getUserId() {
  try {
    const raw = localStorage.getItem('spectre-user');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id && typeof parsed.id === 'string') return parsed.id;
    }
  } catch { /* ignore */ }
  let id = localStorage.getItem(ANON_USER_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(ANON_USER_KEY, id);
  }
  return id;
}

async function flush({ withBeacon = false } = {}) {
  if (queue.length === 0) return;
  if (flushing && !withBeacon) return;
  const batch = queue.splice(0, FLUSH_BATCH_SIZE);
  const body = JSON.stringify({ events: batch });

  if (withBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } catch { /* drop */ }
    return;
  }

  flushing = true;
  let attempt = 0;
  let ok = false;
  while (attempt < 2 && !ok) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
      ok = res.ok;
      if (!ok) attempt += 1;
    } catch {
      attempt += 1;
    }
  }
  flushing = false;
  // After a failed second attempt, the batch is dropped silently.
}

function ensureFlushTimer() {
  if (flushTimer || typeof window === 'undefined') return;
  flushTimer = setInterval(() => { flush(); }, FLUSH_INTERVAL_MS);
}

function attachUnloadHandler() {
  if (typeof window === 'undefined') return;
  if (window.__spectreYouUnloadAttached) return;
  window.__spectreYouUnloadAttached = true;
  window.addEventListener('beforeunload', () => { flush({ withBeacon: true }); });
  window.addEventListener('pagehide', () => { flush({ withBeacon: true }); });
}

/**
 * Enqueue a tracking event. Always silent — never throws to the caller.
 *
 * @param {string} event_type   one of YOU_EVENT_TYPES values
 * @param {object} [fields]     { widget_id, template_id, dashboard_id, payload }
 */
export function trackEvent(event_type, fields = {}) {
  try {
    if (!isValidEventType(event_type)) return;
    const ev = {
      time: new Date().toISOString(),
      user_id: getUserId(),
      session_id: getSessionId(),
      event_type,
      widget_id: fields.widget_id ?? null,
      template_id: fields.template_id ?? null,
      dashboard_id: fields.dashboard_id ?? null,
      payload: fields.payload ?? null,
    };
    queue.push(ev);
    ensureFlushTimer();
    attachUnloadHandler();
    if (queue.length >= FLUSH_BATCH_SIZE) flush();
  } catch { /* analytics must never break callers */ }
}

export function useYouTracking() {
  const track = useCallback((event_type, fields) => trackEvent(event_type, fields), []);
  return { track, EVENT_TYPES: YOU_EVENT_TYPES };
}

/**
 * Track widget-viewed duration. Call from inside a widget component.
 * Pauses the timer when the element scrolls out of view via IntersectionObserver,
 * resumes when it scrolls back in. Fires WIDGET_VIEWED with duration_ms on unmount.
 *
 * @param {string} widget_id
 * @param {string|null} dashboard_id
 * @returns {React.MutableRefObject<HTMLElement | null>}  attach to widget root
 */
export function useWidgetViewedTracking(widget_id, dashboard_id) {
  const elementRef = useRef(null);
  const startedAtRef = useRef(null);
  const accumulatedMsRef = useRef(0);
  const visibleRef = useRef(false);

  useEffect(() => {
    if (!widget_id) return undefined;
    const el = elementRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // Without IO support, treat as visible the whole time.
      startedAtRef.current = performance.now();
      visibleRef.current = true;
      return () => {
        const elapsed = visibleRef.current && startedAtRef.current
          ? (performance.now() - startedAtRef.current)
          : 0;
        const total = Math.round(accumulatedMsRef.current + elapsed);
        trackEvent(YOU_EVENT_TYPES.WIDGET_VIEWED, {
          widget_id,
          dashboard_id: dashboard_id ?? null,
          payload: { duration_ms: total },
        });
      };
    }

    const observer = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      if (e.isIntersecting && !visibleRef.current) {
        visibleRef.current = true;
        startedAtRef.current = performance.now();
      } else if (!e.isIntersecting && visibleRef.current) {
        visibleRef.current = false;
        if (startedAtRef.current != null) {
          accumulatedMsRef.current += performance.now() - startedAtRef.current;
        }
        startedAtRef.current = null;
      }
    }, { threshold: 0.25 });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (visibleRef.current && startedAtRef.current != null) {
        accumulatedMsRef.current += performance.now() - startedAtRef.current;
      }
      const total = Math.round(accumulatedMsRef.current);
      trackEvent(YOU_EVENT_TYPES.WIDGET_VIEWED, {
        widget_id,
        dashboard_id: dashboard_id ?? null,
        payload: { duration_ms: total },
      });
    };
  }, [widget_id, dashboard_id]);

  return elementRef;
}

export { YOU_EVENT_TYPES };
export default useYouTracking;
