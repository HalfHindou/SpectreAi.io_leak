/**
 * useHeatmapData - Fetches top 24 coins for the crypto heatmap on mount.
 * Returns { heatmapTokens, heatmapsBubblesToggle, setHeatmapsBubblesToggle, heatmapFullscreen, setHeatmapFullscreen }
 */
import { useState, useEffect } from 'react'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { TOKEN_LOGOS } from './welcome-page-constants'

export default function useHeatmapData(active = true) {
  const [heatmapTokens, setHeatmapTokens] = useState([])
  const [heatmapsBubblesToggle, setHeatmapsBubblesToggle] = useState(false)
  const [heatmapFullscreen, setHeatmapFullscreen] = useState(false)

  // Fetch top 40 coins on first activation (lazy: skip if user never opens heatmap tab)
  useEffect(() => {
    if (!active) return
    if (heatmapTokens.length > 0) return
    let cancelled = false
    getTopCoinsMarketsPage(1, 40)
      .then((markets) => {
        if (cancelled) return
        const list = (markets || []).map((coin, index) => ({
          rank: coin.market_cap_rank || index + 1,
          symbol: (coin.symbol || '').toUpperCase(),
          name: coin.name || '',
          logo: coin.image || TOKEN_LOGOS[(coin.symbol || '').toUpperCase()] || null,
          price: Number(coin.current_price) || 0,
          change: Number(coin.price_change_percentage_24h) || 0,
          marketCap: Number(coin.market_cap) || 0,
          volume: Number(coin.total_volume) || 0,
        }))
        setHeatmapTokens(list)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Escape key to close heatmap fullscreen
  useEffect(() => {
    if (!heatmapFullscreen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setHeatmapFullscreen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [heatmapFullscreen])

  return {
    heatmapTokens,
    heatmapsBubblesToggle, setHeatmapsBubblesToggle,
    heatmapFullscreen, setHeatmapFullscreen,
  }
}
