import useSettingsStore from '@/store/useSettingsStore'
import BrainEagle from './components/brain-eagle'

export default function BrainPage() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  return <BrainEagle dayMode={dayMode} />
}
