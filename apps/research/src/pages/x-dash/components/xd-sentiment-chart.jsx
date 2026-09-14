/* Sentiment vs Price overlay — composes the brief's social-momentum
   history (mentions + engagement) with the token's 7-day price track on
   a dual-axis chart. Reveals the two regimes the user cares about:
     - Confirmation: mentions trend up, price trends up. Social is real.
     - Frontrun:    mentions surge while price stays flat / lags. The
                    crowd is loading attention before the chart moves.
   The badge top-right surfaces the divergence in plain words so the
   read is instant.

   Data:
     - Mentions / engagement: passed in via `history` (same shape the
       XDMomentumArea consumes, from intel snapshots).
     - Price: fetched here from CoinGecko via the /api/coingecko proxy.
       Linear mode uses /market_chart (continuous price line). Candle
       mode uses /ohlc (4-hour OHLC bars over 7 days).

   Chart tech: Recharts ComposedChart. Candles are drawn as a custom
   <Bar> shape over a ranged dataKey — wick + body via SVG primitives. */
import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import useSettingsStore from '@/store/useSettingsStore'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { formatNum } from './x-dash-utils'

/* CG price fetch — cached per (cgId, mode, days). Cache TTL is long
   (15min) because the chart shows trailing 7d so a refresh inside that
   window is wasted egress. On 429 we serve stale cache forever rather
   than blanking the chart — the chart is read-only context, slightly
   stale price is infinitely better than "no data" for the user's eye. */
const _priceCache = new Map()  // key: `${cgId}:${mode}:${days}` -> { data, ts }
const _inflight = new Map()
const CACHE_TTL = 15 * 60 * 1000

function priceCacheKey(cgId, mode, days) {
  return `${cgId}:${mode}:${days}`
}

async function fetchPriceRows(cgId, mode, days, { signal } = {}) {
  const key = priceCacheKey(cgId, mode, days)
  const hit = _priceCache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  if (_inflight.has(key)) return _inflight.get(key)
  const url = mode === 'candle'
    ? `/api/coingecko/coins/${encodeURIComponent(cgId)}/ohlc?vs_currency=usd&days=${days}`
    : `/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`
  const promise = (async () => {
    try {
      const res = await fetch(url, { signal: signal || AbortSignal.timeout(12000) })
      if (!res.ok) {
        /* If we have an older snapshot in cache, serve it on 429 / 5xx
           instead of throwing — the chart should never blank just
           because the upstream blinked. */
        if (hit) return hit.data
        throw new Error(`price fetch ${res.status}`)
      }
      const json = await res.json()
      let rows
      if (mode === 'candle') {
        rows = (Array.isArray(json) ? json : []).map(([t, o, h, l, c]) => ({
          ts: t, open: o, high: h, low: l, close: c,
        }))
      } else {
        const arr = Array.isArray(json?.prices) ? json.prices : []
        rows = arr.map(([t, p]) => ({ ts: t, price: p }))
      }
      _priceCache.set(key, { data: rows, ts: Date.now() })
      return rows
    } catch (err) {
      /* On network error / abort, serve stale if any. Only re-throw
         when truly nothing to show. */
      if (hit) return hit.data
      throw err
    }
  })()
    .finally(() => _inflight.delete(key))
  _inflight.set(key, promise)
  return promise
}

function usePriceData(cgId, mode, days = 7) {
  const [data, setData] = useState(() => {
    /* Seed from cache synchronously so a remount inside the cache window
       paints the chart immediately instead of flashing the loading shimmer
       and then the result a tick later. */
    if (!cgId) return null
    const hit = _priceCache.get(priceCacheKey(cgId, mode, days))
    return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data : null
  })
  const [loading, setLoading] = useState(() => {
    if (!cgId) return false
    const hit = _priceCache.get(priceCacheKey(cgId, mode, days))
    return !(hit && Date.now() - hit.ts < CACHE_TTL)
  })

  useEffect(() => {
    if (!cgId) { setData(null); setLoading(false); return undefined }
    const ac = new AbortController()
    let cancelled = false
    /* Seed from cache up-front so toggling Linear↔Candle reuses any
       cached snapshot for the other mode while the new mode loads. */
    const cached = _priceCache.get(priceCacheKey(cgId, mode, days))
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setData(cached.data)
      setLoading(false)
      return () => { cancelled = true; ac.abort() }
    }
    setLoading(true)
    fetchPriceRows(cgId, mode, days, { signal: ac.signal })
      .then((rows) => {
        if (cancelled) return
        setData(rows)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return
        /* Never blank the chart — keep last good data; only flip loading
           off so the shimmer disappears. The user sees the stale chart
           plus the silent failure, which is the right tradeoff. */
        setLoading(false)
      })
    return () => { cancelled = true; ac.abort() }
  }, [cgId, mode, days])

  return { data, loading }
}

/* Custom candle shape — green when close >= open, red otherwise. Wick
   spans low->high, body spans open->close. Width derives from the
   bar slot Recharts hands us. */
function CandleShape({ x, y, width, height, payload, yScale, palette }) {
  if (!payload || payload.open == null || payload.high == null) return null
  const { open, high, low, close } = payload
  const up = close >= open
  const fill = up ? palette.bull : palette.bear
  const stroke = fill
  /* yScale is the price scale from the right axis. Recharts feeds the
     shape the bar's geometry as if the bar maps to [low..high]; we use
     yScale to compute body coords from open/close instead. */
  const wickX = x + width / 2
  const yHigh = yScale(high)
  const yLow = yScale(low)
  const yOpen = yScale(open)
  const yClose = yScale(close)
  const bodyTop = Math.min(yOpen, yClose)
  const bodyH = Math.max(1, Math.abs(yOpen - yClose))
  const bodyX = x + width * 0.18
  const bodyW = width * 0.64
  return (
    <g>
      <line x1={wickX} y1={yHigh} x2={wickX} y2={yLow} stroke={stroke} strokeWidth={1} />
      <rect x={bodyX} y={bodyTop} width={bodyW} height={bodyH} fill={fill} stroke={stroke} strokeWidth={1} rx={1} />
    </g>
  )
}

/* Bin mentions/engagement snapshots into the same time buckets the
   price chart uses, so the Recharts XAxis can align them. Both feeds
   live on different cadences — intel snaps are irregular, CG OHLC is
   4h-bucketed — so we map intel to the nearest price bucket and sum. */
function alignSeries(priceRows, historyRows, mode, locale) {
  if (!priceRows?.length) return []
  /* For line mode we use raw price points (hourly-ish). For candle
     mode we bucket into the 4h OHLC slots. Either way the price row
     is the spine; mentions are attached to whichever spine slot the
     snapshot falls into (or before, if the snap is older than the
     window). */
  const intel = (Array.isArray(historyRows) ? historyRows : [])
    .map((h) => ({
      ts: new Date(h.snapshot_at).getTime(),
      mentions: Number((h.mentions && h.mentions['24h']) ?? h.mentions ?? 0),
      engagement: Number((h.weighted_engagement && h.weighted_engagement['24h']) ?? h.weighted_engagement ?? 0),
    }))
    .filter((h) => Number.isFinite(h.ts))
    .sort((a, b) => a.ts - b.ts)

  return priceRows.map((p, i) => {
    /* find the latest intel snapshot at or before this price tick */
    let mentions = 0
    let engagement = 0
    if (intel.length) {
      let lo = 0, hi = intel.length - 1, idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (intel[mid].ts <= p.ts) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      if (idx >= 0) {
        mentions = intel[idx].mentions
        engagement = intel[idx].engagement
      }
    }
    return {
      ts: p.ts,
      label: new Date(p.ts).toLocaleString(locale || undefined, { month: 'short', day: 'numeric', hour: 'numeric' }),

      price: p.price,
      open: p.open, high: p.high, low: p.low, close: p.close,
      mentions, engagement,
      /* candleRange is the [low, high] tuple Recharts needs to size the
         <Bar> slot; the custom shape redraws inside using open/close. */
      candleRange: mode === 'candle' && p.high != null ? [p.low, p.high] : undefined,
      pricePoint: mode === 'candle' && p.close != null ? p.close : p.price,
    }
  })
}

/* Divergence score returns key+fallback descriptors that consumers resolve
   via t(). Score values stay numeric. */
function computeDivergence(series) {
  if (!series || series.length < 8) return { score: 0, key: 'xDash.sentiment.divergence.insufficient', fallback: 'Insufficient data' }
  const tail = series.slice(-Math.max(6, Math.floor(series.length / 4)))
  const firstPrice = tail[0].pricePoint || tail[0].price || 0
  const lastPrice = tail[tail.length - 1].pricePoint || tail[tail.length - 1].price || 0
  const priceΔ = firstPrice ? (lastPrice - firstPrice) / firstPrice : 0
  const firstM = tail[0].mentions || 0
  const lastM = tail[tail.length - 1].mentions || 0
  const peakM = Math.max(...tail.map((r) => r.mentions || 0))
  const mentionsΔ = peakM ? (lastM - firstM) / peakM : 0
  const score = mentionsΔ - priceΔ * 2
  if (score >= 0.35) return { score, key: 'xDash.sentiment.divergence.frontrun', fallback: 'Frontrun signal', tone: 'bull' }
  if (score >= 0.15) return { score, key: 'xDash.sentiment.divergence.socialLeading', fallback: 'Social leading price', tone: 'amber' }
  if (score <= -0.25) return { score, key: 'xDash.sentiment.divergence.priceAhead', fallback: 'Price ahead of social', tone: 'bear' }
  return { score, key: 'xDash.sentiment.divergence.inSync', fallback: 'In sync', tone: 'neutral' }
}

/* Two distinct hues so the linear-mode overlay reads even when both
   series ride at similar y-ratios:
   - Mentions: violet (the brain/social color)
   - Price:    cyan  (the price/market color)
   Both get gradient fills under the curve in linear mode so the chart
   actually fills the canvas instead of looking like two lonely lines. */
const PALETTE_DARK = {
  bull: '#10B981', bear: '#EF4444',
  price: '#22D3EE',
  priceFill: 'rgba(34, 211, 238, 0.30)',
  mentions: '#A78BFA',
  mentionsFill: 'rgba(167, 139, 250, 0.40)',
  grid: 'rgba(255,255,255,0.06)',
  axis: 'rgba(245,245,247,0.55)',
}
const PALETTE_LIGHT = {
  bull: '#047857', bear: '#b91c1c',
  price: '#0e7490',
  priceFill: 'rgba(14, 116, 144, 0.20)',
  mentions: '#7c3aed',
  mentionsFill: 'rgba(124, 58, 237, 0.22)',
  grid: 'rgba(15,23,42,0.10)',
  axis: 'rgba(15,23,42,0.62)',
}

function CustomTip({ active, payload, label, fmtPrice }) {
  const { t } = useTranslation()
  if (!active || !payload || !payload.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const priceText = row.pricePoint != null ? fmtPrice(Number(row.pricePoint)) : '—'
  return (
    <div className="xd-sentiment-tip">
      <div className="xd-sentiment-tip__time">{label}</div>
      <div className="xd-sentiment-tip__row"><span>{t('xDash.sentiment.tip.price', 'Price')}</span><b className="xd-num">{priceText}</b></div>
      {row.open != null && (
        <>
          <div className="xd-sentiment-tip__row xd-sentiment-tip__row--small">
            <span>O</span><b className="xd-num">{fmtPrice(Number(row.open))}</b>
            <span>H</span><b className="xd-num">{fmtPrice(Number(row.high))}</b>
          </div>
          <div className="xd-sentiment-tip__row xd-sentiment-tip__row--small">
            <span>L</span><b className="xd-num">{fmtPrice(Number(row.low))}</b>
            <span>C</span><b className="xd-num">{fmtPrice(Number(row.close))}</b>
          </div>
        </>
      )}
      <div className="xd-sentiment-tip__row">
        <span>{t('xDash.sentiment.tip.mentions', 'Mentions')}</span><b className="xd-num">{formatNum(row.mentions)}</b>
      </div>
      <div className="xd-sentiment-tip__row">
        <span>{t('xDash.sentiment.tip.engagement', 'Engagement')}</span><b className="xd-num">{formatNum(row.engagement, { maxFraction: 0 })}</b>
      </div>
    </div>
  )
}

export default function XDSentimentChart({ cgId, history = [], height = 280, days = 7 }) {
  const { t, i18n } = useTranslation()
  const { fmtPrice } = useCurrency()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const palette = dayMode ? PALETTE_LIGHT : PALETTE_DARK
  const [mode, setMode] = useState('line')
  const { data: priceRows, loading: priceLoading } = usePriceData(cgId, mode, days)

  const series = useMemo(
    () => alignSeries(priceRows || [], history, mode, i18n.language),
    [priceRows, history, mode, i18n.language],
  )
  const divergence = useMemo(() => computeDivergence(series), [series])
  const divergenceLabel = t(divergence.key, divergence.fallback)

  /* Right-axis (price) needs a sensible domain padded around min/max
     so the candles don't kiss the chart edge. */
  const priceDomain = useMemo(() => {
    const vals = series.flatMap((r) => [r.high, r.low, r.price].filter((v) => v != null && Number.isFinite(v)))
    if (!vals.length) return ['auto', 'auto']
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.08 || max * 0.02 || 1
    return [Math.max(0, min - pad), max + pad]
  }, [series])

  /* Recharts Bar shape needs a scale function to map prices back to y
     coords. We grab the YAxis ref via Recharts internals (the right
     YAxis ID) inside the candle renderer below. Simpler: we bake the
     scale into the shape via closure — Recharts passes payload but we
     also need scale, so we mount a tiny effect that reads the axis
     scale from the SVG context. For MVP we approximate y from the
     domain + chart height ratio; good enough because the chart area
     is bounded by margins.top + height - margins.bottom. */
  const TOP_MARGIN = 12
  const BOTTOM_MARGIN = 22
  const chartAreaH = height - TOP_MARGIN - BOTTOM_MARGIN
  const yScale = (price) => {
    const [lo, hi] = priceDomain
    if (hi === lo) return TOP_MARGIN + chartAreaH / 2
    return TOP_MARGIN + (1 - (price - lo) / (hi - lo)) * chartAreaH
  }

  const hasPrice = (priceRows || []).length > 0
  const empty = !priceLoading && !hasPrice

  return (
    <div className="xd-sentiment">
      <div className="xd-sentiment__head">
        <div className="xd-sentiment__title">
          <span className="xd-drawer-chart__label" style={{ margin: 0 }}>{t('xDash.sentiment.title', 'Sentiment vs Price')}</span>
          <span className="xd-sentiment__sub">{t('xDash.sentiment.subtitle', '7d · price overlaid on social momentum')}</span>
        </div>
        <div className="xd-sentiment__head-right">
          <span
            className={`xd-sentiment__verdict xd-sentiment__verdict--${divergence.tone || 'neutral'}`}
            title={t('xDash.sentiment.divergenceScore', 'Divergence score {{score}}', { score: divergence.score.toFixed(2) })}
          >
            {divergenceLabel}
          </span>
          <div className="xd-sentiment__toggle" role="tablist" aria-label={t('xDash.sentiment.modeAria', 'Price chart mode')}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'line'}
              className={`xd-sentiment__toggle-btn${mode === 'line' ? ' is-active' : ''}`}
              onClick={() => setMode('line')}
            >
              {t('xDash.sentiment.mode.linear', 'Linear')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'candle'}
              className={`xd-sentiment__toggle-btn${mode === 'candle' ? ' is-active' : ''}`}
              onClick={() => setMode('candle')}
            >
              {t('xDash.sentiment.mode.candle', 'Candle')}
            </button>
          </div>
        </div>
      </div>

      <div className="xd-sentiment__body" style={{ height }}>
        {priceLoading && (
          <div className="xd-sentiment__state">
            <div className="animate-shimmer" style={{ width: '100%', height: '100%', borderRadius: 8 }} />
          </div>
        )}
        {empty && <div className="xd-sentiment__state">{t('xDash.sentiment.empty', 'No price data for this token in the last {{days}} days.', { days })}</div>}
        {!priceLoading && hasPrice && (
          <ResponsiveContainer width="100%" height={height} minWidth={0}>
            <ComposedChart data={series} margin={{ top: TOP_MARGIN, right: 8, bottom: BOTTOM_MARGIN, left: 0 }}>
              <defs>
                <linearGradient id="xdSentMentFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.mentionsFill} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={palette.mentionsFill} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="xdSentPriceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.priceFill} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={palette.priceFill} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={palette.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: palette.axis, fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={{ stroke: palette.grid }}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              {/* Left axis = mentions (raw counts) */}
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: palette.mentions, fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={{ stroke: palette.grid }}
                tickFormatter={(v) => formatNum(v)}
                width={42}
              />
              {/* Right axis = price (USD) */}
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={priceDomain}
                tick={{ fontSize: 10, fill: palette.price, fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={{ stroke: palette.grid }}
                tickFormatter={(v) => fmtPrice(Number(v))}
                width={62}
              />
              <Tooltip
                content={<CustomTip fmtPrice={fmtPrice} />}
                cursor={{ stroke: palette.grid, strokeWidth: 1 }}
                wrapperStyle={{ outline: 'none' }}
              />
              {/* LINEAR MODE — two area charts overlaid with gradient
                  fills so the canvas reads as a proper sentiment-vs-price
                  overlay. Mentions area is rendered first so price sits
                  on top (price is the headline metric here). */}
              {mode === 'line' && (
                <>
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="mentions"
                    stroke={palette.mentions}
                    strokeWidth={2}
                    fill="url(#xdSentMentFill)"
                    fillOpacity={1}
                    isAnimationActive={false}
                    activeDot={{ r: 3, stroke: palette.mentions, strokeWidth: 2, fill: '#fff' }}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="price"
                    stroke={palette.price}
                    strokeWidth={2.5}
                    fill="url(#xdSentPriceFill)"
                    fillOpacity={1}
                    isAnimationActive={false}
                    activeDot={{ r: 4, stroke: palette.price, strokeWidth: 2, fill: '#fff' }}
                  />
                </>
              )}
              {/* CANDLE MODE — mentions bars + OHLC candles on price axis. */}
              {mode === 'candle' && (
                <>
                  <Bar
                    yAxisId="left"
                    dataKey="mentions"
                    fill="url(#xdSentMentFill)"
                    stroke={palette.mentions}
                    strokeWidth={0.5}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="candleRange"
                    isAnimationActive={false}
                    shape={(props) => <CandleShape {...props} yScale={yScale} palette={palette} />}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="xd-sentiment__legend">
        <span className="xd-sentiment__legend-item">
          <span className="xd-sentiment__legend-swatch" style={{ background: palette.mentions }} />
          {t('xDash.sentiment.legend.mentions', 'Mentions (24h)')}
        </span>
        <span className="xd-sentiment__legend-item">
          <span className="xd-sentiment__legend-swatch" style={{ background: palette.price }} />
          {t('xDash.sentiment.legend.price', 'Price')}
        </span>
        {mode === 'candle' && (
          <span className="xd-sentiment__legend-hint">{t('xDash.sentiment.legend.candleHint', 'Green = close ≥ open · Red = close < open')}</span>
        )}
      </div>
    </div>
  )
}
