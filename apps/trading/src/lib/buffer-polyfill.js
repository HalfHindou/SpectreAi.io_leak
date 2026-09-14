/**
 * Buffer polyfill - MUST be the FIRST import of main.jsx, and MUST live in
 * its own Rollup chunk (vite.config.js manualChunks 'buffer-polyfill').
 *
 * Why a module (not inline in main.jsx's body): ESM evaluates a module's
 * imports BEFORE its body. When heavy vendor chunks (privy-vendor) touch
 * Node's `Buffer` global at top-level evaluation, a polyfill in main.jsx's
 * BODY runs too late - blank-page crash. As main.jsx's first import, this
 * module's body is GUARANTEED to execute before any sibling chunk that
 * main.jsx imports later (entry chunk imports preserve declaration order).
 *
 * Why its own chunk: if Rollup inlined this module into the entry chunk,
 * the entry's hoisted chunk-imports (privy-vendor included) would execute
 * before ANY entry-inlined code - the exact historical trap. A dedicated
 * chunk keeps it a peer import that runs first.
 */
import { Buffer } from 'buffer'

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer
}
