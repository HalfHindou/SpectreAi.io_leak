/**
 * Spectre Intelligence Hub — Agent Activity Log
 * In-memory log of the last 200 agent events for the real-time activity feed.
 */

const activityLog = [];
const MAX_LOG_SIZE = 200;

function logAgentActivity(event) {
  const entry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    agent: event.agent,       // "market-brief" | "token-analysis" | "stock-analysis" | "thematic"
    action: event.action,     // "started" | "completed" | "failed" | "updated" | "scheduled"
    target: event.target,     // "BTC" | "NVDA" | "2026-02-19" | etc
    targetType: event.targetType, // "crypto" | "stock" | "daily" | "research"
    details: {
      title: event.title || null,
      wordCount: event.wordCount || null,
      sourceCount: event.sourceCount || null,
      generationTimeMs: event.generationTimeMs || null,
      price: event.price || null,
      change: event.change || null,
      slug: event.slug || null,
      error: event.error || null,
    },
  };

  activityLog.unshift(entry);
  if (activityLog.length > MAX_LOG_SIZE) activityLog.pop();
  return entry;
}

function getActivityLog(limit = 20) {
  return activityLog.slice(0, limit);
}

function clearActivityLog() {
  activityLog.length = 0;
}

module.exports = { logAgentActivity, getActivityLog, clearActivityLog };
