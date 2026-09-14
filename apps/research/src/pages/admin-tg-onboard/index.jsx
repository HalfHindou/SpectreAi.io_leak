/**
 * Admin TG QR onboarding page — /admin/tg-onboard
 *
 * Flow:
 *   1. User pastes id, api_id, api_hash, ADMIN_KEY (saved to localStorage)
 *   2. Click "Generate QR" → POST /api/admin/tg-qr/start
 *   3. Render the qr_url as a QR code (we use a tiny inline qr generator)
 *   4. Poll /api/admin/tg-qr/poll/:tid every 2s
 *   5. State transitions render appropriately; on `approved` show success
 *
 * The session is encrypted + persisted into tg_sessions on the data API
 * side. Frontend never sees the raw session string.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { qrSvg } from './qr-svg'
import './admin-tg-onboard.css'

const STORAGE_KEY = 'spectre-tg-onboard-creds'

function loadCreds() {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveCreds(c) {
  if (typeof window === 'undefined') return
  // Don't persist admin key — keep it ephemeral.
  const { admin_key, ...rest } = c
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest))
}

export default function TgOnboardPage() {
  const [creds, setCreds] = useState(() => loadCreds())
  const [state, setState] = useState('idle')         // idle | starting | waiting | approved | error
  const [tid, setTid] = useState(null)
  const [qrUrl, setQrUrl] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)
  const [error, setError] = useState(null)
  const [persistedId, setPersistedId] = useState(null)
  const pollRef = useRef(null)
  // Hard safety cap: if the server keeps returning `waiting` forever (never
  // resolves to approved/expired), stop the 2s poll after 5 min so it can't
  // burn invocations indefinitely on a forgotten tab.
  const pollDeadlineRef = useRef(0)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const set = (k, v) => setCreds((c) => ({ ...c, [k]: v }))

  const onStart = useCallback(async () => {
    setError(null)
    if (!creds.id || !creds.api_id || !creds.api_hash || !creds.admin_key) {
      setError('Fill in id, api_id, api_hash, admin_key')
      return
    }
    setState('starting')
    saveCreds(creds)
    try {
      const r = await fetch('/api/admin/tg-qr/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': creds.admin_key },
        body: JSON.stringify({ id: creds.id, api_id: Number(creds.api_id), api_hash: creds.api_hash }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setTid(j.data?.tid)
      setQrUrl(j.data?.qr_url)
      setExpiresAt(j.data?.expires_at)
      setState('waiting')
      // Start polling (with a 5-min hard deadline - see pollDeadlineRef)
      pollDeadlineRef.current = Date.now() + 5 * 60 * 1000
      pollRef.current = setInterval(() => poll(j.data?.tid), 2000)
    } catch (e) {
      setError(e?.message || 'start failed')
      setState('error')
    }
  }, [creds])

  const poll = useCallback(async (currentTid) => {
    if (!currentTid) return
    // Safety cap: never poll past the 5-min deadline.
    if (pollDeadlineRef.current && Date.now() > pollDeadlineRef.current) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      setError('QR timed out — start again')
      setState('error')
      return
    }
    try {
      const r = await fetch(`/api/admin/tg-qr/poll/${currentTid}`, {
        headers: { 'X-Admin-Key': creds.admin_key },
      })
      const j = await r.json().catch(() => ({}))
      const s = j?.data?.state
      if (s === 'waiting') {
        if (j.data?.qr_url && j.data.qr_url !== qrUrl) {
          setQrUrl(j.data.qr_url)
          setExpiresAt(j.data.expires_at)
        }
      } else if (s === 'approved') {
        setPersistedId(j.data?.session_id || creds.id)
        setState('approved')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else if (s === 'expired') {
        setError('QR expired — start again')
        setState('error')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else if (s === 'error') {
        setError(j.data?.detail || 'unknown error')
        setState('error')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      }
    } catch (e) {
      setError(e?.message || 'poll failed')
      setState('error')
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [creds.admin_key, qrUrl])

  const onCancel = useCallback(async () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (tid && creds.admin_key) {
      try {
        await fetch(`/api/admin/tg-qr/cancel/${tid}`, {
          method: 'POST',
          headers: { 'X-Admin-Key': creds.admin_key },
        })
      } catch {}
    }
    setTid(null); setQrUrl(null); setExpiresAt(null); setState('idle')
  }, [tid, creds.admin_key])

  const onReset = () => {
    onCancel()
    setError(null); setPersistedId(null); setState('idle')
  }

  return (
    <div className="tgo">
      <header className="tgo-header">
        <h1 className="tgo-title">Telegram QR Onboarding</h1>
        <p className="tgo-sub">
          Scan one QR with your phone Telegram app. Session encrypts + persists. No SMS.
        </p>
      </header>

      {state === 'idle' || state === 'error' ? (
        <section className="tgo-form">
          <label className="tgo-label">
            <span>Session ID</span>
            <input type="text" placeholder="tg-byo-sunny" value={creds.id || ''} onChange={(e) => set('id', e.target.value)} />
          </label>
          <label className="tgo-label">
            <span>API ID</span>
            <input type="text" placeholder="from my.telegram.org" value={creds.api_id || ''} onChange={(e) => set('api_id', e.target.value)} />
          </label>
          <label className="tgo-label">
            <span>API Hash</span>
            <input type="text" placeholder="32-char hex" value={creds.api_hash || ''} onChange={(e) => set('api_hash', e.target.value)} />
          </label>
          <label className="tgo-label">
            <span>Admin Key (not stored)</span>
            <input type="password" placeholder="ADMIN_KEY env value" value={creds.admin_key || ''} onChange={(e) => set('admin_key', e.target.value)} />
          </label>
          <div className="tgo-actions">
            <button type="button" className="tgo-btn" onClick={onStart}>Generate QR</button>
            {state === 'error' && error && <div className="tgo-error">{error}</div>}
          </div>
          <p className="tgo-hint">
            Get <code>api_id</code> + <code>api_hash</code> at <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">my.telegram.org/apps</a> (one-time, takes 30s).
          </p>
        </section>
      ) : null}

      {state === 'starting' && <div className="tgo-status">opening session…</div>}

      {state === 'waiting' && qrUrl && (
        <section className="tgo-qr-wrap">
          <div className="tgo-qr" dangerouslySetInnerHTML={{ __html: qrSvg(qrUrl) }} />
          <div className="tgo-qr-info">
            <p>1. Open <strong>Telegram</strong> on your phone</p>
            <p>2. Settings → <strong>Devices</strong> → <strong>Link Desktop Device</strong></p>
            <p>3. Scan this QR</p>
            <p>4. Approve the sign-in</p>
          </div>
          <div className="tgo-qr-meta">
            <span>tid: <code>{tid}</code></span>
            {expiresAt && <span>QR rotates every ~30s; auto-refreshing</span>}
          </div>
          <button type="button" className="tgo-btn tgo-btn--ghost" onClick={onCancel}>Cancel</button>
        </section>
      )}

      {state === 'approved' && (
        <section className="tgo-success">
          <div className="tgo-success-mark">✓</div>
          <h2>Session persisted as <code>{persistedId}</code></h2>
          <p>The Telegram MTProto pool now has +1 active session.</p>
          <p>Recommended: leave the session idle for ~7 days before letting auto-discover use it for fresh joins (warm-up).</p>
          <button type="button" className="tgo-btn" onClick={onReset}>Add another</button>
        </section>
      )}
    </div>
  )
}
