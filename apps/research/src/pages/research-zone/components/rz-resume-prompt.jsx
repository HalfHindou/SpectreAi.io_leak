/**
 * RzResumePrompt — "pick up where you left off?"
 *
 * Landing on /research-zone with no token in the URL resolves to the default
 * (BTC), so leaving the desk and coming back threw away whatever was being
 * researched: the token, the chart engine and the timeframe all had to be
 * re-picked by hand. Beta feedback, 2026-08-24.
 *
 * It ASKS rather than restoring silently, which is what was requested and also
 * the honest behaviour — someone arriving to look at something new should not
 * have to undo a restore they never asked for.
 *
 * Only ever appears on the no-token landing: with a slug in the URL the reader
 * has already said what they want, and a prompt there would be noise.
 */
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { getSession, clearSession } from '@/services/rzLocalStorage'
import useSettingsStore from '@/store/useSettingsStore'
import { getTokenSlug } from '@/lib/tokenSlugs'
import './rz-resume-prompt.css'

/** How long ago, in the voice the rest of the desk uses. */
function agoLabel(ts) {
  const ms = Date.now() - ts
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

// Did this page load ever land on the desk with NO token named? That is the
// default landing this card exists for, and it must be remembered OUTSIDE React.
//
// 🪤 The desk remounts this subtree repeatedly while a landing settles —
// measured at 14 mounts in ~135ms, and the LAST of them already sees the
// rewritten /research-zone/<default> URL, i.e. `active: false`. So component
// state cannot hold the decision: whichever mount wins last would win, and that
// is the one with the least information. A module-scoped latch is what survives.
let landedWithoutToken = false

/** The session worth offering on this landing, or null. Safe to call on every mount. */
function readOffer(active) {
  if (active) landedWithoutToken = true
  if (!landedWithoutToken) return null
  return getSession() || null
}

export default function RzResumePrompt({ active, currentSymbol, onResume }) {
  const { t } = useTranslation()
  const setChartType = useSettingsStore((s) => s.setChartType)
  const setChartTimeframe = useSettingsStore((s) => s.setChartTimeframe)

  // Read synchronously during render: child effects commit before the parent's,
  // so reading in an effect here would run AFTER the desk's own session capture
  // deep in the lite tree — racing for the value this card exists to read.
  const [session, setSession] = useState(() => readOffer(active))

  const resume = useCallback(() => {
    if (!session) return
    // Restore the chart setup first so the desk mounts as it was left rather
    // than painting the default and swapping under the reader.
    if (session.chartType) setChartType(session.chartType)
    if (session.chartTimeframe) setChartTimeframe(session.chartTimeframe)
    setSession(null)
    onResume?.({
      symbol: session.symbol,
      slug: getTokenSlug(session.symbol, !!session.isStock),
      name: session.name,
      logo: session.logo,
      isStock: !!session.isStock,
    })
  }, [session, setChartType, setChartTimeframe, onResume])

  const dismiss = useCallback(() => {
    clearSession()
    setSession(null)
  }, [])

  if (!session) return null
  // 🪤 Compare against the token the desk ACTUALLY landed on, every render —
  // not once at mount. On a client-side return the token context can still hold
  // the PREVIOUS token for the first render, so a mount-time check suppressed
  // the card against the very token it was about to offer, and then the desk
  // settled on the default anyway. Evaluated live, this also retires the card
  // after Continue without tracking that separately.
  if (currentSymbol && session.symbol?.toUpperCase() === currentSymbol.toUpperCase()) return null

  const label = session.name && session.name !== session.symbol
    ? session.name
    : session.symbol

  // Portalled: `.app-main-content` carries z-index: 1, so a fixed child of it
  // is trapped in that stacking context and paints UNDER the mobile nav
  // (z 400) no matter what z-index it sets on itself.
  return createPortal((
    <div className="rzrp" role="status" aria-live="polite">
      <div className="rzrp-card">
        {session.logo
          ? <img className="rzrp-logo" src={session.logo} alt="" width="30" height="30" loading="lazy" />
          : <span className="rzrp-logo rzrp-logo--letter">{(session.symbol || '?').slice(0, 1)}</span>}

        <span className="rzrp-text">
          <span className="rzrp-title">{t('researchPro.resumePrompt.rzresumeprompt.pickUpWhereYouLeftOff', "Pick up where you left off?")}</span>
          <span className="rzrp-sub">
            {label}
            <span className="rzrp-dot" aria-hidden> · </span>
            {agoLabel(session.at)}
            {session.chartTimeframe && (
              <>
                <span className="rzrp-dot" aria-hidden> · </span>
                {session.chartTimeframe}
              </>
            )}
          </span>
        </span>

        <button type="button" className="rzrp-resume" onClick={resume}>
          {t('researchPro.resumePrompt.rzresumeprompt.continue', "Continue")}
        </button>
        <button type="button" className="rzrp-dismiss" onClick={dismiss} aria-label={t('researchPro.resumePrompt.rzresumeprompt.ariaStartFresh', "Start fresh")}>
          &#10005;
        </button>
      </div>
    </div>
  ), document.body)
}
