import { useNavigate } from 'react-router-dom'
import useSettingsStore from '@/store/useSettingsStore'
import WorldPageComponent from './components/world-page'

export default function WorldPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  return <WorldPageComponent dayMode={dayMode} onClose={() => navigate('/')} />
}
