/**
 * preipo-compare.jsx — put two to four pre-IPO companies side by side.
 *
 * The roster already carries everything a real comparison needs — the priced
 * round ladder, who led each one, what was raised to get there — but until now
 * it could only ever be read one company at a time. The question people actually
 * have ("is this one expensive next to its peers, and who else compounded like
 * it?") had no surface.
 *
 * Two axes, because they answer different questions:
 *   BY DATE — where each company was in the same market. Anthropic's 2023 is
 *             OpenAI's 2023; the macro is shared.
 *   BY AGE  — years from each company's OWN first priced round, so a 2021
 *             founding can be read against a 2015 one. This is the one that
 *             shows who climbed faster rather than who started earlier.
 *
 * Log scale throughout: these ladders span 100-1000x and a linear axis renders
 * every round before the last one as a flat line on the floor.
 *
 * Lines are labelled at their own end rather than through a detached legend —
 * same reason the Vitals tide bands are: a legend somewhere else makes the
 * reader hold an index in their head while looking at the picture.
 */

import { useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import usePreIPO from './use-preipo'
import { formatAmount } from './private-markets-constants'
import './preipo-compare.css'
import './preipo-compare.day-mode.css'

const MAX_PICKS = 4
const HEIGHT = 300
const PAD = { top: 20, right: 132, bottom: 34, left: 66 }
const MIN_W = 320
const FALLBACK_W = 760

// One warm-white for the company you came in on, then a restrained set for the
// others. Not a palette per company — the lines carry their own names.
const LINE_COLORS = ['#f5f5f7', '#34D399', '#38BDF8', '#FBBF24']

const YEAR = 365.25 * 24 * 3600 * 1000

function roundsOf(row) {
  const raw = Array.isArray(row?.valuationSeries) ? row.valuationSeries : []
  return raw
    .filter((r) => r && r.valuationUsd > 0 && r.date)
    .map((r) => ({ t: new Date(r.date).getTime(), v: r.valuationUsd, round: r.roundType, amount: r.amountUsd }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t)
}

export default function PreIpoCompare({ seed, embedded = false }) {
  const { t, i18n } = useTranslation()
  const { roster, loading } = usePreIPO()
  const { fmtLargeShort } = useCurrency()
  const money = (n) => formatAmount(n, fmtLargeShort)

  const [axis, setAxis] = useState('age')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null) // null = not yet seeded
  // A CALLBACK ref, not useRef+[] — this component early-returns a skeleton that
  // carries no ref, so a one-shot effect ran while the node did not exist yet and
  // never re-ran once it did. The chart then sized itself from the fallback for
  // the rest of its life. Same trap as charts-system.md I2.
  const [wrapEl, setWrapEl] = useState(null)
  const [width, setWidth] = useState(FALLBACK_W)

  useLayoutEffect(() => {
    const el = wrapEl
    if (!el) return undefined
    const read = () => {
      const w = el.clientWidth - 24
      if (w > 0) setWidth(Math.max(MIN_W, Math.round(w)))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [wrapEl])

  // Seed once the roster lands: the company we were sent in with, then the next
  // largest that actually have a ladder to draw (a single-point unicorn row
  // makes a dot, not a comparison).
  const chosen = useMemo(() => {
    if (picked) return picked
    if (!roster.length) return []
    const withLadder = roster.filter((r) => roundsOf(r).length >= 2)
    const out = []
    for (const name of (seed || [])) {
      const hit = roster.find((r) => r.company.toLowerCase() === String(name).toLowerCase())
      if (hit) out.push(hit.company)
    }
    for (const r of withLadder) {
      if (out.length >= 3) break
      if (!out.includes(r.company)) out.push(r.company)
    }
    return out
  }, [picked, roster, seed])

  const rows = useMemo(
    () => chosen.map((c) => roster.find((r) => r.company === c)).filter(Boolean),
    [chosen, roster],
  )

  const set = (next) => setPicked(next)
  const remove = (name) => set(chosen.filter((c) => c !== name))
  const add = (name) => {
    if (chosen.includes(name) || chosen.length >= MAX_PICKS) return
    set([...chosen, name])
    setQuery('')
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return roster
      .filter((r) => r.company.toLowerCase().includes(q) && !chosen.includes(r.company))
      .slice(0, 6)
  }, [query, roster, chosen])

  // ── chart layout ──────────────────────────────────────────────────────────
  const chart = useMemo(() => {
    const series = rows
      .map((r, i) => ({ company: r.company, color: LINE_COLORS[i % LINE_COLORS.length], pts: roundsOf(r) }))
      .filter((s) => s.pts.length > 0)
    if (!series.length) return null

    const xOf = (s, p) => (axis === 'age' ? (p.t - s.pts[0].t) / YEAR : p.t)
    let xMin = Infinity
    let xMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    for (const s of series) {
      for (const p of s.pts) {
        const x = xOf(s, p)
        if (x < xMin) xMin = x
        if (x > xMax) xMax = x
        if (p.v < vMin) vMin = p.v
        if (p.v > vMax) vMax = p.v
      }
    }
    if (!(xMax > xMin)) xMax = xMin + (axis === 'age' ? 1 : YEAR)

    const innerW = width - PAD.left - PAD.right
    const innerH = HEIGHT - PAD.top - PAD.bottom
    const lo = Math.log10(Math.max(vMin, 1))
    const hi = Math.log10(Math.max(vMax, 10))
    const span = hi - lo || 1
    const px = (x) => PAD.left + ((x - xMin) / (xMax - xMin)) * innerW
    const py = (v) => PAD.top + innerH - ((Math.log10(Math.max(v, 1)) - lo) / span) * innerH

    const lines = series.map((s) => {
      const pts = s.pts.map((p) => ({ ...p, x: px(xOf(s, p)), y: py(p.v) }))
      return {
        ...s,
        pts,
        d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
        end: pts[pts.length - 1],
      }
    })

    // End labels, pushed apart so two companies at a similar valuation don't
    // print on top of each other.
    const tags = lines.map((l) => ({ company: l.company, color: l.color, v: l.end.v, y: l.end.y, anchor: l.end.y }))
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < tags.length; i++) {
      if (tags[i].y - tags[i - 1].y < 30) tags[i].y = tags[i - 1].y + 30
    }
    for (let i = tags.length - 1; i >= 0; i--) {
      const cap = i === tags.length - 1 ? PAD.top + innerH : tags[i + 1].y - 30
      if (tags[i].y > cap) tags[i].y = cap
    }

    const ticks = []
    for (let g = 0; g <= 3; g++) {
      const v = 10 ** (lo + (span / 3) * g)
      ticks.push({ v, y: py(v) })
    }

    const xTicks = []
    const STEPS = 4
    for (let g = 0; g <= STEPS; g++) {
      const x = xMin + ((xMax - xMin) / STEPS) * g
      xTicks.push({
        x: px(x),
        label: axis === 'age' ? `${x.toFixed(x < 10 ? 1 : 0)}y` : String(new Date(x).getUTCFullYear()),
      })
    }

    return { lines, tags, ticks, xTicks }
  }, [rows, axis, width])

  // Investors backing more than one of the picked companies — the answer to
  // "who else saw this", which no single company page can show.
  const shared = useMemo(() => {
    if (rows.length < 2) return []
    const count = new Map()
    for (const r of rows) {
      for (const inv of new Set(r.investors || [])) {
        if (!inv) continue
        const cur = count.get(inv) || []
        cur.push(r.company)
        count.set(inv, cur)
      }
    }
    return [...count.entries()]
      .filter(([, cos]) => cos.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
  }, [rows])

  if (loading && !roster.length) {
    return <div className={`pmc${embedded ? ' pmc--embedded' : ''}`}><div className="pi-skel animate-shimmer" style={{ height: 420, borderRadius: 14 }} /></div>
  }

  return (
    <section className={`pmc${embedded ? ' pmc--embedded' : ''}`}>
      <header className="pmc__head">
        <div>
          <span className="pi-eyebrow">{t('privateMarkets.compare.eyebrow', 'Compare')}</span>
          <h3>{t('privateMarkets.compare.title', 'How the ladders stack up')}</h3>
          <p className="pmc__sub">
            {t('privateMarkets.compare.sub', { max: MAX_PICKS })}
          </p>
        </div>
        <div className="pmc__axis" role="group" aria-label={t('privateMarkets.compare.axisGroup', 'Chart axis')}>
          <button type="button" className={`pmc__seg${axis === 'age' ? ' is-on' : ''}`} onClick={() => setAxis('age')} aria-pressed={axis === 'age'}>
            {t('privateMarkets.compare.byAge', 'By age')}
          </button>
          <button type="button" className={`pmc__seg${axis === 'date' ? ' is-on' : ''}`} onClick={() => setAxis('date')} aria-pressed={axis === 'date'}>
            {t('privateMarkets.compare.byDate', 'By date')}
          </button>
        </div>
      </header>

      <div className="pmc__picks">
        {rows.map((r, i) => (
          <span key={r.company} className="pmc__chip" style={{ '--pmc-dot': LINE_COLORS[i % LINE_COLORS.length] }}>
            <i aria-hidden="true" />
            {r.company}
            <button type="button" onClick={() => remove(r.company)} aria-label={t('privateMarkets.compare.removeCompany', { company: r.company })}>×</button>
          </span>
        ))}
        {chosen.length < MAX_PICKS ? (
          <div className="pmc__search">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('privateMarkets.compare.addPlaceholder', 'Add a company…')}
              aria-label={t('privateMarkets.compare.addAria', 'Add a company to the comparison')}
            />
            {matches.length ? (
              <ul className="pmc__results">
                {matches.map((m) => (
                  <li key={m.company}>
                    <button type="button" onClick={() => add(m.company)}>
                      <span>{m.company}</span>
                      <span className="pmc__results-val">{money(m.currentValuation)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="pmc__chart" ref={setWrapEl}>
        {chart ? (
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="pmc__svg" role="img" aria-label={t('privateMarkets.compare.chartAria', 'Valuation ladders compared')}>
            {chart.ticks.map((tk, i) => (
              <g key={i}>
                <line x1={PAD.left} x2={width - PAD.right} y1={tk.y} y2={tk.y} className="pmc__grid" />
                <text x={PAD.left - 9} y={tk.y} className="pmc__axis-y">{money(tk.v)}</text>
              </g>
            ))}
            {chart.xTicks.map((tk, i) => (
              <text key={i} x={tk.x} y={HEIGHT - PAD.bottom + 18} className="pmc__axis-x">{tk.label}</text>
            ))}
            {chart.lines.map((l) => (
              <g key={l.company}>
                <path d={l.d} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {l.pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="var(--bg-void)" stroke={l.color} strokeWidth="2">
                    <title>{`${l.company} · ${p.round || t('privateMarkets.compare.round', 'Round')} · ${money(p.v)}`}</title>
                  </circle>
                ))}
              </g>
            ))}
            {chart.tags.map((tg) => (
              <g key={tg.company}>
                <line
                  x1={width - PAD.right + 1} y1={tg.anchor}
                  x2={width - PAD.right + 12} y2={tg.y}
                  stroke={tg.color} strokeOpacity="0.5" strokeWidth="1"
                />
                <text x={width - PAD.right + 17} y={tg.y - 4} className="pmc__tag-name" fill={tg.color}>{tg.company}</text>
                <text x={width - PAD.right + 17} y={tg.y + 9} className="pmc__tag-val">{money(tg.v)}</text>
              </g>
            ))}
          </svg>
        ) : (
          <p className="pmc__empty">{t('privateMarkets.compare.emptyPick')}</p>
        )}
      </div>

      <div className="pmc__table-wrap">
        <table className="pmc__table">
          <thead>
            <tr>
              <th scope="col">{t('privateMarkets.compare.colCompany', 'Company')}</th>
              <th scope="col">{t('privateMarkets.compare.colValuation', 'Valuation')}</th>
              <th scope="col">{t('privateMarkets.compare.colStepUp', 'Step-up')}</th>
              <th scope="col">{t('privateMarkets.compare.colRaised', 'Raised')}</th>
              <th scope="col">{t('privateMarkets.compare.colEfficiency', '$1 raised buys')}</th>
              <th scope="col">{t('privateMarkets.compare.colRounds', 'Rounds')}</th>
              <th scope="col">{t('privateMarkets.compare.colLastRound', 'Last round')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const eff = r.currentValuation && r.totalRaised ? r.currentValuation / r.totalRaised : null
              return (
                <tr key={r.company}>
                  <th scope="row">
                    <i className="pmc__swatch" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} aria-hidden="true" />
                    {r.company}
                    {r.sector ? <span className="pmc__sector">{r.sector}</span> : null}
                  </th>
                  <td>{money(r.currentValuation)}</td>
                  <td>{r.valuationMultiple ? `${Math.round(r.valuationMultiple)}×` : '—'}</td>
                  <td>{r.totalRaised ? money(r.totalRaised) : '—'}</td>
                  <td>{eff ? t('privateMarkets.compare.valueOf', { amount: `$${eff.toFixed(1)}` }) : '—'}</td>
                  <td>{r.roundCount || '—'}</td>
                  <td>
                    {r.lastRound || '—'}
                    {r.lastRoundDate ? (
                      <span className="pmc__when">
                        {new Date(r.lastRoundDate).toLocaleDateString(i18n.language, { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {shared.length ? (
        <div className="pmc__shared">
          <span className="pi-eyebrow">{t('privateMarkets.compare.sharedTitle', 'Backed both ways')}</span>
          <ul>
            {shared.map(([inv, cos]) => (
              <li key={inv}>
                <span className="pmc__inv">{inv}</span>
                <span className="pmc__inv-cos">{cos.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : rows.length >= 2 ? (
        <p className="pmc__empty pmc__empty--flush">{t('privateMarkets.compare.sharedEmpty')}</p>
      ) : null}
    </section>
  )
}
