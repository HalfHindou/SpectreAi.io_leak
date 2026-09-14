// Scroll-perf audit: backdrop-filter census + real rAF frame timing during scroll,
// measured with the theme OFF vs GLASS on the same page.
const puppeteer = require('puppeteer')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5190'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(browser, url, look) {
  const p = await browser.newPage()
  await p.setViewport({ width: 1600, height: 1000 })
  await p.evaluateOnNewDocument((lk) => {
    const raw = localStorage.getItem('spectre-settings')
    const data = raw ? JSON.parse(raw) : { state: {}, version: 0 }
    data.state = { ...data.state, proThemeLook: lk, dayMode: false }
    if (lk === 'glass') data.state.proThemeBg = { mode: 'scene', scene: 'c-nebula' }
    localStorage.setItem('spectre-settings', JSON.stringify(data))
  }, look)
  await p.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await p.waitForSelector('.app', { timeout: 30000 })
  await wait(9000)
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
    btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
  })
  await wait(1200)

  const census = await p.evaluate(() => {
    let n = 0, area = 0, big = []
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none'
      if (bf === 'none' || bf === '') continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      n++
      const a = r.width * r.height
      area += a
      big.push({ cls: (el.className || el.tagName).toString().split(' ')[0], px: Math.round(a / 1000), bf: bf.slice(0, 22) })
    }
    big.sort((x, y) => y.px - x.px)
    return { count: n, megapixels: +(area / 1e6).toFixed(2), top: big.slice(0, 8), hidden: document.hidden }
  })

  // real frame timing during a scripted scroll of the main scroller
  const frames = await p.evaluate(async () => {
    const scroller = document.querySelector('.welcome-page') || document.querySelector('.page-layout') || document.scrollingElement
    const times = []
    let last = performance.now()
    let stop = false
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const startY = scroller.scrollTop || 0
    for (let i = 0; i < 60; i++) {
      scroller.scrollTop = startY + i * 22
      await new Promise((r) => setTimeout(r, 16))
    }
    stop = true
    await new Promise((r) => setTimeout(r, 100))
    const d = times.slice(3)
    if (!d.length) return null
    const sorted = [...d].sort((a, b) => a - b)
    const med = sorted[Math.floor(sorted.length / 2)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    return {
      frames: d.length,
      medianMs: +med.toFixed(1),
      p95Ms: +p95.toFixed(1),
      worstMs: +sorted[sorted.length - 1].toFixed(1),
      over32ms: d.filter((x) => x > 32).length,
      fps: +(1000 / med).toFixed(0),
    }
  })
  await p.close()
  return { url, look, census, frames }
}

;(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-gpu'] })
  for (const url of ['/', '/traders-corner']) {
    for (const look of ['off', 'glass']) {
      const r = await run(b, url, look)
      console.log(JSON.stringify(r))
    }
  }
  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
