/**
 * rzm-stock-sentiment — MOBILE wrapper for the stock Sentiment tab.
 *
 * Thin reuse of the desktop <StockSentimentTab> (equity desk read + crowd
 * gauge). That component is fully self-fetching (GET /api/sentiment-read) and
 * its layout is a linear stack of SectionShells, so it collapses to a phone
 * width with CSS overrides alone — no need to fork the fetch/classify logic
 * (which is the same ticker-collision-safe engine the desktop uses).
 *
 * We only wrap it in a mobile-scoped div (`.rzss-wrap`) that tightens spacing,
 * enforces tabular-nums on numbers and 44px touch targets on the post rows.
 * Everything else (null-safety, honest empty states, no fabricated scores,
 * day-mode) lives in the reused component and its base CSS.
 */
import React from 'react'
import StockSentimentTab from './rz-stock-sentiment'
import './rzm-stock-sentiment.css'

export default function RzmStockSentiment({ sym, tweets = null }) {
  return (
    <div className="rzss-wrap">
      <StockSentimentTab sym={sym} tweets={tweets} />
    </div>
  )
}
