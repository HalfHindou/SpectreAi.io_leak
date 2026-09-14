/**
 * legacy-layouts — deterministic, sim-free position solvers for the LEGACY
 * 2D graph's static layout views (Hierarchy / Grid).
 *
 * Given the filtered nodes + canvas dimensions + a layout key, each solver
 * returns `{ positions, groups }`:
 *   positions — { [nodeId]: {x, y} } in graph space (pre-transform; the canvas
 *               applies pan/zoom exactly like it does for the force layout).
 *   groups    — [{ key, label, color, x, y, w, h, count }] compartment
 *               rectangles the canvas draws beneath the nodes (label header +
 *               a faint rounded boundary). Empty for the 'web' layout.
 *
 * The math is pure and stable: same inputs → same output every call, so the
 * force sim can be starved (EMPTY nodes/links) while these drive the canvas.
 *
 * Both static layouts share one shape: the hub (main token) sits large,
 * top-center; every voice below is packed into labelled compartments. Only the
 * GROUPING differs — Hierarchy groups by reach tier, Grid groups by voice type.
 */
import {
  getNodeRadius,
  AUTHENTICITY_COLORS,
  AUTHOR_CLASS_COLORS,
  NEUTRAL_COLOR,
} from '../data/zigchainGraph'

// Reach-tier groups (Hierarchy). Order = top→bottom reading order.
const TIER_GROUPS = [
  { key: 'S', label: 'S · 500K+', color: AUTHENTICITY_COLORS.organic },
  { key: 'A', label: 'A · 100K+', color: '#5AA6FF' },
  { key: 'B', label: 'B · 30K+', color: AUTHENTICITY_COLORS.mixed },
  { key: 'C', label: 'C · Rising', color: NEUTRAL_COLOR },
]

// Voice-type groups (Grid). Keys match the `authorClass` swatch taxonomy; the
// Exchange bucket catches `type === 'exchange'` nodes regardless of class.
const VOICE_GROUPS = [
  { key: 'official', label: 'Official', color: AUTHOR_CLASS_COLORS.official },
  { key: 'commentator', label: 'Commentator', color: AUTHOR_CLASS_COLORS.commentator },
  { key: 'promoter', label: 'Promoter', color: AUTHOR_CLASS_COLORS.promoter },
  { key: 'media', label: 'Media', color: AUTHOR_CLASS_COLORS.media },
  { key: 'exchange', label: 'Exchange', color: NEUTRAL_COLOR },
  { key: 'other', label: 'Other Voices', color: NEUTRAL_COLOR },
]

// Layout geometry constants (graph-space px, at radiusScale 1 they're overridden
// by the per-node radius; these only frame the compartment grid).
const HEADER_H = 26           // space above a compartment for its label
const CELL_PAD = 14           // gap between cells inside a compartment
const COMPARTMENT_GAP_X = 40  // horizontal gap between compartments
const COMPARTMENT_GAP_Y = 56  // vertical gap between compartment rows
const COMPARTMENT_PAD = 20    // inner padding of a compartment box
const HUB_GAP = 90            // vertical gap between hub and the first row

/**
 * Bucket a KOL node into a group key for the given layout.
 */
function groupKeyFor(node, layout) {
  if (layout === 'grid') {
    if (node.type === 'exchange') return 'exchange'
    const cls = (node.authorClass || '').toLowerCase()
    if (cls === 'official' || cls === 'alert') return 'official'
    if (cls === 'commentator') return 'commentator'
    if (cls === 'promoter') return 'promoter'
    if (cls === 'media') return 'media'
    return 'other'
  }
  // hierarchy → reach tier
  return node.tier || 'C'
}

/**
 * Engagement sort key — mention activity first (what carries a project), then
 * raw followers. Descending, so the loudest voice sits top-left of its cell.
 */
function engagementScore(node) {
  return (node.mentionCount || 0) * 1000 + (node.followers || 0)
}

/**
 * Solve a static layout.
 *
 * @param {Array}  nodes        filtered nodes (includes the hub)
 * @param {Set}    hubNodeIds   the hub id set (the main token)
 * @param {Object} dimensions   { width, height } of the canvas viewport
 * @param {string} layout       'hierarchy' | 'grid'
 * @param {number} radiusScale  node-radius scale from the page
 * @returns {{ positions: Object, groups: Array }}
 */
export function solveLegacyLayout(nodes, hubNodeIds, dimensions, layout, radiusScale = 1) {
  const positions = {}
  const groups = []
  const width = dimensions?.width || 1200
  const height = dimensions?.height || 800

  const hub = nodes.find((n) => hubNodeIds.has(n.id))
  const voices = nodes.filter((n) => !hubNodeIds.has(n.id))

  // Center the whole composition horizontally in graph space. We lay everything
  // out in a virtual canvas anchored at x=0 then shift so its center sits at
  // width/2 — the canvas's default transform is identity, so graph-space center
  // = viewport center.
  const cx = width / 2

  // ── Hub: large, top-center. ─────────────────────────────────────────────
  const hubRadius = hub ? getNodeRadius(hub, radiusScale) : 60
  const hubY = 60 + hubRadius
  if (hub) positions[hub.id] = { x: cx, y: hubY }

  // ── Bucket voices into ordered, non-empty groups. ───────────────────────
  const groupDefs = layout === 'grid' ? VOICE_GROUPS : TIER_GROUPS
  const buckets = new Map()
  for (const def of groupDefs) buckets.set(def.key, [])
  for (const v of voices) {
    const key = groupKeyFor(v, layout)
    if (!buckets.has(key)) buckets.set(key, []) // safety for unexpected keys
    buckets.get(key).push(v)
  }

  const activeGroups = groupDefs
    .map((def) => ({ ...def, members: (buckets.get(def.key) || []) }))
    .filter((g) => g.members.length > 0)

  if (!activeGroups.length) {
    return { positions, groups }
  }

  // Cell size = the largest voice radius (so no node clips its cell) + padding.
  // A single shared cell keeps every compartment on one tidy grid.
  let maxVoiceR = 0
  for (const v of voices) maxVoiceR = Math.max(maxVoiceR, getNodeRadius(v, radiusScale))
  if (maxVoiceR === 0) maxVoiceR = 22 * radiusScale
  const cell = maxVoiceR * 2 + CELL_PAD

  // Sort each group's members by engagement desc, so the compact grid reads
  // loudest-first left→right, top→bottom.
  for (const g of activeGroups) {
    g.members.sort((a, b) => engagementScore(b) - engagementScore(a))
  }

  // ── Per-compartment grid dimensions. ────────────────────────────────────
  // Columns inside a compartment scale with its member count but stay bounded
  // so a huge group wraps to multiple internal rows instead of a mile-wide box.
  function colsFor(count) {
    if (count <= 4) return count
    if (count <= 9) return 3
    if (count <= 16) return 4
    if (count <= 30) return 5
    return 6
  }

  for (const g of activeGroups) {
    const n = g.members.length
    g.cols = colsFor(n)
    g.rows = Math.ceil(n / g.cols)
    g.innerW = g.cols * cell
    g.innerH = g.rows * cell
    g.w = g.innerW + COMPARTMENT_PAD * 2
    g.h = g.innerH + COMPARTMENT_PAD * 2 + HEADER_H
  }

  // ── Pack compartments left→right, wrapping to new rows when the row would
  //    exceed the available width. Each compartment row is as tall as its
  //    tallest compartment. Rows are centered horizontally. ────────────────
  const availW = Math.max(width - 80, 480)
  const rowsOfGroups = []
  let currentRow = []
  let currentW = 0
  for (const g of activeGroups) {
    const addW = (currentRow.length ? COMPARTMENT_GAP_X : 0) + g.w
    if (currentRow.length && currentW + addW > availW) {
      rowsOfGroups.push(currentRow)
      currentRow = []
      currentW = 0
    }
    currentRow.push(g)
    currentW += (currentRow.length > 1 ? COMPARTMENT_GAP_X : 0) + g.w
  }
  if (currentRow.length) rowsOfGroups.push(currentRow)

  // ── Place each compartment + its nodes. ─────────────────────────────────
  let rowY = hubY + hubRadius + HUB_GAP
  for (const row of rowsOfGroups) {
    const rowW = row.reduce((sum, g, i) => sum + g.w + (i ? COMPARTMENT_GAP_X : 0), 0)
    const rowH = row.reduce((max, g) => Math.max(max, g.h), 0)
    let gx = cx - rowW / 2
    for (const g of row) {
      // Compartment box top-left.
      const boxX = gx
      const boxY = rowY
      groups.push({
        key: g.key,
        label: g.label,
        color: g.color,
        x: boxX,
        y: boxY,
        w: g.w,
        h: g.h,
        count: g.members.length,
      })

      // Node grid inside the box (below the header).
      const gridX0 = boxX + COMPARTMENT_PAD + cell / 2
      const gridY0 = boxY + HEADER_H + COMPARTMENT_PAD + cell / 2
      g.members.forEach((node, i) => {
        const col = i % g.cols
        const rr = Math.floor(i / g.cols)
        positions[node.id] = {
          x: gridX0 + col * cell,
          y: gridY0 + rr * cell,
        }
      })

      gx += g.w + COMPARTMENT_GAP_X
    }
    rowY += rowH + COMPARTMENT_GAP_Y
  }

  return { positions, groups }
}

export { TIER_GROUPS, VOICE_GROUPS }
