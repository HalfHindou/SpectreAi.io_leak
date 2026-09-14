import { useNavigate } from 'react-router-dom'
import HeatmapsPageComponent from './components/heatmaps-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useAppState } from '@/contexts/AppStateContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { getPathForPageId } from '@/constants/pageRoutes'

export default function HeatmapsPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const { selectToken, setResearchZoneToken } = useAppState()
  const isMobile = useIsMobile()

  return (
    <HeatmapsPageComponent
      dayMode={dayMode}
      isMobile={isMobile}
      onBack={() => navigate('/')}
      marketMode={marketMode}
      onTokenClick={(tokenData) => {
        selectToken(tokenData)
        setResearchZoneToken?.(tokenData)
        const slug = tokenData.cgId
          || tokenData.token_id
          || tokenData.id
          || getTokenSlug(tokenData.symbol, marketMode === 'stocks', null, tokenData.name)
        navigate(`/research-zone/${slug}`)
      }}
      onOpenScreener={(tokenData) => {
        // AI Screener loads the exact token by contract + chain (contract >
        // cg_id — the identity-collision rule). Callers only pass tokens that
        // carry an address.
        selectToken(tokenData)
        navigate(getPathForPageId('ai-screener'))
      }}
    />
  )
}
