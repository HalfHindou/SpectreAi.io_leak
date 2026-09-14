/**
 * Spectre AI — Popup Injector
 * Creates and manages the cashtag hover popup using Shadow DOM
 * Design: Exact match to Spectre AI dashboard cinema-mode token cards
 * Includes sparkline SVG background, corner accents, glassmorphic card
 */

let popupHost = null;
let shadowRoot = null;
let currentPopup = null;
let currentTicker = null;
let hideTimeout = null;
let hideInnerTimeout = null;
let isDayMode = false;
let favorites = [];

// Load favorites from storage on init
try {
  chrome.storage.local.get('spectre_favorites', (result) => {
    favorites = result.spectre_favorites || [];
  });
} catch { /* context may be dead */ }

function initPopupHost() {
  if (popupHost) return;
  popupHost = document.createElement('div');
  popupHost.id = 'spectre-popup-host';
  popupHost.style.cssText = 'position:absolute;top:0;left:0;z-index:999999;pointer-events:none;';
  shadowRoot = popupHost.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = getPopupStyles();
  shadowRoot.appendChild(style);
  document.body.appendChild(popupHost);
}

function openUrl(url) {
  try { chrome.runtime.sendMessage({ type: 'OPEN_TAB', url }); }
  catch { window.open(url, '_blank'); }
}

function showPopup(element, ticker, data) {
  initPopupHost();
  cancelHide();
  if (currentPopup) { currentPopup.remove(); currentPopup = null; }
  currentTicker = ticker;
  const popup = createPopupElement(data);
  shadowRoot.appendChild(popup);
  currentPopup = popup;
  positionPopup(element, popup);
  popup.style.pointerEvents = 'auto';
  popup.addEventListener('mouseenter', cancelHide);
  popup.addEventListener('mouseleave', () => scheduleHide(300));

  // Async image load — popup shows instantly, icon fills in after fetch
  if (data.image) {
    loadLogoAsync(popup, data.image);
  }
}

function loadLogoAsync(popup, imageUrl) {
  chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: imageUrl }, (resp) => {
    if (chrome.runtime.lastError) return; // extension context dead
    if (!resp?.dataUrl || !popup.isConnected) return;
    const logoEl = popup.querySelector('.sp-logo');
    if (!logoEl) return;
    logoEl.innerHTML = `<img src="${resp.dataUrl}" class="sp-logo-img" alt="" />`;
  });
}

function scheduleHide(delay = 200) {
  cancelHide();
  hideTimeout = setTimeout(() => {
    if (currentPopup) {
      currentPopup.classList.add('sp-exit');
      hideInnerTimeout = setTimeout(() => { if (currentPopup) { currentPopup.remove(); currentPopup = null; currentTicker = null; } }, 200);
    }
  }, delay);
}

function cancelHide() {
  if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  if (hideInnerTimeout) { clearTimeout(hideInnerTimeout); hideInnerTimeout = null; }
}

function positionPopup(anchor, popup) {
  const rect = anchor.getBoundingClientRect();
  const popupW = 340;
  const popupH = 460;
  const margin = 10;

  // Horizontal — center on anchor, clamp to viewport
  let left = rect.left + (rect.width / 2) - (popupW / 2) + window.scrollX;
  if (left < 10) left = 10;
  if (left + popupW > window.innerWidth - 10) left = window.innerWidth - popupW - 10;

  // Vertical — 4-branch: below → above → below-clamped → above-clamped
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  let top;

  if (spaceBelow >= popupH + margin) {
    // Fits below — preferred
    top = rect.bottom + margin + window.scrollY;
  } else if (spaceAbove >= popupH + margin) {
    // Fits above
    top = rect.top - popupH - margin + window.scrollY;
    popup.classList.add('sp-above');
  } else if (spaceBelow >= spaceAbove) {
    // Neither fits, more room below — show below, clamp to viewport bottom
    top = rect.bottom + margin + window.scrollY;
    const maxTop = window.scrollY + window.innerHeight - popupH - margin;
    if (top > maxTop) top = maxTop;
  } else {
    // More room above — clamp so top never goes above viewport
    top = Math.max(window.scrollY + margin, rect.top - popupH - margin + window.scrollY);
    popup.classList.add('sp-above');
  }

  popup.style.position = 'absolute';
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

/**
 * Token brand colors matching the app's --brand-rgb system
 */
const BRAND = {
  BTC:  { rgb: '247, 147, 26',  abbr: 'B' },
  ETH:  { rgb: '98, 126, 234',  abbr: 'E' },
  SOL:  { rgb: '20, 241, 149',  abbr: 'S' },
  BNB:  { rgb: '243, 186, 47',  abbr: 'B' },
  XRP:  { rgb: '0, 159, 246',   abbr: 'X' },
  ADA:  { rgb: '0, 51, 173',    abbr: 'A' },
  DOGE: { rgb: '196, 164, 46',  abbr: 'D' },
  AVAX: { rgb: '232, 65, 66',   abbr: 'A' },
  LINK: { rgb: '41, 98, 255',   abbr: 'L' },
  DOT:  { rgb: '230, 0, 122',   abbr: 'D' },
  PEPE: { rgb: '76, 175, 80',   abbr: 'P' },
  ARB:  { rgb: '40, 160, 240',  abbr: 'A' },
};

/**
 * Build sparkline SVG string — port of app's SparklineSVG component
 * Downsample to ~40 points, gradient fill, polyline stroke, pulsing end dot
 */
function buildSparklineSVG(sparkline, brandRgb, isPositive) {
  if (!sparkline || !Array.isArray(sparkline) || sparkline.length < 2) return '';

  const width = 312;
  const height = 108;
  const padTop = 12;
  const padBottom = 14;
  const padX = 2;
  const innerH = height - padTop - padBottom;

  // Downsample + remove outliers by clamping values beyond 3x IQR (prevents one-spike ugliness)
  const target = 42;
  const step = Math.max(1, Math.floor(sparkline.length / target));
  const sampled = [];
  for (let i = 0; i < sparkline.length; i += step) sampled.push(Number(sparkline[i]) || 0);
  if (sampled[sampled.length - 1] !== Number(sparkline[sparkline.length - 1])) {
    sampled.push(Number(sparkline[sparkline.length - 1]) || 0);
  }

  // Robust min/max using percentile (ignore top/bottom 2% as outliers)
  const sorted = [...sampled].sort((a, b) => a - b);
  const pLo = sorted[Math.floor(sorted.length * 0.02)];
  const pHi = sorted[Math.ceil(sorted.length * 0.98) - 1];
  const rawMin = sorted[0];
  const rawMax = sorted[sorted.length - 1];
  // Use percentile range but expand slightly so outlier point still shows (just not dominates)
  const min = Math.min(pLo, rawMin + (pLo - rawMin) * 0.35);
  const max = Math.max(pHi, rawMax - (rawMax - pHi) * 0.35);
  const range = max - min || 1;
  const open = sampled[0];
  const openY = padTop + (1 - (open - min) / range) * innerH;

  const pts = sampled.map((val, i) => {
    const x = padX + (i / (sampled.length - 1)) * (width - padX * 2);
    const y = padTop + (1 - (val - min) / range) * innerH;
    return { x, y: Math.max(padTop - 2, Math.min(height - padBottom + 2, y)) };
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
  const lastPt = pts[pts.length - 1];
  const fillPath = `${linePath} L${width - padX},${height - padBottom + 2} L${padX},${height - padBottom + 2} Z`;

  const colorRgb = isPositive ? '16, 185, 129' : '239, 68, 68';
  const uid = Math.random().toString(36).slice(2, 8);

  return `
    <svg class="sp-sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="fill-${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(${colorRgb}, 0.26)" />
          <stop offset="50%" stop-color="rgba(${colorRgb}, 0.08)" />
          <stop offset="100%" stop-color="rgba(${colorRgb}, 0)" />
        </linearGradient>
        <linearGradient id="stroke-${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(${colorRgb}, 1)" />
          <stop offset="100%" stop-color="rgba(${colorRgb}, 0.85)" />
        </linearGradient>
      </defs>

      <!-- Ghost baseline at opening price -->
      <line x1="${padX}" y1="${openY.toFixed(2)}" x2="${width - padX}" y2="${openY.toFixed(2)}"
            stroke="currentColor" stroke-opacity="0.06" stroke-width="1" stroke-dasharray="3 4" class="sp-baseline" />

      <!-- Area fill -->
      <path d="${fillPath}" fill="url(#fill-${uid})" />

      <!-- Line stroke -->
      <path d="${linePath}" fill="none" stroke="url(#stroke-${uid})"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
            vector-effect="non-scaling-stroke" />

      <!-- Current price dot with soft halo -->
      <circle cx="${lastPt.x.toFixed(2)}" cy="${lastPt.y.toFixed(2)}" r="7" fill="rgba(${colorRgb}, 0.10)" class="sp-sparkline-dot" />
      <circle cx="${lastPt.x.toFixed(2)}" cy="${lastPt.y.toFixed(2)}" r="3" fill="rgba(${colorRgb}, 0.25)" class="sp-sparkline-dot" />
      <circle cx="${lastPt.x.toFixed(2)}" cy="${lastPt.y.toFixed(2)}" r="1.75" fill="rgba(${colorRgb}, 1)" />
    </svg>
  `;
}

/**
 * Generate a short AI analysis sentence for the hover popup.
 * Stock-aware: uses PE, sector, exchange for stocks. Uses F&G for crypto.
 */
function generatePopupAnalysis(token, change24, change1h, change7d, fearGreed, data) {
  const sym = token.symbol || '';
  const isStock = data?.assetType === 'stock';

  if (isStock) {
    // Stock analysis — use PE, sector, market context
    const pe = data?.pe;
    const sector = token.sector || '';
    const mcap = data?.marketCap;

    const direction = change24 > 2 ? 'rallying strongly' :
                      change24 > 0.5 ? 'gaining ground' :
                      change24 > -0.5 ? 'trading flat' :
                      change24 > -2 ? 'pulling back' : 'selling off sharply';

    const valuation = pe ? (pe > 50 ? 'Growth premium' : pe > 25 ? 'Growth-priced' : pe > 15 ? 'Fairly valued' : 'Value territory') : '';
    const mcapLabel = mcap > 500_000_000_000 ? 'Mega-cap' : mcap > 50_000_000_000 ? 'Large-cap' : mcap > 10_000_000_000 ? 'Mid-cap' : 'Small-cap';

    return `${sym} ${direction} today (${change24 > 0 ? '+' : ''}${change24.toFixed(2)}%).${valuation ? ` ${valuation} at ${pe.toFixed(1)}x earnings.` : ''} ${mcapLabel}${sector ? ` ${sector}` : ''}.`;
  }

  // Crypto analysis — use change data + Fear & Greed
  const fg = parseInt(fearGreed?.value) || 50;

  if (change24 >= 5) return `${sym} surging with strong momentum. Bulls in control — watch for profit-taking near resistance.`;
  if (change24 >= 2) return `Solid upward move for ${sym}. Volume supports the rally — key is holding these levels.`;
  if (change24 <= -5) return `Sharp decline in ${sym}. Oversold conditions may present opportunity — watch for support bounce.`;
  if (change24 <= -2) return `${sym} under pressure today. Bears testing support — patience recommended.`;
  if (change7d >= 10) return `${sym} showing strong weekly momentum. Trend remains bullish with healthy accumulation.`;
  if (change7d <= -10) return `Weekly downtrend for ${sym}. Risk-off conditions — wait for reversal confirmation.`;
  if (fg >= 70) return `${sym} trading in a greedy market (F&G: ${fg}). Strong momentum but stay alert for pullbacks.`;
  if (fg <= 30) return `${sym} navigating fear (F&G: ${fg}). Contrarian opportunities emerging for patient buyers.`;
  return `${sym} consolidating in a neutral range. Breakout watch — volume will confirm direction.`;
}

// Watchlist storage — synced via chrome.storage.onChanged
let watchlist = [];
function getWatchlistSymbol(item) { return typeof item === 'string' ? item : item.symbol; }
try {
  chrome.storage.local.get('spectre_watchlist', (result) => {
    watchlist = result.spectre_watchlist || [];
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.spectre_watchlist) {
      watchlist = changes.spectre_watchlist.newValue || [];
    }
  });
} catch { /* context may be dead */ }

/**
 * Get dominance context text for a token
 */
function getDominanceText(symbol, data) {
  const btcDom = parseFloat(data.btcDominance);
  const ethDom = parseFloat(data.ethDominance);
  // TODO: add dominance context when data available
  if (isNaN(btcDom)) return '';
  const btcStr = `BTC.D ${btcDom.toFixed(1)}%`;
  const ethStr = !isNaN(ethDom) ? `ETH.D ${ethDom.toFixed(1)}%` : '';
  switch (symbol) {
    case 'BTC':
      return btcStr;
    case 'ETH':
      return ethStr ? `${ethStr} · ${btcStr}` : btcStr;
    default:
      return ethStr ? `${btcStr} · ${ethStr}` : btcStr;
  }
}

function createPopupElement(data) {
  const { token, price, change24, change1h, change7d, marketCap, volume, sparkline, image, rank, fearGreed, aiPulse, btcDominance, ethDominance, assetType } = data;
  const isStock = assetType === 'stock';
  const change = parseFloat(change24) || 0;
  const isUp = change >= 0;
  const brand = BRAND[token.symbol] || { rgb: isStock ? '59, 130, 246' : '180, 180, 190', abbr: (token.symbol || '?')[0] };

  const deepLink = isStock
    ? `https://finance.yahoo.com/quote/${encodeURIComponent(token.symbol)}`
    : (token.codex?.address
      ? `https://trade.spectreai.io/lite#token/${token.codex.networkId}/${token.codex.address}`
      : `https://trade.spectreai.io/lite?search=${encodeURIComponent(token.symbol)}`);

  // AI Pulse state
  const pulseLabel = aiPulse?.label || 'Neutral';
  const pulseState = (aiPulse?.state || 'NEUTRAL').toLowerCase();

  // Logo: always start with letter, load image async after popup is shown
  const logoInner = `<span class="sp-logo-letter">${esc(brand.abbr)}</span>`;

  // Sparkline SVG background
  const sparklineSVG = buildSparklineSVG(sparkline, brand.rgb, isUp);

  // Change badges for 1h and 7d
  const ch1h = parseFloat(change1h) || 0;
  const ch7d = parseFloat(change7d) || 0;

  // High/Low for crypto
  const high24 = data.high24;
  const low24 = data.low24;
  const circulatingSupply = data.circulatingSupply;

  const popup = document.createElement('div');
  popup.className = `sp-card${isDayMode ? ' sp-day' : ''}`;
  popup.style.setProperty('--brand-rgb', brand.rgb);
  const inWatchlist = watchlist.some(t => getWatchlistSymbol(t) === token.symbol);
  const subtitle = isStock
    ? `${esc(token.exchange || 'STOCK')}${token.sector ? ' · ' + esc(token.sector) : ''}`
    : (rank ? `${esc(token.symbol)} · #${rank}` : esc(token.symbol));

  // Build stat rows — clean aligned pairs, no boxes
  const statRows = [];
  statRows.push({ label: 'Market Cap', value: fmtLarge(marketCap) || '—' });
  statRows.push({ label: isStock ? 'Volume' : '24H Volume', value: fmtLarge(volume) || '—' });
  if (!isStock && high24 && low24) {
    statRows.push({ label: '24H Range', value: `${fmtPrice(low24)} — ${fmtPrice(high24)}` });
  }
  if (isStock && data.pe) {
    statRows.push({ label: 'P/E Ratio', value: `${data.pe.toFixed(1)}x` });
  }
  if (isStock && data.week52High) {
    statRows.push({ label: '52W Range', value: `$${data.week52Low?.toFixed(0) || '?'} – $${data.week52High?.toFixed(0) || '?'}` });
  }
  if (!isStock && circulatingSupply) {
    statRows.push({ label: 'Circulating', value: fmtLargeNum(circulatingSupply) });
  }

  popup.innerHTML = `
    <div class="sp-specular"></div>
    <div class="sp-ambient"></div>

    <!-- Header: Logo + Identity + Watchlist star + Status pill -->
    <div class="sp-header">
      <div class="sp-logo">${logoInner}</div>
      <div class="sp-identity">
        <span class="sp-name">${esc(token.name)}</span>
        <span class="sp-subtitle">${subtitle}</span>
      </div>
      <button class="sp-watchlist-btn${inWatchlist ? ' active' : ''}" data-symbol="${esc(token.symbol)}" title="${inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}" aria-label="Toggle watchlist">
        <svg class="sp-watchlist-icon" width="14" height="14" viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.3 6.9.6-5.2 4.7 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8-5.2-4.7 6.9-.6L12 2.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
      <div class="sp-pulse-badge sp-pulse-${pulseState}">
        <span class="sp-pulse-dot"></span>${esc(pulseLabel)}
      </div>
    </div>

    <!-- Price Hero -->
    <div class="sp-price-hero">
      <span class="sp-price">${fmtPrice(price) || '<span class="sp-na">Price unavailable</span>'}</span>
      ${fmtPrice(price) ? `<span class="sp-change ${isUp ? 'positive' : 'negative'}">${isUp ? '+' : ''}${change.toFixed(2)}%</span>` : ''}
    </div>

    <!-- AI read — single editorial line, no label chrome -->
    <p class="sp-ai-text">${esc(generatePopupAnalysis(token, change, ch1h, ch7d, fearGreed, data))}</p>

    <!-- Chart — generous vertical space, ghost baseline, no grid -->
    <div class="sp-chart-wrap">
      ${sparklineSVG || '<div class="sp-chart-empty">No chart data</div>'}
    </div>

    <!-- Stats — clean aligned rows, hairline dividers -->
    <div class="sp-stats">
      ${statRows.map(s => `
        <div class="sp-stat-row">
          <span class="sp-stat-label">${s.label}</span>
          <span class="sp-stat-value">${s.value}</span>
        </div>
      `).join('')}
    </div>

    <!-- Single centered CTA -->
    <div class="sp-cta-row">
      <button class="sp-cta" data-action="open-sidebar" data-symbol="${esc(token.symbol)}">
        <span class="sp-cta-text">View in Spectre</span>
        <svg class="sp-cta-arrow" width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 8.5L8.5 2.5M8.5 2.5H3.8M8.5 2.5V7.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    <div class="sp-footer">powered by <span class="sp-footer-brand">spectreai.io</span></div>
  `;

  const ctaEl = popup.querySelector('.sp-cta');
  if (ctaEl) ctaEl.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      chrome.runtime.sendMessage({ type: 'TOGGLE_SIDEBAR', symbol: token.symbol });
    } catch { /* context may be dead */ }
    document.dispatchEvent(new CustomEvent('spectre-open-sidebar', { detail: { symbol: token.symbol } }));
  });

  // Watchlist button — toggle add/remove, sync via service worker
  const watchlistBtn = popup.querySelector('.sp-watchlist-btn');
  if (watchlistBtn) {
    const sym = watchlistBtn.dataset.symbol;
    const inList = watchlist.some(t => getWatchlistSymbol(t) === sym);
    if (inList) {
      watchlistBtn.classList.add('active');
    }
    watchlistBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const s = watchlistBtn.dataset.symbol;
      const isWatching = watchlist.some(t => getWatchlistSymbol(t) === s);
      if (isWatching) {
        // Remove
        watchlist = watchlist.filter(t => getWatchlistSymbol(t) !== s);
        watchlistBtn.classList.remove('active');
        try { chrome.runtime.sendMessage({ type: 'UPDATE_WATCHLIST', action: 'remove', token: { symbol: s } }).catch(() => {}); } catch {}
      } else {
        // Add — send full token object so sidebar/popup have name + image
        const tokenObj = { symbol: s, name: token.name || s, image: image || null };
        watchlist.push(tokenObj);
        watchlistBtn.classList.add('active');
        try { chrome.runtime.sendMessage({ type: 'UPDATE_WATCHLIST', action: 'add', token: tokenObj }).catch(() => {}); } catch {}
      }
    });
  }

  return popup;
}

function fmtPrice(p) {
  const v = parseFloat(p);
  if (isNaN(v) || v === 0) return null;
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(2);
  if (v >= 0.01) return '$' + v.toFixed(4);
  return '$' + v.toFixed(6);
}

function fmtLarge(v) {
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return null;
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function fmtLargeNum(v) {
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return null;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function getPopupStyles() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;1,400&family=Space+Grotesk:wght@500;600&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ═══ TOKENS — dark (default), switched by .sp-day ═══ */
    :host {
      --sp-bg-base: #0c0c0e;
      --sp-bg-surface: #131315;
      --sp-glass-bg: rgba(9, 9, 11, 0.88);
      --sp-glass-bg-light: rgba(255, 255, 255, 0.03);
      --sp-glass-border: rgba(255, 255, 255, 0.06);
      --sp-glass-border-strong: rgba(255, 255, 255, 0.10);
      --sp-glass-highlight: rgba(255, 255, 255, 0.06);
      --sp-text-primary: #f5f5f7;
      --sp-text-secondary: rgba(245, 245, 247, 0.66);
      --sp-text-tertiary: rgba(245, 245, 247, 0.48);
      --sp-text-muted: rgba(245, 245, 247, 0.28);
      --sp-bull: #10B981;
      --sp-bull-bright: #34D399;
      --sp-bull-muted: rgba(16, 185, 129, 0.12);
      --sp-bear: #EF4444;
      --sp-bear-bright: #F87171;
      --sp-bear-muted: rgba(239, 68, 68, 0.12);
      --sp-warning: #F59E0B;
      --sp-warning-muted: rgba(245, 158, 11, 0.15);
      --sp-accent: #A78BFA;
      --sp-ease: cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Day mode token overrides */
    .sp-card.sp-day {
      --sp-bg-base: #ffffff;
      --sp-bg-surface: #fafafa;
      --sp-glass-bg: rgba(255, 255, 255, 0.92);
      --sp-glass-bg-light: rgba(0, 0, 0, 0.02);
      --sp-glass-border: rgba(0, 0, 0, 0.06);
      --sp-glass-border-strong: rgba(0, 0, 0, 0.10);
      --sp-glass-highlight: rgba(0, 0, 0, 0.04);
      --sp-text-primary: #0a0a0c;
      --sp-text-secondary: rgba(10, 10, 12, 0.66);
      --sp-text-tertiary: rgba(10, 10, 12, 0.48);
      --sp-text-muted: rgba(10, 10, 12, 0.28);
      --sp-bull: #059669;
      --sp-bull-bright: #10B981;
      --sp-bull-muted: rgba(16, 185, 129, 0.10);
      --sp-bear: #DC2626;
      --sp-bear-bright: #EF4444;
      --sp-bear-muted: rgba(239, 68, 68, 0.08);
      --sp-warning: #D97706;
      --sp-warning-muted: rgba(245, 158, 11, 0.12);
    }

    /* ═══ CARD ═══ */
    .sp-card {
      --brand-rgb: 180, 180, 190;
      --ease: var(--sp-ease);
      width: 340px;
      background:
        linear-gradient(180deg, var(--sp-glass-highlight) 0%, rgba(0,0,0,0) 30%),
        var(--sp-glass-bg);
      backdrop-filter: blur(32px) saturate(180%);
      -webkit-backdrop-filter: blur(32px) saturate(180%);
      border: 1px solid var(--sp-glass-border);
      border-radius: 22px;
      color: var(--sp-text-primary);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
      overflow: hidden;
      animation: spIn 0.42s var(--ease);
      position: relative;
      box-shadow:
        0 28px 72px rgba(0, 0, 0, 0.48),
        0 8px 20px rgba(0, 0, 0, 0.28),
        inset 0 1px 0 var(--sp-glass-highlight);
      -webkit-font-smoothing: antialiased;
      font-variant-numeric: tabular-nums;
      transition: border-color 250ms var(--ease), transform 250ms var(--ease);
    }
    .sp-card:hover { border-color: var(--sp-glass-border-strong); }
    .sp-exit { animation: spOut 0.18s var(--ease) forwards; }
    .sp-above { animation-name: spInAbove; }

    @keyframes spIn {
      from { opacity: 0; transform: translateY(10px) scale(0.98); filter: blur(4px); }
      to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
    }
    @keyframes spOut {
      to { opacity: 0; transform: translateY(4px) scale(0.98); }
    }
    @keyframes spInAbove {
      from { opacity: 0; transform: translateY(-10px) scale(0.98); filter: blur(4px); }
      to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
    }

    /* ═══ AMBIENT GLOW (subtle, brand-tinted from top) ═══ */
    .sp-ambient {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse 90% 50% at 50% -10%, rgba(var(--brand-rgb), 0.09) 0%, transparent 55%);
      pointer-events: none; z-index: 0;
    }

    /* ═══ SPECULAR — Apple vibrant-glass light-from-above physics ═══ */
    .sp-specular {
      position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(255,255,255,0.22) 30%,
        rgba(255,255,255,0.28) 50%,
        rgba(255,255,255,0.22) 70%,
        transparent 100%);
      pointer-events: none; z-index: 3;
      border-top-left-radius: 22px; border-top-right-radius: 22px;
    }
    .sp-card.sp-day .sp-specular {
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(255,255,255,0.9) 30%,
        rgba(255,255,255,1) 50%,
        rgba(255,255,255,0.9) 70%,
        transparent 100%);
    }

    /* ═══ SPARKLINE SVG ═══ */
    .sp-sparkline-svg { display: block; width: 100%; height: 100%; overflow: visible; }
    .sp-sparkline-dot { animation: spDotPulse 2.2s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
    @keyframes spDotPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

    /* ═══ HEADER ═══ */
    .sp-header {
      display: flex; align-items: center; gap: 10px;
      padding: 18px 16px 0 18px;
      position: relative; z-index: 2;
    }
    .sp-logo {
      width: 38px; height: 38px; border-radius: 50%;
      background: var(--sp-glass-bg-light);
      color: var(--sp-text-secondary);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Space Grotesk', 'Inter', sans-serif;
      font-size: 14px; font-weight: 600;
      box-shadow: 0 0 0 1px var(--sp-glass-border-strong), inset 0 1px 0 var(--sp-glass-highlight);
      overflow: hidden;
      flex-shrink: 0;
    }
    .sp-logo-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
    .sp-logo-letter { font-size: 14px; font-weight: 600; }

    .sp-identity { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sp-name {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 19px; font-weight: 500;
      color: var(--sp-text-primary);
      letter-spacing: -0.005em; line-height: 1.15;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      text-transform: uppercase;
    }
    .sp-subtitle {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 9px; font-weight: 500;
      color: var(--sp-text-tertiary);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* ═══ PULSE BADGE (CAUTION, RISK-ON, etc) ═══ */
    .sp-pulse-badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 9px 4px 8px; border-radius: 999px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase; white-space: nowrap; flex-shrink: 0;
      align-self: flex-start;
      border: 1px solid transparent;
    }
    .sp-pulse-dot { width: 5px; height: 5px; border-radius: 50%; animation: spPulse 2s ease-in-out infinite; flex-shrink: 0; }
    @keyframes spPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    .sp-pulse-risk_off { background: var(--sp-bear-muted); color: var(--sp-bear-bright); border-color: rgba(239,68,68,0.18); }
    .sp-pulse-caution  { background: var(--sp-warning-muted); color: var(--sp-warning); border-color: rgba(245,158,11,0.22); }
    .sp-pulse-risk_on  { background: var(--sp-bull-muted); color: var(--sp-bull-bright); border-color: rgba(16,185,129,0.20); }
    .sp-pulse-euphoria { background: rgba(139, 92, 246, 0.12); color: var(--sp-accent); border-color: rgba(139,92,246,0.22); }
    .sp-pulse-neutral  { background: var(--sp-glass-bg-light); color: var(--sp-text-secondary); border-color: var(--sp-glass-border); }
    .sp-pulse-badge .sp-pulse-dot { background: currentColor; }

    /* ═══ PRICE HERO ═══ */
    .sp-price-hero {
      display: flex; align-items: baseline; gap: 10px;
      padding: 14px 18px 14px;
      flex-wrap: wrap;
      position: relative; z-index: 2;
    }
    .sp-price {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 32px; font-weight: 700; color: var(--sp-text-primary);
      letter-spacing: -0.035em;
      line-height: 1;
    }
    .sp-change {
      font-size: 11.5px; font-weight: 600;
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      padding: 4px 10px; border-radius: 999px;
      letter-spacing: -0.01em;
    }
    .sp-change.positive { color: var(--sp-bull-bright); background: var(--sp-bull-muted); }
    .sp-change.negative { color: var(--sp-bear-bright); background: var(--sp-bear-muted); }
    .sp-na {
      font-size: 13px; font-weight: 400; font-style: italic;
      color: var(--sp-text-muted);
    }

    /* ═══ AI TEXT — editorial pull-quote, no label chrome ═══ */
    .sp-ai-text {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 13.5px; line-height: 1.45;
      color: var(--sp-text-secondary);
      font-style: italic;
      letter-spacing: -0.003em;
      padding: 0 18px 16px;
      position: relative; z-index: 2;
      border-bottom: 1px solid var(--sp-glass-border);
      margin-bottom: 2px;
    }

    /* ═══ CHART — generous breathing room, ghost baseline ═══ */
    .sp-chart-wrap {
      position: relative; height: 108px;
      padding: 0 6px;
      margin: 2px 0 6px;
      color: var(--sp-text-primary); /* drives baseline currentColor */
      z-index: 2;
    }
    .sp-chart-wrap svg,
    .sp-chart-wrap canvas {
      width: 100%; height: 100%; display: block;
    }
    .sp-chart-empty {
      height: 100px; display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: var(--sp-text-muted); font-style: italic;
    }

    /* ═══ STATS — aligned rows, hairline dividers ═══ */
    .sp-stats {
      padding: 8px 18px 6px;
      position: relative; z-index: 2;
      border-top: 1px solid var(--sp-glass-border);
      margin-top: 6px;
    }
    .sp-stat-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 9px 0;
      border-bottom: 1px solid var(--sp-glass-border);
    }
    .sp-stat-row:last-child { border-bottom: none; }
    .sp-stat-label {
      font-family: 'Inter', sans-serif;
      font-size: 11.5px; font-weight: 400;
      color: var(--sp-text-tertiary);
      letter-spacing: -0.005em;
    }
    .sp-stat-value {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 12px; font-weight: 600;
      color: var(--sp-text-primary);
      letter-spacing: -0.02em;
    }

    /* ═══ CTA ROW — premium dark pill, same language as sidebar ═══ */
    .sp-cta-row {
      display: flex; align-items: stretch;
      padding: 14px 16px 12px;
      position: relative; z-index: 2;
    }
    .sp-cta {
      flex: 1;
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      padding: 14px 22px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 40%),
        linear-gradient(180deg, #1a1a1d 0%, #0a0a0c 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      color: #ffffff;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px; font-weight: 600;
      cursor: pointer; letter-spacing: -0.01em;
      transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease), border-color 0.28s var(--ease);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.12),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        0 6px 20px rgba(0, 0, 0, 0.45),
        0 1px 2px rgba(0, 0, 0, 0.3);
      position: relative; overflow: hidden;
    }
    .sp-cta::before {
      content: ''; position: absolute; inset: -1px;
      border-radius: inherit;
      background: linear-gradient(135deg, rgba(139,92,246,0.35) 0%, rgba(6,182,212,0.25) 100%);
      opacity: 0; filter: blur(12px); z-index: -1;
      transition: opacity 0.4s var(--ease);
    }
    .sp-cta-text { white-space: nowrap; position: relative; z-index: 1; }
    .sp-cta-arrow { opacity: 0.7; flex-shrink: 0; position: relative; z-index: 1; transition: transform 0.3s var(--ease), opacity 0.3s var(--ease); }
    .sp-cta::after {
      content: ''; position: absolute; top: 0; left: -100%;
      width: 60%; height: 100%;
      background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.16) 50%, transparent 70%);
      transition: left 0.7s var(--ease); pointer-events: none;
    }
    .sp-cta:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.14);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.16),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        0 14px 36px rgba(0, 0, 0, 0.55),
        0 2px 4px rgba(0, 0, 0, 0.3);
    }
    .sp-cta:hover::before { opacity: 1; }
    .sp-cta:hover::after { left: 120%; }
    .sp-cta:hover .sp-cta-arrow { opacity: 1; transform: translate(2px, -2px); }

    /* Watchlist star — small icon button in the header */
    .sp-watchlist-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px;
      flex-shrink: 0;
      background: transparent;
      border: 1px solid var(--sp-glass-border);
      border-radius: 999px;
      color: var(--sp-text-tertiary);
      cursor: pointer; transition: all 0.22s var(--ease);
      padding: 0;
    }
    .sp-watchlist-icon { flex-shrink: 0; transition: transform 0.22s var(--ease); }
    .sp-watchlist-icon path { fill: none; stroke: currentColor; transition: fill 0.2s var(--ease); }
    .sp-watchlist-btn:hover {
      background: var(--sp-glass-bg-light);
      border-color: var(--sp-glass-border-strong);
      color: var(--sp-text-primary);
    }
    .sp-watchlist-btn:hover .sp-watchlist-icon { transform: scale(1.12); }
    .sp-watchlist-btn.active {
      background: var(--sp-warning-muted);
      border-color: rgba(245,158,11,0.28);
      color: var(--sp-warning);
    }
    .sp-watchlist-btn.active .sp-watchlist-icon path { fill: currentColor; }

    /* ═══ FOOTER ═══ */
    .sp-footer {
      display: flex; align-items: center; justify-content: center;
      gap: 4px;
      padding: 0 18px 12px;
      font-family: 'Inter', sans-serif;
      font-size: 9.5px; font-weight: 400;
      letter-spacing: 0.04em;
      color: var(--sp-text-muted);
      position: relative; z-index: 2;
    }
    .sp-footer-brand { color: var(--sp-text-tertiary); font-weight: 500; }

    /* ═══ LOADING ═══ */
    .sp-loading { display: flex; flex-direction: column; gap: 10px; padding: 18px; position: relative; z-index: 2; }
    .sp-skeleton-row { display: flex; align-items: center; gap: 10px; }
    .sp-skeleton-circle { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
    .sp-skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .sp-skeleton-line { height: 10px; border-radius: 4px; }
    .sp-skeleton-line.w60 { width: 60%; } .sp-skeleton-line.w80 { width: 80%; } .sp-skeleton-line.w40 { width: 40%; }
    .sp-skeleton-bar { height: 80px; border-radius: 12px; margin-top: 4px; }
    .sp-skeleton-circle, .sp-skeleton-line, .sp-skeleton-bar {
      background: linear-gradient(90deg, var(--sp-glass-bg-light) 25%, var(--sp-glass-highlight) 50%, var(--sp-glass-bg-light) 75%);
      background-size: 200% 100%; animation: spShimmer 1.8s ease-in-out infinite;
    }
    @keyframes spShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* ═══ ERROR ═══ */
    .sp-error { padding: 28px 18px; text-align: center; color: var(--sp-text-tertiary); font-size: 12px; position: relative; z-index: 2; }
    .sp-error-ticker {
      display: block;
      font-family: 'Playfair Display', Georgia, serif;
      font-weight: 400; font-size: 24px;
      color: var(--sp-text-primary);
      letter-spacing: -0.02em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    /* ═══════════════════════════════════════════════════════════════
       DAY MODE — actual frosted glass on light x.com background
       ═══════════════════════════════════════════════════════════════ */
    .sp-card.sp-day {
      background:
        linear-gradient(180deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.92) 100%);
      backdrop-filter: blur(28px) saturate(180%);
      -webkit-backdrop-filter: blur(28px) saturate(180%);
      border-color: rgba(10, 10, 12, 0.08);
      color: var(--sp-text-primary);
      box-shadow:
        0 24px 60px rgba(12, 18, 32, 0.12),
        0 8px 18px rgba(12, 18, 32, 0.06),
        0 0 0 1px rgba(10, 10, 12, 0.04),
        inset 0 1px 0 rgba(255, 255, 255, 0.9);
    }
    .sp-card.sp-day:hover {
      border-color: rgba(10, 10, 12, 0.12);
      box-shadow:
        0 28px 72px rgba(12, 18, 32, 0.16),
        0 10px 22px rgba(12, 18, 32, 0.08),
        0 0 0 1px rgba(10, 10, 12, 0.06),
        inset 0 1px 0 rgba(255, 255, 255, 0.95);
    }
    /* Day-mode CTA: black pill with white text, matching Sunny's mockup */
    .sp-card.sp-day .sp-cta {
      background: #0a0a0c;
      color: #ffffff;
      box-shadow: 0 6px 18px rgba(12, 18, 32, 0.20), inset 0 1px 0 rgba(255,255,255,0.08);
    }
    .sp-card.sp-day .sp-cta:hover {
      box-shadow: 0 10px 28px rgba(12, 18, 32, 0.28), inset 0 1px 0 rgba(255,255,255,0.12);
    }
    /* Day-mode logo circle gets a light fill so mono abbrs read */
    .sp-card.sp-day .sp-logo {
      background: rgba(10,10,12,0.04);
      box-shadow: 0 0 0 1px rgba(10,10,12,0.08), inset 0 1px 0 rgba(255,255,255,0.6);
    }
  `;
}

function showLoadingPopup(element, ticker) {
  initPopupHost(); cancelHide();
  if (currentPopup) { currentPopup.remove(); currentPopup = null; }
  currentTicker = ticker;
  const brand = BRAND[ticker.toUpperCase()] || { rgb: '180, 180, 190' };
  const popup = document.createElement('div');
  popup.className = `sp-card${isDayMode ? ' sp-day' : ''}`;
  popup.style.setProperty('--brand-rgb', brand.rgb);
  popup.innerHTML = `
    <div class="sp-ambient"></div>
    <div class="sp-loading">
      <div class="sp-skeleton-row"><div class="sp-skeleton-circle"></div><div class="sp-skeleton-lines"><div class="sp-skeleton-line w60"></div><div class="sp-skeleton-line w40"></div></div></div>
      <div class="sp-skeleton-line w80"></div>
      <div class="sp-skeleton-bar"></div>
    </div>
    <div class="sp-footer"><span class="sp-footer-text">powered by </span><span class="sp-footer-brand">spectreai.io</span></div>
  `;
  shadowRoot.appendChild(popup); currentPopup = popup;
  positionPopup(element, popup);
  popup.style.pointerEvents = 'auto';
  popup.addEventListener('mouseenter', cancelHide);
  popup.addEventListener('mouseleave', () => scheduleHide(300));
}

function showErrorPopup(element, ticker) {
  initPopupHost(); cancelHide();
  if (currentPopup) { currentPopup.remove(); currentPopup = null; }
  const brand = BRAND[ticker.toUpperCase()] || { rgb: '180, 180, 190' };
  const popup = document.createElement('div');
  popup.className = `sp-card${isDayMode ? ' sp-day' : ''}`;
  popup.style.setProperty('--brand-rgb', brand.rgb);
  popup.innerHTML = `
    <div class="sp-ambient"></div>
    <div class="sp-error"><span class="sp-error-ticker">$${esc(ticker)}</span><p style="margin-top:8px;opacity:0.7;font-style:italic">Token not found or data unavailable</p></div>
    <div class="sp-footer"><span class="sp-footer-text">powered by </span><span class="sp-footer-brand">spectreai.io</span></div>
  `;
  shadowRoot.appendChild(popup); currentPopup = popup;
  positionPopup(element, popup);
  popup.style.pointerEvents = 'auto';
  popup.addEventListener('mouseenter', cancelHide);
  popup.addEventListener('mouseleave', () => scheduleHide(1500));
  setTimeout(() => scheduleHide(0), 3000);
}

function getCurrentTicker() { return currentTicker; }

function setDayMode(isDay) {
  isDayMode = isDay;
  // Update existing popup if open
  if (currentPopup) {
    currentPopup.classList.toggle('sp-day', isDayMode);
  }
}

export { showPopup, showLoadingPopup, showErrorPopup, scheduleHide, cancelHide, getCurrentTicker, setDayMode };
