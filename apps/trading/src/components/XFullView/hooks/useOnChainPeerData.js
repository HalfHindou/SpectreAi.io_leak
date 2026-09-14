import { useMemo } from 'react'
import { useSharedTokenDetails } from '../../../contexts/TokenDetailsContext'

/**
 * Reads on-chain stats for the current token from the existing
 * TokenDetailsContext (no extra fetch — XFullView is rendered inside the
 * same provider tree as the rest of the token page).
 *
 * Normalizes Codex's field names into a stable shape that useAlphaSignals
 * can consume:
 *
 *   { price, marketCap, volume24, priceChange24h, volumeChange24h, liquidity }
 *
 * Returns null if the context hasn't loaded yet.
 */
export default function useOnChainPeerData() {
  const ctx = useSharedTokenDetails()
  const tokenData = ctx?.tokenData

  return useMemo(() => {
    if (!tokenData) return null
    const num = (v) => {
      const n = typeof v === 'number' ? v : parseFloat(v)
      return Number.isFinite(n) ? n : 0
    }

    // Codex returns change24 as a fraction (0.0234 = 2.34%) — convert to percentage.
    const change24 = num(tokenData.change24 ?? tokenData.change24h ?? tokenData.change)
    const priceChange24h = Math.abs(change24) <= 1 ? change24 * 100 : change24

    return {
      address: tokenData.address || null,
      symbol: tokenData.symbol || '',
      price: num(tokenData.price),
      marketCap: num(tokenData.marketCap),
      volume24: num(tokenData.volume24 ?? tokenData.volume24h),
      liquidity: num(tokenData.liquidity),
      priceChange24h,
      // Codex doesn't expose a clean "volume change %" — we approximate from
      // the volume window deltas if present, else 0 (alpha rules treat 0 as
      // "unknown / flat" and skip the divergence check).
      volumeChange24h: num(tokenData.volumeChange24 ?? tokenData.volume_change_24h ?? 0),
      networkId: tokenData.networkId || 1,
    }
  }, [tokenData])
}
