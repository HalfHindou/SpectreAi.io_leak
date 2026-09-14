import useSettingsStore from '@/store/useSettingsStore'
import PulsePage from './components/pulse-page'

export default function PulsePageWrapper() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  return <PulsePage dayMode={dayMode} />
}
