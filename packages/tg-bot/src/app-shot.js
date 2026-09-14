// Live app-pixel captures — the bot ships THE app's own charts instead of a
// canvas re-render (founder 07-16: /feargreed must use the app.spectreai.io
// fear-greed page chart). Headless Chrome on the box opens the page in the
// app's showcase DEMO mode (?demo=true + spectreai.io referrer bypasses the
// team gate — no password needed; the fear-greed data API is public), waits
// for the chart, clips the card. Every failure returns null so callers fall
// back to the canvas render.
const puppeteer = require('puppeteer')
const { createCanvas, loadImage } = require('@napi-rs/canvas')

const APP = 'https://app.spectreai.io'

// Telegram sendPhoto rejects extreme sizes (PHOTO_INVALID_DIMENSIONS: longest
// side effectively capped, width+height must be sane, ratio ≤ 20). The 2× DPR
// captures of tall views (dual gainers/losers) can blow past it — downscale so
// the longest side ≤ 2200px and the ratio ≤ 20, preserving aspect. No-op when
// already safe. Keeps text crisp on a phone.
async function fitTelegram(png) {
  try {
    const img = await loadImage(png)
    let { width: w, height: h } = img
    const MAX = 2200
    const longest = Math.max(w, h)
    let scale = longest > MAX ? MAX / longest : 1
    // ratio guard (Telegram ~20:1) — pad the short side if a view is a sliver
    if (Math.max(w, h) / Math.min(w, h) > 20) return png // let the fallback handle the freak case
    if (scale === 1) return png
    w = Math.round(w * scale)
    h = Math.round(h * scale)
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toBuffer('image/png')
  } catch {
    return png // never let a resize failure lose the shot
  }
}
const DEMO_REFERRER = 'https://spectreai.io/' // an allowed showcase origin

// Some pages (economic calendar) pull data through the gated intel-api, whose
// tier-2 routes accept the showcase `dc_demo` cookie. Mint one server-side
// (Origin must be an allowed showcase origin) and hand it to Chrome so those
// captures render real data. Cached ~12 min (the cookie lives 15). Pages on
// public endpoints (fear-greed, heatmap, bubbles) don't need it.
let demoCookie = null // { value, at }
async function mintDemoCookie() {
  if (demoCookie && Date.now() - demoCookie.at < 12 * 60e3) return demoCookie.value
  try {
    const res = await fetch(`${APP}/api/auth-gate?action=demo-session`, {
      headers: { Origin: 'https://spectreai.io' },
      signal: AbortSignal.timeout(12e3),
    })
    if (!res.ok) return null
    const setc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    const hit = setc.map((c) => /dc_demo=([^;]+)/.exec(c)).find(Boolean)
    if (!hit) return null
    demoCookie = { value: hit[1], at: Date.now() }
    return hit[1]
  } catch {
    return null
  }
}

// one browser at a time — a chart command burst must not fork 5 Chromes
let busy = false
const shotCache = new Map() // key → { at, png }

async function capture({ path: pagePath, selector, shotSelector = null, tightTo = null, viewport, ttlMs = 10 * 60e3, settleMs = 2500, needsDemoCookie = false, viewClick = null, presetStorage = null, pad = 0, readyFn = null }) {
  const key = `${pagePath}|${shotSelector || selector}|${viewClick ? `${viewClick.scope}#${viewClick.index ?? viewClick.text}` : ''}`
  const hit = shotCache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.png
  if (busy) return null // caller falls back rather than queueing behind Chrome
  busy = true
  let browser = null
  try {
    const dc = needsDemoCookie ? await mintDemoCookie() : null
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: viewport?.w || 1440, height: viewport?.h || 960, deviceScaleFactor: 2 })
    if (dc) await browser.setCookie({ name: 'dc_demo', value: dc, domain: '.spectreai.io', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })
    // seed localStorage before any page script runs (e.g. skip the cosmos
    // onboarding panel so it never covers the capture)
    if (presetStorage) {
      await page.evaluateOnNewDocument((kv) => {
        try { for (const [k, v] of Object.entries(kv)) window.localStorage.setItem(k, v) } catch { /* private mode */ }
      }, presetStorage)
    }
    // demo mode bypasses the gate; the referrer must be an allowed showcase
    // origin (checked client-side via document.referrer)
    await page.setExtraHTTPHeaders({ Referer: DEMO_REFERRER })
    const sep = pagePath.includes('?') ? '&' : '?'
    await page.goto(`${APP}${pagePath}${sep}demo=true`, { waitUntil: 'domcontentloaded', timeout: 45e3, referer: DEMO_REFERRER })
    await page.waitForSelector(selector, { visible: true, timeout: 30e3 })
    await new Promise((r) => setTimeout(r, 900)) // let the default view mount
    // wait for the base page DATA before switching views / settling — the shell
    // renders with shimmer skeletons while the chart/bubbles data is still
    // fetching, and clipping then gives an empty card (founder 07-17 "fear
    // chart empty", "bubbles same"). Best-effort: proceed on timeout, the
    // blank-retry is the backstop.
    // generous timeout — the fear-greed 365-day history + BTC overlay can take
    // ~22s to process in headless; waitForFunction resolves the instant it's
    // true, so fast pages (bubbles) aren't slowed
    if (readyFn) await page.waitForFunction(readyFn, { timeout: 30e3, polling: 300 }).catch(() => {})
    // optional view switch: click a control within a scope selector, chosen by
    // INDEX (heatmap .heatmaps-view-btn is exactly grid/treemap/bars/dual =
    // 0/1/2/3) or by TEXT (bubbles .bubbles-pill is shared by every pill —
    // timeframes, ranges, categories — so 'Cosmos' must be matched by label).
    if (viewClick) {
      await page.evaluate(({ scope, index, text }) => {
        const btns = [...document.querySelectorAll(scope)].filter((b) => {
          const r = b.getBoundingClientRect()
          return r.width > 4 && r.height > 4
        })
        const target = text != null
          ? btns.find((b) => (b.textContent || '').trim().toLowerCase() === String(text).toLowerCase())
          : btns[index]
        if (target) target.click()
      }, viewClick).catch(() => {})
    }
    await new Promise((r) => setTimeout(r, settleMs)) // charts/canvas animate in
    // the ELEMENT to clip — for a view whose content is shorter than the tall
    // outer container (heatmap bars/dual), shoot the inner content wrapper so
    // the clip isn't mostly black void (founder 07-17 "broken empty or cut")
    const shotSel = shotSelector || selector
    if (shotSelector) await page.waitForSelector(shotSelector, { visible: true, timeout: 8e3 }).catch(() => {})
    // sticky/fixed chrome (top nav, marquee) overlaps the card's bounding box
    // and bleeds into the element clip — hide anything fixed that isn't inside
    // the target card
    await page.evaluate((sel) => {
      const card = document.querySelector(sel)
      for (const n of document.querySelectorAll('body *')) {
        const pos = getComputedStyle(n).position
        if ((pos === 'fixed' || pos === 'sticky') && card && !card.contains(n) && !n.contains(card)) {
          n.style.visibility = 'hidden'
        }
      }
    }, shotSel).catch(() => {})
    const shoot = async () => {
      // a page renders desktop + mobile + fullview copies of a view; page.$
      // returns the FIRST (often the hidden narrow mobile one). Pick the
      // LARGEST visible match by area.
      const els = await page.$$(shotSel)
      let el = null
      let best = 0
      for (const cand of els) {
        const box = await cand.boundingBox().catch(() => null)
        const area = box ? box.width * box.height : 0
        if (box && box.width > 200 && area > best) { best = area; el = cand }
      }
      if (!el) el = await page.$(shotSel)
      if (!el) return null
      const box = await el.boundingBox()
      // tightTo: the view element is taller than its content (bars rows fill
      // only the top, leaving black void) — cap the clip at the bottom of the
      // last content row (founder 07-17 "broken empty or cut")
      let bottom = box ? box.y + box.height : null
      if (box && tightTo) {
        const b = await page.evaluate((sel) => {
          const rows = [...document.querySelectorAll(sel)].filter((r) => r.getBoundingClientRect().width > 4)
          if (!rows.length) return null
          return rows[rows.length - 1].getBoundingClientRect().bottom
        }, tightTo).catch(() => null)
        if (b && b > box.y + 40) bottom = b
      }
      // padded clip so nothing is shaved off the edges (top-row cut) + tight
      // bottom so there's no void
      if (box && (pad || tightTo)) {
        const vpH = viewport?.h || 960
        const clipY = Math.max(0, box.y - pad)
        return page.screenshot({
          type: 'png',
          clip: {
            x: Math.max(0, box.x - pad),
            y: clipY,
            width: box.width + pad * 2,
            height: Math.min(vpH - clipY, bottom - clipY + pad),
          },
        })
      }
      return el.screenshot({ type: 'png' })
    }
    // a view whose data hasn't landed yet screenshots near-blank (tiny PNG) —
    // wait and re-shoot once rather than shipping a black card
    let png = await shoot()
    if (png && png.length < 30000) {
      await new Promise((r) => setTimeout(r, 3000))
      const retry = await shoot()
      if (retry && retry.length > (png?.length || 0)) png = retry
    }
    if (png?.length) png = await fitTelegram(png)
    if (png?.length) shotCache.set(key, { at: Date.now(), png })
    return png?.length ? png : null
  } catch (e) {
    console.error('[app-shot]', pagePath, e.message)
    return null
  } finally {
    if (browser) await browser.close().catch(() => {})
    busy = false
  }
}

// the /fear-greed chart card: composite line + BTC overlay, exactly as on-app.
// Wide viewport so the card renders full-bleed like the app page (a squarish
// viewport compressed it and left dead dark space — founder 07-16).
// readyFn keys on the LOADED chart having many real line paths (~366) vs the
// skeleton's ~4 vs a pre-render 0 — `!skeleton` alone was true before React
// even mounted, so it captured an empty page (founder 07-17 "fear chart empty")
const fearGreedShot = () => capture({ path: '/fear-greed', selector: '.fg-chart-card', viewport: { w: 1800, h: 1000 }, settleMs: 1500, readyFn: 'document.querySelectorAll(".fg-chart-card path").length > 20' })

// economic calendar month grid (DAY/WEEK/MONTH tabs + month nav + grid).
// Data rides the gated intel-api → needs the dc_demo cookie (+ the bundle
// route being demo-eligible, PR claude/calendar-demo-tier).
const calendarShot = () => capture({ path: '/economic-calendar', selector: '.ec-panel', viewport: { w: 1800, h: 1150 }, settleMs: 3200, needsDemoCookie: true })

// heatmap views — treemap (default) + grid / bars / dual, switched by clicking
// the view toggle. pad:16 stops the top row being shaved (founder 07-16).
const HM = { path: '/heatmaps', selector: '.heatmaps-grid-container', viewport: { w: 1800, h: 1150 }, settleMs: 2800, pad: 16 }
const VB = '.heatmaps-view-btn' // desktop toggle group: grid/treemap/bars/dual
const heatmapShot = () => capture({ ...HM }) // treemap (default) — fills the container
const heatmapGridShot = () => capture({ ...HM, viewClick: { scope: VB, index: 0 } })
// bars/dual content is SHORTER than the tall grid container → clip the inner
// content wrapper (.heatmap-chart-view / .hdc-view), not the void-padded box
const heatmapBarsShot = () => capture({ ...HM, viewClick: { scope: VB, index: 2 }, shotSelector: '.heatmap-chart-view', tightTo: '.heatmap-chart-row', pad: 12 })
const heatmapDualShot = () => capture({ ...HM, viewClick: { scope: VB, index: 3 }, shotSelector: '.hdc-view', pad: 12 })

// bubbles arena (d3 force-packed DOM bubbles) — wait for the nodes, then settle
// for the force-sim + fade-in
const bubblesShot = () => capture({ path: '/bubbles', selector: '.bubbles-container', viewport: { w: 1800, h: 1150 }, settleMs: 2800, pad: 12, readyFn: 'document.querySelectorAll(".bubble-node").length > 20' })
// SPECTRE COSMOS — the WebGL universe view; wait for the bubbles data first
// (cosmos builds from it), click the Cosmos pill, seed the onboarding flag so
// the explainer never covers the scene, long settle for three.js to compose
const bubblesCosmosShot = () => capture({ path: '/bubbles', selector: '.bubbles-container', viewport: { w: 1800, h: 1150 }, settleMs: 6000, viewClick: { scope: '.bubbles-pill', text: 'cosmos' }, presetStorage: { 'spectre-cosmos-onboarded': '1' }, readyFn: 'document.querySelectorAll(".bubble-node").length > 20' })

const HEATMAP_SHOTS = { treemap: heatmapShot, grid: heatmapGridShot, bars: heatmapBarsShot, dual: heatmapDualShot }
const BUBBLE_SHOTS = { bubbles: bubblesShot, cosmos: bubblesCosmosShot }

// Render a self-contained HTML string to a PNG (used for composed dashboards).
// setContent + networkidle so logo/coin images resolve; screenshots a selector
// (the card) or the full page. Telegram-safe downscaled.
async function renderHtml(html, { width = 1680, height = 950, selector = null, deviceScaleFactor = 2, settleMs = 500 } = {}) {
  if (busy) return null
  busy = true
  let browser = null
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor })
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30e3 }).catch(() => {})
    await new Promise((r) => setTimeout(r, settleMs))
    const el = selector ? await page.$(selector) : null
    let png = el ? await el.screenshot({ type: 'png' }) : await page.screenshot({ type: 'png' })
    if (png?.length) png = await fitTelegram(png)
    return png?.length ? png : null
  } catch (e) {
    console.error('[render-html]', e.message)
    return null
  } finally {
    if (browser) await browser.close().catch(() => {})
    busy = false
  }
}

module.exports = {
  fearGreedShot, calendarShot, heatmapShot, bubblesShot, bubblesCosmosShot,
  heatmapGridShot, heatmapBarsShot, heatmapDualShot,
  HEATMAP_SHOTS, BUBBLE_SHOTS, capture, renderHtml,
}
