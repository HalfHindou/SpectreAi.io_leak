/**
 * Brain — What I'd trade today.
 *
 * The desk's flagship: 5 daily trade setups, one per lens (MACRO / ON-CHAIN /
 * SOCIAL / DEGEN / LEVERAGE), each a real call — action, entry, invalidation,
 * horizon, conviction — with a LIVE P&L since entry so the desk is testable.
 *
 * Design discipline (founder rejected AI-slop): no colored edge bars, no glyphs,
 * no tone-coded card chrome. Warm-white on glass, near-invisible borders, mono
 * numerals. Color appears ONLY as market semantics — the action DIRECTION on the
 * action value, the live P&L sign, safety/status chips.
 *
 * 404-absence path: if the engine hasn't shipped the endpoint, the hook errors
 * and this renders null — the section vanishes with no gap.
 */
import React, { useState } from 'react'
import useBrainSetups from './use-brain-setups'
import BrainSectionHead from './brain-section-head'
import './brain-setups.css'

const LENS = { macro: 'MACRO', onchain: 'ON-CHAIN', social: 'SOCIAL', degen: 'DEGEN', leverage: 'LEVERAGE' }
const ACTION = {
  spot_buy: { verb: 'BUY', dir: 'bull' },
  long_lev: { verb: 'LONG', dir: 'bull' },
  accumulate: { verb: 'ACCUMULATE', dir: 'bull' },
  short_lev: { verb: 'SHORT', dir: 'bear' },
  avoid: { verb: 'AVOID', dir: 'neutral', explain: 'failed safety/quality checks — do not buy' },
  stand_aside: { verb: 'NO TRADE', dir: 'neutral', explain: 'no clear edge today — the desk holds no position' },
}
const VENUE = { spot: 'spot', hyperliquid: 'hyperliquid', onchain: 'on-chain' }

/* plain-English tooltips for the trade-level cells (non-quant readers). */
const CELL_TIP = {
  Entry: 'price to enter the trade',
  Invalidation: 'the level that proves this wrong — where the desk exits',
  Horizon: 'how long the setup needs to play out',
}

/* $ only when the asset reads like a ticker; narrative names render bare. */
function assetLabel(asset) {
  const raw = String(asset || '').trim().replace(/^\$/, '')
  if (!raw) return ''
  const isTicker = raw.length <= 6 && raw === raw.toUpperCase() && /^[A-Z0-9]+$/.test(raw)
  return isTicker ? `$${raw}` : raw
}

function fmtLevel(n) {
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  if (a >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (a >= 0.01) return `$${n.toFixed(4)}`
  if (a > 0) return `$${n.toPrecision(3)}`
  return `$${n}`
}

function levelValue(v) {
  if (v == null || v === '') return null
  return typeof v === 'number' && Number.isFinite(v) ? fmtLevel(v) : String(v).trim() || null
}

function entryValue(s) {
  const p = levelValue(s.entry_price)
  if (p != null) return p
  const z = s.entry_zone
  if (z == null || z === '') return null
  if (Array.isArray(z)) {
    const parts = z.map((v) => levelValue(v)).filter(Boolean)
    return parts.length ? parts.join('–') : null
  }
  return String(z).trim() || null
}

function signedPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

function SetupCard({ s }) {
  const [open, setOpen] = useState(false)

  const meta = ACTION[s.action] || { verb: String(s.action || '').replace(/_/g, ' ').toUpperCase() || '—', dir: 'neutral' }
  const noTrade = s.action === 'stand_aside' || s.action === 'avoid'
  const asset = assetLabel(s.asset)
  const lev = Number(s.leverage)
  const showLev = (s.action === 'long_lev' || s.action === 'short_lev') && Number.isFinite(lev) && lev > 1
  const headline = noTrade ? meta.verb : `${meta.verb}${asset ? ` ${asset}` : ''}${showLev ? ` ×${lev}` : ''}`
  const venue = VENUE[s.venue] || null

  const lens = LENS[s.lens] || String(s.lens || '').toUpperCase()
  const status = s.status && s.status !== 'open' ? s.status : null
  const safety = s.safety === 'flagged' || s.safety === 'unverified' ? s.safety : null
  const conv = Number.isFinite(Number(s.conviction)) ? Math.round(Number(s.conviction)) : null

  const cells = noTrade ? [] : [
    { k: 'Entry', v: entryValue(s) },
    { k: 'Invalidation', v: levelValue(s.invalidation) },
    { k: 'Horizon', v: s.horizon ? String(s.horizon).trim() : null },
  ].filter((c) => c.v != null)

  const signals = Array.isArray(s.signals) ? s.signals.filter(Boolean) : []
  const hasDetails = !!(s.exit_logic || s.size_note || signals.length)

  const pnl = s.pnl_pct == null ? null : signedPct(s.pnl_pct)
  const pnlSign = pnl == null ? 'flat' : Number(s.pnl_pct) > 0 ? 'up' : Number(s.pnl_pct) < 0 ? 'down' : 'flat'

  return (
    <div className="bst-card">
      <div className="bst-head">
        <span className="bst-lens">{lens}</span>
        {status && <span className={`bst-status bst-status--${status}`}>{status}</span>}
      </div>

      <div className="bst-action">
        <span className={`bst-action-val bst-action-val--${meta.dir}`}>{headline}</span>
        {noTrade
          ? (asset || venue) && <span className="bst-asset-sub">{[asset, venue].filter(Boolean).join(' · ')}</span>
          : venue && <span className="bst-venue">{venue}</span>}
      </div>

      {meta.explain && <p className="bst-explain">{meta.explain}</p>}

      {cells.length > 0 && (
        <div className="bst-cells">
          {cells.map((c) => (
            <div className="bst-cell" key={c.k} title={CELL_TIP[c.k] || undefined}>
              <span className="bst-cell-k">{c.k}</span>
              <span className="bst-cell-v">{c.v}</span>
            </div>
          ))}
        </div>
      )}

      {s.thesis && <p className="bst-thesis">{s.thesis}</p>}

      <div className="bst-foot">
        {hasDetails && (
          <button type="button" className="bst-more" onClick={() => setOpen((o) => !o)}>
            {open ? 'less' : 'details'}
          </button>
        )}
        {pnl != null && (
          <span className={`bst-pnl bst-pnl--${pnlSign}`}><b>{pnl}</b><i>since entry</i></span>
        )}
        {safety && <span className={`bst-safety bst-safety--${safety}`}>{safety}</span>}
        {conv != null && <span className="bst-conv">{conv}</span>}
      </div>

      {open && hasDetails && (
        <div className="bst-expand">
          {s.exit_logic && <div className="bst-ex"><span className="bst-ex-k">Exit</span><span className="bst-ex-v">{s.exit_logic}</span></div>}
          {s.size_note && <div className="bst-ex"><span className="bst-ex-k">Size</span><span className="bst-ex-v">{s.size_note}</span></div>}
          {signals.length > 0 && (
            <ul className="bst-signals">{signals.slice(0, 6).map((sig, i) => <li key={i}>{sig}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}

function Scorecard({ scorecard }) {
  const nResolved = Number(scorecard?.n_resolved) || 0
  if (nResolved <= 0) {
    return <p className="bst-record bst-record--warm">first setups resolve at their horizons — graded automatically.</p>
  }
  const hit = Number.isFinite(Number(scorecard.hit_rate_pct)) ? Math.round(Number(scorecard.hit_rate_pct)) : null
  const avg = signedPct(scorecard.avg_pnl_pct)
  const avgSign = avg == null ? 'flat' : Number(scorecard.avg_pnl_pct) >= 0 ? 'up' : 'down'
  return (
    <p className="bst-record">
      setups record: {hit != null && <><b>{hit}%</b> hit · </>}
      {avg != null && <>avg <b className={`bst-${avgSign}`}>{avg}</b> · </>}
      <b>{nResolved}</b> resolved
    </p>
  )
}

export default function BrainSetups() {
  const { loading, error, setups, scorecard } = useBrainSetups()

  // 404-absence path: nothing to show → render nothing, no gap.
  if (error || (!loading && !setups.length)) return null

  return (
    <section className="bst">
      <BrainSectionHead
        eyebrow="The Desk"
        title="What I'd trade today"
        sub="one setup per lens · marked live since entry"
      />
      <p className="bst-lead">five lenses, one setup each — when there's no edge, the honest call is no trade.</p>
      {loading && !setups.length ? (
        <div className="bst-grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="bst-card bst-sk-card" key={i}>
              <span className="bst-sk" style={{ width: '38%', height: 10 }} />
              <span className="bst-sk" style={{ width: '68%', height: 18, marginTop: 4 }} />
              <span className="bst-sk" style={{ width: '100%', height: 34, marginTop: 6 }} />
              <span className="bst-sk" style={{ width: '90%', height: 12, marginTop: 6 }} />
              <span className="bst-sk" style={{ width: '52%', height: 12 }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="bst-grid">
            {setups.map((s, i) => <SetupCard key={s.id || `${s.lens}-${i}`} s={s} />)}
          </div>
          <Scorecard scorecard={scorecard} />
        </>
      )}
    </section>
  )
}
