/**
 * Research Zone — Project Tab v3 (Apple Cinematic).
 *
 * Replaces the dense bento grid with full-width editorial sections.
 * Each section has a single focus, generous breathing room, and uses the
 * token's brand color as the only accent. No more "PROJECT · LABEL" chrome,
 * no tiny gauges fighting for attention. One story, top to bottom.
 *
 * Sections:
 *   1. Stage         — token identity + price + key stats (60vh hero)
 *   2. Read          — Spectre Take (AI editorial) + What's Driving
 *   3. Health        — Risk + Opportunity as twin huge numbers
 *   4. Positioning   — sentiment gauge + L/S + funding + liq + OI breakdown
 *   5. Holders       — distribution stack + top wallets list
 *   6. Builders      — team grid + partners + investors
 *   7. Building      — whitepaper feature + roadmap timeline + docs
 *   8. Activity      — chronological feed (news + signals + whales)
 *   9. Reference     — tags, links, hacks, trust score
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './rz-project-cinema.css'
import { RzInfoIcon } from './rz-pro-shared'
import RzChainTvlSection from './rz-chain-tvl-section'
import { isMajorToken } from '@/constants/majorTokens'

/* ── Formatters ──────────────────────────────────────────────────────── */
function fmtUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n).toLocaleString()}`
}
function fmtCompact(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}
function fmtPct(v, d = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n > 0 ? '+' : ''}${n.toFixed(d)}%`
}
function fmtAge(ts) {
  if (!ts) return null
  const ms = ts > 1e12 ? ts : ts * 1000
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86400_000))
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${(days / 365).toFixed(1)}y`
}
function fmtRel(iso) {
  if (!iso) return null
  const ms = typeof iso === 'number' ? iso : new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  const days = Math.round((ms - Date.now()) / 86400_000)
  if (Math.abs(days) < 1) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days > 0 && days < 30) return `in ${days}d`
  if (days < 0 && days > -30) return `${Math.abs(days)}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/* ── Role categorization (for color-coded team cards) ──────────────── */
function roleTone(position) {
  if (!position) return 'neutral'
  const p = String(position).toLowerCase()
  if (/founder|ceo|cofound|chief executive/.test(p)) return 'founder'
  if (/cto|chief tech|head of (eng|tech)/.test(p)) return 'tech'
  if (/coo|chief op/.test(p)) return 'ops'
  if (/security|audit/.test(p)) return 'security'
  if (/blockchain|solidity|smart.?contract|on.?chain/.test(p)) return 'chain'
  if (/engineer|developer|engineering|backend|frontend|full.?stack/.test(p)) return 'engineer'
  if (/design|product|ux|ui/.test(p)) return 'design'
  if (/research|analyst|data/.test(p)) return 'research'
  if (/marketing|growth|community/.test(p)) return 'growth'
  return 'neutral'
}

/* ── Scroll-reveal hook ──────────────────────────────────────────────── */
// Pre-reveal sections well before they enter the viewport so the user never
// sees an empty `opacity: 0` band. `rootMargin` of 400px below the viewport
// means a section starts its fade-in while it's still scrolling up into view,
// finishing right around the moment it would otherwise be visible.
function useReveal() {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    // If the element is already inside the (expanded) viewport on mount —
    // which happens for everything above the fold — reveal immediately.
    const rect = el.getBoundingClientRect()
    const vh = window.innerHeight || document.documentElement.clientHeight
    if (rect.top < vh + 400 && rect.bottom > -100) { setShown(true); return }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setShown(true); io.disconnect(); break }
      }
    }, { threshold: 0, rootMargin: '0px 0px 400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown])
  return [ref, shown]
}

const Section = ({ children, className = '', as: Tag = 'section' }) => {
  const [ref, shown] = useReveal()
  return (
    <Tag ref={ref} className={`cine-section ${shown ? 'cine-in' : ''} ${className}`}>
      {children}
    </Tag>
  )
}

const SectionHead = ({ eyebrow, title, sub, tip }) => (
  <header className="cine-head">
    {eyebrow && (
      <span className="cine-eyebrow">
        {eyebrow}
        {tip && <RzInfoIcon tip={tip} />}
      </span>
    )}
    <h2 className="cine-title">{title}</h2>
    {sub && <p className="cine-sub">{sub}</p>}
  </header>
)

const ARROW = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 17 17 7"/><path d="M8 7h9v9"/>
  </svg>
)

/* ── 1. STAGE — Hero ─────────────────────────────────────────────────── */
function StageSection({ sym, td, fmtPrice, tokenColor, dossier, score, risk, onChainData }) {
  const tokenRgb = tokenColor?.bg || '139, 92, 246'
  const initials = (td?.name || sym || '?').slice(0, 2).toUpperCase()
  const change24h = td?.change24h
  const dir = change24h == null ? null : change24h > 0 ? 'up' : change24h < 0 ? 'down' : null
  const tagline = dossier?.tagline || dossier?.organization?.description || null

  // Hero stats: intel-specific metrics. Market Cap / 24h Volume already
  // shown in the right sidebar — no need to duplicate.
  const dossierScore = dossier?.spectreScore != null ? Number(dossier.spectreScore) : null
  const overallScore = Number(score?.overall) > 0 ? Number(score.overall) : (dossierScore || null)
  const onchainExp = dossier?.onchainExplorer
  const conviction = dossier?.conviction
  const convictionLabel = conviction?.tier && conviction?.stance
    ? `${conviction.stance} · ${conviction.tier}`
    : null
  const launchIso = dossier?.launchDate || onChainData?.launchedAt || null
  const launchYear = launchIso ? (new Date(launchIso).getFullYear() || null) : null

  // Native L1 assets: no ERC-20-style holders, on-chain age comes from a
  // wrapped-token sidedata source and is wrong. Compute age from launch date
  // when available, hide holders entirely.
  const NATIVE_L1 = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ATOM', 'NEAR', 'XLM', 'XMR', 'TON', 'APT', 'SUI', 'HBAR', 'ICP', 'FIL', 'KAS', 'ALGO', 'EGLD', 'XTZ'])
  const isNativeAsset = NATIVE_L1.has(String(sym || td?.symbol || dossier?.symbol || '').toUpperCase())
  const holders = isNativeAsset ? null : (onchainExp?.holdersCount ?? null)
  let ageDisplay = null
  if (launchIso) {
    const ms = Date.now() - new Date(launchIso).getTime()
    if (Number.isFinite(ms) && ms > 0) {
      const years = ms / (365.25 * 24 * 3600 * 1000)
      ageDisplay = years >= 1 ? `${years.toFixed(1)}y` : `${Math.round(ms / (30 * 24 * 3600 * 1000))}mo`
    }
  }
  if (!ageDisplay) ageDisplay = fmtAge(onChainData?.age) || null

  const stats = [
    ageDisplay && { k: 'Age', v: ageDisplay },
    overallScore != null && { k: 'Spectre Score', v: overallScore.toFixed(0) },
    risk?.score != null && { k: 'Risk', v: `${risk.score}/100`, accent: risk.band === 'safe' ? 'up' : risk.band === 'moderate' ? 'mid' : 'down' },
    holders != null && { k: 'Holders', v: holders >= 1000 ? `${(holders / 1000).toFixed(1)}K` : holders.toLocaleString() },
    convictionLabel && { k: 'Conviction', v: convictionLabel, accent: conviction.stance === 'bullish' ? 'up' : conviction.stance === 'bearish' ? 'down' : 'mid' },
    launchYear && { k: 'Launched', v: String(launchYear) },
  ].filter(Boolean)

  // Drop the identity row (logo + name + price) — already shown by the
  // research-zone hero above the chart. Keep tagline + intel stats only.
  if (!tagline && !stats.length) return null
  return (
    <section className="cine-stage" style={{ '--cine-rgb': tokenRgb }}>
      <div className="cine-stage-aurora" aria-hidden="true" />
      <div className="cine-stage-inner">
        {tagline && (
          <p className="cine-stage-tagline">{tagline.slice(0, 240)}{tagline.length > 240 ? '…' : ''}</p>
        )}
        {stats.length > 0 && (
          <div className="cine-stage-stats">
            {stats.map((s) => (
              <div key={s.k} className="cine-stage-stat">
                <span className="cine-stage-stat-k">{s.k}</span>
                <span className={`cine-stage-stat-v mono${s.accent ? ` cine-stage-stat-v--${s.accent}` : ''}`}>{s.v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/* ── 2. READ — Spectre Take + What's Driving ─────────────────────────── */
function ReadSection({ take, takeAt, signals, sentiment, td, whales, conviction, sym }) {
  const { t } = useTranslation()
  if (!take && !signals?.active?.length && !sentiment?.score && !td?.change24h) return null
  // Only show a verdict label when the brain has real conviction on this asset.
  // For long-tail tokens (ZIG, etc.) the take often falls back to a macro
  // market brief that isn't asset-specific — labelling that BEARISH/BULLISH
  // is misleading. Require has_conviction OR the take to mention the symbol.
  const symRe = sym ? new RegExp(`\\b\\$?${sym}\\b`, 'i') : null
  const takeMentionsAsset = !!(take && symRe && symRe.test(take))
  // A "take" that's just the asset name + symbol ("ZIGChain (ZIG)") isn't
  // useful — drop anything under 60 chars. Real takes are sentences.
  const takeIsSubstantive = !!(take && String(take).trim().length >= 60)
  const showTake = takeMentionsAsset && takeIsSubstantive
  const showVerdict = !!conviction?.has_conviction && takeMentionsAsset && takeIsSubstantive
  const verdictMatch = showVerdict && take && take.match(/\b(bullish|bearish|neutral|mixed)\b/i)
  const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'neutral'
  // takeAt is usually an ISO string from the dossier proxy. Doing
  // `Date.now() - "2026-…"` returns NaN — the previous code rendered
  // "Synthesized by Spectre AI · NaNh ago". Coerce to ms first.
  const takeAtMs = takeAt == null ? null
    : typeof takeAt === 'number' ? takeAt
    : new Date(takeAt).getTime()
  const ageMin = Number.isFinite(takeAtMs)
    ? Math.max(0, Math.round((Date.now() - takeAtMs) / 60_000))
    : null

  const drivers = []
  if (signals?.active?.length) {
    const top = signals.active[0]
    drivers.push({ tone: top.direction || 'neutral', text: top.title })
  }
  const isMajorRead = isMajorToken(sym)
  const fundingPct = Number(sentiment?.derivatives?.weighted_funding_rate || 0) * 100
  if (isMajorRead && Math.abs(fundingPct) > 0.001) drivers.push({ tone: fundingPct < 0 ? 'bearish' : 'bullish', text: `Funding ${fundingPct >= 0 ? '+' : ''}${fundingPct.toFixed(4)}%` })
  const lsr = Number(sentiment?.longShortRatio?.long_short_ratio || 0)
  if (isMajorRead && lsr > 0) drivers.push({ tone: lsr > 1.2 ? 'bullish' : lsr < 0.8 ? 'bearish' : 'neutral', text: `Positioning L/S ${lsr.toFixed(2)} — ${lsr > 1 ? 'long-skewed' : 'short-skewed'}` })
  if (whales?.netFlow != null && Math.abs(whales.netFlow) > 0) {
    drivers.push({ tone: whales.netFlow > 0 ? 'bullish' : 'bearish', text: `Whales ${whales.netFlow > 0 ? 'accumulating' : 'distributing'} ${fmtUsd(Math.abs(whales.netFlow))} net 48h` })
  }
  if (Number(td?.change24h)) drivers.push({ tone: td.change24h > 0 ? 'bullish' : 'bearish', text: `Price ${fmtPct(td.change24h)} on ${fmtUsd(td.volume)} 24h volume` })

  return (
    <Section className="cine-read">
      <SectionHead eyebrow="Market Read" title={t('researchPro.cinema.read.title', "What the data is saying")} tip="Spectre AI's synthesis of price action, volume, and sentiment for this token, refreshed periodically." sub={ageMin != null ? `Synthesized by Spectre AI · ${ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`}` : 'Synthesized by Spectre AI'} />
      {showTake && (
        <blockquote className={`cine-quote cine-quote--${verdict}`}>
          {showVerdict && <span className={`cine-verdict cine-verdict--${verdict}`}>{verdict}</span>}
          <p>{take}</p>
        </blockquote>
      )}
      {drivers.length > 0 && (
        <ul className="cine-drivers">
          {drivers.slice(0, 5).map((d, i) => (
            <li key={i} className={`cine-driver cine-driver--${d.tone}`}>
              <span className="cine-driver-mark" aria-hidden="true" />
              <span>{d.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/* ── 3. HEALTH — Risk + Opportunity twins ────────────────────────────── */
function HealthSection({ risk, opp }) {
  const { t } = useTranslation()
  if (!risk?.score && !opp?.score) return null
  const single = !(risk?.score != null && opp?.score != null)
  const Twin = ({ kind, label, score, band, items, tone }) => {
    if (score == null) return null
    const pct = Math.max(0, Math.min(100, Math.round(score)))
    return (
      <div className={`cine-health-twin cine-health-twin--${tone || 'mid'}`} style={{ '--twin-pct': pct }}>
        <span className="cine-health-twin-eyebrow">{kind}</span>
        <span className="cine-health-twin-num mono">{Math.round(score)}</span>
        <span className="cine-health-twin-band">{band?.toUpperCase()}</span>
        <span className="cine-health-twin-label">{label}</span>
        {Array.isArray(items) && items.length > 0 && (
          <ul className="cine-health-twin-list">
            {items.slice(0, 5).map((it, i) => (
              <li key={i} className={`cine-health-twin-item ${it.ok || (it.points && it.points >= it.weight * 0.6) ? 'cine-health-twin-item--ok' : 'cine-health-twin-item--warn'}`}>
                <span className="cine-health-twin-glyph">{it.ok || (it.points && it.points >= it.weight * 0.6) ? '+' : '−'}</span>
                <span>{it.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const riskTone = risk?.band === 'safe' ? 'up' : risk?.band === 'moderate' ? 'mid' : 'down'
  const oppTone = opp?.band === 'strong' ? 'up' : opp?.band === 'moderate' ? 'mid' : 'down'

  return (
    <Section className={`cine-health${single ? ' cine-health--single' : ''}`}>
      <SectionHead eyebrow="Health" title={t('researchPro.cinema.health.title', "How safe, how strong")} tip="Composite risk and opportunity score combining security, liquidity, and on-chain activity." sub="Composite scoring across security, liquidity, and on-chain signal" />
      <div className="cine-health-twins">
        <Twin kind="Safety" label={t('researchPro.cinema.health.label', "Lower number = more risk vectors")} score={risk?.score} band={risk?.band} items={risk?.checks} tone={riskTone} />
        <Twin kind="Edge" label={t('researchPro.cinema.health.label2', "Higher number = stronger bullish setup")} score={opp?.score} band={opp?.band} items={opp?.factors} tone={oppTone} />
      </div>
    </Section>
  )
}

/* ── 4. POSITIONING — Sentiment + L/S + Funding + Liq + OI ────────────── */
function PositioningSection({ sentiment, sym }) {
  const { t } = useTranslation()
  if (!sentiment?.score) return null
  const score = Number(sentiment?.score) || 0
  const label = sentiment?.label || (score >= 70 ? 'Greedy' : score >= 50 ? 'Neutral' : score >= 30 ? 'Cautious' : 'Fearful')
  const sentTone = score >= 60 ? 'up' : score >= 40 ? 'mid' : 'down'

  // Funding rate / L-S ratio only meaningful for tokens with deep perp
  // markets — i.e. majors. For long-tail assets the upstream returns thin
  // synthetic numbers (-0.04% for ZIG with no real perps) which mislead.
  const isMajor = isMajorToken(sym)
  const fundingRaw = sentiment?.derivatives?.weighted_funding_rate
  const hasFunding = isMajor && fundingRaw != null && Number.isFinite(Number(fundingRaw))
  const fundingPct = hasFunding ? Number(fundingRaw) * 100 : 0
  const fundingTone = fundingPct < -0.005 ? 'down' : fundingPct > 0.005 ? 'up' : 'mid'

  const lsrRaw = sentiment?.longShortRatio?.long_short_ratio
  const hasLsr = isMajor && lsrRaw != null && Number.isFinite(Number(lsrRaw)) && Number(lsrRaw) > 0
  const lsr = hasLsr ? Number(lsrRaw) : 0
  const lsrTone = lsr > 1.2 ? 'up' : lsr < 0.8 ? 'down' : 'mid'

  const longLiq = Number(sentiment?.longShortRatio?.long_liq_24h_usd || 0)
  const shortLiq = Number(sentiment?.longShortRatio?.short_liq_24h_usd || 0)
  const totalLiq = longLiq + shortLiq
  const longPct = totalLiq > 0 ? (longLiq / totalLiq) * 100 : 0
  const liqTone = longLiq > shortLiq ? 'down' : 'up' // long liq = bearish, short liq = bullish

  // 4-cell stat grid — each cell: label / value / mini-viz / sub
  const cells = [
    {
      label: 'Sentiment', value: Math.round(score), sub: label.toLowerCase(),
      tone: sentTone,
      viz: <span className="cine-pos-cell-bar"><span style={{ width: `${score}%`, background: sentTone === 'up' ? '#34D399' : sentTone === 'mid' ? '#F59E0B' : '#F87171' }} /></span>,
    },
    hasFunding && {
      label: 'Funding', value: `${fundingPct >= 0 ? '+' : ''}${fundingPct.toFixed(4)}%`,
      sub: fundingPct < 0 ? 'shorts paying longs' : fundingPct > 0 ? 'longs paying shorts' : 'balanced',
      tone: fundingTone,
    },
    hasLsr && {
      label: 'L / S Ratio', value: lsr.toFixed(3),
      sub: lsr > 1.2 ? 'long-skewed' : lsr < 0.8 ? 'short-skewed' : 'balanced',
      tone: lsrTone,
    },
    totalLiq > 0 && {
      label: 'Liquidations 24h', value: fmtUsd(totalLiq),
      sub: longLiq > shortLiq ? 'longs hammered' : 'shorts squeezed',
      tone: liqTone,
      viz: (
        <span className="cine-pos-cell-split" title={`SHORT ${fmtUsd(shortLiq)} · LONG ${fmtUsd(longLiq)}`}>
          <span className="cine-pos-cell-split-short" style={{ width: `${100 - longPct}%` }} />
          <span className="cine-pos-cell-split-long" style={{ width: `${longPct}%` }} />
        </span>
      ),
    },
  ].filter(Boolean)

  return (
    <Section className="cine-pos">
      <SectionHead eyebrow="Market Positioning" title={t('researchPro.cinema.positioning.title', "Where the trade sits right now")} tip="Live read of trader sentiment — long/short ratio, funding rate, liquidations, and open interest." />
      <div className="cine-pos-grid">
        {cells.map((c) => (
          <div key={c.label} className={`cine-pos-cell cine-pos-cell--${c.tone}`}>
            <span className="cine-pos-cell-k">{c.label}</span>
            <span className="cine-pos-cell-v mono">{c.value}</span>
            {c.viz || <span className="cine-pos-cell-spacer" />}
            <span className="cine-pos-cell-sub">{c.sub}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ── 5. HOLDERS — Stack + top wallets ────────────────────────────────── */
function HoldersSection({ breakdown }) {
  const { t } = useTranslation()
  if (!breakdown || !breakdown.byKind) return null
  const kinds = [
    { key: 'exchange', label: 'Exchanges', color: '#3B82F6' },
    { key: 'dex', label: 'DEX pools', color: '#06B6D4' },
    { key: 'burn', label: 'Burn / Null', color: '#EF4444' },
    { key: 'contract', label: 'Contracts', color: '#A78BFA' },
    { key: 'eoa', label: 'Whales (EOA)', color: '#F59E0B' },
    { key: 'unknown', label: 'Unknown', color: '#6B7280' },
  ].map((k) => ({ ...k, pct: Number(breakdown.byKind[k.key]) || 0 })).filter((k) => k.pct > 0.01)
  if (!kinds.length) return null
  const items = Array.isArray(breakdown.items) ? breakdown.items.slice(0, 12) : []

  return (
    <Section className="cine-holders">
      <SectionHead eyebrow="Distribution" title={t('researchPro.cinema.holders.title', "Who is holding it")} tip="On-chain holder breakdown — concentration of supply across the largest wallets." sub={`Top 10 hold ${(breakdown.top10Pct || 0).toFixed(1)}% · Top 50: ${(breakdown.top50Pct || 0).toFixed(1)}% of supply`} />
      <div className="cine-holders-stack">
        {kinds.map((k) => (
          <span key={k.key} className="cine-holders-seg" style={{ width: `${k.pct}%`, background: k.color }} title={`${k.label} · ${k.pct.toFixed(2)}%`}>
            {k.pct >= 8 && <span>{k.label}</span>}
          </span>
        ))}
      </div>
      <ul className="cine-holders-legend">
        {kinds.map((k) => (
          <li key={k.key}>
            <span className="cine-holders-dot" style={{ background: k.color }} />
            <span>{k.label}</span>
            <span className="mono">{k.pct.toFixed(2)}%</span>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <ol className="cine-holders-table">
          {items.map((it, i) => (
            <li key={i}>
              <span className="cine-holders-rank mono">{String(i + 1).padStart(2, '0')}</span>
              <code className="cine-holders-addr mono">{it.address ? `${it.address.slice(0, 6)}…${it.address.slice(-4)}` : '?'}</code>
              <span className="cine-holders-tag" data-kind={it.kind}>{it.label || it.kind || 'unknown'}</span>
              <span className="cine-holders-pct mono">{Number(it.pct || 0).toFixed(2)}%</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

/* ── 6. BUILDERS — Team + Partners + Investors ───────────────────────── */
function BuildersSection({ team, partners, investors, fundraising }) {
  const { t } = useTranslation()
  const hasTeam = Array.isArray(team) && team.length > 0
  const hasPartners = Array.isArray(partners) && partners.length > 0
  const hasInvestors = (Array.isArray(investors) && investors.length > 0)
    || (Array.isArray(fundraising) && fundraising.some((r) => r.lead_investors?.length || r.all_investors?.length))
  if (!hasTeam && !hasPartners && !hasInvestors) return null

  const allInvestors = []
  const seen = new Set()
  if (Array.isArray(fundraising)) {
    for (const r of fundraising) {
      const list = (r.all_investors || r.lead_investors || [])
      for (const inv of list) {
        const key = String(inv).toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        allInvestors.push({ name: inv, lead: (r.lead_investors || []).includes(inv) })
      }
    }
  }
  if (Array.isArray(investors)) {
    for (const inv of investors) {
      const name = inv?.name || inv
      const key = String(name).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      allInvestors.push({ name, logoUrl: inv?.logoUrl || null, note: inv?.note || null })
    }
  }

  return (
    <Section className="cine-builders">
      <SectionHead eyebrow="The Team" title={t('researchPro.cinema.builders.title', "Who is building this")} tip="Founders, core contributors, partners, and investors backing the project." />

      {hasTeam && (
        <div className="cine-team">
          {team.map((m, i) => {
            const tone = roleTone(m.position)
            return (
              <article key={i} className={`cine-team-card cine-team-card--${tone}`}>
                <span className="cine-team-rank mono">{String(i + 1).padStart(2, '0')}</span>
                <div className="cine-team-avatar">
                  {m.avatar ? (
                    <img src={m.avatar} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.classList.add('cine-team-avatar--fallback') }} />
                  ) : null}
                  <span className="cine-team-avatar-letters">{(m.name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()}</span>
                </div>
                <div className="cine-team-body">
                  <span className="cine-team-name">{m.name}</span>
                  {m.position && <span className="cine-team-role"><span className="cine-team-role-dot" />{m.position}</span>}
                </div>
                <div className="cine-team-links">
                  {m.urls?.linkedin && <a href={m.urls.linkedin} target="_blank" rel="noopener noreferrer" aria-label={t('researchPro.cinema.builders.ariaLinkedin', "LinkedIn")}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.34 17.34H5.67V9.67h2.67v7.67zM7 8.5a1.55 1.55 0 1 1 0-3.1 1.55 1.55 0 0 1 0 3.1zm11.34 8.84h-2.67v-3.73c0-.89-.02-2.04-1.24-2.04-1.24 0-1.43.97-1.43 1.97v3.8h-2.67V9.67h2.56v1.05h.04a2.81 2.81 0 0 1 2.53-1.39c2.7 0 3.2 1.78 3.2 4.09v3.92z"/></svg></a>}
                  {m.urls?.github && <a href={m.urls.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 00-3.79 23.38c.6.11.82-.26.82-.58v-2.02c-3.33.72-4.04-1.61-4.04-1.61-.54-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.64 1.66.23 2.88.11 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .3"/></svg></a>}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {hasPartners && (
        <div className="cine-partners-block">
          <h3 className="cine-subtitle">{t('researchPro.cinema.builders.backedBy', "Backed by")}</h3>
          <div className="cine-partners">
            {partners.map((p, i) => (
              <div key={i} className="cine-partner">
                {p.logoUrl ? (
                  <img src={p.logoUrl} alt={p.name} loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                ) : (
                  <span className="cine-partner-fallback">{(p.name || '?').slice(0, 2).toUpperCase()}</span>
                )}
                <span className="cine-partner-name">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(fundraising) && fundraising.length > 0 && (
        <div className="cine-rounds">
          <h3 className="cine-subtitle">{t('researchPro.cinema.builders.fundingHistory', "Funding history")}</h3>
          <ul className="cine-rounds-list">
            {fundraising.map((r) => (
              <li key={r.id} className="cine-round">
                <div className="cine-round-meta">
                  <span className="cine-round-stage">{r.round_type || 'Round'}</span>
                  <span className="cine-round-date mono">{r.date ? new Date(r.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}</span>
                </div>
                <span className="cine-round-amount mono">{fmtUsd(r.amount_raised_usd)}</span>
                {r.valuation_usd && <span className="cine-round-val mono">@ {fmtUsd(r.valuation_usd)} val</span>}
                {(r.all_investors || r.lead_investors) && (
                  <span className="cine-round-investors">{(r.all_investors || r.lead_investors).slice(0, 6).join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {allInvestors.length > 0 && !fundraising?.length && (
        <div className="cine-investor-pills">
          {allInvestors.slice(0, 24).map((inv, i) => (
            <span key={i} className={`cine-investor-pill${inv.lead ? ' cine-investor-pill--lead' : ''}`}>
              {inv.logoUrl && <img src={inv.logoUrl} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />}
              {inv.name}{inv.lead ? ' · lead' : ''}
            </span>
          ))}
        </div>
      )}
    </Section>
  )
}

/* ── 6.5 FOUNDER SPOTLIGHT — single-founder showcase w/ timeline ─────── */
// Single-tone marker: solid filled circle in the section's accent color.
// We used to glyph-code each milestone (◇/◆/$/↗/◉ etc.) — too cute.

function isBirthday(mmDD) {
  if (!mmDD) return false
  const d = new Date()
  const today = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return today === mmDD
}

export function FounderSpotlightSection({ spotlight, standalone = false, wordmark = null }) {
  const { t } = useTranslation()
  if (!spotlight) return null
  const { name, role, handle, portrait, bio, quote, quoteDate, wins, milestones, podcasts, socials, birthday } = spotlight
  const showBirthday = isBirthday(birthday)
  const quoteAge = (() => {
    if (!quoteDate) return null
    const d = new Date(quoteDate)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  })()

  const Wrapper = standalone ? 'section' : Section
  // The /zigchain hub passes `standalone` and gets the amber ZIG palette;
  // research-zone uses the neutral palette inherited from `.cine-root`.
  const wrapperClass = `cine-fs${standalone ? ' cine-fs--standalone cine-fs--zig cine-in' : ''}`
  return (
    <Wrapper className={wrapperClass}>
      {wordmark && (
        <img src={wordmark} alt={t('researchPro.cinema.founderspotlight.altZigchain', "ZIGChain")} className="cine-fs-wordmark" loading="lazy" />
      )}
      <header className="cine-fs-head">
        <div className="cine-fs-head-l">
          <span className="cine-eyebrow">{t('researchPro.cinema.founderspotlight.founderSpotlight', "Founder Spotlight")}</span>
        </div>
        {showBirthday && (
          <span className="cine-fs-bday" role="status" aria-label={t('researchPro.cinema.founderspotlight.ariaHappyBirthday', "Happy Birthday")}>
            <span className="cine-fs-bday-glyph" aria-hidden="true">🎂</span>
            <span>{t('researchPro.cinema.founderspotlight.happyBirthday', "Happy Birthday")}</span>
          </span>
        )}
      </header>

      <article className="cine-fs-card">
        <div className="cine-fs-portrait">
          <img src={portrait} alt={name} loading="lazy" />
        </div>
        <div className="cine-fs-meta">
          <span className="cine-fs-name">{name}</span>
          <span className="cine-fs-role">{role}</span>
          {handle && <a href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer" className="cine-fs-handle">@{handle}</a>}
          {bio && <p className="cine-fs-bio">{bio}</p>}
          {Array.isArray(socials) && socials.length > 0 && (
            <div className="cine-fs-socials">
              {socials.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="cine-fs-social">{s.label}{ARROW}</a>
              ))}
            </div>
          )}
        </div>
      </article>

      {quote && (
        <blockquote className="cine-fs-quote">
          <span className="cine-fs-quote-mark" aria-hidden="true">“</span>
          <p>{quote}</p>
          {quoteAge && <span className="cine-fs-quote-attr">— {name.split(' ')[0]}, {quoteAge}</span>}
        </blockquote>
      )}

      {Array.isArray(wins) && wins.length > 0 && (
        <ul className="cine-fs-wins">
          {wins.map((w, i) => (
            <li key={i} className="cine-fs-win">
              <span className="cine-fs-win-v mono">{w.value}</span>
              <span className="cine-fs-win-l">{w.label}</span>
            </li>
          ))}
        </ul>
      )}

      {Array.isArray(milestones) && milestones.length > 0 && (
        <div className="cine-fs-timeline" aria-label={`${name} timeline`}>
          <span className="cine-fs-timeline-rail" aria-hidden="true" />
          {milestones.map((m, i) => (
            <div key={i} className={`cine-fs-tick cine-fs-tick--${m.kind || 'milestone'}`}>
              <span className="cine-fs-tick-dot" aria-hidden="true" />
              <span className="cine-fs-tick-year mono">{m.year}</span>
              <span className="cine-fs-tick-label">{m.label}</span>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(podcasts) && podcasts.length > 0 && (
        <div className="cine-fs-podcasts">
          <h3 className="cine-subtitle">Podcasts &amp; long-form appearances</h3>
          <ul className="cine-fs-pod-list">
            {podcasts.map((p, i) => (
              <li key={i} className={`cine-fs-pod${p.hosting ? ' cine-fs-pod--host' : ''}`}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="cine-fs-pod-link">
                  {p.thumbUrl && (
                    <span className="cine-fs-pod-thumb">
                      <img src={p.thumbUrl} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                      <span className="cine-fs-pod-play" aria-hidden="true">▶</span>
                    </span>
                  )}
                  <span className="cine-fs-pod-body">
                    <span className="cine-fs-pod-meta">
                      {p.host && <span className="cine-fs-pod-host">{p.host}</span>}
                      {p.length && <span className="cine-fs-pod-len">{p.length}</span>}
                      {p.date && <span className="cine-fs-pod-date mono">{p.date}</span>}
                    </span>
                    <span className="cine-fs-pod-title">{p.title}</span>
                  </span>
                  <span className="cine-fs-pod-arrow" aria-hidden="true">{ARROW}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Wrapper>
  )
}

/* ── 7. BUILDING — Whitepaper + Manifesto + Roadmap + Docs ───────────── */
function BuildingSection({ whitepaperUrl, whitepaperThumb, roadmap, docsToc, sym, description, websiteUrl }) {
  const { t } = useTranslation()
  const hasRoadmap = Array.isArray(roadmap) && roadmap.length > 0
  const hasDocs = Array.isArray(docsToc) && docsToc.length > 0
  // 2026-05-27: render even without a formal whitepaper URL. Many projects
  // (CULT, memes, indie L1s) don't have a published PDF — but they DO have a
  // long-form description / manifesto that's the equivalent. Show it inline
  // as an expandable "About" / "Manifesto" block. Section is hidden only when
  // all four signals are missing.
  const hasLongDescription = typeof description === 'string' && description.trim().length > 200
  if (!whitepaperUrl && !hasRoadmap && !hasDocs && !hasLongDescription) return null

  // When we have no formal whitepaper but rich description, treat the
  // description as the manifesto.
  const treatDescriptionAsManifesto = !whitepaperUrl && hasLongDescription

  return (
    <Section className="cine-building">
      <SectionHead
        eyebrow="Direction"
        title={t('researchPro.cinema.building.title', "What they are building")}
        tip="Whitepaper, manifesto, roadmap and docs — what's been shipped, what's next, and how they explain themselves."
      />

      {whitepaperUrl && (
        <a href={whitepaperUrl} target="_blank" rel="noopener noreferrer" className="cine-wp">
          {whitepaperThumb ? (
            <img className="cine-wp-thumb" src={whitepaperThumb} alt="" loading="lazy" />
          ) : (
            <div className="cine-wp-thumb cine-wp-thumb--ph">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
          )}
          <div className="cine-wp-body">
            <span className="cine-wp-eyebrow">{t('researchPro.cinema.building.whitepaper', "Whitepaper")}</span>
            <span className="cine-wp-title">Read the {sym} whitepaper</span>
            <span className="cine-wp-host mono">{(() => { try { return new URL(whitepaperUrl).hostname.replace(/^www\./, '') } catch { return whitepaperUrl } })()}</span>
          </div>
          <span className="cine-wp-arrow">{ARROW}</span>
        </a>
      )}

      {treatDescriptionAsManifesto && (
        <div className="cine-manifesto">
          <span className="cine-wp-eyebrow">{t('researchPro.cinema.building.manifesto', "Manifesto")}</span>
          <div className="cine-manifesto-body">
            {description.split(/\n\n+/).slice(0, 6).map((para, i) => (
              <p key={i} className="cine-manifesto-para">{para.trim()}</p>
            ))}
          </div>
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="cine-manifesto-cta">
              Read more on {(() => { try { return new URL(websiteUrl).hostname.replace(/^www\./, '') } catch { return 'project site' } })()}
              <span className="cine-wp-arrow">{ARROW}</span>
            </a>
          )}
        </div>
      )}

      {hasRoadmap && (
        <div className="cine-roadmap">
          <h3 className="cine-subtitle">{t('researchPro.cinema.building.roadmap', "Roadmap")}</h3>
          <ol className="cine-roadmap-list">
            {roadmap.map((m, i) => (
              <li key={i} className="cine-roadmap-item">
                <span className="cine-roadmap-dot" />
                {m.date && <span className="cine-roadmap-date mono">{m.date}</span>}
                <div className="cine-roadmap-title-block">
                  <span className="cine-roadmap-title">{m.title}</span>
                  {m.description && <p className="cine-roadmap-desc">{m.description}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {hasDocs && (
        <div className="cine-docs">
          <h3 className="cine-subtitle">{t('researchPro.cinema.building.documentation', "Documentation")}</h3>
          <ul className="cine-docs-list">
            {docsToc.map((d, i) => (
              <li key={i}>
                <a href={d.url} target="_blank" rel="noopener noreferrer">
                  <span className="cine-docs-num mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="cine-docs-title">{d.title}</span>
                  <span className="cine-docs-arrow">{ARROW}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

/* ── 8. ACTIVITY — Combined feed ─────────────────────────────────────── */
const FEED_GLYPHS = {
  news: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
      <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6z"/>
    </svg>
  ),
  whale: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
    </svg>
  ),
  signal: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
}

function ActivitySection({ news, signals, whales }) {
  const { t } = useTranslation()
  const items = []
  if (Array.isArray(news)) news.slice(0, 8).forEach((n) => items.push({ kind: 'news', time: n.publishedAt, title: n.title, source: n.source, url: n.url, tone: n.sentiment }))
  if (Array.isArray(signals?.active)) signals.active.slice(0, 6).forEach((s) => items.push({ kind: 'signal', time: new Date(s.createdAt).getTime(), title: s.title, source: (s.type || '').replace(/_/g, ' '), tone: s.direction }))
  if (Array.isArray(whales?.transactions)) whales.transactions.slice(0, 6).forEach((w) => items.push({ kind: 'whale', time: new Date(w.time).getTime(), title: `Whale ${(w.type || '').toLowerCase().includes('buy') ? 'BUY' : 'SELL'} ${fmtUsd(w.valueUsd)}`, source: `${w.from || '?'} → ${w.to || '?'}`, tone: (w.type || '').toLowerCase().includes('buy') ? 'bullish' : 'bearish' }))
  if (!items.length) return null
  items.sort((a, b) => (b.time || 0) - (a.time || 0))

  return (
    <Section className="cine-feed">
      <SectionHead eyebrow="Activity" title={t('researchPro.cinema.activity.title', "What is happening")} tip="Chronological feed of news, AI signals, and on-chain whale movements for this token." sub={`${items.length} events · merged across news, signals, and on-chain`} />
      <ul className="cine-feed-list">
        {items.slice(0, 12).map((it, i) => (
          <li key={i} className={`cine-feed-item cine-feed-item--${it.tone || 'neutral'}`}>
            <span className="cine-feed-icon" aria-hidden="true">{FEED_GLYPHS[it.kind] || FEED_GLYPHS.signal}</span>
            <div className="cine-feed-body">
              {it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="cine-feed-title">{it.title}</a> : <span className="cine-feed-title">{it.title}</span>}
              {it.source && <span className="cine-feed-source">{it.source}</span>}
            </div>
            <span className="cine-feed-time mono">{fmtRel(it.time)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/* ── 9. REFERENCE — footer with tags, hacks, trust ───────────────────── */
function ReferenceSection({ dossier, spectreData, sym, coinDetails, spectreSocial, activeTokenInfo }) {
  const { t } = useTranslation()
  const hacks = Array.isArray(dossier?.hacks) ? dossier.hacks : []
  const tags = Array.isArray(dossier?.tags) ? dossier.tags : []
  const audits = Array.isArray(dossier?.audits) ? dossier.audits : []
  const used = dossier?.sourcesUsed || {}
  const sources = [
    { k: 'Market Data',         on: !!(used.coinpaprika || used.coingecko) },
    { k: 'Token Registry',      on: !!used.coingecko },
    { k: 'TVL & Protocols',     on: !!used.defillama },
    { k: 'Project Research',    on: !!used.messari },
    { k: 'Code Activity',       on: !!used.github },
    { k: 'Documentation',       on: !!used.gitbook },
    { k: 'Community Chat',      on: !!used.discord },
    { k: 'Community Group',     on: !!used.telegram },
    { k: 'Community Forum',     on: !!used.reddit },
    { k: 'Governance',          on: !!used.snapshot },
    { k: 'Blockchain Explorer', on: !!used.explorer },
    { k: 'Safety Audit',        on: !!used.rugcheck },
    { k: 'Social Sentiment',    on: !!used.lunarcrush },
    { k: 'News Feed',           on: !!used.cryptopanic },
    { k: 'Incident DB',         on: !!used.hacks },
    { k: 'Holders Registry',    on: !!used.holderBreakdown },
    { k: 'Spectre Score',       on: !!spectreData?.profile?.spectreScore?.overall },
    { k: 'Sentiment Engine',    on: !!spectreData?.sentiment?.score },
    { k: 'Derivatives Feed',    on: !!spectreData?.derivatives?.summary },
    { k: 'Fundraising',         on: Array.isArray(spectreData?.fundraising) && spectreData.fundraising.length > 0 },
  ]
  const onCount = sources.filter((s) => s.on).length

  // Compose links — merge: coinDetails (CG) > spectreSocial > dossier.socialLinks (aggregated)
  const ab = coinDetails?.links || null
  const social = spectreSocial?.Social_Media || null
  const ds = dossier?.socialLinks || {}
  const homepage = (Array.isArray(ab?.homepage) ? ab.homepage[0] : ab?.homepage) || social?.Website || ds.website || null
  const twitter = (ab?.twitter_screen_name ? `https://x.com/${ab.twitter_screen_name}` : null) || social?.Twitter || ds.twitter || null
  const telegram = (ab?.telegram_channel_identifier ? `https://telegram.me/${ab.telegram_channel_identifier}` : null) || social?.Telegram || ds.telegram || null
  const discord = social?.Discord || ds.discord || null
  const reddit = ab?.subreddit_url || ds.reddit || null
  const github = ab?.repos_url?.github?.[0] || (social?.Github || null) || ds.github || null
  const medium = ds.medium || null

  // Contracts (multi-chain Etherscan/BscScan/Solscan/...) from dossier
  const contracts = Array.isArray(dossier?.contracts) ? dossier.contracts : []
  const explorerUrl = (chain, addr) => {
    const c = String(chain || '').toLowerCase()
    if (c.includes('eth') || c === 'ethereum') return `https://etherscan.io/token/${addr}`
    if (c.includes('bsc') || c.includes('binance')) return `https://bscscan.com/token/${addr}`
    if (c.includes('polygon') || c === 'matic') return `https://polygonscan.com/token/${addr}`
    if (c.includes('arbitrum')) return `https://arbiscan.io/token/${addr}`
    if (c.includes('base')) return `https://basescan.org/token/${addr}`
    if (c.includes('optimism')) return `https://optimistic.etherscan.io/token/${addr}`
    if (c.includes('avalanche')) return `https://snowtrace.io/token/${addr}`
    if (c.includes('sol')) return `https://solscan.io/token/${addr}`
    if (c.includes('sonic')) return `https://sonicscan.org/token/${addr}`
    return null
  }

  // Funding rounds + investors compact summary
  const fundingRounds = Array.isArray(dossier?.fundingRounds) ? dossier.fundingRounds : []
  const investors = Array.isArray(dossier?.investors) ? dossier.investors : []

  // Live socialStats (followers) for at-a-glance community section
  const stats = dossier?.socialStats || null

  // On-chain stats from Blockscout
  const onchain = dossier?.onchainExplorer || null

  // Pretty chain label (drop "-" hyphens, title-case)
  const chainLabel = (raw) => String(raw || '')
    .replace(/-borrowed$/, '').replace(/[-_]/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase())

  const hasAnyLink = homepage || twitter || telegram || discord || github || reddit || medium
  if (!tags.length && !hacks.length && !audits.length && !hasAnyLink && !contracts.length && !investors.length && !stats && !onchain) return null

  return (
    <Section className="cine-ref">
      <SectionHead eyebrow="Reference" title={t('researchPro.cinema.reference.title', "Resources & receipts")} tip="Tags, official links, audit reports, hack history, and trust score for this asset." />
      <div className="cine-ref-grid cine-ref-grid--cols">
        {hasAnyLink && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.official', "Official")}</span>
            <div className="cine-ref-pills">
              {homepage && <a href={homepage} target="_blank" rel="noopener noreferrer" className="cine-pill" data-kind="web"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></svg>Website</a>}
              {twitter && <a href={twitter} target="_blank" rel="noopener noreferrer" className="cine-pill" data-kind="x"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>X / Twitter</a>}
              {telegram && <a href={telegram} target="_blank" rel="noopener noreferrer" className="cine-pill" data-kind="tg"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>Telegram</a>}
              {discord && <a href={discord} target="_blank" rel="noopener noreferrer" className="cine-pill" data-kind="dc"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05 0 .07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z"/></svg>Discord</a>}
              {reddit && <a href={reddit} target="_blank" rel="noopener noreferrer" className="cine-pill" data-kind="rd"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M22 12.07c0-1.21-.99-2.2-2.2-2.2-.59 0-1.13.24-1.53.62-1.5-1.06-3.55-1.74-5.83-1.82l1.18-3.71 3.18.74c.04.96.84 1.74 1.81 1.74A1.81 1.81 0 0 0 20.43 5.6c0-1-.81-1.81-1.82-1.81-.71 0-1.32.41-1.62 1l-3.55-.83c-.13-.04-.25.05-.29.16l-1.31 4.13c-2.31.07-4.39.74-5.91 1.81-.4-.37-.93-.6-1.51-.6-1.21 0-2.2.99-2.2 2.2 0 .85.49 1.59 1.21 1.95-.04.21-.06.43-.06.65 0 3.34 3.92 6.07 8.74 6.07s8.74-2.72 8.74-6.07c0-.22-.02-.43-.06-.65.71-.36 1.21-1.1 1.21-1.95zM6.59 13.59c0-.78.63-1.41 1.41-1.41.78 0 1.41.63 1.41 1.41a1.41 1.41 0 1 1-2.82 0zm9.36 4.06c-1.04 1.04-3.07 1.12-3.95 1.12-.88 0-2.92-.08-3.95-1.12a.32.32 0 0 1 0-.46.32.32 0 0 1 .46 0c.69.69 2.16.93 3.49.93s2.81-.24 3.49-.93a.34.34 0 0 1 .46 0 .322.322 0 0 1 0 .46zm-.18-2.65a1.41 1.41 0 1 1 0-2.82c.78 0 1.41.63 1.41 1.41 0 .78-.63 1.41-1.41 1.41z"/></svg>Reddit</a>}
              {github && <a href={github} target="_blank" rel="noopener noreferrer" className="cine-pill" data-kind="gh"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.79 23.38c.6.11.82-.26.82-.58v-2.02c-3.33.72-4.04-1.61-4.04-1.61-.54-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.64 1.66.23 2.88.11 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3"/></svg>GitHub</a>}
              {medium && <a href={medium} target="_blank" rel="noopener noreferrer" className="cine-pill" data-kind="md">Medium</a>}
            </div>
          </div>
        )}

        {onchain && (onchain.holdersCount != null || onchain.transfersCount != null) && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.onChain', "On-chain")}</span>
            <div className="cine-ref-stats">
              {onchain.holdersCount != null && <div className="cine-stat"><span className="cine-stat-num mono">{onchain.holdersCount.toLocaleString()}</span><span className="cine-stat-lbl">{t('researchPro.cinema.reference.holders', "Holders")}</span></div>}
              {onchain.transfersCount != null && <div className="cine-stat"><span className="cine-stat-num mono">{onchain.transfersCount.toLocaleString()}</span><span className="cine-stat-lbl">{t('researchPro.cinema.reference.transfers', "Transfers")}</span></div>}
              {onchain.contractMeta?.type && <div className="cine-stat"><span className="cine-stat-num">{onchain.contractMeta.type}</span><span className="cine-stat-lbl">{t('researchPro.cinema.reference.standard', "Standard")}</span></div>}
              {onchain.explorerHost && contracts[0]?.address && (
                <a className="cine-stat cine-stat--link" href={`https://${onchain.explorerHost}/token/${contracts[0].address}`} target="_blank" rel="noopener noreferrer">
                  <span className="cine-stat-num">{onchain.explorerHost.split('.')[0].toUpperCase()}{ARROW}</span>
                  <span className="cine-stat-lbl">{t('researchPro.cinema.reference.explorer', "Explorer")}</span>
                </a>
              )}
            </div>
          </div>
        )}

        {contracts.length > 0 && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.contracts', "Contracts")}</span>
            <div className="cine-ref-pills">
              {contracts.slice(0, 6).map((c, i) => {
                const url = explorerUrl(c.chain, c.address)
                const addr = String(c.address)
                const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`
                const inner = (
                  <>
                    <span className="cine-pill-chain">{chainLabel(c.chain)}</span>
                    <span className="cine-pill-addr mono">{short}</span>
                  </>
                )
                return url
                  ? <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="cine-pill cine-pill--contract">{inner}</a>
                  : <span key={i} className="cine-pill cine-pill--contract">{inner}</span>
              })}
            </div>
          </div>
        )}

        {tags.length > 0 && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.categories', "Categories")}</span>
            <div className="cine-ref-tags">
              {tags.slice(0, 16).map((t, i) => <span key={i}>{t}</span>)}
            </div>
          </div>
        )}

        {investors.length > 0 && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.investors', "Investors")}</span>
            <div className="cine-ref-tags">
              {investors.slice(0, 12).map((inv, i) => <span key={i}>{inv.name || inv}</span>)}
            </div>
          </div>
        )}

        {fundingRounds.length > 0 && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.fundingRounds', "Funding rounds")}</span>
            <ul className="cine-ref-rounds">
              {fundingRounds.slice(0, 4).map((r, i) => {
                const date = r.date ? new Date(r.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''
                const amount = r.amountUsd ? fmtUsd(r.amountUsd) : null
                return (
                  <li key={i}>
                    <span className="cine-round-date mono">{date}</span>
                    <span className="cine-round-stage">{r.roundType || 'Round'}</span>
                    {amount && <span className="cine-round-amt mono">{amount}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {stats && Object.keys(stats).length > 0 && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.community', "Community")}</span>
            <div className="cine-ref-stats">
              {stats.twitterFollowers > 0 && <div className="cine-stat"><span className="cine-stat-num mono">{stats.twitterFollowers.toLocaleString()}</span><span className="cine-stat-lbl">{t('researchPro.cinema.reference.onX', "on X")}</span></div>}
              {stats.telegramMembers > 0 && <div className="cine-stat"><span className="cine-stat-num mono">{stats.telegramMembers.toLocaleString()}</span><span className="cine-stat-lbl">Telegram</span></div>}
              {stats.redditSubscribers > 0 && <div className="cine-stat"><span className="cine-stat-num mono">{stats.redditSubscribers.toLocaleString()}</span><span className="cine-stat-lbl">Reddit</span></div>}
              {stats.mindshare > 0 && <div className="cine-stat"><span className="cine-stat-num mono">{Number(stats.mindshare).toFixed(1)}</span><span className="cine-stat-lbl">{t('researchPro.cinema.reference.mindshare', "Mindshare")}</span></div>}
            </div>
          </div>
        )}

        {audits.length > 0 && (
          <div className="cine-ref-block">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.audits', "Audits")}</span>
            <ul className="cine-ref-audits">
              {audits.slice(0, 6).map((a, i) => (
                <li key={i}>
                  {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.auditor} {ARROW}</a> : <span>{a.auditor}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hacks.length > 0 && (
          <div className="cine-ref-block cine-ref-block--warn">
            <span className="cine-ref-label">{t('researchPro.cinema.reference.pastIncidents', "Past incidents")}</span>
            <ul className="cine-ref-hacks">
              {hacks.slice(0, 5).map((h, i) => (
                <li key={i}>
                  <span className="cine-ref-hack-amount mono">{fmtUsd(h.amount)}</span>
                  <span className="cine-ref-hack-name">{h.name}</span>
                  <span className="cine-ref-hack-date mono">{h.date ? new Date(h.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 2026-05-27: Trust-score / X/20 sources block removed — exposed
            internal API source names (MARKET_DATA, TOKEN_REGISTRY, ...) to
            end users which is internal-only diagnostic info. Kept in
            /dev/freshness for engineering use. */}
      </div>
    </Section>
  )
}

/* ── FROM THE SOURCE — crawled intelligence (2026-08-25) ─────────────── */
// Three evidence blocks that come from the project itself, not an aggregator:
// what its OWN site/docs say (project-crawl on the server, 24h KV), its OWN X
// tape (posting cadence + sample posts — weighed like dev activity), and the
// public-repo build signal with honest framing (an idle PUBLIC repo is never
// "team inactivity"; the SPECTRE "549 days inactive" lesson). Absence hides
// each block — no skeletons promising data the crawl didn't produce.
function SourceIntelSection({ siteIntel, teamTape, github }) {
  const { t } = useTranslation()
  const tape = teamTape && !teamTape.unavailable ? teamTape : null
  const build = github || siteIntel?.build || null
  if (!siteIntel && !tape && !build) return null

  const cadence = tape
    ? tape.posts24h >= 1 ? 'posting daily'
      : tape.posts7d >= 3 ? 'posting regularly'
        : tape.posts7d >= 1 ? 'posting occasionally'
          : 'quiet this week'
    : null
  const cadenceTone = tape ? (tape.posts24h >= 1 || tape.posts7d >= 3 ? 'live' : tape.posts7d >= 1 ? 'warm' : 'cold') : null

  const lastPushDays = build
    ? (build.lastPushDays != null
      ? build.lastPushDays
      : build.lastCommit ? Math.max(0, Math.round((Date.now() - new Date(build.lastCommit).getTime()) / 86400_000)) : null)
    : null
  const repoName = build?.repo || (build?.url ? String(build.url).replace(/^https?:\/\/(www\.)?github\.com\//i, '') : null)
  const repoIdle = lastPushDays != null && lastPushDays > 45

  return (
    <Section className="cine-source">
      <SectionHead
        eyebrow="From the source"
        title={t('researchPro.cinema.sourceintel.title', "What the project itself shows")}
        sub="Read from the project's own website, X account and public code — not an aggregator's summary."
      />
      <div className="cine-src-grid">
        {siteIntel && (
          <article className="cine-src-card">
            <span className="cine-src-k">{t('researchPro.cinema.sourceintel.theSiteSays', "The site says")}</span>
            {siteIntel.whatItDoes && <p className="cine-src-lead">{siteIntel.whatItDoes}</p>}
            <div className="cine-src-chips">
              {siteIntel.productStage && siteIntel.productStage !== 'unknown' && (
                <span className="cine-src-chip">stage · {siteIntel.productStage}</span>
              )}
              {siteIntel.evidenceOfShipping && (
                <span className={`cine-src-chip${siteIntel.evidenceOfShipping === 'yes' ? ' cine-src-chip--live' : ''}`}>
                  shipping · {siteIntel.evidenceOfShipping}
                </span>
              )}
            </div>
            {siteIntel.differentiator && <p className="cine-src-line">{siteIntel.differentiator}</p>}
            {Array.isArray(siteIntel.traction) && siteIntel.traction.length > 0 && (
              <ul className="cine-src-list">
                {siteIntel.traction.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
            {siteIntel.roadmapNext && <p className="cine-src-line"><span className="cine-src-inlinek">Next:</span> {siteIntel.roadmapNext}</p>}
          </article>
        )}
        {tape && (
          <article className="cine-src-card">
            <span className="cine-src-k">{t('researchPro.cinema.sourceintel.theTeamOnX', "The team on X")}</span>
            <p className="cine-src-lead">
              <a href={`https://x.com/${tape.handle}`} target="_blank" rel="noopener noreferrer" className="cine-src-handle">@{tape.handle}</a>
              {' '}<span className={`cine-src-cadence cine-src-cadence--${cadenceTone}`}>{cadence}</span>
            </p>
            <p className="cine-src-meta">
              {tape.posts24h} posts 24h · {tape.posts7d} posts 7d
              {tape.newestAgeHours != null && ` · newest ${tape.newestAgeHours < 48 ? `${Math.round(tape.newestAgeHours)}h` : `${Math.round(tape.newestAgeHours / 24)}d`} ago`}
            </p>
            {(tape.sample || []).slice(0, 3).map((t, i) => (
              <blockquote key={i} className="cine-src-post">
                <p>{t.text}</p>
                {t.age && <cite>{t.age}</cite>}
              </blockquote>
            ))}
          </article>
        )}
        {build && (repoName || lastPushDays != null) && (
          <article className="cine-src-card">
            <span className="cine-src-k">{t('researchPro.cinema.sourceintel.publicCode', "Public code")}</span>
            {repoName && (
              <p className="cine-src-lead">
                <a href={build.url || `https://github.com/${repoName}`} target="_blank" rel="noopener noreferrer" className="cine-src-handle">{repoName}</a>
              </p>
            )}
            <p className="cine-src-meta">
              {lastPushDays != null && `newest public push ${lastPushDays === 0 ? 'today' : `${lastPushDays}d ago`}`}
              {build.stars != null && ` · ${build.stars} stars`}
              {build.contributors != null && ` · ${build.contributors} contributors`}
            </p>
            {repoIdle && (
              <p className="cine-src-note">
                Public repos only — many teams ship in private repos, so an idle public repo is not team inactivity.
                {tape && (tape.posts24h >= 1 || tape.posts7d >= 3) ? ' The team tape shows active shipping.' : ''}
              </p>
            )}
          </article>
        )}
      </div>
    </Section>
  )
}

/* ── EXPORT ──────────────────────────────────────────────────────────── */
// Shimmer skeleton shown for the initial dossier fetch. Matches the cinema
// layout shape (description block + stats row + 3 large section blocks) so
// the layout doesn't shift when real data lands.
function ProjectCinemaSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="cine-root cine-skeleton" aria-busy="true" aria-label={t('researchPro.cinema.projectcinemaskeleton.ariaLoadingProjectDossier', "Loading project dossier")}>
      <div className="cine-skeleton-block cine-skeleton-block--lines">
        <div className="cine-skeleton-bar animate-shimmer" style={{ width: '92%' }} />
        <div className="cine-skeleton-bar animate-shimmer" style={{ width: '78%' }} />
        <div className="cine-skeleton-bar animate-shimmer" style={{ width: '60%' }} />
      </div>
      <div className="cine-skeleton-stats">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="cine-skeleton-stat">
            <div className="cine-skeleton-bar cine-skeleton-bar--xs animate-shimmer" style={{ width: '50%' }} />
            <div className="cine-skeleton-bar cine-skeleton-bar--md animate-shimmer" style={{ width: '70%' }} />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="cine-skeleton-section">
          <div className="cine-skeleton-bar cine-skeleton-bar--xs animate-shimmer" style={{ width: '15%' }} />
          <div className="cine-skeleton-bar cine-skeleton-bar--lg animate-shimmer" style={{ width: '55%', marginTop: 12 }} />
          <div className="cine-skeleton-card animate-shimmer" style={{ marginTop: 18 }} />
        </div>
      ))}
    </div>
  )
}

// The non-td sections. Memoized so a price tick (which changes `td` identity
// and re-renders ProjectCinema for StageSection/ReadSection) does NOT re-render
// these 9 heavy sections — their props derive from dossier/spectreData/coinDetails,
// which poll every 5min and are referentially stable between ticks.
const ProjectCinemaBody = React.memo(function ProjectCinemaBody({
  sym, dossier, spectreData, coinDetails, spectreSocial, activeTokenInfo,
  signals, whales, sentiment,
}) {
  return (
    <>
      {/* Project-specific: chain TVL for tokens that map to a DefiLlama chain (ZIG → ZIGChain). */}
      <RzChainTvlSection sym={sym} />
      <HealthSection risk={dossier?.riskComposite} opp={dossier?.opportunityScore} />
      <PositioningSection sentiment={sentiment} sym={sym} />
      <HoldersSection breakdown={dossier?.holderBreakdown} />
      <SourceIntelSection siteIntel={dossier?.siteIntel} teamTape={dossier?.teamTape} github={dossier?.github} />
      <FounderSpotlightSection spotlight={dossier?.founderSpotlight} />
      <BuildersSection
        team={dossier?.team}
        partners={dossier?.partners}
        investors={dossier?.investors}
        fundraising={spectreData?.fundraising}
      />
      <BuildingSection
        whitepaperUrl={dossier?.whitepaperUrl}
        whitepaperThumb={dossier?.whitepaperThumb}
        roadmap={dossier?.roadmap}
        docsToc={dossier?.docsToc}
        sym={sym}
        description={dossier?.description}
        websiteUrl={dossier?.organization?.website || dossier?.links?.homepage?.[0] || dossier?.links?.website}
      />
      <ActivitySection news={dossier?.newsFeed} signals={signals} whales={whales} />
      <ReferenceSection
        dossier={dossier}
        spectreData={spectreData}
        sym={sym}
        coinDetails={coinDetails}
        spectreSocial={spectreSocial}
        activeTokenInfo={activeTokenInfo}
      />
    </>
  )
})

export default function ProjectCinema({
  sym, td, fmtPrice, tokenColor,
  dossier, loading, spectreData,
  coinDetails, spectreSocial, onChainData, activeTokenInfo,
}) {
  const score = spectreData?.profile?.spectreScore
  const signals = spectreData?.profile?.signals
  const whales = spectreData?.profile?.whales
  const sentiment = spectreData?.sentiment

  if (loading) return <ProjectCinemaSkeleton />

  return (
    <div className="cine-root">
      <StageSection
        sym={sym}
        td={td}
        fmtPrice={fmtPrice}
        tokenColor={tokenColor}
        dossier={dossier}
        score={score}
        risk={dossier?.riskComposite}
        onChainData={onChainData}
      />
      <ReadSection
        take={dossier?.spectreTake}
        takeAt={dossier?.spectreTakeAt}
        signals={signals}
        sentiment={sentiment}
        td={td}
        whales={whales}
        conviction={dossier?.conviction}
        sym={sym}
      />
      <ProjectCinemaBody
        sym={sym}
        dossier={dossier}
        spectreData={spectreData}
        coinDetails={coinDetails}
        spectreSocial={spectreSocial}
        activeTokenInfo={activeTokenInfo}
        signals={signals}
        whales={whales}
        sentiment={sentiment}
      />
    </div>
  )
}
