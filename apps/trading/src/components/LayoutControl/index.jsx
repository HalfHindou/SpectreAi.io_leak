/**
 * LayoutControl - the token page's SINGLE "Customize" hub in the header.
 * One button, one place: page layout (Swap sides / presets / drag editor /
 * Reset) AND appearance (background tone, accents, skins via the
 * AppearanceStudio) all live in this popover, so users discover every
 * customization from one pill. On the token view this REPLACES the separate
 * ToneControl pill (which still serves the other views).
 *
 * Layout state lives in useSettingsStore.tokenLayout (device-local,
 * sanitized on every write by lib/tokenLayout.js). The token page recompiles
 * its grid from the store - sections never re-parent, so switching layouts
 * is instant and the TradingView chart never reloads.
 */
import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { PanelsLeftRight, RotateCcw, Check, SlidersHorizontal, Palette, Eye, EyeOff, ChevronRight } from 'lucide-react'
import useSettingsStore from '../../store/useSettingsStore'
import {
  DEFAULT_TOKEN_LAYOUT,
  LAYOUT_PRESETS,
  sanitizeTokenLayout,
  toggleSectionHidden,
} from '../../lib/tokenLayout'
import './layout-control.css'

// The full appearance surface (skins + accents + tones) - heavy and rarely
// opened, stays off the header chunk until first use. Same module
// ToneControl lazy-loads, so the chunk is shared.
const AppearanceStudio = lazy(() => import('../AppearanceStudio'))

const PRESET_ITEMS = [
  { id: 'default', label: 'Default', hint: 'Watch left · Trade right' },
  { id: 'flipped', label: 'Flipped', hint: 'Trade left · Watch right' },
  { id: 'terminal', label: 'Pro', hint: 'No left side · wide trade' },
  { id: 'focus', label: 'Focus', hint: 'Just chart + transactions' },
]

// Visibility toggles - each maps to a movable section. Order = reading order.
const SECTION_LABELS = [
  { id: 'watch', label: 'Watch / Feed' },
  { id: 'banner', label: 'Token Banner' },
  { id: 'chart', label: 'Chart' },
  { id: 'txns', label: 'Transactions' },
  { id: 'trade', label: 'Buy / Sell' },
]

const layoutKey = (l) => JSON.stringify(sanitizeTokenLayout(l ?? DEFAULT_TOKEN_LAYOUT).zones)
  + JSON.stringify(sanitizeTokenLayout(l ?? DEFAULT_TOKEN_LAYOUT).hidden)

// Tiny at-a-glance diagram of a layout - little blocks in their zones so the
// user SEES what each preset does. Pure derivation from the (sanitized) layout.
function LayoutPreview({ layout }) {
  const l = sanitizeTokenLayout(layout)
  const hidden = new Set(l.hidden)
  const vis = (zone) => l.zones[zone].filter((id) => !hidden.has(id))
  const left = vis('left')
  const center = vis('center')
  const right = vis('right')
  const bottom = vis('bottom')
  const block = (id, extra = '') => <i key={id} className={`lc-mini-b lc-mini-b--${id}${extra}`} />
  const wideRight = l.sizes?.rightW >= 440
  return (
    <span className="lc-mini" aria-hidden="true">
      <span className="lc-mini-cols">
        {left.length > 0 && <span className="lc-mini-rail">{left.map((id) => block(id))}</span>}
        <span className="lc-mini-center">{center.map((id) => block(id, id === 'chart' ? ' is-tall' : ''))}</span>
        {right.length > 0 && <span className={`lc-mini-rail${wideRight ? ' is-wide' : ''}`}>{right.map((id) => block(id))}</span>}
      </span>
      {bottom.length > 0 && <span className="lc-mini-bottom">{bottom.map((id) => block(id))}</span>}
    </span>
  )
}

export default function LayoutControl({ onCustomize }) {
  const tokenLayout = useSettingsStore((s) => s.tokenLayout)
  const setTokenLayout = useSettingsStore((s) => s.setTokenLayout)
  const applyLayoutPreset = useSettingsStore((s) => s.applyLayoutPreset)
  const resetTokenLayout = useSettingsStore((s) => s.resetTokenLayout)

  const [open, setOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const popRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 8, left: Math.max(8, r.left) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const activeKey = layoutKey(tokenLayout)
  const isCustom = !PRESET_ITEMS.some((p) => layoutKey(LAYOUT_PRESETS[p.id]) === activeKey)
  const hiddenSet = new Set(sanitizeTokenLayout(tokenLayout ?? DEFAULT_TOKEN_LAYOUT).hidden)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`layout-control-pill${tokenLayout ? ' is-custom' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Customize - page layout, background and appearance"
        aria-label="Customize page layout and appearance"
        aria-expanded={open}
      >
        <PanelsLeftRight size={13} strokeWidth={2} aria-hidden="true" />
        <span className="layout-control-pill__label">Customize</span>
      </button>

      {open && pos && ReactDOM.createPortal(
        <div className="layout-control-popover" ref={popRef} style={{ top: pos.top, left: pos.left }} role="menu">
          <div className="layout-control-head">
            <PanelsLeftRight size={15} strokeWidth={2} aria-hidden="true" />
            <span>Customize this page</span>
          </div>

          <div className="layout-control-section">
            <div className="layout-control-label">
              <span>Presets</span>
              {isCustom && <span className="layout-control-custom-pill">Custom</span>}
            </div>
            <div className="layout-control-presets">
              {PRESET_ITEMS.map((p) => {
                const active = layoutKey(LAYOUT_PRESETS[p.id]) === activeKey
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`layout-control-preset${active ? ' is-active' : ''}`}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => applyLayoutPreset(p.id)}
                  >
                    <LayoutPreview layout={LAYOUT_PRESETS[p.id]} />
                    <span className="layout-control-preset-meta">
                      <span className="layout-control-preset-label">{p.label}</span>
                      <span className="layout-control-preset-hint">{p.hint}</span>
                    </span>
                    {active && <Check size={12} className="layout-control-check" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
            {typeof onCustomize === 'function' && (
              <button
                type="button"
                className="layout-control-row layout-control-row--cta"
                role="menuitem"
                onClick={() => { setOpen(false); onCustomize() }}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                <span>Rearrange sections</span>
                <ChevronRight size={14} className="layout-control-row-arrow" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="layout-control-section">
            <div className="layout-control-label"><span>Show / hide sections</span></div>
            <div className="layout-control-sections">
              {SECTION_LABELS.map((sec) => {
                const shown = !hiddenSet.has(sec.id)
                return (
                  <button
                    key={sec.id}
                    type="button"
                    className={`layout-control-toggle${shown ? ' is-on' : ''}`}
                    role="menuitemcheckbox"
                    aria-checked={shown}
                    onClick={() => setTokenLayout((l) => toggleSectionHidden(l ?? DEFAULT_TOKEN_LAYOUT, sec.id))}
                  >
                    <span className="layout-control-toggle-label">{sec.label}</span>
                    <span className="layout-control-toggle-eye">
                      {shown ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="layout-control-section">
            <button
              type="button"
              className="layout-control-row"
              role="menuitem"
              onClick={() => { setOpen(false); setStudioOpen(true) }}
            >
              <Palette size={14} aria-hidden="true" />
              <span>Background &amp; appearance</span>
              <ChevronRight size={14} className="layout-control-row-arrow" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="layout-control-row layout-control-row--reset"
              role="menuitem"
              onClick={() => resetTokenLayout()}
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Reset to default</span>
            </button>
          </div>
        </div>,
        document.body
      )}

      {studioOpen && (
        <Suspense fallback={null}>
          <AppearanceStudio onClose={() => setStudioOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
