import AIChartsPageComponent from './components/ai-charts-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function AIChartsPage() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const isMobile = useIsMobile()

  return (
    <AIChartsPageComponent
      dayMode={dayMode}
      marketMode={marketMode}
      isMobile={isMobile}
    />
  )
}
