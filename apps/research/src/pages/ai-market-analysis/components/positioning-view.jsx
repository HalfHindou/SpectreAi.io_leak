/**
 * Positioning — what the options market has priced, for equities.
 *
 * Dez asked for CBOE data on the stocks people here actually watch, framed as
 * a step into equities. A chain browser was the wrong answer: the raw feed is
 * megabytes and nobody reads 3,000 contracts. What a desk asks before a date
 * is narrower — what move is priced, where the book sits, and which day the
 * market thinks matters — so that is what this board answers.
 *
 * The term structure carries the whole thing. Implied volatility rises with
 * time when the calendar is empty; a dated event breaks that curve, because
 * the first expiry containing it pays for the whole jump and every later one
 * spreads the same jump over more days. The hump IS the date, read out of
 * prices rather than looked up in a calendar — which is why this finds NVDA's
 * print without being told a single thing about NVDA.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fmtPct1, fmtOi, fmtGex, fmtStrike, fmtDte, fmtExp,
  expectedRange, eventRead, gammaRead, pcRead, bookRows, termStructureRead,
  earningsRunway,
} from '@/lib/options-read'
import PricedMoveChart from './positioning-chart'
import EarningsCalendar from './positioning-calendar'
import './positioning-view.css'

const cx = (...a) => a.filter(Boolean).join(' ')

/* Grouped rather than one long pill row: an index, a crypto-equity and a
   megacap are different questions, and the grouping says so without a label. */
const GROUPS = [
  { id: 'index', label: 'Index', symbols: ['SPY', 'QQQ', 'IWM', 'GLD'] },
  { id: 'crypto', label: 'Crypto equities', symbols: ['COIN', 'MSTR', 'HOOD'] },
  { id: 'mega', label: 'Megacap', symbols: ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD', 'PLTR'] },
]
const ALL = GROUPS.flatMap((g) => g.symbols)
const STORE_KEY = 'spectre-positioning-symbol'

/* ── data ───────────────────────────────────────────────────────────────── */
const _cache = new Map()
function fetchChain(symbol) {
  const hit = _cache.get(symbol)
  if (hit && Date.now() - hit.ts < 4 * 60_000) return hit.p
  const p = fetch(`/api/equity-options?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(30000) })
    .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j?.error || `HTTP ${r.status}`)), () => Promise.reject(new Error(`HTTP ${r.status}`)))))
    .then((j) => (j?.chain?.length ? j : Promise.reject(new Error('No listed options for that symbol'))))
  _cache.set(symbol, { ts: Date.now(), p })
  p.catch(() => _cache.delete(symbol))
  return p
}

/* One call covers every ticker on the board — the calendar is the cheapest
   thing on this page and the only one that answers for all of them at once. */
let _calendar = null
function fetchCalendar() {
  if (_calendar && Date.now() - _calendar.ts < 30 * 60_000) return _calendar.p
  const p = fetch(`/api/stocks/earnings?symbols=${ALL.join(',')}`, { signal: AbortSignal.timeout(25000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => (Array.isArray(j?.earnings) ? j.earnings : Promise.reject(new Error('empty'))))
  _calendar = { ts: Date.now(), p }
  p.catch(() => { _calendar = null })
  return p
}

function useCalendar() {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    fetchCalendar().then((r) => { if (alive) setRows(r) }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [])
  return rows
}

function useChain(symbol) {
  const [s, setS] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    setS({ data: null, loading: true, error: null })
    fetchChain(symbol)
      .then((d) => { if (alive) setS({ data: d, loading: false, error: null }) })
      .catch((e) => { if (alive) setS({ data: null, loading: false, error: e.message || 'unavailable' }) })
    return () => { alive = false }
  }, [symbol])
  return s
}

/* Width from the element, not a prop — a fixed canvas width leaves the panel
   two-thirds empty, which is what reads as unfinished. */
function useWidth() {
  const roRef = useRef(null)
  const [w, setW] = useState(0)
  const ref = useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!node) return
    setW(node.clientWidth)
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(node); roRef.current = ro
  }, [])
  return [ref, w]
}

/* ── term structure ─────────────────────────────────────────────────────── */
const TermCanvas = React.memo(({ chain, event, w, h }) => {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !chain?.length || w < 80) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = w * dpr; cv.height = h * dpr
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const pts = chain.filter((c) => Number.isFinite(c.atmIv) && c.atmIv > 0)
    if (pts.length < 2) return

    const padL = 44, padR = 14, padT = 18, padB = 30
    const iw = w - padL - padR, ih = h - padT - padB
    const ivs = pts.map((p) => p.atmIv)
    const lo = Math.max(0, Math.min(...ivs) * 0.88)
    const hi = Math.max(...ivs) * 1.06
    const span = hi - lo || 1
    const x = (i) => padL + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw)
    const y = (v) => padT + ih - ((v - lo) / span) * ih

    const css = getComputedStyle(cv)
    const grid = css.getPropertyValue('--po-canvas-grid').trim() || 'rgba(255,255,255,0.08)'
    const label = css.getPropertyValue('--po-canvas-label').trim() || 'rgba(255,255,255,0.45)'
    const line = css.getPropertyValue('--po-canvas-line').trim() || 'rgba(129,140,248,0.95)'
    const fill0 = css.getPropertyValue('--po-canvas-fill0').trim() || 'rgba(129,140,248,0.26)'
    const fill1 = css.getPropertyValue('--po-canvas-fill1').trim() || 'rgba(129,140,248,0.02)'
    const mark = css.getPropertyValue('--po-canvas-mark').trim() || 'rgba(251,191,36,0.9)'

    // horizontal grid + IV axis
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    for (let g = 0; g <= 3; g++) {
      const v = lo + (span * g) / 3
      const gy = Math.round(y(v)) + 0.5
      ctx.strokeStyle = grid; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke()
      ctx.fillStyle = label
      ctx.fillText(`${(v * 100).toFixed(0)}%`, padL - 8, gy)
    }

    // the event marker sits UNDER the curve so the curve stays readable
    if (event) {
      const ei = pts.findIndex((p) => p.exp === event.exp)
      if (ei >= 0) {
        const ex = Math.round(x(ei)) + 0.5
        ctx.save()
        ctx.setLineDash([3, 3]); ctx.strokeStyle = mark; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(ex, padT - 6); ctx.lineTo(ex, padT + ih); ctx.stroke()
        ctx.restore()
      }
    }

    // area
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih)
    grad.addColorStop(0, fill0); grad.addColorStop(1, fill1)
    ctx.beginPath(); ctx.moveTo(x(0), y(ivs[0]))
    for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(ivs[i]))
    ctx.lineTo(x(pts.length - 1), padT + ih); ctx.lineTo(x(0), padT + ih); ctx.closePath()
    ctx.fillStyle = grad; ctx.fill()

    // curve
    ctx.beginPath(); ctx.moveTo(x(0), y(ivs[0]))
    for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(ivs[i]))
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()

    // points — the event expiry gets the emphasis
    pts.forEach((p, i) => {
      const isEvent = event && p.exp === event.exp
      ctx.beginPath(); ctx.arc(x(i), y(p.atmIv), isEvent ? 4.5 : 2.6, 0, Math.PI * 2)
      ctx.fillStyle = isEvent ? mark : line; ctx.fill()
      if (isEvent) {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke()
      }
    })

    // Expiry axis. Thinning by a fixed step is not enough on a phone: the
    // event label is always drawn, so it lands next to a stepped one and the
    // two run together ("24 Aug 28 Aug 31 Aug"). Measure each label and skip
    // any that would touch the last one drawn — the priced date claims its
    // space first, because it is the one worth reading.
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    const ay = padT + ih + 9
    const order = []
    const evIdx = event ? pts.findIndex((p) => p.exp === event.exp) : -1
    if (evIdx >= 0) order.push(evIdx)
    order.push(0, pts.length - 1)
    for (let i = 1; i < pts.length - 1; i++) if (i !== evIdx) order.push(i)

    const taken = []
    for (const i of order) {
      const text = fmtExp(pts[i].exp)
      const half = ctx.measureText(text).width / 2 + 6
      const cx0 = Math.min(Math.max(x(i), padL + half), w - padR - half)
      if (taken.some((t) => Math.abs(t.c - cx0) < t.half + half)) continue
      taken.push({ c: cx0, half })
      ctx.fillStyle = i === evIdx ? mark : label
      ctx.fillText(text, cx0, ay)
    }
  }, [chain, event, w, h])
  return <canvas ref={ref} style={{ width: '100%', height: h, display: 'block' }} aria-hidden />
})

function TermStructure({ chain, event, isMobile }) {
  const [hostRef, w] = useWidth()
  return (
    <div className="po-canvas-host" ref={hostRef}>
      {w > 80 && <TermCanvas chain={chain} event={event} w={w} h={isMobile ? 190 : 240} />}
    </div>
  )
}

/* ── the book ───────────────────────────────────────────────────────────── */
function Book({ book, spot, maxPain, wall }) {
  if (!book) return <p className="po-empty">No open interest to draw at this expiry.</p>
  const { rows, max } = book
  // Where spot falls in the ladder, so the marker sits between the two strikes
  // it belongs between rather than snapping to the nearest row.
  const spotIdx = rows.findIndex((r) => r.k > spot)
  return (
    <div className="po-book" role="table" aria-label="Open interest by strike">
      <div className="po-book-head" role="row">
        <span className="po-book-h po-book-h--p">Puts</span>
        <span className="po-book-h po-book-h--k">Strike</span>
        <span className="po-book-h po-book-h--c">Calls</span>
      </div>
      {rows.map((r, i) => {
        const showSpot = i === spotIdx
        const isPain = maxPain != null && r.k === maxPain
        const isWall = wall != null && r.k === wall
        return (
          <React.Fragment key={r.k}>
            {showSpot && (
              <div className="po-spot-rule" aria-hidden>
                <span>spot {fmtStrike(spot)}</span>
              </div>
            )}
            <div className={cx('po-book-row', (isPain || isWall) && 'is-marked')} role="row">
              <div className="po-bar po-bar--p">
                {r.p > 0 && <span className="po-bar-fill" style={{ width: `${(r.p / max) * 100}%` }} />}
                {r.p > 0 && <span className="po-bar-val">{fmtOi(r.p)}</span>}
              </div>
              <div className="po-book-k">
                <span className="po-k-val">{fmtStrike(r.k)}</span>
                {(isPain || isWall) && (
                  <span className="po-k-tags">
                    {isPain && <i className="po-tag po-tag--pain">pain</i>}
                    {isWall && <i className="po-tag po-tag--wall">gex</i>}
                  </span>
                )}
              </div>
              <div className="po-bar po-bar--c">
                {r.c > 0 && <span className="po-bar-fill" style={{ width: `${(r.c / max) * 100}%` }} />}
                {r.c > 0 && <span className="po-bar-val">{fmtOi(r.c)}</span>}
              </div>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

/* ── the board ──────────────────────────────────────────────────────────── */
export default function PositioningView({ isMobile }) {
  const [symbol, setSymbol] = useState(() => {
    try { const s = localStorage.getItem(STORE_KEY); if (s && /^[A-Z.]{1,6}$/.test(s)) return s } catch { /* private mode */ }
    return 'NVDA'
  })
  const [draft, setDraft] = useState('')
  const [expiry, setExpiry] = useState(null)
  const { data, loading, error } = useChain(symbol)
  const calendarRows = useCalendar()

  useEffect(() => { try { localStorage.setItem(STORE_KEY, symbol) } catch { /* private mode */ } }, [symbol])
  // A held expiry from the last symbol does not exist on the next one.
  useEffect(() => { setExpiry(null) }, [symbol])

  const chosen = expiry || data?.focus || null
  const row = useMemo(
    () => (chosen === '__all' ? null : data?.chain?.find((c) => c.exp === chosen)) || data?.chain?.[0] || null,
    [data, chosen],
  )

  const bookSource = useMemo(() => {
    if (!data?.chain?.length) return null
    if (chosen !== '__all') return row?.byStrike || null
    // Every expiry stacked: the standing book across the whole chain.
    const agg = new Map()
    for (const c of data.chain) {
      for (const s of c.byStrike || []) {
        const cur = agg.get(s.k) || { k: s.k, c: 0, p: 0 }
        cur.c += s.c; cur.p += s.p; agg.set(s.k, cur)
      }
    }
    return [...agg.values()].sort((a, b) => a.k - b.k)
  }, [data, chosen, row])

  const book = useMemo(
    () => bookRows(bookSource, data?.spot || 0, isMobile ? 18 : 26),
    [bookSource, data, isMobile],
  )

  const ev = data ? eventRead(data.event, data.symbol) : null
  const term = data ? termStructureRead(data.chain, data.event, data.symbol) : null
  const runway = useMemo(() => earningsRunway(calendarRows), [calendarRows])
  const gam = data ? gammaRead(data.gamma, data.spot) : null
  const range = row ? expectedRange(data.spot, row.expectedMove) : null

  const submit = (e) => {
    e.preventDefault()
    const s = draft.trim().toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6)
    if (s) { setSymbol(s); setDraft('') }
  }

  return (
    <div className="po-root">
      {/* ── picker ── */}
      <div className="po-picker">
        {GROUPS.map((g) => (
          <div className="po-pgroup" key={g.id}>
            <span className="po-pgroup-label">{g.label}</span>
            <div className="po-pills">
              {g.symbols.map((s) => (
                <button
                  key={s}
                  className={cx('po-pill', symbol === s && 'is-active')}
                  onClick={() => setSymbol(s)}
                  aria-pressed={symbol === s}
                >{s}</button>
              ))}
            </div>
          </div>
        ))}
        <form className="po-pgroup po-pgroup--form" onSubmit={submit}>
          <span className="po-pgroup-label">Any US ticker</span>
          <input
            className="po-input ui-bare-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={ALL.includes(symbol) ? 'e.g. SMCI' : symbol}
            aria-label="Look up another ticker"
            maxLength={6}
            spellCheck={false}
          />
        </form>
      </div>

      {/* The calendar, board-wide. Per-symbol it names the print behind a vol
          lift; here it answers "what is coming at all", which is the question a
          reader has before they know which ticker to open. */}
      {runway.length > 0 && (
        <EarningsCalendar runway={runway} symbol={symbol} onPick={setSymbol} />
      )}

      {loading && <div className="po-panel po-boot"><span /><span /><span /></div>}

      {!loading && error && (
        <div className="po-panel po-error">
          <h3>{symbol} — {error}</h3>
          <p>CBOE lists options on US-listed equities and ETFs. Try a ticker above.</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* ═══ the read ═══ */}
          <section className="po-panel po-read">
            <div className="po-read-lead">
              <div className="po-sym">
                <h2>{data.symbol}</h2>
                <span className="po-spot">${data.spot?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="po-src">
                <span className="po-chip po-chip--src">{data.source}{data.delayed ? ' · delayed' : ''}</span>
                <span className="po-src-note">{data.contracts.toLocaleString()} contracts · {data.expiries.length} expiries</span>
              </div>
            </div>

            {/* Orientation for the reader who has never traded an option — the
                board's audience includes them, and without this line nothing
                below has a frame to hang on. */}
            <p className="po-primer">
              Options are side-bets on the stock — calls pay off if it rises, puts if it falls — and
              their prices expose what the market collectively expects. This board reads {data.symbol}&rsquo;s
              full listed chain and answers three questions: <b>how big</b> a move is priced, <b>by which
              date</b>, and <b>at which price levels</b> the money is parked.
            </p>

            <div className={cx('po-event', ev.strength && `is-${ev.strength}`)}>
              <div className="po-event-head">
                <h3>{ev.headline}</h3>
                {/* Once the calendar has named the event, "clear signal" is the
                    weaker statement — say what it IS. The strength grade only
                    has to carry the read when nothing named it. */}
                {ev.kind === 'earnings'
                  ? <span className="po-chip po-chip--strong">earnings</span>
                  : ev.kind === 'not-earnings'
                    ? <span className="po-chip po-chip--moderate">not earnings</span>
                    : ev.strength && <span className={cx('po-chip', `po-chip--${ev.strength}`)}>{ev.strength === 'strong' ? 'clear signal' : 'above noise'}</span>}
              </div>
              <p>{ev.body}</p>
              {/* The plain-language line travels WITH the read: it used to be a
                  static string that assumed we never know the reason, which
                  contradicted the sentence above it the moment the calendar
                  named one — or ruled one out. */}
              {ev.plain && <p className="po-plain">{ev.plain}</p>}
            </div>

            {range && (
              <div className="po-cone">
                <div className="po-cone-head">
                  <span className="po-cone-title">Priced move to {fmtExp(row.exp)}</span>
                  <span className="po-cone-sub">{fmtDte(row.dte)} · from the {fmtStrike(row.atm)} straddle at ${row.straddle}</span>
                </div>
                <div className="po-cone-track">
                  <span className="po-cone-band" />
                  <span className="po-cone-mid" />
                  {data.gamma?.flip != null && Math.abs(data.gamma.flip - data.spot) < data.spot * range.pct && (
                    <span
                      className="po-cone-flip"
                      style={{ left: `${((data.gamma.flip - range.lo) / (range.hi - range.lo)) * 100}%` }}
                      title={`Gamma flip ${fmtStrike(data.gamma.flip)}`}
                    />
                  )}
                  {row.maxPain != null && Math.abs(row.maxPain - data.spot) < data.spot * range.pct && (
                    <span
                      className="po-cone-pain"
                      style={{ left: `${((row.maxPain - range.lo) / (range.hi - range.lo)) * 100}%` }}
                      title={`Max pain ${fmtStrike(row.maxPain)}`}
                    />
                  )}
                </div>
                <div className="po-cone-scale">
                  <span className="po-cone-lo">${range.lo.toFixed(2)}</span>
                  <span className="po-cone-pct">±{(range.pct * 100).toFixed(1)}%</span>
                  <span className="po-cone-hi">${range.hi.toFixed(2)}</span>
                </div>
                <p className="po-note">
                  A straddle — one call plus one put at the current price — profits from a move in
                  either direction, so what traders pay for it is the market&rsquo;s own estimate of the
                  move. Ending anywhere inside this band by {fmtExp(row.exp)} is already paid for;
                  only a move beyond it counts as a surprise.
                </p>
              </div>
            )}

            <div className="po-stats">
              <div className="po-stat">
                <span className="po-stat-k">Chain put/call</span>
                <span className="po-stat-v">{data.totals.pcOi ?? '—'}</span>
                <span className="po-stat-n">{pcRead(data.totals.pcOi)} · on open interest</span>
                <span className="po-stat-g">puts held per call held — below 1.0 the book leans toward upside bets</span>
              </div>
              <div className="po-stat">
                <span className="po-stat-k">Open interest</span>
                <span className="po-stat-v">{fmtOi(data.totals.callOi + data.totals.putOi)}</span>
                <span className="po-stat-n">{fmtOi(data.totals.callOi)} calls · {fmtOi(data.totals.putOi)} puts</span>
                <span className="po-stat-g">every contract currently open — the size of the standing book</span>
              </div>
              <div className="po-stat">
                <span className="po-stat-k">At-the-money vol</span>
                <span className="po-stat-v">{fmtPct1(row?.atmIv)}</span>
                <span className="po-stat-n">{fmtExp(row?.exp)} expiry</span>
                <span className="po-stat-g">how violent a move options are priced for — higher means bigger expected swings</span>
              </div>
              <div className="po-stat">
                <span className="po-stat-k">Max pain</span>
                <span className="po-stat-v">{fmtStrike(row?.maxPain)}</span>
                <span className="po-stat-n">{fmtExp(row?.exp)} expiry</span>
                <span className="po-stat-g">the price where the most option value dies worthless — often watched as a magnet into expiry</span>
              </div>
            </div>
          </section>

          {/* ═══ the priced move — the tape with the cone on it ═══ */}
          {row && (
            <section className="po-panel">
              <div className="po-panel-head">
                <h3>The priced move</h3>
                <span className="po-panel-sub">daily candles, and where the {fmtExp(row.exp)} options say price lands</span>
                {!isMobile && (
                  <span className="po-legend">
                    <i className="po-key po-key--cone" />the priced range
                    <i className="po-key po-key--ema-fast" />20d avg
                    <i className="po-key po-key--ema-slow" />50d avg
                    <i className="po-key po-key--sr" />tested S/R
                  </span>
                )}
              </div>
              <PricedMoveChart data={data} row={row} isMobile={isMobile} />
              <p className="po-note">
                The shaded cone is the same {row.expectedMove != null ? `±${(row.expectedMove * 100).toFixed(1)}%` : 'move'} the
                straddle prices, drawn forward from the last close. It widens with the square root of time,
                because that is how volatility accumulates — half the way to expiry is about 71% of the
                full width, not half of it. Options price the RANGE, never the direction: the market is
                saying how far, not which way. The moving averages and the nearest tested support and
                resistance come from the tape itself — the levels the priced range has to fight through.
              </p>
            </section>
          )}

          {/* ═══ term structure ═══ */}
          <section className="po-panel">
            <div className="po-panel-head">
              <h3>The volatility term structure</h3>
              <span className="po-panel-sub">at-the-money implied vol, by expiry</span>
              {data.event && <span className="po-legend"><i className="po-key po-key--mark" />the expiry paying for it</span>}
            </div>
            <TermStructure chain={data.chain} event={data.event} isMobile={isMobile} />
            {term && (
              <div className="po-term-read">
                <p className="po-note po-note--lead">{term.read}</p>
                <p className="po-note">{term.what} {term.contrast}</p>
              </div>
            )}
          </section>

          {/* ═══ the book ═══ */}
          <section className="po-panel">
            <div className="po-panel-head">
              <h3>Where the book sits</h3>
              <span className="po-panel-sub">open interest by strike</span>
              <div className="po-expiry-pick">
                <button
                  className={cx('po-epill', chosen === '__all' && 'is-active')}
                  onClick={() => setExpiry('__all')}
                >All</button>
                {data.chain.slice(0, isMobile ? 4 : 7).map((c) => (
                  <button
                    key={c.exp}
                    className={cx('po-epill', chosen === c.exp && 'is-active', data.event?.exp === c.exp && 'is-event')}
                    onClick={() => setExpiry(c.exp)}
                  >{fmtExp(c.exp)}</button>
                ))}
              </div>
            </div>
            <Book
              book={book}
              spot={data.spot}
              maxPain={chosen === '__all' ? null : row?.maxPain}
              wall={data.gamma?.wall}
            />
            <p className="po-note">
              Each row is a strike price — a level the stock might reach — showing the largest
              positions, in price order. <b>Green bars</b> are call contracts (upside bets) parked at
              that level, <b>red bars</b> are puts (downside protection); the longer the bar, the more
              money sits there, and heavy strikes often act as magnets or walls into expiry.
              <b> pain</b> marks where the most open interest expires worthless; <b>gex</b> marks the
              strike carrying the most gamma.
            </p>
          </section>

          {/* ═══ gamma ═══ */}
          {gam && (
            <section className="po-panel">
              <div className="po-panel-head">
                <h3>Dealer gamma</h3>
                <span className="po-panel-sub">across every expiry, within 25% of spot</span>
              </div>
              <p className="po-primer">
                Dealers are the market makers on the other side of all these options. To stay neutral
                they must constantly trade the stock itself, and that hedging flow either calms the
                price or exaggerates its moves — which one is what this panel estimates.
              </p>
              <div className="po-gam">
                <div className={cx('po-gam-lead', gam.long ? 'is-long' : 'is-short')}>
                  <span className="po-gam-head">{gam.headline}</span>
                  <span className="po-gam-net">{fmtGex(gam.net)}<i>per 1% move</i></span>
                </div>
                <div className="po-gam-body">
                  <p>{gam.body}</p>
                  <div className="po-gam-wells">
                    <span className="po-well"><b>Flip</b>{data.gamma.flip != null ? fmtStrike(data.gamma.flip) : 'none near spot'}</span>
                    <span className="po-well"><b>Wall</b>{fmtStrike(data.gamma.wall)}</span>
                    <span className="po-well"><b>Strikes</b>{data.gamma.byStrike.length}</span>
                  </div>
                </div>
              </div>
              <p className="po-note po-note--caveat">{gam.caveat}</p>
            </section>
          )}

          {/* ═══ expiries ═══ */}
          <section className="po-panel">
            <div className="po-panel-head">
              <h3>Every expiry on the board</h3>
              <span className="po-panel-sub">the next {data.chain.length}</span>
            </div>
            <div className="po-table-wrap">
              <table className="po-table">
                <thead>
                  <tr>
                    <th>Expiry</th><th>In</th><th>P/C OI</th><th>P/C vol</th>
                    <th>ATM vol</th><th>Priced move</th><th>Max pain</th><th>Net gamma /1%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.chain.map((c) => (
                    <tr
                      key={c.exp}
                      className={cx(c.exp === data.focus && 'is-focus', data.event?.exp === c.exp && 'is-event')}
                    >
                      <td className="po-td-exp">
                        {fmtExp(c.exp)}
                        {data.event?.exp === c.exp && <i className="po-tag po-tag--event">priced</i>}
                      </td>
                      <td>{fmtDte(c.dte)}</td>
                      <td className={cx(c.pcOi > 1 && 'down', c.pcOi < 0.7 && 'up')}>{c.pcOi ?? '—'}</td>
                      <td>{c.pcVol ?? '—'}</td>
                      <td>{fmtPct1(c.atmIv)}</td>
                      <td>{c.expectedMove != null ? `±${(c.expectedMove * 100).toFixed(1)}%` : '—'}</td>
                      <td>{fmtStrike(c.maxPain)}</td>
                      <td className={cx(c.netGex > 0 ? 'up' : c.netGex < 0 ? 'down' : '')}>{fmtGex(c.netGex)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="po-note">
              One row per expiry date: how big a move is priced in by then (<b>priced move</b>), the
              put/call lean, where the most options would die worthless (<b>max pain</b>), and whether
              dealer hedging damps (+) or amplifies (−) moves (<b>net gamma</b>). Quotes are CBOE's
              public delayed feed, not live. Put/call is stated on open interest — the standing book —
              with the day's volume beside it, because the two disagree often.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
