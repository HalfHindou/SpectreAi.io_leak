/**
 * IntelligenceBanner — one sentence, auto-dismisses after 8 seconds.
 * No close button. No icon. No background.
 * Never returns in the same session once dismissed.
 */
import { useState, useEffect, useRef } from 'react'

const SESSION_KEY = 'spectre:you-banner-shown'

export default function IntelligenceBanner() {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const fadeTimerRef = useRef(null)

  useEffect(() => {
    // Skip if already shown this session
    try {
      if (sessionStorage.getItem(SESSION_KEY)) {
        setDismissed(true)
        return
      }
    } catch (_) { console.error(_) }

    // Fade in after a short delay
    const showTimer = setTimeout(() => setVisible(true), 300)

    // Auto-dismiss after 8 seconds
    const dismissTimer = setTimeout(() => {
      setVisible(false)
      // After fade-out animation, mark as dismissed
      fadeTimerRef.current = setTimeout(() => {
        setDismissed(true)
        try { sessionStorage.setItem(SESSION_KEY, '1') } catch (_) { console.error(_) }
      }, 400)
    }, 8300) // 300ms show delay + 8000ms display

    return () => {
      clearTimeout(showTimer)
      clearTimeout(dismissTimer)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [])

  if (dismissed) return null

  return (
    <div className={`you-intelligence-banner ${visible ? 'visible' : ''}`}>
      Welcome to your space. Arrange it however you like.
    </div>
  )
}
