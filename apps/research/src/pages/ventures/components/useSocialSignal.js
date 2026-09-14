/**
 * useSocialSignal — crypto-social intelligence for the Social Signal view.
 * Pulls X-Dash-derived mindshare (per-token social attention + momentum), the
 * most active KOLs, and rising narratives from the Spectre social graph. Joined
 * client-side with the VC holdings graph to map "smart money vs social".
 */
import { useState, useEffect } from 'react'

const _cache = { data: null, ts: 0 }
const TTL = 4 * 60 * 1000

const U = (s) => String(s || '').toUpperCase()

async function getJson(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export default function useSocialSignal() {
  const [state, setState] = useState(() => (_cache.data
    ? { ..._cache.data, loading: false }
    : { mindshareBySym: {}, kols: [], narratives: [], loading: true }))

  useEffect(() => {
    if (_cache.data && Date.now() - _cache.ts < TTL) { setState({ ..._cache.data, loading: false }); return undefined }
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))

    Promise.all([
      getJson('/data-api/v1/social/mindshare?limit=200'),
      getJson('/data-api/v1/social/kols/active?limit=8'),
      getJson('/data-api/v1/narratives/rotation/rising?limit=8'),
    ]).then(([mind, kol, narr]) => {
      if (cancelled) return
      const arrOf = (resp, ...keys) => {
        const d = resp?.data ?? resp
        if (Array.isArray(d)) return d
        for (const k of [...keys, 'items', 'mindshare', 'kols', 'rising', 'results']) if (Array.isArray(d?.[k])) return d[k]
        return []
      }
      const mindArr = arrOf(mind, 'mindshare')
      const mindshareBySym = {}
      for (const m of mindArr || []) {
        const sym = U(m.asset || m.symbol)
        if (!sym) continue
        mindshareBySym[sym] = {
          mindshare: parseFloat(m.mindshare_pct ?? m.mindshare ?? 0) || 0,
          avg7d: parseFloat(m.mindshare_7d_avg ?? 0) || 0,
          mentions: m.mentions_24h ?? null,
          momentum: m.momentum || null,
          rank: m.rank ?? null,
        }
      }

      const kolArr = arrOf(kol, 'kols')
      const kols = (kolArr || []).slice(0, 8).map((k) => ({
        handle: k.kol || k.handle || k.author,
        name: k.display_name || k.name || k.kol,
        avatar: k.avatar || null,
        followers: k.followers ?? null,
        influence: k.influence_score ?? null,
        mentions: k.mention_count ?? null,
        engagement: k.engagement ?? null,
        assets: k.asset_count ?? null,
      })).filter((k) => k.handle)

      const narrArr = arrOf(narr, 'rising', 'narratives')
      const narratives = (narrArr || []).slice(0, 8).map((n) => ({
        name: n.display_name || n.narrative,
        share: parseFloat(n.mention_share_pct ?? 0) || 0,
        momentum: n.momentum || null,
        assetCount: n.asset_count ?? null,
        topAssets: (n.top_assets || []).slice(0, 6),
      })).filter((n) => n.name)

      const data = { mindshareBySym, kols, narratives }
      _cache.data = data
      _cache.ts = Date.now()
      setState({ ...data, loading: false })
    }).catch(() => { if (!cancelled) setState((s) => ({ ...s, loading: false })) })

    return () => { cancelled = true }
  }, [])

  return state
}
