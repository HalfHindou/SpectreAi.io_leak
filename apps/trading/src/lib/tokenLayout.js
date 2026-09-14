// Token-page layout engine - "Zone Stacks".
//
// 5 sections live as direct grid children of .main-layout in FIXED DOM order
// (watch, banner, chart, txns, trade - React never reorders them, so the
// TradingView iframe inside the chart is NEVER re-parented; re-parenting
// reloads the whole widget, see TradingViewAdvanced.jsx persistent-widget
// history). All visual arrangement is expressed through LINE-BASED grid
// placement compiled here: per-section gridColumn/gridRow inline styles +
// gridTemplateRows + rail-width CSS vars on the container.
//
// Zones: left rail | center | right rail | bottom band. The center is an
// ordered stack; rails hold AT MOST ONE section each (v1 - a tall rail
// section spanning multiple content-sized rows makes CSS grid distribute its
// height INTO those rows, inflating gaps between center sections; capping
// rails at one section + sinking span contributions into a final
// minmax(0,1fr) row kills that class of mislayout). Row template:
// repeat(R-1, minmax(0,auto)) minmax(0,1fr) + one auto row per bottom
// section, where R = number of visible center sections. Rails span all main
// rows; bottom sections span the full width below them.
//
// Pure module - no React, no DOM. Unit-testable.

export const SECTION_IDS = ['watch', 'banner', 'chart', 'txns', 'trade']

// Wide sections are unusable in a 280-560px rail (chart/tables) - center or
// bottom only. The sanitizer enforces this on every write.
export const WIDE_SECTIONS = new Set(['banner', 'txns', 'chart'])

// Every section can be hidden (display:none keeps them mounted - state and
// the chart iframe survive). The sanitizer guarantees at least one section
// stays visible so the page can never go fully blank.
export const HIDEABLE = new Set(SECTION_IDS)

// Sub-parts INSIDE the two rail panels - reorder/hide granularity without
// touching the grid (they reorder via flex `order` inside their panel, so
// nothing re-parents). watch: feed = X/Watchlist tabs card, screener =
// Trending/Top Coins explorer. trade: overview = identity + vitals, swap =
// Buy/Sell, volume = activity board, security = pool + deployer security.
export const PANEL_PARTS = {
  watch: ['feed', 'screener'],
  trade: ['overview', 'swap', 'volume', 'security'],
}

export const ZONE_IDS = ['left', 'center', 'right', 'bottom']

export const RAIL_MIN = 280
export const RAIL_MAX = 560
export const RAIL_DEFAULT = 380

export const DEFAULT_TOKEN_LAYOUT = Object.freeze({
  v: 1,
  zones: Object.freeze({
    left: Object.freeze(['watch']),
    center: Object.freeze(['banner', 'chart', 'txns']),
    right: Object.freeze(['trade']),
    bottom: Object.freeze([]),
  }),
  sizes: Object.freeze({ leftW: RAIL_DEFAULT, rightW: RAIL_DEFAULT }),
  hidden: Object.freeze([]),
  parts: Object.freeze({
    watch: Object.freeze({ order: Object.freeze(['feed', 'screener']), hidden: Object.freeze([]) }),
    trade: Object.freeze({ order: Object.freeze(['overview', 'swap', 'volume', 'security']), hidden: Object.freeze([]) }),
  }),
})

export const LAYOUT_PRESETS = {
  default: DEFAULT_TOKEN_LAYOUT,
  // GMGN's side-swap: trade on the left, watch on the right.
  flipped: {
    v: 1,
    zones: { left: ['trade'], center: ['banner', 'chart', 'txns'], right: ['watch'], bottom: [] },
    sizes: { leftW: RAIL_DEFAULT, rightW: RAIL_DEFAULT },
    hidden: [],
  },
  // No left rail (watch hidden), wide trade sidebar.
  terminal: {
    v: 1,
    zones: { left: ['watch'], center: ['banner', 'chart', 'txns'], right: ['trade'], bottom: [] },
    sizes: { leftW: RAIL_DEFAULT, rightW: 464 },
    hidden: ['watch'],
  },
  // Pure focus: just the chart with transactions full-width below - watch,
  // banner AND the trade panel hidden. Hidden sections KEEP a zone slot (they
  // stay mounted display:none) - a section absent from every zone would be
  // re-homed by the sanitizer.
  focus: {
    v: 1,
    zones: { left: ['watch'], center: ['banner', 'chart'], right: ['trade'], bottom: ['txns'] },
    sizes: { leftW: RAIL_DEFAULT, rightW: RAIL_DEFAULT },
    hidden: ['watch', 'banner', 'trade'],
  },
}

const clampRail = (w) => {
  const n = Math.round(Number(w))
  if (!Number.isFinite(n)) return RAIL_DEFAULT
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, n))
}

const deepCloneLayout = (l) => ({
  v: 1,
  zones: {
    left: [...l.zones.left],
    center: [...l.zones.center],
    right: [...l.zones.right],
    bottom: [...l.zones.bottom],
  },
  sizes: { ...l.sizes },
  hidden: [...l.hidden],
  parts: sanitizeParts(l.parts),
})

// Per-panel sub-part config: order must contain each known part exactly
// once; hidden must be a subset. Anything else re-derives from canonical.
function sanitizeParts(raw) {
  const out = {}
  for (const [panel, canonical] of Object.entries(PANEL_PARTS)) {
    const src = raw?.[panel]
    const order = []
    const seen = new Set()
    for (const id of (Array.isArray(src?.order) ? src.order : [])) {
      if (!canonical.includes(id) || seen.has(id)) continue
      order.push(id)
      seen.add(id)
    }
    for (const id of canonical) if (!seen.has(id)) order.push(id)
    const hidden = Array.isArray(src?.hidden)
      ? [...new Set(src.hidden.filter((id) => canonical.includes(id)))]
      : []
    // A panel with every part hidden is a blank card - keep the first part.
    if (hidden.length >= canonical.length) hidden.length = 0
    out[panel] = { order, hidden }
  }
  return out
}

/**
 * Sanitize any persisted/hand-edited blob into a valid layout. Never throws;
 * anything unusable falls back to (a clone of) the default. Guarantees:
 * every section placed exactly once, wide sections out of rails, center
 * non-empty, sizes clamped, hidden subset of HIDEABLE.
 */
export function sanitizeTokenLayout(raw) {
  if (!raw || typeof raw !== 'object' || !raw.zones || typeof raw.zones !== 'object') {
    return deepCloneLayout(DEFAULT_TOKEN_LAYOUT)
  }
  const zones = { left: [], center: [], right: [], bottom: [] }
  const seen = new Set()
  for (const zone of ZONE_IDS) {
    const src = Array.isArray(raw.zones[zone]) ? raw.zones[zone] : []
    for (const id of src) {
      if (!SECTION_IDS.includes(id) || seen.has(id)) continue // unknown or duplicate
      if (WIDE_SECTIONS.has(id) && (zone === 'left' || zone === 'right')) continue // re-homed below
      if ((zone === 'left' || zone === 'right') && zones[zone].length >= 1) continue // rails hold ONE section (v1)
      zones[zone].push(id)
      seen.add(id)
    }
  }
  // Re-home anything missing (dropped above, or absent from the blob) to its
  // default zone, preserving the default's relative order. A rail default
  // that is already occupied falls through to the bottom band.
  for (const zone of ZONE_IDS) {
    for (const id of DEFAULT_TOKEN_LAYOUT.zones[zone]) {
      if (seen.has(id)) continue
      const railFull = (zone === 'left' || zone === 'right') && zones[zone].length >= 1
      zones[railFull ? 'bottom' : zone].push(id)
      seen.add(id)
    }
  }
  // Center must never be empty - it anchors the row structure. Pull the chart
  // back if a hand-edited blob emptied it.
  if (zones.center.length === 0) {
    zones.bottom = zones.bottom.filter((id) => id !== 'chart')
    zones.center.push('chart')
  }
  const hidden = Array.isArray(raw.hidden)
    ? [...new Set(raw.hidden.filter((id) => HIDEABLE.has(id)))]
    : []
  // Never allow a fully blank page - if everything is hidden, the chart wins.
  if (hidden.length >= SECTION_IDS.length) {
    hidden.splice(hidden.indexOf('chart'), 1)
  }
  return {
    v: 1,
    zones,
    sizes: {
      leftW: clampRail(raw.sizes?.leftW ?? RAIL_DEFAULT),
      rightW: clampRail(raw.sizes?.rightW ?? RAIL_DEFAULT),
    },
    hidden,
    parts: sanitizeParts(raw.parts),
  }
}

/** Move a rail-panel sub-part up/down within its panel (dir -1 | +1). */
export function movePanelPart(layout, panel, partId, dir) {
  const l = sanitizeTokenLayout(layout)
  const cfg = l.parts[panel]
  if (!cfg) return l
  const i = cfg.order.indexOf(partId)
  const j = i + (dir < 0 ? -1 : 1)
  if (i < 0 || j < 0 || j >= cfg.order.length) return l
  const order = [...cfg.order]
  ;[order[i], order[j]] = [order[j], order[i]]
  return { ...l, parts: { ...l.parts, [panel]: { ...cfg, order } } }
}

/** Move a rail-panel sub-part to an absolute index within its panel (for
 *  drag-to-reorder: drop between siblings). Index is the insertion slot in the
 *  order list AFTER the part is removed - clamped. */
export function reorderPanelPart(layout, panel, partId, toIndex) {
  const l = sanitizeTokenLayout(layout)
  const cfg = l.parts[panel]
  if (!cfg || !cfg.order.includes(partId)) return l
  const rest = cfg.order.filter((id) => id !== partId)
  const at = Math.max(0, Math.min(rest.length, Math.floor(toIndex)))
  rest.splice(at, 0, partId)
  return { ...l, parts: { ...l.parts, [panel]: { ...cfg, order: rest } } }
}

/** Toggle a rail-panel sub-part's visibility. */
export function togglePanelPart(layout, panel, partId) {
  const l = sanitizeTokenLayout(layout)
  const cfg = l.parts[panel]
  if (!cfg || !PANEL_PARTS[panel]?.includes(partId)) return l
  const hidden = cfg.hidden.includes(partId)
    ? cfg.hidden.filter((id) => id !== partId)
    : [...cfg.hidden, partId]
  return sanitizeTokenLayout({ ...l, parts: { ...l.parts, [panel]: { ...cfg, hidden } } })
}

/**
 * Swap the zone+position of two sections (drag A onto B). Illegal when a wide
 * section (banner/chart/txns) would land in a rail - returns the layout
 * unchanged so the drop is a no-op. Same-zone swaps just trade positions.
 */
export function swapSection(layout, a, b) {
  const l = sanitizeTokenLayout(layout)
  if (a === b || !SECTION_IDS.includes(a) || !SECTION_IDS.includes(b)) return l
  const zoneOf = (id) => ZONE_IDS.find((z) => l.zones[z].includes(id))
  const za = zoneOf(a)
  const zb = zoneOf(b)
  if (!za || !zb) return l
  const isRail = (z) => z === 'left' || z === 'right'
  if (WIDE_SECTIONS.has(a) && isRail(zb)) return l
  if (WIDE_SECTIONS.has(b) && isRail(za)) return l
  const next = deepCloneLayout(l)
  const ia = next.zones[za].indexOf(a) // read BOTH indices before any write
  const ib = next.zones[zb].indexOf(b)
  next.zones[za][ia] = b
  next.zones[zb][ib] = a
  return sanitizeTokenLayout(next)
}

/** Swap the left and right zone stacks (rail widths travel with their zone). */
export function swapSides(layout) {
  const l = sanitizeTokenLayout(layout)
  return sanitizeTokenLayout({
    ...l,
    zones: { ...l.zones, left: l.zones.right, right: l.zones.left },
    sizes: { leftW: l.sizes.rightW, rightW: l.sizes.leftW },
  })
}

/**
 * Move a section to `zone` at `index` (clamped). Invalid moves (wide section
 * into a rail, emptying center of its last section when nothing replaces it)
 * return the sanitized original unchanged.
 */
export function moveSection(layout, sectionId, zone, index = Infinity) {
  const l = sanitizeTokenLayout(layout)
  if (!SECTION_IDS.includes(sectionId) || !ZONE_IDS.includes(zone)) return l
  if (WIDE_SECTIONS.has(sectionId) && (zone === 'left' || zone === 'right')) return l
  const from = ZONE_IDS.find((z) => l.zones[z].includes(sectionId))
  if (!from) return l
  if (from === 'center' && zone !== 'center' && l.zones.center.length === 1) return l
  // Rails hold one section (v1). Moving onto an occupied rail SWAPS: the
  // incumbent goes to where the incoming section came from (rail<->rail flip,
  // or rail<->bottom/center trade) - the intuitive drag outcome.
  const next = deepCloneLayout(l)
  if ((zone === 'left' || zone === 'right') && next.zones[zone].length >= 1 && next.zones[zone][0] !== sectionId) {
    // Incumbent is always rail-legal (watch/trade), so it can take the
    // vacated spot regardless of where the incoming section came from.
    const incumbent = next.zones[zone][0]
    next.zones[zone] = []
    next.zones[from] = next.zones[from].filter((id) => id !== sectionId)
    next.zones[from].push(incumbent)
    next.zones[zone].push(sectionId)
    return sanitizeTokenLayout(next)
  }
  next.zones[from] = next.zones[from].filter((id) => id !== sectionId)
  const target = next.zones[zone]
  const at = Math.max(0, Math.min(target.length, Math.floor(index)))
  target.splice(at, 0, sectionId)
  return sanitizeTokenLayout(next)
}

/** Toggle a section's hidden state (no-op for non-hideable sections). */
export function toggleSectionHidden(layout, sectionId) {
  const l = sanitizeTokenLayout(layout)
  if (!HIDEABLE.has(sectionId)) return l
  const hidden = l.hidden.includes(sectionId)
    ? l.hidden.filter((id) => id !== sectionId)
    : [...l.hidden, sectionId]
  return { ...l, hidden }
}


/**
 * Compile a layout into concrete styles.
 *
 * opts:
 *   leftCollapsed / rightCollapsed - rail collapse toggles (width -> 0)
 *   tier - 'wide' (full custom) | 'narrow' (<=1200px: default preset, watch
 *          hidden, 2 effective columns) | 'single' (<=900px: everything
 *          stacked full-width)
 *   railCap - viewport-driven max rail width in px (App owns the breakpoint
 *          -> cap mapping); defaults to RAIL_MAX
 *
 * Returns { containerStyle, sectionStyles, meta }:
 *   containerStyle - { gridTemplateColumns, gridTemplateRows } (concrete px)
 *   sectionStyles  - per section: { gridColumn, gridRow } or { display: 'none' }
 *   meta           - { leftEmpty, rightEmpty, hasBottom, leftSections,
 *                      rightSections }
 */
export function compileTokenLayout(layout, opts = {}) {
  const { leftCollapsed = false, rightCollapsed = false, tier = 'wide' } = opts
  let l = sanitizeTokenLayout(layout)

  // Below the custom-layout viewport floor, force the default arrangement -
  // reflowing an arbitrary custom layout into 2 columns has too many
  // degenerate cases. The custom layout stays persisted and returns >1200px.
  if (tier !== 'wide') l = deepCloneLayout(DEFAULT_TOKEN_LAYOUT)

  const hidden = new Set(l.hidden)
  if (tier !== 'wide') hidden.add('watch') // today's <=1200 behavior

  const sectionStyles = {}
  for (const id of SECTION_IDS) {
    if (hidden.has(id)) sectionStyles[id] = { display: 'none' }
  }

  if (tier === 'single') {
    // <=900px: single column, GMGN mobile-ish order.
    const order = ['banner', 'chart', 'txns', 'trade']
    let row = 1
    for (const id of order) {
      if (hidden.has(id)) continue
      sectionStyles[id] = { gridColumn: '1 / -1', gridRow: `${row} / ${row + 1}` }
      row += 1
    }
    return {
      containerStyle: {
        gridTemplateColumns: '0px minmax(0, 1fr) 0px',
        gridTemplateRows: `repeat(${Math.max(1, row - 1)}, auto)`,
      },
      sectionStyles,
      meta: { leftEmpty: true, rightEmpty: true, hasBottom: false, leftSections: [], rightSections: [], parts: l.parts },
    }
  }

  const vis = (zone) => l.zones[zone].filter((id) => !hidden.has(id))
  const left = vis('left')
  const center = vis('center')
  const right = vis('right')
  const bottom = vis('bottom')

  // Main rows are driven by the CENTER stack. All but the last are
  // content-sized; the LAST is minmax(0,1fr) so the tall rail spans sink
  // their height contribution into it (grid distributes span sizing to
  // flexible tracks first) instead of inflating the content rows - without
  // this, banner/chart rows grow phantom gaps whenever a rail is taller
  // than the center content.
  const R = Math.max(1, center.length)

  // The flexible "sink" row absorbs (a) leftover viewport height and (b) the
  // excess height of a rail taller than the center content, so the other
  // center rows keep their natural size instead of growing phantom gaps.
  // ONLY the transactions table is a good sink - it is a scroll area, happy
  // to stretch. The chart is a FIXED-height iframe: sinking into it stretches
  // the chart section and leaves a big gap below the candles (the Focus-mode
  // bug). So:
  //   - txns in center   -> that row is the sink; rails span the center rows.
  //   - txns NOT in center (hidden, or docked to the bottom band, e.g. Focus)
  //     -> every center row is content-sized and the sink is a trailing
  //        spacer row AFTER the bottom band, so nothing stretches and the
  //        sections pack to the top.
  const txnsSinkIdx = center.indexOf('txns')

  center.forEach((id, i) => {
    sectionStyles[id] = { gridColumn: '2', gridRow: `${i + 1} / ${i + 2}` }
  })
  if (left.length) sectionStyles[left[0]] = { gridColumn: '1', gridRow: `1 / ${R + 1}` }
  if (right.length) sectionStyles[right[0]] = { gridColumn: '3', gridRow: `1 / ${R + 1}` }
  bottom.forEach((id, i) => {
    sectionStyles[id] = { gridColumn: '1 / -1', gridRow: `${R + 1 + i} / ${R + 2 + i}` }
  })

  let rowTracks
  if (txnsSinkIdx >= 0) {
    // Center row sink = the txns row; bottom rows are content-sized.
    const centerTracks = center.map((_, i) => (i === txnsSinkIdx ? 'minmax(0, 1fr)' : 'minmax(0, auto)'))
    rowTracks = [...centerTracks, ...bottom.map(() => 'minmax(0, auto)')].join(' ')
  } else {
    // No stretchy center section - pack to top, trailing 1fr spacer fills the
    // viewport (and soaks up any rail overflow) at the very bottom.
    rowTracks = [
      ...center.map(() => 'minmax(0, auto)'),
      ...bottom.map(() => 'minmax(0, auto)'),
      'minmax(0, 1fr)',
    ].join(' ')
  }
  const leftEmpty = left.length === 0
  const rightEmpty = right.length === 0
  // Track widths are compiled to CONCRETE px in the inline template. (An
  // earlier iteration fed them through CSS vars consumed by min(var()) in
  // the stylesheet template - Chromium applied that on load but did NOT
  // reliably recompute the tracks when only the var changed at runtime, so
  // preset switches left the columns frozen. Inline template changes always
  // apply, and the grid-template-columns transition still animates them.)
  const cap = Number.isFinite(opts.railCap) ? opts.railCap : RAIL_MAX
  const leftW = leftEmpty || leftCollapsed ? 0 : Math.min(l.sizes.leftW, cap)
  const rightW = rightEmpty || rightCollapsed ? 0 : Math.min(l.sizes.rightW, cap)
  return {
    containerStyle: {
      gridTemplateColumns: `${leftW}px minmax(0, 1fr) ${rightW}px`,
      gridTemplateRows: rowTracks,
    },
    sectionStyles,
    meta: {
      leftEmpty, rightEmpty, hasBottom: bottom.length > 0,
      leftSections: left, rightSections: right,
      leftW, rightW,
      parts: l.parts,
    },
  }
}
