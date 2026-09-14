# SPECTRE LENS — CLAUDE CODE BUILD INSTRUCTIONS

> Spectre Lens is a floating intelligence overlay that lives inside the Spectre desktop app.
> Press Cmd+Shift+L from anywhere on your Mac — Dexscreener, TradingView, Binance, X, anywhere.
> Lens reads your screen, identifies what token or stock you are looking at, and surfaces
> full Spectre intelligence without you switching windows or typing anything.

---

## WHAT YOU ARE BUILDING

A floating glass overlay window that:
1. Activates on global hotkey Cmd+Shift+L from anywhere on the system
2. Captures the screen silently in the background
3. Sends screenshot to GPT-4o Vision to detect the token/stock being viewed
4. Optionally listens to a voice query from the user
5. Routes detected entity + query to Spectre's existing intelligence backend
6. Displays a compact result card — price, signals, verdict, bull/bear
7. Speaks the verdict via ElevenLabs (optional, toggleable)
8. Dismisses on Escape or second hotkey press

Lens lives INSIDE the existing desktop app — it is a feature, not a separate app.

---

## STEP 0 — READ BEFORE WRITING ANY CODE

Read these files first:
```bash
# Design rules — mandatory
cat SPECTRE_DESIGN_LAW.md

# Existing desktop app structure
ls -la desktop/
cat desktop/electron.js          # already has the hotkey placeholder

# Check existing API patterns
grep -rn "analyzeToken\|perplexity\|intelligence" server/ --include="*.js" | head -20

# Check existing voice/audio setup
grep -rn "ElevenLabs\|whisper\|elevenlabs" apps/ server/ --include="*.js" | head -20
```

The Lens hotkey Cmd+Shift+L is already reserved in desktop/electron.js — commented out.
The tray menu already has "Spectre Lens — Coming Soon".
Your job is to uncomment and build.

---

## STEP 1 — FOLDER STRUCTURE

Add these files to the existing desktop/ folder:

```
desktop/
  lens/
    overlay.html          ← the floating glass card UI
    overlay.css           ← Spectre design system styles
    overlay.js            ← UI state machine (renderer process)
    lens-main.js          ← main process logic (screen capture, vision, API)
    screenshot.js         ← screen capture module
    vision.js             ← GPT-4o Vision: entity extraction
    audio.js              ← mic recording
    whisper.js            ← transcription
    elevenlabs.js         ← voice response
```

---

## STEP 2 — ACTIVATE THE EXISTING PLACEHOLDER

In desktop/electron.js, find the commented Lens lines and uncomment/replace:

```javascript
// FIND THIS (already in electron.js):
// globalShortcut.register('CommandOrControl+Shift+L', () => activateLens());

// REPLACE WITH:
const { initLens, triggerLens } = require('./lens/lens-main');

app.whenReady().then(async () => {
  // ... existing code ...

  // Init Lens
  await initLens();

  // Register hotkey
  globalShortcut.register('CommandOrControl+Shift+L', () => triggerLens());
});

// ALSO find the tray menu item for Lens and update:
// FROM:
{ label: 'Spectre Lens', enabled: false, toolTip: 'Coming soon' }

// TO:
{
  label: 'Spectre Lens  ⌘⇧L',
  click: () => triggerLens(),
}
```

---

## STEP 3 — desktop/lens/lens-main.js

This is the core orchestration. Every step of the Lens flow is here.

```javascript
'use strict';

const { BrowserWindow, screen, ipcMain, systemPreferences } = require('electron');
const path    = require('path');
const { captureScreen }       = require('./screenshot');
const { extractTokenContext } = require('./vision');
const { startRecording, stopRecording } = require('./audio');
const { transcribeAudio }     = require('./whisper');
const { synthesizeSpeech }    = require('./elevenlabs');
const Store   = require('electron-store');
const axios   = require('axios');

const store   = new Store();
let overlayWin = null;
let isListening = false;
let isActive    = false;

// ── Init: create overlay window (hidden) ────────────────────────
async function initLens() {
  await requestPermissions();
  createOverlayWindow();
  setupIPC();
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    width:           400,
    height:          600,
    frame:           false,
    transparent:     true,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    resizable:       false,
    movable:         true,
    show:            false,
    hasShadow:       true,
    vibrancy:        'under-window',   // Mac frosted glass effect
    visualEffectState: 'active',
    webPreferences: {
      preload:         path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));

  // Dismiss on Escape
  overlayWin.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') dismissLens();
  });
}

// ── Main trigger ─────────────────────────────────────────────────
async function triggerLens() {
  if (!overlayWin) return;

  // If already active — dismiss
  if (isActive) {
    dismissLens();
    return;
  }

  isActive = true;

  // Position overlay: bottom-right of active display, 24px margin
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const W = 400, H = 580;

  overlayWin.setBounds({
    x: Math.round(x + width  - W - 24),
    y: Math.round(y + height - H - 24),
    width: W,
    height: H,
  });

  overlayWin.showInactive();   // show without stealing focus
  setState('idle');

  // Short pause then auto-start listening
  await sleep(300);
  await startListeningMode();
}

async function startListeningMode() {
  isListening = true;
  setState('listening');
  startRecording();

  // Auto-stop after 6 seconds of silence (user can also tap hotkey again)
  setTimeout(() => {
    if (isListening) processLens('');
  }, 6000);
}

// ── Core pipeline ─────────────────────────────────────────────────
async function processLens(forcedQuery = null) {
  if (!isListening && forcedQuery === null) return;
  isListening = false;

  setState('scanning');

  try {
    // 1. Stop mic, transcribe
    let query = forcedQuery;
    if (query === null) {
      const audioBuffer = await stopRecording();
      setState('processing');
      query = audioBuffer ? await transcribeAudio(audioBuffer) : '';
    }

    overlayWin?.webContents.send('lens:query', { query });

    // 2. Capture screen (overlay hides itself first)
    const screenshot = await captureScreen(overlayWin);

    // 3. Vision: extract entity from screenshot
    setState('analyzing');
    const context = await extractTokenContext(screenshot);
    overlayWin?.webContents.send('lens:context', { context });

    // If no entity found on screen
    if (!context.symbol && !context.name) {
      setState('no-entity');
      return;
    }

    // 4. Route to Spectre intelligence backend
    const result = await querySpectreIntelligence(context, query);

    // 5. Send result to overlay UI
    overlayWin?.webContents.send('lens:result', { result, context, query });
    setState('result');

    // 6. Optional voice response
    const voiceEnabled = store.get('lens.voiceEnabled', true);
    if (voiceEnabled && result.verdict) {
      const audio = await synthesizeSpeech(result.verdictSpoken || result.verdict);
      overlayWin?.webContents.send('lens:audio', { audio });
    }

  } catch (err) {
    console.error('[Lens] Pipeline error:', err);
    setState('error');
  }
}

// ── Spectre API call ──────────────────────────────────────────────
async function querySpectreIntelligence(context, query) {
  const apiBase = process.env.SPECTRE_API_URL || 'http://localhost:3001';
  const apiKey  = process.env.SPECTRE_API_KEY  || store.get('apiKey');

  try {
    const response = await axios.post(
      `${apiBase}/api/v1/lens/analyze`,
      {
        symbol:   context.symbol,
        name:     context.name,
        address:  context.address  || null,
        chain:    context.chain    || null,
        price:    context.price    || null,
        platform: context.platform || null,
        query:    query || 'Give me a quick intelligence summary',
        mode:     'lens',   // compact response format
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
          'X-Client':      'spectre-lens/1.0',
        },
        timeout: 15000,
      }
    );
    return response.data;
  } catch (err) {
    // Fallback: use Quick Intel endpoint if lens endpoint not yet built
    const response = await axios.post(
      `${apiBase}/api/v1/search/quick`,
      { query: `${context.symbol || context.name} ${query}`, mode: 'lens' },
      { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 }
    );
    return response.data;
  }
}

// ── Dismiss ──────────────────────────────────────────────────────
function dismissLens() {
  isActive    = false;
  isListening = false;
  stopRecording().catch(() => {});
  overlayWin?.webContents.send('lens:reset');

  // Animate out then hide
  setTimeout(() => overlayWin?.hide(), 280);
}

// ── IPC setup ────────────────────────────────────────────────────
function setupIPC() {
  // User tapped mic button or space — stop listening and process
  ipcMain.on('lens:stop-listening', () => {
    if (isListening) processLens(null);
  });

  // User dismissed via close button
  ipcMain.on('lens:dismiss',   () => dismissLens());

  // User typed a query manually (no voice)
  ipcMain.on('lens:text-query', (_, { query }) => {
    isListening = false;
    stopRecording().catch(() => {});
    processLens(query);
  });

  // Toggle voice response
  ipcMain.on('lens:toggle-voice', (_, { enabled }) => {
    store.set('lens.voiceEnabled', enabled);
  });
}

// ── Helpers ──────────────────────────────────────────────────────
function setState(state) {
  overlayWin?.webContents.send('lens:state', { state });
}

async function requestPermissions() {
  if (process.platform !== 'darwin') return;

  const mic = systemPreferences.getMediaAccessStatus('microphone');
  if (mic !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }
  // Screen recording — triggered automatically on first capture attempt
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { initLens, triggerLens };
```

---

## STEP 4 — desktop/lens/screenshot.js

```javascript
'use strict';

const screenshot = require('screenshot-desktop');
const { screen } = require('electron');

async function captureScreen(overlayWin) {
  // Hide overlay before capture so it doesn't appear in the screenshot
  const wasVisible = overlayWin?.isVisible();
  if (wasVisible) {
    overlayWin.hide();
    await sleep(150); // wait for OS to composite
  }

  try {
    const cursor   = screen.getCursorScreenPoint();
    const display  = screen.getDisplayNearestPoint(cursor);
    const displays = await screenshot.listDisplays();

    // Match Electron display to screenshot-desktop index
    let idx = 0;
    displays.forEach((d, i) => {
      if (d.id === display.id) idx = i;
    });

    const buffer = await screenshot({ screen: idx, format: 'png' });
    return buffer.toString('base64');

  } finally {
    if (wasVisible) overlayWin?.showInactive();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
module.exports = { captureScreen };
```

---

## STEP 5 — desktop/lens/vision.js

```javascript
'use strict';

const axios = require('axios');

const SYSTEM_PROMPT = `You are a financial screen analyzer for Spectre AI.
Analyze the screenshot and extract any visible crypto token or stock being viewed.

Return ONLY valid JSON, no prose, no markdown:
{
  "symbol":    "TOKEN ticker if visible, null if not",
  "name":      "Project name if visible, null if not",
  "address":   "Contract address if visible, null if not",
  "chain":     "blockchain name if detectable: ethereum/solana/bsc/etc, null if not",
  "price":     "current price as number if visible, null if not",
  "change24h": "24h price change as number if visible, null if not",
  "platform":  "website/app being viewed: dexscreener/tradingview/binance/coinbase/twitter/other",
  "assetType": "crypto or stock",
  "confidence":"high/medium/low — how confident you are in the extraction"
}

Rules:
- If multiple tokens are visible, return the most prominent one (largest, centered, in focus)
- For stocks: symbol is the ticker (AAPL, NVDA etc)
- If nothing financial is on screen: return { "symbol": null, "name": null, "platform": "other", "confidence": "low" }
- Never fabricate data. If you cannot see it clearly, return null for that field.`;

async function extractTokenContext(base64Image) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text',      text: SYSTEM_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'low' } },
          ],
        },
      ],
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      timeout: 10000,
    }
  );

  const raw = response.data.choices[0].message.content.trim();

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { symbol: null, name: null, platform: 'unknown', confidence: 'low' };
  }
}

module.exports = { extractTokenContext };
```

---

## STEP 6 — desktop/lens/overlay.html

The floating glass card. Five states: idle, listening, scanning, analyzing, result, error.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spectre Lens</title>
  <link rel="stylesheet" href="overlay.css">
</head>
<body>

  <div class="lens-card" id="lensCard">

    <!-- Header -->
    <div class="lens-header">
      <div class="lens-brand">
        <div class="lens-dot"></div>
        <span class="lens-name">SPECTRE LENS</span>
      </div>
      <button class="lens-close" id="btnClose">✕</button>
    </div>

    <!-- STATE: idle — just activated, about to listen -->
    <div class="state-panel" id="stateIdle">
      <div class="mic-ring">
        <div class="mic-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="2" width="6" height="13" rx="3" fill="rgba(139,92,246,0.9)"/>
            <path d="M5 10a7 7 0 0014 0" stroke="rgba(139,92,246,0.7)" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="12" y1="19" x2="12" y2="22" stroke="rgba(139,92,246,0.7)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
      <p class="state-label">Listening...</p>
      <p class="state-hint">Ask anything about what's on screen</p>
      <div class="waveform" id="waveform">
        <span></span><span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <!-- Manual text input fallback -->
      <div class="text-input-row">
        <input type="text" class="lens-input" id="textQuery" placeholder="Or type your question...">
        <button class="lens-send" id="btnSend">→</button>
      </div>
    </div>

    <!-- STATE: scanning / analyzing (shared loading state) -->
    <div class="state-panel hidden" id="stateLoading">
      <div class="loading-orb">
        <div class="orb-ring orb-ring-1"></div>
        <div class="orb-ring orb-ring-2"></div>
        <div class="orb-core"></div>
      </div>
      <p class="state-label" id="loadingLabel">Scanning screen...</p>
      <p class="state-hint" id="loadingHint">Reading what you're looking at</p>

      <!-- Context detected -->
      <div class="detected-entity hidden" id="detectedEntity">
        <span class="entity-ticker" id="entityTicker"></span>
        <span class="entity-platform" id="entityPlatform"></span>
      </div>
    </div>

    <!-- STATE: result -->
    <div class="state-panel hidden" id="stateResult">

      <!-- Token identity -->
      <div class="result-identity">
        <div class="result-token-info">
          <span class="result-symbol" id="resultSymbol"></span>
          <span class="result-name"   id="resultName"></span>
        </div>
        <div class="result-price-block">
          <span class="result-price"  id="resultPrice"></span>
          <span class="result-change" id="resultChange"></span>
        </div>
      </div>

      <!-- Signal bars -->
      <div class="signal-row">
        <div class="signal-item">
          <span class="signal-label">SENTIMENT</span>
          <div class="signal-bar-track">
            <div class="signal-bar-fill" id="barSentiment"></div>
          </div>
          <span class="signal-value" id="valSentiment"></span>
        </div>
        <div class="signal-item">
          <span class="signal-label">ON-CHAIN</span>
          <div class="signal-bar-track">
            <div class="signal-bar-fill" id="barOnchain"></div>
          </div>
          <span class="signal-value" id="valOnchain"></span>
        </div>
        <div class="signal-item">
          <span class="signal-label">MOMENTUM</span>
          <div class="signal-bar-track">
            <div class="signal-bar-fill" id="barMomentum"></div>
          </div>
          <span class="signal-value" id="valMomentum"></span>
        </div>
      </div>

      <!-- Divider -->
      <div class="result-divider"></div>

      <!-- Verdict -->
      <div class="verdict-block">
        <div class="verdict-chip" id="verdictChip"></div>
        <p class="verdict-text" id="verdictText"></p>
      </div>

      <!-- Key insight -->
      <div class="insight-block" id="insightBlock">
        <span class="insight-label">KEY INSIGHT</span>
        <p class="insight-text" id="insightText"></p>
      </div>

      <!-- Actions -->
      <div class="result-actions">
        <button class="action-btn action-primary" id="btnDeepDive">Deep Thesis →</button>
        <button class="action-btn action-secondary" id="btnVoice" title="Read aloud">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="rgba(255,255,255,0.6)"/>
            <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- STATE: error -->
    <div class="state-panel hidden" id="stateError">
      <p class="state-label">Could not analyze</p>
      <p class="state-hint" id="errorDetail">No token detected on screen</p>
      <button class="action-btn action-secondary" id="btnRetry">Try again</button>
    </div>

  </div><!-- /lens-card -->

  <script src="overlay.js"></script>
</body>
</html>
```

---

## STEP 7 — desktop/lens/overlay.css

Full Spectre design system applied to the overlay. Glassmorphism card, floating above everything.

```css
/* ── Reset ──────────────────────────────────────────────────── */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  width: 400px;
  height: 580px;
  background: transparent;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── Card — the glass surface ───────────────────────────────── */
.lens-card {
  width: 100%;
  height: 100%;
  background: linear-gradient(168deg,
    rgba(7,6,10,0.97)  0%,
    rgba(9,8,13,0.97)  35%,
    rgba(4,3,6,0.97)   70%,
    rgba(2,1,3,0.97)   100%
  );
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 20px;
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.07),
    inset 0 1px 0  rgba(255,255,255,0.12),
    0 8px 32px rgba(0,0,0,0.6),
    0 2px 8px  rgba(0,0,0,0.4),
    0 0 0 1px  rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 16px;
  animation: cardIn 0.28s cubic-bezier(0.34,1.4,0.64,1) both;
  transform-origin: bottom right;
}

.lens-card.dismissing {
  animation: cardOut 0.24s ease forwards;
}

@keyframes cardIn {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   }
}

@keyframes cardOut {
  from { opacity: 1; transform: scale(1)    translateY(0);   }
  to   { opacity: 0; transform: scale(0.94) translateY(6px); }
}

/* ── Header ─────────────────────────────────────────────────── */
.lens-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.lens-brand {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lens-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8B5CF6;
  box-shadow: 0 0 6px rgba(139,92,246,0.8);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

.lens-name {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255,255,255,0.32);
  letter-spacing: 2px;
}

.lens-close {
  width: 24px;
  height: 24px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  color: rgba(255,255,255,0.4);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.lens-close:hover {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.8);
}

/* ── State panels ───────────────────────────────────────────── */
.state-panel { display: flex; flex-direction: column; align-items: center; gap: 12px; flex: 1; }
.state-panel.hidden { display: none; }

.state-label {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255,255,255,0.85);
}

.state-hint {
  font-size: 12px;
  color: rgba(255,255,255,0.32);
  text-align: center;
  line-height: 1.5;
}

/* ── Mic / listening state ──────────────────────────────────── */
.mic-ring {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1px solid rgba(139,92,246,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(139,92,246,0.08);
  box-shadow: 0 0 24px rgba(139,92,246,0.15);
  animation: breathe 2s ease-in-out infinite;
  margin-top: 24px;
}

@keyframes breathe {
  0%,100% { box-shadow: 0 0 24px rgba(139,92,246,0.15); }
  50%      { box-shadow: 0 0 40px rgba(139,92,246,0.30); }
}

/* Waveform bars */
.waveform {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 32px;
}

.waveform span {
  width: 3px;
  background: rgba(139,92,246,0.6);
  border-radius: 2px;
  height: 4px;
  animation: wave 1.2s ease-in-out infinite;
}

.waveform span:nth-child(1)  { animation-delay: 0.0s; }
.waveform span:nth-child(2)  { animation-delay: 0.1s; }
.waveform span:nth-child(3)  { animation-delay: 0.2s; }
.waveform span:nth-child(4)  { animation-delay: 0.3s; }
.waveform span:nth-child(5)  { animation-delay: 0.4s; }
.waveform span:nth-child(6)  { animation-delay: 0.3s; }
.waveform span:nth-child(7)  { animation-delay: 0.2s; }
.waveform span:nth-child(8)  { animation-delay: 0.1s; }
.waveform span:nth-child(9)  { animation-delay: 0.0s; }
.waveform span:nth-child(10) { animation-delay: 0.2s; }

@keyframes wave {
  0%,100% { height: 4px;  }
  50%      { height: 24px; }
}

/* Text input fallback */
.text-input-row {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
}

.lens-input {
  flex: 1;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: rgba(255,255,255,0.8);
  outline: none;
  font-family: inherit;
}
.lens-input::placeholder { color: rgba(255,255,255,0.2); }
.lens-input:focus { border-color: rgba(139,92,246,0.4); }

.lens-send {
  width: 36px;
  background: rgba(139,92,246,0.15);
  border: 1px solid rgba(139,92,246,0.3);
  border-radius: 8px;
  color: rgba(139,92,246,0.9);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s;
}
.lens-send:hover { background: rgba(139,92,246,0.25); }

/* ── Loading state ──────────────────────────────────────────── */
.loading-orb {
  position: relative;
  width: 64px;
  height: 64px;
  margin-top: 24px;
}

.orb-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid transparent;
}

.orb-ring-1 {
  border-top-color:   rgba(139,92,246,0.6);
  border-right-color: rgba(139,92,246,0.1);
  animation: spin 1.4s linear infinite;
}

.orb-ring-2 {
  inset: 8px;
  border-bottom-color: rgba(6,182,212,0.5);
  border-left-color:   rgba(6,182,212,0.1);
  animation: spin 1.0s linear infinite reverse;
}

.orb-core {
  position: absolute;
  inset: 20px;
  border-radius: 50%;
  background: rgba(139,92,246,0.15);
  border: 1px solid rgba(139,92,246,0.3);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.detected-entity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(139,92,246,0.08);
  border: 1px solid rgba(139,92,246,0.2);
  border-radius: 20px;
}

.detected-entity.hidden { display: none; }

.entity-ticker {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 700;
  color: #8B5CF6;
}

.entity-platform {
  font-size: 11px;
  color: rgba(255,255,255,0.32);
}

/* ── Result state ───────────────────────────────────────────── */
.result-identity {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  width: 100%;
  padding-top: 4px;
}

.result-token-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-symbol {
  font-family: 'JetBrains Mono', monospace;
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.5px;
}

.result-name {
  font-size: 11px;
  color: rgba(255,255,255,0.32);
}

.result-price-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.result-price {
  font-family: 'JetBrains Mono', monospace;
  font-size: 17px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
}

.result-change {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 500;
}
.result-change.positive { color: #10B981; }
.result-change.negative { color: #EF4444; }

/* ── Signal bars ────────────────────────────────────────────── */
.signal-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.signal-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.signal-label {
  font-size: 9px;
  font-weight: 600;
  color: rgba(255,255,255,0.28);
  letter-spacing: 1.5px;
  width: 72px;
  flex-shrink: 0;
}

.signal-bar-track {
  flex: 1;
  height: 3px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
}

.signal-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #8B5CF6, #06B6D4);
  transition: width 0.8s cubic-bezier(0.4,0,0.2,1);
  width: 0%;
}

.signal-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.48);
  width: 28px;
  text-align: right;
}

/* ── Divider ─────────────────────────────────────────────────── */
.result-divider {
  width: 100%;
  height: 1px;
  background: rgba(255,255,255,0.05);
}

/* ── Verdict ─────────────────────────────────────────────────── */
.verdict-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.verdict-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  align-self: flex-start;
}

.verdict-chip.bullish  { background: rgba(16,185,129,0.12); color: #10B981; border: 1px solid rgba(16,185,129,0.25); }
.verdict-chip.bearish  { background: rgba(239,68,68,0.12);  color: #EF4444; border: 1px solid rgba(239,68,68,0.25); }
.verdict-chip.neutral  { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.48); border: 1px solid rgba(255,255,255,0.1); }

.verdict-text {
  font-size: 13px;
  color: rgba(255,255,255,0.72);
  line-height: 1.5;
}

/* ── Key Insight ────────────────────────────────────────────── */
.insight-block {
  background: rgba(139,92,246,0.06);
  border: 1px solid rgba(139,92,246,0.15);
  border-radius: 10px;
  padding: 10px 12px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.insight-label {
  font-size: 9px;
  font-weight: 600;
  color: rgba(139,92,246,0.6);
  letter-spacing: 1.5px;
}

.insight-text {
  font-size: 12px;
  color: rgba(255,255,255,0.6);
  line-height: 1.5;
}

/* ── Actions ─────────────────────────────────────────────────── */
.result-actions {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: auto;
}

.action-btn {
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.action-primary {
  flex: 1;
  padding: 10px;
  background: rgba(139,92,246,0.15);
  border: 1px solid rgba(139,92,246,0.3);
  color: #8B5CF6;
}
.action-primary:hover {
  background: rgba(139,92,246,0.25);
  transform: translateY(-1px);
}

.action-secondary {
  padding: 10px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.48);
  display: flex;
  align-items: center;
  justify-content: center;
}
.action-secondary:hover {
  background: rgba(255,255,255,0.07);
  color: rgba(255,255,255,0.72);
}
```

---

## STEP 8 — desktop/lens/overlay.js (renderer)

```javascript
'use strict';

// IPC bridge via preload
const ipc = window.spectre;

// ── State machine ─────────────────────────────────────────────
const PANELS = {
  idle:      document.getElementById('stateIdle'),
  listening: document.getElementById('stateIdle'),   // same panel
  scanning:  document.getElementById('stateLoading'),
  processing:document.getElementById('stateLoading'),
  analyzing: document.getElementById('stateLoading'),
  result:    document.getElementById('stateResult'),
  'no-entity': document.getElementById('stateError'),
  error:     document.getElementById('stateError'),
};

const LOADING_LABELS = {
  scanning:   { label: 'Reading your screen...', hint: 'Identifying what you\'re looking at' },
  processing: { label: 'Transcribing...',         hint: 'Converting your voice to text' },
  analyzing:  { label: 'Analyzing...',            hint: 'Running Spectre intelligence stack' },
};

function setState(state) {
  // Hide all panels
  document.querySelectorAll('.state-panel').forEach(p => p.classList.add('hidden'));

  const panel = PANELS[state];
  if (panel) panel.classList.remove('hidden');

  // Update loading labels
  if (LOADING_LABELS[state]) {
    document.getElementById('loadingLabel').textContent = LOADING_LABELS[state].label;
    document.getElementById('loadingHint').textContent  = LOADING_LABELS[state].hint;
  }

  // Error states
  if (state === 'no-entity') {
    document.getElementById('errorDetail').textContent = 'No token or stock detected on screen. Try navigating to a token page first.';
  }
}

// ── Result rendering ──────────────────────────────────────────
function renderResult(result, context) {
  // Token identity
  document.getElementById('resultSymbol').textContent = context.symbol || result.symbol || '???';
  document.getElementById('resultName').textContent   = context.name   || result.name   || '';

  // Price
  const price = context.price || result.price;
  document.getElementById('resultPrice').textContent = price
    ? `$${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
    : '';

  const change = context.change24h || result.change24h;
  const changeEl = document.getElementById('resultChange');
  if (change !== null && change !== undefined) {
    const isPos = Number(change) >= 0;
    changeEl.textContent = `${isPos ? '+' : ''}${Number(change).toFixed(2)}%`;
    changeEl.className   = `result-change ${isPos ? 'positive' : 'negative'}`;
  }

  // Signal bars (0-100 scores expected from API)
  setSignalBar('Sentiment', result.signals?.sentiment || 50);
  setSignalBar('Onchain',   result.signals?.onchain   || 50);
  setSignalBar('Momentum',  result.signals?.momentum  || 50);

  // Verdict chip
  const chip      = document.getElementById('verdictChip');
  const verdict   = (result.verdict || 'NEUTRAL').toUpperCase();
  chip.textContent = verdict;
  chip.className   = `verdict-chip ${
    verdict.includes('BULL') ? 'bullish' :
    verdict.includes('BEAR') ? 'bearish' : 'neutral'
  }`;

  // Verdict text
  document.getElementById('verdictText').textContent = result.verdictText || result.summary || '';

  // Key insight
  if (result.keyInsight) {
    document.getElementById('insightText').textContent = result.keyInsight;
    document.getElementById('insightBlock').classList.remove('hidden');
  } else {
    document.getElementById('insightBlock').classList.add('hidden');
  }
}

function setSignalBar(name, score) {
  const bar = document.getElementById(`bar${name}`);
  const val = document.getElementById(`val${name}`);
  if (bar) setTimeout(() => { bar.style.width = `${Math.min(100, score)}%`; }, 100);
  if (val) val.textContent = Math.round(score);
}

// ── IPC listeners ─────────────────────────────────────────────
ipc.on('lens:state',   ({ state }) => setState(state));
ipc.on('lens:reset',   () => {
  document.getElementById('lensCard').classList.add('dismissing');
  setState('idle');
});

ipc.on('lens:context', ({ context }) => {
  if (context.symbol || context.name) {
    const el = document.getElementById('detectedEntity');
    document.getElementById('entityTicker').textContent   = context.symbol || context.name;
    document.getElementById('entityPlatform').textContent = context.platform || '';
    el.classList.remove('hidden');
  }
});

ipc.on('lens:result', ({ result, context }) => {
  renderResult(result, context);
});

// ── Button wiring ─────────────────────────────────────────────
document.getElementById('btnClose').addEventListener('click', () => {
  ipc.send?.('lens:dismiss') || window.close();
});

document.getElementById('btnRetry')?.addEventListener('click', () => {
  setState('idle');
});

document.getElementById('btnDeepDive')?.addEventListener('click', () => {
  // Open full Spectre app focused on this token
  window.spectre?.send?.('lens:open-deep-dive', {
    symbol: document.getElementById('resultSymbol').textContent,
  });
});

document.getElementById('btnSend')?.addEventListener('click', () => {
  const query = document.getElementById('textQuery').value.trim();
  if (query) {
    ipc.send?.('lens:text-query', { query });
    document.getElementById('textQuery').value = '';
  }
});

document.getElementById('textQuery')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnSend').click();
});
```

---

## STEP 9 — ADD LENS ENDPOINT TO SPECTRE SERVER

Add this lightweight endpoint to the existing server. Lens sends compact requests, expects compact responses.

```javascript
// server/routes/lens.js
// Add to existing Express app: app.use('/api/v1/lens', lensRouter)

const express = require('express');
const router  = express.Router();

router.post('/analyze', async (req, res) => {
  const { symbol, name, address, chain, query, mode } = req.body;

  try {
    // Route to Quick Intel for lens mode (fast, compact)
    const result = await runQuickIntel({
      ticker:  symbol || name,
      address,
      chain,
      query:   query || 'Give me a quick intelligence summary for traders',
      mode:    'lens',  // signals compact response format
    });

    // Shape the response for Lens
    res.json({
      symbol:      result.symbol,
      name:        result.name,
      price:       result.price,
      change24h:   result.change24h,
      signals: {
        sentiment: result.sentimentScore   || 50,
        onchain:   result.onchainScore     || 50,
        momentum:  result.momentumScore    || 50,
      },
      verdict:      result.verdict,         // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
      verdictText:  result.verdictSummary,  // 2-3 sentences
      verdictSpoken: result.verdictBrief,   // 1 sentence for ElevenLabs
      keyInsight:   result.keyInsight,      // single most important signal
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

---

## STEP 10 — INSTALL NEW DEPENDENCIES

```bash
cd desktop
npm install screenshot-desktop node-record-lpcm16 form-data axios electron-store

# screenshot-desktop — cross-platform screen capture
# node-record-lpcm16 — microphone recording
# form-data — for Whisper API multipart upload
# axios — HTTP client
# electron-store — persistent settings
```

---

## STEP 11 — VERIFY THESE ALL WORK

- [ ] Cmd+Shift+L opens overlay from any app on Mac
- [ ] Overlay appears bottom-right, does not steal focus
- [ ] Mic waveform animates while listening
- [ ] Screen capture works (may need to grant Screen Recording in System Preferences)
- [ ] GPT-4o Vision correctly identifies the token on Dexscreener, TradingView, Binance
- [ ] Result card shows with correct symbol, price, signals, verdict
- [ ] "Deep Thesis" button opens Spectre app focused on that token
- [ ] Escape key dismisses the overlay
- [ ] Second Cmd+Shift+L press dismisses if already open
- [ ] Text input works as fallback when no voice is used

---

## MAC PERMISSIONS NOTE

On first Cmd+Shift+L press, macOS will show two permission dialogs:
- Screen Recording access
- Microphone access

Both must be granted. Add this to the README so Sunny knows to expect it.

---

*Spectre Lens — Build v1.0*
*Sits inside the Spectre Desktop App*
*February 2026*
