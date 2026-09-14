/* Creators heatmap — squarified d3 treemap of token carriers sized by
   total_weighted_engagement. Mirrors the XDAttentionTreemap pattern:
   d3 recomputes the squarify layout at (boxW * k, boxH * k) on zoom so
   cells stay crisp at any level (no blurry CSS scale). Translate-only
   CSS transform on the zoom layer. d3-zoom drives wheel + drag. */
import { useMemo, useRef, useState, useCallback, useLayoutEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { treemap as d3treemap, hierarchy, treemapSquarify } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import { getAuthorId, getFollowerTier, formatNum, looksVerified } from './x-dash-utils'

/* Standalone squarify — input is already prepared with .value, .author. */
function squarify(values, w, h) {
  if (!values?.length) return []
  const root = hierarchy({ children: values })
    .sum((d) => (d.children ? 0 : Number(d.value) || 0))
    .sort((a, b) => (b.value || 0) - (a.value || 0))
  d3treemap()
    .size([Math.max(1, w), Math.max(1, h)])
    .tile(treemapSquarify.ratio(1.4))
    .paddingInner(0)
    .round(true)(root)
  return root.leaves().map((leaf) => ({
    ...leaf.data,
    x: leaf.x0,
    y: leaf.y0,
    w: Math.max(0, leaf.x1 - leaf.x0),
    h: Math.max(0, leaf.y1 - leaf.y0),
  }))
}

/* Memoized cell. Centered vertical stack: the avatar is the hero, the
   follower tier (KOL/Influencer/Creator/User) reads as a RING around it, and
   handle/name/metrics appear progressively as the cell grows. Below `md` the
   cell is an avatar-only tile — a clean recognizable face beats a truncated
   "@_TJR"; the tooltip still carries the full detail. Size tiers (xl/lg/md/
   sm/xs) drive sizing + visibility via CSS; the tier modifier drives palette. */
const XDCMapCell = memo(function XDCMapCell({
  authorId, screen_name, name, avatar, verified, weighted, mentions, share,
  x, y, w, h, followerTierClass, onOpen, title, ariaLabel,
}) {
  if (w < 12 || h < 10) return null

  /* Thresholds are tuned for the centered stack — a tier only unlocks the
     next line of text when the cell can hold it un-truncated. Err toward
     showing LESS text over a truncated handle. */
  const tier =
    w >= 150 && h >= 132 ? 'xl' :
    w >= 100 && h >= 92  ? 'lg' :
    w >= 60  && h >= 58  ? 'md' :
    w >= 30  && h >= 26  ? 'sm' : 'xs'

  const handle = String(screen_name || '').replace(/^@/, '')
  const cashtag = `@${handle}`
  const sharePct = (share || 0) * 100
  const metricText = formatNum(weighted || 0, { maxFraction: 0 })
  const initial = handle.slice(0, 1).toUpperCase() || '?'

  /* md shows the handle only if it fits on one line without ellipsis-noise
     (~6.6px/char at the md handle size). Narrow md cells drop to avatar-only. */
  const mdHandleFits = (w - 14) >= (cashtag.length * 6.6)
  const showHandle = tier === 'xl' || tier === 'lg' || (tier === 'md' && mdHandleFits)
  const showName = tier === 'xl' && !!name
  const showMetrics = tier === 'xl' || tier === 'lg'
  const showTick = verified && (tier === 'xl' || tier === 'lg')

  return (
    <button
      type="button"
      className={`xd-cmap__cell xd-cmap__cell--${tier} ${followerTierClass}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${Math.max(0, w - 2)}px`,
        height: `${Math.max(0, h - 2)}px`,
      }}
      onClick={() => authorId && onOpen && onOpen(authorId)}
      title={title || `@${handle} - ${metricText} engagement - ${formatNum(mentions || 0)} mentions - ${sharePct.toFixed(1)}% share`}
      aria-label={ariaLabel || `${cashtag}, open creator detail`}
    >
      <span className="xd-cmap__cell-av">
        {avatar ? (
          <img src={avatar} alt="" loading="lazy" />
        ) : (
          <span className="xd-cmap__cell-av-fallback">{initial}</span>
        )}
      </span>
      {showHandle && (
        <span className="xd-cmap__cell-handle">
          {cashtag}
          {showTick && <span className="xd-cmap__cell-tick" aria-hidden="true">✓</span>}
        </span>
      )}
      {showName && <span className="xd-cmap__cell-name">{name}</span>}
      {showMetrics && (
        <span className="xd-cmap__cell-meta">
          <span className="xd-cmap__cell-metric xd-num">{metricText}</span>
          <span className="xd-cmap__cell-dot" aria-hidden="true">·</span>
          <span className="xd-cmap__cell-share xd-num">{sharePct.toFixed(1)}%</span>
        </span>
      )}
    </button>
  )
})

export default function XDCreatorsHeatmap({ carriers = [], onOpenAuthor, totalEngagement = 0 }) {
  const { t } = useTranslation()
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [isZooming, setIsZooming] = useState(false)
  const roRef = useRef(null)
  const outerRef = useRef(null)
  const zoomBehaviorRef = useRef(null)
  const rafRef = useRef(null)
  const pendingTransformRef = useRef(null)
  const zoomingTimeoutRef = useRef(null)

  /* Callback ref — attaches ResizeObserver the instant the container mounts. */
  const measureRef = useCallback((el) => {
    outerRef.current = el
    if (roRef.current) {
      roRef.current.disconnect()
      roRef.current = null
    }
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w > 0 && h > 0) setBox({ w, h })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [])

  /* d3-zoom — wheel 1x-8x, drag pans. Coalesce wheel-burst events via RAF
     so we do at most one React render per paint frame. */
  useLayoutEffect(() => {
    const outer = outerRef.current
    if (!outer || box.w <= 0 || box.h <= 0) return undefined
    const sel = select(outer)
    const z = d3zoom()
      .scaleExtent([1, 8])
      .translateExtent([[0, 0], [box.w, box.h]])
      .extent([[0, 0], [box.w, box.h]])
      .filter((event) => {
        if (event.type === 'dblclick') return false
        if (event.type === 'contextmenu') return false
        if (event.type === 'mousedown' && event.button !== 0) return false
        return !event.ctrlKey && !event.button
      })
      .on('zoom', (event) => {
        pendingTransformRef.current = event.transform
        /* Mark "is-zooming" — CSS disables cell hover transitions & filters
           while user is actively wheeling/dragging so paint stays cheap.
           Cleared 180ms after the last zoom event. */
        setIsZooming(true)
        if (zoomingTimeoutRef.current) clearTimeout(zoomingTimeoutRef.current)
        zoomingTimeoutRef.current = setTimeout(() => setIsZooming(false), 180)
        if (rafRef.current != null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          const t = pendingTransformRef.current
          if (t) setTransform({ x: t.x, y: t.y, k: t.k })
        })
      })
    zoomBehaviorRef.current = z
    sel.call(z)
    sel.on('dblclick.zoom', null)

    const preventScroll = (e) => {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
    }
    outer.addEventListener('wheel', preventScroll, { passive: false })

    return () => {
      sel.on('.zoom', null)
      outer.removeEventListener('wheel', preventScroll)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (zoomingTimeoutRef.current) {
        clearTimeout(zoomingTimeoutRef.current)
        zoomingTimeoutRef.current = null
      }
      pendingTransformRef.current = null
      zoomBehaviorRef.current = null
    }
  }, [box.w, box.h])

  /* Reset zoom when data or container changes */
  useLayoutEffect(() => {
    const outer = outerRef.current
    const z = zoomBehaviorRef.current
    if (!outer || !z) return
    select(outer).call(z.transform, zoomIdentity)
    setTransform({ x: 0, y: 0, k: 1 })
  }, [carriers, box.w, box.h])

  const zoomBy = useCallback((factor) => {
    const outer = outerRef.current
    const z = zoomBehaviorRef.current
    if (!outer || !z) return
    select(outer).transition().duration(220).call(z.scaleBy, factor)
  }, [])
  const resetZoom = useCallback(() => {
    const outer = outerRef.current
    const z = zoomBehaviorRef.current
    if (!outer || !z) return
    select(outer).transition().duration(260).call(z.transform, zoomIdentity)
  }, [])

  /* Data prep — runs only when carriers change, not on zoom. */
  const dataPrep = useMemo(() => {
    const raw = (Array.isArray(carriers) ? carriers : [])
      .map((c, i) => {
        const weighted = Number(c.total_weighted_engagement || 0)
        return {
          authorId: getAuthorId(c) || c.author_rest_id,
          screen_name: c.screen_name || '',
          name: c.name || '',
          avatar: c.avatar_image_url || '',
          verified: looksVerified(c),
          weighted,
          mentions: Number(c.mention_count || 0),
          followerTierClass: (getFollowerTier(c.followers_count) || {}).cls || 'tier-user',
          index: i,
          // Squarify size driver — dampened with sqrt so a single mega-author
          // doesn't crowd everyone else out.
          value: Math.sqrt(Math.max(weighted, 1)),
        }
      })
      .filter((c) => c.weighted > 0 || c.mentions > 0)

    const grandTotal = raw.reduce((s, c) => s + c.weighted, 0)
    return {
      visible: raw.map((c) => ({
        ...c,
        share: grandTotal > 0 ? c.weighted / grandTotal : 0,
      })),
      grandTotal,
    }
  }, [carriers])

  /* Layout memo — runs on zoom. Squarify input dimensions scale with k
     so cells stay crisp at any zoom level. */
  const cells = useMemo(() => {
    if (!dataPrep.visible.length || box.w <= 0 || box.h <= 0) {
      return { items: [], layoutW: 0, layoutH: 0 }
    }
    const layoutW = Math.max(1, Math.round(box.w * transform.k))
    const layoutH = Math.max(1, Math.round(box.h * transform.k))
    const items = squarify(dataPrep.visible, layoutW, layoutH)
    return { items, layoutW, layoutH }
  }, [dataPrep, box.w, box.h, transform.k])

  const isZoomed = transform.k > 1.001 || transform.x !== 0 || transform.y !== 0
  const zoomLevel = transform.k

  return (
    <div className={`xd-cmap${isZooming ? ' is-zooming' : ''}`} ref={measureRef}>
      {/* Scroll-to-zoom hint when at 1x */}
      {box.w > 0 && !isZoomed && (
        <div className="xd-cmap__hint" aria-hidden="true">
          {t('xDash.creatorsHeatmap.scrollHint', 'Scroll to zoom · Drag to pan')}
        </div>
      )}
      {/* Zoom HUD: − / level% / + */}
      {box.w > 0 && (
        <div className="xd-cmap__hud" aria-label={t('xDash.creatorsHeatmap.zoomControls', 'Zoom controls')}>
          <button
            type="button"
            className="xd-cmap__hud-btn"
            onClick={() => zoomBy(1 / 1.5)}
            aria-label={t('xDash.creatorsHeatmap.zoomOut', 'Zoom out')}
            disabled={zoomLevel <= 1.001}
          >−</button>
          <button
            type="button"
            className="xd-cmap__hud-level"
            onClick={resetZoom}
            aria-label={t('xDash.creatorsHeatmap.resetZoom', 'Reset zoom')}
            title={t('xDash.creatorsHeatmap.clickToReset', 'Click to reset')}
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <button
            type="button"
            className="xd-cmap__hud-btn"
            onClick={() => zoomBy(1.5)}
            aria-label={t('xDash.creatorsHeatmap.zoomIn', 'Zoom in')}
            disabled={zoomLevel >= 7.99}
          >+</button>
        </div>
      )}
      <div
        className="xd-cmap__zoom"
        style={{
          width: cells.layoutW || box.w,
          height: cells.layoutH || box.h,
          /* translate3d forces GPU composition (vs plain translate which
             may stay on CPU in some browsers). */
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        }}
      >
        {box.w > 0 && cells.items.map((c) => {
          const handle = String(c.screen_name || '').replace(/^@/, '')
          const sharePct = (c.share || 0) * 100
          return (
            <XDCMapCell
              key={c.authorId || c.screen_name || c.index}
              authorId={c.authorId}
              screen_name={c.screen_name}
              name={c.name}
              avatar={c.avatar}
              verified={c.verified}
              weighted={c.weighted}
              mentions={c.mentions}
              share={c.share}
              followerTierClass={c.followerTierClass}
              x={c.x}
              y={c.y}
              w={c.w}
              h={c.h}
              onOpen={onOpenAuthor}
              title={t('xDash.creatorsHeatmap.cellTooltip', '@{{handle}} - {{eng}} engagement - {{mentions}} mentions - {{share}}% share', {
                handle,
                eng: formatNum(c.weighted || 0, { maxFraction: 0 }),
                mentions: formatNum(c.mentions || 0),
                share: sharePct.toFixed(1),
              })}
              ariaLabel={t('xDash.creatorsHeatmap.cellAria', '@{{handle}}, open creator detail', { handle })}
            />
          )
        })}
      </div>
    </div>
  )
}
