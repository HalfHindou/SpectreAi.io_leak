import { useNavigate, useParams } from 'react-router-dom'
import CategoriesPageComponent from './components/categories-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function CategoriesPage() {
  const navigate = useNavigate()
  const { categoryId } = useParams()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const isMobile = useIsMobile()

  return (
    <CategoriesPageComponent
      dayMode={dayMode}
      onBack={() => navigate('/')}
      marketMode={marketMode}
      isMobile={isMobile}
      initialCategoryId={categoryId}
    />
  )
}
