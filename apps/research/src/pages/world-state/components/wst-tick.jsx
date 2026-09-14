/**
 * Live text labels — ages and countdowns.
 *
 * Both write through the shared module-ticker registry, which owns ONE
 * interval for the whole page and assigns el.textContent only when the
 * formatted string actually changed. No setState, no rAF, nothing re-renders
 * while a countdown runs, and the interval stops entirely while the tab is
 * hidden. A `useNow()` hook here would commit once a second for the life of
 * the page to move two labels.
 */
import React, { useEffect, useRef } from 'react'
import { registerTick } from '@/lib/module-ticker'
import { fmtAgo } from './wst-format'

/** `4h ago` since a fixed epoch ms. */
export function Ago({ from, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !Number.isFinite(from)) return undefined
    return registerTick(el, (now) => fmtAgo(now - from) ?? '—')
  }, [from])
  return <span ref={ref} className={`wst-num${className ? ` ${className}` : ''}`} />
}

/** `34d 5h`, dropping to `12m 04s` inside the last hour. */
export function fmtCountdown(ms) {
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return 'under way'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (s < 3600) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${m}m`
}

export function Countdown({ to, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const t = Date.parse(to)
    if (!el || !Number.isFinite(t)) return undefined
    return registerTick(el, (now) => fmtCountdown(t - now))
  }, [to])
  return <span ref={ref} className={`wst-num${className ? ` ${className}` : ''}`} />
}
