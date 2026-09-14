/**
 * Live-chart audit. Renders a minimal canvas chart driven by
 * useSpectreLiveChart (Spectre candles + SSE live ticks) for visual
 * verification of "does the bar move correctly in real time".
 *
 * Layout: side-by-side mini-charts for BTC/ETH/SOL/PEPE. Each shows:
 *   - 7-day 1h candles from Spectre
 *   - Live last-bar update driven by SSE ticks
 *   - SSE tick count, connection status, last tick age
 *   - Spectre last close vs running close (drift if non-zero)
 *
 * No comparison to TradingView in the same panel because TV widget has its
 * own lifecycle (heavy). The Chart Bars tab already proves bar-level parity;
 * this tab proves the LIVE TAIL works.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useSpectreLiveChart } from '@/hooks/spectre/useSpectreLiveChart'

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'PEPE']

function MiniChart({ bars, height = 120 }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !bars || bars.length === 0) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const tail = bars.slice(-100)
    const highs = tail.map(b => b.high)
    const lows = tail.map(b => b.low)
    const hi = Math.max(...highs), lo = Math.min(...lows)
    const range = (hi - lo) || 1
    const barW = cssW / tail.length

    tail.forEach((b, i) => {
      const x = i * barW + barW / 2
      const yHigh = ((hi - b.high) / range) * cssH
      const yLow = ((hi - b.low) / range) * cssH
      const yOpen = ((hi - b.open) / range) * cssH
      const yClose = ((hi - b.close) / range) * cssH
      const isUp = b.close >= b.open
      ctx.strokeStyle = isUp ? '#10B981' : '#EF4444'
      ctx.fillStyle = isUp ? '#10B981' : '#EF4444'
      ctx.beginPath()
      ctx.moveTo(x, yHigh)
      ctx.lineTo(x, yLow)
      ctx.stroke()
      const bodyTop = Math.min(yOpen, yClose), bodyBot = Math.max(yOpen, yClose)
      ctx.fillRect(x - Math.max(1, barW / 3), bodyTop, Math.max(2, (barW / 3) * 2), Math.max(1, bodyBot - bodyTop))
    })
  }, [bars])
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }} />
}

function Card({ symbol }) {
  const live = useSpectreLiveChart(symbol, '60', 168)
  const ticksAgo = live.meta?.lastTickAt ? Math.round((Date.now() - live.meta.lastTickAt) / 1000) : null
  const verdict = !live.bars?.length ? { tone: 'red', text: 'NO BARS' }
    : !live.meta?.sseConnected ? { tone: 'yellow', text: 'SSE NOT CONNECTED' }
    : live.meta?.tickCount === 0 ? { tone: 'yellow', text: 'NO TICKS YET' }
    : ticksAgo > 10 ? { tone: 'yellow', text: `last tick ${ticksAgo}s ago` }
    : { tone: 'green', text: 'LIVE' }

  return (
    <div className="dsa-live-card">
      <div className="dsa-live-head">
        <div>
          <strong>{symbol}</strong>
          <div className="dsa-meta">
            bars: {live.bars?.length || 0} · last close:{' '}
            {live.last?.close ? (live.last.close > 1 ? live.last.close.toFixed(2) : live.last.close.toPrecision(4)) : '—'}
          </div>
        </div>
        <span className={`dsa-verdict dsa-verdict--${verdict.tone}`}>{verdict.text}</span>
      </div>
      <MiniChart bars={live.bars} />
      <div className="dsa-meta" style={{ marginTop: 8 }}>
        SSE: {live.meta?.sseConnected ? 'connected' : 'disconnected'} ·
        ticks: <strong>{live.meta?.tickCount ?? 0}</strong> ·
        last tick: {ticksAgo != null ? `${ticksAgo}s ago` : '—'} ·
        source: <code>{live.meta?.source || '—'}</code> ·
        flat: {((live.meta?.flatRatio || 0) * 100).toFixed(0)}%
      </div>
    </div>
  )
}

export default function LiveChartAuditPanel() {
  return (
    <div className="dsa-panel">
      <p className="dsa-meta" style={{ marginBottom: 16 }}>
        Four mini-charts driven by <code>useSpectreLiveChart</code>: 7-day 1h candles
        from <code>/v1/candles</code> plus live last-bar updates from{' '}
        <code>/v1/stream/prices/sse</code>. Watch the last candle move as SSE ticks
        arrive (every 1-3 seconds). Tick counter advances per upstream event.
      </p>
      <div className="dsa-live-grid">
        {SYMBOLS.map(sym => <Card key={sym} symbol={sym} />)}
      </div>
      <p className="dsa-footnote">
        This is the replacement shape for the TradingView 15s <code>getBars</code>{' '}
        poll in <code>components/TradingViewAdvanced.jsx</code>. Each symbol-set has
        a single shared <code>EventSource</code>; mounting 4 cards = 1 SSE connection
        (because all 4 symbols share one stream). At 1k users opening this page
        that is <strong>1 SSE connection × 4 symbols</strong> regardless of user
        count, vs <strong>1k users × 4 polls/min × 4 symbols = 16,000 Codex calls/min</strong>{' '}
        under the current polling shape.
      </p>
    </div>
  )
}
