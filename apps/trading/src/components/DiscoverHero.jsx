/**
 * DiscoverHero - POPUP.FUND-grade welcome.
 * Cinematic greeting, data-driven subtitle, ambient market pulse.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { CandlestickChart } from 'lucide-react'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { useMarketStats } from '../hooks/useCodexData'
import { formatLargeNumber } from '../services/codexApi'
import { PRIVY_APP_ID } from '../lib/privy-app-id'
import { useCopyToast } from '../App'
import useSettingsStore from '../store/useSettingsStore'
import { getGreeting, deriveAccountName } from '../lib/greeting'
import InfoTip from './InfoTip'
import ProfileEditModal from './ProfileEditModal'
import './DiscoverHero.css'

const METRIC_TIPS = {
  'Market Cap': 'Total value of all coins in circulation. Price times circulating supply.',
  '24h Volume': 'Total trading volume across all exchanges in the last 24 hours.',
  'BTC Dom': "Bitcoin's share of the total crypto market cap. Higher means risk-off sentiment.",
  'ETH Dom': "Ethereum's share of the total crypto market cap.",
  'DeFi MCap': 'Total market cap of all decentralized finance protocol tokens.',
  'DeFi Volume': 'Total 24-hour trading volume across DeFi tokens.',
  'DeFi Dom': "DeFi's share of the total crypto market cap.",
  'Active Tokens': 'Number of tokens with meaningful trading activity in the last 24 hours.',
}

/* ───── Main Component ───── */
function DiscoverHero({ onLaunchTerminal, onLaunchTrending }) {
  const { triggerCopyToast } = useCopyToast()
  const { stats, loading } = useMarketStats()
  const [mounted, setMounted] = useState(false)

  // Signed-in state (guarded like Header — PRIVY_APP_ID is a stable module
  // const, so the conditional hook call is safe across renders).
  const privy = PRIVY_APP_ID ? usePrivy() : {}
  const isAuthenticated = !!privy?.authenticated
  const privyUser = privy?.user || null

  // Profile (anonymous, persisted, syncs to research via cookie)
  const profile = useSettingsStore((s) => s.profile)
  const setProfile = useSettingsStore((s) => s.setProfile)
  const name = (profile?.name || '').trim()
  const imageUrl = profile?.imageUrl || ''

  // Greeting name is account-driven: pull the real name off the signed-in
  // Privy account (a manual edit wins if the user set one). Signed-out = no
  // name at all - never an "add your name" prompt.
  const accountName = useMemo(
    () => (isAuthenticated ? deriveAccountName(privyUser) : ''),
    [isAuthenticated, privyUser]
  )
  const displayName = isAuthenticated ? (name || accountName) : ''

  const [profileModalOpen, setProfileModalOpen] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const greeting = useMemo(() => getGreeting(displayName), [displayName])

  const handleOpenProfile = useCallback(() => {
    setProfileModalOpen(true)
  }, [])

  const handleCloseProfile = useCallback(() => {
    setProfileModalOpen(false)
  }, [])

  const handleSaveProfile = useCallback(({ name: nextName, imageUrl: nextImage }) => {
    setProfile({ name: nextName, imageUrl: nextImage })
  }, [setProfile])

  const initial = (displayName[0] || '?').toUpperCase()

  // Primary metrics - the numbers that matter most
  const primaryMetrics = useMemo(() => [
    { label: 'Market Cap', value: stats.totalMcap, change: stats.mcapChange },
    { label: '24h Volume', value: stats.volume24h, change: stats.volumeChange },
    { label: 'BTC Dom', value: stats.btcDominance, change: stats.btcDomChange },
    { label: 'ETH Dom', value: stats.ethDominance, change: stats.ethDomChange },
  ], [stats])

  // Secondary metrics - DeFi layer
  const secondaryMetrics = useMemo(() => [
    { label: 'DeFi MCap', value: stats.defiMcap, change: stats.defiMcapChange },
    { label: 'DeFi Volume', value: stats.defiVolume24h, change: stats.defiVolChange },
    { label: 'DeFi Dom', value: stats.defiDominance, change: stats.defiDomChange },
    { label: 'Active Tokens', value: stats.activePairs, change: stats.activePairsChange },
  ], [stats])

  return (
    <section className="discover-hero" aria-label="Market overview">
      {/* Profile row: avatar + greeting. Clicking either opens the profile
          edit modal — inline editing was breaking the welcome layout. */}
      <div className={`hero-profile-row ${mounted ? 'is-visible' : ''}`}>
        {(isAuthenticated || imageUrl) && (
        <button
          type="button"
          className={`hero-avatar ${imageUrl ? 'has-image' : 'has-initial'}`}
          onClick={handleOpenProfile}
          aria-label="Edit profile"
        >
          {imageUrl ? (
            <img src={imageUrl} alt="" />
          ) : (
            <span className="hero-avatar-initial">{initial}</span>
          )}
        </button>
        )}

        <h1 className="hero-greeting">
          {isAuthenticated ? (
            <button
              type="button"
              className="hero-greeting-btn"
              onClick={handleOpenProfile}
              title="Edit your name"
            >
              {greeting}
            </button>
          ) : (
            greeting
          )}
        </h1>
      </div>

      <ProfileEditModal
        open={profileModalOpen}
        onClose={handleCloseProfile}
        name={name}
        imageUrl={imageUrl}
        onSave={handleSaveProfile}
        onToast={triggerCopyToast}
      />

      {/* Subtitle */}
      <p className={`hero-subtitle ${mounted ? 'is-visible' : ''}`}>
        Explore DeFi the way investors explore startups.
        <br />
        <span className="hero-subtitle-thesis">The best projects compound in silence. Find them early.</span>
      </p>

      {/* Launch Terminal + Trending CTAs */}
      <div className={`hero-launch-row ${mounted ? 'is-visible' : ''}`}>
        <button
          className={`hero-launch-btn`}
          onClick={onLaunchTerminal}
        >
          <CandlestickChart size={15} strokeWidth={1.25} />
          Launch Terminal
        </button>
        <button
          className={`hero-launch-btn secondary`}
          title="Launch Trending"
          onClick={onLaunchTrending}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 7L13.5 15.5 8.5 10.5 2 17" />
            <path d="M16 7h6v6" />
          </svg>
          Launch Trending
        </button>
      </div>

      {/* Market pulse - unified bar with two tiers */}
      <div className={`hero-pulse ${mounted ? 'is-visible' : ''}`}>
        {/* Primary row */}
        <div className="hero-pulse-row">
           {primaryMetrics.map((m) => (
            <div key={m.label} className="hero-pulse-metric">
              <span className="hero-pulse-label">{m.label}<InfoTip text={METRIC_TIPS[m.label]} position="bottom" /></span>
              <div className="hero-pulse-value-row">
                <span className={`hero-pulse-value ${loading ? 'is-loading' : ''}`}>
                  {m.value}
                </span>
                {m.change !== null && (
                  <span className={`hero-pulse-change ${m.change >= 0 ? 'is-bull' : 'is-bear'}`}>
                    {m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="hero-pulse-separator" />

        {/* Secondary row - DeFi */}
        <div className="hero-pulse-row hero-pulse-row--secondary">
           {secondaryMetrics.map((m) => (
            <div key={m.label} className="hero-pulse-metric">
              <span className="hero-pulse-label">{m.label}<InfoTip text={METRIC_TIPS[m.label]} position="bottom" /></span>
              <div className="hero-pulse-value-row">
                <span className={`hero-pulse-value ${loading ? 'is-loading' : ''}`}>
                  {m.value}
                </span>
                {m.change !== null && (
                  <span className={`hero-pulse-change ${m.change >= 0 ? 'is-bull' : 'is-bear'}`}>
                    {m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default React.memo(DiscoverHero)
