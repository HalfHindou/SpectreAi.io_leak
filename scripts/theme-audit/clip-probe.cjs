const puppeteer = require('puppeteer')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5190'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  for (const url of ['/', '/traders-corner', '/wallets']) {
    const p = await b.newPage()
    await p.setViewport({ width: 1990, height: 1030 })
    await p.evaluateOnNewDocument(() => {
      const raw = localStorage.getItem('spectre-settings')
      const data = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      data.state = { ...data.state, proThemeLook: 'glass', proThemeBg: { mode: 'scene', scene: 'c-nebula' }, dayMode: false }
      localStorage.setItem('spectre-settings', JSON.stringify(data))
    })
    await p.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await p.waitForSelector('.app', { timeout: 30000 })
    await wait(8500)
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
      btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
    })
    await wait(600)
    const r = await p.evaluate(() => {
      const tdt = document.querySelector('.tdt')
      const row = document.querySelector('.tdt-row')
      const shadowed = [...document.querySelectorAll('body *')].filter((e) => {
        const cs = getComputedStyle(e)
        return cs.textShadow && cs.textShadow !== 'none' && (e.textContent || '').trim().length > 0 && e.children.length === 0
      }).length
      return {
        mono: document.querySelectorAll('.mono').length,
        caption: document.querySelectorAll('.caption').length,
        shadowedTextNodes: shadowed,
        tdtH: tdt ? Math.round(tdt.clientHeight) : null,
        rowH: row ? +row.getBoundingClientRect().height.toFixed(1) : null,
        rowsFit: tdt && row ? +(tdt.clientHeight / row.getBoundingClientRect().height).toFixed(2) : null,
      }
    })
    console.log(url, JSON.stringify(r))
    await p.close()
  }
  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
