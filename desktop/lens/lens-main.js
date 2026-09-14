'use strict';

/* =====================================================
   Spectre Lens v3 — Main Process Controller
   560x52 bar, screen-saver alwaysOnTop, passive detection,
   real intelligence, TradingView MCP, price alerts,
   whale flow, market context, history cap 50
   ===================================================== */

const { app, BrowserWindow, screen, ipcMain, systemPreferences, shell, Notification } = require('electron');
const path    = require('path');
const { captureScreen }       = require('./screenshot');
const { extractTokenContext } = require('./vision');
const { startRecording, stopRecording, receiveAudioData, setOverlayWebContents } = require('./audio');
const { transcribeAudio }     = require('./whisper');
const { synthesizeSpeech }    = require('./elevenlabs');
const Store   = require('electron-store');
const axios   = require('axios');

const store   = new Store();
let overlayWin    = null;
let isListening   = false;
let isActive      = false;
let listenTimer   = null;
let passiveTimer  = null;
let lastPassiveSym = null;
let passiveNudgeTimer = null;
let hasShownWelcome = false;
let lastDismissTime = 0;
let lastNudgeAutoHideTime = 0;

// Saved position for persistent placement
let savedPosition = store.get('lens.position', null);

// Window dimensions — 560px width per design law
const BAR_W = 560;
const BAR_H = 56;  // 52px bar + 4px breathing room for border/shadow
const EXPANDED_H = 640;
const NUDGE_W = 360;
const NUDGE_H = 48;

// Server URL
const API_BASE = process.env.SPECTRE_API_URL || 'http://localhost:3001';

// ── Init ─────────────────────────────────────────────────────────
async function initLens() {
  await requestPermissions();
  createOverlayWindow();
  setupIPC();
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    width:           BAR_W,
    height:          BAR_H,
    frame:           false,
    transparent:     true,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    resizable:       false,
    movable:         true,
    show:            false,
    hasShadow:       true,
    titleBarStyle:   'hidden',
    webPreferences: {
      preload:         path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));

  // screen-saver level clears EVERYTHING — floats above notch/fullscreen
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (overlayWin.setWindowButtonVisibility) {
    overlayWin.setWindowButtonVisibility(false);
  }
  overlayWin.setFullScreenable(false);

  // Connect renderer webContents to audio module
  setOverlayWebContents(overlayWin.webContents);

  // Save position when user drags
  overlayWin.on('moved', () => {
    if (isActive) {
      const bounds = overlayWin.getBounds();
      savedPosition = { x: bounds.x, y: bounds.y };
      store.set('lens.position', savedPosition);
    }
  });
}

// ── Main trigger ─────────────────────────────────────────────────
async function triggerLens() {
  if (!overlayWin) return;

  if (isActive) {
    dismissLens();
    return;
  }

  // Clear any pending passive nudge before activating
  if (passiveNudgeTimer) { clearTimeout(passiveNudgeTimer); passiveNudgeTimer = null; }
  if (overlayWin.isVisible()) {
    overlayWin.hide();  // Hide nudge first, then reposition for active mode
  }

  isActive = true;
  stopPassiveDetection();

  // Position at top-center, just below the Mac menu bar / notch
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, width } = display.bounds;

  if (savedPosition) {
    const wa = display.workArea;
    const px = Math.max(wa.x, Math.min(savedPosition.x, wa.x + wa.width - BAR_W));
    const py = Math.max(wa.y, Math.min(savedPosition.y, wa.y + wa.height - BAR_H));
    overlayWin.setBounds({ x: px, y: py, width: BAR_W, height: BAR_H }, true);
  } else {
    overlayWin.setBounds({
      x: Math.round(x + (width / 2) - (BAR_W / 2)),
      y: display.workArea.y,
      width: BAR_W,
      height: BAR_H,
    }, true);
  }

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.showInactive();

  // Show welcome state on first activation
  if (!hasShownWelcome) {
    hasShownWelcome = true;
    sendToOverlay('lens:state', { state: 'welcome' });
  } else {
    sendToOverlay('lens:state', { state: 'idle' });
  }

  // Show listening state — wait for user to speak, type, or tap "Scan"
  // Do NOT auto-fire the pipeline. User controls when to analyze.
  await sleep(300);
  await startListeningMode();
}

async function startListeningMode() {
  isListening = true;
  sendToOverlay('lens:state', { state: 'listening' });

  try {
    startRecording();
  } catch (err) {
    console.warn('[Lens] Mic not available, text-only mode:', err.message);
  }

  // No auto-timeout — user triggers analysis by:
  //   1. Typing a query + hitting Enter/Send
  //   2. Clicking the "Scan" button (lens:scan-screen IPC)
  //   3. Pressing ⌘+Shift+L again to toggle-scan
  // Mic stays open for voice — user says something then hits send
}

// ── Core pipeline ────────────────────────────────────────────────
async function processLens(forcedQuery = null) {
  if (!isListening && forcedQuery === null) return;
  isListening = false;

  if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }

  sendToOverlay('lens:state', { state: 'scanning' });

  try {
    // 1. Stop mic, transcribe
    let query = forcedQuery;
    if (query === null) {
      sendToOverlay('lens:state', { state: 'processing' });
      let audioBuffer = null;
      try {
        audioBuffer = await stopRecording();
      } catch (err) {
        console.warn('[Lens] Failed to stop recording:', err.message);
      }
      if (audioBuffer) {
        try { query = await transcribeAudio(audioBuffer); } catch (e) {
          console.warn('[Lens] Transcription failed, continuing with screen-only:', e.message);
          query = '';
        }
      } else {
        query = '';
      }
    }

    sendToOverlay('lens:query', { query });

    // 2. Capture screen
    let screenshot;
    try {
      screenshot = await captureScreen(overlayWin);
    } catch (err) {
      console.error('[Lens] Screenshot failed:', err.message);
      sendToOverlay('lens:error', { message: 'Screen capture failed. Go to System Preferences \u2192 Privacy \u2192 Screen Recording and enable Spectre AI.' });
      return;
    }
    if (!screenshot) {
      sendToOverlay('lens:error', { message: 'Screen capture returned empty. Grant screen recording permission and try again.' });
      return;
    }

    // 3. Vision: extract entity
    sendToOverlay('lens:state', { state: 'analyzing' });
    let context;
    try {
      context = await extractTokenContext(screenshot);
    } catch (err) {
      console.error('[Lens] Vision API failed:', err.message);
      sendToOverlay('lens:error', { message: 'Vision unavailable. Check ANTHROPIC_API_KEY in your .env file.' });
      return;
    }
    sendToOverlay('lens:context', { context });

    if (!context.symbol && !context.name) {
      sendToOverlay('lens:error', { message: 'No token or stock detected on screen. Navigate to a page with a ticker and try again.' });
      return;
    }

    // 3.5. If on TradingView and user gave a voice command, route to TV MCP
    if (context.isOnTradingView && query && query.length > 3) {
      try {
        const { parseTradingViewCommand, executeTVCommand } = require('./tradingview-mcp');
        sendToOverlay('lens:tv-mode', {
          symbol:    context.currentSymbol || context.symbol,
          timeframe: context.timeframe,
        });
        const parsed = await parseTradingViewCommand(query);
        await executeTVCommand(parsed, context);
        sendToOverlay('lens:tv-result', { command: parsed });
        saveToHistory({ symbol: context.symbol, verdict: 'TV' }, context);
        return;
      } catch (err) {
        console.warn('[Lens] TradingView MCP failed, falling back to analysis:', err.message);
      }
    }

    // 4. Route to Spectre intelligence backend
    let result;
    try {
      result = await querySpectreIntelligence(context, query);
    } catch (err) {
      console.error('[Lens] Intelligence API failed:', err.message);
      if (err.message?.includes('ECONNREFUSED')) {
        sendToOverlay('lens:error', { message: 'Cannot reach Spectre backend. Is the server running on localhost:3001?' });
      } else {
        sendToOverlay('lens:error', { message: 'Intelligence API unreachable. Check your server connection.' });
      }
      return;
    }

    // 5. Send result to overlay
    sendToOverlay('lens:result', { result, context, query });
    sendToOverlay('lens:state', { state: 'result' });

    // 6. Save to history
    saveToHistory(result, context);

    // 7. Check price alerts
    checkPriceAlerts(result.price || context.price, context.symbol);

    // 8. Optional voice response
    const voiceEnabled = store.get('lens.voiceEnabled', true);
    if (voiceEnabled && result.verdictSpoken) {
      try {
        const audio = await synthesizeSpeech(result.verdictSpoken);
        sendToOverlay('lens:audio', { audio });
      } catch (err) {
        console.warn('[Lens] Voice synthesis failed:', err.message);
      }
    }

  } catch (err) {
    console.error('[Lens] Pipeline error:', err);
    let msg = 'Something went wrong. Please try again.';
    if (err.message?.includes('ELEVENLABS')) {
      msg = 'Voice transcription failed. Check ELEVENLABS_API_KEY in your .env file.';
    }
    sendToOverlay('lens:error', { message: msg });
  }
}

// ── Spectre Intelligence API (enhanced) ──────────────────────────
async function querySpectreIntelligence(context, query) {
  const apiKey = process.env.SPECTRE_API_KEY || store.get('apiKey');
  const ticker = context.symbol || context.name;
  if (!ticker) throw new Error('no-entity');

  // Try the lens endpoint first, then fallback patterns
  const endpoints = [
    '/api/v1/lens/analyze',
    '/api/v1/search/quick',
    '/api/v1/intel/quick',
    '/api/v1/research/quick',
  ];

  let data = null;
  for (const ep of endpoints) {
    try {
      const res = await axios.post(`${API_BASE}${ep}`, {
        symbol:   context.symbol,
        name:     context.name,
        address:  context.address || null,
        chain:    context.chain   || null,
        price:    context.price   || null,
        platform: context.platform || null,
        query:    query || 'Quick intelligence summary',
        mode:     'lens',
        ticker,
      }, {
        headers: {
          'Authorization': apiKey ? `Bearer ${apiKey}` : '',
          'Content-Type':  'application/json',
          'X-Client':      'spectre-lens/3.0',
        },
        timeout: 15000,
      });
      data = res.data;
      break;
    } catch (e) { continue; }
  }

  if (!data) {
    // Fallback: build from vision context alone
    return buildFallbackResult(context);
  }

  // Fetch live price (more accurate than vision)
  let livePrice = null;
  try {
    const pr = await axios.get(`${API_BASE}/api/v1/price/${ticker}`, {
      headers: { 'Authorization': apiKey ? `Bearer ${apiKey}` : '' },
      timeout: 4000,
    });
    livePrice = pr.data;
  } catch (e) { /* use vision/server price */ }

  // Derive numeric scores
  const sentimentScore = data.sentimentScore ?? signalToPercent(data.signals?.sentiment) ?? mapSentimentLabel(data.sentiment);
  const onchainScore   = data.onchainScore   ?? signalToPercent(data.signals?.onchain)   ?? mapOnchainSignal(data.onchain);
  const momentumScore  = data.momentumScore  ?? signalToPercent(data.signals?.momentum)  ?? mapPriceChange(livePrice?.change24h ?? data.change24h ?? context.change24h);
  const whaleScore     = data.whaleScore     ?? mapWhaleSignal(data.whaleFlow || data.whales);

  return {
    symbol:      ticker,
    name:        data.name    || context.name,
    price:       livePrice?.price     || data.price     || context.price,
    change24h:   livePrice?.change24h || data.change24h || context.change24h,
    mcap:        formatLargeNumber(data.marketCap || livePrice?.marketCap),
    volume24h:   formatLargeNumber(data.volume24h || livePrice?.volume24h),
    rank:        data.rank    || livePrice?.rank,
    fearGreed:   data.fearGreed || null,
    signals: {
      sentiment: sentimentScore,
      onchain:   onchainScore,
      momentum:  momentumScore,
      whale:     whaleScore,
    },
    verdict:       deriveVerdict(sentimentScore, onchainScore, momentumScore, whaleScore),
    verdictText:   data.verdictText || data.summary || data.quickSummary || '',
    verdictSpoken: buildSpokenVerdict(ticker, data),
    keyInsight:    extractKeyInsight(data),
    meta:          data.meta || {},
    timestamp:     data.timestamp || new Date().toISOString(),
  };
}

// Signal helpers
function signalToPercent(val) {
  if (val == null) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  // If already 0-100 range, use as-is
  if (n >= 0 && n <= 100) return Math.round(n);
  // If -1..1 range, convert
  return Math.round(((n + 1) / 2) * 100);
}

function mapSentimentLabel(label) {
  if (!label) return 50;
  const l = label.toLowerCase();
  if (l.includes('very bull') || l.includes('extreme greed')) return 88;
  if (l.includes('bull') || l.includes('greed')) return 70;
  if (l.includes('very bear') || l.includes('extreme fear')) return 12;
  if (l.includes('bear') || l.includes('fear')) return 30;
  return 50;
}

function mapOnchainSignal(data) {
  if (!data) return 50;
  if (typeof data === 'number') return Math.max(0, Math.min(100, data));
  const s = JSON.stringify(data).toLowerCase();
  if (s.includes('accumulation') || s.includes('inflow'))  return 72;
  if (s.includes('distribution') || s.includes('outflow')) return 28;
  return 50;
}

function mapPriceChange(change) {
  if (change == null) return 50;
  const c = Number(change);
  if (c > 5) return 78; if (c > 2) return 64;
  if (c < -5) return 22; if (c < -2) return 36;
  return 50;
}

function mapWhaleSignal(data) {
  if (!data) return 50;
  const s = JSON.stringify(data).toLowerCase();
  if (s.includes('accumulating') || s.includes('buying')) return 75;
  if (s.includes('dumping') || s.includes('selling')) return 25;
  return 50;
}

function deriveVerdict(s, o, m, w) {
  const avg = (s + o + m + w) / 4;
  if (avg >= 65) return 'BULLISH';
  if (avg <= 35) return 'BEARISH';
  return 'NEUTRAL';
}

function buildSpokenVerdict(ticker, result) {
  const v = result.verdict?.toLowerCase() || 'neutral';
  const s = result.quickSummary || result.summary || result.verdictText || '';
  const first = s.split('.')[0];
  return first
    ? `${ticker} is ${v}. ${first}.`.replace(/\s+/g, ' ').trim()
    : `${ticker} showing ${v} signals across sentiment and on-chain data.`;
}

function extractKeyInsight(result) {
  const candidates = [
    result.keyInsight, result.insight, result.highlight,
    result.summary?.split('. ')[0],
    result.verdictText?.split('. ')[0],
  ];
  for (const c of candidates) { if (c && c.length > 10) return c; }
  return 'No key insight available for this asset.';
}

function formatLargeNumber(n) {
  if (!n) return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9)  return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6)  return `$${(num / 1e6).toFixed(2)}M`;
  return `$${num.toLocaleString()}`;
}

function buildFallbackResult(context) {
  return {
    symbol:      context.symbol,
    name:        context.name,
    price:       context.price || null,
    change24h:   context.change24h || null,
    mcap:        null,
    volume24h:   null,
    rank:        null,
    fearGreed:   null,
    signals:     { sentiment: 50, onchain: 50, momentum: 50, whale: 50 },
    verdict:     'NEUTRAL',
    verdictText: `Detected ${context.symbol || context.name} on ${context.platform || 'screen'}. Server unavailable \u2014 showing screen data only.`,
    verdictSpoken: `${context.symbol || context.name}. Server is currently unavailable.`,
    keyInsight:  'Start the Spectre server for full intelligence analysis.',
    meta:        { model: 'fallback', priceSource: 'screen' },
    timestamp:   new Date().toISOString(),
  };
}

// ── Passive detection ────────────────────────────────────────────
function startPassiveDetection() {
  if (passiveTimer) return;
  lastPassiveSym = null;
  console.log('[Lens] Passive detection started (30s interval)');

  passiveTimer = setInterval(async () => {
    if (isActive || overlayWin?.isVisible()) return;

    // Cooldown: don't nag after dismiss or auto-hide
    const now = Date.now();
    if (now - lastDismissTime < 60000) return;       // 60s after user dismiss
    if (now - lastNudgeAutoHideTime < 45000) return; // 45s after auto-hide

    try {
      const screenshot = await captureScreen(null);
      if (!screenshot) return;

      const context = await extractTokenContext(screenshot);
      if (!context.symbol && !context.name) return;
      if (context.confidence === 'low') return;

      const sym = (context.symbol || context.name).toUpperCase();
      if (sym === lastPassiveSym) return;
      lastPassiveSym = sym;

      // Fetch live price
      let livePrice = context.price;
      let liveChange = context.change24h;
      try {
        const priceRes = await axios.post(
          `${API_BASE}/api/v1/lens/analyze`,
          { symbol: sym, name: context.name, price: context.price, mode: 'lens', query: 'Quick price check' },
          { headers: { 'Content-Type': 'application/json', 'X-Client': 'spectre-lens/3.0' }, timeout: 8000 }
        );
        livePrice  = priceRes.data?.price  || livePrice;
        liveChange = priceRes.data?.change24h || liveChange;
      } catch (e) { /* use vision price */ }

      // Check price alerts
      if (livePrice) checkPriceAlerts(livePrice, sym);

      // Show nudge
      showPassiveNudge({
        ...context,
        symbol:    sym,
        price:     livePrice,
        change24h: liveChange,
      });

    } catch (err) {
      console.warn('[Lens] Passive detect error:', err.message);
    }
  }, 30000);
}

function stopPassiveDetection() {
  if (passiveTimer) { clearInterval(passiveTimer); passiveTimer = null; }
  if (passiveNudgeTimer) { clearTimeout(passiveNudgeTimer); passiveNudgeTimer = null; }
}

function showPassiveNudge(context) {
  if (!overlayWin) return;
  if (isActive) return;                  // Don't nudge during active use
  if (overlayWin.isVisible()) return;    // Don't stack nudges

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, width } = display.bounds;

  overlayWin.setBounds({
    x: Math.round(x + width / 2 - NUDGE_W / 2),
    y: display.workArea.y,
    width: NUDGE_W,
    height: NUDGE_H,
  }, true);

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.showInactive();
  sendToOverlay('lens:passive-detect', { context });

  // Auto-dismiss after 8s if no interaction
  if (passiveNudgeTimer) clearTimeout(passiveNudgeTimer);
  passiveNudgeTimer = setTimeout(() => {
    if (!isActive) {
      lastNudgeAutoHideTime = Date.now();
      overlayWin?.hide();
      if (process.platform === 'darwin') app.hide();
    }
  }, 8000);
}

// ── Passive activation ───────────────────────────────────────────
async function handlePassiveActivate(symbol) {
  isActive = true;
  stopPassiveDetection();

  // Expand from nudge to full panel, centered
  const bounds = overlayWin.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const { x, width } = display.bounds;

  overlayWin.setBounds({
    x: Math.round(x + width / 2 - BAR_W / 2),
    y: display.workArea.y,
    width: BAR_W,
    height: EXPANDED_H,
  }, true);

  sendToOverlay('lens:state', { state: 'analyzing' });

  try {
    const context = { symbol, name: symbol };
    const result = await querySpectreIntelligence(context, 'Give me a quick intelligence summary');

    sendToOverlay('lens:result', { result, context });
    sendToOverlay('lens:state', { state: 'result' });
    saveToHistory(result, context);

    const voiceEnabled = store.get('lens.voiceEnabled', true);
    if (voiceEnabled && result.verdictSpoken) {
      try {
        const audio = await synthesizeSpeech(result.verdictSpoken);
        sendToOverlay('lens:audio', { audio });
      } catch (err) {
        console.warn('[Lens] Voice synthesis failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[Lens] Passive activate error:', err);
    sendToOverlay('lens:error', { message: 'Analysis failed. Please try again.' });
  }
}

// ── Price alerts ─────────────────────────────────────────────────
function checkPriceAlerts(detectedPrice, detectedSymbol) {
  if (!detectedPrice || !detectedSymbol) return;
  const price = Number(detectedPrice);
  if (isNaN(price)) return;

  const alerts = store.get('price-alerts', []);
  const triggered = [];

  alerts.forEach(alert => {
    if (alert.symbol !== detectedSymbol) return;
    if (price >= alert.alertAbove || price <= alert.alertBelow) {
      try {
        new Notification({
          title: `${alert.symbol} price alert triggered`,
          body: `Current: $${price.toFixed(2)} (alert: above $${alert.alertAbove?.toFixed(2)} / below $${alert.alertBelow?.toFixed(2)})`,
        }).show();
      } catch (e) { /* notifications may fail */ }
      triggered.push(alert);
    }
  });

  if (triggered.length > 0) {
    store.set('price-alerts', alerts.filter(a => !triggered.includes(a)));
  }
}

// ── History ──────────────────────────────────────────────────────
function saveToHistory(result, context) {
  try {
    const history = store.get('lens.history', []);
    history.unshift({
      ticker:     result.symbol || context.symbol,
      symbol:     result.symbol || context.symbol,
      name:       result.name || context.name,
      platform:   context.platform,
      verdict:    result.verdict,
      price:      result.price || context.price,
      change24h:  result.change24h || context.change24h,
      keyInsight: (result.keyInsight || '').slice(0, 200),
      detectedAt: Date.now(),
      timestamp:  result.timestamp || new Date().toISOString(),
    });
    if (history.length > 50) history.length = 50;
    store.set('lens.history', history);
  } catch (err) {
    console.warn('[Lens] History save error:', err.message);
  }
}

// ── Dismiss ──────────────────────────────────────────────────────
function dismissLens() {
  lastDismissTime = Date.now();
  isActive    = false;
  isListening = false;
  if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
  stopRecording().catch(() => {});
  sendToOverlay('lens:reset');

  setTimeout(() => {
    if (overlayWin) {
      overlayWin.hide();
      // Prevent macOS from activating the main Spectre window
      if (process.platform === 'darwin') app.hide();
      overlayWin.setBounds({
        ...overlayWin.getBounds(),
        width: BAR_W,
        height: BAR_H,
      }, true);
    }
    startPassiveDetection();
  }, 250);
}

// ── IPC setup ────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.on('lens:stop-listening', () => {
    if (isListening) processLens(null);
  });

  ipcMain.on('lens:start-listening', () => {
    if (isActive && !isListening) startListeningMode();
  });

  ipcMain.on('lens:dismiss', () => dismissLens());

  ipcMain.on('lens:retry', () => {
    if (isActive) startListeningMode();
  });

  ipcMain.on('lens:text-query', (_, { query }) => {
    isListening = false;
    if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
    stopRecording().catch(() => {});
    processLens(query);
  });

  // Scan button — user explicitly triggers screen analysis (no voice)
  ipcMain.on('lens:scan-screen', () => {
    isListening = false;
    if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
    stopRecording().catch(() => {});
    processLens('');
  });

  ipcMain.on('lens:audio-data', (_, data) => {
    receiveAudioData(data);
  });

  ipcMain.on('lens:toggle-voice', (_, { enabled }) => {
    store.set('lens.voiceEnabled', enabled);
  });

  // Resize window — smooth native resize
  ipcMain.on('lens:resize', (_, { width, height }) => {
    if (!overlayWin) return;
    const bounds = overlayWin.getBounds();
    overlayWin.setBounds({
      x: bounds.x, y: bounds.y,
      width:  width  || bounds.width,
      height: height || bounds.height,
    }, true);
  });

  // Deep dive — open main Spectre window
  ipcMain.on('lens:open-deep-dive', (_, { symbol }) => {
    const wins = BrowserWindow.getAllWindows().filter(w => w !== overlayWin);
    const mainWin = wins[0];
    if (mainWin) {
      mainWin.showInactive();  // Navigate without stealing focus
      mainWin.webContents.send('spectre:navigate', {
        path: '/search', query: symbol, mode: 'deep',
      });
    }
    dismissLens();
  });

  // Open URL (Share to X)
  ipcMain.on('lens:open-url', (_, { url }) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  // Price alert
  ipcMain.on('lens:set-alert', (_, { symbol, currentPrice }) => {
    const alerts = store.get('price-alerts', []);
    alerts.push({
      symbol,
      currentPrice,
      alertAbove: currentPrice * 1.05,
      alertBelow: currentPrice * 0.95,
      createdAt:  Date.now(),
    });
    store.set('price-alerts', alerts);
    sendToOverlay('lens:alert-set', { symbol, currentPrice });

    try {
      new Notification({
        title: `Alert set for ${symbol}`,
        body:  `Notify above $${(currentPrice * 1.05).toFixed(2)} or below $${(currentPrice * 0.95).toFixed(2)}`,
      }).show();
    } catch (e) { /* ok */ }
  });

  // Passive detection activate
  ipcMain.on('lens:passive-activate', (_, { symbol }) => {
    handlePassiveActivate(symbol);
  });

  // History
  ipcMain.on('lens:history-load', () => {
    const history = store.get('lens.history', []);
    sendToOverlay('lens:history-data', { history });
  });

  ipcMain.on('lens:history-save', (_, { history }) => {
    store.set('lens.history', history);
  });

  // Pin to watchlist
  ipcMain.on('lens:pin-watchlist', (_, data) => {
    const watchlist = store.get('watchlist', []);
    if (!watchlist.find(w => w.symbol === data.symbol)) {
      watchlist.push({ symbol: data.symbol, name: data.name, price: data.price, addedAt: Date.now() });
      store.set('watchlist', watchlist);
    }
  });

  // TradingView command from overlay
  ipcMain.on('lens:tv-command', async (_, { command }) => {
    try {
      const { parseTradingViewCommand, executeTVCommand } = require('./tradingview-mcp');
      const parsed = await parseTradingViewCommand(command);
      await executeTVCommand(parsed, {});
      sendToOverlay('lens:tv-result', { command: parsed });
    } catch (err) {
      console.warn('[Lens] TV command failed:', err.message);
      sendToOverlay('lens:tv-result', { command: { action: 'error', error: err.message } });
    }
  });

  // Conversation
  ipcMain.on('lens:conversation', (_, data) => handleConversation(data));

  ipcMain.on('lens:conversation-voice', async (_, data) => {
    try {
      const buffer = data.buffer ? new Uint8Array(data.buffer) : null;
      const text = buffer ? await transcribeAudio(buffer) : '';
      sendToOverlay('lens:conversation-transcription', { text });
    } catch (err) {
      console.warn('[Lens] Conversation voice transcription failed:', err.message);
      sendToOverlay('lens:conversation-transcription', { text: '' });
    }
  });
}

// ── Conversation handler ─────────────────────────────────────────
async function handleConversation(data) {
  const apiKey = process.env.SPECTRE_API_KEY || store.get('apiKey');
  try {
    const response = await axios.post(
      `${API_BASE}/api/v1/lens/conversation`,
      { message: data.message, history: data.history, context: data.context, result: data.result },
      {
        headers: { 'Authorization': apiKey ? `Bearer ${apiKey}` : '', 'Content-Type': 'application/json', 'X-Client': 'spectre-lens/3.0' },
        timeout: 20000,
      }
    );
    sendToOverlay('lens:conversation-reply', { reply: response.data.reply || response.data.message || '' });
  } catch (err) {
    console.warn('[Lens] Conversation error:', err.message);
    sendToOverlay('lens:conversation-reply', { error: true });
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function sendToOverlay(channel, data) {
  overlayWin?.webContents.send(channel, data || {});
}

async function requestPermissions() {
  if (process.platform !== 'darwin') return;
  const mic = systemPreferences.getMediaAccessStatus('microphone');
  if (mic !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { initLens, triggerLens, startPassiveDetection, stopPassiveDetection };
