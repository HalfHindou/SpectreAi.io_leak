import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shortExchange } from '@/lib/exchange-label'
import { getPredictionMarketsForToken } from '@/services/polymarketApi'
import './rzm-stock-markets.css'

/**
 * RzmStockMarkets — native mobile rewrite of the stock Markets tab.
 *
 * Desktop reference: rz-markets-section.jsx (stock branch ~:530-808).
 * Covers: Fundamentals grid, Analyst Consensus, Next Earnings, Prediction
 * Markets (self-fetched, same cached service the desktop card + /predictions
 * page use), Snapshot narrative, and Stories & Analysis news.
 *
 * All values come from `tokenData` (the FULL stock object built in
 * research-zone-lite.jsx:999) + `newsItems` prop. Prediction markets are the
 * ONLY self-fetch — matching the desktop component, which also fetches them
 * internally. Every value is null-guarded ({v ?? '—'}); a section that has no
 * real data simply does not render — never fabricated rows.
 */

/** Time-ago formatter for news meta lines. */
function timeAgo(ts) {
  if (!ts) return ''
  const then = new Date(ts).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Math.max(0, Date.now() - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Resolve a news item's timestamp across the shapes the feed uses. */
function newsTime(item) {
  if (!item) return null
  if (item.publishedOn) return item.publishedOn * 1000
  return item.publishedAt || item.time || null
}

function RzmStockMarkets({ symbol, tokenName, tokenData, fmtPrice, fmtLarge, newsItems }) {
  const { t } = useTranslation()
  const td = tokenData || {}
  // Null-safe formatters — never call raw formatPrice; fall back to a plain
  // string so a missing prop can't crash the render.
  const fp = typeof fmtPrice === 'function' ? fmtPrice : (v) => (v == null ? '—' : String(v))
  const fl = typeof fmtLarge === 'function' ? fmtLarge : (v) => (v == null ? '—' : String(v))

  const loading = td.price == null

  // ── Prediction markets — self-fetched (cached + LS-seeded service, 3-min
  // TTL, shared inflight with /predictions, so a warm session costs nothing).
  const [predictions, setPredictions] = useState(null)
  useEffect(() => {
    if (!symbol) { setPredictions(null); return undefined }
    let cancelled = false
    const companyName = (tokenName || '')
      .replace(/,?\s+(inc|corp|corporation|company|co|ltd|plc|class [a-c])\.?$/i, '')
      .trim()
    getPredictionMarketsForToken(symbol, companyName, 4)
      .then((rows) => { if (!cancelled) setPredictions(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setPredictions([]) })
    return () => { cancelled = true }
  }, [symbol, tokenName])

  // ── Fundamentals grid ──
  const fundamentals = useMemo(() => ([
    { label: 'Market Cap', value: td.mcap ? fl(td.mcap) : '—' },
    { label: 'P/E Ratio', value: td.pe != null ? Number(td.pe).toFixed(1) : '—' },
    { label: 'EPS', value: td.eps != null ? fp(td.eps) : '—' },
    { label: 'Volume', value: td.volume24h ? fl(td.volume24h) : '—' },
    { label: 'Avg Volume', value: td.avgVolume ? fl(td.avgVolume) : '—' },
    { label: 'Beta', value: td.beta != null ? Number(td.beta).toFixed(2) : '—' },
    { label: '52W High', value: td.week52High ? fp(td.week52High) : '—' },
    { label: '52W Low', value: td.week52Low ? fp(td.week52Low) : '—' },
    { label: 'Div Yield', value: td.dividendYield != null ? `${(Number(td.dividendYield) * (Number(td.dividendYield) < 1 ? 100 : 1)).toFixed(2)}%` : '—' },
    { label: 'Sector', value: td.sector || '—' },
    { label: 'Exchange', value: shortExchange(td.exchange) || '—' },
    { label: 'Country', value: td.country || '—' },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [tokenData])

  // ── Analyst Consensus derivations ──
  const analyst = useMemo(() => {
    const price = Number(td.price) || null
    const mean = Number(td.targetMeanPrice) || null
    if (mean == null && !td.recTrend) return null
    const upside = (price && mean) ? ((mean - price) / price) * 100 : null
    const rt = td.recTrend
    const total = rt ? (rt.strongBuy + rt.buy + rt.hold + rt.sell + rt.strongSell) : 0
    const recKey = td.recommendationKey || ''
    const recLabel = recKey.replace(/_/g, ' ')
    const recTone = /buy/.test(recKey) ? 'bull' : /sell|underperform/.test(recKey) ? 'bear' : 'neutral'
    const segs = (rt && total > 0) ? [
      { label: 'Strong Buy', cls: 'sb', v: rt.strongBuy },
      { label: 'Buy', cls: 'b', v: rt.buy },
      { label: 'Hold', cls: 'h', v: rt.hold },
      { label: 'Sell', cls: 's', v: rt.sell },
      { label: 'Strong Sell', cls: 'ss', v: rt.strongSell },
    ].filter((s) => s.v > 0) : []
    return { price, mean, upside, recLabel, recTone, total, segs }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenData])

  // Next Earnings derivations moved to RzEarningsBanner (rendered above the
  // chart in research-zone-mobile.jsx).

  // ── Snapshot narrative (deterministic template prose from real quote
  // fields — NOT an LLM read, matches desktop honesty note). ──
  const snapshot = useMemo(() => {
    const price = Number(td.price)
    if (!Number.isFinite(price) || price <= 0) return null
    const chg = Number(td.change24h) || 0
    const bullish = chg > 0
    const high52 = td.week52High
    const low52 = td.week52Low
    const pe = td.pe
    const mcap = td.mcap
    const volume = td.volume24h
    const avgVol = td.avgVolume
    const sector = td.sector || ''
    const name = tokenName || symbol || 'The stock'
    const magnitude = Math.abs(chg) > 3 ? 'sharply' : Math.abs(chg) > 1.5 ? 'notably' : 'modestly'
    const direction = bullish ? 'higher' : 'lower'
    const capTier = mcap > 500e9 ? 'mega-cap' : mcap > 100e9 ? 'large-cap' : mcap > 10e9 ? 'mid-cap' : 'small-cap'
    const sectorContext = sector ? ` within the ${sector.toLowerCase()} sector` : ''
    const volSignal = volume && avgVol && volume > avgVol * 1.3 ? ' on above-average volume'
      : volume && avgVol && volume < avgVol * 0.7 ? ' on lighter-than-usual volume' : ''
    const rangePct = (high52 && low52) ? ((price - low52) / (high52 - low52) * 100) : null
    let rangeContext = ''
    if (rangePct !== null) {
      if (rangePct >= 80) rangeContext = ' Trading near the upper end of its 52-week range, suggesting strong momentum.'
      else if (rangePct <= 20) rangeContext = ' Hovering near the lower end of its 52-week range, which may attract value-oriented investors.'
      else rangeContext = ` Sits at ${rangePct.toFixed(0)}% of its 52-week range, between ${fp(low52)} and ${fp(high52)}.`
    }
    let valContext = ''
    if (pe) {
      if (pe > 60) valContext = ` At ${Number(pe).toFixed(1)}x earnings, the valuation reflects significant growth expectations.`
      else if (pe > 25) valContext = ` A P/E of ${Number(pe).toFixed(1)}x carries a growth-oriented valuation.`
      else if (pe > 15) valContext = ` At ${Number(pe).toFixed(1)}x earnings, the valuation appears reasonable versus peers.`
      else valContext = ` At just ${Number(pe).toFixed(1)}x earnings, it trades at a discount that could signal opportunity.`
    }
    return {
      bullish,
      text: `${name} is trading ${magnitude} ${direction}${volSignal}, moving ${bullish ? '+' : ''}${chg.toFixed(2)}% to ${fp(price)}${sectorContext}. The ${capTier} name carries a market capitalization of ${fl(mcap)}.${rangeContext}${valContext}`,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenData, symbol, tokenName])

  // ── Loading shimmer (never a spinner / "Loading…") ──
  if (loading) {
    return (
      <div className="rzsm-root">
        <div className="rzsm-section">
          <div className="rzsm-section-title">{t('researchPro.mstockMarkets.rzmstockmarkets.fundamentals', "Fundamentals")}</div>
          <div className="rzsm-fund-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rzsm-fund-item">
                <span className="rzsm-skel rzsm-skel--label" />
                <span className="rzsm-skel rzsm-skel--value" />
              </div>
            ))}
          </div>
        </div>
        <div className="rzsm-section">
          <div className="rzsm-section-title">{t('researchPro.mstockMarkets.rzmstockmarkets.analystConsensus', "Analyst Consensus")}</div>
          <div className="rzsm-card">
            <span className="rzsm-skel rzsm-skel--bar" />
            <span className="rzsm-skel rzsm-skel--row" />
            <span className="rzsm-skel rzsm-skel--row" />
          </div>
        </div>
      </div>
    )
  }

  const hasNews = Array.isArray(newsItems) && newsItems.length > 0

  return (
    <div className="rzsm-root">
      {/* ── Fundamentals ── */}
      <div className="rzsm-section">
        <div className="rzsm-section-title">{t('researchPro.mstockMarkets.rzmstockmarkets.fundamentals', "Fundamentals")}</div>
        <div className="rzsm-fund-grid">
          {fundamentals.map((item) => (
            <div key={item.label} className="rzsm-fund-item">
              <span className="rzsm-fund-label">{item.label}</span>
              <span className="rzsm-fund-value rzsm-num">{item.value ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Analyst Consensus ── */}
      {analyst && (
        <div className="rzsm-section">
          <div className="rzsm-section-title">{t('researchPro.mstockMarkets.rzmstockmarkets.analystConsensus', "Analyst Consensus")}</div>
          <div className="rzsm-card">
            <div className="rzsm-card-head">
              <span className="rzsm-card-sub">
                {td.analystCount ? `${td.analystCount} analysts · ` : ''}Yahoo Finance
              </span>
              {analyst.recLabel && (
                <span className={`rzsm-rec rzsm-rec--${analyst.recTone}`}>{analyst.recLabel}</span>
              )}
            </div>

            {analyst.segs.length > 0 && (
              <>
                <div
                  className="rzsm-recbar"
                  role="img"
                  aria-label={`Ratings: ${analyst.segs.map((s) => `${s.v} ${s.label}`).join(', ')}`}
                >
                  {analyst.segs.map((s) => (
                    <span
                      key={s.label}
                      className={`rzsm-recbar-seg rzsm-recbar-seg--${s.cls}`}
                      style={{ width: `${(s.v / analyst.total) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="rzsm-recbar-legend">
                  {analyst.segs.map((s) => (
                    <span key={s.label} className="rzsm-recbar-item">
                      <span className={`rzsm-recbar-dot rzsm-recbar-dot--${s.cls}`} />
                      {s.label} <span className="rzsm-num">{s.v ?? '—'}</span>
                    </span>
                  ))}
                </div>
              </>
            )}

            {analyst.mean != null && (
              <div className="rzsm-targets">
                <div className="rzsm-target">
                  <span className="rzsm-target-label">{t('researchPro.mstockMarkets.rzmstockmarkets.low', "Low")}</span>
                  <span className="rzsm-target-value rzsm-num">
                    {td.targetLowPrice != null ? fp(td.targetLowPrice) : '—'}
                  </span>
                </div>
                <div className="rzsm-target rzsm-target--mean">
                  <span className="rzsm-target-label">{t('researchPro.mstockMarkets.rzmstockmarkets.meanTarget', "Mean target")}</span>
                  <span className="rzsm-target-value rzsm-num">{fp(analyst.mean)}</span>
                  {analyst.upside != null && (
                    <span className={`rzsm-target-upside rzsm-num ${analyst.upside >= 0 ? 'rzsm-up' : 'rzsm-down'}`}>
                      {analyst.upside >= 0 ? '+' : ''}{analyst.upside.toFixed(1)}% vs price
                    </span>
                  )}
                </div>
                <div className="rzsm-target">
                  <span className="rzsm-target-label">{t('researchPro.mstockMarkets.rzmstockmarkets.high', "High")}</span>
                  <span className="rzsm-target-value rzsm-num">
                    {td.targetHighPrice != null ? fp(td.targetHighPrice) : '—'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Next Earnings relocated: renders as RzEarningsBanner above the chart
          (research-zone-mobile.jsx) so the gap-risk lead is at the top. */}

      {/* ── Prediction Markets (self-fetched) ── */}
      {predictions && predictions.length > 0 && (
        <div className="rzsm-section">
          <div className="rzsm-section-title">{t('researchPro.mstockMarkets.rzmstockmarkets.predictionMarkets', "Prediction Markets")}</div>
          <div className="rzsm-card rzsm-card--flush">
            <div className="rzsm-card-head rzsm-card-head--pad">
              <span className="rzsm-card-sub">Live odds · Polymarket</span>
            </div>
            <div className="rzsm-pred-list">
              {predictions.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rzsm-pred-row"
                >
                  <span className="rzsm-pred-q">{p.question ?? '—'}</span>
                  <div className="rzsm-pred-right">
                    <span className={`rzsm-pred-yes rzsm-num ${(p.yesPct ?? 0) >= 50 ? 'rzsm-up' : 'rzsm-down'}`}>
                      {p.yesPct ?? '—'}%
                    </span>
                    <span className="rzsm-pred-meta rzsm-num">
                      ${p.volume >= 1e6 ? `${(p.volume / 1e6).toFixed(1)}M` : `${Math.round((p.volume ?? 0) / 1e3)}K`}
                      {p.endDate ? ` · ${p.endDate}` : ''}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Snapshot narrative ── */}
      {snapshot && (
        <div className="rzsm-section">
          <div className="rzsm-section-title">{t('researchPro.mstockMarkets.rzmstockmarkets.snapshot', "Snapshot")}</div>
          <div className={`rzsm-card rzsm-snapshot ${snapshot.bullish ? 'rzsm-snapshot--bull' : 'rzsm-snapshot--bear'}`}>
            <p className="rzsm-snapshot-text">{snapshot.text}</p>
          </div>
        </div>
      )}

      {/* ── Stories & Analysis ── */}
      {hasNews && (
        <div className="rzsm-section">
          <div className="rzsm-section-title">Stories &amp; Analysis</div>
          <div className="rzsm-news-list">
            {newsItems.slice(0, 8).map((item, i) => (
              <a
                key={item.url || i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rzsm-news-row"
              >
                <div className="rzsm-news-body">
                  <span className="rzsm-news-title">{item.title ?? '—'}</span>
                  <span className="rzsm-news-meta">
                    {item.source || 'News'} · {timeAgo(newsTime(item))}
                  </span>
                </div>
                <div className="rzsm-news-thumb">
                  <span className="rzsm-news-thumb-letter">{(item.source || 'N').charAt(0)}</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default RzmStockMarkets
