/**
 * Notification Panel — Intelligence Feed
 * Slide-out panel from header showing aggregated market signals.
 * Matches SettingsPanel positioning and glass style.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useNotificationStore from '@/store/useNotificationStore'
import useSettingsStore from '@/store/useSettingsStore'
import useSignalEngine from '@/hooks/useSignalEngine'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { openSignalDestination } from '@/lib/notification-destination'
import { SignalCard } from './signal-card'
import './notification-panel.css'

const PREF_TOGGLES = [
  { key: 'breakout', label: 'Breakout Radar', icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941' },
  { key: 'fragility', label: 'Black-Swan Fragility', icon: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z' },
  { key: 'breakingNews', label: 'Breaking News', icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z' },
  { key: 'signals', label: 'Other Signals', icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22' },
  { key: 'whales', label: 'Whale Moves', icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'convergence', label: 'Convergence', icon: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5' },
  { key: 'toastsEnabled', label: 'Popup Toasts', icon: 'M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z' },
]

export default function NotificationPanel({ open, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const signals = useNotificationStore((s) => s.signals)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const dismiss = useNotificationStore((s) => s.dismiss)
  const clearAll = useNotificationStore((s) => s.clearAll)
  const notifPrefs = useSettingsStore((s) => s.notificationPrefs)
  const setNotifPrefs = useSettingsStore((s) => s.setNotificationPrefs)
  const [showSettings, setShowSettings] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const unreadCount = useMemo(() => signals.filter((s) => !s.read).length, [signals])
  // Newest first, full stop. Category is expressed by the glyph + tint, not by
  // position in the list.
  const sortedSignals = useMemo(
    () => [...signals].sort((a, b) => b.timestamp - a.timestamp),
    [signals])

  // A card's own destination — an on-chain micro-cap goes to the AI Screener
  // BY CONTRACT, a listed token to Research Zone pinned to its cgId, and only
  // a bare major falls back to a symbol lookup. One opener, shared with the
  // Intel Desk page, so the bell and the page can never drift apart.
  // An external story opens in a new tab and leaves the feed where it was,
  // because the reader is not done with the feed.
  const navigateRef = useRef(navigate)
  const onCloseRef = useRef(onClose)
  navigateRef.current = navigate
  onCloseRef.current = onClose
  const handleOpen = useCallback((dest) => {
    openSignalDestination(dest, { navigate: navigateRef.current, onClose: onCloseRef.current })
  }, [])

  // Loose ticker chips (a cashtag lifted from the prose) carry no identity of
  // their own, so they still resolve by symbol.
  const handleToken = useCallback((symbol) => {
    const loc = buildResearchZoneLocation({ symbol })
    onClose?.()
    navigate(`${loc.pathname}${loc.search || ''}`)
  }, [navigate, onClose])

  // Signals engine only polls while the panel is open. Closed panel = no
  // fear-greed / news / movers fetches across the app.
  useSignalEngine({ enabled: open })

  // Always reopen as the compact popout — never remember a prior full-screen state.
  useEffect(() => { if (!open) setFullscreen(false) }, [open])

  if (!open) return null

  return createPortal(
    <>
      <div className={`np-backdrop${fullscreen ? ' is-fullscreen' : ''}`} onClick={onClose} />
      <div className={`np-panel${fullscreen ? ' is-fullscreen' : ''}`} role="dialog" aria-label={t('header.notifications', 'Notifications')}>
        {/* Header */}
        <div className="np-header">
          <div className="np-header-left">
            <h2 className="np-title">{t('notifications.intelligenceFeed', 'Intelligence Feed')}</h2>
            {unreadCount > 0 && <span className="np-badge">{unreadCount}</span>}
          </div>
          <div className="np-header-right">
            <button type="button" className="np-icon-btn" onClick={() => setShowSettings(s => !s)} title={t('header.settings', 'Settings')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              type="button"
              className="np-icon-btn"
              onClick={() => setFullscreen(f => !f)}
              title={fullscreen ? t('notifications.exitFullScreen', 'Exit full screen') : t('notifications.fullScreenFeed', 'Full screen feed')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {fullscreen ? (
                  <path d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
                ) : (
                  <path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                )}
              </svg>
            </button>
            <button type="button" className="np-close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Settings panel (toggled) */}
        {showSettings && (
          <div className="np-settings">
            <span className="np-settings-label">{t('notifications.popupFrequency', 'Popup frequency')}</span>
            <div className="np-freq">
              {[['realtime', 'Realtime'], ['hourly', 'Hourly'], ['off', 'Off']].map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`np-freq-pill${(notifPrefs?.toastFrequency || 'hourly') === val ? ' is-active' : ''}`}
                  onClick={() => setNotifPrefs({ toastFrequency: val })}
                >{label}</button>
              ))}
            </div>
            <span className="np-settings-hint">{t('notifications.freqHint', 'Hourly shows one popup per hour — breaking news always pops through.')}</span>
            <span className="np-settings-label">{t('notifications.showFor', 'Show notifications for:')}</span>
            {PREF_TOGGLES.map(toggle => (
              <label key={toggle.key} className="np-toggle-row">
                <div className="np-toggle-left">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={toggle.icon} />
                  </svg>
                  <span>{toggle.label}</span>
                </div>
                <button
                  type="button"
                  className={`np-toggle-switch${notifPrefs?.[toggle.key] !== false ? ' is-on' : ''}`}
                  onClick={() => setNotifPrefs({ [toggle.key]: notifPrefs?.[toggle.key] === false ? true : false })}
                  role="switch"
                  aria-checked={notifPrefs?.[toggle.key] !== false}
                >
                  <span className="np-toggle-thumb" />
                </button>
              </label>
            ))}
          </div>
        )}

        {/* Actions bar */}
        {signals.length > 0 && !showSettings && (
          <div className="np-actions">
            {unreadCount > 0 && (
              <button type="button" className="np-action-btn" onClick={markAllRead}>
                {t('notifications.markAllRead', 'Mark all read')}
              </button>
            )}
            <button type="button" className="np-action-btn np-action-clear" onClick={clearAll}>
              {t('notifications.clearAll', 'Clear all')}
            </button>
          </div>
        )}

        {/* Signal list */}
        {!showSettings && (
          <div className="np-list">
            {signals.length === 0 ? (
              <div className="np-empty">
                <svg className="np-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <p className="np-empty-title">{t('notifications.allQuiet', 'All quiet')}</p>
                <p className="np-empty-text">{t('notifications.allQuietDesc', 'Market signals will appear here as they happen. Tap the gear icon to choose what you want to see.')}</p>
              </div>
            ) : (
              sortedSignals.map((signal) => (
                <SignalCard
                  key={signal.id}
                  signal={signal}
                  onRead={markRead}
                  onDismiss={dismiss}
                  onToken={handleToken}
                  onOpen={handleOpen}
                />
              ))
            )}
          </div>
        )}
      </div>
    </>,
    document.body
  )
}
