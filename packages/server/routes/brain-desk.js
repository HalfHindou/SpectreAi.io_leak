/**
 * Dev mirror for the Brain Desk (lens-agent market intel).
 *
 * The real implementation is the research app's ESM serverless handler
 * (apps/research/api/_lib/handlers/brain-desk.js). This router dynamic-imports
 * it and delegates the (req, res) pair — same pattern as sentiment-read. KV
 * falls back to in-memory locally; the LLM gateway reads the same root .env
 * keys, so dev behaves like prod. Served in prod via /api/intel-api?fn=brain-desk.
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
      '../../../apps/research/api/_lib/handlers/brain-desk.js'
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
    console.error('[brain-desk dev] failed to load/run handler:', err.message);
    return res.status(200).json({ regime: null, brief: [], intel: [], error: 'unavailable' });
  }
});

module.exports = router;
