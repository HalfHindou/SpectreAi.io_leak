import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

/**
 * RwaFlowBoard
 * Slim split list — top 4 inflows + top 3 outflows. Designed to sit in a
 * narrow ROW 2 column. Heavier expanded version lives in
 * `creatives/LiveFlowTicker.jsx`.
 *
 * Props:
 *   movers: { gainers: [...], losers: [...] }
 *   loading: boolean
 *   onSeeAll?: () => void
 */

function isSingleDaySpike(p) {
  const c1 = p.change_1d, c7 = p.change_7d
  if (c1 == null || c7 == null) return false
  if (Math.abs(c7) < 0.5) return false
  if ((c1 > 0) !== (c7 > 0)) return false
  return Math.abs(c1) > Math.abs(c7) * 1.1
}

function buildRows(list, sign, limit) {
  return (list || [])
    .filter(p => !isSingleDaySpike(p))
    .map(p => {
      const change = p.change_7d ?? p.change_1d ?? 0
      const tvl = p.tvl || 0
      const flow = tvl * (change / 100)
      return { slug: p.slug, name: p.name, logo: p.logo, tvl, change, flow }
    })
    .filter(r => r.tvl >= 2e6 && (sign > 0 ? r.change > 0 : r.change < 0))
    .sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow))
    .slice(0, limit)
}

function RwaFlowBoard({ movers, loading, onSeeAll }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtSignedUsd = (v) => {
    if (v == null || !isFinite(v)) return '--'
    // Sign FIRST, then the currency. fmtLargeShort leaves the minus inside its
    // own output ("$-510.24M"), which sat next to this helper's own "+$1.69B"
    // and read as two different formats for the same measurement.
    return `${v < 0 ? '-' : '+'}${fmtLargeShort(Math.abs(v))}`
  }
  const inflows = useMemo(() => buildRows(movers?.gainers, +1, 4), [movers])
  const outflows = useMemo(() => buildRows(movers?.losers, -1, 3), [movers])

  if (loading && !inflows.length && !outflows.length) {
    return (
      <section className="rfb">
        <header className="rfb__head">
          <span className="rfb__title">{t('tokenizedAssets.flowBoard.title', '7D Flow Board')}</span>
        </header>
        <div className="rfb__list">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`rfb__skel animate-shimmer stagger-${(i % 5) + 1}`} />
          ))}
        </div>
      </section>
    )
  }

  if (!inflows.length && !outflows.length) {
    return (
      <section className="rfb rfb--empty">
        <header className="rfb__head">
          <span className="rfb__title">{t('tokenizedAssets.flowBoard.title', '7D Flow Board')}</span>
        </header>
        <div className="rfb__empty">{t('tokenizedAssets.flowBoard.empty', 'No notable flows in the last 7 days.')}</div>
      </section>
    )
  }

  return (
    <section className="rfb" aria-label={t('tokenizedAssets.flowBoard.title', '7D Flow Board')}>
      <header className="rfb__head">
        <span className="rfb__title">{t('tokenizedAssets.flowBoard.title', '7D Flow Board')}</span>
        <span className="rfb__sub">{t('tokenizedAssets.flowBoard.subtitle', 'Top net flows by asset')}</span>
      </header>

      <ul className="rfb__list">
        {inflows.length > 0 && (
          <li className="rfb__group rfb__group--in" aria-hidden="true">{t('tokenizedAssets.netFlows.inflows', 'Inflows')}</li>
        )}
        {inflows.map(r => (
          <li key={`in-${r.slug || r.name}`} className="rfb__row rfb__row--in">
            {r.logo ? (
              <img
                className="rfb__logo"
                src={r.logo} alt="" loading="lazy"
                onError={e => { e.currentTarget.style.visibility = 'hidden' }}
              />
            ) : <span className="rfb__logo rfb__logo--fb">{(r.name || '?')[0]}</span>}
            <span className="rfb__name">{r.name}</span>
            <span className="rfb__amt mono rfb__amt--in">{fmtSignedUsd(r.flow)}</span>
          </li>
        ))}
        {outflows.length > 0 && (
          <li className="rfb__group rfb__group--out" aria-hidden="true">{t('tokenizedAssets.netFlows.outflows', 'Outflows')}</li>
        )}
        {outflows.map(r => (
          <li key={`out-${r.slug || r.name}`} className="rfb__row rfb__row--out">
            {r.logo ? (
              <img
                className="rfb__logo"
                src={r.logo} alt="" loading="lazy"
                onError={e => { e.currentTarget.style.visibility = 'hidden' }}
              />
            ) : <span className="rfb__logo rfb__logo--fb">{(r.name || '?')[0]}</span>}
            <span className="rfb__name">{r.name}</span>
            <span className="rfb__amt mono rfb__amt--out">{fmtSignedUsd(r.flow)}</span>
          </li>
        ))}
      </ul>

      <button type="button" className="rfb__cta" onClick={onSeeAll}>
        {t('tokenizedAssets.flowBoard.viewFull', 'View Full Flow Board')} <span aria-hidden>&rarr;</span>
      </button>
    </section>
  )
}

// The 3min RWA poll re-parses the bundle JSON, so `movers` is a fresh object
// each tick even when values are identical. Compare the fields buildRows reads
// (not refs) so the board only re-renders on a real flow change.
function sameMoverList(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (
      x.slug !== y.slug || x.name !== y.name || x.logo !== y.logo ||
      x.tvl !== y.tvl || x.change_7d !== y.change_7d ||
      x.change_1d !== y.change_1d
    ) return false
  }
  return true
}

function flowBoardEqual(prev, next) {
  return (
    prev.loading === next.loading &&
    prev.onSeeAll === next.onSeeAll &&
    sameMoverList(prev.movers?.gainers, next.movers?.gainers) &&
    sameMoverList(prev.movers?.losers, next.movers?.losers)
  )
}

export default React.memo(RwaFlowBoard, flowBoardEqual)
