/**
 * Spectre AI — Content Script
 * Main entry point injected into X (Twitter) pages
 * Orchestrates cashtag detection, popup display, and sidebar
 */

import { scanPage, startObserver } from './cashtag-detector.js';
import { showPopup, showLoadingPopup, showErrorPopup, scheduleHide, cancelHide, setDayMode } from './popup-injector.js';
import { toggleSidebar, showSidebar, updateTrending, updateFeedMentions, refreshSidebarData, setSidebarDayMode, showProjectDetail } from './sidebar-injector.js';
import { createPendingBadge, updateBadge, injectBadgeKeyframes, setBadgeDayMode } from './badge-injector.js';

// Track cashtag mention counts for trending
const cashtagMentions = new Map();

// Debounce popup requests
let popupDebounce = null;

// Badge batch resolve queue
const pendingBadges = new Map(); // ticker → [cashtagElement, ...]
let batchResolveTimer = null;
const BATCH_RESOLVE_DELAY = 300; // ms debounce

// Cached settings reference (set in init)
let cachedSettings = null;

// Track extension context validity — once dead, never retry
let contextDead = false;
let refreshInterval = null;
let feedScanInterval = null;

// When the user manually toggles day mode via storage, stop auto-detecting from X's theme
let manualDayModeOverride = false;
// Track the last day mode we wrote to storage, so we can ignore our own writes
let lastStoredDayMode = null;

/**
 * Check if the extension context is still valid.
 * Once invalidated (extension reloaded), all chrome.* APIs throw.
 * We cache the result — once dead, it stays dead.
 */
function isContextValid() {
  if (contextDead) return false;
  try {
    if (chrome.runtime?.id) return true;
  } catch { /* accessing chrome.runtime itself can throw */ }
  // Context is dead — kill all intervals and stop all future attempts
  contextDead = true;
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  if (feedScanInterval) { clearInterval(feedScanInterval); feedScanInterval = null; }
  return false;
}

/**
 * Initialize the content script
 */
async function init() {
  console.log('[Spectre] Content script loaded on', window.location.hostname);

  // Check if extension features are enabled
  const settings = await getSettings();
  cachedSettings = settings;
  if (!settings.popupEnabled && !settings.sidebarEnabled) {
    console.log('[Spectre] All features disabled');
    return;
  }

  // Inject badge keyframes for enrichment badges
  if (settings.badgesEnabled !== false) {
    injectBadgeKeyframes();
  }

  // Start scanning for cashtags
  if (settings.popupEnabled) {
    scanPage(onCashtagFound);
    startObserver(onCashtagFound);
  }

  // Restore sidebar state
  try {
    const sidebarState = await chrome.storage.local.get('spectre_sidebar_visible');
    if (settings.sidebarEnabled && sidebarState.spectre_sidebar_visible) {
      toggleSidebar();
    }
  } catch { /* context may be dead */ }

  // Listen for messages from background
  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch { /* context may be dead */ }

  // Load stored day mode preference BEFORE auto-detecting X's theme.
  // If user previously toggled day mode manually, respect it and skip auto-detect.
  try {
    const dayModeResult = await chrome.storage.local.get('spectre_dayMode');
    if (dayModeResult.spectre_dayMode === true) {
      manualDayModeOverride = true;
      lastStoredDayMode = true;
      setDayMode(true);
      setSidebarDayMode(true);
      setBadgeDayMode(true);
    }
  } catch { /* context may be dead */ }

  // Detect X's light/dark mode and sync — observe both <html> and <body>
  // (will be skipped if manualDayModeOverride is true from stored preference)
  detectXDayMode();
  const dayModeObserver = new MutationObserver(detectXDayMode);
  dayModeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-color-mode'] });
  dayModeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });

  // Listen for keyboard shortcut
  document.addEventListener('keydown', onKeydown);

  // Listen for "View in Spectre" CTA from popup — opens sidebar Project tab
  document.addEventListener('spectre-open-sidebar', (e) => {
    showSidebar();
    if (e.detail?.symbol) {
      showProjectDetail(e.detail.symbol);
    }
  });

  // Unified day mode sync via chrome.storage.onChanged
  // When ANY surface (sidebar, extension popup) toggles day mode → storage changes → all surfaces sync
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.spectre_dayMode) return;
      const isDay = !!changes.spectre_dayMode.newValue;
      // If this is a value we wrote ourselves (from auto-detect), ignore it
      if (isDay === lastStoredDayMode) return;
      // User toggled manually from sidebar or extension popup — override auto-detect
      manualDayModeOverride = true;
      setDayMode(isDay);
      setSidebarDayMode(isDay);
      setBadgeDayMode(isDay);
    });
  } catch { /* context may be dead */ }

  // Periodic sidebar refresh — market data every 60s
  refreshInterval = setInterval(() => {
    if (!isContextValid()) return;
    refreshSidebarData();
    updateTrending(cashtagMentions);
  }, 60000);

  // Feed scan — viewport cashtag scanning every 10s
  scanFeedCashtags(); // Initial scan
  feedScanInterval = setInterval(() => {
    if (!isContextValid()) return;
    scanFeedCashtags();
  }, 10000);
}

/**
 * Called when a cashtag is detected in the DOM
 */
function onCashtagFound(element, ticker) {
  // Count mention
  cashtagMentions.set(ticker, (cashtagMentions.get(ticker) || 0) + 1);

  // Attach hover/click handlers
  element.addEventListener('mouseenter', (e) => {
    e.preventDefault();
    cancelHide();
    clearTimeout(popupDebounce);
    popupDebounce = setTimeout(() => requestPopup(element, ticker), 80);
  });

  element.addEventListener('mouseleave', () => {
    clearTimeout(popupDebounce);
    scheduleHide(300);
  });

  // Prevent X's default cashtag click (search redirect)
  element.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // $SPECT / $SPECTRE → redirect to Research Platform
    const upper = ticker.toUpperCase();
    if (upper === 'SPECT' || upper === 'SPECTRE') {
      window.open('https://app.spectreai.io/rz/spectre-ai', '_blank', 'noopener');
      return;
    }
    requestPopup(element, ticker);
  });

  // Add subtle Spectre indicator
  addCashtagBadge(element);

  // Create pending enrichment badge (sentiment alignment)
  if (cachedSettings?.badgesEnabled !== false) {
    createPendingBadge(element, ticker);
    if (!pendingBadges.has(ticker)) pendingBadges.set(ticker, []);
    pendingBadges.get(ticker).push(element);
    clearTimeout(batchResolveTimer);
    batchResolveTimer = setTimeout(batchResolveBadges, BATCH_RESOLVE_DELAY);
  }
}

/**
 * Request popup data from background and display
 */
// Monotonically increasing request id — used to discard stale responses
// that arrive after the user has moved to a different cashtag.
let popupRequestId = 0;
let activeRequestTicker = null;

async function requestPopup(element, ticker) {
  // Bail silently if extension was reloaded
  if (!isContextValid()) return;

  const myId = ++popupRequestId;
  activeRequestTicker = ticker;
  showLoadingPopup(element, ticker);

  try {
    const data = await chrome.runtime.sendMessage({
      type: 'RESOLVE_CASHTAG',
      ticker,
    });

    // Drop this response if the user has since hovered a different cashtag
    if (myId !== popupRequestId) return;

    if (!data || data.error) {
      showErrorPopup(element, ticker);
      return;
    }

    showPopup(element, ticker, data);
  } catch (err) {
    // Drop stale error too
    if (myId !== popupRequestId) return;
    // Silently swallow context invalidated errors
    if (err.message?.includes('context invalidated') || err.message?.includes('Extension context')) {
      contextDead = true;
      if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
      return;
    }
    console.error('[Spectre] Popup request failed:', err);
    showErrorPopup(element, ticker);
  }
}

/**
 * Batch resolve all pending enrichment badges.
 * Debounced — collects cashtags from a burst of DOM mutations, then resolves in one call.
 */
async function batchResolveBadges() {
  if (!isContextValid() || pendingBadges.size === 0) return;

  const tickers = [...pendingBadges.keys()];
  // Snapshot the pending map, then clear it so new arrivals queue separately
  const snapshot = new Map(pendingBadges);
  pendingBadges.clear();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'BATCH_RESOLVE_CASHTAGS',
      tickers,
    });

    if (!response || response.error) return;

    const results = response.results || {};
    const marketState = response.marketState || {};

    for (const [ticker, elements] of snapshot) {
      const data = results[ticker];
      if (!data) continue; // No data — badge stays pending/neutral
      for (const el of elements) {
        updateBadge(el, data, marketState);
      }
    }
  } catch (err) {
    if (err.message?.includes('context invalidated') || err.message?.includes('Extension context')) {
      contextDead = true;
      if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
      return;
    }
    console.warn('[Spectre] Batch badge resolve failed:', err);
  }
}

/**
 * Scan visible tweets in viewport for cashtags and update the sidebar feed section.
 * Runs every 10s — scans tweet text elements currently visible in the viewport.
 */
function scanFeedCashtags() {
  const feedMentions = new Map();
  const cashtagRegex = /\$([A-Z]{2,10})\b/g;

  // Find all tweet text elements currently in the viewport
  const tweetTexts = document.querySelectorAll('[data-testid="tweetText"]');
  for (const el of tweetTexts) {
    // Check if element is in viewport (with 200px margin)
    const rect = el.getBoundingClientRect();
    if (rect.bottom < -200 || rect.top > window.innerHeight + 200) continue;

    const text = el.textContent || '';
    let match;
    while ((match = cashtagRegex.exec(text)) !== null) {
      const ticker = match[1];
      feedMentions.set(ticker, (feedMentions.get(ticker) || 0) + 1);
    }
  }

  updateFeedMentions(feedMentions);
}

/**
 * Add a subtle visual indicator to cashtag elements
 */
function addCashtagBadge(element) {
  element.style.textDecoration = 'none';
  element.style.borderBottom = '1px dashed rgba(245, 245, 247, 0.15)';
  element.style.cursor = 'pointer';
  element.style.transition = 'border-color 150ms cubic-bezier(0.16, 1, 0.3, 1)';

  element.addEventListener('mouseenter', () => {
    element.style.borderBottomColor = 'rgba(245, 245, 247, 0.35)';
  });
  element.addEventListener('mouseleave', () => {
    element.style.borderBottomColor = 'rgba(245, 245, 247, 0.15)';
  });
}

/**
 * Handle messages from background service worker
 */
function onMessage(message) {
  if (message.type === 'MARKET_STATE_UPDATE') {
    refreshSidebarData();
  }
  if (message.type === 'TOGGLE_SIDEBAR') {
    toggleSidebar();
  }
}

/**
 * Keyboard shortcut: Cmd/Ctrl + Shift + S → toggle sidebar
 */
function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    toggleSidebar();
  }
}

/**
 * Detect X/Twitter's light/dark mode using multiple signals
 * X uses different background colors and data attributes depending on theme:
 *   Light: body bg rgb(255,255,255), html[style*="color-scheme: light"]
 *   Dim:   body bg rgb(21,32,43)
 *   Dark:  body bg rgb(0,0,0)
 */
function detectXDayMode() {
  // Skip auto-detection if user manually toggled day mode
  if (manualDayModeOverride) return;

  let isLight = false;

  // Method 1: Check body background luminance (most reliable)
  const bg = getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const lum = (parseInt(match[1]) * 299 + parseInt(match[2]) * 587 + parseInt(match[3]) * 114) / 1000;
    isLight = lum > 180; // Anything brighter than dim mode
  }

  // Method 2: Check X's color-scheme on html element
  if (!isLight) {
    const cs = document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme;
    if (cs === 'light') isLight = true;
  }

  // Method 3: Check for X's known light-mode body class
  if (!isLight && document.body.style.backgroundColor) {
    const bodyBg = document.body.style.backgroundColor;
    if (bodyBg === 'rgb(255, 255, 255)' || bodyBg === '#ffffff' || bodyBg === 'white') {
      isLight = true;
    }
  }

  setDayMode(isLight);
  setSidebarDayMode(isLight);
  setBadgeDayMode(isLight);
  // Persist auto-detected state so extension popup picks it up
  lastStoredDayMode = isLight;
  try { chrome.storage.local.set({ spectre_dayMode: isLight }); } catch { /* context dead */ }
}

/**
 * Get extension settings
 */
async function getSettings() {
  try {
    const result = await chrome.storage.local.get('spectre_settings');
    return result.spectre_settings || {
      popupEnabled: true,
      badgesEnabled: true,
      sidebarEnabled: true,
      sidebarPosition: 'right',
    };
  } catch {
    return {
      popupEnabled: true,
      badgesEnabled: true,
      sidebarEnabled: true,
      sidebarPosition: 'right',
    };
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
