/**
 * bgTone — background tone engine for the dark theme.
 *
 * Every dark surface in the app derives from the five obsidian ladder
 * tokens in styles/design-tokens.css (--ob-void, --ob-surface-1..4);
 * the legacy aliases (--bg-void, --bg-base, --bg-surface, ...) all
 * point back at them. Repainting just these five vars re-tones the
 * whole platform — panels, cards, popovers, the chart container.
 *
 * Instead of a raw brightness lift (mixing toward white desaturates
 * and flattens — reads washed-out), the user picks a CURATED TONE:
 * a hand-tuned five-step black ladder (neutral, blue, steel, warm...).
 * A fine DEPTH offset then scales each step multiplicatively
 * (rgb * factor), which preserves the tone's hue and the ladder's
 * contrast ratios — the background stays a premium black at every
 * setting, it just becomes a deeper or softer one.
 *
 * Day mode (body.theme-light) paints explicit light colors per
 * component and does not use the ladder — overrides are cleared there.
 */

export const DEPTH_MIN = -50
export const DEPTH_MAX = 50
export const DEFAULT_TONE = 'obsidian'

const TOKEN_ORDER = ['--ob-void', '--ob-surface-1', '--ob-surface-2', '--ob-surface-3', '--ob-surface-4']

/**
 * The chart plane (--ob-chart) is DERIVED, not a sixth ladder step - it sits
 * between surface-2 and surface-3, so every curated tone gets a chart colour
 * for free instead of needing a hand-tuned entry. Without this the chart would
 * stay pinned to the obsidian default while the rest of the app re-tones.
 * 0.43 is the mix that reproduces the stock #111113 from the stock ladder
 * (see --ob-chart in styles/design-tokens.css).
 */
const CHART_TOKEN = '--ob-chart'
const CHART_MIX = 0.43

// Stock values mirror styles/design-tokens.css — used as the obsidian
// ladder fallback and in case a computed read races the stylesheet load.
const STOCK_LADDER = ['#000000', '#08090A', '#0E0F11', '#15171A', '#1C1F23']

/**
 * Curated tones. Each ladder is [void, surface-1..4], hand-tuned so
 * every step stays a believable "black" — no gray charcoal, no neon.
 * `ladder: null` = the stock stylesheet palette (captured live so a
 * future design-tokens retune stays honored).
 */
export const TONES = [
  { id: 'pure-black', label: 'Pure Black', ladder: ['#000000', '#020202', '#060607', '#0B0B0C', '#101012'] },
  { id: 'obsidian',   label: 'Obsidian',   ladder: null },
  { id: 'graphite',   label: 'Graphite',   ladder: ['#010101', '#0C0C0D', '#131315', '#1B1B1E', '#242427'] },
  { id: 'slate',      label: 'Slate',      ladder: ['#020305', '#0B1016', '#111820', '#18212B', '#202B38'] },
  { id: 'midnight',   label: 'Midnight',   ladder: ['#01020B', '#060B1A', '#0B1226', '#101A35', '#172345'] },
  { id: 'mocha',      label: 'Mocha',      ladder: ['#050302', '#100C07', '#17110B', '#1F1810', '#292015'] },
  { id: 'rose',       label: 'Rosé',       ladder: ['#040103', '#10080D', '#170C13', '#1F111A', '#291723'] },
  { id: 'gold',       label: 'Gold',       ladder: ['#040300', '#100C04', '#171107', '#1F170A', '#2A1F0D'] },
]

export function isToneId(id) {
  return TONES.some((t) => t.id === id)
}

export function getTone(id) {
  return TONES.find((t) => t.id === id) || TONES.find((t) => t.id === DEFAULT_TONE)
}

export function clampDepth(value) {
  const n = Math.round(Number(value) || 0)
  return Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, n))
}

function parseColor(str) {
  if (!str) return null
  const s = String(str).trim()
  if (s[0] === '#') {
    const hex = s.slice(1)
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ]
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ]
    }
    return null
  }
  const m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (m) return [+m[1], +m[2], +m[3]]
  return null
}

let _stockBase = null // [[r,g,b] x5] — the untouched stylesheet palette

function captureStock() {
  if (_stockBase) return _stockBase
  const root = document.documentElement
  const computed = getComputedStyle(root)
  _stockBase = TOKEN_ORDER.map((token, i) => {
    // If an inline override is already present (HMR re-eval mid-session)
    // the computed value is the ADJUSTED color — fall back to the stock
    // constant instead of capturing our own output as the base.
    const declared = root.style.getPropertyValue(token)
      ? null
      : computed.getPropertyValue(token)
    return parseColor(declared) || parseColor(STOCK_LADDER[i])
  })
  return _stockBase
}

const scale = (c, f) => Math.max(0, Math.min(255, Math.round(c * f)))

/**
 * Resolve the final [r,g,b] ladder for a tone + depth.
 * Depth is a multiplicative lightness factor (1 + depth/100 -> 0.5..1.5):
 * hue-preserving in both directions, so a blue-black deepens into a
 * darker blue-black rather than graying out.
 */
export function resolveLadder(toneId, depth) {
  const tone = getTone(toneId)
  const base = tone.ladder
    ? tone.ladder.map(parseColor)
    : (typeof document !== 'undefined' ? captureStock() : STOCK_LADDER.map(parseColor))
  const f = 1 + clampDepth(depth) / 100
  return base.map(([r, g, b]) => [scale(r, f), scale(g, f), scale(b, f)])
}

/**
 * Swatch colors for the tone picker: [surface-1, surface-4] hexes at
 * neutral depth, so each swatch previews the ladder itself.
 */
export function tonePreview(toneId) {
  const tone = getTone(toneId)
  const ladder = tone.ladder || STOCK_LADDER
  return { low: ladder[1], high: ladder[4] }
}

/**
 * Apply a tone + depth to the obsidian ladder.
 * The default tone at depth 0 removes every override so the stylesheet
 * values rule untouched; light theme always clears.
 * Safe to call repeatedly with the same values (idempotent).
 */
export function applyBgTone(toneId, depth) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const tone = getTone(toneId)
  const v = clampDepth(depth)
  if ((tone.id === DEFAULT_TONE && v === 0) || document.body.classList.contains('theme-light')) {
    for (const token of TOKEN_ORDER) root.style.removeProperty(token)
    root.style.removeProperty(CHART_TOKEN)
    return
  }
  const ladder = resolveLadder(tone.id, v)
  TOKEN_ORDER.forEach((token, i) => {
    const [r, g, b] = ladder[i]
    root.style.setProperty(token, `rgb(${r}, ${g}, ${b})`)
  })
  // Chart plane, derived from the same ladder (see CHART_MIX above).
  const [r2, g2, b2] = ladder[2]
  const [r3, g3, b3] = ladder[3]
  const mix = (a, b) => Math.round(a + (b - a) * CHART_MIX)
  root.style.setProperty(CHART_TOKEN, `rgb(${mix(r2, r3)}, ${mix(g2, g3)}, ${mix(b2, b3)})`)
}
