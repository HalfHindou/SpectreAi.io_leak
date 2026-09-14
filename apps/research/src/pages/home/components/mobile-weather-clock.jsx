/**
 * MobileWeatherClock - Compact weather + date/time strip for mobile home.
 * Reads weather from localStorage (written by desktop header).
 * Updates clock every minute.
 */
import { memo, useState, useEffect } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import './mobile-weather-clock.css'

const WEATHER_ICONS = {
  0: '\u2600\uFE0F',    // clear - sun
  1: '\u26C5',           // mainly clear
  2: '\u26C5',           // partly cloudy
  3: '\u2601\uFE0F',    // overcast
  45: '\uD83C\uDF2B\uFE0F', // fog
  48: '\uD83C\uDF2B\uFE0F', // icy fog
  51: '\uD83C\uDF27\uFE0F', // drizzle
  53: '\uD83C\uDF27\uFE0F',
  55: '\uD83C\uDF27\uFE0F',
  61: '\uD83C\uDF27\uFE0F', // rain
  63: '\uD83C\uDF27\uFE0F',
  65: '\uD83C\uDF27\uFE0F',
  71: '\uD83C\uDF28\uFE0F', // snow
  73: '\uD83C\uDF28\uFE0F',
  75: '\uD83C\uDF28\uFE0F',
  80: '\uD83C\uDF27\uFE0F', // showers
  81: '\uD83C\uDF27\uFE0F',
  95: '\u26C8\uFE0F',    // storm
}

const getWeatherEmoji = (code) => WEATHER_ICONS[code] || '\u2600\uFE0F'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function formatTime(date, format) {
  if (format === '24h') {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function MobileWeatherClock({ dayMode }) {
  const tempUnit = useSettingsStore((s) => s.tempUnit)
  const timeFormat = useSettingsStore((s) => s.timeFormat)

  const [weather, setWeather] = useState(() => {
    try {
      const saved = localStorage.getItem('spectre-weather')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })

  const [now, setNow] = useState(new Date())

  // Update clock every 30s
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  // Re-read weather from localStorage every 2 min (desktop header writes it)
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const saved = localStorage.getItem('spectre-weather')
        if (saved) setWeather(JSON.parse(saved))
      } catch { /* ignore */ }
    }, 120000)
    return () => clearInterval(id)
  }, [])

  const cToF = (c) => Math.round(c * 9 / 5 + 32)
  const fmtTemp = (c) => {
    if (c == null) return '--'
    return tempUnit === 'fahrenheit' ? `${cToF(c)}` : `${c}`
  }

  const dayName = DAYS[now.getDay()]
  const monthName = MONTHS[now.getMonth()]
  const dateStr = `Today, ${monthName} ${now.getDate()}`
  const timeStr = formatTime(now, timeFormat || '12h')

  return (
    <div className={`mwc${dayMode ? ' mwc--day' : ''}`}>
      {/* Weather card */}
      <div className="mwc-weather">
        <span className="mwc-weather-icon">{weather ? getWeatherEmoji(weather.code) : '\u2600\uFE0F'}</span>
        <div className="mwc-weather-info">
          <span className="mwc-weather-location">{weather?.location || 'Loading'}</span>
          <span className="mwc-weather-temps">
            {fmtTemp(weather?.temp)}&deg;
            <span className="mwc-weather-hilo"> / {fmtTemp(weather?.low)} &deg;{tempUnit === 'fahrenheit' ? 'F' : 'C'}</span>
          </span>
        </div>
      </div>

      {/* Date/Time card */}
      <div className="mwc-datetime">
        <span className="mwc-date">{dateStr}</span>
        <div className="mwc-time-row">
          <span className="mwc-time">{timeStr}</span>
          <span className="mwc-day">{dayName}</span>
        </div>
      </div>
    </div>
  )
}

export default memo(MobileWeatherClock)
