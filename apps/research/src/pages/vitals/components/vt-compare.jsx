/**
 * vt-compare.jsx — put two to four platforms next to each other.
 *
 * The page already answers "who earns the most" with a ladder. This answers the
 * question a ladder cannot: given two businesses of roughly similar size, which
 * one is actually the better business? That needs the metrics side by side, the
 * trajectories on one axis, and a plain-language read of what the table means.
 *
 * The set lives in the URL (?a=uniswap&b=pump), so a comparison is a link
 * somebody can send to a colleague.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import VtSearch from './vt-search'
import VtLogo from './vt-logo'
import VtOverlayCard, { seriesColors } from './vt-overlay-card'
import VtAnalysis from './vt-analysis'
import { byKind } from './vt-format'

const MAX = 4
const SLOTS = ['a', 'b', 'c', 'd']
const DEFAULT_SET = ['uniswap', 'pump']

export default function VtCompare() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [state, setState] = useState('idle')

  const slugs = useMemo(() => {
    const picked = SLOTS.map((k) => params.get(k)).filter(Boolean)
    return picked.length ? picked.slice(0, MAX) : DEFAULT_SET
  }, [params])

  const setSlugs = useCallback((next) => {
    const p = new URLSearchParams(params)
    SLOTS.forEach((k) => p.delete(k))
    next.slice(0, MAX).forEach((s, i) => p.set(SLOTS[i], s))
    setParams(p, { replace: true })
  }, [params, setParams])

  const add = (slug) => { if (!slugs.includes(slug) && slugs.length < MAX) setSlugs([...slugs, slug]) }
  const drop = (slug) => { if (slugs.length > 2) setSlugs(slugs.filter((s) => s !== slug)) }

  useEffect(() => {
    if (slugs.length < 2) { setData(null); return undefined }
    let cancelled = false
    setState('loading')
    fetch(`/api/vitals?fn=compare&slugs=${encodeURIComponent(slugs.join(','))}`, { signal: AbortSignal.timeout(90_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) { setData(j); setState(j.error ? 'error' : 'ok') } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [slugs.join(',')])

  const columns = data?.columns || []
  // CC-BY obliges us to credit wherever the data appears, including a table cell.
  const thirdPartySources = useMemo(() => {
    const seen = new Map()
    for (const r of data?.rows || []) if (r.thirdParty && r.source) seen.set(r.source.id, r.source)
    return [...seen.values()]
  }, [data])
  const colorOf = useMemo(() => {
    const m = new Map()
    // The set no longer consults the theme — every step is legible on both
    // surfaces — so a column keeps its colour when the lights go on.
    const palette = seriesColors()
    columns.forEach((c, i) => m.set(c.slug, palette[i % palette.length]))
    return m
  }, [columns])

  return (
    <section className="vt-compare">
      <header className="vt-compare__head">
        <div>
          <span className="vt-eyebrow">Compare</span>
          <h2>Two businesses, one table</h2>
          <p className="vt-section__sub">
            Pick up to four platforms. Every figure comes from the same window and the same
            definitions, so the comparison is like for like.
          </p>
        </div>
      </header>

      <div className="vt-compare__picker">
        <ul className="vt-compare__chips">
          {columns.map((c) => (
            <li key={c.slug}>
              <span className="vt-chipsel" style={{ '--chip-hue': colorOf.get(c.slug) }}>
                <i aria-hidden="true" />
                <VtLogo className="vt-chipsel__img" fallbackClass="vt-chipsel__fb" tint={false} logo={c.logo} slug={c.slug} name={c.name} />
                <Link to={`/vitals/${c.slug}`}>{c.name}</Link>
                {columns.length > 2 ? (
                  <button type="button" onClick={() => drop(c.slug)} aria-label={`Remove ${c.name}`}>×</button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {columns.length < MAX ? (
          <VtSearch onPick={add} exclude={slugs} placeholder="Add a platform to compare…" />
        ) : (
          <p className="vt-compare__full">Four is the limit — remove one to add another.</p>
        )}
      </div>

      {state === 'loading' ? <div className="vt-skel vt-skel--tall" aria-label="Loading comparison" /> : null}

      {state === 'error' ? (
        <div className="vt-section">
          <p className="vt-empty">That comparison could not be built. Try different platforms.</p>
        </div>
      ) : null}

      {state === 'ok' && data ? (
        <>
          {data.missing?.length ? (
            <p className="vt-note">Not tracked: {data.missing.join(', ')}.</p>
          ) : null}

          <VtOverlayCard series={data.series} columns={columns} />

          <div className="vt-section vt-cmp">
            <div className="vt-cmp__scroll">
              <table className="vt-cmp__table">
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    {columns.map((c) => (
                      <th key={c.slug} scope="col">
                        <span className="vt-cmp__col" style={{ '--chip-hue': colorOf.get(c.slug) }}>
                          <i aria-hidden="true" />
                          {c.name}
                        </span>
                        <em>{c.category}</em>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">
                        {r.label}
                        <em>{r.hint}</em>
                      </th>
                      {columns.map((c) => {
                        const v = r.values[c.slug]
                        const isBest = r.best === c.slug
                        return (
                          <td key={c.slug} className={isBest ? 'is-best' : undefined}>
                            {v == null || !Number.isFinite(v)
                              ? <span className="vt-cmp__na" title={r.firstHand ? 'We only count this on venues we read directly' : 'Not reported'}>—</span>
                              : byKind(v, r.kind)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="vt-cmp__key">
              Highlighted cell = strongest on that row. On the two valuation multiples, lower is
              stronger. A dash means the platform does not report that figure, not a zero.
              {thirdPartySources.length ? (
                <>
                  {' '}Rows marked third party are counted by somebody else and are not blended with
                  our own measurements — {thirdPartySources.map((src, i) => (
                    <span key={src.id}>
                      {i ? ', ' : ''}
                      <a href={src.url} target="_blank" rel="noopener noreferrer">{src.label}</a>
                      {` (${src.licence})`}
                    </span>
                  ))}.
                </>
              ) : null}
            </p>
          </div>

          <VtAnalysis slugs={slugs} columns={columns} />
        </>
      ) : null}
    </section>
  )
}
