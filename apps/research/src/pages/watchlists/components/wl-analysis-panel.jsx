/**
 * WatchlistAnalysisPanel
 *
 * Watchlist-scoped analytics. Composition / movers / suggestions / activity
 * all derive from the active watchlist's token set. Real PORTFOLIO views
 * (cost basis, P&L, real allocation by USD held) sit in a separate gated
 * card — those need either wallet connection or manual position entry,
 * neither of which the watchlist itself carries.
 *
 * Modules:
 *   1. PortfolioCard          — gated; CTA when no positions / wallet
 *   2. WatchlistComposition   — mcap-weighted donut + cap-tier breakdown
 *   3. PulseStats             — gainers, losers, dispersion, range
 *   4. Suggestions            — heuristic cards (concentration, tilt, …)
 *   5. MoversBlock            — Moving / Flatlines / Coiling lists w/ context
 *   6. ActivityBlock          — Team activity + mention pulse via X-Dash
 *
 * Token shape matches `tableTokens` produced by watchlists-page.jsx:
 *   { id, symbol, name, logo, price, mcap, volume, liquidity,
 *     change1h, change24h, change1w, change7d, change1m, change1y,
 *     chain, sector, pinned, isMajor, ... }
 */
import React, { useMemo, useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getTokenRowStyle } from '@/constants/tokenColors'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { isAppActive } from '@/lib/idleManager'
import useTokenMetadata from './useTokenMetadata'
import './wl-analysis-panel.css'

// ─── Formatters ─────────────────────────────────────────────────────────
const fmtPct = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}
const fmtCompact = (n) => {
  const v = Number(n) || 0
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}
const formatAgo = (iso, t) => {
  const ts = Date.parse(iso || 0)
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const day = 24 * 60 * 60 * 1000
  if (diff < 60 * 60 * 1000) return t('watchlists.time.minutesAgo', '{{n}}m ago', { n: Math.floor(diff / 60000) })
  if (diff < day) return t('watchlists.time.hoursAgo', '{{n}}h ago', { n: Math.floor(diff / 3600000) })
  if (diff < 30 * day) return t('watchlists.time.daysAgo', '{{n}}d ago', { n: Math.floor(diff / day) })
  return t('watchlists.time.monthsAgo', '{{n}}mo ago', { n: Math.floor(diff / (30 * day)) })
}

// ─── Module 1: Portfolio Holdings (gated) ─────────────────────────────
//
// Watchlist tokens != portfolio positions. Until the user either connects
// a wallet or enters cost basis + quantity per holding, we can't compute
// real allocation, P&L, or unrealised return. This card is the gate.
function PortfolioCard({ holdings, onAddHoldings, onConnectWallet, t, fmtUsd }) {
  const hasData = Array.isArray(holdings) && holdings.length > 0

  if (!hasData) {
    return (
      <div className="wla-card wla-portfolio-empty">
        <div className="wla-card-head">
          <span className="wla-card-title">{t('watchlists.analysis.portfolio.title', 'Your portfolio')}</span>
          <span className="wla-card-meta">{t('watchlists.analysis.portfolio.noPositions', 'no positions')}</span>
        </div>
        <div className="wla-portfolio-cta">
          <div className="wla-portfolio-cta-copy">
            {t(
              'watchlists.analysis.portfolio.ctaCopy',
              'Watchlist analytics (below) work on every token you track. To see your actual allocation, cost basis, and P&L, connect a wallet or enter holdings manually.'
            )}
          </div>
          <div className="wla-portfolio-cta-actions">
            <button type="button" className="wla-btn-primary" onClick={onConnectWallet}>
              {t('watchlists.analysis.portfolio.connectWallet', 'Connect wallet')}
            </button>
            <button type="button" className="wla-btn-secondary" onClick={onAddHoldings}>
              {t('watchlists.analysis.portfolio.addHoldings', 'Add holdings manually')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Real portfolio render — sized for future expansion. Holdings shape:
  //   { symbol, qty, costBasisUsd, currentPriceUsd, change24h }
  const totals = holdings.reduce((acc, h) => {
    const val = (Number(h.qty) || 0) * (Number(h.currentPriceUsd) || 0)
    const cost = (Number(h.qty) || 0) * (Number(h.costBasisUsd) || 0)
    return { value: acc.value + val, cost: acc.cost + cost }
  }, { value: 0, cost: 0 })
  const pnl = totals.value - totals.cost
  const pnlPct = totals.cost > 0 ? (pnl / totals.cost) * 100 : 0

  return (
    <div className="wla-card wla-portfolio">
      <div className="wla-card-head">
        <span className="wla-card-title">{t('watchlists.analysis.portfolio.title', 'Your portfolio')}</span>
        <span className="wla-card-meta">
          {t('watchlists.analysis.portfolio.positionCount', '{{count}} positions', { count: holdings.length })}
        </span>
      </div>
      <div className="wla-portfolio-totals">
        <div className="wla-portfolio-total">
          <span className="wla-portfolio-total-label">{t('watchlists.analysis.portfolio.currentValue', 'Current value')}</span>
          <span className="wla-portfolio-total-value">{fmtUsd(totals.value)}</span>
        </div>
        <div className="wla-portfolio-total">
          <span className="wla-portfolio-total-label">{t('watchlists.analysis.portfolio.totalPnL', 'Total P&L')}</span>
          <span className={`wla-portfolio-total-value ${pnl >= 0 ? 'bull' : 'bear'}`}>
            {pnl >= 0 ? '+' : ''}{fmtUsd(Math.abs(pnl))} ({fmtPct(pnlPct)})
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Module 2: Watchlist Composition (mcap-weighted donut) ────────────
function WatchlistComposition({ tokens, grouping, onGroupingChange, metadata, t, fmtUsd }) {
  const slices = useMemo(() => {
    if (!tokens.length) return { items: [], total: 0 }
    const keyOf = (token) => {
      if (grouping === 'chain') return token.chain || t('watchlists.analysis.composition.unknownChain', 'Unknown')
      if (grouping === 'sector') {
        // Resolve sector via CoinGecko categories pulled by useTokenMetadata.
        // Fall back to whatever the table token row carries, then 'Other'.
        const sym = (token.symbol || '').toUpperCase()
        const m = metadata?.[sym]
        return m?.sector || token.sector || t('watchlists.analysis.composition.otherSector', 'Other')
      }
      return token.symbol || '?'
    }
    const bucket = new Map()
    let total = 0
    for (const token of tokens) {
      const value = Number(token.mcap) || 0
      if (value <= 0) continue
      const k = keyOf(token)
      bucket.set(k, (bucket.get(k) || 0) + value)
      total += value
    }
    const arr = [...bucket.entries()]
      .map(([label, value]) => ({ label, value, pct: total > 0 ? (value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
    if (grouping === 'token' && arr.length > 8) {
      const head = arr.slice(0, 8)
      const tail = arr.slice(8)
      const other = tail.reduce((s, x) => s + x.value, 0)
      head.push({
        label: t('watchlists.analysis.composition.otherBucket', 'Other ({{count}})', { count: tail.length }),
        value: other,
        pct: total > 0 ? (other / total) * 100 : 0,
      })
      return { items: head, total }
    }
    return { items: arr, total }
  }, [tokens, grouping, metadata, t])

  // Cap-tier breakdown — three-bucket histogram by mcap.
  const tiers = useMemo(() => {
    const large = tokens.filter((t) => (Number(t.mcap) || 0) >= 1e9)
    const mid = tokens.filter((t) => {
      const m = Number(t.mcap) || 0
      return m >= 1e8 && m < 1e9
    })
    const small = tokens.filter((t) => {
      const m = Number(t.mcap) || 0
      return m > 0 && m < 1e8
    })
    const sumMcap = (arr) => arr.reduce((s, t) => s + (Number(t.mcap) || 0), 0)
    return [
      { key: 'large', label: t('watchlists.analysis.tiers.large', 'Large'), sublabel: t('watchlists.analysis.tiers.largeRange', '≥ $1B'), count: large.length, pct: slices.total ? (sumMcap(large) / slices.total) * 100 : 0, color: '#10B981' },
      { key: 'mid', label: t('watchlists.analysis.tiers.mid', 'Mid'), sublabel: t('watchlists.analysis.tiers.midRange', '$100M–$1B'), count: mid.length, pct: slices.total ? (sumMcap(mid) / slices.total) * 100 : 0, color: '#F59E0B' },
      { key: 'small', label: t('watchlists.analysis.tiers.small', 'Small'), sublabel: t('watchlists.analysis.tiers.smallRange', '< $100M'), count: small.length, pct: slices.total ? (sumMcap(small) / slices.total) * 100 : 0, color: '#EF4444' },
    ]
  }, [tokens, slices.total, t])

  // Concentration + diversification numbers — HHI (Herfindahl-Hirschman
  // Index) on token shares as a single number for "how concentrated is
  // this watchlist". HHI = sum of squared shares (0–10000). >2500 = highly
  // concentrated, 1500–2500 = moderate, <1500 = diversified.
  const stats = useMemo(() => {
    if (slices.total <= 0) return null
    const shares = []
    for (const t of tokens) {
      const v = Number(t.mcap) || 0
      if (v <= 0) continue
      shares.push((v / slices.total) * 100)
    }
    const hhi = shares.reduce((s, p) => s + p * p, 0)
    const topShare = shares.length ? Math.max(...shares) : 0
    const top3Share = [...shares].sort((a, b) => b - a).slice(0, 3).reduce((s, p) => s + p, 0)
    const chains = new Set(tokens.map((t) => t.chain).filter(Boolean))
    const sectorsRaw = new Set()
    if (metadata) {
      for (const t of tokens) {
        const sym = (t.symbol || '').toUpperCase()
        const m = metadata[sym]
        if (m?.sector) sectorsRaw.add(m.sector)
      }
    }
    let hhiLabel = t('watchlists.analysis.hhi.diversified', 'Diversified')
    let hhiTone = 'bull'
    if (hhi > 2500) { hhiLabel = t('watchlists.analysis.hhi.concentrated', 'Concentrated'); hhiTone = 'bear' }
    else if (hhi > 1500) { hhiLabel = t('watchlists.analysis.hhi.moderate', 'Moderate'); hhiTone = 'neutral' }
    return {
      hhi: Math.round(hhi),
      hhiLabel,
      hhiTone,
      topShare,
      top3Share,
      chainCount: chains.size,
      sectorCount: sectorsRaw.size,
      tokenCount: tokens.length,
    }
  }, [tokens, slices.total, metadata, t])

  const palette = [
    '#10B981', '#3B82F6', '#A78BFA', '#F59E0B', '#EC4899',
    '#06B6D4', '#84CC16', '#F97316', '#EF4444', '#8B5CF6',
  ]
  const radius = 70
  const innerRadius = 44
  const cx = 80
  const cy = 80

  let angleStart = -Math.PI / 2
  const arcs = slices.items.map((s, i) => {
    const angle = (s.pct / 100) * Math.PI * 2
    const x1 = cx + Math.cos(angleStart) * radius
    const y1 = cy + Math.sin(angleStart) * radius
    const x2 = cx + Math.cos(angleStart + angle) * radius
    const y2 = cy + Math.sin(angleStart + angle) * radius
    const x3 = cx + Math.cos(angleStart + angle) * innerRadius
    const y3 = cy + Math.sin(angleStart + angle) * innerRadius
    const x4 = cx + Math.cos(angleStart) * innerRadius
    const y4 = cy + Math.sin(angleStart) * innerRadius
    const large = angle > Math.PI ? 1 : 0
    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${large} 0 ${x4} ${y4} Z`
    angleStart += angle
    return { ...s, path, color: palette[i % palette.length] }
  })

  const groupLabels = {
    token: t('watchlists.analysis.composition.groupToken', 'Token'),
    chain: t('watchlists.analysis.composition.groupChain', 'Chain'),
    sector: t('watchlists.analysis.composition.groupSector', 'Sector'),
  }

  return (
    <div className="wla-card wla-composition">
      <div className="wla-card-head">
        <span className="wla-card-title">{t('watchlists.analysis.composition.title', 'Watchlist composition')}</span>
        <div className="wla-tab-row">
          {['token', 'chain', 'sector'].map((g) => (
            <button
              key={g}
              type="button"
              className={`wla-tab${grouping === g ? ' active' : ''}`}
              onClick={() => onGroupingChange?.(g)}
            >
              {groupLabels[g]}
            </button>
          ))}
        </div>
      </div>
      <div className="wla-composition-body">
        <svg viewBox="0 0 160 160" className="wla-donut" aria-hidden="true">
          {arcs.length === 0 ? (
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={radius - innerRadius} />
          ) : (
            arcs.map((a, i) => (
              <path key={a.label + i} d={a.path} fill={a.color} opacity="0.92" />
            ))
          )}
          <text x={cx} y={cy - 4} className="wla-donut-total" textAnchor="middle">{fmtUsd(slices.total)}</text>
          <text x={cx} y={cy + 14} className="wla-donut-sub" textAnchor="middle">{t('watchlists.analysis.composition.totalMcap', 'total mcap')}</text>
        </svg>
        <ul className="wla-legend">
          {arcs.slice(0, 8).map((a, i) => (
            <li key={a.label + i} className="wla-legend-row">
              <span className="wla-legend-dot" style={{ background: a.color }} />
              <span className="wla-legend-label">{a.label}</span>
              <span className="wla-legend-pct">{a.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="wla-cap-tiers">
        {tiers.map((tier) => (
          <div key={tier.key} className="wla-cap-tier">
            <div className="wla-cap-tier-head">
              <span className="wla-cap-tier-label">{tier.label}</span>
              <span className="wla-cap-tier-sublabel">{tier.sublabel}</span>
            </div>
            <div className="wla-cap-tier-bar">
              <div className="wla-cap-tier-fill" style={{ width: `${Math.min(tier.pct, 100)}%`, background: tier.color }} />
            </div>
            <div className="wla-cap-tier-stats">
              <span>{t('watchlists.analysis.composition.tokenCount', '{{count}} tokens', { count: tier.count })}</span>
              <span className="wla-cap-tier-pct">{tier.pct.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
      {stats && (
        <div className="wla-comp-stats">
          <div className="wla-comp-stat">
            <span className="wla-comp-stat-label">{t('watchlists.analysis.composition.concentrationHHI', 'Concentration (HHI)')}</span>
            <span className={`wla-comp-stat-value ${stats.hhiTone}`}>
              {stats.hhi}
              <span className="wla-comp-stat-tag">{stats.hhiLabel}</span>
            </span>
          </div>
          <div className="wla-comp-stat">
            <span className="wla-comp-stat-label">{t('watchlists.analysis.composition.topHolding', 'Top holding')}</span>
            <span className="wla-comp-stat-value">{stats.topShare.toFixed(1)}%</span>
          </div>
          <div className="wla-comp-stat">
            <span className="wla-comp-stat-label">{t('watchlists.analysis.composition.top3Share', 'Top 3 share')}</span>
            <span className="wla-comp-stat-value">{stats.top3Share.toFixed(1)}%</span>
          </div>
          <div className="wla-comp-stat">
            <span className="wla-comp-stat-label">{t('watchlists.analysis.composition.diversity', 'Diversity')}</span>
            <span className="wla-comp-stat-value">
              {t('watchlists.analysis.composition.diversityValue', '{{chains}} chains · {{sectors}} sectors', { chains: stats.chainCount, sectors: stats.sectorCount })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Module 3: Pulse Stats (numbers card) ─────────────────────────────
function PulseStats({ tokens, t, fmtUsd }) {
  const stats = useMemo(() => {
    const changes = tokens
      .map((t) => Number(t.change24h))
      .filter((c) => Number.isFinite(c))
    if (changes.length === 0) return null
    const gainers = changes.filter((c) => c >= 0).length
    const losers = changes.filter((c) => c < 0).length
    const best = Math.max(...changes)
    const worst = Math.min(...changes)
    const avg = changes.reduce((s, c) => s + c, 0) / changes.length
    const sorted = [...changes].sort((a, b) => a - b)
    const median = sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    const variance = changes.length > 1
      ? changes.reduce((s, c) => s + (c - avg) ** 2, 0) / (changes.length - 1)
      : 0
    const stddev = Math.sqrt(variance)
    const totalVolume = tokens.reduce((s, t) => s + (Number(t.volume) || 0), 0)
    const totalLiquidity = tokens.reduce((s, t) => s + (Number(t.liquidity) || 0), 0)
    return {
      gainers, losers,
      best, worst, spread: best - worst,
      avg, median, stddev,
      totalVolume, totalLiquidity,
    }
  }, [tokens])

  if (!stats) return null
  return (
    <div className="wla-card wla-pulse">
      <div className="wla-card-head">
        <span className="wla-card-title">{t('watchlists.analysis.pulse.title', 'Market pulse')}</span>
        <span className="wla-card-meta">{t('watchlists.analysis.pulse.timeframe', '24h')}</span>
      </div>
      <div className="wla-pulse-grid">
        <div className="wla-pulse-stat">
          <span className="wla-pulse-label">{t('watchlists.analysis.pulse.gainersLosers', 'Gainers / Losers')}</span>
          <span className="wla-pulse-value">
            <span className="bull">{stats.gainers}</span>
            <span className="wla-pulse-sep"> / </span>
            <span className="bear">{stats.losers}</span>
          </span>
        </div>
        <div className="wla-pulse-stat">
          <span className="wla-pulse-label">{t('watchlists.analysis.pulse.avgMedian', 'Avg / Median')}</span>
          <span className="wla-pulse-value">
            <span className={stats.avg >= 0 ? 'bull' : 'bear'}>{fmtPct(stats.avg)}</span>
            <span className="wla-pulse-sep"> · </span>
            <span className={stats.median >= 0 ? 'bull' : 'bear'}>{fmtPct(stats.median)}</span>
          </span>
        </div>
        <div className="wla-pulse-stat">
          <span className="wla-pulse-label">{t('watchlists.analysis.pulse.dispersion', 'Dispersion (σ)')}</span>
          <span className="wla-pulse-value">{stats.stddev.toFixed(2)}%</span>
        </div>
        <div className="wla-pulse-stat">
          <span className="wla-pulse-label">{t('watchlists.analysis.pulse.bestWorst', 'Best – Worst')}</span>
          <span className="wla-pulse-value">
            <span className="bull">{fmtPct(stats.best)}</span>
            <span className="wla-pulse-sep"> · </span>
            <span className="bear">{fmtPct(stats.worst)}</span>
          </span>
        </div>
        <div className="wla-pulse-stat">
          <span className="wla-pulse-label">{t('watchlists.analysis.pulse.totalVolume', 'Total volume')}</span>
          <span className="wla-pulse-value">{fmtUsd(stats.totalVolume)}</span>
        </div>
        <div className="wla-pulse-stat">
          <span className="wla-pulse-label">{t('watchlists.analysis.pulse.totalLiquidity', 'Total liquidity')}</span>
          <span className="wla-pulse-value">{fmtUsd(stats.totalLiquidity)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Module 4: Suggestions ────────────────────────────────────────────
function Suggestions({ tokens, allocation, metadata, t }) {
  const ellipsis = (arr) => arr.length > 4 ? '…' : ''

  const cards = useMemo(() => {
    if (!tokens.length) return []
    const out = []
    const total = allocation.total || tokens.reduce((s, tok) => s + (Number(tok.mcap) || 0), 0)

    const top = allocation.items?.[0]
    if (top && top.pct > 50) {
      out.push({
        kind: 'warn',
        title: t('watchlists.analysis.suggestions.concentratedTitle', 'Concentrated in {{label}}', { label: top.label }),
        body: t('watchlists.analysis.suggestions.concentratedBody', '{{label}} is {{pct}}% of your watchlist by mcap. One bad print drags the whole basket — consider trimming or pairing with an inverse exposure.', { label: top.label, pct: top.pct.toFixed(0) }),
      })
    }

    const microCap = tokens.filter((tok) => (Number(tok.mcap) || 0) > 0 && Number(tok.mcap) < 10e6)
    if (microCap.length >= 5) {
      out.push({
        kind: 'warn',
        title: t('watchlists.analysis.suggestions.microCapTitle', '{{count}} sub-$10M caps', { count: microCap.length }),
        body: t('watchlists.analysis.suggestions.microCapBody', 'Long-tail micro-caps soak attention and rarely move the portfolio. Audit which still have a thesis and prune the rest.'),
      })
    }

    const staleLosers = tokens.filter((tok) =>
      Number.isFinite(Number(tok.change1m)) && Number(tok.change1m) < -25 &&
      Number.isFinite(Number(tok.change7d)) && Number(tok.change7d) < -3 &&
      (tok.pinned !== true))
    if (staleLosers.length >= 3) {
      out.push({
        kind: 'warn',
        title: t('watchlists.analysis.suggestions.staleLosersTitle', '{{count}} stale losers', { count: staleLosers.length }),
        body: t('watchlists.analysis.suggestions.staleLosersBody', 'Tokens down >25% over 30d AND still red on 7d: {{symbols}}{{ellipsis}}. Either average down with conviction or cut the line.', { symbols: staleLosers.slice(0, 4).map((x) => x.symbol).join(', '), ellipsis: ellipsis(staleLosers) }),
      })
    }

    // Chain tilt
    const chainBuckets = new Map()
    for (const tok of tokens) {
      const v = Number(tok.mcap) || 0
      if (v <= 0) continue
      const k = tok.chain || 'Unknown'
      chainBuckets.set(k, (chainBuckets.get(k) || 0) + v)
    }
    const chainSorted = [...chainBuckets.entries()].sort((a, b) => b[1] - a[1])
    if (chainSorted.length && total > 0) {
      const [topChain, topVal] = chainSorted[0]
      const topPct = (topVal / total) * 100
      if (topPct > 70 && topChain !== 'Unknown') {
        out.push({
          kind: 'info',
          title: t('watchlists.analysis.suggestions.chainTiltTitle', '{{pct}}% on {{chain}}', { pct: topPct.toFixed(0), chain: topChain }),
          body: t('watchlists.analysis.suggestions.chainTiltBody', 'Single-chain exposure carries chain-specific risk (downtime, regulatory). A cross-chain hedge would reduce tail risk.'),
        })
      }
    }

    // Stablecoin tilt
    const stableSymbols = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'BUSD', 'USDP', 'PYUSD'])
    const stableTokens = tokens.filter((tok) => stableSymbols.has((tok.symbol || '').toUpperCase()))
    if (stableTokens.length > 0) {
      const stableVal = stableTokens.reduce((s, tok) => s + (Number(tok.mcap) || 0), 0)
      const stablePct = total > 0 ? (stableVal / total) * 100 : 0
      if (stablePct > 30) {
        out.push({
          kind: 'info',
          title: t('watchlists.analysis.suggestions.stableTitle', '{{pct}}% stablecoins', { pct: stablePct.toFixed(0) }),
          body: t('watchlists.analysis.suggestions.stableBody', "Heavy stablecoin tilt parks beta but caps upside. If you're tracking stables for yield routes, fine — if it's accidental, rotate into productive risk."),
        })
      }
    }

    // No major exposure
    const majorSymbols = new Set(['BTC', 'ETH', 'SOL'])
    const hasMajor = tokens.some((tok) => majorSymbols.has((tok.symbol || '').toUpperCase()))
    if (!hasMajor && tokens.length >= 5) {
      out.push({
        kind: 'info',
        title: t('watchlists.analysis.suggestions.noMajorTitle', 'No BTC/ETH/SOL exposure'),
        body: t('watchlists.analysis.suggestions.noMajorBody', 'Your watchlist is 100% alt/small-cap. Majors anchor a portfolio against full draw-downs — consider adding at least one as a benchmark.'),
      })
    }

    // Volume dry-up — tokens with mcap but tiny volume/mcap ratio
    const dry = tokens.filter((tok) => {
      const m = Number(tok.mcap) || 0
      const v = Number(tok.volume) || 0
      return m > 1e7 && v > 0 && (v / m) < 0.005
    })
    if (dry.length >= 3) {
      out.push({
        kind: 'warn',
        title: t('watchlists.analysis.suggestions.dryTitle', '{{count}} tokens with <0.5% vol/mcap', { count: dry.length }),
        body: t('watchlists.analysis.suggestions.dryBody', '{{symbols}}{{ellipsis}} are seeing very thin volume relative to their cap. Liquidity drying up means slippage on exit.', { symbols: dry.slice(0, 4).map((x) => x.symbol).join(', '), ellipsis: ellipsis(dry) }),
      })
    }

    // Bullish concentration (info, not warning)
    const winners = tokens.filter((tok) => Number.isFinite(Number(tok.change7d)) && Number(tok.change7d) > 10)
    if (winners.length >= 5) {
      out.push({
        kind: 'ok',
        title: t('watchlists.analysis.suggestions.winnersTitle', '{{count}} tokens up >10% on 7d', { count: winners.length }),
        body: t('watchlists.analysis.suggestions.winnersBody', 'Top picks running: {{symbols}}. Consider locking in partial gains before mean reversion.', { symbols: winners.slice(0, 5).map((x) => x.symbol).join(', ') }),
      })
    }

    // Pinned ratio — if user pinned a lot, they're using watchlist as a focus list
    const pinned = tokens.filter((tok) => tok.pinned)
    if (pinned.length === 0 && tokens.length > 20) {
      out.push({
        kind: 'info',
        title: t('watchlists.analysis.suggestions.noPinnedTitle', 'Nothing pinned'),
        body: t('watchlists.analysis.suggestions.noPinnedBody', 'With {{count}} tokens tracked, pinning your top 3–5 highest-conviction names keeps them visible without scrolling.', { count: tokens.length }),
      })
    }

    // Sector tilt — uses CG categories from metadata
    if (metadata) {
      const sectorMcap = new Map()
      for (const tok of tokens) {
        const sym = (tok.symbol || '').toUpperCase()
        const sector = metadata[sym]?.sector
        const v = Number(tok.mcap) || 0
        if (!sector || v <= 0) continue
        sectorMcap.set(sector, (sectorMcap.get(sector) || 0) + v)
      }
      const sectorList = [...sectorMcap.entries()].sort((a, b) => b[1] - a[1])
      if (sectorList.length && total > 0) {
        const [topSector, topVal] = sectorList[0]
        const pct = (topVal / total) * 100
        if (pct > 60) {
          out.push({
            kind: 'info',
            title: t('watchlists.analysis.suggestions.sectorTitle', '{{pct}}% in {{sector}}', { pct: pct.toFixed(0), sector: topSector }),
            body: t('watchlists.analysis.suggestions.sectorBody', 'Heavy single-sector exposure. If {{sector}} narrative cools, your basket bleeds together. Consider a cross-sector hedge.', { sector: topSector }),
          })
        }
      }
    }

    // Meme-coin tilt — CG categories include "Meme"
    if (metadata) {
      const memeTokens = tokens.filter((tok) => {
        const sym = (tok.symbol || '').toUpperCase()
        const cats = metadata[sym]?.categories || []
        return cats.some((c) => /meme/i.test(c))
      })
      const memeMcap = memeTokens.reduce((s, tok) => s + (Number(tok.mcap) || 0), 0)
      const memePct = total > 0 ? (memeMcap / total) * 100 : 0
      if (memeTokens.length >= 5 || memePct > 35) {
        out.push({
          kind: 'warn',
          title: t('watchlists.analysis.suggestions.memeTitle', '{{pct}}% in memes ({{count}})', { pct: memePct.toFixed(0), count: memeTokens.length }),
          body: t('watchlists.analysis.suggestions.memeBody', "Meme exposure is binary — it works until it doesn't. {{symbols}}{{ellipsis}}. Right-size against narrative timing, not sentiment.", { symbols: memeTokens.slice(0, 4).map((x) => x.symbol).join(', '), ellipsis: ellipsis(memeTokens) }),
        })
      }
    }

    // Volume spike — tokens where 24h vol > 5% of mcap (rare, signals activity)
    const volSpikes = tokens.filter((tok) => {
      const m = Number(tok.mcap) || 0
      const v = Number(tok.volume) || 0
      return m > 1e7 && (v / m) > 0.05
    })
    if (volSpikes.length >= 1) {
      out.push({
        kind: 'ok',
        title: t('watchlists.analysis.suggestions.volSpikeTitle', '{{count}} volume spikes', { count: volSpikes.length }),
        body: t('watchlists.analysis.suggestions.volSpikeBody', 'Above-5%-of-mcap turnover today: {{symbols}}{{ellipsis}}. Something is happening — check news/catalysts before the move runs.', { symbols: volSpikes.slice(0, 4).map((x) => x.symbol).join(', '), ellipsis: ellipsis(volSpikes) }),
      })
    }

    // 24h momentum divergence — 1h up but 24h down (or vice versa)
    const reversing = tokens.filter((tok) => {
      const c1 = Number(tok.change1h) || 0
      const c24 = Number(tok.change24h) || 0
      return Math.sign(c1) !== Math.sign(c24) && Math.abs(c1) > 1.5 && Math.abs(c24) > 3
    })
    if (reversing.length >= 3) {
      out.push({
        kind: 'info',
        title: t('watchlists.analysis.suggestions.reversingTitle', '{{count}} reversing intraday', { count: reversing.length }),
        body: t('watchlists.analysis.suggestions.reversingBody', '1h and 24h pointing different directions: {{symbols}}{{ellipsis}}. Either trend exhaustion or a bounce setup — match against levels.', { symbols: reversing.slice(0, 4).map((x) => x.symbol).join(', '), ellipsis: ellipsis(reversing) }),
      })
    }

    // Project quality — using CG community/developer scores
    if (metadata) {
      const lowQuality = tokens.filter((tok) => {
        const sym = (tok.symbol || '').toUpperCase()
        const m = metadata[sym]
        if (!m || (m.cgScore == null && m.developerScore == null)) return false
        const dev = Number(m.developerScore) || 0
        const community = Number(m.communityScore) || 0
        return dev < 10 && community < 10 && (Number(tok.mcap) || 0) < 50e6
      })
      if (lowQuality.length >= 3) {
        out.push({
          kind: 'warn',
          title: t('watchlists.analysis.suggestions.thinFundamentalsTitle', '{{count}} thin fundamentals', { count: lowQuality.length }),
          body: t('watchlists.analysis.suggestions.thinFundamentalsBody', 'CG community + developer scores both <10, mcap <$50M: {{symbols}}{{ellipsis}}. Likely speculative-only — size accordingly.', { symbols: lowQuality.slice(0, 4).map((x) => x.symbol).join(', '), ellipsis: ellipsis(lowQuality) }),
        })
      }
    }

    // Watchlist density — too few or too many
    if (tokens.length < 5) {
      out.push({
        kind: 'info',
        title: t('watchlists.analysis.suggestions.sparseTitle', 'Watchlist is sparse ({{count}})', { count: tokens.length }),
        body: t('watchlists.analysis.suggestions.sparseBody', 'Tracking fewer than 5 tokens limits comparative insight. Add 5-15 names across sectors so the analytics have signal to work with.'),
      })
    } else if (tokens.length > 40) {
      out.push({
        kind: 'info',
        title: t('watchlists.analysis.suggestions.crowdedTitle', 'Watchlist is crowded ({{count}})', { count: tokens.length }),
        body: t('watchlists.analysis.suggestions.crowdedBody', 'Past ~40 tokens, the watchlist becomes a notification list rather than a decision tool. Consider splitting into themed lists (e.g., majors, on-chain, narratives).'),
      })
    }

    if (out.length === 0) {
      out.push({
        kind: 'ok',
        title: t('watchlists.analysis.suggestions.balancedTitle', 'Portfolio shape looks balanced'),
        body: t('watchlists.analysis.suggestions.balancedBody', 'No concentration, no stale tail, no single-chain risk flags. Keep monitoring as positions rotate.'),
      })
    }
    return out
  }, [tokens, allocation, metadata, t])

  return (
    <div className="wla-card wla-suggestions">
      <div className="wla-card-head">
        <span className="wla-card-title">{t('watchlists.analysis.suggestions.title', 'Suggestions')}</span>
        <span className="wla-card-meta">
          {t('watchlists.analysis.suggestions.cardCount', '{{count}} cards', { count: cards.length })}
        </span>
      </div>
      <ul className="wla-sugg-list">
        {cards.map((c, i) => (
          <li key={c.title + i} className={`wla-sugg-item wla-sugg-${c.kind}`}>
            <div className="wla-sugg-title">
              <span className="wla-sugg-dot" aria-hidden="true" />
              {c.title}
            </div>
            <div className="wla-sugg-body">{c.body}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Module 4b: Performance Scoreboard (7d focused) ──────────────────
function PerformanceScoreboard({ tokens, t }) {
  const stats = useMemo(() => {
    // Strict 7d presence — Number(undefined) || Number(undefined) → NaN, but
    // we previously also let through tokens that lack BOTH change1w and
    // change7d because `Number.isFinite(Number(undefined) || Number(undefined))`
    // is false only when the OR result is NaN; with the falsey-pipe, missing
    // values collapse to NaN. Tighten so 0% rows still pass while truly
    // missing rows do not.
    const hasSeven = (t) => Number.isFinite(Number(t.change1w)) || Number.isFinite(Number(t.change7d))
    const withSeven = tokens.filter(hasSeven)
    // Scoreboard reads "Top 3 / Bottom 3 / Momentum" — meaningless when only
    // one or two tokens carry 7d, and visually the rest of the table goes
    // gray. Hide the whole module when coverage is below the threshold.
    if (withSeven.length < 3) return null
    const getSeven = (t) => Number(t.change1w ?? t.change7d) || 0
    const sortedByWeek = [...withSeven].sort((a, b) => getSeven(b) - getSeven(a))
    const top3 = sortedByWeek.slice(0, 3)
    const bottom3 = sortedByWeek.slice(-3).reverse()
    const positive = withSeven.filter((t) => getSeven(t) > 0).length
    const ratio = withSeven.length > 0 ? (positive / withSeven.length) * 100 : 0

    // Combined momentum score: 1h+24h+7d positive alignment.
    const momentum = tokens
      .map((t) => {
        const c1 = Number(t.change1h) || 0
        const c24 = Number(t.change24h) || 0
        const c7 = getSeven(t)
        // Score rewards alignment of signs and magnitude.
        const sign = Math.sign(c1) + Math.sign(c24) + Math.sign(c7)
        const mag = Math.abs(c1) * 0.2 + Math.abs(c24) * 0.3 + Math.abs(c7) * 0.5
        return { token: t, score: sign * mag, c1, c24, c7 }
      })
      .filter((x) => x.token.symbol)
      .sort((a, b) => b.score - a.score)
    const topMomentum = momentum.slice(0, 3)

    return { top3, bottom3, ratio, positive, total: withSeven.length, topMomentum, getSeven }
  }, [tokens])

  if (!stats) return null
  return (
    <div className="wla-card wla-scoreboard">
      <div className="wla-card-head">
        <span className="wla-card-title">{t('watchlists.analysis.scoreboard.title', 'Performance scoreboard')}</span>
        <span className="wla-card-meta">
          {t('watchlists.analysis.scoreboard.greenMeta', '{{positive}}/{{total}} green · 7d', { positive: stats.positive, total: stats.total })}
        </span>
      </div>
      <div className="wla-scoreboard-cols">
        <div className="wla-scoreboard-col">
          <div className="wla-scoreboard-sublabel">{t('watchlists.analysis.scoreboard.top3', 'Top 3 (7d)')}</div>
          {stats.top3.map((token) => (
            <div key={`top-${token.id}`} className="wla-row">
              <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
              <span className="wla-row-chg bull">{fmtPct(stats.getSeven(token))}</span>
            </div>
          ))}
        </div>
        <div className="wla-scoreboard-col">
          <div className="wla-scoreboard-sublabel">{t('watchlists.analysis.scoreboard.bottom3', 'Bottom 3 (7d)')}</div>
          {stats.bottom3.map((token) => (
            <div key={`bot-${token.id}`} className="wla-row">
              <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
              <span className="wla-row-chg bear">{fmtPct(stats.getSeven(token))}</span>
            </div>
          ))}
        </div>
        <div className="wla-scoreboard-col">
          <div className="wla-scoreboard-sublabel">{t('watchlists.analysis.scoreboard.momentum', 'Momentum (1h + 24h + 7d aligned)')}</div>
          {stats.topMomentum.map(({ token, c1, c24, c7 }) => (
            <div key={`mom-${token.id}`} className="wla-row wla-row-mom">
              <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
              <span className="wla-row-meta">
                <span className={c1 >= 0 ? 'bull' : 'bear'}>{c1.toFixed(1)}%</span>
                <span className="wla-pulse-sep"> · </span>
                <span className={c24 >= 0 ? 'bull' : 'bear'}>{c24.toFixed(1)}%</span>
                <span className="wla-pulse-sep"> · </span>
                <span className={c7 >= 0 ? 'bull' : 'bear'}>{c7.toFixed(1)}%</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Module 4c: Liquidity Health ──────────────────────────────────────
function LiquidityHealth({ tokens, t, fmtUsd }) {
  const stats = useMemo(() => {
    const withVol = tokens.filter((t) => (Number(t.volume) || 0) > 0)
    if (withVol.length === 0) return null
    const sumVol = withVol.reduce((s, t) => s + (Number(t.volume) || 0), 0)
    const sumLiq = tokens.reduce((s, t) => s + (Number(t.liquidity) || 0), 0)
    const sumMcap = tokens.reduce((s, t) => s + (Number(t.mcap) || 0), 0)
    // High vol/mcap ratio = unusually active
    const volMcap = sumMcap > 0 ? (sumVol / sumMcap) * 100 : 0
    // Thinnest liquidity: tokens with mcap > $5M but liquidity < 1% of mcap.
    const thinLiq = tokens
      .filter((t) => {
        const m = Number(t.mcap) || 0
        const l = Number(t.liquidity) || 0
        return m > 5e6 && l > 0 && (l / m) < 0.01
      })
      .sort((a, b) => (Number(b.mcap) || 0) - (Number(a.mcap) || 0))
      .slice(0, 4)
    // Volume leaders by raw 24h vol
    const topVol = [...withVol]
      .sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0))
      .slice(0, 4)
    return { sumVol, sumLiq, volMcap, thinLiq, topVol }
  }, [tokens])

  if (!stats) return null
  return (
    <div className="wla-card">
      <div className="wla-card-head">
        <span className="wla-card-title">{t('watchlists.analysis.liquidity.title', 'Liquidity health')}</span>
        <span className="wla-card-meta">
          {t('watchlists.analysis.liquidity.volMcap', 'vol / mcap: {{pct}}%', { pct: stats.volMcap.toFixed(2) })}
        </span>
      </div>
      <div className="wla-liq-grid">
        <div>
          <div className="wla-scoreboard-sublabel">{t('watchlists.analysis.liquidity.volumeLeaders', 'Volume leaders (24h)')}</div>
          {stats.topVol.map((token) => (
            <div key={`vol-${token.id}`} className="wla-row">
              <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
              <span className="wla-row-chg">{fmtUsd(token.volume)}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="wla-scoreboard-sublabel">{t('watchlists.analysis.liquidity.thinLiquidity', 'Thin liquidity (mcap >$5M, liq <1%)')}</div>
          {stats.thinLiq.length === 0 ? (
            <div className="wla-empty">{t('watchlists.analysis.liquidity.allHealthy', 'All tokens carry healthy liquidity.')}</div>
          ) : (
            stats.thinLiq.map((token) => (
              <div key={`thin-${token.id}`} className="wla-row">
                <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
                <span className="wla-row-meta">{((Number(token.liquidity) / Number(token.mcap)) * 100).toFixed(2)}% · {fmtUsd(token.liquidity)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Module 5: Movers / Flatlines / Coiling (with context) ────────────
function MoversBlock({ tokens, sevenDayCoverage, t }) {
  const { movers, flat, coiling, totalVolume, sevenCoverage } = useMemo(() => {
    const withChange = tokens.filter((t) => Number.isFinite(Number(t.change24h)))
    const sorted = [...withChange].sort((a, b) => Math.abs(Number(b.change24h)) - Math.abs(Number(a.change24h)))
    const movers = sorted.filter((t) => Math.abs(Number(t.change24h)) >= 1).slice(0, 6)
    const flat = withChange
      .filter((t) => Math.abs(Number(t.change24h)) < 1)
      .sort((a, b) => Math.abs(Number(a.change24h)) - Math.abs(Number(b.change24h)))
      .slice(0, 6)
    // Coiling needs real 7d data — skip when 7d isn't available so we don't
    // false-positive every dashless on-chain row as "coiling".
    const coiling = withChange
      .filter((t) => Number.isFinite(Number(t.change7d)) && Math.abs(Number(t.change7d)) < 5 && Math.abs(Number(t.change24h)) < 2)
      .sort((a, b) => (Number(b.mcap) || 0) - (Number(a.mcap) || 0))
      .slice(0, 6)
    const totalVolume = withChange.reduce((s, t) => s + (Number(t.volume) || 0), 0)
    const sevenCoverage = withChange.filter((t) => Number.isFinite(Number(t.change7d))).length / Math.max(1, withChange.length)
    return { movers, flat, coiling, totalVolume, sevenCoverage }
  }, [tokens])

  // Only annotate rows with 7d when the dataset broadly carries it — half-
  // populated columns of dashes look broken. The hook prop wins when passed.
  const showSevenColumn = sevenDayCoverage != null
    ? sevenDayCoverage >= 0.5
    : sevenCoverage >= 0.5

  // Volume share rendered alongside the 24h % so the row shows BOTH the
  // move and whether it's backed by volume.
  const Row = ({ token, showSeven }) => {
    const volShare = totalVolume > 0 && Number(token.volume) > 0
      ? ((Number(token.volume) / totalVolume) * 100)
      : null
    const seven = Number(token.change7d)
    const hasSeven = Number.isFinite(seven)
    return (
      <li className="wla-row wla-row-rich">
        <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
        <span className="wla-row-meta">
          {volShare != null ? t('watchlists.analysis.movers.volShare', '{{pct}}% vol', { pct: volShare.toFixed(1) }) : ''}
        </span>
        {showSeven && (
          hasSeven ? (
            <span className={`wla-row-meta ${seven >= 0 ? 'bull' : 'bear'}`}>
              {t('watchlists.analysis.movers.sevenDay', '7d {{value}}', { value: fmtPct(seven) })}
            </span>
          ) : (
            <span className="wla-row-meta wla-muted">{t('watchlists.analysis.movers.sevenDayEmpty', '7d —')}</span>
          )
        )}
        <span className={`wla-row-chg ${Number(token.change24h) >= 0 ? 'bull' : 'bear'}`}>
          {fmtPct(token.change24h)}
        </span>
      </li>
    )
  }

  const showCoiling = coiling.length > 0
  // Two-up grid when Coiling is hidden so the remaining cards fill the row.
  const rowClass = `wla-movers-row${showCoiling ? '' : ' wla-movers-row--two'}`

  return (
    <div className={rowClass}>
      <div className="wla-card">
        <div className="wla-card-head"><span className="wla-card-title">{t('watchlists.analysis.movers.movingTitle', 'Moving')}</span><span className="wla-card-meta">{t('watchlists.analysis.movers.movingMeta', '|24h| ≥ 1%')}</span></div>
        {movers.length === 0 ? (
          <div className="wla-empty">{t('watchlists.analysis.movers.nothingMoving', 'Nothing moving over 1%.')}</div>
        ) : (
          <ul className="wla-list">{movers.map((token) => <Row key={token.id} token={token} showSeven={showSevenColumn} />)}</ul>
        )}
      </div>
      <div className="wla-card">
        <div className="wla-card-head"><span className="wla-card-title">{t('watchlists.analysis.movers.flatlinesTitle', 'Flatlines')}</span><span className="wla-card-meta">{t('watchlists.analysis.movers.flatlinesMeta', '|24h| < 1%')}</span></div>
        {flat.length === 0 ? (
          <div className="wla-empty">{t('watchlists.analysis.movers.allMoving', 'All tokens moving.')}</div>
        ) : (
          <ul className="wla-list">{flat.map((token) => <Row key={token.id} token={token} showSeven={showSevenColumn} />)}</ul>
        )}
      </div>
      {showCoiling && (
        <div className="wla-card">
          <div className="wla-card-head"><span className="wla-card-title">{t('watchlists.analysis.movers.coilingTitle', 'Coiling')}</span><span className="wla-card-meta">{t('watchlists.analysis.movers.coilingMeta', '|7d|<5% · |24h|<2%')}</span></div>
          <ul className="wla-list">{coiling.map((token) => <Row key={token.id} token={token} showSeven={showSevenColumn} />)}</ul>
        </div>
      )}
    </div>
  )
}

// ─── Module 6: Team Activity + Mention Pulse (single X-Dash source) ──
//
// X-Dash already classifies every tweet with `match.matched_by` and
// `match.role`. Tweets that carry 'official' or 'self' in matched_by
// are FROM the project's own account — that's our "team activity"
// signal. Everything else is community mentions — that's our pulse.
// One fetch per token covers both columns; no separate /api/tweets/official.
//
// Shows EVERY token in the watchlist, not just top-12 by mcap, so internal
// tokens like SPECTRE that don't make the cap leaderboard still appear.
function ActivityBlock({ tokens, isActive, metadata, t }) {
  const ranked = useMemo(() => {
    // Sort by mcap desc but include all rows (no slice). Tokens with no
    // mcap fall to the bottom; user can still see their team activity.
    return [...tokens].sort((a, b) => (Number(b.mcap) || 0) - (Number(a.mcap) || 0))
  }, [tokens])

  // Map: symbol -> { handle, official7d, lastOfficialAt, mentions7d, trend, loaded }
  const [activity, setActivity] = useState({})
  const fetchedRef = useRef(new Set())

  // Reset when watchlist identity changes
  useEffect(() => {
    setActivity({})
    fetchedRef.current = new Set()
  }, [ranked.map((t) => t.id).join('|')])

  // Refresh tick — every 3 min, clear the fetched set so the activity
  // effect re-runs and we pick up new tweets/mentions. Counts as "live".
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    if (!isActive) return undefined
    const id = setInterval(() => {
      // Skip when the tab is hidden OR the user has gone idle (visible-but-
      // abandoned tab). Each tick fans out an X-Dash call per token — idle
      // tabs left open were a named cost driver. See lib/idleManager.js.
      if (document.hidden || !isAppActive()) return
      fetchedRef.current = new Set()
      setRefreshTick((t) => (t + 1) % 1_000_000)
    }, 3 * 60 * 1000)
    return () => clearInterval(id)
  }, [isActive])

  useEffect(() => {
    if (!isActive || ranked.length === 0) return
    let cancelled = false

    const fetchOne = async (token) => {
      const sym = (token.symbol || '').toUpperCase()
      if (!sym || fetchedRef.current.has(sym)) return
      fetchedRef.current.add(sym)

      // Handle resolution priority (each tier overrides X-Dash search):
      //   1. CoinGecko metadata.links.twitter (most authoritative)
      //   2. HANDLE_HINTS table for known majors
      //   3. SPECTRE_TOKEN_HANDLES for internal tokens
      //   4. X-Dash search (last — only if all metadata sources missed)
      const meta = metadata?.[sym]
      const metadataHandle = meta?.twitterHandle || null
      const knownHandle = metadataHandle
        || HANDLE_HINTS[sym]
        || SPECTRE_TOKEN_HANDLES[sym]
        || null

      const xdash = await fetchXDashTokenData(token, knownHandle).catch(() => null)
      if (cancelled) return

      setActivity((prev) => ({
        ...prev,
        [sym]: {
          handle: knownHandle || xdash?.officialHandle || null,
          official7d: xdash?.official7d ?? null,
          lastOfficialAt: xdash?.lastOfficialAt ?? null,
          mentions7d: xdash?.mentions7d ?? null,
          mentions24h: xdash?.mentions24h ?? null,
          trend: xdash?.trend ?? null,
          xdashCovered: xdash != null,
          loaded: true,
        },
      }))
    }

    // Stagger fan-out — X-Dash backend protection. With all tokens shown
    // (potentially 40+), 300ms per token keeps the burst under 4 req/s.
    let i = 0
    const id = setInterval(() => {
      if (i >= ranked.length) { clearInterval(id); return }
      fetchOne(ranked[i])
      i++
    }, 300)

    return () => { cancelled = true; clearInterval(id) }
    // refreshTick re-runs the effect every 3 min when active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, ranked, refreshTick])

  const activityStatus = (a) => {
    if (!a?.loaded) return { label: '…', cls: '' }
    // X-Dash didn't return anything AND we couldn't resolve a handle —
    // genuinely no signal. Distinct from 'silent' (handle known, no posts).
    if (!a.xdashCovered && !a.handle) return { label: t('watchlists.analysis.activity.noData', 'no data'), cls: 'wla-muted' }
    if (a.official7d == null) {
      return a.handle
        ? { label: t('watchlists.analysis.activity.untracked', 'untracked'), cls: 'wla-muted' }
        : { label: t('watchlists.analysis.activity.noData', 'no data'), cls: 'wla-muted' }
    }
    if (a.official7d === 0) {
      // Without a known project handle, "silent" is a false claim — we have
      // no way to identify the project's own tweets in the mention stream.
      // The label downgrades to "untracked" so we don't bear-flag tokens
      // that may well be posting daily under a handle X-Dash never learned.
      if (!a.handle) return { label: t('watchlists.analysis.activity.untracked', 'untracked'), cls: 'wla-muted' }
      return { label: t('watchlists.analysis.activity.silent', 'silent'), cls: 'bear' }
    }
    if (a.official7d >= 14) return {
      label: t('watchlists.analysis.activity.dailyPlus', '{{count}} · daily+', { count: a.official7d }),
      cls: 'bull',
    }
    if (a.official7d >= 7) return {
      label: t('watchlists.analysis.activity.daily', '{{count}} · daily', { count: a.official7d }),
      cls: 'bull',
    }
    return {
      label: t('watchlists.analysis.activity.posts', '{{count}} posts', { count: a.official7d }),
      cls: '',
    }
  }

  const coverage = useMemo(() => {
    const loaded = ranked.filter((t) => activity[(t.symbol || '').toUpperCase()]?.loaded).length
    const covered = ranked.filter((t) => activity[(t.symbol || '').toUpperCase()]?.xdashCovered).length
    return { loaded, covered, total: ranked.length }
  }, [activity, ranked])

  return (
    <div className="wla-activity-row">
      <div className="wla-card">
        <div className="wla-card-head">
          <span className="wla-card-title">
            {t('watchlists.analysis.activity.teamActivity', 'Team activity')}
            <span className={`wla-xdash-pill ${coverage.covered > 0 ? 'live' : 'empty'}`}>
              <span className="wla-xdash-dot" />
              {t('watchlists.analysis.activity.xdashCoverage', 'X-Dash {{covered}}/{{total}}', { covered: coverage.covered, total: coverage.total })}
              {coverage.loaded === 0 ? ' …' : ''}
            </span>
          </span>
          <span className="wla-card-meta">{t('watchlists.analysis.activity.officialMeta', 'official tweets · 7d')}</span>
        </div>
        <ul className="wla-list wla-list-scroll">
          {ranked.map((token) => {
            const a = activity[(token.symbol || '').toUpperCase()]
            const status = activityStatus(a)
            return (
              <li className="wla-row wla-row-3col" key={`act-${token.id}`}>
                <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
                <span className={`wla-row-chg ${status.cls}`}>{status.label}</span>
                <span className="wla-row-meta">
                  {a?.loaded && a.lastOfficialAt
                    ? t('watchlists.analysis.activity.lastSeen', 'last {{ago}}', { ago: formatAgo(a.lastOfficialAt, t) })
                    : ''}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="wla-card">
        <div className="wla-card-head">
          <span className="wla-card-title">{t('watchlists.analysis.activity.mentionPulse', 'Mention pulse')}</span>
          <span className="wla-card-meta">{t('watchlists.analysis.activity.mentionMeta', 'X-Dash · community · 7d')}</span>
        </div>
        <ul className="wla-list wla-list-scroll">
          {ranked.map((token) => {
            const a = activity[(token.symbol || '').toUpperCase()]
            return (
              <li className="wla-row wla-row-pulse" key={`men-${token.id}`}>
                <span className="wla-row-sym" style={getTokenRowStyle(token.symbol)}>{token.symbol}</span>
                <MentionSpark trend={a?.trend} />
                <span className="wla-row-chg">
                  {a?.loaded
                    ? (Number.isFinite(a.mentions7d) ? fmtCompact(a.mentions7d) : '—')
                    : '…'}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ─── Mini mention sparkline (inline 7d trend) ─────────────────────────
function MentionSpark({ trend }) {
  if (!Array.isArray(trend) || trend.length < 2) {
    return <span className="wla-row-spark wla-row-spark-empty" aria-hidden="true" />
  }
  const w = 56
  const h = 14
  const min = Math.min(...trend)
  const max = Math.max(...trend)
  const range = max - min || 1
  const pts = trend.map((v, i) => {
    const x = (i / (trend.length - 1)) * w
    const y = h - 1 - ((v - min) / range) * (h - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const isUp = trend[trend.length - 1] > trend[0]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="wla-row-spark" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={isUp ? '#10B981' : '#EF4444'}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Common project handles for top assets — first guess before dossier lookup.
const HANDLE_HINTS = {
  BTC: 'Bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'BNBCHAIN',
  XRP: 'Ripple', ADA: 'Cardano', DOGE: 'dogecoin', AVAX: 'avalancheavax',
  LINK: 'chainlink', DOT: 'Polkadot', ARB: 'arbitrum', OP: 'Optimism',
  MATIC: '0xPolygon', UNI: 'Uniswap', AAVE: 'aave', TIA: 'CelestiaOrg',
  SUI: 'SuiNetwork', SEI: 'SeiNetwork', APT: 'Aptos', PEPE: 'pepecoineth',
  WIF: 'dogwifcoin', ONDO: 'OndoFinance', JUP: 'JupiterExchange',
  PYTH: 'PythNetwork', JTO: 'jito_sol', RNDR: 'rendernetwork',
  TAO: 'opentensor', FET: 'Fetch_ai', NEAR: 'NEARProtocol',
  ATOM: 'cosmos', FIL: 'Filecoin', INJ: 'Injective_', LDO: 'LidoFinance',
  MKR: 'MakerDAO', CRV: 'CurveFinance', SHIB: 'Shibtoken',
}

// Internal Spectre tokens (not on CoinGecko) — explicit handle map so the
// team-activity row resolves to the right account when X-Dash has no entry.
const SPECTRE_TOKEN_HANDLES = {
  SPECTRE: 'SpectreAI_',
}

// In-session cache of resolved X-Dash keys. The search endpoint costs an
// extra round-trip per token, so cache aggressively.
const _xdashKeyCache = new Map()

// X-Dash indexes by CoinGecko slug, not symbol. ZBCN → "zebec-network",
// FARTCOIN → "fartcoin", PAAL → "paal-ai", SPECTRE → "spectre-ai", and so
// on. Symbol-lower-cased is a coincidental hit at best. Use the X-Dash
// search endpoint to translate a watchlist token to its canonical X-Dash
// key + the project's actual Twitter handle (which the search response
// also returns directly — no more handle guessing).
async function resolveXDashToken(token, knownHandle = null) {
  const upper = (token.symbol || '').toUpperCase()
  const lower = (token.symbol || '').toLowerCase()
  const cacheKey = `${upper}|${token.cgId || ''}|${token.address || ''}|${knownHandle || ''}`
  if (_xdashKeyCache.has(cacheKey)) return _xdashKeyCache.get(cacheKey)

  // Direct attempts first — usually a hit for majors and any token that
  // has a known cgId via the resolve flow.
  const directCandidates = [
    token.cgId,
    SYMBOL_TO_COINGECKO_ID[upper],
  ].filter(Boolean)

  for (const key of directCandidates) {
    const result = await probeXDashKey(key)
    if (result) {
      // Carry the pre-resolved handle (from CG metadata) into the cached
      // entry — that's the authoritative source.
      const entry = { key, handle: knownHandle || null, ...result }
      _xdashKeyCache.set(cacheKey, entry)
      return entry
    }
  }

  // Search fallback — query by both symbol AND name, merge results, pick
  // the best match. X-Dash search returns symbol, chain, cg_id, AND
  // handle in each row, so this single call resolves everything we need.
  const queries = [upper, token.name].filter(Boolean)
  const seenKeys = new Set()
  const candidatesList = []
  for (const q of queries) {
    try {
      const res = await fetch(
        `/api/xdash/search?q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(7000) },
      )
      if (!res.ok) continue
      const data = await res.json().catch(() => null)
      const list = Array.isArray(data?.tokens) ? data.tokens : []
      for (const row of list) {
        const tk = row?.token
        if (!tk) continue
        const key = tk.cg_id || tk.token_id
        if (!key || seenKeys.has(key)) continue
        seenKeys.add(key)
        candidatesList.push(tk)
      }
    } catch { /* try next query */ }
  }

  if (candidatesList.length) {
    // Rank candidates: exact symbol match > matching chain > exact name match > first
    const want = upper
    const wantChain = String(token.chain || '').toLowerCase()
    const scored = candidatesList.map((tk) => {
      const sym = String(tk.symbol || '').toUpperCase()
      const name = String(tk.name || '').toLowerCase()
      const chain = String(tk.chain || '').toLowerCase()
      let score = 0
      if (sym === want) score += 100
      if (wantChain && chain === wantChain) score += 40
      if (name === String(token.name || '').toLowerCase()) score += 30
      // Prefer entries that have a known handle — those are tracked by X-Dash
      if (tk.handle) score += 10
      return { tk, score }
    }).sort((a, b) => b.score - a.score)
    const best = scored[0]?.tk
    if (best) {
      const xKey = best.cg_id || best.token_id
      const found = {
        key: xKey,
        handle: knownHandle || best.handle || null,
        name: best.name,
        chain: best.chain,
      }
      _xdashKeyCache.set(cacheKey, found)
      return found
    }
  }

  // Last resort — try the symbol slug. Some on-chain tokens (zigcoin etc.)
  // genuinely have no X-Dash coverage; that's fine — we cache the miss too.
  const result = await probeXDashKey(lower)
  if (result) {
    const found = { key: lower, handle: knownHandle || null, ...result }
    _xdashKeyCache.set(cacheKey, found)
    return found
  }
  _xdashKeyCache.set(cacheKey, null)
  return null
}

async function probeXDashKey(key) {
  if (!key) return null
  try {
    const res = await fetch(
      `/api/xdash/token/${encodeURIComponent(key)}?author_scope=all&per_page=20`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    // X-Dash returns `{ error: "Unknown token: <key>" }` for misses.
    // ANY other 200 response means the key resolved — even when mentions
    // and top_mentions arrays are empty (the token genuinely has no
    // recent activity). Previously we rejected empty responses, which
    // forced a search loop for inactive but legitimately-existing tokens.
    if (data?.error || data?.code === 'NOT_FOUND') return null
    // Server proxy returns `_source: 'fallback'` when the upstream X-Dash
    // service is unreachable or doesn't track the token — empty mentions,
    // empty authors. Treating that as a "resolved" key made the watchlist
    // panel say "silent" for every untracked token; correct call is "no
    // data". Reject the synthetic fallback shape here.
    if (data?._source === 'fallback') return null
    return { keyConfirmed: true }
  } catch { return null }
}

// Pull a full 7-day window of mentions for one token. Bucket community vs
// official via match.matched_by, return per-day counts for the sparkline.
async function fetchXDashTokenData(token, knownHandle = null) {
  const resolved = await resolveXDashToken(token, knownHandle)
  if (!resolved) return null

  try {
    const res = await fetch(
      `/api/xdash/token/${encodeURIComponent(resolved.key)}?author_scope=all&per_page=100`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (!data) return null
    // Same fallback-shape guard as probeXDashKey — without this we report
    // legitimate untracked tokens as "silent / 0 posts" instead of "no data".
    if (data._source === 'fallback') return null

    const all = [
      ...(Array.isArray(data?.mentions) ? data.mentions : []),
      ...(Array.isArray(data?.top_mentions) ? data.top_mentions : []),
    ]
    const seen = new Set()
    const unique = []
    for (const m of all) {
      const id = m?.tweet?.tweet_id
      if (!id || seen.has(id)) continue
      seen.add(id)
      unique.push(m)
    }

    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

    const projectHandle = (resolved.handle || '').toLowerCase()
    const isOfficial = (m) => {
      const mb = Array.isArray(m?.match?.matched_by) ? m.match.matched_by : []
      const role = String(m?.match?.role || '').toLowerCase()
      if (mb.includes('official') || mb.includes('self') || role === 'official' || role === 'self') return true
      // X-Dash search gives us the canonical handle for the project — any
      // mention authored by that handle is by definition the project itself.
      const author = String(m?.author?.screen_name || '').toLowerCase()
      return projectHandle && author === projectHandle
    }
    const inWindow = (m) => {
      const ts = Date.parse(m?.tweet?.created_at_utc || 0)
      return Number.isFinite(ts) && ts >= sevenDaysAgo
    }

    const recent = unique.filter(inWindow)
    const officialAll = unique.filter(isOfficial)
    const officialRecent = recent.filter(isOfficial)
    const communityRecent = recent.filter((m) => !isOfficial(m))

    const lastOfficialAt = officialRecent[0]?.tweet?.created_at_utc
      || officialAll[0]?.tweet?.created_at_utc
      || null

    const buckets = new Array(7).fill(0)
    for (const m of communityRecent) {
      const ts = Date.parse(m.tweet.created_at_utc)
      const ageDays = Math.floor((now - ts) / (24 * 60 * 60 * 1000))
      const idx = 6 - Math.max(0, Math.min(6, ageDays))
      buckets[idx]++
    }

    // Mention totals from /v1/totals if present — gives us 24h vs prior
    // delta for a momentum indicator. Optional.
    const totals = data?.totals || {}

    return {
      official7d: officialRecent.length,
      lastOfficialAt,
      officialHandle: resolved.handle || officialAll[0]?.author?.screen_name || null,
      mentions7d: communityRecent.length,
      mentions24h: Number(totals.external_mentions_24h) || communityRecent.filter((m) => {
        const ts = Date.parse(m.tweet.created_at_utc)
        return Number.isFinite(ts) && (now - ts) < 24 * 60 * 60 * 1000
      }).length,
      trend: buckets,
    }
  } catch {
    return null
  }
}

// ─── Top-level panel ─────────────────────────────────────────────────
export default function WatchlistAnalysisPanel({
  tokens = [],
  isActive = true,
  holdings = null,
  onAddHoldings,
  onConnectWallet,
}) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  // Bound currency-aware large-number formatter. Replaces the hand-rolled
  // `$T/B/M/K` helper that bypassed the user's selected currency.
  const fmtUsd = fmtLargeShort
  const [grouping, setGrouping] = useState('token')
  // Lazy CoinGecko-detail enrichment: twitterHandle, categories, scores per
  // token. Drives sector grouping in the donut, sector-aware suggestions,
  // and authoritative handle resolution for X-Dash team-activity lookup.
  const metadata = useTokenMetadata(tokens, isActive)

  const allocation = useMemo(() => {
    if (!tokens.length) return { items: [], total: 0 }
    const bucket = new Map()
    let total = 0
    for (const token of tokens) {
      const v = Number(token.mcap) || 0
      if (v <= 0) continue
      const k = token.symbol || '?'
      bucket.set(k, (bucket.get(k) || 0) + v)
      total += v
    }
    return {
      total,
      items: [...bucket.entries()]
        .map(([label, value]) => ({ label, value, pct: total > 0 ? (value / total) * 100 : 0 }))
        .sort((a, b) => b.value - a.value),
    }
  }, [tokens])

  if (tokens.length === 0) {
    return (
      <div className="wla-empty-state">
        {t('watchlists.analysis.emptyState', 'Add tokens to your watchlist to see allocation, mover, and team-activity analytics.')}
      </div>
    )
  }

  // Single source of truth for "do we have meaningful 7d data" — used to
  // hide / suppress 7d annotations across child blocks so we don't paint
  // half-populated columns of dashes.
  const sevenDayCoverage = useMemo(() => {
    if (!tokens.length) return 0
    const has = tokens.filter((token) =>
      Number.isFinite(Number(token.change1w)) || Number.isFinite(Number(token.change7d))
    ).length
    return has / tokens.length
  }, [tokens])

  return (
    <div className="wla-panel">
      <PortfolioCard
        holdings={holdings}
        onAddHoldings={onAddHoldings}
        onConnectWallet={onConnectWallet}
        t={t}
        fmtUsd={fmtUsd}
      />
      <div className="wla-top-row">
        <WatchlistComposition tokens={tokens} grouping={grouping} onGroupingChange={setGrouping} metadata={metadata} t={t} fmtUsd={fmtUsd} />
        <PulseStats tokens={tokens} t={t} fmtUsd={fmtUsd} />
      </div>
      <Suggestions tokens={tokens} allocation={allocation} metadata={metadata} t={t} />
      <MoversBlock tokens={tokens} sevenDayCoverage={sevenDayCoverage} t={t} />
      <PerformanceScoreboard tokens={tokens} t={t} />
      <ActivityBlock tokens={tokens} isActive={isActive} metadata={metadata} t={t} />
    </div>
  )
}
