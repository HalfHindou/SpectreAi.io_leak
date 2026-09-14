import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import './visit-confirm.css'

/**
 * VisitConfirm — a light "are you sure" bar before a visualization click
 * navigates away (heatmap tiles / bubbles). Exploring those surfaces invites
 * accidental clicks (panning, hover-hunting), so navigation asks first.
 *
 * Non-blocking bottom-center glass bar: confirm navigates, Escape / ✕ / the
 * auto-dismiss timer cancel. Rendered inside the page container so the
 * page's day-mode scope applies.
 */
const AUTO_DISMISS_MS = 7000

export default function VisitConfirm({ token, destLabel, onConfirm, onCancel }) {
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!token) return undefined
    const timer = setTimeout(() => onCancel?.(), AUTO_DISMISS_MS)
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.()
      if (e.key === 'Enter') onConfirm?.()
    }
    window.addEventListener('keydown', onKey)
    // Focus the confirm button so Enter/tab work without stealing scroll.
    confirmRef.current?.focus({ preventScroll: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [token, onConfirm, onCancel])

  const { t } = useTranslation()
  if (!token) return null

  return (
    <div className="visit-confirm" role="alertdialog" aria-label={`Visit ${token.symbol}?`}>
      {token.logo && <img className="visit-confirm__logo" src={token.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
      <div className="visit-confirm__text">
        <span className="visit-confirm__title">
          {t('visitConfirm.title', 'Visit {{symbol}}?', { symbol: token.symbol })}
        </span>
        <span className="visit-confirm__dest">{destLabel}</span>
      </div>
      <button ref={confirmRef} type="button" className="visit-confirm__go" onClick={onConfirm}>
        {t('visitConfirm.visit', 'Visit')}
      </button>
      <button type="button" className="visit-confirm__close" aria-label={t('common.cancel', 'Cancel')} onClick={onCancel}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
