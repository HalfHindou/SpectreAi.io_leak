/**
 * Vercel Serverless — YOU V2 events handler.
 *
 * Mirrors packages/server/routes/youEvents.js so production has the same
 * /api/you/events POST endpoint as dev. Body validation + canonical event
 * type check + widget-id check + 4KB-per-event cap + 100-event batch cap.
 *
 * Storage path differs from the Express server:
 *   - dev: better-sqlite3 (packages/server/data/youEvents.db)
 *   - prod: writes to Vercel KV under key `you-events:<YYYY-MM-DD>` as a
 *     JSON-encoded array (append-only). When TimescaleDB is provisioned,
 *     swap this for a pg client write.
 *
 * Why KV: this codebase already uses @vercel/kv. Avoids adding a new
 * dependency on a Vercel-managed Postgres before production is ready.
 */

import { kv } from '@vercel/kv'

const MAX_BATCH = 100
const MAX_PAYLOAD_BYTES = 4 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const YOU_EVENT_TYPE_VALUES = new Set([
  'you_dashboard_opened',
  'you_dashboard_saved',
  'you_dashboard_duplicated',
  'you_widget_added',
  'you_widget_removed',
  'you_widget_viewed',
  'you_widget_interacted',
  'you_widget_resized',
  'you_widget_moved',
  'you_template_viewed',
  'you_template_applied',
  'you_composer_opened',
  'you_composer_intent',
  'you_composer_refined',
  'you_composer_applied',
])

let cachedRegistryIds = null

async function getWidgetIds() {
  if (cachedRegistryIds) return cachedRegistryIds
  // Lazy-load the registry. Module path is shared with the dev server.
  const reg = await import('../../../src/registry/widgets.js')
  cachedRegistryIds = new Set(reg.WIDGETS.map((w) => w.id))
  return cachedRegistryIds
}

function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v) }
function isIsoTime(v) { return typeof v === 'string' && Number.isFinite(Date.parse(v)) }

export default async function handler(req, res) {
  if (req.method === 'GET' && req.url?.endsWith('/health')) {
    return res.status(200).json({ ok: true, store: 'vercel-kv' })
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  try {
    const events = req.body?.events
    if (!Array.isArray(events)) {
      return res.status(400).json({ accepted: 0, rejected: 0, errors: ['events must be an array'] })
    }
    if (events.length === 0) {
      return res.status(200).json({ accepted: 0, rejected: 0, errors: [] })
    }
    if (events.length > MAX_BATCH) {
      return res.status(413).json({
        accepted: 0,
        rejected: events.length,
        errors: [`batch size ${events.length} exceeds cap of ${MAX_BATCH}`],
      })
    }

    const widgetIds = await getWidgetIds()
    const accepted = []
    const errors = []

    for (const [i, e] of events.entries()) {
      const where = `events[${i}]`
      if (!e || typeof e !== 'object') { errors.push(`${where}: not an object`); continue }
      if (!isIsoTime(e.time)) { errors.push(`${where}: time must be a parseable ISO-8601 string`); continue }
      if (!isUuid(e.user_id)) { errors.push(`${where}: user_id must be a UUID`); continue }
      if (!isUuid(e.session_id)) { errors.push(`${where}: session_id must be a UUID`); continue }
      if (!YOU_EVENT_TYPE_VALUES.has(e.event_type)) {
        errors.push(`${where}: event_type "${e.event_type}" not in canonical list`); continue
      }
      if (e.widget_id != null && !widgetIds.has(e.widget_id)) {
        errors.push(`${where}: widget_id "${e.widget_id}" not in registry`); continue
      }
      if (e.dashboard_id != null && !isUuid(e.dashboard_id)) {
        errors.push(`${where}: dashboard_id must be a UUID when present`); continue
      }
      if (e.payload != null) {
        if (typeof e.payload !== 'object') { errors.push(`${where}: payload must be an object`); continue }
        const bytes = Buffer.byteLength(JSON.stringify(e.payload), 'utf8')
        if (bytes > MAX_PAYLOAD_BYTES) {
          errors.push(`${where}: payload size ${bytes}B exceeds cap of ${MAX_PAYLOAD_BYTES}B`); continue
        }
      }
      accepted.push({
        time: new Date(e.time).toISOString(),
        user_id: e.user_id,
        session_id: e.session_id,
        event_type: e.event_type,
        widget_id: e.widget_id ?? null,
        template_id: typeof e.template_id === 'string' ? e.template_id : null,
        dashboard_id: e.dashboard_id ?? null,
        payload: e.payload ?? null,
      })
    }

    if (accepted.length > 0) {
      const dayKey = `you-events:${new Date().toISOString().slice(0, 10)}`
      try {
        // KV append via lpush is constant-time and ordered by insert.
        // We push each event as its own list entry (max ~10MB per list value).
        await kv.lpush(dayKey, ...accepted.map((e) => JSON.stringify(e)))
        // 30-day TTL — long enough for the suggestion engine warmup window.
        await kv.expire(dayKey, 30 * 24 * 60 * 60)
      } catch (kvErr) {
        // Tracking must never block the user — swallow KV errors with a clear log.
        console.warn('[you-events] KV write failed:', kvErr?.message || kvErr)
      }
    }

    return res.status(200).json({
      accepted: accepted.length,
      rejected: events.length - accepted.length,
      errors,
    })
  } catch (err) {
    return res.status(500).json({ accepted: 0, rejected: 0, errors: [err?.message || 'internal error'] })
  }
}
