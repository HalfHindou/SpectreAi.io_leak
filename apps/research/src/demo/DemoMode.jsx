/**
 * DemoMode - Isolated overlay for the embedded marketing demo.
 *
 * Activated ONLY when the research app is loaded with `?demo=true`
 * (i.e. inside the spectreai.io iframe). Regular users of the app
 * never mount this component, so none of the behaviors below leak
 * into the main product.
 *
 * Current responsibilities:
 *   1. Badge unreleased sidebar pages with "BETA" pills
 *   2. Intercept clicks on beta pages and show a waitlist modal
 *
 * To add more demo-only features, extend this file - do not reach
 * into the core app components. The only hooks the core app exposes
 * are the `data-nav-id` / `data-nav-label` attributes on sidebar and
 * Mission Control buttons.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import useSettingsStore from '@/store/useSettingsStore'
import './demo-mode.css'

// Launch gate - only these surfaces are unlocked in the marketing demo.
// Everything else becomes a waitlist tap-target marked with an "IN BETA" pill.
const UNLOCKED_PAGES = new Set([
  'research-platform',   // Welcome
  'fear-greed',
  'economic-calendar',
  'categories',
  'bubbles',
  'heatmaps',
])

const BADGE_ATTR = 'data-demo-badge'
const BETA_CLASS = 'demo-beta-target'

// Central waitlist endpoint on the marketing site. Overridable via env
// for preview deployments or local dev that wants to hit a staging API.
const WAITLIST_ENDPOINT = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WAITLIST_ENDPOINT)
  || 'https://spectreai.io/api/waitlist'

// Pulls the same Firestore-backed seat count as the marketing site so the
// embedded demo's waitlist modal flips to a "closed" state once 100/100 is
// reached, matching what users see on spectreai.io and /lp.
const STATS_ENDPOINT = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WAITLIST_STATS_ENDPOINT)
  || 'https://spectreai.io/api/waitlist-stats'

export default function DemoMode() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const [waitlist, setWaitlist] = useState({ open: false, pageId: null, pageLabel: '' })
  const [email, setEmail] = useState('')
  const [telegram, setTelegram] = useState('')
  const [status, setStatus] = useState('idle') // 'idle' | 'submitting' | 'done' | 'error'
  // Default to 100/100 so the modal shows the closed state on first paint -
  // this is the current production reality. The fetch below will overwrite
  // both numbers if the next beta wave reopens seats.
  const [seatsTaken, setSeatsTaken] = useState(100)
  const [seatsTotal, setSeatsTotal] = useState(100)
  const seatsFull = seatsTaken >= seatsTotal
  const observerRef = useRef(null)
  const hpRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(STATS_ENDPOINT, { signal: controller.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.ok !== true) return
        if (typeof data.taken === 'number') setSeatsTaken(data.taken)
        if (typeof data.total === 'number' && data.total > 0) setSeatsTotal(data.total)
      })
      .catch(() => { /* keep the 100/100 fallback */ })
    return () => controller.abort()
  }, [])
  // Attribution: captured once on mount. The research app is typically
  // embedded in an iframe on spectreai.io, so document.referrer often
  // shows the parent; UTMs flow through via the iframe's own query string
  // if the parent forwards them.
  const attributionRef = useRef({ referrer: '', utm: {} })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const utm = {}
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = params.get(k)
      if (v) utm[k] = v
    }
    attributionRef.current = { referrer: document.referrer || '', utm }
  }, [])

  // Apply BETA markup to all nav buttons exposing `data-nav-id`. Runs on
  // mount and whenever the sidebar DOM changes (collapse toggle, mission
  // control open, i18n swap, etc.) so we never lose coverage.
  const applyBadges = useCallback(() => {
    const targets = document.querySelectorAll('[data-nav-id]')
    targets.forEach((el) => {
      const id = el.getAttribute('data-nav-id')
      const isUnlocked = UNLOCKED_PAGES.has(id)
      if (isUnlocked) {
        el.classList.remove(BETA_CLASS)
        el.querySelector(`[${BADGE_ATTR}]`)?.remove()
        return
      }
      el.classList.add(BETA_CLASS)
      if (!el.querySelector(`[${BADGE_ATTR}]`)) {
        const pill = document.createElement('span')
        pill.setAttribute(BADGE_ATTR, '')
        pill.className = 'demo-beta-pill'
        pill.textContent = 'IN BETA'
        el.appendChild(pill)
      }
    })
  }, [])

  // Click interceptor at the document level, capture phase, so we run
  // before any component-level click handlers fire. If the target is a
  // beta surface, we stop navigation and pop the waitlist modal.
  const interceptClick = useCallback((e) => {
    const btn = e.target.closest?.('[data-nav-id]')
    if (!btn) return
    const id = btn.getAttribute('data-nav-id')
    if (UNLOCKED_PAGES.has(id)) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation?.()
    setWaitlist({
      open: true,
      pageId: id,
      pageLabel: btn.getAttribute('data-nav-label') || id,
    })
    setEmail('')
    setStatus('idle')
  }, [])

  useEffect(() => {
    applyBadges()
    document.body.classList.add('demo-mode-active')
    document.addEventListener('click', interceptClick, true)

    // Watch for sidebar re-renders (React state, collapse toggle, mission
    // control mount) so new buttons receive the same treatment.
    observerRef.current = new MutationObserver(() => applyBadges())
    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
    })

    return () => {
      document.body.classList.remove('demo-mode-active')
      document.removeEventListener('click', interceptClick, true)
      observerRef.current?.disconnect()
      document.querySelectorAll(`[${BADGE_ATTR}]`).forEach((p) => p.remove())
      document.querySelectorAll(`.${BETA_CLASS}`).forEach((el) => el.classList.remove(BETA_CLASS))
    }
  }, [applyBadges, interceptClick])

  const close = () => {
    setWaitlist({ open: false, pageId: null, pageLabel: '' })
    setStatus('idle')
    setEmail('')
    setTelegram('')
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    const trimmed = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setStatus('error')
      return
    }
    setStatus('submitting')
    const { referrer, utm } = attributionRef.current
    const payload = {
      email: trimmed,
      telegram: telegram.trim() || null,
      source: 'research-demo',
      page: waitlist.pageId,
      hp: hpRef.current?.value || '',
      referrer,
      ...utm,
    }
    // LocalStorage fallback always writes so we never lose a signup,
    // even if the remote endpoint errors or CORS is misconfigured.
    try {
      const key = 'spectre-waitlist'
      const existing = JSON.parse(localStorage.getItem(key) || '[]')
      existing.push({ ...payload, ts: new Date().toISOString() })
      localStorage.setItem(key, JSON.stringify(existing))
    } catch (_) { /* Silent: localStorage may be unavailable in private browsing or quota exceeded - non-critical fallback */ }
    try {
      const r = await fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await r.json().catch(() => ({}))
      if (r.ok && json.ok) {
        setStatus('done')
        return
      }
    } catch (_) { /* fall through to error below */ }
    setStatus('error')
  }

  if (!waitlist.open) return null

  return createPortal(
    <div className={`demo-wait-overlay ${dayMode ? 'demo-wait-day' : ''}`} onClick={close}>
      <div className="demo-wait-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="demo-wait-title">
        <button type="button" className="demo-wait-close" onClick={close} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {status === 'done' ? (
          <div className="demo-wait-success">
            <div className="demo-wait-success-check">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h3 className="demo-wait-title">You&apos;re on the list.</h3>
            <p className="demo-wait-sub">We&apos;ll reach out when {waitlist.pageLabel} opens to you.</p>
          </div>
        ) : (
          <>
            <div className={`demo-wait-counter${seatsFull ? ' demo-wait-counter--full' : ''}`}>
              <span className="demo-wait-counter-label">{seatsFull ? 'ALL SEATS SECURED' : 'LIMITED SPOTS'}</span>
              <span className="demo-wait-counter-num">{seatsTaken} / {seatsTotal}</span>
            </div>
            <h3 id="demo-wait-title" className="demo-wait-title">{seatsFull ? 'Beta - All seats secured.' : 'Join the Spectre App Beta.'}</h3>
            {seatsFull ? (
              <div className="demo-wait-form">
                <button
                  type="button"
                  className="demo-wait-submit demo-wait-submit--locked"
                  disabled
                  aria-disabled="true"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  All Seats Secured
                </button>
              </div>
            ) : (
              <>
                <p className="demo-wait-sub">First {seatsTotal} seats go to premium tier holders and waitlist members.</p>
                <form className="demo-wait-form" onSubmit={submit}>
                  <div className={`demo-wait-field${status === 'error' ? ' demo-wait-field--error' : ''}`}>
                    <svg className="demo-wait-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </svg>
                    <input
                      type="email"
                      className="demo-wait-input"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="demo-wait-field">
                    <svg className="demo-wait-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.5 4.5 2.5 12l6 2.5M21.5 4.5 18 20l-9.5-5.5M21.5 4.5 8.5 14.5l0 5 4-3.5" />
                    </svg>
                    <input
                      type="text"
                      className="demo-wait-input"
                      placeholder="@telegram (optional)"
                      value={telegram}
                      onChange={(e) => setTelegram(e.target.value)}
                      autoComplete="off"
                      maxLength={64}
                    />
                  </div>
                  {/* Honeypot — hidden from users, visible to bots. */}
                  <input
                    ref={hpRef}
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                  />
                  <button type="submit" className="demo-wait-submit" disabled={status === 'submitting'}>
                    {status === 'submitting' ? 'Joining' : 'Request Access'}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                  </button>
                  <div className="demo-wait-trust">
                    <span className="demo-wait-trust-dot" />
                    <span>$SPECTRE holders get access first</span>
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// Static helper so the mount point can decide whether to render this at all.
export function isDemoModeActive() {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('demo') === 'true'
  } catch (_) {
    return false
  }
}
