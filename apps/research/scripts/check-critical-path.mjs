// PR-2 (perf): regression fence for the boot critical path.
// Fails the build if a heavy vendor chunk sneaks back onto the entry's
// modulepreload list (the manualChunks colocation bug that put vendor-three
// on EVERY page's boot), or if the entry chunk balloons past budget.
// Run automatically via the package.json postbuild hook.
import { readFileSync, readdirSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

// Vendor chunks that must NEVER be preloaded/imported by the entry document.
// They belong to specific lazy routes (world, charts, share-cards, video).
const FORBIDDEN_PRELOADS = [
  'vendor-three',
  'vendor-recharts',
  'vendor-lightweight-charts',
  'vendor-remotion',
  'vendor-html2canvas',
]

// Entry chunk raw-size budget in bytes. 2026-06-11: the Privy + WalletConnect +
// viem + Coinbase + Solana wallet stack (~67% of the old 2.5MB entry) was moved
// OFF the boot path — it now lazy-mounts via lib/privy-boundary.jsx after first
// paint (idle / login click / auth-gate showing login UI). The entry dropped to
// ~0.74MB raw. Budget sits ~10% above that so any regression (e.g. a new eager
// @privy-io/react-auth import sneaking back onto the entry path) fails the
// build. Ratchet DOWN as future PRs slim the entry. Never raise without a
// written justification in the PR description.
const ENTRY_BUDGET_BYTES = 0.72 * 1024 * 1024

let failures = []

// 1) No forbidden chunk on the entry document's preload list
const html = readFileSync(path.join(distDir, 'index.html'), 'utf8')
const preloads = [...html.matchAll(/<link[^>]+rel="(?:modulepreload|stylesheet|preload)"[^>]*href="([^"]+)"/g)].map((m) => m[1])
for (const href of preloads) {
  const hit = FORBIDDEN_PRELOADS.find((name) => href.includes(name))
  if (hit) failures.push(`forbidden chunk on entry critical path: ${hit} (${href})`)
}

// 2) Entry chunk within budget
const assetsDir = path.join(distDir, 'assets')
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/(index-[^"]+\.js)"/)
if (!entryMatch) {
  failures.push('could not locate entry <script type="module"> in dist/index.html')
} else {
  const size = statSync(path.join(assetsDir, entryMatch[1])).size
  const mb = (size / 1024 / 1024).toFixed(2)
  if (size > ENTRY_BUDGET_BYTES) {
    failures.push(`entry chunk ${entryMatch[1]} is ${mb}MB raw - over the ${(ENTRY_BUDGET_BYTES / 1024 / 1024).toFixed(1)}MB budget`)
  } else {
    console.log(`[check-critical-path] entry ${entryMatch[1]} ${mb}MB raw - within budget`)
  }
}

// 2b) The Privy wallet stack must NOT be bundled into the entry chunk. It is
// lazy-mounted (lib/privy-boundary.jsx) after first paint. The entry-budget
// fence catches the size, but this string check pins the specific regression:
// a new eager `@privy-io/react-auth` / privy-config import dragging the SDK
// (PrivyProvider + toSolanaWalletConnectors) back onto the boot path. These
// identifiers survive esbuild minification (they're external API names), so a
// presence check on the entry source is reliable.
if (entryMatch) {
  const entrySrc = readFileSync(path.join(assetsDir, entryMatch[1]), 'utf8')
  for (const marker of ['PrivyProvider', 'toSolanaWalletConnectors']) {
    if (entrySrc.includes(marker)) {
      failures.push(`Privy wallet stack back on the entry chunk: "${marker}" found in ${entryMatch[1]} (deferred mount regressed — check for a new eager @privy-io/react-auth import)`)
    }
  }
}

// 3) Sanity: the forbidden chunks still exist as standalone files (the rule
// is "off the critical path", not "deleted")
const assetFiles = readdirSync(assetsDir)
for (const name of ['vendor-three', 'vendor-recharts']) {
  if (!assetFiles.some((f) => f.startsWith(name))) {
    console.warn(`[check-critical-path] note: no ${name}-*.js chunk found (dependency removed?)`)
  }
}

if (failures.length) {
  console.error('[check-critical-path] FAIL:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('[check-critical-path] OK - no heavy vendor chunks on the boot critical path')
