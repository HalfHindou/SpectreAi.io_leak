/**
 * MobileAlertSheet - bottom-sheet price/mcap alert creation (prefix mals-).
 *
 * Same semantics as the desktop AlertButton: target by price or market cap
 * (K/M/B suffixes, converted to price via circulating supply), above/below,
 * once/recurring repeat, preset % chips, plus the token's active alerts with
 * edit and delete. Uses the shared createAlert / updateAlert / deleteAlert
 * from useAlerts (threaded from App.jsx).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react'
import { X, ArrowUp, ArrowDown, Repeat, Pencil } from 'lucide-react'
import { useTokenAlerts } from '../../hooks/useAlerts'
import { useSharedTokenDetails } from '../../contexts/TokenDetailsContext'
import { formatPrice, formatLargeNumber } from '../../services/codexApi'
import { usePrivySafe as usePrivy } from '../../lib/use-privy-safe'
import { getPushStatus, enablePush } from '../../services/pushService'
import './MobileAlertSheet.css'

// Price-mode preset chips: pct of live price ('2x' doubles it).
const PRESETS = [
  { label: '+5%', mult: 1.05 },
  { label: '+10%', mult: 1.10 },
  { label: '+25%', mult: 1.25 },
  { label: '-10%', mult: 0.90 },
  { label: '2x', mult: 2 },
]

// % Move mode preset chips (act as a radio - one active at a time).
const PCT_PRESETS = [5, 10, 25]

export default function MobileAlertSheet({ open, onClose, token, alerts, rules, createAlert, updateAlert, deleteAlert, initialPrice = 0 }) {
  const [alertType, setAlertType] = useState('target') // 'target' | 'pct'
  const [direction, setDirection] = useState('above')
  const [mode, setMode] = useState('price') // 'price' | 'mcap'
  const [inputValue, setInputValue] = useState('')
  const [windowMin, setWindowMin] = useState(60) // 60 | 1440 - pct mode only
  const [pctVal, setPctVal] = useState(10) // pct mode only
  const [pctDirection, setPctDirection] = useState('both') // 'up' | 'down' | 'both' - pct mode only
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(false)
  const [repeat, setRepeat] = useState('once')
  const [editingId, setEditingId] = useState(null)
  const { getAccessToken } = usePrivy()
  const [pushStatus, setPushStatus] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)

  // Drag-to-dismiss, matching the mfs-/mmk-/mss-/mwd- sheets: follow the
  // finger down from the grabber region (and the header - the 4px bar alone
  // is a miss on a phone) and close past the same 120px threshold.
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)

  const legacyTokenAlerts = useTokenAlerts(alerts, token?.address, token?.networkId)

  // Prefer `rules` for the mini-list — it carries pct rules too (the legacy
  // `alerts` list is price-only, so a fresh pct rule never appeared here and
  // showed a transient `↓ $0.00` ghost row). Falls back to the legacy list
  // when `rules` is empty (e.g. still loading, or a signed-out demo state).
  const tokenAddr = token?.address?.toLowerCase()
  const hasRules = Array.isArray(rules) && rules.length > 0
  const rulesForToken = hasRules
    ? rules.filter(r => (
        r.token?.address?.toLowerCase() === tokenAddr &&
        (r.token?.networkId == null || token?.networkId == null || r.token.networkId === token.networkId)
      ))
    : []
  const tokenAlerts = hasRules ? rulesForToken : legacyTokenAlerts

  let liveData = null
  try { liveData = useSharedTokenDetails()?.tokenData } catch { /* outside provider */ }
  const currentPrice = parseFloat(liveData?.price || token?.price) || 0
  const circulatingSupply = parseFloat(liveData?.circulatingSupply || token?.circulatingSupply) || 0
  const currentMcap = parseFloat(liveData?.marketCap) || (currentPrice * circulatingSupply)

  // startEdit sets `mode`/`alertType` (deps of the effect below) to prefill
  // the form - this ref lets that one reset be skipped so the prefilled
  // values survive.
  const skipResetRef = useRef(false)
  // Long-press prefill applies once per open session, not on every
  // alertType/mode change while the sheet stays open. Without this guard, a
  // user who long-presses (prefilled to target/price) then manually taps
  // "% Move" would re-trigger this effect (alertType is a dep) and - since
  // the initialPrice PROP is still >0 until the sheet closes - the effect
  // would force alertType back to 'target', fighting the user's own tap.
  const appliedPrefillRef = useRef(false)

  useEffect(() => {
    if (skipResetRef.current) { skipResetRef.current = false; return }
    if (open) {
      setInputValue(''); setError(null); setCreated(false); setPushStatus(null)
      setRepeat('once'); setEditingId(null)
      setWindowMin(60); setPctVal(10); setPctDirection('both')

      // Long-press-on-chart prefill (TradingChart's onAlertAtPrice, threaded
      // through MobileTokenPage). Applied AFTER the reset above so it
      // composes with it instead of racing it. currentPrice is read via
      // closure, not as a dep - it ticks live while the sheet is open and
      // must not keep re-firing this effect / re-wiping the form. Setting
      // alertType/mode here re-triggers this effect (they're deps) if they
      // weren't already target/price - skipResetRef swallows that one
      // re-run (mirrors startEdit's guard above) so the reset block doesn't
      // wipe the values just set.
      if (initialPrice > 0 && !appliedPrefillRef.current) {
        appliedPrefillRef.current = true
        if (alertType !== 'target' || mode !== 'price') skipResetRef.current = true
        setAlertType('target')
        setMode('price')
        setInputValue(initialPrice >= 1 ? initialPrice.toFixed(2) : initialPrice.toPrecision(4))
        setDirection(initialPrice >= currentPrice ? 'above' : 'below')
      }
    } else {
      appliedPrefillRef.current = false
    }
  }, [open, mode, alertType])

  const applyPreset = useCallback((p) => {
    if (!currentPrice) return
    const target = currentPrice * p.mult
    // Enough significant digits for micro-caps, trimmed for majors.
    const str = target >= 1 ? target.toFixed(2) : target.toPrecision(4)
    setInputValue(str)
    setDirection(p.mult >= 1 ? 'above' : 'below')
  }, [currentPrice])

  const startEdit = useCallback((a) => {
    const rule = (rules || []).find(r => r.id === a.id)
    const isPct = rule?.type === 'pct'
    const nextType = isPct ? 'pct' : 'target'
    const nextMode = rule?.condition?.mode || 'price'
    // Only arm the skip if setAlertType/setMode will actually change state -
    // if the alert being edited is already in the current type/mode, those
    // setters are no-ops and the reset effect (keyed on [open, mode, alertType])
    // never re-runs to consume the flag, which would otherwise stay stuck true
    // and swallow the NEXT real toggle.
    if (nextType !== alertType || nextMode !== mode) skipResetRef.current = true
    setEditingId(a.id)
    setAlertType(nextType)
    setRepeat(rule?.repeat || 'once')
    if (isPct) {
      setWindowMin(rule?.condition?.windowMin || 60)
      setPctVal(rule?.condition?.pct ?? 10)
      setPctDirection(rule?.condition?.direction || 'both')
    } else {
      setMode(nextMode)
      setDirection(rule?.condition?.direction || a.direction || 'above')
      setInputValue(rule?.condition?.displayValue || String(a.priceTarget || ''))
    }
    setCreated(false)
    setError(null)
  }, [rules, mode, alertType])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setInputValue('')
  }, [])

  // Resolve push status only after a successful create - never on open/mount.
  useEffect(() => {
    if (!created) return
    let cancelled = false
    getPushStatus().then(s => { if (!cancelled) setPushStatus(s) })
    return () => { cancelled = true }
  }, [created])

  const handleEnablePush = useCallback(async () => {
    setPushBusy(true)
    try {
      const ok = await enablePush(getAccessToken)
      setPushStatus(ok ? 'granted-subscribed' : await getPushStatus())
    } finally {
      setPushBusy(false)
    }
  }, [getAccessToken])

  // Own effect (not the reset block above) - that one is skipped by
  // skipResetRef on an edit/prefill re-run, and the drag must always start
  // from zero when the sheet reopens.
  useEffect(() => { if (open) setDragOffset(0) }, [open])

  // Escape to close - matches the sibling Mobile*Sheet convention.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const resolveTargetPrice = useCallback(() => {
    // iOS decimal keyboards emit a comma on RU/EU locales - parseFloat("0,43")
    // silently reads as 0, so normalize before parsing.
    const cleaned = inputValue.trim().replace(/\s+/g, '').replace(',', '.').replace(/^\$/, '')
    if (mode === 'price') return parseFloat(cleaned) || 0
    let raw = cleaned.toUpperCase()
    let multiplier = 1
    if (raw.endsWith('B')) { multiplier = 1e9; raw = raw.slice(0, -1) }
    else if (raw.endsWith('M')) { multiplier = 1e6; raw = raw.slice(0, -1) }
    else if (raw.endsWith('K')) { multiplier = 1e3; raw = raw.slice(0, -1) }
    const mcapTarget = parseFloat(raw) * multiplier
    if (!mcapTarget || circulatingSupply <= 0) return 0
    return mcapTarget / circulatingSupply
  }, [inputValue, mode, circulatingSupply])

  const handleCreate = useCallback(async () => {
    if (alertType === 'pct') {
      setCreating(true)
      setError(null)
      try {
        const label = `${token.symbol} ${pctDirection === 'up' ? '+' : pctDirection === 'down' ? '-' : '±'}${pctVal}% in ${windowMin === 60 ? '1h' : '24h'}`
        if (editingId) {
          await updateAlert(editingId, { windowMin, pct: pctVal, pctDirection, repeat, name: label })
          setEditingId(null)
          setCreated(true)
          return
        }
        await createAlert({
          type: 'pct',
          tokenAddress: token.address,
          networkId: token.networkId || 1,
          windowMin,
          pct: pctVal,
          pctDirection,
          repeat,
          name: label,
          meta: { symbol: token.symbol, logo: token.logo, mode: 'pct', displayValue: `${pctVal}%` },
        })
        setCreated(true)
      } catch (err) {
        setError(err.message)
      } finally {
        setCreating(false)
      }
      return
    }

    const targetPrice = resolveTargetPrice()
    if (!targetPrice || !token?.address) {
      // Never fail silently - say why the tap did nothing.
      setError(mode === 'mcap' && circulatingSupply <= 0
        ? 'Market cap target unavailable - unknown circulating supply for this token'
        : 'Enter a valid target, e.g. 0.045')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const label = mode === 'mcap'
        ? `${token.symbol} MCap ${direction} ${inputValue}`
        : `${token.symbol} ${direction} $${inputValue}`

      if (editingId) {
        await updateAlert(editingId, {
          priceTarget: targetPrice,
          direction,
          mode,
          displayValue: inputValue,
          repeat,
          name: label,
        })
        setEditingId(null)
        setCreated(true)
        setInputValue('')
        return
      }

      await createAlert({
        tokenAddress: token.address,
        networkId: token.networkId || 1,
        priceTarget: targetPrice,
        direction,
        name: label,
        repeat,
        meta: {
          symbol: token.symbol,
          logo: token.logo,
          mode,
          displayValue: inputValue,
          currentPrice,
          currentMcap,
          tokenAddress: token.address,
          networkId: token.networkId || 1,
        },
      })
      setCreated(true)
      setInputValue('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }, [alertType, windowMin, pctVal, pctDirection, resolveTargetPrice, token, direction, mode, inputValue, createAlert, currentPrice, currentMcap, circulatingSupply, editingId, updateAlert, repeat])

  if (!open) return null

  // A touch that starts on a control (close, cancel edit) is not a drag.
  const handleTouchStart = (e) => {
    if (e.target?.closest?.('button')) { startYRef.current = null; return }
    startYRef.current = e.touches?.[0]?.clientY ?? null
  }
  const handleTouchMove = (e) => {
    if (startYRef.current == null) return
    const dy = (e.touches?.[0]?.clientY ?? startYRef.current) - startYRef.current
    if (dy > 0) setDragOffset(dy)
  }
  const handleTouchEnd = () => {
    if (dragOffset > 120) onClose?.()
    else setDragOffset(0)
    startYRef.current = null
  }
  const dragHandlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  }

  const showMcap = alertType === 'target' && mode === 'mcap'
  const currentDisplay = showMcap
    ? (currentMcap > 0 ? formatLargeNumber(currentMcap) : '-')
    : formatPrice(currentPrice)

  // Live distance-to-target preview: works for both price and mcap targets
  // (the mcap target is already resolved to a per-token price).
  const targetPreview = alertType === 'target' ? resolveTargetPrice() : 0
  const distPct = targetPreview > 0 && currentPrice > 0
    ? ((targetPreview - currentPrice) / currentPrice) * 100
    : null

  return (
    <div className="mals-backdrop" onClick={onClose}>
      <div
        className="mals-sheet"
        onClick={(e) => e.stopPropagation()}
        // A running CSS animation's computed value BEATS an inline style, so
        // the entrance keyframe would pin the sheet and swallow the drag.
        // Drop it for the duration (same fix as mfs-/mmk-).
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, animation: 'none' } : undefined}
      >
        <div className="mals-grabber-region" {...dragHandlers}>
          <div className="mals-grabber" aria-hidden="true" />
        </div>
        <div className="mals-head" {...dragHandlers}>
          {token?.logo ? (
            <img className="mals-tok-logo" src={token.logo} alt="" loading="lazy" decoding="async" width="30" height="30" />
          ) : (
            <div className="mals-tok-logo mals-tok-logo--fb">{(token?.symbol || '?').slice(0, 1)}</div>
          )}
          <div className="mals-head-col">
            <span className="mals-title">{token?.symbol || 'Token'}</span>
            <span className="mals-head-sub">{editingId ? 'Edit alert' : 'Price alert'}</span>
          </div>
          {editingId && (
            <button type="button" className="mals-cancel" onClick={cancelEdit}>Cancel</button>
          )}
          <span className="mals-current">
            <i>{showMcap ? 'MC' : 'PRICE'}</i>
            <b>{currentDisplay}</b>
          </span>
          <button type="button" className="mals-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mals-toggle mals-toggle--type">
          <button type="button" className={`mals-toggle-btn${alertType === 'target' ? ' active' : ''}`} onClick={() => setAlertType('target')}>Price target</button>
          <button type="button" className={`mals-toggle-btn${alertType === 'pct' ? ' active' : ''}`} onClick={() => setAlertType('pct')}>% Move</button>
        </div>

        {alertType === 'target' && (
          <>
            <div className="mals-seg mals-seg--row">
              <span className="mals-seg-label">Target</span>
              <div className="mals-toggle mals-toggle--mini">
                <button type="button" className={`mals-toggle-btn${mode === 'price' ? ' active' : ''}`} onClick={() => setMode('price')}>Price</button>
                <button type="button" className={`mals-toggle-btn${mode === 'mcap' ? ' active' : ''}`} onClick={() => setMode('mcap')}>MCap</button>
              </div>
            </div>

            <div className="mals-input-wrap">
              <span className="mals-input-prefix">{mode === 'price' ? '$' : 'MC'}</span>
              <input
                className="mals-input"
                type="text"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={mode === 'price' ? 'Target price' : 'e.g. 5M, 100K'}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>

            {mode === 'price' && currentPrice > 0 && (
              <div className="mals-presets">
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={`mals-preset ${p.mult >= 1 ? 'mals-preset--up' : 'mals-preset--down'}`}
                    onClick={() => applyPreset(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {distPct != null && (
              <div className="mals-hint">
                {mode === 'mcap' && <span>= {formatPrice(targetPreview)} per token · </span>}
                <b className={distPct >= 0 ? 'up' : 'down'}>
                  {distPct >= 0 ? '+' : ''}{Math.abs(distPct) >= 100 ? distPct.toFixed(0) : distPct.toFixed(1)}% from current
                </b>
              </div>
            )}

            <div className="mals-seg mals-seg--row">
              <span className="mals-seg-label">Direction</span>
              <div className="mals-toggle mals-toggle--mini">
                <button type="button" className={`mals-toggle-btn mals-toggle-btn--up${direction === 'above' ? ' active' : ''}`} onClick={() => setDirection('above')}>
                  <ArrowUp size={12} strokeWidth={2.5} /> Above
                </button>
                <button type="button" className={`mals-toggle-btn mals-toggle-btn--down${direction === 'below' ? ' active' : ''}`} onClick={() => setDirection('below')}>
                  <ArrowDown size={12} strokeWidth={2.5} /> Below
                </button>
              </div>
            </div>
          </>
        )}

        {alertType === 'pct' && (
          <>
            <div className="mals-seg mals-seg--row">
              <span className="mals-seg-label">Window</span>
              <div className="mals-toggle mals-toggle--mini">
                <button type="button" className={`mals-toggle-btn${windowMin === 60 ? ' active' : ''}`} onClick={() => setWindowMin(60)}>1h</button>
                <button type="button" className={`mals-toggle-btn${windowMin === 1440 ? ' active' : ''}`} onClick={() => setWindowMin(1440)}>24h</button>
              </div>
            </div>

            <div className="mals-seg mals-seg--row">
              <span className="mals-seg-label">Change</span>
              <div className="mals-presets">
                {PCT_PRESETS.map(p => (
                  <button key={p} type="button" className={`mals-preset${pctVal === p ? ' active' : ''}`} onClick={() => setPctVal(p)}>
                    {p}%
                  </button>
                ))}
              </div>
            </div>

            <div className="mals-seg mals-seg--row">
              <span className="mals-seg-label">Direction</span>
              <div className="mals-toggle mals-toggle--mini">
                <button type="button" className={`mals-toggle-btn mals-toggle-btn--up${pctDirection === 'up' ? ' active' : ''}`} onClick={() => setPctDirection('up')}>Rise</button>
                <button type="button" className={`mals-toggle-btn mals-toggle-btn--down${pctDirection === 'down' ? ' active' : ''}`} onClick={() => setPctDirection('down')}>Drop</button>
                <button type="button" className={`mals-toggle-btn${pctDirection === 'both' ? ' active' : ''}`} onClick={() => setPctDirection('both')}>Both</button>
              </div>
            </div>
          </>
        )}

        <div className="mals-seg mals-seg--row">
          <span className="mals-seg-label">Repeat</span>
          <div className="mals-toggle mals-toggle--mini">
            <button type="button" className={`mals-toggle-btn${repeat === 'once' ? ' active' : ''}`} onClick={() => setRepeat('once')}>Once</button>
            <button type="button" className={`mals-toggle-btn${repeat === 'recurring' ? ' active' : ''}`} onClick={() => setRepeat('recurring')}>
              <Repeat size={12} strokeWidth={2.5} /> Every time
            </button>
          </div>
        </div>

        {error && <div className="mals-error">{error}</div>}
        {created && (
          <div className="mals-created">
            {alertType === 'pct' ? 'Alert set - checks every 10 minutes.' : 'Alert set - it will land in the Alerts tab when it triggers.'}
          </div>
        )}

        {created && pushStatus === 'ios-needs-install' && (
          <div className="mals-push-hint">To get alerts when the app is closed, add Spectre to your Home Screen (Share - Add to Home Screen), then enable notifications here.</div>
        )}
        {created && (pushStatus === 'default' || pushStatus === 'granted-unsubscribed') && (
          <button type="button" className="mals-push-btn" onClick={handleEnablePush} disabled={pushBusy}>
            {pushBusy ? 'Enabling...' : 'Notify me when it triggers'}
          </button>
        )}
        {created && pushStatus === 'granted-subscribed' && (
          <div className="mals-push-hint mals-push-hint--on">Push notifications are on.</div>
        )}

        <button type="button" className="mals-create" onClick={handleCreate} disabled={alertType === 'pct' ? creating : (creating || !inputValue)}>
          {creating
            ? (editingId ? 'Saving...' : 'Creating...')
            : (editingId ? 'Save changes' : 'Set Alert')}
        </button>

        {tokenAlerts.length > 0 && (
          <div className="mals-active">
            <span className="mals-active-label">Active alerts</span>
            {tokenAlerts.map(a => {
              const isPct = a.type === 'pct'
              const paused = a.status === 'paused'
              let dirClass = 'up'
              let dirGlyph = null
              let condLabel
              if (isPct) {
                const pctDir = a.condition?.direction ?? 'both'
                const pctVal = a.condition?.pct
                const windowMin = a.condition?.windowMin
                const sign = pctDir === 'up' ? '+' : pctDir === 'down' ? '-' : '±'
                dirClass = pctDir === 'up' ? 'up' : pctDir === 'down' ? 'down' : 'both'
                dirGlyph = <span className="mals-arr-glyph">%</span>
                condLabel = `${sign}${pctVal}% in ${windowMin === 60 ? '1h' : '24h'}`
              } else {
                const target = a.condition?.targetPrice ?? a.priceTarget
                const dir = a.condition?.direction ?? a.direction
                dirClass = dir === 'above' ? 'up' : 'down'
                dirGlyph = dir === 'above'
                  ? <ArrowUp size={12} strokeWidth={2.5} />
                  : <ArrowDown size={12} strokeWidth={2.5} />
                // MCap targets read as the mcap the user typed, not the
                // converted per-token price (which looks like noise).
                condLabel = (a.condition?.mode === 'mcap' && a.condition?.displayValue)
                  ? `MC ${String(a.condition.displayValue).toUpperCase()}`
                  : formatPrice(target)
              }
              return (
                <div key={a.id} className={`mals-active-row${a.id === editingId ? ' mals-active-row--editing' : ''}${paused ? ' mals-active-row--paused' : ''}`}>
                  <span className={`mals-arr ${dirClass}`}>{dirGlyph}</span>
                  <span className="mals-active-cond">{condLabel}</span>
                  {a.repeat === 'recurring' && <Repeat size={11} strokeWidth={2.5} className="mals-active-rep" />}
                  {paused && <span className="mals-active-paused">Paused</span>}
                  <span className="mals-active-spacer" />
                  <button type="button" className="mals-active-edit" onClick={() => startEdit(a)} aria-label="Edit alert">
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="mals-active-del" onClick={() => deleteAlert(a.id)} aria-label="Remove alert">
                    <X size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
