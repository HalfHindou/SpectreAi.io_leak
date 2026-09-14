// Renders one chart per theme to /tmp for visual inspection:
//   node scripts/render-test.js [SYMBOL] [tf]
const api = require('../src/spectre-api')
const { renderChart } = require('../src/chart')
const { THEMES } = require('../src/themes')
const { TIMEFRAMES } = require('../src/config')
const fs = require('fs')

async function main() {
  const symbol = (process.argv[2] || 'BTC').toUpperCase()
  const tf = process.argv[3] || '15m'
  const cfg = TIMEFRAMES[tf]
  console.time('fetch')
  const candles = await api.ohlcv(symbol, cfg.interval)
  console.timeEnd('fetch')
  if (!candles?.length) throw new Error(`no candles for ${symbol} ${tf}`)
  const sliced = candles.slice(-cfg.maxBars)
  console.log(`${sliced.length} bars, last close ${sliced[sliced.length - 1].close}`)
  for (const name of Object.keys(THEMES)) {
    console.time(`render ${name}`)
    const png = renderChart({ symbol, tfLabel: cfg.label, candles: sliced, themeName: name })
    console.timeEnd(`render ${name}`)
    const out = `/tmp/spectre-chart-${name}.png`
    fs.writeFileSync(out, png)
    console.log('wrote', out, `${(png.length / 1024).toFixed(0)}KB`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
