/**
 * sr-levels-tv.js — draw detected S/R zones on a TradingView Advanced chart.
 *
 * Shared by the Research Zone hero chart (trading-chart.jsx, TV mode) and the
 * Technicals tab chart (rz-technicals-tab.jsx), so the two surfaces render
 * identical bands for identical data. Zones come from computeSRLevels
 * (@/lib/sr-levels).
 *
 * srZones shape: {
 *   local: Zone[], major: Zone[],
 *   pivot?: number|null, pivotPeriod?: string,
 *   range?: { from: number, to: number }   // unix seconds span for the bands
 * }
 */

export function drawSRZonesOnTvChart(chart, srZones, dayMode, zoneIdsRef) {
  try {
    const ids = []
    const dm = dayMode

    const colors = {
      majorR: { bg: dm ? 'rgba(239, 68, 68, 0.10)' : 'rgba(239, 68, 68, 0.07)',  border: dm ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.22)' },
      localR: { bg: dm ? 'rgba(239, 68, 68, 0.05)' : 'rgba(239, 68, 68, 0.035)', border: dm ? 'rgba(239, 68, 68, 0.18)' : 'rgba(239, 68, 68, 0.10)' },
      localS: { bg: dm ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.035)', border: dm ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.10)' },
      majorS: { bg: dm ? 'rgba(16, 185, 129, 0.10)' : 'rgba(16, 185, 129, 0.07)',  border: dm ? 'rgba(16, 185, 129, 0.35)' : 'rgba(16, 185, 129, 0.22)' },
      pivot: dm ? 'rgba(245, 158, 11, 0.50)' : 'rgba(245, 158, 11, 0.35)',
    }

    // Time span: prefer the bar range the zones were computed on (extends a
    // little into the future); fall back to the visible range.
    let tFrom, tTo
    if (srZones.range) {
      tFrom = srZones.range.from
      tTo = srZones.range.to
    } else {
      const range = chart.getVisibleRange()
      const pad = (range.to - range.from) * 3
      tFrom = range.from - pad
      tTo = range.to + pad
    }
    const rectOpts = { zOrder: 'bottom', lock: true, disableSelection: true }

    const drawBand = (z, c) => {
      const id = chart.createMultipointShape(
        [{ time: tFrom, price: z.high }, { time: tTo, price: z.low }],
        { shape: 'rectangle', ...rectOpts,
          overrides: { backgroundColor: c.bg, color: c.border, linewidth: 1, linecolor: c.border, transparency: 20 } }
      )
      if (id) ids.push(id)
    }

    // Local zones (lighter bands, this timeframe's swings)
    for (const z of (srZones.local || [])) {
      drawBand(z, z.side === 'resistance' ? colors.localR : colors.localS)
    }

    // Major zones (higher timeframe): band + labeled mid line
    for (const z of (srZones.major || [])) {
      const c = z.side === 'resistance' ? colors.majorR : colors.majorS
      drawBand(z, c)
      const id = chart.createShape({ price: z.mid },
        { shape: 'horizontal_line',
          overrides: { linecolor: c.border, linewidth: 1, linestyle: 2, showLabel: true, text: `Major ${z.side === 'resistance' ? 'R' : 'S'} ×${z.touches}` } })
      if (id) ids.push(id)
    }

    // Period pivot reference line (optional)
    if (srZones.pivot != null) {
      const id = chart.createShape({ price: srZones.pivot },
        { shape: 'horizontal_line',
          overrides: { linecolor: colors.pivot, linewidth: 1, linestyle: 0, showLabel: true, text: `Pivot (${srZones.pivotPeriod || 'daily'})` } })
      if (id) ids.push(id)
    }

    zoneIdsRef.current = ids
  } catch (e) {
    // silently handled — TV may still be loading after a resolution switch
  }
}

export function clearTvZoneEntities(chart, zoneIdsRef) {
  for (const id of zoneIdsRef.current) {
    try { chart.removeEntity(id) } catch (_) { /* TV cleanup race */ }
  }
  zoneIdsRef.current = []
}
