# SPECTRE LENS — OVERLAY REDESIGN
# Replace desktop/lens/overlay.html and overlay.css entirely with these files.
# Do NOT modify any other files — only the two overlay files change.

---

## THE INTERACTION MODEL

Two states, one component:

COLLAPSED (default when Lens activates):
  A slim 52px bar centered at the TOP of the screen.
  Shows: pulsing dot + "SPECTRE LENS" + detected ticker + one price + one signal chip.
  User sees their screen clearly. Lens is barely there.
  Click anywhere on the bar OR speak → expands.

EXPANDED (after tap or voice):
  The bar grows downward into a full 480px glass panel.
  Shows full mic visualizer, then results: signals, verdict, insight, actions.
  Escape or second hotkey → collapses back to bar, then fades out.

This is the Cluely model done properly with Spectre's design language.

---

## FILE 1 — desktop/lens/overlay.html

Replace the ENTIRE file with this:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spectre Lens</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="overlay.css">
</head>
<body>

  <!--
    The entire UI is ONE element that morphs between collapsed and expanded.
    No separate windows, no separate components.
    Class "expanded" on #lens triggers the transition.
  -->

  <div class="lens" id="lens">

    <!-- ═══════════════════════════════════════════════
         COLLAPSED BAR — always visible in collapsed state
         ═══════════════════════════════════════════════ -->
    <div class="lens-bar" id="lensBar">

      <!-- Left: brand -->
      <div class="bar-brand">
        <div class="bar-dot" id="barDot"></div>
        <span class="bar-name">SPECTRE LENS</span>
      </div>

      <!-- Center: detected entity (hidden until entity found) -->
      <div class="bar-entity hidden" id="barEntity">
        <span class="bar-ticker" id="barTicker"></span>
        <span class="bar-price"  id="barPrice"></span>
        <span class="bar-change" id="barChange"></span>
      </div>

      <!-- Center: idle hint (shown before entity found) -->
      <div class="bar-hint" id="barHint">
        <span>Press to activate</span>
      </div>

      <!-- Right: signal chip + close -->
      <div class="bar-right">
        <div class="bar-signal hidden" id="barSignal"></div>
        <button class="bar-close" id="btnClose">✕</button>
      </div>

    </div><!-- /lens-bar -->


    <!-- ═══════════════════════════════════════════════
         EXPANDED PANEL — slides down from bar
         ═══════════════════════════════════════════════ -->
    <div class="lens-panel" id="lensPanel">

      <!-- ── LISTENING STATE ── -->
      <div class="panel-state" id="stateListening">

        <!-- Voice visualizer canvas — real mic levels drawn here -->
        <div class="viz-wrap">
          <canvas class="viz-canvas" id="vizCanvas" width="140" height="140"></canvas>
          <div class="viz-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="2" width="6" height="13" rx="3" fill="rgba(139,92,246,0.9)"/>
              <path d="M5 10a7 7 0 0014 0" stroke="rgba(139,92,246,0.7)" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="12" y1="19" x2="12" y2="22" stroke="rgba(139,92,246,0.5)" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
        </div>

        <p class="panel-label">Listening</p>
        <p class="panel-hint" id="listeningHint">Ask anything about what's on screen</p>

        <!-- Text fallback -->
        <div class="panel-input-row">
          <input
            type="text"
            class="panel-input"
            id="textQuery"
            placeholder="Or type your question..."
            autocomplete="off"
            spellcheck="false"
          >
          <button class="panel-send" id="btnSend">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

      </div>

      <!-- ── SCANNING / ANALYZING STATE ── -->
      <div class="panel-state hidden" id="stateLoading">

        <div class="scan-orb">
          <div class="scan-ring scan-ring-outer"></div>
          <div class="scan-ring scan-ring-inner"></div>
          <div class="scan-core"></div>
        </div>

        <p class="panel-label" id="loadingLabel">Scanning screen</p>
        <p class="panel-hint"  id="loadingHint">Reading what you're looking at</p>

        <!-- Entity detected mid-scan -->
        <div class="scan-entity hidden" id="scanEntity">
          <div class="scan-entity-dot"></div>
          <span id="scanTicker"></span>
          <span class="scan-platform" id="scanPlatform"></span>
        </div>

        <!-- Skeleton shimmer for incoming result -->
        <div class="skeleton-block hidden" id="skeletonBlock">
          <div class="skeleton-line skeleton-line-w80"></div>
          <div class="skeleton-line skeleton-line-w60"></div>
          <div class="skeleton-line skeleton-line-w90"></div>
        </div>

      </div>

      <!-- ── RESULT STATE ── -->
      <div class="panel-state hidden" id="stateResult">

        <!-- Token identity row -->
        <div class="result-row-top">
          <div class="result-identity">
            <span class="result-symbol" id="resultSymbol"></span>
            <span class="result-fullname" id="resultName"></span>
          </div>
          <div class="result-price-col">
            <span class="result-price"  id="resultPrice"></span>
            <span class="result-change" id="resultChange"></span>
          </div>
        </div>

        <!-- Thin divider -->
        <div class="result-sep"></div>

        <!-- Three signal bars -->
        <div class="signals">
          <div class="signal">
            <span class="signal-lbl">SENTIMENT</span>
            <div class="signal-track">
              <div class="signal-fill" id="fillSentiment" style="width:0%"></div>
            </div>
            <span class="signal-val" id="valSentiment">—</span>
          </div>
          <div class="signal">
            <span class="signal-lbl">ON-CHAIN</span>
            <div class="signal-track">
              <div class="signal-fill" id="fillOnchain" style="width:0%"></div>
            </div>
            <span class="signal-val" id="valOnchain">—</span>
          </div>
          <div class="signal">
            <span class="signal-lbl">MOMENTUM</span>
            <div class="signal-track">
              <div class="signal-fill" id="fillMomentum" style="width:0%"></div>
            </div>
            <span class="signal-val" id="valMomentum">—</span>
          </div>
        </div>

        <!-- Thin divider -->
        <div class="result-sep"></div>

        <!-- Verdict -->
        <div class="verdict">
          <span class="verdict-chip" id="verdictChip"></span>
          <p class="verdict-text" id="verdictText"></p>
        </div>

        <!-- Key insight card -->
        <div class="insight" id="insightCard">
          <span class="insight-lbl">KEY INSIGHT</span>
          <p class="insight-text" id="insightText"></p>
        </div>

        <!-- Action row -->
        <div class="result-actions">
          <button class="btn-primary" id="btnDeepDive">Deep Thesis →</button>
          <button class="btn-ghost"   id="btnVoice" title="Read aloud">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" opacity="0.7"/>
              <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="btn-ghost"   id="btnNewQuery" title="Ask again">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M21 3v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

      </div>

      <!-- ── ERROR / NO ENTITY STATE ── -->
      <div class="panel-state hidden" id="stateError">
        <div class="error-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
            <path d="M12 8v4M12 16h.01" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="panel-label" style="font-size:14px">Nothing detected</p>
        <p class="panel-hint" id="errorDetail">Navigate to a token or stock page first</p>
        <button class="btn-ghost" id="btnRetry" style="margin-top:8px">Try again</button>
      </div>

    </div><!-- /lens-panel -->

  </div><!-- /lens -->

  <script src="overlay.js"></script>
</body>
</html>
```

---

## FILE 2 — desktop/lens/overlay.css

Replace the ENTIRE file with this:

```css
/* ═══════════════════════════════════════════════════════════════
   SPECTRE LENS OVERLAY
   Design law: deep blacks, glass surfaces, purple accent sparingly,
   JetBrains Mono for all numbers, Inter for labels, no spinners.
   ═══════════════════════════════════════════════════════════════ */

/* ── Reset ────────────────────────────────────────────────────── */
*, *::before, *::after {
  margin: 0; padding: 0;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

/* ── Design tokens (mirrored from src/index.css) ─────────────── */
:root {
  --bg-surface:      #131316;
  --bg-elevated:     #1a1a1f;
  --text-primary:    rgba(255,255,255,1);
  --text-secondary:  rgba(255,255,255,0.72);
  --text-tertiary:   rgba(255,255,255,0.48);
  --text-muted:      rgba(255,255,255,0.32);
  --border-subtle:   rgba(255,255,255,0.04);
  --border-default:  rgba(255,255,255,0.08);
  --border-strong:   rgba(255,255,255,0.14);
  --border-accent:   rgba(139,92,246,0.4);
  --accent:          #8B5CF6;
  --accent-dim:      rgba(139,92,246,0.15);
  --bull:            #10B981;
  --bear:            #EF4444;
  --radius-sm:       8px;
  --radius-md:       12px;
  --radius-lg:       16px;
  --font-body:       'Inter', -apple-system, sans-serif;
  --font-mono:       'JetBrains Mono', 'SF Mono', monospace;
  --font-display:    'Space Grotesk', 'Inter', sans-serif;
}

html, body {
  /* Electron window is 600px wide, height is dynamic */
  width: 600px;
  background: transparent;
  overflow: hidden;
  font-family: var(--font-body);
}

/* ═══════════════════════════════════════════════════════════════
   LENS CONTAINER — the morphing shape
   Collapsed: just the bar height (52px)
   Expanded:  bar + panel
   ═══════════════════════════════════════════════════════════════ */
.lens {
  width: 100%;
  display: flex;
  flex-direction: column;
  /* Collapsed: only bar visible */
}

/* ═══════════════════════════════════════════════════════════════
   COLLAPSED BAR
   ═══════════════════════════════════════════════════════════════ */
.lens-bar {
  height: 52px;
  width: 100%;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;

  /* Welcome Widget glass — the premium pattern */
  background: linear-gradient(168deg,
    rgba(7,6,10,0.96)   0%,
    rgba(9,8,13,0.96)   35%,
    rgba(4,3,6,0.96)    70%,
    rgba(2,1,3,0.96)    100%
  );
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 16px;
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.06),
    inset 0 1px 0  rgba(255,255,255,0.12),
    inset 0 -1px 0 rgba(255,255,255,0.03),
    0 8px 32px rgba(0,0,0,0.7),
    0 2px 8px  rgba(0,0,0,0.5);

  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  -webkit-app-region: drag; /* draggable */
}

.lens-bar:hover {
  border-color: rgba(255,255,255,0.16);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.08),
    inset 0 1px 0  rgba(255,255,255,0.14),
    0 12px 40px rgba(0,0,0,0.8),
    0 2px 8px  rgba(0,0,0,0.5);
}

/* Buttons inside bar must not be draggable */
.lens-bar button,
.lens-bar input {
  -webkit-app-region: no-drag;
}

/* ── Bar: brand ─────────────────────────────────────────────── */
.bar-brand {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.bar-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px rgba(139,92,246,0.7);
  animation: dotPulse 2.4s ease-in-out infinite;
}

@keyframes dotPulse {
  0%,100% { opacity: 1;   box-shadow: 0 0 6px  rgba(139,92,246,0.7); }
  50%      { opacity: 0.5; box-shadow: 0 0 10px rgba(139,92,246,0.3); }
}

.bar-name {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--text-muted);
  text-transform: uppercase;
}

/* ── Bar: entity (detected token info) ─────────────────────── */
.bar-entity {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
}

.bar-ticker {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}

.bar-price {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.bar-change {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
}
.bar-change.pos { color: var(--bull); }
.bar-change.neg { color: var(--bear); }

/* ── Bar: idle hint ─────────────────────────────────────────── */
.bar-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bar-hint span {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

/* ── Bar: right side ────────────────────────────────────────── */
.bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.bar-signal {
  padding: 3px 9px;
  border-radius: 20px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.bar-signal.bull { background: rgba(16,185,129,0.1);  color: var(--bull); border: 1px solid rgba(16,185,129,0.2); }
.bar-signal.bear { background: rgba(239,68,68,0.1);   color: var(--bear); border: 1px solid rgba(239,68,68,0.2); }
.bar-signal.neutral { background: var(--accent-dim);  color: var(--accent); border: 1px solid var(--border-accent); }

.bar-close {
  width: 22px;
  height: 22px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  -webkit-app-region: no-drag;
}
.bar-close:hover {
  background: rgba(255,255,255,0.08);
  color: var(--text-primary);
  border-color: var(--border-strong);
}

/* ── Utility ─────────────────────────────────────────────────── */
.hidden { display: none !important; }


/* ═══════════════════════════════════════════════════════════════
   EXPANDED PANEL — slides down from bar
   ═══════════════════════════════════════════════════════════════ */
.lens-panel {
  width: 100%;
  overflow: hidden;
  /* Closed: zero height, invisible */
  max-height: 0;
  opacity: 0;
  pointer-events: none;

  /* Glass inner card — same premium pattern */
  background: linear-gradient(180deg, #0c0c10 0%, #08080c 100%);
  border: 1px solid rgba(255,255,255,0.08);
  border-top: none; /* merges with bar above */
  border-radius: 0 0 16px 16px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.04),
    0 12px 40px rgba(0,0,0,0.7);

  transition:
    max-height 0.38s cubic-bezier(0.16, 1, 0.3, 1),
    opacity    0.28s ease;
}

/* When .expanded is on .lens, panel slides open */
.lens.expanded .lens-bar {
  border-radius: 16px 16px 0 0;
  border-bottom-color: rgba(255,255,255,0.05);
}

.lens.expanded .lens-panel {
  max-height: 520px;
  opacity: 1;
  pointer-events: all;
}

/* ── Panel state wrapper ─────────────────────────────────────── */
.panel-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 24px 24px;
  gap: 14px;
  min-height: 240px;
}
.panel-state.hidden { display: none; }

.panel-label {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.panel-hint {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
  max-width: 280px;
}


/* ═══════════════════════════════════════════════════════════════
   VOICE VISUALIZER
   Circular bars that react to real mic input levels.
   This is the thing that makes it feel alive.
   ═══════════════════════════════════════════════════════════════ */
.viz-wrap {
  position: relative;
  width: 140px;
  height: 140px;
  flex-shrink: 0;
}

.viz-canvas {
  position: absolute;
  inset: 0;
}

.viz-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Inner circle behind the mic icon */
  background: rgba(139,92,246,0.08);
  border: 1px solid rgba(139,92,246,0.2);
  border-radius: 50%;
  width: 52px;
  height: 52px;
  margin: auto;
  box-shadow:
    0 0 20px rgba(139,92,246,0.12),
    inset 0 1px 0 rgba(255,255,255,0.06);
  animation: micBreath 2.4s ease-in-out infinite;
}

@keyframes micBreath {
  0%,100% { box-shadow: 0 0 20px rgba(139,92,246,0.12), inset 0 1px 0 rgba(255,255,255,0.06); }
  50%      { box-shadow: 0 0 36px rgba(139,92,246,0.24), inset 0 1px 0 rgba(255,255,255,0.08); }
}

/* ── Text input fallback ─────────────────────────────────────── */
.panel-input-row {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
}

.panel-input {
  flex: 1;
  height: 38px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 0 14px;
  font-size: 13px;
  font-family: var(--font-body);
  color: var(--text-secondary);
  outline: none;
  transition: border-color 0.15s;
}
.panel-input::placeholder { color: var(--text-muted); }
.panel-input:focus {
  border-color: var(--border-accent);
  background: rgba(139,92,246,0.05);
}

.panel-send {
  width: 38px;
  height: 38px;
  background: var(--accent-dim);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  color: var(--accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.panel-send:hover {
  background: rgba(139,92,246,0.25);
  transform: translateY(-1px);
}


/* ═══════════════════════════════════════════════════════════════
   SCANNING / ANALYZING STATE
   ═══════════════════════════════════════════════════════════════ */
.scan-orb {
  position: relative;
  width: 72px;
  height: 72px;
  margin-top: 8px;
}

.scan-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid transparent;
}

.scan-ring-outer {
  border-top-color:   rgba(139,92,246,0.6);
  border-right-color: rgba(139,92,246,0.08);
  animation: spinCW 1.6s linear infinite;
}

.scan-ring-inner {
  inset: 10px;
  border-bottom-color: rgba(6,182,212,0.5);
  border-left-color:   rgba(6,182,212,0.08);
  animation: spinCCW 1.1s linear infinite;
}

.scan-core {
  position: absolute;
  inset: 22px;
  border-radius: 50%;
  background: rgba(139,92,246,0.12);
  border: 1px solid rgba(139,92,246,0.25);
}

@keyframes spinCW  { to { transform: rotate(360deg); } }
@keyframes spinCCW { to { transform: rotate(-360deg); } }

/* Entity detected badge */
.scan-entity {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  background: var(--accent-dim);
  border: 1px solid var(--border-accent);
  border-radius: 20px;
}

.scan-entity-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px rgba(139,92,246,0.8);
}

.scan-entity span {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}

.scan-platform {
  font-family: var(--font-body) !important;
  font-size: 11px !important;
  font-weight: 400 !important;
  color: var(--text-muted) !important;
}

/* Skeleton shimmer — NO spinners per design law */
.skeleton-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}

.skeleton-line {
  height: 10px;
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.04) 25%,
    rgba(255,255,255,0.08) 50%,
    rgba(255,255,255,0.04) 75%
  );
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.6s ease-in-out infinite;
}

.skeleton-line-w80 { width: 80%; }
.skeleton-line-w60 { width: 60%; }
.skeleton-line-w90 { width: 90%; }

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}


/* ═══════════════════════════════════════════════════════════════
   RESULT STATE
   ═══════════════════════════════════════════════════════════════ */
.panel-state#stateResult {
  padding: 20px 24px 20px;
  gap: 12px;
  min-height: auto;
}

/* Token identity + price row */
.result-row-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  width: 100%;
}

.result-identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-symbol {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.result-fullname {
  font-size: 11px;
  color: var(--text-muted);
}

.result-price-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.result-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.result-change {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
}
.result-change.pos { color: var(--bull); }
.result-change.neg { color: var(--bear); }

/* Separator */
.result-sep {
  width: 100%;
  height: 1px;
  background: var(--border-subtle);
}

/* Signal bars */
.signals {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
}

.signal {
  display: flex;
  align-items: center;
  gap: 10px;
}

.signal-lbl {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  width: 70px;
  flex-shrink: 0;
  text-transform: uppercase;
}

.signal-track {
  flex: 1;
  height: 2px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}

.signal-fill {
  height: 100%;
  background: linear-gradient(90deg, #8B5CF6 0%, #06B6D4 100%);
  border-radius: 2px;
  transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
}

.signal-val {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
  width: 24px;
  text-align: right;
}

/* Verdict */
.verdict {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.verdict-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 20px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  align-self: flex-start;
}
.verdict-chip.bull { background: rgba(16,185,129,0.1);  color: var(--bull); border: 1px solid rgba(16,185,129,0.2); }
.verdict-chip.bear { background: rgba(239,68,68,0.1);   color: var(--bear); border: 1px solid rgba(239,68,68,0.2); }
.verdict-chip.neutral { background: var(--accent-dim);  color: var(--accent); border: 1px solid var(--border-accent); }

.verdict-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* Insight card — inner card pattern from design law */
.insight {
  width: 100%;
  background: linear-gradient(180deg, #0c0c10 0%, #08080c 100%);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}

.insight-lbl {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(139,92,246,0.55);
}

.insight-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

/* Action row */
.result-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}

.btn-primary {
  flex: 1;
  height: 36px;
  background: var(--accent-dim);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-primary:hover {
  background: rgba(139,92,246,0.22);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(139,92,246,0.2);
}

.btn-ghost {
  width: 36px;
  height: 36px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.btn-ghost:hover {
  background: rgba(255,255,255,0.07);
  border-color: var(--border-strong);
  color: var(--text-secondary);
}

/* Error state */
.error-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 16px;
}


/* ═══════════════════════════════════════════════════════════════
   ENTER / EXIT ANIMATIONS
   Bar slides in from top. Panel expands downward.
   ═══════════════════════════════════════════════════════════════ */
.lens {
  animation: lensEnter 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: top center;
}

@keyframes lensEnter {
  from { opacity: 0; transform: translateY(-12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

.lens.exiting {
  animation: lensExit 0.22s ease forwards;
}

@keyframes lensExit {
  from { opacity: 1; transform: translateY(0)    scale(1); }
  to   { opacity: 0; transform: translateY(-8px) scale(0.97); }
}
```

---

## FILE 3 — desktop/lens/overlay.js (UPDATE)

Replace the entire file. Key changes: Electron window now 600px wide + 52px tall when collapsed,
expands by sending resize event. Real mic visualizer using Web Audio API.

```javascript
'use strict';

const ipc = window.spectre;

// ── State ──────────────────────────────────────────────────────
let isExpanded   = false;
let audioCtx     = null;
let audioStream  = null;
let vizAnimId    = null;

const lens     = document.getElementById('lens');
const lensBar  = document.getElementById('lensBar');
const lensPanel = document.getElementById('lensPanel');

// ── Expand / collapse ─────────────────────────────────────────
function expand() {
  if (isExpanded) return;
  isExpanded = true;
  lens.classList.add('expanded');
  // Tell main process to resize window taller
  ipc.send?.('lens:resize', { height: 560 });
  showPanel('listening');
  startVisualizer();
}

function collapse() {
  lens.classList.remove('expanded');
  isExpanded = false;
  stopVisualizer();
  // Resize window back to bar height
  ipc.send?.('lens:resize', { height: 60 });
}

function dismiss() {
  lens.classList.add('exiting');
  stopVisualizer();
  setTimeout(() => ipc.send?.('lens:dismiss'), 220);
}

// ── Panel state machine ───────────────────────────────────────
const PANELS = {
  listening: 'stateListening',
  scanning:  'stateLoading',
  processing:'stateLoading',
  analyzing: 'stateLoading',
  result:    'stateResult',
  error:     'stateError',
  'no-entity': 'stateError',
};

const LOADING_TEXT = {
  scanning:   { label: 'Scanning screen',   hint: 'Reading what you\'re looking at' },
  processing: { label: 'Transcribing',       hint: 'Converting voice to text' },
  analyzing:  { label: 'Analyzing',          hint: 'Running Spectre intelligence stack' },
};

function showPanel(state) {
  document.querySelectorAll('.panel-state').forEach(el => el.classList.add('hidden'));
  const panelId = PANELS[state];
  if (panelId) document.getElementById(panelId)?.classList.remove('hidden');

  if (LOADING_TEXT[state]) {
    document.getElementById('loadingLabel').textContent = LOADING_TEXT[state].label;
    document.getElementById('loadingHint').textContent  = LOADING_TEXT[state].hint;
  }
}

// ── IPC from main process ─────────────────────────────────────
ipc.on('lens:state', ({ state }) => {
  if (state === 'listening' && !isExpanded) {
    expand();
    return;
  }
  if (state === 'result' || state === 'error' || state === 'no-entity') {
    stopVisualizer();
  }
  showPanel(state);
});

ipc.on('lens:context', ({ context }) => {
  if (!context.symbol && !context.name) return;

  // Update bar while scanning
  const ticker = context.symbol || context.name;
  document.getElementById('barTicker').textContent = ticker;
  document.getElementById('barHint').classList.add('hidden');
  document.getElementById('barEntity').classList.remove('hidden');

  // Update scan badge in loading panel
  document.getElementById('scanTicker').textContent   = ticker;
  document.getElementById('scanPlatform').textContent = context.platform || '';
  document.getElementById('scanEntity').classList.remove('hidden');
  document.getElementById('skeletonBlock').classList.remove('hidden');
});

ipc.on('lens:result', ({ result, context }) => {
  renderResult(result, context);
  showPanel('result');
});

ipc.on('lens:reset', () => {
  collapse();
  // Reset bar
  document.getElementById('barEntity').classList.add('hidden');
  document.getElementById('barHint').classList.remove('hidden');
  document.getElementById('barSignal').classList.add('hidden');
  document.getElementById('barPrice').textContent  = '';
  document.getElementById('barChange').textContent = '';
  document.getElementById('barTicker').textContent = '';
});

// ── Render result ─────────────────────────────────────────────
function renderResult(result, context) {
  const symbol = context.symbol || result.symbol || '???';
  const name   = context.name   || result.name   || '';
  const price  = context.price  || result.price;
  const change = context.change24h ?? result.change24h;

  // Result panel
  document.getElementById('resultSymbol').textContent   = symbol;
  document.getElementById('resultName').textContent     = name;

  if (price != null) {
    document.getElementById('resultPrice').textContent =
      '$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }

  if (change != null) {
    const isPos = Number(change) >= 0;
    const el = document.getElementById('resultChange');
    el.textContent = (isPos ? '+' : '') + Number(change).toFixed(2) + '%';
    el.className   = 'result-change ' + (isPos ? 'pos' : 'neg');
  }

  // Update bar with price too
  if (price != null) {
    document.getElementById('barPrice').textContent =
      '$' + Number(price).toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  if (change != null) {
    const isPos = Number(change) >= 0;
    const bel = document.getElementById('barChange');
    bel.textContent = (isPos ? '+' : '') + Number(change).toFixed(2) + '%';
    bel.className   = 'bar-change ' + (isPos ? 'pos' : 'neg');
  }

  // Signal bars (animate after short delay)
  setTimeout(() => {
    setBar('Sentiment', result.signals?.sentiment ?? 50);
    setBar('Onchain',   result.signals?.onchain   ?? 50);
    setBar('Momentum',  result.signals?.momentum  ?? 50);
  }, 80);

  // Verdict
  const verdict = (result.verdict || 'NEUTRAL').toUpperCase();
  const chip    = document.getElementById('verdictChip');
  chip.textContent = verdict;
  chip.className   = 'verdict-chip ' +
    (verdict.includes('BULL') ? 'bull' : verdict.includes('BEAR') ? 'bear' : 'neutral');

  document.getElementById('verdictText').textContent = result.verdictText || result.summary || '';

  // Bar signal chip
  const barSig = document.getElementById('barSignal');
  barSig.textContent = verdict;
  barSig.className   = 'bar-signal ' +
    (verdict.includes('BULL') ? 'bull' : verdict.includes('BEAR') ? 'bear' : 'neutral');
  barSig.classList.remove('hidden');

  // Key insight
  if (result.keyInsight) {
    document.getElementById('insightText').textContent = result.keyInsight;
    document.getElementById('insightCard').classList.remove('hidden');
  } else {
    document.getElementById('insightCard').classList.add('hidden');
  }
}

function setBar(name, score) {
  const el = document.getElementById('fill' + name);
  const vl = document.getElementById('val'  + name);
  if (el) el.style.width = Math.min(100, score) + '%';
  if (vl) vl.textContent = Math.round(score);
}

// ── Voice visualizer — real mic levels ───────────────────────
async function startVisualizer() {
  const canvas    = document.getElementById('vizCanvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
    const source   = audioCtx.createMediaStreamSource(audioStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);

    const data  = new Uint8Array(analyser.frequencyBinCount);
    const BARS  = 48;
    const INNER = 32;
    const MAX_EXTRA = 26;

    function draw() {
      vizAnimId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);

      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < BARS; i++) {
        const angle   = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const sample  = data[Math.floor(i * data.length / BARS)] / 255;
        const extra   = sample * MAX_EXTRA;
        const alpha   = 0.3 + sample * 0.7;

        const x1 = cx + Math.cos(angle) * INNER;
        const y1 = cy + Math.sin(angle) * INNER;
        const x2 = cx + Math.cos(angle) * (INNER + extra);
        const y2 = cy + Math.sin(angle) * (INNER + extra);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(139,92,246,${alpha})`;
        ctx.lineWidth   = 2;
        ctx.lineCap     = 'round';
        ctx.stroke();
      }
    }
    draw();

  } catch (err) {
    // Mic permission denied or unavailable — draw static idle pattern
    drawIdleViz(ctx, W, H, cx, cy);
  }
}

function drawIdleViz(ctx, W, H, cx, cy) {
  const BARS  = 48;
  const INNER = 32;
  for (let i = 0; i < BARS; i++) {
    const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
    const extra = 3 + Math.sin(i * 0.5) * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * INNER, cy + Math.sin(angle) * INNER);
    ctx.lineTo(cx + Math.cos(angle) * (INNER + extra), cy + Math.sin(angle) * (INNER + extra));
    ctx.strokeStyle = 'rgba(139,92,246,0.25)';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.stroke();
  }
}

function stopVisualizer() {
  if (vizAnimId) cancelAnimationFrame(vizAnimId);
  vizAnimId = null;
  if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
  if (audioCtx)    { audioCtx.close(); audioCtx = null; }
}

// ── Button wiring ─────────────────────────────────────────────
lensBar.addEventListener('click', (e) => {
  if (e.target.closest('.bar-close')) return; // let close button handle
  if (!isExpanded) expand();
  else collapse();
});

document.getElementById('btnClose').addEventListener('click', dismiss);
document.getElementById('btnRetry')?.addEventListener('click', () => showPanel('listening'));
document.getElementById('btnNewQuery')?.addEventListener('click', () => {
  showPanel('listening');
  startVisualizer();
});

document.getElementById('btnDeepDive')?.addEventListener('click', () => {
  const sym = document.getElementById('resultSymbol').textContent;
  ipc.send?.('lens:open-deep-dive', { symbol: sym });
});

document.getElementById('btnSend')?.addEventListener('click', () => {
  const q = document.getElementById('textQuery').value.trim();
  if (q) { ipc.send?.('lens:text-query', { query: q }); document.getElementById('textQuery').value = ''; }
});

document.getElementById('textQuery')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnSend').click();
});
```

---

## FILE 4 — Update electron.js window sizing for Lens

In desktop/lens/lens-main.js, update createOverlayWindow() window dimensions
and add the resize IPC handler:

```javascript
// In createOverlayWindow():
// Change dimensions to:
width:  600,
height: 60,    // ← collapsed bar height only
// Remove: resizable: false — keep it, but add:

// Add this IPC handler in setupIPC():
ipcMain.on('lens:resize', (_, { height }) => {
  overlayWin?.setSize(600, height, true); // true = animate
});

// Position overlay at TOP CENTER of active display (not bottom right)
// Update activateLens() position code:
const { x, y, width } = display.workArea;
const W = 600;
overlayWin.setBounds({
  x: Math.round(x + (width / 2) - (W / 2)),  // centered horizontally
  y: y + 12,                                  // 12px from top
  width: W,
  height: 60,
});
```

---

## VERIFY

After implementation:

- [ ] Cmd+Shift+L shows the slim bar centered at TOP of screen
- [ ] Bar shows "SPECTRE LENS" label and pulsing dot
- [ ] Clicking bar expands panel downward smoothly (0.38s spring)
- [ ] Mic visualizer shows circular bars radiating from mic icon
- [ ] Bars animate to actual voice level when speaking
- [ ] Scanning state shows spinning rings + entity badge once detected
- [ ] Skeleton shimmer appears while waiting for results (no spinner)
- [ ] Result state shows token, price, signal bars animate in, verdict chip
- [ ] Bar updates with price + verdict chip when result arrives
- [ ] Collapse: second click on bar collapses panel back up
- [ ] Dismiss: X button animates whole lens out upward
- [ ] Escape key dismisses

---

*Spectre Lens Overlay Redesign — February 2026*
*Slim top bar → expands to full panel*
*Follows SPECTRE_DESIGN_LAW.md exactly*
