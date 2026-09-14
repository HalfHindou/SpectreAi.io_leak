/**
 * Standalone trading terminal deep-links (trade.spectreai.io).
 *
 * On-chain tokens (those with a real contract address) open the FULL trading
 * app via its native `#token/<address>` deep-link rather than the research
 * `/token` "Trading Lite" iframe — the standalone terminal has the better
 * charts (Gleb's build) and, living on `.spectreai.io`, keeps the Privy
 * session cookie. The trading app infers networkId from the address format
 * (see apps/trading/src/App.jsx deep-link parse), so a bare address is enough.
 *
 * Prod targets trade.spectreai.io (branded, same parent domain) rather than the
 * spectre-trading.vercel.app alias the /token iframe embed uses — a top-level
 * nav has no CORS/demo-session constraint, so SSO across the apps wins.
 *
 * CONTRACT RULE: a degen / on-chain token ALWAYS has a contract address, so it
 * must ALWAYS reach the terminal by that CA — it must NEVER fall back to
 * Research Zone, which canonicalises an on-chain ticker back to a same-symbol
 * major (the $DOT-on-Base → Polkadot trap). So the guard is deliberately
 * lenient: any value shaped like a real contract (0x-hex for EVM/L2s, or base58
 * for Solana/Tron/…) builds a URL, regardless of exact length — we never reject
 * a real CA on a length technicality. The ONLY thing that returns null is a
 * genuinely absent address (a CEX-only major / stock, or empty/garbage) — that
 * is the case that legitimately keeps the in-app `/token` (or RZ) flow, and it
 * also prevents a bare `#token/` that would bounce the trading app to its
 * welcome view.
 */
import { isDev } from '@/utils/env'
import { getPathForPageId } from '@/constants/pageRoutes'

const TRADING_TERMINAL_URL = isDev
  ? (import.meta.env.VITE_TRADING_APP_URL || `http://localhost:${typeof __TRADING_PORT__ !== 'undefined' ? __TRADING_PORT__ : 5181}`)
  : 'https://trade.spectreai.io'

/** True when running as an installed PWA (standalone display mode).
 *  From a standalone app, ANY top-level navigation to another origin
 *  (trade.spectreai.io) pops iOS's in-app browser sheet - URL bar on top,
 *  Safari toolbar on the bottom - destroying the fullscreen app feel. iOS has
 *  no scope-extension support, so the only fix is staying on app.spectreai.io:
 *  terminal deep-links fall back to the in-app /token embed (same trading UI,
 *  iframed, no browser chrome). */
export function isStandalonePwa() {
  if (typeof window === 'undefined') return false
  try {
    return window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
  } catch { return false }
}

// A real contract address: 0x-hex (EVM + L2s) or base58 (Solana, Tron, …).
// Lenient on length ON PURPOSE so a valid CA is never rejected → a degen token
// always deep-links to the terminal instead of mis-routing to Research Zone.
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{6,}$/
const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{20,}$/

/** True when `address` looks like a real on-chain contract the terminal can be
 *  deep-linked with. Only empties / non-address strings return false. */
export function isTradableContract(address) {
  if (typeof address !== 'string') return false
  const a = address.trim()
  return EVM_ADDRESS_RE.test(a) || BASE58_ADDRESS_RE.test(a)
}

/** Build the terminal deep-link for an on-chain token, or null if the address
 *  isn't a valid contract (so callers can keep their existing fallback). */
export function tradingTerminalUrl(address) {
  if (!isTradableContract(address)) return null
  return `${TRADING_TERMINAL_URL}/#token/${address.trim()}`
}

/** Open the standalone terminal for an on-chain token in a new tab. Returns
 *  true if it navigated (valid contract), false otherwise so the caller falls
 *  through to /token or Research Zone. window.open from a click handler is
 *  user-gesture-initiated → not popup-blocked. */
export function openTradingTerminal(address) {
  const url = tradingTerminalUrl(address)
  if (!url) return false
  // Installed PWA: window.open to another origin pops the iOS in-app browser
  // sheet. Load the SAME token in the in-app /token embed instead - top-level
  // document stays on app.spectreai.io, fullscreen preserved.
  if (isStandalonePwa()) {
    window.location.assign(`${getPathForPageId('ai-screener')}/${encodeURIComponent(address.trim())}`)
    return true
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

/** Absolute home URL for the standalone trading terminal (trade.spectreai.io in
 *  prod, the local trading dev server in dev). The `/#` hash boots the terminal's
 *  hash router to its default view. Used by the "Trading Lite" nav entry + the
 *  header cross-nav icons, which now open the full terminal instead of the
 *  in-app /token iframe embed. */
export const TRADING_TERMINAL_HOME = `${TRADING_TERMINAL_URL}/#`

/** Navigate the CURRENT tab to the trading terminal home. Same-tab on purpose
 *  (mirrors the desktop header cross-nav anchor) so repeated Research↔Trading
 *  switching doesn't spawn duplicate tabs. */
export function goToTradingTerminalHome() {
  if (typeof window === 'undefined') return
  // Installed PWA: keep Trading Lite in-app (the /token embed) so the
  // standalone app never leaves its origin and keeps its fullscreen chrome.
  if (isStandalonePwa()) {
    window.location.assign(getPathForPageId('ai-screener'))
    return
  }
  window.location.href = TRADING_TERMINAL_HOME
}
