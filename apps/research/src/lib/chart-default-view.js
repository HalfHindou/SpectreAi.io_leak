// Range presets keep their history buffer, but open/reset to the labelled span.
export function getDefaultChartZoom(bars, timeframe, lineOnly = false, now = Date.now()) {
  if (!bars?.length || lineOnly || ['YTD', 'ALL'].includes(timeframe)) return 1
  const hours = { '1D': 24, '1W': 168, '1MO': 720 }[timeframe]
  let inWindow = 0
  if (hours) {
    const cutoff = now - hours * 3600_000
    for (let i = bars.length - 1; i >= 0; i--) {
      if (new Date(bars[i].date).getTime() < cutoff) break
      inWindow++
    }
  }
  const target = inWindow >= 2 ? Math.max(inWindow, 12)
    : ({ '1D': 288, '1W': 168, '1MO': 180, '1Y': 365 }[timeframe] || 120)
  return bars.length > target ? bars.length / target : 1
}

export function hasCustomChartView(zoom, defaultZoom, panOffset) {
  return Math.abs(zoom - defaultZoom) > Math.max(0.001, defaultZoom * 0.01) || Math.abs(panOffset) > 0.5
}
