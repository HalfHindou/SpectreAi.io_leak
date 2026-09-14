/**
 * Vercel Serverless — intel-trigger handler stub.
 *
 * The real implementation lives on another developer's WIP branch and was
 * referenced as an `import` in `apps/research/api/intel-api.js` before the
 * file itself was committed. The missing module crashed the entire intel-api
 * dispatcher at lambda load time with `ERR_MODULE_NOT_FOUND`, taking down
 * every route routed through intel-api (calendar/*, brief/*, intelligence/*,
 * dossier-proxy, insight*).
 *
 * This stub lets the dispatcher load. It returns 501 if invoked, so any
 * caller of /api/intel-trigger sees a clear "not implemented" rather than a
 * full lambda crash. Replace this file when the real handler ships.
 */

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181']

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  return res.status(501).json({ error: 'intel-trigger not implemented in this deploy' })
}
