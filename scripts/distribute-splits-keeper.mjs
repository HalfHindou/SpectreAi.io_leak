/**
 * 0xSplits auto-distributor keeper - Spectre fee Split.
 * ---------------------------------------------------------------------------
 * Every run: for EACH chain, read the Split's native balance, price it in USD,
 * and if it's >= THRESHOLD_USD call distributeToken() so the accumulated ETH
 * fans out 90/5/5 to the three fee wallets. Meant to run on a schedule
 * (cron / systemd timer, every ~30-60 min).
 *
 * KEYLESS FOR CUSTODY: the keeper key can ONLY trigger a distribution to the
 * Split's FIXED on-chain recipients - it can NEVER redirect or steal funds.
 * If it leaked, the blast radius is only the keeper wallet's own gas. Fund it
 * lightly (~$5-10 native per chain).
 *
 * SETUP
 *   1. Fund a FRESH keeper wallet with a little native gas on each chain.
 *   2. In this repo (or a standalone dir):  npm i @0xsplits/splits-sdk viem
 *   3. Env:
 *        SPLIT_KEEPER_PRIVATE_KEY=0x...      (the keeper wallet, low-risk)
 *        THRESHOLD_USD=50                    (optional, default 50)
 *        # optional faster RPCs (else public fallbacks):
 *        ETH_RPC_URL= BASE_RPC_URL= ARB_RPC_URL= POLYGON_RPC_URL= BSC_RPC_URL=
 *        DRY_RUN=1                           (optional: report only, never send a tx)
 *   4. node scripts/distribute-splits-keeper.mjs
 *      (wrap in a cron: e.g. `*​/30 * * * *` on OVH, or a Vercel Cron.)
 *
 * VALIDATE FIRST: before trusting it, run once with DRY_RUN=1 (confirms it reads
 * every chain's balance + price), then let it do ONE real distribution on a cheap
 * L2 (Base/Arbitrum) and confirm the 90/5/5 landed. Only then rely on it for
 * mainnet.
 */
import { createPublicClient, createWalletClient, http, formatEther, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, base, arbitrum, polygon, bsc } from 'viem/chains'
import { SplitV2Client } from '@0xsplits/splits-sdk'

// Same address on all 5 chains (deployed deterministically via CREATE2).
const SPLIT = '0x88798df0472E0440AA7f10f8117aF8F44c32496E'
const THRESHOLD_USD = Number(process.env.THRESHOLD_USD || 50)
const DRY_RUN = process.env.DRY_RUN === '1'

// The Split's on-chain recipients (90/5/5), passed as `splitFields` so the SDK
// never needs the subgraph or an API key. MUST match the deployed config exactly
// (recipients, %s, and distributorFeePercent = 0 because the bounty is OFF), or
// the on-chain distribute reverts on the config-hash check.
const SPLIT_FIELDS = {
  recipients: [
    { address: '0x15379B3e223E1d8f4b0D989f77b8D364949Fc9e7', percentAllocation: 90 },
    { address: '0xD21C318E8e8F0EfE96EA6f92F14C5647dD0cC82B', percentAllocation: 5 },
    { address: '0xECa8523f51b217D991B5f00f9EeC4667f8063F77', percentAllocation: 5 },
  ],
  distributorFeePercent: 0,
}

const CHAINS = [
  { chain: mainnet,  name: 'ethereum', cg: 'ethereum',      rpc: process.env.ETH_RPC_URL     || 'https://ethereum-rpc.publicnode.com' },
  { chain: base,     name: 'base',     cg: 'ethereum',      rpc: process.env.BASE_RPC_URL    || 'https://base-rpc.publicnode.com' },
  { chain: arbitrum, name: 'arbitrum', cg: 'ethereum',      rpc: process.env.ARB_RPC_URL     || 'https://arbitrum-one-rpc.publicnode.com' },
  { chain: polygon,  name: 'polygon',  cg: 'matic-network', rpc: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com' },
  { chain: bsc,      name: 'bsc',      cg: 'binancecoin',   rpc: process.env.BSC_RPC_URL     || 'https://bsc-rpc.publicnode.com' },
]

async function nativePricesUsd() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,matic-network,binancecoin&vs_currencies=usd',
      { signal: AbortSignal.timeout(10000) },
    )
    return await r.json()
  } catch (e) {
    console.error('[keeper] price fetch failed:', e.message)
    return {}
  }
}

async function main() {
  const pk = process.env.SPLIT_KEEPER_PRIVATE_KEY
  if (!pk && !DRY_RUN) { console.error('SPLIT_KEEPER_PRIVATE_KEY not set (or run with DRY_RUN=1)'); process.exit(1) }
  const account = pk ? privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`) : null
  const prices = await nativePricesUsd()
  console.log(`[keeper] ${new Date().toISOString()} threshold=$${THRESHOLD_USD}${DRY_RUN ? ' DRY_RUN' : ` account=${account?.address}`}`)

  for (const c of CHAINS) {
    try {
      const publicClient = createPublicClient({ chain: c.chain, transport: http(c.rpc) })
      const bal = await publicClient.getBalance({ address: SPLIT })
      const native = Number(formatEther(bal))
      const price = prices[c.cg]?.usd || 0
      const usd = native * price
      const sym = c.chain.nativeCurrency.symbol
      const line = `[${c.name}] ${native.toFixed(6)} ${sym} (~$${usd.toFixed(2)})`
      if (!price) { console.log(`${line} - no price, skip`); continue }
      if (usd < THRESHOLD_USD) { console.log(`${line} - below $${THRESHOLD_USD}, skip`); continue }
      if (DRY_RUN || !account) { console.log(`${line} - >= $${THRESHOLD_USD} -> WOULD DISTRIBUTE (dry run)`); continue }

      const walletClient = createWalletClient({ account, chain: c.chain, transport: http(c.rpc) })
      const splits = new SplitV2Client({ chainId: c.chain.id, publicClient, walletClient })
      console.log(`${line} - DISTRIBUTING...`)
      const { event } = await splits.distributeToken({
        splitAddress: SPLIT,
        tokenAddress: zeroAddress, // native ETH / MATIC / BNB
        distributorAddress: account.address,
        splitFields: SPLIT_FIELDS,
      })
      console.log(`  [${c.name}] distributed - tx ${event?.transactionHash || '(ok)'}`)
    } catch (e) {
      console.error(`[${c.name}] error: ${e.shortMessage || e.message}`)
    }
  }
}

main()
