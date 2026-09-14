/**
 * Spectre AI — Sidebar Injector
 * Persistent sidebar panel on the right side of X
 * Design: Shares popup.css design system with two-tab layout
 * Tabs: General Market | Project Specific
 */

let sidebarHost = null;
let shadowRoot = null;
let isVisible = false;
let briefInterval = null;

/**
 * Safely call chrome API — returns false if context is invalidated
 */
function chromeSafe(fn) {
  try { fn(); return true; } catch { return false; }
}

/**
 * Open URL via background service worker (bypasses popup blocker)
 */
function openUrl(url) {
  try {
    chrome.runtime.sendMessage({ type: 'OPEN_TAB', url });
  } catch {
    window.open(url, '_blank');
  }
}

/**
 * Toggle sidebar visibility
 */
function toggleSidebar() {
  if (isVisible) {
    hideSidebar();
  } else {
    showSidebar();
  }
}

/**
 * Show the sidebar
 */
function showSidebar() {
  if (!sidebarHost) createSidebar();
  sidebarHost.style.display = 'block';
  isVisible = true;

  // Shrink X's main content to make room
  const main = document.querySelector('main[role="main"]');
  if (main) main.style.marginRight = '400px';

  // Persist preference
  chromeSafe(() => chrome.storage.local.set({ spectre_sidebar_visible: true }));

  // Load data
  refreshSidebarData();
}

/**
 * Hide the sidebar
 */
function hideSidebar() {
  if (sidebarHost) sidebarHost.style.display = 'none';
  isVisible = false;

  const main = document.querySelector('main[role="main"]');
  if (main) main.style.marginRight = '';

  chromeSafe(() => chrome.storage.local.set({ spectre_sidebar_visible: false }));
}

/* ═══════════════════════════════════════════════════════════════
   AI BRIEF TEMPLATES
   ═══════════════════════════════════════════════════════════════ */

const BRIEF_TEMPLATES = {
  sentiment: (fg, btcP) => {
    if (fg <= 20) return `Extreme fear at ${fg}. Markets frozen — patience over action. BTC at ${btcP}.`;
    if (fg <= 35) return `Fear dominates at ${fg}. Smart money accumulating quietly. BTC holding ${btcP}.`;
    if (fg <= 45) return `Cautious sentiment at ${fg}. Markets searching for direction. BTC at ${btcP}.`;
    if (fg >= 80) return `Euphoria at ${fg}. Peak greed — trim positions, protect gains. BTC at ${btcP}.`;
    if (fg >= 65) return `Greed rising to ${fg}. Momentum strong but stay alert. BTC at ${btcP}.`;
    return `Neutral sentiment at ${fg}. Range-bound conditions persist. BTC steady at ${btcP}.`;
  },
  narrative: (fg, change) => {
    if (change >= 5) return `Market surging ${change > 0 ? '+' : ''}${change.toFixed(1)}% today. Bulls in full control — ride the wave, but set stops.`;
    if (change >= 2) return `Solid green day at ${change > 0 ? '+' : ''}${change.toFixed(1)}%. Momentum building — watch for continuation above resistance.`;
    if (change <= -5) return `Sharp selloff at ${change.toFixed(1)}% today. Capitulation signals emerging — watch for reversal patterns.`;
    if (change <= -2) return `Red across the board at ${change.toFixed(1)}%. Bears pressing — key supports being tested.`;
    return `Flat action today at ${change > 0 ? '+' : ''}${change.toFixed(1)}%. Consolidation phase — breakout imminent.`;
  },
  macro: (btcd, mcap) => {
    if (btcd >= 60) return `BTC dominance at ${btcd.toFixed(1)}% — capital rotating to safety. Alt season on hold.`;
    if (btcd >= 50) return `BTC dominance holding ${btcd.toFixed(1)}%. Bitcoin leading — alts following with lag.`;
    if (btcd <= 40) return `BTC.D at ${btcd.toFixed(1)}% — alt season in play. High-beta tokens outperforming.`;
    return `BTC.D at ${btcd.toFixed(1)}%. Total market cap at ${mcap}. Balanced rotation across sectors.`;
  },
};

let briefStatements = [];
let activeBriefIndex = 0;

function generateBriefStatements(market, prices) {
  const fg = parseInt(market?.fearGreed?.value) || 50;
  const btcPrice = fmtPrice(prices?.BTC?.price);
  const change = parseFloat(market?.marketCapChange24h) || 0;
  const btcd = parseFloat(market?.btcDominance) || 50;
  const mcap = fmtLarge(parseFloat(market?.totalMarketCap));

  return [
    BRIEF_TEMPLATES.sentiment(fg, btcPrice),
    BRIEF_TEMPLATES.narrative(fg, change),
    BRIEF_TEMPLATES.macro(btcd, mcap),
  ];
}

/* ═══════════════════════════════════════════════════════════════
   TOKEN CONFIG
   ═══════════════════════════════════════════════════════════════ */

const DEFAULT_TOKENS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'AVAX', name: 'Avalanche' },
];
const DEFAULT_SYMBOLS = new Set(DEFAULT_TOKENS.map(t => t.symbol));
const FEATURED_TOKENS = DEFAULT_TOKENS.slice(0, 3); // BTC, ETH, SOL

// Dynamic watchlist: defaults + user-added tokens from chrome.storage
let userWatchlist = [];
function getFullWatchlist() {
  const extras = userWatchlist.filter(t => !DEFAULT_SYMBOLS.has(t.symbol || t));
  return [...DEFAULT_TOKENS, ...extras];
}
function isUserToken(symbol) { return !DEFAULT_SYMBOLS.has(symbol); }

const BRAND_COLORS = {
  BTC: '247, 147, 26',
  ETH: '98, 126, 234',
  SOL: '20, 241, 149',
  BNB: '243, 186, 47',
  XRP: '0, 159, 246',
  DOGE: '186, 154, 51',
  ADA: '0, 51, 173',
  AVAX: '232, 65, 66',
};

/* ═══════════════════════════════════════════════════════════════
   CACHED DATA
   ═══════════════════════════════════════════════════════════════ */
let cachedPrices = {};
let cachedMarket = {};

/* ═══════════════════════════════════════════════════════════════
   SPARKLINE SVG GENERATOR
   ═══════════════════════════════════════════════════════════════ */

function generateSparklineSVG(sparklineData, isPositive, _brandRgb, width = 200, height = 40) {
  if (!sparklineData || sparklineData.length < 2) return '';

  const targetPoints = 44;
  const step = Math.max(1, Math.floor(sparklineData.length / targetPoints));
  const sampled = [];
  for (let i = 0; i < sparklineData.length; i += step) sampled.push(Number(sparklineData[i]) || 0);
  if (sampled[sampled.length - 1] !== Number(sparklineData[sparklineData.length - 1])) {
    sampled.push(Number(sparklineData[sparklineData.length - 1]) || 0);
  }

  // Percentile-based scaling — outlier spikes don't flatten the curve
  const sorted = [...sampled].sort((a, b) => a - b);
  const pLo = sorted[Math.floor(sorted.length * 0.02)];
  const pHi = sorted[Math.ceil(sorted.length * 0.98) - 1];
  const rawMin = sorted[0];
  const rawMax = sorted[sorted.length - 1];
  const min = Math.min(pLo, rawMin + (pLo - rawMin) * 0.35);
  const max = Math.max(pHi, rawMax - (rawMax - pHi) * 0.35);
  const range = max - min || 1;

  const padTop = Math.max(4, height * 0.12);
  const padBot = Math.max(3, height * 0.08);
  const padX = 1.5;
  const usableH = height - padTop - padBot;

  const pts = sampled.map((val, i) => {
    const x = padX + (i / (sampled.length - 1)) * (width - padX * 2);
    const y = padTop + usableH - ((val - min) / range) * usableH;
    return { x, y: Math.max(padTop - 1, Math.min(height - padBot + 1, y)) };
  });

  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const tension = 0.2;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }

  const fillD = `${d} L${(width - padX).toFixed(2)},${height - padBot + 1} L${padX.toFixed(2)},${height - padBot + 1} Z`;
  const rgb = isPositive ? '16, 185, 129' : '239, 68, 68';
  const last = pts[pts.length - 1];
  const uid = `sg-${Math.random().toString(36).slice(2, 8)}`;
  const openY = padTop + usableH - ((sampled[0] - min) / range) * usableH;
  const sw = height <= 42 ? 1.35 : 1.6;

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="f-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgb(${rgb})" stop-opacity="0.26"/><stop offset="50%" stop-color="rgb(${rgb})" stop-opacity="0.08"/><stop offset="100%" stop-color="rgb(${rgb})" stop-opacity="0"/></linearGradient>
      <linearGradient id="s-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgb(${rgb})" stop-opacity="1"/><stop offset="100%" stop-color="rgb(${rgb})" stop-opacity="0.82"/></linearGradient>
    </defs>
    <line x1="${padX}" y1="${openY.toFixed(2)}" x2="${(width - padX).toFixed(2)}" y2="${openY.toFixed(2)}" stroke="currentColor" stroke-opacity="0.06" stroke-width="1" stroke-dasharray="3 4"/>
    <path d="${fillD}" fill="url(#f-${uid})"/>
    <path d="${d}" fill="none" stroke="url(#s-${uid})" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="${height <= 42 ? 3 : 5}" fill="rgb(${rgb})" fill-opacity="0.12"/>
    <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="${height <= 42 ? 1.4 : 1.75}" fill="rgb(${rgb})"/>
  </svg>`;
}

/* ═══════════════════════════════════════════════════════════════
   CREATE SIDEBAR DOM
   ═══════════════════════════════════════════════════════════════ */

function createSidebar() {
  sidebarHost = document.createElement('div');
  sidebarHost.id = 'spectre-sidebar-host';
  sidebarHost.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    height: 100vh;
    z-index: 999998;
    display: none;
  `;
  shadowRoot = sidebarHost.attachShadow({ mode: 'closed' });

  // Load shared popup CSS + sidebar-specific overrides
  const style = document.createElement('style');
  style.textContent = getSidebarStyles();
  shadowRoot.appendChild(style);

  // Get logo URL for shadow DOM
  let logoUrl = '';
  try { logoUrl = chrome.runtime.getURL('assets/icons/icon-32.png'); } catch {}

  const container = document.createElement('div');
  container.className = 'spectre-popup-app spectre-sidebar-app';
  container.innerHTML = `
    <div class="spectre-edge"></div>

    <!-- Header -->
    <div class="spectre-header">
      <div class="spectre-brand">
        <img class="spectre-logo" src="${logoUrl}" alt="Spectre AI" width="22" height="22">
        <span class="spectre-brand-text">Spectre AI</span>
      </div>
      <div class="spectre-header-actions">
        <button class="spectre-icon-btn" id="sidebar-search-btn" title="Search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </button>
        <button class="spectre-icon-btn" id="sidebar-daymode" title="Toggle Day/Night">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        </button>
        <button class="spectre-icon-btn" id="sidebar-close" title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <!-- Tab Bar -->
    <div class="spectre-tab-bar">
      <button class="spectre-tab active" data-tab="market">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        General Market
      </button>
      <button class="spectre-tab" data-tab="project">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>
          <path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Project
      </button>
    </div>

    <!-- TAB: General Market -->
    <div class="spectre-tab-content active" id="tab-market">
      <!-- AI Brief -->
      <div class="cab-container" id="cab-container">
        <div class="cab-glow"></div>
        <div class="cab-eyebrow">
          <div class="cab-eyebrow-left">
            <span class="cab-pulse"></span>
            <span class="cab-label">AI BRIEF</span>
          </div>
          <span class="cab-live-badge">LIVE</span>
        </div>
        <blockquote class="cab-statement cab-statement-visible" id="cab-statement">
          <span class="cab-quote-mark">\u201C</span>Loading market intelligence...<span class="cab-quote-mark">\u201D</span>
        </blockquote>
        <div class="cab-rotation-nav" id="cab-dots">
          <button class="cab-rotation-dot active"><span class="cab-dot-fill"></span></button>
          <button class="cab-rotation-dot"><span class="cab-dot-fill"></span></button>
          <button class="cab-rotation-dot"><span class="cab-dot-fill"></span></button>
        </div>
        <div class="cab-attribution">
          <span class="cab-attribution-dash">&mdash;</span>
          <span class="cab-attribution-name">SPECTRE AI</span>
          <span class="cab-attribution-dot">&middot;</span>
          <span class="cab-attribution-time">just now</span>
        </div>
      </div>

      <!-- Mentioned in Feed -->
      <div class="spectre-section sidebar-feed-section" id="sidebar-feed-section">
        <span class="spectre-section-label">MENTIONED IN FEED</span>
        <div class="sidebar-feed-pills" id="feed-pills">
          <span class="sidebar-empty">Scanning feed...</span>
        </div>
      </div>

      <!-- Featured Prices — BTC, ETH, SOL -->
      <div class="spectre-section spectre-featured-section">
        <span class="spectre-section-label">TOP ASSETS</span>
        <div class="spectre-featured-row" id="featured-row">
          <div class="spectre-skeleton-card"><div class="spectre-skeleton-circle"></div><div class="spectre-skeleton-lines"><div class="spectre-skeleton-line w60"></div><div class="spectre-skeleton-line w40"></div></div><div class="spectre-skeleton-right"><div class="spectre-skeleton-price"></div><div class="spectre-skeleton-change"></div></div></div>
          <div class="spectre-skeleton-card"><div class="spectre-skeleton-circle"></div><div class="spectre-skeleton-lines"><div class="spectre-skeleton-line w60"></div><div class="spectre-skeleton-line w40"></div></div><div class="spectre-skeleton-right"><div class="spectre-skeleton-price"></div><div class="spectre-skeleton-change"></div></div></div>
          <div class="spectre-skeleton-card"><div class="spectre-skeleton-circle"></div><div class="spectre-skeleton-lines"><div class="spectre-skeleton-line w60"></div><div class="spectre-skeleton-line w40"></div></div><div class="spectre-skeleton-right"><div class="spectre-skeleton-price"></div><div class="spectre-skeleton-change"></div></div></div>
        </div>
      </div>

      <!-- Market Overview — F&G + Dominance + Global Market -->
      <div class="spectre-section">
        <span class="spectre-section-label">MARKET OVERVIEW</span>
        <div class="spectre-market-grid">
          <div class="cwb-stat-card cwb-fng" id="stat-fng-card" style="--stat-rgb: 239, 68, 68">
            <div class="cwb-stat-header">
              <span class="cwb-stat-label">FEAR & GREED</span>
              <span class="cwb-stat-live-dot"></span>
            </div>
            <div class="cwb-stat-body">
              <span class="cwb-stat-value" id="stat-fg-val">--</span>
              <span class="cwb-stat-sublabel" id="stat-fg-class"></span>
            </div>
            <div class="cwb-fng-bar">
              <div class="cwb-fng-track">
                <div class="cwb-fng-indicator" id="stat-fg-indicator" style="left: 50%"></div>
              </div>
              <div class="cwb-fng-range">
                <span>Fear</span>
                <span>Greed</span>
              </div>
            </div>
          </div>
          <div class="cwb-stat-card cwb-dom" style="--stat-rgb: 247, 147, 26">
            <div class="cwb-stat-header"><span class="cwb-stat-label">MARKET DOMINANCE</span></div>
            <div class="cwb-dom-bar">
              <div class="cwb-dom-seg cwb-dom-btc" id="dom-btc" style="width:60%"></div>
              <div class="cwb-dom-seg cwb-dom-eth" id="dom-eth" style="width:15%"></div>
              <div class="cwb-dom-seg cwb-dom-sol" id="dom-sol" style="width:5%"></div>
              <div class="cwb-dom-seg cwb-dom-alts" id="dom-alts" style="width:20%"></div>
            </div>
            <div class="cwb-dom-legend">
              <span><span class="cwb-dom-dot" style="background:#f7931a"></span> BTC</span>
              <span><span class="cwb-dom-dot" style="background:#627eea"></span> ETH</span>
              <span><span class="cwb-dom-dot" style="background:#14f195"></span> SOL</span>
              <span><span class="cwb-dom-dot" style="background:rgba(255,255,255,0.25)"></span> Alt</span>
            </div>
          </div>
          <div class="cwb-stat-card cwb-mcap" id="stat-mcap-card" style="--stat-rgb: 59, 130, 246">
            <div class="cwb-stat-header">
              <span class="cwb-stat-label">CRYPTO MARKET</span>
              <span class="cwb-stat-live-dot"></span>
            </div>
            <div class="cwb-mcap-value-row">
              <span class="cwb-mcap-value" id="stat-mcap">--</span>
              <span class="cwb-mcap-change" id="stat-mcap-change"></span>
            </div>
            <span class="cwb-mcap-vol" id="stat-vol">Vol: --</span>
          </div>
          <div class="cwb-stat-card cwb-usmarket" id="market-status">
            <div class="cwb-stat-header">
              <span class="cwb-stat-label">US MARKET</span>
              <span class="cwb-market-dot"></span>
            </div>
            <div class="cwb-usmarket-body">
              <span class="cwb-market-label">CLOSED</span>
            </div>
            <span class="cwb-market-time"></span>
          </div>
        </div>
      </div>

      <!-- Watchlist Prices -->
      <div class="spectre-section spectre-prices-section">
        <span class="spectre-section-label">WATCHLIST</span>
        <div class="spectre-price-list" id="price-list">
          <div class="spectre-skeleton-card"><div class="spectre-skeleton-circle"></div><div class="spectre-skeleton-lines"><div class="spectre-skeleton-line w60"></div><div class="spectre-skeleton-line w40"></div></div><div class="spectre-skeleton-right"><div class="spectre-skeleton-price"></div><div class="spectre-skeleton-change"></div></div></div>
          <div class="spectre-skeleton-card"><div class="spectre-skeleton-circle"></div><div class="spectre-skeleton-lines"><div class="spectre-skeleton-line w60"></div><div class="spectre-skeleton-line w40"></div></div><div class="spectre-skeleton-right"><div class="spectre-skeleton-price"></div><div class="spectre-skeleton-change"></div></div></div>
          <div class="spectre-skeleton-card"><div class="spectre-skeleton-circle"></div><div class="spectre-skeleton-lines"><div class="spectre-skeleton-line w60"></div><div class="spectre-skeleton-line w40"></div></div><div class="spectre-skeleton-right"><div class="spectre-skeleton-price"></div><div class="spectre-skeleton-change"></div></div></div>
        </div>
      </div>

      <!-- Trending on X -->
      <div class="spectre-section" id="sidebar-trending-section">
        <span class="spectre-section-label">TRENDING ON X</span>
        <div class="sidebar-trending-pills" id="trending-list">
          <span class="sidebar-empty">Scanning tweets...</span>
        </div>
      </div>
    </div>

    <!-- TAB: Project Specific -->
    <div class="spectre-tab-content" id="tab-project">
      <div class="project-empty" id="project-empty">
        <div class="project-empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/>
            <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <span class="project-empty-title">Select a Token</span>
        <span class="project-empty-desc">Click any token from your watchlist or hover a $cashtag on X</span>
      </div>

      <div class="project-detail" id="project-detail" style="display:none">
        <div class="project-header">
          <div class="project-logo-wrap">
            <div class="project-logo-ring"></div>
            <div class="project-logo" id="project-logo">B</div>
          </div>
          <div class="project-identity">
            <span class="project-name" id="project-name">Bitcoin</span>
            <span class="project-meta" id="project-meta">BTC &middot; #1</span>
          </div>
          <div class="project-pulse-badge" id="project-pulse">
            <span class="project-pulse-dot"></span>
            <span id="project-pulse-label">Risk On</span>
          </div>
        </div>
        <div class="project-price-row">
          <span class="project-price" id="project-price">$97,842.00</span>
          <span class="project-change positive" id="project-change">+2.34%</span>
        </div>
        <div class="project-chart" id="project-chart">
          <div class="project-chart-placeholder"><span>7D Chart</span></div>
        </div>
        <div class="project-stats">
          <div class="project-stat-row"><span class="project-stat-label">Market Cap</span><span class="project-stat-value" id="project-mcap">--</span></div>
          <div class="project-stat-row"><span class="project-stat-label">24H Volume</span><span class="project-stat-value" id="project-volume">--</span></div>
          <div class="project-stat-row"><span class="project-stat-label">24H High / Low</span><span class="project-stat-value" id="project-hl">--</span></div>
          <div class="project-stat-row"><span class="project-stat-label">Circulating Supply</span><span class="project-stat-value" id="project-supply">--</span></div>
          <div class="project-stat-row"><span class="project-stat-label">All-Time High</span><span class="project-stat-value" id="project-ath">--</span></div>
        </div>
        <div class="project-changes">
          <div class="project-change-item"><span class="project-change-label">1H</span><span class="project-change-val" id="project-1h">--%</span></div>
          <div class="project-change-item"><span class="project-change-label">24H</span><span class="project-change-val" id="project-24h">--%</span></div>
          <div class="project-change-item"><span class="project-change-label">7D</span><span class="project-change-val" id="project-7d">--%</span></div>
          <div class="project-change-item"><span class="project-change-label">30D</span><span class="project-change-val" id="project-30d">--%</span></div>
        </div>
        <div class="project-socials" id="project-socials"></div>
        <div class="project-about" id="project-about" style="display:none">
          <span class="spectre-section-label">ABOUT</span>
          <p class="project-about-text" id="project-about-text"></p>
        </div>
        <div class="project-cta-wrap">
          <button class="spectre-cta-btn" id="project-cta">
            <span>Research Platform</span>
            <svg class="spectre-cta-arrow" width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 8.5L8.5 2.5M8.5 2.5H3.8M8.5 2.5V7.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="spectre-footer">
      <button class="spectre-cta-btn" id="sidebar-open-btn">
        <span>Open Spectre AI</span>
        <svg class="spectre-cta-arrow" width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 8.5L8.5 2.5M8.5 2.5H3.8M8.5 2.5V7.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="spectre-footer-powered">powered by spectreai.io</div>
    </div>

    <!-- Search Overlay -->
    <div class="sidebar-search-overlay" id="sidebar-search-overlay">
      <div class="sidebar-search-bar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        <input type="text" class="sidebar-search-input" id="sidebar-search-input" placeholder="Search tokens..." autofocus>
        <button class="sidebar-search-close" id="sidebar-search-close" title="Close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="sidebar-search-results" id="sidebar-search-results">
        <div class="sidebar-search-empty">Type to search tokens by name or symbol</div>
      </div>
    </div>
  `;

  shadowRoot.appendChild(container);
  document.body.appendChild(sidebarHost);

  // Bind events
  shadowRoot.getElementById('sidebar-close').addEventListener('click', hideSidebar);
  shadowRoot.getElementById('sidebar-open-btn').addEventListener('click', () => {
    openUrl('https://spectreai.io');
  });

  // Day mode toggle — writes to chrome.storage → onChanged fires in all surfaces
  shadowRoot.getElementById('sidebar-daymode').addEventListener('click', () => {
    const app = shadowRoot.querySelector('.spectre-sidebar-app');
    if (!app) return;
    const isDay = app.classList.toggle('day-mode');
    // Update icon
    const btn = shadowRoot.getElementById('sidebar-daymode');
    if (btn) {
      btn.innerHTML = isDay
        ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 8.5A6.5 6.5 0 017.5 2 5.5 5.5 0 108.5 14 6.5 6.5 0 0014 8.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
    }
    // Persist — chrome.storage.onChanged will sync to hover popup + extension popup
    try { chrome.storage.local.set({ spectre_dayMode: isDay }); } catch {}
  });

  // Listen for day mode + watchlist changes from other surfaces
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.spectre_dayMode) {
        const isDay = !!changes.spectre_dayMode.newValue;
        const app = shadowRoot?.querySelector('.spectre-sidebar-app');
        if (!app) return;
        const currentlyDay = app.classList.contains('day-mode');
        if (isDay === currentlyDay) return;
        setSidebarDayMode(isDay);
      }
      if (changes.spectre_watchlist) {
        userWatchlist = changes.spectre_watchlist.newValue || [];
        // Re-render prices with updated watchlist
        renderPrices(cachedPrices);
      }
    });
  } catch { /* context may be dead */ }

  // Load initial day mode preference from storage
  try {
    chrome.storage.local.get('spectre_dayMode', (result) => {
      if (result.spectre_dayMode) {
        setSidebarDayMode(true);
      }
    });
  } catch { /* context may be dead */ }

  // Load user watchlist from storage
  try {
    chrome.storage.local.get('spectre_watchlist', (result) => {
      const raw = result.spectre_watchlist || [];
      userWatchlist = raw.map(item => typeof item === 'string' ? { symbol: item } : item);
    });
  } catch { /* context may be dead */ }

  // Search overlay
  const searchBtn = shadowRoot.getElementById('sidebar-search-btn');
  const searchOverlay = shadowRoot.getElementById('sidebar-search-overlay');
  const searchInput = shadowRoot.getElementById('sidebar-search-input');
  const searchCloseBtn = shadowRoot.getElementById('sidebar-search-close');
  const searchResultsEl = shadowRoot.getElementById('sidebar-search-results');
  let sidebarSearchDebounce = null;

  if (searchBtn && searchOverlay) {
    searchBtn.addEventListener('click', () => {
      searchOverlay.classList.toggle('active');
      if (searchOverlay.classList.contains('active')) {
        if (searchInput) setTimeout(() => searchInput.focus(), 100);
        // Show search history when overlay opens with empty input
        if (!searchInput?.value?.trim()) {
          renderSearchHistory(searchResultsEl);
        }
      }
    });
  }
  if (searchCloseBtn && searchOverlay) {
    searchCloseBtn.addEventListener('click', () => {
      searchOverlay.classList.remove('active');
      if (searchInput) searchInput.value = '';
      if (searchResultsEl) searchResultsEl.innerHTML = '<div class="sidebar-search-empty">Type to search tokens by name or symbol</div>';
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      e.stopPropagation(); // Prevent X/Twitter from seeing input events
      clearTimeout(sidebarSearchDebounce);
      const q = searchInput.value.trim();
      if (q.length < 1) {
        // Show search history when input is cleared
        renderSearchHistory(searchResultsEl);
        return;
      }
      sidebarSearchDebounce = setTimeout(() => sidebarSearchTokens(q, searchResultsEl, searchOverlay, searchInput), 300);
    });
    // Stop ALL keyboard events from reaching X/Twitter underneath
    // Without this, typing in Spectre search triggers X's search overlay
    searchInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        searchOverlay.classList.remove('active');
        searchInput.value = '';
      }
    });
    searchInput.addEventListener('keyup', (e) => e.stopPropagation());
    searchInput.addEventListener('keypress', (e) => e.stopPropagation());
    searchInput.addEventListener('focus', (e) => e.stopPropagation());
    searchInput.addEventListener('blur', (e) => e.stopPropagation());
  }

  // Tab switching
  shadowRoot.querySelectorAll('.spectre-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Brief dot clicks
  const dots = shadowRoot.querySelectorAll('.cab-rotation-dot');
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      activeBriefIndex = i;
      updateBriefDisplay();
      clearInterval(briefInterval);
      startBriefRotation();
    });
  });

  startBriefRotation();
}

/* ═══════════════════════════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════════════════════════ */

function switchTab(tabId) {
  if (!shadowRoot) return;

  shadowRoot.querySelectorAll('.spectre-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });

  shadowRoot.querySelectorAll('.spectre-tab-content').forEach(c => {
    c.classList.remove('active');
  });
  const target = shadowRoot.getElementById(`tab-${tabId}`);
  if (target) target.classList.add('active');

  // Show/hide footer CTA (only on market tab)
  const footer = shadowRoot.querySelector('.spectre-footer');
  if (footer) footer.style.display = tabId === 'market' ? 'flex' : 'none';
}

/* ═══════════════════════════════════════════════════════════════
   AI BRIEF DISPLAY
   ═══════════════════════════════════════════════════════════════ */

function startBriefRotation() {
  briefInterval = setInterval(() => {
    if (briefStatements.length > 0) {
      activeBriefIndex = (activeBriefIndex + 1) % briefStatements.length;
      updateBriefDisplay();
    }
  }, 12000);
}

function updateBriefDisplay() {
  if (!shadowRoot || briefStatements.length === 0) return;
  const statement = shadowRoot.getElementById('cab-statement');
  if (!statement) return;

  statement.classList.remove('cab-statement-visible');
  statement.classList.add('cab-statement-fading');

  setTimeout(() => {
    statement.innerHTML = `<span class="cab-quote-mark">\u201C</span>${esc(briefStatements[activeBriefIndex])}<span class="cab-quote-mark">\u201D</span>`;
    statement.classList.remove('cab-statement-fading');
    statement.classList.add('cab-statement-visible');
  }, 400);

  const dots = shadowRoot.querySelectorAll('.cab-rotation-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === activeBriefIndex);
  });
}

/* ═══════════════════════════════════════════════════════════════
   US MARKET STATUS
   ═══════════════════════════════════════════════════════════════ */

function getUSMarketStatus() {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etStr);
  const day = et.getDay();
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && totalMinutes >= 570 && totalMinutes < 960;

  const timeStr = et.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });

  return {
    isOpen,
    label: isOpen ? 'US OPEN' : 'US CLOSED',
    time: timeStr + ' ET',
  };
}

function updateUSMarketStatus() {
  if (!shadowRoot) return;
  const card = shadowRoot.getElementById('market-status');
  if (!card) return;
  const status = getUSMarketStatus();
  card.classList.toggle('open', status.isOpen);
  const label = card.querySelector('.cwb-market-label');
  const time = card.querySelector('.cwb-market-time');
  if (label) label.textContent = status.isOpen ? 'OPEN' : 'CLOSED';
  if (time) time.textContent = status.time;
}

/* ═══════════════════════════════════════════════════════════════
   REFRESH SIDEBAR DATA
   ═══════════════════════════════════════════════════════════════ */

async function refreshSidebarData() {
  if (!shadowRoot) return;
  try { if (!chrome.runtime?.id) return; } catch { return; }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_MARKET_STATE' });
    if (!response) return;

    const market = response.market || {};
    const prices = response.prices || {};

    cachedPrices = prices;
    cachedMarket = market;

    // AI Brief statements
    briefStatements = generateBriefStatements(market, prices);
    activeBriefIndex = 0;
    updateBriefDisplay();

    // Sentiment color
    const fg = parseInt(market?.fearGreed?.value) || 50;
    const fgClass = market?.fearGreed?.classification || 'Neutral';
    const fgColor = fg <= 30 ? '239, 68, 68'
      : fg <= 45 ? '249, 115, 22'
      : fg >= 70 ? '34, 197, 94'
      : fg >= 55 ? '132, 204, 22'
      : '234, 179, 8';

    const cabContainer = shadowRoot.getElementById('cab-container');
    if (cabContainer) cabContainer.style.setProperty('--sentiment-rgb', fgColor);

    // F&G stat card
    setTextById('stat-fg-val', String(fg));
    setTextById('stat-fg-class', fgClass);
    const fgCard = shadowRoot.getElementById('stat-fng-card');
    if (fgCard) fgCard.style.setProperty('--stat-rgb', fgColor);
    const fgIndicator = shadowRoot.getElementById('stat-fg-indicator');
    if (fgIndicator) fgIndicator.style.left = `${Math.min(100, Math.max(0, fg))}%`;

    // Market Dominance bar
    const btcDom = parseFloat(market?.btcDominance) || 0;
    const ethDom = parseFloat(market?.ethDominance) || 0;
    const solDom = parseFloat(market?.solDominance) || 0;
    const altsDom = Math.max(0, 100 - btcDom - ethDom - solDom);

    const domBtc = shadowRoot.getElementById('dom-btc');
    const domEth = shadowRoot.getElementById('dom-eth');
    const domSol = shadowRoot.getElementById('dom-sol');
    const domAlts = shadowRoot.getElementById('dom-alts');
    if (domBtc) domBtc.style.width = `${btcDom.toFixed(1)}%`;
    if (domEth) domEth.style.width = `${ethDom.toFixed(1)}%`;
    if (domSol) domSol.style.width = `${solDom.toFixed(1)}%`;
    if (domAlts) domAlts.style.width = `${altsDom.toFixed(1)}%`;

    // Global Market card (MCAP + Volume)
    const mcap = parseFloat(market?.totalMarketCap);
    setTextById('stat-mcap', !isNaN(mcap) && mcap > 0 ? fmtLarge(mcap) : '--');
    const vol = parseFloat(market?.totalVolume);
    setTextById('stat-vol', !isNaN(vol) && vol > 0 ? `Vol: ${fmtLarge(vol)}` : 'Vol: --');
    const mcapChange = parseFloat(market?.marketCapChange24h);
    const mcapChangeEl = shadowRoot.getElementById('stat-mcap-change');
    if (mcapChangeEl && !isNaN(mcapChange)) {
      const isMcapUp = mcapChange >= 0;
      mcapChangeEl.textContent = `${isMcapUp ? '+' : ''}${mcapChange.toFixed(1)}%`;
      mcapChangeEl.className = `cwb-mcap-change ${isMcapUp ? 'positive' : 'negative'}`;
    }
    const mcapCard = shadowRoot.getElementById('stat-mcap-card');
    if (mcapCard && !isNaN(mcapChange)) {
      const trendColor = mcapChange >= 2 ? '34, 197, 94'
        : mcapChange >= 0 ? '132, 204, 22'
        : mcapChange >= -2 ? '249, 115, 22'
        : '239, 68, 68';
      mcapCard.style.setProperty('--stat-rgb', trendColor);
    }

    // US Market Status
    updateUSMarketStatus();

    // Render featured + watchlist price cards
    renderFeaturedPrices(prices);
    renderPrices(prices);
  } catch (err) {
    if (!err.message?.includes('Extension context invalidated')) {
      console.warn('[Spectre] Sidebar refresh failed:', err);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   RENDER FEATURED PRICES — BTC, ETH, SOL hero cards
   ═══════════════════════════════════════════════════════════════ */

function renderFeaturedPrices(prices) {
  if (!shadowRoot) return;
  const featuredRow = shadowRoot.getElementById('featured-row');
  if (!featuredRow || !prices || Object.keys(prices).length === 0) return;

  featuredRow.innerHTML = FEATURED_TOKENS.map(token => {
    const p = prices[token.symbol];
    if (!p) return '';

    const change = parseFloat(p.change24) || 0;
    const isUp = change >= 0;
    const rgb = BRAND_COLORS[token.symbol] || '180, 180, 190';
    const sparklineSVG = generateSparklineSVG(p.sparkline, isUp, rgb, 120, 40);
    const logoHtml = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(token.symbol)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : token.symbol[0];

    return `
      <div class="cwb-featured-card" style="--brand-rgb: ${rgb}" data-symbol="${esc(token.symbol)}">
        <div class="cwb-price-corner cwb-price-corner--tl"></div>
        <div class="cwb-price-corner cwb-price-corner--br"></div>
        <div class="cwb-price-glow"></div>
        ${sparklineSVG ? `<div class="cwb-featured-sparkline">${sparklineSVG}</div>` : ''}
        <div class="cwb-featured-logo-wrap">
          <div class="cwb-price-ring cwb-price-ring-1"></div>
          <div class="cwb-featured-logo">${logoHtml}</div>
        </div>
        <span class="cwb-featured-symbol">${esc(token.symbol)}</span>
        <span class="cwb-featured-price">${fmtPrice(p.price)}</span>
        <span class="cwb-featured-change ${isUp ? 'positive' : 'negative'}">
          <span class="cwb-featured-change-arrow">${isUp ? '\u25B2' : '\u25BC'}</span>
          ${isUp ? '+' : ''}${change.toFixed(2)}%
        </span>
      </div>
    `;
  }).join('');

  featuredRow.querySelectorAll('.cwb-featured-card').forEach(card => {
    card.addEventListener('click', () => {
      const symbol = card.dataset.symbol;
      if (symbol) showProjectDetail(symbol);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   RENDER PRICE CARDS — remaining watchlist tokens
   ═══════════════════════════════════════════════════════════════ */

function renderPrices(prices) {
  if (!shadowRoot) return;
  const priceList = shadowRoot.getElementById('price-list');
  if (!priceList || !prices || Object.keys(prices).length === 0) return;

  const remainingTokens = getFullWatchlist().slice(3);
  priceList.innerHTML = remainingTokens.map(token => {
    const sym = token.symbol || token;
    const name = token.name || sym;
    const p = prices[sym];
    if (!p) return '';

    const change = parseFloat(p.change24) || 0;
    const isUp = change >= 0;
    const rgb = BRAND_COLORS[sym] || '180, 180, 190';
    const sparklineSVG = generateSparklineSVG(p.sparkline, isUp, rgb);
    const logoHtml = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(sym)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : sym[0];
    const userAdded = isUserToken(sym);

    return `
      <div class="cwb-price-card" style="--brand-rgb: ${rgb}" data-symbol="${esc(sym)}">
        <div class="cwb-price-corner cwb-price-corner--tl"></div>
        <div class="cwb-price-corner cwb-price-corner--br"></div>
        <div class="cwb-price-glow"></div>
        <div class="cwb-price-logo-wrap">
          <div class="cwb-price-ring cwb-price-ring-1"></div>
          <div class="cwb-price-logo">${logoHtml}</div>
        </div>
        <div class="cwb-price-content">
          <span class="cwb-price-symbol">${esc(sym)}</span>
          <span class="cwb-price-name">${esc(name)}</span>
        </div>
        ${sparklineSVG ? `<div class="cwb-price-sparkline">${sparklineSVG}</div>` : '<div class="cwb-price-sparkline-placeholder"></div>'}
        <div class="cwb-price-right">
          <span class="cwb-price-value">${fmtPrice(p.price)}</span>
          <span class="cwb-price-change ${isUp ? 'positive' : 'negative'}">
            <span class="cwb-price-change-arrow">${isUp ? '\u25B2' : '\u25BC'}</span>
            ${isUp ? '+' : ''}${change.toFixed(2)}%
          </span>
        </div>
        ${userAdded ? `<button class="cwb-remove-btn" data-symbol="${esc(sym)}" title="Remove from watchlist">&times;</button>` : ''}
      </div>
    `;
  }).join('');

  // Click handler: open project detail tab
  priceList.querySelectorAll('.cwb-price-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.cwb-remove-btn')) return;
      const symbol = card.dataset.symbol;
      if (symbol) showProjectDetail(symbol);
    });
  });

  // Remove button handler for user-added tokens
  priceList.querySelectorAll('.cwb-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sym = btn.dataset.symbol;
      userWatchlist = userWatchlist.filter(t => (t.symbol || t) !== sym);
      try { chrome.runtime.sendMessage({ type: 'UPDATE_WATCHLIST', action: 'remove', token: { symbol: sym } }); } catch {}
      renderPrices(cachedPrices);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   PROJECT DETAIL VIEW
   ═══════════════════════════════════════════════════════════════ */

/**
 * Show project detail for ANY token — not limited to watchlist.
 * Accepts an optional data object { name, image, rank, price, ... } to pre-populate
 * before cached prices are available. Falls back to fetching from background.
 */
async function showProjectDetail(symbol, prefetchedData) {
  if (!shadowRoot) return;
  const upper = symbol.toUpperCase();

  // Try to get data from multiple sources
  const watchToken = getFullWatchlist().find(t => t.symbol === upper);
  let p = cachedPrices[upper] || null;

  // If no cached price, try fetching from background
  if (!p && !prefetchedData) {
    try {
      if (chrome.runtime?.id) {
        const resolved = await chrome.runtime.sendMessage({ type: 'RESOLVE_CASHTAG', ticker: upper });
        if (resolved && !resolved.error) {
          p = {
            name: resolved.token?.name || resolved.name || null,
            price: resolved.price,
            change24: resolved.change24,
            change1h: resolved.change1h,
            change7d: resolved.change7d,
            change30d: resolved.change30d || null,
            marketCap: resolved.marketCap,
            volume: resolved.volume,
            sparkline: resolved.sparkline,
            image: resolved.image,
            rank: resolved.rank,
            high24: resolved.high24 || null,
            low24: resolved.low24 || null,
            circulatingSupply: resolved.circulatingSupply || null,
            ath: resolved.ath || null,
            assetType: resolved.assetType || null,
            sector: resolved.token?.sector || null,
            exchange: resolved.token?.exchange || null,
            pe: resolved.pe || null,
          };
          // Also cache for future use
          cachedPrices[upper] = p;
        }
      }
    } catch { /* context may be dead */ }
  }

  // Use prefetched data as fallback
  if (!p && prefetchedData) {
    p = prefetchedData;
  }

  // Determine display name — from watchlist, prefetched data, or just the symbol
  const displayName = watchToken?.name || prefetchedData?.name || p?.name || upper;

  const rgb = BRAND_COLORS[upper] || '180, 180, 190';
  const change = parseFloat(p?.change24) || 0;
  const isUp = change >= 0;

  switchTab('project');

  const emptyEl = shadowRoot.getElementById('project-empty');
  if (emptyEl) emptyEl.style.display = 'none';
  const detail = shadowRoot.getElementById('project-detail');
  if (!detail) return;
  detail.style.display = 'block';
  detail.style.setProperty('--brand-rgb', rgb);

  // Logo
  const logoEl = shadowRoot.getElementById('project-logo');
  if (logoEl) {
    if (p?.image) {
      logoEl.innerHTML = `<img src="${esc(p.image)}" alt="${esc(upper)}">`;
    } else {
      logoEl.textContent = upper[0];
    }
  }

  // Identity
  setTextById('project-name', displayName);
  const metaEl = shadowRoot.getElementById('project-meta');
  if (metaEl) {
    if (p?.assetType === 'stock') {
      metaEl.innerHTML = `${esc(upper)}${p.exchange ? ' &middot; ' + esc(p.exchange) : ''}${p.sector ? ' &middot; ' + esc(p.sector) : ''}`;
    } else {
      metaEl.innerHTML = `${esc(upper)}${p?.rank ? ' &middot; #' + p.rank : ''}`;
    }
  }

  // Pulse badge
  const pulse = shadowRoot.getElementById('project-pulse');
  const aiPulse = cachedMarket.aiPulse || {};
  const pulseLabel = aiPulse.label || 'Neutral';
  const pulseState = aiPulse.state || 'NEUTRAL';
  const pulseColors = {
    RISK_ON: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', color: '#10B981' },
    RISK_OFF: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', color: '#EF4444' },
    EUPHORIA: { bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.18)', color: '#A78BFA' },
    NEUTRAL: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', color: '#F59E0B' },
  };
  const pc = pulseColors[pulseState] || pulseColors.NEUTRAL;
  if (pulse) {
    pulse.style.background = pc.bg;
    pulse.style.borderColor = pc.border;
    pulse.style.color = pc.color;
  }
  setTextById('project-pulse-label', pulseLabel);

  // Price
  setTextById('project-price', p ? fmtPrice(p.price) : '--');
  const changeEl = shadowRoot.getElementById('project-change');
  if (changeEl) {
    if (p && p.price) {
      changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)}%`;
      changeEl.className = `project-change ${isUp ? 'positive' : 'negative'}`;
      changeEl.style.display = '';
    } else {
      changeEl.style.display = 'none';
    }
  }

  // Chart
  const chartContainer = shadowRoot.getElementById('project-chart');
  if (chartContainer) {
    if (p?.sparkline && p.sparkline.length > 2) {
      chartContainer.innerHTML = generateSparklineSVG(p.sparkline, isUp, rgb, 364, 80);
    } else {
      chartContainer.innerHTML = `<div class="project-chart-placeholder"><span>Chart unavailable</span></div>`;
    }
  }

  // Stats
  setTextById('project-mcap', p ? fmtLarge(p.marketCap) || '--' : '--');
  setTextById('project-volume', p ? fmtLarge(p.volume) || '--' : '--');
  setTextById('project-hl', p?.high24 && p?.low24 ? `${fmtPrice(p.high24)} / ${fmtPrice(p.low24)}` : '--');
  setTextById('project-supply', p?.circulatingSupply ? formatLargeNum(p.circulatingSupply) + ' ' + upper : '--');
  setTextById('project-ath', p?.ath ? fmtPrice(p.ath) : '--');

  // Multi-timeframe changes
  updateChangeVal('project-1h', parseFloat(p?.change1h) || 0);
  updateChangeVal('project-24h', change);
  updateChangeVal('project-7d', parseFloat(p?.change7d) || 0);
  updateChangeVal('project-30d', parseFloat(p?.change30d) || 0);

  // Socials + About — fetch from GET_TOKEN_DETAIL endpoint
  const socialsEl = shadowRoot.getElementById('project-socials');
  const aboutSection = shadowRoot.getElementById('project-about');
  if (socialsEl) socialsEl.innerHTML = '<span style="font-size:10px;color:rgba(255,255,255,0.25);font-style:italic">Loading socials...</span>';
  if (aboutSection) aboutSection.style.display = 'none';

  fetchAndRenderSocials(upper);

  // CTA — always points to the Spectre AI marketing site now; keep stock fallback
  const ctaBtn = shadowRoot.getElementById('project-cta');
  if (ctaBtn) {
    if (p?.assetType === 'stock') {
      ctaBtn.onclick = () => openUrl(`https://finance.yahoo.com/quote/${encodeURIComponent(upper)}`);
    } else {
      ctaBtn.onclick = () => openUrl('https://spectreai.io');
    }
  }
}

function updateChangeVal(id, val) {
  const el = shadowRoot?.getElementById(id);
  if (!el) return;
  const isUp = val >= 0;
  el.textContent = `${isUp ? '+' : ''}${val.toFixed(2)}%`;
  el.className = `project-change-val ${isUp ? 'positive' : 'negative'}`;
}

/* ═══════════════════════════════════════════════════════════════
   SOCIAL ICONS
   ═══════════════════════════════════════════════════════════════ */

function webIcon() {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M2 8h12M8 2c-2 2.4-2 9.6 0 12M8 2c2 2.4 2 9.6 0 12" stroke="currentColor" stroke-width="1.2"/></svg>`;
}
function twitterIcon() {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.5 1.5L6.5 8.5L1.5 14.5H3L7.25 9.5L10.5 14.5H14.5L9.25 7L13.75 1.5H12.25L8.5 6L5.5 1.5H1.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
}
function telegramIcon() {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M14 2L1 7.5L5 9L6.5 14L9 10.5L12.5 13L14 2Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M5 9L12.5 4" stroke="currentColor" stroke-width="1.1"/></svg>`;
}
function githubIcon() {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 3.1 2 5.7 4.8 6.6.35.07.48-.15.48-.34v-1.2c-1.96.43-2.37-.95-2.37-.95-.32-.81-.78-1.03-.78-1.03-.64-.44.05-.43.05-.43.7.05 1.08.73 1.08.73.63 1.07 1.65.76 2.05.58.06-.45.24-.76.44-.93-1.56-.18-3.2-.78-3.2-3.48 0-.77.28-1.4.73-1.89-.08-.18-.32-.9.07-1.87 0 0 .6-.19 1.95.72a6.7 6.7 0 013.56 0c1.35-.91 1.95-.72 1.95-.72.39.97.14 1.69.07 1.87.45.5.72 1.12.72 1.89 0 2.71-1.65 3.3-3.22 3.47.25.22.48.65.48 1.31v1.94c0 .19.13.41.49.34C13 13.7 15 11.1 15 8c0-3.87-3.13-7-7-7z" stroke="currentColor" stroke-width="0.5" fill="currentColor"/></svg>`;
}
function redditIcon() {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.1"/><circle cx="5.5" cy="7.5" r="1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor"/><path d="M5 10c0 0 1.5 2 3 2s3-2 3-2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>`;
}

/**
 * Fetch socials from GET_TOKEN_DETAIL and render into sidebar project tab
 */
async function fetchAndRenderSocials(symbol) {
  if (!shadowRoot) return;
  try { if (!chrome.runtime?.id) return; } catch { return; }

  try {
    const detail = await chrome.runtime.sendMessage({ type: 'GET_TOKEN_DETAIL', symbol });
    if (!detail || detail.error) {
      renderSocialLinks([], null);
      return;
    }

    const links = [];
    if (detail.website) links.push({ label: 'Website', url: detail.website, icon: webIcon() });
    if (detail.twitter) links.push({ label: 'Twitter', url: detail.twitter, icon: twitterIcon() });
    if (detail.telegram) links.push({ label: 'Telegram', url: detail.telegram, icon: telegramIcon() });
    if (detail.github) links.push({ label: 'GitHub', url: detail.github, icon: githubIcon() });
    if (detail.reddit) links.push({ label: 'Reddit', url: detail.reddit, icon: redditIcon() });

    renderSocialLinks(links, detail.description);
  } catch (err) {
    if (!err.message?.includes('context invalidated') && !err.message?.includes('Extension context')) {
      console.warn('[Spectre] Sidebar socials fetch failed:', err);
    }
    renderSocialLinks([], null);
  }
}

function renderSocialLinks(links, description) {
  if (!shadowRoot) return;
  const socialsEl = shadowRoot.getElementById('project-socials');
  if (socialsEl) {
    if (links.length > 0) {
      socialsEl.innerHTML = links.map(s =>
        `<a class="project-social-link" data-url="${esc(s.url)}">${s.icon}<span>${esc(s.label)}</span></a>`
      ).join('');
      socialsEl.querySelectorAll('.project-social-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          openUrl(link.dataset.url);
        });
      });
    } else {
      socialsEl.innerHTML = '';
    }
  }

  const aboutSection = shadowRoot.getElementById('project-about');
  if (aboutSection) {
    if (description) {
      aboutSection.style.display = 'block';
      const aboutTextEl = shadowRoot.getElementById('project-about-text');
      const fullDesc = description;
      const shortDesc = fullDesc.slice(0, 200) + (fullDesc.length > 200 ? '...' : '');
      if (aboutTextEl) aboutTextEl.textContent = shortDesc;

      // Add/update toggle button
      let toggleBtn = aboutSection.querySelector('.project-about-toggle');
      if (!toggleBtn && fullDesc.length > 200) {
        toggleBtn = document.createElement('button');
        toggleBtn.className = 'project-about-toggle';
        toggleBtn.textContent = 'Read more';
        aboutSection.appendChild(toggleBtn);
      }
      if (toggleBtn) {
        toggleBtn.textContent = 'Read more';
        toggleBtn.dataset.expanded = 'false';
        toggleBtn.style.display = fullDesc.length > 200 ? 'inline' : 'none';
        // Replace listener by cloning
        const newToggle = toggleBtn.cloneNode(true);
        toggleBtn.replaceWith(newToggle);
        newToggle.addEventListener('click', () => {
          const expanded = newToggle.dataset.expanded === 'true';
          if (expanded) {
            aboutTextEl.textContent = shortDesc;
            newToggle.textContent = 'Read more';
            newToggle.dataset.expanded = 'false';
          } else {
            aboutTextEl.textContent = fullDesc;
            newToggle.textContent = 'Show less';
            newToggle.dataset.expanded = 'true';
          }
        });
      }
    } else {
      aboutSection.style.display = 'none';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   TRENDING CASHTAGS
   ═══════════════════════════════════════════════════════════════ */

function updateTrending(trendingMap) {
  if (!shadowRoot) return;
  const list = shadowRoot.getElementById('trending-list');
  if (!list) return;

  const sorted = [...trendingMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sorted.length === 0) {
    list.innerHTML = '<span class="sidebar-empty">No cashtags found yet</span>';
    return;
  }

  const maxCount = sorted[0][1];
  list.innerHTML = sorted.map(([ticker, count]) => {
    const isHot = count >= Math.max(5, maxCount * 0.6);
    return `<button class="sidebar-pill${isHot ? ' hot' : ''}" data-symbol="${esc(ticker)}">$${esc(ticker)} <span class="sidebar-pill-count">\u00D7${count}</span></button>`;
  }).join('');

  list.querySelectorAll('.sidebar-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sym = pill.dataset.symbol;
      if (sym) showProjectDetail(sym);
    });
  });
}

/**
 * Update feed mentions section — called from content-script every 10s
 */
function updateFeedMentions(feedMap) {
  if (!shadowRoot) return;
  const pillsEl = shadowRoot.getElementById('feed-pills');
  if (!pillsEl) return;

  const sorted = [...feedMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sorted.length === 0) {
    pillsEl.innerHTML = '<span class="sidebar-empty">No cashtags in view</span>';
    return;
  }

  const maxCount = sorted[0][1];
  pillsEl.innerHTML = sorted.map(([ticker, count]) => {
    const isHot = count >= Math.max(3, maxCount * 0.6);
    return `<button class="sidebar-pill${isHot ? ' hot' : ''}" data-symbol="${esc(ticker)}">$${esc(ticker)} <span class="sidebar-pill-count">\u00D7${count}</span></button>`;
  }).join('');

  pillsEl.querySelectorAll('.sidebar-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sym = pill.dataset.symbol;
      if (sym) showProjectDetail(sym);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR SEARCH HISTORY
   ═══════════════════════════════════════════════════════════════ */

const SEARCH_HISTORY_KEY = 'spectre_search_history';
const MAX_SEARCH_HISTORY = 10;

async function loadSearchHistory() {
  try {
    const result = await chrome.storage.local.get(SEARCH_HISTORY_KEY);
    return result[SEARCH_HISTORY_KEY] || [];
  } catch { return []; }
}

async function saveToSearchHistory(coin) {
  try {
    const history = await loadSearchHistory();
    // Remove duplicate if exists (by symbol)
    const filtered = history.filter(h => h.symbol !== coin.symbol);
    // Prepend new entry
    filtered.unshift({
      symbol: coin.symbol,
      name: coin.name,
      image: coin.image || null,
      timestamp: Date.now(),
    });
    // Keep only MAX entries
    const trimmed = filtered.slice(0, MAX_SEARCH_HISTORY);
    await chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: trimmed });
  } catch { /* storage may be unavailable */ }
}

async function removeFromSearchHistory(symbol) {
  try {
    const history = await loadSearchHistory();
    const filtered = history.filter(h => h.symbol !== symbol);
    await chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: filtered });
  } catch { /* storage may be unavailable */ }
}

async function renderSearchHistory(resultsEl) {
  if (!resultsEl) return;
  const history = await loadSearchHistory();
  if (history.length === 0) {
    resultsEl.innerHTML = '<div class="sidebar-search-empty">Type to search tokens by name or symbol</div>';
    return;
  }

  resultsEl.innerHTML = `
    <div class="sidebar-search-history-header">
      <span class="sidebar-search-history-label">RECENT SEARCHES</span>
    </div>
    ${history.map(h => {
      const imgHtml = h.image
        ? `<img src="${esc(h.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : `<span style="font-weight:700;font-size:11px;color:rgba(245,245,247,0.5)">${esc((h.symbol || '?')[0])}</span>`;
      return `
        <div class="sidebar-search-token sidebar-search-history-item" data-symbol="${esc(h.symbol)}">
          <div class="sidebar-search-token-logo">${imgHtml}</div>
          <div class="sidebar-search-token-info">
            <span class="sidebar-search-token-symbol">${esc(h.symbol)}</span>
            <span class="sidebar-search-token-name">${esc(h.name)}</span>
          </div>
          <button class="sidebar-search-history-remove" data-remove-symbol="${esc(h.symbol)}" title="Remove">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>`;
    }).join('')}
  `;

  // Click to open project detail
  resultsEl.querySelectorAll('.sidebar-search-history-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't trigger if they clicked the remove button
      if (e.target.closest('.sidebar-search-history-remove')) return;
      const symbol = el.dataset.symbol;
      if (symbol) {
        const overlay = shadowRoot?.getElementById('sidebar-search-overlay');
        const input = shadowRoot?.getElementById('sidebar-search-input');
        if (overlay) overlay.classList.remove('active');
        if (input) input.value = '';
        showProjectDetail(symbol);
      }
    });
  });

  // Remove buttons
  resultsEl.querySelectorAll('.sidebar-search-history-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.removeSymbol;
      if (symbol) {
        await removeFromSearchHistory(symbol);
        await renderSearchHistory(resultsEl);
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR SEARCH
   ═══════════════════════════════════════════════════════════════ */

async function sidebarSearchTokens(query, resultsEl, overlayEl, inputEl) {
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="sidebar-search-loading"><div class="spectre-skeleton-card"><div class="spectre-skeleton-circle"></div><div class="spectre-skeleton-lines"><div class="spectre-skeleton-line w60"></div><div class="spectre-skeleton-line w40"></div></div><div class="spectre-skeleton-right"><div class="spectre-skeleton-price"></div><div class="spectre-skeleton-change"></div></div></div></div>';

  try {
    if (!chrome.runtime?.id) {
      resultsEl.innerHTML = '<div class="sidebar-search-empty">Extension context lost — reload page</div>';
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: 'SEARCH_TOKENS', query });
    if (!response?.results || response.results.length === 0) {
      resultsEl.innerHTML = '<div class="sidebar-search-empty">No results found</div>';
      return;
    }

    resultsEl.innerHTML = response.results.map(coin => {
      const change = parseFloat(coin.change24) || 0;
      const isUp = change >= 0;
      const imgHtml = coin.image
        ? `<img src="${esc(coin.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : `<span style="font-weight:700;font-size:11px;color:rgba(245,245,247,0.5)">${esc((coin.symbol || '?')[0])}</span>`;
      return `
        <div class="sidebar-search-token" data-symbol="${esc(coin.symbol)}">
          <div class="sidebar-search-token-logo">${imgHtml}</div>
          <div class="sidebar-search-token-info">
            <span class="sidebar-search-token-symbol">${esc(coin.symbol)}</span>
            <span class="sidebar-search-token-name">${esc(coin.name)}</span>
          </div>
          <div class="sidebar-search-token-right">
            ${coin.price != null
              ? `<span class="sidebar-search-token-price">${fmtPrice(coin.price)}</span>
                 <span class="sidebar-search-token-change ${isUp ? 'positive' : 'negative'}">${isUp ? '+' : ''}${change.toFixed(2)}%</span>`
              : ''
            }
          </div>
        </div>`;
    }).join('');

    // Click to show project detail + save to history
    resultsEl.querySelectorAll('.sidebar-search-token').forEach(el => {
      el.addEventListener('click', () => {
        const symbol = el.dataset.symbol;
        if (symbol) {
          // Find the coin data for history
          const coin = response.results.find(c => c.symbol === symbol);
          if (coin) {
            saveToSearchHistory({ symbol: coin.symbol, name: coin.name, image: coin.image });
          }
          overlayEl.classList.remove('active');
          if (inputEl) inputEl.value = '';
          showProjectDetail(symbol);
        }
      });
    });
  } catch {
    resultsEl.innerHTML = '<div class="sidebar-search-empty">Search failed</div>';
  }
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function setTextById(id, text) {
  const el = shadowRoot?.getElementById(id);
  if (el) el.textContent = text;
}

function fmtPrice(p) {
  const v = parseFloat(p);
  if (isNaN(v)) return '$--';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(2);
  if (v >= 0.01) return '$' + v.toFixed(4);
  return '$' + v.toFixed(6);
}

function fmtLarge(v) {
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return '--';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + n.toFixed(0);
}

function formatLargeNum(value) {
  const v = parseFloat(value);
  if (isNaN(v) || v === 0) return '--';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR STYLES — Shared popup.css design system + overrides
   ═══════════════════════════════════════════════════════════════ */

function getSidebarStyles() {
  return "\n    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;1,400&family=Space+Grotesk:wght@500;600&display=swap');\n\n    * { box-sizing: border-box; margin: 0; padding: 0; }\n\n    /* ═══════════════════════════════════════════════════════════════\n       TOKENS — dark default, flipped by .day-mode on root\n       ═══════════════════════════════════════════════════════════════ */\n    :host {\n      --sp-bg-base: #0c0c0e;\n      --sp-bg-surface: #131315;\n      --sp-glass-bg: rgba(9, 9, 11, 0.78);\n      --sp-glass-gradient: radial-gradient(ellipse 120% 80% at 20% 0%, rgba(255,255,255,0.10) 0%, transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.015) 100%);\n      --sp-shadow-card: inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.22), 0 6px 18px rgba(0,0,0,0.38), 0 1px 2px rgba(0,0,0,0.25);\n      --sp-glass-bg-light: rgba(255, 255, 255, 0.03);\n      --sp-glass-border: rgba(255, 255, 255, 0.07);\n      --sp-glass-border-strong: rgba(255, 255, 255, 0.12);\n      --sp-glass-highlight: rgba(255, 255, 255, 0.10);\n      --sp-text-primary: #f5f5f7;\n      --sp-text-secondary: rgba(245, 245, 247, 0.66);\n      --sp-text-tertiary: rgba(245, 245, 247, 0.48);\n      --sp-text-muted: rgba(245, 245, 247, 0.28);\n      --sp-bull: #10B981;\n      --sp-bull-bright: #34D399;\n      --sp-bull-muted: rgba(16, 185, 129, 0.12);\n      --sp-bear: #EF4444;\n      --sp-bear-bright: #F87171;\n      --sp-bear-muted: rgba(239, 68, 68, 0.12);\n      --sp-warning: #F59E0B;\n      --sp-warning-muted: rgba(245, 158, 11, 0.15);\n      --sp-btc: #F7931A;\n      --sp-eth: #627EEA;\n      --sp-sol: #14F195;\n      --sp-ease: cubic-bezier(0.16, 1, 0.3, 1);\n    }\n\n    .spectre-sidebar-app.day-mode .cwb-stat-card,\n    .spectre-sidebar-app.day-mode .cwb-featured-card,\n    .spectre-sidebar-app.day-mode .cwb-price-card {\n      background: #ffffff;\n      border: 1px solid rgba(10, 10, 12, 0.08);\n      box-shadow:\n        inset 0 1px 0 rgba(255, 255, 255, 1),\n        inset 0 -1px 0 rgba(10, 10, 12, 0.04),\n        0 1px 2px rgba(10, 10, 12, 0.04),\n        0 8px 20px rgba(10, 10, 12, 0.06);\n    }\n    .spectre-sidebar-app.day-mode .cwb-stat-card:hover,\n    .spectre-sidebar-app.day-mode .cwb-featured-card:hover,\n    .spectre-sidebar-app.day-mode .cwb-price-card:hover {\n      border-color: rgba(10, 10, 12, 0.14);\n      box-shadow:\n        inset 0 1px 0 rgba(255, 255, 255, 1),\n        0 2px 4px rgba(10, 10, 12, 0.05),\n        0 12px 28px rgba(10, 10, 12, 0.08);\n    }\n    .spectre-sidebar-app.day-mode .cab-container {\n      background: #ffffff;\n      border: 1px solid rgba(10, 10, 12, 0.08);\n      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 1), 0 8px 20px rgba(10, 10, 12, 0.05);\n    }\n    .spectre-sidebar-app.day-mode .sidebar-pill {\n      background: #ffffff;\n      border-color: rgba(10, 10, 12, 0.10);\n      color: rgba(10, 10, 12, 0.72);\n      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 1), 0 1px 2px rgba(10, 10, 12, 0.04);\n    }\n    .spectre-sidebar-app.day-mode .sidebar-pill:hover {\n      border-color: rgba(10, 10, 12, 0.18);\n      color: #0a0a0c;\n    }\n    .spectre-sidebar-app.day-mode {\n      background:\n        radial-gradient(ellipse 100% 30% at 50% 0%, rgba(139, 92, 246, 0.05) 0%, transparent 70%),\n        linear-gradient(180deg, #ffffff 0%, #f7f7f9 100%) !important;\n      --sp-bg-base: #ffffff;\n      --sp-bg-surface: #fafafa;\n      --sp-glass-bg: rgba(255, 255, 255, 0.82);\n      --sp-glass-gradient: radial-gradient(ellipse 120% 80% at 20% 0%, rgba(255,255,255,0.9) 0%, transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.72) 100%);\n      --sp-shadow-card: inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(16,24,40,0.05), 0 1px 2px rgba(16,24,40,0.04), 0 6px 18px rgba(16,24,40,0.08);\n      --sp-glass-bg-light: rgba(0, 0, 0, 0.02);\n      --sp-glass-border: rgba(10, 10, 12, 0.08);\n      --sp-glass-border-strong: rgba(10, 10, 12, 0.14);\n      --sp-glass-highlight: rgba(0, 0, 0, 0.04);\n      --sp-text-primary: #0a0a0c;\n      --sp-text-secondary: rgba(10, 10, 12, 0.66);\n      --sp-text-tertiary: rgba(10, 10, 12, 0.48);\n      --sp-text-muted: rgba(10, 10, 12, 0.28);\n      --sp-bull: #059669;\n      --sp-bull-bright: #10B981;\n      --sp-bull-muted: rgba(16, 185, 129, 0.10);\n      --sp-bear: #DC2626;\n      --sp-bear-bright: #EF4444;\n      --sp-bear-muted: rgba(239, 68, 68, 0.08);\n      --sp-warning: #D97706;\n      --sp-warning-muted: rgba(245, 158, 11, 0.12);\n    }\n\n    /* ═══════════════════════════════════════════════════════════════\n       SHELL — Glass panel injected onto X\n       Semi-transparent so timeline blur glows through the edge\n       ═══════════════════════════════════════════════════════════════ */\n    .spectre-sidebar-app,\n    .spectre-popup-app {\n      position: relative;\n      display: flex;\n      flex-direction: column;\n      width: 100%;\n      height: 100vh;\n      background: #000000;\n      border-left: 1px solid var(--sp-glass-border);\n      box-shadow: -24px 0 60px rgba(0,0,0,0.55);\n      color: var(--sp-text-primary);\n      font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;\n      font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';\n      overflow-y: auto;\n      -webkit-font-smoothing: antialiased;\n      -moz-osx-font-smoothing: grayscale;\n      transition: background 0.25s var(--sp-ease), color 0.25s var(--sp-ease);\n    }\n    .spectre-sidebar-app::-webkit-scrollbar { width: 0px; }\n    .spectre-sidebar-app::-webkit-scrollbar-track { background: transparent; }\n    .spectre-sidebar-app::-webkit-scrollbar-thumb { background: transparent; }\n    .spectre-sidebar-app { scrollbar-width: none; -ms-overflow-style: none; }\n\n    .spectre-edge { display: none; }\n\n    /* ═══ HEADER ═══ */\n    .spectre-header {\n      display: flex; align-items: center; justify-content: space-between;\n      padding: 16px 18px 12px;\n      background: #000000;\n      position: sticky; top: 0; z-index: 20;\n    }\n    .spectre-sidebar-app.day-mode .spectre-header {\n      background: #ffffff;\n      border-bottom: 1px solid rgba(10, 10, 12, 0.06);\n    }\n    .spectre-header::after {\n      content: ''; position: absolute; bottom: 0; left: 18px; right: 18px; height: 1px;\n      background: linear-gradient(90deg, transparent, var(--sp-glass-border-strong), transparent);\n    }\n    .spectre-brand { display: flex; align-items: center; gap: 10px; }\n    .spectre-logo {\n      width: 22px; height: 22px; border-radius: 6px;\n      box-shadow: 0 0 0 1px var(--sp-glass-border-strong);\n    }\n    .spectre-brand-text {\n      font-family: 'Space Grotesk', 'Inter', sans-serif;\n      font-weight: 600; font-size: 14px;\n      letter-spacing: -0.01em;\n      color: var(--sp-text-primary);\n    }\n    .spectre-header-actions { display: flex; align-items: center; gap: 4px; }\n    .spectre-icon-btn {\n      width: 32px; height: 32px; border-radius: 8px;\n      border: 1px solid transparent;\n      background: transparent;\n      color: var(--sp-text-tertiary);\n      cursor: pointer;\n      display: flex; align-items: center; justify-content: center;\n      padding: 7px;\n      transition: color 150ms var(--sp-ease), background 150ms var(--sp-ease), border-color 150ms var(--sp-ease);\n    }\n    .spectre-icon-btn:hover {\n      color: var(--sp-text-primary);\n      background: var(--sp-glass-highlight);\n      border-color: var(--sp-glass-border);\n    }\n\n    /* ═══ TAB BAR ═══ */\n    .spectre-tab-bar {\n      display: flex; gap: 4px;\n      padding: 10px 14px 6px;\n    }\n    .spectre-tab {\n      flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;\n      padding: 9px 12px; border-radius: 8px;\n      border: none; background: transparent;\n      color: var(--sp-text-tertiary);\n      font-family: 'Inter', sans-serif;\n      font-size: 12px; font-weight: 500;\n      letter-spacing: -0.005em;\n      cursor: pointer;\n      transition: color 150ms var(--sp-ease), background 150ms var(--sp-ease);\n    }\n    .spectre-tab svg { opacity: 0.7; }\n    .spectre-tab:hover { color: var(--sp-text-secondary); background: var(--sp-glass-bg-light); }\n    .spectre-tab.active {\n      color: var(--sp-text-primary);\n      background: var(--sp-glass-bg-light);\n      box-shadow: inset 0 0 0 1px var(--sp-glass-border);\n    }\n    .spectre-tab.active svg { opacity: 1; }\n\n    .spectre-tab-content { display: none; padding: 4px 14px 20px; }\n    .spectre-tab-content.active { display: block; }\n\n    /* ═══ SECTION LABEL ═══ */\n    .spectre-section { margin: 16px 0 0; }\n    .spectre-section-label {\n      display: block;\n      font-family: 'Inter', sans-serif;\n      font-size: 9.5px; font-weight: 600;\n      letter-spacing: 0.14em; text-transform: uppercase;\n      color: var(--sp-text-tertiary);\n      margin-bottom: 10px;\n    }\n\n    /* ═══ AI BRIEF ═══ */\n    .cab-container {\n      position: relative;\n      padding: 16px 18px;\n      border-radius: 16px;\n      background: var(--sp-glass-gradient);\n      border: 1px solid var(--sp-glass-border);\n      box-shadow: var(--sp-shadow-card);\n      box-shadow: inset 0 1px 0 var(--sp-glass-highlight), 0 4px 16px rgba(0,0,0,0.3);\n      backdrop-filter: blur(20px) saturate(180%);\n      -webkit-backdrop-filter: blur(20px) saturate(180%);\n      margin: 14px 0 4px;\n      overflow: hidden;\n    }\n    .cab-glow {\n      position: absolute; inset: 0;\n      background:\n        radial-gradient(ellipse 60% 40% at 0% 0%, var(--sp-glass-highlight) 0%, transparent 60%),\n        radial-gradient(ellipse 40% 40% at 100% 100%, rgba(139, 92, 246, 0.04) 0%, transparent 60%);\n      pointer-events: none;\n    }\n    .cab-eyebrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; position: relative; }\n    .cab-eyebrow-left { display: inline-flex; align-items: center; gap: 6px; }\n    .cab-pulse {\n      width: 6px; height: 6px; border-radius: 50%;\n      background: var(--sp-bull);\n      box-shadow: 0 0 8px var(--sp-bull-muted);\n      animation: spLive 2s ease-in-out infinite;\n    }\n    @keyframes spLive { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.8); } }\n    .cab-label {\n      font-size: 9.5px; font-weight: 700; letter-spacing: 0.18em;\n      color: var(--sp-text-secondary); text-transform: uppercase;\n    }\n    .cab-live-badge {\n      font-size: 9px; font-weight: 700; letter-spacing: 0.14em;\n      padding: 2px 7px; border-radius: 999px;\n      background: var(--sp-bull-muted); color: var(--sp-bull-bright);\n    }\n    .cab-statement {\n      font-family: 'Playfair Display', Georgia, serif;\n      font-size: 15px; font-weight: 400; font-style: italic;\n      line-height: 1.45;\n      color: var(--sp-text-primary);\n      position: relative; z-index: 1;\n      transition: opacity 0.4s var(--sp-ease), transform 0.4s var(--sp-ease);\n    }\n    .cab-statement-visible { opacity: 1; transform: translateY(0); }\n    .cab-statement-fading { opacity: 0; transform: translateY(-4px); }\n    .cab-quote-mark {\n      font-family: 'Playfair Display', Georgia, serif;\n      color: var(--sp-text-tertiary);\n      font-size: 20px; line-height: 0; vertical-align: -4px; margin: 0 2px;\n    }\n    .cab-rotation-nav { display: flex; gap: 5px; margin-top: 12px; position: relative; z-index: 1; }\n    .cab-rotation-dot {\n      width: 14px; height: 3px; border-radius: 3px; padding: 0;\n      background: var(--sp-glass-highlight);\n      border: none; cursor: pointer;\n      transition: background 150ms var(--sp-ease);\n    }\n    .cab-rotation-dot.active { background: var(--sp-text-primary); }\n    .cab-dot-fill { display: none; }\n    .cab-attribution {\n      display: flex; align-items: center; gap: 4px; margin-top: 8px;\n      font-size: 10px; color: var(--sp-text-tertiary);\n      position: relative; z-index: 1;\n    }\n    .cab-attribution-dash { color: var(--sp-text-muted); }\n    .cab-attribution-name { font-weight: 600; letter-spacing: 0.04em; color: var(--sp-text-secondary); }\n    .cab-attribution-dot { color: var(--sp-text-muted); }\n    .cab-attribution-time { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--sp-text-muted); }\n\n    /* ═══ MENTIONED IN FEED / TRENDING ═══ */\n    .sidebar-feed-pills, .sidebar-trending-pills {\n      display: flex; flex-wrap: wrap; gap: 5px;\n    }\n    .sidebar-feed-pills .feed-pill,\n    .sidebar-trending-pills .trending-pill,\n    .sidebar-feed-pills > span,\n    .sidebar-trending-pills > span {\n      display: inline-flex; align-items: center; gap: 4px;\n      padding: 5px 10px; border-radius: 999px;\n      background: var(--sp-glass-bg-light); border: 1px solid var(--sp-glass-border);\n      color: var(--sp-text-secondary);\n      font-size: 11px; font-weight: 500; letter-spacing: -0.01em;\n      cursor: pointer;\n      transition: all 150ms var(--sp-ease);\n    }\n    .sidebar-feed-pills .feed-pill:hover,\n    .sidebar-trending-pills .trending-pill:hover {\n      background: var(--sp-glass-highlight);\n      border-color: var(--sp-glass-border-strong);\n      color: var(--sp-text-primary);\n    }\n    .sidebar-empty {\n      font-size: 11px; color: var(--sp-text-muted);\n      font-style: italic; padding: 4px 0;\n      background: transparent !important; border: none !important; cursor: default !important;\n    }\n    /* Mentioned-in-feed + trending chips */\n    .sidebar-feed-pills button.sidebar-pill,\n    .sidebar-trending-pills button.sidebar-pill,\n    button.sidebar-pill {\n      -webkit-appearance: none; appearance: none;\n      display: inline-flex; align-items: center; gap: 5px;\n      padding: 5px 10px 5px 9px;\n      background: var(--sp-glass-gradient);\n      border: 1px solid var(--sp-glass-border);\n      border-radius: 999px;\n      box-shadow: var(--sp-shadow-card);\n      color: var(--sp-text-secondary);\n      font-family: 'JetBrains Mono', 'SF Mono', monospace;\n      font-size: 10.5px; font-weight: 600; letter-spacing: -0.01em;\n      cursor: pointer;\n      transition: border-color 150ms var(--sp-ease), transform 150ms var(--sp-ease), color 150ms var(--sp-ease);\n    }\n    .sidebar-pill:hover {\n      border-color: var(--sp-glass-border-strong);\n      color: var(--sp-text-primary);\n      transform: translateY(-1px);\n    }\n    .sidebar-pill.hot {\n      background: var(--sp-bull-muted);\n      border-color: rgba(16,185,129,0.22);\n      color: var(--sp-bull-bright);\n      box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(16,185,129,0.12);\n    }\n    .sidebar-pill.hot:hover {\n      border-color: rgba(16,185,129,0.35);\n    }\n    .sidebar-pill-count {\n      font-size: 9.5px; font-weight: 500;\n      color: var(--sp-text-muted);\n      padding-left: 2px;\n    }\n    .sidebar-pill.hot .sidebar-pill-count {\n      color: rgba(52,211,153,0.72);\n    }\n\n    /* ═══ FEATURED ROW (BTC/ETH/SOL) ═══ */\n    .spectre-featured-row {\n      display: flex; gap: 8px;\n    }\n    .cwb-featured-card {\n      flex: 1; min-width: 0; position: relative;\n      padding: 12px 10px 10px;\n      border-radius: 12px;\n      background: var(--sp-glass-gradient);\n      border: 1px solid var(--sp-glass-border);\n      box-shadow: var(--sp-shadow-card);\n      display: flex; flex-direction: column; align-items: center; gap: 6px;\n      cursor: pointer; overflow: hidden;\n      transition: transform 250ms var(--sp-ease), border-color 250ms var(--sp-ease);\n    }\n    .cwb-featured-card:hover { transform: translateY(-1px); border-color: var(--sp-glass-border-strong); }\n    .cwb-price-corner { display: none; }\n    .cwb-price-glow {\n      position: absolute; inset: 0;\n      background: radial-gradient(circle at 50% 0%, rgba(var(--brand-rgb, 139,92,246), 0.08) 0%, transparent 70%);\n      opacity: 0; pointer-events: none;\n      transition: opacity 250ms var(--sp-ease);\n    }\n    .cwb-featured-card:hover .cwb-price-glow { opacity: 1; }\n    .cwb-featured-sparkline {\n      position: absolute; inset: auto 0 0 0; height: 36px;\n      opacity: 0.35; pointer-events: none;\n      mask-image: linear-gradient(to top, rgba(0,0,0,1) 10%, transparent 100%);\n      -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,1) 10%, transparent 100%);\n    }\n    .cwb-featured-sparkline svg { width: 100%; height: 100%; display: block; }\n    .cwb-featured-logo-wrap { position: relative; width: 32px; height: 32px; }\n    .cwb-price-ring { display: none; }\n    .cwb-featured-logo {\n      width: 32px; height: 32px; border-radius: 50%;\n      background: var(--sp-glass-bg-light);\n      display: inline-flex; align-items: center; justify-content: center;\n      font-family: 'Space Grotesk', 'Inter', sans-serif;\n      font-weight: 600; font-size: 12px;\n      color: var(--sp-text-secondary); overflow: hidden;\n      box-shadow: 0 0 0 1px var(--sp-glass-border-strong);\n    }\n    .cwb-featured-logo img { width: 100%; height: 100%; object-fit: cover; }\n    .cwb-featured-symbol {\n      font-family: 'Inter', sans-serif; font-size: 10.5px; font-weight: 500;\n      letter-spacing: 0.08em; text-transform: uppercase;\n      color: var(--sp-text-tertiary);\n      position: relative; z-index: 1;\n    }\n    .cwb-featured-price {\n      font-family: 'JetBrains Mono', monospace;\n      font-size: 12.5px; font-weight: 600;\n      color: var(--sp-text-primary); letter-spacing: -0.02em;\n      position: relative; z-index: 1;\n    }\n    .cwb-featured-change {\n      display: inline-flex; align-items: center; gap: 2px;\n      font-family: 'JetBrains Mono', monospace;\n      font-size: 10.5px; font-weight: 600; letter-spacing: -0.01em;\n      padding: 2px 7px; border-radius: 999px;\n      position: relative; z-index: 1;\n    }\n    .cwb-featured-change.positive { color: var(--sp-bull-bright); background: var(--sp-bull-muted); }\n    .cwb-featured-change.negative { color: var(--sp-bear-bright); background: var(--sp-bear-muted); }\n    .cwb-featured-change-arrow { font-size: 7px; }\n\n    /* ═══ MARKET GRID ═══ */\n    .spectre-market-grid {\n      display: grid; grid-template-columns: 1fr 1fr; gap: 8px;\n    }\n    .cwb-stat-card {\n      position: relative;\n      padding: 12px 14px; border-radius: 12px;\n      background: var(--sp-glass-gradient);\n      border: 1px solid var(--sp-glass-border);\n      box-shadow: var(--sp-shadow-card);\n      min-height: 90px;\n      display: flex; flex-direction: column; gap: 8px;\n      overflow: hidden;\n    }\n    .cwb-stat-header { display: flex; align-items: center; justify-content: space-between; }\n    .cwb-stat-label {\n      font-size: 9px; font-weight: 600; letter-spacing: 0.12em;\n      text-transform: uppercase; color: var(--sp-text-tertiary);\n    }\n    .cwb-stat-live-dot {\n      width: 5px; height: 5px; border-radius: 50%;\n      background: var(--sp-bull);\n      box-shadow: 0 0 6px var(--sp-bull-muted);\n      animation: spLive 2s ease-in-out infinite;\n    }\n    .cwb-stat-body { display: flex; align-items: baseline; gap: 6px; }\n    .cwb-stat-value {\n      font-family: 'JetBrains Mono', monospace;\n      font-size: 22px; font-weight: 600; letter-spacing: -0.03em;\n      color: var(--sp-text-primary); line-height: 1;\n    }\n    .cwb-stat-sublabel {\n      font-size: 10px; font-weight: 500;\n      color: var(--sp-text-tertiary); text-transform: capitalize;\n    }\n    /* F&G */\n    .cwb-fng-bar { display: flex; flex-direction: column; gap: 4px; margin-top: auto; }\n    .cwb-fng-track {\n      position: relative; height: 4px; border-radius: 2px;\n      background: linear-gradient(90deg, var(--sp-bear) 0%, var(--sp-warning) 50%, var(--sp-bull) 100%);\n      opacity: 0.85;\n    }\n    .cwb-fng-indicator {\n      position: absolute; top: 50%; width: 8px; height: 8px; border-radius: 50%;\n      background: var(--sp-text-primary); transform: translate(-50%, -50%);\n      box-shadow: 0 0 0 2px var(--sp-bg-base), 0 0 8px rgba(0,0,0,0.4);\n      transition: left 0.4s var(--sp-ease);\n    }\n    .cwb-fng-range {\n      display: flex; justify-content: space-between;\n      font-size: 9px; color: var(--sp-text-muted);\n      letter-spacing: 0.06em; text-transform: uppercase;\n    }\n    /* Dominance */\n    .cwb-dom-bar {\n      display: flex; height: 8px; border-radius: 4px; overflow: hidden;\n      background: var(--sp-glass-bg-light); margin-top: 4px;\n    }\n    .cwb-dom-seg { height: 100%; transition: width 0.4s var(--sp-ease); }\n    .cwb-dom-btc { background: var(--sp-btc); }\n    .cwb-dom-eth { background: var(--sp-eth); }\n    .cwb-dom-sol { background: var(--sp-sol); }\n    .cwb-dom-alts { background: var(--sp-text-muted); }\n    .cwb-dom-legend {\n      display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;\n      font-size: 9px; color: var(--sp-text-tertiary); margin-top: auto;\n    }\n    .cwb-dom-legend > span { display: inline-flex; align-items: center; gap: 3px; font-weight: 500; }\n    .cwb-dom-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; }\n    /* MCap */\n    .cwb-mcap-value-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }\n    .cwb-mcap-value {\n      font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 600;\n      color: var(--sp-text-primary); letter-spacing: -0.02em; line-height: 1.1;\n    }\n    .cwb-mcap-change {\n      font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600;\n      padding: 1px 6px; border-radius: 999px;\n    }\n    .cwb-mcap-change.positive { color: var(--sp-bull-bright); background: var(--sp-bull-muted); }\n    .cwb-mcap-change.negative { color: var(--sp-bear-bright); background: var(--sp-bear-muted); }\n    .cwb-mcap-vol {\n      font-family: 'JetBrains Mono', monospace; font-size: 10.5px;\n      color: var(--sp-text-tertiary); letter-spacing: -0.01em; margin-top: auto;\n    }\n    /* US market */\n    .cwb-usmarket-body { display: flex; align-items: baseline; gap: 6px; }\n    .cwb-market-dot {\n      width: 6px; height: 6px; border-radius: 50%;\n      background: var(--sp-bear); box-shadow: 0 0 6px rgba(239,68,68,0.35);\n    }\n    .cwb-usmarket.open .cwb-market-dot { background: var(--sp-bull); box-shadow: 0 0 6px rgba(16,185,129,0.35); }\n    .cwb-market-label {\n      font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 600;\n      letter-spacing: -0.02em; color: var(--sp-bear-bright);\n    }\n    .cwb-usmarket.open .cwb-market-label { color: var(--sp-bull-bright); }\n    .cwb-market-time { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--sp-text-tertiary); margin-top: auto; }\n\n    /* ═══ WATCHLIST PRICE LIST ═══ */\n    .spectre-price-list {\n      display: flex; flex-direction: column; gap: 6px;\n    }\n    .cwb-price-card {\n      display: grid;\n      grid-template-columns: 30px 1fr 64px auto;\n      align-items: center; gap: 10px;\n      padding: 11px 12px; border-radius: 12px;\n      background: var(--sp-glass-gradient);\n      border: 1px solid var(--sp-glass-border);\n      box-shadow: var(--sp-shadow-card);\n      cursor: pointer; position: relative; overflow: hidden;\n      transition: border-color 150ms var(--sp-ease), transform 150ms var(--sp-ease);\n    }\n    .cwb-price-card:hover { border-color: var(--sp-glass-border-strong); transform: translateX(1px); }\n    .cwb-price-sparkline, .cwb-price-sparkline-placeholder {\n      width: 64px; height: 26px; pointer-events: none;\n      color: var(--sp-text-primary);\n    }\n    .cwb-price-sparkline-placeholder { background: transparent; }\n    .cwb-price-sparkline svg { width: 100%; height: 100%; display: block; }\n    .cwb-price-logo {\n      width: 28px; height: 28px; border-radius: 50%;\n      background: var(--sp-glass-bg-light);\n      box-shadow: 0 0 0 1px var(--sp-glass-border-strong);\n      display: inline-flex; align-items: center; justify-content: center;\n      overflow: hidden;\n      font-family: 'Space Grotesk', sans-serif;\n      font-weight: 600; font-size: 11px; color: var(--sp-text-secondary);\n    }\n    .cwb-price-logo img { width: 100%; height: 100%; object-fit: cover; }\n    .cwb-price-identity { display: flex; flex-direction: column; min-width: 0; }\n    .cwb-price-symbol { font-size: 12.5px; font-weight: 600; color: var(--sp-text-primary); letter-spacing: -0.01em; }\n    .cwb-price-name { font-size: 10.5px; color: var(--sp-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n    .cwb-price-price {\n      font-family: 'JetBrains Mono', monospace; font-size: 12.5px; font-weight: 600;\n      color: var(--sp-text-primary); letter-spacing: -0.02em; text-align: right;\n    }\n    .cwb-price-change {\n      font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600;\n      padding: 2px 7px; border-radius: 999px; letter-spacing: -0.01em;\n    }\n    .cwb-price-change.positive { color: var(--sp-bull-bright); background: var(--sp-bull-muted); }\n    .cwb-price-change.negative { color: var(--sp-bear-bright); background: var(--sp-bear-muted); }\n    .cwb-remove-btn {\n      width: 20px; height: 20px; border-radius: 50%;\n      color: var(--sp-text-muted); background: transparent; border: none; cursor: pointer;\n      display: inline-flex; align-items: center; justify-content: center;\n      opacity: 0; transition: opacity 150ms var(--sp-ease), color 150ms var(--sp-ease);\n    }\n    .cwb-price-card:hover .cwb-remove-btn { opacity: 1; }\n    .cwb-remove-btn:hover { color: var(--sp-bear-bright); }\n\n    /* Skeletons */\n    .spectre-skeleton-card {\n      display: flex; align-items: center; gap: 10px;\n      padding: 10px 12px; border-radius: 12px;\n      background: var(--sp-glass-bg-light); border: 1px solid var(--sp-glass-border);\n    }\n    .spectre-skeleton-circle { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }\n    .spectre-skeleton-circle, .spectre-skeleton-line, .spectre-skeleton-price, .spectre-skeleton-change {\n      background: linear-gradient(90deg, var(--sp-glass-bg-light) 25%, var(--sp-glass-highlight) 50%, var(--sp-glass-bg-light) 75%);\n      background-size: 200% 100%; animation: spSkel 1.8s ease-in-out infinite;\n      border-radius: 4px;\n    }\n    @keyframes spSkel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }\n    .spectre-skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 5px; }\n    .spectre-skeleton-line { height: 9px; }\n    .spectre-skeleton-line.w60 { width: 60%; }\n    .spectre-skeleton-line.w40 { width: 40%; }\n    .spectre-skeleton-line.w80 { width: 80%; }\n    .spectre-skeleton-right { display: flex; flex-direction: column; gap: 5px; align-items: flex-end; }\n    .spectre-skeleton-price { width: 60px; height: 11px; }\n    .spectre-skeleton-change { width: 40px; height: 9px; }\n\n    /* ═══ PROJECT TAB ═══ */\n    .project-empty {\n      display: flex; flex-direction: column; align-items: center; justify-content: center;\n      gap: 8px; padding: 60px 24px; text-align: center; color: var(--sp-text-tertiary);\n    }\n    .project-empty-icon {\n      width: 56px; height: 56px; border-radius: 50%;\n      background: var(--sp-glass-bg-light); border: 1px solid var(--sp-glass-border);\n      display: inline-flex; align-items: center; justify-content: center;\n      color: var(--sp-text-muted); margin-bottom: 6px;\n    }\n    .project-empty-title {\n      font-family: 'Space Grotesk', sans-serif;\n      font-size: 15px; font-weight: 600; color: var(--sp-text-primary);\n      letter-spacing: -0.01em;\n    }\n    .project-empty-desc {\n      font-size: 12px; line-height: 1.4; max-width: 240px; color: var(--sp-text-tertiary);\n    }\n    .project-detail { display: flex; flex-direction: column; gap: 16px; padding-top: 10px; }\n    .project-header {\n      display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: 14px;\n    }\n    .project-logo-wrap { position: relative; width: 48px; height: 48px; }\n    .project-logo-ring {\n      position: absolute; inset: -3px; border-radius: 50%;\n      background: conic-gradient(from 90deg, var(--sp-glass-border-strong), transparent 30%, var(--sp-glass-border-strong) 60%, transparent 90%);\n      animation: spRotate 8s linear infinite; opacity: 0.5;\n    }\n    @keyframes spRotate { to { transform: rotate(360deg); } }\n    .project-logo {\n      position: relative; width: 48px; height: 48px; border-radius: 50%;\n      background: var(--sp-glass-bg-light);\n      border: 1px solid var(--sp-glass-border-strong);\n      display: inline-flex; align-items: center; justify-content: center;\n      font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 18px;\n      color: var(--sp-text-secondary); overflow: hidden;\n    }\n    .project-logo img { width: 100%; height: 100%; object-fit: cover; }\n    .project-identity { display: flex; flex-direction: column; min-width: 0; gap: 2px; }\n    .project-name {\n      font-family: 'Playfair Display', Georgia, serif;\n      font-weight: 400; font-size: 28px; letter-spacing: -0.02em;\n      color: var(--sp-text-primary); line-height: 1; text-transform: uppercase;\n      background: linear-gradient(90deg, var(--sp-text-primary) 0%, var(--sp-text-primary) 40%, var(--sp-text-secondary) 50%, var(--sp-text-primary) 60%, var(--sp-text-primary) 100%);\n      background-size: 200% 100%;\n      -webkit-background-clip: text; background-clip: text;\n      -webkit-text-fill-color: transparent;\n      animation: spShimmer 10s linear infinite;\n    }\n    @keyframes spShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }\n    .project-meta {\n      font-family: 'JetBrains Mono', monospace;\n      font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;\n      color: var(--sp-text-tertiary);\n    }\n    .project-pulse-badge {\n      display: inline-flex; align-items: center; gap: 5px;\n      padding: 5px 10px; border-radius: 999px;\n      background: var(--sp-warning-muted); color: var(--sp-warning);\n      font-family: 'JetBrains Mono', monospace;\n      font-size: 9.5px; font-weight: 700; letter-spacing: 0.12em;\n      text-transform: uppercase;\n      align-self: flex-start;\n    }\n    .project-pulse-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: spLive 2s ease-in-out infinite; }\n    .project-pulse-badge.risk-on { background: var(--sp-bull-muted); color: var(--sp-bull-bright); }\n    .project-pulse-badge.risk-off { background: var(--sp-bear-muted); color: var(--sp-bear-bright); }\n    .project-pulse-badge.caution { background: var(--sp-warning-muted); color: var(--sp-warning); }\n    .project-pulse-badge.euphoria { background: rgba(139, 92, 246, 0.12); color: #A78BFA; }\n    .project-pulse-badge.neutral { background: var(--sp-glass-bg-light); color: var(--sp-text-secondary); }\n\n    .project-price-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }\n    .project-price {\n      font-family: 'JetBrains Mono', monospace;\n      font-size: 34px; font-weight: 700; letter-spacing: -0.04em;\n      color: var(--sp-text-primary); line-height: 1;\n    }\n    .project-change {\n      font-family: 'JetBrains Mono', monospace;\n      font-size: 13px; font-weight: 600;\n      padding: 4px 10px; border-radius: 999px; letter-spacing: -0.01em;\n    }\n    .project-change.positive { color: var(--sp-bull-bright); background: var(--sp-bull-muted); }\n    .project-change.negative { color: var(--sp-bear-bright); background: var(--sp-bear-muted); }\n\n    .project-chart {\n      position: relative; height: 140px; border-radius: 12px;\n      background: var(--sp-glass-bg-light); border: 1px solid var(--sp-glass-border);\n      overflow: hidden; padding: 10px;\n    }\n    .project-chart svg, .project-chart canvas { width: 100%; height: 100%; display: block; }\n    .project-chart-placeholder {\n      display: flex; align-items: center; justify-content: center;\n      height: 100%; color: var(--sp-text-muted);\n      font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;\n    }\n\n    .project-stats { display: flex; flex-direction: column; }\n    .project-stat-row {\n      display: flex; justify-content: space-between; align-items: center;\n      padding: 10px 2px; border-top: 1px solid var(--sp-glass-border);\n    }\n    .project-stat-row:first-child { border-top: none; padding-top: 6px; }\n    .project-stat-label { font-size: 12px; color: var(--sp-text-tertiary); }\n    .project-stat-value {\n      font-family: 'JetBrains Mono', monospace; font-size: 12.5px; font-weight: 500;\n      color: var(--sp-text-primary); letter-spacing: -0.01em; text-align: right;\n    }\n\n    .project-changes {\n      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;\n    }\n    .project-change-item {\n      display: flex; flex-direction: column; align-items: center; gap: 4px;\n      padding: 10px 4px; border-radius: 8px;\n      background: var(--sp-glass-bg-light); border: 1px solid var(--sp-glass-border);\n    }\n    .project-change-label { font-size: 9.5px; font-weight: 600; letter-spacing: 0.1em; color: var(--sp-text-tertiary); text-transform: uppercase; }\n    .project-change-val {\n      font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600;\n      letter-spacing: -0.01em; color: var(--sp-text-primary);\n    }\n    .project-change-val.positive { color: var(--sp-bull-bright); }\n    .project-change-val.negative { color: var(--sp-bear-bright); }\n\n    .project-socials { display: flex; flex-wrap: wrap; gap: 6px; }\n    .project-social-link {\n      display: inline-flex; align-items: center; gap: 5px;\n      padding: 6px 10px; border-radius: 999px;\n      background: var(--sp-glass-bg-light); border: 1px solid var(--sp-glass-border);\n      color: var(--sp-text-secondary);\n      font-size: 11px; cursor: pointer;\n      transition: border-color 150ms var(--sp-ease), color 150ms var(--sp-ease), background 150ms var(--sp-ease);\n    }\n    .project-social-link:hover {\n      border-color: var(--sp-glass-border-strong);\n      color: var(--sp-text-primary);\n      background: var(--sp-glass-highlight);\n    }\n\n    .project-about { display: flex; flex-direction: column; gap: 4px; }\n    .project-about-text {\n      font-size: 12.5px; line-height: 1.55; color: var(--sp-text-secondary);\n      font-family: 'Inter', sans-serif;\n    }\n    .project-about-toggle {\n      align-self: flex-start; margin-top: 4px;\n      font-size: 11px; font-weight: 600; color: var(--sp-text-tertiary);\n      padding: 2px 0; background: transparent; border: none; cursor: pointer;\n    }\n    .project-about-toggle:hover { color: var(--sp-text-primary); }\n\n    /* ═══ CTA BUTTON ═══ */\n    .spectre-cta-btn {\n      display: inline-flex; align-items: center; justify-content: center; gap: 10px;\n      width: 100%; padding: 15px 22px;\n      border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 999px;\n      background:\n        linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 40%),\n        linear-gradient(180deg, #1a1a1d 0%, #0a0a0c 100%);\n      color: #ffffff;\n      font-family: 'Inter', sans-serif;\n      font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em;\n      cursor: pointer; position: relative; overflow: hidden;\n      text-decoration: none;\n      box-shadow:\n        inset 0 1px 0 rgba(255, 255, 255, 0.12),\n        inset 0 -1px 0 rgba(0, 0, 0, 0.35),\n        0 6px 20px rgba(0, 0, 0, 0.45),\n        0 1px 2px rgba(0, 0, 0, 0.3);\n      transition: transform 280ms var(--sp-ease), box-shadow 280ms var(--sp-ease), border-color 280ms var(--sp-ease);\n    }\n    .spectre-cta-btn::before {\n      content: ''; position: absolute; inset: -1px;\n      border-radius: inherit;\n      background: linear-gradient(135deg, rgba(139,92,246,0.35) 0%, rgba(6,182,212,0.25) 100%);\n      opacity: 0; filter: blur(12px); z-index: -1;\n      transition: opacity 400ms var(--sp-ease);\n    }\n    .spectre-cta-btn:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.14); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.35), 0 14px 36px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.3); }\n    .spectre-cta-btn:hover::before { opacity: 1; }\n    .spectre-cta-btn span { position: relative; z-index: 1; }\n    .spectre-cta-arrow { position: relative; z-index: 1; opacity: 0.7; transition: transform 0.3s var(--sp-ease), opacity 0.3s var(--sp-ease); }\n    .spectre-cta-btn:hover .spectre-cta-arrow { opacity: 1; transform: translate(2px, -2px); }\n    .spectre-cta-btn::after {\n      content: ''; position: absolute; top: 0; left: -100%;\n      width: 60%; height: 100%;\n      background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%);\n      transition: left 0.5s var(--sp-ease); pointer-events: none;\n    }\n    .spectre-cta-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }\n    .spectre-cta-btn:hover::after { left: 120%; }\n    .spectre-cta-icon { opacity: 0.55; flex-shrink: 0; }\n    .spectre-cta-arrow { opacity: 0.45; flex-shrink: 0; transition: transform 150ms var(--sp-ease); }\n    .spectre-cta-btn:hover .spectre-cta-arrow { transform: translate(1px, -1px); opacity: 0.7; }\n\n    /* ═══ FOOTER ═══ */\n    .spectre-footer {\n      display: flex; flex-direction: column; gap: 6px;\n      padding: 14px 14px 16px; margin-top: 6px;\n      border-top: 1px solid var(--sp-glass-border);\n      background: var(--sp-glass-bg);\n      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);\n    }\n    .spectre-footer-powered {\n      font-size: 9.5px; color: var(--sp-text-muted);\n      letter-spacing: 0.06em; text-align: center;\n    }\n\n    /* ═══ SIDEBAR SEARCH OVERLAY ═══ */\n    .sidebar-search-overlay {\n      position: absolute; inset: 0;\n      background: var(--sp-glass-bg);\n      backdrop-filter: blur(28px) saturate(180%);\n      -webkit-backdrop-filter: blur(28px) saturate(180%);\n      z-index: 100; padding: 16px 14px;\n      display: flex; flex-direction: column; gap: 12px;\n      opacity: 0; pointer-events: none;\n      transition: opacity 250ms var(--sp-ease);\n    }\n    .sidebar-search-overlay.active { opacity: 1; pointer-events: auto; }\n    .sidebar-search-bar {\n      display: flex; align-items: center; gap: 8px;\n      padding: 10px 14px; border-radius: 12px;\n      background: var(--sp-glass-bg-light);\n      border: 1px solid var(--sp-glass-border);\n      color: var(--sp-text-tertiary);\n    }\n    .sidebar-search-bar:focus-within {\n      border-color: var(--sp-glass-border-strong);\n      background: var(--sp-glass-highlight);\n    }\n    .sidebar-search-input {\n      flex: 1; background: transparent; border: none; outline: none;\n      font-family: 'Inter', sans-serif;\n      font-size: 13px; color: var(--sp-text-primary); letter-spacing: -0.005em;\n    }\n    .sidebar-search-input::placeholder { color: var(--sp-text-muted); }\n    .sidebar-search-close {\n      width: 22px; height: 22px; border-radius: 50%;\n      background: transparent; border: none; cursor: pointer;\n      display: inline-flex; align-items: center; justify-content: center;\n      color: var(--sp-text-muted);\n    }\n    .sidebar-search-close:hover { color: var(--sp-text-primary); background: var(--sp-glass-highlight); }\n\n    .sidebar-search-results {\n      display: flex; flex-direction: column; gap: 4px;\n      overflow-y: auto; max-height: calc(100vh - 160px);\n    }\n    .sidebar-search-empty, .sidebar-search-loading {\n      padding: 24px 12px; text-align: center;\n      font-size: 12px; color: var(--sp-text-muted);\n    }\n    .sidebar-search-token {\n      display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 10px;\n      padding: 10px 12px; border-radius: 12px;\n      background: var(--sp-glass-bg-light);\n      border: 1px solid var(--sp-glass-border);\n      cursor: pointer;\n      transition: border-color 150ms var(--sp-ease), background 150ms var(--sp-ease);\n    }\n    .sidebar-search-token:hover {\n      border-color: var(--sp-glass-border-strong);\n      background: var(--sp-glass-highlight);\n    }\n    .sidebar-search-token-logo {\n      width: 28px; height: 28px; border-radius: 50%; overflow: hidden;\n      background: var(--sp-glass-bg-light);\n      box-shadow: 0 0 0 1px var(--sp-glass-border-strong);\n    }\n    .sidebar-search-token-logo img { width: 100%; height: 100%; object-fit: cover; }\n    .sidebar-search-token-info { display: flex; flex-direction: column; min-width: 0; }\n    .sidebar-search-token-symbol { font-size: 12.5px; font-weight: 600; color: var(--sp-text-primary); letter-spacing: -0.01em; }\n    .sidebar-search-token-name { font-size: 10.5px; color: var(--sp-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n    .sidebar-search-token-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }\n    .sidebar-search-token-price { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 600; color: var(--sp-text-primary); letter-spacing: -0.01em; }\n    .sidebar-search-token-change {\n      font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600;\n      padding: 1px 6px; border-radius: 999px; letter-spacing: -0.01em;\n    }\n    .sidebar-search-token-change.positive { color: var(--sp-bull-bright); background: var(--sp-bull-muted); }\n    .sidebar-search-token-change.negative { color: var(--sp-bear-bright); background: var(--sp-bear-muted); }\n  ";
}

/**
 * Set sidebar day mode
 */
function setSidebarDayMode(isDay) {
  if (!shadowRoot) return;
  const app = shadowRoot.querySelector('.spectre-sidebar-app');
  if (app) app.classList.toggle('day-mode', isDay);
  // Update the toggle icon
  const btn = shadowRoot.getElementById('sidebar-daymode');
  if (btn) {
    btn.innerHTML = isDay
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 8.5A6.5 6.5 0 017.5 2 5.5 5.5 0 108.5 14 6.5 6.5 0 0014 8.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  }
}

export { toggleSidebar, showSidebar, hideSidebar, updateTrending, updateFeedMentions, refreshSidebarData, setSidebarDayMode, showProjectDetail };
