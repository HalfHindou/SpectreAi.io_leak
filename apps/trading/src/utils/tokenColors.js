/**
 * Token Color Utilities
 * Generates consistent colors for tokens and converts them to RGBA for backgrounds
 */

// Fallback color for tokens not in the known list
// Warm silver - neutral, matches any token, looks clean on dark backgrounds
const DEFAULT_TOKEN_COLOR = '#D4D4D8'

// Address-keyed curated colours. Used as a defensive fallback when the
// token's symbol arrives in an unexpected shape (e.g. Codex returns
// "Spectre AI" as the symbol, OR the symbol is briefly empty during
// the first paint of a deep-link). Address is the canonical identity —
// the curated lookup must work even when symbol is wrong / missing.
const KNOWN_TOKEN_COLORS_BY_ADDRESS = {
  '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6': '#D4D4D8', // SPECTRE
}

// Known token colors (for popular tokens)
const KNOWN_TOKEN_COLORS = {
  // Commodity futures
  'GC=F': '#FFC600', 'SI=F': '#C0C0C0', 'CL=F': '#1E1E1E', 'NG=F': '#0096FF',
  'HG=F': '#B87333', 'PL=F': '#E5E4E2', 'PA=F': '#BAC4C8',
  // Commodity ETFs
  'GLD': '#FFC600', 'SLV': '#C0C0C0', 'IAU': '#FFC600', 'USO': '#1E1E1E',
  'UNG': '#0096FF', 'CPER': '#B87333', 'NEM': '#FFC600', 'GOLD': '#FFC600',
  // ─────────────────────────────────────────────────────────────────────
  // Core tokens — official brand colours from each project's brand kit.
  // Audit pass 2026-05-26 fixed 5 issues caught by `audit-colors.cjs`:
  //   (a) SHIB → previously shared BTC's `#F7931A` → both rendered
  //       identical. Now `#FFA409` (SHIB's signature orange-yellow per
  //       shibatoken.com).
  //   (b) WIF → previously shared SOL's `#9945FF` → renders as Solana
  //       purple instead of WIF's brand. Now `#FFAFC9` (WIF's signature
  //       pink — hat/face palette from dogwifcoin.org).
  //   (c) RENDER → previously shared JUP's `#00D395` mint green → both
  //       rendered identical. Now `#FF0066` (Render's red from
  //       rendernetwork.com).
  //   (d) TAO/BITTENSOR → previously `#1C1C1E` (near-black, chroma
  //       0.004) → triggered normalizeAccent's MONOCHROME_FALLBACK and
  //       rendered as warm silver. Now `#FFCC33` (Bittensor's gold
  //       accent — vibrant, distinct, AI/yield feel).
  //   (e) RAY → previously `#4FC3F7` light blue → Raydium's actual brand
  //       is magenta-purple per raydium.io. Now `#C200FB`.
  // Detection: `node /tmp/audit-colors.cjs` (or recreate from the
  // `.claude/rules/token-accent-system.md` quick-lookup section). Run
  // after any curated-table edit to catch collisions and mono triggers.
  'SPECTRE': '#D4D4D8', 'ETH': '#627EEA', 'WETH': '#627EEA', 'BTC': '#F7931A',
  'WBTC': '#F7931A', 'SOL': '#9945FF', 'USDT': '#26A17B', 'USDC': '#2775CA',
  'PEPE': '#3D9E41', 'DOGE': '#C3A634', 'SHIB': '#FFA409', 'UNI': '#FF007A',
  'LINK': '#2A5ADA', 'AAVE': '#B6509E', 'ARB': '#28A0F0', 'OP': '#FF0420',
  'MATIC': '#8247E5', 'AVAX': '#E84142',
  // Solana tokens
  'WIF': '#FFAFC9', '$WIF': '#FFAFC9', 'DOGWIFHAT': '#FFAFC9',
  'JUP': '#00D395', 'JUPITER': '#00D395',
  'BONK': '#FF9500',
  'MOODENG': '#D4A5C9', 'MOO DENG': '#D4A5C9',
  'PYTH': '#6B4EE6',
  'JTO': '#14F195', 'JITO': '#14F195',
  'RENDER': '#FF0066', 'RNDR': '#FF0066',
  'TAO': '#FFCC33', 'BITTENSOR': '#FFCC33',
  'FET': '#1D1E4E', 'FETCH.AI': '#1D1E4E',
  // NEAR Protocol's official brand colour is mint green #00EC97 (from near.org/brand).
  // Was previously #00C1DE (cyan) — confused with INJ. Fixed 2026-05-26.
  'NEAR': '#00EC97', 'INJ': '#00F2FE', 'SUI': '#4DA2FF', 'APT': '#2ED8A3',
  'TIA': '#7B2BF9', 'SEI': '#9B1C1C', 'ONDO': '#1A56DB',
  'POPCAT': '#FFD93D',
  // WEN is a small Solana token; sharing SOL's purple is acceptable
  // (Solana-native, low view count). Not flagged as a hard collision.
  'WEN': '#9945FF',
  'BOME': '#FF6B35',
  'RAY': '#C200FB', 'RAYDIUM': '#C200FB',
  'PIPPIN': '#7DD3FC',
}

// FNV-1a 32-bit hash — spreads inputs much more evenly than (hash << 5) - hash,
// which clumps short strings into a narrow hue band. Address-driven hashing
// gives every token a visually distinct color even when symbols collide.
const fnv1a = (str) => {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

const generateColorFromString = (str) => {
  if (!str) return DEFAULT_TOKEN_COLOR
  const h = fnv1a(str)
  const hue = h % 360
  // Bias against the cyan/sky-blue band (170-220) to avoid collisions with
  // PIPPIN/RAY/etc. whose curated colors live there. Push hits in that range
  // toward magenta/orange instead.
  const finalHue = (hue >= 170 && hue <= 220) ? (hue + 140) % 360 : hue
  const saturation = 70 + ((h >>> 8) % 20)   // 70-89% — vivid
  const lightness = 55 + ((h >>> 16) % 12)   // 55-66% — readable on dark
  return `hsl(${finalHue}, ${saturation}%, ${lightness}%)`
}

// Get token color - uses known colors or hash-derived hue
export const getTokenColor = (symbol, address) => {
  // Check known colors first (handle various formats)
  if (symbol) {
    const upperSymbol = symbol.toUpperCase()
    if (KNOWN_TOKEN_COLORS[upperSymbol]) {
      return KNOWN_TOKEN_COLORS[upperSymbol]
    }
    // Also check without $ prefix for tokens like $WIF
    const cleanSymbol = upperSymbol.replace(/^\$/, '')
    if (KNOWN_TOKEN_COLORS[cleanSymbol]) {
      return KNOWN_TOKEN_COLORS[cleanSymbol]
    }
  }
  // Address-keyed curated fallback — canonical identity that survives
  // weird symbol shapes ("Spectre AI" instead of "SPECTRE") and the
  // initial-paint window where the symbol hasn't hydrated yet.
  if (address) {
    const lower = address.toLowerCase()
    if (KNOWN_TOKEN_COLORS_BY_ADDRESS[lower]) {
      return KNOWN_TOKEN_COLORS_BY_ADDRESS[lower]
    }
  }
  // Address has 40+ chars of entropy; mix it with symbol so two tokens with
  // the same symbol on different chains still get different colors.
  const seed = `${(symbol || '').toUpperCase()}|${address || ''}`
  return generateColorFromString(seed) || DEFAULT_TOKEN_COLOR
}

// Check if a token has a known hardcoded color (not the default fallback).
// Accepts (symbol, address) — address-keyed table is checked when the
// symbol lookup misses. Callers that only pass `symbol` still get the
// pre-existing behaviour (legacy signature still works).
export const hasKnownColor = (symbol, address) => {
  if (symbol) {
    const upper = symbol.toUpperCase()
    if (KNOWN_TOKEN_COLORS[upper]) return true
    const clean = upper.replace(/^\$/, '')
    if (KNOWN_TOKEN_COLORS[clean]) return true
  }
  if (address && KNOWN_TOKEN_COLORS_BY_ADDRESS[address.toLowerCase()]) return true
  return false
}


// ──────────────────────────────────────────────────────────────
// Server-side color extraction for tokens not in KNOWN_TOKEN_COLORS
// ──────────────────────────────────────────────────────────────

// Module-level cache (permanent per session - logo colors don't change)
const _serverColorCache = new Map()
// In-flight dedup to prevent duplicate concurrent requests
const _serverColorInflight = new Map()

/**
 * Fetch dominant color from a token logo via server-side extraction.
 * Returns a valid `#RRGGBB` hex string on success, or `null` on any failure.
 * Successful results are cached permanently per session; failures are NOT
 * cached client-side (the server already negative-caches with a short TTL),
 * so a flaky upstream doesn't lock the token to "no colour" forever.
 *
 * Failure contract changed 2026-05-26: previously returned `DEFAULT_TOKEN_COLOR`
 * (`#D4D4D8`, warm silver) on every failure path. That value is *also* a
 * legitimate brand colour (SPECTRE uses it), so using it as a sentinel made
 * every uncurated token whose extraction failed converge to the same near-
 * white, masking real brand identity and feeling like a stale cache. Null is
 * now the unambiguous "failed, caller should use hash hue" signal.
 *
 * @param {string} logoUrl - Full URL to the token logo image
 * @returns {Promise<string|null>} Hex color string or null
 */
export async function fetchTokenColorFromServer(logoUrl) {
  if (!logoUrl || logoUrl === '/logo.png') return null

  // Check session cache (only valid hex values get cached here)
  const cached = _serverColorCache.get(logoUrl)
  if (cached) return cached

  // Deduplicate concurrent requests for the same URL
  const inflight = _serverColorInflight.get(logoUrl)
  if (inflight) return inflight

  const promise = (async () => {
    try {
      const encodedUrl = encodeURIComponent(logoUrl)
      // 5s timeout (was 2s). The server itself caps PNG fetch at 5s and
      // typically responds in ~50ms once the result is cached, but on
      // initial page load the browser queues many simultaneous requests
      // (Codex search, Codex details, bars, dossier, etc.) and a 2s
      // budget for token-color was racing against the queue, returning
      // TimeoutError before the response landed. The async accent upgrade
      // then silently fell back to the hash hue. 5s gives the request
      // room to complete on cold loads while keeping a reasonable cap.
      const res = await fetch(`/api/token-color?url=${encodedUrl}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return null
      const data = await res.json()
      const color = data?.color
      // Only cache valid hex — server returns `{ color: null }` on failure,
      // and we do NOT want to lock that failure into the permanent session
      // cache. The server itself negative-caches for 60s.
      if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
        _serverColorCache.set(logoUrl, color)
        return color
      }
      return null
    } catch {
      /* timeout or network error — return null, do not cache */
      return null
    } finally {
      _serverColorInflight.delete(logoUrl)
    }
  })()

  _serverColorInflight.set(logoUrl, promise)
  return promise
}

/**
 * Client-side color extraction from an image URL using canvas.
 * Works even when the server-side extraction fails (e.g. XML responses, non-PNG formats).
 * Loads the image via a proxied URL to avoid CORS, samples pixels, returns dominant hex color.
 */
const _canvasColorCache = new Map()

export async function extractColorFromImage(imageUrl) {
  if (!imageUrl || imageUrl === '/logo.png') return null
  // Server-side img-proxy requires https URLs (SSRF guard). Skip relative
  // paths, data: URLs, blob:, http://, etc. so we don't trigger a 400
  // response in the browser network log on every fallback logo render.
  if (!/^https:\/\//i.test(imageUrl)) return null
  const cached = _canvasColorCache.get(imageUrl)
  if (cached) return cached
  try {
    // Use img-proxy to avoid CORS issues
    const proxiedUrl = `/api/img-proxy?url=${encodeURIComponent(imageUrl)}`
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = proxiedUrl
      setTimeout(reject, 3000)
    })
    const canvas = document.createElement('canvas')
    const size = 32 // downsample for speed
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data
    // Accumulate colors, skip very dark, very light, and transparent pixels
    let rSum = 0, gSum = 0, bSum = 0, count = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a < 128) continue // skip transparent
      const lum = (r * 0.299 + g * 0.587 + b * 0.114)
      if (lum < 20 || lum > 235) continue // skip near-black and near-white
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      if (sat < 15) continue // skip gray
      rSum += r; gSum += g; bSum += b; count++
    }
    if (count < 10) return null // not enough colorful pixels
    let rAvg = Math.round(rSum / count)
    let gAvg = Math.round(gSum / count)
    let bAvg = Math.round(bSum / count)
    // Boost dark colors so they're visible as background glows
    const avgLum = rAvg * 0.299 + gAvg * 0.587 + bAvg * 0.114
    if (avgLum < 80) {
      const boost = 80 / Math.max(avgLum, 1)
      rAvg = Math.min(255, Math.round(rAvg * boost))
      gAvg = Math.min(255, Math.round(gAvg * boost))
      bAvg = Math.min(255, Math.round(bAvg * boost))
    }
    const hex = `#${rAvg.toString(16).padStart(2, '0')}${gAvg.toString(16).padStart(2, '0')}${bAvg.toString(16).padStart(2, '0')}`
    _canvasColorCache.set(imageUrl, hex)
    // Write-through to server KV so the next user (or any other surface)
    // skips client-side extraction. Fire-and-forget — failure is harmless.
    fetch('/api/token-color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl, color: hex }),
    }).catch(() => { /* ignore */ })
    return hex
  } catch {
    return null
  }
}

/**
 * Synchronously check both color caches for a logo URL.
 * Canvas extraction is preferred — it filters out grays/edges/near-white pixels,
 * giving a truer brand color than the server's blunt PNG-decode-dominant pick.
 * Returns cached hex color or null. No network calls.
 */
export function getCachedColor(logoUrl) {
  if (!logoUrl) return null
  return _canvasColorCache.get(logoUrl) || _serverColorCache.get(logoUrl) || null
}

/**
 * Seed the server-color cache with a hex already resolved elsewhere (the
 * /api/token/snapshot payload bundles the extraction result, and the
 * persisted hot cache replays a prior session's). Both racing consumers
 * (App.jsx orb painter + useAccentTheme) then hit getCachedColor
 * synchronously instead of re-running extraction.
 *
 * Failure-signal contract (token-accent-system.md section D): null is the
 * ONLY failure value - we seed VALID HEX ONLY, never a sentinel. A null /
 * malformed color is skipped so callers fall through to live extraction.
 */
export function seedColorCache(logoUrl, hex) {
  if (!logoUrl || typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return
  if (!_serverColorCache.has(logoUrl)) _serverColorCache.set(logoUrl, hex)
}

// Convert hex/rgb/hsl color to RGB values
const colorToRgb = (color) => {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return { r, g, b }
  }
  
  // Handle hsl colors
  if (color.startsWith('hsl')) {
    const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
    if (match) {
      const h = parseInt(match[1]) / 360
      const s = parseInt(match[2]) / 100
      const l = parseInt(match[3]) / 100
      
      const c = (1 - Math.abs(2 * l - 1)) * s
      const x = c * (1 - Math.abs((h * 6) % 2 - 1))
      const m = l - c / 2
      
      let r, g, b
      if (h < 1/6) { r = c; g = x; b = 0 }
      else if (h < 2/6) { r = x; g = c; b = 0 }
      else if (h < 3/6) { r = 0; g = c; b = x }
      else if (h < 4/6) { r = 0; g = x; b = c }
      else if (h < 5/6) { r = x; g = 0; b = c }
      else { r = c; g = 0; b = x }
      
      return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
      }
    }
  }
  
  // Default fallback (warm silver)
  return { r: 212, g: 212, b: 216 }
}

// Generate background color variations from token color
export const generateTokenBackgroundColors = (tokenColor) => {
  const raw = colorToRgb(tokenColor)
  let { r, g, b } = raw

  // Boost dark/desaturated colors so they're visible as background glows
  const lum = r * 0.299 + g * 0.587 + b * 0.114
  if (lum < 100) {
    const boost = 100 / Math.max(lum, 1)
    r = Math.min(255, Math.round(r * boost))
    g = Math.min(255, Math.round(g * boost))
    b = Math.min(255, Math.round(b * boost))
  }

  const rgb = { r, g, b }

  // Create variations with different opacities and slight hue shifts
  // Primary: ambient glow - felt, not seen
  const primary = `rgba(${r}, ${g}, ${b}, 0.08)`

  // Secondary: slightly shifted hue (add 30 degrees in HSL space)
  const secondaryRgb = adjustHue(rgb, 30)
  const secondary = `rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.06)`

  // Tertiary: slightly shifted hue (subtract 20 degrees)
  const tertiaryRgb = adjustHue(rgb, -20)
  const tertiary = `rgba(${tertiaryRgb.r}, ${tertiaryRgb.g}, ${tertiaryRgb.b}, 0.05)`

  // Accent 1: lighter version
  const accent1Rgb = lighten(rgb, 0.1)
  const accent1 = `rgba(${accent1Rgb.r}, ${accent1Rgb.g}, ${accent1Rgb.b}, 0.04)`

  // Accent 2: darker version
  const accent2Rgb = darken(rgb, 0.1)
  const accent2 = `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.04)`
  
  // Grid color: very subtle
  const grid = `rgba(${r}, ${g}, ${b}, 0.02)`
  
  // Diagonal lines: subtle variations
  const diagonal1 = `rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.015)`
  const diagonal2 = `rgba(${r}, ${g}, ${b}, 0.015)`
  
  // Orbs: subtle ambient
  const orb1 = `rgba(${r}, ${g}, ${b}, 0.05)`
  const orb2 = `rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.04)`
  const orb3 = `rgba(${tertiaryRgb.r}, ${tertiaryRgb.g}, ${tertiaryRgb.b}, 0.03)`
  
  return {
    primary,
    secondary,
    tertiary,
    accent1,
    accent2,
    grid,
    diagonal1,
    diagonal2,
    orb1,
    orb2,
    orb3
  }
}

// Helper: Adjust hue of RGB color
const adjustHue = (rgb, degrees) => {
  const { r, g, b } = rgb
  // Convert to HSL
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255
  
  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  const delta = max - min
  
  let h = 0
  if (delta !== 0) {
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta) % 6
    } else if (max === gNorm) {
      h = (bNorm - rNorm) / delta + 2
    } else {
      h = (rNorm - gNorm) / delta + 4
    }
  }
  h = h * 60
  if (h < 0) h += 360
  
  // Adjust hue
  h = (h + degrees) % 360
  if (h < 0) h += 360
  
  // Convert back to RGB
  const s = delta === 0 ? 0 : delta / max
  const l = (max + min) / 2
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  
  let newR, newG, newB
  if (h < 60) { newR = c; newG = x; newB = 0 }
  else if (h < 120) { newR = x; newG = c; newB = 0 }
  else if (h < 180) { newR = 0; newG = c; newB = x }
  else if (h < 240) { newR = 0; newG = x; newB = c }
  else if (h < 300) { newR = x; newG = 0; newB = c }
  else { newR = c; newG = 0; newB = x }
  
  return {
    r: Math.round((newR + m) * 255),
    g: Math.round((newG + m) * 255),
    b: Math.round((newB + m) * 255)
  }
}

// Helper: Lighten RGB color
const lighten = (rgb, amount) => {
  return {
    r: Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount)),
    g: Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount)),
    b: Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount))
  }
}

// Helper: Darken RGB color
const darken = (rgb, amount) => {
  return {
    r: Math.max(0, Math.round(rgb.r * (1 - amount))),
    g: Math.max(0, Math.round(rgb.g * (1 - amount))),
    b: Math.max(0, Math.round(rgb.b * (1 - amount)))
  }
}
