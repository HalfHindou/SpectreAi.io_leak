/**
 * Spectre Private Markets — VC funding intelligence routes (Express dev server)
 *
 *   GET /api/private/llama-raises    — DeFiLlama /raises
 *   GET /api/private/sec-filings     — SEC EDGAR Form D filings
 *   GET /api/private/funding-news    — TechCrunch + Bloomberg + Crunchbase RSS
 *   GET /api/private/companies/:slug — Crunchbase Basic lookup (optional)
 *   GET /api/private/unicorns        — Curated unicorn list
 *   GET /api/private/deals           — Merged feed (Curated + DeFiLlama + RSS + SEC)
 *   GET /api/private/valuation-history/:company — Historical rounds + valuations
 *   GET /api/private/sector-heatmap  — Capital velocity by sector
 *
 * ALL logic lives in packages/server/lib/private-markets-core.js so dev (this
 * router) and prod (apps/research/api/_lib/handlers/extended-proxy.js) share a
 * single source of truth — the curated seed never drifts between environments.
 * This file is a thin transport wrapper: it maps Express req/res onto the
 * core's { status, body } responses.
 */
const express = require('express');
const router = express.Router();
const core = require('../lib/private-markets-core');

function send(res, result) {
  res.status(result.status).json(result.body);
}

router.get('/llama-raises', async (req, res) => send(res, await core.getLlamaRaises()));
router.get('/sec-filings', async (req, res) => send(res, await core.getSecFilingsResponse()));
router.get('/funding-news', async (req, res) => send(res, await core.getFundingNewsResponse()));
router.get('/deals', async (req, res) => send(res, await core.getDeals(req.query)));
router.get('/stats', async (_req, res) => send(res, await core.getStats()));
router.get('/valuation-history/:company', async (req, res) => send(res, await core.getValuationHistory(req.params.company)));
router.get('/companies/:slug', async (req, res) => send(res, await core.getCompany(req.params.slug)));
router.get('/unicorns', async (req, res) => send(res, await core.getUnicorns()));
router.get('/preipo', async (_req, res) => send(res, await core.getPreIPO()));
router.get('/sector-heatmap', async (req, res) => send(res, await core.getSectorHeatmap()));

module.exports = router;
