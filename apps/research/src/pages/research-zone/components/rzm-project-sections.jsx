/**
 * Research Zone Mobile - Project Sections
 *
 * Native mobile rewrite of the 11 ProjectCinema sections in rzm-* style.
 * Renders inside renderOverviewPanel() of research-zone-mobile.jsx, after the
 * existing About / Links / Categories / Performance / Converter blocks.
 *
 * Data sources match desktop ProjectCinema:
 *   - dossier (useDossierProject)
 *   - spectreData (useSpectreAssetData)
 *   - td (rich token data)
 *   - tokenColor, coinDetails, spectreSocial, onChainData, activeTokenInfo
 *
 * Visual language: existing rzm-section / rzm-stat / rzm-stats-row patterns.
 * No cine-* class names, no scroll-reveal transforms, no emoji icons.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import RzChainTvlSection from './rz-chain-tvl-section'

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const fmtUsd = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n).toLocaleString()}`
}

const fmtCompact = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}

const fmtPct = (v, d = 2) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n > 0 ? '+' : ''}${n.toFixed(d)}%`
}

const fmtAge = (ts) => {
  if (!ts) return null
  const ms = ts > 1e12 ? ts : ts * 1000
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86400_000))
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${(days / 365).toFixed(1)}y`
}

const fmtRel = (iso) => {
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

const shortAddr = (addr) => {
  if (!addr) return '—'
  const s = String(addr)
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

// Section header (eyebrow uppercase + optional title + optional subtitle)
const Head = ({ label, title, sub }) => (
  <div className="rzm-proj-head">
    <span className="rzm-proj-eyebrow">{label}</span>
    {title && <div className="rzm-proj-title">{title}</div>}
    {sub && <div className="rzm-proj-sub">{sub}</div>}
  </div>
)

// Inline arrow for link rows
const Arrow = () => (
  <svg className="rzm-proj-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="9 7 17 7 17 15" />
  </svg>
)

// ──────────────────────────────────────────────────────────────────────────
// 1. STAGE — hero intel stats (Age / Score / Risk / Holders / Conviction / Launched)
// ──────────────────────────────────────────────────────────────────────────

function StageStatsRzm({ td, dossier, score, risk, onChainData }) {
  const { t } = useTranslation()
  const dossierScore = dossier?.spectreScore != null ? Number(dossier.spectreScore) : null
  const overallScore = Number(score?.overall) > 0 ? Number(score.overall) : (dossierScore || null)
  const onchainExp = dossier?.onchainExplorer
  const conviction = dossier?.conviction
  const convictionLabel = conviction?.tier && conviction?.stance
    ? `${conviction.stance} · ${conviction.tier}`
    : null
  const launchIso = dossier?.launchDate || onChainData?.launchedAt || null
  const launchYear = launchIso ? (new Date(launchIso).getFullYear() || null) : null

  // Native L1 assets (BTC, ETH, SOL, ...) don't have an ERC-20-style holders
  // count and their "on-chain age" is whatever wrapped-token sidedata Spectre
  // grabbed — both numbers mislead. Compute age from the real launch date,
  // hide holders on native assets entirely.
  const sym = String(td?.symbol || dossier?.symbol || '').toUpperCase()
  const NATIVE_L1 = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ATOM', 'NEAR', 'XLM', 'XMR', 'TON', 'APT', 'SUI', 'HBAR', 'ICP', 'FIL', 'KAS', 'ALGO', 'EGLD', 'TEZOS', 'XTZ'])
  const isNativeAsset = NATIVE_L1.has(sym)
  const holders = isNativeAsset ? null : (onchainExp?.holdersCount ?? null)
  // Prefer launchDate-derived age over on-chain age (which is wrong for BTC).
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
    risk?.score != null && {
      k: 'Risk',
      v: `${Math.round(risk.score)}/100`,
      tone: risk.band === 'safe' ? 'bull' : risk.band === 'moderate' ? 'mid' : 'bear',
    },
    holders != null && { k: 'Holders', v: holders >= 1000 ? `${(holders / 1000).toFixed(1)}K` : holders.toLocaleString() },
    convictionLabel && {
      k: 'Conviction',
      v: convictionLabel,
      tone: conviction.stance === 'bullish' ? 'bull' : conviction.stance === 'bearish' ? 'bear' : 'mid',
    },
    launchYear && { k: 'Launched', v: String(launchYear) },
  ].filter(Boolean)

  if (!stats.length) return null

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.stagestatsrzm.label', "OVERVIEW")} />
      <div className="rzm-proj-stage-grid">
        {stats.map((s) => (
          <div key={s.k} className={`rzm-proj-stat${s.tone ? ` rzm-proj-stat--${s.tone}` : ''}`}>
            <span className="rzm-proj-stat-k">{s.k}</span>
            <span className="rzm-proj-stat-v">{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 2. SPECTRE TAKE — narrative + drivers (Market Read)
// ──────────────────────────────────────────────────────────────────────────

function SpectreTakeRzm({ take, takeAt, signals, sentiment, td, whales, conviction, sym }) {
  const { t } = useTranslation()
  if (!take && !signals?.active?.length && !sentiment?.score && !td?.change24h) return null

  const symRe = sym ? new RegExp(`\\b\\$?${sym}\\b`, 'i') : null
  const takeMentionsAsset = !!(take && symRe && symRe.test(take))
  const takeIsSubstantive = !!(take && String(take).trim().length >= 60)
  const showTake = takeMentionsAsset && takeIsSubstantive
  const showVerdict = !!conviction?.has_conviction && takeMentionsAsset && takeIsSubstantive
  const verdictMatch = showVerdict && take && take.match(/\b(bullish|bearish|neutral|mixed)\b/i)
  const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'neutral'

  const takeAtMs = takeAt == null ? null
    : typeof takeAt === 'number' ? takeAt
    : new Date(takeAt).getTime()
  const ageMin = Number.isFinite(takeAtMs)
    ? Math.max(0, Math.round((Date.now() - takeAtMs) / 60_000))
    : null
  const ageLabel = ageMin != null
    ? (ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`)
    : null

  const drivers = []
  if (signals?.active?.length) {
    const top = signals.active[0]
    drivers.push({ tone: top.direction || 'neutral', text: top.title })
  }
  const fundingPct = Number(sentiment?.derivatives?.weighted_funding_rate || 0) * 100
  if (Math.abs(fundingPct) > 0.001) drivers.push({ tone: fundingPct < 0 ? 'bearish' : 'bullish', text: `Funding ${fundingPct >= 0 ? '+' : ''}${fundingPct.toFixed(4)}%` })
  const lsr = Number(sentiment?.longShortRatio?.long_short_ratio || 0)
  if (lsr > 0) drivers.push({ tone: lsr > 1.2 ? 'bullish' : lsr < 0.8 ? 'bearish' : 'neutral', text: `L/S ${lsr.toFixed(2)} · ${lsr > 1 ? 'long-skew' : 'short-skew'}` })
  if (whales?.netFlow != null && Math.abs(whales.netFlow) > 0) {
    drivers.push({ tone: whales.netFlow > 0 ? 'bullish' : 'bearish', text: `Whales ${whales.netFlow > 0 ? 'accumulating' : 'distributing'} ${fmtUsd(Math.abs(whales.netFlow))} 48h` })
  }
  if (Number(td?.change24h)) drivers.push({ tone: td.change24h > 0 ? 'bullish' : 'bearish', text: `Price ${fmtPct(td.change24h)} · ${fmtUsd(td.volume)} 24h vol` })

  if (!showTake && drivers.length === 0) return null

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.spectretakerzm.label', "MARKET READ")} title={t('researchPro.rzmProject.spectretakerzm.title', "What the data is saying")} sub={ageLabel ? `Synthesized by Spectre AI · ${ageLabel}` : 'Synthesized by Spectre AI'} />
      {showTake && (
        <div className={`rzm-proj-take rzm-proj-take--${verdict}`}>
          {showVerdict && <span className={`rzm-proj-verdict rzm-proj-verdict--${verdict}`}>{verdict}</span>}
          <p className="rzm-proj-take-text">{take}</p>
        </div>
      )}
      {drivers.length > 0 && (
        <ul className="rzm-proj-drivers">
          {drivers.slice(0, 5).map((d, i) => (
            <li key={i} className={`rzm-proj-driver rzm-proj-driver--${d.tone}`}>
              <span className="rzm-proj-driver-dot" aria-hidden="true" />
              <span>{d.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 3. CHAIN TVL — passthrough to existing component (already mobile-friendly)
// ──────────────────────────────────────────────────────────────────────────

function ChainTvlRzm({ sym }) {
  return (
    <div className="rzm-section rzm-proj-section rzm-proj-chain-tvl">
      <RzChainTvlSection sym={sym} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 4. HEALTH — Risk Composite + Opportunity Score (twin cards)
// ──────────────────────────────────────────────────────────────────────────

function HealthRzm({ risk, opp }) {
  const { t } = useTranslation()
  if (risk?.score == null && opp?.score == null) return null

  const Twin = ({ kind, score, band, items, tone, hint }) => {
    if (score == null) return null
    const pct = Math.max(0, Math.min(100, Math.round(score)))
    return (
      <div className={`rzm-proj-health-twin rzm-proj-health-twin--${tone}`}>
        <div className="rzm-proj-health-twin-row">
          <span className="rzm-proj-health-twin-kind">{kind}</span>
          {band && <span className="rzm-proj-health-twin-band">{band.toUpperCase()}</span>}
        </div>
        <div className="rzm-proj-health-twin-num">{Math.round(score)}<span className="rzm-proj-health-twin-denom">/100</span></div>
        <div className="rzm-proj-health-twin-bar">
          <div className="rzm-proj-health-twin-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="rzm-proj-health-twin-hint">{hint}</div>
        {Array.isArray(items) && items.length > 0 && (
          <ul className="rzm-proj-health-twin-list">
            {items.slice(0, 4).map((it, i) => {
              const ok = it.ok || (it.points && it.points >= it.weight * 0.6)
              return (
                <li key={i} className={`rzm-proj-health-twin-item rzm-proj-health-twin-item--${ok ? 'ok' : 'warn'}`}>
                  <span className="rzm-proj-health-twin-glyph">{ok ? '+' : '−'}</span>
                  <span>{it.label}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  const riskTone = risk?.band === 'safe' ? 'bull' : risk?.band === 'moderate' ? 'mid' : 'bear'
  const oppTone = opp?.band === 'strong' ? 'bull' : opp?.band === 'moderate' ? 'mid' : 'bear'

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.healthrzm.label', "HEALTH")} title={t('researchPro.rzmProject.healthrzm.title', "How safe, how strong")} />
      <div className="rzm-proj-health-twins">
        <Twin kind="Safety" score={risk?.score} band={risk?.band} items={risk?.checks} tone={riskTone} hint="Lower = more risk vectors" />
        <Twin kind="Edge" score={opp?.score} band={opp?.band} items={opp?.factors} tone={oppTone} hint="Higher = stronger setup" />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 5. POSITIONING — sentiment cells (Sentiment / Funding / L/S / Liquidations)
// ──────────────────────────────────────────────────────────────────────────

function PositioningRzm({ sentiment }) {
  const { t } = useTranslation()
  if (!sentiment?.score) return null
  const score = Number(sentiment.score) || 0
  const label = sentiment.label || (score >= 70 ? 'Greedy' : score >= 50 ? 'Neutral' : score >= 30 ? 'Cautious' : 'Fearful')
  const sentTone = score >= 60 ? 'bull' : score >= 40 ? 'mid' : 'bear'

  const fundingRaw = sentiment?.derivatives?.weighted_funding_rate
  const hasFunding = fundingRaw != null && Number.isFinite(Number(fundingRaw))
  const fundingPct = hasFunding ? Number(fundingRaw) * 100 : 0
  const fundingTone = fundingPct < -0.005 ? 'bear' : fundingPct > 0.005 ? 'bull' : 'mid'

  const lsrRaw = sentiment?.longShortRatio?.long_short_ratio
  const hasLsr = lsrRaw != null && Number.isFinite(Number(lsrRaw)) && Number(lsrRaw) > 0
  const lsr = hasLsr ? Number(lsrRaw) : 0
  const lsrTone = lsr > 1.2 ? 'bull' : lsr < 0.8 ? 'bear' : 'mid'

  const longLiq = Number(sentiment?.longShortRatio?.long_liq_24h_usd || 0)
  const shortLiq = Number(sentiment?.longShortRatio?.short_liq_24h_usd || 0)
  const totalLiq = longLiq + shortLiq
  const liqTone = longLiq > shortLiq ? 'bear' : 'bull'

  const cells = [
    { k: 'Sentiment', v: Math.round(score), sub: label.toLowerCase(), tone: sentTone, bar: score },
    hasFunding && { k: 'Funding', v: `${fundingPct >= 0 ? '+' : ''}${fundingPct.toFixed(4)}%`, sub: fundingPct < 0 ? 'shorts pay longs' : fundingPct > 0 ? 'longs pay shorts' : 'balanced', tone: fundingTone },
    hasLsr && { k: 'L / S Ratio', v: lsr.toFixed(3), sub: lsr > 1.2 ? 'long-skewed' : lsr < 0.8 ? 'short-skewed' : 'balanced', tone: lsrTone },
    totalLiq > 0 && { k: 'Liquidations 24h', v: fmtUsd(totalLiq), sub: longLiq > shortLiq ? 'longs hammered' : 'shorts squeezed', tone: liqTone },
  ].filter(Boolean)

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.positioningrzm.label', "POSITIONING")} title={t('researchPro.rzmProject.positioningrzm.title', "Where the trade sits")} />
      <div className="rzm-proj-pos-grid">
        {cells.map((c) => (
          <div key={c.k} className={`rzm-proj-pos-cell rzm-proj-pos-cell--${c.tone}`}>
            <span className="rzm-proj-pos-cell-k">{c.k}</span>
            <span className="rzm-proj-pos-cell-v">{c.v}</span>
            {c.bar != null && (
              <div className="rzm-proj-pos-cell-bar">
                <div className="rzm-proj-pos-cell-bar-fill" style={{ width: `${Math.max(0, Math.min(100, c.bar))}%` }} />
              </div>
            )}
            <span className="rzm-proj-pos-cell-sub">{c.sub}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 6. HOLDERS — distribution stack + legend + top wallets
// ──────────────────────────────────────────────────────────────────────────

const HOLDER_KIND_META = [
  { key: 'exchange', label: 'Exchanges', color: '#3B82F6' },
  { key: 'dex',      label: 'DEX pools', color: '#06B6D4' },
  { key: 'burn',     label: 'Burn / Null', color: '#EF4444' },
  { key: 'contract', label: 'Contracts', color: '#A78BFA' },
  { key: 'eoa',      label: 'Whales (EOA)', color: '#F59E0B' },
  { key: 'unknown',  label: 'Unknown', color: '#6B7280' },
]

function HoldersRzm({ breakdown }) {
  const { t } = useTranslation()
  if (!breakdown || !breakdown.byKind) return null
  const kinds = HOLDER_KIND_META
    .map((k) => ({ ...k, pct: Number(breakdown.byKind[k.key]) || 0 }))
    .filter((k) => k.pct > 0.01)
  if (!kinds.length) return null
  const items = Array.isArray(breakdown.items) ? breakdown.items.slice(0, 8) : []
  const top10 = breakdown.top10Pct != null ? `${Number(breakdown.top10Pct).toFixed(1)}%` : null
  const top50 = breakdown.top50Pct != null ? `${Number(breakdown.top50Pct).toFixed(1)}%` : null

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.holdersrzm.label', "DISTRIBUTION")} title={t('researchPro.rzmProject.holdersrzm.title', "Who is holding it")} sub={top10 ? `Top 10: ${top10}${top50 ? ` · Top 50: ${top50}` : ''} of supply` : null} />
      <div className="rzm-proj-holders-stack" aria-hidden="true">
        {kinds.map((k) => (
          <span
            key={k.key}
            className="rzm-proj-holders-seg"
            style={{ width: `${k.pct}%`, background: k.color }}
            title={`${k.label} · ${k.pct.toFixed(2)}%`}
          />
        ))}
      </div>
      <ul className="rzm-proj-holders-legend">
        {kinds.map((k) => (
          <li key={k.key}>
            <span className="rzm-proj-holders-dot" style={{ background: k.color }} />
            <span className="rzm-proj-holders-label">{k.label}</span>
            <span className="rzm-proj-holders-pct">{k.pct.toFixed(2)}%</span>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <ol className="rzm-proj-holders-list">
          {items.map((it, i) => (
            <li key={i} className="rzm-proj-holders-row">
              <span className="rzm-proj-holders-rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="rzm-proj-holders-addr">{shortAddr(it.address)}</span>
              <span className="rzm-proj-holders-kind" data-kind={it.kind}>{it.label || it.kind || 'unknown'}</span>
              <span className="rzm-proj-holders-row-pct">{Number(it.pct || 0).toFixed(2)}%</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 7. FOUNDER SPOTLIGHT — single-founder card
// ──────────────────────────────────────────────────────────────────────────

function FounderRzm({ spotlight }) {
  const { t } = useTranslation()
  if (!spotlight) return null
  const { name, role, handle, portrait, bio, quote, quoteDate, wins, milestones, socials } = spotlight
  const quoteAge = (() => {
    if (!quoteDate) return null
    const d = new Date(quoteDate)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  })()
  const initials = (name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.founderrzm.label', "FOUNDER SPOTLIGHT")} />
      <div className="rzm-proj-founder-card">
        <div className="rzm-proj-founder-portrait">
          {portrait
            ? <img src={portrait} alt={name} loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
            : <span className="rzm-proj-founder-initials">{initials}</span>}
        </div>
        <div className="rzm-proj-founder-meta">
          {name && <span className="rzm-proj-founder-name">{name}</span>}
          {role && <span className="rzm-proj-founder-role">{role}</span>}
          {handle && <a href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer" className="rzm-proj-founder-handle">@{handle}</a>}
        </div>
      </div>
      {bio && <p className="rzm-proj-founder-bio">{bio}</p>}
      {Array.isArray(socials) && socials.length > 0 && (
        <div className="rzm-proj-founder-socials">
          {socials.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="rzm-link-chip">
              {s.label} <Arrow />
            </a>
          ))}
        </div>
      )}
      {quote && (
        <div className="rzm-proj-founder-quote">
          <p>{quote}</p>
          {quoteAge && <span className="rzm-proj-founder-quote-attr">— {name?.split(' ')[0]}, {quoteAge}</span>}
        </div>
      )}
      {Array.isArray(wins) && wins.length > 0 && (
        <ul className="rzm-proj-founder-wins">
          {wins.slice(0, 6).map((w, i) => (
            <li key={i}>
              <span className="rzm-proj-founder-win-v">{w.value}</span>
              <span className="rzm-proj-founder-win-k">{w.label}</span>
            </li>
          ))}
        </ul>
      )}
      {Array.isArray(milestones) && milestones.length > 0 && (
        <ol className="rzm-proj-founder-timeline">
          {milestones.slice(0, 6).map((m, i) => (
            <li key={i} className="rzm-proj-founder-tick">
              <span className="rzm-proj-founder-tick-year">{m.year}</span>
              <span className="rzm-proj-founder-tick-label">{m.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 8. BUILDERS — Team + Partners + Funding rounds
// ──────────────────────────────────────────────────────────────────────────

function BuildersRzm({ team, partners, investors, fundraising }) {
  const { t } = useTranslation()
  const hasTeam = Array.isArray(team) && team.length > 0
  const hasPartners = Array.isArray(partners) && partners.length > 0
  const hasFunding = Array.isArray(fundraising) && fundraising.length > 0
  const hasInvestors = Array.isArray(investors) && investors.length > 0

  if (!hasTeam && !hasPartners && !hasFunding && !hasInvestors) return null

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.buildersrzm.label', "THE TEAM")} title={t('researchPro.rzmProject.buildersrzm.title', "Who is building this")} />

      {hasTeam && (
        <ul className="rzm-proj-team-list">
          {team.slice(0, 10).map((m, i) => {
            const initials = (m.name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
            return (
              <li key={i} className="rzm-proj-team-row">
                <div className="rzm-proj-team-avatar">
                  {m.avatar
                    ? <img src={m.avatar} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                    : <span className="rzm-proj-team-letters">{initials}</span>}
                </div>
                <div className="rzm-proj-team-body">
                  <span className="rzm-proj-team-name">{m.name}</span>
                  {m.position && <span className="rzm-proj-team-role">{m.position}</span>}
                </div>
                <div className="rzm-proj-team-links">
                  {m.urls?.linkedin && <a href={m.urls.linkedin} target="_blank" rel="noopener noreferrer" aria-label={t('researchPro.rzmProject.buildersrzm.ariaLinkedin', "LinkedIn")}>{t('researchPro.rzmProject.buildersrzm.in', "in")}</a>}
                  {m.urls?.github && <a href={m.urls.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub">{t('researchPro.rzmProject.buildersrzm.gh', "gh")}</a>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {hasPartners && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.buildersrzm.backedBy', "Backed by")}</div>
          <div className="rzm-proj-partners">
            {partners.slice(0, 12).map((p, i) => (
              <div key={i} className="rzm-proj-partner">
                {p.logoUrl
                  ? <img src={p.logoUrl} alt={p.name} loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                  : <span className="rzm-proj-partner-fallback">{(p.name || '?').slice(0, 2).toUpperCase()}</span>}
                <span className="rzm-proj-partner-name">{p.name}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {hasFunding && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.buildersrzm.fundingHistory', "Funding history")}</div>
          <ul className="rzm-proj-rounds">
            {fundraising.slice(0, 6).map((r) => (
              <li key={r.id} className="rzm-proj-round">
                <div className="rzm-proj-round-row">
                  <span className="rzm-proj-round-stage">{r.round_type || 'Round'}</span>
                  <span className="rzm-proj-round-date">{r.date ? new Date(r.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}</span>
                </div>
                <div className="rzm-proj-round-amount">{fmtUsd(r.amount_raised_usd)}</div>
                {r.valuation_usd && <div className="rzm-proj-round-val">@ {fmtUsd(r.valuation_usd)} valuation</div>}
                {(r.all_investors || r.lead_investors) && (
                  <div className="rzm-proj-round-investors">{(r.all_investors || r.lead_investors).slice(0, 4).join(' · ')}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {!hasFunding && hasInvestors && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.buildersrzm.investors', "Investors")}</div>
          <div className="rzm-cat-row">
            {investors.slice(0, 16).map((inv, i) => (
              <span key={i} className="rzm-cat-chip">{inv?.name || inv}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 9. BUILDING — Whitepaper + Roadmap + Docs
// ──────────────────────────────────────────────────────────────────────────

function BuildingRzm({ whitepaperUrl, whitepaperThumb, roadmap, docsToc, sym }) {
  const { t } = useTranslation()
  const hasRoadmap = Array.isArray(roadmap) && roadmap.length > 0
  const hasDocs = Array.isArray(docsToc) && docsToc.length > 0
  if (!whitepaperUrl && !hasRoadmap && !hasDocs) return null

  const wpHost = (() => { try { return new URL(whitepaperUrl).hostname.replace(/^www\./, '') } catch { return whitepaperUrl } })()

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.buildingrzm.label', "DIRECTION")} title={t('researchPro.rzmProject.buildingrzm.title', "What they are building")} />

      {whitepaperUrl && (
        <a href={whitepaperUrl} target="_blank" rel="noopener noreferrer" className="rzm-proj-wp">
          <div className="rzm-proj-wp-thumb">
            {whitepaperThumb
              ? <img src={whitepaperThumb} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
              : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              )}
          </div>
          <div className="rzm-proj-wp-body">
            <span className="rzm-proj-wp-eyebrow">{t('researchPro.rzmProject.buildingrzm.whitepaper', "Whitepaper")}</span>
            <span className="rzm-proj-wp-title">Read the {sym} whitepaper</span>
            <span className="rzm-proj-wp-host">{wpHost}</span>
          </div>
          <Arrow />
        </a>
      )}

      {hasRoadmap && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.buildingrzm.roadmap', "Roadmap")}</div>
          <ol className="rzm-proj-roadmap">
            {roadmap.slice(0, 8).map((m, i) => (
              <li key={i} className="rzm-proj-roadmap-item">
                <span className="rzm-proj-roadmap-dot" />
                {m.date && <span className="rzm-proj-roadmap-date">{m.date}</span>}
                <div className="rzm-proj-roadmap-body">
                  <span className="rzm-proj-roadmap-title">{m.title}</span>
                  {m.description && <p className="rzm-proj-roadmap-desc">{m.description}</p>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {hasDocs && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.buildingrzm.documentation', "Documentation")}</div>
          <ul className="rzm-proj-docs">
            {docsToc.slice(0, 12).map((d, i) => (
              <li key={i}>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="rzm-proj-doc-row">
                  <span className="rzm-proj-doc-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="rzm-proj-doc-title">{d.title}</span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 10. ACTIVITY — chronological feed (news / signals / whales)
// ──────────────────────────────────────────────────────────────────────────

const FEED_KIND_GLYPH = {
  news: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12a2 2 0 0 1 2 2v14H4z" />
      <path d="M18 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4" />
      <line x1="7" y1="8" x2="13" y2="8" /><line x1="7" y1="12" x2="13" y2="12" /><line x1="7" y1="16" x2="13" y2="16" />
    </svg>
  ),
  whale: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12c2-3 4-4 6-4s4 2 6 2 4-1 6-4" />
      <path d="M2 16c2-3 4-4 6-4s4 2 6 2 4-1 6-4" />
    </svg>
  ),
  signal: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
}

function ActivityRzm({ news, signals, whales }) {
  const { t } = useTranslation()
  const items = []
  if (Array.isArray(news)) news.slice(0, 8).forEach((n) => items.push({ kind: 'news', time: typeof n.publishedAt === 'number' ? n.publishedAt : new Date(n.publishedAt).getTime(), title: n.title, source: n.source, url: n.url, tone: n.sentiment }))
  if (Array.isArray(signals?.active)) signals.active.slice(0, 6).forEach((s) => items.push({ kind: 'signal', time: new Date(s.createdAt).getTime(), title: s.title, source: (s.type || '').replace(/_/g, ' '), tone: s.direction }))
  if (Array.isArray(whales?.transactions)) whales.transactions.slice(0, 6).forEach((w) => items.push({ kind: 'whale', time: new Date(w.time).getTime(), title: `Whale ${(w.type || '').toLowerCase().includes('buy') ? 'BUY' : 'SELL'} ${fmtUsd(w.valueUsd)}`, source: `${w.from || '?'} → ${w.to || '?'}`, tone: (w.type || '').toLowerCase().includes('buy') ? 'bullish' : 'bearish' }))
  if (!items.length) return null
  items.sort((a, b) => (b.time || 0) - (a.time || 0))

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.activityrzm.label', "ACTIVITY")} title={t('researchPro.rzmProject.activityrzm.title', "What is happening")} sub={`${items.length} events · news + signals + on-chain`} />
      <ul className="rzm-proj-feed">
        {items.slice(0, 12).map((it, i) => (
          <li key={i} className={`rzm-proj-feed-item rzm-proj-feed-item--${it.tone || 'neutral'}`}>
            <span className={`rzm-proj-feed-icon rzm-proj-feed-icon--${it.kind}`} aria-hidden="true">
              {FEED_KIND_GLYPH[it.kind] || FEED_KIND_GLYPH.signal}
            </span>
            <div className="rzm-proj-feed-body">
              {it.url
                ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="rzm-proj-feed-title">{it.title}</a>
                : <span className="rzm-proj-feed-title">{it.title}</span>}
              {it.source && <span className="rzm-proj-feed-source">{it.source}</span>}
            </div>
            <span className="rzm-proj-feed-time">{fmtRel(it.time)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 11. REFERENCE — On-chain + Contracts + Categories + Audits + Hacks + Trust
// ──────────────────────────────────────────────────────────────────────────

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

const chainLabel = (raw) => String(raw || '')
  .replace(/-borrowed$/, '').replace(/[-_]/g, ' ')
  .replace(/\b\w/g, (ch) => ch.toUpperCase())

function ReferenceRzm({ dossier, spectreData }) {
  const { t } = useTranslation()
  const hacks = Array.isArray(dossier?.hacks) ? dossier.hacks : []
  const tags = Array.isArray(dossier?.tags) ? dossier.tags : []
  const audits = Array.isArray(dossier?.audits) ? dossier.audits : []
  const contracts = Array.isArray(dossier?.contracts) ? dossier.contracts : []
  const investors = Array.isArray(dossier?.investors) ? dossier.investors : []
  const stats = dossier?.socialStats || null
  const onchain = dossier?.onchainExplorer || null
  const used = dossier?.sourcesUsed || {}

  const sources = [
    { k: 'Market Data',         on: !!(used.coinpaprika || used.coingecko) },
    { k: 'Token Registry',      on: !!used.coingecko },
    { k: 'TVL & Protocols',     on: !!used.defillama },
    { k: 'Project Research',    on: !!used.messari },
    { k: 'Code Activity',       on: !!used.github },
    { k: 'Community Forum',     on: !!used.reddit },
    { k: 'Community Group',     on: !!used.telegram },
    { k: 'Community Chat',      on: !!used.discord },
    { k: 'Blockchain Explorer', on: !!used.explorer },
    { k: 'Safety Audit',        on: !!used.rugcheck },
    { k: 'Social Sentiment',    on: !!used.lunarcrush },
    { k: 'News Feed',           on: !!used.cryptopanic },
    { k: 'Spectre Score',       on: !!spectreData?.profile?.spectreScore?.overall },
    { k: 'Sentiment Engine',    on: !!spectreData?.sentiment?.score },
    { k: 'Derivatives Feed',    on: !!spectreData?.derivatives?.summary },
    { k: 'Fundraising',         on: Array.isArray(spectreData?.fundraising) && spectreData.fundraising.length > 0 },
  ]
  const onCount = sources.filter((s) => s.on).length

  const hasOnchain = onchain && (onchain.holdersCount != null || onchain.transfersCount != null)
  const hasAnything = hasOnchain || tags.length > 0 || hacks.length > 0 || audits.length > 0 || contracts.length > 0 || investors.length > 0 || stats || onCount > 0
  if (!hasAnything) return null

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.referencerzm.label', "REFERENCE")} title={t('researchPro.rzmProject.referencerzm.title', "Resources & receipts")} />

      {hasOnchain && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.referencerzm.onChain', "On-chain")}</div>
          <div className="rzm-proj-ref-stats">
            {onchain.holdersCount != null && (
              <div className="rzm-proj-ref-stat">
                <span className="rzm-proj-ref-stat-v">{onchain.holdersCount.toLocaleString()}</span>
                <span className="rzm-proj-ref-stat-k">{t('researchPro.rzmProject.referencerzm.holders', "Holders")}</span>
              </div>
            )}
            {onchain.transfersCount != null && (
              <div className="rzm-proj-ref-stat">
                <span className="rzm-proj-ref-stat-v">{onchain.transfersCount.toLocaleString()}</span>
                <span className="rzm-proj-ref-stat-k">{t('researchPro.rzmProject.referencerzm.transfers', "Transfers")}</span>
              </div>
            )}
            {onchain.contractMeta?.type && (
              <div className="rzm-proj-ref-stat">
                <span className="rzm-proj-ref-stat-v">{onchain.contractMeta.type}</span>
                <span className="rzm-proj-ref-stat-k">{t('researchPro.rzmProject.referencerzm.standard', "Standard")}</span>
              </div>
            )}
          </div>
        </>
      )}

      {contracts.length > 0 && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.referencerzm.contracts', "Contracts")}</div>
          <div className="rzm-proj-contracts">
            {contracts.slice(0, 6).map((c, i) => {
              const url = explorerUrl(c.chain, c.address)
              const addr = String(c.address || '')
              const inner = (
                <>
                  <span className="rzm-proj-contract-chain">{chainLabel(c.chain)}</span>
                  <span className="rzm-proj-contract-addr">{shortAddr(addr)}</span>
                </>
              )
              return url
                ? <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="rzm-proj-contract">{inner}</a>
                : <span key={i} className="rzm-proj-contract">{inner}</span>
            })}
          </div>
        </>
      )}

      {tags.length > 0 && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.referencerzm.categories', "Categories")}</div>
          <div className="rzm-cat-row">
            {tags.slice(0, 16).map((t, i) => <span key={i} className="rzm-cat-chip">{t}</span>)}
          </div>
        </>
      )}

      {investors.length > 0 && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.referencerzm.investors', "Investors")}</div>
          <div className="rzm-cat-row">
            {investors.slice(0, 12).map((inv, i) => (
              <span key={i} className="rzm-cat-chip">{inv?.name || inv}</span>
            ))}
          </div>
        </>
      )}

      {stats && Object.keys(stats).length > 0 && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.referencerzm.community', "Community")}</div>
          <div className="rzm-proj-ref-stats">
            {stats.twitterFollowers > 0 && (
              <div className="rzm-proj-ref-stat">
                <span className="rzm-proj-ref-stat-v">{fmtCompact(stats.twitterFollowers)}</span>
                <span className="rzm-proj-ref-stat-k">{t('researchPro.rzmProject.referencerzm.onX', "on X")}</span>
              </div>
            )}
            {stats.telegramMembers > 0 && (
              <div className="rzm-proj-ref-stat">
                <span className="rzm-proj-ref-stat-v">{fmtCompact(stats.telegramMembers)}</span>
                <span className="rzm-proj-ref-stat-k">Telegram</span>
              </div>
            )}
            {stats.redditSubscribers > 0 && (
              <div className="rzm-proj-ref-stat">
                <span className="rzm-proj-ref-stat-v">{fmtCompact(stats.redditSubscribers)}</span>
                <span className="rzm-proj-ref-stat-k">Reddit</span>
              </div>
            )}
            {stats.mindshare > 0 && (
              <div className="rzm-proj-ref-stat">
                <span className="rzm-proj-ref-stat-v">{Number(stats.mindshare).toFixed(1)}</span>
                <span className="rzm-proj-ref-stat-k">{t('researchPro.rzmProject.referencerzm.mindshare', "Mindshare")}</span>
              </div>
            )}
          </div>
        </>
      )}

      {audits.length > 0 && (
        <>
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.referencerzm.audits', "Audits")}</div>
          <ul className="rzm-proj-list">
            {audits.slice(0, 6).map((a, i) => (
              <li key={i} className="rzm-proj-list-row">
                {a.url
                  ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.auditor} <Arrow /></a>
                  : <span>{a.auditor}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {hacks.length > 0 && (
        <>
          <div className="rzm-proj-subtitle rzm-proj-subtitle--warn">{t('researchPro.rzmProject.referencerzm.pastIncidents', "Past incidents")}</div>
          <ul className="rzm-proj-list">
            {hacks.slice(0, 5).map((h, i) => (
              <li key={i} className="rzm-proj-list-row rzm-proj-list-row--warn">
                <span className="rzm-proj-hack-amt">{fmtUsd(h.amount)}</span>
                <span className="rzm-proj-hack-name">{h.name}</span>
                <span className="rzm-proj-hack-date">{h.date ? new Date(h.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="rzm-proj-subtitle">Trust score · {onCount}/{sources.length} sources</div>
      <div className="rzm-proj-trust">
        {[...sources].sort((a, b) => Number(b.on) - Number(a.on)).map((s) => (
          <span key={s.k} className={`rzm-proj-trust-chip${s.on ? ' rzm-proj-trust-chip--on' : ''}`}>{s.k}</span>
        ))}
      </div>
    </div>
  )
}

// ── FROM THE SOURCE — crawled intelligence (2026-08-25), mobile mirror ────
// Site crawl + the team's own X tape + honest public-code signal. Same data
// contract as SourceIntelSection in rz-project-cinema.jsx; absence hides each
// block. An idle PUBLIC repo is never rendered as team inactivity.
function SourceIntelRzm({ siteIntel, teamTape, github }) {
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
  const cadenceOn = tape ? (tape.posts24h >= 1 || tape.posts7d >= 3) : false
  const lastPushDays = build
    ? (build.lastPushDays != null
      ? build.lastPushDays
      : build.lastCommit ? Math.max(0, Math.round((Date.now() - new Date(build.lastCommit).getTime()) / 86400_000)) : null)
    : null
  const repoName = build?.repo || (build?.url ? String(build.url).replace(/^https?:\/\/(www\.)?github\.com\//i, '') : null)

  return (
    <div className="rzm-section rzm-proj-section">
      <Head label={t('researchPro.rzmProject.sourceintelrzm.label', "FROM THE SOURCE")} />
      {siteIntel && (
        <div className="rzm-proj-src-block">
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.sourceintelrzm.theSiteSays', "The site says")}</div>
          {siteIntel.whatItDoes && <p className="rzm-proj-src-lead">{siteIntel.whatItDoes}</p>}
          <p className="rzm-proj-src-meta">
            {[
              siteIntel.productStage && siteIntel.productStage !== 'unknown' ? `stage ${siteIntel.productStage}` : null,
              siteIntel.evidenceOfShipping ? `shipping ${siteIntel.evidenceOfShipping}` : null,
            ].filter(Boolean).join(' · ')}
          </p>
          {siteIntel.roadmapNext && <p className="rzm-proj-src-meta">Next: {siteIntel.roadmapNext}</p>}
        </div>
      )}
      {tape && (
        <div className="rzm-proj-src-block">
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.sourceintelrzm.theTeamOnX', "The team on X")}</div>
          <p className="rzm-proj-src-lead">
            <a href={`https://x.com/${tape.handle}`} target="_blank" rel="noopener noreferrer">@{tape.handle}</a>
            {' '}<span className={cadenceOn ? 'rzm-proj-src-live' : 'rzm-proj-src-dim'}>{cadence}</span>
          </p>
          <p className="rzm-proj-src-meta">
            {tape.posts24h} posts 24h · {tape.posts7d} posts 7d
            {tape.newestAgeHours != null && ` · newest ${tape.newestAgeHours < 48 ? `${Math.round(tape.newestAgeHours)}h` : `${Math.round(tape.newestAgeHours / 24)}d`} ago`}
          </p>
          {(tape.sample || []).slice(0, 2).map((t, i) => (
            <p key={i} className="rzm-proj-src-post">{t.text}{t.age ? ` — ${t.age}` : ''}</p>
          ))}
        </div>
      )}
      {build && (repoName || lastPushDays != null) && (
        <div className="rzm-proj-src-block">
          <div className="rzm-proj-subtitle">{t('researchPro.rzmProject.sourceintelrzm.publicCode', "Public code")}</div>
          <p className="rzm-proj-src-meta">
            {repoName || 'repo'}
            {lastPushDays != null && ` · newest public push ${lastPushDays === 0 ? 'today' : `${lastPushDays}d ago`}`}
            {build.stars != null && ` · ${build.stars} stars`}
          </p>
          {lastPushDays != null && lastPushDays > 45 && (
            <p className="rzm-proj-src-note">Public repos only — an idle public repo is not team inactivity.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — render all 11 sections in order
// ──────────────────────────────────────────────────────────────────────────

function RzmProjectSections({
  sym, td,
  dossier, spectreData,
  onChainData,
}) {
  const score = spectreData?.profile?.spectreScore
  const signals = spectreData?.profile?.signals
  const whales = spectreData?.profile?.whales
  const sentiment = spectreData?.sentiment

  return (
    <>
      <StageStatsRzm td={td} dossier={dossier} score={score} risk={dossier?.riskComposite} onChainData={onChainData} />
      <SpectreTakeRzm
        take={dossier?.spectreTake}
        takeAt={dossier?.spectreTakeAt}
        signals={signals}
        sentiment={sentiment}
        td={td}
        whales={whales}
        conviction={dossier?.conviction}
        sym={sym}
      />
      <ChainTvlRzm sym={sym} />
      <HealthRzm risk={dossier?.riskComposite} opp={dossier?.opportunityScore} />
      <PositioningRzm sentiment={sentiment} />
      <HoldersRzm breakdown={dossier?.holderBreakdown} />
      <SourceIntelRzm siteIntel={dossier?.siteIntel} teamTape={dossier?.teamTape} github={dossier?.github} />
      <FounderRzm spotlight={dossier?.founderSpotlight} />
      <BuildersRzm
        team={dossier?.team}
        partners={dossier?.partners}
        investors={dossier?.investors}
        fundraising={spectreData?.fundraising}
      />
      <BuildingRzm
        whitepaperUrl={dossier?.whitepaperUrl}
        whitepaperThumb={dossier?.whitepaperThumb}
        roadmap={dossier?.roadmap}
        docsToc={dossier?.docsToc}
        sym={sym}
      />
      <ActivityRzm news={dossier?.newsFeed} signals={signals} whales={whales} />
      <ReferenceRzm dossier={dossier} spectreData={spectreData} />
    </>
  )
}

// Memoized: the mobile Overview renders this inline, so it otherwise re-ran the
// whole 11-section tree on every pull-to-refresh touchmove frame (pullDistance)
// and every price tick. Props (sym/td/dossier/spectreData/onChainData) only
// change on real data updates, so shallow-compare skips the pull/refresh churn.
export default React.memo(RzmProjectSections)
