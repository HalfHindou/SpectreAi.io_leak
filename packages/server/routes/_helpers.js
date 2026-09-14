/**
 * Shared helpers for route modules.
 * Provides cache infrastructure, API clients, and common utilities
 * so extracted route files don't duplicate this infrastructure.
 *
 * Usage in route files:
 *   const { cache, getCached, setCached, evictIfFull, cgFetch, executeCodexQuery } = require('../routes/_helpers');
 *   // ...but actually we pass these via a setup function to avoid circular deps
 */

// This module is populated by index.js at startup via `setHelpers()`
// Route modules call `getHelpers()` to access shared infrastructure

let _helpers = null;

function setHelpers(h) {
  _helpers = h;
}

function getHelpers() {
  if (!_helpers) throw new Error('Server helpers not initialized — call setHelpers() in index.js before mounting routes');
  return _helpers;
}

module.exports = { setHelpers, getHelpers };
