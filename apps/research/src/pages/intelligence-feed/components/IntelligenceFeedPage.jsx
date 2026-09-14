/**
 * Intel Desk — the durable half of the intelligence feed.
 *
 * The bell is the interrupt: small, newest-first, gone when you close it.
 * Telegram is the phone buzz. This is the third surface — the record you can
 * scroll, filter, search and link to, which a popover cannot be and a chat
 * scrolls away.
 *
 * It reads the SAME store the bell reads, renders the SAME SignalCard, and
 * groups by the SAME lane taxonomy the API serves — so a lane means one thing
 * on every surface. That was the whole point: Telegram had 21 tuned lanes while
 * the app had 7 flat toggles, and a lane the founder asked to be broken up in
 * Telegram was still arriving as one bucket here.
 *
 * 🪤 This page deliberately does NOT read /v1/intelligence/feed, which is what
 * used to live at this route. Measured 2026-08-18 on 100 live rows of that
 * endpoint: 22 were spam the bell already blocks, 97 had a signal type outside
 * the bell's allow-list, 3 survived all filters, and exactly 1 carried the
 * accuracy data that was supposed to be the page's headline stat. Its top card
 * was a $76K-liquidity BSC token at score 100. The curated feed is the
 * notifications one.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useNotificationStore from '@/store/useNotificationStore'
import useNotificationPoller from '@/hooks/useNotificationPoller'
import useSignalEngine from '@/hooks/useSignalEngine'
import { SignalCard } from '@/components/signal-card'
import { laneOf, fetchLaneCatalog } from '@/lib/notification-lanes'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { openSignalDestination } from '@/lib/notification-destination'
import DeskBriefCard from './DeskBriefCard'
import '@/components/notification-panel.css'
import './IntelligenceFeedPage.css'

const RANGES = [
  { key: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: 'All', ms: Infinity },
]

export default function IntelligenceFeedPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const signals = useNotificationStore((s) => s.signals)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const dismiss = useNotificationStore((s) => s.dismiss)

  // The desk is a real surface, so it drives the feed itself rather than
  // waiting for someone to open the bell.
  useNotificationPoller(undefined, { enabled: true })
  useSignalEngine({ enabled: true })

  const [catalog, setCatalog] = useState([])
  const [activeLane, setActiveLane] = useState('all')
  const [range, setRange] = useState('24h')
  const [query, setQuery] = useState('')

  // Catalog comes from the API when it ships; the local mirror bridges until then.
  useEffect(() => {
    let cancelled = false
    fetchLaneCatalog().then((rows) => { if (!cancelled) setCatalog(rows) })
    return () => { cancelled = true }
  }, [])

  const laned = useMemo(
    () => signals.map((s) => ({ ...s, _lane: s.lane || laneOf(s) })),
    [signals]
  )

  // Counts drive the rail, and a lane with nothing in it is not offered —
  // an empty filter chip is a promise the data cannot keep.
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
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [laned, activeLane, range, query])

  const unread = useMemo(() => laned.filter((s) => !s.read).length, [laned])

  const openToken = (symbol) => {
    const loc = buildResearchZoneLocation({ symbol })
    navigate(`${loc.pathname}${loc.search || ''}`)
  }
  // Same opener the bell panel uses — an on-chain micro-cap goes to the AI
  // Screener by contract, a listed token to Research Zone pinned to its cgId.
  const openDest = (dest) => openSignalDestination(dest, { navigate })

  const lanesWithRows = catalog.filter((l) => counts[l.key])

  return (
    <div className="idesk">
      <header className="idesk-head">
        <div className="idesk-head-left">
          <h1 className="idesk-title">{t('intelDesk.title', 'Intel Desk')}</h1>
          <p className="idesk-sub">
            {t('intelDesk.sub', 'Every signal the desk has raised — the same feed as the bell, kept.')}
          </p>
        </div>
        <div className="idesk-head-right">
          <div className="idesk-stat">
            <span className="idesk-stat-value">{laned.length}</span>
            <span className="idesk-stat-label">{t('intelDesk.held', 'held')}</span>
          </div>
          <div className="idesk-stat">
            <span className="idesk-stat-value idesk-stat-value--unread">{unread}</span>
            <span className="idesk-stat-label">{t('intelDesk.unread', 'unread')}</span>
          </div>
          {unread > 0 && (
            <button type="button" className="idesk-action" onClick={markAllRead}>
              {t('notifications.markAllRead', 'Mark all read')}
            </button>
          )}
        </div>
      </header>

      <DeskBriefCard />

      <div className="idesk-controls">
        <input
          className="idesk-search ui-bare-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('intelDesk.search', 'Search signals, assets, headlines…')}
          aria-label={t('intelDesk.search', 'Search signals')}
        />
        <div className="idesk-ranges">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`idesk-range${range === r.key ? ' is-active' : ''}`}
              onClick={() => setRange(r.key)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <nav className="idesk-lanes" aria-label={t('intelDesk.lanes', 'Lanes')}>
        <button
          type="button"
          className={`idesk-lane${activeLane === 'all' ? ' is-active' : ''}`}
          onClick={() => setActiveLane('all')}
        >
          {t('intelDesk.allLanes', 'All')}
          <span className="idesk-lane-count">{laned.length}</span>
        </button>
        {lanesWithRows.map((l) => (
          <button
            key={l.key}
            type="button"
            className={`idesk-lane${activeLane === l.key ? ' is-active' : ''}`}
            onClick={() => setActiveLane(l.key)}
            title={l.hint}
          >
            {l.label}
            <span className="idesk-lane-count">{counts[l.key]}</span>
          </button>
        ))}
      </nav>

      <div className="idesk-feed">
        {filtered.length === 0 ? (
          <div className="idesk-empty">
            <p className="idesk-empty-title">
              {query || activeLane !== 'all'
                ? t('intelDesk.noMatch', 'Nothing matches that yet.')
                : t('notifications.allQuiet', 'All quiet')}
            </p>
            <p className="idesk-empty-text">
              {query || activeLane !== 'all'
                ? t('intelDesk.noMatchHint', 'Try a wider window, or clear the filter.')
                : t('intelDesk.quietHint', 'Signals land here as the desk raises them.')}
            </p>
          </div>
        ) : (
          filtered.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              onRead={markRead}
              onDismiss={dismiss}
              onToken={openToken}
              onOpen={openDest}
            />
          ))
        )}
      </div>
    </div>
  )
}
