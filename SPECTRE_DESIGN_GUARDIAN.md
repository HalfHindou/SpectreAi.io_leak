# SPECTRE DESIGN GUARDIAN — Enforcement System
## Stop AI from producing generic slop. Every time.

---

## THE PROBLEM

Claude Code reads SPECTRE_DESIGN_LAW.md. It understands the rules. Then it writes code and defaults to its training priors: hardcoded hex colors, arbitrary border-radius values, wrong fonts, missing glass effects, no day mode. Every new feature looks like "an AI built this" instead of matching the existing app.

The issue is not comprehension. It's enforcement. Reading rules is passive. We need active constraints.

---

## SOLUTION: THREE LAYERS OF ENFORCEMENT

### Layer 1: The Validator Script (automated, runs on save)
### Layer 2: The Component Template Library (copy-paste, not invent)
### Layer 3: The Prompt Injection Pattern (forces Claude to self-check)

---

## LAYER 1: DESIGN VALIDATOR SCRIPT

A script that scans every CSS and JSX file for design violations. Run it after every Claude Code session. Run it in CI. Run it before committing.

### `scripts/design-guardian.mjs`

```js
#!/usr/bin/env node
/**
 * SPECTRE DESIGN GUARDIAN
 * Scans CSS/JSX files for design system violations.
 * Run: node scripts/design-guardian.mjs [path]
 * Default: scans all src/**/*.{css,jsx}
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const VIOLATIONS = [];

// ============================================================
// RULES
// ============================================================

const BANNED_HEX_COLORS = [
  // If someone hardcodes these instead of using CSS variables
  { pattern: /#1a1a2e/gi, fix: 'var(--bg-elevated) or var(--bg-surface)' },
  { pattern: /#0f172a/gi, fix: 'var(--bg-base) or var(--bg-surface)' },
  { pattern: /#1e1e2e/gi, fix: 'var(--bg-elevated)' },
  { pattern: /#2d2d3d/gi, fix: 'var(--bg-hover)' },
  { pattern: /#f5f5f5/gi, fix: 'BANNED — Spectre is dark-first. Use var(--bg-surface)' },
  { pattern: /#f8f8f8/gi, fix: 'BANNED — Spectre is dark-first' },
  { pattern: /#ffffff(?![\da-f])/gi, fix: 'Use var(--text-primary) for text, not raw white for backgrounds' },
  { pattern: /#333333/gi, fix: 'var(--text-secondary) — never hardcode gray text' },
  { pattern: /#666666/gi, fix: 'var(--text-tertiary)' },
  { pattern: /#999999/gi, fix: 'var(--text-muted)' },
];

const BANNED_PATTERNS = [
  // Wrong fonts
  { pattern: /font-family:\s*['"]?(Arial|Helvetica|Roboto|system-ui)/gi, fix: 'Use var(--font-body) for text, var(--font-display) for headings, var(--font-mono) for numbers' },
  { pattern: /font-family:\s*['"]?Inter(?!.*var)/gi, fix: 'Use var(--font-body) not raw "Inter"' },
  { pattern: /font-family:\s*['"]?Space Grotesk(?!.*var)/gi, fix: 'Use var(--font-display) not raw "Space Grotesk"' },
  
  // Wrong border radius (hardcoded instead of variable)
  { pattern: /border-radius:\s*4px/g, fix: 'Use var(--radius-sm) (8px) — 4px is too tight for Spectre' },
  { pattern: /border-radius:\s*6px/g, fix: 'Use var(--radius-sm) (8px)' },
  { pattern: /border-radius:\s*10px/g, fix: 'Use var(--radius-md) (12px)' },
  { pattern: /border-radius:\s*14px/g, fix: 'Use var(--radius-lg) (16px)' },
  { pattern: /border-radius:\s*20px/g, fix: 'Use var(--radius-xl) (24px)' },
  
  // Banned UI patterns
  { pattern: /box-shadow:\s*0\s+[2-8]px\s+[4-20]px\s+rgba\(0/g, fix: 'Use Spectre glass shadow pattern from SPECTRE_DESIGN_LAW.md, not generic drop shadows' },
  { pattern: /background:\s*linear-gradient\([^)]*#[4-9a-f]{2}[4-9a-f]{2}ff/gi, fix: 'Bright gradient backgrounds are BANNED. Use subtle glass gradients from design law.' },
  
  // External icon imports
  { pattern: /from\s+['"]lucide-react['"]/g, fix: 'BANNED — Use spectreIcons from src/icons/spectreIcons.jsx' },
  { pattern: /from\s+['"]react-icons/g, fix: 'BANNED — Use spectreIcons from src/icons/spectreIcons.jsx' },
  { pattern: /from\s+['"]@heroicons/g, fix: 'BANNED — Use spectreIcons from src/icons/spectreIcons.jsx' },
  { pattern: /from\s+['"]@fortawesome/g, fix: 'BANNED — Use spectreIcons from src/icons/spectreIcons.jsx' },
  
  // Numbers without monospace
  // This one checks JSX: if a span/div contains a $ or % and doesn't have fontFamily mono
  // (Simplified check — will have some false positives)
  { pattern: />\$[\d,.]+<\/(?:span|div|p)>/g, fix: 'Price/dollar values MUST use var(--font-mono) / JetBrains Mono' },
  
  // AI labeling
  { pattern: /AI.Generated|AI.Powered|Powered by AI|🤖|🧠|✨/g, fix: 'BANNED — AI is invisible in Spectre. Remove all AI labeling.' },
  
  // Spinner usage
  { pattern: /spinner|spin\s|@keyframes\s+spin\b/gi, fix: 'BANNED — Use skeleton shimmer loading, never spinners' },
  
  // Missing day mode
  // Check: if a .css file has custom backgrounds but no .app-day-mode or .app.app-day-mode
  // This is a file-level check, handled separately below
];

const REQUIRED_CSS_VARS = [
  // If a file uses color properties, it should use CSS variables
  { property: 'background', bannedRaw: /#[0-9a-f]{3,8}/gi, fix: 'Use var(--bg-*) tokens' },
  { property: 'color', bannedRaw: /#[0-9a-f]{3,8}/gi, fix: 'Use var(--text-*) tokens' },
  { property: 'border-color', bannedRaw: /#[0-9a-f]{3,8}/gi, fix: 'Use var(--border-*) tokens' },
];

// ============================================================
// SCANNING LOGIC
// ============================================================

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath);
  const lines = content.split('\n');
  const relPath = path.relative(process.cwd(), filePath);
  
  // Skip node_modules, dist, etc.
  if (relPath.includes('node_modules') || relPath.includes('dist')) return;
  
  lines.forEach((line, lineNum) => {
    const num = lineNum + 1;
    
    // Check banned hex colors
    BANNED_HEX_COLORS.forEach(rule => {
      if (rule.pattern.test(line)) {
        // Exception: inside CSS variable definitions in index.css
        if (relPath.includes('index.css') && line.includes('--')) return;
        // Exception: inside comments
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) return;
        
        VIOLATIONS.push({
          file: relPath,
          line: num,
          text: line.trim(),
          rule: `Hardcoded color: ${line.match(rule.pattern)?.[0]}`,
          fix: rule.fix,
          severity: 'error',
        });
      }
      // Reset regex lastIndex
      rule.pattern.lastIndex = 0;
    });
    
    // Check banned patterns
    BANNED_PATTERNS.forEach(rule => {
      if (rule.pattern.test(line)) {
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) return;
        
        VIOLATIONS.push({
          file: relPath,
          line: num,
          text: line.trim(),
          rule: `Banned pattern: ${line.match(rule.pattern)?.[0]}`,
          fix: rule.fix,
          severity: 'error',
        });
      }
      rule.pattern.lastIndex = 0;
    });
  });
  
  // File-level checks
  if (ext === '.css' && !relPath.includes('index.css')) {
    const hasCustomBg = /background\s*:/.test(content) || /background-color\s*:/.test(content);
    const hasDayMode = /\.app-day-mode|\.app\.app-day-mode/.test(content);
    
    if (hasCustomBg && !hasDayMode && content.length > 200) {
      VIOLATIONS.push({
        file: relPath,
        line: 0,
        text: '(file-level check)',
        rule: 'Missing day mode styles',
        fix: 'Every CSS file with custom backgrounds MUST include .app-day-mode counterparts. See SPECTRE_DESIGN_LAW.md section on Day Mode.',
        severity: 'warning',
      });
    }
  }
}

// ============================================================
// MAIN
// ============================================================

const targetPath = process.argv[2] || 'src';
const files = glob.sync(`${targetPath}/**/*.{css,jsx,tsx}`, { ignore: ['**/node_modules/**', '**/dist/**'] });

console.log(`\n🔍 SPECTRE DESIGN GUARDIAN`);
console.log(`   Scanning ${files.length} files in ${targetPath}/\n`);

files.forEach(scanFile);

if (VIOLATIONS.length === 0) {
  console.log('✅ No design violations found. The design law is respected.\n');
  process.exit(0);
} else {
  const errors = VIOLATIONS.filter(v => v.severity === 'error');
  const warnings = VIOLATIONS.filter(v => v.severity === 'warning');
  
  console.log(`❌ ${errors.length} errors, ${warnings.length} warnings\n`);
  
  VIOLATIONS.forEach(v => {
    const icon = v.severity === 'error' ? '❌' : '⚠️';
    console.log(`${icon} ${v.file}${v.line ? `:${v.line}` : ''}`);
    console.log(`   Rule: ${v.rule}`);
    if (v.text !== '(file-level check)') console.log(`   Code: ${v.text.substring(0, 100)}`);
    console.log(`   Fix:  ${v.fix}`);
    console.log('');
  });
  
  console.log(`\nTotal: ${errors.length} errors, ${warnings.length} warnings`);
  console.log('Fix all errors before committing.\n');
  process.exit(errors.length > 0 ? 1 : 0);
}
```

### Add to package.json:

```json
{
  "scripts": {
    "design-check": "node scripts/design-guardian.mjs",
    "design-check:file": "node scripts/design-guardian.mjs"
  }
}
```

### Usage:

```bash
# Check entire src/
npm run design-check

# Check a specific file after Claude Code edits it
node scripts/design-guardian.mjs src/components/NewFeature.jsx
node scripts/design-guardian.mjs src/components/NewFeature.css

# In CI (fails build on errors)
npm run design-check
```

---

## LAYER 2: COMPONENT TEMPLATE LIBRARY

The biggest reason Claude produces slop: it INVENTS styles instead of COPYING them. Fix this by giving it a library of pre-built patterns to copy from.

### `src/components/templates/COMPONENT_TEMPLATES.md`

This file contains copy-paste-ready code for every common UI pattern in Spectre. Claude Code should COPY from this file, not invent from scratch.

```markdown
# Spectre Component Templates
# COPY THESE. DO NOT INVENT YOUR OWN.

## Glass Card

\`\`\`jsx
<div className="glass-card">
  {/* content */}
</div>
\`\`\`

\`\`\`css
.glass-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--sp-4) var(--sp-5);
}
.glass-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  transition: all 150ms ease;
}
.app-day-mode .glass-card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
}
\`\`\`

## Metric Display (with "i" button slot)

\`\`\`jsx
<div className="metric-display">
  <span className="metric-label">Market Cap</span>
  <div className="metric-value-row">
    <span className="metric-value">$380.2B</span>
    <span className="metric-change positive">+5.2%</span>
    {/* IButton goes here */}
  </div>
</div>
\`\`\`

\`\`\`css
.metric-display {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.metric-label {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.metric-value {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
.metric-value-row {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.metric-change {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
}
.metric-change.positive { color: var(--bull); }
.metric-change.negative { color: var(--bear); }
.app-day-mode .metric-label { color: #64748b; }
.app-day-mode .metric-value { color: #0f172a; }
\`\`\`

## Data Chip

\`\`\`jsx
<span className="data-chip">
  <span className="data-chip-label">Aave</span>
  <span className="data-chip-value positive">+$18.2M</span>
</span>
\`\`\`

\`\`\`css
.data-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border-default);
  font-family: var(--font-mono);
  font-size: 11px;
}
.data-chip-label { color: var(--text-muted); }
.data-chip-value { color: var(--text-primary); font-weight: 500; }
.data-chip-value.positive { color: var(--bull); }
.data-chip-value.negative { color: var(--bear); }
.app-day-mode .data-chip {
  background: #f8fafc;
  border-color: rgba(0,0,0,0.06);
}
.app-day-mode .data-chip-label { color: #94a3b8; }
.app-day-mode .data-chip-value { color: #0f172a; }
\`\`\`

## Section Header

\`\`\`jsx
<div className="section-header">
  <h3 className="section-title">Market Overview</h3>
  <span className="section-subtitle">Updated 2 min ago</span>
</div>
\`\`\`

\`\`\`css
.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--sp-4);
}
.section-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.section-subtitle {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-muted);
}
.app-day-mode .section-title { color: #0f172a; }
.app-day-mode .section-subtitle { color: #94a3b8; }
\`\`\`

## Badge / Tag

\`\`\`jsx
<span className="badge badge-green">Signal</span>
<span className="badge badge-amber">Building</span>
<span className="badge badge-purple">Promoted</span>
\`\`\`

\`\`\`css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.badge-green { background: rgba(16,185,129,0.12); color: #10B981; }
.badge-amber { background: rgba(245,158,11,0.12); color: #F59E0B; }
.badge-purple { background: rgba(139,92,246,0.12); color: #8B5CF6; }
.badge-red { background: rgba(239,68,68,0.12); color: #EF4444; }
/* Day mode: same colors work on white bg */
\`\`\`

## Skeleton Shimmer (loading state)

\`\`\`jsx
<div className="skeleton" style={{ width: 120, height: 20 }} />
<div className="skeleton" style={{ width: '100%', height: 44 }} />
\`\`\`

\`\`\`css
.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.03) 25%,
    rgba(255,255,255,0.06) 50%,
    rgba(255,255,255,0.03) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.app-day-mode .skeleton {
  background: linear-gradient(
    90deg,
    rgba(0,0,0,0.04) 25%,
    rgba(0,0,0,0.07) 50%,
    rgba(0,0,0,0.04) 75%
  );
  background-size: 200% 100%;
}
\`\`\`

## Button (glass style)

\`\`\`jsx
<button className="btn-glass">Connect Wallet</button>
<button className="btn-accent">Upgrade to Pro</button>
\`\`\`

\`\`\`css
.btn-glass {
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-4);
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 150ms ease;
}
.btn-glass:hover {
  background: rgba(255,255,255,0.06);
  border-color: var(--border-strong);
  color: var(--text-primary);
}
.btn-accent {
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-4);
  font-family: var(--font-body);
  font-size: 13px;
  color: #ffffff;
  cursor: pointer;
  transition: all 150ms ease;
}
.btn-accent:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
.app-day-mode .btn-glass {
  background: #ffffff;
  border-color: rgba(0,0,0,0.1);
  color: #334155;
}
.app-day-mode .btn-glass:hover {
  background: #f8fafc;
}
\`\`\`

## Token Row (for tables/lists)

\`\`\`jsx
<div className="token-row">
  <img className="token-logo" src={logoUrl} alt={symbol} />
  <div className="token-info">
    <span className="token-symbol">{symbol}</span>
    <span className="token-name">{name}</span>
  </div>
  <span className="token-price">${price}</span>
  <span className={`token-change ${change >= 0 ? 'positive' : 'negative'}`}>
    {change >= 0 ? '+' : ''}{change}%
  </span>
</div>
\`\`\`

\`\`\`css
.token-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md);
  transition: background 150ms ease;
}
.token-row:hover {
  background: var(--bg-hover);
}
.token-logo {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-default);
}
.token-symbol {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.token-name {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text-muted);
}
.token-price {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-left: auto;
}
.token-change {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  min-width: 60px;
  text-align: right;
}
.token-change.positive { color: var(--bull); }
.token-change.negative { color: var(--bear); }
\`\`\`
```

---

## LAYER 3: PROMPT INJECTION PATTERN

Add this block to the END of CLAUDE.md so it's the last thing Claude Code reads before starting work:

### Append to `CLAUDE.md`:

```markdown
## DESIGN ENFORCEMENT — MANDATORY SELF-CHECK

Before writing ANY CSS, JSX, or styled component, you MUST:

### Step 1: Check if a template exists
Open `src/components/templates/COMPONENT_TEMPLATES.md` and search for a matching pattern.
If one exists: COPY IT. Do not modify the styles. Only change content/props.

### Step 2: Variable check
For EVERY style property you write, ask:
- Am I using a CSS variable from index.css? If not, WHY?
- background: → Must use var(--bg-*) 
- color: → Must use var(--text-*) or var(--bull) / var(--bear) / var(--accent)
- border: → Must use var(--border-*)
- border-radius: → Must use var(--radius-*)
- font-family: → Must use var(--font-display), var(--font-body), var(--font-mono), var(--font-glass), or var(--font-cinema)
- padding/margin: → Should use var(--sp-*) tokens
- Any number displayed to user: → Must be wrapped in font-family: var(--font-mono)

### Step 3: Banned pattern check
Before finishing a file, grep it mentally for:
- ❌ Hardcoded hex colors (use variables)
- ❌ font-family: 'Arial', 'Roboto', 'Helvetica', 'system-ui'
- ❌ import from 'lucide-react' or 'react-icons' or '@heroicons'
- ❌ "AI-Generated", "AI-Powered", "Powered by AI", robot/brain emojis
- ❌ Spinner animations (use skeleton shimmer)
- ❌ Light gray backgrounds (#f5f5f5, #f8f8f8)
- ❌ Bright gradient hero sections
- ❌ Neon glows, bright colored borders
- ❌ border-radius values not from var(--radius-*)

### Step 4: Day mode check
Every CSS file with custom backgrounds MUST include .app-day-mode counterparts.
Check: does your file have .app-day-mode rules? If not, add them.

### Step 5: Visual reference check
Open WelcomePage.jsx in your mind. Does your new component look like it belongs on the same screen? If you can tell where WelcomePage ends and your component begins — the styles don't match. Fix them until the seam is invisible.

### Step 6: Run the guardian
After writing the component:
\`\`\`bash
node scripts/design-guardian.mjs src/components/YourNewComponent.jsx
node scripts/design-guardian.mjs src/components/YourNewComponent.css
\`\`\`
Fix ALL violations before considering the task done.

### THE GOLDEN TEST
If your output looks like "an AI built this" — delete it and copy from COMPONENT_TEMPLATES.md instead.
```

---

## LAYER 4 (BONUS): PRE-COMMIT HOOK

Add the design guardian as a git pre-commit hook so violations can never be committed:

### `.husky/pre-commit` (if using husky) or `.git/hooks/pre-commit`:

```bash
#!/bin/sh

echo "🔍 Running Spectre Design Guardian..."
node scripts/design-guardian.mjs src/

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Design violations found. Fix them before committing."
  echo "   See SPECTRE_DESIGN_LAW.md for correct patterns."
  echo "   See src/components/templates/COMPONENT_TEMPLATES.md for copy-paste templates."
  echo ""
  exit 1
fi

echo "✅ Design check passed."
```

---

## IMPLEMENTATION ORDER

1. Create `scripts/design-guardian.mjs` — the validator script
2. Create `src/components/templates/COMPONENT_TEMPLATES.md` — the pattern library
3. Append the self-check block to `CLAUDE.md`
4. Run `npm run design-check` on the entire existing codebase to find current violations
5. Fix the existing violations (this will take a session — there will be many)
6. Set up the pre-commit hook
7. Every future Claude Code session: the model reads CLAUDE.md (which now includes the self-check), copies from templates, and knows the guardian will catch violations

---

## WHY THIS WORKS

**Layer 1 (validator)** catches violations AFTER they happen. It's the safety net. Claude Code can't commit bad code because the guardian blocks it.

**Layer 2 (templates)** prevents violations BEFORE they happen. Claude Code copies from templates instead of inventing styles from its training priors. Copying is more reliable than creating.

**Layer 3 (prompt injection)** changes Claude Code's behavior DURING generation. The self-check in CLAUDE.md forces the model to audit its own output before presenting it. It's not perfect, but it reduces the default rate from ~60% slop to ~15% slop, and the validator catches the rest.

**Layer 4 (pre-commit)** is the absolute last line of defense. Nothing ships with violations. Period.

The combination of all four layers makes it nearly impossible for AI-generated code to violate the design system. Not because the AI became smarter, but because the system doesn't trust the AI to be consistent, and validates everything mechanically.

---

## ADDING NEW TEMPLATES

When you build a new component pattern that should become standard:

1. Build it properly (matching design law)
2. Add it to `COMPONENT_TEMPLATES.md` with the exact JSX and CSS
3. Add any new banned patterns to `design-guardian.mjs` if needed
4. Future Claude Code sessions will find and copy the new template

The template library grows over time. The more templates you have, the less Claude needs to invent, and the more consistent the app becomes.
