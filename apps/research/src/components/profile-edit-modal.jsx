/**
 * ProfileEditModal - Centered popup to edit display name + avatar.
 * Replaces the inline name editor that overlapped the welcome greeting on
 * both desktop (InlineHorizontalBar) and mobile (MobileGreeting).
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { track, Events } from '@/services/analytics'
import './profile-edit-modal.css'

const MAX_NAME_LEN = 32
const MAX_AVATAR_BYTES = 400 * 1024

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19V8a2 2 0 0 0-2-2h-3.17l-1.83-2H9L7.17 6H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h17a2 2 0 0 0 2-2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export default function ProfileEditModal({
  open,
  onClose,
  name = '',
  imageUrl = '',
  onSave,
  onToast,
  dayMode = false,
}) {
  const [draftName, setDraftName] = useState(name)
  const [draftImage, setDraftImage] = useState(imageUrl)
  const fileRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setDraftName(name)
      setDraftImage(imageUrl)
    }
  }, [open, name, imageUrl])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  useEffect(() => {
    if (open && inputRef.current) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 50)
      return () => window.clearTimeout(id)
    }
  }, [open])

  const handlePickImage = useCallback(() => {
    fileRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onToast?.('Image files only')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      onToast?.('Image too large (max 400KB)')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setDraftImage(reader.result)
    }
    reader.onerror = () => onToast?.('Could not read image')
    reader.readAsDataURL(file)
  }, [onToast])

  const handleClear = useCallback(() => {
    setDraftImage('')
  }, [])

  const handleSave = useCallback(() => {
    const next = (draftName || '').trim().slice(0, MAX_NAME_LEN)
    try { track(Events.PROFILE_UPDATED, { field: 'modal' }) } catch { /* noop */ }
    onSave?.({ name: next, imageUrl: draftImage || '' })
    onClose?.()
  }, [draftName, draftImage, onSave, onClose])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave() }
  }, [handleSave])

  if (!open) return null

  const initial = ((draftName || '').trim()[0] || '?').toUpperCase()

  return createPortal(
    <div
      className={`pem-overlay${dayMode ? ' pem-overlay--day' : ''}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="pem" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="pem-close"
          onClick={onClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>

        <div className="pem-header">
          <span className="pem-title">Edit profile</span>
        </div>

        <div className="pem-avatar-section">
          <button
            type="button"
            className={`pem-avatar ${draftImage ? 'has-image' : 'has-initial'}`}
            onClick={handlePickImage}
            aria-label={draftImage ? 'Change profile picture' : 'Add profile picture'}
          >
            <span className="pem-avatar-clip">
              {draftImage ? (
                <img src={draftImage} alt="" />
              ) : (
                <span className="pem-avatar-initial">{initial}</span>
              )}
            </span>
            <span className="pem-avatar-camera" aria-hidden="true">
              <CameraIcon />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="pem-file"
            onChange={handleFileChange}
          />
          <div className="pem-avatar-actions">
            <button
              type="button"
              className="pem-link"
              onClick={handlePickImage}
            >
              {draftImage ? 'Change photo' : 'Upload photo'}
            </button>
            {draftImage && (
              <button
                type="button"
                className="pem-link pem-link--danger"
                onClick={handleClear}
              >
                <TrashIcon />
                Remove
              </button>
            )}
          </div>
        </div>

        <label className="pem-label" htmlFor="pem-name-input">
          Display name
        </label>
        <input
          ref={inputRef}
          id="pem-name-input"
          type="text"
          className="pem-input"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value.slice(0, MAX_NAME_LEN))}
          onKeyDown={handleKeyDown}
          placeholder="Your name"
          maxLength={MAX_NAME_LEN}
          autoComplete="off"
        />
        <div className="pem-counter">
          {(draftName || '').length}/{MAX_NAME_LEN}
        </div>

        <div className="pem-actions">
          <button
            type="button"
            className="pem-btn pem-btn--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pem-btn pem-btn--primary"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
