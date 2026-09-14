/**
 * DealFeedSkeleton — shimmer placeholder for the Deal Feed while data loads.
 * Matches card dimensions of DealCard so the layout does not shift on hydrate.
 */
export default function DealFeedSkeleton() {
  const placeholders = Array.from({ length: 8 })
  return (
    <div className="pm-feed-grid pm-feed-skeleton">
      {placeholders.map((_, i) => (
        <div key={i} className={`pm-deal-card glass-card pm-skel-card stagger-${Math.min(5, (i % 5) + 1)}`}>
          <div className="pm-deal-top">
            <div className="pm-deal-logo pm-skel pm-skel-circle animate-shimmer" />
            <div className="pm-deal-company">
              <div className="pm-skel pm-skel-line pm-skel-line-lg animate-shimmer" />
              <div className="pm-skel pm-skel-line pm-skel-line-sm animate-shimmer" />
            </div>
            <div className="pm-skel pm-skel-pill animate-shimmer" />
          </div>
          <div className="pm-skel pm-skel-line pm-skel-line-xl animate-shimmer" />
          <div className="pm-skel pm-skel-line pm-skel-line-md animate-shimmer" />
          <div className="pm-deal-footer">
            <div className="pm-skel pm-skel-line pm-skel-line-sm animate-shimmer" />
            <div className="pm-skel pm-skel-line pm-skel-line-sm animate-shimmer" />
          </div>
        </div>
      ))}
    </div>
  )
}
