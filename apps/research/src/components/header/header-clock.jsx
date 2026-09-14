import React, { useState, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Isolated clock component - prevents the entire Header from re-rendering every second.
 * Extracted from the original header.jsx during the 2026-04 split.
 */
const HeaderClock = memo(({ timeFormat, onToggleFormat }) => {
  const [time, setTime] = useState(new Date())
  const { t } = useTranslation()

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return   // skip the 1s tick on backgrounded tabs
      setTime(new Date())
    }, 1000)
    // resync immediately when the tab becomes visible again
    const onVis = () => { if (!document.hidden) setTime(new Date()) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const dayName = time.toLocaleDateString('en-US', { weekday: 'long' })
  const timeStr = timeFormat === '24h'
    ? time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const toggleLabel = timeFormat === '12h' ? '24' : '12'

  return (
    <div
      className="datetime-card"
      onClick={onToggleFormat}
      data-tooltip={t('header.toggleTimeFormat', { format: toggleLabel })}
           style={{ cursor: 'pointer' }}
    >
      <span className="datetime-date">{t('header.today')}{time.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span>
      <div className="datetime-row">
        <span className="datetime-time">{timeStr}</span>
        <span className="datetime-day">{dayName}</span>
      </div>
    </div>
  )
})

export default HeaderClock
