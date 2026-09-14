/**
 * Dynamic token color extraction.
 *
 * Adapted from apps/trading/src/utils/tokenColors.js. Provides three layers
 * to resolve a brand color when the symbol is not in TOKEN_ROW_COLORS:
 *
 *   1. fetchTokenColorFromServer(logoUrl) - hits /api/token-color KV cache
 *   2. extractColorFromImage(logoUrl)     - downsamples logo on canvas,
 *                                            filters gray/edges/transparent,
 *                                            write-through to server KV
 *   3. generateColorFromString(seed)      - FNV-1a hash → HSL, last resort
 */

const DEFAULT_HEX = '#8B5CF6'

// FNV-1a 32-bit hash — spreads inputs more evenly than (h<<5) - h.
const fnv1a = (str) => {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

export const generateColorFromString = (str) => {
  if (!str) return DEFAULT_HEX
  const h = fnv1a(str)
  const hue = h % 360
  // Bias against the cyan/sky-blue band (170-220) where many curated
  // colors live; push collisions toward magenta/orange instead.
  const finalHue = (hue >= 170 && hue <= 220) ? (hue + 140) % 360 : hue
  const saturation = 70 + ((h >>> 8) % 20)   // 70-89%
  const lightness = 55 + ((h >>> 16) % 12)   // 55-66%
  return hslToHex(finalHue, saturation, lightness)
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Server KV cache (permanent per session)
const _serverColorCache = new Map()
const _serverColorInflight = new Map()

export async function fetchTokenColorFromServer(logoUrl) {
  if (!logoUrl) return null
  const cached = _serverColorCache.get(logoUrl)
  if (cached !== undefined) return cached

  const inflight = _serverColorInflight.get(logoUrl)
  if (inflight) return inflight

  const promise = (async () => {
    try {
      const res = await fetch(`/api/token-color?url=${encodeURIComponent(logoUrl)}`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!res.ok) return null
      const data = await res.json()
      const color = data?.color || null
      _serverColorCache.set(logoUrl, color)
      return color
    } catch {
      return null
    } finally {
      _serverColorInflight.delete(logoUrl)
    }
  })()

  _serverColorInflight.set(logoUrl, promise)
  return promise
}

// Canvas extraction cache
const _canvasColorCache = new Map()

export async function extractColorFromImage(imageUrl) {
  if (!imageUrl) return null
  const cached = _canvasColorCache.get(imageUrl)
  if (cached !== undefined) {
    console.log('[extractColorFromImage] cached →', cached)
    return cached
  }
  try {
    const proxiedUrl = `/api/img-proxy?url=${encodeURIComponent(imageUrl)}`
    console.log('[extractColorFromImage] loading via proxy:', proxiedUrl)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = (e) => { console.warn('[extractColorFromImage] img.onerror', e); reject(e) }
      img.src = proxiedUrl
      setTimeout(() => reject(new Error('timeout 3s')), 3000)
    })
    const canvas = document.createElement('canvas')
    // Larger sample (64x64 = 4096 px vs 32x32 = 1024) so logos with small
    // colored accents (e.g. PaLM AI's teal badge on a black icon) still have
    // enough pixels above the saturation/luminance thresholds.
    const size = 64
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data
    let rSum = 0, gSum = 0, bSum = 0, count = 0
    let skippedTransparent = 0, skippedDark = 0, skippedBright = 0, skippedGray = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a < 128) { skippedTransparent++; continue }
      const lum = (r * 0.299 + g * 0.587 + b * 0.114)
      // Looser luminance thresholds (was 20/235) to keep edge pixels.
      if (lum < 10) { skippedDark++; continue }
      if (lum > 245) { skippedBright++; continue }
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      // Looser saturation threshold (was 15) to admit muted brand colors.
      if (sat < 8) { skippedGray++; continue }
      rSum += r; gSum += g; bSum += b; count++
    }
    console.log('[extractColorFromImage] pixel stats', { count, skippedTransparent, skippedDark, skippedBright, skippedGray, total: data.length / 4 })
    // Threshold lowered (was 10) for tiny accent pixels.
    if (count < 5) {
      console.warn('[extractColorFromImage] not enough colorful pixels (count<5) → null. logo is mostly transparent/dark/bright/gray')
      _canvasColorCache.set(imageUrl, null)
      return null
    }
    let rAvg = Math.round(rSum / count)
    let gAvg = Math.round(gSum / count)
    let bAvg = Math.round(bSum / count)
    const avgLum = rAvg * 0.299 + gAvg * 0.587 + bAvg * 0.114
    if (avgLum < 80) {
      const boost = 80 / Math.max(avgLum, 1)
      rAvg = Math.min(255, Math.round(rAvg * boost))
      gAvg = Math.min(255, Math.round(gAvg * boost))
      bAvg = Math.min(255, Math.round(bAvg * boost))
    }
    const hex = `#${rAvg.toString(16).padStart(2, '0')}${gAvg.toString(16).padStart(2, '0')}${bAvg.toString(16).padStart(2, '0')}`
    _canvasColorCache.set(imageUrl, hex)
    // Write-through to server KV — fire and forget.
    fetch('/api/token-color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl, color: hex }),
    }).catch(() => { /* ignore */ })
    return hex
  } catch {
    _canvasColorCache.set(imageUrl, null)
    return null
  }
}

export function getCachedExtractedColor(logoUrl) {
  if (!logoUrl) return null
  return _canvasColorCache.get(logoUrl) || _serverColorCache.get(logoUrl) || null
}

// Convert hex "#RRGGBB" → "r, g, b" for use in `rgba(${rgb}, 0.5)`.
export function hexToRgbString(hex) {
  if (!hex || !hex.startsWith('#')) return null
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return null
  return `${r}, ${g}, ${b}`
}

// Build a 3-stop gradient from a single hex (lighter at start, darker at end)
export function buildGradientFromHex(hex) {
  const rgb = hexToRgbString(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.split(',').map(s => parseInt(s.trim(), 10))
  const lighten = (v) => Math.min(255, Math.round(v + (255 - v) * 0.25))
  const darken = (v) => Math.max(0, Math.round(v * 0.7))
  const lr = lighten(r), lg = lighten(g), lb = lighten(b)
  const dr = darken(r), dg = darken(g), db = darken(b)
  const toHex = (v) => v.toString(16).padStart(2, '0')
  const startHex = `#${toHex(lr)}${toHex(lg)}${toHex(lb)}`
  const endHex = `#${toHex(dr)}${toHex(dg)}${toHex(db)}`
  return `linear-gradient(135deg, ${startHex} 0%, ${hex} 50%, ${endHex} 100%)`
}
