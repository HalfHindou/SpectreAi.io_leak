/**
 * Dev mirror for the RZ AI Sentiment Read.
 *
 * The real implementation lives in the research app's serverless layer
 * (apps/research/api/_lib/handlers/sentiment-read.js, ESM — the research
 * package is "type": "module"). Rather than duplicating the gather + prompt +
 * cache logic in CJS, this router dynamic-imports the serverless handler and
 * delegates the (req, res) pair — Express req.query / res.status().json() are
 * a superset of what the handler uses. KV falls back to in-memory locally, the
 * LLM gateway reads the same root .env keys, so dev behaves like prod.
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
      '../../../apps/research/api/_lib/handlers/sentiment-read.js'
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
    console.error('[sentiment-read dev] failed to load/run handler:', err.message);
    return res.status(200).json({ read: null, error: 'unavailable' });
  }
});

module.exports = router;
