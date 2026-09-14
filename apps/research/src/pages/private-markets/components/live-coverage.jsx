/**
 * LiveCoverage — realtime coverage band for the featured listing (SpaceX).
 *
 * Three panels: Market Summary (news), Polymarket predictions, Kalshi
 * predictions. All poll on an interval and skip while the tab is hidden, so
 * the surface stays "always live" without burning background work.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import NewsPanel from './news-panel'
import PredictionPanel from './prediction-panel'
import { getCompanyNews, getPredictions } from './private-markets-api'

const POLL_MS = 2 * 60 * 1000

export default function LiveCoverage({ company, ticker, query }) {
  const { t } = useTranslation()
  const [news, setNews] = useState({ list: [], loading: true })
  const [poly, setPoly] = useState({ list: [], loading: true })
  const [kalshi, setKalshi] = useState({ list: [], loading: true })
  const cancelledRef = useRef(false)
  const predictionQuery = query || company

  // LiveCoverage sits directly under the hero but its 3-way news Promise.all +
  // predictions fetch fire on mount, before the user scrolls to it. Gate on the
  // section entering the viewport (mirror rwa-tweets.jsx); fall back to an
  // immediate fire on browsers without IntersectionObserver.
  const sentinelRef = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return undefined
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver !== 'function') {
      setVisible(true)
      return undefined
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const [n, preds] = await Promise.all([
      getCompanyNews(company, ticker),
      getPredictions(predictionQuery),
    ])
    if (cancelledRef.current) return
    setNews({ list: n, loading: false })
    setPoly({ list: preds.polymarket, loading: false })
    setKalshi({ list: preds.kalshi, loading: false })
  }, [company, ticker, predictionQuery])

  useEffect(() => {
    if (!visible) return undefined
    cancelledRef.current = false
    load()
    return () => { cancelledRef.current = true }
  }, [visible, load])

  // Poll only once the section has been seen — keeps the band live without
  // burning requests while it's still below the fold.
  useAdaptivePolling(load, { interval: POLL_MS, enabled: visible })

  return (
    <section ref={sentinelRef} className="pi-coverage" aria-label={t('privateMarkets.preIpo.coverage.title')}>
      <div className="pi-coverage-head">
        <span className="pi-coverage-title">
          <span className="pi-status-dot" aria-hidden="true" />
          {t('privateMarkets.preIpo.coverage.title')}
        </span>
        <span className="pi-coverage-sub caption">{t('privateMarkets.preIpo.coverage.sub', { company })}</span>
      </div>
      <div className="pi-coverage-grid">
        <NewsPanel news={news} title={t('privateMarkets.preIpo.coverage.marketSummary')} />
        <PredictionPanel source="polymarket" markets={poly} />
        <PredictionPanel source="kalshi" markets={kalshi} />
      </div>
    </section>
  )
}
