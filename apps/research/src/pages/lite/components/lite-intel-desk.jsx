/**
 * LITE Intel Desk — the desk's own signals, in Lite chrome.
 *
 * Two exports, one data source:
 *   LiteIntelDeskCard — the Today panel. What the desk has raised recently,
 *     four rows and a count, sized like the News panel it sits under.
 *   LiteIntelDeskView — the subpage. The full desk brief on top (the same note
 *     Telegram pushes every morning), then the whole feed with a window filter
 *     and lane rail.
 *
 * Deliberately NOT a second copy of the feed: it reads the same
 * useNotificationStore that the bell and PRO's /insights read, so a signal
 * marked read here is read everywhere. `useNotificationPoller` /
 * `useSignalEngine` only run on the subpage — the Today card is a passenger on
 * whatever the shell already polls, so adding it to the landing costs no
 * requests.
 *
 * Structural styles only (.lid-); colour comes from the shared Lite shells so
 * paper / glass / daylight all restyle it for free.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useNotificationStore from '@/store/useNotificationStore'
import useNotificationPoller from '@/hooks/useNotificationPoller'
import useSignalEngine from '@/hooks/useSignalEngine'
import { laneOf, fetchLaneCatalog } from '@/lib/notification-lanes'
import { openSignalDestination } from '@/lib/notification-destination'
import DeskBriefCard from '@/pages/intelligence-feed/components/DeskBriefCard'
import './lite-intel-desk.css'

const RANGES = [
  { key: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: 'All', ms: Infinity },
]

function ago(ts) {
  if (!ts) return ''
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Signals with their lane resolved once, newest first. */
function useLanedSignals() {
  const signals = useNotificationStore((s) => s.signals)
  return useMemo(
    () => signals
      .map((s) => ({ ...s, _lane: s.lane || laneOf(s) }))
      .sort((a, b) => b.timestamp - a.timestamp),
    [signals],
  )
}

/** Strip punctuation/case so "Title…" and "Title." compare equal. */
const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function SignalRow({ signal, onOpen, onRead }) {
  const { t } = useTranslation()
  const raw = signal.detail || signal.body || ''
  // Several lanes ship detail == title (news-derived signals especially), which
  // renders as the same sentence twice in a row and makes the card look padded.
  // Drop the detail when it adds nothing rather than printing it again.
  const a = norm(signal.title)
  const b = norm(raw)
  const body = !b || b === a || b.startsWith(a) || a.startsWith(b) ? '' : raw
  return (
    <li>
      <button
        type="button"
        className={`lid-row${signal.read ? '' : ' lid-row--unread'}`}
        onClick={() => { onRead?.(signal.id); onOpen?.(signal) }}
      >
        <span className="lid-row-body">
          <span className="lid-row-title">{signal.title}</span>
          {body && <span className="lid-row-detail">{body}</span>}
          <span className="lid-row-meta">
            {[signal.meta?.asset, ago(signal.timestamp)].filter(Boolean).join(' · ')}
          </span>
        </span>
        {!signal.read && <span className="lid-row-dot" aria-label={t('lite.signalrow.ariaUnread', "unread")} />}
      </button>
    </li>
  )
}

/* ── Today panel ───────────────────────────────────────────────────────── */

// `BlockHead` arrives as a prop rather than an import: lite-page.jsx imports
// THIS file, so importing its head back would close a cycle.
export function LiteIntelDeskCard({ onNav, BlockHead }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const laned = useLanedSignals()
  const markRead = useNotificationStore((s) => s.markRead)
  const rows = laned.slice(0, 4)
  const unread = laned.filter((s) => !s.read).length

  const open = (signal) => openSignalDestination(signal.destination || signal, { navigate })

  return (
    <section className="lite-panel lite-span-4 lid-card">
      <BlockHead label={t('lite.liteinteldesk.label', "Intel Desk")} viewId="inteldesk" onNav={onNav} />
      {rows.length === 0 ? (
        <p className="lid-quiet">
          {t('intelDesk.quietHint', 'Signals land here as the desk raises them.')}
        </p>
      ) : (
        <>
          {unread > 0 && (
            <p className="lid-card-count">
              {t('intelDesk.unreadCount', { defaultValue: '{{n}} unread', n: unread })}
            </p>
          )}
          <ul className="lid-list">
            {rows.map((s) => (
              <SignalRow key={s.id} signal={s} onOpen={open} onRead={markRead} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/* ── Today panel: the desk brief itself ──────────────────────────────────── */

// Separate from LiteIntelDeskCard on purpose. That card is the SIGNAL feed —
// what the desk flagged. This is the desk's written READ, the note Telegram
// pushes each morning, with its own Today / This week / Big picture tabs.
// Founder 2026-08-28: "u added intel desk but not brief mode." Both belong on
// the landing; they answer different questions.
export function LiteDeskBriefCard({ onNav, BlockHead }) {
  const { t } = useTranslation()
  return (
    <section className="lite-panel lite-span-8 lid-briefcard">
      <BlockHead label={t('lite.litedeskbrief.label', "Desk brief")} viewId="inteldesk" onNav={onNav} />
      {/* Hides itself when the engine has produced nothing, so the section
          collapses rather than promising a note that does not exist. */}
      <DeskBriefCard />
    </section>
  )
}

/* ── Subpage ───────────────────────────────────────────────────────────── */

// Lane ink - a small dot per lane so a row's lane reads at a glance. Colour on
// DATA only (the lane is a classification), never on chrome.
const LANE_INK = {
  breaking: '#EF4444', headline: '#A1A1AA', policy: '#2DD4BF', systemic: '#F97316',
  energy: '#F59E0B', trade: '#EAB308', listings: '#22C55E', runners: '#F472B6',
  brain: '#F5F5F7', social: '#38BDF8', risk: '#DC2626', stocks: '#34D399',
  data: '#A3E635', pulse: '#F5F5F7',
}
const laneInk = (key) => LANE_INK[key] || '#A1A1AA'

const norm2 = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
function detailOf(signal) {
  const raw = signal.detail || signal.body || ''
  const a = norm2(signal.title)
  const b = norm2(raw)
  return !b || b === a || b.startsWith(a) || a.startsWith(b) ? '' : raw
}

function dayBucket(ts, now) {
  const d = new Date(ts)
  const n = new Date(now)
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  if (sameDay) return 'today'
  const y = new Date(n); y.setDate(n.getDate() - 1)
  const yesterday = d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()
  return yesterday ? 'yesterday' : 'earlier'
}

function FeedRow({ signal, laneLabel, onOpen, onRead, imgBySym }) {
  const body = detailOf(signal)
  const asset = signal.meta?.asset ? String(signal.meta.asset).toUpperCase() : null
  const logo = asset ? imgBySym?.[asset] : null
  const sev = signal.priority === 1 ? (signal.meta?.severity === 'critical' ? 'critical' : 'high') : null
  const dir = signal.meta?.direction
  return (
    <li>
      <button
        type="button"
        className={`lid-frow${signal.read ? '' : ' lid-frow--unread'}`}
        onClick={() => { onRead?.(signal.id); onOpen?.(signal) }}
      >
        <span className="lid-frow-mark" aria-hidden />
        <span className="lid-frow-body">
          <span className="lid-frow-top">
            <i className="lid-lane-tag" style={{ '--ln': laneInk(signal._lane) }}>{laneLabel}</i>
            {asset && (
              <span className="lid-asset">
                {logo ? <img src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
                {asset}
              </span>
            )}
            {sev && <i className={`lid-sev lid-sev--${sev}`}>{sev === 'critical' ? 'Critical' : 'High'}</i>}
            {(dir === 'up' || dir === 'bullish' || dir === 'long') && <i className="lid-dir up">▲</i>}
            {(dir === 'down' || dir === 'bearish' || dir === 'short') && <i className="lid-dir down">▼</i>}
          </span>
          <span className="lid-frow-title">{signal.title}</span>
          {body && <span className="lid-frow-detail">{body}</span>}
          <span className="lid-frow-meta">{ago(signal.timestamp)}</span>
        </span>
      </button>
    </li>
  )
}

export default function LiteIntelDeskView({ imgBySym }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // The subpage is a real surface, so it drives the feed rather than waiting
  // for someone to open the bell. The Today card does NOT — see the header.
  useNotificationPoller(undefined, { enabled: true })
  useSignalEngine({ enabled: true })

  const laned = useLanedSignals()
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)

  const [catalog, setCatalog] = useState([])
  const [activeLane, setActiveLane] = useState('all')
  const [range, setRange] = useState('24h')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchLaneCatalog().then((rows) => { if (!cancelled) setCatalog(rows) })
    return () => { cancelled = true }
  }, [])

  const laneLabel = useMemo(() => {
    const m = {}
    for (const l of catalog) m[l.key] = l.label
    return (key) => m[key] || key
  }, [catalog])

  const counts = useMemo(() => {
    const c = {}
    for (const s of laned) c[s._lane] = (c[s._lane] || 0) + 1
    return c
  }, [laned])

  const filtered = useMemo(() => {
    const cutoff = RANGES.find((r) => r.key === range)?.ms ?? Infinity
    const since = cutoff === Infinity ? 0 : Date.now() - cutoff
    const q = query.trim().toLowerCase()
    return laned
      .filter((s) => s.timestamp >= since)
      .filter((s) => activeLane === 'all' || s._lane === activeLane)
      .filter((s) => !q || `${s.title || ''} ${s.detail || ''} ${s.body || ''} ${s.meta?.asset || ''}`.toLowerCase().includes(q))
  }, [laned, activeLane, range, query])

  // Day headers only when the window can actually span days.
  const groups = useMemo(() => {
    if (range === '24h') return [{ key: 'all', label: null, rows: filtered }]
    const now = Date.now()
    const b = { today: [], yesterday: [], earlier: [] }
    for (const s of filtered) b[dayBucket(s.timestamp, now)].push(s)
    return [
      { key: 'today', label: t('intelDesk.today', 'Today'), rows: b.today },
      { key: 'yesterday', label: t('intelDesk.yesterday', 'Yesterday'), rows: b.yesterday },
      { key: 'earlier', label: t('intelDesk.earlier', 'Earlier'), rows: b.earlier },
    ].filter((g) => g.rows.length > 0)
  }, [filtered, range, t])

  // The rail reads the whole held feed - it is the desk's shape, not the filter's.
  const pulse = useMemo(() => {
    const lanes = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const max = lanes[0]?.[1] || 1
    const assetCount = new Map()
    for (const s of laned) {
      const a = s.meta?.asset ? String(s.meta.asset).toUpperCase() : null
      if (a) assetCount.set(a, (assetCount.get(a) || 0) + 1)
    }
    const assets = [...assetCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const hot = laned.filter((s) => s.priority === 1 && s.timestamp >= dayAgo).slice(0, 3)
    return { lanes, max, assets, hot }
  }, [laned, counts])

  const unread = laned.filter((s) => !s.read).length
  const latestTs = laned[0]?.timestamp
  // A lane chip with nothing behind it is a promise the data cannot keep.
  const lanesWithRows = catalog.filter((l) => counts[l.key])
  const open = (signal) => openSignalDestination(signal.destination || signal, { navigate })
  const filtering = query || activeLane !== 'all' || range !== 'all'

  return (
    <div className="lite-view lite-lid">
      <header className="lite-view-head lid-head lite-rise">
        <div className="lid-head-text">
          <h1 className="lite-view-title">{t('intelDesk.title', 'Intel Desk')}</h1>
          <p className="lite-view-sub">
            {t('intelDesk.sub', 'Every signal the desk has raised — the same feed as the bell, kept.')}
          </p>
        </div>
        <div className="lid-head-stats">
          <span className="lid-stat"><b>{laned.length}</b><span>{t('intelDesk.signals', 'signals')}</span></span>
          <span className={`lid-stat${unread > 0 ? ' lid-stat--live' : ''}`}><b>{unread}</b><span>{t('intelDesk.unread', 'unread')}</span></span>
          {latestTs && <span className="lid-stat"><b>{ago(latestTs)}</b><span>{t('intelDesk.latest', 'latest')}</span></span>}
          {unread > 0 && (
            <button type="button" className="lite-chip lid-markall" onClick={markAllRead}>
              {t('notifications.markAllRead', 'Mark all read')}
            </button>
          )}
        </div>
      </header>

      <div className="lid-top lite-rise-1">
        {/* The morning note the desk writes and Telegram pushes. Hides itself
            when the engine has produced nothing. */}
        <div className="lid-brief">
          <DeskBriefCard />
        </div>

        <aside className="lid-rail">
          <section className="lite-panel lid-rail-panel">
            <p className="lite-eyebrow">{t('intelDesk.pulse', 'Desk pulse')}</p>
            {pulse.lanes.length === 0 ? (
              <p className="lid-quiet">{t('intelDesk.quietHint', 'Signals land here as the desk raises them.')}</p>
            ) : (
              <ul className="lid-pulse">
                {pulse.lanes.map(([key, n]) => (
                  <li key={key}>
                    <button type="button" className={`lid-pulse-row${activeLane === key ? ' active' : ''}`} onClick={() => setActiveLane(activeLane === key ? 'all' : key)}>
                      <span className="lid-pulse-name"><b style={{ background: laneInk(key) }} />{laneLabel(key)}</span>
                      <span className="lid-pulse-bar"><i style={{ width: `${Math.round((n / pulse.max) * 100)}%`, background: laneInk(key) }} /></span>
                      <em>{n}</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {pulse.assets.length > 0 && (
            <section className="lite-panel lid-rail-panel">
              <p className="lite-eyebrow">{t('intelDesk.flagged', 'Most flagged')}</p>
              <ul className="lid-flagged">
                {pulse.assets.map(([sym, n]) => (
                  <li key={sym}>
                    <button type="button" className="lid-flagged-row" onClick={() => setQuery(query.toUpperCase() === sym ? '' : sym)}>
                      <span className="lid-asset lid-asset--lg">
                        {imgBySym?.[sym] ? <img src={imgBySym[sym]} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <b>{sym[0]}</b>}
                        {sym}
                      </span>
                      <em>{n} {t(n === 1 ? 'intelDesk.signalOne' : 'intelDesk.signalMany', n === 1 ? 'signal' : 'signals')}</em>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="lite-panel lid-rail-panel">
            <p className="lite-eyebrow">{t('intelDesk.hot', 'Highest severity')} <span className="lid-eyebrow-note">24h</span></p>
            {pulse.hot.length === 0 ? (
              <p className="lid-quiet">{t('intelDesk.hotQuiet', 'Nothing critical in the last day.')}</p>
            ) : (
              <ul className="lid-hot">
                {pulse.hot.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="lid-hot-row" onClick={() => { markRead(s.id); open(s) }}>
                      <strong>{s.title}</strong>
                      <span><b style={{ background: laneInk(s._lane) }} />{laneLabel(s._lane)} · {ago(s.timestamp)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <div className="lid-controls lite-rise-1">
        {lanesWithRows.length > 0 && (
          <nav className="lid-lanes" aria-label={t('intelDesk.lanes', 'Lanes')}>
            <button type="button" className={`lid-lane${activeLane === 'all' ? ' active' : ''}`} onClick={() => setActiveLane('all')}>
              {t('intelDesk.allLanes', 'All')} <span className="lid-lane-n">{laned.length}</span>
            </button>
            {lanesWithRows.map((l) => (
              <button key={l.key} type="button" className={`lid-lane${activeLane === l.key ? ' active' : ''}`} onClick={() => setActiveLane(l.key)} title={l.hint}>
                <b className="lid-lane-dot" style={{ background: laneInk(l.key) }} />{l.label} <span className="lid-lane-n">{counts[l.key]}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="lid-controls-right">
          <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('intelDesk.window', 'Window')}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" role="tab" aria-selected={range === r.key} className={`lite-tf-btn${range === r.key ? ' active' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>
            ))}
          </div>
          <input
            className="lid-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('intelDesk.search', 'Search signals, assets, headlines…')}
            aria-label={t('intelDesk.search', 'Search signals')}
          />
        </div>
      </div>

      <section className="lite-panel lid-feed lite-rise-2">
        {filtered.length === 0 ? (
          <div className="lid-empty">
            <p className="lid-empty-title">
              {filtering ? t('intelDesk.noMatch', 'Nothing matches that yet.') : t('notifications.allQuiet', 'All quiet')}
            </p>
            <p className="lid-empty-text">
              {filtering ? t('intelDesk.noMatchHint', 'Try a wider window, or clear the filter.') : t('intelDesk.quietHint', 'Signals land here as the desk raises them.')}
            </p>
          </div>
        ) : groups.map((g) => (
          <div key={g.key} className="lid-group">
            {g.label && <p className="lid-group-label">{g.label} <span>{g.rows.length}</span></p>}
            <ul className="lid-list lid-list--feed">
              {g.rows.map((s) => (
                <FeedRow key={s.id} signal={s} laneLabel={laneLabel(s._lane)} onOpen={open} onRead={markRead} imgBySym={imgBySym} />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
