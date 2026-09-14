/**
 * DexStatsBoard - DexScreener-parity stat block for the right panel.
 * Renders socials chips, price tiles, market metrics, timeframe tabs,
 * buy/sell pressure bars, pair info (pooled, addresses), audit links.
 */
import React, { useState, useMemo, useEffect } from 'react'
import { DivergingBar } from './ui/viz'
import { whenIdle } from '../utils/whenIdle'
import './DexStatsBoard.css'

const DEX_CHAIN_SLUG = {
  1: 'ethereum', 56: 'bsc', 137: 'polygon', 8453: 'base',
  42161: 'arbitrum', 10: 'optimism', 43114: 'avalanche', 250: 'fantom',
  1399811149: 'solana', 4663: 'robinhood',
}

// Module-level cache + in-flight dedup for the DexScreener token lookup.
// Without this, two near-simultaneous mounts of this board (or a remount on
// token switch) fired the SAME `/latest/dex/tokens/<addr>` request twice in
// parallel (observed reqids 652+653 in the load waterfall). 60s TTL is plenty
// for pair-creation metadata, which is effectively static.
const _dexPairCache = new Map()   // address -> { data, ts }
const _dexPairInflight = new Map() // address -> Promise
const _DEX_PAIR_TTL = 60_000

// Fetch DexScreener pair info for the token to fill in pairCreatedAt + pairAddress + deployer info
async function fetchDexPairInfo(address) {
  if (!address) return null
  const cached = _dexPairCache.get(address)
  if (cached && Date.now() - cached.ts < _DEX_PAIR_TTL) return cached.data
  if (_dexPairInflight.has(address)) return _dexPairInflight.get(address)

  const promise = (async () => {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`)
      if (!res.ok) return null
      const data = await res.json()
      const pairs = Array.isArray(data?.pairs) ? data.pairs : []
      if (pairs.length === 0) return null
      // Pick the most-liquid pair as the "primary" pair
      const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
      const top = sorted[0]
      return {
        pairAddress: top?.pairAddress || null,
        pairCreatedAt: top?.pairCreatedAt || null, // ms timestamp
        chainId: top?.chainId || null,
        dex: top?.dexId || null,
      }
    } catch { return null }
  })()
    .then((data) => { _dexPairCache.set(address, { data, ts: Date.now() }); return data })
    .finally(() => { _dexPairInflight.delete(address) })

  _dexPairInflight.set(address, promise)
  return promise
}

const formatLargeUSD = (n) => {
  if (n == null || n === 0) return '—'
  const v = Number(n)
  if (!isFinite(v)) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

const formatNumber = (n, max = 2) => {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toLocaleString('en-US', { maximumFractionDigits: max })
}

const formatPriceUSD = (price) => {
  const n = Number(price)
  if (!isFinite(n) || isNaN(n) || n === 0) return '$0.00'
  if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (n >= 1) return `$${n.toFixed(4)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  if (n >= 0.0001) return `$${n.toFixed(6)}`
  return `$${n.toFixed(8)}`
}

const formatPct = (n) => {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

const truncAddr = (addr) => {
  if (!addr) return '—'
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 5)}...${addr.slice(-4)}`
}

const explorerUrl = (chain, address, type = 'token') => {
  if (!address) return '#'
  switch (chain) {
    case 1: return `https://etherscan.io/${type}/${address}`
    case 56: return `https://bscscan.com/${type}/${address}`
    case 137: return `https://polygonscan.com/${type}/${address}`
    case 42161: return `https://arbiscan.io/${type}/${address}`
    case 8453: return `https://basescan.org/${type}/${address}`
    case 10: return `https://optimistic.etherscan.io/${type}/${address}`
    case 1399811149: return `https://solscan.io/token/${address}`
    default: return `https://etherscan.io/${type}/${address}`
  }
}

const holdersUrl = (chain, address) => {
  if (!address) return '#'
  // Etherscan-family token holders tab
  switch (chain) {
    case 1: return `https://etherscan.io/token/${address}#balances`
    case 56: return `https://bscscan.com/token/${address}#balances`
    case 8453: return `https://basescan.org/token/${address}#balances`
    case 42161: return `https://arbiscan.io/token/${address}#balances`
    case 137: return `https://polygonscan.com/token/${address}#balances`
    case 1399811149: return `https://solscan.io/token/${address}#holders`
    default: return `https://etherscan.io/token/${address}#balances`
  }
}

function CopyableAddr({ address, onCopy }) {
  if (!address) return <span className="dsb-addr-pill" style={{ opacity: 0.4 }}>—</span>
  return (
    <button
      className="dsb-addr-pill"
      onClick={(e) => {
        e.stopPropagation()
        if (navigator?.clipboard) {
          navigator.clipboard.writeText(address)
          onCopy?.('Address copied')
        }
      }}
      title={address}
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span className="mono">{truncAddr(address)}</span>
    </button>
  )
}

function ExtLink({ href, label }) {
  if (!href || href === '#') return null
  return (
    <a className="dsb-ext-link" href={href} target="_blank" rel="noopener noreferrer">
      {label}
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M7 7h10v10" /></svg>
    </a>
  )
}

function relativeAge(timestamp) {
  if (!timestamp) return null
  const now = Date.now()
  const ts = typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp
  const diff = now - ts
  if (diff < 0) return null
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(secs / 60)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  const years = Math.floor(months / 12)
  if (years >= 1) {
    const remMonths = months - years * 12
    return remMonths > 0 ? `${years}y ${remMonths}mo ago` : `${years}y ago`
  }
  if (months >= 1) {
    const remDays = days - months * 30
    return remDays > 0 ? `${months}mo ${remDays}d ago` : `${months}mo ago`
  }
  if (days >= 1) return `${days}d ago`
  if (hours >= 1) return `${hours}h ago`
  if (mins >= 1) return `${mins}m ago`
  return `${secs}s ago`
}

function DexStatsBoard(props) {
  const {
    liveTokenData, token, tokenSymbol, baseToken,
    tokenPrice, basePrice, marketCap, fdv, realLiquidity,
    pooledTokenAmount, pooledBaseAmount,
    realChange1h, realChange4h, realChange12h, realChange24,
    volumeTimeframes, liquidityData,
    networkId, isSolana, triggerCopyToast,
    section, // 'stats' | 'activity' | 'pool' | undefined (renders all)
  } = props
  const showStats = section == null || section === 'stats'
  const showActivity = section == null || section === 'activity'
  const showPool = section == null || section === 'pool'

  const [activeTimeframe, setActiveTimeframe] = useState('24H')
  const [moreOpen, setMoreOpen] = useState(false)

  const socials = liveTokenData?.socials || {}
  const website = socials.website || socials.homepage
  const twitter = socials.twitter
  const telegram = socials.telegram
  const discord = socials.discord
  const docs = socials.docs

  const tokenAddress = token?.address

  // Fetch live pair info from DexScreener (pair address, creation time, dex name)
  const [dexPairInfo, setDexPairInfo] = useState(null)
  useEffect(() => {
    // Clear first, before the guard: RightPanel is no longer remounted per
    // token (App.jsx dropped its `key`), so without this the previous token's
    // pair address / pair age keep rendering here - and the pair address is a
    // copyable, explorer-linked value. Stale identity data, not just a stale
    // number.
    setDexPairInfo(null)
    if (!tokenAddress || tokenAddress === 'native') return
    let cancelled = false
    // Idle-defer: pair-creation metadata fills below-the-fold rows; the
    // dexscreener call must not compete with the first-second critical path.
    const cancelIdle = whenIdle(() => {
      if (cancelled) return
      fetchDexPairInfo(tokenAddress).then((info) => { if (!cancelled) setDexPairInfo(info) })
    }, { timeout: 2500 })
    return () => { cancelled = true; cancelIdle() }
  }, [tokenAddress])

  const pairAddress = liveTokenData?.pairAddress || liveTokenData?.poolAddress || dexPairInfo?.pairAddress || null
  const baseTokenAddress = isSolana
    ? 'So11111111111111111111111111111111111111112'
    : networkId === 56 ? '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
    : networkId === 8453 ? '0x4200000000000000000000000000000000000006'
    : networkId === 42161 ? '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    : networkId === 137 ? '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
    : '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

  const pairCreatedAt = liveTokenData?.pairCreatedAt
    || liveTokenData?.createdAt
    || liveTokenData?.creationTimestamp
    || dexPairInfo?.pairCreatedAt
  const pairAge = useMemo(() => relativeAge(pairCreatedAt), [pairCreatedAt])

  const tfMap = useMemo(() => {
    const map = {}
    for (const tf of volumeTimeframes || []) map[String(tf.period).toUpperCase()] = tf
    return map
  }, [volumeTimeframes])

  const tfChange = {
    '5M': null,
    '1H': realChange1h,
    '6H': realChange4h, // closest available
    '24H': realChange24,
  }

  const activeTf = tfMap[activeTimeframe] || tfMap['24H']
  const buys = activeTf?.buys || 0
  const sells = activeTf?.sells || 0
  const buyPct = buys + sells > 0 ? (buys / (buys + sells)) * 100 : 50
  const buyVolPct = activeTf?.buyVol ?? 50
  const buyersCount = Math.max(1, Math.floor(buys * 0.9))
  const sellersCount = Math.max(1, Math.floor(sells * 0.9))
  const buyersPct = buyersCount + sellersCount > 0 ? (buyersCount / (buyersCount + sellersCount)) * 100 : 50

  const totalTxns = buys + sells
  const totalVol = activeTf?.volume || formatLargeUSD(realLiquidity)
  const buyVolUSD = activeTf?.volumeRaw ? activeTf.volumeRaw * (buyVolPct / 100) : 0
  const sellVolUSD = activeTf?.volumeRaw ? activeTf.volumeRaw * (1 - buyVolPct / 100) : 0
  const totalMakers = buyersCount + sellersCount

  const pricePerBaseToken = basePrice > 0 && tokenPrice > 0
    ? (tokenPrice / basePrice).toFixed(7)
    : null

  const lpBurnedHigh = (liquidityData?.lockPercentage || 0) >= 50

  return (
    <div className="dsb-board">
      {showStats && (<>
      {/* Socials shown in token banner above — not duplicated here */}
      <div className="dsb-socials" style={{ display: 'none' }}>
        {website && (
          <a className="dsb-chip" href={website} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
            </svg>
            <span>Website</span>
          </a>
        )}
        {twitter && (
          <a className="dsb-chip" href={twitter} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            <span>Twitter</span>
          </a>
        )}
        {telegram && (
          <a className="dsb-chip" href={telegram} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="m22 2-20 8 7 3 9-7-6 9 4 6 6-19z" /></svg>
            <span>Telegram</span>
          </a>
        )}
        {!website && !twitter && !telegram && (
          <span className="dsb-no-socials">No socials available</span>
        )}
        {(discord || docs) && (
          <button className="dsb-chip more" onClick={() => setMoreOpen((v) => !v)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        )}
      </div>
      {moreOpen && (discord || docs) && (
        <div className="dsb-socials-more">
          {discord && <a className="dsb-chip small" href={discord} target="_blank" rel="noopener noreferrer">Discord</a>}
          {docs && <a className="dsb-chip small" href={docs} target="_blank" rel="noopener noreferrer">Docs</a>}
        </div>
      )}

      {/* Price tiles */}
      <div className="dsb-row two">
        <div className="dsb-tile">
          <span className="dsb-tile-label">Price USD</span>
          <span className="dsb-tile-value mono">{formatPriceUSD(tokenPrice)}</span>
        </div>
        <div className="dsb-tile">
          <span className="dsb-tile-label">Price</span>
          <span className="dsb-tile-value mono">
            {pricePerBaseToken ? `${pricePerBaseToken}` : '—'} <span className="dsb-tile-unit">{baseToken}</span>
          </span>
        </div>
      </div>

      {/* Market metrics */}
      <div className="dsb-row three">
        <div className="dsb-tile">
          <span className="dsb-tile-label">Liquidity</span>
          <span className="dsb-tile-value mono">
            {formatLargeUSD(realLiquidity)}
            {lpBurnedHigh && (
              <svg className="dsb-lock" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" title="LP locked">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </span>
        </div>
        <div className="dsb-tile">
          <span className="dsb-tile-label dotted">FDV</span>
          <span className="dsb-tile-value mono">{fdv ? formatLargeUSD(fdv) : '—'}</span>
        </div>
        <div className="dsb-tile">
          <span className="dsb-tile-label dotted">MKT CAP</span>
          <span className="dsb-tile-value mono">{formatLargeUSD(marketCap)}</span>
        </div>
      </div>

      </>)}

      {showActivity && (<>
      {/* Timeframe selector */}
      <div className="dsb-tf-row">
        {['5M', '1H', '6H', '24H'].map((tf) => {
          const ch = tfChange[tf]
          const hasData = ch != null && !isNaN(ch)
          return (
            <button
              key={tf}
              className={`dsb-tf-tab${activeTimeframe === tf ? ' active' : ''}`}
              onClick={() => setActiveTimeframe(tf)}
            >
              <span className="dsb-tf-label">{tf}</span>
              <span className={`dsb-tf-pct ${hasData ? (ch >= 0 ? 'pos' : 'neg') : 'na'}`}>
                {hasData ? formatPct(ch) : 'N/A'}
              </span>
            </button>
          )
        })}
      </div>

      {/* Activity rows */}
      <div className="dsb-activity">
        <div className="dsb-act-row">
          <div className="dsb-act-label-block">
            <span className="dsb-act-label">TXNS</span>
            <span className="dsb-act-num mono">{formatNumber(totalTxns, 0)}</span>
          </div>
          <div className="dsb-act-bars">
            <div className="dsb-act-pair">
              <div className="dsb-act-pair-head">
                <span className="dsb-act-side-label">BUYS</span>
                <span className="dsb-act-side-label right">SELLS</span>
              </div>
              <div className="dsb-act-pair-vals">
                <span className="dsb-act-val mono pos">{formatNumber(buys, 0)}</span>
                <span className="dsb-act-val mono neg">{formatNumber(sells, 0)}</span>
              </div>
              <DivergingBar left={buys} right={sells} height={6} />
            </div>
          </div>
        </div>

        <div className="dsb-act-row">
          <div className="dsb-act-label-block">
            <span className="dsb-act-label">VOLUME</span>
            <span className="dsb-act-num mono">{typeof totalVol === 'string' ? totalVol : formatLargeUSD(totalVol)}</span>
          </div>
          <div className="dsb-act-bars">
            <div className="dsb-act-pair">
              <div className="dsb-act-pair-head">
                <span className="dsb-act-side-label">BUY VOL</span>
                <span className="dsb-act-side-label right">SELL VOL</span>
              </div>
              <div className="dsb-act-pair-vals">
                <span className="dsb-act-val mono pos">{buyVolUSD > 0 ? formatLargeUSD(buyVolUSD) : '—'}</span>
                <span className="dsb-act-val mono neg">{sellVolUSD > 0 ? formatLargeUSD(sellVolUSD) : '—'}</span>
              </div>
              <DivergingBar left={buyVolUSD} right={sellVolUSD} height={6} />
            </div>
          </div>
        </div>

        <div className="dsb-act-row">
          <div className="dsb-act-label-block">
            <span className="dsb-act-label">MAKERS</span>
            <span className="dsb-act-num mono">{formatNumber(totalMakers, 0)}</span>
          </div>
          <div className="dsb-act-bars">
            <div className="dsb-act-pair">
              <div className="dsb-act-pair-head">
                <span className="dsb-act-side-label">BUYERS</span>
                <span className="dsb-act-side-label right">SELLERS</span>
              </div>
              <div className="dsb-act-pair-vals">
                <span className="dsb-act-val mono pos">{formatNumber(buyersCount, 0)}</span>
                <span className="dsb-act-val mono neg">{formatNumber(sellersCount, 0)}</span>
              </div>
              <DivergingBar left={buyersCount} right={sellersCount} height={6} />
            </div>
          </div>
        </div>
      </div>

      </>)}

      {showPool && (<>
      {/* Liquidity Pool Card */}
      <section className="dsb-pool">
        <div className="dsb-pool-head">
          <div className="dsb-pool-title-block">
            <span className="dsb-pool-eyebrow">Liquidity Pool</span>
            <span className="dsb-pool-title">{tokenSymbol} / {baseToken}</span>
          </div>
          {pairAge && (
            <div className="dsb-pool-age">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
              </svg>
              <span>{pairAge}</span>
            </div>
          )}
        </div>

        <div className="dsb-pool-split">
          <div className="dsb-pool-side">
            <span className="dsb-pool-amount mono">{formatNumber(pooledTokenAmount, 0)}</span>
            <span className="dsb-pool-symbol">{tokenSymbol}</span>
            <span className="dsb-pool-usd mono">{formatLargeUSD(pooledTokenAmount * tokenPrice)}</span>
          </div>
          <span className="dsb-pool-divider" />
          <div className="dsb-pool-side base">
            <span className="dsb-pool-amount mono">{formatNumber(pooledBaseAmount, 2)}</span>
            <span className="dsb-pool-symbol">{baseToken}</span>
            <span className="dsb-pool-usd mono">{formatLargeUSD(pooledBaseAmount * basePrice)}</span>
          </div>
        </div>

        {/* OL Iteration 2: removed the fake 50/50 pool-bar-fill. Real pair
            reserves require pair data the trading app doesn't currently
            fetch (useTokenPairs is a stub). Better to show the two
            balanced sides above than a fabricated split. */}
      </section>

      </>)}
    </div>
  )
}

// Memoized: RightPanel re-renders on every swap keystroke and quote tick;
// with stable props (parent useMemos volumeTimeframes/liquidityData/fdv)
// both boards now bail out of those renders entirely.
export default React.memo(DexStatsBoard)
