/**
 * AI Market Analysis — a shell for the analysis surfaces, not a single page.
 *
 * It started as one long scroll ("The Loop"), which was retired on 2026-08-24.
 * Each view is a whole feature, and adding the next one is a row in VIEWS plus
 * a component.
 *
 * The three read as one question in three tenses: what markets are doing now,
 * what is priced next, and what usually happens. Positioning sits in the
 * middle because that is where it falls in time, not because it arrived last.
 *
 * The active view lives in the URL (`?view=seasonality`) so a view is linkable
 * and survives a refresh — the thing burying this board inside another page's
 * tab had cost it.
 */
import { Suspense, useCallback } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useSearchParams } from 'react-router-dom'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import './ai-market-analysis-shell.css'

/* The seasonal board is a page's worth of code (matrix, compass, backtest) and
   The Loop is the default view — keep it off this route's first chunk. */
const YearlyAnalysis = lazy(() => import('./components/yearly-analysis'))
const CrossAssetView = lazy(() => import('./components/crossasset-view'))
const PositioningView = lazy(() => import('./components/positioning-view'))

/* The Loop is gone rather than parked as a tab — its regime card is rebuilt as
   "The state" at the top of Cross-Asset, which is where a headline belongs.
   Recover the old page from git at e7dc0d8fa if needed. */
const VIEWS = [
  { id: 'crossasset', label: 'Cross-Asset', hint: 'Every market that prices crypto, and what it moves with' },
  { id: 'positioning', label: 'Positioning', hint: 'What the equity options market has priced, and for which date' },
  { id: 'seasonality', label: 'Seasonality', hint: 'Every month each asset has ever traded' },
]

export default function AIMarketAnalysisPage() {
  const [params, setParams] = useSearchParams()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const isMobile = useIsMobile()

  const requested = params.get('view')
  const view = VIEWS.some((v) => v.id === requested) ? requested : 'crossasset'
  const active = VIEWS.find((v) => v.id === view)

  const pick = useCallback((id) => {
    const next = new URLSearchParams(params)
    if (id === 'crossasset') next.delete('view')
    else next.set('view', id)
    // replace, not push: flipping a view is not a place you want the back
    // button to walk through one tab at a time.
    setParams(next, { replace: true })
  }, [params, setParams])

  return (
    <div className={`aim-shell${isMobile ? ' aim-shell--mobile' : ''}${dayMode ? ' day-mode' : ''}`}>
      <div className="aim-tabbar" role="tablist" aria-label="Market analysis views">
        <div className="aim-tabs">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={`aim-tab${view === v.id ? ' is-active' : ''}`}
              onClick={() => pick(v.id)}
            >{v.label}</button>
          ))}
        </div>
        <span className="aim-tab-hint">{active?.hint}</span>
      </div>

      <Suspense fallback={<div className="aim-view-boot" />}>
        <div className="aim-view">
          {view === 'seasonality' && <YearlyAnalysis dayMode={dayMode} marketMode={marketMode} isMobile={isMobile} />}
          {view === 'positioning' && <PositioningView dayMode={dayMode} isMobile={isMobile} />}
          {view === 'crossasset' && <CrossAssetView dayMode={dayMode} marketMode={marketMode} isMobile={isMobile} />}
        </div>
      </Suspense>
    </div>
  )
}
