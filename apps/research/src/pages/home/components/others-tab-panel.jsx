/**
 * OthersTabPanel — the alt long tail. OTHERS2 = total market cap minus the
 * top-100 (everything ranked ~101-4000). The default chart is our OWN OTHERS2
 * line (ex-top 100) — no index tracks ex-top-100, so we reconstruct it from the
 * live long-tail performance (now / -1d / -7d / -14d / -30d / -200d / -1y,
 * anchored to the true $55B) and record it forward. Beside it: the Alt Season
 * Index (30d breadth) + an Alt Rotation meter (is capital flowing INTO the long
 * tail — reads low when alts are dead), OTHERS2 mcap + dominance, TOTAL/2/3, and
 * the real long-tail runners (ranks 101-4000 + Robinhood).
 */
import React, { memo, useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTopCoinsMarketsPage, getOthers2Data } from '@/services/coinGeckoApi'
import { getGlobalMetrics } from '@/services/fearGreedApi'
import { getSpectreAltSeason, getSpectreOthers2History } from '@/services/spectreMarketApi'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import { niceTicks, dateTicks, axisGutter, drawValueAxis, drawDateAxis, drawLastValueTag } from '@/lib/chart-axis'
import './others-tab-panel.css'

// real alts only: drop stables + wrapped/staked derivatives so the breadth read
// isn't flattered by ETH/USDT et al.
const STABLE = /USD|DAI|EUR|USTC|BUIDL/i
const WRAP = /WBTC|WETH|WEETH|WSTETH|STETH|WBETH|CBBTC|CBETH|RETH|LBTC|SOLVBTC|BNSOL|JITOSOL|MSOL|RSETH|EZETH|SUSDE/i

// 'OWN' = our reconstructed+recorded OTHERS2 (ex-top 100) line. The CRYPTOCAP
// symbols are macro proxies for context (OTHERS = ex-top-10, TOTAL3/2).
const INDICES = [
  { id: 'OWN', label: 'OTHERS2', hint: 'ex top 100 · our line' },
  { id: 'CRYPTOCAP:OTHERS', label: 'Others', hint: 'ex top 10' },
  { id: 'CRYPTOCAP:TOTAL3', label: 'Total3', hint: 'ex BTC + ETH' },
  { id: 'CRYPTOCAP:TOTAL2', label: 'Total2', hint: 'ex BTC' },
]
const RANGES = [
  { label: '4H', interval: '60' },
  { label: '1D', interval: '240' },
  { label: '1W', interval: 'D' },
  { label: '1M', interval: 'W' },
]
// timeframe windows for the OWN (native) OTHERS2 line — slices the history
const RANGES_OWN = [
  { label: 'LIVE', days: 7 },
  { label: '3M', days: 90 },
  { label: '1Y', days: 365 },
  { label: '3Y', days: 1095 },
  { label: 'ALL', days: Infinity },
]

function fmtUsd(n) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function buildEmbedUrl(symbol, interval) {
  const params = new URLSearchParams({
    frameElementId: 'otp_tv', symbol, interval, theme: 'dark',
    style: '3', hide_top_toolbar: '1', hide_side_toolbar: '1', hide_legend: '1',
    allow_symbol_change: '0', save_image: '0', withdateranges: '0',
    backgroundColor: 'rgba(9,9,11,1)',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}

// ── our OWN OTHERS2 history (localStorage) — no source has ex-top-100 history,
// so the app records it (like the TG bot's store) and reconstructs the recent
// past from live constituent returns.
const O2_KEY = 'spectre-others2-hist-v1'
function readO2Hist() {
  try { const a = JSON.parse(localStorage.getItem(O2_KEY) || '[]'); return Array.isArray(a) ? a.filter((s) => s && s.o > 0 && s.ts) : [] } catch { return [] }
}
function recordO2(value) {
  const cur = readO2Hist()
  if (!(value > 0)) return cur
  try {
    const now = Date.now()
    let a = cur.filter((s) => now - s.ts < 180 * 864e5 && s.o > value * 0.25 && s.o < value * 4)
    const last = a[a.length - 1]
    if (!last || now - last.ts > 6 * 3600e3) { a.push({ ts: now, o: value }); a = a.slice(-400) }
    localStorage.setItem(O2_KEY, JSON.stringify(a))
    return a
  } catch { return cur }
}
// reconstruct OTHERS2 at past anchors from the long-tail aggregate returns, then
// merge the recorded points → an immediate real-magnitude line ending at now.
function buildO2Series(others2Now, agg, recorded) {
  if (!(others2Now > 0)) return []
  const now = Date.now()
  const pts = []
  const back = (days, chgPct) => {
    if (chgPct == null || !isFinite(chgPct)) return
    const past = others2Now / (1 + chgPct / 100)
    if (past > 0 && isFinite(past)) pts.push({ ts: now - days * 864e5, o: past, recon: true })
  }
  if (agg) { back(365, agg.y1); back(200, agg.d200); back(30, agg.d30); back(14, agg.d14); back(7, agg.d7); back(1, agg.d1) }
  // recorded (localStorage) points ONLY within the reconstruction envelope — old
  // relics from the pre-fix inflated era ($86-90B) sit far above the anchors and
  // spiked the line; clamp to [anchorMin·0.9, anchorMax·1.06] so they can't.
  const anchorVals = pts.map((p) => p.o).concat(others2Now)
  const envLo = Math.min(...anchorVals) * 0.9, envHi = Math.max(...anchorVals) * 1.06
  for (const s of (recorded || [])) if (s.o > 0 && s.o >= envLo && s.o <= envHi) pts.push({ ts: s.ts, o: s.o })
  pts.push({ ts: now, o: others2Now })
  pts.sort((a, b) => a.ts - b.ts)
  // de-dupe near-identical timestamps, preferring a real recorded point over a reconstruction
  const out = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(p.ts - last.ts) < 12 * 3600e3) { if (!p.recon && last.recon) out[out.length - 1] = p; continue }
    out.push(p)
  }
  return out
}
// a proper axed OTHERS2 chart drawn on CANVAS — renders identically across
// browsers (SVG strokes proved unreliable inside a stretched/offset-sized
// container). gridlines + area + line + right value axis + bottom date axis.
function drawO2Chart(canvas, wrap, pts, money) {
  if (!canvas || !wrap || !pts || pts.length < 2) return
  const W = wrap.clientWidth, H = wrap.clientHeight
  if (W < 20 || H < 20) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
  const xs = pts.map((p) => p.ts), vs = pts.map((p) => p.o)
  const tMin = Math.min(...xs), tMax = Math.max(...xs), vMin = Math.min(...vs), vMax = Math.max(...vs)
  const pad = (vMax - vMin) * 0.1 || vMax * 0.06
  const lo = Math.max(0, vMin - pad), hi = vMax + pad
  const yt = niceTicks(lo, hi, 5)
  // the value gutter is measured from the formatted labels — a fixed width left
  // the scale stranded far from the plot on wide labels ("$60.00B")
  const mL = 12, mT = 14, mB = 26
  const mR = axisGutter(ctx, yt.map(money))
  const pw = W - mL - mR, ph = H - mT - mB
  if (pw < 40 || ph < 30) return
  const plot = { x: mL, y: mT, w: pw, h: ph }
  const up = vs[vs.length - 1] >= vs[0]
  const rgb = up ? '57,217,138' : '91,140,255', c = `rgb(${rgb})`
  const X = (t) => mL + (tMax === tMin ? pw / 2 : ((t - tMin) / (tMax - tMin)) * pw)
  const Y = (v) => mT + (hi === lo ? ph / 2 : (1 - (v - lo) / (hi - lo)) * ph)
  const last = pts[pts.length - 1], lastY = Y(last.o)
  drawDateAxis(ctx, { plot, ticks: dateTicks(tMin, tMax, 6), X, baseline: H - 7 })
  drawValueAxis(ctx, { plot, ticks: yt, Y, fmt: money, hideNearY: Math.round(lastY) + 0.5 })
  const g = ctx.createLinearGradient(0, mT, 0, mT + ph)
  g.addColorStop(0, `rgba(${rgb},0.26)`); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.beginPath(); ctx.moveTo(X(pts[0].ts), Y(pts[0].o)); for (const p of pts) ctx.lineTo(X(p.ts), Y(p.o))
  ctx.lineTo(X(tMax), mT + ph); ctx.lineTo(X(tMin), mT + ph); ctx.closePath(); ctx.fillStyle = g; ctx.fill()
  ctx.beginPath(); ctx.moveTo(X(pts[0].ts), Y(pts[0].o)); for (const p of pts) ctx.lineTo(X(p.ts), Y(p.o))
  ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()
  drawLastValueTag(ctx, { plot, x: X(last.ts), y: lastY, label: money(last.o), rgb, canvasW: W })
  // bottom-LEFT so the mark never crowds the live edge of the line
  drawSpectreWatermark(ctx, { w: W, h: H, dark: true, corner: 'bl', plot })
}
function Others2Chart({ pts, money }) {
  const wrapRef = useRef(null), canvasRef = useRef(null)
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (!wrap || !canvas) return
    const draw = () => drawO2Chart(canvas, wrap, pts, money)
    draw()
    let ro
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(draw); ro.observe(wrap) }
    return () => { if (ro) ro.disconnect() }
  }, [pts, money])
  return (
    <div className="otp-o2chart" ref={wrapRef}>
      <canvas className="otp-o2canvas" ref={canvasRef} />
    </div>
  )
}

// Chart-shaped loading state. Deliberately NOT a spinner and NOT a stack of
// shimmer bars — the frame keeps the exact chart geometry (gridlines + a ghost
// line) so nothing shifts when the real series lands.
function ChartSkeleton({ label }) {
  return (
    <div className="otp-chart-skel" aria-hidden="true">
      <div className="otp-chart-skel-grid"><i /><i /><i /><i /></div>
      <svg className="otp-chart-skel-line" viewBox="0 0 100 40" preserveAspectRatio="none">
        <path d="M0 31 C 10 29, 16 33, 24 26 S 40 13, 52 20 S 68 9, 78 14 S 92 8, 100 11" />
      </svg>
      <span className="otp-chart-skel-sweep" />
      {label ? <span className="otp-chart-skel-lbl">{label}</span> : null}
    </div>
  )
}

function OthersTabPanel({ fmtLarge }) {
  const navigate = useNavigate()
  const [index, setIndex] = useState('OWN')
  const [interval, setInterval] = useState('D')
  const [ownDays, setOwnDays] = useState(Infinity)
  const [chartLoaded, setChartLoaded] = useState(false)
  const [rows, setRows] = useState(null)
  const [global, setGlobal] = useState(null)
  const [altSeason, setAltSeason] = useState(null)
  const [o2Data, setO2Data] = useState(null)
  const [o2Hist, setO2Hist] = useState(() => readO2Hist())
  const [o2Box, setO2Box] = useState(null)
  // 'loading' until the box history is in (or has definitively failed). The
  // local reconstruction is a LAST RESORT, never a first paint — showing it
  // while the box is still in flight is what made the tab flash a wrong-looking
  // line (or two) before settling on the real one.
  const [boxState, setBoxState] = useState('loading')
  const [boxCurrent, setBoxCurrent] = useState(null)
  const [loading, setLoading] = useState(true)
  const iframeRef = useRef(null)

  useEffect(() => { setChartLoaded(false) }, [index, interval])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Fire every call INDEPENDENTLY and paint each result as it lands — never
    // all-or-nothing behind a Promise.all (two heavy CG top-250 calls would keep
    // the whole panel blank on a cold load). The box call is ONE fast edge-cached
    // request that carries BOTH the full cycle (chart) AND current{others2,total}
    // → the headline + chart paint in ~0.5s; the CG gauges fill in after.
    // Retry the box history a few times: it is the ONLY source of the full 2020→
    // cycle, so a transient miss must not strand the chart on the 1y reconstruction.
    const MAX_BOX_TRIES = 3
    const giveUp = (attempt) => { if (attempt >= MAX_BOX_TRIES) setBoxState('failed') }
    const loadBox = (attempt = 0) => {
      getSpectreOthers2History().then((box) => {
        if (cancelled) return
        const ok = !!box && Array.isArray(box.history) && box.history.length >= 2
        if (ok) { setO2Box(box); setBoxState('ready') }
        if (Number(box?.current?.total) > 0) { setBoxCurrent(box.current); setLoading(false) }
        if (!ok) {
          if (attempt < MAX_BOX_TRIES) setTimeout(() => { if (!cancelled) loadBox(attempt + 1) }, 1200 * (attempt + 1))
          else giveUp(attempt)
        }
      }).catch(() => {
        if (cancelled) return
        if (attempt < MAX_BOX_TRIES) setTimeout(() => { if (!cancelled) loadBox(attempt + 1) }, 1200 * (attempt + 1))
        else giveUp(attempt)
      })
    }
    loadBox()
    getGlobalMetrics().then((g) => { if (!cancelled && g) { setGlobal(g); setLoading(false) } }).catch(() => {})
    getTopCoinsMarketsPage(1, 250).then((m) => { if (!cancelled) setRows(Array.isArray(m) ? m : []) }).catch(() => {})
    getSpectreAltSeason().then((a) => { if (!cancelled) setAltSeason(a || null) }).catch(() => {})
    getOthers2Data().then((o2) => { if (!cancelled) setO2Data(o2 || null) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const money = fmtLarge || fmtUsd

  const read = useMemo(() => {
    const markets = Array.isArray(rows) ? rows : []
    // seed total from the fast box current so the headline paints before the CG
    // global call resolves (falls back to global once it lands — same number)
    const total = Number(global?.totalMarketCap) || Number(boxCurrent?.total) || 0
    const btcD = Number(global?.btcDominance) || 0
    const ethD = Number(global?.ethDominance) || 0
    if (!total) return null

    // OTHERS2 = total − CG top-100 (incl. stablecoins). PREFER the box `current`
    // (the snapshot worker computes both sides from ONE CoinGecko read → stable,
    // authoritative, and identical to the chart's live point so headline == line
    // end). Fall back to CG top-100 sum, then the box top-100 list, only if the
    // box current isn't here yet. (Mixing box-total − CG-top100 was the ~$4B
    // inflation + it disagreed with the recorded line.)
    const cgSum = Number(o2Data?.top100Sum) || 0
    const hasStables = markets.slice(0, 30).some((r) => ['USDT', 'USDC'].includes(String(r.symbol || '').toUpperCase()))
    const sumBoxTop100 = markets.slice(0, 100).reduce((s, r) => s + (Number(r.market_cap) || 0), 0)
    const others2 = Number(boxCurrent?.others2) > 0 ? Number(boxCurrent.others2)
      : cgSum > 0 ? total - cgSum
        : (hasStables && markets.length ? total - sumBoxTop100 : null)
    const others2Share = others2 != null ? (others2 / total) * 100 : null
    // TOTAL2/3 need real dominance — show only once global lands (never fabricate
    // from a box-only total, which would read TOTAL2 == TOTAL)
    const total2 = btcD ? total * (1 - btcD / 100) : null
    const total3 = (btcD || ethD) ? total * (1 - (btcD + ethD) / 100) : null

    // 24h breadth (short-term tape) from the box top-250
    const btcRow = markets.find((r) => String(r.symbol || '').toUpperCase() === 'BTC')
    const btcChg = Number(btcRow?.price_change_percentage_24h) || 0
    const alts = markets.filter((r) => {
      const s = String(r.symbol || '').toUpperCase()
      return s !== 'BTC' && !STABLE.test(s) && !WRAP.test(s) && isFinite(r.price_change_percentage_24h)
    })
    const chgs = alts.map((r) => r.price_change_percentage_24h)
    const beatBtcPct = chgs.length ? (chgs.filter((x) => x > btcChg).length / chgs.length) * 100 : null
    const greenPct = chgs.length ? (chgs.filter((x) => x > 0).length / chgs.length) * 100 : null
    const sorted = [...chgs].sort((a, b) => a - b)
    const medianAlt = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
    const breadth24h = beatBtcPct != null && greenPct != null ? Math.round(0.65 * beatBtcPct + 0.35 * greenPct) : null

    // Alt Season Index (30d) — REAL client-side breadth: % of top-50 alts beating
    // BTC over 30d. Falls back to the CMC endpoint only if unavailable.
    const b = o2Data?.breadth
    const seasonIdx = Number.isFinite(b?.index) ? b.index : (Number.isFinite(altSeason?.index) ? altSeason.index : null)
    const seasonOut = Number.isFinite(b?.outperforming) ? b.outperforming : (Number.isFinite(altSeason?.outperformingAlts) ? altSeason.outperformingAlts : null)
    const seasonTot = Number.isFinite(b?.total) ? b.total : (Number.isFinite(altSeason?.totalAlts) ? altSeason.totalAlts : null)

    // Alt Rotation — is capital actually flowing INTO the long tail? Weighted
    // toward STRUCTURE, not noise: how many alts are truly up over 30d (green),
    // the long tail's performance vs BTC, and OTHERS2's dominance level (a tiny
    // ~2% share = near cycle lows). Reads LOW when alts are dead — flat momentum
    // + tiny/shrinking share, even if some alts nominally "beat" a falling BTC.
    const o2d30 = Number(o2Data?.aggChanges?.d30)
    const green30 = Number(b?.green30)
    const btc30 = Number(b?.btc30)
    let rotation = null
    if (seasonIdx != null && Number.isFinite(green30)) {
      const shareForRot = Number.isFinite(others2Share) ? others2Share : 2.5
      const domScore = Math.max(0, Math.min(100, ((shareForRot - 2) / 6) * 100))         // 2%→0, 8%→100
      const relScore = Number.isFinite(o2d30) && Number.isFinite(btc30) ? Math.max(0, Math.min(100, 50 + (o2d30 - btc30) * 2.5)) : 50
      rotation = Math.round(0.35 * green30 + 0.30 * relScore + 0.35 * domScore)
    }

    return { total, others2, others2Share, total2, total3, btcD, ethD, beatBtcPct, greenPct, medianAlt, breadth24h, seasonIdx, seasonOut, seasonTot, rotation, o2d30 }
  }, [rows, global, o2Data, altSeason, boxCurrent])

  // record our OTHERS2 to localStorage whenever a fresh value lands
  useEffect(() => {
    if (read?.others2 > 0) setO2Hist(recordO2(read.others2))
  }, [read?.others2])

  // the OWN line: prefer the data-api history (engineered cycle 2020→ + REAL
  // recorded values, one source for app + bot); append the freshest live value.
  // Fall back to the local reconstruction only if the endpoint is unavailable.
  const o2Series = useMemo(() => {
    if (o2Box?.history?.length >= 2) {
      const pts = o2Box.history.map((h) => ({ ts: h.ts, o: h.o }))
      // Append the live value ONLY when it agrees with the recorded tape. The
      // headline can briefly come from a different source (CG total − top-100)
      // that disagrees by several $B, and appending that drew a vertical spike
      // off the right edge — the "bad chart" the tab flashed.
      const live = Number(boxCurrent?.others2) > 0 ? Number(boxCurrent.others2) : Number(read?.others2)
      const last = pts[pts.length - 1]
      const sane = live > 0 && last?.o > 0 && live > last.o * 0.8 && live < last.o * 1.25
      if (sane && Date.now() - last.ts > 6 * 3600e3) pts.push({ ts: Date.now(), o: live })
      return pts
    }
    // only once the box has definitively failed (see boxState)
    return buildO2Series(read?.others2, o2Data?.aggChanges, o2Hist)
  }, [o2Box, boxCurrent, read?.others2, o2Data, o2Hist])
  const o2FromBox = !!(o2Box?.history?.length >= 2)
  // the chart paints only when the series is trustworthy; until then, skeleton
  const o2Ready = boxState !== 'loading' && o2Series.length >= 2
  // slice the line to the selected timeframe (3M / 1Y / 3Y / ALL)
  const o2View = useMemo(() => {
    if (o2Series.length < 2 || !isFinite(ownDays)) return o2Series
    const cutoff = Date.now() - ownDays * 864e5
    const sliced = o2Series.filter((p) => p.ts >= cutoff)
    return sliced.length >= 2 ? sliced : o2Series.slice(-Math.min(o2Series.length, 8))
  }, [o2Series, ownDays])

  // Alt Season regime (headline gauge)
  const as = read?.seasonIdx ?? null
  const seasonWord = altSeason?.season || altSeason?.label || null
  const regime = as == null
    ? { color: '#9299aa', label: 'Alt Season Index · 30d' }
    : as < 25 ? { color: '#ff8a3d', label: 'Bitcoin season · alts crushed' }
      : as < 50 ? { color: '#e0b93a', label: seasonWord || 'Bitcoin season · alts lagging' }
        : as < 75 ? { color: '#7dd35b', label: seasonWord || 'Rotation · alts warming' }
          : { color: '#39d98a', label: seasonWord || 'Alt season · alts leading' }

  // Alt Rotation regime (into the long tail)
  const rot = read?.rotation ?? null
  const rotRegime = rot == null ? { color: '#9299aa', label: '—' }
    : rot < 25 ? { color: '#ff6b5a', label: 'Dead · money is not rotating into the tail' }
      : rot < 45 ? { color: '#ff8a3d', label: 'Weak · little flow to the long tail' }
        : rot < 62 ? { color: '#e0b93a', label: 'Warming · early rotation down the curve' }
          : { color: '#39d98a', label: 'Live · rotating into the long tail' }

  const readText = useMemo(() => {
    if (!read || as == null) return ''
    const outp = read.seasonOut, tot = read.seasonTot
    const outpFrag = Number.isFinite(outp) && Number.isFinite(tot) ? `Only ${outp} of the top ${tot} alts have beaten BTC over 30 days` : 'Breadth over the month is thin'
    const flow = read.rotation != null ? ` Alt rotation reads ${read.rotation}/100${read.o2d30 != null && isFinite(read.o2d30) ? ` (OTHERS2 ${read.o2d30 >= 0 ? '+' : ''}${read.o2d30.toFixed(1)}% over 30d)` : ''} — ${read.rotation < 45 ? 'money is not flowing into the long tail' : 'flow is picking up'}.` : ''
    if (as < 50) return `Alt Season Index at ${as}/100 — Bitcoin season. ${outpFrag}, and OTHERS2 sits far below its 2024/25 highs.${flow} The month says the long tail is dead money until this climbs past 50.`
    if (as < 75) return `Alt Season Index at ${as}/100 — capital is starting to rotate down the curve (${outpFrag.replace('Only ', '')}).${flow} Not a clean alt-season yet.`
    return `Alt Season Index at ${as}/100 — genuine alt-season: most of the top-50 alts are beating BTC over the month.${flow}`
  }, [read, as])

  // compact microcap-depth read (how far below the cycle peak is the long tail)
  const o2depth = useMemo(() => {
    const hist = Array.isArray(o2Box?.history) ? o2Box.history : []
    const now = Number(read?.others2) || Number(o2Box?.current?.others2) || 0
    if (hist.length < 8 || now <= 0) return null
    const vals = hist.map((p) => Number(p.o)).filter((v) => v > 0)
    const ath = Math.max(...vals)
    const athPt = hist.find((p) => Number(p.o) === ath)
    const cut = Date.now() - 1300 * 864e5
    const recent = hist.filter((p) => p.ts >= cut).map((p) => Number(p.o)).filter((v) => v > 0)
    const low = recent.length ? Math.min(...recent) : Math.min(...vals)
    const pctBelowPeak = Math.max(0, Math.min(100, (1 - now / ath) * 100))
    const posInRange = ath > low ? Math.max(0, Math.min(100, ((now - low) / (ath - low)) * 100)) : 50
    return {
      now, ath, low, pctBelowPeak, posInRange,
      athYear: athPt ? new Date(athPt.ts).getUTCFullYear() : null,
      xFromLow: low > 0 ? now / low : null,
      zone: posInRange < 20 ? 'capitulation' : posInRange < 45 ? 'basing' : posInRange < 70 ? 'mid-cycle' : 'elevated',
    }
  }, [o2Box, read?.others2])

  const activeIndex = INDICES.find((i) => i.id === index)
  const isOwn = index === 'OWN'
  const constituents = o2Data?.constituents || []

  return (
    <div className="otp">
      <div className="otp-grid">
        {/* Chart: our OWN OTHERS2 line (default) or a TradingView macro proxy */}
        <div className="otp-chart-card">
          <div className="otp-chart-head">
            <div className="otp-idx-tabs">
              {INDICES.map((i) => (
                <button
                  key={i.id}
                  className={`otp-idx${index === i.id ? ' otp-idx--active' : ''}${i.id === 'OWN' ? ' otp-idx--own' : ''}`}
                  onClick={() => setIndex(i.id)}
                  title={i.hint}
                >{i.label}</button>
              ))}
            </div>
            {isOwn ? (
              <div className="otp-range-tabs">
                {RANGES_OWN.map((r) => (
                  <button
                    key={r.label}
                    className={`otp-range${ownDays === r.days ? ' otp-range--active' : ''}`}
                    onClick={() => setOwnDays(r.days)}
                  >{r.label}</button>
                ))}
              </div>
            ) : (
              <div className="otp-range-tabs">
                {RANGES.map((r) => (
                  <button
                    key={r.interval}
                    className={`otp-range${interval === r.interval ? ' otp-range--active' : ''}`}
                    onClick={() => setInterval(r.interval)}
                  >{r.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="otp-chart-sub">
            {isOwn
              ? (ownDays <= 90
                ? `OTHERS2 · ex-top 100 · live recorded${ownDays <= 7 ? ' · realtime tape' : ''}`
                : (o2FromBox ? 'OTHERS2 · ex-top 100 · full alt cycle + live recorded' : 'OTHERS2 · ex-top 100 · our line'))
              : `${activeIndex?.label} · ${activeIndex?.hint} · macro proxy`}
          </div>
          <div className="otp-chart-frame">
            {isOwn ? (
              !o2Ready ? (
                boxState === 'loading'
                  ? <ChartSkeleton label="Loading OTHERS2 · ex-top 100" />
                  : (
                    <div className="otp-o2line-building">
                      <b>{read?.others2 != null ? money(read.others2) : '—'}</b>
                      <span>OTHERS2 · ex-top 100. Building the line from live long-tail data — deepens as it records.</span>
                    </div>
                  )
              ) : (
                <Others2Chart pts={o2View} money={money} />
              )
            ) : (
              <>
                {!chartLoaded && <ChartSkeleton label={`Loading ${activeIndex?.label || 'chart'}`} />}
                <iframe
                  ref={iframeRef}
                  title="Others index"
                  src={buildEmbedUrl(index, interval)}
                  onLoad={() => setChartLoaded(true)}
                  className="otp-iframe"
                  frameBorder="0"
                  scrolling="no"
                />
              </>
            )}
          </div>

          {/* Cycle depth — fills the column, shows how ATL the long tail is */}
          {o2depth && (
            <div className="otp-cycle-depth">
              <div className="otp-cd-head">
                <span className="otp-cd-title">Where in the cycle · OTHERS2</span>
                <span className={`otp-cd-zone otp-cd-zone--${o2depth.zone}`}>{o2depth.zone}</span>
              </div>
              <div className="otp-cd-track"><span className="otp-cd-mark" style={{ left: `${o2depth.posInRange}%` }} /></div>
              <div className="otp-cd-scale">
                <span>{money(o2depth.low)}<i>cycle floor</i></span>
                <span className="otp-cd-mid">{Math.round(o2depth.pctBelowPeak)}% below peak</span>
                <span className="otp-cd-r">{money(o2depth.ath)}<i>{o2depth.athYear || ''} peak</i></span>
              </div>
              <div className="otp-cd-stats">
                <div className="otp-cd-stat"><span>Now</span><b>{money(o2depth.now)}</b></div>
                <div className="otp-cd-stat"><span>Off the low</span><b>{o2depth.xFromLow ? `${o2depth.xFromLow.toFixed(1)}×` : '—'}</b></div>
                <div className="otp-cd-stat"><span>2021 peak</span><b>{money(o2depth.ath)}</b></div>
              </div>
            </div>
          )}
        </div>

        {/* Our read */}
        <div className="otp-read-card">
          <div className="otp-o2-head">
            <div>
              <div className="otp-eyebrow">OTHERS2 · alt long tail</div>
              <div className="otp-o2-value">{loading ? '—' : (read?.others2 != null ? money(read.others2) : '—')}</div>
            </div>
            <div className="otp-o2-share">
              <span className="otp-o2-share-num">{read?.others2Share != null ? read.others2Share.toFixed(1) : '—'}%</span>
              <span className="otp-o2-share-lbl">of total</span>
            </div>
          </div>

          {/* full page CTA (the depth detail now lives under the chart, left col) */}
          <button type="button" className="otp-micro-cta" onClick={() => navigate('/alt-rotation')}>
            Open Microcaps analysis
            <span aria-hidden>→</span>
          </button>

          {/* Alt Rotation meter — is money flowing INTO the long tail? */}
          <div className="otp-gauge-block">
            <div className="otp-gauge-top">
              <span className="otp-gauge-title">Alt Rotation<i>· into OTHERS2</i></span>
              <span className="otp-gauge-num" style={{ color: rotRegime.color }}>{rot ?? '—'}<b>/100</b></span>
            </div>
            <div className="otp-gauge otp-gauge--rot">
              <i style={{ left: `${rot ?? 0}%` }} />
            </div>
            <div className="otp-gauge-labels">
              <span>Dead</span><span>Warming</span><span>Rotating</span>
            </div>
            <div className="otp-regime" style={{ color: rotRegime.color }}>{rotRegime.label}</div>
          </div>

          {/* Alt Season Index (30d breadth) */}
          <div className="otp-gauge-block otp-gauge-block--season">
            <div className="otp-gauge-top">
              <span className="otp-gauge-title">Alt Season Index<i>· 30d</i></span>
              <span className="otp-gauge-num" style={{ color: regime.color }}>{as ?? '—'}<b>/100</b></span>
            </div>
            <div className="otp-gauge">
              <i style={{ left: `${as ?? 0}%` }} />
            </div>
            <div className="otp-gauge-labels">
              <span>Bitcoin Season</span><span>Rotation</span><span>Alt Season</span>
            </div>
            <div className="otp-regime" style={{ color: regime.color }}>
              {regime.label}
              {Number.isFinite(read?.seasonOut) && Number.isFinite(read?.seasonTot) && (
                <span className="otp-regime-sub"> · {read.seasonOut} of {read.seasonTot} alts beat BTC</span>
              )}
            </div>
          </div>

          <div className="otp-substat-head">24h rotation<span> · short-term tape, not a season call</span></div>
          <div className="otp-stats">
            <div className="otp-stat">
              <span className="otp-stat-num" style={{ color: read?.breadth24h != null ? (read.breadth24h >= 55 ? '#39d98a' : read.breadth24h < 35 ? '#ff8a3d' : '#e0b93a') : undefined }}>{read?.breadth24h ?? '—'}<span className="otp-stat-den">/100</span></span>
              <span className="otp-stat-lbl">rotation</span>
            </div>
            <div className="otp-stat">
              <span className="otp-stat-num">{read?.beatBtcPct != null ? Math.round(read.beatBtcPct) : '—'}%</span>
              <span className="otp-stat-lbl">beating BTC</span>
            </div>
            <div className="otp-stat">
              <span className="otp-stat-num" style={{ color: read?.medianAlt != null ? (read.medianAlt >= 0 ? '#39d98a' : '#ff8a6a') : undefined }}>{read?.medianAlt != null ? `${read.medianAlt >= 0 ? '+' : ''}${read.medianAlt.toFixed(1)}%` : '—'}</span>
              <span className="otp-stat-lbl">median alt</span>
            </div>
          </div>

          <div className="otp-totals">
            <div className="otp-total"><span>TOTAL</span><b>{read?.total ? money(read.total) : '—'}</b></div>
            <div className="otp-total"><span>TOTAL2</span><b>{read?.total2 ? money(read.total2) : '—'}</b></div>
            <div className="otp-total"><span>TOTAL3</span><b>{read?.total3 ? money(read.total3) : '—'}</b></div>
          </div>

          {readText && <p className="otp-read-text">{readText}</p>}
        </div>
      </div>

      {constituents.length > 0 && (
        <div className="otp-runners">
          <div className="otp-runners-head">
            <span className="otp-runners-title">Long-tail runners</span>
            <span className="otp-runners-sub">ranks 101–4000 + Robinhood chain · what's actually in OTHERS2</span>
          </div>
          <div className="otp-runners-grid">
            {constituents.map((t) => {
              const up = Number.isFinite(t.chg) && t.chg >= 0
              const big = Number.isFinite(t.chg) && Math.abs(t.chg) >= 100
              return (
                <div className="otp-run" key={t.id}>
                  <span className="otp-run-logo">
                    <em style={{ display: t.image ? 'none' : 'grid' }}>{String(t.sym || '?')[0]}</em>
                    {t.image && (
                      <img src={t.image} alt="" loading="lazy" onError={(e) => { const em = e.currentTarget.previousSibling; if (em) em.style.display = 'grid'; e.currentTarget.remove() }} />
                    )}
                  </span>
                  <div className="otp-run-meta">
                    <b>{t.sym}{t.rh && <i className="otp-run-rh">RH</i>}</b>
                    <span>{money(t.mcap)}</span>
                  </div>
                  <span className={`otp-run-chg ${up ? 'up' : 'down'}`}>{Number.isFinite(t.chg) ? `${up ? '+' : ''}${t.chg.toFixed(big ? 0 : 1)}%` : '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(OthersTabPanel)
