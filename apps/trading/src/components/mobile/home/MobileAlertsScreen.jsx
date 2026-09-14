/**
 * MobileAlertsScreen — the Alerts tab (prefix mal-).
 *
 * Read-only list of the user's existing price alerts (App-level useAlerts —
 * Privy-scoped, empty when signed out). Creation stays on the token page
 * (AlertButton); the empty state routes there via the screener.
 *
 * Active-rule rows support swipe-left (touch-primary devices only, mirrors
 * the mrow swipe-row mechanics in MobileTokenRow.jsx: touchstart/move/end
 * with translateX + threshold snap) to reveal a Pause/Play + Delete tray,
 * so the always-visible icon buttons don't have to compete for row width
 * with the rest of the DexScreener-style dense layout on a phone. Fine
 * pointers (desktop/reviewer) keep today's always-visible buttons and get
 * no swipe handlers at all.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, ArrowUp, ArrowDown, Trash2, Repeat, Pause, Play } from 'lucide-react'
import TelegramGlyph from '../../ui/TelegramGlyph'
import { formatPrice } from '../../../services/codexApi'
import { usePrivySafe as usePrivy } from '../../../lib/use-privy-safe'
import { getPushStatus, enablePush, disablePush } from '../../../services/pushService'
import { getTelegramStatus, startTelegramLink, unlinkTelegram } from '../../../services/telegramLink'
import './MobileAlertsScreen.css'

const TG_POLL_MS = 3000
const TG_MAX_POLLS = 20
const SWIPE_TRAY_W = 120
const SWIPE_OPEN_AT = -60

// Relative-time label for a triggered record's timestamp (ms epoch).
const relTime = (ts) => {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function MobileAlertsScreen({
  alerts,
  rules,
  updateAlert,
  deleteAlert,
  triggered,
  deleteTriggered,
  onSeen,
  selectToken,
  onGoScreener,
}) {
  const [busyId, setBusyId] = useState(null)
  const { getAccessToken, authenticated } = usePrivy()
  const [pushStatus, setPushStatus] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)

  // Swipe-left tray on active-rule rows — touch-primary only, resolved once
  // (matchMedia is stable for the life of the screen; no listener needed).
  const [coarsePointer, setCoarsePointer] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    setCoarsePointer(window.matchMedia('(pointer: coarse)').matches)
  }, [])
  // one open swipe tray at a time across the whole active list
  const [openSwipeId, setOpenSwipeId] = useState(null)

  // Telegram link state machine: null (checking) -> 'unavailable' | 'unlinked'
  // | 'waiting' (link started, polling for confirmation) | 'linked'.
  // null/'unavailable'/signed-out all render nothing.
  const [tgStatus, setTgStatus] = useState(null)
  const [tgError, setTgError] = useState(false)
  const tgPollRef = useRef(null)

  // privy.md D2: getAccessToken changes identity every Privy re-render -
  // keep it in a ref so effects depend on `authenticated` only.
  const getAccessTokenRef = useRef(getAccessToken)
  useEffect(() => { getAccessTokenRef.current = getAccessToken }, [getAccessToken])

  const clearTgPoll = useCallback(() => {
    if (tgPollRef.current) {
      clearInterval(tgPollRef.current)
      tgPollRef.current = null
    }
  }, [])

  // Mark the triggered history as seen once this screen has mounted -
  // clears the unseen-count badge on MobileHomeNav.
  useEffect(() => { onSeen?.() }, [onSeen])

  useEffect(() => {
    let cancelled = false
    getPushStatus().then(s => { if (!cancelled) setPushStatus(s) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!authenticated) { clearTgPoll(); setTgStatus(null); return }
    let cancelled = false
    getTelegramStatus((...a) => getAccessTokenRef.current(...a)).then(s => { if (!cancelled) setTgStatus(s) })
    return () => { cancelled = true }
  }, [authenticated, clearTgPoll])

  // Stop any in-flight poll on unmount or when sign-out/unavailable happens.
  useEffect(() => () => clearTgPoll(), [clearTgPoll])

  const connectTelegram = useCallback(async () => {
    setTgError(false)
    const result = await startTelegramLink((...a) => getAccessTokenRef.current(...a))
    if (!result?.url) { setTgError(true); return }
    window.open(result.url, '_blank')
    setTgStatus('waiting')
    clearTgPoll()
    let attempts = 0
    tgPollRef.current = setInterval(async () => {
      // I6 (deliberate scope extension, same bug as the desktop drawer's
      // NotificationChannels.jsx): the visibility guard must run BEFORE
      // the attempt counter - connecting opens Telegram in another
      // tab/app, so this tab is hidden for the whole flow. Counting
      // hidden ticks burned all 20 attempts in 60s before a single status
      // check ever ran, so a successful link never got picked up.
      if (document.hidden) return
      attempts += 1
      if (attempts > TG_MAX_POLLS) {
        clearTgPoll()
        setTgStatus('unlinked')
        return
      }
      const s = await getTelegramStatus((...a) => getAccessTokenRef.current(...a))
      if (s === 'linked') {
        clearTgPoll()
        setTgStatus('linked')
      }
    }, TG_POLL_MS)
  }, [clearTgPoll])

  const disconnectTelegram = useCallback(async () => {
    const ok = await unlinkTelegram((...a) => getAccessTokenRef.current(...a))
    if (ok) setTgStatus('unlinked')
  }, [])

  const togglePush = useCallback(async () => {
    if (pushBusy || pushStatus === 'denied' || pushStatus === 'unsupported' || pushStatus === 'ios-needs-install') return
    setPushBusy(true)
    try {
      if (pushStatus === 'granted-subscribed') {
        const ok = await disablePush(getAccessToken)
        setPushStatus(ok ? 'granted-unsubscribed' : await getPushStatus())
      } else {
        const ok = await enablePush(getAccessToken)
        setPushStatus(ok ? 'granted-subscribed' : await getPushStatus())
      }
    } finally {
      setPushBusy(false)
    }
  }, [pushStatus, pushBusy, getAccessToken])

  const remove = useCallback(async (id) => {
    setBusyId(id)
    try { await deleteAlert?.(id) } finally { setBusyId(null) }
  }, [deleteAlert])

  const togglePauseRule = useCallback(async (a) => {
    const paused = a.status === 'paused'
    setBusyId(a.id)
    try { await updateAlert(a.id, { status: paused ? 'active' : 'paused' }) }
    catch { /* row stays as-is; next poll reconciles */ }
    finally { setBusyId(null) }
  }, [updateAlert])

  const removeTriggered = useCallback((id) => {
    deleteTriggered?.(id)
  }, [deleteTriggered])

  const openAlertToken = useCallback((a) => {
    if (!a.tokenAddress) return
    selectToken?.({
      address: a.tokenAddress,
      networkId: a.networkId || 1,
      symbol: a.symbol || (a.name || '').split(' ')[0] || '',
    }, 'mobile-alerts')
  }, [selectToken])

  const list = Array.isArray(rules) && rules.length > 0
    ? rules.filter(r => r.type === 'price' || r.type === 'pct')
    : (Array.isArray(alerts) ? alerts : [])
  const trigList = Array.isArray(triggered) ? triggered : []

  if (list.length === 0 && trigList.length === 0) {
    return (
      <div className="mal mal--empty">
        <div className="mal-empty-icon"><Bell size={26} strokeWidth={1.6} /></div>
        <p className="mal-empty-title">No price alerts yet</p>
        <p className="mal-empty-sub">Open any token and set an alert from its page — triggers land here and as notifications. Sign in to sync them.</p>
        <button type="button" className="mal-empty-btn" onClick={onGoScreener}>Find a token</button>
      </div>
    )
  }

  return (
    <div className="mal">
      <div className="mal-head">
        <span className="mal-title">Alerts</span>
        <span className="mal-count">{list.filter(a => a.status !== 'paused').length}</span>
        {pushStatus && pushStatus !== 'unsupported' && pushStatus !== 'ios-needs-install' && (
          <button
            type="button"
            className={`mal-push-toggle${pushStatus === 'granted-subscribed' ? ' is-on' : ''}`}
            onClick={togglePush}
            disabled={pushBusy || pushStatus === 'denied'}
            title={pushStatus === 'denied' ? 'Notifications blocked in browser settings' : (pushStatus === 'granted-subscribed' ? 'Turn off push notifications' : 'Turn on push notifications')}
            aria-label="Toggle push notifications"
          >
            <BellRing size={16} strokeWidth={2} />
          </button>
        )}
      </div>
      {pushStatus === 'ios-needs-install' && (
        <div className="mal-push-hint">Add Spectre to your Home Screen (Share - Add to Home Screen) to enable push notifications for alerts.</div>
      )}

      {(tgStatus === 'unlinked' || tgStatus === 'waiting' || tgStatus === 'linked') && (
        <div className="mal-tg-row">
          <span className="mal-tg-icon"><TelegramGlyph size={14} /></span>
          {tgStatus === 'linked' && (
            <>
              <span className="mal-tg-status">Telegram connected</span>
              <button type="button" className="mal-tg-disconnect" onClick={disconnectTelegram}>Disconnect</button>
            </>
          )}
          {tgStatus === 'waiting' && (
            <span className="mal-tg-status">Waiting for Telegram...</span>
          )}
          {tgStatus === 'unlinked' && (
            <>
              <button type="button" className="mal-tg-btn" onClick={connectTelegram}>Connect Telegram</button>
              {tgError && <span className="mal-tg-error">Could not start linking - try again.</span>}
            </>
          )}
        </div>
      )}

      {trigList.length > 0 && (
        <div className="mal-section">
          <span className="mal-section-label">Triggered</span>
          {trigList.map(t => (
            <div key={t.id} className="mal-row mal-row--fired">
              <button type="button" className="mal-row-main" onClick={() => openAlertToken(t)}>
                <span className={`mal-dir ${t.direction === 'above' ? 'up' : 'down'}`}>
                  {t.direction === 'above' ? <ArrowUp size={14} strokeWidth={2.5} /> : <ArrowDown size={14} strokeWidth={2.5} />}
                </span>
                <span className="mal-body">
                  <span className="mal-name">{t.name || 'Price alert'}</span>
                  <span className="mal-cond">
                    {t.changePct != null
                      ? <>Moved {t.changePct > 0 ? '+' : ''}{t.changePct}% · hit {formatPrice(t.priceUsd)} · {relTime(t.triggeredAt)}</>
                      : <>Hit <b>{formatPrice(t.priceUsd)}</b> · {relTime(t.triggeredAt)}</>}
                  </span>
                </span>
              </button>
              <button type="button" className="mal-del" onClick={() => removeTriggered(t.id)} aria-label="Dismiss">
                <Trash2 size={16} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <div className="mal-section">
          {trigList.length > 0 && <span className="mal-section-label">Active</span>}
          <div className="mal-list">
            {list.map(a => {
              const isPct = a.type === 'pct'
              const paused = a.status === 'paused'
              const recurring = a.repeat === 'recurring'

              // pct rows: direction glyph is up/down/'both' (a ± text glyph);
              // price rows: unchanged above/below arrow logic.
              let dirClass, dirIcon, condNode
              if (isPct) {
                const pctDir = a.condition?.direction ?? 'both'
                const pctVal = a.condition?.pct
                const windowMin = a.condition?.windowMin
                const windowLabel = windowMin === 60 ? '1h' : '24h'
                const dirLabel = pctDir === 'up' ? '+' : pctDir === 'down' ? '-' : '±'
                dirClass = pctDir === 'up' ? 'up' : pctDir === 'down' ? 'down' : 'both'
                dirIcon = pctDir === 'up'
                  ? <ArrowUp size={14} strokeWidth={2.5} />
                  : pctDir === 'down'
                    ? <ArrowDown size={14} strokeWidth={2.5} />
                    : <span className="mal-dir-glyph">±</span>
                condNode = (
                  <span className="mal-cond">
                    <b>{dirLabel}{pctVal}%</b> in {windowLabel}
                  </span>
                )
              } else {
                const target = a.condition?.targetPrice ?? a.priceTarget
                const dir = a.condition?.direction ?? a.direction
                const above = dir === 'above'
                dirClass = above ? 'up' : 'down'
                dirIcon = above ? <ArrowUp size={14} strokeWidth={2.5} /> : <ArrowDown size={14} strokeWidth={2.5} />
                condNode = (
                  <span className="mal-cond">
                    {above ? 'Above' : 'Below'} <b>{formatPrice(target)}</b>
                  </span>
                )
              }

              const name = a.name || (isPct ? '% Move alert' : 'Price alert')

              return (
                <AlertRuleRow
                  key={a.id}
                  id={a.id}
                  name={name}
                  dirClass={dirClass}
                  dirIcon={dirIcon}
                  condNode={condNode}
                  recurring={recurring}
                  paused={paused}
                  busy={busyId === a.id}
                  hasPause={!!updateAlert}
                  coarsePointer={coarsePointer}
                  openSwipeId={openSwipeId}
                  setOpenSwipeId={setOpenSwipeId}
                  onOpenToken={() => openAlertToken({
                    tokenAddress: a.token?.address ?? a.tokenAddress,
                    networkId: a.token?.networkId ?? a.networkId,
                    symbol: a.token?.symbol ?? a.symbol,
                    name: a.name,
                  })}
                  onTogglePause={() => togglePauseRule(a)}
                  onDelete={() => remove(a.id)}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * AlertRuleRow — one active-rule row. Fine pointers render the row
 * exactly as before (always-visible Pause/Play + Delete, no touch
 * handlers). Touch-primary devices render a swipeable row: the row body
 * slides left on drag (mirrors MobileTokenRow.jsx's mrow-track technique -
 * touchstart/move/end into a clamped translateX, transition suspended
 * only while dragging) to reveal a 120px tray underneath holding the same
 * two actions.
 */
function AlertRuleRow({
  id,
  name,
  dirClass,
  dirIcon,
  condNode,
  recurring,
  paused,
  busy,
  hasPause,
  coarsePointer,
  openSwipeId,
  setOpenSwipeId,
  onOpenToken,
  onTogglePause,
  onDelete,
}) {
  const [dragDx, setDragDx] = useState(null)
  const startRef = useRef(null)
  const axisRef = useRef(null)
  const isOpen = openSwipeId === id

  // If this row unmounts while its tray is open (e.g. deleted from the
  // tray itself), clear the shared open-id so no other row inherits a
  // "stuck open" tray on the next render.
  useEffect(() => () => setOpenSwipeId((cur) => (cur === id ? null : cur)), [id, setOpenSwipeId])

  const rowContent = (
    <>
      <span className={`mal-dir ${dirClass}`}>{dirIcon}</span>
      <span className="mal-body">
        <span className="mal-name">{name}</span>
        {condNode}
        {recurring && <span className="mal-repeat"><Repeat size={11} strokeWidth={2.5} /> every time</span>}
        {paused && <span className="mal-paused">Paused</span>}
      </span>
    </>
  )

  if (!coarsePointer) {
    return (
      <div className={`mal-row${paused ? ' mal-row--paused' : ''}`}>
        <button type="button" className="mal-row-main" onClick={onOpenToken}>
          {rowContent}
        </button>
        {hasPause && (
          <button
            type="button"
            className="mal-pause"
            disabled={busy}
            onClick={onTogglePause}
            aria-label={paused ? 'Resume alert' : 'Pause alert'}
          >
            {paused ? <Play size={15} strokeWidth={2} /> : <Pause size={15} strokeWidth={2} />}
          </button>
        )}
        <button
          type="button"
          className="mal-del"
          disabled={busy}
          onClick={onDelete}
          aria-label={`Delete alert ${name || ''}`}
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      </div>
    )
  }

  const handleTouchStart = (e) => {
    const t = e.touches?.[0]
    if (!t) return
    startRef.current = { x: t.clientX, y: t.clientY, base: isOpen ? -SWIPE_TRAY_W : 0 }
    axisRef.current = null
  }

  const handleTouchMove = (e) => {
    const s = startRef.current
    const t = e.touches?.[0]
    if (!s || !t) return
    const mx = t.clientX - s.x
    const my = t.clientY - s.y
    if (!axisRef.current) {
      // horizontal intent: leftward beyond a small deadzone and dominant
      // over vertical movement — never engage on a vertical scroll.
      if (mx < -10 && Math.abs(mx) > Math.abs(my)) axisRef.current = 'h'
      else if (Math.abs(my) > 10) axisRef.current = 'v'
    }
    if (axisRef.current !== 'h') return
    const raw = s.base + mx
    setDragDx(Math.min(0, Math.max(-SWIPE_TRAY_W, raw)))
  }

  const handleTouchEnd = () => {
    if (dragDx == null) { startRef.current = null; axisRef.current = null; return }
    setOpenSwipeId(dragDx < SWIPE_OPEN_AT ? id : null)
    setDragDx(null)
    startRef.current = null
    axisRef.current = null
  }

  const handleRowClick = () => {
    // a tap while ANY tray is open only closes it — never navigates, even
    // when the tap lands on the row whose tray is open.
    if (openSwipeId != null) { setOpenSwipeId(null); return }
    onOpenToken()
  }

  const handleTrayPause = () => { setOpenSwipeId(null); onTogglePause() }
  const handleTrayDelete = () => { setOpenSwipeId(null); onDelete() }

  return (
    <div className={`mal-row mal-row--swipeable${paused ? ' mal-row--paused' : ''}`}>
      <div className="mal-swipe-tray" aria-hidden={!isOpen && dragDx == null}>
        {hasPause && (
          <button
            type="button"
            className="mal-tray-btn mal-tray-btn--pause"
            disabled={busy}
            onClick={handleTrayPause}
            aria-label={paused ? 'Resume alert' : 'Pause alert'}
          >
            {paused ? <Play size={16} strokeWidth={2} /> : <Pause size={16} strokeWidth={2} />}
          </button>
        )}
        <button
          type="button"
          className={`mal-tray-btn mal-tray-btn--delete${hasPause ? '' : ' mal-tray-btn--full'}`}
          disabled={busy}
          onClick={handleTrayDelete}
          aria-label={`Delete alert ${name || ''}`}
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      </div>
      <button
        type="button"
        className="mal-row-main mal-row-main--swipe"
        style={
          dragDx != null
            ? { transform: `translateX(${dragDx}px)`, transition: 'none' }
            : (isOpen ? { transform: `translateX(-${SWIPE_TRAY_W}px)` } : undefined)
        }
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={handleRowClick}
      >
        {rowContent}
      </button>
    </div>
  )
}
