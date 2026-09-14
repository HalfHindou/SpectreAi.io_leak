/**
 * ITooltipSkeleton - shimmer loading state for the Intelligence tooltip.
 * Matches the real tooltip layout: label, title, body (2 lines), action items.
 * Uses .animate-shimmer from the app's global CSS.
 */

export default function ITooltipSkeleton() {
  return (
    <div className="i-tooltip-skeleton">
      <div className="shimmer-bar shimmer-bar--title animate-shimmer" />
      <div className="shimmer-bar shimmer-bar--body animate-shimmer" style={{ animationDelay: '50ms' }} />
      <div className="shimmer-bar shimmer-bar--body2 animate-shimmer" style={{ animationDelay: '100ms' }} />
      <div className="shimmer-bar shimmer-bar--action animate-shimmer" style={{ animationDelay: '150ms' }} />
      <div className="shimmer-bar shimmer-bar--action animate-shimmer" style={{ animationDelay: '200ms' }} />
      <div className="shimmer-bar shimmer-bar--action animate-shimmer" style={{ animationDelay: '250ms' }} />
    </div>
  );
}
