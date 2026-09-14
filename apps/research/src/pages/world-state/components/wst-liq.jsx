/**
 * Band H — stablecoin float and the tape it settles against.
 *
 * Shape: one display figure with its delta, then three quiet cells. The
 * contrast between the two halves is the whole point — the float is the
 * subject, the prices are the context.
 */
import React from 'react'
import { WstBand, WstHead, WstNone } from './wst-band'
import { fmtUsdB, fmtSignedPct, fmtPx, fmtLevel, toNum, isNum } from './wst-format'

function Cell({ label, value, delta }) {
  const d = toNum(delta)
  return (
    <div className="wst-stat">
      <span className="wst-stat-k">{label}</span>
      <span className="wst-stat-v wst-num">{value ?? '—'}</span>
      {d != null && (
        <span className={`wst-stat-s wst-num${d < 0 ? ' is-bear' : d > 0 ? ' is-bull' : ''}`}>
          {fmtSignedPct(d, 2)}
        </span>
      )}
    </div>
  )
}

export default function WstLiq({ stables, markets, changed }) {
  const total = toNum(stables?.total_usd_b)
  const chg = toNum(stables?.chg_7d_pct)
  const hasMarkets = isNum(markets?.btc?.px) || isNum(markets?.eth?.px) || isNum(markets?.dxy?.px ?? markets?.dxy)

  return (
    <WstBand id="wst-liq" label="Stablecoins and markets" changed={changed}>
      <WstHead eyebrow="Stablecoins" sub="float and tape" meta="24h change" changed={changed} />

      <div className="wst-liq">
        <div className="wst-liq-l">
          {total == null ? (
            <WstNone>No stablecoin float on file.</WstNone>
          ) : (
            <>
              <span className="wst-stat-k">Total float</span>
              <span className="wst-fig wst-num">{fmtUsdB(total)}</span>
              <span className={`wst-tide-sub wst-num${chg != null && chg < 0 ? ' is-bear' : chg != null && chg > 0 ? ' is-bull' : ''}`}>
                {chg != null ? `${fmtSignedPct(chg, 1)} · seven days` : 'no seven-day change on file'}
              </span>
            </>
          )}
        </div>

        <div className="wst-liq-r">
          {!hasMarkets ? (
            <WstNone>No tape on file.</WstNone>
          ) : (
            <div className="wst-stats wst-stats--3">
              <Cell label="Bitcoin" value={fmtPx(markets?.btc?.px)} delta={markets?.btc?.chg_24h_pct} />
              <Cell label="Ether" value={fmtPx(markets?.eth?.px)} delta={markets?.eth?.chg_24h_pct} />
              <Cell label="Dollar index" value={fmtLevel(markets?.dxy?.px ?? markets?.dxy)} delta={markets?.dxy?.chg_24h_pct} />
            </div>
          )}
        </div>
      </div>
    </WstBand>
  )
}
