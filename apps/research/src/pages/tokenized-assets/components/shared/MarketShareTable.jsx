import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import './ta-table.css'

function fmtPct(v, digits = 2) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

function formatCell(col, row, totalForShare, fmtCurrency) {
  const val = row[col.key]
  if (col.render) return col.render(val, row)
  if (col.format === 'currency') return val == null || Number.isNaN(val) ? '—' : fmtCurrency(val)
  if (col.format === 'percent') return fmtPct(val)
  if (col.format === 'count' && val != null) return val.toLocaleString()
  if (col.format === 'share') {
    const pct = totalForShare > 0 ? (val / totalForShare) * 100 : 0
    return `${pct.toFixed(1)}%`
  }
  return val ?? '—'
}

/* ── Mini sparkline ── */
function TableSparkline({ data, bull }) {
  if (!data?.length) return <span className="ta-table-spark-empty" />
  const vals = data
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  const range = max - min || 1
  const w = 80
  const h = 24
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 4) + 2
    const y = h - 2 - ((v - min) / range) * (h - 4)
    return `${x},${y}`
  }).join(' ')
  const color = bull ? 'var(--bull)' : 'var(--bear)'
  return (
    <svg width={w} height={h} className="ta-table-spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/* ── Delta chip ── */
function DeltaChip({ value, label }) {
  if (value == null) return <span className="ta-table-muted">—</span>
  const bull = value >= 0
  return (
    <span className={`ta-table-delta ${bull ? 'bull' : 'bear'}`}>
      <span className="ta-table-delta-arrow">{bull ? '\u2191' : '\u2193'}</span>
      <span className="ta-table-delta-val mono">{fmtPct(value, 1)}</span>
      {label && <span className="ta-table-delta-tf">{label}</span>}
    </span>
  )
}

/**
 * MarketShareTable
 *
 * columns: Array<{
 *   key: string
 *   label: string
 *   width?: string
 *   align?: 'left'|'right'|'center'
 *   format?: 'currency'|'percent'|'count'|'share'|'delta'|'spark'|'logo'|'category'
 *   sortable?: boolean
 *   render?: (value, row) => ReactNode   // full custom render for cell
 * }>
 * rows: Array<record>
 * onRowClick?: (row) => void
 * virtualizeAfter: number — initial row count, reveal more via "Load more"
 * defaultSort?: { key, dir }
 * shareColumn?: string — key to use for % share bar background
 */
export default function MarketShareTable({
  columns,
  rows,
  onRowClick,
  virtualizeAfter = 50,
  defaultSort,
  loading = false,
  emptyMessage,
  mobileCardMode = true,
}) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const resolvedEmptyMessage = emptyMessage || t('tokenizedAssets.shared.noData', 'No data available')
  const [sortKey, setSortKey] = useState(defaultSort?.key || null)
  const [sortDir, setSortDir] = useState(defaultSort?.dir || 'desc')
  const [visible, setVisible] = useState(virtualizeAfter)

  const handleSort = useCallback((col) => {
    if (col.sortable === false) return
    if (sortKey === col.key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(col.key)
      setSortDir('desc')
    }
  }, [sortKey])

  const sorted = useMemo(() => {
    if (!rows?.length) return []
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      if (av === bv) return 0
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [rows, sortKey, sortDir])

  const shareCol = useMemo(() => columns.find(c => c.format === 'share'), [columns])
  const totalForShare = useMemo(() => {
    if (!shareCol || !sorted.length) return 0
    return sorted.reduce((s, r) => s + (r[shareCol.key] || 0), 0)
  }, [shareCol, sorted])

  const visibleRows = sorted.slice(0, visible)
  const hasMore = sorted.length > visibleRows.length

  if (loading) {
    return (
      <div className="ta-table-wrap">
        <table className="ta-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`ta-table-head align-${col.align || 'left'}`} style={{ width: col.width }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="ta-table-row ta-table-row-skel">
                {columns.map((col) => (
                  <td key={col.key} className={`ta-table-cell align-${col.align || 'left'}`}>
                    <div className={`ta-table-skel animate-shimmer stagger-${(i % 5) + 1}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (!sorted.length) {
    return (
      <div className="ta-table-wrap">
        <div className="ta-table-empty">{resolvedEmptyMessage}</div>
      </div>
    )
  }

  return (
    <div className={`ta-table-wrap${mobileCardMode ? ' ta-table-mobile-cards' : ''}`}>
      <table className="ta-table">
        <thead>
          <tr>
            {columns.map((col) => {
              const sorted = sortKey === col.key
              const sortable = col.sortable !== false
              return (
                <th
                  key={col.key}
                  className={`ta-table-head align-${col.align || 'left'}${sorted ? ' sorted' : ''}${sortable ? ' sortable' : ''}`}
                  style={{ width: col.width }}
                  onClick={() => handleSort(col)}
                >
                  <span className="ta-table-head-inner">
                    {col.label}
                    {/* Always render the arrow on sortable columns (hidden until
                        active) so the column never shifts when it becomes sorted. */}
                    {sortable && (
                      <span className={`ta-table-head-arrow${sorted ? ' on' : ''}`} aria-hidden="true">
                        {sorted && sortDir === 'asc' ? '\u2191' : '\u2193'}
                      </span>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, idx) => {
            const share = shareCol && totalForShare > 0
              ? (row[shareCol.key] / totalForShare) * 100
              : 0
            const isClickable = Boolean(onRowClick && row.slug)
            return (
              <tr
                key={row.id || row.slug || row.name || idx}
                className={`ta-table-row${isClickable ? ' clickable' : ''}`}
                onClick={isClickable ? () => onRowClick(row) : undefined}
                style={isClickable ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((col) => {
                  const isShare = col.format === 'share'
                  // Drive the share fill via a CSS custom property instead of a
                  // fresh inline gradient object per cell (the gradient lives in
                  // .ta-table-cell--share in ta-table.css).
                  const cellStyle = isShare ? { '--share-pct': `${share}%` } : undefined

                  let content
                  if (col.format === 'delta') {
                    content = <DeltaChip value={row[col.key]} label={col.deltaLabel} />
                  } else if (col.format === 'spark') {
                    const trend = row[col.trendKey || 'change_7d']
                    content = <TableSparkline data={row[col.key]} bull={trend == null ? true : trend >= 0} />
                  } else {
                    content = formatCell(col, row, totalForShare, fmtLargeShort)
                  }

                  const numeric = ['currency', 'percent', 'count', 'share', 'delta'].includes(col.format)

                  return (
                    <td
                      key={col.key}
                      data-label={col.label}
                      className={`ta-table-cell align-${col.align || 'left'}${numeric ? ' mono' : ''}${isShare ? ' ta-table-cell--share' : ''}`}
                      style={cellStyle}
                    >
                      {content}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="ta-table-more">
          <button
            type="button"
            className="ta-table-more-btn"
            onClick={() => setVisible(v => v + virtualizeAfter)}
          >
            {t('tokenizedAssets.screener.loadMore', 'Load more')} <span className="ta-table-more-count mono">({t('tokenizedAssets.screener.leftCount', '{{count}} left', { count: sorted.length - visibleRows.length })})</span>
          </button>
        </div>
      )}
    </div>
  )
}
