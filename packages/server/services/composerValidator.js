/**
 * YOU V2 — Composer JSON validator.
 *
 * Validates the strict-JSON dashboard the model returns. Rules per
 * /docs/YOU_V2/CHATBOT_SPEC.md §Validator:
 *
 *   1. Output is valid JSON.
 *   2. widgets is an array, length 1..8.
 *   3. Every widget_id exists in the registry.
 *   4. No two widgets overlap on the grid.
 *   5. Total grid usage fits within 12 columns (x + w <= 12).
 *   6. Every widget respects its min_size (and max_size when defined).
 *   7. rationale is a non-empty string.
 *
 * The validator is fed a registry array (already scoped to the user's tier
 * by the caller). Tier checks are not enforced again here.
 */

const MAX_WIDGETS = 8;

function parseJsonSafe(text) {
  if (typeof text !== 'string') return null;
  // Models sometimes wrap JSON in code fences. Strip them.
  let trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * @param {string|object} responseTextOrObject
 * @param {Array} registry  registry entries (scoped to user tier)
 * @returns {{ valid: boolean, errors: string[], data: ?object }}
 */
function validateComposerOutput(responseTextOrObject, registry) {
  const errors = [];
  const data = typeof responseTextOrObject === 'string'
    ? parseJsonSafe(responseTextOrObject)
    : responseTextOrObject;

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['response is not valid JSON'], data: null };
  }
  if (!Array.isArray(data.widgets)) {
    errors.push('widgets must be an array');
  }
  if (typeof data.rationale !== 'string' || data.rationale.trim() === '') {
    errors.push('rationale must be a non-empty string');
  }
  if (errors.length > 0) {
    return { valid: false, errors, data };
  }

  if (data.widgets.length < 1 || data.widgets.length > MAX_WIDGETS) {
    errors.push(`widgets length ${data.widgets.length} outside 1..${MAX_WIDGETS}`);
  }

  const byId = new Map(registry.map((w) => [w.id, w]));
  const seenIds = new Set();

  for (const [i, item] of data.widgets.entries()) {
    const where = `widgets[${i}]`;
    if (!item || typeof item !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (typeof item.widget_id !== 'string') {
      errors.push(`${where}: widget_id required`);
      continue;
    }
    const reg = byId.get(item.widget_id);
    if (!reg) {
      errors.push(`${where}: widget_id "${item.widget_id}" is not in the registry`);
      continue;
    }
    if (seenIds.has(item.widget_id)) {
      errors.push(`${where}: duplicate widget_id "${item.widget_id}"`);
    }
    seenIds.add(item.widget_id);

    for (const f of ['x', 'y', 'w', 'h']) {
      if (typeof item[f] !== 'number' || !Number.isFinite(item[f])) {
        errors.push(`${where}: ${f} must be a finite number`);
      }
    }
    if (errors.some(e => e.startsWith(where))) continue;

    if (item.x < 0 || item.y < 0) errors.push(`${where}: x and y must be >= 0`);
    if (item.x + item.w > 12) errors.push(`${where}: x+w (${item.x + item.w}) exceeds 12-column grid`);
    if (item.w < reg.min_size.w || item.h < reg.min_size.h) {
      errors.push(`${where}: ${item.w}x${item.h} smaller than registry min_size ${reg.min_size.w}x${reg.min_size.h}`);
    }
    if (reg.max_size && (item.w > reg.max_size.w || item.h > reg.max_size.h)) {
      errors.push(`${where}: ${item.w}x${item.h} larger than registry max_size ${reg.max_size.w}x${reg.max_size.h}`);
    }
  }

  // Pairwise overlap check — only when basic shape is OK
  if (errors.length === 0) {
    for (let i = 0; i < data.widgets.length; i += 1) {
      const a = data.widgets[i];
      for (let j = i + 1; j < data.widgets.length; j += 1) {
        const b = data.widgets[j];
        const overlap = a.x < (b.x + b.w) && b.x < (a.x + a.w) && a.y < (b.y + b.h) && b.y < (a.y + a.h);
        if (overlap) {
          errors.push(`widgets "${a.widget_id}" and "${b.widget_id}" overlap on grid`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, data };
}

module.exports = { validateComposerOutput, parseJsonSafe };
