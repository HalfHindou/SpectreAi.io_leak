import { useNavigate } from 'react-router-dom'
import BubblesPageComponent from './components/bubbles-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useAppState } from '@/contexts/AppStateContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { getTokenSlug } from '@/lib/tokenSlugs'

export default function BubblesPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const { selectToken, setResearchZoneToken } = useAppState()
  const isMobile = useIsMobile()

  return (
    <BubblesPageComponent
      dayMode={dayMode}
      isMobile={isMobile}
      marketMode={marketMode}
      onBack={() => navigate('/')}
      onTokenClick={(tokenData) => {
        if (!tokenData?.symbol) return
        selectToken(tokenData)
        setResearchZoneToken?.(tokenData)
        const slug = tokenData.cgId
          || tokenData.token_id
          || tokenData.id
          || getTokenSlug(tokenData.symbol, marketMode === 'stocks', null, tokenData.name)
        navigate(`/research-zone/${slug}`)
      }}
    />
  )
}
