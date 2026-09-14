/**
 * walletAvatar - a deterministic face for a wallet address, so the same
 * wallet is recognisable across the tape, holders and top traders at a
 * glance (GMGN gives every wallet a frog; ours is a sigil).
 *
 * Spectre style: a deep, desaturated tint picked from a 12-tone palette and
 * a mirrored 5x5 pixel sigil in warm white on top, cropped to a circle like
 * a profile picture. 12 tints x 2^15 sigils,
 * so two wallets on one screen sharing a face is a non-event. Built as an
 * SVG data URI - one <img> per row, no canvas, cached per address.
 */

// Deep tints: enough hue to tell wallets apart, never loud enough to compete
// with bull/bear or the token accent. Warm white reads on every one of them.
const TINTS = [
  '#2A3446', // slate
  '#2F2D4A', // indigo
  '#3B2C48', // plum
  '#452A3B', // wine
  '#472E2A', // rust
  '#47392A', // amber
  '#3E3E26', // olive
  '#2E402C', // moss
  '#24403A', // jade
  '#243D40', // teal
  '#23394A', // ocean
  '#3A3A3E', // graphite
]

const INK = '#F5F5F7'

// FNV-1a, two seeds -> 64 usable bits from any address string.
function fnv(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// 5x5 grid, left-right mirrored: 15 random cells decide the whole sigil.
const GRID = 5
// Sized so the corner cells stay inside the circular pfp crop.
const CELL = 2.4
const GAP = 0.45
const SPAN = GRID * CELL + (GRID - 1) * GAP // 13.8
const ORIGIN = (20 - SPAN) / 2 // 3.1

function sigilCells(bits) {
  const cells = []
  let on = 0
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < 3; col++) {
      if ((bits >>> (row * 3 + col)) & 1) {
        cells.push([col, row])
        on += 1
        if (col < 2) { cells.push([GRID - 1 - col, row]); on += 1 }
      }
    }
  }
  return { cells, on }
}

function buildSvg(address) {
  const key = String(address || '').toLowerCase()
  const h1 = fnv(key, 0x811c9dc5)
  const h2 = fnv(key, 0x9747b28c)
  const tint = TINTS[h2 % TINTS.length]
  let bits = h1 & 0x7fff
  let { cells, on } = sigilCells(bits)
  // A near-empty or near-solid sigil has no shape to remember - re-roll
  // from the second hash until it lands in the readable band.
  let spare = h2 >>> 4
  let tries = 0
  while ((on < 6 || on > 18) && tries < 6) {
    bits ^= (spare & 0x7fff)
    spare = (spare >>> 5) | (spare << 27)
    ;({ cells, on } = sigilCells(bits))
    tries += 1
  }
  const rects = cells
    .map(([c, r]) => `<rect x="${(ORIGIN + c * (CELL + GAP)).toFixed(1)}" y="${(ORIGIN + r * (CELL + GAP)).toFixed(1)}" width="${CELL}" height="${CELL}" rx=".45"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="${tint}"/><g fill="${INK}" fill-opacity=".92">${rects}</g></svg>`
}

const cache = new Map()
const CACHE_MAX = 1500

export function walletAvatarSrc(address) {
  if (!address) return null
  const key = String(address).toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSvg(key))}`
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, uri)
  return uri
}

export function walletTint(address) {
  if (!address) return TINTS[TINTS.length - 1]
  return TINTS[fnv(String(address).toLowerCase(), 0x9747b28c) % TINTS.length]
}
