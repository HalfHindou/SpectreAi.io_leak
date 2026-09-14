import React from 'react'
import { useNavigate } from 'react-router-dom'
import LitePage from './components/lite-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useWatchlists } from '@/contexts/WatchlistsContext'

export default function LitePageWrapper() {
  const navigate = useNavigate()
  const profile = useSettingsStore((s) => s.profile)
  const liteLook = useSettingsStore((s) => s.liteLook)
  const setLiteLook = useSettingsStore((s) => s.setLiteLook)
  const liteTodayPanels = useSettingsStore((s) => s.liteTodayPanels)
  const setLiteTodayPanel = useSettingsStore((s) => s.setLiteTodayPanel)
  const liteTodayOrder = useSettingsStore((s) => s.liteTodayOrder)
  const setLiteTodayOrder = useSettingsStore((s) => s.setLiteTodayOrder)
  const liteBg = useSettingsStore((s) => s.liteBg)
  const setLiteBg = useSettingsStore((s) => s.setLiteBg)
  const litePaperBg = useSettingsStore((s) => s.litePaperBg)
  const setLitePaperBg = useSettingsStore((s) => s.setLitePaperBg)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const setMarketMode = useSettingsStore((s) => s.setMarketMode)
  const { watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist } = useWatchlists() || {}

  return (
    <LitePage
      profile={profile}
      onExit={() => navigate('/')}
      onOpenResearch={(sym) => navigate(`/research-zone/${String(sym || '').toLowerCase()}`)}
      onOpenPath={(path) => { if (typeof path === 'string' && path.startsWith('/')) navigate(path) }}
      watchlistTokens={watchlist}
      onAddWatch={addToWatchlist}
      onRemoveWatch={removeFromWatchlist}
      isWatched={isInWatchlist}
      panels={liteTodayPanels}
      setPanel={setLiteTodayPanel}
      order={liteTodayOrder}
      setOrder={setLiteTodayOrder}
      bg={liteBg}
      setBg={setLiteBg}
      paperBg={litePaperBg}
      setPaperBg={setLitePaperBg}
      look={liteLook === 'paper' ? 'paper' : 'glass'}
      setLook={setLiteLook}
      market={marketMode === 'stocks' ? 'stocks' : 'crypto'}
      setMarket={setMarketMode}
    />
  )
}
