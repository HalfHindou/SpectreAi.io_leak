# SPECTRE PULSE — Complete Build Prompt v2
## AI-Native Social Intelligence Platform for Web3

---

## BEFORE YOU WRITE ANY CODE

1. Read `SPECTRE_DESIGN_LAW.md` — this is the visual constitution
2. Read `CLAUDE.md` — the boot sequence
3. Read `src/index.css` — CSS variable source of truth
4. Read `src/icons/spectreIcons.jsx` — icon system (NO external icon libraries)
5. Read `src/components/WelcomePage.jsx` — the visual north star
6. Study this prompt top to bottom before writing a single line

---

## WHAT IS SPECTRE PULSE

Spectre Pulse is a standalone product under Spectre AI. It lives at pulse.spectreai.io.

**One sentence:** Where Web3's intelligence, community, and marketing infrastructure converge into a single addictive feed.

**Core insight:** Every data platform in crypto is a tool you visit and leave. Every social platform has zero intelligence infrastructure. Pulse fills the gap in the middle: the place where intelligence IS the social experience.

**Three pillars:**
1. **The Feed** — Addictive, mindless-scrolling intelligence. Charts embedded in posts. Big numbers. Visual candy you can't stop scrolling. Signals, community analysis, builder updates all mixed together.
2. **Connection Protocol** — The X Bubbles engine evolved into a full searchable, filterable graph of every project and KOL in crypto, with tier ratings, sector clustering, and wallet connections visualized.
3. **Match Engine** — A questionnaire-driven campaign builder where projects answer 4 questions and get an AI-recommended distribution plan across verified intelligence surfaces.

---

## ARCHITECTURE

```
src/
  pulse/
    PulseApp.jsx                 — Root layout, routing, global state
    PulseApp.css                 — Global Pulse styles

    components/
      layout/
        PulseHeader.jsx          — Top bar: logo, search, live indicator, profile
        PulseBottomNav.jsx       — Mobile bottom nav

      stories/
        StoryRail.jsx            — Horizontal rail with toggle: circles vs cards
        StoryCircle.jsx          — Instagram-style circle (gradient ring, data center)
        StoryTweetCard.jsx       — Tweet-style card (badge, title, sparkline, metric)
        StoryViewer.jsx          — Full-screen modal with chart, data, actions

      feed/
        PulseFeed.jsx            — Feed container with filter tabs, infinite scroll
        FeedItem.jsx             — Universal feed card (handles all 3 types)
        FeedSignal.jsx           — AI intelligence card with chart + metric hero
        FeedCommunity.jsx        — Wallet-verified post with position chips
        FeedBuild.jsx            — Proof-of-build card with commit bar chart
        ConfirmBar.jsx           — Confirm/challenge/save action bar
        SparkChart.jsx           — Area, line, or bar sparkline (reusable)
        DataChip.jsx             — Token/metric chip (JetBrains Mono)

      protocol/
        ConnectionProtocol.jsx   — Full Connection Protocol panel
        ProtocolCanvas.jsx       — Canvas-based bubble map with tiers
        ProtocolFilters.jsx      — Search, type (project/KOL), tier (S/A/B/C), sector
        ProtocolLegend.jsx       — Visual legend (solid=project, dashed=KOL, tier colors)
        NodeTooltip.jsx          — Hover tooltip with node details

      match/
        MatchMaker.jsx           — Step-by-step questionnaire flow
        MatchQuestion.jsx        — Single question with option buttons
        MatchResult.jsx          — Campaign plan output with distribution chart
        MatchProgress.jsx        — Step indicator bar

      shared/
        GlassCard.jsx            — Reusable glass card
        VerifiedBadge.jsx        — Green verification dot
        SectorTag.jsx            — Colored sector pill
        MonoValue.jsx            — JetBrains Mono number display
        TierBadge.jsx            — S/A/B/C colored tier badge

    hooks/
      usePulseFeed.js            — Feed data + infinite scroll
      useProtocol.js             — Protocol graph data + filtering
      useMatchEngine.js          — Questionnaire logic + result generation

    data/
      mockFeed.js                — Feed items with chart data
      mockNodes.js               — Protocol nodes (projects + KOLs)
      mockEdges.js               — Protocol connections
      sectors.js                 — Sector definitions
      matchQuestions.js          — Questionnaire flow
```

---

## THE THREE-ZONE DESKTOP LAYOUT

```
+---------------------------------------------------------------------+
|  HEADER: [S] Spectre Pulse  * Live  |  [Search...]  [Profile]       |
+---------------------------------------------------------------------+
|  STORY RAIL: [Stories|Cards] toggle                                  |
|  [circle/card] [circle/card] [circle/card] [circle/card] ... scroll |
+---------------------------------------------------------------------+
|                                          |                           |
|  MAIN FEED (scrollable)                  |  RIGHT PANEL              |
|  [For you|Signals|Community|Building]    |  [Connection Protocol |   |
|                                          |   Find audience]          |
|  +------------------------------------+ |                           |
|  | SIGNAL CARD                         | |  Search box              |
|  | Title + body text                   | |  [All|Projects|KOLs]     |
|  | +$47M  +340%     <- hero metric     | |  [All|S|A|B|C] tiers    |
|  | [====area chart================]    | |  [DeFi][L1][L2]... pills |
|  | [Aave +$18.2M] [Morpho +$12.7M]    | |  8 Projects, 4 KOLs     |
|  | 142 confirms  38 challenges  Save   | |                           |
|  +------------------------------------+ |  +---------------------+ |
|                                          |  | BUBBLE MAP (canvas) | |
|  +------------------------------------+ |  | Floating nodes with  | |
|  | COMMUNITY POST                      | |  | tier badges, dashed | |
|  | mkultra.eth * 84% accuracy          | |  | borders = KOL       | |
|  | Post text...                        | |  | Connections between | |
|  | [====area chart================]    | |  +---------------------+ |
|  | [Holding MORPHO] [Entry $1.42]      | |  Legend: Project, KOL,  |
|  | [+34%]                              | |  S, A, B, C tiers       |
|  | 89 confirms  12 challenges   Save   | |                           |
|  +------------------------------------+ |  -- OR --                 |
|                                          |                           |
|  +------------------------------------+ |  FIND AUDIENCE            |
|  | BUILD CARD                          | |  Step 1/4                |
|  | Aave * Verified project             | |  What are you promoting? |
|  | Title + body                        | |  [Token/Protocol]        |
|  | Builder Score: 94  +3               | |  [NFT collection]        |
|  | [|||bar chart|||||||]               | |  [Web2 brand in Web3]    |
|  | [Commits 14/wk] [TVL $11.2B]       | |  [VC portfolio]          |
|  | 214 confirms  3 challenges   Save   | |  [DAO/Community]         |
|  +------------------------------------+ |                           |
|                                          |  -> Outputs campaign plan |
|  ... infinite scroll ...                 |     with wallet match,    |
|                                          |     surface count, CPA,   |
+------------------------------------------+     distribution chart    |
                                           +---------------------------+
```

---

## FEED DESIGN — THE ADDICTIVE SCROLL

The feed is the core product. It must be mindlessly scrollable like Instagram or TikTok but for intelligence. Every card has visual candy: charts, big numbers, colored metrics, data chips.

### Feed Card Universal Structure:
```
+--------------------------------------------------+
| [Avatar] Username * [verified] Accuracy  [Badge]  |
|                                          [Time]   |
| Title (if signal/build)                            |
| Body text (2-4 lines)                              |
|                                                    |
| METRIC: $47M  +340%    <- big, colored, mono font  |
|                                                    |
| [====== CHART (full width) ======]                 |
| Area chart / bar chart / candle chart              |
|                                                    |
| [chip] [chip] [chip]   OR   [position] [pnl]      |
|                                                    |
| 142 confirms   38 challenges          89 saves     |
+--------------------------------------------------+
```

**KEY RULES FOR THE FEED:**

1. **Every card has a chart.** Signals get area charts showing the trend. Community posts get the token's price chart. Build cards get bar charts showing commit velocity. No exceptions. Charts are full-width, 44-56px tall, with gradient fill.

2. **Metrics are heroes.** Signal cards show the key metric BIG: 22px, JetBrains Mono, bold, colored (green for positive, red for negative). The metric is what makes you stop scrolling.

3. **Charts are embedded, not attached.** The chart flows seamlessly into the card. No border, no background. It's part of the card's visual fabric. Use area charts with gradient fill that fades to transparent.

4. **Data chips use JetBrains Mono.** Every number in a chip is monospace. Label is rgba(255,255,255,0.4), value is white or semantic color.

5. **Position verification is sacred.** Community posts show the user's actual position: token, entry price, PnL. These are verified on-chain. PnL chips have colored backgrounds: green bg for positive, red for negative.

6. **Visual density without clutter.** Cards are information-dense but breathe. The chart provides visual weight. Metrics provide the hook. Body text provides context. Chips provide proof.

### Chart Types by Card Type:

| Card type | Chart style | Color | Height | Data |
|-----------|-------------|-------|--------|------|
| Signal (capital flow) | Area with gradient fill | #10B981 (green) | 56px | Inflow over 24h |
| Signal (whale) | Area with gradient fill | #8B5CF6 (purple) | 56px | Accumulation curve |
| Signal (narrative) | Area with gradient fill | sector color | 56px | Attention over 7d |
| Community post | Area (price chart) | token color | 44px | Token price 30d |
| Build update | Bar chart | #F59E0B (amber) | 44px | Weekly commits |

### SparkChart Component Spec:

```jsx
// Reusable across entire app
<SparkChart
  data={[12, 15, 14, 18, 22, 34, 47, 52]}  // number[]
  type="area"                                  // "area" | "bar" | "line"
  color="#10B981"                               // stroke/fill color
  width={400}                                   // px
  height={56}                                   // px
/>
```

Area type: gradient fill from color at 25% opacity to transparent. 1.5px stroke, rounded joins.
Bar type: individual bars with 2px gap, rounded 2px corners, opacity varies by value (0.5 to 1.0).
Line type: just the stroke, no fill.

---

## CONNECTION PROTOCOL — THE X BUBBLES ENGINE

This is the existing Connection Protocol concept from Spectre, rebuilt as a panel within Pulse.

### Canvas Rendering:

Nodes float with sine/cosine drift animation. Two node types:
- **Projects:** Solid border circle, ticker label, TVL below
- **KOLs:** Dashed border circle, initials label, sub-name below

Each node has a tier badge: small circle at top-right of the node.
- S-Tier: red (#EF4444)
- A-Tier: amber (#F59E0B)
- B-Tier: blue (#3B82F6)
- C-Tier: gray (#6B7280)

Connections between nodes are thin lines (0.7px, rgba(255,255,255,0.06)).

### Filtering System:

The protocol panel has layered filters that all work together:

1. **Search box:** Filters by label and sub-name
2. **Type filter:** All | Projects | KOLs
3. **Tier filter:** All Tiers | S-Tier | A-Tier | B-Tier | C-Tier
4. **Sector pills:** DeFi, L1, L2, AI, Gaming, RWA, Meme, Infra

When filters are active:
- Matching nodes render at full alpha
- Non-matching nodes dim to 0.08 alpha
- Connections between non-matching nodes dim to 0.01 alpha
- Stats update: "8 Projects, 4 KOLs, 12 Total"

### Hover Tooltip:

On node hover:
- Node scales to 1.2x
- Outer glow ring appears
- Tooltip shows: label, tier badge, type badge, sub-name (if KOL), TVL (if project) or followers (if KOL)

### Legend:

Bottom of the protocol panel. Compact row:
- Solid circle = Project
- Dashed circle = KOL
- S (red), A (amber), B (blue), C (gray) tier badges

### Node Data Structure:

```js
{
  id: string,
  x: number,           // 0-1 relative position
  y: number,           // 0-1 relative position
  r: number,           // radius (12-42)
  label: string,       // ticker or initials
  sub?: string,        // full name (KOLs)
  color: string,       // brand hex
  sector: string,      // sector id
  type: 'project' | 'kol',
  tier: 'S' | 'A' | 'B' | 'C',
  tvl: string,         // for projects
  followers: string,   // for KOLs
}
```

---

## MATCH ENGINE — FIND YOUR AUDIENCE

A step-by-step questionnaire that replaces "DM a KOL on Telegram."

### Flow:

4 questions, each with 5 options. Click an option to advance. Progress bar fills.

**Q1: What are you promoting?**
- Token / Protocol
- NFT collection
- Web2 brand entering Web3
- VC portfolio
- DAO / Community

**Q2: Primary goal?**
- New holders / users
- TVL growth
- Brand awareness
- Community growth
- Developer adoption

**Q3: Target audience?**
- DeFi degens
- Institutional / research
- Retail crypto
- Web2 consumers
- Developers

**Q4: Budget range?**
- Under $5K
- $5K - $25K
- $25K - $100K
- $100K - $500K
- $500K+

### Result Output:

After Q4, display the campaign plan:

1. **Metric grid (3 columns):**
   - Matched wallets: verified wallet count
   - Intelligence surfaces: distribution endpoint count
   - Est. CPA: cost per acquisition

2. **Distribution mix:** Bar chart showing allocation across:
   - Intelligence feeds (%)
   - Verified community (%)
   - Builder surfaces (%)
   - Narrative placement (%)

3. **Engine recommendation:** Natural language paragraph explaining the strategy, tailored to the answers.

4. **"Start over" link** to reset the questionnaire.

### Visual Design:

- Questions: 15px semibold white heading
- Options: Glass cards, 12px, hover: border turns purple
- Progress: 4-segment bar, filled segments = #8B5CF6
- Result: glass cards with JetBrains Mono metrics, purple distribution bars, green-tinted recommendation card

---

## STORY RAIL — TWO MODES

### Toggle: "Cards" vs "Stories"

Two small pills at top-left of the story rail. Active pill has glass background.

### Stories mode (circles):
- 54x54px circles
- Gradient ring using the story's chart color
- Inner circle: dark background, metric value centered (JetBrains Mono, 9px bold)
- Label below: 8px, truncated
- Horizontal scroll, 14px gap
- Tap opens StoryViewer

### Cards mode (tweet-style):
- 240px wide, 12px border-radius
- Badge (type label), timestamp
- Title (11px semibold, 2-line clamp)
- Bottom row: hero metric (13px JetBrains Mono bold) + mini sparkline (50x18px)
- Horizontal scroll, 8px gap
- Tap opens StoryViewer

### StoryViewer modal:
- Desktop: centered 420px card on dark overlay
- Hero metric: 42px JetBrains Mono bold, chart color
- Title: 18px Space Grotesk semibold
- Full sparkline: 320x80px
- Body text: 12px, centered
- Actions: Confirm, Challenge, Save buttons

---

## GLOBAL STATE

Sector filter state is GLOBAL. When a user taps a sector pill in the Connection Protocol, it also filters the feed. When they clear it, the feed returns to normal. This creates a unified experience where the protocol and feed are connected.

```
activeSector: string | null     — filters feed + protocol + stories
feedFilter: 'all' | 'signals' | 'community' | 'building'
storyMode: 'cards' | 'circles'
rightTab: 'protocol' | 'match'
```

---

## RESPONSIVE BREAKPOINTS

```css
/* Mobile first */
@media (max-width: 768px) {
  /* Stack: header, stories, feed. Protocol in separate tab via bottom nav. */
  /* Right panel becomes a full-screen view accessed from bottom nav "Map" tab */
  /* Stories default to circles mode */
  /* Feed cards are full width */
  /* Bottom nav: Feed | Map | + | Match | Profile */
}

@media (min-width: 769px) and (max-width: 1024px) {
  /* Right panel collapses to toggleable drawer */
  /* Feed gets more padding */
}

@media (min-width: 1025px) {
  /* Full two-column layout: feed left, protocol/match right */
  /* Story rail spans full width */
}

@media (min-width: 1440px) {
  /* Right panel gets wider (440px) */
  /* Map gets larger */
  /* Feed cards get maximum width constraint */
}
```

---

## ANIMATIONS

- **Feed card entrance:** translateY(10px) -> 0, opacity 0 -> 1, 350ms ease, 50ms stagger
- **Story circle hover:** scale(1.05), 150ms
- **Protocol node float:** continuous sin/cos drift, t += 0.005 per frame
- **Protocol node hover:** scale to 1.2x, 150ms, glow ring fade in
- **Confirm tap:** color transition to #10B981, 150ms
- **Match question option hover:** border-color transition to purple, 150ms
- **Match progress bar:** width transition 300ms ease
- **Story viewer overlay:** fade in 200ms
- **Charts:** no animation on render (they stream in with the card)

**Loading states:** Skeleton shimmer. Text: "Scanning the network..." or "Watching for signals..."

---

## DESIGN RULES (Pulse additions to SPECTRE_DESIGN_LAW)

1. **Charts in every card.** The chart IS the visual hook. Without it, the card is just text and people scroll past.
2. **Metrics are the stop signal.** Big, colored, monospace numbers make you pause mid-scroll. Every card needs one hero number.
3. **Position verification is sacred.** Community posts show verified wallet data. Period.
4. **Protocol nodes are alive.** They float, they breathe, they respond to hover. A static graph is dead.
5. **KOLs have dashed borders.** Projects have solid borders. This is the visual language for the Protocol.
6. **Tier badges are earned.** S-tier is red, A is amber, B is blue, C is gray. These are non-negotiable.
7. **Sector filtering is global.** Tap DeFi in the protocol, the feed filters to DeFi. One experience.
8. **The match engine replaces the rolodex.** 4 questions -> campaign plan. No KOLs needed.
9. **Scrolling should feel addictive.** Charts, numbers, colors, data chips. Visual density that rewards scrolling.
10. **AI is invisible.** "Spectre Intelligence" not "AI Signal." The monogram is "S" not "AI."

---

## FILE CREATION ORDER

1. `sectors.js` — Sector definitions
2. `mockNodes.js`, `mockEdges.js` — Protocol graph data
3. `mockFeed.js` — Feed items with chart arrays
4. `matchQuestions.js` — Questionnaire flow
5. `PulseApp.jsx` + `PulseApp.css` — Root layout
6. `SparkChart.jsx`, `DataChip.jsx`, `GlassCard.jsx`, `VerifiedBadge.jsx`, `SectorTag.jsx`, `TierBadge.jsx`, `MonoValue.jsx` — Shared components
7. `PulseHeader.jsx` — Header
8. `StoryCircle.jsx`, `StoryTweetCard.jsx`, `StoryRail.jsx`, `StoryViewer.jsx` — Story system
9. `FeedItem.jsx` (universal card with chart), `ConfirmBar.jsx` — Feed cards
10. `PulseFeed.jsx` — Feed container with tabs + infinite scroll
11. `ProtocolCanvas.jsx`, `ProtocolFilters.jsx`, `NodeTooltip.jsx`, `ProtocolLegend.jsx`, `ConnectionProtocol.jsx` — Protocol panel
12. `MatchQuestion.jsx`, `MatchProgress.jsx`, `MatchResult.jsx`, `MatchMaker.jsx` — Match engine
13. `PulseBottomNav.jsx` — Mobile nav
14. Responsive polish, animation timing, loading states

---

## SUCCESS CRITERIA

A user should be able to:

1. **Scroll the feed endlessly** and see rich cards with embedded charts, big metrics, position data, and confirm/challenge actions
2. **Toggle story modes** between Instagram circles and tweet-style cards, tap to open full viewer
3. **Use the Connection Protocol** with search, type filters (project/KOL), tier filters (S/A/B/C), and sector pills, all filtering the live bubble map
4. **Answer 4 questions** in the Match Engine and get a full campaign plan with wallet counts, surface distribution, and AI recommendation
5. **Filter by sector** and see the entire app respond: feed, protocol, stories
6. **Feel the addictive scroll.** Charts are the visual candy. Numbers are the hooks. Every card rewards the scroll with new visual information.
7. **Feel it belongs in the Spectre ecosystem.** Dark glass, JetBrains Mono numbers, Space Grotesk headings, purple accent earned not scattered.

**The test:** Show this to a crypto native. If they open the feed and start scrolling without being told to, and they open the Protocol and start filtering without instruction, and they complete the Match questionnaire out of curiosity — the product works.

Build it like the $50M product it will become.
