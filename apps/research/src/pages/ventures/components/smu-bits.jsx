/**
 * Shared render primitives for the Smart Money Universe views — fund avatars,
 * token logos, and the overlapping backer stack. Kept tiny and dependency-free
 * so Token Consensus / VC Bubbles / Sector Map all render identical chrome.
 */
import React, { useState } from 'react'
import { parseUsdAum, fmtUsdCompact } from './smu-shared'
import { useFundLogo } from './smu-logos'
import './smu-bits.css'
import './smu.day-mode.css'

// Circular fund avatar. Logo resolution is global + cached (see smu-logos.js),
// so this never triggers a per-render fallback storm. While resolving we show
// initials; they swap to the logo once (and only once) it's known good.
export function FundAvatar({ entity, size = 28, ring = false, title }) {
  const url = useFundLogo(entity?.logo_domain)
  const initials = (entity?.name || '?').replace(/[^A-Za-z0-9]/g, ' ').trim().slice(0, 2).toUpperCase()
  const style = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    borderRadius: '50%',
    ...(ring ? { boxShadow: '0 0 0 1.5px rgba(255,255,255,0.14)' } : null),
  }
  if (url) {
    return <img src={url} alt="" className="smu-avatar" style={style} title={title} draggable={false} />
  }
  return (
    <span
      className="smu-avatar smu-avatar--fallback"
      style={{ ...style, fontSize: Math.max(8, Math.round(size * 0.36)) }}
      title={title}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

// Token logo disc with initials fallback.
export function TokenLogo({ symbol, image, size = 26 }) {
  const [broken, setBroken] = useState(false)
  const sym = String(symbol || '').toUpperCase()
  const style = { width: size, height: size, borderRadius: '50%' }
  if (image && !broken) {
    return (
      <img
        src={image}
        alt=""
        className="smu-token-logo"
        style={style}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span className="smu-token-logo smu-token-logo--fallback" style={{ ...style, fontSize: Math.max(8, size * 0.4) }} aria-hidden="true">
      {sym.slice(0, 1)}
    </span>
  )
}

/**
 * Overlapping stack of backer avatars, ordered as given (biggest AUM first),
 * with a "+N" overflow pill. Each avatar carries a hover tooltip (name + AUM).
 */
export function BackerStack({ entities, max = 8, size = 30, onSelect }) {
  const shown = entities.slice(0, max)
  const overflow = entities.length - shown.length
  return (
    <div className="smu-stack" style={{ '--smu-av': `${size}px` }}>
      {shown.map((e, i) => {
        const aum = parseUsdAum(e.aum_estimate)
        const tip = aum != null ? `${e.name} · ${fmtUsdCompact(aum)}` : e.name
        // span (not button) — these render INSIDE clickable row/cell buttons,
        // and nested <button> is invalid DOM. role+keydown keep it accessible.
        return (
          <span
            key={e.id || i}
            role={onSelect ? 'button' : undefined}
            className="smu-stack-item"
            style={{ zIndex: shown.length - i, marginLeft: i === 0 ? 0 : -(size * 0.42) }}
            onClick={onSelect ? (ev) => { ev.stopPropagation(); onSelect(e.id) } : undefined}
            onKeyDown={onSelect ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.stopPropagation(); ev.preventDefault(); onSelect(e.id) } } : undefined}
            tabIndex={onSelect ? 0 : -1}
          >
            <FundAvatar entity={e} size={size} ring />
            <span className="smu-stack-tip" role="tooltip">
              <span className="smu-stack-tip-name">{e.name}</span>
              {aum != null && <span className="smu-stack-tip-aum">{fmtUsdCompact(aum)}</span>}
            </span>
          </span>
        )
      })}
      {overflow > 0 && <span className="smu-stack-more" style={{ marginLeft: -(size * 0.42) }}>+{overflow}</span>}
    </div>
  )
}
