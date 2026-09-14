import { useNavigate } from 'react-router-dom'
import ROICalculatorPageComponent from './components/roi-calculator-page'
import useSettingsStore from '@/store/useSettingsStore'

export default function ROICalculatorPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)

  return (
    <ROICalculatorPageComponent
      dayMode={dayMode}
      onBack={() => navigate('/')}
    />
  )
}
