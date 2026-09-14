/**
 * MobileSettingsPanel — Right-side slide panel
 * Uses spectreIcons + exact desktop sidebar styling DNA.
 * Includes: theme, market, mood walls, token coloring, currency, language, profile editing.
 */
import { memo, useEffect, useCallback, useState } from 'react'
import { spectreIcons } from '@/icons/spectreIcons'
import { CURRENCY_LIST, LANGUAGE_LIST } from '@/lib/currencyConfig'
import { usePrivySafe } from '@/lib/use-privy-safe'
import './mobile-settings-panel.css'
import useBackDismiss from '@/hooks/use-back-dismiss'
import { chartTaMobileOverride, setChartTaMobile } from '@/lib/chart-ta-enabled'

/* Inline SVG icons for profile editing (avoids importing full icon lib) */
const CameraIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const PenIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
)

const MobileSettingsPanel = ({
  open,
  onClose,
  profile,
  dayMode,
  onDayModeChange,
  marketMode,
  onMarketModeChange,
  onNavigate,
  // New props for expanded settings
  showMoodWall,
  onMoodWallChange,
  tokenColoring,
  onTokenColoringChange,
  currency,
  onCurrencyChange,
  language,
  onLanguageChange,
  onProfileChange,
}) => {
  // Privy auth — the only mobile sign-in/out entry now that the gear opens this
  // panel instead of the header's inline dropdown. Deferred-safe: stub until the
  // lazy PrivyProvider mounts; login() pulls it in on demand.
  const privy = usePrivySafe()
  const isAuthenticated = privy?.authenticated
  const privyLogin = privy?.login
  const privyLogout = privy?.logout

  useBackDismiss(open, onClose)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lock body scroll
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const go = useCallback((pageId) => {
    onNavigate(pageId)
    onClose()
  }, [onNavigate, onClose])

  // Profile editing state
  const [editingName, setEditingName] = useState(false)
  const [chartTaOn, setChartTaOn] = useState(chartTaMobileOverride)
  const [nameValue, setNameValue] = useState('')

  // Reset editing state when panel opens
  useEffect(() => {
    if (open) {
      setEditingName(false)
      setNameValue(profile?.name || '')
    }
  }, [open, profile?.name])

  const handleNameSave = useCallback(() => {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== profile?.name) {
      onProfileChange?.({ ...profile, name: trimmed })
    }
    setEditingName(false)
  }, [nameValue, profile, onProfileChange])

  const handleAvatarChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 128
        canvas.height = 128
        const ctx = canvas.getContext('2d')
        const size = Math.min(img.width, img.height)
        const sx = (img.width - size) / 2
        const sy = (img.height - size) / 2
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
        onProfileChange?.({ ...profile, imageUrl: dataUrl })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }, [profile, onProfileChange])

  const initial = profile?.name ? profile.name[0].toUpperCase() : 'S'

  return (
    <div className={`msp-root${open ? ' is-open' : ''}`}>
      <div className="msp-backdrop" onClick={onClose} />

      <aside className="msp-panel" aria-label="Settings panel">
        {/* ── Profile (editable) ── */}
        <div className="msp-profile">
          <label className="msp-avatar msp-avatar-edit" htmlFor="msp-avatar-input" aria-label="Change profile photo">
            {profile?.imageUrl ? (
              <img src={profile.imageUrl} alt="" className="msp-avatar-img" />
            ) : profile?.avatar ? (
              <img src={profile.avatar} alt="" className="msp-avatar-img" />
            ) : (
              <span className="msp-avatar-initial">{initial}</span>
            )}
            <span className="msp-avatar-badge" aria-hidden="true">
              <CameraIcon />
            </span>
            <input id="msp-avatar-input" type="file" accept="image/*"
              onChange={handleAvatarChange} hidden />
          </label>
          <div className="msp-profile-info">
            {editingName ? (
              <input
                className="msp-name-input"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
                autoFocus
                maxLength={30}
              />
            ) : (
              <button className="msp-profile-name-btn" onClick={() => { setNameValue(profile?.name || ''); setEditingName(true) }} type="button">
                <span>{profile?.name || 'Spectre User'}</span>
                <PenIcon />
              </button>
            )}
            <span className="msp-profile-sub">Premium Member</span>
          </div>
          <button className="msp-close" onClick={onClose} type="button" aria-label="Close panel">
            {spectreIcons.close}
          </button>
        </div>

        {/* ── Quick Actions ── */}
        <div className="msp-quick-actions">
          <button className="msp-quick-btn" onClick={() => go('watchlists')} type="button">
            <span className="msp-quick-icon">{spectreIcons.star}</span>
            <span>Watchlist</span>
          </button>
          <button className="msp-quick-btn" onClick={() => go('roi-calculator')} type="button">
            <span className="msp-quick-icon">{spectreIcons.bank}</span>
            <span>Calculator</span>
          </button>
          <button className="msp-quick-btn" onClick={() => go('categories')} type="button">
            <span className="msp-quick-icon">{spectreIcons.grid}</span>
            <span>Categories</span>
          </button>
        </div>

        {/* ── Settings ── */}
        <div className="msp-settings-group">
          <div className="msp-setting-row">
            <span className="msp-setting-label">Theme</span>
            <div className="msp-toggle-group">
              <button
                type="button"
                className={`msp-toggle-opt${!dayMode ? ' active' : ''}`}
                onClick={() => onDayModeChange(false)}
              >Dark</button>
              <button
                type="button"
                className={`msp-toggle-opt${dayMode ? ' active' : ''}`}
                onClick={() => onDayModeChange(true)}
              >Light</button>
            </div>
          </div>

          <div className="msp-setting-row">
            <span className="msp-setting-label">Market</span>
            <div className="msp-toggle-group">
              <button
                type="button"
                className={`msp-toggle-opt${marketMode === 'crypto' ? ' active' : ''}`}
                onClick={() => onMarketModeChange('crypto')}
              >Crypto</button>
              <button
                type="button"
                className={`msp-toggle-opt${marketMode === 'stocks' ? ' active' : ''}`}
                onClick={() => onMarketModeChange('stocks')}
              >Stocks</button>
            </div>
          </div>

          <div className="msp-setting-row">
            <span className="msp-setting-label">Mood Walls</span>
            <button
              className={`msp-ios-switch${showMoodWall ? ' on' : ''}`}
              onClick={() => onMoodWallChange?.(!showMoodWall)}
              type="button"
              role="switch"
              aria-checked={showMoodWall}
            >
              <span className="msp-ios-switch-thumb" />
            </button>
          </div>

          {/* The chart read is still desktop-only by default. This switch is the
              ONLY way to turn it on where it matters: a home-screen PWA has no
              address bar for the ?chartTa=1 flag, and iOS gives it a separate
              storage box from Safari. Reload applies it — the gate is read once
              per mount, deliberately, so it cannot flip mid-session. */}
          <div className="msp-setting-row">
            <span className="msp-setting-label">Chart AI TA <span className="msp-setting-beta">beta</span></span>
            <button
              className={`msp-ios-switch${chartTaOn ? ' on' : ''}`}
              onClick={() => { const next = !chartTaOn; setChartTaMobile(next); setChartTaOn(next); window.location.reload() }}
              type="button"
              role="switch"
              aria-checked={chartTaOn}
              aria-label="Chart AI TA on this phone"
            >
              <span className="msp-ios-switch-thumb" />
            </button>
          </div>

          <div className="msp-setting-row">
            <span className="msp-setting-label">Token Colors</span>
            <button
              className={`msp-ios-switch${tokenColoring ? ' on' : ''}`}
              onClick={() => onTokenColoringChange?.(!tokenColoring)}
              type="button"
              role="switch"
              aria-checked={tokenColoring}
            >
              <span className="msp-ios-switch-thumb" />
            </button>
          </div>
        </div>

        {/* ── Currency ── */}
        <div className="msp-settings-group">
          <div className="msp-group-label">Currency</div>
          <div className="msp-currency-grid">
            {CURRENCY_LIST.map((c) => (
              <button
                key={c.code}
                className={`msp-currency-btn${currency === c.code ? ' active' : ''}`}
                onClick={() => onCurrencyChange?.(c.code)}
                type="button"
              >
                <span className="msp-currency-flag">{c.flag}</span>
                <span className="msp-currency-code">{c.code}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Language ── */}
        <div className="msp-settings-group">
          <div className="msp-group-label">Language</div>
          <div className="msp-lang-grid">
            {LANGUAGE_LIST.map((l) => (
              <button
                key={l.code}
                className={`msp-lang-btn${language === l.code ? ' active' : ''}`}
                onClick={() => onLanguageChange?.(l.code)}
                type="button"
              >
                <span className="msp-lang-flag">{l.flag}</span>
                <span className="msp-lang-name">{l.nativeName}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Nav Shortcuts ── */}
        <div className="msp-nav-links">
          <button className="msp-nav-link" onClick={() => go('gm-dashboard')} type="button">
            <span className="msp-nav-icon">{spectreIcons.dashboard}</span>
            <span>GM Dashboard</span>
            <span className="msp-nav-chevron">{spectreIcons.chevronRight}</span>
          </button>
          <button className="msp-nav-link" onClick={() => go('fear-greed')} type="button">
            <span className="msp-nav-icon">{spectreIcons.sentiment}</span>
            <span>Fear & Greed</span>
            <span className="msp-nav-chevron">{spectreIcons.chevronRight}</span>
          </button>
          <button className="msp-nav-link" onClick={() => go('economic-calendar')} type="button">
            <span className="msp-nav-icon">{spectreIcons.calendar}</span>
            <span>Economic Calendar</span>
            <span className="msp-nav-chevron">{spectreIcons.chevronRight}</span>
          </button>
          <button className="msp-nav-link" onClick={() => go('social-zone')} type="button">
            <span className="msp-nav-icon">{spectreIcons.user}</span>
            <span>Social Zone</span>
            <span className="msp-nav-chevron">{spectreIcons.chevronRight}</span>
          </button>
        </div>

        {/* ── Account (Privy sign-in / sign-out) ── */}
        <div className="msp-nav-links">
          {!isAuthenticated ? (
            <button className="msp-nav-link" onClick={() => { privyLogin?.(); onClose() }} type="button">
              <span className="msp-nav-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
              </span>
              <span>Sign In</span>
              <span className="msp-nav-chevron">{spectreIcons.chevronRight}</span>
            </button>
          ) : (
            <button className="msp-nav-link" onClick={() => { privyLogout?.(); onClose() }} type="button">
              <span className="msp-nav-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </span>
              <span>Sign Out</span>
              <span className="msp-nav-chevron">{spectreIcons.chevronRight}</span>
            </button>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="msp-footer">
          <span className="msp-version">Spectre AI v2.0</span>
        </div>
      </aside>
    </div>
  )
}

MobileSettingsPanel.displayName = 'MobileSettingsPanel'
export default memo(MobileSettingsPanel)
