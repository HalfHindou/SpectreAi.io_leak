/**
 * accentNormalize.js — turn any extracted brand colour into a usable
 * accent on `#000`.
 *
 * Inputs (one of):
 *   hex string `#RRGGBB`
 *   raw rgb tuple `[r, g, b]` (0-255)
 *
 * Output:
 *   {
 *     accent:          '#RRGGBB',
 *     bright:          '#RRGGBB',   // L+0.10 in OKLCH
 *     deep:            '#RRGGBB',   // L-0.10
 *     glow:            'rgba(R,G,B,0.45)',
 *     wash:            'rgba(R,G,B,0.08)',
 *     contrast:        '#0A0C00' | '#FFFFFF',
 *     monochrome:      boolean,     // true when chroma < 0.04
 *     wcagAccentVsBlack: number,    // contrast ratio vs #000
 *   }
 *
 * Algorithm:
 *   1. Parse → sRGB → OKLCH.
 *   2. If chroma < 0.04 → monochrome path: return a bright off-white
 *      ramp + near-black contrast.
 *   3. Clamp L into [0.62, 0.82] (perceptual; ensures glow on #000).
 *   4. Lift chroma to ≥ 0.16 (over-desaturated brands get vibrancy).
 *   5. Enforce WCAG ≥ 3.5 against #000 by lifting L if needed.
 *   6. Derive bright/deep at L±0.10 (clamped to [0, 1]).
 *   7. glow at alpha 0.45, wash at alpha 0.08 — both rgba() strings.
 *   8. contrast = near-black if accent's relative luminance > 0.55,
 *      else white.
 *
 * Pure, no deps. ~140 LOC including the colour-space matrices.
 */

const MONOCHROME_CHROMA = 0.04
const L_MIN = 0.62
const L_MAX = 0.82
const C_MIN = 0.16
const WCAG_MIN = 3.5
// Light-mode (white bg) accent: the dark ramp above is engineered to be LIGHT
// (legible on #000), which washes out on #fff. The onLight* ramp is the SAME
// hue, muted + darkened just enough to read on white without turning "loud".
// A gentle 2.8 target (these skin large decorative UI - donut rings,
// sparklines - not body text) keeps the tone calm rather than harsh.
const WCAG_WHITE_MIN = 2.8
// Cap the light-mode chroma so vivid brands (magenta, gold, orange) render as
// a soft muted tone on white instead of a saturated, eye-straining fill.
const ONLIGHT_CHROMA_MAX = 0.12
// WCAG relative luminance threshold for choosing dark vs light text on
// the accent fill. 0.45 keeps SPX yellow (L≈0.54) on dark text — yellow
// always wants near-black contrast. Pure red (L≈0.21) stays on white.
const LUMA_TEXT_THRESHOLD = 0.45

const MONOCHROME_FALLBACK = {
  accent: '#EAEAEA',
  bright: '#FFFFFF',
  deep: '#B0B0B0',
  glow: 'rgba(234, 234, 234, 0.45)',
  wash: 'rgba(234, 234, 234, 0.08)',
  contrast: '#0A0C00',
  monochrome: true,
  wcagAccentVsBlack: 16.5,
  // Light mode: achromatic brand -> a soft medium grey (calm on white, not the
  // heavy near-charcoal that read as harsh).
  onLight: '#71717A',
  onLightBright: '#5B5B63',
  onLightDeep: '#5B5B63',
  onLightGlow: 'rgba(113, 113, 122, 0.10)',
  onLightWash: 'rgba(113, 113, 122, 0.05)',
  onLightContrast: '#FFFFFF',
}

// Stock ramp = warm white (Spectre is black & white; lime retired 2026-07-03).
const DEFAULT_STOCK = {
  accent: '#F5F5F7',
  bright: '#FFFFFF',
  deep: '#D9D9DE',
  glow: 'rgba(245, 245, 247, 0.38)',
  wash: 'rgba(245, 245, 247, 0.07)',
  contrast: '#0A0A0B',
  monochrome: true,
  wcagAccentVsBlack: 19.1,
  // Light mode: warm-white brand -> a calm neutral grey (not near-black).
  onLight: '#52525B',
  onLightBright: '#3F3F46',
  onLightDeep: '#3F3F46',
  onLightGlow: 'rgba(82, 82, 91, 0.10)',
  onLightWash: 'rgba(82, 82, 91, 0.05)',
  onLightContrast: '#FFFFFF',
}

// --- Parse ------------------------------------------------------------------

function clampUnit(v) {
  return Math.max(0, Math.min(1, v))
}

function parseInput(input) {
  if (Array.isArray(input) && input.length >= 3) {
    return [clampUnit(input[0] / 255), clampUnit(input[1] / 255), clampUnit(input[2] / 255)]
  }
  if (typeof input !== 'string') return null
  // hsl() — parse and convert to rgb
  const hslMatch = input.match(/^hsla?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%/i)
  if (hslMatch) {
    const h = parseFloat(hslMatch[1])
    const s = parseFloat(hslMatch[2]) / 100
    const l = parseFloat(hslMatch[3]) / 100
    return hslToRgb(h, s, l)
  }
  let s = input.trim().replace(/^#/, '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  const r = parseInt(s.slice(0, 2), 16) / 255
  const g = parseInt(s.slice(2, 4), 16) / 255
  const b = parseInt(s.slice(4, 6), 16) / 255
  return [r, g, b]
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (h % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0, g1 = 0, b1 = 0
  if      (0 <= hp && hp < 1) { r1 = c; g1 = x; b1 = 0 }
  else if (1 <= hp && hp < 2) { r1 = x; g1 = c; b1 = 0 }
  else if (2 <= hp && hp < 3) { r1 = 0; g1 = c; b1 = x }
  else if (3 <= hp && hp < 4) { r1 = 0; g1 = x; b1 = c }
  else if (4 <= hp && hp < 5) { r1 = x; g1 = 0; b1 = c }
  else if (5 <= hp && hp < 6) { r1 = c; g1 = 0; b1 = x }
  const m = l - c / 2
  return [r1 + m, g1 + m, b1 + m]
}

// --- sRGB ↔ Linear ----------------------------------------------------------

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

// --- Linear sRGB ↔ OKLab (Björn Ottosson, 2020) -----------------------------

function linearSrgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}
function oklabToLinearSrgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}

// --- OKLab ↔ OKLCH ----------------------------------------------------------

function oklabToOklch([L, a, b]) {
  const C = Math.hypot(a, b)
  const h = Math.atan2(b, a) * (180 / Math.PI)
  return [L, C, h < 0 ? h + 360 : h]
}
function oklchToOklab([L, C, h]) {
  const hr = h * (Math.PI / 180)
  return [L, C * Math.cos(hr), C * Math.sin(hr)]
}

// --- WCAG luminance (rel. to D65) -------------------------------------------

function relativeLuminance([r, g, b]) {
  const [rL, gL, bL] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL
}

function wcagRatioVsBlack(rgb) {
  // black has luma 0 → ratio = (L + 0.05) / 0.05 = L*20 + 1
  return relativeLuminance(rgb) * 20 + 1
}

function wcagRatioVsWhite(rgb) {
  // white has luma 1 → ratio = (1 + 0.05) / (L + 0.05)
  return 1.05 / (relativeLuminance(rgb) + 0.05)
}

// --- Encoding ---------------------------------------------------------------

function rgbToHex([r, g, b]) {
  const r8 = Math.round(clampUnit(r) * 255)
  const g8 = Math.round(clampUnit(g) * 255)
  const b8 = Math.round(clampUnit(b) * 255)
  return '#' + [r8, g8, b8].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()
}
function rgbToRgbaString(rgb, alpha) {
  const r8 = Math.round(clampUnit(rgb[0]) * 255)
  const g8 = Math.round(clampUnit(rgb[1]) * 255)
  const b8 = Math.round(clampUnit(rgb[2]) * 255)
  return `rgba(${r8}, ${g8}, ${b8}, ${alpha})`
}

// --- OKLCH round-trip with sRGB gamut clip ----------------------------------

function oklchToSrgb(LCh) {
  const lab = oklchToOklab(LCh)
  const lin = oklabToLinearSrgb(lab)
  return [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])].map(clampUnit)
}

// --- Public -----------------------------------------------------------------

export function normalizeAccent(input) {
  const rgb = parseInput(input)
  if (!rgb) return DEFAULT_STOCK

  const lin = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]
  const lab = linearSrgbToOklab(lin)
  let [L, C, h] = oklabToOklch(lab)

  // Monochrome guard: greys/black/white → bright off-white fallback.
  if (C < MONOCHROME_CHROMA) return MONOCHROME_FALLBACK

  // Lightness clamp into the legible glow band on #000.
  if (L < L_MIN) L = L_MIN
  if (L > L_MAX) L = L_MAX

  // Chroma lift to keep things vibrant.
  if (C < C_MIN) C = C_MIN

  // Compose accent; if it fails WCAG vs black, lift L until it does (or
  // we hit the ceiling).
  let accentRgb = oklchToSrgb([L, C, h])
  let attempts = 0
  while (wcagRatioVsBlack(accentRgb) < WCAG_MIN && L < 0.98 && attempts < 12) {
    L = Math.min(0.98, L + 0.03)
    accentRgb = oklchToSrgb([L, C, h])
    attempts++
  }

  const brightRgb = oklchToSrgb([Math.min(0.98, L + 0.10), C, h])
  const deepRgb   = oklchToSrgb([Math.max(0.20, L - 0.10), C, h])

  const luma = relativeLuminance(accentRgb)
  const contrast = luma > LUMA_TEXT_THRESHOLD ? '#0A0C00' : '#FFFFFF'

  // --- Light-mode ramp: SAME hue, MUTED + gently darkened for a calm read ---
  // Independent of the dark ramp above (which stays untouched). Cap the chroma
  // so vivid brands don't render as a loud saturated fill on white, then lower
  // L only until it clears the gentle WCAG_WHITE_MIN. The result is a soft,
  // eye-friendly tone that still carries the brand hue - not the harsh, fully
  // saturated dark colour a strict target produced.
  const onC = Math.min(C, ONLIGHT_CHROMA_MAX)
  let onL = Math.min(L, 0.64)
  let onLightRgb = oklchToSrgb([onL, onC, h])
  let onAttempts = 0
  while (wcagRatioVsWhite(onLightRgb) < WCAG_WHITE_MIN && onL > 0.30 && onAttempts < 20) {
    onL = Math.max(0.30, onL - 0.03)
    onLightRgb = oklchToSrgb([onL, onC, h])
    onAttempts++
  }
  const onLightDeepRgb   = oklchToSrgb([Math.max(0.24, onL - 0.07), onC, h])
  const onLightBrightRgb = onLightDeepRgb  // "bright" = a touch deeper for emphasis; never louder
  const onLightLuma = relativeLuminance(onLightRgb)

  return {
    accent:   rgbToHex(accentRgb),
    bright:   rgbToHex(brightRgb),
    deep:     rgbToHex(deepRgb),
    glow:     rgbToRgbaString(accentRgb, 0.45),
    wash:     rgbToRgbaString(accentRgb, 0.08),
    contrast,
    monochrome: false,
    wcagAccentVsBlack: wcagRatioVsBlack(accentRgb),
    // Light-mode ramp (consumed via body.theme-light remap of --accent*).
    onLight:         rgbToHex(onLightRgb),
    onLightBright:   rgbToHex(onLightBrightRgb),
    onLightDeep:     rgbToHex(onLightDeepRgb),
    onLightGlow:     rgbToRgbaString(onLightRgb, 0.13),
    onLightWash:     rgbToRgbaString(onLightRgb, 0.06),
    onLightContrast: onLightLuma > LUMA_TEXT_THRESHOLD ? '#0A0C00' : '#FFFFFF',
  }
}

export default normalizeAccent
