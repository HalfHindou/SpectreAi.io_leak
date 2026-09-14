/**
 * AgentMarkdown - purpose-built renderer for the agent's answers. Not a
 * general markdown engine: exactly the constructs the model is prompted
 * to produce, styled like the terminal:
 *
 *   ### / ## headers -> section labels
 *   - bullets (one nesting level) -> styled list rows
 *   1. numbered lists
 *   **bold** / *italic* / `code`
 *   --- -> divider
 *   +x.x% / -x.x% -> bull/bear colored, num-chip font
 *   $CASHTAG -> accent highlight; clickable (opens that token) via onCashtag
 *   @handle -> clickable x.com profile link; avatar + verified badge when the
 *              x_profiles side-channel supplied them (profiles prop)
 *
 * Plain text in, React out - no dangerouslySetInnerHTML, no dependency.
 */
import React from 'react'

const PCT_RE = /([+-]\d+(?:\.\d+)?%)/g
const CASHTAG_RE = /(\$[A-Za-z][A-Za-z0-9_]{1,14})(?![\d.,])/g
// X usernames: 1-15 word chars. Negative lookbehind keeps emails/mid-word @ out.
const MENTION_RE = /((?<![\w@.])@[A-Za-z0-9_]{1,15})(?![\w@])/g

function VerifiedBadge() {
  return (
    <svg className="samd-mention__badge" viewBox="0 0 22 22" aria-label="Verified" fill="currentColor">
      <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
    </svg>
  )
}

// Inline pass: bold -> italic -> code own their content; the remaining plain
// segments get percent / mention / cashtag decoration. `opts` carries the
// interactive context: { profiles, onCashtag }.
function renderInline(text, keyBase, opts = {}) {
  const nodes = []
  let k = 0
  const push = (n) => nodes.push(React.isValidElement(n) ? React.cloneElement(n, { key: `${keyBase}-${k++}` }) : n)

  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g)
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      push(<strong className="samd-b">{decorate(part.slice(2, -2))}</strong>)
    } else if (part.startsWith('`') && part.endsWith('`')) {
      push(<code className="samd-code">{part.slice(1, -1)}</code>)
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      push(<em>{decorate(part.slice(1, -1))}</em>)
    } else {
      push(<React.Fragment>{decorate(part)}</React.Fragment>)
    }
  }
  return nodes

  function mention(seg, i) {
    const handle = seg.slice(1)
    const p = opts.profiles?.[handle.toLowerCase()]
    return (
      <a
        key={`m${i}`}
        className="samd-mention"
        href={`https://x.com/${handle}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`@${handle} on X`}
      >
        {p?.pfp && (
          <img
            className="samd-mention__pfp"
            src={p.pfp}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <span className="samd-mention__handle">@{handle}</span>
        {p?.verified && <VerifiedBadge />}
      </a>
    )
  }

  function cashtag(seg, i) {
    if (typeof opts.onCashtag === 'function') {
      return (
        <button
          key={`c${i}`}
          type="button"
          className="samd-tag samd-tag--link"
          title={`Open ${seg}`}
          onClick={() => opts.onCashtag(seg)}
        >
          {seg}
        </button>
      )
    }
    return <span key={`c${i}`} className="samd-tag">{seg}</span>
  }

  function decorate(s) {
    const out = []
    let i = 0
    for (const seg of String(s).split(PCT_RE)) {
      if (!seg) continue
      if (/^[+-]\d+(?:\.\d+)?%$/.test(seg)) {
        out.push(<span key={`p${i++}`} className={`samd-pct ${seg.startsWith('+') ? 'is-up' : 'is-down'}`}>{seg}</span>)
        continue
      }
      for (const m of seg.split(MENTION_RE)) {
        if (!m) continue
        if (/^@[A-Za-z0-9_]{1,15}$/.test(m)) { out.push(mention(m, i++)); continue }
        for (const t of m.split(CASHTAG_RE)) {
          if (!t) continue
          if (/^\$[A-Za-z][A-Za-z0-9_]{1,14}$/.test(t)) { out.push(cashtag(t, i++)); continue }
          out.push(<React.Fragment key={`t${i++}`}>{t}</React.Fragment>)
        }
      }
    }
    return out
  }
}

export default function AgentMarkdown({ text, profiles, onCashtag }) {
  const opts = { profiles, onCashtag }
  const lines = String(text || '').split('\n')
  const blocks = []
  let list = null // { items: [{ depth, content }] }
  let key = 0

  const flushList = () => {
    if (!list) return
    const items = list.items
    blocks.push(
      <ul key={`l${key++}`} className="samd-list">
        {items.map((it, i) => (
          <li key={i} className={`samd-li${it.depth > 0 ? ' samd-li--nested' : ''}`}>
            <span className="samd-dot" aria-hidden="true" />
            <span className="samd-li-text">{renderInline(it.content, `li${key}-${i}`, opts)}</span>
          </li>
        ))}
      </ul>
    )
    list = null
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()

    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line)
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      const m = bullet || numbered
      const depth = Math.min(Math.floor((m[1] || '').length / 2), 1)
      if (!list) list = { items: [] }
      list.items.push({ depth, content: m[2] })
      continue
    }
    flushList()

    if (!trimmed) continue
    if (/^-{3,}$/.test(trimmed)) { blocks.push(<div key={`d${key++}`} className="samd-hr" />); continue }
    const header = /^#{2,4}\s+(.*)$/.exec(trimmed)
    if (header) {
      blocks.push(<div key={`h${key++}`} className="samd-h">{renderInline(header[1], `h${key}`, opts)}</div>)
      continue
    }
    blocks.push(<p key={`p${key++}`} className="samd-p">{renderInline(trimmed, `p${key}`, opts)}</p>)
  }
  flushList()

  return <div className="samd">{blocks}</div>
}
