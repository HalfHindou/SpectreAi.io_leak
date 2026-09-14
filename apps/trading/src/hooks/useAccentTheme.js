/**
 * useAccentTheme — resolve and apply the per-token accent.
 *
 * Single source of truth for the page's adaptive `--accent*` channel.
 * Writes six CSS custom properties as inline styles on the `.app`
 * element (NOT `.app.token-page` — the `.app` root is always present,
 * which avoids the rAF mount-race that used to leave fresh-loaded
 * tokens stuck on the previous accent).
 *
 * Resolution priority (highest wins, no async fallback REPLACES a
 * curated win):
 *   1. Curated table by symbol — authoritative. `hasKnownColor` gates.
 *      Skips async entirely; LINK is blue forever, no chance of a
 *      bad pixel extraction overriding it.
 *   2. In-memory cache by logo URL — previous canvas/server result.
 *   3. Sync hash-derived hue — always returns SOMETHING, never null.
 *   4. (Background) Canvas + server image extraction — only fires when
 *      none of 1-3 produced a non-fallback result. Upgrades the hash
 *      seed if it returns a meaningfully different color.
 *
 * Cross-fade comes for free — `design-tokens.css` registers each
 * `--accent*` via `@property` and declares a `transition` on `.app`,
 * so the browser tweens the colour properties over `--dur-enter`
 * automatically.
 *
 * On every change the previous inline `--accent*` overrides are
 * cleared FIRST before the new values are written, so no stale
 * channel from the previous token can leak through.
 */

import { useEffect, useState } from 'react'
import {
  hasKnownColor,
  getTokenColor,
  getCachedColor,
  fetchTokenColorFromServer,
  extractColorFromImage,
} from '../utils/tokenColors'
import { normalizeAccent } from '../lib/accentNormalize'
import { reapplyAccent } from '../lib/accent'

const VAR_NAMES = [
  '--accent',
  '--accent-bright',
  '--accent-deep',
  '--accent-glow',
  '--accent-wash',
  '--accent-contrast',
  // Light-mode ramp — same hue darkened for legibility on white. Consumed by
  // the body.theme-light remap of --accent* on the token-content wrapper. These
  // are ADDITIVE: nothing in dark mode reads them, so black-mode is untouched.
  '--accent-onlight',
  '--accent-onlight-bright',
  '--accent-onlight-deep',
  '--accent-onlight-glow',
  '--accent-onlight-wash',
  '--accent-onlight-contrast',
]

function applyAccent(rootEl, ramp) {
  if (!rootEl || !ramp) return
  // No remove-then-set sequence here — setProperty overwrites cleanly,
  // and the remove sequence triggered the CSS transition to restart
  // from the @property initial-value (lime) on every effect re-fire.
  // That made the deep-link first paint look like persistent lime
  // because the transition kept restarting and never completed.
  rootEl.style.setProperty('--accent',          ramp.accent)
  rootEl.style.setProperty('--accent-bright',   ramp.bright)
  rootEl.style.setProperty('--accent-deep',     ramp.deep)
  rootEl.style.setProperty('--accent-glow',     ramp.glow)
  rootEl.style.setProperty('--accent-wash',     ramp.wash)
  rootEl.style.setProperty('--accent-contrast', ramp.contrast)
  // Light-mode ramp (additive; only body.theme-light consumers read these).
  // Guarded so an older ramp object without these fields doesn't write "undefined".
  if (ramp.onLight)         rootEl.style.setProperty('--accent-onlight',          ramp.onLight)
  if (ramp.onLightBright)   rootEl.style.setProperty('--accent-onlight-bright',   ramp.onLightBright)
  if (ramp.onLightDeep)     rootEl.style.setProperty('--accent-onlight-deep',     ramp.onLightDeep)
  if (ramp.onLightGlow)     rootEl.style.setProperty('--accent-onlight-glow',     ramp.onLightGlow)
  if (ramp.onLightWash)     rootEl.style.setProperty('--accent-onlight-wash',     ramp.onLightWash)
  if (ramp.onLightContrast) rootEl.style.setProperty('--accent-onlight-contrast', ramp.onLightContrast)
}

function clearAccent(rootEl) {
  if (!rootEl) return
  for (const name of VAR_NAMES) rootEl.style.removeProperty(name)
}

/**
 * useAccentTheme(token, options)
 *   token: { symbol, address, logo, networkId }  (selected token)
 *   options.enabled: boolean — when false, the hook is a no-op and the
 *     root falls back to the lime defaults declared in design-tokens.
 *
 * The hook attaches/detaches to whichever `.app` element matches.
 * `.app` is always rendered (App.jsx root), so no mount poll is needed.
 */
export default function useAccentTheme(token, { enabled = true } = {}) {
  const [ramp, setRamp] = useState(null)

  // No per-fire dedup ref. The effect's dep array `[address, symbol, logo, enabled]`
  // is already a complete identity check — React skips when all primitives match.
  // The previous lastKeyRef ran BEFORE symbol propagation, so navigation by
  // `#token/<addr>` (where the token starts as { address } only and gets symbol
  // hydrated a tick later) locked in the hash-derived fallback and refused to
  // upgrade to the curated brand color when the symbol finally arrived. Bug
  // verified live: LINK rendered `#BFD11E` (hash hue) instead of `#2A5ADA` (curated).

  useEffect(() => {
    if (!enabled) {
      setRamp(null)
      return
    }
    if (!token || (!token.symbol && !token.address)) {
      setRamp(null)
      return
    }

    let cancelled = false

    // --- Priority 1: curated by symbol OR address --------------------
    // Authoritative. KNOWN_TOKEN_COLORS exists precisely because image
    // extraction picks bad pixels (logo borders, gradients, transparent
    // edges). When curated, skip async entirely.
    // Pass `address` so the address-keyed table catches tokens whose
    // symbol arrives in an unexpected shape (Codex sometimes returns
    // "Spectre AI" instead of "SPECTRE", and during the first paint of
    // a deep-link the symbol hasn't hydrated yet).
    if (hasKnownColor(token.symbol, token.address)) {
      const curated = getTokenColor(token.symbol, token.address)
      setRamp(normalizeAccent(curated))
      return () => { cancelled = true }
    }

    // --- Priority 2: cache by logo URL -------------------------------
    // Previous canvas/server resolution. If present, this is the same
    // value the async race would resolve to anyway — skip the work.
    if (token.logo) {
      const cached = getCachedColor(token.logo)
      if (cached) {
        setRamp(normalizeAccent(cached))
        return () => { cancelled = true }
      }
    }

    // --- Priority 3: hash-derived sync fallback ----------------------
    // Always returns SOMETHING. Sets the ramp synchronously so the
    // page never sits on the lime default while async resolves.
    const syncFallback = getTokenColor(token.symbol, token.address)
    setRamp(normalizeAccent(syncFallback))

    // --- Priority 4: background async upgrade ------------------------
    // Try to upgrade the hash seed with a real EXTRACTED brand color.
    // Both canvas + server fire in parallel and the first NON-NULL wins.
    //
    // Failure contract (Layer 1, 2026-05-26): both extractors now return
    // `null` on every failure path. Previously `fetchTokenColorFromServer`
    // returned `#D4D4D8` (warm silver) on failure, which is ALSO a legit
    // brand colour — so the failure value was indistinguishable from a
    // real result, and every uncurated token whose extraction failed
    // converged to the same near-white. Null is now the unambiguous
    // "extract failed, sync seed stands" signal.
    //
    // `Promise.any` (not `Promise.race`) is the correct primitive:
    // race takes the first SETTLED value (good or bad); any takes the
    // first FULFILLED value. By rejecting on null we let the slower
    // extractor still win if the fast one came back empty. If both
    // reject, the sync hash hue set above remains.
    if (token.logo) {
      const requireHex = (hex) =>
        hex ? hex : Promise.reject(new Error('no-color'))
      Promise.any([
        extractColorFromImage(token.logo).then(requireHex),
        fetchTokenColorFromServer(token.logo).then(requireHex),
      ]).then((hex) => {
        if (cancelled) return
        if (hex.toLowerCase() === String(syncFallback || '').toLowerCase()) return
        setRamp(normalizeAccent(hex))
      }).catch(() => { /* both extractors empty — sync seed stands */ })
    }

    return () => { cancelled = true }
  }, [token?.address, token?.symbol, token?.logo, enabled])

  // Apply the ramp to `.app` whenever it changes. The element is
  // always present because the hook is mounted inside the App tree —
  // by the time this effect runs, `.app` is in the DOM. No rAF poll
  // is needed (the previous implementation polled 30 frames waiting
  // for `.app.token-page` which sometimes never appeared in time).
  useEffect(() => {
    // Write to BOTH document.documentElement AND every .app element.
    //
    // `<html>` (`:root`) is where the `--accent*` `@property`
    // declarations live, so an inline override there beats the
    // property defaults via cascade. The previous `.app`-only write
    // wasn't sticking for reasons we never fully isolated — Gleb's
    // 2026-05-28 prod diagnostic showed `.app inline: ''` despite
    // `applyAccent` running. Adding the `<html>` write made the page
    // tint correctly. `.app` writes remain as a secondary path.
    const html = document.documentElement
    const roots = document.querySelectorAll('.app')
    if (ramp) {
      if (html) applyAccent(html, ramp)
      roots.forEach((el) => applyAccent(el, ramp))
    } else {
      if (html) clearAccent(html)
      roots.forEach((el) => clearAccent(el))
      // The token ramp and the user's chosen accent (lib/accent.js) write
      // the SAME vars on <html>. Clearing must hand the channel back to
      // the user's accent, not silently strip it to stock lime.
      reapplyAccent()
    }
  }, [ramp])

  return ramp
}
