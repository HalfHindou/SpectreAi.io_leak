import { Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useSettingsStore from '@/store/useSettingsStore'

const AlertsPageComponent = lazy(() => import('./components/alerts-page'))

export default function Alerts() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  return (
    <Suspense fallback={<div style={{ padding: 32, color: '#f5f5f7' }}>Loading alerts...</div>}>
      <AlertsPageComponent dayMode={dayMode} />
    </Suspense>
  )
}
