import { memo, useEffect, useState } from 'react'

/**
 * SmartReplyComposer — Phase 1.
 *
 * Three reply modes (Agree / Contrarian / Analytical) generate static
 * templates customized to the selected tweet's author and the current
 * token symbol. Phase 2 will swap the templates for streamed AI replies.
 *
 * "Open in X" uses Twitter web intents — no OAuth, no write permissions,
 * no new auth surface. The user's existing X session handles the post.
 */

const MODES = [
  { key: 'agree', label: 'Agree', icon: '🟢', tone: 'bull' },
  { key: 'contra', label: 'Contrarian', icon: '🔴', tone: 'bear' },
  { key: 'analytical', label: 'Analytical', icon: '🧠', tone: 'neutral' },
]

const MAX_LEN = 240

function generateReply(mode, tweet, symbol) {
  const handle = (tweet?.handle || '').replace(/^@/, '')
  const at = handle ? `@${handle}` : 'frens'
  const tag = symbol ? `$${symbol}` : 'this'

  switch (mode) {
    case 'agree':
      return `${at} solid take. ${tag} setup is exactly what i'm watching - structure is clean, narrative is shifting and the smart money is positioning early. agree on the direction, this one earns its room on the watchlist.`
    case 'contra':
      return `${at} respect the conviction but i'm on the other side of this. ${tag} is pricing in a lot already and the on-chain flow doesn't back the story yet. happy to be wrong but i need to see it before i front-run it.`
    case 'analytical':
      return `${at} interesting frame. ${tag} is a function of (1) liquidity rotating from majors, (2) holder concentration, (3) narrative beta. sentiment is one input - structure and flow are the deciding ones. data > vibes.`
    default:
      return ''
  }
}

function SmartReplyComposer({ tweet, token }) {
  const symbol = token?.symbol || ''
  const [mode, setMode] = useState('agree')
  const [draft, setDraft] = useState(() => generateReply('agree', tweet, symbol))
  const [copied, setCopied] = useState(false)

  // Regenerate when the user picks a different tweet or mode
  const tweetKey = tweet?.id || ''
  useEffect(() => {
    setDraft(generateReply(mode, tweet, symbol))
    setCopied(false)
  }, [mode, tweetKey, symbol, tweet])

  const remaining = MAX_LEN - draft.length
  const overLimit = remaining < 0

  const sourceId = tweet?._sourceTweetId || tweet?.id
  const intentUrl = (() => {
    const text = encodeURIComponent(draft)
    if (sourceId) {
      return `https://twitter.com/intent/tweet?in_reply_to=${encodeURIComponent(sourceId)}&text=${text}`
    }
    return `https://twitter.com/intent/tweet?text=${text}`
  })()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.warn('[SmartReplyComposer] clipboard error:', err)
    }
  }

  return (
    <div className="xfv-intel-section xfv-intel-reply">
      <div className="xfv-intel-section-label">SMART REPLY</div>

      <div className="xfv-intel-reply-modes" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            className={`xfv-intel-reply-mode xfv-intel-reply-mode--${m.tone} ${mode === m.key ? 'xfv-intel-reply-mode--active' : ''}`}
            onClick={() => setMode(m.key)}
          >
            <span className="xfv-intel-reply-mode-icon" aria-hidden="true">{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      <textarea
        className="xfv-intel-reply-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        spellCheck={false}
      />

      <div className={`xfv-intel-reply-counter ${overLimit ? 'xfv-intel-reply-counter--over' : ''}`}>
        {remaining} chars
      </div>

      <div className="xfv-intel-reply-actions">
        <button
          type="button"
          className="xfv-intel-reply-action xfv-intel-reply-action--ghost"
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <a
          href={intentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`xfv-intel-reply-action xfv-intel-reply-action--primary ${overLimit ? 'xfv-intel-reply-action--disabled' : ''}`}
          onClick={(e) => { if (overLimit) e.preventDefault() }}
        >
          Open in X
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </div>
  )
}

export default memo(SmartReplyComposer)
