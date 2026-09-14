/**
 * AlertButton - Price alert bell icon for TokenBanner
 *
 * Click to set a price or market cap alert (above/below target).
 * Shows badge with active alert count for this token.
 * Dropdown rendered via portal to avoid TradingView iframe z-index issues.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { useTokenAlerts } from '../hooks/useAlerts'
import { useSharedTokenDetails } from '../contexts/TokenDetailsContext'
import { formatPrice, formatLargeNumber } from '../services/codexApi'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { useCopyToast } from '../App'
import { Bell, X } from 'lucide-react'

export default function AlertButton({ token, alerts, onCreateAlert, onDeleteAlert }) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState('above')
  const [mode, setMode] = useState('price') // 'price' | 'mcap'
  const [inputValue, setInputValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const buttonRef = useRef(null)
  const dropdownRef = useRef(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  const { authenticated, login } = usePrivy()
  const { triggerCopyToast } = useCopyToast()
  // Set when a signed-out user presses the gated create button - holds the
  // COMPLETE alert payload snapshotted at press time (not a flag). The
  // post-login effect below files exactly this object once Privy reports the
  // user signed in. It deliberately never re-reads live form state: the
  // dropdown can close (Privy's modal is a document.body sibling, not a
  // descendant of dropdownRef, so clicking anywhere inside it - the email
  // field, a social tile - trips the outside-click handler below and closes
  // the dropdown before auth resolves), the input can get cleared by the
  // open/mode effect, or the user can reopen with different values. None of
  // that should change what gets filed - the payload already has everything.
  const [pendingAlert, setPendingAlert] = useState(null)
  // I3: identity of the pendingAlert object currently being filed. Guards
  // against double-firing onCreateAlert if the effect below re-runs (e.g.
  // onCreateAlert/triggerCopyToast get a new identity) while the same
  // payload is still in flight - NOT a "cancelled" flag tied to the
  // effect's own cleanup, which is what made the success toast and error
  // surface unreachable before (see the effect's comment).
  const inFlightPendingRef = useRef(null)

  const tokenAlerts = useTokenAlerts(alerts, token?.address, token?.networkId)
  const hasAlerts = tokenAlerts.length > 0

  // Get live token data with circulatingSupply from shared context
  let liveData = null
  try { liveData = useSharedTokenDetails()?.tokenData } catch {}
  const currentPrice = parseFloat(liveData?.price || token?.price) || 0
  const circulatingSupply = parseFloat(liveData?.circulatingSupply || token?.circulatingSupply) || 0
  const currentMcap = parseFloat(liveData?.marketCap) || (currentPrice * circulatingSupply)

  // Close on outside click - check both button and portal dropdown
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      const inButton = buttonRef.current?.contains(e.target)
      const inDropdown = dropdownRef.current?.contains(e.target)
      if (!inButton && !inDropdown) setOpen(false)
    }
    // Use setTimeout to avoid the opening click triggering immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [open])

  // Clear input when opening or switching mode
  useEffect(() => {
    if (open) setInputValue('')
  }, [open, mode])

  // Close and clear when the token changes. TokenBanner is no longer remounted
  // per token (App.jsx dropped its `key`), so an open dropdown carrying a target
  // typed for token A would stay open - and handleCreate reads the CURRENT token
  // prop, so pressing Create would file token A's price against token B.
  const alertTokenKey = `${token?.networkId ?? ''}:${token?.address || token?.symbol || ''}`
  useEffect(() => {
    setOpen(false)
    setInputValue('')
    setError(null)
    // Drop any pending signed-out submission for the PREVIOUS token. If the
    // user walked away to another token before completing login, don't file
    // something for a token they may no longer be looking at.
    setPendingAlert(null)
  }, [alertTokenKey])

  // Convert mcap input to price for the Codex webhook
  const resolveTargetPrice = useCallback(() => {
    // Comma decimal separators (RU/EU keyboards) read as 0 via parseFloat - normalize.
    const cleaned = inputValue.trim().replace(/\s+/g, '').replace(',', '.').replace(/^\$/, '')
    if (mode === 'price') return parseFloat(cleaned) || 0
    // Parse mcap input (supports K, M, B suffixes)
    let raw = cleaned.toUpperCase()
    let multiplier = 1
    if (raw.endsWith('B')) { multiplier = 1e9; raw = raw.slice(0, -1) }
    else if (raw.endsWith('M')) { multiplier = 1e6; raw = raw.slice(0, -1) }
    else if (raw.endsWith('K')) { multiplier = 1e3; raw = raw.slice(0, -1) }
    const mcapTarget = parseFloat(raw) * multiplier
    if (!mcapTarget || circulatingSupply <= 0) return 0
    return mcapTarget / circulatingSupply
  }, [inputValue, mode, circulatingSupply])

  // The exact payload onCreateAlert expects, built from the CURRENT form
  // state. Shared by the authenticated path (called immediately) and the
  // signed-out path (snapshotted into pendingAlert and filed later, verbatim).
  const buildAlertPayload = useCallback((targetPrice) => {
    const label = mode === 'mcap'
      ? `${token.symbol} MCap ${direction} ${inputValue}`
      : `${token.symbol} ${direction} $${inputValue}`
    return {
      tokenAddress: token.address,
      networkId: token.networkId || 1,
      priceTarget: targetPrice,
      direction,
      name: label,
      // Extra metadata for notification display
      meta: {
        symbol: token.symbol,
        logo: token.logo,
        mode,
        displayValue: inputValue,
        currentPrice,
        currentMcap,
      },
    }
  }, [token, direction, mode, inputValue, currentPrice, currentMcap])

  const handleCreate = useCallback(async () => {
    const targetPrice = resolveTargetPrice()
    if (!targetPrice || !token?.address) return
    if (!authenticated) {
      // Snapshot the alert exactly as it stands right now, open Privy, and
      // let the post-login effect below file this SAME payload once
      // authenticated flips true - it will not re-read form state.
      setPendingAlert(buildAlertPayload(targetPrice))
      try { login() } catch { /* modal already open / privy not ready */ }
      return
    }
    setCreating(true)
    setError(null)
    try {
      await onCreateAlert(buildAlertPayload(targetPrice))
      setOpen(false)
      setInputValue('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }, [resolveTargetPrice, token, authenticated, login, buildAlertPayload, onCreateAlert])

  // Fires once, on the transition to authenticated, only if the user actually
  // pressed create while signed out. Files the SNAPSHOT captured at press
  // time - never consults open/inputValue/mode/direction, which may have
  // moved on by the time login resolves (the dropdown is very likely already
  // closed, since a click inside Privy's modal is an outside click to it).
  //
  // I3: this used to call setPendingAlert(null) synchronously inside the
  // effect, which changes `pendingAlert` (a dep), which means React runs
  // this effect's OWN cleanup on the very next commit - setting `cancelled`
  // true long before the network promise could settle. Both the success
  // toast and the .catch error surface were unreachable dead code: the
  // alert still got filed, but a failed POST gave the user nothing at all.
  // Fix: key completion off `inFlightPendingRef` (payload identity) instead
  // of the effect's per-run cleanup, and only clear `pendingAlert` once the
  // request actually settles (in `finally`). This still makes it impossible
  // to file the same payload twice (the ref guards re-entry), and the
  // effect is a no-op on unrelated re-renders (payload already in flight).
  useEffect(() => {
    if (!pendingAlert || !authenticated) return
    if (inFlightPendingRef.current === pendingAlert) return
    inFlightPendingRef.current = pendingAlert
    const payload = pendingAlert
    onCreateAlert(payload)
      .then(() => {
        // The dropdown that would normally show success is almost certainly
        // closed by now (see the effect comment above) - use the app's
        // existing toast so the user gets confirmation without it.
        triggerCopyToast?.('Price alert set')
      })
      .catch((err) => {
        // Surface the failure rather than swallow it silently: a closed
        // dropdown can't show `error`, so reopen it alongside setting it.
        setError(err.message)
        setOpen(true)
      })
      .finally(() => {
        if (inFlightPendingRef.current === payload) inFlightPendingRef.current = null
        setPendingAlert(null)
      })
  }, [pendingAlert, authenticated, onCreateAlert, triggerCopyToast])

  const currentDisplay = mode === 'price'
    ? formatPrice(currentPrice)
    : (currentMcap > 0 ? formatLargeNumber(currentMcap) : '-')

  return (
    <div className="alert-button-wrap">
      <button
        ref={buttonRef}
        className={`action-pill${hasAlerts ? ' has-alerts' : ''}${open ? ' active' : ''}`}
        onClick={() => {
          if (!open && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect()
            setMenuPos({ top: rect.bottom + 6, left: rect.left })
          }
          setOpen(!open)
        }}
        title={hasAlerts ? `${tokenAlerts.length} active alert${tokenAlerts.length > 1 ? 's' : ''}` : 'Set price alert'}
      >
        <Bell size={15} />
        {hasAlerts && <span className="alert-badge">{tokenAlerts.length}</span>}
      </button>

      {open && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="alert-dropdown"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="alert-dropdown-header">
            <span className="alert-dropdown-title">Price Alert</span>
            <span className="alert-dropdown-price">Current: {currentDisplay}</span>
          </div>

          {/* Price / MCap toggle */}
          <div className="alert-mode-toggle">
            <button
              className={`alert-mode-btn${mode === 'price' ? ' active' : ''}`}
              onClick={() => setMode('price')}
            >
              Price
            </button>
            <button
              className={`alert-mode-btn${mode === 'mcap' ? ' active' : ''}`}
              onClick={() => setMode('mcap')}
            >
              MCap
            </button>
          </div>

          {/* Above / Below toggle */}
          <div className="alert-direction-toggle">
            <button
              className={`alert-dir-btn${direction === 'above' ? ' active' : ''}`}
              onClick={() => setDirection('above')}
            >
              Above
            </button>
            <button
              className={`alert-dir-btn${direction === 'below' ? ' active' : ''}`}
              onClick={() => setDirection('below')}
            >
              Below
            </button>
          </div>

          <div className="alert-price-input-wrap">
            <span className="alert-price-prefix">{mode === 'price' ? '$' : 'MC'}</span>
            <input
              className="alert-price-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={mode === 'price' ? 'Target price' : 'e.g. 5M, 100K'}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          {mode === 'mcap' && (
            <div className="alert-mcap-hint">
              {resolveTargetPrice() > 0 ? `= ${formatPrice(resolveTargetPrice())} per token` : ''}
            </div>
          )}

          {error && <div className="alert-error">{error}</div>}

          <button
            className="alert-create-btn"
            onClick={handleCreate}
            disabled={creating || !inputValue}
          >
            {creating ? 'Creating...' : authenticated ? 'Set Alert' : 'Sign in to save'}
          </button>

          {tokenAlerts.length > 0 && (
            <div className="alert-active-list">
              <span className="alert-active-label">Active Alerts</span>
              {tokenAlerts.map(a => (
                <div key={a.id} className="alert-active-item">
                  <span className="alert-active-info">
                    {a.direction === 'above' ? '\u2191' : '\u2193'} ${a.priceTarget}
                  </span>
                  <button
                    className="alert-delete-btn"
                    onClick={() => onDeleteAlert(a.id)}
                    title="Remove alert"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
