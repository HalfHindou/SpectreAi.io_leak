import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import FearGreedPageComponent from './components/fear-greed-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useAppState } from '@/contexts/AppStateContext'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function FearGreedPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const { selectToken } = useAppState()
  const isMobile = useIsMobile()

  const handleTokenClick = useCallback((tokenData) => {
    selectToken(tokenData)
    navigate('/trade')
  }, [selectToken, navigate])

  return (
    <FearGreedPageComponent
      dayMode={dayMode}
      isMobile={isMobile}
      onBack={() => navigate('/')}
      marketMode={marketMode}
      onTokenClick={handleTokenClick}
    />
  )
}
