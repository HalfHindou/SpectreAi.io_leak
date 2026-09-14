/**
 * Dev mirror for the RZ Project Dossier ("what is this project").
 *
 * The real implementation lives in the research app's serverless layer
 * (apps/research/api/_lib/handlers/project-dossier.js, ESM). Rather than
 * duplicating the CoinGecko gather + prompt + cache logic in CJS, this router
 * dynamic-imports the serverless handler and delegates the (req, res) pair —
 * Express req.query / res.status().json() are a superset of what the handler
 * uses. KV falls back to in-memory locally, the LLM gateway reads the same root
 * .env keys, so dev behaves like prod. Mirrors routes/sentiment-read.js.
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
      '../../../apps/research/api/_lib/handlers/project-dossier.js'
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
    console.error('[project-dossier dev] failed to load/run handler:', err.message);
    return res.status(200).json({ dossier: null, error: 'unavailable' });
  }
});

module.exports = router;
