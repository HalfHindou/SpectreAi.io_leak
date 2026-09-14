/**
 * chart-ta-enabled — the surface gate for the chart TA layer.
 *
 * The TA layer ships DESKTOP-ONLY for now, and this is the single place that
 * decides it.
 *
 * Not because it breaks on a phone. The selection, the overlay, the hit-tests
 * and the drawn levels were all verified under real touch at 390px. What was
 * never designed for that width is the READOUT. `RzTaStrip` is one horizontal
 * row — timeframe · window · change% · "Walk me through it" · "Clear lines" · ×
 * — and the play bar is a three-column flex of progress dots, two lines of
 * caption and three transport buttons. Below 768px `styles/app-store-ready.css`
 * force-bumps every <button> to a 38px floor through an exempt list that is a
 * hardcoded set of class names, and no `.rzta-*` class is on it. So the strip
 * wraps into stacked rows of chunky boxes: the exact "undesigned chunky boxes"
 * failure already named in that file's own comment (founder, 08-04).
 *
 * Gate, don't delete. The mobile design — the read as a SHEET rather than a
 * strip, reusing the rzm-agent-sheet chrome that already handles scroll and
 * safe-area — is being built behind this same flag. `?chartTa=1` forces the
 * layer on at any width so that work stays testable on a real phone without
 * shipping it; `?chartTa=0` clears the override again.
 *
 * When the mobile read is ready, `useChartTaEnabled` returns true everywhere
 * and this file becomes a one-line export.
 */
import { useState } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'

const OVERRIDE_KEY = 'spectre:chart-ta-mobile'

/**
 * Dev door for the in-progress mobile read.
 *
 * 🪤 A query string is NOT reachable on the surface that needs it. A
 * home-screen PWA has no address bar, and iOS gives it a SEPARATE storage box
 * from Safari — so setting the flag in Safari does not carry into the
 * installed app, and inside the app there is no way to type it. That is why
 * `setChartTaMobile()` exists and why the mobile settings panel carries a
 * switch: on the one device this feature is for, the switch is the only door.
 */
export function chartTaMobileOverride() {
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search).get('chartTa')
    if (q === '1' || q === 'mobile' || q === 'on') {
      window.localStorage?.setItem(OVERRIDE_KEY, '1')
      return true
    }
    if (q === '0' || q === 'off') {
      window.localStorage?.removeItem(OVERRIDE_KEY)
      return false
    }
    return window.localStorage?.getItem(OVERRIDE_KEY) === '1'
  } catch (_) {
    // Private mode / blocked storage — the gate must still resolve.
    return false
  }
}

/** Turn the mobile read on or off from UI (the settings switch). */
export function setChartTaMobile(on) {
  if (typeof window === 'undefined') return
  try {
    if (on) window.localStorage?.setItem(OVERRIDE_KEY, '1')
    else window.localStorage?.removeItem(OVERRIDE_KEY)
  } catch (_) { /* private mode — the switch simply will not stick */ }
}

/** True when the TA layer should mount on this viewport. */
export function useChartTaEnabled() {
  const isMobile = useIsMobile()
  // Read once per mount: the override is a developer action, not something
  // that should re-evaluate mid-session.
  const [override] = useState(chartTaMobileOverride)
  return !isMobile || override
}

export default useChartTaEnabled
