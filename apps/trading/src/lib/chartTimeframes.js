/**
 * chartTimeframes — the ONE saved-timeframe-label -> Codex-resolution map.
 *
 * Consumers: useCodexData.prefetchChartBars (hover/click prewarm) and
 * codexApi.fetchTokenSnapshot (in-app token switch — the snapshot must carry
 * bars at the SAME resolution the chart will mount on, or the seed misses and
 * the chart cold-fetches the full window: the measured "seconds on token
 * switch" bug).
 *
 * KEEP IN SYNC with the inline `tfRes` copy in apps/trading/index.html's boot
 * script (~line 71) — the pre-JS boot snapshot can't import modules, so the
 * map is duplicated there by necessity.
 */

// Mirrors TradingChart.jsx timeframeToResolution. Includes the legacy
// uppercase labels (pre-lowercase-m migration) so a stale localStorage
// 'spectre-timeframe' still resolves correctly.
export const TIMEFRAME_TO_RESOLUTION = {
  '1m': '1', '5m': '5', '15m': '15',
  '1H': '60', '4H': '240', '12H': '720', '1D': '1D', '1W': '1W', 'All': '1D',
  '1M': '1', '5M': '5', '15M': '15', '30M': '30',
};

/**
 * The Codex resolution for the user's saved chart timeframe
 * (localStorage 'spectre-timeframe'), falling back to 1H.
 */
export function getSavedChartResolution() {
  let tf = '1H';
  try { tf = localStorage.getItem('spectre-timeframe') || '1H'; } catch { /* private mode */ }
  return TIMEFRAME_TO_RESOLUTION[tf] || '60';
}
