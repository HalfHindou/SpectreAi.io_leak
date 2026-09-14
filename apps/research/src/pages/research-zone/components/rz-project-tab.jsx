/**
 * Research Zone PRO — Project Tab v2
 * Apple Cinematic + signal-rich. Sections:
 *   1. Identity Hero          token mark + price + multi-period changes + key stats
 *   2. Tokenomics             supply distribution donut + market cap stats
 *   3. Project Description    coinDetails.description with fade mask
 *   4. Key Levels             levels with distance % and bull/bear pills
 *   5. Links                  grouped by Official / Social / Code
 *   6. Holder Map             Bubblemaps iframe
 */
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import useDossierProject from '@/hooks/useDossierProject'
import useSpectreAssetData from '@/hooks/useSpectreAssetData'
import ProjectCinema from './rz-project-cinema'
import RzProjectSnapshot from './rz-project-snapshot'
import RzHolderDistribution from './rz-holder-distribution'
import RzLiveDumpAlert from './rz-live-dump-alert'
import RzTradeTape from './rz-trade-tape'
import './rz-project-tab.css'


/* ── Helpers ──────────────────────────────────────────────────────────── */

function fmtCompact(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}

function fmtUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n).toLocaleString()}`
}

function fmtPct(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return null
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}%`
}

function fmtAge(ts) {
  if (!ts) return null
  const ms = ts > 1e12 ? ts : ts * 1000
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86400_000))
  if (days < 1) return '< 1d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  const years = days / 365
  return years < 10 ? `${years.toFixed(1)}y` : `${Math.floor(years)}y`
}

const BUBBLEMAPS_CHAIN_MAP = {
  1: 'eth', 56: 'bsc', 137: 'poly', 42161: 'arbi', 43114: 'avax',
  8453: 'base', 250: 'ftm', 25: 'cro', 10: 'opti', 1399811149: 'sol',
}
const CHAIN_LABEL = {
  1: 'Ethereum', 56: 'BNB Chain', 137: 'Polygon', 42161: 'Arbitrum',
  43114: 'Avalanche', 8453: 'Base', 250: 'Fantom', 25: 'Cronos',
  10: 'Optimism', 1399811149: 'Solana',
}

function resolveBubblemapsChain(networkId, address) {
  if (!address) return null
  const chain = BUBBLEMAPS_CHAIN_MAP[networkId]
  return chain ? { chain, address } : null
}

function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return ''
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}


/* ── Identity Hero ─────────────────────────────────────────────────────── */

const ChangePill = ({ label, value }) => {
  const formatted = fmtPct(value)
  if (formatted == null) {
    return (
      <div className="rz-proj-chg">
        <span className="rz-proj-chg-label">{label}</span>
        <span className="rz-proj-chg-val mono">—</span>
      </div>
    )
  }
  const cls = value > 0 ? 'rz-proj-chg--up' : value < 0 ? 'rz-proj-chg--down' : ''
  return (
    <div className={`rz-proj-chg ${cls}`}>
      <span className="rz-proj-chg-label">{label}</span>
      <span className="rz-proj-chg-val mono">{formatted}</span>
    </div>
  )
}

const IdentityHero = React.memo(({ sym, td, fmtPrice, tokenColor, onChainData, activeTokenInfo }) => {
  const { t } = useTranslation()
  const change24h = td?.change24h
  const direction = change24h == null ? null : change24h > 0 ? 'up' : change24h < 0 ? 'down' : null

  const initials = (td?.name || sym || '?').slice(0, 2).toUpperCase()
  const hasLogo = !!td?.logo
  const tokenRgb = tokenColor?.bg || '139, 92, 246'

  // 24h range: position of current price within low-high band
  const low = Number(td?.low24h)
  const high = Number(td?.high24h)
  const cur = Number(td?.price)
  const haveRange = Number.isFinite(low) && Number.isFinite(high) && Number.isFinite(cur) && high > low
  const rangePct = haveRange ? Math.max(0, Math.min(100, ((cur - low) / (high - low)) * 100)) : 0

  // Native L1 assets don't have an ERC-20-style holders count; on-chain age
  // for them is also wrong (it's based on a wrapped-token sidedata source).
  // Skip both for native chains.
  const NATIVE_L1 = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ATOM', 'NEAR', 'XLM', 'XMR', 'TON', 'APT', 'SUI', 'HBAR', 'ICP', 'FIL', 'KAS', 'ALGO', 'EGLD', 'XTZ'])
  const isNativeAsset = NATIVE_L1.has(String(sym || '').toUpperCase())

  const stats = [
    td?.rank && { label: 'Rank', value: `#${td.rank}` },
    td?.marketCap && { label: 'Market Cap', value: fmtUsd(td.marketCap) },
    td?.fdv && { label: 'FDV', value: fmtUsd(td.fdv) },
    td?.volume && { label: 'Vol 24h', value: fmtUsd(td.volume) },
    Number.isFinite(td?.volMcapPct) && { label: 'Vol/MCap', value: `${td.volMcapPct.toFixed(2)}%` },
    !isNativeAsset && Number.isFinite(Number(onChainData?.holders)) && { label: 'Holders', value: fmtCompact(onChainData.holders) },
    !isNativeAsset && fmtAge(onChainData?.age) && { label: 'Age', value: fmtAge(onChainData.age) },
    Number.isFinite(td?.athChangePct) && {
      label: 'From ATH',
      value: `${td.athChangePct > 0 ? '+' : ''}${td.athChangePct.toFixed(1)}%`,
    },
  ].filter(Boolean)

  return (
    <div
      className="rz-proj-hero"
      style={{ '--rz-proj-token-rgb': tokenRgb }}
    >
      <div className="rz-proj-hero-glow" aria-hidden="true" />

      <div className="rz-proj-hero-row">
        <div className="rz-proj-hero-id">
          <div className="rz-proj-hero-mark">
            {hasLogo ? (
              <img
                src={td.logo}
                alt=""
                className="rz-proj-hero-mark-img"
                onError={(e) => {
                  const parent = e.target.parentElement
                  e.target.remove()
                  if (parent) {
                    const span = document.createElement('span')
                    span.className = 'rz-proj-hero-mark-fallback'
                    span.textContent = initials
                    parent.appendChild(span)
                  }
                }}
              />
            ) : (
              <span className="rz-proj-hero-mark-fallback">{initials}</span>
            )}
          </div>
          <div className="rz-proj-hero-name">
            <h1 className="rz-proj-hero-title">
              {td?.name || sym}
              <span className="rz-proj-hero-sym">{sym}</span>
            </h1>
            <span className="rz-proj-hero-meta-row">
              <span className="rz-proj-live">
                <span className="rz-proj-live-dot" />
                <span className="rz-proj-live-label">{t('researchPro.project.identityhero.live', "LIVE")}</span>
              </span>
              {activeTokenInfo?.networkId && CHAIN_LABEL[activeTokenInfo.networkId] && (
                <>
                  <span className="rz-proj-hero-meta-sep" />
                  <span className="rz-proj-hero-chain">
                    {CHAIN_LABEL[activeTokenInfo.networkId]}
                  </span>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="rz-proj-hero-price">
          <span className="rz-proj-hero-price-val mono">
            {td?.price != null ? fmtPrice(td.price) : '—'}
          </span>
          {direction && (
            <span className={`rz-proj-hero-price-chg rz-proj-hero-price-chg--${direction} mono`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                {direction === 'up' ? <path d="M6 15l6-6 6 6"/> : <path d="M6 9l6 6 6-6"/>}
              </svg>
              {fmtPct(change24h)}
            </span>
          )}
        </div>
      </div>

      {haveRange && (
        <div className="rz-proj-hero-range" aria-hidden="true">
          <span className="rz-proj-hero-range-anchor">
            <span className="rz-proj-hero-range-anchor-label">24h Low</span>
            <span className="rz-proj-hero-range-anchor-val mono">{fmtPrice(low)}</span>
          </span>
          <div className="rz-proj-hero-range-track">
            <span className="rz-proj-hero-range-fill" style={{ width: `${rangePct}%` }} />
            <span className="rz-proj-hero-range-now" style={{ left: `${rangePct}%` }} />
          </div>
          <span className="rz-proj-hero-range-anchor rz-proj-hero-range-anchor--end">
            <span className="rz-proj-hero-range-anchor-label">24h High</span>
            <span className="rz-proj-hero-range-anchor-val mono">{fmtPrice(high)}</span>
          </span>
        </div>
      )}

      <div className="rz-proj-hero-changes">
        <ChangePill label="1H"  value={td?.change1h} />
        <ChangePill label="24H" value={td?.change24h} />
        <ChangePill label="7D"  value={td?.change7d} />
        <ChangePill label="30D" value={td?.change30d} />
      </div>

      {stats.length > 0 && (
        <div className="rz-proj-hero-stats">
          {stats.map((s) => (
            <div key={s.label} className="rz-proj-hero-stat">
              <span className="rz-proj-hero-stat-label">{s.label}</span>
              <span className="rz-proj-hero-stat-val mono">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {activeTokenInfo?.address && (
        <div className="rz-proj-hero-contract">
          <span className="rz-proj-hero-contract-label">{t('researchPro.project.identityhero.contract', "Contract")}</span>
          <code className="rz-proj-hero-contract-addr mono">{shortAddress(activeTokenInfo.address)}</code>
          <button
            type="button"
            className="rz-proj-hero-contract-copy"
            onClick={() => { try { navigator.clipboard?.writeText(activeTokenInfo.address) } catch {} }}
            aria-label={t('researchPro.project.identityhero.ariaCopyContractAddress', "Copy contract address")}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
})


/* ── Tokenomics ─────────────────────────────────────────────────────────── */

const TokenomicsSection = React.memo(({ td }) => {
  const { t } = useTranslation()
  const circ = Number(td?.circulatingSupply)
  const total = Number(td?.totalSupply)
  const mcap = Number(td?.marketCap)
  const fdv = Number(td?.fdv)

  const haveCirc = Number.isFinite(circ) && circ > 0
  const haveTotal = Number.isFinite(total) && total > 0
  // Hide donut entirely if we don't have circulating — a 0% donut looks broken.
  if (!haveCirc) return null

  const circPct = (haveCirc && haveTotal && total > 0) ? Math.min(100, (circ / total) * 100) : (haveCirc ? 100 : 0)
  const lockedPct = 100 - circPct

  // Donut math
  const r = 52
  const c = 2 * Math.PI * r
  const circStroke = (circPct / 100) * c
  const lockedStroke = (lockedPct / 100) * c

  return (
    <SectionShell
      id="proj-tokenomics"
      label={t('researchPro.project.tokenomics.label', "PROJECT · TOKENOMICS")}
      title={t('researchPro.project.tokenomics.title', "Tokenomics")}
      subtitle={t('researchPro.project.tokenomics.subtitle', "Supply distribution and dilution profile")}
      collapsible
    >
      <div className="rz-proj-tk">
        <div className="rz-proj-tk-donut" aria-hidden="true">
          <svg viewBox="0 0 140 140" width="140" height="140">
            {/* Track at 0.06 opacity */}
            <circle
              cx="70" cy="70" r={r}
              fill="none"
              stroke="rgba(255, 255, 255, 0.06)"
              strokeWidth="10"
            />
            {/* Glow guide ring at 0.18 opacity (zone marker) */}
            {haveCirc && (
              <circle
                cx="70" cy="70" r={r}
                fill="none"
                stroke="rgba(48, 209, 88, 0.18)"
                strokeWidth="10"
                strokeDasharray={`${circStroke} ${c - circStroke}`}
                strokeDashoffset={c / 4}
                transform="rotate(-90 70 70)"
              />
            )}
            {/* Solid arc at 0.85 opacity */}
            {haveCirc && (
              <circle
                cx="70" cy="70" r={r}
                fill="none"
                stroke="rgba(48, 209, 88, 0.85)"
                strokeWidth="10"
                strokeDasharray={`${Math.max(0, circStroke - 4)} ${c - Math.max(0, circStroke - 4)}`}
                strokeDashoffset={c / 4 - 2}
                strokeLinecap="round"
                transform="rotate(-90 70 70)"
              />
            )}
          </svg>
          <div className="rz-proj-tk-donut-center">
            <span className="rz-proj-tk-donut-pct">{circPct.toFixed(0)}%</span>
            <span className="rz-proj-tk-donut-label">{t('researchPro.project.tokenomics.circulating', "Circulating")}</span>
          </div>
        </div>

        <div className="rz-proj-tk-stats">
          <div className="rz-proj-tk-stat">
            <span className="rz-proj-tk-stat-dot" style={{ background: 'linear-gradient(135deg, #34D399, #10B981)' }} />
            <span className="rz-proj-tk-stat-label">{t('researchPro.project.tokenomics.circulating', "Circulating")}</span>
            <span className="rz-proj-tk-stat-val mono">
              {haveCirc ? `${fmtCompact(circ)} ${td.symbol || ''}` : '—'}
            </span>
          </div>
          <div className="rz-proj-tk-stat">
            <span className="rz-proj-tk-stat-dot rz-proj-tk-stat-dot--locked" />
            <span className="rz-proj-tk-stat-label">{t('researchPro.project.tokenomics.lockedFuture', "Locked / Future")}</span>
            <span className="rz-proj-tk-stat-val mono">
              {(haveTotal && haveCirc) ? fmtCompact(Math.max(0, total - circ)) : '—'}
            </span>
          </div>
          <div className="rz-proj-tk-stat">
            <span className="rz-proj-tk-stat-label">{t('researchPro.project.tokenomics.totalSupply', "Total Supply")}</span>
            <span className="rz-proj-tk-stat-val mono">{haveTotal ? fmtCompact(total) : '—'}</span>
          </div>
          {Number.isFinite(mcap) && Number.isFinite(fdv) && fdv > 0 && (
            <div className="rz-proj-tk-stat">
              <span className="rz-proj-tk-stat-label">{t('researchPro.project.tokenomics.mcapFdv', "MCap / FDV")}</span>
              <span className="rz-proj-tk-stat-val mono">{((mcap / fdv) * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  )
})


/* ── Description ─────────────────────────────────────────────────────────── */

// Backend returns this generic placeholder when CG/Codex have no real description.
// Suppress it so the section doesn't render an obvious filler.
const PLACEHOLDER_DESC_RE = /tracked with live Spectre market data on .+\. Full project description metadata is pending/i

const DescriptionSection = React.memo(({ description, sym }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const text = description || ''
  const isLong = text.length > 320
  if (!text) return null
  if (PLACEHOLDER_DESC_RE.test(text)) return null

  return (
    <SectionShell
      id="proj-description"
      label={`PROJECT · ABOUT ${sym}`}
      title={t('researchPro.project.description.title', "Project Description")}
      subtitle={t('researchPro.project.description.subtitle', "Project purpose, architecture, and positioning")}
      collapsible
    >
      <div className={`rz-proj-desc-wrap ${!expanded && isLong ? 'rz-proj-desc-wrap--clamped' : ''}`}>
        <p className="rz-proj-desc">{text}</p>
        {!expanded && isLong && <span className="rz-proj-desc-fade" aria-hidden="true" />}
      </div>
      {isLong && (
        <button type="button" className="rz-proj-desc-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show less' : 'Read more'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={expanded ? 'rz-proj-chev flipped' : 'rz-proj-chev'}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
      )}
    </SectionShell>
  )
})


/* ── Key Levels with bull/bear pills ────────────────────────────────────── */

const KeyLevelsSection = React.memo(({ tokenProfile, td, fmtPrice }) => {
  const { t } = useTranslation()
  const kl = tokenProfile?.token_details?.key_levels
  const support = Number(kl?.support)
  const resistance = Number(kl?.resistance)
  const pivot = Number(kl?.pivot)
  const current = Number(td?.price)

  const haveAny = [support, resistance, pivot].some(Number.isFinite)
  if (!haveAny) return null

  const valid = [
    Number.isFinite(resistance) && { key: 'resistance', label: 'Resistance', value: resistance, kind: 'sell',  signal: 'BEAR' },
    Number.isFinite(pivot)      && { key: 'pivot',      label: 'Pivot',      value: pivot,      kind: 'pivot', signal: 'NEUTRAL' },
    Number.isFinite(support)    && { key: 'support',    label: 'Support',    value: support,    kind: 'buy',   signal: 'BULL' },
  ].filter(Boolean)

  const allValues = valid.map(v => v.value)
  if (Number.isFinite(current)) allValues.push(current)
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const range = (max - min) || 1
  const pct = (v) => Number.isFinite(v) ? ((v - min) / range) * 100 : 0

  const dist = (level) => {
    if (!Number.isFinite(current) || !Number.isFinite(level) || current === 0) return null
    return ((level - current) / current) * 100
  }

  return (
    <SectionShell
      id="proj-key-levels"
      label={t('researchPro.project.keylevels.label', "PROJECT · KEY LEVELS")}
      title={t('researchPro.project.keylevels.title', "Key Levels")}
      subtitle={t('researchPro.project.keylevels.subtitle', "Tracked support / resistance with distance from spot")}
      collapsible
    >
      <div className="rz-proj-ladder">
        <div className="rz-proj-ladder-track" aria-hidden="true">
          {valid.map(v => (
            <span
              key={`tick-${v.key}`}
              className={`rz-proj-ladder-tick rz-proj-ladder-tick--${v.kind}`}
              style={{ left: `${pct(v.value)}%` }}
            />
          ))}
          {Number.isFinite(current) && (
            <span
              className="rz-proj-ladder-now"
              style={{ left: `${pct(current)}%` }}
              title={t('researchPro.project.keylevels.title2', "Current price")}
            />
          )}
        </div>

        <div className="rz-proj-lv-grid">
          {valid.map(v => {
            const d = dist(v.value)
            const dCls = d == null ? '' : d > 0 ? 'rz-proj-lv-dist--up' : d < 0 ? 'rz-proj-lv-dist--down' : ''
            return (
              <div key={v.key} className={`rz-proj-lv rz-proj-lv--${v.kind}`}>
                <div className="rz-proj-lv-head">
                  <span className={`rz-proj-lv-dot rz-proj-lv-dot--${v.kind}`} />
                  <span className="rz-proj-lv-label">{v.label}</span>
                  <span className={`rz-proj-pill rz-proj-pill--${v.signal.toLowerCase()}`}>{v.signal}</span>
                </div>
                <span className="rz-proj-lv-val mono">{fmtPrice(v.value)}</span>
                {d != null && (
                  <span className={`rz-proj-lv-dist mono ${dCls}`}>
                    {d > 0 ? '+' : ''}{d.toFixed(2)}%
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </SectionShell>
  )
})


/* ── Links ──────────────────────────────────────────────────────────────── */

const LinkIcons = {
  website: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/>
    </svg>
  ),
  twitter: (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.53 3H20l-6.44 7.36L21 21h-5.88l-4.6-6.01L4.94 21H2.47l6.9-7.88L2.34 3h6.03l4.15 5.48L17.53 3zm-1.03 16.2h1.37L7.58 4.72H6.1l10.4 14.48z"/></svg>),
  telegram: (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 15.12l-.38 4.38c.54 0 .78-.23 1.06-.51l2.55-2.45 5.29 3.87c.97.54 1.67.26 1.93-.9l3.5-16.42c.35-1.44-.52-2-1.47-1.64L.98 9.77c-1.4.54-1.38 1.32-.24 1.68l5.2 1.62L17.83 5.6c.57-.38 1.08-.17.66.2L9.78 15.12z"/></svg>),
  reddit: (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12.08a2.16 2.16 0 00-3.66-1.55 10.5 10.5 0 00-5.72-1.81l1-4.72 3.27.7a1.56 1.56 0 103.12-.14v-.08a1.56 1.56 0 00-2.97-.65l-3.66-.78a.41.41 0 00-.49.31l-1.1 5.21a10.5 10.5 0 00-5.8 1.8A2.16 2.16 0 002 12.08a2.14 2.14 0 001.2 1.94 4.35 4.35 0 00-.06.77c0 3.9 4.42 7.07 9.86 7.07s9.86-3.17 9.86-7.07a4.37 4.37 0 00-.06-.77A2.14 2.14 0 0022 12.08zM7 13.58a1.56 1.56 0 113.12 0 1.56 1.56 0 11-3.12 0zm8.89 4.15A6.69 6.69 0 0112 18.6a6.69 6.69 0 01-3.89-.87.41.41 0 01.58-.58A5.88 5.88 0 0012 17.77a5.88 5.88 0 003.31-.62.41.41 0 01.58.58zm-.16-2.59a1.56 1.56 0 110-3.12 1.56 1.56 0 010 3.12z"/></svg>),
  github: (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 00-3.79 23.38c.6.11.82-.26.82-.58v-2.02c-3.33.72-4.04-1.61-4.04-1.61-.54-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.64 1.66.23 2.88.11 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .3"/></svg>),
  discord: (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.22 5.5a18.4 18.4 0 00-4.52-1.4l-.23.47a16.9 16.9 0 014.05 1.27 11.4 11.4 0 00-7.52-1.84 11.4 11.4 0 00-7.52 1.84 16.9 16.9 0 014.05-1.27l-.23-.47a18.4 18.4 0 00-4.52 1.4C.92 9.6 0 13.66 0 17.64a18.4 18.4 0 005.59 2.9l.82-1.24a11.8 11.8 0 01-2.93-1.43c.25.18.5.35.76.51a18 18 0 0015.52 0c.26-.16.51-.33.76-.51a11.8 11.8 0 01-2.93 1.43l.82 1.24A18.4 18.4 0 0024 17.64c0-3.98-.92-8.04-3.78-12.14zM8.28 14.66c-1.16 0-2.1-1.07-2.1-2.39s.94-2.39 2.1-2.39c1.17 0 2.11 1.08 2.1 2.39 0 1.32-.94 2.39-2.1 2.39zm7.44 0c-1.16 0-2.1-1.07-2.1-2.39s.94-2.39 2.1-2.39c1.17 0 2.11 1.08 2.1 2.39 0 1.32-.94 2.39-2.1 2.39z"/></svg>),
}

const ARROW_OUT = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 17 17 7" /><path d="M8 7h9v9" />
  </svg>
)

const LinkPill = React.memo(({ href, label, icon, kind }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={`rz-proj-link rz-proj-link--${kind || 'official'}`}
  >
    <span className="rz-proj-link-icon">{icon}</span>
    <span className="rz-proj-link-label">{label}</span>
    <span className="rz-proj-link-arrow">{ARROW_OUT}</span>
  </a>
))

const LinksSection = React.memo(({ coinDetails, spectreSocial, sym }) => {
  const { t } = useTranslation()
  const aboutLinks = coinDetails?.links || null
  const social = spectreSocial?.Social_Media || null

  const homepage = (Array.isArray(aboutLinks?.homepage) ? aboutLinks.homepage[0] : aboutLinks?.homepage) || social?.Website || null
  const twitter = aboutLinks?.twitter_screen_name
    ? `https://x.com/${aboutLinks.twitter_screen_name}`
    : social?.Twitter || null
  const telegram = aboutLinks?.telegram_channel_identifier
    ? `https://telegram.me/${aboutLinks.telegram_channel_identifier}`
    : social?.Telegram || null
  const reddit = (aboutLinks?.subreddit_url && aboutLinks.subreddit_url !== 'https://www.reddit.com')
    ? aboutLinks.subreddit_url
    : social?.Reddit || null
  const githubUrls = aboutLinks?.repos_url?.github?.length
    ? aboutLinks.repos_url.github
    : (social?.Github ? [social.Github] : [])
  const discord = social?.Discord || null

  const groups = useMemo(() => ({
    Official: [
      homepage && { href: homepage, label: 'Website', icon: LinkIcons.website },
    ].filter(Boolean),
    Social: [
      twitter  && { href: twitter,  label: 'X / Twitter', icon: LinkIcons.twitter },
      telegram && { href: telegram, label: 'Telegram',    icon: LinkIcons.telegram },
      discord  && { href: discord,  label: 'Discord',     icon: LinkIcons.discord },
      reddit   && { href: reddit,   label: 'Reddit',      icon: LinkIcons.reddit },
    ].filter(Boolean),
    Code: githubUrls.slice(0, 3).map((url, i) => ({
      href: url,
      label: githubUrls.length > 1
        ? (url.split('/').slice(-1)[0] || `GitHub ${i + 1}`)
        : 'GitHub',
      icon: LinkIcons.github,
    })),
  }), [homepage, twitter, telegram, discord, reddit, githubUrls])

  const total = groups.Official.length + groups.Social.length + groups.Code.length
  if (!total) return null

  return (
    <SectionShell
      id="proj-links"
      label={`PROJECT · LINKS`}
      title={t('researchPro.project.links.title', "Links")}
      subtitle={`Official channels for ${sym}`}
      collapsible
    >
      <div className="rz-proj-links-groups">
        {Object.entries(groups).map(([groupName, items]) => (
          items.length > 0 && (
            <div key={groupName} className="rz-proj-links-group">
              <span className="rz-proj-links-group-label">{groupName}</span>
              <div className="rz-proj-links">
                {items.map((p) => (
                  <LinkPill
                    key={`${p.label}-${p.href}`}
                    href={p.href}
                    label={p.label}
                    icon={p.icon}
                    kind={groupName.toLowerCase()}
                  />
                ))}
              </div>
            </div>
          )
        ))}
      </div>
    </SectionShell>
  )
})


/* ── Bubblemaps ─────────────────────────────────────────────────────────── */

const BubblemapsSection = React.memo(({ activeTokenInfo }) => {
  const { t } = useTranslation()
  const resolved = useMemo(
    () => resolveBubblemapsChain(activeTokenInfo?.networkId, activeTokenInfo?.address),
    [activeTokenInfo?.networkId, activeTokenInfo?.address]
  )
  if (!resolved) return null

  const src = `https://v2.bubblemaps.io/map?address=${resolved.address}&chain=${resolved.chain}`
  const chainLabel = CHAIN_LABEL[activeTokenInfo?.networkId] || resolved.chain.toUpperCase()

  return (
    <SectionShell
      id="proj-bubblemaps"
      label={t('researchPro.project.bubblemaps.label', "PROJECT · HOLDER MAP")}
      title={t('researchPro.project.bubblemaps.title', "Holder Map")}
      subtitle={t('researchPro.project.bubblemaps.subtitle', "Bubblemaps: top holders and cluster visualisation")}
      liveBadge
      rightSlot={<span className="rz-proj-bubbles-chain">{chainLabel}</span>}
      collapsible
    >
      <div className="rz-proj-bubbles">
        <iframe
          src={src}
          title={t('researchPro.project.bubblemaps.title2', "Bubblemaps holder map")}
          className="rz-proj-bubbles-iframe"
          loading="lazy"
          allowFullScreen
        />
      </div>
    </SectionShell>
  )
})


/* ── Dossier-driven sections (whitepaper, team, roadmap, partners, docs) ─ */

const TaglineSection = React.memo(({ tagline, sym }) => {
  const { t } = useTranslation()
  if (!tagline) return null
  return (
    <SectionShell
      id="proj-tagline"
      label={`PROJECT · TAGLINE`}
      title={t('researchPro.project.tagline.title', "In one line")}
      subtitle={`How ${sym} describes itself`}
      collapsible
    >
      <p className="rz-proj-tagline">{tagline}</p>
    </SectionShell>
  )
})

const WhitepaperSection = React.memo(({ whitepaperUrl, whitepaperThumb, sym }) => {
  const { t } = useTranslation()
  if (!whitepaperUrl) return null
  return (
    <SectionShell
      id="proj-whitepaper"
      label={t('researchPro.project.whitepaper.label', "PROJECT · WHITEPAPER")}
      title={t('researchPro.project.whitepaper.title', "Whitepaper")}
      subtitle={t('researchPro.project.whitepaper.subtitle', "Official documentation")}
      collapsible
    >
      <a
        className="rz-proj-wp-card"
        href={whitepaperUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {whitepaperThumb ? (
          <img className="rz-proj-wp-thumb" src={whitepaperThumb} alt="" loading="lazy" />
        ) : (
          <div className="rz-proj-wp-thumb rz-proj-wp-thumb--placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
        )}
        <div className="rz-proj-wp-body">
          <span className="rz-proj-wp-name">{sym} Whitepaper</span>
          <span className="rz-proj-wp-host mono">
            {(() => { try { return new URL(whitepaperUrl).hostname.replace(/^www\./, '') } catch { return whitepaperUrl } })()}
          </span>
        </div>
        <span className="rz-proj-wp-arrow">{ARROW_OUT}</span>
      </a>
    </SectionShell>
  )
})

const TeamSection = React.memo(({ team }) => {
  const { t } = useTranslation()
  if (!Array.isArray(team) || !team.length) return null
  return (
    <SectionShell
      id="proj-team"
      label={t('researchPro.project.team.label', "PROJECT · TEAM")}
      title={t('researchPro.project.team.title', "Team")}
      subtitle={`${team.length} member${team.length === 1 ? '' : 's'}`}
      collapsible
    >
      <ul className="rz-proj-team">
        {team.map((m, i) => {
          const url = m.url || m.urls?.linkedin || m.urls?.github || null
          const initials = (m.name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
          return (
            <li key={`${m.name}-${i}`} className="rz-proj-team-row">
              <span className="rz-proj-team-idx mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="rz-proj-team-avatar">{initials}</span>
              <div className="rz-proj-team-main">
                <span className="rz-proj-team-name">{m.name}</span>
                {m.position && <span className="rz-proj-team-role">{m.position}</span>}
              </div>
              <div className="rz-proj-team-links">
                {m.urls?.linkedin && (
                  <a href={m.urls.linkedin} target="_blank" rel="noopener noreferrer" className="rz-proj-team-link" aria-label={`${m.name} on LinkedIn`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.34 17.34H5.67V9.67h2.67v7.67zM7 8.5a1.55 1.55 0 1 1 0-3.1 1.55 1.55 0 0 1 0 3.1zm11.34 8.84h-2.67v-3.73c0-.89-.02-2.04-1.24-2.04-1.24 0-1.43.97-1.43 1.97v3.8h-2.67V9.67h2.56v1.05h.04a2.81 2.81 0 0 1 2.53-1.39c2.7 0 3.2 1.78 3.2 4.09v3.92z"/></svg>
                  </a>
                )}
                {m.urls?.github && (
                  <a href={m.urls.github} target="_blank" rel="noopener noreferrer" className="rz-proj-team-link" aria-label={`${m.name} on GitHub`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 00-3.79 23.38c.6.11.82-.26.82-.58v-2.02c-3.33.72-4.04-1.61-4.04-1.61-.54-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.64 1.66.23 2.88.11 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .3"/></svg>
                  </a>
                )}
                {!m.urls?.linkedin && !m.urls?.github && url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="rz-proj-team-link">{ARROW_OUT}</a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </SectionShell>
  )
})

const RoadmapSection = React.memo(({ roadmap }) => {
  const { t } = useTranslation()
  if (!Array.isArray(roadmap) || !roadmap.length) return null
  return (
    <SectionShell
      id="proj-roadmap"
      label={t('researchPro.project.roadmap.label', "PROJECT · ROADMAP")}
      title={t('researchPro.project.roadmap.title', "Roadmap")}
      subtitle={`${roadmap.length} milestone${roadmap.length === 1 ? '' : 's'}`}
      collapsible
    >
      <ol className="rz-proj-roadmap">
        {roadmap.map((m, i) => (
          <li key={i} className="rz-proj-rm-item">
            <span className="rz-proj-rm-dot" aria-hidden="true" />
            <div className="rz-proj-rm-card">
              {m.date && <span className="rz-proj-rm-date mono">{m.date}</span>}
              <span className="rz-proj-rm-title">{m.title}</span>
              {m.description && <p className="rz-proj-rm-desc">{m.description}</p>}
            </div>
          </li>
        ))}
      </ol>
    </SectionShell>
  )
})

const PartnersSection = React.memo(({ partners }) => {
  const { t } = useTranslation()
  if (!Array.isArray(partners) || !partners.length) return null
  return (
    <SectionShell
      id="proj-partners"
      label={t('researchPro.project.partners.label', "PROJECT · PARTNERS")}
      title={t('researchPro.project.partners.title', "Partners & Backers")}
      subtitle={`${partners.length} relationship${partners.length === 1 ? '' : 's'}`}
      collapsible
    >
      <div className="rz-proj-partners">
        {partners.map((p, i) => (
          <div key={`${p.name}-${i}`} className="rz-proj-partner">
            {p.logoUrl ? (
              <img className="rz-proj-partner-logo" src={p.logoUrl} alt={p.name} loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
            ) : (
              <div className="rz-proj-partner-logo rz-proj-partner-logo--placeholder">
                {(p.name || '?').slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="rz-proj-partner-name">{p.name}</span>
          </div>
        ))}
      </div>
    </SectionShell>
  )
})

const TimelineSection = React.memo(({ timeline }) => {
  const { t } = useTranslation()
  if (!Array.isArray(timeline) || !timeline.length) return null
  return (
    <SectionShell
      id="proj-timeline"
      label={t('researchPro.project.timeline.label', "PROJECT · TIMELINE")}
      title={t('researchPro.project.timeline.title', "Project Timeline")}
      subtitle={t('researchPro.project.timeline.subtitle', "Key dates synthesized from on-chain + GitHub + website")}
      collapsible
    >
      <ol className="rz-proj-timeline">
        {timeline.map((t, i) => (
          <li key={i} className="rz-proj-tl-item">
            <span className="rz-proj-tl-dot" />
            <span className="rz-proj-tl-date mono">{t.date}</span>
            <span className="rz-proj-tl-event">{t.event}</span>
            <span className="rz-proj-tl-source">{t.source}</span>
          </li>
        ))}
      </ol>
    </SectionShell>
  )
})

const DocsTocSection = React.memo(({ docsToc }) => {
  const { t } = useTranslation()
  if (!Array.isArray(docsToc) || !docsToc.length) return null
  return (
    <SectionShell
      id="proj-docs"
      label={t('researchPro.project.docstoc.label', "PROJECT · DOCS")}
      title={t('researchPro.project.docstoc.title', "Documentation")}
      subtitle={`${docsToc.length} chapter${docsToc.length === 1 ? '' : 's'}`}
      collapsible
    >
      <ul className="rz-proj-docs">
        {docsToc.map((d, i) => (
          <li key={i} className="rz-proj-doc">
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="rz-proj-doc-link">
              <span className="rz-proj-doc-num mono">{String(i + 1).padStart(2, '0')}</span>
              <div className="rz-proj-doc-body">
                <span className="rz-proj-doc-title">{d.title}</span>
                {d.description && <span className="rz-proj-doc-desc">{d.description}</span>}
              </div>
              <span className="rz-proj-doc-arrow">{ARROW_OUT}</span>
            </a>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})

const FaqSection = React.memo(({ faq }) => {
  const { t } = useTranslation()
  const [openIdx, setOpenIdx] = useState(0)
  if (!Array.isArray(faq) || !faq.length) return null
  return (
    <SectionShell
      id="proj-faq"
      label={t('researchPro.project.faq.label', "PROJECT · FAQ")}
      title={t('researchPro.project.faq.title', "FAQ")}
      subtitle={`${faq.length} question${faq.length === 1 ? '' : 's'}`}
      collapsible
    >
      <ul className="rz-proj-faq">
        {faq.map((q, i) => {
          const isOpen = openIdx === i
          return (
            <li key={i} className={`rz-proj-faq-item${isOpen ? ' rz-proj-faq-item--open' : ''}`}>
              <button
                type="button"
                className="rz-proj-faq-q"
                onClick={() => setOpenIdx(isOpen ? -1 : i)}
              >
                <span>{q.question}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`rz-proj-faq-chev${isOpen ? ' flipped' : ''}`}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              {isOpen && <p className="rz-proj-faq-a">{q.answer}</p>}
            </li>
          )
        })}
      </ul>
    </SectionShell>
  )
})

const KeyTakeawaysSection = React.memo(({ keyTakeaways }) => {
  const { t } = useTranslation()
  if (!Array.isArray(keyTakeaways) || !keyTakeaways.length) return null
  return (
    <SectionShell
      id="proj-takeaways"
      label={t('researchPro.project.keytakeaways.label', "PROJECT · KEY TAKEAWAYS")}
      title={t('researchPro.project.keytakeaways.title', "Key Takeaways")}
      subtitle={t('researchPro.project.keytakeaways.subtitle', "Quick summary")}
      collapsible
    >
      <ul className="rz-proj-takeaways">
        {keyTakeaways.map((kt, i) => (
          <li key={i} className="rz-proj-takeaway">
            <span className="rz-proj-takeaway-num mono">{String(i + 1).padStart(2, '0')}</span>
            <div className="rz-proj-takeaway-body">
              <span className="rz-proj-takeaway-title">{kt.name}</span>
              {kt.description && <p className="rz-proj-takeaway-desc">{kt.description}</p>}
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})

const TagsSection = React.memo(({ tags }) => {
  const { t } = useTranslation()
  if (!Array.isArray(tags) || !tags.length) return null
  return (
    <SectionShell
      id="proj-tags"
      label={t('researchPro.project.tags.label', "PROJECT · TAGS")}
      title={t('researchPro.project.tags.title', "Categories")}
      subtitle={`${tags.length} tag${tags.length === 1 ? '' : 's'}`}
      collapsible
    >
      <div className="rz-proj-tags">
        {tags.map((t, i) => <span key={i} className="rz-proj-tag">{t}</span>)}
      </div>
    </SectionShell>
  )
})


/* ── Spectre-API-driven sections (god profile, fundraising, unlocks, signals) ─ */

function fmtUsdShort(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}

function fmtTokensShort(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}

function fmtRelDate(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return iso
  const days = Math.round((ms - Date.now()) / 86400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 0 && days < 30) return `In ${days}d`
  if (days > 0) return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const SpectreScoreSection = React.memo(({ score }) => {
  const { t } = useTranslation()
  if (!score || (!score.overall && !score.fundamentals && !score.technical && !score.social)) return null
  const dims = [
    { k: 'fundamentals', label: 'Fundamentals' },
    { k: 'technical', label: 'Technical' },
    { k: 'social', label: 'Social' },
    { k: 'risk', label: 'Risk' },
    { k: 'momentum', label: 'Momentum' },
  ].filter((d) => Number(score[d.k]) > 0)
  const overall = Number(score.overall) || 0
  const overallTone = overall >= 60 ? 'up' : overall >= 40 ? 'mid' : 'down'

  return (
    <SectionShell
      id="proj-score"
      label={t('researchPro.project.spectrescore.label', "PROJECT · SPECTRE SCORE")}
      title={t('researchPro.project.spectrescore.title', "Spectre Score")}
      subtitle={t('researchPro.project.spectrescore.subtitle', "Composite intelligence score (0-100)")}
      collapsible
    >
      <div className="rz-proj-score">
        <div className={`rz-proj-score-overall rz-proj-score-overall--${overallTone}`}>
          <span className="rz-proj-score-overall-val mono">{overall.toFixed(1)}</span>
          <span className="rz-proj-score-overall-label">{t('researchPro.project.spectrescore.overall', "Overall")}</span>
        </div>
        {dims.length > 0 && (
          <div className="rz-proj-score-dims">
            {dims.map((d) => {
              const v = Number(score[d.k]) || 0
              const w = Math.max(0, Math.min(100, v))
              return (
                <div key={d.k} className="rz-proj-score-dim">
                  <div className="rz-proj-score-dim-head">
                    <span className="rz-proj-score-dim-label">{d.label}</span>
                    <span className="rz-proj-score-dim-val mono">{v.toFixed(1)}</span>
                  </div>
                  <div className="rz-proj-score-dim-bar"><span className="rz-proj-score-dim-fill" style={{ width: `${w}%` }} /></div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SectionShell>
  )
})

const ActiveSignalsSection = React.memo(({ signals }) => {
  const { t } = useTranslation()
  const list = Array.isArray(signals?.active) ? signals.active : []
  if (!list.length) return null
  return (
    <SectionShell
      id="proj-signals"
      label={t('researchPro.project.activesignals.label', "PROJECT · ACTIVE SIGNALS")}
      title={t('researchPro.project.activesignals.title', "Active Intelligence Signals")}
      subtitle={`${list.length} active · ${signals.bullish || 0} bull / ${signals.bearish || 0} bear`}
      liveBadge
      collapsible
    >
      <ul className="rz-proj-signals">
        {list.slice(0, 10).map((s) => (
          <li key={s.id} className={`rz-proj-signal rz-proj-signal--${s.direction || 'neutral'}`}>
            <div className="rz-proj-signal-row">
              <span className={`rz-proj-signal-dir rz-proj-signal-dir--${s.direction || 'neutral'}`}>
                {s.direction === 'bullish' ? '▲' : s.direction === 'bearish' ? '▼' : '●'}
              </span>
              <span className="rz-proj-signal-title">{s.title}</span>
              <span className="rz-proj-signal-score mono">{Math.round(s.score || 0)}</span>
            </div>
            {s.description && <p className="rz-proj-signal-desc">{s.description}</p>}
            <div className="rz-proj-signal-meta">
              <span className="rz-proj-signal-type">{(s.type || '').replace(/_/g, ' ')}</span>
              {s.conviction && <span className={`rz-proj-signal-conv rz-proj-signal-conv--${s.conviction}`}>{s.conviction} conviction</span>}
              <span className="rz-proj-signal-time mono">{fmtRelDate(s.createdAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})

const FundingRoundsSection = React.memo(({ rounds }) => {
  const { t } = useTranslation()
  // Strip upstream data-source marker rows (defillama_listing, messari_listing,
  // etc.) — they have no amount, no investors, and leak the source name as a
  // round type. Belt-and-suspenders with the useSpectreAssetData hook filter.
  const cleaned = Array.isArray(rounds) ? rounds.filter((r) => {
    const rt = String(r?.round_type || '').toLowerCase()
    if (/_listing$|^listing$/.test(rt)) return false
    if (/defillama|messari|coingecko|coinmarketcap|cmc|nansen|arkham/i.test(rt)) return false
    const hasAmount = Number(r?.amount_raised_usd) > 0
    const hasInvestors = (Array.isArray(r?.all_investors) && r.all_investors.length)
      || (Array.isArray(r?.lead_investors) && r.lead_investors.length)
    return hasAmount || hasInvestors
  }) : []
  if (!cleaned.length) return null
  const totalRaised = cleaned.reduce((s, r) => s + (Number(r.amount_raised_usd) || 0), 0)
  return (
    <SectionShell
      id="proj-funding"
      label={t('researchPro.project.fundingrounds.label', "PROJECT · FUNDING")}
      title={t('researchPro.project.fundingrounds.title', "Fundraising Rounds")}
      subtitle={`${cleaned.length} round${cleaned.length === 1 ? '' : 's'}${totalRaised > 0 ? ` · ${fmtUsdShort(totalRaised)} raised` : ''}`}
      collapsible
    >
      <ul className="rz-proj-funding">
        {cleaned.map((r) => {
          const investors = Array.isArray(r.all_investors) ? r.all_investors : (Array.isArray(r.lead_investors) ? r.lead_investors : [])
          const lead = (r.lead_investors && r.lead_investors[0]) || investors[0] || null
          return (
            <li key={r.id} className="rz-proj-funding-row">
              <div className="rz-proj-funding-head">
                <span className="rz-proj-funding-stage">{r.round_type || 'Round'}</span>
                <span className="rz-proj-funding-amount mono">{fmtUsdShort(r.amount_raised_usd)}</span>
                {r.valuation_usd && <span className="rz-proj-funding-val mono">@ {fmtUsdShort(r.valuation_usd)} val</span>}
                <span className="rz-proj-funding-date mono">{r.date ? new Date(r.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}</span>
              </div>
              {investors.length > 0 && (
                <div className="rz-proj-funding-investors">
                  {investors.slice(0, 8).map((inv, i) => (
                    <span key={i} className={`rz-proj-funding-investor${inv === lead ? ' rz-proj-funding-investor--lead' : ''}`}>
                      {inv}{inv === lead ? ' (lead)' : ''}
                    </span>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </SectionShell>
  )
})

const UnlocksSection = React.memo(({ unlocks }) => {
  const { t } = useTranslation()
  const list = Array.isArray(unlocks?.unlocks) ? unlocks.unlocks : (Array.isArray(unlocks) ? unlocks : [])
  if (!list.length) return null
  // Show the WHOLE remaining schedule. This used to slice to 6, which silently
  // dropped events off the end of any longer vesting plan — ENA has 7 upcoming
  // and rendered 6, with nothing on screen saying one was missing.
  const upcoming = list.filter((u) => !u.isCompleted)
  if (!upcoming.length) return null
  return (
    <SectionShell
      id="proj-unlocks"
      label={t('researchPro.project.unlocks.label', "PROJECT · TOKEN UNLOCKS")}
      title={t('researchPro.project.unlocks.title', "Token Unlocks")}
      subtitle={`${upcoming.length} upcoming unlock${upcoming.length === 1 ? '' : 's'}`}
      collapsible
    >
      <ul className="rz-proj-unlocks">
        {upcoming.map((u, i) => (
          <li key={i} className="rz-proj-unlock-row">
            <div className="rz-proj-unlock-head">
              <span className="rz-proj-unlock-date mono">{fmtRelDate(u.unlockDate)}</span>
              <span className="rz-proj-unlock-amount mono">{fmtTokensShort(u.amountTokens)} tokens</span>
              {u.amountUsd && <span className="rz-proj-unlock-usd mono">{fmtUsdShort(u.amountUsd)}</span>}
              <span className="rz-proj-unlock-pct mono">{Number(u.pctOfSupply || 0).toFixed(2)}% supply</span>
            </div>
            <div className="rz-proj-unlock-meta">
              {u.category && <span className="rz-proj-unlock-cat">{u.category}</span>}
              {u.beneficiary && <span className="rz-proj-unlock-bene">→ {u.beneficiary}</span>}
              {u.type && <span className="rz-proj-unlock-type">{u.type}</span>}
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})


/* ── Visual / dashboard sections (gauges, bars, feeds) ──────────────────── */

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

const IdentityHeroCard = React.memo(({ sym, td, fmtPrice, tokenColor, dossier, score, risk }) => {
  const initials = (td?.name || sym || '?').slice(0, 2).toUpperCase()
  const hasLogo = !!td?.logo
  const tokenRgb = tokenColor?.bg || '139, 92, 246'
  const change24h = td?.change24h
  const direction = change24h == null ? null : change24h > 0 ? 'up' : change24h < 0 ? 'down' : null
  const tagline = dossier?.tagline || dossier?.organization?.description || null
  const founded = dossier?.organization?.foundingDate || null

  // Quick badges row
  const badges = [
    Number(score?.overall) > 0 && { kind: 'score', label: 'Score', value: Number(score.overall).toFixed(0) },
    risk?.score != null && { kind: 'risk', label: risk.band?.toUpperCase() || 'RISK', value: risk.score, tone: risk.band === 'safe' ? 'up' : risk.band === 'moderate' ? 'mid' : 'down' },
    Array.isArray(dossier?.tags) && dossier.tags.length > 0 && { kind: 'tag', label: dossier.tags[0] },
    founded && { kind: 'founded', label: 'Founded', value: founded.slice(0, 7) },
  ].filter(Boolean)

  return (
    <header className="rz-proj-id" style={{ '--rz-proj-token-rgb': tokenRgb }}>
      <div className="rz-proj-id-glow" aria-hidden="true" />
      <div className="rz-proj-id-main">
        <div className="rz-proj-id-mark">
          {hasLogo ? (
            <img src={td.logo} alt="" loading="lazy" decoding="async" width="56" height="56" className="rz-proj-id-mark-img" onError={(e) => { e.target.style.display = 'none' }} />
          ) : (
            <span className="rz-proj-id-mark-fallback">{initials}</span>
          )}
        </div>
        <div className="rz-proj-id-text">
          <h1 className="rz-proj-id-title">{td?.name || sym}<span className="rz-proj-id-sym">{sym}</span></h1>
          {tagline && <p className="rz-proj-id-tagline">{tagline.slice(0, 200)}{tagline.length > 200 ? '…' : ''}</p>}
          {badges.length > 0 && (
            <div className="rz-proj-id-badges">
              {badges.map((b, i) => (
                <span key={i} className={`rz-proj-id-badge${b.tone ? ` rz-proj-id-badge--${b.tone}` : ''}`}>
                  <span className="rz-proj-id-badge-label">{b.label}</span>
                  {b.value != null && <span className="rz-proj-id-badge-val mono">{b.value}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rz-proj-id-price">
          <span className="rz-proj-id-price-val mono">{td?.price != null ? fmtPrice(td.price) : '—'}</span>
          {direction && (
            <span className={`rz-proj-id-price-chg rz-proj-id-price-chg--${direction} mono`}>
              {direction === 'up' ? '▲' : '▼'} {fmtPct(change24h)}
            </span>
          )}
        </div>
      </div>
    </header>
  )
})

const HeroStripSection = React.memo(({ td, onChainData, dossier, score }) => {
  const NATIVE_L1 = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ATOM', 'NEAR', 'XLM', 'XMR', 'TON', 'APT', 'SUI', 'HBAR', 'ICP', 'FIL', 'KAS', 'ALGO', 'EGLD', 'XTZ'])
  const isNativeAsset = NATIVE_L1.has(String(td?.symbol || dossier?.symbol || '').toUpperCase())
  const stats = [
    td?.marketCap && { label: 'Market Cap', value: fmtUsd(td.marketCap) },
    td?.fdv && { label: 'FDV', value: fmtUsd(td.fdv) },
    td?.volume && { label: '24h Vol', value: fmtUsd(td.volume) },
    Number.isFinite(td?.volMcapPct) && { label: 'Vol/MCap', value: `${td.volMcapPct.toFixed(2)}%`, tone: td.volMcapPct > 10 ? 'hot' : null },
    !isNativeAsset && Number.isFinite(Number(onChainData?.holders)) && { label: 'Holders', value: fmtCompact(onChainData.holders) },
    !isNativeAsset && fmtAge(onChainData?.age) && { label: 'Age', value: fmtAge(onChainData.age) },
    Number.isFinite(td?.athChangePct) && { label: 'From ATH', value: `${td.athChangePct > 0 ? '+' : ''}${td.athChangePct.toFixed(0)}%`, tone: td.athChangePct < -50 ? 'down' : null },
    Number(score?.overall) > 0 && { label: 'Score', value: Number(score.overall).toFixed(0), tone: score.overall >= 60 ? 'up' : score.overall < 40 ? 'down' : null },
    Array.isArray(dossier?.deployments) && dossier.deployments.length > 1 && { label: 'Chains', value: String(dossier.deployments.length) },
    Array.isArray(dossier?.tags) && dossier.tags.length && { label: 'Tags', value: String(dossier.tags.length) },
  ].filter(Boolean).slice(0, 8)
  if (!stats.length) return null
  return (
    <div className="rz-proj-hero-strip">
      {stats.map((s) => (
        <div key={s.label} className={`rz-proj-hs-cell${s.tone ? ` rz-proj-hs-cell--${s.tone}` : ''}`}>
          <span className="rz-proj-hs-label">{s.label}</span>
          <span className="rz-proj-hs-val mono">{s.value}</span>
        </div>
      ))}
    </div>
  )
})

const HealthCardSection = React.memo(({ td, dossier, score, onChainData }) => {
  const { t } = useTranslation()
  // 4 mini-gauges: Liquidity, Holders, Audits/Trust, Dev Activity
  const liqTier = (() => {
    const liq = Number(td?.liquidity || td?.liquiditydata?.liquidity)
    if (!Number.isFinite(liq) || liq <= 0) return null
    if (liq >= 5e6) return 95
    if (liq >= 1e6) return 80
    if (liq >= 250e3) return 60
    if (liq >= 50e3) return 40
    return 20
  })()
  const holdersTier = (() => {
    const n = Number(onChainData?.holders)
    if (!Number.isFinite(n) || n <= 0) return null
    if (n >= 100_000) return 95
    if (n >= 10_000) return 75
    if (n >= 1_000) return 55
    return 30
  })()
  const auditsTier = (() => {
    const audits = Array.isArray(dossier?.audits) ? dossier.audits.length : 0
    if (audits >= 3) return 90
    if (audits >= 1) return 65
    return 25
  })()
  const devTier = (() => {
    const gh = dossier?.github
    if (!gh) return null
    const stars = Number(gh.stars || 0)
    const recent = gh.lastCommit ? (Date.now() - gh.lastCommit) / 86400_000 : 9999
    let s = 0
    if (stars >= 1000) s += 40; else if (stars >= 100) s += 25; else if (stars >= 10) s += 15
    if (recent < 30) s += 50; else if (recent < 90) s += 30; else if (recent < 365) s += 15
    return clamp(s, 0, 100)
  })()
  const cards = [
    { key: 'liq',     label: 'Liquidity',     value: liqTier },
    { key: 'holders', label: 'Holders',       value: holdersTier },
    { key: 'audits',  label: 'Audits',        value: auditsTier },
    { key: 'dev',     label: 'Dev Activity',  value: devTier },
  ].filter((c) => c.value != null)
  // Hide entirely if we only have 1 metric — a lonely gauge in a wide card looks broken.
  if (cards.length < 2) return null
  return (
    <SectionShell id="proj-health" label={t('researchPro.project.healthcard.label', "PROJECT · HEALTH")} title={t('researchPro.project.healthcard.title', "Project Health")} subtitle={t('researchPro.project.healthcard.subtitle', "Composite health signals")} collapsible>
      <div className="rz-proj-health">
        {cards.map((c) => {
          const tone = c.value >= 70 ? 'up' : c.value >= 45 ? 'mid' : 'down'
          const r = 28
          const C = 2 * Math.PI * r
          const fill = (c.value / 100) * C
          return (
            <div key={c.key} className={`rz-proj-health-card rz-proj-health-card--${tone}`}>
              <svg className="rz-proj-health-ring" viewBox="0 0 70 70" width="70" height="70">
                <circle cx="35" cy="35" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5"/>
                <circle cx="35" cy="35" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={`${fill} ${C - fill}`} strokeDashoffset={C / 4} transform="rotate(-90 35 35)"
                  className="rz-proj-health-ring-fill"/>
                <text x="35" y="40" textAnchor="middle" className="rz-proj-health-ring-num">{Math.round(c.value)}</text>
              </svg>
              <span className="rz-proj-health-label">{c.label}</span>
            </div>
          )
        })}
      </div>
    </SectionShell>
  )
})

const SentimentGaugeSection = React.memo(({ sentiment }) => {
  const { t } = useTranslation()
  if (!sentiment || sentiment.score == null) return null
  const score = clamp(Number(sentiment.score), 0, 100)
  const label = sentiment.label || (score >= 70 ? 'Greedy' : score >= 50 ? 'Neutral' : score >= 30 ? 'Cautious' : 'Fearful')
  const fundingPct = Number(sentiment?.derivatives?.weighted_funding_rate || 0) * 100
  const lsr = Number(sentiment?.longShortRatio?.long_short_ratio || 0)
  // Gauge geometry — half circle 180deg, value 0..100 -> 180deg..0deg (left to right)
  const angle = (score / 100) * 180 - 90 // -90..+90
  const needleX = 50 + 36 * Math.cos((angle - 90) * Math.PI / 180)
  const needleY = 50 + 36 * Math.sin((angle - 90) * Math.PI / 180)
  return (
    <SectionShell id="proj-sentiment-gauge" label={t('researchPro.project.sentimentgauge.label', "PROJECT · SENTIMENT")} title={t('researchPro.project.sentimentgauge.title', "Market Sentiment")} subtitle={t('researchPro.project.sentimentgauge.subtitle', "Composite of derivatives, funding, and L/S positioning")} collapsible>
      <div className="rz-proj-gauge-wrap">
        <svg viewBox="0 0 100 60" className="rz-proj-gauge" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="rz-gauge-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#EF4444"/>
              <stop offset="50%"  stopColor="#F59E0B"/>
              <stop offset="100%" stopColor="#10B981"/>
            </linearGradient>
          </defs>
          <path d="M 14 50 A 36 36 0 0 1 86 50" fill="none" stroke="url(#rz-gauge-grad)" strokeWidth="6" strokeLinecap="round"/>
          <line x1="50" y1="50" x2={needleX} y2={needleY} stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="50" cy="50" r="3" fill="var(--text-primary)"/>
        </svg>
        <div className="rz-proj-gauge-center">
          <span className="rz-proj-gauge-val mono">{Math.round(score)}</span>
          <span className="rz-proj-gauge-label">{label}</span>
        </div>
      </div>
      <div className="rz-proj-gauge-meta">
        <div className="rz-proj-gauge-meta-item">
          <span className="rz-proj-gauge-meta-label">{t('researchPro.project.sentimentgauge.fundingRate', "Funding rate")}</span>
          <span className={`rz-proj-gauge-meta-val mono ${fundingPct < 0 ? 'rz-proj-chg--down' : fundingPct > 0 ? 'rz-proj-chg--up' : ''}`}>{fundingPct >= 0 ? '+' : ''}{fundingPct.toFixed(4)}%</span>
        </div>
        <div className="rz-proj-gauge-meta-item">
          <span className="rz-proj-gauge-meta-label">{t('researchPro.project.sentimentgauge.lSRatio', "L/S ratio")}</span>
          <span className="rz-proj-gauge-meta-val mono">{lsr.toFixed(3)}</span>
        </div>
        {sentiment?.derivatives?.deriv_sentiment && (
          <div className="rz-proj-gauge-meta-item">
            <span className="rz-proj-gauge-meta-label">{t('researchPro.project.sentimentgauge.derivs', "Derivs")}</span>
            <span className="rz-proj-gauge-meta-val">{sentiment.derivatives.deriv_sentiment}</span>
          </div>
        )}
      </div>
    </SectionShell>
  )
})

const LiquidationBattleSection = React.memo(({ sentiment }) => {
  const { t } = useTranslation()
  const longLiq = Number(sentiment?.longShortRatio?.long_liq_24h_usd || 0)
  const shortLiq = Number(sentiment?.longShortRatio?.short_liq_24h_usd || 0)
  const total = longLiq + shortLiq
  if (total <= 0) return null
  const longPct = (longLiq / total) * 100
  const shortPct = 100 - longPct
  const winner = longLiq > shortLiq ? 'longs' : 'shorts'
  return (
    <SectionShell id="proj-liq-battle" label={t('researchPro.project.liquidationbattle.label', "PROJECT · LIQUIDATIONS")} title={t('researchPro.project.liquidationbattle.title', "Liquidation Battle")} subtitle={`24h · ${winner === 'longs' ? 'longs hammered' : 'shorts squeezed'}`} collapsible>
      <div className="rz-proj-liq-bar">
        <div className="rz-proj-liq-side rz-proj-liq-side--shorts" style={{ width: `${shortPct}%` }}>
          <span className="rz-proj-liq-side-label">{t('researchPro.project.liquidationbattle.short', "SHORT")}</span>
          <span className="rz-proj-liq-side-val mono">{fmtUsd(shortLiq)}</span>
        </div>
        <div className="rz-proj-liq-side rz-proj-liq-side--longs" style={{ width: `${longPct}%` }}>
          <span className="rz-proj-liq-side-label">{t('researchPro.project.liquidationbattle.long', "LONG")}</span>
          <span className="rz-proj-liq-side-val mono">{fmtUsd(longLiq)}</span>
        </div>
      </div>
      <div className="rz-proj-liq-pcts">
        <span className="mono">{shortPct.toFixed(1)}%</span>
        <span className="mono">total {fmtUsd(total)}</span>
        <span className="mono">{longPct.toFixed(1)}%</span>
      </div>
    </SectionShell>
  )
})

const ExchangeOiSection = React.memo(({ derivatives }) => {
  const { t } = useTranslation()
  const summary = derivatives?.summary || {}
  const breakdown = summary.oi_exchange_breakdown
  if (!breakdown || typeof breakdown !== 'object') return null
  const entries = Object.entries(breakdown).map(([name, oi]) => ({ name, oi: Number(oi) || 0 })).filter((e) => e.oi > 0).sort((a, b) => b.oi - a.oi)
  if (!entries.length) return null
  const total = Number(summary.total_oi_usd || entries.reduce((s, e) => s + e.oi, 0))
  return (
    <SectionShell id="proj-oi-wall" label={t('researchPro.project.exchangeoi.label', "PROJECT · OPEN INTEREST")} title={t('researchPro.project.exchangeoi.title', "Exchange OI Distribution")} subtitle={`Total OI ${fmtUsd(total)}${summary.oi_change_24h_pct ? ` · ${Number(summary.oi_change_24h_pct) > 0 ? '+' : ''}${Number(summary.oi_change_24h_pct).toFixed(1)}% 24h` : ''}`} collapsible>
        <div className="rz-proj-oi-stack">
          {entries.slice(0, 12).map((e, i) => {
            const pct = (e.oi / total) * 100
            return (
              <span key={e.name} className="rz-proj-oi-seg" style={{ width: `${pct}%`, '--seg-i': i }} title={`${e.name} · ${fmtUsd(e.oi)} (${pct.toFixed(1)}%)`}>
                {pct >= 4 && <span className="rz-proj-oi-seg-name">{e.name}</span>}
              </span>
            )
          })}
        </div>
        <ul className="rz-proj-oi-list">
          {entries.slice(0, 8).map((e, i) => (
            <li key={e.name} className="rz-proj-oi-row">
              <span className="rz-proj-oi-dot" style={{ background: `hsl(${(i * 47) % 360}, 65%, 55%)` }} />
              <span className="rz-proj-oi-name">{e.name}</span>
              <span className="rz-proj-oi-val mono">{fmtUsd(e.oi)}</span>
              <span className="rz-proj-oi-pct mono">{((e.oi / total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
    </SectionShell>
  )
})

const MultiChainSection = React.memo(({ deployments }) => {
  const { t } = useTranslation()
  if (!Array.isArray(deployments) || !deployments.length) return null
  return (
    <SectionShell id="proj-chains" label={t('researchPro.project.multichain.label', "PROJECT · DEPLOYMENT")} title={t('researchPro.project.multichain.title', "Multi-chain Footprint")} subtitle={`Deployed on ${deployments.length} chain${deployments.length === 1 ? '' : 's'}`} collapsible>
      <div className="rz-proj-chains">
        {deployments.map((d, i) => (
          <div key={`${d.chain}-${i}`} className="rz-proj-chain">
            <span className="rz-proj-chain-name">{d.chain}</span>
            <code className="rz-proj-chain-addr mono">{d.address?.length > 12 ? `${d.address.slice(0,6)}…${d.address.slice(-4)}` : d.address}</code>
          </div>
        ))}
      </div>
    </SectionShell>
  )
})

const NarrativeClusterSection = React.memo(({ narratives }) => {
  const { t } = useTranslation()
  if (!Array.isArray(narratives) || !narratives.length) return null
  return (
    <SectionShell id="proj-narratives" label={t('researchPro.project.narrativecluster.label', "PROJECT · NARRATIVES")} title={t('researchPro.project.narrativecluster.title', "Narrative Membership")} subtitle={`Belongs to ${narratives.length} narrative${narratives.length === 1 ? '' : 's'}`} collapsible>
      <div className="rz-proj-narratives">
        {narratives.map((n) => {
          const change = Number(n.change24h || 0)
          const tone = change > 0 ? 'up' : change < 0 ? 'down' : ''
          const size = Math.max(0.85, Math.min(1.5, Math.log10(Math.max(1e6, Number(n.marketCap) || 1e6)) / 7))
          return (
            <div key={n.slug} className={`rz-proj-narrative ${tone ? `rz-proj-narrative--${tone}` : ''}`} style={{ fontSize: `${size}rem` }}>
              <span className="rz-proj-narrative-name">{n.name}</span>
              {Number(n.marketCap) > 0 && <span className="rz-proj-narrative-mcap mono">{fmtUsd(n.marketCap)}</span>}
              {change !== 0 && <span className="rz-proj-narrative-chg mono">{change > 0 ? '+' : ''}{change.toFixed(1)}%</span>}
            </div>
          )
        })}
      </div>
    </SectionShell>
  )
})

const HoldersDonutSection = React.memo(({ td }) => {
  const { t } = useTranslation()
  // Render donut from CG distribution if we have it; fallback to "no data".
  const top10 = Number(td?.holdersTop10Pct ?? td?.top10Pct)
  const top50 = Number(td?.holdersTop50Pct ?? td?.top50Pct)
  if (!Number.isFinite(top10) && !Number.isFinite(top50)) return null
  const a = Number.isFinite(top10) ? top10 : (top50 / 5)
  const b = Number.isFinite(top50) ? Math.max(0, top50 - top10) : 20
  const c = Math.max(0, 100 - (a + b))
  const segs = [
    { label: 'Top 10', pct: a, color: '#EF4444' },
    { label: 'Top 50', pct: b, color: '#F59E0B' },
    { label: 'Rest',   pct: c, color: '#10B981' },
  ].filter((s) => s.pct > 0)
  const r = 36, C = 2 * Math.PI * r
  let acc = 0
  return (
    <SectionShell id="proj-holders-donut" label={t('researchPro.project.holdersdonut.label', "PROJECT · CONCENTRATION")} title={t('researchPro.project.holdersdonut.title', "Holder Concentration")} subtitle={t('researchPro.project.holdersdonut.subtitle', "How tightly held are the tokens")} collapsible>
      <div className="rz-proj-donut-wrap">
        <svg viewBox="0 0 100 100" width="120" height="120">
          {segs.map((s, i) => {
            const len = (s.pct / 100) * C
            const off = -acc
            acc += len
            return <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={off + C / 4} transform="rotate(-90 50 50)"/>
          })}
        </svg>
        <ul className="rz-proj-donut-legend">
          {segs.map((s) => (
            <li key={s.label} className="rz-proj-donut-row">
              <span className="rz-proj-donut-dot" style={{ background: s.color }} />
              <span className="rz-proj-donut-label">{s.label}</span>
              <span className="rz-proj-donut-pct mono">{s.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  )
})

const WhaleWallSection = React.memo(({ whales }) => {
  const { t } = useTranslation()
  const tx = Array.isArray(whales?.transactions) ? whales.transactions : []
  if (!tx.length) return null
  const max = Math.max(...tx.map((t) => Number(t.valueUsd) || 0))
  return (
    <SectionShell id="proj-whales" label={t('researchPro.project.whalewall.label', "PROJECT · WHALE ACTIVITY")} title={t('researchPro.project.whalewall.title', "Whale Activity Wall")} subtitle={`${whales.count48h || tx.length} large transfers · 48h`} liveBadge collapsible>
      <ul className="rz-proj-whales">
        {tx.map((t, i) => {
          const val = Number(t.valueUsd) || 0
          const w = max > 0 ? (val / max) * 100 : 0
          const dir = (t.type || '').toLowerCase().includes('buy') ? 'buy' : 'sell'
          return (
            <li key={i} className={`rz-proj-whale rz-proj-whale--${dir}`}>
              <span className="rz-proj-whale-bar" style={{ width: `${w}%` }} />
              <span className="rz-proj-whale-info">
                <span className={`rz-proj-whale-dir rz-proj-whale-dir--${dir}`}>{dir === 'buy' ? '↗' : '↘'} {dir.toUpperCase()}</span>
                <span className="rz-proj-whale-val mono">{fmtUsd(val)}</span>
                {(t.from || t.to) && <span className="rz-proj-whale-route mono">{t.from || '?'} → {t.to || '?'}</span>}
                <span className="rz-proj-whale-time mono">{fmtRelDate(t.time)}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </SectionShell>
  )
})

const ActivityPulseSection = React.memo(({ signals, whales }) => {
  const { t } = useTranslation()
  const items = []
  if (Array.isArray(signals?.active)) {
    signals.active.slice(0, 5).forEach((s) => items.push({ kind: 'signal', time: s.createdAt, dir: s.direction, title: s.title, desc: s.description }))
  }
  if (Array.isArray(whales?.transactions)) {
    whales.transactions.slice(0, 5).forEach((w) => items.push({ kind: 'whale', time: w.time, dir: (w.type || '').toLowerCase().includes('buy') ? 'bullish' : 'bearish', title: `Whale ${w.type || 'tx'} ${fmtUsd(w.valueUsd)}`, desc: `${w.from || '?'} → ${w.to || '?'}` }))
  }
  if (!items.length) return null
  items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  return (
    <SectionShell id="proj-pulse" label={t('researchPro.project.activitypulse.label', "PROJECT · ACTIVITY")} title={t('researchPro.project.activitypulse.title', "Activity Pulse")} subtitle={t('researchPro.project.activitypulse.subtitle', "Combined live feed of signals + whales")} liveBadge collapsible>
      <ul className="rz-proj-pulse">
        {items.slice(0, 12).map((it, i) => (
          <li key={i} className={`rz-proj-pulse-item rz-proj-pulse-item--${it.dir || 'neutral'}`}>
            <span className="rz-proj-pulse-icon">
              {it.kind === 'whale' ? '🐋' : '⚡'}
            </span>
            <div className="rz-proj-pulse-body">
              <span className="rz-proj-pulse-title">{it.title}</span>
              {it.desc && <span className="rz-proj-pulse-desc">{it.desc}</span>}
            </div>
            <span className="rz-proj-pulse-time mono">{fmtRelDate(it.time)}</span>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})

const ListingsMapSection = React.memo(({ exchanges }) => {
  const { t } = useTranslation()
  if (!Array.isArray(exchanges) || !exchanges.length) return null
  const max = Math.max(...exchanges.map((e) => Number(e.vol24h) || 0))
  if (max <= 0) return null
  return (
    <SectionShell id="proj-listings" label={t('researchPro.project.listingsmap.label', "PROJECT · LISTINGS")} title={t('researchPro.project.listingsmap.title', "Exchange Listings")} subtitle={`${exchanges.length} venue${exchanges.length === 1 ? '' : 's'} · ranked by 24h volume`} collapsible>
      <ul className="rz-proj-listings">
        {exchanges.slice(0, 12).map((e, i) => {
          const w = (e.vol24h / max) * 100
          return (
            <li key={`${e.name}-${i}`} className="rz-proj-listing">
              <span className="rz-proj-listing-name">{e.name}</span>
              <div className="rz-proj-listing-bar-wrap">
                <span className="rz-proj-listing-bar" style={{ width: `${w}%` }} />
              </div>
              <span className="rz-proj-listing-vol mono">{fmtUsd(e.vol24h)}</span>
              {e.pairUrl && (
                <a href={e.pairUrl} target="_blank" rel="noopener noreferrer" className="rz-proj-listing-go">{ARROW_OUT}</a>
              )}
            </li>
          )
        })}
      </ul>
    </SectionShell>
  )
})

const WhatsDrivingSection = React.memo(({ signals, sentiment, td, whales }) => {
  const { t } = useTranslation()
  const bullets = []
  if (signals?.active?.length) {
    const top = signals.active[0]
    bullets.push({ tone: top.direction || 'neutral', text: top.title })
  }
  const fundingPct = Number(sentiment?.derivatives?.weighted_funding_rate || 0) * 100
  if (Math.abs(fundingPct) > 0.001) {
    bullets.push({ tone: fundingPct < 0 ? 'bearish' : 'bullish', text: `Funding ${fundingPct >= 0 ? '+' : ''}${fundingPct.toFixed(4)}% (${fundingPct < 0 ? 'shorts paying longs' : 'longs paying shorts'})` })
  }
  const lsr = Number(sentiment?.longShortRatio?.long_short_ratio || 0)
  if (lsr > 0) {
    const skew = lsr > 1 ? 'long-skewed' : 'short-skewed'
    bullets.push({ tone: lsr > 1.5 ? 'bullish' : lsr < 0.7 ? 'bearish' : 'neutral', text: `Positioning ${skew} (L/S ${lsr.toFixed(2)})` })
  }
  if (whales?.netFlow != null && Math.abs(whales.netFlow) > 0) {
    const dir = whales.netFlow > 0 ? 'accumulating' : 'distributing'
    bullets.push({ tone: whales.netFlow > 0 ? 'bullish' : 'bearish', text: `Whales ${dir} (${fmtUsd(Math.abs(whales.netFlow))} net 48h)` })
  }
  if (Number(td?.change24h)) {
    const tone = td.change24h > 0 ? 'bullish' : 'bearish'
    bullets.push({ tone, text: `Price ${td.change24h > 0 ? '+' : ''}${td.change24h.toFixed(2)}% in 24h on ${fmtUsd(td.volume)} vol` })
  }
  if (!bullets.length) return null
  return (
    <SectionShell id="proj-driving" label={t('researchPro.project.whatsdriving.label', "PROJECT · DRIVING PRICE")} title={t('researchPro.project.whatsdriving.title', "What's Driving Price")} subtitle={t('researchPro.project.whatsdriving.subtitle', "Auto-synthesized from signals + funding + flows")} collapsible>
      <ul className="rz-proj-driving">
        {bullets.slice(0, 5).map((b, i) => (
          <li key={i} className={`rz-proj-driving-item rz-proj-driving-item--${b.tone}`}>
            <span className="rz-proj-driving-dot" />
            <span className="rz-proj-driving-text">{b.text}</span>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})

const TrustBadgeSection = React.memo(({ dossier, spectreData }) => {
  const { t } = useTranslation()
  const used = dossier?.sourcesUsed || {}
  // Generic signal-category labels — never expose third-party provider names
  // (DefiLlama, Messari, CoinGecko, LunarCrush, etc.) in the UI. The user
  // sees what KIND of signal we have, not which vendor it comes from.
  const sources = [
    { key: 'Market Data',       present: !!(used.coinpaprika || used.coingecko) },
    { key: 'Token Registry',    present: !!used.coingecko },
    { key: 'TVL & Protocols',   present: !!used.defillama },
    { key: 'Project Research',  present: !!used.messari },
    { key: 'Code Activity',     present: !!used.github },
    { key: 'Documentation',     present: !!used.gitbook },
    { key: 'Community Chat',    present: !!used.discord },
    { key: 'Community Group',   present: !!used.telegram },
    { key: 'Community Forum',   present: !!used.reddit },
    { key: 'Governance',        present: !!used.snapshot },
    { key: 'Blockchain Explorer', present: !!used.explorer },
    { key: 'Safety Audit',      present: !!used.rugcheck },
    { key: 'Social Sentiment',  present: !!used.lunarcrush },
    { key: 'News Feed',         present: !!used.cryptopanic },
    { key: 'Incident DB',       present: !!used.hacks },
    { key: 'Holders Registry',  present: !!used.holderBreakdown },
    { key: 'Spectre Score',     present: !!spectreData?.profile?.spectreScore?.overall },
    { key: 'Sentiment Engine',  present: !!spectreData?.sentiment?.score },
    { key: 'Derivatives Feed',  present: !!spectreData?.derivatives?.summary },
    { key: 'Fundraising',       present: Array.isArray(spectreData?.fundraising) && spectreData.fundraising.length > 0 },
  ]
  const present = sources.filter((s) => s.present)
  if (present.length === 0) return null
  const totalSources = sources.length
  return (
    <SectionShell id="proj-trust" label={t('researchPro.project.trustbadge.label', "PROJECT · DATA SOURCES")} title={`Trust Score: ${present.length}/${totalSources}`} subtitle={t('researchPro.project.trustbadge.subtitle', "Sources actively returning data for this token")} collapsible>
      <div className="rz-proj-trust">
        {sources.map((s) => (
          <span key={s.key} className={`rz-proj-trust-chip${s.present ? ' rz-proj-trust-chip--on' : ''}`}>
            <span className="rz-proj-trust-chip-dot" />
            {s.key}
          </span>
        ))}
      </div>
    </SectionShell>
  )
})


/* ── Security & Governance sections ─────────────────────────────────────── */

const SecurityCardSection = React.memo(({ contractInfo, rugcheck, audits }) => {
  const { t } = useTranslation()
  // Compose a holistic Safety Score 0-100 from all available signals.
  const checks = []
  if (contractInfo) {
    if (contractInfo.verified === true) checks.push({ ok: true, label: 'Source code verified', detail: contractInfo.contractName || 'Verified on explorer' })
    else if (contractInfo.verified === false) checks.push({ ok: false, label: 'Unverified source code', detail: 'Owner can hide malicious logic' })
    if (contractInfo.proxy === true) checks.push({ ok: false, label: 'Proxy contract', detail: 'Logic can be upgraded by owner' })
    if (contractInfo.license) checks.push({ ok: true, label: `License ${contractInfo.license}`, detail: null })
  }
  if (rugcheck && rugcheck.score != null) {
    const tone = rugcheck.score >= 70 ? 'ok' : 'warn'
    checks.push({ ok: tone === 'ok', label: `Rugcheck score ${rugcheck.score}`, detail: tone === 'ok' ? 'Passes basic safety checks' : 'Has elevated risk indicators' })
    ;(rugcheck.risks || []).forEach((r) => {
      if (r.level === 'danger' || r.level === 'warn') checks.push({ ok: false, label: r.name, detail: r.description })
    })
  }
  if (Array.isArray(audits) && audits.length) {
    checks.push({ ok: true, label: `${audits.length} audit${audits.length === 1 ? '' : 's'}`, detail: audits.map((a) => a.auditor).filter(Boolean).slice(0, 3).join(', ') })
  }
  if (!checks.length) return null

  const okCount = checks.filter((c) => c.ok).length
  const score = Math.round((okCount / checks.length) * 100)
  const tone = score >= 70 ? 'up' : score >= 45 ? 'mid' : 'down'

  return (
    <SectionShell id="proj-security" label={t('researchPro.project.securitycard.label', "PROJECT · SECURITY")} title={t('researchPro.project.securitycard.title', "Security Audit")} subtitle={`Composite safety score · ${okCount}/${checks.length} checks pass`} collapsible>
      <div className="rz-proj-sec">
        <div className={`rz-proj-sec-score rz-proj-sec-score--${tone}`}>
          <span className="rz-proj-sec-score-val mono">{score}</span>
          <span className="rz-proj-sec-score-label">{t('researchPro.project.securitycard.safety', "Safety")}</span>
        </div>
        <ul className="rz-proj-sec-checks">
          {checks.slice(0, 10).map((c, i) => (
            <li key={i} className={`rz-proj-sec-check rz-proj-sec-check--${c.ok ? 'ok' : 'warn'}`}>
              <span className="rz-proj-sec-check-mark">{c.ok ? '✓' : '!'}</span>
              <div className="rz-proj-sec-check-body">
                <span className="rz-proj-sec-check-label">{c.label}</span>
                {c.detail && <span className="rz-proj-sec-check-detail">{c.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {(contractInfo?.viewUrl || rugcheck?.url) && (
        <div className="rz-proj-sec-links">
          {contractInfo?.viewUrl && (
            <a href={contractInfo.viewUrl} target="_blank" rel="noopener noreferrer" className="rz-proj-sec-link">View on Explorer →</a>
          )}
          {rugcheck?.url && (
            <a href={rugcheck.url} target="_blank" rel="noopener noreferrer" className="rz-proj-sec-link">Full Rugcheck Report →</a>
          )}
        </div>
      )}
    </SectionShell>
  )
})

const GovernanceSection = React.memo(({ governance }) => {
  const { t } = useTranslation()
  if (!governance || !Array.isArray(governance.proposals)) return null
  const props = governance.proposals
  if (!props.length) return null
  return (
    <SectionShell
      id="proj-governance"
      label={t('researchPro.project.governance.label', "PROJECT · GOVERNANCE")}
      title={t('researchPro.project.governance.title', "DAO Governance")}
      subtitle={`${governance.spaceName} · ${governance.followers} followers · ${governance.proposalsCount} total proposals`}
      collapsible
    >
      <ul className="rz-proj-gov">
        {props.slice(0, 5).map((p) => {
          const total = Number(p.scoresTotal) || 0
          const top = (p.scores || []).reduce((acc, s, i) => (Number(s) > acc.s ? { i, s: Number(s) } : acc), { i: -1, s: -1 })
          const topChoice = top.i >= 0 ? p.choices[top.i] : null
          const topPct = total > 0 ? (top.s / total) * 100 : 0
          return (
            <li key={p.id} className={`rz-proj-gov-item rz-proj-gov-item--${p.state}`}>
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="rz-proj-gov-link">
                <div className="rz-proj-gov-head">
                  <span className={`rz-proj-gov-state rz-proj-gov-state--${p.state}`}>{p.state}</span>
                  <span className="rz-proj-gov-title">{p.title}</span>
                  <span className="rz-proj-gov-arrow">{ARROW_OUT}</span>
                </div>
                {topChoice && (
                  <div className="rz-proj-gov-vote">
                    <span className="rz-proj-gov-choice">{topChoice}</span>
                    <span className="rz-proj-gov-pct mono">{topPct.toFixed(0)}%</span>
                  </div>
                )}
              </a>
            </li>
          )
        })}
      </ul>
      <a href={governance.url} target="_blank" rel="noopener noreferrer" className="rz-proj-gov-all">View all on Snapshot →</a>
    </SectionShell>
  )
})

const ContractInfoSection = React.memo(({ contractInfo }) => {
  const { t } = useTranslation()
  if (!contractInfo) return null
  const items = [
    contractInfo.contractName && { label: 'Contract', value: contractInfo.contractName },
    contractInfo.compilerVersion && { label: 'Compiler', value: contractInfo.compilerVersion },
    contractInfo.license && { label: 'License', value: contractInfo.license },
    { label: 'Verified', value: contractInfo.verified ? 'Yes' : (contractInfo.verified === false ? 'No' : 'Unknown'), tone: contractInfo.verified ? 'ok' : (contractInfo.verified === false ? 'warn' : null) },
    contractInfo.proxy != null && { label: 'Proxy', value: contractInfo.proxy ? 'Yes' : 'No', tone: contractInfo.proxy ? 'warn' : 'ok' },
    typeof contractInfo.optimization === 'boolean' && { label: 'Optimized', value: contractInfo.optimization ? 'Yes' : 'No' },
  ].filter(Boolean)
  if (items.length === 0) return null
  return (
    <SectionShell id="proj-contract" label={t('researchPro.project.contractinfo.label', "PROJECT · CONTRACT")} title={t('researchPro.project.contractinfo.title', "Contract Info")} subtitle={t('researchPro.project.contractinfo.subtitle', "On-chain technical details")} collapsible>
      <ul className="rz-proj-contract">
        {items.map((it, i) => (
          <li key={i} className="rz-proj-contract-row">
            <span className="rz-proj-contract-label">{it.label}</span>
            <span className={`rz-proj-contract-val mono${it.tone ? ` rz-proj-contract-val--${it.tone}` : ''}`}>{it.value}</span>
          </li>
        ))}
      </ul>
      {contractInfo.viewUrl && (
        <a href={contractInfo.viewUrl} target="_blank" rel="noopener noreferrer" className="rz-proj-contract-link">Open on Block Explorer →</a>
      )}
    </SectionShell>
  )
})

const LunarMetricsSection = React.memo(({ lunar }) => {
  const { t } = useTranslation()
  if (!lunar) return null
  const items = [
    lunar.galaxyScore != null && { label: 'Galaxy Score', value: Math.round(lunar.galaxyScore), max: 100 },
    lunar.altRank != null && { label: 'AltRank', value: `#${lunar.altRank}` },
    lunar.socialVolume24h != null && { label: 'Interactions 24h', value: fmtCompact(lunar.socialVolume24h) },
    lunar.contributors24h != null && { label: 'Active contributors', value: fmtCompact(lunar.contributors24h) },
  ].filter(Boolean)
  if (!items.length) return null
  return (
    <SectionShell id="proj-lunar" label={t('researchPro.project.lunarmetrics.label', "PROJECT · SOCIAL")} title={t('researchPro.project.lunarmetrics.title', "LunarCrush Social Metrics")} subtitle={t('researchPro.project.lunarmetrics.subtitle', "Community engagement & social volume")} collapsible>
      <div className="rz-proj-lunar-grid">
        {items.map((it, i) => (
          <div key={i} className="rz-proj-lunar-cell">
            <span className="rz-proj-lunar-label">{it.label}</span>
            <span className="rz-proj-lunar-val mono">{it.value}{it.max ? ` / ${it.max}` : ''}</span>
          </div>
        ))}
      </div>
      {lunar.url && (
        <a href={lunar.url} target="_blank" rel="noopener noreferrer" className="rz-proj-lunar-link">Open on LunarCrush →</a>
      )}
    </SectionShell>
  )
})


/* ── Top-tier signal sections (Spectre Take, Risk, Opportunity, Holders, Hacks, News) ── */

const SpectreTakeSection = React.memo(({ take, takeAt }) => {
  const { t } = useTranslation()
  if (!take) return null
  const ageMin = takeAt ? Math.round((Date.now() - takeAt) / 60_000) : null
  // Detect bracketed verdict at the end if any (defensive — backend strips it).
  const verdictMatch = take.match(/\b(bullish|bearish|neutral|mixed)\b/i)
  const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'neutral'
  return (
    <SectionShell
      id="proj-take"
      label={t('researchPro.project.spectretake.label', "PROJECT · SPECTRE TAKE")}
      title={t('researchPro.project.spectretake.title', "Market Read")}
      subtitle={ageMin != null ? `AI-synthesized · ${ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`}` : 'AI-synthesized'}
      collapsible
    >
      <blockquote className={`rz-proj-take rz-proj-take--${verdict}`}>
        <p>{take}</p>
      </blockquote>
    </SectionShell>
  )
})

const RiskCompositeSection = React.memo(({ risk }) => {
  const { t } = useTranslation()
  if (!risk || risk.score == null) return null
  const tone = risk.band === 'safe' ? 'up' : risk.band === 'moderate' ? 'mid' : 'down'
  const r = 36, C = 2 * Math.PI * r
  const fill = (risk.score / 100) * C
  return (
    <SectionShell
      id="proj-risk"
      label={t('researchPro.project.riskcomposite.label', "PROJECT · RISK")}
      title={t('researchPro.project.riskcomposite.title', "Risk Composite")}
      subtitle={`${risk.band?.toUpperCase()} · ${risk.checks?.length || 0} signals weighed`}
      collapsible
    >
      <div className="rz-proj-risk">
        <div className={`rz-proj-risk-ring rz-proj-risk-ring--${tone}`}>
          <svg viewBox="0 0 80 80" width="80" height="80">
            <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6"/>
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${fill} ${C - fill}`} strokeDashoffset={C / 4}
              transform="rotate(-90 40 40)" className="rz-proj-risk-fill"/>
            <text x="40" y="46" textAnchor="middle" className="rz-proj-risk-num">{risk.score}</text>
          </svg>
          <span className="rz-proj-risk-label">{t('researchPro.project.riskcomposite.safety', "SAFETY")}</span>
        </div>
        <ul className="rz-proj-risk-checks">
          {(risk.checks || []).map((c, i) => (
            <li key={i} className={`rz-proj-risk-check rz-proj-risk-check--${c.ok ? 'ok' : 'warn'}`}>
              <span className="rz-proj-risk-check-mark">{c.ok ? '✓' : '!'}</span>
              <span className="rz-proj-risk-check-label">{c.label}</span>
              <span className="rz-proj-risk-check-w mono">{c.weight}pt</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  )
})

const OpportunityScoreSection = React.memo(({ opp }) => {
  const { t } = useTranslation()
  if (!opp || opp.score == null) return null
  const tone = opp.band === 'strong' ? 'up' : opp.band === 'moderate' ? 'mid' : 'down'
  const r = 36, C = 2 * Math.PI * r
  const fill = (opp.score / 100) * C
  return (
    <SectionShell
      id="proj-opp"
      label={t('researchPro.project.opportunityscore.label', "PROJECT · OPPORTUNITY")}
      title={t('researchPro.project.opportunityscore.title', "Opportunity Score")}
      subtitle={`${opp.band?.toUpperCase()} · ${opp.factors?.length || 0} bullish factors`}
      collapsible
    >
      <div className="rz-proj-risk">
        <div className={`rz-proj-risk-ring rz-proj-risk-ring--${tone}`}>
          <svg viewBox="0 0 80 80" width="80" height="80">
            <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6"/>
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${fill} ${C - fill}`} strokeDashoffset={C / 4}
              transform="rotate(-90 40 40)" className="rz-proj-risk-fill"/>
            <text x="40" y="46" textAnchor="middle" className="rz-proj-risk-num">{opp.score}</text>
          </svg>
          <span className="rz-proj-risk-label">{t('researchPro.project.opportunityscore.edge', "EDGE")}</span>
        </div>
        <ul className="rz-proj-risk-checks">
          {(opp.factors || []).map((f, i) => (
            <li key={i} className={`rz-proj-risk-check rz-proj-risk-check--${f.points >= f.weight * 0.7 ? 'ok' : 'warn'}`}>
              <span className="rz-proj-risk-check-mark">{f.points >= f.weight * 0.7 ? '↑' : '·'}</span>
              <span className="rz-proj-risk-check-label">{f.label}</span>
              <span className="rz-proj-risk-check-w mono">{f.points}/{f.weight}</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  )
})

const HolderBreakdownSection = React.memo(({ breakdown }) => {
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
  return (
    <SectionShell
      id="proj-holder-breakdown"
      label={t('researchPro.project.holderbreakdown.label', "PROJECT · HOLDER BREAKDOWN")}
      title={t('researchPro.project.holderbreakdown.title', "Top-100 Holder Categorization")}
      subtitle={`Top 10 hold ${(breakdown.top10Pct || 0).toFixed(1)}% · Top 50: ${(breakdown.top50Pct || 0).toFixed(1)}%`}
      collapsible
    >
      <div className="rz-proj-hbk-stack">
        {kinds.map((k) => (
          <span key={k.key} className="rz-proj-hbk-seg" style={{ width: `${k.pct}%`, background: k.color }} title={`${k.label} · ${k.pct.toFixed(2)}%`}>
            {k.pct >= 6 && <span className="rz-proj-hbk-seg-name">{k.label}</span>}
          </span>
        ))}
      </div>
      <ul className="rz-proj-hbk-legend">
        {kinds.map((k) => (
          <li key={k.key} className="rz-proj-hbk-row">
            <span className="rz-proj-hbk-dot" style={{ background: k.color }} />
            <span className="rz-proj-hbk-label">{k.label}</span>
            <span className="rz-proj-hbk-pct mono">{k.pct.toFixed(2)}%</span>
          </li>
        ))}
      </ul>
      {Array.isArray(breakdown.items) && breakdown.items.length > 0 && (
        <details className="rz-proj-hbk-details">
          <summary>Show top {breakdown.items.length} addresses</summary>
          <ul className="rz-proj-hbk-items">
            {breakdown.items.slice(0, 25).map((it, i) => (
              <li key={i} className="rz-proj-hbk-item">
                <span className="rz-proj-hbk-idx mono">{String(i + 1).padStart(2, '0')}</span>
                <code className="rz-proj-hbk-addr mono">{it.address ? `${it.address.slice(0, 6)}…${it.address.slice(-4)}` : '?'}</code>
                <span className="rz-proj-hbk-tag" data-kind={it.kind}>{it.label || it.kind}</span>
                <span className="rz-proj-hbk-item-pct mono">{Number(it.pct || 0).toFixed(2)}%</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </SectionShell>
  )
})

const HacksSection = React.memo(({ hacks }) => {
  const { t } = useTranslation()
  if (!Array.isArray(hacks) || !hacks.length) return null
  const totalLost = hacks.reduce((s, h) => s + (Number(h.amount) || 0), 0)
  return (
    <SectionShell
      id="proj-hacks"
      label={t('researchPro.project.hacks.label', "PROJECT · SECURITY HISTORY")}
      title={t('researchPro.project.hacks.title', "Past Hacks")}
      subtitle={`${hacks.length} incident${hacks.length === 1 ? '' : 's'} · ${fmtUsdShort(totalLost)} total lost`}
      collapsible
    >
      <ul className="rz-proj-hacks">
        {hacks.slice(0, 5).map((h, i) => (
          <li key={i} className="rz-proj-hack">
            <div className="rz-proj-hack-head">
              <span className="rz-proj-hack-amount mono">{fmtUsdShort(h.amount)}</span>
              <span className="rz-proj-hack-name">{h.name}</span>
              <span className="rz-proj-hack-date mono">{h.date ? new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
            </div>
            <div className="rz-proj-hack-meta">
              {h.classification && <span className="rz-proj-hack-tag">{h.classification}</span>}
              {h.technique && <span className="rz-proj-hack-tag">{h.technique}</span>}
              {h.bridgeHack && <span className="rz-proj-hack-tag rz-proj-hack-tag--warn">{t('researchPro.project.hacks.bridgeHack', "Bridge hack")}</span>}
              {Number(h.returnedFunds) > 0 && <span className="rz-proj-hack-returned mono">Returned: {fmtUsdShort(h.returnedFunds)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})

const NewsFeedSection = React.memo(({ news }) => {
  const { t } = useTranslation()
  if (!Array.isArray(news) || !news.length) return null
  return (
    <SectionShell
      id="proj-news"
      label={t('researchPro.project.newsfeed.label', "PROJECT · NEWS")}
      title={t('researchPro.project.newsfeed.title', "Latest News")}
      subtitle={`${news.length} article${news.length === 1 ? '' : 's'} · CryptoPanic + CryptoCompare`}
      liveBadge
      collapsible
    >
      <ul className="rz-proj-news">
        {news.map((n, i) => (
          <li key={i} className={`rz-proj-news-item rz-proj-news-item--${n.sentiment || 'neutral'}`}>
            <a href={n.url} target="_blank" rel="noopener noreferrer" className="rz-proj-news-link">
              {n.imageUrl && <img src={n.imageUrl} alt="" className="rz-proj-news-thumb" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />}
              <div className="rz-proj-news-body">
                <span className="rz-proj-news-title">{n.title}</span>
                <div className="rz-proj-news-meta">
                  <span className="rz-proj-news-source">{n.source}</span>
                  <span className="rz-proj-news-time mono">{fmtRelDate(n.publishedAt)}</span>
                  {n.sentiment && n.sentiment !== 'neutral' && (
                    <span className={`rz-proj-news-sent rz-proj-news-sent--${n.sentiment}`}>{n.sentiment}</span>
                  )}
                </div>
              </div>
              <span className="rz-proj-news-arrow">{ARROW_OUT}</span>
            </a>
          </li>
        ))}
      </ul>
    </SectionShell>
  )
})


/* ── Main export ────────────────────────────────────────────────────────── */

export default function ProjectTab({
  sym,
  td,
  fmtPrice,
  tokenColor,
  coinDetails,
  spectreSocial,
  tokenProfile,
  onChainData,
  activeTokenInfo,
}) {
  const { data: dossier, loading: dossierLoading } = useDossierProject({
    symbol: sym,
    address: activeTokenInfo?.address,
    networkId: activeTokenInfo?.networkId,
    cgId: activeTokenInfo?.cgId || activeTokenInfo?.coingeckoId,
    githubUrl: activeTokenInfo?.githubUrl,
  })
  const { data: spectreData } = useSpectreAssetData(sym)

  // Apple Cinematic v3 — full-bleed editorial layout. Legacy bento sections
  // below are kept for now but no longer rendered (use ProjectCinema instead).
  // `loading` flag is forwarded so the cinema layer can render a shimmer
  // skeleton for the initial fetch (≈1-3s on cold cache). Polling refreshes
  // do NOT trigger the skeleton — the flag is only true while dossier is
  // null AND loading is in progress.
  return (
    <ProjectCinema
      sym={sym}
      td={td}
      fmtPrice={fmtPrice}
      tokenColor={tokenColor}
      dossier={dossier}
      loading={dossierLoading && !dossier}
      spectreData={spectreData}
      coinDetails={coinDetails}
      spectreSocial={spectreSocial}
      onChainData={onChainData}
      activeTokenInfo={activeTokenInfo}
    />
  )
}

// ── Legacy v2 layout below — preserved for reference, no longer rendered ──
// eslint-disable-next-line no-unused-vars
function _LegacyProjectTab({ sym, td, fmtPrice, tokenColor, coinDetails, spectreSocial, tokenProfile, onChainData, activeTokenInfo, dossier, spectreData }) {
  const score = spectreData?.profile?.spectreScore
  const signals = spectreData?.profile?.signals
  const whales = spectreData?.profile?.whales
  const narratives = spectreData?.profile?.narratives
  const sentiment = spectreData?.sentiment
  const derivatives = spectreData?.derivatives

  // Helper: is the section's data rich enough to be worth rendering?
  const hasIntelData = !!(dossier?.spectreTake || score?.overall || dossier?.riskComposite || dossier?.opportunityScore)

  return (
    <div className="rz-proj-container">
      {/* ── 1. IDENTITY HERO ── */}
      <IdentityHeroCard
        sym={sym}
        td={td}
        fmtPrice={fmtPrice}
        tokenColor={tokenColor}
        dossier={dossier}
        score={score}
        risk={dossier?.riskComposite}
      />

      {/* ── 2. SPECTRE TAKE (full-width banner) ── */}
      <SpectreTakeSection take={dossier?.spectreTake} takeAt={dossier?.spectreTakeAt} />

      {/* ── 3. AT-A-GLANCE STATS STRIP ── */}
      <HeroStripSection td={td} onChainData={onChainData} dossier={dossier} score={score} />

      {/* ── 4. INTEL TRIO (3 score panels) ── */}
      {hasIntelData && (
        <div className="rz-proj-grid rz-proj-grid--3">
          <SpectreScoreSection score={score} />
          <RiskCompositeSection risk={dossier?.riskComposite} />
          <OpportunityScoreSection opp={dossier?.opportunityScore} />
        </div>
      )}

      {/* ── 5. WHAT'S DRIVING (full-width synth) ── */}
      <WhatsDrivingSection signals={signals} sentiment={sentiment} td={td} whales={whales} />

      {/* ── 6. MARKET POSITIONING (sentiment + liquidations) ── */}
      <div className="rz-proj-grid rz-proj-grid--2">
        <SentimentGaugeSection sentiment={sentiment} />
        <LiquidationBattleSection sentiment={sentiment} />
      </div>

      {/* ── 7. ACTIVITY (full-width feeds) ── */}
      <ActivityPulseSection signals={signals} whales={whales} />
      <WhaleWallSection whales={whales} />

      {/* ── 8. DERIVATIVES + DISTRIBUTION ── */}
      <ExchangeOiSection derivatives={derivatives} />
      <div className="rz-proj-grid rz-proj-grid--2">
        <TokenomicsSection td={td} />
        <HoldersDonutSection td={td} />
      </div>
      <HolderBreakdownSection breakdown={dossier?.holderBreakdown} />

      {/* ── 9. SIGNALS + SECURITY ── */}
      <ActiveSignalsSection signals={signals} />
      <div className="rz-proj-grid rz-proj-grid--2">
        <SecurityCardSection contractInfo={dossier?.contractInfo} rugcheck={dossier?.rugcheck} audits={dossier?.audits} />
        <HacksSection hacks={dossier?.hacks} />
      </div>
      <div className="rz-proj-grid rz-proj-grid--2">
        <ContractInfoSection contractInfo={dossier?.contractInfo} />
        <HealthCardSection td={td} dossier={dossier} score={score} onChainData={onChainData} />
      </div>

      {/* ── 10. NEWS + GOVERNANCE + LUNAR ── */}
      <NewsFeedSection news={dossier?.newsFeed} />
      <div className="rz-proj-grid rz-proj-grid--2">
        <GovernanceSection governance={dossier?.governance} />
        <LunarMetricsSection lunar={dossier?.lunar} />
      </div>

      {/* ── 11.0 LIVE DUMP ALERT (always-on, hides if no dump) ── */}
      <RzLiveDumpAlert ca={activeTokenInfo?.address || null} sym={sym} />

      {/* ── 11.1 LIVE TRADE TAPE (last 12 swaps from GeckoTerminal) ── */}
      <RzTradeTape
        chain={dossier?.chain || activeTokenInfo?.chain || activeTokenInfo?.networkLabel || td?.chain}
        pairAddress={dossier?.dexPairs?.[0]?.address || activeTokenInfo?.pairAddress}
        ca={activeTokenInfo?.address || null}
        sym={sym}
      />

      {/* ── 11.2 PROJECT SNAPSHOT (chain facts) + HOLDER DISTRIBUTION ── */}
      <RzProjectSnapshot
        dossier={dossier}
        activeTokenInfo={activeTokenInfo}
        td={td}
        sym={sym}
      />
      <RzHolderDistribution dossier={dossier} td={td} sym={sym} />

      {/* ── 11. PROJECT INFO ── */}
      <DescriptionSection description={coinDetails?.description} sym={sym} />
      <div className="rz-proj-grid rz-proj-grid--2">
        <KeyTakeawaysSection keyTakeaways={dossier?.keyTakeaways} />
        <FaqSection faq={dossier?.faq} />
      </div>

      {/* ── 12. WHITEPAPER + ROADMAP ── */}
      <div className="rz-proj-grid rz-proj-grid--2">
        <WhitepaperSection
          whitepaperUrl={dossier?.whitepaperUrl}
          whitepaperThumb={dossier?.whitepaperThumb}
          sym={sym}
        />
        <DocsTocSection docsToc={dossier?.docsToc} />
      </div>
      <RoadmapSection roadmap={dossier?.roadmap} />

      {/* ── 13. TEAM + PARTNERS ── */}
      <div className="rz-proj-grid rz-proj-grid--2">
        <TeamSection team={dossier?.team} />
        <PartnersSection partners={dossier?.partners} />
      </div>

      {/* ── 14. FUNDING + UNLOCKS ── */}
      <div className="rz-proj-grid rz-proj-grid--2">
        <FundingRoundsSection rounds={spectreData?.fundraising} />
        <UnlocksSection unlocks={spectreData?.unlocks} />
      </div>

      {/* ── 15. NARRATIVES + MULTI-CHAIN ── */}
      <div className="rz-proj-grid rz-proj-grid--2">
        <NarrativeClusterSection narratives={narratives} />
        <MultiChainSection deployments={dossier?.deployments} />
      </div>

      {/* ── 16. LISTINGS + TIMELINE ── */}
      <ListingsMapSection exchanges={dossier?.exchanges} />
      <TimelineSection timeline={dossier?.timeline} />

      {/* ── 17. RESOURCES ── */}
      <TagsSection tags={dossier?.tags} />
      <KeyLevelsSection tokenProfile={tokenProfile} td={td} fmtPrice={fmtPrice} />
      <LinksSection coinDetails={coinDetails} spectreSocial={spectreSocial} sym={sym} />

      {/* ── 18. DEEP DIVE ── */}
      <BubblemapsSection activeTokenInfo={activeTokenInfo} />
      <TrustBadgeSection dossier={dossier} spectreData={spectreData} />
    </div>
  )
}
