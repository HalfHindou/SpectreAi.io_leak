// Decide once after a small drag threshold. Browsing history should not move
// the price axis because of incidental hand drift; deliberate vertical and
// diagonal drags still move freely in both dimensions.
export function resolveChartPanMode(mode, deltaX, deltaY) {
  if (mode) return mode
  const x = Math.abs(deltaX)
  const y = Math.abs(deltaY)
  if (Math.max(x, y) < 6) return null
  return x >= y * 3 ? 'horizontal' : 'free'
}
