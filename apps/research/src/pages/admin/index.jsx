import { useNavigate } from 'react-router-dom'
import useSettingsStore from '@/store/useSettingsStore'
import AdminPage from './components/admin-page'

export default function AdminPageWrapper() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)

  return (
    <AdminPage
      dayMode={dayMode}
      onBack={() => navigate('/')}
    />
  )
}
