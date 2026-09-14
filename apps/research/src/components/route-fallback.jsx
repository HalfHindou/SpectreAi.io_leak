/**
 * RouteFallback — Spectre-style skeleton shown inside a <Suspense> boundary
 * while a lazy route chunk is still being fetched/parsed.
 *
 * Two variants:
 *   - shell  (default for in-app nav): full page skeleton that matches the
 *            AppShell content area — title + stat cards + tab pills + body
 *            grid with rows on the left and a side panel on the right.
 *            Mirrors the boot skeleton in index.html so cold-load and
 *            in-app navigation feel like the same loading language.
 *   - viewport: centered cinematic wave for standalone routes (newsroom,
 *            website) where there is no AppShell chrome around it.
 *
 * Props:
 *   - shell?:    boolean — render the shell variant (default: false / viewport)
 *   - label?:    string  — optional accessibility caption
 */
import './route-fallback.css'

export default function RouteFallback({ shell = false, label = 'Loading' }) {
  if (shell) {
    return (
      <div className="route-fallback route-fallback--shell" role="status" aria-live="polite" aria-label={label}>
        <div className="rf-head">
          <div className="rf-shimmer rf-title" />
          <div className="rf-shimmer rf-subtitle" />
        </div>
        <div className="rf-cards">
          <div className="rf-shimmer rf-card" />
          <div className="rf-shimmer rf-card" />
          <div className="rf-shimmer rf-card" />
          <div className="rf-shimmer rf-card" />
        </div>
        <div className="rf-tabs">
          <div className="rf-shimmer rf-tab" style={{ width: 78 }} />
          <div className="rf-shimmer rf-tab" style={{ width: 90 }} />
          <div className="rf-shimmer rf-tab" style={{ width: 108 }} />
          <div className="rf-shimmer rf-tab" style={{ width: 96 }} />
          <div className="rf-shimmer rf-tab" style={{ width: 84 }} />
          <div className="rf-shimmer rf-tab" style={{ width: 112 }} />
          <div className="rf-shimmer rf-tab" style={{ width: 96 }} />
        </div>
        <div className="rf-body">
          <div className="rf-panel">
            <div className="rf-shimmer rf-row" />
            <div className="rf-shimmer rf-row" />
            <div className="rf-shimmer rf-row" />
            <div className="rf-shimmer rf-row" />
            <div className="rf-shimmer rf-row" />
            <div className="rf-shimmer rf-row" />
            <div className="rf-shimmer rf-row" />
            <div className="rf-shimmer rf-row" />
          </div>
          <aside className="rf-aside">
            <div className="rf-shimmer rf-aside-card rf-aside-card--lg" />
            <div className="rf-shimmer rf-aside-card rf-aside-card--sm" />
            <div className="rf-shimmer rf-aside-card rf-aside-card--sm" />
            <div className="rf-shimmer rf-aside-card rf-aside-card--sm" />
          </aside>
        </div>
      </div>
    )
  }

  // Standalone routes (no AppShell). Centered cinematic waveform — 7 bars
  // with a smooth phase-shifted wave, subtle warm-white glow underneath.
  return (
    <div className="route-fallback" role="status" aria-live="polite" aria-label={label}>
      <div className="rf-wave" aria-hidden="true">
        <span className="rf-wave-bar" />
        <span className="rf-wave-bar" />
        <span className="rf-wave-bar" />
        <span className="rf-wave-bar" />
        <span className="rf-wave-bar" />
        <span className="rf-wave-bar" />
        <span className="rf-wave-bar" />
      </div>
    </div>
  )
}
