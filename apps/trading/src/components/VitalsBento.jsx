/**
 * VitalsBento — the right-rail "living vitals" panel.
 *
 * Replaces the flat 5-stat label-over-number grid that the OL Phase-1
 * brief flagged as the largest miss on the page. Five tiles, each
 * pairing a mono value with a visual that ENCODES the value:
 *
 *   ┌─────────────────────────────┐
 *   │  MARKET CAP   (hero)         │  Odometer + DeltaChip + All-time Sparkline
 *   ├──────────────┬──────────────┤
 *   │  LIQUIDITY   │  CIRC. SUPPLY │  RadialGauge   |  DonutChart
 *   ├──────────────┼──────────────┤
 *   │  24H VOLUME  │  HOLDERS      │  MicroBars 24h |  Sparkline + arrow
 *   └──────────────┴──────────────┘
 *
 * Data feasibility honored:
 *  - All-time MCap series = derived from Codex daily bars (capped to getBars'
 *    ~3y max single-call window) × current supply
 *    (notes: static supply caveat, never faked)
 *  - 24h volume bars = derived from Codex 1H bars; color by close-vs-open
 *    (per-hour buy/sell split is not available)
 *  - Holders growth + top-10 concentration = waiting on §II.9 backend
 *    addition; until then we show count only, no fabricated series.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  Sparkline,
  Odometer,
  DeltaChip,
  RadialGauge,
  DonutChart,
  MicroBars,
  DataBarRow,
} from './ui/viz'
import { getBars } from '../services/codexApi'
import { whenIdle } from '../utils/whenIdle'
import useDossier from '../hooks/useDossier'
import useHoldersChart from '../hooks/useHoldersChart'
import './VitalsBento.css'

// --- Time-series caches -----------------------------------------------------
// Per the perf contract: no new continuous rAF, no new polling — these are
// fire-and-fetch with conservative TTLs and shared across mounts so token
// switches reuse data when possible.

const _mcapSeriesCache = {}     // { [addr]: { closes: number[], ts: number } }
const _hourlyVolCache = {}      // { [addr]: { bars: [{volume, up}], ts: number } }
const MCAP_TTL = 10 * 60_000    // 10 min (daily bars change infrequently)
const HOURLY_TTL = 5 * 60_000   // 5 min (hourly bars roll every ~hour)

async function fetchMcapSeries(address, networkId) {
  const key = (address || '').toLowerCase()
  const cached = _mcapSeriesCache[key]
  if (cached && Date.now() - cached.ts < MCAP_TTL) return cached.closes
  try {
    const now = Math.floor(Date.now() / 1000)
    // All-time preview: request the widest window getBars serves in one call.
    // getBars clamps anything over ~3y to the trailing 3y (MAX_BARS_RANGE_SEC),
    // so for the DEX/long-tail tokens this page mostly shows (younger than 3y)
    // Codex returns the full genesis-to-now history; majors show the last 3y.
    const from = now - 3 * 365 * 86400
    const result = await getBars(address, '1D', from, now, networkId)
    const bars = result?.getBars || []
    const closes = bars
      .map((b) => parseFloat(b.close ?? b.c ?? 0))
      .filter((p) => p > 0)
    if (closes.length < 2) return null
    _mcapSeriesCache[key] = { closes, ts: Date.now() }
    return closes
  } catch {
    return null
  }
}

async function fetchHourlyVolumeBars(address, networkId) {
  const key = (address || '').toLowerCase()
  const cached = _hourlyVolCache[key]
  if (cached && Date.now() - cached.ts < HOURLY_TTL) return cached.bars
  try {
    const now = Math.floor(Date.now() / 1000)
    const from = now - 24 * 3600
    const result = await getBars(address, '60', from, now, networkId)
    const bars = (result?.getBars || [])
      .map((b) => ({
        volume: parseFloat(b.volume ?? b.v ?? 0) || 0,
        up: parseFloat(b.close ?? b.c ?? 0) >= parseFloat(b.open ?? b.o ?? 0),
      }))
      .filter((b) => b.volume >= 0)
    if (bars.length < 2) return null
    _hourlyVolCache[key] = { bars, ts: Date.now() }
    return bars
  } catch {
    return null
  }
}

// --- Helpers ----------------------------------------------------------------

function liquidityVerdict(ratio) {
  if (!ratio || isNaN(ratio)) return { grade: '—', verdict: 'No data' }
  if (ratio >= 0.10) return { grade: 'A', verdict: 'Deep' }
  if (ratio >= 0.05) return { grade: 'B', verdict: 'Healthy' }
  if (ratio >= 0.02) return { grade: 'C', verdict: 'Moderate' }
  if (ratio >= 0.005) return { grade: 'D', verdict: 'Thin' }
  return { grade: 'F', verdict: 'Risky' }
}

function liquidityColor(ratio) {
  if (!ratio || isNaN(ratio)) return 'var(--neutral)'
  if (ratio >= 0.05) return 'var(--accent)'
  if (ratio >= 0.02) return '#F59E0B' // amber
  return 'var(--down)'
}

function formatLarge(value) {
  if (value == null || isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9)  return (value / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6)  return (value / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3)  return (value / 1e3).toFixed(2) + 'K'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

// --- Component --------------------------------------------------------------

function VitalsBento({
  token,
  marketCap,
  realChange24,
  realLiquidity,
  circulatingSupply,
  totalSupply,
  volume24,
  holders,
  tokenLoading,
  isCoinGeckoSource = false,
  currentPrice = 0,
  low24 = 0,
  high24 = 0,
  ath = 0,
  athChangePct = null,
  athDate = null,
}) {
  const address = token?.address
  const networkId = token?.networkId || 1

  const [mcapCloses, setMcapCloses] = useState(null)
  const [hourlyBars, setHourlyBars] = useState(null)

  // Top-10 holder concentration sub-bar — still backed by the dossier
  // payload's `holders.top10Pct`. Codex doesn't expose this and the
  // onchain endpoint only returns top-N rows, not aggregated %, so
  // this stays null for most tokens until a dedicated top-holders
  // aggregator lands. Caller hides the sub-bar when null.
  const { data: dossier } = useDossier(token)
  const top10Pct = typeof dossier?.holders?.top10Pct === 'number'
    ? dossier.holders.top10Pct
    : null

  // 14-day holder count series — switched 2026-05-28 from the dossier
  // (which has `holders: null` for almost every token) to the Spectre
  // onchain API exposed via Express at /api/onchain/.../holders/chart.
  // EVM-only; Solana short-circuits to empty data (sparkline hidden,
  // count rendered cleanly). See `useHoldersChart` doc-comment for the
  // Cloudflare-bot-block gotcha when testing from a terminal.
  // Sparkline expects a flat number[] — map { t, v } points to v only.
  const { data: holderPoints } = useHoldersChart(address, networkId, { bucket: '1d', limit: 14 })
  const holderHistory14d = holderPoints && holderPoints.length >= 2
    ? holderPoints.map(p => p.v)
    : null

  // Count fallback: prod's details path dropped `holders` from the Codex
  // selection (LEVER 3 cost pass, 2026-06-02) and backfills from the Hetzner
  // helper, which misses long-tail tokens - the count renders 0 there while
  // the onchain series (fetched browser-direct, free) has the real number.
  // Use the newest series point when details give us nothing.
  const lastSeriesCount = holderPoints && holderPoints.length > 0
    ? holderPoints[holderPoints.length - 1].v
    : 0
  const displayHolders = holders || lastSeriesCount

  // Fetch 30d MCap series + 24h volume bars when token changes. DEFERRED
  // 1.5s + idle: these two below-banner tiles used to fire at click time and
  // contend with the chart's critical bars fetch on the browser's connection
  // pool (dev HTTP/1.1 especially). Module caches (10/5min) keep re-visits
  // instant regardless of the defer.
  useEffect(() => {
    // Clear before the guard - RightPanel is no longer remounted per token
    // (App.jsx dropped its `key`), so an address-less token would otherwise
    // keep painting the previous token's mcap / volume series.
    setMcapCloses(null)
    setHourlyBars(null)
    if (!address) return
    let cancelled = false
    let cancelIdle = null
    const timer = setTimeout(() => {
      if (cancelled) return
      cancelIdle = whenIdle(() => {
        if (cancelled) return
        fetchMcapSeries(address, networkId).then((closes) => {
          if (!cancelled) setMcapCloses(closes)
        })
        fetchHourlyVolumeBars(address, networkId).then((bars) => {
          if (!cancelled) setHourlyBars(bars)
        })
      })
    }, 1500)
    return () => { cancelled = true; clearTimeout(timer); if (cancelIdle) cancelIdle() }
  }, [address, networkId])

  // Derive the MCap series = close × circulating supply.
  // Caveat documented in code: static supply means inflationary periods
  // will render a phantom move — but most tokens are fixed-supply.
  // Memoized so Sparkline's React.memo prop-equality holds.
  const mcapSeries = useMemo(() => {
    if (!mcapCloses || !(circulatingSupply > 0)) return null
    return mcapCloses.map((c) => c * circulatingSupply)
  }, [mcapCloses, circulatingSupply])

  const liquidityRatio = marketCap > 0 ? (realLiquidity || 0) / marketCap : 0
  const liqVerdict = liquidityVerdict(liquidityRatio)
  const liqColor = liquidityColor(liquidityRatio)

  const supplyRatio = totalSupply > 0 && circulatingSupply > 0
    ? Math.min(1, circulatingSupply / totalSupply)
    : null

  // Memoized — MicroBars is React.memo'd and would otherwise re-render
  // each parent tick.
  const volumeBars = useMemo(() => {
    if (!hourlyBars) return null
    return hourlyBars.map((b, i) => ({
      value: b.volume,
      color: b.up ? 'var(--up)' : 'var(--down)',
      live: i === hourlyBars.length - 1,
    }))
  }, [hourlyBars])

  // ── Major-coin (CoinGecko) tile data ──────────────────────────────────────
  // 24h Range replaces the on-chain Liquidity gauge; From-ATH replaces Holders.
  // Both null when the source lacks them (then the tile shows a clean N/A).
  const priceLabel = (n) => {
    const v = Number(n)
    if (!v || !isFinite(v)) return '-'
    if (v >= 1) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
    return '$' + v.toPrecision(4)
  }
  const range24 = (low24 > 0 && high24 > 0 && high24 > low24) ? {
    low: low24,
    high: high24,
    current: currentPrice || low24,
    pct: Math.max(0, Math.min(100, (((currentPrice || low24) - low24) / (high24 - low24)) * 100)),
  } : null
  const athChg = (athChangePct != null && isFinite(athChangePct))
    ? { text: `${athChangePct >= 0 ? '+' : ''}${athChangePct.toFixed(1)}%`, cls: athChangePct >= 0 ? 'up' : 'down' }
    : null
  const athDateLabel = (() => {
    if (!athDate) return ''
    try { return new Date(athDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
  })()

  return (
    <div className={`vitals-bento ${tokenLoading ? 'is-loading' : ''}`}>
      {/* Tile 1 — MCap hero (full width) */}
      <article className="vt vt--hero">
        <header className="vt-head">
          <span className="vt-label">Market Cap</span>
          {realChange24 != null && Math.abs(realChange24) >= 0.01 && (
            <span className="vt-delta-group">
              <span className="vt-tf-tag">1D</span>
              <DeltaChip value={realChange24} decimals={2} size="md" />
            </span>
          )}
        </header>
        <div className="vt-hero-value">
          <Odometer value={marketCap || 0} prefix="$" decimals={2} />
        </div>
        <div className="vt-hero-spark">
          {mcapSeries ? (
            <Sparkline
              data={mcapSeries}
              width={320}
              height={56}
              stroke="var(--accent)"
              fill="gradient"
              strokeWidth={1.4}
            />
          ) : (
            <span className="vt-empty">Series unavailable</span>
          )}
        </div>
      </article>

      {/* Tile 2 — Liquidity gauge (on-chain) / 24h Range (CoinGecko majors,
          which have no DEX pool to gauge). */}
      <article className="vt vt--liquidity">
        {isCoinGeckoSource ? (
          <>
            <header className="vt-head">
              <span className="vt-label">24h Range</span>
              {range24 && <span className="vt-eyebrow">{Math.round(range24.pct)}%</span>}
            </header>
            {range24 ? (
              <div className="vt-range">
                <span className="vt-range-now">{priceLabel(range24.current)}</span>
                <div className="vt-range-track">
                  <span className="vt-range-fill" style={{ width: `${range24.pct}%` }} />
                  <span className="vt-range-dot" style={{ left: `${range24.pct}%` }} />
                </div>
                <div className="vt-range-ends">
                  <span>{priceLabel(range24.low)}</span>
                  <span>{priceLabel(range24.high)}</span>
                </div>
              </div>
            ) : (
              <div className="vt-na-block"><span className="vt-na-value">N/A</span></div>
            )}
          </>
        ) : (
          <>
            <header className="vt-head">
              <span className="vt-label">Liquidity</span>
              <span className="vt-eyebrow">{liqVerdict.grade}</span>
            </header>
            <div className="vt-gauge-wrap">
              <RadialGauge
                value={Math.min(1, liquidityRatio * 5)}
                size={108}
                thickness={9}
                zones={[
                  { to: 0.10, color: 'var(--down)' },
                  { to: 0.25, color: '#F59E0B' },
                  { to: 1.00, color: 'var(--accent)' },
                ]}
                centerValue={'$' + formatLarge(realLiquidity || 0)}
                centerLabel={liqVerdict.verdict}
              />
            </div>
            <footer className="vt-foot">
              <span className="vt-foot-label">Liq / MCap</span>
              <span className="vt-foot-value" style={{ color: liqColor }}>
                {liquidityRatio > 0 ? (liquidityRatio * 100).toFixed(2) + '%' : '—'}
              </span>
            </footer>
          </>
        )}
      </article>

      {/* Tile 3 — Circulating supply donut */}
      <article className="vt vt--supply">
        <header className="vt-head">
          <span className="vt-label">Circ. Supply</span>
          {supplyRatio != null && (
            <span className="vt-eyebrow">{Math.round(supplyRatio * 100)}%</span>
          )}
        </header>
        <div className="vt-donut-wrap">
          <DonutChart
            size={108}
            thickness={10}
            segments={
              supplyRatio != null
                ? [
                    { value: supplyRatio, color: 'var(--accent)', label: 'Circulating' },
                    { value: 1 - supplyRatio, color: 'var(--glass-fill)', label: 'Locked' },
                  ]
                : circulatingSupply > 0
                  ? [{ value: 1, color: 'var(--accent)', label: 'Circulating' }]
                  : []
            }
          >
            <span className="donut-core-value">{formatLarge(circulatingSupply || 0)}</span>
            <span className="donut-core-label">
              {totalSupply > 0 ? `of ${formatLarge(totalSupply)}` : 'tokens'}
            </span>
          </DonutChart>
        </div>
        {!totalSupply && circulatingSupply > 0 && (
          <footer className="vt-foot vt-foot--note">
            <span className="vt-foot-value">Max supply unknown</span>
          </footer>
        )}
      </article>

      {/* Tile 4 — 24h volume hourly histogram */}
      <article className="vt vt--volume">
        <header className="vt-head">
          <span className="vt-label">24h Volume</span>
          <span className="vt-eyebrow">24×1H</span>
        </header>
        <div className="vt-volume-value">
          <Odometer value={volume24 || 0} prefix="$" decimals={2} />
        </div>
        <div className="vt-bars-wrap">
          {volumeBars && volumeBars.length > 0 ? (
            <MicroBars data={volumeBars} width={210} height={40} />
          ) : (
            <span className="vt-empty">Hourly bars unavailable</span>
          )}
        </div>
      </article>

      {/* Tile 5 — Holders. Spark + concentration light up when the §II.9
          dossier payload includes them; otherwise degrade to count only. */}
      <article className="vt vt--holders">
        <header className="vt-head">
          <span className="vt-label">{isCoinGeckoSource ? 'All-Time High' : 'Holders'}</span>
          {!isCoinGeckoSource && <span className="vt-eyebrow">14d</span>}
        </header>
        {isCoinGeckoSource ? (
          // CoinGecko has no on-chain holder count; show the asset's All-Time
          // High + how far below it the price sits (useful context for a major).
          ath > 0 ? (
            <div className="vt-ath">
              <span className="vt-ath-price">{priceLabel(ath)}</span>
              <div className="vt-ath-sub">
                {athChg && <span className={`vt-ath-chg vt-ath-chg--${athChg.cls}`}>{athChg.text} from ATH</span>}
                {athDateLabel && <span className="vt-ath-date">{athDateLabel}</span>}
              </div>
            </div>
          ) : (
            <div className="vt-holders-value"><span className="vt-na-value">N/A</span></div>
          )
        ) : (
          <>
            <div className="vt-holders-value">
              {/* Always render the full holder count (e.g. 8,239) instead of
                  the abbreviated 8K form — Gleb explicitly wants precision
                  for this metric, not a glanceable rounding. */}
              <Odometer value={displayHolders || 0} decimals={0} raw={true} />
            </div>
            <div className="vt-holders-spark">
              {holderHistory14d && holderHistory14d.length >= 2 ? (
                <Sparkline
                  data={holderHistory14d}
                  width={170}
                  height={28}
                  stroke={
                    holderHistory14d[holderHistory14d.length - 1] >= holderHistory14d[0]
                      ? 'var(--up)' : 'var(--down)'
                  }
                  fill="gradient"
                  strokeWidth={1.3}
                />
              ) : (
                <span className="vt-empty">Series pending</span>
              )}
            </div>
            {top10Pct != null && top10Pct >= 0 && (
              <DataBarRow
                value={top10Pct}
                tint={top10Pct > 0.5 ? 'coral' : 'lime'}
                className="vt-holders-conc"
              >
                <span className="vt-foot-label">Top 10</span>
                <span className="vt-foot-value">{Math.round(top10Pct * 100)}%</span>
              </DataBarRow>
            )}
          </>
        )}
      </article>
    </div>
  )
}

export default React.memo(VitalsBento)
