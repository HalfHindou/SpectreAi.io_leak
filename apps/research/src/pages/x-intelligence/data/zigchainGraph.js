/**
 * X Intelligence — shared graph constants.
 *
 * Tier / type taxonomy and node-radius math used by every visual layer
 * (canvas, sidebars, legend, filter panel). All actual graph data comes
 * from the X Dash API via useProjectGraph / useCrawlGraph.
 */

export const TIER_COLORS = {
  S: '#EF4444', // red
  A: '#F59E0B', // amber
  B: '#3B82F6', // blue
  C: '#6B7280', // gray
}

export const TIER_ORDER = ['S', 'A', 'B', 'C']

// ── Authenticity coloring ──────────────────────────────────────────────────
// The graph no longer colours by follower tier (tier still drives SIZE). Colour
// now encodes "organic vs manufactured attention":
//   • Project hubs → coloured by `authenticity` (0-100, clean-signal share):
//       organic green → amber → noisy red.
//   • KOL nodes    → coloured by `authorClass` (official / commentator /
//       promoter / media / unknown), so a cluster of paid promoters around a
//       project is instantly visible as a red flag.
// Missing signal → neutral grey (handled gracefully).

export const NEUTRAL_COLOR = '#8E8FA8' // unknown class / no authenticity verdict

// Diverging organic→noisy scale used for project hubs + the legend gradient.
export const AUTHENTICITY_COLORS = {
  organic: '#4FD18B', // >= 60  — grassroots, clean signal
  mixed: '#F5C24D',   // 35-60  — some promo/contamination
  noisy: '#FF6E8E',   // < 35   — bot/promo-heavy
}

// Author-class swatches. `promoter` ALSO gets a distinct ring in the canvas.
export const AUTHOR_CLASS_COLORS = {
  official: '#5AA6FF',    // project / verified official accounts — blue
  commentator: '#4FD18B', // credible independent voices — mint/green
  promoter: '#FF9046',    // paid / promo amplifiers — amber/orange (+ ring)
  media: '#9B7CE6',       // press / media outlets — violet
  alert: '#5AA6FF',       // automated alert bots — treat like official (info)
}

export const AUTHOR_CLASS_LABELS = {
  official: 'Official',
  commentator: 'Commentator',
  promoter: 'Promoter',
  media: 'Media',
}

/**
 * Map a project hub's authenticity (0-100) to a diverging organic→noisy hex.
 * null / non-finite → neutral grey (no verdict yet).
 */
export function authenticityColor(authenticity) {
  if (!Number.isFinite(authenticity)) return NEUTRAL_COLOR
  if (authenticity >= 60) return AUTHENTICITY_COLORS.organic
  if (authenticity >= 35) return AUTHENTICITY_COLORS.mixed
  return AUTHENTICITY_COLORS.noisy
}

/**
 * The single source of truth for a node's COLOUR (never its size).
 *   - Project hubs  → authenticity-scaled (organic green → noisy red).
 *   - KOL / authors → author-class swatch (official/commentator/promoter/media).
 * Falls back to neutral grey when the signal is missing, so the graph never
 * shows a dark hole. Tier is intentionally ignored here — it drives radius in
 * `getNodeRadius`, not colour.
 */
export function nodeColor(node) {
  if (!node || typeof node !== 'object') return NEUTRAL_COLOR
  if (node.isHub || node.isProjectHub || node.type === 'project') {
    return authenticityColor(node.authenticity)
  }
  const cls = (node.authorClass || '').toLowerCase()
  return AUTHOR_CLASS_COLORS[cls] || NEUTRAL_COLOR
}

/** True when a KOL node should get the distinct promoter ring treatment. */
export function isPromoterNode(node) {
  return !!node && !node.isHub && (node.authorClass || '').toLowerCase() === 'promoter'
}

export const TYPE_LABELS = {
  kol: 'KOL',
  exchange: 'Exchange',
  project: 'Project',
}

/**
 * Compute the visual radius for a node.
 *
 * For KOLs the size signal is a 60/40 blend of mention activity and follower
 * count — what people actually care about on a social influence graph (a 50K-
 * follower account mentioning the project 80 times deserves more pixels than
 * a 500K-follower account mentioning it once).
 *
 * For project hubs the radius is fixed-large regardless of follower count, so
 * the centerpiece reads as the centerpiece even when the project's own X
 * account has zero followers (or no account at all).
 *
 * Range (scale=1): 22px floor → 78px non-hub max → 110px hub.
 * `scale` shrinks all returned radii proportionally so the graph fits small
 * viewports without changing the relative sizing of nodes.
 */
export function getNodeRadius(node, scale = 1) {
  if (!node || typeof node !== 'object') return 22 * scale

  const followers = node.followers || 0
  const mentions = node.mentionCount || 0
  const isHub = !!node.isHub
  const bridgeCount = node.bridgeCount || 0

  const minR = 22
  const maxR = 78

  if (isHub) {
    const followerNorm = Math.min(1, Math.sqrt(followers) / Math.sqrt(2_000_000))
    const mentionNorm = Math.min(1, Math.sqrt(mentions) / Math.sqrt(500))
    const boost = mentions > 0
      ? 0.6 * mentionNorm + 0.4 * followerNorm
      : followerNorm
    return (78 + 32 * boost) * scale
  }

  const followerNorm = Math.min(1, Math.sqrt(followers) / Math.sqrt(1_000_000))
  const mentionNorm = Math.min(1, Math.sqrt(mentions) / Math.sqrt(100))
  const signal = mentions > 0
    ? 0.6 * mentionNorm + 0.4 * followerNorm
    : followerNorm
  let radius = minR + (maxR - minR) * signal

  if (bridgeCount >= 2) {
    radius = Math.min(maxR + 18, radius + 6 + Math.min(12, bridgeCount * 2.5))
  }
  return radius * scale
}
