import { useNavigate } from 'react-router-dom'
import DiscoverPageComponent from './components/discover-page'
import { useAppState } from '@/contexts/AppStateContext'
import useSettingsStore from '@/store/useSettingsStore'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { openTradingTerminal } from '@/lib/trading-terminal'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function DiscoverPage() {
  const navigate = useNavigate()
  const { selectToken, setResearchZoneToken } = useAppState()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const { addToWatchlist, isInWatchlist } = useWatchlists()
  const isMobile = useIsMobile()

  return (
    <DiscoverPageComponent
      dayMode={dayMode}
      marketMode={marketMode}
      isMobile={isMobile}
      selectToken={(tokenData) => {
        // On-chain token: open the standalone trading terminal (better charts)
        // by contract in a new tab. Majors/CEX coins carry no contract, so the
        // helper no-ops and they keep the in-app /token Trading Lite embed.
        if (openTradingTerminal(tokenData?.address)) return
        selectToken(tokenData)
        navigate('/trade')
      }}
      onOpenResearchZone={(tokenData) => {
        selectToken(tokenData)
        setResearchZoneToken(tokenData)
        navigate(`/research-zone/${getTokenSlug(tokenData.symbol, marketMode === 'stocks', tokenData.cgId, tokenData.name)}`)
      }}
      addToWatchlist={addToWatchlist}
      isInWatchlist={isInWatchlist}
    />
  )
}
