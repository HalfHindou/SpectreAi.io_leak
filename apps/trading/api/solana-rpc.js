/**
 * Vercel Serverless - Solana JSON-RPC proxy (read-only allowlist)
 *
 * Why this exists (2026-07-06 real-money audit): the public Solana RPC
 * (api.mainnet-beta.solana.com) rejects browser requests (CORS), so every
 * client-side read - wallet balances, withdraw blockhash/ATA checks, swap
 * confirmation polling - silently failed and the wallet page showed $0.00
 * for funded wallets. The client's web3.js Connection now points at THIS
 * same-origin endpoint, which forwards to a server-side RPC
 * (HELIUS_RPC_URL || SOLANA_RPC_URL || public fallback).
 *
 * SECURITY: strict method allowlist. sendTransaction IS allowed (added
 * 2026-07-07): Privy v3 broadcasts through the app-configured kit RPC
 * (config.solana.rpcs), NOT Privy infrastructure - the original "Privy
 * broadcasts signed txs itself" assumption was a pre-v3 fossil. This relay
 * only forwards ALREADY-SIGNED bytes (it cannot sign), is rate-limited, and
 * routing sends here yields standard JSON-RPC error shapes (publicnode's
 * nonstandard preflight errors crash @solana/kit's error parser) plus
 * server-side logging of send failures.
 */

import { rateLimit } from './_lib/ratelimit.js'

// Ordered upstream candidates - the free public mainnet-beta endpoint
// rate-limits aggressively (the 15s balance poll alone can trip it), so a
// failure or 429/5xx rotates to the next host. A keyed HELIUS_RPC_URL /
// SOLANA_RPC_URL always takes priority.
const SOL_RPC_CANDIDATES = [
  process.env.HELIUS_RPC_URL,
  process.env.SOLANA_RPC_URL,
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
].filter(Boolean)

const ALLOWED_METHODS = new Set([
  'getBalance',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getAccountInfo',
  'getMultipleAccounts',
  'getLatestBlockhash',
  'getSignatureStatuses',
  'getVersion',
  'getSlot',
  'simulateTransaction',
  'getTransaction',
  'getParsedTransaction',
  // Privy v3 kit send + confirm path
  'sendTransaction',
  'getBlockHeight',
  'getEpochInfo',
  'getFeeForMessage',
  'getRecentPrioritizationFees',
  'getMinimumBalanceForRentExemption',
  'getGenesisHash',
  'getHealth',
])

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
  'https://trade.spectreai.io',
  'https://app.spectreai.io',
  'https://spectre-trading.vercel.app',
  'https://spectre-app-research.vercel.app',
]

function validEntry(entry) {
  return entry && typeof entry === 'object' && typeof entry.method === 'string' && ALLOWED_METHODS.has(entry.method)
}

export default async function handler(req, res) {
  const origin = req.headers?.origin
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Balance polls run every 15s per open tab - budget generously but bounded.
  if (await rateLimit(req, res, { bucket: 'solana-rpc', max: 120, windowMs: 60_000 })) return

  const body = req.body
  const entries = Array.isArray(body) ? body : [body]
  if (entries.length === 0 || entries.length > 25 || !entries.every(validEntry)) {
    return res.status(400).json({ error: 'Unsupported RPC request' })
  }

  // sendTransaction: fan out to ALL upstreams in parallel - the first node
  // that ACCEPTS the tx (body carries "result") wins. Signed txs are
  // idempotent (same signature), so multi-submit is safe, lands faster, and
  // never pays a lagging primary's timeout serially. All-reject returns the
  // first upstream's JSON-RPC error body so the client parses a real error.
  const sendEntry = entries.length === 1 && entries[0].method === 'sendTransaction'
  if (sendEntry && SOL_RPC_CANDIDATES.length > 1) {
    const bodyStr = JSON.stringify(body)
    try {
      const winner = await Promise.any(SOL_RPC_CANDIDATES.map(async (rpc) => {
        const upstream = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          signal: AbortSignal.timeout(8000),
        })
        const text = await upstream.text()
        if (!upstream.ok || !text.includes('"result"')) {
          throw new Error(text || `status ${upstream.status}`)
        }
        return text
      }))
      res.setHeader('Content-Type', 'application/json')
      return res.status(200).send(winner)
    } catch (aggErr) {
      const firstBody = aggErr?.errors?.[0]?.message
      console.warn('[solana-rpc] sendTransaction rejected by all upstreams:', String(firstBody).slice(0, 400))
      if (firstBody && firstBody.trim().startsWith('{')) {
        res.setHeader('Content-Type', 'application/json')
        return res.status(200).send(firstBody)
      }
      return res.status(502).json({ error: 'RPC upstream failed' })
    }
  }

  let lastErr = null
  for (const rpc of SOL_RPC_CANDIDATES) {
    try {
      const upstream = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      })
      if (upstream.status === 429 || upstream.status >= 500) {
        lastErr = new Error(`${rpc} -> ${upstream.status}`)
        continue
      }
      const data = await upstream.text()
      // Surface send failures in function logs - the browser-side kit error
      // formatter has crashed on malformed shapes; this is the source of truth.
      if (entries.some((e) => e.method === 'sendTransaction') && data.includes('"error"')) {
        console.warn('[solana-rpc] sendTransaction error:', data.slice(0, 500))
      }
      res.setHeader('Content-Type', 'application/json')
      return res.status(upstream.status).send(data)
    } catch (err) {
      lastErr = err
    }
  }
  console.error('[solana-rpc] all upstreams failed:', lastErr?.message)
  return res.status(502).json({ error: 'RPC upstream failed' })
}
