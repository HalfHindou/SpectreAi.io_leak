/**
 * LITE Money Flow — "how many dollars entered or left the market today".
 *
 * The one number a non-trader actually understands: the sum of every asset's
 * implied market-cap delta. The map underneath shows WHERE it came from —
 * tile size is the asset's market cap, colour is its move.
 *
 * Rides the shared LITE data hook (crypto) and the shared stock-quote module
 * cache (stocks). No new endpoints, no ad-hoc fetches.
 */
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MoneyFlowTreemap from '@/components/money-flow-treemap'
import { track, Events } from '@/services/analytics'
import { getStockLogoFallback } from '@/services/stockApi'
import { isStableOrWrapped } from './use-lite-data'
import { useStockFlowRows } from './lite-stocks'

const COUNTS = [40, 100]

export default function FlowsView({ data, market, light = false, onOpenPath, onPickResearch }) {
  const { t } = useTranslation()
  const isStocks = market === 'stocks'
  const [count, setCount] = useState(40)
  // The PRO stock universe, NOT the LITE board — see useStockFlowRows. A market
  // total computed from a different list is a different number, and that is the
  // whole reason LITE and PRO used to disagree about the same day.
  const stockRows = useStockFlowRows(isStocks)

  const rows = useMemo(() => {
    const src = isStocks
      ? stockRows
      : (data?.marketRowsWide || data?.marketRows || []).filter((r) => !isStableOrWrapped(r.symbol)).slice(0, count)
    return src
      .filter((r) => Number(r.marketCap) > 0)
      .map((r) => ({
        id: r.id || r.symbol,
        symbol: r.symbol,
        name: r.name,
        logo: r.image || null,
        // FMP is the primary stock CDN; CompaniesMarketCap is the second try
        // before the monogram chip. Same ladder the Pro heatmap uses.
        logoFallback: r.isStock ? getStockLogoFallback(r.symbol) : null,
        marketCap: Number(r.marketCap) || 0,
        change: Number(r.change) || 0,
        price: r.price,
        isStock: !!r.isStock,
      }))
  }, [isStocks, stockRows, data?.marketRowsWide, data?.marketRows, count])

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{t('lite.tab.flows', 'Money Flow')}</h1>
        <p className="lite-view-sub">
          {t('lite.flows.sub', 'How many dollars were added to - or pulled out of - the market today. Bigger tile, bigger company.')}
        </p>
      </header>

      {!isStocks && (
        <div className="lite-toolrow lite-rise">
          <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.flowsview.ariaTileCount', "Tile count")}>
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={count === n}
                className={`lite-tf-btn${count === n ? ' active' : ''}`}
                onClick={() => setCount(n)}
              >
                {t('lite.opt.top_n', 'Top {{n}}', { n })}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="lite-rise-1">
        <MoneyFlowTreemap
          rows={rows}
          marketLabel={isStocks ? t('moneyFlow.marketStocks', 'US stocks') : t('moneyFlow.marketCrypto', 'crypto')}
          periodLabel={t('moneyFlow.periodToday', 'today')}
          scopeNote={isStocks ? t('moneyFlow.scopeFunds', 'index funds hold the same shares, so they are not counted twice') : ''}
          light={light}
          compact
          onSelect={(row) => onPickResearch?.(row.symbol, { stock: row.isStock })}
        />
      </div>

      {onOpenPath && (
        <button
          type="button"
          className="lite-prolink"
          onClick={() => { track(Events.LITE_PRO_DOOR, { path: '/heatmaps' }); onOpenPath('/heatmaps') }}
        >
          {t('lite.flows.pro', 'Full money-flow map in PRO')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  )
}
