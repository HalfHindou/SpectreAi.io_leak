// Floating-text audit: leaf text elements (values/labels) whose ancestor chain
// provides < 0.3 effective dark coverage AND no text-shadow -> flagged.
const puppeteer = require('puppeteer')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5190'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PAGES = ['/', '/research-zone/bitcoin', '/traders-corner', '/watchlists', '/heatmaps', '/fear-greed',
  '/news', '/intelligence', '/economic-calendar', '/ventures', '/private-markets', '/tokenized-assets',
  '/predictions', '/x-dash', '/wallets', '/etfs', '/liquidation-heatmap', '/alerts', '/alt-rotation',
  '/potential-gainers', '/user-dashboard', '/categories', '/bubbles', '/monarch-chat']
;(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  for (const url of PAGES) {
    const p = await b.newPage()
    await p.setViewport({ width: 1600, height: 1000 })
    await p.evaluateOnNewDocument(() => {
      const raw = localStorage.getItem('spectre-settings')
      const data = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      data.state = { ...data.state, proThemeLook: 'glass', proThemeBg: { mode: 'scene', scene: 'c-nebula' }, dayMode: false }
      localStorage.setItem('spectre-settings', JSON.stringify(data))
    })
    try {
      await p.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await p.waitForSelector('.app', { timeout: 30000 })
      await wait(7000)
      await p.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
        btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
      })
      await wait(400)
      const hits = await p.evaluate(() => {
        const parse = (s) => [...s.matchAll(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g)].map((m) => ({ a: m[4] === undefined ? 1 : parseFloat(m[4]) }))
        const alphaOf = (cs) => Math.max(0, ...parse(cs.backgroundColor).map((x) => x.a), ...parse(cs.backgroundImage).map((x) => x.a), cs.backgroundImage.includes('url(') ? 1 : 0)
        const groups = new Map()
        for (const el of document.querySelectorAll('body *')) {
          if (el.children.length > 0) continue
          const txt = (el.textContent || '').trim()
          if (txt.length < 4 || txt.length > 80) continue
          const r = el.getBoundingClientRect()
          if (r.width < 30 || r.height < 10 || r.bottom < 60 || r.top > 980 || r.left < 230) continue
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.opacity === '0') continue
          const z = parseInt(cs.zIndex, 10)
          if (!Number.isNaN(z) && z > 90) continue
          if (cs.textShadow && cs.textShadow !== 'none') continue
          let a = alphaOf(cs); let frost = false
          let node = el.parentElement
          for (let i = 0; i < 6 && node && node !== document.body; i++) {
            const pcs = getComputedStyle(node)
            a = Math.max(a, alphaOf(pcs))
            frost = frost || (pcs.backdropFilter || 'none') !== 'none'
            if ((pcs.textShadow || 'none') !== 'none') { a = 1 }
            node = node.parentElement
          }
          if (a >= 0.3 || frost) continue
          const key = (el.className || el.tagName).toString().split(' ')[0] || el.tagName
          const g = groups.get(key) || { cls: key, n: 0, sample: txt.slice(0, 28) }
          g.n++
          groups.set(key, g)
        }
        return [...groups.values()].filter((g) => g.n >= 2).sort((x, y) => y.n - x.n).slice(0, 10)
      })
      console.log(hits.length ? JSON.stringify({ url, hits }) : `TEXT-OK ${url}`)
    } catch (e) { console.log(JSON.stringify({ url, error: e.message.slice(0, 60) })) }
    await p.close()
  }
  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
