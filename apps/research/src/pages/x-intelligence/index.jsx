import useSettingsStore from '@/store/useSettingsStore'
import XIntelligencePage from './components/XIntelligencePage'

export default function XIntelligencePageWrapper() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const toggleDayMode = useSettingsStore((s) => s.toggleDayMode)
  return <XIntelligencePage dayMode={dayMode} onToggleDayMode={toggleDayMode} />
}
