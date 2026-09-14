/**
 * World War Room — Full-screen intelligence dashboard.
 * Two views: 3D Globe + 2D Flat Map.
 *
 * WHY two views:
 * The 3D globe is cinematic but WebGL toggles are unreliable.
 * The 2D map is SVG — every marker, country, and line is a real DOM node.
 * Clicks, hovers, tooltips all work natively. No raycasting, no cross-reconciler bugs.
 */
import { useState, useCallback, useEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
const GlobeScene = lazy(() => import('./globe-scene'))
import MapView from './map-view'
import DataPanels from './data-panels'
import useLiveData from './use-live-data'
import { LAYERS, MARKET_SESSIONS, isSessionOpen, generateWhaleAlert } from './world-constants'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import { getSpectreGlobalMetrics } from '@/services/spectreMarketApi'
import SpectreLoader from '@/components/spectre-loader'
import './world-page.css'

/* ═══════════════════════════════════════════════
   SVG ICON COMPONENTS — Layer toggles
   ═══════════════════════════════════════════════ */
const LayerIcons = {
  flows: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 10h14M13 6l4 4-4 4M17 10H3M7 14l-4-4 4-4" />
    </svg>
  ),
  exchanges: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="4" y="6" width="12" height="8" rx="1.5" />
      <path d="M7 9h6M7 11h4" opacity="0.6" />
      <circle cx="15" cy="7" r="2" fill="currentColor" stroke="none" opacity="0.5" />
    </svg>
  ),
  whales: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 10c0-4 3-7 7-7s7 3 7 7-3 6-7 7c-2 .5-4-.5-5-2" />
      <circle cx="7" cy="9" r="1" fill="currentColor" stroke="none" />
      <path d="M14 12c-1 1-3 1.5-5 1" />
    </svg>
  ),
  sentiment: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M10 2v3M10 15v3M3 10h3M14 10h3" />
      <circle cx="10" cy="10" r="4" />
      <path d="M10 6v4l2.5 1.5" />
    </svg>
  ),
}

/* ═══════════════════════════════════════════════
   SVG ICON COMPONENTS — Controls
   ═══════════════════════════════════════════════ */
const ControlIcons = {
  globe: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M2.5 9h13M9 2.5c2 2.5 3 4.5 3 6.5s-1 4-3 6.5M9 2.5c-2 2.5-3 4.5-3 6.5s1 4 3 6.5" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4l5-2 4 2 5-2v12l-5 2-4-2-5 2V4z" />
      <path d="M7 2v12M11 4v12" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="9" cy="9" r="3.5" />
      <path d="M9 2v2M9 14v2M2 9h2M14 9h2M4.2 4.2l1.4 1.4M12.4 12.4l1.4 1.4M4.2 13.8l1.4-1.4M12.4 5.6l1.4-1.4" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M14.5 10.5a6 6 0 01-7-7 6 6 0 107 7z" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <rect x="2" y="2" width="14" height="14" rx="2" />
      <path d="M2 9h14M9 2v14M2 5.5h14M2 12.5h14M5.5 2v14M12.5 2v14" opacity="0.4" />
    </svg>
  ),
  beam: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M9 2v5M9 11v5" />
      <circle cx="9" cy="9" r="2" />
      <path d="M5 4l2 3M13 4l-2 3M5 14l2-3M13 14l-2-3" opacity="0.5" />
    </svg>
  ),
  rotate: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M14.5 6.5A6 6 0 005 4.5" />
      <path d="M3.5 11.5A6 6 0 0013 13.5" />
      <path d="M5 2v3h3" />
      <path d="M13 16v-3h-3" />
    </svg>
  ),
}

/* ═══════════════════════════════════════════════
   SVG ICON COMPONENTS — Market sessions
   ═══════════════════════════════════════════════ */
const SessionIcons = {
  asia: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 3 4 3 6s-1 4-3 6" opacity="0.5" />
    </svg>
  ),
  europe: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6" opacity="0.5" />
    </svg>
  ),
  us: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" /><path d="M2 8h12" /><path d="M8 2a10 10 0 00-4 6 10 10 0 004 6" opacity="0.5" />
    </svg>
  ),
  crypto: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M4 4h8v8H4z" /><path d="M6 2v4M10 2v4M6 10v4M10 10v4M2 6h4M10 6h4M2 10h4M10 10h4" />
    </svg>
  ),
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */
export default function WorldPage({ dayMode, onClose }) {
  /* ── View mode: 'globe' or 'map' ── */
  const [viewMode, setViewMode] = useState('map')

  /* ── Layer + data state ── */
  const [activeLayers, setActiveLayers] = useState(['flows', 'whales'])
  const [whaleAlerts, setWhaleAlerts] = useState([])
  const [fearGreed, setFearGreed] = useState(null)
  const [globalData, setGlobalData] = useState(null)
  const [selectedCountry, setSelectedCountry] = useState(null)
  const [isLoaded, setIsLoaded] = useState(false)

  /* ── Real-time WebSocket data (6 sources, flushed every 4s) ── */
  const {
    prices: livePrices, totalVolume: binanceVolume, topPairs,
    connected: wsConnected, exchanges, mempool, connectionCount,
  } = useLiveData()

  /* ── Globe-specific controls ── */
  const [globeMode, setGlobeMode] = useState('dark')
  const [showGrid, setShowGrid] = useState(false)
  const [showMarketBeams, setShowMarketBeams] = useState(true)
  const [autoRotate, setAutoRotate] = useState(true)

  /* ── Data fetching ── */
  useEffect(() => {
    getFearGreedCurrent()
      .then(data => {
        if (data?.value != null) setFearGreed({ value: Number(data.value), classification: data.classification || data.value_classification })
      })
      .catch(() => setFearGreed({ value: 50, classification: 'Neutral' }))

    getSpectreGlobalMetrics()
      .then(data => { if (data) setGlobalData(data) })
      .catch(() => {})

    const timer = setTimeout(() => setIsLoaded(true), 100)
    return () => clearTimeout(timer)
  }, [])

  /* ── Whale alert generation ──
   * 2026-05-26 beta-quality fix: disabled fabricated whale-alert generator.
   * Was producing random token/exchange/amount strings every 8s and displaying
   * them as if they were real on-chain whale moves. Real whale feed must come
   * from the /v1/intelligence/whale-moves endpoint when wired up.
   */
  void generateWhaleAlert
  // const whaleIntervalRef = useRef(null)
  // useEffect(() => { ...fabricated feed disabled... }, [])

  /* ── Handlers ── */
  const toggleLayer = useCallback((layerId) => {
    setActiveLayers(prev => prev.includes(layerId) ? prev.filter(l => l !== layerId) : [...prev, layerId])
  }, [])

  const handleCountryClick = useCallback((country) => {
    setSelectedCountry(prev => prev?.id === country.id ? null : country)
  }, [])

  return (
    <div className={`world-page ${isLoaded ? 'world-loaded' : ''} ${dayMode ? 'world-day' : ''}`}>
      {/* ── Background layers ── */}
      <div className="world-bg-deep" />
      {viewMode === 'globe' && <div className="world-scanline" />}

      {/* ═══ TOP CHROME ═══ */}
      <div className="world-chrome-top">
        {/* Left: View mode toggle + layer toggles */}
        <div className="world-chrome-left">
          {/* View mode toggle */}
          <div className="world-view-mode">
            <button
              className={`world-mode-btn ${viewMode === 'globe' ? 'active' : ''}`}
              onClick={() => setViewMode('globe')}
              title="3D Globe"
            >
              <span className="world-mode-icon">{ControlIcons.globe}</span>
              <span>Globe</span>
            </button>
            <button
              className={`world-mode-btn ${viewMode === 'map' ? 'active' : ''}`}
              onClick={() => setViewMode('map')}
              title="2D Map"
            >
              <span className="world-mode-icon">{ControlIcons.map}</span>
              <span>Map</span>
            </button>
          </div>

          {/* Layer toggles */}
          <div className="world-layer-toggles">
            {LAYERS.map(layer => (
              <button
                key={layer.id}
                className={`world-layer-btn ${activeLayers.includes(layer.id) ? 'active' : ''}`}
                onClick={() => toggleLayer(layer.id)}
                title={layer.label}
              >
                <span className="world-layer-icon">{LayerIcons[layer.id]}</span>
                <span>{layer.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: controls cluster */}
        <div className="world-chrome-right">
          {/* View controls */}
          <div className="world-view-controls">
            <button
              className={`world-ctrl-btn ${(viewMode === 'globe' ? globeMode === 'day' : dayMode) ? 'active' : ''}`}
              onClick={() => setGlobeMode(m => m === 'day' ? 'dark' : 'day')}
              title={globeMode === 'day' ? 'Switch to Night' : 'Switch to Day'}
            >
              {globeMode === 'day' ? ControlIcons.sun : ControlIcons.moon}
              <span className="world-ctrl-label">{globeMode === 'day' ? 'Day' : 'Night'}</span>
            </button>

            <div className="world-ctrl-divider" />

            <button
              className={`world-ctrl-btn ${showGrid ? 'active' : ''}`}
              onClick={() => setShowGrid(g => !g)}
              title="Grid Overlay"
            >
              {ControlIcons.grid}
              <span className="world-ctrl-label">Grid</span>
            </button>

            {viewMode === 'globe' && (
              <>
                <button
                  className={`world-ctrl-btn ${showMarketBeams ? 'active' : ''}`}
                  onClick={() => setShowMarketBeams(b => !b)}
                  title="Market Beams"
                >
                  {ControlIcons.beam}
                  <span className="world-ctrl-label">Beams</span>
                </button>

                <button
                  className={`world-ctrl-btn ${autoRotate ? 'active' : ''}`}
                  onClick={() => setAutoRotate(r => !r)}
                  title="Auto Rotate"
                >
                  {ControlIcons.rotate}
                  <span className="world-ctrl-label">Rotate</span>
                </button>
              </>
            )}
          </div>

          {/* Market hours status */}
          <div className="world-market-hours">
            {MARKET_SESSIONS.map(s => {
              const open = isSessionOpen(s)
              return (
                <div key={s.id} className={`world-market-pill ${open ? 'open' : ''}`}>
                  <span className="world-market-icon">{SessionIcons[s.id]}</span>
                  <span className="world-market-name">{s.label}</span>
                  {open && <span className="world-market-live" />}
                </div>
              )
            })}
          </div>

          {/* Close */}
          <button className="world-close-btn" onClick={onClose} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ═══ MAIN VIEW ZONE ═══ */}
      <div className={`world-globe-zone ${globeMode === 'day' ? 'world-globe-day' : ''}`}>
        {viewMode === 'globe' ? (
          <>
            <div className="world-globe-glow" />
            <Suspense fallback={<div className="world-globe-loading"><SpectreLoader variant="logo" size="lg" label="Loading the globe" /></div>}>
              <GlobeScene
                activeLayers={activeLayers}
                whaleAlerts={whaleAlerts}
                onCountryClick={handleCountryClick}
                selectedCountry={selectedCountry}
                globeMode={globeMode}
                showGrid={showGrid}
                showMarketBeams={showMarketBeams}
                autoRotate={autoRotate}
              />
            </Suspense>
            <div className="world-vignette" />

            {/* Country info panel (globe) */}
            {selectedCountry && (
              <div className="world-country-panel">
                <div className="world-country-header">
                  <span className="world-country-name">{selectedCountry.name}</span>
                  <button className="world-country-close" onClick={() => setSelectedCountry(null)}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <line x1="12" y1="4" x2="4" y2="12" /><line x1="4" y1="4" x2="12" y2="12" />
                    </svg>
                  </button>
                </div>
                <div className="world-country-grid">
                  <div className="world-country-stat">
                    <span className="world-country-label">GDP</span>
                    <span className="world-country-value mono">{selectedCountry.gdp}</span>
                  </div>
                  <div className="world-country-stat">
                    <span className="world-country-label">Markets</span>
                    <span className="world-country-value">{selectedCountry.markets}</span>
                  </div>
                  <div className="world-country-stat">
                    <span className="world-country-label">Crypto</span>
                    <span className="world-country-value">{selectedCountry.crypto}</span>
                  </div>
                  <div className="world-country-stat">
                    <span className="world-country-label">Sentiment</span>
                    <span className={`world-country-value mono ${selectedCountry.sentiment > 55 ? 'bull' : selectedCountry.sentiment < 45 ? 'bear' : ''}`}>
                      {selectedCountry.sentiment}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <MapView
            activeLayers={activeLayers}
            whaleAlerts={whaleAlerts}
            onCountryClick={handleCountryClick}
            selectedCountry={selectedCountry}
            showGrid={showGrid}
            dayMode={globeMode === 'day'}
            topPairs={topPairs}
            binanceVolume={binanceVolume}
            fearGreed={fearGreed}
            wsConnected={wsConnected}
            exchanges={exchanges}
            mempool={mempool}
            connectionCount={connectionCount}
          />
        )}

        {/* ── Status badges ── */}
        {viewMode === 'globe' && (
          <div className="world-status-bar">
            <div className="world-status-badge">
              <span className={`world-status-dot ${wsConnected ? 'live' : ''}`} />
              <span className="world-status-text">{wsConnected ? 'LIVE' : 'CONNECTING'}</span>
            </div>
            <div className="world-status-badge">
              <span className="world-status-text mono">{activeLayers.length} LAYERS</span>
            </div>
            {connectionCount > 0 && (
              <div className="world-status-badge">
                <span className="world-status-dot live" />
                <span className="world-status-text mono">{connectionCount} WS</span>
              </div>
            )}
          </div>
        )}

        {/* ── Title watermark ── */}
        {viewMode === 'globe' && (
          <div className="world-title">
            <span className="world-title-text">WAR ROOM</span>
            <span className="world-title-sub">GLOBAL INTELLIGENCE</span>
          </div>
        )}
      </div>

      {/* ═══ DATA PANELS ═══ */}
      <div className="world-data-zone">
        <DataPanels
          whaleAlerts={whaleAlerts}
          fearGreed={fearGreed}
          globalData={globalData}
          livePrices={livePrices}
          binanceVolume={binanceVolume}
          topPairs={topPairs}
          wsConnected={wsConnected}
        />
      </div>
    </div>
  )
}
