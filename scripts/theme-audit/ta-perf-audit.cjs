// Chart TA frame-cost probe.  `node scripts/theme-audit/ta-perf-audit.cjs`
//
// MEASURED 2026-08-23, M5 Max, 120Hz, BTC 1H / 120 bars, Chrome, 1600x1000:
//   pan, no TA (baseline)     mean 8.37ms  p95  9.9  worst 15.9   0 frames >16.7ms
//   read + reveal (4s window) mean 8.39ms  p95  9.5  worst 25.0   4 frames >16.7ms (of 951)
//   pan, TA layer live        mean 8.33ms  p95  9.6  worst 10.3   0 frames >16.7ms
// Steady-state cost of the layer is nil (delta at noise level). The reveal is
// the only expensive moment and it costs at most one visible hitch; nothing
// crossed 33.3ms anywhere. Numbers are from a fast machine — re-run on the
// slowest target before treating them as a floor.
// Measures rAF frame timing during a scripted pan of
// the candle chart, BEFORE a read (baseline) and AFTER one (rings, bands,
// pattern envelopes, measured-move areas + the gleam rAF all live).
// Two GPU-heat incidents are on file in this repo; the TA layer shipped with no
// frame measurement at all, so this is the missing number.
const fs = require('node:fs')
const puppeteer = require('puppeteer')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5182'
// Puppeteer's own Chrome download is not present on this machine; the system
// Chrome measures the same compositor. Override with SPECTRE_CHROME.
const CHROME = process.env.SPECTRE_CHROME
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p))
  || null
const wait = (ms) => new Promise(r => setTimeout(r, ms))

async function sampleFor(page, ms) {
  await page.evaluate(() => { window.__f = []; window.__stop = false
    let last = performance.now()
    const tick = (t) => { window.__f.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  await wait(ms)
  return page.evaluate(() => { window.__stop = true
    const f = window.__f.slice(3).filter(x => x > 0 && x < 400)
    f.sort((a,b)=>a-b)
    const mean = f.reduce((s,x)=>s+x,0)/(f.length||1)
    return { samples: f.length, mean:+mean.toFixed(2), p95:+(f[Math.floor(f.length*0.95)]||0).toFixed(2),
             worst:+(f[f.length-1]||0).toFixed(2), over16ms:f.filter(x=>x>16.7).length, over33ms:f.filter(x=>x>33.3).length }
  })
}

async function pan(page, box, frames = 90) {
  // Drag across the chart, sampling rAF deltas while the pan path runs.
  await page.evaluate(() => { window.__f = []; 
    let last = performance.now()
    window.__stop = false
    const tick = (t) => { window.__f.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  const cy = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.75, cy)
  await page.mouse.down()
  for (let i = 0; i < frames; i++) {
    await page.mouse.move(box.x + box.width * 0.75 - i * 3, cy)
    await wait(8)
  }
  await page.mouse.up()
  await wait(300)
  return page.evaluate(() => { window.__stop = true
    const f = window.__f.slice(3).filter(x => x > 0 && x < 400)
    f.sort((a,b) => a-b)
    const mean = f.reduce((s,x)=>s+x,0)/(f.length||1)
    return {
      samples: f.length,
      mean: +mean.toFixed(2),
      p50: +(f[Math.floor(f.length*0.5)]||0).toFixed(2),
      p95: +(f[Math.floor(f.length*0.95)]||0).toFixed(2),
      worst: +(f[f.length-1]||0).toFixed(2),
      over16ms: f.filter(x=>x>16.7).length,
      over33ms: f.filter(x=>x>33.3).length,
    }
  })
}

;(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--window-size=1700,1050'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  await page.goto(`${BASE}/research-zone/bitcoin`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await wait(12000)
  // dismiss any tour
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /maybe later|skip/i.test(x.textContent||''))
    b?.click(); document.querySelector('.gtour__backdrop')?.remove()
  })
  await wait(800)
  const candles = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /^Candles$/.test((b.textContent||'').trim())))
  await candles.asElement()?.click()
  await wait(6000)

  const canvas = await page.$('canvas.chart-canvas')
  if (!canvas) { console.log('NO CHART CANVAS'); await browser.close(); return }
  const box = await canvas.boundingBox()

  const before = await pan(page, box)
  console.log('BASELINE (no TA drawings):', JSON.stringify(before))

  // The REVEAL is the animation-heavy moment: pattern compute, then rings
  // scaling in, envelopes, measured-move areas and the one-shot gleam rAF.
  // Sampling starts before the click so the whole window is covered.
  const revealPromise = sampleFor(page, 4000)
  await page.click('[data-tooltip="Read the whole visible chart and open the agent"]')
  const reveal = await revealPromise
  console.log('READ + REVEAL       :', JSON.stringify(reveal))
  await wait(5000)
  const drawn = await page.evaluate(() => !!document.querySelector('.rzta-strip'))
  console.log('read produced a strip:', drawn)

  const after = await pan(page, box)
  console.log('WITH TA LAYER       :', JSON.stringify(after))

  const d = (k) => +(after[k] - before[k]).toFixed(2)
  console.log(`\nDELTA  mean ${d('mean')}ms | p50 ${d('p50')}ms | p95 ${d('p95')}ms | worst ${d('worst')}ms`)
  console.log(`dropped frames >16.7ms: ${before.over16ms} -> ${after.over16ms}   >33.3ms: ${before.over33ms} -> ${after.over33ms}`)
  await browser.close()
})()
