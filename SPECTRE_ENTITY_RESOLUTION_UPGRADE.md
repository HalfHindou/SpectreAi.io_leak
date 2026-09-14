# SPECTRE — ENTITY RESOLUTION & CONTEXT MANAGEMENT UPGRADE

> **The real problem:** Rules in markdown don't enforce themselves. Claude Code reads the spec, writes code that still passes raw queries to Perplexity, and Perplexity finds the wrong entity. The fix is not more documentation — it is an actual code layer that blocks the query from reaching Perplexity until the entity is confirmed. This document specifies that layer in implementable detail.

---

## PART 1 — WHY THE SPEC DIDN'T WORK

When Claude Code reads a spec and writes code, it treats the spec as guidance. It does not automatically create hard execution gates. The current flow is:

```
User types "Neural AI"
      ↓
Code calls perplexity.search("Neural AI")    ← no gate
      ↓
Perplexity returns first result for "Neural AI"
which happens to be a non-crypto neuroscience company
      ↓
Agent writes article about wrong entity
```

The spec said "run disambiguation first." Claude Code heard that, wrote a `disambiguate()` function, but never called it before the Perplexity call. Functions that aren't called don't run.

**The fix is not a better spec. The fix is making Perplexity unreachable without passing through entity resolution first.**

```
User types "Neural AI"
      ↓
EntityResolver.resolve(query)          ← BLOCKS until resolved
      ↓
Resolution: { name: "NeuralAI", ticker: "$NEURAL", 
              type: "crypto", contract: "0x...", 
              coingeckoId: "neural-ai",
              confidence: "confirmed" }
      ↓
Only now is Perplexity called — with the resolved entity injected:
perplexity.search("NeuralAI $NEURAL crypto on-chain research platform")
```

---

## PART 2 — THE ENTITY RESOLVER (actual code to implement)

### File: `server/agents/entityResolver.js`

This file is the gate. Nothing passes to Perplexity without going through it.

```javascript
// server/agents/entityResolver.js
// ═══════════════════════════════════════════════════════════════
// ENTITY RESOLUTION GATE
// Every query passes through resolveEntities() before any external
// API call. If resolution fails with high confidence, the query
// returns a disambiguation prompt to the user instead of a wrong result.
// ═══════════════════════════════════════════════════════════════

import { ENTITY_DATABASE } from './entityDatabase.js';

export async function resolveEntities(rawQuery) {
  // 1. Extract candidate names + tickers from query
  const candidates = extractCandidates(rawQuery);

  const resolved = [];
  const needsDisambiguation = [];

  for (const candidate of candidates) {
    const match = await resolveCandidate(candidate);

    if (match.confidence === 'confirmed') {
      resolved.push(match);
    } else if (match.confidence === 'ambiguous') {
      needsDisambiguation.push({ candidate, options: match.options });
    } else {
      // unknown — let Perplexity find it but inject crypto context
      resolved.push({
        ...candidate,
        confidence: 'unknown',
        perplexityHint: `${candidate.raw} cryptocurrency token OR blockchain project`,
      });
    }
  }

  return {
    resolved,
    needsDisambiguation,
    canProceed: needsDisambiguation.length === 0,
    // If canProceed is false, return disambiguation UI to user before searching
  };
}

async function resolveCandidate(candidate) {
  const { raw, ticker, name } = candidate;

  // ── Check 1: Exact ticker match in database ──────────────────
  if (ticker) {
    const normalized = normalizeTicker(ticker); // SPECT → SPECTRE
    const dbMatch = ENTITY_DATABASE.byTicker[normalized];
    if (dbMatch) return { ...dbMatch, confidence: 'confirmed', matchedBy: 'ticker' };
  }

  // ── Check 2: Exact name match in database ────────────────────
  if (name) {
    const normalized = name.toLowerCase().trim();
    const dbMatch = ENTITY_DATABASE.byName[normalized];
    if (dbMatch) return { ...dbMatch, confidence: 'confirmed', matchedBy: 'name' };
  }

  // ── Check 3: Fuzzy name match (catches "Neural AI" vs "NeuralAI") ──
  const fuzzyMatch = fuzzySearchDatabase(raw, threshold = 0.85);
  if (fuzzyMatch) return { ...fuzzyMatch, confidence: 'confirmed', matchedBy: 'fuzzy' };

  // ── Check 4: Check for known ambiguous names ──────────────────
  const ambiguous = ENTITY_DATABASE.ambiguous[raw.toLowerCase()];
  if (ambiguous) {
    return {
      confidence: 'ambiguous',
      options: ambiguous,
      // Returns list of possible matches — UI shows disambiguation picker
    };
  }

  // ── Check 5: CoinGecko search as verification ─────────────────
  // Before giving up, try CoinGecko search — it's fast and authoritative
  const cgResult = await searchCoinGecko(raw);
  if (cgResult && cgResult.confidence > 0.8) {
    // Add to database cache so next query is instant
    await cacheEntity(cgResult);
    return { ...cgResult, confidence: 'confirmed', matchedBy: 'coingecko' };
  }

  // ── Unknown — proceed with crypto context injection ───────────
  return {
    raw,
    confidence: 'unknown',
    type: 'crypto', // assume crypto since this is a crypto platform
    perplexityHint: `${raw} cryptocurrency token blockchain project 2024 2025`,
  };
}
```

---

### File: `server/agents/entityDatabase.js`

This is the source of truth. Every confirmed entity is here. The database grows automatically as users search — confirmed results from CoinGecko get cached. Unknown entities that resolve via CoinGecko get added permanently.

```javascript
// server/agents/entityDatabase.js
// Hand-curated entries for known entities + auto-populated cache from CoinGecko

export const ENTITY_DATABASE = {

  // ── TICKER INDEX ─────────────────────────────────────────────
  // Key: normalized ticker (no $, uppercase)
  // Value: full entity object
  byTicker: {

    'SPECTRE': {
      name:         'Spectre AI',
      ticker:       'SPECTRE',
      aliases:      ['SPECT'],          // $SPECT normalizes to this entry
      type:         'crypto',
      category:     'ai-tools',
      coingeckoId:  'spectre-ai',
      chain:        'ethereum',
      website:      'https://spectreai.io',
      xHandle:      '@SpectreAI_io',
      isInternal:   true,               // triggers self-query handler
      notToBe: [
        'Spectre.Ai (binary options, Cayman Islands)',
        'Spectral SPEC (zkML)',
        'Spectre Network SPR (blockDAG)',
        'SPECTRE AI LTD UK company listing (advertising SIC code — ignore)',
      ],
    },

    'NEURAL': {
      name:         'NeuralAI',
      ticker:       'NEURAL',
      aliases:      [],
      type:         'crypto',
      category:     'ai-tools,gaming',
      coingeckoId:  'neural-ai',
      chain:        'ethereum',
      website:      'https://goneural.ai',
      xHandle:      '@GoNeuralAI',
      notToBe: [
        'Neural AI (neuroscience company, unrelated)',
        'Neural.love (AI art generator, unrelated)',
        'Neural Concept (engineering simulation, unrelated)',
        // "Neural AI" is a common phrase — always require $NEURAL or "NeuralAI" (one word)
        // to confirm crypto intent before searching
      ],
      requiresCryptoContext: true, // ambiguous name — must inject crypto context
    },

    'ZIG': {
      name:         'ZigChain',
      ticker:       'ZIG',
      aliases:      ['ZIGNALY'],
      type:         'crypto',
      category:     'rwa,infrastructure',
      coingeckoId:  'zignaly',
      chain:        'cosmos',
      website:      'https://zigchain.com',
      xHandle:      '@ZigChain',
    },

    'BTC': {
      name:         'Bitcoin',
      ticker:       'BTC',
      aliases:      ['BITCOIN', 'XBT'],
      type:         'crypto',
      coingeckoId:  'bitcoin',
      notToBe: [],
    },

    'ETH': {
      name:         'Ethereum',
      ticker:       'ETH',
      aliases:      ['ETHER', 'ETH2', 'WETH'],
      type:         'crypto',
      coingeckoId:  'ethereum',
    },

    'SOL': {
      name:         'Solana',
      ticker:       'SOL',
      aliases:      ['SOLANA'],
      type:         'crypto',
      coingeckoId:  'solana',
    },

    'POL': {
      name:         'Polygon',
      ticker:       'POL',
      aliases:      ['MATIC', 'POLYGON'],  // MATIC → POL after 2024 rebrand
      type:         'crypto',
      coingeckoId:  'matic-network',
    },

    // ── STOCKS ─────────────────────────────────────────────────
    'AAPL': {
      name:         'Apple Inc.',
      ticker:       'AAPL',
      type:         'stock',
      exchange:     'NASDAQ',
      notToBe: [],
    },

    'NVDA': {
      name:         'NVIDIA Corporation',
      ticker:       'NVDA',
      type:         'stock',
      exchange:     'NASDAQ',
    },

    // Add more as they're searched. CoinGecko cache auto-populates crypto entries.
  },

  // ── NAME INDEX ───────────────────────────────────────────────
  // Key: lowercase project name (no spaces normalized)
  byName: {
    'spectre ai':    'SPECTRE',
    'spectreai':     'SPECTRE',
    'neural ai':     'NEURAL',   // maps but sets requiresCryptoContext
    'neurai':        'NEURAL',
    'zigchain':      'ZIG',
    'bitcoin':       'BTC',
    'ethereum':      'ETH',
    'solana':        'SOL',
    'polygon':       'POL',
    'matic':         'POL',
    // name → ticker symbol, then byTicker[symbol] gives full entity
  },

  // ── AMBIGUOUS NAMES ──────────────────────────────────────────
  // Names that match multiple real entities — show disambiguation UI
  ambiguous: {
    'luna': [
      { name: 'Terra Luna Classic', ticker: 'LUNC', hint: 'original Terra collapse token' },
      { name: 'Terra Luna 2.0',     ticker: 'LUNA', hint: 'post-collapse rebrand' },
    ],
    'link': [
      { name: 'Chainlink',  ticker: 'LINK', hint: 'oracle network' },
      // others if needed
    ],
    'core': [
      { name: 'Core DAO',        ticker: 'CORE',  hint: 'BTC-aligned L1' },
      { name: 'Core Scientific', ticker: 'CORZ',  hint: 'US-listed Bitcoin miner, stock' },
    ],
    'nova': [
      { name: 'SuperNova', ticker: 'NOVA', hint: 'check chain' },
      // multiple projects — ask user to specify chain
    ],
    'ai': [
      // "AI" alone is too generic — always ask for more context
      { name: 'Specify project name', hint: 'AI matches hundreds of projects' },
    ],
  },

  // ── TICKER NORMALIZATION MAP ─────────────────────────────────
  // Wrong → Correct. Checked before any lookup.
  tickerAliases: {
    'SPECT':   'SPECTRE',
    '$SPECT':  'SPECTRE',
    'SPEC':    null,   // Spectral (zkML) — different project, no redirect
    'SPR':     null,   // Spectre Network — different project, no redirect
    'ETH2':    'ETH',
    'WETH':    'ETH',
    'WBTC':    'BTC',
    'WBNB':    'BNB',
    'WSOL':    'SOL',
    'MATIC':   'POL',
    'LUNC':    'LUNC', // explicit — don't redirect to LUNA
    'LUNA2':   'LUNA',
    'XBT':     'BTC',
  },
};

// Auto-cache function — when CoinGecko confirms an entity, add it
export async function cacheEntity(cgData) {
  const entry = {
    name:        cgData.name,
    ticker:      cgData.symbol.toUpperCase(),
    type:        'crypto',
    coingeckoId: cgData.id,
    chain:       cgData.asset_platform_id || 'ethereum',
    website:     cgData.links?.homepage?.[0],
    cachedAt:    Date.now(),
  };
  ENTITY_DATABASE.byTicker[entry.ticker] = entry;
  ENTITY_DATABASE.byName[entry.name.toLowerCase()] = entry.ticker;
  await persistDatabaseCache(); // write to entities-cache.json
}
```

---

### File: `server/agents/perplexityGate.js`

This is the actual enforcement layer. Perplexity is not called anywhere else in the codebase. Every Perplexity call goes through `gatedPerplexitySearch()`.

```javascript
// server/agents/perplexityGate.js
// ═══════════════════════════════════════════════════════════════
// THE GATE. Perplexity is ONLY called from here.
// Any other direct Perplexity calls in the codebase must be
// refactored to go through this function.
// ═══════════════════════════════════════════════════════════════

import { resolveEntities } from './entityResolver.js';

export async function gatedPerplexitySearch(rawQuery, options = {}) {

  // ── STEP 1: RESOLVE ENTITIES ──────────────────────────────────
  const resolution = await resolveEntities(rawQuery);

  // ── STEP 2: BLOCK IF DISAMBIGUATION NEEDED ────────────────────
  if (!resolution.canProceed) {
    // Return disambiguation options to UI — don't search yet
    return {
      type: 'NEEDS_DISAMBIGUATION',
      options: resolution.needsDisambiguation,
      message: buildDisambiguationMessage(resolution.needsDisambiguation),
    };
  }

  // ── STEP 3: BUILD HARDENED QUERY ─────────────────────────────
  // Inject confirmed entity context so Perplexity cannot mistake the entity
  const hardenedQuery = buildHardenedQuery(rawQuery, resolution.resolved);

  // ── STEP 4: INJECT CRYPTO CONTEXT WHERE NEEDED ───────────────
  // Entities with requiresCryptoContext always get blockchain context injected
  const contextInjections = resolution.resolved
    .filter(e => e.requiresCryptoContext || e.confidence === 'unknown')
    .map(e => e.perplexityHint || `${e.name} ${e.ticker} cryptocurrency blockchain`)
    .join('. ');

  const finalQuery = contextInjections
    ? `${hardenedQuery}. Context: ${contextInjections}`
    : hardenedQuery;

  // ── STEP 5: INJECT NOT-TO-BE EXCLUSIONS ──────────────────────
  const exclusions = resolution.resolved
    .flatMap(e => e.notToBe || [])
    .filter(Boolean);

  const systemPromptAddition = exclusions.length > 0
    ? `IMPORTANT: This query is about specific entities. Explicitly exclude these unrelated 
       entities from your response: ${exclusions.join('; ')}.
       If search results are about these excluded entities, ignore them entirely.`
    : '';

  // ── STEP 6: EXECUTE SEARCH ────────────────────────────────────
  return await perplexity.search(finalQuery, {
    ...options,
    systemPromptAddition,
    resolvedEntities: resolution.resolved, // pass downstream for citation validation
  });
}

function buildHardenedQuery(rawQuery, resolvedEntities) {
  let hardened = rawQuery;

  for (const entity of resolvedEntities) {
    if (entity.matchedBy === 'ticker' && entity.aliases?.length > 0) {
      // Replace wrong ticker aliases with canonical name + ticker
      entity.aliases.forEach(alias => {
        hardened = hardened.replace(
          new RegExp(`\\$?${alias}\\b`, 'gi'),
          `${entity.name} ($${entity.ticker})`
        );
      });
    }
  }

  return hardened;
}

function buildDisambiguationMessage(ambiguousItems) {
  const messages = ambiguousItems.map(item => {
    const options = item.options.map((o, i) =>
      `${i + 1}. ${o.name} (${o.ticker || 'no ticker'}) — ${o.hint}`
    ).join('\n');
    return `"${item.candidate.raw}" could mean:\n${options}`;
  });
  return messages.join('\n\n') + '\n\nWhich did you mean?';
}
```

---

### Migration: Replace All Direct Perplexity Calls

Claude Code must grep the entire codebase for direct Perplexity calls and replace them:

```bash
# Find every direct Perplexity call
grep -rn "perplexity\.\|sonar-pro\|sonar-medium\|sonar-small" \
  apps/ server/ --include="*.js" --include="*.ts" --include="*.jsx"

# Every result must be refactored to go through gatedPerplexitySearch()
# No exceptions. This is the entire enforcement mechanism.
```

**Before:**
```javascript
// newsWriterAgent.js — WRONG
const result = await perplexity.search(query);
```

**After:**
```javascript
// newsWriterAgent.js — CORRECT
import { gatedPerplexitySearch } from '../agents/perplexityGate.js';
const result = await gatedPerplexitySearch(query);
```

---

### Disambiguation UI Component

When resolution returns `NEEDS_DISAMBIGUATION`, the frontend shows this instead of searching:

```jsx
// components/DisambiguationPicker.jsx
// Shown when a query matches multiple entities

function DisambiguationPicker({ options, onSelect }) {
  return (
    <div className="disambiguation-card">
      <p className="disambiguation-prompt">Which did you mean?</p>
      {options.map(opt => (
        <button
          key={opt.ticker || opt.name}
          className="disambiguation-option"
          onClick={() => onSelect(opt)}
        >
          <span className="option-name">{opt.name}</span>
          {opt.ticker && (
            <span className="option-ticker">${opt.ticker}</span>
          )}
          <span className="option-hint">{opt.hint}</span>
        </button>
      ))}
    </div>
  );
}
```

```css
.disambiguation-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--sp-5);
  margin-top: var(--sp-4);
}
.disambiguation-prompt {
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: var(--sp-3);
}
.disambiguation-option {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: transparent;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  margin-bottom: var(--sp-2);
}
.disambiguation-option:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}
.option-name  { color: var(--text-primary); font-weight: 600; flex: 1; }
.option-ticker { font-family: var(--font-mono); color: var(--accent); font-size: 12px; }
.option-hint  { color: var(--text-muted); font-size: 12px; }
```

---

## PART 3 — CONTEXT WINDOW MANAGEMENT SKILL

The CSS file that exceeded 25,000 tokens is a symptom of a broader problem: Claude Code regularly hits context limits mid-task, loses state, and produces partial or inconsistent work. A context window management system prevents this.

### `skills/operations/context-manager/SKILL.md`

```markdown
# Context Window Management Skill

## WHAT THIS SKILL DOES
Manages Claude Code's working context across large codebases.
Prevents context overflow, preserves task state across sessions,
and ensures large files are read intelligently rather than entirely.

## THE CORE PROBLEM
Claude Code has a ~200K token context window. A large codebase uses it all.
When context fills:
- Claude loses track of earlier files it read
- It starts producing code that conflicts with what it already wrote
- It cannot complete multi-file tasks in one session
- It hallucinates file contents it no longer has in context

## RULE 0: NEVER READ AN ENTIRE LARGE FILE
If a file is over 500 lines, do not read it entirely.
Always use offset + limit parameters, or grep for specific content first.

## THE FOUR STRATEGIES

### Strategy 1: Grep Before Read
Always search for what you need before reading entire files.

WRONG:
  read entire search-engine-page.css (37,587 tokens — immediately overflows)

CORRECT:
  grep "breaking-banner\|notification\|.search-" search-engine-page.css
  Then read only the 20-30 lines containing what you need.

### Strategy 2: File Map First
Before starting any multi-file task, build a mental map of the codebase
without reading file contents. Use directory listings only.

  ls -la src/pages/search-engine/components/
  → See 12 files, understand structure
  → Decide which 3 files are actually relevant to the task
  → Read only those 3

### Strategy 3: Session Checkpoint Files
For tasks spanning multiple sessions or many files, write a checkpoint
file before context fills. This file is read at the start of the next session.

Format: /tmp/spectre-task-checkpoint.md
Contents:
  - Task: what we're building
  - Completed: what files were modified and what was changed
  - In Progress: what was being worked on when context hit limit
  - Next: exact next action to take
  - Key decisions: architectural choices made so far that must not be reversed

### Strategy 4: Surgical Edits
Never rewrite a large file to make a small change.
Use str_replace_editor to change only the specific lines that need changing.

WRONG: Rewrite all 600 lines of search-engine-page.css to add one class
CORRECT: grep for the insertion point, use str_replace to add 5 lines

## CONTEXT BUDGET BY TASK TYPE

| Task | Context Budget | Strategy |
|------|----------------|----------|
| Bug fix | 10-20K tokens | Grep target, read surrounding 50 lines, fix |
| New component | 30-50K tokens | Read design system + 2 reference components |
| New agent | 50-80K tokens | Read existing agent + spec section + data interfaces |
| Full feature | 100-150K tokens | Split into sessions with checkpoints |
| Codebase audit | Never in one session | Always split, use file map + grep |

## LARGE FILE PROTOCOL

When any file exceeds 500 lines:

1. Run: wc -l {filename}  → confirm size
2. Run: grep -n "section headers\|export\|class\|function" {filename} | head -50
   → get structural overview without reading content
3. Decide: which section do you actually need?
4. Read: use offset + limit to read only that section
5. Never: read the entire file into context

For CSS files specifically:
  grep -n "\.{component-name}" file.css   → find the component's styles
  Read lines ±20 around each match only

## WHAT TO DO WHEN CONTEXT IS NEARLY FULL

Signs you're approaching context limit:
- Response starts referencing files that were read much earlier incorrectly
- You start suggesting changes that contradict decisions made earlier in session
- Tool calls start failing unexpectedly

When you notice this:
1. STOP adding new information to context
2. Write a checkpoint file with current state
3. Complete only the immediate current task
4. Tell the user: "Context is approaching limit. I've written a checkpoint
   to /tmp/spectre-task-checkpoint.md. Start a new session and I'll
   pick up exactly where we left off."

## CHECKPOINT FILE FORMAT

```
# SPECTRE TASK CHECKPOINT
Generated: {timestamp}
Task: {one sentence description}

## COMPLETED
- Modified server/agents/entityResolver.js — added NEURAL to database
- Modified server/agents/perplexityGate.js — added exclusion injection
- Created server/agents/entityDatabase.js — full entity database

## IN PROGRESS
- Adding disambiguationPicker component
- Got as far as: wrote the JSX, need to write the CSS

## NEXT ACTION
Read: src/components/ui/ for existing card patterns
Then: Create DisambiguationPicker.jsx following glass card pattern
Then: Add CSS to search-engine-page.css at line ~450 (after .quick-intel section)

## KEY DECISIONS (do not reverse)
- Entity database is in entityDatabase.js, not inline in entityResolver.js
- All Perplexity calls go through perplexityGate.js — no exceptions
- Disambiguation returns before search, not after bad results

## FILES MODIFIED THIS SESSION
- server/agents/entityResolver.js
- server/agents/entityDatabase.js  
- server/agents/perplexityGate.js
```
```

---

## PART 4 — DOCUMENTATION GENERATION SYSTEM

Your developers need documentation. The smart approach is not to write docs manually — it is to have an agent generate them from the actual code, and keep them in sync automatically.

### `skills/operations/documentation-writer/SKILL.md`

```markdown
# Documentation Writer Skill

## WHAT THIS SKILL DOES
Generates and maintains developer documentation from actual source code.
Runs after significant code changes. Output lives in /docs/.

## DOCUMENTATION TYPES

### 1. API Reference (auto-generated)
Source: Express route files (app.get, app.post, etc.)
Output: /docs/API_REFERENCE.md
Format: Endpoint, method, auth required, params, response shape, example

### 2. Component Library
Source: src/components/**/*.jsx
Output: /docs/COMPONENTS.md
Format: Component name, props, usage example, screenshot path

### 3. Agent Playbook
Source: server/agents/*.js
Output: /docs/AGENTS.md
Format: Agent name, trigger, inputs, outputs, external APIs called, failure behavior

### 4. Data Flow Diagram
Source: server/agents/ + server/index.js
Output: /docs/DATA_FLOW.md
Format: Mermaid diagram showing how data moves from API call → agent → database → client

### 5. Environment Variables
Source: All process.env references in codebase
Output: /docs/ENV_VARS.md
Format: Variable name, required/optional, which agent uses it, example value (never real values)

### 6. Onboarding Guide
Source: package.json + .env.example + README
Output: /docs/ONBOARDING.md
Format: Step by step — clone, install, configure env, seed database, start dev server

## HOW TO GENERATE

Run after any significant session:

  Task: "Update the API reference documentation based on what changed this session"

The agent:
1. Reads all Express route files (grep for app.get, app.post, router.get etc.)
2. For each route: extracts path, method, middleware (auth level), params, response
3. Writes structured markdown to /docs/API_REFERENCE.md
4. Appends CHANGELOG.md with what changed

## DOCUMENTATION QUALITY RULES
- Every endpoint must have an example request and example response
- Every agent must document what happens on failure (not just success)
- Every component must document its required vs optional props
- Version stamp every doc with the date it was generated
- If a function has no comments, document what it does from reading the code — never skip it
```

### Immediate Documentation Priorities

Given your devs need docs now, run these tasks in order with Claude Code:

```bash
# Task 1: API surface (highest priority for devs)
"Read all files in server/ that define Express routes.
 Generate /docs/API_REFERENCE.md documenting every endpoint —
 path, method, auth required, request params, response shape.
 Use offset+limit to read large files, never read entire files."

# Task 2: Agent map (second priority)  
"Read all files in server/agents/. For each agent:
 document what triggers it, what APIs it calls, what it returns,
 and what happens when it fails. Output to /docs/AGENTS.md."

# Task 3: Environment variables
"Grep the entire codebase for process.env.
 List every environment variable, which file uses it, whether it's required.
 Output to /docs/ENV_VARS.md with an .env.example template."

# Task 4: Component library
"Read src/components/ directory structure.
 For each component file, extract the props interface and write a usage example.
 Output to /docs/COMPONENTS.md."
```

---

## PART 5 — IMPLEMENTATION ORDER

```
WEEK 1 — Entity Resolution (ship this before anything else)

Day 1:
  - Create server/agents/entityDatabase.js with all entries above
  - Create server/agents/entityResolver.js
  - Create server/agents/perplexityGate.js

Day 2:
  - Grep entire codebase for direct Perplexity calls
  - Refactor every one to go through perplexityGate.js
  - Test: search "Neural AI" → should hit NeuralAI crypto
  - Test: search "$SPECT" → should route to self-query handler
  - Test: search "LUNA" → should show disambiguation UI

Day 3:
  - Create DisambiguationPicker.jsx component
  - Wire to search results in search-engine-page.jsx
  - Test end-to-end: ambiguous query → picker → correct result

WEEK 1 — Context Management + Docs (parallel)

  - Add context-manager skill file to skills/operations/
  - Run API documentation generation task
  - Run agent documentation generation task
  - Run ENV_VARS documentation task

WEEK 2+ — Entity Database Growth
  - Every new token that returns a wrong result → add to database
  - Set up CoinGecko cache auto-population
  - Add KNOWN_AMBIGUITIES entries as they're discovered
```

---

## THE RULE THAT MAKES ALL OF THIS WORK

**Perplexity is a library, not a service. You call a library. You go through a service.**

Right now Perplexity is treated like a library — any agent can call it directly. Make it a service: one file, one function, one gate. No other file in the codebase imports from Perplexity directly. They all import from `perplexityGate.js`.

When the gate is the only entry point, every fix to entity resolution automatically applies to every agent — the news writer, the thesis generator, the quick intel, the breaking news detector — without touching any of them individually.

That is the universal fix.

---

*Spectre AI — Entity Resolution & Context Management Upgrade*
*February 2026*
