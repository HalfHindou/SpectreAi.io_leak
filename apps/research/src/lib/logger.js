// apps/research/src/lib/logger.js
// Lightweight logger - logs in dev, silent in prod. AbortError is always silent.

const isDev = import.meta.env.DEV;

export function logError(scope, err, context) {
  if (err?.name === 'AbortError') return;
  if (isDev) {
    // eslint-disable-next-line no-console
    console.error(`[${scope}]`, err?.message || err, context || '');
  }
}

export function logWarn(scope, msg, context) {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.warn(`[${scope}]`, msg, context || '');
  }
}
