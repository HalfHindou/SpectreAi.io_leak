/*
 * PGReceipts - "Proof Timeline: Called Before The Move"
 *
 * THE proof surface of Potential Gainers. Reads /api/momentum/setups/receipts
 * (model=first_ever): each receipt is a token's FIRST-EVER PG appearance,
 * returns measured ONLY from that first appearance forward.
 *
 * Framed as a chronological proof timeline. Each entry shows the honest
 * one-liner story: "Flagged May 14 at $2.95M → now +198%, peak +235%"
 *
 * Layout: top receipt is featured full-width with a prominent proof header
 * and the narrative one-liner. Remaining receipts are dense ledger rows.
 *
 * Honest framing: "Flagged [date] at [signal mcap] → return, peak return".
 * NEVER "predicted", "guaranteed", "buy signal", "we knew". Performance is
 * MEASURED, not bragged about.
 *
 * Not gated - receipts are the conversion proof, free users see them in full.
 */
import { useMemo } from 'react'
import { useMomentumReceipts } from '@/hooks/useMomentumData'
import {
  stageMeta, formatMarketCap, formatSignedPct, returnTone, formatStamp, toNumber,
} from './pg-utils'

const RECEIPT_LIMIT = 12

function ReceiptAvatar({ src, symbol, size = 32 }) {
  const letter = String(symbol || '?').replace(/^\$/, '').charAt(0).toUpperCase() || '?'
  const dim = { width: size, height: size, minWidth: size }
  if (!src) {
    return <span className="pg-rcpt__av pg-rcpt__av--fallback" style={dim} aria-hidden="true">{letter}</span>
  }
  return (
    <img
      className="pg-rcpt__av"
      src={src}
      alt=""
      loading="lazy"
      style={dim}
      onError={(e) => {
        const span = document.createElement('span')
        span.className = 'pg-rcpt__av pg-rcpt__av--fallback'
        span.style.width = `${size}px`
        span.style.height = `${size}px`
        span.style.minWidth = `${size}px`
        span.textContent = letter
        e.currentTarget.replaceWith(span)
      }}
    />
  )
}

/* Return ladder for featured receipts. */
function ReturnLadder({ raf }) {
  const cells = [
    { k: '24h', v: toNumber(raf?.return_24h_pct) },
    { k: '48h', v: toNumber(raf?.return_48h_pct) },
    { k: '72h', v: toNumber(raf?.return_72h_pct) },
  ]
  return (
    <div className="pg-rcpt__ladder" role="group" aria-label="Returns after first signal">
      {cells.map((cell) => (
        <div className="pg-rcpt__ladder-cell" key={cell.k}>
          <span className="pg-rcpt__ladder-k">{cell.k}</span>
          <span className={`pg-rcpt__ladder-v pg-tone--${returnTone(cell.v)}`}>
            {cell.v != null ? formatSignedPct(cell.v, 0) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* FEATURED RECEIPT - largest proof artifact, always the strongest one */
/* Proof timeline framing: "Flagged [date] at [mcap] → +X%, peak +Y%" */
/* ------------------------------------------------------------------ */
function FeaturedReceipt({ receipt }) {
  const tk = receipt?.token || {}
  const symbol = tk.symbol ? String(tk.symbol).replace(/^\$/, '') : (receipt?.cg_id || '—')
  const raf = receipt?.returns_after_first_seen || {}
  const headline = toNumber(raf.human_return_pct)
  const peakRet = toNumber(raf.peak_return_since_signal_pct ?? raf.return_since_signal_pct)
  const seen = formatStamp(receipt?.first_seen_at)
  const tone = returnTone(headline)
  const peakTone = returnTone(peakRet)
  const stage = stageMeta(receipt?.stage)
  const signalMcap = formatMarketCap(receipt?.signal_market_cap)

  /* One-liner proof sentence. Example:
     "Flagged May 14 at $2.95M → now +198%, peak +235%" */
  const proofLine = [
    seen ? `Flagged ${seen}` : null,
    receipt?.signal_market_cap ? `at ${signalMcap}` : null,
  ].filter(Boolean).join(' ')

  return (
    <article className={`pg-rcpt pg-rcpt--featured pg-rcpt--${tone}`}>
      {/* hairline top accent */}
      <div className="pg-rcpt__topline" aria-hidden="true" />

      {/* Proof timeline eyebrow */}
      <div className="pg-rcpt__timeline-eyebrow">
        <span className="pg-rcpt__timeline-tag">Proof Timeline</span>
        <span className="pg-rcpt__timeline-note">
          Returns measured from first PG entry only — not after momentum was visible
        </span>
      </div>

      <div className="pg-rcpt__featured-inner">
        {/* left: identity + proof narrative */}
        <div className="pg-rcpt__featured-left">
          <div className="pg-rcpt__featured-head">
            <ReceiptAvatar src={tk.image_small || tk.image_url} symbol={symbol} size={44} />
            <div>
              <div className="pg-rcpt__featured-sym">${symbol}</div>
              {tk.name && <div className="pg-rcpt__featured-name">{tk.name}</div>}
            </div>
            <span className={`pg-stage pg-stage--sm ${stage.cls}`}>{stage.label}</span>
          </div>

          {/* The proof one-liner: "Flagged [date] at [mcap]" */}
          {proofLine && (
            <div className="pg-rcpt__proof-oneliner">
              <span className="pg-rcpt__proof-oneliner-flag">{proofLine}</span>
              {(headline != null || peakRet != null) && (
                <span className="pg-rcpt__proof-oneliner-returns">
                  {headline != null && (
                    <span className={`pg-rcpt__proof-ret pg-tone--${tone}`}>
                      now {formatSignedPct(headline, 0)}
                    </span>
                  )}
                  {peakRet != null && peakRet !== headline && (
                    <span className={`pg-rcpt__proof-ret pg-tone--${peakTone}`}>
                      peak {formatSignedPct(peakRet, 0)}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          <div className="pg-rcpt__featured-narrative">
            <span className="pg-rcpt__narrative-line">
              After signal return window — 24h / 48h / 72h:
              {' '}<span className="pg-rcpt__narrative-aged">
                {receipt?.is_aged ? 'fully aged' : 'aging in progress'}
              </span>
            </span>
          </div>

          <ReturnLadder raf={raf} />
        </div>

        {/* right: headline return */}
        <div className="pg-rcpt__featured-right">
          <span className="pg-rcpt__featured-label">After Signal Return</span>
          <span className={`pg-rcpt__featured-value pg-tone--${tone}`}>
            {headline != null ? formatSignedPct(headline, 0) : '—'}
          </span>
          <span className="pg-rcpt__featured-basis">since first PG entry</span>
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* RECEIPT ROW - compact proof entry for the ledger / proof timeline   */
/* Each row shows the one-liner: "Flagged [date] at [mcap] · +X%"      */
/* ------------------------------------------------------------------ */
function ReceiptRow({ receipt, rank }) {
  const tk = receipt?.token || {}
  const symbol = tk.symbol ? String(tk.symbol).replace(/^\$/, '') : (receipt?.cg_id || '—')
  const raf = receipt?.returns_after_first_seen || {}
  const headline = toNumber(raf.human_return_pct)
  const peakRet = toNumber(raf.peak_return_since_signal_pct ?? raf.return_since_signal_pct)
  const seen = formatStamp(receipt?.first_seen_at)
  const tone = returnTone(headline)
  const peakTone = returnTone(peakRet)
  const signalMcap = formatMarketCap(receipt?.signal_market_cap)

  const ladder = [
    toNumber(raf?.return_24h_pct),
    toNumber(raf?.return_48h_pct),
    toNumber(raf?.return_72h_pct),
  ]

  return (
    <div className={`pg-rcpt-row pg-rcpt-row--${tone}`}>
      <span className="pg-rcpt-row__rank">{rank}</span>
      <ReceiptAvatar src={tk.image_small || tk.image_url} symbol={symbol} size={28} />
      <div className="pg-rcpt-row__id">
        <span className="pg-rcpt-row__sym">${symbol}</span>
        {tk.name && <span className="pg-rcpt-row__name">{tk.name}</span>}
      </div>
      {/* Proof narrative: "Flagged [date] at [mcap]" */}
      <div className="pg-rcpt-row__proof">
        <span className="pg-rcpt-row__stamp">
          {seen ? `Flagged ${seen}` : '—'}
        </span>
        <span className="pg-rcpt-row__smcap">
          {receipt?.signal_market_cap ? `at ${signalMcap}` : ''}
        </span>
      </div>
      {/* 24h / 48h / 72h - fixed aligned columns, labels live in the header */}
      <div className="pg-rcpt-row__ladder">
        {ladder.map((v, i) => (
          <span className={`pg-rcpt-row__ret-v pg-tone--${returnTone(v)}`} key={i}>
            {v != null ? formatSignedPct(v, 0) : '—'}
          </span>
        ))}
      </div>
      {/* Return + peak summary */}
      <div className="pg-rcpt-row__returns">
        <span className={`pg-rcpt-row__headline pg-tone--${tone}`}>
          {headline != null ? formatSignedPct(headline, 0) : '—'}
        </span>
        {peakRet != null && peakRet !== headline && (
          <span className={`pg-rcpt-row__peak pg-tone--${peakTone}`}>
            pk {formatSignedPct(peakRet, 0)}
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* SHIMMER                                                              */
/* ------------------------------------------------------------------ */
function ReceiptsShimmer() {
  return (
    <>
      <div className="pg-rcpt pg-rcpt--featured pg-rcpt--shimmer">
        <div className="pg-rcpt__featured-inner">
          <div className="pg-rcpt__featured-left">
            <div className="pg-rcpt__featured-head">
              <span className="pg-shimmer-avatar animate-shimmer" />
              <span className="pg-shimmer-bar pg-shimmer-bar--md animate-shimmer" />
            </div>
            <span className="pg-shimmer-bar pg-shimmer-bar--row animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
          </div>
          <div className="pg-rcpt__featured-right">
            <span className="pg-shimmer-bar pg-shimmer-bar--lg animate-shimmer" />
          </div>
        </div>
      </div>
      <div className="pg-rcpt-ledger">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="pg-rcpt-row pg-rcpt-row--shimmer">
            <span className="pg-shimmer-avatar animate-shimmer" style={{ width: 28, height: 28 }} />
            <span className="pg-shimmer-bar pg-shimmer-bar--md animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--row animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--row animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* MAIN EXPORT                                                          */
/* ------------------------------------------------------------------ */
export default function PGReceipts({ timeframe = '7d', bucket = 'top10', enabled = true }) {
  const { data, loading, error, refetch } = useMomentumReceipts({
    timeframe, bucket, model: 'first_ever', days: 21, limit: 50, enabled,
  })

  const receipts = useMemo(() => {
    const list = Array.isArray(data?.receipts) ? data.receipts : []
    const aged = list.filter((r) => r?.is_aged)
    const pool = aged.length > 0 ? aged : list
    return [...pool]
      .sort((a, b) => {
        const ra = Number(a?.returns_after_first_seen?.human_return_pct)
        const rb = Number(b?.returns_after_first_seen?.human_return_pct)
        return (Number.isFinite(rb) ? rb : -Infinity) - (Number.isFinite(ra) ? ra : -Infinity)
      })
      .slice(0, RECEIPT_LIMIT)
  }, [data])

  const [featured, ...rest] = receipts

  return (
    <section className="pg-panel pg-receipts">
      <header className="pg-panel__head">
        <div>
          <h3 className="pg-panel__title">Proof Timeline &mdash; Called Before The Move</h3>
          <p className="pg-panel__sub">
            Every entry is timestamped at first PG signal. Returns are measured ONLY from that
            first appearance forward — not after the move was visible.
            The honest story: flagged date · signal market cap · what followed.
            Bad exits and stalled signals are included in full.
          </p>
        </div>
      </header>

      {loading && <ReceiptsShimmer />}

      {!loading && error && (
        <div className="pg-empty pg-empty--error">
          <div className="pg-empty__title">Receipts unavailable</div>
          <div className="pg-empty__detail">{error}</div>
          <button type="button" className="pg-btn pg-btn--ghost" onClick={() => refetch()}>Retry</button>
        </div>
      )}

      {!loading && !error && receipts.length === 0 && (
        <div className="pg-empty">
          <div className="pg-empty__title">No receipts yet</div>
          <div className="pg-empty__detail">
            Receipts build as tokens first enter Potential Gainers and their post-signal window completes.
          </div>
        </div>
      )}

      {!loading && !error && receipts.length > 0 && (
        <>
          {/* Featured: strongest proof, full-width */}
          {featured && <FeaturedReceipt receipt={featured} />}

          {/* Ledger: remaining receipts as dense rows */}
          {rest.length > 0 && (
            <>
              <div className="pg-rcpt-ledger__head">
                <span className="pg-rcpt-ledger__h-rank">#</span>
                <span className="pg-rcpt-ledger__h-token">Token</span>
                <span>Flagged &middot; Signal mcap</span>
                <span className="pg-rcpt-ledger__h-ladder">
                  <span>24h</span><span>48h</span><span>72h</span>
                </span>
                <span className="pg-rcpt-ledger__h-return">Return</span>
              </div>
              <div className="pg-rcpt-ledger">
                {rest.map((r, i) => (
                  <ReceiptRow key={r?.cg_id || `${r?.first_seen_at}-${i}`} receipt={r} rank={i + 2} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
