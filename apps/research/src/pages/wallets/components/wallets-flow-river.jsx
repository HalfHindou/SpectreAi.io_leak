/**
 * FlowRiverTab — the money river. Animated left→right particle streams,
 * one lane per real flow (whales, exchange flow, stablecoin mint/redeem,
 * ETFs, smart-money buys/sells, perp desks). Stream density scales with
 * the measured 24h dollars; labels carry the exact numbers.
 *
 * Canvas is lane-stripes only — labels live in DOM columns so the type
 * stays crisp. rAF is visibility-guarded and dies with the tab unmount.
 */
import { useEffect, useMemo, useRef } from 'react'
import useWalletsLane, { fmtUsd } from './use-wallets-data'

const LANE_H = 84
const TONES = {
  neutral: { core: 'rgba(245,245,247,0.85)', soft: 'rgba(245,245,247,0.10)' },
  pos: { core: 'rgba(48,209,88,0.95)', soft: 'rgba(48,209,88,0.10)' },
  neg: { core: 'rgba(255,69,58,0.95)', soft: 'rgba(255,69,58,0.10)' },
  warn: { core: 'rgba(255,159,10,0.95)', soft: 'rgba(255,159,10,0.10)' },
}

// day mode paints the canvas light, where the neutral lane's near-white
// particles are invisible — resolve tones per frame against this palette
const TONES_DAY = {
  neutral: { core: 'rgba(30,41,59,0.72)', soft: 'rgba(30,41,59,0.12)' },
  pos: { core: 'rgba(5,150,105,0.9)', soft: 'rgba(5,150,105,0.14)' },
  neg: { core: 'rgba(220,38,38,0.9)', soft: 'rgba(220,38,38,0.14)' },
  warn: { core: 'rgba(217,119,6,0.9)', soft: 'rgba(217,119,6,0.14)' },
}

/* Which tape chain an aggregate asset resolves to. Anything unmapped falls
   through to 'all' rather than guessing. */
const ASSET_CHAIN = { BTC: 'bitcoin', WBTC: 'ethereum', ETH: 'ethereum', WETH: 'ethereum', USDT: 'ethereum', USDC: 'ethereum' }

/* Destination for a lane click, carried as data on the lane itself so the
   click handler never switches on label text. `seed` (tape only) pre-sets the
   Tape filters to exactly the rows that lane is made of. */
const GO_TAPE = (cohort, chain = 'all') => ({ tab: 'tape', seed: { cohort, chain } })
const GO_FLOWS = { tab: 'flows' }
const GO_PERPS = { tab: 'hyperliquid' }

function buildLanes(cmd, hl, t) {
  if (!cmd) return []
  const lanes = []
  const push = (from, to, usd, tone, note, go) => {
    if (!usd || usd < 1000) return
    lanes.push({ from, to, usd, tone, note, go })
  }

  push(t('walletsPage.rWhales', 'Whales'), t('walletsPage.rOnchain', 'On-chain moves'), cmd.summary?.volumeUsd24h, 'neutral',
    `${cmd.summary?.txCount24h ?? '—'} ${t('walletsPage.transfers', 'large transfers')}`, GO_TAPE('all'))

  for (const a of (cmd.exchangeFlows?.byAsset || []).slice(0, 2)) {
    const net = a.netAdjusted != null ? a.netAdjusted : a.net
    const go = GO_TAPE('exchange', ASSET_CHAIN[a.asset] || 'all')
    if (net < 0) {
      push(`${a.asset} · ${t('walletsPage.rExchanges', 'Exchanges')}`, t('walletsPage.rSelfCustody', 'Self-custody'), Math.abs(net), 'pos',
        t('walletsPage.rStash', 'holders withdrawing'), go)
    } else {
      push(`${a.asset} · ${t('walletsPage.rHolders', 'Holders')}`, t('walletsPage.rExchanges', 'Exchanges'), Math.abs(net), 'neg',
        t('walletsPage.rSellSide', 'potential sell-side'), go)
    }
  }

  push(t('walletsPage.rIssuers', 'Circle + Tether'), t('walletsPage.rCirculation', 'Circulation'), cmd.stables?.minted24h, 'pos',
    t('walletsPage.rMintNote', 'new dollars minted'), GO_TAPE('stables'))
  push(t('walletsPage.rCirculation', 'Circulation'), t('walletsPage.rIssuers', 'Circle + Tether'), cmd.stables?.redeemed24h, 'warn',
    t('walletsPage.rRedeemNote', 'dollars redeemed'), GO_TAPE('stables'))

  for (const a of (cmd.etf?.aggregates || [])) {
    if ((a.flowUsd || 0) >= 0) {
      push(t('walletsPage.rTradfi', 'TradFi cash'), `${a.asset} ETFs`, a.flowUsd, 'pos', t('walletsPage.rEtfBuy', 'funds buying'), GO_FLOWS)
    } else {
      push(`${a.asset} ETFs`, t('walletsPage.rTradfi', 'TradFi cash'), Math.abs(a.flowUsd), 'neg', t('walletsPage.rEtfSell', 'funds selling'), GO_FLOWS)
    }
  }

  const toks = cmd.smartMoney?.tokens || []
  const buys = toks.reduce((s, x) => s + Math.max(0, x.netflow24h || 0), 0)
  const sells = toks.reduce((s, x) => s + Math.max(0, -(x.netflow24h || 0)), 0)
  push(t('walletsPage.rSmart', 'Smart money'), t('walletsPage.rTokens', 'Tokens'), buys, 'pos', t('walletsPage.rSmBuy', 'cohort accumulating'), GO_FLOWS)
  push(t('walletsPage.rTokens', 'Tokens'), t('walletsPage.rSmart', 'Smart money'), sells, 'neg', t('walletsPage.rSmSell', 'cohort distributing'), GO_FLOWS)

  if (hl?.totals) {
    push(t('walletsPage.rDesks', 'Top perp desks'), t('walletsPage.rLongs', 'Bets on up'), hl.totals.longUsd, 'pos',
      `${hl.totals.desks} ${t('walletsPage.rDesksNote', 'profitable desks')}`, GO_PERPS)
    push(t('walletsPage.rDesks', 'Top perp desks'), t('walletsPage.rShorts', 'Bets on down'), hl.totals.shortUsd, 'neg', '', GO_PERPS)
  }

  return lanes.slice(0, 9)
}

const goHint = (go, t) => {
  if (!go) return ''
  if (go.tab === 'tape') return t('walletsPage.rGoTape', 'Open in Tape')
  if (go.tab === 'hyperliquid') return t('walletsPage.rGoDesks', 'Open perp desks')
  return t('walletsPage.rGoFlows', 'Open in Flows')
}

const FlowRiverTab = ({ t, variant = 'desktop', onGoTab }) => {
  const isMobile = variant === 'mobile'
  const laneH = isMobile ? 82 : LANE_H
  const centerFactor = isMobile ? 0.66 : 0.5   // push the wave below the stacked labels on mobile
  const { data: cmd, loading } = useWalletsLane('command')
  const { data: hl } = useWalletsLane('hlDesks')
  const canvasRef = useRef(null)
  const lanes = useMemo(() => buildLanes(cmd, hl, t), [cmd, hl, t])
  const go = (lane) => { if (lane.go && onGoTab) onGoTab(lane.go.tab, lane.go.seed) }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !lanes.length) return undefined
    const ctx = canvas.getContext('2d')
    let raf = 0
    let running = true

    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    const fit = () => {
      const w = canvas.clientWidth
      const h = lanes.length * laneH
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)

    // theme detection: the shell stamps .app-day-mode on the app root; watch
    // it so a live toggle recolors the streams without a remount
    const appEl = canvas.closest('.app')
    let isDay = !!appEl?.classList.contains('app-day-mode')
    const mo = appEl ? new MutationObserver(() => { isDay = appEl.classList.contains('app-day-mode') }) : null
    if (mo) mo.observe(appEl, { attributes: true, attributeFilter: ['class'] })

    // particles per lane scaled by log of dollars
    const streams = lanes.map((lane, i) => {
      const n = Math.max(4, Math.min(isMobile ? 20 : 30, Math.round(Math.log10((lane.usd || 0) / 5e5 + 1) * 9)))
      const amp = (isMobile ? 5 : 7) + (i % 3) * (isMobile ? 2 : 3)
      const wl = 170 + (i % 4) * 40
      return {
        toneName: lane.tone || 'neutral',
        amp,
        wl,
        y: i * laneH + laneH * centerFactor,
        parts: Array.from({ length: n }, (_, k) => ({
          p: (k / n) + Math.random() * 0.04,       // 0..1 progress
          v: 0.0011 + Math.random() * 0.0016,       // speed
          r: (1.3 + Math.random() * 1.9) * (isMobile ? 0.85 : 1),
          drift: Math.random() * Math.PI * 2,
        })),
      }
    })

    let t0 = performance.now()
    const draw = (now) => {
      if (!running) return
      if (document.hidden) { raf = requestAnimationFrame(draw); return }
      const dt = Math.min(50, now - t0)
      t0 = now
      const w = canvas.clientWidth
      ctx.clearRect(0, 0, w, lanes.length * laneH)

      const palette = isDay ? TONES_DAY : TONES
      for (const s of streams) {
        const tone = palette[s.toneName] || palette.neutral
        const phase = now / 1400
        // the wave bed — a faint sine ribbon
        ctx.beginPath()
        for (let x = 0; x <= w; x += 8) {
          const y = s.y + Math.sin((x / s.wl) * Math.PI * 2 + phase) * s.amp
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = tone.soft
        ctx.lineWidth = isMobile ? 16 : 22
        ctx.lineCap = 'round'
        ctx.stroke()

        // travelling particles riding the wave
        for (const pt of s.parts) {
          pt.p += pt.v * (dt / 16.7)
          if (pt.p > 1.02) pt.p = -0.02
          const x = pt.p * w
          const y = s.y + Math.sin((x / s.wl) * Math.PI * 2 + phase + Math.sin(pt.drift + now / 2400) * 0.35) * s.amp
          const fade = Math.min(1, Math.min(pt.p + 0.06, 1.02 - pt.p) * 9)
          if (fade <= 0) continue
          ctx.globalAlpha = Math.max(0, Math.min(0.9, fade))
          ctx.beginPath()
          ctx.arc(x, y, pt.r, 0, Math.PI * 2)
          ctx.fillStyle = tone.core
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      if (mo) mo.disconnect()
    }
  }, [lanes, laneH, centerFactor, isMobile])

  if (loading && !cmd) {
    return <div className="wlp-loading">{[0, 1, 2, 3].map((i) => <div key={i} className={`wlp-loading-row animate-shimmer stagger-${i + 1}`} />)}</div>
  }

  if (isMobile) {
    return (
      <div className="wam-river">
        <div className="wam-river-head">
          <span className="wam-label">{t('walletsPage.riverTitle', 'The Money River')}</span>
          <span className="wam-river-sub">{t('walletsPage.riverSub', 'every stream is measured 24h flow · density = dollars')}</span>
        </div>
        <div className="wam-river-stage" style={{ height: lanes.length * laneH }}>
          <canvas ref={canvasRef} className="wam-river-canvas" aria-hidden />
          <div className="wam-river-overlay">
            {lanes.map((l, i) => (
              <button
                key={i}
                type="button"
                className={`wam-river-lane${l.go && onGoTab ? ' wam-river-lane--go' : ''}`}
                style={{ height: laneH }}
                onClick={() => go(l)}
                aria-label={`${l.from} → ${l.to} · ${fmtUsd(l.usd)}${l.go ? ` · ${goHint(l.go, t)}` : ''}`}
              >
                <div className="wam-river-lane-top">
                  <span className="wam-river-from">{l.from}</span>
                  <span className={`wam-river-usd mono ${l.tone === 'pos' ? 'pos' : l.tone === 'neg' ? 'neg' : l.tone === 'warn' ? 'warn' : ''}`}>{fmtUsd(l.usd)}</span>
                </div>
                <div className="wam-river-lane-sub">
                  <span className="wam-river-to">→ {l.to}</span>
                  {l.note && <span className="wam-river-note">{l.note}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wlp-river-wrap">
      <section className="wlp-card wlp-river-card">
        <header className="wlp-card-head wlp-card-head--row">
          <div className="wlp-card-title-wrap">
            <span className="wlp-card-title">{t('walletsPage.riverTitle', 'The Money River')}</span>
            <span className="wlp-card-sub">{t('walletsPage.riverSub', 'every stream is measured 24h flow · density = dollars')}</span>
          </div>
        </header>
        <div className="wlp-river" style={{ height: lanes.length * LANE_H }}>
          <div className="wlp-river-col wlp-river-col--from">
            {lanes.map((l, i) => (
              <div key={i} className="wlp-river-node" style={{ height: LANE_H }}>
                <span className="wlp-river-name">{l.from}</span>
                {l.note && <span className="wlp-river-note">{l.note}</span>}
              </div>
            ))}
          </div>
          <canvas ref={canvasRef} className="wlp-river-canvas" aria-hidden />
          <div className="wlp-river-col wlp-river-col--to">
            {lanes.map((l, i) => (
              <div key={i} className="wlp-river-node r" style={{ height: LANE_H }}>
                <span className="wlp-river-name">{l.to}</span>
                <span className={`wlp-river-usd mono ${l.tone === 'pos' ? 'pos' : l.tone === 'neg' ? 'neg' : l.tone === 'warn' ? 'warn' : ''}`}>{fmtUsd(l.usd)}</span>
              </div>
            ))}
          </div>
          {/* Lane hit-strips: the labels live in two separate grid columns, so
              one transparent overlay is what makes a whole lane clickable. */}
          <div className="wlp-river-hits">
            {lanes.map((l, i) => (
              <button
                key={i}
                type="button"
                className="wlp-river-hit"
                style={{ height: LANE_H }}
                onClick={() => go(l)}
                aria-label={`${l.from} → ${l.to} · ${fmtUsd(l.usd)}${l.go ? ` · ${goHint(l.go, t)}` : ''}`}
              >
                <span className="wlp-river-hint">{goHint(l.go, t)} →</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default FlowRiverTab
