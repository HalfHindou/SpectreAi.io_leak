/**
 * Ventures constants — STAGE_CONFIG, CATEGORY_COLORS, helpers.
 *
 * 2026-05-27: the 10-project hardcoded VENTURES_PROJECTS array was deleted.
 * Universe now comes 100% from /v1/institutional/scores via
 * synthesizeProjectFromApi in ventures-page.jsx, plus the curated
 * ONCHAIN_CONTENDERS_SEED for small-cap AI agents not yet indexed by the
 * institutional backend.
 *
 * What lives here: pure presentation/config (stage labels, category colors,
 * score-to-label helpers). No fake project data.
 */

export const STAGE_CONFIG = {
  'Pre-Seed': { color: '156, 163, 175', label: 'Pre-Seed' },
  'Seed': { color: '52, 211, 153', label: 'Seed' },
  'Series A': { color: '96, 165, 250', label: 'Series A' },
  'Series B': { color: '167, 139, 250', label: 'Series B' },
  'Series C': { color: '251, 191, 36', label: 'Series C' },
  'Growth': { color: '251, 146, 60', label: 'Growth' },
  'Blue Chip': { color: '56, 189, 248', label: 'Blue Chip' },
}

export const CATEGORY_COLORS = {
  'DeFi': '96, 165, 250',
  'Infrastructure': '167, 139, 250',
  'AI': '192, 132, 252',
  'RWA': '251, 191, 36',
  'L1/L2': '56, 189, 248',
  'DePIN': '52, 211, 153',
  'Restaking': '251, 146, 60',
  'Oracle': '244, 114, 182',
  'DEX': '129, 140, 248',
  'Yield': '45, 212, 191',
  'Identity': '147, 197, 253',
  'MEV': '220, 170, 100',
}

function localProjectLogo(label = '?') {
  const text = String(label || '?').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || '?'
  const hue = [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="28" fill="hsl(${hue},38%,22%)"/><path d="M18 64c14-28 46-28 60 0" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="8" stroke-linecap="round"/><text x="48" y="55" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="800" fill="white">${text}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function getStageFromMarketCap(mcap) {
  if (!mcap || mcap < 10e6) return 'Pre-Seed'
  if (mcap < 100e6) return 'Seed'
  if (mcap < 500e6) return 'Series A'
  if (mcap < 2e9) return 'Series B'
  if (mcap < 5e9) return 'Series C'
  if (mcap < 20e9) return 'Growth'
  return 'Blue Chip'
}

export function getScoreColor(score) {
  if (score >= 75) return '#10B981'
  if (score >= 60) return '#06B6D4'
  if (score >= 40) return '#F59E0B'
  return '#EF4444'
}

export function getScoreLabel(score) {
  if (score >= 90) return 'Exceptional'
  if (score >= 75) return 'Strong'
  if (score >= 60) return 'Moderate'
  if (score >= 40) return 'Cautious'
  return 'High Risk'
}

// localProjectLogo is exported so synthesizeProjectFromApi can build a
// fallback avatar when an asset has no upstream logo URL.
export { localProjectLogo }
