/**
 * Mini follow-network graph — a cheap pure-SVG radial layout. The KOL sits at
 * the center; their sampled follows fan out on a ring, project follows ringed
 * amber (the convergence targets), plain accounts dimmed. No physics, no chart
 * lib — a single deterministic radial placement so it settles instantly and
 * costs nothing on a poll.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const SIZE = 260
const CENTER = SIZE / 2
const RADIUS = 96
const NODE_R = 15

function initials(name) {
  return String(name || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?'
}

export default function KolFollowNetwork({ kol = {}, accounts = [], onOpenProject }) {
  const { t } = useTranslation()

  const nodes = useMemo(() => {
    const list = (Array.isArray(accounts) ? accounts : [])
      .filter(Boolean)
      .slice(0, 10)
    const n = list.length
    if (n === 0) return []
    // Project follows first so the amber convergence targets cluster at the top
    // of the ring (most-scannable arc) rather than scattering.
    const sorted = [...list].sort((a, b) => Number(Boolean(b.is_project)) - Number(Boolean(a.is_project)))
    return sorted.map((acc, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      return {
        acc,
        x: CENTER + Math.cos(angle) * RADIUS,
        y: CENTER + Math.sin(angle) * RADIUS,
      }
    })
  }, [accounts])

  const centerHandle = String(kol.screen_name || '').replace(/^@/, '')

  if (nodes.length === 0) {
    return (
      <div className="xd-kol-net xd-kol-net--empty">
        {t('kolRadar.network.empty', 'Follow graph warming up')}
      </div>
    )
  }

  return (
    <div className="xd-kol-net">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t('kolRadar.network.aria', 'Follow network for @{{handle}}', { handle: centerHandle })}>
        {/* edges */}
        <g className="xd-kol-net__edges">
          {nodes.map((node, i) => (
            <line
              key={`e-${i}`}
              x1={CENTER} y1={CENTER}
              x2={node.x} y2={node.y}
              className={`xd-kol-net__edge${node.acc.is_project ? ' xd-kol-net__edge--project' : ''}`}
            />
          ))}
        </g>
        {/* outer nodes */}
        <g>
          {nodes.map((node, i) => {
            const acc = node.acc
            const project = acc.is_project ? acc.project : null
            const logo = project ? (project.image || project.image_small) : acc.avatar_url
            const label = project ? (project.symbol ? `$${project.symbol}` : project.name) : `@${String(acc.screen_name || '').replace(/^@/, '')}`
            const clickable = Boolean(project?.cg_id)
            return (
              <g
                key={`n-${i}`}
                className={`xd-kol-net__node${acc.is_project ? ' xd-kol-net__node--project' : ''}${clickable ? ' xd-kol-net__node--clickable' : ''}`}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => clickable && onOpenProject && onOpenProject(project.cg_id)}
              >
                <circle r={NODE_R} className="xd-kol-net__node-ring" />
                {logo ? (
                  <>
                    <defs>
                      <clipPath id={`kn-clip-${i}`}><circle r={NODE_R - 2} /></clipPath>
                    </defs>
                    <image
                      href={logo}
                      x={-(NODE_R - 2)} y={-(NODE_R - 2)}
                      width={(NODE_R - 2) * 2} height={(NODE_R - 2) * 2}
                      clipPath={`url(#kn-clip-${i})`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  </>
                ) : (
                  <text className="xd-kol-net__node-letter" textAnchor="middle" dominantBaseline="central">
                    {initials(project?.name || acc.screen_name)}
                  </text>
                )}
                <title>{label}</title>
              </g>
            )
          })}
        </g>
        {/* center node */}
        <g transform={`translate(${CENTER}, ${CENTER})`} className="xd-kol-net__center">
          <circle r={NODE_R + 6} className="xd-kol-net__center-ring" />
          {kol.avatar_url ? (
            <>
              <defs>
                <clipPath id="kn-center-clip"><circle r={NODE_R + 4} /></clipPath>
              </defs>
              <image
                href={kol.avatar_url}
                x={-(NODE_R + 4)} y={-(NODE_R + 4)}
                width={(NODE_R + 4) * 2} height={(NODE_R + 4) * 2}
                clipPath="url(#kn-center-clip)"
                preserveAspectRatio="xMidYMid slice"
              />
            </>
          ) : (
            <text className="xd-kol-net__center-letter" textAnchor="middle" dominantBaseline="central">
              {initials(centerHandle)}
            </text>
          )}
          <title>@{centerHandle}</title>
        </g>
      </svg>
      <div className="xd-kol-net__legend">
        <span className="xd-kol-net__legend-item">
          <span className="xd-kol-net__legend-dot xd-kol-net__legend-dot--project" />
          {t('kolRadar.network.projects', 'Projects')}
        </span>
        <span className="xd-kol-net__legend-item">
          <span className="xd-kol-net__legend-dot" />
          {t('kolRadar.network.accounts', 'Accounts')}
        </span>
      </div>
    </div>
  )
}
