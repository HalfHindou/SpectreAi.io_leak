# YOU V2 — REGISTRY SPEC

The capability registry is the foundation. Every other phase depends on this.

If the registry is wrong or incomplete, templates are arbitrary, the composer hallucinates, and tracking events are mislabeled. Get this right.

---

## What is the registry

A single source of truth that describes every widget, signal, and data surface available in the You page. Machine-readable. Checked into the repo. Validated.

It is the input to:
- Templates (which widgets to include)
- Composer (what the agent can choose from)
- Tracking (canonical widget ids)
- Suggestion engine (later)
- Public docs (later)

---

## File locations

- `/src/registry/widgets.json` — canonical widget catalog
- `/src/registry/types.ts` — TypeScript schema definitions
- `/src/registry/index.js` — helper functions: `getWidget(id)`, `getByCategory(cat)`, `getByTier(tier)`, `search(query)`, `validate(json)`

---

## Widget schema

Every widget entry must include all fields below.

```typescript
interface WidgetEntry {
  id: string;                    // kebab-case, stable, never reused
  name: string;                  // display name
  description: string;           // one sentence, founder voice
  category: WidgetCategory[];    // one or more from the canonical list
  data_source: {
    type: 'brain' | 'consciousness' | 'spectre_api' | 'external';
    endpoint: string;            // path or signal name
    refresh_interval_ms: number; // how often it pulls
  };
  tier: 0 | 500 | 1000 | 7000;   // 0 = free, others = $SPECTRE token gate
  required_props: Record<string, string>; // e.g. { token_address: 'string' }
  default_props: Record<string, any>;
  default_size: { w: number; h: number };  // grid units
  min_size: { w: number; h: number };
  max_size?: { w: number; h: number };
  companions: string[];          // suggested pairings by widget id
  use_cases: string[];           // for composer reasoning, plain English
  tags: string[];                // free-form for search
}
```

---

## Canonical category list

Use only these. If a widget needs a new category, add it to the list and document why.

- `onchain`
- `perps`
- `social`
- `narrative`
- `rwa`
- `derivatives`
- `whale`
- `dex`
- `cex`
- `macro`
- `sentiment`
- `agent`
- `brain`
- `portfolio`

---

## Build process

### Step 1: Audit
List every widget that currently renders on the You page. Walk the source. Do not miss any.

Output a working list to `/home/claude/scratch/widget-audit.txt` with: file path, component name, what data it pulls, current visual state.

### Step 2: Register
For each widget in the audit, create a complete entry in `widgets.json`. Use the schema. Fill every field. Do not leave fields empty.

### Step 3: Build helpers
Implement `/src/registry/index.js` with:
- `getWidget(id)` returns entry or `null`
- `getByCategory(category)` returns array
- `getByTier(maxTier)` returns array of widgets at or below the user's tier
- `search(query)` returns array, matches name/description/tags case-insensitively
- `validate(json)` returns `{ valid: bool, errors: string[] }`, runs at build time

### Step 4: Identify gaps
After registering everything that exists, list the top 5 widgets that should exist given Spectre's accumulated data but are not built yet. Add them as DRAFT entries with `status: 'planned'` and a one-line note. Do not build them today.

### Step 5: Validate
Run `validate()` on the full catalog. Zero errors required to ship.

---

## Sample entry

```json
{
  "id": "whale-tracker",
  "name": "Whale Tracker",
  "description": "Live large-wallet flows for tokens you watch.",
  "category": ["onchain", "whale"],
  "data_source": {
    "type": "brain",
    "endpoint": "/brain/whale-flows",
    "refresh_interval_ms": 30000
  },
  "tier": 1000,
  "required_props": {},
  "default_props": {
    "min_usd_value": 100000,
    "lookback_hours": 24
  },
  "default_size": { "w": 6, "h": 4 },
  "min_size": { "w": 4, "h": 3 },
  "max_size": { "w": 12, "h": 8 },
  "companions": ["exchange-flows", "smart-money", "address-watchlist"],
  "use_cases": [
    "Track institutional accumulation in real time",
    "Spot distribution before retail catches on",
    "Validate or reject narrative trades using whale behavior"
  ],
  "tags": ["whales", "smart-money", "flows", "institutional"]
}
```

---

## Existence check before starting

Run this before building. If anything exists already, report and stop.

```bash
ls -la src/registry/ 2>/dev/null
test -f src/registry/widgets.json && echo "EXISTS: widgets.json" || echo "NOT FOUND: widgets.json"
test -f src/registry/index.js && echo "EXISTS: index.js" || echo "NOT FOUND: index.js"
```

If `widgets.json` exists with content, audit it for completeness against the existing You page widgets. Do not overwrite. Extend.

---

## Stop condition

Phase 0 is complete when:
- `widgets.json` contains every existing You page widget with all schema fields populated
- `index.js` exports all five helper functions and they pass basic tests
- `validate()` returns zero errors on the full catalog
- A `widgets.json` audit comment notes how many widgets are registered and how many are planned

Commit with: `[reg] capability registry: N widgets registered, M planned`

Report commit hash. Stop. Wait for go-ahead on next phase.
