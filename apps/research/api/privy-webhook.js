/**
 * Vercel Serverless - Privy webhook receiver.
 *
 * Subscribes to Privy events (user.created, user.authenticated, wallet.created,
 * transaction.confirmed, transaction.failed, mfa.enabled, etc.) so we can
 * react server-side without polling.
 *
 * Today: verifies signatures, logs structured event lines, returns 200. Not
 * yet wired to KV / PostHog - that's a follow-up once we decide which events
 * are actionable (audit-gaps #13 closure leaves the event-handler stubs in
 * place for future fill-in).
 *
 * --- Setup (one-time, dashboard) ---
 * 1. Privy dashboard -> Webhooks -> Add endpoint
 *    URL: https://spectre-trading.vercel.app/api/privy-webhook
 *         (and the research equivalent at /api/privy-webhook)
 * 2. Select events to subscribe to (start with user.created, user.authenticated,
 *    wallet.created, transaction.confirmed, transaction.failed)
 * 3. Copy the signing secret -> set as PRIVY_WEBHOOK_SIGNING_SECRET in Vercel
 *    project env vars (both apps if both endpoints subscribe)
 *
 * --- Signature verification ---
 * Privy webhooks follow the Svix format. Headers:
 *   svix-id        message ID (used to dedupe replays)
 *   svix-timestamp unix seconds; verify rejects if outside +/-5 min window
 *   svix-signature 1+ comma-separated signatures (each `v1,<base64>`)
 *
 * The SDK's verify() method handles all three checks and throws
 * InvalidWebhookError on any failure. We map that to HTTP 400.
 *
 * --- Body parsing ---
 * Vercel's default body parser would mutate the bytes and break HMAC
 * verification. We disable it and read the raw stream.
 */

import { PrivyClient } from '@privy-io/node'
import { setWebhookTxStatus, recordWebhookUserEvent } from './_lib/kv.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

let _client = null
function getClient() {
  if (_client) return _client
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) return null
  _client = new PrivyClient({
    appId: process.env.PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET,
    webhookSigningSecret: process.env.PRIVY_WEBHOOK_SIGNING_SECRET || undefined,
  })
  return _client
}

async function readRawBody(req) {
  // Vercel Node functions stream chunks; assemble into a single string.
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function safeLog(s) {
  if (typeof s !== 'string') return String(s)
  // Strip CR/LF + cap length to keep log lines parseable in Vercel's UI.
  return s.replace(/[\r\n]+/g, ' ').slice(0, 300)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const signingSecret = process.env.PRIVY_WEBHOOK_SIGNING_SECRET
  if (!signingSecret) {
    // Endpoint reachable but not configured. Return 503 so Privy's retry queue
    // backs off rather than hammering us. The "configure secret in dashboard"
    // path is in the file header.
    console.warn('[privy-webhook] PRIVY_WEBHOOK_SIGNING_SECRET not set - rejecting')
    return res.status(503).json({ error: 'webhook receiver not configured' })
  }

  const svixId = req.headers['svix-id']
  const svixTimestamp = req.headers['svix-timestamp']
  const svixSignature = req.headers['svix-signature']
  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).json({ error: 'missing svix headers' })
  }

  let rawBody
  try {
    rawBody = await readRawBody(req)
  } catch (err) {
    console.error('[privy-webhook] body read failed:', err?.message)
    return res.status(400).json({ error: 'body read failed' })
  }

  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return res.status(400).json({ error: 'invalid json' })
  }

  const client = getClient()
  if (!client) {
    return res.status(503).json({ error: 'privy client not configured' })
  }

  let event
  try {
    event = await client.webhooks().verify({
      payload,
      svix: {
        id: String(svixId),
        timestamp: String(svixTimestamp),
        signature: String(svixSignature),
      },
      signing_secret: signingSecret,
    })
  } catch (err) {
    console.warn('[privy-webhook] verify failed:', safeLog(err?.message || 'unknown'))
    return res.status(400).json({ error: 'signature verification failed' })
  }

  // Structured single-line log for Vercel's log explorer.
  // Event types per @privy-io/node WebhookEvent union (see SDK docs).
  const type = event?.type || 'unknown'
  const userId = event?.data?.user?.id || event?.data?.userId || event?.data?.wallet?.user_id || null
  console.log(`[privy-webhook] type=${safeLog(type)} svix_id=${safeLog(svixId)} user=${safeLog(userId)}`)

  // Event handlers. All writes are best-effort; KV failures must not 5xx
  // back to Privy or it'll retry the event indefinitely (lost-message risk
  // is acceptable for these analytics-grade writes).
  try {
    await handleEvent(type, event, userId, svixId)
  } catch (err) {
    console.error('[privy-webhook] handler error:', safeLog(err?.message || 'unknown'), 'type=', safeLog(type))
    // Still 200 - we verified the signature, the body is real, we just couldn't
    // write the side-effect. Retry-driven re-write would amplify the failure.
  }

  // Always 2xx on a verified event so Privy doesn't retry.
  return res.status(200).json({ ok: true })
}

async function handleEvent(type, event, userId, svixId) {
  const data = event?.data || {}

  switch (type) {
    case 'user.created':
    case 'user.authenticated':
    case 'user.linked_account':
    case 'user.unlinked_account':
    case 'user.updated_account':
    case 'user.wallet_created':
      // Append to a rolling per-user event list (last 50 retained). Useful for
      // support tooling ("when did this user first sign in?") and lightweight
      // funnel analytics without paying a posthog-node dependency yet.
      if (userId) {
        await recordWebhookUserEvent(userId, type, {
          // Strip nested user.linked_accounts to keep entries compact - the type
          // alone is the signal; full state lives in Privy.
          source: data?.source || data?.method || null,
          wallet_address: data?.wallet?.address || data?.linked_account?.address || null,
          svix_id: svixId ? String(svixId) : null,
        })
      }
      break

    case 'transaction.confirmed':
    case 'transaction.failed':
    case 'transaction.broadcasted':
    case 'transaction.execution_reverted':
    case 'transaction.replaced':
    case 'transaction.still_pending':
    case 'transaction.provider_error': {
      // Persist latest status keyed by tx hash so the client (and future
      // status-poller paths) can short-circuit chain RPC polling. 7d TTL
      // keeps KV bounded since old txs aren't actionable.
      const txHash = data?.transaction?.hash
        || data?.transaction?.signature
        || data?.hash
        || data?.signature
        || null
      if (txHash) {
        // Map the verbose Privy event type to a short status verb the rest of
        // the codebase can switch on without knowing webhook details.
        const statusMap = {
          'transaction.confirmed': 'confirmed',
          'transaction.failed': 'failed',
          'transaction.broadcasted': 'broadcasted',
          'transaction.execution_reverted': 'reverted',
          'transaction.replaced': 'replaced',
          'transaction.still_pending': 'pending',
          'transaction.provider_error': 'provider_error',
        }
        await setWebhookTxStatus(txHash, {
          status: statusMap[type] || type,
          chainId: data?.chain_id || data?.chainId || null,
          blockNumber: data?.block_number || data?.transaction?.block_number || null,
          error: data?.error || null,
          replacement_hash: data?.replacement_transaction?.hash || null,
          updatedAt: Date.now(),
        })
      }
      break
    }

    case 'mfa.enabled':
    case 'mfa.disabled':
      // Future: gate sensitive actions when MFA is unset. Today just log via
      // the user-event list so support can see MFA changes during incident
      // investigations.
      if (userId) {
        await recordWebhookUserEvent(userId, type, {
          mfa_method: data?.method || data?.mfa_method || null,
          svix_id: svixId ? String(svixId) : null,
        })
      }
      break

    default:
      // Unknown event type - already logged at the top-level handler. Ack
      // to prevent retry storm.
      break
  }
}
