/**
 * ShareXModal - Reusable "Share to X" modal with image preview,
 * editable post description, Save/Copy/Post buttons.
 *
 * Matches the Spectre Trading Terminal's share modal UX:
 * - Branded preview card image
 * - Editable textarea with character count (280 max)
 * - Save (download PNG), Copy (clipboard), Post on X (clipboard + intent)
 * - Paste hint for attaching the image to the tweet
 */
import React, { useState, useCallback, useEffect } from 'react'
import { track, Events } from '@/services/analytics'
import { createPortal } from 'react-dom'
import './share-x-modal.css'

const XIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="share-modal-x-icon">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

export default function ShareXModal({ open, onClose, imageUrl, defaultDescription = '', filename = 'spectre_share.png', contentType = 'share' }) {
  const [description, setDescription] = useState(defaultDescription)
  const [imageCopied, setImageCopied] = useState(false)
  // null | 'copied' | 'copy-failed' | 'shared' — drives the post-click status line
  const [postState, setPostState] = useState(null)

  // Reset state when modal opens/closes or description changes
  useEffect(() => {
    if (open) {
      setDescription(defaultDescription)
      setImageCopied(false)
      setPostState(null)
    }
  }, [open, defaultDescription])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  const handleSave = useCallback(() => {
    if (!imageUrl) return
    track(Events.CONTENT_SHARED, { method: 'image_download', content_type: contentType })
    const link = document.createElement('a')
    link.download = filename
    link.href = imageUrl
    link.click()
  }, [imageUrl, filename, contentType])

  const handleCopy = useCallback(async () => {
    if (!imageUrl) return
    track(Events.CONTENT_SHARED, { method: 'image_copy', content_type: contentType })
    // 1) Try copying the image. ClipboardItem must receive a Promise<Blob>
    //    (the awaited-Blob form throws in Safari and some Chromium configs).
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blobPromise = fetch(imageUrl).then((r) => r.blob())
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
        setImageCopied(true)
        setTimeout(() => setImageCopied(false), 2000)
        return
      }
    } catch (err) {
      console.error('[ShareXModal] image clipboard copy failed, falling back to text', err)
    }
    // 2) Fallback: copy the post text so the button is never a silent no-op
    //    (Firefox has no image ClipboardItem support; non-secure contexts reject).
    try {
      await navigator.clipboard.writeText(description.trim())
      setImageCopied(true)
      setTimeout(() => setImageCopied(false), 2000)
    } catch (err) {
      console.error('[ShareXModal] clipboard copy failed entirely', err)
    }
  }, [imageUrl, contentType, description])

  const handlePostToX = useCallback(async () => {
    if (!imageUrl) return
    track(Events.CONTENT_SHARED, { method: 'x_post', content_type: contentType })

    let postText = description.trim()
    if (!postText.includes('@Spectre__Ai')) postText += '\n\nvia @Spectre__Ai'
    if (!postText.includes('spectreai.io')) postText += '\nhttps://spectreai.io'

    // Touch devices: the Web Share API attaches the IMAGE natively (share
    // sheet → X app → image already in the compose box). The intent URL can
    // never carry an image, so this is the only true attach path on mobile.
    const isTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
    if (isTouch && navigator.canShare && navigator.share) {
      try {
        const blob = await fetch(imageUrl).then((r) => r.blob())
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: postText })
          setPostState('shared')
          return
        }
      } catch (err) {
        if (err?.name === 'AbortError') return // user closed the share sheet
        // fall through to the clipboard + intent path
      }
    }

    // Desktop: copy the image to the clipboard so ⌘V in the compose box
    // attaches it. ClipboardItem must receive a Promise<Blob> — the
    // awaited-Blob form throws in Safari and some Chromium configs (this
    // silent failure was why "the image never attaches").
    let copied = false
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blobPromise = fetch(imageUrl).then((r) => r.blob())
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
        copied = true
      }
    } catch (err) {
      console.error('[ShareXModal] image clipboard copy failed', err)
    }
    setPostState(copied ? 'copied' : 'copy-failed')
    if (!copied) handleSave() // never strand the user — hand them the PNG
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(postText)}`, '_blank', 'noopener')
  }, [imageUrl, description, contentType, filename, handleSave])

  if (!open) return null

  return createPortal(
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <button className="share-modal-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="share-modal-header">
          <XIcon />
          <span className="share-modal-title">Share on X</span>
        </div>

        {/* Image preview */}
        <div className="share-modal-preview">
          {imageUrl ? (
            <img src={imageUrl} alt="Share preview" className="share-modal-image" />
          ) : (
            <div className="share-modal-placeholder">
              <div className="share-modal-spinner" />
              <span className="share-modal-loading-text">Generating preview...</span>
            </div>
          )}
        </div>

        {/* Description */}
        <label className="share-modal-label">Post Description</label>
        <textarea
          className="share-modal-textarea"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Write your post..."
          rows={3}
          maxLength={280}
        />
        <div className="share-modal-char-count">
          <span className={description.length > 260 ? 'is-warn' : ''}>{description.length}</span>/280
        </div>

        {/* Actions */}
        <div className="share-modal-actions">
          <button className="share-modal-download" onClick={handleSave} disabled={!imageUrl}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Save
          </button>
          <button className={`share-modal-copy${imageCopied ? ' is-copied' : ''}`} onClick={handleCopy} disabled={!imageUrl}>
            {imageCopied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
            {imageCopied ? 'Copied!' : 'Copy'}
          </button>
          <button className="share-modal-post" onClick={handlePostToX} disabled={!imageUrl}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Post on X
          </button>
        </div>

        {postState === 'copied' ? (
          <p className="share-modal-paste-hint is-live">
            ✓ Image copied — press {navigator.platform?.includes('Mac') ? '⌘V' : 'Ctrl+V'} inside your X post to attach it.
          </p>
        ) : postState === 'copy-failed' ? (
          <p className="share-modal-paste-hint is-warn">
            Clipboard was blocked — the PNG downloaded instead. Drag it into your X post.
          </p>
        ) : postState === 'shared' ? (
          <p className="share-modal-paste-hint is-live">✓ Shared with the image attached.</p>
        ) : (
          <p className="share-modal-paste-hint">
            Post on X copies the image to your clipboard — paste it ({navigator.platform?.includes('Mac') ? '⌘V' : 'Ctrl+V'}) directly into your post.
          </p>
        )}
      </div>
    </div>,
    document.body
  )
}
