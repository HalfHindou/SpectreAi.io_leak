/**
 * YouEmptyState — empty-canvas hero with two CTAs.
 *
 * Renders when the dashboard has no active widgets. Per the YOU V2 master
 * plan: "Two prominent CTAs side by side: Build with your agent (opens
 * composer) and Start from a template (opens picker). No blank canvas."
 *
 * The composer (Step 5) and template picker (Step 4) are wired upstream
 * via the onComposerOpen / onTemplatePickerOpen handlers passed from
 * the YouPage container.
 */

export default function YouEmptyState({ onComposerOpen, onTemplatePickerOpen }) {
  return (
    <div className="you-empty">
      <div className="you-empty-card">
        <div className="you-empty-glow" aria-hidden="true" />
        <h2 className="you-empty-headline">Make this yours.</h2>
        <p className="you-empty-tagline">
          Compose a dashboard from scratch with your agent, or start from a template
          built for how you actually trade.
        </p>
        <div className="you-empty-ctas">
          <button
            type="button"
            className="you-empty-cta you-empty-cta--primary"
            onClick={onComposerOpen}
          >
            <span>Build with your agent</span>
          </button>
          <button
            type="button"
            className="you-empty-cta you-empty-cta--secondary"
            onClick={onTemplatePickerOpen}
          >
            <span>Start from a template</span>
          </button>
        </div>
      </div>
    </div>
  )
}
