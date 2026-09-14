/**
 * share-cards.js - Extracted canvas-drawing logic for share-to-X cards.
 *
 * Pure async functions - no React hooks or state.
 * Each returns { imageUrl, description }.
 */
import { renderShareCard, roundRect, getSpectreLogo, FONT, FONT_MONO, CARD_PAD } from '@/lib/shareToX'

/* ────────────────────────────────────────────
   AI Brief share card
   ──────────────────────────────────────────── */

/**
 * @param {Object} params
 * @param {string} params.briefDisplay   - The brief statement text currently visible
 * @param {number} params.briefIndex     - Which brief section (0-5) is active
 * @param {Object} params.fearGreed      - { value, classification }
 * @param {Object|null} params.liveVix   - { price, label } or null
 * @param {boolean} params.isStocks      - Whether in stocks mode
 * @param {Object} params.topCoinPrices  - { BTC: { price, change }, ETH: …, SOL: … }
 * @param {Object} params.stockPrices    - { SPY: { price, change }, … }
 * @param {Object} params.macroAnalysisData - { bias, tfLabel, … }
 * @returns {Promise<{ imageUrl: string, description: string }>}
 */
export async function generateBriefShareCard({
  briefDisplay,
  briefIndex,
  fearGreed,
  liveVix,
  isStocks,
  topCoinPrices,
  stockPrices,
  macroAnalysisData,
}) {
  const sectionLabels = ['Sentiment', 'Session', 'Narrative', 'Psychology', 'Macro', 'AI Outlook']
  const section = sectionLabels[briefIndex] || 'Brief'
  const fng = fearGreed?.value
  const fngLabel = fearGreed?.classification || 'Neutral'

  const description = `🧠 Spectre AI Brief - ${section}\n\n"${(briefDisplay || '').slice(0, 200)}${(briefDisplay || '').length > 200 ? '\u2026' : ''}"\n\n${isStocks ? `VIX: ${liveVix?.price?.toFixed(1) || '\-'}` : `Fear & Greed: ${fng ?? '\-'} (${fngLabel})`}\n\n@Spectre__Ai #crypto #market`

  // Sentiment color for glow - derived from the majors actually shown on the card
  // so the mood wall agrees with the +/-% chips (F&G alone lags price action).
  const sentSymbols = isStocks ? ['SPY', 'QQQ', 'AAPL'] : ['BTC', 'ETH', 'SOL']
  const sentSource = isStocks ? stockPrices : topCoinPrices
  const sentChanges = sentSymbols
    .map(s => parseFloat(sentSource?.[s]?.change))
    .filter(n => Number.isFinite(n))
  const sentAvg = sentChanges.length
    ? sentChanges.reduce((a, b) => a + b, 0) / sentChanges.length
    : 0
  const sentRgb = sentAvg >= 0.25
    ? '48, 209, 88'
    : sentAvg <= -0.25
      ? '255, 69, 58'
      : '142, 142, 147'

  const spectreLogo = await getSpectreLogo()

  const imageUrl = renderShareCard(
    (ctx, w, contentTop, c, fonts) => {
      const pad = CARD_PAD
      let y = contentTop

      // Sentiment-colored ambient glow behind content area
      const sentGlow = ctx.createRadialGradient(w / 2, y + 60, 0, w / 2, y + 60, w * 0.55)
      sentGlow.addColorStop(0, `rgba(${sentRgb}, ${c.isLight ? 0.06 : 0.10})`)
      sentGlow.addColorStop(1, 'transparent')
      ctx.fillStyle = sentGlow
      ctx.fillRect(0, contentTop - 10, w, 300)

      // Decorative opening quote
      ctx.textAlign = 'center'
      ctx.font = `300 48px Georgia, "Times New Roman", serif`
      ctx.fillStyle = c.isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
      ctx.fillText('\u201C', w / 2, y + 16)
      y += 24

      // Section label (eyebrow) - clean, no dot
      ctx.font = `500 9px ${fonts.body}`
      ctx.letterSpacing = '2px'
      ctx.fillStyle = c.muted
      ctx.textAlign = 'center'
      ctx.fillText(`AI BRIEF \- ${section.toUpperCase()}`, w / 2, y + 7)
      y += 24

      // Brief text - elegant serif italic, centered, wrapped
      ctx.font = `italic 300 16px "Playfair Display", Georgia, "Times New Roman", serif`
      ctx.fillStyle = c.isLight ? 'rgba(0,0,0,0.82)' : 'rgba(245,245,247,0.88)'
      ctx.textAlign = 'center'
      const words = (briefDisplay || '').split(' ')
      const lines = []
      let line = ''
      const maxLineW = w - pad * 2 - 24
      for (const word of words) {
        const test = line ? `${line} ${word}` : word
        if (ctx.measureText(test).width > maxLineW) {
          lines.push(line)
          line = word
        } else {
          line = test
        }
      }
      if (line) lines.push(line)
      const lineH = 24
      const maxLines = Math.min(lines.length, 12)
      lines.slice(0, maxLines).forEach((l, i) => {
        ctx.fillText(l, w / 2, y + i * lineH)
      })
      y += maxLines * lineH + 8

      // Decorative closing quote
      ctx.font = `300 48px Georgia, "Times New Roman", serif`
      ctx.fillStyle = c.isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
      ctx.fillText('\u201D', w / 2, y + 10)
      y += 20

      // Subtle divider with sentiment color tint
      const divGrad = ctx.createLinearGradient(0, 0, w, 0)
      divGrad.addColorStop(0, 'transparent')
      divGrad.addColorStop(0.3, `rgba(${sentRgb}, ${c.isLight ? 0.08 : 0.12})`)
      divGrad.addColorStop(0.5, `rgba(${sentRgb}, ${c.isLight ? 0.15 : 0.20})`)
      divGrad.addColorStop(0.7, `rgba(${sentRgb}, ${c.isLight ? 0.08 : 0.12})`)
      divGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = divGrad
      ctx.fillRect(pad, y, w - pad * 2, 1)
      y += 18

      // Sentiment chips - glass cards
      const chips = isStocks
        ? [
            { label: 'VIX', value: liveVix?.price?.toFixed(1) || '—', sub: liveVix?.label || '' },
            { label: 'BIAS', value: (macroAnalysisData?.bias || 'neutral').toUpperCase(), sub: macroAnalysisData?.tfLabel || '24h' },
          ]
        : [
            { label: 'F&G', value: String(fng ?? '\-'), sub: fngLabel },
            { label: 'BIAS', value: (macroAnalysisData?.bias || 'neutral').toUpperCase(), sub: macroAnalysisData?.tfLabel || '24h' },
          ]
      const symbols = isStocks ? ['SPY', 'QQQ', 'AAPL'] : ['BTC', 'ETH', 'SOL']
      symbols.forEach((sym) => {
        const d = isStocks ? stockPrices?.[sym] : topCoinPrices?.[sym]
        if (d?.price) {
          const ch = parseFloat(d.change) || 0
          chips.push({ label: sym, value: `$${typeof d.price === 'number' ? d.price.toLocaleString(undefined, { maximumFractionDigits: d.price < 10 ? 2 : 0 }) : d.price}`, sub: `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%` })
        }
      })

      const chipW = Math.min(108, (w - pad * 2 - (chips.length - 1) * 6) / chips.length)
      const chipH = 54
      const totalW = chips.length * chipW + (chips.length - 1) * 6
      let cx = (w - totalW) / 2

      chips.forEach((chip) => {
        // Glass card background
        const cardGrad = ctx.createLinearGradient(cx, y, cx + chipW, y + chipH)
        cardGrad.addColorStop(0, c.isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.035)')
        cardGrad.addColorStop(1, c.isLight ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.015)')
        roundRect(ctx, cx, y, chipW, chipH, 10)
        ctx.fillStyle = cardGrad
        ctx.fill()
        // Glass shimmer top edge
        const shimmer = ctx.createLinearGradient(cx, y, cx + chipW, y)
        shimmer.addColorStop(0, 'transparent')
        shimmer.addColorStop(0.5, c.isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)')
        shimmer.addColorStop(1, 'transparent')
        ctx.fillStyle = shimmer
        ctx.fillRect(cx, y, chipW, 1)
        // Border
        ctx.strokeStyle = c.cardBorder
        ctx.lineWidth = 0.5
        roundRect(ctx, cx + 0.5, y + 0.5, chipW - 1, chipH - 1, 10)
        ctx.stroke()

        ctx.textAlign = 'center'
        ctx.font = `600 8px ${fonts.body}`
        ctx.fillStyle = c.thColor
        ctx.fillText(chip.label, cx + chipW / 2, y + 15)

        ctx.font = `700 14px ${fonts.body}`
        ctx.fillStyle = c.symbol
        ctx.fillText(chip.value, cx + chipW / 2, y + 33)

        if (chip.sub) {
          ctx.font = `500 9.5px ${fonts.mono}`
          const isPos = chip.sub.startsWith('+')
          const isNeg = chip.sub.startsWith('-')
          ctx.fillStyle = isPos ? c.bull : isNeg ? c.bear : c.muted
          ctx.fillText(chip.sub, cx + chipW / 2, y + 47)
        }

        cx += chipW + 6
      })

      return (y - contentTop) + chipH + 16
    },
    {
      title: 'AI Research Brief',
      badges: [
        { text: section, filled: true },
      ],
      logo: spectreLogo,
    },
  )

  return { imageUrl, description }
}


/* ────────────────────────────────────────────
   Market Overview (Welcome) share card
   ──────────────────────────────────────────── */

/**
 * @param {Object} params
 * @param {Object} params.topCoinPrices   - { BTC: { price, change }, ETH: …, SOL: … }
 * @param {Object} params.fearGreed       - { value, classification }
 * @param {Object} params.marketDominance - { btc, eth, sol, alts }
 * @param {boolean} params.isStocks       - Whether in stocks mode
 * @param {Object} params.profile         - { name, imageUrl }
 * @param {Function} params.fmtPrice      - Price formatting function
 * @param {Object} params.stockPrices     - { SPY: …, … } (for stocks greeting)
 * @returns {Promise<{ imageUrl: string, description: string }>}
 */
export async function generateWelcomeShareCard({
  topCoinPrices,
  fearGreed,
  marketDominance,
  isStocks,
  profile,
  fmtPrice,
  stockPrices,
}) {
  const btc = topCoinPrices?.BTC || {}
  const eth = topCoinPrices?.ETH || {}
  const sol = topCoinPrices?.SOL || {}
  const fgVal = typeof fearGreed === 'object' ? fearGreed?.value : fearGreed
  const fgLabel = fgVal >= 75 ? 'Extreme Greed' : fgVal >= 55 ? 'Greed' : fgVal >= 45 ? 'Neutral' : fgVal >= 25 ? 'Fear' : 'Extreme Fear'
  const userName = (profile?.name || '').trim() || 'Anon'

  const description = `📊 Market Overview\n\nBTC: ${fmtPrice(btc.price)} ${btc.change >= 0 ? '📈' : '📉'} ${(btc.change || 0).toFixed(1)}%\nETH: ${fmtPrice(eth.price)} ${(eth.change || 0).toFixed(1)}%\nSOL: ${fmtPrice(sol.price)} ${(sol.change || 0).toFixed(1)}%\n\nFear & Greed: ${fgVal || '-'} (${fgLabel})\n\n@Spectre__Ai #crypto`

  const spectreLogo = await getSpectreLogo()

  const imageUrl = renderShareCard(
    (ctx, w, contentTop, c, fonts) => {
      const pad = CARD_PAD
      let y = contentTop + 10

      // ── Ambient brand glow ──
      const ambGlow = ctx.createRadialGradient(w * 0.3, y + 80, 0, w * 0.3, y + 80, 280)
      ambGlow.addColorStop(0, c.isLight ? 'rgba(139, 92, 246, 0.03)' : 'rgba(139, 92, 246, 0.06)')
      ambGlow.addColorStop(1, 'transparent')
      ctx.fillStyle = ambGlow
      ctx.fillRect(0, contentTop, w, 400)

      // ── Welcome greeting ──
      ctx.textAlign = 'center'
      ctx.font = `400 11px ${fonts.body}`
      ctx.fillStyle = c.muted
      ctx.fillText(isStocks ? 'Welcome to the Markets' : 'Welcome to Crypto', w / 2, y + 4)
      y += 18

      // User name
      ctx.font = `800 28px 'Space Grotesk', ${fonts.body}`
      ctx.fillStyle = c.symbol
      ctx.fillText(userName, w / 2, y + 6)
      y += 24

      // ── Accent divider ──
      const accentGrad = ctx.createLinearGradient(pad + 60, 0, w - pad - 60, 0)
      accentGrad.addColorStop(0, 'transparent')
      accentGrad.addColorStop(0.5, c.isLight ? 'rgba(139, 92, 246, 0.25)' : 'rgba(139, 92, 246, 0.30)')
      accentGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = accentGrad
      ctx.fillRect(pad + 60, y, w - pad * 2 - 120, 1.5)
      y += 22

      // ── Top 3 coins in glass cards ──
      const coins = [
        { sym: 'BTC', data: btc, rgb: '247, 147, 26' },
        { sym: 'ETH', data: eth, rgb: '98, 126, 234' },
        { sym: 'SOL', data: sol, rgb: '0, 255, 163' },
      ]
      const cardGap = 10
      const cardW = (w - pad * 2 - cardGap * 2) / 3
      const cardH = 80

      coins.forEach((coin, ci) => {
        const cx = pad + ci * (cardW + cardGap)
        const cy = y
        const ch = coin.data?.change || 0

        // Glass card background
        ctx.save()
        roundRect(ctx, cx, cy, cardW, cardH, 12)
        ctx.clip()

        ctx.fillStyle = c.isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.03)'
        ctx.fillRect(cx, cy, cardW, cardH)

        // Token-tinted fill
        ctx.fillStyle = `rgba(${coin.rgb}, ${c.isLight ? 0.04 : 0.06})`
        ctx.fillRect(cx, cy, cardW, cardH)

        // Shimmer overlay
        const shim = ctx.createLinearGradient(cx, cy, cx + cardW, cy + cardH)
        shim.addColorStop(0, c.isLight ? 'rgba(255, 255, 255, 0.20)' : 'rgba(255, 255, 255, 0.06)')
        shim.addColorStop(0.4, 'transparent')
        shim.addColorStop(1, c.isLight ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)')
        ctx.fillStyle = shim
        ctx.fillRect(cx, cy, cardW, cardH)

        // Top highlight
        ctx.fillStyle = c.isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.08)'
        ctx.fillRect(cx, cy, cardW, 1)

        ctx.restore()

        // Border
        roundRect(ctx, cx, cy, cardW, cardH, 12)
        ctx.strokeStyle = `rgba(${coin.rgb}, ${c.isLight ? 0.10 : 0.12})`
        ctx.lineWidth = 1
        ctx.stroke()

        // Content
        ctx.textAlign = 'center'
        const ccx = cx + cardW / 2

        ctx.font = `700 13px ${fonts.body}`
        ctx.fillStyle = c.symbol
        ctx.fillText(coin.sym, ccx, cy + 22)

        ctx.font = `600 14px ${fonts.mono}`
        ctx.fillStyle = c.price
        ctx.fillText(fmtPrice(coin.data?.price), ccx, cy + 44)

        ctx.font = `600 12px ${fonts.mono}`
        ctx.fillStyle = ch >= 0 ? c.bull : c.bear
        ctx.fillText(`${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`, ccx, cy + 62)

        // Bottom glow
        const glowGrad = ctx.createLinearGradient(cx + cardW * 0.2, 0, cx + cardW * 0.8, 0)
        glowGrad.addColorStop(0, 'transparent')
        glowGrad.addColorStop(0.5, `rgba(${coin.rgb}, 0.15)`)
        glowGrad.addColorStop(1, 'transparent')
        ctx.fillStyle = glowGrad
        ctx.fillRect(cx + 4, cy + cardH - 2, cardW - 8, 1.5)
      })
      y += cardH + 20

      // ── Market indicators row ──
      const indGap = 10
      const indW = (w - pad * 2 - indGap) / 2
      const indH = 56

      // Fear & Greed card
      const fgX = pad
      ctx.save()
      roundRect(ctx, fgX, y, indW, indH, 10)
      ctx.clip()
      ctx.fillStyle = c.isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.025)'
      ctx.fillRect(fgX, y, indW, indH)
      const fgShim = ctx.createLinearGradient(fgX, y, fgX + indW, y + indH)
      fgShim.addColorStop(0, c.isLight ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)')
      fgShim.addColorStop(0.5, 'transparent')
      ctx.fillStyle = fgShim
      ctx.fillRect(fgX, y, indW, indH)
      ctx.fillStyle = c.isLight ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.06)'
      ctx.fillRect(fgX, y, indW, 1)
      ctx.restore()
      roundRect(ctx, fgX, y, indW, indH, 10)
      ctx.strokeStyle = c.isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      ctx.textAlign = 'left'
      ctx.font = `600 9px ${fonts.body}`
      ctx.fillStyle = c.thColor
      ctx.fillText('FEAR & GREED', fgX + 14, y + 18)
      ctx.font = `bold 20px ${fonts.mono}`
      const fgColor = fgVal >= 55 ? c.bull : fgVal >= 45 ? c.muted : c.bear
      ctx.fillStyle = fgColor
      ctx.fillText(fgVal != null ? String(fgVal) : '-', fgX + 14, y + 42)
      ctx.font = `400 10px ${fonts.body}`
      ctx.fillStyle = c.muted
      const fgTextW = ctx.measureText(String(fgVal || '-')).width
      ctx.fillText(fgLabel, fgX + 18 + fgTextW + 4, y + 42)

      // Alt Season / Dominance card
      const asX = pad + indW + indGap
      ctx.save()
      roundRect(ctx, asX, y, indW, indH, 10)
      ctx.clip()
      ctx.fillStyle = c.isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.025)'
      ctx.fillRect(asX, y, indW, indH)
      const asShim = ctx.createLinearGradient(asX, y, asX + indW, y + indH)
      asShim.addColorStop(0, c.isLight ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)')
      asShim.addColorStop(0.5, 'transparent')
      ctx.fillStyle = asShim
      ctx.fillRect(asX, y, indW, indH)
      ctx.fillStyle = c.isLight ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.06)'
      ctx.fillRect(asX, y, indW, 1)
      ctx.restore()
      roundRect(ctx, asX, y, indW, indH, 10)
      ctx.strokeStyle = c.isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      const btcDom = marketDominance?.btc
      ctx.textAlign = 'left'
      ctx.font = `600 9px ${fonts.body}`
      ctx.fillStyle = c.thColor
      ctx.fillText('BTC DOMINANCE', asX + 14, y + 18)
      ctx.font = `bold 20px ${fonts.mono}`
      ctx.fillStyle = c.symbol
      ctx.fillText(btcDom != null ? `${btcDom.toFixed(1)}%` : '-', asX + 14, y + 42)

      y += indH + 16
      return (y - contentTop)
    },
    {
      title: 'Market Overview',
      badges: [
        { text: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), filled: false },
        { text: 'OVERVIEW', filled: true },
      ],
      logo: spectreLogo,
    },
  )

  return { imageUrl, description }
}
