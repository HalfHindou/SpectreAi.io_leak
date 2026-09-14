/**
 * Live on-chain flow — the free lane that sits under the Nansen board.
 *
 * Nansen is the authoritative cohort read and it is metered, so it now paces
 * itself to roughly one deep cycle a day. That is the right cadence for a paid
 * feed and the wrong one for a page someone is looking at, so this refreshes
 * every few minutes from two keyless providers and can carry the surface on
 * its own if either goes down — or if the credits do.
 *
 * It deliberately does NOT mimic Nansen's numbers. Free sources publish trade
 * counts and unique wallet addresses, never a USD buy/sell split, so nothing
 * here is called net flow. The two panels answer different questions and say
 * which is which.
 */
import { useEffect, useMemo, useState } from 'react'
import { fmtUsd } from './use-wallets-data'

const cx = (...a) => a.filter(Boolean).join(' ')

/**
 * A freshly launched token can genuinely be up 9,705% in a day. Printing that
 * in full is true and unreadable — it swallows the column and makes every
 * ordinary move beside it look like a rounding error.
 */
function fmtChange(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(1)}k%`
  if (a >= 100) return `${sign}${Math.round(a)}%`
  return `${sign}${a.toFixed(1)}%`
}

const CHAIN_LABEL = {
  ethereum: 'ETH', solana: 'SOL', base: 'BASE', bsc: 'BNB', arbitrum: 'ARB',
  polygon: 'POLY', avalanche: 'AVAX', optimism: 'OP',
}

let _cache = null
function fetchFlow() {
  if (_cache && Date.now() - _cache.ts < 3 * 60_000) return _cache.p
  const p = fetch('/api/token-flow?limit=40', { signal: AbortSignal.timeout(25000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => (j?.rows?.length ? j : Promise.reject(new Error('empty'))))
  _cache = { ts: Date.now(), p }
  p.catch(() => { _cache = null })
  return p
}

export default function LiveFlowPanel({ t, maxRows = 12 }) {
  const [s, setS] = useState({ data: null, loading: true, error: null })

  useEffect(() => {
    let alive = true
    const load = () => fetchFlow()
      .then((d) => { if (alive) setS({ data: d, loading: false, error: null }) })
      .catch((e) => { if (alive) setS((p) => ({ data: p.data, loading: false, error: e.message })) })
    load()
    const id = setInterval(load, 4 * 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const rows = useMemo(() => (s.data?.rows || []).slice(0, maxRows), [s.data, maxRows])

  if (s.loading && !s.data) {
    return <div className="wlp-loading">{[0, 1, 2].map((i) => <div key={i} className={`wlp-loading-row animate-shimmer stagger-${i + 1}`} />)}</div>
  }
  if (!rows.length) return null

  return (
    <section className="wlp-card wlf">
      <header className="wlp-card-head wlp-card-head--row">
        <div className="wlp-card-title-wrap">
          <span className="wlp-card-title">{t('walletsPage.liveFlow', 'Live on-chain flow')}</span>
          <span className="wlp-card-sub">
            {t('walletsPage.liveFlowSub', 'taker pressure by token · 24h · refreshed every 4 minutes')}
            <span className="wlp-age">{(s.data?.sources || []).join(' + ')}</span>
            {s.data?.degraded && (
              <span className="wlp-age is-stale">
                {s.data.promoted
                  ? t('walletsPage.flowPromoted', 'fallback list — paid placements, not organic')
                  : t('walletsPage.flowOneSource', 'one provider only')}
              </span>
            )}
          </span>
        </div>
      </header>

      <div className="wlf-rows">
        {rows.map((r) => {
          // The bar reads left for sellers, right for buyers, from the centre.
          const lean = r.walletSkew ?? r.pressure ?? 0
          const pct = Math.min(50, Math.abs(lean) * 50)
          const up = lean >= 0
          return (
            <div className="wlf-row" key={`${r.chain}:${r.contract}`}>
              <div className="wlf-id">
                <span className="wlf-sym">{r.symbol}</span>
                <span className="wlf-chain">{CHAIN_LABEL[r.chain] || String(r.chain || '').slice(0, 4).toUpperCase()}</span>
                {r.confirmed && (
                  <span className="wlf-conf" title={t('walletsPage.flowConfirmed', 'both providers saw this token independently')}>2×</span>
                )}
              </div>

              <div className="wlf-bar" aria-hidden>
                <span className="wlf-bar-mid" />
                <span
                  className={cx('wlf-bar-fill', up ? 'up' : 'dn')}
                  style={up ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }}
                />
              </div>

              <span className={cx('wlf-lean mono', up ? 'pos' : 'neg')}>
                {up ? '+' : '−'}{Math.round(Math.abs(lean) * 100)}%
              </span>
              <span className="wlf-wallets mono">
                {r.netBuyers == null
                  ? '—'
                  : `${r.netBuyers > 0 ? '+' : ''}${r.netBuyers.toLocaleString()}`}
              </span>
              <span className="wlf-vol mono">{fmtUsd(r.volume24h)}</span>
              <span className={cx('wlf-chg mono', (r.priceChange24h ?? 0) >= 0 ? 'pos' : 'neg')}>
                {fmtChange(r.priceChange24h)}
              </span>
            </div>
          )
        })}
      </div>

      <p className="wlf-note">
        {t('walletsPage.liveFlowNote',
          'Counts, not dollars — no free source publishes a USD buy/sell split. The bar is the imbalance between distinct buying and selling addresses over 24h; the number beside it is how many more of one there were. 2× marks a token both providers saw independently.')}
      </p>
    </section>
  )
}
