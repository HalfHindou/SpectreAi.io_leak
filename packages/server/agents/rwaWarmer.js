/**
 * Spectre Intelligence Hub — RWA Warmer Agent
 * Keeps the RWA in-memory caches hot by periodically calling the internal
 * fetch helpers exported from routes/rwa.js.
 *
 * Schedule:
 *   - Fast loop (3 min): overview, protocols, stablecoins, movers, breakdown, index
 *   - Slow loop (15 min): tvl-history, stablecoin-history, chains, breakdown-history(2y)
 *
 * The warmer calls helpers directly (not via HTTP) so there's no proxy hop.
 * First run fires immediately at boot.
 */

const rwa = require('../routes/rwa');

const FAST_INTERVAL_MS = 3 * 60 * 1000;   // 3 min
const SLOW_INTERVAL_MS = 15 * 60 * 1000;  // 15 min

let intervals = [];

function fmtMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function warmFast() {
  const t0 = Date.now();
  const parts = [];
  try {
    const results = await Promise.allSettled([
      rwa.getRwaOverview(),
      rwa.getRwaProtocols(),
      rwa.getRwaStablecoins(),
      rwa.getRwaMovers(),
      // breakdown + index are core-tier (page-paint) remote Spectre calls that
      // cold-spike — keep them hot so the bundle never stalls the first paint.
      rwa.getRwaBreakdown(),
      rwa.getRwaIndex(),
    ]);
    const [overview, protos, stables, movers, breakdown, index] = results;
    if (overview.status === 'fulfilled') {
      parts.push(`overview($${(overview.value.totalTvl / 1e9).toFixed(1)}B)`);
    } else {
      parts.push(`overview(ERR:${overview.reason?.message?.slice(0, 30)})`);
    }
    if (protos.status === 'fulfilled') parts.push(`protos(${protos.value.length})`);
    if (stables.status === 'fulfilled') parts.push(`stables(${stables.value.length})`);
    if (movers.status === 'fulfilled') {
      const m = movers.value.data || movers.value;
      parts.push(`movers(${(m.gainers || []).length}g/${(m.losers || []).length}l)`);
    }
    if (breakdown.status === 'fulfilled') parts.push('breakdown(ok)');
    if (index.status === 'fulfilled') parts.push('index(ok)');
    console.log(`[RWA Warmer] hot: ${parts.join(' ')} — ${fmtMs(Date.now() - t0)}`);
  } catch (err) {
    console.error('[RWA Warmer] fast cycle error:', err.message);
  }
}

async function warmSlow() {
  const t0 = Date.now();
  const parts = [];
  try {
    const results = await Promise.allSettled([
      rwa.getRwaTvlHistory(),
      rwa.getRwaStablecoinHistory(),
      rwa.getRwaChains(),
      // breakdown-history(2y) is the slowest RWA upstream (~4s cold) and the
      // page's history tier always requests 2y — keep it hot here so users
      // never pay the cold cost on the active-mcap chart.
      rwa.getRwaBreakdownHistory('2y'),
    ]);
    const [tvlHist, stableHist, chains, bdHist] = results;
    if (tvlHist.status === 'fulfilled') {
      parts.push(`tvl-hist(${tvlHist.value.series?.length || 0}pts)`);
    }
    if (stableHist.status === 'fulfilled') {
      parts.push(`stable-hist(${stableHist.value.series?.length || 0}pts)`);
    }
    if (chains.status === 'fulfilled') parts.push(`chains(${chains.value.length})`);
    if (bdHist.status === 'fulfilled') {
      const rows = bdHist.value?.data || bdHist.value?.series || bdHist.value;
      parts.push(`bd-hist(${Array.isArray(rows) ? rows.length : 'ok'})`);
    }
    console.log(`[RWA Warmer] hist: ${parts.join(' ')} — ${fmtMs(Date.now() - t0)}`);
  } catch (err) {
    console.error('[RWA Warmer] slow cycle error:', err.message);
  }
}

/**
 * Start the RWA cache warmer.
 * @param {object} opts
 * @param {number} [opts.port] - optional, unused (here for API symmetry)
 */
function startRwaWarmer(/* { port } = {} */) {
  console.log('[RWA Warmer] Starting — fast/3min, slow/15min');

  // Fire initial warms after a brief delay so the HTTP server is bound first.
  setTimeout(() => { warmFast().catch(() => {}); }, 2000);
  setTimeout(() => { warmSlow().catch(() => {}); }, 4000);

  intervals.push(setInterval(() => { warmFast().catch(() => {}); }, FAST_INTERVAL_MS));
  intervals.push(setInterval(() => { warmSlow().catch(() => {}); }, SLOW_INTERVAL_MS));
}

function stopRwaWarmer() {
  intervals.forEach(id => clearInterval(id));
  intervals = [];
  console.log('[RWA Warmer] Stopped');
}

module.exports = { startRwaWarmer, stopRwaWarmer };
