/**
 * YOU V2 — Server-side widget registry loader.
 *
 * The canonical registry lives at apps/research/src/registry/widgets.js
 * (ES module, also consumed by the browser). The Express server is CommonJS
 * so we use dynamic import() to load it once on first call and cache.
 *
 * Used by:
 *   - packages/server/routes/youEvents.js  (validate widget_id on incoming events)
 *   - packages/server/routes/youCompose.js (Step 5: scope composer choices to tier)
 */

const path = require('path');
const { pathToFileURL } = require('url');

const REGISTRY_PATH = path.resolve(
  __dirname, '..', '..', '..', 'apps', 'research', 'src', 'registry', 'widgets.js'
);

let cache = null;
let loadingPromise = null;

async function loadRegistry() {
  if (cache) return cache;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const mod = await import(pathToFileURL(REGISTRY_PATH).href);
    const widgets = mod.WIDGETS || mod.default;
    if (!Array.isArray(widgets)) {
      throw new Error('widgetRegistry: WIDGETS export not found or not an array');
    }
    cache = widgets;
    return cache;
  })();
  return loadingPromise;
}

async function getRegistry() {
  return loadRegistry();
}

async function getWidgetIds() {
  const widgets = await loadRegistry();
  return new Set(widgets.map((w) => w.id));
}

/**
 * Returns active (non-planned) widgets at or below the user's tier.
 * Used by the composer in Step 5.
 */
async function getRegistryForTier(tier) {
  const widgets = await loadRegistry();
  if (typeof tier !== 'number') return [];
  return widgets.filter((w) => w.tier <= tier && (w.status || 'active') === 'active');
}

module.exports = { getRegistry, getWidgetIds, getRegistryForTier };
