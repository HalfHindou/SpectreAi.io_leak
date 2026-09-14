import React, { useEffect, useLayoutEffect, useRef, useMemo, memo } from 'react'
import { createChart, ColorType, AreaSeries } from 'lightweight-charts'

/**
 * MentionTimelinePanel — full-width Lightweight Charts area chart of
 * mentions per hour over the past 7 days. Pulled from the X Dash token
 * detail response. Field shape varies, so we try a few common keys.
 *
 * Adapted from HoldersChart.jsx — the Lightweight Charts setup is the same.
 */
function MentionTimelinePanel({ intel, loading }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

  const chartData = useMemo(() => normalizeTimeseries(intel), [intel])

  // Mount the chart synchronously once the container is in the DOM. Read the
  // container width directly via getBoundingClientRect() to avoid the
  // state-based race that left the canvas un-created in strict mode. The
  // ResizeObserver only re-applies the width on subsequent layout changes.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const initialWidth = Math.floor(container.getBoundingClientRect().width) || 320

    const chart = createChart(container, {
      width: initialWidth,
      height: 180,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(245, 245, 247, 0.45)',
        fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.025)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.025)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.05 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.18)', width: 1, style: 2, labelVisible: false },
        horzLine: { color: 'rgba(255,255,255,0.18)', width: 1, style: 2 },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
      handleScale: false,
    })

    const series = chart.addSeries(AreaSeries, {
      lineColor: 'rgba(245, 245, 247, 0.92)',
      topColor: 'rgba(245, 245, 247, 0.16)',
      bottomColor: 'rgba(245, 245, 247, 0.01)',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v))),
      },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    })

    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width)
        if (w > 0 && chartRef.current) {
          chartRef.current.applyOptions({ width: w })
        }
      }
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Push data
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    if (!chartData || chartData.length === 0) {
      series.setData([])
      return
    }
    series.setData(chartData)
    chart.timeScale().fitContent()
  }, [chartData])

  const totals = useMemo(() => {
    if (!chartData || chartData.length === 0) return null
    const total = chartData.reduce((s, d) => s + d.value, 0)
    const peak = Math.max(...chartData.map((d) => d.value))
    return { total, peak }
  }, [chartData])

  const hasData = chartData && chartData.length > 0

  return (
    <div className="xfv-panel">
      <div className="xfv-panel-header">
        <div
          className="xfv-panel-title xfv-tip"
          data-xfv-tip="Number of tweets mentioning this token, bucketed by hour, over the last 7 days. Spikes show when narrative attention shifts."
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 4 4 6-6" />
          </svg>
          <span>Mention Timeline · 7d</span>
        </div>
        {totals && (
          <span
            className="xfv-panel-meta xfv-tip xfv-tip--inline"
            data-xfv-tip={`${totals.total.toLocaleString()} total tweets in the last 7 days. The busiest hour saw ${totals.peak.toLocaleString()} mentions.`}
          >
            {totals.total.toLocaleString()} total · peak {totals.peak.toLocaleString()}/h
            <span className="xfv-tip-icon" aria-hidden="true">?</span>
          </span>
        )}
      </div>
      <div className="xfv-panel-body" style={{ padding: 14 }}>
        <div className="xfv-timeline-chart" ref={containerRef}>
          {!hasData && !loading && (
            <div className="xfv-timeline-empty">Not enough data yet</div>
          )}
          {!hasData && loading && (
            <div className="xfv-timeline-empty">Loading mention timeline…</div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Normalize mention timeseries from various possible response shapes into the
 * Lightweight Charts format: [{ time: unix-seconds, value: number }, ...]
 *
 * The X Dash backend currently does NOT return a pre-aggregated time-series on
 * this endpoint, so the final fallback buckets the raw `mentions` array into
 * hourly bins client-side using `tweet.created_at_utc`.
 */
function normalizeTimeseries(intel) {
  if (!intel) return []
  const candidates = [
    intel.timeseries?.mentions_per_hour,
    intel.token?.mention_timeseries,
    intel.mention_timeseries,
    intel.metrics?.mention_timeseries,
    intel.timeseries?.mentions,
    intel.timeseries,
  ]
  let raw = null
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      raw = c
      break
    }
  }

  if (raw) {
    return raw
      .map((p) => {
        if (typeof p === 'number') return null // can't time-stamp a bare number
        const ts =
          p.timestamp ||
          p.time ||
          p.bucket ||
          p.bucket_start ||
          p.t ||
          p.date ||
          null
        const value = num(p.count ?? p.value ?? p.mentions ?? p.mention_count ?? p.y)
        const seconds = parseTimestamp(ts)
        if (!seconds || !Number.isFinite(value)) return null
        return { time: seconds, value }
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time)
  }

  // Fallback: bucket raw mention objects by hour using tweet.created_at_utc.
  const mentions = Array.isArray(intel.mentions) ? intel.mentions : []
  if (mentions.length === 0) return []

  const HOUR = 3600
  const buckets = new Map()
  for (const m of mentions) {
    const ts = m?.tweet?.created_at_utc || m?.tweet?.created_at || m?.created_at_utc || m?.created_at
    const seconds = parseTimestamp(ts)
    if (!seconds) continue
    const bucket = Math.floor(seconds / HOUR) * HOUR
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
  }
  if (buckets.size === 0) return []

  return Array.from(buckets.entries())
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time)
}

function parseTimestamp(ts) {
  if (!ts) return null
  if (typeof ts === 'number') {
    // Heuristic: ms vs seconds
    return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
  }
  const parsed = Date.parse(ts)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export default memo(MentionTimelinePanel)
