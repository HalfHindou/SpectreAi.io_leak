// Inverse scanner: card-like containers whose effective background is near-zero
// (they float on the photo). Walks 3 ancestors accumulating best alpha.
const { puppeteer, wait, BASE } = require('./audit-lib.cjs')
const PAGES = ['/', '/traders-corner', '/research-zone/bitcoin', '/watchlists', '/heatmaps', '/fear-greed',
  '/categories', '/news', '/intelligence', '/economic-calendar', '/ventures', '/private-markets',
  '/tokenized-assets', '/predictions', '/zigchain', '/ai-charts', '/roi-calculator', '/x-dash',
  '/wallets', '/etfs', '/liquidation-heatmap', '/alerts', '/alt-rotation', '/dossier',
  '/potential-gainers', '/user-dashboard', '/insights', '/why', '/x-intel', '/x-intelligence',
  '/ai-media-center', '/predictions', '/bubbles']
;(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  for (const url of [...new Set(PAGES)]) {
    const p = await b.newPage()
    await p.setViewport({ width: 1600, height: 1000 })
    await p.evaluateOnNewDocument(() => {
      const raw = localStorage.getItem('spectre-settings')
      const data = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      data.state = { ...data.state, proThemeLook: 'glass', proThemeBg: { mode: 'scene', scene: 'peaks' }, dayMode: false }
      localStorage.setItem('spectre-settings', JSON.stringify(data))
    })
    try {
      await p.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await p.waitForSelector('.app', { timeout: 30000 })
      await wait(7500)
      await p.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
        btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
      })
      await wait(400)
      const hits = await p.evaluate(() => {
        const alphaOf = (cs) => {
          let a = 0
          const m = cs.backgroundColor.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/)
          if (m) a = Math.max(a, m[4] === undefined ? 1 : parseFloat(m[4]))
          for (const g of cs.backgroundImage.matchAll(/rgba?\(\d+, \d+, \d+(?:, ([\d.]+))?\)/g)) {
            a = Math.max(a, g[1] === undefined ? 1 : parseFloat(g[1]))
          }
          return a
        }
        const out = new Map()
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width < 280 || r.height < 100 || r.bottom < 0 || r.top > 1050) continue
          const cls = (typeof el.className === 'string' ? el.className : '')
          const first = cls.split(' ')[0]
          if (!first || first.startsWith('pts-') || first.startsWith('pro-theme')) continue
          const cardish = /card|panel|rail|widget|strip|hero|box|tile/.test(cls)
          const cs = getComputedStyle(el)
          const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderRadius) >= 8
          if (!cardish && !hasBorder) continue
          const txt = (el.innerText || '').trim()
          if (txt.length < 60) continue
          let a = alphaOf(cs)
          let frost = (cs.backdropFilter || '') !== 'none' && (cs.backdropFilter || '') !== ''
          let node = el.parentElement
          for (let i = 0; i < 3 && node; i++) {
            const pcs = getComputedStyle(node)
            a = Math.max(a, alphaOf(pcs))
            frost = frost || ((pcs.backdropFilter || '') !== 'none' && (pcs.backdropFilter || '') !== '')
            node = node.parentElement
          }
          if (a < 0.15 && !frost && !out.has(first)) {
            out.set(first, { cls: first, size: `${Math.round(r.width)}x${Math.round(r.height)}` })
          }
        }
        return [...out.values()].slice(0, 10)
      })
      console.log(hits.length ? JSON.stringify({ url, hits }) : `SOLID ${url}`)
    } catch (e) { console.log(JSON.stringify({ url, error: e.message.slice(0, 70) })) }
    await p.close()
  }
  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
