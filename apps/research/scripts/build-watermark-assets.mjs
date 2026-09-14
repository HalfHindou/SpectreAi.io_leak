/**
 * build-watermark-assets — regenerates public/spectre-wm-{light,dark}.png
 *
 * The chart watermark needs a CLEAN, TIGHT lockup: the brand logo assets ship a
 * black rounded tile behind the glyph plus a lot of transparent padding, so
 * drawing them at ~15px height left the glyph a few pixels tall with a ghost of
 * the tile's rounded edge around it ("tiny, deformed").
 *
 * This bakes a flat-ink lockup from the high-res master:
 *   ink = alpha x luminance  → the black tile falls out, the white glyph and the
 *   silver wordmark stay. Then threshold (kills the tile's antialiased rim),
 *   crop to the ink bounding box, box-filter down, and recolour:
 *     spectre-wm-light.png → warm-white ink (for dark charts)
 *     spectre-wm-dark.png  → slate ink     (for light charts)
 *
 * Run:  node apps/research/scripts/build-watermark-assets.mjs
 * Needs `pngjs` (dev-only; already present in the monorepo's node_modules).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, '..', 'public')

const SOURCE = path.join(PUBLIC, 'Spectre Logo Light.png')
const OUT_HEIGHT = 128        // plenty for a 15px mark at 3x DPR
const TILE_FLOOR = 0.22       // inside the black tile: below this = its gloss sheen
const WORD_FLOOR = 0.55       // wordmark luminance that should read as full ink

const lumAt = (d, o) => (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255

// The master is [ black rounded tile + white glyph ][ silver wordmark on
// transparent ]. Those two halves need different rules: inside the tile only
// luminance separates glyph from background (and the tile has a gloss sheen that
// a naive threshold keeps — that was the ghost rim in the old asset); outside it
// alpha already carries the shape.
// The tile is the first contiguous run of non-transparent columns (its bright
// glass rim included — that rim must NOT fall through to the wordmark branch).
function tileRight(png) {
  const { width: w, height: h, data } = png
  for (let x = 0; x < w; x++) {
    let painted = false
    for (let y = 0; y < h; y++) if (data[(y * w + x) * 4 + 3] > 8) { painted = true; break }
    if (!painted) return x - 1
  }
  return -1
}

// The tile also carries a bright ~3px glass rim, brighter than parts of the
// glyph — no threshold can separate them, so find the glyph geometrically
// (brightest pixels well inside the tile) and keep only that window.
function glyphBox(png, tileX, pad = 20) {
  const { width: w, height: h, data } = png
  const inset = Math.round(h * 0.1)
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = inset; y < h - inset; y++) {
    for (let x = inset; x <= tileX - inset; x++) {
      const o = (y * w + x) * 4
      if ((data[o + 3] / 255) * lumAt(data, o) < 0.45) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) throw new Error('no glyph found inside the tile')
  return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(tileX, x1 + pad), y1: Math.min(h - 1, y1 + pad) }
}

function inkMask(png, tileX, glyph) {
  const { width: w, height: h, data } = png
  const mask = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4
      const a = data[o + 3] / 255
      if (a <= 0) continue
      const lum = lumAt(data, o)
      let ink
      if (x <= tileX) {
        // tile half: glyph window only, remapped from [TILE_FLOOR..1] → [0..1]
        // so the tile's sheen clips to nothing while the glyph's antialiased
        // edges still ramp smoothly.
        if (x < glyph.x0 || x > glyph.x1 || y < glyph.y0 || y > glyph.y1) continue
        ink = (a * lum - TILE_FLOOR) / (1 - TILE_FLOOR)
      } else {
        // wordmark half: alpha is the shape, luminance only lifts the gradient
        ink = a * Math.min(1, lum / WORD_FLOOR)
      }
      if (ink > 0) mask[i] = Math.min(1, ink)
    }
  }
  return mask
}

function bbox(mask, w, h, min = 0.14) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] < min) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) throw new Error('no ink found in source')
  return { x0, y0, x1, y1 }
}

// box-filter downsample of the cropped mask
function resample(mask, w, box, outW, outH) {
  const sw = box.x1 - box.x0 + 1, sh = box.y1 - box.y0 + 1
  const out = new Float32Array(outW * outH)
  for (let oy = 0; oy < outH; oy++) {
    const sy0 = box.y0 + Math.floor((oy * sh) / outH)
    const sy1 = box.y0 + Math.max(sy0 + 1 - box.y0, Math.floor(((oy + 1) * sh) / outH))
    for (let ox = 0; ox < outW; ox++) {
      const sx0 = box.x0 + Math.floor((ox * sw) / outW)
      const sx1 = box.x0 + Math.max(sx0 + 1 - box.x0, Math.floor(((ox + 1) * sw) / outW))
      let sum = 0, n = 0
      for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { sum += mask[y * w + x]; n++ }
      out[oy * outW + ox] = n ? sum / n : 0
    }
  }
  return out
}

function write(file, mask, w, h, rgb) {
  const png = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    png.data[o] = rgb[0]; png.data[o + 1] = rgb[1]; png.data[o + 2] = rgb[2]
    png.data[o + 3] = Math.round(Math.max(0, Math.min(1, mask[i])) * 255)
  }
  writeFileSync(file, PNG.sync.write(png))
  console.log(`  wrote ${path.basename(file)}  ${w}x${h}`)
}

const src = PNG.sync.read(readFileSync(SOURCE))
const tileX = tileRight(src)
const glyph = glyphBox(src, tileX)
const mask = inkMask(src, tileX, glyph)
const box = bbox(mask, src.width, src.height)
const outH = OUT_HEIGHT
const outW = Math.max(1, Math.round(((box.x1 - box.x0 + 1) / (box.y1 - box.y0 + 1)) * outH))
console.log(`source ${src.width}x${src.height} · tile ends x=${tileX} → ink box ${box.x0},${box.y0} ${box.x1 - box.x0 + 1}x${box.y1 - box.y0 + 1}`)
const small = resample(mask, src.width, box, outW, outH)
write(path.join(PUBLIC, 'spectre-wm-light.png'), small, outW, outH, [245, 245, 247])
write(path.join(PUBLIC, 'spectre-wm-dark.png'), small, outW, outH, [15, 23, 42])
