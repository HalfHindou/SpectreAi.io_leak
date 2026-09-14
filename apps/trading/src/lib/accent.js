/**
 * accent — user-selected accent color engine.
 *
 * The platform's identity color is the --accent* channel declared in
 * styles/design-tokens.css (WARM WHITE by default — Spectre is black &
 * white). This module lets the user replace it: any hex runs through
 * normalizeAccent() (OKLCH lightness clamp + chroma lift + WCAG floor
 * vs black) and the resulting ramp is written as inline custom
 * properties on <html>.
 *
 * Cascade contract with token theming: useAccentTheme writes the SAME
 * vars inline on the `.app` element for token pages, and an element-level
 * value always beats the inherited root value — so the token's brand
 * color keeps winning on token pages, and the user's accent shows
 * everywhere else. Since every --accent* var is a registered @property
 * with a transition on `.app`, changes cross-fade smoothly app-wide.
 *
 * `null` accent = stock warm white (all overrides removed).
 * Day mode clears overrides (light surfaces carry their own palette).
 */

import { normalizeAccent } from './accentNormalize'

export const DEFAULT_ACCENT = null // stock warm white from design-tokens.css

/** Stock accent hex (warm white) — used only for previews (swatches, skin cards). */
export const STOCK_ACCENT_HEX = '#F5F5F7'

/**
 * Curated accent presets. `hex: null` = the stock warm-white channel.
 * Every hex is normalized before it hits the page, so these are
 * brand inputs, not final pixels.
 * (The first preset keeps id 'lime' for stored-prefs compatibility —
 * it has meant "stock accent" since day one; stock is white now.)
 */
export const ACCENT_PRESETS = [
  { id: 'lime',   label: 'White',  hex: null },
  { id: 'pink',   label: 'Pink',   hex: '#FF5CA8' },
  { id: 'yellow', label: 'Yellow', hex: '#FFD84D' },
  { id: 'orange', label: 'Orange', hex: '#FF8A3C' },
  { id: 'cyan',   label: 'Cyan',   hex: '#67E8F9' },
  { id: 'violet', label: 'Violet', hex: '#A78BFA' },
  { id: 'blue',   label: 'Blue',   hex: '#5CA8FF' },
  { id: 'silver', label: 'Silver', hex: '#E4E4E7' },
]

const ACCENT_VARS = [
  '--accent',
  '--accent-bright',
  '--accent-deep',
  '--accent-glow',
  '--accent-wash',
  '--accent-contrast',
  '--aurora-cool-color',
  '--aurora-warm-color',
  '--aurora-ember-color',
]

export function isValidAccentHex(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

/** Store-level guard: a valid uppercase hex or null (stock). */
export function sanitizeAccent(value) {
  return isValidAccentHex(value) ? value.toUpperCase() : null
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Last accent handed to applyAccent — lets other writers of the same
 *  root vars (useAccentTheme's token theming) restore the user's accent
 *  after they clear their own overrides, without importing the store. */
let _current = null

/**
 * Apply a user accent to the root. `null` removes every override so the
 * stock lime channel rules; light theme always clears.
 * Safe to call repeatedly with the same value (idempotent).
 */
export function applyAccent(hex) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const clean = sanitizeAccent(hex)
  _current = clean
  if (!clean || document.body.classList.contains('theme-light')) {
    for (const name of ACCENT_VARS) root.style.removeProperty(name)
    return
  }
  const ramp = normalizeAccent(clean)
  root.style.setProperty('--accent',          ramp.accent)
  root.style.setProperty('--accent-bright',   ramp.bright)
  root.style.setProperty('--accent-deep',     ramp.deep)
  root.style.setProperty('--accent-glow',     ramp.glow)
  root.style.setProperty('--accent-wash',     ramp.wash)
  root.style.setProperty('--accent-contrast', ramp.contrast)
  // The whole aurora atmosphere follows the accent — all three blooms,
  // at higher presence than the stock lime whisper, so a skin reads as
  // a scene change, not a detail.
  root.style.setProperty('--aurora-cool-color',  hexToRgba(ramp.accent, 0.10))
  root.style.setProperty('--aurora-warm-color',  hexToRgba(ramp.accent, 0.055))
  root.style.setProperty('--aurora-ember-color', hexToRgba(ramp.accent, 0.16))
}

/**
 * Re-apply the last user accent (or clear to stock if none). Called by
 * useAccentTheme after it clears its token ramp from the root, so token
 * theming can never permanently wipe the user's accent.
 */
export function reapplyAccent() {
  applyAccent(_current)
}
