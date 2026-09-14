const puppeteer = require('puppeteer')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5190'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function run(b, look) {
  const p = await b.newPage()
  await p.setViewport({ width: 1990, height: 1030 })
  await p.evaluateOnNewDocument((lk) => {
    const raw = localStorage.getItem('spectre-settings')
    const data = raw ? JSON.parse(raw) : { state: {}, version: 0 }
    data.state = { ...data.state, proThemeLook: lk, dayMode: false }
    if (lk === 'glass') data.state.proThemeBg = { mode: 'scene', scene: 'c-nebula' }
    localStorage.setItem('spectre-settings', JSON.stringify(data))
  }, look)
  await p.goto('' + BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await p.waitForSelector('.app', { timeout: 30000 })
  await wait(9000)
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
    btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
  })
  await wait(1000)
  const res = await p.evaluate(async () => {
    const out = {}
    const measure = async (sel, steps, stepPx) => {
      const sc = document.querySelector(sel)
      if (!sc) return null
      const times = []; let last = performance.now(); let stop = false
      const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      const start = sc.scrollTop
      const partials = []
      for (let i = 0; i < steps; i++) {
        sc.scrollTop = start + i * stepPx
        await new Promise((r) => setTimeout(r, 16))
        if (i % 12 === 0) {
          const rows = [...document.querySelectorAll('.tdt-row')].map((r) => r.getBoundingClientRect())
            .filter((r) => r.bottom > 0 && r.top < innerHeight)
          const hs = [...new Set(rows.map((r) => Math.round(r.height)))]
          if (hs.length > 1) partials.push({ at: i, heights: hs })
        }
      }
      stop = true
      await new Promise((r) => setTimeout(r, 80))
      const d = times.slice(3).sort((a, b) => a - b)
      return {
        median: +d[Math.floor(d.length / 2)].toFixed(1),
        p95: +d[Math.floor(d.length * 0.95)].toFixed(1),
        worst: +d[d.length - 1].toFixed(1),
        over32: d.filter((x) => x > 32).length,
        partialRowStates: partials.length,
      }
    }
    out.page = await measure('.page-layout', 50, 18)
    out.table = await measure('.tdt', 60, 40)
    return out
  })
  await p.close()
  return { look, ...res }
}
;(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  for (const look of ['off', 'glass']) console.log(JSON.stringify(await run(b, look)))
  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
