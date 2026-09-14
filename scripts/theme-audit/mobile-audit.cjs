/**
 * Mobile UI/UX audit — the phone counterpart to the desktop theme scanners.
 *
 * Seven checks, each one a defect class this repo has actually shipped before:
 *   1. horizontal overflow        (the full-bleed-scroller trap)
 *   2. touch targets < 38px       (the documented min, and its specificity trap)
 *   3. invisible text             (the day-mode ink class — A10c)
 *   4. covered interactive els    ("the X is so on top I can't click it")
 *   5. blur load                  (filtered megapixels — the honest jank metric)
 *   6. paint-driven infinite anims(dotPulse / AuroraField class)
 *   7. page errors
 *
 * 🪤 Contrast: source-over must ACCUMULATE alpha or every translucent chip
 * reads as a slab (the documented false-positive that produced a page of
 * phantom findings). 🪤 SVG text has `fill`, not `color`.
 *
 * Usage: SPECTRE_URL=http://localhost:5183 node scripts/theme-audit/mobile-audit.cjs
 */
const { chromium } = require('playwright')
const BASE = process.env.SPECTRE_URL || 'http://localhost:5183'

const ROUTES = (process.env.ROUTES || [
  '/', '/research-zone/bitcoin', '/lite', '/watchlists', '/heatmaps',
  '/categories', '/news', '/intelligence', '/traders-corner', '/ai-charts',
  '/economic-calendar', '/tokenized-assets',
].join(',')).split(',')

const AUDIT = () => {
  const vw = innerWidth, vh = innerHeight
  const rgba = (s) => {
    const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null
  }
  // source-over: accumulate alpha, never assume the first layer is opaque
  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a)
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    }
  }
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05) }
  const bgOf = (el) => {
    let acc = { r: 0, g: 0, b: 0, a: 0 }, node = el
    while (node && node !== document.documentElement && acc.a < 0.99) {
      const c = rgba(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) acc = over(acc, c)
      node = node.parentElement
    }
    if (acc.a < 0.99) acc = over(acc, { r: 9, g: 9, b: 11, a: 1 })
    return acc
  }
  const onScreen = (r) => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0

  // 1. horizontal overflow
  const overflow = { docScroll: document.documentElement.scrollWidth, vw, offenders: [] }
  if (overflow.docScroll > vw + 1) {
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 && r.width > 24 && r.height > 4 && getComputedStyle(el).position !== 'fixed') {
        overflow.offenders.push({ cls: String(el.className || el.tagName).slice(0, 48), right: Math.round(r.right), w: Math.round(r.width) })
      }
    })
    overflow.offenders = overflow.offenders.slice(0, 6)
  }

  // 2. touch targets + 4. covered interactive elements
  const SEL = 'button, a[href], input, select, [role="button"], [role="tab"], [onclick]'
  const small = [], covered = []
  document.querySelectorAll(SEL).forEach((el) => {
    const r = el.getBoundingClientRect()
    if (!onScreen(r)) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) return
    if (r.width < 38 || r.height < 38) {
      small.push({ cls: String(el.className || el.tagName).slice(0, 44), size: Math.round(r.width) + 'x' + Math.round(r.height), txt: (el.textContent || '').trim().slice(0, 18) })
    }
    const cx = Math.min(vw - 1, Math.max(1, r.left + r.width / 2))
    const cy = Math.min(vh - 1, Math.max(1, r.top + r.height / 2))
    const hit = document.elementFromPoint(cx, cy)
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      covered.push({ cls: String(el.className || el.tagName).slice(0, 40), by: String(hit.className || hit.tagName).slice(0, 40), txt: (el.textContent || '').trim().slice(0, 18) })
    }
  })

  // 3. invisible text
  const invisible = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n, seen = 0
  while ((n = walker.nextNode()) && seen < 4000) {
    const txt = n.nodeValue && n.nodeValue.trim()
    if (!txt || txt.length < 2) continue
    const el = n.parentElement
    if (!el) continue
    seen++
    const r = el.getBoundingClientRect()
    if (!onScreen(r) || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue
    if (/clip|text/.test(cs.webkitBackgroundClip || '') || cs.webkitTextFillColor === 'transparent') continue
    const fg = rgba(el.tagName === 'text' ? cs.fill : cs.color)
    if (!fg || fg.a === 0) continue
    const bg = bgOf(el)
    const cr = contrast(over(fg, bg), bg)
    if (cr < 1.6) invisible.push({ cls: String(el.className || el.tagName).slice(0, 40), txt: txt.slice(0, 26), cr: +cr.toFixed(2) })
  }

  // 5. blur load
  let blurPx = 0, blurCount = 0
  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el)
    const bf = cs.backdropFilter || cs.webkitBackdropFilter
    if (!bf || bf === 'none') return
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return
    const r = el.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
    if (w < 2 || h < 2) return
    blurPx += w * h; blurCount++
  })

  // 6. paint-driven infinite animations
  const PAINT = /box-shadow|filter|background|width|height|top|left|right|bottom|border|clip|r$|cx|cy/i
  const paintAnims = []
  document.querySelectorAll('*').forEach((el) => {
    const list = el.getAnimations ? el.getAnimations() : []
    list.forEach((a) => {
      try {
        if (a.playState !== 'running') return
        const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}
        if (t.iterations !== Infinity) return
        const kf = a.effect.getKeyframes ? a.effect.getKeyframes() : []
        const props = new Set()
        kf.forEach((k) => Object.keys(k).forEach((p) => { if (!['offset', 'composite', 'computedOffset', 'easing'].includes(p)) props.add(p) }))
        const painty = [...props].filter((p) => PAINT.test(p))
        if (!painty.length) return
        const r = el.getBoundingClientRect()
        if (!onScreen(r)) return
        paintAnims.push({ cls: String(el.className || el.tagName).slice(0, 40), props: painty.join(','), size: Math.round(r.width) + 'x' + Math.round(r.height) })
      } catch (e) { /* cross-origin / detached */ }
    })
  })

  return {
    viewport: vw + 'x' + vh,
    overflow: overflow.docScroll > vw + 1 ? overflow : null,
    smallTargets: small.slice(0, 14), smallCount: small.length,
    coveredTargets: covered.slice(0, 10), coveredCount: covered.length,
    invisibleText: invisible.slice(0, 12), invisibleCount: invisible.length,
    blur: { surfaces: blurCount, mp: +(blurPx / 1e6).toFixed(3), screens: +(blurPx / (vw * vh)).toFixed(2) },
    paintAnims: paintAnims.slice(0, 8), paintAnimCount: paintAnims.length,
  }
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('spectre-lite-beta-ack', '1') } catch (e) {}
    try { sessionStorage.setItem('spectre-auth', 'true') } catch (e) {}
  })
  const results = []
  for (const route of ROUTES) {
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 110)))
    try {
      await p.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await p.waitForTimeout(Number(process.env.SETTLE || 5000))
      const r = await p.evaluate(AUDIT)
      results.push({ route, ...r, pageErrors: [...new Set(errs)].slice(0, 3) })
    } catch (e) {
      results.push({ route, error: String(e.message).slice(0, 120) })
    }
    await p.close()
  }
  await browser.close()
  console.log(JSON.stringify(results, null, 1))
})()
