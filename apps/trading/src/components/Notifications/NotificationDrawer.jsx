/**
 * NotificationDrawer - desktop notification centre (prefix nd-).
 *
 * Right-side overlay over the app, including the swap panel - hence the scrim,
 * so the state reads as "a panel is open" rather than "the layout moved".
 * Closes on Esc, scrim click, and the close button.
 *
 * Read + manage only. Creation stays on the token page (AlertButton), the same
 * split the mobile Alerts tab uses.
 */

import React, { useEffect, useCallback, useRef, useState } from 'react'
import { Bell, X, ArrowUp, ArrowDown, Trash2, Pause, Play, Repeat } from 'lucide-react'
import { usePrivySafe as usePrivy } from '../../lib/use-privy-safe'
import { formatPrice } from '../../services/codexApi'
import NotificationChannels from './NotificationChannels'
import './NotificationDrawer.css'

const relTime = (ts) => {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function NotificationDrawer({
  open,
  onClose,
  rules,
  alerts,
  triggered,
  seenTs,
  updateAlert,
  deleteAlert,
  deleteTriggered,
  onSelectToken,
  onGoScreener,
}) {
  const { authenticated, login } = usePrivy()
  const [busyId, setBusyId] = useState(null)
  const closeBtnRef = useRef(null)
  const prevFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // M5: land focus on the close button when the drawer opens (aria-modal
  // needs an initial focus target), restore it to whatever opened the
  // drawer on close. Not a full focus trap - Esc/scrim/close already cover
  // exit, this only handles where focus starts and where it goes back to.
  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement
    closeBtnRef.current?.focus()
    return () => {
      const el = prevFocusRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open])

  const togglePause = useCallback(async (rule) => {
    const paused = rule.status === 'paused'
    setBusyId(rule.id)
    try { await updateAlert(rule.id, { status: paused ? 'active' : 'paused' }) }
    catch { /* row stays as-is; the next poll reconciles */ }
    finally { setBusyId(null) }
  }, [updateAlert])

  const remove = useCallback(async (id) => {
    setBusyId(id)
    try { await deleteAlert(id) } finally { setBusyId(null) }
  }, [deleteAlert])

  if (!open) return null

  // Prefer the v2 rules list; fall back to the legacy alerts array, exactly as
  // MobileAlertsScreen does, so both surfaces show the same set.
  const list = Array.isArray(rules) && rules.length > 0
    ? rules.filter(r => r.type === 'price' || r.type === 'pct')
    : (Array.isArray(alerts) ? alerts : [])
  const trigList = Array.isArray(triggered) ? triggered : []
  const activeCount = list.filter(r => r.status !== 'paused').length

  return (
    <>
      <div className="nd-scrim" onClick={onClose} />
      <aside className="nd" role="dialog" aria-label="Notifications" aria-modal="true">
        <header className="nd-head">
          <span className="nd-title">Notifications</span>
          {authenticated && activeCount > 0 && <span className="nd-count">{activeCount}</span>}
          <button type="button" className="nd-close" ref={closeBtnRef} onClick={onClose} aria-label="Close notifications">
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        {!authenticated ? (
          <div className="nd-signin">
            <div className="nd-signin-icon"><Bell size={24} strokeWidth={1.5} /></div>
            <p className="nd-signin-title">Price alerts</p>
            <p className="nd-signin-sub">
              Set a price or market-cap target on any token and Spectre tells you when it hits -
              in your browser and on Telegram, even when the app is closed.
            </p>
            <button type="button" className="nd-signin-btn" onClick={() => { try { login() } catch { /* modal already open */ } }}>
              Sign in
            </button>
          </div>
        ) : (list.length === 0 && trigList.length === 0) ? (
          <div className="nd-empty">
            <div className="nd-empty-icon"><Bell size={22} strokeWidth={1.6} /></div>
            <p className="nd-empty-title">No alerts yet</p>
            <p className="nd-empty-sub">Open any token and press the bell in its header to set one.</p>
            <button type="button" className="nd-empty-btn" onClick={onGoScreener}>Find a token</button>
          </div>
        ) : (
          <div className="nd-scroll">
            {trigList.length > 0 && (
              <section className="nd-section">
                <span className="nd-section-label">Triggered</span>
                {trigList.map(t => (
                  <div key={t.id} className={`nd-row${(t.triggeredAt || 0) > seenTs ? ' is-unseen' : ''}`}>
                    <button type="button" className="nd-row-main" onClick={() => onSelectToken(t)}>
                      <span className={`nd-dir ${t.direction === 'above' ? 'up' : 'down'}`}>
                        {t.direction === 'above'
                          ? <ArrowUp size={13} strokeWidth={2.5} />
                          : <ArrowDown size={13} strokeWidth={2.5} />}
                      </span>
                      <span className="nd-row-body">
                        <span className="nd-row-name">{t.name || 'Price alert'}</span>
                        <span className="nd-row-cond">
                          {t.changePct != null
                            ? <>Moved {t.changePct > 0 ? '+' : ''}{t.changePct}% &middot; hit {formatPrice(t.priceUsd)} &middot; {relTime(t.triggeredAt)}</>
                            : <>Hit <b>{formatPrice(t.priceUsd)}</b> &middot; {relTime(t.triggeredAt)}</>}
                        </span>
                      </span>
                    </button>
                    <button type="button" className="nd-row-btn" onClick={() => deleteTriggered(t.id)} aria-label="Dismiss">
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </section>
            )}

            {list.length > 0 && (
              <section className="nd-section">
                <span className="nd-section-label">Active</span>
                {list.map(a => {
                  const isPct = a.type === 'pct'
                  const paused = a.status === 'paused'
                  const pctDir = a.condition?.direction ?? 'both'
                  // v2 rules keep direction/target under `condition`; only the
                  // legacy `alerts[]` shape has them at the top level. Fall
                  // back the same way MobileAlertsScreen.jsx does, or a v2
                  // price rule renders "↓ Below $0.00" for every alert.
                  const priceDir = a.condition?.direction ?? a.direction
                  const priceTargetVal = a.condition?.targetPrice ?? a.priceTarget
                  const dirClass = isPct
                    ? (pctDir === 'up' ? 'up' : pctDir === 'down' ? 'down' : 'both')
                    : (priceDir === 'above' ? 'up' : 'down')
                  const windowLabel = a.condition?.windowMin === 60 ? '1h' : '24h'
                  return (
                    <div key={a.id} className={`nd-row${paused ? ' is-paused' : ''}`}>
                      <span className={`nd-dir ${dirClass}`}>
                        {isPct
                          ? (pctDir === 'up' ? <ArrowUp size={13} strokeWidth={2.5} />
                            : pctDir === 'down' ? <ArrowDown size={13} strokeWidth={2.5} />
                            : <span className="nd-dir-glyph">&plusmn;</span>)
                          : (priceDir === 'above' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />)}
                      </span>
                      <span className="nd-row-body">
                        <span className="nd-row-name">
                          {a.name || (isPct ? '% Move alert' : 'Price alert')}
                          {a.repeat === 'recurring' && (
                            <span className="nd-repeat" title="Repeats"><Repeat size={11} strokeWidth={2.2} /></span>
                          )}
                        </span>
                        <span className="nd-row-cond">
                          {isPct
                            ? <>Moves {pctDir === 'both' ? '' : pctDir === 'up' ? 'up ' : 'down '}{a.condition?.pct}% in {windowLabel}</>
                            : <>{priceDir === 'above' ? 'Above' : 'Below'} <b>{formatPrice(priceTargetVal)}</b></>}
                          {paused && ' · paused'}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="nd-row-btn"
                        onClick={() => togglePause(a)}
                        disabled={busyId === a.id}
                        aria-label={paused ? 'Resume alert' : 'Pause alert'}
                      >
                        {paused ? <Play size={15} strokeWidth={2} /> : <Pause size={15} strokeWidth={2} />}
                      </button>
                      <button
                        type="button"
                        className="nd-row-btn"
                        onClick={() => remove(a.id)}
                        disabled={busyId === a.id}
                        aria-label="Delete alert"
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </div>
                  )
                })}
              </section>
            )}
          </div>
        )}

        {authenticated && <NotificationChannels />}
      </aside>
    </>
  )
}
