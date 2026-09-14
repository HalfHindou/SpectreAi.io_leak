/**
 * YouComposer — agent-driven dashboard builder slide-over.
 *
 * The composer extends the user's existing agent (Phantom, Oracle, Cipher,
 * Herald, Titan, Wraith) with dashboard composition as a new capability.
 * Continuity is the differentiator: same agent that has been learning the
 * user since the egg hatched.
 *
 * Visual structure mirrors /docs/YOU_V2/CHATBOT_SPEC.md §Frontend slide-over UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useYouComposer from '@/hooks/useYouComposer'
import { useYouTracking } from '@/hooks/useYouTracking'
import './YouComposer.css'

const AGENT_PALETTE = {
  Phantom: { glow: 'rgba(139, 92, 246, 0.45)', tint: 'rgba(139, 92, 246, 0.16)' },
  Oracle:  { glow: 'rgba(236, 72, 153, 0.45)',  tint: 'rgba(236, 72, 153, 0.16)' },
  Cipher:  { glow: 'rgba(6, 182, 212, 0.45)',   tint: 'rgba(6, 182, 212, 0.16)' },
  Herald:  { glow: 'rgba(245, 158, 11, 0.45)',  tint: 'rgba(245, 158, 11, 0.16)' },
  Titan:   { glow: 'rgba(16, 185, 129, 0.45)',  tint: 'rgba(16, 185, 129, 0.16)' },
  Wraith:  { glow: 'rgba(245, 245, 247, 0.30)', tint: 'rgba(245, 245, 247, 0.10)' },
}

const EXAMPLE_CHIPS = [
  'Perps setup',
  'Whale watching',
  'Narrative trade',
  'On-chain alpha',
]

function readAgentProfile() {
  try {
    const raw = localStorage.getItem('spectre:agent-profile')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { agent_type: 'Wraith', level: 1 }
}

function readUserProfile() {
  try {
    const raw = localStorage.getItem('spectre:user-profile')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { motivation: 'general market intelligence', info_style: 'quick', risk_profile: 'moderate', markets: ['crypto'], tier: 0 }
}

function Avatar({ agentType }) {
  const palette = AGENT_PALETTE[agentType] || AGENT_PALETTE.Wraith
  const initial = (agentType || 'W').slice(0, 1).toUpperCase()
  return (
    <div className="you-cmp-avatar" style={{ '--agent-glow': palette.glow, '--agent-tint': palette.tint }}>
      <span>{initial}</span>
    </div>
  )
}

export default function YouComposer({ open, onClose, onPreviewDashboard, onApplyDashboard, onApplyAsNewDashboard, hasExistingLayout, dashboardId }) {
  const agentProfile = readAgentProfile()
  const userProfile = readUserProfile()
  const composer = useYouComposer({
    dashboardId,
    getAgentProfile: () => agentProfile,
    getUserProfile: () => userProfile,
  })
  const { conversation, pendingDashboard, inFlight, streamingText, error, submitIntent, reset } = composer
  const { track, EVENT_TYPES } = useYouTracking()

  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef(null)
  const scrollRef = useRef(null)

  // Auto-focus input + scroll to bottom on open
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation, inFlight])

  // Live-preview the latest dashboard upstream so the user sees it render
  // in the main You page area as the agent talks.
  useEffect(() => {
    if (open && pendingDashboard && typeof onPreviewDashboard === 'function') {
      onPreviewDashboard(pendingDashboard)
    }
  }, [open, pendingDashboard, onPreviewDashboard])

  // ESC closes
  useEffect(() => {
    if (!open) return undefined
    const handle = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, onClose])

  const handleSubmit = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (!draft.trim() || inFlight) return
    const intent = draft.trim()
    setDraft('')
    const isFirst = conversation.length === 0
    track(isFirst ? EVENT_TYPES.COMPOSER_INTENT : EVENT_TYPES.COMPOSER_REFINED, {
      dashboard_id: dashboardId,
      payload: { intent_text: intent.slice(0, 240) },
    })
    await submitIntent(intent)
  }, [draft, inFlight, conversation.length, submitIntent, track, EVENT_TYPES, dashboardId])

  const handleChipClick = useCallback((label) => {
    setDraft(label)
    inputRef.current?.focus()
  }, [])

  const applyNow = useCallback(() => {
    if (!pendingDashboard) return
    if (typeof onApplyDashboard === 'function') onApplyDashboard(pendingDashboard)
    track(EVENT_TYPES.COMPOSER_APPLIED, {
      dashboard_id: dashboardId,
      payload: {
        target: 'current',
        widget_count: pendingDashboard.widgets.length,
        widget_ids: pendingDashboard.widgets.map(w => w.widget_id),
      },
    })
    setConfirming(false)
    onClose()
  }, [pendingDashboard, onApplyDashboard, track, EVENT_TYPES, dashboardId, onClose])

  // Apply as a brand-new dashboard. Derives a name from the rationale so
  // the user gets a meaningful entry in the switcher without typing.
  const applyAsNew = useCallback(() => {
    if (!pendingDashboard || typeof onApplyAsNewDashboard !== 'function') return
    const rationale = pendingDashboard.rationale || ''
    // First three words of the rationale, capitalized — falls back to a date.
    const stub = rationale.split(/\s+/).slice(0, 3).join(' ').replace(/[^\w\s-]/g, '').trim()
    const name = stub
      ? stub.replace(/\b\w/g, (c) => c.toUpperCase())
      : `Build ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    onApplyAsNewDashboard(pendingDashboard, name)
    track(EVENT_TYPES.COMPOSER_APPLIED, {
      dashboard_id: dashboardId,
      payload: {
        target: 'new',
        new_dashboard_name: name,
        widget_count: pendingDashboard.widgets.length,
        widget_ids: pendingDashboard.widgets.map(w => w.widget_id),
      },
    })
    onClose()
  }, [pendingDashboard, onApplyAsNewDashboard, track, EVENT_TYPES, dashboardId, onClose])

  const handleApplyClick = useCallback(() => {
    if (!pendingDashboard) return
    if (hasExistingLayout) {
      setConfirming(true)
      return
    }
    applyNow()
  }, [pendingDashboard, hasExistingLayout, applyNow])

  if (!open) return null

  const agentType = agentProfile.agent_type || 'Wraith'

  return createPortal(
    <div className="you-cmp-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="you-cmp-panel" role="dialog" aria-label="Build with your agent">
        <header className="you-cmp-header">
          <Avatar agentType={agentType} />
          <div className="you-cmp-header-meta">
            <div className="you-cmp-header-name">{agentType}</div>
            <div className="you-cmp-header-sub">Your agent</div>
          </div>
          <div className="you-cmp-header-actions">
            <button className="you-cmp-icon-btn" onClick={reset} title="Start over">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </button>
            <button className="you-cmp-icon-btn" onClick={onClose} title="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
                <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
              </svg>
            </button>
          </div>
        </header>

        <div className="you-cmp-thread" ref={scrollRef}>
          {conversation.length === 0 && (
            <div className="you-cmp-intro">
              <p className="you-cmp-intro-headline">What do you want to build?</p>
              <p className="you-cmp-intro-tagline">Tell me the trade, the signal, the angle. I'll lay it out.</p>
            </div>
          )}
          {conversation.map((m, i) => (
            <div key={i} className={`you-cmp-msg you-cmp-msg--${m.role}`}>
              {m.role === 'assistant' && <Avatar agentType={agentType} />}
              <div className="you-cmp-msg-bubble">
                <span className="you-cmp-msg-author">{m.role === 'assistant' ? agentType : 'You'}</span>
                <p className="you-cmp-msg-text">{m.content}</p>
              </div>
            </div>
          ))}
          {inFlight && (
            <div className="you-cmp-msg you-cmp-msg--assistant">
              <Avatar agentType={agentType} />
              <div className="you-cmp-msg-bubble you-cmp-msg-bubble--typing">
                <span className="you-cmp-msg-author">{agentType}</span>
                {streamingText ? (
                  <p className="you-cmp-msg-text you-cmp-msg-text--stream">
                    {streamingText}
                    <span className="you-cmp-cursor" aria-hidden="true" />
                  </p>
                ) : (
                  <span className="you-cmp-typing">
                    <span /><span /><span />
                  </span>
                )}
              </div>
            </div>
          )}
          {error && (
            <div className="you-cmp-error" role="alert">{error}</div>
          )}
        </div>

        <div className="you-cmp-footer">
          {pendingDashboard && (
            confirming ? (
              <div className="you-cmp-confirm">
                <span>Replace your current dashboard?</span>
                <div className="you-cmp-confirm-actions">
                  <button className="you-cmp-btn-secondary" onClick={() => setConfirming(false)}>Keep</button>
                  <button className="you-cmp-btn-primary" onClick={applyNow}>Replace</button>
                </div>
              </div>
            ) : (
              <div className="you-cmp-apply-row">
                <button className="you-cmp-apply" onClick={handleApplyClick}>
                  <span className="you-cmp-apply-label">Apply this dashboard</span>
                  <span className="you-cmp-apply-meta">{pendingDashboard.widgets.length} widgets</span>
                </button>
                {typeof onApplyAsNewDashboard === 'function' && (
                  <button
                    type="button"
                    className="you-cmp-apply-new"
                    onClick={applyAsNew}
                    title="Save as new dashboard instead of replacing the current one"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>Save as new</span>
                  </button>
                )}
              </div>
            )
          )}

          <div className="you-cmp-chips">
            {EXAMPLE_CHIPS.map((label) => (
              <button
                key={label}
                type="button"
                className="you-cmp-chip"
                onClick={() => handleChipClick(label)}
                disabled={inFlight}
              >
                {label}
              </button>
            ))}
          </div>

          <form className="you-cmp-input-row" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="you-cmp-input"
              placeholder={inFlight ? `${agentType} is thinking…` : 'What do you want to build?'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={inFlight}
            />
            <button
              type="submit"
              className="you-cmp-send"
              disabled={!draft.trim() || inFlight}
              title="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </form>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
