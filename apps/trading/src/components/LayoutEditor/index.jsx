/**
 * LayoutEditor - "Customize layout" mode for the token page (Zone Stacks).
 *
 * A full-viewport scrim captures EVERY pointer event (the TradingView iframe
 * can never steal a drag), with a chip overlaid on each visible section.
 * Drag a chip (pointer capture, 4px threshold - SpectreAgentPanel pattern):
 * a ghost card follows the cursor and legal drop slots light up; releasing
 * over a slot commits `moveSection` to the store, the grid recompiles and
 * sections SNAP into place (no FLIP - transient transforms on section
 * wrappers create containing blocks that break DataTabs' portals).
 * The real sections never re-parent, so the chart survives every move.
 *
 * Chips also carry a hide toggle (hideable sections) and the footer offers
 * presets / hidden-section restore / Reset / Done. Esc exits.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { GripHorizontal, GripVertical, X, Eye, EyeOff, RotateCcw } from 'lucide-react'
import useSettingsStore from '../../store/useSettingsStore'
import {
  DEFAULT_TOKEN_LAYOUT,
  LAYOUT_PRESETS,
  SECTION_IDS,
  WIDE_SECTIONS,
  HIDEABLE,
  ZONE_IDS,
  sanitizeTokenLayout,
  moveSection,
  swapSection,
  toggleSectionHidden,
  reorderPanelPart,
  togglePanelPart,
} from '../../lib/tokenLayout'
import './layout-editor.css'

const SECTION_LABELS = {
  watch: 'Watch / Feed',
  banner: 'Token Banner',
  chart: 'Chart',
  txns: 'Transactions',
  trade: 'Buy / Sell',
}

// Sub-part labels for the two rail panels (watch, trade).
const PART_LABELS = {
  feed: 'X / Watchlist', screener: 'Trending / Coins',
  overview: 'Overview', swap: 'Buy / Sell', volume: 'Volume', security: 'Security',
}

const PRESET_ITEMS = [
  { id: 'default', label: 'Default' },
  { id: 'flipped', label: 'Flipped' },
  { id: 'terminal', label: 'Pro' },
  { id: 'focus', label: 'Focus' },
]

const DRAG_THRESHOLD = 4
const SLOT_SNAP_DIST = 120 // px - nearest slot within this range highlights

export default function LayoutEditor({ onClose }) {
  const tokenLayout = useSettingsStore((s) => s.tokenLayout)
  const setTokenLayout = useSettingsStore((s) => s.setTokenLayout)
  const applyLayoutPreset = useSettingsStore((s) => s.applyLayoutPreset)
  const resetTokenLayout = useSettingsStore((s) => s.resetTokenLayout)
  const layout = sanitizeTokenLayout(tokenLayout || DEFAULT_TOKEN_LAYOUT)

  const [rects, setRects] = useState({})       // sectionId -> DOMRect-ish
  const [partRects, setPartRects] = useState({}) // `${panel}:${partId}` -> rect
  const [slots, setSlots] = useState(null)     // active drag: [{zone, index, x, y, w, h}]
  const [dragId, setDragId] = useState(null)
  const [partDrag, setPartDrag] = useState(null) // { panel, partId } while dragging a sub-part
  const ghostRef = useRef(null)
  const slotElsRef = useRef([])
  const activeSlotRef = useRef(-1)

  // ---- measurement ----------------------------------------------------
  const measure = useCallback(() => {
    const next = {}
    for (const id of SECTION_IDS) {
      const el = document.querySelector(`.main-layout > [data-section="${id}"]`)
      if (!el || el.style.display === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      next[id] = { x: r.left, y: r.top, w: r.width, h: r.height }
    }
    setRects(next)
    // Sub-parts inside the two rail panels (watch=.lp-part, trade=.rp-part).
    const parts = {}
    const scan = (panel, sel) => {
      const host = document.querySelector(`.main-layout > [data-section="${panel}"]`)
      if (!host || host.style.display === 'none') return
      host.querySelectorAll(sel).forEach((el) => {
        if (el.style.display === 'none') return
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) return
        parts[`${panel}:${el.dataset.part}`] = { panel, partId: el.dataset.part, x: r.left, y: r.top, w: r.width, h: r.height }
      })
    }
    scan('watch', '.lp-part')
    scan('trade', '.rp-part')
    setPartRects(parts)
  }, [])

  useEffect(() => {
    measure()
    // Re-measure after the grid settles on every layout change + viewport moves.
    const t = setTimeout(measure, 260)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure, tokenLayout])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // ---- drop-slot computation ------------------------------------------
  // Whole-section SWAP model: dropping the dragged section onto ANY other
  // visible section swaps the two (big, easy targets - no thin insert lines).
  // Plus an empty-side strip and a bottom band for moving into those zones.
  const computeSlots = useCallback((sectionId) => {
    const main = document.querySelector('.main-layout')
    if (!main) return []
    const mr = main.getBoundingClientRect()
    const out = []
    const isWide = WIDE_SECTIONS.has(sectionId)
    const zoneOf = (id) => ZONE_IDS.find((z) => layout.zones[z].includes(id))
    const from = zoneOf(sectionId)
    const isRail = (z) => z === 'left' || z === 'right'

    // 1. Swap targets - every OTHER visible section this drag can legally swap
    //    with (a wide section can never land in a rail, and vice versa).
    for (const [id, r] of Object.entries(rects)) {
      if (id === sectionId) continue
      const zTarget = zoneOf(id)
      if (isWide && isRail(zTarget)) continue
      if (WIDE_SECTIONS.has(id) && isRail(from)) continue
      out.push({ kind: 'swap', swapWith: id, x: r.x, y: r.y, w: r.w, h: r.h })
    }

    // 2. Empty side (rail-capable sections only) - drop into a bare left/right.
    if (!isWide) {
      for (const zone of ['left', 'right']) {
        if (from === zone) continue
        const occupant = layout.zones[zone].find((id) => !layout.hidden.includes(id))
        if (occupant) continue // occupied side is a swap target (1) above
        const x = zone === 'left' ? mr.left : mr.right - 56
        out.push({ kind: 'rail', zone, index: 0, x, y: mr.top + 8, w: 56, h: Math.min(mr.height - 16, window.innerHeight - mr.top - 24) })
      }
    }

    // 3. Bottom band.
    const visBottom = layout.zones.bottom.filter((id) => !layout.hidden.includes(id))
    if (from !== 'bottom' || visBottom.length > 1) {
      const bottoms = visBottom.filter((id) => rects[id])
      const lastRect = bottoms.length ? rects[bottoms[bottoms.length - 1]] : null
      const y = lastRect ? lastRect.y + lastRect.h : Math.max(...Object.values(rects).map((r) => r.y + r.h), mr.top)
      out.push({ kind: 'band', zone: 'bottom', index: layout.zones.bottom.length, x: mr.left + 16, y: Math.min(y + 4, window.innerHeight - 48), w: mr.width - 32, h: 36 })
    }
    return out
  }, [layout, rects])

  // ---- chip drag -------------------------------------------------------
  const onChipPointerDown = useCallback((e, sectionId) => {
    if (e.button !== 0) return
    e.preventDefault()
    const chip = e.currentTarget
    chip.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    let mySlots = []

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
        dragging = true
        mySlots = computeSlots(sectionId)
        setSlots(mySlots)
        setDragId(sectionId)
      }
      // Ghost follows the pointer - direct DOM, zero React work per move.
      const g = ghostRef.current
      if (g) {
        g.style.transform = `translate3d(${ev.clientX + 14}px, ${ev.clientY + 10}px, 0)`
        g.style.opacity = '1'
      }
      // Highlight nearest legal slot within range.
      let best = -1
      let bestD = SLOT_SNAP_DIST
      mySlots.forEach((s, i) => {
        const cx = s.x + s.w / 2
        const cy = s.y + s.h / 2
        // Distance to the slot RECT (not center) so long strips are easy targets.
        const dx = Math.max(s.x - ev.clientX, 0, ev.clientX - (s.x + s.w))
        const dy = Math.max(s.y - ev.clientY, 0, ev.clientY - (s.y + s.h))
        const d = Math.hypot(dx, dy) || Math.hypot(cx - ev.clientX, cy - ev.clientY) * 0.001
        if (d < bestD) { bestD = d; best = i }
      })
      if (best !== activeSlotRef.current) {
        slotElsRef.current.forEach((el, i) => el?.classList.toggle('is-active', i === best))
        activeSlotRef.current = best
      }
    }

    const onUp = () => {
      chip.removeEventListener('pointermove', onMove)
      chip.removeEventListener('pointerup', onUp)
      chip.removeEventListener('pointercancel', onUp)
      const idx = activeSlotRef.current
      const slot = dragging && idx >= 0 ? mySlots[idx] : null
      activeSlotRef.current = -1
      setSlots(null)
      setDragId(null)
      if (slot) {
        if (slot.kind === 'swap') {
          setTokenLayout((l) => swapSection(l || DEFAULT_TOKEN_LAYOUT, sectionId, slot.swapWith))
        } else {
          setTokenLayout((l) => moveSection(l || DEFAULT_TOKEN_LAYOUT, sectionId, slot.zone, slot.index))
        }
      }
    }

    chip.addEventListener('pointermove', onMove)
    chip.addEventListener('pointerup', onUp)
    chip.addEventListener('pointercancel', onUp)
  }, [computeSlots, setTokenLayout])

  // ---- sub-part drag (reorder within a rail panel) --------------------
  // Parts stack vertically, so drop slots are horizontal lines between the
  // panel's visible siblings. Dropping commits reorderPanelPart(toIndex).
  const onPartPointerDown = useCallback((e, panel, partId) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    let mySlots = []

    const buildSlots = () => {
      const cfg = layout.parts[panel]
      const order = cfg.order.filter((id) => !cfg.hidden.includes(id))
      const siblingRects = order.map((id) => partRects[`${panel}:${id}`]).filter(Boolean)
      if (!siblingRects.length) return []
      const x = siblingRects[0].x
      const w = siblingRects[0].w
      const out = []
      const selfIdx = order.indexOf(partId)
      // A line above the first sibling, then below each sibling.
      const lines = [siblingRects[0].y, ...siblingRects.map((r) => r.y + r.h)]
      lines.forEach((y, i) => {
        // Skip the two no-op slots that bracket the dragged part.
        if (i === selfIdx || i === selfIdx + 1) return
        // toIndex in the WITHOUT-self list: dropping at line i means before
        // sibling i; after removing self, indices past self shift down by one.
        const toIndex = i > selfIdx ? i - 1 : i
        out.push({ x, y: y - 5, w, h: 10, toIndex })
      })
      return out
    }

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
        dragging = true
        mySlots = buildSlots()
        setSlots(mySlots.map((s, i) => ({ ...s, _part: i, kind: 'line' })))
        setPartDrag({ panel, partId })
      }
      const g = ghostRef.current
      if (g) {
        g.style.transform = `translate3d(${ev.clientX + 14}px, ${ev.clientY + 10}px, 0)`
        g.style.opacity = '1'
      }
      let best = -1
      let bestD = SLOT_SNAP_DIST
      mySlots.forEach((s, i) => {
        const dx = Math.max(s.x - ev.clientX, 0, ev.clientX - (s.x + s.w))
        const dy = Math.max(s.y - ev.clientY, 0, ev.clientY - (s.y + s.h))
        const d = Math.hypot(dx, dy)
        if (d < bestD) { bestD = d; best = i }
      })
      if (best !== activeSlotRef.current) {
        slotElsRef.current.forEach((el, i) => el?.classList.toggle('is-active', i === best))
        activeSlotRef.current = best
      }
    }

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      const idx = activeSlotRef.current
      const slot = dragging && idx >= 0 ? mySlots[idx] : null
      activeSlotRef.current = -1
      setSlots(null)
      setPartDrag(null)
      if (slot) {
        setTokenLayout((l) => reorderPanelPart(l || DEFAULT_TOKEN_LAYOUT, panel, partId, slot.toIndex))
      }
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }, [layout, partRects, setTokenLayout])

  const hiddenSections = layout.hidden
  const hiddenParts = ['watch', 'trade'].flatMap((panel) =>
    (layout.parts[panel]?.hidden || []).map((partId) => ({ panel, partId }))
  )
  const zoneBadge = (id) => {
    const z = ZONE_IDS.find((zz) => layout.zones[zz].includes(id))
    return z === 'left' ? 'Left side' : z === 'right' ? 'Right side' : z === 'bottom' ? 'Bottom' : 'Center'
  }

  return ReactDOM.createPortal(
    <div className="layout-editor" role="dialog" aria-label="Customize token page layout">
      {/* Scrim - blocks clicks on the underlying content (so nothing is
          accidentally traded/zoomed in edit mode) but FORWARDS wheel + touch
          scroll to the page, so the user can scroll down to reach sections /
          panel parts that sit below the fold (Volume, Security, ...). Chips
          reposition via the scroll-driven re-measure. */}
      <div
        className="layout-editor__scrim"
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
        onWheel={(e) => {
          // The token page scrolls its `.app` container (NOT the window), so
          // forward the wheel delta there. Re-measure keeps chips on their
          // blocks as the page moves.
          const sc = document.querySelector('.app') || document.scrollingElement
          if (sc) { sc.scrollTop += e.deltaY; sc.scrollLeft += e.deltaX }
        }}
      />

      {/* Section chips */}
      {Object.entries(rects).map(([id, r]) => (
        <div
          key={id}
          className={`layout-editor__chip${dragId === id ? ' is-dragging' : ''}`}
          style={{ left: r.x + r.w / 2, top: Math.max(64, r.y + 14) }}
          onPointerDown={(e) => onChipPointerDown(e, id)}
        >
          <GripHorizontal size={13} aria-hidden="true" />
          <span>{SECTION_LABELS[id] || id}</span>
          <span className="layout-editor__chip-zone">{zoneBadge(id)}</span>
          {HIDEABLE.has(id) && (
            <button
              type="button"
              className="layout-editor__chip-hide"
              title="Hide section"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setTokenLayout((l) => toggleSectionHidden(l || DEFAULT_TOKEN_LAYOUT, id))}
            >
              <EyeOff size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}

      {/* Section outline highlights */}
      {Object.entries(rects).map(([id, r]) => (
        <div
          key={`o-${id}`}
          className={`layout-editor__outline${dragId === id ? ' is-dragging' : ''}`}
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        />
      ))}

      {/* Draggable sub-part handles - one grip chip pinned to each visible
          rail sub-part block. Grab and drop between siblings to reorder;
          the eye hides. Hidden while a whole section is being dragged. */}
      {!dragId && Object.values(partRects).map(({ panel, partId, x, y, w, h }) => {
        const shown = !layout.parts[panel].hidden.includes(partId)
        return (
          <div
            key={`part-${panel}-${partId}`}
            className={`layout-editor__part-handle${partDrag && partDrag.panel === panel && partDrag.partId === partId ? ' is-dragging' : ''}`}
            style={{ left: x + 8, top: y + 8 }}
          >
            <button
              type="button"
              className="layout-editor__part-grip"
              title="Drag to reorder"
              onPointerDown={(e) => onPartPointerDown(e, panel, partId)}
            >
              <GripVertical size={13} aria-hidden="true" />
              <span>{PART_LABELS[partId] || partId}</span>
            </button>
            <button
              type="button"
              className="layout-editor__part-eye"
              title={shown ? 'Hide' : 'Show'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setTokenLayout((l) => togglePanelPart(l || DEFAULT_TOKEN_LAYOUT, panel, partId))}
            >
              <EyeOff size={12} aria-hidden="true" />
            </button>
          </div>
        )
      })}
      {/* Outline each visible sub-part block so its bounds read during a part drag. */}
      {partDrag && Object.values(partRects)
        .filter((p) => p.panel === partDrag.panel)
        .map(({ panel, partId, x, y, w, h }) => (
          <div
            key={`po-${panel}-${partId}`}
            className={`layout-editor__part-outline${partDrag.partId === partId ? ' is-dragging' : ''}`}
            style={{ left: x, top: y, width: w, height: h }}
          />
        ))}

      {/* Drop slots (only while dragging) */}
      {slots?.map((s, i) => (
        <div
          key={`s-${i}`}
          ref={(el) => { slotElsRef.current[i] = el }}
          className={`layout-editor__slot layout-editor__slot--${s.kind}`}
          style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
        >
          {s.kind === 'swap' && <span>Swap with {SECTION_LABELS[s.swapWith] || s.swapWith}</span>}
          {s.kind === 'rail' && <span>{s.zone === 'left' ? 'Left side' : 'Right side'}</span>}
          {s.kind === 'band' && <span>Bottom</span>}
        </div>
      ))}

      {/* Drag ghost */}
      <div ref={ghostRef} className="layout-editor__ghost">
        {dragId ? SECTION_LABELS[dragId] : partDrag ? (PART_LABELS[partDrag.partId] || partDrag.partId) : ''}
      </div>

      {/* Footer bar */}
      <div className="layout-editor__bar">
        <span className="layout-editor__bar-title">Customize layout</span>
        <span className="layout-editor__bar-hint">Drag any section or panel part to where you want it</span>
        <div className="layout-editor__bar-presets">
          {PRESET_ITEMS.map((p) => (
            <button key={p.id} type="button" className="layout-editor__bar-preset" onClick={() => applyLayoutPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {(hiddenSections.length > 0 || hiddenParts.length > 0) && (
          <div className="layout-editor__bar-hidden">
            {hiddenSections.map((id) => (
              <button
                key={id}
                type="button"
                className="layout-editor__bar-restore"
                title="Show section"
                onClick={() => setTokenLayout((l) => toggleSectionHidden(l || DEFAULT_TOKEN_LAYOUT, id))}
              >
                <Eye size={11} aria-hidden="true" />
                {SECTION_LABELS[id]}
              </button>
            ))}
            {hiddenParts.map(({ panel, partId }) => (
              <button
                key={`${panel}:${partId}`}
                type="button"
                className="layout-editor__bar-restore"
                title="Show part"
                onClick={() => setTokenLayout((l) => togglePanelPart(l || DEFAULT_TOKEN_LAYOUT, panel, partId))}
              >
                <Eye size={11} aria-hidden="true" />
                {PART_LABELS[partId] || partId}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="layout-editor__bar-reset" onClick={() => resetTokenLayout()}>
          <RotateCcw size={12} aria-hidden="true" />
          Reset
        </button>
        <button type="button" className="layout-editor__bar-done" onClick={() => onClose?.()}>
          <X size={13} aria-hidden="true" />
          Done
        </button>
      </div>
    </div>,
    document.body
  )
}
