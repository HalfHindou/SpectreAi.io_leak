/**
 * Yearly Analysis — the reading panels.
 *
 * Each one answers a question the return matrix on its own can't:
 *   Compass    which months this asset actually lives in
 *   MonthDNA   whether a month's average is a pattern or one loud year
 *   Ribbon     what the whole life of the asset looks like end to end
 *   EdgeLab    what the seasonal read would have been worth, honestly scored
 *   Rotation   which asset owns which month
 *   Weekday    the intra-month structure — weekday tape and turn-of-month
 */
import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  MONTH_ABBR, MONTH_FULL, DOW_ABBR,
  median, quantile, mean, longestStreaks, seasonalEdge, percentileOf,
  pct, pctBare, makeScale,
} from '@/lib/seasonality-math'

/* Width-aware SVG. A callback ref, not useEffect+ref: the panels mount behind
   collapsed sections and a bare effect would observe a node that isn't there. */
export function useSize() {
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

const cx = (...a) => a.filter(Boolean).join(' ')

/* ════════════════════════════════════════════════════════════════════════
   COMPASS — the year as a dial
   Spoke length is the MEDIAN month return (the mean is hostage to one 2013);
   fill weight is the win rate. Twelve months read as a shape, not a list.
   ════════════════════════════════════════════════════════════════════════ */
export function SeasonalCompass({ profile, selected, onSelect, currentMonth, stat = 'med' }) {
  const [hostRef, w] = useSize()
  const size = Math.max(240, Math.min(w || 420, 460))
  const cxy = size / 2
  const rMax = size * 0.40
  const rMin = size * 0.13

  const vals = profile.map((p) => p[stat]).filter(Number.isFinite)
  const anchor = Math.max(0.02, quantile(vals.map(Math.abs), 0.9) ?? 0.1)

  const sector = (i, r0, r1, pad = 0.055) => {
    const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2 + pad
    const a1 = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2 - pad
    const p = (a, r) => `${(cxy + Math.cos(a) * r).toFixed(2)},${(cxy + Math.sin(a) * r).toFixed(2)}`
    return `M ${p(a0, r0)} A ${r0} ${r0} 0 0 1 ${p(a1, r0)} L ${p(a1, r1)} A ${r1} ${r1} 0 0 0 ${p(a0, r1)} Z`
  }

  return (
    <div className="ya-compass" ref={hostRef}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Seasonal compass">
        <defs>
          <radialGradient id="ya-compass-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.07)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <circle cx={cxy} cy={cxy} r={rMax + 10} fill="url(#ya-compass-core)" />
        {[0.33, 0.66, 1].map((g) => (
          <circle key={g} cx={cxy} cy={cxy} r={rMin + (rMax - rMin) * g} className="ya-compass-ring" />
        ))}
        <circle cx={cxy} cy={cxy} r={rMin} className="ya-compass-zero" />
        {/* Without a scale the dial is decoration. This names what the outer
            ring is worth, so a spoke can actually be read off it. */}
        <text x={size} y={10} className="ya-compass-scale" textAnchor="end">
          outer ring ±{(anchor * 100).toFixed(0)}%
        </text>

        {profile.map((p, i) => {
          const v = p[stat]
          const has = Number.isFinite(v) && p.n > 0
          const t = has ? Math.min(1, Math.abs(v) / anchor) : 0
          const len = rMin + (rMax - rMin) * Math.pow(t, 0.7)
          const up = has && v >= 0
          const conviction = has && Number.isFinite(p.win) ? Math.abs(p.win - 0.5) * 2 : 0
          const isSel = selected === p.m
          const isNow = currentMonth === p.m
          return (
            <g
              key={p.m}
              className={cx('ya-compass-sector', isSel && 'is-selected', isNow && 'is-now')}
              onClick={() => onSelect?.(p.m)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.m) } }}
              aria-label={`${MONTH_FULL[i]} ${pct(v)}`}
            >
              <path d={sector(i, rMin, len)} fill={up ? 'var(--bull)' : 'var(--bear)'} opacity={0.2 + conviction * 0.6} />
              <path d={sector(i, rMin, rMax)} className="ya-compass-hit" />
              {(() => {
                const a = ((i + 0.5) / 12) * Math.PI * 2 - Math.PI / 2
                const lr = rMax + 16
                return (
                  <text
                    x={cxy + Math.cos(a) * lr}
                    y={cxy + Math.sin(a) * lr}
                    className="ya-compass-label"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >{MONTH_ABBR[i]}</text>
                )
              })()}
            </g>
          )
        })}
      </svg>
      <div className="ya-compass-core">
        {(() => {
          const p = profile.find((x) => x.m === (selected || currentMonth)) || profile[0]
          return (
            <>
              <span className="ya-compass-core-month">{MONTH_ABBR[p.m - 1]}</span>
              <span className={cx('ya-compass-core-val', p[stat] >= 0 ? 'up' : 'down')}>{pct(p[stat])}</span>
              <span className="ya-compass-core-sub">{pctBare(p.win)} up · n={p.n}</span>
            </>
          )
        })()}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   MONTH DNA — every year of one month, on one axis
   The number that matters is not the average, it is the spread. September's
   -3% mean is a very different trade if it is nine flat years and one 2014.
   ════════════════════════════════════════════════════════════════════════ */
export function MonthDNA({ months, m, profile, mtd }) {
  const [hostRef, w] = useSize()
  const width = Math.max(280, w || 640)
  const H = 132
  const padX = 18

  const rows = useMemo(
    () => months.filter((x) => x.m === m && Number.isFinite(x.r) && !x.partial).sort((a, b) => a.y - b.y),
    [months, m]
  )
  const vals = rows.map((r) => r.r)
  const lo = Math.min(...vals, mtd ?? 0, 0)
  const hi = Math.max(...vals, mtd ?? 0, 0)
  const span = Math.max(0.04, hi - lo)
  const x = (v) => padX + ((v - lo) / span) * (width - padX * 2)

  const q1 = quantile(vals, 0.25)
  const q3 = quantile(vals, 0.75)
  const med = median(vals)
  const yBase = 74

  if (!rows.length) return <div className="ya-empty-inline">No history for {MONTH_FULL[m - 1]}</div>

  return (
    <div className="ya-dna" ref={hostRef}>
      <svg viewBox={`0 0 ${width} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
           aria-label={`${MONTH_FULL[m - 1]} return distribution, ${rows.length} years`}>
        {/* interquartile band — where the middle half of history landed */}
        <rect x={x(q1)} y={yBase - 26} width={Math.max(1, x(q3) - x(q1))} height={52} className="ya-dna-iqr" rx="4" />
        <line x1={padX} x2={width - padX} y1={yBase} y2={yBase} className="ya-dna-axis" />
        <line x1={x(0)} x2={x(0)} y1={yBase - 34} y2={yBase + 34} className="ya-dna-zero" />
        <line x1={x(med)} x2={x(med)} y1={yBase - 30} y2={yBase + 30} className="ya-dna-median" />

        {rows.map((r, i) => {
          // Deterministic vertical jitter so overlapping years stay countable.
          const dy = ((i % 5) - 2) * 8
          return (
            <g key={r.y} className="ya-dna-dot-g">
              <circle cx={x(r.r)} cy={yBase + dy} r="5.5" className={cx('ya-dna-dot', r.r >= 0 ? 'up' : 'down')} />
              <title>{`${r.y} · ${pct(r.r)}`}</title>
            </g>
          )
        })}

        {Number.isFinite(mtd) && (
          <g>
            <line x1={x(mtd)} x2={x(mtd)} y1={yBase - 40} y2={yBase + 40} className="ya-dna-live" />
            <circle cx={x(mtd)} cy={yBase - 40} r="4" className="ya-dna-live-dot" />
          </g>
        )}

        <text x={x(lo)} y={H - 6} className="ya-dna-tick" textAnchor="start">{pct(lo, 0)}</text>
        <text x={x(med)} y={20} className="ya-dna-tick strong" textAnchor="middle">median {pct(med)}</text>
        <text x={x(hi)} y={H - 6} className="ya-dna-tick" textAnchor="end">{pct(hi, 0)}</text>
      </svg>

      <div className="ya-dna-legend">
        <span><i className="ya-key ya-key--iqr" />middle half of years</span>
        <span><i className="ya-key ya-key--med" />median</span>
        {Number.isFinite(mtd) && <span><i className="ya-key ya-key--live" />this month so far</span>}
      </div>

      <div className="ya-dna-years ya-well">
        {[...rows].sort((a, b) => b.r - a.r).map((r) => (
          <span className="ya-dna-year" key={r.y}>
            <b>{r.y}</b>
            <em className={r.r >= 0 ? 'up' : 'down'}>{pct(r.r)}</em>
          </span>
        ))}
      </div>

      <div className="ya-dna-stats ya-well">
        <Stat label="Median" value={pct(profile?.med)} tone={profile?.med >= 0 ? 'up' : 'down'} />
        <Stat label="Mean" value={pct(profile?.avg)} tone={profile?.avg >= 0 ? 'up' : 'down'} />
        <Stat label="Up years" value={`${Math.round((profile?.win ?? 0) * 100)}%`} />
        <Stat label="Spread (1σ)" value={pctBare(profile?.sd, 1)} />
        <Stat label="Avg drawdown" value={pct(profile?.dd)} tone="down" />
      </div>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="ya-stat">
      <span className="ya-stat-label">{label}</span>
      <span className={cx('ya-stat-value', tone)}>{value}</span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   LIFE RIBBON — every month the asset has ever traded, in order
   ════════════════════════════════════════════════════════════════════════ */
export function LifeRibbon({ months, onPick, dayMode, compact = false }) {
  const scale = useMemo(() => makeScale(months.map((m) => m.r), dayMode), [months, dayMode])
  const streaks = useMemo(() => longestStreaks(months), [months])
  const extremes = useMemo(() => {
    const done = months.filter((m) => Number.isFinite(m.r) && !m.partial)
    if (!done.length) return null
    return {
      best: done.reduce((a, b) => (a.r > b.r ? a : b)),
      worst: done.reduce((a, b) => (a.r < b.r ? a : b)),
    }
  }, [months])

  const byYear = useMemo(() => {
    const map = new Map()
    for (const mo of months) {
      if (!map.has(mo.y)) map.set(mo.y, [])
      map.get(mo.y).push(mo)
    }
    return [...map.entries()]
  }, [months])

  const runLabel = (s) => (s ? `${s.n} months · ${MONTH_ABBR[s.from.m - 1]} ${s.from.y} → ${MONTH_ABBR[s.to.m - 1]} ${s.to.y}` : '—')

  return (
    <div className="ya-ribbon">
      <div className="ya-ribbon-strip">
        {byYear.map(([y, list]) => (
          <div className="ya-ribbon-year" key={y}>
            <span className="ya-ribbon-year-label">{String(y).slice(2)}</span>
            <div className="ya-ribbon-cells">
              {list.map((mo) => {
                const s = scale(mo.r)
                const tip = `${MONTH_FULL[mo.m - 1]} ${mo.y} · ${pct(mo.r)}`
                const style = { background: s.bg, borderColor: s.ring }
                const cls = cx('ya-ribbon-cell', mo.partial && 'is-running')
                // On a phone these are read, not pressed — and the app's global
                // touch floor inflates every <button> under 768px to 38px, which
                // turned fourteen years into fourteen full-width rows of scroll.
                // The month is still selectable from the grid header above.
                return compact
                  ? <span key={`${mo.y}-${mo.m}`} className={cls} style={style} title={tip} />
                  : (
                    <button
                      key={`${mo.y}-${mo.m}`}
                      type="button"
                      className={cls}
                      style={style}
                      title={tip}
                      onClick={() => onPick?.(mo.m)}
                      aria-label={`${MONTH_FULL[mo.m - 1]} ${mo.y} ${pct(mo.r)}`}
                    />
                  )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="ya-ribbon-facts ya-well">
        <div className="ya-fact">
          <span className="ya-fact-label">Longest green run</span>
          <span className="ya-fact-value up">{streaks.best ? pct(streaks.best.g - 1) : '—'}</span>
          <span className="ya-fact-sub">{runLabel(streaks.best)}</span>
        </div>
        <div className="ya-fact">
          <span className="ya-fact-label">Longest red run</span>
          <span className="ya-fact-value down">{streaks.worst ? pct(streaks.worst.g - 1) : '—'}</span>
          <span className="ya-fact-sub">{runLabel(streaks.worst)}</span>
        </div>
        <div className="ya-fact">
          <span className="ya-fact-label">Best month ever</span>
          <span className="ya-fact-value up">{pct(extremes?.best?.r)}</span>
          <span className="ya-fact-sub">{extremes ? `${MONTH_FULL[extremes.best.m - 1]} ${extremes.best.y}` : '—'}</span>
        </div>
        <div className="ya-fact">
          <span className="ya-fact-label">Worst month ever</span>
          <span className="ya-fact-value down">{pct(extremes?.worst?.r)}</span>
          <span className="ya-fact-sub">{extremes ? `${MONTH_FULL[extremes.worst.m - 1]} ${extremes.worst.y}` : '—'}</span>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   EDGE LAB — what the seasonal read was actually worth
   Hold only the chosen months, sit in cash the rest. Scored against
   buy-and-hold on the same series, and labelled in-sample, because it is.
   ════════════════════════════════════════════════════════════════════════ */
export function EdgeLab({ months, picked, onToggle, onPreset }) {
  const [hostRef, w] = useSize()
  const res = useMemo(() => seasonalEdge(months, picked), [months, picked])
  const width = Math.max(300, w || 720)
  const H = 200

  const path = useMemo(() => {
    if (!res) return null
    const pts = res.curve
    const all = pts.flatMap((p) => [p.s, p.h]).filter((v) => v > 0)
    const lo = Math.log10(Math.max(1e-4, Math.min(...all)))
    const hi = Math.log10(Math.max(...all))
    const span = Math.max(0.3, hi - lo)
    const X = (i) => (i / Math.max(1, pts.length - 1)) * (width - 8) + 4
    const Y = (v) => H - 14 - ((Math.log10(Math.max(1e-4, v)) - lo) / span) * (H - 30)
    const line = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[key]).toFixed(1)}`).join('')
    const area = `${line('s')} L${X(pts.length - 1).toFixed(1)},${H} L${X(0).toFixed(1)},${H} Z`
    return { s: line('s'), h: line('h'), area }
  }, [res, width])

  if (!res) return <div className="ya-empty-inline">Not enough history to score a seasonal rule.</div>

  const beat = res.strategy.eq / res.hold.eq

  return (
    <div className="ya-edge">
      <div className="ya-edge-picker">
        {MONTH_ABBR.map((label, i) => {
          const m = i + 1
          const on = picked.has(m)
          return (
            <button
              key={label}
              type="button"
              className={cx('ya-edge-chip', on && 'is-on')}
              onClick={() => onToggle(m)}
              aria-pressed={on}
            >{label}</button>
          )
        })}
        <span className="ya-edge-presets">
          <button type="button" className="ya-mini-btn" onClick={() => onPreset('top6')}>Top 6</button>
          <button type="button" className="ya-mini-btn" onClick={() => onPreset('positive')}>All positive</button>
          <button type="button" className="ya-mini-btn" onClick={() => onPreset('all')}>All 12</button>
        </span>
      </div>

      <div className="ya-edge-chart" ref={hostRef}>
        <svg viewBox={`0 0 ${width} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
             aria-label="Seasonal rule equity versus buy and hold">
          <defs>
            <linearGradient id="ya-edge-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(6,182,212,0.28)" />
              <stop offset="100%" stopColor="rgba(6,182,212,0)" />
            </linearGradient>
          </defs>
          <path d={path.area} fill="url(#ya-edge-fill)" />
          <path d={path.h} className="ya-edge-hold" />
          <path d={path.s} className="ya-edge-strat" />
        </svg>
        <div className="ya-edge-legend">
          <span><i className="ya-key ya-key--strat" />Seasonal rule</span>
          <span><i className="ya-key ya-key--hold" />Buy &amp; hold</span>
          <span className="ya-edge-logscale">log scale · {res.years.toFixed(0)}y</span>
        </div>
      </div>

      <div className="ya-edge-grid ya-well">
        <EdgeStat label="Growth of $1" a={`$${res.strategy.eq.toFixed(res.strategy.eq > 100 ? 0 : 2)}`} b={`$${res.hold.eq.toFixed(res.hold.eq > 100 ? 0 : 2)}`} win={res.strategy.eq > res.hold.eq} />
        <EdgeStat label="CAGR" a={pct(res.strategy.cagr)} b={pct(res.hold.cagr)} win={res.strategy.cagr > res.hold.cagr} />
        <EdgeStat label="Worst drawdown" a={pct(res.strategy.dd)} b={pct(res.hold.dd)} win={res.strategy.dd > res.hold.dd} />
        <EdgeStat label="Time in market" a={pctBare(res.exposure)} b="100%" win={res.exposure < 1} />
        <EdgeStat label="Win rate of held months" a={pctBare(res.strategy.hit)} b="—" />
      </div>

      <p className="ya-note">
        {beat >= 1
          ? `Holding only those months returned ${beat.toFixed(1)}× buy-and-hold over ${res.years.toFixed(0)} years while exposed ${pctBare(res.exposure)} of the time.`
          : `Holding only those months returned ${(beat * 100).toFixed(0)}% of buy-and-hold — the rule cost more than it saved.`}
        {' '}The months are chosen from the same history this is scored on, so treat the number as the ceiling of the idea, not a forecast.
      </p>
    </div>
  )
}

function EdgeStat({ label, a, b, win }) {
  return (
    <div className={cx('ya-edge-stat', win === true && 'is-win')}>
      <span className="ya-edge-stat-label">{label}</span>
      <span className="ya-edge-stat-a">{a}</span>
      <span className="ya-edge-stat-b">vs {b}</span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   ROTATION BOARD — who owns each month
   ════════════════════════════════════════════════════════════════════════ */
export function RotationBoard({ assets, activeSymbol, onPick, dayMode }) {
  const scale = useMemo(
    () => makeScale(assets.flatMap((a) => a.monthProfile.map((p) => p.med)), dayMode),
    [assets, dayMode]
  )
  const winners = useMemo(() => {
    const out = new Array(12).fill(null)
    for (let i = 0; i < 12; i++) {
      let best = null
      for (const a of assets) {
        const p = a.monthProfile[i]
        if (!p || !Number.isFinite(p.med) || p.n < 3) continue
        if (!best || p.med > best.med) best = { sym: a.symbol, med: p.med }
      }
      out[i] = best
    }
    return out
  }, [assets])

  if (!assets.length) return <div className="ya-empty-inline">Rotation board unavailable.</div>

  return (
    <div className="ya-rotation">
      <div className="ya-rot-scroll">
        <table className="ya-rot-table">
          <thead>
            <tr>
              <th className="ya-rot-corner">Asset</th>
              {MONTH_ABBR.map((mm) => <th key={mm}>{mm}</th>)}
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.symbol} className={cx(a.symbol === activeSymbol && 'is-active')}>
                <th className="ya-rot-sym">
                  <button type="button" onClick={() => onPick?.(a.symbol)}>{a.symbol}</button>
                  <span className="ya-rot-years">{a.coverage?.years}y</span>
                </th>
                {a.monthProfile.map((p, i) => {
                  const s = scale(p.med)
                  const owns = winners[i]?.sym === a.symbol
                  return (
                    <td key={p.m}>
                      <span
                        className={cx('ya-rot-cell', owns && 'is-owner', p.n < 3 && 'is-thin')}
                        style={{ background: s.bg, color: s.fg, borderColor: owns ? 'rgba(245,245,247,0.45)' : s.ring }}
                        title={`${a.symbol} · ${MONTH_FULL[i]} · median ${pct(p.med)} · ${pctBare(p.win)} up · n=${p.n}`}
                      >{p.n ? pct(p.med, 0) : '—'}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ya-note">
        Median month return per asset over its own full history — the ring marks the asset with the
        strongest median in that column. Coverage differs per row, so read the years chip before
        comparing a 6-year token against a 40-year index.
      </p>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   WEEKDAY TAPE + TURN OF MONTH
   ════════════════════════════════════════════════════════════════════════ */
export function WeekdayTape({ effects }) {
  const rows = (effects?.dow || []).filter((d) => d.n > 20)
  if (!rows.length) return null
  const anchor = Math.max(...rows.map((d) => Math.abs(d.avg || 0)), 1e-4)
  const tom = effects?.tom
  const edge = tom && Number.isFinite(tom.turn?.avg) && Number.isFinite(tom.rest?.avg)
    ? tom.turn.avg - tom.rest.avg
    : null

  return (
    <div className="ya-week">
      <div className="ya-week-bars">
        {rows.map((d) => {
          const h = Math.min(1, Math.abs(d.avg || 0) / anchor)
          const up = (d.avg || 0) >= 0
          return (
            <div className="ya-week-col" key={d.d}>
              <div className="ya-week-track">
                <div
                  className={cx('ya-week-bar', up ? 'up' : 'down')}
                  style={{ height: `${Math.max(4, h * 100)}%` }}
                />
              </div>
              <span className="ya-week-day">{DOW_ABBR[d.d]}</span>
              <span className={cx('ya-week-val', up ? 'up' : 'down')}>{pct(d.avg, 2)}</span>
              <span className="ya-week-med">med {pct(d.med, 2)}</span>
              <span className="ya-week-win">{pctBare(d.win)} up</span>
            </div>
          )
        })}
      </div>

      {tom && (
        <div className="ya-tom">
          <div className="ya-tom-head">Turn of month</div>
          <div className="ya-tom-rows ya-well">
            <div className="ya-tom-row">
              <span className="ya-tom-label">Last 2 + first 3 days</span>
              <span className={cx('ya-tom-val', tom.turn.avg >= 0 ? 'up' : 'down')}>{pct(tom.turn.avg, 2)}</span>
              <span className="ya-tom-n">n={tom.turn.n}</span>
            </div>
            <div className="ya-tom-row">
              <span className="ya-tom-label">Every other day</span>
              <span className={cx('ya-tom-val', tom.rest.avg >= 0 ? 'up' : 'down')}>{pct(tom.rest.avg, 2)}</span>
              <span className="ya-tom-n">n={tom.rest.n}</span>
            </div>
          </div>
          {Number.isFinite(edge) && (
            <p className="ya-note ya-note--tight">
              {edge >= 0
                ? `The month's hinge days run ${(edge * 100).toFixed(2)}pp per day hotter than the rest of the calendar.`
                : `The month's hinge days run ${(Math.abs(edge) * 100).toFixed(2)}pp per day colder than the rest of the calendar.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export { percentileOf, mean }
