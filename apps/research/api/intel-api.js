/**
 * Vercel Serverless – Intelligence & AI content router.
 * Consolidates: intelligence-api, insight-api, brief-api, calendar-api
 * Dispatches via ?fn= query parameter.
 */
import intelligenceApi from './_lib/handlers/intelligence-api.js'
import insightApi from './_lib/handlers/insight-api.js'
import briefApi from './_lib/handlers/brief-api.js'
import calendarApi from './_lib/handlers/calendar-api.js'
import dossierProxy from './_lib/handlers/dossier-proxy.js'
import dossierApi from './_lib/handlers/dossier-api.js'
import intelTrigger from './_lib/handlers/intel-trigger.js'
import detectiveProxy from './_lib/handlers/detective-proxy.js'
import brainChatProxy from './_lib/handlers/brain-chat-proxy.js'
import brainChatStreamProxy from './_lib/handlers/brain-chat-stream-proxy.js'
import brainStreamProxy from './_lib/handlers/brain-stream-proxy.js'
import sentimentRead from './_lib/handlers/sentiment-read.js'
import crowdStance from './_lib/handlers/crowd-stance.js'
import projectDossier from './_lib/handlers/project-dossier.js'
import brainDesk from './_lib/handlers/brain-desk.js'
import { isAuthGateValid, isDemoSession } from './auth-gate.js'
import { rateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const handlers = {
  'intelligence-api': intelligenceApi,
  'insight-api': insightApi,
  'brief-api': briefApi,
  'calendar-api': calendarApi,
  'dossier-proxy': dossierProxy,
  'dossier-api': dossierApi,
  'intel-trigger': intelTrigger,
  'detective-proxy': detectiveProxy,
  'brain-chat-proxy': brainChatProxy,
  'brain-chat-stream-proxy': brainChatStreamProxy,
  'brain-stream-proxy': brainStreamProxy,
  'sentiment-read': sentimentRead,
  'crowd-stance': crowdStance,
  'project-dossier': projectDossier,
  'brain-desk': brainDesk,
}

// 2026-05-13 SEC-20260513-017 — three-tier access for the showcase iframe:
//
//   TIER 1 — always-public (no cookie at all, just rate-limited):
//     fn=brief-api + route=voices              (static voice config, zero cost)
//     fn=brief-api + route=breaking-synthesis  (reads cached brief from KV)
//
//   TIER 2 — demo-session cookie OR full gate (read-only, cron-cached or
//   cheap-per-call paths the showcase iframe needs to render real data):
//     fn=intelligence-api + route=breaking     (cached news list)
//     fn=brief-api + route=showcase            (NEW - reads cron-warmed KV)
//     fn=calendar-api + route=economic         (cached economic calendar)
//     fn=calendar-api + route=themes           (cached themes)
//
//   TIER 3 — full gate only (paid inference, mutations, sensitive proxies):
//     fn=brief-api + route=generate            (Anthropic LLM, $$$)
//     fn=brief-api + route=audio               (ElevenLabs TTS, $$$)
//     fn=brain-*-proxy                         (Groq/Brain LLM, $$$)
//     fn=intel-trigger / dossier-proxy / detective-proxy
//     anything not listed above
const TIER1_PUBLIC = {
  // market-news is a zero-cost, CDN-cached RSS read (no LLM) — safe as public.
  'brief-api': new Set(['voices', 'breaking-synthesis', 'market-news']),
}
const TIER2_DEMO_OR_GATE = {
  'intelligence-api': new Set(['breaking']),
  // market-outlook runs a (cheap, CDN-cached) LLM call — keep it demo-or-gate to
  // avoid anonymous cost abuse. Feeds the home Market Summary tab like showcase.
  'brief-api': new Set(['showcase', 'market-outlook']),
  'calendar-api': new Set(['economic', 'themes', 'reaction']),
}

function tierOf(req) {
  const fn = req.query?.fn
  const route = (req.query?.route || '').toLowerCase()
  if (!fn) return 'tier3'
  if (TIER1_PUBLIC[fn]?.has(route)) return 'tier1'
  if (TIER2_DEMO_OR_GATE[fn]?.has(route)) return 'tier2'
  return 'tier3'
}

export default async function handler(req, res) {
  const fn = req.query.fn
  const tier = tierOf(req)
  const authed = isAuthGateValid(req)
  if (!authed) {
    if (tier === 'tier3') {
      return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
    }
    if (tier === 'tier2' && !isDemoSession(req)) {
      return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
    }
    // Tighter rate-limit on anonymous + demo tiers. Cached/static reads so
    // cost-per-call is near-zero - main concern is request volume.
    const bucket = tier === 'tier1' ? 'intel-api-anon' : 'intel-api-demo'
    const max = tier === 'tier1' ? 20 : 40
    if (await rateLimit(req, res, { bucket, max, windowMs: 60_000 })) return
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  // Sealed for TIER3 only, matching data-api's rule: seal unless the payload
  // is one we have declared showable without a full session. Tier1 is open and
  // tier2 (breaking / showcase / economic calendar / themes) is what the demo
  // iframe already serves the public — its edge cache is worth more than the
  // demo-cookie boundary. Tier3 is the paid-inference, mutation and sensitive-
  // proxy half and must not sit on a shared edge.
  if (tier === 'tier3') sealGatedResponse(res)
  const h = handlers[fn]
  if (!h) return res.status(400).json({ error: `Unknown intel-api function: ${fn}` })
  return h(req, res)
}
