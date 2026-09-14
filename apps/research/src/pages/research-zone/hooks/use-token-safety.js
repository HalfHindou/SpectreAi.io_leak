/**
 * useTokenSafety — best-effort buy/sell tax + honeypot for an on-chain token,
 * read from the Spectre Dossier (`d.safety`, the same field dossier-panel uses).
 *
 * Feeds the Technicals micro-structure card so the thesis knows a 5% transfer
 * tax makes scalps negative-EV and that a honeypot invalidates every bull
 * signal. PURELY ADDITIVE + best-effort: no address, an unknown chain, a cold
 * dossier or a service blip all return null and the tax line simply doesn't
 * render — never a regression, never a blocking dependency.
 *
 * Uses `stream: true` so the lookup returns instantly (enrichment runs
 * server-side); safety populates on the first enriched read and sticks in the
 * dossierApi 15s cache + this hook's session cache.
 */
import { useState, useEffect } from 'react'
import { dossier } from '@/services/dossierApi'

// networkId → Spectre Dossier chain slug (matches dossier-page detectChainFromCa
// + swapService NETWORK_TO_CHAIN — short slugs, NOT the CG platform names).
const NETWORK_TO_DOSSIER_CHAIN = {
  1: 'eth',
  56: 'bsc',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  1399811149: 'sol',
}

const _cache = new Map() // key -> { data, ts }
const TTL = 5 * 60_000

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

export default function useTokenSafety({ address, networkId } = {}) {
  const [safety, setSafety] = useState(null)

  useEffect(() => {
    const ca = address
    const chain = NETWORK_TO_DOSSIER_CHAIN[Number(networkId)]
    if (!ca || !chain) { setSafety(null); return undefined }

    const key = `${chain}:${ca}`
    const hit = _cache.get(key)
    if (hit && Date.now() - hit.ts < TTL) { setSafety(hit.data); return undefined }

    let cancelled = false
    dossier.lookup(chain, ca, { stream: true })
      .then((d) => {
        if (cancelled) return
        const s = d?.safety || null
        const out = s ? {
          buyTax: num(s.buyTax ?? s.buy_tax),
          sellTax: num(s.sellTax ?? s.sell_tax),
          isHoneypot: !!(s.isHoneypot ?? s.is_honeypot),
        } : null
        // Only cache a positive read; a null (cold enrichment) can revalidate next view.
        if (out) _cache.set(key, { data: out, ts: Date.now() })
        setSafety(out)
      })
      .catch(() => { if (!cancelled) setSafety(null) })

    return () => { cancelled = true }
  }, [address, networkId])

  return safety
}
