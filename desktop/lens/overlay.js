'use strict';

/* =====================================================
   Spectre Lens v3 — Overlay UI Controller
   Matches new HTML structure: welcome/watching/entity,
   market context strip, TradingView mode, history,
   share to X, price alerts
   ===================================================== */

const ipc = window.spectre;

// -- DOM refs ------------------------------------------
const $ = (id) => document.getElementById(id);
const lens   = $('lens');
const bar    = $('bar');
const panel  = $('panel');

// -- State ---------------------------------------------
let isExpanded   = false;
let hasDetected  = false;
let audioCtx     = null;
let audioStream  = null;
let vizAnimId    = null;
let lastResult   = null;
let lastContext  = null;
let currentPanel = null;

// -- Bar center state management -----------------------
function showCenter(which) {
  ['centerWelcome', 'centerWatching', 'centerEntity'].forEach(id => {
    $(id)?.classList.add('hidden');
  });
  $(which)?.classList.remove('hidden');
}

function showBarEntity(ctx) {
  const ticker = ctx.symbol || ctx.name;
  $('barTicker').textContent = ticker;

  if (ctx.price != null) {
    $('barPrice').textContent = '$' + Number(ctx.price).toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  if (ctx.change24h != null) {
    const isPos = Number(ctx.change24h) >= 0;
    const el = $('barChange');
    el.textContent = (isPos ? '+' : '') + Number(ctx.change24h).toFixed(2) + '%';
    el.className = 'bar-change ' + (isPos ? 'pos' : 'neg');
  }

  showCenter('centerEntity');
}

// -- Expand / collapse ---------------------------------
function expand() {
  if (isExpanded) return;
  isExpanded = true;
  lens.classList.add('expanded');
  lens.classList.remove('passive-nudge', 'passive-fade');
  ipc?.send('lens:resize', { width: 560, height: 640 });
  showPanel('listening');
}

function collapse() {
  lens.classList.remove('expanded');
  isExpanded = false;
  stopVisualizer();
  ipc?.send('lens:resize', { width: 560, height: 56 });
}

function dismiss() {
  stopVisualizer();
  lens.classList.add('out');
  setTimeout(() => ipc?.send('lens:dismiss'), 200);
}

// -- Panel state machine -------------------------------
const PANELS = {
  listening:    'stateListening',
  scanning:     'stateLoading',
  processing:   'stateLoading',
  analyzing:    'stateLoading',
  result:       'stateResult',
  error:        'stateError',
  'no-entity':  'stateError',
  tradingview:  'stateTradingView',
  history:      'stateHistory',
};

const LOADING_TEXT = {
  scanning:   { title: 'Scanning screen',  sub: 'Reading what you\'re looking at' },
  processing: { title: 'Transcribing',     sub: 'Converting voice to text' },
  analyzing:  { title: 'Analyzing',        sub: 'Running Spectre intelligence stack' },
};

function showPanel(state) {
  document.querySelectorAll('.pstate').forEach(el => el.classList.add('hidden'));
  const panelId = PANELS[state];
  if (panelId) $(panelId)?.classList.remove('hidden');
  currentPanel = state;

  if (LOADING_TEXT[state]) {
    $('loadTitle').textContent = LOADING_TEXT[state].title;
    $('loadSub').textContent   = LOADING_TEXT[state].sub;
  }
}

// -- IPC from main process -----------------------------
if (ipc) {
  ipc.on('lens:state', ({ state }) => {
    if (state === 'welcome') {
      showCenter('centerWelcome');
      return;
    }

    // Auto-expand for active states
    if (['listening', 'scanning', 'processing', 'analyzing'].includes(state) && !isExpanded) {
      expand();
    }
    if (['result', 'error', 'no-entity'].includes(state)) {
      stopVisualizer();
    }
    showPanel(state);
  });

  ipc.on('lens:context', ({ context }) => {
    if (!context.symbol && !context.name) return;
    hasDetected = true;

    showBarEntity(context);

    // Badge in loading panel
    $('detectedTicker').textContent   = context.symbol || context.name;
    $('detectedPlatform').textContent = context.platform ? `on ${context.platform}` : '';
    $('detectedBadge').classList.remove('hidden');

    // If TradingView detected, show TV mode after analysis
    if (context.isOnTradingView) {
      ipc?.send('lens:tv-detected', {
        symbol:    context.currentSymbol || context.symbol,
        timeframe: context.timeframe,
      });
    }
  });

  ipc.on('lens:result', ({ result, context }) => {
    lastResult  = result;
    lastContext = context;
    renderResult(result, context);
    showPanel('result');
  });

  ipc.on('lens:error', ({ message }) => {
    showPanel('error');
    $('errorMsg').textContent = message || 'Unknown error';
  });

  ipc.on('lens:reset', () => {
    collapse();
    cleanupMic();
    resetSignals();
    showCenter('centerWelcome');
    $('barTicker').textContent = '';
    $('barPrice').textContent  = '';
    $('barChange').textContent = '';
    $('barVerdict')?.classList.add('hidden');
    $('barAction')?.classList.add('hidden');
    $('detectedBadge')?.classList.add('hidden');
    lastResult = null;
    lastContext = null;
    lens.classList.remove('out', 'passive-nudge', 'passive-fade');
  });

  ipc.on('lens:audio', ({ audio }) => {
    if (audio) {
      const player = $('voicePlayer');
      player.src = audio;
      player.play().catch(() => {});
    }
  });

  ipc.on('lens:query', () => { /* received — no log for privacy */ });

  // -- Passive detection nudge --------------------------
  ipc.on('lens:passive-detect', ({ context }) => {
    hasDetected = true;
    lens.classList.remove('out', 'passive-fade');
    lens.classList.add('passive-nudge');

    showBarEntity(context);

    // Show action button
    const action = $('barAction');
    action.textContent = `${context.symbol} detected \u00b7 analyze \u2192`;
    action.classList.remove('hidden');

    // Auto-fade after 8s if not tapped
    const fadeTimer = setTimeout(() => {
      lens.classList.add('passive-fade');
      setTimeout(() => {
        lens.classList.remove('passive-nudge', 'passive-fade');
        ipc?.send('lens:dismiss');
      }, 300);
    }, 8000);

    // Click to expand
    const clickHandler = () => {
      clearTimeout(fadeTimer);
      bar.removeEventListener('click', clickHandler);
      lens.classList.remove('passive-nudge', 'passive-fade');
      action.classList.add('hidden');
      ipc?.send('lens:passive-activate', { symbol: context.symbol });
      expand();
    };
    bar.addEventListener('click', clickHandler, { once: true });
  });

  // -- TradingView mode ---------------------------------
  ipc.on('lens:tv-mode', ({ symbol, timeframe }) => {
    showPanel('tradingview');
    $('tvStatus').textContent = `${symbol} ${timeframe || ''}`;
  });

  ipc.on('lens:tv-result', ({ command }) => {
    $('tvStatus').textContent = `Done: ${command.action}`;
    setTimeout(() => { $('tvStatus').textContent = 'Ready'; }, 3000);
  });

  // -- Price alert confirmation -------------------------
  ipc.on('lens:alert-set', ({ symbol }) => {
    const btn = $('btnAlert');
    if (btn) {
      btn.style.borderColor = 'rgba(16,185,129,0.4)';
      btn.style.color = 'var(--bull)';
      setTimeout(() => { btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
    }
  });

  // -- History data from main ----------------------------
  ipc.on('lens:history-data', ({ history }) => {
    renderHistory(history || []);
  });

  // Mic capture commands from main
  ipc.on('lens:start-mic', () => startMicCapture());
  ipc.on('lens:stop-mic', async () => {
    const buffer = await stopMicCapture();
    ipc?.send('lens:audio-data', { buffer: buffer ? Array.from(buffer) : null });
  });
}

// -- Render result -------------------------------------
function renderResult(result, context) {
  try {
    const symbol = context.symbol || result.symbol || '???';
    const name   = context.name   || result.name   || '';
    const price  = result.price ?? context.price;
    const change = result.change24h ?? context.change24h;

    $('rSymbol').textContent = symbol;
    $('rName').textContent   = name;

    if (price != null) {
      $('rPrice').textContent = '$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    }

    if (change != null) {
      const isPos = Number(change) >= 0;
      const el = $('rChange');
      el.textContent = (isPos ? '+' : '') + Number(change).toFixed(2) + '%';
      el.className = 'result-change ' + (isPos ? 'pos' : 'neg');
    }

    // Market context strip
    if (result.mcap)      $('ctxMcap').textContent = result.mcap;
    if (result.volume24h) $('ctxVol').textContent  = result.volume24h;
    if (result.rank)      $('ctxRank').textContent = '#' + result.rank;
    if (result.fearGreed) $('ctxFng').textContent  = result.fearGreed;

    // Update bar
    showBarEntity({ symbol, price, change24h: change });

    // Signal bars (with delay for animation)
    setTimeout(() => {
      setSignal('Sentiment', result.signals?.sentiment ?? 50);
      setSignal('Onchain',   result.signals?.onchain   ?? 50);
      setSignal('Momentum',  result.signals?.momentum  ?? 50);
      setSignal('Whale',     result.signals?.whale      ?? 50);
    }, 80);

    // Verdict chip
    const verdict = (result.verdict || 'NEUTRAL').toUpperCase();
    const chip = $('verdictChip');
    chip.textContent = verdict;
    chip.className = 'verdict-chip ' +
      (verdict.includes('BULL') ? 'bull' : verdict.includes('BEAR') ? 'bear' : 'neutral');

    $('verdictText').textContent = result.verdictText || '';

    // Bar verdict
    const bv = $('barVerdict');
    bv.textContent = verdict;
    bv.className = 'bar-verdict ' +
      (verdict.includes('BULL') ? 'bull' : verdict.includes('BEAR') ? 'bear' : 'neutral');
    bv.classList.remove('hidden');

    // Key insight
    $('insightText').textContent = result.keyInsight || 'No key insight available for this asset.';

  } catch (err) {
    console.error('[Lens] renderResult error:', err);
  }
}

function setSignal(name, score) {
  const fill = $('f' + name);
  const val  = $('v' + name);
  const clamped = Math.max(0, Math.min(100, score));
  if (fill) fill.style.width = clamped + '%';
  if (val)  val.textContent  = Math.round(clamped);
}

function resetSignals() {
  ['Sentiment', 'Onchain', 'Momentum', 'Whale'].forEach(name => {
    const fill = $('f' + name);
    const val  = $('v' + name);
    if (fill) fill.style.width = '0%';
    if (val)  val.textContent  = '\u2014';
  });
}

// -- History -------------------------------------------
function renderHistory(history) {
  const list = $('historyList');
  if (!list) return;
  list.innerHTML = '';

  if (history.length === 0) {
    list.innerHTML = '<p class="state-sub" style="padding:16px 0">No detections yet</p>';
    return;
  }

  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <span class="hi-ticker">${item.ticker || item.symbol || '???'}</span>
      <span class="hi-platform">${item.platform || '—'}</span>
      <span class="hi-time">${timeAgo(item.detectedAt || item.timestamp)}</span>
      ${item.verdict ? `<span class="hi-verdict ${(item.verdict || '').toLowerCase()}">${item.verdict}</span>` : ''}
    `;
    div.addEventListener('click', () => {
      ipc?.send('lens:passive-activate', { symbol: item.ticker || item.symbol });
    });
    list.appendChild(div);
  });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

// -- Voice visualizer (real mic levels) ----------------
async function startVisualizer() {
  const canvas = $('vizCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
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
    const INNER = 28;
    const MAX_EXTRA = 22;

    function draw() {
      vizAnimId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < BARS; i++) {
        const angle  = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const sample = data[Math.floor(i * data.length / BARS)] / 255;
        const extra  = sample * MAX_EXTRA;
        const alpha  = 0.3 + sample * 0.7;

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
    startMicCapture();

  } catch (err) {
    // Draw idle state
    const BARS  = 48;
    const INNER = 28;
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
}

function stopVisualizer() {
  if (vizAnimId) cancelAnimationFrame(vizAnimId);
  vizAnimId = null;
  if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
  if (audioCtx)    { audioCtx.close().catch(() => {}); audioCtx = null; }
}

// -- Mic capture (audio data to main process) ----------
let mediaRecorder = null;
let audioChunks   = [];
let micStream     = null;

async function startMicCapture() {
  try {
    const stream = audioStream || await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }
    });
    if (!audioStream) micStream = stream;

    audioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start(100);
  } catch (err) {
    console.warn('[Lens Mic] Access failed:', err.message);
  }
}

async function stopMicCapture() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    cleanupMic();
    return null;
  }
  return new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const arrayBuf = await blob.arrayBuffer();
        cleanupMic();
        resolve(arrayBuf.byteLength > 1000 ? new Uint8Array(arrayBuf) : null);
      } catch (err) {
        cleanupMic();
        resolve(null);
      }
    };
    mediaRecorder.stop();
  });
}

function cleanupMic() {
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  mediaRecorder = null;
  audioChunks = [];
}

// -- Button wiring -------------------------------------
bar.addEventListener('click', (e) => {
  if (e.target.closest('.bar-btn') || e.target.closest('.bar-action')) return;
  if (!isExpanded) expand();
  else collapse();
});

$('btnClose')?.addEventListener('click', dismiss);

$('btnRetry')?.addEventListener('click', () => {
  showPanel('listening');
  ipc?.send('lens:retry');
});

// Scan Screen button — user explicitly triggers analysis
$('btnScanScreen')?.addEventListener('click', () => {
  showPanel('scanning');
  ipc?.send('lens:scan-screen');
});

$('btnDeepDive')?.addEventListener('click', () => {
  const sym = $('rSymbol')?.textContent || '';
  ipc?.send('lens:open-deep-dive', { symbol: sym });
});

$('btnVoice')?.addEventListener('click', () => {
  const player = $('voicePlayer');
  if (player.src && !player.paused) {
    player.pause();
    player.currentTime = 0;
  } else if (player.src) {
    player.play().catch(() => {});
  }
});

// Share to X
$('btnShare')?.addEventListener('click', () => {
  const sym     = $('rSymbol')?.textContent || '';
  const price   = $('rPrice')?.textContent || '';
  const verdict = $('verdictChip')?.textContent || '';
  const insight = ($('insightText')?.textContent || '').substring(0, 100);
  const tweet   = `${verdict} on $${sym} at ${price}\n\n${insight}...\n\nvia @SpectreAI_io \ud83d\udc7b $SPECTRE`;
  ipc?.send('lens:open-url', { url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}` });
});

// Price alert
$('btnAlert')?.addEventListener('click', () => {
  const sym   = $('rSymbol')?.textContent || '';
  const price = parseFloat(($('rPrice')?.textContent || '0').replace(/[$,]/g, ''));
  ipc?.send('lens:set-alert', { symbol: sym, currentPrice: price });
});

// History button
$('btnHistory')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentPanel === 'history') {
    if (isExpanded) collapse();
    return;
  }
  if (!isExpanded) {
    isExpanded = true;
    lens.classList.add('expanded');
    ipc?.send('lens:resize', { width: 560, height: 400 });
  }
  showPanel('history');
  ipc?.send('lens:history-load');
});

$('btnClearHistory')?.addEventListener('click', () => {
  ipc?.send('lens:history-save', { history: [] });
  renderHistory([]);
});

// Text query
$('btnSend')?.addEventListener('click', () => {
  const q = $('textQuery')?.value.trim();
  if (q) {
    ipc?.send('lens:text-query', { query: q });
    $('textQuery').value = '';
  }
});

$('textQuery')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnSend')?.click();
});

// TradingView chips
document.querySelectorAll('.tv-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const cmd = chip.dataset.cmd;
    if (cmd) ipc?.send('lens:tv-command', { command: cmd });
  });
});

// TradingView text query
$('btnTvSend')?.addEventListener('click', () => {
  const q = $('tvQuery')?.value.trim();
  if (q) {
    ipc?.send('lens:tv-command', { command: q });
    $('tvQuery').value = '';
  }
});

$('tvQuery')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnTvSend')?.click();
});

// Bar action button (passive nudge "Analyze →")
$('barAction')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const ticker = $('barTicker')?.textContent;
  if (ticker) {
    $('barAction').classList.add('hidden');
    ipc?.send('lens:passive-activate', { symbol: ticker });
    expand();
  }
});

// Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    dismiss();
  }
});
