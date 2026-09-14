/**
 * YOU V2 — Event store (SQLite implementation).
 *
 * Why SQLite: the canonical TRACKING_SPEC targets TimescaleDB, but the monorepo
 * does not currently provision Postgres/Timescale. Rather than block tracking
 * on infrastructure, this module writes to a local SQLite database that mirrors
 * the production schema closely. When Timescale is provisioned, run
 * migrations/youEvents.sql, swap this module's `insertEvents` to use pg, and
 * re-import historical rows from this database.
 *
 * Table shape mirrors you_events from migrations/youEvents.sql with these
 * adjustments (SQLite vs TimescaleDB):
 *   - TIMESTAMPTZ → TEXT (ISO-8601 string)
 *   - UUID        → TEXT
 *   - JSONB       → TEXT (JSON string)
 *   - hypertable / compression / retention policies omitted (Timescale-only)
 *
 * Indexes match the production design.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'youEvents.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS you_events (
    time         TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    widget_id    TEXT,
    template_id  TEXT,
    dashboard_id TEXT,
    payload      TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_you_events_user_time
    ON you_events (user_id, time DESC);

  CREATE INDEX IF NOT EXISTS idx_you_events_type_time
    ON you_events (event_type, time DESC);

  CREATE INDEX IF NOT EXISTS idx_you_events_widget
    ON you_events (widget_id, time DESC) WHERE widget_id IS NOT NULL;
`);

const insertStmt = db.prepare(`
  INSERT INTO you_events (time, user_id, session_id, event_type, widget_id, template_id, dashboard_id, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((rows) => {
  for (const r of rows) {
    insertStmt.run(
      r.time,
      r.user_id,
      r.session_id,
      r.event_type,
      r.widget_id ?? null,
      r.template_id ?? null,
      r.dashboard_id ?? null,
      r.payload ? JSON.stringify(r.payload) : null,
    );
  }
});

function insertEvents(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  insertMany(rows);
  return rows.length;
}

function countEvents() {
  return db.prepare('SELECT COUNT(*) AS n FROM you_events').get().n;
}

function recentEvents(limit = 20) {
  return db.prepare('SELECT * FROM you_events ORDER BY created_at DESC LIMIT ?').all(limit);
}

module.exports = { insertEvents, countEvents, recentEvents };
