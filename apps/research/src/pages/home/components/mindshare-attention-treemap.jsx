/**
 * MindshareAttentionTreemap — d3-hierarchy squarified treemap with d3-zoom
 * pan/scroll for the Command Center → Mindshare → Social tab. Same data shape
 * as XDAttentionTreemap (x-dash bootstrap rows) but rendered through real d3
 * with smooth zoom in/out and drag panning. The long tail is collapsed into
 * a single muted cell. Cell color encodes rank movement (green = climbed,
 * red = fell) — same semantic as the welcome heatmap, applied to attention.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { hierarchy, treemap as d3treemap, treemapSquarify } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom as d3zoom } from 'd3-zoom'

import './mindshare-attention-treemap.css'

function formatNum(n) {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function normalize(row) {
  const t = row.token || row
  const m = row.metrics || row
  const mentions = Number(m.external_mentions_24h ?? m.mentions_24h ?? 0)
  const authors  = Number(m.unique_external_authors_24h ?? row.unique_external_authors_24h ?? 0)
  // Broaden logo source chain. Backend emits different field names depending
  // on which upstream produced the row (X Dash native vs the Spectre API
  // fallback in social-proxy.js, which sets logo_url). Without these fallbacks
  // every cell rendered a plain initial circle when the fallback path was hit.
  const image = t.image_small || t.image_url || t.logo_url || t.logo || t.image_thumb
    || row.image_small || row.image_url || row.logo_url || row.logo || row.image_thumb || row.image
  // Direction signal: prefer explicit rank_direction; fall back to derived
  // signal from mention velocity / 24h change / rank delta sign so cells
  // still encode momentum when the upstream omits rank fields (the Spectre
  // API fallback never sets rank_direction → without this, everything renders grey).
  let rankDirection = row.rank_direction || null
  if (!rankDirection) {
    const rankDelta = Number(row.rank_change_positions ?? 0)
    if (rankDelta > 0) rankDirection = 'up'
    else if (rankDelta < 0) rankDirection = 'down'
    else {
      const velocity = Number(m.velocity_ratio ?? row.velocity_ratio ?? 0)
      const change24 = Number(m.change_24h ?? row.change_24h ?? row.price_change_24h ?? 0)
      // velocity > 1 means mentions are accelerating vs the prior window.
      if (velocity > 1.15) rankDirection = 'up'
      else if (velocity > 0 && velocity < 0.85) rankDirection = 'down'
      else if (change24 > 0.5) rankDirection = 'up'
      else if (change24 < -0.5) rankDirection = 'down'
    }
  }
  return {
    cgId: t.cg_id || t.token_id || row.cg_id || row.token_id,
    cashtag: t.cashtag || (t.symbol ? `$${t.symbol}` : t.name || '-'),
    name: t.name || row.name || '',
    symbol: (t.symbol || row.symbol || '').toUpperCase(),
    image,
    mentions,
    authors,
    rankPosition: row.rank_position ?? null,
    rankDirection,
    rankChange: Math.abs(Number(row.rank_change_positions ?? 0)) || (rankDirection ? 5 : 0),
    topAuthors: Array.isArray(row.top_authors) ? row.top_authors.slice(0, 3) : [],
  }
}

function MindshareAttentionTreemap({
  tokens = [],
  loading = false,
  onOpenToken,
  height = 460,
  maxCells = 36,
}) {
  const { t } = useTranslation()
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const gRef = useRef(null)
  const zoomBehaviorRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: height })

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

  /* Squarified layout, padded so cells don't kiss. Long tail collapses
     into one "+N" cell once we exceed maxCells. */
  const leaves = useMemo(() => {
    if (!tokens?.length || size.w < 50 || size.h < 50) return []
    const raw = tokens
      .map(normalize)
      .filter((c) => c.cgId && c.mentions > 0)
      .sort((a, b) => b.mentions - a.mentions)

    if (raw.length === 0) return []

    let visible = raw
    if (raw.length > maxCells) {
      visible = raw.slice(0, maxCells - 1)
      const tail = raw.slice(maxCells - 1)
      const tailMentions = tail.reduce((s, c) => s + c.mentions, 0)
      if (tailMentions > 0) {
        visible.push({
          cgId: null,
          cashtag: `+${tail.length}`,
          name: 'Long tail',
          symbol: '',
          image: null,
          mentions: tailMentions,
          authors: tail.reduce((s, c) => s + c.authors, 0),
          rankPosition: null,
          rankDirection: null,
          rankChange: 0,
          topAuthors: [],
          isOthers: true,
        })
      }
    }

    const grandTotal = raw.reduce((s, c) => s + c.mentions, 0)
    /* sqrt dampening so a single dominant token doesn't drown the rest —
       the top cell stops eating half the canvas and small caps stay tappable.
       The displayed `share` % below is still computed from raw mentions, so
       the label remains truthful. */
    const dampen = (v) => Math.sqrt(Math.max(Number(v) || 0, 1))
    const root = hierarchy({ children: visible })
      .sum((d) => dampen(d.mentions))
      .sort((a, b) => b.value - a.value)
    d3treemap()
      .size([size.w, size.h])
      .tile(treemapSquarify.ratio(1.4))
      .paddingInner(3)
      .round(true)(root)

    return root.leaves().map((node) => ({
      ...node.data,
      x: node.x0,
      y: node.y0,
      w: node.x1 - node.x0,
      h: node.y1 - node.y0,
      share: grandTotal > 0 ? node.data.mentions / grandTotal : 0,
    }))
  }, [tokens, size.w, size.h, maxCells])

  /* d3-zoom binding. Drag pans, wheel zooms (1×–10×), translate clamped to
     the rendered rect so the user can't pan into empty space. */
  useEffect(() => {
    if (!svgRef.current || !gRef.current || size.w < 50) return undefined
    const svg = select(svgRef.current)
    const g = select(gRef.current)
    const z = d3zoom()
      .scaleExtent([1, 10])
      .translateExtent([[0, 0], [size.w, size.h]])
      .extent([[0, 0], [size.w, size.h]])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString())
      })
    zoomBehaviorRef.current = z
    svg.call(z)
    /* Disable double-click zoom — it competes with the cell click handler. */
    svg.on('dblclick.zoom', null)
    return () => { svg.on('.zoom', null) }
  }, [size.w, size.h])

  const handleCellClick = useCallback((cell) => {
    if (!cell || cell.isOthers || !cell.cgId) return
    if (onOpenToken) onOpenToken(cell.cgId)
  }, [onOpenToken])

  if (loading && leaves.length === 0) {
    return <div ref={wrapRef} className="mat-shimmer animate-shimmer" style={{ height }} />
  }
  if (!loading && leaves.length === 0) {
    return (
      <div ref={wrapRef} className="mat-empty" style={{ height }}>
        {t('homePage.mindshareAttentionTreemap.mindshareattentiontreemap.noAttentionToMapForThisW', "No attention to map for this window")}
      </div>
    )
  }

  return (
    <div className="mat-root" ref={wrapRef} style={{ height }}>
      <svg
        ref={svgRef}
        className="mat-svg"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
      >
        <g ref={gRef}>
          {leaves.map((c) => {
            const isPositive = c.rankDirection === 'up'
            const isNegative = c.rankDirection === 'down'
            const absDelta = Math.abs(c.rankChange || 0)
            const intensity = Math.min(1, absDelta / 20)
            const fill = c.isOthers
              ? 'rgba(255,255,255,0.03)'
              : isPositive
                ? `rgba(16, 185, 129, ${(0.14 + intensity * 0.32).toFixed(3)})`
                : isNegative
                  ? `rgba(239, 68, 68, ${(0.14 + intensity * 0.32).toFixed(3)})`
                  : 'rgba(255,255,255,0.05)'
            const stroke = c.isOthers
              ? 'rgba(255,255,255,0.06)'
              : isPositive
                ? `rgba(16, 185, 129, ${(0.22 + intensity * 0.28).toFixed(3)})`
                : isNegative
                  ? `rgba(239, 68, 68, ${(0.22 + intensity * 0.28).toFixed(3)})`
                  : 'rgba(255,255,255,0.09)'

            const sharePct = c.share * 100
            const showTop  = c.w >= 32 && c.h >= 22
            const showLogo = !c.isOthers && c.w >= 38 && c.h >= 32
            const showName = !c.isOthers && c.w >= 96 && c.h >= 66
            const showBottom = !c.isOthers && c.w >= 56 && c.h >= 44
            const showCarriers = !c.isOthers && c.topAuthors.length > 0 && c.w >= 120 && c.h >= 96

            const rankToneCls = isPositive ? 'mat-cell--up' : isNegative ? 'mat-cell--down' : 'mat-cell--flat'
            const rankArrow = isPositive ? '▲' : isNegative ? '▼' : '·'

            /* Continuous size scale based on the cell's smaller side. At
               minDim≥130 we're at full 1.0; at minDim≤55 we're clamped to
               0.55 so labels stop colliding in tiny cells. The SVG zoom
               transform multiplies on top, so a zoomed-in tiny cell still
               grows back to readable. */
            const minDim = Math.max(0, Math.min(c.w, c.h))
            const scale = Math.max(0.55, Math.min(1, (minDim - 55) / 75 + 0.55))
            const tickerFs   = Math.round(13 * scale)
            const nameFs     = Math.round(11 * scale)
            const shareFs    = Math.round(13 * scale)
            const rankFs     = Math.max(8, Math.round(10 * scale))
            const logoPx     = Math.max(14, Math.round(32 * scale))
            const carrierPx  = Math.max(12, Math.round(18 * scale))
            const padPx      = Math.max(4, Math.round(10 * scale))
            const gapPx      = Math.max(3, Math.round(8 * scale))
            const innerStyle = {
              padding: `${padPx}px ${padPx + 2}px`,
              gap: `${gapPx}px`,
            }
            const topStyle = { gap: `${gapPx}px` }
            const logoStyle = { width: `${logoPx}px`, height: `${logoPx}px` }
            const tickerStyle = { fontSize: `${tickerFs}px` }
            const nameStyle = { fontSize: `${nameFs}px` }
            const shareStyle = { fontSize: `${shareFs}px` }
            const rankStyle = { fontSize: `${rankFs}px`, padding: `${Math.max(1, Math.round(2 * scale))}px ${Math.max(3, Math.round(6 * scale))}px` }
            const carrierStyle = { width: `${carrierPx}px`, height: `${carrierPx}px` }

            return (
              <g
                key={c.cgId || (c.isOthers ? 'others' : c.cashtag)}
                transform={`translate(${c.x},${c.y})`}
                className={`mat-cell ${rankToneCls}${c.isOthers ? ' mat-cell--others' : ''}`}
                onClick={() => handleCellClick(c)}
              >
                <title>
                  {c.isOthers
                    ? `${c.cashtag} more tokens — ${sharePct.toFixed(1)}% of attention`
                    : `${c.cashtag} — ${sharePct.toFixed(1)}% · ${formatNum(c.mentions)} mentions · ${formatNum(c.authors)} authors${c.rankDirection && c.rankDirection !== 'flat' ? ` · rank ${c.rankDirection} ${absDelta}` : ''}`}
                </title>
                <rect
                  className="mat-cell__rect"
                  width={Math.max(0, c.w - 2)}
                  height={Math.max(0, c.h - 2)}
                  rx={8}
                  ry={8}
                  fill={fill}
                  stroke={stroke}
                />
                <foreignObject x={0} y={0} width={Math.max(0, c.w - 2)} height={Math.max(0, c.h - 2)}>
                  <div className={`mat-cell__inner${c.isOthers ? ' mat-cell__inner--others' : ''}`} style={innerStyle} xmlns="http://www.w3.org/1999/xhtml">
                    {c.isOthers ? (
                      <span className="mat-cell__others-label" style={{ fontSize: `${Math.round(14 * scale)}px` }}>
                        {c.cashtag}
                        <span className="mat-cell__others-sub" style={{ fontSize: `${Math.round(10 * scale)}px` }}>{t('homePage.mindshareAttentionTreemap.mindshareattentiontreemap.tokens', "tokens")}</span>
                      </span>
                    ) : (
                      <>
                        {showTop && (
                          <div className="mat-cell__top" style={topStyle}>
                            {showLogo && (
                              c.image ? <img className="mat-cell__logo" style={logoStyle} src={c.image} alt="" /> :
                              <span className="mat-cell__logo mat-cell__logo--initial" style={{ ...logoStyle, fontSize: `${Math.max(8, Math.round(11 * scale))}px` }}>{(c.symbol || c.cashtag).slice(0, 2)}</span>
                            )}
                            <div className="mat-cell__id">
                              <span className="mat-cell__ticker" style={tickerStyle}>{c.cashtag}</span>
                              {showName && <span className="mat-cell__name" style={nameStyle}>{c.name || c.symbol}</span>}
                            </div>
                          </div>
                        )}
                        {showBottom && (
                          <div className="mat-cell__bottom">
                            <span className="mat-cell__share" style={shareStyle}>{sharePct.toFixed(1)}%</span>
                            {c.rankPosition != null && (
                              <span className={`mat-cell__rank mat-cell__rank--${isPositive ? 'up' : isNegative ? 'down' : 'flat'}`} style={rankStyle}>
                                #{c.rankPosition}
                                {absDelta > 0 && <span className="mat-cell__rank-arrow" style={{ fontSize: `${Math.max(7, Math.round(9 * scale))}px` }}>{rankArrow}{absDelta}</span>}
                              </span>
                            )}
                          </div>
                        )}
                        {showCarriers && (
                          <div className="mat-cell__carriers">
                            {c.topAuthors.map((a, i) => (
                              a?.image ? (
                                <img key={a.id || a.handle || i} className="mat-cell__carrier" style={carrierStyle} src={a.image} alt="" />
                              ) : (
                                <span key={a?.id || a?.handle || i} className="mat-cell__carrier mat-cell__carrier--initial" style={{ ...carrierStyle, fontSize: `${Math.max(7, Math.round(9 * scale))}px` }}>
                                  {((a?.display_name || a?.handle || '?').slice(0, 1)).toUpperCase()}
                                </span>
                              )
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

export default memo(MindshareAttentionTreemap)
