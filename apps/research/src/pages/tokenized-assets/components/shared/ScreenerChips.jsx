import React from 'react'
import { useTranslation } from 'react-i18next'
import './ta-chips.css'

const DEFAULT_PRESETS = [
  { id: 'treasury', label: 'Treasury Management' },
  { id: 'yields', label: 'Yields' },
  { id: 'growth', label: 'Growth' },
  { id: 'bluechip', label: 'Blue-chip' },
  { id: 'new', label: 'New' },
]

const MIN_AUM_TIERS = [
  { id: 'any', label: 'Any' },
  { id: '1m', label: '$1M+' },
  { id: '10m', label: '$10M+' },
  { id: '100m', label: '$100M+' },
  { id: '1b', label: '$1B+' },
]

/**
 * ScreenerChips — preset filter chips + min-AUM tier buttons.
 *
 * Props:
 *   preset: string | null
 *   minAum: one of MIN_AUM_TIERS.id
 *   onChange: ({ preset, minAum }) => void
 *   presets?: override preset list
 */
export default function ScreenerChips({ preset, minAum = 'any', onChange, presets = DEFAULT_PRESETS }) {
  const { t } = useTranslation()
  const setPreset = (id) => onChange?.({ preset: preset === id ? null : id, minAum })
  const setAum = (id) => onChange?.({ preset, minAum: id })

  return (
    <div className="ta-chips">
      <div className="ta-chips-row">
        <span className="ta-chips-row-label">{t('tokenizedAssets.screener.presetsLabel', 'Presets')}</span>
        <div className="ta-chips-group">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`ta-chip${preset === p.id ? ' active' : ''}`}
              onClick={() => setPreset(p.id)}
            >
              {p.labelKey ? t(p.labelKey, p.labelFallback || p.label) : p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ta-chips-row">
        <span className="ta-chips-row-label">{t('tokenizedAssets.screener.minAum', 'Min AUM')}</span>
        <div className="ta-chips-tiers">
          {MIN_AUM_TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ta-chip-tier${minAum === t.id ? ' active' : ''}`}
              onClick={() => setAum(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export { MIN_AUM_TIERS, DEFAULT_PRESETS }
