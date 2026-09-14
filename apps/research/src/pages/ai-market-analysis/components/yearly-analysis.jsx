/**
 * Yearly Analysis — the seasonal record of an asset, built from our own data.
 *
 * The stock version of this board is a folklore table: "April — historically
 * very strong", no sample size, no source, same twelve rows for every market.
 * This one is computed per asset from `/api/seasonality`, which stitches
 * CoinGecko's pre-listing head onto Binance's monthly candles so Bitcoin's
 * record starts in 2013 rather than the day Binance opened the pair.
 *
 * Every statistic here shows its sample size, leads with the median rather
 * than the mean, and excludes the month still in progress.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COINGECKO_LOGOS } from '@/constants/majorTokens'
import coinLogoUrl from '@/utils/coin-logo'
import InfoTip from '@/components/InfoTip'
import {
  MONTH_ABBR, MONTH_FULL,
  buildMatrix, buildCycleMatrix, cyclePosition,
  rankMonths, behaviourOf, skewWarning, percentileOf,
  pct, pctBare, priceLabel, makeScale,
} from '@/lib/seasonality-math'
import {
  SeasonalCompass, MonthDNA, LifeRibbon, EdgeLab, RotationBoard, WeekdayTape,
} from './yearly-panels'
import './yearly-analysis.css'

const cx = (...a) => a.filter(Boolean).join(' ')

/* Assets with enough history to say anything honest about a calendar. The
   picker also takes any Binance ticker the user types. */
const CRYPTO_ASSETS = [
  { s: 'BTC', n: 'Bitcoin' }, { s: 'ETH', n: 'Ethereum' }, { s: 'SOL', n: 'Solana' },
  { s: 'BNB', n: 'BNB' }, { s: 'XRP', n: 'XRP' }, { s: 'ADA', n: 'Cardano' },
  { s: 'DOGE', n: 'Dogecoin' }, { s: 'AVAX', n: 'Avalanche' }, { s: 'LINK', n: 'Chainlink' },
  { s: 'DOT', n: 'Polkadot' }, { s: 'LTC', n: 'Litecoin' }, { s: 'ATOM', n: 'Cosmos' },
  { s: 'NEAR', n: 'NEAR' }, { s: 'SUI', n: 'Sui' }, { s: 'APT', n: 'Aptos' },
  { s: 'ARB', n: 'Arbitrum' }, { s: 'OP', n: 'Optimism' }, { s: 'AAVE', n: 'Aave' },
  { s: 'UNI', n: 'Uniswap' }, { s: 'INJ', n: 'Injective' }, { s: 'TIA', n: 'Celestia' },
  { s: 'PEPE', n: 'Pepe' }, { s: 'SHIB', n: 'Shiba Inu' }, { s: 'TAO', n: 'Bittensor' },
  { s: 'RENDER', n: 'Render' }, { s: 'FET', n: 'Artificial Superintelligence' },
  { s: 'SPX', n: 'S&P 500' }, { s: 'NQ', n: 'Nasdaq 100' }, { s: 'GOLD', n: 'Gold' },
  { s: 'SILVER', n: 'Silver' }, { s: 'OIL', n: 'Crude oil' }, { s: 'DXY', n: 'Dollar index' },
  { s: 'VIX', n: 'Volatility index' },
]

const STOCK_ASSETS = [
  { s: 'SPY', n: 'S&P 500 ETF' }, { s: 'QQQ', n: 'Nasdaq 100 ETF' }, { s: 'IWM', n: 'Russell 2000' },
  { s: 'AAPL', n: 'Apple' }, { s: 'MSFT', n: 'Microsoft' }, { s: 'NVDA', n: 'NVIDIA' },
  { s: 'AMZN', n: 'Amazon' }, { s: 'GOOGL', n: 'Alphabet' }, { s: 'META', n: 'Meta' },
  { s: 'TSLA', n: 'Tesla' }, { s: 'AMD', n: 'AMD' }, { s: 'AVGO', n: 'Broadcom' },
  { s: 'COIN', n: 'Coinbase' }, { s: 'MSTR', n: 'Strategy' }, { s: 'JPM', n: 'JPMorgan' },
  { s: 'XOM', n: 'Exxon' }, { s: 'NFLX', n: 'Netflix' }, { s: 'WMT', n: 'Walmart' },
  { s: 'TLT', n: '20y Treasuries' }, { s: 'GOLD', n: 'Gold' }, { s: 'VIX', n: 'Volatility index' },
  { s: 'DXY', n: 'Dollar index' },
]

const ROTATION_CRYPTO = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'SPX', 'GOLD']
const ROTATION_STOCKS = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'GOLD', 'TLT']

const LS_SYMBOL = 'spectre-yearly-symbol'

/* ── data ───────────────────────────────────────────────────────────────── */
const _cache = new Map()
function fetchSeasonality(symbol, market) {
  const key = `${market}:${symbol}`
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < 15 * 60_000) return hit.p
  const p = fetch(`/api/seasonality?symbol=${encodeURIComponent(symbol)}&market=${market}`, {
    signal: AbortSignal.timeout(25000),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => (j?.months?.length ? j : Promise.reject(new Error('empty'))))
  _cache.set(key, { ts: Date.now(), p })
  p.catch(() => _cache.delete(key))
  return p
}

function useSeasonality(symbol, market) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    setState((s) => ({ data: s.data?.symbol === symbol ? s.data : null, loading: true, error: null }))
    fetchSeasonality(symbol, market)
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null }) })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: e.message || 'unavailable' }) })
    return () => { alive = false }
  }, [symbol, market])
  return state
}

/* ── small pieces ───────────────────────────────────────────────────────── */
const AssetMark = React.memo(({ sym, size = 22 }) => {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [sym])
  const src = COINGECKO_LOGOS[sym]
  if (src && !broken) {
    return <span className="ya-mark" style={{ width: size, height: size }}>
      <img src={coinLogoUrl(src, size * 2)} alt="" loading="lazy" draggable="false" onError={() => setBroken(true)} />
    </span>
  }
  return <span className="ya-mark ya-mark--mono" style={{ width: size, height: size }}>{sym.slice(0, 2)}</span>
})

function AssetPicker({ symbol, options, onPick }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      cancelAnimationFrame(id)
    }
  }, [open])

  const hits = useMemo(() => {
    const needle = q.trim().toUpperCase()
    if (!needle) return options
    return options.filter((o) => o.s.includes(needle) || o.n.toUpperCase().includes(needle))
  }, [q, options])

  const commit = (s) => { onPick(s); setOpen(false); setQ('') }

  return (
    <div className="ya-picker" ref={boxRef}>
      <button type="button" className={cx('ya-picker-btn', open && 'is-open')} onClick={() => setOpen(!open)} aria-expanded={open}>
        <AssetMark sym={symbol} size={24} />
        <span className="ya-picker-sym">{symbol}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="ya-picker-pop">
          <input
            ref={inputRef}
            className="ya-picker-input"
            value={q}
            placeholder="Ticker or name…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(hits[0]?.s || q.trim().toUpperCase())
            }}
          />
          <div className="ya-picker-list">
            {hits.length === 0 ? (
              <button type="button" className="ya-picker-row ya-picker-row--free" onClick={() => commit(q.trim().toUpperCase())}>
                Try <b>{q.trim().toUpperCase()}</b> anyway
              </button>
            ) : hits.map((o) => (
              <button key={o.s} type="button" className={cx('ya-picker-row', o.s === symbol && 'is-active')} onClick={() => commit(o.s)}>
                <AssetMark sym={o.s} size={20} />
                <span className="ya-picker-row-sym">{o.s}</span>
                <span className="ya-picker-row-name">{o.n}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* An act rule. Nine panels in a column read as a pile; four named movements
   read as an argument — the record, the pattern, the edge, the field. */
function Act({ label, note }) {
  return (
    <div className="ya-act">
      <span className="ya-act-line" />
      <span className="ya-act-label">
        {label}
        {note && <span className="ya-act-note"> · {note}</span>}
      </span>
      <span className="ya-act-line" />
    </div>
  )
}

/* ── verdict: our own version of the "best and worst months" card ───────── */
function VerdictStrip({ profile, onPick, selected }) {
  const ranked = useMemo(() => rankMonths(profile, 'med'), [profile])
  const best = ranked.slice(0, 3)
  const worst = ranked.slice(-3).reverse()

  // Colour follows the SIGN, never the rank. Equities drift up, so all twelve of
  // SPY's medians are positive and the three "weakest" months were being printed
  // in bear red at +0.4% — the heading already says which end of the table they
  // sit at, the number must not contradict it.
  const Row = ({ p }) => {
    const tone = p.med >= 0 ? 'up' : 'down'
    const b = behaviourOf(p, profile)
    const skew = skewWarning(p)
    return (
      <button type="button" className={cx('ya-verdict-row', selected === p.m && 'is-selected')} onClick={() => onPick(p.m)}>
        <span className="ya-verdict-month">{MONTH_FULL[p.m - 1]}</span>
        <span className={cx('ya-verdict-val', tone)}>{pct(p.med)}</span>
        <span className="ya-verdict-meter" aria-hidden>
          <i style={{ width: `${Math.round((p.win ?? 0) * 100)}%` }} className={tone} />
        </span>
        <span className="ya-verdict-win">{pctBare(p.win)} up · n={p.n}</span>
        <span className="ya-verdict-note">
          {b.text}
          {skew && <em> · mean skewed by {skew.year}</em>}
        </span>
      </button>
    )
  }

  return (
    <div className="ya-verdict">
      <section className="ya-panel ya-verdict-card">
        <header className="ya-panel-head">
          <h3>Strongest months</h3>
          <span className="ya-panel-sub">by median return</span>
        </header>
        <div className="ya-verdict-rows">{best.map((p) => <Row key={p.m} p={p} />)}</div>
      </section>
      <section className="ya-panel ya-verdict-card">
        <header className="ya-panel-head">
          <h3>Weakest months</h3>
          <span className="ya-panel-sub">by median return</span>
        </header>
        <div className="ya-verdict-rows">{worst.map((p) => <Row key={p.m} p={p} />)}</div>
      </section>
    </div>
  )
}

/* ── "you are here" ─────────────────────────────────────────────────────── */
function NowCard({ data, market }) {
  const now = new Date()
  const m = now.getUTCMonth() + 1
  const p = data.monthProfile[m - 1]
  const running = data.months.find((x) => x.partial)
  const hist = useMemo(
    () => data.months.filter((x) => x.m === m && !x.partial && Number.isFinite(x.r)).map((x) => x.r),
    [data.months, m]
  )
  const rank = running ? percentileOf(running.r, hist) : null
  const cyc = cyclePosition(market)
  const b = behaviourOf(p, data.monthProfile)

  return (
    <section className="ya-panel ya-now">
      <header className="ya-panel-head">
        <h3>Where we are</h3>
        <span className="ya-panel-sub">{MONTH_FULL[m - 1]} {now.getUTCFullYear()}</span>
      </header>
      <div className="ya-now-body">
        <div className="ya-now-big">
          <span className="ya-now-label">This month so far</span>
          <span className={cx('ya-now-val', (running?.r ?? 0) >= 0 ? 'up' : 'down')}>{pct(running?.r)}</span>
          {Number.isFinite(rank) && (
            <span className="ya-now-rank">
              stronger than {Math.round(rank * 100)}% of the {hist.length} {MONTH_ABBR[m - 1]}s on record
            </span>
          )}
        </div>
        <div className="ya-now-side ya-well">
          <div className="ya-now-line">
            <span>Typical {MONTH_ABBR[m - 1]}</span>
            <b className={p?.med >= 0 ? 'up' : 'down'}>{pct(p?.med)}</b>
          </div>
          <div className="ya-now-line">
            <span>Up years</span>
            <b>{pctBare(p?.win)} <i>of {p?.n}</i></b>
          </div>
          <div className="ya-now-line">
            <span>Character</span>
            <b className={b.tone === 'bull' ? 'up' : b.tone === 'bear' ? 'down' : ''}>{b.text}</b>
          </div>
          {cyc && (
            <div className="ya-now-line">
              <span>{market === 'crypto' ? 'Halving clock' : 'Election clock'}</span>
              <b>month {cyc.offset} of the {cyc.key} cycle</b>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/* ── the matrix ─────────────────────────────────────────────────────────── */
function CalendarMatrix({ data, view, selectedMonth, onSelectMonth, dayMode }) {
  const rows = useMemo(() => buildMatrix(data.months), [data.months])
  const scale = useMemo(() => makeScale(data.months.map((x) => x.r), dayMode), [data.months, dayMode])
  const totalScale = useMemo(() => makeScale(rows.map((r) => r.total), dayMode), [rows, dayMode])

  const cellText = (mo) => {
    if (!mo) return ''
    if (view === 'price') return priceLabel(mo.c)
    return Number.isFinite(mo.r) ? pct(mo.r, 0) : ''
  }

  return (
    <div className="ya-matrix-scroll">
      <table className="ya-matrix">
        <thead>
          <tr>
            <th className="ya-matrix-corner">Year</th>
            {MONTH_ABBR.map((label, i) => (
              <th key={label}>
                <button
                  type="button"
                  className={cx('ya-matrix-mhead', selectedMonth === i + 1 && 'is-selected')}
                  onClick={() => onSelectMonth(i + 1)}
                >{label}</button>
              </th>
            ))}
            <th className="ya-matrix-total-head">Year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.y}>
              <th className="ya-matrix-year">{row.y}</th>
              {row.cells.map((mo, i) => {
                const s = mo ? scale(mo.r) : null
                return (
                  <td key={i} className={cx(selectedMonth === i + 1 && 'is-col-selected')}>
                    {mo ? (
                      <span
                        className={cx('ya-cell', mo.partial && 'is-running', mo.src === 'coingecko' && 'is-stitched')}
                        style={{ background: s.bg, color: s.fg, borderColor: s.ring }}
                        title={`${MONTH_FULL[i]} ${row.y} · ${pct(mo.r)} · close ${priceLabel(mo.c)}${Number.isFinite(mo.dd) ? ` · worst dip ${pct(mo.dd)}` : ''}${mo.partial ? ' · still running' : ''}`}
                      >{cellText(mo)}</span>
                    ) : <span className="ya-cell ya-cell--void" />}
                  </td>
                )
              })}
              <td>
                <span
                  className={cx('ya-cell ya-cell--total', row.running && 'is-running')}
                  style={row.total != null ? { background: totalScale(row.total).bg, color: totalScale(row.total).fg, borderColor: totalScale(row.total).ring } : undefined}
                  title={row.partial ? `${row.count} of 12 months` : 'Full year'}
                >{pct(row.total, 0)}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {[
            { key: 'med', label: 'Median', fmt: (p) => pct(p.med, 0) },
            { key: 'avg', label: 'Mean', fmt: (p) => pct(p.avg, 0) },
            // These labels SET the width of the year column — they are the
            // widest thing in it, and "Up years" alone was pushing a 39px
            // column of four-digit years out to 91px. Shorter labels, same
            // meaning: the value under "Up" is already a percentage, and n is
            // the standard name for a sample size.
            { key: 'win', label: 'Up', fmt: (p) => pctBare(p.win) },
            { key: 'n', label: 'n', fmt: (p) => (p.n ? `${p.n}y` : '—') },
          ].map((r) => (
            <tr key={r.key} className={cx('ya-matrix-foot', `ya-foot-${r.key}`)}>
              <th>{r.label}</th>
              {data.monthProfile.map((p, i) => {
                const tone = r.key === 'n' ? null : (r.key === 'win' ? (p.win >= 0.5 ? 'up' : 'down') : (p[r.key] >= 0 ? 'up' : 'down'))
                return (
                  <td key={p.m} className={cx(selectedMonth === i + 1 && 'is-col-selected')}>
                    <span className={cx('ya-foot-val', tone)}>{p.n ? r.fmt(p) : '—'}</span>
                  </td>
                )
              })}
              <td />
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}

function CycleMatrix({ data, market, view, dayMode }) {
  const rows = useMemo(() => buildCycleMatrix(data.months, market), [data.months, market])
  const scale = useMemo(() => makeScale(data.months.map((x) => x.r), dayMode), [data.months, dayMode])
  const here = cyclePosition(market)
  const cols = Math.max(...rows.map((r) => r.cells.length), 48)

  if (!rows.length) return <div className="ya-empty-inline">Not enough history to align cycles.</div>

  return (
    <div className="ya-matrix-scroll">
      <table className="ya-matrix ya-matrix--cycle">
        <thead>
          <tr>
            <th className="ya-matrix-corner">{market === 'crypto' ? 'Halving' : 'Election'}</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className={cx(i % 12 === 0 && 'is-yearmark')}>{i % 12 === 0 ? `Y${i / 12 + 1}` : i % 12}</th>
            ))}
            <th className="ya-matrix-total-head">Cycle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th className="ya-matrix-year">{row.key}</th>
              {Array.from({ length: cols }, (_, i) => {
                const mo = row.cells[i]
                const s = mo ? scale(mo.r) : null
                const isHere = row.running && here?.key === row.key && here.offset === i
                return (
                  <td key={i} className={cx(i % 12 === 0 && 'is-yearmark')}>
                    {mo ? (
                      <span
                        className={cx('ya-cell', mo.partial && 'is-running', isHere && 'is-here')}
                        style={{ background: s.bg, color: s.fg, borderColor: s.ring }}
                        title={`${MONTH_FULL[mo.m - 1]} ${mo.y} · month ${i} of the ${row.key} cycle · ${pct(mo.r)}`}
                      >{view === 'price' ? priceLabel(mo.c) : pct(mo.r, 0)}</span>
                    ) : <span className="ya-cell ya-cell--void" />}
                  </td>
                )
              })}
              <td>
                <span className="ya-cell ya-cell--total" style={{ background: scale(row.total).bg, color: scale(row.total).fg, borderColor: scale(row.total).ring }}>
                  {pct(row.total, 0)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ya-note">
        Calendar years compare month 7 of a bull run against month 31 of a bear. Aligning every row on
        {market === 'crypto' ? ' its halving ' : ' its election '}
        puts the same point of the cycle in the same column — the running row stops where we actually are.
      </p>
    </div>
  )
}

/* ── page ───────────────────────────────────────────────────────────────── */
export default function YearlyAnalysis({ dayMode, marketMode = 'crypto', isMobile }) {
  const isStocks = marketMode === 'stocks'
  const options = isStocks ? STOCK_ASSETS : CRYPTO_ASSETS
  const market = isStocks ? 'stocks' : 'crypto'

  const [symbol, setSymbol] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_SYMBOL) || 'null')
      const v = saved?.[isStocks ? 'stocks' : 'crypto']
      if (typeof v === 'string' && v) return v
    } catch { /* private mode */ }
    return isStocks ? 'SPY' : 'BTC'
  })
  const [layout, setLayout] = useState('calendar')
  const [view, setView] = useState('return')
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getUTCMonth() + 1)
  const [picked, setPicked] = useState(() => new Set())
  const [rotation, setRotation] = useState(null)

  useEffect(() => {
    setSymbol(isStocks ? 'SPY' : 'BTC')
  }, [isStocks])

  useEffect(() => {
    try {
      const prev = JSON.parse(localStorage.getItem(LS_SYMBOL) || '{}')
      localStorage.setItem(LS_SYMBOL, JSON.stringify({ ...prev, [isStocks ? 'stocks' : 'crypto']: symbol }))
    } catch { /* private mode */ }
  }, [symbol, isStocks])

  const { data, loading, error } = useSeasonality(symbol, market)

  /* Default the edge lab to the six strongest months of whatever is loaded. */
  useEffect(() => {
    if (!data) return
    setPicked(new Set(rankMonths(data.monthProfile, 'med').slice(0, 6).map((p) => p.m)))
  }, [data])

  /* The rotation board is one call for the whole row set. */
  const rotationSyms = isStocks ? ROTATION_STOCKS : ROTATION_CRYPTO
  useEffect(() => {
    let alive = true
    setRotation(null)
    fetch(`/api/seasonality?symbols=${rotationSyms.join(',')}&market=${market}`, { signal: AbortSignal.timeout(30000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.assets?.length) setRotation(j.assets) })
      .catch(() => {})
    return () => { alive = false }
  }, [market, rotationSyms.join(',')])

  const togglePick = useCallback((m) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m); else next.add(m)
      return next
    })
  }, [])

  const applyPreset = useCallback((kind) => {
    if (!data) return
    if (kind === 'all') return setPicked(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
    if (kind === 'positive') return setPicked(new Set(data.monthProfile.filter((p) => p.med > 0).map((p) => p.m)))
    return setPicked(new Set(rankMonths(data.monthProfile, 'med').slice(0, 6).map((p) => p.m)))
  }, [data])

  const running = data?.months.find((x) => x.partial)
  const mtd = running && running.m === selectedMonth ? running.r : null
  const curMonth = new Date().getUTCMonth() + 1

  return (
    <div className={cx('ya-root', isMobile && 'is-mobile', dayMode && 'is-day')}>
      {/* ── control rail ── */}
      <div className="ya-rail">
        <div className="ya-rail-left">
          <AssetPicker symbol={symbol} options={options} onPick={setSymbol} />
          {data && (
            <div className="ya-coverage">
              <span className="ya-coverage-years">{data.coverage.years} years</span>
              <span className="ya-coverage-span">
                <span className="ya-coverage-sep">·</span>{' '}{data.coverage.from} → {data.coverage.to}
              </span>
              <span className="ya-coverage-src">
                <span className="ya-coverage-sep">·</span> {data.venue}
              </span>
              <InfoTip
                position="bottom"
                text={`Month candles are stitched: ${data.venue}. Returns are close-to-close, the running month is excluded from every average, and each column shows its own sample size.`}
              />
            </div>
          )}
        </div>
        <div className="ya-rail-right">
          <div className="ya-seg">
            <button type="button" className={cx(layout === 'calendar' && 'is-on')} onClick={() => setLayout('calendar')}>Calendar</button>
            <button type="button" className={cx(layout === 'cycle' && 'is-on')} onClick={() => setLayout('cycle')}>
              {isStocks ? 'Election cycle' : 'Halving cycle'}
            </button>
          </div>
          <div className="ya-seg">
            <button type="button" className={cx(view === 'return' && 'is-on')} onClick={() => setView('return')}>Return</button>
            <button type="button" className={cx(view === 'price' && 'is-on')} onClick={() => setView('price')}>Price</button>
          </div>
        </div>
      </div>

      {loading && !data && <YearlySkeleton />}

      {error && !data && (
        <div className="ya-panel ya-error">
          <b>No seasonal record for {symbol}.</b>
          <span>{error === 'HTTP 404'
            ? 'We only build this from venues with real monthly history — try a listed major.'
            : 'The history service did not answer. Try again in a moment.'}</span>
        </div>
      )}

      {data && (
        <>
          <Act label="The record" note={`${data.coverage.years} years of ${symbol}`} />

          <NowCard data={data} market={market} />

          <VerdictStrip profile={data.monthProfile} onPick={setSelectedMonth} selected={selectedMonth} />

          <section className="ya-panel">
            <header className="ya-panel-head">
              <h3>{layout === 'cycle' ? 'The cycle grid' : 'Monthly returns by year'}</h3>
              <span className="ya-panel-sub">
                {view === 'price' ? 'month close, coloured by that month’s return' : 'close-to-close, coloured by size'}
              </span>
              <span className="ya-legend">
                <i className="ya-key ya-key--dn" /> down
                <i className="ya-key ya-key--up" /> up
                <i className="ya-key ya-key--run" /> running
                {data.sources.length > 1 && <><i className="ya-key ya-key--stitch" /> pre-listing</>}
              </span>
            </header>
            <div className="ya-well ya-well--flush">
            {layout === 'cycle'
              ? <CycleMatrix data={data} market={market} view={view} dayMode={dayMode} />
              : <CalendarMatrix data={data} view={view} selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} dayMode={dayMode} />}
            </div>
          </section>

          <Act label="The pattern" note="what repeats, and how hard" />

          <div className="ya-duo">
            <section className="ya-panel ya-panel--compass">
              <header className="ya-panel-head">
                <h3>Seasonal compass</h3>
                <span className="ya-panel-sub">median return, weighted by how often it repeats</span>
              </header>
              <SeasonalCompass
                profile={data.monthProfile}
                selected={selectedMonth}
                onSelect={setSelectedMonth}
                currentMonth={curMonth}
              />
            </section>

            <section className="ya-panel">
              <header className="ya-panel-head">
                <h3>{MONTH_FULL[selectedMonth - 1]}, year by year</h3>
                <span className="ya-panel-sub">every {MONTH_ABBR[selectedMonth - 1]} this asset has traded</span>
              </header>
              <MonthDNA
                months={data.months}
                m={selectedMonth}
                profile={data.monthProfile[selectedMonth - 1]}
                mtd={mtd}
              />
            </section>
          </div>

          <Act label="The edge" note="what the read was worth" />

          <section className="ya-panel">
            <header className="ya-panel-head">
              <h3>Every month it has ever traded</h3>
              <span className="ya-panel-sub">{data.coverage.months} months, oldest first</span>
            </header>
            <LifeRibbon months={data.months} onPick={setSelectedMonth} dayMode={dayMode} compact={isMobile} />
          </section>

          <section className="ya-panel">
            <header className="ya-panel-head">
              <h3>What the seasonal read was worth</h3>
              <span className="ya-panel-sub">hold only the months you pick, cash otherwise</span>
            </header>
            <EdgeLab months={data.months} picked={picked} onToggle={togglePick} onPreset={applyPreset} />
          </section>

          {(rotation || data.effects) && <Act label="The field" note="the same calendar, wider" />}

          {rotation && rotation.length > 1 && (
            <section className="ya-panel">
              <header className="ya-panel-head">
                <h3>Rotation board</h3>
                <span className="ya-panel-sub">which asset owns which month</span>
              </header>
              <RotationBoard assets={rotation} activeSymbol={symbol} onPick={setSymbol} dayMode={dayMode} />
            </section>
          )}

          {data.effects && (
            <section className="ya-panel">
              <header className="ya-panel-head">
                <h3>Inside the month</h3>
                <span className="ya-panel-sub">average daily return by weekday, and the turn-of-month window</span>
              </header>
              <WeekdayTape effects={data.effects} />
            </section>
          )}

          <p className="ya-footnote">
            Seasonality describes what happened, not what happens next. Ten to forty observations per
            month is a small sample by any statistical standard — the sample size sits next to every
            number here so you can weigh it yourself.
          </p>
        </>
      )}
    </div>
  )
}

function YearlySkeleton() {
  return (
    <div className="ya-skeleton" aria-hidden>
      <div className="ya-sk-row ya-sk-row--tall" />
      <div className="ya-sk-duo">
        <div className="ya-sk-row" />
        <div className="ya-sk-row" />
      </div>
      <div className="ya-sk-row ya-sk-row--matrix" />
    </div>
  )
}
