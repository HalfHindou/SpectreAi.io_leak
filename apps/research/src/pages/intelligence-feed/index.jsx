import { useNavigate } from 'react-router-dom'
import IntelligenceFeedPage from './components/IntelligenceFeedPage'
import useSettingsStore from '@/store/useSettingsStore'

export default function IntelligenceFeedPageWrapper() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  return <IntelligenceFeedPage dayMode={dayMode} navigate={navigate} />
}
