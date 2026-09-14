/**
 * RangeSlider — brush-style range selector for chart viewport.
 * Controlled component. Value is a normalized { start, end } in [0,1].
 *
 * Interactions:
 *   - Drag left handle  → resize window from left
 *   - Drag right handle → resize window from right
 *   - Drag window body  → pan window (preserving width)
 *   - Double-click      → reset to { start: 0, end: 1 }
 *
 * Props:
 *   value:    { start, end }
 *   onChange: (next) => void
 *   min:      minimum window width (default 0.02 — 2% of range)
 *   ticks:    number - decorative tick count (default 60)
 *   labels:   Array<{ pos: number, text: string }> - optional date labels 0..1
 */
import { useCallback, useEffect, useRef } from 'react'

const MIN_WINDOW = 0.02

export default function RangeSlider({
  value,
  onChange,
  min = MIN_WINDOW,
  ticks = 60,
  labels = [],
}) {
  const trackRef = useRef(null)
  const dragRef = useRef(null) // { mode: 'left'|'right'|'pan', startX, startStart, startEnd }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  const onPointerMove = useCallback((e) => {
    const s = dragRef.current
    if (!s) return
    const dx = (e.clientX - s.startX) / s.trackWidth
    let nextStart = s.startStart
    let nextEnd = s.startEnd
    if (s.mode === 'left') {
      nextStart = clamp(s.startStart + dx, 0, s.startEnd - min)
    } else if (s.mode === 'right') {
      nextEnd = clamp(s.startEnd + dx, s.startStart + min, 1)
    } else {
      const width = s.startEnd - s.startStart
      let ns = clamp(s.startStart + dx, 0, 1 - width)
      nextStart = ns
      nextEnd = ns + width
    }
    onChange({ start: nextStart, end: nextEnd })
  }, [min, onChange])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
  }, [onPointerMove])

  const onPointerDown = (mode) => (e) => {
    e.preventDefault()
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    dragRef.current = {
      mode,
      trackLeft: rect.left,
      trackWidth: rect.width,
      startX: e.clientX,
      startStart: value.start,
      startEnd: value.end,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  const onDoubleClick = () => onChange({ start: 0, end: 1 })

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
  }, [onPointerMove])

  const leftPct = `${value.start * 100}%`
  const widthPct = `${(value.end - value.start) * 100}%`

  return (
    <div className="embed-slider">
      <div
        ref={trackRef}
        className="embed-slider-track"
        onDoubleClick={onDoubleClick}
      >
        <div className="embed-slider-ticks" aria-hidden>
          {Array.from({ length: ticks }).map((_, i) => (
            <span key={i} className="embed-slider-tick" style={{ left: `${(i / (ticks - 1)) * 100}%` }} />
          ))}
        </div>
        <div
          className="embed-slider-window"
          style={{ left: leftPct, width: widthPct }}
          onPointerDown={onPointerDown('pan')}
        >
          <span
            className="embed-slider-handle embed-slider-handle--left"
            onPointerDown={(e) => { e.stopPropagation(); onPointerDown('left')(e) }}
            aria-label="Resize window from left"
          />
          <span
            className="embed-slider-handle embed-slider-handle--right"
            onPointerDown={(e) => { e.stopPropagation(); onPointerDown('right')(e) }}
            aria-label="Resize window from right"
          />
        </div>
      </div>
      {labels.length > 0 ? (
        <div className="embed-slider-labels mono">
          {labels.map((l, i) => (
            <span key={i} className="embed-slider-label" style={{ left: `${l.pos * 100}%` }}>{l.text}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
