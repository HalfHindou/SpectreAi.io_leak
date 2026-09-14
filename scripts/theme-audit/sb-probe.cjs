/* Headed scrollbar probe — BOTH engines. Headless forces overlay scrollbars
   and headless Firefox lies (reports scrollbar-width:none), so this must run
   headed. Measures the real gutter each scroller reserves + the resting vs
   scrolling thumb, and crops the right edge to PNG. */
const { chromium, firefox } = require('playwright')
const path = require('path')
const OUT = __dirname
const URL = process.env.SPECTRE_URL || 'http://localhost:5180/'

const MEASURE = () => {
  const rows = []
  const seen = new Set()
  const walk = (el) => {
    const cs = getComputedStyle(el)
    const oy = cs.overflowY
    const scrolls = (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2
    const gutter = el.offsetWidth - el.clientWidth
    if ((scrolls || gutter > 0) && !seen.has(el)) {
      seen.add(el)
      rows.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.toString().slice(0, 60)) || '',
        gutterPx: gutter,
        scrollable: scrolls,
        scrollbarWidth: cs.scrollbarWidth,
        scrollbarColor: cs.scrollbarColor,
      })
    }
    for (const c of el.children) walk(c)
  }
  const de = document.documentElement
  rows.push({
    tag: 'html(root)',
    cls: '',
    gutterPx: window.innerWidth - de.clientWidth,
    scrollable: de.scrollHeight > de.clientHeight + 2,
    scrollbarWidth: getComputedStyle(de).scrollbarWidth,
    scrollbarColor: getComputedStyle(de).scrollbarColor,
  })
  walk(document.body)
  return {
    supportsWebkitScrollbar: CSS.supports('selector(::-webkit-scrollbar)'),
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    rows: rows.filter((r) => r.gutterPx > 0 || r.scrollable).slice(0, 14),
  }
}

async function run(engine, name) {
  const browser = await engine.launch({ headless: false })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  // global tour overlay eats clicks on first visit
  await page.evaluate(() => {
    document.querySelectorAll('.gtour__backdrop, .gtour').forEach((n) => n.remove())
    try { localStorage.setItem('spectre-gtour-done', '1') } catch (e) {}
  })
  await page.waitForTimeout(500)

  const rest = await page.evaluate(MEASURE)
  await page.screenshot({ path: path.join(OUT, `${name}-rest.png`), clip: { x: 1440 - 60, y: 120, width: 60, height: 620 } })

  // scroll, then capture WHILE data-scrolling is still stamped
  await page.mouse.move(700, 500)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(120)
  const scrollingAttr = await page.evaluate(() =>
    [...document.querySelectorAll('[data-scrolling]')].map((e) => e.tagName + '.' + (e.className || '').toString().slice(0, 40))
  )
  await page.screenshot({ path: path.join(OUT, `${name}-scrolling.png`), clip: { x: 1440 - 60, y: 120, width: 60, height: 620 } })

  await page.waitForTimeout(1400) // past HIDE_MS=900
  await page.screenshot({ path: path.join(OUT, `${name}-after.png`), clip: { x: 1440 - 60, y: 120, width: 60, height: 620 } })
  const after = await page.evaluate(() => [...document.querySelectorAll('[data-scrolling]')].length)

  console.log('\n================ ' + name.toUpperCase() + ' ================')
  console.log('supports ::-webkit-scrollbar :', rest.supportsWebkitScrollbar, ' dpr', rest.devicePixelRatio)
  console.log('scrollers with a reserved gutter or scrollable:')
  for (const r of rest.rows) {
    console.log(`  ${String(r.gutterPx).padStart(3)}px  scroll=${r.scrollable ? 'Y' : 'n'}  sw=${r.scrollbarWidth}  sc=${r.scrollbarColor}  <${r.tag}.${r.cls}>`)
  }
  console.log('data-scrolling stamped during scroll:', scrollingAttr)
  console.log('data-scrolling elements 1.4s after stop:', after)
  await browser.close()
}

;(async () => {
  await run(chromium, 'chrome')
  await run(firefox, 'firefox')
})().catch((e) => { console.error(e); process.exit(1) })
