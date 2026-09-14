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
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { defineChain } from 'viem'
import { mainnet, base, polygon, arbitrum, bsc } from 'viem/chains'
// PRIVY_APP_ID / PRIVY_CLIENT_ID / flagInjectedWallet moved to lib/privy-app-id.js
// (the LIGHT, SDK-free module) so the entry path can read the ids without pulling
// this file's @privy-io/@solana/kit/viem imports onto the boot chunk. Re-exported
// here for back-compat; this file is now imported ONLY by the lazy
// privy-provider-lazy.jsx chunk.
export { PRIVY_APP_ID, PRIVY_CLIENT_ID, flagInjectedWallet } from './privy-app-id'

// Robinhood Chain (Arbitrum Orbit L2, mainnet 2026-07-01). viem ships no
// built-in for it yet, so define it locally. Privy needs the chain registered
// in supportedChains below or wallet.switchChain(4663) throws "Unsupported
// chainId" and every EVM swap/withdraw on this chain fails to sign.
const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' },
  },
})

// Solana wallet connectors - required for Phantom, Solflare to appear in connect modal
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
})

export const privyConfig = {
  // Explicit EVM chain registration for embedded-wallet signing. Without
  // this Privy falls back to its own default chain set - BSC is not
  // guaranteed to be in it, and any chainId-pinned request (withdraw,
  // swap) on an unregistered chain throws "Unsupported chainId". These
  // five mirror walletService.SUPPORTED_CHAINS; Solana is configured
  // separately via embeddedWallets/walletChainType.
  defaultChain: mainnet,
  supportedChains: [mainnet, base, polygon, arbitrum, bsc, robinhoodChain],
  // v1 `loginMethods` (flat array) - INTENTIONAL, do not "upgrade" to v2
  // loginMethodsAndOrder. The v2 primary/overflow split broke wallet login:
  // it groups `wallet` with the overflow socials and the "Connect a wallet"
  // button then opens Discord/Apple instead of the wallet picker. v1 renders
  // `wallet` as a real "Connect a wallet" entry that opens Privy's full 100+
  // wallet picker (MetaMask, Phantom, WalletConnect, ...). Order = render order:
  // email + Google + X + Telegram tiles, then "Connect a wallet". Telegram must
  // ALSO be enabled in the Privy dashboard (bot token).
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
  // Solana external wallet connectors - enables Phantom, Solflare in connect modal.
  // Without this block, the Solana wallet buttons in the modal silently no-op.
  externalWallets: {
    solana: {
      connectors: solanaConnectors,
    },
  },
  // Solana RPC for the v3 standard-wallet signing hooks (useSignAndSendTransaction).
  // Privy ships NO default Solana RPC - without this the sign-and-send screen
  // throws "No RPC configuration found for chain solana:mainnet" and unmounts
  // the whole tree. Privy broadcasts through THIS rpc (not Privy infra).
  // HTTP goes through our same-origin /api/solana-rpc proxy: standard JSON-RPC
  // error shapes (publicnode's nonstandard preflight errors crash kit's error
  // parser into "Cannot destructure property 'err'"), server-side send logging,
  // and the Helius/env upstream stays server-side. Subscriptions can't ride the
  // proxy (no websocket) - they stay on a public wss, which must be in the CSP.
  solana: {
    rpcs: {
      'solana:mainnet': {
        rpc: createSolanaRpc(
          import.meta.env.VITE_PRIVY_SOLANA_RPC_URL ||
            new URL('/api/solana-rpc', window.location.origin).toString()
        ),
        rpcSubscriptions: createSolanaRpcSubscriptions(
          import.meta.env.VITE_PRIVY_SOLANA_WS_URL || 'wss://solana-rpc.publicnode.com'
        ),
      },
    },
  },
  embeddedWallets: {
    // Silent signing - never render Privy's per-transaction confirm screen.
    // The app's own Buy/Sell/Withdraw controls are the confirmation layer
    // (GMGN model). Explicit false overrides the dashboard default.
    showWalletUIs: false,
    ethereum: { createOnLogin: 'users-without-wallets' },
    solana: { createOnLogin: 'users-without-wallets' },
  },
  // Funding: card payments first (MoonPay), exchange transfer as overflow option.
  // Mirrors research config so the modal funding tile order matches across apps.
  fundingMethodsAndOrder: {
    primary: ['card'],
    overflow: ['exchange'],
  },
}
