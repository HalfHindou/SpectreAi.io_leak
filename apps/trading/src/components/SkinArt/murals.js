/**
 * SkinArt/murals — large-format artwork for decorative skins.
 *
 * The CS:GO principle: a skin is a FINISH that wraps the surface, not a
 * sticker pack. Each skin ships six continuous line-art compositions,
 * one per surface, authored to bleed off the panel edges:
 *
 *   left    300 x 780   left column, bottom/edge anchored
 *   right   320 x 460   right panel, top-right anchored
 *   banner  900 x 120   token banner, flows in from the right edge
 *   tabs    900 x 240   DataTabs panorama, ground line along the bottom
 *   heroA   440 x 440   page layer, bottom-left viewport corner
 *   heroB   460 x 300   page layer, top-right viewport corner
 *
 * Style contract: warm-white (#F5F5F7) ENGRAVING — hairline strokes with
 * `vector-effect: non-scaling-stroke` so lines stay needle-fine at any
 * render size (scaling the old 64px icons up is what read as cartoon).
 * Fills are rare accents (star cores, pentagon patches). Density lives
 * at edges/corners; zones that carry data stay sparse. Rendered at low
 * opacity by styles/skins.css and SkinLayer — never at full strength.
 *
 * Everything here is ORIGINAL art (inspired-by vibes, zero licensed IP).
 */

const W = '#F5F5F7'

const mural = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" fill="none" stroke="${W}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><style>*{vector-effect:non-scaling-stroke}</style>${inner}</svg>`

/** Place a fragment at (x,y) with optional scale/rotation. */
const at = (x, y, inner, { s = 1, r = 0 } = {}) =>
  `<g transform="translate(${x} ${y})${r ? ` rotate(${r})` : ''}${s !== 1 ? ` scale(${s})` : ''}">${inner}</g>`

/* ------------------------- shared primitives ------------------------- */

const SPARK = `<path d="M0 -10 C1.2 -3 3 -1.2 10 0 C3 1.2 1.2 3 0 10 C-1.2 3 -3 1.2 -10 0 C-3 -1.2 -1.2 -3 0 -10 Z" fill="${W}" stroke="none"/>`
const spark = (x, y, s) => at(x, y, SPARK, { s: s / 10 })

const dot = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${W}" stroke="none"/>`

const ring = (x, y, r, sw = 1) => `<circle cx="${x}" cy="${y}" r="${r}" stroke-width="${sw}"/>`

const line = (x1, y1, x2, y2, sw = 1) =>
  `<path d="M${x1} ${y1} L${x2} ${y2}" stroke-width="${sw}"/>`

const dashed = (d, dash = '2 8', sw = 1.3) =>
  `<path d="${d}" stroke-width="${sw}" stroke-dasharray="${dash}"/>`

/** Open chevron arrowhead; default points up, rotate to aim. */
const chev = (x, y, rot, s = 1) =>
  at(x, y, `<path d="M-7 5 L0 -4 L7 5" stroke-width="1.6"/>`, { r: rot, s })

/** n parallel hatch lines of length len at angle ang, stepped by gap. */
const hatch = (x, y, n, len, ang, gap) => {
  const rad = (ang * Math.PI) / 180
  const dx = Math.cos(rad) * len
  const dy = Math.sin(rad) * len
  const px = Math.cos(rad + Math.PI / 2) * gap
  const py = Math.sin(rad + Math.PI / 2) * gap
  let out = ''
  for (let i = 0; i < n; i++) {
    out += `<path d="M${(x + px * i).toFixed(1)} ${(y + py * i).toFixed(1)} l${dx.toFixed(1)} ${dy.toFixed(1)}" stroke-width="0.9"/>`
  }
  return out
}

/* =====================================================================
 * GALACTIC — ringed giants, squadrons, starfields
 * =================================================================== */

const FIGHTER = `
  <path d="M0 -18 L4 -4 L20 10 L6 7 L4 14 L-4 14 L-6 7 L-20 10 L-4 -4 Z" stroke-width="1.5"/>
  <circle cy="-2" r="2.6" stroke-width="1.1"/>
  <path d="M-9 14 L-12 19 M9 14 L12 19" stroke-width="1.1"/>`
const fighter = (x, y, s, r) => at(x, y, FIGHTER, { s, r })

const comet = (x, y, s, r) =>
  at(x, y, `<circle r="4.5" fill="${W}" stroke="none"/><path d="M-5 3 L-46 14 M-5 -3 L-52 2 M-2 5 L-34 22" stroke-width="1.1"/>`, { s, r })

const crescent = (x, y, r, rot = 0) =>
  at(x, y, `<path d="M0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${(r * 0.68).toFixed(1)} ${(r * 0.68).toFixed(1)} 0 1 0 0 ${-r} Z" stroke-width="1.5"/>${dot(r * 0.45, -r * 0.25, r * 0.07)}${dot(r * 0.5, r * 0.28, r * 0.055)}`, { r: rot })

const ASTRO = `
  <circle cy="-12" r="10" stroke-width="1.5"/>
  <path d="M-5.5 -14 a7 5.4 0 0 1 11 0" stroke-width="1"/>
  <rect x="-8" y="-1" width="16" height="15" rx="5" stroke-width="1.5"/>
  <path d="M-8 3 L-16 10 M8 3 L16 10 M-4.5 14 L-6 22 M4.5 14 L6 22" stroke-width="1.3"/>
  <rect x="-12" y="0" width="3.5" height="9" rx="1.6" stroke-width="1"/>`
const astro = (x, y, s, r) => at(x, y, ASTRO, { s, r })

/** Planet disc + double ring, drawn around local origin. */
const ringedPlanet = (x, y, r, rx, ry, rot, extra = '') =>
  at(x, y, `
    <circle r="${r}" stroke-width="1.8"/>
    <g transform="rotate(${rot})">
      <ellipse rx="${rx}" ry="${ry}" stroke-width="1.5"/>
      <ellipse rx="${(rx * 0.82).toFixed(0)}" ry="${(ry * 0.78).toFixed(0)}" stroke-width="0.9"/>
    </g>
    ${extra}`)

const galactic = {
  heroA: mural(440, 440, `
    ${ringedPlanet(70, 470, 210, 360, 96, -22, `
      ${ring(50, -140, 14, 1)}${ring(115, -75, 9, 1)}${ring(-10, -170, 7, 0.9)}
    `)}
    ${hatch(198, 318, 5, 26, 130, 18)}
    ${crescent(355, 105, 16, -14)}
    ${fighter(150, 180, 0.8, -30)}
    ${line(168, 208, 212, 262, 1)}${line(154, 214, 188, 258, 1)}
    ${spark(300, 60, 9)}${spark(390, 180, 6)}${spark(240, 140, 5)}
    ${dot(330, 230, 2.5)}${dot(180, 80, 2)}${dot(410, 90, 2)}${dot(280, 20, 1.8)}${dot(140, 40, 2.2)}${dot(420, 250, 1.6)}
  `),
  heroB: mural(460, 300, `
    ${fighter(150, 150, 1.15, -35)}
    ${line(172, 180, 240, 262, 1)}${line(155, 192, 215, 265, 1)}${line(188, 172, 268, 246, 0.9)}
    ${fighter(250, 90, 0.9, -35)}
    ${line(268, 114, 318, 172, 0.9)}${line(255, 122, 300, 178, 0.9)}
    ${fighter(265, 205, 0.95, -35)}
    ${line(283, 230, 336, 288, 0.9)}${line(270, 238, 316, 292, 0.9)}
    ${crescent(415, 40, 26, -18)}
    ${at(55, 255, `<circle r="9" stroke-width="1.3"/><ellipse rx="17" ry="5" transform="rotate(-20)" stroke-width="0.9"/>`)}
    ${spark(60, 60, 7)}${spark(390, 50, 9)}${spark(420, 160, 5)}${spark(330, 250, 6)}
    ${dot(30, 180, 2)}${dot(110, 240, 1.8)}${dot(200, 30, 2)}${dot(310, 140, 1.6)}${dot(440, 90, 2)}${dot(380, 270, 1.8)}
  `),
  left: mural(300, 780, `
    ${crescent(245, 60, 20, -10)}
    ${dot(40, 40, 2)}${dot(120, 90, 1.8)}${dot(200, 140, 1.5)}${spark(60, 120, 6)}
    ${dashed('M300 200 C 220 300 220 420 300 520', '1 10', 1.1)}
    ${dot(30, 300, 1.6)}${dot(270, 360, 2)}${dot(40, 470, 1.8)}${dot(255, 300, 1.5)}
    ${ringedPlanet(150, 900, 260, 380, 106, -30)}
    ${astro(105, 600, 1.05, -12)}
    ${dashed('M122 586 C 180 540 240 480 300 430', '1 8', 0.9)}
    ${spark(60, 660, 5)}${spark(220, 640, 6)}
    ${dot(150, 620, 2)}${dot(250, 690, 1.8)}${dot(30, 700, 1.6)}
  `),
  banner: mural(900, 120, `
    ${ringedPlanet(935, 66, 82, 130, 36, -18, `${ring(-40, -21, 8, 1)}${ring(-18, 14, 5.5, 0.9)}`)}
    ${fighter(690, 55, 0.9, -98)}
    ${line(720, 50, 860, 44, 1)}${line(735, 62, 875, 60, 1)}
    ${fighter(760, 88, 0.7, -98)}
    ${line(790, 90, 890, 86, 0.9)}
    ${comet(500, 38, 0.8, 172)}
    ${spark(530, 80, 6)}${spark(300, 45, 5)}${spark(180, 70, 4)}
    ${dot(350, 95, 1.8)}${dot(240, 25, 1.6)}${dot(90, 55, 1.5)}${dot(480, 20, 1.6)}${dot(620, 100, 1.8)}${dot(140, 95, 1.4)}
  `),
  right: mural(320, 460, `
    ${at(300, 40, `
      <ellipse rx="200" ry="60" transform="rotate(-30)" stroke-width="1.3"/>
      <ellipse rx="150" ry="44" transform="rotate(-30)" stroke-width="0.9"/>
    `)}
    ${ring(127, 140, 10, 1.4)}${dot(127, 140, 3)}
    ${crescent(60, 60, 18, -15)}
    ${dashed('M308 218 C 292 290 268 360 252 436', '1 9', 1.1)}
    ${spark(240, 180, 6)}${spark(90, 150, 4.5)}${spark(280, 300, 5)}
    ${dot(40, 220, 1.8)}${dot(180, 260, 1.5)}${dot(300, 380, 1.6)}${dot(120, 330, 1.4)}${dot(220, 420, 1.8)}
  `),
  tabs: mural(900, 240, `
    <path d="M217 240 A700 700 0 0 1 683 240" stroke-width="1.4"/>
    ${hatch(320, 230, 4, 14, 100, 60)}
    ${comet(720, 60, 0.9, 174)}
    ${fighter(180, 90, 0.75, -35)}
    ${line(196, 112, 238, 158, 0.9)}${line(184, 118, 220, 160, 0.9)}
    ${crescent(60, 150, 20, -12)}
    ${spark(90, 50, 6)}${spark(300, 140, 5)}${spark(560, 40, 7)}${spark(820, 150, 5)}${spark(640, 120, 4)}
    ${dot(40, 160, 1.8)}${dot(150, 30, 1.6)}${dot(250, 180, 1.5)}${dot(420, 70, 2)}${dot(500, 160, 1.5)}${dot(700, 180, 1.8)}${dot(860, 60, 2)}${dot(770, 30, 1.6)}
  `),
}

/* =====================================================================
 * MECHA — drivetrains, circuit buses, armor plate
 * =================================================================== */

const gearPath = (r, teeth) => {
  const R = r * 1.16
  const step = (Math.PI * 2) / teeth
  const pts = []
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
    pts.push([Math.cos(a + step * 0.12) * R, Math.sin(a + step * 0.12) * R])
    pts.push([Math.cos(a + step * 0.42) * R, Math.sin(a + step * 0.42) * R])
    pts.push([Math.cos(a + step * 0.54) * r, Math.sin(a + step * 0.54) * r])
  }
  return 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L') + ' Z'
}

const gear = (x, y, r, teeth = 10) =>
  at(x, y, `
    <path d="${gearPath(r, teeth)}" stroke-width="1.6"/>
    <circle r="${(r * 0.62).toFixed(1)}" stroke-width="1"/>
    <circle r="${(r * 0.24).toFixed(1)}" stroke-width="1.3"/>
    <path d="M0 ${(-r * 0.62).toFixed(1)} V${(-r * 0.24).toFixed(1)} M0 ${(r * 0.24).toFixed(1)} V${(r * 0.62).toFixed(1)} M${(-r * 0.62).toFixed(1)} 0 H${(-r * 0.24).toFixed(1)} M${(r * 0.24).toFixed(1)} 0 H${(r * 0.62).toFixed(1)}" stroke-width="1"/>
    ${dot(r * 0.43 * 0.707, -r * 0.43 * 0.707, 1.6)}${dot(-r * 0.43 * 0.707, r * 0.43 * 0.707, 1.6)}
  `)

const node = (x, y) => dot(x, y, 3)
const pad = (x, y) => `<circle cx="${x}" cy="${y}" r="3.6" stroke-width="1.1"/>`
const trace = (d, sw = 1.2) => `<path d="${d}" fill="none" stroke-width="${sw}"/>`

const hexPath = (r) => {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    pts.push(`${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`)
  }
  return 'M' + pts.join(' L') + ' Z'
}
const hexNut = (x, y, r) =>
  at(x, y, `<path d="${hexPath(r)}" stroke-width="1.3"/><path d="${hexPath(r * 0.58)}" stroke-width="0.9"/>`)

const MECH_HEAD = `
  <path d="M-20 -14 L-14 -22 H14 L20 -14 V10 L12 20 H-12 L-20 10 Z" stroke-width="1.6"/>
  <rect x="-13" y="-8" width="26" height="9" rx="2" stroke-width="1.1"/>
  <path d="M-7 -8 v9 M0 -8 v9 M7 -8 v9" stroke-width="0.8"/>
  <path d="M0 -22 V-31" stroke-width="1.2"/>${dot(0, -33, 2)}
  <path d="M-8 14 h4 M-2 14 h4 M6 14 h3" stroke-width="1"/>
  <rect x="-24" y="-10" width="4" height="12" rx="1.5" stroke-width="1"/>
  <rect x="20" y="-10" width="4" height="12" rx="1.5" stroke-width="1"/>`
const mechHead = (x, y, s, r) => at(x, y, MECH_HEAD, { s, r })

const plate = (x, y, rot = 0) =>
  at(x, y, `
    <path d="M-42 -23 H30 L42 -11 V23 H-42 Z" stroke-width="1.4"/>
    <path d="M-34 -13 H22 M-34 13 H34" stroke-width="0.8"/>
    ${ring(-32, 0, 2, 0.9)}${ring(0, 0, 2, 0.9)}${ring(30, 0, 2, 0.9)}
  `, { r: rot })

const mecha = {
  heroA: mural(440, 440, `
    ${gear(60, 420, 150, 12)}
    ${gear(285, 345, 85, 10)}
    ${gear(378, 248, 48, 9)}
    ${hexNut(330, 120, 22)}${hexNut(255, 60, 13)}${hexNut(408, 170, 9)}
    ${trace('M378 196 V150 H420 V96')}${node(378, 150)}${pad(420, 92)}
    ${dot(60, 120, 2)}${dot(150, 180, 1.8)}${dot(210, 240, 1.5)}
  `),
  heroB: mural(460, 300, `
    ${mechHead(350, 120, 2.6)}
    <path d="M300 218 L338 182 H462" stroke-width="1.6"/>
    <path d="M300 218 V302" stroke-width="1.6"/>
    <path d="M338 196 H430 M352 210 H444" stroke-width="0.9"/>
    ${ring(360, 203, 2.2, 0.9)}${ring(400, 203, 2.2, 0.9)}${ring(440, 203, 2.2, 0.9)}
    ${hatch(306, 250, 4, 16, 45, 10)}
    ${trace('M298 108 H230 V66 H150')}${node(230, 66)}${pad(145, 66)}
    ${trace('M298 142 H206 V202 H132')}${node(206, 142)}${pad(127, 202)}
    ${hexNut(80, 80, 16)}${hexNut(60, 240, 10)}
    ${dot(150, 250, 2)}${dot(240, 30, 1.8)}${dot(100, 160, 1.5)}
  `),
  left: mural(300, 780, `
    ${trace('M24 0 V118')}${node(24, 118)}
    ${trace('M24 118 H90 V178')}${pad(90, 183)}
    ${trace('M24 118 V196 L58 230 V330')}${pad(58, 335)}
    ${trace('M18 380 V518')}${node(18, 518)}
    ${trace('M18 518 L48 548 V642')}${pad(48, 647)}
    ${trace('M282 158 V262')}${pad(282, 268)}
    ${trace('M296 88 H240 V42')}${pad(240, 37)}
    ${hexNut(238, 300, 14)}${hexNut(70, 58, 8)}
    ${plate(60, 672, -6)}
    ${gear(285, 762, 110, 12)}
    ${gear(120, 716, 60, 9)}
    ${dot(150, 420, 1.8)}${dot(260, 480, 1.5)}${dot(40, 560, 1.6)}${dot(200, 200, 1.5)}
  `),
  banner: mural(900, 120, `
    ${gear(905, 60, 70, 10)}
    ${gear(806, 20, 34, 8)}
    ${trace('M826 44 H700 V20 H560')}${node(700, 44)}${pad(555, 20)}
    ${trace('M830 76 H640 V100 H470')}${node(640, 76)}${pad(465, 100)}
    ${trace('M772 20 H720')}${pad(715, 20)}
    ${hexNut(380, 58, 12)}${hexNut(302, 32, 7)}
    ${dot(240, 80, 1.6)}${dot(180, 40, 1.5)}${dot(100, 65, 1.4)}${dot(430, 25, 1.5)}${dot(520, 70, 1.6)}
  `),
  right: mural(320, 460, `
    ${gear(300, 20, 85, 11)}
    ${gear(188, 92, 48, 9)}
    ${gear(230, 150, 26, 8)}
    ${trace('M296 140 V240 L258 278 V362')}${node(296, 240)}${pad(258, 367)}
    ${trace('M188 152 V210 H132')}${pad(127, 210)}
    ${hexNut(90, 120, 13)}
    ${dot(60, 300, 1.8)}${dot(180, 330, 1.5)}${dot(90, 410, 1.6)}${dot(250, 430, 1.5)}
  `),
  tabs: mural(900, 240, `
    ${gear(830, 260, 120, 12)}
    ${gear(645, 230, 70, 10)}
    ${gear(560, 150, 40, 8)}
    ${trace('M0 212 H170 L214 168 H360 V212 H500')}${node(170, 212)}${node(360, 168)}${pad(505, 212)}
    ${hexNut(120, 70, 18)}${hexNut(300, 44, 11)}${hexNut(212, 108, 7)}
    ${plate(410, 64, 4)}
    ${dot(60, 150, 1.8)}${dot(260, 140, 1.5)}${dot(490, 60, 1.6)}${dot(700, 40, 1.8)}${dot(770, 110, 1.5)}
  `),
}

/* =====================================================================
 * KAWAII — peeking cats, paw parades, heart strings
 * =================================================================== */

const HEART_D = 'M0 8.5 C-8.5 2 -7.5 -5.5 -3.2 -6.6 C-0.9 -7.2 0 -4.8 0 -4.8 C0 -4.8 0.9 -7.2 3.2 -6.6 C7.5 -5.5 8.5 2 0 8.5 Z'
const heart = (x, y, s, filled = false) =>
  at(x, y, `<path d="${HEART_D}"${filled ? ` fill="${W}" stroke="none"` : ' stroke-width="1.3"'}/>`, { s })

const PAW = `
  <ellipse cy="3.5" rx="7" ry="5.6" stroke-width="1.3"/>
  <circle cx="-7.5" cy="-5" r="2.7" stroke-width="1.1"/>
  <circle cy="-7.5" r="2.7" stroke-width="1.1"/>
  <circle cx="7.5" cy="-5" r="2.7" stroke-width="1.1"/>`
const paw = (x, y, s, r) => at(x, y, PAW, { s, r })

/** Cat peeking over an edge; y is the edge line, head rises above it. */
const CAT_PEEK = `
  <path d="M-25 0 L-31 -21 L-13 -11" stroke-width="1.6"/>
  <path d="M25 0 L31 -21 L13 -11" stroke-width="1.6"/>
  <path d="M-27 0 C-22 -16 22 -16 27 0" stroke-width="1.6"/>
  ${dot(-9, -6, 2.3)}${dot(9, -6, 2.3)}
  <path d="M-3 -3 q3 2.6 6 0" stroke-width="1.1"/>
  <path d="M-27 -7 L-40 -9 M-27 -3 L-39 0 M27 -7 L40 -9 M27 -3 L39 0" stroke-width="0.9"/>
  <path d="M-19 0 a4.5 4.5 0 0 1 9 0 M10 0 a4.5 4.5 0 0 1 9 0" stroke-width="1.3"/>`
const catPeek = (x, y, s) => at(x, y, CAT_PEEK, { s })

const BOW = `
  <path d="M-4 0 C-13 -10 -24 -8 -22 0 C-24 8 -13 10 -4 0 Z" stroke-width="1.4"/>
  <path d="M4 0 C13 -10 24 -8 22 0 C24 8 13 10 4 0 Z" stroke-width="1.4"/>
  <circle r="4" stroke-width="1.3"/>
  <path d="M-3 4 C-7 12 -4 18 -8 24 M3 4 C7 12 4 18 8 24" stroke-width="1"/>`
const bow = (x, y, s, r) => at(x, y, BOW, { s, r })

const FISH = `
  <path d="M-16 0 C-8 -9 8 -9 14 0 C8 9 -8 9 -16 0 Z" stroke-width="1.4"/>
  <path d="M14 0 L22 -7 L20 0 L22 7 Z" stroke-width="1.2"/>
  ${dot(-8, -2, 1.4)}
  <path d="M-2 -6 C1 -2 1 2 -2 6" stroke-width="0.8"/>`
const fish = (x, y, s, r) => at(x, y, FISH, { s, r })

const cloud = (x, y, s) =>
  at(x, y, `<path d="M-18 5 a6.5 6.5 0 0 1 -1 -12 a9 9 0 0 1 17 -4 a7 7 0 0 1 10 5 a5.5 5.5 0 0 1 -2 11 Z" stroke-width="1.2"/>`, { s })

const bubble = (x, y, r) => ring(x, y, r, 1)

const kawaii = {
  heroA: mural(440, 440, `
    ${catPeek(150, 440, 3.2)}
    ${heart(250, 330, 0.9, true)}${heart(300, 265, 1.3)}${heart(345, 205, 0.8, true)}${heart(390, 150, 1.6)}${heart(330, 90, 0.7, true)}${heart(255, 45, 1.1)}
    ${spark(120, 300, 7)}${spark(210, 240, 5)}${spark(60, 180, 6)}${spark(400, 300, 5)}${spark(160, 120, 4.5)}
    ${cloud(80, 70, 1.2)}${cloud(300, 30, 0.75)}
    ${paw(40, 380, 0.9, -20)}${paw(90, 320, 0.7, 15)}
  `),
  heroB: mural(460, 300, `
    ${bow(395, 45, 3, -18)}
    <path d="M385 82 C340 140 300 155 240 168" stroke-width="1.4"/>
    <path d="M402 88 C382 165 330 215 262 238" stroke-width="1.4"/>
    ${dashed('M120 0 V70', '2 6', 1)}${heart(120, 84, 1.4)}
    ${dashed('M190 0 V40', '2 6', 1)}${heart(190, 52, 1)}
    ${spark(60, 120, 6)}${spark(300, 60, 5)}${spark(160, 180, 4)}${spark(340, 220, 6)}${spark(80, 250, 5)}
    ${fish(60, 272, 0.9, -6)}${bubble(88, 258, 2.4)}${bubble(100, 248, 1.7)}
    ${dot(240, 110, 1.8)}${dot(350, 150, 1.5)}${dot(30, 60, 1.6)}
  `),
  left: mural(300, 780, `
    ${paw(50, 720, 1.15, -15)}${paw(110, 650, 1.05, 12)}${paw(70, 575, 1.1, -10)}${paw(130, 505, 1, 14)}${paw(90, 430, 1.05, -12)}${paw(150, 360, 0.95, 10)}${paw(110, 290, 0.8, -8)}${paw(160, 225, 0.7, 10)}
    ${catPeek(190, 780, 2.4)}
    ${heart(230, 600, 1.3)}${heart(40, 500, 0.8, true)}${heart(220, 380, 1.1)}${heart(250, 300, 0.7, true)}
    ${spark(60, 80, 6)}${spark(200, 120, 5)}${spark(240, 60, 4)}${spark(40, 240, 5)}${spark(260, 480, 4.5)}
    ${bow(250, 160, 1.2, 14)}
    ${cloud(90, 55, 1)}
  `),
  banner: mural(900, 120, `
    ${catPeek(795, 120, 2.2)}
    ${bow(720, 30, 1.5, -12)}
    ${heart(660, 60, 0.8, true)}${heart(600, 40, 1.1)}${heart(545, 70, 0.7, true)}${heart(480, 45, 1)}${heart(420, 65, 0.6, true)}
    ${spark(560, 25, 4.5)}${spark(360, 70, 5)}${spark(250, 35, 4)}${spark(150, 75, 4.5)}${spark(80, 40, 3.5)}
    ${bubble(300, 90, 2.6)}${bubble(200, 55, 2)}${bubble(120, 95, 1.7)}
    ${fish(40, 70, 0.8, -4)}
  `),
  right: mural(320, 460, `
    ${bow(300, 30, 2.4, 16)}
    ${dashed('M282 76 C 262 140 286 200 258 262', '2 6', 1)}${heart(256, 276, 1.4)}
    ${dashed('M312 92 C 312 140 300 160 302 182', '2 6', 1)}${heart(302, 196, 1.05)}
    ${paw(285, 340, 0.9, -14)}${paw(248, 408, 0.8, 12)}
    ${spark(90, 90, 5)}${spark(60, 200, 4)}${spark(160, 150, 4.5)}${spark(110, 330, 5)}${spark(200, 390, 4)}
    ${heart(70, 280, 0.9)}${heart(180, 240, 0.6, true)}
    ${dot(40, 130, 1.6)}${dot(140, 430, 1.5)}
  `),
  tabs: mural(900, 240, `
    ${fish(760, 150, 2.2, -4)}
    ${bubble(815, 125, 3)}${bubble(840, 105, 2.4)}${bubble(858, 88, 1.9)}
    ${fish(640, 80, 1.1, -8)}${bubble(600, 60, 2)}${bubble(582, 48, 1.5)}
    ${paw(80, 210, 1, -12)}${paw(160, 225, 0.9, 10)}${paw(240, 210, 1.05, -8)}${paw(320, 228, 0.85, 12)}${paw(400, 212, 0.95, -10)}${paw(480, 226, 0.7, 8)}
    ${heart(200, 80, 1.4)}${heart(300, 120, 0.8, true)}${heart(420, 60, 1.1)}${heart(520, 140, 0.7, true)}
    ${spark(120, 60, 6)}${spark(360, 160, 4.5)}${spark(560, 50, 5)}${spark(680, 200, 4)}${spark(60, 140, 4.5)}
    ${cloud(60, 40, 0.9)}
  `),
}

/* =====================================================================
 * FOOTBALL — matchday diagrams, top bins, silverware
 * =================================================================== */

const ballAt = (x, y, r, rot = 0) => {
  const pr = r * 0.36
  const pent = []
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
    pent.push([Math.cos(a) * pr, Math.sin(a) * pr])
  }
  const pentD = 'M' + pent.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L') + ' Z'
  const seams = pent
    .map((p) => {
      const len = Math.hypot(p[0], p[1])
      return `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} L${((p[0] / len) * r * 0.97).toFixed(1)} ${((p[1] / len) * r * 0.97).toFixed(1)}" stroke-width="1.1"/>`
    })
    .join('')
  return at(x, y, `<circle r="${r}" stroke-width="1.7"/><path d="${pentD}" fill="${W}" stroke="none"/>${seams}`, { r: rot })
}

const netGrid = (x0, y0, w, h, cols, rows) => {
  let out = ''
  for (let i = 0; i <= cols; i++) {
    const x = x0 + (w / cols) * i
    out += `<path d="M${x.toFixed(0)} ${y0} C ${(x - 6).toFixed(0)} ${(y0 + h * 0.4).toFixed(0)} ${(x - 10).toFixed(0)} ${(y0 + h * 0.75).toFixed(0)} ${(x - 14).toFixed(0)} ${y0 + h}" stroke-width="0.7"/>`
  }
  for (let j = 0; j <= rows; j++) {
    const y = y0 + (h / rows) * j
    out += `<path d="M${x0} ${y.toFixed(0)} C ${(x0 + w * 0.4).toFixed(0)} ${(y + 4).toFixed(0)} ${(x0 + w * 0.75).toFixed(0)} ${(y + 6).toFixed(0)} ${x0 + w} ${(y + 8).toFixed(0)}" stroke-width="0.7"/>`
  }
  return out
}

const BOOT = `
  <path d="M-20 6 C-20 -6 -12 -12 -6 -12 L-2 -4 L4 -6 L8 0 L18 2 C24 4 24 10 18 12 H-18 Z" stroke-width="1.5"/>
  <path d="M-9 -6 l4 3 M-6 -9 l4 3" stroke-width="0.8"/>
  <path d="M-14 12 v4 M-6 12 v4 M2 12 v4 M10 12 v4" stroke-width="1.2"/>`
const boot = (x, y, s, r) => at(x, y, BOOT, { s, r })

const TROPHY = `
  <path d="M-10 -14 H10 V-6 A10 10 0 0 1 -10 -6 Z" stroke-width="1.5"/>
  <path d="M-10 -12 H-16 A7 7 0 0 0 -9 -3 M10 -12 H16 A7 7 0 0 1 9 -3" stroke-width="1.1"/>
  <path d="M0 4 V8 M-7 14 H7 M-5 8 H5 V14 H-5 Z" stroke-width="1.3"/>`
const trophy = (x, y, s, r) => at(x, y, TROPHY, { s, r })

/** Laurel branch; leaves computed on the stem curve. flip=-1 mirrors. */
const laurel = (x, y, s, flip = 1) => {
  const leaves = [
    [24.9, 32], [18.9, 15.6], [16.8, -1.2], [18.5, -17.9], [22.3, -30],
  ]
    .map(([lx, ly]) => `<path d="M${(flip * lx).toFixed(1)} ${ly} q${flip * 8} -2 ${flip * 10} -9" stroke-width="0.9"/>`)
    .join('')
  return at(x, y, `<path d="M${flip * 32} 44 C${flip * 14} 18 ${flip * 12} -12 ${flip * 26} -38" stroke-width="1.2"/>${leaves}`, { s })
}

const WHISTLE = `
  <path d="M-16 -4 H8 A9 9 0 1 1 1 10 L-16 3 Z" stroke-width="1.4"/>
  ${dot(9, 4, 2.6)}
  <path d="M-8 -8 v-5 M-1 -8 v-7" stroke-width="1"/>`
const whistle = (x, y, s, r) => at(x, y, WHISTLE, { s, r })

const confetti = (x, y, r = 0) =>
  at(x, y, `<rect x="-3" y="-1.4" width="6" height="2.8" rx="0.8" fill="${W}" stroke="none"/>`, { r })

const football = {
  heroA: mural(440, 440, `
    ${ballAt(95, 395, 150, -12)}
    ${dashed('M158 221 A185 185 0 0 1 277 427', '6 10', 1.1)}
    ${dashed('M165 202 A205 205 0 0 1 297 431', '6 12', 1)}
    ${boot(330, 320, 2.2, -28)}
    <path d="M206 322 L190 310 M204 336 L186 342 M216 316 L210 298 M220 350 L214 366" stroke-width="1.1"/>
    ${dashed('M240 280 C320 150 370 110 425 55', '2 8', 1.3)}${chev(428, 50, 45)}
    ${confetti(150, 120, 20)}${confetti(220, 80, -14)}${confetti(300, 140, 30)}${confetti(90, 190, -22)}${confetti(260, 200, 12)}${confetti(360, 90, -8)}
    ${dot(60, 90, 1.8)}${dot(320, 30, 1.6)}${dot(190, 160, 1.5)}
  `),
  heroB: mural(460, 300, `
    <path d="M180 36 H460" stroke-width="1.6"/>
    <path d="M436 30 V300" stroke-width="1.6"/>
    <path d="M436 30 L460 14" stroke-width="1.1"/>
    ${netGrid(310, 60, 140, 220, 5, 7)}
    ${ballAt(120, 150, 34, 20)}
    ${line(60, 130, 20, 126, 1)}${line(70, 160, 18, 158, 1)}${line(80, 185, 30, 190, 1)}
    ${dashed('M154 140 C 300 60 360 62 398 74', '2 8', 1.3)}${chev(404, 76, 99)}
    ${confetti(60, 60, 16)}${confetti(130, 40, -20)}${confetti(220, 30, 8)}
    ${dot(40, 230, 1.8)}${dot(200, 250, 1.6)}
  `),
  left: mural(300, 780, `
    ${trophy(150, 80, 1.6)}
    ${laurel(100, 86, 0.9, -1)}${laurel(200, 86, 0.9, 1)}
    ${confetti(110, 30, 14)}${confetti(190, 40, -18)}${confetti(60, 130, 24)}${confetti(240, 140, -10)}
    ${dashed('M140 640 C60 540 230 460 150 360 C100 290 190 220 150 150', '2 8', 1.3)}${chev(150, 146, -30)}
    ${whistle(60, 420, 1.1, -15)}
    ${ballAt(85, 718, 70, 8)}
    ${boot(215, 700, 1.6, -20)}
    ${confetti(90, 560, 12)}${confetti(200, 500, -16)}${confetti(80, 300, 20)}${confetti(210, 260, -8)}${confetti(120, 220, 14)}
  `),
  banner: mural(900, 120, `
    <path d="M832 0 V120" stroke-width="1"/>
    ${ring(832, 60, 46, 1.2)}${dot(832, 60, 2.2)}
    ${ballAt(700, 62, 30, -30)}
    ${dashed('M728.3 28.3 A44 44 0 0 1 728.3 95.7', '5 8', 1)}
    ${dashed('M737.3 17.6 A58 58 0 0 1 737.3 106.4', '5 10', 0.9)}
    ${dashed('M666 58 C600 30 540 88 452 60', '2 8', 1.2)}${chev(447, 60, -73)}
    ${confetti(430, 30, 12)}${confetti(480, 85, -16)}${confetti(560, 25, 22)}${confetti(620, 90, -8)}${confetti(520, 55, 6)}
    ${dot(590, 60, 1.6)}${dot(650, 35, 1.5)}
  `),
  right: mural(320, 460, `
    ${trophy(255, 35, 3)}
    ${laurel(150, 130, 1.3, -1)}
    ${confetti(180, 180, 14)}${confetti(230, 210, -20)}${confetti(280, 190, 8)}${confetti(150, 240, 24)}${confetti(210, 260, -12)}${confetti(290, 250, 18)}${confetti(170, 310, -6)}${confetti(250, 300, 10)}
    ${whistle(80, 180, 1, 12)}
    ${ballAt(70, 420, 20, 10)}
    ${dashed('M96 404 A40 40 0 0 1 130 372', '4 8', 1)}
    ${dot(120, 90, 1.8)}${dot(60, 300, 1.6)}${dot(280, 380, 1.6)}
  `),
  tabs: mural(900, 240, `
    <path d="M0 222 H900" stroke-width="1.1"/>
    <path d="M450 222 V60" stroke-width="1"/>
    ${ring(450, 222, 80, 1.2)}${dot(450, 222, 2.4)}
    <path d="M0 150 H120 V222" stroke-width="1"/>
    <path d="M120 168 A26 26 0 0 1 120 204" stroke-width="0.9"/>
    ${ballAt(760, 180, 40, -18)}
    ${dashed('M814 152 A70 70 0 0 1 822 210', '5 9', 1)}
    ${boot(862, 148, 1.6, -35)}
    ${dashed('M712 168 C640 80 560 60 480 92', '2 8', 1.2)}${chev(476, 94, -112)}
    ${confetti(200, 60, 14)}${confetti(300, 100, -18)}${confetti(600, 40, 10)}${confetti(680, 120, -8)}${confetti(90, 80, 20)}${confetti(390, 50, -12)}
    ${whistle(60, 60, 0.9, -10)}
  `),
}

/* =====================================================================
 * DEGEN — liftoff, moon missions, chart walls
 * =================================================================== */

const ROCKET = `
  <path d="M0 -26 C7 -18 9 -8 9 2 L9 12 H-9 L-9 2 C-9 -8 -7 -18 0 -26 Z" stroke-width="1.5"/>
  <circle cy="-6" r="4.4" stroke-width="1.2"/><circle cy="-6" r="1.6" stroke-width="0.8"/>
  <path d="M-9 2 L-17 16 L-9 12 M9 2 L17 16 L9 12" stroke-width="1.3"/>
  <path d="M-4 12 V17 M4 12 V17" stroke-width="0.9"/>
  <path d="M-3 17 C-3 21 3 21 3 17" stroke-width="1.1"/>
  <path d="M-9 -2 H9" stroke-width="0.8"/>`
const rocket = (x, y, s, r) => at(x, y, ROCKET, { s, r })

const CURL = `<path d="M0 0 C-8 2 -10 10 -3 12 C2 13 4 8 0 7" stroke-width="1"/>`
const curl = (x, y, s, r) => at(x, y, CURL, { s, r })

const moonFull = (x, y, r, extra = '') =>
  at(x, y, `
    <circle r="${r}" stroke-width="1.7"/>
    ${ring(-r * 0.35, -r * 0.15, r * 0.14, 1)}
    ${ring(r * 0.15, r * 0.35, r * 0.09, 0.9)}
    ${dot(r * 0.3, -r * 0.4, r * 0.05)}${dot(-r * 0.1, r * 0.12, r * 0.045)}
    ${extra}`)

const flag = (x, y, s) =>
  at(x, y, `<path d="M0 0 V-22 M0 -22 H16 L11 -17 L16 -12 H0" stroke-width="1.2"/>`, { s })

const DIA = `
  <path d="M-13 -7 H13 L19 1 L0 17 L-19 1 Z" stroke-width="1.4"/>
  <path d="M-19 1 H19 M-13 -7 L-6.5 1 L0 17 M13 -7 L6.5 1 L0 17 M0 -7 L-6.5 1 M0 -7 L6.5 1" stroke-width="0.8"/>`
const diamond = (x, y, s, r) => at(x, y, DIA, { s, r })

const coin = (x, y, r) =>
  at(x, y, `
    <circle r="${r}" stroke-width="1.7"/>
    <circle r="${(r * 0.74).toFixed(1)}" stroke-width="0.9"/>
    <path d="M${(-r * 0.28).toFixed(1)} ${(r * 0.3).toFixed(1)} L${(r * 0.3).toFixed(1)} ${(-r * 0.28).toFixed(1)} M${(r * 0.3).toFixed(1)} ${(-r * 0.28).toFixed(1)} h${(-r * 0.22).toFixed(1)} M${(r * 0.3).toFixed(1)} ${(-r * 0.28).toFixed(1)} v${(r * 0.22).toFixed(1)}" stroke-width="1.4"/>
  `)

const candle = (x, top, h, w, wickUp, wickDn, filled) =>
  `<path d="M${x} ${top - wickUp} V${top} M${x} ${top + h} V${top + h + wickDn}" stroke-width="1"/><rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="1"${filled ? ` fill="${W}" stroke="none"` : ' stroke-width="1.3"'}/>`

const degen = {
  heroA: mural(440, 440, `
    ${rocket(170, 290, 3.2, 38)}
    ${line(95, 390, 20, 470, 1.1)}${line(135, 410, 50, 500, 1.1)}${line(75, 350, 25, 405, 1)}
    ${curl(60, 428, 1.6, 10)}${curl(118, 452, 1.3, -14)}
    ${dashed('M260 180 C320 120 360 80 430 20', '2 8', 1.2)}
    ${spark(330, 90, 8)}${spark(390, 200, 6)}${spark(260, 40, 5)}${spark(60, 120, 6)}${spark(140, 60, 4)}
    ${dot(300, 160, 1.8)}${dot(410, 60, 2)}${dot(200, 120, 1.6)}${dot(40, 220, 1.8)}${dot(360, 290, 1.6)}${dot(240, 220, 1.5)}
    ${diamond(350, 340, 1.3)}
    ${line(376, 322, 384, 314, 1)}${line(384, 348, 394, 348, 1)}
  `),
  heroB: mural(460, 300, `
    ${moonFull(350, 10, 120)}
    ${hatch(258, 78, 5, 18, 40, 14)}
    ${flag(265, 95, 1.15)}
    ${dashed('M40 280 C160 240 220 160 262 110', '2 8', 1.3)}
    ${rocket(150, 247, 1.2, 52)}
    ${spark(80, 80, 7)}${spark(180, 60, 5)}${spark(60, 190, 5)}${spark(240, 200, 4.5)}
    ${dot(120, 140, 1.8)}${dot(30, 60, 1.6)}${dot(210, 120, 1.6)}${dot(320, 230, 1.8)}${dot(420, 250, 2)}
  `),
  left: mural(300, 780, `
    ${moonFull(60, 80, 24)}
    ${candle(32, 705, 75, 14, 18, 0, false)}
    ${candle(72, 680, 100, 14, 24, 0, true)}
    ${candle(112, 692, 88, 14, 14, 0, false)}
    ${candle(152, 660, 120, 14, 26, 0, true)}
    ${candle(192, 648, 132, 14, 18, 0, false)}
    ${candle(232, 668, 112, 14, 22, 0, true)}
    ${candle(270, 628, 152, 14, 28, 0, false)}
    <path d="M20 662 L80 606 L108 628 L165 545 L198 568 L252 480" stroke-width="1.5"/>
    ${dashed('M252 480 L288 414', '2 7', 1.3)}${chev(290, 410, 29)}
    ${rocket(150, 260, 2, 30)}
    ${line(128, 300, 95, 355, 1)}${line(140, 310, 115, 368, 1)}
    ${curl(100, 380, 1.2, 0)}
    ${spark(230, 120, 6)}${spark(90, 180, 5)}${spark(250, 220, 4)}${spark(40, 320, 5)}
    ${dot(200, 60, 1.8)}${dot(270, 300, 1.6)}${dot(50, 420, 1.6)}${dot(240, 380, 1.5)}${dot(120, 130, 1.5)}
    ${diamond(230, 560, 1.1)}
  `),
  banner: mural(900, 120, `
    ${coin(895, 60, 52)}
    ${rocket(700, 55, 1.7, -95)}
    ${line(745, 42, 840, 38, 1)}${line(760, 58, 880, 52, 1)}${line(770, 72, 872, 70, 1)}
    <path d="M430 95 L510 70 L540 84 L620 55 L650 68 L718 45" stroke-width="1.3"/>
    ${dashed('M718 45 L770 32', '2 7', 1.1)}
    ${spark(480, 30, 5)}${spark(560, 95, 4)}${spark(380, 55, 4.5)}
    ${dot(340, 85, 1.6)}${dot(300, 40, 1.5)}${dot(250, 70, 1.4)}${dot(620, 25, 1.6)}
    ${diamond(430, 25, 0.9)}
  `),
  right: mural(320, 460, `
    ${coin(270, 50, 70)}
    ${diamond(220, 190, 1.6)}${diamond(150, 240, 1)}${diamond(255, 255, 0.7)}
    ${line(248, 168, 256, 160, 1)}${line(252, 196, 262, 196, 1)}${line(128, 222, 120, 214, 1)}
    <path d="M40 430 L90 396 L112 410 L162 362" stroke-width="1.3"/>
    ${dashed('M162 362 L190 340', '2 7', 1.1)}${chev(193, 337, 52)}
    ${spark(70, 120, 5)}${spark(180, 90, 4)}${spark(60, 260, 4.5)}
    ${dot(240, 340, 1.6)}${dot(80, 360, 1.5)}${dot(200, 420, 1.6)}${dot(40, 180, 1.5)}
  `),
  tabs: mural(900, 240, `
    ${candle(30, 188, 52, 15, 14, 0, false)}
    ${candle(102, 170, 70, 15, 20, 0, true)}
    ${candle(174, 178, 62, 15, 12, 0, false)}
    ${candle(246, 152, 88, 15, 22, 0, true)}
    ${candle(318, 160, 80, 15, 16, 0, true)}
    ${candle(390, 138, 102, 15, 24, 0, false)}
    ${candle(462, 148, 92, 15, 14, 0, true)}
    ${candle(534, 120, 120, 15, 26, 0, false)}
    ${candle(606, 132, 108, 15, 18, 0, true)}
    ${candle(678, 108, 132, 15, 24, 0, false)}
    ${candle(750, 122, 118, 15, 16, 0, true)}
    ${candle(822, 96, 144, 15, 28, 0, false)}
    <path d="M40 190 L150 150 L190 170 L300 120 L350 140 L470 90 L520 108 L650 60" stroke-width="1.5"/>
    ${dashed('M650 60 L755 38', '2 8', 1.2)}${chev(762, 36, 78)}
    ${moonFull(880, 10, 55)}
    ${rocket(800, 80, 1.3, 38)}
    ${line(770, 120, 720, 168, 0.9)}${line(788, 132, 750, 178, 0.9)}
    ${diamond(120, 70, 1)}${diamond(250, 50, 0.7)}
    ${spark(400, 40, 5)}${spark(560, 30, 4.5)}${spark(200, 30, 4)}
    ${dot(60, 40, 1.6)}${dot(330, 70, 1.5)}${dot(500, 50, 1.5)}${dot(620, 20, 1.8)}
  `),
}

export const MURALS = { galactic, mecha, kawaii, football, degen }

/** Studio swatch variant: crop-to-fill instead of letterboxing. */
export const withSlice = (svg) =>
  svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ')
