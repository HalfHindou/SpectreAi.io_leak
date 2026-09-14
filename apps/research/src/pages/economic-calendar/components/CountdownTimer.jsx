/**
 * CountdownTimer Component
 * Reusable countdown display for hero cards and sidebar items.
 * Renders dd:hh:mm:ss with urgent styling when < 1 hour.
 */

import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCountdown } from '../hooks/useCountdown'
import './CountdownTimer.css'

const pad = (n) => String(n).padStart(2, '0')

const CountdownTimer = ({ targetTime, size = 'compact', showLabel = true }) => {
  const { t } = useTranslation()
  const { days, hours, minutes, seconds, isExpired, isUrgent } = useCountdown(targetTime)

  if (isExpired) {
    return (
      <div className={`countdown-timer countdown-timer--${size} countdown-timer--expired`}>
        <span className="countdown-timer__live-dot" />
        <span className="countdown-timer__live-label">{t('economicCalendar.countdown.liveNow', 'LIVE NOW')}</span>
      </div>
    )
  }

  const isLarge = size === 'large'
  const parts = []
  const units = []

  if (days > 0) { parts.push(pad(days)); units.push('d') }
  parts.push(pad(hours)); units.push('h')
  parts.push(pad(minutes)); units.push('m')
  parts.push(pad(seconds)); units.push('s')

  return (
    <div
      className={[
        'countdown-timer',
        `countdown-timer--${size}`,
        isUrgent ? 'countdown-timer--urgent' : '',
      ].filter(Boolean).join(' ')}
    >
      {showLabel && (
        <span className="countdown-timer__label">
          {isUrgent ? t('economicCalendar.countdown.liveIn', 'LIVE IN') : t('economicCalendar.countdown.startsIn', 'STARTS IN')}
        </span>
      )}
      <span className="countdown-timer__digits">
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="countdown-timer__sep">:</span>}
            <span className="countdown-timer__segment">{part}</span>
            <span className="countdown-timer__unit">{units[i]}</span>
          </React.Fragment>
        ))}
      </span>
    </div>
  )
}

export default memo(CountdownTimer)
