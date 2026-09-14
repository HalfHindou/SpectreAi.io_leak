#!/usr/bin/env node
/**
 * Bars-pipeline parity guard.
 *
 * The /api/bars chart cascade is shared between the research and trading
 * serverless apps by COPYING a set of modules into both `api/_lib/` dirs
 * (cross-app imports are forbidden — see CLAUDE.md "Independence"). This script
 * sha256-compares those copies and fails if they have drifted, so a fix landed
 * in one app can't silently diverge from the other.
 *
 * Shared modules kept byte-identical across:
 *   apps/research/api/_lib/  <->  apps/trading/api/_lib/
 *
 * NOT compared (intentionally app-specific): the thin entry handlers
 * apps/{research,trading}/api/bars.js (research routes through trade-api.js +
 * handlers/bars.js; trading has its own preamble: CORS allowlist, auth-gate,
 * 180/min rate limit, 'prod-trading' Codex metrics tag).
 *
 * ── Run manually ────────────────────────────────────────────────────────────
 *   node scripts/check-bars-parity.mjs
 * Exit 0 = in parity. Exit 1 = drift (prints which files + the fix command).
 *
 * Wired into scripts/pre-deploy-check.sh (check #7). When you edit a shared
 * module, edit the RESEARCH copy, then re-sync trading:
 *   cp apps/research/api/_lib/<file> apps/trading/api/_lib/<file>
 *
 * ── Second check: RESEARCH-INTERNAL TWINS ───────────────────────────────────
 * A few modules must exist in BOTH runtimes of the research app — the
 * serverless `api/_lib/` copy and the browser `src/` copy — because the
 * serverless bundle cannot import from `src/` and the bundle cannot import
 * from `api/`. These CANNOT be byte-compared: each copy carries its own
 * header comment explaining which side it is. What must never drift is the
 * MEANING: the exported data and the exported function source. So they are
 * imported and compared semantically.
 *
 * The pair that motivated this (2026-08-26): cg-platforms.js, the CoinGecko
 * platform-slug -> Codex network id map. It was created precisely BECAUSE the
 * same map had been copy-pasted into five places and every copy was missing
 * different chains, which left tokens on those chains with no address and
 * therefore no chart at all. A silent drift here re-opens that whole class,
 * and the file's own "KEEP IN SYNC" comment was the only thing guarding it.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Shared modules that MUST be byte-identical in both apps' api/_lib/.
const SHARED = [
  'bars-hole-fill.js',
  'bars-router.js',
  'codex-budget.js',
  'cg-ohlc-bars.js',
  'binance-bars.js',
  'geckoterminal-bars.js',
  'hetzner-bars.js',
];

const RESEARCH_LIB = join(ROOT, 'apps', 'research', 'api', '_lib');
const TRADING_LIB = join(ROOT, 'apps', 'trading', 'api', '_lib');

// Research-internal twins (server runtime <-> browser runtime). `signature`
// returns the part of the module that must match; anything it omits (header
// comments) is allowed to differ.
const TWINS = [
  {
    file: 'cg-platforms.js',
    server: join(RESEARCH_LIB, 'cg-platforms.js'),
    client: join(ROOT, 'apps', 'research', 'src', 'lib', 'cg-platforms.js'),
    signature: (m) => JSON.stringify({
      map: m.CG_PLATFORM_TO_NETWORK_ID,
      // Whitespace-normalized so formatting alone can't fail the build, while
      // any real change to the picking logic still does.
      fn: String(m.contractFromPlatforms).replace(/\s+/g, ' ').trim(),
    }),
  },
];

function sha256(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch (e) {
    return `MISSING(${e.code || e.message})`;
  }
}

const drift = [];
for (const file of SHARED) {
  const rPath = join(RESEARCH_LIB, file);
  const tPath = join(TRADING_LIB, file);
  const rHash = sha256(rPath);
  const tHash = sha256(tPath);
  if (rHash !== tHash) {
    drift.push({ file, rHash, tHash });
  }
}

// Twin check runs regardless of the result above — a green cross-app parity
// says nothing about whether the server and browser copies still agree.
const twinDrift = [];
for (const twin of TWINS) {
  let sig;
  for (const side of ['server', 'client']) {
    try {
      const mod = await import(pathToFileURL(twin[side]).href);
      const s = twin.signature(mod);
      if (sig === undefined) sig = s;
      else if (s !== sig) twinDrift.push({ ...twin, reason: 'exported map / logic differs' });
    } catch (e) {
      twinDrift.push({ ...twin, reason: `${side} copy failed to load: ${e.message}` });
      break;
    }
  }
}

let failed = false;

if (drift.length === 0) {
  console.log(`[bars-parity] OK — ${SHARED.length} shared modules byte-identical across research/trading.`);
} else {
  failed = true;
  console.error(`[bars-parity] DRIFT — ${drift.length}/${SHARED.length} shared module(s) differ between apps:\n`);
  for (const { file, rHash, tHash } of drift) {
    console.error(`  ${file}`);
    console.error(`    research: ${rHash.slice(0, 16)}…`);
    console.error(`    trading:  ${tHash.slice(0, 16)}…`);
  }
  console.error('\nFix: edit the RESEARCH copy as the source of truth, then re-sync trading:');
  for (const { file } of drift) {
    console.error(`  cp apps/research/api/_lib/${file} apps/trading/api/_lib/${file}`);
  }
  console.error('');
}

if (twinDrift.length === 0) {
  console.log(`[twin-parity] OK — ${TWINS.length} research-internal twin(s) agree (server ↔ browser copy).`);
} else {
  failed = true;
  console.error(`\n[twin-parity] DRIFT — ${twinDrift.length}/${TWINS.length} research-internal twin(s) disagree:\n`);
  for (const { file, reason } of twinDrift) {
    console.error(`  ${file}: ${reason}`);
  }
  console.error('\nBoth runtimes must carry the SAME map/logic — a chain added to one');
  console.error('copy and not the other leaves tokens on it address-less, i.e. with no');
  console.error('chart. Port the change to the other copy (headers may differ):');
  for (const { server, client } of twinDrift) {
    console.error(`  ${server.replace(ROOT + '/', '')}`);
    console.error(`  ${client.replace(ROOT + '/', '')}`);
  }
  console.error('');
}

process.exit(failed ? 1 : 0);
