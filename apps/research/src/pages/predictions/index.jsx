/**
 * Predictions page wrapper
 * Routes to detail view when eventSlug present, otherwise shows landing grid.
 */
import { Suspense } from 'react'
import { useParams } from 'react-router-dom'
import lazy from '@/lib/lazy-with-retry'
import useSettingsStore from '@/store/useSettingsStore'
import PredictionsPage from './components/predictions-page'
// Detail view (39 KB) only renders on /predictions/:eventSlug.
// Uses lazyWithRetry (NOT plain React.lazy) so a stale-deploy chunk 404 on
// click self-recovers (in-place retry -> SW purge + reload) instead of
// dead-ending on the "Something went wrong" boundary. See lib/chunk-recovery.js.
const PredictionDetail = lazy(() => import('./components/prediction-detail'))

function PredictionsPageWrapper() {
  const { eventSlug } = useParams()
  const dayMode = useSettingsStore((s) => s.dayMode)

  if (eventSlug) {
    return (
      <Suspense fallback={null}>
        <PredictionDetail dayMode={dayMode} />
      </Suspense>
    )
  }

  return <PredictionsPage dayMode={dayMode} />
}

export default PredictionsPageWrapper
