/**
 * Spectre Onchain API Client
 *
 * Wraps our api-eth backend with:
 * - Circuit breaker (configurable — relaxed in API-only mode)
 * - In-memory TTL cache (5K entries max)
 * - Retry on 5xx/timeout (1 retry, 500ms delay)
 * - Per-request timeout (8s default)
 * - Health check every 30s
 * - Source attribution logging with per-minute stats
 */

const fetch = require('node-fetch');

const API_ONLY = process.env.SPECTRE_API_ONLY === 'true';

// ═══════════════════════════════════════════════════════════════════════════════
// Circuit Breaker — relaxed in API-only mode (no fallback = can't afford long outages)
// ═══════════════════════════════════════════════════════════════════════════════

const CB_FAILURE_THRESHOLD = API_ONLY ? 10 : 3;
const CB_FAILURE_WINDOW_MS = 30_000;
const CB_OPEN_DURATION_MS = API_ONLY ? 10_000 : 60_000;

class CircuitBreaker {
  constructor() {
    this.state = 'closed'; // closed | open | half-open
    this.failures = [];
    this.openedAt = 0;
  }

  get isOpen() {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= CB_OPEN_DURATION_MS) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.state = 'closed';
    this.failures = [];
  }

  recordFailure() {
    const now = Date.now();
    this.failures.push(now);
    // Keep only recent failures
    this.failures = this.failures.filter(t => now - t < CB_FAILURE_WINDOW_MS);

    if (this.failures.length >= CB_FAILURE_THRESHOLD) {
      this.state = 'open';
      this.openedAt = now;
      console.warn(`[onchain] Circuit breaker OPENED — ${CB_FAILURE_THRESHOLD} failures in ${CB_FAILURE_WINDOW_MS / 1000}s`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TTL Cache
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_CACHE = 5000;

class TtlCache {
  constructor(maxSize = DEFAULT_MAX_CACHE) {
    this.store = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key, data, ttlMs) {
    // Evict oldest entries if full
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.store.set(key, { data, expiry: Date.now() + ttlMs });
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats Tracker
// ═══════════════════════════════════════════════════════════════════════════════

class StatsTracker {
  constructor() {
    this.spectreHits = 0;
    this.codexFallbackHits = 0;
    this.circuitOpenHits = 0;
    this.errors = 0;
    this.lastLoggedAt = Date.now();

    // Log stats every 60s
    this._interval = setInterval(() => this._logStats(), 60_000);
  }

  recordSpectre() { this.spectreHits++; }
  recordFallback() { this.codexFallbackHits++; }
  recordCircuitOpen() { this.circuitOpenHits++; }
  recordError() { this.errors++; }

  getStats() {
    const total = this.spectreHits + this.codexFallbackHits + this.circuitOpenHits;
    return {
      spectre_api_hits: this.spectreHits,
      codex_fallback_hits: this.codexFallbackHits,
      circuit_open_hits: this.circuitOpenHits,
      errors: this.errors,
      total_requests: total,
      success_rate: total > 0 ? ((this.spectreHits / total) * 100).toFixed(1) + '%' : '0%',
    };
  }

  _logStats() {
    const s = this.getStats();
    if (s.total_requests > 0) {
      console.log(`[onchain-stats] spectre:${s.spectre_api_hits} fallback:${s.codex_fallback_hits} circuit_open:${s.circuit_open_hits} errors:${s.errors} success:${s.success_rate}`);
    }
    // Reset counters
    this.spectreHits = 0;
    this.codexFallbackHits = 0;
    this.circuitOpenHits = 0;
    this.errors = 0;
  }

  destroy() {
    clearInterval(this._interval);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Onchain Client
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT = 8000;
const RETRY_DELAY = 500;
const HEALTH_CHECK_INTERVAL = 30_000;

class OnchainClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? 1;

    this.circuit = new CircuitBreaker();
    this.cache = new TtlCache(options.cacheSize || DEFAULT_MAX_CACHE);
    this.stats = new StatsTracker();
    this.healthy = false;

    // Start health check loop
    this._healthInterval = setInterval(() => this.healthCheck(), HEALTH_CHECK_INTERVAL);
    // Initial health check
    this.healthCheck();
  }

  /** Whether the API is reachable and circuit is not open */
  get isAvailable() {
    return this.healthy && !this.circuit.isOpen;
  }

  /** Periodic health probe */
  async healthCheck() {
    try {
      const res = await fetch(`${this.baseUrl}/v2/networks`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      });
      this.healthy = res.ok;
      if (res.ok) this.circuit.recordSuccess();
    } catch {
      this.healthy = false;
    }
  }

  /**
   * GET request with caching + circuit breaker.
   * @param {string} path - API path (e.g. '/v2/token/0x...')
   * @param {object} params - Query parameters
   * @param {number} cacheTtlMs - Cache TTL in ms (0 = no cache)
   * @returns {{ data: any, source: string }} - data + source attribution
   */
  async get(path, params = {}, cacheTtlMs = 0) {
    // Build URL — concatenate baseUrl + path (don't use new URL(path, base) which drops base path)
    const fullPath = `${this.baseUrl}${path}`;
    const url = new URL(fullPath);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
    const cacheKey = url.toString();

    // Check cache
    if (cacheTtlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        this.stats.recordSpectre();
        return { data: cached, source: 'spectre-api', cached: true };
      }
    }

    // Circuit breaker check
    if (this.circuit.isOpen) {
      this.stats.recordCircuitOpen();
      return { data: null, source: null, error: 'circuit-open' };
    }

    // Fetch with retry
    const startMs = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY);

      try {
        const res = await fetch(url.toString(), {
          signal: AbortSignal.timeout(this.timeout),
          headers: {
            Accept: 'application/json',
            'x-chain-id': params.chainId || params.chain_id || '',
            // Cloudflare in front of onchain.spectreai.io bot-blocks
            // empty UAs. Pose as a browser so the upstream returns data
            // instead of an HTML challenge page.
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Origin: 'https://trade.spectreai.io',
            Referer: 'https://trade.spectreai.io/',
          },
        });

        if (!res.ok) {
          // 4xx = don't retry (client error), 5xx = retry
          if (res.status >= 400 && res.status < 500) {
            this.circuit.recordSuccess(); // 4xx is not a server failure
            return { data: null, source: null, error: `http-${res.status}` };
          }
          lastError = `http-${res.status}`;
          continue;
        }

        const json = await res.json();
        const data = json.data ?? json;
        const elapsed = Date.now() - startMs;

        // Success
        this.circuit.recordSuccess();
        this.stats.recordSpectre();

        if (cacheTtlMs > 0) {
          this.cache.set(cacheKey, data, cacheTtlMs);
        }

        console.log(`[onchain] GET ${path} → source:spectre-api (${elapsed}ms)`);
        // _raw: full JSON response (useful when endpoints return top-level fields like summary)
        return { data, _raw: json, source: 'spectre-api', cached: false };
      } catch (err) {
        lastError = err.name === 'AbortError' ? 'timeout' : err.message;
      }
    }

    // All retries failed
    this.circuit.recordFailure();
    this.stats.recordError();
    const elapsed = Date.now() - startMs;
    console.warn(`[onchain] GET ${path} → FAILED reason:${lastError} (${elapsed}ms)`);
    return { data: null, source: null, error: lastError };
  }

  destroy() {
    clearInterval(this._healthInterval);
    this.stats.destroy();
    this.cache.clear();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton Instance
// ═══════════════════════════════════════════════════════════════════════════════

const ONCHAIN_API_URL = process.env.SPECTRE_ONCHAIN_API_URL || 'https://onchain.spectreai.io/api';

const client = new OnchainClient(ONCHAIN_API_URL);

module.exports = { OnchainClient, client, TtlCache, StatsTracker };
