/**
 * MobileChartToolbar — compact, desktop-styled chart navigation.
 *
 * Same visual language as the desktop `.chart-controls` bar (mono
 * labels, lock glyphs, dividers, dark pill buttons, white-on-dark
 * active state) but reorganised so it fits a phone:
 *
 *   [TV] | [Types ▾] [Price | MCap] [Tools ▾] | [TF ▾] [⛶]
 *
 * Locked categories (Candles/Line/Holders, ATH/VWAP/Heatmap) move
 * inside their respective dropdowns so the bar stays clean. Each
 * dropdown row keeps the same icon + label + Lock glyph treatment as
 * the desktop button so the user recognises it.
 *
 * Wiring: every action DOM-clicks the corresponding hidden desktop
 * button inside .chart-controls. TradingChart stays unmodified.
 */
import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import {
  ChevronDown,
  Lock,
  Maximize2,
  Minimize2,
  Activity,
  CandlestickChart,
  LineChart as LineChartIcon,
  Users,
  Grid3x3,
  TrendingUp,
  Layers,
} from 'lucide-react'
import './MobileChartToolbar.css'

/* TradingView + Candles + Line are all selectable. Holders stays locked
   (Coming Soon - no holder data yet). The active row is highlighted from
   live chart state (see activeType), not hardcoded to TradingView. */
const TYPE_ITEMS = [
  { key: 'tv',      label: 'TradingView', kind: 'tv',     locked: false, sel: '.tradingview-btn' },
  { key: 'candle',  label: 'Candles',     Icon: CandlestickChart, locked: false, btn: 'Candles' },
  { key: 'line',    label: 'Line',        Icon: LineChartIcon,    locked: false, btn: 'Line' },
  { key: 'holders', label: 'Holders',     Icon: Users,            locked: true, btn: 'Holders' },
]

const LOCKED_TOOLS = [
  { label: 'Heatmap', Icon: Grid3x3,    sel: '.heatmap-btn', locked: true },
  { label: 'ATH',     Icon: TrendingUp, sel: '.ath-btn',     locked: true },
  { label: 'VWAP',    Icon: Layers,     sel: '.vwap-btn',    locked: true },
]

const TOOLS_ALL_LOCKED = LOCKED_TOOLS.every((t) => t.locked)

/* Menu widths (min-width in MobileChartToolbar.css + the Lock glyph gutter).
   Used to keep a portal'd popover inside the viewport on both edges. */
const TYPES_MENU_W = 176
const TOOLS_MENU_W = 160
const EDGE_GAP = 8

export function clampLeft(left, width) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const max = Math.max(EDGE_GAP, vw - width - EDGE_GAP)
  return Math.max(EDGE_GAP, Math.min(max, left))
}

export function readActiveTimeframe(chartRoot) {
  const active = chartRoot?.querySelector?.('.tf-btn.active')
  return active?.textContent?.trim() || '1H'
}

/* Which chart TYPE is live, read from the hidden desktop .chart-controls.
   Returns a TYPE_ITEMS key ('tv' | 'candle' | 'line' | 'holders'). The desktop
   TradingView button is `.type-btn.tradingview-btn`; Candles/Line are plain
   `.type-btn`s distinguished by their `title`. Whichever carries `.active` wins;
   defaults to 'tv' (the chart's own default) when nothing is resolvable yet. */
function readActiveType(chartRoot) {
  if (!chartRoot) return 'tv'
  if (chartRoot.querySelector('.tradingview-btn.active')) return 'tv'
  const activeType = chartRoot.querySelector('.chart-types .type-btn.active')
  const title = (activeType?.getAttribute('title') || '').toLowerCase()
  if (title.includes('candle')) return 'candle'
  if (title.includes('line')) return 'line'
  if (title.includes('holder')) return 'holders'
  // No .active type-btn found but TV isn't active either -> the native canvas
  // chart is showing. Fall back to its label if present, else assume candles.
  if (activeType) {
    const label = activeType.querySelector('.type-label')?.textContent?.trim().toLowerCase()
    if (label === 'line') return 'line'
    if (label === 'holders') return 'holders'
    return 'candle'
  }
  return 'tv'
}

export function clickTfButton(chartRoot, tf) {
  if (!chartRoot) return false
  // The desktop row carries BOTH '1m' (minute) and '1M' (month), so an
  // uppercase compare sends 1M to the 1m button. Exact match wins first;
  // the case-insensitive pass stays as a fallback for label drift.
  // `.tf-more-trigger` is itself a .tf-btn whose label becomes the selected
  // dropdown timeframe - matching it would just toggle that menu, so skip it
  // here and let the dedicated more-trigger branch below handle those.
  const buttons = Array.from(chartRoot.querySelectorAll('.tf-btn'))
    .filter((b) => !b.classList.contains('tf-more-trigger'))
  for (const btn of buttons) {
    if (btn.textContent?.trim() === tf) {
      btn.click()
      return true
    }
  }
  for (const btn of buttons) {
    if (btn.textContent?.trim().toUpperCase() === tf.toUpperCase()) {
      btn.click()
      return true
    }
  }
  const more = chartRoot.querySelector('.tf-more-trigger')
  if (more) {
    more.click()
    requestAnimationFrame(() => {
      const portalBtns = document.querySelectorAll('.tf-dropdown-menu button')
      for (const btn of portalBtns) {
        if (btn.textContent?.trim().toUpperCase() === tf.toUpperCase()) {
          btn.click()
          break
        }
      }
    })
    return true
  }
  return false
}

function clickByText(chartRoot, label) {
  if (!chartRoot) return false
  const buttons = chartRoot.querySelectorAll('button')
  for (const btn of buttons) {
    if (btn.textContent?.trim() === label) { btn.click(); return true }
  }
  return false
}

/* Y-axis mode from the desktop .price-mcap-toggle: 'price' | 'mcap'. */
function readAxisMode(chartRoot) {
  const active = chartRoot?.querySelector?.('.price-mcap-toggle .toggle-btn.active')
  return active?.textContent?.trim().toLowerCase() === 'mcap' ? 'mcap' : 'price'
}

function clickAxisMode(chartRoot, mode) {
  const buttons = chartRoot?.querySelectorAll?.('.price-mcap-toggle .toggle-btn') || []
  for (const btn of buttons) {
    if (btn.textContent?.trim().toLowerCase() === mode) { btn.click(); return true }
  }
  return false
}

function clickSelector(chartRoot, selector) {
  if (!chartRoot) return false
  const el = chartRoot.querySelector(selector)
  el?.click()
  return !!el
}

export default function MobileChartToolbar({ chartRootRef, isFullscreen = false, onToggleFullscreen }) {
  const [typesOpen, setTypesOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [activeType, setActiveType] = useState('tv') // tv | candle | line | holders
  const [axisMode, setAxisMode] = useState('price') // price | mcap

  const wrapRef = useRef(null)
  const typesBtnRef = useRef(null)
  const toolsBtnRef = useRef(null)

  const [typesPos, setTypesPos] = useState({ top: 0, left: 0 })
  const [toolsPos, setToolsPos] = useState({ top: 0, left: 0 })

  // Keep the active chart-type highlight in sync with the hidden desktop
  // .chart-controls bar. (Timeframe sync moved to MobileTimeframeRow.)
  useEffect(() => {
    const sync = () => {
      const root = chartRootRef?.current
      const nextType = readActiveType(root)
      if (nextType && nextType !== activeType) setActiveType(nextType)
      const nextAxis = readAxisMode(root)
      if (nextAxis !== axisMode) setAxisMode(nextAxis)
    }
    sync()
    // Reading the chart's DOM every 800ms forever is only worth paying for
    // while the user can see the toolbar; a hidden tab re-syncs on the next
    // tick anyway (and on the sync() above when the effect re-runs).
    const id = setInterval(() => { if (!document.hidden) sync() }, 800)
    return () => clearInterval(id)
  }, [chartRootRef, activeType, axisMode])

  const handleAxisToggle = () => {
    const next = axisMode === 'mcap' ? 'price' : 'mcap'
    setAxisMode(next) // optimistic; poll reconciles
    clickAxisMode(chartRootRef?.current, next)
  }

  // Close any open menu on outside click.
  useEffect(() => {
    if (!typesOpen && !toolsOpen) return
    const onDown = (e) => {
      const insideWrap = wrapRef.current?.contains(e.target)
      const insidePortal = e.target?.closest?.('.mct-dropdown')
      if (!insideWrap && !insidePortal) {
        setTypesOpen(false); setToolsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [typesOpen, toolsOpen])

  const openTypes = () => {
    setToolsOpen(false)
    if (typesBtnRef.current) {
      const r = typesBtnRef.current.getBoundingClientRect()
      // Types sits far right on a phone bar - unclamped `left: r.left` ran the
      // 170px panel off the right edge (the labels were cut in half).
      setTypesPos({ top: r.bottom + 6, left: clampLeft(r.left, TYPES_MENU_W) })
    }
    setTypesOpen((v) => !v)
  }

  const openTools = () => {
    setTypesOpen(false)
    if (toolsBtnRef.current) {
      const r = toolsBtnRef.current.getBoundingClientRect()
      setToolsPos({
        top: r.bottom + 6,
        left: clampLeft(r.left - 40, TOOLS_MENU_W),
      })
    }
    setToolsOpen((v) => !v)
  }

  return (
    <div className="mct" ref={wrapRef}>
      {/* Price/MCap y-axis toggle — GMGN keeps it next to the TF row. */}
      <button
        type="button"
        className="mct-axis"
        onClick={handleAxisToggle}
        aria-label={`Y axis: ${axisMode === 'mcap' ? 'market cap' : 'price'}. Tap to switch.`}
      >
        <span className={axisMode === 'mcap' ? 'is-on' : ''}>MCap</span>
        <span className="mct-axis-sep">/</span>
        <span className={axisMode === 'price' ? 'is-on' : ''}>Price</span>
      </button>

      {/* Types dropdown — TradingView (active) + Candles / Line / Holders (locked). */}
      <button
        ref={typesBtnRef}
        type="button"
        className={`mct-btn mct-btn--group ${typesOpen ? 'is-open' : ''}`}
        onClick={openTypes}
        aria-haspopup="menu"
        aria-expanded={typesOpen}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
          <path d="M15.8654 8.2789c0 1.3541 -1.0978 2.4519 -2.452 2.4519 -1.354 0 -2.4519 -1.0978 -2.4519 -2.452 0 -1.354 1.0978 -2.4518 2.452 -2.4518 1.3541 0 2.4519 1.0977 2.4519 2.4519zM9.75 6H0v4.9038h4.8462v7.2692H9.75Zm8.5962 0H24l-5.1058 12.173h-5.6538z" />
        </svg>
        <span className="mct-btn-label">
          {activeType === 'tv' ? 'TV' : activeType === 'candle' ? 'Candles' : activeType === 'line' ? 'Line' : 'Types'}
        </span>
        <ChevronDown size={12} strokeWidth={2.2} className="mct-btn-caret" />
      </button>

      {/* Tools dropdown — ATH / VWAP / Heatmap (all locked). Icon-only
          trigger so the bar stays compact next to the toggle. */}
      {!TOOLS_ALL_LOCKED && (
      <button
        ref={toolsBtnRef}
        type="button"
        className={`mct-btn mct-btn--group mct-btn--tools ${toolsOpen ? 'is-open' : ''}`}
        onClick={openTools}
        aria-haspopup="menu"
        aria-expanded={toolsOpen}
        aria-label="Tools (Heatmap, ATH, VWAP)"
        title="Tools"
      >
        <Activity size={14} strokeWidth={2} />
        <ChevronDown size={12} strokeWidth={2.2} className="mct-btn-caret" />
      </button>
      )}

      <span className="mct-divider mct-divider--push" aria-hidden="true" />

      {/* Fullscreen */}
      <button
        type="button"
        className={`mct-btn mct-btn--icon ${isFullscreen ? 'is-open' : ''}`}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen chart'}
        aria-label={isFullscreen ? 'Exit fullscreen chart' : 'Fullscreen chart'}
        aria-pressed={isFullscreen}
        onClick={onToggleFullscreen}
      >
        {isFullscreen
          ? <Minimize2 size={14} strokeWidth={2.2} />
          : <Maximize2 size={14} strokeWidth={2.2} />}
      </button>

      {/* ── Types dropdown ─────────────────── */}
      {typesOpen && ReactDOM.createPortal(
        <div
          className="mct-dropdown"
          role="menu"
          style={{ position: 'fixed', top: typesPos.top, left: typesPos.left }}
        >
          {TYPE_ITEMS.map((item) => {
            const isTv = item.kind === 'tv'
            // Highlight the row that matches the LIVE chart type (synced from the
            // hidden desktop controls), not a hardcoded default.
            const isActive = item.key === activeType
            const cls = [
              'mct-dropdown-row',
              item.locked ? 'is-locked' : '',
              isActive ? 'is-active' : '',
            ].filter(Boolean).join(' ')
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                aria-selected={isActive ? true : undefined}
                className={cls}
                onClick={() => {
                  if (item.locked) {
                    // Locked rows (Holders) trigger the desktop "Coming Soon"
                    // toast via the matching button; don't change the highlight.
                    clickByText(chartRootRef?.current, item.btn)
                    setTypesOpen(false)
                    return
                  }
                  if (isTv) clickSelector(chartRootRef?.current, item.sel)
                  else clickByText(chartRootRef?.current, item.btn)
                  setActiveType(item.key) // optimistic; poll reconciles in <=800ms
                  setTypesOpen(false)
                }}
              >
                {isTv ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="14"
                    height="14"
                    aria-hidden="true"
                    className="mct-dropdown-row-icon"
                  >
                    <path d="M15.8654 8.2789c0 1.3541 -1.0978 2.4519 -2.452 2.4519 -1.354 0 -2.4519 -1.0978 -2.4519 -2.452 0 -1.354 1.0978 -2.4518 2.452 -2.4518 1.3541 0 2.4519 1.0977 2.4519 2.4519zM9.75 6H0v4.9038h4.8462v7.2692H9.75Zm8.5962 0H24l-5.1058 12.173h-5.6538z" />
                  </svg>
                ) : (
                  <item.Icon size={14} strokeWidth={2} className="mct-dropdown-row-icon" />
                )}
                <span className="mct-dropdown-row-label">{item.label}</span>
                {item.locked && (
                  <Lock size={10} strokeWidth={2.4} className="mct-dropdown-row-lock" />
                )}
              </button>
            )
          })}
        </div>,
        document.body,
      )}

      {/* ── Tools dropdown ─────────────────── */}
      {toolsOpen && ReactDOM.createPortal(
        <div
          className="mct-dropdown"
          role="menu"
          style={{ position: 'fixed', top: toolsPos.top, left: toolsPos.left }}
        >
          {LOCKED_TOOLS.map(({ label, Icon, sel }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="mct-dropdown-row is-locked"
              onClick={() => { clickSelector(chartRootRef?.current, sel); setToolsOpen(false) }}
            >
              <Icon size={14} strokeWidth={2} className="mct-dropdown-row-icon" />
              <span className="mct-dropdown-row-label">{label}</span>
              <Lock size={10} strokeWidth={2.4} className="mct-dropdown-row-lock" />
            </button>
          ))}
        </div>,
        document.body,
      )}

    </div>
  )
}
