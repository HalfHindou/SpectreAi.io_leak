const { firefox, chromium } = require('playwright')
const HTML = `<!doctype html><html><head><style>
  #probe { scrollbar-color: rgb(1,2,3) transparent; }
  @supports not selector(::-webkit-scrollbar) { #probe { scrollbar-color: rgb(9,9,9) transparent; } }
  @supports (-moz-appearance: none) { #probe { outline-color: rgb(7,7,7); } }
</style></head><body><div id="probe">x</div></body></html>`
;(async () => {
  for (const [name, engine] of [['firefox', firefox], ['chromium', chromium]]) {
    const b = await engine.launch({ headless: true })
    const p = await b.newPage()
    await p.setContent(HTML)
    const r = await p.evaluate(() => ({
      supportsWebkitScrollbarSelector: CSS.supports('selector(::-webkit-scrollbar)'),
      supportsMozAppearance: CSS.supports('-moz-appearance', 'none'),
      supportsScrollbarColor: CSS.supports('scrollbar-color', 'red blue'),
      // did the @supports-not block win?
      probeColor: getComputedStyle(document.getElementById('probe')).scrollbarColor,
      mozBlockApplied: getComputedStyle(document.getElementById('probe')).outlineColor,
    }))
    console.log(name.padEnd(9), JSON.stringify(r))
    await b.close()
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
