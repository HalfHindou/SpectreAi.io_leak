/**
 * Generate an inline SVG data URI for token logo placeholders.
 * Professional glass circle with centered letter - Wall Street finance style.
 */

/**
 * @param {string} symbol  Token symbol (e.g. "SPECTRE")
 * @param {number} [size=40] Width/height of the SVG
 * @returns {string} data:image/svg+xml URI usable as an <img> src
 */
export function tokenPlaceholder(symbol, size = 40) {
  const letter = (symbol || '?').charAt(0).toUpperCase()
  const fontSize = Math.round(size * 0.4)
  const r = size / 2
  const textY = r + fontSize * 0.35 // manual vertical centering (more reliable than dominant-baseline)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${r}" cy="${r}" r="${r - 1}" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>` +
    `<text x="${r}" y="${textY}" text-anchor="middle" ` +
    `fill="rgba(245,245,247,0.35)" font-family="-apple-system,BlinkMacSystemFont,SF Pro Display,Segoe UI,system-ui,sans-serif" font-weight="500" font-size="${fontSize}" letter-spacing="0.5">${letter}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export default tokenPlaceholder
