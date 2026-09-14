/**
 * Traders Corner — inline sparkline canvas and token logo.
 */
import { useRef, useEffect } from 'react'
import { COINGECKO_LOGOS } from '@/constants/majorTokens'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'

export function Tk({ s, sz = 18 }) {
  const src = COINGECKO_LOGOS[s]
  if (src) return <img className="tk" src={src} alt="" width={sz} height={sz} loading="lazy" />
  const c = TOKEN_ROW_COLORS[s]
  const bg = c?.bg ? `rgb(${c.bg})` : 'rgba(255,255,255,0.12)'
  return <span className="tk tk-fb" style={{ width: sz, height: sz, background: bg }}>{s?.[0]}</span>
}

export function Spark({ data, color = '#34d399', w = 56, h = 20 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !data?.length || data.length < 2) return
    const ctx = ref.current.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ref.current.width = w * dpr; ref.current.height = h * dpr
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h)
    const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1
    ctx.beginPath()
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = 2 + (1 - (v - mn) / rng) * (h - 4)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke()
  }, [data, color, w, h])
  return <canvas ref={ref} style={{ width: w, height: h, display: 'block', flexShrink: 0 }} />
}

export function Shim({ h = 16 }) { return <div className="tc-shim" style={{ height: h }} /> }
