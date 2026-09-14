/**
 * ArnTape — the last closes the engine published, newest first.
 *
 * THE TAPE NEVER MOVES UNDER YOUR THUMB. A close that lands while you are
 * reading queues behind a pill; the pill's count is written straight to
 * textContent so a busy minute costs zero React commits, and the rows only
 * prepend when you ask for them. A feed that reorders itself while being read
 * is unusable, and on a page whose argument is "read the losses" that is fatal.
 */
import { useEffect, useRef, useState } from 'react'
import { ArnAge } from './arn-ticker'
import { assetLabel, fmtPct, fmtSize, initialsOf, reasonLabel } from './arn-format'

const CAP = 12

export default function ArnTape({ items }) {
  const [visible, setVisible] = useState([])
  const [pending, setPending] = useState([])
  const seenRef = useRef(null)
  const pillRef = useRef(null)

  useEffect(() => {
    if (!items?.length) return
    // First payload lands whole; everything after it queues.
    if (!seenRef.current) {
      seenRef.current = new Set(items.map((r) => r.key))
      setVisible(items.slice(0, CAP))
      return
    }
    const fresh = items.filter((r) => !seenRef.current.has(r.key))
    if (!fresh.length) return
    for (const f of fresh) seenRef.current.add(f.key)
    setPending((p) => [...fresh, ...p])
  }, [items])

  useEffect(() => {
    if (pillRef.current) {
      pillRef.current.textContent = `${pending.length} new ${pending.length === 1 ? 'close' : 'closes'}`
    }
  }, [pending.length])

  const flush = () => {
    setVisible((prev) => [...pending, ...prev].slice(0, CAP))
    setPending([])
  }

  // First paint comes straight from props: waiting for the mount effect showed
  // the empty line for a frame on a tape that already had twenty rows.
  const rows = (visible.length ? visible : (items || [])).slice(0, CAP)

  return (
    <section className="arn-rail__sec">
      <header className="arn-sechead">
        <span className="arn-eyebrow">THE TAPE</span>
        <span className="arn-meta arn-num">
          {items?.length || 0} closes · last <ArnAge at={rows[0]?.ts} />
        </span>
      </header>

      {pending.length > 0 ? (
        <button type="button" className="arn-newpill" onClick={flush}>
          <span aria-hidden="true">↑</span>
          <span ref={pillRef} />
        </button>
      ) : null}

      {rows.length === 0 ? (
        <p className="arn-empty-line">No closes have been published in this window.</p>
      ) : (
        <ul className="arn-tape">
          {rows.map((t) => (
            <li className="arn-tape__row" key={t.key}>
              <ArnAge at={t.ts} className="arn-tape__t arn-num" />
              <span className="arn-tape__who" title={t.trader}>{initialsOf(t.trader)}</span>
              <span className="arn-tape__asset" title={t.asset}>{assetLabel(t.asset)}</span>
              <span className={`arn-tape__side${t.side === 'short' ? ' is-short' : ''}`}>
                {t.side ? t.side.toUpperCase() : '—'}
              </span>
              <span className="arn-tape__size arn-num">{fmtSize(t.sizeUsd)}</span>
              <span className={`arn-tape__pnl arn-num${t.pnlPct > 0 ? ' is-up' : t.pnlPct < 0 ? ' is-down' : ''}`}>
                {fmtPct(t.pnlPct)}
              </span>
              <span className="arn-tape__reason">{reasonLabel(t.reason)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
