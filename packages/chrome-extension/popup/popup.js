/**
 * Spectre AI — Extension Popup Script
 * Two-tab layout: General Market | Project Specific
 * Cinema-mode aesthetic with AI Brief, sparkline price cards, and market stats.
 */

/* ═══════════════════════════════════════════════════════════════
   TOKEN CONFIG
   ═══════════════════════════════════════════════════════════════ */

const DEFAULT_TOKENS = [
  { symbol: 'BTC', name: 'Bitcoin', cgId: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', cgId: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', cgId: 'solana' },
  { symbol: 'BNB', name: 'BNB', cgId: 'binancecoin' },
  { symbol: 'XRP', name: 'XRP', cgId: 'ripple' },
  { symbol: 'DOGE', name: 'Dogecoin', cgId: 'dogecoin' },
  { symbol: 'ADA', name: 'Cardano', cgId: 'cardano' },
  { symbol: 'AVAX', name: 'Avalanche', cgId: 'avalanche-2' },
];
const DEFAULT_SYMBOLS = new Set(DEFAULT_TOKENS.map(t => t.symbol));
const FEATURED_TOKENS = DEFAULT_TOKENS.slice(0, 3);
const WATCHLIST_TOKENS = DEFAULT_TOKENS; // backward compat alias

// Dynamic watchlist: defaults + user-added tokens
let userWatchlist = [];
function getFullWatchlist() {
  const extras = userWatchlist.filter(t => !DEFAULT_SYMBOLS.has(t.symbol || t));
  return [...DEFAULT_TOKENS, ...extras];
}
function isUserToken(symbol) { return !DEFAULT_SYMBOLS.has(symbol); }

const BRAND_COLORS = {
  BTC:  '247, 147, 26',
  ETH:  '98, 126, 234',
  SOL:  '20, 241, 149',
  BNB:  '243, 186, 47',
  XRP:  '0, 159, 246',
  DOGE: '186, 154, 51',
  ADA:  '0, 51, 173',
  AVAX: '232, 65, 66',
};

/* ═══════════════════════════════════════════════════════════════
   AI BRIEF STATEMENT TEMPLATES
   ═══════════════════════════════════════════════════════════════ */

const BRIEF_TEMPLATES = {
  sentiment: (fg, btcP) => {
    if (fg <= 20) return `Extreme fear at ${fg}. Markets frozen \u2014 patience over action. BTC at ${btcP}.`;
    if (fg <= 35) return `Fear dominates at ${fg}. Smart money accumulating quietly. BTC holding ${btcP}.`;
    if (fg <= 45) return `Cautious sentiment at ${fg}. Markets searching for direction. BTC at ${btcP}.`;
    if (fg >= 80) return `Euphoria at ${fg}. Peak greed \u2014 trim positions, protect gains. BTC at ${btcP}.`;
    if (fg >= 65) return `Greed rising to ${fg}. Momentum strong but stay alert. BTC at ${btcP}.`;
    return `Neutral sentiment at ${fg}. Range-bound conditions persist. BTC steady at ${btcP}.`;
  },
  narrative: (fg, change) => {
    const sign = change >= 0 ? '+' : '';
    const pct = sign + change.toFixed(1) + '%';
    if (change >= 5) return `Market surging ${pct} today. Bulls in full control \u2014 ride the wave, but set stops.`;
    if (change >= 2) return `Solid green day at ${pct}. Momentum building \u2014 watch for continuation above resistance.`;
    if (change <= -5) return `Sharp selloff at ${change.toFixed(1)}% today. Capitulation signals emerging \u2014 watch for reversal patterns.`;
    if (change <= -2) return `Red across the board at ${change.toFixed(1)}%. Bears pressing \u2014 key supports being tested.`;
    return `Flat action today at ${pct}. Consolidation phase \u2014 breakout imminent.`;
  },
  macro: (btcd, mcap) => {
    if (btcd >= 60) return `BTC dominance at ${btcd.toFixed(1)}% \u2014 capital rotating to safety. Alt season on hold.`;
    if (btcd >= 50) return `BTC dominance holding ${btcd.toFixed(1)}%. Bitcoin leading \u2014 alts following with lag.`;
    if (btcd <= 40) return `BTC.D at ${btcd.toFixed(1)}% \u2014 alt season in play. High-beta tokens outperforming.`;
    return `BTC.D at ${btcd.toFixed(1)}%. Total market cap at ${mcap}. Balanced rotation across sectors.`;
  },
};

let briefStatements = [];
let activeBriefIndex = 0;
let briefInterval = null;

function generateBriefStatements(market, prices) {
  const fg = parseInt(market?.fearGreed?.value) || 50;
  const btcPrice = formatPrice(prices?.BTC?.price);
  const change = parseFloat(market?.marketCapChange24h) || 0;
  const btcd = parseFloat(market?.btcDominance) || 50;
  const mcap = formatLarge(parseFloat(market?.totalMarketCap));

  return [
    BRIEF_TEMPLATES.sentiment(fg, btcPrice),
    BRIEF_TEMPLATES.narrative(fg, change),
    BRIEF_TEMPLATES.macro(btcd, mcap),
  ];
}

/* ═══════════════════════════════════════════════════════════════
   CACHED DATA
   ═══════════════════════════════════════════════════════════════ */
let cachedPrices = {};
let cachedMarket = {};

/* Skeleton shimmer HTML — replaces spinners per Spectre Design Law */
function skeletonCards(count = 3) {
  return `<div class="spectre-price-loading">${Array.from({ length: count }, () => `
    <div class="spectre-skeleton-card">
      <div class="spectre-skeleton-circle"></div>
      <div class="spectre-skeleton-lines">
        <div class="spectre-skeleton-line w60"></div>
        <div class="spectre-skeleton-line w40"></div>
      </div>
      <div class="spectre-skeleton-right">
        <div class="spectre-skeleton-price"></div>
        <div class="spectre-skeleton-change"></div>
      </div>
    </div>`).join('')}</div>`;
}

function skeletonFeatured() {
  return `<div class="spectre-price-loading" style="flex-direction:row;gap:6px">${Array.from({ length: 3 }, () => `
    <div class="spectre-skeleton-card" style="flex:1;flex-direction:column;align-items:center;padding:12px 8px">
      <div class="spectre-skeleton-circle" style="width:32px;height:32px"></div>
      <div class="spectre-skeleton-line w60" style="margin-top:6px"></div>
      <div class="spectre-skeleton-line w80" style="margin-top:4px"></div>
    </div>`).join('')}</div>`;
}

/* ═══════════════════════════════════════════════════════════════
   DOM REFERENCES
   ═══════════════════════════════════════════════════════════════ */

const cabContainer   = document.getElementById('cab-container');
const cabStatement   = document.getElementById('cab-statement');
const cabDots        = document.getElementById('cab-dots');
const priceList      = document.getElementById('price-list');
const settingsPanel  = document.getElementById('settings-panel');
const searchOverlay  = document.getElementById('search-overlay');
const searchInput    = document.querySelector('.spectre-search-input');
const searchResults  = document.getElementById('search-results');

const watchlistToggle  = document.getElementById('watchlist-toggle');
const watchlistCount   = document.getElementById('watchlist-count');
const watchlistChevron = document.getElementById('watchlist-chevron');

const chainFilters     = document.getElementById('chain-filters');
const searchTabs       = document.getElementById('search-tabs');

let searchDebounce = null;
let priceRefreshTimer = null;
let dayMode = false;
let watchlistExpanded = true; // expanded by default
let activeChain = 'all';
let activeSearchTab = 'recent';
let recentSearches = []; // { symbol, name, image, timestamp }
let trendingCache = null;
let trendingCacheTime = 0;
const TRENDING_CACHE_TTL = 120000; // 2 minutes

/* ═══════════════════════════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════════════════════════ */

async function init() {
  // Load user watchlist before rendering
  try {
    const wlResult = await chrome.storage.local.get('spectre_watchlist');
    const raw = wlResult.spectre_watchlist || [];
    userWatchlist = raw.map(item => typeof item === 'string' ? { symbol: item } : item);
  } catch {}

  loadMarketState();
  loadSettings();

  // Tab switching
  document.querySelectorAll('.spectre-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Header buttons
  document.getElementById('btn-settings').addEventListener('click', () => {
    settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-settings-close').addEventListener('click', () => {
    settingsPanel.style.display = 'none';
  });
  document.getElementById('btn-sidebar').addEventListener('click', toggleSidebarOnX);

  // Day mode toggle
  const dayModeBtn = document.getElementById('btn-daymode');
  if (dayModeBtn) {
    dayModeBtn.addEventListener('click', toggleDayMode);
  }

  // Search overlay
  const searchBtn = document.getElementById('btn-search');
  const searchClose = document.getElementById('search-close');
  if (searchBtn && searchOverlay) {
    searchBtn.addEventListener('click', () => {
      searchOverlay.classList.toggle('active');
      if (searchOverlay.classList.contains('active')) {
        if (searchInput) setTimeout(() => searchInput.focus(), 100);
        loadRecentSearches().then(() => renderActiveSearchTab());
      }
    });
  }
  if (searchClose && searchOverlay) {
    searchClose.addEventListener('click', () => searchOverlay.classList.remove('active'));
  }

  // Search input — live search with debounce, hide tabs when typing
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      const q = searchInput.value.trim();
      if (q.length < 1) {
        // Show tabs + chain filters when input is empty
        showSearchTabs(true);
        renderActiveSearchTab();
        return;
      }
      // Hide tabs when typing
      showSearchTabs(false);
      searchDebounce = setTimeout(() => searchTokens(q), 300);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') searchOverlay.classList.remove('active');
    });
  }

  // Chain filter pills
  if (chainFilters) {
    chainFilters.querySelectorAll('.spectre-chain-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        activeChain = pill.dataset.chain;
        chainFilters.querySelectorAll('.spectre-chain-pill').forEach(p => p.classList.toggle('active', p.dataset.chain === activeChain));
        // Re-trigger search if there's a query
        const q = searchInput?.value.trim();
        if (q && q.length > 0) {
          clearTimeout(searchDebounce);
          searchDebounce = setTimeout(() => searchTokens(q), 200);
        }
      });
    });
  }

  // Search section tabs
  if (searchTabs) {
    searchTabs.querySelectorAll('.spectre-search-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeSearchTab = tab.dataset.section;
        searchTabs.querySelectorAll('.spectre-search-tab').forEach(t => t.classList.toggle('active', t.dataset.section === activeSearchTab));
        renderActiveSearchTab();
      });
    });
  }

  // Load recent searches on startup
  loadRecentSearches();

  // Settings toggles
  document.getElementById('setting-popup').addEventListener('change', saveSettings);
  document.getElementById('setting-badges').addEventListener('change', saveSettings);
  document.getElementById('setting-sidebar').addEventListener('change', saveSettings);

  // DexScreener platform toggle (uses chrome.storage.sync — separate from X settings)
  document.getElementById('setting-dexscreener').addEventListener('change', saveDexScreenerSetting);
  loadDexScreenerSetting();

  // Brief dot clicks
  const dots = cabDots.querySelectorAll('.cab-rotation-dot');
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      activeBriefIndex = i;
      updateBriefDisplay();
      clearInterval(briefInterval);
      startBriefRotation();
    });
  });

  startBriefRotation();

  // Live price refresh every 60s
  priceRefreshTimer = setInterval(loadMarketState, 60000);

  // US market status — update every 60s (also called inside loadMarketState)
  updateUSMarketStatus();
  setInterval(updateUSMarketStatus, 60000);

  // Watchlist toggle — collapsed by default, persisted
  if (watchlistToggle) {
    watchlistToggle.addEventListener('click', toggleWatchlist);
  }
  loadWatchlistState();

  // Load day mode preference
  loadDayModePreference();

  // Listen for day mode + watchlist changes from other surfaces
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.spectre_dayMode) {
      const isDay = !!changes.spectre_dayMode.newValue;
      if (isDay !== dayMode) applyDayMode(isDay);
    }
    if (changes.spectre_watchlist) {
      userWatchlist = changes.spectre_watchlist.newValue || [];
      loadMarketState(); // Re-render with updated watchlist
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════════════════════════ */

function switchTab(tabId) {
  // Update tab buttons
  document.querySelectorAll('.spectre-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });

  // Update tab content
  document.querySelectorAll('.spectre-tab-content').forEach(c => {
    c.classList.remove('active');
  });
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.add('active');

  // Show/hide footer CTA (only on market tab)
  const footer = document.getElementById('footer-cta');
  if (footer) {
    footer.parentElement.style.display = tabId === 'market' ? 'flex' : 'none';
  }
}

function startBriefRotation() {
  briefInterval = setInterval(() => {
    if (briefStatements.length > 0) {
      activeBriefIndex = (activeBriefIndex + 1) % briefStatements.length;
      updateBriefDisplay();
    }
  }, 12000);
}

/* ═══════════════════════════════════════════════════════════════
   AI BRIEF DISPLAY
   ═══════════════════════════════════════════════════════════════ */

function updateBriefDisplay() {
  if (!cabStatement || briefStatements.length === 0) return;

  cabStatement.classList.remove('cab-statement-visible');
  cabStatement.classList.add('cab-statement-fading');

  setTimeout(() => {
    cabStatement.innerHTML = `<span class="cab-quote-mark">\u201C</span>${escapeHtml(briefStatements[activeBriefIndex])}<span class="cab-quote-mark">\u201D</span>`;
    cabStatement.classList.remove('cab-statement-fading');
    cabStatement.classList.add('cab-statement-visible');
  }, 400);

  const dots = cabDots.querySelectorAll('.cab-rotation-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === activeBriefIndex);
  });
}

/* ═══════════════════════════════════════════════════════════════
   LOAD MARKET STATE
   ═══════════════════════════════════════════════════════════════ */

async function loadMarketState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_MARKET_STATE' });
    if (!response) return;

    const market = response.market || {};
    const prices = response.prices || {};

    cachedPrices = prices;
    cachedMarket = market;

    // --- AI Brief statements ---
    briefStatements = generateBriefStatements(market, prices);
    activeBriefIndex = 0;
    updateBriefDisplay();

    // --- AI Brief sentiment color ---
    const fg = parseInt(market?.fearGreed?.value) || 50;
    const fgClass = market?.fearGreed?.classification || 'Neutral';
    const fgColor = fg <= 30 ? '239, 68, 68'
      : fg <= 45 ? '249, 115, 22'
      : fg >= 70 ? '34, 197, 94'
      : fg >= 55 ? '132, 204, 22'
      : '234, 179, 8';

    if (cabContainer) cabContainer.style.setProperty('--sentiment-rgb', fgColor);

    // --- Update F&G stat card ---
    setTextById('stat-fg-val', String(fg));
    setTextById('stat-fg-class', fgClass);
    const fgCard = document.getElementById('stat-fng-card');
    if (fgCard) fgCard.style.setProperty('--stat-rgb', fgColor);
    const fgIndicator = document.getElementById('stat-fg-indicator');
    if (fgIndicator) fgIndicator.style.left = `${Math.min(100, Math.max(0, fg))}%`;

    // --- Update Market Dominance bar ---
    const btcDom = parseFloat(market?.btcDominance) || 0;
    const ethDom = parseFloat(market?.ethDominance) || 0;
    const solDom = parseFloat(market?.solDominance) || 0;
    const altsDom = Math.max(0, 100 - btcDom - ethDom - solDom);

    const domBtc = document.getElementById('dom-btc');
    const domEth = document.getElementById('dom-eth');
    const domSol = document.getElementById('dom-sol');
    const domAlts = document.getElementById('dom-alts');
    if (domBtc) domBtc.style.width = `${btcDom.toFixed(1)}%`;
    if (domEth) domEth.style.width = `${ethDom.toFixed(1)}%`;
    if (domSol) domSol.style.width = `${solDom.toFixed(1)}%`;
    if (domAlts) domAlts.style.width = `${altsDom.toFixed(1)}%`;

    // --- Update Global Market card (MCAP + Volume) ---
    const mcap = parseFloat(market?.totalMarketCap);
    setTextById('stat-mcap', !isNaN(mcap) && mcap > 0 ? formatLarge(mcap) : '--');
    const vol = parseFloat(market?.totalVolume);
    setTextById('stat-vol', !isNaN(vol) && vol > 0 ? `Vol: ${formatLarge(vol)}` : 'Vol: --');
    const mcapChange = parseFloat(market?.marketCapChange24h);
    const mcapChangeEl = document.getElementById('stat-mcap-change');
    if (mcapChangeEl && !isNaN(mcapChange)) {
      const isMcapUp = mcapChange >= 0;
      mcapChangeEl.textContent = `${isMcapUp ? '+' : ''}${mcapChange.toFixed(1)}%`;
      mcapChangeEl.className = `cwb-mcap-change ${isMcapUp ? 'positive' : 'negative'}`;
    }

    // Update Global Market card trend color
    const mcapCard = document.getElementById('stat-mcap-card');
    if (mcapCard && !isNaN(mcapChange)) {
      const trendColor = mcapChange >= 2 ? '34, 197, 94'
        : mcapChange >= 0 ? '132, 204, 22'
        : mcapChange >= -2 ? '249, 115, 22'
        : '239, 68, 68';
      mcapCard.style.setProperty('--stat-rgb', trendColor);
    }

    // --- Ensure user-added tokens get price tracking ---
    const userSymbols = userWatchlist.map(t => t.symbol || t).filter(s => !DEFAULT_SYMBOLS.has(s));
    if (userSymbols.length > 0) {
      chrome.runtime.sendMessage({ type: 'WATCH_SYMBOLS', symbols: userSymbols });
    }

    // --- Render featured + watchlist price cards ---
    renderFeaturedPrices(prices);
    renderPrices(prices);

    // --- Update US Market Status ---
    updateUSMarketStatus();

  } catch (err) {
    console.error('[Spectre Popup] Load failed:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
   US MARKET STATUS
   ═══════════════════════════════════════════════════════════════ */

function getUSMarketStatus() {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etStr);
  const day = et.getDay(); // 0=Sun, 6=Sat
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // NYSE: Mon–Fri 9:30 AM – 4:00 PM ET
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && totalMinutes >= 570 && totalMinutes < 960; // 570=9:30, 960=16:00

  // Format time as "4:32 PM ET"
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
  const card = document.getElementById('market-status');
  if (!card) return;
  const status = getUSMarketStatus();
  card.classList.toggle('open', status.isOpen);
  const label = card.querySelector('.cwb-market-label');
  const time = card.querySelector('.cwb-market-time');
  if (label) label.textContent = status.isOpen ? 'OPEN' : 'CLOSED';
  if (time) time.textContent = status.time;
}

/* ═══════════════════════════════════════════════════════════════
   SPARKLINE SVG GENERATOR
   ═══════════════════════════════════════════════════════════════ */

function generateSparklineSVG(sparklineData, isPositive, _brandRgb, width = 200, height = 40) {
  if (!sparklineData || sparklineData.length < 2) return '';

  // Downsample
  const targetPoints = 44;
  const step = Math.max(1, Math.floor(sparklineData.length / targetPoints));
  const sampled = [];
  for (let i = 0; i < sparklineData.length; i += step) sampled.push(Number(sparklineData[i]) || 0);
  if (sampled[sampled.length - 1] !== Number(sparklineData[sparklineData.length - 1])) {
    sampled.push(Number(sparklineData[sparklineData.length - 1]) || 0);
  }

  // Percentile-based scaling — ignore top/bottom 2% so a single spike doesn't flatten the curve
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

  function smoothPath(points) {
    if (points.length < 2) return '';
    let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const tension = 0.2;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
      d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return d;
  }

  const linePath = smoothPath(pts);
  const fillPath = `${linePath} L${(width - padX).toFixed(2)},${height - padBot + 1} L${padX.toFixed(2)},${height - padBot + 1} Z`;

  const rgb = isPositive ? '16, 185, 129' : '239, 68, 68';
  const uid = Math.random().toString(36).slice(2, 8);
  const last = pts[pts.length - 1];

  // Opening-price baseline (ghost reference line)
  const openY = padTop + usableH - ((sampled[0] - min) / range) * usableH;

  // Stroke width scales with chart size — thinner for tiny watchlist sparklines
  const sw = height <= 42 ? 1.35 : 1.6;

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="f-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgb(${rgb})" stop-opacity="0.26"/>
        <stop offset="50%" stop-color="rgb(${rgb})" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="rgb(${rgb})" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="s-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgb(${rgb})" stop-opacity="1"/>
        <stop offset="100%" stop-color="rgb(${rgb})" stop-opacity="0.82"/>
      </linearGradient>
    </defs>
    <line x1="${padX}" y1="${openY.toFixed(2)}" x2="${(width - padX).toFixed(2)}" y2="${openY.toFixed(2)}" stroke="currentColor" stroke-opacity="0.06" stroke-width="1" stroke-dasharray="3 4"/>
    <path d="${fillPath}" fill="url(#f-${uid})"/>
    <path d="${linePath}" fill="none" stroke="url(#s-${uid})" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="${height <= 42 ? 3 : 5}" fill="rgb(${rgb})" fill-opacity="0.12"/>
    <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="${height <= 42 ? 1.4 : 1.75}" fill="rgb(${rgb})"/>
  </svg>`;
}

/* ═══════════════════════════════════════════════════════════════
   RENDER FEATURED PRICES — BTC, ETH, SOL hero cards
   ═══════════════════════════════════════════════════════════════ */

function renderFeaturedPrices(prices) {
  const featuredRow = document.getElementById('featured-row');
  if (!featuredRow) return;

  if (!prices || Object.keys(prices).length === 0) {
    featuredRow.innerHTML = skeletonFeatured();
    return;
  }

  featuredRow.innerHTML = FEATURED_TOKENS.map(token => {
    const p = prices[token.symbol];
    if (!p) return '';

    const change = parseFloat(p.change24) || 0;
    const isUp = change >= 0;
    const rgb = BRAND_COLORS[token.symbol] || '180, 180, 190';

    const sparklineSVG = generateSparklineSVG(p.sparkline, isUp, rgb, 120, 40);
    const logoHtml = p.image
      ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(token.symbol)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : token.symbol[0];

    return `
      <div class="cwb-featured-card" style="--brand-rgb: ${rgb}" data-symbol="${escapeHtml(token.symbol)}">
        <div class="cwb-price-corner cwb-price-corner--tl"></div>
        <div class="cwb-price-corner cwb-price-corner--br"></div>
        <div class="cwb-price-glow"></div>
        ${sparklineSVG ? `<div class="cwb-featured-sparkline">${sparklineSVG}</div>` : ''}
        <div class="cwb-featured-logo-wrap">
          <div class="cwb-price-ring cwb-price-ring-1"></div>
          <div class="cwb-featured-logo">${logoHtml}</div>
        </div>
        <span class="cwb-featured-symbol">${escapeHtml(token.symbol)}</span>
        <span class="cwb-featured-price">${formatPrice(p.price)}</span>
        <span class="cwb-featured-change ${isUp ? 'positive' : 'negative'}">
          <span class="cwb-featured-change-arrow">${isUp ? '\u25B2' : '\u25BC'}</span>
          ${isUp ? '+' : ''}${change.toFixed(2)}%
        </span>
      </div>
    `;
  }).join('');

  // Click handler
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
  const remainingTokens = getFullWatchlist().slice(3);

  // Update watchlist count
  if (watchlistCount) {
    watchlistCount.textContent = remainingTokens.length;
  }

  if (!prices || Object.keys(prices).length === 0) {
    priceList.innerHTML = skeletonCards(5);
    return;
  }

  priceList.innerHTML = remainingTokens.map(token => {
    const sym = token.symbol || token;
    const name = token.name || sym;
    const p = prices[sym];
    if (!p) return '';

    const change = parseFloat(p.change24) || 0;
    const isUp = change >= 0;
    const rgb = BRAND_COLORS[sym] || '180, 180, 190';
    const deepLink = `https://trade.spectreai.io/lite?search=${encodeURIComponent(sym)}`;

    const sparklineSVG = generateSparklineSVG(p.sparkline, isUp, rgb);
    const logoHtml = p.image
      ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(sym)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : sym[0];
    const userAdded = isUserToken(sym);

    return `
      <div class="cwb-price-card" style="--brand-rgb: ${rgb}" data-symbol="${escapeHtml(sym)}" data-link="${escapeHtml(deepLink)}">
        <div class="cwb-price-corner cwb-price-corner--tl"></div>
        <div class="cwb-price-corner cwb-price-corner--br"></div>
        <div class="cwb-price-glow"></div>
        <div class="cwb-price-logo-wrap">
          <div class="cwb-price-ring cwb-price-ring-1"></div>
          <div class="cwb-price-logo">${logoHtml}</div>
        </div>
        <div class="cwb-price-content">
          <span class="cwb-price-symbol">${escapeHtml(sym)}</span>
          <span class="cwb-price-name">${escapeHtml(name)}</span>
        </div>
        ${sparklineSVG ? `<div class="cwb-price-sparkline">${sparklineSVG}</div>` : '<div class="cwb-price-sparkline-placeholder"></div>'}
        <div class="cwb-price-right">
          <span class="cwb-price-value">${formatPrice(p.price)}</span>
          <span class="cwb-price-change ${isUp ? 'positive' : 'negative'}">
            <span class="cwb-price-change-arrow">${isUp ? '\u25B2' : '\u25BC'}</span>
            ${isUp ? '+' : ''}${change.toFixed(2)}%
          </span>
        </div>
        ${userAdded ? `<button class="cwb-remove-btn" data-symbol="${escapeHtml(sym)}" title="Remove from watchlist">&times;</button>` : ''}
      </div>
    `;
  }).join('');

  // Click handler: open project detail tab
  priceList.querySelectorAll('.cwb-price-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.cwb-remove-btn')) return;
      const symbol = card.dataset.symbol;
      if (symbol) {
        showProjectDetail(symbol);
      }
    });
  });

  // Remove button handler for user-added tokens
  priceList.querySelectorAll('.cwb-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sym = btn.dataset.symbol;
      userWatchlist = userWatchlist.filter(t => (t.symbol || t) !== sym);
      chrome.runtime.sendMessage({ type: 'UPDATE_WATCHLIST', action: 'remove', token: { symbol: sym } });
      renderPrices(cachedPrices);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   PROJECT DETAIL VIEW
   ═══════════════════════════════════════════════════════════════ */

async function showProjectDetail(symbol) {
  const upper = symbol.toUpperCase();
  const watchToken = getFullWatchlist().find(t => t.symbol === upper);

  // Try cached prices first, then fetch from background
  let p = cachedPrices[upper] || null;
  if (!p) {
    try {
      const resolved = await chrome.runtime.sendMessage({ type: 'RESOLVE_CASHTAG', ticker: upper });
      if (resolved && !resolved.error) {
        p = {
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
        };
        cachedPrices[upper] = p;
      }
    } catch { /* extension context may be dead */ }
  }

  const displayName = watchToken?.name || (p ? upper : upper);
  const rgb = BRAND_COLORS[upper] || '180, 180, 190';
  const change = parseFloat(p?.change24) || 0;
  const isUp = change >= 0;

  // Switch to project tab
  switchTab('project');

  // Hide empty state, show detail
  document.getElementById('project-empty').style.display = 'none';
  const detail = document.getElementById('project-detail');
  detail.style.display = 'block';
  detail.style.setProperty('--brand-rgb', rgb);

  // Logo
  const logoEl = document.getElementById('project-logo');
  if (p?.image) {
    logoEl.innerHTML = `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(upper)}">`;
  } else {
    logoEl.textContent = upper[0];
  }

  // Identity
  setTextById('project-name', displayName);
  const rank = p?.rank ? `#${p.rank}` : '';
  document.getElementById('project-meta').innerHTML = `${escapeHtml(upper)}${rank ? ' &middot; ' + rank : ''}`;

  // Pulse badge
  const pulse = document.getElementById('project-pulse');
  const aiPulse = cachedMarket.aiPulse || {};
  const pulseLabel = aiPulse.label || 'Neutral';
  const pulseState = (aiPulse.state || 'NEUTRAL');
  const pulseColors = {
    RISK_ON: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', color: '#10B981' },
    RISK_OFF: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', color: '#EF4444' },
    EUPHORIA: { bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.15)', color: '#A78BFA' },
    NEUTRAL: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', color: '#F59E0B' },
  };
  const pc = pulseColors[pulseState] || pulseColors.NEUTRAL;
  pulse.style.background = pc.bg;
  pulse.style.borderColor = pc.border;
  pulse.style.color = pc.color;
  setTextById('project-pulse-label', pulseLabel);

  // Price
  setTextById('project-price', p ? formatPrice(p.price) : '$--');
  const changeEl = document.getElementById('project-change');
  if (p && p.price) {
    changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)}%`;
    changeEl.className = `project-change ${isUp ? 'positive' : 'negative'}`;
    changeEl.style.display = '';
  } else {
    changeEl.style.display = 'none';
  }

  // Chart (sparkline)
  const chartContainer = document.getElementById('project-chart');
  if (p?.sparkline && p.sparkline.length > 2) {
    const chartSVG = generateSparklineSVG(p.sparkline, isUp, rgb, 328, 80);
    chartContainer.innerHTML = chartSVG;
  } else {
    chartContainer.innerHTML = `<div class="project-chart-placeholder"><span>Chart unavailable</span></div>`;
  }

  // Stats
  setTextById('project-mcap', p ? formatLarge(p.marketCap) : '--');
  setTextById('project-volume', p ? formatLarge(p.volume) : '--');
  setTextById('project-hl', p?.high24 && p?.low24
    ? `${formatPrice(p.high24)} / ${formatPrice(p.low24)}`
    : '--');
  setTextById('project-supply', p?.circulatingSupply
    ? formatLargeNum(p.circulatingSupply) + ' ' + upper
    : '--');
  setTextById('project-ath', p?.ath ? formatPrice(p.ath) : '--');

  // Multi-timeframe changes
  const ch1h = parseFloat(p?.change1h) || 0;
  const ch7d = parseFloat(p?.change7d) || 0;
  const ch30d = parseFloat(p?.change30d) || 0;

  updateChangeVal('project-1h', ch1h);
  updateChangeVal('project-24h', change);
  updateChangeVal('project-7d', ch7d);
  updateChangeVal('project-30d', ch30d);

  // Fetch socials + description from token detail endpoint
  fetchAndRenderSocials(symbol);

  // About — will be populated by fetchAndRenderSocials
  const aboutSection = document.getElementById('project-about');
  aboutSection.style.display = 'none';

  // CTA link
  const ctaBtn = document.getElementById('project-cta');
  const deepLink = `https://trade.spectreai.io/lite?search=${encodeURIComponent(symbol)}`;
  ctaBtn.onclick = () => chrome.tabs.create({ url: deepLink });
}

function updateChangeVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  const isUp = val >= 0;
  el.textContent = `${isUp ? '+' : ''}${val.toFixed(2)}%`;
  el.className = `project-change-val ${isUp ? 'positive' : 'negative'}`;
}

/**
 * Fetch and render socials + description for project detail
 */
async function fetchAndRenderSocials(symbol) {
  const socialsEl = document.getElementById('project-socials');
  const aboutSection = document.getElementById('project-about');

  // Show loading placeholder
  socialsEl.innerHTML = `<span style="font-size:10px;color:rgba(255,255,255,0.2);padding:4px 0">Loading socials...</span>`;

  try {
    const detail = await chrome.runtime.sendMessage({ type: 'GET_TOKEN_DETAIL', symbol });
    if (!detail || detail.error) {
      socialsEl.innerHTML = '';
      return;
    }

    // Socials
    const socialLinks = [];
    if (detail.website) socialLinks.push({ label: 'Website', url: detail.website, icon: webIcon() });
    if (detail.twitter) socialLinks.push({ label: 'Twitter', url: detail.twitter, icon: twitterIcon() });
    if (detail.telegram) socialLinks.push({ label: 'Telegram', url: detail.telegram, icon: telegramIcon() });
    if (detail.github) socialLinks.push({ label: 'GitHub', url: detail.github, icon: githubIcon() });
    if (detail.reddit) socialLinks.push({ label: 'Reddit', url: detail.reddit, icon: redditIcon() });

    if (socialLinks.length > 0) {
      socialsEl.innerHTML = socialLinks.map(s =>
        `<a class="project-social-link" data-url="${escapeHtml(s.url)}">${s.icon}<span>${escapeHtml(s.label)}</span></a>`
      ).join('');
      socialsEl.querySelectorAll('.project-social-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const url = link.dataset.url;
          if (url) chrome.tabs.create({ url });
        });
      });
    } else {
      socialsEl.innerHTML = '';
    }

    // About — expandable
    if (detail.description) {
      aboutSection.style.display = 'block';
      const aboutTextEl = document.getElementById('project-about-text');
      const fullDesc = detail.description;
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
    }
  } catch {
    socialsEl.innerHTML = '';
  }
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
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 3.1 2.01 5.73 4.79 6.66.35.06.48-.15.48-.34 0-.17-.01-.72-.01-1.31C4 13.5 3.6 12.13 3.6 12.13c-.32-.81-.78-1.03-.78-1.03-.63-.43.05-.42.05-.42.7.05 1.07.72 1.07.72.62 1.07 1.63.76 2.03.58.06-.45.24-.76.44-.93-1.56-.18-3.2-.78-3.2-3.47 0-.77.27-1.4.72-1.89-.07-.18-.31-.89.07-1.86 0 0 .59-.19 1.93.72A6.7 6.7 0 018 4.07c.6.003 1.2.08 1.76.24 1.34-.91 1.93-.72 1.93-.72.38.97.14 1.68.07 1.86.45.49.72 1.12.72 1.89 0 2.7-1.64 3.29-3.21 3.46.25.22.48.65.48 1.31 0 .95-.01 1.71-.01 1.94 0 .19.13.41.48.34A7.003 7.003 0 0015 8c0-3.87-3.13-7-7-7z" stroke="currentColor" stroke-width="0.5" fill="currentColor"/></svg>`;
}

function redditIcon() {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="9" r="5" stroke="currentColor" stroke-width="1.1"/><circle cx="6" cy="8.5" r="1" fill="currentColor"/><circle cx="10" cy="8.5" r="1" fill="currentColor"/><path d="M6 10.5c.5.5 1.5 1 2 1s1.5-.5 2-1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><circle cx="12.5" cy="4.5" r="1.2" stroke="currentColor" stroke-width="1"/><path d="M8 4V2.5L11.5 3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`;
}

/* ═══════════════════════════════════════════════════════════════
   SEARCH — CoinGecko search with live results
   ═══════════════════════════════════════════════════════════════ */

async function searchTokens(query) {
  if (!searchResults) return;

  searchResults.innerHTML = skeletonCards(3);

  try {
    const response = await chrome.runtime.sendMessage({ type: 'SEARCH_TOKENS', query });
    if (response?.results) {
      let filtered = response.results;
      // Apply chain filter
      if (activeChain !== 'all') {
        const chainMap = {
          ethereum: [1, 'ethereum'],
          solana: [1399811149, 'solana'],
          base: [8453, 'base'],
          bsc: [56, 'binance-smart-chain', 'bsc'],
        };
        const chainIds = chainMap[activeChain] || [];
        filtered = filtered.filter(coin => {
          const network = (coin.networkId || coin.network || '').toString().toLowerCase();
          return chainIds.some(id => network === String(id).toLowerCase());
        });
      }
      renderSearchResults(filtered);
    } else {
      searchResults.innerHTML = `<div class="spectre-search-empty">No results found</div>`;
    }
  } catch (err) {
    searchResults.innerHTML = `<div class="spectre-search-empty">Search failed</div>`;
  }
}

function renderSearchResults(results) {
  if (!searchResults) return;
  if (!results || results.length === 0) {
    searchResults.innerHTML = `
      <div class="spectre-search-section-label">
        <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> SEARCH TOKENS</span>
      </div>
      <div class="spectre-search-empty">Type to search tokens by name or symbol</div>`;
    return;
  }

  let html = `
    <div class="spectre-search-section-label">
      <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> RESULTS</span>
    </div>`;

  for (const coin of results) {
    const rgb = BRAND_COLORS[coin.symbol] || '180, 180, 190';
    const hasPrice = coin.price != null && coin.price !== 0;
    const change = parseFloat(coin.change24) || 0;
    const isUp = change >= 0;
    html += `
      <div class="spectre-search-token" data-symbol="${escapeHtml(coin.symbol)}" data-name="${escapeHtml(coin.name)}" data-cg-id="${escapeHtml(coin.id)}">
        <div class="spectre-search-token-logo" style="background: rgba(${rgb}, 0.1)">
          ${coin.image ? `<img src="${escapeHtml(coin.image)}" alt="${escapeHtml(coin.symbol)}">` : `<span style="color:rgba(${rgb},0.8);font-weight:700;font-size:14px">${escapeHtml(coin.symbol[0])}</span>`}
        </div>
        <div class="spectre-search-token-info">
          <div class="spectre-search-token-top">
            <span class="spectre-search-token-symbol">${escapeHtml(coin.symbol)}</span>
            ${coin.rank ? `<span class="spectre-search-token-chain">#${coin.rank}</span>` : ''}
          </div>
          <span class="spectre-search-token-name">${escapeHtml(coin.name)}</span>
        </div>
        <div class="spectre-search-token-right">
          ${hasPrice
            ? `<span class="spectre-search-token-price">${formatPrice(coin.price)}</span>
               <span class="spectre-search-token-change ${isUp ? 'positive' : 'negative'}">${isUp ? '+' : ''}${change.toFixed(2)}%</span>`
            : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:rgba(255,255,255,0.2)"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          }
        </div>
      </div>`;
  }

  searchResults.innerHTML = html;

  // Click handlers — open project detail + save to recent searches
  searchResults.querySelectorAll('.spectre-search-token').forEach(el => {
    el.addEventListener('click', () => {
      const symbol = el.dataset.symbol;
      if (symbol) {
        // Save to recent searches
        saveRecentSearch({
          symbol: el.dataset.symbol,
          name: el.dataset.name || symbol,
          image: el.querySelector('.spectre-search-token-logo img')?.src || '',
        });
        // Watch this symbol for future price updates
        chrome.runtime.sendMessage({ type: 'WATCH_SYMBOLS', symbols: [symbol] });
        // Close search and show project detail
        searchOverlay.classList.remove('active');
        searchInput.value = '';
        showProjectDetail(symbol);
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   SEARCH TABS — Recent / Trending / Watchlist
   ═══════════════════════════════════════════════════════════════ */

function showSearchTabs(visible) {
  if (searchTabs) searchTabs.classList.toggle('hidden', !visible);
  // Chain filters always visible (they filter search results AND tab content)
}

function renderActiveSearchTab() {
  if (!searchResults) return;
  switch (activeSearchTab) {
    case 'recent': renderRecentTab(); break;
    case 'trending': renderTrendingTab(); break;
    case 'watchlist': renderWatchlistTab(); break;
    default: renderRecentTab();
  }
}

/* --- Recent Tab --- */

async function loadRecentSearches() {
  try {
    const result = await chrome.storage.local.get('spectre_recent_searches');
    recentSearches = result.spectre_recent_searches || [];
  } catch { recentSearches = []; }
}

function saveRecentSearch(token) {
  // Remove duplicate if exists
  recentSearches = recentSearches.filter(r => r.symbol !== token.symbol);
  // Add to front
  recentSearches.unshift({
    symbol: token.symbol,
    name: token.name,
    image: token.image || '',
    timestamp: Date.now(),
  });
  // Keep max 10
  recentSearches = recentSearches.slice(0, 10);
  try {
    chrome.storage.local.set({ spectre_recent_searches: recentSearches });
  } catch { /* context dead */ }
}

function removeRecentSearch(symbol) {
  recentSearches = recentSearches.filter(r => r.symbol !== symbol);
  try {
    chrome.storage.local.set({ spectre_recent_searches: recentSearches });
  } catch { /* context dead */ }
  renderRecentTab();
}

function clearAllRecentSearches() {
  recentSearches = [];
  try {
    chrome.storage.local.set({ spectre_recent_searches: [] });
  } catch { /* context dead */ }
  renderRecentTab();
}

function renderRecentTab() {
  if (!searchResults) return;

  if (recentSearches.length === 0) {
    searchResults.innerHTML = `
      <div class="spectre-search-section-label">
        <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v5l3 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/></svg> RECENT</span>
      </div>
      <div class="spectre-search-empty">No recent searches</div>`;
    return;
  }

  let html = `
    <div class="spectre-search-section-label">
      <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v5l3 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/></svg> RECENT</span>
      <button class="spectre-search-clear-btn" id="clear-recent">Clear</button>
    </div>`;

  for (const item of recentSearches) {
    const rgb = BRAND_COLORS[item.symbol] || '180, 180, 190';
    const logoHtml = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.symbol)}">`
      : `<span style="color:rgba(${rgb},0.8);font-weight:700;font-size:11px">${escapeHtml(item.symbol[0])}</span>`;

    html += `
      <div class="spectre-recent-item" data-symbol="${escapeHtml(item.symbol)}">
        <div class="spectre-recent-item-icon" style="background:rgba(${rgb},0.1)">${logoHtml}</div>
        <div class="spectre-recent-item-info">
          <span class="spectre-recent-item-symbol">${escapeHtml(item.symbol)}</span>
          <span class="spectre-recent-item-name">${escapeHtml(item.name)}</span>
        </div>
        <button class="spectre-recent-remove" data-symbol="${escapeHtml(item.symbol)}" title="Remove">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </div>`;
  }

  searchResults.innerHTML = html;

  // Clear all button
  const clearBtn = searchResults.querySelector('#clear-recent');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllRecentSearches();
    });
  }

  // Click to open project detail
  searchResults.querySelectorAll('.spectre-recent-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.spectre-recent-remove')) return;
      const symbol = el.dataset.symbol;
      if (symbol) {
        searchOverlay.classList.remove('active');
        searchInput.value = '';
        showProjectDetail(symbol);
      }
    });
  });

  // Remove individual recent search
  searchResults.querySelectorAll('.spectre-recent-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRecentSearch(btn.dataset.symbol);
    });
  });
}

/* --- Trending Tab --- */

async function renderTrendingTab() {
  if (!searchResults) return;

  // Use cache if fresh
  const now = Date.now();
  if (trendingCache && (now - trendingCacheTime) < TRENDING_CACHE_TTL) {
    renderTrendingList(trendingCache);
    return;
  }

  searchResults.innerHTML = `
    <div class="spectre-search-section-label">
      <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> TRENDING</span>
    </div>
    ${skeletonCards(3)}`;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TRENDING' });
    const coins = response?.coins || [];
    trendingCache = coins.slice(0, 10);
    trendingCacheTime = Date.now();
    renderTrendingList(trendingCache);
  } catch {
    searchResults.innerHTML = `
      <div class="spectre-search-section-label">
        <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> TRENDING</span>
      </div>
      <div class="spectre-search-empty">Failed to load trending</div>`;
  }
}

function renderTrendingList(coins) {
  if (!searchResults) return;

  if (!coins || coins.length === 0) {
    searchResults.innerHTML = `
      <div class="spectre-search-section-label">
        <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> TRENDING</span>
      </div>
      <div class="spectre-search-empty">No trending data</div>`;
    return;
  }

  let html = `
    <div class="spectre-search-section-label">
      <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> TRENDING</span>
    </div>`;

  for (const coin of coins) {
    const symbol = coin.symbol || '';
    const name = coin.name || symbol;
    const image = coin.image || coin.thumb || coin.small || '';
    const rgb = BRAND_COLORS[symbol.toUpperCase()] || '180, 180, 190';
    const rank = coin.rank || coin.market_cap_rank || '';
    const price = coin.price != null ? formatPrice(coin.price) : '';
    const change = parseFloat(coin.change24 || coin.price_change_percentage_24h) || 0;
    const isUp = change >= 0;

    const logoHtml = image
      ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(symbol)}">`
      : `<span style="color:rgba(${rgb},0.8);font-weight:700;font-size:14px">${escapeHtml(symbol[0] || '?')}</span>`;

    html += `
      <div class="spectre-search-token" data-symbol="${escapeHtml(symbol.toUpperCase())}" data-name="${escapeHtml(name)}">
        <div class="spectre-search-token-logo" style="background: rgba(${rgb}, 0.1)">
          ${logoHtml}
        </div>
        <div class="spectre-search-token-info">
          <div class="spectre-search-token-top">
            <span class="spectre-search-token-symbol">${escapeHtml(symbol.toUpperCase())}</span>
            ${rank ? `<span class="spectre-search-token-chain">#${rank}</span>` : ''}
          </div>
          <span class="spectre-search-token-name">${escapeHtml(name)}</span>
        </div>
        <div class="spectre-search-token-right">
          ${price
            ? `<span class="spectre-search-token-price">${price}</span>
               <span class="spectre-search-token-change ${isUp ? 'positive' : 'negative'}">${isUp ? '+' : ''}${change.toFixed(2)}%</span>`
            : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:rgba(255,255,255,0.2)"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          }
        </div>
      </div>`;
  }

  searchResults.innerHTML = html;

  // Click to save + show detail
  searchResults.querySelectorAll('.spectre-search-token').forEach(el => {
    el.addEventListener('click', () => {
      const symbol = el.dataset.symbol;
      if (symbol) {
        saveRecentSearch({
          symbol,
          name: el.dataset.name || symbol,
          image: el.querySelector('.spectre-search-token-logo img')?.src || '',
        });
        chrome.runtime.sendMessage({ type: 'WATCH_SYMBOLS', symbols: [symbol] });
        searchOverlay.classList.remove('active');
        searchInput.value = '';
        showProjectDetail(symbol);
      }
    });
  });
}

/* --- Watchlist Tab --- */

function renderWatchlistTab() {
  if (!searchResults) return;

  let html = `
    <div class="spectre-search-section-label">
      <span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.8 3.6L14 6.3l-3 2.9.7 4.1L8 11.3l-3.7 2 .7-4.1-3-2.9 4.2-.7L8 2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> WATCHLIST</span>
    </div>`;

  const allTokens = getFullWatchlist();
  if (allTokens.length === 0) {
    html += `<div class="spectre-search-empty">No tokens in watchlist</div>`;
    searchResults.innerHTML = html;
    return;
  }

  for (const token of allTokens) {
    const p = cachedPrices[token.symbol];
    const rgb = BRAND_COLORS[token.symbol] || '180, 180, 190';
    const change = parseFloat(p?.change24) || 0;
    const isUp = change >= 0;
    const logoHtml = p?.image
      ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(token.symbol)}">`
      : `<span style="color:rgba(${rgb},0.8);font-weight:700;font-size:14px">${escapeHtml(token.symbol[0])}</span>`;

    html += `
      <div class="spectre-search-token" data-symbol="${escapeHtml(token.symbol)}" data-name="${escapeHtml(token.name)}">
        <div class="spectre-search-token-logo" style="background: rgba(${rgb}, 0.1)">
          ${logoHtml}
        </div>
        <div class="spectre-search-token-info">
          <div class="spectre-search-token-top">
            <span class="spectre-search-token-symbol">${escapeHtml(token.symbol)}</span>
          </div>
          <span class="spectre-search-token-name">${escapeHtml(token.name)}</span>
        </div>
        <div class="spectre-search-token-right">
          ${p?.price
            ? `<span class="spectre-search-token-price">${formatPrice(p.price)}</span>
               <span class="spectre-search-token-change ${isUp ? 'positive' : 'negative'}">${isUp ? '+' : ''}${change.toFixed(2)}%</span>`
            : `<span class="spectre-search-token-price" style="color:rgba(255,255,255,0.2)">--</span>`
          }
        </div>
      </div>`;
  }

  searchResults.innerHTML = html;

  // Click to show detail
  searchResults.querySelectorAll('.spectre-search-token').forEach(el => {
    el.addEventListener('click', () => {
      const symbol = el.dataset.symbol;
      if (symbol) {
        searchOverlay.classList.remove('active');
        searchInput.value = '';
        showProjectDetail(symbol);
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   WATCHLIST TOGGLE
   ═══════════════════════════════════════════════════════════════ */

function toggleWatchlist() {
  watchlistExpanded = !watchlistExpanded;
  applyWatchlistState();
  chrome.storage.local.set({ spectre_watchlist_expanded: watchlistExpanded });
}

function applyWatchlistState() {
  if (!priceList) return;
  priceList.classList.toggle('collapsed', !watchlistExpanded);
  if (watchlistChevron) {
    watchlistChevron.classList.toggle('expanded', watchlistExpanded);
  }
}

async function loadWatchlistState() {
  try {
    const result = await chrome.storage.local.get('spectre_watchlist_expanded');
    watchlistExpanded = !!result.spectre_watchlist_expanded;
    applyWatchlistState();
  } catch { /* extension context may be dead */ }
}

/* ═══════════════════════════════════════════════════════════════
   DAY MODE
   ═══════════════════════════════════════════════════════════════ */

function toggleDayMode() {
  applyDayMode(!dayMode);
  // Save preference — chrome.storage.onChanged will sync to sidebar + hover popup
  chrome.storage.local.set({ spectre_dayMode: dayMode });
}

/**
 * Apply day mode state to the popup UI (shared by toggle + storage listener)
 */
function applyDayMode(isDay) {
  dayMode = isDay;
  document.documentElement.classList.toggle('day-mode', dayMode);
  document.body.classList.toggle('day-mode', dayMode);
  const appEl = document.querySelector('.spectre-popup-app');
  if (appEl) appEl.classList.toggle('day-mode', dayMode);

  // Update icon
  const btn = document.getElementById('btn-daymode');
  if (btn) {
    btn.innerHTML = dayMode
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 8.5A6.5 6.5 0 017.5 2 5.5 5.5 0 108.5 14 6.5 6.5 0 0014 8.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  }
}

async function loadDayModePreference() {
  const result = await chrome.storage.local.get('spectre_dayMode');
  if (result.spectre_dayMode) {
    applyDayMode(true);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════════ */

async function loadSettings() {
  const result = await chrome.storage.local.get('spectre_settings');
  const settings = result.spectre_settings || {
    popupEnabled: true,
    badgesEnabled: true,
    sidebarEnabled: false,
  };
  document.getElementById('setting-popup').checked = settings.popupEnabled;
  document.getElementById('setting-badges').checked = settings.badgesEnabled;
  document.getElementById('setting-sidebar').checked = settings.sidebarEnabled;
}

async function saveSettings() {
  const settings = {
    popupEnabled: document.getElementById('setting-popup').checked,
    badgesEnabled: document.getElementById('setting-badges').checked,
    sidebarEnabled: document.getElementById('setting-sidebar').checked,
  };
  await chrome.storage.local.set({ spectre_settings: settings });
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
}

// ── DexScreener platform toggle (chrome.storage.sync) ──
async function loadDexScreenerSetting() {
  try {
    const result = await chrome.storage.sync.get('spectre_dex_enabled');
    document.getElementById('setting-dexscreener').checked = result.spectre_dex_enabled !== false;
  } catch {
    document.getElementById('setting-dexscreener').checked = true;
  }
}

async function saveDexScreenerSetting() {
  const val = document.getElementById('setting-dexscreener').checked;
  await chrome.storage.sync.set({ spectre_dex_enabled: val });
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR TOGGLE
   ═══════════════════════════════════════════════════════════════ */

async function toggleSidebarOnX() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && (tab.url.includes('x.com') || tab.url.includes('twitter.com'))) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' });
  }
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatPrice(price) {
  const p = parseFloat(price);
  if (isNaN(p)) return '$--';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
}

function formatLarge(value) {
  const v = parseFloat(value);
  if (isNaN(v) || v === 0) return '--';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  return '$' + v.toFixed(0);
}

function formatLargeNum(value) {
  const v = parseFloat(value);
  if (isNaN(v) || v === 0) return '--';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════ */

init();
