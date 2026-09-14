// Alt Rotation Radar (/alt-rotation) — "is it go time to bid alts from majors?"
// Organized by chain, then meme/utility (the user's map: ETH-chain ATL, SOL,
// Base recovering, Robinhood the new vibe). Verdict-led, grounded, no slop.
import React, { useMemo, useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import useAltRotation from '../use-alt-rotation'
import useSettingsStore from '@/store/useSettingsStore'
import { medianBars } from '../alt-rotation-core'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import { niceTicks, dateTicks, axisGutter, drawValueAxis, drawDateAxis, drawLastValueTag } from '@/lib/chart-axis'
import './alt-rotation-page.css'
import './alt-rotation-page.day-mode.css'
import './alt-rotation-page.mobile.css'

// The verdict ladder. Painted from an INLINE custom property, so no stylesheet
// can recolour it — which is why the values live here and not in the CSS.
// Every step is a design-system token: bear -> bear-bright -> amber ->
// bull -> bull-bright. The page used to run its own five-hue ramp
// (#ff7043/#ff9f43/#e0b93a/#5bd08a/#39d98a), so the verdict word, the movers
// column and the chain dots were three different greens on one screen.
// The verdict / vibe / signal palettes. These are painted INLINE (a custom
// property on the hero, a border+fill on the vibe pill), so no stylesheet can
// recolour them — which is why each carries its own day value.
//
// Two things were wrong before this pass. The dark set was a bespoke five-hue
// ramp (#ff7043/#ff9f43/#e0b93a/#5bd08a/#39d98a), so the verdict word, the
// movers column and the chain dots were three different greens on one screen;
// they are now the design-system ladder, bear -> amber -> bull. And there were
// no day values at all: mint on white measures ~1.9:1 and the "quiet" grey
// ~1.4:1, i.e. the loudest word on the page and the Ethereum vibe pill were
// unreadable in day mode. The day column is the same ladder at day contrast,
// and matches the values /why uses so the two pages agree on what green means.
//
// 🪤 `color` MUST stay a 6-digit hex — the vibe pill builds its border and
// fill by string-concatenating hex alpha (`vibe.color + '55'`). An rgba() here
// silently produces an invalid colour and the pill loses its frame.
const BAND = {
  dead: { color: '#EF4444', day: '#b3231a', glow: 'rgba(239,68,68,0.15)', dayGlow: 'rgba(179,35,26,0.09)', word: 'MICROS ARE DEAD' },
  notyet: { color: '#F87171', day: '#c62a1d', glow: 'rgba(248,113,113,0.14)', dayGlow: 'rgba(198,42,29,0.09)', word: 'NOT GO TIME' },
  stirring: { color: '#F59E0B', day: '#92600b', glow: 'rgba(245,158,11,0.15)', dayGlow: 'rgba(146,96,11,0.1)', word: 'STIRRING' },
  rotating: { color: '#10B981', day: '#046a50', glow: 'rgba(16,185,129,0.15)', dayGlow: 'rgba(4,106,80,0.09)', word: 'ROTATING IN' },
  gotime: { color: '#34D399', day: '#04785a', glow: 'rgba(52,211,153,0.18)', dayGlow: 'rgba(4,120,90,0.1)', word: 'GO TIME' },
  unknown: { color: '#9aa0ad', day: '#64748b', glow: 'rgba(255,255,255,0.05)', dayGlow: 'rgba(100,116,139,0.06)', word: '—' },
}
const VIBE = {
  atl: { color: '#EF4444', day: '#b3231a', label: 'At the lows' },
  bleed: { color: '#F87171', day: '#c62a1d', label: 'Bleeding' },
  quiet: { color: '#9aa0ad', day: '#475569', label: 'Quiet · basing' },
  recover: { color: '#10B981', day: '#046a50', label: 'Recovering' },
  hot: { color: '#34D399', day: '#04785a', label: 'Heating up' },
}
const SIG = { bull: '#34D399', bear: '#F87171', neutral: '#9aa0ad' }
const SIG_DAY = { bull: '#04785a', bear: '#c62a1d', neutral: '#475569' }
// the depth ladder is the same five steps, read off a 0-100 position
const zoneOf = (pos, day) => (
  pos < 20 ? (day ? '#b3231a' : '#EF4444')
    : pos < 45 ? (day ? '#c62a1d' : '#F87171')
      : pos < 70 ? (day ? '#92600b' : '#F59E0B')
        : (day ? '#04785a' : '#34D399')
)

const pctTxt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`)
// The recorder writes every 15 min. Three missed ticks is a stall, not jitter —
// say so rather than letting a hours-old print sit under a Live pill.
// after a seam the number is measured over a shorter window; the label says so
const winTxt = (d) => (d == null ? '7d' : d >= 1 ? `${Math.round(d)}d` : `${Math.max(1, Math.round(d * 24))}h`)
const staleTxt = (at) => {
  if (!at) return null
  const mins = (Date.now() - at) / 60000
  if (mins < 45) return null
  return mins < 120 ? `${Math.round(mins)}m ago` : `${Math.round(mins / 60)}h ago`
}
const pctClass = (v) => (v == null ? 'neu' : v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'neu')

function usdShort(v) {
  if (v == null || !isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

// ── OTHERS2 cycle chart (canvas — renders identically everywhere) ────────────
// Axis chrome is shared with the Command Center's OTHERS2 line (@/lib/chart-axis)
// so the two surfaces read as the same chart.
function drawCycle(canvas, wrap, pts, money) {
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
  const pad = (vMax - vMin) * 0.1 || vMax * 0.06, lo = Math.max(0, vMin - pad), hi = vMax + pad
  const yt = niceTicks(lo, hi, 5)
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
  drawSpectreWatermark(ctx, { w: W, h: H, dark: true, corner: 'bl', plot })
}
// index family — OTHERS2 is OUR recorded line (canvas); the CRYPTOCAP symbols
// are TradingView macro proxies. "total 1 2 3, others 1 2, othersd".
const INDEXES = [
  { id: 'OWN', label: 'OTHERS2', hint: 'ex top 100 · our line', native: true },
  { id: 'BINANCE:ETHBTC', label: 'ETH/BTC', hint: 'rotation signal - ETH priced in BTC' },
  { id: 'CRYPTOCAP:OTHERS', label: 'OTHERS', hint: 'ex top 10' },
  { id: 'CRYPTOCAP:OTHERS.D', label: 'OTHERS.D', hint: 'others dominance' },
  { id: 'CRYPTOCAP:TOTAL', label: 'TOTAL', hint: 'total market cap' },
  { id: 'CRYPTOCAP:TOTAL2', label: 'TOTAL2', hint: 'ex BTC' },
  { id: 'CRYPTOCAP:TOTAL3', label: 'TOTAL3', hint: 'ex BTC + ETH' },
]
// OTHERS2 is a slice we RECORD forward (it cannot be reconstructed - it is the
// difference of two huge numbers), so the ranges are what the tape actually
// holds. The 3M/1Y buttons used to draw the weekly model that precedes the
// recorder; see the note in use-alt-rotation.js.
const OWN_TF = [{ k: 'live', d: 1, label: '24H' }, { k: '7d', d: 7, label: '7D' }, { k: 'all', d: Infinity, label: 'ALL' }]
const TV_TF = [{ k: '60', label: '4H' }, { k: '240', label: '1D' }, { k: 'D', label: '1W' }, { k: 'W', label: '1M' }]
function tvEmbed(symbol, interval) {
  const p = new URLSearchParams({
    frameElementId: 'ar_tv', symbol, interval, theme: 'dark', style: '3',
    hide_top_toolbar: '1', hide_side_toolbar: '1', hide_legend: '1',
    allow_symbol_change: '0', save_image: '0', withdateranges: '0', backgroundColor: 'rgba(9,9,11,1)',
  })
  return `https://s.tradingview.com/widgetembed/?${p.toString()}`
}

function IndexChart({ others2, money }) {
  const [idx, setIdx] = useState('OWN')
  const [ownTf, setOwnTf] = useState('all')
  const [tvTf, setTvTf] = useState('D')
  const wrapRef = useRef(null), canvasRef = useRef(null)
  const active = INDEXES.find((i) => i.id === idx) || INDEXES[0]
  const isOwn = active.native
  const hist = others2?.history || []
  // Raw, this tape draws as an EKG - see the medianBars() note in
  // alt-rotation-core.js for why (OTHERS2 is a derived sliver, not a price).
  const pts = useMemo(() => {
    if (hist.length < 2) return []
    const days = OWN_TF.find((t) => t.k === ownTf)?.d ?? Infinity
    const cut = isFinite(days) ? Date.now() - days * 864e5 : -Infinity
    const s = hist.filter((p) => p.ts >= cut)
    const sel = s.length >= 2 ? s : hist.slice(-Math.min(hist.length, 8))
    // `others2.current` pins the final bar, so the tag on the line prints the
    // same market cap as the header on every timeframe (see medianBars).
    return medianBars(sel, ownTf === 'live' ? 24 : ownTf === '7d' ? 42 : 36, others2?.current)
  }, [hist, ownTf, others2?.current])
  useEffect(() => {
    if (!isOwn) return
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (!wrap || !canvas) return
    const draw = () => drawCycle(canvas, wrap, pts, money)
    draw()
    let ro; if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(draw); ro.observe(wrap) }
    return () => { if (ro) ro.disconnect() }
  }, [pts, money, isOwn])
  return (
    <section className="ar-chart-card">
      <div className="ar-chart-head">
        <div className="ar-chart-idx">
          {INDEXES.map((i) => (
            <button key={i.id} className={`ar-ix${idx === i.id ? ' on' : ''}${i.native ? ' ar-ix-own' : ''}`} onClick={() => setIdx(i.id)} title={i.hint}>{i.label}</button>
          ))}
        </div>
        <div className="ar-chart-meta">
          {isOwn && <span className="ar-chart-now">{usdShort(others2?.current)}{others2?.trend7d != null ? <em className={pctClass(others2.trend7d)} style={{ fontStyle: 'normal', marginLeft: 6 }}> {pctTxt(others2.trend7d)} {winTxt(others2.trendDays)}</em> : null}</span>}
          <div className="ar-tf">
            {(isOwn ? OWN_TF : TV_TF).map((t) => (
              <button key={t.k} className={(isOwn ? ownTf : tvTf) === t.k ? 'on' : ''} onClick={() => (isOwn ? setOwnTf(t.k) : setTvTf(t.k))}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="ar-chart-sub">
        {active.label} · {active.hint}
        {isOwn
          ? (others2?.recordedFrom
            ? ` · our own tape, every 15 min since ${new Date(others2.recordedFrom).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
            : ' · live recorded')
          : ' · TradingView'}
        {isOwn && staleTxt(others2?.currentAt) && <span className="ar-stale"> · last print {staleTxt(others2.currentAt)}</span>}
        {isOwn && others2?.seamAt && (
          <span className="ar-stale" title="OTHERS2 stopped being total minus the top 100 (the two CoinGecko aggregates drifted far enough apart that the tail came out negative) and became a direct sum of ranks 101-2000. Readings before that point are chain-linked onto the new basis, so the line and the trend are continuous — the step was the measurement, not the market.">
            {' '}· rebased {new Date(others2.seamAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
      {isOwn ? (
        pts.length >= 2
          ? <div className="ar-chart-wrap" ref={wrapRef}><canvas className="ar-chart-canvas" ref={canvasRef} /></div>
          : <div className="ar-chart-empty" aria-label="Loading chart" />
      ) : (
        <div className="ar-chart-wrap">
          <iframe key={idx + tvTf} className="ar-tv" src={tvEmbed(active.id, tvTf)} title={active.label} frameBorder="0" scrolling="no" />
        </div>
      )}
    </section>
  )
}

function DepthGauge({ depth }) {
  // 🪤 Read dayMode from the store, not from a CSS class on the shell: a PRO
  // theme can force day mode without the user's own toggle moving, and these
  // colours are inline, so CSS cannot rescue them either way.
  const dayMode = useSettingsStore((st) => st.dayMode)
  if (!depth) return null
  const pos = depth.posInRange ?? 0
  const zoneColor = zoneOf(pos, dayMode)
  return (
    <div className="ar-depth">
      <div className="ar-depth-top">
        <span className="ar-depth-lbl">Microcap depth · OTHERS2 vs its cycle</span>
        <b className="ar-depth-pct" style={{ color: zoneColor }}>{Math.round(depth.pctBelowPeak)}% below peak</b>
      </div>
      <div className="ar-depth-track">
        <span className="ar-depth-marker" style={{ left: `${pos}%`, borderColor: zoneColor }} />
      </div>
      <div className="ar-depth-scale">
        <span>{usdShort(depth.low)}<i>cycle floor</i></span>
        <span className="ar-depth-zone" style={{ color: zoneColor }}>{depth.zone}</span>
        <span className="ar-depth-r">{usdShort(depth.ath)}<i>{depth.athYear || ''} peak</i></span>
      </div>
    </div>
  )
}

function VerdictHero({ verdict, signals, others2, depth, majors }) {
  const dayMode = useSettingsStore((st) => st.dayMode)
  const rawBand = BAND[verdict?.band || 'unknown']
  const band = dayMode ? { ...rawBand, color: rawBand.day, glow: rawBand.dayGlow } : rawBand
  const sig = dayMode ? SIG_DAY : SIG
  const score = verdict?.score
  const setup = verdict?.setup
  const frontrun = verdict?.frontrun
  // The line is written in alt-rotation-core from the same numbers the chips
  // print, so the hero can no longer say "the long tail bleeding" over a chip
  // reading "+2.8%". Lite reads the same field.
  const sub = score == null ? 'Reading the tape…' : (verdict?.note || '')

  return (
    /* The hero used to be ONE 530px box with two ragged columns inside it, so
       the right column ran out ~100px above the left and left a hole in the
       corner, and the six reason pills reflowed into rows of 2/3/1 — which
       reads as text wrapping, not as a designed grid.
       It is now two column STACKS of independent cards, the way /fear-greed
       composes its own hero. Deliberately NOT four cards on the grid directly:
       a grid row is as tall as its tallest cell, so the shorter card in each
       row grows a dead tail underneath it — which is the same hole moved to a
       new place. In a stack each card is followed immediately by the next.
       The reasons sit under both, in one even row of equal cells. */
    <section className="ar-hero" style={{ '--band': band.color, '--glow': band.glow }}>
      <div className="ar-hero-col ar-hero-col--main">
      <article className="ar-card ar-card--verdict">
        <div className="ar-eyebrow">Rotation verdict · is it go time?</div>
        <div className="ar-verdict-word">{band.word}</div>
        <p className="ar-verdict-sub">{sub}</p>
        {majors?.length > 0 && (
          <div className="ar-majors">
            <span className="ar-majors-lbl">Majors 30d</span>
            {majors.map((m) => (
              <span className="ar-major" key={m.sym}><b>{m.sym}</b><em className={pctClass(m.chg30d)}>{pctTxt(m.chg30d, 0)}</em></span>
            ))}
            <span className="ar-majors-arrow">→ micros?</span>
          </div>
        )}
      </article>

      {(setup || frontrun) && (
        <article className="ar-card ar-card--read">
          {setup && (
            <div className={`ar-setup ar-setup--${setup.tone}`}>
              <span className="ar-setup-tag">The setup</span>
              <span className="ar-setup-txt">{setup.text}</span>
            </div>
          )}
          {frontrun && (
            <div className="ar-frontrun">
              <span className="ar-fr-tag">Front-run</span>
              <span className="ar-fr-txt">{frontrun.text}</span>
            </div>
          )}
        </article>
      )}
      </div>

      <div className="ar-hero-col ar-hero-col--side">
      <article className="ar-card ar-card--readiness">
        <div className="ar-gauge-num">{score ?? '—'}<b>/100</b></div>
        <div className="ar-gauge-cap">rotation readiness</div>
        <div className="ar-gauge-track">
          <span className="ar-gauge-fill" style={{ width: `${score ?? 0}%`, background: band.color, boxShadow: `0 0 16px ${band.glow}` }} />
        </div>
        <div className="ar-gauge-scale"><span>Dead</span><span>Stirring</span><span>Go time</span></div>
        <div className="ar-hero-stats">
          <div className="ar-hs"><span>BTC dominance</span><b>{signals?.btcDominance != null ? `${signals.btcDominance.toFixed(1)}%` : '—'}<em className={pctClass(signals?.domDelta30d)}>{signals?.domDelta30d != null ? ` ${signals.domDelta30d >= 0 ? '+' : ''}${signals.domDelta30d.toFixed(1)}pt 30d` : ''}</em></b></div>
          <div className="ar-hs">
            <span>Long tail (OTHERS2){staleTxt(others2?.currentAt) && <i className="ar-stale"> · {staleTxt(others2.currentAt)}</i>}</span>
            <b>{usdShort(others2?.current)}<em className={pctClass(others2?.trend7d)}>{others2?.trend7d != null ? ` ${pctTxt(others2.trend7d)} ${winTxt(others2.trendDays)}` : ''}</em></b>
          </div>
        </div>
      </article>

      <article className="ar-card ar-card--depth">
        <DepthGauge depth={depth} />
      </article>
      </div>

      {/* one even row of cells — six pills of six different widths were the
          other half of what read as unfinished */}
      <div className="ar-reasons">
        {(verdict?.reasons || []).map((r, i) => (
          <div className="ar-reason" key={i}>
            <span className="ar-reason-dot" style={{ background: sig[r.signal] }} />
            <span className="ar-reason-lbl">{r.label}</span>
            <span className="ar-reason-val" style={{ color: sig[r.signal] }}>{r.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// per-chain on-chain DEX volume chart — bars over ~60 days, colored by trend
function drawDex(canvas, wrap, chart, accent, up) {
  if (!canvas || !wrap || !chart || chart.length < 2) return
  const W = wrap.clientWidth, H = wrap.clientHeight
  if (W < 20 || H < 12) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
  const vs = chart.map((p) => p.v), vMax = Math.max(...vs, 1)
  const n = chart.length, gap = 1, bw = Math.max(1, (W - gap * (n - 1)) / n)
  const col = up ? 'rgba(52,211,153,0.7)' : (accent || '#8a92b2')
  for (let i = 0; i < n; i++) {
    const h = Math.max(1, (vs[i] / vMax) * (H - 2))
    ctx.fillStyle = i >= n - 1 ? (up ? '#34D399' : '#F59E0B') : col
    ctx.globalAlpha = 0.35 + 0.65 * (i / n)
    ctx.fillRect(i * (bw + gap), H - h, bw, h)
  }
  ctx.globalAlpha = 1
}
function DexChart({ chart, accent, up, onExpand }) {
  const wrapRef = useRef(null), canvasRef = useRef(null)
  const recent = useMemo(() => (chart || []).slice(-60), [chart])
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (!wrap || !canvas) return
    const draw = () => drawDex(canvas, wrap, recent, accent, up)
    draw()
    let ro; if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(draw); ro.observe(wrap) }
    return () => { if (ro) ro.disconnect() }
  }, [recent, accent, up])
  if (!chart || chart.length < 2) return null
  return (
    <div className="ar-dexchart" ref={wrapRef} onClick={onExpand} role="button" title="Expand">
      <canvas ref={canvasRef} />
      <span className="ar-dexchart-exp" aria-hidden>⤢</span>
    </div>
  )
}

// axed DEX volume chart for the fullscreen modal
const DEX_TF = [{ k: 30, label: '30D' }, { k: 90, label: '90D' }, { k: 180, label: '6M' }, { k: 400, label: '1Y' }]
function drawDexBig(canvas, wrap, chart, up, money) {
  if (!canvas || !wrap || !chart || chart.length < 2) return
  const W = wrap.clientWidth, H = wrap.clientHeight
  if (W < 20 || H < 20) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
  const mL = 6, mR = 62, mT = 10, mB = 22, pw = W - mL - mR, ph = H - mT - mB
  const vs = chart.map((p) => p.v), vMax = Math.max(...vs, 1), col = up ? '#34D399' : '#F59E0B'
  ctx.font = '600 11px -apple-system, Inter, sans-serif'; ctx.textBaseline = 'middle'
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.fillStyle = 'rgba(245,245,247,0.62)'; ctx.textAlign = 'right'
  for (const f of [0, 0.5, 1]) { const y = mT + ph * (1 - f); ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pw, y); ctx.stroke(); ctx.fillText(money(vMax * f), W - 6, y) }
  const n = chart.length, gap = n > 120 ? 0.4 : 1, bw = Math.max(0.8, (pw - gap * (n - 1)) / n)
  for (let i = 0; i < n; i++) {
    const h = Math.max(1, (vs[i] / vMax) * ph)
    ctx.fillStyle = i >= n - 1 ? col : col
    ctx.globalAlpha = 0.3 + 0.6 * (i / n)
    ctx.fillRect(mL + i * (bw + gap), mT + ph - h, bw, h)
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(245,245,247,0.55)'; ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'; ctx.fillText(new Date(chart[0].ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), mL, H - 6)
  ctx.textAlign = 'right'; ctx.fillText(new Date(chart[n - 1].ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), mL + pw, H - 6)
}
function DexModal({ chain, money, onClose }) {
  const [tf, setTf] = useState(90)
  const wrapRef = useRef(null), canvasRef = useRef(null)
  const chart = useMemo(() => (chain?.dex?.chart || []).slice(-tf), [chain, tf])
  const up = chain?.dex?.chg7d != null && chain.dex.chg7d >= 0
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (!wrap || !canvas) return
    const draw = () => drawDexBig(canvas, wrap, chart, up, money)
    draw()
    let ro; if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(draw); ro.observe(wrap) }
    return () => { if (ro) ro.disconnect() }
  }, [chart, up, money])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  if (!chain) return null
  const d = chain.dex
  // PORTAL, mandatory: `.page-layout` (the page scroll container) sets
  // `transform: translateZ(0)`, which makes it the containing block for
  // position:fixed descendants — rendered in place, the overlay anchored to the
  // top of the scrolled DOCUMENT instead of the viewport (it appeared jammed
  // under the header, half off-screen). Only the mobile media query strips that
  // transform. Portal target is `.app` (untransformed) rather than <body> so the
  // `.app.app-day-mode ...` overrides still match.
  const node = (
    <div className="ar-dexmodal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="ar-dexmodal-box" onClick={(e) => e.stopPropagation()}>
        <div className="ar-dexmodal-head">
          <div className="ar-dexmodal-id"><span className="ar-chain-dot" style={{ background: chain.accent }} /><b>{chain.name}</b><span className="ar-dexmodal-sub">on-chain DEX volume</span></div>
          <div className="ar-dexmodal-tools">
            <div className="ar-tf">{DEX_TF.map((t) => <button key={t.k} className={tf === t.k ? 'on' : ''} onClick={() => setTf(t.k)}>{t.label}</button>)}</div>
            <button className="ar-dexmodal-close" onClick={onClose} title="Close (Esc)">✕</button>
          </div>
        </div>
        <div className="ar-dexmodal-stats">
          <span>24h <b>{usdShort(d?.vol24h)}</b></span>
          <span>7d <b className={pctClass(d?.chg7d)}>{d?.chg7d != null ? pctTxt(d.chg7d, 0) : '—'}</b></span>
          <span>30d <b className={pctClass(d?.chg30d)}>{d?.chg30d != null ? pctTxt(d.chg30d, 0) : '—'}</b></span>
        </div>
        <div className="ar-dexmodal-chart" ref={wrapRef}><canvas ref={canvasRef} /></div>
      </div>
    </div>
  )
  if (typeof document === 'undefined') return node
  return createPortal(node, document.querySelector('.app') || document.body)
}

function MiniSplit({ label, data, accent }) {
  const br = data?.breadth7d
  return (
    <div className="ar-split">
      <div className="ar-split-head"><span>{label}</span><em>{data?.count || 0}</em></div>
      <div className="ar-split-bar"><span style={{ width: `${br ?? 0}%`, background: accent }} /></div>
      <div className="ar-split-foot">
        <span className={pctClass(data?.med7d)}>{pctTxt(data?.med7d)} <i className="ar-split-typ">typ 7d</i></span>
        <span className="ar-split-br">{br != null ? `${Math.round(br)}% green` : '—'}</span>
      </div>
    </div>
  )
}

function ChainCard({ c, onExpand }) {
  const dayMode = useSettingsStore((st) => st.dayMode)
  const raw = VIBE[c.vibe?.tone] || VIBE.quiet
  const vibe = dayMode ? { ...raw, color: raw.day } : raw
  const label = c.vibe?.label || vibe.label
  const dex = c.dex
  return (
    <div className="ar-chain" style={{ '--accent': c.accent }}>
      <div className="ar-chain-top">
        <div className="ar-chain-id">
          <span className="ar-chain-dot" style={{ background: c.accent }} />
          <b>{c.name}</b>
          <span className="ar-chain-mcap">{usdShort(c.mcap)}</span>
        </div>
        <span className="ar-vibe" style={{ color: vibe.color, borderColor: vibe.color + '55', background: vibe.color + '14' }}>{label}</span>
      </div>
      <div className="ar-health"><span className="ar-health-fill" style={{ width: `${c.vibe?.pct ?? 0}%`, background: vibe.color }} /></div>
      <div className="ar-chain-row">
        <div className="ar-cr"><span>DEX vol 24h</span><b>{dex?.vol24h != null ? usdShort(dex.vol24h) : '—'}</b></div>
        <div className="ar-cr"><span>DEX 7d</span><b className={pctClass(dex?.chg7d)}>{dex?.chg7d != null ? pctTxt(dex.chg7d, 0) : '—'}</b></div>
        <div className="ar-cr"><span>green 7d</span><b>{c.breadth7d != null ? `${Math.round(c.breadth7d)}%` : '—'}</b></div>
        <div className="ar-cr"><span>typ 30d</span><b className={pctClass(c.med30d)}>{pctTxt(c.med30d)}</b></div>
      </div>
      {dex?.chart?.length > 1 && (
        <div className="ar-dexblock">
          <div className="ar-dexblock-head"><span>On-chain DEX volume · 60d</span><em className={pctClass(dex?.chg7d)}>{dex?.chg7d != null ? `${pctTxt(dex.chg7d, 0)} 7d` : ''}</em></div>
          <DexChart chart={dex.chart} accent={c.accent} up={dex?.chg7d != null && dex.chg7d >= 0} onExpand={() => onExpand && onExpand(c)} />
        </div>
      )}
      <div className="ar-splits">
        {/* 🪤 The meme half used a picked purple (#c77dff); purple in the chrome
            is banned outright (design-system §A/§K) and this is a CATEGORY, not
            a brand. It takes the neutral ink — which has to flip with the
            theme, because a near-white bar on a white card is invisible. The
            utility half keeps the chain's own accent: that is real identity. */}
        <MiniSplit label="On-chain memes" data={c.meme} accent={dayMode ? 'rgba(15,23,42,0.42)' : 'rgba(245,245,247,0.55)'} />
        <MiniSplit label="Utilities" data={c.utility} accent={c.accent} />
      </div>
      {c.leaders?.length > 0 && (
        <div className="ar-leaders">
          {c.leaders.slice(0, 4).map((t, i) => (
            <div className="ar-lead" key={i} title={t.name}>
              {t.image ? <img src={t.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <span className="ar-lead-x">{(t.sym || '?')[0]}</span>}
              <span className="ar-lead-sym">{t.sym}</span>
              <span className={`ar-lead-chg ${pctClass(t.chg7d)}`}>{pctTxt(t.chg7d, 0)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ar-splitnote">meme/utility split is heuristic (est.)</div>
    </div>
  )
}

function Movers({ movers }) {
  if (!movers) return null
  const row = (t, up) => {
    const sym = String(t.symbol || t.sym || '').toUpperCase()
    // 🪤 `change` FIRST, and it is the only name that has ever been populated
    // here. getSpectreTokenMovers maps the box's /v1/bubbles rows through
    // `change: number(row.change ?? row.change_24h ?? row.change24h)`, so the
    // three names this used to read did not exist on a single row and every
    // value in both columns rendered as an em-dash. The split still looked
    // right because the SERVICE sorts by the same field it emits — only the
    // printed number was missing, which is why it read as a styling problem.
    const chg = Number(t.change ?? t.change_24h_pct ?? t.price_change_percentage_24h ?? t.change24h)
    return (
      <div className="ar-mv" key={sym + (t.name || '')}>
        <span className="ar-mv-sym">{sym}</span>
        {/* Precision follows magnitude. These are 24h movers and the tail of
            the list runs to ±0.0x, so a fixed 1 decimal printed BTC's -0.01%
            as "-0.0%" — a signed zero, which reads as a broken cell rather
            than a small number. Under 0.1 it takes a second decimal. */}
        <span className={`ar-mv-chg ${up ? 'up' : 'down'}`}>{pctTxt(chg, Math.abs(chg) < 0.1 ? 2 : 1)}</span>
      </div>
    )
  }
  return (
    <section className="ar-panel">
      <div className="ar-panel-head"><h3>Where the life is</h3><span>24h · isolated strength while the tail sleeps</span></div>
      <div className="ar-movers">
        <div className="ar-mv-col"><div className="ar-mv-lbl up">Bid</div>{(movers.gainers || []).map((t) => row(t, true))}</div>
        <div className="ar-mv-col"><div className="ar-mv-lbl down">Dumped</div>{(movers.losers || []).map((t) => row(t, false))}</div>
      </div>
    </section>
  )
}

// The pill was a boolean — "Reading tape" or "Live", forever — so a verdict
// seeded from localStorage rendered as "Live" while being minutes old. It now
// prints the age of the numbers under it, goes amber when they drift, and
// refetches on click.
function LivePill({ loading, refreshing, updatedAt, onRefresh }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const age = updatedAt ? Date.now() - updatedAt : null
  const stale = age != null && age > 150000
  const txt = loading ? 'Reading tape'
    : refreshing ? 'Updating'
      : age == null ? 'Live'
        : age < 5000 ? 'Live · just now'
          : age < 60000 ? `Live · ${Math.round(age / 1000)}s ago`
            : `Live · ${Math.round(age / 60000)}m ago`
  return (
    <button
      type="button"
      className={`ar-live${loading || refreshing || stale ? ' warm' : ''}`}
      onClick={onRefresh}
      title={updatedAt ? `Last read ${new Date(updatedAt).toLocaleTimeString()} · click to refresh` : 'Refresh'}
    >
      <i />{txt}
    </button>
  )
}

export default function AltRotationPage() {
  const { loading, verdict, signals, chains, others2, movers, depth, majors, updatedAt, refreshing, reload } = useAltRotation()
  useCurrency()
  const [dexModal, setDexModal] = useState(null)
  const dexModalChain = dexModal ? (chains.find((c) => c.key === dexModal.key) || dexModal) : null

  return (
    <div className="ar-page">
      <div className="ar-head">
        <div className="ar-head-lead">
          <span className="ar-kicker">Alt Rotation Radar</span>
          <h1 className="ar-title">Microcaps</h1>
          <p className="ar-sub">On-chain memes &amp; utilities · how dead is the tail, and will micros get bid when majors push?</p>
        </div>
        <LivePill loading={loading} refreshing={refreshing} updatedAt={updatedAt} onRefresh={() => reload({ withChains: true })} />
      </div>

      <VerdictHero verdict={verdict} signals={signals} others2={others2} depth={depth} majors={majors} />

      <IndexChart others2={others2} money={usdShort} />

      <section className="ar-panel">
        <div className="ar-panel-head"><h3>By chain</h3><span>DEX volume &amp; liveness · then meme vs utility (equal-weight)</span></div>
        <div className="ar-chains">
          {chains.length === 0 && loading
            ? Array.from({ length: 4 }).map((_, i) => <div className="ar-chain ar-skel" key={i} />)
            : chains.map((c) => <ChainCard c={c} key={c.key} onExpand={setDexModal} />)}
        </div>
      </section>

      <Movers movers={movers} />

      <div className="ar-foot">⌁ Spectre Alt Rotation · deterministic read from live breadth, dominance &amp; the OTHERS2 long tail · not financial advice</div>
      {dexModalChain && <DexModal chain={dexModalChain} money={usdShort} onClose={() => setDexModal(null)} />}
    </div>
  )
}
