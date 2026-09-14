/**
 * CustomAlertBuilder — Modal for creating custom event alerts.
 * Event search, condition operator, threshold input, notification toggle.
 */

import React, { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import './CustomAlertBuilder.css'

const CustomAlertBuilder = ({ alerts = [], onAdd, onRemove, onToggle, onClose }) => {
  const { t } = useTranslation()
  const OPERATORS = [
    { id: '>', label: t('economicCalendar.customAlerts.operatorGt', 'Greater than') },
    { id: '<', label: t('economicCalendar.customAlerts.operatorLt', 'Less than') },
    { id: '=', label: t('economicCalendar.customAlerts.operatorEq', 'Equal to') },
  ]
  const [eventName, setEventName] = useState('')
  const [operator, setOperator] = useState('>')
  const [threshold, setThreshold] = useState('')

  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    if (!eventName.trim() || threshold === '') return
    onAdd({ eventName: eventName.trim(), operator, threshold: Number(threshold), method: 'notification' })
    setEventName('')
    setThreshold('')
  }, [eventName, operator, threshold, onAdd])

  const modal = (
    <div className="alert-builder__overlay" onClick={onClose}>
      <div className="alert-builder" onClick={(e) => e.stopPropagation()}>
        <div className="alert-builder__header">
          <h3 className="alert-builder__title">{t('economicCalendar.customAlerts.title', 'Custom Alerts')}</h3>
          <button className="alert-builder__close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="alert-builder__form" onSubmit={handleSubmit}>
          <div className="alert-builder__field">
            <label className="alert-builder__label">{t('economicCalendar.customAlerts.eventName', 'Event Name')}</label>
            <input
              type="text"
              className="alert-builder__input"
              placeholder={t('economicCalendar.customAlerts.eventPlaceholder', 'e.g., CPI, FOMC, NFP...')}
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
          </div>

          <div className="alert-builder__field">
            <label className="alert-builder__label">{t('economicCalendar.customAlerts.condition', 'Condition')}</label>
            <div className="alert-builder__operators">
              {OPERATORS.map(op => (
                <button
                  key={op.id}
                  type="button"
                  className={`alert-builder__op${operator === op.id ? ' alert-builder__op--active' : ''}`}
                  onClick={() => setOperator(op.id)}
                >
                  {op.id}
                </button>
              ))}
            </div>
          </div>

          <div className="alert-builder__field">
            <label className="alert-builder__label">{t('economicCalendar.customAlerts.threshold', 'Threshold')}</label>
            <input
              type="number"
              className="alert-builder__input alert-builder__input--number"
              placeholder="0.0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              step="0.1"
            />
          </div>

          <button
            type="submit"
            className="alert-builder__submit"
            disabled={!eventName.trim() || threshold === ''}
          >
            {t('economicCalendar.customAlerts.addAlert', 'Add Alert')}
          </button>
        </form>

        {/* Existing alerts */}
        {alerts.length > 0 && (
          <div className="alert-builder__list">
            <h4 className="alert-builder__list-title">{t('economicCalendar.customAlerts.activeAlerts', 'Active Alerts')}</h4>
            {alerts.map(alert => (
              <div key={alert.id} className={`alert-builder__alert${!alert.active ? ' alert-builder__alert--disabled' : ''}`}>
                <div className="alert-builder__alert-info">
                  <span className="alert-builder__alert-name">{alert.eventName}</span>
                  <span className="alert-builder__alert-condition">
                    {alert.operator} {alert.threshold}
                  </span>
                </div>
                <div className="alert-builder__alert-actions">
                  <button
                    className="alert-builder__alert-toggle"
                    onClick={() => onToggle(alert.id)}
                    title={alert.active ? t('economicCalendar.customAlerts.disable', 'Disable') : t('economicCalendar.customAlerts.enable', 'Enable')}
                  >
                    {alert.active ? t('economicCalendar.customAlerts.on', 'ON') : t('economicCalendar.customAlerts.off', 'OFF')}
                  </button>
                  <button
                    className="alert-builder__alert-remove"
                    onClick={() => onRemove(alert.id)}
                    title={t('economicCalendar.customAlerts.remove', 'Remove')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

export default CustomAlertBuilder
