/**
 * Spectre Migration Audit (dev-only)
 *
 * Side-by-side proves Spectre vs Codex/CG for the hot paths before any swap.
 * Mounted at /dev/spectre-audit. Not linked from any user nav.
 *
 * Tabs:
 *   1. Chart bars  — Spectre /v1/candles vs Codex getBars for BTC/ETH/SOL/PEPE/SPECTRE
 *   2. SSE prices  — Spectre /v1/stream/prices/sse vs Binance ticker drift
 *   3. Top coins   — Spectre /v1/coins/markets shape parity check
 *   4. RZ bootstrap — /v1/rz/{asset}/bootstrap completeness (which CG/Codex calls become unnecessary)
 */
import React, { useState } from 'react'
import ChartAuditPanel from './components/chart-audit-panel'
import SsePricesAuditPanel from './components/sse-prices-audit-panel'
import TopCoinsAuditPanel from './components/top-coins-audit-panel'
import RzBootstrapAuditPanel from './components/rz-bootstrap-audit-panel'
import RzSideBySidePanel from './components/rz-side-by-side-panel'
import LiveChartAuditPanel from './components/live-chart-audit-panel'
import MindshareV2LeaderboardPanel from './components/mindshare-v2-leaderboard-panel'
import './dev-spectre-audit.css'

const TABS = [
  { id: 'mindshare-v2', label: '✨ Mindshare v2 (LIVE)' },
  { id: 'chart', label: 'Chart Bars' },
  { id: 'live-chart', label: 'Live Chart (SSE)' },
  { id: 'sse', label: 'SSE Prices' },
  { id: 'top-coins', label: 'Top Coins' },
  { id: 'rz-coverage', label: 'RZ Coverage' },
  { id: 'rz-vs', label: 'RZ Side-by-Side' },
]

export default function DevSpectreAuditPage() {
  const [tab, setTab] = useState('mindshare-v2')

  return (
    <div className="dsa-root">
      <header className="dsa-header">
        <div>
          <h1>Spectre Migration Audit</h1>
          <p className="dsa-sub">
            Side-by-side parity check for CG/Codex → Spectre Data API. Read-only.
            No production swaps until each panel reads green.
          </p>
        </div>
        <div className="dsa-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`dsa-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
      </header>

      <main className="dsa-main">
        {tab === 'mindshare-v2' && <MindshareV2LeaderboardPanel />}
        {tab === 'chart' && <ChartAuditPanel />}
        {tab === 'live-chart' && <LiveChartAuditPanel />}
        {tab === 'sse' && <SsePricesAuditPanel />}
        {tab === 'top-coins' && <TopCoinsAuditPanel />}
        {tab === 'rz-coverage' && <RzBootstrapAuditPanel />}
        {tab === 'rz-vs' && <RzSideBySidePanel />}
      </main>
    </div>
  )
}
