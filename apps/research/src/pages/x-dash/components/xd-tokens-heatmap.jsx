/* Tokens heatmap — squarified treemap of the tokens a creator covers,
   sized by mention count. Mirrors xd-creators-heatmap.jsx but with token
   shape: { cgId, symbol, name, image, mentionCount }. Used inside the
   author drawer fullscreen rail to give a visual read on which projects
   the KOL is leaning on most. Click a cell to jump to that token's brief. */
import { useMemo, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { treemap, hierarchy, treemapSquarify } from 'd3-hierarchy'
import { Avatar } from './xd-bits'
import { formatNum } from './x-dash-utils'

export default function XDTokensHeatmap({ tokens = [], onOpenToken }) {
  const { t } = useTranslation()
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return undefined
    const apply = () => {
      const r = node.getBoundingClientRect()
      const w = Math.max(0, Math.floor(r.width))
      const h = Math.max(0, Math.floor(r.height))
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const total = useMemo(
    () => tokens.reduce((sum, t) => sum + (Number(t.mentionCount) || 0), 0),
    [tokens],
  )

  const cells = useMemo(() => {
    if (!tokens?.length || !size.w || !size.h) return []
    /* sqrt dampening so a single dominant token doesn't drown the rest */
    const dampen = (v) => Math.sqrt(Math.max(Number(v) || 0, 1))
    const data = {
      name: 'tokens',
      children: tokens.map((t, i) => ({
        token: t,
        index: i,
        value: dampen(t.mentionCount),
      })),
    }
    const root = hierarchy(data).sum((d) => d.value).sort((a, b) => b.value - a.value)
    treemap()
      .size([size.w, size.h])
      .tile(treemapSquarify.ratio(1.4))
      .padding(2)
      .round(true)(root)
    return root.leaves()
  }, [tokens, size.w, size.h])

  return (
    <div className="xd-tokens-heatmap" ref={wrapRef}>
      {cells.map((cell) => {
        const tk = cell.data.token
        const w = cell.x1 - cell.x0
        const h = cell.y1 - cell.y0
        const area = w * h
        const share = total > 0
          ? Math.max(0, Math.min(1, Number(tk.mentionCount || 0) / total))
          : 0
        const intensity = 0.78 + share * 0.22
        const showText = area >= 3000
        const showMetric = area >= 9000
        const avatarSize = area >= 18000 ? 40 : area >= 8000 ? 32 : 24
        return (
          <button
            key={tk.cgId || tk.symbol || cell.data.index}
            type="button"
            className="xd-tokens-heatmap__cell"
            style={{
              left: cell.x0,
              top: cell.y0,
              width: w,
              height: h,
              opacity: intensity,
            }}
            onClick={() => tk.cgId && onOpenToken && onOpenToken(tk.cgId)}
            title={t('xDash.tokensHeatmap.tooltip', '${{symbol}} — {{count}} mentions', { symbol: tk.symbol || '', count: formatNum(tk.mentionCount || 0) })}
          >
            <div className="xd-tokens-heatmap__cell-inner">
              <span className="xd-tokens-heatmap__avatar">
                <Avatar src={tk.image} alt={tk.symbol} size={avatarSize} />
              </span>
              {showText && (
                <div className="xd-tokens-heatmap__text">
                  <span className="xd-tokens-heatmap__tag xd-num">
                    {tk.symbol ? `$${tk.symbol}` : tk.name}
                  </span>
                  {showMetric && (
                    <span className="xd-tokens-heatmap__metric xd-num">
                      {formatNum(tk.mentionCount || 0)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
