// Shared audit helpers: slab scan + tour dismissal + per-page runner
const puppeteer = require('puppeteer')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5190'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const SCAN_FN = () => {
  const out = []
  const parseStops = (s) => [...s.matchAll(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g)]
    .map((m) => ({ lum: (+m[1] + +m[2] + +m[3]) / 3, a: m[4] === undefined ? 1 : parseFloat(m[4]) }))
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName === 'CANVAS' || el.tagName === 'IFRAME') continue
    const r = el.getBoundingClientRect()
    const isBigPanel = r.width >= 280 && r.height >= 90
    const isStrip = r.width >= 550 && r.height >= 38
    if (!isBigPanel && !isStrip) continue
    if (r.bottom < 0 || r.top > 1050) continue
    const cs = getComputedStyle(el)
    const z = parseInt(cs.zIndex, 10)
    if (!Number.isNaN(z) && z > 90) continue
    let dark = false
    const stops = parseStops(cs.backgroundColor)
    if (stops.length && stops[0].a >= 0.72 && stops[0].lum < 55) dark = true
    if (!dark && /gradient/.test(cs.backgroundImage)) {
      const gs = parseStops(cs.backgroundImage)
      if (gs.length && gs.every((s) => s.lum < 60) && gs.some((s) => s.a >= 0.85)) dark = true
    }
    if (!dark) continue
    const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean)[0]
    if (!cls || cls.startsWith('pts-') || cls.startsWith('pro-theme') || cls === 'header' || cls === 'navigation-sidebar') continue
    out.push({ cls, size: `${Math.round(r.width)}x${Math.round(r.height)}` })
  }
  return out
}

async function auditPage(browser, url, { look = 'glass', tabClicks = 0, scrolls = [0, 800], extraWait = 0 } = {}) {
  const p = await browser.newPage()
  await p.setViewport({ width: 1600, height: 1000 })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 110)))
  await p.evaluateOnNewDocument((lk) => {
    const raw = localStorage.getItem('spectre-settings')
    const data = raw ? JSON.parse(raw) : { state: {}, version: 0 }
    data.state = { ...data.state, proThemeLook: lk, dayMode: lk === 'paper' }
    if (lk === 'glass') data.state.proThemeBg = { mode: 'scene', scene: 'meadow' }
    if (lk === 'paper') data.state.proThemePaper = 'pearl'
    localStorage.setItem('spectre-settings', JSON.stringify(data))
  }, look)
  const found = new Map()
  const record = (hits, ctx) => { for (const h of hits) if (!found.has(h.cls)) found.set(h.cls, { ...h, ctx }) }
  try {
    await p.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await p.waitForSelector('.app', { timeout: 30000 })
    await wait(6500 + extraWait)
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => /maybe later/i.test(x.textContent))
      btn?.click(); document.querySelector('.gtour__backdrop')?.remove()
    })
    await wait(400)
    for (const s of scrolls) {
      await p.evaluate((y) => {
        window.scrollTo(0, y)
        for (const sel of ['.page-layout', '.app-main-content', '.welcome-page']) document.querySelector(sel)?.scrollTo?.(0, y)
        document.querySelector('.page-layout > *')?.scrollTo?.(0, y)
      }, s)
      await wait(700)
      record(await p.evaluate(SCAN_FN), `scroll${s}`)
    }
    if (tabClicks > 0) {
      const labels = await p.evaluate(() => {
        const cands = [...document.querySelectorAll('[role="tab"], button[class*="tab"]:not([class*="table"]), [class*="view-toggle"] button, [class*="seg"] button, [class*="-tabs"] button')]
        const seen = new Set()
        return cands.map((el) => (el.textContent || '').trim()).filter((t) => {
          if (!t || t.length > 22 || seen.has(t)) return false
          seen.add(t); return true
        })
      })
      for (const label of labels.slice(0, tabClicks)) {
        await p.evaluate((lbl) => {
          const cands = [...document.querySelectorAll('[role="tab"], button[class*="tab"]:not([class*="table"]), [class*="view-toggle"] button, [class*="seg"] button, [class*="-tabs"] button')]
          cands.find((el) => (el.textContent || '').trim() === lbl)?.click()
        }, label)
        await wait(1700)
        record(await p.evaluate(SCAN_FN), `tab:${label}`)
      }
    }
  } catch (e) { found.set('__error__', { cls: '__error__', ctx: e.message.slice(0, 90) }) }
  await p.close()
  return { url, look, hits: [...found.values()], errs: errs.slice(0, 3) }
}

module.exports = { BASE, puppeteer, auditPage, wait }
