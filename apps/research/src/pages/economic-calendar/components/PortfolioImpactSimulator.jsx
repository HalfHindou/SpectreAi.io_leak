/**
 * PortfolioImpactSimulator — Calculator panel.
 * "If CPI beats by X%, your $10k BTC position moves ~$Y"
 */

import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { getReactionData } from '../data/impactHistory'
import './PortfolioImpactSimulator.css'

const ASSETS = [
  { id: 'btc', label: 'BTC', key: 'btc' },
  { id: 'eth', label: 'ETH', key: 'btc' }, // ETH correlates ~0.85 with BTC
  { id: 'spx', label: 'SPX', key: 'spy' },
]

const PortfolioImpactSimulator = ({ eventName }) => {
  const { t } = useTranslation()
  const { fmtPrice, currencySymbol } = useCurrency()
  const [positionSize, setPositionSize] = useState(10000)
  const [asset, setAsset] = useState('btc')
  const [beatByPct, setBeatByPct] = useState(1)

  const reactionData = useMemo(() => getReactionData(eventName), [eventName])

  const result = useMemo(() => {
    if (!reactionData) return null

    const assetConfig = ASSETS.find(a => a.id === asset)
    const scenario = beatByPct >= 0 ? 'beat' : 'miss'
    const points = reactionData[scenario]
    if (!points || points.length === 0) return null

    // Get +15m point or closest
    const target = points.find(p => p.m >= 15) || points[points.length - 1]
    const baseMove = target[assetConfig.key]

    // ETH multiplier
    const ethMultiplier = asset === 'eth' ? 1.15 : 1

    // Scale by beat magnitude (normalized)
    const movePercent = baseMove * Math.abs(beatByPct) * ethMultiplier
    const dollarMove = (positionSize * movePercent) / 100

    return { movePercent, dollarMove, timeframe: '15m' }
  }, [reactionData, positionSize, asset, beatByPct])

  if (!reactionData) return null

  return (
    <div className="portfolio-sim">
      <h4 className="portfolio-sim__title">{t('economicCalendar.portfolioSim.title', 'Portfolio Impact Simulator')}</h4>

      <div className="portfolio-sim__controls">
        {/* Position Size */}
        <div className="portfolio-sim__field">
          <label className="portfolio-sim__label">{t('economicCalendar.portfolioSim.position', 'Position')}</label>
          <div className="portfolio-sim__input-wrap">
            <span className="portfolio-sim__currency">{currencySymbol}</span>
            <input
              type="number"
              className="portfolio-sim__input"
              value={positionSize}
              onChange={(e) => setPositionSize(Math.max(0, Number(e.target.value)))}
              min="0"
              step="1000"
            />
          </div>
        </div>

        {/* Asset Toggle */}
        <div className="portfolio-sim__field">
          <label className="portfolio-sim__label">{t('economicCalendar.portfolioSim.asset', 'Asset')}</label>
          <div className="portfolio-sim__toggle-group">
            {ASSETS.map(a => (
              <button
                key={a.id}
                className={`portfolio-sim__toggle${asset === a.id ? ' portfolio-sim__toggle--active' : ''}`}
                onClick={() => setAsset(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Beat/Miss Slider */}
        <div className="portfolio-sim__field">
          <label className="portfolio-sim__label">
            {beatByPct >= 0
              ? t('economicCalendar.portfolioSim.beatBy', 'Beat by')
              : t('economicCalendar.portfolioSim.missBy', 'Miss by')}
          </label>
          <div className="portfolio-sim__slider-wrap">
            <input
              type="range"
              className="portfolio-sim__slider"
              min="-3"
              max="3"
              step="0.1"
              value={beatByPct}
              onChange={(e) => setBeatByPct(Number(e.target.value))}
            />
            <span className="portfolio-sim__slider-val">
              {beatByPct > 0 ? '+' : ''}{beatByPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className={`portfolio-sim__result${result.dollarMove >= 0 ? ' portfolio-sim__result--bull' : ' portfolio-sim__result--bear'}`}>
          <span className="portfolio-sim__result-dollar">
            {result.dollarMove >= 0 ? '+' : '-'}{fmtPrice(Math.abs(result.dollarMove))}
          </span>
          <span className="portfolio-sim__result-pct">
            ({result.movePercent >= 0 ? '+' : ''}{result.movePercent.toFixed(2)}% in {result.timeframe})
          </span>
        </div>
      )}

      <p className="portfolio-sim__note">
        {t('economicCalendar.portfolioSim.note', 'Based on average historical reaction. Not financial advice.')}
      </p>
    </div>
  )
}

export default PortfolioImpactSimulator
