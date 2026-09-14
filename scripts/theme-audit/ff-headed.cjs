const { firefox } = require('playwright')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5190'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await firefox.launch({ headless: false })
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } })
  const p = await ctx.newPage()
  await p.goto('' + BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await p.waitForSelector('.app', { timeout: 40000 })
  await wait(10000)
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
    btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
  })
  await wait(1000)
  const geo = await p.evaluate(() => {
    const out = { scrollers: [] }
    for (const el of [document.documentElement, ...document.querySelectorAll('body *')]) {
      const cs = getComputedStyle(el)
      const scrolls = el.scrollHeight > el.clientHeight + 2 && (/auto|scroll/.test(cs.overflowY) || el === document.documentElement)
      if (!scrolls) continue
      out.scrollers.push({
        cls: (el.className || el.tagName).toString().split(' ')[0] || el.tagName,
        barPx: el.offsetWidth - el.clientWidth,
        color: cs.scrollbarColor, width: cs.scrollbarWidth,
      })
    }
    return out
  })
  console.log('HEADED FIREFOX:', JSON.stringify(geo, null, 1))
  await p.screenshot({ path: './ff-headed-rest.png' })
  // scroll a little, capture the "while scrolling" state too
  await p.evaluate(() => { const s = document.querySelector('.page-layout'); if (s) s.scrollTop = 600 })
  await wait(200)
  await p.screenshot({ path: './ff-headed-scrolling.png' })
  await wait(1500)
  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
