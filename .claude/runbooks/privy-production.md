# Privy Production Runbook - Trading Wallet + Swap Real-Money Launch

**Created:** 2026-07-06 (real-money readiness audit)
**Owner:** Gleb
**Scope:** manual dashboard/env/on-chain steps that code cannot do. Complete every section before opening trading to real user funds. Code-side fixes shipped in the same PR as this file.

---

## 1. Vercel env checklist (spectre-trading project)

| Var | Purpose | Notes |
|-----|---------|-------|
| `VITE_PRIVY_APP_ID` | Frontend Privy app | MUST equal `PRIVY_APP_ID` (token audience) or beta-access/user APIs 401 silently - this is the prod sign-in bug signature |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | Server JWT verify + user fetch | Same app as above |
| `ZEROX_API_KEY` | 0x v2 quotes | Present in dev .env; confirm prod |
| `FEE_WALLET_EVM` / `FEE_WALLET_SOLANA` (or KV `admin:fee-config`) | Platform fee recipients | KV wins; env seeds first read. Verify via research admin fee-config panel |
| `FEE_BPS` | Platform fee (100 = 1%) | |
| `ETHEREUM_RPC_URL`,`BSC_RPC_URL`,`POLYGON_RPC_URL`,`ARBITRUM_RPC_URL`,`BASE_RPC_URL` | Server-side swap-log verification | Public fallbacks exist but are rate-limited |
| `HELIUS_RPC_URL` or `SOLANA_RPC_URL` | Solana verification + fee-ATA checks | Public mainnet-beta fallback is heavily rate-limited |
| `VITE_ETH_RPC_URL`,`VITE_BSC_RPC_URL`,`VITE_POLYGON_RPC_URL`,`VITE_ARB_RPC_URL`,`VITE_BASE_RPC_URL`,`VITE_SOLANA_RPC_URL` | Client balances/sends | If set to custom hosts, ADD THOSE HOSTS to vercel.json CSP connect-src (both apps) - CSP now lists only the public fallbacks |
| `PRIVY_WEBHOOK_SIGNING_SECRET` | Activates api/privy-webhook.js | See section 4 |
| `UPSTASH_REDIS_REST_URL/TOKEN` (KV) | swap history, idempotency, profiles | Watch the 500K/day quota - WRITE-only failures documented in memory. Without KV: falls to per-instance memory (nothing persists across cold starts) |
| `COLLECTOR_EVM_ADDRESS` / `COLLECTOR_SOL_ADDRESS` | Fee recipients (seeds KV `admin:fee-config`) | Missing = 0% fee silently + swap-log rejections |
| `COLLECTOR_EVM_PRIVATE_KEY` / `COLLECTOR_SOL_SECRET_KEY` | Daily fee-sweep cron signing | HOT KEYS - biggest attack surface; treat Vercel env read access as key custody. Missing = fees accumulate unswept (no user impact) |
| `CRON_SECRET` + `FEE_RECIPIENT_{EVM,SOL}_{PRIMARY,SECONDARY,TERTIARY}` | consolidate-and-distribute cron | Missing = cron disabled / distribute step 500s |
| `TEAM_GATE_PASSWORD`, `BETA_OPEN='true'`, `FIREBASE_SERVICE_ACCOUNT_JSON` + `FIREBASE_PROJECT_ID` | Beta gate + waitlist | Missing = sign-in impossible / cohort locked out / waitlist 503 |

## 2. Jupiter platform fee - initialize fee token accounts (REQUIRED for Solana revenue)

Code now passes the fee wallet's ATA as `feeAccount` ONLY when that ATA exists on-chain (otherwise fees are skipped so swaps never fail). Verified 2026-07-06: passing the raw wallet address makes Jupiter silently drop the fee - Spectre has collected ZERO Solana fees to date.

One-time setup - for the Solana fee wallet, create ATAs for the common output mints:
- wSOL `So11111111111111111111111111111111111111112`
- USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

Easiest: send a dust amount (e.g. 0.1 USDC) of each token to the fee wallet from any wallet - the sender's wallet app auto-creates the ATA. Or `spl-token create-account <MINT> --owner <FEE_WALLET>`.
Verify: `curl /api/swap/quote` (Solana pair, with `userAddress`) -> response `platformFee` is non-null. Server caches ATA existence 1h positive / 5min negative.
Note: fees only collect when the OUTPUT mint has an initialized fee ATA. Long-tail memecoin buys (output = memecoin) won't collect until you add per-mint ATAs or move to Jupiter's Referral Program with dynamic referral token accounts (future work).

## 3. MFA (optional 2FA) - Privy dashboard

1. dashboard.privy.io -> your app -> User management -> Multi-factor authentication: enable **TOTP (authenticator app)** and **Passkeys**.
2. The wallet page now shows "Secure your wallet - Add 2FA" (calls `useMfaEnrollment().showMfaEnrollmentModal`). Until dashboard MFA is enabled the modal reports unavailability as a toast.
3. Decision recorded: MFA is OPTIONAL at launch (user choice); revisit enforcing for balances > threshold post-launch.

## 4. Privy webhooks (optional but recommended)

1. dashboard.privy.io -> Webhooks -> Add endpoint: `https://trade.spectreai.io/api/privy-webhook` (and research equivalent).
2. Subscribe: `transaction.*`, `user.*`, `mfa.*`.
3. Copy signing secret -> `PRIVY_WEBHOOK_SIGNING_SECRET` in Vercel env (both apps). Endpoint 503s until set (dormant by design).
4. Benefit: `waitForConfirmation` short-circuits via KV tx-status instead of RPC polling.

## 5. Card funding (deposit) - dashboard checks

1. Privy dashboard -> Funding: confirm card funding enabled for **Ethereum, Base, Polygon, Arbitrum, BSC AND Solana mainnet**.
2. Onramp providers have limited Solana token lists (SOL/USDC/USDT typically); the deposit modal buys the chain's native/USDC - fine.
3. Remember: `fundWallet` resolves when the MODAL closes, not when funds arrive - balance polling is the arrival signal (already in place, 15-30s).

## 6. Prod sign-in 401 (beta gate) - unresolved blocker for prod testing

Symptom: correct email code -> silently returned to sign-in. Cause: `/api/beta-access` 401 (gate logs out with no message). Prime suspect: `PRIVY_APP_ID`/`PRIVY_APP_SECRET` on spectre-trading Vercel project not matching `VITE_PRIVY_APP_ID` (`cmmkl27iz00v80bjibo1q0ypl`). Fix = section 1 first row; verify with a login attempt + `[beta-gate] /api/beta-access -> <status>` console line.

## 7. Live-money smoke tests (execute AFTER sections 1-2; ~$5-20 per chain)

Per chain (ETH, Base, Polygon, Arbitrum, BNB, SOL) - abort the chain on any failure:
1. **Deposit-in**: send a small amount from an external wallet to the embedded address (copy from Receive tab; VERIFY the address matches the chain tab - EVM chains share one address, Solana differs). Balance appears within ~30s.
2. **Buy**: small native->token swap (liquid token). Expect Privy modal shows the RIGHT chain, tx confirms, Swap History row appears, price impact sane.
3. **Sell (ERC-20 -> native)**: THE Permit2 end-to-end proof (KB #25's pending item). First sell per token = one approval tx + permit signature; second sell = signature only.
4. **Fee receipt**: check the fee wallet received the fee on an explorer (EVM: token transfer in the swap tx; Solana: fee ATA balance increase).
5. **Withdraw-out**: send the token back to the external wallet from the Send tab. VERIFY the explorer link opens the CORRECT chain and the tx is on that chain (this validates the chainId pinning fix).
6. **History**: both the swap and the withdrawal appear in Swap History with correct explorer links.

Explorer links: etherscan.io / basescan.org / polygonscan.com / arbiscan.io / bscscan.com / solscan.io.

## 8. Known limitations accepted at launch

- Solana platform fees collect only for mints with initialized fee ATAs (section 2).
- No off-ramp; no WalletConnect-Pay; no MFA enforcement; single EVM aggregator (0x). All logged as KB P3 backlog.
- Research app twin surfaces (wallet page) share the withdraw fix; research swap UI is the embedded trading iframe.
