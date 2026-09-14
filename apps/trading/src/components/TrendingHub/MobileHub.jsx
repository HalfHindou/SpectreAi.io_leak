/**
 * MobileHub — phone layout for the Trending Hub (prefix mth-).
 *
 * Early-returned from TrendingHub/index.jsx on mobile: ALL data fetching,
 * state and derived reads (pulse, insights, chain counts) stay in the parent —
 * this component only renders. Desktop's 3-column terminal collapses into:
 *
 *   [← back  Trending ● Live]
 *   [Markets · Social · Sectors]        (underline tabs)
 *   [view chips — horizontal scroll]
 *   [chain chips — markets only]
 *   [breadth strip + TF pills]
 *   [board list]
 *
 * Markets boards reuse the shared MobileTokenRow (same row shape as the
 * screener). Social boards render a compact metric row. Sectors = 2-col
 * category cards.
 */
import React from 'react'
import { ChevronLeft } from 'lucide-react'
import MobileTokenRow, { gradeClass, fmtPct } from '../mobile/home/MobileTokenRow'
import useDragScroll from '../mobile/home/useDragScroll'
import { formatLargeNumber } from '../../services/codexApi'
import { readCodexChangePct } from '../../lib/marketFormat'
import './MobileHub.css'

function BoardSkeleton({ n = 7 }) {
  return Array.from({ length: n }).map((_, i) => (
    <div key={i} className="mth-skel">
      <div className="mth-skel-logo animate-shimmer" />
      <div className="mth-skel-lines">
        <div className="mth-skel-line animate-shimmer" style={{ width: '52%' }} />
        <div className="mth-skel-line animate-shimmer" style={{ width: '76%' }} />
      </div>
    </div>
  ))
}

export default function MobileHub({
  navigateTo,
  selectToken,
  tabs,
  tab,
  setTab,
  viewItems,
  viewActiveId,
  onViewSelect,
  chains,
  chainCounts,
  globalChain,
  setGlobalChain,
  timeframeOptions,
  globalTimeframe,
  setGlobalTimeframe,
  activeData,
  pulse,
  insights,
  categories,
  socialMetric,
}) {
  const rows = Array.isArray(activeData?.rows) ? activeData.rows : []
  const loading = !!activeData?.loading
  const error = activeData?.error
  const viewsRef = useDragScroll()
  const chainsRef = useDragScroll()

  const openToken = (r) => {
    if (!r?.address) return
    selectToken?.({
      symbol: r.symbol, name: r.name, address: r.address,
      networkId: r.networkId || 1, price: r.price, change: r.change, logo: r.logo,
    }, 'trending-hub-mobile')
  }

  const upShare = pulse?.n > 0 ? Math.round((pulse.g / pulse.n) * 100) : 50

  return (
    <div className="mth">
      {/* header */}
      <header className="mth-head">
        <button type="button" className="mth-back" onClick={() => navigateTo?.('welcome')} aria-label="Back to Discover">
          <ChevronLeft size={20} strokeWidth={2.2} />
        </button>
        <h1 className="mth-title">Trending</h1>
        <span className="mth-live"><i aria-hidden="true" />LIVE</span>
      </header>

      {/* surface tabs — same underline language as the mobile screener */}
      <div className="mth-tabs" role="tablist" aria-label="Hub surface">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`mth-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* view chips (markets / social rankings) */}
      {tab !== 'categories' && (
        <div className="mth-chips" role="radiogroup" aria-label="Board view" ref={viewsRef}>
          {viewItems.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={viewActiveId === s.id}
              className={`mth-chip${viewActiveId === s.id ? ' is-active' : ''}`}
              onClick={() => onViewSelect(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* chain chips — markets only (social boards are chain-agnostic) */}
      {tab === 'data' && (
        <div className="mth-chips mth-chips--chains" role="radiogroup" aria-label="Chain" ref={chainsRef}>
          {chains.map((c) => {
            const count = c.id === 'all'
              ? null
              : c.networkIds.reduce((sum, id) => sum + (chainCounts?.get?.(id) || 0), 0)
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={globalChain === c.id}
                className={`mth-chip${globalChain === c.id ? ' is-active' : ''}`}
                onClick={() => setGlobalChain(c.id)}
              >
                {c.short || c.label}
                {count > 0 && <em>{count}</em>}
              </button>
            )
          })}
        </div>
      )}

      {/* breadth strip + timeframe */}
      {tab !== 'categories' && (
        <div className="mth-strip">
          {pulse?.n > 0 && (
            <>
              <div className="mth-strip-bar" role="img" aria-label={`${pulse.g} of ${pulse.n} trending tokens are up`}>
                <span style={{ width: `${upShare}%` }} />
              </div>
              <span className="mth-strip-read">
                {pulse.g}/{pulse.n} <i>green</i>
              </span>
            </>
          )}
          <div className="mth-tf" role="radiogroup" aria-label="Timeframe">
            {timeframeOptions.map((tf) => (
              <button
                key={tf.id}
                type="button"
                role="radio"
                aria-checked={globalTimeframe === tf.id}
                className={`mth-tf-btn${globalTimeframe === tf.id ? ' is-active' : ''}`}
                onClick={() => setGlobalTimeframe(tf.id)}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* insights one-liners */}
      {tab === 'data' && insights?.length > 0 && (
        <div className="mth-ins">
          {insights.slice(0, 2).map((line) => (
            <p key={line.k}><span>{line.k}</span>{line.t}</p>
          ))}
        </div>
      )}

      {/* ── board ─────────────────────────────────────────────── */}
      {tab === 'categories' ? (
        <div className="mth-cats">
          {categories?.loading && (categories.rows || []).length === 0 ? (
            <BoardSkeleton n={6} />
          ) : (
            (categories?.rows || []).slice(0, 24).map((c) => {
              const chg = readCodexChangePct(c.market_cap_change_24h ?? c.change24h)
              return (
                <div key={c.id || c.name} className="mth-cat">
                  <span className="mth-cat-name">{c.name}</span>
                  <span className="mth-cat-foot">
                    <b>{formatLargeNumber(c.market_cap)}</b>
                    <i className={gradeClass(chg)}>{fmtPct(chg)}</i>
                  </span>
                </div>
              )
            })
          )}
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="mth-board"><BoardSkeleton /></div>
      ) : error && rows.length === 0 ? (
        <div className="mth-state">Board unavailable — {String(error)}</div>
      ) : rows.length === 0 ? (
        <div className="mth-state">No rows on this board right now.</div>
      ) : tab === 'social' ? (
        <div className="mth-board">
          {rows.slice(0, 40).map((r, i) => {
            const chg = readCodexChangePct(r.change24h ?? r.change)
            return (
              <button
                key={`${r.symbol || i}-${r.address || i}`}
                type="button"
                className="mth-srow"
                onClick={() => openToken(r)}
              >
                <span className="mth-srow-rank">{i + 1}</span>
                {r.logo
                  ? <img className="mth-srow-logo" src={r.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                  : <span className="mth-srow-logo mth-srow-logo--fb">{(r.symbol || '?').slice(0, 2)}</span>}
                <span className="mth-srow-id">
                  <b>{r.symbol || '—'}</b>
                  <i>{r.name || ''}</i>
                </span>
                {chg != null && <b className={`mth-srow-chg ${gradeClass(chg)}`}>{fmtPct(chg)}</b>}
                <span className="mth-srow-metric">
                  <i>{socialMetric?.label || ''}</i>
                  <b>{socialMetric?.get ? socialMetric.get(r) : '—'}</b>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="mth-board">
          {rows.slice(0, 50).map((r, i) => (
            <MobileTokenRow
              key={`${r.address || r.symbol}-${r.networkId || ''}`}
              token={{ ...r, volume24h: r.volume24h ?? r.volume24, change1h: r.change1h ?? r.change1 }}
              onSelect={openToken}
              showChips
            />
          ))}
        </div>
      )}
    </div>
  )
}
