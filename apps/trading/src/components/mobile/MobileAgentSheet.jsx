/**
 * MobileAgentSheet - bottom-sheet shell for the Spectre Agent on phones.
 * Mirrors the MobileSwapSheet pattern (backdrop scrim + drag-to-dismiss
 * grabber + Escape, renders only when open) and hosts the same
 * AgentChatSurface + hooks the desktop panel uses. Must render inside
 * TokenDetailsProvider (MobileTokenPage already does).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, Trash2, ChevronUp } from 'lucide-react'
import { useAgentTokenContext } from '../../hooks/useAgentTokenContext'
import { useAgentChat } from '../../hooks/useAgentChat'
import { useAgentBrief, briefForDigest } from '../../hooks/useAgentBrief'
import { useAgentVoice } from '../../hooks/useAgentVoice'
import AgentChatSurface from '../agent/AgentChatSurface'
import AgentOrdersRow from '../agent/AgentOrdersRow'
import '../agent/SpectreAgentPanel.css'
import './MobileAgentSheet.css'

/** Shell: renders nothing while closed so the data-assembly hooks in the
    inner component never run on page load (mount-gating = the cost gate).
    peek: auto-open shows a half sheet (chart stays visible), expandable -
    a full 92dvh takeover per token would be hostile on phones. */
export default function MobileAgentSheet({ open, onClose, token, onSelectToken, peek = false, autoVoice = false }) {
  if (!open) return null
  return <MobileAgentSheetInner onClose={onClose} token={token} onSelectToken={onSelectToken} peek={peek} autoVoice={autoVoice} />
}

function MobileAgentSheetInner({ onClose, token, onSelectToken, peek, autoVoice }) {
  const open = true
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [expanded, setExpanded] = useState(!peek)
  const isPeek = peek && !expanded

  const { getDigest } = useAgentTokenContext(token, { surface: 'mobile' })

  // Opening brief + voice + digest carry (mirrors SpectreAgentPanel).
  const { brief, loading: briefLoading } = useAgentBrief(token, { surface: 'mobile' })
  const voice = useAgentVoice(token, brief, { surface: 'mobile' })
  const briefRef = useRef(null)
  useEffect(() => { briefRef.current = brief }, [brief])
  const getDigestWithBrief = useCallback(() => {
    const d = getDigest?.()
    if (!d) return d
    const carry = briefForDigest(briefRef.current)
    return carry ? { ...d, agentBrief: carry } : d
  }, [getDigest])

  const chat = useAgentChat(token, { getDigest: getDigestWithBrief, surface: 'mobile' })

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => { if (open) setDragOffset(0) }, [open])

  const handleTouchStart = (e) => { startYRef.current = e.touches?.[0]?.clientY ?? null }
  const handleTouchMove = (e) => {
    if (startYRef.current == null) return
    const dy = (e.touches?.[0]?.clientY ?? startYRef.current) - startYRef.current
    if (dy > 0) setDragOffset(dy)
  }
  const handleTouchEnd = () => {
    if (dragOffset > 120) onClose?.()
    else setDragOffset(0)
    startYRef.current = null
  }

  return (
    <div className={`mas-root${isPeek ? ' mas-root--peek' : ''}`} role="dialog" aria-modal="true" aria-label="Spectre Agent">
      <button type="button" className="mas-backdrop" aria-label="Close agent" onClick={onClose} />

      <div className={`mas-sheet${isPeek ? ' mas-sheet--peek' : ''}`} style={{ transform: `translateY(${dragOffset}px)` }}>
        <div
          className="mas-grabber-region"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={isPeek ? () => setExpanded(true) : undefined}
        >
          <div className="mas-grabber" aria-hidden="true" />
        </div>

        <header className="mas-header">
          <div className="mas-identity">
            <img src="/spectre-icon.png" alt="" className="mas-logo" />
            <div className="mas-titles">
              <span className="mas-title">Spectre Agent</span>
              <span className="mas-subtitle">
                {token?.symbol || ''}{chat.meta?.degraded ? ' - limited mode' : ''}
              </span>
            </div>
          </div>
          <div className="mas-actions">
            {isPeek && (
              <button type="button" className="mas-expand" onClick={() => setExpanded(true)}>
                <ChevronUp size={12} /> Expand
              </button>
            )}
            {chat.messages.length > 0 && (
              <button type="button" className="sagent-panel__iconbtn" aria-label="Clear conversation" onClick={chat.clear}>
                <Trash2 size={15} />
              </button>
            )}
            <button type="button" className="sagent-panel__iconbtn" aria-label="Close" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="mas-body">
          <AgentChatSurface chat={chat} tokenSymbol={token?.symbol} surface="mobile" onSelectToken={onSelectToken} brief={brief} briefLoading={briefLoading} voice={voice} autoVoice={autoVoice} />
        </div>

        <AgentOrdersRow token={token} surface="mobile" />

        <div className="mas-foot">
          Analysis, not financial advice. Trades always need your confirmation.
        </div>
      </div>
    </div>
  )
}
