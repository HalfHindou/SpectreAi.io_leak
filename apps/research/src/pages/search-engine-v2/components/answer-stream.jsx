/**
 * AnswerStream — the streaming LLM prose with inline clickable citations.
 *
 * Isolated subtree: this is the high-frequency consumer (30-60 setStates/sec
 * during token streaming). React.memo'd against `stream.text` and
 * `stream.citations` only — sibling slot updates don't bubble through.
 *
 * Inline `[n]` chips are clickable: they scroll to CitationsBar and pulse
 * the matching card. The pulse is driven by a custom event the citations
 * bar listens for, keeping this component decoupled from the citations bar
 * implementation.
 */
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import './answer-stream.css'

function AnswerStream({ stream }) {
  const { t } = useTranslation()
  const text = stream.text || ''
  const citations = stream.citations || []
  const isStreaming = stream.status === 'streaming' || stream.status === 'loading'
  const hasError = stream.status === 'error'

  // Click handler for inline citation chips. Scrolls + pulses target card.
  const handleCitationClick = useCallback((id) => {
    const el = document.getElementById(`se2-citation-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Fire a custom event the citation card listens for to play its pulse.
    el.dispatchEvent(new CustomEvent('se2-citation-pulse', { bubbles: false }))
  }, [])

  if (hasError) {
    return (
      <div className="se2-answer-card se2-answer-error">
        <div className="se2-answer-error-body">
          <strong>{t('searchEngineV2.answer.errorTitle', 'Search hit an error.')}</strong>
          <span>{stream.error || t('searchEngineV2.answer.errorUnknown', 'Unknown error. Try again.')}</span>
        </div>
      </div>
    )
  }

  if (!text && !isStreaming) return null

  return (
    <div className="se2-answer-card">
      <div className="se2-answer-header">
        <span className="se2-answer-dot" aria-hidden="true" />
        <span className="se2-answer-label">{t('searchEngineV2.answer.brandLabel', 'SPECTRE')}</span>
      </div>

      {!text && isStreaming && (
        <div className="se2-answer-skeleton" aria-hidden="true">
          <span className="se2-answer-skel-line" style={{ width: '94%' }} />
          <span className="se2-answer-skel-line" style={{ width: '88%' }} />
          <span className="se2-answer-skel-line" style={{ width: '76%' }} />
        </div>
      )}

      {text && (
        <div className="se2-answer-body">
          {renderMarkdownWithCitations(text, citations, handleCitationClick, t)}
          {isStreaming && <span className="se2-answer-cursor" aria-hidden="true" />}
        </div>
      )}
    </div>
  )
}

// Compare: only re-render when text length changes, citations change, or
// status changes. The hook gives us a new `stream` object on every update,
// so we drill into the fields that matter.
export default memo(AnswerStream, (prev, next) => (
  prev.stream.text === next.stream.text &&
  prev.stream.citations === next.stream.citations &&
  prev.stream.status === next.stream.status &&
  prev.stream.error === next.stream.error
))

/* ── Markdown rendering with inline [n] citation chips ─────────────── */

const CITATION_RE = /\[(\d+)\]/g
const BOLD_RE = /\*\*([^*]+)\*\*/g
const CODE_RE = /`([^`]+)`/g

function renderInline(text, citations, onCitationClick, keyPrefix, t) {
  // Split text on citation chips first, then process bold/code in segments.
  const parts = []
  let lastIdx = 0
  let m
  CITATION_RE.lastIndex = 0
  while ((m = CITATION_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ type: 'text', value: text.slice(lastIdx, m.index) })
    parts.push({ type: 'cite', id: parseInt(m[1], 10) })
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) parts.push({ type: 'text', value: text.slice(lastIdx) })

  return parts.map((part, i) => {
    if (part.type === 'cite') {
      const cite = citations.find((c) => c.id === part.id)
      const fallbackTitle = t
        ? t('searchEngineV2.answer.citationTooltipFallback', 'Citation {{n}}', { n: part.id })
        : `Citation ${part.id}`
      return (
        <button
          key={`${keyPrefix}-c-${i}`}
          type="button"
          className="se2-answer-citation-chip"
          onClick={() => onCitationClick(part.id)}
          title={cite ? `${cite.endpoint} · ${cite.latency_ms}ms` : fallbackTitle}
        >
          {part.id}
        </button>
      )
    }
    // Plain text segment — process inline bold + code.
    return renderTextSegment(part.value, `${keyPrefix}-t-${i}`)
  })
}

function renderTextSegment(text, keyPrefix) {
  // First pass: bold (**x**)
  // Second pass: inline code (`x`)
  // Order matters: bold takes precedence on overlap.
  const out = []
  let lastIdx = 0
  BOLD_RE.lastIndex = 0
  let m
  while ((m = BOLD_RE.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(...splitCode(text.slice(lastIdx, m.index), `${keyPrefix}-bp-${lastIdx}`))
    out.push(<strong key={`${keyPrefix}-b-${m.index}`}>{m[1]}</strong>)
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) out.push(...splitCode(text.slice(lastIdx), `${keyPrefix}-bp-${lastIdx}`))
  return out
}

function splitCode(text, keyPrefix) {
  const out = []
  let lastIdx = 0
  let m
  CODE_RE.lastIndex = 0
  while ((m = CODE_RE.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(<span key={`${keyPrefix}-tp-${lastIdx}`}>{text.slice(lastIdx, m.index)}</span>)
    out.push(<code key={`${keyPrefix}-c-${m.index}`} className="se2-answer-code">{m[1]}</code>)
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) out.push(<span key={`${keyPrefix}-tp-${lastIdx}`}>{text.slice(lastIdx)}</span>)
  return out
}

function renderMarkdownWithCitations(text, citations, onCitationClick, t) {
  const blocks = []
  const lines = text.split('\n')
  let paragraph = []
  // The label literal "TRADE ANGLE" is also the content marker the LLM emits
  // — keep the regex match on the literal, but render a localized chrome label.
  const tradeAngleLabel = t
    ? t('searchEngineV2.answer.tradeAngleLabel', 'TRADE ANGLE')
    : 'TRADE ANGLE'
  const flush = (idx) => {
    if (paragraph.length === 0) return
    const joined = paragraph.join('\n').trim()
    if (joined) {
      // Headers
      if (/^## /.test(joined)) {
        blocks.push(<h2 key={`h2-${idx}`} className="se2-answer-h2">{renderInline(joined.slice(3), citations, onCitationClick, `h2-${idx}`, t)}</h2>)
      } else if (/^### /.test(joined)) {
        blocks.push(<h3 key={`h3-${idx}`} className="se2-answer-h3">{renderInline(joined.slice(4), citations, onCitationClick, `h3-${idx}`, t)}</h3>)
      } else if (joined.startsWith('TRADE ANGLE')) {
        // Special TRADE ANGLE footer treatment
        blocks.push(
          <div key={`ta-${idx}`} className="se2-answer-trade-angle">
            <div className="se2-answer-trade-angle-label">{tradeAngleLabel}</div>
            <div className="se2-answer-trade-angle-body">
              {renderInline(joined.replace(/^TRADE ANGLE:?\s*/i, ''), citations, onCitationClick, `ta-${idx}`, t)}
            </div>
          </div>
        )
      } else {
        blocks.push(<p key={`p-${idx}`} className="se2-answer-p">{renderInline(joined, citations, onCitationClick, `p-${idx}`, t)}</p>)
      }
    }
    paragraph = []
  }
  lines.forEach((line, i) => {
    if (line.trim() === '') {
      flush(i)
    } else {
      paragraph.push(line)
    }
  })
  flush(lines.length)
  return blocks
}
