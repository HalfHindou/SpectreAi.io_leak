# YOU V2 — TRACKING SPEC

Event tracking infrastructure. Lands in Window 1 so data starts accumulating from day one. The suggestion engine in Phase 5 (later) needs 2-3 weeks of this data before it can do anything useful.

---

## File locations

- `/migrations/youEvents.sql` — TimescaleDB hypertable creation
- `/server/routes/youEvents.js` — POST endpoint that accepts batched events
- `/src/hooks/useYouTracking.js` — frontend hook that batches and posts events
- `/src/utils/youEventTypes.js` — canonical event type constants

---

## Event schema

```sql
CREATE TABLE you_events (
  time          TIMESTAMPTZ      NOT NULL,
  user_id       UUID             NOT NULL,
  session_id    UUID             NOT NULL,
  event_type    TEXT             NOT NULL,
  widget_id     TEXT,
  template_id   TEXT,
  dashboard_id  UUID,
  payload       JSONB,
  created_at    TIMESTAMPTZ      DEFAULT NOW()
);

SELECT create_hypertable('you_events', 'time');

CREATE INDEX idx_you_events_user_time ON you_events (user_id, time DESC);
CREATE INDEX idx_you_events_type_time ON you_events (event_type, time DESC);
CREATE INDEX idx_you_events_widget ON you_events (widget_id, time DESC) WHERE widget_id IS NOT NULL;
```

Compression policy: compress chunks older than 7 days. Retention: keep 90 days uncompressed plus 9 months compressed.

```sql
ALTER TABLE you_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'user_id'
);
SELECT add_compression_policy('you_events', INTERVAL '7 days');
SELECT add_retention_policy('you_events', INTERVAL '275 days');
```

---

## Canonical event types

These are the only event types Phase 4 ships. Anything else is YAGNI.

```javascript
export const YOU_EVENT_TYPES = {
  DASHBOARD_OPENED:       'you_dashboard_opened',
  DASHBOARD_SAVED:        'you_dashboard_saved',
  DASHBOARD_DUPLICATED:   'you_dashboard_duplicated',
  WIDGET_ADDED:           'you_widget_added',
  WIDGET_REMOVED:         'you_widget_removed',
  WIDGET_VIEWED:          'you_widget_viewed',         // duration_ms in payload
  WIDGET_INTERACTED:      'you_widget_interacted',     // interaction_type in payload
  WIDGET_RESIZED:         'you_widget_resized',
  WIDGET_MOVED:           'you_widget_moved',
  TEMPLATE_VIEWED:        'you_template_viewed',
  TEMPLATE_APPLIED:       'you_template_applied',
  COMPOSER_OPENED:        'you_composer_opened',
  COMPOSER_INTENT:        'you_composer_intent',       // intent_text in payload
  COMPOSER_REFINED:       'you_composer_refined',
  COMPOSER_APPLIED:       'you_composer_applied'
};
```

---

## Backend endpoint

`POST /api/you/events`

Accepts a batch of events. The frontend batches in 5-second windows or on tab close, whichever comes first.

### Request body

```json
{
  "events": [
    {
      "time": "2026-04-25T13:42:11Z",
      "session_id": "uuid",
      "event_type": "you_widget_added",
      "widget_id": "whale-tracker",
      "dashboard_id": "uuid",
      "payload": { "source": "manual" }
    }
  ]
}
```

### Validation

- Reject if any event_type is not in the canonical list
- Reject if widget_id references a widget not in the registry (validate against `widgets.json`)
- Cap batch size at 100 events. Reject larger batches.
- Cap payload size at 4KB per event

### Response

```json
{ "accepted": 47, "rejected": 0, "errors": [] }
```

---

## Frontend hook

`useYouTracking()` returns a single `track()` function and manages the batch buffer.

```javascript
import { useYouTracking } from '@/hooks/useYouTracking';

function MyWidget() {
  const { track } = useYouTracking();

  useEffect(() => {
    track('you_widget_viewed', {
      widget_id: 'whale-tracker',
      dashboard_id: dashboardId,
      payload: { duration_ms: 0 }
    });
    // also track duration on unmount
  }, []);
}
```

### Hook responsibilities

- Generate session_id once per browser session, persist in sessionStorage
- Buffer events in memory
- Flush buffer every 5 seconds OR on `beforeunload` OR when buffer reaches 50 events
- Use `navigator.sendBeacon` for the unload flush
- Retry failed batches once, then drop silently (do not block the UI)

---

## Widget viewed timing

The most informative event is `you_widget_viewed` with duration_ms. Implementation:

- On widget mount, record `viewStart = Date.now()`
- On widget unmount or dashboard navigation, fire the event with `duration_ms = Date.now() - viewStart`
- Use `IntersectionObserver` to pause the timer when the widget scrolls out of view
- Reset and resume when it scrolls back in

This data tells you which widgets actually hold attention versus which get added and ignored.

---

## Existence check before starting

```bash
test -f migrations/youEvents.sql && echo "EXISTS: migration" || echo "NOT FOUND"
test -f server/routes/youEvents.js && echo "EXISTS: route" || echo "NOT FOUND"
test -f src/hooks/useYouTracking.js && echo "EXISTS: hook" || echo "NOT FOUND"

# Also check if the table already exists in TimescaleDB
psql $DATABASE_URL -c "\dt you_events" 2>/dev/null || echo "Table not yet created"
```

If any exist with content, audit and extend rather than recreate.

---

## Wiring into existing components

After the infrastructure is built, wire `track()` calls into:

- `/src/components/YouPage.jsx` — fire `DASHBOARD_OPENED` on mount
- Every widget component — fire `WIDGET_VIEWED` on mount with duration tracking
- The drag/resize handlers — fire `WIDGET_MOVED` and `WIDGET_RESIZED`
- The add-widget button — fire `WIDGET_ADDED`
- The remove handler — fire `WIDGET_REMOVED`

Phases 2 and 3 are responsible for firing their own events (template apply, composer events). Phase 4 just provides the infrastructure.

---

## Stop condition

Phase 4 is complete when:
- Migration runs successfully against the local TimescaleDB
- Hypertable, indexes, and compression policy verified
- Endpoint accepts and validates batched events
- Frontend hook batches correctly and uses `sendBeacon` on unload
- A manual test fires 5 different event types and they appear in the table
- `you_widget_viewed` correctly tracks duration with IntersectionObserver pausing

Commit with: `[track] you events pipeline live with hypertable`

Report commit hash. Stop. Wait for go-ahead.
