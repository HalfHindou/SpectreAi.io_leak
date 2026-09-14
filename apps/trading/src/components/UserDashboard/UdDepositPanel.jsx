/**
 * Deposit panel - custom pre-step UI before Privy's MoonPay/Stripe checkout.
 * Shows amount selection, asset toggle, and chain context.
 * Ported from research app.
 */
import { useState } from 'react'

const QUICK_AMOUNTS = [50, 100, 250, 500]

const NATIVE_SYMBOLS = {
  ethereum: 'ETH', base: 'ETH', polygon: 'MATIC',
  arbitrum: 'ETH', bsc: 'BNB', solana: 'SOL',
}

export default function UdDepositPanel({ activeChain, activeNetwork, onContinue, onCancel }) {
  const [selectedAmount, setSelectedAmount] = useState(50)
  const [customAmount, setCustomAmount] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState('native')
  const [loading, setLoading] = useState(false)

  const ChainIcon = activeNetwork.IconComponent
  const nativeSymbol = NATIVE_SYMBOLS[activeChain] || 'ETH'

  const handleQuickAmount = (amt) => {
    setSelectedAmount(amt)
    setCustomAmount('')
    setIsCustom(false)
  }

  const handleCustomFocus = () => {
    setIsCustom(true)
    setSelectedAmount(null)
  }

  const handleContinue = async () => {
    const amount = isCustom ? parseFloat(customAmount) : selectedAmount
    if (!amount || amount <= 0) return
    setLoading(true)
    try { await onContinue({ amount, asset: selectedAsset }) }
    finally { setLoading(false) }
  }

  const finalAmount = isCustom ? parseFloat(customAmount) || 0 : selectedAmount || 0

  return (
    <div className="ud-dep-panel">
      <div className="ud-dep-chain-badge" style={{ '--chain-color': activeNetwork.color }}>
        <ChainIcon size={14} />
        <span>Depositing to {activeNetwork.label}</span>
      </div>

      <div className="ud-dep-section">
        <label className="ud-dep-label">Amount</label>
        <div className="ud-dep-amounts">
          {QUICK_AMOUNTS.map((amt) => (
            <button key={amt} type="button" className={`ud-dep-amount-pill${!isCustom && selectedAmount === amt ? ' is-active' : ''}`} onClick={() => handleQuickAmount(amt)}>${amt}</button>
          ))}
        </div>
        <div className="ud-dep-custom-row">
          <span className="ud-dep-currency-sign">$</span>
          <input type="number" className="ud-dep-custom-input" placeholder="Custom amount" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} onFocus={handleCustomFocus} min="1" step="any" aria-label="Custom amount" />
        </div>
      </div>

      <div className="ud-dep-section">
        <label className="ud-dep-label">You receive</label>
        <div className="ud-dep-asset-toggle">
          <button type="button" className={`ud-dep-asset-btn${selectedAsset === 'native' ? ' is-active' : ''}`} onClick={() => setSelectedAsset('native')}>
            <ChainIcon size={16} /><span>{nativeSymbol}</span>
          </button>
          <button type="button" className={`ud-dep-asset-btn${selectedAsset === 'usdc' ? ' is-active' : ''}`} onClick={() => setSelectedAsset('usdc')}>
            <span className="ud-dep-usdc-icon">$</span><span>USDC</span>
          </button>
        </div>
      </div>

      <div className="ud-dep-summary">
        {finalAmount > 0 && (
          <p className="ud-dep-summary-text">Buy ~${finalAmount} of {selectedAsset === 'usdc' ? 'USDC' : nativeSymbol} on {activeNetwork.label}</p>
        )}
        <button type="button" className="ud-dep-continue-btn" onClick={handleContinue} disabled={loading || finalAmount <= 0}>
          {loading ? 'Opening checkout...' : 'Continue to payment'}
        </button>
        <p className="ud-dep-powered">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
          Secure checkout via MoonPay
        </p>
      </div>

      <button type="button" className="ud-dep-back" onClick={onCancel}>Back to balances</button>
    </div>
  )
}
