/**
 * Screenshot Service — Captures real Spectre app UI as images.
 * Hides sidebar + header, resets layout offsets for clean content-only capture.
 */

const puppeteer = require('puppeteer')

const APP_URL = process.env.SPECTRE_APP_URL || 'http://localhost:5180'
let browser = null

async function getBrowser() {
  if (browser && browser.isConnected()) return browser
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1440,900',
    ],
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
    },
  })
  return browser
}

/**
 * Screenshot a Spectre app page — content only, no sidebar/header.
 */
async function screenshotPage(opts) {
  const {
    path = '/',
    selector = null,
    waitMs = 3500,
    viewport = null,
    beforeScreenshot = null,
  } = opts

  let page = null
  try {
    const br = await getBrowser()
    page = await br.newPage()

    if (viewport) {
      await page.setViewport({ ...viewport, deviceScaleFactor: 2 })
    }

    const url = APP_URL + path
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })

    // Run custom pre-screenshot logic (tab clicks, etc.)
    if (beforeScreenshot) {
      await beforeScreenshot(page)
    }

    // Wait for data to load
    await new Promise(r => setTimeout(r, waitMs))

    // Inject CSS to hide sidebar, header, and reset all layout offsets
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.id = 'spectre-bot-overrides'
      style.textContent = `
        /* Hide chrome */
        .navigation-sidebar,
        .header,
        .spectre-tooltip,
        [role="tooltip"],
        .mobile-bottom-nav,
        .sidebar-overlay,
        .particle-bg {
          display: none !important;
        }

        /* Reset layout — content takes full viewport */
        .page-layout {
          margin-left: 0 !important;
          width: 100% !important;
          padding-top: 24px !important;
        }

        .app.nav-sidebar-open .page-layout,
        .app.nav-sidebar-open.nav-sidebar-collapsed .page-layout {
          margin-left: 0 !important;
          width: 100% !important;
        }

        .app-main-content {
          margin-left: 0 !important;
          width: 100% !important;
        }

        /* Welcome page (no PageShell) — reset its own layout */
        .welcome-page,
        .welcome-page-wrapper,
        .research-platform {
          margin-left: 0 !important;
          padding-left: 0 !important;
          width: 100% !important;
        }

        /* GM dashboard — reset */
        .gm-dashboard,
        .gm-dashboard-wrapper {
          margin-left: 0 !important;
          padding-left: 0 !important;
          padding-top: 16px !important;
          width: 100% !important;
        }

        /* Hide scrollbars */
        *::-webkit-scrollbar { display: none !important; }
        * { scrollbar-width: none !important; }

        /* Ensure dark bg fills */
        body, html, #root, .app {
          background: #09090b !important;
        }
      `
      document.head.appendChild(style)
    })

    // Small delay for reflow
    await new Promise(r => setTimeout(r, 400))

    let buffer
    if (selector) {
      const el = await page.$(selector)
      if (el) {
        buffer = await el.screenshot({ type: 'png' })
      } else {
        buffer = await page.screenshot({ type: 'png', fullPage: false })
      }
    } else {
      buffer = await page.screenshot({ type: 'png', fullPage: false })
    }

    return buffer
  } catch (err) {
    console.error('Screenshot failed:', err.message)
    return null
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

async function isAppRunning() {
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
}

module.exports = { screenshotPage, isAppRunning, closeBrowser }
