/**
 * AlertNotification - Triggered price alert toast
 *
 * Cinematic slide-in notification with token logo, alert details,
 * and auto-dismiss countdown. Wall Street terminal meets Apple.
 */

import React, { useEffect, useState } from 'react'
import { Bell, X, TrendingUp, TrendingDown } from 'lucide-react'
import { formatPrice, formatLargeNumber } from '../services/codexApi'

export default function AlertNotification({ triggeredAlerts, onDismiss, onNavigate }) {
  if (!triggeredAlerts?.length) return null

  return (
    <div className="alert-notifications">
      {triggeredAlerts.slice(0, 3).map((alert) => (
        <AlertToast key={alert.webhookId} alert={alert} onDismiss={onDismiss} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function AlertToast({ alert, onDismiss, onNavigate }) {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => handleDismiss(), 12000)
    return () => clearTimeout(timer)
  }, [])

  const handleDismiss = () => {
    setExiting(true)
    setTimeout(() => onDismiss(alert.webhookId), 300)
  }

  const isAbove = alert.direction === 'above'
  const isMcap = alert.mode === 'mcap'
  const ArrowIcon = isAbove ? TrendingUp : TrendingDown

  // Format the target value
  const targetLabel = isMcap
    ? `MCap ${isAbove ? 'above' : 'below'} $${alert.displayValue || ''}`
    : `Price ${isAbove ? 'above' : 'below'} $${alert.displayValue || ''}`

  // Current value at trigger time
  const currentLabel = isMcap
    ? formatLargeNumber(alert.currentMcap)
    : formatPrice(alert.currentPrice)

  return (
    <div
      className={`alert-toast${visible ? ' visible' : ''}${exiting ? ' exiting' : ''}`}
      onClick={() => {
        if (alert.tokenAddress && onNavigate) {
          onNavigate(alert.tokenAddress, alert.networkId, alert.symbol, alert.logo)
          handleDismiss()
        }
      }}
      style={{ cursor: alert.tokenAddress ? 'pointer' : 'default' }}
    >
      {/* Left accent line */}
      <div className={`alert-toast-accent ${isAbove ? 'bull' : 'bear'}`} />

      {/* Token logo or bell fallback */}
      <div className="alert-toast-avatar">
        {alert.logo ? (
          <img src={alert.logo} alt="" className="alert-toast-logo" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }} />
        ) : null}
        <div className="alert-toast-logo-fallback" style={{ display: alert.logo ? 'none' : 'flex' }}>
          {alert.symbol ? alert.symbol.charAt(0) : <Bell size={14} />}
        </div>
      </div>

      {/* Content */}
      <div className="alert-toast-body">
        <div className="alert-toast-row-1">
          <span className="alert-toast-symbol">{alert.symbol || 'Alert'}</span>
          <span className="alert-toast-badge">TRIGGERED</span>
        </div>
        <div className="alert-toast-row-2">
          <ArrowIcon size={11} className={isAbove ? 'alert-icon-bull' : 'alert-icon-bear'} />
          <span className="alert-toast-target">{targetLabel}</span>
        </div>
        <div className="alert-toast-row-3">
          <span className="alert-toast-current">{isMcap ? 'MCap' : 'Price'} was {currentLabel} at creation</span>
        </div>
      </div>

      {/* Close */}
      <button className="alert-toast-close" onClick={handleDismiss}>
        <X size={14} />
      </button>

      {/* Countdown bar */}
      <div className="alert-toast-progress" />
    </div>
  )
}
