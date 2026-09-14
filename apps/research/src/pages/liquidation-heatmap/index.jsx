import { useNavigate } from 'react-router-dom'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import LiquidationPage from './components/liquidation-page'

export default function LiquidationHeatmapPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()

  return (
    <LiquidationPage
      dayMode={dayMode}
      isMobile={isMobile}
      onTokenClick={(slug) => navigate(`/research-zone/${slug}`)}
    />
  )
}
