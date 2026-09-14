/**
 * Vercel Serverless — Graceful empty stubs for endpoints whose Haitam Cloud
 * Run upstreams have been deprovisioned and have no Spectre replacement yet.
 *
 *   /api/token/market-scenario   — bull/bear AI scenario (was /market-scenario)
 *   /api/token/fundamentals      — AI letter grades (was /token-fundamuntals)
 *
 * Both consumers (useMarketScenario, useTokenFundamentals) handle a graceful
 * empty / minimal envelope, so we keep the wire 200-OK to avoid retry storms.
 *
 * TODO: replace with Groq-backed local generation once the prompt scaffolding
 * lands.
 */

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181']

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const fn = (req.query.fn || '').toLowerCase()

  if (fn === 'market-scenario') {
    const cgId = (req.query.cg_id || '').trim()
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json({ success: false, token: cgId, market_scenario: null, _note: 'AI scenario not configured' })
  }

  if (fn === 'fundamentals') {
    res.setHeader('Cache-Control', 'no-store')
    let body = null
    try {
      body = req.body && typeof req.body === 'object' ? req.body : null
      if (!body && typeof req.body === 'string') body = JSON.parse(req.body)
    } catch { body = null }
    const td = body?.token_details || {}
    const hasMcap = Number(td.market_cap || 0) > 0
    const hasVol = Number(td.volume_24h || 0) > 0
    return res.status(200).json({
      overallGrade: hasMcap && hasVol ? 'B' : 'C',
      overallScore: hasMcap && hasVol ? 70 : 55,
      summary: 'Detailed AI fundamentals grading is not configured on this deploy.',
      fundamentals: [
        { key: 'liquidity', label: 'Liquidity', letter: hasVol ? 'B' : 'C', score: hasVol ? 70 : 50, note: '' },
        { key: 'market_depth', label: 'Market depth', letter: hasMcap ? 'B' : 'C', score: hasMcap ? 70 : 50, note: '' },
      ],
      positiveTags: [],
      riskTags: [],
      _note: 'AI grader not configured',
    })
  }

  return res.status(400).json({ error: `Unknown token-stubs fn: ${fn}` })
}
