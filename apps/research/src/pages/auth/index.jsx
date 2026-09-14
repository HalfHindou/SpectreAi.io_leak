/**
 * Auth Page — Spectre AI
 * Route: /auth
 *
 * Centered glass card with Sign In / Create Account tabs.
 * All buttons non-functional — shows "Coming soon" toast.
 */
import { useState } from 'react'
import { useCopyToast } from '@/contexts/CopyToastContext'
import './auth.css'

/* ---- Inline SVG Icons ---- */
function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
    </svg>
  )
}

export default function AuthPage() {
  const [activeTab, setActiveTab] = useState('signin') // 'signin' | 'create'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { triggerCopyToast } = useCopyToast()

  const comingSoon = (e) => {
    e.preventDefault()
    triggerCopyToast('Coming soon')
  }

  return (
    <div className="auth-viewport">
      <div className="auth-card">
        {/* Brand */}
        <div className="auth-brand">
          <img
            src="/round-logo.png"
            alt="Spectre"
            className="auth-logo"
          />
          <span className="auth-brand-name">Spectre</span>
        </div>

        {/* Tab Switcher */}
        <div className="auth-tabs">
          <button
            className={`auth-tab${activeTab === 'signin' ? ' auth-tab--active' : ''}`}
            onClick={() => setActiveTab('signin')}
            type="button"
          >
            Sign In
          </button>
          <button
            className={`auth-tab${activeTab === 'create' ? ' auth-tab--active' : ''}`}
            onClick={() => setActiveTab('create')}
            type="button"
          >
            Create Account
          </button>
        </div>

        {/* Form */}
        <form className="auth-form" onSubmit={comingSoon}>
          <div className="auth-input-group">
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="auth-input-group">
            <label className="auth-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className="auth-input"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={activeTab === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {activeTab === 'create' && (
            <div className="auth-input-group">
              <label className="auth-label" htmlFor="auth-confirm">Confirm Password</label>
              <input
                id="auth-confirm"
                className="auth-input"
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}

          {activeTab === 'signin' && (
            <button
              className="auth-forgot"
              type="button"
              onClick={comingSoon}
            >
              Forgot password?
            </button>
          )}

          <button className="auth-submit" type="submit">
            {activeTab === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {/* Divider */}
        <div className="auth-divider">
          <span className="auth-divider-line" />
          <span className="auth-divider-text">or</span>
          <span className="auth-divider-line" />
        </div>

        {/* Social Buttons */}
        <div className="auth-social-buttons">
          <button className="auth-ghost-btn" type="button" onClick={comingSoon}>
            <GlobeIcon />
            Continue with Google
          </button>
          <button className="auth-ghost-btn" type="button" onClick={comingSoon}>
            <XIcon />
            Continue with X
          </button>

          {activeTab === 'create' && (
            <div className="auth-wallet-section">
              <button className="auth-ghost-btn" type="button" onClick={comingSoon}>
                <WalletIcon />
                Connect Wallet
              </button>
              <span className="auth-wallet-hint">
                Optional — connect to unlock token-based access
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
