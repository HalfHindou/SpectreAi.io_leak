/**
 * useSwapExecution - Connects Privy wallets to the swap service.
 * Handles: quote fetching (debounced), swap execution, tx confirmation, and state.
 *
 * Why this hook exists:
 *   RightPanel was 1400+ lines with hardcoded `walletConnected = false`.
 *   This extracts all swap logic and wires it to real Privy wallets so
 *   the component just calls `fetchQuote()` and `executeSwap()`.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { usePrivySafe as usePrivy, useWalletsSafe as useWallets, requestPrivyMount } from '../lib/use-privy-safe'
// Privy v3 splits wallets by chain: the MAIN useWallets() returns EVM
// wallets ONLY. Solana wallets (incl. the embedded one) come from the
// /solana subpath's own useWallets(). The old single-hook selection could
// never find a Solana wallet -> address null -> balances empty -> the swap
// panel showed "Insufficient balance" for funded wallets and could not sign.
// Signing goes through useSignAndSendTransaction - calling the wallet
// object's own method routes through the wallet-standard CONNECT ceremony
// (EmbeddedWalletConnectingScreen) which rejects with "User must be
// authenticated and have a Privy wallet before it can be connected".
import { useSolanaWalletsSafe as useSolanaWallets, useSignAndSendTransactionSafe as useSignAndSendTransaction, useSignTransactionSafe as useSignTransaction } from '../lib/use-privy-safe'
import {
  getSwapQuote,
  executeSwap as execSwap,
  waitForConfirmation,
  fromSmallestUnit,
  getErc20BalanceRaw,
} from '../services/swapService'
import { buildSwapParams, parsePriceImpact } from '../lib/swapParams'
import { track, Events } from '../services/analytics'
import { useWalletBalances } from './useWalletBalances'
import { getTokenBalance, getTokenDecimals } from '../services/walletService'
import { readWalletCache, writeWalletCache, clearWalletCache } from '../lib/walletCache'
import { markSpectreSwap, recordSpectreSwap } from '../lib/spectreSwapMarks'

const QUOTE_DEBOUNCE_MS = 200

// Slippage bounds: 0.01% min, 5% max. Server enforces the same cap, but we
// clamp client-side too so the UI never displays a request that will be rejected.
const MAX_SLIPPAGE_BPS = 500
const MIN_SLIPPAGE_BPS = 1

// Hard block above 5% price impact - a quote returning >5% impact almost always
// indicates an illiquid pair or a sandwich-bot trap, regardless of slippage tolerance.
// User must explicitly lower the size or accept the loss elsewhere. Surfaced as
// swapError with a specific message so the UI can render guidance.
const MAX_PRICE_IMPACT_PCT = 5

// Default tolerance 1% (100 bps). The original 0.5% default was calibrated
// for majors and failed on fresh pump.fun-class tokens with Jupiter error
// 6001 SlippageToleranceExceeded (thin pools move >0.5% between quote and
// execution). The Jupiter build passes dynamicSlippage capped at this value,
// so the EFFECTIVE fill is usually tighter - this is the ceiling, and users
// can raise it to 5% in the swap settings popover.
const DEFAULT_SLIPPAGE_BPS = 100

function clampSlippage(input) {
  const raw = Number(input)
  if (!Number.isFinite(raw)) return DEFAULT_SLIPPAGE_BPS
  return Math.min(Math.max(Math.floor(raw), MIN_SLIPPAGE_BPS), MAX_SLIPPAGE_BPS)
}

// Normalize a token identifier for quote-vs-UI comparison. The 0x handler
// echoes the EVM native SENTINEL (0xEeee...) where the client uses the
// literal 'native', and 0x returns CHECKSUMMED addresses where our token
// objects are lowercase - both made the staleness guard misfire with
// "Quote expired" on every EVM native-pair swap. EVM ids compare
// case-insensitively; Solana mints are case-SENSITIVE base58 and pass
// through untouched.
const EVM_NATIVE_SENTINEL_LC = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
function normTokenId(t) {
  if (!t) return 'native'
  const s = String(t)
  if (/^0x/i.test(s)) {
    const lower = s.toLowerCase()
    return lower === EVM_NATIVE_SENTINEL_LC ? 'native' : lower
  }
  return s
}

// parsePriceImpact moved to lib/swapParams (pure, unit-tested) - the old
// in-file magnitude heuristic misread 0x sub-1% impacts as fractions and
// blocked healthy EVM swaps.

/**
 * @param {Object} opts
 * @param {Object} opts.token - The token being traded (from token page)
 * @param {string} opts.mode - 'buy' or 'sell'
 * @param {Object} opts.payToken - Token user is paying with
 * @param {number} opts.slippageBps - Slippage tolerance (default 50 = 0.5%)
 */
export function useSwapExecution({ token, mode, payToken, slippageBps: rawSlippageBps = DEFAULT_SLIPPAGE_BPS }) {
  const slippageBps = clampSlippage(rawSlippageBps)
  const { authenticated, ready, user, getAccessToken, login, logout } = usePrivy()
  const { wallets } = useWallets()
  const { wallets: solanaWallets } = useSolanaWallets()
  const { signAndSendTransaction: solanaSignAndSend } = useSignAndSendTransaction()
  const { signTransaction: solanaSignOnly } = useSignTransaction()
  const [quote, setQuote] = useState(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState(null)
  const [isSwapping, setIsSwapping] = useState(false)
  const [swapSuccess, setSwapSuccess] = useState(false)
  // Executed-swap summary for the success card (real amounts from the quote
  // that actually settled, not pre-click UI state).
  const [swapSummary, setSwapSummary] = useState(null)
  const [swapError, setSwapError] = useState(null)
  const [txHash, setTxHash] = useState(null)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)
  // Synchronous re-entry guard for doSwap. `isSwapping` state is async (setState
  // batches across React renders) so two synchronous clicks in the same frame both
  // see `isSwapping === false`. The ref flips immediately and blocks the second.
  const swapInFlightRef = useRef(false)
  // Last amount passed to fetchQuote - lets the wallet-arrival effect below
  // re-quote the same amount once Privy hydrates the signing wallet.
  const lastQuoteAmountRef = useRef(null)

  // Find the right Privy embedded wallet for the chain.
  // `authenticated` = user is logged in. `wallet` = Privy has loaded the embedded wallet.
  // Both must be true for swap execution. If authenticated but wallet is null,
  // Privy is still creating/loading the wallet - treat as "connected" to avoid
  // flashing "Connect Wallet" to a logged-in user.
  //
  // EVM wallets come from the main useWallets(); Solana wallets from the
  // /solana subpath hook (v3 SDK split). The Solana embedded wallet is the
  // standard-wallet entry whose backing wallet is Privy's.
  const isSolana = (payToken?.chainId === 'solana') ||
    (mode === 'sell' && token?.networkId === 1399811149)
  const embeddedEvm = wallets.find(w => w.walletClientType === 'privy' && w.chainType === 'ethereum')
    || wallets.find(w => w.walletClientType === 'privy')
  // Select the Solana standard wallet by the CURRENT user's linked embedded
  // address - the wallet-standard registry can retain a Privy entry from a
  // PREVIOUS session/account in the same page context, and asking Privy to
  // connect a wallet the current user doesn't own fails with "User must be
  // authenticated and have a Privy wallet before it can be connected".
  const expectedSolAddress = user?.linkedAccounts?.find(
    (a) => a.type === 'wallet' && a.chainType === 'solana' && a.walletClientType === 'privy'
  )?.address || null
  const embeddedSolana = (expectedSolAddress && solanaWallets.find(w => w.address === expectedSolAddress))
    || solanaWallets.find(w => w.standardWallet?.isPrivyWallet)
  const wallet = isSolana ? embeddedSolana : embeddedEvm

  // Live mirror of the selected wallet. An in-flight doSwap holds a stale
  // closure - the ref lets it (and getSwapParams) see the wallet the moment
  // Privy hydrates it, instead of erroring on click-right-after-refresh.
  const walletRef = useRef(wallet)
  useEffect(() => { walletRef.current = wallet }, [wallet])

  // Cached embedded-wallet addresses (public data): balances start fetching
  // at t=0 on a page refresh instead of waiting 2-5s for SDK hydration. The
  // cache applies while Privy is still booting (!ready) or when the session
  // is confirmed; a confirmed signed-out state clears it below.
  const bootCache = useRef(readWalletCache()).current
  const cacheUsable = !ready || authenticated
  const effectiveSolAddr = embeddedSolana?.address || (cacheUsable ? bootCache?.sol : null) || null
  const effectiveEvmAddr = embeddedEvm?.address || (cacheUsable ? bootCache?.evm : null) || null

  useEffect(() => {
    if (!ready) return
    if (!authenticated) {
      clearWalletCache()
      return
    }
    const sol = embeddedSolana?.address || null
    const evm = embeddedEvm?.address || null
    if (sol || evm) writeWalletCache({ did: user?.id, sol, evm })
  }, [ready, authenticated, embeddedSolana?.address, embeddedEvm?.address, user?.id])

  // Optimistic during boot when a cached wallet exists - the panel renders
  // its connected state (balances, chips) instantly; a confirmed logged-out
  // session flips this false as soon as Privy is ready.
  const walletConnected = (authenticated && ready) || (!ready && !!(bootCache?.sol || bootCache?.evm))
  const walletReady = !!wallet

  // Fetch balances for the pay-side chain so we can show "Insufficient balance".
  // Keyed on the EFFECTIVE address (hydrated wallet or boot cache) so the
  // read starts immediately after a refresh.
  const payChainId = payToken?.chainId || 'ethereum'
  const balanceAddress = isSolana ? effectiveSolAddr : effectiveEvmAddr
  const { balances: walletBalances, refetch: refetchWalletBalances } = useWalletBalances(
    balanceAddress,
    isSolana ? 'solana' : payChainId,
  )
  // Find the balance of the buy-side pay token (SOL / ETH / USDC ...)
  const buySideBalance = (() => {
    if (!walletBalances.length) return 0
    const payAddr = payToken?.address
    if (!payAddr || payAddr === 'native') {
      // Native token (ETH, SOL, BNB)
      const native = walletBalances.find(b => b.isNative)
      return native?.balance || 0
    }
    // ERC-20 / SPL token
    const match = walletBalances.find(b =>
      b.contractAddress?.toLowerCase() === payAddr.toLowerCase() ||
      b.mintAddress === payAddr
    )
    return match?.balance || 0
  })()

  // In SELL mode the pay side is the PAGE token - an arbitrary mint/contract
  // that the COMMON_TOKENS-based balances feed never carries, so the lookup
  // above would return the wrong asset (the buy currency). Read the token's
  // own balance directly; re-read after a completed swap so MAX stays honest.
  const [sellTokenBalance, setSellTokenBalance] = useState(0)
  // Real on-chain decimals for the sell token. The page-token object's decimals
  // are frequently wrong/missing (Codex value dropped in resolution -> default
  // 18); using them made a SELL of a 9-decimal token ask for 10^9x too many
  // tokens -> TRANSFER_FROM_FAILED. null until read; getSwapParams falls back to
  // token.decimals when null (EVM only - Solana decimals come from resolution).
  const [sellTokenDecimals, setSellTokenDecimals] = useState(null)
  // EXACT raw on-chain balance (BigInt, base units). The displayed balance is a
  // float that ROUNDS for large-supply / high-decimal tokens, so MAX fills a
  // value slightly ABOVE the true amount -> the sell asks for more base units
  // than you hold -> TRANSFER_FROM_FAILED. getSwapParams clamps a sell to this.
  const [sellTokenBalanceRaw, setSellTokenBalanceRaw] = useState(null)
  useEffect(() => {
    let cancelled = false
    const addr = balanceAddress
    const tokenAddr = token?.address
    // Clear FIRST, on every re-run. This effect also re-runs when the TRADED
    // TOKEN changes, and the reads below are async - so the previous token's
    // balance would sit in state until they land. `sellTokenBalanceRaw` clamps
    // the sell amount inside getSwapParams, so token A's balance must never be
    // in a position to size a token B trade. (RightPanel used to be remounted
    // per token, which hid this; it now updates in place.)
    setSellTokenBalance(0)
    setSellTokenDecimals(null)
    setSellTokenBalanceRaw(null)
    if (mode !== 'sell' || !addr || !tokenAddr) return undefined
    const chainSlug = isSolana ? 'solana' : (payToken?.chainId || 'ethereum')
    getTokenBalance(addr, chainSlug, tokenAddr)
      .then((bal) => { if (!cancelled) setSellTokenBalance(bal || 0) })
      .catch(() => { if (!cancelled) setSellTokenBalance(0) })
    if (!isSolana) {
      getTokenDecimals(chainSlug, tokenAddr)
        .then((d) => { if (!cancelled && Number.isFinite(d)) setSellTokenDecimals(d) })
        .catch(() => {})
      getErc20BalanceRaw(tokenAddr, addr, chainSlug)
        .then((raw) => { if (!cancelled && raw != null) setSellTokenBalanceRaw(raw) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [mode, balanceAddress, token?.address, isSolana, payToken?.chainId, swapSuccess])

  // What the swap panel treats as "balance of the thing being sold/paid"
  const payTokenBalance = mode === 'sell' ? sellTokenBalance : buySideBalance

  // Resolve input/output tokens based on mode. buildSwapParams (lib/swapParams)
  // owns the chain resolution AND the cross-chain guard: mismatched pay/target
  // chains return { error } instead of params - quoting across chains sends
  // the other side's ADDRESS to a single-chain aggregator, which can resolve
  // to a completely different token on that chain.
  // withTaker=false builds a DISPLAY quote (no userAddress) - the server
  // then uses the fast indicative path (0x /price, Jupiter quote-only) with
  // NO calldata / permit2 / on-chain allowance simulation. That per-keystroke
  // build was the 5-7s "Getting quote" on sells. withTaker=true builds the
  // EXECUTABLE quote (real tx) - used only at click time via doSwap's
  // self-heal, which already re-quotes any tx-less quote before signing.
  const getSwapParams = useCallback((amount, { withTaker = false } = {}) => {
    // For a SELL, correct the sell token's decimals with the real on-chain value.
    // The page token's decimals default to 18 when the Codex value is dropped in
    // resolution, which makes the base amount 10^(18-realDec)x too large and the
    // swap reverts with TRANSFER_FROM_FAILED.
    const sellTok = (mode === 'sell' && Number.isFinite(sellTokenDecimals))
      ? { ...token, decimals: sellTokenDecimals }
      : token
    const result = buildSwapParams({
      token: sellTok,
      payToken,
      mode,
      amount,
      slippageBps,
      userAddress: withTaker ? walletRef.current?.address : undefined,
    })
    // Clamp a SELL to the EXACT raw on-chain balance. MAX fills the float
    // balance, which for a large-supply / high-decimal token rounds slightly
    // ABOVE the true amount, so the base-unit sell exceeds what you hold ->
    // TRANSFER_FROM_FAILED. Selling exactly the raw balance always succeeds.
    if (result?.params && mode === 'sell' && sellTokenBalanceRaw != null) {
      try {
        if (BigInt(result.params.amount) > sellTokenBalanceRaw) {
          result.params.amount = sellTokenBalanceRaw.toString()
        }
      } catch { /* leave the amount untouched on any BigInt parse issue */ }
    }
    return result
  }, [token, payToken, mode, slippageBps, sellTokenDecimals, sellTokenBalanceRaw])

  /**
   * Fetch a swap quote. Debounced to avoid hammering the API on every keystroke.
   * Returns the output amount as a human-readable string.
   */
  const fetchQuote = useCallback((amount, opts = {}) => {
    // Clear previous debounce and abort in-flight request
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()
    lastQuoteAmountRef.current = amount

    // Reset on empty amount
    if (!amount || parseFloat(amount) <= 0) {
      setQuote(null)
      setQuoteError(null)
      setQuoteLoading(false)
      return
    }

    // Background refreshes (the 25s keep-alive) must not flip the visible
    // "Getting quote" state - the panel would flicker while the user idles.
    if (!opts.background) setQuoteLoading(true)
    setQuoteError(null)

    debounceRef.current = setTimeout(async () => {
      const built = getSwapParams(amount)
      if (built.error) {
        // Cross-chain pay/target mismatch (or unparseable amount) - never
        // send this to the aggregator; tell the user what to change.
        setQuote(null)
        setQuoteError(built.error)
        setQuoteLoading(false)
        return
      }
      const params = built.params
      if (!params) {
        setQuoteLoading(false)
        return
      }

      // Create fresh AbortController for this request
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const result = await getSwapQuote(params, controller.signal)
        // Only update state if this request wasn't aborted
        if (!controller.signal.aborted) {
          setQuote(result)
          setQuoteError(null)
        }
      } catch (err) {
        // Aborted (superseded by a newer quote) OR the 8s timeout fired.
        if (controller.signal.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') return
        console.error('[useSwapExecution] Quote error:', err)
        setQuote(null)
        setQuoteError(err.message || 'Failed to get quote')
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false)
      }
    // The debounce exists for KEYSTROKES. Programmatic fills (% chips, MAX,
    // mode flip, wallet arrival, keep-alive refresh) are single deliberate
    // events - make them quote instantly via opts.immediate.
    }, opts.immediate ? 0 : QUOTE_DEBOUNCE_MS)
  }, [getSwapParams])

  /**
   * Get the output amount from the current quote as a human-readable string.
   */
  const outputAmount = (() => {
    if (!quote) return ''
    const outputToken = mode === 'buy'
      ? { decimals: token?.decimals || 18 }
      : { decimals: payToken?.decimals || 18 }
    return fromSmallestUnit(quote.outputAmount, outputToken.decimals)
  })()

  /**
   * Execute the swap: sign tx with Privy wallet, submit on-chain, wait for confirmation.
   */
  const doSwap = useCallback(async (payAmount) => {
    // Synchronous re-entry guard. Must run BEFORE any await so a double-click
    // in the same React frame is caught by the second invocation reading the
    // already-true ref. setIsSwapping below is async and can't be relied on here.
    if (swapInFlightRef.current) {
      console.warn('[useSwapExecution] doSwap re-entry blocked - swap already in flight')
      return null
    }
    // Wallet may still be hydrating right after a page refresh. Hold the
    // button busy and proceed the moment the embedded wallet lands (up to
    // 12s - covers slow Privy hydration on a cold load) instead of bouncing
    // the click. `authenticated` gates the button, so reaching here always
    // means "logged in, wallet object not ready yet", never "signed out".
    if (!walletRef.current) {
      // Deferred-Privy money-path: the SDK now lazy-mounts (lib/privy-boundary).
      // If a swap fires before it mounted (e.g. authed returning user on a slow
      // connection who clicked before the ~100ms fast-mount finished), pull the
      // real provider in NOW so the wait below actually resolves — never a
      // silent no-op. Idempotent; a no-op once mounted.
      requestPrivyMount('login')
      swapInFlightRef.current = true
      setIsSwapping(true)
      const hydrateDeadline = Date.now() + 12000
      while (!walletRef.current && Date.now() < hydrateDeadline) {
        await new Promise(r => setTimeout(r, 150))
      }
      swapInFlightRef.current = false
      setIsSwapping(false)
      if (!walletRef.current) {
        // Privy's useWallets() never repopulated - almost always a stale SDK
        // state (e.g. after hot-reload / long idle). A full reload rehydrates
        // it cleanly; a bare "try again" would just loop.
        setSwapError('Wallet not ready - please refresh the page and try again')
        return null
      }
    }
    if (!quote) {
      setSwapError('Get a quote first')
      return null
    }

    // Guard against stale quote: verify the quote's tokens still match current state
    const expectedInput = mode === 'buy' ? (payToken?.address || 'native') : (token?.address || 'native')
    const expectedOutput = mode === 'buy' ? (token?.address || 'native') : (payToken?.address || 'native')
    if (
      normTokenId(quote.inputToken) !== normTokenId(expectedInput) ||
      normTokenId(quote.outputToken) !== normTokenId(expectedOutput)
    ) {
      setSwapError('Quote expired - enter your amount again')
      setQuote(null)
      return null
    }

    // Hard block on excessive price impact. The aggregator may return a quote
    // that satisfies the slippage tolerance but still loses the user significant
    // value to a thin pool or a sandwich-bot trap. We refuse to sign without
    // explicit re-confirmation (here: returning the user back to the input
    // with a specific error message so they can lower size or cancel).
    const impact = parsePriceImpact(quote)
    if (impact != null && impact > MAX_PRICE_IMPACT_PCT) {
      setSwapError(`Price impact too high (${impact.toFixed(2)}%) - reduce size or pick a more liquid pair`)
      return null
    }

    // NOTE: the session-liveness gate (await getAccessToken() before signing)
    // moved to the CATCH below - it blocked every swap's happy path on a
    // Privy round trip to defend against a rare zombie-session state that is
    // now diagnosed only when signing actually fails with that signature.

    swapInFlightRef.current = true
    setIsSwapping(true)
    setSwapError(null)
    setTxHash(null)

    // Notional in USD from the input side: buys pay in payToken, sells pay in
    // the traded token. Best-effort - null when no live price (never fabricate).
    const startInputPrice = mode === 'buy' ? payToken?.price : token?.price
    const startUsd = startInputPrice > 0 ? (parseFloat(payAmount) || 0) * startInputPrice : null
    track(Events.SWAP_STARTED, {
      side: mode,
      from_token: mode === 'buy' ? payToken?.symbol : token?.symbol,
      to_token: mode === 'buy' ? token?.symbol : payToken?.symbol,
      from_token_address: (mode === 'buy' ? payToken?.address : token?.address) || 'native',
      to_token_address: (mode === 'buy' ? token?.address : payToken?.address) || 'native',
      token_symbol: token?.symbol || null,
      token_name: token?.name || null,
      token_address: token?.address || null,
      amount: payAmount,
      amount_usd: startUsd != null && Number.isFinite(startUsd) ? Number(startUsd.toFixed(2)) : null,
      price_impact: impact,
      chain: quote.chain,
      provider: quote.provider,
    })

    try {
      // Self-heal: a quote fetched before the wallet hydrated carries no built
      // transaction (no userAddress at quote time - Solana gets no
      // swapTransaction, EVM display quotes come from 0x /price with no
      // calldata). Rather than dead-ending, re-quote inline with the address
      // and re-run the impact guard. The aggregator's min-out still enforces
      // the user's slippage setting on-chain.
      let execQuote = quote
      const missingTx = quote.chain === 'solana' ? !quote.swapTransaction : !quote.transaction
      if (missingTx) {
        const rebuilt = getSwapParams(payAmount, { withTaker: true })
        if (rebuilt.error || !rebuilt.params) {
          throw new Error(rebuilt.error || 'Quote expired - enter your amount again')
        }
        const fresh = await getSwapQuote(rebuilt.params)
        if (
          !fresh ||
          normTokenId(fresh.inputToken) !== normTokenId(expectedInput) ||
          normTokenId(fresh.outputToken) !== normTokenId(expectedOutput)
        ) {
          throw new Error('Quote expired - enter your amount again')
        }
        const freshImpact = parsePriceImpact(fresh)
        if (freshImpact != null && freshImpact > MAX_PRICE_IMPACT_PCT) {
          throw new Error(`Price impact too high (${freshImpact.toFixed(2)}%) - reduce size or pick a more liquid pair`)
        }
        execQuote = fresh
        setQuote(fresh)
      }

      // Display metadata for the swap-history row - the frontend has symbols,
      // decimals, side and USD here; the raw addresses + base units logged
      // otherwise can never be formatted correctly downstream.
      const inTok = mode === 'buy' ? payToken : token
      const outTok = mode === 'buy' ? token : payToken
      const nativeDec = isSolana ? 9 : 18
      const payDec = Number.isFinite(payToken?.decimals) ? payToken.decimals : nativeDec
      let usd = null
      if (payToken?.price > 0) {
        usd = mode === 'buy'
          ? (parseFloat(payAmount) || 0) * payToken.price
          : (Number(execQuote.outputAmount) / 10 ** payDec) * payToken.price
      }
      const logMeta = {
        side: mode,
        inputSymbol: inTok?.symbol || null,
        outputSymbol: outTok?.symbol || null,
        inputDecimals: Number.isFinite(inTok?.decimals) ? inTok.decimals : nativeDec,
        outputDecimals: Number.isFinite(outTok?.decimals) ? outTok.decimals : nativeDec,
        inputLogo: inTok?.logo || inTok?.icon || null,
        outputLogo: outTok?.logo || outTok?.icon || null,
        tokenSymbol: token?.symbol || null,
        tokenAddress: token?.address || null,
        usd: usd != null && Number.isFinite(usd) ? Number(usd.toFixed(2)) : null,
      }

      // Success/in-flight summary from the EXECUTED quote's real amounts (NOT
      // pre-click UI state, which could be empty at click time and showed
      // "0 Kimchiloq ~$0"). Set now so the in-flight strip shows the real
      // pair too; USD is the trade value applied to both sides so they agree.
      const inDec = Number.isFinite(inTok?.decimals) ? inTok.decimals : nativeDec
      const outDec = Number.isFinite(outTok?.decimals) ? outTok.decimals : nativeDec
      setSwapSummary({
        fromValue: Number(execQuote.inputAmount) / 10 ** inDec,
        fromSymbol: inTok?.symbol || '',
        fromUsd: usd || 0,
        toValue: Number(execQuote.outputAmount) / 10 ** outDec,
        toSymbol: outTok?.symbol || '',
        toUsd: usd || 0,
      })

      // Fresh Privy access token for the authed history-log call (the module
      // cache in profileSync is often empty - don't depend on it).
      const authToken = await getAccessToken().catch(() => null)

      // Pre-flight balance guard for EVM sells. The DISPLAYED balance can be
      // stale (Codex indexer lag / a tab that hasn't refreshed), and selling more
      // than the wallet actually holds reverts on-chain with TRANSFER_FROM_FAILED
      // - burning gas and showing a confusing "reverted" error. Read the REAL
      // balance and block BEFORE broadcasting. 0.5% tolerance so a legit MAX sell
      // never false-blocks on dust rounding; best-effort so a read failure never
      // blocks a valid sell.
      if (mode === 'sell' && execQuote.chain !== 'solana' && execQuote.inputToken && execQuote.inputToken !== 'native') {
        try {
          const realRaw = await getErc20BalanceRaw(execQuote.inputToken, walletRef.current.address, execQuote.chain)
          if (realRaw != null && realRaw * 1000n < BigInt(execQuote.inputAmount) * 995n) {
            const held = Number(realRaw) / 10 ** inDec
            throw new Error(`Balance updated - you hold ${held.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${inTok?.symbol || 'tokens'} now, less than this sell. Tap MAX or re-enter the amount.`)
          }
        } catch (e) {
          if (/Balance updated/.test(e?.message || '')) throw e
          // read failed (RPC blip) - do NOT block a legitimate sell
        }
      }

      // Sign and send via Privy wallet (through the ref - the click-time
      // closure can predate hydration)
      const hash = await execSwap(walletRef.current, execQuote, { solanaSignAndSend, solanaSignOnly, logMeta, authToken })
      setTxHash(hash)

      // Wait for on-chain confirmation
      let receipt
      try {
        receipt = await waitForConfirmation(hash, execQuote.chain, 60000)
      } catch (confErr) {
        if (/confirmation timeout/i.test(confErr?.message || '')) {
          // Extended pending window. Releasing the in-flight guard on a mere
          // timeout reopened the DOUBLE-SWAP hole: the tx can still land from
          // the mempool while the user re-clicks. Keep the button locked and
          // keep polling for up to 4 more minutes before giving up.
          receipt = await waitForConfirmation(hash, execQuote.chain, 240000).catch(() => null)
          if (!receipt) {
            throw new Error(`Transaction still pending - check the explorer for ${hash.slice(0, 10)}... before retrying`)
          }
        } else {
          throw confErr
        }
      }

      if (receipt.confirmed === false) {
        // Jupiter anchor error 6001 = SlippageToleranceExceeded: the price
        // moved past the tolerance between quote and execution - by far the
        // most common on-chain failure on fresh low-liquidity tokens.
        const errStr = JSON.stringify(receipt.error || '')
        if (errStr.includes('6001')) {
          throw new Error('Price moved beyond your slippage tolerance - nothing was traded. Try again.')
        }
        // A confirmed-but-reverted swap means the router aborted. The receipt
        // alone can't tell us WHY (thin liquidity, the price/route moved between
        // quote and execution, a stale allowance, or - rarely - a token with its
        // own transfer restriction), so stay honest and actionable rather than
        // blaming the token. (An earlier version asserted "this token blocked the
        // sale / honeypot / anti-whale" - that was wrong for legit thin-liquidity
        // tokens whose sells revert on stale quotes; do NOT reintroduce it without
        // an actual token-security signal to back the claim.)
        throw new Error('The swap reverted on-chain - nothing was traded. Liquidity may be thin or the quote went stale. Try again, or reduce the amount.')
      }

      // Balances moved on-chain a moment ago - pull them NOW instead of letting
      // the user stare at pre-trade numbers for up to the 15s poll interval.
      // This hook previously took only `balances` from useWalletBalances, so
      // the Buy/Sell panel showed stale figures right after a fill, which reads
      // as "did my trade work?". Fire-and-forget: a failed refresh must never
      // turn a landed swap into an error.
      try { refetchWalletBalances?.() } catch { /* next poll tick covers it */ }

      // CONFIRMED SUCCESSFUL on-chain now - record locally (full detail) so the
      // token's transaction table shows YOUR trade before Codex indexes it, and
      // regardless of the 0x / Jupiter maker attribution (the on-chain maker is
      // the router, not your wallet). MUST be after confirmation: injecting on
      // broadcast left a PHANTOM row when the swap then reverted (e.g. selling a
      // stale balance you no longer hold). Deduped by hash once the feed catches up.
      try {
        const tokenAmt = mode === 'buy'
          ? (Number(execQuote.outputAmount) / 10 ** outDec)
          : (Number(execQuote.inputAmount) / 10 ** inDec)
        const ethAmt = mode === 'buy'
          ? (Number(execQuote.inputAmount) / 10 ** inDec)
          : (Number(execQuote.outputAmount) / 10 ** outDec)
        recordSpectreSwap({
          hash,
          type: mode === 'buy' ? 'Buy' : 'Sell',
          address: token?.address,
          networkId: token?.networkId,
          amount: tokenAmt,
          price: (tokenAmt > 0 && usd) ? usd / tokenAmt : (token?.price || 0),
          usd: usd || 0,
          eth: ethAmt,
          maker: walletRef.current?.address || null,
        })
      } catch { markSpectreSwap(hash) }

      // Full trade record for the analytics dashboard: symbols + CAs + real
      // executed amounts + USD notional (same `usd` the history log uses).
      // Fee is 1% of notional by design (fee-split system) - derivable in
      // SQL from amount_usd, so not duplicated here.
      track(Events.SWAP_COMPLETED, {
        tx_hash: hash,
        side: mode,
        from_token: inTok?.symbol || null,
        to_token: outTok?.symbol || null,
        from_token_address: (mode === 'buy' ? payToken?.address : token?.address) || 'native',
        to_token_address: (mode === 'buy' ? token?.address : payToken?.address) || 'native',
        token_symbol: token?.symbol || null,
        token_name: token?.name || null,
        token_address: token?.address || null,
        amount: Number(execQuote.inputAmount) / 10 ** inDec,
        output_amount: Number(execQuote.outputAmount) / 10 ** outDec,
        amount_usd: usd != null && Number.isFinite(usd) ? Number(usd.toFixed(2)) : null,
        chain: execQuote.chain,
        provider: execQuote.provider,
      })

      setIsSwapping(false)
      swapInFlightRef.current = false
      setSwapSuccess(true)

      // Reset success state after 8s - long enough to read the traded pair
      // + USD without feeling stuck.
      setTimeout(() => {
        setSwapSuccess(false)
        setTxHash(null)
        setQuote(null)
        setSwapSummary(null)
      }, 8000)

      return hash
    } catch (err) {
      console.error('[useSwapExecution] Swap failed:', err)
      setIsSwapping(false)
      swapInFlightRef.current = false

      // Zombie-session diagnosis. `authenticated` can be true from CACHED
      // state while the stored tokens are gone (the SDK wipes them on any
      // refresh failure but leaves the user object) - the failure only shows
      // at signing, as Privy's cryptic "Failed to connect to wallet" /
      // "must be authenticated". Only then is the token checked and a clean
      // re-login forced - this used to be a blocking pre-check on EVERY swap.
      if (/failed to connect to wallet|must be authenticated/i.test(err?.message || '')) {
        const liveToken = await getAccessToken().catch(() => null)
        if (!liveToken) {
          setSwapError('Session expired - please sign in again')
          // In server-cookie mode (custom auth domain) the logout endpoint
          // 400s cross-site and the SDK stays "logged in" - login() then
          // throws "already logged in" and jams the recovery.
          try { await logout() } catch { /* server logout can 400 cross-site */ }
          try { login() } catch {
            setSwapError('Session is stuck - use the profile menu to sign out, then sign in again')
          }
          setTimeout(() => setSwapError(null), 5000)
          return null
        }
      }

      setSwapError(err.message || 'Swap failed')

      track(Events.SWAP_FAILED, {
        error: err.message,
        side: mode,
        from_token: mode === 'buy' ? payToken?.symbol : token?.symbol,
        to_token: mode === 'buy' ? token?.symbol : payToken?.symbol,
        token_symbol: token?.symbol || null,
        token_address: token?.address || null,
        amount_usd: (() => {
          const p = mode === 'buy' ? payToken?.price : token?.price
          const u = p > 0 ? (parseFloat(payAmount) || 0) * p : null
          return u != null && Number.isFinite(u) ? Number(u.toFixed(2)) : null
        })(),
        provider: quote.provider,
        chain: quote.chain,
      })

      // Clear error after 5s
      setTimeout(() => setSwapError(null), 5000)
      return null
    }
  }, [wallet, quote, mode, payToken, token, solanaSignAndSend, solanaSignOnly, getAccessToken, login, logout, getSwapParams])

  // ── Token-change reset ─────────────────────────────────────────────────────
  // App.jsx used to remount RightPanel - and therefore this hook - on every
  // token click via `key={token.address || token.symbol}`. That key is gone
  // (the panel updates in place now), so the reset has to be explicit.
  // Without it a quote priced for token A survives into token B and renders as
  // a real Receive amount. doSwap's staleness guard would still refuse to SIGN
  // it, but a money surface must never DISPLAY another token's numbers either.
  //
  // `address || symbol` mirrors the identity the old key used, so address-less
  // majors (BTC/ETH via CoinGecko, whose address resolves to 'native') still
  // separate. networkId is part of it because one address can exist on two
  // chains, and the same address on a different chain is a different asset.
  const tradedTokenKey = `${token?.networkId ?? ''}:${token?.address || token?.symbol || ''}`
  useEffect(() => {
    // Kill what is already in flight for the previous token FIRST: a quote
    // response landing after the reset would re-poison the state it just
    // cleared (the abort makes fetchQuote's handler bail on `signal.aborted`).
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()
    lastQuoteAmountRef.current = null
    setQuote(null)
    setQuoteLoading(false)
    setQuoteError(null)
    setSwapError(null)
    setSwapSuccess(false)
    setSwapSummary(null)
    setTxHash(null)
    // Deliberately NOT reset: `isSwapping` / `swapInFlightRef`. A signed
    // transaction is on-chain regardless of which token the user is now
    // looking at; clearing them would unlock the button while it lands and
    // reopen the double-submit hole. The in-flight strip keeps rendering,
    // which is honest - it names its own symbols.
  }, [tradedTokenKey])

  // Re-quote when the signing wallet hydrates. A quote fetched while Privy was
  // still loading has NO userAddress, so the server returns price data without
  // a built transaction (Solana swapTransaction / real EVM taker) and signing
  // dead-ends with "No swap transaction in quote". When the wallet lands (or
  // the user switches accounts), silently refresh the active quote so it
  // always carries an executable tx for the right address.
  useEffect(() => {
    const amt = lastQuoteAmountRef.current
    if (wallet?.address && amt && parseFloat(amt) > 0) {
      fetchQuote(amt, { immediate: true })
    }
    // getSwapParams reads the address through walletRef at execution time, so
    // the re-quote here always carries the just-hydrated wallet. Deps stay
    // address-only on purpose - token/mode/amount changes re-quote elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address])

  // Cleanup debounce and abort in-flight requests on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  return {
    // Wallet state
    walletConnected,   // true if user is authenticated via Privy
    walletReady,       // true if embedded wallet object is available for signing
    walletAddress: wallet?.address || embeddedEvm?.address || embeddedSolana?.address || null,
    payTokenBalance,   // balance of the pay token in user's wallet

    // Quote state
    quote,
    quoteLoading,
    quoteError,
    outputAmount,
    fetchQuote,
    // Builds the { params, error } for a quote/simulation from the CURRENT
    // token/mode/amount without needing a live display quote - lets the Simulate
    // button run on any token you can enter an amount for (thin/no-quote tokens
    // are exactly where you want it).
    getSwapParams,

    // Swap execution state
    isSwapping,
    swapSuccess,
    swapSummary,
    swapError,
    txHash,
    doSwap,

    // Fee info from quote
    platformFee: quote?.platformFee || null,
    // Normalized to PERCENT via parsePriceImpact (handles Jupiter fraction
    // encoding "0.0234"=2.34% vs 0x percent encoding). Returning the RAW
    // priceImpactPct understated Jupiter impact 100x in the UI.
    priceImpact: quote ? parsePriceImpact(quote) : null,
    routePlan: quote?.routePlan || null,
  }
}
