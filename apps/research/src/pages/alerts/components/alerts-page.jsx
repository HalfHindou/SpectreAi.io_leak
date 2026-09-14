/**
 * Alerts Page — Full-screen intelligence alert feed.
 *
 * Real-time breaking news, whale moves, signal convergence, and
 * high-conviction signals from the Spectre intelligence engine.
 *
 * Think Bloomberg Terminal meets Apple News for crypto.
 * Every alert is actionable. Every number is real.
 */
import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { useTimeAgo } from '@/lib/timeAgo'
import { isAppActive } from '@/lib/idleManager'
import './alerts-page.css'

const FEED_URL = '/data-api/v1/notifications/feed'
const POLL_INTERVAL = 30_000

// localStorage instant-paint seed. The feed window is small (50 rows) and
// the same set is client-filterable, so we cache the whole window and repaint
// instantly on cold load, then refresh in the background.
const LS_KEY = 'spectre-alerts-feed-v1'
const LS_TTL = 10 * 60 * 1000 // 10 min

// Severity ranking for client-side `min_severity` filtering (highest first).
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 }

// The 30s poll returns a fresh array of new objects even when the feed is
// unchanged. Skip the setState (and the full re-render it triggers) when the
// id list matches. Returns false when any id is missing, so we always replace
// rather than risk a stale skip.
function alertsSame(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return false
  for (let i = 0; i < a.length; i++) {
    if (!a[i]?.id || !b[i]?.id || a[i].id !== b[i].id) return false
  }
  return true
}

function readSeed() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.data)) return null
    if (Date.now() - (parsed.ts || 0) > LS_TTL) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeSeed(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // quota / unavailable - ignore
  }
}

const CATEGORIES = [
  { id: 'all', labelKey: 'all', labelFallback: 'All Alerts' },
  { id: 'breaking_news', labelKey: 'breaking', labelFallback: 'Breaking' },
  { id: 'signal_alert', labelKey: 'signals', labelFallback: 'Signals' },
  { id: 'whale_move', labelKey: 'whales', labelFallback: 'Whales' },
  { id: 'convergence', labelKey: 'convergence', labelFallback: 'Convergence' },
]

const SEVERITY_LEVELS = [
  { id: 'all', labelKey: 'all', labelFallback: 'All' },
  { id: 'critical', labelKey: 'critical', labelFallback: 'Critical' },
  { id: 'high', labelKey: 'high', labelFallback: 'High' },
  { id: 'medium', labelKey: 'medium', labelFallback: 'Medium' },
]

const SEVERITY_COLORS = {
  critical: '#EF4444',
  high: '#F59E0B',
  medium: '#3B82F6',
  low: 'rgba(245, 245, 247, 0.4)',
}

const TYPE_CONFIG = {
  breaking_news: {
    labelKey: 'breaking',
    labelFallback: 'BREAKING',
    color: '#EF4444',
    icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  },
  signal_alert: {
    labelKey: 'signal',
    labelFallback: 'SIGNAL',
    color: '#10B981',
    icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  },
  whale_move: {
    labelKey: 'whale',
    labelFallback: 'WHALE',
    color: '#A78BFA',
    icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  convergence: {
    labelKey: 'convergence',
    labelFallback: 'CONVERGENCE',
    color: '#06B6D4',
    icon: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3',
  },
}

function cleanText(text) {
  if (!text) return ''
  return text.replace(/\s*--\s*/g, '. ').replace(/\s*—\s*/g, '. ').replace(/\.\s*\./g, '.').trim()
}

function SeverityDot({ severity }) {
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium
  return <span className="al-severity-dot" style={{ background: color }} />
}

const AlertCard = memo(function AlertCard({ alert }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtAgo = useTimeAgo()
  const config = TYPE_CONFIG[alert.type] || TYPE_CONFIG.signal_alert
  const severity = alert.severity || 'medium'

  return (
    <article className="al-card">
      <div className="al-card-left">
        <div className="al-card-icon" style={{ color: config.color, background: `${config.color}12` }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={config.icon} />
          </svg>
        </div>
      </div>

      <div className="al-card-body">
        <div className="al-card-top">
          <div className="al-card-tags">
            <span className="al-type-tag" style={{ color: config.color, borderColor: `${config.color}30` }}>
              {t(`alertsPage.type.${config.labelKey}`, config.labelFallback)}
            </span>
            {alert.asset && (
              <span className="al-asset-tag">{alert.asset}</span>
            )}
            <SeverityDot severity={severity} />
          </div>
          <time className="al-card-time">{fmtAgo(alert.createdAt)}</time>
        </div>

        <h3 className="al-card-title">{cleanText(alert.title)}</h3>

        {alert.body && (
          <p className="al-card-desc">{cleanText(alert.body)}</p>
        )}

        {(alert.score || alert.signalCount || alert.valueUsd) && (
          <div className="al-card-metrics">
            {alert.score && (
              <span className="al-metric">
                <span className="al-metric-label">{t('alertsPage.metrics.score', 'Score')}</span>
                <span className="al-metric-value mono">{alert.score}</span>
              </span>
            )}
            {alert.signalCount && (
              <span className="al-metric">
                <span className="al-metric-label">{t('alertsPage.metrics.signals', 'Signals')}</span>
                <span className="al-metric-value mono">{alert.signalCount}</span>
              </span>
            )}
            {alert.valueUsd && (
              <span className="al-metric">
                <span className="al-metric-label">{t('alertsPage.metrics.value', 'Value')}</span>
                <span className="al-metric-value mono">{fmtLargeShort(alert.valueUsd)}</span>
              </span>
            )}
            {alert.direction && (
              <span className={`al-direction al-direction--${alert.direction}`}>
                {t(`alertsPage.direction.${alert.direction}`, alert.direction)}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  )
})

function ShimmerCard() {
  return (
    <div className="al-card al-card--shimmer">
      <div className="al-card-left">
        <div className="al-shimmer al-shimmer-icon" />
      </div>
      <div className="al-card-body">
        <div className="al-shimmer al-shimmer-tag" />
        <div className="al-shimmer al-shimmer-title" />
        <div className="al-shimmer al-shimmer-desc" />
      </div>
    </div>
  )
}

export default function AlertsPage({ dayMode }) {
  const { t } = useTranslation()
  const fmtAgo = useTimeAgo()
  // Seed from localStorage for instant paint; refresh in the background.
  const [alerts, setAlerts] = useState(() => readSeed() || [])
  const [loading, setLoading] = useState(() => !readSeed())
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [isLive, setIsLive] = useState(true)
  const pollRef = useRef(null)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // Fetch the full feed window ONCE (no server-side category/severity filters) -
  // the 50-row set is fully client-filterable, so pill clicks never hit the
  // network. category/severity are intentionally NOT deps here.
  const fetchAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50' })
      const res = await fetch(`${FEED_URL}?${params}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return
      const json = await res.json()
      if (json.data && mountedRef.current) {
        setAlerts(prev => alertsSame(prev, json.data) ? prev : json.data)
        setLastUpdate(new Date())
        writeSeed(json.data)
      }
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  useEffect(() => {
    if (!isLive) return
    pollRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      fetchAlerts()
    }, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [isLive, fetchAlerts])

  const filtered = useMemo(() => {
    let list = alerts
    if (category !== 'all') {
      list = list.filter(a => a.type === category)
    }
    if (severity !== 'all') {
      const min = SEVERITY_RANK[severity] || 0
      // Default unknown/missing severity to 'medium' to MATCH AlertCard's dot
      // (line ~114). Otherwise an alert shown as "medium" in All ranks 0 and
      // silently vanishes the moment any severity pill is selected.
      list = list.filter(a => (SEVERITY_RANK[a.severity || 'medium'] || 0) >= min)
    }
    // Deduplicate by title
    const seen = new Set()
    return list.filter(a => {
      if (seen.has(a.title)) return false
      seen.add(a.title)
      return true
    })
  }, [alerts, category, severity])

  const stats = useMemo(() => ({
    total: filtered.length,
    critical: filtered.filter(a => a.severity === 'critical').length,
    breaking: alerts.filter(a => a.type === 'breaking_news').length,
    signals: alerts.filter(a => a.type === 'signal_alert').length,
    whales: alerts.filter(a => a.type === 'whale_move').length,
    convergence: alerts.filter(a => a.type === 'convergence').length,
  }), [filtered, alerts])

  return (
    <div className={`al-page${dayMode ? ' al-page--day' : ''}`}>
      {/* Hero */}
      <header className="al-hero">
        <div className="al-hero-top">
          <div>
            <div className="al-hero-eyebrow">{t('alertsPage.eyebrow', 'SPECTRE INTELLIGENCE')}</div>
            <h1 className="al-hero-title">{t('alertsPage.title', 'Alert Center')}</h1>
            <p className="al-hero-sub">
              {t('alertsPage.subtitle', 'Real-time market intelligence from 100+ data workers. Breaking news, whale movements, signal convergence, and high-conviction trades.')}
            </p>
          </div>
          <div className="al-hero-stats">
            <div className="al-hero-stat">
              <span className="al-hero-stat-val mono">{stats.total}</span>
              <span className="al-hero-stat-label">{t('alertsPage.stats.alerts', 'Alerts')}</span>
            </div>
            <div className="al-hero-stat">
              <span className="al-hero-stat-val mono" style={{ color: '#EF4444' }}>{stats.critical}</span>
              <span className="al-hero-stat-label">{t('alertsPage.severity.critical', 'Critical')}</span>
            </div>
            <div className="al-hero-stat">
              <span className="al-hero-stat-val mono" style={{ color: '#A78BFA' }}>{stats.whales}</span>
              <span className="al-hero-stat-label">{t('alertsPage.categories.whales', 'Whales')}</span>
            </div>
            <div className="al-hero-stat">
              <span className="al-hero-stat-val mono" style={{ color: '#06B6D4' }}>{stats.convergence}</span>
              <span className="al-hero-stat-label">{t('alertsPage.categories.convergence', 'Convergence')}</span>
            </div>
          </div>
        </div>

        {/* Live indicator + last update */}
        <div className="al-live-bar">
          <button
            className={`al-live-btn${isLive ? ' is-live' : ''}`}
            onClick={() => setIsLive(l => !l)}
          >
            <span className="al-live-dot" />
            {isLive ? t('alertsPage.live', 'LIVE') : t('alertsPage.paused', 'PAUSED')}
          </button>
          {lastUpdate && (
            <span className="al-last-update">
              {t('alertsPage.updated', 'Updated {{time}}', { time: fmtAgo(lastUpdate) })}
            </span>
          )}
          <button className="al-refresh-btn" onClick={fetchAlerts}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2" />
            </svg>
          </button>
        </div>
      </header>

      {/* Filters */}
      <nav className="al-filters">
        <div className="al-filter-group">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`al-filter-pill${category === cat.id ? ' is-active' : ''}`}
              onClick={() => setCategory(cat.id)}
            >
              {t(`alertsPage.categories.${cat.labelKey}`, cat.labelFallback)}
              {cat.id !== 'all' && (
                <span className="al-filter-count mono">
                  {cat.id === 'breaking_news' ? stats.breaking
                    : cat.id === 'signal_alert' ? stats.signals
                    : cat.id === 'whale_move' ? stats.whales
                    : cat.id === 'convergence' ? stats.convergence : ''}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="al-filter-group">
          {SEVERITY_LEVELS.map(sev => (
            <button
              key={sev.id}
              className={`al-filter-pill al-filter-pill--severity${severity === sev.id ? ' is-active' : ''}`}
              onClick={() => setSeverity(sev.id)}
              style={sev.id !== 'all' ? { '--sev-color': SEVERITY_COLORS[sev.id] } : {}}
            >
              {sev.id !== 'all' && <SeverityDot severity={sev.id} />}
              {t(`alertsPage.severity.${sev.labelKey}`, sev.labelFallback)}
            </button>
          ))}
        </div>
      </nav>

      {/* Feed */}
      <div className="al-feed">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <ShimmerCard key={i} />)
        ) : filtered.length === 0 ? (
          <div className="al-onboarding">
            <div className="al-onboarding-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </div>
            <h2 className="al-onboarding-title">{t('alertsPage.onboarding.title', 'Alert Center is live')}</h2>
            <p className="al-onboarding-text">
              {t('alertsPage.onboarding.text', 'Your intelligence engine is running 100+ workers across 5 exchanges, 10 news monitors, on-chain scanners, and social feeds. Alerts will appear here as they fire.')}
            </p>
            <div className="al-onboarding-timeline">
              <div className="al-timeline-item">
                <span className="al-timeline-dot al-timeline-dot--active" />
                <div className="al-timeline-content">
                  <span className="al-timeline-date">{t('alertsPage.onboarding.now', 'Now')}</span>
                  <span className="al-timeline-label">{t('alertsPage.onboarding.nowDesc', 'Intelligence engine active. Monitoring 18,000+ assets.')}</span>
                </div>
              </div>
              <div className="al-timeline-item">
                <span className="al-timeline-dot" />
                <div className="al-timeline-content">
                  <span className="al-timeline-date">{t('alertsPage.onboarding.nextHours', 'Next few hours')}</span>
                  <span className="al-timeline-label">{t('alertsPage.onboarding.nextHoursDesc', 'Breaking news, whale moves, and signal alerts will accumulate here.')}</span>
                </div>
              </div>
              <div className="al-timeline-item">
                <span className="al-timeline-dot" />
                <div className="al-timeline-content">
                  <span className="al-timeline-date">{t('alertsPage.onboarding.day1', '24 hours')}</span>
                  <span className="al-timeline-label">{t('alertsPage.onboarding.day1Desc', 'Signal accuracy data builds up. Hit rates and PnL tracking start appearing.')}</span>
                </div>
              </div>
              <div className="al-timeline-item">
                <span className="al-timeline-dot" />
                <div className="al-timeline-content">
                  <span className="al-timeline-date">{t('alertsPage.onboarding.week1', '7 days')}</span>
                  <span className="al-timeline-label">{t('alertsPage.onboarding.week1Desc', 'Full backtested intelligence. Every signal shows its historical accuracy.')}</span>
                </div>
              </div>
            </div>
            <div className="al-onboarding-cta">
              <span className="al-live-indicator"><span className="al-live-dot" /> {t('alertsPage.listening', 'Listening')}</span>
              <span className="al-onboarding-hint">{t('alertsPage.onboarding.refreshHint', 'This page auto-refreshes every 30 seconds')}</span>
            </div>
          </div>
        ) : (
          filtered.map(alert => (
            <AlertCard key={alert.id} alert={alert} />
          ))
        )}
      </div>
    </div>
  )
}
