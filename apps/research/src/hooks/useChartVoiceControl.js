/**
 * useChartVoiceControl – full voice control for TradingChart.
 *
 * Uses the Web Speech API (SpeechRecognition) to listen for spoken commands
 * and map them to chart actions. Speaks back confirmations via ElevenLabs TTS
 * (server-side) with browser Web Speech API fallback.
 *
 * Supported command categories:
 *   Timeframe, Chart type, View mode, Token switching, Line color,
 *   Toggles, Y-axis, Zoom, Pan/scroll, X Bubbles (2D/3D, camera), Auto-fit
 */
import { useState, useRef, useCallback, useEffect } from 'react'

/* ═══════════════════════════════════════════════════════════════════════════
   COMMAND PATTERN MAPS — ordered longest-first within each entry so
   multi-word patterns match before their shorter substrings.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Timeframes ─────────────────────────────────────────────────────────── */
const TIMEFRAME_MAP = [
  { patterns: ['1 second', 'one second'],                    code: '1S' },
  { patterns: ['15 minutes', 'fifteen minutes', '15 minute', 'fifteen minute'], code: '15M' },
  { patterns: ['5 minutes', 'five minutes', '5 minute', 'five minute'],   code: '5M' },
  { patterns: ['1 minute', 'one minute'],                    code: '1M' },
  { patterns: ['4 hours', 'four hours', '4 hour', 'four hour'], code: '4H' },
  { patterns: ['1 hour', 'one hour', 'hourly'],              code: '1H' },
  { patterns: ['1 week', 'one week', 'weekly'],              code: '1W' },
  { patterns: ['1 day', 'one day', 'daily'],                 code: '1D' },
]

/* ── Chart types ────────────────────────────────────────────────────────── */
const CHART_TYPE_MAP = [
  { patterns: ['candlestick chart', 'candlesticks', 'candlestick', 'candles', 'candle chart'], type: 'candles' },
  { patterns: ['line chart', 'line mode', 'line'],           type: 'line' },
  { patterns: ['trading view chart', 'tradingview chart', 'trading view', 'tradingview'], type: 'tradingview' },
]

/* ── Chart view modes ───────────────────────────────────────────────────── */
const VIEW_MODE_MAP = [
  { patterns: ['chart overlay', 'social overlay', 'x chart', 'overlay mode'], mode: 'xChart' },
  { patterns: ['x bubbles', 'bubble mode', 'bubbles view', 'bubbles'],       mode: 'xBubbles' },
  { patterns: ['trading mode', 'normal mode', 'standard chart', 'trading chart'], mode: 'trading' },
]

/* ── Token switching — spoken name/symbol → uppercase symbol ────────────── */
const TOKEN_VOICE_MAP = [
  { patterns: ['bitcoin', 'btc'],                   symbol: 'BTC' },
  { patterns: ['ethereum', 'ether', 'eth'],          symbol: 'ETH' },
  { patterns: ['solana', 'sol'],                     symbol: 'SOL' },
  { patterns: ['binance coin', 'bnb'],               symbol: 'BNB' },
  { patterns: ['ripple', 'xrp'],                     symbol: 'XRP' },
  { patterns: ['cardano', 'ada'],                    symbol: 'ADA' },
  { patterns: ['dogecoin', 'doge'],                  symbol: 'DOGE' },
  { patterns: ['avalanche', 'avax'],                 symbol: 'AVAX' },
  { patterns: ['polkadot', 'dot'],                   symbol: 'DOT' },
  { patterns: ['chainlink', 'link'],                 symbol: 'LINK' },
  { patterns: ['polygon', 'matic'],                  symbol: 'MATIC' },
  { patterns: ['uniswap', 'uni'],                    symbol: 'UNI' },
  { patterns: ['cosmos', 'atom'],                    symbol: 'ATOM' },
  { patterns: ['litecoin', 'ltc'],                   symbol: 'LTC' },
  { patterns: ['ethereum classic'],                  symbol: 'ETC' },
  { patterns: ['filecoin', 'fil'],                   symbol: 'FIL' },
  { patterns: ['arbitrum', 'arb'],                   symbol: 'ARB' },
  { patterns: ['optimism'],                          symbol: 'OP' },
  { patterns: ['near protocol', 'near'],             symbol: 'NEAR' },
  { patterns: ['aptos', 'apt'],                      symbol: 'APT' },
  { patterns: ['sui'],                               symbol: 'SUI' },
  { patterns: ['injective', 'inj'],                  symbol: 'INJ' },
  { patterns: ['celestia', 'tia'],                   symbol: 'TIA' },
  { patterns: ['sei'],                               symbol: 'SEI' },
  { patterns: ['aave'],                              symbol: 'AAVE' },
  { patterns: ['maker', 'mkr'],                      symbol: 'MKR' },
  { patterns: ['curve', 'crv'],                      symbol: 'CRV' },
  { patterns: ['lido', 'ldo'],                       symbol: 'LDO' },
  { patterns: ['the graph', 'grt'],                  symbol: 'GRT' },
  { patterns: ['render', 'rndr'],                    symbol: 'RENDER' },
  { patterns: ['fetch ai', 'fetch', 'fet'],          symbol: 'FET' },
  { patterns: ['bittensor', 'tao'],                  symbol: 'TAO' },
  { patterns: ['ondo', 'ondo finance'],              symbol: 'ONDO' },
  { patterns: ['jupiter', 'jup'],                    symbol: 'JUP' },
  { patterns: ['pyth', 'pyth network'],              symbol: 'PYTH' },
  { patterns: ['pepe'],                              symbol: 'PEPE' },
  { patterns: ['dogwifhat', 'wif'],                  symbol: 'WIF' },
  { patterns: ['bonk'],                              symbol: 'BONK' },
  { patterns: ['shiba inu', 'shiba', 'shib'],        symbol: 'SHIB' },
  { patterns: ['floki'],                             symbol: 'FLOKI' },
  { patterns: ['spectre', 'spectre ai'],             symbol: 'SPECTRE' },
  { patterns: ['tether', 'usdt'],                    symbol: 'USDT' },
  { patterns: ['usd coin', 'usdc'],                  symbol: 'USDC' },
]

/* ── Toggles ────────────────────────────────────────────────────────────── */
const TOGGLE_MAP = [
  { patterns: ['toggle heatmap', 'heatmap on', 'heatmap off', 'heat map', 'heatmap'], action: 'toggleHeatmap' },
  { patterns: ['all-time high', 'all time high', 'toggle ath', 'ath lines', 'ath'],    action: 'toggleATH' },
  { patterns: ['exit fullscreen', 'leave fullscreen', 'close fullscreen'],              action: 'exitFullscreen' },
  { patterns: ['enter fullscreen', 'go fullscreen', 'full screen', 'fullscreen'],       action: 'toggleFullscreen' },
]

/* ── Y-axis ─────────────────────────────────────────────────────────────── */
const YAXIS_MAP = [
  { patterns: ['market cap mode', 'show market cap', 'market cap', 'mcap'], mode: 'mcap' },
  { patterns: ['price mode', 'show price', 'price'],                        mode: 'price' },
]

/* ── Zoom ───────────────────────────────────────────────────────────────── */
const ZOOM_MAP = [
  { patterns: ['reset zoom', 'reset chart', 'reset view', 'reset'],  action: 'resetZoom' },
  { patterns: ['zoom in', 'closer'],                                   action: 'zoomIn' },
  { patterns: ['zoom out', 'farther'],                                 action: 'zoomOut' },
]

/* ── Line color ─────────────────────────────────────────────────────────── */
const LINE_COLOR_MAP = [
  { patterns: ['auto color', 'automatic color', 'default color'], color: 'auto' },
  { patterns: ['cyan line', 'cyan color', 'cyan'],                color: 'cyan' },
  { patterns: ['purple line', 'purple color', 'purple'],          color: 'purple' },
  { patterns: ['green line', 'green color', 'green'],             color: 'green' },
  { patterns: ['gold line', 'gold color', 'gold', 'yellow'],      color: 'gold' },
  { patterns: ['rose line', 'rose color', 'pink line', 'rose', 'pink'], color: 'rose' },
  { patterns: ['blue line', 'blue color', 'blue'],                color: 'blue' },
  { patterns: ['white line', 'white color', 'white'],             color: 'white' },
]

/* ── Pan / scroll ───────────────────────────────────────────────────────── */
const PAN_MAP = [
  { patterns: ['scroll left', 'go back', 'go left', 'show older', 'older data'], action: 'scrollLeft' },
  { patterns: ['scroll right', 'go forward', 'go right', 'latest', 'show latest', 'newest', 'most recent'], action: 'scrollRight' },
]

/* ── X Bubbles ──────────────────────────────────────────────────────────── */
const BUBBLES_MAP = [
  { patterns: ['3d mode', 'three d', 'three dimensional', '3d view'], action: 'set3D' },
  { patterns: ['2d mode', 'two d', 'two dimensional', '2d view', 'flat mode', 'flat view'], action: 'set2D' },
  { patterns: ['reset camera', 'center view', 'center camera', 'home camera'], action: 'resetCamera' },
]

/* ── Indicators — add/remove/toggle overlays on chart ───────────────────── */
const INDICATOR_ADD_MAP = [
  { patterns: ['add ema 200', 'show ema 200', 'ema 200', 'ema two hundred'],    key: 'ema200' },
  { patterns: ['add ema 50', 'show ema 50', 'ema 50', 'ema fifty'],             key: 'ema50' },
  { patterns: ['add ema 21', 'show ema 21', 'ema 21', 'ema twenty one'],        key: 'ema21' },
  { patterns: ['add ema 9', 'show ema 9', 'ema 9', 'ema nine'],                 key: 'ema9' },
  { patterns: ['add ema', 'show ema'],                                           key: 'ema21' },
  { patterns: ['add sma 200', 'show sma 200', 'sma 200', 'sma two hundred'],    key: 'sma200' },
  { patterns: ['add sma 50', 'show sma 50', 'sma 50', 'sma fifty'],             key: 'sma50' },
  { patterns: ['add sma 20', 'show sma 20', 'sma 20', 'sma twenty'],            key: 'sma20' },
  { patterns: ['add sma', 'show sma'],                                           key: 'sma20' },
  { patterns: ['bollinger bands', 'bollinger', 'add bollinger', 'show bollinger', 'add bb', 'show bb'], key: 'bb' },
  { patterns: ['add vwap', 'show vwap', 'vwap', 'volume weighted'],             key: 'vwap' },
]

const INDICATOR_REMOVE_MAP = [
  { patterns: ['remove ema 200', 'hide ema 200'],  key: 'ema200' },
  { patterns: ['remove ema 50', 'hide ema 50'],    key: 'ema50' },
  { patterns: ['remove ema 21', 'hide ema 21'],    key: 'ema21' },
  { patterns: ['remove ema 9', 'hide ema 9'],      key: 'ema9' },
  { patterns: ['remove sma 200', 'hide sma 200'],  key: 'sma200' },
  { patterns: ['remove sma 50', 'hide sma 50'],    key: 'sma50' },
  { patterns: ['remove sma 20', 'hide sma 20'],    key: 'sma20' },
  { patterns: ['remove bollinger', 'hide bollinger', 'remove bb', 'hide bb'], key: 'bb' },
  { patterns: ['remove vwap', 'hide vwap'],         key: 'vwap' },
]

const INDICATOR_CLEAR_PATTERNS = [
  'clear indicators', 'remove all indicators', 'hide all indicators',
  'clear all indicators', 'no indicators', 'remove all',
]

/* ── Auto-fit ───────────────────────────────────────────────────────────── */
const AUTOFIT_PATTERNS = ['auto fit', 'fit to screen', 'fit all', 'fit chart', 'auto scale']


/* ═══════════════════════════════════════════════════════════════════════════
   COMMAND PARSER
   ═══════════════════════════════════════════════════════════════════════════ */

function matchPatterns(text, entries, keyName, labelFn) {
  for (const entry of entries) {
    for (const p of entry.patterns) {
      if (text.includes(p)) return { action: keyName, value: entry, label: labelFn(entry), raw: p }
    }
  }
  return null
}

/**
 * Parse transcript → command object or null.
 * Priority: token switch (with trigger words) → timeframe → chart type →
 *   view mode → line color → toggle → y-axis → zoom → pan → bubbles → auto-fit
 */
function parseCommand(transcript) {
  const text = transcript.toLowerCase().trim()

  // ── 1. Token switching ──────────────────────────────────────────────
  // Require a trigger word to avoid accidental token switches from stray words
  const hasTokenTrigger = /\b(show|switch to|go to|open|change to|display)\b/.test(text)
  if (hasTokenTrigger) {
    for (const entry of TOKEN_VOICE_MAP) {
      for (const p of entry.patterns) {
        if (text.includes(p)) {
          return { action: 'symbolChange', value: entry.symbol, label: `Token: ${entry.symbol}` }
        }
      }
    }
  }

  // ── 2. Timeframe ────────────────────────────────────────────────────
  for (const entry of TIMEFRAME_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        return { action: 'timeframe', value: entry.code, label: `Timeframe: ${entry.code}` }
      }
    }
  }

  // ── 3. Chart type ──────────────────────────────────────────────────
  for (const entry of CHART_TYPE_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const name = entry.type.charAt(0).toUpperCase() + entry.type.slice(1)
        return { action: 'chartType', value: entry.type, label: `Chart: ${name}` }
      }
    }
  }

  // ── 4. Chart view mode ─────────────────────────────────────────────
  for (const entry of VIEW_MODE_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const names = { trading: 'Trading', xChart: 'Chart Overlay', xBubbles: 'X Bubbles' }
        return { action: 'chartViewMode', value: entry.mode, label: `View: ${names[entry.mode]}` }
      }
    }
  }

  // ── 5. Line color ─────────────────────────────────────────────────
  for (const entry of LINE_COLOR_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        return { action: 'lineColor', value: entry.color, label: `Color: ${entry.color.charAt(0).toUpperCase() + entry.color.slice(1)}` }
      }
    }
  }

  // ── 6. Indicators — remove first (higher priority), then add ────
  // Clear all indicators
  for (const p of INDICATOR_CLEAR_PATTERNS) {
    if (text.includes(p)) {
      return { action: 'clearIndicators', value: true, label: 'Clear Indicators' }
    }
  }
  // Remove specific indicator
  for (const entry of INDICATOR_REMOVE_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const labels = { ema9: 'EMA 9', ema21: 'EMA 21', ema50: 'EMA 50', ema200: 'EMA 200', sma20: 'SMA 20', sma50: 'SMA 50', sma200: 'SMA 200', bb: 'Bollinger Bands', vwap: 'VWAP' }
        return { action: 'removeIndicator', value: entry.key, label: `Remove ${labels[entry.key]}` }
      }
    }
  }
  // Add / toggle on indicator
  for (const entry of INDICATOR_ADD_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const labels = { ema9: 'EMA 9', ema21: 'EMA 21', ema50: 'EMA 50', ema200: 'EMA 200', sma20: 'SMA 20', sma50: 'SMA 50', sma200: 'SMA 200', bb: 'Bollinger Bands', vwap: 'VWAP' }
        return { action: 'addIndicator', value: entry.key, label: `Add ${labels[entry.key]}` }
      }
    }
  }

  // ── 7. Toggles ────────────────────────────────────────────────────
  for (const entry of TOGGLE_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const display = entry.action.replace('toggle', '').replace('exit', '').replace('enter', '').trim()
        return { action: entry.action, value: true, label: display || entry.action }
      }
    }
  }

  // ── 7. Y-axis mode ────────────────────────────────────────────────
  for (const entry of YAXIS_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        return { action: 'yAxisMode', value: entry.mode, label: entry.mode === 'mcap' ? 'Market Cap' : 'Price' }
      }
    }
  }

  // ── 8. Zoom ───────────────────────────────────────────────────────
  for (const entry of ZOOM_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const labels = { zoomIn: 'Zoom In', zoomOut: 'Zoom Out', resetZoom: 'Reset' }
        return { action: entry.action, value: true, label: labels[entry.action] }
      }
    }
  }

  // ── 9. Pan / scroll ───────────────────────────────────────────────
  for (const entry of PAN_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const labels = { scrollLeft: 'Scroll Left', scrollRight: 'Scroll Right' }
        return { action: entry.action, value: true, label: labels[entry.action] }
      }
    }
  }

  // ── 10. X Bubbles controls ────────────────────────────────────────
  for (const entry of BUBBLES_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        const labels = { set3D: '3D Mode', set2D: '2D Mode', resetCamera: 'Reset Camera' }
        return { action: entry.action, value: true, label: labels[entry.action] }
      }
    }
  }

  // ── 11. Auto-fit ──────────────────────────────────────────────────
  for (const p of AUTOFIT_PATTERNS) {
    if (text.includes(p)) {
      return { action: 'autoFit', value: true, label: 'Auto Fit' }
    }
  }

  // ── 12. Token switching without trigger word (fallback, lower priority) ─
  for (const entry of TOKEN_VOICE_MAP) {
    for (const p of entry.patterns) {
      if (text.includes(p)) {
        return { action: 'symbolChange', value: entry.symbol, label: `Token: ${entry.symbol}` }
      }
    }
  }

  return null
}


/* ═══════════════════════════════════════════════════════════════════════════
   VOICE CONFIRMATION — ElevenLabs TTS → Web Speech API fallback
   ═══════════════════════════════════════════════════════════════════════════ */

const CONFIRM_PHRASES = {
  timeframe: (v) => {
    const names = { '1S': 'One second', '1M': 'One minute', '5M': 'Five minutes', '15M': 'Fifteen minutes', '1H': 'One hour', '4H': 'Four hours', '1D': 'Daily', '1W': 'Weekly' }
    return names[v] || v
  },
  chartType: (v) => {
    const names = { candles: 'Candlestick chart', line: 'Line chart', tradingview: 'TradingView' }
    return names[v] || v
  },
  chartViewMode: (v) => {
    const names = { trading: 'Trading mode', xChart: 'Chart overlay', xBubbles: 'X Bubbles' }
    return names[v] || v
  },
  symbolChange: (v) => `Switching to ${v}`,
  lineColor: (v) => `${v.charAt(0).toUpperCase() + v.slice(1)} color`,
  toggleHeatmap: () => 'Heatmap',
  toggleATH: () => 'All-time high',
  toggleFullscreen: () => 'Fullscreen',
  exitFullscreen: () => 'Exit fullscreen',
  yAxisMode: (v) => v === 'mcap' ? 'Market cap' : 'Price mode',
  zoomIn: () => 'Zooming in',
  zoomOut: () => 'Zooming out',
  resetZoom: () => 'Reset',
  scrollLeft: () => 'Scrolling back',
  scrollRight: () => 'Latest',
  set3D: () => '3D mode',
  set2D: () => '2D mode',
  resetCamera: () => 'Camera reset',
  autoFit: () => 'Auto fit',
  addIndicator: (v) => {
    const names = { ema9: 'EMA 9', ema21: 'EMA 21', ema50: 'EMA 50', ema200: 'EMA 200', sma20: 'SMA 20', sma50: 'SMA 50', sma200: 'SMA 200', bb: 'Bollinger Bands', vwap: 'VWAP' }
    return names[v] || v
  },
  removeIndicator: (v) => {
    const names = { ema9: 'EMA 9', ema21: 'EMA 21', ema50: 'EMA 50', ema200: 'EMA 200', sma20: 'SMA 20', sma50: 'SMA 50', sma200: 'SMA 200', bb: 'Bollinger Bands', vwap: 'VWAP' }
    return `Remove ${names[v] || v}`
  },
  clearIndicators: () => 'Indicators cleared',
}

const speakingAudioRef = { current: null }

/** Speak confirmation text. Returns a promise that resolves when audio finishes. */
function speakConfirmation(text) {
  if (speakingAudioRef.current) {
    speakingAudioRef.current.pause()
    speakingAudioRef.current = null
  }

  return fetch('/api/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
    .then((res) => {
      if (!res.ok) return res.json().catch(() => null).then((body) => {
        if (body?.fallback !== 'webspeech') return
        throw new Error('fallback')
      })
      return res.blob().then((blob) => {
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        speakingAudioRef.current = audio
        audio.volume = 0.7
        return new Promise((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); speakingAudioRef.current = null; resolve() }
          audio.onerror = () => { URL.revokeObjectURL(url); speakingAudioRef.current = null; resolve() }
          audio.play().catch(resolve)
        })
      })
    })
    .catch(() => {
      // Network error or webspeech fallback
      if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve()
      window.speechSynthesis.cancel()
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = 1.1
        utterance.pitch = 0.95
        utterance.volume = 0.7
        utterance.lang = 'en-US'
        utterance.onend = resolve
        utterance.onerror = resolve
        window.speechSynthesis.speak(utterance)
        // Safety timeout — some browsers never fire onend
        setTimeout(resolve, 4000)
      })
    })
}


/* ═══════════════════════════════════════════════════════════════════════════
   HOOK
   ═══════════════════════════════════════════════════════════════════════════ */

const SILENCE_TIMEOUT = 8000
const COMMAND_DISPLAY_DURATION = 2500
const MAX_NO_SPEECH_RETRIES = 3

const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null

export default function useChartVoiceControl({
  onTimeframe,
  onChartType,
  onChartViewMode,
  onSymbolChange,
  onLineColor,
  onToggleHeatmap,
  onToggleATH,
  onToggleFullscreen,
  onExitFullscreen,
  onYAxisMode,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onScrollLeft,
  onScrollRight,
  onSet3D,
  onSet2D,
  onResetCamera,
  onAutoFit,
  onAddIndicator,
  onRemoveIndicator,
  onClearIndicators,
} = {}) {
  const [isListening, setIsListening] = useState(false)
  const [lastCommand, setLastCommand] = useState(null)

  const recognitionRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const clearCommandTimerRef = useRef(null)
  const noSpeechRetriesRef = useRef(0)
  const stoppingRef = useRef(false)

  const isSupported = !!SpeechRecognition

  /* ── Dispatch ──────────────────────────────────────────────────────── */
  const dispatchCommand = useCallback(
    (cmd) => {
      switch (cmd.action) {
        case 'timeframe':        onTimeframe?.(cmd.value);      break
        case 'chartType':        onChartType?.(cmd.value);      break
        case 'chartViewMode':    onChartViewMode?.(cmd.value);  break
        case 'symbolChange':     onSymbolChange?.(cmd.value);   break
        case 'lineColor':        onLineColor?.(cmd.value);      break
        case 'toggleHeatmap':    onToggleHeatmap?.();           break
        case 'toggleATH':        onToggleATH?.();               break
        case 'toggleFullscreen': onToggleFullscreen?.();        break
        case 'exitFullscreen':   onExitFullscreen?.();          break
        case 'yAxisMode':        onYAxisMode?.(cmd.value);      break
        case 'zoomIn':           onZoomIn?.();                  break
        case 'zoomOut':          onZoomOut?.();                 break
        case 'resetZoom':        onResetZoom?.();               break
        case 'scrollLeft':       onScrollLeft?.();              break
        case 'scrollRight':      onScrollRight?.();             break
        case 'set3D':            onSet3D?.();                   break
        case 'set2D':            onSet2D?.();                   break
        case 'resetCamera':      onResetCamera?.();             break
        case 'autoFit':          onAutoFit?.();                 break
        case 'addIndicator':     onAddIndicator?.(cmd.value);   break
        case 'removeIndicator':  onRemoveIndicator?.(cmd.value); break
        case 'clearIndicators':  onClearIndicators?.();         break
        default: break
      }
    },
    [onTimeframe, onChartType, onChartViewMode, onSymbolChange, onLineColor,
     onToggleHeatmap, onToggleATH, onToggleFullscreen, onExitFullscreen,
     onYAxisMode, onZoomIn, onZoomOut, onResetZoom,
     onScrollLeft, onScrollRight, onSet3D, onSet2D, onResetCamera, onAutoFit,
     onAddIndicator, onRemoveIndicator, onClearIndicators],
  )

  /* ── Silence timer ─────────────────────────────────────────────────── */
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer()
    silenceTimerRef.current = setTimeout(() => {
      recognitionRef.current?.stop()
      stoppingRef.current = true
      setIsListening(false)
    }, SILENCE_TIMEOUT)
  }, [clearSilenceTimer])

  /* ── Start recognition ─────────────────────────────────────────────── */
  const startRecognition = useCallback(() => {
    if (!SpeechRecognition) return

    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* noop */ }
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript
      const cmd = parseCommand(transcript)

      if (cmd) {
        setLastCommand({ text: transcript, action: cmd.label, timestamp: Date.now() })
        dispatchCommand(cmd)

        // Stop recognition while TTS speaks to prevent feedback loop.
        // stoppingRef prevents onend from auto-restarting.
        stoppingRef.current = true
        try { recognition.stop() } catch { /* noop */ }

        const phraseFn = CONFIRM_PHRASES[cmd.action]
        const confirmText = phraseFn ? phraseFn(cmd.value) : null

        // Speak confirmation, then resume listening
        const resume = () => {
          if (clearCommandTimerRef.current) clearTimeout(clearCommandTimerRef.current)
          clearCommandTimerRef.current = setTimeout(() => setLastCommand(null), COMMAND_DISPLAY_DURATION)
          // Restart recognition after TTS finishes + small buffer
          setTimeout(() => {
            stoppingRef.current = false
            if (!recognitionRef.current) return
            try {
              recognition.start()
              resetSilenceTimer()
            } catch {
              setIsListening(false)
              clearSilenceTimer()
            }
          }, 300)
        }

        if (confirmText) {
          speakConfirmation(confirmText).then(resume)
        } else {
          resume()
        }
      }

      noSpeechRetriesRef.current = 0
    }

    recognition.onend = () => {
      if (stoppingRef.current) {
        // Stopped intentionally (during TTS) — don't restart, resume handler will do it
        setIsListening((prev) => prev) // keep current state
        return
      }
      try {
        recognition.start()
        resetSilenceTimer()
      } catch {
        setIsListening(false)
        clearSilenceTimer()
      }
    }

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        noSpeechRetriesRef.current += 1
        if (noSpeechRetriesRef.current >= MAX_NO_SPEECH_RETRIES) {
          stoppingRef.current = true
          try { recognition.stop() } catch { /* noop */ }
          setIsListening(false)
          clearSilenceTimer()
        }
        return
      }
      if (event.error === 'aborted') return
      stoppingRef.current = true
      setIsListening(false)
      clearSilenceTimer()
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
      stoppingRef.current = false
      noSpeechRetriesRef.current = 0
      setIsListening(true)
      resetSilenceTimer()
    } catch {
      setIsListening(false)
    }
  }, [dispatchCommand, resetSilenceTimer, clearSilenceTimer])

  /* ── Public API ────────────────────────────────────────────────────── */
  const stopVoice = useCallback(() => {
    stoppingRef.current = true
    clearSilenceTimer()
    if (clearCommandTimerRef.current) {
      clearTimeout(clearCommandTimerRef.current)
      clearCommandTimerRef.current = null
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* noop */ }
    }
    setIsListening(false)
  }, [clearSilenceTimer])

  const toggleVoice = useCallback(() => {
    if (isListening) stopVoice()
    else startRecognition()
  }, [isListening, stopVoice, startRecognition])

  /* ── Cleanup ───────────────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      stoppingRef.current = true
      if (recognitionRef.current) { try { recognitionRef.current.abort() } catch { /* noop */ } }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      if (clearCommandTimerRef.current) clearTimeout(clearCommandTimerRef.current)
      if (speakingAudioRef.current) { speakingAudioRef.current.pause(); speakingAudioRef.current = null }
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    }
  }, [])

  return { isListening, isSupported, lastCommand, toggleVoice, stopVoice }
}
