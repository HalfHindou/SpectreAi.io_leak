/**
 * YOU V2 — Event tracking endpoint (Phase 4).
 *
 * POST /api/you/events
 *
 * Body: { events: [{ time, user_id, session_id, event_type, widget_id?, template_id?, dashboard_id?, payload? }, ...] }
 *
 * Validation:
 *   - Batch size cap: 100 events
 *   - Per-event payload cap: 4 KB (when serialized)
 *   - event_type must be in YOU_EVENT_TYPES
 *   - widget_id (when present) must exist in the widget registry
 *
 * Response: { accepted, rejected, errors }
 *
 * Storage: better-sqlite3 (packages/server/data/youEvents.db).
 * Production target is TimescaleDB — see migrations/youEvents.sql.
 */

const express = require('express');
const { isValidEventType } = require('../lib/youEventTypes');
const { getWidgetIds } = require('../services/widgetRegistry');
const { insertEvents, countEvents } = require('../lib/youEventsStore');

const MAX_BATCH = 100;
const MAX_PAYLOAD_BYTES = 4 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isIsoTime(v) {
  if (typeof v !== 'string') return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

const router = express.Router();

// Body parser is mounted globally on the Express app (express.json()).
router.post('/events', async (req, res) => {
  try {
    const events = req?.body?.events;
    if (!Array.isArray(events)) {
      return res.status(400).json({ accepted: 0, rejected: 0, errors: ['events must be an array'] });
    }
    if (events.length === 0) {
      return res.json({ accepted: 0, rejected: 0, errors: [] });
    }
    if (events.length > MAX_BATCH) {
      return res.status(413).json({
        accepted: 0,
        rejected: events.length,
        errors: [`batch size ${events.length} exceeds cap of ${MAX_BATCH}`],
      });
    }

    const widgetIds = await getWidgetIds();
    const accepted = [];
    const errors = [];

    for (const [i, e] of events.entries()) {
      const where = `events[${i}]`;
      if (!e || typeof e !== 'object') {
        errors.push(`${where}: not an object`);
        continue;
      }
      if (!isIsoTime(e.time)) {
        errors.push(`${where}: time must be a parseable ISO-8601 string`);
        continue;
      }
      if (!isUuid(e.user_id)) {
        errors.push(`${where}: user_id must be a UUID`);
        continue;
      }
      if (!isUuid(e.session_id)) {
        errors.push(`${where}: session_id must be a UUID`);
        continue;
      }
      if (!isValidEventType(e.event_type)) {
        errors.push(`${where}: event_type "${e.event_type}" is not in the canonical list`);
        continue;
      }
      if (e.widget_id != null && !widgetIds.has(e.widget_id)) {
        errors.push(`${where}: widget_id "${e.widget_id}" is not in the registry`);
        continue;
      }
      if (e.dashboard_id != null && !isUuid(e.dashboard_id)) {
        errors.push(`${where}: dashboard_id must be a UUID when present`);
        continue;
      }
      if (e.payload != null && typeof e.payload !== 'object') {
        errors.push(`${where}: payload must be an object when present`);
        continue;
      }
      if (e.payload != null) {
        const bytes = Buffer.byteLength(JSON.stringify(e.payload), 'utf8');
        if (bytes > MAX_PAYLOAD_BYTES) {
          errors.push(`${where}: payload size ${bytes}B exceeds cap of ${MAX_PAYLOAD_BYTES}B`);
          continue;
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
      });
    }

    insertEvents(accepted);

    return res.json({
      accepted: accepted.length,
      rejected: events.length - accepted.length,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ accepted: 0, rejected: 0, errors: [err?.message || 'internal error'] });
  }
});

router.get('/events/health', (_req, res) => {
  res.json({ ok: true, total: countEvents() });
});

module.exports = router;
