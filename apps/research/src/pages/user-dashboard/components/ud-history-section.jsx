/**
 * Swap History Section - User Dashboard
 * Shows a list of past swaps with chain icon, tokens, amounts, timestamp, and explorer link.
 */
import { useState, useEffect, useCallback } from 'react'
import './ud-history-section.css'

const CHAIN_INFO = {
  ethereum: { name: 'Ethereum', icon: 'ETH', color: '#627eea', explorer: 'https://etherscan.io/tx/' },
  bsc: { name: 'BSC', icon: 'BNB', color: '#F3BA2F', explorer: 'https://bscscan.com/tx/' },
  polygon: { name: 'Polygon', icon: 'MATIC', color: '#8247E5', explorer: 'https://polygonscan.com/tx/' },
  arbitrum: { name: 'Arbitrum', icon: 'ARB', color: '#28A0F0', explorer: 'https://arbiscan.io/tx/' },
  base: { name: 'Base', icon: 'BASE', color: '#0052FF', explorer: 'https://basescan.org/tx/' },
  solana: { name: 'Solana', icon: 'SOL', color: '#9945FF', explorer: 'https://solscan.io/tx/' },
}

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

function truncateHash(hash) {
  if (!hash || hash.length < 12) return hash || ''
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

export default function UdHistorySection({ getSwapHistory, triggerCopyToast }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 20

  // Initial fetch
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

  // Loading state - shimmer skeletons
  if (loading) {
    return (
      <div className="ud-card ud-history">
        <div className="ud-card-header-row">
          <h2 className="ud-card-title">Swap History</h2>
        </div>
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

  // Empty state
  if (!history.length) {
    return (
      <div className="ud-card ud-history">
        <div className="ud-card-header-row">
          <h2 className="ud-card-title">Swap History</h2>
        </div>
        <div className="ud-history-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
            <path d="M7 16V4M7 4L3 8M7 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17 8v12M17 20l4-4M17 20l-4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p>No swaps yet</p>
          <span>Your swap transactions will appear here</span>
        </div>
      </div>
    )
  }

  return (
    <div className="ud-card ud-history">
      <div className="ud-card-header-row">
        <h2 className="ud-card-title">Swap History</h2>
        <span className="ud-history-count">{history.length} swap{history.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="ud-history-list">
        {history.map((swap, idx) => {
          const chain = CHAIN_INFO[swap.chainId] || CHAIN_INFO.ethereum
          return (
            <div key={swap.txHash || idx} className="ud-history-row">
              {/* Chain indicator */}
              <div className="ud-history-chain" style={{ '--chain-color': chain.color }}>
                <span className="ud-history-chain-icon">{chain.icon}</span>
              </div>

              {/* Swap details */}
              <div className="ud-history-details">
                <div className="ud-history-tokens">
                  <span className="ud-history-token-amount">{swap.inputAmount}</span>
                  <span className="ud-history-token-symbol">{swap.inputToken}</span>
                  <svg className="ud-history-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  <span className="ud-history-token-amount">{swap.outputAmount}</span>
                  <span className="ud-history-token-symbol">{swap.outputToken}</span>
                </div>
                <div className="ud-history-meta">
                  <span className="ud-history-time">{formatTimestamp(swap.timestamp)}</span>
                  {swap.txHash && (
                    <>
                      <span className="ud-history-sep" />
                      <button
                        className="ud-history-hash"
                        onClick={() => handleCopyHash(swap.txHash)}
                        title="Copy transaction hash"
                      >
                        {truncateHash(swap.txHash)}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Explorer link */}
              {swap.txHash && (
                <a
                  href={`${chain.explorer}${swap.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ud-history-explorer"
                  title={`View on ${chain.name} explorer`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M15 3h6v6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </div>
          )
        })}
      </div>

      {hasMore && (
        <button
          className="ud-history-load-more"
          onClick={handleLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? (
            <span className="ud-history-load-more-shimmer" />
          ) : (
            'Load more'
          )}
        </button>
      )}
    </div>
  )
}
