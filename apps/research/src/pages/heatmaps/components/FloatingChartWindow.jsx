/**
 * FloatingChartWindow — draggable, resizable chart window portaled to body.
 *
 * Single mode: TradingChart (same component used in Research Zone) — Binance,
 * Codex, or TradingView UDF data depending on the token.
 *
 * Compare mode: CompareOverlayChart (multi-token % change from CoinGecko)
 *
 * Supports pin/unpin:
 *   - Unpinned: floats as portal to document.body, draggable + resizable
 *   - Pinned: renders inline (no portal), full width, fixed height, no drag/resize
 */
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
// PR-7 (perf): lazy - this surface opens on user action; keep the 5400-line
// chart module out of the page's initial chunk. lazyWithRetry preserves
// stale-chunk recovery.
import lazyWithRetry from '@/lib/lazy-with-retry'
const TradingChart = lazyWithRetry(() => import('@/components/trading-chart'))
import CompareOverlayChart from './CompareOverlayChart'
import AdvancedCompare from './AdvancedCompare'
import SpectreLoader from '@/components/spectre-loader'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import './FloatingChartWindow.css'

const DEFAULT_W = 720
const DEFAULT_H = 460
const MIN_W = 420
const MIN_H = 320
const PINNED_H = 400

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function getTokenAccent(symbol) {
  const row = TOKEN_ROW_COLORS[(symbol || '').toUpperCase()]
  return row?.bg ? `rgb(${row.bg})` : '#06B6D4'
}

export default function FloatingChartWindow({
  token,
  compareTokens = [],
  compareMode = false,
  onToggleCompare,
  onRemoveCompareToken,
  dayMode,
  livePrice,
  liveChange,
  fmtPrice,
  onClose,
  onViewToken,
  onCompareViewToken,
  pinned = false,
  onTogglePinned,
}) {
  // No chart TA layer here: FloatingChartWindow.css hides this window's
  // toolbar outright ("Hide TradingChart's toolbar — TradingView has its own"),
  // so the TA buttons mounted but could never be reached. Dead wiring removed.
  const taChartRef = useRef(null)

  const { t } = useTranslation()
  // Advanced compare modal
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [pos, setPos] = useState(() => ({
    x: Math.round((window.innerWidth - DEFAULT_W) / 2),
    y: Math.max(60, Math.round((window.innerHeight - DEFAULT_H) / 2)),
  }))
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [interacting, setInteracting] = useState(false) // blocks iframe during drag/resize

  const dragRef = useRef(null)
  const resizeRef = useRef(null)
  const activeDragHandlersRef = useRef(null)
  const activeResizeHandlersRef = useRef(null)

  // ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Unmount cleanup: tear down any in-flight drag/resize listeners so they
  // don't leak and fire setState on a dead component.
  useEffect(() => {
    return () => {
      const d = activeDragHandlersRef.current
      if (d) {
        document.removeEventListener('mousemove', d.move)
        document.removeEventListener('mouseup', d.up)
        activeDragHandlersRef.current = null
      }
      const r = activeResizeHandlersRef.current
      if (r) {
        document.removeEventListener('mousemove', r.move)
        document.removeEventListener('mouseup', r.up)
        activeResizeHandlersRef.current = null
      }
      document.body.style.userSelect = ''
    }
  }, [])

  // ── Drag ── (disabled when pinned)
  const handleDragStart = useCallback((e) => {
    if (pinned || e.button !== 0) return
    e.preventDefault()
    setInteracting(true)
    dragRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }

    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      const nx = d.px + (ev.clientX - d.mx)
      const ny = d.py + (ev.clientY - d.my)
      setPos({
        x: Math.max(-size.w + 120, Math.min(window.innerWidth - 120, nx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, ny)),
      })
    }
    const onUp = () => {
      dragRef.current = null
      setInteracting(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      activeDragHandlersRef.current = null
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    activeDragHandlersRef.current = { move: onMove, up: onUp }
  }, [pinned, pos.x, pos.y, size.w])

  // ── Resize ── (disabled when pinned)
  const handleResizeStart = useCallback((e, edge) => {
    if (pinned || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setInteracting(true)
    resizeRef.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y, edge }

    const onMove = (ev) => {
      const r = resizeRef.current
      if (!r) return
      const dx = ev.clientX - r.mx
      const dy = ev.clientY - r.my
      let { w, h, px, py } = { w: r.w, h: r.h, px: r.px, py: r.py }

      if (r.edge.includes('e')) w = Math.max(MIN_W, r.w + dx)
      if (r.edge.includes('w')) { w = Math.max(MIN_W, r.w - dx); px = r.px + (r.w - w) }
      if (r.edge.includes('s')) h = Math.max(MIN_H, r.h + dy)
      if (r.edge.includes('n')) { h = Math.max(MIN_H, r.h - dy); py = r.py + (r.h - h) }

      setSize({ w, h })
      setPos({ x: px, y: py })
    }
    const onUp = () => {
      resizeRef.current = null
      setInteracting(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      activeResizeHandlersRef.current = null
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    activeResizeHandlersRef.current = { move: onMove, up: onUp }
  }, [pinned, size.w, size.h, pos.x, pos.y])

  const isPositive = liveChange >= 0
  const changeStr = `${isPositive ? '+' : ''}${(typeof liveChange === 'number' ? liveChange : 0).toFixed(2)}%`

  const chartHeight = pinned ? PINNED_H - 44 : size.h - 44

  // Determine what chart to render in single (non-compare) mode
  const renderSingleChart = () => {
    return (
      <Suspense fallback={<div style={{ height: chartHeight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><SpectreLoader variant="logo" size="md" label="Loading chart" /></div>}>
        <TradingChart
          ref={taChartRef}
          key={token.symbol}
          token={token}
          stats={token}
          dayMode={dayMode}
          livePrice={livePrice}
          embedHeight={chartHeight}
          embedMode
        />
      </Suspense>
    )
  }

  const windowContent = (
    <div
      className={`floating-chart-window${dayMode ? ' day-mode' : ''}${pinned ? ' pinned' : ''}`}
      style={pinned ? { height: PINNED_H } : {
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
      }}
    >
      {/* Title bar — drag handle (no drag when pinned) */}
      <div className="fcw-titlebar" onMouseDown={handleDragStart}>
        {compareMode ? (
          /* ── Compare mode: token pills ── */
          <div className="fcw-compare-pills">
            {compareTokens.map(tk => (
              <div key={tk.symbol} className="fcw-compare-pill" style={{ '--pill-color': getTokenAccent(tk.symbol) }}>
                {tk.logo && <img className="fcw-compare-pill-logo" src={tk.logo} alt="" />}
                <span className="fcw-compare-pill-sym">{tk.symbol}</span>
                <button
                  className="fcw-compare-pill-x"
                  onClick={(e) => { e.stopPropagation(); onRemoveCompareToken?.(tk.symbol) }}
                  title={t('heatmaps.removeToken', { symbol: tk.symbol })}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ))}
            {compareTokens.length < 3 && (
              <span className="fcw-compare-hint">{t('heatmaps.addTokensHint')}</span>
            )}
          </div>
        ) : (
          /* ── Single mode: token info ── */
          <div className="fcw-token-info">
            {token.logo && <img className="fcw-logo" src={token.logo} alt="" />}
            <span className="fcw-symbol">{token.symbol}</span>
            <span className="fcw-name">{token.name}</span>
            <span className="fcw-price">{fmtPrice(livePrice)}</span>
            <span className={`fcw-change ${isPositive ? 'positive' : 'negative'}`}>{changeStr}</span>
          </div>
        )}
        <div className="fcw-actions">
          {/* Pin/Unpin toggle */}
          {onTogglePinned && (
            <button
              className={`fcw-btn fcw-pin-toggle${pinned ? ' active' : ''}`}
              onClick={onTogglePinned}
              title={pinned ? t('heatmaps.unpinChartFloat') : t('heatmaps.pinChartAbove')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {pinned ? (
                  /* Unpin icon — pin with slash */
                  <>
                    <line x1="2" y1="2" x2="22" y2="22" />
                    <path d="M12 17v5" />
                    <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V9" />
                    <line x1="8" y1="2" x2="16" y2="2" />
                    <path d="M9 2v4" />
                    <path d="M15 2v4" />
                  </>
                ) : (
                  /* Pin icon */
                  <>
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h-6v4.76Z" />
                    <line x1="8" y1="2" x2="16" y2="2" />
                    <path d="M9 2v4" />
                    <path d="M15 2v4" />
                  </>
                )}
              </svg>
              {pinned ? t('heatmaps.unpin') : t('heatmaps.pin')}
            </button>
          )}
          {/* Compare toggle */}
          <button
            className={`fcw-btn fcw-compare-toggle${compareMode ? ' active' : ''}`}
            onClick={onToggleCompare}
            title={compareMode ? t('heatmaps.singleChart') : t('heatmaps.compareTokens')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            {compareMode ? t('heatmaps.single') : t('heatmaps.compare')}
          </button>
          {compareMode && compareTokens.length >= 2 && (
            <button
              className="fcw-btn fcw-advanced-btn"
              onClick={() => setShowAdvanced(true)}
              title={t('heatmaps.advancedCompareTitle')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              {t('heatmaps.advanced')}
            </button>
          )}
          {!compareMode && onViewToken && (
            <button className="fcw-btn" onClick={onViewToken}>
              {t('heatmaps.viewToken')}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          )}
          <button className="fcw-close" onClick={onClose} title={t('heatmaps.close')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chart body */}
      <div className={`fcw-body${interacting ? ' fcw-body--blocked' : ''}`}>
        {compareMode ? (
          <CompareOverlayChart
            tokens={compareTokens}
            dayMode={dayMode}
          />
        ) : renderSingleChart()}
      </div>

      {/* Resize handles — only when floating (unpinned) */}
      {!pinned && EDGES.map(edge => (
        <div
          key={edge}
          className={`fcw-resize fcw-resize--${edge}`}
          onMouseDown={(e) => handleResizeStart(e, edge)}
        />
      ))}
    </div>
  )

  // Pinned: render inline (no portal). Unpinned: portal to document.body
  return (
    <>
      {pinned ? windowContent : createPortal(windowContent, document.body)}
      {showAdvanced && compareTokens.length >= 2 && (
        <AdvancedCompare
          tokens={compareTokens}
          dayMode={dayMode}
          onClose={() => setShowAdvanced(false)}
          onViewToken={onCompareViewToken}
        />
      )}
    </>
  )
}
