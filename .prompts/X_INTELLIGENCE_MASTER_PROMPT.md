# X INTELLIGENCE — Master Build Prompt & Vision Document

> **Product:** Spectre X Intelligence — Social Graph Intelligence Engine  
> **Codename:** X-INTEL  
> **Location:** `src/components/XIntelligencePage.jsx` (replaces XBubblesPage)  
> **Author:** Sunny (CEO, Spectre AI)  
> **Target:** Claude Code CLI implementation

---

## PREAMBLE — READ BEFORE ANYTHING

```
MANDATORY BOOT SEQUENCE:
1. Read SPECTRE_DESIGN_LAW.md — every pixel must match
2. Read DESIGN_SYSTEM.md — token reference
3. Read src/index.css — CSS variables (the ONLY source of truth)
4. Read src/icons/spectreIcons.jsx — the ONLY icon source
5. Read src/components/WelcomePage.jsx + WelcomePage.css — visual north star
6. Read this entire document before writing a single line of code
```

---

## 1. WHAT THIS IS

X Intelligence is a force-directed social graph visualization engine that maps the influence topology of Crypto Twitter (X). Think Bubblemaps, but for social influence instead of token holdings. The graph is the interface — not a component inside a page, but the entire viewport. UI elements float on top of the graph as glass overlays.

**Bubblemaps maps money flow. X Intelligence maps attention flow.**

### What Bubblemaps Does Right (Study, Don't Copy)
- The graph IS the interface. Full viewport canvas. Controls float on top.
- Physics simulation creates organic clustering — related entities drift together naturally.
- Size encodes hierarchy instantly — biggest bubble = most powerful entity.
- Color groups related entities — your eye parses clusters before your brain reads labels.
- Interaction is spatial (drag, zoom, hover) not tabular (scroll, click rows).
- Context appears on demand (sidebar on click), never competing with the graph by default.
- Navigation is fluid — click a connection, the graph smoothly recenters. Click a cluster, it zooms in. Double-click empty space, it resets. Everything feels like exploring a map.

### What We Do Differently (The Spectre Way)
- **Aesthetic:** Bubblemaps is functional/clean. We are premium glass morphism — Apple meets Bloomberg in the dark. Our bubbles have glass depth, subtle glow, inset highlights. The graph feels like a living constellation, not a network diagram.
- **Entity diversity:** Bubblemaps has one type (wallet). We have four: Projects, KOLs, Exchanges, VCs/Funds — each with distinct visual identity.
- **Connection semantics:** Bubblemaps has one type (transaction). We have five: Mention, Endorsement, Paid Promotion, Collaboration, Negative Sentiment — each visually distinct.
- **Intelligence layer:** Bubblemaps shows data. We show intelligence — cluster analysis, astroturf detection, influence scoring, narrative tracking.
- **Dual render:** 2D (D3-force, default) and 3D (Three.js r128) toggle. Same data, two experiences.
- **Right sidebar is richer:** Not just stats. For projects: mini chart, top KOLs, builder score, social links. For KOLs: accuracy score, portfolio of endorsements, hit rate, cluster membership.
- **Marketing heatmap overlay:** Enterprise feature. Attention flow as thermal gradient across the graph. Where is the conversation density right now?

---

## 2. ARCHITECTURE

### 2.1 Component Structure

```
src/components/XIntelligence/
├── XIntelligencePage.jsx          # Main page container (full viewport)
├── XIntelligencePage.css          # All styles (single file, no CSS modules)
├── GraphCanvas2D.jsx              # D3-force 2D renderer (default)
├── GraphCanvas3D.jsx              # Three.js r128 3D renderer (toggle)
├── GraphEngine.js                 # Shared force simulation logic
├── EntityBubble.jsx               # Individual bubble renderer (SVG for 2D)
├── ConnectionLine.jsx             # Edge renderer with type-based styling
├── FloatingControls.jsx           # Flight controls overlay (zoom, pan, reset, 2D/3D, day/dark)
├── FilterPanel.jsx                # Left-side collapsible filter panel (glass)
├── EntitySidebar.jsx              # Right-side contextual detail panel (glass)
├── SearchOverlay.jsx              # Floating search bar (top center, glass)
├── LegendPanel.jsx                # Bottom-left legend (entity types, connection types, color key)
├── HeatmapOverlay.jsx             # Marketing heatmap thermal layer (enterprise)
├── TimelineSlider.jsx             # Bottom timeline scrubber for time-travel
├── ClusterLabel.jsx               # Floating labels for detected clusters
└── hooks/
    ├── useGraphData.js            # Data fetching and transformation
    ├── useForceSimulation.js      # D3 force simulation management
    ├── useGraphInteraction.js     # Click, hover, drag, zoom handlers
    └── useClusterDetection.js     # AI-assisted cluster identification
```

### 2.2 Data Model

```javascript
// Entity (Node)
{
  id: "entity_001",
  type: "kol" | "project" | "exchange" | "vc",
  name: "CryptoKaleo",
  handle: "@CryptoKaleo",
  avatar: "https://...",           // Profile image URL
  influence: 87.4,                 // Composite score 0-100 (determines bubble size)
  followers: 580000,
  engagementRate: 4.2,             // Percentage
  sector: "trading" | "defi" | "meme" | "l1" | "ai" | "gaming" | "nft",
  cluster: "alpha_traders",        // Auto-detected cluster ID
  // For projects only:
  token: { symbol: "ETH", price: 3842.50, change24h: 2.4, marketCap: "462B" },
  builderScore: 92,
  // For KOLs only:
  accuracyScore: 71.3,            // % of endorsed projects that performed well 30d later
  mentionedProjects: ["eth", "sol", "arb", ...],
  hitRate: { wins: 42, losses: 18, neutral: 12 },
}

// Connection (Edge)
{
  source: "entity_001",
  target: "entity_002",
  type: "mention" | "endorsement" | "paid" | "collaboration" | "negative",
  weight: 14,                      // Frequency / strength
  timestamp: "2026-03-15T...",     // Most recent interaction
  sentiment: 0.82,                 // -1 to 1
  direction: "source_to_target" | "bidirectional",
}

// Cluster (auto-detected)
{
  id: "alpha_traders",
  label: "Alpha Trading Circle",
  entities: ["entity_001", "entity_003", "entity_007", ...],
  cohesion: 0.89,                  // How tightly connected (0-1)
  sector: "trading",
  suspicionScore: 0.12,            // 0 = organic, 1 = likely astroturf
}
```

### 2.3 Visual Encoding

```
ENTITY TYPE → SHAPE:
  KOL       → Circle (with avatar)
  Project   → Hexagon (with token logo)
  Exchange  → Diamond
  VC/Fund   → Rounded square

INFLUENCE → SIZE:
  influence 0-25    → radius 12-20px
  influence 25-50   → radius 20-35px
  influence 50-75   → radius 35-55px
  influence 75-100  → radius 55-80px

SECTOR → COLOR:
  DeFi    → #3B82F6 (blue)
  Meme    → #F97316 (orange)
  L1/L2   → #8B5CF6 (purple, our accent)
  AI      → #06B6D4 (cyan)
  Gaming  → #22C55E (green)
  NFT     → #EC4899 (pink)
  Trading → #EAB308 (yellow)
  
  These are the FILL colors at 0.15 opacity for the bubble background.
  The BORDER uses the same color at 0.4 opacity.
  The GLOW (on hover/active) uses the same color at 0.2 opacity, blur 20px.

CONNECTION TYPE → LINE STYLE:
  Mention       → Thin (1px), white at 0.08 opacity, straight
  Endorsement   → Medium (2px), green at 0.2 opacity, with directional arrow
  Paid promo    → Dashed (2px), yellow at 0.15 opacity
  Collaboration → Thick (3px), accent purple at 0.25 opacity, glowing
  Negative      → Thin (1px), red at 0.15 opacity, jagged/wavy path
```

---

## 3. UI LAYOUT

### 3.1 Viewport Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────────────── SEARCH BAR ──────────────────────┐       │
│  │  🔍 Search KOLs, projects, tokens...                 │       │
│  └──────────────────────────────────────────────────────-┘       │
│                                                                  │
│  ┌─FILTERS─┐                                    ┌──SIDEBAR──┐  │
│  │ Sectors  │                                    │           │  │
│  │ □ DeFi   │         FORCE-DIRECTED             │  Entity   │  │
│  │ □ Meme   │            GRAPH                   │  Detail   │  │
│  │ □ L1/L2  │         (FULL VP)                  │  Panel    │  │
│  │ □ AI     │                                    │           │  │
│  │ Types    │        ○ ○                         │  Chart    │  │
│  │ □ KOLs   │      ○   ○ ○                       │  Social   │  │
│  │ □ Projects│    ○  ○    ○                       │  Links    │  │
│  │ □ Exchanges│     ○ ○ ○                        │  KOLs     │  │
│  │ Influence │       ○                           │           │  │
│  │ ═══●════ │                                    │           │  │
│  └─────────┘                                    └───────────┘  │
│                                                                  │
│  ┌─LEGEND─────────────┐                                         │
│  │ ● KOL  ⬡ Project   │    ┌────── FLIGHT CONTROLS ──────┐    │
│  │ ◆ Exchange  ■ VC    │    │  [2D|3D] [☼|☾] [⟲] [⛶]    │    │
│  │ ─ mention  ═ endorse│    └─────────────────────────────┘    │
│  └─────────────────────┘                                         │
│  ┌══════════════ TIMELINE SLIDER ══════════════════════════┐    │
│  │  ◄  Jan  Feb  Mar  ●─────────────────── Mar 21 2026  ► │    │
│  └═════════════════════════════════════════════════════════┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Panel Behavior

**Filter Panel (left):**
- Collapsed by default on first load (just a floating filter icon)
- Expands to ~280px glass panel on click
- Sections: Entity Types (checkboxes), Sectors (color-coded checkboxes), Influence Range (slider), Connection Types (checkboxes), Connection Strength (slider)
- Changes filter the graph in real-time with smooth fade-out of excluded entities

**Entity Sidebar (right):**
- Hidden by default
- Slides in from right (320px wide) when an entity bubble is clicked
- Glass morphism panel with contextual content based on entity type
- Close button + clicking empty canvas space dismisses it
- FOR PROJECTS: Token logo + name, mini sparkline chart (7d), price + 24h change, market cap, builder score gauge, top 5 KOL endorsers (mini bubbles you can click), sector tags, social links (X, website, GitHub), "Explore Graph" button (recenters graph on this project)
- FOR KOLS: Avatar + name + handle, influence score gauge, accuracy score gauge (bullseye visual), follower count, engagement rate, "Portfolio" section (projects they've mentioned, sorted by frequency), hit rate bar (green/red segmented), cluster membership badge, recent posts (last 3 tweets), "Explore Graph" button (recenters graph on this KOL)

**Search Overlay (top center):**
- Floating glass pill, always visible
- Type to search — fuzzy match against all entity names/handles
- Results dropdown with entity type icon + name + influence score
- Click result → graph smoothly pans and zooms to that entity, sidebar opens

**Legend (bottom left):**
- Always visible, compact glass panel
- Entity type shapes + labels in one row
- Connection type styles + labels in second row
- Color key (sector colors) in third row
- Collapsible to just an icon on small screens

**Flight Controls (bottom right):**
- Floating glass pill with icon buttons
- [2D | 3D] toggle — switches render engine
- [☼ | ☾] day/dark mode toggle
- [⟲] reset view (zoom to fit all)
- [⛶] fullscreen toggle
- [📸] screenshot/export
- Drag handle for zoom slider (vertical, subtle)

**Timeline Slider (bottom center):**
- Full-width glass bar with time range
- Scrub to see the graph at different points in time
- "Time Travel" — the Bubblemaps feature adapted for social data
- Shows when connections were formed, when entities appeared
- Play button for animation (watch the graph evolve over time)

---

## 4. INTERACTION MODEL

### 4.1 Graph Interactions
```
HOVER on bubble:
  → Bubble scales up 1.15x with spring animation (150ms, ease-out)
  → Bubble glow increases (sector color, opacity 0.3, blur 24px)
  → Connected edges highlight (opacity 0.4 → 0.8)
  → Connected bubbles subtly highlight (border brightens)
  → Tooltip appears: name, type, influence score, top connection
  → All unconnected entities dim to 0.15 opacity

CLICK on bubble:
  → Sidebar opens/updates with entity details
  → Graph smoothly recenters on clicked entity (500ms transition)
  → First-degree connections highlight strongly
  → Second-degree connections highlight faintly
  → Everything else dims to 0.1 opacity
  → Clicked bubble gets a subtle pulse animation (breathing glow)

DOUBLE-CLICK on bubble:
  → "Dive in" — graph zooms into this entity's local neighborhood
  → Only shows entities within 2 degrees of separation
  → Back button appears to return to full graph
  → This is the "jump between bubbles" navigation — the core UX loop

CLICK on connection line:
  → Both connected entities highlight
  → Connection details tooltip: type, weight, timestamp, sentiment
  → Sidebar shows relationship details between the two entities

DRAG on bubble:
  → Bubble follows cursor, physics simulation adjusts
  → Connected bubbles pull along with spring physics
  → Release → bubble settles into new equilibrium

DRAG on canvas (empty space):
  → Pan the entire graph
  → Cursor changes to grab/grabbing

SCROLL:
  → Zoom in/out centered on cursor position
  → Smooth momentum scrolling
  → Min zoom: fit all entities. Max zoom: individual bubble detail.

PINCH (touch):
  → Zoom in/out centered on pinch midpoint
  → Same limits as scroll zoom

CLICK on empty canvas:
  → Deselect current entity
  → Sidebar closes (slide-out animation)
  → All entities return to normal opacity
  → Graph returns to full view (if zoomed into a neighborhood)
```

### 4.2 Navigation Flow (The Core Loop)

This is the key UX insight from Bubblemaps — the graph is explorable:

```
1. USER LANDS → sees full graph, biggest bubbles draw the eye
2. HOVERS a big bubble → sees it's a major KOL, connections light up
3. CLICKS → sidebar shows KOL detail, graph focuses on their network
4. SEES a connected project bubble → clicks it
5. GRAPH SMOOTHLY TRANSITIONS → recenters on the project
6. SIDEBAR UPDATES → shows project detail with its own KOL endorsers
7. CLICKS an endorser KOL → jumps again
8. THIS IS THE "RABBIT HOLE" EXPERIENCE → jumping between bubbles
9. At any point → click empty space or press ESC to zoom out to full view
```

This "follow the connection" pattern is what makes Bubblemaps addictive. Each click reveals a new neighborhood. The user feels like they're exploring a living network.

---

## 5. VISUAL DESIGN SPECIFICATION

### 5.1 Bubble Rendering (2D — SVG)

```css
/* KOL Bubble */
.bubble-kol {
  /* Outer circle */
  fill: var(--sector-color-at-015);  /* Sector color at 15% opacity */
  stroke: var(--sector-color-at-040); /* Sector color at 40% opacity */
  stroke-width: 1.5px;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));
  transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
  
  /* Inner avatar circle (clipped) */
  /* Avatar image clipped to circle, 70% of bubble radius */
  /* Thin ring around avatar: white at 0.12 opacity */
}

.bubble-kol:hover {
  transform: scale(1.15);
  filter: drop-shadow(0 0 24px var(--sector-color-at-020));
  stroke: var(--sector-color-at-060);
}

.bubble-kol.selected {
  stroke: var(--accent);
  stroke-width: 2px;
  animation: bubble-breathe 2s ease-in-out infinite;
}

@keyframes bubble-breathe {
  0%, 100% { filter: drop-shadow(0 0 16px var(--accent-at-015)); }
  50% { filter: drop-shadow(0 0 28px var(--accent-at-025)); }
}

/* Project Bubble — hexagonal shape */
.bubble-project {
  /* Same color system but hexagonal clip-path */
  clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  /* Token logo centered, 60% of bubble size */
}
```

### 5.2 Canvas Background

```css
.x-intelligence-canvas {
  background: var(--bg-void);
  /* Subtle grid pattern — very faint, like graph paper */
  background-image: 
    radial-gradient(circle at 50% 50%, rgba(139,92,246,0.02) 0%, transparent 70%),
    linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
  background-size: 100% 100%, 60px 60px, 60px 60px;
}

/* Day mode */
.app-day-mode .x-intelligence-canvas {
  background: #fafafa;
  background-image:
    radial-gradient(circle at 50% 50%, rgba(139,92,246,0.03) 0%, transparent 70%),
    linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
  background-size: 100% 100%, 60px 60px, 60px 60px;
}
```

### 5.3 Glass Panels

All floating panels use the Spectre glass card pattern from SPECTRE_DESIGN_LAW.md:

```css
.x-intel-panel {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--radius-lg);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.1),
    0 4px 24px rgba(0,0,0,0.4);
}
```

---

## 6. FORCE SIMULATION CONFIGURATION

### 6.1 D3-Force (2D)

```javascript
const simulation = d3.forceSimulation(nodes)
  .force("charge", d3.forceManyBody()
    .strength(d => -30 - d.influence * 2)  // Bigger entities push harder
    .distanceMax(400)
  )
  .force("center", d3.forceCenter(width / 2, height / 2)
    .strength(0.05)
  )
  .force("collision", d3.forceCollide()
    .radius(d => getRadius(d.influence) + 4)  // Padding between bubbles
    .strength(0.8)
    .iterations(3)
  )
  .force("link", d3.forceLink(edges)
    .id(d => d.id)
    .distance(d => 80 + (100 - d.weight) * 2)  // Stronger connections = closer
    .strength(d => 0.1 + d.weight * 0.005)
  )
  .force("cluster", clusterForce()  // Custom force — same cluster entities attract
    .strength(0.3)
  )
  .alphaDecay(0.02)     // Slower decay = smoother settling
  .velocityDecay(0.4);  // Moderate damping
```

### 6.2 Three.js (3D) — Use existing r128 setup

```javascript
// Reuse the Three.js r128 setup from the War Room globe
// ForceGraph3D from 3d-force-graph library OR custom implementation
// Same data model, same interaction model, but rendered in 3D space
// Camera: orbit controls (drag to rotate, scroll to zoom, right-click to pan)
// Bubbles: sphere geometry with glass material (MeshPhysicalMaterial)
// Connections: tube geometry or line geometry with custom shader
// Fresnel rim light on bubbles for glass effect (reuse atmosphere shader concept)
```

---

## 7. DATA LAYER

### 7.1 Mock Data (Phase 1)

Generate a compelling mock dataset:
- 80-120 KOL entities with realistic crypto twitter handles
- 40-60 project entities with real token names
- 10-15 exchange entities (Binance, Coinbase, OKX, Bybit, etc.)
- 8-12 VC entities (a16z, Paradigm, Multicoin, etc.)
- 300-500 connections with varied types and weights
- 5-8 auto-detected clusters

The mock data must feel REAL. Use actual crypto project names, plausible KOL handles, real exchange names. The graph should tell a visual story when it renders — you should see the DeFi cluster, the Meme cluster, the trading alpha cluster.

### 7.2 Real Data (Phase 2 — API later)

```
Backend endpoints (to be built):
GET /api/x-intel/graph           → Full graph (nodes + edges)
GET /api/x-intel/entity/:id      → Entity detail
GET /api/x-intel/entity/:id/connections → Entity's connections
GET /api/x-intel/clusters        → Detected clusters
GET /api/x-intel/search?q=       → Search entities
GET /api/x-intel/heatmap         → Attention heatmap data
GET /api/x-intel/timeline/:range → Graph state at time point
```

Data sources (for backend team):
- X API v2 (tweets, mentions, followers, engagement)
- Spectre's existing social sentiment pipeline
- OpenClaw agents (News Curator, Social Monitor)
- On-chain correlation (whale wallets ↔ X accounts, via Nansen/Arkham)

---

## 8. ENTERPRISE FEATURES (Flag for later, design now)

### 8.1 Marketing Heatmap
- Toggle overlay showing attention density as thermal gradient
- Red = high conversation density, Blue = low
- Animates over time with the timeline slider
- Enterprise clients can see where their marketing dollars created heat

### 8.2 Campaign Tracker
- Overlay showing a specific project's mention propagation path
- "Drop a marker" on a KOL who was seeded → watch the ripple through the graph
- Shows which KOL pickups cascaded into organic coverage vs. dead-ended

### 8.3 Competitive Intelligence Split View
- Side-by-side graphs comparing two projects' social networks
- Highlight overlap (shared KOLs) and gaps (exclusive endorsers)
- "Acquisition targets" — KOLs in competitor's graph but not yours

### 8.4 Astroturf Detector
- AI layer that flags suspicious clusters
- Visual: warning badge on cluster, dashed border, desaturated color
- Criteria: accounts created same time, similar follower ratios, always mention same projects within same window

### 8.5 KOL Scorecard
- Accuracy Score: % of projects endorsed that were profitable 30d later
- Reach: followers × avg engagement rate
- Speed: how early they mention projects vs. market awareness
- Sector Expertise: which categories they're most credible in
- Conflict Score: how many competing projects they simultaneously endorse

### 8.6 "Six Degrees" Mode
- Pick any two entities → show shortest path through the graph
- Animated path highlight with particle flow
- Great for discovery and viral sharing

### 8.7 Narrative Tracker
- AI detects emerging narratives (keyword clusters across KOLs)
- Shows as a "wave" propagating through the graph
- "RWA season" → watch which KOLs picked it up first and how it spread

---

## 9. RESPONSIVE BEHAVIOR

### Desktop (>1200px)
- Full experience as described above
- Filter panel and sidebar can be open simultaneously

### Tablet (768-1200px)
- Filter panel becomes a bottom sheet (swipe up)
- Sidebar becomes a bottom sheet (swipe up from right)
- Flight controls consolidate into a single floating action button
- Legend auto-collapses to icon
- Timeline slider stays but becomes thinner

### Mobile (<768px)
- Graph takes full viewport
- All panels are bottom sheets
- Tap a bubble → bottom sheet slides up with entity detail
- Filter via floating action button (bottom left)
- Search via floating search icon (top right)
- Pinch to zoom, drag to pan
- No 3D mode on mobile (performance)

---

## 10. PERFORMANCE REQUIREMENTS

- Target: 60fps with 200+ nodes and 500+ edges on 2D canvas
- Use canvas rendering (not SVG) for the graph if node count exceeds 150
- SVG for < 150 nodes (crisper, better hover states)
- Debounce filter changes (150ms)
- Virtualize sidebar content (react-window if lists are long)
- Lazy load entity details (fetch on click, not on initial load)
- WebWorker for force simulation calculations (don't block main thread)
- 3D mode: LOD (level of detail) — reduce geometry for distant entities
- Image/avatar lazy loading with placeholder shimmer

---

## 11. IMPLEMENTATION ORDER

```
PHASE 1 — Core Canvas (Ship this first)
  ├── XIntelligencePage with full-viewport canvas
  ├── Mock data generator with realistic entities/connections
  ├── D3-force simulation with proper configuration
  ├── Bubble rendering (shapes by entity type, size by influence, color by sector)
  ├── Connection rendering (line styles by type)
  ├── Basic interactions (hover highlight, click select, pan, zoom)
  ├── Flight controls (zoom, reset, fullscreen, day/dark)
  └── Navigation route in App.jsx (replace x-bubbles)

PHASE 2 — Intelligence Panels
  ├── Entity sidebar (project view + KOL view)
  ├── Filter panel (entity types, sectors, influence range, connection types)
  ├── Search overlay with fuzzy match
  ├── Legend panel
  ├── Cluster detection and labeling
  └── "Dive in" / neighborhood zoom on double-click

PHASE 3 — Time & Dimension
  ├── Timeline slider with time-travel
  ├── 3D toggle with Three.js r128 renderer
  ├── Graph evolution animation (play button)
  └── Screenshot/export

PHASE 4 — Enterprise Intelligence
  ├── Marketing heatmap overlay
  ├── KOL scorecard
  ├── Six degrees mode
  ├── Astroturf detector visual flags
  └── Narrative tracker wave visualization
```

---

## 12. DESIGN NON-NEGOTIABLES

1. **The graph IS the page.** Full viewport. No page chrome except floating glass panels.
2. **Glass morphism everywhere.** Every panel, control, tooltip uses the Spectre glass card pattern. See SPECTRE_DESIGN_LAW.md Rule 0.
3. **Day mode is mandatory.** Every dark-mode style needs `.app-day-mode` counterpart.
4. **Monospace for all numbers.** `font-family: var(--font-mono)` for every metric, score, percentage, count.
5. **spectreIcons only.** No Lucide, no FontAwesome, no Heroicons. Check `src/icons/spectreIcons.jsx`.
6. **No AI labels.** Never say "AI-detected" or "AI-powered" in the UI. Clusters just appear. Intelligence is invisible.
7. **Animation is spatial.** Graph transitions use spring physics (cubic-bezier(0.16, 1, 0.3, 1)). Panels slide. Bubbles breathe. Nothing teleports.
8. **One depth level.** No nested glass cards inside glass cards. One card surface per visual layer.
9. **The "wow moment" is the graph itself.** When it first loads and entities float into position with spring physics — that's the screenshot moment. Make it beautiful.
10. **Performance over decoration.** A smooth 60fps graph with 200 nodes beats a fancy graph that stutters at 50.

---

## 13. WHAT SUCCESS LOOKS LIKE

When someone opens X Intelligence for the first time:

1. They see a dark canvas with a subtle grid pattern
2. Bubbles fade in with staggered animation, floating into their physics-determined positions
3. Connections draw in like laser lines between the bubbles
4. The biggest KOL and project bubbles immediately draw the eye
5. Clusters are visually obvious — you can see the DeFi world, the Meme world, the Alpha Trader circle
6. They hover a bubble → the network lights up, everything else fades. They feel like they've just highlighted a constellation.
7. They click → the sidebar slides in with rich contextual data. The graph smoothly recenters.
8. They click a connection → jump to the next entity. Then the next. They're now rabbit-holing through the social graph of Crypto Twitter.
9. They think: "This is the most beautiful thing I've seen in crypto."

That's the target. Build it.

---

## APPENDIX A: RELEVANT FILES TO STUDY

```
SPECTRE_DESIGN_LAW.md           — Visual law (READ FIRST)
DESIGN_SYSTEM.md                — Token reference
src/index.css                   — CSS variables source of truth
src/icons/spectreIcons.jsx      — Icon library
src/components/WelcomePage.jsx  — Visual north star
src/components/WelcomePage.css  — Glass patterns reference
```

## APPENDIX B: LIBRARIES

```
D3.js (d3-force, d3-zoom, d3-selection) — 2D force simulation + interaction
Three.js r128 (already in project) — 3D rendering
No additional UI libraries. React 18 + vanilla CSS + our design system.
```
