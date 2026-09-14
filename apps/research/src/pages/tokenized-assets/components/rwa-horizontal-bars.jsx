import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { hexToRgba } from './rwa-shared'

/**
 * RwaHorizontalBars — ranked list with proportional colored bars.
 * Used for: Top Protocols, Chain Breakdown, Movers (24h), Commodities split.
 *
 * Props:
 *   title:    string       — section heading
 *   subtitle: string       — optional sub-label under the heading
 *   items:    Array<{ label, value, color, change?, logo?, slug?, pending? }>
 *   maxItems: number       — default 10
 *   onRowClick?: (item) => void
 *   showChange: boolean    — show change % badge (for movers)
 *   compact:  boolean      — tighter spacing
 *   minBarPct: number      — minimum bar width (% of full track) for any
 *                            non-zero value. Defaults to 0 (no minimum).
 *                            Set to 1.5 on commodities so Silver at 0.026%
 *                            still renders as a visible filled bar instead
 *                            of a 1px hairline.
 *   pendingMessage: string — title text for pending rows (default
 *                            "Pending — no live tokenized issuer yet").
 */
export default function RwaHorizontalBars({
  title,
  subtitle,
  items = [],
  maxItems = 10,
  onRowClick,
  showChange = false,
  compact = false,
  minBarPct = 0,
  pendingMessage,
}) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtUsd = (v) => (v == null || !isFinite(v) ? '—' : fmtLargeShort(v))
  const pendingTitle = pendingMessage || t(
    'tokenizedAssets.horizontalBars.pendingMessage',
    'Pending — no live tokenized issuer yet'
  )
  if (!items.length) return null

  const visible = items.slice(0, maxItems)
  // For pending items (value=0) the bar width is computed from minBarPct
  // (or a small floor) so the row still shows a filled placeholder bar.
  const liveValues = visible.filter((i) => !i.pending).map((i) => Math.abs(i.value || 0))
  const maxVal = Math.max(...liveValues, 1)
  const totalVal = liveValues.reduce((s, v) => s + v, 0) || 1

  return (
    <div className={`rwa-hbars${compact ? ' compact' : ''}`}>
      <div className="rwa-hbars-head">
        <h4 className="rwa-hbars-title">{title}</h4>
        {subtitle && <span className="rwa-hbars-sub">{subtitle}</span>}
      </div>
      <div className="rwa-hbars-list">
        {visible.map((item, i) => {
          const absVal = Math.abs(item.value || 0)
          const pct = item.pending ? 0 : (absVal / totalVal) * 100
          const rawBarW = item.pending
            ? Math.max(minBarPct, 6)              // pending = small but visible
            : (absVal / maxVal) * 100
          // Honor the minBarPct floor for any non-zero live value.
          const barW = !item.pending && absVal > 0
            ? Math.max(rawBarW, minBarPct)
            : rawBarW
          const color = item.color || '#64748B'
          const isBull = item.change != null && item.change >= 0

          const isClickable = Boolean(onRowClick && (item.slug || item.label))
          const rowClass = `rwa-hbar-row${isClickable ? ' clickable' : ''}${item.pending ? ' rwa-hbar-row-pending' : ''}`
          return (
            <div
              key={item.label + i}
              className={rowClass}
              onClick={isClickable ? () => onRowClick(item) : undefined}
              style={isClickable ? { cursor: 'pointer' } : undefined}
              title={item.pending ? pendingTitle : undefined}
            >
              <span className="rwa-hbar-rank mono">{i + 1}</span>
              <span className="rwa-hbar-dot" style={{ background: color }} />
              {item.logo && (
                <img
                  className="rwa-hbar-logo"
                  src={item.logo}
                  alt=""
                  loading="lazy"
                  onError={e => { e.target.style.display = 'none' }}
                />
              )}
              <span className="rwa-hbar-label">
                {item.label}
                {item.pending && <span className="rwa-hbar-pending-badge">{t('tokenizedAssets.horizontalBars.pending', 'pending')}</span>}
              </span>
              <div className="rwa-hbar-track">
                <div
                  className={`rwa-hbar-fill${item.pending ? ' rwa-hbar-fill-pending' : ''}`}
                  // Width + bar colors drive a CSS custom property each, so the
                  // gradient/border lives in CSS (rwa-hbar-fill) instead of a
                  // fresh multi-prop inline object per row on every render.
                  // Live: gradient (lighter at top) for depth. Pending: striped
                  // pattern via the .rwa-hbar-fill-pending class only.
                  style={item.pending
                    ? { '--bar-w': `${barW}%` }
                    : {
                        '--bar-w': `${barW}%`,
                        '--bar-grad-top': hexToRgba(color, 0.7),
                        '--bar-grad-bottom': hexToRgba(color, 0.42),
                        '--bar-border': hexToRgba(color, 0.85),
                      }}
                />
              </div>
              <span className="rwa-hbar-value mono">{item.pending ? '—' : fmtUsd(absVal)}</span>
              {showChange && item.change != null ? (
                <span className={`rwa-hbar-change mono ${isBull ? 'bull' : 'bear'}`}>
                  {isBull ? '+' : ''}{item.change.toFixed(1)}%
                </span>
              ) : (
                <span className="rwa-hbar-pct mono">{item.pending ? t('tokenizedAssets.horizontalBars.pending', 'pending') : `${pct.toFixed(2)}%`}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
