/**
 * X Intel shared bits — chips, stamps, skeletons and format helpers used by
 * every Signal Desk tab. Numbers render in var(--font-mono) via .xi-num;
 * unknown values render as absent ("—" / omitted), never as a fabricated 0.
 */
import { useCallback, useState } from 'react'
import { useCopyToast } from '@/contexts/CopyToastContext'

/* ── format helpers ─────────────────────────────────────────────────── */

export function fmtUsdShort(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return `$${n.toFixed(2)}`
}

export function fmtCount(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return String(Math.round(n))
}

export function fmtPct(v, { sign = true, digits = 1 } = {}) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const s = sign && n > 0 ? '+' : ''
  return `${s}${n.toFixed(Math.abs(n) >= 1000 ? 0 : digits)}%`
}

export function fmtAgo(ts) {
  const t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return null
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function shortCa(address) {
  if (!address || address.length < 12) return address || null
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/* ── chips & stamps ─────────────────────────────────────────────────── */

// Token logo for PRE-CG names: DexScreener's token-image CDN is the only
// logo source that exists before a CoinGecko row does. Letter-circle
// fallback when the CDN has nothing (prod CSP img-src already allows
// *.dexscreener.com).
export function TokenLogo({ chain, address, symbol, size = 26 }) {
  const [broken, setBroken] = useState(false)
  const src = chain && address
    ? `https://dd.dexscreener.com/ds-data/tokens/${String(chain).toLowerCase()}/${address}.png?size=lg`
    : null
  if (!src || broken) {
    return (
      <span className="xi-tlogo xi-tlogo--fallback" style={{ width: size, height: size }} aria-hidden="true">
        {String(symbol || '?').replace(/^\$/, '').slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className="xi-tlogo"
      style={{ width: size, height: size }}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  )
}

export function ChainChip({ chain }) {
  if (!chain) return null
  return <span className="xi-chain">{String(chain).toLowerCase()}</span>
}

// tone: fresh | running | graded-up | graded-down | brewing | faded
export function StatusChip({ tone, children }) {
  return <span className={`xi-status xi-status--${tone}`}>{children}</span>
}

export function AgoStamp({ ts, prefix }) {
  const label = fmtAgo(ts)
  if (!label) return null
  return (
    <span className="xi-ago">
      {prefix ? `${prefix} ` : ''}{label}
    </span>
  )
}

// Copyable contract address + the two act-on-it links (DexScreener, X search).
// The CA is the only project-unique key — always shown next to a chain chip so
// multi-chain ticker clones can't be confused (the two-CASHCATs lesson).
export function CaRow({ address, chain, symbol }) {
  const { triggerCopyToast } = useCopyToast()
  const copy = useCallback((e) => {
    e.stopPropagation()
    if (!address) return
    try {
      navigator.clipboard.writeText(address)
      triggerCopyToast('CA copied to clipboard')
    } catch { /* clipboard unavailable */ }
  }, [address, triggerCopyToast])

  if (!address) return null
  const dexUrl = `https://dexscreener.com/search?q=${encodeURIComponent(address)}`
  const xUrl = `https://x.com/search?q=${encodeURIComponent(symbol ? `$${symbol}` : address)}&f=live`
  return (
    <div className="xi-ca-row">
      <button type="button" className="xi-ca" onClick={copy} title={address}>
        <span className="xi-ca__addr xi-num">{shortCa(address)}</span>
        <svg className="xi-ca__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <ChainChip chain={chain} />
      <span className="xi-ca-row__spacer" />
      <a className="xi-linkout" href={dexUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>chart</a>
      <a className="xi-linkout" href={xUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>on 𝕏</a>
    </div>
  )
}

/* ── carrier stack (the faces carrying a token — the old table's soul) ── */

function CarrierAvatar({ author }) {
  const [broken, setBroken] = useState(false)
  const img = author.avatar_image_url ? author.avatar_image_url.replace('_normal', '_bigger') : null
  const title = `@${author.screen_name}${author.mention_count ? ` · ${author.mention_count} mentions` : ''}`
  if (img && !broken) {
    return (
      <img
        className="xi-carrier-av"
        src={img}
        alt={author.screen_name}
        title={title}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  return <span className="xi-carrier-av xi-carrier-av--fallback" title={title}>{(author.name || author.screen_name || '?').slice(0, 1)}</span>
}

// Overlapping KOL faces + a "+N" overflow. authors = row.top_authors (the
// strongest carriers), total = the full external-author count for the overflow.
export function CarrierStack({ authors, total, max = 4 }) {
  const list = (authors || []).filter((a) => a && !a.is_self_author && a.screen_name).slice(0, max)
  if (!list.length) return <span className="xi-carriers-empty">—</span>
  const totalN = Number(total)
  const overflow = Number.isFinite(totalN) ? Math.max(totalN - list.length, 0) : 0
  return (
    <span className="xi-carriers">
      {list.map((a) => <CarrierAvatar key={a.author_rest_id || a.screen_name} author={a} />)}
      {overflow > 0 ? <span className="xi-carrier-more xi-num">+{fmtCount(overflow)}</span> : null}
    </span>
  )
}

/* ── score bar (0-100, warm-white fill — no hue) ────────────────────── */

export function ScoreBar({ score, tier }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  return (
    <span className={`xi-scorebar${tier ? ` xi-scorebar--${tier}` : ''}`}>
      <span className="xi-scorebar__num xi-num">{Math.round(s)}</span>
      <span className="xi-scorebar__track">
        <span className="xi-scorebar__fill" style={{ width: `${s}%` }} />
      </span>
    </span>
  )
}

/* ── loading / empty / error states ─────────────────────────────────── */

export function XiShimmer({ variant = 'card', count = 6 }) {
  return (
    <div className={`xi-shimmer xi-shimmer--${variant}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`xi-shimmer__item animate-shimmer stagger-${(i % 5) + 1}`} />
      ))}
    </div>
  )
}

export function XiEmpty({ title, detail }) {
  return (
    <div className="xi-empty">
      <div className="xi-empty__title">{title}</div>
      {detail ? <div className="xi-empty__detail">{detail}</div> : null}
    </div>
  )
}

export function XiError({ message, onRetry }) {
  return (
    <div className="xi-empty xi-empty--error">
      <div className="xi-empty__title">Signal desk unreachable</div>
      {message ? <div className="xi-empty__detail">{message}</div> : null}
      {onRetry ? (
        <button type="button" className="xi-retry" onClick={onRetry}>Retry</button>
      ) : null}
    </div>
  )
}
