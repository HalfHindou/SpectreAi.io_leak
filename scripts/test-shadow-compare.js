#!/usr/bin/env node
/**
 * Shadow Comparison Harness
 * ═══════════════════════════════════════════════════════════════
 * Runs the ORIGINAL and SHADOW endpoints side by side for each of
 * the 3 features (search, insight, news) and writes a comparison
 * table to SHADOW_TEST_RESULTS.md at the monorepo root.
 *
 * Usage:
 *   node scripts/test-shadow-compare.js
 *
 * Requires packages/server to be running on port 3001 (pm2 process
 * `spectre-server`).
 *
 * DO NOT modify any existing endpoints. Only create new shadow
 * endpoints. The originals stay untouched until we review results.
 * ═══════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.SHADOW_TEST_BASE || 'http://localhost:3001';
const OUT_FILE = path.resolve(__dirname, '..', 'SHADOW_TEST_RESULTS.md');
const REQUEST_TIMEOUT_MS = 45000;

// Node 22 has a global fetch. If running on older Node, fall back to node-fetch.
const fetchFn = typeof fetch === 'function'
  ? fetch
  : (...args) => import('node-fetch').then(m => m.default(...args));

// ── TEST CASES ───────────────────────────────────────────────────────────────
const CASES = [
  // Search
  {
    id: 'search-1',
    feature: 'search',
    label: 'What\'s happening with Bitcoin?',
    old: { method: 'POST', path: '/api/search/whisper', body: { query: "What's happening with Bitcoin?" } },
    shadow: { method: 'POST', path: '/api/search/whisper-shadow', body: { query: "What's happening with Bitcoin?" } },
    preview: r => r?.interpretation || (Array.isArray(r?.results) && r.results.length ? `${r.results.length} results, first: ${r.results[0]?.name || r.results[0]?.symbol || 'unknown'}` : ''),
  },
  {
    id: 'search-2',
    feature: 'search',
    label: 'Is ETH overbought?',
    old: { method: 'POST', path: '/api/search/whisper', body: { query: 'Is ETH overbought?' } },
    shadow: { method: 'POST', path: '/api/search/whisper-shadow', body: { query: 'Is ETH overbought?' } },
    preview: r => r?.interpretation || (Array.isArray(r?.results) && r.results.length ? `${r.results.length} results` : ''),
  },
  {
    id: 'search-3',
    feature: 'search',
    label: 'Latest DeFi news',
    old: { method: 'POST', path: '/api/search/whisper', body: { query: 'Latest DeFi news' } },
    shadow: { method: 'POST', path: '/api/search/whisper-shadow', body: { query: 'Latest DeFi news' } },
    preview: r => r?.interpretation || (Array.isArray(r?.results) && r.results.length ? `${r.results.length} results` : ''),
  },

  // Insight
  {
    id: 'insight-1',
    feature: 'insight',
    label: 'RSI BTC 48.43',
    old: {
      method: 'POST', path: '/api/insight',
      body: { metricType: 'rsi', metricValue: 48.43, metricLabel: 'RSI', context: { tokenSymbol: 'BTC' } },
    },
    shadow: {
      method: 'POST', path: '/api/insight-shadow',
      body: { metric_key: 'rsi', asset: 'BTC', current_value: 48.43 },
    },
    preview: r => r?.insight?.title || r?.insight?.body || '',
  },
  {
    id: 'insight-2',
    feature: 'insight',
    label: 'Market cap ETH $270B',
    old: {
      method: 'POST', path: '/api/insight',
      body: { metricType: 'market-cap', metricValue: 270000000000, metricLabel: 'Market Capitalization', context: { tokenSymbol: 'ETH' } },
    },
    shadow: {
      method: 'POST', path: '/api/insight-shadow',
      body: { metric_key: 'market_cap', asset: 'ETH', current_value: 270000000000 },
    },
    preview: r => r?.insight?.title || r?.insight?.body || '',
  },
  {
    id: 'insight-3',
    feature: 'insight',
    label: 'Funding rate SOL 0.012',
    old: {
      method: 'POST', path: '/api/insight',
      body: { metricType: 'funding-rate', metricValue: 0.012, metricLabel: 'Funding Rate', context: { tokenSymbol: 'SOL' } },
    },
    shadow: {
      method: 'POST', path: '/api/insight-shadow',
      body: { metric_key: 'funding_rate', asset: 'SOL', current_value: 0.012 },
    },
    preview: r => r?.insight?.title || r?.insight?.body || '',
  },

  // News
  {
    id: 'news-1',
    feature: 'news',
    label: 'Top 5 articles',
    old: { method: 'GET', path: '/api/news/rss?limit=5' },
    shadow: { method: 'GET', path: '/api/news/rss-shadow?limit=5&summarize=true' },
    preview: r => {
      const items = Array.isArray(r?.results) ? r.results : [];
      if (!items.length) return '(empty results)';
      return `${items.length} articles, first: "${(items[0]?.title || '').slice(0, 80)}"`;
    },
  },
];

// ── HELPERS ──────────────────────────────────────────────────────────────────
async function hit({ method, path: p, body }) {
  const started = Date.now();
  try {
    const init = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (method !== 'GET' && body !== undefined) init.body = JSON.stringify(body);
    const res = await fetchFn(`${BASE}${p}`, init);
    const text = await res.text();
    const elapsedMs = Date.now() - started;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* keep as raw text */ }
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs,
      rawText: text,
      parsed,
      length: text.length,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      rawText: '',
      parsed: null,
      length: 0,
      error: e.message || String(e),
    };
  }
}

function firstChars(str, n = 200) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim().slice(0, n);
}

function mdEscape(s) {
  if (!s) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function flagForShadow(result, previewText) {
  if (!result.ok) return `ERRORED (HTTP ${result.status}${result.error ? ': ' + result.error : ''})`;
  if (result.length === 0) return 'EMPTY';
  if (!previewText || previewText === '(empty results)') return 'EMPTY_CONTENT';
  if (result.parsed?.shadow && result.parsed.shadow.ok === false) {
    return `SHADOW_OK_FALSE (${result.parsed.shadow.error || 'unknown'})`;
  }
  return 'OK';
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n[shadow-compare] Base: ${BASE}`);
  console.log(`[shadow-compare] Running ${CASES.length} test cases...\n`);

  const rows = [];

  for (const tc of CASES) {
    console.log(`→ ${tc.id}: ${tc.label}`);

    const [oldRes, newRes] = await Promise.all([
      hit(tc.old),
      hit(tc.shadow),
    ]);

    const oldPreview = tc.preview ? (tc.preview(oldRes.parsed) || firstChars(oldRes.rawText)) : firstChars(oldRes.rawText);
    const newPreview = tc.preview ? (tc.preview(newRes.parsed) || firstChars(newRes.rawText)) : firstChars(newRes.rawText);

    const oldFlag = oldRes.ok ? (oldRes.length > 0 ? 'OK' : 'EMPTY') : `ERRORED (HTTP ${oldRes.status}${oldRes.error ? ': ' + oldRes.error : ''})`;
    const newFlag = flagForShadow(newRes, newPreview);

    console.log(`   old: ${oldFlag} — ${oldRes.elapsedMs}ms, ${oldRes.length}B — ${firstChars(oldPreview, 100)}`);
    console.log(`   new: ${newFlag} — ${newRes.elapsedMs}ms, ${newRes.length}B — ${firstChars(newPreview, 100)}`);

    rows.push({
      tc,
      oldRes, newRes,
      oldPreview: firstChars(oldPreview, 200),
      newPreview: firstChars(newPreview, 200),
      oldFlag, newFlag,
    });
  }

  // ── Write markdown ──────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const md = [];
  md.push('# SHADOW_TEST_RESULTS.md');
  md.push('');
  md.push(`**Generated:** ${now}  `);
  md.push(`**Harness:** \`scripts/test-shadow-compare.js\`  `);
  md.push(`**Base URL:** \`${BASE}\`  `);
  md.push(`**Feature flag status:** Shadow endpoints mounted in \`packages/server/index.js\` alongside originals — originals untouched.`);
  md.push('');
  md.push('## Summary');
  md.push('');
  const okCount = rows.filter(r => r.newFlag === 'OK').length;
  const errCount = rows.filter(r => r.newFlag.startsWith('ERRORED') || r.newFlag === 'EMPTY' || r.newFlag === 'EMPTY_CONTENT' || r.newFlag.startsWith('SHADOW_OK_FALSE')).length;
  md.push(`- Total cases: **${rows.length}**`);
  md.push(`- Shadow OK: **${okCount}**`);
  md.push(`- Shadow flagged: **${errCount}**`);
  md.push(`- Old endpoint errors: **${rows.filter(r => !r.oldRes.ok).length}**`);
  md.push('');

  // Compact comparison table
  md.push('## Side-by-side comparison');
  md.push('');
  md.push('| # | Feature | Test | Old status | Old time | Old bytes | Shadow status | Shadow time | Shadow bytes | Flag |');
  md.push('|---|---------|------|------------|----------|-----------|---------------|-------------|--------------|------|');
  rows.forEach((r, i) => {
    md.push(`| ${i + 1} | ${r.tc.feature} | ${mdEscape(r.tc.label)} | ${r.oldRes.ok ? 'OK' : 'ERR'} ${r.oldRes.status} | ${r.oldRes.elapsedMs}ms | ${r.oldRes.length} | ${r.newRes.ok ? 'OK' : 'ERR'} ${r.newRes.status} | ${r.newRes.elapsedMs}ms | ${r.newRes.length} | ${r.newFlag} |`);
  });
  md.push('');

  // Detailed per-case previews
  md.push('## Per-case previews (first 200 chars of each response)');
  md.push('');
  rows.forEach((r, i) => {
    md.push(`### ${i + 1}. ${r.tc.feature.toUpperCase()} — ${r.tc.label}`);
    md.push('');
    md.push(`**Request:**`);
    md.push('```');
    md.push(`OLD:    ${r.tc.old.method} ${r.tc.old.path}`);
    if (r.tc.old.body) md.push(`        body: ${JSON.stringify(r.tc.old.body)}`);
    md.push(`SHADOW: ${r.tc.shadow.method} ${r.tc.shadow.path}`);
    if (r.tc.shadow.body) md.push(`        body: ${JSON.stringify(r.tc.shadow.body)}`);
    md.push('```');
    md.push('');
    md.push(`**Old (${r.oldFlag}, HTTP ${r.oldRes.status}, ${r.oldRes.elapsedMs}ms, ${r.oldRes.length} bytes):**`);
    md.push('```');
    md.push(r.oldPreview || '(no preview)');
    md.push('```');
    md.push('');
    md.push(`**Shadow (${r.newFlag}, HTTP ${r.newRes.status}, ${r.newRes.elapsedMs}ms, ${r.newRes.length} bytes):**`);
    md.push('```');
    md.push(r.newPreview || '(no preview)');
    md.push('```');
    if (r.newRes.parsed?.shadow) {
      const s = r.newRes.parsed.shadow;
      md.push('');
      md.push(`**Shadow diagnostics:**`);
      md.push(`- model: \`${s.model || 'n/a'}\``);
      md.push(`- sources: ${(s.sources || []).map(x => `\`${x.label}\``).join(', ') || '(none)'}`);
      if (s.failures && s.failures.length) {
        md.push(`- failures: ${s.failures.map(f => `\`${f.label}\` (${f.status || 'network'}: ${f.error})`).join('; ')}`);
      }
      if (s.usage) {
        md.push(`- tokens: ${s.usage.total_tokens || '?'} (prompt ${s.usage.prompt_tokens || '?'}, completion ${s.usage.completion_tokens || '?'})`);
      }
    }
    md.push('');
  });

  md.push('---');
  md.push('');
  md.push('## How to re-run');
  md.push('');
  md.push('```bash');
  md.push('node scripts/test-shadow-compare.js');
  md.push('```');
  md.push('');
  md.push('Override base URL: `SHADOW_TEST_BASE=http://localhost:3002 node scripts/test-shadow-compare.js`');
  md.push('');

  fs.writeFileSync(OUT_FILE, md.join('\n'));
  console.log(`\n[shadow-compare] Wrote ${OUT_FILE}`);
  console.log(`[shadow-compare] ${okCount}/${rows.length} shadow cases OK, ${errCount} flagged.\n`);
})().catch(err => {
  console.error('[shadow-compare] Fatal:', err);
  process.exit(1);
});
