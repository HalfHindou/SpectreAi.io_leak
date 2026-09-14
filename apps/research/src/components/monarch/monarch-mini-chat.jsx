/**
 * MonarchMiniChat — floating chat panel, bottom-right.
 * Glass design, SSE streaming, context-aware suggestions.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMonarch, useMonarchPage } from '@/contexts/MonarchContext'
import MonarchMessageBubble from './monarch-message-bubble'
import MonarchInput from './monarch-input'
import { spectreIcons } from '@/icons/spectreIcons'
import './monarch-mini-chat.css'

const PAGE_LABELS = {
  'research-platform': 'Home',
  'ai-screener': 'Token',
  'discover': 'Discover',
  'research-zone': 'Research Zone',
  'watchlists': 'Watchlists',
  'fear-greed': 'Fear & Greed',
  'heatmaps': 'Heatmaps',
  'bubbles': 'Bubbles',
  'ai-charts': 'AI Charts',
  'social-zone': 'Social',
  'news': 'News',
  'liquidation-heatmap': 'Liquidation',
  'economic-calendar': 'Calendar',
  'categories': 'Categories',
  'ventures': 'Ventures',
  'intelligence': 'Intelligence',
  'traders-corner': 'Trading',
}

function getSuggestions(context) {
  const base = ['Market brief', 'Top movers today']
  if (context.token) {
    return [`Analyze ${context.token.symbol}`, `${context.token.symbol} outlook`, ...base]
  }
  const pageMap = {
    'fear-greed': ['Explain current sentiment', 'Is it time to buy?', ...base],
    'liquidation-heatmap': ['Key liquidation levels', 'Biggest risk zones', ...base],
    'heatmaps': ['Sectors performing best', 'Heatmap analysis', ...base],
    'watchlists': ['Review my watchlist', 'Portfolio insights', ...base],
  }
  return pageMap[context.page] || base
}

export default function MonarchMiniChat() {
  const navigate = useNavigate()
  const {
    chatOpen, closeChat, messages, sendMessage,
    isStreaming, clearHistory, deleteMessage,
  } = useMonarch()
  const currentContext = useMonarchPage()

  const messagesEndRef = useRef(null)
  const [showClear, setShowClear] = useState(false)

  const goToFullChat = useCallback(() => {
    closeChat()
    navigate('/monarch-chat')
  }, [closeChat, navigate])

  // Auto-scroll on new messages or streaming updates
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Close on Escape
  useEffect(() => {
    if (!chatOpen) return
    const handler = (e) => { if (e.key === 'Escape') closeChat() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [chatOpen, closeChat])

  const handleSuggestion = useCallback((text) => {
    sendMessage(text)
  }, [sendMessage])

  const handleClear = useCallback(() => {
    clearHistory()
    setShowClear(false)
  }, [clearHistory])

  if (!chatOpen) return null

  const suggestions = getSuggestions(currentContext)
  const contextLabel = PAGE_LABELS[currentContext.page] || 'Spectre'
  const tokenLabel = currentContext.token ? ` \u00b7 ${currentContext.token.symbol}` : ''

  return createPortal(
    <div className="monarch-mini" role="dialog" aria-label="Monarch AI Chat">
      {/* Header */}
      <div className="monarch-mini-header">
        <div className="monarch-mini-header-left">
          <span className="monarch-mini-logo">{spectreIcons.monarch}</span>
          <span className="monarch-mini-title">Monarch</span>
        </div>
        <div className="monarch-mini-header-right">
          <button
            className="monarch-mini-expand"
            onClick={goToFullChat}
            title="Open full Monarch"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          {messages.length > 0 && (
            <button
              className="monarch-mini-clear"
              onClick={() => setShowClear(true)}
              title="Clear history"
            >
              {spectreIcons.trash}
            </button>
          )}
          <button className="monarch-mini-close" onClick={closeChat} aria-label="Close">
            {spectreIcons.close}
          </button>
        </div>
      </div>

      {/* Context bar */}
      <div className="monarch-mini-context">
        <span className="monarch-mini-context-dot" />
        <span className="monarch-mini-context-label">{contextLabel}{tokenLabel}</span>
      </div>

      {/* Clear confirmation */}
      {showClear && (
        <div className="monarch-mini-clear-confirm">
          <span>Clear all messages?</span>
          <button className="monarch-clear-yes" onClick={handleClear}>Clear</button>
          <button className="monarch-clear-no" onClick={() => setShowClear(false)}>Cancel</button>
        </div>
      )}

      {/* Messages area */}
      <div className="monarch-mini-messages">
        {messages.length === 0 && (
          <div className="monarch-mini-empty">
            <span className="monarch-mini-empty-icon">{spectreIcons.monarch}</span>
            <p className="monarch-mini-empty-title">Monarch Intelligence</p>
            <p className="monarch-mini-empty-sub">Ask anything about the markets</p>
          </div>
        )}
        {messages.map(msg => (
          <MonarchMessageBubble key={msg.id} message={msg} onDelete={deleteMessage} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length < 2 && !isStreaming && (
        <div className="monarch-mini-suggestions">
          {suggestions.slice(0, 4).map(s => (
            <button
              key={s}
              className="monarch-mini-chip"
              onClick={() => handleSuggestion(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <MonarchInput onSend={sendMessage} disabled={isStreaming} />
    </div>,
    document.body
  )
}
