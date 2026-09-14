/**
 * X BUBBLES × COSMOS — data adapter
 *
 * Turns the crawl graph (projects + KOLs + mention edges, from useCrawlGraph)
 * into the cosmos engine's {sun, bodies, groups} model, plus the co-mention
 * link pairs and the social-aura layer.
 *
 * The two-level hierarchy is the point: PROJECTS are planets orbiting the
 * core (closer = attention rising faster), KOLS are moons orbiting the
 * project they push hardest. Drag a planet and its voices ride along.
 *
 * Three design versions ship (Sunny picks the winner later) — same engine,
 * same data, different semantics on color / clustering / who sits at the core:
 *   signal        — neutral X core; planet color = authenticity (organic green
 *                   → noisy red, the legacy page's superpower); clusters by
 *                   signal quality.
 *   constellation — category colors consistent with /bubbles; clusters by
 *                   catalog category; brighter co-mention lines.
 *   heat          — the hottest project IS the sun; thermal ramp by mention
 *                   velocity (surging orange → cooling blue); clusters by
 *                   attention trajectory.
 */
import {
  WORLD, orbitForChange, hash01, groupColor as categoryColor,
  respacePhases, layoutGalaxy,
} from '@/components/cosmos/cosmos-data'

export const DESIGN_MODES = {
  // key 'constellation' kept (persisted in localStorage) — label avoids the
  // word so the x-dash "Map" (narrative constellation) stays unambiguous
  signal: { label: 'Signal', hint: 'color = how organic the attention is' },
  constellation: { label: 'Category', hint: 'color = project category' },
  heat: { label: 'Heat', hint: 'color = attention velocity · hottest project at the core' },
}
export const DEFAULT_DESIGN = 'signal'

/* KOL moon tints by reach tier (matches the legacy graph's tier semantic) */
const TIER_RGB = {
  S: [250, 204, 21],   // gold — 500k+
  A: [167, 139, 250],  // violet — 100k+
  B: [96, 165, 250],   // blue — 30k+
  C: [148, 163, 184],  // slate
}
const EXCHANGE_RGB = [34, 211, 238] // cyan — exchange accounts

const rgbToHex = ([r, g, b]) => (r << 16) | (g << 8) | b

/* organic green → mixed amber → noisy red, interpolated across 0-100 */
function authenticityRgb(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
  const red = [248, 113, 113], amber = [251, 191, 36], green = [52, 211, 153]
  if (s >= 60) return lerp(amber, green, (s - 60) / 40)
  return lerp(red, amber, s / 60)
}

/* cooling blue → flat slate → rising amber → surging orange */
function velocityRgb(v) {
  const x = Number(v) || 1
  if (x >= 1.6) return [255, 107, 61]
  if (x >= 1.15) return [251, 191, 36]
  if (x >= 0.85) return [139, 155, 180]
  return [96, 165, 250]
}

function authenticityBand(score) {
  const s = Number(score) || 0
  if (s >= 70) return 'Organic'
  if (s >= 45) return 'Mixed Signal'
  return 'Noisy'
}
const BAND_RGB = {
  Organic: [52, 211, 153],
  'Mixed Signal': [251, 191, 36],
  Noisy: [248, 113, 113],
}

function velocityBand(v) {
  const x = Number(v) || 1
  if (x >= 1.6) return 'Surging'
  if (x >= 1.15) return 'Rising'
  if (x >= 0.85) return 'Steady'
  return 'Cooling'
}
const VELO_RGB = {
  Surging: [255, 107, 61],
  Rising: [251, 191, 36],
  Steady: [139, 155, 180],
  Cooling: [96, 165, 250],
}

const fmtCount = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(v)
}

/* mention velocity → orbit: rising attention falls toward the core.
   velocity_ratio 1.0 = flat (neutral ring), 2× = saturated hot zone. */
const velocityChange = (v) => Math.max(-25, Math.min(25, ((Number(v) || 1) - 1) * 100))

const TIER_GROUP = {
  S: { key: '500k+ reach', rgb: TIER_RGB.S },
  A: { key: '100k+ reach', rgb: TIER_RGB.A },
  B: { key: '30k+ reach', rgb: TIER_RGB.B },
  C: { key: 'Rising voices', rgb: TIER_RGB.C },
}

/* Single-project universe: the project IS the sun, every KOL orbits it
   directly — the closest ring is whoever pushes it hardest. Galaxy view
   clusters the swarm by reach tier. This replaces the d3 force sim that
   melted on heavy projects (100+ author nodes simulated at 60fps). */
/* Shared voice filter: type allowlist, follower floor, reach-tier toggles
   ('EX' = exchange accounts). null/0 = no constraint. */
function makeVoiceFilter({ kolTypes, minFollowers = 0, tiers = null }) {
  return (k) => {
    if (kolTypes && !kolTypes.has(k.type)) return false
    if (minFollowers && (Number(k.followers) || 0) < minFollowers) return false
    if (tiers && !tiers.has(k.type === 'exchange' ? 'EX' : (k.tier || 'C'))) return false
    return true
  }
}

function buildProjectSwarm(project, kols, { maxSwarm, kolTypes, minFollowers, tiers }) {
  const sun = {
    id: (project.symbol || project.name || 'X').toUpperCase(),
    token: {
      symbol: (project.symbol || project.name || 'X').toUpperCase(),
      name: project.name,
      logo: project.avatar || null,
      marketCap: 0,
      cgId: project.cgId || null,
    },
    change: velocityChange(project.velocityScore),
    noMarket: true,
    mentions: Number(project.mentionCount) || 0,
    authors: Number(project.intel?.authors24h) || 0,
    velocity: Number(project.velocityScore) || 1,
    srcNode: project,
  }

  const weightOf = (k) => {
    const pr = (k.projects || [])[0]
    return Number(pr?.weightedEngagement) || Number(pr?.mentions)
      || Number(k.weightedEngagement) || Number(k.mentionCount) || 0
  }
  const passes = makeVoiceFilter({ kolTypes, minFollowers, tiers })
  const filtered = (kols || [])
    .filter(passes)
    .sort((a, b) => weightOf(b) - weightOf(a))
  const pool = filtered.slice(0, maxSwarm)

  const maxFollowers = Math.max(1, ...pool.map((k) => Number(k.followers) || 0))
  const fLogMax = Math.log(maxFollowers + 1)
  const groupsMap = new Map()
  const seen = new Set()

  const bodies = pool.map((k, slot) => {
    const handle = (k.handle || '').replace(/^@/, '') || k.name || `kol${slot}`
    let id = handle
    if (seen.has(id)) id = `${handle}·${slot}`
    seen.add(id)
    const fNorm = Math.log((Number(k.followers) || 0) + 1) / fLogMax
    const tg = k.type === 'exchange'
      ? { key: 'Exchanges', rgb: EXCHANGE_RGB }
      : (TIER_GROUP[k.tier] || TIER_GROUP.C)
    const h = hash01('swarm·' + id)
    // engagement rank IS the ring: the loudest voices hug the project
    const orbitRadius = WORLD.minOrbit * 0.62 + Math.sqrt(slot) * 7.4 + h * 2.5

    let g = groupsMap.get(tg.key)
    if (!g) { g = { key: tg.key, color: tg.rgb, count: 0, members: [] }; groupsMap.set(tg.key, g) }
    g.count++
    g.members.push(slot)

    return {
      id,
      token: { symbol: id, name: k.name || handle, logo: k.avatar || null, marketCap: 0 },
      change: 0,
      noMarket: true,
      glowColor: rgbToHex(tg.rgb),
      subLabel: `${fmtCount(k.followers)} followers`,
      group: tg.key,
      groupColor: tg.rgb,
      radius: 1.6 + Math.pow(fNorm, 0.9) * 2.6,
      orbitRadius,
      phase: slot * 2.399963 + h * 0.5,
      incline: (hash01('si·' + id) - 0.5) * 0.5,
      inclinePhase: h * Math.PI * 2,
      speed: 0.34 / Math.sqrt(slot + 1.6),
      dir: 1,
      seed: h,
      social: { rank: slot + 1, mentions: Number(k.mentionCount) || 0, authors: 0, velocity: 1, intensity: Math.max(0.25, 1 - slot / Math.max(1, pool.length)) },
      kind: 'kol',
      tier: k.tier,
      kolType: k.type,
      srcNode: k,
    }
  })

  const groups = layoutGalaxy(bodies, groupsMap)
  // voicePoolTotal = post-filter pre-cap count, voiceUniverse = every voice the
  // graph carries — lets the HUD say "48 of 191" instead of silently truncating
  return { sun, bodies, groups, links: [], socialLayer: null, voicePoolTotal: filtered.length, voiceUniverse: (kols || []).length }
}

/**
 * @param graph  { projectNodes, kolNodes, projectAdjacency } from useCrawlGraph
 * @param opts   { design, moonsPerPlanet, kolTypes:Set|null, maxLinks, maxSwarm }
 * @returns      { sun, bodies, groups, links, socialLayer }
 */
export function buildKolCosmos(graph, opts = {}) {
  const {
    design = DEFAULT_DESIGN,
    moonsPerPlanet = 6,
    kolTypes = null,
    minFollowers = 0,
    tiers = null,
    maxLinks = 24,
    maxSwarm = 48,
  } = opts
  const projects = graph?.projectNodes || []
  const kols = graph?.kolNodes || []
  if (!projects.length) return { sun: null, bodies: [], groups: [], links: [], socialLayer: null }

  // one project = the focused drill-down page — a different shape entirely:
  // the project IS the sun and its whole author network orbits it
  if (projects.length === 1) {
    return buildProjectSwarm(projects[0], kols, { maxSwarm, kolTypes, minFollowers, tiers })
  }

  const engagementOf = (p) => Number(p.weightedEngagement) || Number(p.mentionCount) || 1
  const ranked = [...projects].sort((a, b) => engagementOf(b) - engagementOf(a))

  /* ── sun ── */
  let sun
  let planetNodes = ranked
  if (design === 'heat') {
    const top = ranked[0]
    sun = {
      id: (top.symbol || top.name || 'X').toUpperCase(),
      token: {
        symbol: (top.symbol || top.name || 'X').toUpperCase(),
        name: top.name,
        logo: top.avatar || null,
        marketCap: 0,
        cgId: top.cgId || null,
      },
      change: velocityChange(top.velocityScore),
      noMarket: true,
      mentions: Number(top.mentionCount) || 0,
      authors: Number(top.intel?.authors24h) || 0,
      velocity: Number(top.velocityScore) || 1,
      srcNode: top,
    }
    planetNodes = ranked.slice(1)
  } else {
    const totalMentions = ranked.reduce((s, p) => s + (Number(p.mentionCount) || 0), 0)
    sun = {
      id: 'X',
      token: { symbol: 'X', name: 'X · attention core', logo: null, marketCap: 0 },
      change: 0,
      noMarket: true,
      mentions: totalMentions,
      authors: 0,
      velocity: 1,
      isCore: true,
    }
  }

  /* ── planets (projects) ── */
  const maxEng = Math.max(1, ...planetNodes.map(engagementOf))
  const logMax = Math.log(maxEng + 1)
  const groupsMap = new Map()
  const bodyIdByNodeId = new Map()

  const planets = planetNodes.map((p, i) => {
    let id = (p.symbol || p.name || `P${i}`).toUpperCase()
    if (bodyIdByNodeId.has(id)) id = `${id}·${i}` // ticker collisions stay distinct
    const velocity = Number(p.velocityScore) || 1
    const change = velocityChange(velocity)
    const auth = Number(p.authenticity) || 0
    const mentions = Number(p.mentionCount) || 0

    let group, gc, glowRgb
    if (design === 'constellation') {
      group = p.primaryCategory || p.segment || 'Social'
      gc = categoryColor(group, false)
      glowRgb = gc
    } else if (design === 'heat') {
      group = velocityBand(velocity)
      gc = VELO_RGB[group]
      glowRgb = velocityRgb(velocity)
    } else {
      group = authenticityBand(auth)
      gc = BAND_RGB[group]
      glowRgb = authenticityRgb(auth)
    }

    let g = groupsMap.get(group)
    if (!g) { g = { key: group, color: gc, count: 0, members: [] }; groupsMap.set(group, g) }
    g.count++
    g.members.push(i)

    const h = hash01('xb·' + id)
    const h2 = hash01('xb2·' + id)
    const h3 = hash01('xb3·' + id)
    const logNorm = Math.log(engagementOf(p) + 1) / logMax
    const radius = 3.0 + Math.pow(logNorm, 0.8) * (WORLD.maxBody - 3.0)
    // a hot trending list saturates velocity (everything "rising" piles onto
    // the innermost ring) — blend in engagement rank so the field spreads
    // while the story holds: rising + carrying the most attention = closest
    const rankT = Math.sqrt(i / Math.max(1, planetNodes.length - 1))
    const rankOrbit = WORLD.minOrbit + rankT * (WORLD.maxOrbit - WORLD.minOrbit)
    const orbitRadius = orbitForChange(change) * 0.6 + rankOrbit * 0.4 + (h3 - 0.5) * 9

    const body = {
      id,
      token: {
        symbol: id,
        name: p.name || id,
        logo: p.avatar || null,
        marketCap: 0,
        cgId: p.cgId || null,
      },
      change,
      noMarket: true,
      glowColor: rgbToHex(glowRgb),
      mentions,
      authors: Number(p.intel?.authors24h) || 0,
      velocity,
      subLabel: `${fmtCount(mentions)} mentions`,
      group,
      groupColor: gc,
      radius,
      mcapNorm: logNorm,
      orbitJitter: (h3 - 0.5) * 9,
      orbitRadius,
      phase: h * Math.PI * 2,
      incline: (h2 - 0.5) * 0.42,
      inclinePhase: h3 * Math.PI * 2,
      speed: 0.14 / Math.sqrt(Math.max(0.2, orbitRadius / WORLD.neutralOrbit)),
      dir: 1,
      seed: h,
      // `social` guards the orbit from the change-driven re-target AND
      // feeds the aura pulse when this planet makes the hot list
      social: { rank: i + 1, mentions, authors: Number(p.intel?.authors24h) || 0, velocity, intensity: Math.max(0.3, 1 - i / Math.max(1, planetNodes.length)) },
      kind: 'project',
      srcNode: p,
    }
    bodyIdByNodeId.set(p.id, id)
    bodyIdByNodeId.set(id, id)
    return body
  })

  respacePhases(planets)

  /* ── moons (KOLs around the project they push hardest) ── */
  const byParent = new Map()
  const sunKols = []
  const passesVoice = makeVoiceFilter({ kolTypes, minFollowers, tiers })
  for (const k of kols) {
    if (!passesVoice(k)) continue
    const best = (k.projects || []).reduce((acc, pr) => {
      const w = Number(pr.weightedEngagement) || Number(pr.mentions) || 0
      return !acc || w > acc.w ? { id: pr.projectId, w } : acc
    }, null)
    if (!best) continue
    const parentBodyId = bodyIdByNodeId.get(best.id)
    if (!parentBodyId) {
      // strongest project is the heat-design sun → inner parentless swarm
      if (design === 'heat' && sun?.srcNode?.id === best.id) sunKols.push({ k, w: best.w })
      continue
    }
    let arr = byParent.get(parentBodyId)
    if (!arr) { arr = []; byParent.set(parentBodyId, arr) }
    arr.push({ k, w: best.w })
  }

  const maxFollowers = Math.max(1, ...kols.map((k) => Number(k.followers) || 0))
  const fLogMax = Math.log(maxFollowers + 1)
  const planetById = new Map(planets.map((p) => [p.id, p]))
  const moons = []

  const makeMoon = (k, parentBody, slot) => {
    const handle = (k.handle || '').replace(/^@/, '') || k.name || `kol${moons.length}`
    let id = handle
    if (bodyIdByNodeId.has(id)) id = `${handle}·${slot}`
    bodyIdByNodeId.set(id, id)
    const fNorm = Math.log((Number(k.followers) || 0) + 1) / fLogMax
    const rgb = k.type === 'exchange' ? EXCHANGE_RGB : (TIER_RGB[k.tier] || TIER_RGB.C)
    const h = hash01('moon·' + id)
    const baseR = parentBody ? parentBody.radius : WORLD.sunRadius
    const orbitRadius = parentBody
      ? baseR * 1.9 + 1.5 + slot * 1.2 + h * 0.7
      : WORLD.minOrbit * 0.55 + slot * 1.6 + h * 0.9 // heat-sun inner swarm
    return {
      id,
      token: { symbol: id, name: k.name || handle, logo: k.avatar || null, marketCap: 0 },
      change: 0,
      noMarket: true,
      glowColor: rgbToHex(rgb),
      parentId: parentBody ? parentBody.id : undefined,
      subLabel: `${fmtCount(k.followers)} followers`,
      group: parentBody ? parentBody.group : 'Core voices',
      groupColor: rgb,
      radius: 0.95 + Math.pow(fNorm, 0.9) * 1.5,
      orbitRadius,
      phase: slot * 2.399963 + h * 0.5,
      incline: (hash01('mi·' + id) - 0.5) * 0.9,
      inclinePhase: h * Math.PI * 2,
      speed: (parentBody ? 0.85 : 0.3) / Math.sqrt(slot + 1.4),
      dir: 1,
      seed: h,
      kind: 'kol',
      tier: k.tier,
      kolType: k.type,
      srcNode: k,
    }
  }

  for (const [parentId, arr] of byParent) {
    const parentBody = planetById.get(parentId)
    if (!parentBody) continue
    arr.sort((a, b) => b.w - a.w)
    arr.slice(0, moonsPerPlanet).forEach(({ k }, slot) => moons.push(makeMoon(k, parentBody, slot)))
  }
  sunKols.sort((a, b) => b.w - a.w)
  sunKols.slice(0, moonsPerPlanet).forEach(({ k }, slot) => moons.push(makeMoon(k, null, slot)))

  const bodies = planets.concat(moons)
  const groups = layoutGalaxy(bodies, groupsMap)

  /* ── co-mention constellation lines (shared mindshare between projects) ── */
  const links = []
  if (graph?.projectAdjacency?.size) {
    let maxW = 1
    for (const w of graph.projectAdjacency.values()) maxW = Math.max(maxW, w)
    const lineRgb = design === 'constellation' ? [167, 139, 250] : design === 'heat' ? [251, 191, 36] : [125, 211, 252]
    for (const [key, w] of graph.projectAdjacency) {
      const [na, nb] = key.split('|')
      const a = bodyIdByNodeId.get(na)
      const b = bodyIdByNodeId.get(nb)
      if (!a || !b || !planetById.has(a) || !planetById.has(b)) continue
      links.push({ a, b, w: w / maxW, color: lineRgb })
    }
    links.sort((x, y) => y.w - x.w)
    links.length = Math.min(links.length, maxLinks)
  }

  /* ── aura layer: the hottest planets pulse ── */
  const auras = planets
    .filter((p) => p.velocity >= 1.3 || p.social.rank <= 3)
    .slice(0, 10)
    .map((p) => ({ id: p.id, intensity: Math.min(1, 0.35 + (p.velocity - 1) * 0.6 + (p.social.rank <= 3 ? 0.25 : 0)) }))

  return { sun, bodies, groups, links, socialLayer: { auras, comets: [] } }
}
