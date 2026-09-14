/**
 * Vercel Serverless – User & account router.
 * Consolidates: user, admin, referral, fee-config, notifications-api
 * Dispatches via ?fn= query parameter.
 */
import user from './_lib/handlers/user.js'
import admin from './_lib/handlers/admin.js'
import referral from './_lib/handlers/referral.js'
import feeConfig from './_lib/handlers/fee-config.js'
import notificationsApi from './_lib/handlers/notifications-api.js'
import { isAuthGateValid } from './auth-gate.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const handlers = {
  'user': user,
  'admin': admin,
  'referral': referral,
  'fee-config': feeConfig,
  'notifications-api': notificationsApi,
}

// `fee-config` is read by the swap quote flow which is intentionally public
// (anon users can preview a quote). `user` and `referral` enforce their own
// per-call Privy JWT verification, so they don't need the gate cookie too.
// `admin` was here under the (incorrect) assumption that it also did Privy
// JWT — it actually uses an `Authorization: Bearer ADMIN_API_KEY` header
// plus a per-IP rate limit. With the cold-start rate-limit bypass (Sunny
// audit 2026-05-28), the rate-limit can be multiplied across instances,
// leaving only the API-key header. Removing `admin` from PUBLIC_FNS adds
// the gate cookie as a second factor: a brute-forcer now needs both the
// admin key AND the team password. All admin callers are internal research
// UI pages (apps/research/src/pages/admin/, apps/research/src/pages/
// admin-tg-onboard/) which the user can only reach after passing the gate,
// so this adds no friction for legit use.
const PUBLIC_FNS = new Set(['fee-config', 'user', 'referral'])

export default async function handler(req, res) {
  const fn = req.query.fn
  if (!PUBLIC_FNS.has(fn) && !isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  if (!PUBLIC_FNS.has(fn)) sealGatedResponse(res)
  const h = handlers[fn]
  if (!h) return res.status(400).json({ error: `Unknown account-api function: ${fn}` })
  return h(req, res)
}
