/**
 * WarRoomTab v7 — Market Summary surface (text-first rework, 2026-07-09).
 *
 * The tab is now a written MARKET OUTLOOK in Spectre's own voice (composed from
 * the Brain's `/brain/desk`), a compact BTC/ETH/SOL + Fear & Greed levels strip,
 * a "what the desk is watching" line, and a slim internal-linked news list. All
 * headlines navigate to our own /news tab — never to an external site.
 *
 * `fearGreed` is forwarded from the home shell (already fetched) so the levels
 * strip's F&G chip paints without a redundant request. The other props remain
 * for API back-compat with the caller (discovery-section.jsx).
 */
import React from 'react'
import MarketPulse from './MarketPulse'
import './WarRoomTab.css'

const WarRoomTab = ({ fearGreed = null }) => (
  <div className="warroom-container">
    <MarketPulse fearGreed={fearGreed} />
  </div>
)

export default WarRoomTab
