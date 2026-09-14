/**
 * AgentConsentSheet - the 'Enable automated orders' session-signer consent
 * screen. The grant is HEADLESS (no Privy modal), so this screen IS the
 * consent UX: it must state plainly what is being granted, its bounds, and
 * how to revoke. Custody framing: the wallet stays user-owned; the user
 * grants a revocable, policy-scoped signer (only the allowlisted Solana
 * programs, spend caps enforced order-side); keys never leave Privy's
 * secure enclave; our server holds only an authorization key.
 *
 * On-demand child (privy.md D1) - mounts only from the order ticket's
 * Enable button, well after hydration.
 */
import { useState } from 'react'
import { X, ShieldCheck, Loader2 } from 'lucide-react'
import { useSignersSafe, useSolanaWalletsSafe } from '../../lib/use-privy-safe'
import { track, Events } from '../../services/analytics'

const QUORUM_ID = import.meta.env.VITE_PRIVY_SIGNER_QUORUM_ID
const POLICY_ID = import.meta.env.VITE_PRIVY_SIGNER_POLICY_ID

export default function AgentConsentSheet({ onGranted, onClose, surface = 'desktop' }) {
  const { addSigners } = useSignersSafe()
  const { wallets: solWallets } = useSolanaWalletsSafe()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const embeddedSol = solWallets?.find((w) => w.standardWallet?.isPrivyWallet)
  const configured = !!(QUORUM_ID && POLICY_ID)

  const grant = async () => {
    if (busy || !configured || !embeddedSol) return
    setBusy(true)
    setError(null)
    try {
      await addSigners({
        address: embeddedSol.address,
        signers: [{ signerId: QUORUM_ID, policyIds: [POLICY_ID] }],
      })
      track(Events.AGENT_SIGNER_ENABLED, { surface, chain: 1399811149 })
      onGranted?.()
    } catch (e) {
      setError(e?.message === 'wallet_not_ready' ? 'Sign in first, then try again.' : (e?.message || 'Grant failed - try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sagent-consent__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="sagent-consent" role="dialog" aria-label="Enable automated orders">
        <div className="sagent-consent__head">
          <div className="sagent-consent__title">
            <ShieldCheck size={15} />
            <span>Enable automated orders</span>
          </div>
          <button type="button" className="sagent-panel__iconbtn" onClick={onClose}><X size={15} /></button>
        </div>

        <p className="sagent-consent__lede">
          Your orders need to execute while you are away. You grant Spectre a
          <strong> revocable, tightly scoped</strong> permission to sign trades
          from your wallet when a trigger you set fires.
        </p>

        <ul className="sagent-consent__scope">
          <li><strong>Your wallet stays yours.</strong> Keys never leave Privy's secure enclave - Spectre's server never sees them.</li>
          <li><strong>Only swaps.</strong> The permission itself is locked to the Jupiter swap programs on Solana - it cannot send funds elsewhere or touch other apps.</li>
          <li><strong>Only your orders.</strong> Spectre's execution engine only acts on orders you created, and enforces their spend caps and expiry before every trade.</li>
          <li><strong>Revoke anytime.</strong> The Automation row in the agent panel revokes the permission with one tap.</li>
        </ul>

        {!configured && (
          <div className="sagent-card__error">Automated orders are not configured on this environment yet.</div>
        )}
        {configured && !embeddedSol && (
          <div className="sagent-card__error">No embedded Solana wallet found - sign in first.</div>
        )}
        {error && <div className="sagent-card__error">{error}</div>}

        <div className="sagent-card__actions">
          <button type="button" className="sagent-card__btn" onClick={onClose}>Not now</button>
          <button
            type="button"
            className="sagent-card__btn sagent-card__btn--confirm"
            disabled={busy || !configured || !embeddedSol}
            onClick={grant}
          >
            {busy ? (<><Loader2 size={13} className="sagent-tool__spin" /> Granting...</>) : 'Enable'}
          </button>
        </div>
      </div>
    </div>
  )
}
