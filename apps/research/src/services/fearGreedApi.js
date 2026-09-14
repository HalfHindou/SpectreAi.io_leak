/**
 * Fear & Greed API Service
 * Fetches via the browser-safe Spectre market bridge first. Legacy /api routes
 * stay as a fallback for any local/serverless gaps.
 * Includes in-flight deduplication, caching, and per-request timeouts.
 */

import {
  getSpectreFearGreedCurrent,
  getSpectreFearGreedHistory,
  getSpectreGlobalMetrics,
  getSpectreTokenChart,
  getSpectreTokenMovers,
  toUnixSecondsString,
} from '@/services/spectreMarketApi'

// Client-side cache
const _cache = {};
// In-flight request deduplication
const _inflight = {};

function _getCached(key, ttlMs) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) {
    delete _cache[key];
    return null;
  }
  return entry.data;
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() };
}

const CURRENT_TTL = 30 * 1000;          // 30s — real-time
const HISTORY_TTL = 30 * 60 * 1000;     // 30 min — slow-moving
const GLOBAL_TTL = 30 * 1000;           // 30s — real-time
const MOVERS_TTL = 30 * 1000;           // 30s — real-time
const BTC_CHART_TTL = 5 * 60 * 1000;    // 5 min — moderate
const THESIS_TTL = 30 * 60 * 1000;      // 30 min — matches server cache, save API calls

const FETCH_TIMEOUT = 15000; // 15s timeout

async function _fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Deduplicated fetch — returns cached data, joins in-flight request, or starts new one.
 * No abort signal — completed requests populate the cache for all consumers.
 */
function _deduped(cacheKey, ttlMs, url) {
  const cached = _getCached(cacheKey, ttlMs);
  if (cached) return Promise.resolve(cached);

  if (_inflight[cacheKey]) return _inflight[cacheKey];

  const promise = _fetchJSON(url)
    .then(data => {
      _setCached(cacheKey, data);
      delete _inflight[cacheKey];
      return data;
    })
    .catch(err => {
      delete _inflight[cacheKey];
      throw err;
    });

  _inflight[cacheKey] = promise;
  return promise;
}

export function getFearGreedCurrent() {
  return getSpectreFearGreedCurrent()
    .then((current) => {
      if (!current) throw new Error('missing v1 fear-greed current')
      return current
    })
    .catch(() => _deduped('current', CURRENT_TTL, '/spectre-market-api/market/fear-greed'))
    .then((payload) => {
      if (payload?.value != null) return payload
      const current = payload?.data?.current
      if (!current) throw new Error('missing Spectre fear-greed current')
      const value = Number(current.value ?? current.score)
      const classification = current.label || current.classification || current.value_classification
      return {
        value,
        score: value,
        classification,
        value_classification: classification,
        label: classification,
        timestamp: current.time || null,
      }
    })
    .catch(() => _deduped('current_legacy', CURRENT_TTL, '/api/fear-greed/current'))
    .catch(() => getSpectreFearGreedCurrent())
}

// CMC daily history is the only source with multi-year coverage — the v1
// market bridge returns intraday snapshots for the last few days, which
// makes the chart's x-axis collapse to a single day. Try CMC first; fall
// back to the spectre bridge only if CMC is unreachable.
export function getFearGreedHistory(limit = 365) {
  return _deduped(`hist_legacy_${limit}`, HISTORY_TTL, `/api/fear-greed/historical?limit=${limit}`)
    .then((payload) => {
      if (!Array.isArray(payload?.data) || !payload.data.length) {
        throw new Error('missing CMC fear-greed history')
      }
      return payload
    })
    .catch(() => getSpectreFearGreedHistory(limit))
    .then((payload) => {
      if (Array.isArray(payload?.data) && payload.data[0]?.value != null) return payload
      const history = Array.isArray(payload?.data?.history) ? payload.data.history : []
      return {
        data: history.slice(0, limit).map((point) => {
          const value = Number(point.value ?? point.score)
          const classification = point.label || point.classification || point.value_classification
          return {
            value,
            score: value,
            classification,
            value_classification: classification,
            label: classification,
            timestamp: toUnixSecondsString(point.time),
            time: point.time || null,
            ts: point.ts || null,
          }
        }).filter((point) => Number.isFinite(point.value)),
      }
    })
    .catch(() => _deduped(`hist_${limit}`, HISTORY_TTL, '/spectre-market-api/market/fear-greed'))
}

export function getGlobalMetrics() {
  return getSpectreGlobalMetrics()
    .then((data) => {
      if (!data) throw new Error('missing v1 global metrics')
      return data
    })
    .catch(() => _deduped('global_spectre', GLOBAL_TTL, '/spectre-market-api/market/global'))
    .then((payload) => {
      if (payload?.totalMarketCap != null || payload?.btcDominance != null) return payload
      const data = payload?.data
      if (!data) throw new Error('missing Spectre global metrics')
      return {
        totalMarketCap: Number(data.totalMarketCap || data.totalMarketCapUsd || data.total_market_cap || data.marketCap || 0),
        totalVolume: Number(data.totalVolume24h || data.totalVolume || data.total_volume_24h || data.volume24h || 0),
        btcDominance: Number(data.btcDominance ?? data.btc_dominance ?? 0),
        ethDominance: Number(data.ethDominance ?? data.eth_dominance ?? 0),
        activeCryptos: Number(data.activeAssets || data.active_cryptocurrencies || data.trackedAssets || 0),
        activeAssets: Number(data.activeAssets || 0),
        trackedAssets: Number(data.trackedAssets || 0),
        marketCapChange24h: Number(data.marketCapChange24h ?? data.market_cap_change_24h ?? 0),
      }
    })
    .catch(() => _deduped('global_legacy', GLOBAL_TTL, '/api/fear-greed/global-metrics'))
    .catch(() => getSpectreGlobalMetrics())
}

export function getTopMovers() {
  return getSpectreTokenMovers(20)
    .then((movers) => {
      if (movers?.gainers?.length || movers?.losers?.length) return movers
      throw new Error('missing Spectre movers')
    })
    .catch(() => _deduped('movers_spectre', MOVERS_TTL, '/spectre-market-api/tokens/gainers?period=24h&limit=20'))
    .then((payload) => {
      if (payload?.gainers || payload?.losers) return payload
      const data = payload?.data || {}
      const normalize = (row = {}) => ({
        symbol: String(row.asset || row.symbol || '').toUpperCase(),
        name: row.name || row.asset || row.symbol || '',
        price: Number(row.price || 0),
        change: Number(row.change ?? row.change_24h ?? 0),
        volume: Number(row.volume_24h ?? row.volume24h ?? row.volume ?? 0),
      })
      return {
        gainers: (Array.isArray(data.gainers) ? data.gainers : []).map(normalize),
        losers: (Array.isArray(data.losers) ? data.losers : []).map(normalize),
      }
    })
    .catch(() => _deduped('movers_legacy', MOVERS_TTL, '/api/fear-greed/movers'))
    .catch(() => getSpectreTokenMovers(20))
}

export function getBtcPriceHistory(days = 365) {
  const limit = Math.min(Math.max(Number(days) || 365, 1), 1000)
  return _deduped(`btc_chart_legacy_${days}`, BTC_CHART_TTL, `/api/coingecko/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`)
    .catch(() => _deduped(`btc_chart_spectre_${limit}`, BTC_CHART_TTL, `/spectre-market-api/token/BTC/chart?interval=1d&limit=${limit}`)
      .then((payload) => {
        const rows = Array.isArray(payload?.data) ? payload.data : []
        if (!rows.length) throw new Error('missing Spectre BTC chart')
        return {
          prices: rows.map((row) => [new Date(row.time).getTime(), Number(row.close ?? row.price ?? 0)]),
          total_volumes: rows.map((row) => [new Date(row.time).getTime(), Number(row.volume ?? 0)]),
        }
      }))
    .catch(() => getSpectreTokenChart('BTC', { interval: '1d', limit }).then((rows) => ({
      prices: rows.map((row) => [new Date(row.time).getTime(), Number(row.close ?? row.price ?? 0)]),
      total_volumes: rows.map((row) => [new Date(row.time).getTime(), Number(row.volume ?? 0)]),
    })))
}

// ETH price history — mirrors getBtcPriceHistory so the F&G chart can overlay ETH
// alongside/instead of BTC (Dez: "plot fear and greed vs bitcoin / eth / others").
export function getEthPriceHistory(days = 365) {
  const limit = Math.min(Math.max(Number(days) || 365, 1), 1000)
  return _deduped(`eth_chart_legacy_${days}`, BTC_CHART_TTL, `/api/coingecko/coins/ethereum/market_chart?vs_currency=usd&days=${days}`)
    .catch(() => _deduped(`eth_chart_spectre_${limit}`, BTC_CHART_TTL, `/spectre-market-api/token/ETH/chart?interval=1d&limit=${limit}`)
      .then((payload) => {
        const rows = Array.isArray(payload?.data) ? payload.data : []
        if (!rows.length) throw new Error('missing Spectre ETH chart')
        return {
          prices: rows.map((row) => [new Date(row.time).getTime(), Number(row.close ?? row.price ?? 0)]),
          total_volumes: rows.map((row) => [new Date(row.time).getTime(), Number(row.volume ?? 0)]),
        }
      }))
    .catch(() => getSpectreTokenChart('ETH', { interval: '1d', limit }).then((rows) => ({
      prices: rows.map((row) => [new Date(row.time).getTime(), Number(row.close ?? row.price ?? 0)]),
      total_volumes: rows.map((row) => [new Date(row.time).getTime(), Number(row.volume ?? 0)]),
    })))
}

// "OTHERS" overlay fallback = altcoin market cap (total − BTC), derived from the
// CoinGecko proxy (works in BOTH dev and prod). The box OTHERS2 (ex-top-100) is
// the accurate primary, but it 401s in dev (retired /data-api key) — this keeps the
// OTHERS overlay demoable everywhere. Aligns BTC mcap to each total point by nearest ts.
export async function getOthersMarketCapHistory(days = 365) {
  const [totalRes, btcRes] = await Promise.all([
    _deduped(`cg_total_mcap_${days}`, BTC_CHART_TTL, `/api/coingecko/global/market_cap_chart?days=${days}&vs_currency=usd`).catch(() => null),
    _deduped(`cg_btc_mcap_${days}`, BTC_CHART_TTL, `/api/coingecko/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`).catch(() => null),
  ])
  const total = totalRes?.market_cap_chart?.market_cap || totalRes?.market_caps || []
  const btc = btcRes?.market_caps || []
  if (!total.length || !btc.length) return { prices: [] }
  const prices = []
  let j = 0
  for (const [ts, tot] of total) {
    while (j < btc.length - 1 && Math.abs(btc[j + 1][0] - ts) <= Math.abs(btc[j][0] - ts)) j++
    const b = btc[j]
    if (b && Math.abs(b[0] - ts) < 3 * 86400e3) prices.push([ts, Math.max(0, tot - b[1])])
  }
  return { prices }
}

export function getThesis() {
  return _deduped('thesis', THESIS_TTL, '/api/fear-greed/thesis');
}
