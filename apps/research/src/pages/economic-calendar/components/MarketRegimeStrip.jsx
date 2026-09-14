/**
 * MarketRegimeStrip Component
 * Premium 3-4 column market state display. Individual glass cards per asset class
 * with accent borders, large mono values, change pills, and status indicators.
 */

import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import RegimeBadge from './RegimeBadge'
import './MarketRegimeStrip.css'

const DirectionArrow = ({ direction }) => {
  if (direction === 'up') return <span className="mrs-arrow mrs-arrow--up">&#9650;</span>
  if (direction === 'down') return <span className="mrs-arrow mrs-arrow--down">&#9660;</span>
  return <span className="mrs-arrow mrs-arrow--flat">&#9644;</span>
}

const ChangePill = ({ change, direction }) => {
  if (change == null) return null
  const cls =
    direction === 'up' ? 'mrs-change--up' :
    direction === 'down' ? 'mrs-change--down' :
    'mrs-change--flat'

  return (
    <span className={`mrs-change ${cls}`}>
      {change}
    </span>
  )
}

const StatusDot = ({ context }) => {
  if (!context) return null
  const isOpen = context.toLowerCase().includes('open')
  const isClosed = context.toLowerCase().includes('closed')
  const isFear = context.toLowerCase().includes('fear') || context.toLowerCase().includes('extreme fear')
  const isGreed = context.toLowerCase().includes('greed')

  let dotClass = 'mrs-status__dot'
  if (isOpen) dotClass += ' mrs-status__dot--live'
  else if (isClosed) dotClass += ' mrs-status__dot--closed'
  else if (isFear) dotClass += ' mrs-status__dot--fear'
  else if (isGreed) dotClass += ' mrs-status__dot--greed'

  return (
    <div className="mrs-status">
      <span className={dotClass} />
      <span className="mrs-status__label">{context}</span>
    </div>
  )
}

const PrimaryValue = ({ primary }) => {
  if (!primary) return null

  return (
    <div className="mrs-primary">
      <div className="mrs-primary__row">
        <span className="mrs-primary__value">{primary.value}</span>
        <DirectionArrow direction={primary.direction} />
      </div>
      <ChangePill change={primary.change} direction={primary.direction} />
    </div>
  )
}

const SecondaryValue = ({ item }) => {
  if (!item) return null

  return (
    <div className="mrs-secondary-item">
      <span className="mrs-secondary-item__symbol">{item.symbol}</span>
      <span className="mrs-secondary-item__value">{item.value}</span>
      <DirectionArrow direction={item.direction} />
    </div>
  )
}

const TickerDots = ({ tickers }) => {
  if (!tickers || tickers.length === 0) return null

  return (
    <div className="mrs-ticker-dots">
      {tickers.map((ticker, i) => (
        <span
          key={`${ticker}-${i}`}
          className="mrs-ticker-dots__dot"
          title={ticker}
        />
      ))}
    </div>
  )
}

const RegimeColumn = ({ column, index }) => {
  if (!column) return null

  return (
    <div
      className="mrs-col"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="mrs-col__header">
        <span className="mrs-col__label">{column.label}</span>
        {column.primary && (
          <span className="mrs-col__symbol">{column.primary.symbol}</span>
        )}
      </div>

      <PrimaryValue primary={column.primary} />

      {column.secondary && column.secondary.length > 0 && (
        <div className="mrs-col__secondary">
          {column.secondary.map((item, i) => (
            <SecondaryValue key={`${item.symbol}-${i}`} item={item} />
          ))}
        </div>
      )}

      {column.context && <StatusDot context={column.context} />}

      {column.regime && (
        <div className="mrs-col__regime">
          <RegimeBadge
            label={column.regime.label}
            sentiment={column.regime.sentiment}
          />
        </div>
      )}

      <TickerDots tickers={column.tickers} />
    </div>
  )
}

/* ── Typewriter Verdict ── */
const TypewriterVerdict = ({ text }) => {
  const { t } = useTranslation()
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const prevText = useRef('')

  useEffect(() => {
    if (!text) return
    if (text === prevText.current) {
      setDisplayed(text)
      setDone(true)
      return
    }
    prevText.current = text
    setDisplayed('')
    setDone(false)

    let i = 0
    const interval = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(interval)
        setDone(true)
      }
    }, 12)

    return () => clearInterval(interval)
  }, [text])

  if (!text) return null

  return (
    <div className="mrs-verdict">
      <span className="mrs-verdict__prefix">{t('economicCalendar.marketRegime.spectreVerdict', 'Spectre Verdict')} </span>
      <span className="mrs-verdict__text">
        {displayed}
        {!done && <span className="mrs-verdict__cursor" />}
      </span>
    </div>
  )
}

const MarketRegimeStrip = ({ regime }) => {
  if (!regime) return null

  const { columns, verdict } = regime

  return (
    <div className="mrs">
      <div className="mrs__grid">
        {columns &&
          columns.map((column, i) => (
            <RegimeColumn key={column.label || i} column={column} index={i} />
          ))}
      </div>

      <TypewriterVerdict text={verdict} />
    </div>
  )
}

export default MarketRegimeStrip
