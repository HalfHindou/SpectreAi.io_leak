/**
 * useWeather — Open-Meteo weather for the user's location.
 *
 * Extracted from the original Header.jsx so the new EnvironmentCapsule
 * (and the EnvironmentPopover with full forecast) share the same
 * fetch + cache without duplicating the geolocation + ipapi.co fallback.
 *
 * Pipeline:
 *   1. Hydrate from localStorage('spectre-weather') instantly so the
 *      first paint shows real data instead of "Loading...".
 *   2. If cache is older than 30 min: re-fetch.
 *   3. Resolve lat/lon via:
 *        a. navigator.geolocation (most accurate; user prompt)
 *        b. ipapi.co JSON (HTTPS + CORS, free tier)
 *        c. NYC default (40.7128, -74.0060)
 *   4. Hit Open-Meteo /v1/forecast with the lat/lon.
 *   5. Persist to localStorage for next visit.
 *
 * Returns:
 *   { weather, loading, info, refresh }
 *
 * Where `weather` has shape:
 *   {
 *     location, temp, high, low, code, unit, lastUpdated, conditions,
 *     latitude, longitude
 *   }
 *
 * `info` is the WMO code → { icon, desc } mapping for the current code.
 */

import { useEffect, useState, useCallback } from 'react'
import { whenIdle } from '../utils/whenIdle'

const STORAGE_KEY = 'spectre-weather'
const LOCATION_OVERRIDE_KEY = 'spectre-weather-location'   // manual user-set location
const REFRESH_INTERVAL_MS = 30 * 60 * 1000  // 30 minutes
const FALLBACK_COORDS = { lat: 40.7128, lon: -74.0060, city: 'New York' }

// WMO Weather interpretation codes → icon glyph slug + human desc.
const WEATHER_CODES = {
  0:  { icon: 'clear',         desc: 'Clear sky' },
  1:  { icon: 'partly-cloudy', desc: 'Mainly clear' },
  2:  { icon: 'partly-cloudy', desc: 'Partly cloudy' },
  3:  { icon: 'cloudy',        desc: 'Overcast' },
  45: { icon: 'fog',           desc: 'Foggy' },
  48: { icon: 'fog',           desc: 'Icy fog' },
  51: { icon: 'drizzle',       desc: 'Light drizzle' },
  53: { icon: 'drizzle',       desc: 'Drizzle' },
  55: { icon: 'drizzle',       desc: 'Heavy drizzle' },
  61: { icon: 'rain',          desc: 'Light rain' },
  63: { icon: 'rain',          desc: 'Rain' },
  65: { icon: 'rain',          desc: 'Heavy rain' },
  71: { icon: 'snow',          desc: 'Light snow' },
  73: { icon: 'snow',          desc: 'Snow' },
  75: { icon: 'snow',          desc: 'Heavy snow' },
  80: { icon: 'rain',          desc: 'Rain showers' },
  81: { icon: 'rain',          desc: 'Heavy showers' },
  95: { icon: 'storm',         desc: 'Thunderstorm' },
}

export function weatherInfoFor(code) {
  return WEATHER_CODES[code] || { icon: 'clear', desc: 'Clear' }
}

async function fetchForecast(lat, lon, cityName = null) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=celsius&timezone=auto`,
    { signal: AbortSignal.timeout(8000) }
  )
  const data = await res.json()
  let location = cityName
  if (!location && data?.timezone) {
    const parts = data.timezone.split('/')
    location = parts[parts.length - 1].replace(/_/g, ' ')
  }
  return {
    location: location || 'Your Location',
    // IANA timezone string from Open-Meteo (e.g., "Europe/Kyiv",
    // "Asia/Tokyo"). The popover formatters use this so the time
    // shown matches the city, not the user's device clock.
    timezone: data?.timezone || null,
    timezoneAbbr: data?.timezone_abbreviation || null,
    temp: Math.round(data?.current?.temperature_2m || 0),
    high: Math.round(data?.daily?.temperature_2m_max?.[0] || 0),
    low:  Math.round(data?.daily?.temperature_2m_min?.[0] || 0),
    code: data?.current?.weather_code ?? 0,
    unit: 'celsius',
    latitude: lat,
    longitude: lon,
    lastUpdated: Date.now(),
  }
}

/**
 * Common alternate-spelling map. Open-Meteo's geocoding API (backed by
 * GeoNames) indexes only the MODERN romanised name for major cities,
 * so searches for the older / colonial / Russian transliteration come
 * back empty even though the place is huge. We silently search the
 * canonical form too and merge results so the user gets what they
 * meant without needing to know the politics of romanisation.
 *
 * Keep this list small — only well-known aliases where the literal
 * spelling fails. Lower-cased keys → canonical name.
 */
const CITY_ALIASES = {
  kiev:           'Kyiv',
  odessa:         'Odesa',
  kharkov:        'Kharkiv',
  lvov:           'Lviv',
  bombay:         'Mumbai',
  calcutta:       'Kolkata',
  madras:         'Chennai',
  bangalore:      'Bengaluru',
  peking:         'Beijing',
  canton:         'Guangzhou',
  saigon:         'Ho Chi Minh City',
  rangoon:        'Yangon',
  burma:          'Myanmar',
  constantinople: 'Istanbul',
  ceylon:         'Colombo',
}

async function fetchCityResults(q) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const d = await r.json()
    return Array.isArray(d?.results) ? d.results : []
  } catch {
    return []
  }
}

/**
 * Search cities by name via Open-Meteo's free geocoding API.
 * Returns up to 5 deduplicated matches.
 * No key required. CORS-enabled.
 */
export async function searchCities(query) {
  const q = String(query || '').trim()
  if (q.length < 2) return []

  const lc = q.toLowerCase()
  const alias = CITY_ALIASES[lc]

  // If we have an alias, search BOTH — alias first so its canonical
  // results rank above the literal-query hits.
  const queries = alias && alias.toLowerCase() !== lc ? [alias, q] : [q]

  const responseSets = await Promise.all(queries.map(fetchCityResults))

  // Merge + dedupe by approximate coords (2-decimal grid ≈ 1km).
  const seen = new Set()
  const merged = []
  for (const set of responseSets) {
    for (const r of set) {
      if (r?.latitude == null || r?.longitude == null) continue
      const key = `${r.latitude.toFixed(2)},${r.longitude.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({
        name: r.name,
        admin1: r.admin1 || null,
        country: r.country || null,
        countryCode: r.country_code || null,
        lat: r.latitude,
        lon: r.longitude,
      })
      if (merged.length >= 5) break
    }
    if (merged.length >= 5) break
  }
  return merged
}

function readOverride() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LOCATION_OVERRIDE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeOverride(override) {
  if (typeof localStorage === 'undefined') return
  try {
    if (override) localStorage.setItem(LOCATION_OVERRIDE_KEY, JSON.stringify(override))
    else          localStorage.removeItem(LOCATION_OVERRIDE_KEY)
  } catch {}
}

const COORDS_CACHE_KEY = 'spectre-weather-coords-v1'

async function resolveCoords() {
  // 0. Manual user override wins (set via EnvironmentCapsule city search)
  const override = readOverride()
  if (override?.lat != null && override?.lon != null) {
    return { lat: override.lat, lon: override.lon, city: override.city || null }
  }
  // 1. Cached coords - location barely changes, so reuse a recent result and
  //    avoid re-hitting /api/geo on every mount/refresh (ipapi.co rate-limits
  //    with 429). A real result caches 24h; a fallback caches 30min so we retry
  //    soon rather than pinning to NYC.
  try {
    const raw = localStorage.getItem(COORDS_CACHE_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      const ttl = c?.fallback ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000
      if (c && c.lat != null && (Date.now() - (c.ts || 0)) < ttl) {
        return { lat: c.lat, lon: c.lon, city: c.city || null }
      }
    }
  } catch {}
  // 2. IP-geo via the same-origin /api/geo proxy (city-level). We deliberately
  //    do NOT call navigator.geolocation: the weather capsule is ambiance and
  //    doesn't need precise coords, and auto-prompting on every load spams the
  //    browser permission UI - which users ignore, so Chrome then hard-blocks
  //    it and logs a warning. Users wanting a specific city use the capsule's
  //    city search (the override above).
  try {
    const r = await fetch('/api/geo', { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      const d = await r.json()
      if (d?.latitude && d?.longitude) {
        const coords = { lat: d.latitude, lon: d.longitude, city: d.city || null }
        try { localStorage.setItem(COORDS_CACHE_KEY, JSON.stringify({ ...coords, ts: Date.now() })) } catch {}
        return coords
      }
    }
  } catch {
    // network / blocked / rate-limited; fall through
  }
  // 3. Default coords (NYC) - cached briefly so a 429 doesn't re-fire every mount.
  const fallback = { lat: FALLBACK_COORDS.lat, lon: FALLBACK_COORDS.lon, city: FALLBACK_COORDS.city }
  try { localStorage.setItem(COORDS_CACHE_KEY, JSON.stringify({ ...fallback, ts: Date.now(), fallback: true })) } catch {}
  return fallback
}

export default function useWeather() {
  const [weather, setWeather] = useState(() => {
    if (typeof localStorage === 'undefined') return null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { lat, lon, city } = await resolveCoords()
      const next = await fetchForecast(lat, lon, city)
      setWeather(next)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
    } catch (err) {
      console.error('useWeather: refresh failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Apply a manual location (from the city-search picker). Persists
   * across reloads + suppresses the geolocation/ipapi fallback chain.
   * Pass null to clear the override and revert to auto-location.
   */
  const setLocation = useCallback(async (loc) => {
    if (loc?.lat != null && loc?.lon != null) {
      writeOverride({ lat: loc.lat, lon: loc.lon, city: loc.name || loc.city || null })
      setLoading(true)
      try {
        const next = await fetchForecast(loc.lat, loc.lon, loc.name || loc.city || null)
        setWeather(next)
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      } catch (err) {
        console.error('useWeather: setLocation fetch failed', err)
      } finally {
        setLoading(false)
      }
    } else {
      // Clear override → next refresh resolves via geolocation/ipapi.
      writeOverride(null)
      refresh()
    }
  }, [refresh])

  useEffect(() => {
    const stale = !weather || (Date.now() - (weather.lastUpdated || 0)) > REFRESH_INTERVAL_MS
    // Idle-defer the stale refresh: the geolocation -> ipapi.co ->
    // open-meteo chain is header decoration and must not compete with the
    // token page's first-second critical path. The capsule already paints
    // from the localStorage hydrate above, so pixels are unchanged.
    let cancelIdle = () => {}
    if (stale) {
      let cancelled = false
      const cancel = whenIdle(() => { if (!cancelled) refresh() }, { timeout: 4000 })
      cancelIdle = () => { cancelled = true; cancel() }
    }
    // Periodic refresh every 30 minutes while the tab is open. The
    // visibility-aware pattern isn't required here because 30 min is
    // already coarse enough that hidden-tab updates are cheap.
    const id = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { cancelIdle(); clearInterval(id) }
  }, [refresh])  // eslint-disable-line react-hooks/exhaustive-deps

  return {
    weather,
    loading,
    info: weather ? weatherInfoFor(weather.code) : weatherInfoFor(0),
    refresh,
    setLocation,
    isManualLocation: !!readOverride(),
  }
}
