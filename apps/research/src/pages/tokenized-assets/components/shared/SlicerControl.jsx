import React from 'react'
import { useTranslation } from 'react-i18next'
import './ta-slicer.css'

/**
 * SlicerControl — 3-axis segmented control (Type × Metric × Grouping).
 * Each axis is rendered as a labeled segmented group.
 *
 * Props:
 *   type, metric, grouping:   currently-selected value per axis
 *   onChange: (nextState: {type,metric,grouping}) => void
 *   axes: { type: [{id,label}...], metric: [...], grouping: [...] }
 *   labels: optional per-axis labels e.g. { type: 'Class', metric: 'Metric', grouping: 'Group' }
 */
export default function SlicerControl({
  type,
  metric,
  grouping,
  onChange,
  axes,
  labels,
}) {
  const { t } = useTranslation()
  const cur = { type, metric, grouping }
  const L = {
    type: labels?.type || t('tokenizedAssets.slicer.class', 'Class'),
    metric: labels?.metric || t('tokenizedAssets.slicer.metric', 'Metric'),
    grouping: labels?.grouping || t('tokenizedAssets.slicer.group', 'Group'),
  }

  const axisKeys = ['type', 'metric', 'grouping']

  const handle = (axis, nextId) => {
    if (cur[axis] === nextId) return
    onChange?.({ ...cur, [axis]: nextId })
  }

  return (
    <div className="ta-slicer" role="group" aria-label={t('tokenizedAssets.slicer.axisLabel', 'Slicer')}>
      {axisKeys.map((axis) => {
        const opts = axes?.[axis]
        if (!opts?.length) return null
        return (
          <div key={axis} className="ta-slicer-axis">
            <span className="ta-slicer-axis-label">{L[axis]}</span>
            <div className="ta-slicer-group" role="tablist">
              {opts.map((o) => {
                const active = cur[axis] === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`ta-slicer-seg${active ? ' active' : ''}`}
                    onClick={() => handle(axis, o.id)}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
