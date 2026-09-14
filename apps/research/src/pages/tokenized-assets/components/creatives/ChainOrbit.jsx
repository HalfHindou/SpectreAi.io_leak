import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { TA_CATEGORICAL } from '../shared/ta-tokens'
import './creative-base.css'
import './ChainOrbit.css'

/**
 * ChainOrbit — top chains arranged in orbit around a central "RWA TVL" core.
 * Whole orbit rotates 30s/revolution; labels counter-rotate so they stay upright.
 * Connection lines from center to each chain, opacity = TVL weight.
 */

export default function ChainOrbit({ chains = [], protocolCounts = {}, loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || !isFinite(v) ? '—' : fmtLargeShort(v))
  const [hover, setHover] = useState(null)

  const { nodes, total } = useMemo(() => {
    const top = (chains || []).slice(0, 8)
    const total = top.reduce((s, c) => s + (c.tvl || 0), 0)
    const maxTvl = Math.max(1, ...top.map(c => c.tvl || 0))
    const nodes = top.map((c, i) => {
      const angle = (i / Math.max(1, top.length)) * Math.PI * 2 - Math.PI / 2
      // orbit radius slightly vary by rank for a subtle ring shape
      const r = 38 - (i % 2) * 3
      const x = 50 + Math.cos(angle) * r
      const y = 50 + Math.sin(angle) * r
      const weight = maxTvl > 0 ? (c.tvl || 0) / maxTvl : 0
      const size = 5 + weight * 5.5
      return {
        chain: c.chain,
        tvl: c.tvl || 0,
        protocols: protocolCounts?.[c.chain] || 0,
        weight,
        x, y, size,
        angleDeg: (angle * 180 / Math.PI) + 90,
        color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
      }
    })
    return { nodes, total }
  }, [chains, protocolCounts])

  return (
    <div className="ta-creative ta-orbit">
      <div className="ta-creative__head">
        <span className="ta-creative__title">{t('tokenizedAssets.creatives.chainOrbit.title', 'Chain Gravity')}</span>
        <span className="ta-creative__sub">{t('tokenizedAssets.creatives.chainOrbit.subtitle', 'by TVL weight')}</span>
      </div>

      {loading || !nodes.length ? (
        <div className="ta-orbit__skel animate-shimmer" />
      ) : (
        <div className="ta-orbit__wrap">
          <svg viewBox="0 0 100 100" className="ta-orbit__svg" role="img" aria-label={t('tokenizedAssets.creatives.chainOrbit.ariaLabel', 'Top chains orbit by TVL')}>
            <defs>
              <radialGradient id="ta-orbit-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(245,245,247,0.18)" />
                <stop offset="100%" stopColor="rgba(245,245,247,0)" />
              </radialGradient>
            </defs>

            {/* Background orbit guides */}
            <circle cx="50" cy="50" r="14" className="ta-orbit__ring" />
            <circle cx="50" cy="50" r="28" className="ta-orbit__ring" />
            <circle cx="50" cy="50" r="38" className="ta-orbit__ring ta-orbit__ring--main" />

            {/* Spinning cluster */}
            <g className="ta-orbit__spin">
              {/* Lines from center */}
              {nodes.map((n) => (
                <line
                  key={`ln-${n.chain}`}
                  x1="50" y1="50" x2={n.x} y2={n.y}
                  className="ta-orbit__line"
                  style={{ opacity: 0.12 + n.weight * 0.45 }}
                />
              ))}

              {/* Chain nodes */}
              {nodes.map((n) => (
                <g
                  key={n.chain}
                  className={`ta-orbit__node${hover === n.chain ? ' is-hover' : ''}`}
                  onMouseEnter={() => setHover(n.chain)}
                  onMouseLeave={() => setHover(null)}
                  style={{ color: n.color }}
                >
                  <circle cx={n.x} cy={n.y} r={n.size + 1.5} className="ta-orbit__halo" />
                  <circle cx={n.x} cy={n.y} r={n.size} className="ta-orbit__bubble" />
                  {/* Counter-rotating label group */}
                  <g
                    className="ta-orbit__label-counter"
                    transform={`translate(${n.x} ${n.y})`}
                  >
                    <text
                      textAnchor="middle"
                      dy="0.9"
                      className="ta-orbit__label"
                    >
                      {(n.chain || '?').slice(0, 3).toUpperCase()}
                    </text>
                  </g>
                </g>
              ))}
            </g>

            {/* Center core */}
            <circle cx="50" cy="50" r="10" fill="url(#ta-orbit-core)" />
            <circle cx="50" cy="50" r="8" className="ta-orbit__core" />
            <text x="50" y="49.5" textAnchor="middle" className="ta-orbit__core-top">{t('tokenizedAssets.creatives.chainOrbit.coreLabel', 'RWA TVL')}</text>
            <text x="50" y="54" textAnchor="middle" className="ta-orbit__core-bot">{formatValue(total)}</text>
          </svg>

          {hover && (() => {
            const n = nodes.find(x => x.chain === hover)
            if (!n) return null
            return (
              <div className="ta-orbit__tooltip">
                <span className="ta-orbit__tooltip-name">{n.chain}</span>
                <span className="ta-orbit__tooltip-val mono">{formatValue(n.tvl)}</span>
                <span className="ta-orbit__tooltip-sub">{t('tokenizedAssets.creatives.chainOrbit.protocolsCount', '{{count}} protocols', { count: n.protocols })}</span>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
