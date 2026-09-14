# X INTELLIGENCE — VISUAL FIX PROMPT

> **Scope:** VISUAL ONLY. No new features, no AI engine, no marketing mode.  
> Fix the graph rendering, entity shapes, clustering, labels, connections, hover/select states, sidebar content, and canvas atmosphere to reach Bubblemaps-tier visual quality.

---

## BOOT SEQUENCE (MANDATORY)

```
READ IN THIS ORDER:
1. SPECTRE_DESIGN_LAW.md (the law)
2. src/index.css (CSS variables — only source of truth)
3. src/icons/spectreIcons.jsx (only icon source)
4. src/components/WelcomePage.jsx + .css (visual north star)
5. The CURRENT X Intelligence files (understand what exists before changing)
6. This entire document
```

---

## WHAT'S WORKING (DON'T BREAK THESE)

- Left panel: stats grid, search, tier/type filters, timeframe — all good
- Flight controls bottom-right — keep as-is
- Legend bottom-left — keep as-is
- Right sidebar opens on entity click — keep this pattern
- Real data flowing (KOLs, exchanges, projects with avatars) — preserve all data
- Connection lines rendering between entities — preserve data, fix visual
- Tier-colored border rings (red S-Tier, gold A-Tier, blue B-Tier) — keep this system
- Size hierarchy (bigger = more influence) — working, needs refinement
- "Powered by Spectre Intelligence" branding — keep

---

## FIX 1: MULTI-CLUSTER LAYOUT (Highest Priority)

### Problem
Everything gravitates toward one center blob. Zignaly/ZIGChain eat the entire graph as a gravity well. No visible neighborhoods or sector separation.

### Fix
Add a sector-based cluster force that pulls entities toward sector-specific regions of the canvas. The result should be 4-6 visually distinct neighborhoods with breathing room between them.

```javascript
// SECTOR CLUSTER FORCE
// Define loose centroid regions for each sector
// These aren't rigid positions — they're gravitational hints
// The force-directed simulation still handles fine positioning

const getClusterCentroids = (width, height) => ({
  // Spread sectors across the canvas with generous spacing
  defi:           { x: width * 0.25, y: height * 0.25 },
  trading:        { x: width * 0.50, y: height * 0.20 },
  meme:           { x: width * 0.75, y: height * 0.25 },
  infrastructure: { x: width * 0.20, y: height * 0.55 },
  exchange:       { x: width * 0.50, y: height * 0.50 },
  ai:             { x: width * 0.80, y: height * 0.50 },
  l1:             { x: width * 0.30, y: height * 0.75 },
  gaming:         { x: width * 0.60, y: height * 0.80 },
  nft:            { x: width * 0.80, y: height * 0.75 },
});

// Custom force function — add to the D3 simulation
function clusterForce(alpha) {
  const centroids = getClusterCentroids(canvasWidth, canvasHeight);
  nodes.forEach(node => {
    const target = centroids[node.sector] || centroids.exchange;
    // Gentle pull toward sector centroid
    // 0.015 is intentionally weak — just enough to create neighborhoods
    // without overriding the link force between connected entities
    node.vx += (target.x - node.x) * alpha * 0.015;
    node.vy += (target.y - node.y) * alpha * 0.015;
  });
}

// Updated simulation config
const simulation = d3.forceSimulation(nodes)
  .force("charge", d3.forceManyBody()
    .strength(d => -40 - d.influence * 2.5)  // Stronger repulsion
    .distanceMax(450)
  )
  .force("center", d3.forceCenter(width / 2, height / 2)
    .strength(0.02)  // WEAKER center pull — let clusters spread
  )
  .force("collision", d3.forceCollide()
    .radius(d => getRadius(d.influence) + 6)
    .strength(0.85)
    .iterations(3)
  )
  .force("link", d3.forceLink(edges)
    .id(d => d.id)
    .distance(d => 60 + (100 - d.weight) * 1.5)
    .strength(d => 0.15 + d.weight * 0.008)
  )
  .force("cluster", clusterForce)  // THE NEW FORCE
  .alphaDecay(0.015)   // Slower decay for smoother settling
  .velocityDecay(0.35);
```

### Expected Result
Looking at the graph, you should see:
- Exchanges cluster roughly in the center (they connect to everything)
- DeFi KOLs form a neighborhood top-left
- Meme KOLs form a neighborhood top-right  
- Trading KOLs form a cluster near center-top
- Cross-sector connections still draw as lines between neighborhoods
- There's visible SPACE between clusters (at least 100px gap at default zoom)

---

## FIX 2: ENTITY SHAPES (Visual Type Differentiation)

### Problem
All entities are circles. At any zoom level, you can't tell if something is a KOL, project, or exchange without reading the label.

### Fix
Different shapes per entity type. In the canvas/SVG renderer:

```
KOL = CIRCLE
  Standard circle. Avatar clipped inside. Tier-colored ring.
  This is what most entities are, so circle = default.

PROJECT = HEXAGON  
  Six-sided shape. Token logo centered inside.
  Immediately reads as "this is a project, not a person."
  
  Canvas path:
  function drawHexagon(ctx, x, y, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + radius * Math.cos(angle);
      const py = y + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

EXCHANGE = ROUNDED SQUARE
  Square with border-radius ~30% of size. Logo centered.
  Reads as "institution" vs. individual.
  
  Canvas:
  function drawRoundedSquare(ctx, x, y, size, radius) {
    const half = size / 2;
    ctx.beginPath();
    ctx.roundRect(x - half, y - half, size, size, radius);
    ctx.closePath();
  }

VC / FUND = DIAMOND (rotated square)
  45-degree rotated square. Logo centered (counter-rotated).
  
  Canvas:
  function drawDiamond(ctx, x, y, size) {
    const half = size / 2;
    ctx.beginPath();
    ctx.moveTo(x, y - half);      // top
    ctx.lineTo(x + half, y);      // right
    ctx.lineTo(x, y + half);      // bottom
    ctx.lineTo(x - half, y);      // left
    ctx.closePath();
  }
```

### Color Rules (Keep Existing Tier System + Add Sector Tint)

The tier-colored ring stays (red = S, gold = A, blue = B, gray = C).

ADD a subtle sector-colored fill BEHIND the avatar/logo:

```javascript
const SECTOR_COLORS = {
  defi:           '#3B82F6', // blue
  meme:           '#F97316', // orange  
  l1:             '#8B5CF6', // purple
  ai:             '#06B6D4', // cyan
  gaming:         '#22C55E', // green
  nft:            '#EC4899', // pink
  trading:        '#EAB308', // yellow
  infrastructure: '#6B7280', // gray
  exchange:       '#F59E0B', // amber
};

// Bubble fill: sector color at 8% opacity (very subtle tint)
// Bubble ring: tier color at full strength
// This way you can BOTH see the tier (ring color) and the sector (fill tint)
```

### Zoomed-Out Fallback

When bubbles are too small to show avatars (radius < 14px at current zoom):
- Don't render the avatar image
- Fill the shape with the sector color at 25% opacity
- Keep the tier-colored ring
- Shape still tells you the entity type

This means at cosmos zoom, you see a field of colored shapes:
circles (KOLs), hexagons (projects), squares (exchanges). Instantly readable.

---

## FIX 3: DYNAMIC LABEL MANAGEMENT

### Problem
At default zoom, labels overlap massively in dense areas. At zoomed-out view, labels on small entities are unreadable noise.

### Fix

```javascript
// LABEL VISIBILITY RULES

function shouldShowLabel(entity, currentZoom, allEntities) {
  const radius = getRadius(entity.influence) * currentZoom;
  
  // Rule 1: Always show labels for top 15 entities by influence
  // (regardless of zoom level — these are the anchor names)
  const topEntities = allEntities
    .sort((a, b) => b.influence - a.influence)
    .slice(0, 15)
    .map(e => e.id);
  if (topEntities.includes(entity.id)) return true;
  
  // Rule 2: Zoom-based threshold
  // At zoom 1.0: show labels for rendered radius > 28px
  // At zoom 1.5: show labels for rendered radius > 20px
  // At zoom 2.5+: show all labels
  if (radius > 28) return true;
  if (currentZoom >= 1.5 && radius > 20) return true;
  if (currentZoom >= 2.5) return true;
  
  // Rule 3: Always show label for hovered entity
  if (entity.id === hoveredEntityId) return true;
  
  // Rule 4: Always show label for selected entity + direct connections
  if (entity.id === selectedEntityId) return true;
  if (selectedEntityConnections.includes(entity.id)) return true;
  
  return false;
}

// LABEL COLLISION AVOIDANCE (simple version)
// After determining which labels to show, check for overlap
// If two labels would overlap, hide the one with lower influence

function resolveCollisions(visibleLabels) {
  const sorted = visibleLabels.sort((a, b) => b.influence - a.influence);
  const placed = [];
  
  return sorted.filter(label => {
    const labelRect = getLabelRect(label); // {x, y, width, height}
    const overlaps = placed.some(p => rectsOverlap(labelRect, p));
    if (!overlaps) {
      placed.push(labelRect);
      return true;
    }
    return false;
  });
}
```

### Label Styling

```css
/* Entity label */
.entity-label {
  font-family: var(--font-body); /* Inter */
  font-size: 11px;
  font-weight: 500;
  fill: var(--text-secondary); /* rgba(255,255,255,0.72) */
  text-anchor: middle;
  pointer-events: none;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6);
  /* Strong shadow for readability over connection lines */
}

/* Top-tier entity label (top 15 by influence) */
.entity-label-hero {
  font-family: var(--font-display); /* Space Grotesk */
  font-size: 12px;
  font-weight: 600;
  fill: var(--text-primary); /* white */
  letter-spacing: -0.01em;
}

/* Label position: below the bubble, offset by radius + 8px */
/* For hexagons: below the flat bottom edge */
/* For diamonds: below the bottom vertex + 6px */
```

---

## FIX 4: CONNECTION LINE STYLING

### Problem
All connection lines look identical. Thin, same opacity, same color. No way to distinguish mention from endorsement from paid promo.

### Fix

```javascript
// CONNECTION RENDERING

function drawConnection(ctx, source, target, connection) {
  ctx.beginPath();
  
  switch (connection.type) {
    case 'mention':
      // Thin, subtle, white
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([]);
      break;
      
    case 'endorsement':
      // Thicker, green-tinted, with subtle glow
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      break;
      
    case 'paid':
      // Dashed, yellow/amber
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 4]);
      break;
      
    case 'collaboration':
      // Thicker, accent purple, glowing
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      break;
      
    case 'negative':
      // Red, thin, wavy (approximate with dash)
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      break;
      
    default:
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([]);
  }
  
  ctx.moveTo(source.x, source.y);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();
  ctx.setLineDash([]); // Reset
}

// HOVER HIGHLIGHT: When an entity is hovered, its connections brighten
function drawHighlightedConnection(ctx, source, target, connection) {
  // Same type logic but opacity jumps to 0.5-0.7
  // Line width increases by 1px
  // Add glow: ctx.shadowColor, ctx.shadowBlur = 8
}
```

### Connection Rendering Order

Draw in this order (back to front):
1. All non-highlighted connections (very subtle, background web)
2. Highlighted connections for hovered/selected entity (bright, on top)
3. Entity shapes (on top of all lines)
4. Labels (on top of everything)

---

## FIX 5: HOVER & SELECT STATES

### Problem
When you hover or select an entity, the rest of the graph doesn't dim enough. The selected entity doesn't pop sufficiently.

### Fix

```javascript
// HOVER STATE
function renderHoverState(hoveredEntity) {
  // 1. Dim ALL entities not connected to hovered entity
  allEntities.forEach(entity => {
    if (entity.id === hoveredEntity.id) {
      entity.renderOpacity = 1.0;
      entity.renderScale = 1.12; // Slight scale-up
    } else if (isDirectlyConnected(hoveredEntity, entity)) {
      entity.renderOpacity = 0.9;
      entity.renderScale = 1.0;
    } else {
      entity.renderOpacity = 0.12; // VERY dim
      entity.renderScale = 1.0;
    }
  });
  
  // 2. Dim all connections not involving hovered entity
  allConnections.forEach(conn => {
    if (conn.source.id === hoveredEntity.id || conn.target.id === hoveredEntity.id) {
      conn.renderOpacity = 0.6; // Bright
    } else {
      conn.renderOpacity = 0.02; // Nearly invisible
    }
  });
}

// SELECT STATE (click)
function renderSelectState(selectedEntity) {
  // Same as hover but:
  // - Include 2nd-degree connections at reduced opacity
  // - Selected entity gets breathing glow animation
  // - Sidebar opens
  
  allEntities.forEach(entity => {
    if (entity.id === selectedEntity.id) {
      entity.renderOpacity = 1.0;
      entity.renderScale = 1.15;
      entity.glowing = true; // Trigger CSS breathing animation
    } else if (isDirectlyConnected(selectedEntity, entity)) {
      entity.renderOpacity = 0.85;
      entity.renderScale = 1.0;
    } else if (isSecondDegree(selectedEntity, entity)) {
      entity.renderOpacity = 0.35; // Faint but visible
      entity.renderScale = 1.0;
    } else {
      entity.renderOpacity = 0.08; // Nearly invisible
      entity.renderScale = 1.0;
    }
  });
}

// DESELECT (click empty space or ESC)
function renderDefaultState() {
  allEntities.forEach(entity => {
    entity.renderOpacity = 1.0;
    entity.renderScale = 1.0;
    entity.glowing = false;
  });
  allConnections.forEach(conn => {
    conn.renderOpacity = getDefaultOpacity(conn.type);
  });
}
```

### Transition Timing

All opacity/scale changes should transition over 300ms with `cubic-bezier(0.16, 1, 0.3, 1)`. Never snap. The dim/highlight should FLOW like lights dimming in a theater.

---

## FIX 6: CANVAS ATMOSPHERE

### Problem
Background is flat black. No depth. No spatial context. Feels empty.

### Fix

```css
/* Canvas background — subtle grid + radial glow */
.x-intel-canvas {
  background-color: #050507; /* Slightly lighter than pure black */
  background-image:
    /* Subtle center glow — gives spatial anchor */
    radial-gradient(
      ellipse 60% 50% at 50% 50%,
      rgba(139, 92, 246, 0.015) 0%,   /* Very faint purple at center */
      transparent 70%
    ),
    /* Dot grid — subtle spatial reference */
    radial-gradient(
      circle at center,
      rgba(255, 255, 255, 0.04) 1px,
      transparent 1px
    );
  background-size: 100% 100%, 40px 40px;
}

/* Day mode */
.app-day-mode .x-intel-canvas {
  background-color: #f8f9fa;
  background-image:
    radial-gradient(
      ellipse 60% 50% at 50% 50%,
      rgba(139, 92, 246, 0.03) 0%,
      transparent 70%
    ),
    radial-gradient(
      circle at center,
      rgba(0, 0, 0, 0.04) 1px,
      transparent 1px
    );
  background-size: 100% 100%, 40px 40px;
}
```

### Cluster Ambient Glow

When clusters are clearly separated (after Fix 1), add a very subtle radial glow behind each cluster in its sector color:

```javascript
// After the force simulation settles, calculate cluster centroids
// Draw a very faint radial gradient behind each cluster
function drawClusterAmbiance(ctx, clusters) {
  clusters.forEach(cluster => {
    const centroid = calculateCentroid(cluster.entities);
    const radius = calculateClusterRadius(cluster.entities) * 1.5;
    
    const gradient = ctx.createRadialGradient(
      centroid.x, centroid.y, 0,
      centroid.x, centroid.y, radius
    );
    
    const color = SECTOR_COLORS[cluster.sector];
    gradient.addColorStop(0, `${color}08`);  // 3% opacity at center
    gradient.addColorStop(1, `${color}00`);  // Transparent at edge
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centroid.x, centroid.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}
```

This creates the feeling that each neighborhood has its own "atmosphere." DeFi cluster has a faint blue haze. Meme cluster has a faint orange haze. Very subtle (3% opacity max). But it gives the graph LIFE.

---

## FIX 7: SIDEBAR ENRICHMENT

### Problem
Click a KOL → see name, followers, activity, 1 connection. That's a business card, not intelligence. Click a project → same thin data.

### Fix: KOL Sidebar

```
┌─────────── KOL SIDEBAR ─────────────────────┐
│                                               │
│  [Avatar 64px]                                │
│  CryptoKaleo                                  │
│  @CryptoKaleo                                 │
│  S-Tier  •  Trading                           │
│                                               │
│  ┌─ STATS (2x2 grid) ──────────────────────┐ │
│  │ Followers        Engagement Rate         │ │
│  │ 580.0K           4.2%                    │ │
│  │                                          │ │
│  │ Connections       Influence              │ │
│  │ 47                94.2                   │ │
│  └─────────────────────────────────────────-┘ │
│                                               │
│  ┌─ INFLUENCE TREND (sparkline) ────────────┐ │
│  │  ▁▂▃▄▅▆▇█▇▆▅▆▇█  30d                   │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ── TOP MENTIONED PROJECTS ────────────────── │
│                                               │
│  ⬡ SOL  (14 mentions)  →                     │
│  ⬡ ETH  (11 mentions)  →                     │
│  ⬡ ZIG  (8 mentions)   →                     │
│  ⬡ ARB  (5 mentions)   →                     │
│  ⬡ LINK (4 mentions)   →                     │
│                                               │
│  Each row clickable → navigates graph to      │
│  that project. Arrow indicates "jump there."  │
│                                               │
│  ── CONNECTIONS ─────────────────────────────  │
│                                               │
│  Endorsements: 12                             │
│  Mentions: 31                                 │
│  Collaborations: 4                            │
│                                               │
│  ── CONNECTED KOLS ──────────────────────────  │
│                                               │
│  ● @YieldWhale   S-Tier  →                    │
│  ● @DefiMage     A-Tier  →                    │
│  ● @AlphaLeaks   A-Tier  →                    │
│                                               │
│  Each row clickable → navigates graph.        │
│                                               │
│  ── CLUSTER ─────────────────────────────────  │
│  Alpha Trading Circle                         │
│  12 members  •  Cohesion: 89%                 │
│                                               │
│  [View on X ↗]                                │
│                                               │
└───────────────────────────────────────────────┘
```

### Fix: Project Sidebar

```
┌─────────── PROJECT SIDEBAR ──────────────────┐
│                                               │
│  [Logo 64px]                                  │
│  ZIGChain                                     │
│  $ZIG  •  DeFi                                │
│                                               │
│  ┌─ PRICE ──────────────────────────────────┐ │
│  │ $0.0842          +12.4% (24h)            │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ STATS (2x3 grid) ──────────────────────┐ │
│  │ Market Cap       Volume (24h)            │ │
│  │ $84.2M           $12.1M                  │ │
│  │                                          │ │
│  │ KOL Mentions     Unique KOLs             │ │
│  │ 47 (7d)          12                      │ │
│  │                                          │ │
│  │ Sentiment         Sector                 │ │
│  │ 0.72 Bullish     DeFi                    │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ MINI CHART (sparkline, 7d) ─────────────┐ │
│  │  ╱╲    ╱╲╱╲                              │ │
│  │ ╱  ╲╱╲╱    ╲╱╲──                        │ │
│  │                                           │ │
│  │ [1D] [7D] [30D]                          │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ── TOP ENDORSERS ───────────────────────────  │
│                                               │
│  ● @CryptoKaleo  S-Tier  14 mentions  →      │
│  ● @Lucky        A-Tier  8 mentions   →      │
│  ● @Muro         B-Tier  5 mentions   →      │
│                                               │
│  ── CONNECTED EXCHANGES ─────────────────────  │
│                                               │
│  ▢ Bybit      →                               │
│  ▢ Bitpanda   →                               │
│  ▢ KuCoin     →                               │
│                                               │
│  [Website ↗]  [Twitter ↗]  [CoinGecko ↗]    │
│                                               │
└───────────────────────────────────────────────┘
```

### Key Sidebar Rules

1. Every entity row (projects in KOL sidebar, KOLs in project sidebar, connected entities) MUST be clickable and navigate the graph to that entity. Show a subtle `→` arrow to indicate navigability. This creates the "crawl through the ecosystem" loop.

2. Stats use `font-family: var(--font-mono)` for all numbers.

3. The sparkline/mini chart should be a simple canvas element, 100% width, ~40px height. Use the same charting approach as existing TradingChart but ultra-minimal — just a line with area fill below.

4. Sidebar width: 320px. Glass panel. Slides in from right with `transform: translateX(100%) → translateX(0)` over 300ms.

5. Close button top-right. Also closes when clicking empty canvas space or pressing ESC.

6. Entity shape icon next to each entity in the sidebar lists: ● for KOL, ⬡ for project, ▢ for exchange, ◇ for VC/fund. This reinforces the shape language.

---

## FIX 8: BUBBLE RENDERING QUALITY

### Glass Depth on Bubbles

Currently bubbles are flat circles with a colored ring. Add depth:

```javascript
// BUBBLE RENDERING (canvas)

function drawBubble(ctx, entity, x, y, radius) {
  const sectorColor = SECTOR_COLORS[entity.sector];
  const tierColor = TIER_COLORS[entity.tier];
  
  // 1. Sector ambient glow (very subtle, behind everything)
  if (radius > 20) {
    const glowGradient = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 2);
    glowGradient.addColorStop(0, `${sectorColor}0A`); // 4% opacity
    glowGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // 2. Outer ring (tier color)
  ctx.beginPath();
  drawShape(ctx, entity.type, x, y, radius); // circle/hex/square/diamond
  ctx.strokeStyle = `${tierColor}CC`; // 80% opacity
  ctx.lineWidth = entity.tier === 'S' ? 2.5 : entity.tier === 'A' ? 2 : 1.5;
  ctx.stroke();
  
  // 3. Inner fill (dark with subtle sector tint)
  ctx.beginPath();
  drawShape(ctx, entity.type, x, y, radius - 2);
  const fillGradient = ctx.createRadialGradient(x, y - radius * 0.3, 0, x, y, radius);
  fillGradient.addColorStop(0, `${sectorColor}12`); // 7% — subtle light from top
  fillGradient.addColorStop(1, '#0a0a0f');            // Dark at edges
  ctx.fillStyle = fillGradient;
  ctx.fill();
  
  // 4. Top edge highlight (glass effect — 1px arc on upper half)
  if (radius > 16) {
    ctx.beginPath();
    ctx.arc(x, y, radius - 1, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  
  // 5. Avatar/logo (clipped to shape, 70% of radius)
  if (radius > 12 && entity.avatar) {
    ctx.save();
    ctx.beginPath();
    drawShape(ctx, entity.type, x, y, radius * 0.65);
    ctx.clip();
    ctx.drawImage(
      entity.avatarImage,
      x - radius * 0.65,
      y - radius * 0.65,
      radius * 1.3,
      radius * 1.3
    );
    ctx.restore();
  }
}

// Shape helper
function drawShape(ctx, type, x, y, radius) {
  switch (type) {
    case 'kol':
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      break;
    case 'project':
      drawHexagon(ctx, x, y, radius);
      break;
    case 'exchange':
      drawRoundedSquare(ctx, x, y, radius * 1.8, radius * 0.3);
      break;
    case 'vc':
      drawDiamond(ctx, x, y, radius * 1.4);
      break;
  }
}
```

### Hover Glow

When an entity is hovered, add a pronounced glow in its sector color:

```javascript
function drawHoverGlow(ctx, entity, x, y, radius) {
  const color = SECTOR_COLORS[entity.sector];
  const glow = ctx.createRadialGradient(x, y, radius, x, y, radius * 2.5);
  glow.addColorStop(0, `${color}25`); // 15% opacity
  glow.addColorStop(0.5, `${color}10`); // 6%
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
  ctx.fill();
}
```

---

## FIX 9: INITIAL LOAD ANIMATION

### Problem
Graph pops in instantly. No entrance. No "wow moment."

### Fix

```javascript
// ENTRANCE SEQUENCE (on first load or view reset)

function animateEntrance() {
  // Phase 1: Canvas fades from black (0 → 1 opacity, 500ms)
  
  // Phase 2: Entities appear with staggered fade-in
  // Sort by influence (biggest first)
  // Each entity: opacity 0 → 1, scale 0 → 1 with spring easing
  // Stagger: 15ms between each entity
  // Duration per entity: 400ms
  // Total for 200 entities: ~3.4s (feels like a wave)
  
  const sorted = entities.sort((a, b) => b.influence - a.influence);
  sorted.forEach((entity, index) => {
    entity.renderOpacity = 0;
    entity.renderScale = 0;
    
    setTimeout(() => {
      animateSpring(entity, 'renderOpacity', 1, 400);
      animateSpring(entity, 'renderScale', 1, 400);
    }, index * 15);
  });
  
  // Phase 3: Connections fade in AFTER entities settle (delay 800ms)
  // All connections: opacity 0 → default over 600ms
  setTimeout(() => {
    connections.forEach(conn => {
      animateSpring(conn, 'renderOpacity', getDefaultOpacity(conn.type), 600);
    });
  }, 800);
  
  // Phase 4: Labels fade in LAST (delay 1200ms)
  setTimeout(() => {
    showLabels = true;
    // Labels fade: opacity 0 → 1 over 400ms
  }, 1200);
}
```

This creates the "constellation assembling" effect. Big entities appear first, smaller ones fill in, then connections draw between them, then labels appear. It should feel like watching stars appear in the sky.

---

## FIX 10: LEFT PANEL REFINEMENT

### Add These Controls to Existing Left Panel

Below the existing Timeframe section, add:

```
── CONNECTION TYPE ──────────────────
☑ Mentions         ─── (line sample)
☑ Endorsements     ═══ (thick green sample)
☑ Paid Promos      - - - (dashed sample)
☑ Collaborations   ═══ (purple glow sample)

── SECTOR FILTER ───────────────────
☑ ● DeFi          ☑ ● Meme
☑ ● L1/L2         ☑ ● AI
☑ ● Gaming        ☑ ● NFT
☑ ● Trading       ☑ ● Infrastructure
```

Each filter should apply instantly (200ms transition). Unchecked entities/connections fade to opacity 0 and are excluded from the simulation (so remaining entities spread out to fill the space).

### Sector filter checkboxes: show the sector color as a small dot (6px circle) next to the label.
### Connection type checkboxes: show a small line sample (20px) in the actual style (solid, dashed, thick, etc.) next to the label.

---

## IMPLEMENTATION ORDER (Do in this sequence)

```
1. CANVAS ATMOSPHERE (Fix 6)
   Quick CSS change. Immediate visual improvement. 2 minutes.

2. ENTITY SHAPES (Fix 2)  
   Change render function. Hexagons for projects, squares for exchanges.
   Test with existing data. 30 minutes.

3. MULTI-CLUSTER LAYOUT (Fix 1)
   Add cluster force to simulation. Tune parameters.
   This is the biggest visual change. 45 minutes.

4. BUBBLE RENDERING QUALITY (Fix 8)
   Glass depth, gradients, top-edge highlight, hover glow.
   Makes everything feel premium. 30 minutes.

5. HOVER & SELECT STATES (Fix 5)
   Dim/highlight logic. 300ms transitions.
   Makes interaction feel intelligent. 20 minutes.

6. CONNECTION LINE STYLING (Fix 4)
   Type-based line styles. Render order fix.
   Adds information to the visual. 20 minutes.

7. DYNAMIC LABEL MANAGEMENT (Fix 3)
   Zoom-based visibility + collision avoidance.
   Cleans up the dense center. 30 minutes.

8. SIDEBAR ENRICHMENT (Fix 7)
   More sections, clickable navigation, sparklines.
   Makes clicking entities rewarding. 45 minutes.

9. INITIAL LOAD ANIMATION (Fix 9)
   Staggered entrance sequence.
   The "wow moment." 20 minutes.

10. LEFT PANEL FILTERS (Fix 10)
    Connection type + sector filter additions.
    More control for the user. 20 minutes.
```

---

## DESIGN NON-NEGOTIABLES (Same as v1)

1. Graph IS the page. Full viewport. Panels float.
2. Glass morphism on all panels per SPECTRE_DESIGN_LAW.md.
3. Day mode for every style (`.app-day-mode` counterparts).
4. Monospace for numbers: `var(--font-mono)`.
5. Icons from `spectreIcons.jsx` only.
6. No "AI" labels anywhere in the UI.
7. One depth level per panel. No nested glass.
8. 60fps target with 300+ nodes. Canvas rendering for performance.
9. Every opacity/scale transition: 300ms, `cubic-bezier(0.16, 1, 0.3, 1)`.
10. When in doubt, match WelcomePage quality.

---

## SUCCESS CRITERIA

After these 10 fixes, the graph should pass this test:

**The Squint Test:** Squint at the screen. Can you see 4-5 distinct cluster neighborhoods? Can you tell circles from hexagons from squares? Do the clusters have different color tones? → If yes, Fix 1, 2, 6 worked.

**The Hover Test:** Hover any entity. Does everything else dim dramatically? Do the connections to this entity glow? Does the entity itself feel like it "lifts" from the surface? → If yes, Fix 5, 8 worked.

**The Zoom Test:** Zoom all the way out. Are only the top ~15 names visible, with no overlapping labels? Is every entity still distinguishable by shape and color even without labels? → If yes, Fix 2, 3 worked.

**The Click Test:** Click a KOL. Does the sidebar show enough information that you'd actually learn something? Can you click a project in their "Top Mentioned" list and jump to it on the graph? → If yes, Fix 7 worked.

**The Entrance Test:** Reload the page. Do entities assemble like a constellation — big ones first, small ones filling in, connections drawing last? Does it make you pause for a second? → If yes, Fix 9 worked.

**The Screenshot Test:** Would someone screenshot this and post it on X? → If yes, you're done.
