/**
 * XDashColumn — inline X Dash intelligence for the LeftPanel "X Dash" tab.
 *
 * A vertical, single-column distillation of the fullscreen XFullView, pinned
 * to the currently selected token. Reuses the exact same hooks + panel
 * components as the full view (no duplicated data logic) but stacks them for
 * the narrow left column and analyzes "project social activity":
 *
 *   - ProjectHeroCard      profile + key X metrics (mentions, velocity, KOLs…)
 *   - AlphaSignalCard      rule-based insights (velocity spike, quality, etc.)
 *   - KOLLeaderboardPanel  who is carrying the chatter
 *   - MentionTimelinePanel mention cadence over time
 *   - NarrativePeersPanel  peers in the same narrative
 *
 * The full live feed + 4-up grid lives behind the "Open full X Intelligence"
 * button, which opens the existing XFullView portal (onExpand).
 */
import { memo } from 'react'

import useXDashTokenIntel from './hooks/useXDashTokenIntel'
import useXDashNarrativePeers from './hooks/useXDashNarrativePeers'
import useOnChainPeerData from './hooks/useOnChainPeerData'
import useCodexDrawdown from './hooks/useCodexDrawdown'
import useAlphaSignals from './hooks/useAlphaSignals'
import useXfvTooltip from './hooks/useXfvTooltip'

import AlphaSignalCard from './components/AlphaSignalCard'
import SignalScorePanel from './components/SignalScorePanel'
import KOLLeaderboardPanel from './components/KOLLeaderboardPanel'
import MentionTimelinePanel from './components/MentionTimelinePanel'
import NarrativePeersPanel from './components/NarrativePeersPanel'
import { withXDashCgId } from './xdash-overrides'
import { fadeSignalFromXDash, FADE_LABELS } from './fade-signal'
import { attentionPhaseFromXDash, PHASE_LABELS } from './attention-signals'
import { rugSignalFromXDash } from './rug-signal'

// The reused panels/hero are styled by XFullView.css — load it here so the
// .xfv-* classes are styled even when the fullscreen XFullView never mounts.
import './XFullView.css'
import './XFullView.day-mode.css'
import './XDashColumn.css'

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function fmtCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function upgradeAvatar(url) {
  return url && typeof url === 'string'
    ? url.replace(/_normal\.(jpg|png|jpeg|webp|gif)/i, '_200x200.$1')
    : url
}

function XDashColumn({ token, tweetsData, onExpand }) {
  // Mount the global tooltip portal that powers `[data-xfv-tip]` on hover.
  useXfvTooltip()

  // Pin ambiguous-ticker tokens to the correct X Dash cg_id (e.g. $ANSEM ->
  // the-black-bull) before resolution — resolveCgId() honors token.cgId first.
  const xdashToken = withXDashCgId(token)

  // Master data source — resolves cgId and polls /api/x-dash/token/:cgId.
  const { data: intel, loading, error, resolvedCgId } =
    useXDashTokenIntel(xdashToken, { pollIntervalMs: 90_000 })

  // Narrative slug derivation — identical fallthrough to XFullView/index.jsx.
  const assetMeta = intel?.asset || intel?.token?.token || intel?.token || null
  const narrative =
    assetMeta?.primary_category ||
    assetMeta?.segment ||
    (Array.isArray(assetMeta?.category) ? assetMeta.category[0] : assetMeta?.category) ||
    (Array.isArray(assetMeta?.tags) ? assetMeta.tags[0] : null) ||
    assetMeta?.narrative ||
    (Array.isArray(assetMeta?.narratives) ? assetMeta.narratives[0] : null) ||
    null

  const { peers, loading: peersLoading } = useXDashNarrativePeers(narrative, resolvedCgId, {
    pollIntervalMs: 300_000,
    perPage: 6,
  })

  const onChainStats = useOnChainPeerData()
  // Longer-window collapse + off-high from Codex daily bars — feeds the rug
  // signal so an already-dead token (24h flat, but -90% over 7d/off ATH) trips.
  const drawdown = useCodexDrawdown(token?.address, token?.networkId || 1)
  const alphaSignals = useAlphaSignals({ tokenIntel: intel, peers, onChainStats })

  const author = tweetsData?.author || null

  if (!token) {
    return (
      <div className="xdc xdc--state">
        <div className="xfv-empty">Select a token to see its X intelligence.</div>
      </div>
    )
  }

  const symbol = token.symbol || '—'
  const showSkeleton = loading && !intel
  const notIndexed = !loading && !intel

  // Clean compact hero — identity + a tight 4-metric strip. Replaces the heavy
  // social-profile card (banner/bio/follow-buttons/tag-pills) for a premium,
  // on-brand column header.
  const asset = intel?.asset || intel?.token?.token || intel?.token || {}
  const hm = intel?.metrics || intel?.token?.metrics || {}
  const hq = intel?.quality || intel?.token?.quality || {}
  const heroName = author?.name || asset.name || token?.name || token?.symbol || '—'
  const heroAvatar =
    upgradeAvatar(author?.avatar_image_url) ||
    asset.image_large || asset.image_url || token?.logo || '/round-logo.png'
  const heroVerified = !!(author?.account_state?.is_blue_verified || asset.is_blue_verified)
  const heroFollowers = num(author?.counts?.followers_count ?? asset.twitter_followers)
  const heroCat = asset.primary_category || narrative
  const heroCashtag = asset.cashtag || (token?.symbol ? `$${token.symbol}` : null)
  // Rug WARNING — catastrophic collapse / liquidity death / rug chatter. Takes
  // priority over every other read: a rugged token must never read as bullish.
  const rug = rugSignalFromXDash(intel, onChainStats, drawdown)
  // Fade / bearish signal — loud attention + price dip and/or promo chatter.
  const fade = rug.tag ? { tag: null } : fadeSignalFromXDash(intel, onChainStats?.priceChange24h)
  // Attention-lifecycle phase (ignition/coiling/exhaustion) — shown only when
  // there's no rug + no fade RISK tag, so the badge slot carries at most one read.
  const attn = (rug.tag || fade.tag) ? null : attentionPhaseFromXDash(intel, onChainStats?.priceChange24h)

  const heroMetrics = [
    { label: 'Mentions 24h', value: fmtCompact(num(hm.mentions_24h)) },
    { label: 'Velocity', value: num(hm.velocity_ratio) > 0 ? `${num(hm.velocity_ratio).toFixed(2)}x` : '—' },
    { label: 'KOLs 24h', value: fmtCompact(num(hm.unique_external_authors_24h ?? hm.unique_authors)) },
    { label: 'Signal', value: num(hq.clean_signal_score) > 0 ? `${Math.round(num(hq.clean_signal_score) * 100)}%` : '—' },
  ]

  return (
    <div className="xdc">
      <header className="xdc-head">
        <div className="xdc-head-id">
          <span className="xdc-head-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </span>
          <div className="xdc-head-titles">
            <span className="xdc-head-symbol">${symbol}</span>
            <span className="xdc-head-sub">
              <span className="xdc-live-dot" aria-hidden="true" />
              X Intelligence
              {resolvedCgId && <span className="xdc-cgid">{resolvedCgId}</span>}
            </span>
          </div>
        </div>
        {onExpand && (
          <button
            type="button"
            className="xdc-expand"
            onClick={onExpand}
            title="Open full X Intelligence"
            aria-label="Open full X Intelligence"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        )}
      </header>

      <div className="xdc-body">
        {showSkeleton ? (
          <div className="xdc-skeleton">
            <div className="xdc-skel xdc-skel--hero" />
            <div className="xdc-skel xdc-skel--panel" />
            <div className="xdc-skel xdc-skel--panel" />
          </div>
        ) : notIndexed ? (
          <div className="xdc-notindexed">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35M8 11h6" />
            </svg>
            <strong>Not tracked by X Dash yet</strong>
            <span>{error || 'No X intelligence indexed for this token.'}</span>
          </div>
        ) : (
          <>
            <section className="xdh">
              <div className="xdh-id">
                <img
                  className="xdh-avatar"
                  src={heroAvatar}
                  alt=""
                  loading="lazy"
                  onError={(e) => { e.currentTarget.src = '/round-logo.png' }}
                />
                <div className="xdh-id-text">
                  <div className="xdh-name-row">
                    <span className="xdh-name">{heroName}</span>
                    {heroVerified && (
                      <svg className="xdh-vf" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                        <path d="M9 16.17l-3.88-3.88L3.7 13.7 9 19l11-11-1.41-1.42z" />
                      </svg>
                    )}
                    {rug.tag && (
                      <span className={`xdh-rug xdh-rug--${rug.tier}`} title={rug.thesis}>
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <path d="M12 9v4M12 17h.01" />
                        </svg>
                        {rug.label}
                      </span>
                    )}
                    {fade.tag && (
                      <span className={`xdh-fade xdh-fade--${fade.tag}`} title={fade.thesis}>
                        {fade.tag === 'bearish' ? '▼ ' : '⚠ '}{FADE_LABELS[fade.tag]}
                      </span>
                    )}
                    {attn?.phase && (
                      <span className={`xdh-attn xdh-attn--${attn.phase}`} title={attn.thesis}>
                        {attn.phase === 'ignition' ? '▲ ' : attn.phase === 'coiling' ? '◇ ' : '◞ '}{PHASE_LABELS[attn.phase]}
                      </span>
                    )}
                  </div>
                  <div className="xdh-meta">
                    {heroCashtag && <span className="xdh-cashtag">{heroCashtag}</span>}
                    {heroFollowers > 0 && <span className="xdh-meta-item">{fmtCompact(heroFollowers)} followers</span>}
                    {heroCat && <span className="xdh-meta-item xdh-cat">{heroCat}</span>}
                  </div>
                </div>
              </div>
              <div className="xdh-metrics">
                {heroMetrics.map((mm) => (
                  <div key={mm.label} className="xdh-metric">
                    <span className="xdh-metric-val">{mm.value}</span>
                    <span className="xdh-metric-lbl">{mm.label}</span>
                  </div>
                ))}
              </div>
              {rug.tag ? (
                <div className="xdh-fade-thesis xdh-fade-thesis--rug">{rug.thesis}</div>
              ) : fade.tag ? (
                <div className={`xdh-fade-thesis xdh-fade-thesis--${fade.tag}`}>{fade.thesis}</div>
              ) : null}
            </section>
            <SignalScorePanel intel={intel} />
            <AlphaSignalCard signals={alphaSignals} />
            <KOLLeaderboardPanel intel={intel} loading={loading} />
            <MentionTimelinePanel intel={intel} loading={loading} />
            <NarrativePeersPanel
              narrative={narrative}
              peers={peers}
              loading={peersLoading}
              selfCgId={resolvedCgId}
            />
            {onExpand && (
              <button type="button" className="xdc-fullcta" onClick={onExpand}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
                <span>Open full X Intelligence</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default memo(XDashColumn)
