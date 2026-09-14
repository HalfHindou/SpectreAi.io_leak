/**
 * iPhone-style frame to preview the app in a mobile viewport.
 * Frame fits viewport; inner screen scrolls so content isn’t cut off.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import './mobile-preview-frame.css'

export default function MobilePreviewFrame({ children, onClose }) {
  const { t } = useTranslation()
  return (
    <div className="mobile-preview-outer" role="dialog" aria-label={t('mobilePreview.title', 'Mobile preview')}>
      <div className="mobile-preview-backdrop" onClick={onClose} aria-hidden />
      <div className="mobile-preview-frame">
        <div className="mobile-preview-notch" aria-hidden />
        <div className="mobile-preview-screen">
          {children}
        </div>
      </div>
      <button
        type="button"
        className="mobile-preview-close"
        onClick={onClose}
        aria-label={t('mobilePreview.close', 'Close mobile preview')}
        title={t('mobilePreview.close', 'Close mobile preview')}
      >
        ✕
      </button>
    </div>
  )
}
