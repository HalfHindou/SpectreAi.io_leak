/**
 * TokenImg — defensive token-logo image with first-letter fallback.
 *
 * The PWA workbox runtime cache for assets.coingecko.com (CacheFirst,
 * vite.config.js) can wedge a bad first-write response for up to 24h
 * (was 7d pre-2026-05-28). Bare <img> tags then render the browser's
 * broken-image glyph or stay as an empty circle.
 *
 * Drop-in replacement: <TokenImg src={url} symbol="BTC" className="..." />
 * On error, swaps the img for a span containing the symbol's first letter.
 */
import { useState } from 'react'

export default function TokenImg({ src, symbol, alt, className, ...rest }) {
  const [errored, setErrored] = useState(false)
  const letter = (symbol || '?').toString().charAt(0).toUpperCase()

  if (!src || errored) {
    return (
      <span className={`token-img-fallback ${className || ''}`.trim()}>
        {letter}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={alt || symbol || ''}
      className={className}
      onError={() => setErrored(true)}
      {...rest}
    />
  )
}
