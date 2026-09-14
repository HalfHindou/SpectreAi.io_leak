# YOU V2 — TEMPLATES SPEC

Six pre-built dashboards. Each one serves a clear archetype. One-click apply, fully customizable after.

Templates are the cold start. They also double as a marketing surface: each one gets a public preview URL.

---

## File locations

- `/src/registry/templates.json` — canonical template definitions
- `/src/components/YouTemplates.jsx` — template picker UI
- `/src/components/YouTemplates.css` — styling

---

## Template schema

```typescript
interface TemplateEntry {
  id: string;
  name: string;
  tagline: string;             // one short line, founder voice
  description: string;         // one paragraph, what this dashboard is for
  archetype: string;           // 'perps' | 'onchain' | 'degen' | 'rwa' | 'narrative' | 'whale'
  tier_min: number;            // lowest token tier that can apply this template
  preview_image: string;       // path to preview, build later
  layout: TemplateWidget[];
}

interface TemplateWidget {
  widget_id: string;           // must exist in widgets.json
  x: number;                   // 0-11, grid column
  y: number;                   // 0+, grid row
  w: number;                   // width in columns
  h: number;                   // height in rows
  props?: Record<string, any>; // optional overrides on default_props
}
```

---

## The six templates

Composition guidance below. Adjust widget ids during the build to match what is registered. If a referenced widget does not exist in the registry, stop and add it to the registry first. Do not invent.

### 1. Perps Trader

**Tagline:** Built for derivatives.

**Description:** Funding skew, open interest, liquidation maps, and top trader positioning. Designed for someone running leveraged size who needs the derivatives picture in one glance.

**Tier:** 500

**Layout suggestion:**
- Funding rates heatmap (top, full width)
- Open interest by exchange (left half)
- Liquidation map (right half)
- Top traders feed (bottom left)
- Perps screener (bottom right)
- Market dominance ticker (footer)

### 2. Onchain Analyst

**Tagline:** The on-chain truth.

**Description:** Whale flows, exchange deposits and withdrawals, smart money clusters, token unlocks. For traders who think on-chain data leads price.

**Tier:** 1000

**Layout suggestion:**
- Whale tracker (top, two-thirds width)
- Exchange flow tracker (top, one-third)
- Smart money positions (middle left)
- Token unlock calendar (middle right)
- Address watchlist (bottom)

### 3. Degen

**Tagline:** Where the action is.

**Description:** New pairs, narrative momentum, trending tokens, social heat. For traders who hunt rotation and live on Crypto Twitter.

**Tier:** 0

**Layout suggestion:**
- Trending tokens (top, full width)
- New pairs feed (left half)
- Narrative momentum (right half)
- Social heatmap (bottom left)
- Mindshare gauge (bottom right)

### 4. RWA Investor

**Tagline:** Tokenized everything.

**Description:** Tokenized assets, real-world yields, regulatory news, RWA narratives. For long-term capital tracking the institutional crossover.

**Tier:** 1000

**Layout suggestion:**
- RWA narrative dashboard (top, full width)
- Tokenized asset feed (left half)
- Yields comparison (right half)
- Regulatory news (bottom)

### 5. Narrative Trader

**Tagline:** Trade the story.

**Description:** Mindshare gauges, narrative lifecycle tracking, social momentum, related token clusters. For traders who rotate between themes before the market does.

**Tier:** 500

**Layout suggestion:**
- Mindshare gauge (top, full width)
- Narrative lifecycle (left half)
- Social momentum (right half)
- Related token clusters (bottom)

### 6. Whale Watcher

**Tagline:** Follow the size.

**Description:** Real-time whale flows, address watchlists, fund-level positions, smart money clusters. For traders who copy the smartest wallets.

**Tier:** 1000

**Layout suggestion:**
- Whale tracker (top, full width)
- Address watchlist (middle left)
- Fund flows (middle right)
- Smart money clusters (bottom)

---

## UI requirements

The template picker is a modal or slide-over reachable from:
- The empty state of the You page ("Start from a template")
- A button in the You page header
- The composer fallback ("not sure? try a template")

Each template card shows:
- Name and tagline
- A 16:9 preview image (placeholder gradient for now if image not built)
- Tier requirement badge (matches existing tier badge style)
- "Apply" button — applies the template to the user's current dashboard, with a confirmation if their dashboard has unsaved changes

On apply:
- Replace the current dashboard layout with the template layout
- Track event: `you_template_applied` with `template_id`
- Show a brief toast: "Applied {template_name}. You can customize anything."

---

## Validation rules

Before saving any template:
- Every `widget_id` in `layout` must exist in `widgets.json`
- No two widgets in a template may overlap on the grid
- Total grid usage must fit within 12 columns
- All widgets must respect their `min_size` and `max_size` if defined

A `validateTemplate(template)` helper in `/src/registry/index.js` enforces these.

---

## Existence check before starting

```bash
test -f src/registry/templates.json && echo "EXISTS: templates.json" || echo "NOT FOUND: templates.json"
test -f src/components/YouTemplates.jsx && echo "EXISTS: YouTemplates.jsx" || echo "NOT FOUND: YouTemplates.jsx"
```

If templates already exist, audit and extend rather than overwrite.

---

## Stop condition

Phase 2 is complete when:
- All six templates exist in `templates.json`
- Every template passes `validateTemplate()`
- Template picker UI renders all six with apply working
- Applying a template updates the user's dashboard layout correctly
- Tracking event fires on apply

Commit with: `[tpl] six archetypal templates with picker UI`

Report commit hash. Stop. Wait for go-ahead.
