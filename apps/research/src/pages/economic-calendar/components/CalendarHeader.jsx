/**
 * CalendarHeader — Minimal flat row.
 * Green dot + "Calendar" title + action buttons + filter dropdown anchor.
 */

import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import './CalendarHeader.css'

const FunnelIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
)

const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const BellIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

const SlidersIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
  </svg>
)

const GoogleCalIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="12" y1="14" x2="12" y2="18" />
    <line x1="10" y1="16" x2="14" y2="16" />
  </svg>
)

const CalendarHeader = ({
  onFilterToggle,
  filterOpen = false,
  notificationsEnabled,
  scheduledCount = 0,
  onNotificationToggle,
  onExport,
  onGoogleCalendar,
  onAlerts,
  alertCount = 0,
  filterDropdown,
  filterBtnRef,
}) => {
  const { t } = useTranslation()
  const localRef = useRef(null)
  const btnRef = filterBtnRef || localRef

  return (
    <div className="ec-header">
      <div className="ec-header__left">
        <div className="ec-header__title-group">
          <div className="ec-header__title-row">
            <span className="ec-header__dot" />
            <h1 className="ec-header__title">{t('economicCalendar.headerTitle', 'Economic Calendar')}</h1>
            <InfoTip text={t('economicCalendar.headerTooltip', 'Track macro events that move crypto. CPI, NFP, FOMC -- these releases drive Bitcoin volatility more than most on-chain metrics.')} position="bottom" />
          </div>
          <p className="ec-header__subtitle">{t('economicCalendar.headerSubtitle', 'Macro events that move crypto markets')}</p>
        </div>
      </div>

      <div className="ec-header__right">
        <button
          className={`ec-header__notif${notificationsEnabled ? ' ec-header__notif--active' : ''}`}
          onClick={onNotificationToggle}
          title={notificationsEnabled ? `${scheduledCount} ${t('economicCalendar.notificationsScheduled', 'notifications scheduled')}` : t('economicCalendar.enableNotifications', 'Enable notifications')}
        >
          <BellIcon />
          {notificationsEnabled && scheduledCount > 0 && (
            <span className="ec-header__notif-badge">{scheduledCount}</span>
          )}
        </button>
        {onGoogleCalendar && (
          <button
            className="ec-header__gcal"
            onClick={onGoogleCalendar}
            title={t('economicCalendar.addToGoogleCalendar', 'Add next critical event to Google Calendar')}
          >
            <GoogleCalIcon />
          </button>
        )}
        <button
          className="ec-header__export"
          onClick={onExport}
          title={t('economicCalendar.exportIcs', 'Export to calendar (.ics)')}
        >
          <DownloadIcon />
        </button>
        {onAlerts && (
          <button
            className={`ec-header__alerts${alertCount > 0 ? ' ec-header__alerts--active' : ''}`}
            onClick={onAlerts}
            title={`${t('economicCalendar.customAlerts', 'Custom alerts')}${alertCount > 0 ? ` (${alertCount} ${t('economicCalendar.active', 'active')})` : ''}`}
          >
            <SlidersIcon />
            {alertCount > 0 && (
              <span className="ec-header__alerts-badge">{alertCount}</span>
            )}
          </button>
        )}
        <button
          ref={btnRef}
          className={`ec-header__filter${filterOpen ? ' ec-header__filter--active' : ''}`}
          onClick={onFilterToggle}
          title={t('economicCalendar.filters', 'Filters')}
        >
          <FunnelIcon />
        </button>
        {filterDropdown}
      </div>
    </div>
  )
}

export default CalendarHeader
