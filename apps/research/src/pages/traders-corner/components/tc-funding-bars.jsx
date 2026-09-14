/**
 * Traders Corner — FundingBars mini chart + FC funding cell.
 */
import { useRef, useState, useEffect } from 'react'
import { cx } from './tc-formatters'

export function FundingBars({ data, h = 44 }) {
  const ref = useRef(null)
  const boxRef = useRef(null)
  const [cw, setCw] = useState(300)
  useEffect(() => {
    if (!boxRef.current) return
    const ro = new ResizeObserver(e => setCw(Math.floor(e[0].contentRect.width)))
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!ref.current || !data?.length) return
    const ctx = ref.current.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ref.current.width = cw * dpr; ref.current.height = h * dpr
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, cw, h)
    const max = Math.max(...data.map(d => Math.abs(d.rate)), 0.001)
    const barW = Math.max(2, (cw / data.length) - 1.5)
    const mid = h / 2
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(cw, mid); ctx.stroke()
    data.forEach((d, i) => {
      const x = (i / data.length) * cw
      const barH = Math.max(1, (Math.abs(d.rate) / max) * (mid - 4))
      const radius = Math.min(2, barW / 2)
      ctx.fillStyle = d.rate >= 0 ? 'rgba(239,68,68,0.45)' : 'rgba(16,185,129,0.45)'
      ctx.beginPath()
      if (d.rate >= 0) ctx.roundRect(x, mid - barH, barW, barH, [radius, radius, 0, 0])
      else ctx.roundRect(x, mid, barW, barH, [0, 0, radius, radius])
      ctx.fill()
    })
  }, [data, cw, h])
  return <div ref={boxRef} className="tc-mchart"><canvas ref={ref} style={{ width: '100%', height: h, display: 'block' }} /></div>
}

export function FC({ v, bold }) {
  if (v == null) return <td className="tc-dim">—</td>
  const intensity = Math.min(1, Math.abs(v) / 0.06)
  const bg = v >= 0
    ? `rgba(239,68,68,${0.02 + intensity * 0.15})`
    : `rgba(16,185,129,${0.02 + intensity * 0.15})`
  const color = v >= 0
    ? `rgba(248,113,113,${0.5 + intensity * 0.5})`
    : `rgba(52,211,153,${0.5 + intensity * 0.5})`
  return (
    <td className={cx('tc-fc', bold && 'tc-fc-b')} style={{ background: bg }}>
      <span style={{ color }}>{v >= 0 ? '+' : ''}{v.toFixed(4)}%</span>
    </td>
  )
}
