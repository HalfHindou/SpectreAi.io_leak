/**
 * PredictionPanel — a live prediction-market panel (Polymarket or Kalshi).
 *
 * Each market renders its question + top outcomes as labelled probability bars,
 * with traded volume and a link out to the source. Pure presentational; the
 * normalized market shape ({ question, url, volume, outcomes:[{label,prob}] })
 * comes from private-markets-api.
 */
import { useTranslation } from 'react-i18next'

const SOURCE_META = {
  polymarket: { label: 'Polymarket', host: 'polymarket.com' },
  kalshi: { label: 'Kalshi', host: 'kalshi.com' },
}

function fmtVol(n, source, t) {
  if (!n) return null
  // Polymarket volume is USD; Kalshi volume is contract count.
  if (source === 'kalshi') {
    if (n >= 1e6) return t('privateMarkets.predictionPanel.contractsM', { n: (n / 1e6).toFixed(1) })
    if (n >= 1e3) return t('privateMarkets.predictionPanel.contractsK', { n: (n / 1e3).toFixed(0) })
    return t('privateMarkets.predictionPanel.contracts', { n })
  }
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}

function MarketCard({ market, source }) {
  const { t } = useTranslation()
  const vol = fmtVol(market.volume, source, t)
  return (
    <a className="pi-pred-card" href={market.url} target="_blank" rel="noopener noreferrer">
      <div className="pi-pred-q">{market.question}</div>
      {market.subtitle && <div className="pi-pred-sub caption">{market.subtitle}</div>}
      <div className="pi-pred-outcomes">
        {market.outcomes.slice(0, 5).map((o, i) => (
          <div className="pi-pred-row" key={`${o.label}-${i}`}>
            <span className="pi-pred-bar" style={{ width: `${Math.max(2, Math.min(100, o.prob))}%` }} aria-hidden="true" />
            <span className="pi-pred-label">{o.label}</span>
            <span className="pi-pred-prob mono">{o.prob}%</span>
          </div>
        ))}
      </div>
      {vol && <div className="pi-pred-vol caption">{vol} vol</div>}
    </a>
  )
}

export default function PredictionPanel({ source, markets }) {
  const { t } = useTranslation()
  const meta = SOURCE_META[source] || { label: source }
  const { list = [], loading } = markets || {}

  return (
    <div className="pi-panel glass-card">
      <div className="pi-panel-head">
        <span className="pi-panel-title">{meta.label}</span>
        <span className="pi-panel-tag">{t('privateMarkets.predictionPanel.tag', 'Predictions')}</span>
      </div>
      <div className="pi-panel-body">
        {loading && list.length === 0 &&
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="pi-skel animate-shimmer" style={{ height: 96, borderRadius: 12 }} />
          ))}
        {!loading && list.length === 0 && (
          <div className="pi-panel-empty caption">No active {meta.label} markets.</div>
        )}
        {list.map((m) => (
          <MarketCard key={m.id} market={m} source={source} />
        ))}
      </div>
    </div>
  )
}
