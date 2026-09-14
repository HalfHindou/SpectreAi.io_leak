/**
 * RzKolCosmos — the KOL network card on the shared Cosmos engine.
 *
 * Replaces the bespoke Verlet renderer in rz-kol-bubbles (Sunny 2026-07-13:
 * "the kol bubbles should be taken from the cosmos engine in x dash/xbubbles").
 * One engine everywhere: /bubbles, the X Bubbles universe, the x-dash Cosmos
 * tab and now the RZ Sentiment card all render through CosmosEngine.
 *
 * Shape: the token IS the sun; every voice orbits it directly — engagement
 * rank is the ring (the loudest carriers hug the token), bubble size is
 * followers, color is reach tier (S/A/B/C + exchanges). That is exactly
 * buildKolCosmos's single-project swarm, so the adapter here only maps the
 * useKolBubbles author rows into crawl-graph voice nodes.
 *
 * three.js discipline: CosmosEngine is statically imported HERE, so this file
 * must only ever be mounted via React.lazy — the RZ page chunk stays clean
 * (check-critical-path guards the boot chunk; keep the lazy() at call sites).
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CosmosEngine } from '@/components/cosmos/cosmos-engine'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'
import { buildKolCosmos } from '@/pages/x-intelligence/components/xbubbles-cosmos-data'
import useKolBubbles from '../data/useKolBubbles'
import '@/components/cosmos/cosmos.css'
import './rz-kol-cosmos.css'

const TIMEFRAMES = [
  { id: '1h', label: '1H' },
  { id: '6h', label: '6H' },
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
]

const tierFor = (followers) => {
  if (followers >= 500_000) return 'S'
  if (followers >= 100_000) return 'A'
  if (followers >= 30_000) return 'B'
  return 'C'
}

const fmtCount = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}

const RzKolCosmos = React.memo(function RzKolCosmos({
  symbol,
  cgId = null,
  tokenLogo = null,
  tokenName = null,
  dayMode = false,
  isMobile = false,
  height = 480,
}) {
  const { t } = useTranslation()
  const sym = String(symbol || '').toUpperCase()
  const [timeframe, setTimeframe] = useState('24h')
  const { bubbles, metrics, source, loading } = useKolBubbles({
    symbol: sym,
    cgId,
    tokenLogo,
    tokenName,
    timeframe,
    maxBubbles: 48,
    sortBy: 'engagement',
  })

  const hostRef = useRef(null)
  const engineRef = useRef(null)
  const hoverCardRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [hoverBody, setHoverBody] = useState(null)

  /* useKolBubbles author rows → crawl-graph voice nodes → the single-project
     swarm (token = sun, voices orbit by engagement rank). */
  const cosmos = useMemo(() => {
    const voices = (bubbles || []).filter((b) => b && b.id !== 'center')
    if (!voices.length) return null
    const kolNodes = voices.map((b) => ({
      id: b.id,
      handle: b.handle,
      name: b.user || b.handle,
      avatar: b.avatar,
      followers: Number(b.followersNum) || 0,
      type: 'kol',
      tier: tierFor(Number(b.followersNum) || 0),
      mentionCount: Number(b.mentionCount) || 0,
      weightedEngagement: Number(b.totalEngagement) || 0,
      srcBubble: b,
    }))
    const projectNode = {
      id: sym,
      symbol: sym,
      name: tokenName || sym,
      avatar: tokenLogo || null,
      cgId,
      velocityScore: Number(metrics?.velocity) || 1,
      mentionCount: Number(metrics?.mentions24h) || voices.length,
      intel: { authors24h: Number(metrics?.uniqueAuthors) || voices.length },
    }
    return buildKolCosmos({ projectNodes: [projectNode], kolNodes }, { maxSwarm: 48 })
  }, [bubbles, metrics, sym, cgId, tokenLogo, tokenName])

  /* ── engine lifecycle (the XBubblesCosmos pattern, card-sized) ── */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const engine = new CosmosEngine(host, {
      isMobile,
      dayMode,
      reducedMotion,
      initialView: 'solar',
      labelMode: 'name',
      skipIntro: true,
      onHover: (body, x, y) => {
        setHoverBody((prev) => {
          const next = body && !body.isSun ? body : null
          return prev === next ? prev : next
        })
        const card = hoverCardRef.current
        if (card && body && !body.isSun) {
          const rect = host.getBoundingClientRect()
          const lx = x - rect.left
          const ly = y - rect.top
          const pad = 16
          const cw = card.offsetWidth || 200
          const chh = card.offsetHeight || 84
          let nx = lx + pad
          let ny = ly + pad
          if (nx + cw > rect.width - 10) nx = lx - cw - pad
          if (ny + chh > rect.height - 10) ny = ly - chh - pad
          card.style.transform = `translate(${Math.max(6, nx)}px, ${Math.max(6, ny)}px)`
        }
      },
      onSelect: (body) => {
        const b = body?.srcNode?.srcBubble
        const url = b?.profileUrl || (body?.id && !body.isSun ? `https://x.com/${body.id}` : null)
        if (url) window.open(url, '_blank', 'noopener')
      },
    })
    engineRef.current = engine
    host.__cosmosEngine = engine
    setReady(true)

    const ro = new ResizeObserver(() => engine.resize())
    ro.observe(host)
    const io = new IntersectionObserver(
      (entries) => engine.setRunning(entries[0]?.isIntersecting !== false),
      { threshold: 0.02 },
    )
    io.observe(host)
    const idleTimer = setInterval(() => {
      if (!isAppActive()) engine.setRunning(false)
    }, 30000)
    const unsubActivity = subscribeActivity(() => {
      if (!engine.running) engine.setRunning(true)
    })

    return () => {
      clearInterval(idleTimer)
      unsubActivity?.()
      ro.disconnect()
      io.disconnect()
      engine.dispose()
      engineRef.current = null
    }
    // created once per mount; data/dayMode flow through the setters below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || !cosmos) return
    engineRef.current?.setData(cosmos)
  }, [cosmos, ready])
  useEffect(() => { engineRef.current?.setDayMode(dayMode) }, [dayMode, ready])

  const onTimeframe = useCallback((id) => setTimeframe(id), [])

  const voiceCount = cosmos?.bodies?.length || 0
  const hb = hoverBody?.srcNode?.srcBubble || null

  return (
    <div className={`rkc-root cosmos-root${dayMode ? ' cosmos-day rkc-root--day' : ''}`} style={{ height }}>
      <div ref={hostRef} className="cosmos-stage rkc-stage" />

      {/* header chrome — timeframe + honest count */}
      <div className="rkc-hud">
        <div className="rkc-tfs" role="tablist" aria-label={t('researchPro.kolCosmos.rzkolcosmos.ariaTimeframe', "Timeframe")}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              type="button"
              role="tab"
              aria-selected={timeframe === tf.id}
              className={`rkc-tf${timeframe === tf.id ? ' rkc-tf--on' : ''}`}
              onClick={() => onTimeframe(tf.id)}
            >
              {tf.label}
            </button>
          ))}
        </div>
        {voiceCount > 0 && (
          <span className="rkc-count mono">
            {voiceCount} voices{source ? ` · ${source}` : ''}
          </span>
        )}
      </div>

      {/* hover card */}
      <div ref={hoverCardRef} className={`rkc-hover${hb ? ' rkc-hover--on' : ''}`} aria-hidden={!hb}>
        {hb && (
          <>
            <div className="rkc-hover-name">
              {hb.user || hb.handle}
              {hb.verified ? <span className="rkc-hover-verified" aria-label={t('researchPro.kolCosmos.rzkolcosmos.ariaVerified', "verified")}>✓</span> : null}
            </div>
            <div className="rkc-hover-meta mono">
              @{hb.handle} · {hb.followers} followers
            </div>
            <div className="rkc-hover-meta mono">
              {hb.mentionCount || 0} mention{(hb.mentionCount || 0) === 1 ? '' : 's'} · eng {fmtCount(hb.totalEngagement)}
            </div>
            <div className="rkc-hover-hint">click → open on X</div>
          </>
        )}
      </div>

      {loading && !voiceCount && (
        <div className="rkc-state">
          <div className="rkc-shimmer" />
        </div>
      )}
      {!loading && !voiceCount && (
        <div className="rkc-state rkc-state--empty">
          No voices captured for ${sym} in this window — the tape is quiet.
        </div>
      )}
    </div>
  )
})

export default RzKolCosmos
