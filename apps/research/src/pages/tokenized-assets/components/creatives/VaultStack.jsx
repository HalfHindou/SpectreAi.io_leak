import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import './creative-base.css'
import './VaultStack.css'

/**
 * VaultStack — isometric-ish stacked bars for commodity composition.
 * Pure CSS transforms. Gold on bottom (widest), silver, platinum, palladium on top.
 * Rise animation on mount.
 */

export default function VaultStack({ items = [], loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || !isFinite(v) ? '—' : fmtLargeShort(v))
  const { bars, total } = useMemo(() => {
    const total = (items || []).reduce((s, t) => s + (t.value || 0), 0)
    // Aggregate by label across EVERY material type (the old fixed ORDER list
    // silently dropped carbon/petroleum/industrial/agricultural/baskets).
    const byLabel = {}
    for (const it of items || []) {
      if (!byLabel[it.label]) byLabel[it.label] = { label: it.label, value: 0, color: it.color }
      byLabel[it.label].value += (it.value || 0)
    }
    const bars = Object.values(byLabel)
      .filter(b => b.value > 0)
      .sort((a, b) => b.value - a.value) // largest at the base (widest)
      .map((b, idx) => ({ ...b, idx, pct: total > 0 ? (b.value / total) * 100 : 0 }))
    return { bars, total }
  }, [items])

  return (
    <div className="ta-creative ta-vault">
      <div className="ta-creative__head">
        <span className="ta-creative__title">{t('tokenizedAssets.creatives.vaultStack.title', 'Vault Composition')}</span>
        <span className="ta-creative__sub mono">{t('tokenizedAssets.creatives.vaultStack.totalSuffix', '{{value}} total', { value: formatValue(total) })}</span>
      </div>

      {loading || !bars.length ? (
        <div className="ta-vault__skel animate-shimmer" />
      ) : (
        <div className="ta-vault__stage">
          <div className="ta-vault__stack">
            {bars.map((b, i) => (
              <div
                key={b.label}
                className={`ta-vault__bar ta-vault__bar--${b.label.toLowerCase()}`}
                style={{
                  width: `${Math.max(18, b.pct)}%`,
                  animationDelay: `${i * 90}ms`,
                  background: b.color || undefined,
                }}
                title={`${b.label} · ${formatValue(b.value)} · ${b.pct.toFixed(1)}%`}
              >
                <span className="ta-vault__bar-shine" />
                <span className="ta-vault__bar-inner">
                  <span className="ta-vault__bar-label">{t(`tokenizedAssets.commodityType.${b.label}`, b.label)}</span>
                </span>
                <span className="ta-vault__bar-tag">
                  <span className="ta-vault__bar-tag-val mono">{formatValue(b.value)}</span>
                  <span className="ta-vault__bar-tag-pct mono">{b.pct.toFixed(1)}%</span>
                </span>
              </div>
            ))}
          </div>

          <div className="ta-vault__plinth" aria-hidden />
        </div>
      )}
    </div>
  )
}
