/**
 * YOU V2 — Canonical event types for the You-page tracking pipeline.
 *
 * This file is the single source of truth. The frontend hook (useYouTracking)
 * and the backend route (server/routes/youEvents.js) both validate against
 * this set. Anything not in this list is rejected by the server.
 *
 * Adding a new event type requires:
 *   1. Add it here.
 *   2. Mirror it in packages/server/lib/youEventTypes.js (kept in sync by hand).
 *   3. Document the payload shape in /docs/YOU_V2/TRACKING_SPEC.md.
 */

export const YOU_EVENT_TYPES = Object.freeze({
  DASHBOARD_OPENED:     'you_dashboard_opened',
  DASHBOARD_SAVED:      'you_dashboard_saved',
  DASHBOARD_DUPLICATED: 'you_dashboard_duplicated',
  WIDGET_ADDED:         'you_widget_added',
  WIDGET_REMOVED:       'you_widget_removed',
  WIDGET_VIEWED:        'you_widget_viewed',     // payload.duration_ms
  WIDGET_INTERACTED:    'you_widget_interacted', // payload.interaction_type
  WIDGET_RESIZED:       'you_widget_resized',
  WIDGET_MOVED:         'you_widget_moved',
  TEMPLATE_VIEWED:      'you_template_viewed',
  TEMPLATE_APPLIED:     'you_template_applied',
  COMPOSER_OPENED:      'you_composer_opened',
  COMPOSER_INTENT:      'you_composer_intent',   // payload.intent_text
  COMPOSER_REFINED:     'you_composer_refined',
  COMPOSER_APPLIED:     'you_composer_applied',
});

export const YOU_EVENT_TYPE_VALUES = new Set(Object.values(YOU_EVENT_TYPES));

export function isValidEventType(type) {
  return typeof type === 'string' && YOU_EVENT_TYPE_VALUES.has(type);
}

export default YOU_EVENT_TYPES;
