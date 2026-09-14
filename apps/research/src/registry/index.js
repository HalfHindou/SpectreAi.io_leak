/**
 * YOU V2 — Capability Registry: Public API
 *
 * JSDoc typedefs (no .ts file — repo standard is JS only in app code) plus the
 * five helper functions every consumer uses: getWidget, getByCategory,
 * getByTier, search, validate.
 *
 * Consumers:
 *   - apps/research/src/pages/you/*           dashboard rendering
 *   - apps/research/src/components/...         template picker
 *   - packages/server/services/widgetRegistry  composer prompt scoping
 *
 * Future migration: when the trading app needs the same registry, promote
 * widgets.js + this file to packages/registry/.
 */

import { WIDGETS } from './widgets.js';
import { TEMPLATES } from './templates.js';

/**
 * @typedef {'onchain' | 'perps' | 'social' | 'narrative' | 'rwa' | 'derivatives' | 'whale' | 'dex' | 'cex' | 'macro' | 'sentiment' | 'agent' | 'brain' | 'portfolio'} WidgetCategory
 */

/**
 * @typedef {Object} WidgetDataSource
 * @property {'brain' | 'consciousness' | 'spectre_api' | 'external'} type
 * @property {string} endpoint
 * @property {number} refresh_interval_ms
 */

/**
 * @typedef {Object} WidgetSize
 * @property {number} w  Grid columns (1–12).
 * @property {number} h  Grid rows.
 */

/**
 * @typedef {Object} WidgetEntry
 * @property {string} id                          Kebab-case, stable, never reused.
 * @property {string} name                        Display name.
 * @property {string} description                 One-sentence founder voice.
 * @property {WidgetCategory[]} category          One or more from the canonical list.
 * @property {WidgetDataSource} data_source
 * @property {0 | 500 | 1000 | 7000} tier         0 = free, others = $SPECTRE token gate.
 * @property {Record<string, string>} required_props
 * @property {Record<string, any>} default_props
 * @property {WidgetSize} default_size            Initial size in 12-col grid units.
 * @property {WidgetSize} min_size
 * @property {WidgetSize} [max_size]
 * @property {string[]} companions                Suggested pairings by widget id.
 * @property {string[]} use_cases                 Plain English, for composer reasoning.
 * @property {string[]} tags                      Free-form, lowercase, for search.
 * @property {'active' | 'planned'} [status]      Defaults to 'active'. 'planned' = DRAFT, not buildable today.
 */

const CANONICAL_CATEGORIES = new Set([
  'onchain', 'perps', 'social', 'narrative', 'rwa', 'derivatives',
  'whale', 'dex', 'cex', 'macro', 'sentiment', 'agent', 'brain', 'portfolio',
]);

const VALID_DATA_SOURCE_TYPES = new Set(['brain', 'consciousness', 'spectre_api', 'external']);
const VALID_TIERS = new Set([0, 500, 1000, 7000]);
const VALID_STATUS = new Set(['active', 'planned']);

/**
 * Look up a single widget by id.
 * @param {string} id
 * @returns {WidgetEntry | null}
 */
export function getWidget(id) {
  if (typeof id !== 'string' || !id) return null;
  return WIDGETS.find((w) => w.id === id) ?? null;
}

/**
 * All widgets that include the given category.
 * @param {WidgetCategory} category
 * @returns {WidgetEntry[]}
 */
export function getByCategory(category) {
  if (!CANONICAL_CATEGORIES.has(category)) return [];
  return WIDGETS.filter((w) => w.category.includes(category));
}

/**
 * All widgets at or below the user's tier.
 * Excludes 'planned' entries — they are not buildable.
 * @param {number} maxTier
 * @returns {WidgetEntry[]}
 */
export function getByTier(maxTier) {
  if (typeof maxTier !== 'number' || maxTier < 0) return [];
  return WIDGETS.filter((w) => w.tier <= maxTier && (w.status ?? 'active') === 'active');
}

/**
 * Case-insensitive search over name, description, and tags.
 * @param {string} query
 * @returns {WidgetEntry[]}
 */
export function search(query) {
  if (typeof query !== 'string' || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  return WIDGETS.filter((w) => {
    if (w.name.toLowerCase().includes(q)) return true;
    if (w.description.toLowerCase().includes(q)) return true;
    if (w.tags.some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
}

/**
 * Validate an entire catalog against the schema. Returns { valid, errors }.
 * Pass nothing to validate the bundled WIDGETS array.
 * @param {WidgetEntry[]} [catalog]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(catalog) {
  const list = Array.isArray(catalog) ? catalog : WIDGETS;
  const errors = [];
  const seenIds = new Set();

  for (const [i, w] of list.entries()) {
    const where = `widgets[${i}] (${w?.id ?? 'no-id'})`;

    if (!w || typeof w !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (typeof w.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(w.id)) {
      errors.push(`${where}: id must be kebab-case starting with a letter`);
    }
    if (seenIds.has(w.id)) errors.push(`${where}: duplicate id`);
    seenIds.add(w.id);

    if (typeof w.name !== 'string' || !w.name) errors.push(`${where}: name required`);
    if (typeof w.description !== 'string' || !w.description) errors.push(`${where}: description required`);

    if (!Array.isArray(w.category) || w.category.length === 0) {
      errors.push(`${where}: category must be a non-empty array`);
    } else {
      for (const c of w.category) {
        if (!CANONICAL_CATEGORIES.has(c)) errors.push(`${where}: unknown category "${c}"`);
      }
    }

    if (!w.data_source || typeof w.data_source !== 'object') {
      errors.push(`${where}: data_source required`);
    } else {
      if (!VALID_DATA_SOURCE_TYPES.has(w.data_source.type)) {
        errors.push(`${where}: data_source.type invalid`);
      }
      if (typeof w.data_source.endpoint !== 'string' || !w.data_source.endpoint) {
        errors.push(`${where}: data_source.endpoint required`);
      }
      if (typeof w.data_source.refresh_interval_ms !== 'number' || w.data_source.refresh_interval_ms < 1000) {
        errors.push(`${where}: data_source.refresh_interval_ms must be a number >= 1000`);
      }
    }

    if (!VALID_TIERS.has(w.tier)) errors.push(`${where}: tier must be 0, 500, 1000, or 7000`);

    if (!w.required_props || typeof w.required_props !== 'object') errors.push(`${where}: required_props must be an object`);
    if (!w.default_props || typeof w.default_props !== 'object') errors.push(`${where}: default_props must be an object`);

    for (const sizeKey of ['default_size', 'min_size']) {
      const sz = w[sizeKey];
      if (!sz || typeof sz.w !== 'number' || typeof sz.h !== 'number' || sz.w < 1 || sz.h < 1 || sz.w > 12) {
        errors.push(`${where}: ${sizeKey} invalid (need w 1..12, h >= 1)`);
      }
    }
    if (w.max_size) {
      if (typeof w.max_size.w !== 'number' || typeof w.max_size.h !== 'number' || w.max_size.w > 12) {
        errors.push(`${where}: max_size invalid`);
      } else if (w.max_size.w < (w.min_size?.w ?? 0) || w.max_size.h < (w.min_size?.h ?? 0)) {
        errors.push(`${where}: max_size smaller than min_size`);
      }
    }

    if (!Array.isArray(w.companions)) errors.push(`${where}: companions must be an array`);
    if (!Array.isArray(w.use_cases) || w.use_cases.length === 0) errors.push(`${where}: use_cases must be a non-empty array`);
    if (!Array.isArray(w.tags) || w.tags.length === 0) errors.push(`${where}: tags must be a non-empty array`);

    if (w.status !== undefined && !VALID_STATUS.has(w.status)) errors.push(`${where}: status must be 'active' or 'planned'`);
  }

  // Companion ids must reference real widgets (active OR planned both ok).
  const idsInCatalog = new Set(list.map((w) => w?.id).filter(Boolean));
  for (const [i, w] of list.entries()) {
    if (!Array.isArray(w?.companions)) continue;
    for (const cid of w.companions) {
      if (!idsInCatalog.has(cid)) {
        errors.push(`widgets[${i}] (${w.id}): unknown companion id "${cid}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a template's layout against the widget registry and grid rules.
 *  - Every widget_id must exist in WIDGETS.
 *  - No two widgets may overlap (rectangle intersection check).
 *  - Every widget must fit within the 12-column grid (x + w <= 12).
 *  - Every widget must respect its registry min_size and max_size.
 *
 * Returns { valid: boolean, errors: string[] }.
 *
 * @param {import('./templates.js').TemplateEntry} template
 */
export function validateTemplate(template) {
  const errors = [];
  if (!template || typeof template !== 'object') {
    return { valid: false, errors: ['template must be an object'] };
  }
  if (typeof template.id !== 'string' || !template.id) errors.push('template.id required');
  if (typeof template.name !== 'string' || !template.name) errors.push('template.name required');
  if (!Array.isArray(template.layout) || template.layout.length === 0) {
    errors.push('template.layout must be a non-empty array');
    return { valid: errors.length === 0, errors };
  }

  const byId = new Map(WIDGETS.map((w) => [w.id, w]));
  const seenIds = new Set();

  for (const [i, item] of template.layout.entries()) {
    const where = `${template.id}.layout[${i}]`;
    if (typeof item.widget_id !== 'string') {
      errors.push(`${where}: widget_id required`);
      continue;
    }
    const reg = byId.get(item.widget_id);
    if (!reg) {
      errors.push(`${where}: widget_id "${item.widget_id}" not in registry`);
      continue;
    }
    if (seenIds.has(item.widget_id)) {
      errors.push(`${where}: duplicate widget_id "${item.widget_id}"`);
    }
    seenIds.add(item.widget_id);

    if (typeof item.x !== 'number' || typeof item.y !== 'number' ||
        typeof item.w !== 'number' || typeof item.h !== 'number') {
      errors.push(`${where}: x/y/w/h must all be numbers`);
      continue;
    }
    if (item.x < 0 || item.y < 0) errors.push(`${where}: x and y must be >= 0`);
    if (item.x + item.w > 12) errors.push(`${where}: x+w (${item.x + item.w}) exceeds 12-column grid`);
    if (item.w < reg.min_size.w || item.h < reg.min_size.h) {
      errors.push(`${where}: ${item.w}x${item.h} smaller than registry min_size ${reg.min_size.w}x${reg.min_size.h}`);
    }
    if (reg.max_size && (item.w > reg.max_size.w || item.h > reg.max_size.h)) {
      errors.push(`${where}: ${item.w}x${item.h} larger than registry max_size ${reg.max_size.w}x${reg.max_size.h}`);
    }
  }

  // Pairwise overlap check
  for (let i = 0; i < template.layout.length; i += 1) {
    const a = template.layout[i];
    for (let j = i + 1; j < template.layout.length; j += 1) {
      const b = template.layout[j];
      const ax2 = a.x + a.w;
      const ay2 = a.y + a.h;
      const bx2 = b.x + b.w;
      const by2 = b.y + b.h;
      const overlap = a.x < bx2 && b.x < ax2 && a.y < by2 && b.y < ay2;
      if (overlap) {
        errors.push(`${template.id}: widgets "${a.widget_id}" and "${b.widget_id}" overlap on grid`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {string} id
 * @returns {import('./templates.js').TemplateEntry | null}
 */
export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** @returns {import('./templates.js').TemplateEntry[]} */
export function getTemplates() {
  return TEMPLATES.slice();
}

export { WIDGETS, TEMPLATES };
export default WIDGETS;
