/**
 * Ticking labels. Every age on this page is written through the shared module
 * ticker — ONE interval for the whole page, writing el.textContent, zero React
 * commits while the board sits idle. A 1s `useNow` on a 12-row roster with a
 * 20-row tape is 30+ re-renders a second that produce no DOM change at all.
 */
import { useEffect, useRef } from 'react'
import { registerTick } from '@/lib/module-ticker'
import { fmtAgo } from './arn-format'

export function ArnAge({ at, prefix = '', suffix = '', className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const t = at ? new Date(at).getTime() : NaN
    if (!el) return undefined
    if (!Number.isFinite(t)) { el.textContent = '—'; return undefined }
    return registerTick(el, (now) => `${prefix}${fmtAgo(now - t)}${suffix}`)
  }, [at, prefix, suffix])
  return <span ref={ref} className={className} />
}

export default ArnAge
