/**
 * Dev mirror for the RZ crowd-stance classify (LLM bull/bear split from the
 * live X tape, for tokens mindshare_v2 doesn't cover).
 *
 * The real implementation lives in the research app's serverless layer
 * (apps/research/api/_lib/handlers/crowd-stance.js, ESM). Same delegate
 * pattern as routes/sentiment-read.js: dynamic-import the handler and hand it
 * the (req, res) pair — KV falls back to in-memory locally, the LLM gateway
 * reads the same root .env keys, so dev behaves like prod.
 */
const express = require('express');
const path = require('path');
const { pathToFileURL } = require('url');

const router = express.Router();

let handlerPromise = null;
function loadHandler() {
  if (!handlerPromise) {
    const p = path.resolve(
      __dirname,
      '../../../apps/research/api/_lib/handlers/crowd-stance.js'
    );
    handlerPromise = import(pathToFileURL(p).href).then((m) => m.default);
    handlerPromise.catch(() => { handlerPromise = null; }); // retry next request
  }
  return handlerPromise;
}

router.get('/', async (req, res) => {
  try {
    const handler = await loadHandler();
    return handler(req, res);
  } catch (err) {
    console.error('[crowd-stance dev] failed to load/run handler:', err.message);
    return res.status(200).json({ data: null, error: 'unavailable' });
  }
});

module.exports = router;
