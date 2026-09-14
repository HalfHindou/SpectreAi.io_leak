// Regression fence for the trading boot critical path.
// Fails the build if the Privy wallet stack (privy-vendor / @privy-io) sneaks back
// onto the entry document's preload graph or into the entry chunk itself, or if
// the Buffer polyfill is no longer the first statically-imported chunk. Wired via
// the package.json build script (vite build && node scripts/check-critical-path.mjs).
//
// WHY: privy-vendor is ~2.8MB raw / ~842KB gz. main.jsx used to statically import
// PrivyProvider, so that chunk was modulepreloaded and gated React mount. It now
// lazy-mounts via lib/privy-boundary.jsx (dynamic import) — this guard pins that
// so a future eager `@privy-io/react-auth` import can't silently regress boot FCP.
import { readFileSync, readdirSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const assetsDir = path.join(distDir, 'assets')

let failures = []

// 1) No Privy chunk on the entry document's preload/script graph. Dynamic imports
//    are NOT emitted as modulepreloads, so a `privy` match here means something is
//    statically pulling the wallet stack onto boot again.
const html = readFileSync(path.join(distDir, 'index.html'), 'utf8')
const preloads = [...html.matchAll(/<link[^>]+rel="(?:modulepreload|stylesheet|preload)"[^>]*href="([^"]+)"/g)].map((m) => m[1])
const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])
for (const href of [...preloads, ...scriptSrcs]) {
  if (/privy/i.test(href)) failures.push(`Privy chunk on the entry critical path: ${href} (deferred mount regressed — a new eager @privy-io import?)`)
}

// 2) The entry (module) chunk must not statically import the privy-vendor chunk,
//    and must not contain the SDK markers (which live only in privy-vendor /
//    privy-provider-lazy). The entry legitimately references the privy-provider-lazy
//    filename (its DYNAMIC import target) — that's allowed; privy-vendor is not.
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+\.js)"/)
if (!entryMatch) {
  failures.push('could not locate entry <script type="module"> in dist/index.html')
} else {
  const entryFile = entryMatch[1]
  const entrySrc = readFileSync(path.join(assetsDir, entryFile), 'utf8')
  // Match a STATIC import specifier (`from"./privy-vendor-*.js"`), NOT the bare
  // filename string that legitimately appears in Vite's __vite__mapDeps preload
  // manifest ("assets/privy-vendor-*.js") — that manifest only preloads the chunk
  // WHEN the dynamic privy-provider-lazy import actually fires (idle/login), which
  // is exactly the deferred behaviour we want.
  if (/from\s*["']\.\/privy-vendor/.test(entrySrc)) {
    failures.push(`entry chunk ${entryFile} statically imports the privy-vendor chunk (wallet stack back on boot)`)
  }
  for (const marker of ['PrivyProvider', 'toSolanaWalletConnectors']) {
    if (entrySrc.includes(marker)) {
      failures.push(`Privy SDK marker "${marker}" found in entry chunk ${entryFile} (deferred mount regressed — check for a new eager @privy-io/react-auth import)`)
    }
  }
  const sizeMb = (statSync(path.join(assetsDir, entryFile)).size / 1024 / 1024).toFixed(2)
  console.log(`[check-critical-path] entry ${entryFile} ${sizeMb}MB raw`)
}

// 3) The Buffer polyfill must be its own chunk and carry the global assignment.
//    main.jsx imports it FIRST, so it evaluates before the dynamic privy/solana/
//    ethers chunks that touch Buffer. Assert the chunk exists + sets window.Buffer.
const assetFiles = readdirSync(assetsDir)
const bufChunk = assetFiles.find((f) => /^buffer-polyfill-.*\.js$/.test(f))
if (!bufChunk) {
  failures.push('no buffer-polyfill-*.js chunk found (Buffer polyfill lost its own chunk — see vite.config manualChunks)')
} else {
  const bufSrc = readFileSync(path.join(assetsDir, bufChunk), 'utf8')
  if (!bufSrc.includes('window.Buffer=') && !bufSrc.includes('window.Buffer =')) {
    failures.push(`buffer-polyfill chunk ${bufChunk} does not set window.Buffer — the polyfill body was tree-shaken or split away`)
  }
  // The polyfill chunk must NOT be dynamic-only: it has to be modulepreloaded (a
  // static entry import) so it runs before everything else.
  if (!preloads.some((h) => h.includes(bufChunk)) && !scriptSrcs.some((h) => h.includes(bufChunk))) {
    failures.push(`buffer-polyfill chunk ${bufChunk} is not on the entry preload graph — it must be a STATIC first import so window.Buffer is set before any wallet chunk evaluates`)
  }
}

if (failures.length) {
  console.error('[check-critical-path] FAIL:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('[check-critical-path] OK - Privy wallet stack is off the boot critical path; Buffer polyfill is first')
