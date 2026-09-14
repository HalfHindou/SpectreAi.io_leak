/**
 * Scrollbar tints — user-selectable, shared by LITE and PRO.
 *
 * The whole feature is CSS variables. Picking a tint writes ONE data attribute
 * on <html> (see use-scroll-tint.js); the paint is done by the
 * `html[data-sb-tint="…"]` blocks in index.css. There is no per-scroll work, no
 * listener, no re-render — the scrollbar is repainted by the compositor.
 *
 * `swatch` is only for the picker chip in the UI.
 *
 * ⚠️ FIREFOX renders the COLOUR but never the glass: Gecko exposes only
 * `scrollbar-width` + `scrollbar-color`, so there is no gradient, ring or
 * radius there. Every tint degrades to a flat line. Nothing can change that,
 * so the picker says so rather than promising a look Firefox cannot draw.
 *
 * `default` deliberately stays warm-white — design-system.md §K keeps colour
 * out of default chrome. A tinted bar is a USER CHOICE, which is exactly what
 * makes violet legitimate here.
 */
export const SCROLL_TINTS = [
  {
    id: 'default',
    label: 'Warm white',
    swatch: 'linear-gradient(180deg, rgba(245,245,247,.85), rgba(245,245,247,.35))',
  },
  {
    id: 'violet',
    label: 'Violet',
    swatch: 'linear-gradient(180deg, #c4b2ff, #a78bfa 55%, #7c5cf0)',
  },
  {
    id: 'mint',
    label: 'Mint',
    swatch: 'linear-gradient(180deg, #97fce4, #50e3c2 55%, #2fae91)',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: 'linear-gradient(180deg, #fcd68a, #f59e0b 55%, #b8730a)',
  },
  {
    id: 'rose',
    label: 'Rose',
    swatch: 'linear-gradient(180deg, #f9a8d4, #ec4899 55%, #a81f62)',
  },
  {
    id: 'ice',
    label: 'Ice',
    swatch: 'linear-gradient(180deg, #bae6fd, #38bdf8 55%, #0369a1)',
  },
]

export const SCROLL_TINT_IDS = SCROLL_TINTS.map((t) => t.id)

export const isScrollTint = (id) => SCROLL_TINT_IDS.includes(id)

export const DEFAULT_SCROLL_TINT = 'default'
