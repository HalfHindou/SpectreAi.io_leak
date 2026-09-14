/**
 * OnboardingPopup - One-time setup for new users after first Privy login.
 * Username, avatar, and referral code in a single centered modal.
 */
import { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { getPrivyDisplayInfo } from '../lib/privy-user'
import './OnboardingPopup.css'

export default function OnboardingPopup() {
  const { authenticated, user, getAccessToken } = usePrivy()

  // Default to hidden. We flip to visible only after we've confirmed the
  // user has no KV-stored profile yet. Previously this used a localStorage
  // flag (`spectre-onboarding-done`) - but localStorage is per-origin, so
  // a user who completed onboarding on app.spectreai.io would see this
  // popup again on trade.spectreai.io. KV is the actual cross-app source
  // of truth (and confirmed by user: avatar/username DO propagate).
  const [visible, setVisible] = useState(false)
  const [profileChecked, setProfileChecked] = useState(false)

  useEffect(() => {
    if (!authenticated || !user?.id) return
    if (profileChecked) return
    // Local short-circuit: if THIS origin's localStorage already has the
    // flag, don't even bother hitting the API. Fast path for returning
    // users on the same domain.
    if (localStorage.getItem('spectre-onboarding-done') === 'true') {
      setProfileChecked(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const token = await getAccessToken?.()
        if (!token) { if (!cancelled) { setProfileChecked(true); setVisible(true) } ; return }
        const res = await fetch('/api/user', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancelled) return
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          // KV layout: { profile: { name, imageUrl }, settings, ... }
          const hasName = typeof data?.profile?.name === 'string' && data.profile.name.trim().length > 0
          if (hasName) {
            // Cache locally so we skip the network call on next mount.
            try { localStorage.setItem('spectre-onboarding-done', 'true') } catch { /* swallow */ }
            setProfileChecked(true)
            return
          }
        }
        // No profile (or fetch failed gracefully) - show the popup so the
        // user can set one up.
        setProfileChecked(true)
        setVisible(true)
      } catch {
        // Fail-open to popup so a transient API error doesn't lock users
        // out of profile setup forever. The "Skip for now" button still
        // works.
        if (!cancelled) { setProfileChecked(true); setVisible(true) }
      }
    })()
    return () => { cancelled = true }
  }, [authenticated, user?.id, getAccessToken, profileChecked])

  const info = getPrivyDisplayInfo(user)

  // Only use Google/Twitter real names for pre-fill, not email prefix or wallet address
  const realName = user?.google?.name || user?.twitter?.name || ''

  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [showDropZone, setShowDropZone] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [referralCode, setReferralCode] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // Pre-fill from Privy + localStorage once user data arrives
  useEffect(() => {
    if (!user) return
    setUsername((prev) => prev || realName)
    setAvatarUrl((prev) => prev || info.avatar || '')
    setReferralCode((prev) => prev || localStorage.getItem('spectre-referral-code') || '')
  }, [user, realName, info.avatar])

  const close = () => setVisible(false)

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setAvatarUrl(e.target.result)
      setShowDropZone(false)
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    handleFile(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = () => setDragging(false)

  const handleSkip = () => {
    localStorage.setItem('spectre-onboarding-done', 'true')
    localStorage.setItem('spectre-referral-dismissed', 'true')
    close()
  }

  const handleComplete = async () => {
    setSaving(true)
    try {
      // Save profile to localStorage (trading app uses localStorage directly)
      const profile = { name: username.trim() || realName || 'User', imageUrl: avatarUrl || '' }
      try {
        const stored = JSON.parse(localStorage.getItem('spectre-settings') || '{}')
        stored.state = stored.state || {}
        stored.state.profile = profile
        localStorage.setItem('spectre-settings', JSON.stringify(stored))
      } catch (_) { /* storage failure non-blocking */ }

      // Apply referral code if entered
      const code = referralCode.trim()
      if (code && user?.id) {
        try {
          const token = await getAccessToken?.()
          if (token) {
            const res = await fetch('/api/referral/apply', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ code: code.toUpperCase() })
            })
            const data = await res.json()
            if (data?.success) {
              localStorage.setItem('spectre-referral-applied', 'true')
            }
          }
        } catch (_) { /* referral failure is non-blocking */ }
        localStorage.removeItem('spectre-referral-code')
      }

      localStorage.setItem('spectre-onboarding-done', 'true')
      localStorage.setItem('spectre-referral-dismissed', 'true')
    } catch (_) {
      localStorage.setItem('spectre-onboarding-done', 'true')
    }
    setSaving(false)
    close()
  }

  if (!visible) return null

  const initial = (username || realName || 'U').charAt(0).toUpperCase()

  return ReactDOM.createPortal(
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <h2 className="onboarding-title">Welcome to Spectre AI</h2>
        <p className="onboarding-subtitle">Set up your profile to get started</p>

        {/* Avatar */}
        <div className="onboarding-avatar-section">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="onboarding-avatar" onClick={() => setShowDropZone(true)} style={{ cursor: 'pointer' }} />
          ) : (
            <div className="onboarding-avatar-fallback" onClick={() => setShowDropZone(true)} style={{ cursor: 'pointer' }}>{initial}</div>
          )}
          <button
            type="button"
            className="onboarding-avatar-change"
            onClick={() => setShowDropZone(!showDropZone)}
          >
            {showDropZone ? 'Cancel' : 'Change photo'}
          </button>
          {showDropZone && (
            <div
              className={`onboarding-dropzone${dragging ? ' onboarding-dropzone-active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="onboarding-dropzone-text">
                {dragging ? 'Drop image here' : 'Drag & drop or click to upload'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="onboarding-dropzone-input"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          )}
        </div>

        {/* Username */}
        <div className="onboarding-field">
          <label className="onboarding-label">Username</label>
          <input
            type="text"
            className="onboarding-input"
            placeholder="Choose a username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            maxLength={30}
          />
        </div>

        {/* Referral code */}
        <div className="onboarding-field">
          <label className="onboarding-label">
            Referral code <span className="onboarding-optional">optional</span>
          </label>
          <input
            type="text"
            className="onboarding-input"
            placeholder="Enter referral code"
            value={referralCode}
            onChange={e => setReferralCode(e.target.value.toUpperCase())}
            maxLength={12}
          />
        </div>

        {/* Actions */}
        <div className="onboarding-actions">
          <button type="button" className="onboarding-skip" onClick={handleSkip}>
            Skip for now
          </button>
          <button
            type="button"
            className="onboarding-complete"
            onClick={handleComplete}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Complete Setup'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
