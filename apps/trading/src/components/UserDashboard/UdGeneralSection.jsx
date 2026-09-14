/**
 * Profile section - avatar upload, username edit, email display, linked accounts, sign out.
 * Ported from research app with inline SVG icons (no spectreIcons available in trading).
 *
 * Privy hooks (useLinkAccount + usePrivy unlink methods) live here rather
 * than in the parent index.jsx because they crash when mounted before Privy is
 * fully hydrated. By the time the user navigates to this tab, Privy is ready.
 *
 * 2026-05-23: unlink methods come from usePrivy() (Privy v3.16 PrivyInterface
 * in @privy-io/react-auth/dist/dts/index.d.ts L8463+). Signatures are
 * POSITIONAL: unlinkGoogle(subject), unlinkEmail(address),
 * unlinkTelegram(telegramUserId). They return Promise<User> and throw on
 * failure, so unlink errors do reach the catch.
 */
import { useState, useRef, useCallback, Component } from 'react'
import { useLinkAccountSafe as useLinkAccount, usePrivySafe as usePrivy } from '../../lib/use-privy-safe'

// Services that can be linked via Privy - with inline SVG icons
const ACCOUNT_SERVICES = [
  {
    id: 'google', label: 'Google', privyKey: 'google',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
  },
  {
    id: 'twitter', label: 'X', privyKey: 'twitter',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    id: 'telegram', label: 'Telegram', privyKey: 'telegram',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
      </svg>
    ),
  },
  {
    id: 'email', label: 'Email', privyKey: 'email',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/>
      </svg>
    ),
  },
]

// Map Privy linkedAccounts types to our service IDs
function getLinkedServiceIds(linkedAccounts) {
  const ids = new Set()
  for (const acct of linkedAccounts) {
    if (acct.type === 'google_oauth') ids.add('google')
    else if (acct.type === 'twitter_oauth') ids.add('twitter')
    else if (acct.type === 'telegram') ids.add('telegram')
    else if (acct.type === 'email') ids.add('email')
  }
  return ids
}

// Get the subject/address needed for unlinking
function getUnlinkIdentifier(linkedAccounts, serviceId) {
  for (const acct of linkedAccounts) {
    if (serviceId === 'google' && acct.type === 'google_oauth') return acct.subject
    if (serviceId === 'twitter' && acct.type === 'twitter_oauth') return acct.subject
    if (serviceId === 'telegram' && acct.type === 'telegram') return acct.telegramUserId
    if (serviceId === 'email' && acct.type === 'email') return acct.address
  }
  return null
}

// Error boundary so a Privy hook crash does not take down the whole section
class PrivyErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(err) {
    console.error('[UdGeneralSection] Privy hook error caught:', err)
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || null
    }
    return this.props.children
  }
}

function GeneralSectionInner({
  profile, privyUser, authenticated,
  onProfileUpdate, onLogout, triggerCopyToast,
  linkedAccounts = [],
  // Keep noop props as fallback if hooks fail to initialize
  onLinkAccount: onLinkAccountProp,
  onUnlinkAccount: onUnlinkAccountProp,
}) {
  // Privy hooks - safe to call here because this component only mounts
  // when the General tab is active, by which time Privy is hydrated.
  const {
    linkGoogle, linkTwitter, linkTelegram, linkEmail,
  } = useLinkAccount()

  // Unlink methods live on usePrivy() (PrivyInterface). Positional args.
  const {
    unlinkGoogle, unlinkTwitter, unlinkTelegram, unlinkEmail,
  } = usePrivy()

  const handleLinkAccount = useCallback(async (serviceId) => {
    const linkFns = { google: linkGoogle, twitter: linkTwitter, telegram: linkTelegram, email: linkEmail }
    const fn = linkFns[serviceId]
    if (!fn) return
    try {
      await fn()
    } catch (err) {
      const msg = err?.message || ''
      if (msg.includes('not allowed')) {
        const label = serviceId.charAt(0).toUpperCase() + serviceId.slice(1)
        triggerCopyToast(`${label} login not enabled yet`)
      } else if (!msg.includes('cancelled') && !msg.includes('canceled')) {
        triggerCopyToast('Failed to link account')
      }
    }
  }, [linkGoogle, linkTwitter, linkTelegram, linkEmail, triggerCopyToast])

  const handleUnlinkAccount = useCallback(async (serviceId, identifier) => {
    if (!identifier) return
    try {
      switch (serviceId) {
        case 'google':   await unlinkGoogle(identifier);   break
        case 'twitter':  await unlinkTwitter(identifier);  break
        case 'email':    await unlinkEmail(identifier);    break
        case 'telegram': await unlinkTelegram(identifier); break
        default: throw new Error(`Unsupported unlink service: ${serviceId}`)
      }
    } catch (err) {
      if (!err?.message?.includes('cancelled') && !err?.message?.includes('canceled')) {
        console.warn('[unlink] failed for', serviceId, err?.message)
        triggerCopyToast('Failed to unlink account', { variant: 'destructive' })
        throw err
      }
    }
  }, [unlinkGoogle, unlinkTwitter, unlinkEmail, unlinkTelegram, triggerCopyToast])

  return (
    <GeneralSectionUI
      profile={profile}
      privyUser={privyUser}
      authenticated={authenticated}
      onProfileUpdate={onProfileUpdate}
      onLogout={onLogout}
      triggerCopyToast={triggerCopyToast}
      linkedAccounts={linkedAccounts}
      onLinkAccount={handleLinkAccount}
      onUnlinkAccount={handleUnlinkAccount}
    />
  )
}

export default function UdGeneralSection(props) {
  // Wrap in error boundary - if Privy hooks crash, fall back to noop props from parent
  return (
    <PrivyErrorBoundary
      fallback={
        <GeneralSectionUI
          {...props}
          onLinkAccount={props.onLinkAccount || (() => props.triggerCopyToast?.('Account linking unavailable'))}
          onUnlinkAccount={props.onUnlinkAccount || (() => {})}
        />
      }
    >
      <GeneralSectionInner {...props} />
    </PrivyErrorBoundary>
  )
}

function GeneralSectionUI({
  profile, privyUser, authenticated,
  onProfileUpdate, onLogout, triggerCopyToast,
  linkedAccounts = [], onLinkAccount, onUnlinkAccount
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(profile.name)
  const [unlinking, setUnlinking] = useState(null)
  const fileInputRef = useRef(null)

  const linkedIds = getLinkedServiceIds(linkedAccounts)
  const totalLinked = linkedIds.size

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    // Compress to 256x256 JPEG @ 0.85 before storing. Raw uploads are 2-7 MB
    // which exceeds the localStorage quota (Zustand persist throws
    // QuotaExceededError + profile is never saved -> pfp resets on refresh).
    // Avatar only needs ~256px so this is lossless visually and the dataURL
    // becomes ~30-80 KB. Matches research's handleFile.
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const MAX = 256
        const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
        const w = Math.round(img.width * ratio)
        const h = Math.round(img.height * ratio)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        try {
          onProfileUpdate({ ...profile, imageUrl: dataUrl })
        } catch (err) {
          console.warn('[profile] avatar persist failed:', err?.message || err)
          triggerCopyToast?.('Avatar too large, try a smaller image', { variant: 'destructive' })
        }
      }
      img.onerror = () => {
        triggerCopyToast?.('Invalid image file', { variant: 'destructive' })
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleSaveName = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== profile.name) {
      onProfileUpdate({ ...profile, name: trimmed })
    }
    setEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSaveName()
    if (e.key === 'Escape') { setEditName(profile.name); setEditing(false) }
  }

  const handleUnlink = async (serviceId) => {
    if (totalLinked <= 1) {
      triggerCopyToast('Cannot unlink your only login method', { variant: 'destructive' })
      return
    }
    const serviceLabel = ACCOUNT_SERVICES.find(s => s.id === serviceId)?.label || serviceId
    const identifier = getUnlinkIdentifier(linkedAccounts, serviceId)
    if (!identifier) {
      triggerCopyToast('Failed to unlink account', { variant: 'destructive' })
      return
    }
    setUnlinking(serviceId)
    try {
      // 2026-05-23: onUnlinkAccount now calls the correct Privy v3 API
      // (useUnlinkOAuth/Email/Telegram with object payload). Earlier
      // usePrivy().unlinkX(subject) was a silent no-op.
      await onUnlinkAccount(serviceId, identifier)
      triggerCopyToast(`${serviceLabel} unlinked`, { variant: 'destructive' })
      // Privy's user.linkedAccounts is reactive - the parent re-renders
      // automatically. Do NOT window.location.reload() here: if the
      // unlinked provider was the current session's auth method, a hard
      // reload triggers Privy's re-auth OAuth loop and the user gets
      // bounced through Google/X back to the AuthGate password screen.
    } catch {
      triggerCopyToast('Failed to unlink account', { variant: 'destructive' })
    } finally {
      setUnlinking(null)
    }
  }

  const initial = (profile.name || 'U').charAt(0).toUpperCase()

  return (
    <section className="ud-card ud-profile">
      <div className="ud-profile-row">
        {/* Avatar - use <label> instead of <button>+ref.click(). Clicking a
            label natively opens its associated file input once. The old
            <button onClick={() => input.click()}> with the input nested
            inside opened the picker TWICE: once from the programmatic
            click and once when the click event bubbled to the input. */}
        <label className="ud-profile-avatar-wrap" role="button" tabIndex={0}>
          {profile.imageUrl ? (
            <img className="ud-profile-avatar-img" src={profile.imageUrl} alt="" />
          ) : (
            <span className="ud-profile-avatar-initial">{initial}</span>
          )}
          <span className="ud-profile-avatar-overlay">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="ud-profile-file-input"
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }}
          />
        </label>

        {/* Identity */}
        <div className="ud-profile-identity">
          <div className="ud-profile-name-row">
            {editing ? (
              <>
                <input
                  className="ud-profile-name-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  maxLength={30}
                />
                {/* Confirm checkmark - mousedown preventDefault keeps focus
                    on the input so onBlur doesn't fire and unmount us before
                    the click handler runs. */}
                <button
                  type="button"
                  className="ud-profile-confirm-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleSaveName}
                  aria-label="Save username"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </button>
              </>
            ) : (
              <>
                <span className="ud-profile-name">{profile.name}</span>
                <button type="button" className="ud-profile-edit-btn" onClick={() => { setEditName(profile.name); setEditing(true) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                </button>
              </>
            )}
          </div>
          {profile.email && <span className="ud-profile-email">{profile.email}</span>}
        </div>

        {/* Sign out - moved to row level for better layout */}
        {authenticated && (
          <button type="button" className="ud-profile-signout" onClick={onLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            Sign Out
          </button>
        )}
      </div>

      {/* Linked Accounts */}
      {authenticated && (
        <>
          <div className="ud-divider" />
          <div className="ud-linked-accounts">
            <span className="ud-linked-label">Connected Accounts</span>
            <div className="ud-linked-grid">
              {ACCOUNT_SERVICES.map((service) => {
                const isLinked = linkedIds.has(service.id)
                const isUnlinking = unlinking === service.id
                return (
                  <button
                    key={service.id}
                    type="button"
                    className={`ud-linked-tile${isLinked ? ' is-connected' : ''}`}
                    disabled={isUnlinking}
                    onClick={() => {
                      if (isLinked) {
                        handleUnlink(service.id)
                      } else {
                        onLinkAccount?.(service.id)
                      }
                    }}
                  >
                    <span className="ud-linked-tile-icon">{service.icon}</span>
                    <span className="ud-linked-tile-name">{service.label}</span>
                    {isUnlinking ? (
                      <span className="ud-linked-tile-status"><span className="ud-linked-spinner" /></span>
                    ) : isLinked ? (
                      <span className="ud-linked-tile-status">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bull)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
