#!/usr/bin/env node
/**
 * audit-token-colors.mjs — audit the curated token-colour table for:
 *
 *   1. Collisions — multiple distinct tokens with identical hex.
 *      Two tokens render identical → user can't tell them apart on the
 *      accent ramp. Worst case: a low-cap copies a major's brand.
 *
 *   2. Monochrome triggers — chroma < 0.04 in OKLCH.
 *      `accentNormalize.js` returns `MONOCHROME_FALLBACK` (warm silver
 *      ramp) for any input with chroma below this threshold. The
 *      curated hex is silently ignored. Token renders as silver.
 *
 *   3. Low-chroma warning — chroma 0.04-0.10 in OKLCH.
 *      Survives the mono guard but `normalizeAccent` will lift chroma
 *      to ≥0.16 (C_MIN) — the displayed colour drifts from the input.
 *
 * Usage:
 *   node scripts/audit-token-colors.mjs                  # audit trading app
 *   node scripts/audit-token-colors.mjs --research       # research app
 *   node scripts/audit-token-colors.mjs --json           # machine-readable
 *
 * Reads `KNOWN_TOKEN_COLORS` directly from the source file so it
 * stays in lock-step with the live table. Re-run after every edit.
 *
 * Created 2026-05-26 to catch the NEAR-as-cyan / SHIB-shares-BTC /
 * TAO-monochrome class of bugs before they ship.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const useResearch = args.includes('--research')
const asJson = args.includes('--json')

const SRC = useResearch
  ? path.join(repoRoot, 'apps/research/src/constants/tokenColors.js')
  : path.join(repoRoot, 'apps/trading/src/utils/tokenColors.js')

if (!fs.existsSync(SRC)) {
  console.error(`Could not find tokenColors source at ${SRC}`)
  process.exit(2)
}

// Pull the KNOWN_TOKEN_COLORS object literal out of the source file.
// Naive but robust: find the opening line, then scan until the matching
// closing brace at column 0. Then eval the JS object literal directly.
function extractTable(text) {
  const startRe = /const\s+KNOWN_TOKEN_COLORS\s*=\s*\{/
  const startMatch = startRe.exec(text)
  if (!startMatch) throw new Error('KNOWN_TOKEN_COLORS not found in source')
  const start = startMatch.index + startMatch[0].length - 1 // back to the `{`
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        const literal = text.slice(start, i + 1)
        // Strip comments before evaluating
        const stripped = literal
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
        // eslint-disable-next-line no-eval
        return eval(`(${stripped})`)
      }
    }
  }
  throw new Error('Could not find closing brace of KNOWN_TOKEN_COLORS')
}

const COLORS = extractTable(fs.readFileSync(SRC, 'utf8'))

// --- Alias groups (variants of the same token legitimately share a color) ---
const ALIAS_GROUPS = [
  ['ETH', 'WETH'], ['BTC', 'WBTC'],
  ['WIF', '$WIF', 'DOGWIFHAT'],
  ['JUP', 'JUPITER'],
  ['MOODENG', 'MOO DENG'],
  ['JTO', 'JITO'],
  ['RENDER', 'RNDR'],
  ['TAO', 'BITTENSOR'],
  ['FET', 'FETCH.AI'],
  ['RAY', 'RAYDIUM'],
  ['GC=F', 'GLD', 'IAU', 'NEM', 'GOLD'],
  ['SI=F', 'SLV'],
  ['CL=F', 'USO'],
  ['NG=F', 'UNG'],
  ['HG=F', 'CPER'],
]
function aliasRoot(symbol) {
  for (const group of ALIAS_GROUPS) if (group.includes(symbol)) return group[0]
  return symbol
}

// --- Intentional-monochrome allowlist (real brands that ARE silver/grey) ---
const INTENTIONAL_MONO = new Set([
  // Commodities — monochrome is correct for these.
  'SI=F', 'SLV', 'CL=F', 'USO', 'PL=F', 'PA=F',
  // SPECTRE's brand IS warm silver — intentional.
  'SPECTRE',
])

// --- Intentional-collision allowlist (small tokens inheriting an L1/ecosystem
//     parent's brand colour). Pairs are `[child, parent]`. Add with care —
//     genuine collisions should be flagged.
const INTENTIONAL_COLLISIONS = new Set([
  // WEN is a niche Solana meme; sharing SOL's purple is acceptable.
  'WEN::SOL',
])
function isIntentionalCollision(tokens) {
  // Sort so pair order is stable, then check both directions.
  const sorted = [...tokens].sort()
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (INTENTIONAL_COLLISIONS.has(`${sorted[i]}::${sorted[j]}`) ||
          INTENTIONAL_COLLISIONS.has(`${sorted[j]}::${sorted[i]}`)) {
        return true
      }
    }
  }
  return false
}

// --- OKLab chroma (matches accentNormalize.js MONOCHROME_CHROMA threshold) ---
function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function hexToLinear(hex) {
  const s = hex.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  const r = parseInt(s.slice(0, 2), 16) / 255
  const g = parseInt(s.slice(2, 4), 16) / 255
  const b = parseInt(s.slice(4, 6), 16) / 255
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
}
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
  return [
    0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
    1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.8086757660*s,
  ]
}
function chromaOf(hex) {
  const lin = hexToLinear(hex)
  if (!lin) return 0
  const lab = linearToOklab(lin)
  return Math.hypot(lab[1], lab[2])
}

// --- Collect findings ---
const findings = { collisions: [], monoTriggers: [], lowChroma: [], invalidHex: [] }

const byHex = new Map()
for (const [sym, hex] of Object.entries(COLORS)) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    findings.invalidHex.push({ sym, hex })
    continue
  }
  const root = aliasRoot(sym)
  const norm = hex.toLowerCase()
  if (!byHex.has(norm)) byHex.set(norm, new Set())
  byHex.get(norm).add(root)

  const c = chromaOf(hex)
  if (c < 0.04 && !INTENTIONAL_MONO.has(sym)) {
    findings.monoTriggers.push({ sym, hex, chroma: +c.toFixed(4) })
  } else if (c < 0.10 && !INTENTIONAL_MONO.has(sym)) {
    findings.lowChroma.push({ sym, hex, chroma: +c.toFixed(4) })
  }
}
for (const [hex, roots] of byHex) {
  if (roots.size > 1) {
    const intentional = isIntentionalCollision(roots)
    findings.collisions.push({ hex, tokens: [...roots], intentional })
  }
}

// --- Output ---
if (asJson) {
  console.log(JSON.stringify(findings, null, 2))
} else {
  const app = useResearch ? 'research' : 'trading'
  console.log(`\n=== Token-colour audit (${app}) — ${Object.keys(COLORS).length} entries ===\n`)

  const hardCollisions = findings.collisions.filter(c => !c.intentional)
  const softCollisions = findings.collisions.filter(c => c.intentional)
  console.log('COLLISIONS (distinct tokens with identical hex):')
  if (hardCollisions.length === 0) console.log('  none ✓')
  else hardCollisions.forEach(c => console.log(`  ${c.hex.padEnd(8)} → ${c.tokens.join(', ')}`))
  if (softCollisions.length > 0) {
    console.log('  (intentional shares — allowlisted):')
    softCollisions.forEach(c => console.log(`    ${c.hex.padEnd(8)} → ${c.tokens.join(', ')}`))
  }

  console.log('\nMONOCHROME TRIGGERS (chroma < 0.04 → renders as SILVER fallback):')
  if (findings.monoTriggers.length === 0) console.log('  none ✓')
  else findings.monoTriggers.forEach(m =>
    console.log(`  ${m.sym.padEnd(12)} ${m.hex.padEnd(8)} chroma=${m.chroma}  ← would render silver`))

  console.log('\nLOW CHROMA WARNING (0.04 ≤ chroma < 0.10 → normalizeAccent will lift to 0.16):')
  if (findings.lowChroma.length === 0) console.log('  none ✓')
  else findings.lowChroma.forEach(m =>
    console.log(`  ${m.sym.padEnd(12)} ${m.hex.padEnd(8)} chroma=${m.chroma}  ← chroma will be lifted`))

  if (findings.invalidHex.length > 0) {
    console.log('\nINVALID HEX (not in #RRGGBB form):')
    findings.invalidHex.forEach(e => console.log(`  ${e.sym}: ${JSON.stringify(e.hex)}`))
  }

  const hardTotal = hardCollisions.length + findings.monoTriggers.length + findings.invalidHex.length
  console.log(`\n${hardTotal === 0 ? '✓ Clean' : `✗ ${hardTotal} hard issue${hardTotal === 1 ? '' : 's'} need attention`}\n`)

  // Exit non-zero on hard issues so CI can fail the build. Soft/allowlisted
  // collisions and low-chroma warnings don't fail — they're informational.
  if (hardTotal > 0) process.exit(1)
}
