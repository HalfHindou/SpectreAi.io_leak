/**
 * GM full-screen zen dashboard: greeting, time/date, weather, market pulse,
 * top 5 crypto, top 5 stocks, personal watchlist, fear & greed, top 5 news,
 * daily thought. Every section is user-toggleable (Customize panel) so the
 * zen surface stays uncluttered. Glass style, rotating backgrounds.
 * Close via X or Escape.
 */
import React, { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { getMajorTokenPrices } from '@/services/coinGeckoApi'
import { getTopCoinPrices } from '@/services/binanceApi'
import { getStockQuotes } from '@/services/stockApi'
import { getSpectrePricesBySymbols, getSpectreAltSeason } from '@/services/spectreMarketApi'
import { getFearGreedCurrent, getGlobalMetrics } from '@/services/fearGreedApi'
import { useCurrency } from '@/hooks/useCurrency'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getCryptoNews } from '@/services/cryptoNewsApi'
import { IS_SHOWCASE_EMBED } from '@/lib/embed-mode'
import useSettingsStore, { DEFAULT_GM_WIDGETS } from '@/store/useSettingsStore'
import { ALL_PHOTO_SCENES, bgUrl as themeSceneUrl, isBrightBg } from '@/pages/lite/components/lite-backdrops'
import { resolveThemeBackdrop, mixPhotoPool } from '@/components/pro-theme/pro-theme-studio'
import { THEME_STUDIO_EVENT } from '@/lib/theme-studio'
import './gm-dashboard.css'
import './gm-dashboard.mobile.css'

// Isolated clock component - prevents full dashboard re-render every second
const GMClock = memo(({ name, weather, weatherLoading }) => {
  const { t } = useTranslation()
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    // The display only shows hour:minute - returning the previous Date when
    // the minute hasn't changed skips the re-render (and the every-second
    // repaint of the greeting block over the animated photo).
    const timer = setInterval(() => {
      setTime((prev) => {
        const next = new Date()
        return next.getMinutes() === prev.getMinutes() && next.getHours() === prev.getHours() ? prev : next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const hour = time.getHours()
  const n = (name || '').trim() || 'there'
  let greeting
  if (hour >= 5 && hour < 12) greeting = t('gmDashboard.goodMorning', { name: n })
  else if (hour >= 12 && hour < 17) greeting = t('gmDashboard.goodAfternoon', { name: n })
  else if (hour >= 17 && hour < 22) greeting = t('gmDashboard.goodEvening', { name: n })
  else greeting = t('gmDashboard.goodNight', { name: n })

  const timeStr = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const dateStr = time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <>
      <h1 className="gm-dashboard-greeting">{greeting}</h1>
      <div className="gm-dashboard-info-row">
        <div className="gm-dashboard-glass gm-dashboard-info-pill">
          <span className="gm-dashboard-info-label">{timeStr}</span>
        </div>
        <div className="gm-dashboard-glass gm-dashboard-info-pill">
          <span className="gm-dashboard-info-label">{dateStr}</span>
        </div>
        <div className="gm-dashboard-glass gm-dashboard-info-pill gm-dashboard-weather-pill">
          {weatherLoading ? (
            <span className="gm-dashboard-info-label" style={{ opacity: 0.6 }}>Loading…</span>
          ) : weather ? (
            <span className="gm-dashboard-info-label">{weather.location} · {weather.temp}°C</span>
          ) : (
            // 2026-05-26 beta-quality fix: removed "New York · 10°C" fake
            // fallback that lied to non-NYC users when weather/IP geo failed.
            <span className="gm-dashboard-info-label" style={{ opacity: 0.5 }}>—</span>
          )}
        </div>
      </div>
    </>
  )
})

const TOP_CRYPTO = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']
const TOP_STOCKS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta' },
]
const TOP_STOCK_SYMBOLS = TOP_STOCKS.map((s) => s.symbol)

// `time.ago` in the locale files is a NESTED object (time.ago.minutes etc.) -
// calling t('time.ago') returns the object and i18next prints its "returned an
// object instead of string" error INTO the UI. Use the leaf keys, and guard
// with a string check so a locale regression can never leak into the meta line.
function formatTimeAgo(publishedOn, t) {
  if (!publishedOn) return ''
  const sec = Math.floor(Date.now() / 1000) - (typeof publishedOn === 'number' ? publishedOn : parseInt(publishedOn, 10))
  const tr = (key, count, fallback) => {
    if (!t) return fallback
    const out = t(key, { count, defaultValue: fallback })
    return typeof out === 'string' ? out : fallback
  }
  if (sec < 60) return tr('time.ago.justNow', 0, 'just now')
  if (sec < 3600) { const m = Math.floor(sec / 60); return tr('time.ago.minutes', m, `${m}m ago`) }
  if (sec < 86400) { const h = Math.floor(sec / 3600); return tr('time.ago.hours', h, `${h}h ago`) }
  const d = Math.floor(sec / 86400)
  return tr('time.ago.days', d, `${d}d ago`)
}

// One line of calm above the footer. Editorial aphorisms - English only,
// rotated by day of year so everyone sees the same thought all day.
const DAILY_THOUGHTS = [
  'Time in the market beats timing the market.',
  'When in doubt, zoom out.',
  'Patience is the rarest edge.',
  'Plan the trade. Trade the plan.',
  'The market transfers money from the impatient to the patient.',
  'Never confuse a bull market with brains.',
  'Small losses are the cost of staying in the game.',
  'Price is what you pay. Value is what you get.',
  'Protect the downside; the upside takes care of itself.',
  'Volatility is the price of admission.',
  'The trend is your friend, until it ends.',
  'Risk comes from not knowing what you are doing.',
  'Strong opinions, loosely held.',
  'The best position is often no position.',
]

function getDailyThought() {
  const nowDate = new Date()
  const start = new Date(nowDate.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((nowDate - start) / 86400000)
  return DAILY_THOUGHTS[dayOfYear % DAILY_THOUGHTS.length]
}

// Fear & Greed zone color (matches the app's bull/bear semantics, softened
// for the glass surface).
function fearGreedColor(value) {
  if (value == null) return 'rgba(255,255,255,0.7)'
  if (value < 25) return '#fca5a5'
  if (value < 45) return '#fcd34d'
  if (value < 55) return 'rgba(255,255,255,0.85)'
  if (value < 75) return '#86efac'
  return '#4ade80'
}

// Alt Season Index color: low = BTC season (amber), high = alt season (green).
function altSeasonColor(value) {
  if (value == null) return 'rgba(255,255,255,0.7)'
  if (value < 25) return '#fbbf24'
  if (value < 55) return '#fcd34d'
  if (value < 75) return '#a3e635'
  return '#4ade80'
}

// Ambient track served from /public/audio. HTML5 audio (not Web Audio) so it
// honors iOS Safari's user-gesture autoplay rule via the click on the toggle.
const AMBIENT_TRACK = '/audio/magnific-kulfi.mp3'
const AMBIENT_VOLUME = 0.45
const AMBIENT_FADE_MS = 800

// Linear volume ramp on an <audio> element. Returns the timer id so callers
// can clear it if they need to chain another fade.
function fadeAudio(el, target, ms, prevTimerRef) {
  if (prevTimerRef.current) { clearInterval(prevTimerRef.current); prevTimerRef.current = null }
  const steps = 24
  const stepMs = Math.max(8, ms / steps)
  const from = el.volume
  let i = 0
  prevTimerRef.current = setInterval(() => {
    i += 1
    const v = Math.min(1, Math.max(0, from + (target - from) * (i / steps)))
    try { el.volume = v } catch (_) { /* noop */ }
    if (i >= steps) { clearInterval(prevTimerRef.current); prevTimerRef.current = null }
  }, stepMs)
}

// GM used to carry five hardcoded Unsplash ids of its own, unrelated to the
// theme catalog the rest of the app dresses in. These stay only as the rotation
// SEED — the pool below is the real catalog.
const BG_PHOTO_IDS = [
  'photo-1464822759023-fed622ff2c3b',
  'photo-1507525428034-b723cf961d3e',
  'photo-1506905925346-21bda4d32df4',
  'photo-1519046904884-53103b34b206',
  'photo-1519681393784-d120267933ba',
]

// How many scenes a rotating session cycles through. The catalog is ~40 photo
// scenes; loading all of them to cross-fade five would be absurd, so a session
// draws a handful and rotates those. A different draw each visit is the point —
// the screen shouldn't look identical every morning.
const ROTATE_POOL_SIZE = 6

function rotationPool() {
  const scenes = ALL_PHOTO_SCENES.filter((s) => s.photo)
  if (scenes.length === 0) return BG_PHOTO_IDS
  // Deterministic per calendar day + a session salt: everyone's Tuesday differs
  // from their Monday, and two tabs opened together agree.
  const pool = [...scenes]
  const day = Math.floor(Date.now() / 86_400_000)
  let seed = day * 2654435761 % 2147483647
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, ROTATE_POOL_SIZE).map((s) => s.photo)
}

// Responsive width: phones 600w (~120KB), tablets 1280w, desktop 1920w.
// Cuts mobile payload by ~70% vs hardcoded 1920w.
function bgUrl(id, viewportWidth) {
  const w = viewportWidth <= 768 ? 600 : viewportWidth <= 1280 ? 1280 : 1920
  return `https://images.unsplash.com/${id}?w=${w}&q=75&auto=format&fit=crop`
}

function getViewportWidth() {
  if (typeof window === 'undefined') return 1920
  return window.innerWidth || 1920
}
const DEFAULT_WEATHER = { location: 'New York', temp: 10, high: 12, low: 8, code: 0 }

// localStorage instant-paint for weather: render last result immediately on
// mount, refetch in the background. Avoids a 1-2s geolocation+API block before
// the weather pill paints. 6h TTL.
const WEATHER_LS_KEY = 'gm-weather-cache'
const WEATHER_LS_TTL = 6 * 60 * 60 * 1000

function readCachedWeather() {
  try {
    const raw = localStorage.getItem(WEATHER_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number' || !parsed.data) return null
    if (Date.now() - parsed.ts > WEATHER_LS_TTL) return null
    return parsed.data
  } catch (_) { return null }
}

function writeCachedWeather(data) {
  try {
    localStorage.setItem(WEATHER_LS_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch (_) { /* quota / private mode - ignore */ }
}

function GMDashboard({ profile, onClose, gmWidgets, setGmWidget, gmSound = true, setGmSound, watchlistTokens }) {
  const { t } = useTranslation()
  const { fmtPrice, fmtLargeShort } = useCurrency()
  // Merge over defaults so a persisted object from before a new widget key
  // existed still renders the new widget with its default visibility.
  const widgets = useMemo(() => ({ ...DEFAULT_GM_WIDGETS, ...(gmWidgets || {}) }), [gmWidgets])
  const [customizeOpen, setCustomizeOpen] = useState(false)
  // Time state moved to GMClock component to prevent full dashboard re-renders
  // Seed weather from localStorage (6h TTL) so the pill paints instantly; the
  // effect below still refetches fresh data in the background.
  const [weather, setWeather] = useState(() => readCachedWeather() || { ...DEFAULT_WEATHER })
  const [weatherLoading, setWeatherLoading] = useState(() => !readCachedWeather())
  const [news, setNews] = useState([])
  const [stockPrices, setStockPrices] = useState({})
  const [bgIndex, setBgIndex] = useState(0)
  const [vw] = useState(getViewportWidth)
  // ── Backdrop ────────────────────────────────────────────────────────────
  // Three sources, one setting. 'theme' dresses GM in whatever the app theme is
  // wearing (so the Theme Studio reaches this screen too) and falls back to
  // rotating when no theme is on — which is exactly what GM did before. The
  // theme can also hand back a CSS backdrop (gradient/mesh/solid/paper), not
  // just a photo, so the layer below renders either.
  const gmBg = useSettingsStore((st) => st.gmBg) || { mode: 'theme', scene: null }
  const setGmBg = useSettingsStore((st) => st.setGmBg)
  const gmBgPaused = useSettingsStore((st) => st.gmBgPaused)
  const setGmBgPaused = useSettingsStore((st) => st.setGmBgPaused)
  const proThemeLook = useSettingsStore((st) => st.proThemeLook)
  const proThemeBg = useSettingsStore((st) => st.proThemeBg)
  const proThemePaper = useSettingsStore((st) => st.proThemePaper)

  const backdrop = React.useMemo(() => {
    const themed = proThemeLook && proThemeLook !== 'off'
    if (gmBg.mode === 'scene' && gmBg.scene) {
      const sc = ALL_PHOTO_SCENES.find((x) => x.id === gmBg.scene)
      if (sc?.photo) return { urls: [themeSceneUrl(sc.photo, vw)], css: null, bright: false }
    }
    if (gmBg.mode === 'theme' && themed) {
      // "Daily mix" is a MIX. It resolves to a single time-of-day photo because
      // LITE has one still layer to put it on — GM has a cross-fader, so it
      // takes the whole pool and drifts it. Pinning the one slice here is what
      // made Daily mix look static (and hid the Pause button, which only
      // appears when there is a rotation to pause).
      if (proThemeBg?.mode === 'mix') {
        return { urls: mixPhotoPool().map((id) => bgUrl(id, vw)), css: null, bright: false }
      }
      const t = resolveThemeBackdrop(proThemeLook, proThemeBg, proThemePaper)
      // A light theme (Paper, Frost, the white solids) needs the scrim
      // INVERTED — GM's dark wash turns a bright canvas to mud, and the app
      // has already flipped its type to near-black by then.
      const bright = proThemeLook === 'paper' || isBrightBg(proThemeBg)
      if (t?.photo) return { urls: [t.photo], css: null, bright }
      if (t?.css) return { urls: [], css: t.css, bright }
    }
    // 'rotate', or 'theme' with no theme on.
    return { urls: rotationPool().map((id) => bgUrl(id, vw)), css: null, bright: false }
  }, [gmBg.mode, gmBg.scene, proThemeLook, proThemeBg, proThemePaper, vw])

  const bgUrls = backdrop.urls
  const bgCss = backdrop.css
  const bgBright = backdrop.bright
  const [soundOn, setSoundOn] = useState(false)
  const audioRef = React.useRef(null)
  const fadeIntervalRef = React.useRef(null)
  // Seeded from the persisted preference (default ON for a first visit). When
  // the user has muted before, this starts true so neither the mount unmute
  // nor the first-gesture recovery listener ever turns the track back on.
  const userMutedRef = React.useRef(!gmSound)
  const cleanupListenersRef = React.useRef(null)

  const [cryptoPrices, setCryptoPrices] = useState({})
  const name = profile?.name || 'there'

  // Time interval moved to GMClock component

  const fetchCrypto = useCallback(async () => {
    // Binance + CoinGecko merge (Binance wins on price). Falls back to CoinGecko-only if Binance fails.
    try {
      const map = await getTopCoinPrices(TOP_CRYPTO)
      if (map && typeof map === 'object' && Object.keys(map).length > 0) {
        setCryptoPrices(map)
        return
      }
    } catch (_) { console.error(_) }
    try {
      const map = await getMajorTokenPrices(TOP_CRYPTO)
      if (map && typeof map === 'object') setCryptoPrices(map)
    } catch (_) { console.error(_) }
  }, [])

  useEffect(() => { fetchCrypto() }, [fetchCrypto])

  useAdaptivePolling(fetchCrypto, { interval: 45_000 })

  // Defer non-first bg images to idle so they don't compete with the LCP
  // <img> below. The first image is fetched via the visible <img> with
  // fetchpriority="high" - browsers honor that on <img> but not reliably
  // on CSS background-image, which is why we ditched the bg-image approach.
  useEffect(() => {
    const rest = bgUrls.slice(1)
    if (rest.length === 0) return
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500))
    const cancel = window.cancelIdleCallback || clearTimeout
    const handle = schedule(() => { rest.forEach((src) => { const img = new Image(); img.src = src }) })
    return () => { try { cancel(handle) } catch (_) { /* noop */ } }
  }, [bgUrls])

  // Muted-autoplay-then-unmute pattern. Muted autoplay is allowed by EVERY
  // browser without a user gesture, so we start playback silently on mount,
  // then unmute either (a) immediately if the browser allows it, or (b) on
  // the first user interaction (capture-phase listener so toggle-button taps
  // still go through afterwards).
  useEffect(() => {
    let disposed = false
    const el = new Audio()
    el.src = AMBIENT_TRACK
    el.loop = true
    el.preload = 'auto'
    el.muted = true
    el.volume = AMBIENT_VOLUME
    // iOS Safari needs this for inline playback (no fullscreen video chrome).
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', '')
    audioRef.current = el

    // Start muted - allowed everywhere.
    const p = el.play()
    if (p && typeof p.catch === 'function') {
      p.catch((e) => console.error('Muted autoplay failed:', e))
    }

    const unmute = () => {
      if (disposed || userMutedRef.current) return
      try {
        el.muted = false
        // Some browsers reset volume on unmute - reassert and fade.
        el.volume = 0
        // If the element somehow got paused, kick it back on.
        if (el.paused) { const pp = el.play(); if (pp && pp.catch) pp.catch(() => {}) }
        fadeAudio(el, AMBIENT_VOLUME, AMBIENT_FADE_MS, fadeIntervalRef)
        setSoundOn(true)
      } catch (e) {
        console.error('Unmute failed:', e)
      }
    }

    // Attempt immediate unmute (works on desktop Chrome/Firefox with media
    // engagement; harmless if it doesn't).
    unmute()

    // Recovery: if still muted after a tick, wait for first user gesture.
    const checkAndArm = () => {
      if (disposed) return
      if (!el.muted) return
      // Remembered "sound off": don't wait for a gesture to unmute either.
      if (userMutedRef.current) return
      const handler = (ev) => {
        // Skip if user explicitly hit the mute toggle - the toggle's onClick
        // will handle it. We only want unhandled interactions.
        if (ev.target?.closest?.('.gm-dashboard-sound-toggle')) return
        document.removeEventListener('pointerdown', handler, true)
        document.removeEventListener('keydown', handler, true)
        document.removeEventListener('touchstart', handler, true)
        unmute()
      }
      document.addEventListener('pointerdown', handler, true)
      document.addEventListener('keydown', handler, true)
      document.addEventListener('touchstart', handler, true)
      cleanupListenersRef.current = () => {
        document.removeEventListener('pointerdown', handler, true)
        document.removeEventListener('keydown', handler, true)
        document.removeEventListener('touchstart', handler, true)
      }
    }
    // requestAnimationFrame so the immediate unmute has a chance to flip
    // el.muted to false before we decide to arm the recovery listener.
    const armId = requestAnimationFrame(checkAndArm)

    return () => {
      disposed = true
      cancelAnimationFrame(armId)
      if (cleanupListenersRef.current) { cleanupListenersRef.current(); cleanupListenersRef.current = null }
      if (fadeIntervalRef.current) { clearInterval(fadeIntervalRef.current); fadeIntervalRef.current = null }
      try { el.pause() } catch (_) { /* noop */ }
      try { el.src = '' } catch (_) { /* noop */ }
      audioRef.current = null
    }
  }, [])

  // A pinned scene or a themed backdrop is ONE layer — nothing to cross-fade,
  // so the timer doesn't run at all rather than ticking against a length of 1.
  useEffect(() => {
    if (bgUrls.length < 2 || gmBgPaused) {
      // Pausing holds the CURRENT photo — resetting to 0 here would snap the
      // scene out from under the person who just asked it to stop.
      if (bgUrls.length < 2) setBgIndex(0)
      return undefined
    }
    const cycle = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setBgIndex((i) => (i + 1) % bgUrls.length)
    }, 12000)
    return () => clearInterval(cycle)
  }, [bgUrls.length, gmBgPaused])

  useEffect(() => {
    // Showcase iframe (gm-dashboard is an open demo surface): geolocation is
    // blocked by the embedder's Permissions-Policy (console violation) and
    // /api/geo would burn its rate limit - render the default weather.
    if (IS_SHOWCASE_EMBED) {
      setWeather({ ...DEFAULT_WEATHER })
      setWeatherLoading(false)
      return
    }
    let cancelled = false
    const defaultCoords = { lat: 40.71, lon: -74.01 }
    const applyWeather = (data, locationName, persist = false) => {
      if (cancelled) return
      const next = {
        location: locationName || data?.location || '-',
        temp: Math.round(data?.temp ?? 0),
        high: Math.round(data?.high ?? 0),
        low: Math.round(data?.low ?? 0),
        code: data?.code ?? 0,
      }
      setWeather(next)
      // Only persist real server results, not the default placeholder.
      if (persist) writeCachedWeather(next)
    }
    const stopLoading = () => {
      if (!cancelled) setWeatherLoading(false)
    }
    const fetchWeatherFromServer = (lat, lon) => {
      fetch(`/api/weather?lat=${lat}&lon=${lon}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (cancelled) return
          if (data) applyWeather(data, data.location, true)
          else applyWeather({ ...DEFAULT_WEATHER }, DEFAULT_WEATHER.location)
        })
        .catch(() => applyWeather({ ...DEFAULT_WEATHER }, DEFAULT_WEATHER.location))
        .finally(stopLoading)
    }
    // IP-based geolocation fallback — detects real location when browser geolocation is denied
    const fallbackToIpGeo = () => {
      fetch('/api/geo', { signal: AbortSignal.timeout(5000) })
        .then((r) => r.ok ? r.json() : null)
        .then((geo) => {
          if (cancelled) return
          if (geo?.latitude && geo?.longitude) {
            fetchWeatherFromServer(geo.latitude, geo.longitude)
          } else {
            fetchWeatherFromServer(defaultCoords.lat, defaultCoords.lon)
          }
        })
        .catch(() => fetchWeatherFromServer(defaultCoords.lat, defaultCoords.lon))
    }
    const timeoutId = setTimeout(() => {
      if (cancelled) return
      setWeatherLoading(false)
      setWeather((w) => w ?? { ...DEFAULT_WEATHER })
    }, 12000)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => fetchWeatherFromServer(p.coords.latitude, p.coords.longitude),
        () => fallbackToIpGeo(),
        { timeout: 6000, maximumAge: 300000 }
      )
    } else {
      fallbackToIpGeo()
    }
    return () => { cancelled = true; clearTimeout(timeoutId) }
  }, [])

  const fetchNews = useCallback(async () => {
    const parseItems = (raw) =>
      raw.slice(0, 8).map((item) => ({
        id: String(item.id ?? item.guid ?? Math.random()),
        title: item.title || '',
        url: item.url || item.guid || '#',
        source: (item.source_info && item.source_info.name) || item.source || 'Crypto',
        publishedOn: item.published_on ?? item.publishedOn ?? 0,
      }))
    try {
      const raw = await getCryptoNews(null, 8)
      if (raw.length > 0) setNews(parseItems(raw))
    } catch (_) { console.error(_) }
  }, [])

  useEffect(() => { fetchNews() }, [fetchNews])

  // Poll above the 3-min cryptoNewsApi cache TTL so each tick hits the cache
  // (was 2min < 3min TTL, which forced a network refetch on every poll).
  useAdaptivePolling(fetchNews, { interval: 3.5 * 60 * 1000 })

  const fetchStocks = useCallback(async () => {
    try {
      const quotes = await getStockQuotes(TOP_STOCK_SYMBOLS)
      if (quotes && typeof quotes === 'object' && Object.keys(quotes).length > 0) {
        setStockPrices(quotes)
      }
    } catch (_) { console.error(_) }
  }, [])

  useEffect(() => { fetchStocks() }, [fetchStocks])

  useAdaptivePolling(fetchStocks, { interval: 60_000 })

  // ── Watchlist prices ──
  // Pinned tokens first, capped at 6 rows so the card stays a zen block, not a
  // table. Crypto symbols resolve via the Spectre price map, stock entries via
  // the shared (cached + deduped) stock-quote service.
  const watchlistEntries = useMemo(() => {
    const list = Array.isArray(watchlistTokens) ? watchlistTokens : []
    return [...list]
      .sort((a, b) => (b?.pinned === true ? 1 : 0) - (a?.pinned === true ? 1 : 0))
      .slice(0, 6)
  }, [watchlistTokens])

  const isStockToken = (tk) => tk?.isStock === true || tk?.assetClass === 'stock'
  const wlCryptoKey = watchlistEntries.filter((tk) => !isStockToken(tk)).map((tk) => (tk.symbol || '').toUpperCase()).filter(Boolean).join(',')
  const wlStockKey = watchlistEntries.filter(isStockToken).map((tk) => (tk.symbol || '').toUpperCase()).filter(Boolean).join(',')

  const [watchlistPrices, setWatchlistPrices] = useState({})

  const fetchWatchlistPrices = useCallback(async () => {
    if (!widgets.watchlist) return
    const cryptoSyms = wlCryptoKey ? wlCryptoKey.split(',') : []
    const stockSyms = wlStockKey ? wlStockKey.split(',') : []
    if (cryptoSyms.length === 0 && stockSyms.length === 0) return
    const [cryptoRes, stockRes] = await Promise.allSettled([
      cryptoSyms.length ? getSpectrePricesBySymbols(cryptoSyms) : Promise.resolve({}),
      stockSyms.length ? getStockQuotes(stockSyms) : Promise.resolve({}),
    ])
    const next = {}
    if (cryptoRes.status === 'fulfilled' && cryptoRes.value) {
      for (const [sym, row] of Object.entries(cryptoRes.value)) {
        if (row?.price != null) next[sym] = { price: row.price, change: row.change24 ?? row.change ?? 0, marketCap: row.marketCap ?? null }
      }
    }
    if (stockRes.status === 'fulfilled' && stockRes.value) {
      for (const [sym, row] of Object.entries(stockRes.value)) {
        if (row?.price != null) next[String(sym).toUpperCase()] = { price: row.price, change: row.change ?? 0, marketCap: row.marketCap ?? null }
      }
    }
    if (Object.keys(next).length > 0) {
      setWatchlistPrices((prev) => ({ ...prev, ...next }))
    }
  }, [widgets.watchlist, wlCryptoKey, wlStockKey])

  useEffect(() => { fetchWatchlistPrices() }, [fetchWatchlistPrices])

  useAdaptivePolling(fetchWatchlistPrices, { interval: 60_000 })

  // ── Fear & Greed + Alt Season (slow-moving - one fetch per enable, services cache) ──
  const [fearGreed, setFearGreed] = useState(null)
  const [altSeason, setAltSeason] = useState(null)
  useEffect(() => {
    if (!widgets.fearGreed) return
    let cancelled = false
    getFearGreedCurrent()
      .then((data) => { if (!cancelled && data) setFearGreed(data) })
      .catch(() => {})
    getSpectreAltSeason()
      .then((data) => { if (!cancelled && data) setAltSeason(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [widgets.fearGreed])

  // ── Market pulse (global mcap / BTC dominance / 24h volume) ──
  const [pulse, setPulse] = useState(null)
  useEffect(() => {
    if (!widgets.pulse) return
    let cancelled = false
    getGlobalMetrics()
      .then((data) => { if (!cancelled && data) setPulse(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [widgets.pulse])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.()
    },
    [onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const btcPriceRaw = cryptoPrices?.BTC?.price
  const btcPriceStr = btcPriceRaw != null && !Number.isNaN(Number(btcPriceRaw)) ? fmtPrice(btcPriceRaw) : null
  const liveHeadline = btcPriceStr
    ? { id: 'live-btc', title: `Bitcoin at ${btcPriceStr}`, url: '#', source: 'Live', publishedOn: Math.floor(Date.now() / 1000) }
    : null
  const newsToShow = liveHeadline
    ? [liveHeadline, ...news.slice(0, 4)]
    : news.slice(0, 5)

  const toggleSound = useCallback(async () => {
    const el = audioRef.current
    if (!el) return
    if (soundOn) {
      // User-initiated mute - remember so the recovery listener won't unmute,
      // and persist the choice (localStorage + account sync).
      userMutedRef.current = true
      setGmSound?.(false)
      fadeAudio(el, 0, AMBIENT_FADE_MS, fadeIntervalRef)
      setTimeout(() => {
        try { el.muted = true } catch (_) { /* noop */ }
      }, AMBIENT_FADE_MS + 50)
      setSoundOn(false)
      return
    }
    userMutedRef.current = false
    setGmSound?.(true)
    try {
      el.muted = false
      el.volume = 0
      if (el.paused) { const p = el.play(); if (p && p.catch) await p.catch(() => {}) }
      fadeAudio(el, AMBIENT_VOLUME, AMBIENT_FADE_MS, fadeIntervalRef)
      setSoundOn(true)
    } catch (e) {
      console.error('Ambient unmute failed:', e)
    }
  }, [soundOn, setGmSound])

  const content = (
    <div className={`gm-dashboard${bgBright ? ' gm-dashboard--bright' : ''}`} role="dialog" aria-modal="true" aria-label={t('gmDashboard.title', 'GM Dashboard')}>
      <div className="gm-dashboard-bg-base" aria-hidden />
      <div className="gm-dashboard-bg-wrap">
        {bgCss && <div className="gm-dashboard-bg gm-dashboard-bg-css" style={{ background: bgCss, opacity: 1 }} aria-hidden />}
        {bgUrls.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            className={`gm-dashboard-bg gm-dashboard-bg-${i}`}
            aria-hidden
            fetchpriority={i === 0 ? 'high' : 'low'}
            decoding="async"
            loading="eager"
            style={{ opacity: i === bgIndex ? 1 : 0 }}
          />
        ))}
      </div>
      <div className="gm-dashboard-scrim" aria-hidden />

      <div className="gm-dashboard-top-actions gm-dashboard-glass">
        <button
          type="button"
          className="gm-dashboard-close gm-dashboard-escape-btn"
          onClick={onClose}
          aria-label={t('gmDashboard.closeDashboard')}
          title={t('gmDashboard.escKey')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <span className="gm-dashboard-btn-label">{t('common.esc', 'Esc')}</span>
        </button>
        <button
          type="button"
          className="gm-dashboard-sound-toggle"
          onClick={toggleSound}
          aria-label={soundOn ? t('gmDashboard.soundOff') : t('gmDashboard.soundOn')}
          title={soundOn ? t('gmDashboard.soundOff') : t('gmDashboard.soundOn')}
        >
          {soundOn ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
          <span className="gm-dashboard-btn-label">{soundOn ? t('gmDashboard.soundOn') : t('gmDashboard.soundOff')}</span>
        </button>
        {/* Only offered when a rotation is actually running — a pinned scene
            or a themed backdrop is a single still layer, and a Pause button
            over a still image is a control that does nothing. */}
        {bgUrls.length > 1 && (
          <button
            type="button"
            className="gm-dashboard-bgpause-toggle"
            onClick={() => setGmBgPaused?.(!gmBgPaused)}
            aria-pressed={!!gmBgPaused}
            aria-label={gmBgPaused ? t('gmDashboard.bgResumeAria', 'Resume the background rotation') : t('gmDashboard.bgPauseAria', 'Pause the background rotation')}
            title={gmBgPaused ? t('gmDashboard.bgResumeAria', 'Resume the background rotation') : t('gmDashboard.bgPauseAria', 'Pause the background rotation')}
          >
            {gmBgPaused ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="9" y1="4" x2="9" y2="20" /><line x1="15" y1="4" x2="15" y2="20" />
              </svg>
            )}
            <span className="gm-dashboard-btn-label">
              {gmBgPaused ? t('gmDashboard.bgResume', 'Resume') : t('gmDashboard.bgPause', 'Pause')}
            </span>
          </button>
        )}
        <button
          type="button"
          className="gm-dashboard-customize-toggle"
          onClick={() => setCustomizeOpen((v) => !v)}
          aria-expanded={customizeOpen}
          aria-label={t('gmDashboard.customize', 'Customize')}
          title={t('gmDashboard.customize', 'Customize')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          <span className="gm-dashboard-btn-label">{t('gmDashboard.edit', 'Edit')}</span>
        </button>

        {customizeOpen && (
          <div className="gm-dashboard-customize gm-dashboard-glass" role="group" aria-label={t('gmDashboard.customizeTitle', 'Dashboard sections')}>
            <div className="gm-dashboard-customize-head">{t('gmDashboard.customizeTitle', 'Dashboard sections')}</div>
            {[
              { key: 'watchlist', label: t('gmDashboard.myWatchlist', 'My Watchlist') },
              { key: 'crypto', label: t('gmDashboard.top5Crypto') },
              { key: 'stocks', label: t('gmDashboard.top5Stocks') },
              { key: 'fearGreed', label: t('gmDashboard.fearGreed', 'Fear & Greed') },
              { key: 'pulse', label: t('gmDashboard.marketPulse', 'Market Pulse') },
              { key: 'news', label: t('gmDashboard.top5News') },
              { key: 'quote', label: t('gmDashboard.dailyThought', 'Daily Thought') },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className="gm-dashboard-customize-row"
                role="switch"
                aria-checked={widgets[key]}
                onClick={() => setGmWidget?.(key, !widgets[key])}
              >
                <span className="gm-dashboard-customize-label">{label}</span>
                <span className={`gm-dashboard-switch${widgets[key] ? ' on' : ''}`} aria-hidden>
                  <span className="gm-dashboard-switch-knob" />
                </span>
              </button>
            ))}

            {/* ── Backdrop ────────────────────────────────────────────────
                Follow the app theme, rotate the catalog, or pin one scene. */}
            <div className="gm-dashboard-customize-head gm-dashboard-customize-head--sub">
              {t('gmDashboard.backdrop', 'Backdrop')}
            </div>
            <div className="gm-dashboard-bgmodes" role="group" aria-label={t('gmDashboard.backdrop', 'Backdrop')}>
              {[
                { mode: 'theme', label: t('gmDashboard.bgTheme', 'Theme') },
                { mode: 'rotate', label: t('gmDashboard.bgRotate', 'Rotate') },
                { mode: 'scene', label: t('gmDashboard.bgPick', 'Pick') },
              ].map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  className={`gm-dashboard-bgmode${gmBg.mode === mode ? ' is-active' : ''}`}
                  aria-pressed={gmBg.mode === mode}
                  onClick={() => setGmBg?.({ mode, scene: mode === 'scene' ? (gmBg.scene || ALL_PHOTO_SCENES[0]?.id) : null })}
                >
                  {label}
                </button>
              ))}
            </div>

            {gmBg.mode === 'theme' && (
              <button
                type="button"
                className="gm-dashboard-bg-studio"
                onClick={() => { try { window.dispatchEvent(new CustomEvent(THEME_STUDIO_EVENT)) } catch (_) { /* noop */ } }}
              >
                {t('gmDashboard.openThemes', 'Open Themes')}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            )}

            {gmBg.mode === 'scene' && (
              <div className="gm-dashboard-scenes" role="listbox" aria-label={t('gmDashboard.bgPick', 'Pick')}>
                {ALL_PHOTO_SCENES.filter((sc) => sc.photo).map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    role="option"
                    aria-selected={gmBg.scene === sc.id}
                    title={sc.name}
                    className={`gm-dashboard-scene${gmBg.scene === sc.id ? ' is-active' : ''}`}
                    style={{ backgroundImage: `url(${themeSceneUrl(sc.photo, 320)})` }}
                    onClick={() => setGmBg?.({ mode: 'scene', scene: sc.id })}
                  >
                    <span className="gm-dashboard-scene-name">{sc.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="gm-dashboard-inner">
        {/* GMClock renders greeting + time/date/weather info row */}
        <GMClock name={name} weather={weather} weatherLoading={weatherLoading} />

        {/* Row container mounts with the widget (reserved height in CSS) so the
            pills FADE in when data lands instead of shoving the cards down -
            the pop was the page's biggest layout shift (0.137 CLS measured). */}
        {widgets.pulse && (
          <div className="gm-dashboard-info-row gm-dashboard-pulse-row">
            {pulse?.totalMarketCap > 0 && (
              <div className="gm-dashboard-glass gm-dashboard-info-pill gm-dashboard-fade">
                <span className="gm-dashboard-pulse-label">{t('gmDashboard.pulseMcap', 'MCap')}</span>
                <span className="gm-dashboard-info-label">{fmtLargeShort(pulse.totalMarketCap)}</span>
                {Number.isFinite(pulse.marketCapChange24h) && pulse.marketCapChange24h !== 0 && (
                  <span className={`gm-dashboard-change ${pulse.marketCapChange24h >= 0 ? 'up' : 'down'}`}>
                    {pulse.marketCapChange24h >= 0 ? '+' : ''}{pulse.marketCapChange24h.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
            {pulse?.btcDominance > 0 && (
              <div className="gm-dashboard-glass gm-dashboard-info-pill gm-dashboard-fade">
                <span className="gm-dashboard-pulse-label">{t('gmDashboard.pulseBtcDom', 'BTC Dom')}</span>
                <span className="gm-dashboard-info-label">{pulse.btcDominance.toFixed(1)}%</span>
              </div>
            )}
            {pulse?.totalVolume > 0 && (
              <div className="gm-dashboard-glass gm-dashboard-info-pill gm-dashboard-fade">
                <span className="gm-dashboard-pulse-label">{t('gmDashboard.pulseVolume', '24h Vol')}</span>
                <span className="gm-dashboard-info-label">{fmtLargeShort(pulse.totalVolume)}</span>
              </div>
            )}
          </div>
        )}

        {(widgets.crypto || widgets.stocks) && (
          <div className={`gm-dashboard-row${widgets.crypto && widgets.stocks ? '' : ' gm-dashboard-row--single'}`}>
            {widgets.crypto && (
              <div className="gm-dashboard-glass gm-dashboard-block">
                <h2 className="gm-dashboard-block-title">{t('gmDashboard.top5Crypto')}</h2>
                <ul className="gm-dashboard-list">
                  {TOP_CRYPTO.map((sym) => {
                    const p = cryptoPrices?.[sym]
                    const price = p?.price ?? p?.priceUSD
                    const change = p?.change ?? p?.change24 ?? 0
                    return (
                      <li key={sym} className="gm-dashboard-list-item">
                        <span className="gm-dashboard-symbol">{sym}</span>
                        <span className="gm-dashboard-price">{price != null ? fmtPrice(price) : '-'}</span>
                        <span className={`gm-dashboard-change ${change >= 0 ? 'up' : 'down'}`}>
                          {price != null ? `${change >= 0 ? '+' : ''}${Number(change).toFixed(2)}%` : ''}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {widgets.stocks && (
              <div className="gm-dashboard-glass gm-dashboard-block">
                <h2 className="gm-dashboard-block-title">{t('gmDashboard.top5Stocks')}</h2>
                <ul className="gm-dashboard-list">
                  {TOP_STOCKS.map(({ symbol }) => {
                    const p = stockPrices?.[symbol]
                    const price = p?.price
                    const change = p?.change ?? 0
                    return (
                      <li key={symbol} className="gm-dashboard-list-item">
                        <span className="gm-dashboard-symbol">{symbol}</span>
                        <span className="gm-dashboard-price">{price != null ? fmtPrice(price) : '-'}</span>
                        <span className={`gm-dashboard-change ${change >= 0 ? 'up' : 'down'}`}>
                          {price != null ? `${change >= 0 ? '+' : ''}${Number(change).toFixed(2)}%` : ''}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {(widgets.watchlist || widgets.fearGreed) && (
          <div className={`gm-dashboard-row${widgets.watchlist && widgets.fearGreed ? '' : ' gm-dashboard-row--single'}`}>
            {widgets.watchlist && (
              <div className="gm-dashboard-glass gm-dashboard-block">
                <h2 className="gm-dashboard-block-title">{t('gmDashboard.myWatchlist', 'My Watchlist')}</h2>
                {watchlistEntries.length === 0 ? (
                  <p className="gm-dashboard-empty">{t('gmDashboard.watchlistEmpty', 'Your watchlist is empty. Star a token anywhere in the app and it will show up here.')}</p>
                ) : (
                  <ul className="gm-dashboard-list">
                    {watchlistEntries.map((tk) => {
                      const sym = (tk.symbol || '').toUpperCase()
                      const p = watchlistPrices[sym]
                      return (
                        <li key={tk.address || sym} className="gm-dashboard-list-item">
                          <span className="gm-dashboard-symbol">{sym}</span>
                          <span className="gm-dashboard-mcap">{p?.marketCap > 0 ? fmtLargeShort(p.marketCap) : ''}</span>
                          <span className="gm-dashboard-price">{p?.price != null ? fmtPrice(p.price) : '-'}</span>
                          <span className={`gm-dashboard-change ${(p?.change ?? 0) >= 0 ? 'up' : 'down'}`}>
                            {p?.price != null ? `${(p.change ?? 0) >= 0 ? '+' : ''}${Number(p.change ?? 0).toFixed(2)}%` : ''}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}

            {widgets.fearGreed && (() => {
              const fgValue = Number(fearGreed?.value ?? fearGreed?.score)
              const fgLabel = fearGreed?.classification || fearGreed?.value_classification || fearGreed?.label || ''
              const hasFg = Number.isFinite(fgValue)
              const asValue = Number(altSeason?.value ?? altSeason?.index)
              const hasAs = Number.isFinite(asValue) && asValue > 0
              const asOut = Number(altSeason?.outperformingAlts)
              const asTotal = Number(altSeason?.totalAlts)
              return (
                <div className="gm-dashboard-glass gm-dashboard-block gm-dashboard-fg">
                  <h2 className="gm-dashboard-block-title">{t('gmDashboard.fearGreed', 'Fear & Greed')}</h2>
                  {hasFg ? (
                    <>
                      <div className="gm-dashboard-fg-hero">
                        <span className="gm-dashboard-fg-value" style={{ color: fearGreedColor(fgValue) }}>{Math.round(fgValue)}</span>
                        {fgLabel && <span className="gm-dashboard-fg-classification">{fgLabel}</span>}
                      </div>
                      <div className="gm-dashboard-fg-meter" aria-hidden>
                        <span className="gm-dashboard-fg-dot" style={{ left: `${Math.min(100, Math.max(0, fgValue))}%` }} />
                      </div>
                      <div className="gm-dashboard-fg-scale" aria-hidden>
                        <span>{t('gmDashboard.fear', 'Fear')}</span>
                        <span>{t('gmDashboard.greed', 'Greed')}</span>
                      </div>
                    </>
                  ) : (
                    <p className="gm-dashboard-empty">-</p>
                  )}

                  {hasAs && (
                    <div className="gm-dashboard-fade">
                      <div className="gm-dashboard-fg-divider" aria-hidden />
                      <h2 className="gm-dashboard-block-title">{t('gmDashboard.altSeason', 'Altcoin Season')}</h2>
                      <div className="gm-dashboard-fg-hero">
                        <span className="gm-dashboard-fg-value" style={{ color: altSeasonColor(asValue) }}>{Math.round(asValue)}</span>
                        {(altSeason?.label || altSeason?.season) && (
                          <span className="gm-dashboard-fg-classification">{altSeason.label || altSeason.season}</span>
                        )}
                      </div>
                      <div className="gm-dashboard-fg-meter gm-dashboard-alt-meter" aria-hidden>
                        <span className="gm-dashboard-fg-dot" style={{ left: `${Math.min(100, Math.max(0, asValue))}%` }} />
                      </div>
                      <div className="gm-dashboard-fg-scale" aria-hidden>
                        <span>{t('gmDashboard.btcSeasonEnd', 'Bitcoin')}</span>
                        <span>{t('gmDashboard.altSeasonEnd', 'Altcoins')}</span>
                      </div>
                      {asOut > 0 && asTotal > 0 && (
                        <p className="gm-dashboard-fg-note">
                          {t('gmDashboard.altsBeatingBtc', {
                            count: asOut,
                            total: asTotal,
                            defaultValue: '{{count}} of the top {{total}} alts beat BTC over 30d',
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {widgets.news && (
          <div className="gm-dashboard-glass gm-dashboard-news">
            <h2 className="gm-dashboard-block-title">{t('gmDashboard.top5News')}</h2>
            <ul className="gm-dashboard-news-list">
              {newsToShow.map((item) => (
                <li key={item.id} className="gm-dashboard-news-item">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="gm-dashboard-news-link">
                    <span className="gm-dashboard-news-title">{item.title || t('gmDashboard.untitled')}</span>
                    <span className="gm-dashboard-news-meta">
                      {[item.source, formatTimeAgo(item.publishedOn, t)].filter(Boolean).join(' · ')}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {widgets.quote && (
          <p className="gm-dashboard-thought">“{getDailyThought()}”</p>
        )}

        <div className="gm-dashboard-footer">
          <p className="gm-dashboard-footer-text">{t('gmDashboard.footerText')}</p>
          <div className="gm-dashboard-glass gm-dashboard-footer-brand">Spectre AI</div>
        </div>
      </div>
    </div>
  )

  return content
}

export default GMDashboard
