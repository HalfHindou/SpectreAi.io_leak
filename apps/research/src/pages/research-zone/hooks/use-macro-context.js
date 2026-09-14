/**
 * use-macro-context — market-wide backdrop for the Technicals tab macro box.
 *
 * Deterministic and honest: every number comes from a live endpoint the app
 * already caches (fear & greed, dominance, alt season, BTC daily bars). No
 * LLM call, no new backend route — composition happens client-side, so this
 * works identically in dev and prod.
 *
 * Returns { loading, data } where data:
 *   fg        { value, label, delta7d }
 *   dominance { btc, eth, delta7d }          — BTC dominance % + 7d change (pts)
 *   altSeason { value, label }               — 0..100
 *   btcTrend  { above200d, distPct }         — BTC close vs its 200D EMA
 *   regime    'risk-on' | 'neutral' | 'risk-off'
 *   read      composed 2-3 sentence macro read
 */
import { useState, useEffect } from 'react'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import {
  getSpectreGlobalMarket,
  getSpectreAltSeason,
  getSpectreDominanceHistory,
  getSpectreFearGreedHistory,
} from '@/services/spectreMarketApi'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { fetchSeriesBars } from './use-kline-indicators'

// ── Alt-season index, computed CLIENT-SIDE ───────────────────────────────────
// The data-api /market/alt-season counts stablecoins and missing-30d rows as
// "beating BTC", which inflates the index (Sunny 2026-07-02: "alt season is
// not 58 for sure, we are in alt bear market"). The server fix exists on
// branch fix/alt-season-index but was never deployed to Hetzner. Until it
// ships, compute the honest number here from the cached top-coins page:
// % of the top 50 REAL alts (no stables/pegs/wrappers) beating BTC over 30d.
const STABLE_OR_WRAPPED = /^(usdt|usdc|dai|usde|usds|fdusd|tusd|pyusd|usdd|usdp|frax|lusd|gusd|eurc|eurt|usdy|usdx|susds|susde|buidl|wbtc|wbt|weth|wsteth|steth|weeth|cbbtc|cbeth|reth|rseth|ezeth|tbtc|lbtc|solvbtc|jitosol|msol|bnsol|wbnb|meth|oseth|clbtc|stbtc)$/i
const looksPegged = (c) => {
  const sym = String(c.symbol || '')
  const name = String(c.name || '').toLowerCase()
  if (STABLE_OR_WRAPPED.test(sym)) return true
  if (/(usd|stable| staked|wrapped|bridged|restaked)/.test(name)) return true
  // price pinned to ~$1 with a tiny 30d move = a stable we don't have listed
  const p = Number(c.current_price)
  const chg = Number(c.price_change_percentage_30d_in_currency)
  if (p > 0.97 && p < 1.03 && Number.isFinite(chg) && Math.abs(chg) < 2) return true
  return false
}

async function computeAltSeasonLocal() {
  // sparkline:false — this computation reads only the 30d %-change column;
  // the default sparkline payload is ~485KB vs ~90KB for the light path.
  const rows = await getTopCoinsMarketsPage(1, 100, { sparkline: false })
  const list = Array.isArray(rows) ? rows : (rows?.coins || rows?.data || [])
  if (!Array.isArray(list) || !list.length) return null
  const btc = list.find(c => String(c.symbol).toLowerCase() === 'btc' || c.id === 'bitcoin')
  const btc30 = Number(btc?.price_change_percentage_30d_in_currency)
  if (!Number.isFinite(btc30)) return null
  const alts = list
    .filter(c => c !== btc && c.id !== 'bitcoin')
    .filter(c => !looksPegged(c))
    .filter(c => Number.isFinite(Number(c.price_change_percentage_30d_in_currency)))
    .sort((a, b) => (a.market_cap_rank || 999) - (b.market_cap_rank || 999))
    .slice(0, 50)
  if (alts.length < 25) return null // not enough valid data to be honest
  const beating = alts.filter(c => Number(c.price_change_percentage_30d_in_currency) > btc30).length
  return {
    value: Math.round((beating / alts.length) * 100),
    beating,
    sample: alts.length,
    btc30,
    source: 'client-top50-30d',
  }
}

function ema(values, period) {
  if (!values || values.length < period) return null
  const k = 2 / (period + 1)
  let v = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < values.length; i++) v = values[i] * k + v * (1 - k)
  return v
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

function composeRead({ fg, dominance, altSeason, btcTrend, funding }) {
  const parts = []

  // Sentence 1 — risk appetite
  if (fg?.value != null) {
    const dir = fg.delta7d == null ? '' : fg.delta7d > 3 ? ' and rising' : fg.delta7d < -3 ? ' and falling' : ''
    parts.push(`Fear & Greed at ${Math.round(fg.value)} (${(fg.label || 'neutral').toLowerCase()})${dir}`)
  }
  if (btcTrend?.distPct != null) {
    parts.push(`BTC trades ${Math.abs(btcTrend.distPct).toFixed(1)}% ${btcTrend.above200d ? 'above' : 'below'} its 200-day trend`)
  }
  const s1 = parts.length ? parts.join('; ') + '.' : null

  // Sentence 2 — where the money is
  let s2 = null
  if (dominance?.btc != null) {
    const delta = dominance.delta7d
    const flow = delta == null ? '' : delta > 0.15 ? ' (+' + delta.toFixed(1) + 'pt/7d — money rotating into BTC, alts bleed)' : delta < -0.15 ? ' (' + delta.toFixed(1) + 'pt/7d — capital rotating out toward alts)' : ' (flat week)'
    const alt = altSeason?.value != null
      ? ` Alt-season index ${Math.round(altSeason.value)}/100 — ${altSeason.value >= 75 ? 'broad alt outperformance' : altSeason.value >= 50 ? 'alts holding their own' : 'BTC-led tape; alt breadth is weak'}.`
      : ''
    s2 = `BTC dominance ${dominance.btc.toFixed(1)}%${flow}.${alt}`
  }

  // Sentence 3 — leverage posture
  let s3 = null
  if (funding != null) {
    s3 = funding > 0.02
      ? `Funding ${funding >= 0 ? '+' : ''}${funding.toFixed(4)}% — longs pay to stay in, crowded side is long.`
      : funding < -0.02
        ? `Funding ${funding.toFixed(4)}% — shorts pay, squeeze fuel building underneath.`
        : `Funding ${funding >= 0 ? '+' : ''}${funding.toFixed(4)}% — leverage is balanced, no crowding either way.`
  }

  // Sentence 4 — cycle context on extreme fear. Panic prints are where most
  // of the market capitulates; the zoom-out states the structural condition
  // instead of amplifying the mood.
  let s4 = null
  if (fg?.value != null && fg.value <= 25 && btcTrend?.above200d != null) {
    s4 = btcTrend.above200d
      ? 'Zoom out: extreme fear while BTC holds its 200-day trend has historically been accumulation territory — let levels, not mood, drive decisions.'
      : 'Zoom out: extreme fear below the 200-day trend can persist — respect it, and wait for reclaimed levels rather than catching knives.'
  }

  return [s1, s2, s3, s4].filter(Boolean).join(' ')
}

function classifyRegime({ fg, btcTrend, dominance, altSeason }) {
  let score = 0
  let inputs = 0
  if (fg?.value != null) { inputs++; score += fg.value >= 60 ? 1 : fg.value <= 35 ? -1 : 0 }
  if (btcTrend?.above200d != null) { inputs++; score += btcTrend.above200d ? 1 : -1 }
  if (dominance?.delta7d != null) { inputs++; score += dominance.delta7d < -0.15 ? 1 : dominance.delta7d > 0.5 ? -0.5 : 0 }
  if (altSeason?.value != null) { inputs++; score += altSeason.value >= 60 ? 0.5 : 0 }
  if (!inputs) return 'neutral'
  if (score >= 1.5) return 'risk-on'
  if (score <= -1.5) return 'risk-off'
  return 'neutral'
}

// Module cache for the composed market-wide base (fg/dominance/altSeason/
// btcTrend) — the data is token-independent and slow-moving, so re-opening
// the tab (or a funding tick) must not refire the whole 7-request load.
let _baseCache = null // { bundle, ts }
let _baseInflight = null
const BASE_TTL = 120_000

async function loadMacroBase() {
  if (_baseCache && Date.now() - _baseCache.ts < BASE_TTL) return _baseCache.bundle
  if (_baseInflight) return _baseInflight
  _baseInflight = (async () => {
    const [fgCur, fgHist, global, altSeaLocal, altSeaServer, domHist, btcBars] = await Promise.allSettled([
      getFearGreedCurrent(),
      getSpectreFearGreedHistory(30),
      getSpectreGlobalMarket(),
      computeAltSeasonLocal(),
      getSpectreAltSeason(),
      // 90 days matches rz-market-context's dominance pull EXACTLY, so both
      // collapse onto one cached /global/dominance/history request. The 7d
      // delta below anchors on the row closest to 7 days back regardless.
      getSpectreDominanceHistory(90),
      fetchSeriesBars({ symbol: 'BTC', resolution: '1D', cgId: 'bitcoin', binancePair: 'BTCUSDT', barCount: 260 }),
    ])

    // Fear & Greed + 7d delta
    let fg = null
    if (fgCur.status === 'fulfilled' && fgCur.value) {
      const value = num(fgCur.value.value ?? fgCur.value.score)
      let delta7d = null
      if (fgHist.status === 'fulfilled' && Array.isArray(fgHist.value?.data) && fgHist.value.data.length > 1) {
        const pts = fgHist.value.data
          .map(p => ({ v: num(p.value ?? p.score), t: num(p.time ?? p.timestamp ?? p.ts) }))
          .filter(p => p.v != null && p.t != null)
          .sort((a, b) => a.t - b.t)
        if (pts.length > 1 && value != null) {
          const latestT = pts[pts.length - 1].t
          const weekAgo = pts.find(p => latestT - p.t <= 8 * 86400 && latestT - p.t >= 5 * 86400)
            || pts[0]
          if (weekAgo?.v != null) delta7d = value - weekAgo.v
        }
      }
      fg = value != null ? { value, label: fgCur.value.label || fgCur.value.classification || null, delta7d } : null
    }

    // Dominance + 7d delta. /v1/market/global serves the fields as
    // btc_dominance / eth_dominance (stringly) — the bare btc/eth names
    // never existed on that row, so this box read null since day one.
    let dominance = null
    if (global.status === 'fulfilled' && global.value) {
      const btc = num(global.value.btc ?? global.value.btc_dominance)
      const eth = num(global.value.eth ?? global.value.eth_dominance)
      let delta7d = null
      if (domHist.status === 'fulfilled' && Array.isArray(domHist.value) && domHist.value.length > 1) {
        const rows = [...domHist.value].sort((a, b) => a.ts - b.ts)
        const last = rows[rows.length - 1]
        const lastBtc = num(last?.btc)
        // The fetch spans further back than needed - anchor the delta on the
        // row closest to exactly 7 days back so the "7d" chip label is honest.
        const DAY = num(last?.ts) > 1e12 ? 86400_000 : 86400
        const targetTs = num(last?.ts) != null ? last.ts - 7 * DAY : null
        const first = targetTs == null ? rows[0] : rows.reduce(
          (best, r) => (Math.abs(r.ts - targetTs) < Math.abs(best.ts - targetTs) ? r : best), rows[0])
        const firstBtc = num(first?.btc)
        if (firstBtc != null && lastBtc != null) delta7d = lastBtc - firstBtc
      }
      dominance = btc != null ? { btc, eth, delta7d } : null
    }

    // Alt season — locally computed number wins (server index is inflated
    // until the fix/alt-season-index deploy); server value is fallback only.
    let altSeason = null
    if (altSeaLocal.status === 'fulfilled' && altSeaLocal.value) {
      const a = altSeaLocal.value
      altSeason = { value: a.value, beating: a.beating, sample: a.sample, source: a.source }
    } else if (altSeaServer.status === 'fulfilled' && altSeaServer.value && num(altSeaServer.value.value) != null) {
      altSeason = { value: num(altSeaServer.value.value), label: altSeaServer.value.label || null, source: 'server' }
    }

    // BTC vs 200D EMA
    let btcTrend = null
    if (btcBars.status === 'fulfilled' && Array.isArray(btcBars.value) && btcBars.value.length >= 200) {
      const closes = btcBars.value.map(b => b.c)
      const e200 = ema(closes, 200)
      const last = closes[closes.length - 1]
      if (e200 && last) {
        btcTrend = { above200d: last >= e200, distPct: ((last - e200) / e200) * 100 }
      }
    }

    const base = { fg, dominance, altSeason, btcTrend }
    _baseCache = { bundle: base, ts: Date.now() }
    return base
  })().finally(() => { _baseInflight = null })
  return _baseInflight
}

export default function useMacroContext({ enabled = true, fundingRates = null } = {}) {
  const [state, setState] = useState({ loading: true, data: null })

  // The funding chip is composed from the intel bundle's already-fetched
  // numbers — it must NOT refire the 7-request base load. The base loads once
  // per mount (module-cached 120s across mounts); this effect recomposes the
  // read/regime whenever either the base or the funding numbers change.
  const fBtcRaw = num(fundingRates?.btc)
  const fEthRaw = num(fundingRates?.eth)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    loadMacroBase()
      .then((base) => {
        if (cancelled) return
        // Both exactly 0 = the intel bundle hasn't loaded (its DEFAULTS), not
        // a real reading — omit the chip rather than show a fabricated
        // "+0.0000%". Average only the legs that exist.
        const legs = [fBtcRaw, fEthRaw].filter((v) => v != null && v !== 0)
        const funding = legs.length ? legs.reduce((a, b) => a + b, 0) / legs.length : null

        const bundle = { ...base, funding }
        const regime = classifyRegime(bundle)
        const read = composeRead(bundle)
        setState({ loading: false, data: { ...bundle, regime, read } })
      })
      .catch(() => { if (!cancelled) setState({ loading: false, data: null }) })

    return () => { cancelled = true }
    // fundingRates values (not identity) matter — key on the numbers
  }, [enabled, fBtcRaw, fEthRaw])

  return state
}
