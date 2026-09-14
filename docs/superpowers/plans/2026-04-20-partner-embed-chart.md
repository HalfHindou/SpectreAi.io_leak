# Partner Embed Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public iframe-embeddable price chart at `/embed/chart/:cgId` with Line/Candle/TradingView modes, brush range slider, Apple Cinematic dark styling, served from the research app.

**Architecture:** Standalone React route outside `AppShell` and `AuthGate`. CoinGecko as sole data source, proxied through existing `/api/coingecko/*` → `cg-proxy.js` (no server changes). Chart renders via native 2D canvas for Line/Candle (matches existing codebase pattern) and a TradingView `widgetembed` iframe for the TV mode. Data preloaded at mount (`days=1` for instant paint + `days=90` in background for cached timeframe switching). Range slider drives a "viewport" sub-window of the timeframe dataset — chart rerenders from memory on every drag.

**Tech Stack:** React 18, Vite, JS/JSX (no TypeScript), plain CSS, native 2D canvas, CoinGecko `/market_chart` + `/ohlc` endpoints.

---

## Pre-flight Notes (read before starting)

- **No test infrastructure in research app.** CLAUDE.md: "No test files in either app." Verification in this plan is: `npm run build:research` for compile safety + dev server + Playwright MCP for smoke tests. Do NOT add vitest/jest to the research app.
- **CSS split convention.** Each component gets `{name}.jsx` + `{name}.css`. Mobile overrides live in `embed-chart.mobile.css`, not per-component. Day mode NOT required for this feature (dark only, per spec).
- **Import alias.** Use `@/` for cross-directory imports. Relative for siblings.
- **Numbers.** All price/time text uses `var(--font-mono)` (JetBrains Mono). This is the main app, NOT website2.
- **Commit cadence.** Commit after each task. Branch: `prod` (per research app git-workflow.md). Do NOT push until the final verification task passes.
- **Git branch.** Work on `prod`. Do NOT push to `main`.

---

## File Structure

```
apps/research/src/pages/embed-chart/
  index.jsx                          route wrapper, reads :cgId from useParams
  components/
    embed-chart.jsx                  main container, state orchestration
    embed-chart.css                  dark-only Apple Cinematic styles
    embed-chart.mobile.css           responsive breakpoints
    chart-toolbar.jsx                type segmented control + timeframe pills
    line-chart.jsx                   native canvas line chart + crosshair
    candle-chart.jsx                 native canvas OHLC candles
    tradingview-embed.jsx            TV widgetembed iframe wrapper
    range-slider.jsx                 brush slider (two handles + pannable window)
    use-embed-data.js                fetch + cache hook
    cg-to-binance.js                 CoinGecko ID → Binance symbol map (~50 entries)

apps/research/src/components/auth-gate.jsx    MODIFY: add '/embed' to PUBLIC_ROUTES
apps/research/src/App.jsx                     MODIFY: add <Route path="/embed/chart/:cgId">
```

No server changes — `cg-proxy.js` already passes through any CoinGecko subpath via its `cgpath` query param, including `coins/{id}/market_chart` and `coins/{id}/ohlc`.

---

## Task 1: Bypass AuthGate for `/embed/*` routes

**Files:**
- Modify: `apps/research/src/components/auth-gate.jsx:12`

- [ ] **Step 1: Add `/embed` to the public routes array**

Open `apps/research/src/components/auth-gate.jsx`, find line 12:

```js
const PUBLIC_ROUTES = ['/website', '/website2', '/newsroom']
```

Change to:

```js
const PUBLIC_ROUTES = ['/website', '/website2', '/newsroom', '/embed']
```

No other changes needed — `auth-gate.jsx:77` already uses `location.pathname.startsWith(r)`, so `/embed/chart/bitcoin` will match the `/embed` prefix.

- [ ] **Step 2: Verify build still passes**

Run: `npm run build:research`
Expected: build succeeds, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/components/auth-gate.jsx
git commit -m "feat(embed): bypass auth gate for /embed/* routes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CoinGecko ID → Binance symbol mapping

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/cg-to-binance.js`

- [ ] **Step 1: Create the mapping file**

```js
/**
 * CoinGecko ID → Binance symbol mapping for TradingView widget embedding.
 * Used by tradingview-embed.jsx to build the `symbol=BINANCE:XYZUSDT` URL param.
 * Only tokens with active Binance USDT spot pairs are listed. For tokens not in
 * this map, the TradingView mode is disabled in the UI.
 */
export const CG_TO_BINANCE = {
  bitcoin: 'BTCUSDT',
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
  binancecoin: 'BNBUSDT',
  ripple: 'XRPUSDT',
  cardano: 'ADAUSDT',
  dogecoin: 'DOGEUSDT',
  'avalanche-2': 'AVAXUSDT',
  chainlink: 'LINKUSDT',
  polkadot: 'DOTUSDT',
  'matic-network': 'MATICUSDT',
  litecoin: 'LTCUSDT',
  'bitcoin-cash': 'BCHUSDT',
  tron: 'TRXUSDT',
  stellar: 'XLMUSDT',
  'ethereum-classic': 'ETCUSDT',
  monero: 'XMRUSDT',
  cosmos: 'ATOMUSDT',
  aptos: 'APTUSDT',
  arbitrum: 'ARBUSDT',
  optimism: 'OPUSDT',
  sui: 'SUIUSDT',
  'near': 'NEARUSDT',
  filecoin: 'FILUSDT',
  'internet-computer': 'ICPUSDT',
  'hedera-hashgraph': 'HBARUSDT',
  vechain: 'VETUSDT',
  'injective-protocol': 'INJUSDT',
  'the-graph': 'GRTUSDT',
  aave: 'AAVEUSDT',
  uniswap: 'UNIUSDT',
  maker: 'MKRUSDT',
  'curve-dao-token': 'CRVUSDT',
  'lido-dao': 'LDOUSDT',
  'pepe': '1000PEPEUSDT',
  shiba-inu: 'SHIBUSDT',
  'bonk': 'BONKUSDT',
  'dogwifhat': 'WIFUSDT',
  'floki': 'FLOKIUSDT',
  render: 'RNDRUSDT',
  'fetch-ai': 'FETUSDT',
  immutable: 'IMXUSDT',
  'theta-token': 'THETAUSDT',
  algorand: 'ALGOUSDT',
  'sei-network': 'SEIUSDT',
  tia: 'TIAUSDT',
  'axie-infinity': 'AXSUSDT',
  'the-sandbox': 'SANDUSDT',
  decentraland: 'MANAUSDT',
  apecoin: 'APEUSDT',
}

export function getBinanceSymbol(cgId) {
  if (!cgId) return null
  return CG_TO_BINANCE[cgId.toLowerCase()] || null
}
```

- [ ] **Step 2: Verify file parses**

Run: `node -e "import('./apps/research/src/pages/embed-chart/components/cg-to-binance.js').then(m => console.log('entries:', Object.keys(m.CG_TO_BINANCE).length, 'BTC:', m.getBinanceSymbol('bitcoin')))"`
Expected: `entries: 50 BTC: BTCUSDT`

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/cg-to-binance.js
git commit -m "feat(embed): add CoinGecko → Binance symbol mapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Data hook with preload + cache

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/use-embed-data.js`

- [ ] **Step 1: Create the data hook**

```js
/**
 * useEmbedData
 * Fetches CoinGecko chart data for the embed page. Implements the preload
 * strategy from the spec: days=1 (5-min line) is shown instantly while
 * days=90 (hourly line) is fetched in parallel for cached 7D/1M/3M slicing.
 * 1Y and candle data are fetched on demand.
 *
 * Returns:
 *   { lineSeries, candleSeries, loading, error, refetch }
 *
 * `lineSeries` and `candleSeries` are sliced to match the active timeframe.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const CG = '/api/coingecko'

// Day window per timeframe key
export const TIMEFRAMES = {
  '1D': { days: 1,   ohlcDays: 1   },
  '7D': { days: 7,   ohlcDays: 7   },
  '1M': { days: 30,  ohlcDays: 30  },
  '3M': { days: 90,  ohlcDays: 90  },
  '1Y': { days: 365, ohlcDays: 365 },
}

async function fetchJSON(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`CG ${res.status}`)
  return res.json()
}

export function useEmbedData(cgId, timeframe, chartType) {
  const [lineSeries, setLineSeries] = useState([])
  const [candleSeries, setCandleSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // In-memory caches keyed by days window
  const lineCache = useRef(new Map())   // days → [{t, v}]
  const candleCache = useRef(new Map()) // days → [{t, o, h, l, c}]

  const abortRef = useRef(null)

  const loadLine = useCallback(async (days, signal) => {
    if (lineCache.current.has(days)) return lineCache.current.get(days)
    const url = `${CG}/coins/${cgId}/market_chart?vs_currency=usd&days=${days}`
    const data = await fetchJSON(url, signal)
    const series = (data?.prices || []).map(([t, v]) => ({ t, v }))
    lineCache.current.set(days, series)
    return series
  }, [cgId])

  const loadCandles = useCallback(async (days, signal) => {
    if (candleCache.current.has(days)) return candleCache.current.get(days)
    const url = `${CG}/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`
    const data = await fetchJSON(url, signal)
    const series = Array.isArray(data)
      ? data.map(([t, o, h, l, c]) => ({ t, o, h, l, c }))
      : []
    candleCache.current.set(days, series)
    return series
  }, [cgId])

  // On cgId change, reset caches and preload 1D + 90D line in parallel
  useEffect(() => {
    if (!cgId) return
    lineCache.current.clear()
    candleCache.current.clear()
    setLoading(true)
    setError(null)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    // Fire in parallel; resolve 1D first for instant paint.
    const p1 = loadLine(1, signal)
    const p90 = loadLine(90, signal)

    p1.then(series => {
      if (signal.aborted) return
      // Only paint immediately if user is still on 1D or on a cached-from-90 timeframe (handled below).
      setLineSeries(prev => (timeframe === '1D' ? series : prev))
      setLoading(false)
    }).catch(err => {
      if (err.name === 'AbortError') return
      setError(err.message || 'Failed to load')
      setLoading(false)
    })

    // p90 just warms the cache; the timeframe effect below will paint from it.
    p90.catch(() => { /* cache miss is handled by on-demand fetch in timeframe effect */ })

    return () => { abortRef.current?.abort() }
  }, [cgId, loadLine])

  // Paint series for the active timeframe+chartType
  useEffect(() => {
    if (!cgId) return
    const { days, ohlcDays } = TIMEFRAMES[timeframe] || TIMEFRAMES['1D']
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    let cancelled = false

    async function paint() {
      try {
        if (chartType === 'candle') {
          setLoading(!candleCache.current.has(ohlcDays))
          const series = await loadCandles(ohlcDays, signal)
          if (cancelled) return
          setCandleSeries(series)
        } else {
          // For line, prefer hourly-90d cache and slice when possible.
          if ((days === 7 || days === 30 || days === 90) && lineCache.current.has(90)) {
            const full = lineCache.current.get(90)
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
            setLineSeries(full.filter(p => p.t >= cutoff))
          } else {
            setLoading(!lineCache.current.has(days))
            const series = await loadLine(days, signal)
            if (cancelled) return
            setLineSeries(series)
          }
        }
        setLoading(false)
        setError(null)
      } catch (err) {
        if (err.name === 'AbortError') return
        if (!cancelled) {
          setError(err.message || 'Failed to load')
          setLoading(false)
        }
      }
    }
    paint()

    return () => { cancelled = true }
  }, [cgId, timeframe, chartType, loadLine, loadCandles])

  const refetch = useCallback(() => {
    lineCache.current.clear()
    candleCache.current.clear()
    // Trigger a re-run of the cgId effect
    setLoading(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current
    const days = TIMEFRAMES[timeframe]?.days ?? 1
    const ohlcDays = TIMEFRAMES[timeframe]?.ohlcDays ?? 1
    if (chartType === 'candle') {
      loadCandles(ohlcDays, signal).then(setCandleSeries).catch(e => setError(e.message))
    } else {
      loadLine(days, signal).then(setLineSeries).catch(e => setError(e.message))
    }
  }, [timeframe, chartType, loadLine, loadCandles])

  return { lineSeries, candleSeries, loading, error, refetch }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/use-embed-data.js
git commit -m "feat(embed): add data hook with preload + timeframe cache

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Line chart (native canvas)

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/line-chart.jsx`

- [ ] **Step 1: Create the line chart component**

```jsx
/**
 * LineChart — native 2D canvas line chart for the embed.
 * Props:
 *   data:  Array<{ t: number, v: number }>  - full series
 *   range: { start: number, end: number }   - normalized [0,1] viewport
 * Renders a smooth line + gradient fill, with a hover crosshair.
 * Color: --bull if last > first within viewport, else --bear.
 */
import { useEffect, useRef, useState } from 'react'

function formatPrice(v) {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (v >= 1)    return `$${v.toFixed(2)}`
  if (v >= 0.01) return `$${v.toFixed(4)}`
  return `$${v.toPrecision(4)}`
}

function formatTime(ms) {
  const d = new Date(ms)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function LineChart({ data, range = { start: 0, end: 1 } }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null) // { x, y, point }

  // Slice data to viewport
  const sliced = (() => {
    if (!data?.length) return []
    const i0 = Math.max(0, Math.floor(range.start * (data.length - 1)))
    const i1 = Math.min(data.length - 1, Math.ceil(range.end * (data.length - 1)))
    return data.slice(i0, i1 + 1)
  })()

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)

      if (sliced.length < 2) return

      // Scales
      let min = Infinity, max = -Infinity
      for (const p of sliced) { if (p.v < min) min = p.v; if (p.v > max) max = p.v }
      const pad = (max - min) * 0.06 || max * 0.01
      min -= pad; max += pad
      const xAt = (i) => (i / (sliced.length - 1)) * w
      const yAt = (v) => h - ((v - min) / (max - min)) * h

      const isUp = sliced[sliced.length - 1].v >= sliced[0].v
      const color = isUp
        ? getComputedStyle(document.documentElement).getPropertyValue('--bull').trim() || '#10B981'
        : getComputedStyle(document.documentElement).getPropertyValue('--bear').trim() || '#EF4444'

      // Gradient fill
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, `${color}33`)
      grad.addColorStop(1, `${color}00`)
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let i = 0; i < sliced.length; i++) ctx.lineTo(xAt(i), yAt(sliced[i].v))
      ctx.lineTo(w, h)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()

      // Stroke
      ctx.beginPath()
      for (let i = 0; i < sliced.length; i++) {
        const x = xAt(i), y = yAt(sliced[i].v)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.lineWidth = 1.5
      ctx.strokeStyle = color
      ctx.stroke()

      // Crosshair
      if (hover?.point) {
        const { x, y } = hover
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
        ctx.fillStyle = color
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [sliced, hover])

  const onMove = (e) => {
    const canvas = canvasRef.current
    if (!canvas || sliced.length < 2) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const i = Math.round((x / rect.width) * (sliced.length - 1))
    const p = sliced[Math.max(0, Math.min(sliced.length - 1, i))]
    let min = Infinity, max = -Infinity
    for (const q of sliced) { if (q.v < min) min = q.v; if (q.v > max) max = q.v }
    const pad = (max - min) * 0.06 || max * 0.01
    min -= pad; max += pad
    const y = rect.height - ((p.v - min) / (max - min)) * rect.height
    setHover({ x: (i / (sliced.length - 1)) * rect.width, y, point: p })
  }

  const onLeave = () => setHover(null)

  return (
    <div ref={wrapRef} className="embed-line-wrap" onMouseMove={onMove} onMouseLeave={onLeave}>
      <canvas ref={canvasRef} className="embed-line-canvas" />
      {hover?.point ? (
        <div className="embed-crosshair-readout mono">
          <span>{formatPrice(hover.point.v)}</span>
          <span className="embed-crosshair-sep">•</span>
          <span>{formatTime(hover.point.t)}</span>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/line-chart.jsx
git commit -m "feat(embed): add canvas line chart with crosshair

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Candle chart (native canvas)

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/candle-chart.jsx`

- [ ] **Step 1: Create the candle chart component**

```jsx
/**
 * CandleChart — native 2D canvas OHLC candles for the embed.
 * Props:
 *   data:  Array<{ t, o, h, l, c }>
 *   range: { start: number, end: number }  - normalized [0,1] viewport
 * Candle body: --bull if c >= o, else --bear. Wick same color.
 */
import { useEffect, useRef, useState } from 'react'

function formatPrice(v) {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (v >= 1)    return `$${v.toFixed(2)}`
  if (v >= 0.01) return `$${v.toFixed(4)}`
  return `$${v.toPrecision(4)}`
}

function formatTime(ms) {
  const d = new Date(ms)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function CandleChart({ data, range = { start: 0, end: 1 } }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)

  const sliced = (() => {
    if (!data?.length) return []
    const i0 = Math.max(0, Math.floor(range.start * (data.length - 1)))
    const i1 = Math.min(data.length - 1, Math.ceil(range.end * (data.length - 1)))
    return data.slice(i0, i1 + 1)
  })()

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const w = rect.width, h = rect.height
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)

      if (sliced.length < 1) return

      let min = Infinity, max = -Infinity
      for (const c of sliced) { if (c.l < min) min = c.l; if (c.h > max) max = c.h }
      const pad = (max - min) * 0.06 || max * 0.01
      min -= pad; max += pad

      const n = sliced.length
      const slot = w / n
      const cw = Math.max(1, Math.min(12, slot * 0.7))
      const yAt = (v) => h - ((v - min) / (max - min)) * h

      const bullColor = getComputedStyle(document.documentElement).getPropertyValue('--bull').trim() || '#10B981'
      const bearColor = getComputedStyle(document.documentElement).getPropertyValue('--bear').trim() || '#EF4444'

      for (let i = 0; i < n; i++) {
        const c = sliced[i]
        const cx = i * slot + slot / 2
        const isUp = c.c >= c.o
        const color = isUp ? bullColor : bearColor
        ctx.strokeStyle = color
        ctx.fillStyle = color
        // Wick
        ctx.beginPath()
        ctx.moveTo(cx, yAt(c.h))
        ctx.lineTo(cx, yAt(c.l))
        ctx.lineWidth = 1
        ctx.stroke()
        // Body
        const yo = yAt(c.o), yc = yAt(c.c)
        const top = Math.min(yo, yc)
        const height = Math.max(1, Math.abs(yo - yc))
        ctx.fillRect(cx - cw / 2, top, cw, height)
      }

      if (hover?.point) {
        const { x } = hover
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [sliced, hover])

  const onMove = (e) => {
    const canvas = canvasRef.current
    if (!canvas || sliced.length < 1) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const slot = rect.width / sliced.length
    const i = Math.max(0, Math.min(sliced.length - 1, Math.floor(x / slot)))
    const p = sliced[i]
    const cx = i * slot + slot / 2
    setHover({ x: cx, point: p })
  }
  const onLeave = () => setHover(null)

  return (
    <div ref={wrapRef} className="embed-candle-wrap" onMouseMove={onMove} onMouseLeave={onLeave}>
      <canvas ref={canvasRef} className="embed-candle-canvas" />
      {hover?.point ? (
        <div className="embed-crosshair-readout mono">
          <span>O {formatPrice(hover.point.o)}</span>
          <span>H {formatPrice(hover.point.h)}</span>
          <span>L {formatPrice(hover.point.l)}</span>
          <span>C {formatPrice(hover.point.c)}</span>
          <span className="embed-crosshair-sep">•</span>
          <span>{formatTime(hover.point.t)}</span>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/candle-chart.jsx
git commit -m "feat(embed): add canvas candle chart with OHLC hover readout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: TradingView iframe embed

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/tradingview-embed.jsx`

- [ ] **Step 1: Create the TV embed component**

```jsx
/**
 * TradingViewEmbed — iframe wrapper around s.tradingview.com/widgetembed.
 * Props:
 *   binanceSymbol: string | null   (e.g. 'BTCUSDT'). If null, shows disabled msg.
 *   interval:      string          TV interval code: '60', '240', 'D', 'W'
 * Uses URL params supported by TV's widgetembed. Dark theme, hidden toolbar
 * side panel, allow drawing + studies.
 */
export default function TradingViewEmbed({ binanceSymbol, interval = '60' }) {
  if (!binanceSymbol) {
    return (
      <div className="embed-tv-unavailable">
        <p>TradingView view is not available for this token.</p>
        <p className="embed-tv-unavailable-hint">Use Line or Candle mode instead.</p>
      </div>
    )
  }

  const symbol = `BINANCE:${binanceSymbol}`
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: 'dark',
    style: '1',          // candles
    timezone: 'Etc/UTC',
    withdateranges: '1',
    hide_side_toolbar: '0',
    allow_symbol_change: '0',
    save_image: '0',
    studies: '[]',
    locale: 'en',
    utm_source: 'spectre-embed',
    utm_medium: 'widget',
  })
  const src = `https://s.tradingview.com/widgetembed/?${params.toString()}`

  return (
    <iframe
      title={`TradingView ${symbol}`}
      src={src}
      className="embed-tv-iframe"
      allowFullScreen
      allow="clipboard-write"
      frameBorder="0"
    />
  )
}

/** Map our timeframe key → TradingView interval code. */
export function timeframeToTVInterval(tf) {
  switch (tf) {
    case '1D': return '15'
    case '7D': return '60'
    case '1M': return '240'
    case '3M': return 'D'
    case '1Y': return 'W'
    default:   return '60'
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/tradingview-embed.jsx
git commit -m "feat(embed): add TradingView widgetembed iframe

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Range slider (brush)

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/range-slider.jsx`

- [ ] **Step 1: Create the slider component**

```jsx
/**
 * RangeSlider — brush-style range selector for chart viewport.
 * Controlled component. Value is a normalized { start, end } in [0,1].
 *
 * Interactions:
 *   - Drag left handle  → resize window from left
 *   - Drag right handle → resize window from right
 *   - Drag window body  → pan window (preserving width)
 *   - Double-click      → reset to { start: 0, end: 1 }
 *
 * Props:
 *   value:    { start, end }
 *   onChange: (next) => void
 *   min:      minimum window width (default 0.02 — 2% of range)
 *   ticks:    number - decorative tick count (default 60)
 *   labels:   Array<{ pos: number, text: string }> - optional date labels 0..1
 */
import { useCallback, useEffect, useRef } from 'react'

const MIN_WINDOW = 0.02

export default function RangeSlider({
  value,
  onChange,
  min = MIN_WINDOW,
  ticks = 60,
  labels = [],
}) {
  const trackRef = useRef(null)
  const dragRef = useRef(null) // { mode: 'left'|'right'|'pan', startX, startStart, startEnd }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  const onPointerDown = (mode) => (e) => {
    e.preventDefault()
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    dragRef.current = {
      mode,
      trackLeft: rect.left,
      trackWidth: rect.width,
      startX: e.clientX,
      startStart: value.start,
      startEnd: value.end,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  const onPointerMove = useCallback((e) => {
    const s = dragRef.current
    if (!s) return
    const dx = (e.clientX - s.startX) / s.trackWidth
    let nextStart = s.startStart
    let nextEnd = s.startEnd
    if (s.mode === 'left') {
      nextStart = clamp(s.startStart + dx, 0, s.startEnd - min)
    } else if (s.mode === 'right') {
      nextEnd = clamp(s.startEnd + dx, s.startStart + min, 1)
    } else {
      const width = s.startEnd - s.startStart
      let ns = clamp(s.startStart + dx, 0, 1 - width)
      nextStart = ns
      nextEnd = ns + width
    }
    onChange({ start: nextStart, end: nextEnd })
  }, [min, onChange])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
  }, [onPointerMove])

  const onDoubleClick = () => onChange({ start: 0, end: 1 })

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
  }, [onPointerMove])

  const leftPct = `${value.start * 100}%`
  const widthPct = `${(value.end - value.start) * 100}%`

  return (
    <div className="embed-slider">
      <div
        ref={trackRef}
        className="embed-slider-track"
        onDoubleClick={onDoubleClick}
      >
        <div className="embed-slider-ticks" aria-hidden>
          {Array.from({ length: ticks }).map((_, i) => (
            <span key={i} className="embed-slider-tick" style={{ left: `${(i / (ticks - 1)) * 100}%` }} />
          ))}
        </div>
        <div
          className="embed-slider-window"
          style={{ left: leftPct, width: widthPct }}
          onPointerDown={onPointerDown('pan')}
        >
          <span
            className="embed-slider-handle embed-slider-handle--left"
            onPointerDown={(e) => { e.stopPropagation(); onPointerDown('left')(e) }}
            aria-label="Resize window from left"
          />
          <span
            className="embed-slider-handle embed-slider-handle--right"
            onPointerDown={(e) => { e.stopPropagation(); onPointerDown('right')(e) }}
            aria-label="Resize window from right"
          />
        </div>
      </div>
      {labels.length > 0 ? (
        <div className="embed-slider-labels mono">
          {labels.map((l, i) => (
            <span key={i} className="embed-slider-label" style={{ left: `${l.pos * 100}%` }}>{l.text}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/range-slider.jsx
git commit -m "feat(embed): add brush range slider

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Chart toolbar (type toggle + timeframe pills)

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/chart-toolbar.jsx`

- [ ] **Step 1: Create the toolbar component**

```jsx
/**
 * ChartToolbar — top bar: segmented type control (left) + timeframe pills (right).
 * Props:
 *   chartType, onChartType   ('line' | 'candle' | 'tv')
 *   timeframe, onTimeframe   ('1D' | '7D' | '1M' | '3M' | '1Y')
 *   tvAvailable              boolean — disables TV button when false
 */
const TIMEFRAMES = ['1D', '7D', '1M', '3M', '1Y']

export default function ChartToolbar({
  chartType, onChartType,
  timeframe, onTimeframe,
  tvAvailable,
}) {
  return (
    <div className="embed-toolbar">
      <div className="embed-toolbar-types" role="tablist" aria-label="Chart type">
        <button
          type="button"
          role="tab"
          className={`embed-type-btn${chartType === 'line' ? ' embed-type-btn--active' : ''}`}
          onClick={() => onChartType('line')}
          aria-selected={chartType === 'line'}
        >Line</button>
        <button
          type="button"
          role="tab"
          className={`embed-type-btn${chartType === 'candle' ? ' embed-type-btn--active' : ''}`}
          onClick={() => onChartType('candle')}
          aria-selected={chartType === 'candle'}
        >Candle</button>
        <button
          type="button"
          role="tab"
          className={`embed-type-btn${chartType === 'tv' ? ' embed-type-btn--active' : ''}`}
          onClick={() => tvAvailable && onChartType('tv')}
          aria-selected={chartType === 'tv'}
          disabled={!tvAvailable}
          title={tvAvailable ? 'TradingView' : 'Not available for this token'}
        >TV</button>
      </div>
      <div className="embed-toolbar-timeframes" role="tablist" aria-label="Timeframe">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            type="button"
            role="tab"
            className={`embed-tf-btn${timeframe === tf ? ' embed-tf-btn--active' : ''}`}
            onClick={() => onTimeframe(tf)}
            aria-selected={timeframe === tf}
          >{tf}</button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/chart-toolbar.jsx
git commit -m "feat(embed): add toolbar (type + timeframe)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Main container (`embed-chart.jsx`)

**Files:**
- Create: `apps/research/src/pages/embed-chart/components/embed-chart.jsx`

- [ ] **Step 1: Create the main container**

```jsx
/**
 * EmbedChart — orchestrates toolbar, chart body, and range slider.
 * Props:
 *   cgId: string (CoinGecko ID from the :cgId route param)
 *
 * State:
 *   chartType: 'line' | 'candle' | 'tv'
 *   timeframe: '1D' | '7D' | '1M' | '3M' | '1Y'
 *   range:     { start, end } in [0,1]
 *
 * Range resets to { 0, 1 } whenever timeframe changes.
 * Range is hidden when chartType === 'tv' (TV handles its own time control).
 * Mouse wheel on chart body zooms `range` around cursor x.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import ChartToolbar from './chart-toolbar'
import LineChart from './line-chart'
import CandleChart from './candle-chart'
import TradingViewEmbed, { timeframeToTVInterval } from './tradingview-embed'
import RangeSlider from './range-slider'
import { useEmbedData } from './use-embed-data'
import { getBinanceSymbol } from './cg-to-binance'
import './embed-chart.css'
import './embed-chart.mobile.css'

function monthLabels(startMs, endMs) {
  const out = []
  const d = new Date(startMs)
  d.setDate(1); d.setHours(0, 0, 0, 0)
  while (d.getTime() <= endMs) {
    const pos = (d.getTime() - startMs) / (endMs - startMs)
    if (pos >= 0 && pos <= 1) {
      out.push({ pos, text: d.toLocaleString(undefined, { month: 'short' }) })
    }
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export default function EmbedChart({ cgId }) {
  const [chartType, setChartType] = useState('line')
  const [timeframe, setTimeframe] = useState('1D')
  const [range, setRange] = useState({ start: 0, end: 1 })

  const { lineSeries, candleSeries, loading, error, refetch } = useEmbedData(cgId, timeframe, chartType)

  const binanceSymbol = useMemo(() => getBinanceSymbol(cgId), [cgId])
  const tvAvailable = !!binanceSymbol

  // If TV becomes unavailable while selected, drop back to line
  useEffect(() => {
    if (chartType === 'tv' && !tvAvailable) setChartType('line')
  }, [chartType, tvAvailable])

  // Reset viewport on timeframe change
  useEffect(() => {
    setRange({ start: 0, end: 1 })
  }, [timeframe, chartType])

  // Wheel/pinch zoom on chart body → adjust range around cursor
  const bodyRef = useRef(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e) => {
      if (chartType === 'tv') return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const xFrac = (e.clientX - rect.left) / rect.width
      const center = range.start + xFrac * (range.end - range.start)
      const factor = Math.exp(e.deltaY * 0.0015) // up = zoom in
      let width = (range.end - range.start) * factor
      width = Math.min(1, Math.max(0.02, width))
      let start = center - xFrac * width
      let end = start + width
      if (start < 0) { start = 0; end = width }
      if (end > 1) { end = 1; start = 1 - width }
      setRange({ start, end })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [range, chartType])

  // Slider labels from the active series (line used as time axis when candles empty)
  const sliderLabels = useMemo(() => {
    const src = chartType === 'candle' ? candleSeries : lineSeries
    if (!src?.length) return []
    const t0 = src[0].t
    const t1 = src[src.length - 1].t
    if (!t0 || !t1 || t1 <= t0) return []
    return monthLabels(t0, t1).slice(0, 5)
  }, [chartType, lineSeries, candleSeries])

  const activeSeries = chartType === 'candle' ? candleSeries : lineSeries
  const hasData = (activeSeries?.length ?? 0) > 0

  return (
    <div className="embed-chart-root">
      <ChartToolbar
        chartType={chartType}
        onChartType={setChartType}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        tvAvailable={tvAvailable}
      />

      <div ref={bodyRef} className="embed-chart-body">
        {error ? (
          <div className="embed-chart-error">
            <p>Unable to load chart data.</p>
            <button type="button" className="embed-retry-btn" onClick={refetch}>Tap to retry</button>
          </div>
        ) : loading && !hasData ? (
          <div className="embed-chart-skeleton animate-shimmer" aria-hidden />
        ) : chartType === 'tv' ? (
          <TradingViewEmbed binanceSymbol={binanceSymbol} interval={timeframeToTVInterval(timeframe)} />
        ) : chartType === 'candle' ? (
          <CandleChart data={candleSeries} range={range} />
        ) : (
          <LineChart data={lineSeries} range={range} />
        )}
      </div>

      {chartType !== 'tv' && hasData ? (
        <RangeSlider value={range} onChange={setRange} labels={sliderLabels} />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds (CSS files don't exist yet — we import them, but Vite will fail. Create empty CSS files first.)

Actually — run this first to create empty placeholders so the import resolves:

```bash
touch apps/research/src/pages/embed-chart/components/embed-chart.css
touch apps/research/src/pages/embed-chart/components/embed-chart.mobile.css
```

Then run `npm run build:research`. Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/embed-chart.jsx \
        apps/research/src/pages/embed-chart/components/embed-chart.css \
        apps/research/src/pages/embed-chart/components/embed-chart.mobile.css
git commit -m "feat(embed): add main EmbedChart container with wheel-zoom

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Apple Cinematic CSS (dark only)

**Files:**
- Modify: `apps/research/src/pages/embed-chart/components/embed-chart.css`

- [ ] **Step 1: Write the stylesheet**

```css
/* EmbedChart — Apple Cinematic, dark only, iframe-friendly. */

.embed-chart-root {
  width: 100%;
  height: 100vh;
  min-height: 100%;
  background: var(--bg-base, #09090b);
  color: var(--text-primary, #f5f5f7);
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 12px;
  padding: 12px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Inter', system-ui, sans-serif;
}

/* Toolbar */
.embed-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px;
  background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 12px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}

.embed-toolbar-types,
.embed-toolbar-timeframes {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: rgba(255,255,255,0.02);
  border-radius: 9px;
}

.embed-type-btn,
.embed-tf-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(245,245,247,0.5);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 6px 12px;
  border-radius: 7px;
  cursor: pointer;
  transition: color 150ms cubic-bezier(0.16, 1, 0.3, 1),
              background 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.embed-type-btn:hover:not(:disabled),
.embed-tf-btn:hover { color: rgba(245,245,247,0.85); }

.embed-type-btn--active,
.embed-tf-btn--active,
.embed-type-btn--active:hover,
.embed-tf-btn--active:hover {
  background: rgba(255,255,255,0.08);
  color: #f5f5f7;
}

.embed-type-btn:disabled {
  color: rgba(245,245,247,0.2);
  cursor: not-allowed;
}

/* Chart body */
.embed-chart-body {
  position: relative;
  min-height: 0;
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%);
  border: 1px solid rgba(255,255,255,0.04);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}

.embed-line-wrap,
.embed-candle-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.embed-line-canvas,
.embed-candle-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.embed-crosshair-readout {
  position: absolute;
  top: 10px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  color: #f5f5f7;
  background: rgba(18, 18, 20, 0.92);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  backdrop-filter: blur(8px);
  pointer-events: none;
  white-space: nowrap;
}
.embed-crosshair-sep { color: rgba(245,245,247,0.35); }

/* Skeleton */
.embed-chart-skeleton {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 75%);
  background-size: 200% 100%;
}

/* Error */
.embed-chart-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: rgba(245,245,247,0.5);
  font-size: 13px;
}
.embed-retry-btn {
  appearance: none;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  color: #f5f5f7;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.embed-retry-btn:hover {
  background: rgba(255,255,255,0.08);
  transform: translateY(-1px);
}

/* TV */
.embed-tv-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.embed-tv-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  color: rgba(245,245,247,0.5);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}
.embed-tv-unavailable-hint { color: rgba(245,245,247,0.35); font-size: 12px; }

/* Slider */
.embed-slider {
  display: grid;
  grid-template-rows: 36px auto;
  gap: 6px;
  padding: 6px 8px;
  background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 12px;
}
.embed-slider-track {
  position: relative;
  height: 36px;
  border-radius: 8px;
  background: rgba(255,255,255,0.015);
  cursor: ew-resize;
  user-select: none;
  touch-action: none;
}
.embed-slider-ticks {
  position: absolute;
  inset: 10px 0;
  pointer-events: none;
}
.embed-slider-tick {
  position: absolute;
  top: 0;
  width: 1px;
  height: 100%;
  background: rgba(245,245,247,0.12);
}
.embed-slider-window {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  cursor: grab;
}
.embed-slider-window:active { cursor: grabbing; }
.embed-slider-handle {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 10px;
  background: rgba(255,255,255,0.9);
  border-radius: 4px;
  cursor: ew-resize;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.embed-slider-handle--left { left: -5px; }
.embed-slider-handle--right { right: -5px; }

.embed-slider-labels {
  position: relative;
  height: 14px;
  font-size: 10px;
  color: rgba(245,245,247,0.35);
}
.embed-slider-label {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}

/* Monospace utility */
.mono {
  font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/embed-chart.css
git commit -m "feat(embed): add Apple Cinematic dark styles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Mobile responsive CSS

**Files:**
- Modify: `apps/research/src/pages/embed-chart/components/embed-chart.mobile.css`

- [ ] **Step 1: Write responsive breakpoints**

```css
/* EmbedChart — responsive breakpoints */

@media (max-width: 640px) {
  .embed-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .embed-toolbar-types,
  .embed-toolbar-timeframes {
    justify-content: space-between;
  }
  .embed-type-btn,
  .embed-tf-btn {
    flex: 1;
    text-align: center;
    padding: 6px 8px;
  }
}

@media (max-width: 480px) {
  .embed-chart-root {
    padding: 8px;
    gap: 8px;
  }
  .embed-slider-labels { display: none; }
  .embed-slider {
    grid-template-rows: 32px;
  }
  .embed-slider-track { height: 32px; }
  .embed-slider-handle { width: 12px; } /* larger tap target */
  .embed-crosshair-readout {
    font-size: 10px;
    padding: 3px 8px;
    gap: 6px;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/components/embed-chart.mobile.css
git commit -m "feat(embed): add responsive breakpoints

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Route wrapper (`index.jsx`)

**Files:**
- Create: `apps/research/src/pages/embed-chart/index.jsx`

- [ ] **Step 1: Create the page wrapper**

```jsx
/**
 * EmbedChartPage — thin route wrapper for /embed/chart/:cgId.
 * Reads the CoinGecko ID from the route param and renders the chart.
 * Shows a minimal "Token not found" message on empty/invalid param.
 */
import { useParams } from 'react-router-dom'
import EmbedChart from './components/embed-chart'
import './components/embed-chart.css'

export default function EmbedChartPage() {
  const { cgId } = useParams()
  if (!cgId) {
    return (
      <div className="embed-chart-root">
        <div className="embed-chart-error">
          <p>Missing token ID.</p>
        </div>
      </div>
    )
  }
  return <EmbedChart cgId={cgId} />
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:research`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/embed-chart/index.jsx
git commit -m "feat(embed): add route wrapper for /embed/chart/:cgId

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wire route into `App.jsx`

**Files:**
- Modify: `apps/research/src/App.jsx`

- [ ] **Step 1: Lazy-import the new page**

Find the block of `lazy(() => import(...))` imports in `apps/research/src/App.jsx` (just above the `Routes` JSX). Locate `NewsroomPage` — add `EmbedChartPage` next to it:

```jsx
const NewsroomPage = lazy(() => import('@/pages/newsroom'))
const EmbedChartPage = lazy(() => import('@/pages/embed-chart'))
```

- [ ] **Step 2: Register the route**

Inside the `<Routes>` element, find the standalone routes (the ones outside `AppShell`) — specifically the `<Route path="/newsroom" ...>` line (App.jsx:301). Add the embed route directly below it, with the same wrapping pattern:

```jsx
<Route path="/embed/chart/:cgId" element={<PageErrorBoundary><EmbedChartPage /></PageErrorBoundary>} />
```

The route MUST be registered outside `AppShell`. Place it in the same block as `/newsroom`, `/website`, `/website2` (around App.jsx:301-309).

- [ ] **Step 3: Verify build**

Run: `npm run build:research`
Expected: build succeeds. The embed route chunk should appear in the build output (e.g. `embed-chart-*.js`).

- [ ] **Step 4: Commit**

```bash
git add apps/research/src/App.jsx
git commit -m "feat(embed): register /embed/chart/:cgId route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: End-to-end verification

**Files:** none modified — verification only.

- [ ] **Step 1: Start the dev stack**

In three separate terminals (or background processes):

```bash
node scripts/setup-ports.js
npm run dev:server          # Express (port 3001, or slot from launch.json)
npm run dev:research        # Vite (port 5180, or slot)
```

Wait for "VITE ... ready" in the research terminal.

- [ ] **Step 2: Confirm AuthGate bypass**

Open a fresh incognito browser window. Navigate to:

```
http://localhost:5180/embed/chart/bitcoin
```

Expected: NO password prompt. Chart page loads immediately. Toolbar visible with `Line / Candle / TV` and `1D / 7D / 1M / 3M / 1Y`.

If password screen appears → Task 1 regressed. Check `PUBLIC_ROUTES` in `auth-gate.jsx`.

- [ ] **Step 3: Line chart sanity**

With Line selected:
- 1D shows a detailed line (hundreds of points).
- Switch to 7D → 1M → 3M: transitions are instant (from 90-day cache slice, no network latency).
- Switch to 1Y: short loading shimmer, then line renders.
- Hover the chart: crosshair appears with price + timestamp.

- [ ] **Step 4: Candle chart sanity**

Switch to Candle:
- 1D shows 30-min candles (~48 bars).
- 7D / 1M shows 4-hour candles.
- 3M / 1Y shows 4-day candles.
- Hover: OHLC readout appears.

- [ ] **Step 5: TV iframe sanity**

Switch to TV:
- TradingView loads inside an iframe, dark theme, BTCUSDT, ~1h interval.
- Range slider is HIDDEN in TV mode.
- Switch back to Line/Candle → slider reappears.

- [ ] **Step 6: Range slider sanity**

Back in Line mode, 1M timeframe:
- Drag the left handle inward → chart zooms into a shorter window from the right side.
- Drag the right handle → window shrinks from the right.
- Drag the window middle → pans.
- Double-click the track → resets to full width.
- Switch timeframe → slider resets to 100%.

- [ ] **Step 7: Wheel zoom sanity**

In Line or Candle mode:
- Scroll wheel up on the chart body → range narrows around cursor.
- Scroll wheel down → range widens.
- TV mode: wheel does nothing (TV handles its own zoom).

- [ ] **Step 8: Unknown token fallback**

Navigate to `http://localhost:5180/embed/chart/not-a-real-token`:
- Expected: "Unable to load chart data. Tap to retry" after a short delay (CG returns 404).
- TV button disabled (no Binance mapping).

- [ ] **Step 9: Responsive check**

Resize the browser narrow (DevTools device toolbar):
- ≤ 640px: toolbar stacks into 2 rows.
- ≤ 480px: slider date labels hidden, handles bigger for touch.
- iframe-sized frame (e.g. 400×600): layout remains usable.

- [ ] **Step 10: Console errors check**

Open DevTools console during all the above steps. Expected: no red errors. Network tab: CG requests via `/api/coingecko/coins/bitcoin/market_chart?...` return 200.

- [ ] **Step 11: Production build check**

```bash
npm run build:research
```

Expected: build succeeds. Grep the build output for the new chunk:

```bash
ls apps/research/dist/assets/ | grep -i embed
```

Expected: at least one `embed*.js` file exists.

- [ ] **Step 12: Commit any lint/formatting fixes made during verification, if any**

If the verification uncovered any bugs, fix them, run `npm run build:research` again, then commit:

```bash
git add -u
git commit -m "fix(embed): <what you fixed>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If nothing failed, skip this step.

- [ ] **Step 13: Final summary**

Report back to the user with:
- URL to try: `http://localhost:5180/embed/chart/bitcoin`
- Sample iframe snippet partners can use (HOSTILE-DOMAIN NOTE 2026-05-18:
  this snippet originally used `https://spectre.bot/...` - that domain is
  NOT team-owned per secy MEMORY.md FIX-RT03. Replaced with canonical
  app host. Do NOT reintroduce spectre.bot in partner-facing docs):
  ```html
  <iframe src="https://app.spectreai.io/embed/chart/bitcoin"
          width="800" height="500"
          style="border:0; border-radius:12px;"
          allow="clipboard-write"></iframe>
  ```
- List of supported CG IDs (point to `cg-to-binance.js` for the full list of TV-enabled tokens; any valid CG ID works for Line/Candle).

---

## Out of Scope for This Plan

- Light/auto theme (dark only per spec)
- Query-param configuration (decision: ID in path only)
- Branding header or "Open in Spectre" link (decision: minimal)
- +/− zoom buttons (slider + wheel + pinch cover this)
- Websocket live updates (polling not implemented; users refresh)
- CG ID validation against a known list (any ID is tried — server returns 404, which we handle as error state)

## Post-Implementation TODO (not this plan)

- **Two-finger pinch on mobile.** Spec mentioned "pinch = wheel". The range slider handles cover mobile zoom fine for v1. For a v1.1 improvement, add a `touchstart/touchmove` handler to `bodyRef` in `embed-chart.jsx` that tracks two-pointer distance delta and applies it as a `wheel`-equivalent zoom factor around the gesture centroid.
- Add serverless-friendly warm-up for the CG proxy if embed traffic becomes heavy (currently the `/api/cg-proxy` function already caches at the Vercel edge for 30s via `Cache-Control`, which is fine for MVP).
- Add a `/embed/chart/:cgId/preview` meta/OG-image endpoint if partners want social-share cards.
