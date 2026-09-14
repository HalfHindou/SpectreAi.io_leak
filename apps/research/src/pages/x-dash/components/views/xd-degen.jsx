/**
 * Degen — pre-CoinGecko tokens caught from on-chain volume + X buzz (the
 * worker-early-runner-detector's DexScreener/Codex resolution), that the
 * CG-keyed leaderboard cannot show yet. HARD RULE (founder): every token here
 * carries a live SOCIAL signal — a silent on-chain launch never appears.
 * Reads /api/xdash/early-runners; dedupes the detector's dup-row floods,
 * gates on social, micro-filters listed tokens, and respects the command-bar
 * chain filter (so Degen + Robinhood = the pre-CG Robinhood tokens).
 */
import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import { useXDashChainScan } from '@/hooks/useXDashChainScan'
import { getDexScreenerTokens } from '@/services/dexscreenerApi'
import { canonicalChainKey, chainLabel, tokenMatchesChain, chainOptionsFromTokens } from '@/lib/chain-normalize'
import { openTradingTerminal } from '@/lib/trading-terminal'
import { useCopyToast } from '@/contexts/CopyToastContext'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { Shimmer, EmptyState, ErrorState, Avatar } from '../xd-bits'
import { formatNum } from '../x-dash-utils'

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const MIN_MENTIONS = 3          // social gate: no social, no show (founder rule)
const MIN_AUTHORS = 2
const MIN_MCAP = 25_000         // below this it's dust/a dead clone pool ($ARROW $375), not a play
const MIN_LIQ = 1_000           // a real play has tradeable liquidity (dust pools show ~$2)
const LISTED_MCAP = 15_000_000  // "micro only" ceiling — above this it reads as listed

const CHAIN_ACCENT = {
  solana: '#14F195', robinhood: '#3FE0A5', ethereum: '#7B88F0', base: '#5B8DEF',
  bsc: '#F0B90B', monad: '#B794F6', arbitrum: '#38BDF8', 'polygon-pos': '#A96BF0',
}
const accentForChain = (ch) => CHAIN_ACCENT[canonicalChainKey(ch)] || '#38E0F0'

function normalizeRunner(row) {
  if (!row || typeof row !== 'object') return row
  return {
    ...row,
    authors: num(row.unique_authors_24h ?? row.unique_external_authors_24h),
    reach: num(row.followers_reach),
    mentions: num(row.mentions_24h),
    mcap: num(row.market_cap_usd),
    liq: num(row.liquidity_usd),
    vol: num(row.volume_24h_usd),
    buzz: num(row.buzz_score),
    confirmedTs: row.confirmed_at ? Date.parse(row.confirmed_at) : null,
    firstSeenTs: row.first_seen_at ? Date.parse(row.first_seen_at) : null,
    driftPct: (num(row.market_cap_usd) > 0 && num(row.mcap_at_confirm) > 0)
      ? ((row.market_cap_usd / row.mcap_at_confirm) - 1) * 100 : null,
    live: !(row.status === 'expired' || row.expired_at),
  }
}

// One row per token — the detector emits a fresh row every re-confirm cycle
// (34× $VANRY in a 200-row window). Keep the live/freshest per contract.
function dedupeRunners(rows) {
  const keyOf = (r) => String(r.contract_address || r.token_address || `${r.symbol}:${r.chain}`).toLowerCase()
  const freshness = (r) => r.confirmedTs || (r.last_scored_at ? Date.parse(r.last_scored_at) : 0) || r.firstSeenTs || 0
  const best = new Map()
  for (const r of rows || []) {
    const k = keyOf(r)
    const prev = best.get(k)
    const rLive = r.live ? 1 : 0
    const pLive = prev?.live ? 1 : 0
    if (!prev || rLive > pLive || (rLive === pLive && freshness(r) > freshness(prev))) best.set(k, r)
  }
  return [...best.values()]
}

const likelyListed = (r) => !!r.cg_listed || r.mcap >= LISTED_MCAP
const hasSocial = (r) => r.mentions >= MIN_MENTIONS && r.authors >= MIN_AUTHORS
// On-chain confirmed: a REAL resolved size (mcap ≥ $25K AND liquidity ≥ $1K)
// on a resolved chain. Drops (a) unresolved rows the detector left at mcap 0
// with a broken "$—" ($PUMP), (b) dust/dead-clone pools the buzz matched to the
// wrong contract ($ARROW $375 mcap / $2.7 liquidity), and (c) no-chain rows.
const onChainConfirmed = (r) => r.mcap >= MIN_MCAP && r.liq >= MIN_LIQ && !!r.chain

function ago(ts) {
  if (!ts) return null
  const d = Date.now() - ts
  if (d < 6e4) return 'now'
  const h = d / 36e5
  if (h < 1) return `${Math.round(d / 6e4)}m`
  if (h < 24) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}
const shortCa = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a || ''))

const SORTS = [
  { key: 'buzz', label: 'Buzz', get: (r) => r.buzz },
  { key: 'mentions', label: 'Mentions', get: (r) => r.mentions },
  { key: 'fresh', label: 'Freshest', get: (r) => r.firstSeenTs || 0 },
  { key: 'mcap', label: 'Mcap', get: (r) => r.mcap },
  { key: 'vol', label: 'Volume', get: (r) => r.vol },
]

/* Every sortable metric — the chips above expose the headline five, the list
   headers can sort by ANY visible column. */
const SORT_GETTERS = {
  buzz: (r) => r.buzz,
  mentions: (r) => r.mentions,
  fresh: (r) => r.firstSeenTs || 0,
  mcap: (r) => r.mcap,
  vol: (r) => r.vol,
  liq: (r) => r.liq,
  authors: (r) => r.authors,
  reach: (r) => r.reach,
  drift: (r) => (r.driftPct == null ? -Infinity : r.driftPct),
}

/* List-view columns. `sort` = the SORT_GETTERS key a header click applies;
   `hint` = plain-language meaning (title tooltip) so raw numbers like Buzz
   and Reach carry context. defaultOff columns start hidden. */
const LIST_COLUMNS = [
  { key: 'mcap', label: 'Mcap', i18n: 'xDash.degen.col.mcap', sort: 'mcap' },
  { key: 'liq', label: 'Liquidity', i18n: 'xDash.degen.col.liq', sort: 'liq' },
  { key: 'vol', label: 'Vol 24h', i18n: 'xDash.degen.col.vol', sort: 'vol' },
  { key: 'mentions', label: 'Mentions', i18n: 'xDash.degen.col.mentions', sort: 'mentions', hint: 'X posts naming this token in the last 24h' },
  { key: 'authors', label: 'Authors', i18n: 'xDash.degen.col.authors', sort: 'authors', hint: 'Distinct accounts posting — breadth beats one loud account' },
  { key: 'reach', label: 'Reach', i18n: 'xDash.degen.col.reach', sort: 'reach', hint: 'Combined follower count of the posting accounts', defaultOff: true },
  { key: 'buzz', label: 'Buzz', i18n: 'xDash.degen.col.buzz', sort: 'buzz', hint: 'Composite social-heat score: mentions x authors x engagement' },
  { key: 'drift', label: 'Since flag', i18n: 'xDash.degen.col.drift', sort: 'drift', hint: 'Mcap move since the detector flagged it' },
  { key: 'age', label: 'Age', i18n: 'xDash.degen.col.age', sort: 'fresh', hint: 'Time since first seen on-chain + on X', defaultOff: true },
  { key: 'ca', label: 'Contract', i18n: 'xDash.degen.col.ca' },
]

const PREFS_KEY = 'spectre-xd-degen-prefs-v1'
const COLS_KEY = 'spectre-xd-degen-cols-v1'

function loadPrefs() {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') || {} } catch { return {} }
}
function savePrefs(p) {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* quota / private mode */ }
}
function loadHiddenCols() {
  const defaults = new Set(LIST_COLUMNS.filter((c) => c.defaultOff).map((c) => c.key))
  if (typeof window === 'undefined') return defaults
  try {
    const raw = window.localStorage.getItem(COLS_KEY)
    if (raw == null) return defaults
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((k) => LIST_COLUMNS.some((c) => c.key === k)) : [])
  } catch { return defaults }
}
function saveHiddenCols(set) {
  try { window.localStorage.setItem(COLS_KEY, JSON.stringify([...set])) } catch { /* quota / private mode */ }
}

const CopyIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
)

function Stat({ label, value, strong, hint }) {
  return (
    <div className={`xdg-stat${strong ? ' xdg-stat--strong' : ''}`} title={hint || undefined}>
      <span className="xdg-stat__label">{label}</span>
      <span className="xdg-stat__value xd-num">{value}</span>
    </div>
  )
}

/* Columns chooser — same glass panel pattern (and classes) as the Proof
   tape's chooser, so one CSS block styles both. */
function ColumnMenu({ hidden, onToggle, t }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="xd-tr-colmenu" ref={ref}>
      <button
        type="button"
        className={`xd-tr-colmenu__btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <line x1="6.4" y1="2.5" x2="6.4" y2="13.5" />
          <line x1="10" y1="2.5" x2="10" y2="13.5" />
        </svg>
        {t('xDash.degen.columns', 'Columns')}
      </button>
      {open && (
        <div className="xd-tr-colmenu__panel" role="menu">
          <span className="xd-tr-colmenu__title">{t('xDash.degen.columnsTitle', 'Show columns')}</span>
          {LIST_COLUMNS.map((c) => {
            const on = !hidden.has(c.key)
            return (
              <button
                key={c.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className={`xd-tr-colmenu__item${on ? ' is-on' : ''}`}
                onClick={() => onToggle(c.key)}
              >
                <span className="xd-tr-colmenu__check" aria-hidden="true">
                  {on && (
                    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2.4 6.3l2.2 2.3 5-5.2" /></svg>
                  )}
                </span>
                {t(c.i18n, c.label)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DegenCard({ row, rank, fmtLargeShort, dex }) {
  const { triggerCopyToast } = useCopyToast()
  const accent = accentForChain(row.chain)
  const listed = likelyListed(row)
  const ca = row.contract_address || row.token_address
  const usd = (v) => (v ? fmtLargeShort(v) : '—')
  // Live DexScreener overlay by contract: real logo + a fresher mcap than the
  // detection-time figure the early-runner row carries.
  const logo = dex?.logo || null
  const liveMcap = num(dex?.marketCap) > 0 ? num(dex.marketCap) : row.mcap
  const copyCa = (e) => {
    e.stopPropagation()
    if (!ca || !navigator.clipboard) return
    navigator.clipboard.writeText(ca)
    triggerCopyToast('CA copied to clipboard')
  }
  const open = (e) => { e?.stopPropagation?.(); if (ca) openTradingTerminal(ca) }

  return (
    <div
      className="xdg-card" style={{ '--xdg-accent': accent }}
      role="button" tabIndex={0} onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') open(e) }}
    >
      <span className="xdg-card__glow" aria-hidden="true" />

      <div className="xdg-card__top">
        <span className="xdg-card__rank">{rank}</span>
        <Avatar src={logo} alt={row.symbol} size={32} className="xdg-card__logo" />
        <div className="xdg-card__idwrap">
          <div className="xdg-card__id">
            <span className="xdg-card__sym">${row.symbol}</span>
            {!listed
              ? <span className="xdg-chip xdg-chip--precg">PRE-CG</span>
              : <span className="xdg-chip xdg-chip--listed">on CG</span>}
            <span className={`xdg-chip xdg-chip--${row.live ? 'live' : 'cooled'}`}>{row.live ? 'Running' : 'Cooled'}</span>
          </div>
          <div className="xdg-card__sub">
            <span className="xdg-chip xdg-chip--chain">{chainLabel(canonicalChainKey(row.chain) || row.chain)}</span>
            {row.firstSeenTs && <span>· seen {ago(row.firstSeenTs)} ago</span>}
            {row.driftPct != null && (
              <span className={`xdg-drift ${row.driftPct >= 0 ? 'up' : 'down'}`}>· {row.driftPct >= 0 ? '+' : ''}{row.driftPct.toFixed(0)}% since flag</span>
            )}
          </div>
        </div>
        <div className="xdg-card__mcap">
          <div className="xdg-card__mcap-val xd-num">{usd(liveMcap)}</div>
          <div className="xdg-card__mcap-lbl">mcap</div>
        </div>
      </div>

      <div className="xdg-stats">
        <Stat label="Liquidity" value={usd(row.liq)} />
        <Stat label="Vol 24h" value={usd(row.vol)} />
        <Stat label="Mentions" value={formatNum(row.mentions)} strong hint="X posts naming this token in the last 24h" />
        <Stat label="Authors" value={formatNum(row.authors)} hint="Distinct accounts posting — breadth beats one loud account" />
        <Stat label="Reach" value={row.reach ? formatNum(row.reach, { maxFraction: 0 }) : '—'} hint="Combined follower count of the posting accounts" />
        <Stat label="Buzz" value={formatNum(row.buzz, { maxFraction: 0 })} hint="Composite social-heat score: mentions x authors x engagement" />
      </div>

      <div className="xdg-card__foot">
        <button type="button" className="xdg-ca" onClick={copyCa} title="Copy contract address">
          {shortCa(ca)} <CopyIcon />
        </button>
        <button type="button" className="xdg-open" onClick={open}>Open ↗</button>
      </div>
    </div>
  )
}

function DegenRow({ row, rank, fmtLargeShort, dex, show }) {
  const { triggerCopyToast } = useCopyToast()
  const accent = accentForChain(row.chain)
  const ca = row.contract_address || row.token_address
  const usd = (v) => (v ? fmtLargeShort(v) : '—')
  const logo = dex?.logo || null
  const liveMcap = num(dex?.marketCap) > 0 ? num(dex.marketCap) : row.mcap
  const listed = likelyListed(row)
  const open = () => { if (ca) openTradingTerminal(ca) }
  const copyCa = (e) => {
    e.stopPropagation()
    if (ca && navigator.clipboard) { navigator.clipboard.writeText(ca); triggerCopyToast('CA copied to clipboard') }
  }
  return (
    <tr className="xdg-row" style={{ '--xdg-accent': accent }} onClick={open}>
      <td className="xdg-row__rank xd-num">{rank}</td>
      <td className="xdg-row__token">
        <Avatar src={logo} alt={row.symbol} size={26} className="xdg-row__logo" />
        <div className="xdg-row__id">
          <span className="xdg-row__sym">
            ${row.symbol}
            {!listed && <span className="xdg-chip xdg-chip--precg">PRE-CG</span>}
            <span className={`xdg-chip xdg-chip--${row.live ? 'live' : 'cooled'}`}>{row.live ? 'Running' : 'Cooled'}</span>
          </span>
          <span className="xdg-row__meta">
            <span className="xdg-chip xdg-chip--chain">{chainLabel(canonicalChainKey(row.chain) || row.chain)}</span>
            {row.firstSeenTs && <> · seen {ago(row.firstSeenTs)} ago</>}
          </span>
        </div>
      </td>
      {show('mcap') && <td className="xdg-row__num xd-num">{usd(liveMcap)}</td>}
      {show('liq') && <td className="xdg-row__num xd-num">{usd(row.liq)}</td>}
      {show('vol') && <td className="xdg-row__num xd-num">{usd(row.vol)}</td>}
      {show('mentions') && <td className="xdg-row__num xd-num xdg-row__strong">{formatNum(row.mentions)}</td>}
      {show('authors') && <td className="xdg-row__num xd-num">{formatNum(row.authors)}</td>}
      {show('reach') && <td className="xdg-row__num xd-num">{row.reach ? formatNum(row.reach, { maxFraction: 0 }) : '—'}</td>}
      {show('buzz') && <td className="xdg-row__num xd-num">{formatNum(row.buzz, { maxFraction: 0 })}</td>}
      {show('drift') && (
        <td className={`xdg-row__num xd-num${row.driftPct != null ? (row.driftPct >= 0 ? ' xdg-row__pos' : ' xdg-row__neg') : ''}`}>
          {row.driftPct != null ? `${row.driftPct >= 0 ? '+' : ''}${row.driftPct.toFixed(0)}%` : '—'}
        </td>
      )}
      {show('age') && <td className="xdg-row__num xd-num">{row.firstSeenTs ? ago(row.firstSeenTs) : '—'}</td>}
      {show('ca') && (
        <td className="xdg-row__ca">
          <button type="button" className="xdg-ca" onClick={copyCa} title="Copy contract">{shortCa(ca)} <CopyIcon /></button>
        </td>
      )}
      <td className="xdg-row__act">
        <button type="button" className="xdg-open" onClick={(e) => { e.stopPropagation(); open() }}>Open ↗</button>
      </td>
    </tr>
  )
}

function DegenList({ rows, fmtLargeShort, dexMap, hiddenCols, sortKey, onSort }) {
  const { t } = useTranslation()
  const show = (key) => !hiddenCols.has(key)
  return (
    <div className="xdg-listwrap">
      <table className="xdg-list">
        <thead>
          <tr>
            <th className="xdg-th-rank">#</th>
            <th>{t('xDash.degen.col.token', 'Token')}</th>
            {LIST_COLUMNS.filter((c) => show(c.key)).map((c) => (
              c.sort ? (
                <th
                  key={c.key}
                  className={`xdg-th-num xdg-th--sortable${sortKey === c.sort ? ' is-active' : ''}`}
                  aria-sort={sortKey === c.sort ? 'descending' : undefined}
                >
                  <button type="button" onClick={() => onSort(c.sort)} title={c.hint || undefined}>
                    {t(c.i18n, c.label)}
                    <svg className="xdg-th__caret" viewBox="0 0 8 6" width="7" height="5" aria-hidden="true">
                      <path d="M1 1l3 4 3-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </th>
              ) : (
                <th key={c.key} className="xdg-th-num" title={c.hint || undefined}>{t(c.i18n, c.label)}</th>
              )
            ))}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <DegenRow
              key={r.contract_address || r.id || i}
              row={r} rank={i + 1} fmtLargeShort={fmtLargeShort}
              dex={dexMap[String(r.contract_address || '').toLowerCase()]}
              show={show}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function XDDegen({ controls, onChainsAvailable }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  /* view / sort / micro persist — a power user shouldn't re-pick List +
     Volume + Micro-only on every visit. */
  const [micro, setMicro] = useState(() => loadPrefs().micro !== false)
  const [sortKey, setSortKey] = useState(() => {
    const s = loadPrefs().sort
    return SORT_GETTERS[s] ? s : 'buzz'
  })
  const [view, setView] = useState(() => (loadPrefs().view === 'list' ? 'list' : 'cards'))
  useEffect(() => { savePrefs({ micro, sort: sortKey, view }) }, [micro, sortKey, view])
  const [hiddenCols, setHiddenCols] = useState(loadHiddenCols)
  const toggleCol = (key) => setHiddenCols((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    saveHiddenCols(next)
    return next
  })

  const { data, loading, error, refetch } = useXDashSurface(
    '/api/xdash/early-runners',
    { limit: 200 },
    { ttlMs: 60_000, refreshIntervalMs: 120_000 },
  )
  const payload = data && typeof data === 'object' ? (data.data ?? data) : null

  // The X Dash board (top ~100 by momentum) — a token here is NOT "off-board",
  // so exclude it from Degen (e.g. $MANIFEST is on the leaderboard already).
  // The board only serves ~100 rows, so this covers everything it can show.
  const boardParams = useMemo(() => ({ timeframe: '24h', ranking: 'momentum', segment: 'all', market: 'all', minKols: 1 }), [])
  const { rows: boardRows } = useXDashChainScan(boardParams, { enabled: true })
  const boardKeys = useMemo(() => {
    const set = new Set()
    for (const tk of boardRows || []) {
      const sym = String(tk.symbol || '').toLowerCase()
      if (sym) set.add(`s:${sym}`)
      const ca = String(tk.contract_address || tk.address || '').toLowerCase()
      if (ca) set.add(`c:${ca}`)
    }
    return set
  }, [boardRows])
  const onBoard = useMemo(() => (r) => {
    const ca = String(r.contract_address || r.token_address || '').toLowerCase()
    if (ca && boardKeys.has(`c:${ca}`)) return true
    const sym = String(r.symbol || '').toLowerCase()
    return sym ? boardKeys.has(`s:${sym}`) : false
  }, [boardKeys])

  // All social-spotted pre-CG tokens (pre chain/micro filters) — the base pool.
  // Include the detector's CANDIDATES too (not just confirmed) to surface MORE
  // plays; the hard gates below keep them honest (social + real on-chain size).
  const socialConfirmed = useMemo(() => {
    const raw = [
      ...(Array.isArray(payload?.confirmed) ? payload.confirmed : []),
      ...(Array.isArray(payload?.candidates) ? payload.candidates : []),
    ].map(normalizeRunner)
    const pool = dedupeRunners(raw)
    // HARD GATES: social signal + real on-chain size (no "$—" cards) + NOT
    // already on the X Dash leaderboard (this tab is strictly "off-board").
    return pool.filter((r) => hasSocial(r) && onChainConfirmed(r) && !onBoard(r))
  }, [payload, onBoard])

  const rows = useMemo(() => {
    let f = socialConfirmed
    if (micro) f = f.filter((r) => !likelyListed(r))
    if (controls.chain && controls.chain !== 'all') {
      const target = canonicalChainKey(controls.chain) || String(controls.chain).toLowerCase()
      f = f.filter((r) => tokenMatchesChain(r, target))
    }
    const get = SORT_GETTERS[sortKey] || SORT_GETTERS.buzz
    // Running plays lead; faded (Cooled) sink to the bottom so they don't
    // corrupt the live signals — then the chosen metric within each group.
    return [...f].sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1
      return get(b) - get(a)
    })
  }, [socialConfirmed, micro, sortKey, controls.chain])

  const listedCount = useMemo(() => socialConfirmed.filter(likelyListed).length, [socialConfirmed])

  // Live DexScreener overlay by contract for the visible rows — the early-runner
  // rows carry no logo and a detection-time mcap. Batch (server caps 30) → logo
  // + fresh marketCap keyed by lowercased contract.
  const [dexMap, setDexMap] = useState({})
  const contractsKey = useMemo(
    () => rows.map((r) => String(r.contract_address || '').toLowerCase()).filter(Boolean).slice(0, 60).join(','),
    [rows],
  )
  useEffect(() => {
    const addrs = contractsKey ? contractsKey.split(',') : []
    if (!addrs.length) return undefined
    let cancelled = false
    ;(async () => {
      const out = {}
      for (let i = 0; i < addrs.length; i += 30) {
        // eslint-disable-next-line no-await-in-loop
        const res = await getDexScreenerTokens(addrs.slice(i, i + 30)).catch(() => ({}))
        for (const [k, v] of Object.entries(res || {})) out[String(k).toLowerCase()] = v
      }
      if (!cancelled) setDexMap((prev) => ({ ...prev, ...out }))
    })()
    return () => { cancelled = true }
  }, [contractsKey])

  // Feed the command-bar chain dropdown with the chains present among degen
  // tokens, so the chain filter is meaningful on this tab too.
  const availableChains = useMemo(() => chainOptionsFromTokens(socialConfirmed), [socialConfirmed])
  const onChainsAvailableRef = useRef(onChainsAvailable)
  onChainsAvailableRef.current = onChainsAvailable
  const chainsKey = availableChains.map((c) => `${c.key}:${c.count}`).join(',')
  useEffect(() => {
    if (availableChains.length) onChainsAvailableRef.current?.(availableChains)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainsKey])

  if (loading && !data) return <Shimmer variant="card" count={6} />
  if (error) return <ErrorState message={error} onRetry={refetch} />

  const chainSel = controls.chain && controls.chain !== 'all'
    ? chainLabel(canonicalChainKey(controls.chain) || controls.chain) : null

  return (
    <div className="xdg-board">
      <div className="xdg-head">
        <div className="xdg-head__lead">
          <div className="xdg-head__title">
            {t('xDash.degen.title', 'Degen')}
            <span className="xdg-head__count">{rows.length}</span>
          </div>
          <div className="xdg-head__sub">
            {t('xDash.degen.sub', 'Pre-CoinGecko tokens caught from on-chain volume + X buzz — the leaderboard cannot see these yet. Every token here has a live social signal.')}
          </div>
        </div>
        <div className="xdg-head__controls">
          <div className="xdg-sorts xdg-viewtoggle">
            <button type="button" className={`xdg-sort${view === 'cards' ? ' xdg-sort--on' : ''}`} onClick={() => setView('cards')}>{t('xDash.degen.cards', 'Cards')}</button>
            <button type="button" className={`xdg-sort${view === 'list' ? ' xdg-sort--on' : ''}`} onClick={() => setView('list')}>{t('xDash.degen.list', 'List')}</button>
          </div>
          <div className="xdg-sorts">
            {SORTS.map((s) => (
              <button
                key={s.key} type="button"
                className={`xdg-sort${sortKey === s.key ? ' xdg-sort--on' : ''}`}
                onClick={() => setSortKey(s.key)}
              >{s.label}</button>
            ))}
          </div>
          {view === 'list' && <ColumnMenu hidden={hiddenCols} onToggle={toggleCol} t={t} />}
          <button
            type="button"
            className={`xdg-toggle${micro ? ' xdg-toggle--on' : ''}`}
            onClick={() => setMicro((m) => !m)}
            title="Hide tokens already on CoinGecko or ≥ $15M"
          >
            {t('xDash.degen.microOnly', 'Micro only')}
            {listedCount > 0 && <span className="xdg-toggle__count">{micro ? `+${listedCount}` : listedCount}</span>}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={chainSel
            ? t('xDash.degen.empty.chain', 'No pre-CG {{chain}} tokens with social right now', { chain: chainSel })
            : t('xDash.degen.empty.all', 'No pre-CG social runners in this window')}
          detail={t('xDash.degen.empty.detail', 'They surface here the moment on-chain volume and X buzz converge on a token the leaderboard has not indexed yet.')}
        />
      ) : view === 'list' ? (
        <DegenList
          rows={rows} fmtLargeShort={fmtLargeShort} dexMap={dexMap}
          hiddenCols={hiddenCols} sortKey={sortKey} onSort={setSortKey}
        />
      ) : (
        <div className="xdg-grid">
          {rows.map((r, i) => (
            <DegenCard
              key={r.contract_address || r.id || i}
              row={r} rank={i + 1} fmtLargeShort={fmtLargeShort}
              dex={dexMap[String(r.contract_address || '').toLowerCase()]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
