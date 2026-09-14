/**
 * TokenLogo — circular token avatar with a corner chain-badge clip.
 *
 * The chain badge is a small ~14px SVG of the actual chain brand logo
 * (Ethereum diamond, Solana gradient bars, BSC diamond, etc.) clipped
 * to the bottom-right corner of the avatar. Inline SVG = no vendor
 * asset dependency, native + modern feel.
 *
 * Props
 *   address:   token contract address (used only for chain inference if
 *              networkId is missing)
 *   networkId: Codex networkId; 1 = ETH, 56 = BSC, 137 = Polygon,
 *              42161 = Arbitrum, 8453 = Base, 10 = Optimism, 43114 =
 *              Avalanche, 1399811149 = Solana
 *   logo:      URL string. Falls back to a letter when missing / errors.
 *   symbol:    used for the letter fallback (first char).
 *   size:      pixel size of the avatar (default 32).
 *   showChain: render the corner chain badge (default true).
 *   eager:     opt out of lazy loading for above-the-fold avatars (banner,
 *              header) that should start downloading in the first frame.
 *   className: optional extra class.
 *
 * Loading cost (measured 2026-07-22): token logos come straight off
 * token-media.defined.fi, which is raw S3 with no CDN edge - 600-900ms TTFB
 * per image from Europe regardless of the 2-11KB payload. A 30-50 row list
 * used to fire every avatar in the first frame. `loading="lazy"` keeps
 * off-screen rows off the wire entirely, `decoding="async"` keeps the decode
 * off the main thread, and the intrinsic width/height stop the reflow that
 * a late-arriving image otherwise causes.
 */
import React, { useState } from 'react'
import './TokenLogo.css'

// Codex networkId → chain meta (label only; brand glyphs below)
const CHAIN_META = {
  1:           { label: 'Ethereum' },
  56:          { label: 'BNB Chain' },
  137:         { label: 'Polygon' },
  42161:       { label: 'Arbitrum' },
  8453:        { label: 'Base' },
  10:          { label: 'Optimism' },
  43114:       { label: 'Avalanche' },
  4663:        { label: 'Robinhood' },
  1399811149:  { label: 'Solana' },
}

// Address-shape fallback when networkId is missing.
function inferChainId(networkId, address) {
  if (networkId && CHAIN_META[networkId]) return networkId
  if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) return 1
  if (address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return 1399811149
  return null
}

// Inline SVG brand glyphs — each renders the full chain logo at any
// size. The corner badge slot scales them down to ~14px. Sources are
// official brand marks redrawn as minimal single-SVG paths so they
// stay crisp at small sizes and don't pull in external assets.
function ChainGlyph({ chainId }) {
  if (chainId === 1) {
    // Ethereum — classic two-tone diamond
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#627EEA"/>
        <g fill="#fff" fillRule="nonzero">
          <path fillOpacity=".6" d="M16.498 4v8.87l7.497 3.35z"/>
          <path d="M16.498 4L9 16.22l7.498-3.35z"/>
          <path fillOpacity=".6" d="M16.498 21.968v6.027L24 17.616z"/>
          <path d="M16.498 27.995v-6.028L9 17.616z"/>
          <path fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497-3.348z"/>
          <path fillOpacity=".6" d="M9 16.22l7.498 4.353v-7.701z"/>
        </g>
      </svg>
    )
  }
  if (chainId === 56) {
    // BNB Chain — yellow circle + diamond
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#F3BA2F"/>
        <path fill="#fff" d="M12.116 14.404L16 10.52l3.886 3.886 2.26-2.26L16 6l-6.144 6.144 2.26 2.26zM6 16l2.26-2.26L10.52 16l-2.26 2.26L6 16zm6.116 1.596L16 21.48l3.886-3.886 2.26 2.259L16 26l-6.144-6.144-.003-.003 2.263-2.257zM21.48 16l2.26-2.26L26 16l-2.26 2.26L21.48 16zm-3.188-.002h.002V16L16 18.294 13.708 16.003l-.004-.004.004-.003.402-.402.195-.195L16 13.706l2.293 2.293z"/>
      </svg>
    )
  }
  if (chainId === 137) {
    // Polygon — purple hexagonal P-mark
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#8247E5"/>
        <path fill="#fff" d="M20.6 13.42c-.33-.19-.75-.19-1.12 0l-2.62 1.55-1.78 1-2.58 1.55c-.33.19-.75.19-1.12 0L9.36 16.3c-.33-.19-.55-.55-.55-.95v-2.39c0-.36.19-.72.55-.95l2.02-1.16c.33-.19.75-.19 1.12 0l2.02 1.2c.33.19.55.55.55.95v1.55l1.78-1.04v-1.59c0-.36-.19-.72-.55-.95l-3.76-2.2c-.33-.19-.75-.19-1.12 0L7.6 11.13c-.37.19-.55.55-.55.91v4.36c0 .36.19.72.55.95l3.83 2.2c.33.19.75.19 1.12 0l2.58-1.51 1.78-1.04 2.58-1.51c.33-.19.75-.19 1.12 0l2.02 1.16c.33.19.55.55.55.95v2.39c0 .36-.19.72-.55.95l-2.02 1.2c-.33.19-.75.19-1.12 0l-2.02-1.16c-.33-.19-.55-.55-.55-.95v-1.55l-1.78 1.04v1.55c0 .36.19.72.55.95l3.83 2.2c.33.19.75.19 1.12 0l3.83-2.2c.33-.19.55-.55.55-.95v-4.4c0-.36-.19-.72-.55-.95l-3.87-2.2z"/>
      </svg>
    )
  }
  if (chainId === 42161) {
    // Arbitrum — blue circle + A mark
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#28A0F0"/>
        <path fill="#fff" d="M14.83 9.06l-2.04 5.59 4.04 6.71L19.6 19.5l-4.77-10.44zm.93 12.94l-1.39-1.4 2.46-4.03 3.79 6.21h-2.43l-2.43-.78zm-5.79 0L8.5 19.13l4.47-9.54 1.85 1.42-4.83 11.04-.02-.05z"/>
      </svg>
    )
  }
  if (chainId === 8453) {
    // Base — blue circle + white inner shape (Base's logo is essentially a blue circle)
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#0052FF"/>
        <path fill="#fff" d="M15.96 27c6.075 0 11-4.925 11-11s-4.925-11-11-11C10.196 5 5.473 9.43 5 15.063h14.587v1.874H5C5.473 22.57 10.196 27 15.96 27z"/>
      </svg>
    )
  }
  if (chainId === 10) {
    // Optimism — red circle + O
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#FF0420"/>
        <path fill="#fff" d="M11.55 19.93c-1.06 0-1.93-.25-2.61-.74-.67-.5-1-1.22-1-2.13 0-.19.02-.42.06-.7.11-.62.27-1.36.47-2.23.58-2.34 2.06-3.51 4.46-3.51.65 0 1.24.11 1.75.33.52.21.93.54 1.23.97.3.43.45.94.45 1.54 0 .18-.02.41-.06.69-.12.76-.28 1.5-.46 2.23-.3 1.16-.81 2.04-1.55 2.62-.74.59-1.66.88-2.74.88zm.18-1.81c.42 0 .77-.12 1.07-.37.3-.25.51-.63.64-1.15.2-.78.34-1.46.44-2.03.04-.18.05-.36.05-.55 0-.78-.41-1.17-1.23-1.17-.41 0-.77.12-1.07.37-.3.25-.51.63-.64 1.15-.18.74-.32 1.42-.43 2.03-.04.17-.06.36-.06.55 0 .78.41 1.17 1.23 1.17zm5.06 1.66c-.09 0-.16-.03-.21-.09-.04-.06-.05-.13-.04-.21l1.85-8.7c.02-.09.06-.16.12-.21.07-.05.14-.08.22-.08h3.55c.99 0 1.79.21 2.39.62.61.41.91.99.91 1.75 0 .22-.03.45-.08.69-.21.99-.65 1.73-1.31 2.21-.65.48-1.55.72-2.69.72h-1.8l-.62 2.94c-.03.09-.07.16-.14.21-.06.05-.14.08-.22.08l-1.93-.13zm3.4-4.81c.36 0 .68-.1.95-.3.27-.2.45-.49.53-.86.03-.15.04-.27.04-.39 0-.25-.08-.43-.23-.55-.15-.13-.41-.19-.78-.19h-1.59l-.49 2.29h1.57z"/>
      </svg>
    )
  }
  if (chainId === 43114) {
    // Avalanche — red triangle
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#E84142"/>
        <path fill="#fff" d="M21.45 17.32h2.97c.6 0 .89 0 1.08-.1.21-.13.34-.36.34-.6 0-.2-.18-.51-.5-1.07l-3.45-5.95c-.34-.59-.52-.88-.74-.99a.97.97 0 00-.86 0c-.22.11-.4.4-.74.99l-.78 1.35-.02.02c-.37.66-.55.99-.63 1.34-.09.39-.09.79 0 1.18.09.36.27.69.63 1.34l1.88 3.32c.34.6.51.91.74 1.02.24.12.53.12.77 0 .23-.11.4-.41.74-1.01l.57-1.84zm-12.86 0c.6 0 .89 0 1.08-.1.21-.13.34-.36.34-.6 0-.2-.18-.51-.5-1.07l-1.93-3.34c-.34-.59-.52-.88-.74-.99a.97.97 0 00-.86 0c-.22.11-.4.4-.74.99l-1.93 3.34c-.34.59-.5.89-.5 1.07 0 .24.13.47.34.6.21.11.5.1 1.08.1H8.59z"/>
      </svg>
    )
  }
  if (chainId === 1399811149) {
    // Solana — gradient bars
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="solGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9945FF"/>
            <stop offset="50%" stopColor="#8752F3"/>
            <stop offset="100%" stopColor="#14F195"/>
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill="#000"/>
        <path fill="url(#solGrad)" d="M9.93 19.94c.16-.16.39-.25.62-.25h14.07c.4 0 .59.48.31.76l-2.78 2.78c-.16.16-.39.25-.62.25H7.46c-.4 0-.59-.48-.31-.76l2.78-2.78zm0-10.4c.16-.16.39-.25.62-.25h14.07c.4 0 .59.48.31.76L22.15 12.83c-.16.16-.39.25-.62.25H7.46c-.4 0-.59-.48-.31-.76l2.78-2.78zm12.22 5.18c-.16-.16-.39-.25-.62-.25H7.46c-.4 0-.59.48-.31.76l2.78 2.78c.16.16.39.25.62.25h14.07c.4 0 .59-.48.31-.76l-2.78-2.78z"/>
      </svg>
    )
  }
  if (chainId === 4663) {
    // Robinhood Chain — green circle + feather quill
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#00C805"/>
        <g transform="translate(5.5 5.5) scale(0.875)" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
          <path d="M16 8L2 22"/>
          <path d="M17.5 15H9"/>
        </g>
      </svg>
    )
  }
  return null
}

function TokenLogo({
  address,
  networkId,
  logo,
  symbol,
  size = 32,
  showChain = true,
  eager = false,
  className = '',
}) {
  const [errored, setErrored] = useState(false)
  const chainId = showChain ? inferChainId(networkId, address) : null
  const chainMeta = chainId ? CHAIN_META[chainId] : null
  const initial = (symbol || '?').charAt(0).toUpperCase()

  return (
    <span
      className={['token-logo', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {logo && !errored ? (
        <img
          className="token-logo__img"
          src={logo}
          alt=""
          width={size}
          height={size}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'low'}
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className="token-logo__fallback">{initial}</span>
      )}
      {chainId && (
        <span className="token-logo__chain" title={chainMeta?.label || ''}>
          <ChainGlyph chainId={chainId} />
        </span>
      )}
    </span>
  )
}

export default React.memo(TokenLogo)
