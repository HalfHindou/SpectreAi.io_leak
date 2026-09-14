/**
 * In-memory cache for AI-generated insight tooltips.
 * TTL per entry - keyed by metric type + value + token/sector context.
 * Module-level Map survives component unmounts (same pattern as useWalletBalances).
 */

const cache = new Map();

export function getCachedInsight(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedInsight(key, data, ttl) {
  cache.set(key, { data, timestamp: Date.now(), ttl });
}

export function buildCacheKey({ metricType, metricValue, tokenSymbol, sector }) {
  return `${metricType}:${metricValue}:${tokenSymbol || ''}:${sector || ''}`;
}

/** Evict all expired entries. Called lazily - not on a timer. */
export function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > entry.ttl) cache.delete(key);
  }
}
