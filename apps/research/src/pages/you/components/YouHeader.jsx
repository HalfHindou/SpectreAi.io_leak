/**
 * YouHeader — Editorial hero header for Spectre YOU.
 * No card, no border. Sits in open space.
 *
 * Spectre                    [● live · Updated 2m ago]   [Share ↗]
 *     YOU
 *
 * Your market universe, assembled by intelligence.
 *
 * "Watching 12 tokens · Crypto · Dashboard active"
 */
import { useMemo } from 'react'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import useSettingsStore from '@/store/useSettingsStore'

export default function YouHeader({ onShareClick, activeTab = 'dashboard' }) {
  const watchlistCtx = useWatchlists() || {}
  const watchlist = watchlistCtx.watchlist
  const marketMode = useSettingsStore((s) => s.marketMode)

  const tokenCount = watchlist?.length ?? 0

  const activityLine = useMemo(() => {
    if (tokenCount === 0) return 'Set up your watchlist to get started'

    const watchingPart = `Watching ${tokenCount} token${tokenCount !== 1 ? 's' : ''}`
    const modePart = marketMode === 'stocks' ? 'Stocks' : 'Crypto'
    const tabPart = activeTab === 'dashboard' ? 'Dashboard active' : 'Studio active'

    return `${watchingPart} · ${modePart} · ${tabPart}`
  }, [tokenCount, marketMode, activeTab])

  return (
    <div className="you-header">
      {/* Top row: Spectre label + live badge + share */}
      <div className="you-header-top">
        <div className="you-header-left">
          <span className="you-header-label">Spectre</span>
        </div>
        <div className="you-header-right">
          <span className="you-header-live">
            <span className="you-live-dot" />
            <span className="you-live-text">Live</span>
          </span>
          <button
            className="you-share-btn"
            onClick={onShareClick}
            title="Share your setup"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8.5L10 5M4 5.5L10 9" />
              <circle cx="3" cy="7" r="1.5" />
              <circle cx="11" cy="4" r="1.5" />
              <circle cx="11" cy="10" r="1.5" />
            </svg>
            Share
          </button>
        </div>
      </div>

      {/* Hero word */}
      <div className="you-header-hero">
        <span className="you-hero-glow" />
        <h1 className="you-hero-text">YOU</h1>
      </div>

      {/* Tagline */}
      <p className="you-header-tagline">
        Your market universe, assembled by intelligence.
      </p>

      {/* Activity line — real user data */}
      <p className="you-header-activity">
        {activityLine}
      </p>
    </div>
  )
}
