/**
 * Band B — the diff strip.
 *
 * This strip is half of the page's argument. A document that claims to be
 * maintained has to be able to say what changed, and — just as loudly — to say
 * when nothing did. So the "no change" case is set at the SAME weight as a
 * real diff. It is not a faded placeholder; it is a record with content.
 *
 * The raw diff is reshaped for typography ONLY — capitalisation, the em dash,
 * sentence punctuation, curly quotes. No word is added, dropped or reordered,
 * and anything that does not match the known shape prints verbatim.
 */
import React, { useEffect, useState } from 'react'
import { fmtUtc, fmtLongDay, fmtAgo } from './wst-format'

/* `politics: new stance — White House (neutral): "…"` becomes
   `Politics — new stance. White House, neutral: “….”` */
const STANCE_RE = /^([a-z_]+):\s*(.+?)\s+[—–-]\s+(.+?)\s*\(([^)]+)\)\s*:\s*"([\s\S]*?)"\s*$/i
const SIMPLE_RE = /^([a-z_]+):\s*([\s\S]+)$/i

const capDomain = (s) => {
  const t = String(s).replace(/_/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const endSentence = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

export function reshapeDiff(raw) {
  const s = String(raw || '').trim()
  if (!s) return null

  const m = STANCE_RE.exec(s)
  if (m) {
    const [, domain, change, who, stance, quote] = m
    return `${capDomain(domain)} — ${change.trim()}. ${who.trim()}, ${stance.trim()}: “${endSentence(quote)}”`
  }

  const p = SIMPLE_RE.exec(s)
  if (p && p[1].length < 24) return `${capDomain(p[1])} — ${endSentence(p[2])}`

  return s
}

function ChangelogRow({ version, ts, diff, seenAt }) {
  const text = reshapeDiff(diff)
  const stamp = ts ? `${fmtLongDay(ts)} ${fmtUtc(ts)}` : (seenAt ? `seen ${fmtUtc(new Date(seenAt).toISOString())}` : null)
  return (
    <li className="wst-log-row">
      <span className="wst-log-v wst-num">v{version ?? '—'}</span>
      <span className="wst-log-t">{text || 'No change recorded.'}</span>
      {/* Printed, never a hover title — the timestamp is the record. */}
      <span className="wst-log-ts wst-num">{stamp || '—'}</span>
    </li>
  )
}

export default function WstDiff({ diff, version, prevVersion, ts, editions, history, historyState, onOpenLog, now }) {
  const [open, setOpen] = useState(false)
  const shaped = reshapeDiff(diff)

  useEffect(() => {
    if (open && typeof onOpenLog === 'function') onOpenLog()
  }, [open, onOpenLog])

  const age = Date.parse(ts)
  const ago = Number.isFinite(age) ? fmtAgo((now ?? Date.now()) - age) : null
  const priorV = prevVersion ?? (Number.isFinite(version) ? version - 1 : null)

  const serverRows = Array.isArray(history) ? history : null
  const rows = (serverRows || editions || []).slice(0, 12)

  return (
    <div className="wst-diff">
      <div className="wst-diff-strip">
        <span className="wst-eyebrow wst-eyebrow--sm">Changed</span>
        {shaped ? (
          <p className="wst-diff-txt">{shaped}</p>
        ) : (
          /* Same weight as a real diff. The strip states its silence. */
          <p className="wst-diff-txt">
            No change since v{priorV ?? '—'}
            {ago ? <span className="wst-diff-ago"> · {ago}</span> : null}
          </p>
        )}
        <button
          type="button"
          className={`wst-log-btn${open ? ' is-open' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span>Changelog</span>
          <svg className="wst-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 3.75 5 6.25l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="wst-log">
          {!serverRows && (
            /* Absence is written, not hidden (shared voice §5). */
            <p className="wst-log-note">
              {historyState === 'loading'
                ? 'Reading the changelog.'
                : 'This endpoint publishes no revision history. Listed below are the editions this tab has held; the document reports only its current one.'}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="wst-log-list">
              {rows.map((r, i) => (
                <ChangelogRow
                  key={`${r.version ?? i}-${i}`}
                  version={r.version}
                  ts={r.ts}
                  diff={r.diff}
                  seenAt={r.seenAt}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
