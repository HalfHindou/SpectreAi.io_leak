/**
 * Privy SDK configuration - shared across the app.
 * Login methods, appearance, and embedded wallet settings.
 *
 * Login methods must also be enabled in the Privy dashboard:
 * https://dashboard.privy.io/
 *
 * Wallet connection:
 * - EVM (MetaMask, Coinbase, WalletConnect): no extra config needed
 * - Solana (Phantom, Solflare): requires toSolanaWalletConnectors
 * - Use useConnectWallet hook (not linkWallet) to show wallet picker modal
 */
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { mainnet, base, polygon, arbitrum, bsc } from 'viem/chains'

// Solana wallet connectors - required for Phantom, Solflare to appear in connect modal
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
})

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || ''

// Show the "Connect a wallet" button only when the browser actually has a wallet
// to connect. Most extensions inject window.ethereum / window.solana at
// document_start (before this bundle runs); EVM wallets that use EIP-6963 announce
// a tick later, so we also listen for that. When a wallet is found we add
// `wallet-ext-present` to <html>; index.css hides the wallet login button (always
// the last login-method-button under v1 loginMethods) whenever the class is absent.
// Embedded-wallet trading is unaffected - this only gates the external-wallet login
// entry. Fail-closed: no detection -> button hidden (matches "only if they have one").
function flagInjectedWallet() {
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

export const privyConfig = {
  // Explicit EVM chain registration for embedded-wallet signing. Without
  // this Privy falls back to its own default chain set - BSC is not
  // guaranteed to be in it, and any chainId-pinned request (withdraw)
  // on an unregistered chain throws "Unsupported chainId". Mirrors
  // walletService SUPPORTED_CHAINS; Solana is configured separately.
  defaultChain: mainnet,
  supportedChains: [mainnet, base, polygon, arbitrum, bsc],
  // v1 `loginMethods` (flat) - matches trading. The v2 loginMethodsAndOrder
  // primary/overflow split breaks wallet login (the "Connect a wallet" button
  // opens the overflow socials instead of the wallet picker). v1 renders
  // `wallet` as a real entry that opens Privy's full 100+ wallet picker.
  // Render order: email + Google + X + Telegram, then "Connect a wallet".
  // Telegram must ALSO be enabled in the Privy dashboard (bot token).
  loginMethods: ['email', 'google', 'twitter', 'telegram', 'wallet'],
  appearance: {
    theme: '#0c0c0e',
    accentColor: '#18181b',
    logo: '/spectre-logo-dark.png',
    landingHeader: 'Sign in to Spectre AI',
    loginMessage: 'Your gateway to institutional-grade crypto intelligence.',
    walletChainType: 'ethereum-and-solana',
    // Curated initial wallet list - the wallets users are most likely to connect with.
    // Privy renders these up-front; the rest are reachable via the search input at the
    // top of the picker. Order = priority (most popular first).
    //
    // IMPORTANT: only IDs in Privy's `WalletListEntry` union are valid buttons. Wallets
    // not in the union (Trust mobile, Exodus, Rabby [deprecated], Xverse, Ledger Live,
    // Trezor, Tangem) reach users through `detected_ethereum_wallets` /
    // `detected_solana_wallets` (browser extension auto-discovery) and `wallet_connect`
    // (QR pairing - covers Trust mobile, Ledger Live, Xverse, Tangem). Do NOT add
    // unsupported IDs - Privy silently drops them.
    walletList: [
      'detected_ethereum_wallets',
      'detected_solana_wallets',
      'metamask',
      'phantom',
      'coinbase_wallet',
      'backpack',
      'solflare',
      'okx_wallet',
      'safe',
      'zerion',
      'rainbow',
      'wallet_connect',
    ],
    // NOTE: `binance` is in Privy's WalletListEntry TS union but runtime silently
    // drops it (asset missing from bundle). Binance Web3 Wallet users connect via
    // wallet_connect QR (which is the native flow for Binance mobile wallet anyway).
    showWalletLoginFirst: false,
  },
  // Solana external wallet connectors - enables Phantom, Solflare in connect modal
  externalWallets: {
    solana: {
      connectors: solanaConnectors,
    },
  },
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
    solana: { createOnLogin: 'users-without-wallets' },
  },
  // Funding: card payments first (MoonPay), exchange transfer as overflow option
  fundingMethodsAndOrder: {
    primary: ['card'],
    overflow: ['exchange'],
  },
}
