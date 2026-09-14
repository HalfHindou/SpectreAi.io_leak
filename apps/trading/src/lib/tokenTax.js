/**
 * QuickIntel token-tax cache - EXTRACTED verbatim from RightPanel.jsx
 * (2026-07-11) so the honeypot/token-tax guard is callable from the
 * Spectre Agent (digest assembly + trade-confirm re-check) and RightPanel
 * alike. Tax config is effectively immutable per contract (honeypot /
 * buy-sell tax / ownership flags), so re-fetching it on every token
 * revisit was pure waste. Module Map + localStorage write-through
 * (24h TTL) + inflight dedup, keyed addr:networkId.
 *
 * Coverage is effectively EVM-only (QuickIntel upstream) - Solana tokens
 * usually resolve to null/empty; callers must treat "no data" as
 * "no coverage", never as "safe".
 */
const TOKEN_TAX_TTL = 24 * 60 * 60 * 1000
const TOKEN_TAX_LS_PREFIX = 'spectre-token-tax-v1:'
const _tokenTaxCache = new Map()      // key -> { data, ts }
const _tokenTaxInflight = new Map()   // key -> Promise

export async function fetchTokenTaxCached(address, networkId) {
  const key = `${String(address).toLowerCase()}:${networkId}`
  const mem = _tokenTaxCache.get(key)
  if (mem && Date.now() - mem.ts < TOKEN_TAX_TTL) return mem.data
  try {
    const raw = localStorage.getItem(TOKEN_TAX_LS_PREFIX + key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Date.now() - (parsed.ts || 0) < TOKEN_TAX_TTL) {
        _tokenTaxCache.set(key, parsed)
        return parsed.data
      }
    }
  } catch { /* parse/quota - treat as miss */ }
  const existing = _tokenTaxInflight.get(key)
  if (existing) return existing
  const promise = (async () => {
    try {
      const r = await fetch(`/api/token-tax?address=${encodeURIComponent(address)}&networkId=${networkId}`)
      if (!r.ok) throw new Error('status ' + r.status)
      const data = await r.json()
      if (data) {
        const entry = { data, ts: Date.now() }
        _tokenTaxCache.set(key, entry)
        try { localStorage.setItem(TOKEN_TAX_LS_PREFIX + key, JSON.stringify(entry)) } catch { /* quota */ }
      }
      return data
    } finally {
      _tokenTaxInflight.delete(key)
    }
  })()
  _tokenTaxInflight.set(key, promise)
  return promise
}
