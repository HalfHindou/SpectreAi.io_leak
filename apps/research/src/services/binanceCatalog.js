// Runtime catalog of Binance USDT spot pairs. Seeded from BINANCE_MAJORS so
// the first render works synchronously; refreshed from /api/binance-usdt-pairs
// on a 6h TTL via opportunistic background loads from hasBinancePair().

import { BINANCE_MAJORS } from '@/constants/majorTokens';

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

let pairs = new Set(BINANCE_MAJORS);
let updatedAt = 0;
let inFlight = null;

function isStale() {
  return !updatedAt || Date.now() - updatedAt > CATALOG_TTL_MS;
}

export function hasBinancePair(sym) {
  if (!sym) return false;
  if (isStale()) loadBinanceCatalog();
  return pairs.has(String(sym).toUpperCase());
}

export function binancePairFor(sym) {
  if (!hasBinancePair(sym)) return null;
  return `${String(sym).toUpperCase()}USDT`;
}

export function getBinancePairs() {
  return pairs;
}

export function getCatalogUpdatedAt() {
  return updatedAt;
}

export function loadBinanceCatalog() {
  if (inFlight) return inFlight;
  if (!isStale()) return Promise.resolve(pairs);
  inFlight = fetch('/api/binance-usdt-pairs', {
    signal: AbortSignal.timeout(12_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      if (json && Array.isArray(json.pairs) && json.pairs.length > 0) {
        pairs = new Set(json.pairs);
        updatedAt = Number(json.updatedAt) || Date.now();
      }
      return pairs;
    })
    .catch(() => pairs)
    .finally(() => { inFlight = null; });
  return inFlight;
}
