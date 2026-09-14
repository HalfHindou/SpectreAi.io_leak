/**
 * User Dashboard - Container with left sidebar navigation.
 * Sections: General, Wallet, History, Plan, Settings, Referral.
 * Privy hooks (wallet, account linking) live in child components with error boundaries.
 * Parent handles auth state, profile sync, balance queries, and layout.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Lock } from 'lucide-react'
import { usePrivySafe as usePrivy } from '../../lib/use-privy-safe'
import { getPrivyDisplayInfo } from '../../lib/privy-user'
import useSettingsStore from '../../store/useSettingsStore'
import { setAuthToken, fetchProfile } from '../../services/profileSync'
import { getSwapHistory } from '../../services/swapService'
import { subscribeNativePrices } from '../../services/nativePricesStore'
import { useCopyToast } from '../../App'
import { useWalletBalances } from '../../hooks/useWalletBalances'
import UdGeneralSection from './UdGeneralSection'
import UdWalletSection from './UdWalletSection'
import UdHistorySection from './UdHistorySection'
import UdPlanSection from './UdPlanSection'
import UdSettingsSection from './UdSettingsSection'
import UdReferralSection from './UdReferralSection'
import './UserDashboard.css'

const userIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const walletIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 010-4h14v4" />
    <path d="M3 5v14a2 2 0 002 2h16v-5" />
    <path d="M18 12a2 2 0 100 4 2 2 0 000-4z" />
  </svg>
)

const clockIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
)

const creditCardIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </svg>
)

const settingsIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
)

const giftIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13M19 12v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7" />
    <path d="M7.5 8a2.5 2.5 0 010-5A4.83 4.83 0 0112 8a4.83 4.83 0 014.5-5 2.5 2.5 0 010 5" />
  </svg>
)

const signOutIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const SIDEBAR_ITEMS = [
  { id: 'general', label: 'General', icon: userIcon },
  { id: 'wallet', label: 'Your Wallet', icon: walletIcon },
  { id: 'history', label: 'Trade History', icon: clockIcon },
  { id: 'plan', label: 'Plan', icon: creditCardIcon, locked: true },
  { id: 'settings', label: 'Settings', icon: settingsIcon },
  { id: 'referral', label: 'Referral', icon: giftIcon, locked: true },
]

export default function UserDashboard({ navigateTo }) {
  const [activeSection, setActiveSection] = useState(() => {
    // One-shot deep-link: the swap panel sets this when a user taps "Deposit to
    // trade" on an insufficient buy, so the dashboard opens straight on Wallet.
    try {
      const target = sessionStorage.getItem('ud-open-section')
      if (target) { sessionStorage.removeItem('ud-open-section'); return target }
    } catch { /* private mode */ }
    return 'general'
  })

  /* Back: navigateTo pushes history, so stepping back lands on whatever the
     user came from (token page, discover…). A cold deep-link to #dashboard
     has nothing to step back to - going back would leave the app - so that
     case falls through to Discover. */
  const handleBack = useCallback(() => {
    const cameFromInApp = window.history.state?.view === 'user-dashboard' && window.history.length > 1
    if (cameFromInApp) window.history.back()
    else navigateTo?.('discover')
  }, [navigateTo])

  const {
    authenticated, login, user, logout: privyLogout, getAccessToken,
  } = usePrivy()
  const privyInfo = getPrivyDisplayInfo(user)
  const { triggerCopyToast } = useCopyToast()

  // Stable ref for getAccessToken — Privy returns a new function reference
  // each render, which would cause useEffect to re-fire infinitely.
  const getAccessTokenRef = useRef(getAccessToken)
  getAccessTokenRef.current = getAccessToken

  // Reset local profile when a different user logs in
  const syncProfileToUser = useSettingsStore((s) => s.syncProfileToUser)
  useEffect(() => {
    if (user?.id) syncProfileToUser(user.id)
  }, [user?.id, syncProfileToUser])

  // Ensure auth token is set and fetch latest profile from server on mount
  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    async function refreshProfile() {
      try {
        const token = await getAccessTokenRef.current()
        if (cancelled || !token) return
        setAuthToken(token)
        const serverData = await fetchProfile()
        if (cancelled || !serverData?.updatedAt) return
        const mergeServerSettings = useSettingsStore.getState().mergeServerSettings
        mergeServerSettings(serverData)
      } catch {
        // Non-critical
      }
    }
    refreshProfile()
    return () => { cancelled = true }
  }, [authenticated])

  // Zustand selectors
  const profile = useSettingsStore((s) => s.profile)
  const setProfile = useSettingsStore((s) => s.setProfile)
  const dayMode = useSettingsStore((s) => s.dayMode)
  const toggleDayMode = useSettingsStore((s) => s.toggleDayMode)
  const showMoodWall = useSettingsStore((s) => s.showMoodWall)
  const toggleShowMoodWall = useSettingsStore((s) => s.toggleShowMoodWall)
  const tokenColoring = useSettingsStore((s) => s.tokenColoring)
  const toggleTokenColoring = useSettingsStore((s) => s.toggleTokenColoring)
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const toggleReducedMotion = useSettingsStore((s) => s.toggleReducedMotion)

  // Wallet state — embedded wallets from Privy linked accounts.
  // Privy hooks (useWallets, useFundWallet, useSendTransaction, useLinkAccount)
  // are called in child components (UdWalletSection, UdGeneralSection) which have
  // error boundaries. Parent only provides wallet addresses for balance queries.
  const [activeChain, setActiveChain] = useState(() => {
    // Chain deep-link from the swap panel's "Fund the wallet to trade" CTA - open
    // Your Wallet on the exact chain the token lives on (else default Ethereum).
    try {
      const c = sessionStorage.getItem('ud-open-chain')
      if (c) { sessionStorage.removeItem('ud-open-chain'); return c }
    } catch { /* private mode */ }
    return 'ethereum'
  })
  const linkedAccounts = user?.linkedAccounts || []

  const embeddedWallets = linkedAccounts
    .filter((a) => a.type === 'wallet' && a.walletClientType === 'privy')
    .map((w) => ({
      address: w.address,
      chainType: w.chainType || 'ethereum',
      walletClientType: 'privy',
    }))

  const activeWallet = embeddedWallets.find((w) =>
    activeChain === 'solana' ? w.chainType === 'solana' : w.chainType === 'ethereum'
  ) || null

  // USD prices for the wallet's token set. Without this map the hook fell
  // back to EMPTY_PRICES and every balanceUsd computed to $0.00 - a funded
  // wallet rendered "Portfolio Value $0.00" + the deposit hint. Keyed by the
  // symbols walletService emits (native symbols + COMMON_TOKENS symbols).
  const [walletPrices, setWalletPrices] = useState(null)
  useEffect(() => {
    // Shared native-prices store - one 30s poll feeds this, RightPanel and
    // DataTabs instead of three uncoordinated pollers.
    return subscribeNativePrices((raw) => {
      const p = { USDT: 1, USDC: 1 }
      for (const [sym, v] of Object.entries(raw)) {
        if (Number.isFinite(v) && v > 0) p[sym] = v
      }
      // Wrapped natives track their underlying
      if (p.ETH) p.WETH = p.ETH
      if (p.BNB) p.WBNB = p.BNB
      if (p.SOL) p.WSOL = p.SOL
      setWalletPrices(prev => {
        if (prev && Object.keys(p).every(k => prev[k] === p[k]) && Object.keys(prev).length === Object.keys(p).length) return prev
        return p
      })
    })
  }, [])

  const { balances: rawBalances, loading: walletLoading, refetch: refetchBalances } = useWalletBalances(
    activeWallet?.address,
    activeChain,
    walletPrices || undefined
  )

  const walletBalances = rawBalances
    .filter((b) => b.isNative || b.balance > 0)
    .map((b) => ({
      symbol: b.symbol,
      balance: String(b.balance),
      usdValue: b.balanceUsd || 0,
      decimals: b.decimals,
      isNative: b.isNative,
      contractAddress: b.contractAddress || null,
      mintAddress: b.mintAddress || null,
      logo: b.logo || null,
    }))

  // Referral state
  const [referralCode, setReferralCode] = useState('')
  const [referralStats, setReferralStats] = useState(null)
  const [referralLoading, setReferralLoading] = useState(false)

  useEffect(() => {
    if (!authenticated || !user?.id) return
    let cancelled = false
    setReferralLoading(true)
    ;(async () => {
      try {
        const token = await getAccessTokenRef.current?.()
        if (!token) return
        const res = await fetch('/api/referral/stats', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (cancelled) return
        if (data?.code) {
          setReferralCode(data.code)
          setReferralStats(data)
        }
      } catch {
        // leave referralCode empty so UI prompts a retry
      } finally {
        if (!cancelled) setReferralLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [authenticated, user?.id])

  const handleApplyReferral = useCallback(async (code) => {
    if (!code?.trim() || !user?.id) return { success: false, error: 'Invalid code' }
    try {
      const token = await getAccessTokenRef.current?.()
      if (!token) return { success: false, error: 'Not signed in' }
      const res = await fetch('/api/referral/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: code.trim().toUpperCase() })
      })
      return await res.json()
    } catch {
      return { success: false, error: 'Network error' }
    }
  }, [user?.id])

  const handleLogout = useCallback(() => {
    privyLogout?.()
    navigateTo('welcome')
  }, [privyLogout, navigateTo])

  // Format price helper (simple, no i18n in trading app)
  const fmtPrice = useCallback((value) => {
    if (value == null || isNaN(value)) return '$0.00'
    return '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }, [])

  const displayProfile = {
    name: profile.name || privyInfo.name || 'User',
    imageUrl: profile.imageUrl || privyInfo.avatar || '',
    email: privyInfo.email || ''
  }

  return (
    <div className="ud-page-wrapper">
      {/* Ambient background orbs - full viewport */}
      <div className="ud-ambient">
        <div className="ud-ambient-orb ud-orb-1" />
        <div className="ud-ambient-orb ud-orb-2" />
        <div className="ud-ambient-orb ud-orb-3" />
      </div>

      <div className="ud-page">
        <header className="ud-header">
          {/* Mobile-only exit. On a phone the dashboard is a full-screen
              takeover with no visible app chrome to click back to - and the
              header's Deposit shortcut drops users straight in here, so
              without this the only way out is the browser's back gesture. */}
          <button
            type="button"
            className="ud-back"
            onClick={handleBack}
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Back</span>
          </button>
          <h1 className="ud-title">Account</h1>
          <p className="ud-subtitle">Manage your profile, wallets, and preferences.</p>
        </header>

      {!authenticated ? (
        <div className="ud-signin-gate">
          <div className="ud-signin-card">
            <div className="ud-signin-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <h2 className="ud-signin-title">Sign in to continue</h2>
            <p className="ud-signin-text">Sign in to access your wallet, manage your profile, and start trading.</p>
            <button type="button" className="ud-signin-btn" onClick={() => login()}>
              Sign In
            </button>
          </div>
        </div>
      ) : (
        <>
      {/* Mobile tab bar */}
      <div className="ud-mobile-tabs">
        {SIDEBAR_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`ud-mobile-tab${activeSection === item.id ? ' is-active' : ''}${item.locked ? ' is-locked' : ''}`}
            aria-disabled={item.locked || undefined}
            title={item.locked ? `${item.label} (Coming Soon)` : undefined}
            onClick={() => {
              if (item.locked) {
                triggerCopyToast('Coming Soon')
                return
              }
              setActiveSection(item.id)
            }}
          >
            <span className="ud-mobile-tab-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.locked && <Lock size={10} strokeWidth={2.5} className="ud-mobile-tab-lock" aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="ud-layout">
        {/* Sidebar */}
        <nav className="ud-sidebar">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`ud-sidebar-item${activeSection === item.id ? ' is-active' : ''}${item.locked ? ' is-locked' : ''}`}
              aria-disabled={item.locked || undefined}
              title={item.locked ? `${item.label} (Coming Soon)` : undefined}
              onClick={() => {
                if (item.locked) {
                  triggerCopyToast('Coming Soon')
                  return
                }
                setActiveSection(item.id)
              }}
            >
              <span className="ud-sidebar-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.locked && <Lock size={11} strokeWidth={2.5} className="ud-sidebar-lock" aria-hidden="true" />}
            </button>
          ))}
          <div className="ud-sidebar-spacer" />
          {authenticated && (
            <button className="ud-sidebar-item ud-sidebar-signout" onClick={handleLogout}>
              <span className="ud-sidebar-icon">{signOutIcon}</span>
              <span>Sign Out</span>
            </button>
          )}
        </nav>

        {/* Content area */}
        <div className="ud-content">
          {activeSection === 'general' && (
            <UdGeneralSection
              profile={displayProfile}
              privyUser={user}
              authenticated={authenticated}
              onProfileUpdate={setProfile}
              onLogout={handleLogout}
              triggerCopyToast={triggerCopyToast}
              linkedAccounts={linkedAccounts}
            />
          )}

          {activeSection === 'wallet' && (
            <UdWalletSection
              wallets={embeddedWallets}
              activeChain={activeChain}
              onChainChange={setActiveChain}
              balances={walletBalances}
              loading={walletLoading}
              onRefetch={refetchBalances}
              fmtPrice={fmtPrice}
              triggerCopyToast={triggerCopyToast}
            />
          )}

          {activeSection === 'history' && authenticated && (
            <UdHistorySection
              getSwapHistory={getSwapHistory}
              triggerCopyToast={triggerCopyToast}
            />
          )}

          {activeSection === 'plan' && (
            <UdPlanSection onNavigate={navigateTo} />
          )}

          {activeSection === 'settings' && (
            <UdSettingsSection
              dayMode={dayMode}
              showMoodWall={showMoodWall}
              tokenColoring={tokenColoring}
              reducedMotion={reducedMotion}
              onToggleDayMode={toggleDayMode}
              onToggleMoodWall={toggleShowMoodWall}
              onToggleTokenColoring={toggleTokenColoring}
              onToggleReducedMotion={toggleReducedMotion}
            />
          )}

          {activeSection === 'referral' && (
            <UdReferralSection
              referralCode={referralCode}
              referralStats={referralStats}
              loading={referralLoading}
              onApplyCode={handleApplyReferral}
              triggerCopyToast={triggerCopyToast}
            />
          )}
        </div>
      </div>
        </>
      )}
      </div>
    </div>
  )
}
