/**
 * User Dashboard - /user-dashboard
 * Full account management with left sidebar navigation.
 * Sections: General, Wallet, History, Plan, Settings, Referral.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePrivySafe } from '@/lib/use-privy-safe'
import { getPrivyDisplayInfo } from '@/lib/privy-user'
import useSettingsStore from '@/store/useSettingsStore'
import { setAuthToken } from '@/services/profileSync'
import { getSwapHistory } from '@/services/swapService'
import { useCurrency } from '@/hooks/useCurrency'
import { useCopyToast } from '@/contexts/CopyToastContext'
import { useWalletBalances } from '@/hooks/useWalletBalances'
import spectreIcons from '@/icons/spectreIcons'
import UdProfileSection from './components/ud-profile-section'
import UdWalletsSection from './components/ud-wallets-section'
import UdReferralSection from './components/ud-referral-section'
import UdSettingsSection from './components/ud-settings-section'
import UdPlanSection from './components/ud-plan-section'
import UdHistorySection from './components/ud-history-section'
import './user-dashboard.css'

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

const lockIcon = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

// Wallet, Swap History, Plan and Referral are not live yet — lock them with a
// "Soon" badge + lock icon and block navigation. General + Settings stay open.
const SIDEBAR_ITEMS = [
  { id: 'general', label: 'General', icon: spectreIcons.user },
  { id: 'wallet', label: 'Your Wallet', icon: spectreIcons.wallet, locked: true },
  { id: 'history', label: 'Swap History', icon: clockIcon, locked: true },
  { id: 'plan', label: 'Plan', icon: creditCardIcon, locked: true },
  { id: 'settings', label: 'Settings', icon: spectreIcons.settings },
  { id: 'referral', label: 'Referral', icon: giftIcon, locked: true },
]

export default function UserDashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState('general')

  const {
    authenticated, login, user, logout: privyLogout, getAccessToken,
  } = usePrivySafe()
  const privyInfo = getPrivyDisplayInfo(user)
  const { triggerCopyToast } = useCopyToast()
  const { fmtPrice, currency, setCurrency, language, setLanguage } = useCurrency()

  // Stable ref for getAccessToken — Privy returns a new function reference
  // each render, which would cause useEffect to re-fire infinitely.
  const getAccessTokenRef = useRef(getAccessToken)
  getAccessTokenRef.current = getAccessToken

  // Reset local profile when a different user logs in
  const syncProfileToUser = useSettingsStore((s) => s.syncProfileToUser)
  useEffect(() => {
    if (user?.id) syncProfileToUser(user.id)
  }, [user?.id, syncProfileToUser])

  // Ensure auth token is set so wallet/history calls below can authenticate.
  // The initial settings merge from server runs once in App.jsx (ProfileSyncInit);
  // re-running it on every user-dashboard mount races with in-flight setting
  // changes and snaps the user's currency/language back to the server's value.
  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getAccessTokenRef.current()
        if (cancelled || !token) return
        setAuthToken(token)
      } catch {
        // Non-critical
      }
    })()
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

  // Wallet state — embedded wallets from Privy linked accounts.
  // Privy hooks (useWallets, useFundWallet, useSendTransaction, useLinkAccount)
  // are called in child components (UdWalletsSection, UdProfileSection) with
  // try/catch wrappers. Parent only provides wallet addresses for balance queries.
  const [activeChain, setActiveChain] = useState('ethereum')
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

  // Balances render only inside the wallet section (and its tab is currently
  // locked) - passing null otherwise skips the Multicall RPC + 15s polling
  // loop that every dashboard visit was paying (audit 2026-06-10).
  const { balances: rawBalances, loading: walletLoading, refetch: refetchBalances } = useWalletBalances(
    activeSection === 'wallet' ? activeWallet?.address : null,
    activeChain
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
    }))

  // Referral state
  const [referralCode, setReferralCode] = useState('')
  const [referralStats, setReferralStats] = useState(null)
  const [referralLoading, setReferralLoading] = useState(false)

  useEffect(() => {
    // Referral section is locked and never rendered - only fetch /api/referral/stats
    // once the user actually opens that tab (mirrors the wallet-balances lazy-gate
    // above). Every dashboard visit was otherwise paying this request on mount.
    if (activeSection !== 'referral') return
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
  }, [activeSection, authenticated, user?.id])

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
    navigate('/')
  }, [privyLogout, navigate])

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
          <h1 className="ud-title">{t('userDashboard.account', 'Account')}</h1>
          <p className="ud-subtitle">{t('userDashboard.subtitle', 'Manage your profile, wallets, and preferences.')}</p>
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
            <h2 className="ud-signin-title">{t('userDashboard.signInTitle', 'Sign in to continue')}</h2>
            <p className="ud-signin-text">{t('userDashboard.signInText', 'Sign in to access your wallet, manage your profile, and start trading.')}</p>
            <button type="button" className="ud-signin-btn" onClick={() => login()}>
              {t('userDashboard.signIn', 'Sign In')}
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
            onClick={item.locked ? undefined : () => setActiveSection(item.id)}
            aria-disabled={item.locked || undefined}
            tabIndex={item.locked ? -1 : undefined}
            title={item.locked ? 'Coming Soon' : undefined}
          >
            <span className="ud-mobile-tab-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.locked && <span className="ud-soon-badge">Soon</span>}
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
              onClick={item.locked ? undefined : () => setActiveSection(item.id)}
              aria-disabled={item.locked || undefined}
              tabIndex={item.locked ? -1 : undefined}
              title={item.locked ? 'Coming Soon' : undefined}
            >
              <span className="ud-sidebar-icon">{item.icon}</span>
              <span className="ud-sidebar-label">{item.label}</span>
              {item.locked && (
                <span className="ud-soon-badge">
                  <span className="ud-soon-lock" aria-hidden="true">{lockIcon}</span>
                  Soon
                </span>
              )}
            </button>
          ))}
          <div className="ud-sidebar-spacer" />
          {authenticated && (
            <button className="ud-sidebar-item ud-sidebar-signout" onClick={handleLogout}>
              <span className="ud-sidebar-icon">{signOutIcon}</span>
              <span>{t('header.signOut', 'Sign Out')}</span>
            </button>
          )}
        </nav>

        {/* Content area */}
        <div className="ud-content">
          {activeSection === 'general' && (
            <UdProfileSection
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
            <UdWalletsSection
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
            <UdPlanSection onNavigate={navigate} />
          )}

          {activeSection === 'settings' && (
            <UdSettingsSection
              currency={currency}
              language={language}
              dayMode={dayMode}
              showMoodWall={showMoodWall}
              tokenColoring={tokenColoring}
              onCurrencyChange={setCurrency}
              onLanguageChange={setLanguage}
              onToggleDayMode={toggleDayMode}
              onToggleMoodWall={toggleShowMoodWall}
              onToggleTokenColoring={toggleTokenColoring}
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
