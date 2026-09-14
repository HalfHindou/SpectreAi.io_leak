/**
 * W-023 · On-Chain Metrics Widget
 * Key on-chain health indicators from real market data:
 * - BTC Dominance from dominance.btc
 * - Alt Season Index from altSeasonIndex
 * - Exchange Reserve changes from flowSummary
 * - Total Market Cap and 24h change from totalMarketCap/marketCapChange24h
 * Powered by useMarketIntel real-time data.
 */
import { useMarketIntel } from '@/hooks/useMarketIntel'
import './OnChainMetrics.css'

/* ---------- helpers ---------- */

function formatCompact(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '—'
  if (Math.abs(num) >= 1e12) return `$${(num / 1e12).toFixed(2)}T`
  if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(1)}M`
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(0)}K`
  return num.toLocaleString()
}

/* ---------- Alt Season gauge bar (value-driven color — stays inline) ---------- */

function AltSeasonBar({ value }) {
  // Scale: 0 to 100
  const pct = Math.min(Math.max(value / 100, 0), 1) * 100
  // Color zones: <25 blue (BTC dominant), 25-50 amber, 50-75 green, >75 bright green
  let barColor = 'var(--blue)'
  if (value >= 75) barColor = 'var(--bull)'
  else if (value >= 50) barColor = 'var(--bull-bright)'
  else if (value >= 25) barColor = 'var(--amber)'

  return (
    <div className="tcom-alt">
      <div className="tcom-alt-fill" style={{ width: `${pct}%`, background: barColor }} />
      <div className="tcom-alt-dot" style={{ left: `${pct}%`, background: barColor }} />
    </div>
  )
}

/* ---------- metric row ---------- */

function MetricRow({ label, value, change, suffix, children, loading: isLoading }) {
  if (isLoading) return <div className="tcw-shimmer tcom-skeleton-metric" />

  const positive = change >= 0

  return (
    <div className="tcom-metric">
      <div className="tcom-metric-label">{label}</div>
      <div className="tcom-metric-row">
        <span className="tcom-metric-value">{value}{suffix || ''}</span>
        {change !== undefined && change !== null && (
          <span className={`tcom-metric-change ${positive ? 'tcom-metric-change--bull' : 'tcom-metric-change--bear'}`}>
            {positive ? '▲' : '▼'} {Math.abs(Number(change) || 0).toFixed(1)}%
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

/* ---------- component ---------- */

export default function OnChainMetrics() {
  const {
    dominance,
    altSeasonIndex,
    flowSummary,
    totalMarketCap,
    marketCapChange24h,
    loading,
  } = useMarketIntel()

  // Exchange reserve change — net flow indicates accumulation vs distribution
  const netFlowM = flowSummary.net || 0
  // Positive net = inflow (bearish for price), negative net = outflow (bullish)
  const reserveChange = netFlowM !== 0 ? (netFlowM / (flowSummary.inflow || 1)) * 100 : 0

  return (
    <div className="tcom">
      {/* Dominance chips (per-asset brand dot colors stay inline) */}
      {loading ? (
        <div className="tcw-shimmer tcom-skeleton-chips" />
      ) : (
        <div className="tcom-chips">
          {[
            { label: 'BTC', value: dominance.btc, color: '#F7931A' },
            { label: 'ETH', value: dominance.eth, color: '#627EEA' },
            { label: 'SOL', value: dominance.sol, color: '#9945FF' },
            { label: 'ALTS', value: dominance.alts, color: 'var(--text-secondary)' },
          ].map(d => (
            <div key={d.label} className="tcom-chip">
              <span className="tcom-chip-dot" style={{ background: d.color }} />
              <span className="tcom-chip-label">{d.label}</span>
              <span className="tcom-chip-value">{Number(d.value || 0).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Metrics */}
      <div className="tcom-metrics">
        <MetricRow
          label="Total Market Cap"
          value={totalMarketCap ? formatCompact(totalMarketCap) : '—'}
          change={marketCapChange24h || 0}
          loading={loading}
        />

        <MetricRow
          label="Net Exchange Flow"
          value={`${netFlowM >= 0 ? '+' : ''}${netFlowM.toLocaleString()}${flowSummary.unit}`}
          change={reserveChange}
          loading={loading}
        />

        <MetricRow
          label={`Alt Season Index — ${altSeasonIndex.label}`}
          value={altSeasonIndex.value}
          suffix="/100"
          change={null}
          loading={loading}
        >
          {!loading && <AltSeasonBar value={altSeasonIndex.value} />}
        </MetricRow>
      </div>
    </div>
  )
}
