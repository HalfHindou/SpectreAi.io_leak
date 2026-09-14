# Beta Launch Runbook — Trading + Fee Plumbing

> Status: WIP through 2026-05-22. Update as you execute.

This is the operational checklist for Spectre's beta launch. Covers the
custodial-collector + USDC-consolidation + 90/5/5-distribute architecture
locked on 2026-05-22.

## 0. One-time key generation (do this FIRST, before any env setup)

Generate **two fresh keypairs** — never reuse anything from existing wallets.

### EVM (secp256k1, same address valid on all 5 EVM chains)
Recommended: use a hardware-isolated machine or an OS keyring. Two clean
options:
```bash
# Option A: ethers CLI (Node REPL)
node -e "const e=require('ethers');const w=e.Wallet.createRandom();console.log('address:',w.address);console.log('private_key:',w.privateKey)"

# Option B: cast (Foundry)
cast wallet new
```
Output: a `0x...` private key (32 bytes hex) + the public address.

### Solana (ed25519)
```bash
solana-keygen new --no-bip39-passphrase --outfile collector-sol.json
solana-keygen pubkey collector-sol.json   # the public address
cat collector-sol.json                    # the JSON array secret (paste as COLLECTOR_SOL_SECRET_KEY)
```
The JSON-array format `[1,2,3,…]` is the recommended secret format for
Vercel env (cron handler parses both JSON array AND base58).

### Where the secrets live
- **Vercel encrypted env vars** on the **trading project ONLY** (the cron
  handler that signs lives in trading).
- **1Password backup** in a dedicated "Spectre Treasury Keys" vault, shared
  ONLY with you (Gleb) + Sunny as break-glass emergency access.
- **NOWHERE ELSE.** Never in repo, never in Slack/Discord, never in screenshots.

### Verify isolation
```bash
# This must return nothing - confirms keys never landed in repo:
git log --all -p -S "COLLECTOR_EVM_PRIVATE_KEY" -- ':!.env.example' ':!*.md'
git log --all -p -S "COLLECTOR_SOL_SECRET_KEY" -- ':!.env.example' ':!*.md'
```

## 1. Pick recipient addresses (3 per chain, 6 total)

These are the 90/5/5 destinations. Can be cold wallets, multisigs, exchange
deposit addresses — your call. EVM recipients can be the same address on all
5 EVM chains (secp256k1) if you want; Solana recipients are separate
keypairs.

Document the chosen addresses + their purpose in 1Password ("Spectre Treasury
Recipients") so the team knows where the splits land.

## 2. Vercel env vars (BOTH projects unless noted)

Set these in Vercel Dashboard → Project → Settings → Environment Variables.
Mark all `COLLECTOR_*_PRIVATE_KEY` / `_SECRET_KEY` as **encrypted** (sensitive).

### `spectre-trading` (Production env)
```
FEE_PERCENTAGE=1.0
FEE_BPS=100

COLLECTOR_EVM_ADDRESS=0x...                # public (Step 0)
COLLECTOR_SOL_ADDRESS=...                  # public (Step 0)

COLLECTOR_EVM_PRIVATE_KEY=0x...            # SECRET (Step 0). encrypted.
COLLECTOR_SOL_SECRET_KEY=[1,2,3,...]       # SECRET (Step 0). encrypted. JSON or base58.

FEE_RECIPIENT_EVM_PRIMARY=0x...            # 90% (Step 1)
FEE_RECIPIENT_EVM_SECONDARY=0x...          # 5%
FEE_RECIPIENT_EVM_TERTIARY=0x...           # 5%
FEE_RECIPIENT_SOL_PRIMARY=...              # 90%
FEE_RECIPIENT_SOL_SECONDARY=...            # 5%
FEE_RECIPIENT_SOL_TERTIARY=...             # 5%

# Thresholds (default values; tune via env without redeploy)
CONSOLIDATE_MIN_SWAP_USD_ETHEREUM=50
CONSOLIDATE_MIN_SWAP_USD_BASE=2
CONSOLIDATE_MIN_SWAP_USD_ARBITRUM=2
CONSOLIDATE_MIN_SWAP_USD_BSC=2
CONSOLIDATE_MIN_SWAP_USD_POLYGON=1
CONSOLIDATE_MIN_SWAP_USD_SOLANA=0.10
DISTRIBUTE_MIN_USDC_ETHEREUM=100
DISTRIBUTE_MIN_USDC_BASE=5
DISTRIBUTE_MIN_USDC_ARBITRUM=5
DISTRIBUTE_MIN_USDC_BSC=5
DISTRIBUTE_MIN_USDC_POLYGON=2
DISTRIBUTE_MIN_USDC_SOLANA=0.50
ETHEREUM_MAX_GWEI_NORMAL=50
ETHEREUM_URGENCY_USD=1000

# Cron auth - random 32+ char string (generate fresh, store in 1Password)
CRON_SECRET=...

# RPC URLs (REQUIRED for beta load - public fallbacks rate-limit)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<KEY>
BSC_RPC_URL=https://bsc-mainnet.g.alchemy.com/v2/<KEY>     # or QuickNode
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/<KEY>
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<KEY>
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<KEY>
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<KEY>

# Already set (verify):
ZEROX_API_KEY=...
COINGECKO_API_KEY=...
PRIVY_APP_ID=...                           # prod App ID (cookie-domain locked)
PRIVY_APP_SECRET=...
```

### `spectre-app-research` (Production env)
Same as trading EXCEPT:
- DO NOT set `COLLECTOR_*_PRIVATE_KEY` / `_SECRET_KEY` (no cron here).
- DO NOT set `FEE_RECIPIENT_*` (no cron here either).
- DO NOT set `CRON_SECRET` (no cron here).
- DO set `COLLECTOR_EVM_ADDRESS`, `COLLECTOR_SOL_ADDRESS`, RPC URLs, fee config —
  needed by `verifyEvmSwap` / `verifySolanaSwap` in /api/swap/log to confirm
  the on-chain fee transfer landed at our collector.

## 3. First-time validation (do BEFORE flipping beta)

Run these in order. Each step must pass before moving on.

### 3a. DNS sanity (only relevant if you also did the Privy cookie work)
```bash
# Verify privy.spectreai.io CNAME (if cookie SSO landed)
curl -s "https://dns.google/resolve?name=privy.spectreai.io&type=CNAME" | grep data
```

### 3b. Live small swap, Solana
1. Open `trade.spectreai.io` in a clean browser. Log in via Privy.
2. Fund the embedded Solana wallet with $1 of SOL.
3. Swap $1 of SOL → USDC.
4. Verify on Solscan:
   - Tx successful.
   - A USDC transfer to `COLLECTOR_SOL_ADDRESS`'s USDC ATA equals 1% of output USDC.
5. Open Vercel logs for `spectre-trading` → find `[swap/log] verified` line.
   If you see `no_fee_transfer`, the collector address in env doesn't match
   what Jupiter routed to → recheck env.

### 3c. Live small swap, EVM (Base)
1. Fund the same Privy embedded EVM wallet with $1 of ETH on Base.
2. Swap $1 ETH → USDC. Verify on Basescan that the swap completed and a
   USDC transfer to `COLLECTOR_EVM_ADDRESS` happened (= 1% of output USDC).
3. Now swap that USDC → BONK (or any ERC-20) to exercise Permit2 sell path.
   In DevTools: confirm the Privy signing modal shows the Permit2 EIP-712
   struct. If the modal shows weird `spender` or `amount` values, our
   client-side validator (`assertSafePermit2EIP712`) should THROW with
   "Quote tampered..." — that's the safety net working.

### 3d. Cron dry-run (no signing, no funds moved)
```bash
# Verify the cron path responds + outputs the consolidation plan.
# Each chain in its own curl - confirm all return ok_dryrun.
for c in solana base arbitrum bsc polygon ethereum; do
  echo "=== $c ==="
  curl -s -H "Authorization: Bearer $CRON_SECRET" \
    "https://trade.spectreai.io/api/cron/consolidate-and-distribute?chain=$c&dryRun=1" | jq
done
```
Expected: each returns `{outcome: 'ok_dryrun', tokens_seen: N, ...}` with
sensible counter values. `dry_splits` shows the 90/5/5 breakdown that WOULD
happen on a live run.

### 3e. Cron live small run (Base only first, smallest blast radius)
1. Run step 3c first so there's actually consolidated fees in the Base collector.
2. Trigger live:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "https://trade.spectreai.io/api/cron/consolidate-and-distribute?chain=base"
   ```
3. Verify on Basescan:
   - Non-USDC token balances at COLLECTOR_EVM_ADDRESS swapped to USDC (1-2 tx).
   - USDC transferred 90/5/5 to the three FEE_RECIPIENT_EVM_* addresses (3 tx).
4. Verify Vercel logs show one `fee_consolidation_run` line with
   `outcome=ok`, `consolidated > 0`, `usdc_distributed > 0`.
5. If all green, repeat with the smaller chains (solana, arbitrum, bsc,
   polygon). Save ethereum for last (weekly schedule) and only enable once
   you're confident the rest are stable.

## 4. Operational cadence (post-launch)

### Daily
- Skim Vercel logs for `fee_consolidation_run` lines per chain.
  - `outcome=ok` + non-zero `usdc_distributed` = healthy.
  - `outcome=distribute_below_threshold` = fees accumulating, expected on quiet days.
  - `outcome=skipped_gas_high` (ethereum only) = gas was too high + collector value too small to override; will retry next week.
  - `outcome=error` + non-empty `errors` array = INVESTIGATE.

### Weekly
- Check actual `gas_spent / fees_realized` ratio per chain from logs.
- If a chain consistently wastes >10% of fees on gas, raise the threshold for that chain via env var (no redeploy needed).
- Reconcile recipient wallet balances vs Vercel-logged `usdc_distributed`.

### Emergency stop
If ANY of these happen:
- Suspicious / large unexpected swap from the collector wallet.
- 0x or Jupiter API returns malformed quotes (per logs).
- Recipient address change.

**Disable cron immediately:**
```bash
# Rotate the cron secret - any Vercel-triggered call now returns 401.
# Set a new value in Vercel env; old cron invocations fail; no funds move.
# Then investigate at leisure.
```
(Alternatively: remove the `crons` array from `apps/trading/vercel.json` and redeploy. Slower but more thorough.)

## 5. Key rotation procedure

If a collector key is suspected compromised:
1. Generate new keypair (Step 0).
2. Set new public address in `COLLECTOR_*_ADDRESS` (both Vercel projects).
3. Set new secret in `COLLECTOR_*_PRIVATE_KEY` / `_SECRET_KEY` (trading only).
4. Redeploy both projects.
5. **Old wallet still holds funds** — manually transfer remaining balances
   from the old wallet to the new one using your local copy of the old key.
6. Burn the old key from 1Password + add a "ROTATED yyyy-mm-dd" note.

The trust window (between compromise and rotation) is bounded to ~24h of
fee flow per chain because the cron empties the collector daily.

## 6. Common troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/api/swap/log` returns 400 `no_fee_transfer` | env `COLLECTOR_EVM_ADDRESS` doesn't match what 0x v2 routed the fee to | Recheck env. The collector address must match exactly. |
| Cron returns `gas_skipped` repeatedly on Ethereum | Gas is high + collector value below urgency threshold | Expected behavior. Lower `ETHEREUM_URGENCY_USD` if you want more aggressive sweeps; raise gas threshold if you want it to swallow more cost. |
| Cron returns `swap_failed` for a specific token | Token has no liquidity / price impact too high / blacklisted by 0x | Skipped tokens accumulate; either remove from `FEE_TOKEN_WHITELIST_<CHAIN>` env or accept the dust. |
| `Quote tampered: Permit2 EIP-712 ...` thrown to user | 0x returned a permit struct that doesn't match the quote (genuine tamper, OR 0x v2 changed schema) | Investigate immediately. If 0x changed schema, update `assertSafePermit2EIP712` in `swapService.js`. If genuine tamper — incident response. |
| Cron returns 401 unauthorized | `CRON_SECRET` not set, doesn't match, or wrong header format | Verify env. Header must be `Authorization: Bearer <secret>`. |
