/**
 * MapView — 2D flat intelligence map (SVG-based).
 *
 * PERF v2 — what changed:
 * 1. Tooltip is IMPERATIVE (ref + DOM mutation) — hover never triggers setState/re-render
 * 2. Removed CSS transition from 177 countries (was: "all 0.3s ease" per path = 177 transitions)
 * 3. All marker components React.memo'd
 * 4. Geography styles are static objects (no allocation per render)
 * 5. Single WebSocket flush from parent (1 re-render per 4s, not 6)
 */
import { useState, useMemo, useCallback, useRef, memo, createContext, useContext } from 'react'
import {
  FINANCIAL_HUBS, FLOW_ROUTES, ASSET_COLORS,
  COUNTRY_REGIONS, MARKET_SESSIONS, isSessionOpen,
  EXCHANGE_NODES,
} from './world-constants'
import './map-view.css'

const MAP_WIDTH = 960
const MAP_HEIGHT = 500
const ProjectionContext = createContext((coords) => coords)

function projectGeo([lng, lat], center = [10, 20], zoom = 1) {
  const scale = 2.25 * zoom
  const x = MAP_WIDTH / 2 + (lng - center[0]) * scale
  const y = MAP_HEIGHT / 2 - (lat - center[1]) * scale
  return [x, y]
}

function Marker({ coordinates, children, ...props }) {
  const project = useContext(ProjectionContext)
  const [x, y] = project(coordinates)
  return (
    <g transform={`translate(${x}, ${y})`} {...props}>
      {children}
    </g>
  )
}

function Line({ from, to, ...props }) {
  const project = useContext(ProjectionContext)
  const [x1, y1] = project(from)
  const [x2, y2] = project(to)
  return <line x1={x1} y1={y1} x2={x2} y2={y2} {...props} />
}

/* ── Marker components (all memo'd) ── */

const FlowLine = memo(function FlowLine({ from, to, color, volume }) {
  return (
    <Line
      from={[from.lng, from.lat]} to={[to.lng, to.lat]}
      stroke={color} strokeWidth={0.8 + volume * 1.5}
      strokeLinecap="round" strokeDasharray="4 3"
      className="map-flow-line" style={{ opacity: 0.5 + volume * 0.3 }}
    />
  )
})

const HubMarker = memo(function HubMarker({ hub, isSelected, onClick }) {
  const session = MARKET_SESSIONS.find(s => s.cities.includes(hub.id))
  const isOpen = session ? isSessionOpen(session) : false
  const color = isOpen ? '#10b981' : '#f5f5f7'
  return (
    <Marker coordinates={[hub.lng, hub.lat]} onClick={() => onClick(hub)}>
      <circle r={6} fill="none" stroke={color} strokeWidth={0.6} opacity={0.3} className="map-marker-pulse" />
      <circle r={3.5} fill="none" stroke={color} strokeWidth={0.5} opacity={0.5} />
      <circle r={2} fill={color} opacity={isSelected ? 1 : 0.85} />
      {isSelected && (
        <>
          <circle r={8} fill="none" stroke="#f5f5f7" strokeWidth={0.8} opacity={0.6} className="map-marker-selected" />
          <circle r={12} fill="none" stroke="#f5f5f7" strokeWidth={0.3} opacity={0.2} className="map-marker-selected-outer" />
        </>
      )}
      <text textAnchor="middle" y={-10} className="map-marker-label" style={{ opacity: isSelected ? 1 : 0.7 }}>
        {hub.name}
      </text>
    </Marker>
  )
})

const ExchangeMarker = memo(function ExchangeMarker({ node, liveVolume, isConnected }) {
  const color = node.color
  const vol = liveVolume || 0
  const size = 4 + (vol > 0 ? Math.min(Math.log10(vol / 1e6 + 1) * 3, 10) : 0)
  return (
    <Marker coordinates={[node.lng, node.lat]}>
      <circle r={size + 5} fill="none" stroke={color} strokeWidth={0.4} opacity={isConnected ? 0.3 : 0.1} className="map-exchange-pulse" />
      <circle r={size} fill="none" stroke={color} strokeWidth={1} opacity={isConnected ? 0.6 : 0.25} />
      <circle r={size * 0.5} fill={color} opacity={isConnected ? 0.5 : 0.15} />
      <circle r={2} fill={color} opacity={isConnected ? 0.9 : 0.3} />
      {isConnected && <circle r={1} fill="#10b981" cx={size + 2} cy={-size - 2} />}
      <text textAnchor="middle" y={size + 10} className="map-exchange-label" style={{ fill: color }}>{node.name}</text>
      {vol > 0 && (
        <text textAnchor="middle" y={size + 16} className="map-exchange-vol">
          ${vol >= 1e9 ? (vol / 1e9).toFixed(1) + 'B' : vol >= 1e6 ? (vol / 1e6).toFixed(0) + 'M' : (vol / 1e3).toFixed(0) + 'K'}
        </text>
      )}
    </Marker>
  )
})

const MempoolArc = memo(function MempoolArc({ tx, index }) {
  const fromLng = -100 + (index * 47) % 200
  const fromLat = 30 + (index * 23) % 30
  const toLng = fromLng + 40 + (index * 13) % 60
  const toLat = fromLat - 10 + (index * 7) % 20
  return (
    <Line
      from={[fromLng, fromLat]} to={[toLng, toLat]}
      stroke="#f59e0b" strokeWidth={Math.min(0.3 + tx.btc / 20, 1.5)}
      strokeLinecap="round" strokeDasharray="2 2"
      className="map-mempool-arc" style={{ opacity: Math.min(0.15 + tx.btc / 50, 0.5) }}
    />
  )
})

const WhaleMarker = memo(function WhaleMarker({ alert }) {
  const color = alert.token === 'BTC' ? '#a78bfa' : alert.token === 'ETH' ? '#818cf8' : '#f59e0b'
  return (
    <Marker coordinates={[alert.lng, alert.lat]}>
      <circle r={3} fill={color} opacity={0.9} />
      <circle r={6} fill="none" stroke={color} strokeWidth={0.5} opacity={0.5} className="map-whale-ring1" />
      <circle r={10} fill="none" stroke={color} strokeWidth={0.3} opacity={0.25} className="map-whale-ring2" />
      <text textAnchor="start" x={8} y={3} className="map-whale-label">{alert.amount} {alert.token}</text>
    </Marker>
  )
})

const SentimentMarker = memo(function SentimentMarker({ region }) {
  const color = region.sentiment > 60 ? '#10b981' : region.sentiment > 40 ? '#6b7280' : '#ef4444'
  const size = 8 + (region.sentiment / 100) * 12
  return (
    <Marker coordinates={[region.lng, region.lat]}>
      <circle r={size} fill={color} opacity={0.12} />
      <circle r={size * 0.6} fill={color} opacity={0.2} />
      <circle r={size * 0.25} fill={color} opacity={0.5} />
    </Marker>
  )
})

/* ── Stat overlay (memo'd) ── */

const StatOverlay = memo(function StatOverlay({ topPairs, binanceVolume, fearGreed, wsConnected, connectionCount }) {
  const display = useMemo(() =>
    (topPairs || []).filter(p => ['BTC', 'ETH', 'SOL', 'XRP'].includes(p.symbol)).slice(0, 4),
    [topPairs]
  )
  return (
    <div className="map-stats-overlay">
      <div className="map-stat-card">
        <div className="map-stat-card-header">
          <span className="map-stat-card-title">LIVE PRICES</span>
          {wsConnected && <span className="map-stat-live-dot" />}
          {connectionCount > 0 && <span className="map-stat-connections mono">{connectionCount} WS</span>}
        </div>
        {display.map(pair => (
          <div key={pair.symbol} className="map-stat-price-row">
            <span className="map-stat-symbol">{pair.symbol}</span>
            <span className="map-stat-price mono">
              ${Number(pair.price).toLocaleString(undefined, { maximumFractionDigits: pair.price >= 100 ? 0 : 2 })}
            </span>
            <span className={`map-stat-change mono ${pair.change24h >= 0 ? 'bull' : 'bear'}`}>
              {pair.change24h >= 0 ? '+' : ''}{Number(pair.change24h).toFixed(2)}%
            </span>
          </div>
        ))}
        {display.length === 0 && (
          <div className="map-stat-price-row">
            <span className="map-stat-symbol" style={{ opacity: 0.3 }}>Connecting...</span>
          </div>
        )}
      </div>
      <div className="map-stat-card map-stat-card-sm">
        {binanceVolume > 0 && (
          <div className="map-stat-row">
            <span className="map-stat-label">24H VOL</span>
            <span className="map-stat-value mono">${(binanceVolume / 1e9).toFixed(1)}B</span>
          </div>
        )}
        {fearGreed && (
          <div className="map-stat-row">
            <span className="map-stat-label">F&G</span>
            <span className={`map-stat-value mono ${fearGreed.value > 55 ? 'bull' : fearGreed.value < 45 ? 'bear' : ''}`}>
              {fearGreed.value}
            </span>
          </div>
        )}
      </div>
    </div>
  )
})

/* ═══════════════════════════════════════════════
   MAIN MAP VIEW
   ═══════════════════════════════════════════════ */
export default function MapView({
  activeLayers, whaleAlerts, onCountryClick, selectedCountry,
  showGrid, dayMode,
  topPairs, binanceVolume, fearGreed, wsConnected,
  exchanges, mempool, connectionCount,
}) {
  const [selectedHub, setSelectedHub] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState([10, 20])
  const containerRef = useRef(null)
  const tooltipRef = useRef(null)

  const hubMap = useMemo(() => {
    const m = {}
    FINANCIAL_HUBS.forEach(h => { m[h.id] = h })
    return m
  }, [])

  // Country lookup — O(1) for exact match
  const countryMap = useMemo(() => {
    const m = new Map()
    COUNTRY_REGIONS.forEach(c => m.set(c.name, c))
    return m
  }, [])

  const findCountryData = useCallback((geo) => {
    const name = geo.properties?.name
    if (!name) return null
    if (countryMap.has(name)) return countryMap.get(name)
    for (const [cName, cData] of countryMap) {
      if (name.includes(cName) || cName.includes(name)) return cData
    }
    return null
  }, [countryMap])

  const handleGeoClick = useCallback((geo) => {
    const country = findCountryData(geo)
    if (country) { onCountryClick(country); setCenter([country.lng, country.lat]); setZoom(3) }
  }, [findCountryData, onCountryClick])

  // IMPERATIVE tooltip — zero React re-renders on hover
  const handleGeoHover = useCallback((geo, evt) => {
    const el = tooltipRef.current
    if (!el) return
    const country = findCountryData(geo)
    if (!country || !evt) { el.style.display = 'none'; return }
    el.style.display = 'block'
    el.style.left = (evt.clientX + 12) + 'px'
    el.style.top = (evt.clientY - 12) + 'px'
    // Direct DOM updates — no setState
    const h = el.querySelector('[data-tt="name"]')
    const vals = el.querySelectorAll('[data-tt]')
    vals.forEach(v => {
      const key = v.getAttribute('data-tt')
      if (key === 'name') v.textContent = country.name
      else if (key === 'gdp') v.textContent = country.gdp
      else if (key === 'markets') v.textContent = country.markets
      else if (key === 'crypto') v.textContent = country.crypto
      else if (key === 'sentiment') {
        v.textContent = country.sentiment
        v.style.color = country.sentiment > 55 ? '#10b981' : country.sentiment < 45 ? '#ef4444' : ''
      }
    })
  }, [findCountryData])

  const handleGeoLeave = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none'
  }, [])

  const handleHubClick = useCallback((hub) => {
    setSelectedHub(prev => prev?.id === hub.id ? null : hub)
    setCenter([hub.lng, hub.lat]); setZoom(4)
  }, [])

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(z * 1.5, 8)), [])
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(z / 1.5, 1)), [])
  const handleReset = useCallback(() => { setZoom(1); setCenter([10, 20]) }, [])

  const recentWhales = useMemo(() => whaleAlerts.slice(-6), [whaleAlerts])
  const mempoolTxs = mempool?.txs || []

  // Static style objects — NO "transition" (was killing perf on 177 paths)
  const geoStyleDefault = useMemo(() => ({
    fill: dayMode ? '#e2e8f0' : '#111113',
    stroke: dayMode ? '#cbd5e1' : 'rgba(6, 182, 212, 0.08)',
    strokeWidth: 0.3, outline: 'none',
  }), [dayMode])

  const geoStyleSelected = useMemo(() => ({
    fill: dayMode ? '#dbeafe' : '#1e293b',
    stroke: dayMode ? '#93c5fd' : 'rgba(6, 182, 212, 0.2)',
    strokeWidth: 0.8, outline: 'none',
  }), [dayMode])

  const geoStyleHover = useMemo(() => ({
    fill: dayMode ? '#bfdbfe' : '#1a1a2e',
    stroke: dayMode ? '#93c5fd' : 'rgba(6, 182, 212, 0.25)',
    strokeWidth: 0.6, outline: 'none',
  }), [dayMode])

  const geoStylePressed = useMemo(() => ({
    fill: dayMode ? '#93c5fd' : '#1e293b',
    stroke: dayMode ? '#60a5fa' : 'rgba(6, 182, 212, 0.4)',
    strokeWidth: 0.8, outline: 'none',
  }), [dayMode])

  const geoHoverClickable = useMemo(() => ({ ...geoStyleHover, cursor: 'pointer' }), [geoStyleHover])
  const geoHoverDefault = useMemo(() => ({ ...geoStyleHover, cursor: 'default' }), [geoStyleHover])

  return (
    <div className={`map-view ${dayMode ? 'map-day' : ''}`} ref={containerRef}>
      <svg className="map-svg" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Global market flow map">
        <ProjectionContext.Provider value={(coords) => projectGeo(coords, center, zoom)}>
          <rect className="map-ocean-plane" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} rx="18" />
          {showGrid && (
            <g className="map-grid">
              {Array.from({ length: 12 }, (_, i) => (i - 6) * 30).map(lat => (
                <Line key={`lat-${lat}`} from={[-180, lat]} to={[180, lat]} className="map-grid-line" />
              ))}
              {Array.from({ length: 12 }, (_, i) => (i - 6) * 30).map(lng => (
                <Line key={`lng-${lng}`} from={[lng, -70]} to={[lng, 80]} className="map-grid-line" />
              ))}
            </g>
          )}

          {activeLayers.includes('sentiment') && (
            <g className="map-sentiment-layer">
              {COUNTRY_REGIONS.map(region => <SentimentMarker key={region.id} region={region} />)}
            </g>
          )}

          {activeLayers.includes('flows') && (
            <g className="map-flows-layer">
              {FLOW_ROUTES.map((route, i) => {
                const f = hubMap[route.from], t = hubMap[route.to]
                if (!f || !t) return null
                return <FlowLine key={i} from={f} to={t} color={ASSET_COLORS[route.asset]} volume={route.volume} />
              })}
            </g>
          )}

          {activeLayers.includes('flows') && (
            <g className="map-hubs-layer">
              {FINANCIAL_HUBS.map(hub => (
                <HubMarker key={hub.id} hub={hub} isSelected={selectedHub?.id === hub.id} onClick={handleHubClick} />
              ))}
            </g>
          )}

          {activeLayers.includes('exchanges') && (
            <g className="map-exchanges-layer">
              {EXCHANGE_NODES.map(node => (
                <ExchangeMarker
                  key={node.id} node={node}
                  liveVolume={exchanges?.[node.id]?.volume}
                  isConnected={exchanges?.[node.id]?.connected || false}
                />
              ))}
            </g>
          )}

          {activeLayers.includes('exchanges') && mempoolTxs.length > 0 && (
            <g className="map-mempool-layer">
              {mempoolTxs.map((tx, i) => <MempoolArc key={tx.hash || i} tx={tx} index={i} />)}
            </g>
          )}

          {activeLayers.includes('whales') && (
            <g className="map-whales-layer">
              {recentWhales.map(alert => <WhaleMarker key={alert.id} alert={alert} />)}
            </g>
          )}
        </ProjectionContext.Provider>
      </svg>

      <StatOverlay
        topPairs={topPairs} binanceVolume={binanceVolume}
        fearGreed={fearGreed} wsConnected={wsConnected} connectionCount={connectionCount}
      />

      {/* IMPERATIVE TOOLTIP — never triggers re-render */}
      <div ref={tooltipRef} className="map-tooltip" style={{ display: 'none' }}>
        <div className="map-tooltip-header" data-tt="name" />
        <div className="map-tooltip-grid">
          <div className="map-tooltip-row"><span className="map-tooltip-key">GDP</span><span className="map-tooltip-val mono" data-tt="gdp" /></div>
          <div className="map-tooltip-row"><span className="map-tooltip-key">Markets</span><span className="map-tooltip-val" data-tt="markets" /></div>
          <div className="map-tooltip-row"><span className="map-tooltip-key">Crypto</span><span className="map-tooltip-val" data-tt="crypto" /></div>
          <div className="map-tooltip-row"><span className="map-tooltip-key">Sentiment</span><span className="map-tooltip-val mono" data-tt="sentiment" /></div>
        </div>
      </div>

      {selectedCountry && (
        <div className="map-country-panel">
          <div className="map-country-panel-header">
            <span className="map-country-panel-name">{selectedCountry.name}</span>
            <button className="map-country-panel-close" onClick={() => onCountryClick(selectedCountry)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="12" y1="4" x2="4" y2="12" /><line x1="4" y1="4" x2="12" y2="12" />
              </svg>
            </button>
          </div>
          <div className="map-country-panel-grid">
            <div className="map-cpg-item"><span className="map-cpg-label">GDP</span><span className="map-cpg-value mono">{selectedCountry.gdp}</span></div>
            <div className="map-cpg-item"><span className="map-cpg-label">Markets</span><span className="map-cpg-value">{selectedCountry.markets}</span></div>
            <div className="map-cpg-item"><span className="map-cpg-label">Crypto</span><span className="map-cpg-value">{selectedCountry.crypto}</span></div>
            <div className="map-cpg-item">
              <span className="map-cpg-label">Sentiment</span>
              <span className={`map-cpg-value mono ${selectedCountry.sentiment > 55 ? 'bull' : selectedCountry.sentiment < 45 ? 'bear' : ''}`}>
                {selectedCountry.sentiment}/100
              </span>
            </div>
          </div>
          <div className="map-sentiment-bar">
            <div className="map-sentiment-bar-fill" style={{
              width: `${selectedCountry.sentiment}%`,
              background: selectedCountry.sentiment > 55 ? 'var(--bull, #10b981)' : selectedCountry.sentiment < 45 ? 'var(--bear, #ef4444)' : '#6b7280',
            }} />
          </div>
        </div>
      )}

      <div className="map-zoom-controls">
        <button className="map-zoom-btn" onClick={handleZoomIn} title="Zoom In">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></svg>
        </button>
        <button className="map-zoom-btn" onClick={handleZoomOut} title="Zoom Out">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="8" x2="13" y2="8" /></svg>
        </button>
        <button className="map-zoom-btn" onClick={handleReset} title="Reset View">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="3" y="3" width="10" height="10" rx="1" />
            <path d="M3 6h10M6 3v10" opacity="0.4" />
          </svg>
        </button>
      </div>

      <div className="map-legend">
        {activeLayers.includes('flows') && (
          <div className="map-legend-section">
            <span className="map-legend-title">CAPITAL FLOWS</span>
            <div className="map-legend-items">
              {Object.entries(ASSET_COLORS).map(([key, color]) => (
                <div key={key} className="map-legend-item">
                  <span className="map-legend-dot" style={{ background: color }} />
                  <span>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeLayers.includes('exchanges') && (
          <div className="map-legend-section">
            <span className="map-legend-title">EXCHANGES</span>
            <div className="map-legend-items">
              {EXCHANGE_NODES.slice(0, 3).map(ex => (
                <div key={ex.id} className="map-legend-item">
                  <span className="map-legend-dot" style={{ background: ex.color }} />
                  <span>{ex.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="map-legend-section">
          <span className="map-legend-title">MARKETS</span>
          <div className="map-legend-items">
            <div className="map-legend-item"><span className="map-legend-dot" style={{ background: '#10b981' }} /><span>Open</span></div>
            <div className="map-legend-item"><span className="map-legend-dot" style={{ background: '#f5f5f7', opacity: 0.5 }} /><span>Closed</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
