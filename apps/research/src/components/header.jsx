/**
 * Header Component - Apple Modern Style
 * Figma Reference: Top bar with weather widget, time, search
 * Logo: Phoenix/circuit design from logo.png
 * 
 * NOW WITH REAL-TIME SEARCH FROM CODEX API
 */
import React, { useState, useEffect, useCallback, useRef, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import i18n from 'i18next'
import { track, Events, updateThemeSuperProp, setUserProps } from '@/services/analytics'
import { isDev } from '@/utils/env'
import { IS_SHOWCASE_EMBED } from '@/lib/embed-mode'
import { useCopyToast } from '@/contexts/CopyToastContext'
// perf: leaf import, not the @/hooks/useCodexData barrel. The header is always
// mounted; the barrel's default export static-imports all 11 codex hooks and
// dragged them onto the boot path. This pulls only what search needs.
import { useTokenSearch } from '@/hooks/codex/useTokenSearch'
import { chainToDisplayName } from '@/hooks/codex/_shared'
import { useStockSearch } from '@/hooks/useStockData'
// formatLargeNumber/formatPrice now from useCurrency hook
import { getStockLogo } from '@/constants/stockData'
import { getPathForPageId } from '@/constants/pageRoutes'
import { isStandalonePwa } from '@/lib/trading-terminal'
import { MAJOR_SYMBOLS, MAJOR_TOKEN_INFO, SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getCgSearchHits, fetchCgMarketsByIds } from '@/services/cgSearchService'
import { buildMajorMatches, mergeTokenSearchResults } from '@/lib/search-merge'
import { hoverIntent, allowDataPrefetch, prefetchRoute } from '@/lib/route-prefetch'
import { prewarmResearchZone } from '@/lib/rz-prewarm'
import { prewarmCgContractLookup } from '@/lib/cg-contract-lookup'
// PR-7 (perf): open-on-click surfaces - lazy so the games (742-line runner),
// settings and notification panels stay out of the entry chunk. Panels mount
// on first open and STAY mounted (state preserved across re-opens).
import lazyWithRetry from '@/lib/lazy-with-retry'
const CryptoMemoryGame = lazyWithRetry(() => import('./crypto-memory-game'))
const SpectreRunnerGame = lazyWithRetry(() => import('./spectre-runner-game'))
const SettingsPanel = lazyWithRetry(() => import('./settings-panel'))
const NotificationPanel = lazyWithRetry(() => import('./notification-panel'))
import { useUnreadCount } from '@/store/useNotificationStore'
import { useCurrency } from '@/hooks/useCurrency'
import { useTranslation } from 'react-i18next'
import WhisperResults from './whisper-results'
import PageResults from './page-results'
import { logError } from '@/lib/logger'
import { useWhisperSearch } from '@/hooks/useWhisperSearch'
import { usePageSearch } from '@/hooks/usePageSearch'
import useSettingsStore from '@/store/useSettingsStore'
import { getPrivyDisplayInfo } from '@/lib/privy-user'
import { usePrivySafe } from '@/lib/use-privy-safe'
import { useWalletBalance, formatBalance } from '@/hooks/useWalletBalance'
import { useIsMobile } from '@/hooks/useMediaQuery'
import HeaderClock from './header/header-clock'
import InfoSwitchBtn from './header/header-info-switch'
import { TourLaunchButton } from '@/components/guided-tour'
import { openThemeStudio, ThemeStudioIcon } from '@/lib/theme-studio'
import './header.css'

const Header = ({ profile: profileProp, marketMode: marketModeProp, onMarketModeChange, onOpenGM, onOpenROI, addToWatchlist, removeFromWatchlist, isInWatchlist, selectToken, onSelectTokenAndOpen, onLogoClick, tradingModeActive, onTradingModeClick, researchZoneActive, researchZoneDayMode, onResearchZoneDayModeChange, welcomeActive, welcomeDayMode, onWelcomeDayModeChange, appDisplayMode, onAppDisplayModeChange, onStartTour, demoMode = false }) => {
  // Privy auth state (via the deferred-safe wrapper: stub until the lazy
  // PrivyProvider mounts, real usePrivy() result after). login() on the stub
  // pulls the provider in and replays the click once ready.
  const privy = usePrivySafe()
  const isAuthenticated = privy?.authenticated
  const privyUser = privy?.user
  const privyLogin = privy?.login
  const privyLogout = privy?.logout
  const privyInfo = getPrivyDisplayInfo(privyUser)

  // Real wallet balance for header display
  const walletBalance = useWalletBalance()
  const totalUsd = walletBalance.totalUsd

  // Reset local profile overrides when a different Privy user logs in
  const syncProfileToUser = useSettingsStore((s) => s.syncProfileToUser)
  useEffect(() => {
    if (privyUser?.id) syncProfileToUser(privyUser.id)
  }, [privyUser?.id, syncProfileToUser])

  // Profile priority: Zustand store (user edits) > Privy raw data > generic
  const storeProfile = useSettingsStore((s) => s.profile)
  const profile = (() => {
    const storeName = storeProfile?.name
    const storeImg = storeProfile?.imageUrl
    if (storeName) return { name: storeName, imageUrl: storeImg || privyInfo.avatar || '' }
    if (isAuthenticated && privyInfo.name) return { name: privyInfo.name, imageUrl: privyInfo.avatar || '' }
    return { name: 'User', imageUrl: '' }
  })()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const isMobile = useIsMobile()
  // Time state moved to HeaderClock component to prevent entire header re-renders
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [fullView, setFullView] = useState(false)
  const [whisperMode, setWhisperMode] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const recognitionRef = React.useRef(null)
  const whisperSearchRef = React.useRef(null)
  // Store full token data in history instead of just symbols
  const [recentTokens, setRecentTokens] = useState(() => {
    try {
      const saved = localStorage.getItem('searchHistoryTokens')
      return saved ? JSON.parse(saved) : []
    } catch (err) { logError('header:loadSearchHistory', err); return [] }
  })
  const { triggerCopyToast } = useCopyToast()
  const [referralApplied, setReferralApplied] = useState(() => localStorage.getItem('spectre-referral-applied') === 'true')
  const [referralInput, setReferralInput] = useState('')
  const [referralCode, setReferralCode] = useState('')

  // 2026-05-08 cost migration: prefetchPopularSearches removed.
  // It fired 3 Codex queries (btc/eth/sol) on EVERY page mount across the app.
  // Welcome page renders the same data via Spectre /v1/markets/trending — no need
  // to warm the search cache speculatively.
  // const cleanup = useEffect(() => { prefetchPopularSearches() }, [])
  const [referralStatus, setReferralStatus] = useState(null) // 'success' | 'error' | null

  // Fetch the authenticated user's own referral code for the dropdown display.
  useEffect(() => {
    if (!isAuthenticated || !privy?.user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await privy?.getAccessToken?.()
        if (!token) return
        const res = await fetch('/api/referral/code', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!cancelled && data?.code) setReferralCode(data.code)
      } catch (err) {
        logError('header:fetchReferralCode', err)
      }
    })()
    return () => { cancelled = true }
  }, [isAuthenticated, privy?.user?.id])

  // Apply referral code after Privy auth completes (from URL param or prompt)
  // Skip if onboarding popup hasn't been shown yet - it handles referral too
  useEffect(() => {
    if (!isAuthenticated) return
    if (localStorage.getItem('spectre-onboarding-done') !== 'true') return
    const code = localStorage.getItem('spectre-referral-code')
    if (!code) return
    ;(async () => {
      try {
        const token = await privy?.getAccessToken?.()
        if (!token) return
        const res = await fetch('/api/referral/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ code: String(code).trim().toUpperCase() })
        })
        const data = await res.json()
        if (data?.success) {
          setReferralApplied(true)
          localStorage.setItem('spectre-referral-applied', 'true')
        }
      } catch (err) {
        logError('header:applyReferral', err)
      } finally {
        localStorage.removeItem('spectre-referral-code')
      }
    })()
  }, [isAuthenticated])

  // PWA install prompt — always visible, hidden only in standalone mode
  // Read early-captured prompt from main.jsx (fires before React mounts)
  const [installPrompt, setInstallPrompt] = useState(() => window.__pwaInstallPrompt || null)
  const [isPWA] = useState(() =>
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    localStorage.getItem('spectre-pwa-installed') === 'true'
  )
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      window.__pwaInstallPrompt = e
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    const installed = () => { localStorage.setItem('spectre-pwa-installed', 'true'); window.__pwaInstallPrompt = null; setInstallPrompt(null) }
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])
  const handleInstallClick = async () => {
    // Re-check global in case it was captured before state synced
    const prompt = installPrompt || window.__pwaInstallPrompt
    if (prompt) {
      prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') {
        track(Events.PWA_INSTALLED)
        window.__pwaInstallPrompt = null; setInstallPrompt(null)
      }
    } else {
      triggerCopyToast?.(t('header.installInstructions', 'Use your browser menu to install Spectre AI as an app'))
    }
  }

  // Crypto / Stocks mode: controlled from App when props provided
  const marketModeStore = useSettingsStore((s) => s.marketMode)
  const setMarketModeStore = useSettingsStore((s) => s.setMarketMode)
  const marketMode = marketModeProp !== undefined ? marketModeProp : marketModeStore
  const setMarketMode = onMarketModeChange || setMarketModeStore

  // Weather state
  const [weather, setWeather] = useState(() => {
    try {
      const saved = localStorage.getItem('spectre-weather')
      return saved ? JSON.parse(saved) : null
    } catch (err) { logError('header:loadWeather', err); return null }
  })
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [memoryGameOpen, setMemoryGameOpen] = useState(false)
  const [runnerGameOpen, setRunnerGameOpen] = useState(false)
  const [extrasMenuOpen, setExtrasMenuOpen] = useState(false)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  // PR-7 (perf): mount the lazy panels on first open, keep them mounted after
  // so panel state survives re-opens (matches the previous always-mounted
  // behavior from the second open onward).
  const [settingsPanelEverOpened, setSettingsPanelEverOpened] = useState(false)
  const [notifPanelEverOpened, setNotifPanelEverOpened] = useState(false)
  useEffect(() => { if (settingsPanelOpen) setSettingsPanelEverOpened(true) }, [settingsPanelOpen])
  useEffect(() => { if (notifPanelOpen) setNotifPanelEverOpened(true) }, [notifPanelOpen])
  const notifUnread = useUnreadCount()

  // Header dropdown backdrops are trapped inside the header's stacking context
  // (header is position:fixed with z-index var(--z-header)=300, so child fixed
  // backdrops can't escape and lose clicks to page elements above z-300).
  // Document-level mousedown handler closes all open dropdowns on outside click.
  useEffect(() => {
    if (!settingsPanelOpen && !notifPanelOpen && !extrasMenuOpen && !profileDropdownOpen) return
    const handler = (e) => {
      const t = e.target
      if (!(t instanceof Element)) return
      // Click landed inside a dropdown panel - keep open
      if (t.closest('.settings-panel, .np-panel, .header-extras-menu, .profile-dropdown-panel')) return
      // Click landed on a trigger - let its own onClick handle the toggle
      if (t.closest('.icon-btn, .header-extras-trigger, .profile-trigger')) return
      setSettingsPanelOpen(false)
      setNotifPanelOpen(false)
      setExtrasMenuOpen(false)
      setProfileDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsPanelOpen, notifPanelOpen, extrasMenuOpen, profileDropdownOpen])
  // calendarHidden removed - calendar grid moved out of dropdown
  const [claimModalOpen, setClaimModalOpen] = useState(false)
  const [claimModalDay, setClaimModalDay] = useState(null) // day just claimed for congrats modal

  // 2026-05-26 beta-quality fix: removed mockUser/isLoggedIn/authDropdownOpen
  // dead state (hardcoded `name: 'Sunny'`, never rendered). Real auth flows
  // through Privy + useSettingsStore.profile above (lines 58-65).
  // Gamification (persisted via Zustand)
  const gamification = useSettingsStore((s) => s.gamification)
  const setGamification = useSettingsStore((s) => s.setGamification)

  // Next day that can be claimed (first 1–30 not in claimedDays)
  const nextClaimableDay = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].find((d) => !gamification.claimedDays.includes(d)) ?? null

  const handleClaimDay = (day) => {
    if (day == null || gamification.claimedDays.includes(day)) return
    const newClaimed = [...gamification.claimedDays, day].sort((a, b) => a - b)
    setGamification((prev) => ({
      ...prev,
      claimedDays: newClaimed,
      daysClaimed: prev.daysClaimed + 1,
      points: prev.points + 1,
      challengeDaysCompleted: newClaimed.length,
      streak: prev.streak + 1,
    }))
    setClaimModalDay(day)
    setClaimModalOpen(true)
  }

  const closeClaimModal = () => {
    setClaimModalOpen(false)
    setClaimModalDay(null)
  }

  useEffect(() => {
    if (!claimModalOpen) return
    const onKey = (e) => { if (e.key === 'Escape') closeClaimModal() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [claimModalOpen])
  
  // Temperature and time format (persisted via Zustand)
  const tempUnit = useSettingsStore((s) => s.tempUnit)
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  const toggleTempUnit = useSettingsStore((s) => s.toggleTempUnit)
  const toggleTimeFormat = useSettingsStore((s) => s.toggleTimeFormat)

  // Info mode (educational tooltips - persisted via Zustand)
  const infoMode = useSettingsStore((s) => s.infoMode)
  const toggleInfoMode = useSettingsStore((s) => s.toggleInfoMode)
  const appTourSeen = useSettingsStore((s) => s.appTourSeen)

  // Convert Celsius to Fahrenheit
  const cToF = (c) => Math.round((c * 9/5) + 32)

  // Convert Fahrenheit to Celsius
  const fToC = (f) => Math.round((f - 32) * 5/9)
  
  // Weather code to icon/description mapping
  // WMO Weather interpretation codes — descKey is an i18next key under `header.weather.*`.
  const getWeatherInfo = (code) => {
    const weatherCodes = {
      0: { icon: 'clear', descKey: 'header.weather.clearSky' },
      1: { icon: 'partly-cloudy', descKey: 'header.weather.mainlyClear' },
      2: { icon: 'partly-cloudy', descKey: 'header.weather.partlyCloudy' },
      3: { icon: 'cloudy', descKey: 'header.weather.overcast' },
      45: { icon: 'fog', descKey: 'header.weather.foggy' },
      48: { icon: 'fog', descKey: 'header.weather.icyFog' },
      51: { icon: 'drizzle', descKey: 'header.weather.lightDrizzle' },
      53: { icon: 'drizzle', descKey: 'header.weather.drizzle' },
      55: { icon: 'drizzle', descKey: 'header.weather.heavyDrizzle' },
      61: { icon: 'rain', descKey: 'header.weather.lightRain' },
      63: { icon: 'rain', descKey: 'header.weather.rain' },
      65: { icon: 'rain', descKey: 'header.weather.heavyRain' },
      71: { icon: 'snow', descKey: 'header.weather.lightSnow' },
      73: { icon: 'snow', descKey: 'header.weather.snow' },
      75: { icon: 'snow', descKey: 'header.weather.heavySnow' },
      80: { icon: 'rain', descKey: 'header.weather.rainShowers' },
      81: { icon: 'rain', descKey: 'header.weather.heavyShowers' },
      95: { icon: 'storm', descKey: 'header.weather.thunderstorm' },
    }
    const entry = weatherCodes[code] || { icon: 'clear', descKey: 'header.weather.unknown' }
    return { ...entry, desc: t(entry.descKey) }
  }
  
  // Fetch weather based on user location
  useEffect(() => {
    // Inside the spectreai.io showcase iframe: skip entirely. The embedder's
    // Permissions-Policy blocks geolocation (logs a console violation) and
    // the /api/geo fallback burns its rate limit for a demo frame. The
    // widget falls back to the cached/default weather it already renders.
    if (IS_SHOWCASE_EMBED) return
    const fetchWeather = async (lat, lon, cityName = null) => {
      try {
        setWeatherLoading(true)
        
        // Get weather data from Open-Meteo (using Celsius for international users)
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=celsius&timezone=auto`
        )
        const weatherData = await weatherRes.json()
        
        // Try to get location name from timezone if not provided
        let locationName = cityName
        if (!locationName && weatherData.timezone) {
          // Extract city from timezone (e.g., "America/New_York" -> "New York")
          const parts = weatherData.timezone.split('/')
          locationName = parts[parts.length - 1].replace(/_/g, ' ')
        }
        locationName = locationName || t('header.yourLocation')
        
        const newWeather = {
          location: locationName,
          temp: Math.round(weatherData.current?.temperature_2m || 0),
          high: Math.round(weatherData.daily?.temperature_2m_max?.[0] || 0),
          low: Math.round(weatherData.daily?.temperature_2m_min?.[0] || 0),
          code: weatherData.current?.weather_code || 0,
          unit: 'celsius',
          lastUpdated: Date.now()
        }
        
        setWeather(newWeather)
        localStorage.setItem('spectre-weather', JSON.stringify(newWeather))
      } catch (error) {
        console.error('Weather fetch error:', error)
      } finally {
        setWeatherLoading(false)
      }
    }
    
    // /api/geo answers a rate-limited or dead upstream with a 429/502 JSON body,
    // not a network error - so `fetch` resolves, `res.json()` succeeds, and the
    // old `.then(data => { if (data.latitude) ... })` silently did nothing while
    // `.catch` never fired. The widget then sat on "Loading... --" forever.
    // Treat any response without usable coordinates as a failure and fall back.
    const geoFallback = () => fetchWeather(40.7128, -74.0060) // New York
    const fetchWeatherFromIp = () => {
      fetch('/api/geo')
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data?.latitude && data?.longitude) fetchWeather(data.latitude, data.longitude, data.city)
          else geoFallback()
        })
        .catch(geoFallback)
    }

    // Check if we need to refresh weather (every 30 min or if unit changed)
    const shouldRefresh = !weather || (Date.now() - (weather.lastUpdated || 0)) > 30 * 60 * 1000 || weather.unit !== 'celsius'
    
    if (shouldRefresh) {
      // Try browser geolocation first
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            fetchWeather(position.coords.latitude, position.coords.longitude)
          },
          (error) => {
            // Fallback to IP-based location via the same-origin /api/geo proxy.
            fetchWeatherFromIp()
          },
          { timeout: 5000, maximumAge: 30 * 60 * 1000 }
        )
      } else {
        // No geolocation support, use IP-based via same-origin /api/geo proxy.
        fetchWeatherFromIp()
      }
    }
  }, [])
  
  // Real-time token search from the normalized /fetch_tokens flow (crypto mode) - disabled in whisper mode.
  // Debounce is the hook's default (500ms) — passing a literal here previously
  // overrode it and defeated the coalescing of rapid keystrokes.
  const {
    results: liveSearchResults,
    loading: cryptoSearchLoading,
    error: searchError,
    tooShort: cryptoSearchTooShort,
    minQueryLength: cryptoSearchMinQueryLength,
  } = useTokenSearch(
    !whisperMode && marketMode === 'crypto' ? searchQuery : ''
  )

  // Real-time stock search (stock mode) - disabled in whisper mode
  const { results: stockSearchResults, loading: stockSearchLoading } = useStockSearch(
    !whisperMode && marketMode === 'stocks' ? searchQuery : ''
  )

  // Whisper Search (AI natural language)
  const { data: whisperData, loading: whisperLoading, error: whisperError, search: whisperSearch, clear: whisperClear } = useWhisperSearch()
  whisperSearchRef.current = whisperSearch // Keep ref fresh for event handler closures

  // Page Finder — fuzzy-match the query against the static PAGE_CATALOG.
  // Returns up to 8 matches sorted by score. Synchronous, runs every keystroke.
  // Prefix '>' forces pages-only mode; otherwise pages render alongside tokens.
  const { matches: pageMatches, mode: searchMode } = usePageSearch(searchQuery, { limit: 6 })

  // Combined loading state
  const searchLoading = whisperMode ? whisperLoading : (marketMode === 'stocks' ? stockSearchLoading : cryptoSearchLoading)

  // Parse market cap string to number (e.g., "42.5M" -> 42500000)
  const parseMcap = (mcapStr) => {
    if (!mcapStr) return 0
    if (typeof mcapStr === 'number') return mcapStr
    const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }
    const match = mcapStr.match(/^[$]?([\d.]+)([KMBT])?$/)
    if (match) {
      const num = parseFloat(match[1])
      const suffix = match[2]
      return suffix ? num * multipliers[suffix] : num
    }
    return parseFloat(mcapStr) || 0
  }

  // Check if search is a contract address - EVM (0x + 40 hex) OR a Solana
  // base58 mint (32-44 chars). Solana mints previously fell through to the
  // name/symbol path, where the address-resolved result got filtered out by
  // matchesQuery (symbol "Forever" doesn't contain the pasted mint) and the
  // modal showed "Results (0)" for a token the backend HAD found.
  const isContractSearch = (() => {
    const q = searchQuery.trim()
    if (q.startsWith('0x') && q.length === 42) return true
    if (q.length >= 32 && q.length <= 44 && !q.startsWith('0x') && /^[1-9A-HJ-NP-Za-km-z]+$/.test(q)) return true
    return false
  })()

  // 2026-06-14: debounce the query that drives the CG search + markets
  // hydration. Previously both effects below keyed on the raw `searchQuery`,
  // so /api/coingecko/search + /coins/markets fired on EVERY keystroke (the
  // PERF_PLAN per-keystroke storm). useTokenSearch already debounces itself
  // (800ms) — this aligns the CG chain so the whole search bar debounces.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearchQuery(searchQuery), 450)
    return () => clearTimeout(id)
  }, [searchQuery])

  // CG-first search hits — shared cached service (cgSearchService.js). This
  // is what catches PaLM AI ($4.36M ETH), real NEURAL, and every other
  // CG-listed token that Codex misses or buries under impostor clones.
  // Falls back to Codex naturally when CG returns nothing.
  const [cgSearchHits, setCgSearchHits] = useState([])
  useEffect(() => {
    const q = debouncedSearchQuery.trim()
    if (!q || q.length < 1 || marketMode !== 'crypto') { setCgSearchHits([]); return }
    let cancelled = false
    getCgSearchHits(q).then(hits => { if (!cancelled) setCgSearchHits(hits) })
    return () => { cancelled = true }
  }, [debouncedSearchQuery, marketMode])

  // Live market data for major-token matches. Same /api/coingecko/coins/
  // markets endpoint welcome-page + watchlists-page use, so all 3 search
  // bars stay consistent.
  const [majorMarketData, setMajorMarketData] = useState({})
  useEffect(() => {
    const q = debouncedSearchQuery.trim().toLowerCase()
    if (!q || q.length < 1 || marketMode !== 'crypto') return
    const matched = []
    const cgIds = []
    for (const sym of MAJOR_SYMBOLS) {
      const upper = sym.toUpperCase()
      const info = MAJOR_TOKEN_INFO[upper] || { symbol: upper, name: upper }
      const symMatch = upper.toLowerCase().includes(q)
      const nameMatch = (info.name || '').toLowerCase().includes(q)
      if (!(symMatch || nameMatch)) continue
      const cgId = SYMBOL_TO_COINGECKO_ID[upper]
      if (cgId) { matched.push(upper); cgIds.push(cgId) }
    }
    if (cgIds.length === 0) return
    if (matched.every(s => majorMarketData[s])) return
    let cancelled = false
    // Shared cached markets fetcher — dedupes with the other search surfaces.
    fetchCgMarketsByIds(cgIds)
      .then(byId => {
        if (cancelled || byId.size === 0) return
        const next = { ...majorMarketData }
        for (const row of byId.values()) {
          const sym = String(row?.symbol || '').toUpperCase()
          if (!sym) continue
          next[sym] = {
            price: Number(row.current_price) || 0,
            change: Number(row.price_change_percentage_24h) || 0,
            marketCap: Number(row.market_cap) || 0,
            volume: Number(row.total_volume) || 0,
            image: row.image || null,
          }
        }
        setMajorMarketData(next)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, marketMode])

  // Map live search results to our token format - ALWAYS use real API data
  const getSearchResults = () => {
    const query = searchQuery.trim().toLowerCase()

    // Progressive paint: the hook now clears stale rows on every query
    // change and streams the fast Spectre lane in before the composer
    // settles — so render whatever is available. Empty ONLY while loading
    // with nothing to show yet (the "Searching..." state).
    if (searchLoading && query.length >= 1 && (!liveSearchResults || liveSearchResults.length === 0)) {
      return [];
    }

    // STOCK MODE: Use stock search results
    if (marketMode === 'stocks') {
      if (stockSearchResults && stockSearchResults.length > 0) {
        return stockSearchResults.map(result => ({
          symbol: result.symbol,
          name: result.name || result.description || result.symbol,
          logo: getStockLogo(result.symbol, result.sector),
          price: result.price || 0,
          change: result.change || result.changePercent || 0,
          mcap: result.marketCap ? fmtLarge(result.marketCap) : 'N/A',
          liquidity: result.volume ? fmtLarge(result.volume) : 'N/A',
          network: result.exchange || result.type || 'NYSE',
          networkId: null, // Stocks don't have network IDs
          ca: null, // Stocks don't have contract addresses
          ticker: result.symbol,
          sector: result.sector || '',
          exchange: result.exchange || result.type || 'NYSE',
          isStock: true,
          assetClass: 'stock',
          // Ensure we have real numeric values
          marketCap: result.marketCap || 0,
          volume: result.volume || 0,
        }))
      }

      // No stock results found
      if (query.length >= 1 && !searchLoading && (!stockSearchResults || stockSearchResults.length === 0)) {
        return []
      }

      return []
    }

    // CRYPTO MODE: shared merge pipeline (lib/search-merge.js) — majors
    // first, CG-canonical prepends above Codex impostors, trust-ranked
    // live/DEX rows, same-asset folding ("$PAAL" vs CG "PAAL") and the
    // stale-CG demotion. The logic used to live inline here (and in 3 more
    // near-copies); it is now shared so ranking fixes land everywhere.
    const majorRows = buildMajorMatches(query, majorMarketData)
    const liveRows = (liveSearchResults || []).map(r => ({
      ...r,
      price: r.price || r.priceUSD || 0,
      change: r.change ?? r.change24 ?? 0,
      volume: r.volume || r.volume24 || 0,
    }))
    const merged = mergeTokenSearchResults({
      query: searchQuery.trim(),
      majorRows,
      cgHits: cgSearchHits,
      liveRows,
    })
    if (merged.length > 0) {
      return merged.map(r => ({
        symbol: r.symbol,
        name: r.name,
        logo: r.logo || null,
        price: r.price || 0,
        change: r.change || 0,
        mcap: r.marketCap ? fmtLarge(r.marketCap) : 'N/A',
        // Row label is "Vol" — prefer real volume, fall back to LP so
        // on-chain rows without a volume read still show something real.
        liquidity: r.volume ? fmtLarge(r.volume) : (r.liquidity ? fmtLarge(r.liquidity) : 'N/A'),
        network: r.network || null,
        networkId: r.networkId ?? null,
        ca: r.address || null,
        cgId: r.cgId || null,
        codexId: r.codexId || r.address || null,
        tokenId: r.tokenId || null,
        isStock: false,
        isMajor: !!r.isMajor,
        isCgCanonical: !!r.isCgCanonical,
        marketCap: r.marketCap || 0,
        volume: r.volume || 0,
      }))
    }

    // No local fallback - only show API results
    // If API returns nothing, show empty (user can try different search)
    if (query.length >= 1 && !searchLoading && (!liveSearchResults || liveSearchResults.length === 0)) {
      return []
    }

    // No search query - return empty (don't show hardcoded tokens)
    if (query.length < 1) {
      return []
    }

    return []
  }
  
  const tokens = getSearchResults()

  // Prewarm the CG contract-index lookup for address-searched rows so the
  // click-time degen-routing check (app-shell handleSelectTokenAndOpen) hits
  // the cache instead of a cold 200-500ms CG round-trip. Idempotent: the
  // lookup module caches per address, so re-renders are no-ops.
  useEffect(() => {
    if (!isContractSearch) return
    for (const r of tokens.slice(0, 3)) {
      const addr = r?.ca || r?.address
      if (addr && !r?.cgId) prewarmCgContractLookup(addr, r?.networkId ?? 1)
    }
  }, [isContractSearch, tokens])
  
  // Add full token data to search history + track search selection
  const addToHistory = (token) => {
    track(Events.SEARCH, {
      search_query: searchQuery.trim(),
      results_count: tokens.length,
      selected_token: token.symbol,
      selected_token_name: token.name || null,
      selected_token_address: token.ca || null,
      network_id: token.networkId ?? null,
      is_stock: !!token.isStock,
    })
    const tokenData = {
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      price: token.price,
      change: token.change,
      mcap: token.mcap,
      liquidity: token.liquidity,
      marketCap: token.marketCap || 0,
      volume: token.volume || 0,
      network: token.network,
      ca: token.ca,
      networkId: token.networkId,
      cgId: token.cgId || null,
      codexId: token.codexId || token.ca || null,
      tokenId: token.tokenId || null,
    }
    // Remove any existing entry with same address or symbol, then prepend
    const updated = [
      tokenData,
      ...recentTokens.filter(t => t.ca !== token.ca && t.symbol !== token.symbol)
    ].slice(0, 8) // Keep last 8 recent tokens
    setRecentTokens(updated)
    localStorage.setItem('searchHistoryTokens', JSON.stringify(updated))
  }
  
  // Clear search history
  const clearHistory = () => {
    setRecentTokens([])
    localStorage.removeItem('searchHistoryTokens')
  }
  
  // State for recent tokens with live data
  const [recentTokensWithLiveData, setRecentTokensWithLiveData] = useState([])
  const [recentTokensLoading, setRecentTokensLoading] = useState(false)

  // Fetch live data for recent tokens - fire-and-forget, progressive update.
  // Runs once on Header mount AND when modal opens, but never blocks UI.
  const lastRefreshRef = useRef(0)
  const refreshRecentTokensLiveData = useCallback(() => {
    const now = Date.now()
    // Skip if refreshed within the last 20s (avoid spam)
    if (now - lastRefreshRef.current < 20_000) return
    const current = recentTokens
    if (!current || current.length === 0) return
    lastRefreshRef.current = now

    // Split by identity source:
    //  - Rows with a cgId are CG-canonical assets (majors + CG listings).
    //    They MUST refresh from CG markets — refreshing them by contract
    //    served the WRAPPED deployment's stats (recent "ETH" carries the
    //    WETH contract 0xC02..., and details-batch painted WETH's $4.3B
    //    mcap / DEX volume onto Ethereum).
    //  - Contract-only rows (no cgId) refresh via ONE /details-batch call
    //    (2026-06-02 cost defense: N parallel /details → 1 batch; snapshot
    //    covers the hot set, DEX-only misses collapse to one filterTokens).
    const cgIdRows = current.filter(t => t.cgId && !t.isStock)
    if (cgIdRows.length > 0) {
      fetchCgMarketsByIds([...new Set(cgIdRows.map(t => t.cgId))])
        .then(byId => {
          if (!byId || byId.size === 0) return
          setRecentTokensWithLiveData(prev => {
            const base = prev.length === current.length ? [...prev] : [...current]
            for (let idx = 0; idx < current.length; idx++) {
              const t = current[idx]
              const row = t.cgId ? byId.get(t.cgId) : null
              if (!row) continue
              const mc = Number(row.market_cap) || 0
              const vol = Number(row.total_volume) || 0
              base[idx] = {
                ...base[idx],
                price: Number(row.current_price) || 0,
                change: Number(row.price_change_percentage_24h) || 0,
                mcap: mc > 0 ? fmtLarge(mc) : 'N/A',
                liquidity: vol > 0 ? fmtLarge(vol) : 'N/A',
                marketCap: mc,
                volume: vol,
                logo: base[idx].logo || row.image || null,
              }
            }
            return base
          })
        })
        .catch(() => { /* silent - keep cached data */ })
    }
    const ids = current
      .filter(t => t.ca && !t.cgId)
      .map(t => `${t.ca}:${t.networkId || 1}`)
      .join(',')
    if (!ids) return
    const batchUrl = isDev
      ? `/api/token/details-batch?ids=${encodeURIComponent(ids)}`
      : `/api/codex?action=details-batch&ids=${encodeURIComponent(ids)}`
    fetch(batchUrl)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || typeof data !== 'object') return
        // Server returns { '<addr-lowercase>': detailRow, ... } or
        // { tokens: { '<addr>': row, ... } } - support both shapes.
        const rows = data.tokens || data
        setRecentTokensWithLiveData(prev => {
          const base = prev.length === current.length ? [...prev] : [...current]
          for (let idx = 0; idx < current.length; idx++) {
            const t = current[idx]
            if (!t.ca || t.cgId) continue
            const row = rows[t.ca.toLowerCase()] || rows[t.ca]
            if (!row || row.price === undefined) continue
            base[idx] = {
              ...base[idx],
              price: row.price || 0,
              change: row.change24 || 0,
              mcap: fmtLarge(row.marketCap || 0),
              liquidity: fmtLarge(row.liquidity || 0),
              marketCap: row.marketCap || 0,
              volume: row.volume24 || 0,
            }
          }
          return base
        })
      })
      .catch(() => { /* silent - keep cached data */ })
  }, [recentTokens, fmtLarge])

  // On Header mount: seed cached recents so the search modal renders instantly
  // when opened. Live refresh is deferred until the modal actually opens.
  useEffect(() => {
    if (recentTokens.length > 0) {
      setRecentTokensWithLiveData(recentTokens)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When search opens with empty query: show cached recents instantly, refresh in background
  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length > 0) return
    if (recentTokens.length === 0) return
    // Show cached recents immediately (instant render)
    setRecentTokensWithLiveData(prev => prev.length > 0 ? prev : recentTokens)
    // Silently refresh live data in background (throttled to 20s)
    refreshRecentTokensLiveData()
  }, [searchOpen, searchQuery, recentTokens, refreshRecentTokensLiveData])

  // Filter tokens based on search or show recent (with live data)
  const filteredTokens = searchQuery.trim().length >= 1
    ? tokens // Search results (live API data)
    : (recentTokensWithLiveData.length > 0 ? recentTokensWithLiveData : recentTokens) // Show recently viewed tokens with live data

  // Time interval moved to HeaderClock component

  // Keyboard shortcuts
  // Close search and clear the input
  const stopVoice = () => {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
    setVoiceListening(false)
  }

  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      // Speech Recognition not supported
      return
    }
    stopVoice()
    const recognition = new SpeechRecognition()
    recognition.lang = i18n.language || 'en-US'
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.continuous = false
    recognitionRef.current = recognition

    recognition.onstart = () => setVoiceListening(true)
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('')
      setSearchQuery(transcript)
      // If final result and whisper mode, auto-search
      if (event.results[0].isFinal && transcript.trim().length >= 3) {
        if (whisperMode) {
          whisperSearch(transcript.trim())
        }
      }
    }
    recognition.onerror = (e) => {
      // silently handled
      setVoiceListening(false)
    }
    recognition.onend = () => setVoiceListening(false)
    recognition.start()
  }

  const toggleVoice = () => {
    if (voiceListening) {
      stopVoice()
    } else {
      // Auto-enable whisper mode when using voice
      if (!whisperMode) setWhisperMode(true)
      startVoice()
    }
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setFullView(false)
    setWhisperMode(false)
    whisperClear()
    stopVoice()
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      // ⌘⇧K or Ctrl+Shift+K to toggle whisper mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        setWhisperMode(prev => !prev)
        return
      }
      // ⌘K or Ctrl+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      // ESC to close search
      if (e.key === 'Escape') {
        closeSearch()
      }
    }
    // Custom event from MobileHeader search button
    const handleOpenSearch = () => setSearchOpen(true)
    // Custom event from MobileHeader voice button - opens search + starts voice
    // IMPORTANT: Start voice synchronously to preserve user gesture chain on mobile.
    // setTimeout breaks the gesture requirement on iOS/Android.
    const handleOpenVoiceSearch = () => {
      setSearchOpen(true)
      setWhisperMode(true)
      // Start voice recognition immediately - synchronous call preserves user gesture
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (SpeechRecognition) {
        stopVoice()
        const recognition = new SpeechRecognition()
        recognition.lang = i18n.language || 'en-US'
        recognition.interimResults = true
        recognition.maxAlternatives = 1
        recognition.continuous = false
        recognitionRef.current = recognition
        recognition.onstart = () => setVoiceListening(true)
        recognition.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map(r => r[0].transcript)
            .join('')
          setSearchQuery(transcript)
          if (event.results[0].isFinal && transcript.trim().length >= 3) {
            // Use ref to avoid stale closure from empty deps useEffect
            whisperSearchRef.current?.(transcript.trim())
          }
        }
        recognition.onerror = (e) => {
          // silently handled
          setVoiceListening(false)
        }
        recognition.onend = () => setVoiceListening(false)
        try {
          recognition.start()
        } catch (err) {
          // silently handled
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('open-search', handleOpenSearch)
    window.addEventListener('open-voice-search', handleOpenVoiceSearch)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('open-search', handleOpenSearch)
      window.removeEventListener('open-voice-search', handleOpenVoiceSearch)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Add body class when search is open
  useEffect(() => {
    if (searchOpen) {
      document.body.classList.add('search-open')
    } else {
      document.body.classList.remove('search-open')
    }
    return () => document.body.classList.remove('search-open')
  }, [searchOpen])

  // dayName and timeStr moved to HeaderClock component

  // Format temperature based on unit
  const formatTemp = (tempC) => {
    if (tempC == null) return '--'
    const temp = tempUnit === 'fahrenheit' ? cToF(tempC) : tempC
    return `${temp}°`
  }

  const isDayMode = welcomeActive ? welcomeDayMode : researchZoneActive ? researchZoneDayMode : false

  return (
    <>
    {/* Line wrapper rendered outside header stacking context so it appears above the sidebar */}
    <div className="header-line-wrapper" />
    <header className="header">
      {/* Electron desktop: invisible drag region for window movement */}
      <div className="desktop-drag-region" />
      <div className="header-inner">
        {/* Left: Logo + Weather + Time */}
        <div className="header-left">
          <button className="logo" onClick={onLogoClick} data-tooltip={t('header.discoverTokens', 'Discover Tokens')}>
            <img src="/logo-dark-mode.png" alt="Spectre AI" width="144" height="38" fetchpriority="high" className="logo-icon wordmark logo-dark-mode" />
            <img src="/logo-day-mode.png" alt="Spectre AI" width="144" height="38" className="logo-icon wordmark logo-light-mode" />
            <span className="sr-only">Spectre AI</span>
          </button>

          <div className="header-spacer"></div>

          {/* Weather Widget - Apple Style with Real Data */}
          <div 
            className="weather-card" 
            onClick={() => { track(Events.SETTINGS_CHANGED, { setting: 'temp_unit', value: tempUnit === 'celsius' ? 'fahrenheit' : 'celsius' }); toggleTempUnit() }}
            data-tooltip={weather ? `${getWeatherInfo(weather.code).desc} • ${t('header.toggleTempUnit', { unit: tempUnit === 'celsius' ? 'Fahrenheit' : 'Celsius' })}` : t('header.loadingWeather')}
                       style={{ cursor: 'pointer' }}
          >
            <div className={`weather-icon-large ${weather ? getWeatherInfo(weather.code).icon : 'loading'}`}>
              {(!weather || getWeatherInfo(weather.code).icon === 'clear') && (
              <div className="sun"></div>
              )}
              {weather && ['partly-cloudy', 'cloudy', 'fog'].includes(getWeatherInfo(weather.code).icon) && (
                <div className="cloud"></div>
              )}
              {weather && ['rain', 'drizzle', 'storm'].includes(getWeatherInfo(weather.code).icon) && (
              <div className="cloud">
                <div className="rain-drops">
                  <span></span><span></span><span></span>
                </div>
              </div>
              )}
              {weather && getWeatherInfo(weather.code).icon === 'snow' && (
                <div className="cloud">
                  <div className="snow-flakes">
                    <span>❄</span><span>❄</span><span>❄</span>
                  </div>
                </div>
              )}
              {weatherLoading && <div className="weather-spinner animate-shimmer" style={{ width: 24, height: 24, borderRadius: 6 }}></div>}
            </div>
            <div className="weather-info">
              <span className="weather-location">{weather?.location || t('common.loading')}</span>
              <div className="weather-temps">
                <span className="temp-high">{formatTemp(weather?.high)}</span>
                <span className="temp-divider">/</span>
                <span className="temp-low">{formatTemp(weather?.low)}</span>
                <span className="temp-unit">°{tempUnit === 'celsius' ? 'C' : 'F'}</span>
              </div>
            </div>
          </div>

          {/* Date/Time Widget + Mode Switch */}
          <div className="datetime-wrap">
            <HeaderClock timeFormat={timeFormat} onToggleFormat={() => { track(Events.SETTINGS_CHANGED, { setting: 'time_format', value: timeFormat === '12h' ? '24h' : '12h' }); toggleTimeFormat() }} />

            {/* Day/Night Mode Switch - Apple pill style, matches Trading Platform.
                Trading Lite (tradingModeActive) is DARK-ONLY: render the switch
                LOCKED in the dark state so users can't flip the embed to white
                (the trading terminal has no light-theme parity). The global
                dayMode preference is untouched - it just doesn't apply here. */}
            {tradingModeActive ? (
              <button
                type="button"
                className="mode-switch is-locked"
                aria-disabled="true"
                title={t('header.tradingLiteDarkOnly', 'Trading Lite is dark mode only')}
                onClick={(e) => e.preventDefault()}
              >
                <span className="sr-only">Dark mode (locked on Trading Lite)</span>
                <span className="mode-switch-icon moon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                </span>
                <span className="mode-switch-icon sun" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                </span>
                <span className="mode-switch-thumb" />
                <span className="header-lock-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                </span>
              </button>
            ) : ((researchZoneActive && onResearchZoneDayModeChange) || (welcomeActive && onWelcomeDayModeChange)) ? (
              <button
                className={`mode-switch ${(researchZoneActive ? researchZoneDayMode : welcomeDayMode) ? 'is-on' : ''}`}
                type="button"
                onClick={() => { const nextDay = researchZoneActive ? !researchZoneDayMode : !welcomeDayMode; track(Events.SETTINGS_CHANGED, { setting: 'theme', value: nextDay ? 'day' : 'night' }); updateThemeSuperProp(nextDay ? 'day' : 'dark'); researchZoneActive ? onResearchZoneDayModeChange(!researchZoneDayMode) : onWelcomeDayModeChange(!welcomeDayMode) }}
                aria-pressed={researchZoneActive ? researchZoneDayMode : welcomeDayMode}
                aria-label={(researchZoneActive ? researchZoneDayMode : welcomeDayMode) ? t('header.switchToNight') : t('header.switchToDay')}
              >
                <span className="sr-only">{(researchZoneActive ? researchZoneDayMode : welcomeDayMode) ? 'Light mode' : 'Dark mode'}</span>
                <span className="mode-switch-icon moon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                </span>
                <span className="mode-switch-icon sun" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                </span>
                <span className="mode-switch-thumb" />
              </button>
            ) : null}

            {/* Take-a-tour launcher - replays the global welcome tour; pulses
                once for a first-time visitor who hasn't seen it yet. */}
            {!demoMode && onStartTour && (
              <TourLaunchButton
                onClick={onStartTour}
                pulse={!appTourSeen}
                label={t('header.tour', 'Tour')}
                title={t('header.takeTour', 'Take a quick tour')}
              />
            )}

            {/* Info Switch - educational tooltips toggle with hover tooltip */}
            {demoMode ? (
              <button
                type="button"
                className="info-switch is-locked"
                aria-disabled="true"
                title={t('header.betaUnavailable', 'Available in Beta')}
                onClick={(e) => e.preventDefault()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span className="header-lock-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                </span>
              </button>
            ) : (
              <InfoSwitchBtn infoMode={infoMode} toggleInfoMode={() => { track(Events.SETTINGS_CHANGED, { setting: 'info_mode', value: !infoMode }); toggleInfoMode() }} />
            )}

            {/* Install App – only when browser offers install (not already installed) */}
            {installPrompt && (
              <button
                type="button"
                className="header-install-btn"
                onClick={handleInstallClick}
                data-tooltip={t('header.installApp', 'Install App')}
                             >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="header-install-text">{t('header.installAppShort', 'App')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Center: Search Trigger - Apple Glass, matches Trading Platform */}
        <div className="header-center">
          <button
            className={`search-trigger ${demoMode ? 'is-locked' : ''}`}
            data-tour="app-search"
            onClick={() => { if (demoMode) return; setSearchOpen(true) }}
            aria-label={demoMode ? 'Search (locked in preview)' : 'Search tokens (Ctrl K)'}
            aria-disabled={demoMode || undefined}
            title={demoMode ? 'Available in Beta' : undefined}
          >
            <span className="search-icon-wrap" aria-hidden="true">
              <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="10" r="7" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </span>
            <span className="search-placeholder">{t('common.search')}</span>
            {demoMode ? (
              <span className="search-shortcut" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
              </span>
            ) : (
              <span className="search-shortcut" aria-hidden="true">
                <kbd>{navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}</kbd>
                <kbd>K</kbd>
              </span>
            )}
          </button>
        </div>

        {/* Right: Actions + Profile */}
        <div className="header-right">
          {/* LITE mode - full-screen simple landing (Glass / Paper). PRO is
              this whole app; the pill on /lite brings the user back. */}
          {!demoMode && (
            <button
              type="button"
              className="header-lite-btn"
              onClick={() => { track(Events.SETTINGS_CHANGED, { setting: 'app_mode', value: 'lite' }); navigate('/lite') }}
              data-tooltip={t('header.openLite', 'Switch to Spectre LITE')}
            >
              {t('header.lite', 'LITE')}
            </button>
          )}
          {/* Crypto / Stocks toggle – in right section so it doesn't overlay search or % */}
          <div className="header-market-toggle" role="tablist" aria-label={t('header.marketTypeAria', 'Market type')}>
            <button
              type="button"
              role="tab"
              aria-selected={marketMode === 'crypto'}
              className={marketMode === 'crypto' ? 'active' : ''}
              onClick={() => { track(Events.SETTINGS_CHANGED, { setting: 'market_mode', value: 'crypto' }); setUserProps({ market_mode: 'crypto' }); setMarketMode('crypto') }}
            >
              {t('nav.crypto')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={marketMode === 'stocks'}
              className={marketMode === 'stocks' ? 'active' : ''}
              onClick={() => { track(Events.SETTINGS_CHANGED, { setting: 'market_mode', value: 'stocks' }); setUserProps({ market_mode: 'stocks' }); setMarketMode('stocks') }}
            >
              {t('nav.stocks')}
            </button>
          </div>

          {/* Cross-nav: Trading Platform - hidden in demo mode.
              Navigate in the SAME tab so repeated switching between Trading
              and Research doesn't spawn duplicate tabs. Users who want a new
              tab can still middle-click / Cmd-click — that's standard browser
              behavior on a plain anchor. */}
          {!demoMode && (
            <a
              href={isDev ? `http://localhost:${__TRADING_PORT__}/#` : 'https://trade.spectreai.io/#'}
              className="btn-degen btn-cross-nav"
              data-tooltip={t('header.openTrading', 'Open Trading Platform')}
              onClick={(e) => {
                // Installed PWA: leaving the origin pops the in-app browser
                // sheet (browser chrome). Keep Trading in-app via /token.
                if (isStandalonePwa()) {
                  e.preventDefault()
                  navigate(getPathForPageId('ai-screener'))
                }
              }}
            >
              <span className="degen-content">
                <svg className="degen-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                  <polyline points="16 7 22 7 22 13"/>
                </svg>
                <span className="degen-text">{t('header.trading', 'Trading')}</span>
              </span>
            </a>
          )}

          {/* Extras dropdown - GM + ROI + Crypto Memory (hidden in demo mode) */}
          {!demoMode && (
          <div className="header-extras-wrap">
            <button type="button" className={`header-extras-trigger${extrasMenuOpen ? ' is-open' : ''}`} onClick={() => { setExtrasMenuOpen(o => !o); setProfileDropdownOpen(false); setSettingsPanelOpen(false) }} aria-expanded={extrasMenuOpen} aria-haspopup="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>
            {extrasMenuOpen && (
              <>
                <div className="header-extras-menu">
                  <button type="button" className="header-extras-item" onClick={() => { if (onOpenGM) onOpenGM(); else triggerCopyToast?.('GM! Have a great one.'); setExtrasMenuOpen(false) }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
                    </svg>
                    <span>{t('header.gm')}</span>
                  </button>
                  <button type="button" className="header-extras-item" onClick={() => { onOpenROI?.(); setExtrasMenuOpen(false) }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 20h.01" /><path d="M7 20v-4" /><path d="M12 20v-8" /><path d="M17 20V8" /><path d="M22 4v16" />
                    </svg>
                    <span>{t('header.roiPercent')}</span>
                  </button>
                  <button type="button" className="header-extras-item" onClick={() => { setMemoryGameOpen(true); setExtrasMenuOpen(false) }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"/>
                    </svg>
                    <span>{t('header.cryptoMemory', 'Crypto Memory')}</span>
                  </button>
                  <button type="button" className="header-extras-item" onClick={() => { setRunnerGameOpen(true); setExtrasMenuOpen(false) }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                    </svg>
                    <span>{t('header.spectreRunner', 'Spectre Runner')}</span>
                  </button>
                </div>
              </>
            )}
          </div>
          )}

          <div className="header-icons">
            {/* Intelligence Feed is a desktop experience — the large panel is awkward on mobile. */}
            {!isMobile && (
            <button
              className={`icon-btn${notifPanelOpen ? ' is-open' : ''}${demoMode ? ' is-locked' : ''}`}
              data-tooltip={demoMode ? t('header.betaUnavailable', 'Available in Beta') : t('header.notifications')}
              aria-disabled={demoMode || undefined}
              onClick={() => { if (demoMode) return; setNotifPanelOpen(o => !o); setSettingsPanelOpen(false); setProfileDropdownOpen(false) }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {demoMode ? (
                <span className="header-lock-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                </span>
              ) : (
                notifUnread > 0 && <span className="notification-dot"></span>
              )}
            </button>
            )}

            {/* Themes — the Theme Studio's new home. It used to be a floating
                fab parked over the bottom-right of every page (on top of a Top
                Coins row and the watchlist Add tile). Sits beside Settings
                because that is what it is: an appearance control. */}
            <button
              type="button"
              className="icon-btn"
              data-tooltip={t('header.themes', 'Themes')}
              aria-label={t('header.themes', 'Themes')}
              onClick={() => { openThemeStudio(); setNotifPanelOpen(false); setSettingsPanelOpen(false); setProfileDropdownOpen(false) }}
            >
              <ThemeStudioIcon size={20} strokeWidth={1.5} />
            </button>

            <button className={`icon-btn${settingsPanelOpen ? ' is-open' : ''}`} data-tooltip={t('header.settings')} aria-label={t('header.settings')} onClick={() => { setSettingsPanelOpen(o => !o); setNotifPanelOpen(false); setProfileDropdownOpen(false) }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {notifPanelEverOpened && (
            <React.Suspense fallback={null}>
              <NotificationPanel open={notifPanelOpen} onClose={() => setNotifPanelOpen(false)} />
            </React.Suspense>
          )}
          {settingsPanelEverOpened && (
            <React.Suspense fallback={null}>
              <SettingsPanel open={settingsPanelOpen} onClose={() => setSettingsPanelOpen(false)} dayMode={isDayMode} />
            </React.Suspense>
          )}

          {!isAuthenticated ? (
              <button
                type="button"
                className={`header-auth-signin${demoMode ? ' is-locked' : ''}`}
                aria-disabled={demoMode || undefined}
                title={demoMode ? 'Available in Beta' : undefined}
                onClick={() => { if (demoMode) return; privyLogin?.() }}
              >
                {demoMode ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                )}
                Sign In
              </button>
          ) : (
          <div className="profile-dropdown-wrap">
            <button type="button" className={`profile profile-trigger ${profileDropdownOpen ? 'is-open' : ''}`} onClick={() => { setProfileDropdownOpen((o) => !o); setSettingsPanelOpen(false) }} aria-expanded={profileDropdownOpen} aria-haspopup="true">
              <div className="avatar">
                {profile.imageUrl ? (
                  <img src={profile.imageUrl} alt="Profile" width="32" height="32" decoding="async" />
                ) : (
                  <span className="avatar-initial">{(profile.name || 'U').charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="profile-info">
                <span className="profile-name">{profile.name}</span>
                <span className="profile-balance">{formatBalance(totalUsd)}</span>
              </div>
              <svg className="profile-chevron" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            {profileDropdownOpen && (
              <>
                <div className="profile-dropdown-panel" onClick={(e) => e.stopPropagation()}>
                  {/* Profile header */}
                  <div className="pdp-header">
                    <div className="pdp-avatar">
                      {profile.imageUrl ? (
                        <img src={profile.imageUrl} alt="" width="40" height="40" decoding="async" />
                      ) : (
                        <span className="pdp-avatar-initial">{(profile.name || 'U').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="pdp-identity">
                      <span className="pdp-name">{profile.name}</span>
                      {isAuthenticated && privyInfo.email && (
                        <span className="pdp-email">{privyInfo.email}</span>
                      )}
                    </div>
                  </div>

                  <div className="pdp-divider" />

                  {/* Menu items */}
                  <div className="pdp-menu">
                    {/* Referral */}
                    {isAuthenticated && referralCode && (
                      <div className="pdp-menu-item pdp-menu-item--referral">
                        <svg className="pdp-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
                        <span className="pdp-menu-label">{t('header.referral', 'Referral')}</span>
                        <code className="pdp-referral-code">{referralCode}</code>
                        <button type="button" className="pdp-copy-btn" onClick={() => { navigator.clipboard.writeText(referralCode); triggerCopyToast(t('header.referralCopied', 'Referral code copied!')) }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                        </button>
                      </div>
                    )}

                    {/* User Dashboard */}
                    <button type="button" className="pdp-menu-item" onClick={() => { navigate('/user-dashboard'); setProfileDropdownOpen(false) }}>
                      <svg className="pdp-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="4" rx="1" /><rect x="14" y="11" width="7" height="10" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
                      <span className="pdp-menu-label">{t('header.userDashboard', 'User Dashboard')}</span>
                      <svg className="pdp-menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                    </button>

                    {/* Settings */}
                    <button type="button" className="pdp-menu-item" onClick={() => { setSettingsPanelOpen(true); setProfileDropdownOpen(false) }}>
                      <svg className="pdp-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
                      <span className="pdp-menu-label">{t('header.settings')}</span>
                      <svg className="pdp-menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                    </button>
                  </div>

                  <div className="pdp-divider" />

                  {/* Sign out */}
                  {isAuthenticated && (
                    <button
                      type="button"
                      className="pdp-menu-item pdp-menu-item--signout"
                      onClick={() => { track(Events.SIGN_OUT || 'sign_out'); privyLogout(); setProfileDropdownOpen(false) }}
                    >
                      <svg className="pdp-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                      <span className="pdp-menu-label">{t('header.signOut', 'Sign Out')}</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          )}

        </div>
      </div>

      {/* Reward Claimed! congrats modal – portal to body */}
      {claimModalOpen && claimModalDay != null && createPortal(
        <div className="reward-claimed-overlay" onClick={closeClaimModal}>
          <div className="reward-claimed-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="reward-claimed-close" onClick={closeClaimModal} aria-label={t('common.close', 'Close')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
            <div className="reward-claimed-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12c0 1.1.9 2 2 2h14v-4" /><path d="M18 12a2 2 0 00-2 2c0 1.1.9 2 2 2h4v-4h-2z" /></svg>
            </div>
            <h2 className="reward-claimed-title">{t('header.rewardClaimed', 'Reward Claimed!')}</h2>
            <p className="reward-claimed-day">{t('header.dayOfTotal', 'Day {{day}} of {{total}}', { day: claimModalDay, total: 30 })}</p>
            <div className="reward-claimed-badges">
              <span className="reward-claimed-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                {t('header.plusOnePoint', '+1 Point')}
              </span>
              <span className="reward-claimed-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0012 0V2z" /></svg>
                {t('header.daysOfThirty', '{{n}}/30 Days', { n: gamification.challengeDaysCompleted })}
              </span>
            </div>
            <p className="reward-claimed-message">{t('header.rewardKeepGoing', 'Keep it up! Claim your reward every day to earn 100 SPECTRE Tokens!')}</p>
            <p className="reward-claimed-hint">{t('header.pressEscape', 'Press Escape or click outside to close')}</p>
          </div>
        </div>,
        document.body
      )}

      {/* Crypto Memory Game modal – portal to body so it centers above everything */}
      {memoryGameOpen && createPortal(
        <React.Suspense fallback={null}>
          <CryptoMemoryGame onClose={() => setMemoryGameOpen(false)} />
        </React.Suspense>,
        document.body
      )}

      {/* Spectre Runner Game modal */}
      {runnerGameOpen && createPortal(
        <React.Suspense fallback={null}>
          <SpectreRunnerGame onClose={() => setRunnerGameOpen(false)} />
        </React.Suspense>,
        document.body
      )}

      {/* Search Modal - Portal to body so it escapes header stacking context */}
      {searchOpen && createPortal(
        <div className={`search-portal-root${isDayMode ? ' search-day-mode' : ''}${fullView ? ' full-view-active' : ''}`}>
          <div className="search-modal-overlay" onClick={closeSearch} />
          <div className={`search-modal-v2${fullView ? ' full-view' : ''}`} onClick={(e) => e.stopPropagation()}>
            {/* Search Input Bar */}
            <div className={`search-input-bar${whisperMode ? ' whisper-glow' : ''}`}>
              {/* Search icon (left side) */}
              <div className="search-input-icon-wrap">
                {whisperMode ? (
                  <svg className="search-input-icon whisper-icon-active" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 20 12 16.27 7.82 20l1.09-6.83L3.82 9.27l6.09-1.01L12 2z" />
                  </svg>
                ) : (
                  <svg className="search-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="10" cy="10" r="7" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                )}
              </div>

              {/* Whisper badges - inline before input */}
              {whisperMode && (
                <div className="whisper-badges">
                  <span className="whisper-ai-badge">AI</span>
                  {whisperData && (
                    <span className={`whisper-asset-pill ${whisperData.assetClass === 'stocks' ? 'stocks' : 'crypto'}`}>
                      {whisperData.assetClass === 'stocks' ? t('nav.stocks') : t('nav.crypto')}
                    </span>
                  )}
                </div>
              )}

              <input
                type="text"
                placeholder={whisperMode
                  ? t('header.searchAI')
                  : (marketMode === 'stocks' ? t('header.searchStocks') : t('header.search'))}
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter in whisper mode triggers AI search
                  if (whisperMode && e.key === 'Enter' && searchQuery.trim().length >= 3) {
                    e.preventDefault()
                    whisperSearch(searchQuery)
                  }
                  // Tab toggles mode when input is empty
                  if (e.key === 'Tab' && !searchQuery.trim()) {
                    e.preventDefault()
                    setWhisperMode(prev => !prev)
                    whisperClear()
                  }
                }}
                className="search-input-v2"
              />
              <div className="search-input-actions">
                {/* Whisper AI toggle - desktop only */}
                {!isMobile && (
                  <button
                    className={`search-whisper-toggle${whisperMode ? ' active' : ''}`}
                    type="button"
                    onClick={() => {
                      setWhisperMode(prev => !prev)
                      whisperClear()
                      setSearchQuery('')
                      stopVoice()
                    }}
                    data-tooltip={whisperMode ? 'Switch to standard search' : 'Whisper AI Search'}
                    aria-label={whisperMode ? 'Switch to standard search' : 'Whisper AI Search'}
                  >
                    <svg viewBox="0 0 24 24" fill={whisperMode ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={whisperMode ? '0' : '1.8'} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 20 12 16.27 7.82 20l1.09-6.83L3.82 9.27l6.09-1.01L12 2z" />
                    </svg>
                  </button>
                )}

                {/* Voice mic button - desktop whisper mode only */}
                {!isMobile && whisperMode && (
                  <button
                    className={`search-voice-btn${voiceListening ? ' listening' : ''}`}
                    type="button"
                    onClick={toggleVoice}
                    data-tooltip={voiceListening ? 'Stop listening' : 'Voice search'}
                    aria-label={voiceListening ? 'Stop listening' : 'Voice search'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                    {voiceListening && <span className="voice-pulse-ring" />}
                  </button>
                )}

                {searchQuery && (
                  <button className="search-action-btn" onClick={() => { setSearchQuery(''); stopVoice() }} title={t('header.clearSearch', 'Clear search')} aria-label={t('header.clearSearch', 'Clear search')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
                {/* Fullview toggle - desktop only */}
                {!isMobile && (
                  <button
                    className="search-fullview-btn"
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFullView(prev => !prev) }}
                    data-tooltip={fullView ? t('header.exitFullView', 'Exit full view') : t('header.enterFullView', 'Enter full view')}
                    aria-label={fullView ? t('header.exitFullView', 'Exit full view') : t('header.enterFullView', 'Enter full view')}
                  >
                    {fullView ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="10" cy="10" r="7" />
                        <path d="M21 21l-4.35-4.35" />
                        <path d="M7 10h6" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="10" cy="10" r="7" />
                        <path d="M21 21l-4.35-4.35" />
                        <path d="M10 7v6M7 10h6" />
                      </svg>
                    )}
                  </button>
                )}
                <button className="search-close-btn" onClick={closeSearch} data-tooltip={t('header.closeEsc', 'Close (ESC)')} aria-label={t('common.close', 'Close')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Pages section — fuzzy match against PAGE_CATALOG.
                Rendered above tokens/whisper when in 'all' or 'pages' mode and
                we have matches. Hidden when explicitly in tokens/ask mode. */}
            {(searchMode === 'all' || searchMode === 'pages') && pageMatches.length > 0 && (
              <div className={`search-results-v2 page-results-wrap${fullView ? ' full-view-results' : ''}`}>
                <PageResults matches={pageMatches} onClose={closeSearch} />
              </div>
            )}

            {/* Tokens / Whisper results — hidden when in pages-only mode */}
            {searchMode !== 'pages' && (
            <>
            {/* Results Section - Whisper AI or Standard */}
            {whisperMode ? (
              <div className={`search-results-v2 whisper-results-wrap${fullView ? ' full-view-results' : ''}`}>
                <WhisperResults
                  data={whisperData}
                  loading={whisperLoading}
                  error={whisperError}
                  onSelectToken={(token) => {
                    const tokenData = {
                      symbol: token.symbol,
                      name: token.name,
                      address: token.address || null,
                      networkId: token.networkId || 1,
                      price: token.price,
                      change: token.change24h || token.change,
                      logo: token.logo,
                      cgId: token.cgId || null,
                      codexId: token.codexId || token.address || null,
                      tokenId: token.tokenId || null,
                      marketCap: token.marketCap || null,
                      volume: token.volume || null,
                      liquidity: token.liquidity || null,
                      isStock: false,
                    }
                    if (onSelectTokenAndOpen) onSelectTokenAndOpen(tokenData)
                    else if (selectToken) selectToken(tokenData)
                    closeSearch()
                  }}
                  onSelectStock={(stock) => {
                    const stockData = {
                      symbol: stock.symbol,
                      name: stock.name,
                      price: stock.price,
                      change: stock.change24h || stock.change,
                      logo: null,
                      exchange: stock.exchange,
                      sector: stock.sector,
                      marketCap: stock.marketCap,
                      volume: stock.volume,
                      isStock: true,
                      assetClass: 'stock',
                    }
                    if (onSelectTokenAndOpen) onSelectTokenAndOpen(stockData)
                    else if (selectToken) selectToken(stockData)
                    closeSearch()
                  }}
                />
              </div>
            ) : (
            <div className={`search-results-v2${fullView ? ' full-view-results' : ''}`}>
              <div className="search-section-header">
                <div className="section-label-v2">
                  {searchLoading || recentTokensLoading ? (
                    <>
                      <svg className="search-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" opacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </svg>
                      <span>{searchLoading ? (isContractSearch ? t('header.lookingUpContract', 'Looking up contract...') : t('common.searching')) : t('common.refreshing')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <span>
                        {searchQuery.trim().length >= 1
                          ? (marketMode === 'crypto' && cryptoSearchTooShort
                              ? t('header.typeNPlusChars', 'Type {{n}}+ characters', { n: cryptoSearchMinQueryLength })
                              : t('header.resultsCount', 'Results ({{n}})', { n: filteredTokens.length }))
                          : t('header.recentLive', 'Recent (Live)')
                        }
                      </span>
                    </>
                  )}
                </div>
                {!searchQuery.trim() && recentTokens.length > 0 && (
                  <button className="clear-btn-v2" onClick={clearHistory}>
                    {t('common.clear')}
                  </button>
                )}
              </div>

              <div className="search-tokens-list">
                {filteredTokens.length > 0 ? (
                  filteredTokens.map((token, index) => (
                    <div
                      key={`${token.symbol}-${token.ca || index}`}
                      className="token-card-v2"
                      {...(!token.isStock ? hoverIntent(() => {
                        if (!allowDataPrefetch()) return
                        prewarmResearchZone(token.symbol)
                        prefetchRoute('research-zone')
                      }) : {})}
                      onClick={() => {
                        addToHistory(token)
                        if (token.isStock) {
                          // Stock data
                          const stockData = {
                            symbol: token.symbol,
                            name: token.name,
                            price: token.price,
                            change: token.change,
                            logo: token.logo,
                            exchange: token.exchange,
                            sector: token.sector,
                            marketCap: token.marketCap,
                            volume: token.volume,
                            isStock: true,
                            assetClass: 'stock'
                          }
                          if (onSelectTokenAndOpen) {
                            onSelectTokenAndOpen(stockData)
                          } else if (selectToken) {
                            selectToken(stockData)
                          }
                        } else {
                          // Crypto token data
                          const tokenData = {
                            symbol: token.symbol,
                            name: token.name,
                            address: token.address ?? token.ca,
                            networkId: token.networkId || 1,
                            price: token.price,
                            change: token.change,
                            logo: token.logo,
                            cgId: token.cgId || null,
                            codexId: token.codexId || token.address || token.ca || null,
                            tokenId: token.tokenId || null,
                            marketCap: token.marketCap || null,
                            volume: token.volume || null,
                            liquidity: token.liquidity || null,
                            isStock: false
                          }
                          if (onSelectTokenAndOpen) {
                            onSelectTokenAndOpen(tokenData)
                          } else if (selectToken) {
                            selectToken(tokenData)
                          }
                        }
                        closeSearch()
                      }}
                    >
                      {/* Left highlight strip with heart (watchlist) - desktop only */}
                      {!isMobile && (
                        <div className="token-card-left-strip">
                          <button
                            className={`token-favorite-btn ${isInWatchlist && isInWatchlist(token.ca || token.symbol) ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              const tokenId = token.ca || token.symbol
                              if (isInWatchlist && isInWatchlist(tokenId)) {
                                removeFromWatchlist(tokenId)
                              } else {
                                addToWatchlist({
                                  symbol: token.symbol,
                                  name: token.name,
                                  price: token.price,
                                  change: token.change,
                                  marketCap: parseMcap(token.mcap),
                                  logo: token.logo,
                                  address: token.ca,
                                  networkId: token.networkId || 1,
                                  pinned: false,
                                  isStock: token.isStock || false,
                                  sector: token.sector,
                                  exchange: token.exchange,
                                  cgId: token.cgId || null,
                                  codexId: token.codexId || token.ca || null,
                                  tokenId: token.tokenId || null,
                                })
                              }
                            }}
                            title={isInWatchlist && isInWatchlist(token.ca || token.symbol) ? t('header.removeFromWatchlist', 'Remove from watchlist') : t('header.addToWatchlist', 'Add to watchlist')}
                            aria-label={isInWatchlist && isInWatchlist(token.ca || token.symbol) ? t('header.removeFromWatchlist', 'Remove from watchlist') : t('header.addToWatchlist', 'Add to watchlist')}
                          >
                            <svg viewBox="0 0 24 24" fill={isInWatchlist && isInWatchlist(token.ca || token.symbol) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                              <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                            </svg>
                          </button>
                        </div>
                      )}

                      {/* Token Logo — onError swaps to a styled letter span
                          so a stuck PWA cache (or any other broken response)
                          never renders as an empty / broken-image circle. */}
                      {token.logo ? (
                        <img
                          src={token.logo}
                          alt={token.symbol}
                          className="token-logo-v2"
                          onError={(e) => {
                            const parent = e.target.parentElement
                            e.target.remove()
                            if (parent) {
                              const span = document.createElement('span')
                              span.className = 'token-logo-v2 token-logo-v2--fallback'
                              span.textContent = (token.symbol || '?').charAt(0).toUpperCase()
                              parent.appendChild(span)
                            }
                          }}
                        />
                      ) : (
                        <span className="token-logo-v2 token-logo-v2--fallback">
                          {(token.symbol || '?').charAt(0).toUpperCase()}
                        </span>
                      )}

                      {/* Token Info */}
                      <div className="token-info-v2">
                        <div className="token-header-row">
                          <span className="token-symbol-v2">{token.symbol}</span>
                          {/* No badge at all when the asset has no chain label
                              (CG-only listings, older recents) — an
                              unconditional span rendered an empty gray pill.
                              networkId fallback covers rows that carry the id
                              but no display name. */}
                          {(() => {
                            const badge = token.isStock ? token.exchange : (token.network || chainToDisplayName(token.networkId))
                            return badge ? <span className="token-network-badge">{badge}</span> : null
                          })()}
                        </div>
                        <span className="token-name-v2">{token.name}</span>
                        {!isMobile && (token.isStock ? (
                          token.sector && (
                            <span className="token-address-v2">
                              {token.sector}
                            </span>
                          )
                        ) : (
                          token.ca && (
                            <span
                              className={`token-address-v2 network-${(token.network || '').toLowerCase()}`}
                              title={t('common.clickToCopy', 'Click to copy')}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigator.clipboard.writeText(token.ca)
                                triggerCopyToast()
                              }}
                            >
                              {token.ca.substring(0, 5)}...{token.ca.slice(-4)}
                            </span>
                          )
                        ))}
                      </div>

                      {/* Token Stats */}
                      <div className="token-stats-v2">
                        <div className="token-price-row">
                          <span className="token-price-v2">{token.price > 0 ? fmtPrice(token.price) : '—'}</span>
                          {token.price > 0 && (
                            <span className={`token-change-badge ${(token.change || 0) >= 0 ? 'positive' : 'negative'}`}>
                              {(token.change || 0) >= 0 ? (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 19V5M5 12l7-7 7 7" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 5v14M5 12l7 7 7-7" />
                                </svg>
                              )}
                              {/* Every source feeding token.change is already
                                  in percent form (CG price_change_percentage_24h,
                                  Codex change24, details-batch change24). The old
                                  `|change|>1 ? change : change*100` heuristic
                                  wrongly x100'd any real sub-1% move, so a true
                                  +0.65% rendered as +65%. Mirror the mobile
                                  normalizePct fix - just show the value. */}
                              {Math.abs(token.change || 0).toFixed(2)}%
                            </span>
                          )}
                        </div>
                        <div className="token-meta-row">
                          <span className="token-meta-item">MC {typeof token.mcap === 'string' ? token.mcap : (token.mcap != null ? fmtLarge(token.mcap) : 'N/A')}</span>
                          <span className="token-meta-sep" aria-hidden>·</span>
                          <span className="token-meta-item">Vol {typeof token.liquidity === 'string' ? token.liquidity : (token.liquidity != null ? fmtLarge(token.liquidity) : 'N/A')}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : searchLoading ? (
                  // A search still in flight is NOT "no results". The empty
                  // state below used to render underneath the "Looking up
                  // contract..." spinner, so every pasted address showed
                  // "No tokens found - token may not be indexed yet" for the
                  // ~1.5s the address lanes take, and users read that as a
                  // failure. Shimmer rows hold the shape until it settles.
                  <div className="search-skeleton-list" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <div className="search-skeleton-row" key={i}>
                        <div className="search-skeleton-logo animate-shimmer" />
                        <div className="search-skeleton-lines">
                          <div className="search-skeleton-line animate-shimmer" />
                          <div className="search-skeleton-line search-skeleton-line--sub animate-shimmer" />
                        </div>
                        <div className="search-skeleton-price animate-shimmer" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="search-empty-state">
                    {searchQuery.trim() ? (
                      <>
                        <div className="empty-icon-container">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                          </svg>
                        </div>
                        {marketMode === 'crypto' && cryptoSearchTooShort ? (
                          <>
                            <span className="empty-title">{t('header.keepTyping', 'Keep typing')}</span>
                            <span className="empty-hint">{t('header.typeAtLeast', 'Type at least {{n}} characters to search tokens', { n: cryptoSearchMinQueryLength })}</span>
                          </>
                        ) : (
                          <>
                            <span className="empty-title">{marketMode === 'stocks' ? t('welcome.noStocksFound') : t('welcome.noTokensFound')}</span>
                            {isContractSearch && (
                              <span className="empty-hint">{t('welcome.tokenNotIndexed')}</span>
                            )}
                            {/* Backend errors are logged to console — never surfaced as red text in the search dropdown. Users only need to know whether results exist. */}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="empty-icon-container">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                          </svg>
                        </div>
                        <span className="empty-title">{t('welcome.noRecentSearches')}</span>
                        <span className="empty-hint">{marketMode === 'stocks' ? t('header.searchStocksHint', 'Search for stocks to get started') : t('header.searchTokensHint', 'Search for tokens to get started')}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            )}
            </>
            )}
          </div>
        </div>,
        document.body
      )}
    </header>
    </>
  )
}

export default memo(Header)
