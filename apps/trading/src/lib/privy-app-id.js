/**
 * privy-app-id — the LIGHT Privy identity module (entry-path safe).
 *
 * WHY this exists separately from privy-config.js: privy-config.js statically
 * imports @privy-io/react-auth/solana + @solana/kit + viem to build `privyConfig`
 * (toSolanaWalletConnectors, createSolanaRpc, defineChain). Any entry-path import
 * of privy-config.js would therefore drag the whole wallet stack onto the boot
 * chunk. The only things the boot path actually needs from Privy config are the
 * env-driven ids + the DOM-only wallet-extension flag — none of which touch the
 * SDK. Those live here so Header/DiscoverHero/etc. can read them without pulling
 * the SDK onto boot. privy-config.js re-exports these for back-compat; the real
 * SDK config is imported ONLY by the lazy privy-provider-lazy.jsx chunk.
 */

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || ''

// Optional Privy app-client id. Both apps share ONE Privy app (same PRIVY_APP_ID =
// same user base / embedded wallets). A client scopes per-deployment settings -
// allowed origins AND its own Telegram bot - so trading can use a 2nd Telegram bot
// (domain trade.spectreai.io) while research keeps the default client's bot
// (domain app.spectreai.io). Telegram's legacy Login Widget is one-domain-per-bot,
// so a 2nd bot on a trading client is how both apps get Telegram with one identity.
// Unset -> omitted -> default client (current behaviour). Set per Vercel env.
export const PRIVY_CLIENT_ID = import.meta.env.VITE_PRIVY_CLIENT_ID || ''

// Show the "Connect a wallet" button only when the browser actually has a wallet
// to connect. Most extensions inject window.ethereum / window.solana at
// document_start (before this bundle runs); EVM wallets that use EIP-6963 announce
// a tick later, so we also listen for that. When a wallet is found we add
// `wallet-ext-present` to <html>; index.css hides the wallet login button (always
// the last login-method-button under v1 loginMethods) whenever the class is absent.
// Embedded-wallet trading is unaffected - this only gates the external-wallet login
// entry. Fail-closed: no detection -> button hidden (matches "only if they have one").
//
// This runs at boot (this module is imported on the entry path by Header /
// DiscoverHero), so the class is set before the login modal can ever open — even
// though the Privy SDK + modal now mount lazily. Keeping it OFF the SDK config is
// what lets it stay on the boot path without dragging the wallet stack along.
export function flagInjectedWallet() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const w = window
  const found = () =>
    !!(w.ethereum || w.solana || w.phantom?.solana || w.solflare ||
       w.backpack || w.okxwallet ||
       (Array.isArray(w.ethereum?.providers) && w.ethereum.providers.length))
  const mark = () => document.documentElement.classList.add('wallet-ext-present')
  if (found()) { mark(); return }
  const onAnnounce = () => {
    mark()
    window.removeEventListener('eip6963:announceProvider', onAnnounce)
  }
  window.addEventListener('eip6963:announceProvider', onAnnounce)
  try { window.dispatchEvent(new Event('eip6963:requestProvider')) } catch { /* no-op */ }
}
flagInjectedWallet()
