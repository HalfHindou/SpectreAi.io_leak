/**
 * RzmAgentSheet - Mobile bottom-sheet host for the Research Zone AI Agent.
 *
 * A full-height overlay that slides up from the bottom on mobile, hosting two
 * segments:
 *   - "Chat"  reuses the desktop <RzAgentChat/> verbatim (logic NOT forked),
 *             restyled to fill the sheet via `.rzas-sheet` CSS overrides.
 *   - "Feed"  the Agent-RSS signal list, self-fetched via getAgentSignals
 *             (the same service the desktop feed uses) with a derived fallback
 *             so it is never a dead "No signals" state.
 *
 * The chat is kept mounted across open/close (after first open) so the
 * conversation survives closing the sheet — mirroring the desktop panel which
 * stays mounted via display:none. Token switch (sym change) resets the thread
 * inside RzAgentChat itself, so we don't manage that here.
 *
 * Terminal/minimal design per .claude/rules — warm-white only, no token accent,
 * no filled chat bubbles. Solid #09090b overlay background.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import RzAgentChat from './rz-agent-chat'
import { extractCatalysts, deriveSignals } from './rz-catalysts'
import { getAgentSignals } from '@/services/spectreDataApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { formatNewsTime } from '../data/rz-constants'
import './rzm-agent-sheet.css'

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

function RzmAgentSheet({
  open,
  onClose,
  symbol,
  tokenName,
  tokenLogo,
  tokenData,
  newsItems,
  social = null,
  cgId,
  isStock = false,
  dayMode = false,
  taRequest = null,
  onAgentDrawings = null,
}) {
  const { t } = useTranslation()
  const [segment, setSegment] = useState('chat') // 'chat' | 'feed'
  const [feedViewed, setFeedViewed] = useState(false)
  const [backendSignals, setBackendSignals] = useState(null) // null = not yet fetched
  // Keep the sheet (and the chat state inside it) mounted once opened.
  const [hasOpened, setHasOpened] = useState(false)

  const sym = String(symbol || '').toUpperCase()
  const displayName = tokenName || sym

  useEffect(() => { if (open) setHasOpened(true) }, [open])

  // A chart-TA request always belongs in the chat pane — landing on the feed
  // with the answer streaming out of sight reads as "nothing happened".
  useEffect(() => { if (taRequest?.id) setSegment('chat') }, [taRequest?.id])

  // Drag-to-dismiss from the header (the grabber alone is a 4px miss on a
  // phone). Same 120px threshold the trading-app sheets use.
  const dragStartYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)
  useEffect(() => { if (open) setDragOffset(0) }, [open])
  const dragHandlers = {
    onTouchStart: (e) => {
      // A touch that starts on a control (segment tabs, close) is not a drag.
      if (e.target?.closest?.('button')) { dragStartYRef.current = null; return }
      dragStartYRef.current = e.touches?.[0]?.clientY ?? null
    },
    onTouchMove: (e) => {
      if (dragStartYRef.current == null) return
      const dy = (e.touches?.[0]?.clientY ?? dragStartYRef.current) - dragStartYRef.current
      if (dy > 0) setDragOffset(dy)
    },
    onTouchEnd: () => {
      if (dragOffset > 120) onClose?.()
      else setDragOffset(0)
      dragStartYRef.current = null
    },
  }

  // ── Body scroll lock while open ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // ── Esc / hardware-back close ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ── Catalysts: derived exactly like the desktop parent (shared helper) ─────
  const catalysts = useMemo(
    () => extractCatalysts(newsItems, { limit: 6, change24h: tokenData?.change24h }),
    [newsItems, tokenData?.change24h]
  )

  // ── Agent-RSS: backend feed, gated on the Feed segment being viewed ────────
  const agentAsset = cgId || (symbol ? String(symbol).toLowerCase() : null)
  const feedEnabled = open && !isStock && !!agentAsset && feedViewed
  const activeAssetRef = useRef(agentAsset)
  // The sheet stays mounted across token switches — reset the backend feed when
  // the asset changes so token B never shows token A's agent signals, and
  // feedLoading correctly reflects a not-yet-fetched state again.
  useEffect(() => {
    activeAssetRef.current = agentAsset
    setBackendSignals(null)
  }, [agentAsset])
  const fetchAgentSignals = useCallback(() => {
    if (!feedEnabled) return
    getAgentSignals(agentAsset).then((sigs) => {
      if (activeAssetRef.current !== agentAsset) return // switched mid-flight
      setBackendSignals(Array.isArray(sigs) ? sigs : [])
    })
  }, [feedEnabled, agentAsset])
  useEffect(() => { fetchAgentSignals() }, [fetchAgentSignals])
  useAdaptivePolling(fetchAgentSignals, { interval: 60 * 1000, enabled: feedEnabled })

  // Backend feed wins when it has coverage; otherwise show the derived story so
  // the feed is never dead (mirrors research-zone-lite's displayAgentSignals).
  const derivedSignals = useMemo(
    () => (isStock ? [] : deriveSignals({ symbol: sym, tokenName, metrics: tokenData, newsItems })),
    [isStock, sym, tokenName, tokenData, newsItems]
  )
  const signals = useMemo(
    () => (backendSignals && backendSignals.length ? backendSignals : derivedSignals),
    [backendSignals, derivedSignals]
  )
  const feedLoading = feedEnabled && backendSignals === null && derivedSignals.length === 0

  const handleSelectFeed = useCallback(() => { setSegment('feed'); setFeedViewed(true) }, [])
  const handleSelectChat = useCallback(() => setSegment('chat'), [])

  if (!hasOpened) return null

  const sheet = (
    <div
      className={`rzas-root ${open ? 'rzas-open' : ''} ${dayMode ? 'app app-day-mode' : ''}`}
      aria-hidden={!open}
    >
      <div className="rzas-scrim" onClick={onClose} />

      <div
        className="rzas-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Spectre agent for ${displayName}`}
        // The open/close transform lives on the class + a transition; kill the
        // transition while dragging so the sheet tracks the finger 1:1.
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, transition: 'none' } : undefined}
      >
        {/* Drag / close header */}
        <div className="rzas-header" {...dragHandlers}>
          <div className="rzas-grabber" aria-hidden />
          <div className="rzas-header-row">
            <div className="rzas-seg" role="tablist" aria-label={t('researchPro.magentSheet.rzmagentsheet.ariaAgentView', "Agent view")}>
              <button
                type="button"
                role="tab"
                aria-selected={segment === 'chat'}
                className={`rzas-seg-btn ui-glass ${segment === 'chat' ? 'is-active' : ''}`}
                onClick={handleSelectChat}
              >
                {t('researchPro.magentSheet.rzmagentsheet.chat', "Chat")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={segment === 'feed'}
                className={`rzas-seg-btn ui-glass ${segment === 'feed' ? 'is-active' : ''}`}
                onClick={handleSelectFeed}
              >
                {t('researchPro.magentSheet.rzmagentsheet.feed', "Feed")}
              </button>
            </div>
            <button type="button" className="rzas-close ui-glass" onClick={onClose} aria-label={t('researchPro.magentSheet.rzmagentsheet.ariaCloseAgent', "Close agent")}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Body: both segments mounted; chat kept alive via display toggle */}
        <div className="rzas-body">
          <div className="rzas-pane rzas-pane-chat" style={{ display: segment === 'chat' ? 'flex' : 'none' }}>
            <RzAgentChat
              sym={sym}
              tokenName={tokenName}
              tokenLogo={tokenLogo}
              tokenData={tokenData}
              catalysts={catalysts}
              social={social}
              dayMode={dayMode}
              taRequest={taRequest}
              onAgentDrawings={onAgentDrawings}
            />
          </div>

          <div className="rzas-pane rzas-pane-feed" style={{ display: segment === 'feed' ? 'block' : 'none' }}>
            {feedLoading ? (
              <div className="rzas-feed-list" aria-busy="true" aria-label={t('researchPro.magentSheet.rzmagentsheet.ariaLoadingAgentSignals', "Loading agent signals")}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="rzas-feed-skel">
                    <div className="rzas-feed-skel-head animate-shimmer" />
                    <div className="rzas-feed-skel-line animate-shimmer" />
                    <div className="rzas-feed-skel-line rzas-feed-skel-line--short animate-shimmer" />
                  </div>
                ))}
              </div>
            ) : signals.length > 0 ? (
              <div className="rzas-feed-list" role="feed" aria-label={`Agent signals about ${displayName}`}>
                {signals.map((signal) => {
                  const dir = signal.metadata?.direction || 'neutral'
                  const ts = signal.createdAt ? Math.floor(new Date(signal.createdAt).getTime() / 1000) : null
                  return (
                    <article key={signal.id} className={`rzas-feed-item rzas-feed-item--${dir}`}>
                      <div className="rzas-feed-item-head">
                        <span className={`rzas-feed-cat rzas-feed-cat--${signal.category || 'brain'}${signal.metadata?.major ? ' rzas-feed-cat--keyevent' : ''}`}>
                          {signal.metadata?.major ? 'key event' : (signal.category || 'signal')}
                        </span>
                        {signal.score != null && <span className="rzas-feed-score">{signal.score}</span>}
                        {ts && <span className="rzas-feed-time">{formatNewsTime(ts)}</span>}
                      </div>
                      <div className="rzas-feed-headline">{signal.headline}</div>
                      {signal.detail && signal.detail !== signal.headline && (
                        <div className="rzas-feed-detail">{signal.detail}</div>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="rzas-feed-empty">
                {isStock ? 'No agent signals for stocks yet.' : 'No agent signals available'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}

export default React.memo(RzmAgentSheet)
