#!/usr/bin/env node
/**
 * Step 1: Ensure .env exists (copy from .env.example if missing).
 * Step 2: Report which API keys are set (no values printed).
 * Step 3: Print next steps to run server + dev.
 */
import { readFileSync, existsSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

const keys = [
  { name: 'CODEX_API_KEY', required: true, hint: 'search, prices, trending' },
  { name: 'COINGECKO_API_KEY', required: false },
  { name: 'OPENAI_API_KEY', required: false, hint: 'Monarch AI answers' },
  { name: 'CRYPTOCOMPARE_API_KEY', required: false, hint: 'news' },
  { name: 'TWITTER_BEARER_TOKEN', required: false, hint: 'latest tweet' },
];

function parseEnv(content) {
  const out = {};
  for (const line of (content || '').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

console.log('\n--- Spectre API setup ---\n');

// Step 1: ensure .env exists
if (!existsSync(envPath)) {
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log('Step 1: Created .env from .env.example\n');
  } else {
    console.log('Step 1: .env.example not found. Create .env manually with CODEX_API_KEY=...\n');
    process.exit(1);
  }
} else {
  console.log('Step 1: .env exists\n');
}

// Step 2: report keys (no values)
let content;
try {
  content = readFileSync(envPath, 'utf8');
} catch (e) {
  console.log('Could not read .env:', e.message);
  process.exit(1);
}
const env = parseEnv(content);

console.log('Step 2: API keys in .env');
for (const k of keys) {
  const val = env[k.name] || env[k.name.replace(/([A-Z])/g, '_$1').toLowerCase()];
  const set = val && val.length > 0 && !/your_.*_here|^$/.test(val);
  const status = set ? '✓ set' : (k.required ? '✗ missing (required)' : '○ optional');
  const hint = k.hint ? ` – ${k.hint}` : '';
  console.log(`  ${k.name}: ${status}${hint}`);
}
console.log('');

// Step 3: next steps
const hasCodex = env.CODEX_API_KEY && !/your_.*_here/.test(env.CODEX_API_KEY);
console.log('Step 3: Run the app (server first, then dev)');
if (!hasCodex) {
  console.log('  1. Edit .env and set CODEX_API_KEY (get one at https://codex.io)');
  console.log('  2. First:  npm run server   (leave running)');
  console.log('  3. Then:   npm run dev      (in another terminal)');
} else {
  console.log('  First:  npm run server   (terminal 1 – leave running)');
  console.log('  Then:   npm run dev       (terminal 2)');
  console.log('  Or:     npm run dev:both (server first, then dev in one terminal)');
}
console.log('\n  See docs/SETUP_APIS.md for details.\n');
