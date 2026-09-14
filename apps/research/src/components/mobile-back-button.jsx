import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './mobile-back-button.css'

/**
 * Shared mobile back button. Only renders when we can infer an origin to
 * return to (location.state.fromWelcome === true, or the caller explicitly
 * sets the `visible` prop).
 *
 * Why opt-in: users arriving via deep link / refresh / direct navigation
 * should not see a Back arrow that would push them somewhere unrelated.
 */
export default function MobileBackButton({
  className = '',
  fallbackPath = '/',
  visible,
  onBack,
  label,
}) {
  const navigate = useNavigate()
  const location = useLocation()

  const fromWelcome = location.state?.fromWelcome === true
  const shouldShow = typeof visible === 'boolean' ? visible : fromWelcome

  const handleClick = useCallback(() => {
    if (onBack) { onBack(); return }
    if (fromWelcome && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate(fallbackPath)
  }, [onBack, fromWelcome, fallbackPath, navigate])

  if (!shouldShow) return null

  const baseClass = `mobile-back-btn${label ? ' mobile-back-btn--with-label' : ''} ${className}`.trim()

  return (
    <button
      type="button"
      className={baseClass}
      onClick={handleClick}
      aria-label={label ? `Back to ${label}` : 'Back'}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label && <span className="mobile-back-btn__label">{label}</span>}
    </button>
  )
}
