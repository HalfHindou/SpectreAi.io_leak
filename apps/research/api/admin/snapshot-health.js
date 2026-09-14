/**
 * GET /api/admin/snapshot-health - Operational verification endpoint.
 *
 * Returns:
 *   - KV connectivity (write probe + read probe)
 *   - Snapshot freshness for cg:snap:_all + a sample of cg:snap:<id> keys
 *   - Sample codex:snap:<addr:net> entries
 *   - Last successful cron timestamp (from cg:snap:_all._snappedAt)
 *
 * Auth: x-admin-key header matching ADMIN_KEY env. Returns 503 if ADMIN_KEY
 * not configured.
 *
 * Use this to verify the Phase K snapshot pipeline is alive without
 * needing to inspect Vercel function logs or codex.io dashboard.
 */

import { timingSafeEqual } from 'node:crypto'
import { getJsonWithTTL, setJsonWithTTL } from '../_lib/kv.js'

function _safeCompare(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end()

  const adminKey = process.env.ADMIN_KEY || process.env.SPECTRE_ADMIN_KEY
  if (!adminKey) {
    return res.status(503).json({ error: 'admin-key-not-configured' })
  }
  const provided = req.headers?.['x-admin-key'] || req.query?.key
  if (!_safeCompare(String(provided || ''), String(adminKey))) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const out = {
    kvWrite: 'unknown',
    kvRead: 'unknown',
    snapshotAll: null,
    snapshotSamples: {},
    codexSnapshotSamples: {},
    ts: new Date().toISOString(),
  }

  // 1) write+read probe
  try {
    const probeKey = 'admin:snapshot-health:probe'
    const probeValue = { ts: Date.now(), random: Math.random() }
    await setJsonWithTTL(probeKey, probeValue, 60)
    out.kvWrite = 'ok'
    const readback = await getJsonWithTTL(probeKey)
    out.kvRead = readback && readback.random === probeValue.random ? 'ok' : 'mismatch'
  } catch (e) {
    out.kvWrite = `error: ${e?.message || e}`
  }

  // 2) cg:snap:_all freshness
  try {
    const all = await getJsonWithTTL('cg:snap:_all')
    if (Array.isArray(all) && all.length > 0) {
      const sample = all[0]
      out.snapshotAll = {
        tokenCount: all.length,
        firstToken: { id: sample?.id, symbol: sample?.symbol, price: sample?.price, marketCap: sample?.marketCap },
        snappedAtMs: sample?._snappedAt || null,
        ageSeconds: sample?._snappedAt ? Math.round((Date.now() - sample._snappedAt) / 1000) : null,
      }
    } else {
      out.snapshotAll = { tokenCount: 0, note: 'cg:snap:_all missing or empty - cron may not have run yet' }
    }
  } catch (e) {
    out.snapshotAll = `error: ${e?.message || e}`
  }

  // 3) sample individual cg:snap keys
  for (const id of ['bitcoin', 'ethereum', 'solana', 'pepe', 'dogecoin']) {
    try {
      const s = await getJsonWithTTL(`cg:snap:${id}`)
      out.snapshotSamples[id] = s
        ? { price: s.price, marketCap: s.marketCap, change24: s.change24, ageSec: s._snappedAt ? Math.round((Date.now() - s._snappedAt) / 1000) : null }
        : null
    } catch (e) { out.snapshotSamples[id] = `error: ${e?.message || e}` }
  }

  // 4) sample codex:snap:<addr:net> keys (Codex snapshot cron, smaller seed list)
  const codexProbes = [
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2:1', // WETH
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599:1', // WBTC
    'So11111111111111111111111111111111111111112:1399811149', // SOL
  ]
  for (const key of codexProbes) {
    try {
      const s = await getJsonWithTTL(`codex:snap:${key}`)
      out.codexSnapshotSamples[key] = s
        ? { price: s.price, marketCap: s.marketCap, ageSec: s._snappedAt ? Math.round((Date.now() - s._snappedAt) / 1000) : null }
        : null
    } catch (e) { out.codexSnapshotSamples[key] = `error: ${e?.message || e}` }
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json(out)
}
