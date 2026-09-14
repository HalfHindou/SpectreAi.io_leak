---
description: Privy knowledge base index. Navigation, quick reference, and "if you're working on X read Y" guide.
---

# Privy Knowledge Base - Index

> Synthesized from 222 official Privy markdown docs at `C:\Users\worka\OneDrive\Desktop\Privy\`. The raw folder is the source of truth; these files are a derived, navigable index. Last build: 2026-05-19.

The master rules file [`.claude/rules/privy.md`](../../rules/privy.md) auto-loads when working on Privy code. This INDEX is for browsing the deep dives.

---

## Knowledge files (15,158 lines synthesized)

### Topical deep dives

| # | File | Lines | Covers |
|---|------|-------|--------|
| 01 | [auth-and-identity.md](01-auth-and-identity.md) | 1432 | Login methods (email, SMS, OAuth, passkey, Farcaster, Telegram, wallet), session tokens, access tokens, MFA, logout, captcha, SSO |
| 02 | [embedded-wallets.md](02-embedded-wallets.md) | 719 | Wallet creation policies, types (standard / business / treasury / execution), custody continuum, wallet list config |
| 03 | [solana-integration.md](03-solana-integration.md) | 1209 | Solana provider, networks, MWA, send SOL/SPL/USDC, Jupiter, signing patterns |
| 04 | [evm-integration.md](04-evm-integration.md) | 1070 | EVM chains, EIP-7702, batch tx, gas sponsorship, viem/ethers usage, Multicall3 |
| 05 | [transactions-and-signing.md](05-transactions-and-signing.md) | 1007 | useSendTransaction, client vs server signing, idempotency, request expiry, action status, EIP-712 |
| 06 | [swaps-and-trading.md](06-swaps-and-trading.md) | 1113 | Privy built-in Swap, 0x v2 + Permit2, Bebop, Jupiter, limit orders, MPP, one-balance, x402, bridging |
| 07 | [funding-and-onramp.md](07-funding-and-onramp.md) | 1032 | useFundWallet, card funding, Stripe headless, custom fiat onramp, off-ramp, WalletConnect-Pay, relay deposits, account transfer |
| 08 | [server-sdk.md](08-server-sdk.md) | 1344 | `@privy-io/node`, token verification, user management, server wallets, server signing, signature payloads |
| 09 | [ui-and-customization.md](09-ui-and-customization.md) | 988 | Default UI, whitelabel, theming, listener, multi-dialog, manage wallet UIs, React framework adapters |
| 10 | [wallet-controls-and-authorization.md](10-wallet-controls-and-authorization.md) | 823 | Signers, policies, single / dual / quorum approval, delegation, programmable wallets, flexible custody |
| 11 | [security-and-webhooks.md](11-security-and-webhooks.md) | 998 | Security architecture, secure enclaves, on-device exec env, IP allowlist, allowed domains, CSP, bot prevention, webhooks |
| 12 | [migrations-and-changelog.md](12-migrations-and-changelog.md) | 520 | v1 -> v2 -> v3 migrations, server-auth rename, changelog highlights |
| 13 | [defi-and-bot-recipes.md](13-defi-and-bot-recipes.md) | 800 | Polymarket, Transatron, Bankr bot, Telegram bot, OpenClaw agentic, Virtuals EconomyOS, vault ops |
| 14 | [errors-and-troubleshooting.md](14-errors-and-troubleshooting.md) | 431 | API + client error codes, embedded wallet issues, CSP / OAuth / preview pitfalls, utility helpers, debugging tips |

### Spectre-specific (always read these for current state)

| File | Lines | Covers |
|------|-------|--------|
| [spectre/current-implementation.md](spectre/current-implementation.md) | 556 | Living snapshot - every Privy touchpoint in our code today |
| [spectre/audit-gaps.md](spectre/audit-gaps.md) | 419 | Prioritized P0-P3 backlog of issues to fix |
| [spectre/patterns.md](spectre/patterns.md) | 697 | 14 validated patterns extracted from working Spectre code |

---

## Quick navigation - "If you're working on X, read Y"

### Adding a new login method
1. [01-auth-and-identity.md](01-auth-and-identity.md) - method-specific deep dive (email, OAuth, passkey, etc.)
2. [09-ui-and-customization.md](09-ui-and-customization.md) - how it shows in the modal
3. [spectre/current-implementation.md](spectre/current-implementation.md) section 1-2 - how to wire it in research and trading
4. Privy dashboard - enable the method server-side

### Adding wallet balance for a new chain
1. [04-evm-integration.md](04-evm-integration.md) (if EVM) or [03-solana-integration.md](03-solana-integration.md) (if SVM)
2. [spectre/current-implementation.md](spectre/current-implementation.md) section 7 - walletService.js pattern
3. [spectre/patterns.md](spectre/patterns.md) Pattern 7 - provider caching
4. Update `.claude/rules/solana-web3.md` section B chain table

### Adding a new aggregator (Bebop, 1inch, etc.) to swaps
1. [06-swaps-and-trading.md](06-swaps-and-trading.md) - aggregator API patterns
2. [05-transactions-and-signing.md](05-transactions-and-signing.md) - signing the quote
3. [spectre/current-implementation.md](spectre/current-implementation.md) section 6 - useSwapExecution structure
4. [spectre/audit-gaps.md](spectre/audit-gaps.md) #24 - Bebop discussion if relevant

### Adding server-side functionality (write API that touches user data)
1. [08-server-sdk.md](08-server-sdk.md) - JWT verification setup
2. [spectre/current-implementation.md](spectre/current-implementation.md) section 9 - `_lib/auth.js` pattern
3. [11-security-and-webhooks.md](11-security-and-webhooks.md) - allowed domains, CSP

### Adding a bot / agent / scheduled trade
1. [10-wallet-controls-and-authorization.md](10-wallet-controls-and-authorization.md) - delegation, policies
2. [08-server-sdk.md](08-server-sdk.md) - server signing
3. [13-defi-and-bot-recipes.md](13-defi-and-bot-recipes.md) - Bankr, Telegram bot, OpenClaw patterns

### Adding MFA enforcement
1. [01-auth-and-identity.md](01-auth-and-identity.md) - MFA section
2. [09-ui-and-customization.md](09-ui-and-customization.md) - listener for MFA modal
3. Privy dashboard - enable MFA requirement
4. [spectre/audit-gaps.md](spectre/audit-gaps.md) #21 - context on MFA as paid-feature gate

### Adding a Buy / Fund button to the UI
1. [07-funding-and-onramp.md](07-funding-and-onramp.md) - useFundWallet, card / Stripe / MoonPay
2. [spectre/current-implementation.md](spectre/current-implementation.md) section 1 - research already has `fundingMethodsAndOrder`, trading does not

### Debugging modal not opening / blank iframe
1. [14-errors-and-troubleshooting.md](14-errors-and-troubleshooting.md) - CSP / iframe section
2. [11-security-and-webhooks.md](11-security-and-webhooks.md) - allowed domains, CSP requirements
3. Check both `vercel.json` files for CSP

### Debugging "wallet not found" / "cannot sign before ready"
1. [14-errors-and-troubleshooting.md](14-errors-and-troubleshooting.md) - common embedded wallet issues
2. [spectre/patterns.md](spectre/patterns.md) Pattern 2 - deferring hooks
3. [02-embedded-wallets.md](02-embedded-wallets.md) - creation policies

### Migrating Privy SDK to a new major version
1. [12-migrations-and-changelog.md](12-migrations-and-changelog.md) - breaking changes
2. [spectre/audit-gaps.md](spectre/audit-gaps.md) #4 - the loginMethods drift between apps
3. Plan: bump research first, validate, then trading

### Auditing for security
1. [11-security-and-webhooks.md](11-security-and-webhooks.md) - security checklist
2. [08-server-sdk.md](08-server-sdk.md) - server JWT verification
3. [spectre/audit-gaps.md](spectre/audit-gaps.md) P0 items

---

## Source doc taxonomy (which Privy docs went into each file)

The original 222 Privy markdown docs in `C:\Users\worka\OneDrive\Desktop\Privy\` (de-duplicated by content; the `(1)`, `(2)`, `(3)` variants are re-downloads). Each topical KB file lists the exact source docs it synthesizes in its "Source docs synthesized" section.

Major source categories:
- **Auth & identity** (~30 files): wallet, passkey, oauth, email, sms, totp, captcha, sso, tokens, custom-oauth, farcaster, telegram, authentication-state, logout, unenroll
- **Embedded wallets** (~25 files): Wallets Overview, automatic-wallet-creation, standard/business/treasury wallets, execution-wallets, types of wallets, wallet-infrastructure, manage-wallet-UIs, key concepts, flexible custody
- **Solana** (~10 files): getting-started-with-privy-and-solana, configuring-solana-networks, adding-solana-mwa, send-sol, send-spl-tokens, send-usdc
- **EVM** (~10 files): configuring-evm-networks, eip-7702, batch-transactions, speeding-up-transactions, gas-sponsorship-rate-limits, flashblocks, Chain Support
- **Server SDK** (~15 files): server-transactions, server-side-access, server-updates, server-export, signing-on-the-server, migrating-from-server-auth, quickstart variants
- **Authorization & control** (~25 files): User Auth Keys, add/remove/configure/use-signers, authorization-signatures, Policies, single/dual/quorum-approval, delegation, programmable, offline, assign, key-quorum
- **Swap & trading** (~12 files): Swap, swap-with-0x, bebop-swap-guide, limit-orders, mpp, one-balance, x402, trading-apps-homepage, bridge-cards, Bridging
- **Funding & ramps** (~10 files): card-based-funding, stripe-headless-onramp, custom-fiat-onramp, off-ramp-guide, walletconnect-pay, relay-deposit-addresses, account-transfer, auto-exchange-privy-agent
- **UI & customization** (~13 files): default-ui, ui-component, listener, whitelabel, customization, styles, system-theme, multiple-dialogs, manage-wallet-UIs, react-frameworks
- **Security & webhooks** (~13 files): Security Architecture, Secure Enclaves, On Device execution env, IP allowlist, allowed-domains, allowed-oauth-redirects, Content Security Policies, preventing-bots, Security Checklist, Security FAQs, Webhooks
- **Migrations** (~5 files): migrating-to-2.0, migrating-to-3.0, migrating-from-server-auth, changelog, product-updates
- **DeFi & bots** (~12 files): polymarket-guide, transatron, bankr-bot-guide, telegram-bot, openclaw-agentic-wallets, virtuals-economyos, deposit, withdraw, claim, get-vault-position, get-vault-details
- **Errors** (~7 files): api-errors, client-errors, errors variants, troubleshooting-embedded-wallets, utility-functions, Common Use Cases, Setup variants

---

## Update protocol

- **Code changes that affect Privy usage** -> update [spectre/current-implementation.md](spectre/current-implementation.md)
- **New gap discovered** -> add to [spectre/audit-gaps.md](spectre/audit-gaps.md) with severity
- **New pattern validated** -> add to [spectre/patterns.md](spectre/patterns.md)
- **Privy SDK bump** -> update [12-migrations-and-changelog.md](12-migrations-and-changelog.md) and [`.claude/rules/privy.md`](../../rules/privy.md) section C
- **New Privy doc downloaded** -> drop into `C:\Users\worka\OneDrive\Desktop\Privy\`, identify which topical file it belongs to, re-synthesize that single file (don't rebuild everything)
- **Topical file outdated** -> if the canonical Privy API changed materially, re-synthesize that file from updated source docs and bump the version

---

## See also

- [`.claude/rules/privy.md`](../../rules/privy.md) - the master rules file (auto-loaded on Privy code)
- [`.claude/rules/solana-web3.md`](../../rules/solana-web3.md) - chain / wallet rules (Multicall3, chains, gas reserves, networkId mapping) - not Privy-specific
- [`.claude/rules/api-patterns.md`](../../rules/api-patterns.md) - API client patterns
- [`.claude/rules/coding-standards.md`](../../rules/coding-standards.md) - JS / React conventions
- Original Privy docs at `C:\Users\worka\OneDrive\Desktop\Privy\` (read-only source of truth)
- Privy dashboard: https://dashboard.privy.io
- Privy docs site: https://docs.privy.io
- Privy LLM-friendly docs index: https://docs.privy.io/llms.txt
