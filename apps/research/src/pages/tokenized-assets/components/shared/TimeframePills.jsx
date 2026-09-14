import React from 'react'
import { useTranslation } from 'react-i18next'
import './ta-timeframe.css'

// IDs mirror RwaInteractiveChart's TIMEFRAMES so tab-level pills actually
// drive the hero chart via the defaultTimeframe prop.
const DEFAULT_OPTIONS = [
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: '6M', label: '6M' },
  { id: '1Y', label: '1Y' },
  { id: '2Y', label: '2Y' },
  { id: 'All', label: 'All' },
]

export default function TimeframePills({ value, onChange, options = DEFAULT_OPTIONS, size = 'md' }) {
  const { t } = useTranslation()
  return (
    <div className={`ta-tf ta-tf-${size}`} role="tablist" aria-label={t('tokenizedAssets.timeframe.label', 'Timeframe')}>
      {options.map((o) => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ta-tf-pill${active ? ' active' : ''}`}
            onClick={() => onChange?.(o.id)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
