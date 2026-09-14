/* Control test: does styling ::-webkit-scrollbar itself create the permanent
   gutter in Chrome on macOS? Same headed browser, one page, three states. */
const { chromium } = require('playwright')

const PAGE = `<!doctype html><style>
  html,body{margin:0;background:#09090b}
  #tall{height:4000px}
</style><div id="tall"></div>`

;(async () => {
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.setContent(PAGE)
  await page.waitForTimeout(300)

  const gutter = () => page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)

  const bare = await gutter()

  // 1) ONLY the width rule (what index.css sets)
  await page.addStyleTag({ content: `::-webkit-scrollbar{width:14px !important;height:14px !important;background:transparent !important}` })
  await page.waitForTimeout(300)
  const withWidth = await gutter()

  // 2) same, but a *visible* resting thumb (the proposed fix)
  await page.addStyleTag({ content: `::-webkit-scrollbar-thumb{background-color:rgba(245,245,247,.18) !important;border:3px solid transparent !important;background-clip:padding-box !important;border-radius:9999px !important}` })
  await page.waitForTimeout(300)
  const withThumb = await gutter()

  console.log('\n=== CHROME macOS — who creates the gutter? ===')
  console.log('unstyled (native overlay)      gutter =', bare, 'px')
  console.log('after ::-webkit-scrollbar rule gutter =', withWidth, 'px')
  console.log('after adding a resting thumb   gutter =', withThumb, 'px')
  console.log(bare === 0 && withWidth > 0
    ? '\n=> CONFIRMED: styling ::-webkit-scrollbar opts the scroller OUT of macOS\n   overlay scrollbars into a classic one that PERMANENTLY reserves layout space.'
    : '\n=> NOT confirmed — gutter did not change with the rule.')

  await page.screenshot({ path: __dirname + '/control-thumb.png', clip: { x: 800 - 40, y: 0, width: 40, height: 300 } })
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
