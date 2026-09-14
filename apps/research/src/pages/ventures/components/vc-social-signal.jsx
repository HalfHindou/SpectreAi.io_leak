/**
 * VCSocialSignal — "Social Signal" view. Fuses the smart-money holdings graph
 * with crypto-social attention (X-Dash mindshare) into the one chart an investor
 * actually wants: VC conviction (x) vs social mindshare (y).
 *
 *   ┌───────────────┬───────────────┐
 *   │  RETAIL HYPE  │   CONSENSUS   │   high social
 *   │ (social, no   │ (everyone's   │
 *   │  smart money) │   already in) │
 *   ├───────────────┼───────────────┤
 *   │     COLD      │ STEALTH ALPHA │   low social
 *   │               │ (smart money  │
 *   │               │  early, quiet)│
 *   └───────────────┴───────────────┘
 *     low VC            high VC
 *
 * Stealth-Alpha (bottom-right) is the prize: tokens smart money is positioned in
 * before the social wave. Plus rising narratives and the loudest KOL voices.
 */
import React, { useMemo, useRef, useState, useLayoutEffect } from 'react'
import { buildConsensus, fmtUsdCompact } from './smu-shared'
import { TokenLogo } from './smu-bits'
import useSocialSignal from './useSocialSignal'
import './vc-social-signal.css'

const PLOT_H = 540
// Mega-caps dominate VC backing and have low relative mindshare share — they
// skew the matrix and aren't "discovery" plays, so they sit out.
const MEGA = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'USDC', 'USDT'])

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return undefined
    const el = ref.current
    const u = () => setW(el.clientWidth)
    u()
    const ro = new ResizeObserver(u)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export default function VCSocialSignal({ entities, priceMap }) {
  const { mindshareBySym, kols, narratives, loading } = useSocialSignal()
  const [plotRef, plotW] = useWidth()

  const consensus = useMemo(
    () => buildConsensus(entities, priceMap).filter((r) => r.backerCount >= 2 && !MEGA.has(r.symbol)),
    [entities, priceMap],
  )

  const points = useMemo(() => {
    if (!consensus.length) return []
    const maxBackers = consensus.reduce((m, r) => Math.max(m, r.backerCount), 1)
    const minBackers = consensus.reduce((m, r) => Math.min(m, r.backerCount), maxBackers)
    const bSpan = maxBackers - minBackers || 1
    const maxMind = Math.max(0.01, ...Object.values(mindshareBySym).map((m) => m.mindshare))
    return consensus.map((r, i) => {
      const social = mindshareBySym[r.symbol] || null
      const mind = social?.mindshare || 0
      const x = 0.08 + ((r.backerCount - minBackers) / bSpan) * 0.84 // VC conviction
      const y = mind > 0
        ? 0.34 + Math.min(1, mind / maxMind) * 0.6
        : 0.05 + ((i * 53) % 100) / 100 * 0.24 // quiet tokens in a spread low band
      const quadrant = x >= 0.5
        ? (y >= 0.5 ? 'consensus' : 'alpha')
        : (y >= 0.5 ? 'hype' : 'cold')
      return {
        symbol: r.symbol, image: r.image, backerCount: r.backerCount, poolAum: r.poolAum,
        mind, momentum: social?.momentum || null, mentions: social?.mentions ?? null,
        x, y, quadrant, hasSocial: mind > 0,
      }
    })
  }, [consensus, mindshareBySym])

  // Map to px and relax overlaps so dense corners stay legible.
  const placed = useMemo(() => {
    if (!plotW || !points.length) return []
    const nodes = points.map((p) => ({
      ...p,
      r: (24 + Math.min(1, Math.sqrt(p.backerCount) / 5) * 22) / 2,
      px: 40 + p.x * (plotW - 90),
      py: (PLOT_H - 36) - p.y * (PLOT_H - 76),
    }))
    for (let k = 0; k < 60; k++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]; const c = nodes[j]
          const dx = c.px - a.px; const dy = c.py - a.py
          const d = Math.hypot(dx, dy) || 0.01
          const min = a.r + c.r + 4
          if (d < min) {
            const push = (min - d) / 2; const ux = dx / d; const uy = dy / d
            a.px -= ux * push; a.py -= uy * push; c.px += ux * push; c.py += uy * push
          }
        }
      }
      for (const n of nodes) {
        n.px = Math.max(n.r + 6, Math.min(plotW - n.r - 6, n.px))
        n.py = Math.max(n.r + 6, Math.min(PLOT_H - n.r - 6, n.py))
      }
    }
    return nodes.sort((a, b) => (a.poolAum || 0) - (b.poolAum || 0))
  }, [points, plotW])

  const alpha = useMemo(() => points.filter((p) => p.quadrant === 'alpha').sort((a, b) => b.backerCount - a.backerCount).slice(0, 6), [points])

  return (
    <div className="vss">
      <div className="vss-head">
        <div className="vss-headline">
          <span className="vss-title">Social Signal</span>
          <span className="vss-sub">smart money × crypto attention · {points.length} backed tokens · live mindshare</span>
        </div>
        <div className="vss-legend">
          <span className="vss-leg"><span className="vss-dot is-bull" /> rising</span>
          <span className="vss-leg"><span className="vss-dot is-bear" /> fading</span>
        </div>
      </div>

      {/* the matrix */}
      <div className="vss-matrix" ref={plotRef} style={{ height: PLOT_H }}>
        <div className="vss-quad vss-quad--hype"><span>Retail Hype</span><em>social loud · no smart money</em></div>
        <div className="vss-quad vss-quad--consensus"><span>Consensus</span><em>smart money + social aligned</em></div>
        <div className="vss-quad vss-quad--cold"><span>Cold</span><em>off the radar</em></div>
        <div className="vss-quad vss-quad--alpha"><span>Stealth Alpha</span><em>smart money early · social quiet</em></div>
        <div className="vss-axis-x">VC conviction →</div>
        <div className="vss-axis-y">Social mindshare ↑</div>

        {placed.map((p) => {
          const size = p.r * 2
          const sign = p.momentum === 'rising' || p.momentum === 'surging' ? 'bull' : p.momentum === 'falling' || p.momentum === 'fading' ? 'bear' : 'flat'
          return (
            <div key={p.symbol} className={`vss-pt vss-pt--${sign}${p.quadrant === 'alpha' ? ' vss-pt--alpha' : ''}`} style={{ left: p.px, top: p.py, width: size, height: size }} title={`$${p.symbol} · ${p.backerCount} backers · ${p.mind ? p.mind.toFixed(2) + '% mindshare' : 'low social'}${p.momentum ? ' · ' + p.momentum : ''}`}>
              <TokenLogo symbol={p.symbol} image={p.image} size={size} />
              <span className="vss-pt-label">${p.symbol}</span>
            </div>
          )
        })}
      </div>

      {/* alpha callout */}
      {alpha.length > 0 && (
        <div className="vss-alpha">
          <span className="vss-alpha-label">⚡ Stealth alpha — smart money in, social hasn't caught on</span>
          <div className="vss-alpha-list">
            {alpha.map((p) => (
              <span key={p.symbol} className="vss-alpha-chip">
                <TokenLogo symbol={p.symbol} image={p.image} size={18} />
                ${p.symbol}<span className="vss-alpha-n">{p.backerCount} funds</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="vss-cols">
        {/* rising narratives */}
        <div className="vss-panel">
          <div className="vss-panel-head">Rising narratives <span className="vss-live">live</span></div>
          {narratives.length ? (
            <div className="vss-narr-list">
              {narratives.slice(0, 6).map((n) => (
                <div key={n.name} className="vss-narr">
                  <div className="vss-narr-top">
                    <span className="vss-narr-name">{n.name}</span>
                    <span className={`vss-narr-mom ${/surg|ris/i.test(n.momentum || '') ? 'is-bull' : ''}`}>{n.momentum || ''}</span>
                  </div>
                  <div className="vss-narr-assets">{n.topAssets.map((a) => <span key={a} className="vss-narr-chip">${a}</span>)}</div>
                </div>
              ))}
            </div>
          ) : <div className="vss-empty">{loading ? 'Loading narratives…' : 'No data.'}</div>}
        </div>

        {/* top voices */}
        <div className="vss-panel">
          <div className="vss-panel-head">Loudest voices <span className="vss-live">24h</span></div>
          {kols.length ? (
            <div className="vss-kol-list">
              {kols.map((k) => (
                <a key={k.handle} className="vss-kol" href={`https://x.com/${k.handle}`} target="_blank" rel="noopener noreferrer">
                  {k.avatar ? <img className="vss-kol-av" src={k.avatar} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden' }} /> : <span className="vss-kol-av vss-kol-av--fb">{(k.name || '?').slice(0, 1)}</span>}
                  <div className="vss-kol-body">
                    <div className="vss-kol-name">{k.name}</div>
                    <div className="vss-kol-meta">{fmtNum(k.followers)} followers · {fmtNum(k.mentions)} posts</div>
                  </div>
                  {Number.isFinite(k.influence) && <span className="vss-kol-score">{k.influence.toFixed(1)}</span>}
                </a>
              ))}
            </div>
          ) : <div className="vss-empty">{loading ? 'Loading voices…' : 'No data.'}</div>}
        </div>
      </div>
    </div>
  )
}
