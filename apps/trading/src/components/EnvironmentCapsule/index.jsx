/**
 * EnvironmentCapsule — the compact ambient status pill in the header.
 *
 * Pill (always visible in the header):
 *   [glyph] [temp] · [time mono] · [• loc dot]
 *
 * Popover (on click, portalled):
 *   - Single eyebrow row: "MON · MAY 25, 2026"  ·  "2:00 PM"
 *   - Hero row: natural-coloured weather icon tile + big temp + conditions + hi/lo
 *   - Location row: clickable city chip (swaps to a search input on click)
 *     with inline refresh + "reset to auto" affordances.
 *
 * Weather icons use NATURAL colours, not --accent: warm orange for sun,
 * cool grey for clouds, sky blue for rain, etc. This reads as content
 * (real weather), not platform chrome.
 */

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import {
  MapPin, RefreshCw, Search, X, Locate, ArrowUp, ArrowDown,
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudDrizzle, CloudSun,
} from 'lucide-react'
import useWeather, { weatherInfoFor, searchCities } from '../../hooks/useWeather'
import useNow from '../../hooks/useNow'
import './capsule.css'

/* Map our weather-info icon slug to a lucide component. */
function WeatherGlyph({ icon, size = 14 }) {
  const props = { size, strokeWidth: 1.7 }
  switch (icon) {
    case 'clear':         return <Sun {...props} />
    case 'partly-cloudy': return <CloudSun {...props} />
    case 'cloudy':        return <Cloud {...props} />
    case 'fog':           return <CloudFog {...props} />
    case 'drizzle':       return <CloudDrizzle {...props} />
    case 'rain':          return <CloudRain {...props} />
    case 'snow':          return <CloudSnow {...props} />
    case 'storm':         return <CloudLightning {...props} />
    default:              return <Sun {...props} />
  }
}

// Format helpers accept an optional IANA timezone (e.g. "Asia/Tokyo")
// so the popover header reads the SELECTED city's wall-clock time
// after the user picks a new location via the city search. When no
// timezone is supplied (cold start before weather loads), the browser
// falls back to the user's local timezone.

function formatTime(d, timezone) {
  try {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    })
  } catch {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
}

/**
 * Wrap the matched prefix of `name` (case-insensitive) in a <mark>
 * so the typed portion highlights in search results. Falls back to
 * raw text if there's no match (e.g. when the result came in via
 * the city-alias map: typing "Kiev" → result name "Kyiv").
 */
function highlightMatch(name, query) {
  if (!query) return name
  const q = query.toLowerCase()
  const lc = name.toLowerCase()
  const idx = lc.indexOf(q)
  if (idx < 0) return name
  return (
    <>
      {name.slice(0, idx)}
      <mark className="env-popover-search-mark">{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </>
  )
}

function formatEyebrow(d, timezone) {
  // Sentence case for readability — "Monday, May 25, 2026"
  try {
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month:   'long',
      day:     'numeric',
      year:    'numeric',
      timeZone: timezone || undefined,
    })
  } catch {
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  }
}

export default function EnvironmentCapsule() {
  const { weather, loading, info, refresh, setLocation, isManualLocation } = useWeather()
  const now = useNow()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const popoverRef = useRef(null)

  // City search state — only relevant while popover is open
  const [editingCity, setEditingCity] = useState(false)
  const [cityQuery, setCityQuery] = useState('')
  const [cityResults, setCityResults] = useState([])
  const [cityLoading, setCityLoading] = useState(false)
  const [cityIdx, setCityIdx] = useState(0)        // keyboard-nav highlight
  const searchInputRef = useRef(null)
  const resultsRef = useRef(null)

  // Anchor popover under the pill
  useLayoutEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return }
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 10, left: rect.left + rect.width / 2 })
  }, [open])

  // Outside click + Esc to close (Esc cancels search first if active)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (
        popoverRef.current?.contains(e.target) ||
        btnRef.current?.contains(e.target)
      ) return
      setOpen(false)
      setEditingCity(false)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (editingCity) { setEditingCity(false); setCityQuery(''); setCityResults([]) }
      else setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, editingCity])

  // Reset search state when popover closes
  useEffect(() => {
    if (!open) { setEditingCity(false); setCityQuery(''); setCityResults([]) }
  }, [open])

  // Auto-focus the search input when entering edit mode
  useEffect(() => {
    if (editingCity) {
      const id = requestAnimationFrame(() => searchInputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [editingCity])

  // Debounced city search
  useEffect(() => {
    if (!editingCity) return
    const q = cityQuery.trim()
    if (q.length < 2) { setCityResults([]); setCityLoading(false); return }
    setCityLoading(true)
    const id = setTimeout(async () => {
      const r = await searchCities(q)
      setCityResults(r)
      setCityIdx(0)        // reset highlight to the top match
      setCityLoading(false)
    }, 250)
    return () => clearTimeout(id)
  }, [cityQuery, editingCity])

  // Keep the highlighted row scrolled into view when it changes
  useEffect(() => {
    const el = resultsRef.current?.querySelector(`[data-idx="${cityIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cityIdx])

  const onPickCity = useCallback(async (c) => {
    setEditingCity(false)
    setCityQuery('')
    setCityResults([])
    await setLocation(c)
  }, [setLocation])

  const onClearLocation = useCallback(() => {
    setLocation(null)
  }, [setLocation])

  const temp = weather?.temp ?? '--'
  const location = weather?.location || 'Locating…'

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`env-capsule${open ? ' env-capsule--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${info.desc}, ${temp}°C, ${formatTime(now, weather?.timezone)} in ${location}. Click for details.`}
      >
        <span className="env-capsule-glyph" aria-hidden="true">
          <WeatherGlyph icon={info.icon} size={14} />
        </span>
        <span className="env-capsule-temp">{temp}°</span>
        <span className="env-capsule-sep" aria-hidden="true">·</span>
        <span className="env-capsule-time">{formatTime(now, weather?.timezone)}</span>
        <span className="env-capsule-sep env-capsule-sep--dot" aria-hidden="true">•</span>
        <span className="env-capsule-loc-dot" aria-label={location}>
          <MapPin size={11} strokeWidth={2} />
        </span>
      </button>

      {open && pos && ReactDOM.createPortal(
        <div
          ref={popoverRef}
          className="env-popover"
          role="dialog"
          aria-label="Environment details"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
        >
          <div className="env-popover-arrow" aria-hidden="true" />

          {/* HEADER — eyebrow + time */}
          <div className="env-popover-head">
            <span className="env-popover-eyebrow">{formatEyebrow(now, weather?.timezone)}</span>
            <span className="env-popover-time-large">{formatTime(now, weather?.timezone)}</span>
          </div>

          {/* MAIN — natural-coloured icon tile + temp + conditions + hi/lo */}
          <div className="env-popover-main">
            <div className={`env-popover-icon env-popover-icon--${info.icon}`} aria-hidden="true">
              <WeatherGlyph icon={info.icon} size={28} />
            </div>
            <div className="env-popover-stats">
              <div className="env-popover-temp-row">
                <span className="env-popover-temp">{temp}<span className="env-popover-unit">°c</span></span>
              </div>
              <span className="env-popover-desc">{info.desc}</span>
              <div className="env-popover-hilo">
                <span className="env-popover-hilo-item">
                  <ArrowUp size={9} strokeWidth={2.6} aria-hidden="true" />
                  <span>{weather?.high ?? '--'}°</span>
                </span>
                <span className="env-popover-hilo-sep" aria-hidden="true">·</span>
                <span className="env-popover-hilo-item">
                  <ArrowDown size={9} strokeWidth={2.6} aria-hidden="true" />
                  <span>{weather?.low ?? '--'}°</span>
                </span>
              </div>
            </div>
          </div>

          {/* Hairline divider */}
          <div className="env-popover-divider" aria-hidden="true" />

          {/* LOCATION — view OR edit */}
          {!editingCity ? (
            <div className="env-popover-loc-row">
              <button
                type="button"
                className="env-popover-loc-chip"
                onClick={() => setEditingCity(true)}
                title="Change city"
              >
                <MapPin size={12} strokeWidth={2} aria-hidden="true" />
                <span className="env-popover-loc-name">{location}</span>
                <span className="env-popover-loc-hint" aria-hidden="true">Change</span>
              </button>
              <div className="env-popover-loc-actions">
                {isManualLocation && (
                  <button
                    type="button"
                    className="env-popover-mini-btn"
                    onClick={onClearLocation}
                    title="Reset to auto-detected location"
                    aria-label="Reset to auto-detected location"
                  >
                    <Locate size={12} strokeWidth={2} />
                  </button>
                )}
                <button
                  type="button"
                  className="env-popover-mini-btn"
                  onClick={() => refresh()}
                  disabled={loading}
                  title="Refresh weather"
                  aria-label="Refresh weather"
                >
                  <RefreshCw size={12} strokeWidth={2} className={loading ? 'env-popover-refresh-spin' : ''} />
                </button>
              </div>
            </div>
          ) : (
            <div className="env-popover-search">
              <div className="env-popover-search-row">
                <Search size={13} strokeWidth={2} className="env-popover-search-icon" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="env-popover-search-input"
                  placeholder="Search any city…"
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      if (cityResults.length > 0) {
                        setCityIdx((i) => (i + 1) % cityResults.length)
                      }
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      if (cityResults.length > 0) {
                        setCityIdx((i) => (i - 1 + cityResults.length) % cityResults.length)
                      }
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      const pick = cityResults[cityIdx] || cityResults[0]
                      if (pick) onPickCity(pick)
                    }
                  }}
                  aria-label="Search city"
                  aria-autocomplete="list"
                  aria-controls="env-city-results"
                  aria-activedescendant={cityResults[cityIdx] ? `env-city-r${cityIdx}` : undefined}
                />
                {cityQuery && (
                  <span className="env-popover-search-count" aria-hidden="true">
                    {cityLoading ? '…' : cityResults.length}
                  </span>
                )}
                <button
                  type="button"
                  className="env-popover-search-close"
                  onClick={() => { setEditingCity(false); setCityQuery(''); setCityResults([]) }}
                  aria-label="Cancel"
                  title="Cancel"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
              {cityQuery.trim().length >= 2 && (
                <ul
                  ref={resultsRef}
                  id="env-city-results"
                  className="env-popover-search-results"
                  role="listbox"
                >
                  {cityLoading && (
                    <li className="env-popover-search-empty">
                      <span className="env-popover-search-empty-spinner" />
                      Searching…
                    </li>
                  )}
                  {!cityLoading && cityResults.length === 0 && (
                    <li className="env-popover-search-empty">
                      No cities found
                    </li>
                  )}
                  {!cityLoading && cityResults.map((c, i) => {
                    const region = [
                      c.admin1 && c.admin1 !== c.name ? c.admin1 : null,
                      c.country,
                    ].filter(Boolean).join(', ')
                    return (
                      <li
                        key={`${c.name}-${c.lat}-${c.lon}-${i}`}
                        role="option"
                        aria-selected={i === cityIdx}
                      >
                        <button
                          type="button"
                          id={`env-city-r${i}`}
                          data-idx={i}
                          className={`env-popover-search-result${i === cityIdx ? ' is-selected' : ''}`}
                          onClick={() => onPickCity(c)}
                          onMouseEnter={() => setCityIdx(i)}
                        >
                          <MapPin size={12} strokeWidth={2} aria-hidden="true" className="env-popover-search-pin" />
                          <span className="env-popover-search-name">
                            {highlightMatch(c.name, cityQuery.trim())}
                          </span>
                          <span className="env-popover-search-region">{region}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
