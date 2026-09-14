/**
 * MobileGreeting - compact "Good Morning, X" row for the mobile home top.
 *
 * Tapping the avatar or name opens the ProfileEditModal (handled by the
 * parent welcome-page). The previous inline input was overlapping the
 * greeting heading and breaking the layout on smaller viewports.
 */
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import './mobile-greeting.css'

function getGreetingWord() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 22) return 'Good evening'
  return 'Good night'
}

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
)

function MobileGreeting({ dayMode = false, onEdit }) {
  const { t } = useTranslation()
  const profile = useSettingsStore((s) => s.profile)

  const name = (profile?.name || '').trim()
  const imageUrl = profile?.imageUrl || ''
  const greetingWord = useMemo(() => getGreetingWord(), [])

  const initial = (name[0] || '?').toUpperCase()

  const handleEdit = () => {
    if (typeof onEdit === 'function') onEdit()
  }

  return (
    <div className={`mg${dayMode ? ' mg--day' : ''}`}>
      <button
        type="button"
        className={`mg-avatar ${imageUrl ? 'has-image' : 'has-initial'}`}
        onClick={handleEdit}
        aria-label={t('homePage.mobileGreeting.mobilegreeting.ariaEditProfile', "Edit profile")}
      >
        <span className="mg-avatar-inner">
          {imageUrl ? (
            <img src={imageUrl} alt="" />
          ) : (
            <span className="mg-avatar-initial">{initial}</span>
          )}
        </span>
      </button>

      <div className="mg-text">
        <div className="mg-eyebrow">{greetingWord}</div>
        <button
          type="button"
          className={`mg-name${name ? '' : ' is-empty'}`}
          onClick={handleEdit}
        >
          <span className="mg-name-text">{name || 'Add your name'}</span>
          <span className="mg-name-pencil" aria-hidden="true"><PencilIcon /></span>
        </button>
      </div>
    </div>
  )
}

export default memo(MobileGreeting)
