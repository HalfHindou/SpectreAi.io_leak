#!/usr/bin/env node
/**
 * i18n interpolation-leak scanner.
 *
 * Finds the bug class behind PR #854 (calendar "430 {{count}} events"):
 * a t() call on a key whose locale value contains {{var}} but the call
 * passes NO interpolation object -> i18next renders the {{var}} literally.
 *
 * Method: flatten en.json + en-rest.json, collect every key whose value
 * needs interpolation, grep the codebase for EXACT-key t() calls, and flag
 * any call site that does not pass an object / count / defaultValue within
 * 2 lines. Exact-key matching (not leaf) avoids false positives from shared
 * leaves like ".default" / ".note".
 *
 * Usage:  node .claude/scripts/i18n-leak-scan.mjs
 * Run from the repo root. Exit code 1 if leaks are found (CI-friendly).
 */
import fs from 'fs'
import { execSync } from 'child_process'

const localeDir = 'apps/research/src/i18n/locales'

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = v
  }
  return out
}

const en = {
  ...flatten(JSON.parse(fs.readFileSync(`${localeDir}/en.json`, 'utf8'))),
  ...flatten(JSON.parse(fs.readFileSync(`${localeDir}/en-rest.json`, 'utf8'))),
}

const interpKeys = Object.entries(en)
  .filter(([, v]) => typeof v === 'string' && /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(v))
  .map(([k]) => k)

const flagged = []
for (const fullKey of interpKeys) {
  let hits = ''
  try {
    hits = execSync(
      `grep -rn "t([\\"']${fullKey.replace(/\./g, '\\.')}[\\"']" apps/research/src --include=*.jsx --include=*.js 2>/dev/null`,
      { encoding: 'utf8' },
    )
  } catch { /* no hits */ }
  if (!hits.trim()) continue
  for (const line of hits.trim().split('\n')) {
    const m = line.match(/^([^:]+):(\d+):/)
    if (!m) continue
    const file = m[1]
    const lno = Number(m[2])
    let ctx = ''
    try { ctx = execSync(`sed -n '${lno},${lno + 2}p' "${file}"`, { encoding: 'utf8' }) } catch { /* */ }
    const passesVars = /[a-zA-Z_]+\s*:/.test(ctx) || /count|defaultValue|,\s*\{/.test(ctx)
    if (!passesVars) {
      flagged.push({ key: fullKey, value: en[fullKey], at: `${file.replace('apps/research/src/', '')}:${lno}` })
    }
  }
}

console.log(`i18n interpolation keys: ${interpKeys.length}  |  leak candidates: ${flagged.length}\n`)
for (const f of flagged) console.log(`  ${f.at}\n     ${f.key} -> "${f.value}"\n`)
process.exit(flagged.length ? 1 : 0)
