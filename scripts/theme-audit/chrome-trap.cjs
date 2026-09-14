const { chromium } = require('playwright')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5190'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch({ headless: false })
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } })
  const p = await ctx.newPage()
  await p.goto('' + BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await p.waitForSelector('.app', { timeout: 40000 })
  await wait(9000)
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
    btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
  })
  await wait(800)
  const r = await p.evaluate(() => {
    const poisoned = []   // elements where standard props kill webkit styling
    const clean = []
    for (const el of [document.documentElement, ...document.querySelectorAll('body *')]) {
      const cs = getComputedStyle(el)
      const scrolls = el.scrollHeight > el.clientHeight + 2 && (/auto|scroll/.test(cs.overflowY) || el === document.documentElement)
      if (!scrolls) continue
      const cls = (el.className || el.tagName).toString().split(' ')[0] || el.tagName
      const rec = { cls, color: cs.scrollbarColor, width: cs.scrollbarWidth }
      // Chrome 121+: ANY non-auto standard value disables ::-webkit-scrollbar
      if (cs.scrollbarColor !== 'auto' || (cs.scrollbarWidth && cs.scrollbarWidth !== 'auto')) poisoned.push(rec)
      else clean.push(rec)
    }
    return { engine: 'chromium', poisoned, clean }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
