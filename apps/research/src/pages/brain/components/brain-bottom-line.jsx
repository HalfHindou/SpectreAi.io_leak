/**
 * Brain — The Bottom Line.
 *
 * The "for humans" surface. The rest of the page is a trader's desk; this is the
 * one section a normal person reads to know what's happening and what to do about
 * it. Reads the desk's additive `simple` block (headline / what happened / what
 * I'd do / plays / caution) — pure plain English, zero jargon. Absent until the
 * engine ships it → renders nothing (no gap).
 */
import React from 'react'
import useBrainDesk from './use-brain-desk'
import BrainSectionHead from './brain-section-head'
import './brain-bottom-line.css'

// Action reads as a bullish stance only when it opens with buy / holding / long.
const BULL_START = /^(buy|hold|long)/i

export default function BrainBottomLine() {
  const { simple } = useBrainDesk()
  if (!simple || typeof simple !== 'object') return null

  const { headline, what_happened, what_id_do, plays, caution } = simple
  const rows = (Array.isArray(plays) ? plays : []).filter((p) => p && p.asset).slice(0, 5)
  const hasBody = headline || what_happened || what_id_do || rows.length || caution
  if (!hasBody) return null

  return (
    <section className="bbl" aria-label="the bottom line">
      <BrainSectionHead eyebrow="In plain English" title="The Bottom Line" />
      <div className="bbl-card">
        {headline && <p className="bbl-headline">{headline}</p>}

        {(what_happened || what_id_do) && (
          <div className="bbl-cols">
            {what_happened && (
              <div className="bbl-col">
                <span className="bbl-label">What happened</span>
                <p className="bbl-body">{what_happened}</p>
              </div>
            )}
            {what_id_do && (
              <div className="bbl-col">
                <span className="bbl-label">What I&rsquo;d do</span>
                <p className="bbl-body">{what_id_do}</p>
              </div>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <div className="bbl-plays">
            {rows.map((p, i) => {
              const bull = BULL_START.test(String(p.action_plain || '').trim())
              return (
                <div key={p.asset ? `${p.asset}-${i}` : i} className="bbl-play">
                  <span className="bbl-play-asset">{p.asset}</span>
                  {p.action_plain && (
                    <span className={`bbl-play-action${bull ? ' bbl-play-action--bull' : ''}`}>
                      {p.action_plain}
                    </span>
                  )}
                  {p.why_plain && <span className="bbl-play-why">{p.why_plain}</span>}
                </div>
              )
            })}
          </div>
        )}

        {caution && <p className="bbl-caution">{caution}</p>}
      </div>
    </section>
  )
}
