/**
 * ROI Calculator – current price vs ATH, amount input, value at ATH.
 * Opened from header % button. Uses CoinGecko search + coin market data.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { searchCoinsForROI, getCoinROIData } from '@/services/coinGeckoApi'
import { useCurrency } from '@/hooks/useCurrency'
import spectreIcons from '@/icons/spectreIcons'
import MarketCapCompare from './market-cap-compare'
import TimeMachine from './time-machine'
import RoiPriceChart from './roi-price-chart'
import './roi-calculator.css'
import './roi-calculator.mobile.css'
import './market-cap-compare.css'
import './time-machine.css'
import './roi-price-chart.css'
import './roi-controls-polish.css'

/**
 * Gate for the below-fold analysis column (chart / market-cap compare /
 * time-machine) so its three fetches never run before a project is chosen.
 *
 * 🪤 This used to be an IntersectionObserver with a `rootMargin` pre-load
 * cushion, and on mobile that gate COULD NOT pre-fire at any margin:
 * `rootMargin` expands the observer's ROOT (the viewport), not the
 * intermediate clipping ancestors, and on mobile `.app` is itself the
 * scroller — so everything below its bottom edge is clipped out of the
 * intersection rect no matter how large the margin. Measured with a 600px
 * margin: the column sat at y=982 with the viewport at 664 and still never
 * fired until a real scroll. The result was that the whole analysis mounted
 * mid-flick and the document tripled under the user's thumb (1114 → 3191 →
 * 3746 → 4374px across four jolts inside ~1.2s), which is the "scrolling
 * issues up down and at some point the app goes wonky" report (08-12).
 *
 * Picking a project IS the intent to see the analysis, so latch on the coin
 * instead — one idle tick after it lands, so it never competes with the
 * main-column paint. Nothing fetches before a project is chosen, which is
 * what the observer was actually protecting.
 */
function useAnalysisGate(coinData) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!coinData) { setReady(false); return undefined }
    const arm = () => setReady(true)
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(arm, { timeout: 1200 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(arm, 300)
    return () => clearTimeout(id)
  }, [coinData])
  return ready
}

function formatROIPct(roi) {
  if (roi == null || Number.isNaN(roi)) return '-'
  const n = Number(roi)
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function formatAthDate(athDate) {
  if (!athDate) return ''
  try {
    const d = new Date(athDate)
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  } catch (_) {
    return ''
  }
}

function formatTokenAmount(n) {
  if (!n || !Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  if (abs >= 0.01) return n.toFixed(4)
  if (abs >= 0.0001) return n.toFixed(6)
  return n.toExponential(2)
}

function trimNumberForInput(n) {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  let decimals
  if (abs >= 1000) decimals = 2
  else if (abs >= 1) decimals = 4
  else if (abs >= 0.01) decimals = 6
  else decimals = 8
  return Number(n.toFixed(decimals)).toString()
}

function ROICalculator({ onClose, dayMode, embedded = false }) {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [selected, setSelected] = useState(null)
  const [coinData, setCoinData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState(1000)
  const [unit, setUnit] = useState('usd')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [whatIfMode, setWhatIfMode] = useState('price') // 'price' | 'multiplier' | 'mcap'
  const [whatIfValue, setWhatIfValue] = useState('')
  const inputRef = useRef(null)
  const listRef = useRef(null)
  // The analysis column mounts once a project is chosen — see useAnalysisGate.
  const sideReady = useAnalysisGate(coinData)

  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.length < 1) {
      setSuggestions([])
      return
    }
    const list = await searchCoinsForROI(q)
    setSuggestions(list)
    setShowSuggestions(true)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => fetchSuggestions(query), 200)
    return () => clearTimeout(t)
  }, [query, fetchSuggestions])

  const selectCoin = useCallback(async (item) => {
    if (!item?.id) return
    setSelected(item)
    setQuery(`${item.name || ''} (${item.symbol || ''})`)
    setShowSuggestions(false)
    setSuggestions([])
    setLoading(true)
    setCoinData(null)
    setUnit('usd')
    try {
      const data = await getCoinROIData(item.id)
      setCoinData(data)
    } catch (_) {
      setCoinData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (showSuggestions) setShowSuggestions(false)
        else onClose?.()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, showSuggestions])

  const currentPrice = coinData?.currentPrice
  const marketCap = coinData?.marketCap
  const athPrice = coinData?.athPrice
  const athDate = coinData?.athDate
  const roiPct = currentPrice != null && currentPrice > 0 && athPrice != null
    ? ((athPrice / currentPrice) - 1) * 100
    : null
  const amountNum = Number(amount) || 0
  const hasPrice = currentPrice != null && currentPrice > 0
  const tokenSymbol = selected?.symbol?.toUpperCase() || ''
  const tokenUnitActive = unit === 'token' && hasPrice
  const usdAmount = tokenUnitActive ? amountNum * currentPrice : amountNum
  const tokenAmount = tokenUnitActive ? amountNum : (hasPrice ? amountNum / currentPrice : 0)
  const valueAtAth = roiPct != null && usdAmount > 0
    ? usdAmount * (1 + roiPct / 100)
    : null

  const switchUnit = useCallback((next) => {
    if (next === unit) return
    if (!hasPrice) {
      setUnit(next)
      return
    }
    const n = Number(amount) || 0
    if (n > 0) {
      const converted = next === 'token' ? n / currentPrice : n * currentPrice
      setAmount(trimNumberForInput(converted))
    }
    setUnit(next)
  }, [unit, amount, currentPrice, hasPrice])

  const isStablecoin = selected && ['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'FRAX', 'LUSD', 'GUSD'].includes(selected.symbol?.toUpperCase())

  // "What if" scenario: user picks a target price / multiplier / market cap and
  // we project token amount value + ROI at that target.
  const whatIfNum = Number(whatIfValue)
  const whatIfTargetPrice = (() => {
    if (!hasPrice || !Number.isFinite(whatIfNum) || whatIfNum <= 0) return null
    if (whatIfMode === 'price') return whatIfNum
    if (whatIfMode === 'multiplier') return currentPrice * whatIfNum
    if (whatIfMode === 'mcap' && marketCap > 0) return currentPrice * (whatIfNum / marketCap)
    return null
  })()
  const whatIfValueAtTarget = whatIfTargetPrice != null && tokenAmount > 0
    ? tokenAmount * whatIfTargetPrice
    : null
  const whatIfMultiplier = whatIfTargetPrice != null && currentPrice > 0
    ? whatIfTargetPrice / currentPrice
    : null
  const whatIfPct = whatIfMultiplier != null ? (whatIfMultiplier - 1) * 100 : null
  const whatIfTargetMcap = whatIfTargetPrice != null && marketCap > 0 && currentPrice > 0
    ? marketCap * (whatIfTargetPrice / currentPrice)
    : null
  const whatIfIsLoss = whatIfPct != null && whatIfPct < 0

  const content = (
    <div className={`roi-calculator ${dayMode ? 'day-mode' : ''} ${embedded ? 'roi-calculator-embedded' : ''}`} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="ROI Calculator">
      {!embedded && <div className="roi-calculator-scrim" onClick={onClose} aria-hidden />}
      <div className="roi-calculator-glass">
        <div className="roi-calculator-header">
          <h2 className="roi-calculator-title">
            <span className="roi-calculator-title-icon-ring" aria-hidden>
              <span className="roi-calculator-title-icon">{spectreIcons.trending}</span>
            </span>
            {t('roi.title')}
          </h2>
          {!embedded && (
            <button
              type="button"
              className="roi-calculator-close"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="roi-calculator-body">
          <div className="roi-cic-main">
          <label className="roi-calculator-label">Project</label>
          <div className="roi-calculator-search-wrap">
            <span className="roi-calculator-search-icon" aria-hidden>{spectreIcons.search}</span>
            <input
              ref={inputRef}
              type="text"
              className="roi-calculator-input"
              placeholder="Search by name or symbol (e.g. Spectre, BTC)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              aria-autocomplete="list"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="roi-suggestions"
              id="roi-project-input"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="roi-suggestions"
                ref={listRef}
                className="roi-calculator-suggestions"
                role="listbox"
              >
                {suggestions.map((item, i) => (
                  <li
                    key={item.id || `roi-suggestion-${i}`}
                    role="option"
                    className="roi-calculator-suggestion-item"
                    onClick={() => selectCoin(item)}
                  >
                    <span className="roi-calculator-suggestion-name">{item.name ?? '-'}</span>
                    <span className="roi-calculator-suggestion-symbol">{item.symbol ?? '-'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {loading && (
            <p className="roi-calculator-loading">{t('common.loading')}</p>
          )}

          {coinData && !loading && (
            <>
              {isStablecoin && (
                <p className="roi-calculator-muted">Stablecoins have no meaningful ROI to ATH.</p>
              )}
              {!isStablecoin && (
                <>
                  <div className="roi-calculator-stats">
                    <div className="roi-calculator-stat">
                      <span className="roi-calculator-stat-label">{t('roi.currentPrice')}</span>
                      <span className="roi-calculator-stat-value">{fmtPrice(currentPrice)}</span>
                      <span className="roi-calculator-stat-mcap">{t('common.marketCap')} {fmtLarge(marketCap)}</span>
                    </div>
                    <div className="roi-calculator-stat">
                      <span className="roi-calculator-stat-label">{t('common.ath')}</span>
                      <span className="roi-calculator-stat-value">{fmtPrice(athPrice)}</span>
                      {athDate && <span className="roi-calculator-stat-date">{formatAthDate(athDate)}</span>}
                    </div>
                  </div>
                  {roiPct != null && (
                    <div className="roi-calculator-roi-line">
                      <span className="roi-calculator-roi-label">{t('roi.roiPercent')}</span>
                      <span className="roi-calculator-roi-value">{formatROIPct(roiPct)}</span>
                    </div>
                  )}

                  <div className="roi-calculator-amount-header">
                    <label className="roi-calculator-label" htmlFor="roi-amount-input">Your amount</label>
                    <div className="roi-calculator-unit-toggle" role="tablist" aria-label="Amount unit">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={unit === 'usd'}
                        className={`roi-calculator-unit-btn${unit === 'usd' ? ' is-active' : ''}`}
                        onClick={() => switchUnit('usd')}
                      >
                        USD
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={unit === 'token'}
                        className={`roi-calculator-unit-btn${unit === 'token' ? ' is-active' : ''}`}
                        onClick={() => switchUnit('token')}
                        disabled={!hasPrice}
                        title={!hasPrice ? 'Token price unavailable' : undefined}
                      >
                        {tokenSymbol || 'TOKEN'}
                      </button>
                    </div>
                  </div>
                  <input
                    id="roi-amount-input"
                    type="number"
                    className="roi-calculator-amount"
                    min={0}
                    step={tokenUnitActive ? 'any' : 1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={tokenUnitActive ? `e.g. 1 ${tokenSymbol}` : 'e.g. 1000'}
                    aria-label={`Amount in ${tokenUnitActive ? (tokenSymbol || 'tokens') : 'USD'} to calculate ROI`}
                  />
                  {amountNum > 0 && hasPrice && (
                    <div className="roi-calculator-amount-hint">
                      {tokenUnitActive
                        ? `≈ ${fmtPrice(usdAmount)}`
                        : `≈ ${formatTokenAmount(tokenAmount)} ${tokenSymbol}`}
                    </div>
                  )}
                  {amountNum > 0 && (
                    <div className="roi-calculator-result">
                      <div className="roi-calculator-result-row">
                        <span className="roi-calculator-result-label">You add now</span>
                        <span className="roi-calculator-result-amount">{fmtPrice(usdAmount)}</span>
                      </div>
                      {hasPrice && tokenAmount > 0 && (
                        <div className="roi-calculator-result-row roi-calculator-result-row-sub">
                          <span className="roi-calculator-result-label">Tokens</span>
                          <span className="roi-calculator-result-sub">{formatTokenAmount(tokenAmount)} {tokenSymbol}</span>
                        </div>
                      )}
                      {valueAtAth != null && (
                        <>
                          <div className="roi-calculator-result-row roi-calculator-result-row-ath">
                            <span className="roi-calculator-result-label">Value at ATH</span>
                            <span className="roi-calculator-result-value">{fmtPrice(valueAtAth)}</span>
                          </div>
                          <div className="roi-calculator-result-pct">{formatROIPct(roiPct)} ROI</div>
                        </>
                      )}
                    </div>
                  )}

                  {hasPrice && amountNum > 0 && (
                    <div className="roi-calculator-whatif">
                      <div className="roi-calculator-amount-header">
                        <label className="roi-calculator-label" htmlFor="roi-whatif-input">
                          What if {tokenSymbol || 'token'} hits…
                        </label>
                        <div className="roi-calculator-unit-toggle" role="tablist" aria-label="What if mode">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={whatIfMode === 'price'}
                            className={`roi-calculator-unit-btn${whatIfMode === 'price' ? ' is-active' : ''}`}
                            onClick={() => { setWhatIfMode('price'); setWhatIfValue('') }}
                          >
                            Price
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={whatIfMode === 'multiplier'}
                            className={`roi-calculator-unit-btn${whatIfMode === 'multiplier' ? ' is-active' : ''}`}
                            onClick={() => { setWhatIfMode('multiplier'); setWhatIfValue('') }}
                          >
                            ×
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={whatIfMode === 'mcap'}
                            className={`roi-calculator-unit-btn${whatIfMode === 'mcap' ? ' is-active' : ''}`}
                            onClick={() => { setWhatIfMode('mcap'); setWhatIfValue('') }}
                            disabled={!(marketCap > 0)}
                            title={!(marketCap > 0) ? 'Market cap unavailable' : undefined}
                          >
                            Mcap
                          </button>
                        </div>
                      </div>
                      <input
                        id="roi-whatif-input"
                        type="number"
                        className="roi-calculator-amount"
                        min={0}
                        step="any"
                        value={whatIfValue}
                        onChange={(e) => setWhatIfValue(e.target.value)}
                        placeholder={
                          whatIfMode === 'price' ? `e.g. ${trimNumberForInput(currentPrice * 10)}`
                          : whatIfMode === 'multiplier' ? 'e.g. 10'
                          : 'e.g. 1000000000'
                        }
                        aria-label={`Target ${whatIfMode}`}
                      />
                      {whatIfValueAtTarget != null && (
                        <div className="roi-calculator-result">
                          <div className="roi-calculator-result-row">
                            <span className="roi-calculator-result-label">Target price</span>
                            <span className="roi-calculator-result-sub">{fmtPrice(whatIfTargetPrice)}</span>
                          </div>
                          {whatIfTargetMcap != null && (
                            <div className="roi-calculator-result-row roi-calculator-result-row-sub">
                              <span className="roi-calculator-result-label">Target mcap</span>
                              <span className="roi-calculator-result-sub">{fmtLarge(whatIfTargetMcap)}</span>
                            </div>
                          )}
                          <div className="roi-calculator-result-row roi-calculator-result-row-ath">
                            <span className="roi-calculator-result-label">Your value</span>
                            <span
                              className="roi-calculator-result-value"
                              style={whatIfIsLoss ? { color: 'var(--bear-bright)' } : undefined}
                            >
                              {fmtPrice(whatIfValueAtTarget)}
                            </span>
                          </div>
                          <div
                            className="roi-calculator-result-pct"
                            style={whatIfIsLoss ? { color: 'var(--bear)' } : undefined}
                          >
                            {formatROIPct(whatIfPct)} · {whatIfMultiplier >= 1 ? `${whatIfMultiplier.toFixed(2)}×` : `${whatIfMultiplier.toFixed(3)}×`}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </>
              )}
            </>
          )}

          {!coinData && !loading && selected && !isStablecoin && (
            <p className="roi-calculator-muted">No ATH data for this project.</p>
          )}
          </div>

          {coinData && !loading && !isStablecoin && hasPrice && (
            <div className="roi-cic-side">
              {sideReady && (
                <>
                  <RoiPriceChart
                    selected={selected}
                    dayMode={dayMode}
                  />
                  {marketCap > 0 && (
                    <MarketCapCompare
                      selected={selected}
                      yourPrice={currentPrice}
                      yourMarketCap={marketCap}
                      tokenAmount={tokenAmount}
                      fmtLarge={fmtLarge}
                      dayMode={dayMode}
                    />
                  )}
                  <TimeMachine
                    selected={selected}
                    currentPrice={currentPrice}
                    usdAmount={usdAmount}
                    dayMode={dayMode}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (embedded) return content
  if (typeof document === 'undefined' || !document.body) return null
  try {
    return createPortal(content, document.body)
  } catch (err) {
    console.error('ROICalculator portal error:', err)
    return null
  }
}

export default ROICalculator
