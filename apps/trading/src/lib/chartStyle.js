/**
 * chartStyle — the CHART's own appearance channel.
 *
 * Deliberately SEPARATE from the platform Appearance studio: skins,
 * background tones and accents must never restyle the chart (Gleb,
 * 2026-07-03). Traders customize the chart itself — background, axis,
 * grid, candles, line — from the dedicated toolbar control
 * (components/ChartStyleControl), persisted in useSettingsStore.
 *
 * Every field is null by default = the stock chart look, untouched.
 * Consumers (TradingViewAdvanced iframe, TradingChart native canvas,
 * the lightweight-charts instance) resolve concrete colors through
 * resolveChartStyle() so all three stay in lockstep.
 */

export const CHART_STYLE_DEFAULTS = Object.freeze({
  bg: null,          // hex | null -> stock #111113
  up: null,          // hex | null -> stock --bull #10B981 (buy candles)
  down: null,        // hex | null -> stock --bear #EF4444 (sell candles)
  candleBright: 0,   // -50..50 lightness scale on BOTH candle colors (0 = as picked)
  line: null,        // hex | null -> auto (token brand color)
  lineBright: 0,     // -50..50 lightness scale on the picked line color (0 = as picked)
  axis: null,        // 'dim' | null (default) | 'bright'
  grid: null,        // 'off' | null (subtle) | 'strong'
})

export const BRIGHT_MIN = -50
export const BRIGHT_MAX = 50

export function clampBright(value) {
  const n = Math.round(Number(value) || 0)
  return Math.max(BRIGHT_MIN, Math.min(BRIGHT_MAX, n))
}

export const CHART_BG_PRESETS = [
  { id: 'stock',    label: 'Stock',    hex: null },      // #111113
  { id: 'void',     label: 'Void',     hex: '#000000' },
  { id: 'graphite', label: 'Graphite', hex: '#131316' },
  { id: 'midnight', label: 'Midnight', hex: '#0B1120' },
  { id: 'mocha',    label: 'Mocha',    hex: '#150F09' },
]

/** Candle pairs. up/down null = the stock bull/bear palette. */
export const CHART_CANDLE_PRESETS = [
  { id: 'stock', label: 'Classic',     up: null,      down: null },
  { id: 'mint',  label: 'Mint Coral',  up: '#34E89E', down: '#FF5169' },
  { id: 'ocean', label: 'Blue Red',    up: '#3B82F6', down: '#EF4444' },
  { id: 'mono',  label: 'Mono',        up: '#E4E4E7', down: '#5B5F66' },
  { id: 'neon',  label: 'Neon',        up: '#00FF87', down: '#FF3355' },
]

export const CHART_LINE_PRESETS = [
  { id: 'auto',   label: 'Auto',   hex: null },        // token brand color
  { id: 'white',  label: 'White',  hex: '#F5F5F7' },
  { id: 'lime',   label: 'Lime',   hex: '#C6FF3A' },
  { id: 'cyan',   label: 'Cyan',   hex: '#67E8F9' },
  { id: 'violet', label: 'Violet', hex: '#A78BFA' },
  { id: 'amber',  label: 'Amber',  hex: '#FFB000' },
]

export const CHART_AXIS_LEVELS = [
  { id: 'dim',   label: 'Dim' },
  { id: null,    label: 'Default' },
  { id: 'bright', label: 'Bright' },
]

export const CHART_GRID_LEVELS = [
  { id: 'off',   label: 'Off' },
  { id: null,    label: 'Subtle' },
  { id: 'strong', label: 'Strong' },
]

const HEX = /^#[0-9a-fA-F]{6}$/
const cleanHex = (v) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : null)

/** Store-level guard: keep only known fields with valid values. */
export function sanitizeChartStyle(patch) {
  const out = {}
  if (!patch || typeof patch !== 'object') return out
  if ('bg' in patch) out.bg = cleanHex(patch.bg)
  if ('up' in patch) out.up = cleanHex(patch.up)
  if ('down' in patch) out.down = cleanHex(patch.down)
  if ('candleBright' in patch) out.candleBright = clampBright(patch.candleBright)
  if ('line' in patch) out.line = cleanHex(patch.line)
  if ('lineBright' in patch) out.lineBright = clampBright(patch.lineBright)
  if ('axis' in patch) out.axis = patch.axis === 'dim' || patch.axis === 'bright' ? patch.axis : null
  if ('grid' in patch) out.grid = patch.grid === 'off' || patch.grid === 'strong' ? patch.grid : null
  return out
}

export function isStockChartStyle(style) {
  if (!style) return true
  return !style.bg && !style.up && !style.down && !style.candleBright
    && !style.line && !style.lineBright && !style.axis && !style.grid
}

/**
 * The platform tone ladder's chart surface (--ob-chart, re-derived inline on
 * <html> by lib/bgTone.js when a tone is picked). Used when the user keeps
 * "chart follows theme" marked: picking a skin / background tone re-tones the
 * chart too.
 *
 * This read USED to be --ob-surface-2 (#0E0F11), which is the PANEL tier - so
 * "follows theme" is on by default and the stock #111113 below was never
 * actually reached. That is why the chart rendered as a near-black hole
 * regardless of the stock default. --ob-chart is the chart's own tier and
 * defaults to exactly the Research Zone's chart colour.
 */
export function themeChartSurface(fallback = '#111113') {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ob-chart').trim()
    return v || fallback
  } catch { return fallback }
}

/** Hue-preserving lightness scale (same model as the tone depth). */
export function scaleHexColor(hex, factor) {
  const c = cleanHex(hex)
  if (!c) return hex
  const ch = (i) => {
    const v = Math.round(parseInt(c.slice(i, i + 2), 16) * factor)
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
  }
  return `#${ch(1)}${ch(3)}${ch(5)}`.toUpperCase()
}

/**
 * Resolve concrete colors for a chart consumer.
 * Day mode keeps its own bg/axis/grid (light surfaces stay light);
 * custom candles + line are respected in both themes.
 * Background priority: explicit chart bg > platform tone surface (when
 * opts.followTheme, the studio's "apply to chart" mark - default ON) > stock.
 */
export function resolveChartStyle(style = CHART_STYLE_DEFAULTS, dayMode = false, opts = {}) {
  const s = style || CHART_STYLE_DEFAULTS
  // Dark defaults are the Research Zone's exact axis/grid values
  // (apps/research/src/components/TradingViewAdvanced.jsx) so the same asset
  // reads identically across both platforms. Day mode already matched.
  // NOTE the axis ladder was re-pitched, not just shifted: `bright` is now
  // 0.6, i.e. EXACTLY the previous default. A 2026-07 pass had lifted the
  // default 0.3 -> 0.6 calling 0.3 "too faint to read comfortably", so that
  // preference is preserved as one click on the Axis control rather than
  // being thrown away.
  const axisByLevel = dayMode
    ? { dim: 'rgba(100, 116, 139, 0.55)', default: '#94a3b8', bright: '#475569' }
    : { dim: 'rgba(245, 245, 247, 0.18)', default: 'rgba(245, 245, 247, 0.3)', bright: 'rgba(245, 245, 247, 0.6)' }
  const gridByLevel = dayMode
    ? { off: 'rgba(0, 0, 0, 0)', default: 'rgba(0, 0, 0, 0.03)', strong: 'rgba(0, 0, 0, 0.08)' }
    : { off: 'rgba(0, 0, 0, 0)', default: 'rgba(255, 255, 255, 0.02)', strong: 'rgba(255, 255, 255, 0.08)' }

  const candleFactor = 1 + (s.candleBright || 0) / 100
  const up = scaleHexColor(s.up || (dayMode ? '#059669' : '#10B981'), candleFactor)
  const down = scaleHexColor(s.down || (dayMode ? '#DC2626' : '#EF4444'), candleFactor)

  return {
    bg: dayMode
      ? '#ffffff'
      // #111113 matches the Research Zone's TradingView chart
      // (apps/research/src/components/TradingViewAdvanced.jsx:1041) so the
      // same asset reads identically across both platforms. It is also a
      // touch lighter than the previous #0E1014, which sits better above the
      // lifted page substrate (--ob-page #0A0B0D).
      : (s.bg || (opts.followTheme ? themeChartSurface() : '#111113')),
    axisText: axisByLevel[s.axis || 'default'],
    grid: gridByLevel[s.grid || 'default'],
    up,
    down,
    // Stock wicks are the bright bull/bear variants; custom candles use
    // the body color for wicks too (uniform, predictable). Both follow
    // the candle brightness offset.
    wickUp: scaleHexColor(s.up || (dayMode ? '#10B981' : '#34D399'), candleFactor),
    wickDown: scaleHexColor(s.down || (dayMode ? '#EF4444' : '#F87171'), candleFactor),
    // Picked line color with the brightness offset baked in.
    // null = caller falls back to the token brand color.
    line: s.line ? scaleHexColor(s.line, 1 + (s.lineBright || 0) / 100) : null,
  }
}
