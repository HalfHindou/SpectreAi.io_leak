/**
 * VcAiAnalyst — the "AI Analyst" box. Leads with a Groq-written thesis that
 * reads the fund's portfolio AND their live X posts to explain what they're
 * investing in, their sector tilt, and the narratives they're pushing. Falls
 * back to an instant client-derived read while the LLM resolves. Below it, a
 * live feed of the fund's recent posts.
 */
import React, { useMemo, useState } from 'react'
import { analyzeVc } from './smu-vc-analyst'
import { fmtPct, classOfPct } from './smu-shared'
import { TokenLogo } from './smu-bits'
import useVcIntel from './useVcIntel'
import './vc-ai-analyst.css'

const OPEN_KEY = 'spectre-vai-open'

export default function VcAiAnalyst({ entity, priceMap }) {
  const a = useMemo(() => analyzeVc(entity, priceMap), [entity, priceMap])
  // Hold the LLM request until the universe price fetch has landed (or the
  // fund has no tracked tokens) - firing early caches a priceless
  // "momentum: n/a" thesis for 6h server-side. Once the map is populated,
  // tokens either have live data or never will, so this can't stall forever.
  const pricesReady = !!a && (a.holdingsCount === 0 || Object.keys(priceMap || {}).length > 0)
  const intel = useVcIntel(entity, priceMap, pricesReady)
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true }
  })
  const toggle = () => setOpen((o) => {
    const next = !o
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0') } catch { /* ignore */ }
    return next
  })
  if (!a) return null

  const maxWeight = a.mix.reduce((m, s) => Math.max(m, s.weight), 0.0001)
  const usingLlm = !!intel.thesis
  const narrative = usingLlm ? intel.thesis : a.narrative
  const topSector = a.mix[0]?.label

  return (
    <>
      <div className={`vai${open ? '' : ' vai--collapsed'}`}>
        <button type="button" className="vai-head vai-head--toggle" onClick={toggle} aria-expanded={open}>
          <span className="vai-badge">
            <span className="vai-dot" aria-hidden />
            AI Analyst
          </span>
          {open ? (
            <span className="vai-sub">
              {usingLlm
                ? `Groq · reads ${intel.handle ? `@${intel.handle} + ` : ''}live book`
                : intel.loading ? 'Synthesizing live read…' : 'Live read · holdings × 30s prices'}
            </span>
          ) : (
            <span className="vai-sub vai-sub--peek">
              {topSector ? `${topSector}-tilted` : 'Live read'} · {a.holdingsCount} positions
              {Number.isFinite(a.momentum) && (
                <span className={classOfPct(a.momentum)}> · {fmtPct(a.momentum)} 24h</span>
              )}
            </span>
          )}
          <svg className="vai-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {open ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
          </svg>
        </button>

        {open && <>
        <p className={`vai-narrative${!usingLlm && intel.loading ? ' vai-narrative--pending' : ''}`}>{narrative}</p>

        <div className="vai-grid">
          <div className="vai-block">
            <div className="vai-block-title">Sector tilt</div>
            {a.mix.length ? (
              <div className="vai-bars">
                {a.mix.map((s) => (
                  <div key={s.key} className="vai-bar-row">
                    <span className="vai-bar-label">{s.label}</span>
                    <span className="vai-bar-track"><span className="vai-bar-fill" style={{ width: `${Math.max(8, (s.weight / maxWeight) * 100).toFixed(0)}%` }} /></span>
                    <span className="vai-bar-pct">{Math.round(s.weight * 100)}%</span>
                  </div>
                ))}
              </div>
            ) : <div className="vai-empty">No sector signal.</div>}
          </div>

          <div className="vai-block">
            <div className="vai-block-title">Conviction · live 24h</div>
            {a.conviction.length ? (
              <div className="vai-chips">
                {a.conviction.map((h) => (
                  <div key={h.symbol} className="vai-chip">
                    <TokenLogo symbol={h.symbol} image={h.image} size={20} />
                    <span className="vai-chip-sym">${h.symbol}</span>
                    {Number.isFinite(h.change24h) && (
                      <span className={`vai-chip-chg ${classOfPct(h.change24h)}`}>{fmtPct(h.change24h)}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : <div className="vai-empty">No tracked token positions.</div>}
          </div>
        </div>

        <div className="vai-foot">
          <div className="vai-foot-stat">
            <span className="vai-foot-label">Book 24h</span>
            <span className={`vai-foot-val ${classOfPct(a.momentum)}`}>{fmtPct(a.momentum)}</span>
          </div>
          <div className="vai-foot-stat">
            <span className="vai-foot-label">Positions</span>
            <span className="vai-foot-val">{a.holdingsCount}</span>
          </div>
          <div className="vai-foot-stat">
            <span className="vai-foot-label">Style</span>
            <span className="vai-foot-val vai-foot-val--word">{a.concentration}</span>
          </div>
          {a.focus.length > 0 && (
            <div className="vai-foot-focus">
              <span className="vai-foot-label">2026 focus</span>
              <div className="vai-focus-tags">{a.focus.map((f) => <span key={f} className="vai-focus-tag">{f}</span>)}</div>
            </div>
          )}
        </div>
        </>}
      </div>
    </>
  )
}
