-- YOU V2 — Event tracking hypertable (Phase 4)
-- Target: TimescaleDB (>= 2.10)
-- This file is the canonical schema for production. The dev environment
-- currently runs against SQLite (packages/server/lib/youEventsStore.js)
-- because the monorepo does not yet ship a Postgres/Timescale connection.
-- When Timescale is provisioned, run this once: psql "$DATABASE_URL" -f migrations/youEvents.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS you_events (
  time         TIMESTAMPTZ      NOT NULL,
  user_id      UUID             NOT NULL,
  session_id   UUID             NOT NULL,
  event_type   TEXT             NOT NULL,
  widget_id    TEXT,
  template_id  TEXT,
  dashboard_id UUID,
  payload      JSONB,
  created_at   TIMESTAMPTZ      DEFAULT NOW()
);

SELECT create_hypertable('you_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_you_events_user_time
  ON you_events (user_id, time DESC);

CREATE INDEX IF NOT EXISTS idx_you_events_type_time
  ON you_events (event_type, time DESC);

CREATE INDEX IF NOT EXISTS idx_you_events_widget
  ON you_events (widget_id, time DESC)
  WHERE widget_id IS NOT NULL;

ALTER TABLE you_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'user_id'
);

SELECT add_compression_policy('you_events', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('you_events', INTERVAL '275 days', if_not_exists => TRUE);
