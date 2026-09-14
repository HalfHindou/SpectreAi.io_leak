/**
 * MonarchInput — premium chat input bar.
 * Clean design: auto-grow textarea + circular send button with upward arrow.
 * Enter sends, Shift+Enter newline. Send button appears when there's text.
 */
import { useState, useRef, useCallback } from 'react'

export default function MonarchInput({ onSend, disabled, placeholder }) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, disabled, onSend])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleInput = useCallback((e) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  const hasText = text.trim().length > 0

  return (
    <div className={`monarch-input-bar ${focused ? 'monarch-input-bar-focused' : ''} ${disabled ? 'monarch-input-bar-disabled' : ''}`}>
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className="monarch-input-textarea"
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder || 'Ask Monarch anything...'}
        rows={1}
        disabled={disabled}
        aria-label="Chat message"
      />

      {/* Send button — circle with upward arrow, appears when text exists */}
      <button
        className={`monarch-input-send ${hasText && !disabled ? 'active' : ''}`}
        onClick={handleSend}
        disabled={disabled || !hasText}
        aria-label="Send message"
        type="button"
      >
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path
            d="M12 19V5m0 0l-6 6m6-6l6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
