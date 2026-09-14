/**
 * KOL + token receipts from the Proof ledger (momentum_origin via
 * /api/xdash/track-record). The tape's calls carry per-call `kols[]`
 * attribution (the spotters at entry), so this is REAL per-author history —
 * not "who mentions it now".
 *
 *   byKol:   screen_name(lower) → { calls, hits, bestPeak }   hit = peak ≥ +50%
 *   byToken: cg_id → { roiPct, peakPct, entryMcap }
 *
 * Feeds the universe: proven voices pulse, planets with receipts say so in
 * the hover card. Every number traces to a graded ledger row — never vibes.
 */
import { useMemo } from 'react'
import { useXDashTrackRecord } from '@/hooks/useXDashTrackRecord'

const HIT_PEAK_PCT = 50

export default function useKolReceipts(enabled = true) {
  const { ledger, loading } = useXDashTrackRecord(
    { limit: 400 },
    { enabled },
  )

  return useMemo(() => {
    const byKol = new Map()
    const byToken = new Map()
    const calls = Array.isArray(ledger?.calls) ? ledger.calls : []
    for (const call of calls) {
      const peak = Number(call?.peak_roi_pct)
      const roi = Number(call?.roi_pct)
      if (call?.cg_id) {
        byToken.set(String(call.cg_id).toLowerCase(), {
          roiPct: Number.isFinite(roi) ? roi : null,
          peakPct: Number.isFinite(peak) ? peak : null,
          entryMcap: Number(call?.entry_market_cap) || null,
        })
      }
      if (!Array.isArray(call?.kols)) continue
      for (const k of call.kols) {
        const key = (k?.screen_name || '').toLowerCase()
        if (!key) continue
        let rec = byKol.get(key)
        if (!rec) { rec = { calls: 0, hits: 0, bestPeak: null }; byKol.set(key, rec) }
        rec.calls += 1
        if (Number.isFinite(peak)) {
          if (peak >= HIT_PEAK_PCT) rec.hits += 1
          if (rec.bestPeak == null || peak > rec.bestPeak) rec.bestPeak = peak
        }
      }
    }
    return { byKol, byToken, loading, ready: calls.length > 0 }
  }, [ledger, loading])
}
