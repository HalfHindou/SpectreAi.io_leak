/**
 * Warm the self-hosted TradingView charting_library on an idle tick BEFORE the
 * RZ chart mounts.
 *
 * The 28KB AMD loader is otherwise injected only when TradingViewAdvanced
 * mounts (TradingViewAdvanced.jsx ~:1142), so its download + parse sit on the
 * cold chart-first-paint critical path — the user stares at the chart shimmer
 * while the script fetches. Injecting the SAME `<script src>` early means the
 * chart's mount finds the existing tag (TradingViewAdvanced.jsx ~:1133) and
 * reuses it: window.TradingView.widget is already defined, so createWidget
 * fires immediately instead of waiting on the fetch.
 *
 * Lives in its own tiny module (no heavy imports) so the RZ route can warm the
 * library WITHOUT importing the lazy 5.7k-line trading-chart.jsx — importing
 * that would drag it + the datafeed onto the RZ route chunk and defeat the
 * lazy split. Idempotent + best-effort; never throws.
 */
const LIBRARY_SRC = '/charting_library/charting_library.js'
let _warmed = false

export function warmTradingViewLibrary() {
  if (_warmed || typeof document === 'undefined') return
  _warmed = true
  try {
    if (window.TradingView?.widget) return // already loaded this session
    if (document.querySelector(`script[src="${LIBRARY_SRC}"]`)) return // already injected
    const s = document.createElement('script')
    s.src = LIBRARY_SRC
    s.async = true
    // No onload here — TradingViewAdvanced attaches its own createWidget handler
    // once it mounts and finds this tag. On failure, remove the poisoned tag so
    // the chart's own inject path re-fetches cleanly (mirrors its onerror at
    // TradingViewAdvanced.jsx ~:1148) instead of polling a dead tag for 6s.
    s.onerror = () => { try { s.remove() } catch { /* ignore */ } }
    document.head.appendChild(s)
  } catch { /* best-effort warm, never break the page */ }
}
