/**
 * Referral section - display code, copy, apply code input, stats.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function UdReferralSection({ referralCode, referralStats, loading, onApplyCode, triggerCopyToast }) {
  const { t } = useTranslation()
  const [inputCode, setInputCode] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null) // { success, error }

  const handleCopyCode = () => {
    if (!referralCode) return
    navigator.clipboard.writeText(referralCode)
    triggerCopyToast(t('userDashboard.referralCodeCopied', 'Referral code copied!'))
  }

  const handleApply = async () => {
    if (!inputCode.trim()) return
    setApplying(true)
    setApplyResult(null)
    const result = await onApplyCode(inputCode)
    setApplyResult(result)
    setApplying(false)
    if (result.success) {
      setInputCode('')
      triggerCopyToast(t('userDashboard.referralCodeApplied', 'Referral code applied!'))
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleApply()
  }

  const referredCount = referralStats?.referredCount || 0

  return (
    <section className="ud-card ud-referral">
      <h2 className="ud-card-title">Referral</h2>

      {/* Your code */}
      <div className="ud-referral-your-code">
        <span className="ud-referral-label">Your code</span>
        <div className="ud-referral-code-row">
          {loading ? (
            <div className="ud-shimmer" style={{ width: 100, height: 20, borderRadius: 4 }} />
          ) : (
            <code className="ud-referral-code">{referralCode}</code>
          )}
          <button type="button" className="ud-referral-copy" onClick={handleCopyCode}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="ud-referral-stats">
        <span className="ud-referral-stat-value">{referredCount}</span>
        <span className="ud-referral-stat-label">{referredCount === 1 ? 'user referred' : 'users referred'}</span>
      </div>

      <div className="ud-divider" />

      {/* Apply code */}
      <div className="ud-referral-apply">
        <span className="ud-referral-label">Have a referral code?</span>
        <div className="ud-referral-apply-row">
          <input
            className="ud-referral-input"
            type="text"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="Enter code"
            maxLength={12}
          />
          <button
            type="button"
            className="ud-referral-apply-btn"
            onClick={handleApply}
            disabled={applying || !inputCode.trim()}
          >
            {applying ? 'Applying...' : 'Apply'}
          </button>
        </div>
        {applyResult && !applyResult.success && (
          <span className="ud-referral-error">{applyResult.error || 'Failed to apply code'}</span>
        )}
      </div>
    </section>
  )
}
