/**
 * Wallets section - institutional portfolio display.
 * Non-custodial embedded wallets with multi-chain support.
 * Buy: Privy on-ramp (MoonPay/Stripe) to purchase crypto with card.
 * Receive: Show wallet address + QR to receive crypto from another wallet.
 * Send: Transfer any token to any address via Privy wallet signing.
 *
 * Privy wallet hooks (useWallets, useConnectWallet, useFundWallet,
 * useSendTransaction) are NOT called here directly — the real PrivyProvider
 * mounts in a sibling branch (not as an ancestor of the app), so calling those
 * SDK hooks here would throw. Instead we read the bridged equivalents from
 * SafePrivyContext (useWalletsSafe + usePrivyActions), which RealPrivyBridge
 * populates once the provider mounts. Keeps @privy-io/react-auth OFF the entry
 * path AND off this page entirely. See lib/use-privy-safe.jsx.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useWalletsSafe, usePrivyActions } from '@/lib/use-privy-safe'
import { useTranslation } from 'react-i18next'
import { validateWithdrawAddress } from '@/services/walletService'
import { buildWithdrawTx, toBaseUnits } from '@/lib/withdrawTx'
import UdDepositPanel from './ud-deposit-panel'

// -- SVG chain icons (inline for instant render, no network request) --

const EthereumIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 256 417" className={className} fill="none">
    <path d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" fill="#343434" />
    <path d="M127.962 0L0 212.32l127.962 75.639V154.158z" fill="#8C8C8C" />
    <path d="M127.961 312.187l-1.575 1.92V414.6l1.575 4.6L256 236.587z" fill="#3C3C3B" />
    <path d="M127.962 419.2V312.187L0 236.587z" fill="#8C8C8C" />
    <path d="M127.961 287.958l127.96-75.637-127.96-58.162z" fill="#141414" />
    <path d="M0 212.32l127.96 75.639V154.159z" fill="#393939" />
  </svg>
)

const SolanaIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 397 312" className={className} fill="none">
    <linearGradient id="sol-a" x1="360" y1="11" x2="141" y2="330" gradientUnits="userSpaceOnUse">
      <stop stopColor="#00FFA3" />
      <stop offset="1" stopColor="#DC1FFF" />
    </linearGradient>
    <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sol-a)" />
    <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#sol-a)" />
    <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#sol-a)" />
  </svg>
)

const BaseIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 111 111" className={className} fill="none">
    <circle cx="55.5" cy="55.5" r="55.5" fill="#0052FF" />
    <path d="M55.4 93.5c21 0 38-17 38-38s-17-38-38-38c-19.6 0-35.7 14.8-37.8 33.8h50.5v8.4H17.6c2.1 19 18.2 33.8 37.8 33.8z" fill="#fff" />
  </svg>
)

const PolygonIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 38 33" className={className} fill="none">
    <path d="M28.8 12.3c-.8-.5-1.8-.5-2.5 0l-5.8 3.4-3.9 2.2-5.7 3.4c-.8.5-1.8.5-2.5 0l-4.5-2.7c-.8-.5-1.3-1.3-1.3-2.2v-5.2c0-.9.4-1.8 1.3-2.2L8.3 6.3c.8-.5 1.8-.5 2.5 0l4.5 2.7c.8.5 1.3 1.3 1.3 2.2v3.4l3.9-2.3V8.9c0-.9-.4-1.8-1.3-2.2L12.5 2c-.8-.5-1.8-.5-2.5 0L3.1 6.7c-.8.5-1.3 1.3-1.3 2.2v9.5c0 .9.4 1.8 1.3 2.2l6.8 3.9c.8.5 1.8.5 2.5 0l5.7-3.3 3.9-2.3 5.7-3.3c.8-.5 1.8-.5 2.5 0l4.5 2.6c.8.5 1.3 1.3 1.3 2.2v5.2c0 .9-.4 1.8-1.3 2.2l-4.4 2.6c-.8.5-1.8.5-2.5 0l-4.5-2.6c-.8-.5-1.3-1.3-1.3-2.2v-3.3l-3.9 2.3v3.4c0 .9.4 1.8 1.3 2.2l6.8 3.9c.8.5 1.8.5 2.5 0l6.8-3.9c.8-.5 1.3-1.3 1.3-2.2v-9.5c0-.9-.4-1.8-1.3-2.2l-6.9-4.1z" fill="#8247E5" />
  </svg>
)

const ArbitrumIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" className={className} fill="none">
    <circle cx="20" cy="20" r="20" fill="#213147" />
    <path d="M22.8 10.6l-8.4 13.2 3.6 5.6 11.4-17.8-6.6-1zM28.2 25l-3 4.7 3.5 2.2 3.5-5.5L28.2 25z" fill="#28A0F0" />
    <path d="M14.4 23.8L11.8 28l4 2.4L18 26l-3.6-2.2zm13.8 1.2l-6.6-1-3 4.7 6.6 1 3-4.7z" fill="#fff" />
  </svg>
)

const BscIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none">
    <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
    <path d="M12.1 14.5L16 10.6l3.9 3.9 2.3-2.3L16 6l-6.2 6.2 2.3 2.3zm-6.1 1.5l2.3-2.3 2.3 2.3-2.3 2.3L6 16zm6.1 1.5L16 21.4l3.9-3.9 2.3 2.3L16 26l-6.2-6.2 2.3-2.3zM23.7 16l2.3-2.3 2.3 2.3-2.3 2.3L23.7 16zM18.3 16L16 13.7 13.7 16 16 18.3 18.3 16z" fill="#fff" />
  </svg>
)

// All supported networks - EVM chains share one wallet address, Solana is separate
const NETWORKS = [
  { id: 'ethereum', label: 'Ethereum', shortLabel: 'ETH', walletType: 'ethereum', color: '#627eea', IconComponent: EthereumIcon },
  { id: 'base', label: 'Base', shortLabel: 'Base', walletType: 'ethereum', color: '#0052FF', IconComponent: BaseIcon },
  { id: 'polygon', label: 'Polygon', shortLabel: 'Poly', walletType: 'ethereum', color: '#8247E5', IconComponent: PolygonIcon },
  { id: 'arbitrum', label: 'Arbitrum', shortLabel: 'Arb', walletType: 'ethereum', color: '#28A0F0', IconComponent: ArbitrumIcon },
  { id: 'bsc', label: 'BNB Chain', shortLabel: 'BNB', walletType: 'ethereum', color: '#F3BA2F', IconComponent: BscIcon },
  { id: 'solana', label: 'Solana', shortLabel: 'SOL', walletType: 'solana', color: '#9945FF', IconComponent: SolanaIcon },
]

// Token-specific brand colors for balance badges
const TOKEN_COLORS = {
  ETH: '#627eea',
  SOL: '#9945FF',
  USDC: '#2775CA',
  USDT: '#26A17B',
  BNB: '#F3BA2F',
  MATIC: '#8247E5',
  WETH: '#627eea',
  WSOL: '#9945FF',
  DAI: '#F5AC37',
  WBTC: '#F7931A',
  ARB: '#28A0F0',
}

// Map token symbols to their chain icon components
const TOKEN_ICON_MAP = {
  ETH: EthereumIcon,
  WETH: EthereumIcon,
  SOL: SolanaIcon,
  WSOL: SolanaIcon,
  BNB: BscIcon,
  MATIC: PolygonIcon,
  ARB: ArbitrumIcon,
}

function truncateAddress(addr) {
  if (!addr) return ''
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr
}

function QrCanvas({ value, size = 160 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!value || !canvasRef.current) return
    let cancelled = false
    import('qrcode').then((QRCode) => {
      if (cancelled || !canvasRef.current) return
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
    }).catch(() => {
      if (!cancelled && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, size, size)
        ctx.fillStyle = '#999999'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('QR unavailable', size / 2, size / 2)
      }
    })
    return () => { cancelled = true }
  }, [value, size])

  return <canvas ref={canvasRef} width={size} height={size} className="ud-w-qr-canvas" />
}

function TokenPicker({ balances, selectedSymbol, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selected = balances.find((b) => b.symbol === selectedSymbol) || balances[0]
  const brandColor = TOKEN_COLORS[selected?.symbol] || 'rgba(255,255,255,0.3)'
  const SelectedIcon = TOKEN_ICON_MAP[selected?.symbol]

  return (
    <div className="ud-tp" ref={pickerRef}>
      <button
        type="button"
        className={`ud-tp-trigger${open ? ' is-open' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className="ud-tp-badge" style={{ '--token-color': brandColor }}>
          {SelectedIcon ? <SelectedIcon size={16} /> : <span className="ud-tp-letter">{selected?.symbol?.[0]}</span>}
        </span>
        <span className="ud-tp-symbol">{selected?.symbol}</span>
        <span className="ud-tp-bal">{parseFloat(selected?.balance || 0).toFixed(4)}</span>
        <svg className="ud-tp-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div className="ud-tp-dropdown">
          {balances.map((b) => {
            const color = TOKEN_COLORS[b.symbol] || 'rgba(255,255,255,0.3)'
            const Icon = TOKEN_ICON_MAP[b.symbol]
            const isSelected = b.symbol === selectedSymbol
            return (
              <button
                key={b.symbol}
                type="button"
                className={`ud-tp-option${isSelected ? ' is-selected' : ''}`}
                onClick={() => { onChange(b.symbol); setOpen(false) }}
              >
                <span className="ud-tp-badge" style={{ '--token-color': color }}>
                  {Icon ? <Icon size={16} /> : <span className="ud-tp-letter">{b.symbol[0]}</span>}
                </span>
                <span className="ud-tp-option-info">
                  <span className="ud-tp-symbol">{b.symbol}</span>
                  {b.isNative && <span className="ud-tp-native">native</span>}
                </span>
                <span className="ud-tp-option-bal">{parseFloat(b.balance).toFixed(4)}</span>
                {isSelected && (
                  <svg className="ud-tp-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bull)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WithdrawForm({ activeChain, balances, onWithdraw, onCancel }) {
  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    const native = balances.find((b) => b.isNative)
    return native?.symbol || (activeChain === 'solana' ? 'SOL' : 'ETH')
  })
  const [toAddress, setToAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Two-stage withdraw: form -> confirm. We never sign straight from the form
  // so the user gets one explicit irreversible-action checkpoint.
  const [confirming, setConfirming] = useState(false)

  const selectedToken = balances.find((b) => b.symbol === selectedSymbol) || balances[0]
  const availableBalance = selectedToken ? parseFloat(selectedToken.balance) : 0
  const activeNetworkLabel = NETWORKS.find((n) => n.id === activeChain)?.label || activeChain

  const handleMax = () => {
    if (!selectedToken) return
    if (selectedToken.isNative) {
      const reserve = activeChain === 'solana' ? 0.01 : 0.001
      const max = Math.max(0, availableBalance - reserve)
      setAmount(max > 0 ? max.toString() : '0')
    } else {
      setAmount(availableBalance.toString())
    }
  }

  // Stage 1: validate inputs + recipient address, then move to confirm.
  const handleReview = (e) => {
    e.preventDefault()
    setError('')
    if (!amount || parseFloat(amount) <= 0) { setError('Enter a valid amount'); return }
    if (parseFloat(amount) > availableBalance) { setError('Insufficient balance'); return }
    // Hard fund-safety gate: reject empty, malformed, and wrong-chain addresses
    // (e.g. a 0x EVM address pasted into a Solana withdrawal) before signing.
    const addrError = validateWithdrawAddress(toAddress, activeChain)
    if (addrError) { setError(addrError); return }
    setConfirming(true)
  }

  // Stage 2: user confirmed the destination + amount - actually sign and send.
  const handleConfirm = async () => {
    setError('')
    setSending(true)
    const result = await onWithdraw({ toAddress: toAddress.trim(), amount, token: selectedToken })
    setSending(false)
    if (result?.success) {
      setToAddress('')
      setAmount('')
      setConfirming(false)
      onCancel()
    } else {
      setError(result?.error || 'Transaction failed')
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="ud-w-withdraw-form">
        <div className="ud-w-field">
          <label className="ud-w-field-label">Amount</label>
          <div className="ud-w-confirm-value">{amount} {selectedToken?.symbol || ''}</div>
        </div>
        <div className="ud-w-field">
          <label className="ud-w-field-label">Network</label>
          <div className="ud-w-confirm-value">{activeNetworkLabel}</div>
        </div>
        <div className="ud-w-field">
          <label className="ud-w-field-label">To</label>
          <div className="ud-w-confirm-value ud-w-confirm-addr">{toAddress.trim()}</div>
        </div>
        <p className="ud-w-form-warn">Double-check the address. On-chain transfers are irreversible - funds sent to a wrong or wrong-chain address cannot be recovered.</p>
        {error && <p className="ud-w-form-error">{error}</p>}
        <div className="ud-w-form-actions">
          <button type="button" className="ud-w-send-btn" onClick={handleConfirm} disabled={sending}>
            {sending ? 'Sending...' : 'Confirm send'}
          </button>
          <button type="button" className="ud-w-cancel-btn" onClick={() => setConfirming(false)} disabled={sending}>Back</button>
        </div>
      </div>
    )
  }

  return (
    <form className="ud-w-withdraw-form" onSubmit={handleReview}>
      <div className="ud-w-field">
        <label className="ud-w-field-label">Token</label>
        <TokenPicker
          balances={balances}
          selectedSymbol={selectedSymbol}
          onChange={(sym) => { setSelectedSymbol(sym); setAmount('') }}
          disabled={sending}
        />
      </div>

      <div className="ud-w-field">
        <label className="ud-w-field-label">Recipient</label>
        <input
          type="text"
          className="ud-w-input"
          placeholder={activeChain === 'solana' ? 'Solana address...' : '0x...'}
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          disabled={sending}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="ud-w-field">
        <div className="ud-w-field-label-row">
          <label className="ud-w-field-label">Amount</label>
          <button type="button" className="ud-w-max-btn" onClick={handleMax} disabled={sending}>MAX</button>
        </div>
        <input
          type="number"
          className="ud-w-input"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={sending}
          min="0"
          step="any"
        />
      </div>

      {error && <p className="ud-w-form-error">{error}</p>}

      <div className="ud-w-form-actions">
        <button type="submit" className="ud-w-send-btn" disabled={sending}>Review withdrawal</button>
        <button type="button" className="ud-w-cancel-btn" onClick={onCancel} disabled={sending}>Cancel</button>
      </div>
    </form>
  )
}

// Wallet metadata for external wallet display
const EXT_WALLET_META = {
  metamask: { label: 'MetaMask', color: '#E2761B' },
  phantom: { label: 'Phantom', color: '#AB9FF2' },
  coinbase_wallet: { label: 'Coinbase', color: '#0052FF' },
  wallet_connect: { label: 'WalletConnect', color: '#3B99FC' },
  rainbow: { label: 'Rainbow', color: '#001E59' },
  zerion: { label: 'Zerion', color: '#2962EF' },
}

/**
 * Bridged Privy wallet hooks (from SafePrivyContext, not the SDK directly).
 * Returns the live wallet array + action callbacks once the sibling-mounted
 * PrivyProvider has bridged them in; before then, [] + no-ops. No try/catch
 * needed — these never throw (they read context, not the real provider).
 */
function usePrivyWalletHooks() {
  const privyWallets = useWalletsSafe()
  const { connectWallet, fundWallet, sendTransaction } = usePrivyActions()
  return { privyWallets, connectWallet, fundWallet, sendTransaction }
}

export default function UdWalletsSection({
  wallets, activeChain, onChainChange, balances, loading,
  onRefetch, onDeposit: _onDeposit, onWithdraw: _onWithdraw, fmtPrice, triggerCopyToast,
  externalWallets: _externalWallets = [], onConnectWallet: _onConnectWallet, onDisconnectWallet
}) {
  const { t } = useTranslation()
  const { privyWallets, connectWallet, fundWallet, sendTransaction } = usePrivyWalletHooks()

  // Synchronous re-entry guard for handleWithdraw. The Privy modal already
  // blocks UI input while a tx is in flight, but a fast double-click before
  // the modal opens (or a stuck modal that fails to render) can fire two
  // signing requests. The ref flips synchronously so the second invocation
  // returns early. Mirrors apps/trading/src/components/UserDashboard/UdWalletSection.jsx.
  const withdrawInFlightRef = useRef(false)

  // External wallets from live Privy hook (overrides parent's empty array)
  const [disconnectedAddrs, setDisconnectedAddrs] = useState([])
  const externalWallets = privyWallets
    .filter((w) => w.walletClientType !== 'privy' && !disconnectedAddrs.includes(w.address))
    .map((w) => ({
      address: w.address,
      chainType: w.chainType || 'ethereum',
      walletClientType: w.walletClientType,
    }))

  const EVM_CHAIN_IDS = { ethereum: 1, base: 8453, polygon: 137, arbitrum: 42161, bsc: 56 }

  // Resolve active wallet from props (embedded wallets come from parent's linkedAccounts)
  const activeNetwork = NETWORKS.find((n) => n.id === activeChain) || NETWORKS[0]
  const activeWalletFromProps = wallets.find((w) =>
    activeNetwork.walletType === 'solana' ? w.chainType === 'solana' : w.chainType === 'ethereum'
  ) || null

  const handleConnectWallet = useCallback(() => {
    try {
      connectWallet({
        walletList: ['metamask', 'phantom', 'coinbase_wallet', 'wallet_connect', 'detected_ethereum_wallets', 'detected_solana_wallets'],
        walletChainType: 'ethereum-and-solana',
      })
    } catch {
      triggerCopyToast(t('userDashboard.walletConnectionUnavailable', 'Wallet connection unavailable'))
    }
  }, [connectWallet, triggerCopyToast])

  const handleDisconnectWallet = useCallback(async (address) => {
    if (!address) return
    setDisconnectedAddrs((prev) => [...prev, address])
    const walletObj = privyWallets.find((w) => w.address === address)
    if (walletObj?.disconnect) {
      try { await walletObj.disconnect() } catch { /* already removed */ }
    }
    triggerCopyToast(t('userDashboard.walletDisconnected', 'Wallet disconnected'))
  }, [privyWallets, triggerCopyToast])

  const handleDeposit = useCallback(async ({ amount, asset } = {}) => {
    if (!activeWalletFromProps?.address) {
      triggerCopyToast(t('userDashboard.noWalletAvailable', 'No wallet available'))
      return
    }
    try {
      const chainId = EVM_CHAIN_IDS[activeChain]
      await fundWallet({
        address: activeWalletFromProps.address,
        options: {
          ...(chainId && { chain: { id: chainId } }),
          ...(amount && { amount: String(amount) }),
          ...(asset === 'usdc' && { asset: 'USDC' }),
          defaultFundingMethod: 'card',
        },
      })
    } catch (err) {
      if (err?.message?.includes('cancelled') || err?.message?.includes('canceled') || err?.message?.includes('closed')) return
      triggerCopyToast(err?.message || t('userDashboard.purchaseFailed', 'Purchase failed'))
    }
  }, [activeWalletFromProps?.address, activeChain, fundWallet, triggerCopyToast])

  const handleWithdraw = useCallback(async ({ toAddress, amount, token }) => {
    // Synchronous re-entry guard. Must run BEFORE any await so a double-click
    // in the same React frame is caught by the second invocation reading the
    // already-true ref. Released in the finally block below.
    if (withdrawInFlightRef.current) {
      console.warn('[withdraw] re-entry blocked - withdrawal already in flight')
      return { success: false, error: 'Already processing' }
    }
    if (!activeWalletFromProps?.address || !toAddress || !amount || !token) {
      return { success: false, error: 'Missing fields' }
    }

    // Per-attempt idempotency key. Privy's React useSendTransaction signature
    // does not expose an idempotencyKey option (server-side concern only), so
    // this currently flows nowhere on the wire. Generated + logged for two
    // future uses: (1) if we add /api/withdraw/log, this gets passed as the
    // X-Idempotency-Key header matching the swap-log pattern; (2) correlating
    // user-reported issues with Vercel logs via the prefixed log line.
    const idempotencyKey = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

    withdrawInFlightRef.current = true
    console.log(`[withdraw] start key=${idempotencyKey} chain=${activeChain} token=${token.symbol || token.address || 'native'}`)

    try {
      if (activeChain === 'solana') {
        const walletObj = privyWallets.find(
          (w) => w.address === activeWalletFromProps.address && w.walletClientType === 'privy'
        )
        if (!walletObj) return { success: false, error: 'Wallet not connected' }

        const solWeb3 = await import('@solana/web3.js')
        const { Connection, PublicKey, SystemProgram, Transaction } = solWeb3
        const rpcUrl = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
        const connection = new Connection(rpcUrl, 'confirmed')
        const provider = await walletObj.getProvider()

        const tx = new Transaction()

        if (token.isNative) {
          const lamports = toBaseUnits(amount, 9)
          tx.add(SystemProgram.transfer({
            fromPubkey: new PublicKey(activeWalletFromProps.address),
            toPubkey: new PublicKey(toAddress),
            lamports,
          }))
        } else {
          const { getAssociatedTokenAddressSync, createTransferInstruction, createAssociatedTokenAccountInstruction, getAccount } = await import('@solana/spl-token')
          const mint = new PublicKey(token.mintAddress)
          const fromPubkey = new PublicKey(activeWalletFromProps.address)
          const toPubkey = new PublicKey(toAddress)
          const sourceAta = getAssociatedTokenAddressSync(mint, fromPubkey)
          const destAta = getAssociatedTokenAddressSync(mint, toPubkey)

          try {
            await getAccount(connection, destAta)
          } catch {
            tx.add(createAssociatedTokenAccountInstruction(fromPubkey, destAta, toPubkey, mint))
          }

          const tokenAmount = toBaseUnits(amount, token.decimals)
          tx.add(createTransferInstruction(sourceAta, destAta, fromPubkey, tokenAmount))
        }

        tx.feePayer = new PublicKey(activeWalletFromProps.address)
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

        const { signature } = await provider.signAndSendTransaction(tx)
        triggerCopyToast(t('userDashboard.transactionSent', 'Transaction sent'))
        onRefetch?.()
        return { success: true, txHash: signature }
      } else {
        // buildWithdrawTx pins chainId to the ACTIVE TAB's chain (Privy
        // otherwise signs on the wallet's current chain - a BNB withdraw
        // could move mainnet ETH) and does exact string amount math.
        const txRequest = await buildWithdrawTx({ activeChain, token, toAddress, amount })
        const receipt = await sendTransaction(txRequest, { address: activeWalletFromProps.address })
        triggerCopyToast(t('userDashboard.transactionSent', 'Transaction sent'))
        onRefetch?.()
        return { success: true, txHash: receipt.hash }
      }
    } catch (err) {
      if (err?.message?.includes('cancelled') || err?.message?.includes('canceled') || err?.message?.includes('rejected')) {
        return { success: false, error: 'Transaction cancelled' }
      }
      console.error('[withdraw]', err)
      return { success: false, error: err?.message || 'Transaction failed' }
    } finally {
      // Release the in-flight guard regardless of success/failure. `finally`
      // runs after every return inside the try block, so it covers the early
      // success returns (Solana + EVM native + EVM ERC-20) AND the cancelled /
      // failed paths without manually placing the release before each return.
      withdrawInFlightRef.current = false
    }
  }, [activeWalletFromProps?.address, activeChain, privyWallets, sendTransaction, triggerCopyToast, onRefetch, t])

  const [activePanel, setActivePanel] = useState('balances')
  const [showExternal, setShowExternal] = useState(false)

  // Delay shimmer display to avoid flash on fast loads
  const [showShimmer, setShowShimmer] = useState(false)
  useEffect(() => {
    if (!loading) { setShowShimmer(false); return }
    const t = setTimeout(() => setShowShimmer(true), 150)
    return () => clearTimeout(t)
  }, [loading])

  const ActiveChainIcon = activeNetwork.IconComponent
  const activeWallet = activeWalletFromProps

  const totalValue = balances.reduce((sum, b) => sum + (b.usdValue || 0), 0)

  const handleCopyAddress = () => {
    if (!activeWallet?.address) return
    navigator.clipboard.writeText(activeWallet.address)
    triggerCopyToast(t('userDashboard.addressCopied', 'Address copied!'))
  }

  const handleChainChange = (chainId) => {
    onChainChange(chainId)
    setActivePanel('balances')
  }

  return (
    <section className="ud-card ud-wallets ud-w-section">
      {/* Section intro */}
      <div className="ud-w-intro">
        <h2 className="ud-card-title">Your Wallet</h2>
        <p className="ud-w-intro-text">
          Your wallet is ready to go. Deposit funds and trade instantly within Spectre AI - no extensions or approvals needed.
        </p>
      </div>

      {/* Portfolio hero - balance is the star */}
      <div className="ud-w-portfolio">
        <div className="ud-w-portfolio-top">
          <span className="ud-w-portfolio-label">Portfolio Value</span>
          <div className="ud-w-portfolio-chain">
            <ActiveChainIcon size={12} />
            <span>{activeNetwork.label}</span>
          </div>
        </div>
        <div className="ud-w-portfolio-value">{fmtPrice(totalValue)}</div>
      </div>

      {/* Network selector */}
      <div className="ud-w-chain-tabs">
        {NETWORKS.map((net) => {
          const NetIcon = net.IconComponent
          return (
            <button
              key={net.id}
              type="button"
              className={`ud-w-chain-tab${activeChain === net.id ? ' is-active' : ''}`}
              onClick={() => handleChainChange(net.id)}
              title={net.label}
            >
              <span className="ud-w-chain-tab-icon"><NetIcon size={18} /></span>
              <span className="ud-w-chain-tab-label">{net.shortLabel}</span>
            </button>
          )
        })}
      </div>

      {/* Wallet address for selected network */}
      {activeWallet && (
        <div className="ud-w-address-block">
          <button type="button" className="ud-w-address-row" onClick={handleCopyAddress} title="Click to copy full address">
            <ActiveChainIcon size={16} className="ud-w-address-chain-icon" />
            <code className="ud-w-address-text">{activeWallet.address}</code>
            <span className="ud-w-copy-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
              Copy
            </span>
          </button>
          {activeNetwork.walletType === 'ethereum' && (
            <p className="ud-w-same-address-hint">
              One address for all EVM networks - Ethereum, Base, Polygon, Arbitrum, and BNB Chain.
            </p>
          )}
        </div>
      )}

      {activeWallet ? (
        <>
          {/* Receive panel - QR + address */}
          {activePanel === 'receive' && (
            <div className="ud-w-receive-panel">
              <div className="ud-w-receive-badge" style={{ '--badge-color': activeNetwork.color }}>
                <ActiveChainIcon size={14} />
                <span>{activeNetwork.label} Network</span>
              </div>
              <div className="ud-w-qr-container">
                <QrCanvas value={activeWallet.address} size={160} />
              </div>
              <div className="ud-w-receive-address-row">
                <code className="ud-w-receive-address">{activeWallet.address}</code>
                <button type="button" className="ud-w-icon-btn" onClick={handleCopyAddress} title="Copy address">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                </button>
              </div>
              <div className="ud-w-receive-warning">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {activeNetwork.walletType === 'ethereum' ? (
                  <span>Shared EVM address. Make sure to select <strong>{activeNetwork.label}</strong> as the network when sending.</span>
                ) : (
                  <span><strong>Solana only</strong> - do not send tokens from other networks to this address.</span>
                )}
              </div>
              <button
                type="button"
                className="ud-w-panel-close"
                onClick={() => setActivePanel('balances')}
              >
                Back to balances
              </button>
            </div>
          )}

          {/* Send form */}
          {activePanel === 'withdraw' && (
            <WithdrawForm
              activeChain={activeChain}
              balances={balances}
              onWithdraw={handleWithdraw}
              onCancel={() => setActivePanel('balances')}
            />
          )}

          {/* Deposit panel - custom pre-step before MoonPay */}
          {activePanel === 'deposit' && (
            <UdDepositPanel
              activeChain={activeChain}
              activeNetwork={activeNetwork}
              onContinue={handleDeposit}
              onCancel={() => setActivePanel('balances')}
            />
          )}

          {/* Balance list */}
          {activePanel === 'balances' && (
            (loading && showShimmer) ? (
              <div className="ud-w-loading">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="ud-w-balance-row ud-w-shimmer-row" style={{ animationDelay: `${i * 80}ms` }}>
                    <div className="ud-w-token-badge ud-w-shimmer-badge" />
                    <div className="ud-w-balance-info">
                      <div className="ud-w-shimmer-line" style={{ width: '50%' }} />
                      <div className="ud-w-shimmer-line" style={{ width: '35%', height: 10 }} />
                    </div>
                    <div className="ud-w-shimmer-line" style={{ width: 60, flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            ) : balances.length > 0 ? (
              <>
                {/* Portfolio allocation strip - visual weight distribution */}
                {totalValue > 0 && (
                  <div className="ud-w-allocation">
                    {balances.filter((b) => b.usdValue > 0).map((b, i) => (
                      <div
                        key={i}
                        className="ud-w-alloc-seg"
                        style={{
                          width: `${Math.max(2, (b.usdValue / totalValue) * 100)}%`,
                          '--seg-color': TOKEN_COLORS[b.symbol] || 'rgba(255,255,255,0.15)',
                        }}
                        title={`${b.symbol} ${((b.usdValue / totalValue) * 100).toFixed(1)}%`}
                      />
                    ))}
                  </div>
                )}
                <div className="ud-w-balance-list">
                  {balances.map((b, i) => {
                    const brandColor = TOKEN_COLORS[b.symbol] || 'rgba(255,255,255,0.3)'
                    const TokenIcon = TOKEN_ICON_MAP[b.symbol]
                    return (
                      <div key={i} className="ud-w-balance-row">
                        <div className="ud-w-token-badge" style={{ '--token-color': brandColor }}>
                          {TokenIcon ? <TokenIcon size={20} className="ud-w-token-icon" /> : <span className="ud-w-token-letter">{b.symbol[0]}</span>}
                        </div>
                        <div className="ud-w-balance-info">
                          <div className="ud-w-token-name-row">
                            <span className="ud-w-token-symbol">{b.symbol}</span>
                            {/* Native badge removed - unnecessary label */}
                          </div>
                          <span className="ud-w-token-amount">{parseFloat(b.balance).toFixed(4)}</span>
                        </div>
                        <span className="ud-w-token-value">{fmtPrice(b.usdValue || 0)}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="ud-w-empty-state">
                <div className="ud-w-empty-icon">
                  <ActiveChainIcon size={28} />
                </div>
                <p className="ud-w-empty-text">No tokens found</p>
                <p className="ud-w-empty-hint">Buy or receive {activeNetwork.label} assets to get started</p>
              </div>
            )
          )}

          {/* Actions - deposit is primary CTA */}
          <div className="ud-w-action-bar">
            <button
              type="button"
              className={`ud-w-action-btn ud-w-action-deposit${activePanel === 'deposit' ? ' is-active' : ''}`}
              onClick={() => setActivePanel(activePanel === 'deposit' ? 'balances' : 'deposit')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 7l-5-5-5 5" />
              </svg>
              <span>Deposit</span>
            </button>
            <button
              type="button"
              className={`ud-w-action-btn${activePanel === 'receive' ? ' is-active' : ''}`}
              onClick={() => setActivePanel(activePanel === 'receive' ? 'balances' : 'receive')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Receive</span>
            </button>
            <button
              type="button"
              className={`ud-w-action-btn${activePanel === 'withdraw' ? ' is-active' : ''}`}
              onClick={() => setActivePanel(activePanel === 'withdraw' ? 'balances' : 'withdraw')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
              </svg>
              <span>Send</span>
            </button>
          </div>

          {/* Zero-balance deposit nudge */}
          {!loading && totalValue === 0 && activePanel === 'balances' && (
            <p className="ud-w-deposit-hint">Deposit funds to start trading</p>
          )}
        </>
      ) : (
        <div className="ud-w-empty-state">
          <div className="ud-w-empty-icon">
            <ActiveChainIcon size={28} />
          </div>
          <p className="ud-w-empty-text">No {activeNetwork.label} wallet available</p>
          <p className="ud-w-empty-hint">Sign in to create your embedded wallet</p>
        </div>
      )}

      {/* External wallets - collapsible, secondary */}
      <div className="ud-w-external">
        <button
          type="button"
          className="ud-w-external-toggle"
          onClick={() => setShowExternal(!showExternal)}
        >
          <span className="ud-w-external-toggle-text">
            Link external wallet
            <span className="ud-w-external-optional">optional</span>
          </span>
          {externalWallets.length > 0 && (
            <span className="ud-ew-count">{externalWallets.length}</span>
          )}
          <svg
            className={`ud-w-external-chevron${showExternal ? ' is-open' : ''}`}
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showExternal && (
          <div className="ud-w-external-content">
            <p className="ud-w-external-hint">
              Connect an existing wallet to view balances. Trading from external wallets requires manual approvals and may be slower.
            </p>
            {externalWallets.length > 0 && (
              <div className="ud-ew-list">
                {externalWallets.map((w, i) => (
                  <div key={w.address || i} className="ud-ew-item">
                    <div className="ud-ew-item-dot" style={{ background: EXT_WALLET_META[w.walletClientType]?.color || 'rgba(245, 245, 247, 0.6)' }} />
                    <div className="ud-ew-item-info">
                      <span className="ud-ew-item-name">{EXT_WALLET_META[w.walletClientType]?.label || w.walletClientType || 'Wallet'}</span>
                      <code className="ud-ew-item-address">{truncateAddress(w.address)}</code>
                    </div>
                    <span className="ud-ew-item-chain">{w.chainType || 'ethereum'}</span>
                    <button type="button" className="ud-w-icon-btn" onClick={() => { navigator.clipboard.writeText(w.address); triggerCopyToast(t('userDashboard.addressCopied', 'Address copied!')) }} title="Copy address">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                    </button>
                    <button type="button" className="ud-ew-disconnect" onClick={() => handleDisconnectWallet(w.address)} title="Disconnect wallet">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className="ud-ew-connect-btn" onClick={handleConnectWallet}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
              {externalWallets.length > 0 ? 'Connect Another' : 'Connect Wallet'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
