/*
 * PGLockOverlay - the unlock CTA shown to free users over the gated board.
 *
 * Free users see the top-3 cards behind a blur (rendered by the page) with
 * this overlay floating on top. It does NOT invent a payment flow - it is a
 * placeholder CTA. The performance-proof hero stays fully visible above this.
 */

const LockGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export default function PGLockOverlay({ onUnlock }) {
  return (
    <div className="pg-lock" role="region" aria-label="Premium board locked">
      <div className="pg-lock__card">
        <div className="pg-lock__icon"><LockGlyph /></div>
        <h3 className="pg-lock__title">The full board is a premium surface</h3>
        <p className="pg-lock__copy">
          You are seeing a preview. Unlock Potential Gainers to reveal every ranked token,
          its setup score, reason bullets and risk flags — the complete board distilled from
          X intelligence.
        </p>
        <ul className="pg-lock__perks">
          <li>Full ranked board — Top 10 &amp; Top 20</li>
          <li>Per-token reasons, clean-momentum &amp; risk flags</li>
          <li>Hourly snapshot history of previous calls</li>
        </ul>
        <button type="button" className="pg-lock__cta" onClick={onUnlock}>
          Unlock Potential Gainers
        </button>
        <span className="pg-lock__note">
          The tracked performance above stays free — that is the proof.
        </span>
      </div>
    </div>
  )
}
