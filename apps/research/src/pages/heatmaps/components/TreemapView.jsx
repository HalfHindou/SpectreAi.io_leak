/**
 * TreemapView — d3-powered treemap with zoom/pan.
 *
 * Layout recalculates at zoomed dimensions on every zoom event (no debounce).
 * d3 treemap for 100 nodes is sub-millisecond, so this gives crisp rendering
 * at all times — no CSS scale(), no blurry preview. The zoom layer uses only
 * translate() for panning.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { zoom, zoomIdentity } from 'd3-zoom'
import { select } from 'd3-selection'
import { useTreemapLayout } from './useTreemapLayout'
import TreemapCell from './TreemapCell'
import TreemapTooltip from './TreemapTooltip'
import './treemap.css'

const MIN_ZOOM = 1
const MAX_ZOOM = 10
const MOBILE_BREAKPOINT = 768

function TreemapView({
  tokens,
  getChange,
  fmtPrice,
  dayMode,
  isStocks,
  isFullscreen,
  onTokenClick,
  binancePrices,
  timeframe,
}) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const zoomBehavior = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [hoveredToken, setHoveredToken] = useState(null)
  const [hoverPos, setHoverPos] = useState(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT)
  const hoverTimer = useRef(null)

  // Clear the pending hover timer on unmount so a 50-80ms setTimeout can't fire
  // setHoveredToken/setHoverPos on an unmounted component (navigating away mid-hover).
  useEffect(() => () => clearTimeout(hoverTimer.current), [])

  // ── Track mobile breakpoint ──
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const handler = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // ── ResizeObserver for fluid layout ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── d3-zoom setup (desktop only) ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // On mobile, skip zoom/pan — let page scroll normally
    if (isMobile) {
      select(el).on('.zoom', null)
      zoomBehavior.current = null
      setTransform({ x: 0, y: 0, k: 1 })
      return
    }

    const zb = zoom()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .translateExtent([[0, 0], [1, 1]]) // updated when dimensions are known
      .filter((event) => {
        if (event.type === 'contextmenu') return false
        return true
      })
      .on('start', (event) => {
        if (event.sourceEvent?.type === 'mousedown') {
          setIsPanning(true)
        }
      })
      .on('zoom', (event) => {
        const { x, y, k } = event.transform
        setTransform({ x, y, k })
      })
      .on('end', () => {
        setIsPanning(false)
      })

    zoomBehavior.current = zb
    select(el).call(zb)

    const preventScroll = (e) => {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
    }
    el.addEventListener('wheel', preventScroll, { passive: false })

    return () => {
      select(el).on('.zoom', null)
      el.removeEventListener('wheel', preventScroll)
    }
  }, [isMobile])

  // Reset zoom & update pan constraints when data/container changes
  useEffect(() => {
    if (!containerRef.current || !zoomBehavior.current || isMobile) return
    if (dimensions.width > 0 && dimensions.height > 0) {
      zoomBehavior.current.translateExtent([[0, 0], [dimensions.width, dimensions.height]])
    }
    select(containerRef.current)
      .call(zoomBehavior.current.transform, zoomIdentity)
    setTransform({ x: 0, y: 0, k: 1 })
  }, [tokens?.length, dimensions.width, dimensions.height, isMobile])

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    if (!containerRef.current || !zoomBehavior.current) return
    select(containerRef.current)
      .transition()
      .duration(300)
      .call(zoomBehavior.current.scaleBy, 1.5)
  }, [])

  const handleZoomOut = useCallback(() => {
    if (!containerRef.current || !zoomBehavior.current) return
    select(containerRef.current)
      .transition()
      .duration(300)
      .call(zoomBehavior.current.scaleBy, 1 / 1.5)
  }, [])

  const handleZoomReset = useCallback(() => {
    if (!containerRef.current || !zoomBehavior.current) return
    select(containerRef.current)
      .transition()
      .duration(400)
      .call(zoomBehavior.current.transform, zoomIdentity)
  }, [])

  // Group stocks by sector, crypto flat
  const groupByField = isStocks ? 'sector' : null

  // Merge live prices
  const enrichedTokens = useMemo(() => {
    if (isStocks || !binancePrices) return tokens
    return tokens.map(t => {
      const live = binancePrices?.[t.symbol] || binancePrices?.[t.symbol?.toUpperCase?.()] || {}
      return {
        ...t,
        _livePrice: live.price > 0 ? live.price : t.price,
        _liveChange24h: live.change != null ? live.change : t.change24h,
      }
    })
  }, [tokens, binancePrices, isStocks])

  // ── d3 treemap layout at zoomed dimensions — recalculates every frame ──
  // No CSS scale() needed: cells are always at native resolution.
  const layoutWidth = Math.round(dimensions.width * transform.k)
  const layoutHeight = Math.round(dimensions.height * transform.k)
  const root = useTreemapLayout(enrichedTokens, layoutWidth, layoutHeight, { groupByField })
  const leaves = root?.leaves?.() || []
  const groups = groupByField ? (root?.children || []) : []

  // ── Hover handler (suppressed while panning) ──
  const handleHover = useCallback((token, pos) => {
    clearTimeout(hoverTimer.current)
    if (isPanning) return
    if (!token) {
      hoverTimer.current = setTimeout(() => {
        setHoveredToken(null)
        setHoverPos(null)
      }, 50)
    } else {
      if (hoveredToken && hoveredToken.symbol !== token.symbol) {
        setHoveredToken(token)
        setHoverPos(pos)
      } else if (!hoveredToken) {
        hoverTimer.current = setTimeout(() => {
          setHoveredToken(token)
          setHoverPos(pos)
        }, 80)
      } else {
        setHoverPos(pos)
      }
    }
  }, [hoveredToken, isPanning])

  // ── Get change for a token ──
  const getTokenChange = useCallback((token) => {
    if (!isStocks && timeframe === '24h' && token._liveChange24h != null) {
      return Number(token._liveChange24h) || 0
    }
    return getChange(token)
  }, [getChange, timeframe, isStocks])

  const isZoomed = transform.k !== 1 || transform.x !== 0 || transform.y !== 0
  const zoomPct = Math.round(transform.k * 100)

  return (
    <div
      ref={containerRef}
      className={`treemap-container${isFullscreen ? ' treemap-container--fullscreen' : ''}${dayMode ? ' day-mode' : ''}${isPanning ? ' treemap-container--panning' : ''}${isMobile ? ' treemap-container--mobile' : ''}`}
    >
      {dimensions.width > 0 && dimensions.height > 0 && (
        <>
          {/* Zoom layer — translate only, no CSS scale. Content is at native resolution. */}
          <div
            className="treemap-zoom-layer"
            style={{
              transform: isMobile ? 'none' : `translate(${transform.x}px, ${transform.y}px)`,
              width: isMobile ? dimensions.width : layoutWidth,
              height: isMobile ? dimensions.height : layoutHeight,
            }}
          >
            {/* Sector group labels (stocks only) */}
            {groups.map(group => {
              const gw = group.x1 - group.x0
              if (gw < 50) return null
              return (
                <div
                  key={group.data.name}
                  className="treemap-group-label"
                  style={{
                    position: 'absolute',
                    left: group.x0 + 4,
                    top: group.y0 + 2,
                    width: gw - 8,
                  }}
                >
                  {group.data.name}
                </div>
              )
            })}

            {/* Treemap cells — at native resolution, no scaling */}
            {leaves.map(leaf => {
              const token = leaf.data.token
              const change = getTokenChange(token)
              const livePrice = token._livePrice ?? token.price
              return (
                <TreemapCell
                  key={token.symbol + (token.id || '')}
                  leaf={leaf}
                  change={change}
                  livePrice={livePrice}
                  fmtPrice={fmtPrice}
                  onHover={handleHover}
                  onClick={onTokenClick}
                  dayMode={dayMode}
                />
              )
            })}
          </div>

          {/* Fixed overlays — hidden on mobile */}

          {/* Zoom controls (desktop only) */}
          {!isMobile && (
            <div className={`treemap-zoom-controls${dayMode ? ' day-mode' : ''}`}>
              <button className="treemap-zoom-btn" onClick={handleZoomIn} title={t('heatmaps.zoomIn')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <span className="treemap-zoom-level">{zoomPct}%</span>
              <button className="treemap-zoom-btn" onClick={handleZoomOut} title={t('heatmaps.zoomOut')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {isZoomed && (
                <button className="treemap-zoom-btn treemap-zoom-reset" onClick={handleZoomReset} title={t('heatmaps.resetZoom')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Color legend bar (desktop only) */}
          {!isMobile && (
            <div className="treemap-legend">
              <span className="treemap-legend-label">-8%</span>
              <div className="treemap-legend-bar" />
              <span className="treemap-legend-label">+8%</span>
            </div>
          )}

          {/* Zoom hint (desktop only) */}
          {!isZoomed && !isMobile && (
            <div className={`treemap-zoom-hint${dayMode ? ' day-mode' : ''}`}>
              {t('heatmaps.zoomHint')}
            </div>
          )}
        </>
      )}

      {/* Tooltip portal */}
      {hoveredToken && hoverPos && (
        <TreemapTooltip
          token={hoveredToken}
          position={hoverPos}
          getChange={getTokenChange}
          fmtPrice={fmtPrice}
          isStocks={isStocks}
          dayMode={dayMode}
        />
      )}
    </div>
  )
}

export default memo(TreemapView)
