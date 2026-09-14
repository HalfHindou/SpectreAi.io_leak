/**
 * The Crossing — cross-asset state and correlation.
 *
 * Replaces The Loop's premise. That page asked "what should I do", which a
 * price feed cannot answer, so its answers were written by hand and dressed as
 * output. This asks "what is happening across every market that prices crypto,
 * and what is it connected to" — a question the data answers on its own.
 *
 * No signals, no position sizing, no entry zones, no alerts to arm. Every
 * number here is computed from daily closes and shows its sample.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deriveRead, deriveState, corrFill, fmtCorr, fmtPct, fmtLevel,
} from '@/lib/crossasset-read'
import './crossasset-view.css'

const cx = (...a) => a.filter(Boolean).join(' ')

const GROUPS = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'equities', label: 'Equities' },
  { id: 'rates', label: 'Rates & dollar' },
  { id: 'commodities', label: 'Metals & energy' },
]

const WINDOW_LABEL = { 30: '30D', 90: '90D', 250: '1Y' }

/* ── data ───────────────────────────────────────────────────────────────── */
const _cache = new Map()
function fetchCross(market) {
  const hit = _cache.get(market)
  if (hit && Date.now() - hit.ts < 10 * 60_000) return hit.p
  const p = fetch(`/api/crossasset?market=${market}`, { signal: AbortSignal.timeout(30000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => (j?.names?.length ? j : Promise.reject(new Error('empty'))))
  _cache.set(market, { ts: Date.now(), p })
  p.catch(() => _cache.delete(market))
  return p
}

function useCrossAsset(market) {
  const [s, setS] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    setS((prev) => ({ data: prev.data?.market === market ? prev.data : null, loading: true, error: null }))
    fetchCross(market)
      .then((d) => { if (alive) setS({ data: d, loading: false, error: null }) })
      .catch((e) => { if (alive) setS({ data: null, loading: false, error: e.message || 'unavailable' }) })
    return () => { alive = false }
  }, [market])
  return s
}

/* Width from the element, not a prop. A fixed 96px canvas left a 287px tile
   two-thirds empty — measured 0.33 fill — which is what reads as unfinished. */
function useWidth() {
  const [w, setW] = useState(0)
  const roRef = useRef(null)
  const ref = useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!node) return
    setW(node.clientWidth)
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(node)
    roRef.current = ro
  }, [])
  return [ref, w]
}

/* ── sparkline ──────────────────────────────────────────────────────────── */
const Spark = React.memo(({ data, up, w = 96, h = 28 }) => {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !data?.length || w < 8) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = w * dpr; cv.height = h * dpr
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const lo = Math.min(...data), hi = Math.max(...data)
    const span = hi - lo || 1
    const x = (i) => (i / (data.length - 1)) * (w - 2) + 1
    const y = (v) => h - 3 - ((v - lo) / span) * (h - 6)
    const stroke = up ? 'rgba(52,211,153,0.95)' : 'rgba(248,113,113,0.95)'
    const fill = up ? 'rgba(52,211,153,0.16)' : 'rgba(248,113,113,0.16)'
    ctx.beginPath(); ctx.moveTo(x(0), y(data[0]))
    for (let i = 1; i < data.length; i++) ctx.lineTo(x(i), y(data[i]))
    ctx.lineTo(x(data.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath()
    ctx.fillStyle = fill; ctx.fill()
    ctx.beginPath(); ctx.moveTo(x(0), y(data[0]))
    for (let i = 1; i < data.length; i++) ctx.lineTo(x(i), y(data[i]))
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke()
    ctx.beginPath(); ctx.arc(x(data.length - 1), y(data[data.length - 1]), 2, 0, Math.PI * 2)
    ctx.fillStyle = stroke; ctx.fill()
  }, [data, up, w, h])
  return <canvas ref={ref} style={{ width: '100%', height: h, display: 'block' }} aria-hidden />
})

/* The tile's own spark: measures its slot and fills it. */
function TileSpark({ data, up, h }) {
  const [hostRef, w] = useWidth()
  return (
    <div className="xa-spark" ref={hostRef}>
      {w > 8 && <Spark data={data} up={up} w={w} h={h} />}
    </div>
  )
}

/* ── the board ──────────────────────────────────────────────────────────── */
function Board({ assets, staleDays }) {
  return (
    /* Four group columns side by side. A single flowing grid left half the
       panel empty — three tiles cannot fill 1600px without becoming 530px
       wide, so the groups take the width and the tiles stack inside them. */
    <div className="xa-board">
      {GROUPS.map((g) => {
        const rows = assets.filter((a) => a.group === g.id)
        if (!rows.length) return null
        return (
          <section className="xa-group" key={g.id}>
            <h3 className="xa-group-label">{g.label}</h3>
            <div className="xa-tiles">
            {rows.map((a) => {
                const up = (a.d1 ?? 0) >= 0
                const behind = staleDays(a.asOf)
                return (
                  <article className="xa-tile" key={a.sym}>
                    <div className="xa-tile-num">
                      <header className="xa-tile-head">
                        <span className="xa-sym">{a.sym}</span>
                        {behind > 0 && (
                          <span className="xa-behind" title={`Last close ${a.asOf} — this market was shut`}>
                            {behind}d
                          </span>
                        )}
                      </header>
                      <span className="xa-level">{fmtLevel(a.last, a.unit)}</span>
                      <div className="xa-chg">
                        <span className={up ? 'up' : 'down'}>{fmtPct(a.d1)}</span>
                        <span className={(a.d5 ?? 0) >= 0 ? 'up' : 'down'}>{fmtPct(a.d5, 1)} 5D</span>
                      </div>
                    </div>
                    <TileSpark data={a.spark} up={(a.d30 ?? a.d5 ?? 0) >= 0} h={54} />
                  </article>
                )
            })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/* ── the matrix ─────────────────────────────────────────────────────────── */
function Matrix({ names, matrix, dayMode, onPick, picked }) {
  return (
    <div className="xa-mx-scroll">
      <table className="xa-mx">
        <thead>
          <tr>
            <th className="xa-mx-corner" />
            {names.map((n) => (
              <th key={n}>
                <button type="button" className={cx('xa-mx-head', picked === n && 'is-picked')} onClick={() => onPick(n)}>{n}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((a, i) => (
            <tr key={a} className={cx(picked === a && 'is-picked-row')}>
              <th className="xa-mx-row">{a}</th>
              {names.map((b, j) => {
                const v = matrix[i][j]
                const self = i === j
                const s = self ? null : corrFill(v, dayMode)
                return (
                  <td key={b}>
                    <span
                      className={cx('xa-cell', self && 'is-self', (picked === a || picked === b) && !self && 'is-lit')}
                      style={self ? undefined : { background: s.bg, color: s.fg }}
                      title={self ? `${a}` : `${a} vs ${b} · ${fmtCorr(v)}`}
                    >{self ? '·' : fmtCorr(v)}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── the state ──────────────────────────────────────────────────────────
   What The Loop's regime card was trying to be. That one printed a 97/100 next
   to a badge saying BULLISH and never showed an input; this is an average of
   four moves that are all on screen, with each one's push labelled. */
function StatePanel({ state }) {
  if (!state) return null
  const pos = ((state.score + 1) / 2) * 100
  const tone = state.score >= 0.12 ? 'on' : state.score <= -0.12 ? 'off' : 'mid'
  return (
    <section className="xa-panel xa-state">
      <header className="xa-panel-head">
        <h3>The state</h3>
        <span className="xa-panel-sub">{state.basis}</span>
      </header>

      <div className="xa-state-body">
        <div className="xa-state-lead">
          <span className={cx('xa-state-label', tone)}>{state.label}</span>
          {state.anchor && (
            <span className="xa-state-anchor">
              {state.anchor.sym} did <b className={(state.anchor.d30 ?? 0) >= 0 ? 'up' : 'down'}>{fmtPct(state.anchor.d30, 1)}</b> into it
            </span>
          )}
        </div>

        <div className="xa-state-scale" role="img" aria-label={`Conditions: ${state.label}`}>
          <span className="xa-scale-end">Risk-off</span>
          <span className="xa-scale-track">
            <i className="xa-scale-mid" />
            <i className={cx('xa-scale-mark', tone)} style={{ left: `${pos}%` }} />
          </span>
          <span className="xa-scale-end">Risk-on</span>
        </div>
      </div>

      <div className="xa-state-inputs">
        {state.inputs.map((i) => (
          <span className={cx('xa-sinput', i.toward === 'on' ? 'on' : 'off')} key={i.sym}>
            <b>{i.sym}</b>
            <em className={i.move >= 0 ? 'up' : 'down'}>{fmtPct(i.move, 1)} 30D</em>
            <i>{i.toward === 'on' ? 'loosens' : 'tightens'}</i>
          </span>
        ))}
      </div>
    </section>
  )
}

/* ── page ───────────────────────────────────────────────────────────────── */
export default function CrossAssetView({ dayMode, marketMode = 'crypto', isMobile }) {
  const market = marketMode === 'stocks' ? 'stocks' : 'crypto'
  const { data, loading, error } = useCrossAsset(market)
  const [win, setWin] = useState(30)
  const [picked, setPicked] = useState(null)

  const read = useMemo(() => (data ? deriveRead(data) : null), [data])
  const state = useMemo(() => (data ? deriveState(data) : null), [data])

  // Each lane keeps its own calendar; a shut market is meant to look a day
  // behind, and the tile says so rather than pretending it traded.
  const staleDays = useCallback((iso) => {
    if (!iso) return 0
    const days = Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86400000)
    return days > 1 ? days : 0
  }, [])

  const pickName = useCallback((n) => setPicked((p) => (p === n ? null : n)), [])

  if (loading && !data) return <div className="xa-root"><div className="xa-boot" aria-hidden /></div>

  if (error && !data) {
    return (
      <div className="xa-root">
        <section className="xa-panel xa-error">
          <b>Cross-asset data unavailable.</b>
          <span>The board needs daily closes from every lane before it can correlate anything. Try again shortly.</span>
        </section>
      </div>
    )
  }

  const matrix = data.matrices[win]

  return (
    <div className={cx('xa-root', isMobile && 'is-mobile')}>
      <div className="xa-rail">
        <div className="xa-rail-left">
          <h2 className="xa-title">The Crossing</h2>
          <span className="xa-sub">every market that prices {market === 'stocks' ? 'equities' : 'crypto'}, and what it moves with</span>
        </div>
        <div className="xa-rail-right">
          <div className="xa-seg" role="tablist" aria-label="Correlation window">
            {data.windows.map((w) => (
              <button key={w} role="tab" aria-selected={win === w} className={cx(win === w && 'is-on')} onClick={() => setWin(w)}>
                {WINDOW_LABEL[w] || `${w}D`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <StatePanel state={state} />

      <section className="xa-panel">
        <header className="xa-panel-head">
          <h3>The board</h3>
          <span className="xa-panel-sub">levels from each market's own last close</span>
        </header>
        <Board assets={data.assets} staleDays={staleDays} />
      </section>

      {read && (
        <section className={cx('xa-panel xa-read', read.quiet && 'is-quiet')}>
          <header className="xa-panel-head">
            <h3>The read</h3>
            <span className="xa-panel-sub">derived from the numbers below — nothing else</span>
          </header>
          <p className="xa-read-line">{read.headline}</p>
          <p className="xa-read-detail">{read.detail}</p>
          <div className="xa-read-inputs">
            {read.inputs.map((d) => (
              <span className="xa-input" key={d.b}>
                <b>{d.a}·{d.b}</b>
                <em>{WINDOW_LABEL[30]} {fmtCorr(d.w30)}</em>
                <i>1Y {fmtCorr(d.w250)}</i>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="xa-panel">
        <header className="xa-panel-head">
          <h3>The matrix</h3>
          <span className="xa-panel-sub">
            {WINDOW_LABEL[win] || `${win}D`} correlation of daily returns · {data.coverage.alignedDays} aligned trading days
          </span>
          <span className="xa-legend">
            <i className="xa-key xa-key--neg" /> moves opposite
            <i className="xa-key xa-key--pos" /> moves together
          </span>
        </header>
        <div className="xa-well">
          <Matrix names={data.names} matrix={matrix} dayMode={dayMode} onPick={pickName} picked={picked} />
        </div>
        <p className="xa-note">
          Crypto trades every day; equities, rates and commodities do not. Returns are computed only
          over dates every market has — {data.coverage.alignedDays} of them, {data.coverage.from} to{' '}
          {data.coverage.to} — because zipping the two calendars together would correlate a Monday
          crypto move against the previous Friday's equity move.
        </p>
      </section>

      <section className="xa-panel">
        <header className="xa-panel-head">
          <h3>The drift</h3>
          <span className="xa-panel-sub">today's 30-day reading against the same pair's one-year norm</span>
        </header>
        <div className="xa-drift">
          {data.drift.slice(0, 8).map((d) => {
            const rose = d.drift > 0
            return (
              <article className="xa-dcard" key={d.b}>
                <span className="xa-dpair">{d.a} · {d.b}</span>
                <div className="xa-dnums">
                  <span className={cx('xa-dnow', d.w30 >= 0 ? 'up' : 'down')}>{fmtCorr(d.w30)}</span>
                  <span className="xa-dwas">1Y {fmtCorr(d.w250)}</span>
                </div>
                <div className="xa-dtrack" aria-hidden>
                  <i className="xa-dnorm" style={{ left: `${((d.w250 + 1) / 2) * 100}%` }} />
                  <i className={cx('xa-dmark', rose ? 'up' : 'down')} style={{ left: `${((d.w30 + 1) / 2) * 100}%` }} />
                </div>
                <span className={cx('xa-dmove', rose ? 'up' : 'down')}>
                  {rose ? '▲' : '▼'} {fmtCorr(Math.abs(d.drift))} from norm
                </span>
              </article>
            )
          })}
        </div>
      </section>

      <p className="xa-footnote">
        Correlation is not causation, and a 30-day window is 30 observations. This board shows what
        has moved together, not what will.
      </p>
    </div>
  )
}
