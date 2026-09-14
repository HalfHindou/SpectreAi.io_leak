/**
 * MajorCoinPanel - the bottom-panel content for CoinGecko-sourced MAJOR coins
 * (BTC/ETH/SOL/XRP/...). Replaces the on-chain Transactions/Holders/Analytics
 * tabs (which show the wrapped contract's thin DEX activity, meaningless for a
 * major) with CMC-style content sourced from ONE CoinGecko call:
 *   - Markets:     real exchanges table (where it actually trades)
 *   - Key Stats:   rank / mcap / FDV / 24h H-L / ATH / ATL / supply
 *   - Performance: 1h / 24h / 7d / 30d / 1y % ladder
 *
 * Rendered by DataTabs only when the token resolves to a major cgId; ordinary
 * contract tokens keep the existing on-chain tabs untouched.
 */
import React from 'react'
import { ExternalLink } from 'lucide-react'
import { formatPrice, formatLargeNumber } from '../services/codexApi'
import useMajorMarketData from '../hooks/useMajorMarketData'
import useSettingsStore from '../store/useSettingsStore'
import './MajorCoinPanel.css'

// formatLargeNumber already returns a $-prefixed string ("$2.31B") - do NOT add
// another $ (that was the "$$2.31B" bug).
const fmtUsd = (n) => {
  const v = Number(n)
  if (!v || !isFinite(v)) return '-'
  return formatLargeNumber(v)
}
// Supply is a token COUNT, not USD - format large without the $ prefix.
const fmtSupply = (n) => {
  const v = Number(n)
  if (!v || !isFinite(v)) return '-'
  const a = Math.abs(v)
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K'
  return Math.round(v).toLocaleString('en-US')
}
const fmtPct = (n) => {
  const v = Number(n)
  if (n == null || !isFinite(v)) return { text: '-', cls: 'flat' }
  if (Math.abs(v) < 0.005) return { text: '0.00%', cls: 'flat' }
  const cls = v >= 0 ? 'up' : 'down'
  return { text: `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, cls }
}
const fmtDate = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

function StatTile({ label, value, sub, subCls }) {
  return (
    <div className="mcp-stat">
      <span className="mcp-stat-label">{label}</span>
      <span className="mcp-stat-value">{value}</span>
      {sub != null && <span className={`mcp-stat-sub ${subCls || ''}`}>{sub}</span>}
    </div>
  )
}

export default function MajorCoinPanel({ token, cgId, activeTab }) {
  const { raw, market, tickers, loading, error } = useMajorMarketData(cgId)
  // Honor the Comfortable/Compact toggle (shared with the on-chain tx table).
  const density = useSettingsStore((s) => s.transactionsDensity)

  if (loading && !raw) {
    return (
      <div className="mcp-loading">
        {[...Array(8)].map((_, i) => <div key={i} className={`mcp-skeleton stagger-${(i % 5) + 1}`} />)}
      </div>
    )
  }
  if (error || !raw) {
    return <div className="mcp-empty">Market data unavailable</div>
  }

  // ── Markets ──────────────────────────────────────────────────────────────
  if (activeTab === 'markets') {
    const rows = tickers.slice(0, 25)
    if (rows.length === 0) return <div className="mcp-empty">No exchange data</div>
    return (
      <div className={`mcp-markets ${density === 'compact' ? 'mcp-markets--compact' : ''}`}>
        <table className="mcp-table">
          <thead>
            <tr>
              <th className="mcp-col-rank">#</th>
              <th className="mcp-col-ex">Exchange</th>
              <th className="mcp-col-pair">Pair</th>
              <th className="mcp-col-num">Price</th>
              <th className="mcp-col-num">Volume (24h)</th>
              <th className="mcp-col-num">Spread</th>
              <th className="mcp-col-link" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={`${t.exchange}-${t.base}-${t.target}-${i}`}>
                <td className="mcp-col-rank">{i + 1}</td>
                <td className="mcp-col-ex">{t.exchange}</td>
                <td className="mcp-col-pair"><span className="mcp-pair">{t.base}/{t.target}</span></td>
                <td className="mcp-col-num mcp-mono">{formatPrice(t.price)}</td>
                <td className="mcp-col-num mcp-mono">{fmtUsd(t.volumeUsd)}</td>
                <td className="mcp-col-num mcp-mono mcp-muted">{t.spread != null ? `${t.spread.toFixed(2)}%` : '-'}</td>
                <td className="mcp-col-link">
                  {t.tradeUrl && (
                    <a href={t.tradeUrl} target="_blank" rel="noopener noreferrer" className="mcp-trade-link" title={`Trade on ${t.exchange}`} onClick={(e) => e.stopPropagation()}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // ── Key Stats ────────────────────────────────────────────────────────────
  if (activeTab === 'keystats') {
    const m = market || {}
    const rank = raw.market_cap_rank
    const ath = m.ath?.usd
    const athChg = fmtPct(m.ath_change_percentage?.usd)
    const atl = m.atl?.usd
    const atlChg = fmtPct(m.atl_change_percentage?.usd)
    return (
      <div className="mcp-stats-grid">
        <StatTile label="Rank" value={rank ? `#${rank}` : '-'} />
        <StatTile label="Market Cap" value={fmtUsd(m.market_cap?.usd)} />
        <StatTile label="FDV" value={fmtUsd(m.fully_diluted_valuation?.usd)} />
        <StatTile label="24h Volume" value={fmtUsd(m.total_volume?.usd)} />
        <StatTile label="24h High" value={m.high_24h?.usd ? formatPrice(m.high_24h.usd) : '-'} />
        <StatTile label="24h Low" value={m.low_24h?.usd ? formatPrice(m.low_24h.usd) : '-'} />
        <StatTile label="All-Time High" value={ath ? formatPrice(ath) : '-'} sub={ath ? `${athChg.text} · ${fmtDate(m.ath_date?.usd)}` : null} subCls={athChg.cls} />
        <StatTile label="All-Time Low" value={atl ? formatPrice(atl) : '-'} sub={atl ? athChgFromAtl(atlChg) : null} subCls={atlChg.cls} />
        <StatTile label="Circ. Supply" value={fmtSupply(m.circulating_supply)} />
        <StatTile label="Total Supply" value={fmtSupply(m.total_supply)} />
        <StatTile label="Max Supply" value={m.max_supply ? fmtSupply(m.max_supply) : '∞'} />
        <StatTile label="Vol / MCap" value={volToMcap(m)} />
      </div>
    )
  }

  // ── Performance ──────────────────────────────────────────────────────────
  if (activeTab === 'performance') {
    const m = market || {}
    const pc = (k) => m[`price_change_percentage_${k}_in_currency`]?.usd
    const windows = [
      { label: '1h', v: pc('1h') },
      { label: '24h', v: pc('24h') },
      { label: '7d', v: pc('7d') },
      { label: '14d', v: pc('14d') },
      { label: '30d', v: pc('30d') },
      { label: '1y', v: pc('1y') },
    ].filter((w) => w.v != null && isFinite(w.v))
    if (windows.length === 0) return <div className="mcp-empty">No performance data</div>
    return (
      <div className="mcp-perf">
        {windows.map((w) => {
          const p = fmtPct(w.v)
          const width = Math.min(100, Math.abs(Number(w.v)))
          return (
            <div key={w.label} className="mcp-perf-row">
              <span className="mcp-perf-label">{w.label}</span>
              <div className="mcp-perf-track">
                <span className={`mcp-perf-bar mcp-perf-bar--${p.cls}`} style={{ width: `${width}%` }} />
              </div>
              <span className={`mcp-perf-pct mcp-${p.cls}`}>{p.text}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return null
}

// ATL change is a huge positive % (e.g. +87,477%); show it compactly.
function athChgFromAtl(atlChg) {
  if (atlChg.text === '-') return null
  const num = parseFloat(atlChg.text.replace(/[+%,]/g, ''))
  if (isFinite(num) && Math.abs(num) >= 1000) {
    return `${num >= 0 ? '+' : ''}${formatLargeNumber(Math.abs(num))}%`
  }
  return atlChg.text
}

function volToMcap(m) {
  const vol = Number(m.total_volume?.usd) || 0
  const mc = Number(m.market_cap?.usd) || 0
  if (!vol || !mc) return '-'
  return ((vol / mc) * 100).toFixed(2) + '%'
}
