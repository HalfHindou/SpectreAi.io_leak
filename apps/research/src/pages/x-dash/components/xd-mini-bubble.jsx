/**
 * XDMiniBubble — a compact, embedded X Bubbles preview for the token open in
 * the X Dash drawer. Renders the project's 7d social graph (hub + top voices)
 * as a small radial bubble map; the "Full screen" button (or clicking the
 * stage) opens the full interactive graph at /x-bubbles?project=<cgId>.
 *
 * Self-contained: pass `cgId` (+ name/symbol/logo for an instant hub paint) and
 * it fetches via the SAME useProjectGraph the full graph uses, so the data and
 * the colour language stay identical between the mini and the full view.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import useProjectGraph from '@/pages/x-intelligence/hooks/useProjectGraph'
import { nodeColor } from '@/pages/x-intelligence/data/zigchainGraph'
import { COMING_SOON_PAGE_IDS } from '@/constants/comingSoonPages'
import './xd-mini-bubble.css'

const MAX_NODES = 18

// Loudness of a voice — drives bubble size + which voices make the cut.
function influence(n) {
  return n.weightedEngagement || (n.mentionCount || 0) * 50 || n.followers || 0
}

// Map the drawer's already-loaded carrier rows into the minimal node shape the
// mini draws — used for an INSTANT paint while the richer 7d graph loads.
function mapSeedAuthor(c) {
  if (!c) return null
  const sn = c.screen_name || c.handle || ''
  const id = String(sn || c.author_rest_id || c.rest_id || '').toLowerCase()
  if (!id) return null
  return {
    id,
    name: c.name || sn,
    handle: sn ? `@${sn}` : '',
    avatar: (c.avatar_image_url || c.profile_image_url || c.avatar || '').replace('_normal', '_200x200'),
    followers: c.followers_count || c.follower_count || 0,
    authorClass: (c.author_class || '').toLowerCase() || null,
    mentionCount: c.mention_count || 1,
    weightedEngagement: c.total_weighted_engagement || 0,
    type: 'kol',
    isHub: false,
  }
}

function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}

export default function XDMiniBubble({ cgId, name, symbol, logo, seedAuthors = [] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const { nodes, loading, projectName } = useProjectGraph(cgId, '7d')

  const hub = useMemo(() => (nodes || []).find((n) => n.isHub) || null, [nodes])

  // Author voices: prefer the loaded 7d graph; until it lands, paint instantly
  // from the drawer's already-loaded carriers so a cold open never shows an
  // empty ~5s gap. The graph (richer) swaps in seamlessly when it arrives.
  const authorNodes = useMemo(() => {
    const graphAuthors = (nodes || []).filter((n) => !n.isHub)
    if (graphAuthors.length) return graphAuthors
    return (seedAuthors || []).map(mapSeedAuthor).filter(Boolean)
  }, [nodes, seedAuthors])

  // Top voices placed on a subtle multi-radius ring around the hub. Pure
  // geometry (no force sim) — this is a preview; the real layout lives in the
  // full graph one click away.
  const placed = useMemo(() => {
    const top = [...authorNodes].sort((a, b) => influence(b) - influence(a)).slice(0, MAX_NODES)
    const n = top.length
    if (!n) return []
    const maxInf = Math.max(...top.map(influence), 1)
    return top.map((node, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      const r = 33 + (i % 3) * 5 // 33 / 38 / 43 — gentle depth rings
      return {
        node,
        cx: 50 + Math.cos(angle) * r,
        cy: 50 + Math.sin(angle) * r * 0.9, // squashed so it fits the panel height
        size: 18 + Math.round((influence(node) / maxInf) * 22), // 18–40px
      }
    })
  }, [authorNodes])

  const label = name || projectName || symbol || 'Token'
  const voices = placed.length
  const hubLogo = logo || hub?.avatar || ''

  // The full graph lives at /x-bubbles, which is Coming-Soon gated for now.
  // Only surface the "Full screen" / click-to-open affordance when that route
  // is actually live — when it's unlocked (id removed from the set) the link
  // re-appears automatically, no code change needed.
  const canOpenFull = !COMING_SOON_PAGE_IDS.has('x-bubbles')

  const openFull = () => {
    if (!cgId || !canOpenFull) return
    navigate(`/x-bubbles?project=${encodeURIComponent(cgId)}&name=${encodeURIComponent(label)}`)
  }

  return (
    <div className={`xd-minibubble${dayMode ? ' xd-minibubble--day' : ''}`}>
      <div className="xd-minibubble__head">
        <span className="xd-drawer-section__label" style={{ margin: 0 }}>
          {t('xDash.tokenDrawer.socialGraph', 'Social graph')}
        </span>
        <div className="xd-minibubble__head-right">
          {voices > 0 && (
            <span className="xd-minibubble__count">
              <b className="xd-num">{voices}</b> {t('xDash.tokenDrawer.voices', 'voices')}
            </span>
          )}
          {canOpenFull && (
            <button
              type="button"
              className="xd-minibubble__expand"
              onClick={openFull}
              title={t('xDash.tokenDrawer.openXBubbles', 'Open full X Bubbles graph')}
            >
              <ExpandIcon />
              <span>{t('xDash.tokenDrawer.fullScreen', 'Full screen')}</span>
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        className={`xd-minibubble__stage${canOpenFull ? '' : ' xd-minibubble__stage--static'}`}
        onClick={canOpenFull ? openFull : undefined}
        aria-label={canOpenFull
          ? t('xDash.tokenDrawer.openXBubbles', 'Open full X Bubbles graph')
          : t('xDash.tokenDrawer.socialGraph', 'Social graph')}
      >
        {loading && !voices ? (
          <span className="xd-minibubble__hub xd-minibubble__hub--skeleton" />
        ) : voices === 0 ? (
          <span className="xd-minibubble__empty xd-muted">
            {t('xDash.tokenDrawer.noGraph', 'No social graph yet')}
          </span>
        ) : (
          <>
            <svg className="xd-minibubble__links" viewBox="0 0 100 100" preserveAspectRatio="none">
              {placed.map(({ node, cx, cy }) => (
                <line
                  key={node.id}
                  x1="50" y1="50" x2={cx} y2={cy}
                  stroke={nodeColor(node)} strokeOpacity="0.28" strokeWidth="0.4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>

            {placed.map(({ node, cx, cy, size }) => (
              <span
                key={node.id}
                className="xd-minibubble__node"
                style={{ left: `${cx}%`, top: `${cy}%`, width: size, height: size, '--ring': nodeColor(node) }}
                title={node.name || node.handle || ''}
              >
                {node.avatar
                  ? <img src={node.avatar} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  : <span className="xd-minibubble__node-fallback">{(node.name || node.handle || '?')[0]}</span>}
              </span>
            ))}

            <span className="xd-minibubble__hub" style={{ '--ring': hub ? nodeColor(hub) : '#5AA6FF' }}>
              {hubLogo
                ? <img src={hubLogo} alt={label} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                : <span className="xd-minibubble__node-fallback">{(label || '?')[0]}</span>}
            </span>

            {canOpenFull && (
              <span className="xd-minibubble__hint">{t('xDash.tokenDrawer.clickToExplore', 'Click to explore')}</span>
            )}
          </>
        )}
      </button>
    </div>
  )
}
