/**
 * XFullView - Project X Intelligence Dashboard
 *
 * Fullscreen Wall-Street-meets-Apple terminal pinned to the currently selected
 * token. Layout:
 *
 *   ROW 1 - ProjectHeroCard      (full-width profile + metrics + alpha pills)
 *   ROW 2 - Insights grid         (KOL | Narrative | Timeline | Alpha — 4-col)
 *   ROW 3 - LiveFeedPanel         (FULL WIDTH — dominant cinematic feed)
 *
 * Launched from LeftPanel's compact X tab via the full-view button.
 * Rendered via createPortal to document.body so it escapes the panel layout.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './XFullView.css'
import './XFullView.day-mode.css'

import useXDashTokenIntel from './hooks/useXDashTokenIntel'
import useXDashNarrativePeers from './hooks/useXDashNarrativePeers'
import useOnChainPeerData from './hooks/useOnChainPeerData'
import useCodexDrawdown from './hooks/useCodexDrawdown'
import useAlphaSignals from './hooks/useAlphaSignals'
import useXfvTooltip from './hooks/useXfvTooltip'
import { rugSignalFromXDash } from './rug-signal'

import ProjectHeroCard from './components/ProjectHeroCard'
import LiveFeedPanel from './components/LiveFeedPanel'
import KOLLeaderboardPanel from './components/KOLLeaderboardPanel'
import NarrativePeersPanel from './components/NarrativePeersPanel'
import MentionTimelinePanel from './components/MentionTimelinePanel'
import AlphaSignalCard from './components/AlphaSignalCard'

function XFullView({ token, onClose, tweetsData }) {
  const contentRef = useRef(null)

  // Mount the global tooltip portal that powers `[data-xfv-tip]` on hover.
  // Lives on document.body so it escapes panel-body overflow clipping.
  useXfvTooltip()

  // Fetch X Dash token intel — this is the master data source
  const { data: intel, loading: intelLoading, error: intelError, resolvedCgId } =
    useXDashTokenIntel(token, { pollIntervalMs: 90_000 })

  // Derive narrative slug from intel response. The X Dash response carries
  // the token metadata at `data.asset` (and a duplicate at `data.token.token`).
  // The canonical label is `primary_category`; we fall back through segment
  // and the category/tag arrays before giving up.
  const assetMeta = intel?.asset || intel?.token?.token || intel?.token || null
  const narrative =
    assetMeta?.primary_category ||
    assetMeta?.segment ||
    (Array.isArray(assetMeta?.category) ? assetMeta.category[0] : assetMeta?.category) ||
    (Array.isArray(assetMeta?.tags) ? assetMeta.tags[0] : null) ||
    assetMeta?.narrative ||
    (Array.isArray(assetMeta?.narratives) ? assetMeta.narratives[0] : null) ||
    null

  // Peer tokens in the same narrative
  const { peers, loading: peersLoading } = useXDashNarrativePeers(narrative, resolvedCgId, {
    pollIntervalMs: 300_000,
    perPage: 8,
  })

  // On-chain stats (price, volume) from the existing context — no extra fetch
  const onChainStats = useOnChainPeerData()
  // Longer-window collapse + off-high from Codex daily bars (one cached getBars).
  const drawdown = useCodexDrawdown(token?.address, token?.networkId || 1)

  // Pure derivation: alpha insights
  const alphaSignals = useAlphaSignals({ tokenIntel: intel, peers, onChainStats })

  // Rug WARNING — collapse / liquidity death / rug chatter (defensive label).
  const rug = rugSignalFromXDash(intel, onChainStats, drawdown)

  // ESC to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Lock body scroll while modal open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  if (!token) return null

  // Token identity strings (used in header)
  const tokenSymbol = token.symbol || '...'
  const tokenName = token.name || ''
  const author = tweetsData?.author || null
  const tokenHandle =
    author?.screen_name ||
    intel?.token?.twitter_handle ||
    intel?.token?.handle ||
    null

  return createPortal(
    <div className="xfv-overlay" role="dialog" aria-modal="true" aria-label="X Intelligence Dashboard">
      {/* Backdrop */}
      <div className="xfv-backdrop" onClick={onClose} aria-hidden="true" />

      {/* Sticky header */}
      <header className="xfv-header">
        <div className="xfv-header-identity">
          <div className="xfv-header-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </div>
          <div className="xfv-header-titles">
            <div className="xfv-header-title">
              <span className="xfv-header-symbol">{tokenSymbol}</span>
              {tokenName && tokenName !== tokenSymbol && (
                <span className="xfv-header-name">{tokenName}</span>
              )}
              {tokenHandle && <span className="xfv-header-handle">@{tokenHandle}</span>}
            </div>
            <div className="xfv-header-sub">
              <span className="xfv-live-dot" aria-hidden="true" />
              <span>X Intelligence</span>
              {resolvedCgId && <span className="xfv-header-cgid">{resolvedCgId}</span>}
            </div>
          </div>
        </div>

        <button type="button" className="xfv-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <span className="xfv-close-hint">ESC</span>
        </button>
      </header>

      {/* Content */}
      <main className="xfv-content" ref={contentRef}>
        {/* Row 1 — Project hero card */}
        <section className="xfv-row xfv-row-hero">
          <ProjectHeroCard
            token={token}
            intel={intel}
            author={author}
            alphaSignals={alphaSignals}
            rug={rug}
          />
        </section>

        {/* Row 2 — Main grid: insight rails flank the live feed so the full
            width carries content (was: 4-up strip + a lone centered feed
            column with empty flanks). Rails stack under/over the feed on
            narrower viewports via CSS. */}
        <section className="xfv-row xfv-row-main">
          <div className="xfv-rail xfv-rail-left">
            <KOLLeaderboardPanel intel={intel} loading={intelLoading} />
            <NarrativePeersPanel
              narrative={narrative}
              peers={peers}
              loading={peersLoading}
              selfCgId={resolvedCgId}
            />
          </div>
          <div className="xfv-feed-col">
            <LiveFeedPanel token={token} tweetsData={tweetsData} intel={intel} />
          </div>
          <div className="xfv-rail xfv-rail-right">
            <MentionTimelinePanel intel={intel} loading={intelLoading} />
            <AlphaSignalCard signals={alphaSignals} />
          </div>
        </section>

        {/* Footer hint */}
        <footer className="xfv-footer">
          <span>Press ESC to close</span>
        </footer>
      </main>
    </div>,
    document.body
  )
}

export default XFullView
