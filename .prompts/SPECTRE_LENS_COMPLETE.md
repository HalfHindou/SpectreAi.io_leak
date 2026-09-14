# SPECTRE LENS — COMPLETE NUCLEAR UPGRADE
# Single source of truth. Paste this entire file into Claude Code.
# Contains every fix, design rule, real data connection, viral features,
# TradingView MCP, Lens page redesign, and CoinGecko routing.
#
# BEFORE ANYTHING: Read SPECTRE_DESIGN_LAW.md fully first.
# Write checkpoint to /tmp/lens-checkpoint.md if context fills.

---

## WHAT IS BROKEN RIGHT NOW

- Lens not appearing above the camera/notch (wrong alwaysOnTop level)
- Design is generic AI aesthetic — violates every Spectre design rule
- Data is mocked — not connected to real Spectre intelligence backend
- Uses OpenAI — must use Anthropic Claude + ElevenLabs instead
- Lens page design is dry and cuts into top of screen
- History rows have no click routing
- Missing viral features: passive detection, share to X, price alerts
- TradingView MCP not implemented

Fix everything in this session in order. Do not skip any fix.

---

## FIX 0 — REMOVE OPENAI, USE ANTHROPIC + ELEVENLABS

Anthropic API key is set. ElevenLabs key is set. OpenAI is NOT used anywhere.

Run first:
```bash
grep -rn "openai\|OPENAI\|gpt-4" desktop/lens/ --include="*.js"
cd desktop && npm uninstall openai 2>/dev/null; npm install @anthropic-ai/sdk axios
```

### Replace vision.js entirely:

```javascript
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a financial screen analyzer for Spectre AI.
Analyze this screenshot and extract any visible crypto token or stock being viewed.

Return ONLY valid JSON, no prose, no markdown, no code fences:
{
  "symbol":    "TOKEN ticker if visible, null if not",
  "name":      "Project name if visible, null if not",
  "address":   "Contract address if visible, null if not",
  "chain":     "blockchain if detectable: ethereum/solana/bsc/base/arbitrum, null if not",
  "price":     price as number if visible or null,
  "change24h": 24h change as number if visible or null,
  "platform":  "dexscreener/tradingview/binance/coinbase/coinmarketcap/coingecko/twitter/other",
  "assetType": "crypto or stock",
  "isOnTradingView": true or false,
  "currentSymbol": "chart ticker if on TradingView, null if not",
  "timeframe": "chart timeframe if on TradingView: 1m/5m/15m/1H/4H/1D/1W, null if not",
  "confidence": "high/medium/low"
}

Rules:
- If multiple tokens visible, return the most prominent one (largest, centered, in focus)
- For stocks: symbol is the ticker (AAPL, NVDA etc)
- If nothing financial is on screen: return { "symbol": null, "name": null, "platform": "other", "confidence": "low" }
- Never fabricate data. If unclear, return null for that field.`;

async function extractTokenContext(base64Image) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: base64Image }
        },
        { type: 'text', text: SYSTEM_PROMPT }
      ]
    }]
  });

  const raw     = response.content[0].text.trim();
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { symbol: null, name: null, platform: 'unknown', confidence: 'low' };
  }
}

module.exports = { extractTokenContext };
```

### Replace whisper.js with ElevenLabs STT:

```javascript
'use strict';

const axios    = require('axios');
const FormData = require('form-data');

async function transcribeAudio(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) return '';

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const form = new FormData();
  form.append('audio', audioBuffer, { filename: 'recording.wav', contentType: 'audio/wav' });
  form.append('model_id', 'scribe_v1');

  const response = await axios.post(
    'https://api.elevenlabs.io/v1/speech-to-text',
    form,
    {
      headers: { ...form.getHeaders(), 'xi-api-key': apiKey },
      timeout: 15000,
    }
  );

  return response.data.text?.trim() || '';
}

module.exports = { transcribeAudio };
```

### Replace tradingview-mcp.js command parser with Claude:

```javascript
// In parseTradingViewCommand(), replace OpenAI call with:
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function parseTradingViewCommand(transcript) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Parse this TradingView voice command into a JSON action object.
Command: "${transcript}"

Return ONLY valid JSON:
{
  "action": "drawLine|addIndicator|setAlert|drawFib|mondayOpen|weeklyOpen|vwap|ema|sma",
  "params": {
    "type": "support|resistance|mondayOpen|weeklyOpen",
    "price": number or null,
    "indicator": "RSI|MACD|BB|EMA|SMA|VWAP" or null,
    "period": number or null,
    "from": number or null,
    "to": number or null
  }
}`
    }]
  });

  const raw = response.content[0].text.trim().replace(/```json|```/g,'').trim();
  return JSON.parse(raw);
}
```

---

## FIX 1 — POSITION: APPEAR ABOVE THE CAMERA / NOTCH

The bar must float at the very top of the screen, centered, just below the Mac menu bar.
This places it directly below the camera notch — Dynamic Island style.

In desktop/lens/lens-main.js, replace activateLens() position block:

```javascript
async function activateLens() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, width } = display.bounds;
  const W = 560;

  overlayWin.setBounds({
    x: Math.round(x + (width / 2) - (W / 2)),
    y: display.bounds.y + 28,   // 28px = Mac menu bar height with breathing room
    width: W,
    height: 52,
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver'); // screen-saver level clears everything
  overlayWin.showInactive();
  overlayWin.webContents.send('lens:state', { state: 'welcome' });
}
```

Add these to createOverlayWindow() options and after creation:

```javascript
// Window options:
{
  width: 560,
  height: 52,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: true,
  hasShadow: true,
  titleBarStyle: 'hidden',
  webPreferences: {
    preload: path.join(__dirname, '..', 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
  }
}

// After creation:
overlayWin.setAlwaysOnTop(true, 'screen-saver');
overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
overlayWin.setWindowButtonVisibility(false);
overlayWin.setFullScreenable(false);
```

Add resize IPC handler in setupIPC():
```javascript
ipcMain.on('lens:resize', (_, { height }) => {
  const [w] = overlayWin.getSize();
  overlayWin.setSize(w, height, true); // animated
});
```

---

## FIX 2 — COMPLETE DESIGN OVERHAUL

Read SPECTRE_DESIGN_LAW.md fully before writing a single line of CSS.
The current design is a generic AI aesthetic — wrong in every way.

Replace desktop/lens/overlay.html ENTIRELY:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="overlay.css">
</head>
<body>
<div class="lens" id="lens">

  <!-- ═══════ COLLAPSED BAR ═══════ -->
  <div class="bar" id="bar">
    <div class="bar-left">
      <div class="pulse-dot" id="pulseDot"></div>
      <span class="bar-brand">SPECTRE LENS</span>
    </div>

    <!-- Welcome (first ever activation) -->
    <div class="bar-center" id="centerWelcome">
      <span class="bar-welcome">Hi — I watch your screen and surface intelligence</span>
    </div>

    <!-- Watching (passive, no entity yet) -->
    <div class="bar-center hidden" id="centerWatching">
      <span class="bar-watching">Watching your screen...</span>
    </div>

    <!-- Entity detected -->
    <div class="bar-center hidden" id="centerEntity">
      <span class="bar-ticker"  id="barTicker"></span>
      <span class="bar-sep">·</span>
      <span class="bar-price"   id="barPrice"></span>
      <span class="bar-change"  id="barChange"></span>
      <div  class="bar-verdict hidden" id="barVerdict"></div>
    </div>

    <div class="bar-right">
      <div class="bar-action hidden" id="barAction">Analyze →</div>
      <button class="bar-btn" id="btnHistory" title="History">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </button>
      <button class="bar-btn" id="btnClose">✕</button>
    </div>
  </div>

  <!-- ═══════ EXPANDED PANEL ═══════ -->
  <div class="panel" id="panel">

    <!-- LISTENING -->
    <div class="pstate" id="stateListening">
      <div class="viz-wrap">
        <canvas id="vizCanvas" width="120" height="120"></canvas>
        <div class="viz-core">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="2" width="6" height="13" rx="3" fill="rgba(139,92,246,0.85)"/>
            <path d="M5 10a7 7 0 0014 0" stroke="rgba(139,92,246,0.6)" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="12" y1="19" x2="12" y2="22" stroke="rgba(139,92,246,0.4)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
      <p class="state-title">Listening</p>
      <p class="state-sub">Speak your question or type below</p>
      <div class="input-row">
        <input class="lens-input" id="textQuery" placeholder="Ask about this asset..." autocomplete="off" spellcheck="false">
        <button class="send-btn" id="btnSend">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- SCANNING / ANALYZING -->
    <div class="pstate hidden" id="stateLoading">
      <div class="scan-rings">
        <div class="ring r1"></div>
        <div class="ring r2"></div>
        <div class="ring-core"></div>
      </div>
      <p class="state-title" id="loadTitle">Scanning screen</p>
      <p class="state-sub"   id="loadSub">Reading what you're looking at</p>
      <div class="detected-badge hidden" id="detectedBadge">
        <div class="badge-dot"></div>
        <span id="detectedTicker"></span>
        <span class="badge-platform" id="detectedPlatform"></span>
      </div>
      <div class="skeleton-rows">
        <div class="skel skel-80"></div>
        <div class="skel skel-60"></div>
        <div class="skel skel-90"></div>
      </div>
    </div>

    <!-- RESULT -->
    <div class="pstate hidden" id="stateResult">
      <div class="result-header">
        <div class="result-id">
          <div class="result-symbol" id="rSymbol"></div>
          <div class="result-name"   id="rName"></div>
        </div>
        <div class="result-price-block">
          <div class="result-price"  id="rPrice"></div>
          <div class="result-change" id="rChange"></div>
        </div>
      </div>

      <!-- Market context strip -->
      <div class="context-strip">
        <div class="ctx-item">
          <span class="ctx-label">MCAP</span>
          <span class="ctx-value" id="ctxMcap">—</span>
        </div>
        <div class="ctx-div"></div>
        <div class="ctx-item">
          <span class="ctx-label">VOL 24H</span>
          <span class="ctx-value" id="ctxVol">—</span>
        </div>
        <div class="ctx-div"></div>
        <div class="ctx-item">
          <span class="ctx-label">RANK</span>
          <span class="ctx-value" id="ctxRank">—</span>
        </div>
        <div class="ctx-div"></div>
        <div class="ctx-item">
          <span class="ctx-label">F&G</span>
          <span class="ctx-value" id="ctxFng">—</span>
        </div>
      </div>

      <div class="result-sep"></div>

      <div class="signals">
        <div class="sig"><span class="sig-lbl">SENTIMENT</span><div class="sig-track"><div class="sig-fill" id="fSentiment"></div></div><span class="sig-val" id="vSentiment">—</span></div>
        <div class="sig"><span class="sig-lbl">ON-CHAIN</span><div class="sig-track"><div class="sig-fill" id="fOnchain"></div></div><span class="sig-val" id="vOnchain">—</span></div>
        <div class="sig"><span class="sig-lbl">MOMENTUM</span><div class="sig-track"><div class="sig-fill" id="fMomentum"></div></div><span class="sig-val" id="vMomentum">—</span></div>
        <div class="sig"><span class="sig-lbl">WHALE FLOW</span><div class="sig-track"><div class="sig-fill" id="fWhale"></div></div><span class="sig-val" id="vWhale">—</span></div>
      </div>

      <div class="result-sep"></div>

      <div class="verdict-block">
        <div class="verdict-chip" id="verdictChip"></div>
        <p class="verdict-text"   id="verdictText"></p>
      </div>

      <div class="insight-card" id="insightCard">
        <span class="insight-label">KEY INSIGHT</span>
        <p class="insight-text" id="insightText"></p>
      </div>

      <div class="actions">
        <button class="btn-primary" id="btnDeepDive">Full Thesis →</button>
        <button class="btn-ghost"   id="btnVoice"  title="Read aloud">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" opacity="0.6"/>
            <path d="M15.54 8.46a5 5 0 010 7.07" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="btn-ghost"   id="btnShare"  title="Share to X">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
        <button class="btn-ghost"   id="btnAlert"  title="Set price alert">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- TRADINGVIEW MODE -->
    <div class="pstate hidden" id="stateTradingView">
      <div class="tv-header">
        <div class="tv-logo">
          <svg width="14" height="14" viewBox="0 0 33 28" fill="none">
            <path d="M0 28L11 0l5.5 14L22 7l11 21H0z" fill="#2962FF"/>
          </svg>
          <span>TradingView Mode</span>
        </div>
        <span class="tv-status" id="tvStatus">Ready</span>
      </div>
      <div class="tv-suggestions">
        <div class="tv-chip" data-cmd="Draw support at current price">Support line</div>
        <div class="tv-chip" data-cmd="Draw resistance at current price">Resistance</div>
        <div class="tv-chip" data-cmd="Mark Monday open">Monday open</div>
        <div class="tv-chip" data-cmd="Add RSI indicator">RSI</div>
        <div class="tv-chip" data-cmd="Add VWAP">VWAP</div>
        <div class="tv-chip" data-cmd="Draw fibonacci">Fibonacci</div>
      </div>
      <div class="input-row">
        <input class="lens-input" id="tvQuery" placeholder="Draw RSI, mark Monday open, set alert at 70k..." autocomplete="off">
        <button class="send-btn" id="btnTvSend">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- HISTORY DRAWER -->
    <div class="pstate hidden" id="stateHistory">
      <div class="history-header">
        <span class="state-title" style="font-size:13px">Recent Detections</span>
        <button class="btn-ghost" id="btnClearHistory" style="font-size:10px;padding:4px 10px;width:auto;height:auto">Clear</button>
      </div>
      <div class="history-list" id="historyList"></div>
    </div>

    <!-- ERROR STATE -->
    <div class="pstate hidden" id="stateError">
      <div class="error-ring">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.7)" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p class="state-title" style="font-size:13px">Could not analyze</p>
      <p class="state-sub" id="errorMsg">Unknown error</p>
      <button class="btn-ghost" id="btnRetry" style="margin-top:8px;padding:6px 16px;width:auto;height:auto">Try again</button>
    </div>

  </div>
</div>
<script src="overlay.js"></script>
</body>
</html>
```

Replace desktop/lens/overlay.css ENTIRELY:

```css
/* ═══════════════════════════════════════════════════════════
   SPECTRE LENS OVERLAY — DESIGN LAW COMPLIANT
   Apple × Bloomberg Terminal. Zero generic AI aesthetics.
   Every value from SPECTRE_DESIGN_LAW.md
   ═══════════════════════════════════════════════════════════ */

*, *::before, *::after {
  margin: 0; padding: 0; box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

:root {
  --bg-surface:     #131316;
  --text-primary:   rgba(255,255,255,1);
  --text-secondary: rgba(255,255,255,0.72);
  --text-tertiary:  rgba(255,255,255,0.48);
  --text-muted:     rgba(255,255,255,0.32);
  --border-subtle:  rgba(255,255,255,0.04);
  --border-default: rgba(255,255,255,0.08);
  --border-strong:  rgba(255,255,255,0.14);
  --accent:         #8B5CF6;
  --accent-dim:     rgba(139,92,246,0.15);
  --bull:           #10B981;
  --bear:           #EF4444;
  --font-body:      'Inter', -apple-system, sans-serif;
  --font-mono:      'JetBrains Mono', 'SF Mono', monospace;
  --font-display:   'Space Grotesk', 'Inter', sans-serif;
  --ease-spring:    cubic-bezier(0.16, 1, 0.3, 1);
}

html, body {
  width: 560px;
  background: transparent;
  overflow: hidden;
  font-family: var(--font-body);
}

/* ── Lens container ────────────────────────────────────── */
.lens {
  width: 100%;
  animation: lensIn 0.28s var(--ease-spring) both;
}
@keyframes lensIn {
  from { opacity:0; transform: translateY(-10px) scale(0.97); }
  to   { opacity:1; transform: translateY(0)     scale(1);    }
}
.lens.out { animation: lensOut 0.2s ease forwards; }
@keyframes lensOut {
  to { opacity:0; transform: translateY(-8px) scale(0.97); }
}

/* ── Collapsed bar ─────────────────────────────────────── */
/*
   This is the most important surface.
   Welcome Widget glass gradient — exact values from SPECTRE_DESIGN_LAW.md.
   The inset top highlight is what makes glass look like glass.
*/
.bar {
  height: 52px;
  width: 100%;
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 10px;
  cursor: pointer;
  -webkit-app-region: drag;

  background: linear-gradient(168deg,
    rgba(7,6,10,0.97)  0%,
    rgba(9,8,13,0.97)  35%,
    rgba(4,3,6,0.97)   70%,
    rgba(2,1,3,0.97)   100%
  );
  backdrop-filter: blur(40px) saturate(200%);
  -webkit-backdrop-filter: blur(40px) saturate(200%);

  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 14px;
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.05),
    inset 0 1px 0  rgba(255,255,255,0.14),
    inset 0 -1px 0 rgba(255,255,255,0.02),
    0 8px 40px rgba(0,0,0,0.80),
    0 2px 10px rgba(0,0,0,0.60),
    0 0 0 0.5px rgba(0,0,0,0.9);

  transition: border-color 0.2s, box-shadow 0.2s;
}

.bar:hover {
  border-color: rgba(255,255,255,0.16);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.07),
    inset 0 1px 0  rgba(255,255,255,0.18),
    0 12px 48px rgba(0,0,0,0.90),
    0 2px 10px rgba(0,0,0,0.60);
}

.lens.expanded .bar {
  border-radius: 14px 14px 0 0;
  border-bottom-color: rgba(255,255,255,0.04);
}

.bar button, .bar input { -webkit-app-region: no-drag; }

/* Bar sections */
.bar-left  { display:flex; align-items:center; gap:7px; flex-shrink:0; }
.bar-center { flex:1; display:flex; align-items:center; justify-content:center; gap:7px; overflow:hidden; }
.bar-center.hidden { display:none; }
.bar-right { display:flex; align-items:center; gap:6px; flex-shrink:0; }

.pulse-dot {
  width:5px; height:5px; border-radius:50%;
  background:var(--accent);
  box-shadow:0 0 6px rgba(139,92,246,0.9);
  animation: dotPulse 2.5s ease-in-out infinite;
  flex-shrink:0;
}
@keyframes dotPulse {
  0%,100% { opacity:1; box-shadow:0 0 6px rgba(139,92,246,0.9); }
  50%     { opacity:0.4; box-shadow:0 0 2px rgba(139,92,246,0.3); }
}

.bar-brand {
  font-size:9px; font-weight:600; letter-spacing:2.5px;
  color:var(--text-muted); text-transform:uppercase; white-space:nowrap;
}

.bar-welcome, .bar-watching {
  font-size:11px; color:var(--text-muted); font-style:italic;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}

.bar-ticker {
  font-family:var(--font-mono); font-size:13px; font-weight:700;
  color:var(--text-primary); letter-spacing:0.3px;
}
.bar-sep  { color:var(--text-muted); font-size:10px; }
.bar-price {
  font-family:var(--font-mono); font-size:12px; font-weight:500;
  color:var(--text-secondary);
}
.bar-change {
  font-family:var(--font-mono); font-size:11px; font-weight:500;
}
.bar-change.pos { color:var(--bull); }
.bar-change.neg { color:var(--bear); }

.bar-verdict {
  padding:2px 7px; border-radius:20px;
  font-size:9px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
}
.bar-verdict.bull    { background:rgba(16,185,129,0.10); color:var(--bull); border:1px solid rgba(16,185,129,0.18); }
.bar-verdict.bear    { background:rgba(239,68,68,0.10);  color:var(--bear); border:1px solid rgba(239,68,68,0.18); }
.bar-verdict.neutral { background:var(--accent-dim);     color:var(--accent); border:1px solid rgba(139,92,246,0.22); }

.bar-action {
  font-size:11px; font-weight:600; color:var(--accent);
  padding:3px 10px;
  background:var(--accent-dim); border:1px solid rgba(139,92,246,0.25);
  border-radius:20px; cursor:pointer; white-space:nowrap;
  transition:all 0.15s; -webkit-app-region:no-drag;
}
.bar-action:hover { background:rgba(139,92,246,0.22); }
.bar-action.hidden { display:none; }

.bar-btn {
  width:22px; height:22px;
  background:rgba(255,255,255,0.04); border:1px solid var(--border-default);
  border-radius:6px; color:var(--text-muted); font-size:10px; cursor:pointer;
  display:flex; align-items:center; justify-content:center; transition:all 0.15s;
  -webkit-app-region:no-drag;
}
.bar-btn:hover { background:rgba(255,255,255,0.08); color:var(--text-secondary); border-color:var(--border-strong); }

/* ── Expanded panel ────────────────────────────────────── */
.panel {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  pointer-events: none;

  background: linear-gradient(180deg, #0c0c10 0%, #07070b 100%);
  border: 1px solid rgba(255,255,255,0.08);
  border-top: none;
  border-radius: 0 0 14px 14px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.03),
    0 20px 60px rgba(0,0,0,0.85);

  transition:
    max-height 0.4s var(--ease-spring),
    opacity    0.25s ease;
}

.lens.expanded .panel {
  max-height: 620px;
  opacity: 1;
  pointer-events: all;
}

/* Panel states */
.pstate {
  display:flex; flex-direction:column; align-items:center;
  padding:24px 20px 20px; gap:12px;
}
.pstate.hidden { display:none; }

.state-title { font-family:var(--font-display); font-size:15px; font-weight:600; color:var(--text-primary); }
.state-sub   { font-size:11px; color:var(--text-muted); text-align:center; line-height:1.6; max-width:260px; }
.hidden { display:none !important; }

/* ── Mic visualizer ────────────────────────────────────── */
.viz-wrap { position:relative; width:120px; height:120px; flex-shrink:0; }
.viz-canvas { position:absolute; inset:0; }
.viz-core {
  position:absolute; inset:0;
  width:44px; height:44px; margin:auto; border-radius:50%;
  background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.18);
  box-shadow: 0 0 20px rgba(139,92,246,0.10), inset 0 1px 0 rgba(255,255,255,0.06);
  display:flex; align-items:center; justify-content:center;
  animation: coreBreath 2.5s ease-in-out infinite;
}
@keyframes coreBreath {
  0%,100% { box-shadow: 0 0 20px rgba(139,92,246,0.10), inset 0 1px 0 rgba(255,255,255,0.06); }
  50%     { box-shadow: 0 0 34px rgba(139,92,246,0.24), inset 0 1px 0 rgba(255,255,255,0.08); }
}

/* ── Input row ─────────────────────────────────────────── */
.input-row { display:flex; gap:6px; width:100%; }
.lens-input {
  flex:1; height:36px;
  background:rgba(255,255,255,0.04); border:1px solid var(--border-default);
  border-radius:8px; padding:0 12px;
  font-size:12px; font-family:var(--font-body); color:var(--text-secondary);
  outline:none; transition:border-color 0.15s, background 0.15s;
}
.lens-input::placeholder { color:var(--text-muted); }
.lens-input:focus { border-color:rgba(139,92,246,0.4); background:rgba(139,92,246,0.04); }
.send-btn {
  width:36px; height:36px;
  background:var(--accent-dim); border:1px solid rgba(139,92,246,0.3);
  border-radius:8px; color:var(--accent);
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; transition:all 0.15s;
}
.send-btn:hover { background:rgba(139,92,246,0.25); transform:translateY(-1px); }

/* ── Scan rings ────────────────────────────────────────── */
.scan-rings { position:relative; width:64px; height:64px; margin-top:8px; }
.ring { position:absolute; inset:0; border-radius:50%; border:1px solid transparent; }
.r1 { border-top-color:rgba(139,92,246,0.6); border-right-color:rgba(139,92,246,0.06); animation:cw 1.6s linear infinite; }
.r2 { inset:10px; border-bottom-color:rgba(6,182,212,0.45); border-left-color:rgba(6,182,212,0.06); animation:ccw 1.1s linear infinite; }
.ring-core { position:absolute; inset:22px; border-radius:50%; background:rgba(139,92,246,0.10); border:1px solid rgba(139,92,246,0.2); }
@keyframes cw  { to { transform:rotate(360deg);  } }
@keyframes ccw { to { transform:rotate(-360deg); } }

.detected-badge {
  display:flex; align-items:center; gap:6px; padding:4px 12px;
  background:var(--accent-dim); border:1px solid rgba(139,92,246,0.25); border-radius:20px;
}
.badge-dot { width:4px; height:4px; border-radius:50%; background:var(--accent); box-shadow:0 0 5px rgba(139,92,246,0.8); }
.detected-badge span { font-family:var(--font-mono); font-size:11px; font-weight:700; color:var(--accent); }
.badge-platform { font-family:var(--font-body) !important; font-weight:400 !important; color:var(--text-muted) !important; }

/* Skeleton shimmer — NEVER spinners (design law) */
.skeleton-rows { width:100%; display:flex; flex-direction:column; gap:7px; padding-top:6px; }
.skel {
  height:9px; border-radius:4px;
  background:linear-gradient(90deg,
    rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%
  );
  background-size:200% 100%;
  animation:shimmer 1.8s ease-in-out infinite;
}
.skel-80{width:80%;} .skel-60{width:60%;} .skel-90{width:90%;}
@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

/* ── Result state ──────────────────────────────────────── */
#stateResult { padding:16px 20px 18px; gap:10px; align-items:stretch; }

.result-header { display:flex; justify-content:space-between; align-items:flex-start; }
.result-id { display:flex; flex-direction:column; gap:2px; }
.result-symbol { font-family:var(--font-mono); font-size:20px; font-weight:700; color:var(--text-primary); letter-spacing:-0.5px; }
.result-name   { font-size:10px; color:var(--text-muted); }
.result-price-block { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
.result-price  { font-family:var(--font-mono); font-size:17px; font-weight:600; color:var(--text-primary); }
.result-change { font-family:var(--font-mono); font-size:11px; font-weight:500; }
.result-change.pos { color:var(--bull); }
.result-change.neg { color:var(--bear); }

/* Context strip */
.context-strip {
  display:flex; align-items:center;
  background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle);
  border-radius:8px; overflow:hidden;
}
.ctx-item  { flex:1; display:flex; flex-direction:column; align-items:center; padding:6px 4px; gap:2px; }
.ctx-label { font-size:7px; font-weight:600; letter-spacing:1px; color:var(--text-muted); text-transform:uppercase; }
.ctx-value { font-family:var(--font-mono); font-size:10px; font-weight:600; color:var(--text-secondary); }
.ctx-div   { width:1px; height:26px; background:var(--border-subtle); flex-shrink:0; }

.result-sep { width:100%; height:1px; background:var(--border-subtle); }

/* Signals */
.signals { display:flex; flex-direction:column; gap:6px; width:100%; }
.sig { display:flex; align-items:center; gap:8px; }
.sig-lbl { font-size:8px; font-weight:600; letter-spacing:1.5px; color:var(--text-muted); width:68px; flex-shrink:0; text-transform:uppercase; }
.sig-track { flex:1; height:2px; background:var(--border-subtle); border-radius:2px; overflow:hidden; }
.sig-fill  { height:100%; background:linear-gradient(90deg,#8B5CF6,#06B6D4); border-radius:2px; transition:width 1s var(--ease-spring); width:0%; }
.sig-val   { font-family:var(--font-mono); font-size:9px; color:var(--text-tertiary); width:22px; text-align:right; }

/* Verdict */
.verdict-block { display:flex; flex-direction:column; gap:5px; width:100%; }
.verdict-chip {
  display:inline-flex; align-items:center; padding:2px 8px; border-radius:20px;
  font-size:8px; font-weight:700; letter-spacing:2px; text-transform:uppercase; align-self:flex-start;
}
.verdict-chip.bull    { background:rgba(16,185,129,0.10); color:var(--bull); border:1px solid rgba(16,185,129,0.18); }
.verdict-chip.bear    { background:rgba(239,68,68,0.10);  color:var(--bear); border:1px solid rgba(239,68,68,0.18); }
.verdict-chip.neutral { background:var(--accent-dim);     color:var(--accent); border:1px solid rgba(139,92,246,0.22); }
.verdict-text { font-size:11px; line-height:1.6; color:var(--text-secondary); }

/* Insight — inner card pattern from design law */
.insight-card {
  width:100%;
  background:linear-gradient(180deg,rgba(255,255,255,0.03) 0%,rgba(255,255,255,0.01) 100%);
  border:1px solid var(--border-default); border-radius:8px; padding:8px 12px;
  display:flex; flex-direction:column; gap:3px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);
}
.insight-label { font-size:8px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:rgba(139,92,246,0.5); }
.insight-text  { font-size:11px; line-height:1.5; color:var(--text-tertiary); }

/* Actions */
.actions { display:flex; gap:6px; width:100%; }
.btn-primary {
  flex:1; height:34px;
  background:var(--accent-dim); border:1px solid rgba(139,92,246,0.28);
  border-radius:8px; font-family:var(--font-body); font-size:11px; font-weight:600; color:var(--accent);
  cursor:pointer; transition:all 0.15s;
}
.btn-primary:hover { background:rgba(139,92,246,0.22); transform:translateY(-1px); box-shadow:0 4px 14px rgba(139,92,246,0.18); }
.btn-ghost {
  width:34px; height:34px;
  background:rgba(255,255,255,0.04); border:1px solid var(--border-default);
  border-radius:8px; color:var(--text-muted);
  display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.15s;
}
.btn-ghost:hover { background:rgba(255,255,255,0.07); border-color:var(--border-strong); color:var(--text-secondary); }

/* ── TradingView mode ──────────────────────────────────── */
.tv-header {
  display:flex; align-items:center; justify-content:space-between; width:100%;
  padding-bottom:10px; border-bottom:1px solid var(--border-subtle);
}
.tv-logo { display:flex; align-items:center; gap:7px; font-size:11px; font-weight:600; color:var(--text-secondary); }
.tv-status { font-size:9px; font-weight:600; letter-spacing:1px; color:var(--bull); text-transform:uppercase; }
.tv-suggestions { display:flex; flex-wrap:wrap; gap:6px; width:100%; }
.tv-chip {
  padding:4px 10px; border-radius:20px; font-size:10px; font-weight:500; cursor:pointer;
  background:rgba(255,255,255,0.04); border:1px solid var(--border-default); color:var(--text-tertiary);
  transition:all 0.15s;
}
.tv-chip:hover { background:var(--accent-dim); border-color:rgba(139,92,246,0.3); color:var(--accent); }

/* ── Error state ───────────────────────────────────────── */
.error-ring {
  width:44px; height:44px; border-radius:50%; margin-top:12px;
  background:rgba(239,68,68,0.07); border:1px solid rgba(239,68,68,0.15);
  display:flex; align-items:center; justify-content:center;
}

/* ── History ───────────────────────────────────────────── */
.history-header { display:flex; align-items:center; justify-content:space-between; width:100%; }
.history-list { width:100%; display:flex; flex-direction:column; gap:4px; max-height:260px; overflow-y:auto; }
.history-item {
  display:flex; align-items:center; gap:10px; padding:9px 12px;
  background:linear-gradient(135deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.02) 100%);
  border:1px solid rgba(255,255,255,0.06); border-radius:10px; cursor:pointer;
  transition:all 0.2s var(--ease-spring);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);
}
.history-item:hover { background:linear-gradient(135deg,rgba(255,255,255,0.06) 0%,rgba(255,255,255,0.03) 100%); border-color:rgba(255,255,255,0.12); transform:translateY(-1px); }
.hi-ticker   { font-family:var(--font-mono); font-size:12px; font-weight:700; color:var(--text-primary); width:44px; }
.hi-platform { font-size:9px; color:var(--text-muted); flex:1; }
.hi-time     { font-size:9px; color:var(--text-muted); }
.hi-verdict  { padding:1px 6px; border-radius:10px; font-size:8px; font-weight:700; letter-spacing:1px; }
```

---

## FIX 3 — REAL DATA: CONNECT TO SPECTRE BACKEND

First grep the server to find the actual Quick Intel endpoint:
```bash
grep -rn "quickIntel\|quick-intel\|/api/v1/search\|/api/v1/intel\|quickSearch\|/api/search" server/ --include="*.js" | head -20
grep -rn "router\.\(post\|get\)" server/ --include="*.js" | grep -i "search\|intel\|quick" | head -20
```

Replace querySpectreIntelligence() in lens-main.js:

```javascript
async function querySpectreIntelligence(context, query) {
  const apiBase = process.env.SPECTRE_API_URL || 'http://localhost:3001';
  const apiKey  = store.get('apiKey') || process.env.SPECTRE_API_KEY;
  const ticker  = context.symbol || context.name;
  if (!ticker) throw new Error('no-entity');

  // Try all known Quick Intel endpoint patterns
  const endpoints = [
    '/api/v1/search/quick', '/api/v1/intel/quick',
    '/api/v1/research/quick', '/api/search', '/api/intel',
  ];

  let result = null;
  for (const ep of endpoints) {
    try {
      const res = await axios.post(`${apiBase}${ep}`, {
        query:   query || `Quick intelligence summary for ${ticker}`,
        ticker, symbol: context.symbol,
        address: context.address || null,
        chain:   context.chain   || null,
        mode:    'lens',
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 12000,
      });
      result = res.data;
      break;
    } catch (e) { continue; }
  }

  if (!result) throw new Error('api-unreachable');

  // Fetch live price from internal price feed (more accurate than vision)
  let livePrice = null;
  try {
    const pr = await axios.get(`${apiBase}/api/v1/price/${ticker}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 4000
    });
    livePrice = pr.data;
  } catch (e) { /* use vision price as fallback */ }

  // Derive numeric scores from text labels if not provided as numbers
  const sentimentScore = result.sentimentScore ?? mapSentimentLabel(result.sentiment);
  const onchainScore   = result.onchainScore   ?? mapOnchainSignal(result.onchain);
  const momentumScore  = result.momentumScore  ?? mapPriceChange(livePrice?.change24h ?? context.change24h);
  const whaleScore     = result.whaleScore     ?? mapWhaleSignal(result.whaleFlow || result.whales);

  return {
    symbol:    ticker,
    name:      result.name    || context.name,
    price:     livePrice?.price     || context.price,
    change24h: livePrice?.change24h || context.change24h,
    mcap:      formatLargeNumber(result.marketCap || livePrice?.marketCap),
    volume24h: formatLargeNumber(result.volume24h || livePrice?.volume24h),
    rank:      result.rank    || livePrice?.rank,
    fearGreed: result.fearGreed || null,
    signals: {
      sentiment: sentimentScore,
      onchain:   onchainScore,
      momentum:  momentumScore,
      whale:     whaleScore,
    },
    verdict:       deriveVerdict(sentimentScore, onchainScore, momentumScore, whaleScore),
    verdictText:   result.summary || result.verdict || result.quickSummary || '',
    verdictSpoken: buildSpokenVerdict(ticker, result),
    keyInsight:    extractKeyInsight(result),
  };
}

function mapSentimentLabel(label) {
  if (!label) return 50;
  const l = label.toLowerCase();
  if (l.includes('very bull')) return 88; if (l.includes('bull')) return 70;
  if (l.includes('very bear')) return 12; if (l.includes('bear')) return 30;
  return 50;
}

function mapOnchainSignal(data) {
  if (!data) return 50;
  if (typeof data === 'number') return data;
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
  if (s.includes('dumping')      || s.includes('selling')) return 25;
  return 50;
}

function deriveVerdict(s, o, m, w) {
  const avg = (s + o + m + w) / 4;
  if (avg >= 65) return 'BULLISH'; if (avg <= 35) return 'BEARISH';
  return 'NEUTRAL';
}

function buildSpokenVerdict(ticker, result) {
  const v = result.verdict?.toLowerCase() || 'neutral';
  const s = result.quickSummary || result.summary || '';
  const first = s.split('.')[0];
  return first
    ? `${ticker} is ${v}. ${first}.`.replace(/\s+/g,' ').trim()
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
  if (!n) return '—';
  const num = Number(n);
  if (num >= 1e12) return `$${(num/1e12).toFixed(2)}T`;
  if (num >= 1e9)  return `$${(num/1e9).toFixed(2)}B`;
  if (num >= 1e6)  return `$${(num/1e6).toFixed(2)}M`;
  return `$${num.toLocaleString()}`;
}
```

---

## FIX 4 — PASSIVE DETECTION

In lens-main.js, add background screen watching:

```javascript
let passiveTimer      = null;
let lastDetectedSym   = null;
let passiveNudgeTimer = null;

function startPassiveWatch() {
  if (passiveTimer) return;
  passiveTimer = setInterval(async () => {
    if (isActive || overlayWin?.isVisible()) return;
    try {
      const sc  = await captureScreen(overlayWin);
      const ctx = await extractTokenContext(sc);
      if (ctx.confidence === 'high' && ctx.symbol && ctx.symbol !== lastDetectedSym) {
        lastDetectedSym = ctx.symbol;
        showPassiveNudge(ctx);
      }
    } catch (e) { /* silent fail — never crash passive loop */ }
  }, 12000);
}

function stopPassiveWatch() {
  if (passiveTimer) { clearInterval(passiveTimer); passiveTimer = null; }
}

function showPassiveNudge(context) {
  if (!overlayWin) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, width } = display.bounds;
  const W = 560;
  overlayWin.setBounds({
    x: Math.round(x + width/2 - W/2),
    y: display.bounds.y + 28,
    width: W, height: 52,
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.showInactive();
  overlayWin.webContents.send('lens:passive-detect', { context });

  // Auto-dismiss after 8s if no interaction
  if (passiveNudgeTimer) clearTimeout(passiveNudgeTimer);
  passiveNudgeTimer = setTimeout(() => {
    if (!isActive) overlayWin?.hide();
  }, 8000);
}

// Call startPassiveWatch() at the end of initLens()
```

In overlay.js:
```javascript
ipc.on('lens:passive-detect', ({ context }) => {
  showBarEntity(context);
  const action = document.getElementById('barAction');
  action.textContent = `${context.symbol} detected · analyze →`;
  action.classList.remove('hidden');
  // Hide welcome/watching, show entity
  document.getElementById('centerWelcome').classList.add('hidden');
  document.getElementById('centerWatching').classList.add('hidden');
  document.getElementById('centerEntity').classList.remove('hidden');
});
```

---

## FIX 5 — VIRAL FEATURES

### A. Share to X
```javascript
document.getElementById('btnShare').addEventListener('click', () => {
  const sym     = document.getElementById('rSymbol').textContent;
  const price   = document.getElementById('rPrice').textContent;
  const verdict = document.getElementById('verdictChip').textContent;
  const insight = document.getElementById('insightText').textContent.substring(0, 100);
  const tweet   = `${verdict} on $${sym} at ${price}\n\n${insight}...\n\nvia @SpectreAI_io 👻 $SPECTRE`;
  ipc.send?.('lens:open-url', `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`);
});
```

In electron.js:
```javascript
ipcMain.on('lens:open-url', (_, url) => shell.openExternal(url));
```

### B. Price Alert
```javascript
document.getElementById('btnAlert').addEventListener('click', () => {
  const sym   = document.getElementById('rSymbol').textContent;
  const price = parseFloat(document.getElementById('rPrice').textContent.replace(/[$,]/g,''));
  ipc.send?.('lens:set-alert', { symbol: sym, currentPrice: price });
});
```

In lens-main.js:
```javascript
ipcMain.on('lens:set-alert', (_, { symbol, currentPrice }) => {
  const alerts = store.get('price-alerts', []);
  // For MVP: auto-set alert at +5% and -5% from current price
  alerts.push({
    symbol, currentPrice,
    alertAbove: currentPrice * 1.05,
    alertBelow: currentPrice * 0.95,
    createdAt:  Date.now(),
  });
  store.set('price-alerts', alerts);
  overlayWin?.webContents.send('lens:alert-set', { symbol, currentPrice });

  // Show native Mac notification confirming alert
  new Notification({
    title: `Alert set for ${symbol}`,
    body:  `Notify above $${(currentPrice*1.05).toFixed(2)} or below $${(currentPrice*0.95).toFixed(2)}`,
  }).show();
});

// Check alerts in passive watch loop
function checkPriceAlerts(detectedPrice, detectedSymbol) {
  const alerts = store.get('price-alerts', []);
  alerts.forEach(alert => {
    if (alert.symbol !== detectedSymbol) return;
    if (detectedPrice >= alert.alertAbove || detectedPrice <= alert.alertBelow) {
      new Notification({
        title: `${alert.symbol} price alert triggered`,
        body: `Current: $${detectedPrice.toFixed(2)}`,
      }).show();
      // Remove triggered alert
      store.set('price-alerts', alerts.filter(a => a !== alert));
    }
  });
}
```

### C. Lens History — store every detection
```javascript
function saveToHistory(context, verdict = null) {
  const history = store.get('lens-history', []);
  history.unshift({
    ticker:     context.symbol || context.name,
    name:       context.name,
    platform:   context.platform,
    detectedAt: Date.now(),
    price:      context.price,
    change24h:  context.change24h,
    verdict,
  });
  // Cap at 50 entries
  store.set('lens-history', history.slice(0, 50));
}
// Call saveToHistory(context) after entity confirmed
// Call saveToHistory(context, result.verdict) after analysis complete
```

---

## FIX 6 — TRADINGVIEW MCP

Create desktop/lens/tradingview-mcp.js:

```javascript
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { exec }  = require('child_process');
const axios     = require('axios');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function parseTradingViewCommand(transcript) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Parse this TradingView voice command into JSON.
Command: "${transcript}"
Return ONLY valid JSON:
{
  "action": "drawLine|addIndicator|setAlert|drawFib|mondayOpen|weeklyOpen",
  "params": {
    "type": "support|resistance|mondayOpen|weeklyOpen",
    "price": number or null,
    "indicator": "RSI|MACD|BB|EMA|SMA|VWAP" or null,
    "period": number or null,
    "from": number or null,
    "to": number or null
  }
}`
    }]
  });

  const raw = response.content[0].text.trim().replace(/```json|```/g,'').trim();
  return JSON.parse(raw);
}

async function getMondayOpenPrice(symbol) {
  // Get this week's Monday open from CoinGecko or Binance
  const now    = new Date();
  const day    = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0,0,0,0);

  try {
    const res = await axios.get(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&startTime=${monday.getTime()}&limit=1`
    );
    return parseFloat(res.data[0][1]); // open price
  } catch (e) { return null; }
}

// Execute command via AppleScript → Chrome → TradingView
async function executeTVCommand(parsed, context) {
  const symbol = context.currentSymbol || context.symbol;

  if (parsed.action === 'mondayOpen') {
    parsed.params.price = await getMondayOpenPrice(symbol);
  }

  if (parsed.action === 'weeklyOpen') {
    // Similar — get current week's open
    parsed.params.price = await getMondayOpenPrice(symbol); // Monday = weekly open
  }

  // For MVP: send command to Chrome extension via AppleScript
  // The Spectre Chrome extension handles TradingView DOM manipulation
  const cmdJSON = JSON.stringify(parsed).replace(/'/g, "\\'");
  const script  = `
    tell application "Google Chrome"
      set activeTab to active tab of front window
      execute activeTab javascript "window.postMessage({ type: 'SPECTRE_TV_CMD', payload: ${cmdJSON} }, '*')"
    end tell
  `;

  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script}'`, (err) => {
      if (err) reject(err); else resolve(true);
    });
  });
}

module.exports = { parseTradingViewCommand, executeTVCommand, getMondayOpenPrice };
```

Wire into lens-main.js processLens():
```javascript
const { parseTradingViewCommand, executeTVCommand } = require('./tradingview-mcp');

// After getting context from vision, before normal pipeline:
if (context.isOnTradingView && query) {
  overlayWin?.webContents.send('lens:tv-mode', {
    symbol:    context.currentSymbol || context.symbol,
    timeframe: context.timeframe,
  });
  const parsed = await parseTradingViewCommand(query);
  await executeTVCommand(parsed, context);
  overlayWin?.webContents.send('lens:tv-result', { command: parsed });
  setState('tradingview');
  return;
}
```

---

## FIX 7 — LENS PAGE REDESIGN IN SPECTRE WEB APP

Find the LensPage component:
```bash
find src/ -name "LensPage*" -o -name "lens-page*" 2>/dev/null | head -5
grep -rn "LensPage\|lens-page\|/lens" src/ --include="*.jsx" | head -10
```

Apply these exact design fixes to LensPage.jsx and LensPage.css:

```css
/* ── Page container — fix the top cutoff ────────────────── */
.lens-page {
  padding: 32px 32px 48px;  /* 32px top fixes the screen cutoff */
  max-width: 800px;
}

/* ── Page header ────────────────────────────────────────── */
.lens-page-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 24px; font-weight: 700; color: rgba(255,255,255,1);
  letter-spacing: -0.5px; margin-bottom: 4px;
}

.lens-page-sub {
  font-size: 13px; color: rgba(255,255,255,0.32); margin-bottom: 24px;
}

.lens-shortcut-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.48);
  padding: 4px 10px; border-radius: 8px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
}

/* ── Status card — glass premium ────────────────────────── */
.lens-status-card {
  background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 16px;
  padding: 16px 20px;
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 28px;
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.05),
    inset 0 1px 0 rgba(255,255,255,0.12),
    0 4px 16px rgba(0,0,0,0.4);
}

.lens-status-left  { display:flex; align-items:center; gap:10px; }
.lens-status-dot   { width:7px; height:7px; border-radius:50%; background:#10B981; box-shadow:0 0 8px rgba(16,185,129,0.7); animation:statusPulse 2s ease-in-out infinite; }
@keyframes statusPulse {
  0%,100% { box-shadow:0 0 8px rgba(16,185,129,0.7); }
  50%     { box-shadow:0 0 14px rgba(16,185,129,0.4); }
}
.lens-status-label { font-size:13px; font-weight:600; color:rgba(255,255,255,0.85); }
.lens-status-sub   { font-size:11px; color:rgba(255,255,255,0.32); }

/* ── History section header ──────────────────────────────── */
.lens-section-header {
  display:flex; align-items:center; gap:10px; margin-bottom:12px;
}
.lens-section-title {
  font-size:11px; font-weight:600; letter-spacing:2px;
  color:rgba(255,255,255,0.32); text-transform:uppercase;
}
.lens-count-badge {
  padding:1px 8px; border-radius:20px; font-size:10px; font-weight:600;
  background:rgba(139,92,246,0.10); border:1px solid rgba(139,92,246,0.20); color:#8B5CF6;
}

/* ── History rows — glass cards ─────────────────────────── */
.lens-history-item {
  display:flex; align-items:center; gap:14px;
  padding:12px 16px; border-radius:12px;
  background:linear-gradient(135deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.02) 100%);
  border:1px solid rgba(255,255,255,0.06);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);
  cursor:pointer; transition:all 0.2s cubic-bezier(0.16,1,0.3,1);
  margin-bottom:6px; position:relative; overflow:hidden;
}
.lens-history-item:hover {
  background:linear-gradient(135deg,rgba(255,255,255,0.06) 0%,rgba(255,255,255,0.03) 100%);
  border-color:rgba(255,255,255,0.12);
  transform:translateY(-1px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.4);
}

.lhi-ticker   { font-family:'JetBrains Mono',monospace; font-size:14px; font-weight:700; color:rgba(255,255,255,1); width:64px; }
.lhi-name     { font-size:11px; color:rgba(255,255,255,0.32); flex:1; }
.lhi-platform {
  font-size:9px; font-weight:600; letter-spacing:1px; text-transform:uppercase;
  padding:2px 7px; border-radius:20px;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06);
  color:rgba(255,255,255,0.32);
}
.lhi-price    { font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:600; color:rgba(255,255,255,0.72); }
.lhi-time     { font-size:11px; color:rgba(255,255,255,0.24); width:52px; text-align:right; }

.lhi-verdict.bull    { padding:2px 7px; border-radius:10px; font-size:8px; font-weight:700; letter-spacing:1px; background:rgba(16,185,129,0.10); color:#10B981; border:1px solid rgba(16,185,129,0.18); }
.lhi-verdict.bear    { padding:2px 7px; border-radius:10px; font-size:8px; font-weight:700; letter-spacing:1px; background:rgba(239,68,68,0.10); color:#EF4444; border:1px solid rgba(239,68,68,0.18); }
.lhi-verdict.neutral { padding:2px 7px; border-radius:10px; font-size:8px; font-weight:700; letter-spacing:1px; background:rgba(139,92,246,0.10); color:#8B5CF6; border:1px solid rgba(139,92,246,0.20); }

/* Route hint on hover */
.lhi-route {
  font-size:10px; font-weight:600; color:#8B5CF6; white-space:nowrap;
  opacity:0; transform:translateX(-4px); transition:all 0.2s;
}
.lens-history-item:hover .lhi-route { opacity:1; transform:translateX(0); }

/* Chevron */
.lhi-chevron { color:rgba(255,255,255,0.2); font-size:14px; transition:color 0.15s; }
.lens-history-item:hover .lhi-chevron { color:rgba(255,255,255,0.6); }
```

In LensPage.jsx, add the CoinGecko routing logic:

```jsx
// Cache for CoinGecko lookup results — avoid repeated API calls
const cgCache = useRef({});

async function checkCoinGecko(ticker) {
  if (cgCache.current[ticker] !== undefined) return cgCache.current[ticker];
  try {
    const res  = await fetch(`https://api.coingecko.com/api/v3/search?query=${ticker}`);
    const data = await res.json();
    const hit  = data.coins?.some(c => c.symbol?.toLowerCase() === ticker.toLowerCase());
    cgCache.current[ticker] = hit;
    return hit;
  } catch (e) {
    cgCache.current[ticker] = true; // default to research zone on failure
    return true;
  }
}

async function handleHistoryRowClick(item) {
  const onCoinGecko = await checkCoinGecko(item.ticker);
  if (onCoinGecko) {
    // Listed on CoinGecko → Research Zone deep thesis
    navigate(`/search?q=${item.ticker}&mode=deep&source=lens`);
  } else {
    // Not on CoinGecko → AI Screener via Codex (early/small tokens)
    navigate(`/screener?q=${item.ticker}&source=lens&mode=codex`);
  }
}

// Pre-check on hover for instant routing hint
async function handleHistoryRowHover(item) {
  if (cgCache.current[item.ticker] === undefined) {
    await checkCoinGecko(item.ticker); // pre-warm cache
  }
}

// In JSX, each row:
{history.map(item => {
  const onCg = cgCache.current[item.ticker];
  const routeHint = onCg === false ? 'Screener →' : 'Research →';
  return (
    <div
      key={item.detectedAt}
      className="lens-history-item"
      onClick={() => handleHistoryRowClick(item)}
      onMouseEnter={() => handleHistoryRowHover(item)}
    >
      <span className="lhi-ticker">{item.ticker}</span>
      <span className="lhi-name">{item.name || '—'}</span>
      <span className="lhi-platform">{item.platform || 'unknown'}</span>
      <span className="lhi-price">{item.price ? `$${Number(item.price).toLocaleString()}` : '—'}</span>
      {item.verdict && (
        <span className={`lhi-verdict ${item.verdict.toLowerCase()}`}>
          {item.verdict}
        </span>
      )}
      <span className="lhi-time">{timeAgo(item.detectedAt)}</span>
      <span className="lhi-route">{routeHint}</span>
      <span className="lhi-chevron">›</span>
    </div>
  );
})}
```

---

## FIX 8 — DEEP DIVE HANDOFF (Lens → Spectre App)

In electron.js:
```javascript
ipcMain.on('lens:open-deep-dive', (_, { symbol }) => {
  if (!mainWindow) return;
  mainWindow.show(); mainWindow.focus();
  if (process.platform === 'darwin') app.dock.show();
  mainWindow.webContents.send('spectre:navigate', {
    path: '/search', query: symbol, mode: 'deep'
  });
});
```

In the Spectre web app root component:
```javascript
useEffect(() => {
  if (!window.spectre?.isDesktop) return;
  window.spectre.on('spectre:navigate', ({ path, query, mode }) => {
    navigate(`${path}?q=${query}&mode=${mode}&source=lens`);
  });
}, []);
```

---

## FIX 9 — ERROR MESSAGES THAT ACTUALLY HELP

In lens-main.js processLens(), replace the generic catch:
```javascript
} catch (err) {
  console.error('[Lens] Error:', err);
  let msg = 'Unknown error. Please try again.';

  if (err.message?.includes('screenshot') || err.code === 'EACCES') {
    msg = 'Screen capture failed. Go to System Preferences → Privacy → Screen Recording and enable Spectre AI.';
  } else if (err.message?.includes('ANTHROPIC') || err.message?.includes('401')) {
    msg = 'Vision unavailable. Check ANTHROPIC_API_KEY in your .env file.';
  } else if (err.message?.includes('no-entity')) {
    setState('no-entity');
    return;
  } else if (err.message?.includes('api-unreachable') || err.message?.includes('ECONNREFUSED')) {
    msg = 'Cannot reach Spectre backend. Is the server running on localhost:3001?';
  } else if (err.message?.includes('ELEVENLABS')) {
    msg = 'Voice transcription failed. Check ELEVENLABS_API_KEY in your .env file.';
  }

  overlayWin?.webContents.send('lens:error', { message: msg });
  setState('error');
}
```

In overlay.js:
```javascript
ipc.on('lens:error', ({ message }) => {
  document.getElementById('errorMsg').textContent = message;
});
```

---

## IMPORTANT RULES — DO NOT VIOLATE

1. No OpenAI anywhere. Anthropic SDK for vision and command parsing. ElevenLabs for STT.
2. Do NOT read any file entirely if over 300 lines. Grep then read specific sections.
3. Use ONLY design law tokens. No hardcoded colors except exact hex from the law.
4. JetBrains Mono on ALL numbers, prices, tickers, percentages. Zero exceptions.
5. No spinners anywhere — skeleton shimmer only (design law rule).
6. No Lucide, Heroicons, FontAwesome — inline SVG only in overlay files.
7. alwaysOnTop must be 'screen-saver' level or Lens won't clear the notch.
8. Write checkpoint to /tmp/lens-checkpoint.md before context fills.
9. Test Fix 0 (OpenAI removal) and Fix 1 (positioning) before any other fixes.
10. Run `grep -rn "openai\|OPENAI\|gpt-4" desktop/ --include="*.js"` at end to confirm zero OpenAI references.

---

*Spectre Lens — Complete Nuclear Upgrade*
*Single source of truth — all fixes, all features, all design rules*
*February 2026*
