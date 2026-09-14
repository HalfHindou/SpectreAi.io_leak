/**
 * ProfileEditModal - Centered popup to edit display name + avatar.
 * Replaces the inline name editor that overlapped the welcome greeting.
 * Same shell for desktop and mobile (responsive in CSS).
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Camera, X, Trash2 } from 'lucide-react'
import './ProfileEditModal.css'

const MAX_NAME_LEN = 32
const MAX_AVATAR_BYTES = 400 * 1024

export default function ProfileEditModal({
  open,
  onClose,
  name = '',
  imageUrl = '',
  onSave,
  onToast,
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
      if (e.key === 'Escape') onClose()
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
    onSave?.({ name: next, imageUrl: draftImage || '' })
    onClose?.()
  }, [draftName, draftImage, onSave, onClose])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave() }
  }, [handleSave])

  if (!open) return null

  const initial = ((draftName || '').trim()[0] || '?').toUpperCase()

  return createPortal(
    <div className="profile-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="profile-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} strokeWidth={2} />
        </button>

        <div className="profile-modal-header">
          <span className="profile-modal-title">Edit profile</span>
        </div>

        <div className="profile-modal-avatar-section">
          <button
            type="button"
            className={`profile-modal-avatar ${draftImage ? 'has-image' : 'has-initial'}`}
            onClick={handlePickImage}
            aria-label={draftImage ? 'Change profile picture' : 'Add profile picture'}
          >
            <span className="profile-modal-avatar-clip">
              {draftImage ? (
                <img src={draftImage} alt="" />
              ) : (
                <span className="profile-modal-avatar-initial">{initial}</span>
              )}
            </span>
            <span className="profile-modal-avatar-camera" aria-hidden="true">
              <Camera size={14} strokeWidth={1.75} />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="profile-modal-file"
            onChange={handleFileChange}
          />
          <div className="profile-modal-avatar-actions">
            <button
              type="button"
              className="profile-modal-link"
              onClick={handlePickImage}
            >
              {draftImage ? 'Change photo' : 'Upload photo'}
            </button>
            {draftImage && (
              <button
                type="button"
                className="profile-modal-link profile-modal-link--danger"
                onClick={handleClear}
              >
                <Trash2 size={12} strokeWidth={1.75} />
                Remove
              </button>
            )}
          </div>
        </div>

        <label className="profile-modal-label" htmlFor="profile-modal-name">
          Display name
        </label>
        <input
          ref={inputRef}
          id="profile-modal-name"
          type="text"
          className="profile-modal-input"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value.slice(0, MAX_NAME_LEN))}
          onKeyDown={handleKeyDown}
          placeholder="Your name"
          maxLength={MAX_NAME_LEN}
          autoComplete="off"
        />
        <div className="profile-modal-counter">
          {(draftName || '').length}/{MAX_NAME_LEN}
        </div>

        <div className="profile-modal-actions">
          <button
            type="button"
            className="profile-modal-btn profile-modal-btn--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="profile-modal-btn profile-modal-btn--primary"
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
