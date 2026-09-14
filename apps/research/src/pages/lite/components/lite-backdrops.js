import { wallpaperCss } from './lite-wallpapers'
// lite-backdrops.js - the LITE theme backdrop catalog (photo scenes, gradients,
// auras, solids, designed wallpapers, paper canvases) + resolvers. Extracted from
// lite-page.jsx so other surfaces (Pro Theme Studio test) can reuse the exact same
// swatch set without importing the whole LITE page module. lite-page re-exports
// everything, so existing import sites are unchanged.
export const BG_PHOTO_IDS = [
  'photo-1464822759023-fed622ff2c3b',
  'photo-1507525428034-b723cf961d3e',
  'photo-1506905925346-21bda4d32df4',
  'photo-1519046904884-53103b34b206',
  'photo-1519681393784-d120267933ba',
]

// Single-scene options for the background picker ("Daily mix" rotates the
// classics above). Customs live in their own localStorage key.
export const BG_SCENES = [
  { id: 'alps', name: 'Alps', photo: 'photo-1464822759023-fed622ff2c3b' },
  { id: 'shore', name: 'Shore', photo: 'photo-1507525428034-b723cf961d3e' },
  { id: 'peaks', name: 'Peaks', photo: 'photo-1506905925346-21bda4d32df4' },
  { id: 'night', name: 'Night', photo: 'photo-1519681393784-d120267933ba' },
  { id: 'aurora', name: 'Aurora', photo: 'photo-1531366936337-7c912a4589a7' },
  { id: 'forest', name: 'Forest', photo: 'photo-1441974231531-c6227db76b6e' },
  { id: 'ocean', name: 'Ocean', photo: 'photo-1505142468610-359e7d316be0' },
  { id: 'lake', name: 'Lake', photo: 'photo-1439066615861-d1af74d74000' },
  { id: 'city', name: 'City', photo: 'photo-1519501025264-65ba15a82390' },
  { id: 'galaxy', name: 'Galaxy', photo: 'photo-1419242902214-272b3f66ee7a' },
  { id: 'sunrise', name: 'Sunrise', photo: 'photo-1470071459604-3b5ec3a7fe05' },
  { id: 'mist', name: 'Mist', photo: 'photo-1418065460487-3e41a6c84dc5' },
  { id: 'falls', name: 'Falls', photo: 'photo-1433086966358-54859d0ed716' },
  { id: 'dusklake', name: 'Dusk Lake', photo: 'photo-1501785888041-af3ef285b470' },
  { id: 'meadow', name: 'Meadow', photo: 'photo-1472214103451-9374bd1c798e' },
  { id: 'grove', name: 'Grove', photo: 'photo-1447752875215-b2761acb3c5d' },
  { id: 'valley', name: 'Valley', photo: 'photo-1426604966848-d7adac402bff' },
  { id: 'ridge', name: 'Ridge', photo: 'photo-1454496522488-7a8e488e8606' },
  { id: 'daybreak', name: 'Daybreak', photo: 'photo-1475924156734-496f6cac6ec1' },
]

// Curated photo collections (all IDs curl-verified against the Unsplash CDN).
export const BG_COSMOS = [
  { id: 'c-nebula', name: 'Nebula', photo: 'photo-1462331940025-496dfbfc7564' },
  { id: 'c-starfield', name: 'Starfield', photo: 'photo-1444703686981-a3abbc4d4fe3' },
  { id: 'c-earth', name: 'Blue Marble', photo: 'photo-1446776811953-b23d57bd21aa' },
  { id: 'c-grid', name: 'Signal', photo: 'photo-1451187580459-43490279c0fa' },
  { id: 'c-violet', name: 'Violet Sky', photo: 'photo-1464802686167-b939a6910659' },
  { id: 'c-milkyway', name: 'Milky Way', photo: 'photo-1502134249126-9f3755a50d78' },
  { id: 'c-stardust', name: 'Stardust', photo: 'photo-1475274047050-1d0c0975c63e' },
]

export const BG_CITY = [
  { id: 'u-downtown', name: 'Downtown', photo: 'photo-1477959858617-67f85cf4f1df' },
  { id: 'u-avenue', name: 'Avenue', photo: 'photo-1449824913935-59a10b8d2000' },
  { id: 'u-highrise', name: 'High Rise', photo: 'photo-1480714378408-67cf0d13bc1b' },
  { id: 'u-lights', name: 'City Lights', photo: 'photo-1514565131-fce0801e5785' },
  { id: 'u-skyline', name: 'Skyline', photo: 'photo-1444723121867-7a241cacace9' },
  { id: 'u-dusk', name: 'Dusk City', photo: 'photo-1470219556762-1771e7f9427d' },
  { id: 'u-tokyo', name: 'Tokyo', photo: 'photo-1490644658840-3f2e3f8c5625' },
  { id: 'u-rain', name: 'Night Rain', photo: 'photo-1502899576159-f224dc2349fa' },
]

export const BG_COLOR = [
  { id: 'k-flow', name: 'Flow', photo: 'photo-1541701494587-cb58502866ab' },
  { id: 'k-bloom', name: 'Bloom', photo: 'photo-1550859492-d5da9d8e45f3' },
  { id: 'k-prism', name: 'Prism', photo: 'photo-1557672172-298e090bd0f1' },
  { id: 'k-swirl', name: 'Swirl', photo: 'photo-1553356084-58ef4a67b2a7' },
  { id: 'k-liquid', name: 'Liquid', photo: 'photo-1620121692029-d088224ddc74' },
  { id: 'k-chrome', name: 'Chrome', photo: 'photo-1618005182384-a83a8bd57fbe' },
  { id: 'k-orchid', name: 'Orchid', photo: 'photo-1620641788421-7a1c342ea42e' },
  { id: 'k-haze', name: 'Haze', photo: 'photo-1604076913837-52ab5629fba9' },
  { id: 'k-spectrum', name: 'Spectrum', photo: 'photo-1579546929518-9e396f3cc809' },
  { id: 'k-gilded', name: 'Gilded', photo: 'photo-1614850715649-1d0106293bd1' },
  { id: 'k-velvet', name: 'Velvet', photo: 'photo-1614851099511-773084f6911d' },
  { id: 'k-depths', name: 'Depths', photo: 'photo-1550684376-efcbd6e3f031' },
]

// One combined lookup - every photo group resolves through mode:'scene'.
export const ALL_PHOTO_SCENES = [...BG_SCENES, ...BG_COSMOS, ...BG_CITY, ...BG_COLOR]

// CSS-built backgrounds: gradients, solids, and art styles (no image cost).
export const BG_GRADIENTS = [
  { id: 'g-aurora', name: 'Aurora', css: 'linear-gradient(135deg, #0b1d3a 0%, #123c50 38%, #1d6b58 68%, #4fae7f 100%)' },
  { id: 'g-dusk', name: 'Dusk', css: 'linear-gradient(160deg, #1a1033 0%, #4a2a6b 45%, #b0688a 85%, #e8a87c 100%)' },
  { id: 'g-ocean', name: 'Deep Ocean', css: 'linear-gradient(180deg, #04121f 0%, #0a2b45 55%, #14557a 100%)' },
  { id: 'g-ember', name: 'Ember', css: 'linear-gradient(150deg, #1a0b0b 0%, #4a1520 55%, #93321f 100%)' },
  { id: 'g-royal', name: 'Royal', css: 'linear-gradient(140deg, #0d0b2a 0%, #2a1a5e 55%, #4a3a9e 100%)' },
  { id: 'g-mono', name: 'Graphite', css: 'linear-gradient(165deg, #26262c 0%, #131316 60%, #060608 100%)' },
  { id: 'g-mint', name: 'Mint', css: 'linear-gradient(150deg, #04211c 0%, #0d4a3a 60%, #1a7a5a 100%)' },
  { id: 'g-gold', name: 'Golden Hour', css: 'linear-gradient(155deg, #241505 0%, #6b3d0f 55%, #c98a2a 100%)' },
  { id: 'g-pearlmist', name: 'Pearl Mist', light: true, css: 'linear-gradient(150deg, #ffffff 0%, #f2f4f8 45%, #e8ecf3 100%)' },
  { id: 'g-ivorydawn', name: 'Ivory Dawn', light: true, css: 'linear-gradient(155deg, #fffdf7 0%, #f8f0e3 55%, #f0e2cf 100%)' },
  { id: 'g-silverlight', name: 'Silver Light', light: true, css: 'linear-gradient(160deg, #fafbfc 0%, #eceef2 50%, #dfe3ea 100%)' },
  { id: 'g-blushwhite', name: 'Blush White', light: true, css: 'linear-gradient(145deg, #ffffff 0%, #faf0f2 55%, #f3e2e8 100%)' },
  { id: 'g-skywash', name: 'Sky Wash', light: true, css: 'linear-gradient(170deg, #f8fbff 0%, #e9f2fb 55%, #d8e8f7 100%)' },
  { id: 'g-frost', name: 'Frost', light: true, css: 'linear-gradient(150deg, #f6fbfb 0%, #e7f3f2 55%, #d9ebec 100%)' },
  { id: 'g-truepearl', name: 'True Pearl', light: true, css: 'radial-gradient(60% 50% at 18% 12%, rgba(255, 214, 232, 0.35) 0%, transparent 60%), radial-gradient(55% 48% at 84% 16%, rgba(206, 228, 255, 0.35) 0%, transparent 60%), radial-gradient(50% 45% at 78% 88%, rgba(214, 246, 231, 0.3) 0%, transparent 58%), #ffffff' },
  { id: 'g-polar', name: 'Polar White', light: true, css: 'linear-gradient(165deg, #ffffff 0%, #fbfdfe 55%, #f2f7fa 100%)' },
  { id: 'g-highnoon', name: 'High Noon', light: true, css: 'linear-gradient(160deg, #fffefb 0%, #fdfaf3 55%, #f7f3ea 100%)' },
  { id: 'g-opal', name: 'Opal', light: true, css: 'linear-gradient(120deg, rgba(255, 226, 240, 0.4) 0%, rgba(224, 238, 255, 0.4) 30%, rgba(224, 250, 240, 0.4) 60%, rgba(250, 240, 222, 0.4) 100%), #fefefe' },
]

export const BG_SOLIDS = [
  { id: 's-void', name: 'Void', css: '#0a0a0e' },
  { id: 's-navy', name: 'Navy', css: '#0e1a2b' },
  { id: 's-forest', name: 'Forest', css: '#0f2318' },
  { id: 's-wine', name: 'Wine', css: '#260f1c' },
  { id: 's-slate', name: 'Slate', css: '#1b2430' },
  { id: 's-plum', name: 'Plum', css: '#1e1030' },
  { id: 's-espresso', name: 'Espresso', css: '#221610' },
  { id: 's-storm', name: 'Storm', css: '#20262e' },
  { id: 's-purewhite', name: 'Pure White', light: true, css: '#ffffff' },
  { id: 's-ivory', name: 'Ivory', light: true, css: '#fdfaf1' },
  { id: 's-snowwhite', name: 'Snow White', light: true, css: '#f8fafc' },
  { id: 's-bone', name: 'Bone', light: true, css: '#f6f3ec' },
  { id: 's-cloudgray', name: 'Cloud Gray', light: true, css: '#eef0f4' },
  { id: 's-linen', name: 'Linen', light: true, css: '#f8f4ec' },
]

// Film-grain texture layer (inline SVG noise) - what separates flat CSS
// fills from something that reads as designed.
export const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='table' tableValues='0 0.06'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

// Soft multi-blob "aura" meshes - the modern gradient-mesh look, dark-leaning
// so the glass text always reads.
export const BG_MESH = [
  { id: 'm-ultra', name: 'Ultraviolet', css: `${GRAIN}, radial-gradient(at 18% 22%, rgba(124,58,237,0.42) 0, transparent 52%), radial-gradient(at 84% 14%, rgba(236,72,153,0.36) 0, transparent 54%), radial-gradient(at 68% 88%, rgba(59,130,246,0.34) 0, transparent 55%), #0b0716` },
  { id: 'm-peach', name: 'Peach Dream', css: `${GRAIN}, radial-gradient(at 22% 24%, rgba(251,146,60,0.4) 0, transparent 52%), radial-gradient(at 80% 70%, rgba(244,114,182,0.35) 0, transparent 55%), radial-gradient(at 60% 10%, rgba(254,215,170,0.2) 0, transparent 45%), #22101c` },
  { id: 'm-emerald', name: 'Emerald Haze', css: `${GRAIN}, radial-gradient(at 25% 30%, rgba(16,185,129,0.36) 0, transparent 52%), radial-gradient(at 78% 72%, rgba(6,182,212,0.3) 0, transparent 55%), radial-gradient(at 85% 15%, rgba(52,211,153,0.18) 0, transparent 45%), #05201d` },
  { id: 'm-arctic', name: 'Arctic', css: `${GRAIN}, radial-gradient(at 20% 20%, rgba(103,232,249,0.32) 0, transparent 50%), radial-gradient(at 75% 65%, rgba(59,130,246,0.34) 0, transparent 55%), radial-gradient(at 50% 100%, rgba(148,163,184,0.2) 0, transparent 50%), #0a1526` },
  { id: 'm-bloom', name: 'Midnight Bloom', css: `${GRAIN}, radial-gradient(at 30% 75%, rgba(167,139,250,0.38) 0, transparent 55%), radial-gradient(at 78% 22%, rgba(244,114,182,0.3) 0, transparent 52%), #0e0a1f` },
  { id: 'm-ember', name: 'Ember Glow', css: `${GRAIN}, radial-gradient(at 22% 78%, rgba(245,158,11,0.35) 0, transparent 52%), radial-gradient(at 78% 20%, rgba(239,68,68,0.32) 0, transparent 54%), radial-gradient(at 55% 50%, rgba(124,45,18,0.3) 0, transparent 60%), #140806` },
  { id: 'm-rose', name: 'Rosé', css: `${GRAIN}, radial-gradient(at 25% 25%, rgba(253,164,175,0.34) 0, transparent 50%), radial-gradient(at 75% 75%, rgba(225,29,72,0.28) 0, transparent 55%), #1f0a12` },
  { id: 'm-nebula', name: 'Nebula', css: `${GRAIN}, radial-gradient(at 30% 30%, rgba(99,102,241,0.36) 0, transparent 52%), radial-gradient(at 75% 70%, rgba(217,70,239,0.28) 0, transparent 55%), radial-gradient(at 85% 20%, rgba(34,211,238,0.18) 0, transparent 42%), #06040f` },
  { id: 'm-champagne', name: 'Champagne', css: `${GRAIN}, radial-gradient(at 25% 70%, rgba(234,179,8,0.28) 0, transparent 52%), radial-gradient(at 75% 25%, rgba(249,115,22,0.26) 0, transparent 55%), #171004` },
]

// Designed wallpaper assets (public/lite-bg/). Vercel serves /public with
// immutable max-age=1y, so the ?v= MUST be bumped whenever the files are
// re-mastered - same filename means clients keep year-cached old pixels.
export const bgAsset = (f) => `url('/lite-bg/${f}.jpg?v=4') center/cover no-repeat #0a0a0e`

// Bright & airy - white high-key scenes for people who like it light.
export const BG_BRIGHT = [
  { id: 'g-porcelain', name: 'Porcelain Light', light: true, css: bgAsset('g-porcelain') },
  { id: 'g-cloudwhite', name: 'Cloud White', light: true, css: bgAsset('g-cloudwhite') },
  { id: 'g-alabaster', name: 'Alabaster', light: true, css: bgAsset('g-alabaster') },
  { id: 'g-snowfield', name: 'Snowfield', light: true, css: bgAsset('g-snowfield') },
  { id: 'g-ivorysilk', name: 'Ivory Silk', light: true, css: bgAsset('g-ivorysilk') },
  { id: 'g-whitemarble', name: 'White Marble', light: true, css: bgAsset('g-whitemarble') },
  { id: 'g-daylight', name: 'Daylight Studio', light: true, css: bgAsset('g-daylight') },
  { id: 'g-pearl', name: 'Pearl Shimmer', light: true, css: bgAsset('g-pearl') },
]

// ── Neon Coast ──────────────────────────────────────────────────────────────
// Founder asked for a GTA VI backdrop section and linked Rockstar's wallpaper
// page. We do NOT ship their files: that artwork is copyrighted and the logo is
// a registered trademark, offered for personal desktop use — bundling it into a
// commercial product we sell is redistribution, and Rockstar enforces. A colour
// palette and a mood are not protectable, so this is the era built from scratch
// in CSS: Miami dusk, neon night, humid pastel haze.
//
// Pure gradients, so they cost zero bytes, scale to any panel and cannot 404.
// Every one is a full-height vertical ramp with a couple of cirrus streaks laid
// over it at a shallow angle — that thin high cloud catching the last light is
// what makes a sunset read as a sky rather than a colour wash.
const CIRRUS = `linear-gradient(-8deg, transparent 44%, rgba(255, 231, 236, 0.14) 46%, transparent 50%),
   linear-gradient(-5deg, transparent 60%, rgba(255, 240, 228, 0.11) 62%, transparent 66%),
   linear-gradient(-11deg, transparent 28%, rgba(255, 226, 240, 0.10) 30%, transparent 34%)`

// Composed pieces, not just colour ramps. A vertical gradient six times over is
// one idea repeated, which is what the first pass shipped. These build actual
// SCENES out of pure CSS — a sun with a horizon line under it, palm silhouettes
// as conic wedges, a perspective grid from repeating-linear-gradient, a skyline
// of hard-edged blocks — so the section has range without a single byte of
// artwork. Still zero requests, still resolution-independent.

/* A low sun sitting on a horizon, its lower half sliced by scanlines the way
   every piece of art from this era does it. */
const SUNBARS = `repeating-linear-gradient(180deg,
  transparent 0 6px, rgba(20, 6, 30, 0.55) 6px 10px)`

/* Palms as soft dark wedges rising off the floor. Cheap, and at a glance the
   eye reads them as fronds against the light. */
/* 🪤 TWO representational scenes were built here and CUT after looking at them:
   palm silhouettes (radial crowns read as lollipops on sticks) and a boulevard
   receding to the horizon (a conic wedge reads as a black triangle sitting ON
   the sun, not a road going away from you).

   The rule this establishes: CSS gradients render LIGHT and ATMOSPHERE
   convincingly — Sundown works because a sun is a radial gradient, Grid works
   because a floor grid is repeating lines. They do not render organic or
   perspective forms, and no amount of tuning fixed either attempt.

   🪤 2026-08-29, founder: "remove bayfront skyline". The rule used to claim
   RECTANGLES too, on the strength of Skyline and Bayfront — and at full-bleed
   they do read as buildings. But a theme is chosen from a ~110px SWATCH, and at
   that size a repeating-linear-gradient of hard bars is a BARCODE, not a city.
   Both are cut. Judge a backdrop at swatch size, because that is the only size
   at which anyone ever decides to use it. Eleven that all look deliberate beat
   thirteen where two are clip art. */
/* The floor grid, converging toward the horizon. */
const GRID = `repeating-linear-gradient(90deg,
    rgba(255, 92, 168, 0.34) 0 1px, transparent 1px 7%),
  repeating-linear-gradient(180deg,
    rgba(255, 92, 168, 0.28) 0 1px, transparent 1px 14%)`

export const BG_NEON = [
  // ── Skies ──
  { id: 'n-dusk', name: 'Dusk', css: `${CIRRUS},
    linear-gradient(180deg, #6a5f8f 0%, #8a7aa8 18%, #ab95bd 38%, #c7abc4 56%, #ddbcc2 74%, #eccfc4 90%, #f3ddcd 100%)` },
  { id: 'n-haze', name: 'Beach Haze', css: `${CIRRUS},
    linear-gradient(180deg, #93a6c9 0%, #adb2cd 24%, #c8b6c9 48%, #e2c3ba 74%, #f2dac6 100%)` },
  { id: 'n-storm', name: 'Storm Roll', css: `${CIRRUS},
    radial-gradient(90% 40% at 50% 88%, rgba(255, 186, 148, 0.3) 0%, transparent 66%),
    linear-gradient(180deg, #1b1a35 0%, #322f53 30%, #4e4470 54%, #6d5a7c 74%, #9c7580 100%)` },
  { id: 'n-strip', name: 'Sunstrip', css: `
    linear-gradient(180deg, #2b2a5e 0%, #2b2a5e 22%, #6e4f92 22%, #6e4f92 40%,
      #b06d95 40%, #b06d95 56%, #e8918d 56%, #e8918d 72%, #f7b184 72%, #f7b184 86%, #fdd0a4 86%, #fdd0a4 100%)` },

  // ── Scenes ──
  { id: 'n-sundown', name: 'Sundown', css: `
    ${SUNBARS} 0 52% / 100% 15% no-repeat,
    radial-gradient(19% 30% at 50% 60%, #ffe6a2 0 52%, #ff9f5e 76%, #ff5f86 93%, transparent 94%),
    linear-gradient(180deg, #150e38 0%, #2c1c52 24%, #5c2a68 44%, #9c4275 60%, #d3667e 69%, #22102f 69.5%, #100617 100%)` },
  { id: 'n-golden', name: 'Golden Hour', css: `${CIRRUS},
    radial-gradient(70% 40% at 50% 100%, rgba(224, 168, 140, 0.55) 0%, transparent 72%),
    linear-gradient(180deg, #b9a6c8 0%, #cbb2c3 26%, #ddb9ab 52%, #e6a98c 76%, #d99a86 100%)` },
  { id: 'n-grid', name: 'Grid', css: `
    ${GRID} 0 62% / 100% 38% no-repeat,
    linear-gradient(180deg, transparent 0 62%, rgba(10, 4, 26, 0.86) 62% 100%),
    radial-gradient(20vmax 20vmax at 50% 62%, #ff9a5c 0%, #ff3d7f 46%, transparent 68%),
    linear-gradient(180deg, #120a30 0%, #2b1150 40%, #55195e 62%, #0d0522 62.5%, #08031a 100%)` },

  // ── Nights ──
  { id: 'n-night', name: 'Neon Night', css: `${CIRRUS},
    radial-gradient(70% 40% at 50% 96%, rgba(255, 92, 168, 0.34) 0%, transparent 68%),
    linear-gradient(180deg, #0d0a24 0%, #1d1147 34%, #3d1a63 60%, #71256b 82%, #a83070 100%)` },
  { id: 'n-palm', name: 'Palm Shade', css: `${CIRRUS},
    radial-gradient(80% 46% at 50% 100%, rgba(255, 176, 130, 0.28) 0%, transparent 70%),
    linear-gradient(180deg, #10233f 0%, #1c3a5c 30%, #3b5570 55%, #7d6a86 78%, #c08a90 100%)` },
  { id: 'n-chrome', name: 'Chrome', css: `
    linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 24%),
    linear-gradient(160deg, #f5c8e0 0%, #b9a7e8 18%, #7fc7e8 34%, #f2d3a8 52%, #e79bc4 70%, #8e8ae0 86%, #6fd0dd 100%)` },
  { id: 'n-vapor', name: 'Vapor', css: `
    radial-gradient(40% 30% at 18% 22%, rgba(255, 138, 216, 0.4) 0%, transparent 70%),
    radial-gradient(44% 34% at 82% 30%, rgba(126, 200, 255, 0.36) 0%, transparent 70%),
    radial-gradient(50% 36% at 50% 92%, rgba(255, 176, 120, 0.34) 0%, transparent 72%),
    linear-gradient(180deg, #1a1040 0%, #3b1c63 42%, #6a2a70 72%, #9c3a72 100%)` },
]

// Fun & pop-culture inspired backdrops - vibe-named designed artwork.
export const BG_POP = [
  { id: 'p-kitty', name: 'Kitty', css: bgAsset('p-kitty') },
  { id: 'p-bee', name: 'Bumblebee', css: bgAsset('p-bee') },
  { id: 'p-rain', name: 'Digital Rain', css: bgAsset('p-rain') },
  { id: 'p-hyper', name: 'Hyperspace', css: bgAsset('p-hyper') },
  { id: 'p-saber', name: 'Saber Duel', css: bgAsset('p-saber') },
  { id: 'p-sakura', name: 'Sakura', css: bgAsset('p-sakura') },
  { id: 'p-8bit', name: '8-Bit', css: bgAsset('p-8bit') },
  { id: 'p-candy', name: 'Candy', css: bgAsset('p-candy') },
]

export const BG_ART = [
  { id: 'a-deco', name: 'Art Deco', css: bgAsset('a-deco') },
  { id: 'a-punk', name: 'Punk', css: bgAsset('a-punk') },
  { id: 'a-vapor', name: 'Vaporwave', css: bgAsset('a-vapor') },
  { id: 'a-cyber', name: 'Cyberpunk', css: bgAsset('a-cyber') },
  { id: 'a-kyoto', name: 'Kyoto Waves', css: bgAsset('a-kyoto') },
  { id: 'a-bauhaus', name: 'Bauhaus', css: bgAsset('a-bauhaus') },
  { id: 'a-noir', name: 'Noir', css: bgAsset('a-noir') },
  { id: 'a-seventies', name: "'70s Sun", css: bgAsset('a-seventies') },
  { id: 'a-ink', name: 'Ink Wash', css: bgAsset('a-ink') },
  { id: 'a-silk', name: 'Silk', css: bgAsset('a-silk') },
]

// Crypto-brand color worlds + designed art/pop wallpapers: REAL generated
// artwork shipped as app assets (public/lite-bg/, ~30-170KB each) - the CSS
// gradient versions read as "pixelated cheapness" at full screen (Sunny).
// Brand palettes only, vibe-safe names, no logo artwork.
export const BG_BRAND = [
  { id: 'b-lime', name: 'Lime Feather', css: bgAsset('b-lime') },
  { id: 'b-cobalt', name: 'Cobalt Ring', css: bgAsset('b-cobalt') },
  { id: 'b-golddust', name: 'Gold Dust', css: bgAsset('b-golddust') },
  { id: 'b-abyss', name: 'Abyss', css: bgAsset('b-abyss') },
  { id: 'b-solwave', name: 'Sol Wave', css: bgAsset('b-solwave') },
  { id: 'b-ether', name: 'Ether Prism', css: bgAsset('b-ether') },
  { id: 'b-satoshi', name: 'Satoshi Orange', css: bgAsset('b-satoshi') },
  { id: 'b-hypermint', name: 'Hyper Mint', css: bgAsset('b-hypermint') },
  { id: 'b-mono', name: 'Terminal Mono', css: bgAsset('b-mono') },
  { id: 'b-redline', name: 'Red Line', css: bgAsset('b-redline') },
]

// Bright backdrops (white wallpapers / white gradients / white solids) need
// the DAYLIGHT glass treatment: the standard black scrim turned them gray.
export const BRIGHT_SCENE_IDS = new Set([
  'g-pearlmist', 'g-ivorydawn', 'g-silverlight', 'g-blushwhite', 'g-skywash', 'g-frost',
  's-purewhite', 's-ivory', 's-snowwhite', 's-bone', 's-cloudgray', 's-linen',
])
export function isBrightBg(bg) {
  if (!bg) return false
  if (bg.mode === 'bright') return true
  // Any light-flagged swatch (white/pearl solids + gradients) gets the
  // daylight treatment too - the dark scrim was graying them out.
  if (resolveBgDef(bg)?.light) return true
  return BRIGHT_SCENE_IDS.has(bg.scene)
}

export function resolveBgDef(bg) {
  if (!bg) return null
  const pools = { gradient: BG_GRADIENTS, solid: BG_SOLIDS, art: BG_ART, mesh: BG_MESH, pop: BG_POP, brand: BG_BRAND, bright: BG_BRIGHT, neon: BG_NEON }
  return pools[bg.mode]?.find((x) => x.id === bg.scene) || null
}

export function resolveCssBg(bg) {
  // A user's own wallpaper is not in any static pool — it lives in IndexedDB on
  // their device and resolves to an object URL once loaded.
  if (bg?.mode === 'wall') return wallpaperCss(bg.scene)
  return resolveBgDef(bg)?.css || null
}

// Lighter grain for the light Paper canvases (0.06 reads dusty on white).
export const GRAIN_SOFT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='table' tableValues='0 0.04'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

// Paper-look canvases: light, day-legible washes. 'pearl' is the default.
// Paper counterparts. Same six moods, washed back to day-legible — the dark
// ramps above would put warm-white type on a light sheet, and the whole point of
// paper is dark ink. These sit in the same lightness band as BG_PAPER.
export const BG_PAPER_NEON = [
  { id: 'pn-dusk', name: 'Dusk', css: `${GRAIN_SOFT}, radial-gradient(70% 46% at 50% 100%, rgba(255, 206, 184, 0.62) 0%, transparent 72%), radial-gradient(60% 44% at 18% 4%, rgba(214, 202, 246, 0.55) 0%, transparent 68%), linear-gradient(180deg, #f2effc 0%, #f8eef6 52%, #fdf1ea 100%)` },
  { id: 'pn-night', name: 'Neon Night', css: `${GRAIN_SOFT}, radial-gradient(64% 44% at 50% 98%, rgba(255, 196, 224, 0.6) 0%, transparent 70%), radial-gradient(56% 42% at 84% 8%, rgba(214, 198, 250, 0.5) 0%, transparent 66%), linear-gradient(180deg, #f4f0fb 0%, #f9eef7 100%)` },
  { id: 'pn-haze', name: 'Beach Haze', css: `${GRAIN_SOFT}, radial-gradient(62% 46% at 20% 8%, rgba(198, 220, 250, 0.6) 0%, transparent 68%), radial-gradient(58% 44% at 82% 92%, rgba(255, 224, 202, 0.55) 0%, transparent 68%), linear-gradient(180deg, #f1f5fc 0%, #fbf3ec 100%)` },
  { id: 'pn-palm', name: 'Palm Shade', css: `${GRAIN_SOFT}, radial-gradient(66% 46% at 50% 100%, rgba(255, 214, 190, 0.55) 0%, transparent 70%), radial-gradient(56% 42% at 14% 6%, rgba(196, 224, 236, 0.55) 0%, transparent 66%), linear-gradient(180deg, #eff6f9 0%, #f8f2ee 100%)` },
  { id: 'pn-strip', name: 'Sunstrip', css: `${GRAIN_SOFT}, linear-gradient(180deg, #eef0fb 0%, #eef0fb 30%, #f5eef8 30%, #f5eef8 55%, #fbeff0 55%, #fbeff0 78%, #fdf3e9 78%, #fdf3e9 100%)` },
  { id: 'pn-storm', name: 'Storm Roll', css: `${GRAIN_SOFT}, radial-gradient(72% 44% at 50% 92%, rgba(255, 216, 196, 0.5) 0%, transparent 70%), radial-gradient(58% 44% at 22% 6%, rgba(214, 214, 232, 0.6) 0%, transparent 68%), linear-gradient(180deg, #f1f1f7 0%, #f8f2f0 100%)` },
  // The composed scenes, kept as scenes on paper: the sun, the horizon line and
  // the grid survive at day weight — they just stop being silhouettes and
  // become tints, or the sheet would go dark. (Skyline was cut here too, so the
  // name does not exist in one look and vanish in the other.)
  { id: 'pn-sundown', name: 'Sundown', css: `${GRAIN_SOFT}, radial-gradient(24vmax 24vmax at 50% 66%, rgba(255, 206, 140, 0.55) 0%, rgba(255, 168, 150, 0.3) 46%, transparent 70%), linear-gradient(180deg, #f2eefb 0%, #f9eef4 46%, #fdf0e8 74%, #f6eef6 74.5%, #f3eef8 100%)` },
  { id: 'pn-grid', name: 'Grid', css: `${GRAIN_SOFT}, repeating-linear-gradient(90deg, rgba(214, 120, 170, 0.22) 0 1px, transparent 1px 7%) 0 64% / 100% 36% no-repeat, radial-gradient(18vmax 18vmax at 50% 64%, rgba(255, 190, 150, 0.45) 0%, transparent 68%), linear-gradient(180deg, #f4f0fb 0%, #f9eff5 62%, #fbf5f2 100%)` },
  { id: 'pn-chrome', name: 'Chrome', css: `${GRAIN_SOFT}, linear-gradient(160deg, #fdf1f8 0%, #eee9fb 18%, #e6f5fc 36%, #fdf5e9 54%, #fbeaf3 72%, #ece9fb 88%, #e8f8fa 100%)` },
  { id: 'pn-vapor', name: 'Vapor', css: `${GRAIN_SOFT}, radial-gradient(40% 30% at 18% 22%, rgba(255, 190, 232, 0.5) 0%, transparent 70%), radial-gradient(44% 34% at 82% 30%, rgba(196, 228, 255, 0.5) 0%, transparent 70%), radial-gradient(50% 36% at 50% 92%, rgba(255, 220, 190, 0.5) 0%, transparent 72%), linear-gradient(180deg, #f6f1fc 0%, #f9f0f8 100%)` },
]
// 🪤 These live BELOW GRAIN_SOFT on purpose: they interpolate it, and a
// module-level const is in the temporal dead zone until its own line runs —
// declared next to the other Neon Coast pools they threw on import.
export const BG_PAPER = [
  { id: 'pearl', name: 'Pearl', css: `${GRAIN_SOFT}, radial-gradient(52% 44% at 12% 6%, rgba(255, 209, 228, 0.5) 0%, transparent 66%), radial-gradient(50% 42% at 88% 10%, rgba(206, 225, 255, 0.55) 0%, transparent 66%), radial-gradient(54% 46% at 82% 90%, rgba(210, 244, 227, 0.45) 0%, transparent 66%), radial-gradient(48% 42% at 10% 88%, rgba(233, 214, 255, 0.42) 0%, transparent 64%), linear-gradient(165deg, #fbfaff 0%, #f5f6f9 55%, #f3f6f8 100%)` },
  { id: 'blush', name: 'Blush', css: `${GRAIN_SOFT}, radial-gradient(56% 48% at 16% 10%, rgba(255, 196, 216, 0.6) 0%, transparent 68%), radial-gradient(50% 44% at 86% 84%, rgba(255, 218, 200, 0.5) 0%, transparent 66%), linear-gradient(170deg, #fdf5f7 0%, #faf2f0 100%)` },
  { id: 'sky', name: 'Sky', css: `${GRAIN_SOFT}, radial-gradient(56% 48% at 84% 8%, rgba(190, 218, 255, 0.6) 0%, transparent 68%), radial-gradient(50% 44% at 12% 86%, rgba(205, 236, 250, 0.55) 0%, transparent 66%), linear-gradient(170deg, #f4f8fd 0%, #f0f5fb 100%)` },
  { id: 'meadow', name: 'Meadow', css: `${GRAIN_SOFT}, radial-gradient(56% 48% at 14% 10%, rgba(196, 240, 216, 0.6) 0%, transparent 68%), radial-gradient(50% 44% at 86% 86%, rgba(220, 244, 205, 0.5) 0%, transparent 66%), linear-gradient(170deg, #f3faf5 0%, #eff7f2 100%)` },
  { id: 'lilac', name: 'Lilac', css: `${GRAIN_SOFT}, radial-gradient(56% 48% at 82% 10%, rgba(226, 208, 255, 0.6) 0%, transparent 68%), radial-gradient(50% 44% at 14% 88%, rgba(244, 214, 240, 0.5) 0%, transparent 66%), linear-gradient(170deg, #f8f5fd 0%, #f4f1fa 100%)` },
  { id: 'sand', name: 'Sand', css: `${GRAIN_SOFT}, radial-gradient(56% 48% at 16% 8%, rgba(250, 228, 190, 0.55) 0%, transparent 68%), radial-gradient(50% 44% at 84% 88%, rgba(245, 216, 190, 0.45) 0%, transparent 66%), linear-gradient(170deg, #fbf8f1 0%, #f8f4ea 100%)` },
  { id: 'horizon', name: 'Horizon', css: `${GRAIN_SOFT}, radial-gradient(70% 45% at 50% 100%, rgba(255, 214, 190, 0.55) 0%, transparent 70%), linear-gradient(180deg, #eef3fb 0%, #f6f4f2 100%)` },
  { id: 'fog', name: 'Fog', css: `${GRAIN_SOFT}, radial-gradient(60% 50% at 50% 0%, rgba(226, 231, 240, 0.8) 0%, transparent 70%), linear-gradient(175deg, #f1f3f6 0%, #e9ecf1 100%)` },
  { id: 'porcelain', name: 'Porcelain', css: `${GRAIN_SOFT}, #f5f5f7` },
  { id: 'cream', name: 'Cream', css: `${GRAIN_SOFT}, radial-gradient(58% 48% at 20% 8%, rgba(255, 240, 205, 0.6) 0%, transparent 68%), radial-gradient(52% 44% at 84% 88%, rgba(250, 232, 202, 0.5) 0%, transparent 66%), linear-gradient(170deg, #fdfaf2 0%, #faf6ec 100%)` },
  { id: 'mint', name: 'Mint', css: `${GRAIN_SOFT}, radial-gradient(56% 48% at 82% 8%, rgba(196, 242, 226, 0.6) 0%, transparent 68%), radial-gradient(50% 44% at 14% 88%, rgba(212, 246, 238, 0.5) 0%, transparent 66%), linear-gradient(170deg, #f2fbf8 0%, #edf8f4 100%)` },
  { id: 'rose', name: 'Rose', css: `${GRAIN_SOFT}, radial-gradient(56% 48% at 18% 8%, rgba(252, 208, 216, 0.55) 0%, transparent 68%), radial-gradient(52% 46% at 84% 86%, rgba(250, 222, 236, 0.5) 0%, transparent 66%), linear-gradient(170deg, #fdf4f6 0%, #fbf0f3 100%)` },
  { id: 'mist', name: 'Mist', css: `${GRAIN_SOFT}, radial-gradient(64% 52% at 50% 0%, rgba(214, 222, 236, 0.7) 0%, transparent 70%), radial-gradient(52% 44% at 86% 90%, rgba(222, 230, 240, 0.5) 0%, transparent 66%), linear-gradient(175deg, #f3f5f9 0%, #edf0f5 100%)` },
  { id: 'seafoam', name: 'Seafoam', css: `${GRAIN_SOFT}, radial-gradient(58% 48% at 16% 10%, rgba(198, 236, 240, 0.6) 0%, transparent 68%), radial-gradient(52% 44% at 86% 86%, rgba(206, 240, 228, 0.5) 0%, transparent 66%), linear-gradient(170deg, #f1f9fa 0%, #ecf6f5 100%)` },
  { id: 'peach', name: 'Peach', css: `${GRAIN_SOFT}, radial-gradient(58% 48% at 82% 10%, rgba(255, 222, 200, 0.58) 0%, transparent 68%), radial-gradient(52% 44% at 14% 88%, rgba(255, 232, 212, 0.5) 0%, transparent 66%), linear-gradient(170deg, #fdf7f2 0%, #fbf2ea 100%)` },
  { id: 'ice', name: 'Ice', css: `${GRAIN_SOFT}, radial-gradient(60% 50% at 50% 0%, rgba(224, 240, 252, 0.75) 0%, transparent 70%), linear-gradient(175deg, #f6fafd 0%, #eef5fa 100%)` },
  { id: 'stone', name: 'Stone', css: `${GRAIN_SOFT}, radial-gradient(58% 48% at 18% 8%, rgba(226, 222, 214, 0.6) 0%, transparent 68%), radial-gradient(52% 44% at 84% 88%, rgba(232, 228, 220, 0.5) 0%, transparent 66%), linear-gradient(170deg, #f7f6f3 0%, #f2f0ec 100%)` },
]

// Paper PATTERNS - soft textile/print textures, still day-legible.
export const BG_PAPER_PATTERNS = [
  { id: 'pt-pillow', name: 'Pillow', css: `${GRAIN_SOFT}, radial-gradient(at 50% 50%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 62%) 0 0/72px 72px, radial-gradient(at 50% 50%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 62%) 36px 36px/72px 72px, repeating-linear-gradient(45deg, rgba(168,175,194,0.3) 0 1.6px, transparent 1.6px 36px), repeating-linear-gradient(-45deg, rgba(168,175,194,0.3) 0 1.6px, transparent 1.6px 36px), linear-gradient(180deg, #f1f2f7, #e7e9f0)` },
  { id: 'pt-dots', name: 'Dots', css: `${GRAIN_SOFT}, radial-gradient(circle, rgba(122,132,156,0.2) 1.6px, transparent 2.6px) 0 0/24px 24px, radial-gradient(circle, rgba(122,132,156,0.12) 1.3px, transparent 2.2px) 12px 12px/24px 24px, #f6f6f9` },
  { id: 'pt-graph', name: 'Grid paper', css: `${GRAIN_SOFT}, repeating-linear-gradient(0deg, rgba(140,160,200,0.18) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(140,160,200,0.18) 0 1px, transparent 1px 28px), #f9fafc` },
  { id: 'pt-pinstripe', name: 'Pinstripe', css: `${GRAIN_SOFT}, repeating-linear-gradient(90deg, rgba(130,140,164,0.16) 0 1.4px, transparent 1.4px 16px), linear-gradient(180deg, #f5f5f8, #eef0f4)` },
  { id: 'pt-scallop', name: 'Scallop', css: `${GRAIN_SOFT}, radial-gradient(circle at 50% 0%, transparent 0 30%, rgba(150,165,200,0.24) 30% 34%, transparent 34% 58%, rgba(150,165,200,0.16) 58% 62%, transparent 62%) 0 22px/88px 44px repeat, radial-gradient(circle at 50% 0%, transparent 0 30%, rgba(150,165,200,0.18) 30% 34%, transparent 34%) 44px 44px/88px 44px repeat, linear-gradient(180deg, #f4f6fa, #edf0f6)` },
  { id: 'pt-gingham', name: 'Gingham', css: `${GRAIN_SOFT}, repeating-linear-gradient(0deg, rgba(150,175,215,0.2) 0 20px, transparent 20px 40px), repeating-linear-gradient(90deg, rgba(150,175,215,0.2) 0 20px, transparent 20px 40px), #fbfbfd` },
  { id: 'pt-linen', name: 'Linen', css: `${GRAIN_SOFT}, repeating-linear-gradient(45deg, rgba(172,164,148,0.16) 0 2px, transparent 2px 7px), repeating-linear-gradient(-45deg, rgba(172,164,148,0.16) 0 2px, transparent 2px 7px), linear-gradient(180deg, #f8f6f1, #f2efe8)` },
  { id: 'pt-marble', name: 'Marble', css: `${GRAIN_SOFT}, radial-gradient(ellipse 46% 14% at 24% 26%, rgba(158,166,182,0.3) 0 45%, transparent 75%), radial-gradient(ellipse 36% 10% at 74% 58%, rgba(158,166,182,0.24) 0 45%, transparent 75%), radial-gradient(ellipse 50% 9% at 46% 84%, rgba(178,184,198,0.22) 0 45%, transparent 75%), radial-gradient(ellipse 24% 7% at 84% 14%, rgba(168,176,192,0.24) 0 45%, transparent 75%), linear-gradient(170deg, #fafafc, #eff0f4)` },
  { id: 'pt-terrazzo', name: 'Terrazzo', css: `${GRAIN_SOFT}, radial-gradient(circle at 14% 22%, rgba(240,148,168,0.4) 0 7px, transparent 8px), radial-gradient(circle at 38% 64%, rgba(140,180,235,0.4) 0 9px, transparent 10px), radial-gradient(circle at 66% 18%, rgba(150,205,170,0.42) 0 6px, transparent 7px), radial-gradient(circle at 85% 48%, rgba(235,190,120,0.42) 0 8px, transparent 9px), radial-gradient(circle at 24% 86%, rgba(190,160,230,0.4) 0 7px, transparent 8px), radial-gradient(circle at 58% 40%, rgba(150,160,180,0.3) 0 5px, transparent 6px), radial-gradient(circle at 90% 82%, rgba(240,148,168,0.32) 0 6px, transparent 7px), radial-gradient(circle at 74% 70%, rgba(140,180,235,0.3) 0 5px, transparent 6px), radial-gradient(circle at 8% 56%, rgba(150,205,170,0.3) 0 6px, transparent 7px), radial-gradient(circle at 46% 8%, rgba(235,190,120,0.3) 0 5px, transparent 6px), #f7f6f3` },
  { id: 'pt-awning', name: 'Awning', css: `${GRAIN_SOFT}, repeating-linear-gradient(55deg, rgba(250,205,215,0.5) 0 44px, rgba(255,255,255,0) 44px 88px), repeating-linear-gradient(55deg, rgba(205,225,250,0.4) 88px 132px, rgba(255,255,255,0) 132px 176px), #fcfbfd` },
  { id: 'pt-notebook', name: 'Notebook', css: `${GRAIN_SOFT}, linear-gradient(90deg, transparent 0 56px, rgba(235,120,130,0.4) 56px 57.5px, transparent 57.5px), repeating-linear-gradient(0deg, transparent 0 30px, rgba(140,165,205,0.24) 30px 31px), #fbfaf7` },
  { id: 'pt-herringbone', name: 'Herringbone', css: `${GRAIN_SOFT}, repeating-linear-gradient(45deg, rgba(160,168,186,0.2) 0 2px, transparent 2px 12px) 0 0/48px 24px, repeating-linear-gradient(-45deg, rgba(160,168,186,0.2) 0 2px, transparent 2px 12px) 24px 0/48px 24px, linear-gradient(180deg, #f6f5f2, #efeee9)` },
  { id: 'pt-waves', name: 'Waves', css: `${GRAIN_SOFT}, radial-gradient(circle at 50% 130%, transparent 0 42%, rgba(140,175,225,0.28) 42% 46%, transparent 46% 62%, rgba(140,175,225,0.2) 62% 66%, transparent 66% 82%, rgba(140,175,225,0.14) 82% 86%, transparent 86%) 0 0/64px 32px repeat, radial-gradient(circle at 50% 130%, transparent 0 42%, rgba(140,175,225,0.22) 42% 46%, transparent 46% 62%, rgba(140,175,225,0.15) 62% 66%, transparent 66%) 32px 16px/64px 32px repeat, linear-gradient(180deg, #f4f7fb, #eef2f8)` },
  { id: 'pt-checker', name: 'Checker', css: `${GRAIN_SOFT}, repeating-conic-gradient(rgba(178,186,202,0.16) 0% 25%, transparent 25% 50%) 0 0/56px 56px, linear-gradient(180deg, #f8f8fa, #f1f2f5)` },
]

const NEON_IDS = new Set(BG_NEON.map((b) => b.id))
const PAPER_NEON_IDS = new Set(BG_PAPER_NEON.map((b) => b.id))

/** True when the active backdrop (glass OR paper) is a Neon Coast one — the
    signal the shell uses to switch type and accents to match. */
export function isNeonBg(bg, paperBgId) {
  if (paperBgId && PAPER_NEON_IDS.has(paperBgId)) return true
  return Boolean(bg?.scene && NEON_IDS.has(bg.scene))
}

export const ALL_PAPER_BGS = [...BG_PAPER, ...BG_PAPER_PATTERNS, ...BG_PAPER_NEON]

export function resolvePaperBg(id) {
  return (ALL_PAPER_BGS.find((w) => w.id === id) || BG_PAPER[0]).css
}

/* ── THE catalog ────────────────────────────────────────────────────────────
   🪤🪤 The section LIST was copy-pasted into three places — LITE's Themes page,
   LITE's Edit popover, and the PRO Theme Studio — while only the item arrays
   were shared. So "add a section" silently meant "add it three times", and a
   new section shipped four times before it appeared where the founder was
   actually looking. pro-theme-panel.jsx even carried a comment claiming a
   single source of truth while holding its own copy.

   This is that single source. Consumers import it; nobody re-declares sections.
   Scenes was the historical default and leads. Neon Coast sits LAST in both
   catalogs (founder, 2026-08-29: "move this neon coast max lower") — it is a
   strong, specific look, and a section that loud at the top makes the whole
   picker feel like one theme with accessories. */
export const BG_CATALOG = [
  { title: 'Scenes', kind: 'photo', mode: 'scene', items: BG_SCENES },
  { title: 'Cosmos', kind: 'photo', mode: 'scene', items: BG_COSMOS },
  { title: 'City nights', kind: 'photo', mode: 'scene', items: BG_CITY },
  { title: 'Color studies', kind: 'photo', mode: 'scene', items: BG_COLOR },
  { title: 'Gradients', mode: 'gradient', items: BG_GRADIENTS },
  { title: 'Auras', mode: 'mesh', items: BG_MESH },
  { title: 'Solids', mode: 'solid', items: BG_SOLIDS },
  { title: 'Bright & airy', mode: 'bright', items: BG_BRIGHT },
  { title: 'Crypto brands', mode: 'brand', items: BG_BRAND },
  { title: 'Art styles', mode: 'art', items: BG_ART },
  { title: 'Fun & pop', mode: 'pop', items: BG_POP },
  { title: 'Neon coast', mode: 'neon', items: BG_NEON },
]
export const BG_PAPER_CATALOG = [
  { title: 'Paper canvas', mode: 'paper', items: BG_PAPER },
  { title: 'Patterns', mode: 'paper', items: BG_PAPER_PATTERNS },
  { title: 'Neon coast', mode: 'paper', items: BG_PAPER_NEON },
]

export const CUSTOM_BG_KEY = 'spectre-lite-bg-custom' 

export function readCustomBg() {
  try { return localStorage.getItem(CUSTOM_BG_KEY) || null } catch (_) { return null }
}

// Downscale the upload so it survives the localStorage quota. A phone photo is
// 3-12MB and base64 adds a third on top, so ONE fixed size/quality either
// wastes headroom or throws QuotaExceededError - and the old code swallowed
// that throw and every other failure into a bare `onDone(null)`, which is what
// "upload does nothing on mobile" looked like from the outside. Step the size
// down until it fits, and hand the caller a REASON when it never does.
//
// Sized off the longest edge, not the width: a portrait phone photo is taller
// than it is wide, so capping width alone left it far heavier than a landscape
// shot of the same nominal size.
const CUSTOM_BG_STEPS = [
  { max: 1600, quality: 0.82 },
  { max: 1280, quality: 0.74 },
  { max: 1024, quality: 0.68 },
  { max: 800, quality: 0.6 },
]

export function storeCustomBg(file, onDone) {
  if (!file) { onDone?.(null, 'No file selected'); return }
  if (file.type && !/^image\//.test(file.type)) { onDone?.(null, 'That file is not an image'); return }

  const reader = new FileReader()
  reader.onerror = () => onDone?.(null, "Couldn't read that file")
  reader.onload = () => {
    const img = new Image()
    img.onerror = () => onDone?.(null, "Couldn't open that image - try a JPEG or PNG")
    img.onload = () => {
      // Drop the previous upload FIRST: on a tight quota the old copy is the
      // main thing standing between the new one and a successful write.
      try { localStorage.removeItem(CUSTOM_BG_KEY) } catch (_) { /* private mode */ }

      const longest = Math.max(img.width, img.height) || 1
      for (const step of CUSTOM_BG_STEPS) {
        const scale = Math.min(1, step.max / longest)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) break
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        let dataUrl
        try { dataUrl = canvas.toDataURL('image/jpeg', step.quality) } catch (_) { break }
        try {
          localStorage.setItem(CUSTOM_BG_KEY, dataUrl)
          onDone?.(dataUrl)
          return
        } catch (_) { /* quota - try the next step down */ }
      }
      onDone?.(null, "This device has no room left to keep that photo")
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

export function bgUrl(id) {
  // Mobile gets a PORTRAIT crop at retina-ish resolution - serving the
  // landscape original meant a low-res center-crop that read as "zoomed".
  if (typeof window !== 'undefined' && window.innerWidth <= 768) {
    return `https://images.unsplash.com/${id}?w=900&h=1600&fit=crop&crop=entropy&q=75&auto=format`
  }
  return `https://images.unsplash.com/${id}?w=1920&q=75&auto=format&fit=crop`
}
