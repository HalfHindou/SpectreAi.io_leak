/**
 * atlas.js — token-logo texture cache for the CONSTELLATION ENGINE.
 *
 * 280 bubbles each want a logo, but creating 280 THREE.Texture objects (each
 * with its own GPU upload + its own <Image>) is exactly the naive trap the
 * brief warns against. Instead:
 *   - Logos are loaded once per URL into a MODULE-SCOPE cache (survives
 *     remounts / view switches), keyed by src.
 *   - Each logo is rasterised into a circle-masked offscreen canvas (so a
 *     transparent square PNG reads as a clean round chip with no canvas-bleed),
 *     then wrapped in a single THREE.CanvasTexture.
 *   - Callers request a texture with getLogoTexture(src, onReady); they get the
 *     cached texture synchronously if ready, else null + a one-shot onReady
 *     callback when the async load + mask completes. The engine fades the logo
 *     in on ready and flips an InstancedBufferAttribute so the shader switches
 *     that instance from "letter glyph" to "logo".
 *
 * three is imported here, but this module only loads inside the lazy
 * ConstellationEngine chunk — never on the app boot path.
 */
import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three'

const SIZE = 128 // logo raster resolution (crisp at the largest bubble, cheap)

const _cache = new Map() // src -> { texture } | 'loading' | 'failed'
const _waiters = new Map() // src -> Set<fn>

function notify(src) {
  const set = _waiters.get(src)
  if (!set) return
  for (const fn of set) { try { fn(src) } catch { /* never let a waiter break the pipe */ } }
  _waiters.delete(src)
}

function maskToCircle(img) {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  // circular clip
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  // cover-fit the logo into the circle
  const ar = img.width / img.height || 1
  let dw = SIZE
  let dh = SIZE
  if (ar > 1) { dh = SIZE; dw = SIZE * ar } else { dw = SIZE; dh = SIZE / ar }
  ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.anisotropy = 2
  tex.needsUpdate = true
  return tex
}

/**
 * Get a circle-masked logo texture for `src`.
 * @returns the cached THREE.CanvasTexture, or null if still loading / failed.
 */
export function getLogoTexture(src, onReady) {
  if (!src) return null
  const cached = _cache.get(src)
  if (cached && cached !== 'loading' && cached !== 'failed') return cached.texture
  if (cached === 'failed') return null
  if (cached === 'loading') {
    if (onReady) {
      let set = _waiters.get(src)
      if (!set) { set = new Set(); _waiters.set(src, set) }
      set.add(onReady)
    }
    return null
  }
  // begin load
  _cache.set(src, 'loading')
  if (onReady) {
    const set = new Set([onReady])
    _waiters.set(src, set)
  }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    try {
      const texture = maskToCircle(img)
      _cache.set(src, { texture })
      notify(src)
    } catch {
      _cache.set(src, 'failed')
    }
  }
  img.onerror = () => { _cache.set(src, 'failed') }
  img.src = src
  return null
}

/** Whether a src has resolved (success or failure) — lets the engine stop polling. */
export function isLogoResolved(src) {
  const c = _cache.get(src)
  return c === 'failed' || (c && c !== 'loading')
}
