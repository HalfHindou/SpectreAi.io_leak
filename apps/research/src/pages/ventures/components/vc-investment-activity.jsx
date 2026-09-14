/**
 * VcInvestmentActivity — a fund's dated investment history. Real funding rounds
 * from the Spectre fundraising graph (project, date, amount, valuation, lead/
 * co-investors) merged with locally-detected portfolio changes (added/removed
 * since you last looked), as a single reverse-chronological timeline with
 * "what's new / what's long-held" tags.
 */
import React, { useMemo } from 'react'
import useVcInvestments from './useVcInvestments'
import useVcTweets from './useVcTweets'
import { handleForVc } from './vc-handles'
import { reconcileSnapshot } from './smu-vc-snapshots'
import { fmtUsdCompact, isTradeableSymbol } from './smu-shared'
import './vc-investment-activity.css'

// Tweets that read like an investment / portfolio move (vs general musings).
const SIGNAL = /\$[A-Z]{2,6}\b|\binvest|\bback(?:ed|ing|s)?\b|\bled\b|\bround\b|\braise|\bfunding\b|\bportfolio\b|announc|partner|excited to|thrilled|welcome|\bjoins?\b|new fund|leading/i

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
function ageDays(iso) {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 86400000
}
function fmtAge(iso) {
  const d = ageDays(iso)
  if (!Number.isFinite(d)) return ''
  if (d < 1) return 'today'
  if (d < 30) return `${Math.round(d)}d ago`
  if (d < 365) return `${Math.round(d / 30)}mo ago`
  return `${(d / 365).toFixed(d < 730 ? 1 : 0)}y ago`
}

export default function VcInvestmentActivity({ entity }) {
  const { rounds, coInvestors, loading } = useVcInvestments(entity)
  const handle = entity ? handleForVc(entity.id) : null
  const { tweets } = useVcTweets(handle)
  const snap = useMemo(
    () => reconcileSnapshot(entity?.id, (entity?.known_portfolio_tokens || []).filter(isTradeableSymbol)),
    [entity?.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const events = useMemo(() => {
    const list = []

    // RECENT — investment-flavored posts (the live signal; fundraising data lags
    // ~1y, so a fund's current moves live in what they announce on X).
    const flavored = (tweets || []).filter((t) => SIGNAL.test(t.text || ''))
    const recent = (flavored.length ? flavored : (tweets || [])).slice(0, 5)
    for (const t of recent) {
      list.push({ kind: 'post', date: t.created_at || t.date, text: t.text, url: t.url, handle, isNew: ageDays(t.created_at) < 21 })
    }

    for (const r of rounds) {
      list.push({
        kind: 'round',
        date: r.date,
        title: r.project,
        symbol: r.symbol,
        sub: [r.roundType, r.amount ? fmtUsdCompact(r.amount) + ' raised' : null, r.valuation ? fmtUsdCompact(r.valuation) + ' val' : null].filter(Boolean).join(' · '),
        isLead: r.isLead,
        co: r.coInvestors,
        coCount: r.coCount,
        isNew: ageDays(r.date) < 120,
      })
    }
    // locally-detected portfolio changes (added/removed since last visit)
    const now = new Date().toISOString()
    for (const t of snap.added) list.push({ kind: 'added', date: now, title: `$${t}`, sub: 'added to tracked book', isNew: true })
    for (const t of snap.removed) list.push({ kind: 'removed', date: now, title: `$${t}`, sub: 'removed from tracked book' })
    list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    return list
  }, [rounds, snap, tweets, handle])

  if (loading && events.length === 0) {
    return <div className="vcih-tab-empty">Loading dated investment history…</div>
  }
  if (events.length === 0) {
    return <div className="vcih-tab-empty">No dated funding rounds on file for {entity?.name}. Portfolio changes will be tracked from now on.</div>
  }

  return (
    <div className="via">
      <div className="via-head">
        <span className="via-title">Investment Activity</span>
        <span className="via-sub">live posts · dated rounds · co-investors</span>
      </div>

      {coInvestors && coInvestors.length > 0 && (
        <div className="via-network">
          <span className="via-network-label">Runs with</span>
          <div className="via-network-list">
            {coInvestors.map((c) => (
              <span key={c.investor} className="via-network-chip">
                {c.investor}
                <span className="via-network-count">{c.count}×</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="via-timeline">
        {events.map((e, i) => {
          const dateStr = ageDays(e.date) < 60 ? fmtAge(e.date) : fmtDate(e.date)
          if (e.kind === 'post') {
            const Wrap = e.url ? 'a' : 'div'
            return (
              <Wrap key={i} className="via-item via-item--post" {...(e.url ? { href: e.url, target: '_blank', rel: 'noopener noreferrer' } : {})}>
                <div className="via-rail"><span className="via-node" /></div>
                <div className="via-body">
                  <div className="via-row1">
                    <span className="via-tag via-tag--post">POST</span>
                    {e.handle && <span className="via-handle">@{e.handle}</span>}
                    {e.isNew && <span className="via-tag via-tag--new">NEW</span>}
                    <span className="via-date">{dateStr}</span>
                  </div>
                  <div className="via-posttext">{e.text}</div>
                </div>
              </Wrap>
            )
          }
          return (
            <div key={i} className={`via-item via-item--${e.kind}`}>
              <div className="via-rail"><span className="via-node" /></div>
              <div className="via-body">
                <div className="via-row1">
                  <span className="via-name">{e.title}</span>
                  {e.isLead && <span className="via-tag via-tag--lead">LED</span>}
                  {e.kind === 'added' && <span className="via-tag via-tag--new">NEW</span>}
                  {e.kind === 'removed' && <span className="via-tag via-tag--out">REMOVED</span>}
                  {e.kind === 'round' && e.isNew && <span className="via-tag via-tag--new">RECENT</span>}
                  <span className="via-date">{dateStr}</span>
                </div>
                {e.sub && <div className="via-sub2">{e.sub}</div>}
                {e.co && e.co.length > 0 && (
                  <div className="via-co">
                    <span className="via-co-label">with</span>
                    {e.co.map((c) => <span key={c} className="via-co-chip">{c}</span>)}
                    {e.coCount > e.co.length && <span className="via-co-more">+{e.coCount - e.co.length}</span>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
