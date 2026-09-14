/**
 * Plan section - current plan, locked features, upgrade CTA.
 * Migrated from the original user-dashboard index.jsx.
 */

const includedFeatures = [
  'Top 100 coins',
  'Basic market overview',
  '3 AI searches per day',
  'Public Intelligence articles',
]

const lockedFeatures = [
  { name: 'AI Screener', tier: 'Pro' },
  { name: 'Voice Mode', tier: 'Pro' },
  { name: 'Trading Terminal', tier: 'Elite' },
  { name: 'API Access', tier: 'Elite' },
]

export default function UdPlanSection({ onNavigate }) {
  return (
    <section className="ud-card ud-plan">
      <div className="ud-card-header-row">
        <h2 className="ud-card-title">Current Plan</h2>
        <span className="ud-plan-badge">FREE</span>
      </div>
      <p className="ud-card-description">Your current access includes:</p>

      <ul className="ud-plan-features">
        {includedFeatures.map((f) => (
          <li key={f} className="ud-plan-feature">
            <svg className="ud-plan-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="ud-divider" />

      <div className="ud-plan-locked">
        {lockedFeatures.map((item) => (
          <div key={item.name} className="ud-plan-locked-row">
            <div className="ud-plan-locked-left">
              <svg className="ud-plan-lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 118 0v4" /></svg>
              <span>{item.name}</span>
            </div>
            <span className="ud-plan-tier">{item.tier}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="ud-plan-upgrade"
        onClick={() => onNavigate('/pricing')}
      >
        Upgrade to Pro
      </button>
    </section>
  )
}
