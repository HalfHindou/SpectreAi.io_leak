/**
 * VCSectorsGrid — "Sector Map" view.
 *
 * A live momentum heatmap of crypto sectors. Cell size scales with the number
 * of tracked funds clustered in the sector; cell colour is the average live
 * move of the sector's signature tokens over the selected timeframe. Click a
 * cell to drill into its funds, each ranked by their live portfolio momentum
 * inside that sector. Everything is derived from the live feed.
 */
import React, { useMemo, useState } from 'react'
import {
  buildSectors, momentumFill, parseUsdAum, isTradeableSymbol,
  fmtUsdCompact, fmtPct, classOfPct,
} from './smu-shared'
import { FundAvatar, BackerStack } from './smu-bits'
import './vc-sectors-grid.css'

const TIMEFRAMES = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
]

// A fund's live momentum within a sector = avg move of its holdings that
// intersect the sector signature, over the active timeframe.
function fundSectorPerf(entity, sectorTokens, priceMap, tf) {
  const changeKey = tf === '7d' ? 'change7d' : tf === '30d' ? 'change30d' : 'change24h'
  const sig = new Set(sectorTokens.map((t) => String(t).toUpperCase()))
  const moves = []
  const held = []
  for (const raw of entity.known_portfolio_tokens || []) {
    const sym = String(raw).toUpperCase()
    if (!sig.has(sym)) continue
    held.push(sym)
    const p = priceMap?.[sym]
    if (p && Number.isFinite(p[changeKey])) moves.push(p[changeKey])
  }
  const perf = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null
  return { perf, heldCount: held.length }
}

function SectorDrill({ cell, priceMap, timeframe, onBack, onSelectEntity }) {
  const tfLabel = TIMEFRAMES.find((t) => t.key === timeframe)?.label || '24H'
  const funds = useMemo(() => {
    return cell.funds
      .map((e) => ({ entity: e, aum: parseUsdAum(e.aum_estimate) || 0, ...fundSectorPerf(e, cell.tokens, priceMap, timeframe) }))
      .sort((a, b) => (b.perf ?? -Infinity) - (a.perf ?? -Infinity) || b.aum - a.aum)
  }, [cell, priceMap, timeframe])

  return (
    <div className="smu-drill">
      <div className="smu-drill-head">
        <button type="button" className="smu-drill-back" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          <span>All sectors</span>
        </button>
        <div className="smu-drill-id">
          <span className="smu-drill-name">{cell.label}</span>
          <span className="smu-drill-meta">
            {cell.fundCount} funds · {fmtUsdCompact(cell.aum)} ·
            <span className={classOfPct(cell.momentum)}> {fmtPct(cell.momentum)} {tfLabel}</span>
          </span>
        </div>
        <div className="smu-drill-chips">
          {cell.chips.map((c) => <span key={c.symbol} className="smu-chip">${c.symbol}</span>)}
        </div>
      </div>

      <div className="smu-drill-grid">
        {funds.map(({ entity, aum, perf, heldCount }) => {
          const fill = momentumFill(perf)
          return (
            <button
              key={entity.id}
              type="button"
              className="smu-fund-card"
              style={{ background: fill.bg, borderColor: fill.border }}
              onClick={() => onSelectEntity?.(entity.id)}
            >
              <div className="smu-fund-card-top">
                <FundAvatar entity={entity} size={32} ring />
                <div className="smu-fund-card-id">
                  <span className="smu-fund-card-name">{entity.name}</span>
                  <span className="smu-fund-card-sub">{heldCount}t · {fmtUsdCompact(aum)}</span>
                </div>
              </div>
              <div className={`smu-fund-card-perf ${classOfPct(perf)}`}>{fmtPct(perf)}<span className="smu-fund-card-tf">{tfLabel}</span></div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function VCSectorsGrid({ entities, priceMap, onSelectEntity }) {
  const [timeframe, setTimeframe] = useState('24h')
  const [drillKey, setDrillKey] = useState(null)

  const cells = useMemo(() => buildSectors(entities, priceMap, timeframe), [entities, priceMap, timeframe])
  const drill = drillKey ? cells.find((c) => c.key === drillKey) : null

  return (
    <div className="smu-sectors">
      <div className="smu-sectors-head">
        <div className="smu-sectors-headline">
          <span className="smu-sectors-title">Sector Map</span>
          <span className="smu-sectors-desc">{cells.length} sectors · cell size = fund count · color = {TIMEFRAMES.find((t) => t.key === timeframe)?.label} token momentum</span>
        </div>
        <div className="smu-sectors-controls">
          <div className="smu-tf-toggle" role="tablist" aria-label="Timeframe">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={timeframe === t.key}
                className={`smu-tf-btn${timeframe === t.key ? ' smu-tf-btn--active' : ''}`}
                onClick={() => setTimeframe(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="smu-legend">
            <span>BEAR</span>
            <span className="smu-legend-bar" aria-hidden />
            <span>BULL</span>
          </div>
        </div>
      </div>

      {drill ? (
        <SectorDrill cell={drill} priceMap={priceMap} timeframe={timeframe} onBack={() => setDrillKey(null)} onSelectEntity={onSelectEntity} />
      ) : (
        <div className="smu-sector-grid">
          {cells.map((cell) => {
            const fill = momentumFill(cell.momentum)
            const grow = Math.min(14, Math.max(3, cell.fundCount))
            const minH = 116 + Math.min(12, cell.fundCount) * 6
            const tfLabel = TIMEFRAMES.find((t) => t.key === timeframe)?.label
            return (
              <button
                key={cell.key}
                type="button"
                className="smu-sector-cell"
                style={{
                  flexGrow: grow,
                  flexBasis: `clamp(230px, ${cell.fundCount * 26}px, 540px)`,
                  minHeight: minH,
                  background: fill.bg,
                  borderColor: fill.border,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 26px ${fill.glow}`,
                }}
                onClick={() => setDrillKey(cell.key)}
              >
                <div className="smu-sector-cell-top">
                  <span className="smu-sector-cell-name">{cell.label}</span>
                  <span className={`smu-sector-cell-mom ${classOfPct(cell.momentum)}`}>{fmtPct(cell.momentum)}</span>
                </div>
                <div className="smu-sector-cell-meta">
                  {cell.fundCount} funds · {fmtUsdCompact(cell.aum)} · {tfLabel}
                </div>
                <div className="smu-sector-cell-funds">
                  <BackerStack entities={cell.funds} max={6} size={26} onSelect={onSelectEntity} />
                </div>
                <div className="smu-sector-cell-chips">
                  {cell.chips.slice(0, 5).map((c) => <span key={c.symbol} className="smu-chip">${c.symbol}</span>)}
                </div>
              </button>
            )
          })}
          {cells.length === 0 && <div className="smu-sectors-empty">Streaming live sector momentum…</div>}
        </div>
      )}
    </div>
  )
}
