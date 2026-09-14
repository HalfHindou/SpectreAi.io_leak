/**
 * Dev mirror for the News Brief ("why is this happening" under an article).
 *
 * Same delegation pattern as routes/sentiment-read.js: the real implementation
 * lives in the research app's serverless layer (ESM — the research package is
 * "type": "module"), so rather than keeping a second CJS copy of the resolve +
 * prompt + cache logic in sync, this router dynamic-imports the handler and
 * hands it the (req, res) pair. Express req.query / res.status().json() are a
 * superset of what the handler touches. KV falls back to in-memory locally and
 * the LLM gateway reads the same root .env keys, so dev behaves like prod.
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
      '../../../apps/research/api/_lib/handlers/news-brief.js'
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
    console.error('[news-brief dev] failed to load/run handler:', err.message);
    return res.status(200).json({ brief: null, error: 'unavailable' });
  }
});

module.exports = router;
