/**
 * vt-analysis.jsx — the written read over the numbers.
 *
 * Works for one platform (`slug`) or a comparison set (`slugs`). Two rules make
 * this safe to put on a finance page:
 *
 *   1. It is generated from the SAME payload the table above is rendered from,
 *      and the server drops any sentence containing a figure it cannot trace
 *      back to that payload. The prose can be wrong about interpretation; it
 *      cannot invent a number.
 *   2. It never blocks or replaces the table. It loads after, and when
 *      generation fails the section simply is not there — a page of numbers with
 *      no essay is fine; a page with a confident essay and no numbers is not.
 */

import { useEffect, useState } from 'react'

const VERDICTS = {
  earning: { label: 'Earning', tone: 'up' },
  growing: { label: 'Growing', tone: 'up' },
  fading: { label: 'Fading', tone: 'down' },
  speculative: { label: 'Speculative', tone: 'warn' },
  unclear: { label: 'Unclear', tone: 'flat' },
}

export default function VtAnalysis({ slug = null, slugs = null, columns = [] }) {
  const [read, setRead] = useState(null)
  const [state, setState] = useState('loading')

  const key = slug || (Array.isArray(slugs) ? slugs.join(',') : '')

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    setState('loading')
    const qs = slug ? `slug=${encodeURIComponent(slug)}` : `slugs=${encodeURIComponent(key)}`
    fetch(`/api/vitals?fn=analyze&${qs}`, { signal: AbortSignal.timeout(60_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (cancelled) return
        // The route wraps the read in `analysis`; accept a bare object too so a
        // future envelope change cannot silently blank the section.
        const body = j?.analysis || j
        if (body && body.read) { setRead(body); setState('ok') } else setState('empty')
      })
      .catch(() => { if (!cancelled) setState('empty') })
    return () => { cancelled = true }
  }, [key])

  if (state === 'empty') return null

  if (state === 'loading') {
    return <div className="vt-skel vt-skel--read" aria-label="Writing the read" />
  }

  const v = VERDICTS[read.verdict] || VERDICTS.unclear
  // The model names dimension winners by slug; readers know platforms by name.
  const nameOf = (sl) => columns.find((c) => c.slug === sl)?.name || sl

  return (
    <section className="vt-section vt-read">
      <div className="vt-read__head">
        <span className="vt-eyebrow">The read</span>
        <span className={`vt-read__verdict vt-tone--${v.tone}`}>{v.label}</span>
      </div>

      <h3 className="vt-read__headline">{read.headline}</h3>
      <p className="vt-read__body">{read.read}</p>

      {read.byDimension?.length ? (
        <ul className="vt-read__dims">
          {read.byDimension.map((d) => (
            <li key={d.dimension}>
              <span className="vt-read__dim">{d.dimension}</span>
              <strong>{nameOf(d.slug)}</strong>
              <span className="vt-read__why">{d.why}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {read.strengths?.length || read.risks?.length ? (
        <div className="vt-read__cols">
          {read.strengths?.length ? (
            <div>
              <span className="vt-read__label">Working</span>
              <ul>{read.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          ) : null}
          {read.risks?.length ? (
            <div>
              <span className="vt-read__label">Watch</span>
              <ul>{read.risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="vt-read__foot">
        Written from the figures on this page. Not investment advice.
      </p>
    </section>
  )
}
