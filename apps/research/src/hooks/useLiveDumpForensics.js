/**
 * useLiveDumpForensics — runs dump forensics ENTIRELY CLIENT-SIDE for any
 * EVM/SOL contract address. Hits DexScreener for token+pair meta and
 * GeckoTerminal for last 300 trades, computes:
 *   - 24h price stack (5m/1h/6h/24h)
 *   - per-hour sells/buys USD bucket
 *   - top sellers histogram + concentration
 *   - verdict (retail_panic / single_wallet_dump / lp_drain / macro / mixed / no_dump)
 *
 * Refreshes every 30s while the tab is visible. No backend dependency —
 * works on day-zero with zero deploy.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

const REFRESH_MS = 30_000
const FETCH_TIMEOUT_MS = 12_000

const GT_CHAIN = {
  ethereum: 'eth', eth: 'eth',
  solana: 'solana', sol: 'solana',
  bsc: 'bsc', 'binance-smart-chain': 'bsc',
  base: 'base', arbitrum: 'arbitrum', optimism: 'optimism',
  polygon: 'polygon_pos', avalanche: 'avax', fantom: 'ftm',
}

async function timeoutFetch(url, opts = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally { clearTimeout(t) }
}

async function fetchToken(ca) {
  const r = await timeoutFetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`)
  if (!r.ok) return null
  const j = await r.json()
  const pairs = (j?.pairs || []).filter((p) => p?.baseToken && p?.quoteToken)
  if (!pairs.length) return null
  pairs.sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))
  const main = pairs[0]
  return {
    chain: main.chainId,
    pairAddress: main.pairAddress,
    symbol: main.baseToken.symbol,
    name: main.baseToken.name,
    priceUsd: parseFloat(main.priceUsd || 0),
    priceChange: main.priceChange || {},
    liquidityUsd: main.liquidity?.usd || 0,
    fdv: main.fdv || null,
    marketCap: main.marketCap || null,
    volume24h: main.volume?.h24 || 0,
    txns24h: main.txns?.h24 || { buys: 0, sells: 0 },
    url: main.url,
    socials: main.info?.socials || [],
    websites: main.info?.websites || [],
  }
}

async function fetchTrades({ chain, pairAddress }) {
  const slug = GT_CHAIN[String(chain).toLowerCase()] || String(chain).toLowerCase()
  const r = await timeoutFetch(`https://api.geckoterminal.com/api/v2/networks/${slug}/pools/${pairAddress}/trades?trade_volume_in_usd_greater_than=0`)
  if (!r.ok) return []
  const j = await r.json()
  const items = j?.data || []
  return items.map((t) => {
    const a = t.attributes || {}
    const ts = a.block_timestamp ? Math.floor(new Date(a.block_timestamp).getTime() / 1000) : 0
    return {
      hash: a.tx_hash,
      side: a.kind,
      baseAmount: parseFloat(a.kind === 'sell' ? a.from_token_amount : a.to_token_amount) || 0,
      usd: parseFloat(a.volume_in_usd) || 0,
      wallet: (a.tx_from_address || '').toLowerCase(),
      ts,
    }
  })
}

const T = {
  DUMP_24H_PCT: 30,
  SINGLE_WALLET_PCT: 35,
  PANIC_SELLERS_MIN: 12,
  PANIC_NET_USD_MIN: 5000,
  MACRO_DROP_PCT: 15,
}

function bucketByHour(trades) {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - 24 * 3600
  const buckets = Array.from({ length: 24 }, (_, i) => ({ hoursAgo: i, sellsUsd: 0, buysUsd: 0, sellsN: 0, buysN: 0 }))
  for (const t of trades) {
    if (t.ts < cutoff) continue
    const h = Math.min(23, Math.floor((now - t.ts) / 3600))
    const b = buckets[h]
    if (t.side === 'sell') { b.sellsUsd += t.usd; b.sellsN += 1 }
    else if (t.side === 'buy') { b.buysUsd += t.usd; b.buysN += 1 }
  }
  let peakHour = 0, peakNet = 0
  for (const b of buckets) {
    const net = b.sellsUsd - b.buysUsd
    if (net > peakNet) { peakNet = net; peakHour = b.hoursAgo }
  }
  return { buckets, peakHour, peakNetUsd: peakNet }
}

function aggregateSellers(trades) {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - 24 * 3600
  const m = new Map()
  let totalSellsUsd = 0
  for (const t of trades) {
    if (t.ts < cutoff || t.side !== 'sell' || !t.wallet) continue
    totalSellsUsd += t.usd
    const cur = m.get(t.wallet) || { wallet: t.wallet, usd: 0, n: 0 }
    cur.usd += t.usd; cur.n += 1
    m.set(t.wallet, cur)
  }
  const ranked = Array.from(m.values()).sort((a, b) => b.usd - a.usd)
  const topSharePct = totalSellsUsd > 0 ? (ranked[0]?.usd || 0) / totalSellsUsd * 100 : 0
  return {
    uniqueSellers: ranked.length,
    totalSellsUsd,
    topSellers: ranked.slice(0, 5),
    topSellerSharePct: +topSharePct.toFixed(1),
  }
}

function deriveVerdict({ token, sellers, bucketing, macro }) {
  const change24h = parseFloat(token?.priceChange?.h24 || 0)
  const change6h = parseFloat(token?.priceChange?.h6 || 0)
  const reasons = []

  if (Math.abs(change24h) < T.DUMP_24H_PCT && Math.abs(change6h) < T.DUMP_24H_PCT) {
    return { verdict: 'no_dump', confidence: 0.95, summary: `No dump (24h ${change24h.toFixed(1)}%).`, reasons: [] }
  }
  if (macro && macro.btcChange24h <= -T.MACRO_DROP_PCT && macro.ethChange24h <= -T.MACRO_DROP_PCT) {
    reasons.push(`market-wide drawdown: BTC ${macro.btcChange24h.toFixed(1)}%, ETH ${macro.ethChange24h.toFixed(1)}%`)
    return { verdict: 'macro_correlated', confidence: 0.7, summary: `Down ${change24h.toFixed(1)}% in line with broad market.`, reasons }
  }
  if (sellers && sellers.topSellerSharePct >= T.SINGLE_WALLET_PCT) {
    reasons.push(`top seller = ${sellers.topSellerSharePct.toFixed(1)}% of all 24h sells ($${Math.round(sellers.topSellers[0]?.usd || 0).toLocaleString()})`)
    return { verdict: 'single_wallet_dump', confidence: 0.85, summary: `One wallet drove ${sellers.topSellerSharePct.toFixed(0)}% of the 24h dump.`, reasons }
  }
  if (sellers && sellers.uniqueSellers >= T.PANIC_SELLERS_MIN && sellers.totalSellsUsd >= T.PANIC_NET_USD_MIN) {
    reasons.push(`${sellers.uniqueSellers} unique sellers, top only ${sellers.topSellerSharePct.toFixed(1)}% — distributed exit`)
    if (bucketing && bucketing.peakNetUsd > 5000) {
      reasons.push(`peak dump window: ${bucketing.peakHour}h ago ($${Math.round(bucketing.peakNetUsd).toLocaleString()} net)`)
    }
    return { verdict: 'retail_panic', confidence: 0.78, summary: `Distributed retail capitulation. ${sellers.uniqueSellers} wallets exited, no whale. Catalyst likely off-chain.`, reasons }
  }
  return { verdict: 'mixed', confidence: 0.4, summary: `Dump confirmed (${change24h.toFixed(1)}% 24h) but pattern unclear.`, reasons: [`${sellers?.uniqueSellers || 0} sellers, top ${sellers?.topSellerSharePct?.toFixed(1) || '?'}%`] }
}

async function fetchMacro() {
  try {
    // 2026-05-28 hide-apis: same-origin /api/coingecko/* -> /api/cg-proxy.
    const r = await timeoutFetch('/api/coingecko/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true', { timeoutMs: 6000 })
    if (!r.ok) return null
    const j = await r.json()
    return {
      btcChange24h: j?.bitcoin?.usd_24h_change ?? null,
      ethChange24h: j?.ethereum?.usd_24h_change ?? null,
    }
  } catch { return null }
}

export default function useLiveDumpForensics({ ca, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    if (!enabled || !ca) return
    // Reset on contract switch: the previous token's dump verdict / sells /
    // wallets must not flash under the new token during its 30s fetch window.
    setData(null)
    setError(null)
    // Per-effect closure flag (NOT a hook-scope ref) — a shared ref reset to
    // false by the next effect run would let token A's late response land on B.
    let cancelled = false
    let timer

    const tick = async () => {
      setLoading(true)
      const t0 = Date.now()
      try {
        const [token, macro] = await Promise.all([fetchToken(ca), fetchMacro()])
        if (cancelled) return
        if (!token) { setError('not on any DEX'); setData(null); return }
        const trades = await fetchTrades(token)
        if (cancelled) return
        const bucketing = bucketByHour(trades)
        const sellers = aggregateSellers(trades)
        const verdict = deriveVerdict({ token, sellers, bucketing, macro })
        const recentSells = trades
          .filter((x) => x.side === 'sell')
          .sort((a, b) => b.usd - a.usd)
          .slice(0, 5)
          .map((x) => ({
            ...x,
            ageMin: Math.floor((Date.now() / 1000 - x.ts) / 60),
            explorer: token.chain === 'solana' ? `https://solscan.io/tx/${x.hash}` : `https://${token.chain}.blockscout.com/tx/${x.hash}`,
          }))
        setData({
          token,
          macro,
          verdict,
          summary: {
            uniqueSellers: sellers.uniqueSellers,
            topSellerSharePct: sellers.topSellerSharePct,
            netSellPressureUsd: +(sellers.totalSellsUsd - trades.filter((t) => t.side === 'buy' && t.ts >= Math.floor(Date.now()/1000) - 24*3600).reduce((a, t) => a + t.usd, 0)).toFixed(2),
            peakDumpHour: bucketing.peakHour,
            tradesAnalyzed: trades.length,
            window: '24h',
          },
          bucketing: bucketing.buckets,
          topSellers: sellers.topSellers,
          recentSells,
          latencyMs: Date.now() - t0,
        })
        setUpdatedAt(Date.now())
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'forensics failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    tick()
    timer = setInterval(() => {
      if ((typeof document !== 'undefined' && document.hidden) || !isAppActive()) return
      tick()
    }, REFRESH_MS)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [enabled, ca])

  return { data, loading, error, updatedAt }
}
