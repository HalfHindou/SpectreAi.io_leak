import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'

// chart-smoke — the live-DOM half of the charts HEALTH CONTRACT (@chart-smoke).
//
// The data-pipeline contract lives in apps/research/scripts/charts-health.mjs
// (asserts the /api/bars tier router, UDF, stocks routes). THIS spec asserts the
// other half: that the rendered chart actually PAINTS PIXELS in every mode, that
// the chart stack throws no console/page errors, and that known regressions
// (C1 ticker-rule, the dead onchain/pool tier, the a899b79b candles latch,
// scroll-back history paging) stay fixed.
//
// REQUIRES all three dev servers running:
//   Express  :3001  (npm run dev:server)   — /api/bars, /api/tradingview/udf/*
//   research  :5180  (npm run dev:research)  — research-zone chart
//   trading   :5181  (npm run dev:trading)   — trading-app token chart
//
// RUN:
//   npx playwright test e2e/chart-smoke.spec.js
// (per-project, if you only want one app:)
//   npx playwright test e2e/chart-smoke.spec.js --project=research
//   npx playwright test e2e/chart-smoke.spec.js --project=trading
//
// The chart stack is slow on a cold dev server (charting_library + datafeed
// cascade), so waits are generous but bounded — total runtime stays < ~3min.

// ── Tunables ─────────────────────────────────────────────────────────────────
const GRACE = 1500          // settle time after a mode switch / interaction
const CHART_LOAD = 45_000   // generous ceiling for first chart paint on cold dev
const TV_LOAD = 60_000      // TradingViewAdvanced (charting_library) is slowest

// Console/page-error fence: any matching string fails the test. These are the
// fingerprints of a broken chart stack (TV datafeed error, study not found,
// the ChartErrorBoundary tripping, a getBars failure, a hard ReferenceError).
const ERROR_FENCE = /\[TV\]|TradingViewAdvanced|ChartErrorBoundary|getBars error|There is no such study|ReferenceError/

// ── Minimal PNG decoder (node built-ins only) ────────────────────────────────
// We can't reach into a cross-origin / blob TradingView iframe to read its
// canvas, so for the TV mode we screenshot the chart container and assert the
// PNG isn't one flat colour. frameLocator can't reliably pierce blob iframes;
// screenshot-variance is the robust check. This decoder unfilters the raw RGBA
// scanlines from a Playwright screenshot buffer using zlib (no extra deps).
function decodePng(buffer) {
  // PNG signature is 8 bytes.
  let pos = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data.readUInt8(8)
      colorType = data.readUInt8(9)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len // length(4) + type(4) + data(len) + crc(4)
  }
  if (!width || !height) return null
  // Channels per pixel: 6 = truecolour+alpha (RGBA), 2 = truecolour (RGB).
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4
  if (bitDepth !== 8) return null // Playwright screenshots are 8-bit
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  // Undo PNG scanline filters (Sub/Up/Average/Paeth) row by row.
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const rowStart = y * (stride + 1) + 1
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x]
      const a = x >= channels ? out[y * stride + x - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = (x >= channels && y > 0) ? out[(y - 1) * stride + x - channels] : 0
      let val
      switch (filter) {
        case 0: val = rawByte; break
        case 1: val = rawByte + a; break
        case 2: val = rawByte + b; break
        case 3: val = rawByte + ((a + b) >> 1); break
        case 4: val = rawByte + paeth(a, b, c); break
        default: val = rawByte
      }
      out[y * stride + x] = val & 0xff
    }
  }
  return { width, height, channels, data: out }
}

// Pixel variance of a decoded PNG (or an ImageData-like {data}). A flat fill
// has near-zero variance; a real chart has many distinct luminances.
function lumaVariance(img) {
  const { data, channels } = img
  let sum = 0, sumSq = 0, n = 0
  const step = channels // one luma sample per pixel
  for (let i = 0; i + 2 < data.length; i += step * 4 /* subsample for speed */) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const l = 0.299 * r + 0.587 * g + 0.114 * b
    sum += l
    sumSq += l * l
    n++
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

const VARIANCE_FLOOR = 8 // empirical: a flat fill ~0, a painted chart >> 8

// Assert a Playwright element screenshot is not one flat colour.
async function assertScreenshotPainted(locator, label) {
  const buf = await locator.screenshot()
  const img = decodePng(buf)
  expect(img, `${label}: screenshot should decode`).toBeTruthy()
  const variance = lumaVariance(img)
  expect(variance, `${label}: pixel variance > ${VARIANCE_FLOOR} (got ${variance.toFixed(1)})`).toBeGreaterThan(VARIANCE_FLOOR)
}

// Assert the .chart-canvas (a real <canvas>) has painted, by reading its
// own getImageData variance in-page — the strict check for canvas modes.
async function assertCanvasPainted(page, label) {
  const variance = await page.evaluate(() => {
    const c = document.querySelector('.chart-canvas')
    if (!c || !c.width || !c.height) return -1
    const ctx = c.getContext('2d')
    if (!ctx) return -1
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let sum = 0, sumSq = 0, n = 0
    for (let i = 0; i + 2 < data.length; i += 4 * 8) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      sum += l; sumSq += l * l; n++
    }
    if (!n) return -1
    const mean = sum / n
    return sumSq / n - mean * mean
  })
  expect(variance, `${label}: .chart-canvas found + has dimensions`).toBeGreaterThanOrEqual(0)
  expect(variance, `${label}: canvas pixel variance > ${VARIANCE_FLOOR} (got ${Number(variance).toFixed(1)})`).toBeGreaterThan(VARIANCE_FLOOR)
}

// Attach console + page error collection to a page; returns a getter for hits.
function attachErrorFence(page) {
  const hits = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && ERROR_FENCE.test(msg.text())) hits.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (ERROR_FENCE.test(String(err?.message || err))) hits.push(String(err?.message || err))
  })
  return () => hits
}

// ── RESEARCH project ─────────────────────────────────────────────────────────
test.describe('@chart-smoke research', () => {
  test.skip(({ }, testInfo) => testInfo.project.name !== 'research', 'research project only')

  const RZ_TOKENS = [
    {
      label: 'bitcoin',
      url: '/research-zone/bitcoin?tokenSymbol=BTC&cgId=bitcoin&address=0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599&networkId=1',
      isBitcoin: true,
    },
    {
      label: 'palm-ai',
      url: '/research-zone/palm-ai?tokenSymbol=PALM&cgId=palm-ai&address=0xf1df7305E4BAB3885caB5B1e4dFC338452a67891&networkId=1',
      isBitcoin: false,
    },
  ]

  for (const tok of RZ_TOKENS) {
    test(`chart paints in every mode — ${tok.label}`, async ({ page }) => {
      test.setTimeout(150_000)
      const errors = attachErrorFence(page)

      // Network fences: collect every response + request so we can assert the
      // dead onchain/pool tier never 4xx's, and (bitcoin only) that /api/bars is
      // never called with an 0x address (C1 ticker-rule tripwire).
      const poolFailures = []
      const barsAddressCalls = []
      page.on('response', (resp) => {
        const u = resp.url()
        if (u.includes('/api/onchain/pool/') && resp.status() >= 400 && resp.status() < 500) {
          poolFailures.push(`${resp.status()} ${u}`)
        }
      })
      page.on('request', (req) => {
        const u = req.url()
        if (tok.isBitcoin && /\/api\/bars\?symbol=0x/i.test(u)) {
          barsAddressCalls.push(u)
        }
      })

      await page.goto(tok.url, { waitUntil: 'domcontentloaded' })

      // Wait for the chart shell, then the canvas to gain real dimensions.
      await page.locator('.chart-content-area').first().waitFor({ timeout: CHART_LOAD })
      await page.locator('.chart-canvas').first().waitFor({ state: 'attached', timeout: CHART_LOAD })
      await page.waitForFunction(() => {
        const c = document.querySelector('.chart-canvas')
        return c && c.width > 0 && c.height > 0
      }, { timeout: CHART_LOAD }).catch(() => {})
      await page.waitForTimeout(GRACE)

      // ── Candles mode (default) — strict canvas pixel check. ──
      const candlesBtn = page.locator('.type-btn', { hasText: /candle/i }).first()
      if (await candlesBtn.count()) {
        await candlesBtn.click({ trial: false }).catch(() => {})
        await page.waitForTimeout(GRACE)
      }
      await assertCanvasPainted(page, `${tok.label} candles`)

      // ── Line mode — strict canvas pixel check. ──
      const lineBtn = page.locator('.type-btn', { hasText: /^line$/i }).first()
      if (await lineBtn.count()) {
        await lineBtn.click().catch(() => {})
        await page.waitForTimeout(GRACE)
        await assertCanvasPainted(page, `${tok.label} line`)
      }

      // ── TradingView mode — screenshot the container, assert it isn't flat. ──
      const tvBtn = page.locator('.tradingview-btn').first()
      if (await tvBtn.count() && !(await tvBtn.getAttribute('class') || '').includes('disabled')) {
        await tvBtn.click().catch(() => {})
        // The TV body swaps in; wait for the charting_library to draw.
        await page.waitForTimeout(GRACE)
        const tvBody = page.locator('.chart-body-tradingview').first()
        const target = (await tvBody.count()) ? tvBody : page.locator('.chart-content-area').first()
        await target.waitFor({ timeout: TV_LOAD })
        // Extra settle for the iframe/library to render its first frame.
        await page.waitForTimeout(GRACE * 2)
        await assertScreenshotPainted(target, `${tok.label} tradingview`)
      }

      // ── Network fences ──
      expect(poolFailures, `dead onchain/pool tier must not 4xx: ${poolFailures.join(', ')}`).toHaveLength(0)
      if (tok.isBitcoin) {
        expect(barsAddressCalls, `C1: BTC must not fetch /api/bars by 0x address: ${barsAddressCalls.join(', ')}`).toHaveLength(0)
      }

      // ── Console/page-error fence (whole test) ──
      expect(errors(), `chart stack errors: ${errors().join(' | ')}`).toHaveLength(0)
    })
  }

  // a899b79b latch case: a persisted {chartTimeframe:'7D', chartType:'candles'}
  // setting used to leave the candles canvas blank on first load. Seed the store
  // BEFORE navigation and assert candles still paints.
  test('a899b79b — persisted 7D/candles setting still paints (bitcoin)', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext()
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem(
          'spectre-settings',
          JSON.stringify({ state: { chartTimeframe: '7D', chartType: 'candles' }, version: 2 }),
        )
      } catch { /* ignore */ }
    })
    const page = await context.newPage()
    const errors = attachErrorFence(page)
    await page.goto(
      '/research-zone/bitcoin?tokenSymbol=BTC&cgId=bitcoin&address=0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599&networkId=1',
      { waitUntil: 'domcontentloaded' },
    )
    await page.locator('.chart-canvas').first().waitFor({ state: 'attached', timeout: CHART_LOAD })
    await page.waitForFunction(() => {
      const c = document.querySelector('.chart-canvas')
      return c && c.width > 0 && c.height > 0
    }, { timeout: CHART_LOAD }).catch(() => {})
    await page.waitForTimeout(GRACE * 2)
    await assertCanvasPainted(page, 'a899b79b 7D candles')
    expect(errors(), `chart stack errors: ${errors().join(' | ')}`).toHaveLength(0)
    await context.close()
  })

  // Scroll-back history paging: dragging the candles canvas left→right (panning
  // into older bars) must fire at least one new /api/bars request whose window
  // is OLDER than the initial load (the C5 / scroll-to-load contract).
  test('scroll-back fires an older /api/bars window (bitcoin candles)', async ({ page }) => {
    test.setTimeout(120_000)
    const barsWindows = [] // { from, to } captured from /api/bars requests
    page.on('request', (req) => {
      const u = req.url()
      const m = u.match(/\/api\/bars\?/)
      if (!m) return
      try {
        const q = new URL(u).searchParams
        const from = parseInt(q.get('from'))
        const to = parseInt(q.get('to'))
        if (Number.isFinite(from) && Number.isFinite(to)) barsWindows.push({ from, to })
      } catch { /* ignore */ }
    })

    await page.goto(
      '/research-zone/bitcoin?tokenSymbol=BTC&cgId=bitcoin&address=0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599&networkId=1',
      { waitUntil: 'domcontentloaded' },
    )
    await page.locator('.chart-canvas').first().waitFor({ state: 'attached', timeout: CHART_LOAD })
    await page.waitForFunction(() => {
      const c = document.querySelector('.chart-canvas')
      return c && c.width > 0 && c.height > 0
    }, { timeout: CHART_LOAD }).catch(() => {})
    await page.waitForTimeout(GRACE * 2)

    const initialCount = barsWindows.length
    const initialOldest = barsWindows.length ? Math.min(...barsWindows.map((w) => w.from)) : Infinity

    // Drag across the canvas left→right to pan back into history.
    const canvas = page.locator('.chart-canvas').first()
    const box = await canvas.boundingBox()
    expect(box, 'canvas should have a bounding box').toBeTruthy()
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width * 0.15, y)
    await page.mouse.down()
    // Several incremental moves so the chart registers a real pan gesture.
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(box.x + box.width * (0.15 + 0.12 * i), y, { steps: 4 })
      await page.waitForTimeout(120)
    }
    await page.mouse.up()
    await page.waitForTimeout(GRACE * 2)

    const newCalls = barsWindows.slice(initialCount)
    expect(newCalls.length, 'scroll-back should fire >=1 new /api/bars request').toBeGreaterThanOrEqual(1)
    const firedOlder = newCalls.some((w) => w.from < initialOldest)
    expect(firedOlder, 'at least one new /api/bars window must be older than the initial load').toBeTruthy()
  })
})

// ── TRADING project ──────────────────────────────────────────────────────────
test.describe('@chart-smoke trading', () => {
  test.skip(({ }, testInfo) => testInfo.project.name !== 'trading', 'trading project only')

  // The trading app deep-links by CONTRACT ADDRESS only (#token/<0x…|solana>).
  // Ticker deep-links (#token/BTC) are rejected by App.jsx, so we test SPECTRE
  // (the address-form canary) only.
  test('SPECTRE token chart paints (trading)', async ({ page }) => {
    test.setTimeout(150_000)
    const errors = attachErrorFence(page)

    await page.goto('http://localhost:5181/#token/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', {
      waitUntil: 'domcontentloaded',
    })

    // The trading chart shares the research class names (S8 parity port):
    // .chart-content-area wrapper, .chart-canvas / .chart-body-tradingview body.
    await page.locator('.chart-content-area').first().waitFor({ timeout: TV_LOAD })
    // Generous settle: TVA + charting_library load is the slowest path on cold dev.
    await page.waitForTimeout(GRACE * 3)

    // Prefer the canvas pixel check if a canvas mode is showing; otherwise
    // screenshot the chart container (TV mode) and assert it isn't flat.
    const hasCanvas = await page.locator('.chart-canvas').count()
    if (hasCanvas) {
      await page.waitForFunction(() => {
        const c = document.querySelector('.chart-canvas')
        return c && c.width > 0 && c.height > 0
      }, { timeout: CHART_LOAD }).catch(() => {})
      await assertCanvasPainted(page, 'trading SPECTRE canvas')
    } else {
      const tvBody = page.locator('.chart-body-tradingview').first()
      const target = (await tvBody.count()) ? tvBody : page.locator('.chart-content-area').first()
      await target.waitFor({ timeout: TV_LOAD })
      await assertScreenshotPainted(target, 'trading SPECTRE tradingview')
    }

    expect(errors(), `chart stack errors: ${errors().join(' | ')}`).toHaveLength(0)
  })
})
