import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { getWhatIf, setWhatIf } from '@/services/rzLocalStorage'
import './rz-whatif.css'

const PRESETS = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6m',  days: 180 },
  { label: '1y',  days: 365 },
  { label: '2y',  days: 730 },
]

function fmtUsd(value) {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

function fmtTokenAmount(amount) {
  if (!Number.isFinite(amount)) return '—'
  if (amount >= 1) return amount.toFixed(4)
  return amount.toFixed(8)
}

export default function RzWhatIf({ symbol, currentPrice, cgId, fmtPrice }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('1000')
  const [days, setDays] = useState(30)
  const [historicPrice, setHistoricPrice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [popPos, setPopPos] = useState({ top: 0, left: 0 })
  const popoverRef = useRef(null)
  const triggerRef = useRef(null)

  // Position popover anchored under the trigger; clamp to viewport
  useLayoutEffect(() => {
    if (!open) return
    const compute = () => {
      const t = triggerRef.current
      if (!t) return
      const rect = t.getBoundingClientRect()
      const popW = 320
      const margin = 8
      let left = rect.right - popW
      if (left < margin) left = margin
      if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin
      const top = rect.bottom + 8
      setPopPos({ top, left })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [open])

  // Restore last input
  useEffect(() => {
    if (!symbol) return
    const saved = getWhatIf(symbol)
    if (saved) {
      if (saved.amount != null) setAmount(String(saved.amount))
      if (saved.days != null) setDays(saved.days)
    }
  }, [symbol])

  // Persist inputs
  useEffect(() => {
    if (!symbol) return
    setWhatIf(symbol, { amount: Number(amount) || 0, days })
  }, [symbol, amount, days])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return
      if (triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Fetch historic price when popover opens or days change
  useEffect(() => {
    if (!open || !cgId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))
      .then(json => {
        if (cancelled) return
        const prices = json?.prices
        if (!Array.isArray(prices) || prices.length === 0) {
          setHistoricPrice(null)
          setError('No data')
          return
        }
        const first = prices[0]?.[1]
        setHistoricPrice(Number.isFinite(first) ? first : null)
      })
      .catch(err => {
        if (cancelled) return
        setHistoricPrice(null)
        setError(err.message || 'Failed to load')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, cgId, days])

  const result = useMemo(() => {
    const usd = Number(amount)
    if (!Number.isFinite(usd) || usd <= 0) return null
    if (!Number.isFinite(historicPrice) || historicPrice <= 0) return null
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null
    const tokens = usd / historicPrice
    const nowValue = tokens * currentPrice
    const profit = nowValue - usd
    const roiPct = (profit / usd) * 100
    return { tokens, nowValue, profit, roiPct }
  }, [amount, historicPrice, currentPrice])

  const isUp = result && result.profit >= 0
  const disabled = !cgId

  return (
    <div className="rz-whatif">
      <button
        ref={triggerRef}
        type="button"
        className={`rz-whatif-trigger${open ? ' rz-whatif-trigger--open' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={disabled ? 'Historical data unavailable' : 'What if you bought earlier?'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        {t('researchPro.whatif.rzwhatif.whatIf', "What if?")}
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="rz-whatif-popover"
          role="dialog"
          aria-label={t('researchPro.whatif.rzwhatif.ariaWhatIfCalculator', "What-if calculator")}
          style={{ top: popPos.top, left: popPos.left }}
        >
          <div className="rz-whatif-title">
            {t('researchPro.whatif.rzwhatif.ifIBought', "If I bought")} <span className="rz-whatif-symbol">{symbol}</span>
          </div>

          <div className="rz-whatif-row">
            <label className="rz-whatif-label">Amount (USD)</label>
            <div className="rz-whatif-input-wrap">
              <span className="rz-whatif-currency">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="1"
                step="any"
                className="rz-whatif-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="rz-whatif-row">
            <label className="rz-whatif-label">{t('researchPro.whatif.rzwhatif.timeAgo', "Time ago")}</label>
            <div className="rz-whatif-presets">
              {PRESETS.map(p => (
                <button
                  key={p.days}
                  type="button"
                  className={`rz-whatif-preset${days === p.days ? ' rz-whatif-preset--active' : ''}`}
                  onClick={() => setDays(p.days)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rz-whatif-result">
            {loading ? (
              <div className="rz-whatif-skeleton">
                <span className="rz-whatif-shimmer" />
                <span className="rz-whatif-shimmer" />
              </div>
            ) : error ? (
              <div className="rz-whatif-error">{t('researchPro.whatif.rzwhatif.couldnTLoadHistoricalPrice', "Couldn’t load historical price.")}</div>
            ) : result ? (
              <>
                <div className="rz-whatif-result-row">
                  <span className="rz-whatif-result-label">{t('researchPro.whatif.rzwhatif.tokensBought', "Tokens bought")}</span>
                  <span className="rz-whatif-result-value mono">{fmtTokenAmount(result.tokens)} <span className="rz-whatif-result-sym">{symbol}</span></span>
                </div>
                <div className="rz-whatif-result-row">
                  <span className="rz-whatif-result-label">{t('researchPro.whatif.rzwhatif.worthToday', "Worth today")}</span>
                  <span className="rz-whatif-result-value mono">{fmtUsd(result.nowValue)}</span>
                </div>
                <div className="rz-whatif-result-row rz-whatif-result-row--final">
                  <span className="rz-whatif-result-label">
                    {isUp ? 'Profit' : 'Loss'}
                  </span>
                  <span className={`rz-whatif-result-value rz-whatif-result-value--${isUp ? 'up' : 'down'} mono`}>
                    {isUp ? '+' : ''}{fmtUsd(result.profit)}
                    <span className="rz-whatif-roi">{isUp ? '+' : ''}{result.roiPct.toFixed(1)}%</span>
                  </span>
                </div>
                {Number.isFinite(historicPrice) && (
                  <div className="rz-whatif-meta">
                    Entry price ~ {fmtPrice ? fmtPrice(historicPrice) : `$${historicPrice.toFixed(4)}`}
                  </div>
                )}
              </>
            ) : (
              <div className="rz-whatif-error">{t('researchPro.whatif.rzwhatif.enterAnAmountToSeeTheRes', "Enter an amount to see the result.")}</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
