/**
 * Spectre — DexScreener Content Script
 * Injects STATUS + X ACTIVITY columns, top banner, and filter pills
 * into DexScreener watchlist / trending / search tables.
 *
 * DexScreener uses div-based CSS Grid tables (not HTML <table>):
 *   .ds-dex-table-th   → header (grid row)
 *   .ds-dex-table-row  → data rows (<a> tags, grid rows)
 *   grid-template-columns: var(--ds-dex-screener-column-layout)
 *
 * SPA-aware: MutationObserver + pushState/replaceState/popstate
 * Reuses chrome.runtime.sendMessage({ type: 'RESOLVE_CASHTAG' }) from X content script
 */

// ─── Config ──────────────────────────────────────────────────────
const POLL_INTERVAL = 500;
const MAX_POLLS = 20;
const BADGE_ATTR = 'data-spectre-dex';
const SCORE_COL_W = '130px';
const ACTIVITY_COL_W = '110px';

// ─── State ───────────────────────────────────────────────────────
let enabled = true;
let contextDead = false;
let currentPath = location.pathname;
let resolvedTokens = new Map(); // symbol → { score, data }
let activeFilter = 'all';

// ─── Context Check ───────────────────────────────────────────────
function isContextValid() {
  if (contextDead) return false;
  try { if (chrome.runtime?.id) return true; } catch {}
  contextDead = true;
  return false;
}

// ─── Settings ────────────────────────────────────────────────────
async function loadEnabled() {
  try {
    const result = await chrome.storage.sync.get('spectre_dex_enabled');
    enabled = result.spectre_dex_enabled !== false;
  } catch { enabled = true; }
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.spectre_dex_enabled) {
      enabled = changes.spectre_dex_enabled.newValue !== false;
      if (!enabled) removeAll();
      else scanPage();
    }
  });
} catch {}

// ─── Score Label ─────────────────────────────────────────────────
function scoreLabel(score) {
  switch (score) {
    case 'ultra':     return 'ULTRA';
    case 'active':    return 'ACTIVE';
    case 'returning': return 'RETURNING';
    case 'building':  return 'BUILDING';
    case 'quiet':     return 'QUIET';
    case 'low':       return 'LOW';
    case 'gone':      return 'GONE';
    case 'ghost':     return 'GONE';
    case 'dead':      return 'DEAD';
    default:          return '...';
  }
}

// Map server status to CSS class name suffix
function scoreCssClass(score) {
  if (score === 'ghost') return 'gone';
  return score;
}

// ─── Fetch X Activity & Status from backend ──────────────────────
async function fetchXActivity(symbol, chain, address) {
  if (!isContextValid()) return null;
  try {
    return await chrome.runtime.sendMessage({
      type: 'FETCH_X_ACTIVITY',
      ticker: symbol,
      chain: chain || null,
      address: address || null,
    });
  } catch (err) {
    if (err.message?.includes('context invalidated')) contextDead = true;
    return null;
  }
}

// ─── Resolve price data (for pair page detail strip) ─────────────
async function resolveSymbol(symbol) {
  if (!isContextValid()) return null;
  try {
    return await chrome.runtime.sendMessage({ type: 'RESOLVE_CASHTAG', ticker: symbol });
  } catch (err) {
    if (err.message?.includes('context invalidated')) contextDead = true;
    return null;
  }
}

// ─── Extract Symbol + Pair Path from DexScreener Row ─────────────
// Row is an <a> with href like "/solana/Abc123..." — we need both
// the display symbol AND the chain/address for precise API lookups.
function extractTokenInfo(row) {
  try {
    const tokenCell = row.querySelector('.ds-dex-table-row-col-token');
    if (!tokenCell) return null;

    const spans = Array.from(tokenCell.querySelectorAll('span'));
    const texts = spans.map(s => s.textContent.trim());

    let symbol = null;
    // Find "/" separator — the span immediately before it is the base token
    const slashIdx = texts.indexOf('/');
    if (slashIdx > 0) {
      const sym = texts[slashIdx - 1];
      if (sym && sym.length >= 2 && sym.length <= 12) symbol = sym.replace(/^\$/, '');
    }
    // Fallback: first uppercase-looking span
    if (!symbol) {
      for (const t of texts) {
        if (/^\$?[A-Z0-9]{2,10}$/.test(t) && !t.startsWith('#')) { symbol = t.replace(/^\$/, ''); break; }
      }
    }
    if (!symbol) return null;

    // Extract chain + address from the row href (e.g. "/solana/abc123")
    const href = row.getAttribute('href') || '';
    const pairMatch = href.match(/^\/([\w-]+)\/([a-zA-Z0-9]+)/);
    const chain = pairMatch ? pairMatch[1] : null;
    const address = pairMatch ? pairMatch[2] : null;

    return { symbol, chain, address };
  } catch {}
  return null;
}

// ─── Format Helpers ──────────────────────────────────────────────
function formatCompact(n) {
  if (!n || n === 0) return '--';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

// ─── Mini Sparkline Bars (X Activity) ────────────────────────────
function buildSparkline(xData) {
  const tweets = xData?.tweets24h || 0;
  const bars = 12;
  const bw = 3, gap = 2, h = 20;
  const w = bars * (bw + gap);

  // Build bar heights from engagement/tweets — last bar is "now"
  const maxTweets = Math.max(tweets, 1);
  const seed = (xData?.engagement || 1) + tweets;

  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i < bars; i++) {
    // Distribute activity across bars with some variance
    const ratio = tweets > 0 ? Math.max(0.15, ((Math.sin(seed + i * 1.7) + 1) / 2) * (tweets / 20)) : 0.1;
    const bh = Math.max(2, Math.min(h - 1, Math.floor(ratio * h)));
    const x = i * (bw + gap);
    // Last bar highlighted in purple, others in white
    const fill = i === bars - 1 ? 'rgba(139,92,246,0.85)' : 'rgba(255,255,255,0.22)';
    svg += `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="1" fill="${fill}"/>`;
  }
  svg += '</svg>';
  return { svg, tweets };
}

// ─── Remove All Injected Elements ────────────────────────────────
function removeAll() {
  document.querySelectorAll(
    '.spectre-banner, .spectre-filters, .spectre-score-cell, .spectre-activity-cell, .spectre-col-header, .spectre-pair-badge-wrap, .spectre-pair-detail'
  ).forEach(el => el.remove());
  // Remove grid style override
  removeGridStyle();
  // Reset row attrs
  document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(el => el.removeAttribute(BADGE_ATTR));
  resolvedTokens.clear();
  activeFilter = 'all';
}

// ═══════════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════════

function injectBanner() {
  if (document.querySelector('.spectre-banner')) return;
  const table = document.querySelector('.ds-dex-table');
  if (!table) return;

  const banner = document.createElement('div');
  banner.className = 'spectre-banner';
  banner.innerHTML = `
    <div class="spectre-banner-left">
      <span class="spectre-banner-badge">SPECTRE</span>
      <span class="spectre-banner-text">Status plugin active \u2014 showing X activity signals for all tokens in your watchlist</span>
    </div>
    <div class="spectre-banner-right">
      <span class="spectre-banner-time">Last updated just now \u00b7 Live</span>
    </div>`;
  table.parentNode.insertBefore(banner, table);
}

// ═══════════════════════════════════════════════════════════════════
// FILTER PILLS
// ═══════════════════════════════════════════════════════════════════

function injectFilterPills() {
  if (document.querySelector('.spectre-filters')) return;
  const banner = document.querySelector('.spectre-banner');
  if (!banner) return;

  const wrap = document.createElement('div');
  wrap.className = 'spectre-filters';

  const cats = [
    { id: 'all',       label: 'All',       color: '#ffffff' },
    { id: 'ultra',     label: 'Ultra',     color: '#FBBF24' },
    { id: 'active',    label: 'Active',    color: '#10B981' },
    { id: 'returning', label: 'Returning', color: '#06B6D4' },
    { id: 'building',  label: 'Building',  color: '#8B5CF6' },
    { id: 'quiet',     label: 'Quiet',     color: '#F59E0B' },
    { id: 'low',       label: 'Low',       color: '#64748B' },
    { id: 'gone',      label: 'Gone',      color: '#EF4444' },
    { id: 'dead',      label: 'Dead',      color: '#374151' },
  ];

  for (const c of cats) {
    const btn = document.createElement('button');
    btn.className = `spectre-filter-pill${c.id === 'all' ? ' spectre-filter-active' : ''}`;
    btn.dataset.filter = c.id;
    btn.innerHTML = `${c.id !== 'all' ? `<span class="spectre-filter-dot" style="background:${c.color}"></span>` : ''}${c.label} <span class="spectre-filter-count" data-count="${c.id}">0</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activeFilter = c.id;
      document.querySelectorAll('.spectre-filter-pill').forEach(p => p.classList.remove('spectre-filter-active'));
      btn.classList.add('spectre-filter-active');
      applyFilter();
    });
    wrap.appendChild(btn);
  }

  const sortLabel = document.createElement('span');
  sortLabel.className = 'spectre-sort-label';
  sortLabel.textContent = 'Sorted by status';
  wrap.appendChild(sortLabel);

  banner.after(wrap);
}

function updateFilterCounts() {
  const counts = { all: 0, ultra: 0, active: 0, returning: 0, building: 0, quiet: 0, low: 0, gone: 0, dead: 0 };
  for (const [, v] of resolvedTokens) {
    // Normalize ghost → gone for counting
    const normalized = v.score === 'ghost' ? 'gone' : v.score;
    counts[normalized] = (counts[normalized] || 0) + 1;
    counts.all++;
  }
  for (const [key, count] of Object.entries(counts)) {
    const el = document.querySelector(`[data-count="${key}"]`);
    if (el) el.textContent = count;
  }
}

function applyFilter() {
  document.querySelectorAll('.ds-dex-table-row').forEach(row => {
    const sym = row.getAttribute(BADGE_ATTR);
    if (!sym) return;
    const td = resolvedTokens.get(sym);
    if (!td) { row.style.display = ''; return; }
    const normalized = td.score === 'ghost' ? 'gone' : td.score;
    row.style.display = (activeFilter === 'all' || normalized === activeFilter) ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════
// GRID COLUMN EXTENSION — inject <style> that extends the CSS variable
// This ensures columns stay at END even when DexScreener recalculates layout
// ═══════════════════════════════════════════════════════════════════

let gridStyleInjected = false;

function injectGridStyle() {
  if (gridStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'spectre-grid-ext';
  style.textContent = `
    .ds-dex-table-th,
    .ds-dex-table-row {
      grid-template-columns: var(--ds-dex-screener-column-layout) ${SCORE_COL_W} ${ACTIVITY_COL_W} !important;
    }
  `;
  document.head.appendChild(style);
  gridStyleInjected = true;
}

function removeGridStyle() {
  const el = document.getElementById('spectre-grid-ext');
  if (el) el.remove();
  gridStyleInjected = false;
}

function injectHeaderColumns() {
  const header = document.querySelector('.ds-dex-table-th');
  if (!header || header.querySelector('.spectre-col-header')) return;

  const scoreH = document.createElement('div');
  scoreH.className = 'ds-table-th spectre-col-header spectre-col-header-status';
  scoreH.textContent = 'Status';
  header.appendChild(scoreH);

  const actH = document.createElement('div');
  actH.className = 'ds-table-th spectre-col-header spectre-col-header-activity';
  actH.textContent = 'X Activity';
  header.appendChild(actH);
}

// ═══════════════════════════════════════════════════════════════════
// ROW INJECTION
// ═══════════════════════════════════════════════════════════════════

async function injectRowBadges() {
  if (!enabled) return;

  const rows = document.querySelectorAll('.ds-dex-table-row');
  if (rows.length === 0) return;

  injectGridStyle();
  injectBanner();
  injectFilterPills();
  injectHeaderColumns();

  for (const row of rows) {
    if (row.getAttribute(BADGE_ATTR)) continue;

    const info = extractTokenInfo(row);
    if (!info || !info.symbol) continue;

    row.setAttribute(BADGE_ATTR, info.symbol);

    // STATUS cell — shimmer placeholder
    const scoreCell = document.createElement('div');
    scoreCell.className = 'ds-table-data-cell spectre-score-cell';
    scoreCell.innerHTML = '<span class="spectre-pill-shimmer"></span>';
    row.appendChild(scoreCell);

    // X ACTIVITY cell — shimmer placeholder
    const actCell = document.createElement('div');
    actCell.className = 'ds-table-data-cell spectre-activity-cell';
    actCell.innerHTML = '<span class="spectre-activity-shimmer"></span>';
    row.appendChild(actCell);

    // Resolve async — pass chain + address for precise lookup
    resolveRow(info.symbol, info.chain, info.address, scoreCell, actCell);
  }
}

async function resolveRow(symbol, chain, address, scoreCell, actCell) {
  try {
    // Fetch real X activity & status from backend — pass chain+address for precise lookup
    const xData = await fetchXActivity(symbol, chain, address);
    const score = xData?.status || 'ghost';
    resolvedTokens.set(symbol, { score, data: xData });

    // STATUS pill
    const cssClass = scoreCssClass(score);
    scoreCell.innerHTML = `<span class="spectre-score-pill spectre-score-${cssClass}"><span class="spectre-score-dot"></span>${scoreLabel(score)}</span>`;

    // X ACTIVITY sparkline (uses real tweets24h from backend)
    const { svg, tweets } = buildSparkline(xData);
    actCell.innerHTML = `<div class="spectre-activity-wrap">${svg}<span class="spectre-activity-count">${tweets}tw</span></div>`;

    updateFilterCounts();
  } catch {
    scoreCell.innerHTML = '<span class="spectre-score-pill spectre-score-gone"><span class="spectre-score-dot"></span>GONE</span>';
    actCell.innerHTML = '<span class="spectre-activity-none">--</span>';
  }
}

// ═══════════════════════════════════════════════════════════════════
// PAIR PAGE — Individual Token Page
// ═══════════════════════════════════════════════════════════════════

function isPairPage() {
  return /^\/(ethereum|solana|bsc|arbitrum|base|polygon|avalanche|optimism|fantom)\//.test(location.pathname);
}

function extractPairSymbol() {
  try {
    const els = [
      document.querySelector('[class*="pair-"] h1'),
      document.querySelector('[class*="pair-"] h2'),
      ...document.querySelectorAll('h1, h2'),
    ].filter(Boolean);

    for (const el of els) {
      const t = el.textContent.trim();
      const m = t.match(/^([A-Z0-9]{2,10})\s*[\/\s]/);
      if (m) return m[1];
      const bm = t.match(/^([A-Z0-9]{2,10})$/);
      if (bm) return bm[1];
    }
  } catch {}
  return null;
}

async function injectPairBadge() {
  if (!enabled || !isPairPage()) return;
  if (document.querySelector('.spectre-pair-badge-wrap')) return;

  const symbol = extractPairSymbol();
  if (!symbol) return;

  const headerEl = [
    document.querySelector('[class*="pair-"] h1'),
    document.querySelector('[class*="token-info"] h1'),
    document.querySelector('h1'),
  ].filter(Boolean)[0];
  if (!headerEl) return;

  const wrap = document.createElement('span');
  wrap.className = 'spectre-pair-badge-wrap';
  wrap.innerHTML = '<span class="spectre-pill-shimmer"></span>';
  headerEl.appendChild(wrap);

  try {
    // Extract chain + address from URL for precise lookup
    const pathMatch = location.pathname.match(/^\/([\w-]+)\/([a-zA-Z0-9]+)/);
    const chain = pathMatch ? pathMatch[1] : null;
    const address = pathMatch ? pathMatch[2] : null;

    // Fetch status + price data in parallel
    const [xData, priceData] = await Promise.all([
      fetchXActivity(symbol, chain, address),
      resolveSymbol(symbol),
    ]);

    const score = xData?.status || 'gone';
    const pairCssClass = scoreCssClass(score);
    wrap.innerHTML = `<span class="spectre-score-pill spectre-score-${pairCssClass}"><span class="spectre-score-dot"></span>${scoreLabel(score)}</span>`;

    const strip = document.createElement('div');
    strip.className = 'spectre-pair-detail';
    const ch = priceData?.change24 != null ? `${priceData.change24 > 0 ? '+' : ''}${parseFloat(priceData.change24).toFixed(2)}%` : '--';
    strip.innerHTML = `
      <span class="spectre-pair-stat">24h: <strong>${ch}</strong></span>
      <span class="spectre-pair-stat">Vol: <strong>${priceData?.volume ? formatCompact(priceData.volume) : '--'}</strong></span>
      <span class="spectre-pair-stat">MCap: <strong>${priceData?.marketCap ? formatCompact(priceData.marketCap) : '--'}</strong></span>`;
    if (headerEl.parentNode) headerEl.parentNode.insertBefore(strip, headerEl.nextSibling);
  } catch {
    wrap.innerHTML = '';
  }
}

// ═══════════════════════════════════════════════════════════════════
// SPA Navigation + MutationObserver
// ═══════════════════════════════════════════════════════════════════

function onPageChange() {
  if (!enabled) return;
  const p = location.pathname;
  if (p === currentPath) return;
  currentPath = p;
  removeAll();
  setTimeout(scanPage, 300);
}

function scanPage() {
  if (!enabled || !isContextValid()) return;
  if (isPairPage()) {
    pollFor(() => document.querySelector('h1'), injectPairBadge, 0);
  } else {
    pollFor(() => document.querySelector('.ds-dex-table-row'), injectRowBadges, 0);
  }
}

function pollFor(fn, cb, n) {
  if (n >= MAX_POLLS || !enabled || !isContextValid()) return;
  if (fn()) { cb(); return; }
  setTimeout(() => pollFor(fn, cb, n + 1), POLL_INTERVAL);
}

let tableObserver = null;

function startTableObserver() {
  if (tableObserver) tableObserver.disconnect();

  tableObserver = new MutationObserver((mutations) => {
    if (!enabled || !isContextValid()) return;
    let hit = false;
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.classList?.contains('ds-dex-table-row') || n.querySelector?.('.ds-dex-table-row'))) {
          hit = true; break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      clearTimeout(startTableObserver._t);
      startTableObserver._t = setTimeout(injectRowBadges, 200);
    }
  });

  tableObserver.observe(document.body, { childList: true, subtree: true });
}

// ═══════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════

async function init() {
  console.log('[Spectre] DexScreener content script loaded');
  await loadEnabled();
  if (!enabled) { console.log('[Spectre] DexScreener injection disabled'); return; }

  window.addEventListener('popstate', onPageChange);
  const oPush = history.pushState;
  const oReplace = history.replaceState;
  history.pushState = function () { oPush.apply(this, arguments); onPageChange(); };
  history.replaceState = function () { oReplace.apply(this, arguments); onPageChange(); };

  startTableObserver();
  scanPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
