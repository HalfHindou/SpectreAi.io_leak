/**
 * useTokenBrandColor - resolves a brand color for any token.
 *
 * Resolution order:
 *   1. TOKEN_ROW_COLORS[symbol] (curated)
 *   2. cached extracted color (server KV or local canvas)
 *   3. fetched server KV color
 *   4. live canvas extraction from logoUrl
 *   5. hash-derived color from symbol+address (last resort)
 *
 * Returns { rgb, hex, gradient, source, isReady }.
 *   `rgb`      - "r, g, b" string for use in `rgba(${rgb}, .5)`
 *   `hex`      - "#RRGGBB"
 *   `gradient` - 3-stop CSS gradient
 *   `source`   - 'curated' | 'cache' | 'server' | 'canvas' | 'hash'
 *   `isReady`  - true once a non-fallback color is resolved
 */
import { useState, useEffect, useMemo } from 'react'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import {
  fetchTokenColorFromServer,
  extractColorFromImage,
  getCachedExtractedColor,
  generateColorFromString,
  hexToRgbString,
  buildGradientFromHex,
} from '@/utils/dynamic-token-color'

export default function useTokenBrandColor(symbol, logoUrl, address) {
  const sym = (symbol || '').toUpperCase()
  const curated = TOKEN_ROW_COLORS[sym] || null

  // Synchronous best-effort initial value (curated > cached extraction > silver).
  // For unknown tokens we default to warm silver (#D4D4D8) — same neutral the
  // trading app uses. The async useEffect below upgrades to the extracted hue.
  // We deliberately AVOID hash-derived colors as the visible default because
  // they produce arbitrary hues (a "PALM" token shouldn't read as bright green).
  const SILVER_RGB = '212, 212, 216'
  const initial = useMemo(() => {
    if (curated) {
      return { rgb: curated.bg, gradient: curated.gradient, source: 'curated' }
    }
    const cachedHex = getCachedExtractedColor(logoUrl)
    if (cachedHex) {
      const rgb = hexToRgbString(cachedHex)
      if (rgb) return { rgb, gradient: buildGradientFromHex(cachedHex), source: 'cache' }
    }
    return { rgb: SILVER_RGB, gradient: buildGradientFromHex('#d4d4d8'), source: 'silver' }
  }, [sym, address, logoUrl, curated])

  const [resolved, setResolved] = useState(initial)

  // Reset to initial whenever the inputs change so we don't show the previous
  // token's color while the new logo is being extracted.
  useEffect(() => {
    setResolved(initial)
  }, [initial])

  // If no curated color, try server KV → canvas extraction in the background.
  useEffect(() => {
    if (curated) return
    if (!logoUrl) return
    let cancelled = false

    const apply = (hex, source) => {
      if (cancelled || !hex) return
      const rgb = hexToRgbString(hex)
      if (!rgb) return
      // Reject low-saturation extractions: grayscale/black/white logos produce
      // muddy greys that read worse than the silver default. Threshold ≈ 12%
      // saturation lets through muted brand colors but rejects pure greys.
      const [r, g, b] = rgb.split(',').map(s => parseInt(s.trim(), 10))
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max
      if (sat < 0.12) return
      setResolved({ rgb, gradient: buildGradientFromHex(hex), source })
    }

    ;(async () => {
      const serverHex = await fetchTokenColorFromServer(logoUrl)
      if (cancelled) return
      if (serverHex) {
        apply(serverHex, 'server')
        return
      }
      const canvasHex = await extractColorFromImage(logoUrl)
      if (cancelled) return
      if (canvasHex) apply(canvasHex, 'canvas')
    })()

    return () => { cancelled = true }
  }, [curated, logoUrl, sym])

  return useMemo(() => {
    const rgb = resolved.rgb
    const parts = rgb.split(',').map(s => parseInt(s.trim(), 10))
    const hex = parts.length === 3 && !parts.some(Number.isNaN)
      ? `#${parts.map(v => v.toString(16).padStart(2, '0')).join('')}`
      : null
    return {
      rgb,
      hex,
      gradient: resolved.gradient,
      source: resolved.source,
      isReady: resolved.source !== 'hash',
    }
  }, [resolved])
}
