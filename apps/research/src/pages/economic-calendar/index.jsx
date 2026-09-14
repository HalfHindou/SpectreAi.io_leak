import { useNavigate } from 'react-router-dom'
import EconomicCalendarPageComponent from './components/economic-calendar-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function EconomicCalendarPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const isMobile = useIsMobile()

  return (
    <EconomicCalendarPageComponent
      dayMode={dayMode}
      isMobile={isMobile}
      onBack={() => navigate('/')}
      marketMode={marketMode}
    />
  )
}
