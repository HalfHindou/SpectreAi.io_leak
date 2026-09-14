/**
 * SpectreSocial — per-token holder-gated feed for the Spectre AI ecosystem.
 *
 * Lives in the LeftPanel as a `Social` tab next to X / Watchlist / AI Logs.
 * Card-based Instagram/X aesthetic: avatar + display name + body + actions
 * (like, comment, share). Comments expand inline. Holder-gated posts and
 * comments via /api/social; admin emails bypass the holder check.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { isAppActive } from '../lib/idleManager'
import './SpectreSocial.css'

const TEXT_MAX = 280

// Admin allowlist mirror of CONVICTION_ADMIN_EMAILS / SOCIAL_ADMIN_EMAILS on
// the server. Used purely to decide whether the Edit button is visible —
// server still gates the actual write.
const SOCIAL_ADMIN_EMAILS = new Set(['workashard02@gmail.com'])

// 12 gradient pairs for deterministic avatar coloring.
const AVATAR_GRADIENTS = [
  ['#7c3aed', '#ec4899'],
  ['#06b6d4', '#3b82f6'],
  ['#f59e0b', '#ef4444'],
  ['#10b981', '#06b6d4'],
  ['#8b5cf6', '#6366f1'],
  ['#f43f5e', '#fb923c'],
  ['#22d3ee', '#a78bfa'],
  ['#84cc16', '#10b981'],
  ['#fb7185', '#f43f5e'],
  ['#0ea5e9', '#22d3ee'],
  ['#a855f7', '#d946ef'],
  ['#facc15', '#f97316'],
]

function chainOf(token) {
  if (!token) return null
  const nid = Number(token.networkId)
  if (nid === 1) return 'eth'
  if (nid === 56) return 'bsc'
  if (nid === 137) return 'poly'
  if (nid === 42161) return 'arb'
  if (nid === 8453) return 'base'
  if (nid === 1399811149) return 'sol'
  return null
}

function bannerGradientFor(symbol) {
  const s = String(symbol || 'SP').toUpperCase()
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  const idx = Math.abs(h) % AVATAR_GRADIENTS.length
  const [c1, c2] = AVATAR_GRADIENTS[idx]
  return `linear-gradient(135deg, ${c1}, ${c2})`
}

function elapsed(ts) {
  if (!ts) return ''
  const sec = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.round(hr / 24)
  return `${d}d`
}

function Avatar({ avatar, profileImage, size = 40 }) {
  const fontSize = Math.max(10, Math.round(size * 0.36))
  if (profileImage) {
    return <img className="ss-avatar" src={profileImage} alt="" style={{ width: size, height: size }} />
  }
  const idx = avatar?.value ?? 0
  const [c1, c2] = AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length]
  return (
    <span
      className="ss-avatar ss-avatar-gradient"
      style={{ width: size, height: size, fontSize, background: `linear-gradient(135deg, ${c1}, ${c2})` }}
      aria-hidden="true"
    >
      {avatar?.initials || '??'}
    </span>
  )
}

// Resize an image File on a canvas and return a JPEG base64 data URL.
// Banner: max 1200x320, logo: max 256x256. Quality 0.85.
async function fileToDataUrl(file, kind) {
  return new Promise((resolve, reject) => {
    const max = kind === 'logo' ? { w: 256, h: 256 } : { w: 1200, h: 320 }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Not a valid image'))
      img.onload = () => {
        let w = img.naturalWidth || img.width
        let h = img.naturalHeight || img.height
        const ratio = Math.min(max.w / w, max.h / h, 1)
        w = Math.max(1, Math.round(w * ratio))
        h = Math.max(1, Math.round(h * ratio))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function BannerEditor({ initial, symbol, existingLogo, fallbackBanner, onCancel, onSave }) {
  const [bannerData, setBannerData] = useState(initial?.bannerUrl || null)
  const [logoData, setLogoData] = useState(initial?.logoUrl || null)
  const [bannerName, setBannerName] = useState(null)
  const [logoName, setLogoName] = useState(null)
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [busy, setBusy] = useState(null) // 'banner' | 'logo' | null
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const handlePick = async (e, kind) => {
    setErr(null)
    const file = e.target?.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('Pick an image file'); return }
    if (file.size > 8 * 1024 * 1024) { setErr('Image too large (max 8MB before resize)'); return }
    setBusy(kind)
    try {
      const data = await fileToDataUrl(file, kind)
      if (kind === 'logo') { setLogoData(data); setLogoName(file.name) }
      else { setBannerData(data); setBannerName(file.name) }
    } catch (er) {
      setErr(er?.message || 'Could not load image')
    } finally { setBusy(null) }
  }

  const submit = async () => {
    setErr(null); setSaving(true)
    try {
      await onSave({
        bannerUrl: bannerData || null,
        logoUrl: logoData || null,
        name: name.trim(),
        description: description.trim(),
      })
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally { setSaving(false) }
  }

  // Portal to document.body so an ancestor with transform/filter doesn't trap
  // the position:fixed overlay inside the LeftPanel column.
  return createPortal(
    <div className="ss-banner-modal" role="dialog" aria-label="Edit community" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="ss-banner-modal-card">
        <div className="ss-banner-modal-head">
          <div className="ss-banner-modal-titles">
            <span className="ss-banner-modal-eyebrow">Spectre Social</span>
            <span className="ss-banner-modal-title">Edit ${symbol || 'community'} community</span>
          </div>
          <button type="button" className="ss-banner-modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>

        {/* Top row: logo (round, left) + banner (wide, right) */}
        <div className="ss-editor-top">
          <div className="ss-editor-logo">
            <span className="ss-editor-eyebrow">Logo</span>
            <div className="ss-editor-logo-shell">
              <div className="ss-editor-logo-preview">
                {logoData
                  ? <div className="ss-editor-logo-img" style={{ backgroundImage: `url(${logoData})` }} />
                  : existingLogo
                    ? <div className="ss-editor-logo-img" style={{ backgroundImage: `url(${existingLogo})` }} />
                    : <span className="ss-editor-logo-fallback">{(symbol || '?').slice(0, 2).toUpperCase()}</span>
                }
              </div>
              <label className="ss-editor-pick ss-editor-pick-logo" title="Upload logo">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => handlePick(e, 'logo')} />
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </label>
            </div>
          </div>

          <div className="ss-editor-banner">
            <span className="ss-editor-eyebrow">Banner</span>
            <div className="ss-editor-banner-preview">
              {bannerData
                ? <div className="ss-uploader-img" style={{ backgroundImage: `url(${bannerData})` }} />
                : fallbackBanner
                  ? <div className="ss-uploader-img" style={{ backgroundImage: fallbackBanner }} />
                  : <span className="ss-editor-placeholder">1200 × 320 · JPG / PNG / WEBP</span>
              }
              <label className="ss-editor-pick ss-editor-pick-banner">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => handlePick(e, 'banner')} />
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>{busy === 'banner' ? 'Processing…' : bannerData ? 'Change' : 'Upload'}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Community name */}
        <div className="ss-editor-field">
          <div className="ss-editor-field-head">
            <span className="ss-editor-eyebrow">Community name</span>
            <span className="ss-editor-counter mono">{60 - name.length}</span>
          </div>
          <input
            type="text"
            className="ss-text-input"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder={symbol ? `${symbol} Holders` : 'Community name'}
            maxLength={60}
          />
        </div>

        {/* Description */}
        <div className="ss-editor-field">
          <div className="ss-editor-field-head">
            <span className="ss-editor-eyebrow">Description</span>
            <span className="ss-editor-counter mono">{280 - description.length}</span>
          </div>
          <textarea
            className="ss-text-area"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 280))}
            placeholder="What's this community about? Pinned at the top of the feed."
            rows={3}
            maxLength={280}
          />
        </div>

        {err && <div className="ss-banner-err">{err}</div>}
        <div className="ss-banner-modal-actions">
          <button type="button" className="ss-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="ss-submit" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Comments({ postId, token, walletAddress, isAuthed, getAccessTokenRef, symbol, onCountChange }) {
  const [comments, setComments] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState(null)

  const chain = chainOf(token)
  const ca = token?.address

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/social/${postId}/comments`)
      if (!r.ok) return
      const j = await r.json()
      setComments(Array.isArray(j.comments) ? j.comments : [])
      setLoaded(true)
    } catch (_) { console.error(_) }
  }, [postId])

  useEffect(() => { load() }, [load])

  const submit = useCallback(async () => {
    setErr(null)
    const trimmed = text.trim()
    if (!trimmed) return
    if (!walletAddress) { setErr('Connect wallet first'); return }
    setSubmitting(true)
    try {
      const tok = getAccessTokenRef.current ? await getAccessTokenRef.current() : null
      if (!tok) { setErr('Sign in to reply'); return }
      const r = await fetch(`/api/social/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ chain, ca, walletAddress, text: trimmed }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (r.status === 403 && /holder/i.test(j?.error || '')) setErr(`You need to hold ${symbol || 'this token'} to reply.`)
        else setErr(j?.error || `Reply failed (${r.status})`)
        return
      }
      if (j?.comment) {
        setComments(prev => [j.comment, ...prev])
        onCountChange?.((c) => c + 1)
      }
      setText('')
    } catch (e) {
      setErr(e?.message || 'Reply failed')
    } finally { setSubmitting(false) }
  }, [text, walletAddress, postId, chain, ca, symbol, onCountChange, getAccessTokenRef])

  return (
    <div className="ss-comments">
      {comments.length > 0 && (
        <ul className="ss-comments-list">
          {comments.map((c) => (
            <li key={c.id} className="ss-comment">
              <Avatar avatar={c.avatar} size={24} />
              <div className="ss-comment-body">
                <div className="ss-comment-meta">
                  <span className="ss-comment-handle mono">{c.wallet}</span>
                  <span className="ss-dot">·</span>
                  <span className="ss-time mono">{elapsed(c.createdAt)}</span>
                </div>
                <p className="ss-comment-text">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {loaded && comments.length === 0 && (
        <div className="ss-comments-empty">No replies yet.</div>
      )}
      {isAuthed ? (
        <div className="ss-comment-composer">
          <input
            className="ss-comment-input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
            placeholder="Reply…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); submit() } }}
          />
          <button
            type="button"
            className="ss-comment-submit"
            onClick={submit}
            disabled={submitting || !text.trim()}
          >{submitting ? '…' : 'Reply'}</button>
        </div>
      ) : (
        <div className="ss-comments-empty">Connect wallet to reply.</div>
      )}
      {err && <div className="ss-comment-err">{err}</div>}
    </div>
  )
}

export default function SpectreSocial({ token }) {
  const chain = chainOf(token)
  const ca = token?.address
  const symbol = token?.symbol || ''

  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState(null)
  const [openComments, setOpenComments] = useState(() => new Set())
  const [banner, setBanner] = useState(null) // { bannerUrl, logoUrl, updatedAt }
  const [editOpen, setEditOpen] = useState(false)

  const { authenticated, ready, login, getAccessToken, user } = usePrivy()
  const profileImage = user?.profileImageUrl || user?.profile?.imageUrl || null
  const userEmail = user?.email?.address || null
  const userDisplay = useMemo(() => {
    if (userEmail) return userEmail.split('@')[0]
    return null
  }, [userEmail])
  const canEditBanner = !!userEmail && SOCIAL_ADMIN_EMAILS.has(userEmail.toLowerCase())

  const walletAddress = useMemo(() => {
    if (!user) return null
    const wallets = (user.linkedAccounts || user.wallets || []).filter(a => a?.type === 'wallet' || a?.address)
    if (chain === 'sol') {
      const sol = wallets.find(w => w?.chainType === 'solana' || (w?.address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w.address)))
      return sol?.address || null
    }
    const evm = wallets.find(w => w?.chainType === 'ethereum' || (w?.address && /^0x[a-fA-F0-9]{40}$/.test(w.address)))
    return evm?.address || null
  }, [user, chain])

  const getAccessTokenRef = useRef(getAccessToken)
  getAccessTokenRef.current = getAccessToken

  const load = useCallback(async () => {
    if (!chain || !ca) return
    setLoading(true)
    try {
      const headers = walletAddress ? { 'X-Caller-Wallet': walletAddress } : {}
      const [postsRes, bannerRes] = await Promise.all([
        fetch(`/api/social?chain=${chain}&ca=${encodeURIComponent(ca)}`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/social/banner?chain=${chain}&ca=${encodeURIComponent(ca)}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      if (postsRes) setPosts(Array.isArray(postsRes.posts) ? postsRes.posts : [])
      if (bannerRes) setBanner(bannerRes.banner || null)
    } catch (_) { console.error(_) } finally { setLoading(false) }
  }, [chain, ca, walletAddress])

  useEffect(() => {
    if (!chain || !ca) { setPosts([]); return }
    load()
    const iv = setInterval(() => { if (document.hidden || !isAppActive()) return; load() }, 30000)
    return () => clearInterval(iv)
  }, [chain, ca, load])

  const submit = useCallback(async () => {
    setSubmitErr(null)
    const trimmed = text.trim()
    if (!trimmed) return
    if (!walletAddress) { setSubmitErr('Connect wallet first'); return }
    setSubmitting(true)
    try {
      const tok = getAccessTokenRef.current ? await getAccessTokenRef.current() : null
      if (!tok) { setSubmitErr('Sign in to post'); setSubmitting(false); return }
      const r = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ chain, ca, walletAddress, text: trimmed }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (r.status === 403 && /holder/i.test(j?.error || '')) setSubmitErr(`You need to hold ${symbol || 'this token'} to post.`)
        else if (r.status === 429) setSubmitErr('Rate-limited — wait a few minutes.')
        else setSubmitErr(j?.error || `Post failed (${r.status})`)
        return
      }
      if (j?.post) setPosts(prev => [j.post, ...prev])
      setText('')
      setComposerOpen(false)
    } catch (err) {
      setSubmitErr(err?.message || 'Post failed')
    } finally {
      setSubmitting(false)
    }
  }, [text, walletAddress, chain, ca, symbol])

  const toggleLike = useCallback(async (postId) => {
    if (!walletAddress) { login?.(); return }
    // Optimistic — flip immediately, server reconciles on next 30s poll.
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p
      const next = !p.likedByMe
      return { ...p, likedByMe: next, likes: Math.max(0, (p.likes || 0) + (next ? 1 : -1)) }
    }))
    try {
      const tok = getAccessTokenRef.current ? await getAccessTokenRef.current() : null
      if (!tok) return
      const r = await fetch(`/api/social/${postId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ chain, ca, walletAddress }),
      })
      if (!r.ok) {
        // Revert on failure.
        setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p
          const next = !p.likedByMe
          return { ...p, likedByMe: next, likes: Math.max(0, (p.likes || 0) + (next ? 1 : -1)) }
        }))
      }
    } catch (_) {
      // Already reverted by failure path? Best effort.
    }
  }, [walletAddress, login, chain, ca])

  const toggleCommentsOpen = useCallback((postId) => {
    setOpenComments(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }, [])

  const updateCommentCount = useCallback((postId, fn) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, commentCount: typeof fn === 'function' ? fn(p.commentCount || 0) : fn } : p))
  }, [])

  const saveBanner = useCallback(async ({ bannerUrl, logoUrl, name, description }) => {
    const tok = getAccessTokenRef.current ? await getAccessTokenRef.current() : null
    if (!tok) throw new Error('Sign in required')
    const r = await fetch('/api/social/banner', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ chain, ca, walletAddress, bannerUrl, logoUrl, name, description }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error || `Save failed (${r.status})`)
    setBanner(j.banner || null)
  }, [chain, ca, walletAddress])

  if (!chain || !ca) {
    return (
      <div className="spectre-social ss-empty-state">
        <header className="ss-header">
          <span className="ss-eyebrow">Spectre Social</span>
        </header>
        <p className="ss-hint">Open a token to see its Spectre Social feed.</p>
      </div>
    )
  }

  const remaining = TEXT_MAX - text.length
  const canPost = !submitting && text.trim().length > 0 && remaining >= 0 && walletAddress

  const tokenLogo = banner?.logoUrl || token?.logo || token?.image || null
  const tokenName = token?.name || token?.symbol || ''
  const displayName = banner?.name || tokenName
  const description = banner?.description || null
  const chainBadge = ({ eth: 'Ethereum', sol: 'Solana', base: 'Base', arb: 'Arbitrum', poly: 'Polygon', bsc: 'BSC' })[chain] || chain.toUpperCase()

  return (
    <section className="spectre-social" aria-label="Spectre Social">
      {/* Token community header — banner + circular logo, optional admin edit */}
      <div className="ss-banner">
        <div
          className="ss-banner-img"
          style={banner?.bannerUrl
            ? { backgroundImage: `url(${banner.bannerUrl})` }
            : { backgroundImage: bannerGradientFor(symbol) }}
        />
        <div className="ss-banner-meta">
          <div className="ss-banner-logo-wrap">
            {tokenLogo
              ? <img className="ss-banner-logo" src={tokenLogo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              : <span className="ss-banner-logo ss-banner-logo-fallback">{(symbol || '?').slice(0, 2).toUpperCase()}</span>
            }
          </div>
          <div className="ss-banner-text">
            <span className="ss-banner-title">{displayName || symbol}</span>
            <span className="ss-banner-sub mono">${symbol} · {chainBadge}</span>
            {description && <p className="ss-banner-desc">{description}</p>}
          </div>
          {canEditBanner && (
            <button
              type="button"
              className="ss-banner-edit"
              onClick={() => setEditOpen(true)}
              aria-label="Edit community banner"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>Edit</span>
            </button>
          )}
        </div>
      </div>

      <header className="ss-header">
        <div className="ss-header-titles">
          <span className="ss-eyebrow">Spectre Social</span>
          {symbol && <span className="ss-subtitle">${symbol} community feed</span>}
        </div>
        <span className="ss-take-count mono">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</span>
      </header>

      {/* Composer */}
      {!composerOpen && (
        <button
          type="button"
          className="ss-open-composer"
          onClick={() => {
            if (!authenticated && login) { login(); return }
            setComposerOpen(true)
          }}
        >
          {authenticated ? '+ Compose your post' : 'Connect wallet to post'}
        </button>
      )}

      {composerOpen && (
        <div className="ss-composer">
          <div className="ss-composer-id">
            <Avatar avatar={{ value: 0, initials: (userDisplay || walletAddress || '??').slice(0, 2).toUpperCase() }} profileImage={profileImage} size={32} />
            <span className="ss-composer-name">{userDisplay || (walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : 'You')}</span>
          </div>
          <textarea
            className="ss-textarea"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
            placeholder={`What's happening with ${symbol || 'this token'}?`}
            rows={3}
            autoFocus
          />
          <div className="ss-composer-foot">
            <span className={`ss-charcount mono${remaining < 20 ? ' low' : ''}`}>{remaining}</span>
            {submitErr && <span className="ss-composer-err">{submitErr}</span>}
            <div className="ss-composer-actions">
              <button
                type="button"
                className="ss-cancel"
                onClick={() => { setComposerOpen(false); setText(''); setSubmitErr(null) }}
              >Cancel</button>
              <button
                type="button"
                className="ss-submit"
                onClick={submit}
                disabled={!canPost}
              >{submitting ? 'Posting…' : 'Post'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Feed */}
      {posts.length === 0 && !loading && (
        <div className="ss-empty">No posts yet. Holders post first.</div>
      )}
      {editOpen && (
        <BannerEditor
          initial={banner}
          symbol={symbol}
          existingLogo={token?.logo || token?.image || null}
          fallbackBanner={bannerGradientFor(symbol)}
          onCancel={() => setEditOpen(false)}
          onSave={async ({ bannerUrl, logoUrl, name, description }) => {
            await saveBanner({ bannerUrl, logoUrl, name, description })
            setEditOpen(false)
          }}
        />
      )}

      {posts.length > 0 && (
        <ul className="ss-feed">
          {posts.map((p) => {
            const liked = !!p.likedByMe
            const showComments = openComments.has(p.id)
            return (
              <li key={p.id} className="ss-card">
                <div className="ss-card-head">
                  <Avatar avatar={p.avatar} size={40} />
                  <div className="ss-card-id">
                    <span className="ss-card-name">{p.displayName || p.wallet}</span>
                    <div className="ss-card-meta">
                      <span className="ss-card-handle mono">{p.wallet}</span>
                      <span className="ss-dot">·</span>
                      <span className="ss-time mono">{elapsed(p.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <p className="ss-card-body">{p.text}</p>
                <div className="ss-card-actions">
                  <button
                    type="button"
                    className={`ss-action ss-like${liked ? ' liked' : ''}`}
                    onClick={() => toggleLike(p.id)}
                    aria-label={liked ? 'Unlike' : 'Like'}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                    <span className="mono">{p.likes || 0}</span>
                  </button>
                  <button
                    type="button"
                    className={`ss-action ss-comment-btn${showComments ? ' open' : ''}`}
                    onClick={() => toggleCommentsOpen(p.id)}
                    aria-label="Comments"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                    <span className="mono">{p.commentCount || 0}</span>
                  </button>
                  <button type="button" className="ss-action ss-share" aria-label="Share" disabled>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </button>
                </div>
                {showComments && (
                  <Comments
                    postId={p.id}
                    token={token}
                    walletAddress={walletAddress}
                    isAuthed={authenticated && ready}
                    getAccessTokenRef={getAccessTokenRef}
                    symbol={symbol}
                    onCountChange={(fn) => updateCommentCount(p.id, fn)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
