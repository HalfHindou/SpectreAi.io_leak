import useSettingsStore from '@/store/useSettingsStore'
import ArenaPage from './components/arena-page'

export default function Arena() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  return <ArenaPage dayMode={dayMode} />
}
