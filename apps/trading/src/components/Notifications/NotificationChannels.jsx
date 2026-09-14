/**
 * NotificationChannels - the "where alerts reach you" block (prefix nd-).
 *
 * Renders only what the device can actually do. Web Push works in a plain
 * browser tab on desktop Chrome/Edge/Firefox, macOS Safari 16+, and Android
 * Chrome/Firefox; it requires a home-screen install ONLY on iOS/iPadOS. So the
 * home-screen copy is gated on pushService's 'ios-needs-install' status and can
 * never appear on a platform where push already works.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { BellRing, Check } from 'lucide-react'
import TelegramGlyph from '../ui/TelegramGlyph'
import { usePrivySafe as usePrivy } from '../../lib/use-privy-safe'
import { getPushStatus, enablePush, disablePush } from '../../services/pushService'
import { getTelegramStatus, startTelegramLink, unlinkTelegram } from '../../services/telegramLink'

const TG_POLL_MS = 3000
const TG_MAX_POLLS = 20

export default function NotificationChannels() {
  const { authenticated, getAccessToken } = usePrivy()
  const [pushStatus, setPushStatus] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [tgStatus, setTgStatus] = useState(null)
  const [tgError, setTgError] = useState(false)
  const tgPollRef = useRef(null)

  // privy.md D2: getAccessToken gets a new identity on every Privy re-render.
  // Keep it in a ref so effects depend on `authenticated` alone.
  const getAccessTokenRef = useRef(getAccessToken)
  useEffect(() => { getAccessTokenRef.current = getAccessToken }, [getAccessToken])

  const clearTgPoll = useCallback(() => {
    if (tgPollRef.current) { clearInterval(tgPollRef.current); tgPollRef.current = null }
  }, [])

  useEffect(() => {
    let cancelled = false
    getPushStatus().then(s => { if (!cancelled) setPushStatus(s) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!authenticated) { clearTgPoll(); setTgStatus(null); return }
    let cancelled = false
    getTelegramStatus((...a) => getAccessTokenRef.current(...a))
      .then(s => { if (!cancelled) setTgStatus(s) })
    return () => { cancelled = true }
  }, [authenticated, clearTgPoll])

  useEffect(() => () => clearTgPoll(), [clearTgPoll])

  const togglePush = useCallback(async () => {
    if (pushBusy) return
    if (pushStatus === 'denied' || pushStatus === 'unsupported' || pushStatus === 'ios-needs-install') return
    setPushBusy(true)
    try {
      if (pushStatus === 'granted-subscribed') {
        const ok = await disablePush(getAccessTokenRef.current)
        setPushStatus(ok ? 'granted-unsubscribed' : await getPushStatus())
      } else {
        const ok = await enablePush(getAccessTokenRef.current)
        setPushStatus(ok ? 'granted-subscribed' : await getPushStatus())
      }
    } finally {
      setPushBusy(false)
    }
  }, [pushStatus, pushBusy])

  const connectTelegram = useCallback(async () => {
    setTgError(false)
    const result = await startTelegramLink((...a) => getAccessTokenRef.current(...a))
    if (!result?.url) { setTgError(true); return }
    window.open(result.url, '_blank')
    setTgStatus('waiting')
    clearTgPoll()
    let attempts = 0
    tgPollRef.current = setInterval(async () => {
      // I6: the visibility guard must run BEFORE the attempt counter -
      // connecting opens Telegram in another tab/app, so this tab is
      // hidden for the whole flow. Counting hidden ticks burned all 20
      // attempts in 60s before a single status check ever ran.
      if (document.hidden) return
      attempts += 1
      if (attempts > TG_MAX_POLLS) { clearTgPoll(); setTgStatus('unlinked'); return }
      const s = await getTelegramStatus((...a) => getAccessTokenRef.current(...a))
      if (s === 'linked') { clearTgPoll(); setTgStatus('linked') }
    }, TG_POLL_MS)
  }, [clearTgPoll])

  const disconnectTelegram = useCallback(async () => {
    const ok = await unlinkTelegram((...a) => getAccessTokenRef.current(...a))
    if (ok) setTgStatus('unlinked')
  }, [])

  const pushOn = pushStatus === 'granted-subscribed'
  const pushBlocked = pushStatus === 'denied'

  // I5: 'unavailable' (missing bot token, a 503, or any thrown error) and
  // signed-out both hide the Telegram row; a push-unsupported browser hides
  // the push row. When neither channel has anything to show, render nothing
  // at all rather than a "WHERE ALERTS REACH YOU" heading over an empty
  // panel. We can't tell a transient outage from a channel that's simply
  // not configured for this environment, so there's no honest in-between
  // state to show for Telegram here - hiding the whole section is the
  // truthful option, not a fabricated "reconnect" affordance.
  const showPush = pushStatus === 'ios-needs-install' || (pushStatus && pushStatus !== 'unsupported')
  const showTelegram = authenticated && (tgStatus === 'unlinked' || tgStatus === 'waiting' || tgStatus === 'linked')
  if (!showPush && !showTelegram) return null

  return (
    <div className="nd-channels">
      <span className="nd-channels-label">Where alerts reach you</span>

      {pushStatus === 'ios-needs-install' ? (
        <div className="nd-channel">
          <span className="nd-channel-icon"><BellRing size={15} strokeWidth={1.9} /></span>
          <span className="nd-channel-body">
            <span className="nd-channel-name">Browser</span>
            <span className="nd-channel-sub">
              On iPhone and iPad, add Spectre to your Home Screen (Share &rarr; Add to Home Screen)
              to receive notifications.
            </span>
          </span>
        </div>
      ) : pushStatus && pushStatus !== 'unsupported' ? (
        <button
          type="button"
          className={`nd-channel nd-channel--action${pushOn ? ' is-on' : ''}`}
          onClick={togglePush}
          disabled={pushBusy || pushBlocked}
          aria-pressed={pushOn}
        >
          <span className="nd-channel-icon"><BellRing size={15} strokeWidth={1.9} /></span>
          <span className="nd-channel-body">
            <span className="nd-channel-name">Browser</span>
            <span className="nd-channel-sub">
              {pushBlocked
                ? 'Blocked in your browser settings'
                : pushOn ? 'Alerts arrive even when Spectre is closed' : 'Get alerts outside the app'}
            </span>
          </span>
          <span className={`nd-toggle${pushOn ? ' is-on' : ''}`}><span className="nd-toggle-thumb" /></span>
        </button>
      ) : null}

      {authenticated && (tgStatus === 'unlinked' || tgStatus === 'waiting' || tgStatus === 'linked') && (
        <div className="nd-channel">
          <span className="nd-channel-icon"><TelegramGlyph size={15} /></span>
          <span className="nd-channel-body">
            <span className="nd-channel-name">Telegram</span>
            <span className="nd-channel-sub">
              {tgStatus === 'linked' && 'Connected'}
              {tgStatus === 'waiting' && 'Waiting for Telegram...'}
              {tgStatus === 'unlinked' && (tgError ? 'Could not start linking - try again' : 'Get alerts as a message')}
            </span>
          </span>
          {tgStatus === 'linked' && (
            <>
              <span className="nd-channel-check"><Check size={14} strokeWidth={2.4} /></span>
              <button type="button" className="nd-channel-btn" onClick={disconnectTelegram}>Disconnect</button>
            </>
          )}
          {tgStatus === 'unlinked' && (
            <button type="button" className="nd-channel-btn" onClick={connectTelegram}>Connect</button>
          )}
        </div>
      )}
    </div>
  )
}
