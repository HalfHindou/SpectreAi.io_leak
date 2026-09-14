/**
 * NodeTooltip — Hover tooltip that follows the cursor over graph nodes.
 *
 * Compact glass card showing name, handle, follower count, and tier badge.
 * Position is controlled by the parent via `position` prop (screen coords).
 */
import { TIER_COLORS } from '../data/zigchainGraph'
import { nodeIdentityLabel } from '@/lib/token-identity'

function formatFollowers(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCount(n) {
  if (n == null || !Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export default function NodeTooltip({ node, position, dayMode }) {
  if (!node || !position) return null

  const tierColor = TIER_COLORS[node.tier] || TIER_COLORS.C

  // Project hubs carry no personal follower count (they're a project, not an
  // account) — a literal "0 followers" reads as broken data. Show the live
  // mention volume instead, which is the metric the hub actually represents.
  const isHub = node.isHub || node.isProjectHub || node.type === 'project'
  const hubMentions = node.intel?.mentions24h ?? node.mentionCount

  // Identity line via the shared rule: authors → @handle; projects → real
  // @handle else $cashtag(s), never "@<ticker>".
  const { label: handleLabel } = nodeIdentityLabel(node)

  return (
    <div
      className="xi-tooltip"
      style={{
        left: position.x + 12,
        top: position.y + 12,
      }}
    >
      <div className="xi-tooltip__name">{node.name}</div>
      <div className="xi-tooltip__meta">
        {handleLabel && (
          <>
            <span>{handleLabel}</span>
            <span>&middot;</span>
          </>
        )}
        {isHub ? (
          <span className="xi-tooltip__followers">
            {formatCount(hubMentions)} mentions
          </span>
        ) : (
          <span className="xi-tooltip__followers">
            {formatFollowers(node.followers)} followers
          </span>
        )}
        <span className="xi-tooltip__tier">
          <span className="xi-tooltip__tier-dot" style={{ background: tierColor }} />
          {node.tier}-Tier
        </span>
      </div>
    </div>
  )
}
