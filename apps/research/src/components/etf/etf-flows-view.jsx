/**
 * EtfFlowsView — the reusable Bitcoin/Ethereum spot-ETF money-flow surface.
 * Mounted three ways: the dedicated /etfs page (full), the Command Center
 * Flows tab (compact), and the Wallets page (compact). One data hook, one
 * renderer.
 *
 *   compact=false → asset toggle + summary strip + flow chart + per-issuer table
 *   compact=true  → asset toggle + summary strip + flow chart (no table)
 *   standalone    → the /etfs page, which carries its own masthead, so the
 *                   surface drops its subject line instead of printing the
 *                   same sentence twice one line below it.
 *
 * The upstream data provider is never named in the UI.
 */
import { Suspense, useCallback, useMemo, useState } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useEtfFlows from './use-etf-flows'
import EtfFlowChart from './etf-flow-chart'
import ShareXButton from '@/components/share-x-button'
import { generateEtfShareCard } from './etf-share-card'
import './etf-flows.css'
import './etf-flows.day-mode.css'
import './etf-flows.mobile.css'

const ShareXModal = lazy(() => import('@/components/share-x-modal'))

function fUsd(n, signed) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '-' : signed && n > 0 ? '+' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${Math.round(a)}`
}
function fCoin(n, sym) {
  if (n == null || !isFinite(n)) return '—'
  return `${Math.round(n).toLocaleString('en-US')}${sym ? ' ' + sym : ''}`
}
function sCoin(n) {
  if (n == null || !isFinite(n)) return '0'
  const r = Math.round(n)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-US')}`
}
function dirCls(v) {
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'
}
function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  } catch {
    return iso
  }
}

// Brand dots are the canonical values from constants/tokenColors.js — asset
// identity is the one place hue is allowed here. ETH was #8a92ff, a periwinkle
// nobody else in the app uses; Ethereum's own blue is #627eea.
const ASSETS = [
  { key: 'BTC', slug: 'btc', name: 'Bitcoin', dot: '#f7931a' },
  { key: 'ETH', slug: 'eth', name: 'Ethereum', dot: '#627eea' },
]

function SummaryRow({ meta, a, active, onClick }) {
  const t = (a && a.total) || {}
  return (
    <button type="button" className={`etf-sum-row${active ? ' etf-sum-row--active' : ''}`} onClick={onClick}>
      <span className="etf-sum-name">
        <i style={{ background: meta.dot }} />
        {meta.name}
      </span>
      <span className="etf-sum-cell">
        <label>Holdings</label>
        <b>{fUsd(t.holdingsUsd)}</b>
      </span>
      <span className="etf-sum-cell">
        <label>1D net</label>
        <b className={dirCls(t.flow1dUsd)}>{fUsd(t.flow1dUsd, true)}</b>
      </span>
      <span className="etf-sum-cell">
        <label>7D net</label>
        <b className={dirCls(t.flow7dUsd)}>{fUsd(t.flow7dUsd, true)}</b>
      </span>
    </button>
  )
}

function foldIssuers(issuers, topN = 8) {
  const list = (issuers || []).filter((i) => (i.holdingsUsd || 0) > 0)
  if (list.length <= topN + 1) return list
  const head = list.slice(0, topN)
  const others = list.slice(topN).reduce(
    (o, i) => ({
      issuer: 'Others',
      _others: true,
      holdingsUsd: o.holdingsUsd + (i.holdingsUsd || 0),
      holdingsCoin: o.holdingsCoin + (i.holdingsCoin || 0),
      flow1dUsd: o.flow1dUsd + (i.flow1dUsd || 0),
      flow1dCoin: o.flow1dCoin + (i.flow1dCoin || 0),
      flow7dUsd: o.flow7dUsd + (i.flow7dUsd || 0),
      flow7dCoin: o.flow7dCoin + (i.flow7dCoin || 0),
    }),
    { holdingsUsd: 0, holdingsCoin: 0, flow1dUsd: 0, flow1dCoin: 0, flow7dUsd: 0, flow7dCoin: 0 }
  )
  return [...head, others]
}

const RANGES = [
  { k: 30, label: '30D' },
  { k: 90, label: '90D' },
  { k: 999, label: 'All' },
]

export default function EtfFlowsView({ compact = false, standalone = false, defaultAsset = 'BTC', enabled = true }) {
  const { data, loading } = useEtfFlows({ enabled })
  const [asset, setAsset] = useState(defaultAsset)
  const [range, setRange] = useState(compact ? 90 : 999)

  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareImg, setShareImg] = useState(null)
  const [shareText, setShareText] = useState('')

  const summary = data?.summary
  const meta = ASSETS.find((a) => a.key === asset) || ASSETS[0]
  const assetData = summary ? summary[meta.slug] : null
  const fullSeries = data?.charts?.[asset] || []
  const series = range >= 999 ? fullSeries : fullSeries.slice(-range)
  const rows = useMemo(() => foldIssuers(assetData?.issuers, compact ? 6 : 10), [assetData, compact])
  const total = (assetData && assetData.total) || {}
  const asOf = assetData?.asOf
  // share-of-holdings needs a denominator that always covers the rows shown:
  // the reported total when it's there, else the sum of the rows themselves.
  const totalHoldings = useMemo(() => (
    Number(total.holdingsUsd) > 0 ? Number(total.holdingsUsd) : rows.reduce((s, i) => s + (Number(i.holdingsUsd) || 0), 0)
  ), [total.holdingsUsd, rows])
  const fundCount = useMemo(() => (assetData?.issuers || []).filter((i) => (i.holdingsUsd || 0) > 0).length, [assetData])

  // Share the flows as a branded PNG. The card carries the mark through its
  // centre, so a cropped repost still says where the numbers came from.
  const handleShare = useCallback(async () => {
    if (shareBusy || !summary) return
    setShareBusy(true)
    setShareImg(null)
    setShareOpen(true)
    try {
      const { imageUrl, description } = await generateEtfShareCard({
        summary, charts: data?.charts || {}, asset,
      })
      setShareText(description)
      setShareImg(imageUrl)
    } catch (err) {
      console.error('ETF share failed:', err)
      setShareOpen(false)
    }
    setShareBusy(false)
  }, [shareBusy, summary, data, asset])

  if (loading && !summary) {
    return (
      <div className={`etf-view${compact ? ' etf-view--compact' : ''}`}>
        <div className="etf-skel etf-skel--strip" />
        <div className="etf-skel etf-skel--chart" />
        {!compact && <div className="etf-skel etf-skel--table" />}
      </div>
    )
  }
  if (!summary) {
    return (
      <div className={`etf-view${compact ? ' etf-view--compact' : ''}`}>
        <div className="etf-empty">ETF flow data is warming up — check back in a moment.</div>
      </div>
    )
  }

  return (
    <div className={`etf-view${compact ? ' etf-view--compact' : ''}`}>
      <div className="etf-head">
        {!standalone && (
          <div className="etf-head-title">
            <h3>ETF Net Flows</h3>
            <span>Bitcoin &amp; Ethereum spot-ETF holdings and daily net inflow</span>
          </div>
        )}
        <div className="etf-head-right">
          {asOf && <span className="etf-asof">as of {fmtDate(asOf)}</span>}
          <div className="etf-range">
            {RANGES.map((r) => (
              <button
                key={r.k}
                type="button"
                className={`etf-range-btn${range === r.k ? ' etf-range-btn--on' : ''}`}
                onClick={() => setRange(r.k)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="etf-toggle">
            {ASSETS.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`etf-toggle-btn${asset === a.key ? ' etf-toggle-btn--on' : ''}`}
                onClick={() => setAsset(a.key)}
              >
                <i style={{ background: a.dot }} />
                {a.key}
              </button>
            ))}
          </div>
          <ShareXButton onClick={handleShare} isExporting={shareBusy} compact className="etf-share-btn" />
        </div>
      </div>

      <div className="etf-sum">
        {ASSETS.map((a) => (
          <SummaryRow key={a.key} meta={a} a={summary[a.slug]} active={asset === a.key} onClick={() => setAsset(a.key)} />
        ))}
      </div>

      <div className="etf-chart-card">
        <EtfFlowChart series={series} height={compact ? 240 : 380} asset={asset} />
      </div>

      {!compact && (
        <div className="etf-table-card">
          <div className="etf-tbl-head">
            <div className="etf-tbl-head-l">
              <span className="etf-tbl-title">{meta.name} ETF issuers</span>
              <span className="etf-tbl-sub">Ranked by holdings · share of all {meta.key} held in spot ETFs</span>
            </div>
            <div className="etf-tbl-head-r">
              <span className="etf-tbl-stat"><label>Funds</label><b>{fundCount}</b></span>
              <span className="etf-tbl-stat"><label>Held</label><b>{fCoin(total.holdingsCoin, meta.key)}</b></span>
              <span className="etf-tbl-stat"><label>Value</label><b>{fUsd(total.holdingsUsd)}</b></span>
            </div>
          </div>
          <table className="etf-tbl">
            <thead>
              <tr>
                <th className="etf-th-rank" />
                <th className="etf-th-iss">Issuer</th>
                <th>Holdings</th>
                <th className="etf-th-share">Share</th>
                <th>1D net</th>
                <th>7D net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i, idx) => {
                const share = totalHoldings > 0 ? ((i.holdingsUsd || 0) / totalHoldings) * 100 : null
                return (
                  <tr key={i.issuer + idx} className={i._others ? 'etf-tbl-others' : ''}>
                    <td className="etf-rank">{i._others ? '·' : idx + 1}</td>
                    {/* No per-row dot: every row in this table is the same
                        asset, so eleven identical coloured dots mark nothing.
                        Identity lives on the summary card and the toggle. */}
                    <td className="etf-iss">
                      <span className="etf-iss-name">{i.issuer}</span>
                      {i.tickers && i.tickers.length ? <em>{i.tickers.join(' · ')}</em> : null}
                    </td>
                    {/* The unit is its own node so a phone can drop it: at
                        390px "787,693 BTC" wraps onto a second line and the
                        row grows a ragged extra line. The $ figure under it
                        already says what is being counted. */}
                    <td className="etf-num">
                      <b>{fCoin(i.holdingsCoin)}<i className="etf-unit">{meta.key}</i></b>
                      <span>{fUsd(i.holdingsUsd)}</span>
                    </td>
                    <td className="etf-share">
                      <span className="etf-share-track">
                        <i style={{ width: `${Math.max(share == null ? 0 : share, share ? 1.5 : 0)}%` }} />
                      </span>
                      <span className="etf-share-pct">{share == null ? '—' : `${share.toFixed(1)}%`}</span>
                    </td>
                    <td className="etf-num">
                      <b className={dirCls(i.flow1dCoin)}>{sCoin(i.flow1dCoin)}</b>
                      <span>{fUsd(i.flow1dUsd, true)}</span>
                    </td>
                    <td className="etf-num">
                      <b className={dirCls(i.flow7dCoin)}>{sCoin(i.flow7dCoin)}</b>
                      <span>{fUsd(i.flow7dUsd, true)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="etf-tbl-total">
                <td className="etf-rank" />
                <td className="etf-iss"><span className="etf-iss-name">All issuers</span></td>
                <td className="etf-num">
                  <b>{fCoin(total.holdingsCoin)}<i className="etf-unit">{meta.key}</i></b>
                  <span>{fUsd(total.holdingsUsd)}</span>
                </td>
                <td className="etf-share"><span className="etf-share-pct">100%</span></td>
                <td className="etf-num">
                  <b className={dirCls(total.flow1dCoin)}>{sCoin(total.flow1dCoin)}</b>
                  <span>{fUsd(total.flow1dUsd, true)}</span>
                </td>
                <td className="etf-num">
                  <b className={dirCls(total.flow7dCoin)}>{sCoin(total.flow7dCoin)}</b>
                  <span>{fUsd(total.flow7dUsd, true)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {shareOpen && (
        <Suspense fallback={null}>
          <ShareXModal
            open={shareOpen}
            onClose={() => { setShareOpen(false); setShareImg(null) }}
            imageUrl={shareImg}
            defaultDescription={shareText}
            filename={`spectre_etf_flows_${meta.key.toLowerCase()}.png`}
          />
        </Suspense>
      )}
    </div>
  )
}
