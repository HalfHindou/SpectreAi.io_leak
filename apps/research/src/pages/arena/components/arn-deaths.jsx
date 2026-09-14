/**
 * ArnDeaths — how the closes ended, over the window the engine published.
 *
 * The four bars are the whole close_reason enum, and all four are drawn even at
 * zero: a reason that never fired is a finding, and dropping it would let the
 * chart quietly re-scale around whatever happened to be common today.
 *
 * The read underneath is COMPUTED, not written. If hard stops are the plurality
 * it says so; if it becomes doa_stop tomorrow it will say that instead. A
 * hand-written conclusion under a live chart is a claim with no clock on it.
 */
import { CLOSE_REASONS, reasonLabel, words } from './arn-format'

export default function ArnDeaths({ deaths, n }) {
  const counts = CLOSE_REASONS.map((r) => ({ id: r, n: deaths?.[r] || 0 }))
  // Anything the enum has not seen before still gets drawn — the contract is
  // additive-only, so an unknown reason is new, not invalid.
  for (const k of Object.keys(deaths || {})) {
    if (!CLOSE_REASONS.includes(k)) counts.push({ id: k, n: deaths[k] })
  }
  const max = Math.max(1, ...counts.map((c) => c.n))
  const top = [...counts].sort((a, b) => b.n - a.n)[0]
  const hasDoa = (deaths?.doa_stop || 0) > 0

  const read = !n
    ? 'No closes in this window.'
    : top && top.n > 0
      ? `${words(top.n).replace(/^./, (c) => c.toUpperCase())} of the last ${words(n)} closes ended on ${reasonLabel(top.id).toLowerCase()}.`
      : 'No close reason has been published for this window.'

  return (
    <section className="arn-rail__sec">
      <header className="arn-sechead">
        <span className="arn-eyebrow">HOW THEY END</span>
        <span className="arn-meta arn-num">n={n}</span>
      </header>

      <ul className="arn-deaths">
        {counts.map((c) => (
          <li className="arn-deaths__row" key={c.id}>
            <span className={`arn-deaths__k${c.id === 'doa_stop' ? ' is-doa' : ''}`}>{reasonLabel(c.id)}</span>
            <span className="arn-deaths__track">
              <span
                className={`arn-deaths__bar${c.id === 'doa_stop' ? ' is-doa' : ''}`}
                style={{ '--k': (c.n / max).toFixed(3) }}
              />
            </span>
            <span className="arn-deaths__n arn-num">{c.n}</span>
          </li>
        ))}
      </ul>

      <p className="arn-read">{read}</p>
      {hasDoa ? (
        <p className="arn-foot-note">
          doa_stop closes a position that never worked — the stop is hit before the thesis has room.
          It is the cheapest way to be wrong.
        </p>
      ) : null}
    </section>
  )
}
