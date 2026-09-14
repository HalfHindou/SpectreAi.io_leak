/**
 * TokenSearchRow — dense token row for the command palette.
 *
 * Layout (4-column grid, 2 rows per cell — width-stable):
 *
 *   ┌──────┬────────────────────┬──────────────┬──────────────┐
 *   │      │ Name               │ $0.0034      │ +5.21%       │
 *   │ logo │ SYM · 0xABC…123    │ MC $1.2M     │ V $543K      │
 *   └──────┴────────────────────┴──────────────┴──────────────┘
 *
 * Every cell carries 2 lines so the rhythm stays consistent. When a
 * piece of data is missing (e.g. recents don't carry MC/Vol; search
 * results don't carry sparkline data), the cell stays present but the
 * sub-line is empty — the column doesn't collapse and rows stay
 * width-stable across the list.
 *
 * Supports the synthetic paste-an-address row via `kind="address"`:
 * one big "Go to address" line + the truncated address below.
 */
import React from 'react'
import { ArrowRight } from 'lucide-react'
import TokenLogo from '../TokenLogo'
import DeltaChip from '../viz/DeltaChip'
import { readCodexChangePct } from '../../../lib/marketFormat'

// Compact USD ($1.2M, $543K, $0.0034, $0.000020)
function formatPrice(value) {
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return null
  if (n < 0.01) return `$${n.toFixed(6)}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
}

// Compact large number for MC / Volume ($1.2B / $1.2M / $543K)
function formatCompact(value) {
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return null
  if (n >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}T`
  if (n >= 1_000_000_000)     return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)         return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)             return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function truncateAddress(addr) {
  if (!addr) return ''
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function TokenSearchRow({
  kind = 'token',          // 'token' | 'address'
  token,                   // when kind='token'
  address,                 // when kind='address'
  chainId,                 // when kind='address'
  active = false,
  onMouseEnter,
  onMouseDown,
  onClick,
}) {
  // ---- Synthetic "Go to address" row -----------------------------------
  if (kind === 'address') {
    const truncated = truncateAddress(address)
    return (
      <li
        className={['cmdk-row', 'cmdk-row--token', 'cmdk-row--address', active && 'is-active']
          .filter(Boolean).join(' ')}
        role="option"
        aria-selected={active}
        onMouseEnter={onMouseEnter}
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <span className="cmdk-row__logo">
          <TokenLogo
            address={address}
            networkId={chainId}
            symbol="→"
            logo=""
            size={32}
          />
        </span>
        <div className="cmdk-row__id">
          <span className="cmdk-row__name">Go to address</span>
          <span className="cmdk-row__sub">{truncated}</span>
        </div>
        <div className="cmdk-row__metrics" aria-hidden="true" />
        <div className="cmdk-row__pricestack">
          <span className="cmdk-row__delta">
            <ArrowRight size={14} aria-hidden="true" />
          </span>
        </div>
      </li>
    )
  }

  // ---- Regular token row -----------------------------------------------
  const t = token || {}
  const name = t.name || t.symbol || '—'
  const symbol = t.symbol || ''
  const price = formatPrice(t.price)
  // Codex change24 is MIXED-UNIT (0.031 can mean +3.1%). Normalize through the
  // shared heuristic - the mobile search rows already do; rendering it raw made
  // the desktop palette show a bogus +0.03% for ratio-form values.
  const change = typeof t.change === 'number' && t.change !== 0 ? readCodexChangePct(t.change) : null
  const mcap = formatCompact(t.marketCap)
  const volume = formatCompact(t.volume24h)
  const truncatedAddr = truncateAddress(t.address)

  // Sub-line under the name: "SYM · 0xABC…123". If the row has no
  // address (local majors that only carry a symbol), just show SYM.
  const subParts = [symbol, truncatedAddr].filter(Boolean)
  const subLine = subParts.join('  ·  ')

  return (
    <li
      className={['cmdk-row', 'cmdk-row--token', active && 'is-active']
        .filter(Boolean).join(' ')}
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <span className="cmdk-row__logo">
        <TokenLogo
          address={t.address}
          networkId={t.networkId}
          logo={t.logo}
          symbol={symbol}
          size={32}
        />
      </span>
      <div className="cmdk-row__id">
        <span className="cmdk-row__name">{name}</span>
        <span className="cmdk-row__sub">{subLine || ' '}</span>
      </div>
      <div className="cmdk-row__metrics">
        <span className="cmdk-row__metric">
          {mcap ? (
            <>
              <span className="cmdk-row__metric-label">MC</span>
              <span className="cmdk-row__metric-value">{mcap}</span>
            </>
          ) : ' '}
        </span>
        <span className="cmdk-row__metric">
          {volume ? (
            <>
              <span className="cmdk-row__metric-label">VOL</span>
              <span className="cmdk-row__metric-value">{volume}</span>
            </>
          ) : ' '}
        </span>
      </div>
      <div className="cmdk-row__pricestack">
        <span className="cmdk-row__price">
          {price ? price : <span className="cmdk-row__price-empty">—</span>}
        </span>
        <span className="cmdk-row__delta">
          {change != null ? <DeltaChip value={change} size="sm" /> : <span className="cmdk-row__sub"> </span>}
        </span>
      </div>
    </li>
  )
}

export default React.memo(TokenSearchRow)
