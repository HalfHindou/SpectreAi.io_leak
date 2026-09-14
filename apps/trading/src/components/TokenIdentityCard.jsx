/**
 * TokenIdentityCard — Iteration 3 §4 identity card with the token's
 * real X (Twitter) banner image as personalised atmosphere.
 *
 * Layer stack (bottom → top):
 *   1. `.tic-banner-img`     X profile banner via /api/img-proxy
 *   2. `.tic-banner-scrim`   vertical gradient fading image to transparent
 *   3. `.tic-banner-tint`    multiply tint toward --accent (low alpha)
 *   4. `.banner-grid`        existing dotgrid texture
 *   5. `.banner-gradient-overlay` + `.banner-accent-glow`  procedural
 *      radials (kept as fallback when no bannerUrl; dimmed when present)
 *   6. `.banner-content`     logo + symbol + name + chain badge + particles
 *
 * Data:
 *   - `data?.socials?.bannerUrl` is the §II.10 backend additive. Until
 *     the dossier service ships that field, render the procedural
 *     fallback (current behaviour). Forward-compat: no client change
 *     needed when the field lands.
 *
 * Parallax:
 *   - The banner image layer translates by a few pixels against the
 *     pointer position. Disabled under reduced-motion or pointer:coarse.
 *   - rAF-driven inline style writes only; no React state.
 */

import React, { useEffect, useRef, useState } from 'react'
import useDossier from '../hooks/useDossier'
import useXProfile from '../hooks/useXProfile'
import { ChainIcon, getChainAccent } from '../utils/chainIcons'
import { getHardcodedLogo, getNetworkName } from '../services/codexApi'
import { tokenPlaceholder } from '../utils/tokenPlaceholder'
import './TokenIdentityCard.css'

// Identity-banner image must be CORS-proxied for the duotone tint to
// composite cleanly. Pre-existing `/api/img-proxy` already used by
// extractColorFromImage in tokenColors.js — reuse same endpoint.
function proxyUrl(url) {
  if (!url) return ''
  if (url.startsWith('/api/img-proxy')) return url
  return `/api/img-proxy?url=${encodeURIComponent(url)}`
}

// Lightweight sanitiser — strips spammy suffixes like " (Wrapped)".
function sanitize(s) {
  if (!s) return ''
  return String(s).replace(/\s*\((wrapped|w)\)\s*/i, '').trim()
}

function TokenIdentityCard({
  token,
  liveTokenData,
  bannerColor,
  isReady,
  onLogoClick,
  onCustomizeClick,
}) {
  const cardRef = useRef(null)
  const imgRef = useRef(null)
  // Default to "loaded" so cached / local logo URLs (most common case)
  // don't sit at opacity 0 forever when onLoad doesn't fire after a
  // remount. onError flips this back off if the image actually fails.
  const [bannerLoaded, setBannerLoaded] = useState(true)
  const [bannerErrored, setBannerErrored] = useState(false)
  const { data: dossier } = useDossier(token)

  // X profile banner via Alaa's get_official_tweets endpoint — same source
  // the X Intelligence hero (ProjectHeroCard) uses. The Twitter handle comes
  // from Codex's tokenInfo (liveTokenData.socials.twitter), falling back to
  // the dossier's socials when the live data is still hydrating. The hook
  // accepts a bare handle, "@handle", or a full x.com/twitter.com URL.
  const twitterRaw =
    liveTokenData?.socials?.twitter ||
    dossier?.socials?.twitter ||
    null
  const { banner: xBannerUrl } = useXProfile(twitterRaw)

  // Source priority for the banner image layer:
  //   1. Real X profile banner from Alaa's API (the photographic banner)
  //   2. Dossier-supplied bannerUrl (when Sunny's dossier service ships it)
  //   3. Procedural fallback (logo-as-banner + accent-gradient mesh)
  const bannerUrl =
    xBannerUrl ||
    dossier?.socials?.bannerUrl ||
    dossier?.identity?.bannerUrl ||
    null
  const hasBanner = !!bannerUrl && !bannerErrored

  const logoUrl =
    getHardcodedLogo(token?.address) ||
    liveTokenData?.logo ||
    token?.logo ||
    tokenPlaceholder(token?.symbol, 80)

  // Pick the source for the banner image layer:
  //   1. Real X banner from dossier (§4 ideal case, blocked on T5 backend)
  //   2. Logo-as-banner fallback — heavily blurred + duotone tinted via CSS
  //      so every token has a brand-specific atmospheric backdrop today
  //   3. None — pure procedural radials
  const bannerSrc = hasBanner
    ? proxyUrl(bannerUrl)
    : (logoUrl || null)
  const bannerKind = hasBanner ? 'xbanner' : 'logo'

  // Reset banner state when the source URL changes.
  // We OPTIMISTICALLY start as loaded (covers the cached-img case where
  // onLoad never fires); the natural CSS opacity transition + onError
  // handler keep the visual honest if the source fails.
  useEffect(() => {
    setBannerLoaded(true)
    setBannerErrored(false)
    // Belt-and-braces: if the img element is already complete (cached),
    // onLoad may have fired BEFORE the React handler attached. Confirm
    // load state from the DOM after mount.
    const img = imgRef.current
    if (img) {
      if (img.complete && img.naturalWidth === 0) {
        // complete but no pixels = actually broken
        setBannerErrored(true)
      }
    }
  }, [bannerSrc])

  // Parallax — ONLY for the real X banner variant. The logo-fallback
  // uses a CSS keyframe drift + scale(2.2) for life, and a JS transform
  // override here would clobber both. The two motion paths are exclusive
  // by `bannerKind`.
  useEffect(() => {
    if (bannerKind !== 'xbanner') return
    const card = cardRef.current
    const img = imgRef.current
    if (!card || !img) return
    if (typeof window !== 'undefined') {
      if (window.matchMedia('(pointer: coarse)').matches) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    }
    const appRoot = document.querySelector('.app')
    if (appRoot?.getAttribute('data-reduced-motion') === 'true') return

    let rafId = 0
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0

    const onMove = (e) => {
      const rect = card.getBoundingClientRect()
      const nx = ((e.clientX - rect.left) / rect.width  - 0.5) * 2
      const ny = ((e.clientY - rect.top)  / rect.height - 0.5) * 2
      targetX = nx * 6
      targetY = ny * 4
      if (!rafId) rafId = requestAnimationFrame(tick)
    }
    const onLeave = () => {
      targetX = 0
      targetY = 0
      if (!rafId) rafId = requestAnimationFrame(tick)
    }
    const tick = () => {
      currentX += (targetX - currentX) * 0.18
      currentY += (targetY - currentY) * 0.18
      img.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0) scale(1.06)`
      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        rafId = requestAnimationFrame(tick)
      } else {
        rafId = 0
      }
    }
    card.addEventListener('mousemove', onMove)
    card.addEventListener('mouseleave', onLeave)
    return () => {
      card.removeEventListener('mousemove', onMove)
      card.removeEventListener('mouseleave', onLeave)
      if (rafId) {
        cancelAnimationFrame(rafId)
        // Reset inline transform so a future variant switch starts clean.
        img.style.transform = ''
      }
    }
  }, [bannerKind, bannerSrc])

  const c = bannerColor

  return (
    <div
      ref={cardRef}
      className={[
        'token-banner-section',
        'tic',
        `tic--${bannerKind}`,
        bannerLoaded && 'tic--has-banner',
      ].filter(Boolean).join(' ')}
      data-color-ready={isReady ? 'true' : 'false'}
      style={{ '--banner-accent': c }}
    >
      <div className="token-banner-dynamic">
        {/* Banner image layer. Real X banner when present (full photographic
            atmosphere), otherwise the token's own logo treated as
            atmospheric backdrop (heavy blur + saturate + scale + drift)
            so monochrome tokens still get a brand-feeling card. */}
        {bannerSrc && (
          <>
            <img
              ref={imgRef}
              src={bannerSrc}
              alt=""
              className={`tic-banner-img tic-banner-img--${bannerKind}`}
              onLoad={() => setBannerLoaded(true)}
              onError={() => setBannerErrored(true)}
              aria-hidden="true"
            />
            <div className="tic-banner-scrim" aria-hidden="true" />
            <div
              className="tic-banner-tint"
              aria-hidden="true"
              style={{ background: `var(--accent)` }}
            />
            <div className="tic-banner-grain" aria-hidden="true" />
          </>
        )}

        {/* Procedural radials — sit BEHIND the banner-img layer so they
            tint the corners regardless of which source is rendering. */}
        <div className="banner-gradient-overlay" style={{
          background: `
            radial-gradient(ellipse at 18% 14%, color-mix(in oklab, ${c} 24%, transparent) 0%, transparent 55%),
            radial-gradient(ellipse at 88% 82%, color-mix(in oklab, ${c} 14%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse at 50% 50%, transparent 0%, rgba(8, 8, 12, 0.86) 85%),
            linear-gradient(135deg, color-mix(in oklab, ${c} 9%, transparent) 0%, transparent 50%)`
        }} />
        <div className="banner-grid" />
        <div className="banner-accent-glow" style={{
          background: `radial-gradient(circle at 15% 30%, color-mix(in oklab, ${c} 16%, transparent) 0%, transparent 60%)`
        }} />
        <div className="banner-shine" />

        <div className="banner-content">
          <div className="banner-logo-shell">
            <span className="banner-logo-ring" aria-hidden="true" />
            <img
              src={logoUrl}
              alt={token?.symbol}
              className="banner-token-logo"
              onClick={onLogoClick}
              onError={(e) => { e.target.src = tokenPlaceholder(token?.symbol, 80) }}
              title="Click to view full"
            />
            <span className="banner-live-status" aria-hidden="true" />
          </div>
          <div className="banner-info">
            <span className="banner-symbol">{sanitize(liveTokenData?.symbol || token?.symbol)}</span>
            <span className="banner-name">{sanitize(liveTokenData?.name || token?.name)}</span>
            <span
              className="banner-network"
              style={{ '--chain-accent': getChainAccent(token?.networkId) }}
            >
              <span className="banner-network-icon">
                <ChainIcon networkId={token?.networkId} size={12} />
              </span>
              {getNetworkName(token?.networkId)}
            </span>
          </div>
        </div>

        {/* Customize button — preserved (Premium tease) */}
        <button
          className="banner-customize-btn"
          title="Customize your token banner (Premium)"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onCustomizeClick?.()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="btn-text">Customize</span>
          <span className="premium-badge">PRO</span>
        </button>

        <div className="banner-particles">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="particle" style={{ '--i': i }} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default React.memo(TokenIdentityCard)
