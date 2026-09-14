/**
 * SkinArt/motifs — small single-mark art for decorative skins.
 *
 * ~6 ORIGINAL line-art motifs per skin (inspired-by vibes, zero licensed
 * IP), authored as plain SVG strings in a 64x64 viewBox, warm-white
 * (#F5F5F7) strokes/fills so they read uniformly on the obsidian ladder
 * at any opacity.
 *
 * Since the v7 mural rework (SkinArt/murals.js) the panel/page surfaces
 * are covered by large compositions; motifs remain the source for the
 * two spots where a single small mark is correct — the chart watermark
 * and the empty-state mascots — plus the shared <Motif> renderer and
 * svgToDataUri used by both art files.
 */

import React from 'react'

const W = '#F5F5F7'
const wrap = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`

/* ---------------- GALACTIC — space, original sci-fi ----------------- */

const galactic = {
  planet: wrap(`
    <circle cx="32" cy="32" r="13"/>
    <path d="M8 38 C14 28 50 16 58 22 M6 40 C13 47 52 34 59 24" stroke-width="2"/>
    <circle cx="49" cy="13" r="2.4" fill="${W}" stroke="none"/>
  `),
  fighter: wrap(`
    <path d="M32 8 L37 30 L54 44 L38 40 L32 56 L26 40 L10 44 L27 30 Z"/>
    <circle cx="32" cy="33" r="3.4"/>
  `),
  stars: wrap(`
    <path d="M18 12 L20 18 L26 20 L20 22 L18 28 L16 22 L10 20 L16 18 Z" fill="${W}" stroke="none"/>
    <path d="M44 30 L46 37 L53 39 L46 41 L44 48 L42 41 L35 39 L42 37 Z"/>
    <circle cx="50" cy="14" r="1.8" fill="${W}" stroke="none"/>
    <circle cx="16" cy="48" r="2.2" fill="${W}" stroke="none"/>
  `),
  orbit: wrap(`
    <ellipse cx="32" cy="32" rx="24" ry="10" transform="rotate(-24 32 32)"/>
    <ellipse cx="32" cy="32" rx="24" ry="10" transform="rotate(38 32 32)" stroke-width="1.6"/>
    <circle cx="32" cy="32" r="5" fill="${W}" stroke="none"/>
    <circle cx="52" cy="20" r="2.6" fill="${W}" stroke="none"/>
  `),
  astronaut: wrap(`
    <circle cx="32" cy="22" r="11"/>
    <path d="M26 20 a8 6 0 0 1 12 0" stroke-width="2"/>
    <path d="M22 33 h20 v14 a10 6 0 0 1 -20 0 Z"/>
    <path d="M22 37 L14 44 M42 37 L50 44"/>
  `),
  comet: wrap(`
    <circle cx="44" cy="20" r="7" fill="${W}" stroke="none"/>
    <path d="M38 26 L14 50 M42 30 L24 54 M34 22 L8 40" stroke-width="2"/>
  `),
}

/* ---------------- MECHA — robots, gears, circuits ------------------- */

const mecha = {
  robotHead: wrap(`
    <rect x="14" y="18" width="36" height="30" rx="6"/>
    <circle cx="26" cy="32" r="4" fill="${W}" stroke="none"/>
    <circle cx="38" cy="32" r="4" fill="${W}" stroke="none"/>
    <path d="M24 42 h16 M32 18 V8 M32 8 h6" />
    <circle cx="40" cy="8" r="2.4" fill="${W}" stroke="none"/>
  `),
  gear: wrap(`
    <circle cx="32" cy="32" r="13"/>
    <circle cx="32" cy="32" r="5"/>
    <path d="M32 12 v7 M32 45 v7 M12 32 h7 M45 32 h7 M18 18 l5 5 M41 41 l5 5 M46 18 l-5 5 M23 41 l-5 5"/>
  `),
  circuit: wrap(`
    <path d="M10 16 h18 v14 h20 M10 34 h12 v14 h26 M28 30 v-8"/>
    <circle cx="10" cy="16" r="3"/>
    <circle cx="48" cy="30" r="3" fill="${W}" stroke="none"/>
    <circle cx="10" cy="34" r="3"/>
    <circle cx="48" cy="48" r="3" fill="${W}" stroke="none"/>
  `),
  claw: wrap(`
    <path d="M12 52 L24 40 M24 40 L20 30 L28 36 M24 40 L36 44 L30 34"/>
    <path d="M28 36 C24 24 34 14 46 14 M30 34 C30 26 36 20 46 20"/>
    <circle cx="50" cy="17" r="4"/>
  `),
  bot: wrap(`
    <rect x="22" y="10" width="20" height="14" rx="4"/>
    <circle cx="28" cy="17" r="1.8" fill="${W}" stroke="none"/>
    <circle cx="36" cy="17" r="1.8" fill="${W}" stroke="none"/>
    <rect x="18" y="28" width="28" height="20" rx="5"/>
    <path d="M18 34 L10 42 M46 34 L54 42 M26 48 v8 M38 48 v8"/>
  `),
  hex: wrap(`
    <path d="M32 8 L52 20 V44 L32 56 L12 44 V20 Z"/>
    <path d="M32 20 L42 26 V38 L32 44 L22 38 V26 Z" stroke-width="1.6"/>
  `),
}

/* ---------------- KAWAII — cute, original -------------------------- */

const kawaii = {
  catFace: wrap(`
    <path d="M14 22 L12 8 L24 16 M50 22 L52 8 L40 16"/>
    <ellipse cx="32" cy="34" rx="20" ry="17"/>
    <circle cx="25" cy="32" r="2.4" fill="${W}" stroke="none"/>
    <circle cx="39" cy="32" r="2.4" fill="${W}" stroke="none"/>
    <path d="M29 40 q3 3 6 0 M6 30 L16 32 M6 38 L16 37 M58 30 L48 32 M58 38 L48 37" stroke-width="2"/>
  `),
  paw: wrap(`
    <ellipse cx="32" cy="40" rx="13" ry="10"/>
    <circle cx="16" cy="26" r="5"/>
    <circle cx="32" cy="20" r="5"/>
    <circle cx="48" cy="26" r="5"/>
  `),
  bow: wrap(`
    <path d="M28 32 C18 20 8 22 10 32 C8 42 18 44 28 32 Z"/>
    <path d="M36 32 C46 20 56 22 54 32 C56 42 46 44 36 32 Z"/>
    <circle cx="32" cy="32" r="5" fill="${W}" stroke="none"/>
  `),
  fish: wrap(`
    <path d="M10 32 C20 18 40 18 48 32 C40 46 20 46 10 32 Z"/>
    <path d="M48 32 L58 22 V42 Z"/>
    <circle cx="22" cy="30" r="2" fill="${W}" stroke="none"/>
  `),
  heart: wrap(`
    <path d="M32 52 C10 38 12 20 24 18 C30 17 32 24 32 24 C32 24 34 17 40 18 C52 20 54 38 32 52 Z"/>
  `),
  sparkle: wrap(`
    <path d="M32 10 L36 28 L54 32 L36 36 L32 54 L28 36 L10 32 L28 28 Z" fill="${W}" stroke="none"/>
  `),
}

/* ---------------- FOOTBALL ------------------------------------------ */

const football = {
  ball: wrap(`
    <circle cx="32" cy="32" r="20"/>
    <path d="M32 24 L40 30 L37 39 H27 L24 30 Z" fill="${W}" stroke="none"/>
    <path d="M32 24 V12 M40 30 L51 26 M37 39 L45 48 M27 39 L19 48 M24 30 L13 26" stroke-width="2"/>
  `),
  trophy: wrap(`
    <path d="M22 10 h20 v12 a10 10 0 0 1 -20 0 Z"/>
    <path d="M22 14 H12 a8 8 0 0 0 10 10 M42 14 h10 a8 8 0 0 1 -10 10"/>
    <path d="M32 32 v8 M24 46 h16 M26 40 h12 v6 h-12 Z"/>
  `),
  whistle: wrap(`
    <path d="M12 26 h26 a10 10 0 1 1 -8 16 L12 34 Z"/>
    <circle cx="40" cy="34" r="3.4" fill="${W}" stroke="none"/>
    <path d="M22 18 v-6 M30 18 v-8" stroke-width="2"/>
  `),
  pitch: wrap(`
    <rect x="8" y="12" width="48" height="40" rx="2"/>
    <path d="M32 12 v40"/>
    <circle cx="32" cy="32" r="7"/>
    <path d="M8 24 h8 v16 h-8 M56 24 h-8 v16 h8" stroke-width="2"/>
  `),
  boot: wrap(`
    <path d="M12 40 C12 28 20 22 26 22 L30 30 L36 28 L40 34 L50 36 C56 38 56 44 50 46 H14 Z"/>
    <path d="M18 46 v6 M28 46 v6 M38 46 v6 M46 46 v6" stroke-width="2"/>
  `),
  shirt: wrap(`
    <path d="M24 10 L12 18 L18 28 L22 25 V52 H42 V25 L46 28 L52 18 L40 10 A8 6 0 0 1 24 10 Z"/>
    <path d="M28 34 v10 M34 34 a4 5 0 1 1 0 10 a4 5 0 1 1 0 -10" stroke-width="2"/>
  `),
}

/* ---------------- DEGEN — crypto memes, original marks --------------- */

const degen = {
  rocket: wrap(`
    <path d="M32 6 C42 14 44 30 38 42 H26 C20 30 22 14 32 6 Z"/>
    <circle cx="32" cy="24" r="5"/>
    <path d="M26 36 L16 46 L24 44 M38 36 L48 46 L40 44 M28 46 C28 52 32 56 32 58 C32 56 36 52 36 46" stroke-width="2"/>
  `),
  diamond: wrap(`
    <path d="M18 12 H46 L56 26 L32 54 L8 26 Z"/>
    <path d="M8 26 H56 M18 12 L26 26 L32 54 M46 12 L38 26 L32 54 M26 26 H38" stroke-width="1.6"/>
  `),
  coin: wrap(`
    <circle cx="32" cy="32" r="20"/>
    <circle cx="32" cy="32" r="14" stroke-width="1.6"/>
    <path d="M32 22 L40 34 H35 V42 H29 V34 H24 Z" fill="${W}" stroke="none"/>
  `),
  bull: wrap(`
    <path d="M12 14 C10 24 16 28 22 28 M52 14 C54 24 48 28 42 28"/>
    <path d="M22 28 C20 40 26 50 32 50 C38 50 44 40 42 28 C40 22 24 22 22 28 Z"/>
    <circle cx="27" cy="34" r="1.8" fill="${W}" stroke="none"/>
    <circle cx="37" cy="34" r="1.8" fill="${W}" stroke="none"/>
    <path d="M29 44 h6" stroke-width="2"/>
  `),
  moonflag: wrap(`
    <path d="M40 8 A22 22 0 1 0 56 38 A17 17 0 0 1 40 8 Z"/>
    <path d="M38 26 V14 M38 14 h9 l-3 3 l3 3 h-9" stroke-width="2"/>
  `),
  pump: wrap(`
    <path d="M8 52 H20 V42 H30 V32 H40 V20 H50"/>
    <path d="M42 12 L54 12 L54 24" stroke-width="2.5"/>
    <path d="M54 12 L38 30" stroke-width="2.5"/>
  `),
}

export const MOTIFS = { galactic, mecha, kawaii, football, degen }

/** CSS-ready data URI (usable directly as a custom-property value). */
export function svgToDataUri(svg) {
  const enc = encodeURIComponent(svg.replace(/\s+/g, ' ').trim())
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
  return `url("data:image/svg+xml,${enc}")`
}

/** Inline React renderer for a motif svg string. */
export function Motif({ svg, size = 48, style, className }) {
  return React.createElement('span', {
    className,
    'aria-hidden': 'true',
    style: { display: 'inline-flex', width: size, height: size, ...style },
    dangerouslySetInnerHTML: { __html: svg },
  })
}
