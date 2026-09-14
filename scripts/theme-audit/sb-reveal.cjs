/* Which elements reserve a 14px gutter in Chrome, and does the data-scrolling
   reveal ever reach them? An element with a gutter but no reveal = a permanently
   EMPTY channel. */
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(process.env.SPECTRE_URL || 'http://localhost:5180/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await page.evaluate(() => document.querySelectorAll('.gtour__backdrop,.gtour').forEach((n) => n.remove()))

  const report = await page.evaluate(async () => {
    const gutters = []
    const all = [document.documentElement, ...document.querySelectorAll('*')]
    for (const el of all) {
      const g = el === document.documentElement
        ? window.innerWidth - el.clientWidth
        : el.offsetWidth - el.clientWidth
      if (g >= 10) gutters.push(el)
    }
    const out = []
    for (const el of gutters) {
      const before = el.scrollTop
      el.scrollTop = before + 200
      // scroll events are async; give the capture listener a tick
      await new Promise((r) => setTimeout(r, 60))
      out.push({
        who: el === document.documentElement ? 'html(root)' : el.tagName.toLowerCase() + '.' + (el.className || '').toString().trim().split(/\s+/)[0],
        gutter: el === document.documentElement ? window.innerWidth - el.clientWidth : el.offsetWidth - el.clientWidth,
        canScroll: el.scrollHeight > el.clientHeight + 2,
        gotReveal: el.hasAttribute('data-scrolling'),
      })
      el.scrollTop = before
    }
    return out
  })

  console.log('\n=== CHROME: elements reserving a >=10px scrollbar gutter ===')
  for (const r of report) {
    const verdict = !r.canScroll ? 'gutter but NOT scrollable -> DEAD CHANNEL, always empty'
      : r.gotReveal ? 'reveals a pill while scrolling (ok)'
      : 'scrollable but NEVER revealed -> EMPTY CHANNEL'
    console.log(`  ${String(r.gutter).padStart(3)}px  ${r.who.padEnd(34)} ${verdict}`)
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
