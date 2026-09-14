/**
 * DominanceChart — TradingView popout with symbol toggles
 * BTC.D / ETH-BTC / SOL.D / TOTAL / OTHERS / OTHERS.D
 * Uses the s.tradingview.com/widgetembed iframe (same pattern as Traders Corner W-010
 * which is whitelisted in CSP — the embed-widget-advanced-chart.js JS embed gets blocked).
 */
import React, { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import './dominance-chart.css'

const SYMBOLS = [
  { id: 'btcd',    label: 'BTC.D',    tv: 'CRYPTOCAP:BTC.D',    title: 'Bitcoin Dominance' },
  { id: 'ethbtc',  label: 'ETH/BTC',  tv: 'BINANCE:ETHBTC',     title: 'ETH / BTC' },
  { id: 'sold',    label: 'SOL.D',    tv: 'CRYPTOCAP:SOL.D',    title: 'Solana Dominance' },
  { id: 'total',   label: 'TOTAL',    tv: 'CRYPTOCAP:TOTAL',    title: 'Total Crypto Market Cap' },
  { id: 'others',  label: 'OTHERS',   tv: 'CRYPTOCAP:OTHERS',   title: 'Others Market Cap' },
  { id: 'othersd', label: 'OTHERS.D', tv: 'CRYPTOCAP:OTHERS.D', title: 'Others Dominance' },
]

function buildEmbedUrl(symbol, dayMode) {
  const params = new URLSearchParams({
    frameElementId: 'tv_dominance_chart',
    symbol,
    interval: 'D',
    theme: dayMode ? 'light' : 'dark',
    style: '2',
    hide_top_toolbar: '0',
    hide_side_toolbar: '0',
    allow_symbol_change: '1',
    save_image: '0',
    backgroundColor: dayMode ? '#ffffff' : 'rgba(9,9,11,1)',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}

function DominanceChart({ onClose, dayMode }) {
  const { t } = useTranslation()
  const [symbolId, setSymbolId] = useState('btcd')
  const active = SYMBOLS.find(s => s.id === symbolId) || SYMBOLS[0]
  const src = useMemo(() => buildEmbedUrl(active.tv, dayMode), [active.tv, dayMode])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={`dominance-chart-overlay${dayMode ? ' day-mode' : ''}`} onClick={onClose}>
      <div className="dominance-chart-modal dominance-chart-modal--tv" onClick={e => e.stopPropagation()}>
        <div className="dominance-chart-header">
          <div className="dominance-chart-title-row">
            <h2 className="dominance-chart-title">{active.title}</h2>
            <button className="dominance-chart-close" onClick={onClose} aria-label={t('homePage.dominancechart.dominancechart.ariaClose', "Close")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="dominance-chart-controls dominance-chart-controls--tv">
            <div className="dominance-chart-timeframes dominance-chart-symbols" role="tablist">
              {SYMBOLS.map(s => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={symbolId === s.id}
                  className={`dominance-chart-tf-btn${symbolId === s.id ? ' active' : ''}`}
                  onClick={() => setSymbolId(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="dominance-chart-canvas dominance-chart-canvas--tv">
          <iframe
            src={src}
            title={active.title}
            allow="fullscreen"
            style={{ width: '100%', height: '100%', border: 0, display: 'block', borderRadius: 12 }}
          />
        </div>
      </div>
    </div>
  )
}

export default DominanceChart
