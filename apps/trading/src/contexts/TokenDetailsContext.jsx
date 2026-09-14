/**
 * Token data contexts - deliberately SPLIT BY CADENCE.
 *
 * There are two very different clocks on a token page:
 *   - details (mcap, supply, socials, name, decimals...) change every 60s
 *   - the live price changes up to ~3x/second (SSE, throttled 320ms)
 *
 * They used to ride ONE context value. Merging the stream price into
 * `codexResult` produced a NEW object identity on every tick, which fanned out
 * to 8 consumers totalling ~14,500 lines of component - TradingChart (5285),
 * DataTabs (3183), LeftPanel (2662), RightPanel (2443), TokenBanner (877) and
 * friends. Four of those are wrapped in React.memo and it bought nothing:
 * **memo does not protect against a context change.** The result was a
 * continuous background reconciliation load that every click had to queue
 * behind - the "heavy software, not a trading terminal" feeling.
 *
 * Now: two providers, two clocks.
 *   useSharedTokenDetails()  -> details + live price (re-renders ~3x/s)
 *   useTokenDetailsStatic()  -> details ONLY        (re-renders ~1x/60s)
 *
 * `useSharedTokenDetails` keeps its exact previous shape and semantics, so no
 * call site had to change to adopt the split. Consumers that never read
 * `tokenData.price` should move to `useTokenDetailsStatic` - that is where the
 * win actually lands.
 */
import { createContext, useContext, useEffect, useMemo } from 'react'
import { useTokenDetails } from '../hooks/useCodexData'
import { useCodexTokenPrice } from '../hooks/useCodexStream'
import { setTokenPair } from '../services/codexStreamApi'
import { getPairInfo } from '../services/codexApi'

// Slow lane: whatever useTokenDetails returned. Identity changes only when the
// 60s poll lands (the hook already useMemo's its own return).
const TokenDetailsContext = createContext(undefined)
// Fast lane: the raw stream price + the address it belongs to. A primitive
// pair, so consumers of the slow lane never see it move.
const TokenPriceContext = createContext(undefined)

export function TokenDetailsProvider({ address, networkId, children }) {
  // 2026-06-03 cost war: when this trading app is embedded inside the
  // research /token iframe, the parent research page already runs its own
  // useTokenDetails poll on the same address (TokenDataContext, 60s). Two
  // independent polls on the same address = double the Codex `tokenInfo`
  // ops with no benefit. Detect the iframe and let the parent drive — SSE
  // still ticks the price via useCodexTokenPrice below, so the iframe stays
  // live. Standalone trading (trade.spectreai.io direct) keeps its own poll.
  const isEmbeddedInIframe = typeof window !== 'undefined' && window.top !== window.self
  const codexResult = useTokenDetails(address, networkId, isEmbeddedInIframe ? 0 : 60000)

  // Real-time price overlay from Codex WebSocket subscription
  const { price: streamPrice, streamAddress } = useCodexTokenPrice(address, networkId)

  // Tell the price stream which PAIR (and which side of it) this token trades
  // on, so the relay serves its ticks from the pair's trade feed - the same
  // Codex subscription the Transactions tape already holds - instead of a
  // second onPricesUpdated subscription. pair-info is module-cached 5 min and
  // the Liquidity / Info surfaces fetch it anyway, so this is a free read.
  // Registration is cleared on token switch; a stale pair must never price
  // the next token (the wrong-token guard below still applies on top).
  useEffect(() => {
    if (!address) return
    const key = `${address}:${networkId}`
    let cancelled = false
    getPairInfo(address, networkId)
      .then((info) => {
        if (cancelled || !info?.pairAddress || !info.tokenSide) return
        setTokenPair(key, info.pairAddress, info.tokenSide)
      })
      .catch(() => { /* stays on onPricesUpdated */ })
    return () => { cancelled = true; setTokenPair(key, null) }
  }, [address, networkId])

  // The fast-lane value is two primitives, so its identity only changes when
  // the price actually changes - never merely because details re-polled.
  // providerAddress rides along so the consumer-side merge keeps the ORIGINAL
  // wrong-token guard, which compared streamAddress against
  // tokenData.address OR this address prop. Without that fallback, a payload
  // whose tokenData has no address would let ANY stream price through - and a
  // price from the wrong token feeds the swap quote. Money path; keep it whole.
  const priceValue = useMemo(
    () => ({ streamPrice, streamAddress, providerAddress: address }),
    [streamPrice, streamAddress, address],
  )

  return (
    <TokenDetailsContext.Provider value={codexResult}>
      <TokenPriceContext.Provider value={priceValue}>
        {children}
      </TokenPriceContext.Provider>
    </TokenDetailsContext.Provider>
  )
}

/**
 * Details + the live price. Identical shape to what this hook has always
 * returned, so existing call sites are unaffected. Re-renders on every price
 * tick BY DESIGN - only use it where the live price is actually read.
 */
export function useSharedTokenDetails() {
  const codexResult = useContext(TokenDetailsContext)
  const priceCtx = useContext(TokenPriceContext)
  if (codexResult === undefined || priceCtx === undefined) {
    throw new Error('useSharedTokenDetails must be used inside TokenDetailsProvider')
  }
  const { streamPrice, streamAddress, providerAddress } = priceCtx || {}

  // The merge moved out of the provider and into the consumer. Same logic as
  // before - it just no longer forces a new identity on components that did
  // not ask for the price.
  return useMemo(() => {
    if (!codexResult) return codexResult
    if (!streamPrice) return codexResult

    // Prevent stale stream price from wrong token bleeding into new token's data
    const tokenAddr = codexResult.tokenData?.address || providerAddress
    if (streamAddress && tokenAddr && streamAddress.toLowerCase() !== tokenAddr.toLowerCase()) {
      return codexResult
    }

    return {
      ...codexResult,
      tokenData: codexResult.tokenData ? {
        ...codexResult.tokenData,
        price: streamPrice,
        _priceSource: 'stream',
      } : codexResult.tokenData,
    }
  }, [codexResult, streamPrice, streamAddress, providerAddress])
}

/**
 * Details WITHOUT the live price - the 60s lane only. Use this anywhere the
 * component does not render `tokenData.price`: it will then re-render roughly
 * once a minute instead of three times a second.
 */
export function useTokenDetailsStatic() {
  const codexResult = useContext(TokenDetailsContext)
  if (codexResult === undefined) {
    throw new Error('useTokenDetailsStatic must be used inside TokenDetailsProvider')
  }
  return codexResult
}

/**
 * Just the live price. For a component that renders the ticking number and
 * nothing else from the details payload.
 */
export function useTokenStreamPrice() {
  const ctx = useContext(TokenPriceContext)
  if (ctx === undefined) {
    throw new Error('useTokenStreamPrice must be used inside TokenDetailsProvider')
  }
  return ctx || { streamPrice: null, streamAddress: null }
}
