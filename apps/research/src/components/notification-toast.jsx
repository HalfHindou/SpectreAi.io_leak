/**
 * NotificationToast - glass-styled popup for new notifications.
 * Slides in from top-right, auto-dismisses after 6 seconds.
 * Stacks up to 3 toasts. Click to dismiss early.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { parseNotificationSource } from '@/lib/notification-source'
import './notification-toast.css'

const SEVERITY_COLORS = {
  critical: '#EF4444',
  high: '#F59E0B',
  medium: '#3B82F6',
  low: 'rgba(245, 245, 247, 0.5)',
}

// Category tint wins over severity so a bullish breakout reads GREEN (not the
// severity red) and fragility reads amber. Falls back to severity color.
const CATEGORY_COLORS = {
  breakout: '#34D399',
  fragility: '#F59E0B',
  brain: '#818CF8',
  breaking: '#EF4444',
  whale: '#A78BFA',
  news: '#06B6D4',
  'kol-follow': '#F59E0B',
}

const TYPE_ICONS = {
  breaking: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  market: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  whale: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  'kol-follow': 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-4.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM12 12l5.5-5.5',
  news: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  breakout: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z',
  fragility: 'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285zm0 13.036h.008v.008H12v-.008z',
  brain: 'M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z',
}

function Toast({ notification, onDismiss }) {
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true)
      setTimeout(() => onDismiss(notification.id), 300)
    }, 6000)
    return () => clearTimeout(timerRef.current)
  }, [notification.id, onDismiss])

  const handleClick = () => {
    clearTimeout(timerRef.current)
    setExiting(true)
    setTimeout(() => onDismiss(notification.id), 300)
  }

  const severity = notification.meta?.severity || 'medium'
  const isBreaking = notification.category === 'breaking'
  const src = isBreaking ? parseNotificationSource(notification) : null
  const displayTitle = src?.cleanTitle || notification.title
  const color = CATEGORY_COLORS[notification.category] || SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium
  const icon = TYPE_ICONS[notification.category] || TYPE_ICONS.market

  return (
    <div
      className={`nt-toast${isBreaking ? ' nt-toast--breaking' : ''}${exiting ? ' nt-toast--exit' : ''}`}
      onClick={handleClick}
      role="alert"
    >
      <div className="nt-toast-icon" style={{ color }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </div>
      <div className="nt-toast-content">
        {isBreaking && <span className="nt-toast-breaking">Breaking</span>}
        <p className="nt-toast-title">{displayTitle}</p>
        {/* The headline's `— supporting detail` half now arrives as its own
            field; without this line the toast would silently drop it. */}
        {notification.detail && (
          <p className="nt-toast-detail">{notification.detail}</p>
        )}
        {notification.meta?.asset && (
          <span className="nt-toast-asset">{notification.meta.asset}</span>
        )}
      </div>
      <button className="nt-toast-close" onClick={handleClick}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export default function NotificationToastContainer() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((notification) => {
    setToasts(prev => {
      const next = [notification, ...prev].slice(0, 3)
      return next
    })
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast, ToastStack: (
    <div className="nt-stack">
      {toasts.map((t, i) => (
        <Toast
          key={t.id}
          notification={t}
          onDismiss={removeToast}
        />
      ))}
    </div>
  )}
}

export function useNotificationToasts() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((notification) => {
    setToasts(prev => [notification, ...prev].slice(0, 3))
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}

export function ToastStack({ toasts, onDismiss, dayMode = false }) {
  if (!toasts.length) return null
  // The stack mounts OUTSIDE the .app div (sibling of appContent in AppShell),
  // so `.app.app-day-mode` descendant selectors never reach it — day styling
  // must ride on the stack itself via this class.
  return (
    <div className={`nt-stack${dayMode ? ' nt-stack--day' : ''}`}>
      {toasts.map(t => (
        <Toast key={t.id} notification={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
