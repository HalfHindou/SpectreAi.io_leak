/**
 * RZ Pro Shared Primitives
 * Small components and utilities used by both research-zone-pro.jsx and rz-overview-tab.jsx.
 * Extracted to avoid circular dependency.
 */
import React from 'react'
import { motion } from 'framer-motion'
import {
  GlobeIcon, ExternalLinkIcon, TwitterXIcon,
} from '../data/rz-icons.jsx'

// ── Icon Exports ──────────────────────────────────────────────────────────────

export const GithubIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
)

export { GlobeIcon, TwitterXIcon } from '../data/rz-icons.jsx'

// ── Utility Functions ─────────────────────────────────────────────────────────

export function fmtChange(n) {
  if (n == null || Number.isNaN(Number(n))) return '0.00'
  return Number(n).toFixed(2)
}

export function fmtSupply(n) {
  if (n == null || !Number.isFinite(Number(n))) return '--'
  const num = Number(n)
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`
  return num.toLocaleString()
}

// ── MetricCell ────────────────────────────────────────────────────────────────

export const MetricCell = React.memo(({ label, value, sub, delta, prefix, className = '' }) => (
  <div className={`rz-pro-mc ${className}`}>
    <div className="rz-pro-mc-label">{label}</div>
    <div className="rz-pro-mc-value" title={typeof value === 'string' ? value : undefined}>
      {prefix && <span className="rz-pro-mc-prefix">{prefix}</span>}
      {value}
    </div>
    {delta != null && (
      <span className={`rz-pro-mc-delta ${delta >= 0 ? 'positive' : 'negative'}`}>
        {delta >= 0 ? '+' : ''}{typeof delta === 'number' ? delta.toFixed(2) : delta}%
      </span>
    )}
    {sub && <div className="rz-pro-mc-sub">{sub}</div>}
  </div>
))

// ── PerformanceHeatstrip ──────────────────────────────────────────────────────

export const PerformanceHeatstrip = React.memo(({ data, dayMode }) => {
  const getHeatColor = (v) => {
    if (v > 5) return 'rgba(16, 185, 129, 0.25)'
    if (v > 2) return 'rgba(16, 185, 129, 0.15)'
    if (v > 0) return 'rgba(16, 185, 129, 0.08)'
    if (v > -2) return 'rgba(239, 68, 68, 0.08)'
    if (v > -5) return 'rgba(239, 68, 68, 0.15)'
    return 'rgba(239, 68, 68, 0.25)'
  }
  return (
    <div className="rz-pro-heatstrip">
      {data.map((d, i) => (
        <motion.div key={d.label} className="rz-pro-heatstrip-cell"
          style={{ background: getHeatColor(d.value) }}
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}>
          <span className="rz-pro-heatstrip-label">{d.label}</span>
          <span className={`rz-pro-heatstrip-value ${d.value >= 0 ? 'positive' : 'negative'}`}>
            {d.value >= 0 ? '+' : ''}{d.value.toFixed(1)}%
          </span>
        </motion.div>
      ))}
    </div>
  )
})

// ── ProgressRing ──────────────────────────────────────────────────────────────

export const ProgressRing = React.memo(({ value, size = 36, strokeWidth = 3, color }) => {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - (value || 0) / 100)
  return (
    <svg className="rz-pro-progress-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color || 'rgb(var(--rz-token-rgb))'}
        strokeWidth={strokeWidth} strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }} />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" className="rz-pro-progress-ring-text">
        {Math.round(value || 0)}%
      </text>
    </svg>
  )
})

// ── MiniSparkline ─────────────────────────────────────────────────────────────

export const MiniSparkline = React.memo(({ data, width = 80, height = 24, color = '#3b82f6', fill = false }) => {
  if (!data?.length || data.length < 2) return null
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - 2 - ((v - min) / range) * (height - 4)
    return `${x},${y}`
  })
  const isUp = data[data.length - 1] >= data[0]
  const lineColor = color === 'auto' ? (isUp ? '#10b981' : '#ef4444') : color
  return (
    <svg width={width} height={height} className="rz-pro-sparkline" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      {fill && (
        <polygon
          points={`0,${height} ${pts.join(' ')} ${width},${height}`}
          fill={lineColor}
          opacity="0.1"
        />
      )}
      <polyline points={pts.join(' ')} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
})

// ── MiniGauge ─────────────────────────────────────────────────────────────────

export const MiniGauge = React.memo(({ value, max = 100, size = 72, label, color: colorProp }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const color = colorProp || (pct >= 60 ? '#22c55e' : pct >= 40 ? '#eab308' : '#ef4444')
  const r = (size - 10) / 2
  const circ = Math.PI * r
  const offset = circ * (1 - pct / 100)
  return (
    <div className="rz-pro-mini-gauge" style={{ width: size, textAlign: 'center' }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
        <path
          d={`M 5 ${size / 2} A ${r} ${r} 0 0 1 ${size - 5} ${size / 2}`}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" strokeLinecap="round"
        />
        <path
          d={`M 5 ${size / 2} A ${r} ${r} 0 0 1 ${size - 5} ${size / 2}`}
          fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="rz-pro-mini-gauge-val" style={{ color, marginTop: -6, fontSize: 18, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
        {typeof value === 'number' ? (max <= 10 ? value.toFixed(1) : Math.round(value)) : value}
      </div>
      {label && <div className="rz-pro-mini-gauge-label" style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{label}</div>}
    </div>
  )
})

// ── SectionDivider ────────────────────────────────────────────────────────────

export const SectionDivider = ({ title, icon }) => (
  <div className="rz-pro-section-divider">
    {icon && <span className="rz-pro-section-divider-icon">{icon}</span>}
    <span className="rz-pro-section-divider-label">{title}</span>
  </div>
)

// ── RzInfoIcon ───────────────────────────────────────────────────────────────
// Small (i) glyph that hooks into the global `data-tooltip` system
// (initialized in main.jsx via initTooltipSystem).

export const RzInfoIcon = ({ tip, pos = 'top', className = '' }) => {
  if (!tip) return null
  return (
    <span
      className={`rz-info-icon ${className}`}
      data-tooltip={tip}
      data-tooltip-pos={pos}
      role="img"
      aria-label={tip}
      tabIndex={0}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 7.25v3.75" strokeLinecap="round" />
        <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}

// ── TokenLinksBar ─────────────────────────────────────────────────────────────

const TOKEN_LINK_DEFS = [
  { key: 'website', label: 'Website', icon: <GlobeIcon size={14} /> },
  { key: 'explorer', label: 'Explorer', icon: <ExternalLinkIcon size={14} /> },
  { key: 'twitter', label: 'Twitter/X', icon: <TwitterXIcon size={14} /> },
  { key: 'github', label: 'GitHub', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg> },
  { key: 'reddit', label: 'Reddit', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" /></svg> },
  { key: 'telegram', label: 'Telegram', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg> },
  { key: 'discord', label: 'Discord', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z"/></svg> },
]

// Socials are sourced live from Codex (`token.socialLinks`) + CoinGecko
// (`coinDetails.links`) and merged in `useResearchZoneData`. No hardcoded
// fallbacks — if a token has no on-chain or CG metadata, the socials row
// is hidden entirely.

// ── useAnimatedValue ────────────────────────────────────────────────────────
export function useAnimatedValue(target, duration = 800) {
  const [current, setCurrent] = React.useState(0)
  const rafRef = React.useRef(null)
  const startRef = React.useRef(null)
  const fromRef = React.useRef(0)

  React.useEffect(() => {
    fromRef.current = current
    startRef.current = null
    const animate = (ts) => {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(fromRef.current + (target - fromRef.current) * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])

  return current
}

export const TokenLinksBar = React.memo(({ symbol, coinDetails, dayMode }) => {
  const allLinks = {}
  if (coinDetails?.links) {
    const cl = coinDetails.links
    // Support both flat (normalized) and nested (raw CoinGecko) link formats
    if (cl.homepage) allLinks.website = Array.isArray(cl.homepage) ? cl.homepage[0] : cl.homepage
    if (cl.explorer) allLinks.explorer = cl.explorer
    if (cl.blockchain_site?.[0]) allLinks.explorer = cl.blockchain_site[0]
    if (cl.twitter) allLinks.twitter = cl.twitter
    if (cl.twitter_screen_name) allLinks.twitter = `https://twitter.com/${cl.twitter_screen_name}`
    if (cl.reddit) allLinks.reddit = cl.reddit
    if (cl.subreddit_url) allLinks.reddit = cl.subreddit_url
    if (cl.github) allLinks.github = cl.github
    if (cl.repos_url?.github?.[0]) allLinks.github = cl.repos_url.github[0]
    if (cl.telegram) allLinks.telegram = cl.telegram
    if (cl.telegram_channel_identifier) allLinks.telegram = `https://telegram.me/${cl.telegram_channel_identifier}`
    if (cl.discord) allLinks.discord = cl.discord
  }

  const available = TOKEN_LINK_DEFS.filter(l => allLinks[l.key])
  if (available.length === 0) return null

  return (
    <motion.div
      className="rz-pro-token-links-bar"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {available.map(link => (
        <a
          key={link.key}
          href={allLinks[link.key]}
          target="_blank"
          rel="noopener noreferrer"
          className="rz-pro-token-link-pill"
        >
          {link.icon}
          <span>{link.label}</span>
        </a>
      ))}
    </motion.div>
  )
})
