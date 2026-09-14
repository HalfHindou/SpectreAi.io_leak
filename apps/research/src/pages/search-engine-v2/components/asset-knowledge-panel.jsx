/**
 * AssetKnowledgePanel — the right rail for ASSET_ANALYSIS / DUE_DILIGENCE /
 * WHALE_TRACKING. Stack of dossier cards:
 *
 *   1. AssetTokenCard      — price hero + 3-stat micro-grid + grade
 *   2. AssetChartCard      — reuses MonarchAssetChart (Spectre/Line/TV)
 *   3. TechnicalsCard      — signal/RSI/MACD/MAs
 *   4. InstitutionalCard   — 10-segment monochrome bars per axis
 *   5. CatalystsRisksCard  — ▲/▼ glyphs (from dossier when available)
 *
 * Each sub-card is internal to this file — they only render in this rail
 * and don't need their own modules.
 */
import { memo, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'

import './asset-knowledge-panel.css'

// MonarchAssetChart lazy-loads TradingView inside itself; we just lazy-load
// the wrapper here so the rail bundle doesn't pull the whole chart family
// for non-asset classifications.
const MonarchChart = lazy(() => import('@/components/monarch/monarch-chart'))

function num(v) {
  if (v == null || isNaN(v)) return null
  return Number(v)
}

function fmtPct(v) {
  const n = num(v); if (n == null) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function fmtRsi(v) {
  const n = num(v); if (n == null) return '—'
  return n.toFixed(1)
}

// Numeric formatter that respects the active locale (used for non-monetary
// numbers like the institutional composite score).
function fmtNumber(v, maxFrac = 1) {
  const n = num(v); if (n == null) return '—'
  return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: maxFrac }).format(n)
}

/* ── AssetTokenCard ────────────────────────────────────────────────── */
function AssetTokenCard({ symbol, price, t, fmtPrice, fmtLargeShort }) {
  if (!price && !symbol) return null
  const p = price || {}
  const change24h = p.change?.['24h']
  const change7d = p.change?.['7d']
  const mcap = p.market_cap
  const vol = p.volume_24h
  const isUp = num(change24h) > 0
  const rank = p.market_cap_rank

  return (
    <div className="se2-akp-card">
      <div className="se2-akp-token-head">
        {/* CoinGecko logo URL — if not in payload, skip */}
        {(p.image?.small || p.image?.large || p.image) && (
          <img
            src={p.image?.small || p.image?.large || p.image}
            alt=""
            className="se2-akp-token-logo"
            loading="lazy"
          />
        )}
        <div className="se2-akp-token-name">
          <div className="se2-akp-token-name-row">{p.name || symbol}</div>
          <div className="se2-akp-token-ticker">
            {symbol}
            {rank ? ` · ${t('searchEngineV2.assetKnowledge.rankPrefix', '#')}${rank}` : ''}
          </div>
        </div>
      </div>
      <div className="se2-akp-token-price-row">
        <div className="se2-akp-token-price">{p.price != null ? fmtPrice(p.price) : '—'}</div>
        <div className={`se2-akp-token-change ${isUp ? 'is-up' : 'is-down'}`}>
          {fmtPct(change24h)}
        </div>
      </div>
      <div className="se2-akp-token-stats">
        <div className="se2-akp-token-stat">
          <span className="se2-akp-token-stat-label">{t('searchEngineV2.assetKnowledge.mcap', 'MCAP')}</span>
          <span className="se2-akp-token-stat-value">{mcap != null ? fmtLargeShort(mcap) : '—'}</span>
        </div>
        <div className="se2-akp-token-stat">
          <span className="se2-akp-token-stat-label">{t('searchEngineV2.assetKnowledge.vol', 'VOL')}</span>
          <span className="se2-akp-token-stat-value">{vol != null ? fmtLargeShort(vol) : '—'}</span>
        </div>
        <div className="se2-akp-token-stat">
          <span className="se2-akp-token-stat-label">{t('searchEngineV2.assetKnowledge.change7d', '7D')}</span>
          <span className="se2-akp-token-stat-value">{fmtPct(change7d)}</span>
        </div>
      </div>
    </div>
  )
}

/* ── AssetChartCard ────────────────────────────────────────────────── */
function AssetChartCard({ symbol, t }) {
  if (!symbol) return null
  return (
    <div className="se2-akp-card se2-akp-chart-card">
      <Suspense fallback={<div className="se2-akp-chart-skeleton" />}>
        <MonarchChart spec={{
          type: 'spectre_asset',
          symbol,
          timeframe: '1H',
          title: `${symbol} — ${t('searchEngineV2.assetKnowledge.chartLive', 'live')}`,
          source: 'Spectre',
          sources: [],
        }} />
      </Suspense>
    </div>
  )
}

/* ── TechnicalsCard ────────────────────────────────────────────────── */
function TechnicalsCard({ technicals, t, fmtLargeShort }) {
  if (!technicals) return null
  const signal = technicals.summary?.signal
  const rsi = technicals.oscillators?.rsi_14?.value
  const macd = technicals.oscillators?.macd?.trend || technicals.oscillators?.macd?.signal
  const ma50 = technicals.moving_averages?.ema_50 || technicals.ema_50 || technicals.ma_50
  const ma200 = technicals.moving_averages?.ema_200 || technicals.ema_200 || technicals.ma_200

  // Translate the signal token (strong_buy / buy / neutral / sell / strong_sell)
  // through the namespace; fall back to the upper-cased raw value.
  const signalLabel = signal
    ? t(`searchEngineV2.assetKnowledge.signal.${signal}`, signal.replace(/_/g, ' ').toUpperCase())
    : null
  const signalTone = signal ? (signal.includes('buy') ? 'up' : signal.includes('sell') ? 'down' : 'neutral') : null

  if (!signalLabel && !rsi && !macd && !ma50) return null

  return (
    <div className="se2-akp-card">
      <div className="se2-akp-card-title">{t('searchEngineV2.assetKnowledge.technicalsTitle', 'TECHNICALS')}</div>
      <dl className="se2-akp-row-list">
        {signalLabel && (
          <div className="se2-akp-row">
            <dt>{t('searchEngineV2.assetKnowledge.signal.label', 'Signal')}</dt>
            <dd>
              {signalTone && <span className={`se2-akp-tone-dot tone-${signalTone}`} />}
              {signalLabel}
            </dd>
          </div>
        )}
        {rsi != null && (
          <div className="se2-akp-row">
            <dt>{t('searchEngineV2.assetKnowledge.rsi14', 'RSI 14')}</dt>
            <dd className="se2-akp-mono">{fmtRsi(rsi)}</dd>
          </div>
        )}
        {macd && (
          <div className="se2-akp-row">
            <dt>{t('searchEngineV2.assetKnowledge.macd', 'MACD')}</dt>
            <dd>{String(macd).toUpperCase()}</dd>
          </div>
        )}
        {(ma50 || ma200) && (
          <div className="se2-akp-row">
            <dt>{t('searchEngineV2.assetKnowledge.maPair', 'MA 50 / 200')}</dt>
            <dd className="se2-akp-mono">
              {ma50 != null ? fmtLargeShort(ma50) : '—'} / {ma200 != null ? fmtLargeShort(ma200) : '—'}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

/* ── InstitutionalCard ─────────────────────────────────────────────── */
function InstitutionalCard({ institutional, t }) {
  if (!institutional) return null
  const cats = institutional.category_scores || {}
  const dims = Object.keys(cats)
  if (dims.length === 0) return null

  const composite = institutional.score
  const grade = institutional.grade

  return (
    <div className="se2-akp-card">
      <div className="se2-akp-card-title">{t('searchEngineV2.assetKnowledge.institutionalTitle', 'INSTITUTIONAL READINESS')}</div>
      <div className="se2-akp-inst-list">
        {dims.map((dim) => {
          const score = num(cats[dim])
          const pct = Math.min(100, Math.max(0, score || 0))
          const filled = Math.round(pct / 10)
          // Each dimension key (e.g. team_quality) is looked up in the
          // institutionalDim subnamespace; raw value falls through as default.
          const dimLabel = t(`searchEngineV2.assetKnowledge.institutionalDim.${dim}`, dim.replace(/_/g, ' '))
          return (
            <div key={dim} className="se2-akp-inst-row">
              <span className="se2-akp-inst-label">{dimLabel}</span>
              <span className="se2-akp-inst-bar" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, i) => (
                  <span
                    key={i}
                    className={`se2-akp-inst-segment ${i < filled ? 'is-filled' : ''}`}
                  />
                ))}
              </span>
              <span className="se2-akp-inst-score">{score != null ? new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(score) : '—'}</span>
            </div>
          )
        })}
      </div>
      {composite != null && (
        <div className="se2-akp-inst-foot">
          <span className="se2-akp-inst-foot-label">{t('searchEngineV2.assetKnowledge.composite', 'Composite')}</span>
          <span className="se2-akp-inst-foot-value">
            {grade && <span className="se2-akp-inst-grade">{grade}</span>}
            <span className="se2-akp-mono">{fmtNumber(composite, 1)}</span>
          </span>
        </div>
      )}
    </div>
  )
}

/* ── CatalystsRisksCard (from dossier brain_voice etc) ─────────────── */
function CatalystsRisksCard({ dossier, t }) {
  if (!dossier) return null
  const catalysts = Array.isArray(dossier.catalysts) ? dossier.catalysts.slice(0, 3) : []
  const risks = Array.isArray(dossier.risk_flags) ? dossier.risk_flags.slice(0, 3) : []
  if (catalysts.length === 0 && risks.length === 0) return null

  return (
    <div className="se2-akp-card">
      {catalysts.length > 0 && (
        <>
          <div className="se2-akp-card-title">{t('searchEngineV2.assetKnowledge.catalystsTitle', 'CATALYSTS')}</div>
          <ul className="se2-akp-flag-list">
            {catalysts.map((c, i) => (
              <li key={i} className="se2-akp-flag is-up">
                <span className="se2-akp-flag-glyph">▲</span>
                {typeof c === 'string' ? c : (c?.title || c?.event || c?.label || JSON.stringify(c).slice(0, 80))}
              </li>
            ))}
          </ul>
        </>
      )}
      {risks.length > 0 && (
        <>
          <div className="se2-akp-card-title" style={{ marginTop: catalysts.length ? 16 : 0 }}>
            {t('searchEngineV2.assetKnowledge.riskFlagsTitle', 'RISK FLAGS')}
          </div>
          <ul className="se2-akp-flag-list">
            {risks.map((r, i) => (
              <li key={i} className="se2-akp-flag is-down">
                <span className="se2-akp-flag-glyph">▼</span>
                {typeof r === 'string' ? r : (r?.title || r?.label || JSON.stringify(r).slice(0, 80))}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/* ── Panel ─────────────────────────────────────────────────────────── */
function AssetKnowledgePanel({ stream }) {
  const { t } = useTranslation()
  const { fmtPrice, fmtLargeShort } = useCurrency()

  const symbol = stream.meta?.assets?.[0]
  if (!symbol) return null

  const slots = stream.slots || {}
  const price = slots.price
  const technicals = slots.technicals
  const institutional = slots.institutional
  const dossier = slots[`dossier_${symbol}`] || slots.dossier

  return (
    <>
      <AssetTokenCard symbol={symbol} price={price} t={t} fmtPrice={fmtPrice} fmtLargeShort={fmtLargeShort} />
      <AssetChartCard symbol={symbol} t={t} />
      <TechnicalsCard technicals={technicals} t={t} fmtLargeShort={fmtLargeShort} />
      <InstitutionalCard institutional={institutional} t={t} />
      <CatalystsRisksCard dossier={dossier} t={t} />
    </>
  )
}

export default memo(AssetKnowledgePanel, (prev, next) => (
  prev.stream.meta?.assets === next.stream.meta?.assets &&
  prev.stream.slots?.price === next.stream.slots?.price &&
  prev.stream.slots?.technicals === next.stream.slots?.technicals &&
  prev.stream.slots?.institutional === next.stream.slots?.institutional &&
  prev.stream.slots?.dossier === next.stream.slots?.dossier
))
