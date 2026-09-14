import { useEffect } from 'react'

// macOS Dock magnification for the filmstrip. Continuous, distance-based: every
// item gets `--s` (1 → MAX) from a cosine falloff around the pointer, and the
// CSS sizes the item WIDTH from it, so neighbours are pushed apart instead of
// being painted over (the old 3-tier transform version overlapped them).
// Fine-pointer only - touch keeps the plain strip.
const MAX = 1.62 // hovered icon scale
const RADIUS = 2.6 // falloff radius, in base item widths

export default function useDockMagnify(ref, { itemSelector = '.sl-film-item' } = {}) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return undefined
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    let raf = 0
    let px = null
    let inside = false

    const items = () => el.querySelectorAll(itemSelector)
    const baseWidth = () => {
      const v = parseFloat(getComputedStyle(el).getPropertyValue('--dock-w'))
      return Number.isFinite(v) && v > 0 ? v : 58
    }

    const paint = () => {
      raf = 0
      if (px == null) return
      const r = RADIUS * baseWidth()
      let hot = null
      let hotD = Infinity
      for (const it of items()) {
        const b = it.getBoundingClientRect()
        const d = Math.abs(px - (b.left + b.width / 2))
        const k = d >= r ? 0 : Math.cos((d / r) * Math.PI * 0.5)
        const s = 1 + (MAX - 1) * k * k // squared: tight peak, gentle shoulders
        it.style.setProperty('--s', s.toFixed(3))
        it.style.zIndex = s > 1.02 ? String(2 + Math.round(k * 10)) : ''
        if (d < hotD) { hotD = d; hot = it }
      }
      el.classList.toggle('is-magnifying', true)
      for (const it of items()) it.classList.toggle('is-hot', it === hot && hotD < baseWidth() * 0.6)
    }

    const onMove = (e) => {
      px = e.clientX
      if (!inside) { inside = true; el.classList.add('is-magnifying'); el.classList.remove('is-resting') }
      if (!raf) raf = requestAnimationFrame(paint)
    }
    const rest = () => {
      inside = false
      px = null
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      el.classList.remove('is-magnifying')
      el.classList.add('is-resting')
      for (const it of items()) { it.style.removeProperty('--s'); it.style.zIndex = ''; it.classList.remove('is-hot') }
    }
    // A magnified strip re-lays out under the pointer while it scrolls;
    // repaint so the peak stays under the cursor.
    const onScroll = () => { if (inside && !raf) raf = requestAnimationFrame(paint) }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', rest)
    el.addEventListener('pointercancel', rest)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      rest()
      el.classList.remove('is-resting')
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', rest)
      el.removeEventListener('pointercancel', rest)
      el.removeEventListener('scroll', onScroll)
    }
  }, [ref, itemSelector])
}
