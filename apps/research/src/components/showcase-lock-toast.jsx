/**
 * ShowcaseLockToast
 *
 * Listens for `spectre:showcase-lock` window events (dispatched by
 * the nav components when a locked route is tapped inside the
 * showcase iframe) and renders a small single-line pill that auto
 * dismisses. Tight enough to fit a 320px iframe.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const TOAST_TTL_MS = 2000

export default function ShowcaseLockToast() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('Available in Beta')
  const timerRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    function onLock(e) {
      const reason = e?.detail?.reason
      setMessage(reason === 'coming-soon' ? 'Coming Soon' : 'Available in Beta')
      setVisible(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setVisible(false)
        timerRef.current = null
      }, TOAST_TTL_MS)
    }

    window.addEventListener('spectre:showcase-lock', onLock)
    return () => {
      window.removeEventListener('spectre:showcase-lock', onLock)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (typeof document === 'undefined') return null

  const node = (
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 20,
        transform: `translate(-50%, ${visible ? '0' : '8px'})`,
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
        transition: 'opacity 160ms ease-out, transform 200ms ease-out',
        zIndex: 99999,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 11px 6px 9px',
          background: 'rgba(10, 11, 15, 0.92)',
          border: '0.5px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 999,
          color: 'rgba(245, 245, 247, 0.92)',
          fontSize: 11.5,
          fontWeight: 500,
          letterSpacing: '0.01em',
          lineHeight: 1,
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.4)',
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.72, flexShrink: 0 }}
        >
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>{message}</span>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
