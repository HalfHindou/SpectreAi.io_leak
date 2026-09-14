import React from 'react'
import { createPortal } from 'react-dom'

/**
 * Info mode toggle button with portalled hover label.
 * Extracted from the original header.jsx during the 2026-04 split.
 */
function InfoSwitchBtn({ infoMode, toggleInfoMode }) {
  const [hovered, setHovered] = React.useState(false)
  const [pos, setPos] = React.useState(null)
  const btnRef = React.useRef(null)
  const hideTimer = React.useRef(null)

  const show = React.useCallback(() => {
    clearTimeout(hideTimer.current)
    setHovered(true)
  }, [])
  const hide = React.useCallback(() => {
    hideTimer.current = setTimeout(() => setHovered(false), 100)
  }, [])

  React.useLayoutEffect(() => {
    if (!hovered || !btnRef.current) { setPos(null); return }
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 10, left: rect.left + rect.width / 2 })
  }, [hovered])

  return (
    <>
      <button
        ref={btnRef}
        className={`info-switch ${infoMode ? 'is-on' : ''}`}
        type="button"
        data-tour="app-info-toggle"
        onClick={toggleInfoMode}
        onMouseEnter={show}
        onMouseLeave={hide}
        aria-pressed={infoMode}
        aria-label={infoMode ? 'Turn off info tooltips' : 'Turn on info tooltips'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>
      {hovered && pos && createPortal(
        <span
          className="info-switch-label is-visible"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {infoMode
            ? 'Educational mode is active. Hover the amber dots next to any term for a plain-English explanation.'
            : 'Education & Onboarding - turn on to reveal helpful explanations for every metric, term, and concept on the platform.'}
        </span>,
        document.body
      )}
    </>
  )
}

export default InfoSwitchBtn
