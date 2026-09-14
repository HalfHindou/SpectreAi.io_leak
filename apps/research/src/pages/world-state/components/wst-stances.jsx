/**
 * Band F — figure stances. The only serif and the only prose on the page.
 *
 * The serif is Playfair Display ROMAN at 1.0625rem — never italic, never
 * hero-sized, no oversized decorative quote glyph, no wash behind the card.
 * The quotation marks are real characters in the text because the quote is
 * CONTENT, not decoration.
 *
 * Stance colours the dot and the name. It does not touch the quote and it does
 * not touch the card. A grid of red and green blocks would turn a record of
 * what people said into a scoreboard of who is on which side.
 *
 * Balance is structural, not editorial: cards are the N freshest by timestamp,
 * full stop. The footnote always discloses that ordering, and adds the lean
 * only when one stance genuinely dominates — so the reader can see the shape
 * of the sample rather than trusting it.
 *
 * No portraits, no party colours, no flags.
 */
import React, { useMemo, useState } from 'react'
import { WstBand, WstHead, WstNone, WstFoot } from './wst-band'
import { fmtLongDay, numWord } from './wst-format'

/**
 * Three, not the packet's four. Four constraints were given for this band —
 * a 3-column grid, a fixed 200px card height, a 260px band, and "max 4 cards"
 * — and the fourth cannot hold with the other three: a 4th card wraps to a
 * second row, orphaning one card under three and doubling the band to ~480px.
 * Three fills the row exactly at the specified height, and the remainder goes
 * to the expander the packet already calls for. Mobile is a single column and
 * stacks whatever it is given.
 */
const SHOWN = 3

const TONE = {
  supportive: 'bull', positive: 'bull', favourable: 'bull', favorable: 'bull',
  critical: 'bear', negative: 'bear', hostile: 'bear', opposed: 'bear',
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function Stance({ s }) {
  const [open, setOpen] = useState(false)
  const tone = TONE[String(s.stance || '').toLowerCase()] || null
  const day = fmtLongDay(s.ts)

  return (
    <button
      type="button"
      className={`wst-stance${open ? ' is-open' : ''}`}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="wst-stance-hd">
        <span className={`wst-stance-dot${tone ? ` is-${tone}` : ''}`} aria-hidden="true" />
        <span className={`wst-stance-who${tone ? ` is-${tone}` : ''}`}>{s.who}</span>
        <span className="wst-stance-age wst-num">{day}</span>
      </span>

      {/* Real quotation marks, in the text. */}
      <blockquote className={`wst-quote${open ? '' : ' is-clamped'}`}>
        {`“${String(s.quote || '').trim()}”`}
      </blockquote>

      <span className="wst-stance-ft">
        <span className="wst-stance-word">{s.stance}</span>
        {s.official && <span className="wst-chip">Official</span>}
      </span>

      {open && (
        <span className="wst-stance-attr">
          {[s.who, day, s.official ? 'official statement' : null].filter(Boolean).join(' · ')}
        </span>
      )}
    </button>
  )
}

export default function WstStances({ stances, changed }) {
  const [all, setAll] = useState(false)

  const rows = useMemo(() => {
    const list = (Array.isArray(stances) ? stances : []).filter((s) => s?.quote && s?.who)
    return [...list].sort((a, b) => (Date.parse(b?.ts) || 0) - (Date.parse(a?.ts) || 0))
  }, [stances])

  const shown = all ? rows : rows.slice(0, SHOWN)
  const rest = rows.length - shown.length

  /* Lean is reported only when one stance actually dominates the shown set. */
  const lean = useMemo(() => {
    if (shown.length < 3) return null
    const counts = new Map()
    for (const s of shown) {
      const k = String(s.stance || '').toLowerCase()
      if (k) counts.set(k, (counts.get(k) || 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (!top || top[1] / shown.length < 0.6) return null
    return `${cap(numWord(top[1]))} of the ${numWord(shown.length)} freshest stances are ${top[0]}.`
  }, [shown])

  return (
    <WstBand id="wst-stances" label="Figure stances" changed={changed}>
      <WstHead
        eyebrow="Stances"
        sub="freshest first"
        meta={rows.length ? `n=${rows.length}` : null}
        changed={changed}
      />

      {!rows.length ? (
        <WstNone>No stances recorded in this window.</WstNone>
      ) : (
        <>
          <div className="wst-stance-grid">
            {shown.map((s, i) => <Stance key={`${s.ts}-${s.who}-${i}`} s={s} />)}
          </div>
          {rest > 0 && (
            <button type="button" className="wst-more" onClick={() => setAll(true)}>
              {`${rest} more ${rest === 1 ? 'stance' : 'stances'}`}
            </button>
          )}
          <WstFoot>
            {lean ? `${lean} Ordered by time, not by view.` : 'Ordered by time, not by view.'}
          </WstFoot>
        </>
      )}
    </WstBand>
  )
}
