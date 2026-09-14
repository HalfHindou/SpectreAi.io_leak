/**
 * Pick the right CoinGecko image SIZE for the slot it is drawn into.
 *
 * CoinGecko serves three variants of every coin mark from one path, and the
 * markets endpoint hands us the biggest one in `image`:
 *
 *   /thumb/    25px    ~1.3 KB
 *   /small/    50px    ~2.5 KB
 *   /large/   250px   ~12.2 KB   <- what the feed returns
 *
 * (measured on BTC, 2026-08-04)
 *
 * The mobile Top Coins list draws that 250px mark into a 22px circle. Fifty
 * rows is ~600 KB of logo for circles no phone can show more than ~66 device
 * pixels of — which is what "btc and top coins logos load slow" is on LTE.
 * Requesting `small` there is ~5x fewer bytes for the same picture.
 *
 * Two deliberate limits:
 *
 * - The DPR is capped at 2 when choosing. A 3x phone would otherwise ask for
 *   `large` at 22px and we would be back where we started, for a difference
 *   only visible on a flat-colour mark under a loupe.
 * - Only a CoinGecko COIN image is rewritten. The same lists also carry
 *   DexScreener, Codex and self-hosted marks, which have no size variants —
 *   rewriting those would 404 the logo. Anything unrecognised passes through
 *   untouched, so a new source can never be broken by this helper.
 */
const CG_COIN_IMAGE_RX =
  /^(https?:\/\/(?:coin-images|assets)\.coingecko\.com\/coins\/images\/\d+\/)(thumb|small|large)(\/.*)$/i

export function coinLogoUrl(src, renderedPx) {
  if (!src || typeof src !== 'string') return src
  const m = CG_COIN_IMAGE_RX.exec(src)
  if (!m) return src

  const dpr = typeof window !== 'undefined' && window.devicePixelRatio
    ? Math.min(window.devicePixelRatio, 2)
    : 2
  const need = (Number(renderedPx) || 0) * dpr
  if (!need) return src

  const want = need <= 25 ? 'thumb' : need <= 50 ? 'small' : 'large'
  if (want === m[2].toLowerCase()) return src
  // Never UPGRADE: if the feed already gave us a small mark, asking for `large`
  // would invent a URL the CDN may not hold for that coin.
  if (m[2].toLowerCase() !== 'large') return src
  return `${m[1]}${want}${m[3]}`
}

export default coinLogoUrl
