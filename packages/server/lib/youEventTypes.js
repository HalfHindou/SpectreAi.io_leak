/**
 * YOU V2 — Canonical event types (server mirror).
 *
 * Mirrored by hand from apps/research/src/utils/youEventTypes.js.
 * If you add an event type, update both files in the same commit.
 */

const YOU_EVENT_TYPES = Object.freeze({
  DASHBOARD_OPENED:     'you_dashboard_opened',
  DASHBOARD_SAVED:      'you_dashboard_saved',
  DASHBOARD_DUPLICATED: 'you_dashboard_duplicated',
  WIDGET_ADDED:         'you_widget_added',
  WIDGET_REMOVED:       'you_widget_removed',
  WIDGET_VIEWED:        'you_widget_viewed',
  WIDGET_INTERACTED:    'you_widget_interacted',
  WIDGET_RESIZED:       'you_widget_resized',
  WIDGET_MOVED:         'you_widget_moved',
  TEMPLATE_VIEWED:      'you_template_viewed',
  TEMPLATE_APPLIED:     'you_template_applied',
  COMPOSER_OPENED:      'you_composer_opened',
  COMPOSER_INTENT:      'you_composer_intent',
  COMPOSER_REFINED:     'you_composer_refined',
  COMPOSER_APPLIED:     'you_composer_applied',
});

const YOU_EVENT_TYPE_VALUES = new Set(Object.values(YOU_EVENT_TYPES));

function isValidEventType(type) {
  return typeof type === 'string' && YOU_EVENT_TYPE_VALUES.has(type);
}

module.exports = { YOU_EVENT_TYPES, YOU_EVENT_TYPE_VALUES, isValidEventType };
