/**
 * decorSkins — the DECORATIVE skin channel (CS:GO-style cosmetics).
 *
 * Independent from Themes (tone+accent bundles in lib/skins.js): a skin
 * is a FINISH — large continuous line-art murals wrapping the chrome,
 * like a weapon skin wraps the weapon body. NOT scattered icons (v6's
 * dotted-spots approach was rejected: small elements read as cartoon).
 *
 * Two rendering sinks share one art source (SkinArt/murals.js + the
 * small legacy motifs kept only for chart watermark / empty-state
 * mascots, SkinArt/motifs.js):
 *
 *   - components/SkinLayer: page-level fixed layer — two HUGE corner
 *     compositions (bottom-left / top-right), never over the chart's
 *     data band (panels cover most of them; they live in the margins)
 *   - styles/skins.css: full-surface overlay rules consuming the
 *     --skin-* CSS vars this engine writes inline on <html> (left
 *     column, right panel, token banner, data tabs, chart watermark,
 *     empty-state mascots)
 *
 * `null` skin = no decorations (stock terminal). Day mode clears all
 * vars (white line-art on white = invisible) — the same contract as
 * applyBgTone/applyAccent. Tiers ride SKIN_TIERS and are the future
 * hook for volume-based unlocks + the marketplace (ids stay stable).
 */

import { MOTIFS, svgToDataUri } from '../components/SkinArt/motifs'
import { MURALS } from '../components/SkinArt/murals'
import { SKIN_TIERS } from './skins'

export const DEFAULT_DECOR_SKIN = null

/**
 * Page-layer template shared by every skin: two large corner pieces,
 * anchored so the art bleeds off the viewport edge (CS:GO wrap feel).
 * Sizes track the viewport via vmin with a px ceiling; w/h pairs match
 * each mural's viewBox ratio (heroA 440x440, heroB 460x300) so the
 * composition hugs its corner instead of letterboxing away from it.
 */
export const HERO_PIECES = [
  {
    key: 'heroA',
    style: { left: '-4%', bottom: '-6%' },
    w: 'min(56vmin, 600px)',
    h: 'min(56vmin, 600px)',
    opacity: 0.14,
    drift: 'a',
  },
  {
    key: 'heroB',
    style: { right: '-2%', top: '-3%' },
    w: 'min(48vmin, 520px)',
    h: 'min(31.3vmin, 339px)',
    opacity: 0.12,
    drift: 'c',
  },
]

/**
 * slots — art key per surface. left/right/banner/tabs resolve from
 * MURALS (full-surface compositions); watermark/mascot resolve from
 * MOTIFS (single small marks are still right for those two spots).
 * `preview` names the mural shown as the studio swatch.
 *
 * Labels are the popular franchise names per Gleb's explicit call
 * (2026-07-03). NOTE: licensed IP — needs legal review before public
 * launch/marketplace. The ART stays original; ids stay stable.
 */
export const DECOR_SKINS = [
  {
    id: 'galactic', label: 'Star Wars', tier: 'epic',
    tagline: 'A ringed giant and fighter squadrons etched across the terminal.',
    preview: 'tabs',
    slots: {
      left: 'left', right: 'right', banner: 'banner', tabs: 'tabs',
      watermark: 'orbit', mascot: 'astronaut',
    },
  },
  {
    id: 'mecha', label: 'Transformers', tier: 'epic',
    tagline: 'Drivetrains, circuit buses and armor plate over the chrome.',
    preview: 'tabs',
    slots: {
      left: 'left', right: 'right', banner: 'banner', tabs: 'tabs',
      watermark: 'gear', mascot: 'bot',
    },
  },
  {
    id: 'kawaii', label: 'Hello Kitty', tier: 'rare',
    tagline: 'Peeking cats, paw parades and heart strings. Softly.',
    preview: 'tabs',
    slots: {
      left: 'left', right: 'right', banner: 'banner', tabs: 'tabs',
      watermark: 'catFace', mascot: 'catFace',
    },
  },
  {
    id: 'football', label: 'Football', tier: 'rare',
    tagline: 'Matchday diagrams - top bins, silverware, confetti.',
    preview: 'tabs',
    slots: {
      left: 'left', right: 'right', banner: 'banner', tabs: 'tabs',
      watermark: 'ball', mascot: 'trophy',
    },
  },
  {
    id: 'degen', label: 'Crypto', tier: 'grail',
    tagline: 'Liftoff over the chart wall. Moon in sight. Full send.',
    preview: 'tabs',
    slots: {
      left: 'left', right: 'right', banner: 'banner', tabs: 'tabs',
      watermark: 'coin', mascot: 'rocket',
    },
  },
]

export { SKIN_TIERS }

export function isDecorSkinId(id) {
  return DECOR_SKINS.some((s) => s.id === id)
}

export function sanitizeDecorSkin(id) {
  return isDecorSkinId(id) ? id : null
}

export function getDecorSkin(id) {
  return DECOR_SKINS.find((s) => s.id === id) || null
}

const SLOT_TO_VAR = {
  left: '--skin-left',
  right: '--skin-right',
  banner: '--skin-banner',
  tabs: '--skin-tabs',
  watermark: '--skin-watermark',
  mascot: '--skin-mascot',
}

const SKIN_VARS = Object.values(SLOT_TO_VAR)

/**
 * Write/clear the skin's slot art as data-URI custom properties on <html>.
 * styles/skins.css consumes them via generic rules gated on the
 * .app.skin-<id> class (set reactively in App.jsx). Idempotent; clears
 * in light theme.
 */
export function applyDecorSkin(id) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const skin = getDecorSkin(sanitizeDecorSkin(id))
  if (!skin || document.body.classList.contains('theme-light')) {
    for (const v of SKIN_VARS) root.style.removeProperty(v)
    return
  }
  const art = { ...(MOTIFS[skin.id] || {}), ...(MURALS[skin.id] || {}) }
  for (const [slot, artKey] of Object.entries(skin.slots)) {
    const cssVar = SLOT_TO_VAR[slot]
    const svg = art[artKey]
    if (cssVar && svg) root.style.setProperty(cssVar, svgToDataUri(svg))
  }
}
