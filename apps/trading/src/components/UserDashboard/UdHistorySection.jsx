/**
 * Trade History Section - User Dashboard
 * Shows a list of past swaps with chain icon, tokens, amounts, timestamp, and explorer link.
 * Ported from research app.
 */
import { useState, useEffect, useCallback } from 'react'

const CHAIN_INFO = {
  ethereum: { name: 'Ethereum', icon: 'ETH', color: '#627eea', explorer: 'https://etherscan.io/tx/', native: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  bsc: { name: 'BSC', icon: 'BNB', color: '#F3BA2F', explorer: 'https://bscscan.com/tx/', native: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png' },
  polygon: { name: 'Polygon', icon: 'MATIC', color: '#8247E5', explorer: 'https://polygonscan.com/tx/', native: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png' },
  arbitrum: { name: 'Arbitrum', icon: 'ARB', color: '#28A0F0', explorer: 'https://arbiscan.io/tx/', native: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  base: { name: 'Base', icon: 'BASE', color: '#0052FF', explorer: 'https://basescan.org/tx/', native: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  solana: { name: 'Solana', icon: 'SOL', color: '#9945FF', explorer: 'https://solscan.io/tx/', native: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
}

// Relative label ("2m ago") for the primary line.
function formatTimestamp(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Absolute date-time ("Jul 7, 2026, 8:35 PM") for the meta line + tooltip.
function formatAbsolute(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Token avatar - logo with graceful fallback to a lettered circle.
function TokenAvatar({ logo, symbol, native }) {
  const [broken, setBroken] = useState(false)
  const src = (!broken && logo) ? logo : (!broken && native) ? native : null
  if (src) {
    return <img className="ud-history-tok-logo" src={src} alt={symbol || ''} loading="lazy" onError={() => setBroken(true)} />
  }
  return <span className="ud-history-tok-logo ud-history-tok-logo--fallback">{(symbol || '?').charAt(0)}</span>
}

function truncateHash(hash) {
  if (!hash || hash.length < 12) return hash || ''
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

const EVM_NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

// Resolve a display symbol: prefer the logged symbol, else map the native
// sentinel to the chain's native asset, else a short address (legacy rows
// logged before symbols were captured).
function symbolFor(address, storedSymbol, chainId) {
  if (storedSymbol) return storedSymbol
  if (!address) return '?'
  const a = String(address).toLowerCase()
  if (a === EVM_NATIVE_SENTINEL || address === 'native') return (CHAIN_INFO[chainId]?.icon) || 'ETH'
  if (address === SOL_NATIVE_MINT) return 'SOL'
  return `${String(address).slice(0, 4)}…${String(address).slice(-4)}`
}

// Format a base-unit amount into a compact human string using the token's
// decimals. Falls back to the chain-native decimals when unknown (legacy).
function formatAmount(raw, decimals, chainId) {
  if (raw == null || raw === '') return ''
  const dec = Number.isFinite(decimals) ? decimals : (chainId === 'solana' ? 9 : 18)
  let n
  try { n = Number(raw) / 10 ** dec } catch { return String(raw) }
  if (!Number.isFinite(n)) return String(raw)
  if (n === 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })}B`
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  if (n >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  if (n >= 0.0001) return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
  return n.toPrecision(2)
}

// Withdrawals store the amount as a HUMAN DECIMAL (e.g. "0.0018"), not base
// units - so format it directly. (Swaps store base units and go through
// formatAmount, which divides by decimals.)
function formatDecimal(v) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  if (n === 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })}B`
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  if (n >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  if (n >= 0.0001) return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
  return n.toPrecision(2)
}

// Infer side when not logged: output is native/stable => SELL of input;
// input is native/stable => BUY of output. Defaults to null (no pill).
function inferSide(swap) {
  if (swap.side === 'buy' || swap.side === 'sell') return swap.side
  const inA = String(swap.inputToken || '').toLowerCase()
  const outA = String(swap.outputToken || '').toLowerCase()
  const isNative = (a, addr) => a === EVM_NATIVE_SENTINEL || addr === 'native' || addr === SOL_NATIVE_MINT
  if (isNative(inA, swap.inputToken)) return 'buy'
  if (isNative(outA, swap.outputToken)) return 'sell'
  return null
}

export default function UdHistorySection({ getSwapHistory, triggerCopyToast }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 20

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const data = await getSwapHistory(PAGE_SIZE, 0)
        if (cancelled) return
        setHistory(data || [])
        setHasMore((data || []).length >= PAGE_SIZE)
      } catch {
        if (!cancelled) setHistory([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [getSwapHistory])

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const data = await getSwapHistory(PAGE_SIZE, history.length)
      setHistory((prev) => [...prev, ...(data || [])])
      setHasMore((data || []).length >= PAGE_SIZE)
    } catch {
      // Silently fail
    } finally {
      setLoadingMore(false)
    }
  }, [getSwapHistory, history.length])

  const handleCopyHash = useCallback((hash) => {
    navigator.clipboard.writeText(hash).catch(() => {})
    triggerCopyToast?.('Transaction hash copied')
  }, [triggerCopyToast])

  const handleCopyAddress = useCallback((address) => {
    navigator.clipboard.writeText(address).catch(() => {})
    triggerCopyToast?.('Address copied')
  }, [triggerCopyToast])

  if (loading) {
    return (
      <div className="ud-card ud-history">
        <div className="ud-card-header-row"><h2 className="ud-card-title">Trade History</h2></div>
        <div className="ud-history-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ud-history-row ud-history-shimmer" style={{ animationDelay: `${i * 100}ms` }}>
              <div className="ud-history-shimmer-chain" />
              <div className="ud-history-shimmer-details">
                <div className="ud-history-shimmer-line wide" />
                <div className="ud-history-shimmer-line narrow" />
              </div>
              <div className="ud-history-shimmer-amount" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!history.length) {
    return (
      <div className="ud-card ud-history">
        <div className="ud-card-header-row"><h2 className="ud-card-title">Trade History</h2></div>
        <div className="ud-history-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
            <path d="M7 16V4M7 4L3 8M7 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17 8v12M17 20l4-4M17 20l-4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p>No transactions yet</p>
          <span>Your trades and withdrawals will appear here</span>
        </div>
      </div>
    )
  }

  return (
    <div className="ud-card ud-history">
      <div className="ud-card-header-row">
        <h2 className="ud-card-title">Trade History</h2>
        <span className="ud-history-count">{history.length} transaction{history.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="ud-history-list">
        {history.map((swap, idx) => {
          const chain = CHAIN_INFO[swap.chainId] || CHAIN_INFO.ethereum
          const inSym = symbolFor(swap.inputToken, swap.inputSymbol, swap.chainId)
          const outSym = symbolFor(swap.outputToken, swap.outputSymbol, swap.chainId)
          const inAmt = formatAmount(swap.inputAmount, swap.inputDecimals, swap.chainId)
          const outAmt = formatAmount(swap.outputAmount, swap.outputDecimals, swap.chainId)
          const side = inferSide(swap)
          // Withdrawals are logged with type:'withdraw', inputToken = the token
          // SYMBOL (e.g. 'ETH'), inputAmount = a human decimal, and a toAddress -
          // a different shape than swaps, so they render on their own branch.
          const isWithdraw = swap.type === 'withdraw'
          const wdIsNative = isWithdraw && String(swap.inputToken || '').toUpperCase() === String(chain.icon || '').toUpperCase()
          const usd = Number.isFinite(Number(swap.usd)) && Number(swap.usd) > 0
            ? `$${Number(swap.usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : null
          const isInNative = String(swap.inputToken || '').toLowerCase() === EVM_NATIVE_SENTINEL || swap.inputToken === 'native' || swap.inputToken === SOL_NATIVE_MINT
          const isOutNative = String(swap.outputToken || '').toLowerCase() === EVM_NATIVE_SENTINEL || swap.outputToken === 'native' || swap.outputToken === SOL_NATIVE_MINT
          const rel = formatTimestamp(swap.timestamp)
          const abs = formatAbsolute(swap.timestamp)
          return (
            <div key={swap.txHash || idx} className="ud-history-row">
              <div className="ud-history-chain-badge" style={{ '--chain-color': chain.color }} title={chain.name}>
                <img className="ud-history-chain-logo" src={chain.native} alt={chain.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              </div>
              <div className="ud-history-details">
                <div className="ud-history-tokens">
                  {isWithdraw ? (
                    <>
                      <span className="ud-history-side ud-history-side--withdraw">Withdraw</span>
                      <span className="ud-history-leg">
                        <TokenAvatar logo={null} symbol={swap.inputToken} native={wdIsNative ? chain.native : null} />
                        <span className="ud-history-token-amount">{formatDecimal(swap.inputAmount)}</span>
                        <span className="ud-history-token-symbol">{swap.inputToken}</span>
                      </span>
                      {swap.toAddress && (
                        <>
                          <svg className="ud-history-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                          <button type="button" className="ud-history-leg ud-history-dest" title={`Copy ${swap.toAddress}`} onClick={() => handleCopyAddress(swap.toAddress)}>
                            {truncateHash(swap.toAddress)}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {side && <span className={`ud-history-side ud-history-side--${side}`}>{side === 'buy' ? 'Buy' : 'Sell'}</span>}
                      <span className="ud-history-leg">
                        <TokenAvatar logo={swap.inputLogo} symbol={inSym} native={isInNative ? chain.native : null} />
                        <span className="ud-history-token-amount">{inAmt}</span>
                        <span className="ud-history-token-symbol">{inSym}</span>
                      </span>
                      <svg className="ud-history-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                      <span className="ud-history-leg">
                        <TokenAvatar logo={swap.outputLogo} symbol={outSym} native={isOutNative ? chain.native : null} />
                        <span className="ud-history-token-amount">{outAmt}</span>
                        <span className="ud-history-token-symbol">{outSym}</span>
                      </span>
                    </>
                  )}
                </div>
                <div className="ud-history-meta">
                  <span className="ud-history-time" title={abs}>{rel}</span>
                  {abs && (
                    <>
                      <span className="ud-history-sep" />
                      <span className="ud-history-date">{abs}</span>
                    </>
                  )}
                  {swap.txHash && (
                    <>
                      <span className="ud-history-sep" />
                      <button className="ud-history-hash" onClick={() => handleCopyHash(swap.txHash)} title="Copy transaction hash">{truncateHash(swap.txHash)}</button>
                    </>
                  )}
                </div>
              </div>
              <div className="ud-history-right">
                {usd && <span className="ud-history-usd">{usd}</span>}
                {swap.txHash && (
                  <a href={`${chain.explorer}${swap.txHash}`} target="_blank" rel="noopener noreferrer" className="ud-history-explorer" title={`View on ${chain.name} explorer`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="15" height="15"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 3h6v6" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {hasMore && (
        <button className="ud-history-load-more" onClick={handleLoadMore} disabled={loadingMore}>
          {loadingMore ? <span className="ud-history-load-more-shimmer" /> : 'Load more'}
        </button>
      )}
    </div>
  )
}
